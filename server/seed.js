import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseCsvRecords, parseSpanishDate, parseSpanishNumber, parseSpanishPercent } from './csv.js';
import { withTransaction } from './db.js';
import { CAREER_LEVELS, normalizeDeliveryTarget, normalizeNaq, parseTestingScope } from '../src/people.js';
import { CERTIFICATION_STATUSES, matchCourseByName, matchTalentByName } from '../src/training.js';

/**
 * One-time import of the private seed CSVs (content/seed, never committed). Each dataset is
 * guarded by its own `schema_meta` marker:
 * - marker present → skipped (never re-imported, even if the user later empties the table);
 * - file missing → logged and skipped WITHOUT the marker, so it imports once the file appears;
 * - target table already has rows → nothing imported, the marker is written (user data wins);
 * - otherwise every row is imported in one transaction and the marker is written.
 * The order matters: the training plan links its rows to catalog courses by name.
 *
 * JSON datasets (`format: 'json'`) read one object from the file. `merge: true` datasets skip the
 * "table already has rows" rule: they add only what is missing (matched by name), so they can run
 * over a catalog the user already edited. The three certification datasets share the JSON file
 * extracted from the Excel "Catálogo de Certificaciones" (private, like the CSVs).
 */
export const CERTIFICATIONS_FILE = 'QE-Catálogo de Certificaciones.json';

