//! Eine Sortier-Sitzung: kennt alle Einträge, führt Aufträge der Reihe nach
//! aus (Warteschlange) und merkt sich alles für "Rückgängig".
//!
//! Die Rust-Seite ist die einzige Quelle der Wahrheit dafür, wo eine Datei
//! gerade liegt. Die Oberfläche spricht nur über Eintrags-IDs.

use crate::fsops::{self, check_dir, revert_moves, transfer_group, FsError, Mode, Move};
use crate::scanner::{self, ScanItem};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

pub type Emit = Arc<dyn Fn(&str, Value) + Send + Sync>;

/// Zähler über alle Sitzungen (fürs Beenden: erst wenn alles übertragen ist).
#[derive(Default)]
pub struct Counters {
    pub pending: AtomicI64,
    pub pending_bytes: AtomicI64,
    /// Nummer der aktuellen Sitzung – ältere melden nichts mehr an die Oberfläche
    pub current: AtomicU64,
}

#[derive(Debug, Clone)]
struct SItem {
    id: u64,
    primary: PathBuf,
    sidecars: Vec<PathBuf>,
    live: Option<PathBuf>,
    size: u64,
    trash_dir: PathBuf,
}

impl SItem {
    fn relocate(&mut self, from: &Path, to: &Path) {
        if self.primary == from {
            self.primary = to.to_path_buf();
        } else if self.live.as_deref() == Some(from) {
            self.live = Some(to.to_path_buf());
        } else if let Some(s) = self.sidecars.iter_mut().find(|s| s.as_path() == from) {
            *s = to.to_path_buf();
        }
    }
}

#[derive(Debug, Clone)]
struct MoveGroup {
    moves: Vec<Move>,
    mode: Mode,
}

#[derive(Debug, Clone)]
struct Entry {
    item_id: u64,
    groups: Vec<MoveGroup>,
}

#[derive(Debug, Clone)]
struct Hist {
    entries: Vec<Entry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferOp {
    pub op_id: u64,
    pub item_ids: Vec<u64>,
    pub dest_dir: Option<String>,
    pub action: String,
    #[serde(default = "default_live")]
    pub live_video: String,
    /// v2: Unterordner je Eintrag (z. B. "2025/08") – relativ zum Zielordner
    #[serde(default)]
    pub subdirs: HashMap<u64, String>,
    /// v2: neuer Dateiname (ohne Endung) je Eintrag
    #[serde(default)]
    pub names: HashMap<u64, String>,
}

fn default_live() -> String {
    "move".into()
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpResult {
    pub id: u64,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<PathBuf>,
    /// Nur bei Rückgängig gesetzt (null = kein Live-Video)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub live: Option<Option<PathBuf>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmptyResult {
    pub removed: u64,
    pub pruned: Vec<u64>,
    /// Dateien, die nicht in den System-Papierkorb konnten (z. B. Netzlaufwerk) – sie bleiben liegen
    pub kept: u64,
}

enum Job {
    Transfer(TransferOp),
    Undo(u64),
    EmptyTrash(bool, mpsc::Sender<Result<EmptyResult, FsError>>),
}

struct Inner {
    items: HashMap<u64, SItem>,
    history: HashMap<u64, Hist>,
    trash_dirs: Vec<PathBuf>,
}

pub struct Session {
    inner: Arc<Mutex<Inner>>,
    tx: mpsc::Sender<(Job, i64)>,
    counters: Arc<Counters>,
    pub trash_dir: Option<PathBuf>,
}

fn journal(path: &Option<PathBuf>, mut entry: Value) {
    let Some(p) = path else { return };
    if let Value::Object(m) = &mut entry {
        m.insert("t".into(), Value::String(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)));
    }
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(p) {
        let _ = writeln!(f, "{entry}");
    }
}

impl Session {
    pub fn new(journal_path: Option<PathBuf>, counters: Arc<Counters>, emit: Emit) -> Session {
        let gen = counters.current.fetch_add(1, Ordering::SeqCst) + 1;
        let inner = Arc::new(Mutex::new(Inner { items: HashMap::new(), history: HashMap::new(), trash_dirs: vec![] }));
        let (tx, rx) = mpsc::channel::<(Job, i64)>();
        let w = Worker { inner: inner.clone(), counters: counters.clone(), emit, gen, journal: journal_path, timeout: fsops::DEFAULT_TIMEOUT };
        std::thread::Builder::new()
            .name("session".into())
            .spawn(move || {
                for (job, bytes) in rx {
                    w.run(job);
                    w.counters.pending_bytes.fetch_sub(bytes, Ordering::SeqCst);
                    if w.counters.pending.fetch_sub(1, Ordering::SeqCst) == 1 {
                        (w.emit)("op:idle", Value::Null);
                    }
                }
            })
            .expect("Sitzungs-Thread");
        Session { inner, tx, counters, trash_dir: None }
    }

