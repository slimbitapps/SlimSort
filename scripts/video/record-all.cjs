'use strict';
/**
 * Nimmt alle Rohclips für Intro-Video und Shorts auf.
 *   npm run build && node scripts/video/record-all.cjs ARBEITSORDNER [nur-diese-clips…]
 * Ergebnis: ARBEITSORDNER/raw/*.mkv + *.json (Zeitmarken der Ereignisse)
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const L = require('./lib.cjs');

const WORK = path.resolve(process.argv[2] || 'video-work');
const ONLY = process.argv.slice(3);
const RAW = path.join(WORK, 'raw');
fs.mkdirSync(RAW, { recursive: true });

const COLORS = ['#5b8cff', '#2fbf71', '#f5a524', '#a66cff'];
const NAMES = { en: ['Family', 'Holiday', 'Nature'], de: ['Familie', 'Strand', 'Natur'] };
const NAS = { en: 'NAS Archive', de: 'NAS Archiv' };

/** Ordner wie auf einem echten Rechner (nur wenn es /home/emma bzw. /home/anna noch nicht gibt) */
function freshHome(lang) {
  const home = path.join('/home', lang === 'de' ? 'anna' : 'emma');
  if (fs.existsSync(home) && !fs.existsSync(path.join(home, '.slimsort-video'))) {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'slimsort-home-'));
  }
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, '.slimsort-video'), '');
  return home;
}

function settings(lang, targets, extra = {}) {
  return {
    version: 1,
    onboarded: true,
    tutorialDone: true,
    prefs: { lang, theme: 'dark', activeProfileId: 'p1', seriesEnabled: false, ...extra },
    profiles: [{ id: 'p1', name: lang === 'de' ? 'Meine Ordner' : 'My folders', groups: [], targets }],
    quickStarts: [],
    recentSources: [],
  };
}

async function session(name, { w, h, zoom = 1, lang = 'en', photos = 'singles', withTargets = true, nas = true, extra }, script) {
  if (ONLY.length && !ONLY.includes(name)) return;
  console.log('▶', name);
  const home = freshHome(lang);
  const pics = path.join(home, lang === 'de' ? 'Bilder' : 'Pictures');
  const src = path.join(pics, lang === 'de' ? 'Urlaub 2025' : 'Summer 2025');
  L.demoPhotos(src, photos);
  let targets = withTargets ? L.makeTargets(pics, NAMES[lang], COLORS) : [];
  if (nas) targets.push({ id: 'nas', name: NAS[lang], path: '/Volumes/NAS/Photos', key: '4', color: COLORS[3] });
  const X = await L.startDisplay(w, h);
  const { app, win, drv } = await L.launchApp({ display: X.d, w, h, lang, pick: src, settings: settings(lang, targets, extra) });
  await app.evaluate(({ BrowserWindow }, z) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(z), zoom);
  await win.waitForSelector('[data-testid="home"]');
  await L.sleep(500);
  await drv.inject();
  const marks = [];
  let t0 = 0;
  const ctx = {
    win, drv, lang, pics,
    T: NAMES[lang],
    rec: null,
    async startRec() {
      ctx.rec = L.startRec(X.d, w, h, path.join(RAW, name + '.mkv'));
      t0 = Date.now();
      await L.sleep(300);
    },
    mark(m) {
      marks.push({ m, t: (Date.now() - t0) / 1000 });
    },
    // Ordner wählen und Einrichtung zügig durchklicken (ohne Aufnahme)
    async quickSetup() {
      await win.click('[data-testid="pick-source"]');
      await win.waitForSelector('[data-testid="setup"]');
      for (let i = 0; i < 3; i++) {
        await win.waitForSelector('[data-testid="setup-next"]:not([disabled])');
        await win.click('[data-testid="setup-next"]');
        await L.sleep(400);
      }
    },
    async waitSingle() {
      await win.waitForSelector('[data-testid="single"] img.media.ready', { timeout: 15000 });
      await drv.inject();
    },
    async key(k, label, color, press, wait = 1000) {
      await drv.keys(Array.isArray(k) ? k : [k], label, color, press || (Array.isArray(k) ? k.join('+') : k));
      await L.sleep(wait);
    },
  };
  try {
    await script(ctx);
  } catch (e) {
    await win.screenshot({ path: path.join(RAW, name + '-error.png') }).catch(() => {});
    throw e;
  } finally {
    if (ctx.rec) await ctx.rec.stop();
    fs.writeFileSync(path.join(RAW, name + '.json'), JSON.stringify({ marks, w, h }, null, 1));
    await app.close().catch(() => {});
    X.stop();
    if (home.startsWith('/home/')) fs.rmSync(home, { recursive: true, force: true });
  }
}

