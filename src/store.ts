import { create } from 'zustand';
import { setLang, t, errText } from './i18n';
import type {
  Item, Prefs, Profile, QuickStart, SettingsData, Target, OpDoneEvent, ProgressEvent, Filter,
} from './types';
import { basename, COLORS, itemTime, sortItems, uid, isAssignableKey, thumbUrl, browserCanShow, mediaUrl, fmtBytes } from './util';
import { computeSeries, rankSeries, MOTIF_DIST } from './series';
import type { DragPayload } from './dnd';
import { configureAnalysis, requestAnalysis, resetAnalysis } from './analysis';

// ---------------------------------------------------------------- Erweiterungen (KI)

/** Stellen, an denen sich die KI einklinkt (src/ai.ts) – vermeidet gegenseitige Importe. */
export const hooks: {
  sessionStarted?: (s: SessionState) => void;
  sorted?: (ids: number[], target: Target | null, trash: boolean) => void;
  undone?: (ids: number[]) => void;
  changed?: (s: SessionState) => void;
  targetRemoved?: (t: Target) => void;
} = {};

// ---------------------------------------------------------------- Typen

export interface Toast {
  id: string;
  kind: 'info' | 'error' | 'success';
  text: string;
  action?: { label: string; run: () => void };
  timeout: number;
}

export type Dialog =
  | null
  | { type: 'settings'; tab?: string }
  | { type: 'shortcuts' }
  | { type: 'about' }
  | { type: 'summary' }
  | { type: 'trash' }
  | { type: 'lost' }
  | { type: 'profiles' }
  | { type: 'keyCapture'; targetId: string }
  | { type: 'prompt'; title: string; value: string; onOk: (v: string) => void };

/** Ein Dateiauftrag (Verschieben/Kopieren/Löschen) für mehrere Einträge */
interface OpRec {
  opId: number;
  ids: number[];
  targetId: string | null;
  trash: boolean;
}

interface UndoEntry {
  kind: 'transfer' | 'skip';
  ops: OpRec[];
  skipIds?: number[];
  prevCurrent: number | null;
  /** Gehört zu einem Serien-Vergleich – Rückgängig öffnet ihn wieder */
  seriesKey?: number;
}

interface DoneInfo {
  opId: number;
  targetId: string | null; // null = Papierkorb oder "anderer Ordner"
  trash: boolean;
}

export interface CompareState {
  ids: number[];
  /** Serie (kleinste ID) oder null bei manuell ausgewählten Fotos */
  key: number | null;
  page: number;
  keep: Set<number>;
  /** Hat der Nutzer die Auswahl selbst verändert? */
  touched: boolean;
}

export interface SessionState {
  sources: string[];
  /** erster Quellordner (für Anzeige/Kompatibilität) */
  source: string;
  profileId: string;
  items: Item[];
  byId: Map<number, Item>;
  done: Map<number, DoneInfo>;
  skipped: Set<number>;
  viewIds: number[];
  currentId: number | null;
  selection: Set<number>;
  anchorId: number | null;
  undo: UndoEntry[];
  counts: Record<string, number>;
  deleted: number;
  sorted: number;
  other: number;
  startedAt: number;
  lastSorted: { targetId: string; t: number }[];
  view: 'grid' | 'single';
  summaryShown: boolean;
  /** Serien (zeitlich sortierte IDs) */
  series: number[][];
  seriesOf: Map<number, number>;
  seriesDone: Set<number>;
  seriesCompared: number;
  compare: CompareState | null;
  /** v2: überzählige exakte Kopien (gleicher Inhalt) und Anzahl der Gruppen */
  dupes: Set<number>;
  dupeGroups: number;
  /** v2: Suche nach Dateinamen */
  query: string;
  /** KI: nur diese Fotos zeigen (Ergebnis aus dem Chat) */
  only: Set<number> | null;
  /** KI: Vorschlag je Foto (Ziel-ID oder "trash") */
  aiSugg: Map<number, { targetId: string; conf: number }>;
  rev: number;
}

export interface Progress {
  name: string;
  fileDone: number;
  fileTotal: number;
  pending: number;
  pendingBytes: number;
  bytesDone: number;
  speed: number; // Bytes pro Sekunde (geglättet)
}

export interface SetupState {
  step: 0 | 1 | 2;
  sources: string[];
  recursive: boolean;
  count: { images: number; videos: number; total: number; sample: string[]; perDir?: number[] } | null;
  counting: boolean;
  startView: 'grid' | 'single';
  trashDir: string | null;
  fullscreen: boolean;
}

interface State {
  ready: boolean;
  settings: SettingsData;
  screen: 'onboarding' | 'home' | 'setup' | 'session';
  setup: SetupState | null;
  /** Schritt der Einführung beim ersten Sortieren (null = aus) */
  coach: number | null;
  session: SessionState | null;
  dialog: Dialog;
  toasts: Toast[];
  zen: boolean;
  fullscreen: boolean;
  reach: Record<string, boolean>;
  progress: Progress | null;
  flash: { name: string; color: string; key: string; n: number } | null;
  scanning: number | null;
  /** Rechtsklick-Menü auf einem Foto */
  photoMenu: { id: number; x: number; y: number } | null;
}

// ---------------------------------------------------------------- Standardwerte

export const defaultPrefs: Prefs = {
  lang: 'de',
  theme: 'system',
  mode: 'simple',
  transferMode: 'move',
  liveVideo: 'move',
  liveAutoplay: false,
  recursive: false,
  showEta: true,
  suggest: true,
  suggestWindowSec: 300,
  trashMode: 'source',
  customTrash: '',
  thumbSize: 168,
  sortBy: 'name',
  sortDir: 'asc',
  filter: 'all',
  activeProfileId: 'default',
  zenFlash: true,
  showFilmstrip: true,
  seriesEnabled: true,
  seriesGapSec: 3,
  seriesStrict: 'normal',
  autoCompare: true,
  preselectBest: true,
  showInfo: false,
  renameMode: 'keep',
  accent: 'blue',
  viewerBg: 'theme',
  uiScale: 1,
  keys: { skip: ' ', trash: 'Delete', other: 'Enter' },
  emptyToSystemTrash: true,
  resume: true,
  updateCheck: true,
  aiEnabled: false,
  aiTier: '',
  aiPerf: 'normal',
  aiSuggest: true,
  aiLearnFolders: true,
  aiAutopilot: false,
  aiAutoConf: 0.95,
};

function defaultSettings(): SettingsData {
  return {
    version: 1,
    prefs: { ...defaultPrefs },
    profiles: [{ id: 'default', name: 'Meine Ordner', targets: [], groups: [] }],
    quickStarts: [],
    recentSources: [],
  };
}

export const useStore = create<State>(() => ({
  ready: false,
  settings: defaultSettings(),
  screen: 'home',
  setup: null,
  coach: null,
  session: null,
  dialog: null,
  toasts: [],
  zen: false,
  fullscreen: false,
  reach: {},
  progress: null,
  flash: null,
  scanning: null,
  photoMenu: null,
}));

const get = useStore.getState;
const set = useStore.setState;
const api = () => window.api;

// ---------------------------------------------------------------- Einstellungen

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api().setSettings(get().settings), 300);
}

export async function init() {
  const raw = await api().getSettings();
  const base = defaultSettings();
  const settings: SettingsData = {
    ...base,
    ...raw,
    prefs: { ...base.prefs, ...(raw.prefs || {}) },
    profiles: raw.profiles && raw.profiles.length ? raw.profiles : base.profiles,
    quickStarts: raw.quickStarts || [],
    recentSources: raw.recentSources || [],
  } as SettingsData;
  if (!settings.profiles.some((p) => p.id === settings.prefs.activeProfileId)) {
    settings.prefs.activeProfileId = settings.profiles[0].id;
  }
  // Bestehende Nutzer (ältere Version) brauchen keine Einführung mehr
  if (raw.version && raw.onboarded === undefined && (raw.profiles?.some((p) => p.targets.length) || raw.quickStarts?.length)) {
    settings.onboarded = true;
  }
  if (!raw.prefs?.lang) settings.prefs.lang = detectLang();
  setLang(settings.prefs.lang);
  api().setTheme(settings.prefs.theme);
  set({
    settings,
    ready: true,
    screen: settings.onboarded ? 'home' : 'onboarding',
    fullscreen: await api().isFullscreen(),
  });
  wireEvents();
  watchDirs();
  setTimeout(() => checkForUpdate(false), 6000);
}

