import { randomUUID } from 'node:crypto';
import { getSessionUser } from './auth.js';
import { parseSpanishNumber } from './csv.js';
import { withTransaction } from './db.js';
import { HttpError, readJson, sendJson } from './http.js';
import {
  CAREER_LEVELS, DEFAULT_DELIVERY_PROJECT_STATUS, DEFAULT_PERFORMANCE_STATUS, DELIVERY_PROJECT_STATUSES, PERFORMANCE_STATUSES, TALENT_CATEGORIES, TALENT_PROFILES,
  normalizeDeliveryTarget, normalizeNaq, parseTalentProfiles, parseTestingScope,
} from '../src/people.js';
import { deleteWorkspaceLinks, loadWorkspaceLinks, loadWorkspaceLinksByEntity, parseWorkspaceLinks, replaceWorkspaceLinks, sameWorkspaceLinks } from './workspaceLinks.js';

/**
 * Authenticated CRUD of the "People" and "Proyectos" sections: talents, talent skills, activity
 * catalog, assignments, training catalog, training plan, performance reviews and projects. Every
 * mutation is recorded in `entity_events`; deletes are guarded by relations, and
 * `GET /api/<resource>/<id>/links` lists those relations before deleting.
 */

function validationError(message, field) {
  return new HttpError(400, 'validation_error', message, field);
}

function requireUser(ctx, req) {
  const user = getSessionUser(req, ctx, ctx.now());
  if (!user) throw new HttpError(401, 'unauthorized', 'La sesión no es válida o ha expirado.');
  return user;
}

function rejectMethod(res, ...allowed) {
  res.setHeader('allow', allowed.join(', '));
  throw new HttpError(405, 'method_not_allowed', 'Método no permitido.');
}

function decodeId(rawId) {
  try {
    return decodeURIComponent(rawId);
  } catch {
    throw new HttpError(404, 'not_found', 'El registro no existe.');
  }
}

function joinSpanish(parts) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Field parsers: each returns the column value or throws a 400 naming the body field.
// ---------------------------------------------------------------------------

function text(key, label, { max = 240, required = false } = {}) {
  return {
    key,
    parse(value) {
      if (value === undefined || value === null) value = '';
      if (typeof value === 'number') value = String(value);
      if (typeof value !== 'string') throw validationError(`El campo «${label}» debe ser texto.`, key);
      const trimmed = value.trim();
      if (required && trimmed === '') throw validationError(`El campo «${label}» es obligatorio.`, key);
      if (trimmed.length > max) throw validationError(`El campo «${label}» no puede superar los ${max} caracteres.`, key);
      return trimmed;
    },
  };
}

function oneOf(key, label, allowed) {
  const base = text(key, label);
  return {
    key,
    parse(value) {
      const trimmed = base.parse(value);
      if (trimmed !== '' && !allowed.includes(trimmed)) throw validationError(`El campo «${label}» debe ser uno de: ${allowed.join(', ')}.`, key);
      return trimmed;
    },
  };
}

/** Free text mapped through `normalize` (e.g. legacy English values to their Spanish choice). */
function normalizedText(key, label, normalize, options) {
  const base = text(key, label, options);
  return { key, parse: (value) => normalize(base.parse(value)) };
}

function number(key, label, { min = 0, max = 100000, required = false, integer = false } = {}) {
  return {
    key,
    parse(value) {
      if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
        if (required) throw validationError(`El campo «${label}» es obligatorio.`, key);
        return null;
      }
      const parsed = typeof value === 'number' || typeof value === 'string' ? parseSpanishNumber(String(value).replace('%', '')) : null;
      if (parsed === null) throw validationError(`El campo «${label}» debe ser un número.`, key);
      if (integer && !Number.isInteger(parsed)) throw validationError(`El campo «${label}» debe ser un número entero.`, key);
      if (parsed < min || parsed > max) throw validationError(`El campo «${label}» debe estar entre ${min} y ${max}.`, key);
      return parsed;
    },
  };
}

function date(key, label) {
  return {
    key,
    parse(value) {
      if (value === undefined || value === null || value === '') return '';
      const raw = typeof value === 'string' ? value.trim() : '';
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
      const valid = match && (() => {
        const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
        return parsed.getUTCMonth() === Number(match[2]) - 1 && parsed.getUTCDate() === Number(match[3]);
      })();
      if (!valid) throw validationError(`El campo «${label}» debe ser una fecha válida (AAAA-MM-DD).`, key);
      return raw;
    },
  };
}

function url(key, label) {
  const base = text(key, label, { max: 2000 });
  return {
    key,
    parse(value) {
      const trimmed = base.parse(value);
      if (trimmed === '') return '';
      let protocol = '';
      try {
        protocol = new URL(trimmed).protocol;
      } catch {
        protocol = '';
      }
      if (protocol !== 'http:' && protocol !== 'https:') throw validationError(`El campo «${label}» debe ser una URL http:// o https://.`, key);
      return trimmed;
    },
  };
}

