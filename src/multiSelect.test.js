import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { filterOptions, isAssignable, removeSelection, selectedOptions, toggleSelection } from './multiSelect.js';

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
