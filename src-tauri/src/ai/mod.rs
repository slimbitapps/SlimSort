//! KI in SlimSort – läuft komplett auf dem eigenen Computer, nichts geht ins Internet
//! (außer dem einmaligen Herunterladen des Modells von GitHub).
//!
//! - Jedes Foto bekommt einen "Fingerabdruck" (512 Zahlen), der beschreibt, was darauf zu sehen ist.
//! - Suche: Text ("Baum links, Wiese, Berg") bekommt auch einen Fingerabdruck → ähnlichste Fotos.
//! - Lernen: Was du in welchen Ordner sortierst, wird gemerkt. Neue Fotos werden mit
//!   den gemerkten verglichen → Vorschlag mit Sicherheit in Prozent.
//!
//! Ausgeschaltet läuft hier gar nichts: kein Thread, kein geladenes Modell.

pub mod faces;
pub mod hw;
pub mod labels;
pub mod llm;
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

const RELEASES: &str = "https://api.github.com/repos/slimbitapps/SlimSort/releases/tags/";

/// KI-Stufen: welches Bildmodell und welches Sprachmodell (für den Chat)
pub struct TierDef {
    pub id: &'static str,
    /// Release auf GitHub, in dem das Bildmodell liegt
    tag: &'static str,
    pub vision: &'static str,
    dim: usize,
    pub llm: Option<&'static str>,
}

pub const TIERS: [TierDef; 3] = [
    TierDef { id: "eco", tag: "ki-modell-1", vision: "slimsort-ki-1.safetensors", dim: 512, llm: None },
    TierDef { id: "balanced", tag: "ki-2", vision: "slimsort-ki-siglip2-b16.safetensors", dim: 768, llm: Some("qwen3-1.7b") },
    TierDef { id: "max", tag: "ki-2", vision: "slimsort-ki-siglip2-l16.safetensors", dim: 1024, llm: Some("qwen3-4b") },
];
const LLM_TAG: &str = "ki-2";

pub fn tier(id: &str) -> &'static TierDef {
    TIERS.iter().find(|t| t.id == id).unwrap_or(&TIERS[0])
}

/// Name des Helfer-Programms für dieses System (wie im Release)
pub fn helper_name() -> String {
    let os = if cfg!(windows) { "windows" } else if cfg!(target_os = "macos") { "macos" } else { "linux" };
    let ext = if cfg!(windows) { ".exe" } else { "" };
    format!("slimsort-llm-{os}-{}{ext}", std::env::consts::ARCH)
}

#[cfg(test)]
const DIM: usize = 512;
/// Höchstens so viele gelernte Beispiele je Ordner (die neuesten zählen)
const MAX_EXAMPLES: usize = 400;
/// Beispielfotos, die aus einem bestehenden Zielordner gelernt werden
const FOLDER_SAMPLES: usize = 40;
/// Gesichter je Foto (Kästen relativ zur Bildgröße, von links nach rechts)
const FACE_FILE: &str = "gesichter-2.bin";
/// Ab dieser Ähnlichkeit gilt ein Gesicht als die gemerkte Person
pub const FACE_SAME: f32 = 0.42;
/// Modell nach so langer Pause wieder aus dem Speicher werfen
const UNLOAD_AFTER: Duration = Duration::from_secs(120);

type Key = [u8; 20];

/// Ins Protokoll der App schreiben (app.log liegt neben dem KI-Ordner)
fn log_ai(dir: &Path, msg: &str) {
    crate::log_to(dir.parent().unwrap_or(dir), &format!("ki {msg}"));
}

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

