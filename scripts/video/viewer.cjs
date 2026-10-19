'use strict';
// Rahmenloses Fenster für Video-Szenen (ohne Browser-Leiste)
const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const [w, h] = process.env.VIEW_SIZE.split('x').map(Number);
  const win = new BrowserWindow({ x: 0, y: 0, width: w, height: h, frame: false, backgroundColor: '#0b0d12', webPreferences: { sandbox: false } });
  win.setBounds({ x: 0, y: 0, width: w, height: h });
  win.loadURL(process.env.VIEW_URL);
});
