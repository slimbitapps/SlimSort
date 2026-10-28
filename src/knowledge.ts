/**
 * KI-Wissen sichern und auf einen anderen Computer mitnehmen: Gedächtnis (Regeln, Notizen),
 * Personen (Gesichter), gespeicherte Chats und gelernte Beispiele (Ordner-Vorschläge).
 * Eine Datei ".slimsort-ki" – nur Zahlen und Texte, keine Fotos.
 */
import { useStore, updateSettings, activeProfile, toast } from './store';
import { t } from './i18n';
import { allChats, importChats } from './chats';
import type { AiMemory, Person } from './types';

const api = () => window.api;

export async function exportKnowledge(): Promise<void> {
  const st = useStore.getState().settings;
  const data = {
    slimsortKi: 1,
    exported: new Date().toISOString(),
    memories: st.aiMemory || [],
    people: st.people || [],
    things: st.things || [],
    chats: allChats(),
    // Zielordner (Name + Pfad), damit Regeln auf dem neuen Computer dem richtigen Ordner zugeordnet werden
    targets: activeProfile().targets.map((x) => ({ name: x.name, path: x.path })),
  };
  const day = new Date().toISOString().slice(0, 10);
  try {
    const path = await api().ai.exportFile(data, `SlimSort-KI-Wissen-${day}.slimsort-ki`);
    if (path) toast('success', t('know.exported', { path }), { timeout: 8000 });
  } catch (e: any) {
    toast('error', t('know.failed', { error: String(e?.message || e) }));
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p;

export async function importKnowledge(): Promise<void> {
  let data: any;
  try {
    data = await api().ai.importFile();
  } catch (e: any) {
    toast('error', t('know.failed', { error: String(e?.message || e) }));
    return;
  }
  if (!data) return;
  const people: Person[] = Array.isArray(data.people) ? data.people : [];
  const mems: AiMemory[] = Array.isArray(data.memories) ? data.memories : [];
  const chats = Array.isArray(data.chats) ? data.chats : [];
  const learned = data.learned?.examples?.length || 0;
  const r = await api().confirm({
    message: t('know.importAsk'),
    detail: t('know.importDetail', { people: people.length, rules: mems.length, chats: chats.length, learned }),
    buttons: [t('know.importYes'), t('common.cancel')],
  });
  if (r !== 0) return;

  // Ordner auf dem neuen Computer: gleicher Pfad, sonst gleicher Ordnername
  const targets = activeProfile().targets;
  const remap: Record<string, string> = {};
  const oldTargets: { name: string; path: string }[] = Array.isArray(data.targets) ? data.targets : [];
  const paths = new Set<string>([...oldTargets.map((x) => x.path), ...mems.map((m) => m.targetPath).filter((p): p is string => !!p)]);
  for (const p of paths) {
    if (targets.some((x) => x.path === p)) continue;
    const name = oldTargets.find((x) => x.path === p)?.name || base(p);
    const hit = targets.find((x) => norm(x.name) === norm(name) || norm(base(x.path)) === norm(base(p)));
    if (hit) remap[p] = hit.path;
  }

  // Personen: gleicher Name → Beispiele zusammenlegen
  const cur = useStore.getState().settings;
  const list = (cur.people || []).map((x) => ({ ...x }));
  let addedPeople = 0;
  for (const p of people) {
    if (!p?.name || !Array.isArray(p.embs)) continue;
    const same = list.find((x) => (p.me && x.me) || norm(x.name) === norm(p.name));
    if (same) {
      same.embs = [...same.embs, ...p.embs].slice(-24);
      same.groups = [...new Set([...(same.groups || []), ...(p.groups || [])])];
      same.crop = same.crop || p.crop;
    } else {
      list.push({ ...p, id: list.some((x) => x.id === p.id) ? Math.random().toString(36).slice(2, 10) : p.id });
      addedPeople++;
    }
  }
  // Gedächtnis: doppelte (gleicher Text + Art) überspringen
  const memList = [...(cur.aiMemory || [])];
  let addedRules = 0;
  for (const m of mems) {
    if (!m?.kind || memList.some((x) => x.kind === m.kind && x.text === m.text)) continue;
    memList.push({ ...m, targetPath: m.targetPath ? remap[m.targetPath] || m.targetPath : undefined });
    addedRules++;
  }
  // Dinge: gleicher Name → Beispiele zusammenlegen
  const thingList = (cur.things || []).map((x) => ({ ...x }));
  for (const th of Array.isArray(data.things) ? data.things : []) {
    if (!th?.name || !Array.isArray(th.examples)) continue;
    const same = thingList.find((x) => norm(x.name) === norm(th.name));
    if (same) {
      same.examples = [...same.examples, ...th.examples].slice(-30);
      for (const [k, v] of Object.entries(th.embs || {})) same.embs = { ...same.embs, [k]: [...(same.embs[k] || []), ...(v as number[][])].slice(-30) };
    } else thingList.push(th);
  }
  updateSettings((s) => ({ ...s, people: list, aiMemory: memList, things: thingList }));
  const addedChats = importChats(chats);
  let addedLearned = 0;
  if (data.learned) addedLearned = await api().ai.importLearned(data.learned, remap).catch(() => 0);
  toast('success', t('know.imported', { people: addedPeople, rules: addedRules, chats: addedChats, learned: addedLearned }), { timeout: 9000 });
}
