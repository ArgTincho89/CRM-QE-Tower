import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseCsvRecords, parseSpanishDate, parseSpanishNumber, parseSpanishPercent } from './csv.js';
import { withTransaction } from './db.js';
import { CAREER_LEVELS, parseTestingScope } from '../src/people.js';

/**
 * One-time import of the private seed CSVs (content/seed, never committed). Each dataset is
 * guarded by its own `schema_meta` marker:
 * - marker present → skipped (never re-imported, even if the user later empties the table);
 * - file missing → logged and skipped WITHOUT the marker, so it imports once the file appears;
 * - target table already has rows → nothing imported, the marker is written (user data wins);
 * - otherwise every row is imported in one transaction and the marker is written.
 * The order matters: the training plan links its rows to catalog courses by name.
 */
export const SEED_DATASETS = [
  { key: 'activityCatalog', marker: 'seed_activity_catalog_v1', file: 'QE-Catálogo de actividades por niveles.csv', table: 'activity_catalog', importRecords: importActivityCatalog },
  { key: 'trainingCatalog', marker: 'seed_training_catalog_v1', file: 'QE-Catálogo de Formación.csv', table: 'training_catalog', importRecords: importTrainingCatalog },
  { key: 'trainingPlan', marker: 'seed_training_plan_v1', file: 'QE-Plan de Formación.csv', table: 'training_plan', importRecords: importTrainingPlan },
  { key: 'projects', marker: 'seed_projects_v1', file: 'QE - NAQ Application Portfolio.csv', table: 'projects', importRecords: importProjects },
];

const nfc = (value) => String(value ?? '').normalize('NFC');
const nameKey = (value) => nfc(value).trim().replace(/\s+/g, ' ').toLowerCase();

/** Finds the CSV even when the file system stores the accented name in another Unicode form. */
function findSeedFile(seedDir, fileName) {
  if (!seedDir || !existsSync(seedDir)) return null;
  const wanted = nfc(fileName);
  const match = readdirSync(seedDir).find((name) => nfc(name) === wanted);
  return match ? path.join(seedDir, match) : null;
}

/** CSV records re-keyed with NFC header names, so lookups by accented header always match. */
function readRecords(filePath) {
  return parseCsvRecords(readFileSync(filePath, 'utf8'))
    .map((record) => Object.fromEntries(Object.entries(record).map(([key, value]) => [nfc(key), value])));
}

const field = (record, name) => record[nfc(name)] ?? '';

