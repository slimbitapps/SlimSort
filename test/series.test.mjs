import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSeries, rankSeries, hamming, MOTIF_DIST } from '../src/series.ts';

const img = (id, t, hash) => ({ id, t, kind: 'image', hash });
const H = (n) => [n >>> 0, 0];

test('Serien nach Zeitabstand', () => {
  const items = [img(1, 0), img(2, 400), img(3, 900), img(4, 20000), img(5, 20500), img(6, 90000)];
  assert.deepEqual(computeSeries(items, 3000, 18), [[1, 2, 3], [4, 5]]);
  assert.deepEqual(computeSeries(items, 300, 18), []);
  assert.deepEqual(computeSeries(items, 100000, 18), [[1, 2, 3, 4, 5, 6]]);
});

test('Videos gehören nie zu einer Serie', () => {
  const items = [img(1, 0), { id: 2, t: 100, kind: 'video' }, img(3, 200)];
  assert.deepEqual(computeSeries(items, 3000, 18), [[1, 3]]);
});

test('Anderes Motiv trennt die Serie', () => {
  const a = H(0b1111);
  const b = [0xffffffff, 0xffffffff]; // komplett anders
  const items = [img(1, 0, a), img(2, 300, a), img(3, 600, b), img(4, 900, b)];
  assert.deepEqual(computeSeries(items, 3000, MOTIF_DIST.normal), [[1, 2], [3, 4]]);
});

test('Hamming-Abstand', () => {
  assert.equal(hamming([0, 0], [0, 0]), 0);
  assert.equal(hamming([0xffffffff, 0], [0, 0]), 32);
  assert.equal(hamming([1, 1], [0, 0]), 2);
});

test('Bestes Foto: schärfstes, ein Ausreißer-Motiv wird nie vorgeschlagen', () => {
  const data = {
    1: { hash: H(0), sharp: 10, expo: 0.9 },
    2: { hash: H(1), sharp: 40, expo: 0.8 },
    3: { hash: H(3), sharp: 35, expo: 0.9 },
    4: { hash: [0xffffffff, 0xffffffff], sharp: 99, expo: 1 },
  };
  const r = rankSeries([1, 2, 3, 4], (id) => data[id], MOTIF_DIST.normal);
  assert.equal(r.best, 2);
  assert.equal(r.sharpest, 4);
  assert.ok(r.different.has(4));
  assert.ok(r.complete);
});
