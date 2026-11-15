import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildMonthlyReport, buildYearAggregates, ensureMonthlyReports, getMonthlyReport, initiativeActivityByPeriod, isValidPeriod,
  listMonthlyReports, opportunityCloseDate, periodBounds, periodLabel, periodOf, periodRange, shiftPeriod,
} from './reports.js';
import { createTempDatabase } from './testing.js';

function opportunity(overrides) {
  return {
    title: 'Oportunidad', amount: '1.000', qa_percent: 50, probability: null, stage: 'proposal', outcome: '',
    expected_close_date: '', opportunity_type: 'offer', created_at: '2026-03-05T10:00:00.000Z',
    updated_at: '2026-03-05T10:00:00.000Z', archived_at: null, client_name: 'Acme', ...overrides,
  };
}

function initiative(overrides) {
  return { title: 'Iniciativa', stage: 'pending', created_at: '2026-01-10T10:00:00.000Z', archived_at: null, ...overrides };
}

/** Fixture spanning February to April 2026. */
function dataset() {
  return {
    opportunities: [
      opportunity({ id: 'OP-1', opportunity_type: 'tender', amount: '10.000', qa_percent: 40, probability: 50, created_at: '2026-03-01T00:00:00.000Z', client_name: 'Beta' }),
      opportunity({ id: 'OP-2', opportunity_type: 'staffing', amount: '2.000', qa_percent: 100, created_at: '2026-03-31T23:59:59.000Z', client_name: null }),
      opportunity({ id: 'OP-3', opportunity_type: null, created_at: '2026-03-15T00:00:00.000Z' }),
      // Created in February, won in March.
      opportunity({ id: 'OP-4', amount: '5.000', qa_percent: 20, created_at: '2026-02-10T00:00:00.000Z', stage: 'result', outcome: 'won', expected_close_date: '2026-03-20' }),
      opportunity({ id: 'OP-5', created_at: '2026-02-11T00:00:00.000Z', stage: 'result', outcome: 'lost', expected_close_date: '2026-04-02' }),
      // Legacy closed row without a close date: dated by its last update.
      opportunity({ id: 'OP-6', created_at: '2026-02-12T00:00:00.000Z', stage: 'result', outcome: 'discarded', expected_close_date: '', updated_at: '2026-03-03T08:00:00.000Z' }),
      opportunity({ id: 'OP-7', created_at: '2026-03-02T00:00:00.000Z', archived_at: '2026-03-03T00:00:00.000Z' }),
      opportunity({ id: 'OP-8', created_at: '2026-04-01T00:00:00.000Z' }),
    ],
    initiatives: [
      initiative({ id: 'IN-1', created_at: '2026-03-02T00:00:00.000Z' }),
      initiative({ id: 'IN-2' }),
      initiative({ id: 'IN-3' }),
      initiative({ id: 'IN-4' }),
      initiative({ id: 'IN-5', stage: 'completed' }),
      initiative({ id: 'IN-6' }),
      initiative({ id: 'IN-7', archived_at: '2026-03-01T00:00:00.000Z' }),
    ],
    agreements: [
      { id: 'AM-1', title: 'Marco 1', end_date: '2026-06-29', status: 'active', amount: 100, created_at: '2026-03-04T00:00:00.000Z', client_name: 'Acme' },
      { id: 'AM-2', title: 'Marco 2', end_date: '2026-06-30', status: 'active', amount: 0, created_at: '2026-01-04T00:00:00.000Z', client_name: null },
      { id: 'AM-3', title: 'Marco 3', end_date: '2026-03-31', status: 'active', amount: 0, created_at: '2026-01-04T00:00:00.000Z', client_name: null },
      { id: 'AM-4', title: 'Marco 4', end_date: '2026-04-15', status: 'inactive', amount: 0, created_at: '2026-01-04T00:00:00.000Z', client_name: null },
    ],
    events: [
      { entity_type: 'initiative', entity_id: 'IN-2', user_name: 'Ada', action: 'updated', detail: '{"fields":["title"]}', created_at: '2026-03-10T00:00:00.000Z' },
      { entity_type: 'initiative', entity_id: 'IN-5', user_name: 'Ada', action: 'updated', detail: '{"fields":["stage"]}', created_at: '2026-03-11T00:00:00.000Z' },
      { entity_type: 'initiative', entity_id: 'IN-7', user_name: 'Ada', action: 'archived', detail: '{}', created_at: '2026-03-01T00:00:00.000Z' },
      { entity_type: 'opportunity', entity_id: 'OP-1', user_name: 'Grace', action: 'created', detail: '{}', created_at: '2026-03-01T00:00:00.000Z' },
    ],
    comments: [{ entity_type: 'initiative', entity_id: 'IN-3', user_name: 'Grace', created_at: '2026-03-12T00:00:00.000Z' }],
    actions: [
      { entity_type: 'initiative', entity_id: 'IN-4', user_name: 'Ada', created_at: '2026-02-01T00:00:00.000Z', completed_at: '2026-03-13T00:00:00.000Z' },
      { entity_type: 'opportunity', entity_id: 'OP-2', user_name: 'Grace', created_at: '2026-03-14T00:00:00.000Z', completed_at: null },
    ],
    actionComments: [{ entity_type: 'initiative', entity_id: 'IN-6', user_name: 'Ada', created_at: '2026-04-01T00:00:00.000Z' }],
    assignments: [
      { user_name: 'Grace', created_at: '2026-03-01T00:00:00.000Z' },
      { user_name: 'Grace', created_at: '2026-03-09T00:00:00.000Z' },
      { user_name: 'Ada', created_at: '2026-03-09T00:00:00.000Z' },
      { user_name: 'Ada', created_at: '2026-04-09T00:00:00.000Z' },
    ],
  };
}

