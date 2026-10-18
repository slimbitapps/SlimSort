'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Session } = require('../electron/core/session.cjs');
const { scan } = require('../electron/core/scanner.cjs');

async function tmpdir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'sess-test-'));
}
async function write(p, content = 'x', size) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, size ? Buffer.alloc(size, 1) : content);
  return p;
}
const exists = (p) => fs.existsSync(p);
const names = (items) => items.map((i) => i.name).sort();

test('Scanner: Begleitdateien, Live Photos, RAW+JPEG, Systemordner', async () => {
  const d = await tmpdir();
  await write(path.join(d, 'IMG_1.HEIC'));
  await write(path.join(d, 'IMG_1.MOV'), null, 3_000_000); // Live Photo
  await write(path.join(d, 'IMG_1.AAE'));
  await write(path.join(d, 'IMG_2.JPG'));
  await write(path.join(d, 'IMG_2.DNG'));
  await write(path.join(d, 'IMG_2.xmp'));
  await write(path.join(d, 'IMG_2.JPG.xmp'));
  await write(path.join(d, 'clip.mov'), null, 100);
  await write(path.join(d, 'big.jpg'));
  await write(path.join(d, 'big.mov'), null, 30 * 1024 * 1024); // zu groß für Live Photo
  await write(path.join(d, 'notiz.txt'));
  await write(path.join(d, '.versteckt.jpg'));
  await write(path.join(d, 'sub', 'tief.jpg'));
  await write(path.join(d, '@eaDir', 'thumb.jpg'));
  await write(path.join(d, '_Gelöscht', 'alt.jpg'));

  const flat = await scan(d, { recursive: false });
  assert.deepEqual(names(flat), ['IMG_1.HEIC', 'IMG_2.DNG', 'IMG_2.JPG', 'big.jpg', 'big.mov', 'clip.mov']);
  const live = flat.find((i) => i.name === 'IMG_1.HEIC');
  assert.equal(path.basename(live.live), 'IMG_1.MOV');
  assert.deepEqual(live.sidecars.map((s) => path.basename(s)), ['IMG_1.AAE']);
  const dng = flat.find((i) => i.name === 'IMG_2.DNG');
  const jpg = flat.find((i) => i.name === 'IMG_2.JPG');
  assert.deepEqual(dng.sidecars.map((s) => path.basename(s)), ['IMG_2.xmp']);
  assert.deepEqual(jpg.sidecars.map((s) => path.basename(s)), ['IMG_2.JPG.xmp']);
  assert.equal(flat.find((i) => i.name === 'big.jpg').live, null);

  const deep = await scan(d, { recursive: true, exclude: [path.join(d, '_Gelöscht')] });
  assert.ok(deep.some((i) => i.name === 'tief.jpg'));
  assert.ok(!deep.some((i) => i.name === 'thumb.jpg'));
  assert.ok(!deep.some((i) => i.name === 'alt.jpg'));
});

async function setup() {
  const d = await tmpdir();
  const src = path.join(d, 'Quelle');
  await write(path.join(src, 'a.jpg'), 'A');
  await write(path.join(src, 'a.xmp'), 'AX');
  await write(path.join(src, 'b.jpg'), 'B');
  await write(path.join(src, 'live.heic'), 'L');
  await write(path.join(src, 'live.mov'), 'LV');
  await fsp.mkdir(path.join(d, 'Urlaub'));
  await fsp.mkdir(path.join(d, 'Familie'));
  const s = new Session({ journalPath: path.join(d, 'journal.log'), timeout: 1000 });
  const items = await s.open({ sourceDir: src });
  const byName = Object.fromEntries(items.map((i) => [i.name, i]));
  return { d, src, s, items, byName };
}

test('Sitzung: verschieben, mehrfach rückgängig in richtiger Reihenfolge', async () => {
  const { d, src, s, byName } = await setup();
  const done = [];
  s.on('opDone', (e) => done.push(e));
  s.transfer({ opId: 1, itemIds: [byName['a.jpg'].id], destDir: path.join(d, 'Urlaub'), action: 'move' });
  s.transfer({ opId: 2, itemIds: [byName['b.jpg'].id], destDir: path.join(d, 'Familie'), action: 'move' });
  s.transfer({ opId: 3, itemIds: [byName['b.jpg'].id], destDir: path.join(d, 'Urlaub'), action: 'move' }); // b weiter
  await s.drain();
  assert.ok(exists(path.join(d, 'Urlaub', 'a.jpg')));
  assert.ok(exists(path.join(d, 'Urlaub', 'a.xmp')));
  assert.ok(exists(path.join(d, 'Urlaub', 'b.jpg')));
  assert.ok(!exists(path.join(d, 'Familie', 'b.jpg')));

  s.undo(3);
  await s.drain();
  assert.ok(exists(path.join(d, 'Familie', 'b.jpg')));
  s.undo(2);
  s.undo(1);
  await s.drain();
  assert.ok(exists(path.join(src, 'a.jpg')));
  assert.ok(exists(path.join(src, 'a.xmp')));
  assert.ok(exists(path.join(src, 'b.jpg')));
  assert.deepEqual(await fsp.readdir(path.join(d, 'Urlaub')), []);
  assert.equal(done.filter((e) => e.kind === 'undo').length, 3);
  const journal = await fsp.readFile(path.join(d, 'journal.log'), 'utf8');
  assert.ok(journal.includes('"op":"move"'));
});

