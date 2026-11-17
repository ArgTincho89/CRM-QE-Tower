import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_NAVIGATION_PAGE, NAVIGATION_STATE_KEY, canNavigateBack, createNavigationEntry, navigationHash, navigationState, parseNavigationHash, parseNavigationState, readNavigationEntry } from './navigationHistory.js';

describe('navigation hash', () => {
  test('a page becomes a "#/<page>" hash and back', () => {
    for (const page of ['pipeline', 'talents', 'masterData', 'resource-quality-gates', 'crossSelling']) {
      assert.equal(navigationHash(page), `#/${page}`);
      assert.equal(parseNavigationHash(navigationHash(page)), page);
    }
  });

  test('unknown pages, retired ids and foreign hashes do not resolve to a page', () => {
    assert.equal(parseNavigationHash('#/nope'), null);
    assert.equal(parseNavigationHash('#/clients'), null);
    assert.equal(parseNavigationHash('#anchor'), null);
    assert.equal(parseNavigationHash(''), null);
    assert.equal(parseNavigationHash(undefined), null);
    assert.equal(navigationHash('opportunities'), navigationHash(DEFAULT_NAVIGATION_PAGE));
  });
});

describe('navigation entry', () => {
  test('keeps the pipeline view, its filters and the history depth', () => {
    const filters = { toolbar: { stage: 'won', tower: 'all', owner: 'all' }, advanced: {} };
    const entry = createNavigationEntry({ page: 'pipeline', view: 'table', filters, depth: 3 });
    assert.deepEqual(entry, { page: 'pipeline', view: 'table', tab: null, filters, query: '', depth: 3 });
  });

  test('drops a view that does not belong to the pipeline, and unknown view modes', () => {
    assert.equal(createNavigationEntry({ page: 'talents', view: 'table' }).view, null);
    assert.equal(createNavigationEntry({ page: 'pipeline', view: 'grid' }).view, null);
  });

  test('retired master data ids open Datos Maestros on their tab', () => {
    assert.deepEqual(createNavigationEntry({ page: 'clients' }), { page: 'masterData', view: null, tab: 'clients', filters: null, query: '', depth: 0 });
    assert.equal(createNavigationEntry({ page: 'services' }).tab, 'services');
  });

  test('a tab only survives on Datos Maestros and must be one of its tabs', () => {
    assert.equal(createNavigationEntry({ page: 'masterData', tab: 'towers' }).tab, 'towers');
    assert.equal(createNavigationEntry({ page: 'masterData', tab: 'pipeline' }).tab, null);
    assert.equal(createNavigationEntry({ page: 'talents', tab: 'clients' }).tab, null);
  });

  test('filters only survive on the pipeline and must be a record', () => {
    assert.equal(createNavigationEntry({ page: 'talents', filters: { toolbar: {} } }).filters, null);
    assert.equal(createNavigationEntry({ page: 'pipeline', filters: ['a'] }).filters, null);
    assert.equal(createNavigationEntry({ page: 'pipeline', filters: 'x' }).filters, null);
  });

  test('the pipeline search text is part of the entry, and only there', () => {
    assert.equal(createNavigationEntry({ page: 'pipeline', query: 'acme' }).query, 'acme');
    assert.equal(createNavigationEntry({ page: 'pipeline', query: 42 }).query, '');
    assert.equal(createNavigationEntry({ page: 'talents', query: 'acme' }).query, '');
  });

  test('unknown pages fall back to the pipeline and the depth is never negative', () => {
    assert.equal(createNavigationEntry({ page: 'nope' }).page, 'pipeline');
    assert.equal(createNavigationEntry({ page: 'pipeline', depth: -2 }).depth, 0);
    assert.equal(createNavigationEntry({ page: 'pipeline', depth: 1.5 }).depth, 0);
    assert.equal(createNavigationEntry().depth, 0);
  });
});

describe('history state', () => {
  test('an entry round-trips through history.state', () => {
    const entry = createNavigationEntry({ page: 'masterData', tab: 'lobs', depth: 2 });
    const state = navigationState(entry);
    assert.deepEqual(Object.keys(state), [NAVIGATION_STATE_KEY]);
    assert.deepEqual(parseNavigationState(state), entry);
  });

  test('foreign or corrupt states are ignored', () => {
    assert.equal(parseNavigationState(null), null);
    assert.equal(parseNavigationState({}), null);
    assert.equal(parseNavigationState({ [NAVIGATION_STATE_KEY]: null }), null);
    assert.equal(parseNavigationState({ [NAVIGATION_STATE_KEY]: { page: 'nope' } }), null);
    assert.equal(parseNavigationState('pipeline'), null);
  });
});

describe('initial navigation', () => {
  test('a reload restores the saved entry before the URL hash', () => {
    const entry = readNavigationEntry({ state: navigationState({ page: 'talents' }), hash: '#/projects' });
    assert.equal(entry.page, 'talents');
  });

  test('a shared link opens the page named by the hash as the first entry', () => {
    const entry = readNavigationEntry({ hash: '#/calendar' });
    assert.deepEqual(entry, { page: 'calendar', view: null, tab: null, filters: null, query: '', depth: 0 });
  });

  test('without state or hash the session starts on the expected page', () => {
    assert.equal(readNavigationEntry().page, DEFAULT_NAVIGATION_PAGE);
    assert.equal(readNavigationEntry({ hash: '#/unknown' }).page, DEFAULT_NAVIGATION_PAGE);
  });

  test('back is available only past the first in-app entry', () => {
    assert.equal(canNavigateBack({ depth: 0 }), false);
    assert.equal(canNavigateBack({ depth: 1 }), true);
    assert.equal(canNavigateBack(null), false);
  });
});
