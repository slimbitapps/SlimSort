'use strict';
/**
 * E2E-Test: Veraltetes Helfer-Programm (ohne Gesichtserkennung, wie bei Installationen von vor der
 * Gesichtserkennung) wird erkannt, automatisch neu geladen – danach werden die Gesichter gefunden.
 * Braucht Internet (lädt den Helfer von GitHub).
 *
 * Früher: E2E-Test für Personen: Gesichter finden, „Wer ist das?“ für Personen, die öfter vorkommen,
 * „ich bin ganz links, mein Bruder daneben, meine Mutter ganz rechts“ – und auf einem Foto mit
 * ANDERER Reihenfolge werden alle richtig erkannt (Gesicht, nicht Position). Fotos mit einer Person,
 * Personen-Regel → Ordner-Vorschlag, Namen im Foto, Personen-Dialog, Chat-Verlauf, KI-Wissen
 * exportieren, Ausschalten löscht die Gesichter.
 *
 *   FOTOSORT_AI_FILE=…/slimsort-ki-1.safetensors FOTOSORT_FACES_DIR=…(Gesichtsmodelle)
 *   FOTOSORT_HELPER=…/slimsort-llm FOTOSORT_FACES_PICS=…(g1.jpg, g2.jpg, solo.jpg)
 *   xvfb-run -a node test/e2e/faces.cjs [screenshot-ordner]
 *
 * g1 = Personen A, B, C (von links); g2 = C, A, B; solo = nur B.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const { launch, sleep } = require('./driver.cjs');

const ROOT = path.join(__dirname, '..', '..');
const SHOTS = process.argv[2] || path.join(os.tmpdir(), 'slimsort-faces-shots');
const { FOTOSORT_AI_FILE: MODEL, FOTOSORT_FACES_DIR: FACES, FOTOSORT_FACES_PICS: PICS } = process.env;
if (![MODEL, FACES, PICS].every((p) => p && fs.existsSync(p))) {
  console.log('FOTOSORT_AI_FILE/FOTOSORT_FACES_DIR/FOTOSORT_FACES_PICS fehlen – Helfer-Test übersprungen');
  process.exit(0);
}
fs.mkdirSync(SHOTS, { recursive: true });
async function waitFor(fn, ms = 8000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await sleep(150);
  }
  throw new Error('Zeitüberschreitung: ' + label);
}

(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'slimsort-helper-'));
  const src = path.join(base, 'Import');
  const userData = path.join(base, 'userdata');
  const ki = path.join(userData, 'ki');
  for (const d of [src, ki, path.join(base, 'xdg')]) fs.mkdirSync(d, { recursive: true });
  for (const n of ['g1.jpg', 'solo.jpg']) fs.copyFileSync(path.join(PICS, n), path.join(src, n));
  fs.copyFileSync(MODEL, path.join(ki, 'slimsort-ki-1.safetensors'));
  for (const f of ['slimsort-face-detect.onnx', 'slimsort-face-embed.onnx']) fs.copyFileSync(path.join(FACES, f), path.join(ki, f));
  // alter Helfer: kennt --faces nicht (gibt nur die Aufruf-Hilfe aus) und hat keine Prüfsummen-Datei
  const helper = path.join(ki, `slimsort-llm-linux-${process.arch === 'x64' ? 'x86_64' : 'aarch64'}`);
  fs.writeFileSync(helper, '#!/bin/sh\necho "Aufruf: slimsort-llm --model datei.gguf" >&2\nexit 2\n');
  fs.chmodSync(helper, 0o755);
  fs.writeFileSync(
    path.join(userData, 'einstellungen.json'),
    JSON.stringify({
      version: 1, onboarded: true, tutorialDone: true,
      prefs: { theme: 'dark', lang: 'de', mode: 'expert', activeProfileId: 'p1', seriesEnabled: false, updateCheck: false, aiEnabled: true, aiTier: 'eco', aiFaces: true, aiLearnFolders: false },
      profiles: [{ id: 'p1', name: 'Ordner', groups: [], targets: [{ id: 't1', name: 'Familie', path: path.join(base, 'Familie'), key: '1', color: '#e5484d' }] }],
      quickStarts: [{ id: 'q1', name: 'Import', source: src, sources: [src], profileId: 'p1', trashDir: null, startView: 'single', recursive: false, fullscreen: false, lastUsed: 1 }],
      recentSources: [],
    })
  );
  const app = await launch({
    app: process.env.FOTOSORT_EXE || path.join(ROOT, 'src-tauri', 'target', 'debug', 'slimsort'),
    env: { FOTOSORT_TEST: '1', FOTOSORT_USERDATA: userData, XDG_DATA_HOME: path.join(base, 'xdg'), LANG: 'de_DE.UTF-8', WEBKIT_DISABLE_DMABUF_RENDERER: '1' },
  });
  globalThis.__app = app;
  const win = app.page;
  const status = () => win.evaluate(() => window.api.ai.status());
  await win.waitForSelector('[data-testid="home"]');
  await win.keyboard.press('1');
  await win.waitForSelector('[data-testid="session"]');
  // erkennt den alten Helfer und lädt den neuen von selbst
  await waitFor(async () => fs.existsSync(helper + '.sha256'), 300000, 'neuer Helfer geladen');
  console.log('Alter Helfer erkannt und ersetzt ✔', fs.statSync(helper).size, 'Bytes');
  await waitFor(async () => {
    const s = await status();
    return s.facesReady && !s.helperOld && s.faceTotal >= 4;
  }, 240000, 'Gesichter gefunden').catch(async (e) => {
    console.log(JSON.stringify(await status()));
    throw e;
  });
  console.log('Gesichter danach gefunden ✔', (await status()).faceTotal);
  await app.close();
  console.log('HELFER-UPDATE-E2E OK');
  fs.rmSync(base, { recursive: true, force: true });
  process.exit(0);
})().catch(async (e) => {
  console.error('HELFER-UPDATE-E2E FEHLER:', e);
  await globalThis.__app?.close().catch(() => {});
  process.exit(1);
});
