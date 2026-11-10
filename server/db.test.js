import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { seedOpportunities } from '../src/data.js';
import { applySchema, closeDatabase, openDatabase, seedDatabase } from './db.js';
import { createTempDatabase } from './testing.js';

function count(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
}

test('an empty database is seeded with every opportunity and one origin event each', () => {
  const temp = createTempDatabase();
  try {
    assert.equal(count(temp.db, 'opportunities'), 29);
    assert.equal(count(temp.db, 'card_events'), 29);

    const rows = temp.db.prepare('SELECT * FROM opportunities ORDER BY id').all();
    const expected = [...seedOpportunities].sort((a, b) => (a.id < b.id ? -1 : 1));
    assert.deepEqual(
      rows.map((row) => row.id).sort(),
      expected.map((item) => item.id).sort(),
    );

    const source = new Map(seedOpportunities.map((item) => [item.id, item]));
    for (const row of rows) {
      const original = source.get(row.id);
      assert.equal(row.title, original.title);
      assert.equal(row.account, original.account);
      assert.equal(row.amount, original.amount);
      assert.equal(row.stage, original.stage);
      assert.equal(row.tower, original.tower);
      assert.equal(row.owner, original.owner);
      assert.equal(row.due, original.due);
      assert.deepEqual(JSON.parse(row.tags), original.tags);
      assert.equal(row.created_at, row.updated_at);
    }

    const events = temp.db.prepare('SELECT * FROM card_events').all();
    for (const event of events) {
      assert.equal(event.action, 'created');
      assert.equal(event.user_id, null);
      assert.equal(event.user_name, 'Sistema');
      assert.equal(event.detail, '{}');
    }
  } finally {
    temp.cleanup();
  }
});

test('reopening the same database does not duplicate seed rows', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-seed-'));
  const dbPath = path.join(dir, 'app.db');

  try {
    const first = openDatabase(dbPath);
    assert.equal(count(first, 'opportunities'), 29);
    closeDatabase(first);

    const second = openDatabase(dbPath);
    assert.equal(count(second, 'opportunities'), 29);
    assert.equal(count(second, 'card_events'), 29);

    // Running the seed explicitly on a populated database is a no-op.
    assert.equal(seedDatabase(second), 0);
    assert.equal(count(second, 'opportunities'), 29);
    closeDatabase(second);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the schema is idempotent', () => {
  const temp = createTempDatabase();
  try {
    applySchema(temp.db);
    applySchema(temp.db);
    assert.equal(count(temp.db, 'opportunities'), 29);
  } finally {
    temp.cleanup();
  }
});

test('deleting an opportunity cascades to its events', () => {
  const temp = createTempDatabase();
  try {
    const id = seedOpportunities[0].id;
    assert.ok(count(temp.db, 'card_events') > 0);

    temp.db.prepare('DELETE FROM opportunities WHERE id = ?').run(id);
    const remaining = temp.db.prepare('SELECT COUNT(*) AS count FROM card_events WHERE card_id = ?').get(id);
    assert.equal(Number(remaining.count), 0);
  } finally {
    temp.cleanup();
  }
});

test('the demo database file lives under a directory that is created on demand', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-mkdir-'));
  const dbPath = path.join(dir, 'nested', 'deeper', 'app.db');

  try {
    const db = openDatabase(dbPath);
    assert.equal(count(db, 'opportunities'), 29);
    closeDatabase(db);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
