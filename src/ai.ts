/**
 * KI in der Oberfläche: Vorschläge im Dock, Lernen beim Sortieren, "KI sortieren" und der Chat.
 * Die eigentliche Rechnung passiert in Rust (src-tauri/src/ai) – hier nur die Steuerung.
 */
import { create } from 'zustand';
import {
  useStore, hooks, prefs, updatePrefs, activeProfile, sortIdsToTarget, trashIds, toast, openDialog, setOnly,
  selectIds, touchSession, goTo, setView, findDuplicates, undo, type SessionState,
} from './store';
import { t } from './i18n';
import type { AiStatus, AiTier, Target } from './types';
import { itemTime } from './util';
import { parse, findTarget, matchesDate, type Intent, type Ref, type DateFilter } from './chat';
import { chatPrompt, warmPrompt, situation, describeItem, wantsPhotos, cleanAnswer, type Turn } from './assistant';
import { getLang } from './i18n';

const api = () => window.api;

export interface ChatAction {
  label: string;
  run: () => void;
  danger?: boolean;
  primary?: boolean;
}

export interface ChatMsg {
  id: number;
  from: 'me' | 'ai';
  text: string;
  /** Antwort des Sprachmodells, die noch geschrieben wird */
  llmId?: number;
  streaming?: boolean;
  /** gefundene Fotos (als Vorschaubilder) */
  ids?: number[];
  actions?: ChatAction[];
}

export interface SortGroup {
  targetId: string;
  ids: number[];
  on: boolean;
}

export interface SortPlan {
  all: { id: number; targetId: string; conf: number }[];
  minConf: number;
  off: Set<string>;
}

interface AiUi {
  status: AiStatus | null;
  chatOpen: boolean;
  busy: boolean;
  /** was gerade passiert (z. B. "Sprachmodell wird geladen …") */
  busyText: string;
  /** laufende Anfrage ans Sprachmodell (zum Abbrechen) */
  llmId: number | null;
  /** bisheriges Gespräch (für das Sprachmodell) */
  hist: Turn[];
  msgs: ChatMsg[];
  /** Fotos, auf die sich "sie"/"diese" im Chat beziehen */
  lastIds: number[];
  plan: SortPlan | null;
}

export const useAi = create<AiUi>(() => ({ status: null, chatOpen: false, busy: false, busyText: '', llmId: null, hist: [], msgs: [], lastIds: [], plan: null }));
const ui = useAi.getState;
const setUi = useAi.setState;
let msgId = 0;

const session = () => useStore.getState().session;
const on = () => prefs().aiEnabled && !!ui().status?.installed;
const TRASH = 'trash';

// ---------------------------------------------------------------- Start & Einstellungen

let inited = false;
export function initAi() {
  if (inited) return;
  inited = true;
  const a = api();
  a.on('ai:status', (s: AiStatus) => {
    const before = ui().status;
    setUi({ status: s });
    if (before && before.indexed !== s.indexed) refreshSoon();
  });
  a.on('ai:idle', () => {
    refreshSoon();
    maybeAutopilot();
  });
  a.on('ai:download', (r: { ok: boolean; error?: string }) => {
    if (r.ok) {
      toast('success', t('ai.downloaded'));
      a.ai.config(prefs().aiEnabled, prefs().aiPerf, currentTier()).then(syncSession);
    } else if (r.error && r.error !== 'abgebrochen') toast('error', t('ai.downloadFailed', { error: r.error }));
  });
  a.ai.status().then((s) => setUi({ status: s }));
  // Wörter des Sprachmodells live in die Antwort schreiben
  a.on('llm:token', (e: { id: number; t: string }) => {
    const msgs = ui().msgs;
    const i = msgs.findIndex((m) => m.llmId === e.id && m.streaming);
    if (i < 0) return;
    const next = msgs.slice();
    next[i] = { ...msgs[i], text: msgs[i].text + e.t };
    setUi({ msgs: next });
  });
  hooks.sessionStarted = () => {
    autopilotDone = false;
    syncSession();
  };
  hooks.changed = () => refreshSoon();
  hooks.sorted = (ids, target, trash) => {
    if (!prefs().aiEnabled) return;
    const dest = trash ? TRASH : target?.path;
    if (dest) a.ai.learn(ids, dest);
    // Gelerntes hat sich geändert → Vorschläge neu berechnen
    const s = session();
    if (s) s.aiSugg.clear();
  };
  hooks.undone = (ids) => {
    if (prefs().aiEnabled) a.ai.learn(ids, null);
    session()?.aiSugg.clear();
  };
  hooks.targetRemoved = (tg) => {
    if (prefs().aiEnabled) a.ai.renameTarget(tg.path, null);
  };
}

