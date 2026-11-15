import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { monthFilterRange, reportOutcomeColumns, summarizeOpportunityOutcomes } from './reportMetrics.js';

describe('report metrics', () => {
  test('outcome columns use plural Spanish labels', () => {
    assert.deepEqual(reportOutcomeColumns, [['won', 'Ganadas'], ['lost', 'Perdidas'], ['discarded', 'Descartadas']]);
  });

  test('counts open and closed opportunities, skipping archived ones', () => {
    const summary = summarizeOpportunityOutcomes([
      { outcome: '' }, { outcome: 'won' }, { outcome: 'won' }, { outcome: 'lost' },
      { outcome: 'won', archivedAt: '2026-01-01' }, { outcome: 'weird' }, null,
    ]);
    assert.deepEqual(summary, { open: 1, won: 2, lost: 1, discarded: 0 });
    assert.deepEqual(summarizeOpportunityOutcomes(undefined), { open: 0, won: 0, lost: 0, discarded: 0 });
  });

  test('month ranges cover the whole month, leap years included', () => {
    assert.deepEqual(monthFilterRange('2026-03'), { from: '2026-03-01', to: '2026-03-31' });
    assert.deepEqual(monthFilterRange('2024-02'), { from: '2024-02-01', to: '2024-02-29' });
    assert.deepEqual(monthFilterRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
    assert.deepEqual(monthFilterRange('bad'), { from: '', to: '' });
  });
});
