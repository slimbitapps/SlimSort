/**
 * Bildanalyse im Hintergrund (eigener Thread, die Oberfläche bleibt flüssig):
 *  - Fingerabdruck des Motivs (dHash, 64 Bit) → ähnliche Fotos erkennen
 *  - Schärfe (Varianz des Laplace-Filters)
 *  - Belichtung (Helligkeit und ausgefressene/abgesoffene Bereiche)
 * Gearbeitet wird auf einem kleinen Vorschaubild – das ist schnell und reicht völlig.
 */

interface Req {
  id: number;
  url: string;
  fallback?: string;
  gen: number;
}

const W = 320;

async function analyze(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('fetch ' + res.status);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob, { resizeWidth: W, resizeQuality: 'medium' });
  const w = bmp.width;
  const h = bmp.height;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const data = ctx.getImageData(0, 0, w, h).data;

  // Graustufen + Belichtung
  const gray = new Float32Array(w * h);
  let sum = 0;
  let clipped = 0;
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const y = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / 255;
    gray[i] = y;
    sum += y;
    if (y < 0.02 || y > 0.98) clipped++;
  }
  const mean = sum / gray.length;
  const clipFrac = clipped / gray.length;
  const expo = Math.max(0, Math.min(1, 1 - Math.abs(mean - 0.48) * 1.6 - clipFrac * 2.5));

  // Schärfe: Varianz des Laplace-Filters, Bildmitte stärker gewichtet
  let lsum = 0;
  let lsq = 0;
  let wsum = 0;
  for (let y = 1; y < h - 1; y++) {
    const wy = 1 - Math.abs(y / h - 0.5);
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      const wt = wy * (1 - Math.abs(x / w - 0.5));
      lsum += l * wt;
      lsq += l * l * wt;
      wsum += wt;
    }
  }
  const lmean = lsum / wsum;
  const sharp = Math.sqrt(Math.max(0, lsq / wsum - lmean * lmean)) * 1000;

  // dHash: 9×8 Raster (Flächenmittel), benachbarte Helligkeiten vergleichen
  const cells = new Float32Array(72);
  for (let cy = 0; cy < 8; cy++) {
    const y0 = Math.floor((cy * h) / 8);
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * h) / 8));
    for (let cx = 0; cx < 9; cx++) {
      const x0 = Math.floor((cx * w) / 9);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * w) / 9));
      let s = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s += gray[y * w + x];
      cells[cy * 9 + cx] = s / ((y1 - y0) * (x1 - x0));
    }
  }
  let hi = 0;
  let lo = 0;
  for (let cy = 0; cy < 8; cy++) {
    for (let cx = 0; cx < 8; cx++) {
      const bit = cells[cy * 9 + cx] > cells[cy * 9 + cx + 1] ? 1 : 0;
      const n = cy * 8 + cx;
      if (n < 32) hi = (hi | (bit << n)) >>> 0;
      else lo = (lo | (bit << (n - 32))) >>> 0;
    }
  }
  return { hash: [hi, lo] as [number, number], sharp, expo };
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, url, fallback, gen } = e.data;
  try {
    let r;
    try {
      r = await analyze(url);
    } catch (err) {
      if (!fallback) throw err;
      r = await analyze(fallback);
    }
    (self as unknown as Worker).postMessage({ id, gen, ok: true, ...r });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, gen, ok: false, error: String(err) });
  }
};
