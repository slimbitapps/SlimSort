// Gemeinsame Bausteine für animierte Videos (Shorts): Zeitleiste, Easing, Fenster, Laptop, Untertitel.
// Eine Szenen-Datei bindet dieses Skript ein, ruft scene(...) auf und am Ende start().
const C = window.CONFIG;
const W = C.w, H = C.h, FPS = 30;
const stage = document.getElementById('stage');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const E = {
  lin: (t) => t,
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
  io: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: (t) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};
const p = (lt, a, d) => clamp((lt - a) / d);
function kf(lt, keys, ease = E.io) {
  if (lt <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (lt <= keys[i][0]) {
      const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
      return lerp(v0, v1, ease((lt - t0) / (t1 - t0)));
    }
  }
  return keys[keys.length - 1][1];
}
function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  (parent || stage).appendChild(e);
  return e;
}
const css = (e, o) => Object.assign(e.style, o);
const pending = [];
function setImg(img, src) {
  if (img._src === src) return;
  img._src = src;
  img.src = src;
  pending.push(img.decode().catch(() => {}));
}
function frame(clip, sec) {
  const f = C.frames[clip];
  const i = clamp(Math.round(sec * FPS) + 1, 1, f.count);
  return `${f.dir}/${String(i).padStart(5, '0')}.jpg`;
}
const M = C.marks;
const photos = C.photos;
const ICON = C.icon;
const MARK = C.mark;

