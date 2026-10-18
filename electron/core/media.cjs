'use strict';
/**
 * Liefert Dateien, Vorschaubilder und große Vorschauen an die Oberfläche:
 *   media://f/?p=<Pfad>            Originaldatei (mit Range für Videos)
 *   thumb://f/?p=<Pfad>&s=256      Vorschaubild (zwischengespeichert)
 *   preview://f/?p=<Pfad>          große Ansicht für HEIC/RAW/TIFF
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { Worker } = require('node:worker_threads');
const { BROWSER_IMAGE_EXT } = require('./media-types.cjs');

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jpe': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.3gp': 'video/3gpp',
};

function createMediaServer({ nativeImage, cacheDir }) {
  const thumbDir = path.join(cacheDir, 'thumbs');
  const previewDir = path.join(cacheDir, 'previews');
  fs.mkdirSync(thumbDir, { recursive: true });
  fs.mkdirSync(previewDir, { recursive: true });
  const osThumbs = process.platform === 'win32' || process.platform === 'darwin';

  // --- Warteschlange: neueste Anfragen zuerst (sichtbare Bilder beim Scrollen) ---
  const MAX_PARALLEL = 4;
  let active = 0;
  const waiting = [];
  function schedule(fn) {
    return new Promise((resolve, reject) => {
      waiting.push({ fn, resolve, reject });
      pump();
    });
  }
  function pump() {
    while (active < MAX_PARALLEL && waiting.length) {
      const job = waiting.pop(); // LIFO
      active++;
      job.fn().then(job.resolve, job.reject).finally(() => {
        active--;
        pump();
      });
    }
    // Sehr alte Anfragen verwerfen (vom Scrollen überholt)
    if (waiting.length > 400) waiting.splice(0, waiting.length - 400).forEach((j) => j.resolve(null));
  }

  // --- HEIC-Umwandlung im Hintergrund-Thread ---
  let worker = null;
  let wid = 0;
  const wjobs = new Map();
  function heicToJpeg(file) {
    if (!worker) {
      worker = new Worker(path.join(__dirname, 'heic-worker.cjs').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep));
      worker.on('message', ({ id, ok, data, error }) => {
        const j = wjobs.get(id);
        wjobs.delete(id);
        if (j) ok ? j.resolve(Buffer.from(data)) : j.reject(new Error(error));
      });
      worker.on('error', () => {
        for (const j of wjobs.values()) j.reject(new Error('worker'));
        wjobs.clear();
        worker = null;
      });
    }
    return new Promise((resolve, reject) => {
      const id = ++wid;
      wjobs.set(id, { resolve, reject });
      worker.postMessage({ id, file });
    });
  }

  async function cacheKey(file, extra) {
    const st = await fsp.stat(file);
    return crypto.createHash('sha1').update(`${file}|${st.size}|${st.mtimeMs}|${extra}`).digest('hex');
  }

  const inflight = new Map();
  async function cached(dir, file, extra, make) {
    const key = await cacheKey(file, extra);
    const out = path.join(dir, key.slice(0, 2), key + '.jpg');
    try {
      await fsp.access(out);
      return out;
    } catch {
      /* noch nicht vorhanden */
    }
    if (inflight.has(out)) return inflight.get(out);
    const p = (async () => {
      const buf = await make();
      if (!buf) return null;
      await fsp.mkdir(path.dirname(out), { recursive: true });
      const tmp = out + '.' + process.pid + '.tmp';
      await fsp.writeFile(tmp, buf);
      await fsp.rename(tmp, out);
      return out;
    })().finally(() => inflight.delete(out));
    inflight.set(out, p);
    return p;
  }

  async function makeThumb(file, size) {
    const ext = path.extname(file).toLowerCase();
    if (osThumbs) {
      try {
        const img = await nativeImage.createThumbnailFromPath(file, { width: size, height: size });
        if (img && !img.isEmpty()) return img.toJPEG(82);
      } catch {
        /* Fallback unten */
      }
    }
    if (ext === '.heic' || ext === '.heif') {
      const jpg = await heicToJpeg(file);
      const img = nativeImage.createFromBuffer(jpg);
      const s = img.getSize();
      const scale = Math.min(1, size / Math.max(s.width, s.height));
      return img.resize({ width: Math.round(s.width * scale), quality: 'good' }).toJPEG(82);
    }
    return null;
  }

  async function makePreview(file) {
    const ext = path.extname(file).toLowerCase();
    if (process.platform === 'darwin') {
      try {
        const img = nativeImage.createFromPath(file); // ImageIO: HEIC, RAW, TIFF
        if (!img.isEmpty()) {
          const s = img.getSize();
          const scale = Math.min(1, 3200 / Math.max(s.width, s.height));
          return (scale < 1 ? img.resize({ width: Math.round(s.width * scale), quality: 'best' }) : img).toJPEG(90);
        }
      } catch {
        /* weiter */
      }
    }
    if (ext === '.heic' || ext === '.heif') {
      try {
        return await heicToJpeg(file);
      } catch {
        /* weiter */
      }
    }
    if (osThumbs) {
      try {
        const img = await nativeImage.createThumbnailFromPath(file, { width: 2560, height: 2560 });
        if (img && !img.isEmpty()) return img.toJPEG(90);
      } catch {
        /* weiter */
      }
    }
    return null;
  }

  function fileFromUrl(url) {
    const u = new URL(url);
    return { file: u.searchParams.get('p'), size: Number(u.searchParams.get('s')) || 256 };
  }

  async function serveFile(file, request) {
    const st = await fsp.stat(file);
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = request.headers.get('range');
    const m = range && /bytes=(\d*)-(\d*)/.exec(range);
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]));
      let end = m[1] && m[2] ? Number(m[2]) : st.size - 1;
      end = Math.min(end, st.size - 1);
      if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
      return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${st.size}`,
          'Accept-Ranges': 'bytes',
        },
      });
    }
    return new Response(Readable.toWeb(fs.createReadStream(file)), {
      status: 200,
      headers: { 'Content-Type': type, 'Content-Length': String(st.size), 'Accept-Ranges': 'bytes' },
    });
  }

  const notFound = () => new Response(null, { status: 404 });

  async function handleMedia(request) {
    try {
      return await serveFile(fileFromUrl(request.url).file, request);
    } catch {
      return notFound();
    }
  }

  async function handleThumb(request) {
    try {
      const { file, size } = fileFromUrl(request.url);
      const ext = path.extname(file).toLowerCase();
      // Auf Linux (nur Entwicklung) und für einfache Formate ohne OS-Vorschau:
      // Original liefern – der Browser verkleinert und dreht selbst richtig.
      if (!osThumbs && BROWSER_IMAGE_EXT.has(ext)) return serveFile(file, request);
      const out = await schedule(() => cached(thumbDir, file, size, () => makeThumb(file, size)));
      if (out) return serveFile(out, request);
      if (BROWSER_IMAGE_EXT.has(ext)) return serveFile(file, request);
      return notFound();
    } catch {
      return notFound();
    }
  }

  async function handlePreview(request) {
    try {
      const { file } = fileFromUrl(request.url);
      const ext = path.extname(file).toLowerCase();
      if (BROWSER_IMAGE_EXT.has(ext)) return serveFile(file, request);
      const out = await cached(previewDir, file, 'preview', () => makePreview(file));
      return out ? serveFile(out, request) : notFound();
    } catch {
      return notFound();
    }
  }

  /** Zwischenspeicher begrenzen (älteste Dateien zuerst entfernen). */
  async function trimCache(maxBytes = 1.5 * 1024 ** 3) {
    const files = [];
    for (const base of [thumbDir, previewDir]) {
      for (const sub of await fsp.readdir(base).catch(() => [])) {
        const d = path.join(base, sub);
        for (const f of await fsp.readdir(d).catch(() => [])) {
          const p = path.join(d, f);
          try {
            const st = await fsp.stat(p);
            files.push({ p, size: st.size, t: st.atimeMs || st.mtimeMs });
          } catch {
            /* ignorieren */
          }
        }
      }
    }
    let total = files.reduce((a, f) => a + f.size, 0);
    files.sort((a, b) => a.t - b.t);
    for (const f of files) {
      if (total <= maxBytes) break;
      await fsp.unlink(f.p).catch(() => {});
      total -= f.size;
    }
  }

  async function clearCache() {
    await fsp.rm(thumbDir, { recursive: true, force: true });
    await fsp.rm(previewDir, { recursive: true, force: true });
    fs.mkdirSync(thumbDir, { recursive: true });
    fs.mkdirSync(previewDir, { recursive: true });
  }

  return { handleMedia, handleThumb, handlePreview, trimCache, clearCache };
}

module.exports = { createMediaServer };