function detectLang(): Prefs['lang'] {
  const l = (navigator.language || 'de').slice(0, 2);
  return (['de', 'en', 'fr', 'es', 'it'] as const).find((x) => x === l) || 'en';
}

export function finishOnboarding() {
  updateSettings((s) => ({ ...s, onboarded: true }));
  set({ screen: 'home' });
}

export function restartTutorial() {
  updateSettings((s) => ({ ...s, onboarded: false, tutorialDone: false }));
  set({ screen: 'onboarding', dialog: null, session: null, setup: null });
}

export function updatePrefs(p: Partial<Prefs>) {
  const s = get().settings;
  if (p.lang) setLang(p.lang);
  if (p.theme) api().setTheme(p.theme);
  set({ settings: { ...s, prefs: { ...s.prefs, ...p } } });
  persist();
  const ses = get().session;
  if (!ses) return;
  if ('sortBy' in p || 'sortDir' in p || 'filter' in p) resortSession();
  if ('seriesGapSec' in p || 'seriesStrict' in p || 'seriesEnabled' in p) {
    if (p.seriesEnabled === false) ses.compare = null;
    rebuildSeries(ses, true);
  }
}

export function updateSettings(fn: (s: SettingsData) => SettingsData) {
  set({ settings: fn(get().settings) });
  persist();
  watchDirs();
}

export const prefs = () => get().settings.prefs;
export const isExpert = () => prefs().mode === 'expert';

export function activeProfile(): Profile {
  const s = get().settings;
  const id = get().session?.profileId || s.prefs.activeProfileId;
  return s.profiles.find((p) => p.id === id) || s.profiles[0];
}

export function updateProfile(id: string, fn: (p: Profile) => Profile) {
  updateSettings((s) => ({ ...s, profiles: s.profiles.map((p) => (p.id === id ? fn(p) : p)) }));
}

export function setActiveProfile(id: string) {
  updatePrefs({ activeProfileId: id });
  const s = get().session;
  if (s) set({ session: { ...s, profileId: id, lastSorted: [], rev: s.rev + 1 } });
  watchDirs();
}

/** Alle Ordner, deren Erreichbarkeit überwacht wird. */
function watchDirs() {
  const s = get().settings;
  const dirs = new Set<string>();
  for (const p of s.profiles) for (const tg of p.targets) dirs.add(tg.path);
  for (const q of s.quickStarts) for (const d of q.sources || [q.source]) dirs.add(d);
  const ses = get().session;
  if (ses) for (const d of ses.sources) dirs.add(d);
  api()
    .setWatchedDirs([...dirs])
    .then((r) => set({ reach: { ...get().reach, ...r } }));
}

// ---------------------------------------------------------------- Meldungen

export function toast(kind: Toast['kind'], text: string, opts: Partial<Pick<Toast, 'action' | 'timeout'>> = {}) {
  // Im Modus "Nur Bild" nur wichtige Meldungen (Fehler, Meldungen mit Aktion) zeigen
  if (get().zen && kind !== 'error' && !opts.action) return;
  const id = uid('t');
  const timeout = opts.timeout ?? (kind === 'error' ? 8000 : 2600);
  const others = get().toasts.filter((x) => x.text !== text);
  set({ toasts: [...others.slice(-2), { id, kind, text, action: opts.action, timeout }] });
  if (timeout > 0) setTimeout(() => dismissToast(id), timeout);
}
export function dismissToast(id: string) {
  set({ toasts: get().toasts.filter((x) => x.id !== id) });
}

export function openDialog(d: Dialog) {
  set({ dialog: d });
}
export function closeDialog() {
  set({ dialog: null });
}

// ---------------------------------------------------------------- Ereignisse vom Hauptprozess

let wired = false;
let scanActive = false;
function wireEvents() {
  if (wired) return;
  wired = true;
  const a = api();
  a.on('op:done', onOpDone);
  a.on('op:progress', onProgress);
  a.on('op:idle', () => setTimeout(() => api().pending().then((n) => n === 0 && set({ progress: null })), 400));
  // Nur während eines Einlesevorgangs anzeigen: Späte Meldungen dürfen die
  // Ladeanzeige nicht wieder einschalten (das ließ den Kringel hängen).
  a.on('scan:progress', (n: number) => scanActive && set({ scanning: n }));
  a.on('exif:batch', onExif);
  a.on('exif:done', () => {
    const s = get().session;
    if (!s) return;
    if (prefs().sortBy === 'date') resortSession();
    rebuildSeries(s, true);
    queueAnalysis(s);
  });
  a.on('reach:change', onReach);
  a.on('win:fullscreen', (on: boolean) => set({ fullscreen: on }));
  a.on('app:quitting', (n: number) => toast('info', t('toast.quitting', { n }), { timeout: 0 }));

  configureAnalysis({
    priority: (id) => {
      const s = get().session;
      if (!s) return 0;
      const i = s.viewIds.indexOf(id);
      const c = s.currentId === null ? 0 : s.viewIds.indexOf(s.currentId);
      const inCompare = s.compare?.ids.includes(id) ? -1e9 : 0;
      return inCompare + (i < 0 ? 1e7 : Math.abs(i - c) + (i < c ? 5 : 0));
    },
    onResult: (id, r) => {
      const s = get().session;
      const it = s?.byId.get(id);
      if (!s || !it) return;
      it.analyzed = true;
      if (r) {
        it.hash = r.hash;
        it.sharp = r.sharp;
        it.expo = r.expo;
      }
      scheduleSeriesRefresh();
    },
  });
}

let lastProg = { opId: -1, bytes: 0, time: 0 };
function onProgress(p: ProgressEvent) {
  const now = performance.now();
  const prev = get().progress;
  let speed = prev?.speed || 0;
  if (lastProg.opId === p.opId && now > lastProg.time) {
    const inst = ((p.bytesDone - lastProg.bytes) / (now - lastProg.time)) * 1000;
    if (inst >= 0 && isFinite(inst)) speed = speed ? speed * 0.85 + inst * 0.15 : inst;
  }
  lastProg = { opId: p.opId, bytes: p.bytesDone, time: now };
  set({ progress: { ...p, speed } });
}

function onReach(snap: Record<string, boolean>) {
  const before = get().reach;
  for (const [dir, ok] of Object.entries(snap)) {
    if (ok && before[dir] === false) {
      set({ toasts: get().toasts.filter((x) => !(x.kind === 'error' && x.text.includes(dir))) });
      toast('success', t('toast.reachable', { name: basename(dir) }));
    }
  }
  set({ reach: { ...before, ...snap } });
}

function onExif(batch: [number, number][]) {
  const s = get().session;
  if (!s) return;
  for (const [id, time] of batch) {
    const it = s.byId.get(id);
    if (it) it.t = time;
  }
}

/** Einträge eines (teilweise) fehlgeschlagenen Auftrags zurückholen. */
function revertDone(s: SessionState, id: number, opId: number) {
  const d = s.done.get(id);
  if (!d || d.opId !== opId) return false;
  s.done.delete(id);
  if (d.trash) s.deleted--;
  else if (d.targetId) {
    s.counts[d.targetId] = Math.max(0, (s.counts[d.targetId] || 1) - 1);
    s.sorted--;
  } else s.other--;
  return true;
}

function onOpDone(e: OpDoneEvent) {
  const s = get().session;
  if (!s) return;
  if (e.kind === 'transfer') {
    const failed = e.results.filter((r) => !r.ok);
    if (!failed.length) return;
    for (const r of failed) revertDone(s, r.id, e.opId);
    const failedIds = new Set(failed.map((r) => r.id));
    s.undo = s.undo
      .map((u) => ({
        ...u,
        ops: u.ops.map((o) => (o.opId === e.opId ? { ...o, ids: o.ids.filter((id) => !failedIds.has(id)) } : o)).filter((o) => o.ids.length),
      }))
      .filter((u) => u.kind !== 'transfer' || u.ops.length);
    const first = failed[0];
    if (first.error === 'EUNREACHABLE') {
      if (e.destDir) set({ reach: { ...get().reach, [e.destDir]: false } });
      toast('error', t('toast.unreachable', { path: e.destDir || '' }));
    } else {
      const it = s.byId.get(first.id);
      toast('error', t('toast.failed', { file: it?.name || '?', code: errText(first.error) }));
    }
    recompute(s, { keepId: s.currentId, preferId: first.id });
  } else {
    for (const r of e.results) {
      const it = s.byId.get(r.id);
      if (!it) continue;
      if (r.ok) {
        if (r.path) it.path = r.path;
        if (r.live !== undefined) it.live = r.live;
      } else {
        toast('error', t('toast.undoFailed', { file: it.name, code: errText(r.error) }));
      }
    }
    set({ session: { ...s, rev: s.rev + 1 } });
  }
}

