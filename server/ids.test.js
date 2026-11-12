import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { formatPrefixedId, ID_NUMBER_MAX, IdSpaceExhaustedError, isPrefixedId, nextPrefixedId, planIdRename } from './ids.js';

function memoryTable(ids) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE items (id TEXT PRIMARY KEY)');
  const insert = db.prepare('INSERT INTO items (id) VALUES (?)');
  for (const id of ids) insert.run(id);
  return db;
}

test('formatPrefixedId pads to six digits and refuses numbers outside 1..999999', () => {
  assert.equal(formatPrefixedId('OP', 1), 'OP-000001');
  assert.equal(formatPrefixedId('IN', 10000), 'IN-010000');
  assert.equal(formatPrefixedId('AM', ID_NUMBER_MAX), 'AM-999999');
  assert.throws(() => formatPrefixedId('OP', ID_NUMBER_MAX + 1), IdSpaceExhaustedError);
  assert.throws(() => formatPrefixedId('OP', 0), RangeError);
  assert.throws(() => formatPrefixedId('OP', 1.5), RangeError);
  assert.equal(isPrefixedId('OP', 'OP-000001'), true);
  assert.equal(isPrefixedId('OP', 'OP-0001'), false);
  assert.equal(isPrefixedId('OP', 'IN-000001'), false);
});

test('nextPrefixedId starts at 1, continues after the highest number and never wraps', () => {
  assert.equal(nextPrefixedId(memoryTable([]), 'items', 'OP'), 'OP-000001');
  assert.equal(nextPrefixedId(memoryTable(['OP-000004', 'OP-000002', 'IN-000090']), 'items', 'OP'), 'OP-000005');
  // The old generator wrapped at 10000; the new one keeps counting.
  assert.equal(nextPrefixedId(memoryTable(['OP-009999']), 'items', 'OP'), 'OP-010000');
  assert.equal(nextPrefixedId(memoryTable(['OP-999998']), 'items', 'OP'), 'OP-999999');
  assert.throws(() => nextPrefixedId(memoryTable(['OP-999999']), 'items', 'OP'), IdSpaceExhaustedError);
});

test('planIdRename reserves kept numbers first and appends legacy ids after the highest one', () => {
  const plan = planIdRename(
    [
      { id: 'O-0001', created_at: '2025-01-01' },
      { id: 'OP-0001', created_at: '2026-01-01' },
      { id: 'OP-000003', created_at: '2026-02-01' },
      { id: 'OP-0003', created_at: '2026-03-01' },
      { id: 'OP-0000', created_at: '2024-01-01' },
      { id: 'b-uuid', created_at: '2025-06-01' },
      { id: 'a-uuid', created_at: '2025-06-01' },
    ],
    'OP',
  );
  assert.deepEqual(Object.fromEntries(plan), {
    'OP-0001': 'OP-000001',
    'OP-0000': 'OP-000004',
    'O-0001': 'OP-000005',
    'a-uuid': 'OP-000006',
    'b-uuid': 'OP-000007',
    'OP-0003': 'OP-000008',
  });
  assert.equal(plan.has('OP-000003'), false);
  assert.equal(planIdRename([{ id: 'IN-000001', created_at: 'x' }], 'IN').size, 0);
});
