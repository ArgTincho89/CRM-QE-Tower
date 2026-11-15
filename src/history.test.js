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
    'Movió la tarjeta de «Prospección» a «Propuesta / Pliego»',
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

test('describeEvent labels the ICRM, next action date and relation fields', () => {
  assert.equal(
    describeEvent({ action: 'updated', detail: { fields: ['registry_id', 'next_action_date', 'lobs', 'towers'] } }),
    'Actualizó: ICRM, fecha de próxima acción, LoB, towers',
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

test('describeEvent labels the opportunity date, classification and value fields', () => {
  assert.equal(
    describeEvent({ action: 'updated', detail: { fields: ['resolution_date', 'delivery_deadline', 'start_date', 'end_date', 'next_milestone_date'] } }),
    'Actualizó: fecha resolución, fecha límite de entrega, fecha inicio, fecha fin, fecha próximo hito',
  );
  assert.equal(
    describeEvent({ action: 'updated', detail: { fields: ['ai_score', 'reusable', 'reusable_reason', 'market_scope', 'contract_type', 'service_type', 'added_value', 'services_added_value'] } }),
    'Actualizó: scoring calificación IA, reutilizable, motivo de reutilización, ámbito, tipo de contrato, tipo de servicio, valor añadido, VA servicios',
  );
  // Older entries still name the retired close date.
  assert.equal(describeEvent({ action: 'updated', detail: { fields: ['expected_close_date'] } }), 'Actualizó: fecha estimada de cierre');
});