function reference(key, label, table, { required = false } = {}) {
  return {
    key,
    parse(value, db) {
      if (value === undefined || value === null || value === '') {
        if (required) throw validationError(`Selecciona un valor en «${label}».`, key);
        return null;
      }
      if (typeof value !== 'string' || !db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(value)) {
        throw validationError(`El registro seleccionado en «${label}» no existe.`, key);
      }
      return value;
    },
  };
}

function stringList(key, label, { maxItems = 30, maxLength = 60 } = {}) {
  return {
    key,
    parse(value) {
      if (value === undefined || value === null || value === '') return '[]';
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw validationError(`El campo «${label}» debe ser una lista de textos.`, key);
      const items = parseTestingScope(value);
      if (items.length > maxItems) throw validationError(`El campo «${label}» admite como máximo ${maxItems} valores.`, key);
      if (items.some((item) => item.length > maxLength)) throw validationError(`Cada valor de «${label}» puede tener como máximo ${maxLength} caracteres.`, key);
      return JSON.stringify(items);
    },
  };
}

/** Subset of fixed choices stored as a JSON array in TALENT_PROFILES order (e.g. "Perfil"). */
function choiceList(key, label, allowed) {
  return {
    key,
    parse(value) {
      if (value === undefined || value === null || value === '') return '[]';
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw validationError(`El campo «${label}» debe ser una lista de valores.`, key);
      const unknown = value.map((item) => item.trim()).filter((item) => item !== '' && !allowed.includes(item));
      if (unknown.length > 0) throw validationError(`El campo «${label}» solo admite: ${allowed.join(', ')}.`, key);
      return JSON.stringify(allowed.filter((item) => value.some((selected) => selected.trim() === item)));
    },
  };
}

/** Next value of an integer column (max + 1), for append-at-the-end ordering and numeric ids. */
function nextInteger(db, table, column) {
  return Number(db.prepare(`SELECT COALESCE(MAX(CAST(${column} AS INTEGER)), 0) AS value FROM ${table}`).get().value) + 1;
}

/**
 * Many-to-many link of a resource to a master table through a join table. The body carries
 * `key` (array of master ids); records expose `key` and `namesKey` sorted by master name.
 */
function relation(key, namesKey, label, { table, owner, column, master }) {
  return {
    key,
    namesKey,
    parse(value, db) {
      if (value === undefined || value === null || value === '') return [];
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
        throw validationError(`El campo «${label}» debe ser una lista de registros.`, key);
      }
      const ids = [...new Set(value)];
      const lookup = db.prepare(`SELECT id FROM ${master} WHERE id = ?`);
      if (ids.some((id) => !lookup.get(id))) throw validationError(`Alguno de los registros seleccionados en «${label}» no existe.`, key);
      return ids;
    },
    /** Map of owner id → [{ id, name }], for one owner or (without `ownerId`) all of them. */
    load(db, ownerId = null) {
      const rows = db.prepare(`SELECT ${table}.${owner} AS owner_id, ${master}.id, ${master}.name FROM ${table}
        JOIN ${master} ON ${master}.id = ${table}.${column}
        ${ownerId === null ? '' : `WHERE ${table}.${owner} = ?`} ORDER BY ${master}.name COLLATE NOCASE`).all(...(ownerId === null ? [] : [ownerId]));
      const byOwner = new Map();
      for (const row of rows) byOwner.set(row.owner_id, [...(byOwner.get(row.owner_id) || []), { id: row.id, name: row.name }]);
      return byOwner;
    },
    replace(db, ownerId, ids) {
      db.prepare(`DELETE FROM ${table} WHERE ${owner} = ?`).run(ownerId);
      const insert = db.prepare(`INSERT INTO ${table} (${owner}, ${column}) VALUES (?, ?)`);
      for (const id of ids) insert.run(ownerId, id);
    },
    remove(db, ownerId) {
      db.prepare(`DELETE FROM ${table} WHERE ${owner} = ?`).run(ownerId);
    },
  };
}

const sameIds = (left, right) => left.length === right.length && left.every((id) => right.includes(id));

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

const camelCase = (column) => column.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

function mapRow(row) {
  return Object.fromEntries(Object.entries(row).map(([column, value]) => [camelCase(column), value]));
}

