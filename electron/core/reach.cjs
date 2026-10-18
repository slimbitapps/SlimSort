'use strict';
/**
 * Erreichbarkeit von Ordnern überwachen (z. B. NAS nach dem Hochfahren)
 * und umgezogene Ordner anhand ihres Namens wiederfinden.
 */
const EventEmitter = require('node:events');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { checkDir, withTimeout } = require('./fsops.cjs');
const { SKIP_DIRS } = require('./media-types.cjs');

/** Prüfzeitpunkte nach dem Start (Sekunden) – Netzlaufwerke brauchen oft etwas. */
const STARTUP_CHECKS = [0, 3, 8, 15, 30, 60, 120];
const INTERVAL_MS = 15000;

class ReachMonitor extends EventEmitter {
  constructor({ timeout = 4000 } = {}) {
    super();
    this.timeout = timeout;
    this.dirs = new Set();
    this.status = new Map(); // dir -> boolean
    this.timers = [];
    this.running = false;
  }

  setDirs(dirs) {
    this.dirs = new Set(dirs.filter(Boolean));
    for (const d of [...this.status.keys()]) if (!this.dirs.has(d)) this.status.delete(d);
    this.checkNow();
  }

  start() {
    for (const s of STARTUP_CHECKS) this.timers.push(setTimeout(() => this.checkNow(), s * 1000));
    this.timers.push(setInterval(() => this.checkNow(), INTERVAL_MS));
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  async checkNow() {
    if (this.running) return this.snapshot();
    this.running = true;
    try {
      const list = [...this.dirs];
      const res = await Promise.all(list.map((d) => checkDir(d, this.timeout)));
      let changed = false;
      list.forEach((d, i) => {
        const ok = res[i].ok;
        if (this.status.get(d) !== ok) changed = true;
        this.status.set(d, ok);
      });
      if (changed) this.emit('change', this.snapshot());
    } finally {
      this.running = false;
    }
    return this.snapshot();
  }

  snapshot() {
    return Object.fromEntries(this.status);
  }
}

async function isDir(p, timeout = 1500) {
  try {
    return (await withTimeout(fsp.stat(p), timeout, p)).isDirectory();
  } catch {
    return false;
  }
}

/** Mögliche Startpunkte für die Suche nach verlorenen Ordnern. */
async function searchRoots(missing, hints = []) {
  const roots = new Set();
  // Vorhandene Elternordner des verlorenen Pfads (bis zu 3 Ebenen nach oben)
  let p = path.dirname(missing);
  for (let i = 0; i < 6 && p && p !== path.dirname(p); i++) {
    if (await isDir(p)) {
      roots.add(p);
      const up = path.dirname(p);
      if (up !== p) roots.add(up);
      break;
    }
    p = path.dirname(p);
  }
  for (const h of hints) {
    if (!h) continue;
    roots.add(path.dirname(h));
    roots.add(path.dirname(path.dirname(h)));
  }
  const home = os.homedir();
  for (const sub of ['Pictures', 'Bilder', 'Desktop', 'Schreibtisch', 'Documents', 'Dokumente', '']) {
    roots.add(path.join(home, sub));
  }
  if (process.platform === 'win32') {
    for (let c = 67; c <= 90; c++) roots.add(String.fromCharCode(c) + ':\\');
  } else if (process.platform === 'darwin') {
    try {
      for (const v of await fsp.readdir('/Volumes')) roots.add(path.join('/Volumes', v));
    } catch {
      /* ignorieren */
    }
  } else {
    for (const b of ['/media', '/mnt']) roots.add(b);
  }
  const out = [];
  for (const r of roots) if (await isDir(r)) out.push(r);
  return out;
}

/**
 * Sucht Ordner mit gleichem Namen wie die verlorenen Ordner.
 * missing: [Pfade]  ->  { [pfad]: [Kandidaten] }
 */
async function findLostFolders(missing, { hints = [], maxDepth = 4, budgetMs = 12000 } = {}) {
  const deadline = Date.now() + budgetMs;
  const wanted = new Map(); // name(lower) -> [missing paths]
  for (const m of missing) {
    const n = path.basename(m).toLowerCase();
    if (!wanted.has(n)) wanted.set(n, []);
    wanted.get(n).push(m);
  }
  const result = Object.fromEntries(missing.map((m) => [m, []]));
  const seen = new Set();
  const roots = [];
  for (const m of missing) for (const r of await searchRoots(m, hints)) if (!roots.includes(r)) roots.push(r);

  const queue = roots.map((r) => [r, 0]);
  while (queue.length && Date.now() < deadline) {
    const [dir, depth] = queue.shift();
    const key = dir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let ents;
    try {
      ents = await withTimeout(fsp.readdir(dir, { withFileTypes: true }), 2000, dir);
    } catch {
      continue;
    }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      const lower = e.name.toLowerCase();
      if (e.name.startsWith('.') || SKIP_DIRS.has(lower)) continue;
      if (/^(windows|program files|program files \(x86\)|programdata|library|system|appdata|applications)$/i.test(e.name)) continue;
      const full = path.join(dir, e.name);
      if (wanted.has(lower)) {
        for (const m of wanted.get(lower)) {
          if (full !== m && !result[m].includes(full)) result[m].push(full);
        }
      }
      if (depth + 1 < maxDepth) queue.push([full, depth + 1]);
    }
  }
  // Kandidaten mit ähnlichem Elternpfad nach vorne sortieren
  for (const m of missing) {
    const parentName = path.basename(path.dirname(m)).toLowerCase();
    result[m].sort((a, b) => {
      const sa = path.basename(path.dirname(a)).toLowerCase() === parentName ? 0 : 1;
      const sb = path.basename(path.dirname(b)).toLowerCase() === parentName ? 0 : 1;
      return sa - sb || a.length - b.length;
    });
  }
  return result;
}

module.exports = { ReachMonitor, findLostFolders, STARTUP_CHECKS };