    /// Öffnet einen oder mehrere Quellordner. Gelöschte Dateien kommen in den eigenen
    /// Ordner (trash_dir) oder in "_Gelöscht" im jeweiligen Quellordner.
    pub fn open(&mut self, dirs: &[PathBuf], recursive: bool, trash_dir: Option<PathBuf>, on_progress: impl Fn(usize)) -> std::io::Result<Vec<ScanItem>> {
        let trash_for = |d: &Path| trash_dir.clone().unwrap_or_else(|| d.join("_Gelöscht"));
        let mut trash_dirs: Vec<PathBuf> = Vec::new();
        for d in dirs {
            let t = trash_for(d);
            if !trash_dirs.contains(&t) {
                trash_dirs.push(t);
            }
        }
        self.trash_dir = trash_dirs.first().cloned();
        let mut out = Vec::new();
        let mut items = HashMap::new();
        let mut next_id = 1u64;
        let mut found = 0usize;
        for dir in dirs {
            let list = scanner::scan(dir, recursive, &trash_dirs, |n| on_progress(found + n))?;
            found += list.len();
            let prefix = if dirs.len() > 1 { fsops::file_name(dir) } else { String::new() };
            for mut it in list {
                it.id = next_id;
                next_id += 1;
                items.insert(
                    it.id,
                    SItem { id: it.id, primary: it.path.clone(), sidecars: it.sidecars.clone(), live: it.live.clone(), size: it.size + it.live_size, trash_dir: trash_for(dir) },
                );
                if !prefix.is_empty() {
                    it.dir = if it.dir.is_empty() { prefix.clone() } else { Path::new(&prefix).join(&it.dir).to_string_lossy().into_owned() };
                }
                out.push(it);
            }
        }
        let mut g = self.inner.lock().unwrap();
        g.items = items;
        g.history.clear();
        g.trash_dirs = trash_dirs;
        Ok(out)
    }

    fn enqueue(&self, job: Job, bytes: i64) {
        self.counters.pending.fetch_add(1, Ordering::SeqCst);
        self.counters.pending_bytes.fetch_add(bytes, Ordering::SeqCst);
        if self.tx.send((job, bytes)).is_err() {
            self.counters.pending.fetch_sub(1, Ordering::SeqCst);
            self.counters.pending_bytes.fetch_sub(bytes, Ordering::SeqCst);
        }
    }

    pub fn transfer(&self, op: TransferOp) {
        let bytes: u64 = {
            let g = self.inner.lock().unwrap();
            op.item_ids.iter().filter_map(|id| g.items.get(id)).map(|it| it.size).sum()
        };
        self.enqueue(Job::Transfer(op), bytes as i64);
    }

    pub fn undo(&self, op_id: u64) {
        self.enqueue(Job::Undo(op_id), 0);
    }

    pub fn empty_trash(&self, to_system_trash: bool) -> Result<EmptyResult, FsError> {
        let (tx, rx) = mpsc::channel();
        self.enqueue(Job::EmptyTrash(to_system_trash, tx), 0);
        rx.recv().map_err(|_| FsError::new("EIO", "abgebrochen"))?
    }