function words(parent, text, style, cls = '') {
  const box = el('div', 'abs', parent);
  css(box, style);
  box._w = text.split(/(\s+)/).filter((x) => x.length).map((w) => {
    if (/^\s+$/.test(w)) { box.appendChild(document.createTextNode(' ')); return null; }
    return el('span', 'word ' + cls, box, w);
  }).filter(Boolean);
  return box;
}
function drawWords(box, lt, start, stagger = 0.09) {
  box._w.forEach((w, i) => {
    const k = E.out(p(lt, start + i * stagger, 0.4));
    w.style.opacity = k;
    w.style.transform = `translateY(${(1 - k) * 40}px) scale(${0.9 + 0.1 * k})`;
    w.style.filter = k < 1 ? `blur(${(1 - k) * 10}px)` : 'none';
  });
}
function place(o, { x = 0, y = 0, s = 1, rx = 0, ry = 0, rz = 0, op = 1 }) {
  o.win.style.transform = `perspective(2200px) translate3d(${x}px, ${y}px, 0) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${s})`;
  o.win.style.opacity = op;
}
function shake(t, a = 1) {
  const x = (Math.sin(t * 1.7) * 2.2 + Math.sin(t * 3.1 + 1) * 1.1 + Math.sin(t * 7.3 + 2) * 0.35) * a;
  const y = (Math.sin(t * 1.3 + 3) * 1.8 + Math.sin(t * 2.7) * 1.0 + Math.sin(t * 6.9 + 1) * 0.3) * a;
  const r = (Math.sin(t * 0.9 + 2) * 0.12 + Math.sin(t * 2.3) * 0.05) * a;
  return `translate(${x}px, ${y}px) rotate(${r}deg)`;
}
/** Schreibtisch mit Lampenlicht (füllt die ganze Fläche) */
function desk(parent) {
  const d = el('div', 'abs', parent);
  css(d, { inset: '-40px', background: [
    'radial-gradient(ellipse at 78% 14%, rgba(255,196,120,.35) 0%, transparent 38%)',
    'radial-gradient(circle at 12% 24%, rgba(255,220,160,.22) 0%, transparent 9%)',
    'radial-gradient(circle at 26% 16%, rgba(140,170,255,.18) 0%, transparent 7%)',
    'radial-gradient(circle at 90% 34%, rgba(255,200,140,.2) 0%, transparent 6%)',
    'linear-gradient(180deg, #24201d 0%, #1a1715 58%, #000 58.2%, #3a2a1f 59%, #2b1f17 78%, #1c140f 100%)',
  ].join(',') });
  const wood = el('div', 'abs', d);
  css(wood, { left: 0, right: 0, top: '59%', bottom: 0, opacity: 0.35,
    background: 'repeating-linear-gradient(92deg, rgba(0,0,0,.25) 0 2px, transparent 2px 9px, rgba(255,255,255,.04) 9px 11px, transparent 11px 23px)' });
  return d;
}
/** Laptop von vorne, Bildschirm zeigt einen Rohclip */
function laptopWin(parent, w, cx = W / 2, cy = H / 2) {
  const h = Math.round((w * 9) / 16);
  const L = w + 40, Hh = h + 40;
  const rig = el('div', 'abs', parent);
  css(rig, { width: L + 'px', height: Hh + 40 + 'px', left: cx - L / 2 + 'px', top: cy - Hh / 2 + 'px', transformOrigin: '50% 60%' });
  const lid = el('div', 'abs', rig);
  css(lid, { left: 0, top: 0, width: L + 'px', height: Hh + 'px', borderRadius: '22px 22px 6px 6px',
    background: 'linear-gradient(180deg, #2c2f35, #1d1f23)', boxShadow: '0 40px 100px rgba(0,0,0,.7), inset 0 0 0 2px #3a3e46' });
  const bez = el('div', 'abs', lid);
  css(bez, { left: '10px', top: '10px', right: '10px', bottom: '10px', borderRadius: '14px', background: '#050506' });
  const scr = el('div', 'abs', lid);
  css(scr, { left: '20px', top: '20px', width: w + 'px', height: h + 'px', overflow: 'hidden', borderRadius: '5px', background: '#000' });
  const img = el('img', '', scr);
  css(img, { width: '100%', height: '100%', display: 'block' });
  const glare = el('div', 'abs', scr);
  css(glare, { inset: 0, background: 'linear-gradient(115deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,0) 35%, rgba(255,255,255,0) 70%, rgba(255,255,255,.04) 100%)' });
  const base = el('div', 'abs', rig);
  css(base, { left: '-50px', top: Hh + 'px', width: L + 100 + 'px', height: '26px', borderRadius: '0 0 24px 24px',
    background: 'linear-gradient(180deg, #4a4e57 0%, #2a2d33 40%, #15161a 100%)', boxShadow: '0 24px 50px rgba(0,0,0,.6)' });
  return { win: rig, img, w, h };
}
/** Ausschnitt eines Rohclips groß zeigen (z. B. Foto + Tastenleiste), mit abgerundeten Ecken */
function cropWin(parent, { x, y, w, h, srcX, srcY, scale }) {
  const box = el('div', 'abs', parent);
  css(box, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', overflow: 'hidden', borderRadius: '28px',
    boxShadow: '0 30px 90px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08)', background: '#0b0c0f' });
  const img = el('img', '', box);
  css(img, { position: 'absolute', width: 1920 * scale + 'px', height: 1080 * scale + 'px', left: -srcX * scale + 'px', top: -srcY * scale + 'px' });
  return { win: box, img };
}

// ---------- Untertitel (Wort-Gruppen, aktuelles Wort hervorgehoben)
function captionsLayer(top) {
  const box = el('div', 'abs', stage);
  css(box, { left: '60px', right: '60px', top: top + 'px', textAlign: 'center', zIndex: 40 });
  return box;
}
function drawCaptions(box, t) {
  const cur = C.captions.find((c) => t >= c.t0 && t < c.t1);
  if (!cur) { box.innerHTML = ''; return; }
  const k = E.back(p(t, cur.t0, 0.18));
  const words = cur.text.split(' ');
  const per = (cur.t1 - cur.t0) / words.length;
  box.innerHTML = words.map((w, i) => {
    const on = t >= cur.t0 + i * per;
    return `<span style="display:inline-block;margin:0 10px;color:${on ? '#fff' : 'rgba(255,255,255,.55)'};${on && t < cur.t0 + (i + 1) * per ? 'background:linear-gradient(90deg,#2f7bff,#1ec8f0);border-radius:14px;padding:0 12px;' : ''}">${w}</span>`;
  }).join('');
  css(box, { fontSize: '74px', fontWeight: 900, lineHeight: 1.25, letterSpacing: '-1px', textShadow: '0 6px 0 rgba(0,0,0,.55), 0 10px 40px rgba(0,0,0,.6)',
    transform: `scale(${0.85 + 0.15 * k})` });
}

