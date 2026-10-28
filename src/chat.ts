/**
 * Versteht, was im Chat geschrieben wird (Deutsch und Englisch, Suche in allen Sprachen).
 * Läuft ohne Internet: feste Muster für Befehle, alles andere wird zur Bildsuche
 * (die KI vergleicht dann den Text mit den Fotos).
 */

export interface DateFilter {
  years?: number[];
  /** 0 = Januar */
  months?: number[];
  from?: number;
  to?: number;
}

/** Worauf sich "sie", "diese" … beziehen */
export type Ref = 'results' | 'selection' | 'current';

/** Wo auf dem Foto: n-tes von links/rechts, Mitte, neben dem vorigen, oder ohne Angabe */
export interface NamePos {
  from: 'left' | 'right' | 'middle' | 'next' | 'prev' | 'any';
  n: number;
}
export interface NameItem {
  pos: NamePos;
  /** wie die Person heißen soll ("Anna Weiß", "Bruder", "ich") */
  name: string;
  /** Rolle ("Mutter"), falls genannt */
  role?: string;
  /** das bin ich */
  me?: boolean;
  /** richtiger Name, falls genannt ("Max Keller") */
  real?: string;
}

export type Intent =
  | { kind: 'help' }
  /** Gesichter benennen: "ich bin links, mein Bruder daneben, Mama rechts" */
  | { kind: 'name'; items: NameItem[]; ref: Ref; group?: string }
  /** Ding merken: "Das ist mein Auto" (bzw. "nicht mein Auto") */
  | { kind: 'thing'; name: string; not?: boolean; ref: Ref }
  /** "Wer ist auf dem Foto?", "Erkennst du die Personen?" */
  | { kind: 'whois'; ref: Ref }
  /** "Welche Personen kennst du?", "Personen verwalten" */
  | { kind: 'people' }
  /** "Wer ist das?" für unbekannte Gesichter auf vielen Fotos */
  | { kind: 'unknownFaces' }
  | { kind: 'describe' }
  | { kind: 'greet' }
  | { kind: 'thanks' }
  | { kind: 'stats' }
  | { kind: 'dupes' }
  | { kind: 'similar' }
  | { kind: 'autosort' }
  | { kind: 'undo' }
  | { kind: 'reset' }
  | { kind: 'select' }
  | { kind: 'showOnly' }
  | { kind: 'theme'; theme: 'dark' | 'light' }
  | { kind: 'settings' }
  | { kind: 'move'; target: string; ref: Ref; query?: string; date?: DateFilter; video?: boolean }
  | { kind: 'delete'; ref: Ref; query?: string; date?: DateFilter; video?: boolean }
  | { kind: 'search'; query: string; date?: DateFilter; video?: boolean }
  /** "Merke dir …" – Regel für Ordner, Personen oder freie Notiz */
  | { kind: 'remember'; text: string; concept?: string; folder?: string; faces?: { label: string; folder?: string; ref: Ref } }
  /** "Vergiss das" / "Das soll nicht mehr so sein" (text leer = das zuletzt Gemerkte) */
  | { kind: 'forget'; text: string; all?: boolean }
  | { kind: 'memories' }
  /** Einstellung ändern (der Satz wird später zugeordnet) */
  | { kind: 'setting'; text: string }
  | { kind: 'mkfolder'; name: string };

const MONTHS: [RegExp, number][] = [
  [/\b(januar|jänner|january|jan)\b/, 0],
  [/\b(februar|feber|february|feb)\b/, 1],
  [/\b(märz|maerz|march|mär)\b/, 2],
  [/\b(april|apr)\b/, 3],
  [/\b(mai|may)\b/, 4],
  [/\b(juni|june|jun)\b/, 5],
  [/\b(juli|july|jul)\b/, 6],
  [/\b(august|aug)\b/, 7],
  [/\b(september|sept|sep)\b/, 8],
  [/\b(oktober|october|okt|oct)\b/, 9],
  [/\b(november|nov)\b/, 10],
  [/\b(dezember|december|dez|dec)\b/, 11],
];

const SEASONS: [RegExp, number[]][] = [
  [/\b(sommer|summer)\b/, [5, 6, 7]],
  [/\b(winter)\b/, [11, 0, 1]],
  [/\b(frühling|fruehling|frühjahr|spring)\b/, [2, 3, 4]],
  [/\b(herbst|autumn|fall)\b/, [8, 9, 10]],
];

const DAY = 86400000;

