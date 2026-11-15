import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ALL_YEARS } from './pipelineMetrics.js';
import { MASTER_DATA_TAB_STORAGE_KEY, PIPELINE_YEAR_STORAGE_KEY, loadMasterDataTab, loadPipelineYear, loadViewMode, saveMasterDataTab, savePipelineYear, saveViewMode, viewStorageKey } from './preferences.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key) => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)), data };
}

const failingStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };

describe('view mode preference', () => {
  test('is stored per page and defaults to Kanban', () => {
    const storage = memoryStorage();
    assert.equal(loadViewMode('initiatives', storage), 'kanban');
    assert.equal(saveViewMode('initiatives', 'table', storage), true);
    assert.equal(loadViewMode('initiatives', storage), 'table');
    assert.equal(loadViewMode('pipeline', storage), 'kanban');
    assert.equal(storage.data.get(viewStorageKey('initiatives')), 'table');
  });

  test('rejects unknown views and survives missing or failing storage', () => {
    const storage = memoryStorage({ [viewStorageKey('pipeline')]: 'grid' });
    assert.equal(loadViewMode('pipeline', storage), 'kanban');
    assert.equal(saveViewMode('pipeline', 'grid', storage), false);
    assert.equal(loadViewMode('pipeline', null), 'kanban');
    assert.equal(loadViewMode('pipeline', failingStorage), 'kanban');
    assert.equal(saveViewMode('pipeline', 'list', failingStorage), false);
  });
});

describe('CRM QE year preference', () => {
  test('defaults to the current year and round-trips a year or "all"', () => {
    const storage = memoryStorage();
    assert.equal(loadPipelineYear(2026, storage), 2026);
    assert.equal(savePipelineYear(2024, storage), true);
    assert.equal(loadPipelineYear(2026, storage), 2024);
    assert.equal(savePipelineYear(ALL_YEARS, storage), true);
    assert.equal(loadPipelineYear(2026, storage), ALL_YEARS);
  });

  test('ignores corrupt values and failing storage', () => {
    assert.equal(loadPipelineYear(2026, memoryStorage({ [PIPELINE_YEAR_STORAGE_KEY]: 'nope' })), 2026);
    assert.equal(loadPipelineYear(2026, failingStorage), 2026);
    assert.equal(savePipelineYear(2026, failingStorage), false);
    assert.equal(savePipelineYear('nope', memoryStorage()), false);
  });
});

describe('Datos Maestros tab preference', () => {
  test('defaults to Clientes and remembers the last tab', () => {
    const storage = memoryStorage();
    assert.equal(loadMasterDataTab(storage), 'clients');
    assert.equal(saveMasterDataTab('services', storage), true);
    assert.equal(loadMasterDataTab(storage), 'services');
    assert.equal(storage.data.get(MASTER_DATA_TAB_STORAGE_KEY), 'services');
  });

  test('rejects unknown tabs and survives missing or failing storage', () => {
    assert.equal(loadMasterDataTab(memoryStorage({ [MASTER_DATA_TAB_STORAGE_KEY]: 'pipeline' })), 'clients');
    const storage = memoryStorage();
    assert.equal(saveMasterDataTab('bogus', storage), false);
    assert.equal(storage.data.size, 0);
    assert.equal(loadMasterDataTab(null), 'clients');
    assert.equal(loadMasterDataTab(failingStorage), 'clients');
    assert.equal(saveMasterDataTab('lobs', failingStorage), false);
  });
});
