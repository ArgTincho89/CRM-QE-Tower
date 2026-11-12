import assert from 'node:assert/strict';
import test from 'node:test';
import { initiativeStages } from './data.js';
import { moveOpportunityToStage } from './kanban.js';
import {
  INITIATIVE_STATUS_FILTERS,
  addInitiative,
  buildOpportunityPrefill,
  filterInitiativesByStatus,
  isInitiativeCompleted,
  initiativeCountLabel,
  initiativeStatusLabel,
  isActiveInitiative,
  mapInitiativeStage,
  removeInitiative,
  scopeInitiativesToPage,
  summarizeInitiatives,
} from './initiatives.js';

test('the initiative board shows the four stages, Completada included', () => {
  assert.deepEqual(initiativeStages.map(({ label }) => label), ['Pendiente', 'En curso', 'En seguimiento', 'Completada']);
  assert.equal(initiativeStages.length, 4);
  assert.deepEqual(INITIATIVE_STATUS_FILTERS.map(({ id }) => id), ['all', 'active', 'paused', 'discarded']);
});

test('completed and archived initiatives never count as active', () => {
  const list = [
    { id: 'IN-0001', stage: 'pending' },
    { id: 'IN-0002', stage: 'completed' },
    { id: 'IN-0003', stage: 'won' },
    { id: 'IN-0004', stage: 'following', operationalStatus: 'paused' },
    { id: 'IN-0005', stage: 'completed', archivedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'IN-0006', stage: 'in_progress', archivedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'IN-0007', stage: 'prospecting', operationalStatus: 'discarded' },
  ];
  assert.equal(isInitiativeCompleted(list[1]), true);
  assert.equal(isInitiativeCompleted(list[2]), true, 'legacy won maps to completed');
  assert.equal(isInitiativeCompleted(list[0]), false);
  assert.equal(isInitiativeCompleted(undefined), false);
  assert.deepEqual(list.filter(isActiveInitiative).map((item) => item.id), ['IN-0001', 'IN-0004', 'IN-0007']);
  assert.equal(isActiveInitiative(undefined), false);
  assert.deepEqual(summarizeInitiatives(list), { active: 3, completed: 2 });
  assert.deepEqual(summarizeInitiatives([]), { active: 0, completed: 0 });
  assert.equal(initiativeCountLabel(list), '3 activas · 2 completadas');
  assert.equal(initiativeCountLabel([{ stage: 'pending' }, { stage: 'completed' }]), '1 activa · 1 completada');
});

test('legacy commercial stages map onto the four initiative stages', () => {
  assert.equal(mapInitiativeStage('prospecting'), 'pending');
  assert.equal(mapInitiativeStage('analysis'), 'in_progress');
  assert.equal(mapInitiativeStage('waiting'), 'following');
  assert.equal(mapInitiativeStage('proposal'), 'following');
  assert.equal(mapInitiativeStage('won'), 'completed');
  assert.equal(mapInitiativeStage('lost'), 'pending');
  assert.equal(mapInitiativeStage('in_progress'), 'in_progress');
  assert.equal(mapInitiativeStage(undefined), 'pending');
});

test('moving an initiative card changes only its stage', () => {
  const list = [{ id: 'IN-0001', stage: 'pending', operationalStatus: 'paused' }];
  const moved = moveOpportunityToStage(list, 'IN-0001', 'following');
  assert.equal(moved[0].stage, 'following');
  assert.equal(moved[0].operationalStatus, 'paused');
});