/** Datumsangaben herauslösen. Gibt den Rest-Text und den Filter zurück. */
export function extractDate(text: string, now = Date.now()): { rest: string; date?: DateFilter } {
  let s = ' ' + text + ' ';
  const date: DateFilter = {};
  const cut = (re: RegExp) => {
    s = s.replace(re, ' ');
  };
  const today0 = new Date(now);
  today0.setHours(0, 0, 0, 0);
  const t0 = today0.getTime();
  const rel: [RegExp, () => void][] = [
    [/\b(von |vom |from )?(heute|today)\b/i, () => ((date.from = t0), (date.to = t0 + DAY))],
    [/\b(von |vom |from )?(gestern|yesterday)\b/i, () => ((date.from = t0 - DAY), (date.to = t0))],
    [/\b(aus |von |from |in )?(der |the )?(letzten|vergangenen|last|past) (woche|week)\b/i, () => ((date.from = t0 - 7 * DAY), (date.to = t0 + DAY))],
    [/\b(aus |von |from |in )?(dem |the )?(letzten|vergangenen|last|past) (monat|month)\b/i, () => ((date.from = t0 - 31 * DAY), (date.to = t0 + DAY))],
    [/\b(aus |von |from |in )?(diesem|dieses|this) (jahr|year)\b/i, () => (date.years = [today0.getFullYear()])],
    [/\b(aus |von |from |in )?(dem |the )?(letzten|letztes|vergangenen|vergangenes|last) (jahr|year)\b/i, () => (date.years = [today0.getFullYear() - 1])],
  ];
  for (const [re, f] of rel) {
    if (re.test(s)) {
      f();
      cut(re);
    }
  }
  const years = [...s.matchAll(/\b(19[5-9]\d|20[0-9]\d)\b/g)].map((m) => +m[1]);
  if (years.length) {
    // "2019 bis 2021" / "2019-2021"
    const range = /\b(19[5-9]\d|20[0-9]\d)\s*(bis|-|–|to|until)\s*(19[5-9]\d|20[0-9]\d)\b/i.exec(s);
    if (range) {
      const [a, b] = [+range[1], +range[3]].sort((x, y) => x - y);
      date.years = Array.from({ length: b - a + 1 }, (_, i) => a + i);
    } else date.years = years;
    cut(/\b(aus |von |vom |im jahr |in |from |of )?(dem jahr |the year )?(19[5-9]\d|20[0-9]\d)(\s*(bis|-|–|to|until)\s*(19[5-9]\d|20[0-9]\d))?\b/gi);
  }
  const months: number[] = [];
  for (const [re, m] of MONTHS) {
    if (new RegExp(re.source, 'i').test(s)) {
      months.push(m);
      cut(new RegExp('\\b(im |in |aus dem |vom |von |from )?' + re.source.slice(2, -2) + '\\b', 'i'));
    }
  }
  for (const [re, ms] of SEASONS) {
    if (new RegExp(re.source, 'i').test(s)) {
      months.push(...ms);
      cut(new RegExp('\\b(im |in |aus dem |vom |von |from |during )?(the )?' + re.source.slice(2, -2) + '(urlaub)?\\b', 'i'));
    }
  }
  if (months.length) date.months = months;
  const rest = s.replace(/\s+/g, ' ').trim();
  return Object.keys(date).length ? { rest, date } : { rest };
}

export function matchesDate(ms: number, d: DateFilter): boolean {
  if (!isFinite(ms)) return false;
  const x = new Date(ms);
  if (d.from !== undefined && ms < d.from) return false;
  if (d.to !== undefined && ms >= d.to) return false;
  if (d.years && !d.years.includes(x.getFullYear())) return false;
  if (d.months && !d.months.includes(x.getMonth())) return false;
  return true;
}

/** Füllwörter am Anfang weg: "Suche mir alle Fotos, wo …" → "…" */
export function cleanQuery(q: string): string {
  let s = q.trim().replace(/[?!.]+$/, '').trim();
  const lead =
    /^(bitte |please |kannst du |can you |könntest du |could you )?(mir |me )?(such|find|zeig|show|search|gib|hol|look for|give)\w*( mir| me| for| nach)?( bitte| please)?( mal)?\b[ ,:]*/i;
  s = s.replace(lead, '');
  s = s.replace(/^(alle|all|sämtliche|every|nur|only)\s+(?!(fotos?|bilder?|photos?|pictures?|images?)\b)/i, '');
  s = s.replace(/^(alle |all |nur |only )?(die |das |den |dem |ein |eine |einen |the |a |an )?(fotos?|bilder?|photos?|pictures?|images?|aufnahmen|pics?)\b[ ,:]*/i, '');
  s = s.replace(/^(wo |where |auf (dem|denen|der) |on which |in which |with |mit |von |of |vom |showing |die |das )/i, '');
  s = s.replace(/^(drauf |darauf )?(zu sehen )?(ist |sind |is |are )?/i, '');
  return s.replace(/\s+/g, ' ').trim();
}

const REF_WORDS = /^(sie|die|diese|diesen|dieses|das|alle|alles|them|these|those|it|all|the|fotos|bilder|photos|pictures|die fotos|diese fotos|these photos|all of them|alle davon|die treffer|the results)$/i;

function refOf(s: string): Ref {
  if (/\b(ausgewählt\w*|markiert\w*|selected|selection|auswahl)\b/i.test(s)) return 'selection';
  if (/\b(dieses foto|dieses bild|das hier|aktuell\w*|current|this photo|this one|this picture)\b/i.test(s)) return 'current';
  return 'results';
}

