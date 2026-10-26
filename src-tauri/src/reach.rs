//! Erreichbarkeit von Ordnern überwachen (z. B. NAS nach dem Hochfahren)
//! und umgezogene Ordner anhand ihres Namens wiederfinden.

use crate::fsops::{check_dir, with_timeout};
use crate::scanner::is_skip_dir;
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Prüfzeitpunkte nach dem Start (Sekunden) – Netzlaufwerke brauchen oft etwas.
pub const STARTUP_CHECKS: &[u64] = &[0, 3, 8, 15, 30, 60, 120];
pub const INTERVAL: Duration = Duration::from_secs(15);
const TIMEOUT: Duration = Duration::from_millis(4000);

#[derive(Default)]
pub struct ReachMonitor {
    dirs: Mutex<Vec<String>>,
    status: Mutex<BTreeMap<String, bool>>,
    running: Mutex<bool>,
}

impl ReachMonitor {
    pub fn set_dirs(&self, dirs: Vec<String>) {
        let set: HashSet<String> = dirs.iter().filter(|d| !d.is_empty()).cloned().collect();
        *self.dirs.lock().unwrap() = set.iter().cloned().collect();
        self.status.lock().unwrap().retain(|d, _| set.contains(d));
    }

    pub fn snapshot(&self) -> BTreeMap<String, bool> {
        self.status.lock().unwrap().clone()
    }

    /// Prüft alle Ordner parallel. Liefert (Stand, geändert?).
    pub fn check_now(self: &Arc<Self>) -> (BTreeMap<String, bool>, bool) {
        {
            let mut r = self.running.lock().unwrap();
            if *r {
                return (self.snapshot(), false);
            }
            *r = true;
        }
        let list = self.dirs.lock().unwrap().clone();
        let handles: Vec<_> = list
            .iter()
            .map(|d| {
                let d = d.clone();
                std::thread::spawn(move || check_dir(&d, TIMEOUT).ok)
            })
            .collect();
        let res: Vec<bool> = handles.into_iter().map(|h| h.join().unwrap_or(false)).collect();
        let mut changed = false;
        {
            let mut st = self.status.lock().unwrap();
            for (d, ok) in list.iter().zip(res) {
                if st.get(d) != Some(&ok) {
                    changed = true;
                }
                st.insert(d.clone(), ok);
            }
        }
        *self.running.lock().unwrap() = false;
        (self.snapshot(), changed)
    }
}

fn is_dir(p: &Path) -> bool {
    let p = p.to_path_buf();
    matches!(with_timeout(Duration::from_millis(1500), "stat", move || fs::metadata(&p).map(|m| m.is_dir()).unwrap_or(false)), Ok(true))
}

fn parent(p: &Path) -> PathBuf {
    p.parent().map(Path::to_path_buf).unwrap_or_else(|| p.to_path_buf())
}

/// Mögliche Startpunkte für die Suche nach verlorenen Ordnern.
fn search_roots(missing: &Path, hints: &[String]) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    let add = |p: PathBuf, roots: &mut Vec<PathBuf>| {
        if !roots.contains(&p) {
            roots.push(p);
        }
    };
    // Vorhandene Elternordner des verlorenen Pfads
    let mut p = parent(missing);
    for _ in 0..6 {
        if p.as_os_str().is_empty() || parent(&p) == p {
            break;
        }
        if is_dir(&p) {
            add(p.clone(), &mut roots);
            let up = parent(&p);
            if up != p {
                add(up, &mut roots);
            }
            break;
        }
        p = parent(&p);
    }
    for h in hints.iter().filter(|h| !h.is_empty()) {
        let hp = Path::new(h);
        add(parent(hp), &mut roots);
        add(parent(&parent(hp)), &mut roots);
    }
    if let Some(home) = dirs::home_dir() {
        for sub in ["Pictures", "Bilder", "Desktop", "Schreibtisch", "Documents", "Dokumente", ""] {
            add(if sub.is_empty() { home.clone() } else { home.join(sub) }, &mut roots);
        }
    }
    if cfg!(windows) {
        for c in b'C'..=b'Z' {
            add(PathBuf::from(format!("{}:\\", c as char)), &mut roots);
        }
    } else if cfg!(target_os = "macos") {
        if let Ok(rd) = fs::read_dir("/Volumes") {
            for e in rd.flatten() {
                add(e.path(), &mut roots);
            }
        }
    } else {
        for b in ["/media", "/mnt"] {
            add(PathBuf::from(b), &mut roots);
        }
    }
    roots.into_iter().filter(|r| is_dir(r)).collect()
}

const SYSTEM_DIRS: &[&str] = &["windows", "program files", "program files (x86)", "programdata", "library", "system", "appdata", "applications"];

/// Sucht Ordner mit gleichem Namen wie die verlorenen Ordner.
pub fn find_lost_folders(missing: &[String], hints: &[String]) -> HashMap<String, Vec<String>> {
    let deadline = Instant::now() + Duration::from_secs(12);
    let max_depth = 4;
    let mut wanted: HashMap<String, Vec<String>> = HashMap::new();
    for m in missing {
        let n = Path::new(m).file_name().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
        wanted.entry(n).or_default().push(m.clone());
    }
    let mut result: HashMap<String, Vec<String>> = missing.iter().map(|m| (m.clone(), vec![])).collect();
    let mut roots: Vec<PathBuf> = Vec::new();
    for m in missing {
        for r in search_roots(Path::new(m), hints) {
            if !roots.contains(&r) {
                roots.push(r);
            }
        }
    }
    let mut seen = HashSet::new();
    let mut queue: VecDeque<(PathBuf, usize)> = roots.into_iter().map(|r| (r, 0)).collect();
    while let Some((dir, depth)) = queue.pop_front() {
        if Instant::now() > deadline {
            break;
        }
        if !seen.insert(dir.to_string_lossy().to_lowercase()) {
            continue;
        }
        let d = dir.clone();
        let ents = match with_timeout(Duration::from_secs(2), "readdir", move || {
            fs::read_dir(&d).map(|rd| rd.flatten().filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false)).map(|e| e.file_name().to_string_lossy().into_owned()).collect::<Vec<_>>())
        }) {
            Ok(Ok(v)) => v,
            _ => continue,
        };
        for name in ents {
            let lower = name.to_lowercase();
            if name.starts_with('.') || is_skip_dir(&lower) || SYSTEM_DIRS.contains(&lower.as_str()) {
                continue;
            }
            let full = dir.join(&name);
            if let Some(ms) = wanted.get(&lower) {
                let fs_ = full.to_string_lossy().into_owned();
                for m in ms {
                    let list = result.get_mut(m).unwrap();
                    if &fs_ != m && !list.contains(&fs_) {
                        list.push(fs_.clone());
                    }
                }
            }
            if depth + 1 < max_depth {
                queue.push_back((full, depth + 1));
            }
        }
    }
    // Kandidaten mit ähnlichem Elternpfad nach vorne sortieren
    for m in missing {
        let pname = |p: &str| Path::new(p).parent().and_then(|x| x.file_name()).map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
        let want = pname(m);
        if let Some(list) = result.get_mut(m) {
            list.sort_by_key(|a| (if pname(a) == want { 0 } else { 1 }, a.len()));
        }
    }
    result
}
