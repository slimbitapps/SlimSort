//! Sichere Datei-Operationen.
//!
//! Grundregeln (es geht um Fotos – Sicherheit vor Tempo):
//!  1. Es wird NIE eine bestehende Datei überschrieben. Ziele werden exklusiv
//!     angelegt; existiert ein Name, entsteht "Name (2).jpg".
//!  2. Verschieben über Laufwerksgrenzen (oder auf ein NAS) = kopieren in eine
//!     temporäre Datei, prüfen (Größe + Prüfsumme), umbenennen, erst dann das
//!     Original entfernen.
//!  3. Das Änderungsdatum bleibt erhalten.
//!  4. Bei jedem Fehler bleibt das Original unangetastet.

use serde::Serialize;
use sha1::{Digest, Sha1};
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, SystemTime};

pub const TMP_MARK: &str = ".fstmp-";
pub const DEFAULT_TIMEOUT: Duration = Duration::from_millis(5000);
const CHUNK: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct FsError {
    pub code: String,
    pub message: String,
    pub detail: Option<String>,
}

impl FsError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        FsError { code: code.into(), message: message.into(), detail: None }
    }
    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }
}

impl std::fmt::Display for FsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

/// Fehlercode wie unter Node (ENOENT, EACCES …) – die Oberfläche übersetzt sie.
pub fn io_code(e: &io::Error) -> String {
    use io::ErrorKind::*;
    #[cfg(unix)]
    if let Some(n) = e.raw_os_error() {
        let c = match n {
            libc::ENOENT => "ENOENT",
            libc::EACCES => "EACCES",
            libc::EPERM => "EPERM",
            libc::EEXIST => "EEXIST",
            libc::ENOSPC => "ENOSPC",
            libc::EBUSY => "EBUSY",
            libc::ENOTDIR => "ENOTDIR",
            libc::EISDIR => "EISDIR",
            libc::EXDEV => "EXDEV",
            libc::EROFS => "EROFS",
            libc::ETIMEDOUT => "ETIMEDOUT",
            libc::EIO => "EIO",
            libc::ENAMETOOLONG => "ENAMETOOLONG",
            libc::EMLINK => "EMLINK",
            libc::ENOTSUP => "ENOTSUP",
            _ => "",
        };
        if !c.is_empty() {
            return c.into();
        }
    }
    #[cfg(windows)]
    if let Some(n) = e.raw_os_error() {
        // ERROR_SHARING_VIOLATION / ERROR_LOCK_VIOLATION
        if n == 32 || n == 33 {
            return "EBUSY".into();
        }
        // ERROR_DISK_FULL / ERROR_HANDLE_DISK_FULL
        if n == 112 || n == 39 {
            return "ENOSPC".into();
        }
    }
    match e.kind() {
        NotFound => "ENOENT",
        PermissionDenied => "EACCES",
        AlreadyExists => "EEXIST",
        TimedOut => "ETIMEDOUT",
        StorageFull => "ENOSPC",
        NotADirectory => "ENOTDIR",
        IsADirectory => "EISDIR",
        ReadOnlyFilesystem => "EROFS",
        CrossesDevices => "EXDEV",
        ResourceBusy => "EBUSY",
        _ => "EIO",
    }
    .into()
}

impl From<io::Error> for FsError {
    fn from(e: io::Error) -> Self {
        FsError::new(&io_code(&e), e.to_string())
    }
}

pub type FsResult<T> = Result<T, FsError>;

/// Führt eine blockierende Dateisystem-Aktion mit Zeitlimit aus (hängende NAS).
/// Bei Zeitüberschreitung läuft der Hilfs-Thread im Hintergrund weiter, blockiert aber nichts.
pub fn with_timeout<T: Send + 'static>(
    timeout: Duration,
    label: &str,
    f: impl FnOnce() -> T + Send + 'static,
) -> FsResult<T> {
    let (tx, rx) = mpsc::channel();
    std::thread::Builder::new()
        .name("fs-timeout".into())
        .spawn(move || {
            let _ = tx.send(f());
        })
        .map_err(|e| FsError::new("EIO", e.to_string()))?;
    rx.recv_timeout(timeout)
        .map_err(|_| FsError::new("ETIMEDOUT", format!("Zeitüberschreitung: {label}")))
}