    pub fn trash_dirs(&self) -> Vec<PathBuf> {
        self.inner.lock().unwrap().trash_dirs.clone()
    }
}

/// Inhalt der Löschordner zählen.
pub fn trash_info(dirs: &[PathBuf]) -> Value {
    fn walk(dir: &Path, count: &mut u64, bytes: &mut u64) {
        let Ok(ents) = fs::read_dir(dir) else { return };
        for e in ents.flatten() {
            let p = e.path();
            match e.file_type() {
                Ok(t) if t.is_dir() => walk(&p, count, bytes),
                Ok(_) => {
                    *count += 1;
                    *bytes += fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                }
                Err(_) => {}
            }
        }
    }
    let (mut count, mut bytes) = (0u64, 0u64);
    for d in dirs {
        walk(d, &mut count, &mut bytes);
    }
    json!({ "dir": dirs.first(), "dirs": dirs, "count": count, "bytes": bytes })
}

struct Worker {
    inner: Arc<Mutex<Inner>>,
    counters: Arc<Counters>,
    emit: Emit,
    gen: u64,
    journal: Option<PathBuf>,
    timeout: Duration,
}

impl Worker {
    fn live(&self) -> bool {
        self.counters.current.load(Ordering::SeqCst) == self.gen
    }

    fn send(&self, ev: &str, v: Value) {
        if self.live() {
            (self.emit)(ev, v);
        }
    }

    fn run(&self, job: Job) {
        match job {
            Job::Transfer(op) => self.transfer(op),
            Job::Undo(id) => self.undo(id),
            Job::EmptyTrash(sys, reply) => {
                let _ = reply.send(self.empty_trash(sys));
            }
        }
    }

