'use strict';
/**
 * E2E-Test für die Neuerungen in Version 2 (Tauri):
 * HEIC-Anzeige, Suche, Doppelte, Foto auf Ordner ziehen, Rechtsklick-Menü, Umbenennen +
 * Datums-Unterordner, eigene Tasten, Info-Anzeige, Papierkorb des Systems, Vergleich ohne
 * Abdunkeln, Weitermachen.
 *
 *   npx tauri build --debug --no-bundle && xvfb-run -a node test/e2e/v2.cjs [screenshot-ordner]
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { launch, sleep } = require('./driver.cjs');

const ROOT = path.join(__dirname, '..', '..');
const SHOTS = process.argv[2] || path.join(os.tmpdir(), 'slimsort-v2-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const exists = (p) => fs.existsSync(p);
async function waitFor(fn, ms = 8000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await sleep(100);
  }
  throw new Error('Zeitüberschreitung: ' + label);
}
const walk = (d) => (exists(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);

(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'slimsort-v2-'));
  const src = path.join(base, 'Import');
  const urlaub = path.join(base, 'Urlaub');
  const familie = path.join(base, 'Familie');
  const userData = path.join(base, 'userdata');
  const xdg = path.join(base, 'xdg');
  for (const d of [urlaub, familie, userData, xdg]) fs.mkdirSync(d, { recursive: true });
  execFileSync('python3', [path.join(ROOT, 'scripts', 'make-fixtures.py'), src, '--simple', '6', 'DSC']);
  // Doppelte Datei + HEIC (falls pillow-heif da ist)
  fs.copyFileSync(path.join(src, 'DSC_0004.JPG'), path.join(src, 'Kopie von DSC_0004.JPG'));
  let heic = false;
  try {
    execFileSync('python3', ['-c', `import pillow_heif; from PIL import Image; pillow_heif.register_heif_opener(); Image.new('RGB',(800,600),(200,90,60)).save(${JSON.stringify(path.join(src, 'IMG_9001.HEIC'))})`]);
    heic = true;
  } catch {
    console.log('(pillow-heif fehlt – HEIC-Prüfung übersprungen)');
  }
  fs.writeFileSync(
    path.join(userData, 'einstellungen.json'),
    JSON.stringify({
      version: 1,
      onboarded: true,
      tutorialDone: true,
      prefs: { theme: 'dark', lang: 'de', mode: 'expert', activeProfileId: 'p1', seriesEnabled: false, updateCheck: false },
      profiles: [{ id: 'p1', name: 'Meine Ordner', groups: [], targets: [
        { id: 't1', name: 'Urlaub', path: urlaub, key: '1', color: '#5b8cff' },
        { id: 't2', name: 'Familie', path: familie, key: '2', color: '#2fbf71' },
      ] }],
      quickStarts: [{ id: 'q1', name: 'Import', source: src, sources: [src], profileId: 'p1', trashDir: null, startView: 'grid', recursive: false, fullscreen: false, lastUsed: 1 }],
      recentSources: [],
    })
  );

  const app = await launch({
    app: process.env.FOTOSORT_EXE || path.join(ROOT, 'src-tauri', 'target', 'debug', 'slimsort'),
    env: { FOTOSORT_TEST: '1', FOTOSORT_USERDATA: userData, XDG_DATA_HOME: xdg, LANG: 'de_DE.UTF-8', WEBKIT_DISABLE_DMABUF_RENDERER: '1' },
  });
  globalThis.__app = app;
  const win = app.page;
  const shot = async (name) => {
    await sleep(300);
    await win.screenshot({ path: path.join(SHOTS, name + '.png') });
  };
  const tiles = () => win.evaluate(() => [...document.querySelectorAll('[data-testid="tile"]')].map((e) => e.dataset.name));

  await win.waitForSelector('[data-testid="home"]');
  await win.keyboard.press('1');
  await win.waitForSelector('[data-testid="grid"] [data-testid="tile"]');
  await sleep(800);

  // ---------------------------------------------------------------- HEIC wird angezeigt (selbst dekodiert)
  if (heic) {
    await win.waitForFunction(() => {
      const t = document.querySelector('[data-testid="tile"][data-name="IMG_9001.HEIC"] img');
      return t && t.complete && t.naturalWidth > 0;
    }, null, { timeout: 30000 });
    console.log('HEIC ✔');
  }
  await shot('01-grid');

  // ---------------------------------------------------------------- Suche
  await win.fill('[data-testid="search"]', 'DSC_0002');
  await waitFor(async () => (await tiles()).length === 1, 4000, 'Suche');
  await win.fill('[data-testid="search"]', 'x');
  await win.keyboard.press('Backspace');
  await waitFor(async () => (await tiles()).length >= 7, 4000, 'Suche leeren');
  console.log('Suche ✔');

  // ---------------------------------------------------------------- Doppelte finden
  await win.click('[data-testid="menu-btn"]');
  await win.click('[data-testid="find-dupes"]');
  await win.waitForFunction(() => /doppelte(s)? Fotos? gefunden/.test(document.querySelector('[data-testid="toasts"]')?.textContent || ''), null, { timeout: 15000 });
  await win.click('[data-testid="view-menu"]');
  await win.click('[data-testid="filter-duplicates"]');
  await waitFor(async () => JSON.stringify(await tiles()) === JSON.stringify(['Kopie von DSC_0004.JPG']), 4000, 'nur die Kopie');
  assert.ok(await win.$('.tile-badge.dupe'), 'Schild „Doppelt“');
  await shot('02-duplicates');
  await win.click('[data-testid="view-menu"]');
  await win.click('[data-testid="filter-all"]');
  await win.keyboard.press('Escape');
  await waitFor(async () => (await tiles()).length >= 7, 4000, 'alle wieder');
  console.log('Doppelte ✔');

  // ---------------------------------------------------------------- Foto auf Zielordner ziehen
  const ids = await win.$$('[data-testid="tile"][data-name="DSC_0001.JPG"]');
  await win.dragTo(ids[0].id, '[data-testid="target"][data-name="Familie"]');
  await waitFor(() => exists(path.join(familie, 'DSC_0001.JPG')) && !exists(path.join(src, 'DSC_0001.JPG')), 8000, 'Ziehen nach Familie');
  console.log('Ziehen ✔');

  // ---------------------------------------------------------------- Rechtsklick → Löschen
  await win.rightClick('[data-testid="tile"][data-name="DSC_0002.JPG"]');
  await win.waitForSelector('.photo-menu');
  await shot('03-context-menu');
  await win.click('[data-testid="pm-delete"]');
  await waitFor(() => exists(path.join(src, '_Gelöscht', 'DSC_0002.JPG')), 8000, 'Rechtsklick löschen');
  console.log('Rechtsklick ✔');

  // ---------------------------------------------------------------- Vergleich: nichts wird abgedunkelt
  await win.click('[data-testid="tile"][data-name="DSC_0003.JPG"]');
  const t5 = await win.$$('[data-testid="tile"][data-name="DSC_0005.JPG"]');
  await t5[0].click({ modifiers: ['Control'] });
  await win.click('[data-testid="compare-selection"]');
  await win.waitForSelector('[data-testid="compare"]');
  await sleep(800);
  // Ein Foto abwählen („wird gelöscht“) – es darf trotzdem nicht dunkler werden
  const cellsNow = await win.$$('[data-testid="cmp-cell"]');
  await cellsNow[1].click();
  await sleep(300);
  const looks = await win.evaluate(() =>
    [...document.querySelectorAll('[data-testid="cmp-cell"]')].map((c) => {
      const s = getComputedStyle(c.querySelector('img'));
      return { keep: c.dataset.keep, opacity: s.opacity, filter: s.filter };
    })
  );
  console.log('Vergleich:', JSON.stringify(looks));
  assert.ok(looks.some((l) => l.keep === '0'), 'ein Foto ist abgewählt');
  assert.ok(looks.every((l) => l.opacity === '1' && (l.filter === 'none' || l.filter === '')), 'kein Foto ist abgedunkelt');
  await shot('04-compare');
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-testid="grid"]');
  console.log('Vergleich ohne Abdunkeln ✔');

  // ---------------------------------------------------------------- Einstellungen: Umbenennen, Datumsordner, eigene Taste
  await win.click('[data-testid="menu-btn"]');
  await win.click('text=Einstellungen');
  await win.waitForSelector('[data-testid="settings"]');
  await win.click('[data-testid="settings-sorting"]');
  await win.selectOption('[data-testid="rename-select"]', 'date');
  await win.selectOption('[data-testid="datefolders-select"]', 'month');
  await win.click('[data-testid="key-skip"]');
  await win.keyboard.press('s');
  await sleep(200);
  assert.match(await win.textContent('[data-testid="key-skip"]'), /S/);
  await shot('05-settings-sorting');
  await win.click('[data-testid="settings-display"]');
  await win.click('[data-testid="accent"] button[aria-label="green"]');
  await shot('06-settings-look');
  await win.keyboard.press('Escape');
  await sleep(300);

  // ---------------------------------------------------------------- Einzelansicht: eigene Taste, Umbenennen in Datumsordner
  await win.keyboard.press('Tab');
  await win.waitForSelector('[data-testid="single"]');
  const first = (await win.textContent('[data-testid="single-info"]')).match(/[\w ]+\.JPG/)[0];
  await win.keyboard.press('s'); // eigene Überspringen-Taste
  await waitFor(async () => !(await win.textContent('[data-testid="single-info"]')).includes(first), 4000, 'Überspringen mit S');
  const name = (await win.textContent('[data-testid="single-info"]')).match(/[\w ]+\.JPG/)[0];
  await win.keyboard.press('1');
  let moved = null;
  await waitFor(() => {
    moved = walk(urlaub).find((f) => /\d{4}[\\/]\d{2}[\\/]\d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.JPG$/.test(f));
    return !!moved;
  }, 8000, 'umbenannt im Datumsordner');
  console.log('Einsortiert als', path.relative(urlaub, moved));
  assert.ok(!exists(path.join(src, name)));
  await win.keyboard.press('Control+z');
  await waitFor(() => exists(path.join(src, name)) && !exists(moved), 8000, 'Rückgängig mit altem Namen');
  console.log('Umbenennen + Datumsordner + Rückgängig ✔');

  // ---------------------------------------------------------------- Info-Anzeige
  await win.keyboard.press('i');
  await win.waitForSelector('[data-testid="info-panel"]');
  assert.match(await win.textContent('[data-testid="info-panel"]'), /Aufnahme/);
  await shot('07-info');
  await win.keyboard.press('i');
  console.log('Info ✔');

  // ---------------------------------------------------------------- Löschordner → Papierkorb des Systems
  await win.click('[data-testid="menu-btn"]');
  await win.click('text=Löschordner leeren …');
  await win.waitForSelector('[data-testid="trash-confirm"]');
  await shot('08-trash');
  await win.click('[data-testid="trash-confirm"]');
  await waitFor(() => !exists(path.join(src, '_Gelöscht', 'DSC_0002.JPG')), 8000, 'Löschordner geleert');
  await waitFor(() => walk(path.join(xdg, 'Trash')).some((f) => f.endsWith('DSC_0002.JPG')), 8000, 'im Papierkorb des Systems');
  console.log('Papierkorb des Systems ✔');

  // ---------------------------------------------------------------- Weitermachen
  await win.keyboard.press('ArrowRight');
  const at = (await win.textContent('[data-testid="single-info"]')).match(/[\w ]+\.(JPG|HEIC)/)[0];
  await sleep(1800); // Stelle wird kurz nach jeder Änderung gemerkt
  await win.click('[data-testid="back-home"]');
  await win.waitForSelector('[data-testid="home"]');
  await win.keyboard.press('1');
  await win.waitForSelector('[data-testid="session"]');
  await win.waitForFunction(() => /Weiter bei/.test(document.querySelector('[data-testid="toasts"]')?.textContent || ''), null, { timeout: 6000 });
  await win.keyboard.press('Tab');
  await sleep(300);
  console.log('Weitermachen bei', at, '✔');
  await shot('09-resume');

  const errors = fs.readFileSync(path.join(userData, 'app.log'), 'utf8').split('\n').filter((l) => / renderer /.test(l));
  if (errors.length) console.log('Fehler der Oberfläche:', errors);
  assert.equal(errors.length, 0, 'keine Fehler in der Oberfläche');
  await app.close();
  console.log('\nE2E v2: alle Prüfungen bestanden ✔  Screenshots:', SHOTS);
})().catch(async (e) => {
  console.error('E2E v2 FEHLER:', e);
  if (globalThis.__app) {
    await globalThis.__app.page.screenshot({ path: path.join(SHOTS, 'zz-fehler.png') }).catch(() => {});
    await globalThis.__app.close();
  }
  process.exit(1);
});
