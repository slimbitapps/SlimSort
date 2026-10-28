/**
 * Gedächtnis und Rechte der KI.
 *
 * Gedächtnis: Was der Nutzer der KI im Chat sagt ("Merke dir: Fotos mit Autos kommen in den Ordner
 * Autos", "Die Personen auf diesem Foto sind meine Familie", "Mein Hund heißt Bello"). Regeln mit
 * Ordner wirken auf Vorschläge, "KI sortieren" und den Autopiloten. Alles lässt sich wieder vergessen.
 *
 * Rechte: Was die KI ohne den Nutzer tun darf (Fotos verschieben/löschen, Einstellungen ändern,
 * Ordner anlegen, ohne Nachfrage). Wird in den Einstellungen erteilt – mit Hinweis auf die Risiken.
 */
import { useStore, activeProfile, updatePrefs, updateSettings, prefs } from './store';
import { t, type TKey } from './i18n';
import type { AiMemory, Prefs } from './types';
import { people, facesOn, displayName, groupMembers } from './people';

const api = () => window.api;

// ---------------------------------------------------------------- Gedächtnis

export function memories(): AiMemory[] {
  return useStore.getState().settings.aiMemory || [];
}

function saveMemories(list: AiMemory[]) {
  updateSettings((s) => ({ ...s, aiMemory: list }));
}

export function addMemory(m: Omit<AiMemory, 'id' | 'created'>): AiMemory {
  const mem: AiMemory = { ...m, id: Math.random().toString(36).slice(2, 10), created: Date.now() };
  saveMemories([...memories(), mem]);
  return mem;
}

export function removeMemory(id: string) {
  saveMemories(memories().filter((m) => m.id !== id));
}

export function clearMemories() {
  saveMemories([]);
}

/** Gemerktes, das am besten zu einem Text passt ("vergiss das mit den Autos") */
export function findMemory(text: string): AiMemory | undefined {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-zäöüß0-9 ]/g, ' ');
  const words = norm(text).split(/\s+/).filter((w) => w.length > 2);
  let best: { m: AiMemory; n: number } | undefined;
  for (const m of memories()) {
    const hay = norm(`${m.text} ${m.concept || ''} ${m.label || ''} ${targetName(m) || ''}`);
    const n = words.filter((w) => hay.includes(w) || hay.includes(w.replace(/(en|e|n|s)$/, ''))).length;
    if (n > 0 && (!best || n > best.n)) best = { m, n };
  }
  return best?.m;
}

export function targetName(m: AiMemory): string | undefined {
  if (!m.targetPath) return undefined;
  return activeProfile().targets.find((x) => x.path === m.targetPath)?.name ?? m.targetPath.split(/[\\/]/).pop();
}

/** Kurze Beschreibung für Liste/Chat */
export function describeMemory(m: AiMemory): string {
  const folder = targetName(m);
  if (m.kind === 'concept') return t('mem.concept', { what: m.concept || m.text, folder: folder || '?' });
  if (m.kind === 'people') {
    const who = m.group || (m.personIds || []).map((id) => people().find((p) => p.id === id)).filter(Boolean).map((p) => displayName(p!)).join(', ');
    return t('mem.people', { who: who || '?', folder: folder || '?' });
  }
  if (m.kind === 'faces')
    return folder ? t('mem.facesFolder', { label: m.label || '?', n: m.faces?.length || 0, folder }) : t('mem.faces', { label: m.label || '?', n: m.faces?.length || 0 });
  return m.text;
}

/** Für das Sprachmodell: was es sich merken soll */
export function memoryForPrompt(): string {
  const list = memories();
  if (!list.length) return '';
  return 'Das hat der Nutzer dir zum Merken gesagt:\n' + list.map((m) => `- ${describeMemory(m)}`).join('\n');
}

/**
 * Gemerkte Regeln auf Fotos anwenden → je Foto Zielordner (Pfad) mit Sicherheit.
 * Begriffe ("Autos") prüft das Bildmodell, Gesichter die Gesichtserkennung.
 */