    fn transfer(&self, op: TransferOp) {
        let items: Vec<SItem> = {
            let g = self.inner.lock().unwrap();
            op.item_ids.iter().filter_map(|id| g.items.get(id).cloned()).collect()
        };
        let trash = op.action == "trash";
        let mode = if op.action == "copy" { Mode::Copy } else { Mode::Move };
        let dest = op.dest_dir.clone().map(PathBuf::from);
        let mut reach_cache: HashMap<PathBuf, fsops::DirCheck> = HashMap::new();
        let mut reachable = |dir: &Path, create: bool| -> fsops::DirCheck {
            if let Some(r) = reach_cache.get(dir) {
                return r.clone();
            }
            if create {
                let d = dir.to_path_buf();
                let _ = fsops::with_timeout(self.timeout, "mkdir", move || fs::create_dir_all(d));
            }
            let r = check_dir(&dir.to_string_lossy(), self.timeout);
            reach_cache.insert(dir.to_path_buf(), r.clone());
            r
        };
        let mut results = Vec::new();
        let mut entries = Vec::new();
        let mut bytes_done = 0u64;
        let mut last_target: Option<PathBuf> = dest.clone();
        let mut last_emit = Instant::now() - Duration::from_secs(1);
        for it in &items {
            let base = if trash { Some(it.trash_dir.clone()) } else { dest.clone() };
            let Some(base) = base else {
                results.push(OpResult { id: it.id, ok: false, error: Some("ENOPATH".into()), ..Default::default() });
                continue;
            };
            last_target = Some(base.clone());
            let reach = reachable(&base, trash);
            if !reach.ok {
                results.push(OpResult { id: it.id, ok: false, error: Some("EUNREACHABLE".into()), detail: reach.code, ..Default::default() });
                continue;
            }
            // v2: Unterordner (z. B. nach Datum) – nur relative, saubere Teile zulassen
            let target = match op.subdirs.get(&it.id).filter(|_| !trash).map(|s| clean_subdir(s)) {
                Some(sub) if !sub.as_os_str().is_empty() => {
                    let t = base.join(sub);
                    if let Err(e) = fs::create_dir_all(&t) {
                        results.push(OpResult { id: it.id, ok: false, error: Some(fsops::io_code(&e)), detail: Some(e.to_string()), ..Default::default() });
                        continue;
                    }
                    t
                }
                _ => base.clone(),
            };
            let new_stem = op.names.get(&it.id).filter(|_| !trash).map(|s| clean_stem(s)).filter(|s| !s.is_empty());
            let mut files = vec![it.primary.clone()];
            files.extend(it.sidecars.iter().cloned());
            let mut live_to_trash = false;
            if let Some(l) = &it.live {
                if trash || op.live_video == "move" {
                    files.push(l.clone());
                } else if op.live_video == "trash" && mode == Mode::Move {
                    live_to_trash = true;
                }
            }
            let name = fsops::file_name(&it.primary);
            let mut groups: Vec<MoveGroup> = Vec::new();
            let pend = self.counters.pending.load(Ordering::SeqCst);
            let pend_b = self.counters.pending_bytes.load(Ordering::SeqCst);
            let r = (|| -> Result<PathBuf, FsError> {
                let plan = transfer_group(
                    &files,
                    &target,
                    mode,
                    new_stem.as_deref(),
                    &mut |d, t| {
                        if last_emit.elapsed() >= Duration::from_millis(80) || d >= t {
                            last_emit = Instant::now();
                            self.send(
                                "op:progress",
                                json!({ "opId": op.op_id, "name": name, "fileDone": d, "fileTotal": t, "bytesDone": bytes_done + d, "pending": pend, "pendingBytes": pend_b }),
                            );
                        }
                    },
                    self.timeout,
                )?;
                let to = plan[0].to.clone();
                groups.push(MoveGroup { moves: plan, mode });
                if live_to_trash {
                    let td = it.trash_dir.clone();
                    fs::create_dir_all(&td)?;
                    let p2 = transfer_group(&[it.live.clone().unwrap()], &td, Mode::Move, None, &mut |_, _| {}, self.timeout)?;
                    groups.push(MoveGroup { moves: p2, mode: Mode::Move });
                }
                Ok(to)
            })();
            match r {
                Ok(to) => {
                    {
                        let mut g = self.inner.lock().unwrap();
                        if let Some(si) = g.items.get_mut(&it.id) {
                            for gr in &groups {
                                if gr.mode == Mode::Move {
                                    for m in &gr.moves {
                                        si.relocate(&m.from, &m.to);
                                    }
                                }
                            }
                        }
                    }
                    let moves: Vec<&Move> = groups.iter().flat_map(|g| g.moves.iter()).collect();
                    journal(&self.journal, json!({ "op": op.action, "opId": op.op_id, "moves": moves }));
                    entries.push(Entry { item_id: it.id, groups });
                    bytes_done += it.size;
                    results.push(OpResult { id: it.id, ok: true, to: Some(to), ..Default::default() });
                }
                Err(e) => {
                    // Teilweise erledigte Gruppen (nur möglich beim Live-Video) zurückdrehen
                    for g in groups.iter().rev() {
                        let _ = revert_moves(&g.moves, g.mode);
                    }
                    journal(&self.journal, json!({ "op": op.action, "opId": op.op_id, "error": e.code, "file": it.primary }));
                    results.push(OpResult { id: it.id, ok: false, error: Some(e.code.clone()), detail: Some(e.detail.clone().unwrap_or(e.message.clone())), ..Default::default() });
                }
            }
        }
        if !entries.is_empty() {
            self.inner.lock().unwrap().history.insert(op.op_id, Hist { entries });
        }
        self.send("op:done", json!({ "opId": op.op_id, "kind": "transfer", "results": results, "destDir": last_target }));
    }

    fn undo(&self, op_id: u64) {
        let h = self.inner.lock().unwrap().history.get(&op_id).cloned();
        let Some(h) = h else {
            self.send("op:done", json!({ "opId": op_id, "kind": "undo", "results": [], "missing": true }));
            return;
        };
        let mut results = Vec::new();
        let mut failed = Vec::new();
        for entry in h.entries.iter().rev() {
            let r = (|| -> Result<(), FsError> {
                for g in entry.groups.iter().rev() {
                    let restored = revert_moves(&g.moves, g.mode)?;
                    if g.mode == Mode::Move {
                        let mut gi = self.inner.lock().unwrap();
                        if let Some(it) = gi.items.get_mut(&entry.item_id) {
                            for m in &restored {
                                it.relocate(&m.from, &m.to);
                            }
                        }
                    }
                }
                Ok(())
            })();
            let it = self.inner.lock().unwrap().items.get(&entry.item_id).cloned();
            match (r, it) {
                (Ok(()), Some(it)) => {
                    journal(&self.journal, json!({ "op": "undo", "opId": op_id, "item": it.primary }));
                    results.push(OpResult { id: it.id, ok: true, path: Some(it.primary.clone()), live: Some(it.live.clone()), ..Default::default() });
                }
                (Err(e), _) => {
                    failed.push(entry.clone());
                    results.push(OpResult { id: entry.item_id, ok: false, error: Some(e.code), detail: Some(e.message), ..Default::default() });
                }
                (Ok(()), None) => {}
            }
        }
        {
            let mut g = self.inner.lock().unwrap();
            if failed.is_empty() {
                g.history.remove(&op_id);
            } else {
                g.history.insert(op_id, Hist { entries: failed });
            }
        }
        self.send("op:done", json!({ "opId": op_id, "kind": "undo", "results": results }));
    }