/** Einstellung geändert (an/aus, Leistung) → Rust Bescheid geben */
/** Gewählte Stufe (oder die für diesen Computer empfohlene) */
export function currentTier(): AiTier {
  return prefs().aiTier || ui().status?.hw.recommended || 'eco';
}

export async function applyAiPrefs() {
  const p = prefs();
  await api().ai.config(p.aiEnabled, p.aiPerf, currentTier());
  setUi({ status: await api().ai.status() });
  if (p.aiEnabled) syncSession();
  else {
    const s = session();
    if (s) {
      s.aiSugg.clear();
      touchSession();
    }
  }
}

export function startDownload() {
  api().ai.download();
  setUi({ status: { ...(ui().status as AiStatus), downloading: true, received: 0 } });
}

/** Geöffnete Sortierung an die KI geben (Fotos analysieren, aus Zielordnern lernen) */
function syncSession() {
  const s = session();
  if (!s || !prefs().aiEnabled) return;
  const items = s.items.filter((it) => it.kind === 'image' && !s.done.has(it.id)).map((it) => ({ id: it.id, path: it.path }));
  api().ai.index(items);
  if (prefs().aiLearnFolders) api().ai.learnFolders(activeProfile().targets.map((tg) => ({ target: tg.path, dir: tg.path })));
}

function targetsWithTrash() {
  return [...activeProfile().targets.map((tg) => tg.path), TRASH];
}

function targetIdOf(dest: string): string | null {
  if (dest === TRASH) return TRASH;
  return activeProfile().targets.find((tg) => tg.path === dest)?.id ?? null;
}

// ---------------------------------------------------------------- Vorschläge für das aktuelle Foto

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
function refreshSoon() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refresh();
  }, 200);
}

let lastPrio = '';
async function refresh() {
  const s = session();
  if (!s || !on() || s.currentId === null) return;
  const i = s.viewIds.indexOf(s.currentId);
  const ids = s.viewIds.slice(Math.max(0, i), i + 12);
  const key = ids.join(',');
  if (key !== lastPrio) {
    lastPrio = key;
    api().ai.prioritize(ids);
  }
  if (!prefs().aiSuggest) return;
  const todo = ids.filter((id) => !s.aiSugg.has(id));
  if (!todo.length) return;
  const res = await api().ai.suggest(todo, targetsWithTrash());
  const cur = session();
  if (cur !== s && cur?.items !== s.items) return;
  let changed = false;
  for (const r of res) {
    const tid = targetIdOf(r.target);
    if (!tid) continue;
    s.aiSugg.set(r.id, { targetId: tid, conf: r.conf });
    changed = true;
  }
  if (changed) touchSession();
}

// ---------------------------------------------------------------- KI sortieren / Autopilot

/** Vorschläge für alle offenen Fotos der aktuellen Ansicht */
async function suggestAll(): Promise<SortPlan['all'] | null> {
  const s = session();
  if (!s) return null;
  const ids = s.viewIds.filter((id) => s.byId.get(id)?.kind === 'image');
  const res = await api().ai.suggest(ids, targetsWithTrash());
  return res.flatMap((r) => {
    const tid = targetIdOf(r.target);
    return tid ? [{ id: r.id, targetId: tid, conf: r.conf }] : [];
  });
}

export function planGroups(plan: SortPlan): SortGroup[] {
  const by = new Map<string, number[]>();
  for (const x of plan.all) {
    if (x.conf < plan.minConf) continue;
    if (!by.has(x.targetId)) by.set(x.targetId, []);
    by.get(x.targetId)!.push(x.id);
  }
  const order = [...activeProfile().targets.map((tg) => tg.id), TRASH];
  return order.filter((id) => by.has(id)).map((id) => ({ targetId: id, ids: by.get(id)!, on: !plan.off.has(id) }));
}

