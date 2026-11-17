import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EMPTY_LABEL, countBy, planRowYear, summarizeAgreementReport, summarizeInitiativeReport, summarizePeopleReport, summarizeProjectReport, summarizeTrainingReport,
} from './categoryReports.js';

// Synthetic data only.
test('countBy keeps the given order with zeros, then other labels by count, blanks last', () => {
  const rows = countBy([{ v: 'B' }, { v: 'X' }, { v: '' }, { v: 'X' }, { v: 'Y' }, { v: ['A', 'B'] }], (item) => item.v, { order: ['A', 'B', 'C'] });
  assert.deepEqual(rows, [
    { label: 'A', count: 1 }, { label: 'B', count: 2 }, { label: 'C', count: 0 },
    { label: 'X', count: 2 }, { label: 'Y', count: 1 }, { label: EMPTY_LABEL, count: 1 },
  ]);
  assert.deepEqual(countBy([{ v: 'A' }], (item) => item.v, { order: ['A', 'B'], keepEmpty: false }), [{ label: 'A', count: 1 }]);
});

test('initiative report counts stages of non-archived ones and categories of active ones', () => {
  const summary = summarizeInitiativeReport([
    { stage: 'pending', category: 'Cross-selling', priority: 'Alta', operationalStatus: 'active' },
    { stage: 'completed', category: 'Cross-selling', priority: 'Alta' },
    { stage: 'in_progress', category: '', priority: '', operationalStatus: 'paused' },
    { stage: 'pending', archivedAt: '2026-01-01', category: 'Otros' },
  ]);
  assert.equal(summary.total, 3);
  assert.equal(summary.active, 2);
  assert.equal(summary.completed, 1);
  assert.deepEqual(summary.byStage.map((row) => [row.label, row.count]), [['Pendiente', 1], ['En curso', 1], ['En seguimiento', 0], ['Completada', 1]]);
  assert.equal(summary.byCategory.find((row) => row.label === 'Cross-selling').count, 1);
  assert.equal(summary.byCategory.at(-1).label, EMPTY_LABEL);
  assert.deepEqual(summary.byPriority.map((row) => row.count), [1, 1, 0]);
  assert.deepEqual(summary.byStatus.map((row) => [row.label, row.count]), [['Activa', 1], ['Pausada', 1], ['Descartada', 0]]);
});

test('agreement report sums active agreements per client and lists the ones ending within the horizon', () => {
  const clients = [{ id: 'c1', name: 'Cliente Uno' }];
  const summary = summarizeAgreementReport([
    { id: 'AM-2', title: 'B', clientId: 'c1', amount: 100, endDate: '2026-12-01', status: 'active' },
    { id: 'AM-1', title: 'A', clientId: 'c1', amount: 50.5, endDate: '2026-11-20', status: 'active' },
    { id: 'AM-3', title: 'C', clientId: '', amount: 0, endDate: '2027-06-01', status: 'active' },
    { id: 'AM-4', title: 'D', clientId: 'c1', amount: 999, endDate: '2026-11-30', status: 'inactive' },
    { id: 'AM-5', title: 'E', clientId: '', amount: 10, endDate: '2026-10-01', status: 'active' },
  ], clients, '2026-11-17', { horizonDays: 30 });
  assert.equal(summary.active, 4);
  assert.equal(summary.amount, 160.5);
  assert.equal(summary.expired, 1);
  assert.deepEqual(summary.byClient.map((row) => [row.client, row.count, row.amount]), [['Cliente Uno', 2, 150.5], ['Sin cliente', 2, 10]]);
  assert.deepEqual(summary.upcoming.map((row) => [row.id, row.daysLeft]), [['AM-1', 3], ['AM-2', 14]]);
});