impl Store {
    fn load(file: PathBuf, dim: usize) -> Store {
        let mut map = HashMap::new();
        if let Ok(f) = File::open(&file) {
            let mut r = BufReader::new(f);
            let mut buf = vec![0u8; 20 + 4 + dim];
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
        let mut rec = Vec::with_capacity(24 + e.q.len());
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
    /// Faktor, mit dem Text-Bild-Ähnlichkeiten vergleichbar werden (CLIP 100, SigLIP gelernt)
    pub fn scale(&self) -> f32 {
        self.w.meta.get("logit_scale").and_then(|v| v.parse().ok()).unwrap_or(100.0)
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

struct Inner {
    enabled: bool,
    tier: &'static TierDef,
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
    /// gerade bearbeitete Lern-Aufträge (freigegebene Ordner/Zielordner)
    folder_busy: usize,
    downloading: bool,
    /// Fingerabdrücke der Begriffe (für Stichwörter), je Modell einmal berechnet
    labels: Option<Arc<Vec<Vec<f32>>>>,
    /// Fingerabdrücke von Texten (gemerkte Regeln wie "Autos"), je Modell
    texts: HashMap<String, Vec<f32>>,
    /// Gesichter erkennen (eigener Schalter)
    faces_on: bool,
    fstore: Option<faces::FaceStore>,
    /// letzter Fehler der Gesichtserkennung (wird angezeigt)
    face_error: Option<String>,
    /// Fotos, bei denen die Gesichtserkennung gescheitert ist (nicht endlos wiederholen)
    face_failed: HashSet<Key>,
}

impl Default for Inner {
    fn default() -> Inner {
        Inner {
            enabled: false,
            tier: &TIERS[0],
            threads: 0,
            workers_gen: 0,
            model: None,
            load_error: None,
            last_use: None,
            store: None,
            learned: Learned::default(),
            queue: VecDeque::new(),
            ids: HashMap::new(),
            failed: HashSet::new(),
            total: 0,
            busy: 0,
            folder_busy: 0,
            downloading: false,
            labels: None,
            texts: HashMap::new(),
            faces_on: false,
            fstore: None,
            face_error: None,
            face_failed: HashSet::new(),
        }
    }
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
    labels_busy: AtomicBool,
    pub llm: Arc<llm::Llm>,
    fproc: faces::FaceProc,
    /// Kann das Helfer-Programm Gesichter? (je Dateistand einmal geprüft)
    helper_probe: Mutex<Option<((u64, Option<std::time::SystemTime>), bool)>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub enabled: bool,
    pub tier: String,
    /// alles für die gewählte Stufe da (Bild- und ggf. Sprachmodell)
    pub installed: bool,
    /// Bildmodell da (Suche/Vorschläge gehen schon)
    pub vision: bool,
    /// Sprachmodell + Helfer da
    pub chat: bool,
    pub chat_running: bool,
    /// Gesichtserkennung eingeschaltet / Modelle dafür da
    pub faces: bool,
    pub faces_ready: bool,
    pub face_total: usize,
    /// Fotos aus Ordnern, die noch gelernt werden
    pub learning: usize,
    /// Fotos, deren Gesichter noch gesucht werden
    pub faces_pending: usize,
    pub face_error: Option<String>,
    /// Helfer-Programm muss neu geladen werden
    pub helper_old: bool,
    pub downloading: bool,
    pub received: u64,
    pub size: u64,
    pub indexed: usize,
    pub total: usize,
    pub examples: usize,
    pub threads: usize,
    pub error: Option<String>,
    pub hw: hw::Hardware,
}

#[derive(Serialize)]
pub struct Hit {
    pub id: u64,
    pub score: f32,
}

#[derive(Serialize)]
pub struct FaceInfo {
    #[serde(rename = "box")]
    pub bbox: [f32; 4],
    /// Nummer der gemerkten Person (None = unbekannt)
    pub person: Option<usize>,
    /// Ähnlichkeit (bei Unbekannten: zur ähnlichsten Person)
    pub p: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emb: Option<Vec<f32>>,
}

#[derive(Serialize)]
pub struct PhotoFaces {
    pub id: u64,
    pub faces: Vec<FaceInfo>,
}

#[derive(Serialize)]
pub struct ClusterFace {
    pub id: u64,
    pub face: usize,
    #[serde(rename = "box")]
    pub bbox: [f32; 4],
}

#[derive(Serialize)]
pub struct FaceCluster {
    pub members: Vec<ClusterFace>,
    pub samples: Vec<Vec<f32>>,
}

const B64: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn b64(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            out.push(if i <= c.len() { B64[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    out
}

pub fn unb64(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    let (mut acc, mut bits) = (0u32, 0);
    for ch in s.bytes().filter(|&b| b != b'=') {
        acc = acc << 6 | B64.iter().position(|&x| x == ch)? as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    Some(out)
}

#[derive(Deserialize)]
pub struct ThingEx {
    pub pos: Vec<Vec<f32>>,
    #[serde(default)]
    pub neg: Vec<Vec<f32>>,
}

#[derive(Serialize)]
pub struct ThingScores {
    pub id: u64,
    /// je Ding die Ähnlichkeit (−1 = Gegenbeispiel passt besser)
    pub s: Vec<f32>,
}

#[derive(Serialize)]
pub struct RuleHit {
    pub id: u64,
    pub rule: usize,
    pub p: f32,
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
    /// freigegebener Ordner: alle Fotos (bis MAX_EXAMPLES) direkt in diesem Ordner lernen, nicht nur Stichproben
    #[serde(default)]
    pub all: bool,
    /// schon gelernt → trotzdem neu lernen (neue Fotos dazugekommen)
    #[serde(default)]
    pub again: bool,
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
            labels_busy: AtomicBool::new(false),
            llm: llm::Llm::new(),
            fproc: faces::FaceProc::new(),
            helper_probe: Mutex::new(None),
        })
    }

    fn cur_tier(&self) -> &'static TierDef {
        self.inner.lock().unwrap().tier
    }

    pub fn model_path(&self) -> PathBuf {
        self.vision_path(self.cur_tier())
    }

    /// Bildmodell einer Stufe (ohne Sperre – darf aufgerufen werden, während `inner` gesperrt ist)
    fn vision_path(&self, t: &TierDef) -> PathBuf {
        if let (Ok(_), Ok(p)) = (std::env::var("FOTOSORT_TEST"), std::env::var("FOTOSORT_AI_MODEL")) {
            return PathBuf::from(p);
        }
        self.dir.join(t.vision)
    }

    fn llm_path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("slimsort-llm-{id}.gguf"))
    }

    fn helper_path(&self) -> PathBuf {
        self.dir.join(helper_name())
    }

    fn installed(&self, t: &TierDef) -> bool {
        self.vision_path(t).is_file()
    }

    fn faces_installed(&self) -> bool {
        self.helper_path().is_file() && self.dir.join(faces::DETECT).is_file() && self.dir.join(faces::EMBED).is_file() && self.helper_knows_faces()
    }

    /// Ältere Helfer-Programme (vor der Gesichtserkennung) kennen `--faces` nicht → neu laden
    fn helper_knows_faces(&self) -> bool {
        let p = self.helper_path();
        let Ok(meta) = fs::metadata(&p) else { return false };
        let stamp = (meta.len(), meta.modified().ok());
        if let Some((st, ok)) = *self.helper_probe.lock().unwrap() {
            if st == stamp {
                return ok;
            }
        }
        let ok = faces::probe(&p, &self.dir);
        *self.helper_probe.lock().unwrap() = Some((stamp, ok));
        ok
    }

    /// Prüfsumme des geladenen Helfer-Programms (fehlt bei Installationen älterer Fassungen)
    fn helper_sum_path(&self) -> PathBuf {
        self.dir.join(format!("{}.sha256", helper_name()))
    }

    /// Helfer-Programm vorhanden, aber veraltet (ältere Fassung oder ohne Gesichtserkennung)
    fn helper_old(&self, faces_on: bool) -> bool {
        self.helper_path().is_file() && (!self.helper_sum_path().is_file() || (faces_on && !self.helper_knows_faces()))
    }

    fn chat_installed(&self, t: &TierDef) -> bool {
        t.llm.is_some_and(|id| self.llm_path(id).is_file() && self.helper_path().is_file())
    }

    /// Sprachmodell für den Chat starten (falls nötig) – liefert Fehlertext, wenn es nicht geht
    pub fn ensure_chat(&self) -> Result<Arc<llm::Llm>, String> {
        let (t, enabled, threads) = {
            let g = self.inner.lock().unwrap();
            (g.tier, g.enabled, g.threads)
        };
        let id = t.llm.ok_or("Diese KI-Stufe hat kein Sprachmodell")?;
        if !enabled {
            return Err("KI ist ausgeschaltet".into());
        }
        if !self.chat_installed(t) {
            return Err("Sprachmodell nicht installiert".into());
        }
        if !hw::detect().chat_ok {
            return Err("Prozessor zu alt für das Sprachmodell".into());
        }
        // Chat darf mehr Kerne nutzen als die Hintergrund-Analyse (er läuft nur kurz)
        let n = hw::detect().cores.max(threads).max(1);
        self.llm.start(&self.helper_path(), &self.llm_path(id), n, cfg!(all(target_os = "macos", target_arch = "aarch64")))?;
        Ok(self.llm.clone())
    }

    fn send(&self, ev: &str, v: Value) {
        if let Some(e) = self.emit.lock().unwrap().as_ref() {
            e(ev, v);
        }
    }

    pub fn status(&self) -> Status {
        let faces_on = self.inner.lock().unwrap().faces_on;
        // Prüfen des Helfers kann kurz dauern → nicht unter der Sperre
        let faces_ready = faces_on && self.faces_installed();
        let helper_old = self.helper_old(faces_on);
        let g = self.inner.lock().unwrap();
        let indexed = match &g.store {
            Some(s) => g.ids.values().filter(|k| s.map.contains_key(*k) || g.failed.contains(*k)).count(),
            None => 0,
        };
        let t = g.tier;
        let vision = self.installed(t);
        let chat = self.chat_installed(t);
        Status {
            enabled: g.enabled,
            tier: t.id.to_string(),
            installed: vision && (t.llm.is_none() || chat) && (!g.faces_on || faces_ready),
            vision,
            chat,
            chat_running: self.llm.running(),
            faces: g.faces_on,
            faces_ready,
            face_total: g.fstore.as_ref().map_or(0, |f| f.map.values().map(Vec::len).sum()),
            learning: g.queue.iter().filter(|j| matches!(j.kind, JobKind::Folder(_))).count() + g.folder_busy,
            faces_pending: match &g.fstore {
                Some(f) if g.faces_on => g.ids.values().filter(|k| !f.map.contains_key(*k) && !g.face_failed.contains(*k) && !g.failed.contains(*k)).count(),
                _ => 0,
            },
            face_error: g.face_error.clone(),
            helper_old,
            downloading: g.downloading,
            received: self.dl_got.load(Ordering::Relaxed),
            size: self.dl_total.load(Ordering::Relaxed),
            indexed,
            total: g.ids.len().max(g.total),
            examples: g.learned.examples.len(),
            threads: g.threads,
            error: g.load_error.clone(),
            hw: hw::detect(),
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
    pub fn configure(self: &Arc<Self>, enabled: bool, perf: &str, tier_id: &str, faces_on: bool) {
        let threads = threads_for(perf);
        let t = tier(tier_id);
        let mut g = self.inner.lock().unwrap();
        let wanted = faces_on;
        let faces_on = enabled && faces_on;
        if faces_on && g.fstore.is_none() {
            // ältere Fassung (Kästen in Pixeln) ist nicht mehr brauchbar
            let _ = fs::remove_file(self.dir.join("gesichter.bin"));
            g.fstore = Some(faces::FaceStore::load(self.dir.join(FACE_FILE)));
        } else if !faces_on {
            g.fstore = None;
            self.fproc.stop();
            // Gesichtserkennung ausgeschaltet → gespeicherte Gesichter löschen (Datenschutz).
            // Ist nur die ganze KI aus, bleiben sie für das Wiedereinschalten.
            if !wanted {
                let _ = fs::remove_file(self.dir.join(FACE_FILE));
            }
        }
        let faces_changed = g.faces_on != faces_on;
        g.faces_on = faces_on;
        let was = g.enabled;
        let tier_changed = !std::ptr::eq(g.tier, t);
        let changed = was != enabled || g.threads != threads || tier_changed || faces_changed;
        g.enabled = enabled;
        g.tier = t;
        g.threads = if enabled { threads } else { 0 };
        if !enabled || tier_changed {
            g.model = None;
            g.store = None;
            g.queue.clear();
            g.ids.clear();
            g.failed.clear();
            g.total = 0;
            g.learned = Learned::default();
            g.labels = None;
            g.texts.clear();
            self.llm.stop();
        }
        if enabled && g.store.is_none() {
            let stem = t.vision.trim_end_matches(".safetensors");
            g.store = Some(Store::load(self.dir.join(format!("fingerabdruecke-{stem}.bin")), t.dim));
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
        if !self.installed(self.cur_tier()) {
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
                    if self.installed(g.tier) && g.load_error.is_none() {
                        if let Some(j) = g.queue.pop_front() {
                            g.busy += 1;
                            if matches!(j.kind, JobKind::Folder(_)) {
                                g.folder_busy += 1;
                            }
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
            let (need_emb, need_faces) = {
                let g = self.inner.lock().unwrap();
                let has = g.store.as_ref().is_some_and(|s| s.map.contains_key(&job.key));
                let fdone = g.fstore.as_ref().map_or(true, |f| f.map.contains_key(&job.key));
                (!has, g.faces_on && !fdone && !g.face_failed.contains(&job.key))
            };
            let need_faces = need_faces && self.faces_installed();
            let res = if need_emb { self.model().and_then(|m| self.embed_file(&m, &mut sc, &job.path).ok_or_else(String::new)).map(Some) } else { Ok(None) };
            let found = if need_faces && res.is_ok() { Some(self.faces_of_file(&job.path)) } else { None };
            let mut g = self.inner.lock().unwrap();
            g.busy -= 1;
            if matches!(job.kind, JobKind::Folder(_)) {
                g.folder_busy -= 1;
            }
            g.last_use = Some(Instant::now());
            match found {
                Some(Ok(f)) => {
                    g.face_error = None;
                    if let Some(fs_) = g.fstore.as_mut() {
                        fs_.put(job.key, f);
                    }
                }
                Some(Err(e)) => {
                    log_ai(&self.dir, &format!("Gesichter: {e}"));
                    g.face_error = Some(e);
                    g.face_failed.insert(job.key);
                }
                None => {}
            }
            match res {
                Ok(e) => {
                    if let (Some(s), Some(e)) = (g.store.as_mut(), e) {
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
                self.prepare_labels();
            }
        }
    }

    /// Gesichter eines Fotos (größere Vorschau, damit auch kleine Gesichter gefunden werden)
    fn faces_of_file(&self, path: &Path) -> Result<Vec<faces::FaceRec>, String> {
        let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy().to_lowercase())).unwrap_or_default();
        // nicht lesbar (z. B. kaputte Datei) → keine Gesichter, kein Fehler der Erkennung
        let Some(jpg) = thumbs::render(path, &ext, 1280, 88) else { return Ok(vec![]) };
        let (w, h) = image::ImageReader::new(std::io::Cursor::new(&jpg))
            .with_guessed_format()
            .ok()
            .and_then(|r| r.into_dimensions().ok())
            .ok_or("Bildgröße unbekannt")?;
        let tmp = self.dir.join(format!("gesicht-{:?}.jpg", std::thread::current().id()).replace(['(', ')', ' '], ""));
        fs::write(&tmp, jpg).map_err(|e| e.to_string())?;
        let r = self.fproc.detect(&self.helper_path(), &self.dir, &tmp);
        let _ = fs::remove_file(&tmp);
        // Kästen relativ zur Bildgröße (passt so auf jede Anzeigegröße), von links nach rechts
        let (w, h) = (w.max(1) as f32, h.max(1) as f32);
        let mut faces = r?;
        for f in &mut faces {
            f.bbox = [f.bbox[0] / w, f.bbox[1] / h, f.bbox[2] / w, f.bbox[3] / h];
        }
        faces.sort_by(|a, b| a.bbox[0].total_cmp(&b.bbox[0]));
        Ok(faces)
    }

    /// Alle Gesichter (je 128 Zahlen) auf diesen Fotos – zum Merken ("das ist meine Familie")
    pub fn face_embs(&self, ids: &[u64]) -> Vec<Vec<f32>> {
        let g = self.inner.lock().unwrap();
        let Some(fs_) = &g.fstore else { return vec![] };
        ids.iter().filter_map(|id| g.ids.get(id).and_then(|k| fs_.map.get(k))).flatten().map(|f| f.emb.clone()).collect()
    }

    /// Anzahl Gesichter auf einem Foto (None = noch nicht untersucht)
    pub fn face_count(&self, id: u64) -> Option<usize> {
        let g = self.inner.lock().unwrap();
        g.ids.get(&id).and_then(|k| g.fstore.as_ref()?.map.get(k)).map(Vec::len)
    }

    /// Gesichter auf Fotos mit der Person, die es ist (gemerkte Personen, je Person einige Beispiele).
    /// Fotos, die noch nicht untersucht sind, fehlen in der Antwort.
    pub fn people_on(&self, ids: &[u64], people: &[Vec<Vec<f32>>], min: f32, with_emb: bool) -> Vec<PhotoFaces> {
        let g = self.inner.lock().unwrap();
        let Some(fs_) = &g.fstore else { return vec![] };
        ids.iter()
            .filter_map(|&id| {
                let faces = g.ids.get(&id).and_then(|k| fs_.map.get(k))?;
                let who = faces::assign(faces, people, min);
                Some(PhotoFaces {
                    id,
                    faces: faces
                        .iter()
                        .zip(who)
                        .map(|(f, (person, p))| FaceInfo { bbox: f.bbox, person, p, emb: with_emb.then(|| f.emb.clone()) })
                        .collect(),
                })
            })
            .collect()
    }

    /// Unbekannte Gesichter, die mehrfach vorkommen, zu Gruppen zusammenfassen ("Wer ist das?")
    pub fn face_clusters(&self, ids: &[u64], people: &[Vec<Vec<f32>>], min_size: usize) -> Vec<FaceCluster> {
        let g = self.inner.lock().unwrap();
        let Some(fs_) = &g.fstore else { return vec![] };
        let mut all: Vec<(u64, usize, &[f32])> = Vec::new();
        let mut boxes: Vec<[f32; 4]> = Vec::new();
        for &id in ids {
            let Some(faces) = g.ids.get(&id).and_then(|k| fs_.map.get(k)) else { continue };
            let who = faces::assign(faces, people, FACE_SAME);
            for (i, (f, w)) in faces.iter().zip(who).enumerate() {
                // sehr kleine Gesichter (Hintergrund) nicht abfragen
                if w.0.is_none() && f.bbox[2] >= 0.02 {
                    all.push((id, i, &f.emb));
                    boxes.push(f.bbox);
                }
            }
        }
        faces::cluster(&all, 0.5, min_size)
            .into_iter()
            .take(30)
            .map(|m| FaceCluster {
                samples: m.iter().take(12).map(|&i| all[i].2.to_vec()).collect(),
                members: m.iter().map(|&i| ClusterFace { id: all[i].0, face: all[i].1, bbox: boxes[i] }).collect(),
            })
            .collect()
    }

    /// Ausschnitt eines Gesichts als kleines Bild (für Listen und zum Benennen)
    pub fn face_crop(&self, path: &Path, bbox: [f32; 4], size: u32) -> Option<String> {
        let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy().to_lowercase())).unwrap_or_default();
        let key = thumbs::Cache::key(path, &format!("face-{:.3}-{:.3}-{size}", bbox[0], bbox[1]));
        let cached = key.as_ref().and_then(|k| fs::read(self.cache.thumb_path(k)).ok());
        let jpg = match cached {
            Some(b) => b,
            None => {
                let img = image::load_from_memory(&thumbs::render(path, &ext, 1280, 90)?).ok()?;
                let (w, h) = (img.width() as f32, img.height() as f32);
                // Quadrat um das Gesicht mit etwas Rand
                let side = (bbox[2] * w).max(bbox[3] * h) * 1.5;
                let cx = (bbox[0] + bbox[2] / 2.0) * w;
                let cy = (bbox[1] + bbox[3] / 2.0) * h;
                let x = (cx - side / 2.0).clamp(0.0, (w - 1.0).max(0.0));
                let y = (cy - side / 2.0).clamp(0.0, (h - 1.0).max(0.0));
                let sw = side.min(w - x).max(1.0);
                let sh = side.min(h - y).max(1.0);
                let crop = img.crop_imm(x as u32, y as u32, sw as u32, sh as u32).resize_to_fill(size, size, image::imageops::FilterType::Triangle);
                let mut out = Vec::new();
                image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 85).encode_image(&crop.to_rgb8()).ok()?;
                if let Some(k) = &key {
                    self.cache.store_thumb(k, &out);
                }
                out
            }
        };
        Some(format!("data:image/jpeg;base64,{}", b64(&jpg)))
    }

    /// Fingerabdruck eines Bildausschnitts (oder des ganzen Fotos) – Beispiel für ein gemerktes Ding
    pub fn embed_region(&self, path: &Path, bbox: Option<[f32; 4]>) -> Result<Vec<f32>, String> {
        let m = self.model()?;
        let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy().to_lowercase())).unwrap_or_default();
        let jpg = thumbs::render(path, &ext, 768, 90).ok_or("Foto lässt sich nicht lesen")?;
        let mut img = image::load_from_memory(&jpg).map_err(|e| e.to_string())?;
        if let Some(b) = bbox {
            let (w, h) = (img.width() as f32, img.height() as f32);
            // etwas Rand dazu, damit das Ding ganz drauf ist
            let pad = 0.06;
            let x0 = ((b[0] - pad * b[2]).max(0.0) * w) as u32;
            let y0 = ((b[1] - pad * b[3]).max(0.0) * h) as u32;
            let x1 = (((b[0] + b[2] * (1.0 + pad)).min(1.0)) * w) as u32;
            let y1 = (((b[1] + b[3] * (1.0 + pad)).min(1.0)) * h) as u32;
            if x1 > x0 + 8 && y1 > y0 + 8 {
                img = img.crop_imm(x0, y0, x1 - x0, y1 - y0);
            }
        }
        let mut sc = net::Scratch::default();
        let mut v = m.image(&mut sc, &m.prepare(&img));
        let n = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-9);
        v.iter_mut().for_each(|x| *x /= n);
        Ok(v)
    }

    /// Wie ähnlich ist jedes Foto jedem gemerkten Ding? Je Ding: beste Ähnlichkeit zu den Beispielen;
    /// ist ein Gegenbeispiel ("das ist nicht mein Auto") ähnlicher, zählt das Foto nicht (−1).
    pub fn thing_scores(&self, ids: &[u64], things: &[ThingEx]) -> Vec<ThingScores> {
        let g = self.inner.lock().unwrap();
        let Some(store) = &g.store else { return vec![] };
        let unit = |v: &Vec<f32>| {
            let n = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-9);
            v.iter().map(|x| x / n).collect::<Vec<f32>>()
        };
        let things: Vec<(Vec<Vec<f32>>, Vec<Vec<f32>>)> = things.iter().map(|t| (t.pos.iter().map(unit).collect(), t.neg.iter().map(unit).collect())).collect();
        ids.iter()
            .filter_map(|&id| {
                let e = store.map.get(g.ids.get(&id)?)?;
                let norm = e.q.iter().map(|&x| (x as f32 * e.s).powi(2)).sum::<f32>().sqrt().max(1e-9);
                let s = things
                    .iter()
                    .map(|(pos, neg)| {
                        let best = |l: &Vec<Vec<f32>>| l.iter().filter(|x| x.len() == e.q.len()).map(|x| e.dot(x) / norm).fold(-1.0f32, f32::max);
                        let p = best(pos);
                        if !neg.is_empty() && best(neg) > p { -1.0 } else { p }
                    })
                    .collect();
                Some(ThingScores { id, s })
            })
            .collect()
    }