/** Öffnet die Übersicht "KI sortieren". Gibt false zurück, wenn noch nichts gelernt ist. */
export async function openAutoSort(): Promise<boolean> {
  if (!on()) {
    openDialog({ type: 'settings', tab: 'ai' });
    return false;
  }
  const all = await suggestAll();
  if (!all || !all.length) {
    toast('info', t('ai.needMore'), { timeout: 6000 });
    return false;
  }
  setUi({ plan: { all, minConf: Math.min(prefs().aiAutoConf, 0.8), off: new Set() } });
  return true;
}

/** Plan ausführen: je Ordner ein Schritt (einzeln rückgängig machbar) */
export function runPlan(plan: SortPlan): number {
  let n = 0;
  for (const g of planGroups(plan)) {
    if (!g.on) continue;
    if (g.targetId === TRASH) trashIds(g.ids);
    else sortIdsToTarget(g.ids, g.targetId);
    n += g.ids.length;
  }
  setUi({ plan: null });
  return n;
}

let autopilotDone = false;
async function maybeAutopilot() {
  const p = prefs();
  if (autopilotDone || !p.aiAutopilot || !on() || !session()) return;
  autopilotDone = true;
  const all = await suggestAll();
  if (!all?.length) return;
  const plan: SortPlan = { all: all.filter((x) => x.targetId !== TRASH), minConf: p.aiAutoConf, off: new Set() };
  const steps = planGroups(plan).length;
  const n = runPlan(plan);
  if (n)
    toast('success', t('ai.autopilotDone', { n }), {
      timeout: 10000,
      action: { label: t('ai.undo'), run: () => Array.from({ length: steps }, () => undo()) },
    });
}

// ---------------------------------------------------------------- Chat

export function toggleChat(open?: boolean) {
  const o = open ?? !ui().chatOpen;
  setUi({ chatOpen: o });
  if (o && !ui().msgs.length) say(t(llmOn() ? 'ai.chatHelloLlm' : 'ai.chatHello'));
  if (o) warmLlm();
}

function say(text: string, extra: Partial<ChatMsg> = {}) {
  setUi({ msgs: [...ui().msgs, { id: ++msgId, from: 'ai', text, ...extra }] });
}

export function clearChat() {
  stopLlm();
  setUi({ msgs: [], lastIds: [], hist: [] });
  say(t('ai.chatHello'));
}

function refIds(s: SessionState, ref: Ref): number[] {
  const open = (ids: number[]) => ids.filter((id) => s.byId.has(id) && !s.done.has(id));
  if (ref === 'current') return s.currentId !== null ? [s.currentId] : [];
  if (ref === 'selection') return open([...s.selection]);
  const last = open(ui().lastIds);
  if (last.length) return last;
  if (s.selection.size) return open([...s.selection]);
  return s.currentId !== null ? [s.currentId] : [];
}

const fmtPct = (x: number) => `${Math.round(x * 100)} %`;

/** Fotos suchen: Datum/Videos vorfiltern, dann nach Beschreibung ordnen */
const TEMPLATE: Record<string, string> = { de: 'ein Foto von {q}', en: 'a photo of {q}', fr: 'une photo de {q}', es: 'una foto de {q}', it: 'una foto di {q}' };

async function find(
  s: SessionState,
  q: { query?: string; date?: DateFilter; video?: boolean; count?: number; raw?: boolean }
): Promise<number[] | string> {
  let pool = s.viewIds.filter((id) => !s.done.has(id));
  if (s.only) pool = s.items.filter((it) => !s.done.has(it.id)).map((it) => it.id); // Suche über alle, nicht nur die letzte Auswahl
  if (q.video) pool = pool.filter((id) => s.byId.get(id)?.kind === 'video');
  if (q.date) pool = pool.filter((id) => matchesDate(itemTime(s.byId.get(id)!), q.date!));
  if (!q.query) return pool;
  if (!on()) return t('ai.needAi');
  const st = ui().status;
  if (st && st.total && st.indexed < st.total * 0.2) say(t('ai.stillIndexing', { done: st.indexed, total: st.total }));
  // kurze Beschreibung → "ein Foto von …" (so wurden die Modelle trainiert)
  const text = q.raw ? q.query : (TEMPLATE[getLang()] || TEMPLATE.en).replace('{q}', q.query);
  const hits = await api().ai.search(text, pool.filter((id) => s.byId.get(id)?.kind === 'image'), 300);
  if (!hits.length) return [];
  // "ein Foto" → nur die besten paar zeigen
  if (q.count && q.count > 0) return hits.slice(0, Math.max(q.count, Math.min(4, hits.length))).map((h) => h.id);
  return cutHits(hits).map((h) => h.id);
}

