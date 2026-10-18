import type { Lang } from './types';
import { de } from './locales/de';
import { en } from './locales/en';
import { fr } from './locales/fr';
import { es } from './locales/es';
import { it } from './locales/it';

/** Alle Texte liegen in src/locales. Deutsch ist die Quelle aller Schlüssel. */
export type TKey = keyof typeof de;
export type Dict = Record<TKey, string>;

const dicts: Record<Lang, Dict> = { de, en, fr, es, it };

export const LANGS: { id: Lang; label: string }[] = [
  { id: 'de', label: 'Deutsch' },
  { id: 'en', label: 'English' },
  { id: 'fr', label: 'Français' },
  { id: 'es', label: 'Español' },
  { id: 'it', label: 'Italiano' },
];

const locales: Record<Lang, string> = { de: 'de-DE', en: 'en-GB', fr: 'fr-FR', es: 'es-ES', it: 'it-IT' };

let current: Lang = 'de';
export function setLang(l: Lang) {
  current = dicts[l] ? l : 'en';
  document.documentElement.lang = current;
}
export function getLang() {
  return current;
}
export function getLocale() {
  return locales[current];
}

export function t(key: TKey, params?: Record<string, string | number>): string {
  let s: string = dicts[current][key] ?? de[key] ?? key;
  if (params) for (const k in params) s = s.split(`{${k}}`).join(String(params[k]));
  return s;
}

export function errText(code?: string) {
  const k = `err.${code}` as TKey;
  return k in de ? t(k) : code || '?';
}
