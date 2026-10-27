'use strict';
/**
 * E2E-Test für die KI: ausgeschaltet läuft nichts, Modell herunterladen (von einem lokalen
 * Server), Fotos analysieren, aus Zielordnern lernen, Vorschlag im Dock, Chat-Suche
 * ("ein blaues Bild"), Verschieben per Chat, "KI sortieren", wieder ausschalten.
 *
 *   FOTOSORT_AI_FILE=…/slimsort-ki-1.safetensors xvfb-run -a node test/e2e/ai.cjs [screenshot-ordner]
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { launch, sleep } = require('./driver.cjs');

const ROOT = path.join(__dirname, '..', '..');
const SHOTS = process.argv[2] || path.join(os.tmpdir(), 'slimsort-ai-shots');
const MODEL = process.env.FOTOSORT_AI_FILE;
if (!MODEL || !fs.existsSync(MODEL)) {
  console.log('FOTOSORT_AI_FILE fehlt – KI-Test übersprungen');
  process.exit(0);
}
fs.mkdirSync(SHOTS, { recursive: true });
const exists = (p) => fs.existsSync(p);
const ls = (d) => (exists(d) ? fs.readdirSync(d).filter((n) => !n.startsWith('.')).sort() : []);
async function waitFor(fn, ms = 8000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await sleep(150);
  }
  throw new Error('Zeitüberschreitung: ' + label);
}

/** Bilder: rot- und blautönige Flächen mit Formen (wie einfache "Motive") */
function makeImages(dir, spec) {
  fs.mkdirSync(dir, { recursive: true });
  const py = `
import random, sys, json, os
from PIL import Image, ImageDraw
spec = json.loads(sys.argv[2])
for name, col in spec:
    r = random.Random(name)
    base = {'red': (205, 35, 40), 'blue': (30, 70, 210), 'green': (40, 160, 60)}[col]
    im = Image.new('RGB', (640, 480), base)
    d = ImageDraw.Draw(im)
    for _ in range(14):
        x, y, s = r.randint(0, 600), r.randint(0, 440), r.randint(20, 120)
        c = tuple(max(0, min(255, v + r.randint(-60, 60))) for v in base)
        d.ellipse([x, y, x + s, y + s], fill=c)
    im.save(os.path.join(sys.argv[1], name), quality=90)
`;
  execFileSync('python3', ['-c', py, dir, JSON.stringify(spec)]);
}

