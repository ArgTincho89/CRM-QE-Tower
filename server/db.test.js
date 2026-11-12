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
    assert.equal(db.prepare('SELECT stage FROM initiatives WHERE id = ?').get('IN-000001').stage, 'pending');
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
      ['OP-000001', 'prospecting', ''],
      ['OP-000002', 'identified', ''],
      ['OP-000003', 'negotiation', ''],
      ['OP-000004', 'proposal', ''],
      ['OP-000005', 'result', 'won'],
      ['OP-000006', 'result', 'lost'],
    ]);
    const initiatives = db.prepare('SELECT id, stage, operational_status FROM initiatives ORDER BY id').all();
    assert.deepEqual(initiatives.map((row) => [row.id, row.stage, row.operational_status]), [
      ['IN-000001', 'pending', 'active'],
      ['IN-000002', 'in_progress', 'active'],
      ['IN-000003', 'following', 'active'],
      ['IN-000004', 'following', 'active'],
      ['IN-000005', 'completed', 'active'],
      ['IN-000006', 'pending', 'discarded'],
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
    assert.equal(db.prepare("SELECT opportunity_type FROM opportunities WHERE id = 'OP-000001'").get().opportunity_type, null);
    applySchema(db);
    const columns = db.prepare('PRAGMA table_info(opportunities)').all().filter((row) => row.name === 'opportunity_type');
    assert.equal(columns.length, 1);
    assert.equal(db.prepare("SELECT opportunity_type FROM opportunities WHERE id = 'OP-000001'").get().opportunity_type, null);
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
    const read = () => ({ ...db.prepare("SELECT amount, notes FROM framework_agreements WHERE id = 'AM-000001'").get() });
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

test('workspace links are rebuilt to accept agreements, preserving rows, order and index, idempotently', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-workspace-links-'));
  const dbPath = path.join(dir, 'app.db');
  const original = new DatabaseSync(dbPath);
  original.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at TEXT NOT NULL);
    INSERT INTO users VALUES ('u-1','ada@example.com','Ada','hash','admin','2026-01-01');
    CREATE TABLE workspace_links (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('opportunity','initiative')),
      entity_id TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_by_name TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX idx_workspace_links_entity ON workspace_links(entity_type, entity_id, created_at);
    INSERT INTO workspace_links VALUES ('z-link','opportunity','OP-0001','Primero','https://a.example','2026-01-01','u-1','Ada');
    INSERT INTO workspace_links VALUES ('a-link','opportunity','OP-0001','Segundo','https://b.example','2026-01-01',NULL,'');
    INSERT INTO workspace_links VALUES ('m-link','initiative','IN-0001','Carpeta','https://c.example','2026-02-01','u-1','Ada');
  `);
  assert.throws(() => original.prepare("INSERT INTO workspace_links VALUES ('x','agreement','A-1','t','https://x.example','2026-01-01',NULL,'')").run(), /CHECK/);
  original.close();
  const snapshot = (db) => db.prepare('SELECT rowid, * FROM workspace_links ORDER BY rowid').all().map((row) => ({ ...row }));
  try {
    const db = openDatabase(dbPath);
    const migrated = snapshot(db);
    assert.deepEqual(migrated.map((row) => [row.rowid, row.id, row.entity_type, row.entity_id, row.title, row.url, row.created_at, row.created_by_id, row.created_by_name]), [
      [1, 'z-link', 'opportunity', 'OP-0001', 'Primero', 'https://a.example', '2026-01-01', 'u-1', 'Ada'],
      [2, 'a-link', 'opportunity', 'OP-0001', 'Segundo', 'https://b.example', '2026-01-01', null, ''],
      [3, 'm-link', 'initiative', 'IN-0001', 'Carpeta', 'https://c.example', '2026-02-01', 'u-1', 'Ada'],
    ]);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_workspace_links_entity'").get());
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'workspace_links_next'").get(), undefined);
    assert.equal(Number(db.prepare('PRAGMA foreign_keys').get().foreign_keys), 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check(workspace_links)').all(), []);
    assert.ok(db.prepare('PRAGMA foreign_key_list(workspace_links)').all().some((row) => row.from === 'created_by_id' && row.table === 'users'));

    db.prepare("INSERT INTO workspace_links (id, entity_type, entity_id, title, url, created_at) VALUES ('ag-link','agreement','A-1','Contrato','https://d.example','2026-03-01')").run();
    assert.throws(() => db.prepare("INSERT INTO workspace_links (id, entity_type, entity_id, title, url, created_at) VALUES ('bad','proposal','P-1','t','https://x.example','2026-03-01')").run(), /CHECK/);

    // Idempotent: a second boot keeps every row and writes the marker once.
    const before = snapshot(db);
    applySchema(db);
    closeDatabase(db);
    const reopened = openDatabase(dbPath);
    assert.deepEqual(snapshot(reopened), before);
    assert.equal(reopened.prepare("SELECT COUNT(*) AS count FROM schema_meta WHERE key = 'workspace_links_agreements_v1'").get().count, 1);
    closeDatabase(reopened);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('a fresh database accepts agreement workspace links and rejects unknown entity types', () => {
  const temp = createTempDatabase();
  try {
    assert.equal(temp.db.prepare("SELECT COUNT(*) AS count FROM schema_meta WHERE key = 'workspace_links_agreements_v1'").get().count, 1);
    for (const type of ['opportunity', 'initiative', 'agreement']) {
      temp.db.prepare("INSERT INTO workspace_links (id, entity_type, entity_id, title, url, created_at) VALUES (?, ?, 'X-1', 't', 'https://x.example', '2026-01-01')").run(`link-${type}`, type);
    }
    assert.equal(count(temp.db, 'workspace_links'), 3);
    assert.throws(() => temp.db.prepare("INSERT INTO workspace_links (id, entity_type, entity_id, title, url, created_at) VALUES ('bad', 'client', 'X-1', 't', 'https://x.example', '2026-01-01')").run(), /CHECK/);
  } finally {
    temp.cleanup();
  }
});

test('registry_id is added idempotently to agreements and opportunities with an empty default', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-registry-id-'));
  const dbPath = path.join(dir, 'app.db');
  const original = new DatabaseSync(dbPath);
  original.exec(`
    CREATE TABLE framework_agreements (id TEXT PRIMARY KEY, title TEXT NOT NULL, client_id TEXT, owner_id TEXT, end_date TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE opportunities (id TEXT PRIMARY KEY, title TEXT NOT NULL, account TEXT NOT NULL, amount TEXT NOT NULL, stage TEXT NOT NULL, tower TEXT NOT NULL, owner TEXT NOT NULL, due TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO framework_agreements (id, title, created_at, updated_at) VALUES ('A-1','Legacy','2026-01-01','2026-01-01');
    INSERT INTO opportunities VALUES ('O-1','A','','100','prospecting','','','','[]','2026-01-01','2026-01-01');
  `);
  original.close();
  try {
    const db = openDatabase(dbPath);
    applySchema(db);
    for (const table of ['framework_agreements', 'opportunities']) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all().filter((row) => row.name === 'registry_id');
      assert.equal(columns.length, 1, table);
      assert.equal(columns[0].notnull, 1, table);
    }
    assert.equal(db.prepare("SELECT registry_id FROM framework_agreements WHERE id = 'AM-000001'").get().registry_id, '');
    assert.equal(db.prepare("SELECT registry_id FROM opportunities WHERE id = 'OP-000001'").get().registry_id, '');
    // No uniqueness: the same reference may repeat.
    db.prepare("UPDATE framework_agreements SET registry_id = 'R-1'").run();
    db.prepare("INSERT INTO framework_agreements (id, title, registry_id, created_at, updated_at) VALUES ('A-2','Otro','R-1','x','x')").run();
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM framework_agreements WHERE registry_id = 'R-1'").get().count, 2);
    closeDatabase(db);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

const SIX_DIGIT_REFERENCE_TABLES = [
  'opportunities', 'initiatives', 'framework_agreements', 'card_events', 'opportunity_towers', 'opportunity_lobs',
  'opportunity_services', 'initiative_services', 'record_actions', 'record_action_comments', 'workspace_links', 'entity_events',
  'notifications',
];

/** Builds a database with pre-six-digit ids by opening it, inserting legacy rows and dropping the marker. */
function createLegacyIdDatabase(dbPath, extraSql = '') {
  const db = openDatabase(dbPath);
  db.exec(`
    INSERT INTO users VALUES ('u-1','ada@example.com','Ada','hash','admin','2026-01-01');
    INSERT INTO clients (id, name, created_at, updated_at) VALUES ('c-1','Acme','2026-01-01','2026-01-01');
    INSERT INTO towers (id, name, created_at, updated_at) VALUES ('t-1','Data','2026-01-01','2026-01-01');
    INSERT INTO lobs (id, name, created_at, updated_at) VALUES ('l-1','Banca','2026-01-01','2026-01-01');
    INSERT INTO initiatives (id, title, client_id, created_at, updated_at) VALUES ('IN-0001','Iniciativa','c-1','2026-03-01','2026-03-01');
    INSERT INTO opportunities (id,title,account,amount,stage,tower,owner,due,tags,created_at,updated_at,initiative_id,client_id)
      VALUES ('O-0001','Legacy O','','0','prospecting','','','','[]','2025-01-01','2025-01-01','IN-0001','c-1');
    INSERT INTO opportunities (id,title,account,amount,stage,tower,owner,due,tags,created_at,updated_at)
      VALUES ('OP-0001','Legacy OP','','0','prospecting','','','','[]','2026-02-01','2026-02-01');
    INSERT INTO framework_agreements (id, title, client_id, created_at, updated_at) VALUES ('3f2b8c1e-0000-4000-8000-000000000001','Acuerdo','c-1','2026-01-01','2026-01-01');
    INSERT INTO opportunity_towers VALUES ('O-0001','t-1'), ('OP-0001','t-1');
    INSERT INTO opportunity_lobs VALUES ('O-0001','l-1'), ('OP-0001','l-1');
    INSERT INTO opportunity_services VALUES ('O-0001','SVC-0001'), ('OP-0001','SVC-0002');
    INSERT INTO initiative_services VALUES ('IN-0001','SVC-0001');
    INSERT INTO card_events (card_id,user_id,user_name,action,detail,created_at) VALUES
      ('O-0001','u-1','Ada','created','{"opportunityId":"O-0001","nested":[{"initiativeId":"IN-0001"}],"note":"O-0001"}','2025-01-01'),
      ('OP-0001',NULL,'Sistema','moved','{"from":"prospecting","to":"proposal"}','2026-02-02'),
      ('OP-0001',NULL,'Sistema','updated','not json','2026-02-03');
    INSERT INTO record_actions (id,entity_type,entity_id,text,user_name,created_at) VALUES
      ('a-1','opportunity','O-0001','Llamar','Ada','2026-01-01'),
      ('a-2','initiative','IN-0001','Revisar','Ada','2026-01-01');
    INSERT INTO record_action_comments (id,action_id,user_name,text,created_at) VALUES ('rc-1','a-1','Ada','Hecho','2026-01-02');
    INSERT INTO workspace_links (id,entity_type,entity_id,title,url,created_at) VALUES
      ('w-1','opportunity','O-0001','Carpeta','https://a.example','2026-01-01'),
      ('w-2','initiative','IN-0001','Carpeta','https://b.example','2026-01-01'),
      ('w-3','agreement','3f2b8c1e-0000-4000-8000-000000000001','Contrato','https://c.example','2026-01-01');
    INSERT INTO entity_events (entity_type,entity_id,user_name,action,detail,created_at) VALUES
      ('opportunity','O-0001','Ada','created','{"fromInitiativeId":"IN-0001"}','2026-03-02'),
      ('initiative','IN-0001','Ada','converted','{"opportunityId":"O-0001","fields":["stage"],"from":"pending","to":"completed"}','2026-03-02'),
      ('agreement','3f2b8c1e-0000-4000-8000-000000000001','Ada','created','{}','2026-01-01'),
      ('services','SVC-0010','Ada','created','{"copiedFrom":"SVC-0001","year":2026}','2026-01-01'),
      ('clients','O-0001','Ada','updated','{"fields":["name"]}','2026-01-01');
    INSERT INTO notifications (id,user_id,actor_user_id,actor_name,kind,entity_type,entity_id,entity_title,message,created_at) VALUES
      ('n-1','u-1',NULL,'Bob','assignment','opportunity','O-0001','Legacy O','Bob te ha asignado la Oportunidad O-0001: Legacy O','2026-03-03'),
      ('n-2','u-1',NULL,'Bob','assignment','agreement','3f2b8c1e-0000-4000-8000-000000000001','Acuerdo','Bob te ha asignado el Acuerdo Marco 3f2b8c1e-0000-4000-8000-000000000001: Acuerdo','2026-03-03');
    DELETE FROM schema_meta WHERE key = 'six_digit_ids_v1';
  `);
  if (extraSql) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(extraSql);
  }
  closeDatabase(db);
}

function tableCounts(db) {
  return Object.fromEntries(SIX_DIGIT_REFERENCE_TABLES.map((table) => [table, count(db, table)]));
}

test('commercial ids migrate to six-digit prefixes with every reference rewritten, idempotently', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-six-digit-ids-'));
  const dbPath = path.join(dir, 'app.db');
  try {
    createLegacyIdDatabase(dbPath);
    const raw = new DatabaseSync(dbPath);
    const countsBefore = tableCounts(raw);
    raw.close();

    const db = openDatabase(dbPath);
    const ids = (table) => db.prepare(`SELECT id FROM ${table} ORDER BY id`).all().map((row) => row.id);
    // Kept numbers are reserved first: OP-0001 keeps 1 although O-0001 is older.
    assert.deepEqual(ids('opportunities'), ['OP-000001', 'OP-000002']);
    assert.equal(db.prepare("SELECT title FROM opportunities WHERE id = 'OP-000001'").get().title, 'Legacy OP');
    assert.equal(db.prepare("SELECT title FROM opportunities WHERE id = 'OP-000002'").get().title, 'Legacy O');
    assert.deepEqual(ids('initiatives'), ['IN-000001']);
    assert.deepEqual(ids('framework_agreements'), ['AM-000001']);
    assert.deepEqual(tableCounts(db), countsBefore);

    assert.equal(db.prepare("SELECT initiative_id FROM opportunities WHERE id = 'OP-000002'").get().initiative_id, 'IN-000001');
    const pairs = (table, column, value) => db.prepare(`SELECT ${column} AS owner, ${value} AS value FROM ${table} ORDER BY 1, 2`).all().map((row) => [row.owner, row.value]);
    assert.deepEqual(pairs('opportunity_towers', 'opportunity_id', 'tower_id'), [['OP-000001', 't-1'], ['OP-000002', 't-1']]);
    assert.deepEqual(pairs('opportunity_lobs', 'opportunity_id', 'lob_id'), [['OP-000001', 'l-1'], ['OP-000002', 'l-1']]);
    assert.deepEqual(pairs('opportunity_services', 'opportunity_id', 'service_id'), [['OP-000001', 'SVC-0002'], ['OP-000002', 'SVC-0001']]);
    assert.deepEqual(pairs('initiative_services', 'initiative_id', 'service_id'), [['IN-000001', 'SVC-0001']]);
    assert.deepEqual(db.prepare('SELECT card_id, detail FROM card_events ORDER BY id').all().map((row) => [row.card_id, row.detail]), [
      ['OP-000002', '{"opportunityId":"OP-000002","nested":[{"initiativeId":"IN-000001"}],"note":"O-0001"}'],
      ['OP-000001', '{"from":"prospecting","to":"proposal"}'],
      ['OP-000001', 'not json'],
    ]);
    assert.deepEqual(db.prepare('SELECT id, entity_type, entity_id FROM record_actions ORDER BY id').all().map((row) => [row.id, row.entity_type, row.entity_id]), [
      ['a-1', 'opportunity', 'OP-000002'],
      ['a-2', 'initiative', 'IN-000001'],
    ]);
    assert.equal(db.prepare('SELECT action_id FROM record_action_comments').get().action_id, 'a-1');
    assert.deepEqual(db.prepare('SELECT id, entity_type, entity_id FROM workspace_links ORDER BY id').all().map((row) => [row.id, row.entity_type, row.entity_id]), [
      ['w-1', 'opportunity', 'OP-000002'],
      ['w-2', 'initiative', 'IN-000001'],
      ['w-3', 'agreement', 'AM-000001'],
    ]);
    assert.deepEqual(db.prepare('SELECT entity_type, entity_id, detail FROM entity_events ORDER BY id').all().map((row) => [row.entity_type, row.entity_id, row.detail]), [
      ['opportunity', 'OP-000002', '{"fromInitiativeId":"IN-000001"}'],
      ['initiative', 'IN-000001', '{"opportunityId":"OP-000002","fields":["stage"],"from":"pending","to":"completed"}'],
      ['agreement', 'AM-000001', '{}'],
      ['services', 'SVC-0010', '{"copiedFrom":"SVC-0001","year":2026}'],
      // Other entity types never change, even when their id looks like a legacy opportunity id.
      ['clients', 'O-0001', '{"fields":["name"]}'],
    ]);
    assert.deepEqual(db.prepare('SELECT id, entity_type, entity_id, message FROM notifications ORDER BY id').all().map((row) => [row.id, row.entity_type, row.entity_id, row.message]), [
      ['n-1', 'opportunity', 'OP-000002', 'Bob te ha asignado la Oportunidad OP-000002: Legacy O'],
      ['n-2', 'agreement', 'AM-000001', 'Bob te ha asignado el Acuerdo Marco AM-000001: Acuerdo'],
    ]);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(Number(db.prepare('PRAGMA foreign_keys').get().foreign_keys), 1);

    // Idempotent: a second boot changes nothing and writes the marker once.
    const snapshot = (target) => Object.fromEntries(SIX_DIGIT_REFERENCE_TABLES.map((table) => [table, target.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((row) => ({ ...row }))]));
    const before = snapshot(db);
    applySchema(db);
    closeDatabase(db);
    const reopened = openDatabase(dbPath);
    assert.deepEqual(snapshot(reopened), before);
    assert.equal(reopened.prepare("SELECT COUNT(*) AS count FROM schema_meta WHERE key = 'six_digit_ids_v1'").get().count, 1);
    closeDatabase(reopened);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('the six-digit id migration rolls back when it would leave a broken foreign key', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-six-digit-rollback-'));
  const dbPath = path.join(dir, 'app.db');
  try {
    createLegacyIdDatabase(dbPath, "INSERT INTO opportunity_services VALUES ('OP-0001','missing-service')");
    assert.throws(() => openDatabase(dbPath), /Six-digit id migration left 1 broken foreign key reference/);
    const raw = new DatabaseSync(dbPath);
    assert.deepEqual(raw.prepare('SELECT id FROM opportunities ORDER BY id').all().map((row) => row.id), ['O-0001', 'OP-0001']);
    assert.equal(raw.prepare("SELECT entity_id FROM workspace_links WHERE id = 'w-3'").get().entity_id, '3f2b8c1e-0000-4000-8000-000000000001');
    assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM schema_meta WHERE key = 'six_digit_ids_v1'").get().count, 0);
    raw.close();
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('assigned_user_id columns and the notifications table are added idempotently', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-assignee-'));
  const dbPath = path.join(dir, 'app.db');
  const original = new DatabaseSync(dbPath);
  original.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at TEXT NOT NULL);
    CREATE TABLE framework_agreements (id TEXT PRIMARY KEY, title TEXT NOT NULL, client_id TEXT, owner_id TEXT, end_date TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO users VALUES ('u-1','ada@example.com','Ada','hash','admin','2026-01-01');
    INSERT INTO framework_agreements (id, title, created_at, updated_at) VALUES ('AM-000001','Legacy','2026-01-01','2026-01-01');
  `);
  original.close();
  try {
    const db = openDatabase(dbPath);
    applySchema(db);
    for (const table of ['opportunities', 'initiatives', 'framework_agreements']) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all().filter((row) => row.name === 'assigned_user_id');
      assert.equal(columns.length, 1, table);
      assert.equal(columns[0].notnull, 0, table);
      const foreignKey = db.prepare(`PRAGMA foreign_key_list(${table})`).all().find((row) => row.from === 'assigned_user_id');
      assert.equal(foreignKey?.table, 'users', table);
      assert.equal(foreignKey?.on_delete, 'SET NULL', table);
    }
    assert.equal(db.prepare("SELECT assigned_user_id FROM framework_agreements WHERE id = 'AM-000001'").get().assigned_user_id, null);
    const notificationColumns = db.prepare('PRAGMA table_info(notifications)').all().map((row) => row.name);
    assert.deepEqual(notificationColumns, ['id', 'user_id', 'actor_user_id', 'actor_name', 'kind', 'entity_type', 'entity_id', 'entity_title', 'message', 'created_at', 'read_at']);
    const indexColumns = db.prepare('PRAGMA index_info(idx_notifications_recipient)').all().map((row) => row.name);
    assert.deepEqual(indexColumns, ['user_id', 'read_at', 'created_at']);
    assert.throws(() => db.prepare("INSERT INTO notifications (id,user_id,kind,entity_type,entity_id,message,created_at) VALUES ('n-x','u-1','assignment','clients','c-1','x','x')").run(), /CHECK constraint failed/);

    // Deleting the assigned user unassigns records instead of failing.
    db.prepare("UPDATE framework_agreements SET assigned_user_id = 'u-1'").run();
    db.prepare("DELETE FROM users WHERE id = 'u-1'").run();
    assert.equal(db.prepare("SELECT assigned_user_id FROM framework_agreements WHERE id = 'AM-000001'").get().assigned_user_id, null);
    closeDatabase(db);
    const reopened = openDatabase(dbPath);
    for (const table of ['opportunities', 'initiatives', 'framework_agreements']) {
      assert.equal(reopened.prepare(`PRAGMA table_info(${table})`).all().filter((row) => row.name === 'assigned_user_id').length, 1, table);
    }
    closeDatabase(reopened);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
