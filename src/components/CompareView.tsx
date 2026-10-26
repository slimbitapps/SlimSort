import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import {
  useStore, compareToggle, compareKeepOnly, compareKeepAll, compareConfirm, compareSkip, comparePage, comparePageSize,
  rankingFor, type SessionState,
} from '../store';
import type { Item } from '../types';
import { browserCanShow, clamp, mediaUrl, previewUrl, previewSize } from '../util';
import { IconCheck, IconTrash, IconStar, IconChevronLeft, IconChevronRight, IconLayers } from '../icons';
import { tip } from './Tooltip';
import { KeyCap } from './ui';
import { heicUrl, isHeic } from '../heic';

/** Gemeinsamer Ausschnitt für alle Fotos: Zoom (1 = eingepasst) und Mittelpunkt (0–1). */
interface Shared {
  z: number;
  cx: number;
  cy: number;
}

export function CompareView({ s }: { s: SessionState }) {
  const c = s.compare!;
  const expert = useStore((st) => st.settings.prefs.mode === 'expert');
  const [shared, setShared] = useState<Shared>({ z: 1, cx: 0.5, cy: 0.5 });
  const ps = comparePageSize();
  const pages = Math.ceil(c.ids.length / ps);
  const pageIds = c.ids.slice(c.page * ps, c.page * ps + ps);
  const n = pageIds.length;
  const cols = n <= 1 ? 1 : n === 2 ? 2 : n === 3 ? 3 : n === 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const rank = rankingFor(c.ids);
  const keepN = c.ids.filter((id) => c.keep.has(id)).length;
  const dropN = c.ids.length - keepN;

  useEffect(() => setShared({ z: 1, cx: 0.5, cy: 0.5 }), [c.key, c.ids.length]);

  // Tastatur-Zoom (+ / − / Strg+0)
  useEffect(() => {
    const onZoom = (e: Event) => {
      const cmd = (e as CustomEvent).detail;
      setShared((v) => (cmd === 'reset' ? { z: 1, cx: 0.5, cy: 0.5 } : { ...v, z: clamp(v.z * (cmd === 'in' ? 1.4 : 1 / 1.4), 1, 16) }));
    };
    window.addEventListener('fs-zoom', onZoom);
    return () => window.removeEventListener('fs-zoom', onZoom);
  }, []);

  return (
    <div className="compare" data-testid="compare">
      <div className="cmp-top">
        <IconLayers size={17} />
        <span className="title">{c.key !== null ? t('cmp.titleSeries', { n: c.ids.length }) : t('cmp.title', { n: c.ids.length })}</span>
        <span data-testid="cmp-status">
          · {t('cmp.status', { keep: keepN, drop: dropN })}
          {!rank.complete && <span className="faint"> · {t('cmp.analyzing')}</span>}
        </span>
        {pages > 1 && (
          <span className="row" style={{ gap: 4 }}>
            <button className="btn icon ghost sm" disabled={c.page === 0} onClick={() => comparePage(-1)} {...tip(t('cmp.prevPage'), undefined, '←')}>
              <IconChevronLeft size={16} />
            </button>
            <span className="small">{t('cmp.page', { n: c.page + 1, total: pages })}</span>
            <button className="btn icon ghost sm" disabled={c.page >= pages - 1} onClick={() => comparePage(1)} {...tip(t('cmp.nextPage'), undefined, '→')}>
              <IconChevronRight size={16} />
            </button>
            {c.page < pages - 1 && <span className="small faint">{t('cmp.more', { n: c.ids.length - (c.page + 1) * ps })}</span>}
          </span>
        )}
        <span className="small faint" data-testid="cmp-hint">
          {t('cmp.hint')}
        </span>
        <div className="cmp-actions">
          <button className="btn sm" onClick={compareKeepAll} {...tip(t('cmp.keepAll'), t('tip.cmpKeepAll'))}>
            {t('cmp.keepAll')}
          </button>
          <button className="btn sm" onClick={compareSkip} data-testid="cmp-skip" {...tip(t('cmp.single'), t('tip.cmpSingle'), t('key.space'))}>
            {t('cmp.single')}
          </button>
          <button className="btn sm primary" onClick={() => compareConfirm()} data-testid="cmp-confirm" {...tip(t('cmp.done'), t('tip.cmpDone'), 'Enter')}>
            <IconCheck size={15} />
            {t('cmp.done')}
          </button>
        </div>
      </div>
      <div className="cmp-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
        {pageIds.map((id, i) => {
          const it = s.byId.get(id)!;
          return (
            <Cell
              key={id}
              it={it}
              num={i + 1}
              keep={c.keep.has(id)}
              best={rank.best === id && c.ids.length > 1}
              sharpest={rank.sharpest === id && rank.sharpest !== rank.best}
              blurry={(rank.sharpRel.get(id) ?? 1) < 0.45}
              different={rank.different.has(id)}
              sharpRel={rank.sharpRel.get(id)}
              expo={it.expo}
              showMeters={expert}
              shared={shared}
              setShared={setShared}
            />
          );
        })}
      </div>
    </div>
  );
}

