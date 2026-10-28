/**
 * Gespeicherte Chats: Jedes Gespräch bleibt nach dem Schließen erhalten und lässt sich wieder öffnen
 * (wie bei Chat-Programmen). Gespeichert wird in "chats.json" neben den Einstellungen.
 * Fotos merken wir uns über den Pfad – Nummern gelten nur für die gerade geöffnete Sortierung.
 */
import { create } from 'zustand';
import { useStore } from './store';
import type { ChatMsg } from './ai';
import type { Turn } from './assistant';

export interface StoredMsg {
  from: 'me' | 'ai';
  text: string;
  paths?: string[];
  faces?: { src: string | null; label: string }[];
}

export interface ChatSession {
  id: string;
  title: string;
  created: number;
  updated: number;
  msgs: StoredMsg[];
  hist: Turn[];
}

interface ChatsState {
  list: ChatSession[];
  current: string | null;
  loaded: boolean;
}

export const useChats = create<ChatsState>(() => ({ list: [], current: null, loaded: false }));
const st = useChats.getState;
const api = () => window.api;

/** höchstens so viele Chats behalten (die ältesten fallen weg) */
const MAX_CHATS = 60;
const MAX_MSGS = 200;

export async function loadChats() {
  try {
    const d = await api().storeGet('chats');
    if (d && Array.isArray(d.list)) useChats.setState({ list: d.list, current: d.current ?? null, loaded: true });
    else useChats.setState({ loaded: true });
  } catch {
    useChats.setState({ loaded: true });
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { list, current } = st();
    api().storeSet('chats', { list, current }).catch(() => {});
  }, 500);
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function titleOf(msgs: StoredMsg[]): string {
  const first = msgs.find((m) => m.from === 'me')?.text || '';
  const t = first.replace(/\s+/g, ' ').trim();
  return t.length > 48 ? t.slice(0, 46).trimEnd() + ' …' : t;
}

/** Laufendes Gespräch speichern (nur, wenn der Nutzer etwas geschrieben hat) */
export function saveCurrent(msgs: ChatMsg[], hist: Turn[]) {
  if (!st().loaded) return;
  const stored: StoredMsg[] = msgs
    .filter((m) => !m.streaming && m.text.trim())
    .slice(-MAX_MSGS)
    .map((m) => {
      const s = useStore.getState().session;
      const paths = m.paths ?? (m.ids && s ? m.ids.map((id) => s.byId.get(id)?.path).filter((p): p is string => !!p) : undefined);
      return { from: m.from, text: m.text, paths: paths?.length ? paths.slice(0, 24) : undefined, faces: m.faces?.slice(0, 6) };
    });
  if (!stored.some((m) => m.from === 'me')) return;
  const { list, current } = st();
  const now = Date.now();
  const existing = current ? list.find((c) => c.id === current) : undefined;
  if (existing) {
    const upd = { ...existing, msgs: stored, hist: hist.slice(-8), updated: now, title: existing.title || titleOf(stored) };
    useChats.setState({ list: [upd, ...list.filter((c) => c.id !== current)] });
  } else {
    const c: ChatSession = { id: uid(), title: titleOf(stored), created: now, updated: now, msgs: stored, hist: hist.slice(-8) };
    useChats.setState({ list: [c, ...list].slice(0, MAX_CHATS), current: c.id });
  }
  persist();
}

/** Neues Gespräch beginnen (das alte bleibt in der Liste) */
export function newChat() {
  useChats.setState({ current: null });
  persist();
}

export function deleteChat(id: string) {
  const { list, current } = st();
  useChats.setState({ list: list.filter((c) => c.id !== id), current: current === id ? null : current });
  persist();
}

export function renameChat(id: string, title: string) {
  useChats.setState({ list: st().list.map((c) => (c.id === id ? { ...c, title: title.trim() || c.title } : c)) });
  persist();
}

export function deleteAllChats() {
  useChats.setState({ list: [], current: null });
  persist();
}

/** Gespeichertes Gespräch als Chat-Nachrichten (Fotos über den Pfad wiederfinden) */
export function restore(c: ChatSession, nextId: () => number): ChatMsg[] {
  const s = useStore.getState().session;
  const byPath = new Map(s ? s.items.map((it) => [it.path, it.id]) : []);
  useChats.setState({ current: c.id });
  persist();
  return c.msgs.map((m) => {
    const ids = m.paths?.map((p) => byPath.get(p)).filter((x): x is number => x !== undefined);
    return { id: nextId(), from: m.from, text: m.text, ids: ids?.length ? ids : undefined, paths: ids?.length ? undefined : m.paths, faces: m.faces };
  });
}

/** Für Export/Import des KI-Wissens */
export function allChats(): ChatSession[] {
  return st().list;
}

export function importChats(list: ChatSession[]): number {
  const have = new Set(st().list.map((c) => c.id));
  const add = list.filter((c) => c && c.id && Array.isArray(c.msgs) && !have.has(c.id));
  useChats.setState({ list: [...st().list, ...add].sort((a, b) => b.updated - a.updated).slice(0, MAX_CHATS) });
  persist();
  return add.length;
}

/** "vor 5 Min.", "gestern", Datum */
export function when(ts: number, lang: string): string {
  const d = Date.now() - ts;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (d < 60_000) return rtf.format(0, 'minute');
  if (d < 3_600_000) return rtf.format(-Math.round(d / 60_000), 'minute');
  if (d < 86_400_000) return rtf.format(-Math.round(d / 3_600_000), 'hour');
  if (d < 7 * 86_400_000) return rtf.format(-Math.round(d / 86_400_000), 'day');
  return new Date(ts).toLocaleDateString(lang);
}