    /// Gelernte Beispiele zum Mitnehmen auf einen anderen Computer (mit ihren Fingerabdrücken)
    pub fn export_learned(&self) -> Value {
        let g = self.inner.lock().unwrap();
        let Some(store) = &g.store else { return Value::Null };
        let ex: Vec<Value> = g
            .learned
            .examples
            .iter()
            .filter_map(|e| {
                let mut k = [0u8; 20];
                hex::decode_to_slice(&e.k, &mut k).ok()?;
                let emb = store.map.get(&k)?;
                Some(json!({ "t": e.t, "k": e.k, "f": e.f, "s": emb.s, "q": b64(&emb.q.iter().map(|&x| x as u8).collect::<Vec<_>>()) }))
            })
            .collect();
        json!({ "tier": g.tier.id, "dim": g.tier.dim, "examples": ex })
    }

    /// Gelernte Beispiele übernehmen; `remap`: alter Ordnerpfad → neuer (anderer Computer)
    pub fn import_learned(&self, data: &Value, remap: &HashMap<String, String>) -> usize {
        let mut g = self.inner.lock().unwrap();
        if data["tier"].as_str() != Some(g.tier.id) {
            return 0;
        }
        let dim = g.tier.dim;
        let Some(ex) = data["examples"].as_array() else { return 0 };
        let have: HashSet<(String, String)> = g.learned.examples.iter().map(|e| (e.t.clone(), e.k.clone())).collect();
        let mut n = 0;
        for e in ex {
            let (Some(t), Some(k), Some(q), Some(sc)) = (e["t"].as_str(), e["k"].as_str(), e["q"].as_str(), e["s"].as_f64()) else { continue };
            let t = remap.get(t).cloned().unwrap_or_else(|| t.to_string());
            let Some(bytes) = unb64(q).filter(|b| b.len() == dim) else { continue };
            let mut key = [0u8; 20];
            if hex::decode_to_slice(k, &mut key).is_err() || have.contains(&(t.clone(), k.to_string())) {
                continue;
            }
            if let Some(st) = g.store.as_mut() {
                if !st.map.contains_key(&key) {
                    st.put(key, Emb { q: bytes.iter().map(|&b| b as i8).collect(), s: sc as f32 });
                }
            }
            g.learned.examples.push(Example { t, k: k.to_string(), f: e["f"].as_bool().unwrap_or(false) });
            n += 1;
        }
        let l = std::mem::take(&mut g.learned);
        self.save_learned(&l);
        g.learned = l;
        drop(g);
        self.push_status();
        n
    }

