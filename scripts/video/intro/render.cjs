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
const PAGE = path.resolve(opt('--page', path.join(__dirname, 'compositor.html')));
const VW = Number(opt('--w', 1920)), VH = Number(opt('--h', 1080));
const TEXT = opt('--text', null);           // Sprechtext → Untertitel im Bild
const VOICEDIR = opt('--voicedir', null);   // Absatz-Dateien (genaue Längen für Untertitel)
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
const hdDir = path.join(WORK, 'photos-hd');
const photosHD = fs.existsSync(hdDir) ? fs.readdirSync(hdDir).sort().map((f) => 'file://' + path.join(hdDir, f)) : photos;
// Untertitel: je Absatz in Gruppen zu 3 Wörtern, Zeit verteilt nach Zeichenzahl
const captions = [];
if (TEXT) {
  const paras = fs.readFileSync(TEXT, 'utf8').split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  const { execFileSync } = require('node:child_process');
  let start = 0;
  paras.forEach((par, i) => {
    let len = par.split(/\s+/).length / 3.0;
    const f = VOICEDIR && path.join(VOICEDIR, `absatz-${String(i + 1).padStart(2, '0')}.wav`);
    if (f && fs.existsSync(f)) len = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString()) - 0.45;
    const words = par.split(/\s+/);
    const groups = [];
    for (let k = 0; k < words.length; k += 3) groups.push(words.slice(k, k + 3).join(' '));
    const total = groups.reduce((a, g) => a + g.length, 0);
    let t = start + 0.35;
    for (const g of groups) {
      const d = (len * g.length) / total;
      captions.push({ t0: t, t1: t + d, text: g });
      t += d;
    }
    start += DURATIONS[i];
  });
}
const CONFIG = { marks, frames, photos, photosHD, durations: DURATIONS, captions, w: VW, h: VH,
  icon: 'file://' + path.join(ROOT, 'build', 'icon.png'), mark: 'file://' + path.join(ROOT, 'brand-site', 'logo-mark.png') };

(async () => {
  const browser = await playwright.chromium.launch({ args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  page.on('pageerror', (e) => console.error('Seitenfehler:', e.message));
  await page.addInitScript((c) => (window.CONFIG = c), CONFIG);
  await page.goto('file://' + PAGE);
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
  // Soundeffekte (Tastenklick, Wusch …) mit der Stimme zu einer Tonspur mischen
  const sfx = await page.evaluate(() => window.SFX || []);
  let voice = VOICE;
  if (sfx.length) {
    const { execFileSync } = require('node:child_process');
    const dir = path.join(__dirname, '..', 'motion', 'sfx');
    const VOL = { click: 0.24, whoosh: 0.13, 'whoosh-back': 0.13, pop: 0.16 };
    const ins = [], fl = [];
    let k = 0;
    if (VOICE) { ins.push('-i', VOICE); fl.push(`[${k}:a]aformat=sample_rates=48000:channel_layouts=mono,asplit[v][key]`); k++; }
    else { ins.push('-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=r=48000:cl=mono'); fl.push(`[${k}:a]anull,asplit[v][key]`); k++; }
    sfx.forEach((e, i) => {
      ins.push('-i', path.join(dir, e.type + '.wav'));
      const ms = Math.max(0, Math.round(e.t * 1000));
      fl.push(`[${k}:a]volume=${VOL[e.type] || 0.4},adelay=${ms}|${ms}[s${i}]`);
      k++;
    });
    // Effekte leiser, solange gesprochen wird (Ducking), damit die Stimme verständlich bleibt
    fl.push(sfx.map((_, i) => `[s${i}]`).join('') + `amix=inputs=${sfx.length}:normalize=0[fx]`);
    fl.push('[fx][key]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=250[fxd]');
    fl.push('[v][fxd]amix=inputs=2:normalize=0:duration=first[out]');
    voice = path.join(path.dirname(OUT), path.basename(OUT, '.mp4') + '-ton.wav');
    execFileSync('ffmpeg', ['-y', '-v', 'error', ...ins, '-filter_complex', fl.join(';'), '-map', '[out]', '-ar', '48000', voice]);
    if (args.includes('--audio-only')) { await browser.close(); return console.log('Tonspur:', voice); }
  }
  const fps = PREVIEW ? 15 : 30;
  const from = Number(opt('--from', 0)), to = Number(opt('--to', total));
  const n = Math.round((to - from) * fps);
  const ff = ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-'];
  if (voice) ff.push('-i', voice);
  if (MUSIC) ff.push('-stream_loop', '-1', '-i', MUSIC);
  const vf = PREVIEW ? ['-vf', `scale=${VW / 2}:${VH / 2}`] : [];
  let af = [];
  if (voice && MUSIC) af = ['-filter_complex', `[2:a]volume=0.12,afade=t=out:st=${total - 3}:d=3[m];[1:a][m]amix=inputs=2:duration=first:normalize=0[a]`, '-map', '0:v', '-map', '[a]'];
  else if (voice) af = ['-map', '0:v', '-map', '1:a'];
  ff.push(...vf, ...af, '-t', String(to - from), '-c:v', 'libx264', '-preset', PREVIEW ? 'veryfast' : 'medium', '-crf', PREVIEW ? '26' : '16',
    '-pix_fmt', 'yuv420p', '-r', '30', ...(voice ? ['-c:a', 'aac', '-b:a', '192k'] : []), '-movflags', '+faststart', OUT);
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
