export type Kind = 'image' | 'video';

export interface Item {
  id: number;
  path: string;
  dir: string;
  name: string;
  ext: string;
  kind: Kind;
  size: number;
  mtime: number;
  sidecars: string[];
  live: string | null;
  liveSize: number;
  /** Aufnahmezeit aus EXIF (ms), falls vorhanden */
  t?: number;
}

export interface Target {
  id: string;
  name: string;
  path: string;
  key: string; // z. B. "1", "A", "F5" – leer = keine Taste
  color: string;
  groupId?: string | null;
}

export interface Group {
  id: string;
  name: string;
  collapsed: boolean;
}

export interface Profile {
  id: string;
  name: string;
  targets: Target[];
  groups: Group[];
}

export interface QuickStart {
  id: string;
  name: string;
  source: string;
  profileId: string;
  trashDir: string | null; // null = Standard "_Gelöscht" im Quellordner
  startView: 'grid' | 'single';
  recursive: boolean;
  fullscreen: boolean;
  lastUsed?: number;
  pinned?: boolean;
}

export type Lang = 'de' | 'en' | 'fr' | 'es' | 'it';
export type Theme = 'dark' | 'light' | 'system';
export type SortBy = 'name' | 'date' | 'size' | 'type';
export type Filter = 'all' | 'images' | 'videos' | 'skipped';

export interface Prefs {
  lang: Lang;
  theme: Theme;
  mode: 'simple' | 'expert';
  transferMode: 'move' | 'copy';
  liveVideo: 'move' | 'trash' | 'keep';
  liveAutoplay: boolean;
  recursive: boolean;
  showEta: boolean;
  suggest: boolean;
  suggestWindowSec: number;
  trashMode: 'source' | 'custom';
  customTrash: string;
  thumbSize: number;
  sortBy: SortBy;
  sortDir: 'asc' | 'desc';
  filter: Filter;
  activeProfileId: string;
  zenFlash: boolean;
  showFilmstrip: boolean;
}

export interface SettingsData {
  version: 1;
  prefs: Prefs;
  profiles: Profile[];
  quickStarts: QuickStart[];
  recentSources: string[];
  onboarded?: boolean;
  tutorialDone?: boolean;
}

export interface OpResult {
  id: number;
  ok: boolean;
  error?: string;
  detail?: string;
  to?: string;
  path?: string;
  live?: string | null;
}

export interface OpDoneEvent {
  opId: number;
  kind: 'transfer' | 'undo';
  results: OpResult[];
  destDir?: string;
  missing?: boolean;
}

export interface ProgressEvent {
  opId: number;
  name: string;
  fileDone: number;
  fileTotal: number;
  bytesDone: number;
  pending: number;
  pendingBytes: number;
}

export interface AppInfo {
  version: string;
  platform: string;
  electron: string;
  chrome: string;
  userData: string;
  journal: string;
}

export interface Api {
  getSettings(): Promise<Partial<SettingsData>>;
  setSettings(d: SettingsData): Promise<boolean>;
  appInfo(): Promise<AppInfo>;
  pickFolder(o?: { title?: string; defaultPath?: string }): Promise<string | null>;
  confirm(o: { message: string; detail?: string; buttons: string[]; type?: string }): Promise<number>;
  checkDir(dir: string): Promise<{ ok: boolean; code?: string }>;
  countMedia(o: { dir: string; recursive: boolean }): Promise<{ images: number; videos: number; total: number; sample: string[] }>;
  createFolder(o: { parent: string; name: string }): Promise<string>;
  parentDir(p: string): Promise<string>;
  setTheme(theme: Theme): Promise<boolean>;
  log(msg: string): Promise<void>;
  mkdir(dir: string): Promise<boolean>;
  openSession(o: { sourceDir: string; recursive: boolean; trashDir?: string | null }): Promise<{ items: Item[]; trashDir: string }>;
  transfer(o: {
    opId: number;
    itemIds: number[];
    destDir?: string;
    action: 'move' | 'copy' | 'trash';
    liveVideo: Prefs['liveVideo'];
  }): Promise<boolean>;
  undo(opId: number): Promise<boolean>;
  pending(): Promise<number>;
  trashInfo(dir?: string): Promise<{ dir: string; count: number; bytes: number }>;
  emptyTrash(): Promise<{ removed: number; pruned: number[] }>;
  setWatchedDirs(dirs: string[]): Promise<Record<string, boolean>>;
  checkReach(): Promise<Record<string, boolean>>;
  findLost(o: { missing: string[]; hints: string[] }): Promise<Record<string, string[]>>;
  setFullscreen(on: boolean): Promise<boolean>;
  isFullscreen(): Promise<boolean>;
  showItem(p: string): Promise<void>;
  openPath(p: string): Promise<string>;
  openExternal(url: string): Promise<void>;
  clearCache(): Promise<void>;
  pathForFile(f: File): string;
  platform: string;
  on(channel: string, cb: (payload: any) => void): () => void;
}

declare global {
  interface Window {
    api: Api;
  }
}
