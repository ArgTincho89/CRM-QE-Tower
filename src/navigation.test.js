import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { NAV_GROUPS, NAV_ITEMS, PAGE_REDIRECTS, resolveNavigationTarget } from './navigation.js';

describe('sidebar navigation', () => {
  const operations = NAV_GROUPS.find((group) => group.id === 'operations');
  const masterData = NAV_GROUPS.find((group) => group.id === 'masterData');

  test('operational sections start with home and the pipeline, then the commercial workflow, and end with proposals', () => {
    assert.deepEqual(operations.items.slice(0, 5).map((item) => item.id), ['home', 'pipeline', 'initiatives', 'crossSelling', 'agreements']);
    assert.equal(operations.items.at(-1).id, 'proposals');
  });

  test('master data lives in its own labelled group after the operational sections', () => {
    assert.equal(masterData.label, 'Datos maestros');
    assert.deepEqual(masterData.items.map((item) => item.id), ['clients', 'lobs', 'towers', 'people', 'services']);
    assert.ok(NAV_GROUPS.indexOf(masterData) > NAV_GROUPS.indexOf(operations));
  });

  test('every existing page id stays reachable exactly once', () => {
    const ids = NAV_ITEMS.map((item) => item.id);
    const expected = ['home', 'pipeline', 'clients', 'initiatives', 'proposals', 'agreements', 'crossSelling', 'towers', 'services', 'lobs', 'people', 'analytics', 'settings'];
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual([...ids].sort(), [...expected].sort());
  });

  test('the retired Oportunidades page is no longer in the menu', () => {
    assert.equal(NAV_ITEMS.some((item) => item.id === 'opportunities'), false);
  });
});

describe('navigation targets', () => {
  test('the retired opportunities page redirects to the CRM QE table view', () => {
    assert.deepEqual(resolveNavigationTarget('opportunities'), { page: 'pipeline', view: 'table' });
  });

  test('a redirect result is a copy, so callers cannot mutate the redirect map', () => {
    const target = resolveNavigationTarget('opportunities');
    target.view = 'kanban';
    assert.equal(PAGE_REDIRECTS.opportunities.view, 'table');
  });

  test('menu pages resolve to themselves without forcing a view', () => {
    assert.deepEqual(resolveNavigationTarget('clients'), { page: 'clients', view: null });
    assert.deepEqual(resolveNavigationTarget('pipeline'), { page: 'pipeline', view: null });
  });

  test('unknown page ids fall back to the pipeline', () => {
    assert.deepEqual(resolveNavigationTarget('missing'), { page: 'pipeline', view: null });
    assert.deepEqual(resolveNavigationTarget(undefined), { page: 'pipeline', view: null });
  });
});
