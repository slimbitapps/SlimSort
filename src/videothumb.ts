/**
 * Standbild aus einem Video, wenn das System keine Video-Vorschau liefert (sonst bleibt das Video schwarz).
 * Die Webansicht spielt das Video kurz an, nimmt ein Bild nach ca. 1 s und merkt es sich als Vorschaubild –
 * beim nächsten Mal kommt es direkt aus dem Zwischenspeicher.
 */
import { mediaUrl, browserCanPlay } from './util';

const done = new Map<string, Promise<string | null>>();
const waiting: (() => void)[] = [];
let running = 0;

function slot(): Promise<void> {
  if (running < 2) {
    running++;
    return Promise.resolve();
  }
  return new Promise((r) => waiting.push(() => (running++, r())));
}

function release() {
  running--;
  waiting.shift()?.();
}

function grab(path: string, size: number): Promise<string | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    let over = false;
    const finish = (url: string | null) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load();
      resolve(url);
    };
    const timer = setTimeout(() => finish(null), 10000);
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onerror = () => finish(null);
    v.onloadedmetadata = () => {
      const d = isFinite(v.duration) ? v.duration : 0;
      v.currentTime = Math.min(1, d * 0.1);
    };
    v.onseeked = () => {
      try {
        const w = v.videoWidth;
        const h = v.videoHeight;
        if (!w || !h) return finish(null);
        const k = Math.min(1, size / Math.max(w, h));
        const c = document.createElement('canvas');
        c.width = Math.round(w * k);
        c.height = Math.round(h * k);
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
        c.toBlob(
          (b) => {
            if (!b) return finish(null);
            finish(URL.createObjectURL(b));
            b.arrayBuffer().then((buf) => window.api.thumbStore(path, size, Array.from(new Uint8Array(buf))).catch(() => {}));
          },
          'image/jpeg',
          0.82
        );
      } catch {
        // Bild nicht lesbar (z. B. Sicherheitsregel der Webansicht) → Video selbst zeigen
        finish(null);
      }
    };
    v.src = mediaUrl(path);
  });
}

/** Standbild als Adresse (blob:…) oder null, wenn die Webansicht das Video nicht lesen kann */
export function videoFrame(path: string, size = 256, ext = ''): Promise<string | null> {
  if (ext && !browserCanPlay(ext)) return Promise.resolve(null);
  const key = path + '|' + size;
  let p = done.get(key);
  if (!p) {
    p = slot().then(() => grab(path, size).finally(release));
    done.set(key, p);
  }
  return p;
}
