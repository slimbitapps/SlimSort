'use strict';
/**
 * E2E-Test: Videos (Standbild statt schwarz, Wiedergabe nach Einstellung), Zoomen ohne schwarze Flächen,
 * Taste N (Namen/Kästchen aus), zweiter Bildschirm (Foto-Fenster), „Tipps & Neues“.
 *
 *   npx tauri build --debug --no-bundle && xvfb-run -a node test/e2e/media.cjs [screenshot-ordner]
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { launch, sleep } = require('./driver.cjs');

const ROOT = path.join(__dirname, '..', '..');
const SHOTS = process.argv[2] || path.join(os.tmpdir(), 'slimsort-media-shots');
fs.mkdirSync(SHOTS, { recursive: true });
async function waitFor(fn, ms = 8000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await sleep(120);
  }
  throw new Error('Zeitüberschreitung: ' + label);
}

/** mittlere Helligkeit eines Bereichs im Screenshot (0–255) */
function brightness(png, box) {
  const out = execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageStat
im = Image.open(sys.argv[1]).convert('L')
w, h = im.size
x0, y0, x1, y1 = [float(v) for v in sys.argv[2:6]]
print(ImageStat.Stat(im.crop((int(w*x0), int(h*y0), int(w*x1), int(h*y1)))).mean[0])
`, png, ...box.map(String)]);
  return Number(String(out).trim());
}

(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'slimsort-media-'));
  const src = path.join(base, 'Import');
  const urlaub = path.join(base, 'Urlaub');
  const userData = path.join(base, 'userdata');
  const xdg = path.join(base, 'xdg');
  for (const d of [src, urlaub, userData, xdg]) fs.mkdirSync(d, { recursive: true });
  // großes, helles Foto mit feiner Struktur (Zoomen) + zwei kleine
  execFileSync('python3', ['-c', `
import sys, random
from PIL import Image, ImageDraw
r = random.Random(3)
im = Image.new('RGB', (6000, 4000), (235, 215, 160))
d = ImageDraw.Draw(im)
for _ in range(3000):
    x, y = r.randint(0, 6000), r.randint(0, 4000)
    c = (r.randint(120, 255), r.randint(120, 255), r.randint(120, 255))
    d.ellipse([x, y, x + r.randint(10, 120), y + r.randint(10, 120)], fill=c)
im.save(sys.argv[1] + '/a-gross.jpg', quality=90)
for i, c in enumerate([(91, 140, 255), (47, 191, 113)]):
    Image.new('RGB', (1200, 800), c).save(sys.argv[1] + f'/c-foto{i}.jpg')
`, src]);
  let video = false;
  try {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25', '-t', '3', '-c:v', 'libvpx', '-b:v', '600k', path.join(src, 'b-video.webm')]);
    video = true;
  } catch {
    console.log('(ffmpeg/libvpx fehlt – Video-Prüfung übersprungen)');
  }
  fs.writeFileSync(
    path.join(userData, 'einstellungen.json'),
    JSON.stringify({
      version: 1,
      onboarded: true,
      tutorialDone: true,
      prefs: { theme: 'dark', lang: 'de', mode: 'expert', activeProfileId: 'p1', seriesEnabled: false, updateCheck: false, sortBy: 'name', videoPlay: 'muted' },
      profiles: [{ id: 'p1', name: 'Meine Ordner', groups: [], targets: [{ id: 't1', name: 'Urlaub', path: urlaub, key: '1', color: '#5b8cff' }] }],
      quickStarts: [{ id: 'q1', name: 'Import', source: src, sources: [src], profileId: 'p1', trashDir: null, startView: 'single', recursive: false, fullscreen: false, lastUsed: 1 }],
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
    await sleep(250);
    const p = path.join(SHOTS, name + '.png');
    await win.screenshot({ path: p });
    return p;
  };
  const saved = () => JSON.parse(fs.readFileSync(path.join(userData, 'einstellungen.json'), 'utf8'));
  const current = () => win.evaluate(() => document.querySelector('[data-testid="single-info"] .ellipsis')?.textContent);
  const blur = () => win.evaluate(() => document.activeElement && document.activeElement.blur());

  // ---------------------------------------------------------------- Tipps & Neues
  await win.waitForSelector('[data-testid="home"]');
  await win.click('[data-testid="home-news"]');
  await win.waitForSelector('[data-testid="news-dialog"]');
  assert.ok((await win.$$('[data-testid="news-card"]')).length >= 6, 'Tipps-Karten');
  await shot('01-news');
  await win.click('[data-testid="news-ok"]');
  await waitFor(() => saved().newsSeen, 4000, 'Tipps gesehen gespeichert');
  console.log('Tipps & Neues ✔');
  // KI ist als Beta gekennzeichnet
  await win.click('[data-testid="settings-btn"]');
  await win.click('[data-testid="settings-ai"]');
  await win.waitForSelector('[data-testid="beta-note"]');
  assert.ok((await win.$$('[data-testid="beta"]')).length >= 2, 'Beta-Kennzeichen');
  await shot('01b-beta');
  await win.keyboard.press('Escape');
  console.log('KI Beta ✔');

  await win.keyboard.press('1');
  await win.waitForSelector('[data-testid="session"]');
  await waitFor(async () => (await current()) === 'a-gross.jpg', 8000, 'großes Foto offen');
  await waitFor(() => win.evaluate(() => !!document.querySelector('.single img.media.ready')), 10000, 'Foto geladen');

  // ---------------------------------------------------------------- Zoomen: kein Schwarz
  await blur();
  for (let i = 0; i < 9; i++) await win.keyboard.press('+');
  await win.waitForSelector('[data-testid="zoom-canvas"]');
  await sleep(1500); // Original laden
  const z = await shot('02-zoom');
  const b = brightness(z, [0.3, 0.3, 0.7, 0.7]);
  console.log('Helligkeit gezoomt:', b.toFixed(0));
  assert.ok(b > 80, `gezoomtes Foto sichtbar, nicht schwarz (${b})`);
  // weiter zoomen und verschieben – bleibt sichtbar
  for (let i = 0; i < 6; i++) await win.keyboard.press('+');
  await sleep(500);
  const b2 = brightness(await shot('03-zoom-more'), [0.3, 0.3, 0.7, 0.7]);
  assert.ok(b2 > 80, `stark gezoomt sichtbar (${b2})`);
  // Trackpad: zwei Finger verschieben das gezoomte Foto (statt zu zoomen)
  const before = await win.evaluate(() => document.querySelector('[data-testid="single"] .overlay-chip.zoom')?.textContent);
  await win.evaluate(() => {
    const el = document.querySelector('[data-testid="single"]');
    for (let i = 0; i < 10; i++) el.dispatchEvent(new WheelEvent('wheel', { deltaX: 12.5, deltaY: 8.25, deltaMode: 0, bubbles: true, cancelable: true, clientX: 600, clientY: 400 }));
  });
  await sleep(300);
  const after = await win.evaluate(() => document.querySelector('[data-testid="single"] .overlay-chip.zoom')?.textContent);
  assert.equal(after, before, 'Trackpad-Wischen ändert den Zoom nicht');
  const b3 = brightness(await shot('03b-pan'), [0.3, 0.3, 0.7, 0.7]);
  assert.ok(b3 > 80, `verschoben sichtbar (${b3})`);
  // Mausrad zoomt weiter
  await win.evaluate(() => document.querySelector('[data-testid="single"]').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, deltaMode: 0, bubbles: true, cancelable: true, clientX: 600, clientY: 400 })));
  await waitFor(async () => (await win.evaluate(() => document.querySelector('[data-testid="single"] .overlay-chip.zoom')?.textContent)) !== before, 3000, 'Mausrad zoomt');
  await win.keyboard.press('Control+0');
  await waitFor(() => win.evaluate(() => !document.querySelector('[data-testid="zoom-canvas"]')), 4000, 'zurück auf ganze Größe');
  console.log('Zoomen ohne schwarze Flächen ✔');

  // ---------------------------------------------------------------- Taste N: Namen/Kästchen aus und an
  await blur();
  await win.keyboard.press('n');
  await waitFor(() => saved().prefs.showFaces === false, 4000, 'N → aus');
  await win.keyboard.press('Control+n');
  await waitFor(() => saved().prefs.showFaces === true, 4000, 'Strg+N → an');
  console.log('Taste N ✔');

  // ---------------------------------------------------------------- Video: Standbild + Wiedergabe
  if (video) {
    await win.keyboard.press('ArrowRight');
    await waitFor(async () => (await current()) === 'b-video.webm', 5000, 'Video offen');
    await win.waitForSelector('[data-testid="video"]');
    // Kann die Webansicht hier überhaupt Videos abspielen? (WebKitGTK unter Linux: nicht über eigene Adressen)
    await waitFor(() => win.evaluate(() => {
      const v = document.querySelector('[data-testid="video"]');
      return v && (v.error || v.currentTime > 0);
    }), 15000, 'Video lädt');
    const unsupported = await win.evaluate(() => document.querySelector('[data-testid="video"]').error?.code === 4);
    if (unsupported) console.log('(Webansicht spielt hier keine Videos ab – Video-Prüfung übersprungen)');
    else {
      // lautlos automatisch
      await waitFor(() => win.evaluate(() => {
        const v = document.querySelector('[data-testid="video"]');
        return v && v.muted && !v.paused && v.currentTime > 0;
      }), 15000, 'Video läuft lautlos').catch(async (e) => {
        console.log('Video:', JSON.stringify(await win.evaluate(() => {
          const v = document.querySelector('[data-testid="video"]');
          return { muted: v.muted, paused: v.paused, t: v.currentTime, rs: v.readyState, ns: v.networkState, err: v.error && v.error.code, poster: v.getAttribute('poster') };
        })));
        throw e;
      });
      // Standbild in der Leiste (nicht ausgeblendet)
      await waitFor(() => win.evaluate(() => {
        const it = [...document.querySelectorAll('.fs-item')].find((x) => x.title === 'b-video.webm');
        const im = it && it.querySelector('img');
        return im && im.style.visibility !== 'hidden' && im.complete && im.naturalWidth > 0;
      }), 15000, 'Video-Standbild in der Leiste');
      await shot('04-video');
      // Einstellung „erst auf Play“
      await win.click('[data-testid="menu-btn"]');
      await win.click('[data-testid="menu-settings"]');
      await win.click('[data-testid="settings-sorting"]');
      await win.evaluate(() => [...document.querySelectorAll('[data-testid="video-play"] button')].find((b) => /Erst auf Play/.test(b.textContent)).click());
      await waitFor(() => saved().prefs.videoPlay === 'click', 4000, 'Einstellung gespeichert');
      await win.keyboard.press('Escape');
      await blur();
      await win.keyboard.press('ArrowLeft');
      await waitFor(async () => (await current()) === 'a-gross.jpg', 5000, 'zurück');
      await win.keyboard.press('ArrowRight');
      await win.waitForSelector('[data-testid="video"]');
      await sleep(1500);
      assert.ok(await win.evaluate(() => document.querySelector('[data-testid="video"]').paused), 'wartet auf Play');
      // Standbild statt schwarz
      await waitFor(() => win.evaluate(() => !!document.querySelector('[data-testid="video"]').getAttribute('poster')), 15000, 'Standbild im Video');
      console.log('Videos ✔');
    }
  }

  // ---------------------------------------------------------------- Zweiter Bildschirm
  await win.click('[data-testid="viewer-toggle"]');
  await win.waitForSelector('[data-testid="dual-banner"]');
  await waitFor(async () => (await win.cmd('GET', '/window/handles')).length === 2, 8000, 'Foto-Fenster offen');
  assert.ok(await win.$('[data-testid="tile"]'), 'Steuerung zeigt alle Fotos');
  await shot('05-dual');
  await win.click('[data-testid="viewer-close"]');
  await waitFor(async () => (await win.cmd('GET', '/window/handles')).length === 1, 8000, 'Foto-Fenster zu');
  await waitFor(() => win.evaluate(() => !document.querySelector('[data-testid="dual-banner"]')), 4000, 'Steuerung wieder normal');
  console.log('Zweiter Bildschirm ✔');

  const errs = fs.readFileSync(path.join(userData, 'app.log'), 'utf8').split('\n').filter((l) => / renderer /.test(l) && !/Autofill|DevTools|404/.test(l));
  assert.deepEqual(errs, [], 'keine Fehler in der Oberfläche');
  await app.close();
  console.log('MEDIEN-E2E OK');
  fs.rmSync(base, { recursive: true, force: true });
  process.exit(0);
})().catch(async (e) => {
  console.error('MEDIEN-E2E FEHLER:', e);
  await globalThis.__app?.page.screenshot({ path: path.join(SHOTS, 'zz-fehler.png') }).catch(() => {});
  await globalThis.__app?.close().catch(() => {});
  process.exit(1);
});