const Cell = memo(function Cell(p: {
  it: Item;
  num: number;
  keep: boolean;
  best: boolean;
  sharpest: boolean;
  blurry: boolean;
  different: boolean;
  sharpRel?: number;
  expo?: number;
  showMeters: boolean;
  shared: Shared;
  setShared: React.Dispatch<React.SetStateAction<Shared>>;
}) {
  const { it, shared, setShared } = p;
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 400, h: 300 });
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [hi, setHi] = useState(false);
  const [heicSrc, setHeicSrc] = useState<string | null>(null);
  const failedOnce = useRef(false);
  const drag = useRef<{ x: number; y: number; moved: boolean; sh: Shared } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = nat ? Math.min(box.w / nat.w, box.h / nat.h) : 1;
  const scale = fit * shared.z;
  const w = nat ? nat.w * scale : 0;
  const h = nat ? nat.h * scale : 0;
  // Mittelpunkt so begrenzen, dass kein leerer Rand entsteht
  const cx = w > box.w ? clamp(shared.cx, box.w / 2 / w, 1 - box.w / 2 / w) : 0.5;
  const cy = h > box.h ? clamp(shared.cy, box.h / 2 / h, 1 - box.h / 2 / h) : 0.5;
  const x = box.w / 2 - cx * w;
  const y = box.h / 2 - cy * h;

  useEffect(() => {
    if (!hi && !failedOnce.current && nat && shared.z > 1.4 && browserCanShow(it.ext)) setHi(true);
  }, [shared.z, nat, hi, it.ext]);

  const onWheel = (e: React.WheelEvent) => {
    if (!nat) return;
    const r = ref.current!.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const u = (px - x) / w;
    const v = (py - y) / h;
    const speed = e.ctrlKey ? 0.01 : 0.0018;
    setShared((sh) => {
      const z = clamp(sh.z * Math.exp(-e.deltaY * speed), 1, 16);
      const ns = fit * z;
      return { z, cx: u - (px - box.w / 2) / (nat.w * ns), cy: v - (py - box.h / 2) / (nat.h * ns) };
    });
  };

  return (
    <div
      ref={ref}
      className={`cmp-cell ${p.keep ? 'keep' : 'drop'}`}
      data-testid="cmp-cell"
      data-name={it.name}
      data-keep={p.keep ? '1' : '0'}
      data-best={p.best ? '1' : '0'}
      onWheel={onWheel}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, moved: false, sh: shared };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || !nat) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) < 5) return;
        d.moved = true;
        if (shared.z <= 1) return;
        setShared({ ...d.sh, cx: d.sh.cx - dx / w, cy: d.sh.cy - dy / h });
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved) compareToggle(it.id);
      }}
      onDoubleClick={() => compareKeepOnly(it.id)}
    >
      <img
        key={heicSrc ? 'heic' : hi ? 'hi' : 'lo'}
        src={heicSrc ?? (hi ? mediaUrl(it.path) : previewUrl(it.path, previewSize(box.w, box.h)))}
        alt={it.name}
        decoding="async"
        draggable={false}
        style={nat ? { width: w, height: h, transform: `translate(${x}px, ${y}px)` } : { opacity: 0 }}
        onLoad={(e) => {
          const im = e.currentTarget;
          // Seitenverhältnis bleibt gleich – nur die Pixelgröße ändert sich beim Original
          setNat({ w: im.naturalWidth, h: im.naturalHeight });
        }}
        onError={() => {
          // Original kaputt → Vorschau; Vorschau kaputt → Original (falls möglich)
          if (failedOnce.current) return;
          failedOnce.current = true;
          if (isHeic(it.ext)) {
            heicUrl(it.path, previewSize(box.w, box.h)).then((u) => u && setHeicSrc(u));
            return;
          }
          if (hi) setHi(false);
          else if (browserCanShow(it.ext)) setHi(true);
        }}
      />
      <div className="cmp-badges">
        <span className="cmp-num">
          {p.num}
          <KeyCap k={`⇧${p.num}`} />
        </span>
        {p.best && (
          <span className="cmp-tag best" data-testid="cmp-best">
            <IconStar size={12} />
            {t('cmp.best')}
          </span>
        )}
        {p.sharpest && <span className="cmp-tag">{t('cmp.sharpest')}</span>}
        {p.blurry && !p.different && <span className="cmp-tag warn">{t('cmp.blurry')}</span>}
        {p.different && <span className="cmp-tag other">{t('cmp.different')}</span>}
      </div>
      {p.showMeters && p.sharpRel !== undefined && (
        <div className="cmp-meters">
          <div className="m">
            <span>{t('cmp.sharpness')}</span>
            <span className="bar">
              <i style={{ width: `${Math.round(p.sharpRel * 100)}%` }} />
            </span>
          </div>
          <div className="m">
            <span>{t('cmp.exposure')}</span>
            <span className="bar">
              <i style={{ width: `${Math.round((p.expo ?? 0) * 100)}%` }} />
            </span>
          </div>
        </div>
      )}
      <span className="cmp-state">
        {p.keep ? <IconCheck size={14} strokeWidth={3} /> : <IconTrash size={14} />}
        {p.keep ? t('cmp.keep') : t('cmp.drop')}
      </span>
    </div>
  );
});