const RESOURCES = {
  talents: {
    table: 'talents',
    entityType: 'talent',
    subject: 'el talento',
    notFound: 'El talento no existe.',
    select: `SELECT talents.*, primary_tower.name AS primary_tower_name FROM talents
      LEFT JOIN towers AS primary_tower ON primary_tower.id = talents.primary_tower_id`,
    // Manual order of "Listado de personas" (POST /api/talents/reorder); ties fall back to the name.
    order: 'ORDER BY talents.sort_order, talents.name COLLATE NOCASE',
    fields: [
      ['name', text('name', 'Nombre', { max: 120, required: true })],
      ['location', text('location', 'Ubicación', { max: 120 })],
      ['category', oneOf('category', 'Categoría', TALENT_CATEGORIES)],
      ['profile', choiceList('profiles', 'Perfil', TALENT_PROFILES)],
      ['primary_tower_id', reference('primaryTowerId', 'Tower principal', 'towers')],
    ],
    relations: [
      relation('lobIds', 'lobNames', 'LoBs', { table: 'talent_lobs', owner: 'talent_id', column: 'lob_id', master: 'lobs' }),
      relation('towerIds', 'towerNames', 'Towers', { table: 'talent_towers', owner: 'talent_id', column: 'tower_id', master: 'towers' }),
    ],
    validate(db, values, id, relations) {
      const found = db.prepare('SELECT id FROM talents WHERE name = ? COLLATE NOCASE').get(values.name);
      if (found && found.id !== id) throw new HttpError(409, 'duplicate_record', 'Ya existe un talento con ese nombre.', 'name');
      // The main tower (accountable for billability) must be one of the talent's towers.
      const towerIds = relations.towerIds;
      if (towerIds.length > 0 && !values.primary_tower_id) throw validationError('Selecciona la Tower principal entre las towers del talento.', 'primaryTowerId');
      if (values.primary_tower_id && !towerIds.includes(values.primary_tower_id)) {
        throw validationError('La Tower principal debe ser una de las towers del talento.', 'primaryTowerId');
      }
    },
    deleteChecks: [
      ['SELECT COUNT(*) AS count FROM talent_skills WHERE talent_id = $id', 'skill', 'skills'],
      ['SELECT COUNT(*) AS count FROM assignments WHERE talent_id = $id', 'asignación', 'asignaciones'],
      ['SELECT COUNT(*) AS count FROM training_plan WHERE talent_id = $id', 'fila del plan de formación', 'filas del plan de formación'],
      ['SELECT COUNT(*) AS count FROM performance_reviews WHERE talent_id = $id', 'objetivo de performance review', 'objetivos de performance review'],
      ['SELECT COUNT(*) AS count FROM delivery_projects WHERE talent_id = $id', 'proyecto', 'proyectos'],
    ],
    insertDefaults: (db) => ({ sort_order: nextInteger(db, 'talents', 'sort_order') }),
    describe: (row) => row.name,
    // `profile` holds a JSON array; the API exposes it as `profiles`.
    map: ({ profile, ...record }) => ({ ...record, profiles: parseTalentProfiles(profile) }),
  },
  'activity-catalog': {
    table: 'activity_catalog',
    entityType: 'activity',
    subject: 'la actividad',
    notFound: 'La actividad no existe.',
    select: 'SELECT activity_catalog.* FROM activity_catalog',
    order: 'ORDER BY activity_catalog.sort_order, activity_catalog.name',
    // l1..l7 keep the raw cell text: ✅ required, ⚪ optional, other text a specific role, '' not applicable.
    fields: [
      ['name', text('name', 'Actividad (Skill)', { max: 200, required: true })],
      ['category', text('category', 'Skill - Categoría', { max: 120 })],
      ...CAREER_LEVELS.map((level) => [level.toLowerCase(), text(level.toLowerCase(), level, { max: 120 })]),
    ],
    // Seeded ids are the catalog's numeric "ID" column, so new activities continue that sequence.
    newId: (db) => String(nextInteger(db, 'activity_catalog', 'id')),
    insertDefaults: (db) => ({ sort_order: nextInteger(db, 'activity_catalog', 'sort_order') }),
    deleteChecks: [
      ['SELECT COUNT(*) AS count FROM talent_skills WHERE activity_id = $id', 'skill de talento', 'skills de talento'],
    ],
    describe: (row) => row.name,
    map: (record) => ({ ...record, levels: Object.fromEntries(CAREER_LEVELS.map((level) => [level, record[level.toLowerCase()] ?? ''])) }),
  },
  'talent-skills': {
    table: 'talent_skills',
    entityType: 'talent_skill',
    subject: 'la skill',
    notFound: 'La skill no existe.',
    select: `SELECT talent_skills.*, talents.name AS talent_name, activity_catalog.name AS activity_name,
        activity_catalog.category AS activity_category
      FROM talent_skills JOIN talents ON talents.id = talent_skills.talent_id
      LEFT JOIN activity_catalog ON activity_catalog.id = talent_skills.activity_id`,
    order: 'ORDER BY talents.name COLLATE NOCASE, activity_catalog.sort_order, activity_catalog.name',
    fields: [
      ['talent_id', reference('talentId', 'Persona', 'talents', { required: true })],
      ['activity_id', reference('activityId', 'Actividad (Skill)', 'activity_catalog', { required: true })],
      ['current_level', number('currentLevel', 'Nivel actual', { min: 1, max: 4, required: true, integer: true })],
      ['target_level', number('targetLevel', 'Nivel objetivo', { min: 1, max: 4, integer: true })],
      ['certificate', text('certificate', 'Certificado', { max: 200 })],
      ['comment', text('comment', 'Comentario', { max: 2000 })],
      ['career_level', oneOf('careerLevel', 'Nivel', CAREER_LEVELS)],
    ],
    validate(db, values, id) {
      const found = db.prepare('SELECT id FROM talent_skills WHERE talent_id = ? AND activity_id = ?').get(values.talent_id, values.activity_id);
      if (found && found.id !== id) throw new HttpError(409, 'duplicate_record', 'Esta persona ya tiene registrada esa actividad.', 'activityId');
      // "Nivel" must be one the activity has configured in the catalog. Rows saved before this rule
      // keep their level while neither the level nor the activity changes.
      if (!values.career_level) return;
      const stored = id ? db.prepare('SELECT activity_id, career_level FROM talent_skills WHERE id = ?').get(id) : null;
      if (stored && stored.activity_id === values.activity_id && stored.career_level === values.career_level) return;
      const activity = db.prepare('SELECT * FROM activity_catalog WHERE id = ?').get(values.activity_id);
      if (!String(activity?.[values.career_level.toLowerCase()] ?? '').trim()) {
        throw validationError(`El nivel ${values.career_level} no está configurado para la actividad seleccionada.`, 'careerLevel');
      }
    },
    deleteChecks: [],
    describe: (row) => row.activity_name || row.activity_id,
  },
  assignments: {
    table: 'assignments',
    entityType: 'assignment',
    subject: 'la asignación',
    notFound: 'La asignación no existe.',
    select: `SELECT assignments.*, talents.name AS talent_name, towers.name AS tower_name, lobs.name AS lob_name, clients.name AS client_name
      FROM assignments JOIN talents ON talents.id = assignments.talent_id
      LEFT JOIN towers ON towers.id = assignments.tower_id LEFT JOIN lobs ON lobs.id = assignments.lob_id
      LEFT JOIN clients ON clients.id = assignments.client_id`,
    order: 'ORDER BY talents.name COLLATE NOCASE, assignments.created_at',
    fields: [
      ['talent_id', reference('talentId', 'Talento', 'talents', { required: true })],
      ['tower_id', reference('towerId', 'Tower', 'towers')],
      ['lob_id', reference('lobId', 'LoB', 'lobs')],
      ['client_id', reference('clientId', 'Cliente', 'clients')],
      ['percentage', number('percentage', '% asignación', { min: 0, max: 100, required: true })],
      ['start_date', date('startDate', 'Fecha inicio')],
      ['end_date', date('endDate', 'Fecha fin')],
    ],
    validate(db, values) {
      if (values.start_date && values.end_date && values.end_date < values.start_date) {
        throw validationError('La fecha fin no puede ser anterior a la fecha inicio.', 'endDate');
      }
    },
    deleteChecks: [],
    describe: (row) => row.talent_name,
  },
  'performance-reviews': {
    table: 'performance_reviews',
    entityType: 'performance_review',
    subject: 'el objetivo',
    notFound: 'El objetivo de performance review no existe.',
    select: `SELECT performance_reviews.*, talents.name AS talent_name
      FROM performance_reviews JOIN talents ON talents.id = performance_reviews.talent_id`,
    order: 'ORDER BY performance_reviews.year DESC, talents.name COLLATE NOCASE, performance_reviews.created_at',
    fields: [
      ['talent_id', reference('talentId', 'Talento', 'talents', { required: true })],
      ['year', number('year', 'Año', { min: 2000, max: 2100, required: true, integer: true })],
      ['objective', text('objective', 'Objetivo', { max: 1000, required: true })],
      ['status', oneOf('status', 'Estado', PERFORMANCE_STATUSES)],
      ['link_title', text('linkTitle', 'Título del enlace', { max: 200 })],
      ['link_url', url('linkUrl', 'Enlace')],
      ['notes', text('notes', 'Notas', { max: 2000 })],
    ],
    validate(db, values) {
      if (!values.status) values.status = DEFAULT_PERFORMANCE_STATUS;
    },
    // A create body may carry `objectives: [{ objective, status?, linkTitle?, linkUrl?, notes? }]`
    // with the shared talentId/year: each item becomes one row, all in one transaction.
    batchKey: 'objectives',
    batchLabel: 'Objetivo',
    batchSharedKeys: ['talentId', 'year'],
    deleteChecks: [],
    describe: (row) => row.objective,
  },
  'training-catalog': {
    table: 'training_catalog',
    entityType: 'training_course',
    subject: 'la formación',
    notFound: 'La formación no existe.',
    select: 'SELECT training_catalog.* FROM training_catalog',
    order: 'ORDER BY training_catalog.name COLLATE NOCASE',
    fields: [
      ['name', text('name', 'Formación', { max: 200, required: true })],
      ['family', text('family', 'Familia', { max: 120 })],
      ['istqb_category', text('istqbCategory', 'Categoría ISTQB', { max: 120 })],
      ['types', text('types', 'Tipos', { max: 120 })],
      ['provider', text('provider', 'Proveedor', { max: 120 })],
      ['level', text('level', 'Nivel', { max: 120 })],
      ['estimated_hours', number('estimatedHours', 'Horas estimadas')],
      ['url', url('url', 'Enlace')],
      ['validity_months', number('validityMonths', 'Vigencia/Meses', { max: 600, integer: true })],
    ],
    deleteChecks: [
      ['SELECT COUNT(*) AS count FROM training_plan WHERE course_id = $id', 'fila del plan de formación', 'filas del plan de formación'],
    ],
    describe: (row) => row.name,
  },
  'training-plan': {
    table: 'training_plan',
    entityType: 'training_plan',
    subject: 'la fila del plan',
    notFound: 'La fila del plan de formación no existe.',
    select: `SELECT training_plan.*, talents.name AS talent_name, training_catalog.name AS catalog_course_name
      FROM training_plan JOIN talents ON talents.id = training_plan.talent_id
      LEFT JOIN training_catalog ON training_catalog.id = training_plan.course_id`,
    order: 'ORDER BY talents.name COLLATE NOCASE, training_plan.start_date, training_plan.created_at',
    fields: [
      ['talent_id', reference('talentId', 'Persona', 'talents', { required: true })],
      ['task', text('task', 'Tarea', { max: 200 })],
      ['course_id', reference('courseId', 'Curso/Certificado', 'training_catalog')],
      ['course_name', text('courseName', 'Curso/Certificado', { max: 200 })],
      ['family', text('family', 'Familia', { max: 120 })],
      ['estimated_hours', number('estimatedHours', 'Horas estimadas')],
      ['dedicated_hours', number('dedicatedHours', 'Horas dedicadas totales')],
      ['progress', number('progress', 'Avance', { max: 1000 })],
      ['status', text('status', 'Estado', { max: 60 })],
      ['start_date', date('startDate', 'Fecha inicio')],
      ['planned_end_date', date('plannedEndDate', 'Fecha fin prevista')],
      ['actual_end_date', date('actualEndDate', 'Fecha fin real')],
      ['evidence', text('evidence', 'Evidencia', { max: 2000 })],
      ['next_step', text('nextStep', 'Próximo paso', { max: 2000 })],
      ['expiry_date', date('expiryDate', 'Fecha de caducidad')],
    ],
    /** A catalog course wins and its name is snapshotted; otherwise the free-text name is required. */
    validate(db, values) {
      if (values.course_id) {
        values.course_name = db.prepare('SELECT name FROM training_catalog WHERE id = ?').get(values.course_id).name;
      } else if (!values.course_name) {
        throw validationError('Selecciona un curso del catálogo o escribe su nombre.', 'courseName');
      }
    },
    deleteChecks: [],
    describe: (row) => row.course_name,
    map: (record) => ({ ...record, courseLabel: record.catalogCourseName || record.courseName }),
  },
  projects: {
    table: 'projects',
    entityType: 'project',
    subject: 'el proyecto',
    notFound: 'El proyecto no existe.',
    select: 'SELECT projects.* FROM projects',
    order: 'ORDER BY projects.application_name COLLATE NOCASE',
    fields: [
      ['code', text('code', 'ID', { max: 60 })],
      ['application_name', text('applicationName', 'Application Name', { max: 200, required: true })],
      ['version', text('version', 'Version', { max: 60 })],
      ['client', text('client', 'Client', { max: 200 })],
      ['naq', normalizedText('naq', 'NAQ', normalizeNaq, { max: 60 })],
      ['project_type', text('projectType', 'Tipo de proyecto', { max: 120 })],
      ['delivery_target', normalizedText('deliveryTarget', 'Delivery target', normalizeDeliveryTarget, { max: 120 })],
      ['testing_scope', stringList('testingScope', 'Alcance de pruebas')],
      ['qa_service_type', text('qaServiceType', 'Tipo de servicio QA', { max: 120 })],
      ['phase', text('phase', 'Fase', { max: 120 })],
      ['risk_level', text('riskLevel', 'Nivel de riesgo', { max: 60 })],
      ['automation', text('automation', 'Automatización', { max: 120 })],
      ['status', text('status', 'Estado', { max: 120 })],
      ['project_url', url('projectUrl', 'URL del proyecto')],
      ['qa_owner', text('qaOwner', 'Responsable QA', { max: 200 })],
      ['qa_entry_date', date('qaEntryDate', 'Fecha de entrada QA')],
      ['target_release_date', date('targetReleaseDate', 'Fecha objetivo de release')],
      ['comments', text('comments', 'Comentarios', { max: 4000 })],
      ['created_date', date('createdDate', 'Fecha de creación')],
      ['attachments', text('attachments', 'Adjuntos', { max: 500 })],
    ],
    deleteChecks: [],
    describe: (row) => row.application_name,
    map: (record) => ({ ...record, testingScope: parseTestingScope(record.testingScope) }),
  },
  'delivery-projects': {
    table: 'delivery_projects',
    entityType: 'delivery_project',
    subject: 'el proyecto',
    notFound: 'El proyecto no existe.',
    select: `SELECT delivery_projects.*, clients.name AS client_name, towers.name AS tower_name, talents.name AS talent_name
      FROM delivery_projects LEFT JOIN clients ON clients.id = delivery_projects.client_id
      LEFT JOIN towers ON towers.id = delivery_projects.tower_id LEFT JOIN talents ON talents.id = delivery_projects.talent_id`,
    order: 'ORDER BY delivery_projects.name COLLATE NOCASE, delivery_projects.created_at',
    fields: [
      ['name', text('name', 'Nombre', { max: 200, required: true })],
      ['client_id', reference('clientId', 'Cliente', 'clients', { required: true })],
      ['tower_id', reference('towerId', 'Tower', 'towers')],
      ['talent_id', reference('talentId', 'Responsable', 'talents')],
      ['status', oneOf('status', 'Estado', DELIVERY_PROJECT_STATUSES)],
      ['start_date', date('startDate', 'Fecha inicio')],
      ['end_date', date('endDate', 'Fecha fin')],
      ['description', text('description', 'Descripción', { max: 4000 })],
      ['next_milestone_date', date('nextMilestoneDate', 'Fecha próximo hito')],
      ['next_milestone', text('nextMilestone', 'Próximo hito', { max: 500 })],
      ['next_action_date', date('nextActionDate', 'Fecha próxima acción')],
    ],
    validate(db, values) {
      if (!values.status) values.status = DEFAULT_DELIVERY_PROJECT_STATUS;
      if (values.start_date && values.end_date && values.end_date < values.start_date) {
        throw validationError('La fecha fin no puede ser anterior a la fecha inicio.', 'endDate');
      }
    },
    // "Enlaces": the shared Workspace links (workspace_links.entity_type).
    linkEntityType: 'delivery_project',
    deleteChecks: [],
    describe: (row) => row.name,
  },
};

