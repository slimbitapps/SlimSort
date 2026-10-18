'use strict';
/**
 * Screenshots für Store, Download-Portale und Social Media (1920×1080).
 *   npm run build && xvfb-run -a -s "-screen 0 2048x1280x24" node scripts/store-shots.cjs ZIELORDNER
 * Erzeugt für Deutsch und Englisch je: Einzelbild, Serien-Vergleich, Übersicht, Einrichtung, hell.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('/opt/node22/lib/node_modules/playwright');
}
const { _electron: electron } = playwright;

const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(ROOT, 'store-shots');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NAMES = {
  de: ['Familie', 'Urlaub', 'Natur', 'Beste Fotos'],
  en: ['Family', 'Holiday', 'Nature', 'Best of'],
};
const COLORS = ['#5b8cff', '#2fbf71', '#f5a524', '#a66cff'];

async function run(lang, theme) {
  // Schöner Pfad für die Anzeige (statt /tmp/…)
  // (nur wenn es den Ordner noch nicht gibt – sonst ein Temp-Ordner, damit nichts gelöscht wird)
  const home = path.join('/home', lang === 'de' ? 'anna' : 'emma');
  const ownHome = !fs.existsSync(home);
  const base = ownHome ? path.join(home, lang === 'de' ? 'Bilder' : 'Pictures') : fs.mkdtempSync(path.join(os.tmpdir(), 'slimsort-pics-'));
  fs.mkdirSync(base, { recursive: true });
  const src = path.join(base, lang === 'de' ? 'Urlaub 2025' : 'Summer 2025');
  execFileSync('python3', [path.join(ROOT, 'scripts', 'make-demo.py'), src]);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'slimsort-shots-'));
  fs.mkdirSync(userData, { recursive: true });
  const targets = NAMES[lang].map((name, i) => {
    const p = path.join(base, name);
    fs.mkdirSync(p, { recursive: true });
    return { id: 't' + i, name, path: p, key: String(i + 1), color: COLORS[i] };
  });
  fs.writeFileSync(
    path.join(userData, 'einstellungen.json'),
    JSON.stringify({
      version: 1,
      onboarded: true,
      tutorialDone: true,
      prefs: { lang, theme, activeProfileId: 'p1' },
      profiles: [{ id: 'p1', name: lang === 'de' ? 'Meine Ordner' : 'My folders', groups: [], targets }],
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
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setContentSize(1920, 1080);
    w.center();
  });
  const shot = async (name) => {
    await sleep(500);
    await win.mouse.move(1900, 700);
    await sleep(200);
    await win.screenshot({ path: path.join(OUT, `${lang}-${theme}-${name}.png`) });
  };

  await win.waitForSelector('[data-testid="home"]');
  await win.click('[data-testid="pick-source"]');
  await win.waitForSelector('[data-testid="setup"]');
  await win.waitForFunction(() => /48/.test(document.querySelector('[data-testid="source-count"]')?.textContent || ''));
  await sleep(1200); // Vorschaubilder
  await win.click('[data-testid="setup-next"]');
  await win.waitForSelector('[data-testid="target-row"]');
  await shot('4-setup');
  await win.click('[data-testid="setup-next"]');
  await win.click('[data-testid="setup-next"]');

  await win.waitForSelector('[data-testid="single"] img.media.ready');
  await sleep(1500);
  await shot('1-sort');

  // Nächstes Foto ist eine Serie → Vergleich öffnet sich
  await win.keyboard.press('2');
  await win.waitForSelector('[data-testid="compare"]', { timeout: 15000 });
  await win.waitForSelector('[data-testid="cmp-cell"][data-best="1"]', { timeout: 30000 });
  await sleep(1500);
  await shot('2-compare');

  await win.keyboard.press('Escape');
  await sleep(300);
  await win.keyboard.press('Tab');
  await win.waitForSelector('[data-testid="grid"] [data-testid="tile"]');
  await sleep(2500);
  await shot('3-grid');

  await app.close();
  fs.rmSync(ownHome ? home : base, { recursive: true, force: true });
  fs.rmSync(userData, { recursive: true, force: true });
}

(async () => {
  for (const lang of ['en', 'de']) {
    await run(lang, 'dark');
    await run(lang, 'light');
  }
  console.log('Screenshots:', OUT);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
