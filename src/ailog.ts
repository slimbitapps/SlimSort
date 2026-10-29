/**
 * KI-Verlauf: alles, was die KI geändert hat – gebündelt ("12 Fotos → Urlaub"), aufklappbar bis zum
 * einzelnen Foto, und alles lässt sich zurücknehmen (ganz oder je Foto).
 * Gilt für die laufende App; Verschieben lässt sich zurücknehmen, solange die Sortierung offen ist.
 */
import { create } from 'zustand';
import { useStore, undoOp, toast } from './store';
import { t } from './i18n';

export type LogKind = 'move' | 'delete' | 'folder' | 'setting' | 'memory' | 'people' | 'things' | 'learn';

export interface LogPhoto {
  id: number;
  name: string;
  path: string;
  /** wohin (Ordnername) */
  to?: string;
  opId: number;
  undone?: boolean;
}

export interface LogEntry {
  id: number;
  time: number;
  kind: LogKind;
  /** kurz: "12 Fotos → Urlaub" */
  title: string;
  /** woher der Auftrag kam: "Chat", "KI sortieren", "Autopilot" */
  source?: string;
  photos?: LogPhoto[];
  /** Zurücknehmen für Einträge ohne Fotos (Einstellung, Gedächtnis, Ordner …) */
  revert?: () => void | Promise<void>;
  undone?: boolean;
}

export const useAiLog = create<{ entries: LogEntry[] }>(() => ({ entries: [] }));
let seq = 0;

function save(entries: LogEntry[]) {
  useAiLog.setState({ entries: entries.slice(0, 300) });
}

export function logEntry(e: Omit<LogEntry, 'id' | 'time'>): LogEntry {
  const entry: LogEntry = { ...e, id: ++seq, time: Date.now() };
  save([entry, ...useAiLog.getState().entries]);
  return entry;
}

/** Verschieben/Löschen eintragen: je Auftrag (opId) die Fotos und ihr Ziel */
export function logPhotos(kind: 'move' | 'delete', title: string, ops: { opId: number; ids: number[]; to?: string }[], source?: string): LogEntry | null {
  const s = useStore.getState().session;
  if (!s) return null;
  const photos: LogPhoto[] = ops.flatMap((op) =>
    op.ids.map((id) => {
      const it = s.byId.get(id);
      return { id, name: it?.name || String(id), path: it?.path || '', to: op.to, opId: op.opId };
    })
  );
  if (!photos.length) return null;
  return logEntry({ kind, title, photos, source });
}

function update(id: number, fn: (e: LogEntry) => LogEntry) {
  save(useAiLog.getState().entries.map((e) => (e.id === id ? fn(e) : e)));
}

/** Ganzen Eintrag zurücknehmen */
export async function undoEntry(e: LogEntry) {
  if (e.undone) return;
  if (e.photos?.length) {
    if (!useStore.getState().session) return toast('info', t('log.sessionClosed'));
    const open = e.photos.filter((p) => !p.undone);
    for (const opId of new Set(open.map((p) => p.opId))) undoOp(opId, open.filter((p) => p.opId === opId).map((p) => p.id));
  }
  if (e.revert) await e.revert();
  update(e.id, (x) => ({ ...x, undone: true, photos: x.photos?.map((p) => ({ ...p, undone: true })) }));
  toast('info', t('log.undone', { what: e.title }), { timeout: 2500 });
}

/** Ein einzelnes Foto eines Eintrags zurücknehmen */
export function undoPhoto(e: LogEntry, photoId: number) {
  const p = e.photos?.find((x) => x.id === photoId);
  if (!p || p.undone) return;
  if (!useStore.getState().session) return toast('info', t('log.sessionClosed'));
  undoOp(p.opId, [p.id]);
  update(e.id, (x) => {
    const photos = x.photos!.map((y) => (y.id === photoId ? { ...y, undone: true } : y));
    return { ...x, photos, undone: photos.every((y) => y.undone) };
  });
}

/** Wurde ein Foto anderweitig zurückgenommen (Strg+Z)? → im Verlauf als zurückgenommen zeigen */
export function markUndone(ids: number[]) {
  const set = new Set(ids);
  const entries = useAiLog.getState().entries;
  if (!entries.some((e) => e.photos?.some((p) => set.has(p.id) && !p.undone))) return;
  save(
    entries.map((e) => {
      if (!e.photos?.some((p) => set.has(p.id))) return e;
      const photos = e.photos.map((p) => (set.has(p.id) ? { ...p, undone: true } : p));
      return { ...e, photos, undone: photos.every((p) => p.undone) };
    })
  );
}