/**
 * `loaded` is `[[relation, Map(ownerId → [{ id, name }])]]` from loadRelations; `links` (resources
 * with `linkEntityType`) is a Map(ownerId → Workspace links).
 */
function toRecord(resource, row, loaded = [], links = null) {
  const record = mapRow(row);
  for (const [rel, byOwner] of loaded) {
    const items = byOwner.get(row.id) || [];
    record[rel.key] = items.map((item) => item.id);
    record[rel.namesKey] = items.map((item) => item.name);
  }
  if (resource.linkEntityType) record.links = links?.get(row.id) || [];
  return resource.map ? resource.map(record) : record;
}

function loadRelations(db, resource, ownerId = null) {
  return (resource.relations || []).map((rel) => [rel, rel.load(db, ownerId)]);
}

function getRow(db, resource, id) {
  return db.prepare(`${resource.select} WHERE ${resource.table}.id = ?`).get(id);
}

function getRecord(db, resource, id) {
  const links = resource.linkEntityType ? new Map([[id, loadWorkspaceLinks(db, resource.linkEntityType, id)]]) : null;
  return toRecord(resource, getRow(db, resource, id), loadRelations(db, resource, id), links);
}

function appendEvent(db, resource, { id, user, action, detail = {}, now }) {
  db.prepare('INSERT INTO entity_events (entity_type, entity_id, user_id, user_name, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(resource.entityType, id, user?.id ?? null, user?.name ?? 'Sistema', action, JSON.stringify(detail), now);
}

function listResource(ctx, req, res, resource) {
  requireUser(ctx, req);
  const rows = ctx.db.prepare(`${resource.select} ${resource.order}`).all();
  const loaded = loadRelations(ctx.db, resource);
  const links = resource.linkEntityType ? loadWorkspaceLinksByEntity(ctx.db, resource.linkEntityType) : null;
  sendJson(res, 200, { records: rows.map((row) => toRecord(resource, row, loaded, links)) });
}

/** Parses, validates and inserts one record inside the caller's transaction; returns its id. */
function insertRecord(db, resource, body, { user, now }) {
  const id = resource.newId ? resource.newId(db) : randomUUID();
  const values = {};
  for (const [column, parser] of resource.fields) values[column] = parser.parse(body[parser.key], db);
  const relations = Object.fromEntries((resource.relations || []).map((rel) => [rel.key, rel.parse(body[rel.key], db)]));
  const links = resource.linkEntityType ? parseWorkspaceLinks(body.links) : [];
  resource.validate?.(db, values, null, relations);
  Object.assign(values, resource.insertDefaults?.(db) || {});
  const columns = ['id', ...Object.keys(values), 'created_at', 'updated_at'];
  db.prepare(`INSERT INTO ${resource.table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .run(id, ...Object.values(values), now, now);
  for (const rel of resource.relations || []) rel.replace(db, id, relations[rel.key]);
  if (resource.linkEntityType) replaceWorkspaceLinks(db, resource.linkEntityType, id, links, user, now);
  appendEvent(db, resource, { id, user, action: 'created', now });
  return id;
}

const MAX_BATCH_ITEMS = 50;

async function createResource(ctx, req, res, resource) {
  const user = requireUser(ctx, req);
  const body = await readJson(req);
  const now = ctx.now().toISOString();
  const batch = resource.batchKey && Object.hasOwn(body, resource.batchKey) ? body[resource.batchKey] : null;
  if (batch === null) {
    const id = withTransaction(ctx.db, () => insertRecord(ctx.db, resource, body, { user, now }));
    sendJson(res, 201, { record: getRecord(ctx.db, resource, id) });
    return;
  }
  // Batch create: every item shares the body's other fields; one failing item rolls back all.
  const { batchKey, batchLabel } = resource;
  if (!Array.isArray(batch) || batch.length === 0 || batch.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw validationError(`Añade al menos un ${batchLabel.toLowerCase()}.`, batchKey);
  }
  if (batch.length > MAX_BATCH_ITEMS) throw validationError(`Como máximo ${MAX_BATCH_ITEMS} registros a la vez.`, batchKey);
  const { [batchKey]: _items, ...shared } = body;
  const ids = withTransaction(ctx.db, () => batch.map((item, index) => {
    try {
      return insertRecord(ctx.db, resource, { ...shared, ...item }, { user, now });
    } catch (error) {
      // Item-level errors name their position, e.g. "Objetivo 2: El campo «Objetivo» es obligatorio.".
      const itemField = error instanceof HttpError && error.status === 400 && error.field && !resource.batchSharedKeys.includes(error.field);
      if (itemField) {
        throw new HttpError(400, error.code, `${batchLabel} ${index + 1}: ${error.message}`, batchKey);
      }
      throw error;
    }
  }));
  sendJson(res, 201, { records: ids.map((id) => getRecord(ctx.db, resource, id)) });
}

async function updateResource(ctx, req, res, resource, rawId) {
  const user = requireUser(ctx, req);
  const id = decodeId(rawId);
  const body = await readJson(req);
  const now = ctx.now().toISOString();
  withTransaction(ctx.db, () => {
    const existing = ctx.db.prepare(`SELECT * FROM ${resource.table} WHERE id = ?`).get(id);
    if (!existing) throw new HttpError(404, 'not_found', resource.notFound);
    const merged = { ...existing };
    for (const [column, parser] of resource.fields) {
      if (Object.hasOwn(body, parser.key)) merged[column] = parser.parse(body[parser.key], ctx.db);
    }
    // Relations missing from the body keep their stored ids (partial update).
    const relations = {};
    const changedRelations = [];
    for (const rel of resource.relations || []) {
      const stored = (rel.load(ctx.db, id).get(id) || []).map((item) => item.id);
      relations[rel.key] = Object.hasOwn(body, rel.key) ? rel.parse(body[rel.key], ctx.db) : stored;
      if (!sameIds(relations[rel.key], stored)) changedRelations.push(rel);
    }
    // Links missing from the body are kept; present ones replace the stored list when they differ.
    const nextLinks = resource.linkEntityType && Object.hasOwn(body, 'links') ? parseWorkspaceLinks(body.links) : null;
    const linksChanged = nextLinks !== null && !sameWorkspaceLinks(nextLinks, loadWorkspaceLinks(ctx.db, resource.linkEntityType, id));
    resource.validate?.(ctx.db, merged, id, relations);
    const changed = resource.fields.map(([column]) => column).filter((column) => merged[column] !== existing[column]);
    if (changed.length === 0 && changedRelations.length === 0 && !linksChanged) return;
    ctx.db.prepare(`UPDATE ${resource.table} SET ${changed.map((column) => `${column} = ?, `).join('')}updated_at = ? WHERE id = ?`)
      .run(...changed.map((column) => merged[column]), now, id);
    for (const rel of changedRelations) rel.replace(ctx.db, id, relations[rel.key]);
    if (linksChanged) replaceWorkspaceLinks(ctx.db, resource.linkEntityType, id, nextLinks, user, now);
    const fields = [...changed.map(camelCase), ...changedRelations.map((rel) => rel.key), ...(linksChanged ? ['links'] : [])];
    appendEvent(ctx.db, resource, { id, user, action: 'updated', detail: { fields }, now });
  });
  sendJson(res, 200, { record: getRecord(ctx.db, resource, id) });
}

/**
 * Relations that block deleting a record, from its `deleteChecks`: `[{ count, label, text }]`
 * (only non-zero counts), plus the full Spanish explanation in `message` ('' when none).
 */
function collectDeleteLinks(db, resource, row) {
  const links = [];
  for (const [sql, singular, plural] of resource.deleteChecks) {
    const count = Number(db.prepare(sql).get({ id: row.id })?.count ?? 0);
    if (count > 0) links.push({ count, label: plural, text: `${count} ${count === 1 ? singular : plural}` });
  }
  const message = links.length > 0
    ? `No se puede eliminar ${resource.subject} «${resource.describe(row)}»: tiene vínculos con ${joinSpanish(links.map((link) => link.text))}.`
    : '';
  return { links, message };
}

function deleteResource(ctx, req, res, resource, rawId) {
  requireUser(ctx, req);
  const id = decodeId(rawId);
  withTransaction(ctx.db, () => {
    const row = getRow(ctx.db, resource, id);
    if (!row) throw new HttpError(404, 'not_found', resource.notFound);
    const { links, message } = collectDeleteLinks(ctx.db, resource, row);
    if (links.length > 0) throw new HttpError(409, `${resource.entityType}_in_use`, message);
    ctx.db.prepare('DELETE FROM entity_events WHERE entity_type = ? AND entity_id = ?').run(resource.entityType, id);
    for (const rel of resource.relations || []) rel.remove(ctx.db, id);
    if (resource.linkEntityType) deleteWorkspaceLinks(ctx.db, resource.linkEntityType, id);
    ctx.db.prepare(`DELETE FROM ${resource.table} WHERE id = ?`).run(id);
  });
  sendJson(res, 200, { deleted: true });
}

/** `GET /api/<resource>/<id>/links`: what would block deleting the record, before asking to confirm. */
function getDeleteLinks(ctx, req, res, resource, rawId) {
  requireUser(ctx, req);
  const id = decodeId(rawId);
  const row = getRow(ctx.db, resource, id);
  if (!row) throw new HttpError(404, 'not_found', resource.notFound);
  const { links, message } = collectDeleteLinks(ctx.db, resource, row);
  sendJson(res, 200, { blocked: links.length > 0, links, message });
}

/**
 * `POST /api/talents/reorder` with `{ ids }`: the manual order of "Listado de personas". Listed
 * talents take positions 1..n in that order; unlisted ones keep their relative order after them.
 * Only `sort_order` changes (no other column, no `updated_at`, no history event).
 */
async function reorderTalents(ctx, req, res) {
  requireUser(ctx, req);
  const body = await readJson(req);
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || id === '') || new Set(ids).size !== ids.length) {
    throw validationError('El orden debe ser una lista de talentos sin repetir.', 'ids');
  }
  const order = withTransaction(ctx.db, () => {
    const current = ctx.db.prepare('SELECT id, sort_order FROM talents ORDER BY sort_order, name COLLATE NOCASE').all();
    const known = new Set(current.map((row) => row.id));
    if (ids.some((id) => !known.has(id))) throw validationError('Alguno de los talentos indicados no existe.', 'ids');
    const listed = new Set(ids);
    const next = [...ids, ...current.map((row) => row.id).filter((id) => !listed.has(id))];
    const stored = new Map(current.map((row) => [row.id, row.sort_order]));
    const update = ctx.db.prepare('UPDATE talents SET sort_order = ? WHERE id = ?');
    next.forEach((id, index) => { if (stored.get(id) !== index + 1) update.run(index + 1, id); });
    return next;
  });
  sendJson(res, 200, { ids: order });
}

const RESOURCE_NAMES = Object.keys(RESOURCES).join('|');
const COLLECTION_PATTERN = new RegExp(`^/api/(${RESOURCE_NAMES})$`);
const ITEM_PATTERN = new RegExp(`^/api/(${RESOURCE_NAMES})/([^/]+)$`);
const LINKS_PATTERN = new RegExp(`^/api/(${RESOURCE_NAMES})/([^/]+)/links$`);

/**
 * Routes the People/Proyectos endpoints. Returns the handler's promise, or null when the path
 * is not one of them (the caller then keeps routing). CSRF is checked by the caller.
 */
export function routeOperationsApi(ctx, req, res, pathname) {
  if (pathname === '/api/talents/reorder') {
    if (req.method !== 'POST') return rejectMethod(res, 'POST');
    return reorderTalents(ctx, req, res);
  }
  const links = LINKS_PATTERN.exec(pathname);
  if (links) {
    if (req.method !== 'GET') return rejectMethod(res, 'GET');
    return Promise.resolve(getDeleteLinks(ctx, req, res, RESOURCES[links[1]], links[2]));
  }
  const collection = COLLECTION_PATTERN.exec(pathname);
  if (collection) {
    const resource = RESOURCES[collection[1]];
    if (req.method === 'GET') return Promise.resolve(listResource(ctx, req, res, resource));
    if (req.method === 'POST') return createResource(ctx, req, res, resource);
    return rejectMethod(res, 'GET', 'POST');
  }
  const item = ITEM_PATTERN.exec(pathname);
  if (item) {
    const resource = RESOURCES[item[1]];
    if (req.method === 'PATCH') return updateResource(ctx, req, res, resource, item[2]);
    if (req.method === 'DELETE') return Promise.resolve(deleteResource(ctx, req, res, resource, item[2]));
    return rejectMethod(res, 'PATCH', 'DELETE');
  }
  return null;
}