    /// Löschordner leeren. to_system_trash: Dateien in den Papierkorb des Systems
    /// (wiederherstellbar) statt endgültig löschen.
    fn empty_trash(&self, to_system_trash: bool) -> Result<EmptyResult, FsError> {
        let trashes = self.inner.lock().unwrap().trash_dirs.clone();
        if trashes.is_empty() {
            return Err(FsError::new("NOTRASH", "Kein Löschordner"));
        }
        let mut removed = 0u64;
        let mut kept = 0u64;
        fn files_in(dir: &Path, out: &mut Vec<PathBuf>, dirs: &mut Vec<PathBuf>) {
            let Ok(ents) = fs::read_dir(dir) else { return };
            for e in ents.flatten() {
                let p = e.path();
                if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    files_in(&p, out, dirs);
                    dirs.push(p);
                } else {
                    out.push(p);
                }
            }
        }
        for trash in &trashes {
            let mut files = Vec::new();
            let mut dirs = Vec::new();
            files_in(trash, &mut files, &mut dirs);
            if to_system_trash && !files.is_empty() {
                let ctx = system_trash();
                for f in &files {
                    match ctx.delete(f) {
                        Ok(()) => removed += 1,
                        Err(_) => kept += 1,
                    }
                }
            } else {
                for f in &files {
                    fsops::safe_unlink(f)?;
                    removed += 1;
                }
            }
            for d in dirs {
                let _ = fs::remove_dir(d);
            }
        }
        // Rückgängig-Einträge, die in den Löschordner zeigen, sind nun ungültig.
        let mut pruned = Vec::new();
        {
            let mut g = self.inner.lock().unwrap();
            let in_trash = |p: &Path| trashes.iter().any(|t| p.starts_with(t));
            let ids: Vec<u64> = g
                .history
                .iter()
                .filter(|(_, h)| h.entries.iter().any(|e| e.groups.iter().any(|gr| gr.moves.iter().any(|m| in_trash(&m.to)))))
                .map(|(k, _)| *k)
                .collect();
            for id in ids {
                g.history.remove(&id);
                pruned.push(id);
            }
        }
        journal(&self.journal, json!({ "op": "emptyTrash", "dirs": trashes, "removed": removed, "kept": kept, "systemTrash": to_system_trash }));
        Ok(EmptyResult { removed, pruned, kept })
    }
}

pub fn system_trash() -> trash::TrashContext {
    #[allow(unused_mut)]
    let mut ctx = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        // Ohne Finder-Fernsteuerung: keine Rückfrage, schneller
        ctx.set_delete_method(DeleteMethod::NsFileManager);
    }
    ctx
}

/// "2025/08" -> 2025/08 (nur normale Ordnernamen, kein "..", kein absoluter Pfad)
pub fn clean_subdir(s: &str) -> PathBuf {
    let mut p = PathBuf::new();
    for part in s.split(['/', '\\']) {
        let c = clean_stem(part);
        if !c.is_empty() && c != "." && c != ".." {
            p.push(c);
        }
    }
    p
}

