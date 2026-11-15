import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_MASTER_DATA_TAB, MASTER_DATA_TABS, NAV_GROUPS, NAV_ITEMS, PAGE_ITEMS, PAGE_REDIRECTS, RESOURCE_PAGES, buildPipelineNavigationFilters, isMasterDataTab, resolveNavigationTarget } from './navigation.js';
import { createDefaultAdvancedFilters } from './pipelineFilters.js';

describe('sidebar navigation', () => {
  const operations = NAV_GROUPS.find((group) => group.id === 'operations');
  const masterData = NAV_GROUPS.find((group) => group.id === 'masterData');

  test('operational sections start with home and the pipeline, then the commercial workflow, and end with proposals', () => {
    assert.deepEqual(operations.items.slice(0, 5).map((item) => item.id), ['home', 'pipeline', 'initiatives', 'crossSelling', 'agreements']);
    assert.equal(operations.items.at(-1).id, 'proposals');
  });

  test('master data is a single "Datos Maestros" entry after the operational sections', () => {
    assert.deepEqual(masterData.items.map((item) => [item.id, item.label]), [['masterData', 'Datos Maestros']]);
    assert.ok(NAV_GROUPS.indexOf(masterData) > NAV_GROUPS.indexOf(operations));
  });

  test('every page id is in the menu exactly once', () => {
    const ids = NAV_ITEMS.map((item) => item.id);
    const expectedPages = ['home', 'pipeline', 'initiatives', 'proposals', 'agreements', 'calendar', 'crossSelling', 'analytics', 'settings', 'masterData', 'resource-quality-gates', 'resource-normativa-calidad', 'resource-agentic-quality-engineering'];
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(PAGE_ITEMS.map((item) => item.id).sort(), [...expectedPages].sort());
  });

  test('the former master data pages are tabs of Datos Maestros, Servicios included', () => {
    assert.deepEqual(MASTER_DATA_TABS.map((tab) => [tab.id, tab.label]), [['clients', 'Clientes'], ['lobs', 'LoB'], ['towers', 'Towers'], ['people', 'Responsables'], ['services', 'Servicios']]);
    assert.equal(DEFAULT_MASTER_DATA_TAB, 'clients');
    for (const tab of MASTER_DATA_TABS) assert.equal(NAV_ITEMS.some((item) => item.id === tab.id), false);
    assert.equal(isMasterDataTab('people'), true);
    assert.equal(isMasterDataTab('pipeline'), false);
    assert.equal(isMasterDataTab(null), false);
  });

  test('the retired Oportunidades page is no longer in the menu', () => {
    assert.equal(NAV_ITEMS.some((item) => item.id === 'opportunities'), false);
  });
});

describe('resources group', () => {
  const resources = NAV_GROUPS.find((group) => group.id === 'resources');

  test('Recursos is the last group of the menu, after Datos Maestros', () => {
    assert.equal(resources.label, 'Recursos');
    assert.equal(NAV_GROUPS.at(-1), resources);
    assert.equal(NAV_GROUPS.at(-2).id, 'masterData');
  });

  test('the SharePoint entries are external links, not pages', () => {
    const external = resources.items.filter((item) => item.href);
    assert.deepEqual(external.map((item) => item.label), ['SharePoint QA Sol&Tech', 'QA-Aceleradores-Demos']);
    assert.equal(external[0].href, 'https://seidor.sharepoint.com/teams/QASolTech/SitePages/Home.aspx');
    assert.equal(external[1].href, 'https://seidor-my.sharepoint.com/:f:/r/personal/jgonzalez24_seidor_es/_layouts/15/onedrive.aspx?id=%2Fpersonal%2Fjgonzalez24%5Fseidor%5Fes%2FDocuments%2F01%2E%20QA%20%2D%20Quality%20Assurance%20Drive%2F99%2E%20SEIDOR%2F00%2E%20QE%20Tower%20Core%2F03%2E%20Aceleradores%20%2D%20Demos%2F01%2E%20QA%2DAceleradores%2DDemos&share=cgpB9Mi1maZqRZbK6VUMHsPkEgUDWZYwmdcEWVCpSUcYiuKjDg');
    for (const item of external) {
      assert.equal(PAGE_ITEMS.includes(item), false);
      assert.deepEqual(resolveNavigationTarget(item.id), { page: 'pipeline', view: null });
    }
  });

  test('the internal documents open in-app pages backed by /resources/', () => {
    assert.deepEqual(Object.fromEntries(Object.entries(RESOURCE_PAGES).map(([id, item]) => [id, [item.label, item.resource]])), {
      'resource-quality-gates': ['Modelo de gobernanza de Quality Gates', '/resources/quality-gates.html'],
      'resource-normativa-calidad': ['Normativa de calidad', '/resources/normativa-calidad.html'],
      'resource-agentic-quality-engineering': ['Agentic Quality Engineering', '/resources/agentic-quality-engineering.html'],
    });
    for (const id of Object.keys(RESOURCE_PAGES)) assert.deepEqual(resolveNavigationTarget(id), { page: id, view: null });
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

  test('former master data page ids open Datos Maestros on the matching tab', () => {
    for (const tab of MASTER_DATA_TABS) {
      assert.deepEqual(resolveNavigationTarget(tab.id), { page: 'masterData', view: null, tab: tab.id });
    }
    assert.deepEqual(resolveNavigationTarget('clients', { outcome: 'won' }), { page: 'masterData', view: null, tab: 'clients', filters: null });
  });

  test('menu pages resolve to themselves without forcing a view', () => {
    assert.deepEqual(resolveNavigationTarget('masterData'), { page: 'masterData', view: null });
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
