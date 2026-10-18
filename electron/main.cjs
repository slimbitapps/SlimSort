'use strict';
// Mehr Hintergrund-Threads, damit ein hängendes NAS nicht alles blockiert.
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

const { app, BrowserWindow, ipcMain, dialog, protocol, nativeImage, nativeTheme, shell, Menu, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { Session } = require('./core/session.cjs');
const { SettingsStore } = require('./core/settings.cjs');
const { ReachMonitor, findLostFolders } = require('./core/reach.cjs');
const { readCaptureTimes } = require('./core/exif.cjs');
const { createMediaServer } = require('./core/media.cjs');
const { checkDir } = require('./core/fsops.cjs');
const { scan } = require('./core/scanner.cjs');

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const isTest = !!process.env.FOTOSORT_TEST;
if (process.env.FOTOSORT_USERDATA) app.setPath('userData', process.env.FOTOSORT_USERDATA);

protocol.registerSchemesAsPrivileged(
  ['media', 'thumb', 'preview'].map((scheme) => ({
    scheme,
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true },
  }))
);

// Einfaches Fehlerprotokoll (bleibt lokal) – hilft bei der Fehlersuche.
function log(...args) {
  try {
    const line = `[${new Date().toISOString()}] ${args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
    fs.appendFileSync(path.join(app.getPath('userData'), 'app.log'), line);
  } catch {
    /* ignorieren */
  }
}
process.on('uncaughtException', (e) => log('uncaughtException', e));
process.on('unhandledRejection', (e) => log('unhandledRejection', e));

const HEADER_H = 52;
const THEMES = {
  dark: { bg: '#121316', header: '#121316', symbols: '#e9eaee' },
  light: { bg: '#f5f5f7', header: '#f5f5f7', symbols: '#1c1c1e' },
};
function isDark(theme) {
  return theme === 'dark' || (theme !== 'light' && nativeTheme.shouldUseDarkColors);
}

let win = null;
let pickCount = 0;
let session = null;
let exifRun = 0;
const settings = new SettingsStore(path.join(app.getPath('userData'), 'einstellungen.json'));
const reach = new ReachMonitor();

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  const saved = settings.data.window || {};
  const { workAreaSize } = screen.getPrimaryDisplay();
  const theme = (settings.data.prefs && settings.data.prefs.theme) || 'system';
  const colors = THEMES[isDark(theme) ? 'dark' : 'light'];
  const isMacOS = process.platform === 'darwin';
  win = new BrowserWindow({
    width: Math.min(saved.width || 1400, workAreaSize.width),
    height: Math.min(saved.height || 900, workAreaSize.height),
    x: saved.x,
    y: saved.y,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: colors.bg,
    title: 'Fotosortierer',
    show: false,
    autoHideMenuBar: true,
    // Moderne Fensterleiste: Inhalt reicht bis oben, Fensterknöpfe bleiben nativ.
    titleBarStyle: 'hidden',
    ...(isMacOS
      ? { trafficLightPosition: { x: 18, y: 18 } }
      : { titleBarOverlay: { color: colors.header, symbolColor: colors.symbols, height: HEADER_H } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  if (saved.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  // Esc beendet das Vollbild IMMER – unabhängig davon, was die Oberfläche tut.
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && win.isFullScreen()) {
      win.setFullScreen(false);
    }
  });
  win.on('enter-full-screen', () => send('win:fullscreen', true));
  win.on('leave-full-screen', () => send('win:fullscreen', false));

  const remember = () => {
    if (!win || win.isDestroyed() || win.isFullScreen()) return;
    const b = win.getNormalBounds();
    settings.data.window = { ...b, maximized: win.isMaximized() };
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('close', () => {
    remember();
    settings.save(settings.data);
  });

  // Externe Links im System-Browser öffnen, nie in der App navigieren.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:') && !(isDev && url.startsWith(process.env.VITE_DEV_SERVER_URL))) e.preventDefault();
  });

  if (isDev) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

function buildMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      {
        label: 'Fenster',
        submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'togglefullscreen' }, { role: 'close' }],
      },
    ])
  );
}

function newSession() {
  if (session) session.removeAllListeners();
  session = new Session({ journalPath: path.join(app.getPath('userData'), 'protokoll.log') });
  session.on('progress', (p) => send('op:progress', p));
  session.on('opDone', (p) => send('op:done', p));
  session.on('idle', () => send('op:idle', null));
  return session;
}

function registerIpc() {
  ipcMain.handle('settings:get', () => settings.data);
  ipcMain.handle('settings:set', (_e, data) => {
    settings.save({ ...data, window: settings.data.window });
    return true;
  });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    userData: app.getPath('userData'),
    journal: path.join(app.getPath('userData'), 'protokoll.log'),
  }));

  ipcMain.handle('dialog:pickFolder', async (_e, { title, defaultPath } = {}) => {
    if (isTest && process.env.FOTOSORT_PICK) {
      // Tests: mehrere Ordner mit "|" getrennt, werden nacheinander zurückgegeben
      const list = process.env.FOTOSORT_PICK.split('|');
      const r = list[pickCount % list.length];
      pickCount++;
      return r;
    }
    const r = await dialog.showOpenDialog(win, {
      title,
      defaultPath,
      properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('dialog:confirm', async (_e, { message, detail, buttons, type = 'question' }) => {
    const r = await dialog.showMessageBox(win, { message, detail, buttons, type, defaultId: 0, cancelId: buttons.length - 1 });
    return r.response;
  });

  ipcMain.handle('fs:checkDir', (_e, dir) => checkDir(dir));

  // Fotos und Videos in einem Ordner zählen (für die Vorschau beim Einrichten)
  ipcMain.handle('fs:count', async (_e, { dir, dirs, recursive }) => {
    let images = 0;
    let videos = 0;
    const sample = [];
    const perDir = [];
    for (const d of dirs || [dir]) {
      const items = await scan(d, { recursive, exclude: [path.join(d, '_Gelöscht')] });
      let n = 0;
      for (const it of items) {
        it.kind === 'video' ? videos++ : images++;
        n++;
        if (sample.length < 4 && it.kind === 'image') sample.push(it.path);
      }
      perDir.push(n);
    }
    return { images, videos, total: images + videos, sample, perDir };
  });

  // Neuen Zielordner anlegen (existiert er schon, wird er einfach verwendet)
  ipcMain.handle('fs:createFolder', async (_e, { parent, name }) => {
    const clean = String(name).replace(/[\\/:*?"<>|]/g, '').replace(/^\.+/, '').trim();
    if (!clean) throw new Error('Ungültiger Name');
    const dir = path.join(parent, clean);
    await fsp.mkdir(dir, { recursive: true });
    return dir;
  });
  ipcMain.handle('fs:parent', (_e, p) => path.dirname(p));

  // Design umschalten: Fensterknöpfe passend einfärben
  ipcMain.handle('win:theme', (_e, theme) => {
    nativeTheme.themeSource = theme === 'system' ? 'system' : theme;
    const c = THEMES[isDark(theme) ? 'dark' : 'light'];
    if (win && process.platform !== 'darwin') {
      try {
        win.setTitleBarOverlay({ color: c.header, symbolColor: c.symbols, height: HEADER_H });
      } catch {
        /* ältere Systeme */
      }
    }
    if (win) win.setBackgroundColor(c.bg);
    return isDark(theme);
  });
  ipcMain.handle('app:log', (_e, msg) => log('renderer', msg));
  ipcMain.handle('fs:mkdir', async (_e, dir) => {
    await fsp.mkdir(dir, { recursive: true });
    return true;
  });

  ipcMain.handle('session:open', async (_e, { sourceDir, sourceDirs, recursive, trashDir }) => {
    log('session:open', sourceDirs || sourceDir);
    const s = newSession();
    const items = await s.open({
      sourceDir,
      sourceDirs,
      recursive,
      trashDir,
      onProgress: (n) => send('scan:progress', n),
    });
    // Aufnahmezeiten im Hintergrund lesen
    const run = ++exifRun;
    readCaptureTimes(
      items.map((i) => ({ id: i.id, path: i.path, ext: i.ext })),
      {
        onBatch: (b) => run === exifRun && send('exif:batch', b),
        isCancelled: () => run !== exifRun,
      }
    ).then(() => run === exifRun && send('exif:done', null));
    log('session:open ok', items.length);
    return { items, trashDir: s.trashDir };
  });

  ipcMain.handle('session:transfer', (_e, op) => {
    if (!session) return false;
    session.transfer(op);
    return true;
  });
  ipcMain.handle('session:undo', (_e, opId) => {
    if (!session) return false;
    session.undo(opId);
    return true;
  });
  ipcMain.handle('session:pending', () => (session ? session.pending : 0));
  ipcMain.handle('trash:info', async (_e, dir) => {
    if (!session) {
      const tmp = new Session();
      tmp.trashDir = dir;
      return tmp.trashInfo();
    }
    return session.trashInfo();
  });
  ipcMain.handle('trash:empty', async () => (session ? session.emptyTrash() : { removed: 0, pruned: [] }));

  ipcMain.handle('reach:set', (_e, dirs) => {
    reach.setDirs(dirs);
    return reach.snapshot();
  });
  ipcMain.handle('reach:check', () => reach.checkNow());
  ipcMain.handle('lost:find', (_e, { missing, hints }) => findLostFolders(missing, { hints }));

  ipcMain.handle('win:setFullscreen', (_e, on) => {
    win.setFullScreen(!!on);
    return win.isFullScreen();
  });
  ipcMain.handle('win:isFullscreen', () => win.isFullScreen());

  ipcMain.handle('shell:showItem', (_e, p) => shell.showItemInFolder(p));
  ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p));
  ipcMain.handle('shell:openExternal', (_e, url) => /^https?:/.test(url) && shell.openExternal(url));
  ipcMain.handle('cache:clear', () => media.clearCache());
}

let media;
let quitting = false;

app.whenReady().then(() => {
  settings.load();
  log('start', app.getVersion(), process.platform, process.arch);
  nativeTheme.on('updated', () => send('win:systemTheme', nativeTheme.shouldUseDarkColors));
  media = createMediaServer({ nativeImage, cacheDir: path.join(app.getPath('userData'), 'cache') });
  protocol.handle('media', media.handleMedia);
  protocol.handle('thumb', media.handleThumb);
  protocol.handle('preview', media.handlePreview);
  setTimeout(() => media.trimCache().catch(() => {}), 20000);

  reach.on('change', (s) => send('reach:change', s));
  reach.start();

  buildMenu();
  registerIpc();
  createWindow();
});

// Nicht beenden, solange Dateien noch übertragen werden.
app.on('before-quit', (e) => {
  if (quitting || !session || session.pending === 0) return;
  e.preventDefault();
  quitting = true;
  send('app:quitting', session.pending);
  session.drain().then(() => app.quit());
});

app.on('window-all-closed', () => {
  reach.stop();
  app.quit();
});