const SORT_SEQ = [[0], [1], [1], [2], ['skip'], [0], [2], [1]];
async function sortRun(c, seq, wait) {
  for (const [i] of seq) {
    if (i === 'skip') await c.key('Space', c.lang === 'de' ? 'Überspringen' : 'Skip', '', 'Space', wait);
    else await c.key(String(i + 1), c.T[i], COLORS[i], String(i + 1), wait);
  }
}

async function htmlScene(name, { w, h, mode, lang = 'en', dur }) {
  if (ONLY.length && !ONLY.includes(name)) return;
  console.log('▶', name);
  const imgDir = path.join(WORK, 'thumbs');
  if (!fs.existsSync(imgDir)) {
    const tmp = path.join(WORK, 'thumbs-src');
    L.demoPhotos(tmp, 'singles');
    fs.mkdirSync(imgDir, { recursive: true });
    for (const f of fs.readdirSync(tmp)) {
      require('node:child_process').execFileSync('convert', [path.join(tmp, f), '-resize', '360x', path.join(imgDir, f)]);
    }
  }
  const imgs = fs.readdirSync(imgDir).sort().map((f) => 'file://' + path.join(imgDir, f));
  const url = 'file://' + path.join(__dirname, 'scenes', 'finder.html') + '?' + new URLSearchParams({ mode, lang, imgs: JSON.stringify(imgs) });
  const X = await L.startDisplay(w, h);
  const { browser, page } = await L.launchPage({ display: X.d, w, h, url });
  await L.sleep(1500);
  const rec = L.startRec(X.d, w, h, path.join(RAW, name + '.mkv'));
  await L.sleep(300);
  await page.evaluate(() => window.start());
  await L.sleep(dur * 1000);
  await rec.stop();
  await browser.close();
  X.stop();
}

async function website(name, { w, h }) {
  if (ONLY.length && !ONLY.includes(name)) return;
  console.log('▶', name);
  const X = await L.startDisplay(w, h);
  const { browser, page, drv } = await L.launchPage({ display: X.d, w, h, url: 'file://' + path.join(L.ROOT, 'website', 'index.html') });
  await page.evaluate(() => (document.body.style.zoom = '1.35'));
  await L.sleep(1200);
  await drv.inject();
  await drv.moveTo(w * 0.8, h * 0.85, 10);
  const rec = L.startRec(X.d, w, h, path.join(RAW, name + '.mkv'));
  await L.sleep(800);
  await drv.moveToSel('#dl', 1300);
  await L.sleep(2500);
  await rec.stop();
  await browser.close();
  X.stop();
}

