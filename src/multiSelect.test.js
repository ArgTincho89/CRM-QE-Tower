import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { clampActiveIndex, edgeEnabledIndex, filterOptions, isAssignable, nextEnabledIndex, reduceDropdownKey, removeSelection, selectedOptions, toggleSelection } from './multiSelect.js';

const options = [
  { id: 'a', name: 'Automatización', active: true },
  { id: 'b', name: 'Performance', active: true },
  { id: 'c', name: 'Legacy QA', active: false },
];

describe('multiSelect helpers', () => {
  test('filterOptions is accent and case insensitive and empty query returns all', () => {
    assert.deepEqual(filterOptions(options, 'AUTOMATIZACION').map((o) => o.id), ['a']);
    assert.equal(filterOptions(options, '  ').length, 3);
    assert.equal(filterOptions(options, 'zzz').length, 0);
  });

  test('inactive options are assignable only when already selected', () => {
    assert.equal(isAssignable(options[2], []), false);
    assert.equal(isAssignable(options[2], ['c']), true);
    assert.equal(isAssignable({ id: 'x', name: 'No flag' }, []), true);
  });

  test('toggleSelection adds, removes, and refuses new inactive assignments', () => {
    assert.deepEqual(toggleSelection(['a'], options[1]), ['a', 'b']);
    assert.deepEqual(toggleSelection(['a', 'b'], options[0]), ['b']);
    assert.deepEqual(toggleSelection(['a'], options[2]), ['a']);
    assert.deepEqual(toggleSelection(['c'], options[2]), []);
  });

  test('removeSelection and selectedOptions keep order and skip unknown ids', () => {
    assert.deepEqual(removeSelection(['a', 'b'], 'a'), ['b']);
    assert.deepEqual(selectedOptions(options, ['b', 'zz', 'a']).map((o) => o.id), ['b', 'a']);
  });
});

describe('dropdown multi-select keyboard logic', () => {
  // b is inactive and unselected, so the keyboard skips it.
  const list = [
    { id: 'a', name: 'Alpha', active: true },
    { id: 'b', name: 'Beta', active: false },
    { id: 'c', name: 'Gamma', active: true },
    { id: 'd', name: 'Delta (2025)', assignable: false },
  ];

  test('nextEnabledIndex skips disabled options and wraps around', () => {
    assert.equal(nextEnabledIndex(list, [], -1, 1), 0);
    assert.equal(nextEnabledIndex(list, [], 0, 1), 2);
    assert.equal(nextEnabledIndex(list, [], 2, 1), 0);
    assert.equal(nextEnabledIndex(list, [], 0, -1), 2);
    assert.equal(nextEnabledIndex(list, [], -1, -1), 2);
    // An already selected non-assignable option stays reachable so it can be removed.
    assert.equal(nextEnabledIndex(list, ['d'], 2, 1), 3);
    assert.equal(nextEnabledIndex([], [], -1, 1), -1);
    assert.equal(nextEnabledIndex([list[1]], [], -1, 1), -1);
    assert.equal(edgeEnabledIndex(list, [], 'end'), 2);
  });

  test('closed: ArrowDown, Enter and Space open on the first enabled option, ArrowUp on the last', () => {
    const closed = { open: false, activeIndex: -1 };
    for (const key of ['ArrowDown', 'Enter', ' ']) {
      assert.deepEqual(reduceDropdownKey(closed, key, { options: list, selected: [] }), { open: true, activeIndex: 0, toggle: null, handled: true });
    }
    assert.equal(reduceDropdownKey(closed, 'ArrowUp', { options: list, selected: [] }).activeIndex, 2);
    assert.equal(reduceDropdownKey(closed, 'Escape', { options: list }).handled, false);
    assert.equal(reduceDropdownKey(closed, 'a', { options: list }).handled, false);
  });

  test('open: arrows move, Enter toggles assignable options only, Escape closes', () => {
    const open = { open: true, activeIndex: 0 };
    assert.equal(reduceDropdownKey(open, 'ArrowDown', { options: list, selected: [] }).activeIndex, 2);
    assert.equal(reduceDropdownKey({ open: true, activeIndex: 2 }, 'ArrowUp', { options: list, selected: [] }).activeIndex, 0);
    assert.equal(reduceDropdownKey(open, 'End', { options: list, selected: [] }).activeIndex, 2);
    assert.equal(reduceDropdownKey({ open: true, activeIndex: 2 }, 'Home', { options: list, selected: [] }).activeIndex, 0);
    const entered = reduceDropdownKey(open, 'Enter', { options: list, selected: [] });
    assert.equal(entered.toggle.id, 'a');
    assert.equal(entered.open, true);
    assert.equal(reduceDropdownKey({ open: true, activeIndex: 1 }, 'Enter', { options: list, selected: [] }).toggle, null);
    assert.equal(reduceDropdownKey({ open: true, activeIndex: -1 }, 'Enter', { options: list, selected: [] }).toggle, null);
    assert.deepEqual(reduceDropdownKey(open, 'Escape', { options: list }), { open: false, activeIndex: -1, toggle: null, handled: true });
    // Typing keys (including Space in the search box) belong to the search input.
    assert.equal(reduceDropdownKey(open, ' ', { options: list }).handled, false);
    assert.equal(reduceDropdownKey(open, 'x', { options: list }).handled, false);
  });

  test('clampActiveIndex keeps a valid active option or falls back to the first enabled one', () => {
    assert.equal(clampActiveIndex(list, [], 2), 2);
    assert.equal(clampActiveIndex(list, [], 1), 0);
    assert.equal(clampActiveIndex(list, [], 9), 0);
    assert.equal(clampActiveIndex([], [], 0), -1);
  });
});
