import assert from 'node:assert/strict';
import test from 'node:test';
import { getColumnVisibility, moveOpportunityToStage, toggleColumnExpanded } from './kanban.js';

test('collapsed columns show three records and report the remaining count', () => {
  const cards = Array.from({ length: 8 }, (_, index) => ({ id: index }));
  const result = getColumnVisibility(cards, false);

  assert.deepEqual(result.visibleCards, cards.slice(0, 3));
  assert.equal(result.hiddenCount, 5);
  assert.equal(result.canToggle, true);
});

test('expanded columns show all records and can be collapsed again', () => {
  const cards = Array.from({ length: 4 }, (_, index) => ({ id: index }));
  const expanded = toggleColumnExpanded({}, 'prospecting');

  assert.deepEqual(getColumnVisibility(cards, expanded.prospecting).visibleCards, cards);
  const collapsed = toggleColumnExpanded(expanded, 'prospecting');
  assert.deepEqual(getColumnVisibility(cards, collapsed.prospecting).visibleCards, cards.slice(0, 3));
});

test('expanding one column leaves every other column unchanged', () => {
  const expanded = toggleColumnExpanded({}, 'prospecting');

  assert.equal(expanded.prospecting, true);
  assert.equal(expanded.analysis, undefined);
});

test('columns with at most three records have no expand control', () => {
  const result = getColumnVisibility([{ id: 1 }, { id: 2 }, { id: 3 }], false);

  assert.equal(result.hiddenCount, 0);
  assert.equal(result.canToggle, false);
});

test('moving a card returns a new list and replaces only that record', () => {
  const first = { id: 'O-1', stage: 'prospecting' };
  const moved = { id: 'O-2', stage: 'prospecting' };
  const last = { id: 'O-3', stage: 'won' };
  const list = [first, moved, last];

  const result = moveOpportunityToStage(list, 'O-2', 'proposal');

  assert.notEqual(result, list);
  assert.deepEqual(result.map((item) => item.id), ['O-1', 'O-2', 'O-3']);
  assert.equal(result[0], first);
  assert.equal(result[2], last);
  assert.notEqual(result[1], moved);
  assert.deepEqual(result[1], { id: 'O-2', stage: 'proposal' });
  assert.deepEqual(moved, { id: 'O-2', stage: 'prospecting' });
});

test('moving a card to its current stage is a no-op', () => {
  const list = [{ id: 'O-1', stage: 'prospecting' }, { id: 'O-2', stage: 'won' }];

  assert.equal(moveOpportunityToStage(list, 'O-1', 'prospecting'), list);
});

test('moving an unknown card is a no-op', () => {
  const list = [{ id: 'O-1', stage: 'prospecting' }];

  assert.equal(moveOpportunityToStage(list, 'O-404', 'won'), list);
});