(async () => {
  const LW = 1920, LH = 1080, SQ = 1080;

  // ===== Querformat: Einrichtung, Sortieren, Rückgängig, NAS, Übersicht =====
  await session('main', { w: LW, h: LH, zoom: 1.3, withTargets: false }, async (c) => {
    const { win, drv } = c;
    await c.startRec();
    c.mark('home');
    await L.sleep(1200);
    await drv.click('[data-testid="pick-source"]', 900);
    await win.waitForSelector('[data-testid="setup"]');
    c.mark('setup');
    await L.sleep(2200);
    await drv.click('[data-testid="setup-next"]', 900);
    c.mark('targets');
    await L.sleep(900);
    for (const n of c.T) {
      if (!(await win.$('[data-testid="new-folder-name"]'))) await drv.click('[data-testid="create-folder"]', 700);
      await win.waitForSelector('[data-testid="new-folder-name"]');
      await L.sleep(250);
      await drv.type(n, 80);
      await L.sleep(250);
      await drv.click('[data-testid="new-folder-create"]', 500);
      await L.sleep(500);
    }
    c.mark('targetsDone');
    await L.sleep(1300);
    await drv.click('[data-testid="setup-next"]', 800);
    await L.sleep(1100);
    await drv.click('[data-testid="setup-next"]', 700);
    await c.waitSingle();
    await drv.moveTo(LW - 60, LH * 0.45, 500);
    c.mark('sorting');
    await L.sleep(900);
    await sortRun(c, [...SORT_SEQ, [0], [2], [1], [1], ['skip'], [0]], 1050);
    c.mark('fast');
    await sortRun(c, [[0], [1], [2], [1], [0], [1], [1], [2], [0], [1], [2], [1], [0], [1]], 330);
    c.mark('fastEnd');
    await L.sleep(900);
    c.mark('undo');
    await c.key(['Ctrl', 'Z'], 'Undo', '', 'Control+z', 1700);
    await c.key(['Ctrl', 'Z'], 'Undo', '', 'Control+z', 2200);
    c.mark('nas');
    await c.key('4', NAS.en, COLORS[3], '4', 5200);
    c.mark('nasEnd');
    c.mark('grid');
    await c.key('Tab', 'Overview', '', 'Tab', 1300);
    await drv.moveTo(LW * 0.5, LH * 0.5, 600);
    for (let i = 0; i < 12; i++) {
      await win.mouse.wheel(0, 60);
      await L.sleep(90);
    }
    await L.sleep(1200);
    c.mark('end');
  });

  // ===== Querformat: Serien-Vergleich =====
  await session('series', { w: LW, h: LH, zoom: 1.3, photos: 'series', nas: false, extra: { seriesEnabled: true, autoCompare: true } }, async (c) => {
    const { win, drv } = c;
    await c.quickSetup();
    await win.waitForSelector('[data-testid="cmp-cell"][data-best="1"]', { timeout: 40000 });
    await L.sleep(1500);
    await drv.inject();
    await drv.moveTo(LW * 0.5, LH * 0.9, 10);
    await c.startRec();
    c.mark('cmp');
    await L.sleep(1500);
    const cells = await win.$$('[data-testid="cmp-cell"]');
    const best = await win.$eval('[data-testid="cmp-cell"][data-best="1"]', (e) => [...e.parentElement.children].indexOf(e));
    const b0 = await cells[0].boundingBox();
    await drv.moveTo(b0.x + b0.width * 0.5, b0.y + b0.height * 0.45, 900);
    c.mark('zoom');
    for (let i = 0; i < 10; i++) {
      await win.mouse.wheel(0, -120);
      await L.sleep(110);
    }
    await L.sleep(1800);
    for (let i = 0; i < 10; i++) {
      await win.mouse.wheel(0, 120);
      await L.sleep(70);
    }
    await L.sleep(700);
    const bb = await cells[best].boundingBox();
    await drv.moveTo(bb.x + bb.width * 0.5, bb.y + bb.height * 0.5, 900);
    c.mark('best');
    await L.sleep(1000);
    await c.key(['Shift', String(best + 1)], c.lang === 'de' ? 'Nur dieses behalten' : 'Keep only this one', '', `Shift+Digit${best + 1}`, 1800);
    c.mark('move');
    await c.key('2', c.T[1], COLORS[1], '2', 2200);
    c.mark('end');
  });

  // ===== Quadratisch (für Shorts) =====
  for (const lang of ['en', 'de']) {
    await session('sq-sort-' + lang, { w: SQ, h: SQ, zoom: 0.98, lang, nas: lang === 'en' }, async (c) => {
      const { win, drv } = c;
      await c.quickSetup();
      await c.waitSingle();
      await drv.moveTo(SQ - 50, SQ * 0.4, 10);
      await c.startRec();
      c.mark('sorting');
      await L.sleep(700);
      await sortRun(c, SORT_SEQ, 950);
      c.mark('fast');
      await sortRun(c, [[0], [1], [2], [1], [0], [1], [2], [1], [0], [1]], 330);
      c.mark('fastEnd');
      await L.sleep(700);
      if (lang !== 'en') return c.mark('end');
      c.mark('undo');
      await c.key(['Ctrl', 'Z'], 'Undo', '', 'Control+z', 1500);
      c.mark('nas');
      await c.key('4', NAS.en, COLORS[3], '4', 3800);
      c.mark('multi');
      await c.key('Tab', 'Overview', '', 'Tab', 1200);
      const tiles = await win.$$('[data-testid="tile"]');
      const a = await tiles[0].boundingBox();
      await drv.moveTo(a.x + a.width / 2, a.y + a.height / 2, 700);
      await win.mouse.down();
      await win.mouse.up();
      await L.sleep(500);
      const z = await tiles[Math.min(tiles.length - 1, 14)].boundingBox();
      await drv.moveTo(z.x + z.width / 2, z.y + z.height / 2, 900);
      await win.keyboard.down('Shift');
      await win.mouse.down();
      await win.mouse.up();
      await win.keyboard.up('Shift');
      await L.sleep(900);
      c.mark('multiMove');
      await c.key('2', c.T[1], COLORS[1], '2', 1800);
      c.mark('multiUndo');
      await c.key(['Ctrl', 'Z'], 'Undo', '', 'Control+z', 2200);
      c.mark('end');
    });
  }
  await session('sq-series', { w: SQ, h: SQ, zoom: 0.98, photos: 'series', nas: false, extra: { seriesEnabled: true, autoCompare: true } }, async (c) => {
    const { win, drv } = c;
    await c.quickSetup();
    await win.waitForSelector('[data-testid="cmp-cell"][data-best="1"]', { timeout: 40000 });
    await L.sleep(1500);
    await drv.inject();
    await drv.moveTo(SQ * 0.5, SQ * 0.95, 10);
    await c.startRec();
    c.mark('cmp');
    await L.sleep(1200);
    const cells = await win.$$('[data-testid="cmp-cell"]');
    const best = await win.$eval('[data-testid="cmp-cell"][data-best="1"]', (e) => [...e.parentElement.children].indexOf(e));
    const b0 = await cells[1].boundingBox();
    await drv.moveTo(b0.x + b0.width * 0.5, b0.y + b0.height * 0.45, 800);
    c.mark('zoom');
    for (let i = 0; i < 10; i++) {
      await win.mouse.wheel(0, -120);
      await L.sleep(110);
    }
    await L.sleep(1800);
    for (let i = 0; i < 10; i++) {
      await win.mouse.wheel(0, 120);
      await L.sleep(70);
    }
    await L.sleep(600);
    const bb = await cells[best].boundingBox();
    await drv.moveTo(bb.x + bb.width * 0.5, bb.y + bb.height * 0.5, 800);
    c.mark('best');
    await L.sleep(800);
    await c.key(['Shift', String(best + 1)], 'Keep only this one', '', `Shift+Digit${best + 1}`, 1700);
    c.mark('move');
    await c.key('2', c.T[1], COLORS[1], '2', 2000);
    c.mark('end');
  });

  // ===== Szenen außerhalb der App =====
  await htmlScene('chaos', { w: LW, h: LH, mode: 'chaos', dur: 18 });
  await htmlScene('drag', { w: LW, h: LH, mode: 'drag', dur: 13 });
  await htmlScene('result', { w: LW, h: LH, mode: 'result', dur: 8 });
  await htmlScene('sq-chaos', { w: SQ, h: SQ, mode: 'chaos', dur: 8 });
  await htmlScene('sq-chaos-de', { w: SQ, h: SQ, mode: 'chaos', lang: 'de', dur: 8 });
  await htmlScene('sq-drag', { w: SQ, h: SQ, mode: 'drag', dur: 13 });
  await htmlScene('sq-result', { w: SQ, h: SQ, mode: 'result', dur: 7 });
  await htmlScene('sq-result-de', { w: SQ, h: SQ, mode: 'result', lang: 'de', dur: 7 });
  await website('web', { w: LW, h: LH });
  console.log('fertig:', RAW);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
