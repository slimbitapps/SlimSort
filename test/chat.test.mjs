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

test('Gedächtnis: merken, vergessen, auflisten', async () => {
  const { parse } = await import('../src/chat.ts');
  const a = parse('Merke dir, dass Fotos mit Autos immer in den Ordner Fahrzeuge sollen');
  assert.deepEqual([a.kind, a.concept, a.folder], ['remember', 'Autos', 'Fahrzeuge']);
  const b = parse('Merke dir: Fotos von Screenshots sollen in den Ordner "Handy Kram" kommen');
  assert.deepEqual([b.concept, b.folder], ['Screenshots', 'Handy Kram']);
  const c = parse('Merke dir, dass die vier Personen auf diesem Foto meine Familie sind');
  assert.equal(c.faces.label, 'Familie');
  assert.equal(c.faces.ref, 'current');
  const c2 = parse('Merk dir: die Personen auf den markierten Fotos sind meine Familie und sollen in den Ordner Familie');
  assert.deepEqual([c2.faces.label, c2.faces.folder, c2.faces.ref], ['Familie', 'Familie', 'selection']);
  const d = parse('merke dir, mein Hund heißt Bello');
  assert.deepEqual([d.kind, d.concept, d.faces], ['remember', undefined, undefined]);
  assert.equal(parse('Was hast du dir gemerkt?').kind, 'memories');
  assert.deepEqual(parse('Vergiss das mit den Autos'), { kind: 'forget', text: 'Autos', all: false });
  assert.equal(parse('Das soll jetzt nicht mehr so sein').kind, 'forget');
  assert.equal(parse('vergiss alles').all, true);
});

test('Einstellungen und Ordner per Chat', async () => {
  const { parse } = await import('../src/chat.ts');
  assert.equal(parse('Schalte den Autopiloten an').kind, 'setting');
  assert.equal(parse('stell die Sprache auf Englisch').kind, 'setting');
  assert.equal(parse('Mach das Design hell').kind, 'setting');
  assert.equal(parse('Mach ein Foto vom Hund').kind, 'search');
  assert.deepEqual(parse('Lege einen Ordner namens Urlaub 2025 an'), { kind: 'mkfolder', name: 'Urlaub 2025' });
  assert.equal(parse('verschiebe sie nach Urlaub').kind, 'move');
});

test('Personen benennen: Positionen und Namen', async () => {
  const { parseNaming, resolveNaming } = await import('../src/chat.ts');
  // genau der Satz aus der Praxis (ohne Komma zwischen den ersten beiden Teilen)
  const a = parse('merke dir diese Personen, ich bin ganz links mein Bruder ist daneben und meine Mutter ist ganz rechts');
  assert.equal(a.kind, 'name');
  assert.deepEqual(resolveNaming(a.items, 3), ['ich', 'mein Bruder', 'meine Mutter']);
  assert.deepEqual(resolveNaming(a.items, 4), ['ich', 'mein Bruder', null, 'meine Mutter']);
  assert.deepEqual(resolveNaming(parseNaming('Ich bin links, in der Mitte ist mein Bruder und rechts meine Mutter'), 3), ['Ich', 'mein Bruder', 'meine Mutter']);
  assert.deepEqual(resolveNaming(parseNaming('von links nach rechts: Lisa, Tom und Max'), 3), ['Lisa', 'Tom', 'Max']);
  assert.deepEqual(resolveNaming(parseNaming('ganz rechts steht mein Opa, links daneben meine Oma'), 2), ['meine Oma', 'mein Opa']);
  assert.deepEqual(resolveNaming(parseNaming('die zweite von links ist Anna'), 3), [null, 'Anna', null]);
  assert.deepEqual(resolveNaming(parseNaming('Das bin ich'), 1), ['ich']);
  assert.equal(resolveNaming(parseNaming('Das bin ich'), 2), null, 'bei zwei Gesichtern unklar');
  assert.equal(resolveNaming(parseNaming('Links ist Mama und rechts bin ich'), 1), null, 'zwei Namen, ein Gesicht');
  assert.equal(parse('Das ist schön').kind, 'search');
  assert.equal(parse('Das ist ein Hund').kind, 'search');
  assert.notEqual(parse('Lösche das Foto links').kind, 'name');
  assert.equal(parse('Hund am Strand').kind, 'search');
});

test('Personen: wer ist das, unbekannte, verwalten', () => {
  assert.equal(parse('Erkennst du die Personen wieder?').kind, 'whois');
  assert.equal(parse('Wer ist auf diesem Foto?').kind, 'whois');
  assert.equal(parse('Wer ist links?').kind, 'whois');
  assert.equal(parse('Welche Personen kennst du?').kind, 'people');
  assert.equal(parse('Wer sind die unbekannten Personen?').kind, 'unknownFaces');
  const r = parse('Fotos mit meinem Bruder kommen in den Ordner Lukas');
  assert.deepEqual([r.kind, r.concept, r.folder], ['remember', 'meinem Bruder', 'Lukas']);
});
