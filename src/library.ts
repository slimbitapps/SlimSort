/**
 * Freigegebene Ordner: große Ordner mit vielen Unterordnern, die du der KI zeigst.
 * Die KI schaut sich jedes Foto darin an und lernt, welche Fotos in welchen Unterordner gehören –
 * danach schlägt sie diese Unterordner auch vor (und sortiert auf Wunsch hinein), ohne dass sie
 * unten als Zielordner stehen.
 */
import { create } from 'zustand';
import { useStore, prefs, updatePrefs, activeProfile } from './store';
import { t } from './i18n';

const api = () => window.api;

/** Kennung für Vorschläge in Unterordner freigegebener Ordner (statt einer Zielordner-ID) */
export const LIB = 'lib:';

export interface LibFolder {
  path: string;
  /** "Fotos/Urlaub/2023" */
  rel: string;
  count: number;
}

export const useLibrary = create<{ folders: LibFolder[]; scanning: boolean; roots: string }>(() => ({ folders: [], scanning: false, roots: '' }));

export function libFolders(): LibFolder[] {
  return useLibrary.getState().folders;
}

export function libRoots(): string[] {
  return useStore.getState().settings.prefs.aiLibrary || [];
}

/** Unterordner neu einlesen (beim Start, nach Änderungen) */
export async function scanLibrary(): Promise<LibFolder[]> {
  const roots = libRoots();
  const key = roots.join('|');
  if (!roots.length) {
    useLibrary.setState({ folders: [], roots: '' });
    return [];
  }
  useLibrary.setState({ scanning: true });
  try {
    const folders = await api().scanFolders(roots);
    useLibrary.setState({ folders, roots: key });
    return folders;
  } finally {
    useLibrary.setState({ scanning: false });
  }
}

/** Alle Fotos der freigegebenen Ordner lernen (`again`: auch schon gelernte Ordner neu ansehen) */
export async function learnLibrary(again = false) {
  if (!prefs().aiEnabled) return;
  const folders = libFolders().length ? libFolders() : await scanLibrary();
  const list = folders.filter((f) => f.count > 0).map((f) => ({ target: f.path, dir: f.path, all: true, again }));
  if (list.length) await api().ai.learnFolders(list);
}

export async function addLibraryRoot(): Promise<string | null> {
  const dir = await api().pickFolder({ title: t('lib.pick') });
  if (!dir || libRoots().includes(dir)) return dir;
  updatePrefs({ aiLibrary: [...libRoots(), dir] });
  await scanLibrary();
  await learnLibrary();
  return dir;
}

export async function removeLibraryRoot(root: string) {
  const gone = libFolders().filter((f) => f.path === root || f.path.startsWith(root.replace(/[\\/]+$/, '') + (root.includes('\\') ? '\\' : '/')));
  updatePrefs({ aiLibrary: libRoots().filter((x) => x !== root) });
  // Gelerntes aus diesen Ordnern vergessen (Zielordner bleiben unberührt)
  const targets = new Set(activeProfile().targets.map((x) => x.path));
  for (const f of gone) if (!targets.has(f.path)) await api().ai.renameTarget(f.path, null);
  await scanLibrary();
}

/** Anzeigename eines Ordners: "Urlaub › 2023" (relativ zum freigegebenen Ordner) */
export function libName(path: string): string {
  const f = libFolders().find((x) => x.path === path);
  const rel = f ? f.rel : path.split(/[\\/]/).filter(Boolean).slice(-2).join('/');
  return rel.split('/').join(' › ');
}

export function isLibFolder(path: string): boolean {
  return libFolders().some((x) => x.path === path);
}

const norm = (s: string) => s.toLowerCase().replace(/[›>\\]/g, '/').replace(/\s*\/\s*/g, '/').replace(/[^a-z0-9äöüß/ ]/g, '').trim();

/**
 * Ordner zu einem Namen: "Urlaub/2023/Italien", "Italien", "2023 Italien".
 * Eindeutig → Treffer; mehrere passen → die mit dem kürzesten Pfad zuerst (Liste).
 */
export function findLibFolders(name: string): LibFolder[] {
  const n = norm(name);
  if (!n) return [];
  const all = libFolders();
  const exact = all.filter((f) => norm(f.rel) === n || norm(f.rel).endsWith('/' + n));
  if (exact.length) return exact.sort((a, b) => a.rel.length - b.rel.length);
  const words = n.split(/[ /]+/).filter(Boolean);
  return all
    .filter((f) => words.every((w) => norm(f.rel).includes(w)))
    .sort((a, b) => a.rel.length - b.rel.length)
    .slice(0, 8);
}