export async function ruleTargets(ids: number[]): Promise<Map<number, { path: string; conf: number; memory: AiMemory }>> {
  const out = new Map<number, { path: string; conf: number; memory: AiMemory }>();
  if (!ids.length) return out;
  const targets = new Set(activeProfile().targets.map((x) => x.path));
  const concepts = memories().filter((m) => m.kind === 'concept' && m.targetPath && targets.has(m.targetPath));
  const groups = memories().filter((m) => m.kind === 'faces' && m.targetPath && targets.has(m.targetPath) && m.faces?.length);
  if (concepts.length) {
    const hits = await api().ai.rules(concepts.map((m) => m.query || m.concept || m.text), ids, 0.5).catch(() => []);
    for (const h of hits) out.set(h.id, { path: concepts[h.rule].targetPath!, conf: Math.min(0.99, 0.85 + h.p * 0.14), memory: concepts[h.rule] });
  }
  const personRules = memories().filter((m) => m.kind === 'people' && m.targetPath && targets.has(m.targetPath));
  if (personRules.length && prefs().aiFaces) {
    const faces = await facesOn(ids).catch(() => new Map());
    for (const [id, f] of faces) {
      const on = new Set(f.map((x: { person?: { id: string } }) => x.person?.id).filter(Boolean));
      for (const m of personRules) {
        const want = m.group ? groupMembers(m.group).map((p) => p.id) : m.personIds || [];
        if (want.some((p) => on.has(p))) {
          out.set(id, { path: m.targetPath!, conf: 0.97, memory: m });
          break;
        }
      }
    }
  }
  if (groups.length && prefs().aiFaces) {
    const hits = await api().ai.faceMatches(groups.map((m) => m.faces!), ids, 0.42).catch(() => []);
    // Gesichter sind eindeutiger als Begriffe → haben Vorrang
    for (const h of hits) out.set(h.id, { path: groups[h.rule].targetPath!, conf: Math.min(0.99, 0.9 + h.p * 0.1), memory: groups[h.rule] });
  }
  return out;
}

// ---------------------------------------------------------------- Rechte

export type Permission = 'aiAllowMove' | 'aiAllowDelete' | 'aiAllowSettings' | 'aiAllowFolders';

export function allowed(p: Permission): boolean {
  return !!prefs()[p];
}

/** Ohne Nachfrage ausführen? */
export function noConfirm(): boolean {
  return !!prefs().aiNoConfirm;
}

export const PERMISSION_TEXT: Record<Permission, TKey> = {
  aiAllowMove: 'perm.move',
  aiAllowDelete: 'perm.delete',
  aiAllowSettings: 'perm.settings',
  aiAllowFolders: 'perm.folders',
};

/** Recht erteilen – riskante Rechte nur nach Bestätigung des Hinweises */
export async function grant(p: Permission | 'aiNoConfirm' | 'all', on: boolean): Promise<boolean> {
  if (!on) {
    if (p === 'all') updatePrefs({ aiAllowMove: false, aiAllowDelete: false, aiAllowSettings: false, aiAllowFolders: false, aiNoConfirm: false });
    else updatePrefs({ [p]: false } as Partial<Prefs>);
    return true;
  }
  const risky = p === 'all' || p === 'aiAllowSettings' || p === 'aiAllowFolders' || p === 'aiNoConfirm' || p === 'aiAllowDelete';
  if (risky) {
    const r = await api().confirm({
      message: t(p === 'all' ? 'perm.allAsk' : 'perm.ask'),
      detail: t('perm.risks'),
      buttons: [t('perm.understood'), t('common.cancel')],
      type: 'warning',
    });
    if (r !== 0) return false;
  }
  if (p === 'all') updatePrefs({ aiAllowMove: true, aiAllowDelete: true, aiAllowSettings: true, aiAllowFolders: true, aiNoConfirm: true });
  else updatePrefs({ [p]: true } as Partial<Prefs>);
  return true;
}

// ---------------------------------------------------------------- Einstellungen per Chat

