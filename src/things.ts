/**
 * Dinge, die sich die KI merkt: dein Auto, euer Haus, der Hund Bello, dein Fahrrad …
 *
 * Ein Ding lernt die KI aus Beispielen: ganze Fotos ("das ist mein Auto") oder markierte Bereiche.
 * Jedes Foto wird mit den Beispielen verglichen (Fingerabdruck des Bildmodells). Wie ähnlich "ähnlich
 * genug" ist, misst die KI an den übrigen Fotos der Sortierung – so passt es zu jedem Modell.
 * Bestätigen oder Ablehnen ("das ist nicht mein Auto") macht die Erkennung sicherer.
 */
import { useStore, updateSettings } from './store';
import { t } from './i18n';
import type { Thing } from './types';

const api = () => window.api;
const tier = () => useStore.getState().settings.prefs.aiTier || 'eco';

export function things(): Thing[] {
  return useStore.getState().settings.things || [];
}

export function saveThings(list: Thing[]) {
  updateSettings((s) => ({ ...s, things: list }));
}

const uid = () => Math.random().toString(36).slice(2, 10);
const round = (v: number[]) => v.map((x) => Math.round(x * 1e4) / 1e4);
const norm = (s: string) => s.toLowerCase().replace(/^(mein|meine|meinen|meinem|meiner|unser|unsere|unseren|unserem|unserer|dein|deine|der|die|das|den|dem)\s+/g, '').trim();

