import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { seedOpportunities } from '../src/data.js';

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE COLLATE NOCASE,
     name TEXT NOT NULL,
     password_hash TEXT NOT NULL,
     role TEXT NOT NULL DEFAULT 'member',
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS opportunities (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     account TEXT NOT NULL,
     amount TEXT NOT NULL,
     stage TEXT NOT NULL,
     tower TEXT NOT NULL,
     owner TEXT NOT NULL,
     due TEXT NOT NULL,
     tags TEXT NOT NULL DEFAULT '[]',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS card_events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     card_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
     user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
     user_name TEXT NOT NULL,
     action TEXT NOT NULL,
     detail TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
  'CREATE INDEX IF NOT EXISTS idx_card_events_card ON card_events(card_id, id)',
];

/**
 * Runs `fn` inside an immediate write transaction.
 * node:sqlite has no transaction helper, so the statements are explicit.
 */
export function withTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // A failed rollback means the transaction is already gone; the original error matters more.
    }
    throw error;
  }
}

export function applySchema(db) {
  for (const statement of SCHEMA_STATEMENTS) db.exec(statement);
}

/**
 * Opens (creating when needed) the SQLite database and makes it ready for use.
 * Safe to call repeatedly: every statement is idempotent.
 */
export function openDatabase(dbPath) {
  if (!dbPath || typeof dbPath !== 'string') {
    throw new Error('openDatabase requires a database path');
  }

  if (dbPath !== ':memory:') {
    mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  applySchema(db);
  seedDatabase(db);
  return db;
}

/**
 * Inserts the demo pipeline only when the opportunities table is empty, so booting
 * twice never duplicates rows.
 *
 * Returns the number of seeded opportunities (0 when the table already had data).
 */
export function seedDatabase(db, createdAt = new Date().toISOString()) {
  const row = db.prepare('SELECT COUNT(*) AS count FROM opportunities').get();
  if (Number(row.count) > 0) return 0;

  const insertOpportunity = db.prepare(
    `INSERT INTO opportunities
       (id, title, account, amount, stage, tower, owner, due, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // user_id stays NULL on purpose: the demo history must survive without any account.
  const insertEvent = db.prepare(
    `INSERT INTO card_events (card_id, user_id, user_name, action, detail, created_at)
     VALUES (?, NULL, 'Sistema', 'created', '{}', ?)`,
  );

  withTransaction(db, () => {
    for (const opportunity of seedOpportunities) {
      insertOpportunity.run(
        opportunity.id,
        opportunity.title,
        opportunity.account,
        opportunity.amount,
        opportunity.stage,
        opportunity.tower,
        opportunity.owner,
        opportunity.due,
        JSON.stringify(opportunity.tags ?? []),
        createdAt,
        createdAt,
      );
      insertEvent.run(opportunity.id, createdAt);
    }
  });

  return seedOpportunities.length;
}

export function closeDatabase(db) {
  if (!db) return;
  try {
    db.close();
  } catch {
    // Closing an already closed database is not an error worth escalating.
  }
}
