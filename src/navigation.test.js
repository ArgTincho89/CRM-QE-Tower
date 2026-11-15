import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { NAV_GROUPS, NAV_ITEMS, PAGE_REDIRECTS, buildPipelineNavigationFilters, resolveNavigationTarget } from './navigation.js';
import { createDefaultAdvancedFilters } from './pipelineFilters.js';

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
    const expected = ['home', 'pipeline', 'clients', 'initiatives', 'proposals', 'agreements', 'calendar', 'crossSelling', 'towers', 'services', 'lobs', 'people', 'analytics', 'settings'];
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

describe('navigation with filters', () => {
  test('a filter payload opens the CRM QE table with those filters and defaults elsewhere', () => {
    const target = resolveNavigationTarget('pipeline', { outcome: 'won' });
    assert.equal(target.page, 'pipeline');
    assert.equal(target.view, 'table');
    assert.deepEqual(target.filters.toolbar, { stage: 'all', tower: 'all', owner: 'all' });
    assert.deepEqual(target.filters.advanced, { ...createDefaultAdvancedFilters(), outcome: 'won' });
  });

  test('toolbar keys go to the toolbar and advanced keys to the advanced filters', () => {
    const { filters } = resolveNavigationTarget('pipeline', { stage: 'proposal', opportunityType: 'tender', createdFrom: '2026-03-01', createdTo: '2026-03-31' });
    assert.equal(filters.toolbar.stage, 'proposal');
    assert.equal(filters.advanced.opportunityType, 'tender');
    assert.equal(filters.advanced.createdFrom, '2026-03-01');
    assert.equal(filters.advanced.createdTo, '2026-03-31');
  });

  test('unknown keys, empty strings and non-string values are ignored', () => {
    const filters = buildPipelineNavigationFilters({ bogus: 'x', outcome: '', towerId: 7 });
    assert.deepEqual(filters.advanced, createDefaultAdvancedFilters());
    assert.equal(filters.toolbar.stage, 'all');
    assert.equal(Object.hasOwn(filters.advanced, 'bogus'), false);
  });

  test('redirected pages keep their redirect view when filtered', () => {
    assert.equal(resolveNavigationTarget('opportunities', { outcome: 'lost' }).view, 'table');
  });

  test('non-pipeline pages resolve normally with no filters to apply', () => {
    assert.deepEqual(resolveNavigationTarget('initiatives', { outcome: 'won' }), { page: 'initiatives', view: null, filters: null });
  });

  test('without a payload the result shape is unchanged', () => {
    assert.equal(Object.hasOwn(resolveNavigationTarget('pipeline'), 'filters'), false);
  });

  test('the calendar sits right after Acuerdos Marco in the operational group', () => {
    const ids = NAV_GROUPS.find((group) => group.id === 'operations').items.map((item) => item.id);
    assert.equal(ids[ids.indexOf('agreements') + 1], 'calendar');
  });
});
