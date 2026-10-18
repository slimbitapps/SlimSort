'use strict';
/** Aufnahmezeit aus den Fotodaten (EXIF, auch HEIC), auf Sekundenbruchteile genau. */
const exifr = require('exifr');

const EXIF_EXT = new Set(['.jpg', '.jpeg', '.jpe', '.heic', '.heif', '.tif', '.tiff', '.dng', '.cr2', '.cr3', '.nef', '.arw', '.orf', '.rw2', '.raf', '.pef', '.srw', '.avif', '.png', '.webp']);

async function captureTime(file, ext) {
  if (!EXIF_EXT.has(ext)) return null;
  try {
    const d = await exifr.parse(file, {
      pick: ['DateTimeOriginal', 'CreateDate', 'SubSecTimeOriginal', 'SubSecTimeDigitized'],
      reviveValues: true,
    });
    if (!d) return null;
    const base = d.DateTimeOriginal || d.CreateDate;
    if (!(base instanceof Date) || isNaN(base.getTime())) return null;
    let ms = base.getTime();
    const sub = d.SubSecTimeOriginal ?? d.SubSecTimeDigitized;
    if (sub !== undefined && sub !== null) {
      const s = String(sub).trim();
      if (/^\d+$/.test(s)) ms = Math.floor(ms / 1000) * 1000 + Math.round(Number('0.' + s) * 1000);
    }
    return ms;
  } catch {
    return null;
  }
}

/**
 * Liest Aufnahmezeiten im Hintergrund und meldet sie in Paketen.
 * items: [{ id, path, ext }]
 */
function readCaptureTimes(items, { onBatch, concurrency = 6, isCancelled }) {
  let i = 0;
  let batch = [];
  let lastFlush = Date.now();
  const flush = () => {
    if (batch.length) onBatch(batch);
    batch = [];
    lastFlush = Date.now();
  };
  const worker = async () => {
    while (i < items.length) {
      if (isCancelled && isCancelled()) return;
      const it = items[i++];
      const t = await captureTime(it.path, it.ext);
      if (t !== null) batch.push([it.id, t]);
      if (batch.length >= 500 || Date.now() - lastFlush > 400) flush();
    }
  };
  return Promise.all(Array.from({ length: concurrency }, worker)).then(flush);
}

module.exports = { captureTime, readCaptureTimes };
