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

export type Intent =
  | { kind: 'help' }
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

/** "Merke dir …" in Regel/Personen/Notiz zerlegen */
export function parseRemember(raw: string): Intent {
  const text = raw.trim().replace(/[.!]+$/, '');
  const s = text.toLowerCase();
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
  if (/\b(was|welche)\b.*\b(hast du (dir )?gemerkt|weißt du (über mich|alles)|merkst du dir|regeln)\b|^(zeig|liste)\w*.*\b(gemerkt|gedächtnis|erinnerungen|regeln)\b|what do you remember/.test(s)) return { kind: 'memories' };
  if (/^(bitte\s+)?(vergiss|vergessen|forget)\b/.test(s)) {
    const rest = text.replace(/^(bitte\s+)?(vergiss|vergessen|forget)\b\s*(bitte\s+)?(das|es|dass|alles)?\s*/i, '').replace(/^(mit|von|über)\s+(den|dem|der)?\s*/i, '');
    return { kind: 'forget', text: rest, all: /^(bitte\s+)?(vergiss|forget)\s+alles\b/.test(s) };
  }
  if (/\b(das|es|dies)\s+soll\s+(jetzt\s+|ab jetzt\s+)?nicht mehr\s+(so\s+)?(sein|gelten)|\bnicht mehr merken\b|\bgilt nicht mehr\b/.test(s)) return { kind: 'forget', text: '' };
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