test('Sitzung: nicht erreichbares Ziel -> Fehler, Datei bleibt, kein Rückgängig-Eintrag', async () => {
  const { d, src, s, byName } = await setup();
  let ev;
  s.on('opDone', (e) => (ev = e));
  const res = await s.transfer({
    opId: 9,
    itemIds: [byName['a.jpg'].id],
    destDir: path.join(d, 'NAS-offline', 'Fotos'),
    action: 'move',
  });
  assert.equal(res[0].ok, false);
  assert.equal(res[0].error, 'EUNREACHABLE');
  assert.equal(ev.results[0].error, 'EUNREACHABLE');
  assert.ok(exists(path.join(src, 'a.jpg')));
  assert.equal(s.history.size, 0);
  // Danach wieder erreichbar: Verschieben klappt
  await fsp.mkdir(path.join(d, 'NAS-offline', 'Fotos'), { recursive: true });
  const res2 = await s.transfer({
    opId: 10,
    itemIds: [byName['a.jpg'].id],
    destDir: path.join(d, 'NAS-offline', 'Fotos'),
    action: 'move',
  });
  assert.equal(res2[0].ok, true);
});

test('Sitzung: Löschen in Löschordner, Rückgängig, endgültig leeren', async () => {
  const { src, s, byName } = await setup();
  await s.transfer({ opId: 1, itemIds: [byName['a.jpg'].id], action: 'trash' });
  const trash = path.join(src, '_Gelöscht');
  assert.ok(exists(path.join(trash, 'a.jpg')));
  assert.ok(exists(path.join(trash, 'a.xmp')));
  await s.undo(1);
  assert.ok(exists(path.join(src, 'a.jpg')));
  await s.transfer({ opId: 2, itemIds: [byName['b.jpg'].id], action: 'trash' });
  const info = await s.trashInfo();
  assert.equal(info.count, 1);
  const r = await s.emptyTrash();
  assert.equal(r.removed, 1);
  assert.deepEqual(r.pruned, [2]);
  assert.ok(!exists(path.join(trash, 'b.jpg')));
  assert.ok(exists(path.join(src, 'a.jpg')));
});

test('Sitzung: Live Photo – Video mitnehmen / löschen / liegen lassen', async () => {
  for (const mode of ['move', 'trash', 'keep']) {
    const { d, src, s, byName } = await setup();
    await s.transfer({
      opId: 1,
      itemIds: [byName['live.heic'].id],
      destDir: path.join(d, 'Urlaub'),
      action: 'move',
      liveVideo: mode,
    });
    assert.ok(exists(path.join(d, 'Urlaub', 'live.heic')), mode);
    assert.equal(exists(path.join(d, 'Urlaub', 'live.mov')), mode === 'move', mode);
    assert.equal(exists(path.join(src, '_Gelöscht', 'live.mov')), mode === 'trash', mode);
    assert.equal(exists(path.join(src, 'live.mov')), mode === 'keep', mode);
    await s.undo(1);
    assert.ok(exists(path.join(src, 'live.heic')), mode);
    assert.ok(exists(path.join(src, 'live.mov')), mode);
  }
});

test('Sitzung: Kopieren und Rückgängig', async () => {
  const { d, src, s, byName } = await setup();
  await s.transfer({ opId: 1, itemIds: [byName['a.jpg'].id, byName['b.jpg'].id], destDir: path.join(d, 'Urlaub'), action: 'copy' });
  assert.ok(exists(path.join(src, 'a.jpg')));
  assert.ok(exists(path.join(d, 'Urlaub', 'a.jpg')));
  assert.ok(exists(path.join(d, 'Urlaub', 'b.jpg')));
  await s.undo(1);
  assert.deepEqual(await fsp.readdir(path.join(d, 'Urlaub')), []);
  assert.ok(exists(path.join(src, 'a.jpg')));
});

test('Sitzung: Ziel verschwindet während der Warteschlange (NAS getrennt)', async () => {
  const { d, src, s, byName } = await setup();
  const nas = path.join(d, 'NAS');
  await fsp.mkdir(nas);
  const p1 = s.transfer({ opId: 1, itemIds: [byName['a.jpg'].id], destDir: nas, action: 'move' });
  const p2 = s.transfer({ opId: 2, itemIds: [byName['b.jpg'].id], destDir: nas, action: 'move' });
  await p1;
  await fsp.rm(nas, { recursive: true }); // NAS "weg"
  const r2 = await p2;
  assert.equal(r2[0].ok, false);
  assert.ok(exists(path.join(src, 'b.jpg')), 'b bleibt in der Quelle');
});

test('Viele Dateien: 20.000 Einträge werden zügig eingelesen', async () => {
  const d = await tmpdir();
  const n = 20000;
  for (let i = 0; i < n; i++) fs.writeFileSync(path.join(d, `IMG_${String(i).padStart(5, '0')}.jpg`), '');
  const t0 = Date.now();
  const items = await scan(d);
  const ms = Date.now() - t0;
  assert.equal(items.length, n);
  assert.ok(ms < 8000, `Einlesen dauerte ${ms} ms`);
});