/// Existiert der Pfad (auch als defekter Link)?
pub fn exists(p: &Path) -> FsResult<bool> {
    match fs::symlink_metadata(p) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(e) if io_code(&e) == "ENOTDIR" => Ok(false),
        Err(e) => Err(e.into()),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DirCheck {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

fn writable(dir: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        let c = CString::new(dir.as_os_str().as_bytes()).map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?;
        // SAFETY: c ist ein gültiger, nullterminierter Pfad.
        if unsafe { libc::access(c.as_ptr(), libc::W_OK) } != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
    #[cfg(not(unix))]
    {
        // Unter Windows sagt das Schreibschutz-Attribut eines Ordners nichts aus –
        // ob Schreiben klappt, zeigt sich beim Übertragen (Fehler werden gemeldet).
        let _ = dir;
        Ok(())
    }
}

/// Prüft, ob ein Ordner erreichbar und beschreibbar ist (mit Zeitlimit).
pub fn check_dir(dir: &str, timeout: Duration) -> DirCheck {
    if dir.is_empty() {
        return DirCheck { ok: false, code: Some("NOPATH".into()) };
    }
    let d = PathBuf::from(dir);
    let r = with_timeout(timeout, dir, move || -> FsResult<()> {
        let m = fs::metadata(&d)?;
        if !m.is_dir() {
            return Err(FsError::new("ENOTDIR", "Kein Ordner"));
        }
        writable(&d)?;
        Ok(())
    });
    match r {
        Ok(Ok(())) => DirCheck { ok: true, code: None },
        Ok(Err(e)) | Err(e) => DirCheck { ok: false, code: Some(e.code) },
    }
}

/// Zerlegt "IMG_1.JPG" in ("IMG_1", ".JPG") – wie path.extname unter Node.
pub fn split_name(name: &str) -> (String, String) {
    match name.rfind('.') {
        Some(i) if i > 0 => (name[..i].to_string(), name[i..].to_string()),
        _ => (name.to_string(), String::new()),
    }
}

pub fn file_name(p: &Path) -> String {
    p.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Findet einen freien Namensstamm im Zielordner, sodass für ALLE Endungen
/// (Hauptdatei + Begleitdateien) kein Name belegt ist.
pub fn unique_stem(dest_dir: &Path, stem: &str, suffixes: &[String], start_at: u32) -> FsResult<(String, u32)> {
    for n in start_at.max(1)..100_000 {
        let candidate = if n == 1 { stem.to_string() } else { format!("{stem} ({n})") };
        let mut free = true;
        for sfx in suffixes {
            if exists(&dest_dir.join(format!("{candidate}{sfx}")))? {
                free = false;
                break;
            }
        }
        if free {
            return Ok((candidate, n));
        }
    }
    Err(FsError::new("ENAMES", "Kein freier Dateiname gefunden"))
}

pub fn hash_file(file: &Path, mut on_bytes: impl FnMut(u64)) -> FsResult<String> {
    let mut h = Sha1::new();
    let mut f = File::open(file)?;
    let mut buf = vec![0u8; CHUNK];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
        on_bytes(n as u64);
    }
    Ok(hex::encode(h.finalize()))
}

/// Kopiert src -> tmp (exklusiv angelegt) und liefert die Prüfsumme der gelesenen Daten.
fn copy_with_hash(src: &Path, tmp: &Path, mut on_bytes: impl FnMut(u64)) -> FsResult<String> {
    let mut h = Sha1::new();
    let mut input = File::open(src)?;
    let mut out = OpenOptions::new().write(true).create_new(true).open(tmp)?;
    let mut buf = vec![0u8; CHUNK];
    loop {
        let n = input.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
        out.write_all(&buf[..n])?;
        on_bytes(n as u64);
    }
    out.flush()?;
    let _ = out.sync_all(); // manche Netzlaufwerke unterstützen fsync nicht
    Ok(hex::encode(h.finalize()))
}

pub fn safe_unlink(p: &Path) -> FsResult<()> {
    match fs::remove_file(p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// Legt "tmp" unter dem endgültigen Namen "dest" ab, ohne je zu überschreiben.
/// Bevorzugt Hardlink (atomar, schlägt bei existierendem Ziel fehl).
fn finalize_no_clobber(tmp: &Path, dest: &Path) -> FsResult<()> {
    match fs::hard_link(tmp, dest) {
        Ok(()) => {
            safe_unlink(tmp)?;
            return Ok(());
        }
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
            return Err(FsError::new("EEXIST", "Ziel existiert bereits"));
        }
        Err(_) => { /* Dateisystem ohne Hardlinks (z. B. SMB, exFAT): prüfen, dann umbenennen */ }
    }
    if exists(dest)? {
        return Err(FsError::new("EEXIST", "Ziel existiert bereits"));
    }
    fs::rename(tmp, dest)?;
    Ok(())
}

fn rand_hex() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    let t = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let mut h = Sha1::new();
    h.update(format!("{t}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
    hex::encode(&h.finalize()[..4])
}

fn mtime_ms(m: &fs::Metadata) -> f64 {
    m.modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Move,
    Copy,
}

/// Überträgt EINE Datei an den exakten Zielpfad "dest" (der nicht existieren darf).
/// on_progress(done, total)
pub fn transfer_file(src: &Path, dest: &Path, mode: Mode, on_progress: &mut dyn FnMut(u64, u64)) -> FsResult<&'static str> {
    let src_meta = fs::metadata(src)?;
    if !src_meta.is_file() {
        return Err(FsError::new("ENOTFILE", format!("Keine Datei: {}", src.display())));
    }
    if exists(dest)? {
        return Err(FsError::new("EEXIST", "Ziel existiert bereits"));
    }
    let dest_dir = dest.parent().ok_or_else(|| FsError::new("EDESTDIR", "Zielordner fehlt"))?;
    if let Err(e) = fs::metadata(dest_dir) {
        return Err(FsError::new("EDESTDIR", "Zielordner nicht erreichbar").with_detail(io_code(&e)));
    }
    let size = src_meta.len();

    // Schneller Weg: gleiches Laufwerk -> Hardlink + Original entfernen.
    if mode == Mode::Move {
        match fs::hard_link(src, dest) {
            Ok(()) => {
                if let Err(e) = fs::remove_file(src) {
                    // Original ließ sich nicht entfernen -> Link wieder weg, damit keine doppelte Datei entsteht.
                    let _ = safe_unlink(dest);
                    return Err(FsError::new("ESRCREMOVE", "Original konnte nicht entfernt werden").with_detail(io_code(&e)));
                }
                on_progress(size, size);
                return Ok("link");
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                return Err(FsError::new("EEXIST", "Ziel existiert bereits"));
            }
            Err(_) => { /* anderes Laufwerk oder keine Hardlinks: Kopierweg */ }
        }
    }

    // Sicherer Kopierweg: kopieren -> prüfen -> umbenennen -> (Original löschen)
    let total = size * 2;
    let mut done = 0u64;
    let mut tick = |n: u64| {
        done += n;
        on_progress(done.min(total), total);
    };
    let tmp = dest_dir.join(format!(".{}{}{}", file_name(dest), TMP_MARK, rand_hex()));
    let atime = filetime::FileTime::from_last_access_time(&src_meta);
    let mtime = filetime::FileTime::from_last_modification_time(&src_meta);
    let res = (|| -> FsResult<()> {
        let src_hash = copy_with_hash(src, &tmp, &mut tick)?;
        let _ = filetime::set_file_times(&tmp, atime, mtime);
        let tmp_size = fs::metadata(&tmp)?.len();
        if tmp_size != size {
            return Err(FsError::new("EVERIFY", "Größe der Kopie stimmt nicht"));
        }
        let copy_hash = hash_file(&tmp, &mut tick)?;
        if copy_hash != src_hash {
            return Err(FsError::new("EVERIFY", "Prüfsumme der Kopie stimmt nicht"));
        }
        finalize_no_clobber(&tmp, dest)
    })();
    if let Err(e) = res {
        let _ = safe_unlink(&tmp);
        return Err(e);
    }

    // Manche Dateisysteme setzen beim Umbenennen die Zeit neu -> nochmals setzen.
    if let Ok(st) = fs::metadata(dest) {
        if (mtime_ms(&st) - mtime_ms(&src_meta)).abs() > 2000.0 {
            let _ = filetime::set_file_times(dest, atime, mtime);
        }
    }

    if mode == Mode::Move {
        let r = (|| -> FsResult<()> {
            // Wurde das Original während des Kopierens verändert? Dann nicht löschen.
            let now = fs::metadata(src)?;
            if now.len() != src_meta.len() || mtime_ms(&now) != mtime_ms(&src_meta) {
                return Err(FsError::new("ESRCCHANGED", "Original wurde während des Kopierens verändert"));
            }
            fs::remove_file(src).map_err(|e| FsError::new("ESRCREMOVE", "Original konnte nicht entfernt werden").with_detail(io_code(&e)))
        })();
        if let Err(e) = r {
            // Original bleibt -> geprüfte Kopie wieder entfernen, Zustand bleibt eindeutig.
            let _ = safe_unlink(dest);
            return Err(e);
        }
    }
    Ok("copy")
}

#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq)]
pub struct Move {
    pub from: PathBuf,
    pub to: PathBuf,
}

/// Überträgt eine Gruppe zusammengehöriger Dateien (Hauptdatei + Begleitdateien,
/// Live-Photo-Video) gemeinsam in einen Ordner. Alle bekommen denselben neuen
/// Namensstamm. Schlägt eine Datei fehl, werden bereits übertragene zurückgeholt.
///
/// `new_stem`: optional ein anderer Name für die Gruppe (Umbenennen beim Einsortieren).
pub fn transfer_group(
    files: &[PathBuf],
    dest_dir: &Path,
    mode: Mode,
    new_stem: Option<&str>,
    on_progress: &mut dyn FnMut(u64, u64),
    timeout: Duration,
) -> FsResult<Vec<Move>> {
    let reach = check_dir(&dest_dir.to_string_lossy(), timeout);
    if !reach.ok {
        return Err(FsError::new("EUNREACHABLE", format!("Zielordner nicht erreichbar: {}", dest_dir.display()))
            .with_detail(reach.code.unwrap_or_default()));
    }
    let primary = files.first().ok_or_else(|| FsError::new("ENOENT", "Keine Dateien"))?;
    let (stem, _) = split_name(&file_name(primary));
    let stem_lower = stem.to_lowercase();
    // Endungen relativ zum Namensstamm ("IMG_1" + ".JPG" / ".JPG.xmp"); abweichend benannte Begleitdateien: None
    let suffixes: Vec<Option<String>> = files
        .iter()
        .map(|f| {
            let base = file_name(f);
            if base.to_lowercase().starts_with(&stem_lower) && base.is_char_boundary(stem.len()) {
                Some(base[stem.len()..].to_string())
            } else {
                None
            }
        })
        .collect();
    let mut sizes = Vec::with_capacity(files.len());
    for f in files {
        sizes.push(fs::metadata(f)?.len());
    }
    let grand_total = sizes.iter().sum::<u64>().max(1);
    let wanted_stem = new_stem.map(|s| s.to_string()).unwrap_or_else(|| stem.clone());

    let mut start_at = 1;
    for _attempt in 0..50 {
        let sfx: Vec<String> = suffixes.iter().flatten().cloned().collect();
        let (stem_now, n) = unique_stem(dest_dir, &wanted_stem, &sfx, start_at)?;
        let mut plan: Vec<Move> = files
            .iter()
            .zip(&suffixes)
            .map(|(f, s)| Move {
                from: f.clone(),
                to: dest_dir.join(match s {
                    Some(s) => format!("{stem_now}{s}"),
                    None => file_name(f),
                }),
            })
            .collect();
        let mut done: Vec<Move> = Vec::new();
        let mut base = 0u64;
        let mut failure: Option<FsError> = None;
        for i in 0..plan.len() {
            if suffixes[i].is_none() && exists(&plan[i].to).unwrap_or(true) {
                // Abweichend benannte Begleitdatei: eigener freier Name
                let (st, ext) = split_name(&file_name(&plan[i].from));
                match unique_stem(dest_dir, &st, &[ext.clone()], 1) {
                    Ok((u, _)) => plan[i].to = dest_dir.join(format!("{u}{ext}")),
                    Err(e) => {
                        failure = Some(e);
                        break;
                    }
                }
            }
            let size_i = sizes[i];
            let b = base;
            let r = transfer_file(&plan[i].from, &plan[i].to, mode, &mut |d, t| {
                on_progress(b + ((d as f64 / t.max(1) as f64) * size_i as f64) as u64, grand_total)
            });
            match r {
                Ok(_) => {
                    base += size_i;
                    done.push(plan[i].clone());
                }
                Err(e) => {
                    failure = Some(e);
                    break;
                }
            }
        }
        match failure {
            None => {
                on_progress(grand_total, grand_total);
                return Ok(plan);
            }
            Some(e) => {
                // Bereits übertragene Dateien zurückholen
                for d in done.iter().rev() {
                    let _ = match mode {
                        Mode::Move => transfer_file(&d.to, &d.from, Mode::Move, &mut |_, _| {}).map(|_| ()),
                        Mode::Copy => safe_unlink(&d.to),
                    };
                }
                if e.code == "EEXIST" {
                    // Jemand hat den Namen zwischenzeitlich belegt -> nächster Versuch
                    start_at = n + 1;
                    continue;
                }
                return Err(e);
            }
        }
    }
    Err(FsError::new("ENAMES", "Kein freier Dateiname gefunden"))
}

/// Rückgängig machen einer Übertragung. Liefert die tatsächlich ausgeführten Rückwege.
pub fn revert_moves(moves: &[Move], mode: Mode) -> FsResult<Vec<Move>> {
    let mut restored = Vec::new();
    if mode == Mode::Copy {
        for m in moves {
            // Kopie nur entfernen, wenn das Original noch da ist.
            if !exists(&m.from)? {
                return Err(FsError::new("EORIGMISSING", "Original fehlt – Kopie wird nicht entfernt")
                    .with_detail(m.from.to_string_lossy()));
            }
            safe_unlink(&m.to)?;
            restored.push(Move { from: m.to.clone(), to: m.from.clone() });
        }
        return Ok(restored);
    }
    // Verschieben zurück: gemeinsam als Gruppe in den ursprünglichen Ordner,
    // möglichst unter dem ursprünglichen Namen.
    let mut by_dir: BTreeMap<PathBuf, Vec<&Move>> = BTreeMap::new();
    let mut order: Vec<PathBuf> = Vec::new();
    for m in moves {
        let d = m.from.parent().map(Path::to_path_buf).unwrap_or_default();
        if !by_dir.contains_key(&d) {
            order.push(d.clone());
        }
        by_dir.entry(d).or_default().push(m);
    }
    for dir in order {
        let list = &by_dir[&dir];
        let _ = fs::create_dir_all(&dir);
        let mut all_free = true;
        for m in list {
            if exists(&m.from)? {
                all_free = false;
            }
        }
        if all_free {
            let mut back: Vec<&Move> = Vec::new();
            for m in list {
                match transfer_file(&m.to, &m.from, Mode::Move, &mut |_, _| {}) {
                    Ok(_) => {
                        back.push(m);
                        restored.push(Move { from: m.to.clone(), to: m.from.clone() });
                    }
                    Err(e) => {
                        for b in back.iter().rev() {
                            let _ = transfer_file(&b.from, &b.to, Mode::Move, &mut |_, _| {});
                            restored.pop();
                        }
                        return Err(e);
                    }
                }
            }
        } else {
            let files: Vec<PathBuf> = list.iter().map(|m| m.to.clone()).collect();
            let plan = transfer_group(&files, &dir, Mode::Move, None, &mut |_, _| {}, DEFAULT_TIMEOUT)?;
            restored.extend(plan);
        }
    }
    Ok(restored)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("slimsort-test-{name}-{}", rand_hex()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn split_name_works() {
        assert_eq!(split_name("IMG_1.JPG"), ("IMG_1".into(), ".JPG".into()));
        assert_eq!(split_name(".hidden"), (".hidden".into(), "".into()));
        assert_eq!(split_name("a.b.c"), ("a.b".into(), ".c".into()));
        assert_eq!(split_name("noext"), ("noext".into(), "".into()));
    }

    #[test]
    fn move_never_overwrites_and_keeps_sidecars_together() {
        let src = tmpdir("src");
        let dst = tmpdir("dst");
        fs::write(src.join("IMG_1.JPG"), b"new photo").unwrap();
        fs::write(src.join("IMG_1.xmp"), b"sidecar").unwrap();
        fs::write(dst.join("IMG_1.JPG"), b"old photo").unwrap();
        let files = vec![src.join("IMG_1.JPG"), src.join("IMG_1.xmp")];
        let plan = transfer_group(&files, &dst, Mode::Move, None, &mut |_, _| {}, DEFAULT_TIMEOUT).unwrap();
        assert_eq!(plan[0].to, dst.join("IMG_1 (2).JPG"));
        assert_eq!(plan[1].to, dst.join("IMG_1 (2).xmp"));
        assert_eq!(fs::read(dst.join("IMG_1.JPG")).unwrap(), b"old photo");
        assert_eq!(fs::read(dst.join("IMG_1 (2).JPG")).unwrap(), b"new photo");
        assert!(!src.join("IMG_1.JPG").exists());
        // Rückgängig: zurück unter dem alten Namen
        let back = revert_moves(&plan, Mode::Move).unwrap();
        assert_eq!(back.len(), 2);
        assert_eq!(fs::read(src.join("IMG_1.JPG")).unwrap(), b"new photo");
        assert!(src.join("IMG_1.xmp").exists());
        assert!(!dst.join("IMG_1 (2).JPG").exists());
    }

    #[test]
    fn copy_verifies_and_keeps_mtime() {
        let src = tmpdir("csrc");
        let dst = tmpdir("cdst");
        let f = src.join("a.jpg");
        fs::write(&f, vec![7u8; 3 * CHUNK + 17]).unwrap();
        let old = filetime::FileTime::from_unix_time(1_600_000_000, 0);
        filetime::set_file_mtime(&f, old).unwrap();
        let plan = transfer_group(&[f.clone()], &dst, Mode::Copy, None, &mut |_, _| {}, DEFAULT_TIMEOUT).unwrap();
        let m = fs::metadata(&plan[0].to).unwrap();
        assert_eq!(filetime::FileTime::from_last_modification_time(&m).unix_seconds(), 1_600_000_000);
        assert!(f.exists());
        revert_moves(&plan, Mode::Copy).unwrap();
        assert!(!plan[0].to.exists());
        assert!(f.exists());
    }

    #[test]
    fn rename_on_transfer() {
        let src = tmpdir("rsrc");
        let dst = tmpdir("rdst");
        fs::write(src.join("IMG_9.JPG"), b"x").unwrap();
        fs::write(src.join("IMG_9.JPG.xmp"), b"y").unwrap();
        let files = vec![src.join("IMG_9.JPG"), src.join("IMG_9.JPG.xmp")];
        let plan = transfer_group(&files, &dst, Mode::Move, Some("2025-08-03 09-39-00"), &mut |_, _| {}, DEFAULT_TIMEOUT).unwrap();
        assert_eq!(plan[0].to, dst.join("2025-08-03 09-39-00.JPG"));
        assert_eq!(plan[1].to, dst.join("2025-08-03 09-39-00.JPG.xmp"));
    }

    #[test]
    fn unreachable_target_leaves_original() {
        let src = tmpdir("usrc");
        fs::write(src.join("b.jpg"), b"x").unwrap();
        let r = transfer_group(&[src.join("b.jpg")], Path::new("/nonexistent/slimsort"), Mode::Move, None, &mut |_, _| {}, DEFAULT_TIMEOUT);
        assert_eq!(r.unwrap_err().code, "EUNREACHABLE");
        assert!(src.join("b.jpg").exists());
    }
}
