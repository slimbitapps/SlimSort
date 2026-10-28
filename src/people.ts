/**
 * Personen, deren Gesichter die KI kennt.
 *
 * Jede Person hat einige Gesichts-Beispiele (je 128 Zahlen). Ein Gesicht gehört zu einer Person,
 * wenn es ihren Beispielen ähnlich genug ist – die Position auf dem Foto spielt dabei keine Rolle.
 * Wird ein Gesicht neu benannt oder korrigiert, kommt es als weiteres Beispiel dazu; so wird die
 * Erkennung mit der Zeit sicherer (andere Frisur, Brille, Licht, Alter …).
 */
import { useStore, updateSettings, prefs } from './store';
import { t } from './i18n';
import type { Person, PhotoFaces } from './types';

const api = () => window.api;

/** Höchstens so viele Beispiele je Person (die unterschiedlichsten bleiben) */
const MAX_SAMPLES = 24;
/** Fast gleiche Beispiele nicht doppelt speichern */
const DUPLICATE = 0.93;
/** Ab hier gilt ein Gesicht als die Person (wie in Rust) */
export const SAME = 0.42;
/** Darunter, aber über diesem Wert: "Ist das …?" fragen */
export const MAYBE = 0.3;

export function people(): Person[] {
  return useStore.getState().settings.people || [];
}

export function savePeople(list: Person[]) {
  updateSettings((s) => ({ ...s, people: list }));
}

export function peopleEmbs(list = people()): number[][][] {
  return list.map((p) => p.embs);
}

const cos = (a: number[], b: number[]) => {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return d / Math.sqrt(na * nb || 1);
};

const SELF = /^(ich|mir|mich|mein selbst|me|myself|i|moi|yo|io)$/i;
/** gleiche Bedeutung → gleiche Person */
const SAME_WORD: string[][] = [
  ['mama', 'mutter', 'mami', 'mom', 'mum', 'mother', 'maman', 'madre'],
  ['papa', 'vater', 'papi', 'dad', 'father', 'père', 'padre'],
  ['oma', 'großmutter', 'omi', 'grandma', 'grandmother'],
  ['opa', 'großvater', 'opi', 'grandpa', 'grandfather'],
  ['bruder', 'brother', 'frère', 'hermano', 'fratello'],
  ['schwester', 'sister', 'sœur', 'hermana', 'sorella'],
];

