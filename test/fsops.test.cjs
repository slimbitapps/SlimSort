'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const ops = require('../electron/core/fsops.cjs');

const OTHER_DEVICE_BASE = fs.existsSync('/dev/shm') ? '/dev/shm' : null;

async function tmpdir(base = os.tmpdir()) {
  return fsp.mkdtemp(path.join(base, 'fs-test-'));
}
async function write(p, content, mtime) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content);
  if (mtime) await fsp.utimes(p, mtime, mtime);
  return p;
}
const read = (p) => fsp.readFile(p, 'utf8');
const exists = (p) => fs.existsSync(p);
const OLD = new Date('2019-07-14T10:20:30Z');

test('Verschieben auf gleichem Laufwerk: Original weg, Ziel da, Datum erhalten', async () => {
  const d = await tmpdir();
  const src = await write(path.join(d, 'src', 'a.jpg'), 'AAA', OLD);
  await fsp.mkdir(path.join(d, 'dst'));
  const plan = await ops.transferGroup([src], path.join(d, 'dst'), { mode: 'move' });
  assert.equal(plan[0].to, path.join(d, 'dst', 'a.jpg'));
  assert.equal(exists(src), false);
  assert.equal(await read(plan[0].to), 'AAA');
  assert.equal((await fsp.stat(plan[0].to)).mtime.getTime(), OLD.getTime());
});

test('Niemals überschreiben: vorhandener Name wird zu "Name (2)", Begleitdateien folgen', async () => {
  const d = await tmpdir();
  const src = await write(path.join(d, 'src', 'IMG_1.JPG'), 'NEW');
  const xmp = await write(path.join(d, 'src', 'IMG_1.xmp'), 'NEWXMP');
  const aae = await write(path.join(d, 'src', 'IMG_1.JPG.aae'), 'NEWAAE');
  await write(path.join(d, 'dst', 'IMG_1.JPG'), 'OLD');
  // Nur die Begleitdatei "IMG_1 (2).xmp" ist belegt -> "IMG_1 (3)" für alle
  await write(path.join(d, 'dst', 'IMG_1 (2).xmp'), 'OLD2');
  const plan = await ops.transferGroup([src, xmp, aae], path.join(d, 'dst'), { mode: 'move' });
  assert.deepEqual(
    plan.map((p) => path.basename(p.to)),
    ['IMG_1 (3).JPG', 'IMG_1 (3).xmp', 'IMG_1 (3).JPG.aae']
  );
  assert.equal(await read(path.join(d, 'dst', 'IMG_1.JPG')), 'OLD');
  assert.equal(await read(path.join(d, 'dst', 'IMG_1 (2).xmp')), 'OLD2');
  assert.equal(await read(path.join(d, 'dst', 'IMG_1 (3).JPG')), 'NEW');
});

test('transferFile verweigert ein existierendes Ziel', async () => {
  const d = await tmpdir();
  const src = await write(path.join(d, 'a.jpg'), 'A');
  const dst = await write(path.join(d, 'b.jpg'), 'B');
  await assert.rejects(ops.transferFile(src, dst, { mode: 'move' }), { code: 'EEXIST' });
  await assert.rejects(ops.transferFile(src, dst, { mode: 'copy' }), { code: 'EEXIST' });
  assert.equal(await read(dst), 'B');
  assert.equal(await read(src), 'A');
});

test('Kopieren: Original bleibt, Kopie identisch, Datum erhalten', async () => {
  const d = await tmpdir();
  const src = await write(path.join(d, 'src', 'v.mp4'), crypto.randomBytes(300000), OLD);
  await fsp.mkdir(path.join(d, 'dst'));
  const plan = await ops.transferGroup([src], path.join(d, 'dst'), { mode: 'copy' });
  assert.ok(exists(src));
  assert.deepEqual(await fsp.readFile(src), await fsp.readFile(plan[0].to));
  assert.equal((await fsp.stat(plan[0].to)).mtime.getTime(), OLD.getTime());
});

