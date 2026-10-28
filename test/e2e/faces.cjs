'use strict';
/**
 * E2E-Test für Personen: Gesichter finden, „Wer ist das?“ für Personen, die öfter vorkommen,
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
const { FOTOSORT_AI_FILE: MODEL, FOTOSORT_FACES_DIR: FACES, FOTOSORT_HELPER: HELPER, FOTOSORT_FACES_PICS: PICS } = process.env;
if (![MODEL, FACES, HELPER, PICS].every((p) => p && fs.existsSync(p))) {
  console.log('FOTOSORT_AI_FILE/FOTOSORT_FACES_DIR/FOTOSORT_HELPER/FOTOSORT_FACES_PICS fehlen – Gesichter-Test übersprungen');
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
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'slimsort-faces-'));
  const src = path.join(base, 'Import');
  const fam = path.join(base, 'Familie');
  const rest = path.join(base, 'Sonstiges');
  const userData = path.join(base, 'userdata');
  const ki = path.join(userData, 'ki');
  for (const d of [src, fam, rest, ki, path.join(base, 'xdg')]) fs.mkdirSync(d, { recursive: true });
  ['g1.jpg', 'g2.jpg', 'solo.jpg'].forEach((n, i) => {
    fs.copyFileSync(path.join(PICS, n), path.join(src, n));
    fs.utimesSync(path.join(src, n), 1e9 + i * 60, 1e9 + i * 60); // Reihenfolge g1, g2, solo
  });

  // KI ist schon „heruntergeladen“: Bildmodell, Gesichtsmodelle und Helfer liegen bereit
  fs.copyFileSync(MODEL, path.join(ki, 'slimsort-ki-1.safetensors'));
  for (const f of ['slimsort-face-detect.onnx', 'slimsort-face-embed.onnx']) fs.copyFileSync(path.join(FACES, f), path.join(ki, f));
  const helper = path.join(ki, `slimsort-llm-linux-${process.arch === 'x64' ? 'x86_64' : 'aarch64'}`);
  fs.copyFileSync(HELPER, helper);
  fs.chmodSync(helper, 0o755);

  fs.writeFileSync(
    path.join(userData, 'einstellungen.json'),
    JSON.stringify({
      version: 1,
      onboarded: true,
      tutorialDone: true,
      prefs: { theme: 'dark', lang: 'de', mode: 'expert', activeProfileId: 'p1', seriesEnabled: false, updateCheck: false, aiEnabled: true, aiTier: 'eco', aiFaces: true, aiLearnFolders: false },
      profiles: [{ id: 'p1', name: 'Meine Ordner', groups: [], targets: [
        { id: 't1', name: 'Familie', path: fam, key: '1', color: '#e5484d' },
        { id: 't2', name: 'Sonstiges', path: rest, key: '2', color: '#3e63dd' },
      ] }],
      quickStarts: [{ id: 'q1', name: 'Import', source: src, sources: [src], profileId: 'p1', trashDir: null, startView: 'single', recursive: false, fullscreen: false, lastUsed: 1 }],
      recentSources: [],
    })
  );
  const exportFile = path.join(base, 'wissen.slimsort-ki');

  const app = await launch({
    app: process.env.FOTOSORT_EXE || path.join(ROOT, 'src-tauri', 'target', 'debug', 'slimsort'),
    env: {
      FOTOSORT_TEST: '1', FOTOSORT_USERDATA: userData, XDG_DATA_HOME: path.join(base, 'xdg'), LANG: 'de_DE.UTF-8', WEBKIT_DISABLE_DMABUF_RENDERER: '1',
      FOTOSORT_SAVE: exportFile,
    },
  });
  globalThis.__app = app;
  const win = app.page;
  const shot = async (name) => {
    await sleep(300);
    await win.screenshot({ path: path.join(SHOTS, name + '.png') });
  };
  const status = () => win.evaluate(() => window.api.ai.status());
  const chatText = () => win.evaluate(() => document.querySelector('[data-testid="chat"]')?.textContent || '');
  const chatHas = (re, ms = 20000) =>
    waitFor(async () => re.test(await chatText()), ms, String(re)).catch(async (e) => {
      console.log('Chat:', (await chatText()).slice(-700));
      throw e;
    });
  const say = async (text) => {
    await win.fill('[data-testid="chat-input"]', text);
    await win.keyboard.press('Enter');
  };
  const saved = () => JSON.parse(fs.readFileSync(path.join(userData, 'einstellungen.json'), 'utf8'));
  const tags = () => win.evaluate(() => [...document.querySelectorAll('[data-testid="face-tag"]')].map((e) => e.textContent));
  const next = async () => {
    await win.evaluate(() => document.activeElement && document.activeElement.blur()); // Pfeiltasten nicht ins Chatfeld
    await win.keyboard.press('ArrowRight');
    await sleep(600);
  };

  await win.waitForSelector('[data-testid="home"]');
  await win.keyboard.press('1');
  await win.waitForSelector('[data-testid="session"]');
  await waitFor(async () => {
    const s = await status();
    return s.installed && s.faces && s.indexed === 3 && s.faceTotal >= 7;
  }, 240000, 'Gesichter gefunden');
  console.log('Gesichter gefunden ✔', (await status()).faceTotal);

  // ---------------------------------------------------------------- „Wer ist das?“ für Personen auf mehreren Fotos
  await win.click('[data-testid="chat-toggle"]');
  await win.waitForSelector('[data-testid="chat-input"]');
  await say('Wer sind die unbekannten Personen?');
  await chatHas(/Wer ist das\? \(auf 3 Fotos\)/);
  await waitFor(() => win.evaluate(() => document.querySelectorAll('[data-testid="chat-faces"] img').length >= 1), 10000, 'Gesichtsbilder im Chat');
  await shot('01-who-is-this');
  await say('mein Bruder');
  await chatHas(/Gemerkt: Das ist Bruder \(auf 3 Fotos\)/);
  await say('Später');
  console.log('Wer ist das? ✔');

  // ---------------------------------------------------------------- Personen mit Position benennen (g1: A, B, C)
  await say('Merke dir diese Personen, ich bin ganz links mein Bruder ist daneben und meine Mutter ist ganz rechts');
  await chatHas(/Gemerkt: links du, in der Mitte Bruder, rechts Mutter/);
  await waitFor(() => (saved().people || []).length === 3, 5000, 'drei Personen gespeichert');
  const ppl = saved().people;
  assert.ok(ppl.some((p) => p.me), 'ich');
  assert.ok(ppl.some((p) => p.name === 'Bruder') && ppl.some((p) => p.name === 'Mutter'));
  await waitFor(async () => (await tags()).join('|') === 'du|Bruder|Mutter', 10000, 'Namen im Foto g1');
  await shot('02-named');
  console.log('Benannt ✔', (await tags()).join(', '));

  // ---------------------------------------------------------------- g2: andere Reihenfolge (C, A, B) → Gesichter zählen, nicht Positionen
  await next();
  await waitFor(async () => (await tags()).join('|') === 'Mutter|du|Bruder', 15000, 'Namen im Foto g2').catch(async (e) => {
    console.log('Namen g2:', await tags());
    throw e;
  });
  await say('Wer ist auf diesem Foto?');
  await chatHas(/Auf dem Foto erkenne ich: links: Mutter, in der Mitte: du, rechts: Bruder/);
  await shot('03-other-order');
  console.log('Andere Reihenfolge richtig erkannt ✔');

  // ---------------------------------------------------------------- Fotos mit einer Person
  await say('Zeige Fotos mit meinem Bruder');
  await chatHas(/3 Fotos mit Bruder gefunden/);
  await say('Fotos mit meiner Mutter');
  await chatHas(/2 Fotos mit Mutter gefunden/);
  console.log('Fotos mit Person ✔');

  // ---------------------------------------------------------------- Regel: Person → Ordner (Vorschlag im Dock)
  await say('Fotos mit meiner Mutter sollen immer in den Ordner Familie');
  await chatHas(/Fotos mit Mutter schlage ich ab jetzt für „Familie“ vor/);
  await win.waitForFunction(() => {
    const el = document.querySelector('[data-testid="target"][data-name="Familie"] .sugg');
    return el && /Gemerkt: Mutter/.test(el.textContent || '');
  }, null, { timeout: 20000 });
  console.log('Personen-Regel → Vorschlag ✔');

  // ---------------------------------------------------------------- Gesicht benennen per Klick (solo = Bruder → "Lukas")
  await next();
  await waitFor(async () => (await tags()).join('|') === 'Bruder', 15000, 'Bruder auf solo');
  await win.evaluate(() => document.querySelector('[data-testid="face-box"]').click());
  await win.waitForSelector('[data-testid="face-name-input"]');
  await win.fill('[data-testid="face-name-input"]', 'Lukas');
  await win.click('[data-testid="face-name-ok"]');
  await waitFor(async () => (await tags()).join('|') === 'Lukas', 10000, 'umbenannt per Klick');
  await waitFor(() => saved().people.some((p) => p.name === 'Lukas'), 5000, 'neue Person Lukas gespeichert');
  console.log('Per Klick benannt ✔');

  // ---------------------------------------------------------------- Personen-Dialog
  await win.click('[data-testid="menu-btn"]');
  await win.click('[data-testid="menu-people"]');
  await win.waitForSelector('[data-testid="people-dialog"]');
  await waitFor(() => win.evaluate(() => document.querySelectorAll('[data-testid="person-card"]').length === 4), 5000, 'Personen-Karten');
  await shot('04-people');
  await win.keyboard.press('Escape');
  console.log('Personen-Dialog ✔');

  // ---------------------------------------------------------------- KI-Wissen exportieren
  await win.click('[data-testid="menu-btn"]');
  await win.click('text=Einstellungen');
  await win.click('[data-testid="settings-ai"]');
  await win.click('[data-testid="know-export"]');
  await waitFor(() => fs.existsSync(exportFile) && fs.statSync(exportFile).size > 0, 10000, 'Export-Datei');
  await sleep(300);
  const ex = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
  assert.equal(ex.slimsortKi, 1);
  assert.equal(ex.people.length, 4);
  assert.ok(ex.memories.some((m) => m.kind === 'people'));
  assert.ok(ex.chats.length >= 1, 'Chat im Export');
  console.log('KI-Wissen exportiert ✔', Math.round(fs.statSync(exportFile).size / 1024), 'KB');
  await win.keyboard.press('Escape');

  // ---------------------------------------------------------------- Chat-Verlauf: neuer Chat, alter bleibt
  await win.click('[data-testid="chat-new"]');
  await waitFor(async () => !/Mutter/.test(await chatText()), 5000, 'neuer Chat leer');
  await win.click('[data-testid="chat-history-btn"]');
  await win.waitForSelector('[data-testid="chat-history-item"]');
  await shot('05-history');
  await win.evaluate(() => document.querySelector('[data-testid="chat-history-item"] button').click());
  await chatHas(/Fotos mit Mutter schlage ich ab jetzt/);
  await waitFor(() => fs.existsSync(path.join(userData, 'chats.json')), 5000, 'chats.json');
  console.log('Chat-Verlauf ✔');

  // ---------------------------------------------------------------- Ausschalten löscht Gesichter
  await win.click('[data-testid="menu-btn"]');
  await win.click('text=Einstellungen');
  await win.click('[data-testid="settings-ai"]');
  await win.click('[data-testid="ai-faces"] button');
  await waitFor(async () => !(await status()).faces, 5000, 'Gesichter aus');
  assert.ok(!fs.existsSync(path.join(ki, 'gesichter-2.bin')), 'gespeicherte Gesichter gelöscht');
  console.log('Ausschalten löscht Gesichter ✔');

  const errs = fs.readFileSync(path.join(userData, 'app.log'), 'utf8').split('\n').filter((l) => /renderer .*(error|unhandled)/i.test(l));
  assert.deepEqual(errs, [], 'keine Fehler in der Oberfläche');
  await app.close();
  console.log('GESICHTER-E2E OK');
  fs.rmSync(base, { recursive: true, force: true });
  process.exit(0);
})().catch(async (e) => {
  console.error('GESICHTER-E2E FEHLER:', e);
  await globalThis.__app?.close().catch(() => {});
  process.exit(1);
});
