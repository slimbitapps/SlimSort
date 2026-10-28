/**
 * KI-Assistent mit Sprachmodell (Stufen "Ausgewogen" und "Maximal").
 *
 * Ablauf je Nachricht:
 *  1. SlimSort entscheidet selbst (zuverlässig, ohne Wartezeit), ob Fotos gesucht werden sollen,
 *     und führt das aus (Bildsuche mit dem Bildmodell).
 *  2. Das Sprachmodell bekommt Frage, aktuelle Lage und ggf. das Suchergebnis und antwortet
 *     in normalen Sätzen (Wort für Wort sichtbar).
 *
 * Die Anleitung (System-Text) bleibt immer gleich und wird im Helfer-Programm zwischengespeichert –
 * die aktuelle Lage steht in der Nachricht selbst. So geht jede Antwort schnell los.
 */
import { getLang } from './i18n';
import { activeProfile, type SessionState } from './store';
import { itemTime } from './util';
import type { Item } from './types';

export interface Turn {
  user: string;
  assistant: string;
}

const fmtDate = (ms: number) =>
  isFinite(ms) ? new Date(ms).toLocaleString(getLang() === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'long', timeStyle: 'short' }) : '?';

export function describeItem(it: Item, tags: string[]): string {
  const t = tags.length ? `; darauf erkannt: ${tags.join(', ')}` : '';
  return `${it.name}, aufgenommen ${fmtDate(itemTime(it))}${t}`;
}

const LANG_NAME: Record<string, string> = { de: 'Deutsch', en: 'Englisch', fr: 'Französisch', es: 'Spanisch', it: 'Italienisch' };

