'use strict';
/**
 * E2E-Test für Gesichter: Gesichter finden, „Merke dir, die Person auf diesem Foto ist meine Familie
 * und kommt in den Ordner Familie“, danach wird ein anderes Foto derselben Person für „Familie“
 * vorgeschlagen. Ausschalten löscht die gespeicherten Gesichter.
 *
 *   FOTOSORT_AI_FILE=…/slimsort-ki-1.safetensors FOTOSORT_FACES_DIR=…(Gesichtsmodelle + Testbilder)
 *   FOTOSORT_HELPER=…/slimsort-llm FOTOSORT_FACES_OTHER=…/foto-einer-anderen-person.jpg
 *   xvfb-run -a node test/e2e/faces.cjs [screenshot-ordner]
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { launch, sleep } = require('./driver.cjs');

const ROOT = path.join(__dirname, '..', '..');
const SHOTS = process.argv[2] || path.join(os.tmpdir(), 'slimsort-faces-shots');
const { FOTOSORT_AI_FILE: MODEL, FOTOSORT_FACES_DIR: FACES, FOTOSORT_HELPER: HELPER, FOTOSORT_FACES_OTHER: OTHER } = process.env;
if (![MODEL, FACES, HELPER, OTHER].every((p) => p && fs.existsSync(p))) {
  console.log('FOTOSORT_AI_FILE/FOTOSORT_FACES_DIR/FOTOSORT_HELPER/FOTOSORT_FACES_OTHER fehlen – Gesichter-Test übersprungen');
  process.exit(0);
}
fs.mkdirSync(SHOTS, { recursive: true });
async function waitFor(fn, ms = 8000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await sleep(150);
  }
  throw new Error('Zeitüberschreitung: ' + label);
}

(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'slimsort-faces-'));
  const src = path.join(base, 'Import');
  const fam = path.join(base, 'Familie');
  const rest = path.join(base, 'Sonstiges');
  const userData = path.join(base, 'userdata');
  const ki = path.join(userData, 'ki');
  for (const d of [src, fam, rest, ki, path.join(base, 'xdg')]) fs.mkdirSync(d, { recursive: true });

  // a1 = Astronautin, b = eine andere Person, c = Astronautin kleiner und anders zugeschnitten
  const astro = path.join(FACES, 'slimsort-face-test-astronaut.png');
  fs.copyFileSync(astro, path.join(src, 'a1.png'));
  fs.copyFileSync(OTHER, path.join(src, 'b' + path.extname(OTHER)));
  execFileSync('python3', ['-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
w, h = im.size
im = im.crop((int(w * .08), 0, w, int(h * .9))).resize((int(w * .7), int(h * .63)))
im.save(sys.argv[2], quality=88)
`, astro, path.join(src, 'c.jpg')]);
  // feste Reihenfolge in der App (nach Aufnahmezeit): a1, b, c
  fs.readdirSync(src).sort().forEach((n, i) => fs.utimesSync(path.join(src, n), 1e9 + i * 60, 1e9 + i * 60));

  // KI ist schon „heruntergeladen“: Bildmodell, Gesichtsmodelle und Helfer liegen bereit
  fs.copyFileSync(MODEL, path.join(ki, 'slimsort-ki-1.safetensors'));
  for (const f of ['slimsort-face-detect.onnx', 'slimsort-face-embed.onnx']) fs.copyFileSync(path.join(FACES, f), path.join(ki, f));
  const helper = path.join(ki, `slimsort-llm-linux-${process.arch === 'x64' ? 'x86_64' : 'aarch64'}`);
  fs.copyFileSync(HELPER, helper);
  fs.chmodSync(helper, 0o755);

  fs.writeFileSync(
    path.join(userData, 'einstellungen.json'),
    JSON.stringify({
      version: 1,
      onboarded: true,
      tutorialDone: true,
      prefs: { theme: 'dark', lang: 'de', mode: 'expert', activeProfileId: 'p1', seriesEnabled: false, updateCheck: false, aiEnabled: true, aiTier: 'eco', aiFaces: true, aiLearnFolders: false },
      profiles: [{ id: 'p1', name: 'Meine Ordner', groups: [], targets: [
        { id: 't1', name: 'Familie', path: fam, key: '1', color: '#e5484d' },
        { id: 't2', name: 'Sonstiges', path: rest, key: '2', color: '#3e63dd' },
      ] }],
      quickStarts: [{ id: 'q1', name: 'Import', source: src, sources: [src], profileId: 'p1', trashDir: null, startView: 'single', recursive: false, fullscreen: false, lastUsed: 1 }],
      recentSources: [],
    })
  );

  const app = await launch({
    app: process.env.FOTOSORT_EXE || path.join(ROOT, 'src-tauri', 'target', 'debug', 'slimsort'),
    env: { FOTOSORT_TEST: '1', FOTOSORT_USERDATA: userData, XDG_DATA_HOME: path.join(base, 'xdg'), LANG: 'de_DE.UTF-8', WEBKIT_DISABLE_DMABUF_RENDERER: '1' },
  });
  globalThis.__app = app;
  const win = app.page;
  const shot = async (name) => {
    await sleep(300);
    await win.screenshot({ path: path.join(SHOTS, name + '.png') });
  };
  const status = () => win.evaluate(() => window.api.ai.status());
  const chatText = () => win.evaluate(() => document.querySelector('[data-testid="chat"]').textContent);
  const chatHas = (re, ms = 15000) =>
    waitFor(async () => re.test(await chatText()), ms, String(re)).catch(async (e) => {
      console.log('Chat:', (await chatText()).slice(-600));
      throw e;
    });
  const say = async (text) => {
    await win.fill('[data-testid="chat-input"]', text);
    await win.keyboard.press('Enter');
  };
  const saved = () => JSON.parse(fs.readFileSync(path.join(userData, 'einstellungen.json'), 'utf8'));

  await win.waitForSelector('[data-testid="home"]');
  await win.keyboard.press('1');
  await win.waitForSelector('[data-testid="session"]');
  await waitFor(async () => {
    const s = await status();
    return s.installed && s.faces && s.indexed === 3 && s.faceTotal >= 3;
  }, 240000, 'Gesichter gefunden');
  console.log('Gesichter gefunden ✔', (await status()).faceTotal);

  // ---------------------------------------------------------------- merken
  await win.click('[data-testid="chat-toggle"]');
  await win.waitForSelector('[data-testid="chat-input"]');
  await say('Merke dir, die Person auf diesem Foto ist meine Familie und kommt in den Ordner Familie');
  await chatHas(/Gemerkt: Das ist „Familie“/);
  await waitFor(() => (saved().aiMemory || []).some((m) => m.kind === 'faces' && m.label === 'Familie' && m.targetPath === fam), 5000, 'gespeichert');
  console.log('Familie gemerkt ✔');

  // ---------------------------------------------------------------- anderes Foto derselben Person → Vorschlag „Familie“
  const sugg = () => win.evaluate(() => document.querySelector('[data-testid="target"].suggest')?.getAttribute('data-name') + ' | ' + (document.querySelector('[data-testid="target"].suggest .sugg')?.textContent || ''));
  await win.evaluate(() => document.activeElement && document.activeElement.blur()); // Pfeiltasten nicht ins Chatfeld
  await win.keyboard.press('ArrowRight'); // b: andere Person
  await sleep(1500);
  const sb = await sugg();
  console.log('b:', sb);
  assert.ok(!/Gemerkt/.test(sb), 'fremde Personen dürfen nicht als Familie erkannt werden');
  await win.keyboard.press('ArrowRight'); // c.jpg: Astronautin
  await waitFor(async () => /^Familie \| Gemerkt: Familie/.test(await sugg()), 15000, 'Vorschlag Familie');
  console.log('c.jpg:', await sugg(), '✔');
  await shot('01-faces-suggest');

  // ---------------------------------------------------------------- Ausschalten löscht Gesichter
  await win.click('[data-testid="menu-btn"]');
  await win.click('text=Einstellungen');
  await win.click('[data-testid="settings-ai"]');
  await win.click('[data-testid="ai-faces"] button');
  await waitFor(async () => !(await status()).faces, 5000, 'Gesichter aus');
  assert.ok(!fs.existsSync(path.join(ki, 'gesichter.bin')), 'gespeicherte Gesichter gelöscht');
  console.log('Ausschalten löscht Gesichter ✔');

  const errs = fs.readFileSync(path.join(userData, 'app.log'), 'utf8').split('\n').filter((l) => /renderer .*(error|unhandled)/i.test(l));
  assert.deepEqual(errs, [], 'keine Fehler in der Oberfläche');
  await app.close();
  console.log('GESICHTER-E2E OK');
  fs.rmSync(base, { recursive: true, force: true });
  process.exit(0);
})().catch(async (e) => {
  console.error('GESICHTER-E2E FEHLER:', e);
  await globalThis.__app?.close().catch(() => {});
  process.exit(1);
});
