//! Durchsucht einen Quellordner nach Fotos und Videos und fasst zusammen-
//! gehörige Dateien zu einem "Eintrag" zusammen:
//!   - Begleitdateien (.xmp, .aae, .thm) mit gleichem Namen
//!   - Live Photos: Foto + gleichnamiges kurzes Video

use crate::fsops::{split_name, TMP_MARK};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

pub const IMAGE_EXT: &[&str] = &[
    ".jpg", ".jpeg", ".jpe", ".png", ".gif", ".webp", ".heic", ".heif", ".avif", ".bmp", ".tif", ".tiff", ".dng", ".cr2",
    ".cr3", ".nef", ".nrw", ".arw", ".raf", ".orf", ".rw2", ".pef", ".srw",
];
pub const VIDEO_EXT: &[&str] = &[".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm", ".3gp", ".mts", ".m2ts", ".wmv", ".mpg", ".mpeg"];
pub const SIDECAR_EXT: &[&str] = &[".xmp", ".aae", ".thm"];
/// Formate, die die eingebaute Webansicht direkt anzeigen kann.
pub const BROWSER_IMAGE_EXT: &[&str] = &[".jpg", ".jpeg", ".jpe", ".png", ".gif", ".webp", ".bmp"];
const LIVE_IMAGE_EXT: &[&str] = &[".heic", ".heif", ".jpg", ".jpeg"];
const LIVE_VIDEO_EXT: &[&str] = &[".mov", ".mp4"];
/// Live-Photo-Videos sind kurz (ca. 3 s) und daher klein.
const LIVE_VIDEO_MAX_BYTES: u64 = 25 * 1024 * 1024;
const RAW_EXT: &[&str] = &[".dng", ".cr2", ".cr3", ".nef", ".nrw", ".arw", ".raf", ".orf", ".rw2", ".pef", ".srw"];

/// Ordner, die nie durchsucht werden (System- und NAS-Hilfsordner).
const SKIP_DIRS: &[&str] = &[
    "@eadir", ".@__thumb", "@recycle", "#recycle", "$recycle.bin", "system volume information", ".trashes",
    ".spotlight-v100", ".fseventsd", "@recently-snapshot", ".thumbnails", "node_modules",
];

pub fn is_skip_dir(lower: &str) -> bool {
    SKIP_DIRS.contains(&lower)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Image,
    Video,
    Sidecar,
}

pub fn ext_of(name: &str) -> String {
    split_name(name).1.to_lowercase()
}

pub fn kind_of(ext: &str) -> Option<Kind> {
    let e = ext.to_lowercase();
    let e = e.as_str();
    if IMAGE_EXT.contains(&e) {
        Some(Kind::Image)
    } else if VIDEO_EXT.contains(&e) {
        Some(Kind::Video)
    } else if SIDECAR_EXT.contains(&e) {
        Some(Kind::Sidecar)
    } else {
        None
    }
}

/// Schlüssel für die Gruppierung: "IMG_1.JPG.xmp" und "IMG_1.xmp" -> "img_1"
pub fn base_key(name: &str) -> String {
    let mut n = name.to_string();
    for _ in 0..2 {
        let (stem, ext) = split_name(&n);
        if ext.is_empty() || kind_of(&ext).is_none() {
            break;
        }
        n = stem;
    }
    n.to_lowercase()
}