/** Werkzeuge, die das Sprachmodell aufrufen kann (Qwen-Format). Beschreibungen kurz halten – jedes Wort kostet Rechenzeit. */
export const TOOLS = [
  { name: 'fotos_suchen', description: 'Fotos in der geöffneten Sortierung nach Inhalt suchen und zeigen (z. B. "Hund am Strand", "Sonnenuntergang"). Nicht für Personen.', parameters: { type: 'object', properties: { beschreibung: { type: 'string', description: 'Was auf den Fotos zu sehen sein soll' } }, required: ['beschreibung'] } },
  { name: 'fotos_mit_personen', description: 'Fotos zeigen, auf denen bestimmte bekannte Personen sind (Gesichtserkennung).', parameters: { type: 'object', properties: { namen: { type: 'array', items: { type: 'string' }, description: 'Namen, z. B. ["Mama"] oder ["ich", "Bruder"]' } }, required: ['namen'] } },
  { name: 'personen_auf_foto', description: 'Echte Gesichtserkennung auf dem aktuellen Foto: wer ist wo (von links nach rechts). Immer benutzen, wenn nach Personen auf dem Foto gefragt wird – nie raten.', parameters: { type: 'object', properties: {} } },
  { name: 'personen_benennen', description: 'Gesichter auf dem aktuellen Foto Personen zuordnen und die Gesichter lernen. Gesichter sind von links nach rechts nummeriert (1 = ganz links).', parameters: { type: 'object', properties: { zuordnung: { type: 'array', items: { type: 'object', properties: { gesicht: { type: 'integer' }, name: { type: 'string', description: 'Name oder Rolle, z. B. "Mama", "Lukas"; "ich" für dein Gegenüber selbst' } }, required: ['gesicht', 'name'] } } }, required: ['zuordnung'] } },
  { name: 'merken', description: 'Sich etwas dauerhaft merken: eine Regel ("Fotos mit Autos in den Ordner Autos", "Fotos mit Mama in Familie") oder eine Notiz über dein Gegenüber.', parameters: { type: 'object', properties: { text: { type: 'string', description: 'Was gemerkt werden soll, als kurzer Satz' } }, required: ['text'] } },
  { name: 'vergessen', description: 'Etwas Gemerktes wieder vergessen.', parameters: { type: 'object', properties: { was: { type: 'string' } }, required: ['was'] } },
  { name: 'verschieben', description: 'Fotos in einen Zielordner verschieben.', parameters: { type: 'object', properties: { ordner: { type: 'string' }, welche: { type: 'string', enum: ['aktuelles', 'markierte', 'gefundene'] } }, required: ['ordner', 'welche'] } },
  { name: 'loeschen', description: 'Fotos löschen (kommen in den Löschordner).', parameters: { type: 'object', properties: { welche: { type: 'string', enum: ['aktuelles', 'markierte', 'gefundene'] } }, required: ['welche'] } },
  { name: 'einstellung_aendern', description: 'Eine Einstellung der App ändern (Design, Sprache, Autopilot, Vorschläge …).', parameters: { type: 'object', properties: { wunsch: { type: 'string', description: 'z. B. "Design dunkel"' } }, required: ['wunsch'] } },
  { name: 'ordner_anlegen', description: 'Einen neuen Zielordner anlegen.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'aehnliche_fotos', description: 'Fotos zeigen, die dem aktuellen Foto ähneln.', parameters: { type: 'object', properties: {} } },
  { name: 'automatisch_sortieren', description: 'Die KI schlägt für alle offenen Fotos Ordner vor (Übersicht zum Bestätigen).', parameters: { type: 'object', properties: {} } },
] as const;

export type ToolName = (typeof TOOLS)[number]['name'];

/** Anleitung für das Sprachmodell – gleichbleibend (wird zwischengespeichert) */
export function systemPrompt(): string {
  const lang = LANG_NAME[getLang()] || 'Deutsch';
  const tools = TOOLS.map((x) => JSON.stringify({ type: 'function', function: x })).join('\n');
  return [
    'Du bist der KI-Assistent in „SlimSort“, einer kostenlosen App, mit der man Fotos per Tastendruck in Ordner sortiert. Du läufst komplett offline auf dem Computer deines Gegenübers; keine Daten gehen ins Internet.',
    '',
    'Regeln:',
    `- Antworte kurz (1 bis 3 Sätze), freundlich auf ${lang} und sprich dein Gegenüber immer direkt mit „du“ an (nie „der Nutzer“). Schreibt es in einer anderen Sprache, antworte in dieser Sprache.`,
    '- Jede Nachricht beginnt mit <lage> (was gerade in der App los ist). Nutze das, aber schreib diese Markierung nie selbst.',
    '- Wenn dein Gegenüber etwas getan haben will (suchen, verschieben, merken, Personen benennen, Einstellungen …), rufe das passende Werkzeug auf. Behaupte nie, etwas getan, gefunden oder dir gemerkt zu haben, ohne dass ein Werkzeug es bestätigt hat.',
    '- Personen erkennst du NUR über die Gesichtserkennung (Werkzeug personen_auf_foto oder die Angaben in <lage>). Rate nie, wer auf einem Foto ist, und verlass dich nie auf die Position aus früheren Fotos – auf jedem Foto stehen die Leute anders.',
    '- Sagt dein Gegenüber, wer auf dem aktuellen Foto wo ist („ich bin links, mein Bruder daneben, Mama rechts“), benutze personen_benennen mit den Gesichtsnummern aus <lage> (1 = ganz links).',
    '- Nach einem Werkzeug bekommst du das Ergebnis in <tool_response>. Sag dann kurz und natürlich, was passiert ist. Erfinde keine Fotos, Namen oder Ergebnisse.',
    '- Wissensfragen (z. B. „Was ist ein Fallschirm?“, „Warum ist der Himmel blau?“) beantwortest du allgemein und richtig aus deinem Wissen, ohne Werkzeug – nicht mit dem Foto, außer es wird ausdrücklich nach dem Foto gefragt.',
    '- Du kennst das Gedächtnis (was du dir gemerkt hast) aus <lage>. Fragt dein Gegenüber danach, antworte daraus.',
    '',
    'Was SlimSort kann: Fotos per Tastendruck sortieren (Zahlentaste = Ordner, Leertaste = überspringen, Entf = löschen, Strg/⌘ + Z = rückgängig, Tab = Übersicht, Strg/⌘ + K = dieser Chat). Serien ähnlicher Fotos werden verglichen. Die KI lernt beim Sortieren mit und schlägt Ordner vor. Gesichter werden erkannt und mit Namen angezeigt (Klick auf ein Gesicht zum Benennen). Gemerkte Regeln wirken auf die Vorschläge.',
    '',
    '# Tools',
    '',
    'You may call one or more functions to assist with the user query.',
    '',
    'You are provided with function signatures within <tools></tools> XML tags:',
    '<tools>',
    tools,
    '</tools>',
    '',
    'For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:',
    '<tool_call>',
    '{"name": <function-name>, "arguments": <args-json-object>}',
    '</tool_call>',
  ].join('\n');
}

/** Aktuelle Lage in der App (kommt in die Nachricht, nicht in die Anleitung) */
export interface Extra {
  /** Gesichtserkennung auf dem aktuellen Foto (fertiger Satz) */
  faces?: string;
  /** Bekannte Personen */
  people?: string;
  /** Was sich die KI merken soll (aus dem Gedächtnis) */
  memory?: string;
}

export function situation(s: SessionState | null, currentTags: string[], extra: Extra = {}): string {
  const mem = [extra.people, extra.memory].filter(Boolean).map((x) => `\n${x}`).join('');
  if (!s) return 'Es ist gerade keine Sortierung geöffnet (Startseite).' + mem;
  const lines: string[] = [];
  const left = s.items.filter((x) => !s.done.has(x.id)).length;
  lines.push(`Sortierung mit ${s.items.length} Fotos/Videos: noch ${left} offen, ${s.sorted} einsortiert, ${s.deleted} gelöscht.`);
  const tg = activeProfile().targets;
  if (tg.length) lines.push(`Zielordner: ${tg.map((x) => `${x.name}${x.key ? ` (Taste ${x.key})` : ''}`).join(', ')}.`);
  const cur = s.currentId !== null ? s.byId.get(s.currentId) : undefined;
  if (cur) {
    lines.push(`Gerade angesehenes Foto: ${describeItem(cur, currentTags)}.`);
    if (extra.faces) lines.push(extra.faces);
  }
  const sel = [...s.selection].filter((id) => s.byId.has(id) && !s.done.has(id));
  if (sel.length > 1 || (sel.length === 1 && sel[0] !== s.currentId)) {
    const names = sel.slice(0, 8).map((id) => s.byId.get(id)!.name);
    lines.push(`Markiert: ${sel.length} Fotos (${names.join(', ')}${sel.length > 8 ? ', …' : ''}). „Diese“/„die markierten“ meint diese Fotos.`);
  }
  return lines.join('\n') + mem;
}

const IM = (role: string, text: string) => `<|im_start|>${role}\n${text}<|im_end|>\n`;

/** Nur die Anleitung (zum Vorladen beim Öffnen des Chats) */
export function warmPrompt(): string {
  return IM('system', systemPrompt());
}

/** Gesprächsverlauf im Format des Modells (ChatML). `think`: Denkmodus des Modells abschalten */
export function chatPrompt(history: Turn[], user: string, lage: string, think: boolean): string {
  let p = IM('system', systemPrompt());
  for (const h of history) p += IM('user', h.user) + IM('assistant', h.assistant);
  p += IM('user', `<lage>\n${lage}\n</lage>\n${user}`) + '<|im_start|>assistant\n';
  if (think) p += '<think>\n\n</think>\n\n';
  return p;
}

/** Nach einem Werkzeug: Aufruf + Ergebnis anhängen, dann antwortet das Modell weiter */
export function toolContinue(prompt: string, call: string, result: string, think: boolean): string {
  let p = prompt + call.trim() + '\n</tool_call><|im_end|>\n' + IM('user', `<tool_response>\n${result}\n</tool_response>`) + '<|im_start|>assistant\n';
  if (think) p += '<think>\n\n</think>\n\n';
  return p;
}

/** Will der Nutzer Fotos sehen? (sonst ist es eine Frage oder Unterhaltung) */
export function wantsPhotos(text: string): boolean {
  const s = text.toLowerCase();
  if (/\b(zeig|such|find|gib|hol|show|search|look for|montre|cherche|muestra|busca|mostra|cerca)\w*/.test(s)) return true;
  if (/\b(fotos?|bilder?|photos?|pictures?|images?|aufnahmen?|pics?)\b/.test(s) && !/^(was|wie|warum|wieso|weshalb|wer|wann|what|how|why|who|when)\b/.test(s)) return true;
  // Kurze Beschreibung ohne Frage ("Hund am Strand") = Suche
  return !/[?]/.test(s) && s.split(/\s+/).length <= 6 && !/^(hallo|hi|hey|danke|ok|okay|ja|nein|gut|super|cool)\b/.test(s);
}

export { parseToolCall, cleanAnswer } from './llmtext';
