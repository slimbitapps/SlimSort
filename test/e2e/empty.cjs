'use strict';
/**
 * E2E: Ordner öffnen, während noch ein Filter aktiv ist (z. B. „nur Videos“ oder „Doppelte“).
 * Früher: „Keine Fotos in dieser Ansicht“ ohne Erklärung. Jetzt: Hinweis + „Alle zeigen“.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { launch, sleep } = require('./driver.cjs');

const ROOT = path.join(__dirname, '..', '..');
(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'slimsort-empty-'));
  const src = path.join(base, 'Import');
  const userData = path.join(base, 'userdata');
  fs.mkdirSync(userData, { recursive: true });
  execFileSync('python3', [path.join(ROOT, 'scripts', 'make-fixtures.py'), src, '--simple', '5', 'IMG']);
  const settings = (filter) => JSON.stringify({
    version: 1, onboarded: true, tutorialDone: true,
    prefs: { theme: 'dark', lang: 'de', mode: 'expert', activeProfileId: 'p1', seriesEnabled: false, updateCheck: false, filter },
    profiles: [{ id: 'p1', name: 'Ordner', groups: [], targets: [] }],
    quickStarts: [{ id: 'q1', name: 'Import', source: src, sources: [src], profileId: 'p1', trashDir: null, startView: 'single', recursive: false, fullscreen: false, lastUsed: 1 }],
    recentSources: [],
  });
  const env = { FOTOSORT_TEST: '1', FOTOSORT_USERDATA: userData, XDG_DATA_HOME: path.join(base, 'xdg'), LANG: 'de_DE.UTF-8', WEBKIT_DISABLE_DMABUF_RENDERER: '1' };
  const exe = process.env.FOTOSORT_EXE || path.join(ROOT, 'src-tauri', 'target', 'debug', 'slimsort');

  // 1) „Doppelte“ von früher wird beim Öffnen zurückgesetzt
  fs.writeFileSync(path.join(userData, 'einstellungen.json'), settings('duplicates'));
  let app = await launch({ app: exe, env });
  globalThis.__app = app;
  let win = app.page;
  await win.waitForSelector('[data-testid="home"]');
  await win.keyboard.press('1');
  await win.waitForSelector('[data-testid="session"]');
  await sleep(800);
  assert.ok(!(await win.$('[data-testid="empty-view"]')), 'Fotos sichtbar trotz altem Filter „Doppelte“');
  console.log('Filter „Doppelte“ zurückgesetzt ✔');
  await app.close();

  // 2) „nur Videos“ in einem Ordner ohne Videos → Hinweis + „Alle zeigen“
  fs.writeFileSync(path.join(userData, 'einstellungen.json'), settings('videos'));
  await sleep(1500);
  app = await launch({ app: exe, env });
  globalThis.__app = app;
  win = app.page;
  await win.waitForSelector('[data-testid="home"]');
  await win.keyboard.press('1');
  await win.waitForSelector('[data-testid="empty-view"]');
  const txt = await win.textContent('[data-testid="empty-view"]');
  assert.match(txt, /5 Fotos sind gerade ausgeblendet/);
  await sleep(600); // Ansicht fertig aufbauen lassen
  await win.click('[data-testid="show-all"]');
  await win.waitForFunction(() => !document.querySelector('[data-testid="empty-view"]'), null, { timeout: 5000 });
  console.log('Hinweis + „Alle zeigen“ ✔');
  await app.close();
  console.log('Leere-Ansicht-E2E OK');
  process.exit(0);
})().catch(async (e) => {
  console.error('Leere-Ansicht-E2E FEHLER:', e);
  await globalThis.__app?.close().catch(() => {});
  process.exit(1);
});
