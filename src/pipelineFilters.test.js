import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ASSIGNED_TO_ME_FILTER, MISSING_OPPORTUNITY_TYPE_FILTER, UNASSIGNED_FILTER, createDefaultAdvancedFilters, filterPipelineCards, matchesAssignee,
} from './pipelineFilters.js';

const records = [
  {
    id: 'OP-0001', account: 'Acme', clientId: 'client-1',
    amount: '1.000 €', qaPercent: 70, number: 'EXT-7', due: '2026-06-15',
    tags: ['priority', 'qe'], closureReason: '', createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-02-10T00:00:00.000Z', bidManagerId: 'person-1', opportunityType: 'tender',
    services: [{ id: 'svc-1' }, { id: 'svc-2' }], lobs: [{ id: 'lob-1' }], towers: [{ id: 'tw-1' }],
  },
  {
    id: 'OP-0002', account: 'Acme', clientId: 'client-1', amount: '2500', qaPercent: 40,
    number: 'EXT-9', closureReason: '', createdAt: '2026-01-20T00:00:00.000Z',
    updatedAt: '2026-02-20T00:00:00.000Z', bidManagerId: 'person-1', opportunityType: 'staffing',
    services: [{ id: 'svc-2' }], lobs: [], towers: [{ id: 'tw-1' }, { id: 'tw-2' }],
  },
  { id: 'OP-0003', account: 'Beta', amount: '10', qaPercent: 0 },
];
const ids = (filters) => filterPipelineCards(records, { ...createDefaultAdvancedFilters(), ...filters }).map((item) => item.id);

describe('pipeline advanced filters', () => {
  test('defaults match every opportunity, including those without relation arrays', () => {
    assert.deepEqual(ids({}), ['OP-0001', 'OP-0002', 'OP-0003']);
  });

  test('default filters no longer expose initiative-only criteria', () => {
    const defaults = createDefaultAdvancedFilters();
    for (const key of ['entityType', 'category', 'status']) assert.equal(key in defaults, false);
  });

  test('service, LoB and tower filters match many-to-many relations independently', () => {
    assert.deepEqual(ids({ serviceId: 'svc-2' }), ['OP-0001', 'OP-0002']);
    assert.deepEqual(ids({ serviceId: 'svc-1' }), ['OP-0001']);
    assert.deepEqual(ids({ towerId: 'tw-2' }), ['OP-0002']);
    assert.deepEqual(ids({ lobId: 'lob-1' }), ['OP-0001']);
    assert.deepEqual(ids({ towerId: 'tw-1', lobId: 'lob-1' }), ['OP-0001']);
  });

  test('selecting a tower never infers a LoB', () => {
    assert.deepEqual(ids({ towerId: 'tw-1', lobId: 'lob-9' }), []);
  });

  test('matches shared criteria such as account, minimum amount, and tags', () => {
    assert.deepEqual(ids({ account: 'acme', minAmount: '900', tags: 'priority' }), ['OP-0001']);
  });

  test('filters amount, QA percentage, linked Bid Manager, and inclusive ISO date ranges', () => {
    assert.deepEqual(ids({ minAmount: '2000', minQaPercent: '35', bidManagerId: 'person-1', createdFrom: '2026-01-20', updatedTo: '2026-02-20' }), ['OP-0002']);
  });

  test('opportunity external number filter applies', () => {
    assert.deepEqual(ids({ externalNumber: 'EXT-7' }), ['OP-0001']);
  });

  test('type filter matches a single type, or legacy records without a type', () => {
    assert.equal(createDefaultAdvancedFilters().opportunityType, 'all');
    assert.deepEqual(ids({ opportunityType: 'tender' }), ['OP-0001']);
    assert.deepEqual(ids({ opportunityType: 'staffing' }), ['OP-0002']);
    assert.deepEqual(ids({ opportunityType: 'offer' }), []);
    assert.deepEqual(ids({ opportunityType: MISSING_OPPORTUNITY_TYPE_FILTER }), ['OP-0003']);
  });

  test('assignee filter matches all, unassigned, a concrete user, or the current user', () => {
    const cards = [
      { id: 'OP-A', assignedUserId: 'user-1' },
      { id: 'OP-B', assignedUserId: 'user-2' },
      { id: 'OP-C', assignedUserId: '' },
      { id: 'OP-D' },
    ];
    const pick = (assignedUserId, currentUserId) => filterPipelineCards(cards, { ...createDefaultAdvancedFilters(), assignedUserId }, { currentUserId }).map((item) => item.id);
    assert.equal(createDefaultAdvancedFilters().assignedUserId, 'all');
    assert.deepEqual(pick('all'), ['OP-A', 'OP-B', 'OP-C', 'OP-D']);
    assert.deepEqual(pick(UNASSIGNED_FILTER), ['OP-C', 'OP-D']);
    assert.deepEqual(pick('user-2'), ['OP-B']);
    assert.deepEqual(pick(ASSIGNED_TO_ME_FILTER, 'user-1'), ['OP-A']);
    assert.deepEqual(pick(ASSIGNED_TO_ME_FILTER, ''), []);
    assert.equal(matchesAssignee(cards[0], undefined), true);
  });
});