/**
 * Welche Treffer zeigen? Die Werte (Ähnlichkeit × Faktor des Modells) liegen eng beieinander,
 * deshalb zählt der Abstand: deutlich über dem Durchschnitt, nah am besten Treffer,
 * und Schluss bei einer klaren Lücke. Mindestens 3, höchstens 120.
 */
export function cutHits<T extends { score: number }>(hits: T[]): T[] {
  if (hits.length <= 3) return hits;
  const xs = hits.map((h) => h.score);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  const thr = Math.max(xs[0] - 3, mean + 0.5 * sd);
  const out: T[] = [];
  for (let i = 0; i < hits.length && out.length < 120; i++) {
    if (i >= 3 && (xs[i] < thr || xs[i - 1] - xs[i] > 1.5)) break;
    out.push(hits[i]);
  }
  return out;
}

function resultActions(ids: number[]): ChatAction[] {
  return [
    { label: t('ai.actShow'), run: () => setOnly(ids, { grid: true }), primary: true },
    { label: t('ai.actSelect'), run: () => selectIds(ids) },
    { label: t('ai.actDelete'), run: () => confirmDelete(ids), danger: true },
  ];
}

function confirmDelete(ids: number[]) {
  say(t('ai.confirmDelete', { n: ids.length }), {
    ids: ids.slice(0, 12),
    actions: [
      { label: t('ai.yesDelete', { n: ids.length }), run: () => (trashIds(ids), say(t('ai.deleted', { n: ids.length }))), danger: true },
      { label: t('ai.no'), run: () => say(t('ai.ok')) },
    ],
  });
}

function moveTo(ids: number[], tg: Target) {
  sortIdsToTarget(ids, tg.id);
  say(t('ai.moved', { n: ids.length, name: tg.name }), { actions: [{ label: t('ai.undo'), run: () => (undo(), say(t('ai.undone'))) }] });
  setUi({ lastIds: [] });
}

/** Sprachmodell nutzbar? (Stufe mit Chat, installiert, Prozessor passt) */
export function llmOn(): boolean {
  const st = ui().status;
  return !!st && prefs().aiEnabled && currentTier() !== 'eco' && st.chat && st.hw.chatOk;
}

export async function send(text: string) {
  text = text.trim();
  if (!text || ui().busy) return;
  setUi({ msgs: [...ui().msgs, { id: ++msgId, from: 'me', text }], busy: true, busyText: '' });
  try {
    const intent = parse(text);
    // Klare Befehle direkt ausführen; Fragen, Gespräch und Suchen übernimmt das Sprachmodell
    if (llmOn() && (intent.kind === 'search' || intent.kind === 'greet' || intent.kind === 'thanks' || intent.kind === 'describe')) {
      try {
        await llmTurn(text, intent);
        return;
      } catch (e: any) {
        if (String(e?.message || e).includes('abgebrochen')) return;
        api().log(`llm: ${e?.message || e}`);
        say(t('ai.llmFailed'));
      }
    }
    await handle(intent);
  } catch (e: any) {
    say(t('ai.error', { error: String(e?.message || e) }));
  } finally {
    setUi({ busy: false, busyText: '', llmId: null });
  }
}

let llmSeq = Math.floor(Math.random() * 1e6);

/** Laufende Antwort abbrechen */
export function stopLlm() {
  const id = ui().llmId;
  if (id !== null) api().ai.chatCancel(id);
}

/** Sprachmodell schon laden, wenn der Chat aufgeht (damit die erste Antwort schneller kommt) */
let warmed = false;
export async function warmLlm() {
  if (!llmOn() || warmed) return;
  warmed = true;
  try {
    // Modell laden und die (immer gleiche) Anleitung schon einmal durchrechnen
    if (await api().ai.chatWarm()) await api().ai.chat(++llmSeq, { prompt: warmPrompt(), max: 1, temp: 0 });
  } catch {
    warmed = false;
  }
}

