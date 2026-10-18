/**
 * Verteilt Bildanalysen auf Hintergrund-Threads.
 * Fotos in der Nähe des aktuellen Bildes werden zuerst analysiert.
 */
import type { Hash } from './series';
// Direkt eingebunden (funktioniert auch, wenn die App aus lokalen Dateien läuft)
import AnalysisWorker from './analysis.worker.ts?worker&inline';

export interface AnalysisResult {
  hash: Hash;
  sharp: number;
  expo: number;
}

type Job = { id: number; url: string };

const POOL = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 4) - 2));
let workers: Worker[] = [];
const busy = new Set<Worker>();
const queue = new Map<number, Job>();
let priority: (id: number) => number = () => 0;
let onResult: (id: number, r: AnalysisResult | null) => void = () => {};
let generation = 0;

function ensureWorkers() {
  if (workers.length) return;
  for (let i = 0; i < POOL; i++) {
    const w = new AnalysisWorker();
    w.onmessage = (e) => {
      const { id, ok, hash, sharp, expo, gen } = e.data;
      busy.delete(w);
      if (gen === generation) onResult(id, ok ? { hash, sharp, expo } : null);
      pump();
    };
    w.onerror = () => {
      busy.delete(w);
      pump();
    };
    workers.push(w);
  }
}

function pump() {
  for (const w of workers) {
    if (busy.has(w) || !queue.size) continue;
    // Auftrag mit der höchsten Priorität (kleinster Wert) wählen
    let best: Job | null = null;
    let bestP = Infinity;
    for (const job of queue.values()) {
      const p = priority(job.id);
      if (p < bestP) {
        bestP = p;
        best = job;
      }
    }
    if (!best) return;
    queue.delete(best.id);
    busy.add(w);
    w.postMessage({ id: best.id, url: best.url, gen: generation });
  }
}

export function configureAnalysis(o: { priority: (id: number) => number; onResult: (id: number, r: AnalysisResult | null) => void }) {
  priority = o.priority;
  onResult = o.onResult;
}

export function requestAnalysis(jobs: Job[]) {
  ensureWorkers();
  for (const j of jobs) if (!queue.has(j.id)) queue.set(j.id, j);
  pump();
}

export function resetAnalysis() {
  generation++;
  queue.clear();
}