    /// Fotos mit Gesichtern einer gemerkten Gruppe: je Foto die beste Gruppe (cos ≥ min)
    pub fn face_matches(&self, groups: &[Vec<Vec<f32>>], ids: &[u64], min: f32) -> Vec<RuleHit> {
        let g = self.inner.lock().unwrap();
        let Some(fs_) = &g.fstore else { return vec![] };
        let mut out = Vec::new();
        for &id in ids {
            let Some(faces) = g.ids.get(&id).and_then(|k| fs_.map.get(k)) else { continue };
            let mut best: Option<(usize, f32)> = None;
            for (i, gr) in groups.iter().enumerate() {
                let c = faces::best_match(faces, gr);
                if c >= min && best.map_or(true, |b| c > b.1) {
                    best = Some((i, c));
                }
            }
            if let Some((rule, p)) = best {
                out.push(RuleHit { id, rule, p });
            }
        }
        out
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
                    let faces_missing = g.faces_on && g.fstore.as_ref().is_some_and(|f| !f.map.contains_key(&k));
                    let known = (g.store.as_ref().is_some_and(|s| s.map.contains_key(&k)) && !faces_missing) || g.failed.contains(&k);
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
                let fkey = format!("{}|{}", me.cur_tier().id, t.dir);
                if me.inner.lock().unwrap().learned.folders.contains(&fkey) && !t.again {
                    continue;
                }
                let files = if t.all { direct_images(Path::new(&t.dir), MAX_EXAMPLES) } else { sample_images(Path::new(&t.dir), FOLDER_SAMPLES) };
                let mut g = me.inner.lock().unwrap();
                if !g.enabled {
                    return;
                }
                g.learned.folders.insert(fkey);
                for p in files {
                    let Some(k) = key_of(&p) else { continue };
                    let hk = hex::encode(k);
                    if g.learned.examples.iter().any(|e| e.t == t.target && e.k == hk) {
                        continue;
                    }
                    if g.store.as_ref().is_some_and(|s| s.map.contains_key(&k)) {
                        g.learned.examples.push(Example { t: t.target.clone(), k: hk, f: true });
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

    /// Wie wahrscheinlich zeigt jedes Foto den jeweiligen Begriff? (für gemerkte Regeln
    /// wie "Fotos mit Autos → Ordner Autos"). Liefert je Foto die beste Regel mit Wahrscheinlichkeit ≥ `min`.
    pub fn rule_matches(&self, texts: &[String], ids: &[u64], min: f32) -> Result<Vec<RuleHit>, String> {
        if texts.is_empty() {
            return Ok(vec![]);
        }
        let m = self.model()?;
        let mut sc = net::Scratch::default();
        let mut embs = Vec::new();
        for t in texts {
            let cached = self.inner.lock().unwrap().texts.get(t).cloned();
            let e = match cached {
                Some(e) => e,
                None => {
                    let e = m.text(&mut sc, t);
                    self.inner.lock().unwrap().texts.insert(t.clone(), e.clone());
                    e
                }
            };
            embs.push(e);
        }
        let (k, bias, siglip) = (m.scale(), m.w.mf("logit_bias"), m.w.siglip());
        let g = self.inner.lock().unwrap();
        let Some(store) = &g.store else { return Ok(vec![]) };
        let mut out = Vec::new();
        for &id in ids {
            let Some(e) = g.ids.get(&id).and_then(|k| store.map.get(k)) else { continue };
            let mut best: Option<(usize, f32)> = None;
            for (i, t) in embs.iter().enumerate() {
                let logit = e.dot(t) * k;
                // SigLIP liefert echte Wahrscheinlichkeiten (mit gelerntem Versatz), CLIP nur Ähnlichkeit
                let p = if siglip { 1.0 / (1.0 + (-(logit + bias)).exp()) } else { 1.0 / (1.0 + (-(logit - 27.0) * 1.2).exp()) };
                if p >= min && best.map_or(true, |b| p > b.1) {
                    best = Some((i, p));
                }
            }
            if let Some((rule, p)) = best {
                out.push(RuleHit { id, rule, p });
            }
        }
        Ok(out)
    }

    pub fn search(&self, text: &str, among: Option<Vec<u64>>, limit: usize) -> Result<Vec<Hit>, String> {
        let m = self.model()?;
        let mut sc = net::Scratch::default();
        let v = m.text(&mut sc, text);
        let k = m.scale();
        Ok(self.rank(&v, among, limit).into_iter().map(|h| Hit { id: h.id, score: h.score * k }).collect())
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

    /// Fingerabdrücke aller Begriffe (beim ersten Mal ausrechnen – mehrere Kerne, dann gespeichert)
    fn label_embeds(&self) -> Result<Arc<Vec<Vec<f32>>>, String> {
        if let Some(l) = self.inner.lock().unwrap().labels.clone() {
            return Ok(l);
        }
        let m = self.model()?;
        let siglip = m.w.siglip();
        let stem = self.cur_tier().vision.trim_end_matches(".safetensors");
        let file = self.dir.join(format!("begriffe-{stem}-{}.bin", labels::LABELS.len()));
        let dim = m.w.m("embed_dim").max(m.w.m("v_dim"));
        let mut out: Vec<Vec<f32>> = Vec::new();
        if let Ok(b) = fs::read(&file) {
            let v: Vec<f32> = b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
            if !v.is_empty() && v.len() % labels::LABELS.len() == 0 {
                let d = v.len() / labels::LABELS.len();
                out = v.chunks(d).map(<[f32]>::to_vec).collect();
            }
        }
        if out.is_empty() {
            let threads = hw::detect().cores.clamp(1, 8);
            let chunks: Vec<&[(&str, &str)]> = labels::LABELS.chunks(labels::LABELS.len().div_ceil(threads)).collect();
            out = std::thread::scope(|sc| {
                let hs: Vec<_> = chunks
                    .iter()
                    .map(|ch| {
                        let m = m.clone();
                        sc.spawn(move || {
                            let mut scr = net::Scratch::default();
                            ch.iter()
                                .map(|(en, de)| if siglip { m.text(&mut scr, &format!("a photo of {en}.")) } else { m.text(&mut scr, &format!("ein Foto: {de}")) })
                                .collect::<Vec<_>>()
                        })
                    })
                    .collect();
                hs.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
            });
            let bytes: Vec<u8> = out.iter().flatten().flat_map(|f| f.to_le_bytes()).collect();
            let _ = fs::write(&file, bytes);
            let _ = dim;
        }
        let l = Arc::new(out);
        self.inner.lock().unwrap().labels = Some(l.clone());
        Ok(l)
    }

    /// Begriffe im Hintergrund vorbereiten (einmal je Modell)
    pub fn prepare_labels(self: &Arc<Self>) {
        if self.inner.lock().unwrap().labels.is_some() || self.labels_busy.swap(true, Ordering::SeqCst) {
            return;
        }
        let me = self.clone();
        std::thread::spawn(move || {
            lower_priority();
            let _ = me.label_embeds();
            me.labels_busy.store(false, Ordering::SeqCst);
        });
    }

    /// Stichwörter für ein Foto: (deutscher Begriff, Wert) – die besten zuerst.
    /// Sind die Begriffe noch nicht vorbereitet, kommt sofort ein Fehler (der Chat wartet nicht).
    pub fn tags(self: &Arc<Self>, id: u64, n: usize) -> Result<Vec<(String, f32)>, String> {
        if self.inner.lock().unwrap().labels.is_none() {
            self.prepare_labels();
            return Err("Begriffe werden vorbereitet".into());
        }
        let e = {
            let g = self.inner.lock().unwrap();
            let k = g.ids.get(&id).ok_or("Foto noch nicht analysiert")?;
            g.store.as_ref().and_then(|s| s.map.get(k)).ok_or("Foto noch nicht analysiert")?.clone()
        };
        let labels = self.label_embeds()?;
        let k = self.model()?.scale();
        let mut sc: Vec<(usize, f32)> = labels.iter().enumerate().map(|(i, v)| (i, e.dot(v) * k)).collect();
        sc.sort_by(|a, b| b.1.total_cmp(&a.1));
        let best = sc.first().map(|x| x.1).unwrap_or(0.0);
        Ok(sc
            .into_iter()
            .take(n)
            .filter(|(_, s)| *s >= best - 3.0)
            .map(|(i, s)| (labels::LABELS[i].1.to_string(), s))
            .collect())
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
                log_ai(&me.dir, &format!("Download fehlgeschlagen: {e}"));
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

    fn agent() -> ureq::Agent {
        ureq::Agent::config_builder().timeout_connect(Some(Duration::from_secs(20))).build().into()
    }

    /// Dateien eines Releases: Name → (Adresse, Größe, Prüfsumme)
    fn release_assets(agent: &ureq::Agent, tag: &str) -> Result<HashMap<String, (String, u64, Option<String>)>, String> {
        let rel: Value = agent
            .get(&format!("{RELEASES}{tag}"))
            .header("User-Agent", "SlimSort")
            .header("Accept", "application/vnd.github+json")
            .call()
            .map_err(|e| format!("GitHub nicht erreichbar ({e})"))?
            .body_mut()
            .read_to_string()
            .map_err(|e| e.to_string())
            .and_then(|t| serde_json::from_str(&t).map_err(|e| e.to_string()))?;
        Ok(rel["assets"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|a| {
                Some((
                    a["name"].as_str()?.to_string(),
                    (
                        a["browser_download_url"].as_str()?.to_string(),
                        a["size"].as_u64().unwrap_or(0),
                        a["digest"].as_str().and_then(|d| d.strip_prefix("sha256:")).map(str::to_lowercase),
                    ),
                ))
            })
            .collect())
    }

    /// Eine Datei am Stück laden und an `out` anhängen (wenn die Größe unbekannt ist)
    fn fetch_into(&self, agent: &ureq::Agent, url: &str, out: &mut File) -> Result<u64, String> {
        let mut resp = agent.get(url).header("User-Agent", "SlimSort").call().map_err(|e| format!("Download fehlgeschlagen ({e})"))?;
        let mut body = resp.body_mut().with_config().limit(4 << 30).reader();
        let mut buf = vec![0u8; 1 << 16];
        let mut got = 0u64;
        loop {
            if self.cancel_dl.load(Ordering::SeqCst) {
                return Err("abgebrochen".into());
            }
            let n = body.read(&mut buf).map_err(|e| format!("Download unterbrochen ({e})"))?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n]).map_err(|e| format!("Speichern fehlgeschlagen ({e})"))?;
            got += n as u64;
            self.dl_got.fetch_add(n as u64, Ordering::Relaxed);
        }
        Ok(got)
    }

    /// Ein Stück (Byte-Bereich) laden und an die richtige Stelle der Datei schreiben
    fn fetch_range(&self, agent: &ureq::Agent, url: &str, off: u64, len: u64, file: &File, pos: u64) -> Result<(), String> {
        let mut resp = agent
            .get(url)
            .header("User-Agent", "SlimSort")
            .header("Range", &format!("bytes={}-{}", off, off + len - 1))
            .call()
            .map_err(|e| format!("Download fehlgeschlagen ({e})"))?;
        if resp.status().as_u16() != 206 {
            return Err("Server unterstützt keine Teil-Downloads".into());
        }
        let mut body = resp.body_mut().with_config().limit(len + 1).reader();
        let mut buf = vec![0u8; 1 << 16];
        let mut got = 0u64;
        let r = (|| {
            loop {
                if self.cancel_dl.load(Ordering::SeqCst) {
                    return Err("abgebrochen".to_string());
                }
                let n = body.read(&mut buf).map_err(|e| format!("Download unterbrochen ({e})"))?;
                if n == 0 {
                    break;
                }
                write_at(file, &buf[..n], pos + got).map_err(|e| format!("Speichern fehlgeschlagen ({e})"))?;
                got += n as u64;
                self.dl_got.fetch_add(n as u64, Ordering::Relaxed);
            }
            if got != len {
                return Err("Download unvollständig".to_string());
            }
            Ok(())
        })();
        if r.is_err() {
            // halb geladenes Stück zählt nicht
            let cur = self.dl_got.load(Ordering::Relaxed);
            self.dl_got.store(cur.saturating_sub(got), Ordering::Relaxed);
        }
        r
    }

    /// Datei (ggf. aus mehreren Teilen) laden: in Stücken über mehrere Verbindungen gleichzeitig
    /// (GitHub bremst jede einzelne Verbindung), jedes Stück mit mehreren Versuchen. Abgebrochene
    /// Downloads machen beim nächsten Mal an der gleichen Stelle weiter. Am Ende: Prüfsumme.
    fn fetch_file(&self, agent: &ureq::Agent, urls: &[(String, u64)], dest: &Path, want_sha: Option<&str>) -> Result<(), String> {
        const CHUNK: u64 = 4 << 20;
        const CONNS: usize = 8;
        let part = dest.with_extension("part");
        let state = dest.with_extension("part.json");

        if urls.iter().any(|u| u.1 == 0) {
            // Größe unbekannt (lokaler Test-Server): am Stück
            let mut out = File::create(&part).map_err(|e| e.to_string())?;
            for (u, _) in urls {
                if let Err(e) = self.fetch_into(agent, u, &mut out) {
                    drop(out);
                    let _ = fs::remove_file(&part);
                    return Err(e);
                }
            }
            out.sync_all().map_err(|e| e.to_string())?;
        } else {
            let total: u64 = urls.iter().map(|u| u.1).sum();
            // Stücke: (Teil, Anfang im Teil, Länge, Stelle in der Datei)
            let mut chunks = Vec::new();
            let mut base = 0u64;
            for (i, (_, size)) in urls.iter().enumerate() {
                let mut o = 0;
                while o < *size {
                    let l = CHUNK.min(size - o);
                    chunks.push((i, o, l, base + o));
                    o += l;
                }
                base += size;
            }
            // Weitermachen? (gleiche Dateien, gleiche Stückgröße)
            let sig = format!("{total}|{CHUNK}|{}", urls.iter().map(|u| u.0.as_str()).collect::<Vec<_>>().join(","));
            let mut done: HashSet<usize> = HashSet::new();
            if fs::metadata(&part).map(|m| m.len() == total).unwrap_or(false) {
                if let Ok(v) = fs::read(&state).map_err(|_| ()).and_then(|b| serde_json::from_slice::<Value>(&b).map_err(|_| ())) {
                    if v["sig"].as_str() == Some(sig.as_str()) {
                        done = v["done"].as_array().into_iter().flatten().filter_map(|x| x.as_u64().map(|x| x as usize)).collect();
                    }
                }
            }
            let file = OpenOptions::new().create(true).write(true).truncate(false).open(&part).map_err(|e| e.to_string())?;
            file.set_len(total).map_err(|e| e.to_string())?;
            self.dl_got.fetch_add(done.iter().map(|&c| chunks[c].2).sum::<u64>(), Ordering::Relaxed);
            let queue = Mutex::new((0..chunks.len()).filter(|c| !done.contains(c)).collect::<VecDeque<_>>());
            let done = Mutex::new((done, Instant::now()));
            let err: Mutex<Option<String>> = Mutex::new(None);
            let save = |d: &HashSet<usize>| {
                let _ = fs::write(&state, json!({ "sig": sig, "done": d.iter().collect::<Vec<_>>() }).to_string());
            };
            std::thread::scope(|sc| {
                let hs: Vec<_> = (0..CONNS)
                    .map(|_| {
                        sc.spawn(|| loop {
                            if err.lock().unwrap().is_some() {
                                return;
                            }
                            let Some(ci) = queue.lock().unwrap().pop_front() else { return };
                            let (ui, off, len, pos) = chunks[ci];
                            let mut res = Err(String::new());
                            for attempt in 0..5u64 {
                                res = self.fetch_range(agent, &urls[ui].0, off, len, &file, pos);
                                match &res {
                                    Ok(()) => break,
                                    Err(e) if e == "abgebrochen" => break,
                                    Err(_) => std::thread::sleep(Duration::from_secs(1 + attempt * 2)),
                                }
                            }
                            match res {
                                Ok(()) => {
                                    let mut d = done.lock().unwrap();
                                    d.0.insert(ci);
                                    if d.1.elapsed() > Duration::from_secs(2) {
                                        d.1 = Instant::now();
                                        save(&d.0);
                                    }
                                }
                                Err(e) => {
                                    let mut er = err.lock().unwrap();
                                    if er.is_none() {
                                        *er = Some(e);
                                    }
                                    return;
                                }
                            }
                        })
                    })
                    .collect();
                // Fortschritt melden, bis alle Verbindungen fertig sind
                while hs.iter().any(|h| !h.is_finished()) {
                    std::thread::sleep(Duration::from_millis(300));
                    self.push_status();
                }
            });
            let d = done.into_inner().unwrap().0;
            save(&d);
            if let Some(e) = err.into_inner().unwrap() {
                // .part und Stand bleiben liegen → beim nächsten Mal geht es hier weiter
                return Err(e);
            }
            file.sync_all().map_err(|e| e.to_string())?;
        }
        if let Some(w) = want_sha {
            // Prüfsumme über die fertige Datei
            let mut f = File::open(&part).map_err(|e| e.to_string())?;
            let mut sha = Sha256::new();
            let mut buf = vec![0u8; 1 << 20];
            loop {
                let n = f.read(&mut buf).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                sha.update(&buf[..n]);
            }
            if hex::encode(sha.finalize()) != w {
                let _ = fs::remove_file(&part);
                let _ = fs::remove_file(&state);
                return Err("Download beschädigt (Prüfsumme falsch)".to_string());
            }
        }
        let _ = fs::remove_file(&state);
        fs::rename(&part, dest).map_err(|e| e.to_string())
    }

    fn download_inner(&self) -> Result<(), String> {
        let agent = Self::agent();
        let t = self.cur_tier();
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        // Nur im Testmodus: Bildmodell von einer anderen Adresse (lokaler Server im E2E-Test)
        let test_url = std::env::var("FOTOSORT_TEST").ok().and(std::env::var("FOTOSORT_AI_URL").ok());
        let vision_dest = self.dir.join(t.vision);
        let mut jobs: Vec<(Vec<(String, u64)>, PathBuf, Option<String>)> = Vec::new();
        if !vision_dest.is_file() {
            match &test_url {
                Some(u) => jobs.push((vec![(u.clone(), 0)], vision_dest, None)),
                None => {
                    let a = Self::release_assets(&agent, t.tag)?;
                    let (u, size, d) = a.get(t.vision).cloned().ok_or("Bildmodell nicht gefunden")?;
                    jobs.push((vec![(u, size)], vision_dest, d));
                }
            }
        }
        // Gesichter: Helfer + zwei kleine Modelle
        if self.inner.lock().unwrap().faces_on && !self.faces_installed() {
            let a = Self::release_assets(&agent, LLM_TAG)?;
            for n in [faces::DETECT, faces::EMBED] {
                if !self.dir.join(n).is_file() {
                    let (u, size, d) = a.get(n).cloned().ok_or("Gesichtsmodell nicht gefunden")?;
                    jobs.push((vec![(u, size)], self.dir.join(n), d));
                }
            }
        }
        // Helfer-Programm: fehlt, ist veraltet oder es gibt eine neue Fassung → (neu) laden
        let faces_on = self.inner.lock().unwrap().faces_on;
        if faces_on || t.llm.is_some() {
            let a = Self::release_assets(&agent, LLM_TAG)?;
            let (u, size, d) = a.get(&helper_name()).cloned().ok_or("Helfer-Programm für dieses System fehlt")?;
            let have = fs::read_to_string(self.helper_sum_path()).ok();
            let stale = !self.helper_path().is_file()
                || (d.is_some() && have.as_deref().map(str::trim) != d.as_deref())
                || (faces_on && !self.helper_knows_faces());
            if stale {
                if t.llm.is_some() && !hw::detect().chat_ok && !faces_on {
                    return Err("Dein Prozessor ist zu alt für das Sprachmodell. Wähle die Stufe „Sparsam“.".into());
                }
                // laufende Helfer beenden, sonst lässt sich die Datei (Windows) nicht ersetzen
                self.llm.stop();
                self.fproc.stop();
                jobs.push((vec![(u, size)], self.helper_path(), d));
                // Windows: C++-Laufzeit gehört neben das Programm
                #[cfg(windows)]
                for dll in ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"] {
                    if let Some((u, size, d)) = a.get(&format!("slimsort-llm-windows-{dll}")).cloned() {
                        jobs.push((vec![(u, size)], self.dir.join(dll), d));
                    }
                }
            }
        }
        if let Some(id) = t.llm {
            let gguf = self.llm_path(id);
            if !gguf.is_file() {
                if !hw::detect().chat_ok {
                    return Err("Dein Prozessor ist zu alt für das Sprachmodell. Wähle die Stufe „Sparsam“.".into());
                }
                let a = Self::release_assets(&agent, LLM_TAG)?;
                if !gguf.is_file() {
                    let (ju, _, _) = a.get(&format!("slimsort-llm-{id}.json")).cloned().ok_or("Sprachmodell nicht gefunden")?;
                    let info: Value = agent
                        .get(&ju)
                        .header("User-Agent", "SlimSort")
                        .call()
                        .map_err(|e| format!("Download fehlgeschlagen ({e})"))?
                        .body_mut()
                        .read_to_string()
                        .map_err(|e| e.to_string())
                        .and_then(|t| serde_json::from_str(&t).map_err(|e| e.to_string()))?;
                    let mut urls = Vec::new();
                    for pn in info["parts"].as_array().into_iter().flatten().filter_map(Value::as_str) {
                        let (u, size, _) = a.get(pn).cloned().ok_or("Teil des Sprachmodells fehlt")?;
                        urls.push((u, size));
                    }
                    jobs.push((urls, gguf, info["sha256"].as_str().map(str::to_string)));
                }
            }
        }
        let total: u64 = jobs.iter().flat_map(|j| j.0.iter().map(|u| u.1)).sum();
        self.dl_total.store(total, Ordering::Relaxed);
        for (urls, dest, sha) in &jobs {
            self.fetch_file(&agent, urls, dest, sha.as_deref())?;
            if dest.extension().is_some_and(|e| e == "safetensors") {
                // prüfen, ob sich die Datei laden lässt
                if let Err(e) = net::Weights::load(dest) {
                    let _ = fs::remove_file(dest);
                    return Err(e);
                }
            }
            if dest.file_name().is_some_and(|n| n.to_string_lossy() == helper_name()) {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = fs::set_permissions(dest, fs::Permissions::from_mode(0o755));
                }
                // Prüfsumme merken → spätere neue Fassungen werden erkannt
                let _ = fs::write(self.helper_sum_path(), sha.clone().unwrap_or_default());
                *self.helper_probe.lock().unwrap() = None;
                // Gesichter, die mit dem alten Helfer scheiterten, neu versuchen
                let mut g = self.inner.lock().unwrap();
                g.face_failed.clear();
                g.face_error = None;
            }
        }
        Ok(())
    }

    /// Modell und alles Gespeicherte löschen
    pub fn remove_all(&self) {
        self.llm.stop();
        let mut g = self.inner.lock().unwrap();
        g.model = None;
        if let Some(st) = g.store.as_mut() {
            st.map.clear();
        }
        if let Some(f) = g.fstore.as_mut() {
            f.map.clear();
        }
        self.fproc.stop();
        g.learned = Learned::default();
        g.queue.clear();
        g.failed.clear();
        drop(g);
        let _ = fs::remove_dir_all(&self.dir);
        self.push_status();
    }
}

/// An eine bestimmte Stelle einer Datei schreiben (mehrere Verbindungen schreiben gleichzeitig)
#[cfg(unix)]
fn write_at(f: &File, buf: &[u8], pos: u64) -> std::io::Result<()> {
    use std::os::unix::fs::FileExt;
    f.write_all_at(buf, pos)
}

#[cfg(windows)]
fn write_at(f: &File, mut buf: &[u8], mut pos: u64) -> std::io::Result<()> {
    use std::os::windows::fs::FileExt;
    while !buf.is_empty() {
        let n = f.seek_write(buf, pos)?;
        if n == 0 {
            return Err(std::io::Error::new(std::io::ErrorKind::WriteZero, "nichts geschrieben"));
        }
        buf = &buf[n..];
        pos += n as u64;
    }
    Ok(())
}

/// Bis zu `n` Bilder gleichmäßig verteilt aus einem Ordner (und seinen direkten Unterordnern)
/// Alle Fotos direkt in diesem Ordner (ohne Unterordner – die sind eigene Ziele), höchstens n
fn direct_images(dir: &Path, n: usize) -> Vec<PathBuf> {
    let Ok(rd) = fs::read_dir(dir) else { return vec![] };
    let mut files: Vec<PathBuf> = rd
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            !name.starts_with('.') && crate::scanner::IMAGE_EXT.contains(&crate::scanner::ext_of(&name).as_str())
        })
        .map(|e| e.path())
        .collect();
    files.sort();
    if files.len() > n {
        // gleichmäßig verteilt statt nur die ersten
        let step = files.len() as f64 / n as f64;
        files = (0..n).map(|i| files[(i as f64 * step) as usize].clone()).collect();
    }
    files
}

