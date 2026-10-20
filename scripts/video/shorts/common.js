// Gemeinsame Bausteine der Shorts (nach motion/core.js laden)
const HD = C.photosHD;
const FOLDERS = [['Family', '#5b8cff'], ['Holiday', '#2fbf71'], ['Nature', '#f5a524'], ['Friends', '#e05bd0']];
const folderSvg = (c, w = 110) => `<svg width="${w}" height="${Math.round(w * 0.82)}" viewBox="0 0 24 20"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h6l2 2.2h10A1.5 1.5 0 0 1 22 5.7V17a1.5 1.5 0 0 1-1.5 1.5h-18A1.5 1.5 0 0 1 1 17z" fill="${c}"/><path d="M1 7h21v10a1.5 1.5 0 0 1-1.5 1.5h-18A1.5 1.5 0 0 1 1 17z" fill="${c}" opacity=".75"/></svg>`;

/** Ordner-Kachel mit Taste; gibt das Element zurück (.ct = Zähler) */
function folderEl(r, i, x, y) {
  const [n, c] = FOLDERS[i];
  const f = el('div', 'folder', r, `${folderSvg(c)}<div class="nm">${n}</div><div class="ct">0 photos</div><div class="kb">${i + 1}</div>`);
  css(f, { left: x + 'px', top: y + 'px' });
  return f;
}
const photosLabel = (n) => `${Math.round(n).toLocaleString('en-US')} ${Math.round(n) === 1 ? 'photo' : 'photos'}`;

/** Große Taste(n) oben, die zum Zeitpunkt t gedrückt werden. keys = [[t, ['Ctrl','A']], …] */
function drawKeys(box, lt, keys) {
  const cur = [...keys].reverse().find(([t]) => lt >= t - 0.1 && lt < t + 0.6);
  if (!cur) { box.innerHTML = ''; return; }
  const [t, label] = cur;
  const kk = p(lt, t - 0.05, 0.1) * (1 - p(lt, t + 0.08, 0.1));
  box.innerHTML = label.map((x) => `<kbd style="transform:translateY(${kk * 10}px);box-shadow:0 ${12 - kk * 10}px 0 #9aa3b5,0 24px 50px rgba(0,0,0,.55)${x.length > 2 ? ';min-width:220px' : ''}">${x}</kbd>`).join('<span class="plus">+</span>');
  box.style.opacity = p(lt, t - 0.1, 0.08) * (1 - p(lt, t + 0.45, 0.15));
}

/** Text erscheint weich (für Überschriften pro Absatz) */
function fadeIn(e, lt, at, dy = 30) {
  const k = E.out(p(lt, at, 0.35));
  e.style.opacity = k;
  e.style.transform = `translateY(${(1 - k) * dy}px)`;
  return k;
}
function popIn(e, lt, at, base = 'translateX(-50%)') {
  const k = E.back(p(lt, at, 0.4));
  e.style.opacity = p(lt, at, 0.15);
  e.style.transform = `${base} scale(${0.6 + 0.4 * k})`;
  return k;
}

/** Abschluss: echte App im Laptop + Logo + „Link in profile“. opts: { label, sub, clip:(lt,D)=>[clip,sec] } */
function ctaScene(opts = {}) {
  scene('cta', (r, s) => {
    s.handheld = 0.8;
    s.a = laptopWin(r, 900, 540, 560);
    s.lbl = el('div', 'chip', r, opts.label || '✓ The real app');
    css(s.lbl, { left: '50%', top: '210px', fontSize: '38px' });
    s.icon = el('img', 'abs', r);
    s.icon.src = ICON;
    css(s.icon, { left: '465px', top: '880px', width: '150px', height: '150px', borderRadius: '36px', boxShadow: '0 20px 60px rgba(30,140,255,.45)' });
    s.name = el('div', 'abs head', r, 'Slim<span class="grad">Sort</span>');
    css(s.name, { top: '1050px', fontSize: '140px', letterSpacing: '-4px' });
    s.free = el('div', 'abs head', r, opts.sub || 'Free · Windows &amp; Mac');
    css(s.free, { top: '1220px', fontSize: '54px', fontWeight: 600, color: '#c7d0e2', letterSpacing: 0 });
    s.btn = el('div', 'abs', r, 'Link in profile ↗');
    css(s.btn, { left: '240px', width: '600px', top: '1340px', textAlign: 'center', padding: '28px 0', borderRadius: '28px', fontSize: '56px', fontWeight: 800,
      background: 'linear-gradient(90deg, #1560f0, #0a9fd0)', boxShadow: '0 16px 50px rgba(21,96,240,.55)' });
    if (opts.extra) { s.extra = el('div', 'chip', r, opts.extra); css(s.extra, { left: '50%', top: '1500px', fontSize: '40px' }); }
  }, (s, lt, D) => {
    const [clip, sec] = opts.clip ? opts.clip(lt, D) : ['grid-light', M['grid-light'].grid + 0.5 + lt * 0.4];
    setImg(s.a.img, frame(clip, sec));
    const k = E.out(p(lt, 0, 0.7));
    place(s.a, { s: 0.92 + 0.06 * k, ry: -12 * (1 - k), y: 30 * (1 - k) });
    s.lbl.style.opacity = p(lt, 0.2, 0.3);
    s.lbl.style.transform = 'translateX(-50%)';
    s.icon.style.transform = `scale(${E.back(p(lt, 0.4, 0.5))})`;
    [s.name, s.free, s.btn].forEach((e, i) => {
      const kk = E.out(p(lt, 0.6 + i * 0.2, 0.5));
      e.style.opacity = kk;
      e.style.transform = `translateY(${(1 - kk) * 40}px)` + (i === 2 ? ` scale(${1 + 0.035 * Math.sin(lt * 5) * p(lt, 1.6, 0.3)})` : '');
    });
    if (s.extra) popIn(s.extra, lt, 1.4);
  });
}
