'use strict';
/**
 * Hilfen für Video-Aufnahmen: virtueller Bildschirm (Xvfb), Bildschirmaufnahme (ffmpeg),
 * App/Browser starten, sichtbarer Mauszeiger und Tasten-Einblendung.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');

let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('/opt/node22/lib/node_modules/playwright');
}

const ROOT = path.join(__dirname, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let displayNo = 90;
async function startDisplay(w, h) {
  const d = ':' + displayNo++;
  const p = spawn('Xvfb', [d, '-screen', '0', `${w}x${h}x24`, '-nolisten', 'tcp'], { stdio: 'ignore' });
  await sleep(600);
  return { d, stop: () => p.kill('SIGTERM') };
}

function startRec(display, w, h, out) {
  const p = spawn(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-f', 'x11grab', '-draw_mouse', '0', '-framerate', '30', '-video_size', `${w}x${h}`, '-i', display,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '10', '-pix_fmt', 'yuv420p', out],
    { stdio: ['pipe', 'ignore', 'inherit'] }
  );
  return {
    stop: () =>
      new Promise((res) => {
        p.on('exit', res);
        p.stdin.write('q');
      }),
  };
}

/** Sichtbarer Mauszeiger + Tasten-Einblendung in eine Seite einbauen */
const OVERLAY = `(() => {
  if (window.__vid) return;
  window.__vid = true;
  const st = document.createElement('style');
  st.textContent = \`
    #vid-cursor{position:fixed;left:0;top:0;width:30px;height:30px;z-index:2147483647;pointer-events:none;
      transform:translate(-100px,-100px);filter:drop-shadow(0 2px 4px rgba(0,0,0,.45));transition:transform .02s linear}
    .vid-ripple{position:fixed;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;pointer-events:none;
      z-index:2147483646;border:3px solid rgba(91,140,255,.9);animation:vidr .45s ease-out forwards}
    @keyframes vidr{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}
    #vid-keys{position:fixed;left:50%;bottom:150px;transform:translateX(-50%);z-index:2147483645;pointer-events:none;
      display:flex;align-items:center;gap:14px;padding:14px 22px;border-radius:18px;background:rgba(12,14,20,.86);
      color:#fff;font:600 30px/1 Inter,system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.4);opacity:0}
    #vid-keys.on{animation:vidk 1.1s ease forwards}
    @keyframes vidk{0%{opacity:0;transform:translate(-50%,14px) scale(.92)}12%{opacity:1;transform:translate(-50%,0) scale(1)}
      80%{opacity:1}100%{opacity:0}}
    #vid-keys kbd{display:inline-block;min-width:46px;padding:9px 13px;border-radius:10px;background:#fff;color:#111;
      text-align:center;font:700 28px/1 Inter,system-ui,sans-serif;box-shadow:0 4px 0 #9aa3b5}
    #vid-keys .plus{opacity:.6}
    #vid-keys .lbl{display:flex;align-items:center;gap:10px}
    #vid-keys .dot{width:14px;height:14px;border-radius:50%}
  \`;
  document.head.appendChild(st);
  const c = document.createElement('div');
  c.id = 'vid-cursor';
  c.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M4 2l15 10.5-6.6 1.2 3.9 7.6-3 1.5-3.9-7.6L4 20z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  document.body.appendChild(c);
  addEventListener('mousemove', (e) => { c.style.transform = 'translate(' + (e.clientX - 3) + 'px,' + (e.clientY - 2) + 'px)'; }, true);
  addEventListener('mousedown', (e) => {
    const r = document.createElement('div'); r.className = 'vid-ripple';
    r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
    document.body.appendChild(r); setTimeout(() => r.remove(), 500);
  }, true);
  const k = document.createElement('div'); k.id = 'vid-keys'; document.body.appendChild(k);
  window.__showKeys = (keys, label, color) => {
    k.innerHTML = keys.map((x) => '<kbd>' + x + '</kbd>').join('<span class="plus">+</span>') +
      (label ? '<span class="lbl">→ ' + (color ? '<span class="dot" style="background:' + color + '"></span>' : '') + label + '</span>' : '');
    k.classList.remove('on'); void k.offsetWidth; k.classList.add('on');
  };
})()`;