#[derive(Serialize)]
pub struct FolderInfo {
    pub path: String,
    /// Pfad relativ zum freigegebenen Ordner ("Urlaub/2023/Italien")
    pub rel: String,
    /// Fotos direkt darin
    pub count: usize,
}

/// Alle Unterordner freigegebener Ordner (mit Anzahl Fotos) – mögliche Ziele für die KI
pub fn scan_folders(roots: &[String]) -> Vec<FolderInfo> {
    let mut out = Vec::new();
    let t0 = Instant::now();
    for root in roots {
        let rootp = Path::new(root);
        let mut stack = vec![rootp.to_path_buf()];
        while let Some(d) = stack.pop() {
            if out.len() >= 20000 || t0.elapsed() > Duration::from_secs(30) {
                break;
            }
            let Ok(rd) = fs::read_dir(&d) else { continue };
            let mut count = 0;
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                let Ok(ft) = e.file_type() else { continue };
                if ft.is_dir() {
                    let low = name.to_lowercase();
                    if !crate::scanner::is_skip_dir(&low) && low != "_gelöscht" {
                        stack.push(e.path());
                    }
                } else if crate::scanner::IMAGE_EXT.contains(&crate::scanner::ext_of(&name).as_str()) {
                    count += 1;
                }
            }
            let rel = d.strip_prefix(rootp).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
            let base = rootp.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            out.push(FolderInfo { path: d.to_string_lossy().to_string(), rel: if rel.is_empty() { base } else { format!("{base}/{rel}") }, count });
        }
    }
    out.sort_by(|a, b| a.rel.to_lowercase().cmp(&b.rel.to_lowercase()));
    out
}

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
    #[test]
    fn base64_roundtrip() {
        for v in [&b""[..], b"a", b"ab", b"abc", b"hello world!", &[0u8, 255, 128, 7][..]] {
            let e = super::b64(v);
            assert_eq!(super::unb64(&e).unwrap(), v);
        }
        assert_eq!(super::b64(b"Man"), "TWFu");
        assert_eq!(super::b64(b"Ma"), "TWE=");
    }

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

