import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import {
  clearSessionCookie,
  createLoginThrottle,
  createSession,
  destroySession,
  getSessionUser,
  hashPassword,
  readSessionToken,
  serializeSessionCookie,
  timingSafeStringEquals,
  validatePassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verifyLoginPassword,
} from './auth.js';
import { withTransaction } from './db.js';
import { COMPLETED_INITIATIVE_STAGE, initiativeCategories, initiativePriorities, initiativeStages, initiativeStatuses, opportunityOrigins, opportunityTypes, stages } from '../src/data.js';
import { formatCurrency } from '../src/money.js';
import {
  HttpError,
  assertSameOrigin,
  readJson,
  sendError,
  sendJson,
  sendNoContent,
  serveStatic,
} from './http.js';

const STAGES = new Set(stages.map(({ id }) => id));
const OPPORTUNITY_ORIGINS = new Set(opportunityOrigins);
const OUTCOMES = new Set(['won', 'lost', 'discarded']);
const OPPORTUNITY_TYPE_IDS = new Set(opportunityTypes.map(({ id }) => id));
const RESULT_STAGE = 'result';
const INITIATIVE_STAGE_IDS = new Set(initiativeStages.map(({ id }) => id));
const INITIATIVE_CATEGORIES = new Set(initiativeCategories);
const INITIATIVE_PRIORITIES = new Set(initiativePriorities);
const INITIATIVE_STATUS_IDS = new Set(initiativeStatuses.map(({ id }) => id));

const FIELD_LIMITS = {
  title: 160,
  account: 120,
  amount: 40,
  tower: 60,
  owner: 80,
  due: 40,
};

/** Field names a PATCH may touch. The order also drives the `updated` event payload. */
const EDITABLE_FIELDS = [
  'title', 'account', 'amount', 'stage', 'tower', 'owner', 'due', 'tags', 'number',
  'client_id', 'tower_id', 'owner_id', 'bid_manager_id', 'qa_percent', 'closure_reason',
  'origin', 'probability', 'expected_close_date', 'next_milestone', 'next_milestone_date',
  'need', 'initiative_id', 'outcome', 'pep', 'opportunity_type', 'registry_id',
];

/** Optional external registry reference shared by opportunities and framework agreements. */
const REGISTRY_ID_LIMIT = 120;

function parseRegistryId(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw validationError('El campo "ID registro" debe ser texto.');
  const trimmed = value.trim();
  if (trimmed.length > REGISTRY_ID_LIMIT) {
    throw validationError(`El campo "ID registro" no puede superar los ${REGISTRY_ID_LIMIT} caracteres.`);
  }
  return trimmed;
}

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;
const EMAIL_MAX_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const defaultLogger = { error: (message) => console.error(message) };

function validationError(message) {
  return new HttpError(400, 'validation_error', message);
}

function notFoundError() {
  return new HttpError(404, 'not_found', 'La oportunidad no existe.');
}

// ---------------------------------------------------------------------------
// Physical deletion guarded by relations
// ---------------------------------------------------------------------------

/** Joins Spanish list items: "a", "a y b", "a, b y c". */
function joinSpanish(parts) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
}

/**
 * Each check is [SQL returning `count` for the `$id` parameter, singular noun, plural noun].
 * Archived records are counted on purpose: they still reference the record.
 * Throws a 409 that names every blocking relation.
 */
function assertNoReferences(db, id, { code, subject, checks }) {
  const parts = [];
  for (const [sql, singular, plural] of checks) {
    const count = Number(db.prepare(sql).get({ id })?.count ?? 0);
    if (count > 0) parts.push(`${count} ${count === 1 ? singular : plural}`);
  }
  if (parts.length > 0) {
    throw new HttpError(409, code, `No se puede eliminar ${subject}: tiene vínculos con ${joinSpanish(parts)}.`);
  }
}

/** Actions, their comments, workspace links and entity events belong only to their record. */
function deleteOwnedRecordRows(db, type, id) {
  db.prepare(
    'DELETE FROM record_action_comments WHERE action_id IN (SELECT id FROM record_actions WHERE entity_type = ? AND entity_id = ?)',
  ).run(type, id);
  db.prepare('DELETE FROM record_actions WHERE entity_type = ? AND entity_id = ?').run(type, id);
  db.prepare('DELETE FROM workspace_links WHERE entity_type = ? AND entity_id = ?').run(type, id);
  db.prepare('DELETE FROM entity_events WHERE entity_type = ? AND entity_id = ?').run(type, id);
}

/**
 * `DELETE` physically removes an opportunity or initiative with everything that belongs only
 * to it. Archiving is a separate action (`POST /:id/archive`). An initiative that already
 * generated opportunities (archived ones included) cannot be deleted.
 */
function deleteRecord(ctx, req, res, type, rawId) {
  requireUser(ctx, req);
  const id = decodeId(rawId);
  withTransaction(ctx.db, () => {
    if (type === 'initiative') {
      const existing = ctx.db.prepare('SELECT id, title FROM initiatives WHERE id = ?').get(id);
      if (!existing) throw new HttpError(404, 'not_found', 'La iniciativa no existe.');
      const generated = Number(ctx.db.prepare('SELECT COUNT(*) AS count FROM opportunities WHERE initiative_id = ?').get(id).count);
      if (generated > 0) {
        throw new HttpError(
          409,
          'initiative_in_use',
          `No se puede eliminar la iniciativa «${existing.title}»: ya generó ${generated} ${generated === 1 ? 'oportunidad' : 'oportunidades'}.`,
        );
      }
      deleteOwnedRecordRows(ctx.db, 'initiative', id);
      ctx.db.prepare('DELETE FROM initiative_services WHERE initiative_id = ?').run(id);
      ctx.db.prepare('DELETE FROM initiatives WHERE id = ?').run(id);
      return;
    }
    if (!ctx.db.prepare('SELECT id FROM opportunities WHERE id = ?').get(id)) throw notFoundError();
    deleteOwnedRecordRows(ctx.db, 'opportunity', id);
    ctx.db.prepare('DELETE FROM card_events WHERE card_id = ?').run(id);
    ctx.db.prepare('DELETE FROM opportunity_towers WHERE opportunity_id = ?').run(id);
    ctx.db.prepare('DELETE FROM opportunity_lobs WHERE opportunity_id = ?').run(id);
    ctx.db.prepare('DELETE FROM opportunity_services WHERE opportunity_id = ?').run(id);
    ctx.db.prepare('DELETE FROM opportunities WHERE id = ?').run(id);
  });
  sendJson(res, 200, { deleted: true });
}

/** Relations that block deleting a master record. */
const MASTER_DELETE_RULES = {
  clients: {
    code: 'client_in_use',
    subject: 'el cliente',
    checks: [
      ['SELECT COUNT(*) AS count FROM opportunities WHERE client_id = $id', 'oportunidad', 'oportunidades'],
      ['SELECT COUNT(*) AS count FROM initiatives WHERE client_id = $id', 'iniciativa', 'iniciativas'],
      ['SELECT COUNT(*) AS count FROM framework_agreements WHERE client_id = $id', 'acuerdo marco', 'acuerdos marco'],
    ],
  },
  towers: {
    code: 'tower_in_use',
    subject: 'la tower',
    checks: [
      [
        `SELECT COUNT(*) AS count FROM opportunities
          WHERE tower_id = $id OR id IN (SELECT opportunity_id FROM opportunity_towers WHERE tower_id = $id)`,
        'oportunidad',
        'oportunidades',
      ],
      ['SELECT COUNT(*) AS count FROM initiatives WHERE tower_id = $id', 'iniciativa', 'iniciativas'],
    ],
  },
  lobs: {
    code: 'lob_in_use',
    subject: 'la LoB',
    checks: [
      ['SELECT COUNT(*) AS count FROM towers WHERE lob_id = $id', 'tower', 'towers'],
      ['SELECT COUNT(*) AS count FROM opportunity_lobs WHERE lob_id = $id', 'oportunidad', 'oportunidades'],
    ],
  },
  services: {
    code: 'service_in_use',
    subject: 'el servicio',
    checks: [
      ['SELECT COUNT(*) AS count FROM opportunity_services WHERE service_id = $id', 'oportunidad', 'oportunidades'],
      ['SELECT COUNT(*) AS count FROM initiative_services WHERE service_id = $id', 'iniciativa', 'iniciativas'],
    ],
  },
  people: {
    code: 'person_in_use',
    subject: 'el responsable',
    checks: [
      ['SELECT COUNT(*) AS count FROM towers WHERE responsible_id = $id', 'tower', 'towers'],
      ['SELECT COUNT(*) AS count FROM opportunities WHERE owner_id = $id OR bid_manager_id = $id', 'oportunidad', 'oportunidades'],
      ['SELECT COUNT(*) AS count FROM initiatives WHERE owner_id = $id OR bid_manager_id = $id', 'iniciativa', 'iniciativas'],
      ['SELECT COUNT(*) AS count FROM framework_agreements WHERE owner_id = $id', 'acuerdo marco', 'acuerdos marco'],
    ],
  },
};

/** Physically deletes a master record and its own history, unless something references it. */
function deleteMaster(ctx, res, kind, id) {
  const { table } = MASTER_CONFIG[kind];
  withTransaction(ctx.db, () => {
    const current = ctx.db.prepare(`SELECT id, name FROM ${table} WHERE id = ?`).get(id);
    if (!current) throw new HttpError(404, 'not_found', 'El registro no existe.');
    const rule = MASTER_DELETE_RULES[kind];
    assertNoReferences(ctx.db, id, { ...rule, subject: `${rule.subject} «${current.name}»` });
    ctx.db.prepare('DELETE FROM entity_events WHERE entity_type = ? AND entity_id = ?').run(kind, id);
    ctx.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  });
  sendJson(res, 200, { deleted: true });
}

/** Nothing references framework agreements, so they are always deletable with their history and links. */
function deleteAgreement(ctx, req, res, rawId) {
  requireUser(ctx, req);
  const id = decodeId(rawId);
  withTransaction(ctx.db, () => {
    if (!ctx.db.prepare('SELECT id FROM framework_agreements WHERE id = ?').get(id)) {
      throw new HttpError(404, 'not_found', 'El acuerdo marco no existe.');
    }
    deleteOwnedRecordRows(ctx.db, AGREEMENT_ENTITY_TYPE, id);
    ctx.db.prepare('DELETE FROM framework_agreements WHERE id = ?').run(id);
  });
  sendJson(res, 200, { deleted: true });
}

function unauthorizedError() {
  return new HttpError(401, 'unauthorized', 'La sesión no es válida o ha expirado.');
}

function isUniqueViolation(error) {
  return error?.errcode === 2067 || /UNIQUE constraint failed/.test(error?.message ?? '');
}

