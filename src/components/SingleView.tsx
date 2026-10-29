import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import {
  useStore, currentItem, currentIndex, step, setView, openSeriesOf, openCompare, photoDrag, openPhotoMenu, hiddenCount, showAll, updatePrefs, type SessionState,
} from '../store';
import type { Item } from '../types';
import { videoFrame } from '../videothumb';
import { EmptyView } from './ui';
import { beginDrag } from '../dnd';
import { InfoPanel } from './InfoPanel';
import { FaceOverlay } from './FaceOverlay';
import { ThingTags, MarkLayer } from './ThingLayer';
import { browserCanShow, displayUrl, fullUrl, mediaUrl, thumbUrl, fmtBytes, fmtDate, fmtNum, itemTime, clamp, previewSize } from '../util';
import { IconChevronLeft, IconChevronRight, IconFolderOut, IconLive, IconMaximize, IconLayers, IconTag, IconEye, IconEyeOff } from '../icons';
import { tip } from './Tooltip';
import { heicUrl, isHeic } from '../heic';

interface View {
  scale: number;
  x: number;
  y: number;
}

/** Zoom-Befehle von der Tastatur (+, -, Strg+0) */
export function zoomCommand(cmd: 'in' | 'out' | 'reset') {
  window.dispatchEvent(new CustomEvent('fs-zoom', { detail: cmd }));
}

