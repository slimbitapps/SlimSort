//! SlimSort – Hauptprogramm (Tauri). Die Oberfläche (React) spricht über
//! Befehle (invoke) und Ereignisse (emit) mit dieser Seite.

mod exif;
mod fsops;
mod protocol;
mod reach;
mod scanner;
mod session;
mod settings;
mod thumbs;

use serde::Deserialize;
use serde_json::{json, Value};
use session::{Counters, Session, TransferOp};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

struct AppState {
    user_data: PathBuf,
    settings: settings::SettingsStore,
    session: Mutex<Option<Session>>,
    counters: Arc<Counters>,
    reach: Arc<reach::ReachMonitor>,
    exif_run: Arc<AtomicU64>,
    media: Arc<protocol::Media>,
    pick_count: AtomicUsize,
    quitting: AtomicBool,
    fullscreen: AtomicBool,
    window_state: Mutex<Option<Value>>,
    /// Aufnahmezeiten der zuletzt geöffneten Sitzung – gelesen wird erst, wenn die Oberfläche bereit ist
    exif_todo: Mutex<Option<(u64, Vec<(u64, PathBuf, String)>)>>,
}

type Res<T> = Result<T, String>;

fn is_test() -> bool {
    std::env::var("FOTOSORT_TEST").is_ok()
}

fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(windows) {
        "win32"
    } else {
        "linux"
    }
}

/// Einfaches Fehlerprotokoll (bleibt lokal) – hilft bei der Fehlersuche.
fn log_to(dir: &Path, msg: &str) {
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(dir.join("app.log")) {
        let _ = writeln!(f, "[{}] {msg}", chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
    }
}

/// Gleicher Datenordner wie die frühere Electron-Version (Einstellungen bleiben erhalten).
fn user_data_dir() -> PathBuf {
    if let Ok(p) = std::env::var("FOTOSORT_USERDATA") {
        return PathBuf::from(p);
    }
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("SlimSort");
    migrate_old(&base, &dir);
    dir
}

/// Die App hieß früher "Fotosortierer": Einstellungen und Protokoll einmalig übernehmen.
fn migrate_old(base: &Path, dir: &Path) {
    let old = base.join("Fotosortierer");
    if dir.join("einstellungen.json").exists() || !old.join("einstellungen.json").exists() {
        return;
    }
    let _ = fs::create_dir_all(dir);
    for f in ["einstellungen.json", "protokoll.log"] {
        if old.join(f).exists() {
            let _ = fs::copy(old.join(f), dir.join(f));
        }
    }
}

/// Reste des alten eingebauten Browsers (Electron) entfernen – das spart Speicherplatz.
fn cleanup_electron(dir: &Path) {
    for d in ["Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache", "Cache/Cache_Data", "Shared Dictionary", "blob_storage"] {
        let p = dir.join(d);
        if p.is_dir() {
            let _ = fs::remove_dir_all(p);
        }
    }
}

fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> impl std::future::Future<Output = Res<T>> {
    async move { tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string()) }
}

// ------------------------------------------------------------------ Einstellungen & App

#[tauri::command]
fn settings_get(st: State<AppState>) -> Value {
    st.settings.get()
}

#[tauri::command]
fn settings_set(st: State<AppState>, data: Value) -> bool {
    let mut d = data;
    if let (Value::Object(m), Some(w)) = (&mut d, st.settings.get().get("window").cloned()) {
        m.insert("window".into(), w);
    }
    st.settings.save(d);
    true
}

#[tauri::command]
fn app_info(app: AppHandle, st: State<AppState>) -> Value {
    json!({
        "version": app.package_info().version.to_string(),
        "platform": platform(),
        "arch": std::env::consts::ARCH,
        "userData": st.user_data,
        "journal": st.user_data.join("protokoll.log"),
    })
}

#[tauri::command]
fn app_log(st: State<AppState>, msg: String) {
    log_to(&st.user_data, &format!("renderer {msg}"));
}

#[tauri::command]
fn show_window(win: WebviewWindow) {
    let _ = win.show();
    let _ = win.set_focus();
}

// ------------------------------------------------------------------ Dialoge

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PickOpts {
    title: Option<String>,
    default_path: Option<String>,
}

