//! KI in SlimSort – läuft komplett auf dem eigenen Computer, nichts geht ins Internet
//! (außer dem einmaligen Herunterladen des Modells von GitHub).
//!
//! - Jedes Foto bekommt einen "Fingerabdruck" (512 Zahlen), der beschreibt, was darauf zu sehen ist.
//! - Suche: Text ("Baum links, Wiese, Berg") bekommt auch einen Fingerabdruck → ähnlichste Fotos.
//! - Lernen: Was du in welchen Ordner sortierst, wird gemerkt. Neue Fotos werden mit
//!   den gemerkten verglichen → Vorschlag mit Sicherheit in Prozent.
//!
//! Ausgeschaltet läuft hier gar nichts: kein Thread, kein geladenes Modell.

pub mod net;
pub mod tok;

use crate::session::Emit;
use crate::thumbs;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

pub const MODEL_FILE: &str = "slimsort-ki-1.safetensors";
const RELEASE_API: &str = "https://api.github.com/repos/slimbitapps/SlimSort/releases/tags/ki-modell-1";
pub const DIM: usize = 512;
/// Höchstens so viele gelernte Beispiele je Ordner (die neuesten zählen)
const MAX_EXAMPLES: usize = 400;
/// Beispielfotos, die aus einem bestehenden Zielordner gelernt werden
const FOLDER_SAMPLES: usize = 40;
/// Modell nach so langer Pause wieder aus dem Speicher werfen
const UNLOAD_AFTER: Duration = Duration::from_secs(120);

type Key = [u8; 20];

fn key_of(path: &Path) -> Option<Key> {
    let hex = thumbs::Cache::key(path, "ai")?;
    let mut k = [0u8; 20];
    hex::decode_to_slice(&hex, &mut k).ok()?;
    Some(k)
}

/// Fingerabdruck platzsparend: 512 × 8 Bit + Faktor
#[derive(Clone)]
struct Emb {
    q: Vec<i8>,
    s: f32,
}

impl Emb {
    fn from(v: &[f32]) -> Emb {
        let m = v.iter().fold(0f32, |a, b| a.max(b.abs())).max(1e-9);
        let s = m / 127.0;
        Emb { q: v.iter().map(|x| (x / s).round().clamp(-127.0, 127.0) as i8).collect(), s }
    }
    fn to_f32(&self) -> Vec<f32> {
        self.q.iter().map(|&x| x as f32 * self.s).collect()
    }
    fn dot(&self, v: &[f32]) -> f32 {
        self.q.iter().zip(v).map(|(&a, b)| a as f32 * b).sum::<f32>() * self.s
    }
}

/// Alle Fingerabdrücke, auf der Platte als Liste fester Länge (Schlüssel, Faktor, Zahlen).
struct Store {
    file: PathBuf,
    map: HashMap<Key, Emb>,
}

const REC: usize = 20 + 4 + DIM;

impl Store {
    fn load(file: PathBuf) -> Store {
        let mut map = HashMap::new();
        if let Ok(f) = File::open(&file) {
            let mut r = BufReader::new(f);
            let mut buf = vec![0u8; REC];
            while r.read_exact(&mut buf).is_ok() {
                let mut k = [0u8; 20];
                k.copy_from_slice(&buf[..20]);
                let s = f32::from_le_bytes([buf[20], buf[21], buf[22], buf[23]]);
                map.insert(k, Emb { q: buf[24..].iter().map(|&b| b as i8).collect(), s });
            }
        }
        Store { file, map }
    }

    fn put(&mut self, k: Key, e: Emb) {
        let mut rec = Vec::with_capacity(REC);
        rec.extend_from_slice(&k);
        rec.extend_from_slice(&e.s.to_le_bytes());
        rec.extend(e.q.iter().map(|&x| x as u8));
        if let Some(p) = self.file.parent() {
            let _ = fs::create_dir_all(p);
        }
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&self.file) {
            let _ = f.write_all(&rec);
        }
        self.map.insert(k, e);
    }
}

/// Gelerntes: welches Foto (Schlüssel) in welchen Ordner kam
#[derive(Serialize, Deserialize, Clone)]
struct Example {
    t: String,
    k: String,
    /// aus einem bestehenden Ordner gelernt (nicht von dir einsortiert)
    #[serde(default)]
    f: bool,
}

