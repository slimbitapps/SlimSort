import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import type { ViewerShow } from '../viewer';
import { browserCanShow, mediaUrl, previewUrl, thumbUrl } from '../util';
import { videoFrame } from '../videothumb';

/** Foto-Fenster für den zweiten Bildschirm: nur das aktuelle Foto/Video, schwarz, so groß wie möglich */
export function Viewer() {
  const [p, setP] = useState<ViewerShow | null>(null);
  const [fallback, setFallback] = useState(false);
  const [chip, setChip] = useState(true);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const un = listen<ViewerShow | null>('viewer:show', (e) => {
      setP(e.payload);
      setFallback(false);
      setChip(true);
    });
    emitTo('main', 'viewer:ready', null).catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        invoke('viewer_fullscreen');
        return;
      }
      // alle anderen Tasten wirken im Hauptfenster (Ordner-Tasten, Pfeile, Löschen …)
      e.preventDefault();
      emitTo('main', 'viewer:key', { key: e.key, code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey }).catch(() => {});
    };
    window.addEventListener('keydown', onKey);
    return () => {
      un.then((f) => f());
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  // Name kurz einblenden, dann nur das Foto
  useEffect(() => {
    if (!chip) return;
    const timer = setTimeout(() => setChip(false), 2500);
    return () => clearTimeout(timer);
  }, [chip, p?.path]);

  const size = Math.min(4096, Math.round(Math.max(screen.width, screen.height) * (window.devicePixelRatio || 1)));
  return (
    <div className="viewer" data-testid="viewer" onDoubleClick={() => invoke('viewer_fullscreen')} onMouseMove={() => setChip(true)}>
      {!p ? null : p.kind === 'video' ? (
        <ViewerVideo key={p.path} p={p} />
      ) : fallback && !browserCanShow(p.ext) ? null : (
        <img key={p.path + fallback} src={fallback ? mediaUrl(p.path) : previewUrl(p.path, size)} alt="" draggable={false} onError={() => setFallback(true)} />
      )}
      {p && (
        <div className={`viewer-chip ${chip ? '' : 'hide'}`}>
          <b>{p.name}</b>
          <span>{p.pos}</span>
        </div>
      )}
    </div>
  );
}

function ViewerVideo({ p }: { p: ViewerShow }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [poster, setPoster] = useState<string | undefined>();
  useEffect(() => {
    let alive = true;
    const url = thumbUrl(p.path, 1280);
    const im = new Image();
    im.onload = () => alive && setPoster(url);
    im.onerror = () => videoFrame(p.path, 1280, p.ext).then((u) => alive && u && setPoster(u));
    im.src = url;
    const v = ref.current;
    if (v && p.videoPlay !== 'click') {
      v.muted = p.videoPlay === 'muted';
      v.play()?.catch(() => {
        v.muted = true;
        v.play()?.catch(() => {});
      });
    }
    return () => {
      alive = false;
    };
  }, [p.path, p.ext, p.videoPlay]);
  return <video ref={ref} src={mediaUrl(p.path)} poster={poster} controls playsInline preload="auto" />;
}
