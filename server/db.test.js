import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applySchema, closeDatabase, INITIAL_SERVICE_YEAR, openDatabase, seedDatabase, SERVICE_CATALOG } from './db.js';
import { createTempDatabase } from './testing.js';

function count(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
}

test('a fresh database contains no demo or business records', () => {
  const temp = createTempDatabase();
  try {
    for (const table of ['opportunities', 'initiatives', 'clients', 'towers', 'people', 'framework_agreements', 'card_events', 'record_actions', 'record_action_comments']) {
      assert.equal(count(temp.db, table), 0, `${table} should be empty on first boot`);
    }
    assert.equal(seedDatabase(temp.db), 0);
    assert.equal(count(temp.db, 'opportunities'), 0);
    applySchema(temp.db);
    assert.equal(count(temp.db, 'initiatives'), 0);
  } finally {
    temp.cleanup();
  }
});

test('schema migration preserves existing users and sessions', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-preserve-'));
  const dbPath = path.join(dir, 'app.db');
  const original = new DatabaseSync(dbPath);
  original.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE people (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE towers (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE opportunities (id TEXT PRIMARY KEY, title TEXT NOT NULL, account TEXT NOT NULL, amount TEXT NOT NULL, stage TEXT NOT NULL, tower TEXT NOT NULL, owner TEXT NOT NULL, due TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE initiatives (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, client_id TEXT, tower_id TEXT, owner_id TEXT, bid_manager_id TEXT, amount TEXT NOT NULL, qa_percent REAL NOT NULL, status TEXT NOT NULL, closure_reason TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO users VALUES ('u-1','first@example.com','First User','hash','admin','2026-01-01');
    INSERT INTO users VALUES ('u-2','second@example.com','Second User','hash','member','2026-01-01');
    INSERT INTO sessions VALUES ('token-1','u-1','2026-01-01','2027-01-01');
    INSERT INTO towers VALUES ('tower-legacy','Legacy Tower','active','2026-01-01','2026-01-01');
    INSERT INTO initiatives VALUES ('i-1','Legacy initiative','external',NULL,NULL,NULL,NULL,'0',0,'open','', '2026-01-01','2026-01-01');
  `);
  original.close();
  try {
    const db = openDatabase(dbPath);
    assert.equal(count(db, 'users'), 2);
    assert.equal(count(db, 'sessions'), 1);
    assert.equal(db.prepare('SELECT name FROM users WHERE id = ?').get('u-1').name, 'First User');
    assert.equal(db.prepare('SELECT stage FROM initiatives WHERE id = ?').get('i-1').stage, 'pending');
    assert.equal(db.prepare('SELECT responsible_id FROM towers WHERE id = ?').get('tower-legacy').responsible_id, null);
    assert.ok(db.prepare('PRAGMA foreign_key_list(towers)').all().some((row) => row.from === 'responsible_id' && row.table === 'people'));
    closeDatabase(db);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('deleting an opportunity cascades to its append-only history rows', () => {
  const temp = createTempDatabase();
  try {
    const now = new Date().toISOString();
    temp.db.prepare(`INSERT INTO opportunities (id,title,account,amount,stage,tower,owner,due,tags,created_at,updated_at) VALUES ('O-0001','Test','','0','prospecting','','','','[]',?,?)`).run(now, now);
    temp.db.prepare(`INSERT INTO card_events (card_id,user_name,action,detail,created_at) VALUES ('O-0001','Sistema','created','{}',?)`).run(now);
    assert.equal(count(temp.db, 'card_events'), 1);
    temp.db.prepare('DELETE FROM opportunities WHERE id = ?').run('O-0001');
    assert.equal(count(temp.db, 'card_events'), 0);
  } finally {
    temp.cleanup();
  }
});

test('deleting an action cascades to its comments', () => {
  const temp = createTempDatabase();
  try {
    const now = new Date().toISOString();
    temp.db.prepare(`INSERT INTO record_actions (id,entity_type,entity_id,text,kind,status,user_name,created_at) VALUES ('action-1','opportunity','O-0001','Prepare review','action','pending','Test User',?)`).run(now);
    temp.db.prepare(`INSERT INTO record_action_comments (id,action_id,user_name,text,created_at) VALUES ('comment-1','action-1','Test User','Check the latest draft',?)`).run(now);
    assert.equal(count(temp.db, 'record_action_comments'), 1);
    temp.db.prepare('DELETE FROM record_actions WHERE id = ?').run('action-1');
    assert.equal(count(temp.db, 'record_action_comments'), 0);
  } finally {
    temp.cleanup();
  }
});

test('the database path directory is created when needed', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-mkdir-'));
  const dbPath = path.join(dir, 'nested', 'deeper', 'app.db');
  try {
    const db = openDatabase(dbPath);
    assert.equal(count(db, 'opportunities'), 0);
    closeDatabase(db);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('a fresh database seeds the service catalog exactly once', () => {
  const temp = createTempDatabase();
  try {
    const names = temp.db.prepare('SELECT name FROM services ORDER BY name COLLATE NOCASE').all().map((row) => row.name);
    assert.deepEqual(names.sort(), [...SERVICE_CATALOG].sort());
    assert.equal(count(temp.db, 'lobs'), 0);
    applySchema(temp.db);
    assert.equal(count(temp.db, 'services'), SERVICE_CATALOG.length);
  } finally {
    temp.cleanup();
  }
});

test('legacy stages and tower links migrate losslessly and idempotently', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-legacy-stages-'));
  const dbPath = path.join(dir, 'app.db');
  const original = new DatabaseSync(dbPath);
  original.exec(`
    CREATE TABLE people (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE towers (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE opportunities (id TEXT PRIMARY KEY, title TEXT NOT NULL, account TEXT NOT NULL, amount TEXT NOT NULL, stage TEXT NOT NULL, tower TEXT NOT NULL, owner TEXT NOT NULL, due TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', tower_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE initiatives (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, client_id TEXT, tower_id TEXT, owner_id TEXT, bid_manager_id TEXT, amount TEXT NOT NULL, qa_percent REAL NOT NULL, status TEXT NOT NULL, closure_reason TEXT NOT NULL, stage TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO towers VALUES ('tower-1','Data','active','2026-01-01','2026-01-01');
    INSERT INTO opportunities VALUES ('O-1','A','','100','prospecting','Data','','','[]','tower-1','2026-01-01','2026-01-01');
    INSERT INTO opportunities VALUES ('O-2','B','','200','analysis','Data','','','[]','tower-1','2026-01-01','2026-01-01');
    INSERT INTO opportunities VALUES ('O-3','C','','300','waiting','Data','','','[]','tower-1','2026-01-01','2026-01-01');
    INSERT INTO opportunities VALUES ('O-4','D','','400','proposal','Data','','','[]','tower-1','2026-01-01','2026-01-01');
    INSERT INTO opportunities VALUES ('O-5','E','','500','won','Data','','','[]','tower-1','2026-01-01','2026-01-01');
    INSERT INTO opportunities VALUES ('O-6','F','','600','lost','Data','','','[]','tower-1','2026-01-01','2026-01-01');
    INSERT INTO initiatives (id,title,category,client_id,tower_id,owner_id,bid_manager_id,amount,qa_percent,status,closure_reason,created_at,updated_at) VALUES ('IN-1','A','external',NULL,NULL,NULL,NULL,'0',0,'open','','2026-01-01','2026-01-01');
    INSERT INTO initiatives (id,title,category,client_id,tower_id,owner_id,bid_manager_id,amount,qa_percent,status,closure_reason,created_at,updated_at) VALUES ('IN-2','B','external',NULL,NULL,NULL,NULL,'0',0,'open','','2026-01-01','2026-01-01');
    INSERT INTO initiatives (id,title,category,client_id,tower_id,owner_id,bid_manager_id,amount,qa_percent,status,closure_reason,created_at,updated_at) VALUES ('IN-3','C','external',NULL,NULL,NULL,NULL,'0',0,'open','','2026-01-01','2026-01-01');
    INSERT INTO initiatives (id,title,category,client_id,tower_id,owner_id,bid_manager_id,amount,qa_percent,status,closure_reason,created_at,updated_at) VALUES ('IN-4','D','external',NULL,NULL,NULL,NULL,'0',0,'open','','2026-01-01','2026-01-01');
    INSERT INTO initiatives (id,title,category,client_id,tower_id,owner_id,bid_manager_id,amount,qa_percent,status,closure_reason,created_at,updated_at) VALUES ('IN-5','E','external',NULL,NULL,NULL,NULL,'0',0,'open','','2026-01-01','2026-01-01');
    INSERT INTO initiatives (id,title,category,client_id,tower_id,owner_id,bid_manager_id,amount,qa_percent,status,closure_reason,created_at,updated_at) VALUES ('IN-6','F','external',NULL,NULL,NULL,NULL,'0',0,'open','','2026-01-01','2026-01-01');
    UPDATE initiatives SET stage = CASE id WHEN 'IN-2' THEN 'analysis' WHEN 'IN-3' THEN 'waiting' WHEN 'IN-4' THEN 'proposal' WHEN 'IN-5' THEN 'won' WHEN 'IN-6' THEN 'lost' ELSE 'prospecting' END;
  `);
  original.close();
  try {
    const db = openDatabase(dbPath);
    const stages = db.prepare('SELECT id, stage, outcome FROM opportunities ORDER BY id').all();
    assert.deepEqual(stages.map((row) => [row.id, row.stage, row.outcome]), [
      ['O-1', 'prospecting', ''],
      ['O-2', 'identified', ''],
      ['O-3', 'negotiation', ''],
      ['O-4', 'proposal', ''],
      ['O-5', 'result', 'won'],
      ['O-6', 'result', 'lost'],
    ]);
    const initiatives = db.prepare('SELECT id, stage, operational_status FROM initiatives ORDER BY id').all();
    assert.deepEqual(initiatives.map((row) => [row.id, row.stage, row.operational_status]), [
      ['IN-1', 'pending', 'active'],
      ['IN-2', 'in_progress', 'active'],
      ['IN-3', 'following', 'active'],
      ['IN-4', 'following', 'active'],
      ['IN-5', 'completed', 'active'],
      ['IN-6', 'pending', 'discarded'],
    ]);
    assert.equal(count(db, 'opportunity_towers'), 6);
    assert.equal(count(db, 'opportunity_lobs'), 0);
    assert.equal(count(db, 'services'), SERVICE_CATALOG.length);
    applySchema(db);
    assert.equal(count(db, 'opportunity_towers'), 6);
    assert.equal(count(db, 'services'), SERVICE_CATALOG.length);
    closeDatabase(db);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('opportunity_type is added idempotently as a nullable column and legacy rows stay NULL', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-opportunity-type-'));
  const dbPath = path.join(dir, 'app.db');
  const original = new DatabaseSync(dbPath);
  original.exec(`
    CREATE TABLE opportunities (id TEXT PRIMARY KEY, title TEXT NOT NULL, account TEXT NOT NULL, amount TEXT NOT NULL, stage TEXT NOT NULL, tower TEXT NOT NULL, owner TEXT NOT NULL, due TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO opportunities VALUES ('O-1','A','','100','prospecting','','','','[]','2026-01-01','2026-01-01');
  `);
  original.close();
  try {
    const db = openDatabase(dbPath);
    const column = db.prepare('PRAGMA table_info(opportunities)').all().find((row) => row.name === 'opportunity_type');
    assert.ok(column, 'opportunity_type column should exist');
    assert.equal(column.notnull, 0);
    assert.equal(column.dflt_value, null);
    assert.equal(db.prepare("SELECT opportunity_type FROM opportunities WHERE id = 'O-1'").get().opportunity_type, null);
    applySchema(db);
    const columns = db.prepare('PRAGMA table_info(opportunities)').all().filter((row) => row.name === 'opportunity_type');
    assert.equal(columns.length, 1);
    assert.equal(db.prepare("SELECT opportunity_type FROM opportunities WHERE id = 'O-1'").get().opportunity_type, null);
    closeDatabase(db);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('framework agreement amount and notes are added idempotently with defaults for legacy rows', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-agreement-amount-'));
  const dbPath = path.join(dir, 'app.db');
  const original = new DatabaseSync(dbPath);
  original.exec(`
    CREATE TABLE framework_agreements (id TEXT PRIMARY KEY, title TEXT NOT NULL, client_id TEXT, owner_id TEXT, end_date TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO framework_agreements (id, title, created_at, updated_at) VALUES ('A-1','Legacy','2026-01-01','2026-01-01');
  `);
  original.close();
  try {
    const db = openDatabase(dbPath);
    const read = () => ({ ...db.prepare("SELECT amount, notes FROM framework_agreements WHERE id = 'A-1'").get() });
    assert.deepEqual(read(), { amount: 0, notes: '' });
    applySchema(db);
    const columns = db.prepare('PRAGMA table_info(framework_agreements)').all();
    assert.equal(columns.filter((row) => row.name === 'amount').length, 1);
    assert.equal(columns.filter((row) => row.name === 'notes').length, 1);
    assert.equal(columns.find((row) => row.name === 'amount').notnull, 1);
    assert.deepEqual(read(), { amount: 0, notes: '' });
    db.prepare("INSERT INTO framework_agreements (id, title, created_at, updated_at) VALUES ('A-2','Nuevo','2026-01-02','2026-01-02')").run();
    assert.deepEqual({ ...db.prepare("SELECT amount, notes FROM framework_agreements WHERE id = 'A-2'").get() }, { amount: 0, notes: '' });
    closeDatabase(db);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('a fresh database seeds the catalog into the 2026 fiscal year', () => {
  const temp = createTempDatabase();
  try {
    assert.deepEqual(temp.db.prepare('SELECT year FROM service_years').all().map((row) => row.year), [INITIAL_SERVICE_YEAR]);
    assert.equal(INITIAL_SERVICE_YEAR, 2026);
    const years = temp.db.prepare('SELECT DISTINCT year FROM services').all().map((row) => row.year);
    assert.deepEqual(years, [2026]);
  } finally {
    temp.cleanup();
  }
});

test('services migrate to the 2026 fiscal year with ids, links and per-year uniqueness intact', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-service-years-'));
  const dbPath = path.join(dir, 'app.db');
  const original = new DatabaseSync(dbPath);
  original.exec(`
    CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO schema_meta VALUES ('legacy_evolution_v1', '2026-01-01');
    CREATE TABLE services (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE opportunities (id TEXT PRIMARY KEY, title TEXT NOT NULL, account TEXT NOT NULL, amount TEXT NOT NULL, stage TEXT NOT NULL, tower TEXT NOT NULL, owner TEXT NOT NULL, due TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE initiatives (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'external', amount TEXT NOT NULL DEFAULT '0', qa_percent REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open', closure_reason TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE opportunity_services (opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE, service_id TEXT NOT NULL REFERENCES services(id), PRIMARY KEY(opportunity_id, service_id));
    CREATE TABLE initiative_services (initiative_id TEXT NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE, service_id TEXT NOT NULL REFERENCES services(id), PRIMARY KEY(initiative_id, service_id));
    INSERT INTO services VALUES ('SVC-0001','QA Automation','Automatización','active','2025-01-01','2025-02-01');
    INSERT INTO services VALUES ('svc-custom','Servicio propio','','inactive','2025-03-01','2025-03-02');
    INSERT INTO opportunities VALUES ('OP-0001','A','','100','prospecting','','','','[]','2026-01-01','2026-01-01');
    INSERT INTO initiatives (id, title, created_at, updated_at) VALUES ('IN-0001','B','2026-01-01','2026-01-01');
    INSERT INTO opportunity_services VALUES ('OP-0001','SVC-0001');
    INSERT INTO opportunity_services VALUES ('OP-0001','svc-custom');
    INSERT INTO initiative_services VALUES ('IN-0001','svc-custom');
  `);
  original.close();
  try {
    const db = openDatabase(dbPath);
    const snapshot = () => db.prepare('SELECT id, name, description, status, year, created_at, updated_at FROM services ORDER BY id').all().map((row) => ({ ...row }));
    assert.deepEqual(snapshot(), [
      { id: 'SVC-0001', name: 'QA Automation', description: 'Automatización', status: 'active', year: 2026, created_at: '2025-01-01', updated_at: '2025-02-01' },
      { id: 'svc-custom', name: 'Servicio propio', description: '', status: 'inactive', year: 2026, created_at: '2025-03-01', updated_at: '2025-03-02' },
    ]);
    assert.deepEqual(db.prepare('SELECT year FROM service_years').all().map((row) => row.year), [2026]);
    assert.equal(count(db, 'opportunity_services'), 2);
    assert.equal(count(db, 'initiative_services'), 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(Number(db.prepare('PRAGMA foreign_keys').get().foreign_keys), 1);
    assert.ok(db.prepare('PRAGMA foreign_key_list(services)').all().some((row) => row.from === 'year' && row.table === 'service_years'));
    // Join rows still resolve to the same services and are still guarded by foreign keys.
    assert.throws(() => db.prepare("INSERT INTO opportunity_services VALUES ('OP-0001','missing')").run(), /FOREIGN KEY/);

    // Same name in another year is a distinct service; within one year it stays unique.
    db.prepare("INSERT INTO service_years (year, created_at) VALUES (2027, '2026-12-01')").run();
    db.prepare("INSERT INTO services (id, name, year, created_at, updated_at) VALUES ('svc-2027','QA Automation',2027,'x','x')").run();
    assert.throws(() => db.prepare("INSERT INTO services (id, name, year, created_at, updated_at) VALUES ('svc-dup','qa automation',2026,'x','x')").run(), /UNIQUE/);
    assert.throws(() => db.prepare("INSERT INTO services (id, name, year, created_at, updated_at) VALUES ('svc-orphan','Huérfano',2040,'x','x')").run(), /FOREIGN KEY/);

    // Idempotent: a second boot changes nothing.
    const before = snapshot();
    applySchema(db);
    closeDatabase(db);
    const reopened = openDatabase(dbPath);
    assert.deepEqual(reopened.prepare('SELECT id, name, description, status, year, created_at, updated_at FROM services ORDER BY id').all().map((row) => ({ ...row })), before);
    assert.deepEqual(reopened.prepare('SELECT year FROM service_years ORDER BY year').all().map((row) => row.year), [2026, 2027]);
    assert.equal(count(reopened, 'opportunity_services'), 2);
    assert.equal(reopened.prepare("SELECT COUNT(*) AS count FROM schema_meta WHERE key = 'service_years_v1'").get().count, 1);
    closeDatabase(reopened);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