function importActivityCatalog(db, records, now) {
  const insert = db.prepare(`INSERT INTO activity_catalog (id, name, category, l1, l2, l3, l4, l5, l6, l7, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const usedIds = new Set();
  let count = 0;
  records.forEach((record, index) => {
    const name = field(record, 'Actividad (Skill)');
    if (!name) return;
    let id = field(record, 'ID') || String(index + 1);
    if (usedIds.has(id)) id = `${id}-${index + 1}`;
    usedIds.add(id);
    insert.run(id, name, field(record, 'Skill - Categoría'), ...CAREER_LEVELS.map((level) => field(record, level)), index + 1, now);
    count += 1;
  });
  return count;
}

function importTrainingCatalog(db, records, now) {
  const insert = db.prepare(`INSERT INTO training_catalog (id, name, family, istqb_category, types, provider, level, estimated_hours, url, validity_months, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let count = 0;
  for (const record of records) {
    const name = field(record, 'Formación');
    if (!name) continue;
    const validity = parseSpanishNumber(field(record, 'Vigencia/Meses'));
    insert.run(randomUUID(), name, field(record, 'Familia'), field(record, 'Categoría ISTQB'), field(record, 'Tipos'),
      field(record, 'Proveedor'), field(record, 'Nivel'), parseSpanishNumber(field(record, 'Horas Estimadas')),
      field(record, 'Enlace'), validity === null ? null : Math.round(validity), now, now);
    count += 1;
  }
  return count;
}

/** Creates (or reuses, by case-insensitive name) the talent of every plan row and links the row to it. */
function importTrainingPlan(db, records, now) {
  const talents = new Map(db.prepare('SELECT id, name FROM talents').all().map((row) => [nameKey(row.name), row.id]));
  const courses = new Map();
  for (const row of db.prepare('SELECT id, name FROM training_catalog ORDER BY created_at, rowid').all()) {
    if (!courses.has(nameKey(row.name))) courses.set(nameKey(row.name), row);
  }
  const insertTalent = db.prepare('INSERT INTO talents (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)');
  const insert = db.prepare(`INSERT INTO training_plan (id, talent_id, task, course_id, course_name, family, estimated_hours, dedicated_hours, progress,
      status, start_date, planned_end_date, actual_end_date, evidence, next_step, expiry_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let count = 0;
  for (const record of records) {
    const person = nfc(field(record, 'QA')).trim().replace(/\s+/g, ' ');
    if (!person) continue;
    let talentId = talents.get(nameKey(person));
    if (!talentId) {
      talentId = randomUUID();
      insertTalent.run(talentId, person, now, now);
      talents.set(nameKey(person), talentId);
    }
    const courseText = field(record, 'Curso/Certificado');
    const course = courses.get(nameKey(courseText)) || null;
    insert.run(randomUUID(), talentId, field(record, 'Tarea'), course?.id ?? null, course?.name ?? courseText, field(record, 'Familia'),
      parseSpanishNumber(field(record, 'Horas Estimadas')), parseSpanishNumber(field(record, 'Horas dedicadas totales')),
      parseSpanishPercent(field(record, 'Avance')), field(record, 'Estado'), parseSpanishDate(field(record, 'Fecha Inicio')),
      parseSpanishDate(field(record, 'Fecha Fin Prevista')), parseSpanishDate(field(record, 'Fecha Fin Real')),
      field(record, 'Evidencia'), field(record, 'Próximo Paso'), parseSpanishDate(field(record, 'Fecha de caducidad')), now, now);
    count += 1;
  }
  return count;
}

function importProjects(db, records, now) {
  const insert = db.prepare(`INSERT INTO projects (id, code, application_name, version, client, naq, project_type, delivery_target, testing_scope,
      qa_service_type, phase, risk_level, automation, status, project_url, qa_owner, qa_entry_date, target_release_date, comments,
      created_date, attachments, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let count = 0;
  for (const record of records) {
    const name = field(record, 'Application Name');
    if (!name) continue;
    insert.run(randomUUID(), field(record, 'ID'), name, field(record, 'Version'), field(record, 'Client'), field(record, 'NAQ'),
      field(record, 'Project Type'), field(record, 'Delivery Target'), JSON.stringify(parseTestingScope(field(record, 'Testing Scope'))),
      field(record, 'QA Service Type'), field(record, 'Phase'), field(record, 'Risk Level'), field(record, 'Automation'),
      field(record, 'Status'), field(record, 'Project URL'), field(record, 'QA Owner'), parseSpanishDate(field(record, 'QA Entry Date')),
      parseSpanishDate(field(record, 'Target Release Date')), field(record, 'Comments'), parseSpanishDate(field(record, 'Created')),
      field(record, 'Attachments'), now, now);
    count += 1;
  }
  return count;
}

/**
 * Imports every dataset whose rules allow it (see SEED_DATASETS). A failing dataset is rolled
 * back and logged without a marker; the others still run. Returns `{ [key]: { status, count } }`
 * with status 'imported' | 'already_seeded' | 'missing_file' | 'table_not_empty' | 'failed'.
 * Logs only file names and counts, never row contents.
 */
export function seedFromContent(db, seedDir, { logger = console, now = new Date() } = {}) {
  const summary = {};
  const timestamp = now.toISOString();
  const markerOf = db.prepare('SELECT value FROM schema_meta WHERE key = ?');
  const writeMarker = db.prepare('INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)');
  for (const dataset of SEED_DATASETS) {
    if (markerOf.get(dataset.marker)) {
      summary[dataset.key] = { status: 'already_seeded', count: 0 };
      continue;
    }
    const filePath = findSeedFile(seedDir, dataset.file);
    if (!filePath) {
      logger.log?.(`[seed] ${dataset.file} not found; ${dataset.table} will be imported when it appears.`);
      summary[dataset.key] = { status: 'missing_file', count: 0 };
      continue;
    }
    try {
      summary[dataset.key] = withTransaction(db, () => {
        const existing = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${dataset.table}`).get().count);
        if (existing > 0) {
          writeMarker.run(dataset.marker, timestamp);
          return { status: 'table_not_empty', count: 0 };
        }
        const count = dataset.importRecords(db, readRecords(filePath), timestamp);
        writeMarker.run(dataset.marker, timestamp);
        return { status: 'imported', count };
      });
      if (summary[dataset.key].status === 'imported') logger.log?.(`[seed] imported ${summary[dataset.key].count} row(s) into ${dataset.table}.`);
    } catch (error) {
      logger.error?.(`[seed] ${dataset.file} could not be imported: ${error?.message ?? error}`);
      summary[dataset.key] = { status: 'failed', count: 0 };
    }
  }
  return summary;
}
