'use strict';
/**
 * E2E-Test für gemerkte Dinge: „Das ist meine Rakete“ auf einem Foto → ein anderes Foto derselben
 * Rakete wird erkannt (die übrigen nicht), „Fotos mit meiner Rakete“, Bereich im Foto markieren,
 * Regel „Fotos mit meiner Rakete → Weltall“ als Vorschlag, Verwaltung im Dialog, „Das ist nicht …“.
 *
 *   FOTOSORT_AI_FILE=…/slimsort-ki-1.safetensors FOTOSORT_AI_PICS=…(Beispielfotos mit rocket.jpg)
 *   xvfb-run -a node test/e2e/things.cjs [screenshot-ordner]
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { launch, sleep } = require('./driver.cjs');

const ROOT = path.join(__dirname, '..', '..');
const SHOTS = process.argv[2] || path.join(os.tmpdir(), 'slimsort-things-shots');
const { FOTOSORT_AI_FILE: MODEL, FOTOSORT_AI_PICS: PICS } = process.env;
if (![MODEL, PICS].every((p) => p && fs.existsSync(p)) || !fs.existsSync(path.join(PICS || '', 'rocket.jpg'))) {
  console.log('FOTOSORT_AI_FILE/FOTOSORT_AI_PICS fehlen – Dinge-Test übersprungen');
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
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'slimsort-things-'));
  const src = path.join(base, 'Import');
  const space = path.join(base, 'Weltall');
  const rest = path.join(base, 'Sonstiges');
  const userData = path.join(base, 'userdata');
  const ki = path.join(userData, 'ki');
  for (const d of [src, space, rest, ki, path.join(base, 'xdg')]) fs.mkdirSync(d, { recursive: true });
  for (const f of fs.readdirSync(PICS)) fs.copyFileSync(path.join(PICS, f), path.join(src, f));
  // zweites Foto derselben Rakete: anderer Ausschnitt, kleiner, wärmere Farben
  execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageEnhance
im = Image.open(sys.argv[1]).convert('RGB')
w, h = im.size
im = im.crop((int(w * .1), int(h * .05), int(w * .95), h)).resize((int(w * .6), int(h * .57)))
im = ImageEnhance.Color(im).enhance(1.3)
im = ImageEnhance.Brightness(im).enhance(1.08)
im.save(sys.argv[2], quality=88)
`, path.join(src, 'rocket.jpg'), path.join(src, 'zz-rakete-2.jpg')]);
  // Reihenfolge nach Name/Zeit: rocket.jpg zuerst
  const names = fs.readdirSync(src).sort((a, b) => (a === 'rocket.jpg' ? -1 : b === 'rocket.jpg' ? 1 : a.localeCompare(b)));
  names.forEach((n, i) => fs.utimesSync(path.join(src, n), 1e9 + i * 60, 1e9 + i * 60));
  fs.copyFileSync(MODEL, path.join(ki, 'slimsort-ki-1.safetensors'));

  fs.writeFileSync(
    path.join(userData, 'einstellungen.json'),
    JSON.stringify({
      version: 1,
      onboarded: true,
      tutorialDone: true,
      prefs: { theme: 'dark', lang: 'de', mode: 'expert', activeProfileId: 'p1', seriesEnabled: false, updateCheck: false, aiEnabled: true, aiTier: 'eco', aiLearnFolders: false, sortBy: 'date' },
      profiles: [{ id: 'p1', name: 'Meine Ordner', groups: [], targets: [
        { id: 't1', name: 'Weltall', path: space, key: '1', color: '#3e63dd' },
        { id: 't2', name: 'Sonstiges', path: rest, key: '2', color: '#e5484d' },
      ] }],
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
  const tagNames = () => win.evaluate(() => [...document.querySelectorAll('[data-testid="thing-tag"]')].map((e) => e.getAttribute('data-name')));

  await win.waitForSelector('[data-testid="home"]');
  await win.keyboard.press('1');
  await win.waitForSelector('[data-testid="session"]');
  const total = fs.readdirSync(src).length;
  await waitFor(async () => {
    const s = await status();
    return s.installed && s.indexed === total;
  }, 240000, 'Analyse');
  assert.equal(await current(), 'rocket.jpg', 'erstes Foto ist die Rakete');

  // ---------------------------------------------------------------- „Das ist meine Rakete“
  await win.click('[data-testid="chat-toggle"]');
  await win.waitForSelector('[data-testid="chat-input"]');
  await say('Das ist meine Rakete');
  await chatHas(/Gemerkt: „Meine Rakete“/);
  await waitFor(() => (saved().things || []).length === 1, 5000, 'Ding gespeichert');
  console.log('Ding gemerkt ✔');

  // ---------------------------------------------------------------- Fotos mit meiner Rakete: das zweite Foto, sonst wenig
  await say('Zeige Fotos mit meiner Rakete');
  await chatHas(/Fotos mit Meine Rakete gefunden/);
  const found = await win.evaluate(() => [...[...document.querySelectorAll('[data-testid="msg-ai"]')].pop().querySelectorAll('[data-testid="chat-thumb"]')].map((b) => b.title));
  console.log('Treffer:', found.join(', '));
  assert.ok(found.includes('zz-rakete-2.jpg'), 'zweites Raketen-Foto gefunden');
  assert.ok(found.length <= 4, `nicht zu viele Treffer (${found.length} von ${total})`);
  await shot('01-found');

  // ---------------------------------------------------------------- Schild im Foto auf dem zweiten Foto
  await win.evaluate(() => [...document.querySelectorAll('[data-testid="chat-thumb"]')].find((b) => b.title === 'zz-rakete-2.jpg').click());
  await waitFor(async () => (await current()) === 'zz-rakete-2.jpg', 5000, 'zweites Foto offen');
  await waitFor(async () => (await tagNames()).includes('Meine Rakete'), 10000, 'Schild „Meine Rakete“');
  await shot('02-tag');
  console.log('Schild im Foto ✔');

  // ---------------------------------------------------------------- Regel → Vorschlag im Dock
  await say('Fotos mit meiner Rakete sollen immer in den Ordner Weltall');
  await chatHas(/Fotos mit Meine Rakete schlage ich ab jetzt für „Weltall“ vor/);
  await win.waitForFunction(() => {
    const el = document.querySelector('[data-testid="target"][data-name="Weltall"] .sugg');
    return el && /Gemerkt: Meine Rakete/.test(el.textContent || '');
  }, null, { timeout: 20000 });
  console.log('Regel → Vorschlag ✔');

  // ---------------------------------------------------------------- Bereich markieren (auf dem Astronauten-Foto)
  await win.evaluate(() => [...document.querySelectorAll('[data-testid="chat-close"]')].forEach((b) => b.click()));
  await win.evaluate(() => document.activeElement && document.activeElement.blur());
  await win.keyboard.press('Home');
  await win.keyboard.press('ArrowRight'); // nach rocket.jpg kommt astronaut.jpg
  await waitFor(async () => (await current()) === 'astronaut.jpg', 5000, 'Astronaut offen');
  // Knöpfe im Foto erscheinen erst beim Zeigen mit der Maus → direkt anklicken
  await win.evaluate(() => document.querySelector('[data-testid="mark-btn"]').click());
  await win.waitForSelector('[data-testid="mark-layer"]');
  const r = await win.evaluate(() => {
    const b = document.querySelector('[data-testid="mark-layer"]').getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  });
  // Rahmen mit echten Zeiger-Ereignissen ziehen
  await win.evaluate((r) => {
    const el = document.querySelector('[data-testid="mark-layer"]');
    const ev = (type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', buttons: 1 }));
    ev('pointerdown', r.x + r.w * 0.3, r.y + r.h * 0.1);
    ev('pointermove', r.x + r.w * 0.5, r.y + r.h * 0.3);
    ev('pointermove', r.x + r.w * 0.6, r.y + r.h * 0.5);
    ev('pointerup', r.x + r.w * 0.6, r.y + r.h * 0.5);
  }, r);
  await win.waitForSelector('[data-testid="thing-name-input"]');
  await shot('03-mark');
  await win.fill('[data-testid="thing-name-input"]', 'Astronautin Eileen');
  await win.click('[data-testid="thing-name-ok"]');
  await waitFor(() => (saved().things || []).some((x) => x.name === 'Astronautin Eileen' && x.examples[0].box), 15000, 'markierter Bereich gemerkt');
  console.log('Bereich markiert ✔');

  // ---------------------------------------------------------------- Verwaltung
  await win.click('[data-testid="menu-btn"]');
  await win.click('[data-testid="menu-people"]');
  await win.waitForSelector('[data-testid="people-dialog"]');
  await win.click('[data-testid="tab-things"]');
  await waitFor(() => win.evaluate(() => document.querySelectorAll('[data-testid="thing-card"]').length === 2), 5000, 'zwei Ding-Karten');
  await shot('04-things');
  // Beispielfotos sichtbar, Überschrift automatisch vorgeschlagen und von Hand änderbar
  const card = '[data-testid="thing-card"][data-name="Meine Rakete"]';
  assert.ok((await win.evaluate((c) => document.querySelectorAll(c + ' [data-testid="thing-examples"] img').length, card)) >= 1, 'Beispielfoto sichtbar');
  const cat = await win.evaluate((c) => document.querySelector(c + ' [data-testid="thing-category"]').value, card);
  console.log('Überschrift (automatisch):', cat || '(keine)');
  await win.fill(card + ' [data-testid="thing-category"]', 'Saturn V');
  await win.keyboard.press('Tab');
  await waitFor(() => (saved().things || []).some((x) => x.name === 'Meine Rakete' && x.category === 'Saturn V'), 5000, 'Überschrift gespeichert');
  await win.keyboard.press('Escape');
  console.log('Verwaltung ✔');

  const errs = fs.readFileSync(path.join(userData, 'app.log'), 'utf8').split('\n').filter((l) => /renderer .*(error|unhandled)/i.test(l));
  assert.deepEqual(errs, [], 'keine Fehler in der Oberfläche');
  await app.close();
  console.log('DINGE-E2E OK');
  fs.rmSync(base, { recursive: true, force: true });
  process.exit(0);
})().catch(async (e) => {
  console.error('DINGE-E2E FEHLER:', e);
  await globalThis.__app?.close().catch(() => {});
  process.exit(1);
});
