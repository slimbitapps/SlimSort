/** Antworten des Sprachmodells auswerten (ohne Abhängigkeiten, damit es sich leicht testen lässt) */

/** Werkzeug-Aufruf aus der Antwort lesen (verzeiht kleine Formfehler) */
export function parseToolCall(text: string): { name: string; args: Record<string, any>; raw: string } | null {
  // kleine Modelle schreiben manchmal <tool> statt <tool_call> – oder nur das JSON
  const m = /<tool(?:_call)?>/.exec(text) || (/^\s*\{\s*"name"\s*:/.test(text) ? { index: text.indexOf('{'), 0: '' } : null);
  if (!m) return null;
  const i = m.index;
const raw = text.slice(i).replace(/<\/tool_call>[\s\S]*$/, '');
  const body = raw.replace('<tool_call>', '').trim();
  const start = body.indexOf('{');
  if (start < 0) return null;
  // bis zur passenden schließenden Klammer
  let depth = 0;
  let end = -1;
  let inStr = false;
  for (let k = start; k < body.length; k++) {
    const c = body[k];
    if (inStr) {
      if (c === '\\') k++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      end = k;
      break;
    }
  }
  try {
    const j = JSON.parse(end > 0 ? body.slice(start, end + 1) : body.slice(start) + '}'.repeat(Math.max(1, depth)));
    if (!j || typeof j.name !== 'string') return null;
    let args = j.arguments ?? j.parameters ?? {};
    if (typeof args === 'string') args = JSON.parse(args);
    return { name: j.name, args, raw: text.slice(0, i) + raw };
  } catch {
    return null;
  }
}

/** Markierungen, die das Modell manchmal nachahmt, aus der Antwort entfernen */
export function cleanAnswer(t: string): string {
  return t
    .replace(/<tool(?:_call)?>[\s\S]*?(<\/tool(?:_call)?>|$)/g, '')
    .replace(/^\s*\{\s*"name"\s*:[\s\S]*$/, '')
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
    .replace(/<\/?(lage|ergebnis|tool_response)>\s*/g, '')
    .replace(/<(t(o(o(l(_(c(a(l(l)?)?)?)?)?)?)?)?)?$/, '')
    .replace(/^\s+/, '');
}