pub fn same_path(a: &Path, b: &Path) -> bool {
    if cfg!(target_os = "linux") {
        a == b
    } else {
        a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanItem {
    pub id: u64,
    pub path: PathBuf,
    pub dir: String,
    pub name: String,
    pub ext: String,
    pub kind: Kind,
    pub size: u64,
    pub mtime: f64,
    pub sidecars: Vec<PathBuf>,
    pub live: Option<PathBuf>,
    pub live_size: u64,
}

struct F {
    name: String,
    full: PathBuf,
    kind: Kind,
    size: u64,
    mtime: f64,
    sidecars: Vec<PathBuf>,
    live: Option<usize>,
}

fn mtime_ms(m: &fs::Metadata) -> f64 {
    m.modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// Liefert Einträge (ohne ID – die vergibt die Sitzung).
pub fn scan(source: &Path, recursive: bool, exclude: &[PathBuf], mut on_progress: impl FnMut(usize)) -> std::io::Result<Vec<ScanItem>> {
    let mut groups: Vec<(PathBuf, Vec<F>)> = Vec::new();
    let mut queue = std::collections::VecDeque::from([source.to_path_buf()]);
    let mut found = 0usize;
    while let Some(dir) = queue.pop_front() {
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(e) => {
                if dir == source {
                    return Err(e);
                }
                continue; // Unterordner ohne Zugriff überspringen
            }
        };
        let mut files = Vec::new();
        for ent in entries.flatten() {
            let name = ent.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || name.contains(TMP_MARK) {
                continue;
            }
            let full = ent.path();
            let ft = match ent.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            // Verknüpfungen wie unter Node: Ordner-Links nicht folgen, Datei-Links aufnehmen
            if ft.is_dir() {
                if !recursive || is_skip_dir(&name.to_lowercase()) || exclude.iter().any(|x| same_path(x, &full)) {
                    continue;
                }
                queue.push_back(full);
            } else if ft.is_file() || ft.is_symlink() {
                if let Some(kind) = kind_of(&ext_of(&name)) {
                    files.push(F { name, full, kind, size: 0, mtime: 0.0, sidecars: vec![], live: None });
                }
            }
        }
        if !files.is_empty() {
            found += files.len();
            on_progress(found);
            groups.push((dir, files));
        }
    }

    let mut items = Vec::new();
    for (dir, mut files) in groups {
        // Größe und Datum lesen (fehlende Dateien fallen weg)
        files.retain_mut(|f| match fs::metadata(&f.full) {
            Ok(m) if m.is_file() => {
                f.size = m.len();
                f.mtime = mtime_ms(&m);
                true
            }
            _ => false,
        });
        let mut by_key: HashMap<String, Vec<usize>> = HashMap::new();
        let mut key_order: Vec<String> = Vec::new();
        for (i, f) in files.iter().enumerate() {
            let k = base_key(&f.name);
            if !by_key.contains_key(&k) {
                key_order.push(k.clone());
            }
            by_key.entry(k).or_default().push(i);
        }
        let rel_dir = dir.strip_prefix(source).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        for k in key_order {
            let list = &by_key[&k];
            let images: Vec<usize> = list.iter().copied().filter(|&i| files[i].kind == Kind::Image).collect();
            let videos: Vec<usize> = list.iter().copied().filter(|&i| files[i].kind == Kind::Video).collect();
            let sidecars: Vec<usize> = list.iter().copied().filter(|&i| files[i].kind == Kind::Sidecar).collect();
            let mut live_used: Option<usize> = None;
            if !images.is_empty() && videos.len() == 1 {
                let v = videos[0];
                if let Some(&img) = images.iter().find(|&&i| LIVE_IMAGE_EXT.contains(&ext_of(&files[i].name).as_str())) {
                    if LIVE_VIDEO_EXT.contains(&ext_of(&files[v].name).as_str()) && files[v].size <= LIVE_VIDEO_MAX_BYTES {
                        live_used = Some(v);
                        files[img].live = Some(v);
                    }
                }
            }
            let mut entries: Vec<usize> = images.clone();
            entries.extend(videos.iter().copied().filter(|&v| Some(v) != live_used));
            if entries.is_empty() {
                continue; // nur Begleitdateien -> ignorieren
            }
            // Begleitdateien zuordnen: exakter Name ("x.jpg.xmp") zuerst, sonst RAW-Datei, sonst erste Datei.
            for &s in &sidecars {
                let inner = split_name(&files[s].name).0.to_lowercase();
                let owner = entries
                    .iter()
                    .copied()
                    .find(|&e| files[e].name.to_lowercase() == inner)
                    .or_else(|| entries.iter().copied().find(|&e| RAW_EXT.contains(&ext_of(&files[e].name).as_str())))
                    .unwrap_or(entries[0]);
                let p = files[s].full.clone();
                files[owner].sidecars.push(p);
            }
            for &e in &entries {
                let f = &files[e];
                let (live, live_size) = match f.live {
                    Some(v) => (Some(files[v].full.clone()), files[v].size),
                    None => (None, 0),
                };
                items.push(ScanItem {
                    id: 0,
                    path: f.full.clone(),
                    dir: rel_dir.clone(),
                    name: f.name.clone(),
                    ext: ext_of(&f.name),
                    kind: f.kind,
                    size: f.size,
                    mtime: f.mtime,
                    sidecars: f.sidecars.clone(),
                    live,
                    live_size,
                });
            }
        }
    }
    Ok(items)
}

pub fn is_browser_image(ext: &str) -> bool {
    BROWSER_IMAGE_EXT.contains(&ext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_sidecars_and_live_photos() {
        let d = std::env::temp_dir().join(format!("slimsort-scan-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("sub")).unwrap();
        for f in ["IMG_1.HEIC", "IMG_1.MOV", "IMG_1.AAE", "IMG_2.JPG", "IMG_2.JPG.xmp", "notes.txt", ".hidden.jpg", "x.jpg.fstmp-ab12"] {
            fs::write(d.join(f), b"x").unwrap();
        }
        fs::write(d.join("sub/IMG_3.jpg"), b"x").unwrap();
        let mut it = scan(&d, false, &[], |_| {}).unwrap();
        it.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(it.len(), 2);
        assert_eq!(it[0].name, "IMG_1.HEIC");
        assert!(it[0].live.as_ref().unwrap().ends_with("IMG_1.MOV"));
        assert_eq!(it[0].sidecars.len(), 1);
        assert_eq!(it[1].sidecars.len(), 1);
        let all = scan(&d, true, &[], |_| {}).unwrap();
        assert_eq!(all.len(), 3);
        assert!(all.iter().any(|x| x.dir == "sub"));
        assert_eq!(base_key("IMG_1.JPG.xmp"), "img_1");
    }
}
