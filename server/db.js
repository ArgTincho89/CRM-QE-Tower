import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AGREEMENT_ID_PREFIX, INITIATIVE_ID_PREFIX, OPPORTUNITY_ID_PREFIX, planIdRename } from './ids.js';

const SERVICES_COLUMNS = `id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE,
      description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
      year INTEGER NOT NULL REFERENCES service_years(year),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL`;

// Entity types that may own Workspace links. Widening this list needs a rebuild migration:
// SQLite cannot alter a CHECK constraint in place.
const WORKSPACE_LINK_COLUMNS = `id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('opportunity','initiative','agreement')),
      entity_id TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_by_name TEXT NOT NULL DEFAULT ''`;
const WORKSPACE_LINKS_INDEX = 'CREATE INDEX IF NOT EXISTS idx_workspace_links_entity ON workspace_links(entity_type, entity_id, created_at)';

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
       responsible_id TEXT REFERENCES people(id),
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
  `CREATE TABLE IF NOT EXISTS record_action_comments (
       id TEXT PRIMARY KEY, action_id TEXT NOT NULL REFERENCES record_actions(id) ON DELETE CASCADE,
       user_id TEXT REFERENCES users(id) ON DELETE SET NULL, user_name TEXT NOT NULL,
       text TEXT NOT NULL, created_at TEXT NOT NULL
     )`,
  `CREATE TABLE IF NOT EXISTS entity_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      user_name TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
    )`,
  'CREATE INDEX IF NOT EXISTS idx_card_events_card ON card_events(card_id, id)',
  // Fiscal years ("ejercicios") that group the service catalog.
  'CREATE TABLE IF NOT EXISTS service_years (year INTEGER PRIMARY KEY, created_at TEXT NOT NULL)',
  // Name uniqueness is per year (idx_services_year_name): the same service may exist in several years.
  `CREATE TABLE IF NOT EXISTS services (${SERVICES_COLUMNS})`,
  `CREATE TABLE IF NOT EXISTS lobs (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
  `CREATE TABLE IF NOT EXISTS opportunity_towers (
      opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
      tower_id TEXT NOT NULL REFERENCES towers(id), PRIMARY KEY(opportunity_id, tower_id)
    )`,
  `CREATE TABLE IF NOT EXISTS opportunity_lobs (
      opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
      lob_id TEXT NOT NULL REFERENCES lobs(id), PRIMARY KEY(opportunity_id, lob_id)
    )`,
  `CREATE TABLE IF NOT EXISTS opportunity_services (
      opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
      service_id TEXT NOT NULL REFERENCES services(id), PRIMARY KEY(opportunity_id, service_id)
    )`,
  `CREATE TABLE IF NOT EXISTS initiative_services (
      initiative_id TEXT NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
      service_id TEXT NOT NULL REFERENCES services(id), PRIMARY KEY(initiative_id, service_id)
    )`,
  `CREATE TABLE IF NOT EXISTS workspace_links (${WORKSPACE_LINK_COLUMNS})`,
  `CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
];

export const SERVICE_CATALOG = [
  'QA Automation',
  'API Testing',
  'Performance Testing',
  'Accessibility Testing',
  'AI Testing',
  'QA Consulting',
  'QA Managed Services',
  'Quality Engineering Framework',
  'Otros',
];

const MIGRATION_MARKER = 'legacy_evolution_v1';
const SERVICE_YEARS_MARKER = 'service_years_v1';
const WORKSPACE_LINKS_AGREEMENTS_MARKER = 'workspace_links_agreements_v1';
const SIX_DIGIT_IDS_MARKER = 'six_digit_ids_v1';