#[derive(Serialize, Deserialize, Default)]
struct Learned {
    examples: Vec<Example>,
    /// schon ausgewertete Zielordner
    folders: HashSet<String>,
}

enum JobKind {
    Session(u64),
    Folder(String),
}

struct Job {
    kind: JobKind,
    path: PathBuf,
    key: Key,
}

enum Tok {
    Word(tok::Tokenizer),
    Bpe(tok::Bpe),
}

pub struct Model {
    w: net::Weights,
    tok: Tok,
}

impl Model {
    pub fn load(path: &Path) -> Result<Model, String> {
        let w = net::Weights::load(path)?;
        let tok = if w.siglip() {
            Tok::Bpe(tok::Bpe::new(&w.vocab, &w.merges, &w.meta))
        } else {
            Tok::Word(tok::Tokenizer::new(&w.vocab, w.m("unk"), w.m("cls"), w.m("sep")))
        };
        Ok(Model { w, tok })
    }
    /// Bild vorbereiten: CLIP schneidet die Mitte aus, SigLIP nimmt das ganze Bild (gestaucht)
    pub fn prepare(&self, img: &image::DynamicImage) -> Vec<u8> {
        let size = self.w.m("v_size") as u32;
        if self.w.siglip() {
            return image::imageops::resize(&img.to_rgb8(), size, size, image::imageops::FilterType::Triangle).into_raw();
        }
        prepare(img)
    }
    pub fn image(&self, sc: &mut net::Scratch, rgb: &[u8]) -> Vec<f32> {
        net::embed_image(&self.w, sc, rgb)
    }
    pub fn text(&self, sc: &mut net::Scratch, text: &str) -> Vec<f32> {
        let ids = self.tokens(text);
        net::embed_text(&self.w, sc, &ids)
    }
    pub fn tokens(&self, text: &str) -> Vec<usize> {
        match &self.tok {
            Tok::Word(t) => t.encode(text, 64),
            // SigLIP 2 wurde mit Kleinschreibung trainiert
            Tok::Bpe(t) => t.encode(&text.to_lowercase(), self.w.m("t_max")),
        }
    }
}

/// Bild auf 224 × 224 bringen: kurze Seite auf 224, Mitte ausschneiden (CLIP).
pub fn prepare(img: &image::DynamicImage) -> Vec<u8> {
    let (w, h) = (img.width().max(1), img.height().max(1));
    let s = 224.0 / w.min(h) as f32;
    let (nw, nh) = (((w as f32 * s).round() as u32).max(224), ((h as f32 * s).round() as u32).max(224));
    let r = image::imageops::resize(&img.to_rgb8(), nw, nh, image::imageops::FilterType::CatmullRom);
    let (x, y) = ((nw - 224) / 2, (nh - 224) / 2);
    image::imageops::crop_imm(&r, x, y, 224, 224).to_image().into_raw()
}

#[derive(Default)]
struct Inner {
    enabled: bool,
    threads: usize,
    workers_gen: u64,
    model: Option<Arc<Model>>,
    load_error: Option<String>,
    last_use: Option<Instant>,
    store: Option<Store>,
    learned: Learned,
    queue: VecDeque<Job>,
    /// Sitzungs-Nummer → Schlüssel
    ids: HashMap<u64, Key>,
    /// Fotos, die sich nicht lesen ließen
    failed: HashSet<Key>,
    total: usize,
    busy: usize,
    downloading: bool,
}

pub struct Ai {
    dir: PathBuf,
    cache: Arc<thumbs::Cache>,
    pub emit: Mutex<Option<Emit>>,
    inner: Mutex<Inner>,
    cv: Condvar,
    loading: Mutex<()>,
    cancel_dl: AtomicBool,
    dl_got: AtomicU64,
    dl_total: AtomicU64,
    index_gen: AtomicU64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub enabled: bool,
    pub installed: bool,
    pub downloading: bool,
    pub received: u64,
    pub size: u64,
    pub indexed: usize,
    pub total: usize,
    pub examples: usize,
    pub threads: usize,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct Hit {
    pub id: u64,
    pub score: f32,
}

#[derive(Serialize)]
pub struct Suggestion {
    pub id: u64,
    pub target: String,
    pub conf: f32,
}

#[derive(Deserialize)]
pub struct IndexItem {
    pub id: u64,
    pub path: String,
}

#[derive(Deserialize)]
pub struct FolderTarget {
    pub target: String,
    pub dir: String,
}

fn lower_priority() {
    #[cfg(target_os = "linux")]
    unsafe {
        libc::setpriority(libc::PRIO_PROCESS, 0, 10);
    }
    #[cfg(target_os = "macos")]
    unsafe {
        libc::pthread_set_qos_class_self_np(libc::qos_class_t::QOS_CLASS_UTILITY, 0);
    }
    #[cfg(windows)]
    unsafe {
        use windows::Win32::System::Threading::{GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_BELOW_NORMAL};
        let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_BELOW_NORMAL);
    }
}

