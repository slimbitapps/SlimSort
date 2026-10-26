/**
 * Ersatz-Anzeige für HEIC/HEIF, wenn es keine Vorschau vom System gibt.
 * Neueste Anfragen zuerst, Ergebnisse werden (begrenzt) gemerkt.
 */
import HeicWorker from './heic.worker.ts?worker';
import { mediaUrl } from './util';

export const isHeic = (ext: string) => ext === '.heic' || ext === '.heif';

let worker: Worker | null = null;
let nextId = 1;
let busy = false;
const waiting: { id: number; url: string; size: number; resolve: (u: string | null) => void }[] = [];
const results = new Map<string, Promise<string | null>>();
const MAX = 300;

function pump() {
  if (busy || !waiting.length) return;
  const job = waiting.pop()!; // neueste zuerst (sichtbare Bilder)
  busy = true;
  if (!worker) worker = new HeicWorker();
  const w = worker;
  const done = (u: string | null) => {
    busy = false;
    w.removeEventListener('message', onMsg);
    job.resolve(u);
    pump();
  };
  const onMsg = (e: MessageEvent) => {
    if (e.data.id !== job.id) return;
    done(e.data.ok ? URL.createObjectURL(e.data.blob) : null);
  };
  w.addEventListener('message', onMsg);
  w.onerror = () => {
    worker = null;
    done(null);
  };
  w.postMessage({ id: job.id, url: job.url, size: job.size });
}

/** Liefert eine Bild-Adresse (blob:) für das HEIC-Foto in passender Größe – oder null. */
export function heicUrl(path: string, size: number): Promise<string | null> {
  const s = size <= 512 ? 512 : size <= 1536 ? 1536 : 3072;
  const key = `${path}|${s}`;
  const hit = results.get(key);
  if (hit) {
    results.delete(key);
    results.set(key, hit);
    return hit;
  }
  const p = new Promise<string | null>((resolve) => {
    waiting.push({ id: nextId++, url: mediaUrl(path), size: s, resolve });
    pump();
  });
  results.set(key, p);
  while (results.size > MAX) {
    const [k, old] = results.entries().next().value!;
    results.delete(k);
    old.then((u) => u && URL.revokeObjectURL(u));
  }
  return p;
}
