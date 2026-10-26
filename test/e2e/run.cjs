'use strict';
/**
 * End-to-End-Test: startet die echte App (Tauri, über tauri-driver) und spielt alles durch –
 * Einführung, Einrichtung, Sortieren, Rückgängig, NAS-Ausfall, Einstellungen.
 * Prüft danach, wo die Dateien wirklich liegen.
 *
 *   npx tauri build --debug --no-bundle && xvfb-run -a node test/e2e/run.cjs [screenshot-ordner]
 *   FOTOSORT_EXE=src-tauri/target/release/slimsort …   (andere Fassung testen)
 * Braucht: tauri-driver (cargo install tauri-driver) und WebKitWebDriver (Paket webkit2gtk-driver).
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const { launch } = require('./driver.cjs');

const ROOT = path.join(__dirname, '..', '..');
const SHOTS = process.argv[2] || path.join(os.tmpdir(), 'fotosort-shots');
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => fs.existsSync(p);
async function waitFor(fn, ms = 6000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await sleep(80);
  }
  throw new Error('Zeitüberschreitung: ' + label);
}

(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fotosort-e2e-'));
  const src = path.join(base, 'Fotos', 'Import');
  const nas = path.join(base, 'NAS-nicht-verbunden', 'Archiv');
  const userData = path.join(base, 'userdata');
  fs.mkdirSync(userData, { recursive: true });
  execFileSync('python3', [path.join(ROOT, 'scripts', 'make-fixtures.py'), src]);
  const src2 = path.join(base, 'Handy');
  execFileSync('python3', [path.join(ROOT, 'scripts', 'make-fixtures.py'), src2, '--simple', '3', 'DSC']);
  const urlaub = path.join(base, 'Fotos', 'Urlaub');
  const familie = path.join(base, 'Fotos', 'Familie');

  // Vorhandene Vorlage mit einem Ziel auf einem (nicht verbundenen) NAS
  fs.writeFileSync(
    path.join(userData, 'einstellungen.json'),
    JSON.stringify({
      version: 1,
      onboarded: false,
      prefs: { theme: 'dark', activeProfileId: 'p1' },
      profiles: [{ id: 'p1', name: 'Meine Ordner', groups: [], targets: [{ id: 't3', name: 'NAS Archiv', path: nas, key: '3', color: '#f6b03c' }] }],
    })
  );

  const app = await launch({
    app: process.env.FOTOSORT_EXE || path.join(ROOT, 'src-tauri', 'target', 'debug', 'slimsort'),
    env: { FOTOSORT_TEST: '1', FOTOSORT_USERDATA: userData, FOTOSORT_PICK: `${src}|${src2}`, LANG: 'de_DE.UTF-8', WEBKIT_DISABLE_DMABUF_RENDERER: '1' },
  });
  const win = app.page;
  process.on('exit', () => app.close());
  globalThis.__app = app;
  const shot = async (name) => {
    await sleep(350);
    await win.screenshot({ path: path.join(SHOTS, name + '.png') });
  };

  // ---------------------------------------------------------------- Einführung
  await win.waitForSelector('[data-testid="onboarding"]');
  await win.click('[data-testid="lang-de"]');
  await shot('01-onb-language');
  await win.click('[data-testid="onb-next"]');
  await shot('02-onb-theme');
  await win.click('[data-testid="onb-next"]');
  await shot('03-onb-mode');
  await win.click('[data-testid="onb-next"]');
  await sleep(500);
  await shot('04-onb-tour');
  await win.click('[data-testid="onb-next"]');
  await win.waitForSelector('[data-testid="home"]');
  await shot('05-home-empty');

  // ---------------------------------------------------------------- Einrichten
  await win.click('[data-testid="pick-source"]');
  await win.waitForSelector('[data-testid="setup"]');
  await win.waitForFunction(() => /40 Fotos/.test(document.querySelector('[data-testid="source-count"]').textContent));
  // Zweiten Quellordner hinzufügen
  await win.click('[data-testid="add-source"]');
  await win.waitForFunction(() => /43 Fotos/.test(document.querySelector('[data-testid="source-count"]').textContent));
  assert.equal((await win.$$('[data-testid="source-row"]')).length, 2);
  console.log('Zählung:', await win.textContent('[data-testid="source-count"]'));
  await shot('06-setup-source');
  await win.click('[data-testid="setup-next"]');

  // Zwei neue Zielordner direkt in der App anlegen
  for (const name of ['Urlaub', 'Familie']) {
    if (!(await win.$('[data-testid="new-folder-name"]'))) await win.click('[data-testid="create-folder"]');
    await win.fill('[data-testid="new-folder-name"]', name);
    await win.click('[data-testid="new-folder-create"]');
    await sleep(250);
  }
  assert.ok(exists(urlaub) && exists(familie), 'Ordner wurden angelegt');
  assert.equal((await win.$$('[data-testid="target-row"]')).length, 3);
  await shot('07-setup-targets');
  await win.click('[data-testid="setup-next"]');
  await shot('08-setup-start');
  await win.click('[data-testid="setup-next"]');

  // ---------------------------------------------------------------- Einführung beim Sortieren
  await win.waitForSelector('[data-testid="coach"]');
  await sleep(600);
  await shot('09-coach');
  for (let i = 0; i < 5; i++) await win.click('[data-testid="coach-next"]');
  await sleep(300);
  assert.equal(await win.$('[data-testid="coach"]'), null, 'Einführung beendet');
  await win.waitForSelector('[data-testid="single"] img.media');
  await sleep(600);
  await shot('10-single');

  const status = () => win.textContent('[data-testid="status"]');
  assert.match(await status(), /0 von 44/);
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

  // Zweiter Quellordner: Löschen landet im Papierkorb DIESES Ordners
  assert.match(await win.textContent('[data-testid="single-info"]'), /DSC_0001/);
  await win.keyboard.press('Delete');
  await waitFor(() => exists(path.join(src2, '_Gelöscht', 'DSC_0001.JPG')), 6000, 'Papierkorb im zweiten Ordner');
  await win.keyboard.press(`${mod}+z`);
  await waitFor(() => exists(path.join(src2, 'DSC_0001.JPG')), 6000, 'DSC zurück');

  // ---------------------------------------------------------------- Serien & Vergleich
  await win.keyboard.press('End');
  await win.keyboard.press('Home');
  for (let i = 0; i < 3; i++) await win.keyboard.press('ArrowRight');
  await win.waitForSelector('[data-testid="compare"]');
  await win.waitForFunction(() => !/Bewertung/.test(document.querySelector('[data-testid="cmp-status"]').textContent), null, { timeout: 20000 });
  await sleep(500);
  await shot('10b-compare');
  // Erklärung beim Darüberfahren
  await win.hover('[data-testid="cmp-confirm"]');
  await win.waitForSelector('.tooltip', { timeout: 3000 });
  await win.screenshot({ path: path.join(SHOTS, '10c-tooltip.png') });
  await win.mouse.move(5, 300);
  const cells = await win.$$eval('[data-testid="cmp-cell"]', (els) => els.map((e) => ({ name: e.dataset.name, keep: e.dataset.keep, best: e.dataset.best })));
  console.log('Vergleich:', JSON.stringify(cells));
  assert.equal(cells.length, 5);
  const best = cells.find((c) => c.best === '1');
  assert.ok(best && best.name !== 'IMG_0002.JPG', 'unscharfes Foto wird nicht empfohlen');
  assert.equal(cells.filter((c) => c.keep === '1').length, 1, 'nur das beste ist vorausgewählt');
  // Shift+3: nur Foto 3 behalten, dann Taste 1 (Urlaub)
  await win.keyboard.press('Shift+Digit3');
  await sleep(150);
  assert.match(await win.textContent('[data-testid="cmp-status"]'), /1 behalten, 4 werden gelöscht/);
  await win.keyboard.press('1');
  await waitFor(() => exists(path.join(urlaub, 'IMG_0003.JPG')) && exists(path.join(urlaub, 'IMG_0003.xmp')), 6000, 'Behaltenes in Urlaub');
  await waitFor(
    () => ['IMG_0001.JPG', 'IMG_0002.JPG', 'IMG_0004.JPG', 'IMG_0005.JPG', 'IMG_0005.MOV'].every((n) => exists(path.join(src, '_Gelöscht', n))),
    8000,
    'Rest im Papierkorb'
  );
  // Ein Rückgängig nimmt den ganzen Vergleich zurück
  await win.keyboard.press(`${mod}+z`);
  await waitFor(() => ['IMG_0001.JPG', 'IMG_0002.JPG', 'IMG_0003.JPG', 'IMG_0004.JPG', 'IMG_0005.JPG'].every((n) => exists(path.join(src, n))), 8000, 'Vergleich rückgängig');
  await win.waitForSelector('[data-testid="compare"]');
  // Leertaste: einzeln ansehen
  await win.keyboard.press(' ');
  await win.waitForSelector('[data-testid="single"]');
  assert.match(await win.textContent('[data-testid="single-info"]'), /IMG_0001/);
  assert.ok(await win.$('[data-testid="series-chip"]'), 'Hinweis auf Serie');
  // Shift + Ordner-Taste: ganze Serie verschieben
  await win.keyboard.press('Shift+Digit2');
  await waitFor(() => ['IMG_0001.JPG', 'IMG_0002.JPG', 'IMG_0003.JPG', 'IMG_0004.JPG', 'IMG_0005.JPG'].every((n) => exists(path.join(familie, n))), 8000, 'Serie nach Familie');
  await win.keyboard.press(`${mod}+z`);
  await waitFor(() => ['IMG_0001.JPG', 'IMG_0002.JPG', 'IMG_0003.JPG', 'IMG_0004.JPG', 'IMG_0005.JPG'].every((n) => exists(path.join(src, n))), 8000, 'Serie zurück');
  // Für die weiteren Prüfungen: Serien ausschalten
  await win.click('[data-testid="series-toggle"]');
  await sleep(200);
  assert.match(await win.textContent('[data-testid="single-info"]'), /IMG_0001/);

  // Tastenbelegung: Urlaub=1, Familie=2 (3 = NAS)
  await win.keyboard.press('1');
  await waitFor(() => exists(path.join(urlaub, 'IMG_0001.JPG')) && !exists(path.join(src, 'IMG_0001.JPG')), 6000, 'IMG_0001 in Urlaub');
  await win.keyboard.press('2');
  await waitFor(() => exists(path.join(familie, 'IMG_0002.JPG')), 6000, 'IMG_0002 in Familie');
  await win.keyboard.press('1');
  await waitFor(() => exists(path.join(urlaub, 'IMG_0003.JPG')) && exists(path.join(urlaub, 'IMG_0003.xmp')), 6000, 'Begleitdatei folgt');
  await win.keyboard.press(' ');
  await sleep(200);
  await win.keyboard.press('Delete');
  await waitFor(() => exists(path.join(src, '_Gelöscht', 'IMG_0005.JPG')), 6000, 'Papierkorb');
  await waitFor(() => exists(path.join(src, '_Gelöscht', 'IMG_0005.MOV')), 6000, 'Live-Video wandert mit');
  await shot('11-after-sorting');

  // NAS nicht erreichbar
  const before = fs.readdirSync(src).filter((f) => f.endsWith('.JPG')).length;
  await win.keyboard.press('3');
  await win.waitForSelector('.toast.error');
  console.log('Fehlermeldung:', await win.textContent('.toast.error'));
  await sleep(500);
  assert.equal(fs.readdirSync(src).filter((f) => f.endsWith('.JPG')).length, before, 'Datei bleibt in der Quelle');
  await shot('12-nas-offline');

  // NAS wieder da
  fs.mkdirSync(nas, { recursive: true });
  await win.evaluate(() => window.api.checkReach());
  await sleep(400);
  await win.keyboard.press('3');
  await waitFor(() => fs.readdirSync(nas).length === 1, 6000, 'Datei auf NAS');

  // Rückgängig x4
  await win.keyboard.press(`${mod}+z`);
  await waitFor(() => fs.readdirSync(nas).length === 0, 6000, 'NAS rückgängig');
  await win.keyboard.press(`${mod}+z`);
  await waitFor(() => exists(path.join(src, 'IMG_0005.JPG')) && exists(path.join(src, 'IMG_0005.MOV')), 6000, 'Löschen rückgängig');
  await win.keyboard.press(`${mod}+z`);
  await win.keyboard.press(`${mod}+z`);
  await waitFor(() => exists(path.join(src, 'IMG_0003.JPG')) && exists(path.join(src, 'IMG_0003.xmp')), 6000, 'IMG_0003 zurück');
  assert.match(await win.textContent('[data-testid="single-info"]'), /IMG_0003/);

  // Übersicht: mehrere auswählen und gemeinsam verschieben
  await win.keyboard.press('Tab');
  await win.waitForSelector('[data-testid="grid"] [data-testid="tile"]');
  await sleep(600);
  const tiles = await win.$$('[data-testid="tile"]');
  await tiles[2].click();
  await tiles[4].click({ modifiers: ['Shift'] });
  await tiles[7].click({ modifiers: [mod] });
  await shot('13-grid-selection');
  const names = await Promise.all([tiles[2], tiles[3], tiles[4], tiles[7]].map((t) => t.getAttribute('data-name')));
  await win.keyboard.press('2');
  await waitFor(() => names.every((n) => exists(path.join(familie, n))), 8000, 'Mehrfachauswahl');
  await win.keyboard.press(`${mod}+z`);
  await waitFor(() => names.every((n) => exists(path.join(src, n)) || exists(path.join(src2, n))), 8000, 'Mehrfach rückgängig');
  // Auswahl vergleichen
  await win.click('[data-testid="compare-selection"]');
  await win.waitForSelector('[data-testid="compare"]');
  assert.equal((await win.$$('[data-testid="cmp-cell"]')).length, 4);
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-testid="grid"]');

  // Nur Bild
  await win.keyboard.press('Tab');
  await win.waitForSelector('[data-testid="single"]');
  await win.keyboard.press('F10');
  await sleep(400);
  await win.keyboard.press('1');
  await win.waitForSelector('[data-testid="flash"]', { timeout: 1000 });
  await win.screenshot({ path: path.join(SHOTS, '14-zen.png') });
  await win.keyboard.press('Escape');
  await sleep(300);
  assert.ok(await win.isVisible('[data-testid="targetbar"]'));

  // Vollbild + Esc
  await win.keyboard.press('F11');
  await sleep(900);
  await win.keyboard.press('Escape');
  await sleep(900);
  assert.equal(await win.evaluate(() => window.api.isFullscreen()), false);

  // Nie überschreiben
  const cur = (await win.textContent('[data-testid="single-info"]')).match(/IMG_\d+\.JPG/)[0];
  fs.writeFileSync(path.join(urlaub, cur), 'ALT');
  await win.keyboard.press('1');
  const stem = cur.replace(/\.[^.]+$/, '');
  await waitFor(() => exists(path.join(urlaub, `${stem} (2).JPG`)), 6000, 'Name (2)');
  assert.equal(fs.readFileSync(path.join(urlaub, cur), 'utf8'), 'ALT');

  // Bilanz
  await win.click('[data-testid="menu-btn"]');
  await win.click('text=Bilanz anzeigen');
  await win.waitForSelector('[data-testid="summary"]');
  await shot('15-summary');
  await win.keyboard.press('Escape');

  // Einstellungen
  await win.click('[data-testid="menu-btn"]');
  await win.click('text=Einstellungen');
  await win.waitForSelector('[data-testid="settings"]');
  await shot('16-settings');
  await win.click('[data-testid="settings-series"]');
  if (!(await win.$('[data-testid="series-gap"]'))) await win.click('.settings-main .switch');
  await win.fill('[data-testid="series-gap"]', '0,1');
  await sleep(200);
  console.log('Serien-Vorschau:', await win.textContent('[data-testid="series-preview"]'));
  assert.match(await win.textContent('[data-testid="series-preview"]'), /0 Serien/);
  await win.fill('[data-testid="series-gap"]', '3');
  await sleep(200);
  await shot('16b-settings-series');
  await win.click('[data-testid="settings-help"]');
  await shot('17-settings-help');
  await win.click('[data-testid="settings-about"]');
  await shot('18-settings-about');
  await win.click('[data-testid="settings-general"]');
  await win.selectOption('[data-testid="lang-select"]', 'en');
  await sleep(300);
  await win.keyboard.press('Escape');
  await shot('19-english');
  assert.match(await status(), / of /);

  // Startseite: zuletzt verwendet + Schnellstart per Taste
  await win.click('[data-testid="back-home"]');
  await win.waitForSelector('[data-testid="recent"]');
  await win.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await shot('20-home-light');
  await win.keyboard.press('1');
  await win.waitForSelector('[data-testid="session"]');
  assert.equal(await win.$('[data-testid="coach"]'), null, 'Einführung nur beim ersten Mal');

  assert.ok(fs.readFileSync(path.join(userData, 'protokoll.log'), 'utf8').includes('"op"'));
  // Fehler der Oberfläche landen im Protokoll der App
  const errors = fs.readFileSync(path.join(userData, 'app.log'), 'utf8').split('\n').filter((l) => / renderer /.test(l));
  const real = errors.filter((e) => !/Autofill|DevTools|404/.test(e));
  if (real.length) console.log('Konsolenfehler:', real);
  assert.equal(real.length, 0, 'keine Fehler in der Oberfläche');
  await app.close();
  console.log('\nE2E: alle Prüfungen bestanden ✔  Screenshots:', SHOTS);
})().catch(async (e) => {
  console.error('E2E FEHLER:', e);
  if (globalThis.__app) {
    await globalThis.__app.page.screenshot({ path: path.join(SHOTS, 'zz-fehler.png') }).catch(() => {});
    await globalThis.__app.close();
  }
  process.exit(1);
});
