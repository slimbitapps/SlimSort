'use strict';
/** Lasttest: 20.000 Dateien einlesen, im Raster scrollen, schnell sortieren. */
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
const ROOT = path.join(__dirname, '..', '..');
const N = Number(process.env.N || 20000);
const SHOTS = process.argv[2] || path.join(os.tmpdir(), 'fotosort-shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fotosort-perf-'));
  const src = path.join(base, 'Quelle');
  const dst = path.join(base, 'Ziel');
  const userData = path.join(base, 'ud');
  fs.mkdirSync(src);
  fs.mkdirSync(dst);
  fs.mkdirSync(userData);
  const sample = path.join(base, 'sample.jpg');
  execFileSync('python3', ['-c', `from PIL import Image; Image.new('RGB',(320,240),(90,140,250)).save('${sample}', quality=70)`]);
  for (let i = 0; i < N; i++) fs.copyFileSync(sample, path.join(src, `DSC_${String(i).padStart(6, '0')}.jpg`));
  fs.writeFileSync(
    path.join(userData, 'einstellungen.json'),
    JSON.stringify({
      version: 1,
      prefs: { mode: 'expert', activeProfileId: 'p' },
      profiles: [{ id: 'p', name: 'Test', groups: [], targets: [{ id: 't', name: 'Ziel', path: dst, key: '1', color: '#5b8cff' }] }],
    })
  );
  const app = await playwright._electron.launch({
    executablePath: require('electron'),
    args: [ROOT, '--no-sandbox'],
    env: { ...process.env, FOTOSORT_TEST: '1', FOTOSORT_USERDATA: userData, FOTOSORT_PICK: src },
  });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 900));
  await win.click('[data-testid="pick-source"]');
  await win.click('text=Raster');
  let t0 = Date.now();
  await win.click('[data-testid="start-go"]');
  await win.waitForSelector('[data-testid="grid"] [data-testid="tile"]', { timeout: 60000 });
  const openMs = Date.now() - t0;
  console.log(`Einlesen + Anzeigen von ${N} Dateien: ${openMs} ms`);

  // Scrollen bis ans Ende
  t0 = Date.now();
  await win.keyboard.press('End');
  await win.waitForFunction((n) => document.querySelector('[data-testid="single"], [data-testid="grid"]') && [...document.querySelectorAll('[data-testid="tile"]')].some((x) => x.dataset.name === `DSC_${String(n - 1).padStart(6, '0')}.jpg`), N);
  console.log(`Sprung ans Ende: ${Date.now() - t0} ms`);
  await win.keyboard.press('Home');

  // Einzelbild, 30 Bilder so schnell wie möglich sortieren
  await win.keyboard.press('Tab');
  await win.waitForSelector('[data-testid="single"]');
  t0 = Date.now();
  for (let i = 0; i < 30; i++) await win.keyboard.press('1');
  await win.waitForFunction(() => /30 von/.test(document.querySelector('[data-testid="status"]').textContent));
  const perKey = (Date.now() - t0) / 30;
  console.log(`Reaktionszeit pro Tastendruck (Oberfläche): ${perKey.toFixed(1)} ms`);
  const t1 = Date.now();
  while (fs.readdirSync(dst).length < 30 && Date.now() - t1 < 15000) await sleep(50);
  console.log(`Dateien im Ziel: ${fs.readdirSync(dst).length}`);
  assert.equal(fs.readdirSync(dst).length, 30);

  // Alles markieren und Auswahl-Performance
  await win.keyboard.press('Tab');
  t0 = Date.now();
  await win.keyboard.press('Control+a');
  await win.waitForFunction(() => /markiert/.test(document.querySelector('[data-testid="status"]').textContent));
  console.log(`Alles markieren: ${Date.now() - t0} ms`);
  await win.keyboard.press('Escape');
  await sleep(300);
  await win.screenshot({ path: path.join(SHOTS, 'perf-grid.png') });
  await app.close();
  assert.ok(openMs < 20000, 'Einlesen zu langsam');
  assert.ok(perKey < 150, 'Tastendruck zu langsam');
  console.log('PERF: bestanden ✔');
})().catch((e) => {
  console.error('PERF FEHLER', e);
  process.exit(1);
});
