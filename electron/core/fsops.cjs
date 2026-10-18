'use strict';
/**
 * Sichere Datei-Operationen.
 *
 * Grundregeln (es geht um Fotos – Sicherheit vor Tempo):
 *  1. Es wird NIE eine bestehende Datei überschrieben. Ziele werden exklusiv
 *     angelegt; existiert ein Name, entsteht "Name (2).jpg".
 *  2. Verschieben über Laufwerksgrenzen (oder auf ein NAS) = kopieren in eine
 *     temporäre Datei, prüfen (Größe + Prüfsumme), umbenennen, erst dann das
 *     Original entfernen.
 *  3. Das Änderungsdatum bleibt erhalten.
 *  4. Bei jedem Fehler bleibt das Original unangetastet.
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const TMP_MARK = '.fstmp-';
const DEFAULT_TIMEOUT = 5000;

class FsOpError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.code = code;
    if (details) this.details = details;
  }
}

/** Promise mit Zeitlimit – wichtig für hängende Netzlaufwerke. */
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new FsOpError('ETIMEDOUT', `Zeitüberschreitung: ${label || ''}`)),
        ms
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

async function exists(p) {
  try {
    await fsp.lstat(p);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return false;
    throw e;
  }
}

/** Prüft, ob ein Ordner erreichbar und beschreibbar ist (mit Zeitlimit). */
async function checkDir(dir, timeout = DEFAULT_TIMEOUT) {
  if (!dir) return { ok: false, code: 'NOPATH' };
  try {
    const st = await withTimeout(fsp.stat(dir), timeout, dir);
    if (!st.isDirectory()) return { ok: false, code: 'ENOTDIR' };
    await withTimeout(fsp.access(dir, fs.constants.W_OK), timeout, dir);
    return { ok: true, dev: st.dev };
  } catch (e) {
    return { ok: false, code: e.code || 'EUNKNOWN' };
  }
}

/** Zerlegt "IMG_1.JPG" in { stem: "IMG_1", ext: ".JPG" }. */
function splitName(name) {
  const ext = path.extname(name);
  if (!ext || ext === name) return { stem: name, ext: '' };
  return { stem: name.slice(0, -ext.length), ext };
}

/**
 * Findet einen freien Namensstamm im Zielordner, sodass für ALLE Endungen
 * (Hauptdatei + Begleitdateien) kein Name belegt ist.
 *   stem="IMG_1", suffixes=[".jpg", ".xmp"]  ->  "IMG_1" oder "IMG_1 (2)" ...
 */
async function uniqueStem(destDir, stem, suffixes, startAt = 1) {
  for (let n = startAt; n < 100000; n++) {
    const candidate = n === 1 ? stem : `${stem} (${n})`;
    let free = true;
    for (const sfx of suffixes) {
      if (await exists(path.join(destDir, candidate + sfx))) {
        free = false;
        break;
      }
    }
    if (free) return { stem: candidate, n };
  }
  throw new FsOpError('ENAMES', 'Kein freier Dateiname gefunden');
}

async function hashFile(file, onBytes) {
  const hash = crypto.createHash('sha1');
  const stream = fs.createReadStream(file, { highWaterMark: 1024 * 1024 });
  for await (const chunk of stream) {
    hash.update(chunk);
    if (onBytes) onBytes(chunk.length);
  }
  return hash.digest('hex');
}

/** Kopiert src -> tmp (exklusiv) und liefert die Prüfsumme der gelesenen Daten. */
async function copyWithHash(src, tmp, onBytes) {
  const hash = crypto.createHash('sha1');
  const out = await fsp.open(tmp, 'wx');
  try {
    const stream = fs.createReadStream(src, { highWaterMark: 1024 * 1024 });
    for await (const chunk of stream) {
      hash.update(chunk);
      let off = 0;
      while (off < chunk.length) {
        const { bytesWritten } = await out.write(chunk, off, chunk.length - off);
        off += bytesWritten;
      }
      if (onBytes) onBytes(chunk.length);
    }
    await out.sync().catch(() => {}); // manche Netzlaufwerke unterstützen fsync nicht
  } finally {
    await out.close();
  }
  return hash.digest('hex');
}

