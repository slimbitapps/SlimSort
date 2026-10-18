import { create } from 'zustand';
import { setLang, t, errText } from './i18n';
import type {
  Item, Prefs, Profile, QuickStart, SettingsData, Target, OpDoneEvent, ProgressEvent, Filter,
} from './types';
import { basename, COLORS, itemTime, sortItems, uid, isAssignableKey } from './util';

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
  | { type: 'prompt'; title: string; value: string; onOk: (v: string) => void }
  | { type: 'quickEdit'; id: string };

interface UndoEntry {
  kind: 'transfer' | 'skip';
  opId?: number;
  ids: number[];
  targetId?: string | null;
  trash?: boolean;
  prevCurrent: number | null;
  prevView?: 'grid' | 'single';
}

interface DoneInfo {
  opId: number;
  targetId: string | null; // null = Papierkorb oder "anderer Ordner"
  trash: boolean;
}

export interface SessionState {
  source: string;
  trashDir: string;
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

interface State {
  ready: boolean;
  settings: SettingsData;
  screen: 'start' | 'session';
  session: SessionState | null;
  dialog: Dialog;
  toasts: Toast[];
  zen: boolean;
  fullscreen: boolean;
  reach: Record<string, boolean>;
  progress: Progress | null;
  flash: { name: string; color: string; key: string; n: number } | null;
  scanning: number | null;
}

// ---------------------------------------------------------------- Standardwerte

export const defaultPrefs: Prefs = {
  lang: 'de',
  theme: 'dark',
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
};

function defaultSettings(): SettingsData {
  return {
    version: 1,
    prefs: { ...defaultPrefs },
    profiles: [{ id: 'default', name: 'Standard', targets: [], groups: [] }],
    quickStarts: [],
    recentSources: [],
  };
}

export const useStore = create<State>(() => ({
  ready: false,
  settings: defaultSettings(),
  screen: 'start',
  session: null,
  dialog: null,
  toasts: [],
  zen: false,
  fullscreen: false,
  reach: {},
  progress: null,
  flash: null,
  scanning: null,
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
  setLang(settings.prefs.lang);
  set({ settings, ready: true, fullscreen: await api().isFullscreen() });
  wireEvents();
  watchDirs();
}

export function updatePrefs(p: Partial<Prefs>) {
  const s = get().settings;
  if (p.lang) setLang(p.lang);
  set({ settings: { ...s, prefs: { ...s.prefs, ...p } } });
  persist();
  if (('sortBy' in p || 'sortDir' in p || 'filter' in p) && get().session) {
    resortSession();
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
  for (const q of s.quickStarts) dirs.add(q.source);
  const ses = get().session;
  if (ses) dirs.add(ses.source);
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
function wireEvents() {
  if (wired) return;
  wired = true;
  const a = api();
  a.on('op:done', onOpDone);
  a.on('op:progress', onProgress);
  a.on('op:idle', () => setTimeout(() => api().pending().then((n) => n === 0 && set({ progress: null })), 400));
  a.on('scan:progress', (n: number) => set({ scanning: n }));
  a.on('exif:batch', onExif);
  a.on('exif:done', () => {
    const s = get().session;
    if (s && prefs().sortBy === 'date') resortSession();
  });
  a.on('reach:change', onReach);
  a.on('win:fullscreen', (on: boolean) => set({ fullscreen: on }));
  a.on('app:quitting', (n: number) => toast('info', t('toast.quitting', { n }), { timeout: 0 }));
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
    if (ok && before[dir] === false) toast('success', t('toast.reachable', { name: basename(dir) }));
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

function onOpDone(e: OpDoneEvent) {
  const s = get().session;
  if (!s) return;
  if (e.kind === 'transfer') {
    const failed = e.results.filter((r) => !r.ok);
    if (!failed.length) return;
    for (const r of failed) {
      const d = s.done.get(r.id);
      if (d && d.opId === e.opId) {
        s.done.delete(r.id);
        if (d.trash) s.deleted--;
        else if (d.targetId) {
          s.counts[d.targetId] = Math.max(0, (s.counts[d.targetId] || 1) - 1);
          s.sorted--;
        } else s.other--;
      }
    }
    // Rückgängig-Eintrag anpassen
    const failedIds = new Set(failed.map((r) => r.id));
    s.undo = s.undo
      .map((u) => (u.opId === e.opId ? { ...u, ids: u.ids.filter((id) => !failedIds.has(id)) } : u))
      .filter((u) => u.kind !== 'transfer' || u.ids.length);
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
  source: string;
  profileId: string;
  trashDir: string | null;
  startView: 'grid' | 'single';
  recursive: boolean;
  fullscreen: boolean;
}

export async function startSession(o: StartOptions) {
  set({ scanning: 0 });
  try {
    const { items, trashDir } = await api().openSession({
      sourceDir: o.source,
      recursive: o.recursive,
      trashDir: o.trashDir,
    });
    if (!items.length) {
      set({ scanning: null });
      toast('info', t('start.empty'), { timeout: 5000 });
      return false;
    }
    const p = prefs();
    const sorted = sortItems(items, p.sortBy, p.sortDir);
    const session: SessionState = {
      source: o.source,
      trashDir,
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
      rev: 0,
    };
    if (p.filter === 'skipped') updatePrefs({ filter: 'all' });
    updateSettings((st) => ({
      ...st,
      prefs: { ...st.prefs, activeProfileId: o.profileId },
      recentSources: [o.source, ...st.recentSources.filter((x) => x !== o.source)].slice(0, 8),
    }));
    recompute(session, {});
    set({ screen: 'session', scanning: null, zen: false });
    if (o.fullscreen) api().setFullscreen(true);
    watchDirs();
    return true;
  } catch (err: any) {
    set({ scanning: null });
    toast('error', t('start.error', { msg: String(err?.message || err) }));
    return false;
  }
}

export function goHome() {
  set({ screen: 'start', session: null, zen: false, dialog: null });
  api().pending().then((n) => n === 0 && set({ progress: null }));
  api().setFullscreen(false);
}

// ---------------------------------------------------------------- Ansicht berechnen

function matchesFilter(it: Item, f: Filter, s: SessionState) {
  if (f === 'images') return it.kind === 'image';
  if (f === 'videos') return it.kind === 'video';
  if (f === 'skipped') return s.skipped.has(it.id);
  return true;
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
  let cur: number | null = null;
  if (o.preferId !== undefined && view.includes(o.preferId)) cur = o.preferId;
  else if (o.keepId !== undefined && o.keepId !== null && view.includes(o.keepId)) cur = o.keepId;
  else if (view.length) cur = view[Math.max(0, Math.min(oldIdx, view.length - 1))];
  s.currentId = cur;
  if (s.selection.size) {
    const inView = new Set(view);
    for (const id of [...s.selection]) if (!inView.has(id)) s.selection.delete(id);
  }
  set({ session: { ...s, rev: s.rev + 1 } });
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

export const currentItem = (s: SessionState | null) =>
  s && s.currentId !== null ? s.byId.get(s.currentId) || null : null;
export const currentIndex = (s: SessionState) => (s.currentId === null ? -1 : s.viewIds.indexOf(s.currentId));

// ---------------------------------------------------------------- Navigation & Auswahl

export function goTo(id: number | null, opts: { select?: boolean } = {}) {
  const s = get().session;
  if (!s || id === null) return;
  s.currentId = id;
  if (opts.select) {
    s.selection = new Set([id]);
    s.anchorId = id;
  }
  set({ session: { ...s, rev: s.rev + 1 } });
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
  set({ session: { ...s, view, rev: s.rev + 1 } });
}

export function toggleView() {
  const s = get().session;
  if (s) setView(s.view === 'grid' ? 'single' : 'grid');
}

/** Klick im Raster: einfach, Shift (Bereich), Strg/⌘ (umschalten) */
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

/** Welche Einträge betrifft eine Aktion? Raster: Auswahl, sonst aktuelles Bild. */
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

export function findTargetByKey(key: string): Target | undefined {
  return activeProfile().targets.find((tg) => tg.key === key);
}

export function sortToTarget(targetId: string) {
  const s = get().session;
  if (!s) return;
  const target = activeProfile().targets.find((x) => x.id === targetId);
  if (!target) return;
  const ids = actionIds(s);
  if (!ids.length) return;
  if (get().reach[target.path] === false) {
    toast('error', t('toast.unreachable', { path: target.path }));
    api().checkReach().then(onReach);
    return;
  }
  const action = prefs().transferMode === 'copy' ? 'copy' : 'move';
  const opId = ++opCounter;
  const prevCurrent = s.currentId;
  for (const id of ids) {
    s.done.set(id, { opId, targetId, trash: false });
    s.skipped.delete(id);
    const it = s.byId.get(id);
    if (it) s.lastSorted = [{ targetId, t: itemTime(it) }, ...s.lastSorted].slice(0, 30);
  }
  s.counts[targetId] = (s.counts[targetId] || 0) + ids.length;
  s.sorted += ids.length;
  s.undo.push({ kind: 'transfer', opId, ids, targetId, prevCurrent, prevView: s.view });
  s.selection = new Set();
  api().transfer({ opId, itemIds: ids, destDir: target.path, action, liveVideo: prefs().liveVideo });
  if (get().zen && prefs().zenFlash) flash(target.name, target.color, target.key);
  recompute(s, {});
}

export function trashCurrent() {
  const s = get().session;
  if (!s) return;
  const ids = actionIds(s);
  if (!ids.length) return;
  const opId = ++opCounter;
  for (const id of ids) {
    s.done.set(id, { opId, targetId: null, trash: true });
    s.skipped.delete(id);
  }
  s.deleted += ids.length;
  s.undo.push({ kind: 'transfer', opId, ids, targetId: null, trash: true, prevCurrent: s.currentId, prevView: s.view });
  s.selection = new Set();
  api().transfer({ opId, itemIds: ids, action: 'trash', liveVideo: prefs().liveVideo });
  if (get().zen && prefs().zenFlash) flash(t('targets.trash'), '#ef4f5f', t('key.del'));
  recompute(s, {});
}

export function skipCurrent() {
  const s = get().session;
  if (!s || s.currentId === null) return;
  const id = s.currentId;
  const wasSkipped = s.skipped.has(id);
  s.skipped.add(id);
  s.undo.push({ kind: 'skip', ids: wasSkipped ? [] : [id], prevCurrent: id });
  const i = currentIndex(s);
  if (i < s.viewIds.length - 1) {
    s.currentId = s.viewIds[i + 1];
    set({ session: { ...s, rev: s.rev + 1 } });
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

/** "Anderer Ordner …": nur dieses Bild einmalig in einen beliebigen Ordner. */
export async function otherFolder() {
  const s = get().session;
  if (!s) return;
  const ids = actionIds(s);
  if (!ids.length) return;
  const wasFs = get().fullscreen;
  const dir = await api().pickFolder({ title: t('other.title') });
  if (wasFs && !get().fullscreen) api().setFullscreen(true);
  if (!dir) return;
  const action = prefs().transferMode === 'copy' ? 'copy' : 'move';
  const opId = ++opCounter;
  for (const id of ids) {
    s.done.set(id, { opId, targetId: null, trash: false });
    s.skipped.delete(id);
  }
  s.other += ids.length;
  s.undo.push({ kind: 'transfer', opId, ids, targetId: null, prevCurrent: s.currentId, prevView: s.view });
  s.selection = new Set();
  api().transfer({ opId, itemIds: ids, destDir: dir, action, liveVideo: prefs().liveVideo });
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
  const u = s.undo.pop();
  if (!u) {
    toast('info', t('toast.nothingToUndo'));
    return;
  }
  if (u.kind === 'skip') {
    for (const id of u.ids) s.skipped.delete(id);
    recompute(s, { preferId: u.prevCurrent ?? undefined });
    return;
  }
  for (const id of u.ids) {
    const d = s.done.get(id);
    if (!d || d.opId !== u.opId) continue;
    s.done.delete(id);
    if (d.trash) s.deleted--;
    else if (d.targetId) {
      s.counts[d.targetId] = Math.max(0, (s.counts[d.targetId] || 1) - 1);
      s.sorted--;
    } else s.other--;
  }
  if (u.targetId) {
    const times = new Set(u.ids.map((id) => s.byId.get(id)).filter(Boolean).map((it) => itemTime(it!)));
    s.lastSorted = s.lastSorted.filter((x) => !(x.targetId === u.targetId && times.has(x.t)));
  }
  api().undo(u.opId!);
  if (u.ids.length > 1) s.selection = new Set(u.ids);
  s.summaryShown = false;
  if (get().dialog?.type === 'summary') closeDialog();
  recompute(s, { preferId: u.prevCurrent ?? u.ids[0] });
  toast('info', t('toast.undone'), { timeout: 1200 });
}

/** Zielvorschlag: Ziel eines zeitlich nahen, gerade einsortierten Bildes. */
export function suggestionFor(s: SessionState, it: Item | null): string | null {
  const p = prefs();
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
    color: COLORS[prof.targets.length % COLORS.length],
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

// ---------------------------------------------------------------- Schnellstart

export function saveQuickStart(q: Omit<QuickStart, 'id'>) {
  updateSettings((s) => ({ ...s, quickStarts: [...s.quickStarts, { ...q, id: uid('q') }] }));
}
export function updateQuickStart(id: string, patch: Partial<QuickStart>) {
  updateSettings((s) => ({ ...s, quickStarts: s.quickStarts.map((q) => (q.id === id ? { ...q, ...patch } : q)) }));
}
export function deleteQuickStart(id: string) {
  updateSettings((s) => ({ ...s, quickStarts: s.quickStarts.filter((q) => q.id !== id) }));
}
export function runQuickStart(q: QuickStart) {
  return startSession({
    source: q.source,
    profileId: q.profileId,
    trashDir: q.trashDir,
    startView: q.startView,
    recursive: q.recursive,
    fullscreen: q.fullscreen,
  });
}

// ---------------------------------------------------------------- Diverses

export function toggleFullscreen() {
  api().setFullscreen(!get().fullscreen);
}
export function setZen(on: boolean) {
  set({ zen: on });
}

export function resolveTrashDir(source: string) {
  const p = prefs();
  return p.trashMode === 'custom' && p.customTrash ? p.customTrash : null;
}

export async function emptyTrash() {
  const r = await api().emptyTrash();
  const s = get().session;
  if (s && r.pruned.length) {
    const pr = new Set(r.pruned);
    s.undo = s.undo.filter((u) => !(u.opId && pr.has(u.opId)));
  }
  toast('success', t('toast.trashEmptied', { n: r.removed }));
  return r;
}
