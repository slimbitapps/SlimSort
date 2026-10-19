'use strict';
/**
 * Rendert das Intro-Video Bild für Bild aus compositor.html.
 *   node render.cjs ARBEITSORDNER [--voice stimme.mp3] [--durations 6.5,8,…] [--preview] [--from s --to s]
 * Erwartet in ARBEITSORDNER: raw/*.json (Zeitmarken), frames/<clip>/00001.jpg …, thumbs/*.jpg
 */
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = path.join(__dirname, '..', '..', '..');
const args = process.argv.slice(2);
const WORK = path.resolve(args[0]);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PREVIEW = args.includes('--preview');
const VOICE = opt('--voice', null);
const MUSIC = opt('--music', null);
// Standard-Szenenlängen (geschätzt aus dem Sprechtext) – mit Stimme werden sie genau angepasst
const DURATIONS = (opt('--durations', '6.5,9.5,5.2,8,11,6,11,13,9,8,8')).split(',').map(Number);
const OUT = opt('--out', path.join(WORK, 'out', PREVIEW ? 'Intro-Vorschau.mp4' : 'SlimSort-Intro.mp4'));
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const marks = {};
for (const f of fs.readdirSync(path.join(WORK, 'raw')).filter((f) => f.endsWith('.json'))) {
  marks[f.replace('.json', '')] = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(WORK, 'raw', f))).marks.map((m) => [m.m, m.t]));
}
const frames = {};
for (const c of fs.readdirSync(path.join(WORK, 'frames'))) {
  frames[c] = { dir: 'file://' + path.join(WORK, 'frames', c), count: fs.readdirSync(path.join(WORK, 'frames', c)).length };
}
const photos = fs.readdirSync(path.join(WORK, 'thumbs')).sort().map((f) => 'file://' + path.join(WORK, 'thumbs', f));
const CONFIG = { marks, frames, photos, durations: DURATIONS, icon: 'file://' + path.join(ROOT, 'build', 'icon.png') };

(async () => {
  const browser = await playwright.chromium.launch({ args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (e) => console.error('Seitenfehler:', e.message));
  await page.addInitScript((c) => (window.CONFIG = c), CONFIG);
  await page.goto('file://' + path.join(__dirname, 'compositor.html'));
  await page.waitForFunction(() => window.render && document.fonts.ready);
  const total = await page.evaluate(() => window.TOTAL);
  const stills = opt('--stills', null);
  if (stills) {
    // Einzelbilder zur Kontrolle
    for (const t of stills.split(',').map(Number)) {
      await page.evaluate((tt) => window.render(tt), t);
      await page.screenshot({ path: path.join(path.dirname(OUT), `still-${String(Math.round(t * 10)).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 80 });
    }
    await browser.close();
    return console.log('Standbilder:', path.dirname(OUT), 'Länge', total);
  }
  const fps = PREVIEW ? 15 : 30;
  const from = Number(opt('--from', 0)), to = Number(opt('--to', total));
  const n = Math.round((to - from) * fps);
  const ff = ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-'];
  if (VOICE) ff.push('-i', VOICE);
  if (MUSIC) ff.push('-stream_loop', '-1', '-i', MUSIC);
  const vf = PREVIEW ? ['-vf', 'scale=960:540'] : [];
  let af = [];
  if (VOICE && MUSIC) af = ['-filter_complex', `[2:a]volume=0.12,afade=t=out:st=${total - 3}:d=3[m];[1:a][m]amix=inputs=2:duration=first:normalize=0[a]`, '-map', '0:v', '-map', '[a]'];
  else if (VOICE) af = ['-map', '0:v', '-map', '1:a'];
  ff.push(...vf, ...af, '-t', String(to - from), '-c:v', 'libx264', '-preset', PREVIEW ? 'veryfast' : 'medium', '-crf', PREVIEW ? '26' : '16',
    '-pix_fmt', 'yuv420p', '-r', '30', ...(VOICE ? ['-c:a', 'aac', '-b:a', '192k'] : []), '-movflags', '+faststart', OUT);
  const enc = spawn('ffmpeg', ff, { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const t = from + i / fps;
    await page.evaluate((tt) => window.render(tt), t);
    const buf = await page.screenshot({ type: 'jpeg', quality: PREVIEW ? 80 : 94 });
    if (!enc.stdin.write(buf)) await new Promise((r) => enc.stdin.once('drain', r));
    if (i % 150 === 0) console.log(`${(t).toFixed(1)} s / ${to.toFixed(1)} s  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  enc.stdin.end();
  await new Promise((r) => enc.on('exit', r));
  await browser.close();
  console.log('fertig:', OUT, `(${total.toFixed(1)} s)`);
})().catch((e) => { console.error(e); process.exit(1); });
