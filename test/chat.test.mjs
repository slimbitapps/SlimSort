import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, extractDate, cleanQuery, matchesDate, findTarget } from '../src/chat.ts';

test('Bildsuche: Füllwörter weg, Beschreibung bleibt', () => {
  const r = parse('Suche mir das Foto wo links ein Baum ist, eine Wiese und ein Berg');
  assert.equal(r.kind, 'search');
  assert.equal(r.query, 'links ein Baum ist, eine Wiese und ein Berg');
  assert.equal(parse('Hund am Strand').query, 'Hund am Strand');
  assert.equal(parse('find photos of a red car').query, 'a red car');
  assert.equal(cleanQuery('Zeig mir alle Bilder mit Katzen'), 'Katzen');
});

test('Datum: Jahr, Monat, Jahreszeit, relativ', () => {
  const now = new Date(2026, 9, 27, 12).getTime();
  const a = extractDate('Strand im Sommer 2023', now);
  assert.deepEqual(a.date, { years: [2023], months: [5, 6, 7] });
  assert.equal(a.rest, 'Strand');
  const b = extractDate('Fotos von gestern', now);
  assert.equal(b.date.to - b.date.from, 86400000);
  assert.deepEqual(extractDate('2019 bis 2021', now).date, { years: [2019, 2020, 2021] });
  assert.deepEqual(extractDate('im Juli', now).date, { months: [6] });
  assert.ok(matchesDate(new Date(2023, 6, 10).getTime(), { years: [2023], months: [5, 6, 7] }));
  assert.ok(!matchesDate(new Date(2022, 6, 10).getTime(), { years: [2023] }));
  const s = parse('Strand im Sommer 2023');
  assert.equal(s.kind, 'search');
  assert.equal(s.query, 'Strand');
  assert.deepEqual(s.date.years, [2023]);
  assert.equal(parse('Fotos aus 2022').query, '');
  assert.equal(parse('Videos aus 2022').video, true);
});

test('Verschieben: Bezug oder Beschreibung', () => {
  const a = parse('verschiebe sie nach Urlaub');
  assert.deepEqual([a.kind, a.target, a.ref, a.query], ['move', 'Urlaub', 'results', undefined]);
  const b = parse('Pack alle Strandfotos in den Ordner "Urlaub 2023"');
  assert.equal(b.kind, 'move');
  assert.equal(b.target, 'Urlaub 2023');
  assert.equal(b.query, 'Strandfotos');
  const c = parse('move the selected photos to Family');
  assert.deepEqual([c.kind, c.target, c.ref], ['move', 'Family', 'selection']);
  const d = parse('verschiebe dieses Foto nach Familie');
  assert.equal(d.ref, 'current');
});

test('Löschen, Befehle', () => {
  assert.deepEqual(parse('lösche sie'), { kind: 'delete', ref: 'results', query: undefined, date: undefined, video: undefined });
  const d = parse('lösche alle unscharfen Fotos');
  assert.equal(d.kind, 'delete');
  assert.equal(d.query, 'unscharfen Fotos');
  assert.equal(parse('Sortiere automatisch').kind, 'autosort');
  assert.equal(parse('sort everything for me').kind, 'autosort');
  assert.equal(parse('finde Doppelte').kind, 'dupes');
  assert.equal(parse('ähnliche wie dieses').kind, 'similar');
  assert.equal(parse('wie viele sind noch übrig?').kind, 'stats');
  assert.equal(parse('Hilfe').kind, 'help');
  assert.equal(parse('hallo').kind, 'greet');
  assert.equal(parse('danke!').kind, 'thanks');
  assert.equal(parse('alle wieder zeigen').kind, 'reset');
  assert.equal(parse('wähle sie aus').kind, 'select');
  assert.equal(parse('dunkler Modus').kind, 'theme');
  assert.equal(parse('rückgängig').kind, 'undo');
});

test('Zielordner ungefähr finden', () => {
  const ts = [{ name: 'Familie' }, { name: 'Urlaub 2023' }, { name: 'Screenshots' }];
  assert.equal(findTarget(ts, 'familie')?.name, 'Familie');
  assert.equal(findTarget(ts, 'Urlaub')?.name, 'Urlaub 2023');
  assert.equal(findTarget(ts, 'screens')?.name, 'Screenshots');
  assert.equal(findTarget(ts, 'Arbeit'), undefined);
});