// ---------- Hintergrund, Filmkorn, Zeitleiste
const bg = el('div', 'abs', stage);
css(bg, { inset: 0 });
function drawBg(t) {
  const a = (x, y, c, r) => `radial-gradient(circle at ${x}% ${y}%, ${c} 0%, transparent ${r}%)`;
  bg.style.background = [
    a(20 + 12 * Math.sin(t * 0.21), 30 + 10 * Math.cos(t * 0.17), 'rgba(47,123,255,.32)', 45),
    a(80 + 10 * Math.cos(t * 0.19), 70 + 12 * Math.sin(t * 0.23), 'rgba(62,224,137,.18)', 42),
    'linear-gradient(160deg, #0a0f1d 0%, #070910 60%, #0a0d14 100%)',
  ].join(',');
}
const scenes = [];
/** Szene über `span` Sprechtext-Absätze. s.pOff = Startzeiten der Absätze relativ zur Szene,
 *  s.sfx(D) kann Soundeffekte liefern: [{ t, type }] (Zeit relativ zur Szene). */
function scene(key, build, draw, span = 1) {
  const root = el('div', 'scene', stage);
  const s = { key, root, draw, span };
  build(root, s);
  scenes.push(s);
}
function start({ captionTop = 1420 } = {}) {
  const cap = captionsLayer(captionTop);
  const grain = el('div', 'abs', stage);
  css(grain, { inset: 0, pointerEvents: 'none', mixBlendMode: 'overlay', opacity: 0.08, zIndex: 50 });
  const grains = [];
  for (let i = 0; i < 6; i++) {
    const cv = document.createElement('canvas');
    cv.width = 360; cv.height = 640;
    const g = cv.getContext('2d');
    const im = g.createImageData(360, 640);
    for (let k = 0; k < im.data.length; k += 4) { const v = Math.random() * 255; im.data[k] = im.data[k + 1] = im.data[k + 2] = v; im.data[k + 3] = 255; }
    g.putImageData(im, 0, 0);
    grains.push(cv.toDataURL());
  }
  const vig = el('div', 'abs', stage);
  css(vig, { inset: 0, pointerEvents: 'none', zIndex: 51, background: 'radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,.4) 100%)' });
  // Absatz-Längen zu Szenen-Längen zusammenfassen
  const DUR = [], starts = [];
  window.SFX = [];
  {
    let t = 0, pi = 0;
    for (const s of scenes) {
      const ds = C.durations.slice(pi, pi + s.span);
      s.pOff = ds.map((_, k) => ds.slice(0, k).reduce((a, b) => a + b, 0));
      starts.push(t);
      DUR.push(ds.reduce((a, b) => a + b, 0));
      if (s.sfx) for (const e of s.sfx(DUR[DUR.length - 1])) window.SFX.push({ t: t + e.t, type: e.type });
      t += DUR[DUR.length - 1];
      pi += s.span;
    }
    window.TOTAL = t;
  }
  const FADE = 0.25;
  window.render = async (t) => {
    pending.length = 0;
    drawBg(t);
    grain.style.background = `url(${grains[Math.floor(t * 30) % grains.length]}) 0 0 / 360px 640px repeat`;
    scenes.forEach((s, i) => {
      const lt = t - starts[i], D = DUR[i];
      const on = lt >= -FADE && lt < D + 0.001;
      s.root.style.display = on ? 'block' : 'none';
      if (!on) return;
      const fin = E.out(clamp((lt + FADE) / FADE)), fout = i === scenes.length - 1 ? 1 : 1 - E.in(clamp((lt - (D - FADE)) / FADE));
      s.root.style.opacity = Math.min(fin, fout);
      s.root.style.transform = `scale(${1 + 0.05 * (1 - fin) - 0.03 * (1 - fout)})` + (s.handheld ? ' ' + shake(t, s.handheld) : '');
      s.draw(s, Math.max(0, lt), D);
    });
    drawCaptions(cap, t);
    await Promise.all(pending);
  };
}
