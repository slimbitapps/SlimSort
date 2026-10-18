'use strict';
/** Einstellungen als JSON-Datei im Benutzerordner der App (bleibt lokal). */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

class SettingsStore {
  constructor(file) {
    this.file = file;
    this.data = {};
    this.writing = Promise.resolve();
  }

  load() {
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      // Beschädigte Datei? Sicherung versuchen.
      try {
        this.data = JSON.parse(fs.readFileSync(this.file + '.bak', 'utf8'));
      } catch {
        this.data = {};
      }
    }
    return this.data;
  }

  save(data) {
    this.data = data;
    const json = JSON.stringify(data, null, 2);
    this.writing = this.writing.then(async () => {
      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      await fsp.writeFile(tmp, json);
      await fsp.copyFile(this.file, this.file + '.bak').catch(() => {});
      await fsp.rename(tmp, this.file);
    }).catch(() => {});
    return this.writing;
  }
}

module.exports = { SettingsStore };
