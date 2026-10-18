'use strict';
// Wandelt HEIC in JPEG um – in einem eigenen Thread, damit die App flüssig bleibt.
const { parentPort } = require('node:worker_threads');
const fsp = require('node:fs/promises');
const convert = require('heic-convert');

parentPort.on('message', async ({ id, file }) => {
  try {
    const buffer = await fsp.readFile(file);
    const out = await convert({ buffer, format: 'JPEG', quality: 0.88 });
    parentPort.postMessage({ id, ok: true, data: Buffer.from(out) });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: String(e && e.message) });
  }
});