// ---------------------------------------------------------------- Sitzung starten

export interface StartOptions {
  sources: string[];
  profileId: string;
  trashDir: string | null;
  startView: 'grid' | 'single';
  recursive: boolean;
  fullscreen: boolean;
}

export async function startSession(o: StartOptions) {
  scanActive = true;
  set({ scanning: 0 });
  try {
    const { items } = await api().openSession({
      sourceDirs: o.sources,
      recursive: o.recursive,
      trashDir: o.trashDir,
    });
    scanActive = false;
    if (!items.length) {
      set({ scanning: null });
      toast('info', t('start.empty'), { timeout: 5000 });
      return false;
    }
    resetAnalysis();
    const p = prefs();
    const sorted = sortItems(items, p.sortBy, p.sortDir);
    const session: SessionState = {
      sources: o.sources,
      source: o.sources[0],
      profileId: o.profileId,
      items: sorted,
      byId: new Map(items.map((i) => [i.id, i])),
      done: new Map(),
      skipped: new Set(),
      viewIds: [],
      currentId: null,
      selection: new Set(),
      anchorId: null,
      undo: [],
      counts: {},
      deleted: 0,
      sorted: 0,
      other: 0,
      startedAt: Date.now(),
      lastSorted: [],
      view: o.startView,
      summaryShown: false,
      series: [],
      seriesOf: new Map(),
      seriesDone: new Set(),
      seriesCompared: 0,
      compare: null,
      dupes: new Set(),
      dupeGroups: 0,
      query: '',
      only: null,
      aiSugg: new Map(),
      rev: 0,
    };
    if (p.filter === 'skipped') updatePrefs({ filter: 'all' });
    updateSettings((st) => ({
      ...st,
      prefs: { ...st.prefs, activeProfileId: o.profileId },
      recentSources: [o.sources[0], ...st.recentSources.filter((x) => x !== o.sources[0])].slice(0, 8),
      quickStarts: upsertRecent(st.quickStarts, o),
    }));
    rebuildSeries(session, false);
    applyResume(session);
    recompute(session, { keepId: session.currentId });
    set({
      screen: 'session',
      setup: null,
      scanning: null,
      zen: false,
      coach: get().settings.tutorialDone ? null : 0,
    });
    queueAnalysis(session);
    api().exifStart();
    hooks.sessionStarted?.(session);
    if (o.fullscreen) api().setFullscreen(true);
    watchDirs();
    return true;
  } catch (err: any) {
    scanActive = false;
    api().log(`startSession: ${err?.stack || err}`);
    set({ scanning: null });
    toast('error', t('start.error', { msg: String(err?.message || err) }));
    return false;
  }
}

export function goHome() {
  if (resumeTimer) {
    clearTimeout(resumeTimer);
    saveResume();
  }
  scanActive = false;
  resetAnalysis();
  set({ screen: 'home', session: null, setup: null, zen: false, dialog: null, scanning: null, coach: null });
  api().pending().then((n) => n === 0 && set({ progress: null }));
  api().setFullscreen(false);
}

// ---------------------------------------------------------------- Ansicht berechnen

function matchesFilter(it: Item, f: Filter, s: SessionState) {
  if (s.only && !s.only.has(it.id)) return false;
  if (s.query && !it.name.toLowerCase().includes(s.query) && !it.dir.toLowerCase().includes(s.query)) return false;
  if (f === 'duplicates') return s.dupes.has(it.id);
  if (f === 'images') return it.kind === 'image';
  if (f === 'videos') return it.kind === 'video';
  if (f === 'skipped') return s.skipped.has(it.id);
  return true;
}

/** Sitzung neu zeichnen (und ggf. Vergleich automatisch öffnen). */
function commit(s: SessionState) {
  maybeOpenCompare(s);
  set({ session: { ...s, rev: s.rev + 1 } });
  scheduleResume();
  hooks.changed?.(s);
}

// ---------------------------------------------------------------- v2: Weitermachen, wo man aufgehört hat

let resumeTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleResume() {
  if (resumeTimer) clearTimeout(resumeTimer);
  resumeTimer = setTimeout(saveResume, 1500);
}

/** Merkt sich (je Sortierung) das aktuelle Foto und die übersprungenen. */
function saveResume() {
  resumeTimer = null;
  const s = get().session;
  if (!s || !prefs().resume) return;
  const open = s.viewIds.length > 0;
  const current = open && s.currentId !== null ? s.byId.get(s.currentId)?.path ?? null : null;
  const skipped = [...s.skipped].filter((id) => !s.done.has(id)).map((id) => s.byId.get(id)!.path).slice(0, 5000);
  const st = get().settings;
  const quickStarts = st.quickStarts.map((q) =>
    sameSources(sourcesOf(q), s.sources) && q.profileId === s.profileId ? { ...q, resume: open ? { current, skipped, t: Date.now() } : undefined } : q
  );
  set({ settings: { ...st, quickStarts } });
  persist();
}

/** Beim Öffnen: an der gemerkten Stelle weitermachen. */
function applyResume(s: SessionState) {
  if (!prefs().resume) return;
  const q = get().settings.quickStarts.find((x) => sameSources(sourcesOf(x), s.sources) && x.profileId === s.profileId);
  const r = q?.resume;
  if (!r) return;
  const byPath = new Map(s.items.map((it) => [it.path, it.id]));
  for (const p of r.skipped) {
    const id = byPath.get(p);
    if (id !== undefined) s.skipped.add(id);
  }
  const cur = r.current ? byPath.get(r.current) : undefined;
  if (cur === undefined || s.items[0]?.id === cur) return;
  s.currentId = cur;
  const it = s.byId.get(cur)!;
  toast('info', t('toast.resumed', { name: it.name }), {
    timeout: 7000,
    action: {
      label: t('toast.fromStart'),
      run: () => {
        const ses = get().session;
        if (!ses) return;
        ses.skipped = new Set();
        recompute(ses, { atIndex: 0, keepId: null });
      },
    },
  });
}

// ---------------------------------------------------------------- v2: neue Version?

const newer = (a: string, b: string) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