/** "meine Mutter" → "Mutter", "mir" → "Ich" */
export function cleanName(raw: string): string {
  let n = raw
    .trim()
    .replace(/[.,!?;:"„“”»«]/g, '')
    .replace(/^(?:das ist|das sind|ist|sind|bin|der|die|das|den|dem|mein|meine|meinen|meinem|meiner|unser|unsere|unseren|unserem|my|our|mon|ma|mi|il mio|la mia)\s+/gi, '')
    .replace(/^(?:mein|meine|meinen|meinem|meiner|unser|unsere|my)\s+/i, '')
    .trim();
  if (SELF.test(n)) return 'Ich';
  // "kleiner Bruder" bleibt, Großschreibung am Anfang
  n = n.replace(/\s+/g, ' ');
  return n.charAt(0).toUpperCase() + n.slice(1);
}

function wordKey(name: string): string {
  const n = name.toLowerCase();
  for (const g of SAME_WORD) if (g.includes(n)) return g[0];
  return n;
}

/** Person zu einem Namen ("meine Mutter", "Mama", "ich") */
export function findPerson(raw: string, list = people()): Person | undefined {
  const n = cleanName(raw);
  if (n === 'Ich') return list.find((p) => p.me);
  const k = wordKey(n);
  const low = n.toLowerCase();
  return (
    list.find((p) => wordKey(p.name) === k) ||
    list.find((p) => p.role && wordKey(p.role) === k) ||
    // Vorname reicht ("Anna" → "Anna Weiß")
    list.find((p) => low.length >= 3 && p.name.toLowerCase().split(' ')[0] === low) ||
    list.find((p) => p.name.toLowerCase().startsWith(low) && low.length >= 3)
  );
}

/** Personen einer Gruppe ("Familie") */
export function groupMembers(group: string, list = people()): Person[] {
  const g = group.toLowerCase();
  return list.filter((p) => p.groups?.some((x) => x.toLowerCase() === g));
}

export function allGroups(list = people()): string[] {
  return [...new Set(list.flatMap((p) => p.groups || []))];
}

/** Anzeige: "du" für einen selbst */
export function displayName(p: Person): string {
  return p.me ? t('people.me') : p.name;
}

/** Ausführlich: "Anna Weiß (Mutter)", "du (Max Keller)" */
export function fullName(p: Person): string {
  if (p.me) return p.name && p.name !== 'Ich' && p.name !== t('people.meName') ? `${t('people.me')} (${p.name})` : t('people.me');
  return p.role && p.role !== p.name ? `${p.name} (${p.role})` : p.name;
}

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * Gesicht einer Person zuordnen (legt die Person an, wenn es sie noch nicht gibt).
 * Ähnliche Beispiele derselben Person bei anderen Personen werden entfernt (Korrektur).
 */
export function addSample(name: string, emb: number[], crop?: string | null, group?: string, extra: { role?: string; real?: string; me?: boolean } = {}): Person {
  const list = people().map((p) => ({ ...p }));
  const clean = extra.me ? 'Ich' : cleanName(name);
  // erst über den richtigen Namen, dann über die Rolle suchen ("Anna Weiß" bzw. "Mutter")
  let person = (extra.real && findPerson(extra.real, list)) || findPerson(clean, list) || (extra.role ? findPerson(extra.role, list) : undefined);
  if (!person) {
    person = { id: uid(), name: clean === 'Ich' ? extra.real || t('people.meName') : clean, me: clean === 'Ich' || undefined, embs: [], created: Date.now(), updated: Date.now() };
    list.push(person);
  }
  // genauere Angaben übernehmen ("Mutter" → "Anna Weiß, Rolle Mutter"; "Ich" → "Max Keller")
  if (extra.role && !person.role) person.role = extra.role;
  if (extra.real && (person.name === person.role || person.name === t('people.meName') || person.name === 'Ich' || person.name === cleanName(extra.role || ''))) person.name = extra.real;
  // Korrektur: dieses Gesicht war fälschlich bei jemand anderem gelernt
  for (const p of list) {
    if (p === person) continue;
    p.embs = p.embs.filter((e) => cos(e, emb) < 0.8);
  }
  if (!person.embs.some((e) => cos(e, emb) >= DUPLICATE)) {
    person.embs = [...person.embs, emb.map((x) => Math.round(x * 1e4) / 1e4)];
    if (person.embs.length > MAX_SAMPLES) person.embs = thin(person.embs);
  }
  if (crop && !person.crop) person.crop = crop;
  if (group && !person.groups?.some((g) => g.toLowerCase() === group.toLowerCase())) person.groups = [...(person.groups || []), group];
  person.updated = Date.now();
  // Personen ohne Beispiele (nach Korrektur) bleiben, damit Name/Ordner nicht verloren gehen
  savePeople(list);
  return person;
}

/** Zu viele Beispiele: das, das einem anderen am ähnlichsten ist, fällt weg */
function thin(embs: number[][]): number[][] {
  let best = -1;
  let drop = 0;
  for (let i = 0; i < embs.length; i++)
    for (let j = i + 1; j < embs.length; j++) {
      const c = cos(embs[i], embs[j]);
      if (c > best) {
        best = c;
        drop = j;
      }
    }
  return embs.filter((_, i) => i !== drop);
}

/** "Das ist nicht X": ähnliche Beispiele weg und als Gegenbeispiel merken */
export function removeSampleNear(id: string, emb: number[]) {
  const e = emb.map((x) => Math.round(x * 1e4) / 1e4);
  savePeople(
    people().map((p) =>
      p.id === id ? { ...p, embs: p.embs.filter((x) => cos(x, emb) < 0.8), not: [...(p.not || []), e].slice(-12), updated: Date.now() } : p
    )
  );
}

export function renamePerson(id: string, name: string) {
  const n = cleanName(name);
  savePeople(people().map((p) => (p.id === id ? { ...p, name: n === 'Ich' ? p.name : n, me: n === 'Ich' ? true : p.me, updated: Date.now() } : n === 'Ich' ? { ...p, me: undefined } : p)));
}

export function removePerson(id: string) {
  savePeople(people().filter((p) => p.id !== id));
}

export function setGroups(id: string, groups: string[]) {
  savePeople(people().map((p) => (p.id === id ? { ...p, groups: groups.length ? groups : undefined } : p)));
}

/** Zwei Personen sind dieselbe → zusammenlegen */
export function mergePeople(keep: string, other: string) {
  const list = people();
  const a = list.find((p) => p.id === keep);
  const b = list.find((p) => p.id === other);
  if (!a || !b) return;
  let embs = [...a.embs, ...b.embs];
  while (embs.length > MAX_SAMPLES) embs = thin(embs);
  const merged: Person = { ...a, embs, groups: [...new Set([...(a.groups || []), ...(b.groups || [])])], me: a.me || b.me, crop: a.crop || b.crop, updated: Date.now() };
  savePeople(list.filter((p) => p.id !== other).map((p) => (p.id === keep ? merged : p)));
}

/** Gesichter auf Fotos – mit der Person, die es ist (falls bekannt) */
export interface FaceHit {
  box: [number, number, number, number];
  person?: Person;
  /** Ähnlichkeit zur Person (bzw. zur ähnlichsten, wenn unbekannt) */
  p: number;
  /** ähnlichste bekannte Person bei unsicheren Gesichtern */
  maybe?: Person;
  emb?: number[];
}

export async function facesOn(ids: number[], withEmb = false): Promise<Map<number, FaceHit[]>> {
  const out = new Map<number, FaceHit[]>();
  if (!ids.length || !prefs().aiFaces) return out;
  const list = people();
  // Gegenbeispiele ("das ist nicht X") brauchen die Zahlen der Gesichter
  const negatives = list.some((p) => p.not?.length);
  const res: PhotoFaces[] = await api().ai.peopleOn(ids, peopleEmbs(list), SAME, withEmb || negatives).catch(() => []);
  // für "Ist das …?" auch die ähnlichste Person bei Unsicherheit
  const loose: PhotoFaces[] = list.length ? await api().ai.peopleOn(ids, peopleEmbs(list), MAYBE, false).catch(() => []) : [];
  const looseBy = new Map(loose.map((r) => [r.id, r]));
  for (const r of res) {
    const l = looseBy.get(r.id);
    out.set(
      r.id,
      r.faces.map((f, i) => {
        const lf = l?.faces[i];
        let person = f.person !== null ? list[f.person] : undefined;
        if (person?.not && f.emb && person.not.some((n) => cos(n, f.emb!) >= 0.8)) person = undefined;
        const maybe = !person && lf && lf.person !== null && list[lf.person] !== (f.person !== null ? list[f.person] : null) ? list[lf.person] : undefined;
        return { box: f.box, person, p: person ? f.p : lf?.p || f.p, maybe, emb: withEmb ? f.emb : undefined };
      })
    );
  }
  return out;
}

/** "links", "in der Mitte", "rechts" – für Antworten */
export function positionWord(i: number, n: number): string {
  if (n === 1) return '';
  if (i === 0) return t('people.posLeft');
  if (i === n - 1) return t('people.posRight');
  if (n === 3 && i === 1) return t('people.posMiddle');
  return t('people.posNth', { n: i + 1 });
}

/** Lesbare Liste "links Mama, in der Mitte du, rechts unbekannt" */
export function describeFaces(faces: FaceHit[]): string {
  return faces
    .map((f, i) => {
      const pos = positionWord(i, faces.length);
      const who = f.person ? displayName(f.person) : f.maybe ? t('people.maybe', { name: displayName(f.maybe) }) : t('people.unknown');
      return pos ? `${pos}: ${who}` : who;
    })
    .join(', ');
}

/** Für das Sprachmodell: was auf dem Foto erkannt wurde (nur echte Ergebnisse) */
export function facesForPrompt(faces: FaceHit[]): string {
  if (!faces.length) return 'Auf dem aktuellen Foto wurden keine Gesichter gefunden.';
  const parts = faces.map((f, i) => {
    const who = f.person
      ? `${f.person.me ? `du (dein Gegenüber selbst${f.person.name ? ', ' + f.person.name : ''})` : f.person.name + (f.person.role ? `, ${f.person.role}` : '')} (sicher ${Math.round(f.p * 100)} %)`
      : f.maybe
        ? `unbekannt, vielleicht ${f.maybe.me ? 'du (dein Gegenüber selbst)' : f.maybe.name} (nur ${Math.round(f.p * 100)} %)`
        : 'unbekannt';
    return `Gesicht ${i + 1}: ${who}`;
  });
  return `Gesichter auf dem aktuellen Foto, von links nach rechts (echte Gesichtserkennung): ${parts.join('; ')}.`;
}

/** Für das Sprachmodell: welche Personen bekannt sind */
export function peopleForPrompt(): string {
  const list = people();
  if (!list.length) return '';
  return 'Personen, deren Gesichter du kennst: ' + list.map((p) => (p.me ? `${p.name} (dein Gegenüber selbst)` : p.name + (p.role ? ` (${p.role})` : '')) + (p.groups?.length ? ` [${p.groups.join(', ')}]` : '')).join(', ') + '.';
}