#[tauri::command]
async fn pick_folder(app: AppHandle, st: State<'_, AppState>, opts: Option<PickOpts>) -> Res<Option<String>> {
    if is_test() {
        if let Ok(list) = std::env::var("FOTOSORT_PICK") {
            // Tests: mehrere Ordner mit "|" getrennt, werden nacheinander zurückgegeben
            let v: Vec<&str> = list.split('|').collect();
            let i = st.pick_count.fetch_add(1, Ordering::SeqCst);
            return Ok(Some(v[i % v.len()].to_string()));
        }
    }
    let o = opts.unwrap_or_default();
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut d = app.dialog().file();
    if let Some(w) = app.get_webview_window("main") {
        d = d.set_parent(&w);
    }
    if let Some(t) = o.title {
        d = d.set_title(t);
    }
    if let Some(p) = o.default_path.filter(|p| Path::new(p).is_dir()) {
        d = d.set_directory(p);
    }
    d.pick_folder(move |r| {
        let _ = tx.send(r.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()));
    });
    Ok(rx.await.unwrap_or(None))
}

#[derive(Deserialize)]
struct ConfirmOpts {
    message: String,
    detail: Option<String>,
    buttons: Vec<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
}

/// Rückfrage mit zwei Knöpfen: liefert 0 (erster Knopf) oder 1.
#[tauri::command]
async fn confirm(app: AppHandle, opts: ConfirmOpts) -> Res<usize> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let ok = opts.buttons.first().cloned().unwrap_or_else(|| "OK".into());
    let cancel = opts.buttons.get(1).cloned().unwrap_or_else(|| "Cancel".into());
    let text = match opts.detail {
        Some(d) => format!("{}\n\n{d}", opts.message),
        None => opts.message.clone(),
    };
    let mut m = app
        .dialog()
        .message(text)
        .title("SlimSort")
        .kind(if opts.kind.as_deref() == Some("warning") { MessageDialogKind::Warning } else { MessageDialogKind::Info })
        .buttons(MessageDialogButtons::OkCancelCustom(ok, cancel));
    if let Some(w) = app.get_webview_window("main") {
        m = m.parent(&w);
    }
    m.show(move |yes| {
        let _ = tx.send(yes);
    });
    Ok(if rx.await.unwrap_or(false) { 0 } else { 1 })
}

// ------------------------------------------------------------------ Dateisystem

#[tauri::command]
async fn check_dir(dir: String) -> Res<fsops::DirCheck> {
    blocking(move || fsops::check_dir(&dir, fsops::DEFAULT_TIMEOUT)).await
}

#[derive(Deserialize)]
struct CountOpts {
    dirs: Vec<String>,
    recursive: bool,
}

/// Fotos und Videos zählen (Vorschau beim Einrichten).
#[tauri::command]
async fn count_media(opts: CountOpts) -> Res<Value> {
    blocking(move || -> Res<Value> {
        let (mut images, mut videos) = (0u64, 0u64);
        let mut sample: Vec<PathBuf> = Vec::new();
        let mut per_dir = Vec::new();
        for d in &opts.dirs {
            let dir = PathBuf::from(d);
            let items = scanner::scan(&dir, opts.recursive, &[dir.join("_Gelöscht")], |_| {}).map_err(|e| e.to_string())?;
            for it in &items {
                if it.kind == scanner::Kind::Video {
                    videos += 1;
                } else {
                    images += 1;
                    if sample.len() < 4 {
                        sample.push(it.path.clone());
                    }
                }
            }
            per_dir.push(items.len());
        }
        Ok(json!({ "images": images, "videos": videos, "total": images + videos, "sample": sample, "perDir": per_dir }))
    })
    .await?
}

#[derive(Deserialize)]
struct CreateFolder {
    parent: String,
    name: String,
}