/** "mein Auto" → "Mein Auto"; "unser Hund Bello" → "Bello" */
export function thingName(raw: string): string {
  const n = raw.replace(/[„“"»«.!?]/g, '').trim();
  return n.charAt(0).toUpperCase() + n.slice(1);
}

export function findThing(raw: string, list = things()): Thing | undefined {
  const n = norm(raw);
  if (!n) return undefined;
  return (
    list.find((x) => norm(x.name) === n) ||
    list.find((x) => norm(x.name).split(' ').pop() === n.split(' ').pop() && n.length >= 3) ||
    // "Fotos mit dem Traktor" findet "Unser Haupttraktor" (erkannte Art)
    list.find((x) => x.category && norm(x.category) === n.replace(/^(dem|den|der|die|das)\s+/, ''))
  );
}

/** Beispiel hinzufügen (legt das Ding an, wenn es noch nicht da ist) */
export async function addThingExample(name: string, path: string, box?: [number, number, number, number]): Promise<Thing> {
  const emb = round(await api().ai.embedRegion(path, box ?? null));
  const crop = await api().ai.faceCrop(path, box ?? [0.15, 0.15, 0.7, 0.7], 96).catch(() => null);
  const list = things().map((x) => ({ ...x }));
  let th = findThing(name, list);
  if (!th) {
    th = { id: uid(), name: thingName(name), examples: [], embs: {}, created: Date.now(), updated: Date.now() };
    list.push(th);
  }
  const tr = tier();
  th.examples = [...th.examples, { path, box }].slice(-30);
  th.embs = { ...th.embs, [tr]: [...(th.embs[tr] || []), emb].slice(-30) };
  // war es vorher als "nicht" markiert → Gegenbeispiel weg
  if (th.not?.[tr]) th.not = { ...th.not, [tr]: th.not[tr].filter((x) => cos(x, emb) < 0.95) };
  th.crop = th.crop || crop || undefined;
  th.updated = Date.now();
  saveThings(list);
  return th;
}

/** "Das ist nicht mein Auto" */
export async function addThingNegative(id: string, path: string) {
  const emb = round(await api().ai.embedRegion(path, null));
  const tr = tier();
  saveThings(things().map((x) => (x.id === id ? { ...x, not: { ...(x.not || {}), [tr]: [...(x.not?.[tr] || []), emb].slice(-30) }, updated: Date.now() } : x)));
}

/** Ein Beispiel wieder entfernen (z. B. falsch markiert) */
export function removeThingExample(id: string, index: number) {
  saveThings(
    things().map((x) => {
      if (x.id !== id) return x;
      const examples = x.examples.filter((_, i) => i !== index);
      // Fingerabdrücke passen zur Reihenfolge der Beispiele → für alle Stufen neu berechnen lassen
      return { ...x, examples, embs: {}, updated: Date.now() };
    })
  );
}

/** Überschrift automatisch: was die KI auf dem Beispielfoto erkennt ("Traktor") */
export async function detectCategory(id: string, photoId: number) {
  const tags = await api().ai.tags(photoId).catch(() => [] as [string, number][]);
  if (!tags.length) return;
  const cat = tags[0][0];
  saveThings(things().map((x) => (x.id === id && !x.category ? { ...x, category: cat.charAt(0).toUpperCase() + cat.slice(1) } : x)));
}

export function setThingCategory(id: string, category: string) {
  saveThings(things().map((x) => (x.id === id ? { ...x, category: category.trim() || undefined } : x)));
}

export function renameThing(id: string, name: string) {
  saveThings(things().map((x) => (x.id === id ? { ...x, name: thingName(name), updated: Date.now() } : x)));
}

export function removeThing(id: string) {
  saveThings(things().filter((x) => x.id !== id));
}

const cos = (a: number[], b: number[]) => {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return d / Math.sqrt(na * nb || 1);
};

/**
 * Beispiele für die aktuelle KI-Stufe (anderes Bildmodell → neu berechnen, solange die Fotos noch da sind)
 */
async function embsFor(th: Thing): Promise<number[][]> {
  const tr = tier();
  if (th.embs[tr]?.length) return th.embs[tr];
  const out: number[][] = [];
  for (const ex of th.examples) {
    try {
      out.push(round(await api().ai.embedRegion(ex.path, ex.box ?? null)));
    } catch {
      /* Foto nicht mehr da */
    }
  }
  if (out.length) saveThings(things().map((x) => (x.id === th.id ? { ...x, embs: { ...x.embs, [tr]: out } } : x)));
  return out;
}

export interface ThingHit {
  thing: Thing;
  /** Ähnlichkeit */
  p: number;
  /** wie sicher, 0…1 (über der Schwelle) */
  conf: number;
}

/** Schwellen je Ding, gemessen an den Fotos der Sortierung (zwischengespeichert) */
const thresholds = new Map<string, number>();

function threshold(th: Thing, pool: number[], exs: number[][]): number {
  const key = `${th.id}:${th.updated}:${tier()}:${pool.length}`;
  const known = thresholds.get(key);
  if (known !== undefined) return known;
  const sorted = [...pool].filter((x) => x > -1).sort((a, b) => a - b);
  // so ähnlich sind 90 % der übrigen Fotos höchstens
  const p90 = sorted.length >= 20 ? sorted[Math.floor(sorted.length * 0.9)] : 0.55;
  // so ähnlich sind sich die Beispiele untereinander
  let pair = 0;
  let n = 0;
  for (let i = 0; i < exs.length; i++)
    for (let j = i + 1; j < exs.length; j++) {
      pair += cos(exs[i], exs[j]);
      n++;
    }
  const same = n ? pair / n : 1;
  const thr = Math.max(p90 + 0.03, p90 + (Math.min(same, 0.98) - p90) * (n ? 0.5 : 0.35));
  thresholds.set(key, thr);
  return thr;
}

/** Welche gemerkten Dinge sind auf diesen Fotos? `pool`: Fotos zum Einschätzen der Schwelle */
export async function thingsOn(ids: number[], pool?: number[]): Promise<Map<number, ThingHit[]>> {
  const out = new Map<number, ThingHit[]>();
  const list = things();
  if (!list.length || !ids.length) return out;
  const exs = await Promise.all(list.map(embsFor));
  const payload = list.map((th, i) => ({ pos: exs[i], neg: th.not?.[tier()] || [] }));
  const all = [...new Set([...ids, ...(pool || [])])];
  const res = await api().ai.thingScores(all, payload).catch(() => []);
  const by = new Map(res.map((r) => [r.id, r.s]));
  const poolIds = pool?.length ? pool : all;
  const thr = list.map((th, i) => threshold(th, poolIds.map((id) => by.get(id)?.[i] ?? -1), exs[i]));
  for (const id of ids) {
    const s = by.get(id);
    if (!s) continue;
    const hits = list
      .map((thing, i) => ({ thing, p: s[i], conf: Math.min(1, Math.max(0, (s[i] - thr[i]) / Math.max(0.05, 1 - thr[i])) * 0.5 + 0.5) }))
      .filter((h, i) => exs[i].length > 0 && h.p >= thr[i]);
    if (hits.length) out.set(id, hits.sort((a, b) => b.p - a.p));
  }
  return out;
}

/** "mein Auto", "Bello" → gemerkte Dinge in einer Suchanfrage */
export function thingsInQuery(q: string): Thing[] | null {
  const list = things();
  if (!list.length) return null;
  const parts = q
    .split(/\s*(?:,|\bund\b|\bmit\b|&)\s*/i)
    .map((x) => x.replace(/^(?:fotos?|bilder?|alle|von|vom|mit)\s+/gi, '').trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const found: Thing[] = [];
  for (const p of parts) {
    const th = findThing(p, list);
    if (!th) return null;
    found.push(th);
  }
  return found;
}

/** Für das Sprachmodell */
export function thingsForPrompt(hits?: ThingHit[]): string {
  const list = things();
  if (!list.length) return '';
  const known = `Dinge, die du dir gemerkt hast: ${list.map((x) => x.name).join(', ')}.`;
  if (!hits) return known;
  return known + (hits.length ? ` Auf dem aktuellen Foto erkennst du: ${hits.map((h) => h.thing.name).join(', ')}.` : ' Davon ist keins auf dem aktuellen Foto.');
}

export function describeThing(th: Thing): string {
  return t('things.examples', { n: th.examples.length });
}