test('status filters narrow the same board without creating columns', () => {
  const list = [
    { id: 'IN-0001', operationalStatus: 'active' },
    { id: 'IN-0002', operationalStatus: 'paused' },
    { id: 'IN-0003', operationalStatus: 'discarded' },
    { id: 'IN-0004' },
  ];
  assert.equal(filterInitiativesByStatus(list, 'all').length, 4);
  assert.deepEqual(filterInitiativesByStatus(list, 'active').map((item) => item.id), ['IN-0001', 'IN-0004']);
  assert.deepEqual(filterInitiativesByStatus(list, 'paused').map((item) => item.id), ['IN-0002']);
  assert.deepEqual(filterInitiativesByStatus(list, 'discarded').map((item) => item.id), ['IN-0003']);
  assert.equal(initiativeStatusLabel('paused'), 'Pausada');
  assert.equal(initiativeStatusLabel(undefined), 'Activa');
});

test('cross-selling page scopes initiatives by category', () => {
  const list = [{ id: 'a', category: 'Cross-selling' }, { id: 'b', category: 'Otros' }, { id: 'c', category: 'cross_selling' }];
  assert.deepEqual(scopeInitiativesToPage(list, 'crossSelling').map((item) => item.id), ['a', 'c']);
  assert.equal(scopeInitiativesToPage(list, 'initiatives').length, 3);
});

test('create-opportunity prefill inherits client and active services, defaults origin, and links the initiative', () => {
  const clients = [{ id: 'c1', name: 'Acme' }];
  const services = [
    { id: 's1', name: 'Testing', active: true, year: 2026 },
    { id: 's2', name: 'Legacy', active: false, year: 2026 },
    { id: 's3', name: 'Other', active: true, year: 2026 },
  ];
  const prefill = buildOpportunityPrefill({ id: 'IN-0007', clientId: 'c1', serviceIds: ['s1', 's2'] }, clients, services, 2026);
  assert.equal(prefill.clientId, 'c1');
  assert.equal(prefill.account, 'Acme');
  assert.equal(prefill.initiativeId, 'IN-0007');
  assert.equal(prefill.origin, 'Iniciativa interna');
  assert.deepEqual(prefill.serviceIds, ['s1']);
  assert.deepEqual(prefill.services.map((item) => item.id), ['s1']);
  assert.equal(prefill.id, undefined);
  assert.equal('opportunityType' in prefill, false, 'the user must choose the opportunity type');
});

test('prefill works without client and falls back to initiative services', () => {
  const prefill = buildOpportunityPrefill({ id: 'IN-0008', services: [{ id: 's3' }] }, [], [{ id: 's3', active: true, year: 2026 }], 2026);
  assert.equal(prefill.clientId, '');
  assert.equal(prefill.account, '');
  assert.deepEqual(prefill.serviceIds, ['s3']);
});

test('prefill carries over only active services of the current fiscal year', () => {
  const services = [
    { id: 'old', name: 'QA Automation', active: true, year: 2025 },
    { id: 'now', name: 'QA Automation', active: true, year: 2026 },
    { id: 'off', name: 'API Testing', active: false, year: 2026 },
    { id: 'next', name: 'AI Testing', active: true, year: 2027 },
  ];
  const prefill = buildOpportunityPrefill({ id: 'IN-0009', serviceIds: ['old', 'now', 'off', 'next'] }, [], services, 2026);
  assert.deepEqual(prefill.serviceIds, ['now']);
  assert.deepEqual(buildOpportunityPrefill({ id: 'IN-0009', serviceIds: ['old'] }, [], services, 2026).serviceIds, []);
});

test('archive and restore move records between lists without duplicating them', () => {
  const active = [{ id: 'IN-0001' }, { id: 'IN-0002' }];
  const afterArchive = removeInitiative(active, 'IN-0001');
  assert.deepEqual(afterArchive.map((item) => item.id), ['IN-0002']);
  const archived = addInitiative([], { id: 'IN-0001' });
  assert.equal(archived.length, 1);
  const restored = addInitiative(afterArchive, { id: 'IN-0001', title: 'back' });
  assert.deepEqual(restored.map((item) => item.id), ['IN-0001', 'IN-0002']);
  assert.equal(addInitiative(restored, { id: 'IN-0001' }).length, 2);
  assert.equal(removeInitiative(active, 'IN-9999').length, 2);
});