/** Schaut (höchstens einmal am Tag, nur bei GitHub) nach einer neuen Version. */
export async function checkForUpdate(manual = false) {
  const st = get().settings;
  if (!manual && (!st.prefs.updateCheck || Date.now() - (st.lastUpdateCheck || 0) < 20 * 3600 * 1000)) return;
  set({ settings: { ...get().settings, lastUpdateCheck: Date.now() } });
  persist();
  try {
    const r = await fetch('https://api.github.com/repos/slimbitapps/SlimSort/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(String(r.status));
    const latest = String((await r.json()).tag_name || '').replace(/^v/, '');
    const { version } = await api().appInfo();
    if (latest && newer(latest, version)) {
      toast('info', t('update.available', { v: latest }), {
        timeout: 0,
        action: { label: t('update.download'), run: () => api().openExternal('https://slimbitapps.github.io/SlimSort/') },
      });
    } else if (manual) toast('success', t('update.current', { v: version }));
  } catch {
    if (manual) toast('error', t('update.failed'));
  }
}

/**
 * Berechnet die sichtbare Liste neu und hält die Position:
 * Ist das aktuelle Bild weg, rückt das nächste nach.
 */
function recompute(s: SessionState, o: { keepId?: number | null; preferId?: number; atIndex?: number }) {
  const f = prefs().filter;
  const oldIdx = o.atIndex ?? (s.currentId !== null ? s.viewIds.indexOf(s.currentId) : 0);
  const view: number[] = [];
  for (const it of s.items) if (!s.done.has(it.id) && matchesFilter(it, f, s)) view.push(it.id);
  s.viewIds = view;
  const inView = new Set(view);
  let cur: number | null = null;
  if (o.preferId !== undefined && inView.has(o.preferId)) cur = o.preferId;
  else if (o.keepId !== undefined && o.keepId !== null && inView.has(o.keepId)) cur = o.keepId;
  else if (view.length) cur = view[Math.max(0, Math.min(oldIdx, view.length - 1))];
  s.currentId = cur;
  if (s.selection.size) for (const id of [...s.selection]) if (!inView.has(id)) s.selection.delete(id);
  if (s.compare) {
    s.compare.ids = s.compare.ids.filter((id) => !s.done.has(id));
    if (s.compare.ids.length < 2) s.compare = null;
  }
  commit(s);
  maybeFinished(s);
}

function maybeFinished(s: SessionState) {
  if (s.summaryShown) return;
  if (s.done.size >= s.items.length) {
    s.summaryShown = true;
    set({ zen: false });
    openDialog({ type: 'summary' });
  }
}

function resortSession() {
  const s = get().session;
  if (!s) return;
  const p = prefs();
  s.items = sortItems(s.items, p.sortBy, p.sortDir);
  recompute(s, { keepId: s.currentId });
}

/** v2: Suche nach Dateinamen (auch Ordnername) */
export function setQuery(q: string) {
  const s = get().session;
  if (!s) return;
  s.query = q.trim().toLowerCase();
  recompute(s, { keepId: s.currentId });
}

/** KI: nur bestimmte Fotos zeigen (null = alle) */
export function setOnly(ids: number[] | null, opts: { grid?: boolean } = {}) {
  const s = get().session;
  if (!s) return;
  s.only = ids ? new Set(ids) : null;
  if (opts.grid) s.view = 'grid';
  const first = ids?.find((id) => !s.done.has(id));
  recompute(s, { keepId: ids ? undefined : s.currentId, preferId: first });
}

/** KI: Auswahl in der Übersicht setzen */
export function selectIds(ids: number[]) {
  const s = get().session;
  if (!s) return;
  s.selection = new Set(ids.filter((id) => s.byId.has(id) && !s.done.has(id)));
  s.view = 'grid';
  if (ids.length) s.currentId = ids[0];
  commit(s);
}

/** KI: Session neu zeichnen (z. B. nach neuen Vorschlägen) */
export function touchSession() {
  const s = get().session;
  if (s) set({ session: { ...s, rev: s.rev + 1 } });
}

let dupeBusy = false;
/**
 * v2: Exakte Doppelte finden – gleiche Größe, dann gleiche Prüfsumme.
 * Die erste Datei jeder Gruppe gilt als Original, die anderen als „Doppelt“.
 */
export async function findDuplicates() {
  const s = get().session;
  if (!s || dupeBusy) return;
  dupeBusy = true;
  toast('info', t('dupes.searching'), { timeout: 2500 });
  try {
    const bySize = new Map<number, Item[]>();
    for (const it of s.items) {
      if (s.done.has(it.id)) continue;
      const l = bySize.get(it.size);
      if (l) l.push(it);
      else bySize.set(it.size, [it]);
    }
    const cand = [...bySize.values()].filter((l) => l.length > 1).flat();
    const hashes = cand.length ? await api().fileHashes(cand.map((it) => it.path)) : {};
    const byHash = new Map<string, Item[]>();
    for (const it of cand) {
      const h = hashes[it.path];
      if (!h) continue;
      const k = `${it.size}:${h}`;
      const l = byHash.get(k);
      if (l) l.push(it);
      else byHash.set(k, [it]);
    }
    const cur = get().session;
    if (cur !== s) return;
    s.dupes = new Set();
    let groups = 0;
    let bytes = 0;
    for (const l of byHash.values()) {
      if (l.length < 2) continue;
      groups++;
      // Original = ältestes Foto (bzw. erstes in der Liste); der Rest ist doppelt
      const sorted = l.slice().sort((a, b) => itemTime(a) - itemTime(b) || a.name.localeCompare(b.name));
      for (const it of sorted.slice(1)) {
        s.dupes.add(it.id);
        bytes += it.size;
      }
    }
    s.dupeGroups = groups;
    if (!s.dupes.size) {
      toast('success', t('dupes.none'));
      set({ session: { ...s, rev: s.rev + 1 } });
      return;
    }
    toast('success', t(s.dupes.size === 1 ? 'dupes.found1' : 'dupes.found', { n: s.dupes.size, size: fmtBytes(bytes) }), {
      timeout: 12000,
      action: {
        label: t('dupes.show'),
        run: () => {
          const ses = get().session;
          if (!ses) return;
          ses.view = 'grid';
          updatePrefs({ filter: 'duplicates' });
        },
      },
    });
    set({ session: { ...s, rev: s.rev + 1 } });
  } catch (e: any) {
    toast('error', String(e?.message || e));
  } finally {
    dupeBusy = false;
  }
}

export const currentItem = (s: SessionState | null) =>
  s && s.currentId !== null ? s.byId.get(s.currentId) || null : null;
export const currentIndex = (s: SessionState) => (s.currentId === null ? -1 : s.viewIds.indexOf(s.currentId));

// ---------------------------------------------------------------- Serien

/**
 * Nur Fotos mit echter Aufnahmezeit aus den Fotodaten zählen für Serien.
 * (Das Dateidatum ist nach dem Kopieren oft bei allen Dateien gleich.)
 */
function seriesInput(s: SessionState) {
  const out: { id: number; t: number; kind: 'image' | 'video'; hash?: [number, number] }[] = [];
  for (const it of s.items) if (it.t !== undefined && it.kind === 'image') out.push({ id: it.id, t: it.t, kind: it.kind, hash: it.hash });
  return out;
}

/** Serien neu berechnen (nach Zeit und – sobald analysiert – nach Motiv). */
function rebuildSeries(s: SessionState, publish: boolean) {
  const p = prefs();
  if (!p.seriesEnabled) {
    s.series = [];
    s.seriesOf = new Map();
  } else {
    s.series = computeSeries(seriesInput(s), p.seriesGapSec * 1000, MOTIF_DIST[p.seriesStrict]);
    s.seriesOf = new Map();
    s.series.forEach((ids, i) => ids.forEach((id) => s.seriesOf.set(id, i)));
  }
  if (publish) commit(s);
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSeriesRefresh() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    const s = get().session;
    if (!s) return;
    rebuildSeries(s, false);
    // Vorauswahl im offenen Vergleich aktualisieren, solange nichts angefasst wurde
    if (s.compare && !s.compare.touched) s.compare.keep = defaultKeep(s.compare.ids);
    set({ session: { ...s, rev: s.rev + 1 } });
  }, 250);
}

/** Fotos, die zu Serien gehören könnten, im Hintergrund analysieren lassen. */
// Klappt das Vorschaubild nicht, wird das Original analysiert (falls der Browser es lesen kann)
const analysisJob = (it: Item) => ({
  id: it.id,
  url: thumbUrl(it.path, 512),
  fallback: browserCanShow(it.ext) ? mediaUrl(it.path) : undefined,
});

function queueAnalysis(s: SessionState) {
  if (!prefs().seriesEnabled) return;
  // Kandidaten: Fotos mit einem zeitlichen Nachbarn innerhalb des Abstands
  const gap = prefs().seriesGapSec * 1000;
  const imgs = s.items.filter((i) => i.kind === 'image' && i.t !== undefined).sort((a, b) => a.t! - b.t!);
  const jobs: { id: number; url: string; fallback?: string }[] = [];
  for (let i = 0; i < imgs.length; i++) {
    const it = imgs[i];
    if (it.analyzed) continue;
    const near = (i > 0 && it.t! - imgs[i - 1].t! <= gap) || (i < imgs.length - 1 && imgs[i + 1].t! - it.t! <= gap);
    if (near) jobs.push(analysisJob(it));
  }
  if (jobs.length) requestAnalysis(jobs);
}

export function analysisFor(ids: number[]) {
  const s = get().session;
  if (!s) return;
  const jobs = ids
    .map((id) => s.byId.get(id))
    .filter((it): it is Item => !!it && !it.analyzed && it.kind === 'image')
    .map(analysisJob);
  if (jobs.length) requestAnalysis(jobs);
}

export const seriesKey = (ids: number[]) => Math.min(...ids);

/** Offene (noch nicht einsortierte) Mitglieder der Serie des Eintrags */
export function openSeriesOf(s: SessionState, id: number | null): number[] {
  if (id === null) return [];
  const idx = s.seriesOf.get(id);
  if (idx === undefined) return [];
  return s.series[idx].filter((x) => !s.done.has(x));
}