/// Anzahl Rechen-Threads je Leistungsstufe
pub fn threads_for(perf: &str) -> usize {
    let n = num_cpus::get().max(1);
    match perf {
        "low" => 1,
        "high" => n.saturating_sub(1).max(1),
        _ => (n / 2).max(1),
    }
}

impl Ai {
    pub fn new(user_data: &Path, cache: Arc<thumbs::Cache>) -> Arc<Ai> {
        Arc::new(Ai {
            dir: user_data.join("ki"),
            cache,
            emit: Mutex::new(None),
            inner: Mutex::new(Inner::default()),
            cv: Condvar::new(),
            loading: Mutex::new(()),
            cancel_dl: AtomicBool::new(false),
            dl_got: AtomicU64::new(0),
            dl_total: AtomicU64::new(0),
            index_gen: AtomicU64::new(0),
        })
    }

    pub fn model_path(&self) -> PathBuf {
        if let (Ok(_), Ok(p)) = (std::env::var("FOTOSORT_TEST"), std::env::var("FOTOSORT_AI_MODEL")) {
            return PathBuf::from(p);
        }
        self.dir.join(MODEL_FILE)
    }

    fn installed(&self) -> bool {
        self.model_path().is_file()
    }

    fn send(&self, ev: &str, v: Value) {
        if let Some(e) = self.emit.lock().unwrap().as_ref() {
            e(ev, v);
        }
    }

    pub fn status(&self) -> Status {
        let g = self.inner.lock().unwrap();
        let indexed = match &g.store {
            Some(s) => g.ids.values().filter(|k| s.map.contains_key(*k) || g.failed.contains(*k)).count(),
            None => 0,
        };
        Status {
            enabled: g.enabled,
            installed: self.installed(),
            downloading: g.downloading,
            received: self.dl_got.load(Ordering::Relaxed),
            size: self.dl_total.load(Ordering::Relaxed),
            indexed,
            total: g.ids.len().max(g.total),
            examples: g.learned.examples.len(),
            threads: g.threads,
            error: g.load_error.clone(),
        }
    }

    fn push_status(&self) {
        let s = self.status();
        self.send("ai:status", serde_json::to_value(s).unwrap_or(Value::Null));
    }

    fn learned_path(&self) -> PathBuf {
        self.dir.join("gelernt.json")
    }

    fn save_learned(&self, l: &Learned) {
        let _ = fs::create_dir_all(&self.dir);
        let tmp = self.learned_path().with_extension("tmp");
        if let Ok(s) = serde_json::to_vec(l) {
            if fs::write(&tmp, s).is_ok() {
                let _ = fs::rename(&tmp, self.learned_path());
            }
        }
    }