(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'slimsort-ai-'));
  const src = path.join(base, 'Import');
  const rot = path.join(base, 'Rot');
  const blau = path.join(base, 'Blau');
  const userData = path.join(base, 'userdata');
  const xdg = path.join(base, 'xdg');
  for (const d of [userData, xdg]) fs.mkdirSync(d, { recursive: true });
  const cols = ['red', 'blue', 'red', 'blue', 'green', 'red', 'blue', 'red', 'blue', 'red', 'blue', 'green'];
  const spec = cols.map((c, i) => [`IMG_${String(i + 1).padStart(3, '0')}.JPG`, c]);
  const color = Object.fromEntries(spec);
  makeImages(src, spec);
  // Zielordner haben schon Fotos → die KI lernt daraus
  makeImages(rot, [['alt_r1.jpg', 'red'], ['alt_r2.jpg', 'red'], ['alt_r3.jpg', 'red']]);
  makeImages(blau, [['alt_b1.jpg', 'blue'], ['alt_b2.jpg', 'blue'], ['alt_b3.jpg', 'blue']]);
  fs.writeFileSync(
    path.join(userData, 'einstellungen.json'),
    JSON.stringify({
      version: 1,
      onboarded: true,
      tutorialDone: true,
      prefs: { theme: 'dark', lang: 'de', mode: 'expert', activeProfileId: 'p1', seriesEnabled: false, updateCheck: false, aiEnabled: false, aiTier: 'eco' },
      profiles: [{ id: 'p1', name: 'Meine Ordner', groups: [], targets: [
        { id: 't1', name: 'Rot', path: rot, key: '1', color: '#e5484d' },
        { id: 't2', name: 'Blau', path: blau, key: '2', color: '#3e63dd' },
      ] }],
      quickStarts: [{ id: 'q1', name: 'Import', source: src, sources: [src], profileId: 'p1', trashDir: null, startView: 'single', recursive: false, fullscreen: false, lastUsed: 1 }],
      recentSources: [],
    })
  );

  // Modell über einen lokalen Server anbieten (prüft den echten Download-Weg)
  let served = 0;
  const server = http.createServer((req, res) => {
    const st = fs.statSync(MODEL);
    res.writeHead(200, { 'Content-Length': st.size, 'Content-Type': 'application/octet-stream' });
    fs.createReadStream(MODEL).pipe(res).on('finish', () => served++);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/slimsort-ki-1.safetensors`;

  const app = await launch({
    app: process.env.FOTOSORT_EXE || path.join(ROOT, 'src-tauri', 'target', 'debug', 'slimsort'),
    env: {
      FOTOSORT_TEST: '1', FOTOSORT_USERDATA: userData, XDG_DATA_HOME: xdg, LANG: 'de_DE.UTF-8',
      WEBKIT_DISABLE_DMABUF_RENDERER: '1', FOTOSORT_AI_URL: url, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
    },
  });
  globalThis.__app = app;
  const win = app.page;
  const shot = async (name) => {
    await sleep(300);
    await win.screenshot({ path: path.join(SHOTS, name + '.png') });
  };
  const status = () => win.evaluate(() => window.api.ai.status());

  await win.waitForSelector('[data-testid="home"]');
  await sleep(4000); // länger als die Startverzögerung der KI

  // ---------------------------------------------------------------- Aus = nichts läuft
  let st = await status();
  assert.equal(st.enabled, false);
  assert.equal(st.threads, 0);
  assert.ok(!exists(path.join(userData, 'ki')), 'kein KI-Ordner, solange aus');
  console.log('aus = nichts läuft ✔');

  // ---------------------------------------------------------------- Einschalten + Modell laden
  await win.click('[data-testid="settings-btn"]');
  await win.click('[data-testid="settings-ai"]');
  await win.click('[data-testid="ai-enable"] button');
  await win.click('[data-testid="ai-download"]');
  await waitFor(async () => (await status()).installed, 120000, 'Download');
  assert.equal(served, 1);
  st = await status();
  assert.equal(st.enabled, true);
  assert.ok(st.threads >= 1);
  assert.ok(exists(path.join(userData, 'ki', 'slimsort-ki-1.safetensors')));
  await win.waitForSelector('[data-testid="ai-state"]');
  await shot('01-settings-ai');
  await win.keyboard.press('Escape');
  console.log('Download ✔');

  // ---------------------------------------------------------------- Sortierung öffnen → analysieren + aus Ordnern lernen
  await win.keyboard.press('1');
  await win.waitForSelector('[data-testid="session"]');
  await waitFor(async () => {
    const s = await status();
    return s.total === 12 && s.indexed === 12 && s.examples >= 6;
  }, 240000, 'Analyse');
  console.log('Analyse + aus Ordnern gelernt ✔', JSON.stringify(await status()));

  // ---------------------------------------------------------------- Vorschlag im Dock (erstes Foto ist rot)
  await win.waitForFunction(() => {
    const el = document.querySelector('[data-testid="target"][data-name="Rot"]');
    return el && el.classList.contains('suggest') && /KI \d+ %/.test(el.textContent || '');
  }, null, { timeout: 30000 });
  const pct = await win.evaluate(() => document.querySelector('[data-testid="target"][data-name="Rot"] .sugg').textContent);
  console.log('Vorschlag im Dock ✔', pct);
  await shot('02-suggestion');

  // ---------------------------------------------------------------- Chat: Suche nach Beschreibung
  await win.click('[data-testid="chat-toggle"]');
  await win.waitForSelector('[data-testid="chat-input"]');
  await win.fill('[data-testid="chat-input"]', 'ein blaues Bild');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => document.querySelectorAll('[data-testid="chat-thumb"]').length > 0, null, { timeout: 30000 });
  const found = await win.evaluate(() => [...document.querySelectorAll('[data-testid="chat-thumb"]')].map((b) => b.title));
  console.log('Treffer:', found.join(', '));
  assert.ok(found.length >= 3, 'mindestens 3 Treffer');
  for (const n of found) assert.equal(color[n], 'blue', `${n} ist nicht blau`);
  await shot('03-chat-search');
  console.log('Chat-Suche ✔');

  // ---------------------------------------------------------------- Chat: "verschiebe sie nach Blau"
  await win.fill('[data-testid="chat-input"]', 'verschiebe sie nach Blau');
  await win.keyboard.press('Enter');
  await waitFor(() => found.every((n) => exists(path.join(blau, n))), 15000, 'Verschieben per Chat');
  console.log('Verschieben per Chat ✔');

  // ---------------------------------------------------------------- Chat: Datum + Befehle
  await win.fill('[data-testid="chat-input"]', 'wie viele sind noch übrig?');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => /Noch \d+ Fotos offen/.test(document.querySelector('[data-testid="chat"]').textContent), null, { timeout: 8000 });
  console.log('Chat-Befehl ✔');

  // ---------------------------------------------------------------- Gedächtnis: merken, anzeigen, vergessen
  const chatText = () => win.evaluate(() => document.querySelector('[data-testid="chat"]').textContent);
  const chatHas = (re, ms = 10000) => waitFor(async () => re.test(await chatText()), ms, String(re)).catch(async (e) => {
    console.log('Chat:', (await chatText()).slice(-600));
    throw e;
  });
  const saved = () => JSON.parse(fs.readFileSync(path.join(userData, 'einstellungen.json'), 'utf8'));
  const say = async (text) => {
    await win.fill('[data-testid="chat-input"]', text);
    await win.keyboard.press('Enter');
  };
  await say('Merke dir: Fotos mit grünen Kreisen kommen immer in Rot');
  await chatHas(/Gemerkt: Fotos mit „grünen Kreisen“/);
  await waitFor(() => (saved().aiMemory || []).some((m) => m.kind === 'concept' && m.targetPath === rot), 5000, 'Gedächtnis gespeichert');
  await say('Was hast du dir gemerkt?');
  await chatHas(/Das habe ich mir gemerkt:/);
  await shot('03b-memory');
  await say('Das soll jetzt nicht mehr so sein');
  await chatHas(/Okay, vergessen/);
  await waitFor(() => (saved().aiMemory || []).length === 0, 5000, 'Gedächtnis gelöscht');
  console.log('Merken + Vergessen ✔');

  // ---------------------------------------------------------------- Rechte: Einstellungen ändern erst nach Erlaubnis
  await say('Mach das Design hell');
  await chatHas(/Das darf ich gerade nicht/);
  await win.evaluate(() => {
    window.api.confirm = async () => 0; // Risiko-Hinweis bestätigen (echtes Fenster kann der Test nicht klicken)
  });
  await win.click('[data-testid="menu-btn"]');
  await win.click('text=Einstellungen');
  await win.click('[data-testid="settings-ai"]');
  await win.click('[data-testid="perm-aiAllowSettings"] button');
  await waitFor(() => saved().prefs.aiAllowSettings === true, 5000, 'Recht gespeichert');
  await shot('03c-permissions');
  await win.keyboard.press('Escape');
  await say('Mach das Design hell');
  await chatHas(/Erledigt/);
  await waitFor(() => saved().prefs.theme === 'light', 5000, 'Design per Chat');
  console.log('Rechte + Einstellung per Chat ✔');

  // ---------------------------------------------------------------- KI sortieren
  await win.click('[data-testid="ai-sort-open"]');
  await win.waitForSelector('[data-testid="ai-sort"]');
  await win.evaluate(() => {
    const el = document.querySelector('[data-testid="ai-sort-conf"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '60');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await win.waitForSelector('[data-testid="ai-group"]');
  await shot('04-ai-sort');
  const redsBefore = ls(src).filter((n) => color[n] === 'red').length;
  await win.click('[data-testid="ai-sort-run"]');
  await waitFor(() => ls(src).filter((n) => color[n] === 'red').length <= redsBefore - 3, 20000, 'rote Fotos einsortiert');
  await sleep(1500);
  for (const n of ls(rot)) if (color[n]) assert.equal(color[n], 'red', `${n} falsch in Rot`);
  for (const n of ls(blau)) if (color[n]) assert.notEqual(color[n], 'red', `${n} falsch in Blau`);
  console.log('KI sortieren ✔', 'Rot:', ls(rot).length, 'Blau:', ls(blau).length, 'übrig:', ls(src).join(', '));
  await shot('05-after-sort');

  // ---------------------------------------------------------------- Rückgängig im Chat
  await win.fill('[data-testid="chat-input"]', 'rückgängig');
  await win.keyboard.press('Enter');
  await waitFor(() => ls(src).some((n) => color[n] === 'red' || color[n] === 'blue'), 15000, 'Rückgängig');
  console.log('Rückgängig ✔');

  // ---------------------------------------------------------------- Wieder ausschalten
  await win.click('[data-testid="chat-close"]');
  await win.click('[data-testid="menu-btn"]');
  await win.click('text=Einstellungen');
  await win.click('[data-testid="settings-ai"]');
  await win.click('[data-testid="ai-enable"] button');
  await waitFor(async () => !(await status()).enabled, 5000, 'ausschalten');
  st = await status();
  assert.equal(st.threads, 0);
  console.log('Ausschalten ✔');

  const errs = fs.readFileSync(path.join(userData, 'app.log'), 'utf8').split('\n').filter((l) => /renderer .*(error|unhandled)/i.test(l));
  assert.deepEqual(errs, [], 'keine Fehler in der Oberfläche');
  await app.close();
  server.close();
  console.log('KI-E2E OK');
  process.exit(0);
})().catch(async (e) => {
  console.error('KI-E2E FEHLER:', e);
  await globalThis.__app?.close().catch(() => {});
  process.exit(1);
});
