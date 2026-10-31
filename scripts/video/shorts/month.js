// Bausteine für den Video-Monat (Tipps, Infos, Werbung für alle SlimBit-Apps). Nach core.js + common.js laden.
// Jede Szene = ein Absatz des Sprechtexts; Ereignisse relativ zur Szenenlänge D setzen.
const P = (n) => HD.find((x) => x.includes('/' + n + '.')) || '';

/** Überschrift oben (HTML erlaubt), erscheint weich */
function head(r, html, top = 150, size = 84) {
  const e = el('div', 'abs head', r, html);
  css(e, { top: top + 'px', fontSize: size + 'px' });
  return e;
}
function sub(r, html, top, size = 50) {
  const e = el('div', 'abs head', r, html);
  css(e, { top: top + 'px', fontSize: size + 'px', fontWeight: 700, color: '#c7d0e2', letterSpacing: 0, lineHeight: 1.3 });
  return e;
}
/** Bild in abgerundetem Kasten */
function shot(r, src, { x, y, w, h, fit = 'cover', radius = 28, pos = '50% 50%' }) {
  const b = el('div', 'abs', r, `<img src="${src}" style="width:100%;height:100%;object-fit:${fit};object-position:${pos};display:block">`);
  css(b, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', borderRadius: radius + 'px', overflow: 'hidden',
    boxShadow: '0 30px 90px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08)', background: '#0b0c0f' });
  return b;
}
/** Handy mit Bildschirminhalt (Seitenverhältnis 9:19,5) */
function phone(r, src, { x, y, w = 380 }) {
  const h = Math.round(w * 2.08);
  const b = el('div', 'abs', r, `<div style="position:absolute;inset:14px;border-radius:${w * 0.11}px;overflow:hidden;background:#000"><img src="${src}" style="width:100%;height:100%;object-fit:cover;object-position:50% 0;display:block"></div>`);
  css(b, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', borderRadius: w * 0.14 + 'px', background: 'linear-gradient(160deg,#30343c,#16181c)',
    boxShadow: '0 40px 100px rgba(0,0,0,.7), inset 0 0 0 2px #444a55' });
  return b;
}
/** Laptop mit Bild (16:9) */
function laptop(r, src, w = 940, cy = 1000) {
  const o = laptopWin(r, w, W / 2, cy);
  o.img.src = src;
  o.img.style.objectFit = 'cover';
  return o;
}
/** Neutrales Einstellungs-Fenster (bewusst kein echtes Windows-Design). rows: [[Text, Wert]] */
function settingsWin(r, title, rows, { x = 70, y = 520, w = 940 } = {}) {
  const box = el('div', 'win', r, `<div class="bar"><div class="dots"><i></i><i></i><i></i></div>${title}</div>`);
  css(box, { left: x + 'px', top: y + 'px', width: w + 'px' });
  const list = el('div', '', box);
  css(list, { padding: '18px 26px 26px' });
  box.rows = rows.map(([a, b]) => {
    const e = el('div', '', list, `<span>${a}</span><span class="v" style="color:#a9b3c8">${b || ''}</span>`);
    css(e, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 26px', margin: '8px 0', borderRadius: '18px',
      background: 'rgba(255,255,255,.04)', fontSize: '38px', fontWeight: 600, transition: 'none' });
    return e;
  });
  return box;
}
/** Zeile hervorheben (Rahmen + leichtes Pulsieren) */
function highlight(e, on, lt) {
  e.style.background = on ? 'rgba(47,123,255,.22)' : 'rgba(255,255,255,.04)';
  e.style.boxShadow = on ? `0 0 0 3px #2f7bff, 0 0 ${30 + 10 * Math.sin(lt * 6)}px rgba(47,123,255,.5)` : 'none';
}
/** Mauszeiger (einfacher Pfeil) */
function cursor(r) {
  const c = el('div', 'abs', r, '<svg width="70" height="70" viewBox="0 0 24 24"><path d="M4 2l15 11-6.5 1.2L16 21l-3 1.4-3.3-6.6L4 20z" fill="#fff" stroke="#000" stroke-width="1.2"/></svg>');
  c.style.zIndex = 30;
  return c;
}
function moveCursor(c, lt, keys) {
  const x = kf(lt, keys.map(([t, x]) => [t, x])), y = kf(lt, keys.map(([t, , y]) => [t, y]));
  css(c, { left: x + 'px', top: y + 'px' });
}
/** Tasten-Leiste (drawKeys aus common.js) */
function keyBox(r, top = 1200) {
  const k = el('div', 'cap', r);
  css(k, { top: top + 'px' });
  return k;
}
/** großer Zahlen-/Fakt-Block */
function big(r, html, top, size = 160) {
  const e = el('div', 'abs head', r, html);
  css(e, { top: top + 'px', fontSize: size + 'px' });
  return e;
}
/** Hinweis-Chip unten */
function chip(r, html, top, size = 40) {
  const e = el('div', 'chip', r, html);
  css(e, { left: '50%', top: top + 'px', fontSize: size + 'px' });
  e.style.transform = 'translateX(-50%)';
  return e;
}
function chipIn(e, lt, at) {
  e.style.opacity = p(lt, at, 0.3);
  e.style.transform = `translateX(-50%) scale(${0.8 + 0.2 * E.back(p(lt, at, 0.4))})`;
}