export function seriesCount(s: SessionState) {
  return s.series.filter((ids) => ids.filter((x) => !s.done.has(x)).length >= 2).length;
}

/** Wie viele Serien ergäben sich mit diesem Abstand? (Vorschau in den Einstellungen) */
export function previewSeriesCount(gapSec: number) {
  const s = get().session;
  if (!s) return null;
  const p = prefs();
  return computeSeries(seriesInput(s), gapSec * 1000, MOTIF_DIST[p.seriesStrict]).length;
}

export function rankingFor(ids: number[]) {
  const s = get().session;
  return rankSeries(ids, (id) => s?.byId.get(id), MOTIF_DIST[prefs().seriesStrict]);
}

function defaultKeep(ids: number[]): Set<number> {
  const r = rankingFor(ids);
  if (!prefs().preselectBest || r.best === null) return new Set(ids);
  // Bestes Foto behalten – und alles mit anderem Motiv (nie automatisch löschen)
  return new Set([r.best, ...r.different]);
}

function maybeOpenCompare(s: SessionState) {
  const p = prefs();
  if (!p.seriesEnabled || !p.autoCompare || s.compare || s.view !== 'single' || get().coach !== null) return;
  const open = openSeriesOf(s, s.currentId);
  if (open.length < 2) return;
  const key = seriesKey(s.series[s.seriesOf.get(s.currentId!)!]);
  if (s.seriesDone.has(key)) return;
  s.compare = { ids: open, key, page: 0, keep: defaultKeep(open), touched: false };
  analysisFor(open);
}

/** Vergleich öffnen: aktuelle Serie oder die Auswahl in der Übersicht. */
export function openCompare() {
  const s = get().session;
  if (!s) return;
  let ids: number[] = [];
  let key: number | null = null;
  if (s.view === 'grid' && s.selection.size >= 2) ids = s.viewIds.filter((id) => s.selection.has(id));
  else {
    ids = openSeriesOf(s, s.currentId);
    if (ids.length >= 2) key = seriesKey(s.series[s.seriesOf.get(s.currentId!)!]);
  }
  if (ids.length < 2) return;
  ids = ids.filter((id) => s.byId.get(id)?.kind === 'image');
  if (ids.length < 2) return;
  s.compare = { ids, key, page: 0, keep: defaultKeep(ids), touched: false };
  analysisFor(ids);
  set({ session: { ...s, rev: s.rev + 1 } });
}

/** Bestimmte Fotos vergleichen (z. B. aus dem Rechtsklick-Menü). */
export function openCompareIds(ids: number[]) {
  const s = get().session;
  if (!s) return;
  ids = ids.filter((id) => s.byId.get(id)?.kind === 'image' && !s.done.has(id));
  if (ids.length < 2) return;
  s.compare = { ids, key: null, page: 0, keep: defaultKeep(ids), touched: false };
  analysisFor(ids);
  set({ session: { ...s, rev: s.rev + 1 } });
}

function closeCompare(s: SessionState, markDone: boolean) {
  const c = s.compare;
  if (!c) return;
  if (markDone && c.key !== null) s.seriesDone.add(c.key);
  s.compare = null;
}

/** Vergleich überspringen: Fotos einzeln weiter ansehen. */
export function compareSkip() {
  const s = get().session;
  if (!s || !s.compare) return;
  const first = s.compare.ids[0];
  closeCompare(s, true);
  if (s.view === 'single') s.currentId = first;
  set({ session: { ...s, rev: s.rev + 1 } });
}

export function compareToggle(id: number) {
  const s = get().session;
  if (!s?.compare) return;
  const k = new Set(s.compare.keep);
  if (k.has(id)) k.delete(id);
  else k.add(id);
  s.compare = { ...s.compare, keep: k, touched: true };
  set({ session: { ...s, rev: s.rev + 1 } });
}

export function compareKeepOnly(id: number) {
  const s = get().session;
  if (!s?.compare) return;
  s.compare = { ...s.compare, keep: new Set([id]), touched: true };
  set({ session: { ...s, rev: s.rev + 1 } });
}

export function compareKeepAll() {
  const s = get().session;
  if (!s?.compare) return;
  s.compare = { ...s.compare, keep: new Set(s.compare.ids), touched: true };
  set({ session: { ...s, rev: s.rev + 1 } });
}

export function comparePage(delta: number) {
  const s = get().session;
  if (!s?.compare) return;
  const pages = Math.ceil(s.compare.ids.length / comparePageSize());
  const page = Math.max(0, Math.min(pages - 1, s.compare.page + delta));
  s.compare = { ...s.compare, page };
  set({ session: { ...s, rev: s.rev + 1 } });
}

export function comparePageSize() {
  return window.innerWidth < 1100 ? 4 : 6;
}

/** Foto Nr. n (1-basiert, auf der aktuellen Seite) */
export function compareIdAt(n: number) {
  const s = get().session;
  if (!s?.compare) return null;
  const ps = comparePageSize();
  return s.compare.ids[s.compare.page * ps + n - 1] ?? null;
}

/**
 * Vergleich abschließen: Behaltene bleiben (oder kommen in den Zielordner),
 * alle anderen wandern in den Papierkorb. Ein Rückgängig nimmt alles zurück.
 */
export function compareConfirm(targetId?: string) {
  const s = get().session;
  if (!s?.compare) return;
  const c = s.compare;
  const keep = c.ids.filter((id) => c.keep.has(id));
  const drop = c.ids.filter((id) => !c.keep.has(id));
  let target: Target | undefined;
  if (targetId) {
    target = activeProfile().targets.find((x) => x.id === targetId);
    if (target && get().reach[target.path] === false) {
      toast('error', t('toast.unreachable', { path: target.path }));
      api().checkReach().then(onReach);
      return;
    }
  }
  const prevCurrent = s.currentId;
  const ops: OpRec[] = [];
  if (target && keep.length) ops.push(startOp(s, keep, { targetId: target.id, destDir: target.path }));
  if (drop.length) ops.push(startOp(s, drop, { trash: true }));
  closeCompare(s, true);
  s.seriesCompared++;
  if (ops.length) s.undo.push({ kind: 'transfer', ops, prevCurrent: c.ids[0] ?? prevCurrent, seriesKey: c.key ?? undefined });
  if (target && get().zen && prefs().zenFlash) flash(target.name, target.color, target.key);
  recompute(s, { preferId: target ? undefined : keep[0] });
}

// ---------------------------------------------------------------- Navigation & Auswahl

export function goTo(id: number | null, opts: { select?: boolean } = {}) {
  const s = get().session;
  if (!s || id === null) return;
  s.currentId = id;
  if (opts.select) {
    s.selection = new Set([id]);
    s.anchorId = id;
  }
  commit(s);
}

export function step(delta: number) {
  const s = get().session;
  if (!s || !s.viewIds.length) return;
  const i = currentIndex(s);
  const n = Math.max(0, Math.min(s.viewIds.length - 1, i + delta));
  goTo(s.viewIds[n]);
}

export function jumpEdge(end: boolean) {
  const s = get().session;
  if (!s || !s.viewIds.length) return;
  goTo(end ? s.viewIds[s.viewIds.length - 1] : s.viewIds[0]);
}

export function setView(view: 'grid' | 'single') {
  const s = get().session;
  if (!s) return;
  s.view = view;
  commit(s);
}

export function toggleView() {
  const s = get().session;
  if (s) setView(s.view === 'grid' ? 'single' : 'grid');
}

/** Klick in der Übersicht: einfach, Shift (Bereich), Strg/⌘ (umschalten) */
export function clickSelect(id: number, mods: { shift: boolean; toggle: boolean }) {
  const s = get().session;
  if (!s) return;
  if (mods.shift && s.anchorId !== null) {
    const a = s.viewIds.indexOf(s.anchorId);
    const b = s.viewIds.indexOf(id);
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      if (!mods.toggle) s.selection = new Set();
      for (let i = lo; i <= hi; i++) s.selection.add(s.viewIds[i]);
    }
  } else if (mods.toggle) {
    if (s.selection.has(id)) s.selection.delete(id);
    else s.selection.add(id);
    s.anchorId = id;
  } else {
    s.selection = new Set([id]);
    s.anchorId = id;
  }
  s.currentId = id;
  set({ session: { ...s, rev: s.rev + 1 } });
}

