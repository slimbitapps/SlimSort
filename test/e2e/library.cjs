'use strict';
/**
 * E2E-Test für freigegebene Ordner + KI-Verlauf: ein Fotoarchiv mit Unterordnern wird freigegeben,
 * die KI lernt jedes Foto darin, schlägt dann einen Unterordner vor, der unten gar nicht als Ziel steht
 * (Umschalt+Enter verschiebt), verschiebt per Chat in einen Unterordner, legt dort einen Ordner an.
 * Im KI-Verlauf steht alles gebündelt und lässt sich je Foto zurücknehmen.
 *
 *   FOTOSORT_AI_FILE=…/slimsort-ki-1.safetensors FOTOSORT_AI_PICS=…(Beispielfotos mit rocket.jpg, cat.jpg …)
 *   xvfb-run -a node test/e2e/library.cjs [screenshot-ordner]
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { launch, sleep } = require('./driver.cjs');

const ROOT = path.join(__dirname, '..', '..');
const SHOTS = process.argv[2] || path.join(os.tmpdir(), 'slimsort-library-shots');
const { FOTOSORT_AI_FILE: MODEL, FOTOSORT_AI_PICS: PICS } = process.env;
const NEED = ['rocket.jpg', 'astronaut.jpg', 'moon.jpg', 'hubble_deep_field.jpg', 'cat.jpg', 'chelsea.jpg', 'coffee.jpg', 'clock.jpg'];
if (![MODEL, PICS].every((p) => p && fs.existsSync(p)) || !NEED.every((f) => fs.existsSync(path.join(PICS || '', f)))) {
  console.log('FOTOSORT_AI_FILE/FOTOSORT_AI_PICS fehlen – Bibliothek-Test übersprungen');
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

/** veränderte Kopie (anderer Ausschnitt, Farben), damit es nicht dasselbe Bild ist */
function variant(from, to, k) {
  execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageEnhance
im = Image.open(sys.argv[1]).convert('RGB')
k = float(sys.argv[3])
w, h = im.size
im = im.crop((int(w * .04 * k), int(h * .03 * k), w - int(w * .05 * k), h)).resize((int(w * .7), int(h * .7)))
im = ImageEnhance.Color(im).enhance(1 + .1 * k)
im.save(sys.argv[2], quality=88)
`, from, to, String(k)]);
}

(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'slimsort-library-'));
  const src = path.join(base, 'Import');
  const other = path.join(base, 'Sonstiges');
  const archive = path.join(base, 'Archiv');
  const rockets = path.join(archive, 'Weltall', 'Raketen');
  const sky = path.join(archive, 'Weltall', 'Himmel');
  const cats = path.join(archive, 'Tiere', 'Katzen');
  const kitchen = path.join(archive, 'Küche');
  const userData = path.join(base, 'userdata');
  const ki = path.join(userData, 'ki');
  for (const d of [src, other, rockets, sky, cats, kitchen, ki, path.join(base, 'xdg')]) fs.mkdirSync(d, { recursive: true });
  // Archiv: je Unterordner einige Beispiele
  const put = (dir, f, k) => variant(path.join(PICS, f), path.join(dir, `${path.parse(f).name}-${k}.jpg`), k);
  for (const k of [1, 2, 3]) {
    put(rockets, 'rocket.jpg', k);
    put(cats, 'cat.jpg', k);
    put(cats, 'chelsea.jpg', k);
    put(kitchen, 'coffee.jpg', k);
    put(kitchen, 'clock.jpg', k);
  }
  put(rockets, 'astronaut.jpg', 1);
  put(sky, 'moon.jpg', 1);
  put(sky, 'hubble_deep_field.jpg', 1);
  // Import: eine neue Rakete, eine neue Katze
  variant(path.join(PICS, 'rocket.jpg'), path.join(src, 'a-rakete.jpg'), 5);
  variant(path.join(PICS, 'chelsea.jpg'), path.join(src, 'b-katze.jpg'), 5);
  variant(path.join(PICS, 'coffee.jpg'), path.join(src, 'c-kaffee.jpg'), 5);
  fs.readdirSync(src).sort().forEach((n, i) => fs.utimesSync(path.join(src, n), 1e9 + i * 60, 1e9 + i * 60));
  fs.copyFileSync(MODEL, path.join(ki, 'slimsort-ki-1.safetensors'));
  const archived = () => fs.readdirSync(archive, { recursive: true }).filter((f) => f.endsWith('.jpg')).length;
  const learnTotal = archived();

  fs.writeFileSync(
    path.join(userData, 'einstellungen.json'),
    JSON.stringify({
      version: 1,
      onboarded: true,
      tutorialDone: true,
      prefs: { theme: 'dark', lang: 'de', mode: 'expert', activeProfileId: 'p1', seriesEnabled: false, updateCheck: false, aiEnabled: true, aiTier: 'eco', aiLearnFolders: false, aiAllowFolders: true, sortBy: 'name' },
      profiles: [{ id: 'p1', name: 'Meine Ordner', groups: [], targets: [{ id: 't1', name: 'Sonstiges', path: other, key: '1', color: '#e5484d' }] }],
      quickStarts: [{ id: 'q1', name: 'Import', source: src, sources: [src], profileId: 'p1', trashDir: null, startView: 'single', recursive: false, fullscreen: false, lastUsed: 1 }],
      recentSources: [],
    })
  );

  const app = await launch({
    app: process.env.FOTOSORT_EXE || path.join(ROOT, 'src-tauri', 'target', 'debug', 'slimsort'),
    env: { FOTOSORT_TEST: '1', FOTOSORT_USERDATA: userData, FOTOSORT_PICK: archive, XDG_DATA_HOME: path.join(base, 'xdg'), LANG: 'de_DE.UTF-8', WEBKIT_DISABLE_DMABUF_RENDERER: '1' },
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
  const current = () => win.evaluate(() => document.querySelector('[data-testid="single-info"] .ellipsis')?.textContent);
  const blur = () => win.evaluate(() => document.activeElement && document.activeElement.blur());

  await win.waitForSelector('[data-testid="home"]');

  // ---------------------------------------------------------------- Ordner freigeben (Einstellungen)
  await win.click('[data-testid="settings-btn"]');
  await win.click('[data-testid="settings-ai"]');
  await win.waitForSelector('[data-testid="lib-add"]');
  await win.click('[data-testid="lib-add"]');
  await waitFor(() => (saved().prefs.aiLibrary || []).includes(archive), 5000, 'Ordner freigegeben');
  await waitFor(() => win.evaluate(() => /7 Ordner · 18 Fotos/.test(document.querySelector('[data-testid="lib-stats"]')?.textContent || '')), 10000, 'Unterordner gezählt');
  await shot('01-library');
  await win.keyboard.press('Escape');
  console.log('Ordner freigegeben ✔');

  await win.keyboard.press('1');
  await win.waitForSelector('[data-testid="session"]');
  const total = fs.readdirSync(src).length;
  await waitFor(async () => {
    const s = await status();
    return s.installed && s.indexed >= total && !s.learning && s.examples >= learnTotal;
  }, 300000, 'Analyse + Lernen');
  const st = await status();
  assert.ok(st.examples >= learnTotal, `jedes Archiv-Foto gelernt (${st.examples} von ${learnTotal})`);
  console.log('Alle Archiv-Fotos gelernt ✔', st.examples);

  // ---------------------------------------------------------------- Vorschlag in einen Unterordner, der unten nicht steht
  assert.equal(await current(), 'a-rakete.jpg');
  await waitFor(() => win.evaluate(() => /Raketen/.test(document.querySelector('[data-testid="lib-sugg"]')?.textContent || '')), 20000, 'Vorschlag Weltall › Raketen');
  await shot('02-suggestion');
  await blur();
  await win.keyboard.press('Shift+Enter');
  await waitFor(() => fs.existsSync(path.join(rockets, 'a-rakete.jpg')), 10000, 'in Raketen verschoben');
  console.log('Vorschlag → Unterordner ✔');

  // ---------------------------------------------------------------- Chat: in Unterordner verschieben, Ordner anlegen
  await waitFor(async () => (await current()) === 'b-katze.jpg', 5000, 'Katze offen');
  await win.click('[data-testid="chat-toggle"]');
  await win.waitForSelector('[data-testid="chat-input"]');
  await say('Verschiebe dieses Foto nach Katzen');
  await waitFor(() => fs.existsSync(path.join(cats, 'b-katze.jpg')), 15000, 'per Chat nach Katzen');
  await say('Lege in Weltall einen Ordner Mond an');
  await waitFor(() => fs.existsSync(path.join(archive, 'Weltall', 'Mond')), 15000, 'Ordner Weltall/Mond angelegt');
  assert.ok(!saved().profiles[0].targets.some((x) => x.name === 'Mond'), 'kein neuer Zielordner unten');
  console.log('Chat: verschieben + Ordner anlegen ✔');

  // ---------------------------------------------------------------- KI-Verlauf: gebündelt, je Foto zurück
  await win.click('[data-testid="ailog-open"]');
  await win.waitForSelector('[data-testid="ailog-dialog"]');
  await waitFor(() => win.evaluate(() => document.querySelectorAll('[data-testid="ailog-entry"]').length >= 3), 5000, 'drei Einträge');
  const titles = await win.evaluate(() => [...document.querySelectorAll('[data-testid="ailog-entry"] .log-title')].map((e) => e.textContent));
  console.log('Verlauf:', titles.join(' | '));
  assert.ok(titles.some((x) => /Mond/.test(x)) && titles.some((x) => /Katzen/.test(x)) && titles.some((x) => /Raketen/.test(x)));
  // Katzen-Eintrag aufklappen, das Foto einzeln zurücknehmen
  const idx = titles.findIndex((x) => /Katzen/.test(x));
  await win.evaluate((i) => document.querySelectorAll('[data-testid="ailog-entry"]')[i].querySelector('[data-testid="ailog-expand"]').click(), idx);
  await win.waitForSelector('[data-testid="ailog-photo"]');
  await shot('03-log');
  await win.evaluate(() => document.querySelector('[data-testid="ailog-undo-photo"]').click());
  await waitFor(() => fs.existsSync(path.join(src, 'b-katze.jpg')), 10000, 'Katze zurück im Import');
  assert.ok(fs.existsSync(path.join(rockets, 'a-rakete.jpg')), 'Rakete bleibt');
  // Ordner anlegen zurücknehmen (leer → wird gelöscht)
  const mi = titles.findIndex((x) => /Mond/.test(x));
  await win.evaluate((i) => document.querySelectorAll('[data-testid="ailog-entry"]')[i].querySelector('[data-testid="ailog-undo"]').click(), mi);
  await waitFor(() => !fs.existsSync(path.join(archive, 'Weltall', 'Mond')), 10000, 'Ordner Mond entfernt');
  await shot('04-log-undone');
  await win.keyboard.press('Escape');
  console.log('KI-Verlauf: je Foto + Ordner zurück ✔');

  // ---------------------------------------------------------------- Dateisystem-Recht „nur Zielordner“
  await win.evaluate(() => [...document.querySelectorAll('[data-testid="chat-close"]')].forEach((b) => b.click()));
  await win.click('[data-testid="menu-btn"]');
  await win.click('[data-testid="menu-settings"]');
  await win.click('[data-testid="settings-ai"]');
  await win.evaluate(() => [...document.querySelectorAll('[data-testid="fs-scope"] button')].find((b) => /Nur Zielordner/.test(b.textContent)).click());
  await waitFor(() => saved().prefs.aiFsScope === 'off', 5000, 'Recht gespeichert');
  await win.keyboard.press('Escape');
  await waitFor(async () => (await current()) === 'b-katze.jpg', 5000, 'Katze wieder offen');
  await win.click('[data-testid="chat-toggle"]');
  await win.waitForSelector('[data-testid="chat-input"]');
  await say('Verschiebe dieses Foto nach Katzen');
  await chatHas(/keine Ordner außerhalb/);
  assert.ok(fs.existsSync(path.join(src, 'b-katze.jpg')), 'nichts verschoben');
  console.log('Dateisystem-Recht ✔');

  const errs = fs.readFileSync(path.join(userData, 'app.log'), 'utf8').split('\n').filter((l) => /renderer .*(error|unhandled)/i.test(l));
  assert.deepEqual(errs, [], 'keine Fehler in der Oberfläche');
  await app.close();
  console.log('BIBLIOTHEK-E2E OK');
  fs.rmSync(base, { recursive: true, force: true });
  process.exit(0);
})().catch(async (e) => {
  console.error('BIBLIOTHEK-E2E FEHLER:', e);
  await globalThis.__app?.close().catch(() => {});
  process.exit(1);
});