    /// KI ein-/ausschalten. Aus = Threads beenden, Modell und Fingerabdrücke aus dem Speicher.
    pub fn configure(self: &Arc<Self>, enabled: bool, perf: &str) {
        let threads = threads_for(perf);
        let mut g = self.inner.lock().unwrap();
        let was = g.enabled;
        let changed = was != enabled || g.threads != threads;
        g.enabled = enabled;
        g.threads = if enabled { threads } else { 0 };
        if !enabled {
            g.model = None;
            g.store = None;
            g.queue.clear();
            g.ids.clear();
            g.total = 0;
            g.learned = Learned::default();
        } else if !was {
            g.store = Some(Store::load(self.dir.join("fingerabdruecke.bin")));
            g.learned = fs::read(self.learned_path()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        }
        if changed {
            g.workers_gen += 1;
            let gen = g.workers_gen;
            if enabled {
                for _ in 0..threads {
                    let me = self.clone();
                    std::thread::spawn(move || me.worker(gen));
                }
            }
        }
        drop(g);
        self.cv.notify_all();
        self.push_status();
    }

    /// Modell holen (lädt es bei Bedarf von der Platte – dauert ein paar Sekunden)
    fn model(&self) -> Result<Arc<Model>, String> {
        {
            let mut g = self.inner.lock().unwrap();
            if !g.enabled {
                return Err("KI ist ausgeschaltet".into());
            }
            g.last_use = Some(Instant::now());
            if let Some(m) = &g.model {
                return Ok(m.clone());
            }
        }
        let _l = self.loading.lock().unwrap();
        if let Some(m) = &self.inner.lock().unwrap().model {
            return Ok(m.clone());
        }
        if !self.installed() {
            return Err("Modell nicht installiert".into());
        }
        let m = Model::load(&self.model_path()).map(Arc::new);
        let mut g = self.inner.lock().unwrap();
        match m {
            Ok(m) => {
                g.load_error = None;
                if g.enabled {
                    g.model = Some(m.clone());
                }
                Ok(m)
            }
            Err(e) => {
                g.load_error = Some(e.clone());
                Err(e)
            }
        }
    }

    fn worker(self: Arc<Self>, gen: u64) {
        lower_priority();
        let mut sc = net::Scratch::default();
        let mut last_emit = Instant::now();
        loop {
            let job = {
                let mut g = self.inner.lock().unwrap();
                loop {
                    if g.workers_gen != gen || !g.enabled {
                        return;
                    }
                    if self.installed() && g.load_error.is_none() {
                        if let Some(j) = g.queue.pop_front() {
                            g.busy += 1;
                            break j;
                        }
                    }
                    // Pause: Modell nach einer Weile freigeben
                    if g.busy == 0 && g.model.is_some() && g.last_use.map_or(true, |t| t.elapsed() > UNLOAD_AFTER) {
                        g.model = None;
                    }
                    g = self.cv.wait_timeout(g, Duration::from_secs(20)).unwrap().0;
                }
            };
            let res = self.model().and_then(|m| self.embed_file(&m, &mut sc, &job.path).ok_or_else(String::new));
            let mut g = self.inner.lock().unwrap();
            g.busy -= 1;
            g.last_use = Some(Instant::now());
            match res {
                Ok(e) => {
                    if let Some(s) = g.store.as_mut() {
                        s.put(job.key, Emb::from(&e));
                    }
                    if let JobKind::Folder(t) = &job.kind {
                        g.learned.examples.push(Example { t: t.clone(), k: hex::encode(job.key), f: true });
                    }
                }
                Err(e) if e.is_empty() => {
                    g.failed.insert(job.key);
                }
                Err(_) => {}
            }
            let folder_done = matches!(job.kind, JobKind::Folder(_)) && !g.queue.iter().any(|j| matches!(j.kind, JobKind::Folder(_)));
            if folder_done {
                let l = std::mem::take(&mut g.learned);
                self.save_learned(&l);
                g.learned = l;
            }
            let idle = g.queue.is_empty() && g.busy == 0;
            drop(g);
            if idle || last_emit.elapsed() > Duration::from_millis(400) {
                last_emit = Instant::now();
                self.push_status();
            }
            if idle {
                self.send("ai:idle", Value::Null);
            }
        }
    }

    /// Fingerabdruck eines Fotos (Vorschaubild aus dem Zwischenspeicher, sonst neu erzeugt)
    fn embed_file(&self, m: &Model, sc: &mut net::Scratch, path: &Path) -> Option<Vec<f32>> {
        let tkey = thumbs::Cache::key(path, "256")?;
        let tp = self.cache.thumb_path(&tkey);
        let jpg = match fs::read(&tp) {
            Ok(b) => b,
            Err(_) => {
                let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy().to_lowercase())).unwrap_or_default();
                let b = thumbs::render(path, &ext, 256, 80)?;
                self.cache.store_thumb(&tkey, &b);
                b
            }
        };
        let img = image::load_from_memory_with_format(&jpg, image::ImageFormat::Jpeg).ok()?;
        Some(m.image(sc, &m.prepare(&img)))
    }

    /// Fotos der geöffneten Sortierung vormerken. Bekannte werden sofort übernommen.
    pub fn index(self: &Arc<Self>, items: Vec<IndexItem>) {
        let gen = self.index_gen.fetch_add(1, Ordering::SeqCst) + 1;
        {
            let mut g = self.inner.lock().unwrap();
            if !g.enabled {
                return;
            }
            g.queue.retain(|j| matches!(j.kind, JobKind::Folder(_)));
            g.ids.clear();
            g.total = items.len();
        }
        let me = self.clone();
        // Schlüssel ermitteln braucht pro Datei einen Plattenzugriff → im Hintergrund
        std::thread::spawn(move || {
            lower_priority();
            for chunk in items.chunks(500) {
                let keyed: Vec<(u64, PathBuf, Option<Key>)> = chunk.iter().map(|it| (it.id, PathBuf::from(&it.path), key_of(Path::new(&it.path)))).collect();
                let mut g = me.inner.lock().unwrap();
                if me.index_gen.load(Ordering::SeqCst) != gen || !g.enabled {
                    return;
                }
                for (id, path, k) in keyed {
                    let Some(k) = k else { continue };
                    g.ids.insert(id, k);
                    let known = g.store.as_ref().is_some_and(|s| s.map.contains_key(&k)) || g.failed.contains(&k);
                    if !known {
                        g.queue.push_back(Job { kind: JobKind::Session(id), path, key: k });
                    }
                }
                drop(g);
                me.cv.notify_all();
            }
            me.push_status();
        });
    }

    /// Diese Fotos zuerst (das aktuelle und die nächsten)
    pub fn prioritize(&self, ids: &[u64]) {
        let mut g = self.inner.lock().unwrap();
        let want: HashSet<u64> = ids.iter().copied().collect();
        let (mut front, rest): (VecDeque<Job>, VecDeque<Job>) = g.queue.drain(..).partition(|j| matches!(j.kind, JobKind::Session(id) if want.contains(&id)));
        front.extend(rest);
        g.queue = front;
    }

    /// Aus bestehenden Zielordnern lernen (je Ordner einige Beispielfotos)
    pub fn learn_folders(self: &Arc<Self>, targets: Vec<FolderTarget>) {
        if !self.inner.lock().unwrap().enabled {
            return;
        }
        let me = self.clone();
        std::thread::spawn(move || {
            lower_priority();
            for t in targets {
                if me.inner.lock().unwrap().learned.folders.contains(&t.dir) {
                    continue;
                }
                let files = sample_images(Path::new(&t.dir), FOLDER_SAMPLES);
                let mut g = me.inner.lock().unwrap();
                if !g.enabled {
                    return;
                }
                g.learned.folders.insert(t.dir.clone());
                for p in files {
                    let Some(k) = key_of(&p) else { continue };
                    if g.store.as_ref().is_some_and(|s| s.map.contains_key(&k)) {
                        g.learned.examples.push(Example { t: t.target.clone(), k: hex::encode(k), f: true });
                    } else {
                        g.queue.push_front(Job { kind: JobKind::Folder(t.target.clone()), path: p, key: k });
                    }
                }
                let l = std::mem::take(&mut g.learned);
                me.save_learned(&l);
                g.learned = l;
                drop(g);
                me.cv.notify_all();
            }
        });
    }

    /// Merkt sich, wohin Fotos sortiert wurden (`target` = None: wieder vergessen, z. B. nach Rückgängig)
    pub fn learn(&self, ids: &[u64], target: Option<String>) {
        let mut g = self.inner.lock().unwrap();
        if !g.enabled {
            return;
        }
        let keys: Vec<String> = ids.iter().filter_map(|id| g.ids.get(id)).map(hex::encode).collect();
        let set: HashSet<&String> = keys.iter().collect();
        g.learned.examples.retain(|e| e.f || !set.contains(&e.k));
        if let Some(t) = target {
            for k in &keys {
                g.learned.examples.push(Example { t: t.clone(), k: k.clone(), f: false });
            }
            // je Ordner nur die neuesten behalten
            let mut count: HashMap<String, usize> = HashMap::new();
            let mut keep = vec![false; g.learned.examples.len()];
            for (i, e) in g.learned.examples.iter().enumerate().rev() {
                let c = count.entry(e.t.clone()).or_default();
                *c += 1;
                keep[i] = *c <= MAX_EXAMPLES;
            }
            let mut i = 0;
            g.learned.examples.retain(|_| {
                i += 1;
                keep[i - 1]
            });
        }
        let l = std::mem::take(&mut g.learned);
        self.save_learned(&l);
        g.learned = l;
        drop(g);
        self.push_status();
    }

    /// Alles Gelernte vergessen (Fingerabdrücke bleiben)
    pub fn forget(&self) {
        let mut g = self.inner.lock().unwrap();
        g.learned = Learned::default();
        self.save_learned(&g.learned);
        drop(g);
        self.push_status();
    }

    /// Ordner aus dem Gelernten entfernen bzw. umbenennen (z. B. Zielordner gelöscht)
    pub fn rename_target(&self, from: &str, to: Option<&str>) {
        let mut g = self.inner.lock().unwrap();
        match to {
            Some(t) => g.learned.examples.iter_mut().filter(|e| e.t == from).for_each(|e| e.t = t.to_string()),
            None => g.learned.examples.retain(|e| e.t != from),
        }
        let l = std::mem::take(&mut g.learned);
        self.save_learned(&l);
        g.learned = l;
    }

    /// Ähnlichste Fotos zu einem Fingerabdruck, nur unter `among` (oder allen der Sortierung)
    fn rank(&self, v: &[f32], among: Option<Vec<u64>>, limit: usize) -> Vec<Hit> {
        let g = self.inner.lock().unwrap();
        let Some(store) = &g.store else { return vec![] };
        let ids: Vec<u64> = among.unwrap_or_else(|| g.ids.keys().copied().collect());
        let mut hits: Vec<Hit> = ids
            .into_iter()
            .filter_map(|id| {
                let e = store.map.get(g.ids.get(&id)?)?;
                Some(Hit { id, score: e.dot(v) })
            })
            .collect();
        hits.sort_by(|a, b| b.score.total_cmp(&a.score));
        hits.truncate(limit);
        hits
    }

    pub fn search(&self, text: &str, among: Option<Vec<u64>>, limit: usize) -> Result<Vec<Hit>, String> {
        let m = self.model()?;
        let mut sc = net::Scratch::default();
        let v = m.text(&mut sc, text);
        Ok(self.rank(&v, among, limit))
    }

    pub fn similar(&self, id: u64, among: Option<Vec<u64>>, limit: usize) -> Result<Vec<Hit>, String> {
        let v = {
            let g = self.inner.lock().unwrap();
            let k = g.ids.get(&id).ok_or("Foto noch nicht analysiert")?;
            g.store.as_ref().and_then(|s| s.map.get(k)).ok_or("Foto noch nicht analysiert")?.to_f32()
        };
        let mut hits = self.rank(&v, among, limit + 1);
        hits.retain(|h| h.id != id);
        Ok(hits)
    }

    /// Vorschläge: für jedes Foto der wahrscheinlichste Ordner und wie sicher.
    /// Vergleicht mit den gelernten Beispielen (Mittel der 3 ähnlichsten je Ordner).
    pub fn suggest(&self, ids: &[u64], targets: &[String]) -> Vec<Suggestion> {
        let g = self.inner.lock().unwrap();
        let Some(store) = &g.store else { return vec![] };
        let allowed: HashSet<&String> = targets.iter().collect();
        let mut by_t: HashMap<&str, Vec<Vec<f32>>> = HashMap::new();
        for e in &g.learned.examples {
            if !allowed.contains(&e.t) {
                continue;
            }
            let mut k = [0u8; 20];
            if hex::decode_to_slice(&e.k, &mut k).is_err() {
                continue;
            }
            if let Some(emb) = store.map.get(&k) {
                by_t.entry(&e.t).or_default().push(emb.to_f32());
            }
        }
        by_t.retain(|_, v| v.len() >= 2);
        if by_t.len() < 2 {
            return vec![]; // mit nur einem Ordner gibt es nichts zu unterscheiden
        }
        let mut out = Vec::new();
        for &id in ids {
            let Some(e) = g.ids.get(&id).and_then(|k| store.map.get(k)) else { continue };
            let mut scores: Vec<(&str, f32)> = by_t
                .iter()
                .map(|(t, ex)| {
                    let mut sims: Vec<f32> = ex.iter().map(|x| e.dot(x)).collect();
                    sims.sort_by(|a, b| b.total_cmp(a));
                    let n = sims.len().min(3);
                    (*t, sims[..n].iter().sum::<f32>() / n as f32)
                })
                .collect();
            scores.sort_by(|a, b| b.1.total_cmp(&a.1));
            // weiche Wahrscheinlichkeit; τ klein = deutliche Unterschiede
            let tau = 0.025;
            let z: f32 = scores.iter().map(|(_, s)| ((s - scores[0].1) / tau).exp()).sum();
            let mut conf = 1.0 / z;
            if scores[0].1 < 0.6 {
                conf *= 0.6; // kaum Ähnlichkeit mit irgendwas Gelerntem
            }
            out.push(Suggestion { id, target: scores[0].0.to_string(), conf });
        }
        out
    }

    // ------------------------------------------------------------------ Herunterladen

    pub fn download(self: &Arc<Self>) {
        {
            let mut g = self.inner.lock().unwrap();
            if g.downloading {
                return;
            }
            g.downloading = true;
            g.load_error = None;
        }
        self.cancel_dl.store(false, Ordering::SeqCst);
        self.dl_got.store(0, Ordering::Relaxed);
        let me = self.clone();
        std::thread::spawn(move || {
            let r = me.download_inner();
            me.inner.lock().unwrap().downloading = false;
            if let Err(e) = &r {
                me.inner.lock().unwrap().load_error = Some(e.clone());
            }
            me.send("ai:download", json!({ "ok": r.is_ok(), "error": r.err() }));
            me.cv.notify_all();
            me.push_status();
        });
    }

    pub fn cancel_download(&self) {
        self.cancel_dl.store(true, Ordering::SeqCst);
    }

    fn download_inner(&self) -> Result<(), String> {
        let agent: ureq::Agent = ureq::Agent::config_builder().timeout_connect(Some(Duration::from_secs(20))).build().into();
        // Nur im Testmodus: Modell von einer anderen Adresse (lokaler Server im E2E-Test)
        let test_url = std::env::var("FOTOSORT_TEST").ok().and(std::env::var("FOTOSORT_AI_URL").ok());
        let (url, size, digest) = match test_url {
            Some(u) => (u, 0u64, None),
            None => {
                let rel: Value = agent
                    .get(RELEASE_API)
                    .header("User-Agent", "SlimSort")
                    .header("Accept", "application/vnd.github+json")
                    .call()
                    .map_err(|e| format!("GitHub nicht erreichbar ({e})"))?
                    .body_mut()
                    .read_to_string()
                    .map_err(|e| e.to_string())
                    .and_then(|t| serde_json::from_str(&t).map_err(|e| e.to_string()))?;
                let a = rel["assets"].as_array().and_then(|a| a.iter().find(|x| x["name"] == MODEL_FILE)).ok_or("Modell nicht gefunden")?;
                (
                    a["browser_download_url"].as_str().unwrap_or_default().to_string(),
                    a["size"].as_u64().unwrap_or(0),
                    a["digest"].as_str().and_then(|d| d.strip_prefix("sha256:")).map(str::to_string),
                )
            }
        };
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let part = self.dir.join(format!("{MODEL_FILE}.part"));
        let mut resp = agent.get(&url).header("User-Agent", "SlimSort").call().map_err(|e| format!("Download fehlgeschlagen ({e})"))?;
        let total = if size > 0 { size } else { resp.body().content_length().unwrap_or(0) };
        self.dl_total.store(total, Ordering::Relaxed);
        let mut body = resp.body_mut().with_config().limit(2 << 30).reader();
        let mut out = File::create(&part).map_err(|e| e.to_string())?;
        let mut sha = Sha256::new();
        let mut buf = vec![0u8; 1 << 16];
        let mut got = 0u64;
        let mut last = Instant::now();
        loop {
            if self.cancel_dl.load(Ordering::SeqCst) {
                drop(out);
                let _ = fs::remove_file(&part);
                return Err("abgebrochen".into());
            }
            let n = body.read(&mut buf).map_err(|e| format!("Download unterbrochen ({e})"))?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n]).map_err(|e| format!("Speichern fehlgeschlagen ({e})"))?;
            sha.update(&buf[..n]);
            got += n as u64;
            self.dl_got.store(got, Ordering::Relaxed);
            if last.elapsed() > Duration::from_millis(300) {
                last = Instant::now();
                self.push_status();
            }
        }
        out.sync_all().map_err(|e| e.to_string())?;
        drop(out);
        if total > 0 && got != total {
            let _ = fs::remove_file(&part);
            return Err("Download unvollständig".into());
        }
        if let Some(d) = digest {
            if hex::encode(sha.finalize()) != d.to_lowercase() {
                let _ = fs::remove_file(&part);
                return Err("Download beschädigt (Prüfsumme falsch)".into());
            }
        }
        // prüfen, ob sich die Datei laden lässt
        if let Err(e) = net::Weights::load(&part) {
            let _ = fs::remove_file(&part);
            return Err(e);
        }
        fs::rename(&part, self.dir.join(MODEL_FILE)).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Modell und alles Gespeicherte löschen
    pub fn remove_all(&self) {
        let mut g = self.inner.lock().unwrap();
        g.model = None;
        g.store = if g.enabled { Some(Store { file: self.dir.join("fingerabdruecke.bin"), map: HashMap::new() }) } else { None };
        g.learned = Learned::default();
        g.queue.clear();
        g.failed.clear();
        drop(g);
        let _ = fs::remove_dir_all(&self.dir);
        self.push_status();
    }
}

