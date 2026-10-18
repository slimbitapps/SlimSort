'use strict';
/**
 * Durchsucht einen Quellordner nach Fotos und Videos und fasst zusammen-
 * gehörige Dateien zu einem "Eintrag" zusammen:
 *   - Begleitdateien (.xmp, .aae, .thm) mit gleichem Namen
 *   - Live Photos: Foto + gleichnamiges kurzes Video
 */
const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  kindOf,
  SKIP_DIRS,
  LIVE_IMAGE_EXT,
  LIVE_VIDEO_EXT,
  LIVE_VIDEO_MAX_BYTES,
} = require('./media-types.cjs');
const { TMP_MARK } = require('./fsops.cjs');

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (i < list.length) {
      const idx = i++;
      out[idx] = await fn(list[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

function samePath(a, b) {
  const na = path.resolve(a);
  const nb = path.resolve(b);
  return process.platform === 'linux' ? na === nb : na.toLowerCase() === nb.toLowerCase();
}

/** Schlüssel für die Gruppierung: "IMG_1.JPG.xmp" und "IMG_1.xmp" -> "img_1" */
function baseKey(name) {
  let n = name;
  for (let i = 0; i < 2; i++) {
    const ext = path.extname(n);
    if (!ext || ext === n) break;
    if (kindOf(ext)) n = n.slice(0, -ext.length);
    else break;
  }
  return n.toLowerCase();
}

/**
 * scan(sourceDir, { recursive, exclude: [Pfade], onProgress(count) })
 * Liefert Einträge: { id, dir, name, ext, kind, size, mtime, path,
 *                     sidecars: [Pfade], live: Pfad|null, liveSize }
 */
async function scan(sourceDir, { recursive = false, exclude = [], onProgress, signal } = {}) {
  const groups = []; // pro Ordner Listen von Dateien
  const queue = [sourceDir];
  let found = 0;
  while (queue.length) {
    if (signal && signal.aborted) throw new Error('abgebrochen');
    const dir = queue.shift();
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (dir === sourceDir) throw e;
      continue; // Unterordner ohne Zugriff überspringen
    }
    const files = [];
    for (const ent of entries) {
      const name = ent.name;
      if (name.startsWith('.') || name.includes(TMP_MARK)) continue;
      const full = path.join(dir, name);
      if (ent.isDirectory()) {
        if (!recursive) continue;
        if (SKIP_DIRS.has(name.toLowerCase())) continue;
        if (exclude.some((x) => x && samePath(x, full))) continue;
        queue.push(full);
      } else if (ent.isFile() || ent.isSymbolicLink()) {
        const kind = kindOf(path.extname(name));
        if (kind) files.push({ name, full, kind });
      }
    }
    if (files.length) {
      groups.push({ dir, files });
      found += files.length;
      if (onProgress) onProgress(found);
    }
  }

  // Dateigrößen und -daten parallel lesen
  const allFiles = groups.flatMap((g) => g.files);
  await mapLimit(allFiles, 32, async (f) => {
    try {
      const st = await fsp.stat(f.full);
      f.size = st.size;
      f.mtime = st.mtimeMs;
      f.birth = st.birthtimeMs || st.mtimeMs;
    } catch {
      f.missing = true;
    }
  });

  const items = [];
  for (const g of groups) {
    const byKey = new Map();
    for (const f of g.files) {
      if (f.missing) continue;
      const k = baseKey(f.name);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(f);
    }
    for (const list of byKey.values()) {
      const images = list.filter((f) => f.kind === 'image');
      const videos = list.filter((f) => f.kind === 'video');
      const sidecars = list.filter((f) => f.kind === 'sidecar');
      const entries = [];
      let liveUsed = null;
      if (images.length >= 1 && videos.length === 1) {
        const v = videos[0];
        const img = images.find((i) => LIVE_IMAGE_EXT.has(path.extname(i.name).toLowerCase()));
        if (img && LIVE_VIDEO_EXT.has(path.extname(v.name).toLowerCase()) && v.size <= LIVE_VIDEO_MAX_BYTES) {
          liveUsed = v;
          img.live = v;
        }
      }
      for (const f of images) entries.push(f);
      for (const f of videos) if (f !== liveUsed) entries.push(f);
      if (!entries.length) continue; // nur Begleitdateien -> ignorieren

      // Begleitdateien zuordnen: exakter Name ("x.jpg.xmp") zuerst, sonst
      // RAW-Datei bevorzugen, sonst erste Datei.
      for (const s of sidecars) {
        const inner = s.name.slice(0, -path.extname(s.name).length).toLowerCase();
        let owner = entries.find((e) => e.name.toLowerCase() === inner);
        if (!owner) {
          owner =
            entries.find((e) => /\.(dng|cr2|cr3|nef|nrw|arw|raf|orf|rw2|pef|srw)$/i.test(e.name)) ||
            entries[0];
        }
        (owner.sidecars || (owner.sidecars = [])).push(s.full);
      }
      for (const e of entries) {
        const ext = path.extname(e.name);
        items.push({
          path: e.full,
          dir: path.relative(sourceDir, g.dir),
          name: e.name,
          ext: ext.toLowerCase(),
          kind: e.kind,
          size: e.size,
          mtime: e.mtime,
          sidecars: e.sidecars || [],
          live: e.live ? e.live.full : null,
          liveSize: e.live ? e.live.size : 0,
        });
      }
    }
  }
  return items;
}

module.exports = { scan, baseKey, mapLimit, samePath };
