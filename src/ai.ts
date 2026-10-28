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
import type { AiStatus, AiTier, Target, FaceCluster } from './types';
import { itemTime } from './util';
import { parse, parseNaming, findTarget, matchesDate, resolveNamingItems, type Intent, type Ref, type DateFilter } from './chat';
import { chatPrompt, toolContinue, parseToolCall, warmPrompt, situation, describeItem, wantsPhotos, cleanAnswer, type Turn } from './assistant';
import { getLang } from './i18n';
import {
  memories, addMemory, removeMemory, clearMemories, findMemory, describeMemory, memoryForPrompt, ruleTargets, allowed, noConfirm,
  parseSetting, applySetting, settingsCatalog, settingGrammar, type Permission,
} from './aimemory';
import { createTargetFolder } from './store';
import { loadChats, saveCurrent, newChat, restore, useChats } from './chats';
import { things, addThingExample, addThingNegative, findThing, thingsOn, thingsInQuery, thingsForPrompt, thingName, saveThings } from './things';
import {
  people, facesOn, addSample, savePeople, findPerson, groupMembers, allGroups, displayName, describeFaces, cleanName, positionWord, peopleEmbs,
  facesForPrompt, peopleForPrompt, fullName,
  type FaceHit,
} from './people';

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
  /** Fotos aus einem gespeicherten Chat, die in der jetzigen Sortierung nicht vorkommen */
  paths?: string[];
  /** Gesichter (kleine Bilder mit Namen) */
  faces?: { src: string | null; label: string }[];
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
  // Chats speichern, sobald eine Antwort fertig ist; den letzten Chat (heute) wieder öffnen
  loadChats().then(() => {
    const c = useChats.getState();
    const last = c.list.find((x) => x.id === c.current);
    if (last && Date.now() - last.updated < 12 * 3_600_000 && !ui().msgs.length) openChat(last.id);
    else newChat();
  });
  useAi.subscribe((st, prev) => {
    if (!st.busy && (st.msgs !== prev.msgs || st.busy !== prev.busy)) saveCurrent(st.msgs, st.hist);
  });
  a.on('ai:status', (s: AiStatus) => {
    const before = ui().status;
    setUi({ status: s });
    if (before && before.indexed !== s.indexed) refreshSoon();
    checkHelper(s);
    // Gesichtserkennung ist (wieder) bereit → fehlende Gesichter der Sortierung suchen
    if (before && ((!before.facesReady && s.facesReady) || (!before.installed && s.installed))) syncSession();
  });
  a.on('ai:idle', () => {
    refreshSoon();
    maybeAutopilot();
  });
  a.on('ai:download', (r: { ok: boolean; error?: string }) => {
    if (r.ok) {
      toast('success', t('ai.downloaded'));
      a.ai.config(prefs().aiEnabled, prefs().aiPerf, currentTier(), prefs().aiFaces).then(syncSession);
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
    if (target && !trash) notePeopleSorted(ids, target);
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
  const p = prefs();
  // wer die KI schon an hatte (vor den Stufen), bleibt erst mal bei "Sparsam"
  return p.aiTier || (p.aiEnabled ? 'eco' : ui().status?.hw.recommended || 'eco');
}

export async function applyAiPrefs() {
  const p = prefs();
  await api().ai.config(p.aiEnabled, p.aiPerf, currentTier(), p.aiFaces);
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

/** Veraltetes Helfer-Programm (z. B. ohne Gesichtserkennung) → einmal von selbst neu laden */
let helperUpdateTried = false;
function checkHelper(s: AiStatus | null) {
  if (!s || !s.helperOld || s.downloading || helperUpdateTried || !prefs().aiEnabled) return;
  helperUpdateTried = true;
  api().log('ki: Helfer-Programm veraltet → wird neu geladen');
  startDownload();
}

/** Warum gibt es (noch) keine Gesichter für ein Foto? */
function whyNoFaces(): string {
  const st = ui().status;
  if (st?.helperOld && st.error && !st.downloading) return t('faces.error', { error: st.error });
  if (st?.helperOld || st?.downloading) return t('faces.updating');
  if (st?.faceError) return t('faces.error', { error: st.faceError });
  if (st && st.facesPending > 0) return t('people.notYetN', { n: st.facesPending });
  return t('faces.notPossible');
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

/** Gelernte Vorschläge + gemerkte Regeln ("Autos → Autos", "Familie → Familie"); Regeln haben Vorrang */
async function suggestWithRules(ids: number[]): Promise<{ id: number; target: string; conf: number; why?: string }[]> {
  const [res, rules] = await Promise.all([api().ai.suggest(ids, targetsWithTrash()), memories().length ? ruleTargets(ids) : Promise.resolve(new Map())]);
  const out = new Map<number, { id: number; target: string; conf: number; why?: string }>(res.map((r) => [r.id, r]));
  for (const [id, r] of rules) out.set(id, { id, target: r.path, conf: r.conf, why: r.memory.label || r.memory.concept || r.memory.text });
  return [...out.values()];
}

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
  const res = await suggestWithRules(todo);
  const cur = session();
  if (cur !== s && cur?.items !== s.items) return;
  let changed = false;
  for (const r of res) {
    const tid = targetIdOf(r.target);
    if (!tid) continue;
    s.aiSugg.set(r.id, { targetId: tid, conf: r.conf, why: r.why });
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
  const res = await suggestWithRules(ids);
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
  if (autopilotDone || !p.aiAutopilot || !p.aiAllowMove || !on() || !session()) return;
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
  asking = null;
  newChat();
  setUi({ msgs: [], lastIds: [], hist: [] });
  say(t(llmOn() ? 'ai.chatHelloLlm' : 'ai.chatHello'));
}

/** Gespeicherten Chat wieder öffnen */
export function openChat(id: string) {
  const c = useChats.getState().list.find((x) => x.id === id);
  if (!c) return;
  stopLlm();
  asking = null;
  setUi({ msgs: restore(c, () => ++msgId), hist: c.hist || [], lastIds: [] });
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
  const cut = cutHits(hits);
  // "ein Foto" → nur die besten paar zeigen
  if (q.count && q.count > 0) return cut.slice(0, Math.max(q.count, 4)).map((h) => h.id);
  return cut.map((h) => h.id);
}

/**
 * Welche Treffer zeigen? Die Werte (Ähnlichkeit × Faktor des Modells) liegen eng beieinander,
 * deshalb zählt der Abstand: deutlich über dem Durchschnitt, nah am besten Treffer,
 * und Schluss bei einer klaren Lücke. Mindestens 1, höchstens 120.
 */
export function cutHits<T extends { score: number }>(hits: T[]): T[] {
  if (hits.length <= 1) return hits;
  const xs = hits.map((h) => h.score);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  const thr = Math.max(xs[0] - 3, mean + 0.5 * sd);
  const out: T[] = [];
  for (let i = 0; i < hits.length && out.length < 120; i++) {
    if (i >= 1 && (xs[i] < thr || xs[i - 1] - xs[i] > 1.5)) break;
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

/** Darf die KI das? Sonst Hinweis mit Knopf zu den Einstellungen */
function permitted(p: Permission): boolean {
  if (allowed(p)) return true;
  say(t('perm.denied', { what: t(`perm.${p === 'aiAllowMove' ? 'move' : p === 'aiAllowDelete' ? 'delete' : p === 'aiAllowSettings' ? 'settings' : 'folders'}` as any) }), {
    actions: [{ label: t('perm.open'), run: () => openDialog({ type: 'settings', tab: 'ai' }), primary: true }],
  });
  return false;
}

function confirmDelete(ids: number[]) {
  if (!permitted('aiAllowDelete')) return;
  if (noConfirm()) {
    trashIds(ids);
    return say(t('ai.deleted', { n: ids.length }), { actions: [{ label: t('ai.undo'), run: () => (undo(), say(t('ai.undone'))) }] });
  }
  say(t('ai.confirmDelete', { n: ids.length }), {
    ids: ids.slice(0, 12),
    actions: [
      { label: t('ai.yesDelete', { n: ids.length }), run: () => (trashIds(ids), say(t('ai.deleted', { n: ids.length }))), danger: true },
      { label: t('ai.no'), run: () => say(t('ai.ok')) },
    ],
  });
}

function moveTo(ids: number[], tg: Target) {
  if (!permitted('aiAllowMove')) return;
  sortIdsToTarget(ids, tg.id);
  say(t('ai.moved', { n: ids.length, name: tg.name }), { actions: [{ label: t('ai.undo'), run: () => (undo(), say(t('ai.undone'))) }] });
  setUi({ lastIds: [] });
}

/** Sprachmodell nutzbar? (Stufe mit Chat, installiert, Prozessor passt) */
export function llmOn(): boolean {
  const st = ui().status;
  return !!st && prefs().aiEnabled && currentTier() !== 'eco' && st.chat && st.hw.chatOk;
}

/** Nachricht senden; `forced`: Befehl steht schon fest (Vorschlags-Knöpfe, in jeder Sprache) */
export async function send(text: string, forced?: Intent) {
  text = text.trim();
  if (!text || ui().busy) return;
  setUi({ msgs: [...ui().msgs, { id: ++msgId, from: 'me', text }], busy: true, busyText: '' });
  try {
    if (forced) return await handle(forced);
    const intent = parse(text);
    // Antwort auf "Wer ist das?"
    if (asking && (intent.kind === 'search' || intent.kind === 'name' || intent.kind === 'greet') && (await answerAsk(text))) return;
    // Klare Befehle direkt ausführen; Fragen, Gespräch und Suchen übernimmt das Sprachmodell
    // "Fotos mit Mama" → Gesichtserkennung (sicher), nicht das Sprachmodell
    if (intent.kind === 'search' && intent.query && session() && (await findPeoplePhotos(session()!, intent.query))) return;
    if (intent.kind === 'search' && intent.query && session() && (await findThingPhotos(session()!, intent.query))) return;
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

  // Lage: aktuelles Foto, Gesichter (echte Erkennung), bekannte Personen, Gedächtnis
  let facesText: string | undefined;
  if (s && s.currentId !== null && prefs().aiFaces && ui().status?.facesReady) {
    const f = (await facesOn([s.currentId])).get(s.currentId);
    if (f) facesText = facesForPrompt(f);
  }
  let thingsText = thingsForPrompt();
  if (s && s.currentId !== null && things().length) thingsText = thingsForPrompt((await thingsOn([s.currentId], imagePool(s))).get(s.currentId) || []);
  const lage = situation(s, await tagsOf(s?.currentId), { faces: facesText, people: [peopleForPrompt(), thingsText].filter(Boolean).join('\n'), memory: memoryForPrompt() });
  let prompt = chatPrompt(ui().hist.slice(-4), text, lage, think);

  const mid = ++msgId;
  const extra: Partial<ChatMsg> = {};
  const update = (m: Partial<ChatMsg>) => setUi({ msgs: ui().msgs.map((x) => (x.id === mid ? { ...x, ...m } : x)) });
  setUi({ msgs: [...ui().msgs, { id: mid, from: 'ai', text: '', streaming: true }] });

  // Eindeutige Fotosuche macht SlimSort selbst (zuverlässig) – als wäre es ein Werkzeug-Aufruf des Modells
  // Fragen ("Hast du …", "Weißt du …") und Merk-Sätze sind keine Fotosuche
  const notSearch = /\b(\w*merk\w*|notier\w*|speicher\w*|vergiss|vergessen|sollen|soll|immer|gehören|warum|wieso|erklär\w*)\b/i.test(text) || /^(hast|hat|habt|weißt|kennst|kannst|ist|sind|bist|gibt)\b/i.test(text.trim());
  if (s && intent.kind === 'search' && (intent.query || intent.date || intent.video) && wantsPhotos(text) && !notSearch && !peopleInQuery(intent.query || '')) {
    const call = `<tool_call>\n${JSON.stringify({ name: 'fotos_suchen', arguments: { beschreibung: intent.query || text } })}`;
    const out = await runTool('fotos_suchen', { beschreibung: intent.query || text, _intent: intent, _text: text });
    Object.assign(extra, { ids: out.ids, faces: out.faces, actions: out.actions });
    update(extra);
    prompt = toolContinue(prompt, call, out.text, think);
  }

  let answer = '';
  let byTool = false;
  let toolsUsed = !!extra.ids;
  try {
    for (let round = 0; round < 3; round++) {
      const id = ++llmSeq;
      setUi({ llmId: id, busyText: ui().status?.chatRunning ? '' : t('ai.llmLoading') });
      update({ llmId: id, text: '', streaming: true });
      const r = await api().ai.chat(id, { prompt, max: 300, temp: currentTier() === 'balanced' ? 0.15 : 0.3, stop: ['<|im_end|>', '</tool_call>', '</tool>'] });
      if (r.cancelled) {
        answer = cleanAnswer(r.text).trim();
        break;
      }
      const call = parseToolCall(r.text);
      if (!call) {
        answer = cleanAnswer(r.text).trim();
        break;
      }
      setUi({ busyText: t('ai.working') });
      api().log(`llm-tool ${call.name} ${JSON.stringify(call.args).slice(0, 200)}`);
      const out = await runTool(call.name, call.args, text);
      if (!out.text.startsWith('Nicht ausgeführt')) toolsUsed = true;
      if (out.done) {
        // Das Werkzeug hat selbst geantwortet (z. B. „Gemerkt: …“) – keine zweite Antwort nötig
        byTool = true;
        answer = out.text;
        break;
      }
      if (out.ids || out.faces || out.actions) {
        Object.assign(extra, { ids: out.ids ?? extra.ids, faces: out.faces ?? extra.faces, actions: out.actions ?? extra.actions });
        update(extra);
      }
      prompt = toolContinue(prompt, r.text, out.text, think);
    }
  } finally {
    const fallback = extra.ids?.length ? t('ai.found', { n: extra.ids.length }) : t('ai.ok');
    if (byTool) {
      // leere Antwortblase entfernen, das Werkzeug hat seine eigene Nachricht geschrieben
      setUi({ msgs: ui().msgs.filter((m) => m.id !== mid) });
    } else {
      answer = answer || cleanAnswer(ui().msgs.find((m) => m.id === mid)?.text || '').trim() || fallback;
      // Behauptet das Modell eine Handlung, die kein Werkzeug ausgeführt hat? → ehrlich sagen
      if (!toolsUsed && CLAIM.test(answer) && REQUEST.test(text) && !/^(hast|hat|weißt|kennst|was|wer|wie|wo|warum)\b/i.test(text.trim())) {
        api().log(`llm: Behauptung ohne Aktion: ${answer.slice(0, 120)}`);
        answer += '\n\n' + t('ai.claimWarning');
        extra.actions = [...(extra.actions || []), { label: t('people.manage'), run: () => openDialog({ type: 'people' }) }, { label: t('mem.title'), run: () => openDialog({ type: 'settings', tab: 'ai' }) }];
      }
      update({ text: answer, streaming: false, llmId: undefined, ...extra });
    }
    setUi({ hist: [...ui().hist, { user: text, assistant: answer || t('ai.ok') }].slice(-8), busyText: '' });
  }
}

/** Sätze, mit denen das Modell behauptet, etwas getan zu haben */
const CLAIM = /\b(gespeichert|gemerkt|zugeordnet|abgespeichert|benannt|verschoben|gelöscht|angelegt|geändert|eingestellt|verknüpft|saved|remembered|moved|deleted)\b/i;

/** Der Nutzer wollte, dass etwas passiert (nicht nur eine Frage) */
const REQUEST = /\b(merk\w*|speicher\w*|notier\w*|ist (mein|meine|unser|unsere)|bin ich|ich bin|sind (meine|unsere)|verschieb\w*|lösch\w*|benenn\w*|zuordn\w*|anlegen|stell\w*|schalt\w*)\b/i;

interface ToolOut {
  /** Ergebnis für das Sprachmodell */
  text: string;
  ids?: number[];
  faces?: ChatMsg['faces'];
  actions?: ChatAction[];
  /** Werkzeug hat dem Nutzer schon selbst geantwortet */
  done?: boolean;
}

const REF_OF: Record<string, Ref> = { aktuelles: 'current', markierte: 'selection', gefundene: 'results' };

/** Werkzeug des Sprachmodells ausführen */
async function runTool(name: string, a: Record<string, any>, userText = ''): Promise<ToolOut> {
  const s = session();
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  // Handlungen: vorhandene Befehle ausführen, die antworten selbst
  const act = async (fn: () => Promise<unknown> | unknown): Promise<ToolOut> => {
    const before = ui().msgs.length;
    await fn();
    const said = ui().msgs.slice(before).filter((m) => m.from === 'ai').map((m) => m.text).join(' ');
    return { text: said || 'erledigt', done: true };
  };
  if (!s && !['merken', 'vergessen', 'einstellung_aendern'].includes(name)) return { text: 'Es ist keine Sortierung geöffnet.' };
  switch (name) {
    case 'fotos_suchen': {
      const q = str(a.beschreibung);
      if (!q) return { text: 'Keine Beschreibung angegeben.' };
      if (peopleInQuery(q)) return runTool('fotos_mit_personen', { namen: [q] });
      const it = a._intent as Extract<Intent, { kind: 'search' }> | undefined;
      const one = /\b(ein|eine|einen|einem|a|an|one|un|une|uno|una)\s+(foto|bild|photo|picture|image)\b/i.test(a._text || '');
      const r = await find(s!, { query: it?.query ?? q, date: it?.date, video: it?.video, count: one ? 1 : 0 });
      if (typeof r === 'string') return { text: r };
      if (!r.length) return { text: `Keine passenden Fotos zu „${q}“ gefunden.` };
      setUi({ lastIds: r });
      const best = s!.byId.get(r[0])!;
      return { text: `Gezeigt: ${r.length} passende Fotos (als Vorschaubilder unter deiner Antwort). Bestes: ${describeItem(best, await tagsOf(best.id))}.`, ids: r.slice(0, 24), actions: resultActions(r) };
    }
    case 'fotos_mit_personen': {
      const names: string[] = Array.isArray(a.namen) ? a.namen.map(String) : [str(a.namen)].filter(Boolean);
      const r = (await peoplePhotos(s!, names.join(' und '))) || (await thingPhotos(s!, names.join(' und ')));
      if (!r) return { text: `Diese Personen kenne ich nicht: ${names.join(', ')}. Bekannt: ${people().map((p) => p.name).join(', ') || 'noch niemand'}.` };
      setUi({ lastIds: r.ids });
      return r.ids.length
        ? { text: `Gezeigt: ${r.ids.length} Fotos mit ${r.names} (als Vorschaubilder unter deiner Antwort).`, ids: r.ids.slice(0, 24), actions: resultActions(r.ids) }
        : { text: `Keine Fotos mit ${r.names} gefunden.` };
    }
    case 'personen_auf_foto': {
      if (!prefs().aiFaces || !ui().status?.facesReady) return { text: 'Die Gesichtserkennung ist ausgeschaltet. Sie lässt sich unter Einstellungen → KI einschalten.' };
      if (s!.currentId === null) return { text: 'Kein Foto ausgewählt.' };
      const f = await facesAt(s!.currentId);
      if (!f) return { text: whyNoFaces() };
      return { text: facesForPrompt(f) + (people().length ? '' : ' Es sind noch keine Personen bekannt.'), faces: await crops(s!, s!.currentId, f, (x, i) => (x.person ? displayName(x.person) : positionWord(i, f.length) || '?')) };
    }
    case 'personen_benennen': {
      // nur wenn der Nutzer wirklich Namen nennt (kleine Modelle verwechseln Fragen mit Aufträgen)
      if (userText && !parseNaming(userText) && !/\b(heißt|heisst|ist (mein|meine|unser|unsere)|bin ich|das bin|sind (meine|unsere)|is my|named)\b/i.test(userText))
        return { text: 'Nicht ausgeführt: Dein Gegenüber hat niemanden benannt. Um zu sehen, wer auf dem Foto ist, benutze personen_auf_foto.' };
      const z: { gesicht: number; name: string }[] = Array.isArray(a.zuordnung) ? a.zuordnung : [];
      const items = z.filter((x) => x && x.name && Number(x.gesicht) >= 1).map((x) => ({ pos: { from: 'left' as const, n: Number(x.gesicht) - 1 }, name: String(x.name) }));
      if (!items.length) return { text: 'Keine Zuordnung angegeben.' };
      return act(() => nameFaces({ kind: 'name', items, ref: 'current' }));
    }
    case 'merken': {
      if (userText && !/\b(merk\w*|notier\w*|speicher\w*|vergiss nicht|immer|sollen|soll|gehören|gehört|kommen|kommt|remember)\b/i.test(userText))
        return { text: 'Nicht ausgeführt: Du sollst dir hier nichts merken. Beantworte die Frage mit dem, was in <lage> steht.' };
      const text = str(a.text);
      if (!text) return { text: 'Nichts zum Merken angegeben.' };
      const it = parse(`merke dir ${text}`);
      return act(() => handle(it.kind === 'remember' || it.kind === 'name' ? it : { kind: 'remember', text }));
    }
    case 'vergessen':
      return act(() => handle({ kind: 'forget', text: str(a.was) }));
    case 'verschieben':
      return act(() => handle({ kind: 'move', target: str(a.ordner), ref: REF_OF[str(a.welche)] || 'current' }));
    case 'loeschen':
      return act(() => handle({ kind: 'delete', ref: REF_OF[str(a.welche)] || 'current' }));
    case 'einstellung_aendern':
      return act(() => changeSetting(str(a.wunsch)));
    case 'ordner_anlegen':
      return act(() => makeFolder(str(a.name)));
    case 'aehnliche_fotos':
      return act(() => handle({ kind: 'similar' }));
    case 'automatisch_sortieren':
      return act(() => handle({ kind: 'autosort' }));
    default:
      return { text: `Unbekanntes Werkzeug ${name}.` };
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
        if (!permitted('aiAllowMove')) return;
        if (noConfirm()) return moveTo(r, tg);
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
    case 'remember':
      return remember(it);
    case 'forget': {
      if (it.all) {
        if (!memories().length) return say(t('mem.empty'));
        return say(t('mem.forgetAllAsk', { n: memories().length }), {
          actions: [
            { label: t('mem.forgetAllYes'), run: () => (clearMemories(), refreshRules(), say(t('mem.forgotAll'))), danger: true },
            { label: t('ai.no'), run: () => say(t('ai.ok')) },
          ],
        });
      }
      const m = it.text ? findMemory(it.text) : lastMemory();
      if (!m) return listMemories(t('mem.notFound'));
      removeMemory(m.id);
      refreshRules();
      return say(t('mem.forgot', { what: describeMemory(m) }), { actions: [{ label: t('ai.undo'), run: () => (addMemoryBack(m), say(t('ai.undone'))) }] });
    }
    case 'memories':
      return listMemories();
    case 'name':
      return nameFaces(it);
    case 'whois':
      return whoIs(it.ref);
    case 'people':
      openDialog({ type: 'people' });
      return say(t('people.opened', { n: people().length }));
    case 'unknownFaces':
      return askUnknown();
    case 'thing':
      return learnThing(it);
    case 'setting':
      return changeSetting(it.text);
    case 'mkfolder':
      return makeFolder(it.name);
    case 'search': {
      if (!it.query && !it.date && !it.video) return say(t('ai.notUnderstood'));
      if (it.query && (await findPeoplePhotos(s!, it.query))) return;
      if (it.query && (await findThingPhotos(s!, it.query))) return;
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

// ---------------------------------------------------------------- Personen

/** Wer wohin sortiert wurde: Person → Zielordner → Anzahl (für den Vorschlag "soll ich mir das merken?") */
const sortedBy = new Map<string, Map<string, number>>();
const asked = new Set<string>();

async function notePeopleSorted(ids: number[], target: Target) {
  if (!prefs().aiFaces || !people().length) return;
  const faces = await facesOn(ids);
  for (const f of faces.values()) {
    for (const pid of new Set(f.map((x) => x.person?.id).filter((x): x is string => !!x))) {
      const m = sortedBy.get(pid) || new Map<string, number>();
      m.set(target.path, (m.get(target.path) || 0) + 1);
      sortedBy.set(pid, m);
      const total = [...m.values()].reduce((a, b) => a + b, 0);
      const here = m.get(target.path)!;
      const key = `${pid}>${target.path}`;
      // oft und fast immer in denselben Ordner → einmal fragen
      if (here >= 5 && here / total >= 0.85 && !asked.has(key)) {
        const has = memories().some((x) => x.kind === 'people' && x.targetPath === target.path && x.personIds?.includes(pid));
        const person = people().find((p) => p.id === pid);
        asked.add(key);
        if (has || !person) continue;
        const who = displayName(person);
        toast('info', t('people.ruleAsk', { name: who, folder: target.name, n: here }), {
          timeout: 15000,
          action: {
            label: t('people.ruleYes'),
            run: () => {
              addMemory({ kind: 'people', text: `${person.name} → ${target.name}`, label: who, personIds: [pid], targetPath: target.path });
              refreshRules();
              toast('success', t('mem.rememberedPeople', { who, folder: target.name }));
            },
          },
        });
      }
    }
  }
}

function facesReady(): boolean {
  if (prefs().aiFaces && ui().status?.facesReady) return true;
  say(t('faces.needOn'), { actions: [{ label: t('faces.enable'), run: () => openDialog({ type: 'settings', tab: 'ai' }), primary: true }] });
  return false;
}

/** Gesichter eines Fotos (wartet kurz, falls es gerade erst untersucht wird) */
async function facesAt(id: number): Promise<FaceHit[] | null> {
  api().ai.prioritize([id]);
  for (let i = 0; i < 40; i++) {
    const f = (await facesOn([id], true)).get(id);
    if (f) return f;
    const st = ui().status;
    // nichts mehr in Arbeit (Fehler, veraltet, nicht lesbar) → nicht weiter warten
    if (i > 2 && st && (st.faceError || st.helperOld || st.facesPending === 0)) return null;
    if (i === 0) setUi({ busyText: t('people.looking') });
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

async function crops(s: SessionState, id: number, faces: FaceHit[], label: (f: FaceHit, i: number) => string) {
  const it = s.byId.get(id);
  return Promise.all(faces.map(async (f, i) => ({ src: it ? await api().ai.faceCrop(it.path, f.box).catch(() => null) : null, label: label(f, i) })));
}

/** "ich bin links, mein Bruder daneben, meine Mutter rechts" → jedes Gesicht seiner Person zuordnen */
async function nameFaces(it: Extract<Intent, { kind: 'name' }>) {
  if (!facesReady()) return;
  const s = session()!;
  const id = it.ref === 'selection' ? [...s.selection][0] ?? s.currentId : s.currentId;
  if (id === null || id === undefined) return say(t('ai.noCurrent'));
  // mehrere markierte Fotos mit je einem Gesicht: "das ist Mama" für alle
  if (it.ref === 'selection' && s.selection.size > 1 && it.items.length === 1) {
    const all = await facesOn([...s.selection], true);
    const before = people();
    let n = 0;
    for (const [pid, f] of all) {
      if (f.length !== 1 || !f[0].emb) continue;
      const crop = n === 0 ? await api().ai.faceCrop(s.byId.get(pid)!.path, f[0].box).catch(() => null) : null;
      addSample(it.items[0].name, f[0].emb, crop, it.group, { role: it.items[0].role, real: it.items[0].real, me: it.items[0].me });
      n++;
    }
    refreshRules();
    if (!n) return say(t('people.noSingle'));
    return say(t('people.namedMany', { n, name: cleanName(it.items[0].name) }), { actions: [undoPeople(before)] });
  }
  const faces = await facesAt(id);
  if (!faces) return say(whyNoFaces());
  if (!faces.length) return say(t('faces.noneFound'));
  const names = resolveNamingItems(it.items, faces.length);
  if (!names) {
    // Positionen passen nicht zur Anzahl → zeigen, welche Gesichter es gibt
    return say(t('people.unclear', { n: faces.length }), {
      faces: await crops(s, id, faces, (_, i) => positionWord(i, faces.length) || '1'),
      actions: [{ label: t('people.showFaces'), run: () => (updatePrefs({ showFaces: true }), setView('single')) }],
    });
  }
  const before = people();
  const done: { f: FaceHit; name: string }[] = [];
  for (let i = 0; i < faces.length; i++) {
    const item = names[i];
    const f = faces[i];
    if (!item || !f.emb) continue;
    const crop = await api().ai.faceCrop(s.byId.get(id)!.path, f.box).catch(() => null);
    addSample(item.name, f.emb, crop, it.group, { role: item.role, real: item.real, me: item.me });
    done.push({ f, name: item.name });
  }
  refreshRules();
  const after = await facesAt(id);
  const list = (after || faces).map((f, i) => (f.person ? `${positionWord(i, faces.length) || ''} ${fullName(f.person)}`.trim() : null)).filter(Boolean);
  return say(t('people.named', { list: list.join(', ') }), {
    faces: await crops(s, id, after || faces, (f) => (f.person ? displayName(f.person) : '?')),
    actions: [undoPeople(before), { label: t('people.manage'), run: () => openDialog({ type: 'people' }) }],
  });
}

function undoPeople(before: ReturnType<typeof people>): ChatAction {
  return { label: t('ai.undo'), run: () => (savePeople(before), refreshRules(), say(t('ai.undone'))) };
}

/** "Wer ist auf dem Foto?" – echte Gesichtserkennung, nicht geraten */
async function whoIs(ref: Ref) {
  if (!facesReady()) return;
  const s = session()!;
  const id = ref === 'selection' ? [...s.selection][0] ?? s.currentId : s.currentId;
  if (id === null || id === undefined) return say(t('ai.noCurrent'));
  const faces = await facesAt(id);
  if (!faces) return say(whyNoFaces());
  if (!faces.length) return say(t('faces.noneFound'));
  const known = faces.filter((f) => f.person).length;
  const maybe = faces.find((f) => !f.person && f.maybe);
  const text =
    !people().length
      ? t('people.noneKnown', { n: faces.length })
      : known === faces.length
        ? t('people.allKnown', { list: describeFaces(faces) })
        : t('people.someKnown', { list: describeFaces(faces), n: faces.length - known });
  const actions: ChatAction[] = [];
  if (maybe?.emb && maybe.maybe) {
    const m = maybe.maybe;
    actions.push({
      label: t('face.yesItIs', { name: displayName(m) }),
      primary: true,
      run: async () => {
        addSample(m.me ? 'ich' : m.name, maybe.emb!, null);
        refreshRules();
        say(t('people.learned', { name: displayName(m) }));
      },
    });
  }
  if (known < faces.length) actions.push({ label: t('people.showFaces'), run: () => (updatePrefs({ showFaces: true }), setView('single')) });
  return say(text, { faces: await crops(s, id, faces, (f, i) => (f.person ? displayName(f.person) : f.maybe ? `${displayName(f.maybe)}?` : positionWord(i, faces.length) || '?')), actions });
}

/** Nachfrage "Wer ist das?" für Gesichter, die oft vorkommen – Antwort kommt als nächste Nachricht */
let asking: { clusters: FaceCluster[]; i: number } | null = null;

async function askUnknown() {
  if (!facesReady()) return;
  const s = session()!;
  const ids = s.items.filter((x) => x.kind === 'image').map((x) => x.id);
  const clusters = await api().ai.faceClusters(ids, peopleEmbs(), 2).catch(() => []);
  if (!clusters.length) return say(t('people.noUnknown'));
  asking = { clusters, i: 0 };
  return askNext(t('people.unknownIntro', { n: clusters.length }));
}

async function askNext(intro = '') {
  const s = session();
  if (!asking || !s) return;
  const c = asking.clusters[asking.i];
  if (!c) {
    asking = null;
    return say(t('people.askDone'), { actions: [{ label: t('people.manage'), run: () => openDialog({ type: 'people' }) }] });
  }
  const first = c.members.slice(0, 3);
  const faces = await Promise.all(first.map(async (m) => ({ src: await api().ai.faceCrop(s.byId.get(m.id)?.path || '', m.box).catch(() => null), label: '' })));
  say((intro ? intro + '\n' : '') + t('people.askWho', { n: c.members.length }), {
    faces,
    actions: [
      { label: t('people.skip'), run: () => (asking && asking.i++, askNext()) },
      { label: t('people.stopAsking'), run: () => ((asking = null), say(t('ai.ok'))) },
    ],
  });
}

/** Antwort auf "Wer ist das?" */
async function answerAsk(text: string): Promise<boolean> {
  if (!asking) return false;
  const s = session();
  const c = asking.clusters[asking.i];
  if (!s || !c) return false;
  if (/^(später|stop+|abbrechen|nein|fertig|genug|aufhören|later|cancel)\b/i.test(text.trim())) {
    asking = null;
    say(t('ai.ok'));
    return true;
  }
  if (/^(weiß nicht|keine ahnung|überspring\w*|skip|weiter|egal|niemand|kenn ich nicht)\b/i.test(text.trim())) {
    asking.i++;
    await askNext();
    return true;
  }
  const name = cleanName(text.replace(/^(das ist|das bin|das sind|ist|sind)\s+/i, ''));
  if (!name || name.split(' ').length > 3) return false;
  const crop = await api().ai.faceCrop(s.byId.get(c.members[0].id)?.path || '', c.members[0].box).catch(() => null);
  c.samples.forEach((e, i) => addSample(name, e, i === 0 ? crop : null));
  refreshRules();
  say(t('people.learnedMany', { name: name === 'Ich' ? t('people.me') : name, n: c.members.length }));
  asking.i++;
  await askNext();
  return true;
}

/** "Fotos mit Mama", "wo bin ich drauf", "Fotos von meiner Familie" */
function peopleInQuery(q: string): { persons: ReturnType<typeof people>; any: boolean } | null {
  const list = people();
  if (!list.length) return null;
  const parts = q
    .replace(/^(wo|auf welchen)\s+(bin|ist|sind)\s+/i, '')
    .replace(/\s+(drauf|darauf|zu sehen)$/i, '')
    .split(/\s*(?:,|\bund\b|\bmit\b|\boder\b|&)\s*/i)
    .map((x) => x.replace(/^(?:fotos?|bilder?|alle|von|vom|mit)\s+/gi, '').trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const persons: ReturnType<typeof people> = [];
  for (const part of parts) {
    const p = findPerson(part, list);
    if (p) {
      persons.push(p);
      continue;
    }
    const g = allGroups(list).find((x) => cleanName(part).toLowerCase() === x.toLowerCase());
    if (!g) return null;
    return { persons: groupMembers(g, list), any: true };
  }
  return { persons, any: /\boder\b/i.test(q) };
}

async function peoplePhotos(s: SessionState, query: string): Promise<{ ids: number[]; names: string } | null> {
  const m = peopleInQuery(query);
  if (!m || !m.persons.length || !prefs().aiFaces) return null;
  const pool = s.items.filter((x) => x.kind === 'image' && !s.done.has(x.id)).map((x) => x.id);
  const faces = await facesOn(pool);
  const want = new Set(m.persons.map((p) => p.id));
  const ids = pool.filter((id) => {
    const on = new Set((faces.get(id) || []).map((f) => f.person?.id).filter(Boolean));
    return m.any ? [...want].some((p) => on.has(p)) : [...want].every((p) => on.has(p));
  });
  return { ids, names: m.persons.map(displayName).join(m.any ? ` ${t('people.or')} ` : ` ${t('people.and')} `) };
}

async function findPeoplePhotos(s: SessionState, query: string): Promise<boolean> {
  const r = await peoplePhotos(s, query);
  if (!r) return false;
  setUi({ lastIds: r.ids });
  if (!r.ids.length) say(t('people.foundNone', { names: r.names }));
  else say(t('people.found', { n: r.ids.length, names: r.names }), { ids: r.ids.slice(0, 24), actions: resultActions(r.ids) });
  return true;
}

// ---------------------------------------------------------------- Dinge

/** Alle Fotos der Sortierung (zum Einschätzen, wie ähnlich "ähnlich genug" ist) */
function imagePool(s: SessionState): number[] {
  return s.items.filter((x) => x.kind === 'image').map((x) => x.id);
}

/** "Das ist mein Auto" → aktuelles (oder markierte) Foto als Beispiel */
async function learnThing(it: Extract<Intent, { kind: 'thing' }>) {
  if (!on()) return say(t('ai.needAi'), { actions: [{ label: t('ai.actEnable'), run: () => openDialog({ type: 'settings', tab: 'ai' }), primary: true }] });
  const s = session()!;
  const ids = it.ref === 'selection' && s.selection.size ? [...s.selection] : s.currentId !== null ? [s.currentId] : [];
  if (!ids.length) return say(t('ai.noCurrent'));
  if (it.not) {
    const th = findThing(it.name);
    if (!th) return say(t('things.unknown', { name: thingName(it.name) }));
    for (const id of ids) await addThingNegative(th.id, s.byId.get(id)!.path);
    refreshRules();
    return say(t('things.notLearned', { name: th.name }));
  }
  const before = things();
  setUi({ busyText: t('things.learning') });
  let th;
  for (const id of ids) th = await addThingExample(it.name, s.byId.get(id)!.path);
  refreshRules();
  const n = th!.examples.length;
  return say(t(n < 3 ? 'things.learnedFew' : 'things.learned', { name: th!.name, n }), {
    actions: [
      { label: t('ai.undo'), run: () => (saveThings(before), refreshRules(), say(t('ai.undone'))) },
      { label: t('things.findMore'), run: () => findThingPhotos(session()!, th!.name) },
      { label: t('things.mark'), run: () => (setView('single'), window.dispatchEvent(new Event('fs-mark'))) },
    ],
  });
}

async function thingPhotos(s: SessionState, query: string): Promise<{ ids: number[]; names: string } | null> {
  const list = thingsInQuery(query);
  if (!list || !list.length) return null;
  const pool = imagePool(s).filter((id) => !s.done.has(id));
  const hits = await thingsOn(pool, imagePool(s));
  const want = new Set(list.map((x) => x.id));
  const ids = pool
    .filter((id) => {
      const on = new Set((hits.get(id) || []).map((h) => h.thing.id));
      return [...want].every((x) => on.has(x));
    })
    .sort((a, b) => (hits.get(b)?.[0]?.p || 0) - (hits.get(a)?.[0]?.p || 0));
  return { ids, names: list.map((x) => x.name).join(` ${t('people.and')} `) };
}

async function findThingPhotos(s: SessionState, query: string): Promise<boolean> {
  const r = await thingPhotos(s, query);
  if (!r) return false;
  setUi({ lastIds: r.ids });
  if (!r.ids.length) say(t('people.foundNone', { names: r.names }));
  else say(t('things.found', { n: r.ids.length, names: r.names }), { ids: r.ids.slice(0, 24), actions: resultActions(r.ids) });
  return true;
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

// ---------------------------------------------------------------- Gedächtnis, Einstellungen, Ordner

let lastMemId: string | null = null;
function lastMemory() {
  const list = memories();
  return list.find((m) => m.id === lastMemId) || list[list.length - 1];
}
function addMemoryBack(m: ReturnType<typeof memories>[number]) {
  const n = addMemory({ ...m });
  lastMemId = n.id;
  refreshRules();
}

/** Nach Änderungen am Gedächtnis: Vorschläge neu berechnen */
export function refreshRules() {
  const s = session();
  if (s) {
    s.aiSugg.clear();
    touchSession();
    refreshSoon();
  }
}

function listMemories(intro?: string) {
  const list = memories();
  if (!list.length) return say(intro ? `${intro} ${t('mem.empty')}` : t('mem.empty'));
  say((intro ? intro + '\n' : '') + t('mem.list') + '\n' + list.map((m, i) => `${i + 1}. ${describeMemory(m)}`).join('\n'), {
    actions: list.slice(0, 8).map((m, i) => ({ label: t('mem.forgetN', { n: i + 1 }), run: () => (removeMemory(m.id), refreshRules(), say(t('mem.forgot', { what: describeMemory(m) }))) })),
  });
}

const TPL_Q: Record<string, string> = { de: 'ein Foto von {q}', en: 'a photo of {q}', fr: 'une photo de {q}', es: 'una foto de {q}', it: 'una foto di {q}' };

async function remember(it: Extract<Intent, { kind: 'remember' }>) {
  const s = session();
  const targets = activeProfile().targets;
  // Personen auf dem aktuellen/markierten Foto
  if (it.faces) {
    if (!prefs().aiFaces || !ui().status?.facesReady) {
      return say(t('faces.needOn'), { actions: [{ label: t('faces.enable'), run: () => openDialog({ type: 'settings', tab: 'ai' }), primary: true }] });
    }
    if (!s) return say(t('ai.noSession'));
    const ids = refIds(s, it.faces.ref);
    const embs = await api().ai.faceEmbs(ids);
    if (!embs.length) return say(t('faces.noneFound'));
    const tg = findTarget(targets, it.faces.folder || it.faces.label);
    // bekannte Personen auf dem Foto bekommen die Gruppe ("Familie") dazu
    const known = await facesOn(ids, true);
    for (const f of [...known.values()].flat()) {
      if (f.person && f.emb) addSample(f.person.me ? 'ich' : f.person.name, f.emb, null, it.faces.label);
    }
    const m = addMemory({ kind: 'faces', text: it.text, label: it.faces.label, faces: embs.map((e) => e.map((x) => Math.round(x * 1e4) / 1e4)), targetPath: tg?.path });
    lastMemId = m.id;
    refreshRules();
    return say(t(tg ? 'faces.rememberedFolder' : 'faces.remembered', { n: embs.length, label: it.faces.label, folder: tg?.name || '' }), {
      actions: [{ label: t('ai.undo'), run: () => (removeMemory(m.id), refreshRules(), say(t('ai.undone'))) }],
    });
  }
  // Regel mit Ordner
  let concept = it.concept;
  let folder = it.folder;
  let query: string | undefined;
  if (!concept && llmOn()) {
    // Sprachmodell zerlegt freie Sätze ("Katzenbilder gehören zu Haustiere")
    const r = await llmJson(
      `Zerlege diesen Satz des Nutzers. Ist es eine Regel, welche Fotos in welchen Ordner sollen? Dann art "regel", was = kurze englische Bildbeschreibung (z. B. "cars"), ordner = Name des Ordners. Sonst art "notiz".\nOrdner: ${targets.map((x) => x.name).join(', ')}\nSatz: ${it.text}`,
      String.raw`root ::= "{\"art\": \"" art "\", \"was\": \"" t "\", \"ordner\": \"" t "\"}"
art ::= "regel" | "notiz"
t ::= [^"\\\n]{0,40}`
    );
    if (r?.art === 'regel' && r.was && r.ordner) {
      concept = r.was;
      folder = r.ordner;
      query = `a photo of ${r.was}`;
    }
  }
  // "Fotos mit meinem Auto → Ordner": gemerktes Ding statt Bildbeschreibung
  if (concept && folder) {
    const tm = thingsInQuery(concept);
    if (tm && tm.length) {
      const tg = findTarget(targets, folder);
      if (!tg) return say(t('mem.noFolder', { name: folder }), { actions: targets.slice(0, 6).map((x) => ({ label: x.name, run: () => remember({ ...it, concept, folder: x.name }) })) });
      const who = tm.map((x) => x.name).join(', ');
      const m = addMemory({ kind: 'thing', text: it.text, label: who, thingIds: tm.map((x) => x.id), targetPath: tg.path });
      lastMemId = m.id;
      refreshRules();
      return say(t('mem.rememberedPeople', { who, folder: tg.name }), { actions: [{ label: t('ai.undo'), run: () => (removeMemory(m.id), refreshRules(), say(t('ai.undone'))) }] });
    }
  }
  // "Fotos mit meinem Bruder / meiner Familie → Ordner": Personen statt Bildbeschreibung
  if (concept && folder) {
    const pm = peopleInQuery(concept);
    if (pm && pm.persons.length) {
      const tg = findTarget(targets, folder);
      if (!tg) return say(t('mem.noFolder', { name: folder }), { actions: targets.slice(0, 6).map((x) => ({ label: x.name, run: () => remember({ ...it, concept, folder: x.name }) })) });
      const group = allGroups().find((g) => cleanName(concept!).toLowerCase() === g.toLowerCase());
      const who = group || pm.persons.map(displayName).join(', ');
      const m = addMemory({ kind: 'people', text: it.text, label: who, personIds: group ? undefined : pm.persons.map((p) => p.id), group, targetPath: tg.path });
      lastMemId = m.id;
      refreshRules();
      return say(t('mem.rememberedPeople', { who, folder: tg.name }), {
        actions: [{ label: t('ai.undo'), run: () => (removeMemory(m.id), refreshRules(), say(t('ai.undone'))) }],
      });
    }
  }
  if (concept && folder) {
    const tg = findTarget(targets, folder);
    if (!tg) {
      return say(t('mem.noFolder', { name: folder }), {
        actions: [
          ...targets.slice(0, 6).map((x) => ({ label: x.name, run: () => remember({ ...it, concept, folder: x.name }) })),
          ...(allowed('aiAllowFolders') ? [{ label: t('mem.createFolder', { name: folder }), run: async () => (await makeFolder(folder!)) && remember({ ...it, concept, folder }) }] : []),
        ],
      });
    }
    const m = addMemory({ kind: 'concept', text: it.text, concept, query: query || (TPL_Q[getLang()] || TPL_Q.en).replace('{q}', concept), targetPath: tg.path });
    lastMemId = m.id;
    refreshRules();
    return say(t('mem.rememberedRule', { what: concept, folder: tg.name }), {
      actions: [{ label: t('ai.undo'), run: () => (removeMemory(m.id), refreshRules(), say(t('ai.undone'))) }],
    });
  }
  // "Merk dir, wer meine Mutter ist" – dafür braucht es das Gesicht
  if (/^(wer|wen|wem|welche)\b/i.test(it.text.trim()) || /\b(person|personen|gesicht|gesichter)\b/i.test(it.text)) {
    return say(t('people.howToName'), { actions: [{ label: t('people.showFaces'), run: () => (updatePrefs({ showFaces: true }), setView('single')) }] });
  }
  // freie Notiz (gilt für das Gespräch)
  const m = addMemory({ kind: 'note', text: it.text });
  lastMemId = m.id;
  return say(t('mem.rememberedNote'), { actions: [{ label: t('ai.undo'), run: () => (removeMemory(m.id), say(t('ai.undone'))) }] });
}

async function changeSetting(text: string) {
  if (!permitted('aiAllowSettings')) return;
  let r = parseSetting(text);
  if (!r && llmOn()) {
    const j = await llmJson(`Welche Einstellung meint der Nutzer, und welchen Wert? Verfügbare Einstellungen (Schlüssel (Bedeutung): Werte):\n${settingsCatalog()}\nSatz: ${text}`, settingGrammar());
    if (j?.key) {
      const done = applySetting(j.key, j.value);
      if (done) return say(t('set.changed', { what: done }));
    }
  }
  if (!r) return say(t('set.unknown'), { actions: [{ label: t('ai.actSettings'), run: () => openDialog({ type: 'settings' }) }] });
  const done = applySetting(String(r.def.key), r.value);
  if (!done) return say(t('set.unknown'));
  if (r.def.key === 'aiPerf') applyAiPrefs();
  return say(t('set.changed', { what: done }));
}

async function makeFolder(name: string): Promise<string | null> {
  if (!permitted('aiAllowFolders')) return null;
  const targets = activeProfile().targets;
  const s = session();
  // neben die anderen Zielordner, sonst neben den Quellordner
  const near = targets[0]?.path || s?.sources[0];
  if (!near) {
    say(t('folder.noPlace'));
    return null;
  }
  const parent = await api().parentDir(near);
  const dir = await createTargetFolder(parent, name);
  if (dir) say(t('folder.created', { name, parent }));
  return dir;
}

/** Sprachmodell in eine feste JSON-Form antworten lassen (für Gedächtnis/Einstellungen) */
async function llmJson(instruction: string, grammar: string): Promise<any | null> {
  try {
    const prompt = `<|im_start|>system\nDu wandelst Sätze in JSON um. Antworte nur mit JSON.<|im_end|>\n<|im_start|>user\n${instruction}<|im_end|>\n<|im_start|>assistant\n${currentTier() === 'balanced' ? '<think>\n\n</think>\n\n' : ''}`;
    const r = await api().ai.chat(++llmSeq, { prompt, max: 80, temp: 0, grammar });
    return JSON.parse(r.text);
  } catch {
    return null;
  }
}
