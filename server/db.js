import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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
  `CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, sector TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
  `CREATE TABLE IF NOT EXISTS towers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
  `CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
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
  `CREATE TABLE IF NOT EXISTS initiatives (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'external',
      client_id TEXT REFERENCES clients(id), tower_id TEXT REFERENCES towers(id),
      owner_id TEXT REFERENCES people(id), bid_manager_id TEXT REFERENCES people(id),
      amount TEXT NOT NULL DEFAULT '0', qa_percent REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open', closure_reason TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT 'prospecting',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
  `CREATE TABLE IF NOT EXISTS framework_agreements (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, client_id TEXT REFERENCES clients(id),
      owner_id TEXT REFERENCES people(id), end_date TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
  `CREATE TABLE IF NOT EXISTS record_actions (
      id TEXT PRIMARY KEY, entity_type TEXT NOT NULL CHECK(entity_type IN ('initiative','opportunity')),
      entity_id TEXT NOT NULL, text TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'action' CHECK(kind IN ('note','action')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','note')),
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL, user_name TEXT NOT NULL,
      created_at TEXT NOT NULL, completed_at TEXT
    )`,
  `CREATE TABLE IF NOT EXISTS entity_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      user_name TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
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
  const columns = db.prepare('PRAGMA table_info(opportunities)').all().map((row) => row.name);
  const additions = [
    ['number', "TEXT NOT NULL DEFAULT ''"],
    ['client_id', 'TEXT REFERENCES clients(id)'],
    ['tower_id', 'TEXT REFERENCES towers(id)'],
    ['owner_id', 'TEXT REFERENCES people(id)'],
    ['bid_manager_id', 'TEXT REFERENCES people(id)'],
    ['qa_percent', 'REAL NOT NULL DEFAULT 0'],
    ['closure_reason', "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [name, declaration] of additions) {
    if (!columns.includes(name)) db.exec(`ALTER TABLE opportunities ADD COLUMN ${name} ${declaration}`);
  }
  const initiativeColumns = db.prepare('PRAGMA table_info(initiatives)').all().map((row) => row.name);
  if (!initiativeColumns.includes('stage')) {
    db.exec("ALTER TABLE initiatives ADD COLUMN stage TEXT NOT NULL DEFAULT 'prospecting'");
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_record_actions_entity ON record_actions(entity_type, entity_id, created_at)');
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
  return db;
}

/**
 * Kept as a backwards-compatible no-op. Application startup must never create demo business data.
 */
export function seedDatabase() {
  return 0;
}

export function closeDatabase(db) {
  if (!db) return;
  try {
    db.close();
  } catch {
    // Closing an already closed database is not an error worth escalating.
  }
}