/** Schluss allgemeiner Videos: Kanal folgen */
function followScene(topic = 'more PC tips') {
  scene('follow', (r, s) => {
    s.i = el('img', 'abs', r);
    s.i.src = P('icon-slimbit');
    css(s.i, { left: '415px', top: '560px', width: '250px', height: '250px', borderRadius: '60px', boxShadow: '0 20px 60px rgba(30,140,255,.4)' });
    s.a = big(r, 'Follow for<br><span class="grad">' + topic + '</span>', 880, topic.length > 14 ? 88 : 110);
    s.b = sub(r, '@slimbitapps', 1230, 60);
  }, (s, lt) => {
    s.i.style.transform = `scale(${E.back(p(lt, 0.05, 0.5))})`;
    fadeIn(s.a, lt, 0.3);
    fadeIn(s.b, lt, 0.7);
  });
}
/** Schluss der Werbe-Videos: App + „Free · Windows & Mac“ + „Link in profile“ */
function productCta({ name, grad, icon, app, sub: subtitle = 'Free · Windows &amp; Mac', color = 'linear-gradient(90deg, #1560f0, #0a9fd0)' }) {
  scene('cta', (r, s) => {
    s.a = laptop(r, app, 860, 540);
    s.i = el('img', 'abs', r);
    s.i.src = icon;
    css(s.i, { left: '465px', top: '880px', width: '150px', height: '150px', borderRadius: '36px', boxShadow: '0 20px 60px rgba(30,140,255,.45)' });
    s.n = el('div', 'abs head', r, `${name}<span class="grad">${grad}</span>`);
    css(s.n, { top: '1050px', fontSize: '130px', letterSpacing: '-4px' });
    s.f = sub(r, subtitle, 1220, 54);
    s.btn = el('div', 'abs', r, 'Link in profile ↗');
    css(s.btn, { left: '240px', width: '600px', top: '1340px', textAlign: 'center', padding: '28px 0', borderRadius: '28px', fontSize: '56px', fontWeight: 800, background: color, boxShadow: '0 16px 50px rgba(21,96,240,.55)' });
  }, (s, lt) => {
    const k = E.out(p(lt, 0, 0.7));
    place(s.a, { s: 0.92 + 0.06 * k, ry: -12 * (1 - k), y: 30 * (1 - k) });
    s.i.style.transform = `scale(${E.back(p(lt, 0.3, 0.5))})`;
    [s.n, s.f, s.btn].forEach((e, i) => {
      const kk = E.out(p(lt, 0.5 + i * 0.2, 0.5));
      e.style.opacity = kk;
      e.style.transform = `translateY(${(1 - kk) * 40}px)` + (i === 2 ? ` scale(${1 + 0.035 * Math.sin(lt * 5) * p(lt, 1.5, 0.3)})` : '');
    });
  });
}