/// Neuen Zielordner anlegen (existiert er schon, wird er einfach verwendet).
#[tauri::command]
async fn create_folder(opts: CreateFolder) -> Res<String> {
    let clean = session::clean_stem(&opts.name);
    if clean.is_empty() {
        return Err("Ungültiger Name".into());
    }
    let dir = Path::new(&opts.parent).join(clean);
    let d2 = dir.clone();
    blocking(move || fs::create_dir_all(&d2)).await?.map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
fn parent_dir(p: String) -> String {
    Path::new(&p).parent().map(|x| x.to_string_lossy().into_owned()).unwrap_or(p)
}

#[tauri::command]
async fn mkdir(dir: String) -> Res<bool> {
    blocking(move || fs::create_dir_all(dir).is_ok()).await
}

// ------------------------------------------------------------------ Sitzung

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenOpts {
    source_dirs: Vec<String>,
    recursive: bool,
    trash_dir: Option<String>,
}

#[tauri::command]
async fn session_open(app: AppHandle, opts: OpenOpts) -> Res<Value> {
    let st = app.state::<AppState>();
    log_to(&st.user_data, &format!("session:open {:?}", opts.source_dirs));
    let emit_app = app.clone();
    let emit: session::Emit = Arc::new(move |ev: &str, v: Value| {
        let _ = emit_app.emit(ev, v);
    });
    let mut s = Session::new(Some(st.user_data.join("protokoll.log")), st.counters.clone(), emit);
    let dirs: Vec<PathBuf> = opts.source_dirs.iter().map(PathBuf::from).collect();
    let trash = opts.trash_dir.filter(|t| !t.is_empty()).map(PathBuf::from);
    let app2 = app.clone();
    let (s, items) = blocking(move || {
        let last = Mutex::new(std::time::Instant::now() - Duration::from_secs(1));
        let r = s.open(&dirs, opts.recursive, trash, |n| {
            let mut l = last.lock().unwrap();
            if l.elapsed() > Duration::from_millis(100) {
                *l = std::time::Instant::now();
                let _ = app2.emit("scan:progress", n);
            }
        });
        (s, r)
    })
    .await?;
    let items = items.map_err(|e| e.to_string())?;
    let trash_dir = s.trash_dir.clone();
    *st.session.lock().unwrap() = Some(s);
    log_to(&st.user_data, &format!("session:open ok {}", items.len()));

    // Aufnahmezeiten liest exif_start, sobald die Oberfläche die Sitzung übernommen hat
    let run = st.exif_run.fetch_add(1, Ordering::SeqCst) + 1;
    let list: Vec<(u64, PathBuf, String)> = items.iter().map(|i| (i.id, i.path.clone(), i.ext.clone())).collect();
    *st.exif_todo.lock().unwrap() = Some((run, list));
    Ok(json!({ "items": items, "trashDir": trash_dir }))
}

/// Aufnahmezeiten im Hintergrund lesen (Pakete per "exif:batch", danach "exif:done").
#[tauri::command]
fn exif_start(app: AppHandle) {
    let st = app.state::<AppState>();
    let Some((run, list)) = st.exif_todo.lock().unwrap().take() else { return };
    let (a1, a2, a3) = (app.clone(), app.clone(), app.clone());
    let (r1, r2, r3) = (st.exif_run.clone(), st.exif_run.clone(), st.exif_run.clone());
    std::thread::spawn(move || {
        exif::read_capture_times(
            list,
            move |b| {
                if r1.load(Ordering::SeqCst) == run {
                    let _ = a1.emit("exif:batch", b);
                }
            },
            move || r2.load(Ordering::SeqCst) != run,
        );
        if r3.load(Ordering::SeqCst) == run {
            let _ = a2.emit("exif:done", Value::Null);
        }
        drop(a3);
    });
}

#[tauri::command]
fn session_transfer(st: State<AppState>, op: TransferOp) -> bool {
    match st.session.lock().unwrap().as_ref() {
        Some(s) => {
            s.transfer(op);
            true
        }
        None => false,
    }
}

#[tauri::command]
fn session_undo(st: State<AppState>, op_id: u64) -> bool {
    match st.session.lock().unwrap().as_ref() {
        Some(s) => {
            s.undo(op_id);
            true
        }
        None => false,
    }
}

#[tauri::command]
fn session_pending(st: State<AppState>) -> i64 {
    st.counters.pending.load(Ordering::SeqCst)
}

#[tauri::command]
async fn trash_info(app: AppHandle, dir: Option<String>) -> Res<Value> {
    let dirs = {
        let st = app.state::<AppState>();
        let g = st.session.lock().unwrap();
        match (g.as_ref(), dir) {
            (Some(s), _) => s.trash_dirs(),
            (None, Some(d)) => vec![PathBuf::from(d)],
            (None, None) => vec![],
        }
    };
    blocking(move || session::trash_info(&dirs)).await
}

#[tauri::command]
async fn trash_empty(app: AppHandle, system_trash: Option<bool>) -> Res<Value> {
    // Die Sitzung arbeitet im eigenen Thread – hier nur auf ihr Ergebnis warten.
    let app2 = app.clone();
    blocking(move || {
        let st = app2.state::<AppState>();
        let g = st.session.lock().unwrap();
        match g.as_ref() {
            Some(s) => s.empty_trash(system_trash.unwrap_or(true)).map(|r| json!(r)).map_err(|e| e.code),
            None => Ok(json!({ "removed": 0, "pruned": [], "kept": 0 })),
        }
    })
    .await?
}

// ------------------------------------------------------------------ Erreichbarkeit

#[tauri::command]
async fn reach_set(app: AppHandle, dirs: Vec<String>) -> Res<Value> {
    let r = app.state::<AppState>().reach.clone();
    r.set_dirs(dirs);
    let (snap, _) = blocking(move || r.check_now()).await?;
    Ok(json!(snap))
}

#[tauri::command]
async fn reach_check(app: AppHandle) -> Res<Value> {
    let r = app.state::<AppState>().reach.clone();
    let (snap, changed) = blocking(move || r.check_now()).await?;
    if changed {
        let _ = app.emit("reach:change", &snap);
    }
    Ok(json!(snap))
}

#[derive(Deserialize)]
struct LostOpts {
    missing: Vec<String>,
    hints: Vec<String>,
}

#[tauri::command]
async fn lost_find(opts: LostOpts) -> Res<HashMap<String, Vec<String>>> {
    blocking(move || reach::find_lost_folders(&opts.missing, &opts.hints)).await
}

// ------------------------------------------------------------------ Fenster & System

#[tauri::command]
fn set_fullscreen(win: WebviewWindow, st: State<AppState>, on: bool) -> bool {
    let _ = win.set_fullscreen(on);
    st.fullscreen.store(on, Ordering::SeqCst);
    let _ = win.emit("win:fullscreen", on);
    on
}

#[tauri::command]
fn is_fullscreen(win: WebviewWindow) -> bool {
    win.is_fullscreen().unwrap_or(false)
}

/// Design umschalten: Fensterleiste passend einfärben.
#[tauri::command]
fn set_theme(win: WebviewWindow, theme: String) -> bool {
    let t = match theme.as_str() {
        "dark" => Some(tauri::Theme::Dark),
        "light" => Some(tauri::Theme::Light),
        _ => None,
    };
    let _ = win.set_theme(t);
    let dark = match t {
        Some(x) => x == tauri::Theme::Dark,
        None => win.theme().map(|x| x == tauri::Theme::Dark).unwrap_or(true),
    };
    let _ = win.set_background_color(Some(if dark { tauri::window::Color(18, 19, 22, 255) } else { tauri::window::Color(245, 245, 247, 255) }));
    dark
}

#[tauri::command]
fn show_item(app: AppHandle, p: String) -> Res<()> {
    app.opener().reveal_item_in_dir(p).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_path(app: AppHandle, p: String) -> Res<String> {
    app.opener().open_path(p, None::<&str>).map(|_| String::new()).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Res<()> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("nur http(s)".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
async fn cache_clear(app: AppHandle) -> Res<()> {
    let m = app.state::<AppState>().media.clone();
    blocking(move || m.cache.clear()).await
}

// ------------------------------------------------------------------ Neu in Version 2

/// Details zum Foto (Kamera, Objektiv, Belichtung, Ort …) für die Info-Anzeige.
#[tauri::command]
async fn photo_info(path: String) -> Res<exif::PhotoInfo> {
    blocking(move || exif::photo_info(Path::new(&path))).await
}

/// Prüfsummen für die Suche nach exakten Doppelten (nur Dateien gleicher Größe nötig).
#[tauri::command]
async fn file_hashes(paths: Vec<String>) -> Res<HashMap<String, String>> {
    blocking(move || {
        let mut out = HashMap::new();
        for p in paths {
            if let Ok(h) = fsops::hash_file(Path::new(&p), |_| {}) {
                out.insert(p, h);
            }
        }
        out
    })
    .await
}

/// Datei mit dem Standardprogramm des Systems öffnen.
#[tauri::command]
fn open_with_default(app: AppHandle, p: String) -> Res<()> {
    app.opener().open_path(p, None::<&str>).map_err(|e| e.to_string())
}

// ------------------------------------------------------------------ Start

fn create_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let st = app.state::<AppState>();
    let saved = st.settings.get().get("window").cloned().unwrap_or(Value::Null);
    let num = |k: &str| saved.get(k).and_then(Value::as_f64);
    let theme = st.settings.get().pointer("/prefs/theme").and_then(Value::as_str).unwrap_or("system").to_string();
    let mut b = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("SlimSort")
        .inner_size(num("width").unwrap_or(1400.0), num("height").unwrap_or(900.0))
        .min_inner_size(900.0, 600.0)
        .visible(false)
        .theme(match theme.as_str() {
            "dark" => Some(tauri::Theme::Dark),
            "light" => Some(tauri::Theme::Light),
            _ => None,
        })
        .background_color(if theme == "light" { tauri::window::Color(245, 245, 247, 255) } else { tauri::window::Color(18, 19, 22, 255) });
    if let (Some(x), Some(y)) = (num("x"), num("y")) {
        b = b.position(x, y);
    } else {
        b = b.center();
    }
    #[cfg(target_os = "macos")]
    {
        // Moderne Fensterleiste: Inhalt reicht bis oben, Fensterknöpfe bleiben nativ.
        b = b.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true).traffic_light_position(tauri::LogicalPosition::new(18.0, 22.0));
    }
    #[cfg(windows)]
    {
        // Eigene Fensterknöpfe in der Kopfleiste (wie bisher)
        b = b.decorations(false).shadow(true);
    }
    let win = b.build()?;
    if saved.get("maximized").and_then(Value::as_bool) == Some(true) {
        let _ = win.maximize();
    }
    // Falls die Oberfläche hängt: Fenster trotzdem zeigen
    let w2 = win.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(4));
        let _ = w2.show();
    });
    Ok(win)
}