async function safeUnlink(p) {
  try {
    await fsp.unlink(p);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

/**
 * Legt "tmp" unter dem endgültigen Namen "dest" ab, ohne je zu überschreiben.
 * Bevorzugt Hardlink (atomar, schlägt bei existierendem Ziel fehl).
 */
async function finalizeNoClobber(tmp, dest) {
  try {
    await fsp.link(tmp, dest);
    await safeUnlink(tmp);
    return;
  } catch (e) {
    if (e.code === 'EEXIST') throw new FsOpError('EEXIST', 'Ziel existiert bereits');
    // Dateisystem ohne Hardlinks (z. B. SMB, exFAT): prüfen, dann umbenennen.
  }
  if (await exists(dest)) throw new FsOpError('EEXIST', 'Ziel existiert bereits');
  await fsp.rename(tmp, dest);
}

/**
 * Überträgt EINE Datei an den exakten Zielpfad "dest" (der nicht existieren darf).
 * mode: 'move' | 'copy'
 * onProgress(doneBytes, totalBytes)
 * Rückgabe: { method: 'link' | 'copy' }
 */
async function transferFile(src, dest, { mode = 'move', onProgress, verify = true } = {}) {
  const srcStat = await fsp.stat(src);
  if (!srcStat.isFile()) throw new FsOpError('ENOTFILE', `Keine Datei: ${src}`);
  if (await exists(dest)) throw new FsOpError('EEXIST', 'Ziel existiert bereits');

  const destDir = path.dirname(dest);
  const size = srcStat.size;

  // Schneller Weg: gleiches Laufwerk -> Hardlink + Original entfernen.
  if (mode === 'move') {
    let destDev = null;
    try {
      destDev = (await fsp.stat(destDir)).dev;
    } catch (e) {
      throw new FsOpError('EDESTDIR', 'Zielordner nicht erreichbar', { code: e.code });
    }
    if (destDev === srcStat.dev) {
      let linked = false;
      try {
        await fsp.link(src, dest);
        linked = true;
      } catch (e) {
        if (e.code === 'EEXIST') throw new FsOpError('EEXIST', 'Ziel existiert bereits');
        // sonst: Kopierweg
      }
      if (linked) {
        try {
          await fsp.unlink(src);
        } catch (e) {
          // Original konnte nicht entfernt werden -> Link wieder entfernen,
          // damit keine doppelte Datei entsteht. Das Original bleibt.
          await safeUnlink(dest);
          throw new FsOpError('ESRCREMOVE', 'Original konnte nicht entfernt werden', { code: e.code });
        }
        if (onProgress) onProgress(size, size);
        return { method: 'link' };
      }
    }
  }

  // Sicherer Kopierweg: kopieren -> prüfen -> umbenennen -> (Original löschen)
  const total = verify ? size * 2 : size;
  let done = 0;
  const tick = (n) => {
    done += n;
    if (onProgress) onProgress(Math.min(done, total), total);
  };
  const tmp = path.join(
    destDir,
    `.${path.basename(dest)}${TMP_MARK}${crypto.randomBytes(4).toString('hex')}`
  );
  try {
    const srcHash = await copyWithHash(src, tmp, tick);
    await fsp.utimes(tmp, srcStat.atime, srcStat.mtime);
    const tmpStat = await fsp.stat(tmp);
    if (tmpStat.size !== size) throw new FsOpError('EVERIFY', 'Größe der Kopie stimmt nicht');
    if (verify) {
      const copyHash = await hashFile(tmp, tick);
      if (copyHash !== srcHash) throw new FsOpError('EVERIFY', 'Prüfsumme der Kopie stimmt nicht');
    }
    await finalizeNoClobber(tmp, dest);
  } catch (e) {
    await safeUnlink(tmp).catch(() => {});
    throw e;
  }

  // Manche Dateisysteme setzen beim Umbenennen die Zeit neu -> nochmals setzen.
  try {
    const st = await fsp.stat(dest);
    if (Math.abs(st.mtimeMs - srcStat.mtimeMs) > 2000) {
      await fsp.utimes(dest, srcStat.atime, srcStat.mtime);
    }
  } catch {
    /* nicht kritisch */
  }

  if (mode === 'move') {
    try {
      // Wurde das Original während des Kopierens verändert? Dann nicht löschen.
      const now = await fsp.stat(src);
      if (now.size !== srcStat.size || now.mtimeMs !== srcStat.mtimeMs) {
        throw new FsOpError('ESRCCHANGED', 'Original wurde während des Kopierens verändert');
      }
      await fsp.unlink(src);
    } catch (e) {
      // Original bleibt -> geprüfte Kopie wieder entfernen, Zustand bleibt eindeutig.
      await safeUnlink(dest).catch(() => {});
      if (e instanceof FsOpError) throw e;
      throw new FsOpError('ESRCREMOVE', 'Original konnte nicht entfernt werden', { code: e.code });
    }
  }
  return { method: 'copy' };
}

/**
 * Überträgt eine Gruppe zusammengehöriger Dateien (Hauptdatei + Begleitdateien,
 * Live-Photo-Video) gemeinsam in einen Ordner. Alle bekommen denselben neuen
 * Namensstamm. Schlägt eine Datei fehl, werden bereits übertragene zurückgeholt.
 *
 * files: [{ path }], die erste Datei ist die Hauptdatei.
 * Rückgabe: [{ from, to }]
 */
async function transferGroup(files, destDir, { mode = 'move', onProgress, timeout = DEFAULT_TIMEOUT } = {}) {
  const reach = await checkDir(destDir, timeout);
  if (!reach.ok) {
    throw new FsOpError('EUNREACHABLE', `Zielordner nicht erreichbar: ${destDir}`, { code: reach.code });
  }
  const primary = files[0];
  const { stem } = splitName(path.basename(primary));
  const suffixes = files.map((f) => {
    const base = path.basename(f);
    return base.toLowerCase().startsWith(stem.toLowerCase()) ? base.slice(stem.length) : null;
  });
  // Begleitdateien mit abweichendem Namen behalten ihren eigenen Namen.
  const sizes = [];
  for (const f of files) sizes.push((await fsp.stat(f)).size);
  const grandTotal = sizes.reduce((a, b) => a + b, 0) || 1;

  let startAt = 1;
  for (let attempt = 0; attempt < 50; attempt++) {
    const sfx = suffixes.filter((s) => s !== null);
    const { stem: newStem, n } = await uniqueStem(destDir, stem, sfx, startAt);
    const plan = files.map((f, i) => ({
      from: f,
      to: path.join(destDir, suffixes[i] !== null ? newStem + suffixes[i] : path.basename(f)),
    }));
    const done = [];
    let base = 0;
    try {
      for (let i = 0; i < plan.length; i++) {
        const p = plan[i];
        if (suffixes[i] === null && (await exists(p.to))) {
          // Abweichend benannte Begleitdatei: eigener freier Name
          const sp = splitName(path.basename(p.from));
          const u = await uniqueStem(destDir, sp.stem, [sp.ext]);
          p.to = path.join(destDir, u.stem + sp.ext);
        }
        await transferFile(p.from, p.to, {
          mode,
          onProgress: onProgress
            ? (d, t) => onProgress(base + (d / (t || 1)) * sizes[i], grandTotal)
            : undefined,
        });
        base += sizes[i];
        done.push(p);
      }
      if (onProgress) onProgress(grandTotal, grandTotal);
      return plan;
    } catch (e) {
      // Bereits übertragene Dateien zurückholen
      for (const d of done.reverse()) {
        try {
          if (mode === 'move') await transferFile(d.to, d.from, { mode: 'move' });
          else await safeUnlink(d.to);
        } catch {
          /* Rollback best effort – Original/Kopie bleibt in jedem Fall erhalten */
        }
      }
      if (e.code === 'EEXIST') {
        // Jemand hat den Namen zwischenzeitlich belegt -> nächster Versuch
        startAt = n + 1;
        continue;
      }
      throw e;
    }
  }
  throw new FsOpError('ENAMES', 'Kein freier Dateiname gefunden');
}

/** Rückgängig machen einer Übertragung. */
async function revertMoves(moves, mode, { onProgress } = {}) {
  const restored = [];
  if (mode === 'copy') {
    for (const m of moves) {
      // Kopie nur entfernen, wenn das Original noch da ist.
      if (!(await exists(m.from))) {
        throw new FsOpError('EORIGMISSING', 'Original fehlt – Kopie wird nicht entfernt', { path: m.from });
      }
      await safeUnlink(m.to);
      restored.push({ from: m.to, to: m.from });
    }
    return restored;
  }
  // Verschieben zurück: gemeinsam als Gruppe in den ursprünglichen Ordner,
  // möglichst unter dem ursprünglichen Namen.
  const byDir = new Map();
  for (const m of moves) {
    const d = path.dirname(m.from);
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d).push(m);
  }
  for (const [dir, list] of byDir) {
    await fsp.mkdir(dir, { recursive: true }).catch(() => {});
    // Ursprüngliche Namen frei? -> exakt zurück. Sonst gemeinsamer neuer Stamm.
    let allFree = true;
    for (const m of list) if (await exists(m.from)) allFree = false;
    if (allFree) {
      const back = [];
      try {
        for (const m of list) {
          await transferFile(m.to, m.from, { mode: 'move', onProgress });
          back.push(m);
          restored.push({ from: m.to, to: m.from });
        }
      } catch (e) {
        for (const b of back.reverse()) {
          await transferFile(b.from, b.to, { mode: 'move' }).catch(() => {});
          restored.pop();
        }
        throw e;
      }
    } else {
      const plan = await transferGroup(
        list.map((m) => m.to),
        dir,
        { mode: 'move', onProgress }
      );
      restored.push(...plan);
    }
  }
  return restored;
}

module.exports = {
  FsOpError,
  TMP_MARK,
  withTimeout,
  exists,
  checkDir,
  splitName,
  uniqueStem,
  hashFile,
  transferFile,
  transferGroup,
  revertMoves,
  safeUnlink,
};
