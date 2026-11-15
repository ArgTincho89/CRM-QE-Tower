import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ASSIGNED_TO_ME_FILTER, MISSING_OPPORTUNITY_TYPE_FILTER, MISSING_OPTION_FILTER, NOT_REUSABLE_FILTER, OPEN_OUTCOME_FILTER, REUSABLE_FILTER, UNASSIGNED_FILTER, createDefaultAdvancedFilters, filterPipelineCards, filterPipelineToolbar, matchesAssignee, matchesOptionFilter, matchesOutcome, matchesReusable,
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

describe('pipeline toolbar filters', () => {
  const records = [
    { id: 'OP-000001', title: 'Migración', account: 'Acme', owner: 'Ana', tower: 'Testing', stage: 'proposal', registryId: 'ICRM-9', tags: ['sap'] },
    { id: 'OP-000002', title: 'Auditoría', account: 'Globex', owner: 'Luis', tower: 'Performance', stage: 'result', closureReason: 'Precio' },
  ];

  test('search covers ids, registry id, tags and closure reason', () => {
    assert.deepEqual(filterPipelineToolbar(records, { query: 'icrm-9' }).map((item) => item.id), ['OP-000001']);
    assert.deepEqual(filterPipelineToolbar(records, { query: 'SAP' }).map((item) => item.id), ['OP-000001']);
    assert.deepEqual(filterPipelineToolbar(records, { query: 'precio' }).map((item) => item.id), ['OP-000002']);
  });

  test('opportunities without a client are found as "Sin cliente"', () => {
    const withStaffing = [...records, { id: 'OP-000003', title: 'Perfil QA', account: '', owner: 'Ana', tower: '', stage: 'prospecting', opportunityType: 'staffing' }];
    assert.deepEqual(filterPipelineToolbar(withStaffing, { query: 'sin cliente' }).map((item) => item.id), ['OP-000003']);
    const advanced = filterPipelineCards(withStaffing, { ...createDefaultAdvancedFilters(), account: 'sin cliente' });
    assert.deepEqual(advanced.map((item) => item.id), ['OP-000003']);
  });

  test('the ICRM advanced filter matches the registry id', () => {
    assert.equal(createDefaultAdvancedFilters().registryId, '');
    assert.deepEqual(filterPipelineCards(records, { ...createDefaultAdvancedFilters(), registryId: 'icrm-9' }).map((item) => item.id), ['OP-000001']);
  });

  test('stage, tower and owner selects combine with the search', () => {
    assert.deepEqual(filterPipelineToolbar(records, { stage: 'result' }).map((item) => item.id), ['OP-000002']);
    assert.deepEqual(filterPipelineToolbar(records, { tower: 'Testing', owner: 'Luis' }), []);
    assert.equal(filterPipelineToolbar(records).length, 2);
    assert.deepEqual(filterPipelineToolbar(undefined), []);
  });
});

describe('outcome and resolution-date filters', () => {
  const closed = [
    { id: 'OP-1', outcome: 'won', resolutionDate: '2026-03-10' },
    { id: 'OP-2', outcome: 'lost', resolutionDate: '2026-04-02' },
    { id: 'OP-3', outcome: '', resolutionDate: '' },
    { id: 'OP-4', outcome: 'discarded', resolutionDate: '2026-03-31' },
  ];
  const pick = (filters) => filterPipelineCards(closed, { ...createDefaultAdvancedFilters(), ...filters }).map((item) => item.id);

  test('defaults keep every outcome and ignore missing resolution dates', () => {
    assert.equal(createDefaultAdvancedFilters().outcome, 'all');
    assert.deepEqual(pick({}), ['OP-1', 'OP-2', 'OP-3', 'OP-4']);
  });

  test('the Resultado filter selects one outcome or the open opportunities', () => {
    assert.deepEqual(pick({ outcome: 'won' }), ['OP-1']);
    assert.deepEqual(pick({ outcome: 'discarded' }), ['OP-4']);
    assert.deepEqual(pick({ outcome: OPEN_OUTCOME_FILTER }), ['OP-3']);
    assert.equal(matchesOutcome({ outcome: 'won' }, undefined), true);
  });

  test('a resolution-date range is inclusive and skips opportunities without a resolution date', () => {
    assert.deepEqual(pick({ resolutionFrom: '2026-03-01', resolutionTo: '2026-03-31' }), ['OP-1', 'OP-4']);
    assert.deepEqual(pick({ resolutionFrom: '2026-04-01' }), ['OP-2']);
    assert.deepEqual(pick({ outcome: 'won', resolutionFrom: '2026-04-01' }), []);
  });
});

describe('classification and reuse filters', () => {
  const classified = [
    { id: 'OP-1', marketScope: 'large', contractType: 'rfp', serviceType: 'am_service', reusable: true },
    { id: 'OP-2', marketScope: 'midmarket', contractType: 'sda', serviceType: 'licenses', reusable: false },
    { id: 'OP-3', marketScope: '', contractType: '', serviceType: '' },
  ];
  const pick = (filters) => filterPipelineCards(classified, { ...createDefaultAdvancedFilters(), ...filters }).map((item) => item.id);

  test('defaults keep every opportunity', () => {
    const defaults = createDefaultAdvancedFilters();
    assert.deepEqual([defaults.marketScope, defaults.contractType, defaults.serviceType, defaults.reusable], ['all', 'all', 'all', 'all']);
    assert.deepEqual(pick({}), ['OP-1', 'OP-2', 'OP-3']);
  });

  test('Ámbito, Tipo de contrato and Tipo de servicio match one id or the unset ones', () => {
    assert.deepEqual(pick({ marketScope: 'large' }), ['OP-1']);
    assert.deepEqual(pick({ contractType: 'sda' }), ['OP-2']);
    assert.deepEqual(pick({ serviceType: MISSING_OPTION_FILTER }), ['OP-3']);
    assert.deepEqual(pick({ marketScope: 'large', contractType: 'sda' }), []);
    assert.equal(matchesOptionFilter('rfp', undefined), true);
  });

  test('Reutilizable matches yes or no; records without the flag are not reusable', () => {
    assert.deepEqual(pick({ reusable: REUSABLE_FILTER }), ['OP-1']);
    assert.deepEqual(pick({ reusable: NOT_REUSABLE_FILTER }), ['OP-2', 'OP-3']);
    assert.equal(matchesReusable({ reusable: true }, 'all'), true);
  });
});