/** Ein Bezugswort ("sie", "diese", "alle") oder eine Beschreibung ("alle Strandfotos")? */
function queryPart(s: string): { query?: string; date?: DateFilter; video?: boolean } {
  const { rest, date } = extractDate(s);
  let r = rest.replace(/\b(ausgewählt\w*|markiert\w*|selected|dieses foto|dieses bild|das hier|this photo|this one)\b/gi, '').trim();
  const video = /\b(videos?|filme?|clips?)\b/i.test(r);
  if (video) r = r.replace(/\b(videos?|filme?|clips?)\b/gi, '').trim();
  r = cleanQuery(r);
  const only = !r || REF_WORDS.test(r) || /^(alle |all )?(fotos|bilder|photos|pictures)?$/i.test(r);
  return { query: only ? undefined : r, date, video: video || undefined };
}

const ORD: Record<string, number> = { erste: 0, '1.': 0, zweite: 1, '2.': 1, dritte: 2, '3.': 2, vierte: 3, '4.': 3, fünfte: 4, '5.': 4, sechste: 5, '6.': 5 };
const POS_RE = [
  { re: /\b(?:der|die|das)?\s*(erste|zweite|dritte|vierte|fünfte|sechste|[1-6]\.)\s*(?:person\s+|gesicht\s+)?von\s+(links|rechts)\b/, pos: (m: RegExpExecArray): NamePos => ({ from: m[2] === 'links' ? 'left' : 'right', n: ORD[m[1]] ?? 0 }) },
  { re: /\blinks\s+(?:daneben|neben\s+\w+)|\bdavor\b/, pos: (): NamePos => ({ from: 'prev', n: 0 }) },
  { re: /\b(?:rechts\s+)?daneben\b|\bneben\s+(?:mir|ihm|ihr|ihnen|dem|der)\b|\bdanach\b|\bals nächste[rs]?\b|\bdann\b/, pos: (): NamePos => ({ from: 'next', n: 0 }) },
  { re: /\b(?:in der\s+)?mitte\b|\bmittig\b|\bdazwischen\b|\bin the middle\b|\bau milieu\b|\bal centro\b|\ben el medio\b/, pos: (): NamePos => ({ from: 'middle', n: 0 }) },
  { re: /\b(?:ganz\s+)?links\b|\b(?:far\s+)?left\b|\bà gauche\b|\ba (?:la )?izquierda\b|\ba sinistra\b/, pos: (): NamePos => ({ from: 'left', n: 0 }) },
  { re: /\b(?:ganz\s+)?rechts\b|\b(?:far\s+)?right\b|\bà droite\b|\ba (?:la )?derecha\b|\ba destra\b/, pos: (): NamePos => ({ from: 'right', n: 0 }) },
];
/**
 * Wer ist wo auf dem Foto? "ich bin ganz links, mein Bruder ist daneben und meine Mutter ganz rechts",
 * "von links nach rechts: Lisa, Tom und Max", "das bin ich", "das ist meine Mutter".
 */
