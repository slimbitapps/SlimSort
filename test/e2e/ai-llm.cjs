'use strict';
/**
 * E2E-Test für die KI-Stufe "Ausgewogen" mit Sprachmodell: Chat beantwortet Fragen,
 * sucht Fotos nach Beschreibung (echte Beispielfotos), beschreibt das aktuelle Foto.
 *
 *   FOTOSORT_AI_DIR=<ordner mit slimsort-ki-siglip2-b16.safetensors, slimsort-llm-qwen3-1.7b.gguf,
 *   slimsort-llm-linux-x86_64> FOTOSORT_AI_PICS=<ordner mit Fotos> xvfb-run -a node test/e2e/ai-llm.cjs [screens]
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const { launch, sleep } = require('./driver.cjs');

const ROOT = path.join(__dirname, '..', '..');
const SHOTS = process.argv[2] || path.join(os.tmpdir(), 'slimsort-ai-llm-shots');
const AI = process.env.FOTOSORT_AI_DIR;
const PICS = process.env.FOTOSORT_AI_PICS;
if (!AI || !PICS || !fs.existsSync(AI) || !fs.existsSync(PICS)) {
  console.log('FOTOSORT_AI_DIR/FOTOSORT_AI_PICS fehlen – Test übersprungen');
  process.exit(0);
}
fs.mkdirSync(SHOTS, { recursive: true });
async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await sleep(200);
  }
  throw new Error('Zeitüberschreitung: ' + label);
}

(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'slimsort-llm-'));
  const src = path.join(base, 'Fotos');
  const userData = path.join(base, 'userdata');
  fs.mkdirSync(path.join(userData, 'ki'), { recursive: true });
  fs.mkdirSync(src);
  for (const f of fs.readdirSync(PICS)) fs.copyFileSync(path.join(PICS, f), path.join(src, f));
  for (const f of fs.readdirSync(AI)) fs.symlinkSync(path.join(AI, f), path.join(userData, 'ki', f));
  for (const d of ['Tiere', 'Weltall']) fs.mkdirSync(path.join(base, d));
  fs.writeFileSync(
    path.join(userData, 'einstellungen.json'),
    JSON.stringify({
      version: 1, onboarded: true, tutorialDone: true,
      prefs: { theme: 'light', lang: 'de', mode: 'expert', activeProfileId: 'p1', seriesEnabled: false, updateCheck: false, aiEnabled: true, aiTier: 'balanced', aiPerf: 'high' },
      profiles: [{ id: 'p1', name: 'Ordner', groups: [], targets: [
        { id: 't1', name: 'Tiere', path: path.join(base, 'Tiere'), key: '1', color: '#e5484d' },
        { id: 't2', name: 'Weltall', path: path.join(base, 'Weltall'), key: '2', color: '#3e63dd' },
      ] }],
      quickStarts: [{ id: 'q1', name: 'Fotos', source: src, sources: [src], profileId: 'p1', trashDir: null, startView: 'single', recursive: false, fullscreen: false, lastUsed: 1 }],
      recentSources: [],
    })
  );
  const app = await launch({
    app: process.env.FOTOSORT_EXE || path.join(ROOT, 'src-tauri', 'target', 'debug', 'slimsort'),
    env: { FOTOSORT_TEST: '1', FOTOSORT_USERDATA: userData, XDG_DATA_HOME: path.join(base, 'xdg'), LANG: 'de_DE.UTF-8', WEBKIT_DISABLE_DMABUF_RENDERER: '1' },
  });
  globalThis.__app = app;
  const win = app.page;
  const status = () => win.evaluate(() => window.api.ai.status());
  const shot = (n) => sleep(300).then(() => win.screenshot({ path: path.join(SHOTS, n + '.png') }));
  const lastAi = () => win.evaluate(() => [...document.querySelectorAll('[data-testid="msg-ai"]')].pop()?.textContent || '');
  const ask = async (text) => {
    const before = await win.evaluate(() => document.querySelectorAll('[data-testid="msg-ai"]').length);
    await win.fill('[data-testid="chat-input"]', text);
    await win.keyboard.press('Enter');
    await waitFor(
      () => win.evaluate((n) => document.querySelectorAll('[data-testid="msg-ai"]').length > n && !document.querySelector('.bubble.streaming') && !document.querySelector('.bubble.typing'), before),
      240000,
      'Antwort auf ' + text
    );
    const a = await lastAi();
    console.log(`  „${text}“ → ${a.slice(0, 200).replace(/\s+/g, ' ')}`);
    return a;
  };

  await win.waitForSelector('[data-testid="home"]');
  await waitFor(async () => (await status()).enabled, 15000, 'KI an');
  let st = await status();
  assert.equal(st.tier, 'balanced');
  assert.ok(st.installed && st.chat, 'Modelle da');
  await win.keyboard.press('1');
  await win.waitForSelector('[data-testid="session"]');
  await waitFor(async () => { const s = await status(); return s.total > 0 && s.indexed === s.total; }, 600000, 'Analyse');
  console.log('Analyse ✔', JSON.stringify(await status()).slice(0, 200));

  await win.click('[data-testid="chat-toggle"]');
  await win.waitForSelector('[data-testid="chat-input"]');
  const t0 = Date.now();
  const a1 = await ask('Was ist ein Fallschirm?');
  console.log(`  (erste Antwort inkl. Laden: ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  assert.ok(a1.length > 20, 'Antwort auf Wissensfrage');
  assert.equal(await win.evaluate(() => [...document.querySelectorAll('[data-testid="msg-ai"]')].pop().querySelectorAll('[data-testid="chat-thumb"]').length), 0, 'keine Fotos bei Wissensfrage');

  await ask('Zeig mir ein Foto von einer Katze');
  const thumbs = await win.evaluate(() => [...[...document.querySelectorAll('[data-testid="msg-ai"]')].pop().querySelectorAll('[data-testid="chat-thumb"]')].map((b) => b.title));
  console.log('  Treffer:', thumbs.join(', '));
  assert.ok(['cat.jpg', 'chelsea.jpg'].includes(thumbs[0]), 'Katze zuerst');
  await shot('01-katze');

  await ask('Finde Fotos vom Weltall mit Sternen');
  const t2 = await win.evaluate(() => [...[...document.querySelectorAll('[data-testid="msg-ai"]')].pop().querySelectorAll('[data-testid="chat-thumb"]')].map((b) => b.title));
  console.log('  Treffer:', t2.join(', '));
  assert.equal(t2[0], 'hubble_deep_field.jpg');

  const a4 = await ask('Was ist auf dem aktuellen Foto zu sehen?');
  assert.ok(a4.length > 10);
  await shot('02-chat');

  // Werkzeuge: das Sprachmodell entscheidet selbst, dass es sich etwas merken soll
  const saved = () => JSON.parse(fs.readFileSync(path.join(userData, 'einstellungen.json'), 'utf8'));
  await ask('Kannst du dir bitte merken, dass Fotos mit Katzen immer in den Ordner Tiere kommen?');
  await waitFor(() => (saved().aiMemory || []).some((m) => m.targetPath === path.join(base, 'Tiere')), 10000, 'Regel gemerkt (per Werkzeug)');
  console.log('  Regel per Werkzeug gemerkt ✔', JSON.stringify(saved().aiMemory.map((m) => [m.kind, m.concept])));
  // eine Frage darf nichts verändern
  const n = (saved().aiMemory || []).length;
  await ask('Hast du dir gemerkt, wohin Fotos mit Katzen kommen?');
  await sleep(800);
  assert.equal((saved().aiMemory || []).length, n, 'Frage hat nichts Neues gemerkt');
  // gespeicherter Chat
  await waitFor(() => fs.existsSync(path.join(userData, 'chats.json')), 5000, 'Chat gespeichert');
  await shot('02b-werkzeuge');

  // Stufen-Auswahl in den Einstellungen
  await win.click('[data-testid="chat-close"]');
  await win.click('[data-testid="menu-btn"]');
  await win.click('text=Einstellungen');
  await win.click('[data-testid="settings-ai"]');
  await win.waitForSelector('[data-testid="ai-tiers"]');
  assert.ok(await win.evaluate(() => document.querySelector('[data-testid="ai-tier-balanced"]').classList.contains('on')), 'Stufe Ausgewogen aktiv');
  await shot('03-stufen');
  await win.keyboard.press('Escape');

  const errs = fs.readFileSync(path.join(userData, 'app.log'), 'utf8').split('\n').filter((l) => /renderer .*(error|unhandled)/i.test(l));
  assert.deepEqual(errs, [], 'keine Fehler in der Oberfläche');
  console.log('KI-Chat-E2E OK');
  await app.close();
  process.exit(0);
})().catch(async (e) => {
  console.error('KI-Chat-E2E FEHLER:', e);
  await globalThis.__app?.close().catch(() => {});
  process.exit(1);
});