async function tagsOf(id: number | null | undefined): Promise<string[]> {
  if (id === null || id === undefined || !on()) return [];
  try {
    return (await api().ai.tags(id)).map((x) => x[0]);
  } catch {
    return [];
  }
}

async function llmTurn(text: string, intent: Intent) {
  warmed = true; // Vorladen ist jetzt überflüssig
  const s = session();
  const think = currentTier() === 'balanced'; // Qwen3 1.7B denkt sonst erst lange nach
  if (!ui().status?.chatRunning) setUi({ busyText: t('ai.llmLoading') });

  // Schritt 1: Fotos suchen, wenn danach gefragt wird (entscheidet SlimSort selbst – zuverlässig und ohne Wartezeit)
  let result: string | null = null;
  let ids: number[] | undefined;
  let actions: ChatAction[] | undefined;
  if (s && intent.kind === 'search' && (intent.query || intent.date || intent.video) && wantsPhotos(text)) {
    setUi({ busyText: t('ai.searching') });
    const one = /\b(ein|eine|einen|einem|a|an|one|un|une|uno|una)\s+(foto|bild|photo|picture|image)\b/i.test(text);
    const r = await find(s, { query: intent.query, date: intent.date, video: intent.video, count: one ? 1 : 0 });
    if (typeof r === 'string') result = r;
    else if (!r.length) result = `Keine passenden Fotos zu „${intent.query || text}“ gefunden.`;
    else {
      ids = r;
      actions = resultActions(r);
      setUi({ lastIds: r });
      const best = s.byId.get(r[0])!;
      result = `Suche nach „${intent.query || text}“: ${r.length} passende Fotos gefunden und angezeigt. Bestes: ${describeItem(best, await tagsOf(best.id))}.`;
    }
  }

  // Schritt 2: Antwort in Sätzen (wird live geschrieben)
  const prompt = chatPrompt(ui().hist.slice(-4), text, situation(s, await tagsOf(s?.currentId)), result, think);
  const id = ++llmSeq;
  const mid = ++msgId;
  setUi({ llmId: id, busyText: ui().status?.chatRunning ? '' : t('ai.llmLoading') });
  setUi({ msgs: [...ui().msgs, { id: mid, from: 'ai', text: '', llmId: id, streaming: true, ids: ids?.slice(0, 24), actions }] });
  let answer = '';
  try {
    const r = await api().ai.chat(id, { prompt, max: 260, temp: 0.6, stop: ['<|im_end|>'] });
    answer = cleanAnswer(r.text).trim();
  } finally {
    const fallback = ids?.length ? t('ai.found', { n: ids.length }) : t('ai.ok');
    answer = answer || ui().msgs.find((m) => m.id === mid)?.text.trim() || fallback;
    setUi({
      msgs: ui().msgs.map((m) => (m.id === mid ? { ...m, text: answer, streaming: false } : m)),
      hist: [...ui().hist, { user: text, assistant: answer }].slice(-8),
      busyText: '',
    });
  }
}

