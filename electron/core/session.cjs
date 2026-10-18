'use strict';
/**
 * Eine Sortier-Sitzung: kennt alle Einträge, führt Aufträge der Reihe nach
 * aus (Warteschlange) und merkt sich alles für "Rückgängig".
 *
 * Die Hauptprozess-Seite ist die einzige Quelle der Wahrheit dafür, wo eine
 * Datei gerade liegt. Die Oberfläche spricht nur über Eintrags-IDs.
 */
const EventEmitter = require('node:events');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { scan } = require('./scanner.cjs');
const { transferGroup, revertMoves, checkDir, FsOpError, safeUnlink } = require('./fsops.cjs');

class Session extends EventEmitter {
  constructor({ journalPath, timeout = 5000 } = {}) {
    super();
    this.journalPath = journalPath;
    this.timeout = timeout;
    this.items = new Map();
    this.history = new Map(); // opId -> { mode, entries }
    this.chain = Promise.resolve();
    this.pending = 0;
    this.pendingBytes = 0;
    this.nextId = 1;
    this.sourceDir = null;
    this.trashDir = null;
  }

  async open({ sourceDir, recursive = false, trashDir, onProgress }) {
    this.sourceDir = sourceDir;
    this.trashDir = trashDir || path.join(sourceDir, '_Gelöscht');
    this.items.clear();
    this.history.clear();
    const list = await scan(sourceDir, { recursive, exclude: [this.trashDir], onProgress });
    return list.map((it) => {
      const id = this.nextId++;
      this.items.set(id, {
        id,
        primary: it.path,
        sidecars: it.sidecars.slice(),
        live: it.live,
        size: it.size + (it.liveSize || 0),
      });
      return { ...it, id };
    });
  }

  journal(entry) {
    if (!this.journalPath) return;
    const line = JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n';
    fsp.appendFile(this.journalPath, line).catch(() => {});
  }

  /** Reiht eine Aufgabe in die Warteschlange ein (strikt nacheinander). */
  enqueue(bytes, task) {
    this.pending++;
    this.pendingBytes += bytes;
    const run = this.chain.then(task).finally(() => {
      this.pending--;
      this.pendingBytes -= bytes;
      if (this.pending === 0) this.emit('idle');
    });
    this.chain = run.catch(() => {});
    return run;
  }

  /** Wartet, bis alle Aufträge erledigt sind (für Tests und beim Beenden). */
  drain() {
    return this.chain;
  }

  /**
   * Überträgt Einträge.
   * action: 'move' | 'copy' | 'trash'
   * liveVideo: 'move' | 'trash' | 'keep' (was mit dem Video eines Live Photos geschieht)
   */
  transfer({ opId, itemIds, destDir, action, liveVideo = 'move' }) {
    const items = itemIds.map((id) => this.items.get(id)).filter(Boolean);
    const bytes = items.reduce((a, it) => a + (it.size || 0), 0);
    const target = action === 'trash' ? this.trashDir : destDir;
    return this.enqueue(bytes, async () => {
      const results = [];
      const entries = [];
      if (action === 'trash') {
        try {
          await fsp.mkdir(this.trashDir, { recursive: true });
        } catch {
          /* Fehlermeldung folgt über checkDir */
        }
      }
      const reach = await checkDir(target, this.timeout);
      if (!reach.ok) {
        for (const it of items) {
          results.push({ id: it.id, ok: false, error: 'EUNREACHABLE', detail: reach.code });
        }
        this.emit('opDone', { opId, kind: 'transfer', results, destDir: target });
        return results;
      }
      const mode = action === 'copy' ? 'copy' : 'move';
      let bytesDone = 0;
      for (const it of items) {
        const groups = [];
        try {
          const files = [it.primary, ...it.sidecars];
          let liveTo = null;
          if (it.live) {
            if (action === 'trash' || liveVideo === 'move') files.push(it.live);
            else if (liveVideo === 'trash' && mode === 'move') liveTo = 'trash';
          }
          const name = path.basename(it.primary);
          const plan = await transferGroup(files, target, {
            mode,
            timeout: this.timeout,
            onProgress: (d, t) =>
              this.emit('progress', {
                opId,
                name,
                fileDone: d,
                fileTotal: t,
                bytesDone: bytesDone + d,
                pending: this.pending,
                pendingBytes: this.pendingBytes,
              }),
          });
          groups.push({ moves: plan, mode });
          if (liveTo === 'trash') {
            await fsp.mkdir(this.trashDir, { recursive: true });
            const p2 = await transferGroup([it.live], this.trashDir, { mode: 'move', timeout: this.timeout });
            groups.push({ moves: p2, mode: 'move' });
          }
          this.applyMoves(it, groups);
          entries.push({ itemId: it.id, groups });
          bytesDone += it.size || 0;
          results.push({ id: it.id, ok: true, to: plan[0].to });
          this.journal({ op: action, opId, moves: groups.flatMap((g) => g.moves) });
        } catch (e) {
          // Teilweise erledigte Gruppen (nur möglich beim Live-Video) zurückdrehen
          for (const g of groups.reverse()) await revertMoves(g.moves, g.mode).catch(() => {});
          results.push({
            id: it.id,
            ok: false,
            error: e.code || 'EUNKNOWN',
            detail: (e.details && e.details.code) || e.message,
          });
          this.journal({ op: action, opId, error: e.code, file: it.primary });
        }
      }
      if (entries.length) this.history.set(opId, { action, mode, entries });
      this.emit('opDone', { opId, kind: 'transfer', results, destDir: target });
      return results;
    });
  }