#[cfg(test)]
mod download {
    use super::*;

    /// Echter Download von GitHub mit mehreren Verbindungen (manuell, braucht Internet):
    /// cargo test --release download -- --ignored --nocapture
    #[test]
    #[ignore]
    fn parallel_github() {
        let dir = std::env::temp_dir().join(format!("slimsort-dl-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let ai = Ai::new(&dir, Arc::new(thumbs::Cache::new(&dir.join("c"))));
        let agent = Ai::agent();
        // DL_URL/DL_SIZE/DL_SHA: lokaler Testserver statt GitHub
        let (name, u, size, d) = match std::env::var("DL_URL") {
            Ok(u) => ("test.bin".to_string(), u, std::env::var("DL_SIZE").unwrap().parse().unwrap(), std::env::var("DL_SHA").ok()),
            Err(_) => {
                let a = Ai::release_assets(&agent, "ki-2").unwrap();
                let name = std::env::var("DL_ASSET").unwrap_or("slimsort-ki-siglip2-b16.safetensors".into());
                let (u, size, d) = a.get(&name).cloned().unwrap();
                (name, u, size, d)
            }
        };
        let dest = dir.join(&name);
        if std::env::var("DL_RESUME").is_ok() {
            // nach 6 s abbrechen, dann erneut starten → muss weitermachen
            let ai2 = ai.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(12));
                ai2.cancel_dl.store(true, Ordering::SeqCst);
            });
            assert!(ai.fetch_file(&agent, &[(u.clone(), size)], &dest, d.as_deref()).is_err());
            ai.cancel_dl.store(false, Ordering::SeqCst);
            println!("abgebrochen bei {:.0} MB", ai.dl_got.load(Ordering::Relaxed) as f64 / 1e6);
            ai.dl_got.store(0, Ordering::Relaxed);
        }
        let t0 = Instant::now();
        ai.fetch_file(&agent, &[(u, size)], &dest, d.as_deref()).unwrap();
        let s = t0.elapsed().as_secs_f64();
        println!("{name}: {:.0} MB in {s:.1} s = {:.1} MB/s", size as f64 / 1e6, size as f64 / 1e6 / s);
        assert_eq!(fs::metadata(&dest).unwrap().len(), size);
        let _ = fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod quality {
    use super::*;

    /// Wie gut findet das Modell echte Fotos? (manuell: FOTOSORT_AI_MODEL=… FOTOSORT_AI_PICS=ordner
    /// cargo test --release quality -- --ignored --nocapture)
    #[test]
    #[ignore]
    fn probe() {
        let (Ok(mp), Ok(dir)) = (std::env::var("FOTOSORT_AI_MODEL"), std::env::var("FOTOSORT_AI_PICS")) else { return };
        let m = Model::load(Path::new(&mp)).unwrap();
        let mut sc = net::Scratch::default();
        let mut pics: Vec<(String, Vec<f32>)> = Vec::new();
        for e in fs::read_dir(&dir).unwrap().flatten() {
            let img = image::open(e.path()).unwrap();
            pics.push((e.file_name().to_string_lossy().to_string(), m.image(&mut sc, &m.prepare(&img))));
        }
        pics.sort_by(|a, b| a.0.cmp(&b.0));
        let k = m.scale();
        let siglip = m.w.siglip();
        let queries = [
            "eine Katze", "eine Tasse Kaffee", "eine Rakete", "ein Astronaut", "Gras", "ein Motorrad", "eine Uhr",
            "Münzen", "Text auf Papier", "der Mond", "Sterne im Weltall", "eine Ziegelmauer", "ein Mann mit Kamera",
        ];
        let mut ok = 0;
        for q in queries {
            let t = m.text(&mut sc, &format!("ein Foto von {q}"));
            let mut r: Vec<(f32, &str)> = pics.iter().map(|(n, e)| (e.iter().zip(&t).map(|(a, b)| a * b).sum::<f32>() * k, n.as_str())).collect();
            r.sort_by(|a, b| b.0.total_cmp(&a.0));
            println!("{q:24} → {} ({:.1})  {} ({:.1})  {} ({:.1})", r[0].1, r[0].0, r[1].1, r[1].0, r[2].1, r[2].0);
            ok += 1;
        }
        // Stichwörter je Foto
        let lab: Vec<Vec<f32>> = labels::LABELS
            .iter()
            .map(|(en, de)| if siglip { m.text(&mut sc, &format!("a photo of {en}.")) } else { m.text(&mut sc, &format!("ein Foto: {de}")) })
            .collect();
        for (n, e) in &pics {
            let mut r: Vec<(f32, &str)> = lab.iter().enumerate().map(|(i, v)| (e.iter().zip(v).map(|(a, b)| a * b).sum::<f32>() * k, labels::LABELS[i].1)).collect();
            r.sort_by(|a, b| b.0.total_cmp(&a.0));
            println!("{n:24} : {}, {}, {}", r[0].1, r[1].1, r[2].1);
        }
        assert!(ok > 0);
    }
}