export function parseNaming(text: string): NameItem[] | null {
  const s = text.trim().replace(/[.!]+$/, '');
  if (/^(?:bitte\s+)?(?:lösch|verschieb|kopier|zeig|such|find|sortier|öffne|schalt|stell|mach|leg|gib|hol|wähl|markier|delete|move|show|find|open)\w*\b/i.test(s)) return null;
  // Reihenfolge: "von links nach rechts: A, B und C"
  const seq = /\bvon\s+(links|rechts)(?:\s+nach\s+(?:rechts|links))?\s*[:,]?\s*(?:sind\s+(?:das\s+)?|das\s+sind\s+)?(.+)$/i.exec(s) || /\bfrom\s+(left|right)(?:\s+to\s+(?:right|left))?\s*[:,]?\s*(.+)$/i.exec(s);
  if (seq) {
    const names = seq[2].split(/\s*(?:,|;|\bund\b|\band\b|\bet\b|\by\b|\be\b)\s*/i).map((x) => namePhrase(x.trim(), 'lead')).filter((x): x is Omit<NameItem, 'pos'> => !!x);
    if (names.length >= 2) return names.map((x, i) => ({ ...x, pos: { from: /links|left/i.test(seq[1]) ? 'left' : 'right', n: i } }));
  }
  // alle Positionsangaben im Satz (spezifische vor allgemeinen, ohne Überschneidung)
  const low = s.toLowerCase();
  const found: { i: number; end: number; pri: number; pos: NamePos }[] = [];
  POS_RE.forEach((p, pri) => {
    for (const m of low.matchAll(new RegExp(p.re.source, 'g'))) found.push({ i: m.index!, end: m.index! + m[0].length, pri, pos: p.pos(m as RegExpExecArray) });
  });
  found.sort((a, b) => a.i - b.i || a.pri - b.pri);
  const marks: typeof found = [];
  for (const f of found) {
    const last = marks[marks.length - 1];
    if (last && f.i < last.end) {
      if (f.pri < last.pri) marks[marks.length - 1] = f;
      continue;
    }
    marks.push(f);
  }
  const items: NameItem[] = [];
  const used = new Set<number>();
  // Satzzeichen trennen Satzteile; ein Name gehört zur Position davor oder danach
  const before = (k: number) => {
    const from = k > 0 ? marks[k - 1].end : 0;
    const t = s.slice(from, marks[k].i);
    const cut = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'), t.lastIndexOf(';'), t.lastIndexOf('?'), t.lastIndexOf('!'), t.lastIndexOf(':'));
    return t.slice(cut + 1);
  };
  const after = (k: number) => {
    const t = s.slice(marks[k].end, k + 1 < marks.length ? marks[k + 1].i : s.length);
    const m = /[,.;?!:]/.exec(t);
    return m ? t.slice(0, m.index) : t;
  };
  const VERB = '(?:ist|bin|sind|steht|stehe|stehen|sitzt|sitze|sitzen|befindet sich|kommt|is|am|are|stands?)';
  marks.forEach((m, k) => {
    const b = before(k);
    const a = after(k);
    // "ich bin ganz links" / "mein Bruder ist daneben" → Name davor
    const bm = new RegExp(`^(.*?)\\s*${VERB}\\s*(?:ganz|hier|da)?\\s*$`, 'i').exec(b);
    const am = new RegExp(`^\\s*${VERB}\\s+(.*)$`, 'i').exec(a);
    let x: Omit<NameItem, 'pos'> | null = null;
    if (bm && !used.has(k - 0.5) && (x = namePhrase(bm[1], 'tail'))) used.add(k - 0.5);
    else if (am && !used.has(k + 0.5) && (x = namePhrase(am[1], 'lead'))) used.add(k + 0.5);
    else if (!used.has(k + 0.5) && (x = namePhrase(a, 'lead'))) used.add(k + 0.5);
    else if (!used.has(k - 0.5) && (x = namePhrase(b, 'tail'))) used.add(k - 0.5);
    if (x) items.push({ ...x, pos: m.pos });
  });
  if (items.length && items.some((x) => x.pos.from !== 'next' && x.pos.from !== 'prev')) return items;
  // ohne Position: "das bin ich", "das ist meine Mutter", "das ist Lukas"
  const one = /^(?:und\s+)?(?:das|dies|hier|that|this|c'est|questo|esto)\s+(?:bin|ist|is|es|è|sono)\s+(.+)$/i.exec(s);
  if (one) {
    const n = one[1].trim();
    if (/^(ich|me|moi|yo|io)$/i.test(n) || /^(mein|meine|my|ma|mon|mi|mia|mio)\s+[\wäöüß-]+(\s+[A-ZÄÖÜ][\wäöüß-]+){0,2}$/i.test(n) || /^[A-ZÄÖÜ][\wäöüß-]+(\s+[A-ZÄÖÜ][\wäöüß-]+)?$/.test(n)) {
      const x = namePhrase(n, 'lead');
      if (x) return [{ ...x, pos: { from: 'any', n: 0 } }];
    }
  }
  return null;
}

/**
 * "Das ist mein Auto", "Merk dir: das ist unser Haus", "Das ist nicht mein Auto" → Ding (keine Person).
 * Personen-Rollen ("meine Mutter") gehören nicht hierher.
 */
export function parseThing(text: string): Extract<Intent, { kind: 'thing' }> | null {
  const m = /^(?:bitte\s+)?(?:merke?\s+dir[,:]?\s*(?:dass\s+)?)?(?:das|dies|hier)\s+(?:ist|sind)\s+(nicht\s+)?((?:mein|meine|unser|unsere|dein|deine)\s+.+?)\s*[.!]?$/i.exec(text.trim());
  if (!m) return null;
  const words = m[2].split(/\s+/).slice(1);
  const noun = words.find((w) => /^[A-ZÄÖÜ]/.test(w)) || words[0] || '';
  if (!noun || ROLE.test(noun) || words.length > 5) return null;
  const ref: Ref = /markiert|ausgewählt/i.test(text) ? 'selection' : 'current';
  return { kind: 'thing', name: m[2].replace(/\s+(auf|in)\s+(dem|diesem|den)\s+(foto|bild|fotos|bildern)\b.*$/i, ''), not: !!m[1], ref };
}

/** "das sind meine Familie", "meine Freunde" → Gruppe */
export function groupOf(text: string): string | undefined {
  const m = /\b(?:sind|ist|als)\s+(?:meine|unsere|my|our)\s+(familie|freunde|freundinnen|kollegen|klasse|geschwister|eltern|großeltern|cousins|family|friends)\b/i.exec(text) || /\b(?:meine|unsere)\s+(familie|freunde|eltern|geschwister)\b/i.exec(text);
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : undefined;
}

/** Rollen in der Familie und im Umfeld (für "meine Mutter Anna") */
const ROLE = /^(mutter|mama|mami|vater|papa|papi|bruder|schwester|oma|omi|opa|opi|großmutter|großvater|onkel|tante|cousin|cousine|sohn|tochter|freund|freundin|frau|mann|ehefrau|ehemann|partner|partnerin|kind|baby|enkel|enkelin|nichte|neffe|schwager|schwägerin|stiefvater|stiefmutter|lehrer|lehrerin|chef|chefin|kollege|kollegin|nachbar|nachbarin|patenonkel|patentante|mom|mum|mother|dad|father|brother|sister|grandma|grandpa|friend|wife|husband|son|daughter)$/i;
const POSS = /^(mein|meine|meinen|meinem|meiner|unser|unsere|unseren|unserem|unserer|dein|deine|my|our)$/i;
const NOT_NAME = /^(foto|fotos|bild|bilder|familie|person|personen|leute|gesicht|gesichter|ganz|links|rechts|mitte|daneben|neben|und|wieder|auch|dann|hier|da|das|der|die|siehst|sieh|schau|guck|merke|merk|bitte|ja|nein|okay|ok|photo|picture)$/i;

/**
 * Name aus einem Satzteil: "meine Mutter Anna Weiß" → Anna Weiß (Rolle Mutter), "ich Max Keller" → ich (Max Keller),
 * "mein Bruder" → Bruder. `lead`: Name steht am Anfang, `tail`: am Ende.
 */
function namePhrase(part: string, where: 'lead' | 'tail'): Omit<NameItem, 'pos'> | null {
  let w = part.replace(/[„“"»«()]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (where === 'tail') {
    // vom Ende her: Namen, Rolle, "mein", "ich"
    let k = w.length;
    while (k > 0 && (/^[A-ZÄÖÜ]/.test(w[k - 1]) || /^(ich|mir|mich)$/i.test(w[k - 1]) || POSS.test(w[k - 1]) || ROLE.test(w[k - 1])) && !NOT_NAME.test(w[k - 1])) k--;
    w = w.slice(k);
  } else {
    let k = 0;
    while (k < w.length && (/^[A-ZÄÖÜ]/.test(w[k]) || /^(ich|mir|mich)$/i.test(w[k]) || POSS.test(w[k]) || ROLE.test(w[k])) && !NOT_NAME.test(w[k])) k++;
    w = w.slice(0, k);
  }
  while (w.length && POSS.test(w[0])) w.shift();
  if (!w.length || w.length > 4) return null;
  const me = /^(ich|mir|mich)$/i.test(w[0]);
  if (me) w.shift();
  let role: string | undefined;
  if (w.length && ROLE.test(w[0])) role = w.shift()!.replace(/^./, (c) => c.toUpperCase());
  const real = w.join(' ');
  if (me) return { name: 'ich', me: true, real: real || undefined };
  if (!real && !role) return null;
  return { name: real || role!, role, real: real || undefined };
}

/**
 * Positionen auf eine Anzahl Gesichter (von links nach rechts) abbilden.
 * Liefert je Gesicht den Namen; null, wenn es nicht eindeutig passt.
 */
export function resolveNamingItems(items: NameItem[], count: number): (NameItem | null)[] | null {
  if (!count) return null;
  const out: (NameItem | null)[] = Array(count).fill(null);
  let prev = -1;
  for (const it of items) {
    let i: number;
    switch (it.pos.from) {
      case 'left':
        i = it.pos.n;
        break;
      case 'right':
        i = count - 1 - it.pos.n;
        break;
      case 'middle':
        i = Math.floor((count - 1) / 2);
        if (out[i] !== null && count % 2 === 0) i += 1;
        break;
      case 'next':
        // neben dem Vorigen: Richtung zur Mitte (vom rechten Rand aus nach links)
        i = prev === count - 1 ? prev - 1 : prev + 1;
        break;
      case 'prev':
        i = prev - 1;
        break;
      default: {
        const free = out.map((x, j) => (x === null ? j : -1)).filter((j) => j >= 0);
        if (free.length !== 1) return null;
        i = free[0];
      }
    }
    if (i < 0 || i >= count || out[i] !== null) return null;
    out[i] = it;
    prev = i;
  }
  return out;
}

/** Wie resolveNamingItems, aber nur die Namen */
export function resolveNaming(items: NameItem[], count: number): (string | null)[] | null {
  const r = resolveNamingItems(items, count);
  return r && r.map((x) => (x ? x.name : null));
}

/** "Merke dir …" in Regel/Personen/Notiz zerlegen */
export function parseRemember(raw: string): Intent {
  const text = raw.trim().replace(/[.!]+$/, '');
  const s = text.toLowerCase();
  const th = parseThing(text);
  if (th) return th;
  // Einzelne Personen mit Position: "diese Personen: ich bin links, mein Bruder daneben, Mama rechts"
  const naming = parseNaming(text);
  if (naming && (naming.length > 1 || naming[0].pos.from !== 'any' || /^(das|dies)\s+(bin|ist)/i.test(text))) {
    const ref: Ref = /markiert|ausgewählt/.test(s) ? 'selection' : 'current';
    return { kind: 'name', items: naming, ref, group: groupOf(text) };
  }
  // Personen: "die (vier) Personen auf diesem Foto sind meine Familie (und sollen in den Ordner X)"
  const fm = /\b(?:personen|person|leute|menschen|gesichter|kinder|die beiden|die zwei|die drei|die vier|der|die|das)\b.*?\b(?:auf|in)\s+(?:diesem|dem|den|diesen|den markierten|den ausgewählten)\s+(?:fotos|foto|bildern|bilder|bild)\b\s*(?:(?:ist|sind|zeigt|zeigen)\s+)?(?:(?:meine|meinen|meiner|mein|unsere|unser|my|our)\s+)?([\wäöüß-]+)/i.exec(text);
  if (fm) {
    const folder = /\b(?:in|nach)\s+(?:den |dem |die |das )?(?:ordner\s+)?["„»]?([^"“«]+?)["“«]?(?:\s+(?:ordner|verschoben|sortiert|kommen|gehören|rein|sollen))*$/i.exec(text.slice(fm.index + fm[0].length))?.[1];
    const ref: Ref = /markiert|ausgewählt|diesen fotos|diesen bildern|den fotos/.test(s) ? 'selection' : 'current';
    return { kind: 'remember', text, faces: { label: fm[1], folder: folder?.trim(), ref } };
  }
  // Regel: "Fotos mit Autos sollen (immer) in den Ordner Autos"
  const cm =
    /\b(?:fotos?|bilder?|aufnahmen|alles)\s+(?:mit|von|vom|von einem|von einer|wo|auf denen)\s+(.+?)\s+(?:sollen|soll|gehören|gehört|kommen|kommt|immer|bitte)\b.*?\b(?:in|nach|zu)\s+(?:den |dem |die |das )?(?:ordner\s+)?["„»]?([^"“«]+?)["“«]?(?:\s+(?:ordner|verschoben|sortiert|kommen|gehören|rein|sortieren|schieben|sollen|soll|werden|wandern))*$/i.exec(text);
  if (cm) return { kind: 'remember', text, concept: cm[1].trim(), folder: cm[2].trim() };
  // "Autos immer nach Fahrzeuge"
  const cm2 = /^(.+?)\s+(?:immer|grundsätzlich|automatisch)\s+(?:in|nach)\s+(?:den |dem |die |das )?(?:ordner\s+)?["„»]?([^"“«]+?)["“«]?$/i.exec(text);
  if (cm2) return { kind: 'remember', text, concept: cm2[1].replace(/^(fotos?|bilder?)\s+(mit|von)\s+/i, '').trim(), folder: cm2[2].trim() };
  return { kind: 'remember', text };
}

/** Wörter, an denen man eine Einstellung erkennt ("mach das Design hell") */
const SETTING_WORDS = /\b(design|theme|thema|sprache|language|akzent\w*|farbe|modus|mode|filmstreifen|filmstrip|oberfläche|schrift\w*|autopilot\w*|vorschläge?|serien|restzeit|papierkorb|zen|updates?)\b/;

export function parse(input: string): Intent {
  const text = input.trim();
  const s = text.toLowerCase();
  // Gedächtnis
  const rem = /^(?:bitte\s+)?(?:merk|merke|merken|notier|notiere|remember)\w*(?:\s+dir|\s+sich|\s+that)?\s*[,:]?\s*(?:dass\s+|that\s+)?(.+)$/i.exec(text);
  if (rem && rem[1].trim().length > 2) return parseRemember(rem[1]);
  // "Kannst du dir (bitte) merken, dass …", "Ich möchte, dass du dir merkst: …"
  const rem2 = /\b(?:kannst|könntest|würdest|sollst|musst)\s+du\s+(?:dir\s+)?(?:bitte\s+)?(?:\w+\s+){0,3}?(?:merken|notieren|speichern)\b\s*[,:]?\s*(?:dass\s+)?(.*)$|\bdass du dir (?:merkst|notierst)\s*[,:]?\s*(?:dass\s+)?(.+)$/i.exec(text);
  if (rem2) {
    const rest = (rem2[1] || rem2[2] || '').replace(/[?]+$/, '').trim();
    if (rest.length > 2) return parseRemember(rest);
    // "Kannst du dir diese Personen merken? Ich bin links …" → Rest des Satzes
    const after = text.slice(text.search(/[?!.]/) + 1).trim();
    if (after.length > 2) return parseRemember(after);
  }
  if (/\b(was|welche)\b.*\b(hast du (dir )?gemerkt|weißt du (über mich|alles)|merkst du dir|regeln)\b|^(zeig|liste)\w*.*\b(gemerkt|gedächtnis|erinnerungen|regeln)\b|what do you remember/.test(s)) return { kind: 'memories' };
  if (/^(bitte\s+)?(vergiss|vergessen|forget)\b/.test(s)) {
    const rest = text.replace(/^(bitte\s+)?(vergiss|vergessen|forget)\b\s*(bitte\s+)?(das|es|dass|alles)?\s*/i, '').replace(/^(mit|von|über)\s+(den|dem|der)?\s*/i, '');
    return { kind: 'forget', text: rest, all: /^(bitte\s+)?(vergiss|forget)\s+alles\b/.test(s) };
  }
  if (/\b(das|es|dies)\s+soll\s+(jetzt\s+|ab jetzt\s+)?nicht mehr\s+(so\s+)?(sein|gelten)|\bnicht mehr merken\b|\bgilt nicht mehr\b/.test(s)) return { kind: 'forget', text: '' };
  // Regel ohne "merke dir": "Fotos mit meinem Bruder sollen in den Ordner Lukas"
  if (/^(?:alle\s+)?(?:fotos?|bilder?)\s+(?:mit|von|vom|wo|auf denen)\s+.+\s+(?:sollen|soll|gehören|kommen)\b.*\b(?:in|nach)\s+/i.test(text)) {
    const r = parseRemember(text);
    if (r.kind === 'remember' && r.concept) return r;
  }
  // Dinge ("das ist mein Auto")
  const thing = parseThing(text);
  if (thing) return thing;
  // Personen
  if (/^(wer|who)\s+(steht|stehen|sitzt|sitzen|ist|sind|is|are)\s+(da\s+|hier\s+)?(ganz\s+)?(links|rechts|in der mitte|vorne|hinten|daneben|neben)\b/.test(s)) return { kind: 'whois', ref: 'current' };
  if (/\b(wer|who|qui|quién|chi)\b.*\b(ist|sind|is|are|est|es|è)\b.*\b(das|da|drauf|darauf|auf (dem|diesem) (foto|bild)|zu sehen|this|that|on (this|the) (photo|picture)|links|rechts|in der mitte)\b|\berkennst du\b|\bweißt du,? wer\b|\bkennst du (die|diese|den|ihn|sie)\b(?! .*(ordner|einstellung))|\bwho('s| is) (this|that|in)\b|\brecogni[sz]e\b|\bwen siehst du\b|\bwelche personen\b.*\b(foto|bild|drauf)\b/.test(s))
    return { kind: 'whois', ref: /markiert|ausgewählt|selected/.test(s) ? 'selection' : 'current' };
  if (/\b(welche|wie viele) (personen|leute|menschen|gesichter) (kennst du|weißt du|hast du gelernt)|\bpersonen (verwalten|anzeigen|bearbeiten|übersicht)|^(zeig|öffne)\w*\s+(mir\s+)?(die\s+)?personen\b|\bwho do you know\b|\bmanage people\b/.test(s)) return { kind: 'people' };
  if (/\b(unbekannte|neue|fremde) (personen|gesichter|leute)\b|\bwer (sind|ist) (die|der|das) (unbekannte\w*|andere\w*)\b|\bgesichter benennen\b|\bpersonen benennen\b|\bname (the )?(faces|people)\b/.test(s)) return { kind: 'unknownFaces' };
  const naming = parseNaming(text);
  if (naming && (naming.length > 1 || naming[0].pos.from !== 'any' || /^(das|dies|hier|this|that)\s+(bin|ist|is)\b/i.test(text)))
    return { kind: 'name', items: naming, ref: /markiert|ausgewählt/.test(s) ? 'selection' : 'current', group: groupOf(text) };
  // Ordner anlegen
  const mk = /^(?:bitte\s+)?(?:leg|erstell|mach|erzeug|create|make)\w*\s+(?:mir\s+)?(?:einen\s+|einen neuen\s+|neuen\s+|a\s+|a new\s+)?(?:ziel)?(?:ordner|folder)\s+(?:an\s+)?(?:namens\s+|mit dem namen\s+|called\s+|named\s+)?["„»]?([^"“«]+?)["“«]?(?:\s+an)?[.!]?$/i.exec(text);
  if (mk) return { kind: 'mkfolder', name: mk[1].trim() };
  // Einstellungen ("schalte den Autopiloten an", "stelle die Sprache auf Englisch")
  if (/^(?:bitte\s+)?(?:stell|schalt|aktivier|deaktivier|änder|setz|mach|turn|switch|enable|disable|set|change)\w*\b/.test(s) && (/\b(an|aus|ein|auf|on|off|to|aktivier\w*|deaktivier\w*)\b/.test(s) || SETTING_WORDS.test(s)) && (!/\b(foto|fotos|bild|bilder|photo|photos)\b/.test(s) || (SETTING_WORDS.test(s) && !/\b(nach|in den|into)\b/.test(s)))) return { kind: 'setting', text };
  if (/^(hilfe|help|\?|was kannst du|what can you do|wie geht das|befehle|commands)\b/.test(s)) return { kind: 'help' };
  if (/^(hallo|hi|hey|servus|moin|grüß dich|guten (morgen|tag|abend)|hello|bonjour|hola|ciao)\b[!. ]*$/.test(s)) return { kind: 'greet' };
  if (/\b(was|what)\b.*\b(ist|siehst du|sieht man|is|do you see|can you see)\b.*\b(auf|in|on|in)\b.*\b(dem|diesem|this|the)\b.*\b(foto|bild|photo|picture|image)\b/.test(s)) return { kind: 'describe' };
  if (/^(danke|vielen dank|dankeschön|thanks|thank you|thx|merci|gracias|grazie)\b/.test(s)) return { kind: 'thanks' };
  if (/^(rückgängig|undo|mach (das|es) rückgängig|zurück)\b/.test(s)) return { kind: 'undo' };
  if (/(dunkl\w*|dark) ?(modus|design|mode|theme)|dunkelmodus|nachtmodus/.test(s)) return { kind: 'theme', theme: 'dark' };
  if (/(hell\w*|light) ?(modus|design|mode|theme)/.test(s)) return { kind: 'theme', theme: 'light' };
  if (/^(öffne |open )?(die )?(einstellungen|settings|optionen)\b/.test(s)) return { kind: 'settings' };
  if (/(alle|all) (fotos |photos |bilder )?(wieder )?(zeigen|anzeigen|show)|filter (weg|aus|entfernen|zurücksetzen|löschen)|(clear|reset) (the )?filter|zurücksetzen|show all|zeig (wieder )?alle\b/.test(s)) return { kind: 'reset' };
  if (/\b(doppelt\w*|duplikat\w*|duplicates?|gleiche fotos|identische)\b/.test(s)) return { kind: 'dupes' };
  if (/(ähnlich\w*|aehnlich\w*|similar)\b|wie (dieses|das hier)|like this( one)?\b/.test(s)) return { kind: 'similar' };
  if (/\b(sortier\w*|sort|ordne\w*|räum\w* auf)\b.*\b(automatisch|selbst|für mich|allein|ki|auto\w*|yourself|for me|by yourself)\b|^(ki|ai|auto) ?(sortieren|sort)|^(sortier\w*|sort)( (es|alles|everything|all))?[.!]*$/.test(s)) return { kind: 'autosort' };
  if (/\b(wie ?viele|how many|übrig|remaining|left|statistik|stats|fortschritt|progress|wie weit)\b/.test(s)) return { kind: 'stats' };

  // Verschieben: "verschiebe sie nach Urlaub", "pack alle Strandfotos in den Ordner Urlaub"
  const mv = /^(?:bitte |please )?(?:verschieb\w*|schieb\w*|pack\w*|tu\w*|steck\w*|leg\w*|sortier\w*|kopier\w*|move|put|sort|file)\s+(.*?)\s*\b(?:nach|in den ordner|in die|in den|ins|in das|in|zu|zum|to the|into the|to|into)\s+(?:den |die |das |ordner |folder |the )*["„»]?(.+?)["“«]?\s*(?:ordner|folder)?[.!]*$/i.exec(text);
  if (mv) {
    const what = mv[1].trim();
    return { kind: 'move', target: mv[2].trim(), ref: refOf(what), ...queryPart(what) };
  }
  // Löschen: "lösche sie", "lösche alle unscharfen Fotos"
  const del = /^(?:bitte |please )?(?:lösch\w*|loesch\w*|entfern\w*|delete|remove|trash|wirf|schmeiß\w*|schmeiss\w*)\s*(.*?)\s*(?:weg|in den papierkorb|in den löschordner|away)?[.!]*$/i.exec(text);
  if (del) {
    const what = del[1].trim();
    return { kind: 'delete', ref: refOf(what), ...queryPart(what) };
  }
  if (/^(?:bitte |please )?(wähl\w*|waehl\w*|markier\w*|select)\b/.test(s)) return { kind: 'select' };
  if (/^(nur (diese|die)|only (these|those))\b|(zeig\w*|show)\b.*\b(übersicht|overview|grid|raster)\b/.test(s)) return { kind: 'showOnly' };

  const q = queryPart(text);
  return { kind: 'search', query: q.query ?? '', date: q.date, video: q.video };
}

/** Zielordner per Name finden (ungefähr: Groß/klein, Umlaute, Anfang reicht) */
export function findTarget<T extends { name: string }>(targets: T[], name: string): T | undefined {
  const norm = (x: string) =>
    x
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]/g, '');
  const n = norm(name);
  if (!n) return undefined;
  return (
    targets.find((t) => norm(t.name) === n) ||
    targets.find((t) => norm(t.name).startsWith(n) || n.startsWith(norm(t.name))) ||
    targets.find((t) => norm(t.name).includes(n))
  );
}