type SettingDef =
  | { key: keyof Prefs; label: TKey; kind: 'bool'; words: RegExp }
  | { key: keyof Prefs; label: TKey; kind: 'enum'; values: { v: string; words: RegExp }[]; words: RegExp }
  | { key: keyof Prefs; label: TKey; kind: 'number'; min: number; max: number; words: RegExp };

/** Was die KI einstellen darf (ihre eigenen Rechte und das Ein/Aus der KI gehören nicht dazu) */
export const SETTINGS: SettingDef[] = [
  { key: 'theme', label: 'set.theme', kind: 'enum', words: /\b(design|thema|theme|modus|dunkel|hell|dark|light)\b/, values: [{ v: 'dark', words: /dunkel|dark|nacht/ }, { v: 'light', words: /hell|light/ }, { v: 'system', words: /system|automatisch|auto/ }] },
  { key: 'lang', label: 'set.lang', kind: 'enum', words: /\b(sprache|language|deutsch|englisch|französisch|spanisch|italienisch|english|german)\b/, values: [{ v: 'de', words: /deutsch|german/ }, { v: 'en', words: /englisch|english/ }, { v: 'fr', words: /franz|french/ }, { v: 'es', words: /spanisch|spanish/ }, { v: 'it', words: /italien|italian/ }] },
  { key: 'mode', label: 'set.mode', kind: 'enum', words: /\b(profi|experte|einfach|modus|expert|simple)\w*/, values: [{ v: 'expert', words: /profi|expert/ }, { v: 'simple', words: /einfach|simple/ }] },
  { key: 'transferMode', label: 'set.transfer', kind: 'enum', words: /\b(kopier|verschieb)\w*\b.*\b(statt|anstatt|stattdessen|modus)|\b(kopieren|verschieben) (statt|anstatt)/, values: [{ v: 'copy', words: /kopier/ }, { v: 'move', words: /verschieb/ }] },
  { key: 'accent', label: 'set.accent', kind: 'enum', words: /\b(akzent|farbe|color|colour)\w*/, values: [{ v: 'blue', words: /blau|blue/ }, { v: 'violet', words: /lila|violett|violet|purple/ }, { v: 'pink', words: /pink|rosa/ }, { v: 'orange', words: /orange/ }, { v: 'green', words: /grün|green/ }, { v: 'teal', words: /türkis|teal|petrol/ }] },
  { key: 'seriesEnabled', label: 'set.series', kind: 'bool', words: /\bserie\w*/ },
  { key: 'suggest', label: 'set.suggest', kind: 'bool', words: /\b(zielvorschl|vorschl)\w*/ },
  { key: 'aiSuggest', label: 'ai.suggest', kind: 'bool', words: /\bki[- ]?vorschl\w*/ },
  { key: 'aiAutopilot', label: 'ai.autopilot', kind: 'bool', words: /\bautopilot\w*/ },
  { key: 'aiLearnFolders', label: 'ai.learnFolders', kind: 'bool', words: /\b(aus (den |vorhandenen )?ordnern lernen|ordner lernen)/ },
  { key: 'showFilmstrip', label: 'set.filmstrip', kind: 'bool', words: /\b(bildleiste|filmstreifen|filmstrip)\w*/ },
  { key: 'showInfo', label: 'set.info', kind: 'bool', words: /\b(info|infos|fotoinfo|exif)\b/ },
  { key: 'showEta', label: 'set.eta', kind: 'bool', words: /\b(restzeit|eta)\b/ },
  { key: 'resume', label: 'set.resume', kind: 'bool', words: /\b(weitermachen|fortsetzen|resume)\w*/ },
  { key: 'updateCheck', label: 'set.update', kind: 'bool', words: /\b(update|aktualisierung)\w*/ },
  { key: 'emptyToSystemTrash', label: 'set.systemTrash', kind: 'bool', words: /\b(system[- ]?papierkorb|papierkorb des systems)\b/ },
  { key: 'autoCompare', label: 'set.autoCompare', kind: 'bool', words: /\b(automatisch vergleich|auto[- ]?vergleich)\w*/ },
  { key: 'zenFlash', label: 'set.zenFlash', kind: 'bool', words: /\b(einblendung|flash)\w*/ },
  { key: 'uiScale', label: 'set.uiScale', kind: 'number', min: 0.8, max: 1.4, words: /\b(größe der oberfläche|oberfläche|schrift|zoom)\w*/ },
  { key: 'aiPerf', label: 'ai.perf', kind: 'enum', words: /\b(rechenleistung|leistung)\b/, values: [{ v: 'low', words: /schonend|niedrig|wenig|low/ }, { v: 'normal', words: /normal|mittel/ }, { v: 'high', words: /schnell|hoch|viel|high|max/ }] },
];

