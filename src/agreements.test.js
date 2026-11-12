import assert from 'node:assert/strict';
import test from 'node:test';
import { filterAgreements, matchesAgreementQuery } from './agreements.js';

const clients = [{ id: 'c1', name: 'Acme' }];
const people = [{ id: 'p1', name: 'Lucía' }];
const agreements = [
  { id: 'a1', title: 'Marco QA', registryId: 'ERP-2026/77', clientId: 'c1', ownerId: 'p1', notes: '' },
  { id: 'a2', title: 'Soporte', registryId: '', clientId: '', ownerId: '', notes: 'renovación anual' },
];

test('agreement search matches the registry id case-insensitively', () => {
  assert.deepEqual(filterAgreements(agreements, 'erp-2026', clients, people).map((item) => item.id), ['a1']);
  assert.equal(matchesAgreementQuery(agreements[1], 'ERP', clients, people), false);
});

test('agreement search also matches title, client, owner and notes, and an empty query keeps all', () => {
  assert.deepEqual(filterAgreements(agreements, 'acme', clients, people).map((item) => item.id), ['a1']);
  assert.deepEqual(filterAgreements(agreements, 'lucía', clients, people).map((item) => item.id), ['a1']);
  assert.deepEqual(filterAgreements(agreements, 'renovación', clients, people).map((item) => item.id), ['a2']);
  assert.equal(filterAgreements(agreements, '  ', clients, people).length, 2);
});