function publicUser(row) {
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

function safeParseJson(raw, fallback) {
  if (typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function loadJoinRows(db, table, valueTable, ownerColumn, valueColumn, ownerId) {
  // Linked services carry their fiscal year so the UI can label services from other years.
  const extraColumns = valueTable === 'services' ? ', v.year' : '';
  return db
    .prepare(
      `SELECT v.id, v.name, v.status${extraColumns} FROM ${table} j
         JOIN ${valueTable} v ON v.id = j.${valueColumn}
        WHERE j.${ownerColumn} = ?
        ORDER BY v.name COLLATE NOCASE`,
    )
    .all(ownerId);
}

function replaceJoinRows(db, table, ownerColumn, ownerId, valueColumn, ids) {
  db.prepare(`DELETE FROM ${table} WHERE ${ownerColumn} = ?`).run(ownerId);
  const insert = db.prepare(`INSERT OR IGNORE INTO ${table} (${ownerColumn}, ${valueColumn}) VALUES (?, ?)`);
  for (const id of ids) insert.run(ownerId, id);
}

function loadWorkspaceLinks(db, entityType, entityId) {
  return db
    .prepare('SELECT id, title, url FROM workspace_links WHERE entity_type = ? AND entity_id = ? ORDER BY created_at, rowid')
    .all(entityType, entityId);
}

function replaceWorkspaceLinks(db, entityType, entityId, links, user, now) {
  db.prepare('DELETE FROM workspace_links WHERE entity_type = ? AND entity_id = ?').run(entityType, entityId);
  const insert = db.prepare(
    `INSERT INTO workspace_links (id, entity_type, entity_id, title, url, created_at, created_by_id, created_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const link of links) {
    insert.run(randomUUID(), entityType, entityId, link.title, link.url, now, user?.id ?? null, user?.name ?? '');
  }
}

function mapOpportunity(row, db) {
  const towers = db ? loadJoinRows(db, 'opportunity_towers', 'towers', 'opportunity_id', 'tower_id', row.id) : [];
  const lobs = db ? loadJoinRows(db, 'opportunity_lobs', 'lobs', 'opportunity_id', 'lob_id', row.id) : [];
  const services = db ? loadJoinRows(db, 'opportunity_services', 'services', 'opportunity_id', 'service_id', row.id) : [];
  const links = db ? loadWorkspaceLinks(db, 'opportunity', row.id) : [];
  const initiative = row.initiative_id && db
    ? db.prepare('SELECT id, title FROM initiatives WHERE id = ?').get(row.initiative_id)
    : null;
  const amountValue = Number(parseAmount(row.amount));
  const probability = row.probability === null || row.probability === undefined ? null : Number(row.probability);
  const qaPercent = Number(row.qa_percent || 0);

  return {
    id: row.id,
    title: row.title,
    account: row.linked_client_name || row.account || '',
    amount: formatCurrency(amountValue),
    stage: row.stage,
    tower: row.linked_tower_name || row.tower || towers[0]?.name || '',
    owner: row.linked_owner_name || row.owner || '',
    due: row.due,
    tags: safeParseJson(row.tags, []),
    number: row.number || '',
    clientId: row.client_id || '',
    towerId: row.tower_id || '',
    ownerId: row.owner_id || '',
    bidManagerId: row.bid_manager_id || '',
    bidManager: row.linked_bid_manager_name || '',
    qaPercent,
    closureReason: row.closure_reason || '',
    origin: row.origin || '',
    probability,
    expectedCloseDate: row.expected_close_date || '',
    nextMilestone: row.next_milestone || '',
    nextMilestoneDate: row.next_milestone_date || '',
    need: row.need || '',
    initiativeId: row.initiative_id || '',
    initiativeTitle: initiative?.title || '',
    outcome: row.outcome || '',
    opportunityType: row.opportunity_type || '',
    registryId: row.registry_id || '',
    pep: row.pep || '',
    archivedAt: row.archived_at || '',
    archivedByName: row.archived_by_name || '',
    towers,
    lobs,
    services,
    links,
    qaWeightedAmount: (amountValue * qaPercent) / 100,
    weightedAmount: probability === null ? null : (amountValue * probability) / 100,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const OPPORTUNITY_DISPLAY_SELECT = `
  SELECT opportunities.*,
         clients.name AS linked_client_name,
         towers.name AS linked_tower_name,
          people.name AS linked_owner_name,
          bid_managers.name AS linked_bid_manager_name
    FROM opportunities
    LEFT JOIN clients ON clients.id = opportunities.client_id
    LEFT JOIN towers ON towers.id = opportunities.tower_id
     LEFT JOIN people ON people.id = opportunities.owner_id
     LEFT JOIN people AS bid_managers ON bid_managers.id = opportunities.bid_manager_id`;

function getOpportunityForDisplay(db, id) {
  return db.prepare(`${OPPORTUNITY_DISPLAY_SELECT} WHERE opportunities.id = ?`).get(id);
}

function mapMaster(row, kind) {
  const mapped = { id: row.id, name: row.name, sector: row.sector ?? undefined, email: row.email ?? undefined, description: row.description ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at };
  if (kind === 'towers') {
    mapped.responsibleId = row.responsible_id || '';
    mapped.responsibleName = row.responsible_name || '';
    mapped.lobId = row.lob_id || '';
    mapped.lobName = row.lob_name || '';
    return mapped;
  }
  mapped.active = row.status === 'active';
  if (kind === 'services') mapped.year = row.year;
  return mapped;
}

function mapInitiative(row, db) {
  const services = db ? loadJoinRows(db, 'initiative_services', 'services', 'initiative_id', 'service_id', row.id) : [];
  const links = db ? loadWorkspaceLinks(db, 'initiative', row.id) : [];
  const opportunities = db
    ? db
        .prepare(
          `SELECT id, title, stage, amount, owner, expected_close_date, outcome, archived_at
             FROM opportunities WHERE initiative_id = ? ORDER BY created_at DESC, id DESC`,
        )
        .all(row.id)
        .map((item) => ({
          id: item.id,
          title: item.title,
          stage: item.stage,
          amount: formatCurrency(Number(parseAmount(item.amount))),
          owner: item.owner || '',
          expectedCloseDate: item.expected_close_date || '',
          outcome: item.outcome || '',
          archived: Boolean(item.archived_at),
        }))
    : [];

  return {
    id: row.id,
    title: row.title,
    category: row.category,
    clientId: row.client_id || '',
    clientName: row.client_name || '',
    priority: row.priority || 'Media',
    nextAction: row.next_action || '',
    nextActionDate: row.next_action_date || '',
    description: row.description || '',
    operationalStatus: row.operational_status || 'active',
    stage: row.stage,
    services,
    links,
    opportunities,
    linkedOpportunityCount: opportunities.length,
    archivedAt: row.archived_at || '',
    archivedByName: row.archived_by_name || '',
    // Historical values stay readable even though the active form no longer edits them.
    towerId: row.tower_id || '',
    ownerId: row.owner_id || '',
    bidManagerId: row.bid_manager_id || '',
    amount: row.amount,
    qaPercent: Number(row.qa_percent),
    status: row.status,
    closureReason: row.closure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Entity type used by framework agreements in entity_events and workspace_links. */
const AGREEMENT_ENTITY_TYPE = 'agreement';

function mapAgreement(row, db) {
  const links = db ? loadWorkspaceLinks(db, AGREEMENT_ENTITY_TYPE, row.id) : [];
  return { id: row.id, title: row.title, clientId: row.client_id || '', ownerId: row.owner_id || '', endDate: row.end_date, amount: Number(row.amount) || 0, notes: row.notes || '', registryId: row.registry_id || '', links, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapEvent(row) {
  return {
    id: Number(row.id),
    action: row.action,
    detail: safeParseJson(row.detail, {}),
    userName: row.user_name,
    createdAt: row.created_at,
  };
}

function parseTextField(value, field, maxLength) {
  if (value === undefined || value === null) {
    throw validationError(`El campo "${field}" es obligatorio.`);
  }
  if (typeof value !== 'string') {
    throw validationError(`El campo "${field}" debe ser texto.`);
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    throw validationError(`El campo "${field}" no puede estar vacío.`);
  }
  if (trimmed.length > maxLength) {
    throw validationError(`El campo "${field}" no puede superar los ${maxLength} caracteres.`);
  }
  return trimmed;
}

function parseEmail(value) {
  if (typeof value !== 'string') {
    throw validationError('El email es obligatorio.');
  }
  const email = value.trim().toLowerCase();
  if (email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw validationError('El email no tiene un formato válido.');
  }
  return email;
}

function parseName(value) {
  if (typeof value !== 'string') {
    throw validationError('El nombre es obligatorio.');
  }
  const name = value.trim();
  if (name.length === 0) {
    throw validationError('El nombre es obligatorio.');
  }
  if (name.length > 80) {
    throw validationError('El nombre no puede superar los 80 caracteres.');
  }
  return name;
}

function parseStage(value) {
  if (typeof value !== 'string' || !STAGES.has(value.trim())) {
    throw validationError(`La etapa debe ser una de: ${[...STAGES].join(', ')}.`);
  }
  return value.trim();
}

function parseAmount(value) {
  if (value === undefined || value === null || value === '') throw validationError('El importe es obligatorio.');
  const raw = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  const clean = raw.replace(/\s|€|EUR/g, '');
  const normalized = clean.includes(',')
    ? clean.replace(/\./g, '').replace(',', '.')
    : (/^\d{1,3}(\.\d{3})+$/.test(clean) ? clean.replace(/\./g, '') : clean);
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) throw validationError('El importe debe ser un número no negativo.');
  return String(amount);
}

function parsePercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) throw validationError('El porcentaje de participación QA debe estar entre 0 y 100.');
  return number;
}

function parseProbability(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw validationError('La probabilidad de cierre debe ser un número entre 0 y 100.');
  }
  return Math.trunc(number);
}

function parseOrigin(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !OPPORTUNITY_ORIGINS.has(value.trim())) {
    throw validationError(`El origen debe ser uno de: ${[...OPPORTUNITY_ORIGINS].join(', ')}.`);
  }
  return value.trim();
}

function parseOutcome(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !OUTCOMES.has(value.trim())) {
    throw validationError('El resultado debe ser Ganada, Perdida o Descartada.');
  }
  return value.trim();
}

/**
 * Opportunity type is required whenever it is sent (create always sends it). A PATCH
 * that omits it never reaches this parser, so legacy rows with NULL stay editable.
 */
function parseOpportunityType(value) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    throw validationError('El tipo de oportunidad es obligatorio (Pliego, Oferta o Staffing).');
  }
  if (typeof value !== 'string' || !OPPORTUNITY_TYPE_IDS.has(value.trim())) {
    throw validationError('El tipo de oportunidad debe ser Pliego, Oferta o Staffing.');
  }
  return value.trim();
}

function parseOptionalDate(value, field) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw validationError(`El campo "${field}" debe ser una fecha válida (AAAA-MM-DD).`);
  }
  return value.trim();
}

function parseShortText(value, maxLength = 240) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

const INTERNAL_INITIATIVE_ORIGIN = 'Iniciativa interna';

/** An internal-initiative origin must point at the initiative that generated the opportunity. */
function assertOriginInitiative(origin, initiativeId) {
  if (origin === INTERNAL_INITIATIVE_ORIGIN && !initiativeId) {
    throw validationError('Selecciona la iniciativa de origen para el origen «Iniciativa interna».');
  }
}

function optionalInitiativeId(db, value) {
  if (value === undefined || value === null || value === '') return null;
  const found = db.prepare('SELECT id FROM initiatives WHERE id = ? AND archived_at IS NULL').get(value);
  if (typeof value !== 'string' || !found) {
    throw validationError('La iniciativa seleccionada no existe o está archivada.');
  }
  return value;
}

function parseIdList(value, field) {
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value)) throw validationError(`"${field}" debe ser una lista de identificadores.`);
  const ids = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw validationError(`"${field}" debe ser una lista de identificadores.`);
    }
    const id = item.trim();
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Fiscal year ("ejercicio") used for new service assignments, from the injectable clock. */
function currentServiceYear(ctx) {
  return ctx.now().getFullYear();
}

function linkedServiceIds(db, table, ownerColumn, ownerId) {
  return db.prepare(`SELECT service_id FROM ${table} WHERE ${ownerColumn} = ?`).all(ownerId).map((row) => row.service_id);
}

/**
 * Only active services of the current fiscal year can be newly assigned. Services already
 * linked (from earlier years, or deactivated later) are kept when they are sent again.
 */
function assertAssignableServices(ctx, ids, linkedIds = []) {
  const year = currentServiceYear(ctx);
  const find = ctx.db.prepare('SELECT id, name, status, year FROM services WHERE id = ?');
  for (const id of ids) {
    if (linkedIds.includes(id)) continue;
    const service = find.get(id);
    if (!service || service.status !== 'active') {
      throw validationError('El registro seleccionado en "servicios" no existe o está inactivo.');
    }
    if (service.year !== year) {
      const hasCurrentServices = ctx.db.prepare("SELECT 1 FROM services WHERE year = ? AND status = 'active' LIMIT 1").get(year);
      const hint = hasCurrentServices ? '' : ` Crea o copia los servicios del ejercicio ${year} en Datos maestros > Servicios.`;
      throw validationError(
        `El servicio «${service.name}» pertenece al ejercicio ${service.year}: solo se pueden asignar servicios activos del ejercicio ${year}.${hint}`,
      );
    }
  }
}

function parseInitiativeStage(value) {
  if (value === undefined || value === null || value === '') return 'pending';
  if (typeof value !== 'string' || !INITIATIVE_STAGE_IDS.has(value.trim())) {
    throw validationError(`La etapa de la iniciativa debe ser una de: ${[...INITIATIVE_STAGE_IDS].join(', ')}.`);
  }
  return value.trim();
}

function parseInitiativeCategory(value) {
  if (value === undefined || value === null || value === '') return 'Otros';
  if (typeof value !== 'string' || !INITIATIVE_CATEGORIES.has(value.trim())) {
    throw validationError('La categoría de la iniciativa no es válida.');
  }
  return value.trim();
}

function parseInitiativePriority(value) {
  if (value === undefined || value === null || value === '') return 'Media';
  if (typeof value !== 'string' || !INITIATIVE_PRIORITIES.has(value.trim())) {
    throw validationError('La prioridad debe ser Alta, Media o Baja.');
  }
  return value.trim();
}

function parseInitiativeStatus(value) {
  if (value === undefined || value === null || value === '') return 'active';
  if (typeof value !== 'string' || !INITIATIVE_STATUS_IDS.has(value.trim())) {
    throw validationError('El estado operativo debe ser active, paused o discarded.');
  }
  return value.trim();
}

function parseWorkspaceLinks(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw validationError('Los enlaces de Workspace deben ser una lista.');
  if (value.length > 20) throw validationError('No se permiten más de 20 enlaces de Workspace.');
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw validationError('Cada enlace debe tener título y URL.');
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    if (!title) throw validationError('Cada enlace de Workspace necesita un título.');
    if (title.length > 120) throw validationError('El título del enlace no puede superar los 120 caracteres.');
    if (!/^https?:\/\//i.test(url)) throw validationError('La URL del enlace debe empezar por http:// o https://.');
    if (url.length > 500) throw validationError('La URL del enlace no puede superar los 500 caracteres.');
    return { title, url };
  });
}

function optionalId(db, table, value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !db.prepare(`SELECT id FROM ${table} WHERE id = ? AND status = 'active'`).get(value)) {
    throw validationError(`El registro seleccionado en "${field}" no existe o está inactivo.`);
  }
  return value;
}

function optionalTowerId(db, value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !db.prepare('SELECT id FROM towers WHERE id = ?').get(value)) {
    throw validationError('La tower seleccionada no existe.');
  }
  return value;
}

function appendEntityEvent(db, { type, id, user, action, detail = {}, now }) {
  db.prepare(`INSERT INTO entity_events (entity_type, entity_id, user_id, user_name, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(type, id, user?.id ?? null, user?.name ?? 'Sistema', action, JSON.stringify(detail), now);
}

function parseTags(value) {
  if (!Array.isArray(value)) {
    throw validationError('Las etiquetas deben ser una lista de textos.');
  }
  if (value.length > MAX_TAGS) {
    throw validationError(`No se permiten más de ${MAX_TAGS} etiquetas.`);
  }
  const tags = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      throw validationError('Las etiquetas deben ser una lista de textos.');
    }
    const tag = item.trim();
    if (tag === '') continue;
    if (tag.length > MAX_TAG_LENGTH) {
      throw validationError(`Cada etiqueta no puede superar los ${MAX_TAG_LENGTH} caracteres.`);
    }
    tags.push(tag);
  }
  return tags;
}

/** Normalizes a single editable field into the exact string stored in SQLite. */
function normalizeFieldValue(db, field, value) {
  if (field === 'stage') return parseStage(value);
  if (field === 'tags') return JSON.stringify(parseTags(value));
  if (field === 'amount') return parseAmount(value);
  if (field === 'qa_percent') return parsePercent(value);
  if (field === 'client_id') return optionalId(db, 'clients', value, 'cliente');
  if (field === 'tower_id') return optionalTowerId(db, value);
  if (field === 'owner_id' || field === 'bid_manager_id') return optionalId(db, 'people', value, 'responsable');
  if (field === 'origin') return parseOrigin(value);
  if (field === 'outcome') return parseOutcome(value);
  if (field === 'opportunity_type') return parseOpportunityType(value);
  if (field === 'registry_id') return parseRegistryId(value);
  if (field === 'probability') return parseProbability(value);
  if (field === 'expected_close_date' || field === 'next_milestone_date') return parseOptionalDate(value, field);
  if (field === 'next_milestone' || field === 'need' || field === 'pep') return parseShortText(value);
  if (field === 'initiative_id') return optionalInitiativeId(db, value);
  if (field === 'number' || field === 'closure_reason') return typeof value === 'string' ? value.trim().slice(0, 160) : '';
  return parseTextField(value, field, FIELD_LIMITS[field]);
}

/**
 * Cross-field rules for the final state of an opportunity.
 * `result` needs an outcome and a close date; a non-won outcome needs a loss reason.
 */
function assertOpportunityState({ stage, outcome, expectedCloseDate, closureReason }) {
  if (stage === RESULT_STAGE) {
    if (!outcome) throw validationError('Selecciona el resultado (Ganada, Perdida o Descartada) para la etapa Resultado.');
    if (!expectedCloseDate) throw validationError('La etapa Resultado requiere una fecha estimada de cierre.');
    if (outcome !== 'won' && !closureReason) {
      throw validationError('Indica el motivo de pérdida o descarte.');
    }
    return;
  }
  if (outcome) throw validationError('El resultado solo se registra en la etapa Resultado.');
}

function insertCardEvent(db, { cardId, user, action, detail, createdAt }) {
  const result = db
    .prepare(
      `INSERT INTO card_events (card_id, user_id, user_name, action, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(cardId, user?.id ?? null, user?.name ?? 'Sistema', action, JSON.stringify(detail), createdAt);

  return {
    id: Number(result.lastInsertRowid),
    action,
    detail,
    userName: user?.name ?? 'Sistema',
    createdAt,
  };
}

/**
 * Builds the next prefixed id from the highest numeric suffix currently stored.
 * Uniqueness is re-checked for every candidate, and the caller retries the whole
 * insert on a unique violation (two processes on the same file).
 */
function nextPrefixedId(db, table, prefix) {
  const row = db
    .prepare(`SELECT MAX(CAST(substr(id, ${prefix.length + 2}) AS INTEGER)) AS max_id FROM ${table} WHERE id GLOB '${prefix}-[0-9]*'`)
    .get();
  const highest = Number(row?.max_id ?? 0);
  const start = Number.isFinite(highest) ? highest : 0;
  const exists = db.prepare(`SELECT 1 AS found FROM ${table} WHERE id = ?`);

  for (let offset = 1; offset <= 10000; offset += 1) {
    const candidate = `${prefix}-${String((start + offset) % 10000).padStart(4, '0')}`;
    if (!exists.get(candidate)) return candidate;
  }

  throw new HttpError(500, 'id_generation_failed', 'No se pudo generar un identificador único.');
}

function nextOpportunityId(db) {
  return nextPrefixedId(db, 'opportunities', 'OP');
}

function nextInitiativeId(db) {
  return nextPrefixedId(db, 'initiatives', 'IN');
}

function getClientIp(req, config) {
  if (config.trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (typeof raw === 'string' && raw.trim() !== '') {
      return raw.split(',')[0].trim();
    }
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

function requireUser(ctx, req) {
  const user = getSessionUser(req, ctx, ctx.now());
  if (!user) throw unauthorizedError();
  return user;
}

function rejectMethod(res, ...allowed) {
  res.setHeader('allow', allowed.join(', '));
  throw new HttpError(405, 'method_not_allowed', 'Método no permitido.');
}

function setSessionCookie(ctx, res, token) {
  res.setHeader(
    'set-cookie',
    serializeSessionCookie(token, {
      secret: ctx.config.sessionSecret,
      isProduction: ctx.config.isProduction,
    }),
  );
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// Single version source: package.json, read once at startup.
const APP_VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

function version(res) {
  sendJson(res, 200, { version: APP_VERSION });
}

function health(ctx, res) {
  sendJson(res, 200, { status: 'ok', time: ctx.now().toISOString() });
}

async function register(ctx, req, res) {
  const { db, config } = ctx;

  // Registration is closed unless an invite code is configured.
  if (!config.inviteCode) {
    throw new HttpError(403, 'registration_disabled', 'El registro está deshabilitado.');
  }

  // The invite code is the only gate in front of a public URL, and it is cheap to
  // guess (the scrypt run happens after the code is validated), so failed attempts
  // are throttled per client IP exactly like login attempts.
  const throttleKey = `register|${getClientIp(req, config)}`;
  if (ctx.registerThrottle.isBlocked(throttleKey)) {
    const retryAfter = ctx.registerThrottle.retryAfterSeconds(throttleKey);
    res.setHeader('retry-after', String(retryAfter));
    throw new HttpError(
      429,
      'too_many_attempts',
      `Demasiados intentos fallidos. Vuelve a intentarlo en ${retryAfter} segundos.`,
    );
  }

  const body = await readJson(req);

  const email = parseEmail(body.email);
  const name = parseName(body.name);

  if (!validatePassword(body.password)) {
    if (typeof body.password === 'string' && body.password.length > PASSWORD_MAX_LENGTH) {
      throw validationError(`La contraseña no puede superar los ${PASSWORD_MAX_LENGTH} caracteres.`);
    }
    throw validationError(`La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  }

  const providedInvite = typeof body.inviteCode === 'string' ? body.inviteCode.trim() : '';
  if (!timingSafeStringEquals(providedInvite, config.inviteCode)) {
    ctx.registerThrottle.recordFailure(throttleKey);
    throw new HttpError(403, 'invalid_invite_code', 'El código de invitación no es válido.');
  }
  ctx.registerThrottle.clear(throttleKey);

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    throw new HttpError(409, 'email_taken', 'Ya existe una cuenta con ese email.');
  }

  const passwordHash = await hashPassword(body.password);
  const createdAt = ctx.now().toISOString();
  const userId = randomUUID();

  let role;
  try {
    role = withTransaction(db, () => {
      const countRow = db.prepare('SELECT COUNT(*) AS count FROM users').get();
      const assignedRole = Number(countRow.count) === 0 ? 'admin' : 'member';
      db.prepare(
        `INSERT INTO users (id, email, name, password_hash, role, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(userId, email, name, passwordHash, assignedRole, createdAt);
      return assignedRole;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError(409, 'email_taken', 'Ya existe una cuenta con ese email.');
    }
    throw error;
  }

  const { token } = createSession(db, userId, ctx.now());
  setSessionCookie(ctx, res, token);
  sendJson(res, 201, { user: { id: userId, email, name, role } });
}

async function login(ctx, req, res) {
  const body = await readJson(req);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (email === '' || password === '') {
    throw new HttpError(400, 'invalid_request', 'El email y la contraseña son obligatorios.');
  }

  const throttleKey = `${getClientIp(req, ctx.config)}|${email}`;
  if (ctx.throttle.isBlocked(throttleKey)) {
    const retryAfter = ctx.throttle.retryAfterSeconds(throttleKey);
    res.setHeader('retry-after', String(retryAfter));
    throw new HttpError(
      429,
      'too_many_attempts',
      `Demasiados intentos fallidos. Vuelve a intentarlo en ${retryAfter} segundos.`,
    );
  }

  const row = ctx.db
    .prepare('SELECT id, email, name, role, password_hash FROM users WHERE email = ?')
    .get(email);

  // A dummy scrypt run happens for unknown emails, so timing does not leak existence.
  const passwordMatches = await verifyLoginPassword(password, row?.password_hash ?? null);

  if (!row || !passwordMatches) {
    ctx.throttle.recordFailure(throttleKey);
    throw new HttpError(401, 'invalid_credentials', 'Email o contraseña incorrectos.');
  }

  ctx.throttle.clear(throttleKey);
  const { token } = createSession(ctx.db, row.id, ctx.now());
  setSessionCookie(ctx, res, token);
  sendJson(res, 200, { user: publicUser(row) });
}

function logout(ctx, req, res) {
  const token = readSessionToken(req, ctx.config.sessionSecret);
  if (token) destroySession(ctx.db, token);
  res.setHeader('set-cookie', clearSessionCookie({ isProduction: ctx.config.isProduction }));
  sendNoContent(res);
}

function me(ctx, req, res) {
  const user = requireUser(ctx, req);
  sendJson(res, 200, { user });
}

function listOpportunities(ctx, req, res, query) {
  requireUser(ctx, req);
  const archived = query?.get('archived') === '1';
  const rows = ctx.db
    .prepare(
      `${OPPORTUNITY_DISPLAY_SELECT}
        WHERE opportunities.archived_at IS ${archived ? 'NOT NULL' : 'NULL'}
        ORDER BY opportunities.created_at DESC, opportunities.id DESC`,
    )
    .all();
  sendJson(res, 200, { opportunities: rows.map((row) => mapOpportunity(row, ctx.db)) });
}

function assertRecordsExist(db, table, ids, field) {
  const find = db.prepare(`SELECT id FROM ${table} WHERE id = ?`);
  for (const id of ids) {
    if (!find.get(id)) throw validationError(`El registro seleccionado en "${field}" no existe.`);
  }
}

function hasAny(body, keys) {
  return keys.some((key) => Object.hasOwn(body, key));
}

function readRelationIds(body, camelKey, snakeKey, field) {
  return parseIdList(Object.hasOwn(body, camelKey) ? body[camelKey] : body[snakeKey], field);
}

/**
 * The source of a "Crear oportunidad" conversion must exist and be active; it is
 * read again inside the create transaction before being completed.
 */
function loadConvertibleInitiative(db, id) {
  const initiative = db.prepare('SELECT id, stage, archived_at FROM initiatives WHERE id = ?').get(id);
  if (!initiative) throw notFoundInitiativeError();
  if (initiative.archived_at) {
    throw new HttpError(409, 'record_archived', 'Restaura la iniciativa antes de crear una oportunidad desde ella.');
  }
  return initiative;
}

/**
 * Creates an opportunity. With `sourceInitiativeId` (POST /api/initiatives/:id/convert) the
 * opportunity is forced to link that initiative with the internal-initiative origin, and the
 * initiative is marked `completed` in the same transaction, so both happen or neither does.
 */
async function createOpportunity(ctx, req, res, rawSourceInitiativeId = null) {
  const user = requireUser(ctx, req);
  const sourceInitiativeId = rawSourceInitiativeId === null ? null : decodeId(rawSourceInitiativeId);
  if (sourceInitiativeId !== null) loadConvertibleInitiative(ctx.db, sourceInitiativeId);
  const body = await readJson(req);
  if (sourceInitiativeId !== null) {
    body.initiativeId = sourceInitiativeId;
    body.origin = INTERNAL_INITIATIVE_ORIGIN;
  }

  const stage = parseStage(body.stage ?? 'prospecting');
  const opportunityType = parseOpportunityType(body.opportunityType);
  const outcome = parseOutcome(body.outcome);
  const expectedCloseDate = parseOptionalDate(body.expectedCloseDate, 'expectedCloseDate');
  const closureReason = parseShortText(body.closureReason, 160);
  assertOpportunityState({ stage, outcome, expectedCloseDate, closureReason });

  const initiativeId = optionalInitiativeId(ctx.db, body.initiativeId);
  const origin = parseOrigin(body.origin) || (initiativeId ? INTERNAL_INITIATIVE_ORIGIN : '');
  assertOriginInitiative(origin, initiativeId);
  const legacyTowerId = optionalTowerId(ctx.db, body.towerId);
  const relationTowerIds = readRelationIds(body, 'towerIds', 'tower_ids', 'towers');
  const towerIds = relationTowerIds.length > 0 ? relationTowerIds : (legacyTowerId ? [legacyTowerId] : []);
  const lobIds = readRelationIds(body, 'lobIds', 'lob_ids', 'LoBs');
  const serviceIds = readRelationIds(body, 'serviceIds', 'service_ids', 'servicios');
  const links = parseWorkspaceLinks(body.links);
  assertRecordsExist(ctx.db, 'towers', towerIds, 'towers');
  assertRecordsExist(ctx.db, 'lobs', lobIds, 'LoBs');
  assertAssignableServices(ctx, serviceIds);

  const values = {
    title: parseTextField(body.title, 'title', FIELD_LIMITS.title),
    account: typeof body.account === 'string' ? body.account.trim() : '',
    amount: parseAmount(body.amount),
    stage,
    tower: typeof body.tower === 'string' ? body.tower.trim() : '',
    owner: typeof body.owner === 'string' ? body.owner.trim() : '',
    due: typeof body.due === 'string' ? body.due.trim() : '',
    tags: JSON.stringify(body.tags === undefined ? [] : parseTags(body.tags)),
    number: parseShortText(body.number, 160),
    client_id: optionalId(ctx.db, 'clients', body.clientId, 'cliente'),
    tower_id: legacyTowerId,
    owner_id: optionalId(ctx.db, 'people', body.ownerId, 'responsable'),
    bid_manager_id: optionalId(ctx.db, 'people', body.bidManagerId, 'bid manager'),
    qa_percent: parsePercent(body.qaPercent ?? 0),
    closure_reason: closureReason,
    origin,
    probability: parseProbability(body.probability),
    expected_close_date: expectedCloseDate,
    next_milestone: parseShortText(body.nextMilestone),
    next_milestone_date: parseOptionalDate(body.nextMilestoneDate, 'nextMilestoneDate'),
    need: parseShortText(body.need, 2000),
    initiative_id: initiativeId,
    outcome,
    pep: parseShortText(body.pep),
    opportunity_type: opportunityType,
    registry_id: parseRegistryId(body.registryId),
  };

  const nowIso = ctx.now().toISOString();
  const insert = ctx.db.prepare(
    `INSERT INTO opportunities
       (id, title, account, amount, stage, tower, owner, due, tags, created_at, updated_at,
        number, client_id, tower_id, owner_id, bid_manager_id, qa_percent, closure_reason,
        origin, probability, expected_close_date, next_milestone, next_milestone_date, need,
        initiative_id, outcome, pep, opportunity_type, registry_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let createdId;
  for (let attempt = 0; ; attempt += 1) {
    try {
      createdId = withTransaction(ctx.db, () => {
        const id = nextOpportunityId(ctx.db);
        insert.run(
          id,
          values.title,
          values.account,
          values.amount,
          values.stage,
          values.tower,
          values.owner,
          values.due,
          values.tags,
          nowIso,
          nowIso,
          values.number,
          values.client_id,
          values.tower_id,
          values.owner_id,
          values.bid_manager_id,
          values.qa_percent,
          values.closure_reason,
          values.origin,
          values.probability,
          values.expected_close_date,
          values.next_milestone,
          values.next_milestone_date,
          values.need,
          values.initiative_id,
          values.outcome,
          values.pep,
          values.opportunity_type,
          values.registry_id,
        );
        replaceJoinRows(ctx.db, 'opportunity_towers', 'opportunity_id', id, 'tower_id', towerIds);
        replaceJoinRows(ctx.db, 'opportunity_lobs', 'opportunity_id', id, 'lob_id', lobIds);
        replaceJoinRows(ctx.db, 'opportunity_services', 'opportunity_id', id, 'service_id', serviceIds);
        replaceWorkspaceLinks(ctx.db, 'opportunity', id, links, user, nowIso);
        insertCardEvent(ctx.db, {
          cardId: id,
          user,
          action: 'created',
          detail: {},
          createdAt: nowIso,
        });
        appendEntityEvent(ctx.db, {
          type: 'opportunity',
          id,
          user,
          action: 'created',
          detail: sourceInitiativeId === null ? {} : { fromInitiativeId: sourceInitiativeId },
          now: nowIso,
        });
        if (sourceInitiativeId !== null) completeConvertedInitiative(ctx.db, sourceInitiativeId, id, user, nowIso);
        return id;
      });
      break;
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= 4) throw error;
    }
  }

  const row = getOpportunityForDisplay(ctx.db, createdId);
  const payload = { opportunity: mapOpportunity(row, ctx.db) };
  if (sourceInitiativeId !== null) {
    payload.initiative = mapInitiative(getInitiativeForDisplay(ctx.db, sourceInitiativeId), ctx.db);
  }
  sendJson(res, 201, payload);
}

/** Marks the source initiative completed and records the conversion in its history. */
function completeConvertedInitiative(db, initiativeId, opportunityId, user, nowIso) {
  const initiative = loadConvertibleInitiative(db, initiativeId);
  if (initiative.stage !== COMPLETED_INITIATIVE_STAGE) {
    db.prepare('UPDATE initiatives SET stage = ?, updated_at = ? WHERE id = ?').run(COMPLETED_INITIATIVE_STAGE, nowIso, initiativeId);
  }
  appendEntityEvent(db, {
    type: 'initiative',
    id: initiativeId,
    user,
    action: 'converted',
    detail: { opportunityId, fields: ['stage'], from: initiative.stage, to: COMPLETED_INITIATIVE_STAGE },
    now: nowIso,
  });
}

async function patchOpportunity(ctx, req, res, rawId) {
  const user = requireUser(ctx, req);
  const id = decodeId(rawId);

  const existing = ctx.db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id);
  if (!existing) throw notFoundError();
  if (existing.archived_at) throw new HttpError(409, 'record_archived', 'Restaura la oportunidad antes de editarla.');

  const body = await readJson(req);

  const changes = {};
  const changedFields = [];
  const apiFields = {
    clientId: 'client_id', towerId: 'tower_id', ownerId: 'owner_id', bidManagerId: 'bid_manager_id',
    qaPercent: 'qa_percent', closureReason: 'closure_reason', origin: 'origin', probability: 'probability',
    expectedCloseDate: 'expected_close_date', nextMilestone: 'next_milestone',
    nextMilestoneDate: 'next_milestone_date', need: 'need', initiativeId: 'initiative_id',
    outcome: 'outcome', pep: 'pep', opportunityType: 'opportunity_type', registryId: 'registry_id',
  };
  for (const apiField of EDITABLE_FIELDS.map((field) => Object.keys(apiFields).find((key) => apiFields[key] === field) || field)) {
    if (!Object.prototype.hasOwnProperty.call(body, apiField)) continue;
    const field = apiFields[apiField] || apiField;
    // Re-sending the current link is a no-op, even if that initiative was archived later.
    if (field === 'initiative_id' && existing.initiative_id && body[apiField] === existing.initiative_id) continue;
    const nextValue = normalizeFieldValue(ctx.db, field, body[apiField]);
    if (nextValue === existing[field]) continue;
    changes[field] = nextValue;
    changedFields.push(field);
  }

  // Only a change to origin or link triggers the rule, so untouched legacy rows stay editable.
  if (changedFields.includes('origin') || changedFields.includes('initiative_id')) {
    assertOriginInitiative(
      changes.origin ?? existing.origin,
      Object.hasOwn(changes, 'initiative_id') ? changes.initiative_id : existing.initiative_id,
    );
  }

  // Leaving the Resultado stage clears the outcome; a result requires one.
  const finalStage = changes.stage ?? existing.stage;
  let finalOutcome = changes.outcome ?? existing.outcome;
  if (finalStage !== RESULT_STAGE && finalOutcome) {
    changes.outcome = '';
    if (!changedFields.includes('outcome')) changedFields.push('outcome');
    finalOutcome = '';
  }
  assertOpportunityState({
    stage: finalStage,
    outcome: finalOutcome,
    expectedCloseDate: changes.expected_close_date ?? existing.expected_close_date,
    closureReason: changes.closure_reason ?? existing.closure_reason,
  });

  const hasTowerIds = hasAny(body, ['towerIds', 'tower_ids']);
  const hasLobIds = hasAny(body, ['lobIds', 'lob_ids']);
  const hasServiceIds = hasAny(body, ['serviceIds', 'service_ids']);
  const hasLinks = Object.hasOwn(body, 'links');
  const towerIds = hasTowerIds ? readRelationIds(body, 'towerIds', 'tower_ids', 'towers') : null;
  const lobIds = hasLobIds ? readRelationIds(body, 'lobIds', 'lob_ids', 'LoBs') : null;
  const serviceIds = hasServiceIds ? readRelationIds(body, 'serviceIds', 'service_ids', 'servicios') : null;
  const links = hasLinks ? parseWorkspaceLinks(body.links) : null;
  if (towerIds) assertRecordsExist(ctx.db, 'towers', towerIds, 'towers');
  if (lobIds) assertRecordsExist(ctx.db, 'lobs', lobIds, 'LoBs');
  if (serviceIds) assertAssignableServices(ctx, serviceIds, linkedServiceIds(ctx.db, 'opportunity_services', 'opportunity_id', id));

  const relationFields = [
    ...(hasTowerIds ? ['towers'] : []),
    ...(hasLobIds ? ['lobs'] : []),
    ...(hasServiceIds ? ['services'] : []),
    ...(hasLinks ? ['links'] : []),
  ];

  // Nothing actually changed: return the row untouched and write no event.
  if (changedFields.length === 0 && relationFields.length === 0) {
    sendJson(res, 200, { opportunity: mapOpportunity(getOpportunityForDisplay(ctx.db, id), ctx.db), events: [] });
    return;
  }

  const stageChanged = changedFields.includes('stage');
  const columnFields = changedFields.filter((field) => field !== 'stage');
  const nowIso = ctx.now().toISOString();

  const events = [];
  // The row update, its relation rows, and its history entries are one atomic unit.
  withTransaction(ctx.db, () => {
    if (changedFields.length > 0) {
      const assignments = changedFields.map((field) => `${field} = ?`).join(', ');
      ctx.db
        .prepare(`UPDATE opportunities SET ${assignments}, updated_at = ? WHERE id = ?`)
        .run(...changedFields.map((field) => changes[field]), nowIso, id);
    } else {
      ctx.db.prepare('UPDATE opportunities SET updated_at = ? WHERE id = ?').run(nowIso, id);
    }

    if (hasTowerIds) replaceJoinRows(ctx.db, 'opportunity_towers', 'opportunity_id', id, 'tower_id', towerIds);
    if (hasLobIds) replaceJoinRows(ctx.db, 'opportunity_lobs', 'opportunity_id', id, 'lob_id', lobIds);
    if (hasServiceIds) replaceJoinRows(ctx.db, 'opportunity_services', 'opportunity_id', id, 'service_id', serviceIds);
    if (hasLinks) replaceWorkspaceLinks(ctx.db, 'opportunity', id, links, user, nowIso);

    if (stageChanged) {
      events.push(
        insertCardEvent(ctx.db, {
          cardId: id,
          user,
          action: 'moved',
          detail: { from: existing.stage, to: changes.stage },
          createdAt: nowIso,
        }),
      );
    }
    if (columnFields.length > 0 || relationFields.length > 0) {
      events.push(
        insertCardEvent(ctx.db, {
          cardId: id,
          user,
          action: 'updated',
          detail: { fields: [...columnFields, ...relationFields] },
          createdAt: nowIso,
        }),
      );
    }
    appendEntityEvent(ctx.db, {
      type: 'opportunity',
      id,
      user,
      action: 'updated',
      detail: { fields: [...changedFields, ...relationFields] },
      now: nowIso,
    });
  });

  const updated = getOpportunityForDisplay(ctx.db, id);
  sendJson(res, 200, { opportunity: mapOpportunity(updated, ctx.db), events });
}

function setOpportunityArchive(ctx, req, res, rawId, archived) {
  const user = requireUser(ctx, req);
  const id = decodeId(rawId);
  const nowIso = ctx.now().toISOString();
  withTransaction(ctx.db, () => {
    const existing = ctx.db.prepare('SELECT id FROM opportunities WHERE id = ?').get(id);
    if (!existing) throw notFoundError();
    ctx.db
      .prepare('UPDATE opportunities SET archived_at = ?, archived_by_id = ?, archived_by_name = ?, updated_at = ? WHERE id = ?')
      .run(archived ? nowIso : null, archived ? user.id : null, archived ? user.name : '', nowIso, id);
    appendEntityEvent(ctx.db, { type: 'opportunity', id, user, action: archived ? 'archived' : 'restored', now: nowIso });
  });
  sendJson(res, 200, { opportunity: mapOpportunity(getOpportunityForDisplay(ctx.db, id), ctx.db) });
}

const MASTER_CONFIG = {
  clients: { table: 'clients', plural: 'clients', fields: ['name', 'sector'] },
  towers: { table: 'towers', plural: 'towers', fields: ['name'] },
  people: { table: 'people', plural: 'people', fields: ['name', 'email'] },
  services: { table: 'services', plural: 'services', fields: ['name', 'description'] },
  lobs: { table: 'lobs', plural: 'lobs', fields: ['name', 'description'] },
};

function listMaster(ctx, req, res, kind, query) {
  requireUser(ctx, req);
  const { table } = MASTER_CONFIG[kind];
  let rows;
  if (kind === 'towers') {
    rows = ctx.db.prepare(`SELECT towers.*, people.name AS responsible_name, lobs.name AS lob_name FROM towers LEFT JOIN people ON people.id = towers.responsible_id LEFT JOIN lobs ON lobs.id = towers.lob_id ORDER BY towers.name COLLATE NOCASE`).all();
  } else if (kind === 'services') {
    // `?year=` narrows the catalog to one fiscal year; without it every year is listed, newest first.
    const rawYear = query?.get('year');
    rows = rawYear
      ? ctx.db.prepare('SELECT * FROM services WHERE year = ? ORDER BY status ASC, name COLLATE NOCASE').all(parseServiceYear(rawYear))
      : ctx.db.prepare('SELECT * FROM services ORDER BY year DESC, status ASC, name COLLATE NOCASE').all();
  } else {
    rows = ctx.db.prepare(`SELECT * FROM ${table} ORDER BY status ASC, name COLLATE NOCASE`).all();
  }
  sendJson(res, 200, { records: rows.map((row) => mapMaster(row, kind)) });
}

// ---------------------------------------------------------------------------
// Service fiscal years ("ejercicios")
// ---------------------------------------------------------------------------

const MIN_SERVICE_YEAR = 2000;
const MAX_SERVICE_YEAR = 2100;

/** Accepts an integer or a numeric string; years outside 2000–2100 are rejected. */
function parseServiceYear(value) {
  const year = typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(year) || year < MIN_SERVICE_YEAR || year > MAX_SERVICE_YEAR) {
    throw validationError(`El ejercicio debe ser un año entre ${MIN_SERVICE_YEAR} y ${MAX_SERVICE_YEAR}.`);
  }
  return year;
}

function serviceYearExists(db, year) {
  return Boolean(db.prepare('SELECT year FROM service_years WHERE year = ?').get(year));
}

/** A service always belongs to an existing year; omitted on create, it defaults to the current year. */
function resolveServiceYear(ctx, value, { required = false } = {}) {
  const missing = value === undefined || value === null || value === '';
  if (missing && required) throw validationError('Selecciona el ejercicio del servicio.');
  const year = missing ? currentServiceYear(ctx) : parseServiceYear(value);
  if (!serviceYearExists(ctx.db, year)) {
    throw validationError(`El ejercicio ${year} no existe. Créalo en Datos maestros > Servicios.`);
  }
  return year;
}

const SERVICE_YEAR_SELECT = `SELECT y.year, y.created_at, COUNT(s.id) AS service_count,
    COALESCE(SUM(CASE WHEN s.status = 'active' THEN 1 ELSE 0 END), 0) AS active_count
    FROM service_years y LEFT JOIN services s ON s.year = y.year`;

function getServiceYear(db, year) {
  return db.prepare(`${SERVICE_YEAR_SELECT} WHERE y.year = ? GROUP BY y.year`).get(year);
}

function mapServiceYear(row) {
  return {
    year: row.year,
    createdAt: row.created_at,
    serviceCount: Number(row.service_count),
    activeServiceCount: Number(row.active_count),
  };
}

function notFoundServiceYearError(year) {
  return new HttpError(404, 'not_found', `El ejercicio ${year} no existe.`);
}

function listServiceYears(ctx, req, res) {
  requireUser(ctx, req);
  const rows = ctx.db.prepare(`${SERVICE_YEAR_SELECT} GROUP BY y.year ORDER BY y.year`).all();
  sendJson(res, 200, { currentYear: currentServiceYear(ctx), years: rows.map(mapServiceYear) });
}

/**
 * Copies every ACTIVE service of `sourceYear` into `targetYear` as new records (new ids, same
 * name and description, active). Names already present in the target year are skipped.
 */
function copyServicesBetweenYears(db, { sourceYear, targetYear, user, now }) {
  if (sourceYear === targetYear) throw validationError('El ejercicio de origen debe ser distinto del de destino.');
  if (!serviceYearExists(db, sourceYear)) throw notFoundServiceYearError(sourceYear);
  const sources = db
    .prepare("SELECT id, name, description FROM services WHERE year = ? AND status = 'active' ORDER BY name COLLATE NOCASE")
    .all(sourceYear);
  const taken = db.prepare('SELECT id FROM services WHERE year = ? AND name = ? COLLATE NOCASE');
  const insert = db.prepare(
    'INSERT INTO services (id, name, description, status, year, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  let created = 0;
  for (const source of sources) {
    if (taken.get(targetYear, source.name)) continue;
    const id = randomUUID();
    insert.run(id, source.name, source.description, 'active', targetYear, now, now);
    appendEntityEvent(db, { type: 'services', id, user, action: 'created', detail: { copiedFrom: source.id, year: sourceYear }, now });
    created += 1;
  }
  return { created, skipped: sources.length - created };
}

/** Creates a year; with `copyFromYear` it also copies that year's active services atomically. */
async function createServiceYear(ctx, req, res) {
  const user = requireUser(ctx, req);
  const body = await readJson(req);
  const year = parseServiceYear(body.year);
  const hasSource = body.copyFromYear !== undefined && body.copyFromYear !== null && body.copyFromYear !== '';
  const sourceYear = hasSource ? parseServiceYear(body.copyFromYear) : null;
  const now = ctx.now().toISOString();
  const copy = withTransaction(ctx.db, () => {
    if (serviceYearExists(ctx.db, year)) throw new HttpError(409, 'duplicate_record', `El ejercicio ${year} ya existe.`);
    ctx.db.prepare('INSERT INTO service_years (year, created_at) VALUES (?, ?)').run(year, now);
    return hasSource ? copyServicesBetweenYears(ctx.db, { sourceYear, targetYear: year, user, now }) : { created: 0, skipped: 0 };
  });
  sendJson(res, 201, { year: mapServiceYear(getServiceYear(ctx.db, year)), ...copy });
}

async function copyServiceYear(ctx, req, res, rawYear, rawSourceYear) {
  const user = requireUser(ctx, req);
  const targetYear = parseServiceYear(decodeId(rawYear));
  const sourceYear = parseServiceYear(decodeId(rawSourceYear));
  const now = ctx.now().toISOString();
  const copy = withTransaction(ctx.db, () => {
    if (!serviceYearExists(ctx.db, targetYear)) throw notFoundServiceYearError(targetYear);
    return copyServicesBetweenYears(ctx.db, { sourceYear, targetYear, user, now });
  });
  sendJson(res, 200, { year: mapServiceYear(getServiceYear(ctx.db, targetYear)), ...copy });
}

/** A year is physically deleted only while it has no services (active or not). */
function deleteServiceYear(ctx, req, res, rawYear) {
  requireUser(ctx, req);
  const year = parseServiceYear(decodeId(rawYear));
  withTransaction(ctx.db, () => {
    if (!serviceYearExists(ctx.db, year)) throw notFoundServiceYearError(year);
    const count = Number(ctx.db.prepare('SELECT COUNT(*) AS count FROM services WHERE year = ?').get(year).count);
    if (count > 0) {
      throw new HttpError(
        409,
        'service_year_in_use',
        `No se puede eliminar el ejercicio ${year}: tiene ${count} ${count === 1 ? 'servicio' : 'servicios'}. Elimínalos antes.`,
      );
    }
    ctx.db.prepare('DELETE FROM service_years WHERE year = ?').run(year);
  });
  sendJson(res, 200, { deleted: true });
}

function getMasterRow(db, kind, id) {
  if (kind === 'towers') {
    return db.prepare('SELECT towers.*, people.name AS responsible_name, lobs.name AS lob_name FROM towers LEFT JOIN people ON people.id = towers.responsible_id LEFT JOIN lobs ON lobs.id = towers.lob_id WHERE towers.id = ?').get(id);
  }
  return db.prepare(`SELECT * FROM ${MASTER_CONFIG[kind].table} WHERE id = ?`).get(id);
}

/** LoB deactivation is blocked while a Tower or Opportunity still references it. */
function assertLobUnreferenced(db, id) {
  const tower = db.prepare('SELECT id FROM towers WHERE lob_id = ? LIMIT 1').get(id);
  const opportunity = db.prepare('SELECT opportunity_id FROM opportunity_lobs WHERE lob_id = ? LIMIT 1').get(id);
  if (tower || opportunity) {
    throw new HttpError(409, 'lob_in_use', 'No se puede desactivar esta LoB porque está vinculada a towers u oportunidades.');
  }
}

async function mutateMaster(ctx, req, res, kind, rawId = null) {
  const user = requireUser(ctx, req);
  const { table, plural, fields } = MASTER_CONFIG[kind];
  const body = req.method === 'DELETE' ? {} : await readJson(req);
  const now = ctx.now().toISOString();
  let row;
  // Service names are unique per fiscal year; every other catalog is unique globally.
  const nameTaken = (name, ignoreId = null, year = null) => {
    const found = year === null
      ? ctx.db.prepare(`SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE`).get(name)
      : ctx.db.prepare(`SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE AND year = ?`).get(name, year);
    return Boolean(found && found.id !== ignoreId);
  };
  const duplicateError = (year) => new HttpError(
    409,
    'duplicate_record',
    year === null ? 'Ya existe un registro con ese nombre.' : `Ya existe un servicio con ese nombre en el ejercicio ${year}.`,
  );
  if (req.method === 'POST') {
    const values = fields.map((field) => {
      if (field === 'name') return parseTextField(body[field], field, 120);
      return typeof body[field] === 'string' ? body[field].trim().slice(0, 240) : '';
    });
    const year = kind === 'services' ? resolveServiceYear(ctx, body.year) : null;
    if (nameTaken(values[0], null, year)) throw duplicateError(year);
    const extraColumns = [];
    const extraValues = [];
    if (kind === 'services') {
      extraColumns.push('year');
      extraValues.push(year);
    }
    if (kind === 'towers') {
      const responsibleId = optionalId(ctx.db, 'people', body.responsibleId, 'responsable');
      if (!responsibleId) throw validationError('Selecciona un responsable para la tower.');
      extraColumns.push('responsible_id', 'lob_id');
      extraValues.push(responsibleId, optionalId(ctx.db, 'lobs', body.lobId, 'LoB'));
    }
    const id = randomUUID();
    const columns = ['id', ...fields, ...extraColumns, 'status', 'created_at', 'updated_at'];
    ctx.db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(id, ...values, ...extraValues, 'active', now, now);
    appendEntityEvent(ctx.db, { type: kind, id, user, action: 'created', now });
    row = getMasterRow(ctx.db, kind, id);
  } else {
    const id = decodeId(rawId);
    const current = ctx.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!current) throw new HttpError(404, 'not_found', 'El registro no existe.');
    // DELETE is a real, relation-guarded delete. Deactivation stays a PATCH with `active: false`.
    if (req.method === 'DELETE') {
      deleteMaster(ctx, res, kind, id);
      return;
    } else {
      const changes = [];
      const hasYear = kind === 'services' && Object.hasOwn(body, 'year');
      const year = kind !== 'services' ? null : (hasYear ? resolveServiceYear(ctx, body.year, { required: true }) : current.year);
      if (hasYear && year !== current.year) {
        // Moving a service to another year re-checks its (possibly unchanged) name there.
        const finalName = Object.hasOwn(body, 'name') ? parseTextField(body.name, 'name', 120) : current.name;
        if (nameTaken(finalName, id, year)) throw duplicateError(year);
        changes.push(['year', year]);
      }
      for (const field of fields) {
        if (!Object.hasOwn(body, field)) continue;
        if (field === 'name') {
          const name = parseTextField(body[field], field, 120);
          if (nameTaken(name, id, year)) throw duplicateError(year);
          changes.push([field, name]);
        } else {
          changes.push([field, String(body[field] ?? '').trim().slice(0, 240)]);
        }
      }
      if (kind === 'towers') {
        if (Object.hasOwn(body, 'active')) throw validationError('Las towers no tienen estado activo o inactivo.');
        if (Object.hasOwn(body, 'responsibleId')) {
          const responsibleId = optionalId(ctx.db, 'people', body.responsibleId, 'responsable');
          if (!responsibleId) throw validationError('Selecciona un responsable para la tower.');
          changes.push(['responsible_id', responsibleId]);
        }
        if (Object.hasOwn(body, 'lobId')) changes.push(['lob_id', optionalId(ctx.db, 'lobs', body.lobId, 'LoB')]);
      } else if (Object.hasOwn(body, 'active')) {
        if (kind === 'lobs' && body.active === false) assertLobUnreferenced(ctx.db, id);
        changes.push(['status', body.active ? 'active' : 'inactive']);
      }
      if (!changes.length) {
        const mapped = mapMaster(getMasterRow(ctx.db, kind, id), kind);
        sendJson(res, 200, kind === 'towers' ? { record: mapped } : { [plural.slice(0, -1)]: mapped });
        return;
      }
      ctx.db.prepare(`UPDATE ${table} SET ${changes.map(([field]) => `${field} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...changes.map(([, value]) => value), now, id);
      appendEntityEvent(ctx.db, { type: kind, id, user, action: changes.some(([field]) => field === 'status') ? 'status_changed' : 'updated', detail: { fields: changes.map(([field]) => field) }, now });
    }
    row = getMasterRow(ctx.db, kind, id);
  }
  sendJson(res, req.method === 'POST' ? 201 : 200, { record: mapMaster(row, kind) });
}

const INITIATIVE_DISPLAY_SELECT = `SELECT initiatives.*, clients.name AS client_name
    FROM initiatives LEFT JOIN clients ON clients.id = initiatives.client_id`;

function getInitiativeForDisplay(db, id) {
  return db.prepare(`${INITIATIVE_DISPLAY_SELECT} WHERE initiatives.id = ?`).get(id);
}

function listInitiatives(ctx, req, res, query) {
  requireUser(ctx, req);
  const archived = query?.get('archived') === '1';
  const rows = ctx.db
    .prepare(
      `${INITIATIVE_DISPLAY_SELECT}
        WHERE initiatives.archived_at IS ${archived ? 'NOT NULL' : 'NULL'}
        ORDER BY initiatives.created_at DESC, initiatives.id DESC`,
    )
    .all();
  sendJson(res, 200, { initiatives: rows.map((row) => mapInitiative(row, ctx.db)) });
}

function notFoundInitiativeError() {
  return new HttpError(404, 'not_found', 'La iniciativa no existe.');
}

async function mutateInitiative(ctx, req, res, rawId = null) {
  const user = requireUser(ctx, req);
  const body = await readJson(req);
  const now = ctx.now().toISOString();
  const serviceIds = parseIdList(body.serviceIds ?? body.service_ids, 'servicios');
  const links = parseWorkspaceLinks(body.links);
  const hasServiceIds = Object.hasOwn(body, 'serviceIds') || Object.hasOwn(body, 'service_ids');
  const hasLinks = Object.hasOwn(body, 'links');
  const currentServiceIds = rawId === null ? [] : linkedServiceIds(ctx.db, 'initiative_services', 'initiative_id', decodeId(rawId));
  assertAssignableServices(ctx, serviceIds, currentServiceIds);
  let id;
  if (req.method === 'POST') {
    const fields = {
      title: parseTextField(body.title, 'title', 160),
      category: parseInitiativeCategory(body.category),
      client_id: optionalId(ctx.db, 'clients', body.clientId, 'cliente'),
      priority: parseInitiativePriority(body.priority),
      next_action: parseShortText(body.nextAction),
      next_action_date: parseOptionalDate(body.nextActionDate, 'nextActionDate'),
      description: parseShortText(body.description, 2000),
      operational_status: parseInitiativeStatus(body.operationalStatus),
      stage: parseInitiativeStage(body.stage),
    };
    const columns = ['id', ...Object.keys(fields), 'created_at', 'updated_at'];
    const insert = ctx.db.prepare(`INSERT INTO initiatives (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
    let createdId;
    for (let attempt = 0; ; attempt += 1) {
      try {
        createdId = withTransaction(ctx.db, () => {
          const nextId = nextInitiativeId(ctx.db);
          insert.run(nextId, ...Object.values(fields), now, now);
          replaceJoinRows(ctx.db, 'initiative_services', 'initiative_id', nextId, 'service_id', serviceIds);
          replaceWorkspaceLinks(ctx.db, 'initiative', nextId, links, user, now);
          appendEntityEvent(ctx.db, { type: 'initiative', id: nextId, user, action: 'created', now });
          return nextId;
        });
        break;
      } catch (error) {
        if (!isUniqueViolation(error) || attempt >= 4) throw error;
      }
    }
    id = createdId;
  } else {
    id = decodeId(rawId);
    const existing = ctx.db.prepare('SELECT * FROM initiatives WHERE id = ?').get(id);
    if (!existing) throw notFoundInitiativeError();
    if (existing.archived_at) {
      throw new HttpError(409, 'record_archived', 'Restaura la iniciativa antes de editarla.');
    }
    const parsers = {
      title: (value) => parseTextField(value, 'title', 160),
      category: parseInitiativeCategory,
      clientId: (value) => optionalId(ctx.db, 'clients', value, 'cliente'),
      priority: parseInitiativePriority,
      nextAction: parseShortText,
      nextActionDate: (value) => parseOptionalDate(value, 'nextActionDate'),
      description: (value) => parseShortText(value, 2000),
      operationalStatus: parseInitiativeStatus,
      stage: parseInitiativeStage,
    };
    const columns = {
      title: 'title', category: 'category', clientId: 'client_id', priority: 'priority',
      nextAction: 'next_action', nextActionDate: 'next_action_date', description: 'description',
      operationalStatus: 'operational_status', stage: 'stage',
    };
    const fields = {};
    for (const [apiField, column] of Object.entries(columns)) {
      if (!Object.hasOwn(body, apiField)) continue;
      const value = parsers[apiField](body[apiField]);
      if (value !== existing[column]) fields[column] = value;
    }
    const changedFields = Object.keys(fields);
    if (changedFields.length > 0) {
      const assignments = changedFields.map((field) => `${field} = ?`).join(', ');
      ctx.db.prepare(`UPDATE initiatives SET ${assignments}, updated_at = ? WHERE id = ?`).run(...Object.values(fields), now, id);
    }
    if (hasServiceIds) replaceJoinRows(ctx.db, 'initiative_services', 'initiative_id', id, 'service_id', serviceIds);
    if (hasLinks) replaceWorkspaceLinks(ctx.db, 'initiative', id, links, user, now);
    if (changedFields.length > 0 || hasServiceIds || hasLinks) {
      appendEntityEvent(ctx.db, {
        type: 'initiative',
        id,
        user,
        action: 'updated',
        detail: { fields: [...changedFields, ...(hasServiceIds ? ['services'] : []), ...(hasLinks ? ['links'] : [])] },
        now,
      });
    }
  }
  sendJson(res, req.method === 'POST' ? 201 : 200, { initiative: mapInitiative(getInitiativeForDisplay(ctx.db, id), ctx.db) });
}

function setInitiativeArchive(ctx, req, res, rawId, archived) {
  const user = requireUser(ctx, req);
  const id = decodeId(rawId);
  const nowIso = ctx.now().toISOString();
  withTransaction(ctx.db, () => {
    if (!ctx.db.prepare('SELECT id FROM initiatives WHERE id = ?').get(id)) throw notFoundInitiativeError();
    ctx.db
      .prepare('UPDATE initiatives SET archived_at = ?, archived_by_id = ?, archived_by_name = ?, updated_at = ? WHERE id = ?')
      .run(archived ? nowIso : null, archived ? user.id : null, archived ? user.name : '', nowIso, id);
    appendEntityEvent(ctx.db, { type: 'initiative', id, user, action: archived ? 'archived' : 'restored', now: nowIso });
  });
  sendJson(res, 200, { initiative: mapInitiative(getInitiativeForDisplay(ctx.db, id), ctx.db) });
}

function listAgreements(ctx, req, res) {
  requireUser(ctx, req);
  const rows = ctx.db.prepare('SELECT * FROM framework_agreements ORDER BY created_at DESC').all();
  sendJson(res, 200, { agreements: rows.map((row) => mapAgreement(row, ctx.db)) });
}

function getAgreementForDisplay(db, id) {
  return mapAgreement(db.prepare('SELECT * FROM framework_agreements WHERE id = ?').get(id), db);
}

async function createAgreement(ctx, req, res) {
  const user = requireUser(ctx, req);
  const body = await readJson(req);
  const id = randomUUID();
  const now = ctx.now().toISOString();
  const title = parseTextField(body.title, 'title', 160);
  const clientId = optionalId(ctx.db, 'clients', body.clientId, 'cliente');
  const ownerId = optionalId(ctx.db, 'people', body.ownerId, 'responsable');
  const endDate = parseAgreementEndDate(body.endDate);
  const amount = parseAgreementAmount(body.amount);
  const notes = parseShortText(body.notes, AGREEMENT_NOTES_LIMIT);
  const registryId = parseRegistryId(body.registryId);
  const links = parseWorkspaceLinks(body.links);
  withTransaction(ctx.db, () => {
    ctx.db
      .prepare('INSERT INTO framework_agreements (id,title,client_id,owner_id,end_date,amount,notes,registry_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, title, clientId, ownerId, endDate, amount, notes, registryId, 'active', now, now);
    replaceWorkspaceLinks(ctx.db, AGREEMENT_ENTITY_TYPE, id, links, user, now);
    appendEntityEvent(ctx.db, { type: AGREEMENT_ENTITY_TYPE, id, user, action: 'created', now });
  });
  sendJson(res, 201, { agreement: getAgreementForDisplay(ctx.db, id) });
}

const AGREEMENT_NOTES_LIMIT = 2000;

function parseAgreementEndDate(value) {
  return typeof value === 'string' ? value.trim().slice(0, 40) : '';
}

/** Agreement amount is optional: empty means 0 (not applicable); otherwise it must be >= 0. */
function parseAgreementAmount(value) {
  if (value === undefined || value === null || value === '') return 0;
  return Number(parseAmount(value));
}

async function updateAgreement(ctx, req, res, rawId) {
  const user = requireUser(ctx, req);
  const id = decodeId(rawId);
  const existing = ctx.db.prepare('SELECT * FROM framework_agreements WHERE id = ?').get(id);
  if (!existing) throw new HttpError(404, 'not_found', 'El acuerdo marco no existe.');
  const body = await readJson(req);
  const parsers = {
    title: ['title', (value) => parseTextField(value, 'title', 160)],
    clientId: ['client_id', (value) => optionalId(ctx.db, 'clients', value, 'cliente')],
    ownerId: ['owner_id', (value) => optionalId(ctx.db, 'people', value, 'responsable')],
    endDate: ['end_date', parseAgreementEndDate],
    amount: ['amount', parseAgreementAmount],
    notes: ['notes', (value) => parseShortText(value, AGREEMENT_NOTES_LIMIT)],
    registryId: ['registry_id', parseRegistryId],
  };
  const changes = {};
  for (const [apiField, [column, parse]] of Object.entries(parsers)) {
    if (!Object.hasOwn(body, apiField)) continue;
    const next = parse(body[apiField]);
    if (next !== existing[column]) changes[column] = next;
  }
  // Sending `links` replaces the whole set, like initiatives and opportunities.
  const hasLinks = Object.hasOwn(body, 'links');
  const links = hasLinks ? parseWorkspaceLinks(body.links) : null;
  const columns = Object.keys(changes);
  if (columns.length > 0 || hasLinks) {
    const now = ctx.now().toISOString();
    withTransaction(ctx.db, () => {
      if (columns.length > 0) {
        ctx.db
          .prepare(`UPDATE framework_agreements SET ${columns.map((column) => `${column} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
          .run(...columns.map((column) => changes[column]), now, id);
      } else {
        ctx.db.prepare('UPDATE framework_agreements SET updated_at = ? WHERE id = ?').run(now, id);
      }
      if (hasLinks) replaceWorkspaceLinks(ctx.db, AGREEMENT_ENTITY_TYPE, id, links, user, now);
      appendEntityEvent(ctx.db, { type: AGREEMENT_ENTITY_TYPE, id, user, action: 'updated', detail: { fields: [...columns, ...(hasLinks ? ['links'] : [])] }, now });
    });
  }
  sendJson(res, 200, { agreement: getAgreementForDisplay(ctx.db, id) });
}

function listActions(ctx, req, res, type, rawId) {
  requireUser(ctx, req);
  const id = decodeId(rawId);
  const exists = type === 'initiative'
    ? ctx.db.prepare('SELECT id FROM initiatives WHERE id = ?').get(id)
    : ctx.db.prepare('SELECT id FROM opportunities WHERE id = ?').get(id);
  if (!exists) throw new HttpError(404, 'not_found', 'El registro no existe.');
  const rows = ctx.db.prepare('SELECT * FROM record_actions WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC').all(type, id);
  const comments = ctx.db.prepare(`SELECT c.id, c.action_id, c.text, c.user_name, c.created_at
    FROM record_action_comments c JOIN record_actions a ON a.id = c.action_id
    WHERE a.entity_type = ? AND a.entity_id = ? ORDER BY c.created_at, c.id`).all(type, id);
  const commentsByAction = new Map();
  for (const comment of comments) {
    const actionComments = commentsByAction.get(comment.action_id) ?? [];
    actionComments.push({ id: comment.id, text: comment.text, userName: comment.user_name, createdAt: comment.created_at });
    commentsByAction.set(comment.action_id, actionComments);
  }
  sendJson(res, 200, { actions: rows.map((row) => ({ id: row.id, text: row.text, kind: row.kind, status: row.status, userName: row.user_name, createdAt: row.created_at, completedAt: row.completed_at, comments: commentsByAction.get(row.id) ?? [] })) });
}

function listEntityEvents(ctx, req, res, type, rawId) {
  requireUser(ctx, req);
  const id = decodeId(rawId);
  const table = type === 'initiative' ? 'initiatives' : 'opportunities';
  if (!ctx.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id)) throw new HttpError(404, 'not_found', 'El registro no existe.');
  const rows = ctx.db.prepare('SELECT id, action, detail, user_name, created_at FROM entity_events WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT 100').all(type, id);
  sendJson(res, 200, { events: rows.map((row) => ({ id: Number(row.id), action: row.action, detail: safeParseJson(row.detail, {}), userName: row.user_name, createdAt: row.created_at })) });
}

async function createAction(ctx, req, res, type, rawId) {
  const user = requireUser(ctx, req);
  const id = decodeId(rawId);
  const body = await readJson(req);
  const text = parseTextField(body.text, 'acción', 500);
  const kind = body.kind === 'note' ? 'note' : 'action';
  const status = kind === 'note' ? 'note' : 'pending';
  const now = ctx.now().toISOString();
  const actionId = randomUUID();
  withTransaction(ctx.db, () => {
    const table = type === 'initiative' ? 'initiatives' : 'opportunities';
    if (!ctx.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id)) throw new HttpError(404, 'not_found', 'El registro no existe.');
    ctx.db.prepare('INSERT INTO record_actions (id,entity_type,entity_id,text,kind,status,user_id,user_name,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(actionId, type, id, text, kind, status, user.id, user.name, now);
    appendEntityEvent(ctx.db, { type, id, user, action: 'action_added', detail: { actionId }, now });
  });
  sendJson(res, 201, { action: { id: actionId, text, kind, status, userName: user.name, createdAt: now, completedAt: null, comments: [] } });
}

async function updateAction(ctx, req, res, rawActionId) {
  const user = requireUser(ctx, req);
  const actionId = decodeId(rawActionId);
  const body = await readJson(req);
  const status = body.status === 'completed' ? 'completed' : body.status === 'pending' ? 'pending' : null;
  if (!status) throw validationError('El estado debe ser pending o completed.');
  const now = ctx.now().toISOString();
  const result = withTransaction(ctx.db, () => {
    const existing = ctx.db.prepare('SELECT * FROM record_actions WHERE id = ?').get(actionId);
    if (!existing) throw new HttpError(404, 'not_found', 'La acción no existe.');
    ctx.db.prepare('UPDATE record_actions SET status = ?, completed_at = ? WHERE id = ?').run(status, status === 'completed' ? now : null, actionId);
    appendEntityEvent(ctx.db, { type: existing.entity_type, id: existing.entity_id, user, action: status === 'completed' ? 'action_completed' : 'action_reopened', detail: { actionId }, now });
    return { id: actionId, text: existing.text, kind: existing.kind, status, userName: existing.user_name, createdAt: existing.created_at, completedAt: status === 'completed' ? now : null };
  });
  sendJson(res, 200, { action: { ...result, comments: ctx.db.prepare('SELECT id, text, user_name AS userName, created_at AS createdAt FROM record_action_comments WHERE action_id = ? ORDER BY created_at, id').all(actionId) } });
}

async function createActionComment(ctx, req, res, rawActionId) {
  const user = requireUser(ctx, req);
  const actionId = decodeId(rawActionId);
  const body = await readJson(req);
  const text = parseTextField(body.text, 'comentario', 500);
  const now = ctx.now().toISOString();
  const commentId = randomUUID();
  const comment = withTransaction(ctx.db, () => {
    const action = ctx.db.prepare('SELECT * FROM record_actions WHERE id = ?').get(actionId);
    if (!action || action.kind !== 'action') throw new HttpError(404, 'not_found', 'La acción no existe.');
    ctx.db.prepare('INSERT INTO record_action_comments (id,action_id,user_id,user_name,text,created_at) VALUES (?,?,?,?,?,?)').run(commentId, actionId, user.id, user.name, text, now);
    appendEntityEvent(ctx.db, { type: action.entity_type, id: action.entity_id, user, action: 'action_comment_added', detail: { actionId, commentId }, now });
    return { id: commentId, text, userName: user.name, createdAt: now };
  });
  sendJson(res, 201, { comment });
}

function parseEventLimit(rawLimit) {
  if (rawLimit === null || rawLimit.trim() === '') return 50;
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed)) {
    throw validationError('El límite debe ser un número entero.');
  }
  return Math.min(200, Math.max(1, Math.trunc(parsed)));
}

function listEvents(ctx, req, res, rawId, query) {
  requireUser(ctx, req);
  const id = decodeId(rawId);

  const card = ctx.db.prepare('SELECT id FROM opportunities WHERE id = ?').get(id);
  if (!card) throw notFoundError();

  const limit = parseEventLimit(query.get('limit'));
  const rows = ctx.db
    .prepare(
      `SELECT id, action, detail, user_name, created_at
         FROM card_events
        WHERE card_id = ?
        ORDER BY id DESC
        LIMIT ?`,
    )
    .all(id, limit);

  sendJson(res, 200, { events: rows.map(mapEvent) });
}

function decodeId(rawId) {
  try {
    return decodeURIComponent(rawId);
  } catch {
    throw notFoundError();
  }
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

const OPPORTUNITY_ITEM_PATTERN = /^\/api\/opportunities\/([^/]+)$/;
const OPPORTUNITY_ARCHIVE_PATTERN = /^\/api\/opportunities\/([^/]+)\/(archive|restore)$/;
const OPPORTUNITY_EVENTS_PATTERN = /^\/api\/opportunities\/([^/]+)\/events$/;
const MASTER_ITEM_PATTERN = /^\/api\/(clients|towers|people|services|lobs)\/([^/]+)$/;
const SERVICE_YEAR_ITEM_PATTERN = /^\/api\/service-years\/([^/]+)$/;
const SERVICE_YEAR_COPY_PATTERN = /^\/api\/service-years\/([^/]+)\/copy-from\/([^/]+)$/;
const ACTIONS_PATTERN =/^\/api\/(initiatives|opportunities)\/([^/]+)\/actions$/;
const ACTION_ITEM_PATTERN = /^\/api\/actions\/([^/]+)$/;
const ACTION_COMMENTS_PATTERN = /^\/api\/actions\/([^/]+)\/comments$/;
const INITIATIVE_ITEM_PATTERN = /^\/api\/initiatives\/([^/]+)$/;
const INITIATIVE_ARCHIVE_PATTERN = /^\/api\/initiatives\/([^/]+)\/(archive|restore)$/;
const INITIATIVE_CONVERT_PATTERN = /^\/api\/initiatives\/([^/]+)\/convert$/;
const INITIATIVE_EVENTS_PATTERN = /^\/api\/initiatives\/([^/]+)\/events$/;
const AGREEMENT_ITEM_PATTERN = /^\/api\/agreements\/([^/]+)$/;

async function handleApi(ctx, req, res, pathname, query) {
  // CSRF guard runs before any handler, including the auth routes.
  assertSameOrigin(req);

  if (pathname === '/api/health') {
    if (req.method !== 'GET') return rejectMethod(res, 'GET');
    return health(ctx, res);
  }

  if (pathname === '/api/version') {
    if (req.method !== 'GET') return rejectMethod(res, 'GET');
    return version(res);
  }

  if (pathname === '/api/auth/register') {
    if (req.method !== 'POST') return rejectMethod(res, 'POST');
    return register(ctx, req, res);
  }

  if (pathname === '/api/auth/login') {
    if (req.method !== 'POST') return rejectMethod(res, 'POST');
    return login(ctx, req, res);
  }

  if (pathname === '/api/auth/logout') {
    if (req.method !== 'POST') return rejectMethod(res, 'POST');
    return logout(ctx, req, res);
  }

  if (pathname === '/api/me') {
    if (req.method !== 'GET') return rejectMethod(res, 'GET');
    return me(ctx, req, res);
  }

  if (pathname === '/api/service-years') {
    if (req.method === 'GET') return listServiceYears(ctx, req, res);
    if (req.method === 'POST') return createServiceYear(ctx, req, res);
    return rejectMethod(res, 'GET', 'POST');
  }
  const serviceYearCopy = SERVICE_YEAR_COPY_PATTERN.exec(pathname);
  if (serviceYearCopy) {
    if (req.method !== 'POST') return rejectMethod(res, 'POST');
    return copyServiceYear(ctx, req, res, serviceYearCopy[1], serviceYearCopy[2]);
  }
  const serviceYearItem = SERVICE_YEAR_ITEM_PATTERN.exec(pathname);
  if (serviceYearItem) {
    if (req.method !== 'DELETE') return rejectMethod(res, 'DELETE');
    return deleteServiceYear(ctx, req, res, serviceYearItem[1]);
  }

  const masterItem = MASTER_ITEM_PATTERN.exec(pathname);
  if (masterItem) {
    if (req.method === 'PATCH') return mutateMaster(ctx, req, res, masterItem[1], masterItem[2]);
    if (req.method === 'DELETE') return mutateMaster(ctx, req, res, masterItem[1], masterItem[2]);
    return rejectMethod(res, 'PATCH', 'DELETE');
  }
  if (Object.hasOwn(MASTER_CONFIG, pathname.slice('/api/'.length)) && pathname.split('/').length === 3) {
    const kind = pathname.slice('/api/'.length);
    if (req.method === 'GET') return listMaster(ctx, req, res, kind, query);
    if (req.method === 'POST') return mutateMaster(ctx, req, res, kind);
    return rejectMethod(res, 'GET', 'POST');
  }
  if (pathname === '/api/initiatives') {
    if (req.method === 'GET') return listInitiatives(ctx, req, res, query);
    if (req.method === 'POST') return mutateInitiative(ctx, req, res);
    return rejectMethod(res, 'GET', 'POST');
  }
  const initiativeArchiveMatch = INITIATIVE_ARCHIVE_PATTERN.exec(pathname);
  if (initiativeArchiveMatch) {
    if (req.method !== 'POST') return rejectMethod(res, 'POST');
    return setInitiativeArchive(ctx, req, res, initiativeArchiveMatch[1], initiativeArchiveMatch[2] === 'archive');
  }
  const initiativeConvertMatch = INITIATIVE_CONVERT_PATTERN.exec(pathname);
  if (initiativeConvertMatch) {
    if (req.method !== 'POST') return rejectMethod(res, 'POST');
    return createOpportunity(ctx, req, res, initiativeConvertMatch[1]);
  }
  if (pathname === '/api/agreements') {
    if (req.method === 'GET') return listAgreements(ctx, req, res);
    if (req.method === 'POST') return createAgreement(ctx, req, res);
    return rejectMethod(res, 'GET', 'POST');
  }
  const agreementItem = AGREEMENT_ITEM_PATTERN.exec(pathname);
  if (agreementItem) {
    if (req.method === 'DELETE') return deleteAgreement(ctx, req, res, agreementItem[1]);
    if (req.method !== 'PATCH') return rejectMethod(res, 'PATCH', 'DELETE');
    return updateAgreement(ctx, req, res, agreementItem[1]);
  }
  const initiativeItem = INITIATIVE_ITEM_PATTERN.exec(pathname);
  if (initiativeItem) {
    if (req.method === 'DELETE') return deleteRecord(ctx, req, res, 'initiative', initiativeItem[1]);
    if (req.method !== 'PATCH') return rejectMethod(res, 'PATCH', 'DELETE');
    return mutateInitiative(ctx, req, res, initiativeItem[1]);
  }
  const actionList = ACTIONS_PATTERN.exec(pathname);
  if (actionList) {
    const type = actionList[1] === 'initiatives' ? 'initiative' : 'opportunity';
    if (req.method === 'GET') return listActions(ctx, req, res, type, actionList[2]);
    if (req.method === 'POST') return createAction(ctx, req, res, type, actionList[2]);
    return rejectMethod(res, 'GET', 'POST');
  }
  const initiativeEvents = INITIATIVE_EVENTS_PATTERN.exec(pathname);
  if (initiativeEvents) {
    if (req.method !== 'GET') return rejectMethod(res, 'GET');
    return listEntityEvents(ctx, req, res, 'initiative', initiativeEvents[1]);
  }
  const actionItem = ACTION_ITEM_PATTERN.exec(pathname);
  if (actionItem) {
    if (req.method !== 'PATCH') return rejectMethod(res, 'PATCH');
    return updateAction(ctx, req, res, actionItem[1]);
  }
  const actionComments = ACTION_COMMENTS_PATTERN.exec(pathname);
  if (actionComments) {
    if (req.method !== 'POST') return rejectMethod(res, 'POST');
    return createActionComment(ctx, req, res, actionComments[1]);
  }

  if (pathname === '/api/opportunities') {
    if (req.method === 'GET') return listOpportunities(ctx, req, res, query);
    if (req.method === 'POST') return createOpportunity(ctx, req, res);
    return rejectMethod(res, 'GET', 'POST');
  }

  const archiveMatch = OPPORTUNITY_ARCHIVE_PATTERN.exec(pathname);
  if (archiveMatch) {
    if (req.method !== 'POST') return rejectMethod(res, 'POST');
    return setOpportunityArchive(ctx, req, res, archiveMatch[1], archiveMatch[2] === 'archive');
  }

  const eventsMatch = OPPORTUNITY_EVENTS_PATTERN.exec(pathname);
  if (eventsMatch) {
    if (req.method !== 'GET') return rejectMethod(res, 'GET');
    return listEvents(ctx, req, res, eventsMatch[1], query);
  }

  const itemMatch = OPPORTUNITY_ITEM_PATTERN.exec(pathname);
  if (itemMatch) {
    if (req.method === 'DELETE') return deleteRecord(ctx, req, res, 'opportunity', itemMatch[1]);
    if (req.method !== 'PATCH') return rejectMethod(res, 'PATCH', 'DELETE');
    return patchOpportunity(ctx, req, res, itemMatch[1]);
  }

  throw new HttpError(404, 'not_found', 'Recurso no encontrado.');
}

function splitRequestUrl(rawUrl) {
  const value = typeof rawUrl === 'string' && rawUrl !== '' ? rawUrl : '/';
  const queryIndex = value.indexOf('?');
  return {
    pathname: queryIndex === -1 ? value : value.slice(0, queryIndex),
    query: new URLSearchParams(queryIndex === -1 ? '' : value.slice(queryIndex + 1)),
  };
}

/**
 * Builds the HTTP server.
 *
 * @param {object} deps
 * @param {import('node:sqlite').DatabaseSync} deps.db - open, migrated database handle.
 * @param {object} deps.config - result of loadConfig().
 * @param {ReturnType<typeof createLoginThrottle>} [deps.throttle] - optional shared throttle.
 * @param {() => Date} [deps.now] - injectable clock (tests).
 * @param {{ error: (message: string) => void }} [deps.logger]
 * @returns {import('node:http').Server}
 */
export function createServer(deps = {}) {
  const { db, config } = deps;
  if (!db) throw new Error('createServer requires a database instance');
  if (!config || typeof config.sessionSecret !== 'string' || config.sessionSecret === '') {
    throw new Error('createServer requires a config with a session secret');
  }

  const logger = deps.logger ?? defaultLogger;
  const ctx = {
    db,
    config,
    throttle: deps.throttle ?? createLoginThrottle(),
    registerThrottle: deps.registerThrottle ?? createLoginThrottle({ maxAttempts: 10 }),
    now: deps.now ?? (() => new Date()),
  };

  return http.createServer((req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');

    const { pathname, query } = splitRequestUrl(req.url);

    const run = pathname === '/api' || pathname.startsWith('/api/')
      ? handleApi(ctx, req, res, pathname, query)
      : (req.method === 'GET' || req.method === 'HEAD'
        ? serveStatic(req, res, pathname, { distDir: config.distDir })
        : Promise.reject(new HttpError(405, 'method_not_allowed', 'Método no permitido.')));

    Promise.resolve(run).catch((error) => {
      if (!(error instanceof HttpError)) {
        logger.error(`[crm] unhandled request error: ${error?.stack ?? error}`);
      }
      sendError(res, error);
    });
  });
}

export { STAGES, EDITABLE_FIELDS };
