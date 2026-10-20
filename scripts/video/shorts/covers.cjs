'use strict';
/**
 * Titelbilder für Shorts – pro Eintrag automatisch zwei Versionen:
 *   <name>-YouTube.jpg          1080×1920, Bild randlos, Titel oben, Hinweis unten
 *   <name>-TikTok-Instagram.jpg 1080×1920, alles Wichtige in der sicheren Mitte:
 *       Profilraster schneidet auf 3:4 zu (oben/unten je 240 px weg),
 *       TikTok legt unten Text und rechts Knöpfe darüber → Inhalt nur in x 140–940, y 300–1450.
 *
 *   node covers.cjs SPEC.json AUSGABEORDNER
 * SPEC: [{ name, video, t } oder { name, image }, crop: [x, y, w, h], title: 'HTML', sub: 'Text', youtube: true }]
 *   title darf <span class="g">…</span> (Farbverlauf) und <span class="r">…</span> (rot) enthalten.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const [SPEC, OUT] = process.argv.slice(2).map((x) => path.resolve(x));
const items = JSON.parse(fs.readFileSync(SPEC, 'utf8'));
const specDir = path.dirname(SPEC);
fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-'));

const BASE = `* { box-sizing: border-box; } html, body { margin: 0; width: 1080px; height: 1920px; overflow: hidden; background: #070910; font-family: Inter, sans-serif; color: #fff; }
.g { background: linear-gradient(90deg, #3b8bff, #1ec8f0 55%, #3ee089); -webkit-background-clip: text; background-clip: text; color: transparent; }
.r { color: #ff6b6b; }
.t { position: absolute; text-align: center; font-weight: 900; letter-spacing: -3px; line-height: 1.03; text-shadow: 0 10px 40px rgba(0,0,0,.6); }
.chip { position: absolute; left: 50%; transform: translateX(-50%); white-space: nowrap; padding: 18px 36px; border-radius: 999px; background: rgba(14,18,28,.94);
  border: 1px solid rgba(255,255,255,.16); font-size: 48px; font-weight: 800; box-shadow: 0 14px 40px rgba(0,0,0,.45); }`;

function youtube(src, it) {
  return `<style>${BASE}</style>
<img src="${src}" style="position:absolute;inset:0;width:1080px;height:1920px">
<div style="position:absolute;left:0;top:0;width:1080px;height:560px;background:linear-gradient(#070910 70%,rgba(7,9,16,0))"></div>
<div style="position:absolute;left:0;top:1560px;width:1080px;height:360px;background:linear-gradient(rgba(7,9,16,0),#070910 30%)"></div>
<div class="t" style="left:40px;right:40px;top:120px;font-size:118px">${it.title}</div>
<div class="t" style="left:40px;right:40px;top:1720px;font-size:64px;letter-spacing:-1px;font-weight:800">${it.sub}</div>`;
}

function social(src, it) {
  const [cx, cy, cw, ch] = it.crop;
  const w = 800, h = Math.min(660, Math.round((w * ch) / cw)), s = w / cw;
  const top = 640;
  return `<style>${BASE}</style>
<img src="${src}" style="position:absolute;left:-120px;top:-200px;width:1320px;height:2320px;filter:blur(40px) brightness(.25) saturate(1.2)">
<div class="t" style="left:120px;right:120px;top:300px;height:300px;display:flex;align-items:center;justify-content:center;font-size:${it.titleSize || 100}px"><div>${it.title}</div></div>
<div style="position:absolute;left:140px;top:${top}px;width:${w}px;height:${h}px;border-radius:36px;overflow:hidden;box-shadow:0 40px 100px rgba(0,0,0,.65),0 0 0 2px rgba(255,255,255,.12)">
  <img src="${src}" style="position:absolute;width:${1080 * s}px;height:${1920 * s}px;left:${-cx * s}px;top:${-(cy + (ch - h / s) / 2) * s}px">
</div>
<div class="chip" style="top:${top + h + 50}px">${it.sub}</div>`;
}

(async () => {
  const browser = await playwright.chromium.launch({ args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  for (const it of items) {
    let img = it.image && path.resolve(specDir, it.image);
    if (it.video) {
      img = path.join(tmp, it.name + '.png');
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(it.t), '-i', path.resolve(specDir, it.video), '-frames:v', '1', img]);
    }
    const src = 'file://' + img;
    const jobs = [['TikTok-Instagram', social]];
    if (it.youtube !== false) jobs.unshift(['YouTube', youtube]);
    for (const [kind, fn] of jobs) {
      const html = path.join(tmp, `${it.name}-${kind}.html`);
      fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><body>${fn(src, it)}</body>`);
      await page.goto('file://' + html);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(200);
      const out = path.join(OUT, `${it.name}-${kind}.jpg`);
      await page.screenshot({ path: out, type: 'jpeg', quality: 92 });
      console.log(out);
    }
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
