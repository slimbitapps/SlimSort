'use strict';
// Mehr Hintergrund-Threads, damit ein hängendes NAS nicht alles blockiert.
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

const { app, BrowserWindow, ipcMain, dialog, protocol, nativeImage, shell, Menu, screen } = require('electron');
const path = require('node:path');
const fsp = require('node:fs/promises');
const { Session } = require('./core/session.cjs');
const { SettingsStore } = require('./core/settings.cjs');
const { ReachMonitor, findLostFolders } = require('./core/reach.cjs');
const { readCaptureTimes } = require('./core/exif.cjs');
const { createMediaServer } = require('./core/media.cjs');
const { checkDir } = require('./core/fsops.cjs');

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const isTest = !!process.env.FOTOSORT_TEST;
if (process.env.FOTOSORT_USERDATA) app.setPath('userData', process.env.FOTOSORT_USERDATA);

protocol.registerSchemesAsPrivileged(
  ['media', 'thumb', 'preview'].map((scheme) => ({
    scheme,
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true },
  }))
);

let win = null;
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
  win = new BrowserWindow({
    width: Math.min(saved.width || 1400, workAreaSize.width),
    height: Math.min(saved.height || 900, workAreaSize.height),
    x: saved.x,
    y: saved.y,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: '#14161a',
    title: 'Fotosortierer',
    show: false,
    autoHideMenuBar: true,
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
    if (isTest && process.env.FOTOSORT_PICK) return process.env.FOTOSORT_PICK;
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
  ipcMain.handle('fs:mkdir', async (_e, dir) => {
    await fsp.mkdir(dir, { recursive: true });
    return true;
  });

  ipcMain.handle('session:open', async (_e, { sourceDir, recursive, trashDir }) => {
    const s = newSession();
    const items = await s.open({
      sourceDir,
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