describe('report periods', () => {
  test('validates, shifts and bounds periods', () => {
    assert.equal(isValidPeriod('2026-03'), true);
    assert.equal(isValidPeriod('2026-13'), false);
    assert.equal(isValidPeriod('2026-3'), false);
    assert.equal(shiftPeriod('2026-01', -1), '2025-12');
    assert.equal(shiftPeriod('2026-12', 1), '2027-01');
    assert.deepEqual(periodRange('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
    assert.deepEqual(periodRange('2026-03', '2026-02'), []);
    assert.deepEqual(periodBounds('2024-02'), { start: '2024-02-01', end: '2024-02-29' });
    assert.deepEqual(periodBounds('2026-02'), { start: '2026-02-01', end: '2026-02-28' });
    assert.equal(periodLabel('2026-11'), 'Noviembre 2026');
    assert.equal(periodOf('2026-03-31T23:59:59.000Z'), '2026-03');
    assert.equal(periodOf(''), '');
  });

  test('closed opportunities are dated by the expected close date, falling back to the last update', () => {
    assert.equal(opportunityCloseDate(opportunity({ outcome: 'won', expected_close_date: '2026-03-20' })), '2026-03-20');
    assert.equal(opportunityCloseDate(opportunity({ outcome: 'lost', expected_close_date: '', updated_at: '2026-05-01T00:00:00.000Z' })), '2026-05-01');
    assert.equal(opportunityCloseDate(opportunity({ outcome: '', expected_close_date: '2026-03-20' })), '');
  });
});

describe('initiative activity', () => {
  test('creation, events, comments, actions and action comments all count as work in their month', () => {
    const activity = initiativeActivityByPeriod(dataset());
    assert.deepEqual([...activity.get('2026-03')].sort(), ['IN-1', 'IN-2', 'IN-3', 'IN-4', 'IN-5']);
    assert.deepEqual([...activity.get('2026-04')], ['IN-6']);
    assert.deepEqual([...activity.get('2026-02')], ['IN-4']);
  });

  test('archived initiatives never count', () => {
    const activity = initiativeActivityByPeriod(dataset());
    assert.equal([...activity.values()].some((ids) => ids.has('IN-7')), false);
  });
});

describe('year aggregates', () => {
  const year = buildYearAggregates(dataset(), 2026);
  const march = year.months[2];

  test('has twelve months with the opportunity type breakdown', () => {
    assert.equal(year.months.length, 12);
    assert.equal(march.period, '2026-03');
    // OP-7 is archived; OP-2 (31 March 23:59 UTC) still belongs to March.
    assert.deepEqual(march.opportunities, { total: 3, byType: { tender: 1, offer: 0, staffing: 1, none: 1 } });
    assert.equal(year.months[3].opportunities.total, 1);
  });

  test('won, lost and discarded fall in the month of their close date', () => {
    assert.deepEqual(march.won, { count: 1, amount: 5000, qeAmount: 1000 });
    assert.equal(march.discarded.count, 1);
    assert.equal(march.lost.count, 0);
    assert.equal(year.months[3].lost.count, 1);
  });

  test('Pipeline QE generated sums the QE amount of the opportunities created in the month', () => {
    // OP-1 10.000 x 40% + OP-2 2.000 x 100% + OP-3 1.000 x 50%.
    assert.equal(march.pipelineQeGenerated, 6500);
  });

  test('totals add the months and count distinct worked initiatives', () => {
    assert.equal(year.totals.opportunities.total, 7);
    assert.equal(year.totals.won.count, 1);
    assert.equal(year.totals.initiativesWorked, 6);
    assert.equal(march.initiativesWorked, 5);
  });
});

describe('monthly report', () => {
  const report = buildMonthlyReport(dataset(), '2026-03', { generatedAt: '2026-04-01T00:00:00.000Z' });

  test('names the period and how it was produced', () => {
    assert.equal(report.period, '2026-03');
    assert.equal(report.label, 'Marzo 2026');
    assert.equal(report.live, false);
    assert.equal(report.generatedAt, '2026-04-01T00:00:00.000Z');
    assert.throws(() => buildMonthlyReport(dataset(), '2026-3'), RangeError);
  });

  test('lists worked, created and completed initiatives', () => {
    assert.deepEqual(report.initiatives.worked.map((item) => item.id), ['IN-1', 'IN-2', 'IN-3', 'IN-4', 'IN-5']);
    assert.deepEqual(report.initiatives.created.map((item) => item.id), ['IN-1']);
    assert.deepEqual(report.initiatives.completed, [{ id: 'IN-5', title: 'Iniciativa', stage: 'completed', stageLabel: 'Completada' }]);
  });

  test('opportunities generated by type, with their list', () => {
    const { created } = report.opportunities;
    assert.equal(created.count, 3);
    assert.deepEqual(created.byType.map((item) => [item.id, item.count]), [['tender', 1], ['offer', 0], ['staffing', 1], ['none', 1]]);
    assert.deepEqual(created.items.map((item) => item.id), ['OP-1', 'OP-2', 'OP-3']);
    assert.equal(created.items[1].client, 'Sin cliente');
    assert.equal(created.items[2].typeLabel, 'Sin tipo');
  });

  test('results carry amounts and QE amounts', () => {
    assert.equal(report.opportunities.results.won.count, 1);
    assert.equal(report.opportunities.results.won.qeAmount, 1000);
    assert.equal(report.opportunities.results.won.items[0].id, 'OP-4');
    assert.equal(report.opportunities.results.discarded.items[0].closeDate, '2026-03-03');
    assert.equal(report.opportunities.results.lost.count, 0);
  });

  test('pipeline at month end keeps opportunities created by then and not yet closed', () => {
    // Open at 31 March: OP-1, OP-2, OP-3 and OP-5 (lost in April). OP-4 and OP-6 closed in March.
    assert.equal(report.pipeline.count, 4);
    assert.equal(report.pipeline.qeAmount, 4000 + 2000 + 500 + 500);
    assert.equal(report.pipeline.weightedAmount, 2000);
  });

  test('agreements created in the month and active ones ending within 90 days of its end', () => {
    assert.deepEqual(report.agreements.created.map((item) => item.id), ['AM-1']);
    // 31 March + 90 days = 29 June; AM-3 ends inside March and AM-4 is inactive.
    assert.deepEqual(report.agreements.endingSoon.map((item) => item.id), ['AM-1']);
  });

  test('activity, top clients and assignments per user', () => {
    assert.deepEqual(report.activity, [
      { userName: 'Ada', comments: 0, actions: 0, events: 3, total: 3 },
      { userName: 'Grace', comments: 1, actions: 1, events: 1, total: 3 },
    ]);
    assert.deepEqual(report.topClients.map((item) => [item.client, item.amount]), [['Beta', 10000], ['Sin cliente', 2000], ['Acme', 1000]]);
    assert.deepEqual(report.assignments, [{ userName: 'Grace', count: 2 }, { userName: 'Ada', count: 1 }]);
  });
});

describe('monthly snapshots', () => {
  function insertOpportunity(db, id, createdAt) {
    db.prepare(`INSERT INTO opportunities (id, title, account, amount, stage, tower, owner, due, created_at, updated_at, qa_percent)
      VALUES (?, ?, '', '1000', 'proposal', '', '', '', ?, ?, 50)`).run(id, `Oportunidad ${id}`, createdAt, createdAt);
  }

  test('an empty database stores nothing', () => {
    const temp = createTempDatabase();
    try {
      assert.deepEqual(ensureMonthlyReports(temp.db, new Date('2026-05-01T00:00:00.000Z')), []);
      assert.deepEqual(listMonthlyReports(temp.db), []);
    } finally {
      temp.cleanup();
    }
  });

  test('generates every elapsed month once, never the current one, and never rewrites a snapshot', () => {
    const temp = createTempDatabase();
    try {
      insertOpportunity(temp.db, 'OP-000001', '2026-01-15T00:00:00.000Z');
      assert.deepEqual(ensureMonthlyReports(temp.db, new Date('2026-01-31T23:00:00.000Z')), []);
      assert.deepEqual(ensureMonthlyReports(temp.db, new Date('2026-04-01T00:00:00.000Z')), ['2026-01', '2026-02', '2026-03']);
      const before = getMonthlyReport(temp.db, '2026-01');
      assert.equal(before.generatedAt, '2026-04-01T00:00:00.000Z');
      assert.equal(before.report.opportunities.created.count, 1);

      insertOpportunity(temp.db, 'OP-000002', '2026-01-20T00:00:00.000Z');
      assert.deepEqual(ensureMonthlyReports(temp.db, new Date('2026-04-02T00:00:00.000Z')), []);
      assert.deepEqual(getMonthlyReport(temp.db, '2026-01'), before);

      assert.deepEqual(ensureMonthlyReports(temp.db, new Date('2026-05-01T00:00:00.000Z')), ['2026-04']);
      assert.deepEqual(listMonthlyReports(temp.db).map((row) => row.period), ['2026-04', '2026-03', '2026-02', '2026-01']);
      assert.equal(getMonthlyReport(temp.db, '2026-05'), null);
    } finally {
      temp.cleanup();
    }
  });
});