/// Bis zu `n` Bilder gleichmäßig verteilt aus einem Ordner (und seinen direkten Unterordnern)
fn sample_images(dir: &Path, n: usize) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut dirs = vec![(dir.to_path_buf(), 0)];
    let t0 = Instant::now();
    while let Some((d, depth)) = dirs.pop() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            if t0.elapsed() > Duration::from_secs(5) || files.len() > 5000 {
                break;
            }
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() {
                if depth < 1 && !crate::scanner::is_skip_dir(&name.to_lowercase()) {
                    dirs.push((p, depth + 1));
                }
            } else if crate::scanner::IMAGE_EXT.contains(&crate::scanner::ext_of(&name).as_str()) {
                files.push(p);
            }
        }
    }
    files.sort();
    if files.len() <= n {
        return files;
    }
    let step = files.len() as f64 / n as f64;
    (0..n).map(|i| files[(i as f64 * step) as usize].clone()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Vergleicht mit den Werten von PyTorch (Datei aus dem Release, nur wenn vorhanden):
    /// FOTOSORT_AI_MODEL=…/slimsort-ki-1.safetensors cargo test ai -- --nocapture
    #[test]
    fn matches_reference() {
        let Ok(p) = std::env::var("FOTOSORT_AI_MODEL") else { return };
        let m = Model::load(Path::new(&p)).unwrap();
        let rp = PathBuf::from(p.replace(".safetensors", "-ref.json"));
        let size = m.w.m("v_size");
        let r: Value = serde_json::from_slice(&fs::read(rp).unwrap()).unwrap();
        let mut sc = net::Scratch::default();
        let cos = |a: &[f32], b: &Value| a.iter().zip(b.as_array().unwrap()).map(|(x, y)| x * y.as_f64().unwrap() as f32).sum::<f32>();
        for (name, want) in r["images"].as_object().unwrap() {
            let mut rgb = vec![0u8; size * size * 3];
            for y in 0..size {
                for x in 0..size {
                    let px = match name.as_str() {
                        "red" => [230, 30, 30],
                        "blue" => [30, 60, 220],
                        _ => [((x * 3 + y * 5) % 256) as u8, ((x * y) % 256) as u8, ((x + 2 * y) % 256) as u8],
                    };
                    rgb[(y * size + x) * 3..(y * size + x) * 3 + 3].copy_from_slice(&px);
                }
            }
            let t0 = Instant::now();
            let e = m.image(&mut sc, &rgb);
            let c = cos(&e, want);
            println!("Bild {name}: cos {c:.4} ({:?})", t0.elapsed());
            assert!(c > 0.98, "{name}: {c}");
        }
        for (text, want) in r["texts"].as_object().unwrap() {
            let ids: Vec<usize> = want["ids"].as_array().unwrap().iter().map(|v| v.as_u64().unwrap() as usize).collect();
            assert_eq!(m.tokens(text), ids, "Wortstücke für {text:?}");
            let e = m.text(&mut sc, text);
            let c = cos(&e, &want["embed"]);
            println!("Text {text:?}: cos {c:.4}");
            assert!(c > 0.98, "{text}: {c}");
        }
    }

    #[test]
    fn emb_roundtrip() {
        let mut v: Vec<f32> = (0..DIM).map(|i| ((i * 37 % 101) as f32 - 50.0) / 50.0).collect();
        net::normalize(&mut v);
        let e = Emb::from(&v);
        assert!((e.dot(&v) - 1.0).abs() < 0.01);
    }
}