export const SEED_DATASETS = [
  { key: 'activityCatalog', marker: 'seed_activity_catalog_v1', file: 'QE-Catálogo de actividades por niveles.csv', table: 'activity_catalog', importRecords: importActivityCatalog },
  { key: 'trainingCatalog', marker: 'seed_training_catalog_v1', file: 'QE-Catálogo de Formación.csv', table: 'training_catalog', importRecords: importTrainingCatalog },
  { key: 'trainingPlan', marker: 'seed_training_plan_v1', file: 'QE-Plan de Formación.csv', table: 'training_plan', importRecords: importTrainingPlan },
  { key: 'projects', marker: 'seed_projects_v1', file: 'QE - NAQ Application Portfolio.csv', table: 'projects', importRecords: importProjects },
  { key: 'certificationCatalog', marker: 'seed_certification_catalog_v1', file: CERTIFICATIONS_FILE, format: 'json', merge: true, table: 'training_catalog', importRecords: importCertificationCatalog },
  { key: 'talentCertifications', marker: 'seed_talent_certifications_v1', file: CERTIFICATIONS_FILE, format: 'json', merge: true, table: 'talent_certifications', importRecords: importTalentCertifications },
  { key: 'trainingStrategies', marker: 'seed_training_strategies_v1', file: CERTIFICATIONS_FILE, format: 'json', merge: true, table: 'training_strategies', importRecords: importTrainingStrategies },
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

const list = (value) => (Array.isArray(value) ? value : []);
const cleanText = (value, max = 4000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const finiteOrNull = (value) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

/**
 * "06. Certif. Complementarias": adds every certification missing from the catalog (category
 * "Extras"). An entry already in the catalog (same name, same name without its "(CODE)", or same
 * code) is not duplicated: only its empty "Descripción" and "Precio aprox" are filled.
 */
function importCertificationCatalog(db, data, now) {
  const courses = db.prepare('SELECT id, name, description, approx_price FROM training_catalog ORDER BY created_at, rowid').all();
  const insert = db.prepare(`INSERT INTO training_catalog (id, name, family, istqb_category, types, provider, level, estimated_hours, url, validity_months,
      description, approx_price, no_expiry, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, '', NULL, ?, NULL, ?, ?, 0, ?, ?)`);
  const fill = db.prepare(`UPDATE training_catalog SET description = CASE WHEN description = '' THEN ? ELSE description END,
      approx_price = COALESCE(approx_price, ?), updated_at = ? WHERE id = ?`);
  let count = 0;
  for (const item of list(data?.catalogExtras)) {
    const name = cleanText(item?.name, 200);
    if (!name) continue;
    const description = cleanText(item.description);
    const price = finiteOrNull(item.approxPrice);
    const existing = matchCourseByName(name, courses);
    if (existing) {
      const fillsDescription = (existing.description || '') === '' && description !== '';
      const fillsPrice = (existing.approx_price === null || existing.approx_price === undefined) && price !== null;
      if (fillsDescription || fillsPrice) {
        fill.run(description, price, now, existing.id);
        if (fillsDescription) existing.description = description;
        if (fillsPrice) existing.approx_price = price;
        count += 1;
      }
      continue;
    }
    const id = randomUUID();
    const url = /^https?:\/\//.test(String(item.url ?? '')) ? cleanText(item.url, 2000) : '';
    insert.run(id, name, cleanText(item.family, 120), cleanText(item.istqbCategory, 120) || 'Extras', cleanText(item.types, 120),
      cleanText(item.provider, 120), url, description, price, now, now);
    courses.push({ id, name, description, approx_price: price });
    count += 1;
  }
  return count;
}

/**
 * "05. Matriz Certificaciones": one talent certification per row. Talents are matched by name in
 * any order and without accents (never created); certifications by catalog name. Rows whose
 * talent or certification is not found, and pairs that already exist, are skipped; the skipped
 * count is logged (never the names).
 */
function importTalentCertifications(db, data, now, logger) {
  const talents = db.prepare('SELECT id, name FROM talents').all();
  const courses = db.prepare('SELECT id, name FROM training_catalog ORDER BY created_at, rowid').all();
  const exists = db.prepare('SELECT id FROM talent_certifications WHERE talent_id = ? AND course_id = ?');
  const insert = db.prepare(`INSERT INTO talent_certifications (id, talent_id, course_id, status, obtained_date, obtained_year, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, '', ?, '', ?, ?)`);
  let count = 0;
  let unmatched = 0;
  for (const item of list(data?.talentCertifications)) {
    const talent = matchTalentByName(item?.person, talents);
    const course = matchCourseByName(item?.certification, courses);
    if (!talent || !course) { unmatched += 1; continue; }
    if (exists.get(talent.id, course.id)) continue;
    const status = CERTIFICATION_STATUSES.find((value) => value.toLowerCase() === cleanText(item.status).toLowerCase()) || CERTIFICATION_STATUSES[0];
    const year = finiteOrNull(item.year);
    insert.run(randomUUID(), talent.id, course.id, status, year !== null && Number.isInteger(year) ? year : null, now, now);
    count += 1;
  }
  if (unmatched > 0) logger.log?.(`[seed] ${unmatched} certification row(s) skipped: talent or certification not found.`);
  return count;
}

/** "02. Business Case" / "03. Plan Inversión" / "01. Dashboard": one strategy per year not yet stored. */
function importTrainingStrategies(db, data, now) {
  const exists = db.prepare('SELECT id FROM training_strategies WHERE year = ?');
  const insert = db.prepare(`INSERT INTO training_strategies (id, year, title, business_case, investment_lines, investment_note, category_targets,
      strategic_axes, conclusions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let count = 0;
  for (const item of list(data?.strategies)) {
    const year = finiteOrNull(item?.year);
    if (year === null || !Number.isInteger(year) || exists.get(year)) continue;
    insert.run(randomUUID(), year, cleanText(item.title, 200),
      JSON.stringify(list(item.businessCase).map((entry) => ({ concept: cleanText(entry?.concept, 200), detail: cleanText(entry?.detail) }))),
      JSON.stringify(list(item.investmentLines).map((entry) => ({ line: cleanText(entry?.line, 200), priority: cleanText(entry?.priority, 120), unitPrice: finiteOrNull(entry?.unitPrice), vouchers: finiteOrNull(entry?.vouchers) }))),
      cleanText(item.investmentNote),
      JSON.stringify(list(item.categoryTargets).map((entry) => ({ category: cleanText(entry?.category, 120), target: finiteOrNull(entry?.target) }))),
      JSON.stringify(list(item.strategicAxes).map((entry) => ({ axis: cleanText(entry?.axis, 200), decision: cleanText(entry?.decision, 500) }))),
      JSON.stringify(list(item.conclusions).map((entry) => cleanText(entry, 1000)).filter(Boolean)),
      now, now);
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
    insert.run(randomUUID(), field(record, 'ID'), name, field(record, 'Version'), field(record, 'Client'), normalizeNaq(field(record, 'NAQ')),
      field(record, 'Project Type'), normalizeDeliveryTarget(field(record, 'Delivery Target')), JSON.stringify(parseTestingScope(field(record, 'Testing Scope'))),
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
        const existing = dataset.merge ? 0 : Number(db.prepare(`SELECT COUNT(*) AS count FROM ${dataset.table}`).get().count);
        if (existing > 0) {
          writeMarker.run(dataset.marker, timestamp);
          return { status: 'table_not_empty', count: 0 };
        }
        const records = dataset.format === 'json' ? JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')) : readRecords(filePath);
        const count = dataset.importRecords(db, records, timestamp, logger);
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