class Driver {
  constructor(page) {
    this.page = page;
    this.x = 960;
    this.y = 600;
  }
  async inject() {
    await this.page.evaluate(OVERLAY);
    await this.page.mouse.move(this.x, this.y);
  }
  async moveTo(x, y, ms = 600) {
    const steps = Math.max(8, Math.round(ms / 16));
    const sx = this.x, sy = this.y;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      await this.page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e);
      await sleep(ms / steps);
    }
    this.x = x;
    this.y = y;
  }
  async moveToSel(sel, ms = 600, dx = 0, dy = 0) {
    const b = await (await this.page.waitForSelector(sel)).boundingBox();
    await this.moveTo(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, ms);
  }
  async click(sel, ms = 600) {
    await this.moveToSel(sel, ms);
    await sleep(120);
    await this.page.mouse.down();
    await sleep(70);
    await this.page.mouse.up();
  }
  async keys(keys, label, color, press) {
    await this.page.evaluate(([k, l, c]) => window.__showKeys(k, l, c), [keys, label || '', color || '']);
    await sleep(60);
    await this.page.keyboard.press(press);
  }
  async type(text, delay = 90) {
    for (const ch of text) {
      await this.page.keyboard.type(ch);
      await sleep(delay + Math.random() * 40);
    }
  }
}

/** SlimSort starten (Fenster füllt den ganzen virtuellen Bildschirm) */
async function launchApp({ display, w, h, settings, pick, lang = 'en' }) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'slimsort-vid-'));
  fs.writeFileSync(path.join(userData, 'einstellungen.json'), JSON.stringify(settings));
  const app = await playwright._electron.launch({
    executablePath: require(path.join(ROOT, 'node_modules', 'electron')),
    args: [ROOT, '--no-sandbox', '--force-device-scale-factor=1'],
    env: { ...process.env, DISPLAY: display, FOTOSORT_TEST: '1', FOTOSORT_USERDATA: userData, FOTOSORT_PICK: pick || '', LANG: lang === 'de' ? 'de_DE.UTF-8' : 'en_US.UTF-8' },
  });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const b = BrowserWindow.getAllWindows()[0];
    b.setMinimumSize(400, 400);
    b.setBounds({ x: 0, y: 0, width: w, height: h });
  }, [w, h]);
  await sleep(400);
  const drv = new Driver(win);
  return { app, win, drv, userData };
}

/** Webseite in einem rahmenlosen Fenster öffnen (keine Browser-Leiste im Bild) */
async function launchPage({ display, w, h, url }) {
  const app = await playwright._electron.launch({
    executablePath: require(path.join(ROOT, 'node_modules', 'electron')),
    args: [path.join(__dirname, 'viewer.cjs'), '--no-sandbox', '--force-device-scale-factor=1'],
    env: { ...process.env, DISPLAY: display, VIEW_URL: url, VIEW_SIZE: `${w}x${h}`, LANG: 'en_US.UTF-8' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('load');
  return { browser: app, page, drv: new Driver(page) };
}

function makeTargets(base, names, colors) {
  return names.map((name, i) => {
    const p = path.join(base, name);
    fs.mkdirSync(p, { recursive: true });
    return { id: 't' + i, name, path: p, key: String(i + 1), color: colors[i] };
  });
}

function demoPhotos(dir, mode = 'default') {
  execFileSync('python3', [path.join(ROOT, 'scripts', 'make-demo.py'), dir, ...(mode === 'default' ? [] : ['--' + mode])]);
}

module.exports = { ROOT, sleep, startDisplay, startRec, launchApp, launchPage, makeTargets, demoPhotos, Driver };