export function selectAll() {
  const s = get().session;
  if (!s) return;
  s.selection = new Set(s.viewIds);
  set({ session: { ...s, rev: s.rev + 1 } });
}

export function clearSelection() {
  const s = get().session;
  if (!s || !s.selection.size) return false;
  s.selection = new Set();
  set({ session: { ...s, rev: s.rev + 1 } });
  return true;
}

/** Welche Einträge betrifft eine Aktion? Übersicht: Auswahl, sonst aktuelles Bild. */
function actionIds(s: SessionState): number[] {
  if (s.view === 'grid' && s.selection.size) return s.viewIds.filter((id) => s.selection.has(id));
  return s.currentId !== null ? [s.currentId] : [];
}

// ---------------------------------------------------------------- Sortieren

let opCounter = 0;

function flash(name: string, color: string, key: string) {
  const n = (get().flash?.n || 0) + 1;
  set({ flash: { name, color, key, n } });
  setTimeout(() => {
    if (get().flash?.n === n) set({ flash: null });
  }, 650);
}

/** Startet einen Dateiauftrag und markiert die Einträge als erledigt. */
function startOp(s: SessionState, ids: number[], o: { targetId?: string; destDir?: string; trash?: boolean }): OpRec {
  const opId = ++opCounter;
  const targetId = o.targetId ?? null;
  const trash = !!o.trash;
  for (const id of ids) {
    s.done.set(id, { opId, targetId, trash });
    s.skipped.delete(id);
    const it = s.byId.get(id);
    if (targetId && it) s.lastSorted = [{ targetId, t: itemTime(it) }, ...s.lastSorted].slice(0, 30);
  }
  if (trash) s.deleted += ids.length;
  else if (targetId) {
    s.counts[targetId] = (s.counts[targetId] || 0) + ids.length;
    s.sorted += ids.length;
  } else s.other += ids.length;
  const action = trash ? 'trash' : prefs().transferMode === 'copy' ? 'copy' : 'move';
  // v2: Unterordner nach Datum (je Zielordner) und neue Dateinamen
  const subdirs: Record<number, string> = {};
  const names: Record<number, string> = {};
  if (!trash) {
    const tg = targetId ? activeProfile().targets.find((x) => x.id === targetId) : undefined;
    const mode = prefs().renameMode;
    for (const id of ids) {
      const it = s.byId.get(id);
      if (!it) continue;
      const sub = dateFolder(itemTime(it), tg?.subfolders);
      if (sub) subdirs[id] = sub;
      if (mode !== 'keep') names[id] = newName(it, mode);
    }
  }
  api().transfer({ opId, itemIds: ids, destDir: o.destDir, action, liveVideo: prefs().liveVideo, subdirs, names });
  hooks.sorted?.(ids, targetId ? activeProfile().targets.find((x) => x.id === targetId) ?? null : null, trash);
  return { opId, ids, targetId, trash };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Unterordner nach Aufnahmedatum: "2025", "2025/08" oder "2025/08/03" */
export function dateFolder(ms: number, mode: Target['subfolders']): string {
  if (!mode || mode === 'none' || !isFinite(ms)) return '';
  const d = new Date(ms);
  const y = String(d.getFullYear());
  if (mode === 'year') return y;
  if (mode === 'month') return `${y}/${pad(d.getMonth() + 1)}`;
  return `${y}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

/** Neuer Dateiname (ohne Endung): "2025-08-03 14.22.05" bzw. mit altem Namen dahinter */
export function newName(it: Item, mode: Prefs['renameMode']): string {
  const d = new Date(itemTime(it));
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
  const stem = it.name.replace(/\.[^.]+$/, '');
  return mode === 'dateName' ? `${stamp} ${stem}` : stamp;
}

export function findTargetByKey(key: string): Target | undefined {
  return activeProfile().targets.find((tg) => tg.key === key);
}

/**
 * Aktuelles Foto (bzw. Auswahl) in einen Zielordner.
 * wholeSeries: mit Shift – alle Fotos der Serie auf einmal.
 */
export function sortToTarget(targetId: string, opts: { wholeSeries?: boolean } = {}) {
  const s = get().session;
  if (!s) return;
  if (s.compare) return compareConfirm(targetId);
  const target = activeProfile().targets.find((x) => x.id === targetId);
  if (!target) return;
  let ids = actionIds(s);
  if (opts.wholeSeries && s.view === 'single') {
    const ser = openSeriesOf(s, s.currentId);
    if (ser.length >= 2) ids = ser;
  }
  if (!ids.length) return;
  if (get().reach[target.path] === false) {
    toast('error', t('toast.unreachable', { path: target.path }));
    api().checkReach().then(onReach);
    return;
  }
  const prevCurrent = s.currentId;
  const op = startOp(s, ids, { targetId, destDir: target.path });
  s.undo.push({ kind: 'transfer', ops: [op], prevCurrent });
  s.selection = new Set();
  if (ids.length > 1 && opts.wholeSeries) toast('success', t('toast.seriesMoved', { n: ids.length, name: target.name }));
  if (get().zen && prefs().zenFlash) flash(target.name, target.color, target.key);
  recompute(s, {});
}

export function trashCurrent() {
  const s = get().session;
  if (!s) return;
  if (s.compare) return compareConfirm();
  const ids = actionIds(s);
  if (!ids.length) return;
  const op = startOp(s, ids, { trash: true });
  s.undo.push({ kind: 'transfer', ops: [op], prevCurrent: s.currentId });
  s.selection = new Set();
  if (get().zen && prefs().zenFlash) flash(t('targets.trash'), '#ef5a6f', t('key.del'));
  recompute(s, {});
}

/** Welche Fotos betrifft Ziehen/Rechtsklick? Gehört das Foto zur Auswahl: alle ausgewählten. */
export function idsFor(id: number): number[] {
  const s = get().session;
  if (!s) return [];
  if (s.view === 'grid' && s.selection.has(id) && s.selection.size > 1) return s.viewIds.filter((x) => s.selection.has(x));
  return [id];
}

export function photoDrag(it: Item): DragPayload | null {
  const s = get().session;
  if (!s || s.compare) return null;
  return { kind: 'photos', ids: idsFor(it.id), label: it.name, thumb: thumbUrl(it.path, 128) };
}

export function openPhotoMenu(id: number, x: number, y: number) {
  const s = get().session;
  // Rechtsklick auf ein nicht ausgewähltes Foto: dieses auswählen (wie im Explorer/Finder)
  if (s && s.view === 'grid' && !s.selection.has(id)) {
    s.selection = new Set([id]);
    s.anchorId = id;
    s.currentId = id;
    set({ session: { ...s, rev: s.rev + 1 } });
  }
  set({ photoMenu: { id, x, y } });
}

export function closePhotoMenu() {
  set({ photoMenu: null });
}

/** Bestimmte Fotos (z. B. per Ziehen) in einen Zielordner. */
export function sortIdsToTarget(ids: number[], targetId: string) {
  const s = get().session;
  if (!s) return;
  const target = activeProfile().targets.find((x) => x.id === targetId);
  ids = ids.filter((id) => s.byId.has(id) && !s.done.has(id));
  if (!target || !ids.length) return;
  if (get().reach[target.path] === false) {
    toast('error', t('toast.unreachable', { path: target.path }));
    api().checkReach().then(onReach);
    return;
  }
  if (s.compare) closeCompare(s, false);
  const op = startOp(s, ids, { targetId, destDir: target.path });
  s.undo.push({ kind: 'transfer', ops: [op], prevCurrent: s.currentId });
  s.selection = new Set();
  if (ids.length > 1) toast('success', t('toast.movedN', { n: ids.length, name: target.name }));
  recompute(s, {});
}

/** Bestimmte Fotos (z. B. per Ziehen) in den Löschordner. */
export function trashIds(ids: number[]) {
  const s = get().session;
  if (!s) return;
  ids = ids.filter((id) => s.byId.has(id) && !s.done.has(id));
  if (!ids.length) return;
  if (s.compare) closeCompare(s, false);
  const op = startOp(s, ids, { trash: true });
  s.undo.push({ kind: 'transfer', ops: [op], prevCurrent: s.currentId });
  s.selection = new Set();
  recompute(s, {});
}

export function skipCurrent() {
  const s = get().session;
  if (!s || s.currentId === null) return;
  if (s.compare) return compareSkip();
  const id = s.currentId;
  const wasSkipped = s.skipped.has(id);
  s.skipped.add(id);
  s.undo.push({ kind: 'skip', ops: [], skipIds: wasSkipped ? [] : [id], prevCurrent: id });
  const i = currentIndex(s);
  if (i < s.viewIds.length - 1) {
    s.currentId = s.viewIds[i + 1];
    commit(s);
  } else {
    set({ session: { ...s, rev: s.rev + 1 } });
    const open = s.items.filter((x) => !s.done.has(x.id));
    const skippedOpen = open.filter((x) => s.skipped.has(x.id)).length;
    if (prefs().filter !== 'skipped' && skippedOpen === open.length && skippedOpen > 0) {
      toast('info', t('toast.endReached', { n: skippedOpen }), {
        timeout: 10000,
        action: { label: t('toast.showSkipped'), run: () => updatePrefs({ filter: 'skipped' }) },
      });
    }
  }
}

/** "Anderer Ordner …": nur dieses Foto einmalig in einen beliebigen Ordner. */
export async function otherFolder() {
  const s = get().session;
  if (!s) return;
  const ids = s.compare ? s.compare.ids.filter((id) => s.compare!.keep.has(id)) : actionIds(s);
  if (!ids.length) return;
  const wasFs = get().fullscreen;
  const dir = await api().pickFolder({ title: t('other.title') });
  if (wasFs && !get().fullscreen) api().setFullscreen(true);
  if (!dir) return;
  const ops: OpRec[] = [startOp(s, ids, { destDir: dir })];
  let key: number | undefined;
  if (s.compare) {
    const drop = s.compare.ids.filter((id) => !s.compare!.keep.has(id));
    if (drop.length) ops.push(startOp(s, drop, { trash: true }));
    key = s.compare.key ?? undefined;
    closeCompare(s, true);
    s.seriesCompared++;
  }
  s.undo.push({ kind: 'transfer', ops, prevCurrent: s.currentId, seriesKey: key });
  s.selection = new Set();
  recompute(s, {});
  const already = activeProfile().targets.some((x) => x.path === dir);
  toast('success', t('toast.otherDone', { name: basename(dir) }), {
    timeout: 9000,
    action: already ? undefined : { label: t('toast.keepAsTarget'), run: () => addTarget(dir, true) },
  });
}

export function undo() {
  const s = get().session;
  if (!s) return;
  if (s.compare) closeCompare(s, false);
  const u = s.undo.pop();
  if (!u) {
    toast('info', t('toast.nothingToUndo'));
    set({ session: { ...s, rev: s.rev + 1 } });
    return;
  }
  if (u.kind === 'skip') {
    for (const id of u.skipIds || []) s.skipped.delete(id);
    recompute(s, { preferId: u.prevCurrent ?? undefined });
    return;
  }
  const all: number[] = [];
  for (const op of [...u.ops].reverse()) {
    for (const id of op.ids) revertDone(s, id, op.opId);
    if (op.targetId) {
      const times = new Set(op.ids.map((id) => s.byId.get(id)).filter(Boolean).map((it) => itemTime(it!)));
      s.lastSorted = s.lastSorted.filter((x) => !(x.targetId === op.targetId && times.has(x.t)));
    }
    api().undo(op.opId);
    hooks.undone?.(op.ids);
    all.push(...op.ids);
  }
  if (u.seriesKey !== undefined) {
    // Ganzen Vergleich zurücknehmen – er öffnet sich wieder
    s.seriesDone.delete(u.seriesKey);
    s.seriesCompared = Math.max(0, s.seriesCompared - 1);
  } else if (all.length > 1) s.selection = new Set(all);
  s.summaryShown = false;
  if (get().dialog?.type === 'summary') closeDialog();
  recompute(s, { preferId: u.prevCurrent ?? all[0] });
  toast('info', t('toast.undone'), { timeout: 1200 });
}

/** Zielvorschlag: Ziel eines zeitlich nahen, gerade einsortierten Bildes. */
export function suggestionFor(s: SessionState, it: Item | null): string | null {
  const p = prefs();
  const ai = it && p.aiEnabled && p.aiSuggest ? s.aiSugg.get(it.id) : undefined;
  if (ai && ai.conf >= 0.5) return ai.targetId;
  if (!p.suggest || !it || !s.lastSorted.length) return null;
  const tc = itemTime(it);
  let best: { id: string; d: number } | null = null;
  for (const x of s.lastSorted) {
    const d = Math.abs(tc - x.t);
    if (d <= p.suggestWindowSec * 1000 && (!best || d < best.d)) best = { id: x.targetId, d };
  }
  return best?.id ?? null;
}

// ---------------------------------------------------------------- Zielordner verwalten

function nextFreeKey(targets: Target[]) {
  const used = new Set(targets.map((x) => x.key));
  const order = '1234567890QWERTZUIOPASDFGHJKLYXCVBNM'.split('');
  return order.find((k) => !used.has(k)) || '';
}

export async function pickAndAddTarget() {
  const dir = await api().pickFolder({ title: t('targets.add') });
  if (dir) addTarget(dir, false);
}

export function addTarget(dir: string, askKey: boolean) {
  const prof = activeProfile();
  if (prof.targets.some((x) => x.path === dir)) return;
  const target: Target = {
    id: uid('tg'),
    name: basename(dir),
    path: dir,
    key: askKey ? '' : nextFreeKey(prof.targets),
    color: COLORS.find((c) => !prof.targets.some((x) => x.color === c)) || COLORS[prof.targets.length % COLORS.length],
    groupId: null,
  };
  updateProfile(prof.id, (p) => ({ ...p, targets: [...p.targets, target] }));
  if (askKey) openDialog({ type: 'keyCapture', targetId: target.id });
}

export function updateTarget(id: string, patch: Partial<Target>) {
  const prof = activeProfile();
  updateProfile(prof.id, (p) => ({ ...p, targets: p.targets.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
}

export function setTargetKey(id: string, key: string) {
  if (key && !isAssignableKey(key)) return;
  const prof = activeProfile();
  updateProfile(prof.id, (p) => ({
    ...p,
    targets: p.targets.map((x) => (x.id === id ? { ...x, key } : x.key === key && key ? { ...x, key: '' } : x)),
  }));
}

export function removeTarget(id: string) {
  const prof = activeProfile();
  const gone = prof.targets.find((x) => x.id === id);
  if (gone) hooks.targetRemoved?.(gone);
  updateProfile(prof.id, (p) => cleanupGroups({ ...p, targets: p.targets.filter((x) => x.id !== id) }));
}

/** Gruppen mit weniger als 2 Mitgliedern auflösen. */
function cleanupGroups(p: Profile): Profile {
  const counts: Record<string, number> = {};
  for (const x of p.targets) if (x.groupId) counts[x.groupId] = (counts[x.groupId] || 0) + 1;
  const keep = new Set(Object.keys(counts).filter((g) => counts[g] >= 2));
  return {
    ...p,
    targets: p.targets.map((x) => (x.groupId && !keep.has(x.groupId) ? { ...x, groupId: null } : x)),
    groups: p.groups.filter((g) => keep.has(g.id)),
  };
}

/** Ziel "dragId" vor/hinter "overId" einsortieren (Umsortieren). */
export function reorderTarget(dragId: string, overId: string, after: boolean, intoGroup: string | null | undefined) {
  const prof = activeProfile();
  updateProfile(prof.id, (p) => {
    const list = p.targets.slice();
    const from = list.findIndex((x) => x.id === dragId);
    if (from < 0) return p;
    const [item] = list.splice(from, 1);
    let to = list.findIndex((x) => x.id === overId);
    if (to < 0) to = list.length;
    else if (after) to++;
    const moved = { ...item, groupId: intoGroup === undefined ? item.groupId : intoGroup };
    list.splice(to, 0, moved);
    return cleanupGroups({ ...p, targets: list });
  });
}

export function moveTargetToEnd(dragId: string) {
  const prof = activeProfile();
  updateProfile(prof.id, (p) => {
    const list = p.targets.filter((x) => x.id !== dragId);
    const item = p.targets.find((x) => x.id === dragId);
    if (!item) return p;
    return cleanupGroups({ ...p, targets: [...list, { ...item, groupId: null }] });
  });
}

/** Ziel auf ein anderes ziehen -> Gruppe (wie Ordner auf dem iPhone). */
export function groupTargets(dragId: string, ontoId: string) {
  if (dragId === ontoId) return;
  const prof = activeProfile();
  updateProfile(prof.id, (p) => {
    const onto = p.targets.find((x) => x.id === ontoId);
    const drag = p.targets.find((x) => x.id === dragId);
    if (!onto || !drag) return p;
    let groups = p.groups;
    let gid = onto.groupId;
    if (!gid) {
      gid = uid('g');
      groups = [...groups, { id: gid, name: t('targets.group'), collapsed: false }];
    }
    const list = p.targets.filter((x) => x.id !== dragId).map((x) => (x.id === ontoId ? { ...x, groupId: gid } : x));
    const idx = list.findIndex((x) => x.id === ontoId);
    list.splice(idx + 1, 0, { ...drag, groupId: gid });
    return cleanupGroups({ ...p, targets: list, groups });
  });
}

export function updateGroup(id: string, patch: Partial<{ name: string; collapsed: boolean }>) {
  const prof = activeProfile();
  updateProfile(prof.id, (p) => ({ ...p, groups: p.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) }));
}

export function dissolveGroup(id: string) {
  const prof = activeProfile();
  updateProfile(prof.id, (p) =>
    cleanupGroups({ ...p, targets: p.targets.map((x) => (x.groupId === id ? { ...x, groupId: null } : x)) })
  );
}

// ---------------------------------------------------------------- Zuletzt verwendet

export const sourcesOf = (q: QuickStart) => (q.sources && q.sources.length ? q.sources : [q.source]);

export function updateQuickStart(id: string, patch: Partial<QuickStart>) {
  updateSettings((s) => ({ ...s, quickStarts: s.quickStarts.map((q) => (q.id === id ? { ...q, ...patch } : q)) }));
}
export function deleteQuickStart(id: string) {
  updateSettings((s) => ({ ...s, quickStarts: s.quickStarts.filter((q) => q.id !== id) }));
}
export function runQuickStart(q: QuickStart) {
  return startSession({
    sources: sourcesOf(q),
    profileId: q.profileId,
    trashDir: q.trashDir,
    startView: q.startView,
    recursive: q.recursive,
    fullscreen: q.fullscreen,
  });
}

const sameSources = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Jede gestartete Sortierung wird gemerkt (max. 9 + angeheftete). */
function upsertRecent(list: QuickStart[], o: StartOptions): QuickStart[] {
  const now = Date.now();
  const existing = list.find((q) => sameSources(sourcesOf(q), o.sources) && q.profileId === o.profileId);
  const base = {
    source: o.sources[0],
    sources: o.sources,
    profileId: o.profileId,
    trashDir: o.trashDir,
    startView: o.startView,
    recursive: o.recursive,
    fullscreen: o.fullscreen,
    lastUsed: now,
  };
  const entry: QuickStart = existing
    ? { ...existing, ...base }
    : { id: uid('q'), name: o.sources.map(basename).join(' + '), ...base, pinned: false };
  const rest = list.filter((q) => q !== existing);
  const all = [entry, ...rest];
  const pinned = all.filter((q) => q.pinned);
  const others = all.filter((q) => !q.pinned).sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  return [...pinned, ...others].slice(0, Math.max(9, pinned.length));
}

export function sortedRecents(list: QuickStart[]) {
  const pinned = list.filter((q) => q.pinned);
  const others = list.filter((q) => !q.pinned).sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  return [...pinned, ...others];
}

export function forgetRecent(id: string) {
  deleteQuickStart(id);
}
export function togglePinRecent(id: string) {
  const q = get().settings.quickStarts.find((x) => x.id === id);
  if (q) updateQuickStart(id, { pinned: !q.pinned });
}

// ---------------------------------------------------------------- Neue Sortierung einrichten

export function beginSetup(sources: string[]) {
  const p = prefs();
  const recent = get().settings.quickStarts.find((q) => sameSources(sourcesOf(q), sources));
  if (recent) updatePrefs({ activeProfileId: recent.profileId });
  set({
    screen: 'setup',
    setup: {
      step: 0,
      sources,
      recursive: recent?.recursive ?? p.recursive,
      count: null,
      counting: true,
      startView: recent?.startView ?? 'single',
      trashDir: recent?.trashDir ?? resolveTrashDir(),
      fullscreen: recent?.fullscreen ?? false,
    },
  });
  countSetup();
}

export async function countSetup() {
  const st = get().setup;
  if (!st) return;
  set({ setup: { ...st, counting: true, count: null } });
  try {
    const count = await api().countMedia({ dirs: st.sources, recursive: st.recursive });
    const cur = get().setup;
    if (cur && sameSources(cur.sources, st.sources) && cur.recursive === st.recursive) set({ setup: { ...cur, count, counting: false } });
  } catch (e: any) {
    api().log(`count: ${e?.stack || e}`);
    const cur = get().setup;
    if (cur) set({ setup: { ...cur, counting: false, count: { images: 0, videos: 0, total: 0, sample: [] } } });
    toast('error', t('start.error', { msg: String(e?.message || e) }));
  }
}

export function updateSetup(patch: Partial<SetupState>) {
  const st = get().setup;
  if (!st) return;
  set({ setup: { ...st, ...patch } });
  if (patch.sources !== undefined || patch.recursive !== undefined) countSetup();
}

export async function pickSetupSource() {
  const dir = await api().pickFolder({ title: t('home.pick') });
  if (!dir) return;
  beginSetup([dir]);
}

/** Weiteren Quellordner hinzufügen */
export async function addSetupSource() {
  const st = get().setup;
  if (!st) return;
  const dir = await api().pickFolder({ title: t('setup.source.add') });
  if (!dir || st.sources.includes(dir)) return;
  updateSetup({ sources: [...st.sources, dir] });
}

export function removeSetupSource(dir: string) {
  const st = get().setup;
  if (!st || st.sources.length < 2) return;
  updateSetup({ sources: st.sources.filter((x) => x !== dir) });
}

export function startFromSetup() {
  const st = get().setup;
  if (!st) return;
  return startSession({
    sources: st.sources,
    profileId: activeProfile().id,
    trashDir: st.trashDir,
    startView: st.startView,
    recursive: st.recursive,
    fullscreen: st.fullscreen,
  });
}

/** Legt einen neuen Zielordner an und fügt ihn hinzu. */
export async function createTargetFolder(parent: string, name: string) {
  try {
    const dir = await api().createFolder({ parent, name });
    addTarget(dir, false);
    return dir;
  } catch (e: any) {
    toast('error', String(e?.message || e));
    return null;
  }
}

// ---------------------------------------------------------------- Einführung (Coach Marks)

export function coachNext(total: number) {
  const c = get().coach;
  if (c === null) return;
  if (c + 1 >= total) coachEnd();
  else set({ coach: c + 1 });
}
export function coachEnd() {
  set({ coach: null });
  if (!get().settings.tutorialDone) updateSettings((s) => ({ ...s, tutorialDone: true }));
  const s = get().session;
  if (s) commit(s); // jetzt ggf. den Serien-Vergleich öffnen
}

// ---------------------------------------------------------------- Diverses

export function toggleFullscreen() {
  api().setFullscreen(!get().fullscreen);
}
export function setZen(on: boolean) {
  set({ zen: on });
}

export function resolveTrashDir() {
  const p = prefs();
  return p.trashMode === 'custom' && p.customTrash ? p.customTrash : null;
}

export async function emptyTrash(systemTrash = prefs().emptyToSystemTrash) {
  const r = await api().emptyTrash(systemTrash);
  const s = get().session;
  if (s && r.pruned.length) {
    const pr = new Set(r.pruned);
    s.undo = s.undo.map((u) => ({ ...u, ops: u.ops.filter((o) => !pr.has(o.opId)) })).filter((u) => u.kind !== 'transfer' || u.ops.length);
  }
  if (r.removed) toast('success', t(systemTrash ? 'toast.trashToSystem' : 'toast.trashEmptied', { n: r.removed }));
  // Netzlaufwerke haben oft keinen Papierkorb: diese Dateien bleiben liegen – auf Wunsch endgültig löschen
  if (r.kept) {
    toast('error', t('toast.trashKept', { n: r.kept }), {
      timeout: 0,
      action: { label: t('toast.trashKeptDelete'), run: () => emptyTrash(false) },
    });
  }
  return r;
}
