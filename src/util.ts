import { getLocale, t } from './i18n';
import type { Item, SortBy } from './types';

const enc = encodeURIComponent;
export const mediaUrl = (p: string) => `media://f/?p=${enc(p)}`;
export const thumbUrl = (p: string, s = 256) => `thumb://f/?p=${enc(p)}&s=${s}`;
export const previewUrl = (p: string, s = 2048) => `preview://f/?p=${enc(p)}&s=${s}`;

const BROWSER_IMG = new Set(['.jpg', '.jpeg', '.jpe', '.png', '.gif', '.webp', '.avif', '.bmp']);
export const browserCanShow = (ext: string) => BROWSER_IMG.has(ext);

/**
 * Passende Vorschaugröße für eine Fläche (in Gerätepixeln, auf 512 gerundet).
 * Statt riesiger Originale (z. B. 48 MP) wird nur so viel geladen, wie man sieht.
 */
export function previewSize(cssW: number, cssH: number) {
  const dpr = window.devicePixelRatio || 1;
  const px = Math.max(cssW, cssH) * dpr;
  return Math.min(4096, Math.max(1024, Math.ceil(px / 512) * 512));
}

/** Bildschirmgroße Vorschau; das Original lädt erst beim Hineinzoomen. */
export const displayUrl = (it: Item, size = 2048) => previewUrl(it.path, size);
/** Original in voller Auflösung (nur für Formate, die der Browser direkt kann) */
export const fullUrl = (it: Item) => (browserCanShow(it.ext) ? mediaUrl(it.path) : previewUrl(it.path, 4096));

export const isMac = () => window.api?.platform === 'darwin';
export const modKey = () => (isMac() ? '⌘' : getLocale().startsWith('de') ? 'Strg' : 'Ctrl');

export function uid(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
}

export function basename(p: string) {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

export function fmtBytes(n: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const s = v.toLocaleString(getLocale(), { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 });
  return `${s} ${units[i]}`;
}

export function fmtDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min ${sec} s`;
  return `${sec} s`;
}

export function fmtDate(ms: number) {
  return new Date(ms).toLocaleString(getLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function fmtNum(n: number) {
  return n.toLocaleString(getLocale());
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export const itemTime = (it: Item) => it.t ?? it.mtime;

export function sortItems(items: Item[], by: SortBy, dir: 'asc' | 'desc') {
  const f = dir === 'asc' ? 1 : -1;
  const byName = (a: Item, b: Item) => collator.compare(a.dir, b.dir) || collator.compare(a.name, b.name);
  const cmp: Record<SortBy, (a: Item, b: Item) => number> = {
    name: byName,
    date: (a, b) => itemTime(a) - itemTime(b) || byName(a, b),
    size: (a, b) => a.size - b.size || byName(a, b),
    type: (a, b) => collator.compare(a.ext, b.ext) || byName(a, b),
  };
  return items.slice().sort((a, b) => f * cmp[by](a, b));
}

/** Taste aus einem Tastaturereignis -> "A", "1", "F5" oder null */
export function keyFromEvent(e: KeyboardEvent): string | null {
  if (/^F([2-9]|12)$/.test(e.key)) return e.key;
  if (/^(Digit|Numpad)[0-9]$/.test(e.code)) return e.code.slice(-1);
  if (e.key.length === 1 && /[a-zäöü0-9]/i.test(e.key)) return e.key.toUpperCase();
  return null;
}

export const isAssignableKey = (k: string) => /^([A-ZÄÖÜ0-9]|F[2-9]|F12)$/.test(k);

export const COLORS = [
  '#5b7cfa', '#33c37a', '#f6a23c', '#ef5a6f', '#a970ff', '#1fb5c9', '#f472b6', '#8a94a6', '#d4a72c', '#6cc644',
];

export function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

export function isTyping(e: Event) {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** "43 Fotos · 1 Video" – mit Einzahl/Mehrzahl, Videos nur wenn vorhanden */
export function countLabel(images: number, videos: number) {
  const ph = `${fmtNum(images)} ${t(images === 1 ? 'unit.photo' : 'unit.photos')}`;
  if (!videos) return ph;
  return `${ph} · ${fmtNum(videos)} ${t(videos === 1 ? 'unit.video' : 'unit.videos')}`;
}
