import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ALL_YEARS } from './pipelineMetrics.js';
import { PIPELINE_YEAR_STORAGE_KEY, loadPipelineYear, loadViewMode, savePipelineYear, saveViewMode, viewStorageKey } from './preferences.js';

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
