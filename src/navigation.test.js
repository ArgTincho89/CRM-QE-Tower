import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { NAV_GROUPS, NAV_ITEMS } from './navigation.js';

describe('sidebar navigation', () => {
  const operations = NAV_GROUPS.find((group) => group.id === 'operations');
  const masterData = NAV_GROUPS.find((group) => group.id === 'masterData');

  test('operational sections start with the commercial workflow and end with proposals', () => {
    assert.deepEqual(operations.items.slice(0, 4).map((item) => item.id), ['initiatives', 'opportunities', 'crossSelling', 'agreements']);
    assert.equal(operations.items.at(-1).id, 'proposals');
    assert.ok(operations.items.some((item) => item.id === 'pipeline'));
  });

  test('master data lives in its own labelled group after the operational sections', () => {
    assert.equal(masterData.label, 'Datos maestros');
    assert.deepEqual(masterData.items.map((item) => item.id), ['towers', 'services', 'lobs', 'people', 'clients']);
    assert.ok(NAV_GROUPS.indexOf(masterData) > NAV_GROUPS.indexOf(operations));
  });

  test('every existing page id stays reachable exactly once', () => {
    const ids = NAV_ITEMS.map((item) => item.id);
    const expected = ['home', 'pipeline', 'clients', 'opportunities', 'initiatives', 'proposals', 'agreements', 'crossSelling', 'towers', 'services', 'lobs', 'people', 'analytics', 'settings'];
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual([...ids].sort(), [...expected].sort());
  });
});
