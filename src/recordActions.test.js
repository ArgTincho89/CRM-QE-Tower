import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveNextActionDate, earliestPendingDueDate, isScheduledPendingAction, truncateActionText } from './recordActions.js';

const action = (dueDate, extra = {}) => ({ kind: 'action', status: 'pending', dueDate, ...extra });

test('only pending actions with a valid due date are scheduled', () => {
  assert.equal(isScheduledPendingAction(action('2026-11-20')), true);
  assert.equal(isScheduledPendingAction(action('')), false);
  assert.equal(isScheduledPendingAction(action('2026-02-30')), false);
  assert.equal(isScheduledPendingAction(action('2026-11-20', { status: 'completed' })), false);
  assert.equal(isScheduledPendingAction(action('2026-11-20', { kind: 'note', status: 'note' })), false);
  assert.equal(isScheduledPendingAction(null), false);
});

test('the earliest pending due date wins, overdue dates included', () => {
  assert.equal(earliestPendingDueDate([action('2026-12-01'), action('2026-11-20'), action('')]), '2026-11-20');
  // An overdue pending action is the most urgent one, so it is chosen over future ones.
  assert.equal(earliestPendingDueDate([action('2026-12-01'), action('2025-01-10')]), '2025-01-10');
  assert.equal(earliestPendingDueDate([action('2025-01-10', { status: 'completed' }), action('2026-12-01')]), '2026-12-01');
  assert.equal(earliestPendingDueDate([]), '');
  assert.equal(earliestPendingDueDate(undefined), '');
});

test('without dated pending actions the manually entered value is kept', () => {
  assert.equal(deriveNextActionDate([action('2026-11-20')], '2026-12-31'), '2026-11-20');
  assert.equal(deriveNextActionDate([action('')], '2026-12-31'), '2026-12-31');
  assert.equal(deriveNextActionDate([action('2026-11-20', { status: 'completed' })], '2026-12-31'), '2026-12-31');
  assert.equal(deriveNextActionDate([], ''), '');
  assert.equal(deriveNextActionDate([], null), '');
});

test('action text is collapsed and truncated with an ellipsis', () => {
  assert.equal(truncateActionText('  Llamar   al cliente '), 'Llamar al cliente');
  assert.equal(truncateActionText('abcdefghij', 5), 'abcd…');
  assert.equal(truncateActionText('abcde', 5), 'abcde');
  assert.equal(truncateActionText(undefined), '');
});
