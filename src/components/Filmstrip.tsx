import { useLayoutEffect, useRef, useState } from 'react';
import { heicUrl, isHeic } from '../heic';
import { goTo, currentIndex, step, openPhotoMenu, type SessionState } from '../store';
import { browserCanShow, mediaUrl, thumbUrl } from '../util';
import { IconVideo } from '../icons';
import { videoFrame } from '../videothumb';

const ITEM_W = 46;
const STEP = ITEM_W + 6;

/** Bildleiste wie in Apple Fotos: aktuelles Bild in der Mitte, Ziehen blättert schnell. */
export function Filmstrip({ s }: { s: SessionState }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const [drag, setDrag] = useState<{ startX: number; startIdx: number; dx: number; moved: boolean } | null>(null);
  const raf = useRef(0);

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const n = s.viewIds.length;
  const cur = currentIndex(s);
  if (!n) return <div className="filmstrip" ref={ref} />;

  // Während des Ziehens: Pixelversatz relativ zur aktuellen Position
  const offset = drag ? drag.dx + (cur - drag.startIdx) * STEP : 0;
  const half = Math.ceil(w / STEP / 2) + 3;
  const lo = Math.max(0, cur - half - Math.ceil(Math.abs(offset) / STEP));
  const hi = Math.min(n - 1, cur + half + Math.ceil(Math.abs(offset) / STEP));
  const center = w / 2 - ITEM_W / 2;

  const items = [];
  for (let k = lo; k <= hi; k++) {
    const id = s.viewIds[k];
    const it = s.byId.get(id)!;
    const x = center + (k - cur) * STEP + offset;
    if (x < -ITEM_W * 2 || x > w + ITEM_W) continue;
    items.push(
      <div
        key={id}
        data-idx={k}
        className={`fs-item ${k === cur ? 'current' : ''} ${s.skipped.has(id) ? 'skipped' : ''} ${s.seriesOf.has(id) ? 'in-series' : ''}`}
        style={{ left: x }}
        title={it.name}
        onContextMenu={(e) => {
          e.preventDefault();
          openPhotoMenu(id, e.clientX, e.clientY);
        }}
      >
        <img src={thumbUrl(it.path, 256)} loading="lazy" decoding="async" alt="" draggable={false} onError={(e) => {
            // Ersatz: Original (der Browser verkleinert selbst), sonst ausblenden
            const im = e.currentTarget;
            if (!im.dataset.fb && isHeic(it.ext)) {
              im.dataset.fb = '1';
              heicUrl(it.path, 256).then((u) => (u ? (im.src = u) : (im.style.visibility = 'hidden')));
            } else if (!im.dataset.fb && it.kind === 'video') {
              im.dataset.fb = '1';
              videoFrame(it.path, 256, it.ext).then((u) => (u ? (im.src = u) : (im.style.visibility = 'hidden')));
            } else if (!im.dataset.fb && it.kind === 'image' && browserCanShow(it.ext)) {
              im.dataset.fb = '1';
              im.src = mediaUrl(it.path);
            } else im.style.visibility = 'hidden';
          }} />
        {it.kind === 'video' && <IconVideo size={12} className="vid" />}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={`filmstrip ${drag ? 'dragging' : ''}`}
      data-testid="filmstrip"
      onWheel={(e) => step(Math.sign(e.deltaY || e.deltaX))}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag({ startX: e.clientX, startIdx: cur, dx: 0, moved: false });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const dx = e.clientX - drag.startX;
        const moved = drag.moved || Math.abs(dx) > 4;
        setDrag({ ...drag, dx, moved });
        if (!moved) return;
        const target = Math.max(0, Math.min(n - 1, drag.startIdx - Math.round(dx / STEP)));
        if (target !== cur) {
          cancelAnimationFrame(raf.current);
          raf.current = requestAnimationFrame(() => goTo(s.viewIds[target]));
        }
      }}
      onPointerUp={(e) => {
        if (drag && !drag.moved) {
          // Antippen: zu diesem Bild springen
          const el = document.elementsFromPoint(e.clientX, e.clientY).find((x) => (x as HTMLElement).dataset?.idx);
          const k = el ? Number((el as HTMLElement).dataset.idx) : NaN;
          if (!isNaN(k)) goTo(s.viewIds[k]);
        }
        setDrag(null);
      }}
      onPointerCancel={() => setDrag(null)}
    >
      {items}
    </div>
  );
}
