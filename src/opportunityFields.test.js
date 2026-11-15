import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AI_SCORE_MAX, AI_SCORE_MIN, REUSABLE_REASON_LIMIT, contractTypeLabel, formatAiScore, isIsoDate, marketScopeLabel, parseAiScore, serviceTypeLabel, validateOpportunityFields,
} from './opportunityFields.js';

describe('isIsoDate', () => {
  test('accepts real calendar dates only', () => {
    assert.equal(isIsoDate('2026-02-28'), true);
    assert.equal(isIsoDate('2028-02-29'), true);
    assert.equal(isIsoDate('2026-02-29'), false);
    assert.equal(isIsoDate('2026-13-01'), false);
    assert.equal(isIsoDate('2026-1-01'), false);
    assert.equal(isIsoDate('01/02/2026'), false);
    assert.equal(isIsoDate(''), false);
    assert.equal(isIsoDate(undefined), false);
  });
});

describe('Scoring calificación IA', () => {
  test('parses comma or dot decimals, rounded to two decimals; blank is null', () => {
    assert.equal(parseAiScore('7,5'), 7.5);
    assert.equal(parseAiScore(' 7.25 '), 7.25);
    assert.equal(parseAiScore('8,456'), 8.46);
    assert.equal(parseAiScore(9), 9);
    assert.equal(parseAiScore(''), null);
    assert.equal(parseAiScore('   '), null);
    assert.equal(parseAiScore(null), null);
    assert.equal(parseAiScore(undefined), null);
  });

  test('anything that is not a plain decimal is NaN', () => {
    for (const value of ['alto', '7,5,1', '-3', '1e1', '7.', ',5', true, {}, Number.POSITIVE_INFINITY]) {
      assert.ok(Number.isNaN(parseAiScore(value)), String(value));
    }
  });

  test('formats with a decimal comma for inputs and tables', () => {
    assert.equal(formatAiScore(7.5), '7,5');
    assert.equal(formatAiScore(10), '10');
    assert.equal(formatAiScore(null), '');
    assert.equal(formatAiScore(''), '');
  });

  test('is optional and limited to 1-10', () => {
    assert.deepEqual(validateOpportunityFields({ aiScore: null }), {});
    assert.deepEqual(validateOpportunityFields({ aiScore: AI_SCORE_MIN }), {});
    assert.deepEqual(validateOpportunityFields({ aiScore: AI_SCORE_MAX }), {});
    for (const aiScore of [0.99, 10.01, Number.NaN]) {
      assert.match(validateOpportunityFields({ aiScore }).aiScore, /entre 1 y 10/);
    }
  });
});

describe('validateOpportunityFields', () => {
  test('the end date cannot precede the start date', () => {
    assert.deepEqual(validateOpportunityFields({ startDate: '2026-05-01', endDate: '2026-05-01' }), {});
    assert.deepEqual(validateOpportunityFields({ startDate: '', endDate: '2026-01-01' }), {});
    assert.match(validateOpportunityFields({ startDate: '2026-05-02', endDate: '2026-05-01' }).endDate, /fecha fin/);
  });

  test('a reusable opportunity needs a reason of at most 2000 characters', () => {
    assert.deepEqual(validateOpportunityFields({ reusable: false, reusableReason: '' }), {});
    assert.deepEqual(validateOpportunityFields({ reusable: true, reusableReason: 'Plantilla' }), {});
    assert.match(validateOpportunityFields({ reusable: true, reusableReason: '   ' }).reusableReason, /motivo/);
    assert.deepEqual(validateOpportunityFields({ reusable: true, reusableReason: 'x'.repeat(REUSABLE_REASON_LIMIT) }), {});
    assert.match(validateOpportunityFields({ reusable: true, reusableReason: 'x'.repeat(REUSABLE_REASON_LIMIT + 1) }).reusableReason, /2000/);
  });

  test('the added value never exceeds the amount, and VA Servicios never exceeds the added value', () => {
    assert.deepEqual(validateOpportunityFields({ amount: 1000, addedValue: 1000, servicesAddedValue: 1000 }), {});
    assert.deepEqual(validateOpportunityFields({ amount: 1000, addedValue: null, servicesAddedValue: 5000 }), {});
    assert.match(validateOpportunityFields({ amount: 1000, addedValue: 1000.01 }).addedValue, /importe/);
    assert.match(validateOpportunityFields({ amount: 1000, addedValue: -1 }).addedValue, /cero/);
    assert.match(validateOpportunityFields({ amount: 1000, addedValue: 500, servicesAddedValue: 501 }).servicesAddedValue, /valor añadido/);
    assert.match(validateOpportunityFields({ servicesAddedValue: -1 }).servicesAddedValue, /cero/);
  });

  test('reports every broken rule in form order', () => {
    const errors = validateOpportunityFields({
      startDate: '2026-02-01', endDate: '2026-01-01', aiScore: 11, reusable: true, reusableReason: '', amount: 10, addedValue: 20, servicesAddedValue: 30,
    });
    assert.deepEqual(Object.keys(errors), ['endDate', 'aiScore', 'reusableReason', 'addedValue', 'servicesAddedValue']);
  });
});

test('option labels resolve ids of the data.js enumerations', () => {
  assert.equal(marketScopeLabel('midmarket'), 'MidMarket');
  assert.equal(contractTypeLabel('am_sda_based'), 'Contrato Basado de AM/SDA');
  assert.equal(serviceTypeLabel('hardware_reselling'), 'Hardware reselling');
  assert.equal(marketScopeLabel(''), '');
  assert.equal(contractTypeLabel('unknown'), '');
});
