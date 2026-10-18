/**
 * Serien erkennen: Fotos, die kurz nacheinander entstanden sind und
 * (soweit schon analysiert) ein ähnliches Motiv zeigen.
 * Reine Funktionen ohne Oberfläche – dadurch gut testbar.
 */

export type Hash = [number, number];

export interface SeriesInput {
  id: number;
  t: number; // Aufnahmezeit in ms
  kind: 'image' | 'video';
  hash?: Hash;
}

export interface Scores {
  /** Analyse abgeschlossen (auch wenn sie scheiterte) */
  analyzed?: boolean;
  hash?: Hash;
  sharp?: number;
  expo?: number;
}

/** Maximaler Abstand der Fingerabdrücke (von 64 Bit), damit Fotos als "gleiches Motiv" gelten. */
export const MOTIF_DIST = { loose: 24, normal: 18, strict: 11 } as const;
/** Sehr lange Serien werden aufgeteilt, damit der Vergleich übersichtlich bleibt. */
export const MAX_SERIES = 60;
export type Strictness = keyof typeof MOTIF_DIST;

function popcount(n: number) {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function hamming(a: Hash, b: Hash) {
  return popcount((a[0] ^ b[0]) >>> 0) + popcount((a[1] ^ b[1]) >>> 0);
}

/**
 * Teilt Fotos in Serien auf.
 * - Neue Serie, wenn der zeitliche Abstand zum vorherigen Foto größer als gapMs ist.
 * - Innerhalb eines Zeitabschnitts trennt ein deutlich anderes Motiv die Serie
 *   (nur wenn beide Fotos schon analysiert sind).
 * Rückgabe: Liste von Serien (je mindestens 2 IDs, zeitlich sortiert).
 */
export function computeSeries(items: SeriesInput[], gapMs: number, maxDist: number): number[][] {
  const imgs = items.filter((i) => i.kind === 'image').sort((a, b) => a.t - b.t || a.id - b.id);
  const out: number[][] = [];
  let cur: SeriesInput[] = [];
  const flush = () => {
    for (let i = 0; i < cur.length; i += MAX_SERIES) {
      const part = cur.slice(i, i + MAX_SERIES);
      if (part.length >= 2) out.push(part.map((x) => x.id));
    }
    cur = [];
  };
  for (const it of imgs) {
    const prev = cur[cur.length - 1];
    if (!prev) {
      cur.push(it);
      continue;
    }
    const closeInTime = it.t - prev.t <= gapMs;
    // Vergleich mit dem letzten analysierten Foto der Serie
    let similar = true;
    if (it.hash) {
      for (let k = cur.length - 1; k >= 0; k--) {
        const h = cur[k].hash;
        if (h) {
          similar = hamming(h, it.hash) <= maxDist;
          break;
        }
      }
    }
    if (closeInTime && similar) cur.push(it);
    else {
      flush();
      cur.push(it);
    }
  }
  flush();
  return out;
}

export interface Ranking {
  best: number | null;
  sharpest: number | null;
  /** Fotos mit deutlich anderem Motiv – werden nie automatisch zum Löschen markiert */
  different: Set<number>;
  /** 0–1, relativ innerhalb der Serie */
  sharpRel: Map<number, number>;
  score: Map<number, number>;
  complete: boolean;
}

/** Bewertet die Fotos einer Serie und schlägt das beste vor. */
export function rankSeries(ids: number[], get: (id: number) => Scores | undefined, maxDist: number): Ranking {
  const sharpRel = new Map<number, number>();
  const score = new Map<number, number>();
  const different = new Set<number>();
  const analyzed = ids.filter((id) => get(id)?.sharp !== undefined);
  const complete = ids.every((id) => get(id)?.analyzed || get(id)?.sharp !== undefined);

  // "Mittelpunkt" der Serie: Foto mit der kleinsten Summe der Abstände zu allen anderen
  const hashed = ids.filter((id) => get(id)?.hash).slice(0, MAX_SERIES);
  if (hashed.length >= 3) {
    let medoid = hashed[0];
    let bestSum = Infinity;
    for (const a of hashed) {
      let sum = 0;
      for (const b of hashed) if (a !== b) sum += hamming(get(a)!.hash!, get(b)!.hash!);
      if (sum < bestSum) {
        bestSum = sum;
        medoid = a;
      }
    }
    for (const id of hashed) {
      if (id !== medoid && hamming(get(id)!.hash!, get(medoid)!.hash!) > maxDist * 1.25) different.add(id);
    }
  }

  const maxSharp = Math.max(1e-9, ...analyzed.map((id) => get(id)!.sharp!));
  let best: number | null = null;
  let bestScore = -1;
  let sharpest: number | null = null;
  let sharpestVal = -1;
  for (const id of analyzed) {
    const a = get(id)!;
    const rel = a.sharp! / maxSharp;
    sharpRel.set(id, rel);
    const sc = 0.75 * rel + 0.25 * (a.expo ?? 0.5);
    score.set(id, sc);
    if (a.sharp! > sharpestVal) {
      sharpestVal = a.sharp!;
      sharpest = id;
    }
    if (!different.has(id) && sc > bestScore) {
      bestScore = sc;
      best = id;
    }
  }
  return { best, sharpest, different, sharpRel, score, complete };
}
