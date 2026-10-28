import test from 'node:test';
import assert from 'node:assert/strict';
import { parseToolCall, cleanAnswer } from '../src/llmtext.ts';

test('Werkzeug-Aufrufe lesen (auch ungenaue Formen)', () => {
  const a = parseToolCall('<tool_call>\n{"name": "merken", "arguments": {"text": "Fotos mit Autos in Autos"}}\n');
  assert.deepEqual([a.name, a.args.text], ['merken', 'Fotos mit Autos in Autos']);
  // so schreibt es das kleine Modell
  const b = parseToolCall('<tool>\n{"name": "personen_benennen", "arguments": {"zuordnung": [{"gesicht": 1, "name": "Mama"}]}}\n</tool>');
  assert.equal(b.name, 'personen_benennen');
  assert.equal(b.args.zuordnung[0].name, 'Mama');
  // Argumente als Text, fehlende Klammer am Ende
  const c = parseToolCall('<tool_call>{"name": "fotos_suchen", "arguments": "{\\"beschreibung\\": \\"Strand\\"}"');
  assert.deepEqual([c.name, c.args.beschreibung], ['fotos_suchen', 'Strand']);
  assert.equal(parseToolCall('Hallo! Wie kann ich helfen?'), null);
  assert.equal(parseToolCall('<tool_call>kaputt'), null);
});

test('Antwort säubern', () => {
  assert.equal(cleanAnswer('<lage>Ja, deine Mutter ist auf dem Bild.</lage>'), 'Ja, deine Mutter ist auf dem Bild.');
  assert.equal(cleanAnswer('<tool_call>\n{"name": "x"'), '');
  assert.equal(cleanAnswer('Moment <tool'), 'Moment ');
  assert.equal(cleanAnswer('<think>\n\n</think>\n\nHallo'), 'Hallo');
});
