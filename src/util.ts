import { getLang } from './i18n';
import type { Item, SortBy } from './types';

const enc = encodeURIComponent;
export const mediaUrl = (p: string) => `media://f/?p=${enc(p)}`;
export const thumbUrl = (p: string, s = 256) => `thumb://f/?p=${enc(p)}&s=${s}`;
export const previewUrl = (p: string) => `preview://f/?p=${enc(p)}`;

const BROWSER_IMG = new Set(['.jpg', '.jpeg', '.jpe', '.png', '.gif', '.webp', '.avif', '.bmp']);
export const browserCanShow = (ext: string) => BROWSER_IMG.has(ext);
export const displayUrl = (it: Item) => (browserCanShow(it.ext) ? mediaUrl(it.path) : previewUrl(it.path));

export const isMac = () => window.api?.platform === 'darwin';
export const modKey = () => (isMac() ? '⌘' : getLang() === 'de' ? 'Strg' : 'Ctrl');

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
  const s = v.toLocaleString(getLang(), { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 });
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
  return new Date(ms).toLocaleString(getLang(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function fmtNum(n: number) {
  return n.toLocaleString(getLang());
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
  '#5b8cff', '#2fbf71', '#f5a524', '#ef4f5f', '#a66cff', '#18b8c9', '#ff7ab6', '#8f9bb3', '#c9a227', '#6dd16d',
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
