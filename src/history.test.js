import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeEvent, formatEventTime } from './history.js';

test('formatEventTime pads date and time components', () => {
  const iso = '2026-11-10T08:05:09.000Z';
  const result = formatEventTime(iso);
  // Result depends on the local timezone; just assert shape and non-empty.
  assert.match(result, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
});

test('formatEventTime returns empty string for invalid input', () => {
  assert.equal(formatEventTime('not-a-date'), '');
  assert.equal(formatEventTime(''), '');
  assert.equal(formatEventTime(undefined), '');
  assert.equal(formatEventTime(null), '');
});

test('describeEvent created', () => {
  assert.equal(describeEvent({ action: 'created', detail: {} }), 'Creó la oportunidad');
});

test('describeEvent moved with both stages', () => {
  assert.equal(
    describeEvent({ action: 'moved', detail: { from: 'prospecting', to: 'proposal' } }),
    'Movió la tarjeta de «Prospección» a «Propuesta / Oferta»',
  );
});

test('describeEvent moved missing detail degrades gracefully', () => {
  assert.equal(describeEvent({ action: 'moved', detail: {} }), 'Movió la tarjeta de etapa');
});

test('describeEvent updated lists field labels', () => {
  assert.equal(
    describeEvent({ action: 'updated', detail: { fields: ['title', 'amount'] } }),
    'Actualizó: nombre, importe estimado',
  );
});

test('describeEvent updated empty fields', () => {
  assert.equal(describeEvent({ action: 'updated', detail: { fields: [] } }), 'Actualizó la tarjeta');
});

test('describeEvent unknown action', () => {
  assert.equal(describeEvent({ action: 'archived', detail: {} }), 'Acción registrada: archived');
});

test('describeEvent malformed input never throws', () => {
  assert.equal(describeEvent(null), 'Acción registrada');
  assert.equal(describeEvent(undefined), 'Acción registrada');
  assert.equal(describeEvent({}), 'Acción registrada');
});