export function SingleView({ s }: { s: SessionState }) {
  const it = currentItem(s);
  const liveAuto = useStore((st) => st.settings.prefs.liveAutoplay);
  const showInfo = useStore((st) => st.settings.prefs.showInfo);
  const expert = useStore((st) => st.settings.prefs.mode === 'expert');
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 800, h: 600 });
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [view, setViewState] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [fitMode, setFitMode] = useState(true);
  const [error, setError] = useState(false);
  const [livePlaying, setLivePlaying] = useState(false);
  // Bereich markieren ("das ist mein Auto")
  const [marking, setMarking] = useState(false);
  const aiOn = useStore((st) => st.settings.prefs.aiEnabled);
  const showMarks = useStore((st) => st.settings.prefs.showFaces);
  // angezeigtes <img> – beim Zoomen wird nur der sichtbare Ausschnitt daraus gezeichnet
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const on = () => setMarking(true);
    window.addEventListener('fs-mark', on);
    return () => window.removeEventListener('fs-mark', on);
  }, []);
  const [panning, setPanning] = useState(false);
  const [hiRes, setHiRes] = useState(false);
  // Ein Ladeweg (Vorschau oder Original) ist schon gescheitert → nicht endlos hin- und herwechseln
  const [oneFailed, setOneFailed] = useState(false);
  // Zuletzt angezeigtes Bild: bleibt stehen, bis das nächste geladen ist (kein schwarzes Aufblitzen)
  const shown = useRef<{ src: string; style: React.CSSProperties } | null>(null);
  const [fadeHold, setFadeHold] = useState(false);
  // HEIC ohne Vorschau vom System: selbst dekodiert (blob:-Adresse)
  const [heicSrc, setHeicSrc] = useState<string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    startX: number;
    startY: number;
    view: View;
    dist?: number;
    mid?: { x: number; y: number };
    type: 'pan' | 'pinch' | 'swipe';
    pointerType: string;
  } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Vorschaugröße passend zur Fläche (ändert sich nur bei deutlicher Größenänderung)
  const pSize = previewSize(box.w, box.h);
  const fitScale = nat ? Math.min(box.w / nat.w, box.h / nat.h) : 1;

  const clampView = useCallback(
    (v: View): View => {
      if (!nat) return v;
      const w = nat.w * v.scale;
      const h = nat.h * v.scale;
      const x = w <= box.w ? (box.w - w) / 2 : clamp(v.x, box.w - w, 0);
      const y = h <= box.h ? (box.h - h) / 2 : clamp(v.y, box.h - h, 0);
      return { scale: v.scale, x, y };
    },
    [nat, box]
  );

  // Bildwechsel: zurücksetzen
  useEffect(() => {
    setNat(null);
    setError(false);
    setFitMode(true);
    setLivePlaying(false);
    setHiRes(false);
    setOneFailed(false);
    setFadeHold(true);
    setHeicSrc(null);
    setMarking(false);
  }, [it?.id, it?.path]);

  // Altes Bild noch kurz zeigen, bis das neue eingeblendet ist
  useEffect(() => {
    if (!nat || !fadeHold) return;
    const timer = setTimeout(() => setFadeHold(false), 220);
    return () => clearTimeout(timer);
  }, [nat, fadeHold]);

  useEffect(() => {
    if (fitMode && nat) setViewState(clampView({ scale: fitScale, x: 0, y: 0 }));
  }, [fitMode, nat, fitScale, clampView]);

  // Beim Hineinzoomen über die Vorschau-Auflösung hinaus: Original laden
  useEffect(() => {
    if (!hiRes && !oneFailed && !heicSrc && nat && it?.kind === 'image' && view.scale * (window.devicePixelRatio || 1) > 1.05 && !fitMode) setHiRes(true);
  }, [view.scale, nat, hiRes, oneFailed, fitMode, it?.kind]);

  useEffect(() => {
    if (it?.live && liveAuto && nat) setLivePlaying(true);
  }, [it?.live, liveAuto, nat]);

  // Nachbarbilder vorladen (nur in Vorschaugröße – spart Zeit und Speicher)
  useEffect(() => {
    const i = currentIndex(s);
    const timer = setTimeout(() => {
      for (const d of [1, 2, -1]) {
        const id = s.viewIds[i + d];
        const n = id !== undefined ? s.byId.get(id) : null;
        if (n && n.kind === 'image') {
          const img = new Image();
          img.decoding = 'async';
          img.src = displayUrl(n, pSize);
        }
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [s.currentId, pSize]); // eslint-disable-line

  const zoomAt = useCallback(
    (factor: number, px: number, py: number) => {
      if (!nat) return;
      setFitMode(false);
      setViewState((v) => {
        const ns = clamp(v.scale * factor, Math.min(fitScale, 1) * 0.5, 12);
        const k = ns / v.scale;
        return clampView({ scale: ns, x: px - (px - v.x) * k, y: py - (py - v.y) * k });
      });
    },
    [nat, fitScale, clampView]
  );

  useEffect(() => {
    const onZoom = (e: Event) => {
      const cmd = (e as CustomEvent).detail;
      if (cmd === 'reset') setFitMode(true);
      else zoomAt(cmd === 'in' ? 1.25 : 0.8, box.w / 2, box.h / 2);
    };
    window.addEventListener('fs-zoom', onZoom);
    return () => window.removeEventListener('fs-zoom', onZoom);
  }, [zoomAt, box]);

  const onWheel = (e: React.WheelEvent) => {
    if (!nat || it?.kind !== 'image') return;
    const r = ref.current!.getBoundingClientRect();
    const speed = e.ctrlKey ? 0.01 : 0.0018; // Trackpad-Pinch kommt mit Strg
    zoomAt(Math.exp(-e.deltaY * speed), e.clientX - r.left, e.clientY - r.top);
  };

  const onDouble = (e: React.MouseEvent) => {
    if (!nat || it?.kind !== 'image' || (e.target as HTMLElement).closest('button')) return;
    const r = ref.current!.getBoundingClientRect();
    if (!fitMode && Math.abs(view.scale - fitScale) > 0.01) {
      setFitMode(true);
      return;
    }
    zoomAt((fitScale * 3) / view.scale, e.clientX - r.left, e.clientY - r.top);
  };

  const zoomed = nat ? view.scale > fitScale * 1.01 : false;

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, video[controls]')) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      const [a, b] = pts;
      gesture.current = {
        type: 'pinch',
        startX: 0,
        startY: 0,
        view,
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        pointerType: e.pointerType,
      };
    } else {
      gesture.current = { type: zoomed ? 'pan' : 'swipe', startX: e.clientX, startY: e.clientY, view, pointerType: e.pointerType };
      if (zoomed) setPanning(true);
      // Nicht gezoomt: Foto mit der Maus auf einen Zielordner ziehen
      else if (e.pointerType === 'mouse' && it) {
        const cur = it;
        beginDrag(e, () => photoDrag(cur));
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.type === 'pinch' && pointers.current.size === 2 && nat) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const r = ref.current!.getBoundingClientRect();
      const mx = g.mid!.x - r.left;
      const my = g.mid!.y - r.top;
      const ns = clamp(g.view.scale * (dist / g.dist!), Math.min(fitScale, 1) * 0.5, 12);
      const k = ns / g.view.scale;
      setFitMode(false);
      setViewState(clampView({ scale: ns, x: mx - (mx - g.view.x) * k, y: my - (my - g.view.y) * k }));
    } else if (g.type === 'pan') {
      setViewState(clampView({ ...g.view, x: g.view.x + e.clientX - g.startX, y: g.view.y + e.clientY - g.startY }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    setPanning(false);
    if (!g) return;
    if (g.type === 'swipe' && g.pointerType !== 'mouse') {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.3) step(dx < 0 ? 1 : -1);
      else if (dy > 90 && dy > Math.abs(dx) * 1.3) setView('grid');
    }
    if (pointers.current.size === 0) gesture.current = null;
  };

  if (!it) {
    return (
      <div className="single" ref={ref}>
        <EmptyView hidden={hiddenCount(s)} text={t('ses.empty')} onShowAll={showAll} />
      </div>
    );
  }

  const idx = currentIndex(s);
  const series = openSeriesOf(s, s.currentId);
  const seriesPos = series.indexOf(it.id) + 1;
  const rect = nat
    ? { left: 0, top: 0, width: nat.w * view.scale, height: nat.h * view.scale, transform: `translate(${view.x}px, ${view.y}px)` }
    : { opacity: 0 };
  const mod = window.api.platform === 'darwin' ? '⌘' : t('key.ctrl');
  const imgSrc = heicSrc ?? (hiRes ? fullUrl(it) : displayUrl(it, pSize));
  const canvasZoom = zoomed && it.kind === 'image' && !!nat && !error;
  if (nat && !fadeHold && it.kind === 'image' && !error && !zoomed) shown.current = { src: imgSrc, style: rect };
  else if (it.kind !== 'image' || error) shown.current = null;
  const ghostVisible = (!nat || fadeHold) && !error;

  return (
    <div
      ref={ref}
      className={`single ${zoomed ? 'zoomed' : ''} ${panning ? 'panning' : ''}`}
      data-testid="single"
      onWheel={onWheel}
      onDoubleClick={onDouble}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => {
        if (!it || (e.target as HTMLElement).closest('button, video[controls]')) return;
        e.preventDefault();
        openPhotoMenu(it.id, e.clientX, e.clientY);
      }}
    >
      {it.kind === 'video' ? (
        <VideoPlayer it={it} onSize={(w, h) => setNat({ w, h })} onError={() => setError(true)} />      ) : (
        <>
          {shown.current && (
            <img
              className="media-ghost"
              src={shown.current.src}
              style={{ ...shown.current.style, visibility: ghostVisible ? 'visible' : 'hidden' }}
              alt=""
              draggable={false}
            />
          )}
          <img
            key={it.path + (hiRes ? ':hi' : '') + (heicSrc ? ':heic' : '')}
            ref={setImgEl}
            className={`media ${nat ? 'ready' : ''}`}
            src={imgSrc}
            alt={it.name}
            decoding="async"
            draggable={false}
            style={canvasZoom ? { ...rect, display: 'none' } : rect}
            onLoad={(e) => {
              const im = e.currentTarget;
              const nw = im.naturalWidth;
              const nh = im.naturalHeight;
              // Wechsel Vorschau → Original: gleiche Darstellungsgröße beibehalten
              if (nat && hiRes && nw !== nat.w) setViewState((v) => ({ ...v, scale: (v.scale * nat.w) / nw }));
              setNat({ w: nw, h: nh });
            }}
            onError={() => {
              // Vorschau kaputt → Original versuchen (und umgekehrt); erst wenn beides scheitert: Hinweis
              if (heicSrc) return setError(true);
              if (isHeic(it.ext)) {
                const path = it.path;
                setOneFailed(true);
                heicUrl(path, pSize).then((u) => (u ? setHeicSrc(u) : setError(true)));
                return;
              }
              if (oneFailed) return setError(true);
              setOneFailed(true);
              if (hiRes) setHiRes(false);
              else if (browserCanShow(it.ext)) setHiRes(true);
              else setError(true);
            }}
          />
          {canvasZoom && imgEl && <ZoomCanvas img={imgEl} nat={nat!} view={view} box={box} />}
          {nat && !fadeHold && !error && !livePlaying && !marking && <FaceOverlay it={it} style={rect} />}
          {nat && !error && marking && <MarkLayer it={it} style={rect} onDone={() => setMarking(false)} />}
          {livePlaying && it.live && nat && (
            <video
              className="media"
              src={mediaUrl(it.live)}
              autoPlay
              muted
              playsInline
              style={rect}
              onEnded={() => setLivePlaying(false)}
              onError={() => setLivePlaying(false)}
            />
          )}
        </>
      )}

      {!nat && !error && it.kind === 'image' && !shown.current && (
        <div className="loading-img">
          <div className="spinner" />
        </div>
      )}
      {error && (
        <div className="no-preview">
          <div>
            <div style={{ fontSize: 16, marginBottom: 6 }}>{it.name}</div>
            <div className="small">{t('ses.noPreview')}</div>
          </div>
        </div>
      )}

      <div className="overlay-chip info" data-testid="single-info">
        <span className="ellipsis" style={{ fontWeight: 600 }}>
          {it.name}
        </span>
        <span style={{ opacity: 0.75 }}>
          {fmtNum(idx + 1)} / {fmtNum(s.viewIds.length)}
        </span>
        <span style={{ opacity: 0.75 }} className="ellipsis">
          {fmtBytes(it.size)} · {fmtDate(itemTime(it))}
        </span>
        {s.skipped.has(it.id) && <span className="tile-badge skip">{t('ses.skipped')}</span>}
      </div>

      {aiOn && it.kind === 'image' && !marking && <ThingTags it={it} />}

      <div className="overlay-tools">
        {aiOn && it.kind === 'image' && (
          <button
            className={`overlay-btn ${showMarks ? '' : 'on'}`}
            onClick={() => updatePrefs({ showFaces: !showMarks })}
            data-testid="marks-toggle"
            {...tip(showMarks ? t('ses.hideMarks') : t('ses.showMarks'), t('tip.marks'), `${mod} N`)}
          >
            {showMarks ? <IconEyeOff size={15} /> : <IconEye size={15} />}
          </button>
        )}
        {aiOn && it.kind === 'image' && (
          <button className={`overlay-btn ${marking ? 'on' : ''}`} onClick={() => setMarking(!marking)} data-testid="mark-btn" {...tip(t('things.mark'), t('things.markTip'))}>
            <IconTag size={15} />
          </button>
        )}
        {it.live && (
          <button className="overlay-btn" onClick={() => setLivePlaying(true)} {...tip(t('ses.playLive'), t('tip.live'))}>
            <IconLive size={15} />
            LIVE
          </button>
        )}
        {zoomed && (
          <button className="overlay-btn" onClick={() => setFitMode(true)} {...tip(t('ses.fit'), t('tip.fit'), `${mod} 0`)}>
            <IconMaximize size={15} />
          </button>
        )}
        {expert && (
          <button className="overlay-btn" onClick={() => window.api.showItem(it.path)} {...tip(t('ses.openFolder'), t('tip.openFolder'))}>
            <IconFolderOut size={15} />
          </button>
        )}
      </div>

      {nat && zoomed && it.kind === "image" && <div className="overlay-chip zoom">{(view.scale / fitScale).toLocaleString(undefined, { maximumFractionDigits: 1 })}×</div>}

      {series.length >= 2 && seriesPos > 0 && (
        <div className="series-chip" data-testid="series-chip">
          <IconLayers size={15} />
          <span>{t('series.chip', { n: seriesPos, total: series.length })}</span>
          <button className="btn primary sm" onClick={openCompare} {...tip(t('series.compare'), t('tip.compare'))}>
            {t('series.compare')}
          </button>
        </div>
      )}

      <button className="nav-arrow l" onClick={() => step(-1)} {...tip(t('tip.prev'), undefined, '←')}>
        <IconChevronLeft size={24} />
      </button>
      <button className="nav-arrow r" onClick={() => step(1)} {...tip(t('tip.next'), undefined, '→')}>
        <IconChevronRight size={24} />
      </button>
      {showInfo && <InfoPanel it={it} />}
    </div>
  );
}

/**
 * Gezoomtes Foto: nur der sichtbare Ausschnitt wird in Bildschirmgröße gezeichnet.
 * (Ein riesig vergrößertes <img> ruckelt und bleibt in Teilen schwarz.)
 */
function ZoomCanvas({ img, nat, view, box }: { img: HTMLImageElement; nat: { w: number; h: number }; view: View; box: { w: number; h: number } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [, redraw] = useState(0);
  useEffect(() => {
    if (img.complete) return;
    const f = () => redraw((x) => x + 1);
    img.addEventListener('load', f);
    return () => img.removeEventListener('load', f);
  }, [img]);
  useLayoutEffect(() => {
    const c = ref.current;
    // neues Bild lädt noch → altes Bild stehen lassen
    if (!c || !img.complete || !img.naturalWidth) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(box.w * dpr);
    const H = Math.round(box.h * dpr);
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const s = view.scale;
    const kx = img.naturalWidth / nat.w;
    const ky = img.naturalHeight / nat.h;
    const x0 = Math.max(0, view.x);
    const y0 = Math.max(0, view.y);
    const x1 = Math.min(box.w, view.x + nat.w * s);
    const y1 = Math.min(box.h, view.y + nat.h * s);
    if (x1 <= x0 || y1 <= y0) return;
    ctx.drawImage(img, ((x0 - view.x) / s) * kx, ((y0 - view.y) / s) * ky, ((x1 - x0) / s) * kx, ((y1 - y0) / s) * ky, x0 * dpr, y0 * dpr, (x1 - x0) * dpr, (y1 - y0) * dpr);
  });
  return <canvas ref={ref} className="zoom-canvas" data-testid="zoom-canvas" style={{ width: box.w, height: box.h }} />;
}

/** Video mit Standbild (statt schwarz) und Wiedergabe nach Einstellung: automatisch, lautlos oder erst auf Play */
function VideoPlayer({ it, onSize, onError }: { it: Item; onSize: (w: number, h: number) => void; onError: () => void }) {
  const mode = useStore((st) => st.settings.prefs.videoPlay) || 'muted';
  const ref = useRef<HTMLVideoElement>(null);
  const [poster, setPoster] = useState<string | undefined>();
  useEffect(() => {
    let alive = true;
    setPoster(undefined);
    const url = thumbUrl(it.path, 1280);
    const im = new Image();
    im.onload = () => alive && setPoster(url);
    im.onerror = () => videoFrame(it.path, 1280, it.ext).then((u) => alive && u && setPoster(u));
    im.src = url;
    return () => {
      alive = false;
    };
  }, [it.path, it.ext]);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = mode === 'muted';
    if (mode === 'click') return;
    // Mit Ton gesperrt (Regel der Webansicht)? → lautlos abspielen, Ton per Knopf
    v.play()?.catch(() => {
      if (v.muted) return;
      v.muted = true;
      v.play()?.catch(() => {});
    });
  }, [it.path, mode]);
  return (
    <video
      key={it.path}
      ref={ref}
      className="media"
      data-testid="video"
      src={mediaUrl(it.path)}
      poster={poster}
      controls
      playsInline
      preload={mode === 'click' ? 'metadata' : 'auto'}
      style={{ left: 0, top: 0, width: '100%', height: '100%', objectFit: 'contain' }}
      onLoadedMetadata={(e) => {
        const v = e.currentTarget;
        onSize(v.videoWidth || 1, v.videoHeight || 1);
      }}
      onError={onError}
    />
  );
}
