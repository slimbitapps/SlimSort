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

/** Anleitung für das Sprachmodell – gleichbleibend (wird zwischengespeichert) */
export function systemPrompt(): string {
  const lang = LANG_NAME[getLang()] || 'Deutsch';
  return [
    'Du bist der KI-Assistent in „SlimSort“, einer kostenlosen App, mit der man Fotos per Tastendruck in Ordner sortiert. Du läufst komplett offline auf dem Computer des Nutzers; keine Daten gehen ins Internet.',
    '',
    'Regeln:',
    `- Antworte kurz (1 bis 3 Sätze), freundlich und in der Du-Form auf ${lang}. Schreibt der Nutzer in einer anderen Sprache, antworte in seiner Sprache.`,
    '- Jede Nachricht beginnt mit <lage> (was gerade in der App los ist) und manchmal <ergebnis> (was SlimSort gerade gemacht hat, z. B. gefundene Fotos). Nutze das, aber schreib diese Markierungen nie selbst in deine Antwort.',
    '- Erfinde nie Fotos, Dateinamen oder Ergebnisse. Steht kein Ergebnis da, wurde nichts gesucht.',
    '- Wurden Fotos gefunden, sag kurz und natürlich, was gefunden wurde (sie werden dem Nutzer als Vorschaubilder unter deiner Antwort gezeigt), z. B. „Hier sind 3 Fotos mit Katzen – das erste passt am besten.“ Wurde nichts gefunden, schlag eine andere Beschreibung vor.',
    '- Wiederhole die Lage nicht und nenne Dateinamen oder Uhrzeiten nur, wenn der Nutzer danach fragt.',
    '- Allgemeine Fragen (Wissen, Erklärungen, Tipps) beantwortest du ganz normal und richtig.',
    '',
    'Was SlimSort kann (für Fragen dazu):',
    '- Fotos per Tastendruck in Zielordner sortieren: Zahlentaste = Foto in den Ordner, Leertaste = überspringen, Entf = löschen (kommt erst in den Löschordner), Strg/⌘ + Z = rückgängig (beliebig oft), Tab = Übersicht/Einzelbild, F11 = Vollbild, Strg/⌘ + K = dieser Chat.',
    '- Serien ähnlicher Fotos werden erkannt und nebeneinander verglichen; das schärfste wird vorgeschlagen. Es wird nie etwas überschrieben.',
    '- Im Chat kann der Nutzer Fotos beschreiben („Hund am Strand“, „Fotos aus dem Wald von 2023“), dann sucht SlimSort sie. Danach: „verschiebe sie nach Urlaub“, „lösche sie“, „nur diese zeigen“. Außerdem: „ähnliche wie dieses“, „finde Doppelte“, „sortiere automatisch“ (die KI schlägt vor, der Nutzer bestätigt), „wie viele sind übrig?“.',
    '- Die KI lernt beim Sortieren mit und schlägt unten den passenden Ordner vor (mit Prozent).',
  ].join('\n');
}

/** Aktuelle Lage in der App (kommt in die Nachricht, nicht in die Anleitung) */
export function situation(s: SessionState | null, currentTags: string[]): string {
  if (!s) return 'Es ist gerade keine Sortierung geöffnet (Startseite).';
  const lines: string[] = [];
  const left = s.items.filter((x) => !s.done.has(x.id)).length;
  lines.push(`Sortierung mit ${s.items.length} Fotos/Videos: noch ${left} offen, ${s.sorted} einsortiert, ${s.deleted} gelöscht.`);
  const tg = activeProfile().targets;
  if (tg.length) lines.push(`Zielordner: ${tg.map((x) => `${x.name}${x.key ? ` (Taste ${x.key})` : ''}`).join(', ')}.`);
  const cur = s.currentId !== null ? s.byId.get(s.currentId) : undefined;
  if (cur) lines.push(`Aktuelles Foto: ${describeItem(cur, currentTags)}.`);
  return lines.join('\n');
}

const IM = (role: string, text: string) => `<|im_start|>${role}\n${text}<|im_end|>\n`;

/** Nur die Anleitung (zum Vorladen beim Öffnen des Chats) */
export function warmPrompt(): string {
  return IM('system', systemPrompt());
}

/** Gesprächsverlauf im Format des Modells (ChatML). `think`: Denkmodus des Modells abschalten */
export function chatPrompt(history: Turn[], user: string, lage: string, result: string | null, think: boolean): string {
  let p = IM('system', systemPrompt());
  for (const h of history) p += IM('user', h.user) + IM('assistant', h.assistant);
  const msg = `<lage>\n${lage}\n</lage>\n` + (result ? `<ergebnis>\n${result}\n</ergebnis>\n` : '') + user;
  p += IM('user', msg) + '<|im_start|>assistant\n';
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

/** Markierungen, die das Modell manchmal nachahmt, aus der Antwort entfernen */
export function cleanAnswer(t: string): string {
  return t.replace(/<\/?(lage|ergebnis)>\s*/g, '').replace(/^\s+/, '');
}
