import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { useStore, clickSelect, goTo, setView, photoDrag, openPhotoMenu, type SessionState } from '../store';
import { beginDrag } from '../dnd';
import { browserCanPlay, browserCanShow, mediaUrl, thumbUrl } from '../util';
import { heicUrl, isHeic } from '../heic';
import { IconCheck, IconImage, IconVideo } from '../icons';
import type { Item } from '../types';

/** Wird von der Tastatursteuerung für Pfeil hoch/runter benutzt. */
export const gridNav = { cols: 1 };

const GAP = 8;
const PAD = 12;

export function GridView({ s }: { s: SessionState }) {
  const size = useStore((st) => st.settings.prefs.thumbSize);
  const filter = useStore((st) => st.settings.prefs.filter);
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 800, h: 600 });
  const [scrollTop, setScrollTop] = useState(0);
  const raf = useRef(0);

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const n = s.viewIds.length;
  const cols = Math.max(1, Math.floor((box.w - PAD * 2 + GAP) / (size + GAP)));
  gridNav.cols = cols;
  const tileW = (box.w - PAD * 2 - GAP * (cols - 1)) / cols;
  const tileH = Math.round(tileW * 0.75);
  const rowH = tileH + GAP;
  const rows = Math.ceil(n / cols);
  const totalH = PAD * 2 + Math.max(0, rows * rowH - GAP);
  const first = Math.max(0, Math.floor((scrollTop - PAD) / rowH) - 2);
  const last = Math.min(rows - 1, Math.ceil((scrollTop + box.h) / rowH) + 2);
  const thumbPx = tileW * (window.devicePixelRatio || 1) > 300 ? 512 : 256;

  // Aktuelles Bild sichtbar halten
  const curIdx = s.currentId === null ? -1 : s.viewIds.indexOf(s.currentId);
  useEffect(() => {
    const el = ref.current;
    if (!el || curIdx < 0) return;
    const row = Math.floor(curIdx / cols);
    const top = PAD + row * rowH;
    if (top < el.scrollTop) el.scrollTop = top - PAD;
    else if (top + tileH > el.scrollTop + el.clientHeight) el.scrollTop = top + tileH - el.clientHeight + PAD;
  }, [curIdx, cols, rowH, tileH]);

  const tiles = [];
  for (let r = first; r <= last; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (idx >= n) break;
      const id = s.viewIds[idx];
      const it = s.byId.get(id)!;
      tiles.push(
        <Tile
          key={id}
          it={it}
          x={PAD + c * (tileW + GAP)}
          y={PAD + r * rowH}
          w={tileW}
          h={tileH}
          px={thumbPx}
          selected={s.selection.has(id)}
          current={s.currentId === id}
          skipped={s.skipped.has(id)}
          series={s.seriesOf.has(id) ? s.series[s.seriesOf.get(id)!].length : 0}
        />
      );
    }
  }

  return (
    <div
      ref={ref}
      className="grid-scroll"
      data-testid="grid"
      onScroll={(e) => {
        const top = (e.target as HTMLDivElement).scrollTop;
        if (raf.current) return;
        raf.current = requestAnimationFrame(() => {
          raf.current = 0;
          setScrollTop(top);
        });
      }}
    >
      <div style={{ height: totalH, position: 'relative' }}>{tiles}</div>
      {n === 0 && <div className="empty-view">{filter === 'skipped' ? t('ses.emptySkipped') : t('ses.empty')}</div>}
    </div>
  );
}

const Tile = memo(function Tile({
  it, x, y, w, h, px, selected, current, skipped, series,
}: {
  it: Item;
  x: number;
  y: number;
  w: number;
  h: number;
  px: number;
  selected: boolean;
  current: boolean;
  skipped: boolean;
  series: number;
}) {
  // 0 = Vorschaubild, 1 = Original als Ersatz, 2 = keine Anzeige möglich, 3 = HEIC selbst dekodiert, 4 = Bild aus dem Video
  const [stage, setStage] = useState(0);
  const [alt, setAlt] = useState<string | null>(null);
  useEffect(() => setStage(0), [it.path]);
  const failed = stage === 2;
  const onThumbError = () => {
    if (stage === 0 && isHeic(it.ext)) {
      setStage(3);
      heicUrl(it.path, px).then((u) => (u ? setAlt(u) : setStage(2)));
    } else if (stage === 0 && it.kind === 'image' && browserCanShow(it.ext)) setStage(1);
    else if (stage === 0 && it.kind === 'video' && browserCanPlay(it.ext)) setStage(4);
    else setStage(2);
  };
  return (
    <div
      className={`grid-tile ${selected ? 'selected' : ''} ${current ? 'current' : ''}`}
      style={{ left: x, top: y, width: w, height: h }}
      data-testid="tile"
      data-name={it.name}
      onClick={(e) => clickSelect(it.id, { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey })}
      onPointerDown={(e) => beginDrag(e, () => photoDrag(it))}
      onContextMenu={(e) => {
        e.preventDefault();
        openPhotoMenu(it.id, e.clientX, e.clientY);
      }}
      onDoubleClick={() => {
        goTo(it.id);
        setView('single');
      }}
    >
      <div className="thumb">
        {failed ? (
          <div className="ph">
            {it.kind === 'video' ? <IconVideo size={30} /> : <IconImage size={30} />}
            <span>{it.ext.slice(1).toUpperCase()}</span>
          </div>
        ) : stage === 4 ? (
          <video key={it.path} src={mediaUrl(it.path) + '#t=0.5'} muted preload="metadata" playsInline onError={() => setStage(2)} />
        ) : stage === 3 ? (
          alt && <img key={alt} src={alt} decoding="async" draggable={false} alt="" onError={() => setStage(2)} />
        ) : (
          <img
            key={it.path + stage}
            src={stage === 0 ? thumbUrl(it.path, px) : mediaUrl(it.path)}
            loading="lazy"
            decoding="async"
            draggable={false}
            alt=""
            onError={onThumbError}
          />
        )}
      </div>
      <div className="check">{selected && <IconCheck size={13} strokeWidth={3} />}</div>
      <div className="tile-badges">
        {skipped && <span className="tile-badge skip">↷</span>}
        {series > 1 && <span className="tile-badge">⧉ {series}</span>}
        {it.live && <span className="tile-badge">LIVE</span>}
        {it.kind === 'video' && (
          <span className="tile-badge">
            <IconVideo size={11} />
          </span>
        )}
      </div>
      <div className="name ellipsis" title={it.name}>
        {it.name}
      </div>
    </div>
  );
});
