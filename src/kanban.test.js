import assert from 'node:assert/strict';
import test from 'node:test';
import { getColumnVisibility, toggleColumnExpanded } from './kanban.js';

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
