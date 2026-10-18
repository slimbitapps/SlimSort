'use strict';
/**
 * End-to-End-Test: startet die echte App (Electron) und spielt eine
 * Sortier-Sitzung durch. Prüft danach, wo die Dateien wirklich liegen.
 *
 *   xvfb-run -a node test/e2e/run.cjs [screenshot-ordner]
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('/opt/node22/lib/node_modules/playwright');
}
const { _electron: electron } = playwright;

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
  const src = path.join(base, 'Quelle');
  const urlaub = path.join(base, 'Ziele', 'Urlaub');
  const familie = path.join(base, 'Ziele', 'Familie');
  const nas = path.join(base, 'NAS-nicht-verbunden', 'Fotos');
  const userData = path.join(base, 'userdata');
  fs.mkdirSync(urlaub, { recursive: true });
  fs.mkdirSync(familie, { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  execFileSync('python3', [path.join(ROOT, 'scripts', 'make-fixtures.py'), src]);

  // Profil mit drei Zielen vorbereiten (eines davon "NAS", nicht erreichbar)
  fs.writeFileSync(
    path.join(userData, 'einstellungen.json'),
    JSON.stringify({
      version: 1,
      prefs: { lang: 'de', theme: 'dark', mode: 'expert', activeProfileId: 'p1' },
      profiles: [
        {
          id: 'p1',
          name: 'Urlaub',
          groups: [],
          targets: [
            { id: 't1', name: 'Urlaub', path: urlaub, key: '1', color: '#5b8cff' },
            { id: 't2', name: 'Familie', path: familie, key: '2', color: '#2fbf71' },
            { id: 't3', name: 'NAS Archiv', path: nas, key: '3', color: '#f5a524' },
          ],
        },
      ],
      quickStarts: [],
      recentSources: [],
    })
  );

  const app = await electron.launch({
    executablePath: require('electron'),
    args: [ROOT, '--no-sandbox'],
    env: { ...process.env, FOTOSORT_TEST: '1', FOTOSORT_USERDATA: userData, FOTOSORT_PICK: src },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(String(e)));
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await win.setViewportSize({ width: 1400, height: 880 }).catch(() => {});
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 900));
  await win.waitForSelector('[data-testid="start"]');
  await win.screenshot({ path: path.join(SHOTS, '01-start.png') });

  // Quellordner wählen und starten
  await win.click('[data-testid="pick-source"]');
  await win.waitForFunction(() => document.querySelector('[data-testid="start-go"]') && !document.querySelector('[data-testid="start-go"]').disabled);
  await win.screenshot({ path: path.join(SHOTS, '02-setup.png') });
  await win.click('[data-testid="start-go"]');
  await win.waitForSelector('[data-testid="single"] img.media');
  await sleep(700);
  await win.screenshot({ path: path.join(SHOTS, '03-single.png') });

  const status = () => win.textContent('[data-testid="status"]');
  console.log('Status:', await status());
  assert.match(await status(), /0 von 41 erledigt/);

  // Taste 1 -> Urlaub
  await win.keyboard.press('1');
  await waitFor(() => exists(path.join(urlaub, 'IMG_0001.JPG')), 6000, 'IMG_0001 in Urlaub');
  assert.ok(!exists(path.join(src, 'IMG_0001.JPG')));
  // Taste 2 -> Familie
  await win.keyboard.press('2');
  await waitFor(() => exists(path.join(familie, 'IMG_0002.JPG')), 6000, 'IMG_0002 in Familie');
  // Taste 1 bei Bild mit Begleitdatei
  await win.keyboard.press('1');
  await waitFor(() => exists(path.join(urlaub, 'IMG_0003.xmp')), 6000, 'xmp folgt');
  assert.ok(exists(path.join(urlaub, 'IMG_0003.JPG')));
  // Überspringen
  await win.keyboard.press(' ');
  // Live Photo (IMG_0005 + MOV) -> löschen
  await sleep(200);
  await win.keyboard.press('Delete');
  await waitFor(() => exists(path.join(src, '_Gelöscht', 'IMG_0005.JPG')), 6000, 'Löschordner');
  assert.ok(exists(path.join(src, '_Gelöscht', 'IMG_0005.MOV')), 'Live-Video wandert mit in den Löschordner');
  await sleep(300);
  await win.screenshot({ path: path.join(SHOTS, '04-after-sorting.png') });

  // NAS nicht erreichbar: Taste 3
  const before = fs.readdirSync(src).filter((f) => f.endsWith('.JPG')).length;
  await win.keyboard.press('3');
  await win.waitForSelector('.toast.error');
  const toastText = await win.textContent('.toast.error');
  console.log('Fehlermeldung:', toastText);
  assert.match(toastText, /nicht erreichbar/);
  await sleep(500);
  assert.equal(fs.readdirSync(src).filter((f) => f.endsWith('.JPG')).length, before, 'Datei bleibt in der Quelle');
  await win.screenshot({ path: path.join(SHOTS, '05-nas-offline.png') });

  // NAS "wird verbunden" -> App erkennt das selbst
  fs.mkdirSync(nas, { recursive: true });
  await win.evaluate(() => window.api.checkReach());
  await sleep(400);
  await win.keyboard.press('3');
  await waitFor(() => fs.readdirSync(nas).length === 1, 6000, 'Datei auf NAS');
  console.log('Auf NAS:', fs.readdirSync(nas));

  // Rückgängig: NAS, Löschen, (Skip), IMG_0003
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await win.keyboard.press(`${mod}+z`); // NAS
  await waitFor(() => fs.readdirSync(nas).length === 0, 6000, 'NAS rückgängig');
  await win.keyboard.press(`${mod}+z`); // Löschen
  await waitFor(() => exists(path.join(src, 'IMG_0005.JPG')) && exists(path.join(src, 'IMG_0005.MOV')), 6000, 'Löschen rückgängig');
  await win.keyboard.press(`${mod}+z`); // Überspringen
  await win.keyboard.press(`${mod}+z`); // IMG_0003
  await waitFor(() => exists(path.join(src, 'IMG_0003.JPG')) && exists(path.join(src, 'IMG_0003.xmp')), 6000, 'IMG_0003 zurück');
  const info = await win.textContent('[data-testid="single-info"]');
  console.log('Aktuell nach Rückgängig:', info);
  assert.match(info, /IMG_0003/);

  // Rasteransicht: mehrere markieren und auf einmal verschieben
  await win.keyboard.press('Tab');
  await win.waitForSelector('[data-testid="grid"] [data-testid="tile"]');
  await sleep(600);
  const tiles = await win.$$('[data-testid="tile"]');
  await tiles[2].click();
  await tiles[4].click({ modifiers: ['Shift'] });
  await tiles[7].click({ modifiers: [mod] });
  await sleep(150);
  await win.screenshot({ path: path.join(SHOTS, '06-grid-selection.png') });
  const names = await Promise.all([tiles[2], tiles[3], tiles[4], tiles[7]].map((t) => t.getAttribute('data-name')));
  console.log('Markiert:', names);
  await win.keyboard.press('2');
  await waitFor(() => names.every((n) => exists(path.join(familie, n))), 8000, 'Mehrfachauswahl verschoben');

  // Gesamtes Raster-Verschieben rückgängig
  await win.keyboard.press(`${mod}+z`);
  await waitFor(() => names.every((n) => exists(path.join(src, n))), 8000, 'Mehrfach rückgängig');

  // Nur-Bild-Modus
  await win.keyboard.press('Tab');
  await win.waitForSelector('[data-testid="single"]');
  await win.keyboard.press('F10');
  await sleep(400);
  await win.keyboard.press('1');
  await sleep(120);
  await win.screenshot({ path: path.join(SHOTS, '07-zen.png') });
  assert.ok(await win.$('[data-testid="flash"]'), 'Ziel blinkt im Nur-Bild-Modus');
  await win.keyboard.press('Escape');
  await sleep(300);
  assert.ok(await win.isVisible('[data-testid="targetbar"]'));

  // Vollbild an, Esc beendet es zuverlässig
  await win.keyboard.press('F11');
  await sleep(900);
  const fsOn = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen());
  await win.keyboard.press('Escape');
  await sleep(900);
  const fsOff = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen());
  console.log('Vollbild an:', fsOn, '-> nach Esc:', fsOff);
  assert.equal(fsOff, false);

  // Helles Design + Tastenübersicht
  await win.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await sleep(200);
  await win.screenshot({ path: path.join(SHOTS, '08-light.png') });
  await win.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await win.keyboard.press('F1');
  await win.waitForSelector('.dialog');
  await win.screenshot({ path: path.join(SHOTS, '09-shortcuts.png') });
  await win.keyboard.press('Escape');

  // Video anzeigen
  await win.evaluate(() => window.__goToName && window.__goToName('Urlaubsvideo.mp4'));

  // Bilanz
  await win.click('[data-testid="menu-btn"]');
  await win.click('text=Bilanz anzeigen');
  await win.waitForSelector('[data-testid="summary"]');
  await sleep(400);
  await win.screenshot({ path: path.join(SHOTS, '10-summary.png') });
  await win.keyboard.press('Escape');

  // Kein Überschreiben: gleicher Name im Ziel
  fs.writeFileSync(path.join(urlaub, 'IMG_0003.JPG.tmpcheck'), 'x');
  const cur = (await win.textContent('[data-testid="single-info"]')).match(/IMG_\d+\.JPG|[\w-]+\.(mp4|MOV)/)[0];
  fs.writeFileSync(path.join(urlaub, cur), 'ALT');
  await win.keyboard.press('1');
  const stem = cur.replace(/\.[^.]+$/, '');
  const ext = cur.slice(stem.length);
  await waitFor(() => exists(path.join(urlaub, `${stem} (2)${ext}`)), 6000, 'Name (2)');
  assert.equal(fs.readFileSync(path.join(urlaub, cur), 'utf8'), 'ALT', 'bestehende Datei unverändert');
  console.log('Kein Überschreiben:', `${stem} (2)${ext}`);

  // Schnellstart: Kachel speichern und per Taste 1 starten
  await win.click('[data-testid="menu-btn"]');
  await win.click('text=Zur Startseite');
  await win.waitForSelector('[data-testid="start"]');
  await win.click('[data-testid="pick-source"]');
  await win.click('text=Als Schnellstart speichern');
  await win.waitForSelector('[data-testid="quick-tile"]');
  await sleep(300);
  await win.screenshot({ path: path.join(SHOTS, '11-quickstart.png') });
  await win.keyboard.press('1');
  await win.waitForSelector('[data-testid="session"]');
  await sleep(1000);
  const fsQuick = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen());
  console.log('Schnellstart im Vollbild:', fsQuick);
  assert.equal(fsQuick, true);
  await win.keyboard.press('Escape');
  await sleep(900);

  // Simpel-Modus + Englisch
  await win.click('text=Simpel');
  await win.click('button[title="Sprache"]');
  await sleep(500);
  await win.screenshot({ path: path.join(SHOTS, '12-simple-en.png') });
  assert.match(await win.textContent('[data-testid="status"]'), /done/);
  await win.click('text=Expert');
  await win.click('button[title="Language"]');

  // Protokoll vorhanden
  assert.ok(fs.readFileSync(path.join(userData, 'protokoll.log'), 'utf8').includes('"op"'));

  const real = errors.filter((e) => !/Autofill|DevTools/.test(e));
  if (real.length) console.log('Konsolenfehler:', real);
  await app.close();
  console.log('\nE2E: alle Prüfungen bestanden ✔  Screenshots:', SHOTS);
})().catch(async (e) => {
  console.error('E2E FEHLER:', e);
  process.exit(1);
});