const ON = /\b(an|ein|aktivier\w*|einschalt\w*|anschalt\w*|zeig\w*|on|enable\w*|turn on)\b/;
const OFF = /\b(aus|deaktivier\w*|ausschalt\w*|abschalt\w*|versteck\w*|nicht mehr|off|disable\w*|turn off)\b/;

/** Einstellung aus einem Satz erkennen (ohne Sprachmodell) */
export function parseSetting(text: string): { def: SettingDef; value: string | number | boolean } | null {
  const s = text.toLowerCase();
  for (const def of SETTINGS) {
    if (!def.words.test(s)) continue;
    if (def.kind === 'bool') {
      if (OFF.test(s)) return { def, value: false };
      if (ON.test(s)) return { def, value: true };
    } else if (def.kind === 'enum') {
      const hit = def.values.find((x) => x.words.test(s));
      if (hit) return { def, value: hit.v };
    } else {
      const n = /(\d+(?:[.,]\d+)?)\s*%?/.exec(s);
      if (n) {
        let v = Number(n[1].replace(',', '.'));
        if (v > 3) v = v / 100;
        return { def, value: Math.max(def.min, Math.min(def.max, v)) };
      }
      if (/größer|bigger|larger/.test(s)) return { def, value: Math.min(def.max, (prefs().uiScale || 1) + 0.1) };
      if (/kleiner|smaller/.test(s)) return { def, value: Math.max(def.min, (prefs().uiScale || 1) - 0.1) };
    }
  }
  return null;
}

/** Wert prüfen und setzen; liefert die Beschreibung für die Antwort */
export function applySetting(key: string, value: unknown): string | null {
  const def = SETTINGS.find((d) => d.key === key);
  if (!def) return null;
  let v: unknown = value;
  if (def.kind === 'bool') v = value === true || value === 'true' || value === 'an' || value === 'on';
  else if (def.kind === 'enum') {
    if (!def.values.some((x) => x.v === value)) return null;
  } else {
    const n = Number(value);
    if (!isFinite(n)) return null;
    v = Math.max(def.min, Math.min(def.max, n));
  }
  updatePrefs({ [def.key]: v } as Partial<Prefs>);
  const shown = def.kind === 'bool' ? t(v ? 'set.on' : 'set.off') : def.kind === 'number' ? `${Math.round((v as number) * 100)} %` : String(v);
  return `${t(def.label)}: ${shown}`;
}

/** Liste der Einstellungen für das Sprachmodell (Schlüssel, Bedeutung, erlaubte Werte) */
export function settingsCatalog(): string {
  return SETTINGS.map((d) => {
    const vals = d.kind === 'bool' ? 'true|false' : d.kind === 'enum' ? d.values.map((x) => x.v).join('|') : `${d.min}–${d.max}`;
    return `${String(d.key)} (${t(d.label)}): ${vals}`;
  }).join('\n');
}

/** Grammatik: {"key": "<einer der Schlüssel>", "value": "..."} */
export function settingGrammar(): string {
  const keys = SETTINGS.map((d) => `"\\"${String(d.key)}\\""`).join(' | ');
  return String.raw`root ::= "{\"key\": " key ", \"value\": \"" val "\"}"
key ::= ` + keys + String.raw`
val ::= [a-zA-Z0-9.]{1,12}`;
}
