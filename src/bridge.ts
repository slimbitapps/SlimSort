/**
 * Verbindung zur Rust-Seite (Tauri). Stellt dieselbe Schnittstelle `window.api`
 * bereit wie früher die Electron-Version – die Oberfläche bleibt dadurch gleich.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { Api } from './types';

const ua = navigator.userAgent;
const platform = /Mac OS X|Macintosh/.test(ua) ? 'darwin' : /Windows/.test(ua) ? 'win32' : 'linux';

const api: Api = {
  getSettings: () => invoke('settings_get'),
  setSettings: (data) => invoke('settings_set', { data }),
  appInfo: () => invoke('app_info'),
  pickFolder: (opts) => invoke('pick_folder', { opts: opts || null }),
  confirm: (opts) => invoke('confirm', { opts }),
  checkDir: (dir) => invoke('check_dir', { dir }),
  countMedia: (opts) => invoke('count_media', { opts }),
  createFolder: (opts) => invoke('create_folder', { opts }),
  parentDir: (p) => invoke('parent_dir', { p }),
  setTheme: (theme) => invoke('set_theme', { theme }),
  log: (msg) => invoke('app_log', { msg }),
  mkdir: (dir) => invoke('mkdir', { dir }),
  openSession: (opts) => invoke('session_open', { opts }),
  exifStart: () => invoke('exif_start'),
  transfer: (op) => invoke('session_transfer', { op }),
  undo: (opId) => invoke('session_undo', { opId }),
  pending: () => invoke('session_pending'),
  trashInfo: (dir) => invoke('trash_info', { dir: dir ?? null }),
  emptyTrash: (systemTrash = true) => invoke('trash_empty', { systemTrash }),
  setWatchedDirs: (dirs) => invoke('reach_set', { dirs }),
  checkReach: () => invoke('reach_check'),
  findLost: (opts) => invoke('lost_find', { opts }),
  setFullscreen: (on) => invoke('set_fullscreen', { on }),
  isFullscreen: () => invoke('is_fullscreen'),
  showItem: (p) => invoke('show_item', { p }),
  openPath: (p) => invoke('open_path', { p }),
  openExternal: (url) => invoke('open_external', { url }),
  clearCache: () => invoke('cache_clear'),
  photoInfo: (path) => invoke('photo_info', { path }),
  storeGet: (name) => invoke('store_get', { name }),
  storeSet: (name, data) => invoke('store_set', { name, data }),
  ai: {
    status: () => invoke('ai_status'),
    config: (enabled, perf, tier, faces) => invoke('ai_config', { enabled, perf, tier, faces }),
    rules: (texts, ids, min) => invoke('ai_rules', { texts, ids, min: min ?? null }),
    faceMatches: (groups, ids, min) => invoke('ai_face_matches', { groups, ids, min: min ?? null }),
    faceEmbs: (ids) => invoke('ai_face_embs', { ids }),
    faceCount: (id) => invoke('ai_face_count', { id }),
    peopleOn: (ids, people, min, emb) => invoke('ai_people_on', { ids, people, min: min ?? null, emb: emb ?? null }),
    faceClusters: (ids, people, minSize) => invoke('ai_face_clusters', { ids, people, minSize: minSize ?? null }),
    faceCrop: (path, box, size) => invoke('ai_face_crop', { path, bbox: box, size: size ?? null }),
    embedRegion: (path, box) => invoke('ai_embed_region', { path, bbox: box }),
    thingScores: (ids, things) => invoke('ai_thing_scores', { ids, things }),
    exportFile: (data, name) => invoke('ai_export_file', { data, name }),
    importFile: () => invoke('ai_import_file'),
    importLearned: (data, remap) => invoke('ai_import_learned', { data, remap }),
    chat: (id, req) => invoke('ai_chat', { id, req }),
    chatCancel: (id) => invoke('ai_chat_cancel', { id }),
    chatWarm: () => invoke('ai_chat_warm'),
    tags: (id) => invoke('ai_tags', { id }),
    download: () => invoke('ai_download'),
    cancelDownload: () => invoke('ai_download_cancel'),
    remove: () => invoke('ai_remove'),
    index: (items) => invoke('ai_index', { items }),
    prioritize: (ids) => invoke('ai_prioritize', { ids }),
    learn: (ids, target) => invoke('ai_learn', { ids, target }),
    learnFolders: (targets) => invoke('ai_learn_folders', { targets }),
    forget: () => invoke('ai_forget'),
    renameTarget: (from, to) => invoke('ai_rename_target', { from, to }),
    search: (text, among, limit) => invoke('ai_search', { text, among: among ?? null, limit: limit ?? null }),
    similar: (id, among, limit) => invoke('ai_similar', { id, among: among ?? null, limit: limit ?? null }),
    suggest: (ids, targets) => invoke('ai_suggest', { ids, targets }),
  },
  fileHashes: (paths) => invoke('file_hashes', { paths }),
  openWithDefault: (p) => invoke('open_with_default', { p }),
  showWindow: () => invoke('show_window'),
  pathForFile: () => '',
  platform,
  on(channel, cb) {
    let off: (() => void) | null = null;
    let dead = false;
    listen(channel, (e) => cb(e.payload)).then((u) => {
      if (dead) u();
      else off = u;
    });
    return () => {
      dead = true;
      off?.();
    };
  },
  onFileDrop(cb) {
    let off: (() => void) | null = null;
    let dead = false;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === 'enter') cb({ type: 'enter', paths: p.paths });
        else if (p.type === 'leave') cb({ type: 'leave', paths: [] });
        else if (p.type === 'drop') cb({ type: 'drop', paths: p.paths });
      })
      .then((u) => {
        if (dead) u();
        else off = u;
      });
    return () => {
      dead = true;
      off?.();
    };
  },
  win: {
    minimize: () => getCurrentWindow().minimize(),
    toggleMaximize: () => getCurrentWindow().toggleMaximize(),
    close: () => getCurrentWindow().close(),
    isMaximized: () => getCurrentWindow().isMaximized(),
    onResized: (cb) => {
      let off: (() => void) | null = null;
      getCurrentWindow().onResized(() => cb()).then((u) => (off = u));
      return () => off?.();
    },
  },
};

window.api = api;

// Fenster an der Kopfleiste verschieben (wie eine normale Titelleiste), Doppelklick = maximieren
const DRAG = '.header, .onb-top, .onb, [data-drag]';
const NO_DRAG = 'button, a, input, select, textarea, label, [contenteditable], [role="button"], .no-drag, .header-center, .win-controls';
window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const el = e.target as HTMLElement;
  if (!el.closest || !el.closest(DRAG) || el.closest(NO_DRAG)) return;
  if (document.documentElement.classList.contains('is-fullscreen')) return;
  if (e.detail === 2) getCurrentWindow().toggleMaximize();
  else getCurrentWindow().startDragging();
});

// Keine Browser-Menüs/Verhalten, die in einer App fremd wirken
window.addEventListener('contextmenu', (e) => {
  const el = e.target as HTMLElement;
  if (!el.closest('input, textarea, [data-native-menu]')) e.preventDefault();
});
