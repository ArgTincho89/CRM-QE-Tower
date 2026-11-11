import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createDefaultAdvancedFilters, filterPipelineCards } from './pipelineFilters.js';

const records = [
  {
    id: 'OP-0001', entityType: 'opportunity', account: 'Acme', clientId: 'client-1',
    amount: '1.000 €', qaPercent: 70, number: 'EXT-7', due: '2026-06-15',
    tags: ['priority', 'qe'], closureReason: '', createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-02-10T00:00:00.000Z', bidManagerId: 'person-1',
  },
  {
    id: 'IN-0001', entityType: 'initiative', category: 'cross_selling', status: 'open',
    account: 'Acme', clientId: 'client-1', amount: '2500', qaPercent: 40,
    closureReason: '', createdAt: '2026-01-20T00:00:00.000Z',
    updatedAt: '2026-02-20T00:00:00.000Z', bidManagerId: 'person-1',
  },
];

describe('mixed pipeline advanced filters', () => {
  test('matches shared criteria across entity types and ignores absent opportunity-only fields', () => {
    const filters = { ...createDefaultAdvancedFilters(), account: 'acme', minAmount: '900', due: '2026-06', tags: 'priority' };
    assert.deepEqual(filterPipelineCards(records, filters).map((item) => item.id), ['OP-0001', 'IN-0001']);
  });

  test('category and status criteria intentionally limit results to matching initiatives', () => {
    const category = { ...createDefaultAdvancedFilters(), category: 'cross_selling' };
    const status = { ...createDefaultAdvancedFilters(), status: 'open' };
    assert.deepEqual(filterPipelineCards(records, category).map((item) => item.id), ['IN-0001']);
    assert.deepEqual(filterPipelineCards(records, status).map((item) => item.id), ['IN-0001']);
  });

  test('filters amount, QA percentage, linked Bid Manager, and inclusive ISO date ranges', () => {
    const filters = {
      ...createDefaultAdvancedFilters(), minAmount: '2000', minQaPercent: '35',
      bidManagerId: 'person-1', createdFrom: '2026-01-20', updatedTo: '2026-02-20',
    };
    assert.deepEqual(filterPipelineCards(records, filters).map((item) => item.id), ['IN-0001']);
  });

  test('entity type and opportunity external number filters are independently applied', () => {
    const type = { ...createDefaultAdvancedFilters(), entityType: 'opportunity' };
    const number = { ...createDefaultAdvancedFilters(), externalNumber: 'EXT-7' };
    assert.deepEqual(filterPipelineCards(records, type).map((item) => item.id), ['OP-0001']);
    assert.deepEqual(filterPipelineCards(records, number).map((item) => item.id), ['OP-0001', 'IN-0001']);
  });
});