test('Verschieben auf anderes Laufwerk: kopieren, prüfen, dann Original löschen', { skip: !OTHER_DEVICE_BASE }, async () => {
  const d = await tmpdir();
  const other = await tmpdir(OTHER_DEVICE_BASE);
  const data = crypto.randomBytes(3 * 1024 * 1024 + 17);
  const src = await write(path.join(d, 'big.mov'), data, OLD);
  const progress = [];
  const plan = await ops.transferGroup([src], other, {
    mode: 'move',
    onProgress: (done, total) => progress.push([done, total]),
  });
  assert.equal(exists(src), false);
  assert.deepEqual(await fsp.readFile(plan[0].to), data);
  assert.equal((await fsp.stat(plan[0].to)).mtime.getTime(), OLD.getTime());
  assert.ok(progress.length > 2, 'Fortschritt wird gemeldet');
  assert.equal(progress.at(-1)[0], progress.at(-1)[1]);
  // keine temporären Dateien zurückgeblieben
  assert.deepEqual(await fsp.readdir(other), ['big.mov']);
});

test('Fehler beim Schreiben (z. B. NAS bricht weg): Original bleibt, keine Reste', async () => {
  const d = await tmpdir();
  const src = await write(path.join(d, 'src', 'a.jpg'), 'DATA');
  await fsp.mkdir(path.join(d, 'dst'));
  const orig = fsp.open;
  fsp.open = async (p, flags, ...rest) => {
    const fh = await orig(p, flags, ...rest);
    if (flags === 'wx') {
      fh.write = async () => {
        const e = new Error('EIO simuliert');
        e.code = 'EIO';
        throw e;
      };
    }
    return fh;
  };
  try {
    await assert.rejects(
      ops.transferGroup([src], path.join(d, 'dst'), { mode: 'copy' }),
      { code: 'EIO' }
    );
  } finally {
    fsp.open = orig;
  }
  assert.equal(await read(src), 'DATA');
  assert.deepEqual(await fsp.readdir(path.join(d, 'dst')), []);
});

test('Prüfsummenfehler: Kopie wird verworfen, Original bleibt', { skip: !OTHER_DEVICE_BASE }, async () => {
  const d = await tmpdir();
  const other = await tmpdir(OTHER_DEVICE_BASE);
  const src = await write(path.join(d, 'a.jpg'), 'ORIGINAL-DATA');
  const origHash = ops.hashFile;
  // Verfälschte Kopie simulieren: Prüfsumme der Kopie weicht ab
  const crypto2 = require('node:crypto');
  const origCreate = crypto2.createHash;
  let calls = 0;
  crypto2.createHash = (alg) => {
    const h = origCreate(alg);
    calls++;
    if (calls === 2) {
      const d0 = h.digest.bind(h);
      h.digest = () => 'kaputt' + d0('hex');
    }
    return h;
  };
  try {
    await assert.rejects(ops.transferGroup([src], other, { mode: 'move' }), { code: 'EVERIFY' });
  } finally {
    crypto2.createHash = origCreate;
  }
  assert.equal(origHash, ops.hashFile);
  assert.equal(await read(src), 'ORIGINAL-DATA');
  assert.deepEqual(await fsp.readdir(other), []);
});

test('Nicht erreichbarer Zielordner: klare Fehlermeldung, Datei bleibt', async () => {
  const d = await tmpdir();
  const src = await write(path.join(d, 'a.jpg'), 'A');
  await assert.rejects(
    ops.transferGroup([src], path.join(d, 'gibt-es-nicht'), { mode: 'move' }),
    { code: 'EUNREACHABLE' }
  );
  assert.equal(await read(src), 'A');
});

test('Hängendes Netzlaufwerk: Prüfung bricht nach Zeitlimit ab', async () => {
  const orig = fsp.stat;
  fsp.stat = () => new Promise(() => {}); // antwortet nie
  const t0 = Date.now();
  try {
    const r = await ops.checkDir('/irgendwo/nas', 300);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'ETIMEDOUT');
  } finally {
    fsp.stat = orig;
  }
  assert.ok(Date.now() - t0 < 2000);
});