async function handle(it: Intent) {
  const s = session();
  const needSession = !['help', 'greet', 'thanks', 'theme', 'settings'].includes(it.kind);
  if (needSession && !s) return say(t('ai.noSession'));
  switch (it.kind) {
    case 'help':
      return say(t('ai.help'));
    case 'describe': {
      if (!on()) return say(t('ai.needAi'));
      const tags = await tagsOf(s!.currentId);
      return say(tags.length ? t('ai.describe', { tags: tags.join(', ') }) : t('ai.noCurrent'));
    }
    case 'greet':
      return say(t('ai.greet'));
    case 'thanks':
      return say(t('ai.welcome'));
    case 'theme':
      updatePrefs({ theme: it.theme });
      return say(t(it.theme === 'dark' ? 'ai.themeDark' : 'ai.themeLight'));
    case 'settings':
      openDialog({ type: 'settings', tab: 'ai' });
      return say(t('ai.ok'));
    case 'undo':
      undo();
      return say(t('ai.undone'));
    case 'reset':
      setOnly(null);
      setUi({ lastIds: [] });
      return say(t('ai.resetDone'));
    case 'stats': {
      const left = s!.items.filter((x) => !s!.done.has(x.id)).length;
      const st = ui().status;
      let msg = t('ai.stats', { left, sorted: s!.sorted, deleted: s!.deleted });
      if (on() && st) msg += ' ' + t('ai.statsAi', { done: st.indexed, total: st.total, learned: st.examples });
      return say(msg);
    }
    case 'dupes':
      say(t('ai.dupesStart'));
      await findDuplicates();
      return;
    case 'autosort': {
      if (!on()) return say(t('ai.needAi'), { actions: [{ label: t('ai.actEnable'), run: () => openDialog({ type: 'settings', tab: 'ai' }), primary: true }] });
      const ok = await openAutoSort();
      return say(ok ? t('ai.autosortOpen') : t('ai.needMore'));
    }
    case 'similar': {
      if (!on()) return say(t('ai.needAi'), { actions: [{ label: t('ai.actEnable'), run: () => openDialog({ type: 'settings', tab: 'ai' }), primary: true }] });
      if (s!.currentId === null) return say(t('ai.noCurrent'));
      const pool = s!.viewIds.filter((id) => s!.byId.get(id)?.kind === 'image');
      const hits = await api().ai.similar(s!.currentId, pool, 120);
      const ids = hits.filter((h, i) => i < 8 || h.score > 0.8).map((h) => h.id);
      setUi({ lastIds: ids });
      return say(ids.length ? t('ai.similarFound', { n: ids.length }) : t('ai.nothing'), { ids: ids.slice(0, 24), actions: ids.length ? resultActions(ids) : undefined });
    }
    case 'select': {
      const ids = refIds(s!, 'results');
      selectIds(ids);
      return say(t('ai.selected', { n: ids.length }));
    }
    case 'showOnly': {
      const ids = refIds(s!, 'results');
      setOnly(ids, { grid: true });
      return say(t('ai.shown', { n: ids.length }));
    }
    case 'move': {
      const tg = findTarget(activeProfile().targets, it.target);
      if (!tg) {
        return say(t('ai.noTarget', { name: it.target }), {
          actions: activeProfile().targets.slice(0, 8).map((x) => ({ label: x.name, run: () => handle({ ...it, target: x.name }) })),
        });
      }
      if (it.query || it.date || it.video) {
        const r = await find(s!, it);
        if (typeof r === 'string') return say(r);
        if (!r.length) return say(t('ai.nothing'));
        setUi({ lastIds: r });
        return say(t('ai.confirmMove', { n: r.length, name: tg.name }), {
          ids: r.slice(0, 24),
          actions: [
            { label: t('ai.yesMove', { n: r.length }), run: () => moveTo(r, tg), primary: true },
            { label: t('ai.actShow'), run: () => setOnly(r, { grid: true }) },
            { label: t('ai.no'), run: () => say(t('ai.ok')) },
          ],
        });
      }
      const ids = refIds(s!, it.ref);
      if (!ids.length) return say(t('ai.nothingRef'));
      return moveTo(ids, tg);
    }
    case 'delete': {
      if (it.query || it.date || it.video) {
        const r = await find(s!, it);
        if (typeof r === 'string') return say(r);
        if (!r.length) return say(t('ai.nothing'));
        setUi({ lastIds: r });
        return confirmDelete(r);
      }
      const ids = refIds(s!, it.ref);
      if (!ids.length) return say(t('ai.nothingRef'));
      return confirmDelete(ids);
    }
    case 'search': {
      if (!it.query && !it.date && !it.video) return say(t('ai.notUnderstood'));
      const r = await find(s!, it);
      if (typeof r === 'string')
        return say(r, { actions: [{ label: t('ai.actEnable'), run: () => openDialog({ type: 'settings', tab: 'ai' }), primary: true }] });
      setUi({ lastIds: r });
      if (!r.length) return say(t('ai.nothing'));
      const msg = it.query ? t('ai.found', { n: r.length }) : t('ai.foundDate', { n: r.length });
      return say(msg, { ids: r.slice(0, 24), actions: resultActions(r) });
    }
  }
}

/** Vorschaubild im Chat angeklickt → Foto groß zeigen */
export function openResult(id: number) {
  const s = session();
  if (!s) return;
  if (s.only && !s.only.has(id)) setOnly(null);
  goTo(id, { select: true });
  setView('single');
}

export { fmtPct };