  /** Aktualisiert die gespeicherten Pfade eines Eintrags nach einer Übertragung. */
  applyMoves(it, groups) {
    for (const g of groups) {
      if (g.mode !== 'move') continue;
      for (const m of g.moves) this.relocate(it, m.from, m.to);
    }
  }

  relocate(it, from, to) {
    if (it.primary === from) it.primary = to;
    else if (it.live === from) it.live = to;
    else {
      const i = it.sidecars.indexOf(from);
      if (i >= 0) it.sidecars[i] = to;
    }
  }

  /** Macht einen Auftrag rückgängig. */
  undo(opId) {
    return this.enqueue(0, async () => {
      const h = this.history.get(opId);
      const results = [];
      if (!h) {
        this.emit('opDone', { opId, kind: 'undo', results, missing: true });
        return results;
      }
      const failed = [];
      for (const entry of h.entries.slice().reverse()) {
        const it = this.items.get(entry.itemId);
        try {
          for (const g of entry.groups.slice().reverse()) {
            const restored = await revertMoves(g.moves, g.mode);
            if (g.mode === 'move') for (const r of restored) this.relocate(it, r.from, r.to);
          }
          results.push({ id: it.id, ok: true, path: it.primary, live: it.live });
          this.journal({ op: 'undo', opId, item: it.primary });
        } catch (e) {
          failed.push(entry);
          results.push({ id: it.id, ok: false, error: e.code || 'EUNKNOWN', detail: e.message });
        }
      }
      if (failed.length) this.history.set(opId, { ...h, entries: failed });
      else this.history.delete(opId);
      this.emit('opDone', { opId, kind: 'undo', results });
      return results;
    });
  }

  /** Inhalt des Löschordners auflisten. */
  async trashInfo() {
    let count = 0;
    let bytes = 0;
    const walk = async (dir) => {
      let ents;
      try {
        ents = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of ents) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else {
          count++;
          try {
            bytes += (await fsp.stat(p)).size;
          } catch {
            /* ignorieren */
          }
        }
      }
    };
    await walk(this.trashDir);
    return { dir: this.trashDir, count, bytes };
  }

  /** Löschordner endgültig leeren. Rückgängig ist danach für diese Dateien nicht mehr möglich. */
  emptyTrash() {
    return this.enqueue(0, async () => {
      const trash = this.trashDir;
      if (!trash) throw new FsOpError('NOTRASH', 'Kein Löschordner');
      let removed = 0;
      const walk = async (dir) => {
        let ents;
        try {
          ents = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of ents) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) {
            await walk(p);
            await fsp.rmdir(p).catch(() => {});
          } else {
            await safeUnlink(p);
            removed++;
          }
        }
      };
      await walk(trash);
      // Rückgängig-Einträge, die in den Löschordner zeigen, sind nun ungültig.
      const pruned = [];
      const inTrash = (p) => path.resolve(p).startsWith(path.resolve(trash) + path.sep);
      for (const [opId, h] of this.history) {
        if (h.entries.some((e) => e.groups.some((g) => g.moves.some((m) => inTrash(m.to))))) {
          this.history.delete(opId);
          pruned.push(opId);
        }
      }
      this.journal({ op: 'emptyTrash', dir: trash, removed });
      return { removed, pruned };
    });
  }
}

module.exports = { Session };