/** Fiscal year that receives the seeded catalog and every service created before years existed. */
export const INITIAL_SERVICE_YEAR = 2026;

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
  const towerColumns = db.prepare('PRAGMA table_info(towers)').all().map((row) => row.name);
  if (!towerColumns.includes('responsible_id')) {
    db.exec('ALTER TABLE towers ADD COLUMN responsible_id TEXT REFERENCES people(id)');
  }
  if (!towerColumns.includes('lob_id')) {
    db.exec('ALTER TABLE towers ADD COLUMN lob_id TEXT REFERENCES lobs(id)');
  }
  const opportunityAdditions = [
    ['origin', "TEXT NOT NULL DEFAULT ''"],
    ['probability', 'INTEGER'],
    ['expected_close_date', "TEXT NOT NULL DEFAULT ''"],
    ['next_milestone', "TEXT NOT NULL DEFAULT ''"],
    ['next_milestone_date', "TEXT NOT NULL DEFAULT ''"],
    ['need', "TEXT NOT NULL DEFAULT ''"],
    ['initiative_id', 'TEXT REFERENCES initiatives(id)'],
    ['outcome', "TEXT NOT NULL DEFAULT ''"],
    ['pep', "TEXT NOT NULL DEFAULT ''"],
    ['archived_at', 'TEXT'],
    ['archived_by_id', 'TEXT REFERENCES users(id)'],
    ['archived_by_name', "TEXT NOT NULL DEFAULT ''"],
    // Nullable on purpose: legacy rows keep NULL until someone edits them and picks a type.
    ['opportunity_type', 'TEXT'],
    // Optional external reference (client portal, tender or ERP registry number). Not unique.
    ['registry_id', "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [name, declaration] of opportunityAdditions) {
    if (!columns.includes(name)) db.exec(`ALTER TABLE opportunities ADD COLUMN ${name} ${declaration}`);
  }
  const initiativeAdditions = [
    ['priority', "TEXT NOT NULL DEFAULT 'media'"],
    ['next_action', "TEXT NOT NULL DEFAULT ''"],
    ['next_action_date', "TEXT NOT NULL DEFAULT ''"],
    ['description', "TEXT NOT NULL DEFAULT ''"],
    ['operational_status', "TEXT NOT NULL DEFAULT 'active'"],
    ['archived_at', 'TEXT'],
    ['archived_by_id', 'TEXT REFERENCES users(id)'],
    ['archived_by_name', "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [name, declaration] of initiativeAdditions) {
    if (!initiativeColumns.includes(name)) db.exec(`ALTER TABLE initiatives ADD COLUMN ${name} ${declaration}`);
  }
  const agreementColumns = db.prepare('PRAGMA table_info(framework_agreements)').all().map((row) => row.name);
  const agreementAdditions = [
    // 0 is a valid amount for agreements without a committed value.
    ['amount', 'REAL NOT NULL DEFAULT 0'],
    ['notes', "TEXT NOT NULL DEFAULT ''"],
    ['registry_id', "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [name, declaration] of agreementAdditions) {
    if (!agreementColumns.includes(name)) db.exec(`ALTER TABLE framework_agreements ADD COLUMN ${name} ${declaration}`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_record_actions_entity ON record_actions(entity_type, entity_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_record_action_comments_action ON record_action_comments(action_id, created_at)');
  for (const statement of [
    'CREATE INDEX IF NOT EXISTS idx_opportunity_towers_tower ON opportunity_towers(tower_id)',
    'CREATE INDEX IF NOT EXISTS idx_opportunity_lobs_lob ON opportunity_lobs(lob_id)',
    'CREATE INDEX IF NOT EXISTS idx_opportunity_services_service ON opportunity_services(service_id)',
    'CREATE INDEX IF NOT EXISTS idx_initiative_services_service ON initiative_services(service_id)',
    WORKSPACE_LINKS_INDEX,
    'CREATE INDEX IF NOT EXISTS idx_opportunities_initiative ON opportunities(initiative_id)',
    'CREATE INDEX IF NOT EXISTS idx_opportunities_archived ON opportunities(archived_at)',
    'CREATE INDEX IF NOT EXISTS idx_initiatives_archived ON initiatives(archived_at)',
    'CREATE INDEX IF NOT EXISTS idx_towers_lob ON towers(lob_id)',
  ]) {
    db.exec(statement);
  }
  runMigrations(db);
}

/**
 * One-time data migration. Guarded by `schema_meta` so repeated boots are no-ops.
 * Preserves IDs and legacy columns; unknown stage values are left untouched.
 */
export function runMigrations(db) {
  // Runs first: the legacy migration below seeds services, which needs the per-year shape.
  migrateServiceYears(db);
  migrateWorkspaceLinkAgreements(db);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_services_year_name ON services(year, name COLLATE NOCASE)');
  migrateLegacyEvolution(db);
  // Last: it renames ids that the migrations above may have copied into join tables.
  migrateSixDigitIds(db);
}

function migrateLegacyEvolution(db) {
  if (db.prepare('SELECT value FROM schema_meta WHERE key = ?').get(MIGRATION_MARKER)) return;
  withTransaction(db, () => {
    const now = new Date().toISOString();
    db.prepare('INSERT OR IGNORE INTO service_years (year, created_at) VALUES (?, ?)').run(INITIAL_SERVICE_YEAR, now);
    const seedService = db.prepare(
      'INSERT OR IGNORE INTO services (id, name, description, status, year, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    SERVICE_CATALOG.forEach((name, index) => {
      seedService.run(`SVC-${String(index + 1).padStart(4, '0')}`, name, '', 'active', INITIAL_SERVICE_YEAR, now, now);
    });

    db.exec(`
      UPDATE opportunities SET
        outcome = CASE stage WHEN 'won' THEN 'won' WHEN 'lost' THEN 'lost' ELSE outcome END,
        stage = CASE stage
          WHEN 'prospecting' THEN 'prospecting'
          WHEN 'analysis' THEN 'identified'
          WHEN 'waiting' THEN 'negotiation'
          WHEN 'proposal' THEN 'proposal'
          WHEN 'won' THEN 'result'
          WHEN 'lost' THEN 'result'
          ELSE stage END
      WHERE stage IN ('prospecting','analysis','waiting','proposal','won','lost')
    `);

    db.exec(`
      UPDATE initiatives SET
        operational_status = CASE WHEN stage = 'lost' THEN 'discarded' ELSE operational_status END,
        stage = CASE stage
          WHEN 'prospecting' THEN 'pending'
          WHEN 'analysis' THEN 'in_progress'
          WHEN 'waiting' THEN 'following'
          WHEN 'proposal' THEN 'following'
          WHEN 'won' THEN 'completed'
          WHEN 'lost' THEN 'pending'
          ELSE stage END
      WHERE stage IN ('prospecting','analysis','waiting','proposal','won','lost')
    `);

    db.exec(`
      INSERT OR IGNORE INTO opportunity_towers (opportunity_id, tower_id)
      SELECT id, tower_id FROM opportunities WHERE tower_id IS NOT NULL AND tower_id <> ''
    `);

    db.prepare('INSERT INTO schema_meta (key, value) VALUES (?, ?)').run(MIGRATION_MARKER, now);
  });
}

/**
 * Moves services to fiscal years. Guarded by `schema_meta`, so it runs once per database.
 * Creates year 2026 and, when `services` still has the pre-year shape (global UNIQUE name, no
 * `year`), rebuilds the table inside one transaction: same ids and column values, every existing
 * service assigned to 2026, and name uniqueness moved to the per-year index. Join tables
 * reference services by id, so their rows stay valid; the foreign key check proves it.
 */
export function migrateServiceYears(db) {
  if (db.prepare('SELECT value FROM schema_meta WHERE key = ?').get(SERVICE_YEARS_MARKER)) return;
  const hasYear = db.prepare('PRAGMA table_info(services)').all().some((row) => row.name === 'year');
  // SQLite ignores this pragma inside a transaction, so it is switched around the rebuild.
  const foreignKeys = Number(db.prepare('PRAGMA foreign_keys').get().foreign_keys);
  if (!hasYear) db.exec('PRAGMA foreign_keys = OFF');
  try {
    withTransaction(db, () => {
      const now = new Date().toISOString();
      db.prepare('INSERT OR IGNORE INTO service_years (year, created_at) VALUES (?, ?)').run(INITIAL_SERVICE_YEAR, now);
      if (!hasYear) {
        db.exec(`CREATE TABLE services_next (${SERVICES_COLUMNS})`);
        db.prepare(
          `INSERT INTO services_next (id, name, description, status, year, created_at, updated_at)
           SELECT id, name, description, status, ?, created_at, updated_at FROM services`,
        ).run(INITIAL_SERVICE_YEAR);
        db.exec('DROP TABLE services');
        db.exec('ALTER TABLE services_next RENAME TO services');
        // Only the tables touched by the rebuild: unrelated legacy rows must not block it.
        const broken = ['services', 'opportunity_services', 'initiative_services']
          .flatMap((table) => db.prepare(`PRAGMA foreign_key_check(${table})`).all());
        if (broken.length > 0) throw new Error(`Service year migration left ${broken.length} broken foreign key reference(s).`);
      }
      db.prepare('INSERT INTO schema_meta (key, value) VALUES (?, ?)').run(SERVICE_YEARS_MARKER, now);
    });
  } finally {
    if (!hasYear && foreignKeys) db.exec('PRAGMA foreign_keys = ON');
  }
}

/**
 * Lets framework agreements own Workspace links. Guarded by `schema_meta`, so it runs once per
 * database. When `workspace_links` still has the CHECK that only allows opportunities and
 * initiatives, the table is rebuilt inside one transaction with the widened CHECK: same ids and
 * column values, and its index is recreated. A fresh database already has the new CHECK, so
 * only the marker is written.
 */
export function migrateWorkspaceLinkAgreements(db) {
  if (db.prepare('SELECT value FROM schema_meta WHERE key = ?').get(WORKSPACE_LINKS_AGREEMENTS_MARKER)) return;
  const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'workspace_links'").get()?.sql ?? '';
  const needsRebuild = !tableSql.includes("'agreement'");
  // SQLite ignores this pragma inside a transaction, so it is switched around the rebuild.
  const foreignKeys = Number(db.prepare('PRAGMA foreign_keys').get().foreign_keys);
  if (needsRebuild) db.exec('PRAGMA foreign_keys = OFF');
  try {
    withTransaction(db, () => {
      if (needsRebuild) {
        db.exec(`CREATE TABLE workspace_links_next (${WORKSPACE_LINK_COLUMNS})`);
        db.exec(`INSERT INTO workspace_links_next (rowid, id, entity_type, entity_id, title, url, created_at, created_by_id, created_by_name)
           SELECT rowid, id, entity_type, entity_id, title, url, created_at, created_by_id, created_by_name FROM workspace_links`);
        db.exec('DROP TABLE workspace_links');
        db.exec('ALTER TABLE workspace_links_next RENAME TO workspace_links');
        db.exec(WORKSPACE_LINKS_INDEX);
        const broken = db.prepare('PRAGMA foreign_key_check(workspace_links)').all();
        if (broken.length > 0) throw new Error(`Workspace link migration left ${broken.length} broken foreign key reference(s).`);
      }
      db.prepare('INSERT INTO schema_meta (key, value) VALUES (?, ?)').run(WORKSPACE_LINKS_AGREEMENTS_MARKER, new Date().toISOString());
    });
  } finally {
    if (needsRebuild && foreignKeys) db.exec('PRAGMA foreign_keys = ON');
  }
}

/**
 * Commercial entities renamed by `migrateSixDigitIds`: their table, id prefix, the entity_type
 * strings that reference them in polymorphic tables (plural aliases cover any older writer), the
 * foreign key columns that hold their ids, and the event detail JSON keys that carry their ids.
 */
const COMMERCIAL_ID_RENAMES = [
  {
    table: 'opportunities',
    prefix: OPPORTUNITY_ID_PREFIX,
    entityTypes: ['opportunity', 'opportunities'],
    references: [['card_events', 'card_id'], ['opportunity_towers', 'opportunity_id'], ['opportunity_lobs', 'opportunity_id'], ['opportunity_services', 'opportunity_id']],
    detailKeys: ['opportunityId', 'cardId'],
  },
  {
    table: 'initiatives',
    prefix: INITIATIVE_ID_PREFIX,
    entityTypes: ['initiative', 'initiatives'],
    references: [['opportunities', 'initiative_id'], ['initiative_services', 'initiative_id']],
    detailKeys: ['initiativeId', 'fromInitiativeId'],
  },
  {
    table: 'framework_agreements',
    prefix: AGREEMENT_ID_PREFIX,
    entityTypes: ['agreement', 'agreements', 'framework_agreements'],
    references: [],
    detailKeys: ['agreementId'],
  },
];
const POLYMORPHIC_ID_TABLES = ['record_actions', 'workspace_links', 'entity_events'];
const EVENT_DETAIL_TABLES = ['entity_events', 'card_events'];

/**
 * Renames opportunity, initiative and framework agreement ids to `OP-`/`IN-`/`AM-` plus six
 * digits (numbering rules in `planIdRename`). Guarded by `schema_meta`, so it runs once per
 * database. Runs in one transaction with foreign keys off (no ON UPDATE CASCADE exists), rewrites
 * every foreign key column, polymorphic (entity_type, entity_id) pair and event detail JSON id,
 * and rolls back unless the foreign key check over the touched tables is clean.
 */
export function migrateSixDigitIds(db) {
  if (db.prepare('SELECT value FROM schema_meta WHERE key = ?').get(SIX_DIGIT_IDS_MARKER)) return;
  const plans = COMMERCIAL_ID_RENAMES.map((entity) => ({
    ...entity,
    rename: planIdRename(db.prepare(`SELECT id, created_at FROM ${entity.table}`).all(), entity.prefix),
  }));
  const needsRename = plans.some((plan) => plan.rename.size > 0);
  // SQLite ignores this pragma inside a transaction, so it is switched around the rename.
  const foreignKeys = Number(db.prepare('PRAGMA foreign_keys').get().foreign_keys);
  if (needsRename) db.exec('PRAGMA foreign_keys = OFF');
  try {
    withTransaction(db, () => {
      if (needsRename) {
        for (const plan of plans) renameEntityIds(db, plan);
        rewriteEventDetailIds(db, plans);
        const touched = new Set(plans.flatMap((plan) => [plan.table, ...plan.references.map(([table]) => table)]));
        const broken = [...touched].flatMap((table) => db.prepare(`PRAGMA foreign_key_check(${table})`).all());
        if (broken.length > 0) throw new Error(`Six-digit id migration left ${broken.length} broken foreign key reference(s).`);
      }
      db.prepare('INSERT INTO schema_meta (key, value) VALUES (?, ?)').run(SIX_DIGIT_IDS_MARKER, new Date().toISOString());
    });
  } finally {
    if (needsRename && foreignKeys) db.exec('PRAGMA foreign_keys = ON');
  }
}

function renameEntityIds(db, { table, entityTypes, references, rename }) {
  if (rename.size === 0) return;
  const statements = [
    db.prepare(`UPDATE ${table} SET id = $next WHERE id = $old`),
    ...references.map(([refTable, column]) => db.prepare(`UPDATE ${refTable} SET ${column} = $next WHERE ${column} = $old`)),
    ...POLYMORPHIC_ID_TABLES.flatMap((refTable) =>
      entityTypes.map((type) => db.prepare(`UPDATE ${refTable} SET entity_id = $next WHERE entity_type = '${type}' AND entity_id = $old`))),
  ];
  for (const [old, next] of rename) {
    for (const statement of statements) statement.run({ old, next });
  }
}

/** Rewrites exact id values stored under the known detail keys; other JSON is left byte-identical. */
function rewriteEventDetailIds(db, plans) {
  const renameByKey = new Map();
  for (const plan of plans) for (const key of plan.detailKeys) renameByKey.set(key, plan.rename);
  const rewrite = (value) => {
    if (Array.isArray(value)) {
      let changed = false;
      const items = value.map((item) => {
        const result = rewrite(item);
        changed ||= result.changed;
        return result.value;
      });
      return { value: changed ? items : value, changed };
    }
    if (value === null || typeof value !== 'object') return { value, changed: false };
    let changed = false;
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      const rename = renameByKey.get(key);
      if (rename && typeof item === 'string' && rename.has(item)) {
        next[key] = rename.get(item);
        changed = true;
      } else {
        const result = rewrite(item);
        next[key] = result.value;
        changed ||= result.changed;
      }
    }
    return { value: changed ? next : value, changed };
  };
  for (const table of EVENT_DETAIL_TABLES) {
    const update = db.prepare(`UPDATE ${table} SET detail = ? WHERE id = ?`);
    for (const row of db.prepare(`SELECT id, detail FROM ${table}`).all()) {
      let parsed;
      try {
        parsed = JSON.parse(row.detail);
      } catch {
        continue;
      }
      const result = rewrite(parsed);
      if (result.changed) update.run(JSON.stringify(result.value), row.id);
    }
  }
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
  try {
    applySchema(db);
  } catch (error) {
    // A failed migration must not leak the handle: the file stays locked on Windows otherwise.
    closeDatabase(db);
    throw error;
  }
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