test('people report groups talents, buckets today availability and lists assignments ending soon', () => {
  const talents = [
    { id: 't1', primaryTowerName: 'Tower A', profiles: ['Funcional'] },
    { id: 't2', towerNames: ['Tower B'], profiles: ['Funcional', 'Automatización'] },
    { id: 't3', profiles: [] },
  ];
  const assignments = [
    { id: 'a1', talentId: 't1', talentName: 'Uno', clientName: 'Cliente', percentage: 100, endDate: '2026-11-30' },
    { id: 'a2', talentId: 't2', talentName: 'Dos', towerName: 'Tower B', percentage: 60, startDate: '2026-01-01', endDate: '2027-06-30' },
    { id: 'a3', talentId: 't3', talentName: 'Tres', percentage: 50, endDate: '2026-11-01' },
  ];
  const summary = summarizePeopleReport(talents, assignments, '2026-11-17', { horizonDays: 30 });
  assert.equal(summary.total, 3);
  assert.equal(summary.available, 2);
  assert.deepEqual(summary.byTower.map((row) => [row.label, row.count]), [['Tower A', 1], ['Tower B', 1], [EMPTY_LABEL, 1]]);
  assert.deepEqual(summary.byProfile.map((row) => [row.label, row.count]), [['Funcional', 2], ['No funcional', 0], ['Automatización', 1], [EMPTY_LABEL, 1]]);
  assert.deepEqual(summary.availability.map((row) => row.count), [1, 1, 0, 1]);
  assert.deepEqual(summary.endingSoon.map((row) => [row.id, row.project, row.daysLeft]), [['a1', 'Cliente', 13]]);
});

test('training report groups plan rows by status and year with hours', () => {
  assert.equal(planRowYear({ startDate: '', plannedEndDate: '2025-03-01' }), 2025);
  assert.equal(planRowYear({}), null);
  const summary = summarizeTrainingReport([
    { status: 'Completada', startDate: '2026-02-01', estimatedHours: 10, dedicatedHours: 12.5 },
    { status: 'En curso', startDate: '2026-05-01', estimatedHours: 4, dedicatedHours: null },
    { status: 'Pendiente', plannedEndDate: '2025-12-31', estimatedHours: '', dedicatedHours: 2 },
    { status: '' },
  ]);
  assert.equal(summary.total, 4);
  assert.equal(summary.estimatedHours, 14);
  assert.equal(summary.dedicatedHours, 14.5);
  assert.deepEqual(summary.byStatus.map((row) => [row.label, row.count]), [['No iniciada', 0], ['En curso', 1], ['Completada', 1], ['Pendiente', 1], [EMPTY_LABEL, 1]]);
  assert.deepEqual(summary.byYear.map((row) => [row.label, row.rows, row.completed, row.estimatedHours]), [['2026', 2, 1, 14], ['2025', 1, 0, 0], ['Sin fecha', 1, 0, 0]]);
});

test('project report summarises the NAQ portfolio and delivery projects', () => {
  const summary = summarizeProjectReport(
    [{ projectType: 'Nuevo desarrollo', naq: 'Alto', deliveryTarget: 'Integrado' }, { projectType: 'Consultoría', naq: 'Alto', deliveryTarget: '' }, { projectType: 'Otro tipo', naq: 'Bajo' }],
    [{ status: 'En curso' }, { status: 'Cerrado' }, { status: 'En curso' }],
  );
  assert.equal(summary.applications, 3);
  assert.deepEqual(summary.byType.map((row) => [row.label, row.count]), [['Nuevo desarrollo', 1], ['Consultoría', 1], ['Otro tipo', 1]]);
  assert.deepEqual(summary.byNaq.map((row) => [row.label, row.count]), [['Bajo', 1], ['Medio', 0], ['Alto', 2]]);
  assert.deepEqual(summary.byDeliveryTarget.map((row) => [row.label, row.count]), [['Tradicional', 0], ['Integrado', 1], ['Continuo', 0], [EMPTY_LABEL, 2]]);
  assert.equal(summary.projects, 3);
  assert.equal(summary.openProjects, 2);
  assert.deepEqual(summary.byProjectStatus.map((row) => [row.label, row.count]), [['Planificado', 0], ['En curso', 2], ['En pausa', 0], ['Cerrado', 1]]);
});
