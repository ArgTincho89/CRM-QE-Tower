import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ALL_YEARS, availableYears, computePipelineKpis, filterByYear, normalizeYearSelection, opportunityTypeBreakdown, recordYear } from './pipelineMetrics.js';

const opportunities = [
  { id: 'OP-1', createdAt: '2025-03-01T10:00:00.000Z', amount: '1.000 €', qaPercent: 50, probability: 80, opportunityType: 'tender' },
  { id: 'OP-2', createdAt: '2026-01-15T10:00:00.000Z', amount: '2.000 €', qaPercent: 25, probability: null, opportunityType: 'offer' },
  { id: 'OP-3', createdAt: '2026-06-01T10:00:00.000Z', amount: '4.000 €', qaPercent: 100, probability: 50, opportunityType: '' },
  { id: 'OP-4', createdAt: '2026-07-01T10:00:00.000Z', amount: '9.000 €', qaPercent: 100, probability: 100, opportunityType: 'staffing', archivedAt: '2026-08-01T00:00:00.000Z' },
];
const initiatives = [
  { id: 'IN-1', createdAt: '2026-02-01T00:00:00.000Z', stage: 'pending' },
  { id: 'IN-2', createdAt: '2026-02-01T00:00:00.000Z', stage: 'completed' },
  { id: 'IN-3', createdAt: '2026-02-01T00:00:00.000Z', stage: 'in_progress', archivedAt: '2026-03-01' },
  { id: 'IN-4', createdAt: '2024-02-01T00:00:00.000Z', stage: 'following' },
];
const agreements = [
  { id: 'AG-1', createdAt: '2026-05-01T00:00:00.000Z', status: 'active' },
  { id: 'AG-2', createdAt: '2025-05-01T00:00:00.000Z', status: 'active' },
  { id: 'AG-3', createdAt: '2026-05-01T00:00:00.000Z', status: 'inactive' },
];
const clients = [
  { id: 'CL-1', createdAt: '2026-01-01T00:00:00.000Z', active: true },
  { id: 'CL-2', createdAt: '2025-01-01T00:00:00.000Z', active: true },
  { id: 'CL-3', createdAt: '2026-01-01T00:00:00.000Z', active: false },
];

describe('year helpers', () => {
  test('recordYear reads createdAt or created_at and ignores missing or invalid dates', () => {
    assert.equal(recordYear({ createdAt: '2026-12-31T23:59:59.000Z' }), 2026);
    assert.equal(recordYear({ created_at: '2024-01-01 08:00:00' }), 2024);
    assert.equal(recordYear({}), null);
    assert.equal(recordYear({ createdAt: 'yesterday' }), null);
    assert.equal(recordYear(null), null);
  });

  test('normalizeYearSelection accepts years and "all", rejects anything else', () => {
    assert.equal(normalizeYearSelection('2026'), 2026);
    assert.equal(normalizeYearSelection(2025), 2025);
    assert.equal(normalizeYearSelection(ALL_YEARS), ALL_YEARS);
    assert.equal(normalizeYearSelection('abc'), null);
    assert.equal(normalizeYearSelection(null), null);
  });

  test('filterByYear keeps records created in the year; "all" keeps everything', () => {
    const list = [...opportunities, { id: 'OP-X' }];
    assert.deepEqual(filterByYear(list, 2026).map((item) => item.id), ['OP-2', 'OP-3', 'OP-4']);
    assert.equal(filterByYear(list, ALL_YEARS).length, 5);
    assert.deepEqual(filterByYear(undefined, 2026), []);
  });

  test('availableYears lists data years, the current year and the selected year, newest first', () => {
    assert.deepEqual(availableYears([opportunities, initiatives], 2027), [2027, 2026, 2025, 2024]);
    assert.deepEqual(availableYears([[]], 2026, 2019), [2026, 2019]);
    assert.deepEqual(availableYears([opportunities], 2026, ALL_YEARS), [2026, 2025]);
  });
});

describe('CRM QE KPIs per year', () => {
  test('every card metric uses only records created in the selected year', () => {
    const kpis = computePipelineKpis({ opportunities, initiatives, agreements, clients }, 2026);
    assert.equal(kpis.activeClients, 1);
    assert.equal(kpis.activeInitiatives, 1);
    assert.equal(kpis.opportunities, 2);
    assert.equal(kpis.activeAgreements, 1);
    assert.equal(kpis.pipelineQe, 2000 * 0.25 + 4000);
    assert.equal(kpis.weightedPipeline, 2000);
  });

  test('"all" covers every year but still ignores archived opportunities and inactive records', () => {
    const kpis = computePipelineKpis({ opportunities, initiatives, agreements, clients }, ALL_YEARS);
    assert.equal(kpis.activeClients, 2);
    assert.equal(kpis.activeInitiatives, 2);
    assert.equal(kpis.opportunities, 3);
    assert.equal(kpis.activeAgreements, 2);
    assert.equal(kpis.pipelineQe, 500 + 500 + 4000);
    assert.equal(kpis.weightedPipeline, 400 + 2000);
  });

  test('a year without weighted opportunities reports null', () => {
    const kpis = computePipelineKpis({ opportunities }, 2024);
    assert.equal(kpis.opportunities, 0);
    assert.equal(kpis.pipelineQe, 0);
    assert.equal(kpis.weightedPipeline, null);
  });

  test('the opportunity type breakdown follows the year filter', () => {
    const kpis = computePipelineKpis({ opportunities }, 2026);
    assert.deepEqual(kpis.opportunityTypes.map(({ label, count }) => [label, count]), [['Pliego', 0], ['Oferta', 1], ['Staffing', 0], ['Sin tipo', 1]]);
  });

  test('opportunityTypeBreakdown counts unknown and missing types as "Sin tipo"', () => {
    const breakdown = opportunityTypeBreakdown([{ opportunityType: 'tender' }, { opportunityType: 'legacy' }, {}]);
    assert.deepEqual(breakdown.map(({ id, count }) => [id, count]), [['tender', 1], ['offer', 0], ['staffing', 0], ['none', 2]]);
    assert.equal(opportunityTypeBreakdown(undefined).reduce((sum, item) => sum + item.count, 0), 0);
  });
});
