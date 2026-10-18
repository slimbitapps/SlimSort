'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('api', {
  getSettings: invoke('settings:get'),
  setSettings: invoke('settings:set'),
  appInfo: invoke('app:info'),
  pickFolder: invoke('dialog:pickFolder'),
  confirm: invoke('dialog:confirm'),
  checkDir: invoke('fs:checkDir'),
  mkdir: invoke('fs:mkdir'),
  openSession: invoke('session:open'),
  transfer: invoke('session:transfer'),
  undo: invoke('session:undo'),
  pending: invoke('session:pending'),
  trashInfo: invoke('trash:info'),
  emptyTrash: invoke('trash:empty'),
  setWatchedDirs: invoke('reach:set'),
  checkReach: invoke('reach:check'),
  findLost: invoke('lost:find'),
  setFullscreen: invoke('win:setFullscreen'),
  isFullscreen: invoke('win:isFullscreen'),
  showItem: invoke('shell:showItem'),
  openPath: invoke('shell:openPath'),
  openExternal: invoke('shell:openExternal'),
  clearCache: invoke('cache:clear'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  platform: process.platform,
  on(channel, cb) {
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
});
