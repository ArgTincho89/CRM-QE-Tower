import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { computePipelineQe, computeQeAmount, computeWeightedAmount, computeWeightedPipeline } from './pipelineSummary.js';

const opportunities = [
  { id: 'OP-1', amount: '1.000 €', qaPercent: 50, probability: 80 },
  { id: 'OP-2', amount: '2.000 €', qaPercent: 25, probability: null },
  { id: 'OP-3', amount: '10.000 €', qaPercent: 100, probability: 50, archivedAt: '2026-03-01T00:00:00.000Z' },
  { id: 'OP-4', amount: '400 €', qaPercent: 0, probability: 0 },
];

describe('pipeline summary', () => {
  test('Pipeline QE sums amount x QA share over active opportunities only', () => {
    assert.equal(computePipelineQe(opportunities), 1000 * 0.5 + 2000 * 0.25);
  });

  test('Pipeline QE ignores initiative-like records only because callers pass opportunities', () => {
    assert.equal(computePipelineQe([]), 0);
    assert.equal(computePipelineQe(undefined), 0);
  });

  test('Pipeline QE does not depend on any view filter', () => {
    const visible = opportunities.filter((item) => item.id === 'OP-1');
    assert.notEqual(computePipelineQe(visible), computePipelineQe(opportunities));
    assert.equal(computePipelineQe(opportunities), 1000);
  });

  test('QE amount is estimated amount x QA share', () => {
    assert.equal(computeQeAmount({ amount: '350.000 €', qaPercent: 75 }), 262500);
    assert.equal(computeQeAmount({ amount: '1.000 €' }), 0);
  });

  test('weighted amount applies probability to the QE amount, not to the estimated amount', () => {
    const opportunity = { amount: '350.000 €', qaPercent: 75, probability: 20 };
    assert.equal(computePipelineQe([opportunity]), 262500);
    assert.equal(computeWeightedAmount(opportunity), 52500);
    assert.equal(computeWeightedPipeline([opportunity]), 52500);
  });

  test('weighted amount exists only when probability exists, and zero counts as present', () => {
    assert.equal(computeWeightedAmount(opportunities[0]), 400);
    assert.equal(computeWeightedAmount(opportunities[1]), null);
    assert.equal(computeWeightedAmount(opportunities[3]), 0);
    assert.equal(computeWeightedAmount({ amount: '100', probability: '' }), null);
  });

  test('weighted pipeline is separate, skips archived and missing probabilities', () => {
    assert.equal(computeWeightedPipeline(opportunities), 400);
    assert.equal(computeWeightedPipeline([opportunities[1]]), null);
  });
});