/// Zeichen entfernen, die in Dateinamen nicht erlaubt sind.
pub fn clean_stem(s: &str) -> String {
    let c: String = s.chars().filter(|c| !matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') && !c.is_control()).collect();
    c.trim().trim_start_matches('.').trim_end_matches(['.', ' ']).to_string()
}

#[allow(dead_code)]
pub fn unique_ids(ids: &[u64]) -> Vec<u64> {
    let mut seen = HashSet::new();
    ids.iter().copied().filter(|x| seen.insert(*x)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as M;

    fn setup(name: &str) -> (PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!("slimsort-ses-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let src = base.join("src");
        let dst = base.join("Family");
        fs::create_dir_all(&src).unwrap();
        fs::create_dir_all(&dst).unwrap();
        for f in ["a.jpg", "b.jpg", "c.jpg"] {
            fs::write(src.join(f), f.as_bytes()).unwrap();
        }
        (src, dst)
    }

    fn collect() -> (Emit, Arc<M<Vec<(String, Value)>>>) {
        let log = Arc::new(M::new(Vec::new()));
        let l2 = log.clone();
        (Arc::new(move |ev: &str, v: Value| l2.lock().unwrap().push((ev.to_string(), v))), log)
    }

    fn wait_idle(c: &Counters) {
        for _ in 0..500 {
            if c.pending.load(Ordering::SeqCst) == 0 {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("nicht fertig");
    }

    #[test]
    fn transfer_trash_undo_and_empty() {
        let (src, dst) = setup("all");
        let counters = Arc::new(Counters::default());
        let (emit, log) = collect();
        let mut s = Session::new(None, counters.clone(), emit);
        let mut items = s.open(&[src.clone()], false, None, |_| {}).unwrap();
        items.sort_by(|a, b| a.name.cmp(&b.name));
        let id = |n: &str| items.iter().find(|x| x.name == n).unwrap().id;
        let mut subdirs = HashMap::new();
        subdirs.insert(id("a.jpg"), "2025/08".to_string());
        s.transfer(TransferOp { op_id: 1, item_ids: vec![id("a.jpg")], dest_dir: Some(dst.to_string_lossy().into()), action: "move".into(), live_video: "move".into(), subdirs, names: HashMap::new() });
        s.transfer(TransferOp { op_id: 2, item_ids: vec![id("b.jpg")], dest_dir: None, action: "trash".into(), live_video: "move".into(), subdirs: HashMap::new(), names: HashMap::new() });
        wait_idle(&counters);
        assert!(dst.join("2025/08/a.jpg").exists());
        assert!(src.join("_Gelöscht/b.jpg").exists());
        s.undo(1);
        wait_idle(&counters);
        assert!(src.join("a.jpg").exists());
        let r = s.empty_trash(false).unwrap();
        assert_eq!(r.removed, 1);
        assert_eq!(r.pruned, vec![2]);
        assert!(!src.join("_Gelöscht/b.jpg").exists());
        let evs: Vec<String> = log.lock().unwrap().iter().map(|(e, _)| e.clone()).collect();
        assert!(evs.contains(&"op:done".to_string()));
        assert!(evs.contains(&"op:idle".to_string()));
    }

    #[test]
    fn unreachable_reports_error() {
        let (src, _dst) = setup("unreach");
        let counters = Arc::new(Counters::default());
        let (emit, log) = collect();
        let mut s = Session::new(None, counters.clone(), emit);
        let items = s.open(&[src.clone()], false, None, |_| {}).unwrap();
        s.transfer(TransferOp { op_id: 7, item_ids: vec![items[0].id], dest_dir: Some("/nonexistent/x".into()), action: "move".into(), live_video: "move".into(), subdirs: HashMap::new(), names: HashMap::new() });
        wait_idle(&counters);
        let l = log.lock().unwrap();
        let done = l.iter().find(|(e, _)| e == "op:done").unwrap();
        assert_eq!(done.1["results"][0]["error"], "EUNREACHABLE");
        assert!(items[0].path.exists());
    }

    #[test]
    fn subdir_cleaning() {
        assert_eq!(clean_subdir("2025/08"), PathBuf::from("2025").join("08"));
        assert_eq!(clean_subdir("../../etc"), PathBuf::from("etc"));
        assert_eq!(clean_stem(" a:b?.  "), "ab");
    }
}
