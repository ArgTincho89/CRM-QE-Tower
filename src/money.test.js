import assert from 'node:assert/strict';
import test from 'node:test';
import { AMOUNT_CURRENCY, formatAmountInput, formatCurrency, parseAmount } from './money.js';

test('AMOUNT_CURRENCY is the euro symbol', () => {
  assert.equal(AMOUNT_CURRENCY, '€');
});

test('parseAmount reads Spanish display amounts', () => {
  assert.equal(parseAmount('185.000 €'), 185000);
  assert.equal(parseAmount('100.000,00 €'), 100000);
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('0,5'), 0.5);
});

test('parseAmount returns zero for empty or non-numeric input', () => {
  assert.equal(parseAmount(''), 0);
  assert.equal(parseAmount('abc'), 0);
});

test('parseAmount cuts decimals to two digits before rounding', () => {
  assert.equal(parseAmount('1.234,567'), 1234.56);
  assert.equal(parseAmount('1.234,565'), 1234.56);
});

test('formatAmountInput groups integers as the user types', () => {
  assert.equal(formatAmountInput('125000'), '125.000');
  assert.equal(formatAmountInput('100000,567'), '100.000,56');
  assert.equal(formatAmountInput('125.000 €'), '125.000');
  assert.equal(formatAmountInput('100.000,00 €'), '100.000,00');
  assert.equal(formatAmountInput('1.2.3.4,5'), '1.234,5');
});

test('formatAmountInput strips leading zeros but keeps a lone zero', () => {
  assert.equal(formatAmountInput('007'), '7');
  assert.equal(formatAmountInput('0'), '0');
  assert.equal(formatAmountInput(',5'), '0,5');
});

test('formatAmountInput preserves a trailing comma', () => {
  assert.equal(formatAmountInput('1234,'), '1.234,');
});

test('formatAmountInput returns an empty string for empty or invalid input', () => {
  assert.equal(formatAmountInput(''), '');
  assert.equal(formatAmountInput('abc'), '');
});

test('formatAmountInput treats a dot as a grouping separator, not a decimal point', () => {
  assert.equal(formatAmountInput('1000.50'), '100.050');
});

test('formatCurrency omits decimals when the amount has no cents', () => {
  assert.equal(formatCurrency(185000), '185.000 €');
  assert.equal(formatCurrency(0), '0 €');
});

test('formatCurrency shows two decimals when the amount has cents', () => {
  assert.equal(formatCurrency(1234.5), '1.234,50 €');
  assert.equal(formatCurrency(1234.567), '1.234,57 €');
});

test('currency display strings round-trip through parseAmount', () => {
  [0, 185000, 1234.5, 99.99, 1234567.89].forEach((value) => {
    assert.equal(parseAmount(formatCurrency(value)), value);
  });
});

test('stored display amounts normalize through parseAmount and formatCurrency', () => {
  assert.equal(formatCurrency(parseAmount('185.000 €')), '185.000 €');
  assert.equal(formatCurrency(parseAmount('100.000,00 €')), '100.000 €');
  assert.equal(formatCurrency(parseAmount('0 €')), '0 €');
});