test('Original während des Kopierens verändert: nichts wird gelöscht', { skip: !OTHER_DEVICE_BASE }, async () => {
  const d = await tmpdir();
  const other = await tmpdir(OTHER_DEVICE_BASE);
  const src = await write(path.join(d, 'a.jpg'), crypto.randomBytes(2 * 1024 * 1024));
  let changed = false;
  await assert.rejects(
    ops.transferFile(src, path.join(other, 'a.jpg'), {
      mode: 'move',
      onProgress: (done) => {
        if (!changed && done > 0) {
          changed = true;
          fs.appendFileSync(src, 'X');
        }
      },
    }),
    (e) => ['ESRCCHANGED', 'EVERIFY'].includes(e.code)
  );
  assert.ok(exists(src));
  assert.deepEqual(await fsp.readdir(other), []);
});

test('Rückgängig (Verschieben): Datei kehrt an ursprünglichen Ort zurück', async () => {
  const d = await tmpdir();
  const src = await write(path.join(d, 'src', 'a.jpg'), 'A', OLD);
  const xmp = await write(path.join(d, 'src', 'a.xmp'), 'X');
  await fsp.mkdir(path.join(d, 'dst'));
  const plan = await ops.transferGroup([src, xmp], path.join(d, 'dst'), { mode: 'move' });
  await ops.revertMoves(plan, 'move');
  assert.equal(await read(src), 'A');
  assert.equal(await read(xmp), 'X');
  assert.equal((await fsp.stat(src)).mtime.getTime(), OLD.getTime());
  assert.deepEqual(await fsp.readdir(path.join(d, 'dst')), []);
});

test('Rückgängig, wenn der alte Name inzwischen belegt ist: kein Überschreiben', async () => {
  const d = await tmpdir();
  const src = await write(path.join(d, 'src', 'a.jpg'), 'A');
  await fsp.mkdir(path.join(d, 'dst'));
  const plan = await ops.transferGroup([src], path.join(d, 'dst'), { mode: 'move' });
  await write(src, 'NEUE DATEI');
  const restored = await ops.revertMoves(plan, 'move');
  assert.equal(await read(src), 'NEUE DATEI');
  assert.equal(path.basename(restored[0].to), 'a (2).jpg');
  assert.equal(await read(restored[0].to), 'A');
});

test('Rückgängig (Kopieren): Kopie wird nur entfernt, wenn Original noch da ist', async () => {
  const d = await tmpdir();
  const src = await write(path.join(d, 'src', 'a.jpg'), 'A');
  await fsp.mkdir(path.join(d, 'dst'));
  const plan = await ops.transferGroup([src], path.join(d, 'dst'), { mode: 'copy' });
  await ops.revertMoves(plan, 'copy');
  assert.equal(exists(plan[0].to), false);
  assert.ok(exists(src));

  const plan2 = await ops.transferGroup([src], path.join(d, 'dst'), { mode: 'copy' });
  await fsp.unlink(src);
  await assert.rejects(ops.revertMoves(plan2, 'copy'), { code: 'EORIGMISSING' });
  assert.ok(exists(plan2[0].to), 'einzige verbleibende Kopie bleibt erhalten');
});

test('Rückgängig vom anderen Laufwerk zurück', { skip: !OTHER_DEVICE_BASE }, async () => {
  const d = await tmpdir();
  const other = await tmpdir(OTHER_DEVICE_BASE);
  const src = await write(path.join(d, 'a.heic'), 'HEIC', OLD);
  const mov = await write(path.join(d, 'a.mov'), 'MOV', OLD);
  const plan = await ops.transferGroup([src, mov], other, { mode: 'move' });
  await ops.revertMoves(plan, 'move');
  assert.equal(await read(src), 'HEIC');
  assert.equal(await read(mov), 'MOV');
  assert.equal((await fsp.stat(src)).mtime.getTime(), OLD.getTime());
  assert.deepEqual(await fsp.readdir(other), []);
});

test('Begleitdatei schlägt fehl -> Hauptdatei wird zurückgeholt', async () => {
  const d = await tmpdir();
  const src = await write(path.join(d, 'src', 'a.jpg'), 'A');
  const missingSidecar = path.join(d, 'src', 'a.xmp'); // existiert nicht
  await fsp.mkdir(path.join(d, 'dst'));
  await assert.rejects(ops.transferGroup([src, missingSidecar], path.join(d, 'dst'), { mode: 'move' }));
  assert.equal(await read(src), 'A');
  assert.deepEqual(await fsp.readdir(path.join(d, 'dst')), []);
});
