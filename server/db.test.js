import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applySchema, closeDatabase, INITIAL_SERVICE_YEAR, migrateResolutionDate, migrateTalentProfiles, migrateTalentRelations, migrateTalentSortOrder, openDatabase, seedDatabase, SERVICE_CATALOG } from './db.js';
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
  'opportunity_services', 'initiative_services', 'initiative_lobs', 'initiative_towers', 'record_actions', 'record_action_comments', 'workspace_links', 'entity_events',
  'notifications', 'entity_comments',
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
    INSERT INTO initiative_lobs VALUES ('IN-0001','l-1');
    INSERT INTO initiative_towers VALUES ('IN-0001','t-1');
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
    INSERT INTO entity_comments (id,entity_type,entity_id,user_id,user_name,body,mentions,created_at,updated_at) VALUES
      ('ec-1','opportunity','O-0001','u-1','Ada','Hola','[]','2026-03-04','2026-03-04'),
      ('ec-2','initiative','IN-0001','u-1','Ada','Hola','[]','2026-03-04','2026-03-04'),
      ('ec-3','agreement','3f2b8c1e-0000-4000-8000-000000000001','u-1','Ada','Hola','[]','2026-03-04','2026-03-04');
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
    assert.deepEqual(pairs('initiative_lobs', 'initiative_id', 'lob_id'), [['IN-000001', 'l-1']]);
    assert.deepEqual(pairs('initiative_towers', 'initiative_id', 'tower_id'), [['IN-000001', 't-1']]);
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
    assert.deepEqual(db.prepare('SELECT id, entity_type, entity_id FROM entity_comments ORDER BY id').all().map((row) => [row.id, row.entity_type, row.entity_id]), [
      ['ec-1', 'opportunity', 'OP-000002'],
      ['ec-2', 'initiative', 'IN-000001'],
      ['ec-3', 'agreement', 'AM-000001'],
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

test('opportunity next_action_date and the initiative LoB and Tower join tables are added idempotently', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-next-action-'));
  const dbPath = path.join(dir, 'app.db');
  const original = new DatabaseSync(dbPath);
  original.exec(`
    CREATE TABLE opportunities (id TEXT PRIMARY KEY, title TEXT NOT NULL, account TEXT NOT NULL, amount TEXT NOT NULL, stage TEXT NOT NULL, tower TEXT NOT NULL, owner TEXT NOT NULL, due TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO opportunities VALUES ('OP-000001','A','','100','prospecting','','','','[]','2026-01-01','2026-01-01');
  `);
  original.close();
  try {
    const db = openDatabase(dbPath);
    applySchema(db);
    const column = db.prepare('PRAGMA table_info(opportunities)').all().filter((row) => row.name === 'next_action_date');
    assert.equal(column.length, 1);
    assert.equal(column[0].notnull, 1);
    assert.equal(db.prepare("SELECT next_action_date FROM opportunities WHERE id = 'OP-000001'").get().next_action_date, '');
    for (const [table, valueColumn, target] of [['initiative_lobs', 'lob_id', 'lobs'], ['initiative_towers', 'tower_id', 'towers']]) {
      assert.deepEqual(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name), ['initiative_id', valueColumn], table);
      const keys = db.prepare(`PRAGMA foreign_key_list(${table})`).all();
      assert.equal(keys.find((row) => row.from === 'initiative_id')?.on_delete, 'CASCADE', table);
      assert.equal(keys.find((row) => row.from === valueColumn)?.table, target, table);
    }
    db.exec(`
      INSERT INTO lobs (id, name, created_at, updated_at) VALUES ('l-1','Banca','x','x');
      INSERT INTO initiatives (id, title, created_at, updated_at) VALUES ('IN-000001','Iniciativa','x','x');
      INSERT INTO initiative_lobs VALUES ('IN-000001','l-1');
    `);
    assert.throws(() => db.prepare("INSERT INTO initiative_lobs VALUES ('IN-000001','l-1')").run(), /UNIQUE|PRIMARY KEY/);
    closeDatabase(db);
    const reopened = openDatabase(dbPath);
    applySchema(reopened);
    assert.equal(reopened.prepare('PRAGMA table_info(opportunities)').all().filter((row) => row.name === 'next_action_date').length, 1);
    assert.equal(count(reopened, 'initiative_lobs'), 1);
    closeDatabase(reopened);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('the entity_comments table and its index are created idempotently', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-entity-comments-'));
  const dbPath = path.join(dir, 'app.db');
  try {
    const db = openDatabase(dbPath);
    applySchema(db);
    const columns = db.prepare('PRAGMA table_info(entity_comments)').all().map((row) => row.name);
    assert.deepEqual(columns, ['id', 'entity_type', 'entity_id', 'user_id', 'user_name', 'body', 'mentions', 'edited', 'created_at', 'updated_at']);
    assert.deepEqual(db.prepare('PRAGMA index_info(idx_entity_comments_entity)').all().map((row) => row.name), ['entity_type', 'entity_id', 'created_at']);
    const userKey = db.prepare('PRAGMA foreign_key_list(entity_comments)').all().find((row) => row.from === 'user_id');
    assert.equal(userKey?.table, 'users');
    assert.equal(userKey?.on_delete, 'SET NULL');
    db.exec("INSERT INTO users VALUES ('u-1','ada@example.com','Ada','hash','admin','2026-01-01')");
    db.exec("INSERT INTO entity_comments (id,entity_type,entity_id,user_id,user_name,body,created_at,updated_at) VALUES ('c-1','agreement','AM-000001','u-1','Ada','Hola','x','x')");
    const row = db.prepare("SELECT mentions, edited FROM entity_comments WHERE id = 'c-1'").get();
    assert.deepEqual([row.mentions, row.edited], ['[]', 0]);
    assert.throws(() => db.exec("INSERT INTO entity_comments (id,entity_type,entity_id,user_name,body,created_at,updated_at) VALUES ('c-2','clients','c-1','Ada','x','x','x')"), /CHECK constraint failed/);
    // Deleting the author keeps the comment with its name snapshot.
    db.exec("DELETE FROM users WHERE id = 'u-1'");
    assert.deepEqual({ ...db.prepare("SELECT user_id, user_name FROM entity_comments WHERE id = 'c-1'").get() }, { user_id: null, user_name: 'Ada' });
    closeDatabase(db);
    const reopened = openDatabase(dbPath);
    applySchema(reopened);
    assert.equal(count(reopened, 'entity_comments'), 1);
    closeDatabase(reopened);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('a legacy notifications table is rebuilt once to allow the mention kind, keeping its rows', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-notification-kind-'));
  const dbPath = path.join(dir, 'app.db');
  try {
    const seeded = openDatabase(dbPath);
    seeded.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE notifications;
      CREATE TABLE notifications (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, actor_name TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL CHECK(kind IN ('assignment')),
        entity_type TEXT NOT NULL CHECK(entity_type IN ('opportunity','initiative','agreement')),
        entity_id TEXT NOT NULL, entity_title TEXT NOT NULL DEFAULT '', message TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT
      );
      INSERT INTO users VALUES ('u-1','ada@example.com','Ada','hash','admin','2026-01-01');
      INSERT INTO notifications (id,user_id,actor_name,kind,entity_type,entity_id,entity_title,message,created_at,read_at) VALUES
        ('n-b','u-1','Bob','assignment','initiative','IN-000001','A','Bob te ha asignado la Iniciativa IN-000001: A','2026-01-01',NULL),
        ('n-a','u-1','Bob','assignment','agreement','AM-000001','B','Bob te ha asignado el Acuerdo Marco AM-000001: B','2026-01-01','2026-01-02');
      DELETE FROM schema_meta WHERE key = 'notification_mention_kind_v1';
    `);
    closeDatabase(seeded);

    const db = openDatabase(dbPath);
    assert.deepEqual(db.prepare('SELECT rowid, id, read_at FROM notifications ORDER BY rowid').all().map((row) => [row.rowid, row.id, row.read_at]), [[1, 'n-b', null], [2, 'n-a', '2026-01-02']]);
    db.exec("INSERT INTO notifications (id,user_id,kind,entity_type,entity_id,message,created_at) VALUES ('n-m','u-1','mention','initiative','IN-000001','x','x')");
    assert.throws(() => db.exec("INSERT INTO notifications (id,user_id,kind,entity_type,entity_id,message,created_at) VALUES ('n-x','u-1','other','initiative','IN-000001','x','x')"), /CHECK constraint failed/);
    for (const index of ['idx_notifications_recipient', 'idx_notifications_entity']) {
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(index), index);
    }
    assert.equal(Number(db.prepare('PRAGMA foreign_keys').get().foreign_keys), 1);
    // The recipient foreign key still cascades.
    db.exec("DELETE FROM users WHERE id = 'u-1'");
    assert.equal(count(db, 'notifications'), 0);
    closeDatabase(db);
    const reopened = openDatabase(dbPath);
    assert.equal(reopened.prepare("SELECT COUNT(*) AS count FROM schema_meta WHERE key = 'notification_mention_kind_v1'").get().count, 1);
    closeDatabase(reopened);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('a legacy record_actions table is rebuilt once to allow agreements and gains due_date, keeping rows and comments', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-record-actions-'));
  const dbPath = path.join(dir, 'app.db');
  try {
    const seeded = openDatabase(dbPath);
    seeded.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE record_actions;
      CREATE TABLE record_actions (
        id TEXT PRIMARY KEY, entity_type TEXT NOT NULL CHECK(entity_type IN ('initiative','opportunity')),
        entity_id TEXT NOT NULL, text TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'action' CHECK(kind IN ('note','action')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','note')),
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL, user_name TEXT NOT NULL,
        created_at TEXT NOT NULL, completed_at TEXT
      );
      INSERT INTO users VALUES ('u-1','ada@example.com','Ada','hash','admin','2026-01-01');
      INSERT INTO record_actions (id,entity_type,entity_id,text,kind,status,user_id,user_name,created_at,completed_at) VALUES
        ('a-2','initiative','IN-000001','Segunda','action','completed','u-1','Ada','2026-01-02','2026-01-03'),
        ('a-1','opportunity','OP-000001','Primera','action','pending','u-1','Ada','2026-01-01',NULL);
      INSERT INTO record_action_comments (id,action_id,user_id,user_name,text,created_at) VALUES ('c-1','a-1','u-1','Ada','Hola','2026-01-01');
      DELETE FROM schema_meta WHERE key = 'record_actions_agreements_v1';
    `);
    closeDatabase(seeded);

    const db = openDatabase(dbPath);
    assert.deepEqual(db.prepare('SELECT rowid, id, status, completed_at, due_date FROM record_actions ORDER BY rowid').all().map((row) => [row.rowid, row.id, row.status, row.completed_at, row.due_date]),
      [[1, 'a-2', 'completed', '2026-01-03', ''], [2, 'a-1', 'pending', null, '']]);
    db.exec("INSERT INTO record_actions (id,entity_type,entity_id,text,user_name,created_at,due_date) VALUES ('a-3','agreement','AM-000001','Renovar','Ada','2026-01-04','2026-02-01')");
    assert.throws(() => db.exec("INSERT INTO record_actions (id,entity_type,entity_id,text,user_name,created_at) VALUES ('a-4','other','X','x','Ada','x')"), /CHECK constraint failed/);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_record_actions_entity'").get());
    assert.equal(Number(db.prepare('PRAGMA foreign_keys').get().foreign_keys), 1);
    // Action comments still cascade with their action.
    db.exec("DELETE FROM record_actions WHERE id = 'a-1'");
    assert.equal(count(db, 'record_action_comments'), 0);
    closeDatabase(db);
    const reopened = openDatabase(dbPath);
    assert.equal(reopened.prepare("SELECT COUNT(*) AS count FROM schema_meta WHERE key = 'record_actions_agreements_v1'").get().count, 1);
    assert.equal(count(reopened, 'record_actions'), 2);
    closeDatabase(reopened);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('the monthly_reports table is created idempotently and keeps stored snapshots', () => {
  const temp = createTempDatabase();
  try {
    const columns = temp.db.prepare('PRAGMA table_info(monthly_reports)').all().map((row) => row.name);
    assert.deepEqual(columns, ['period', 'generated_at', 'data']);
    temp.db.prepare('INSERT INTO monthly_reports (period, generated_at, data) VALUES (?, ?, ?)').run('2026-03', '2026-04-01T00:00:00.000Z', '{}');
    applySchema(temp.db);
    applySchema(temp.db);
    assert.equal(count(temp.db, 'monthly_reports'), 1);
    assert.throws(() => temp.db.prepare('INSERT INTO monthly_reports (period, generated_at, data) VALUES (?, ?, ?)').run('2026-03', 'x', '{}'), /UNIQUE|PRIMARY/);
    assert.throws(() => temp.db.prepare('INSERT INTO monthly_reports (period, generated_at, data) VALUES (?, ?, ?)').run('March', 'x', '{}'), /CHECK/);
  } finally {
    temp.cleanup();
  }
});

test('opportunity date, classification and value columns are added idempotently', () => {
  const temp = createTempDatabase();
  try {
    applySchema(temp.db);
    applySchema(temp.db);
    const columns = temp.db.prepare('PRAGMA table_info(opportunities)').all();
    const byName = new Map(columns.map((column) => [column.name, column]));
    for (const name of ['delivery_deadline', 'resolution_date', 'start_date', 'end_date', 'ai_score', 'reusable', 'reusable_reason', 'market_scope', 'contract_type', 'service_type', 'added_value', 'services_added_value']) {
      assert.ok(byName.has(name), `opportunities.${name} should exist`);
      assert.equal(columns.filter((column) => column.name === name).length, 1);
    }
    // The retired close date stays in the table: it is never dropped.
    assert.ok(byName.has('expected_close_date'));
    assert.equal(byName.get('ai_score').type, 'REAL');
    assert.equal(byName.get('reusable').dflt_value, '0');
  } finally {
    temp.cleanup();
  }
});

test('the resolution date migration copies the close date once and never overwrites', () => {
  const temp = createTempDatabase();
  try {
    const insert = temp.db.prepare(
      `INSERT INTO opportunities (id, title, account, amount, stage, tower, owner, due, created_at, updated_at, expected_close_date, resolution_date)
       VALUES (?, 'Fixture', '', '0', 'proposal', '', '', '', '2026-01-01', '2026-01-01', ?, ?)`,
    );
    insert.run('OP-000001', '2026-03-31', '');
    insert.run('OP-000002', '2026-04-30', '2026-05-15');
    insert.run('OP-000003', '', '');
    // Simulate a database that predates the migration.
    temp.db.prepare('DELETE FROM schema_meta WHERE key = ?').run('resolution_date_from_close_v1');
    migrateResolutionDate(temp.db);

    const resolution = (id) => temp.db.prepare('SELECT resolution_date FROM opportunities WHERE id = ?').get(id).resolution_date;
    assert.equal(resolution('OP-000001'), '2026-03-31');
    assert.equal(resolution('OP-000002'), '2026-05-15');
    assert.equal(resolution('OP-000003'), '');
    assert.ok(temp.db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('resolution_date_from_close_v1'));

    // Guarded: later boots leave user edits alone, even an emptied resolution date.
    temp.db.prepare("UPDATE opportunities SET resolution_date = '' WHERE id = 'OP-000001'").run();
    migrateResolutionDate(temp.db);
    applySchema(temp.db);
    assert.equal(resolution('OP-000001'), '');
    assert.equal(temp.db.prepare('SELECT expected_close_date FROM opportunities WHERE id = ?').get('OP-000001').expected_close_date, '2026-03-31');
  } finally {
    temp.cleanup();
  }
});

test('the talent relations backfill derives LoBs, towers and the primary tower from assignments', () => {
  const temp = createTempDatabase();
  try {
    const stamp = '2026-01-01';
    const insertTower = temp.db.prepare('INSERT INTO towers (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)');
    insertTower.run('T-1', 'Tower One', stamp, stamp);
    insertTower.run('T-2', 'Tower Two', stamp, stamp);
    const insertLob = temp.db.prepare('INSERT INTO lobs (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)');
    insertLob.run('L-1', 'LoB One', stamp, stamp);
    insertLob.run('L-2', 'LoB Two', stamp, stamp);
    const insertTalent = temp.db.prepare('INSERT INTO talents (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)');
    insertTalent.run('TA-1', 'Alpha', stamp, stamp);
    insertTalent.run('TA-2', 'Beta', stamp, stamp);
    const insertAssignment = temp.db.prepare(
      'INSERT INTO assignments (id, talent_id, tower_id, lob_id, percentage, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    // Alpha is split across two towers; Tower Two wins on the summed percentage.
    insertAssignment.run('AS-1', 'TA-1', 'T-1', 'L-1', 20, stamp, stamp);
    insertAssignment.run('AS-2', 'TA-1', 'T-2', 'L-2', 50, stamp, stamp);
    insertAssignment.run('AS-3', 'TA-1', 'T-2', null, 10, stamp, stamp);
    // Beta already chose a primary tower: the backfill must not replace it.
    insertAssignment.run('AS-4', 'TA-2', 'T-1', null, 30, stamp, stamp);
    insertAssignment.run('AS-5', 'TA-2', 'T-2', null, 90, stamp, stamp);
    temp.db.prepare("UPDATE talents SET primary_tower_id = 'T-1' WHERE id = 'TA-2'").run();
    // Simulate a database that predates the migration.
    temp.db.prepare('DELETE FROM schema_meta WHERE key = ?').run('talent_relations_backfill_v1');
    migrateTalentRelations(temp.db);

    const towersOf = (id) => temp.db.prepare('SELECT tower_id FROM talent_towers WHERE talent_id = ? ORDER BY tower_id').all(id).map((row) => row.tower_id);
    const lobsOf = (id) => temp.db.prepare('SELECT lob_id FROM talent_lobs WHERE talent_id = ? ORDER BY lob_id').all(id).map((row) => row.lob_id);
    const primaryOf = (id) => temp.db.prepare('SELECT primary_tower_id FROM talents WHERE id = ?').get(id).primary_tower_id;
    assert.deepEqual(towersOf('TA-1'), ['T-1', 'T-2']);
    assert.deepEqual(lobsOf('TA-1'), ['L-1', 'L-2']);
    assert.equal(primaryOf('TA-1'), 'T-2');
    assert.deepEqual(towersOf('TA-2'), ['T-1', 'T-2']);
    assert.deepEqual(lobsOf('TA-2'), []);
    assert.equal(primaryOf('TA-2'), 'T-1');
    assert.ok(temp.db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('talent_relations_backfill_v1'));

    // Guarded: later boots never re-derive relations or overwrite a user edit.
    insertAssignment.run('AS-6', 'TA-2', null, 'L-1', 5, stamp, stamp);
    temp.db.prepare("UPDATE talents SET primary_tower_id = 'T-2' WHERE id = 'TA-1'").run();
    migrateTalentRelations(temp.db);
    assert.deepEqual(lobsOf('TA-2'), []);
    assert.equal(primaryOf('TA-1'), 'T-2');
    assert.equal(temp.db.prepare('SELECT COUNT(*) AS count FROM talent_towers WHERE talent_id = ?').get('TA-2').count, 2);
  } finally {
    temp.cleanup();
  }
});

test('talent profiles become a JSON list once and the manual order is backfilled by name', () => {
  const temp = createTempDatabase();
  try {
    const stamp = '2026-01-01';
    const insertTalent = temp.db.prepare('INSERT INTO talents (id, name, profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    insertTalent.run('TA-1', 'Zeta', 'Ambos', stamp, stamp);
    insertTalent.run('TA-2', 'alfa', 'No funcional', stamp, stamp);
    insertTalent.run('TA-3', 'Beta', '', stamp, stamp);
    insertTalent.run('TA-4', 'Gamma', 'Otro', stamp, stamp);
    // Simulate a database that predates both migrations.
    temp.db.prepare('DELETE FROM schema_meta WHERE key IN (?, ?)').run('talent_profiles_multi_v1', 'talent_sort_order_v1');
    migrateTalentProfiles(temp.db);
    migrateTalentSortOrder(temp.db);
    const row = (id) => temp.db.prepare('SELECT name, profile, sort_order, updated_at FROM talents WHERE id = ?').get(id);
    assert.equal(row('TA-1').profile, '["Funcional","No funcional"]');
    assert.equal(row('TA-2').profile, '["No funcional"]');
    assert.equal(row('TA-3').profile, '[]');
    assert.equal(row('TA-4').profile, '[]');
    assert.equal(row('TA-1').updated_at, stamp);
    assert.deepEqual(['TA-2', 'TA-3', 'TA-4', 'TA-1'].map((id) => row(id).sort_order), [1, 2, 3, 4]);

    // Guarded: later boots leave user edits alone.
    temp.db.prepare("UPDATE talents SET profile = 'Ambos', sort_order = 9 WHERE id = 'TA-3'").run();
    applySchema(temp.db);
    assert.equal(row('TA-3').profile, 'Ambos');
    assert.equal(row('TA-3').sort_order, 9);
  } finally {
    temp.cleanup();
  }
});

test('the schema adds assignment dates, talent order and the performance reviews table idempotently', () => {
  const temp = createTempDatabase();
  try {
    applySchema(temp.db);
    const columns = (table) => temp.db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
    assert.ok(columns('assignments').includes('start_date'));
    assert.ok(columns('assignments').includes('end_date'));
    assert.ok(columns('talents').includes('sort_order'));
    assert.ok(columns('activity_catalog').includes('updated_at'));
    assert.ok(columns('performance_reviews').includes('link_url'));
  } finally {
    temp.cleanup();
  }
});