fn remember_window(app: &AppHandle, win: &tauri::Window) {
    let st = app.state::<AppState>();
    if win.is_fullscreen().unwrap_or(false) || win.is_minimized().unwrap_or(false) {
        return;
    }
    let maximized = win.is_maximized().unwrap_or(false);
    let scale = win.scale_factor().unwrap_or(1.0);
    let mut v = st.window_state.lock().unwrap().clone().unwrap_or(json!({}));
    if !maximized {
        if let (Ok(p), Ok(s)) = (win.outer_position(), win.inner_size()) {
            let p = p.to_logical::<f64>(scale);
            let s = s.to_logical::<f64>(scale);
            v = json!({ "x": p.x, "y": p.y, "width": s.width, "height": s.height });
        }
    }
    v["maximized"] = json!(maximized);
    *st.window_state.lock().unwrap() = Some(v);
}

pub fn run() {
    let user_data = user_data_dir();
    let _ = fs::create_dir_all(&user_data);
    cleanup_electron(&user_data);
    log_to(&user_data, &format!("start {} {} {}", env!("CARGO_PKG_VERSION"), platform(), std::env::consts::ARCH));
    let settings = settings::SettingsStore::load(user_data.join("einstellungen.json"));
    let ud_log = user_data.clone();
    let logged = Arc::new(AtomicUsize::new(0));
    let media = Arc::new(protocol::Media {
        cache: Arc::new(thumbs::Cache::new(&user_data.join("cache"))),
        pool: thumbs::Pool::new(num_cpus::get().saturating_sub(2).clamp(2, 4)),
        broken: is_test() && std::env::var("FOTOSORT_BREAK_PREVIEWS").is_ok(),
        log: Arc::new(move |m: String| {
            // begrenzt, damit app.log nicht vollläuft
            if logged.fetch_add(1, Ordering::Relaxed) < 50 {
                log_to(&ud_log, &m);
            }
        }),
    });
    let state = AppState {
        user_data: user_data.clone(),
        settings,
        session: Mutex::new(None),
        counters: Arc::new(Counters::default()),
        reach: Arc::new(reach::ReachMonitor::default()),
        exif_run: Arc::new(AtomicU64::new(0)),
        media: media.clone(),
        pick_count: AtomicUsize::new(0),
        quitting: AtomicBool::new(false),
        fullscreen: AtomicBool::new(false),
        window_state: Mutex::new(None),
        exif_todo: Mutex::new(None),
    };
    let (m1, m2, m3) = (media.clone(), media.clone(), media.clone());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .register_asynchronous_uri_scheme_protocol("media", move |_ctx, req, responder| {
            let m = m1.clone();
            std::thread::spawn(move || responder.respond(m.media(req)));
        })
        .register_asynchronous_uri_scheme_protocol("thumb", move |_ctx, req, responder| {
            m2.thumb(req, Box::new(move |r| responder.respond(r)));
        })
        .register_asynchronous_uri_scheme_protocol("preview", move |_ctx, req, responder| {
            m3.preview(req, Box::new(move |r| responder.respond(r)));
        })
        .invoke_handler(tauri::generate_handler![
            settings_get,
            settings_set,
            app_info,
            app_log,
            show_window,
            pick_folder,
            confirm,
            check_dir,
            count_media,
            create_folder,
            parent_dir,
            mkdir,
            session_open,
            exif_start,
            session_transfer,
            session_undo,
            session_pending,
            trash_info,
            trash_empty,
            reach_set,
            reach_check,
            lost_find,
            set_fullscreen,
            is_fullscreen,
            set_theme,
            show_item,
            open_path,
            open_external,
            cache_clear,
            photo_info,
            file_hashes,
            open_with_default,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            create_window(&handle)?;
            // Erreichbarkeit überwachen: mehrmals nach dem Start, danach alle 15 s
            let h2 = handle.clone();
            std::thread::spawn(move || {
                let started = std::time::Instant::now();
                let mut checks = reach::STARTUP_CHECKS.iter().peekable();
                let mut next_interval = started + reach::INTERVAL;
                loop {
                    std::thread::sleep(Duration::from_millis(500));
                    let now = std::time::Instant::now();
                    let due_startup = checks.peek().map(|s| now >= started + Duration::from_secs(**s)).unwrap_or(false);
                    if due_startup {
                        checks.next();
                    }
                    if due_startup || now >= next_interval {
                        if now >= next_interval {
                            next_interval = now + reach::INTERVAL;
                        }
                        let r = h2.state::<AppState>().reach.clone();
                        let (snap, changed) = r.check_now();
                        if changed {
                            let _ = h2.emit("reach:change", &snap);
                        }
                    }
                }
            });
            // Zwischenspeicher nach kurzer Zeit aufräumen
            let m = app.state::<AppState>().media.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(20));
                m.cache.trim(300 * 1024 * 1024);
            });
            Ok(())
        })
        .on_window_event(|win, ev| {
            let app = win.app_handle();
            match ev {
                WindowEvent::Resized(_) | WindowEvent::Moved(_) => {
                    remember_window(app, win);
                    let st = app.state::<AppState>();
                    let fs_now = win.is_fullscreen().unwrap_or(false);
                    if st.fullscreen.swap(fs_now, Ordering::SeqCst) != fs_now {
                        let _ = win.emit("win:fullscreen", fs_now);
                    }
                }
                WindowEvent::CloseRequested { api, .. } => {
                    let st = app.state::<AppState>();
                    if let Some(w) = st.window_state.lock().unwrap().clone() {
                        st.settings.set_key("window", w);
                    }
                    // Nicht beenden, solange Dateien noch übertragen werden.
                    let pending = st.counters.pending.load(Ordering::SeqCst);
                    if pending > 0 {
                        api.prevent_close();
                        if !st.quitting.swap(true, Ordering::SeqCst) {
                            let _ = win.emit("app:quitting", pending);
                            let app2 = app.clone();
                            std::thread::spawn(move || {
                                let c = app2.state::<AppState>().counters.clone();
                                while c.pending.load(Ordering::SeqCst) > 0 {
                                    std::thread::sleep(Duration::from_millis(200));
                                }
                                app2.exit(0);
                            });
                        }
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("SlimSort konnte nicht starten");
}
