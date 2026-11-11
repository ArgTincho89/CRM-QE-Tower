import { randomUUID } from 'node:crypto';
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
import { stages } from '../src/data.js';
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

const FIELD_LIMITS = {
  title: 160,
  account: 120,
  amount: 40,
  tower: 60,
  owner: 80,
  due: 40,
};

/** Field names a PATCH may touch. The order also drives the `updated` event payload. */
const EDITABLE_FIELDS = ['title', 'account', 'amount', 'stage', 'tower', 'owner', 'due', 'tags', 'number', 'client_id', 'tower_id', 'owner_id', 'bid_manager_id', 'qa_percent', 'closure_reason'];

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

function mapOpportunity(row) {
  return {
    id: row.id,
    title: row.title,
    account: row.linked_client_name || row.account || '',
    amount: formatCurrency(Number(parseAmount(row.amount))),
    stage: row.stage,
    tower: row.linked_tower_name || row.tower || '',
    owner: row.linked_owner_name || row.owner || '',
    due: row.due,
    tags: safeParseJson(row.tags, []),
    number: row.number || '',
    clientId: row.client_id || '',
    towerId: row.tower_id || '',
    ownerId: row.owner_id || '',
    bidManagerId: row.bid_manager_id || '',
    bidManager: row.linked_bid_manager_name || '',
    qaPercent: Number(row.qa_percent || 0),
    closureReason: row.closure_reason || '',
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
  const mapped = { id: row.id, name: row.name, sector: row.sector ?? undefined, email: row.email ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at };
  if (kind === 'towers') {
    mapped.responsibleId = row.responsible_id || '';
    mapped.responsibleName = row.responsible_name || '';
    return mapped;
  }
  mapped.active = row.status === 'active';
  return mapped;
}

function mapInitiative(row) {
  return { id: row.id, title: row.title, category: row.category, clientId: row.client_id || '', towerId: row.tower_id || '', ownerId: row.owner_id || '', bidManagerId: row.bid_manager_id || '', amount: row.amount, qaPercent: Number(row.qa_percent), status: row.status, closureReason: row.closure_reason, stage: row.stage, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapAgreement(row) {
  return { id: row.id, title: row.title, clientId: row.client_id || '', ownerId: row.owner_id || '', endDate: row.end_date, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
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
  if (field === 'number' || field === 'closure_reason') return typeof value === 'string' ? value.trim().slice(0, 160) : '';
  return parseTextField(value, field, FIELD_LIMITS[field]);
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

function listOpportunities(ctx, req, res) {
  requireUser(ctx, req);
  const rows = ctx.db
    .prepare(`${OPPORTUNITY_DISPLAY_SELECT} ORDER BY opportunities.created_at DESC, opportunities.id DESC`)
    .all();
  sendJson(res, 200, { opportunities: rows.map(mapOpportunity) });
}

async function createOpportunity(ctx, req, res) {
  const user = requireUser(ctx, req);
  const body = await readJson(req);

  const values = {
    title: parseTextField(body.title, 'title', FIELD_LIMITS.title),
    account: typeof body.account === 'string' ? body.account.trim() : '',
    amount: parseAmount(body.amount),
    stage: parseStage(body.stage),
    tower: typeof body.tower === 'string' ? body.tower.trim() : '',
    owner: typeof body.owner === 'string' ? body.owner.trim() : '',
    due: typeof body.due === 'string' ? body.due.trim() : '',
    tags: JSON.stringify(body.tags === undefined ? [] : parseTags(body.tags)),
    number: typeof body.number === 'string' ? body.number.trim().slice(0, 160) : '',
    client_id: optionalId(ctx.db, 'clients', body.clientId, 'cliente'),
    tower_id: optionalTowerId(ctx.db, body.towerId),
    owner_id: optionalId(ctx.db, 'people', body.ownerId, 'responsable'),
    bid_manager_id: optionalId(ctx.db, 'people', body.bidManagerId, 'bid manager'),
    qa_percent: parsePercent(body.qaPercent ?? 0),
    closure_reason: typeof body.closureReason === 'string' ? body.closureReason.trim().slice(0, 160) : '',
  };

  const nowIso = ctx.now().toISOString();
  const insert = ctx.db.prepare(
    `INSERT INTO opportunities
       (id, title, account, amount, stage, tower, owner, due, tags, created_at, updated_at, number, client_id, tower_id, owner_id, bid_manager_id, qa_percent, closure_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        );
        insertCardEvent(ctx.db, {
          cardId: id,
          user,
          action: 'created',
          detail: {},
          createdAt: nowIso,
        });
        appendEntityEvent(ctx.db, { type: 'opportunity', id, user, action: 'created', now: nowIso });
        return id;
      });
      break;
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= 4) throw error;
    }
  }

  const row = getOpportunityForDisplay(ctx.db, createdId);
  sendJson(res, 201, { opportunity: mapOpportunity(row) });
}

async function patchOpportunity(ctx, req, res, rawId) {
  const user = requireUser(ctx, req);
  const id = decodeId(rawId);

  const existing = ctx.db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id);
  if (!existing) throw notFoundError();

  const body = await readJson(req);

  const changes = {};
  const changedFields = [];
  const apiFields = { clientId: 'client_id', towerId: 'tower_id', ownerId: 'owner_id', bidManagerId: 'bid_manager_id', qaPercent: 'qa_percent', closureReason: 'closure_reason' };
  for (const apiField of EDITABLE_FIELDS.map((field) => Object.keys(apiFields).find((key) => apiFields[key] === field) || field)) {
    if (!Object.prototype.hasOwnProperty.call(body, apiField)) continue;
    const field = apiFields[apiField] || apiField;
    const nextValue = normalizeFieldValue(ctx.db, field, body[apiField]);
    if (nextValue === existing[field]) continue;
    changes[field] = nextValue;
    changedFields.push(field);
  }

  // Nothing actually changed: return the row untouched and write no event.
  if (changedFields.length === 0) {
    sendJson(res, 200, { opportunity: mapOpportunity(getOpportunityForDisplay(ctx.db, id)), events: [] });
    return;
  }

  const stageChanged = changedFields.includes('stage');
  const otherChanged = changedFields.filter((field) => field !== 'stage');
  const nowIso = ctx.now().toISOString();

  // Column names come from the fixed EDITABLE_FIELDS whitelist, never from the request body.
  const assignments = changedFields.map((field) => `${field} = ?`).join(', ');
  const update = ctx.db.prepare(
    `UPDATE opportunities SET ${assignments}, updated_at = ? WHERE id = ?`,
  );

  const events = [];
  // The row update and its history entries are one atomic unit.
  withTransaction(ctx.db, () => {
    update.run(...changedFields.map((field) => changes[field]), nowIso, id);

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
    if (otherChanged.length > 0) {
      events.push(
        insertCardEvent(ctx.db, {
          cardId: id,
          user,
          action: 'updated',
          detail: { fields: otherChanged },
          createdAt: nowIso,
        }),
      );
    }
    appendEntityEvent(ctx.db, { type: 'opportunity', id, user, action: stageChanged ? 'updated' : 'updated', detail: { fields: changedFields }, now: nowIso });
  });

  const updated = getOpportunityForDisplay(ctx.db, id);
  sendJson(res, 200, { opportunity: mapOpportunity(updated), events });
}

const MASTER_CONFIG = {
  clients: { table: 'clients', plural: 'clients', fields: ['name', 'sector'] },
  towers: { table: 'towers', plural: 'towers', fields: ['name'] },
  people: { table: 'people', plural: 'people', fields: ['name', 'email'] },
};

function listMaster(ctx, req, res, kind) {
  requireUser(ctx, req);
  const { table } = MASTER_CONFIG[kind];
  const rows = kind === 'towers'
    ? ctx.db.prepare(`SELECT towers.*, people.name AS responsible_name FROM towers LEFT JOIN people ON people.id = towers.responsible_id ORDER BY towers.name COLLATE NOCASE`).all()
    : ctx.db.prepare(`SELECT * FROM ${table} ORDER BY status ASC, name COLLATE NOCASE`).all();
  sendJson(res, 200, { records: rows.map((row) => mapMaster(row, kind)) });
}

function getMasterRow(db, kind, id) {
  if (kind === 'towers') {
    return db.prepare('SELECT towers.*, people.name AS responsible_name FROM towers LEFT JOIN people ON people.id = towers.responsible_id WHERE towers.id = ?').get(id);
  }
  return db.prepare(`SELECT * FROM ${MASTER_CONFIG[kind].table} WHERE id = ?`).get(id);
}

async function mutateMaster(ctx, req, res, kind, rawId = null) {
  const user = requireUser(ctx, req);
  const { table, plural, fields } = MASTER_CONFIG[kind];
  const body = req.method === 'DELETE' ? {} : await readJson(req);
  const now = ctx.now().toISOString();
  let row;
  if (req.method === 'POST') {
    const values = fields.map((field) => {
      if (field === 'name') return parseTextField(body[field], field, 120);
      return typeof body[field] === 'string' ? body[field].trim().slice(0, 160) : '';
    });
    const responsibleId = kind === 'towers' ? optionalId(ctx.db, 'people', body.responsibleId, 'responsable') : null;
    if (kind === 'towers' && !responsibleId) throw validationError('Selecciona un responsable para la tower.');
    if (kind === 'towers' && ctx.db.prepare('SELECT id FROM towers WHERE name = ?').get(values[0])) throw new HttpError(409, 'duplicate_record', 'Ya existe una tower con ese nombre.');
    const id = randomUUID();
    const columns = ['id', ...fields, ...(kind === 'towers' ? ['responsible_id'] : []), 'status', 'created_at', 'updated_at'];
    ctx.db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(id, ...values, ...(kind === 'towers' ? [responsibleId] : []), 'active', now, now);
    appendEntityEvent(ctx.db, { type: kind, id, user, action: 'created', now });
    row = getMasterRow(ctx.db, kind, id);
  } else {
    const id = decodeId(rawId);
    const current = ctx.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!current) throw new HttpError(404, 'not_found', 'El registro no existe.');
    if (req.method === 'DELETE') {
      if (kind === 'towers') {
        withTransaction(ctx.db, () => {
          const opportunity = ctx.db.prepare('SELECT id FROM opportunities WHERE tower_id = ? LIMIT 1').get(id);
          const initiative = ctx.db.prepare('SELECT id FROM initiatives WHERE tower_id = ? LIMIT 1').get(id);
          if (opportunity || initiative) {
            throw new HttpError(409, 'tower_in_use', 'No se puede eliminar esta tower porque está vinculada a oportunidades o iniciativas.');
          }
          appendEntityEvent(ctx.db, { type: kind, id, user, action: 'deleted', now });
          ctx.db.prepare('DELETE FROM towers WHERE id = ?').run(id);
        });
        sendJson(res, 200, { deleted: true });
        return;
      }
      ctx.db.prepare(`UPDATE ${table} SET status = 'inactive', updated_at = ? WHERE id = ?`).run(now, id);
      appendEntityEvent(ctx.db, { type: kind, id, user, action: 'deactivated', now });
    } else {
      const changes = fields.filter((field) => Object.hasOwn(body, field)).map((field) => [field, field === 'name' ? parseTextField(body[field], field, 120) : String(body[field] ?? '').trim().slice(0, 160)]);
      if (kind === 'towers') {
        if (Object.hasOwn(body, 'active')) throw validationError('Las towers no tienen estado activo o inactivo.');
        if (Object.hasOwn(body, 'responsibleId')) {
          const responsibleId = optionalId(ctx.db, 'people', body.responsibleId, 'responsable');
          if (!responsibleId) throw validationError('Selecciona un responsable para la tower.');
          changes.push(['responsible_id', responsibleId]);
        }
      } else if (Object.hasOwn(body, 'active')) changes.push(['status', body.active ? 'active' : 'inactive']);
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

function listInitiatives(ctx, req, res) {
  requireUser(ctx, req);
  const rows = ctx.db.prepare('SELECT * FROM initiatives ORDER BY created_at DESC, id DESC').all();
  sendJson(res, 200, { initiatives: rows.map(mapInitiative) });
}

async function mutateInitiative(ctx, req, res, rawId = null) {
  const user = requireUser(ctx, req);
  const body = await readJson(req);
  const now = ctx.now().toISOString();
  let id;
  if (req.method === 'POST') {
    const fields = {
      title: parseTextField(body.title, 'title', 160),
      category: body.category === undefined ? 'external' : body.category,
      client_id: optionalId(ctx.db, 'clients', body.clientId, 'cliente'),
      tower_id: optionalTowerId(ctx.db, body.towerId),
      owner_id: optionalId(ctx.db, 'people', body.ownerId, 'responsable'),
      bid_manager_id: optionalId(ctx.db, 'people', body.bidManagerId, 'bid manager'),
      amount: parseAmount(body.amount ?? 0),
      qa_percent: parsePercent(body.qaPercent ?? 0),
      status: typeof body.status === 'string' && body.status.trim() ? body.status.trim().slice(0, 40) : 'open',
      closure_reason: typeof body.closureReason === 'string' ? body.closureReason.trim().slice(0, 160) : '',
      stage: parseStage(body.stage ?? 'prospecting'),
    };
    if (!['internal', 'cross_selling', 'external'].includes(fields.category)) throw validationError('La categoría de la iniciativa no es válida.');
    const columns = ['id', ...Object.keys(fields), 'created_at', 'updated_at'];
    const insert = ctx.db.prepare(`INSERT INTO initiatives (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
    let createdId;
    for (let attempt = 0; ; attempt += 1) {
      try {
        createdId = withTransaction(ctx.db, () => {
          const nextId = nextInitiativeId(ctx.db);
          insert.run(nextId, ...Object.values(fields), now, now);
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
    if (!existing) throw new HttpError(404, 'not_found', 'La iniciativa no existe.');
    const parsers = {
      title: (value) => parseTextField(value, 'title', 160),
      category: (value) => {
        if (!['internal', 'cross_selling', 'external'].includes(value)) throw validationError('La categoría de la iniciativa no es válida.');
        return value;
      },
      clientId: (value) => optionalId(ctx.db, 'clients', value, 'cliente'),
      towerId: (value) => optionalTowerId(ctx.db, value),
      ownerId: (value) => optionalId(ctx.db, 'people', value, 'responsable'),
      bidManagerId: (value) => optionalId(ctx.db, 'people', value, 'bid manager'),
      amount: parseAmount,
      qaPercent: parsePercent,
      status: (value) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 40) : 'open',
      closureReason: (value) => typeof value === 'string' ? value.trim().slice(0, 160) : '',
      stage: parseStage,
    };
    const columns = {
      title: 'title', category: 'category', clientId: 'client_id', towerId: 'tower_id',
      ownerId: 'owner_id', bidManagerId: 'bid_manager_id', amount: 'amount',
      qaPercent: 'qa_percent', status: 'status', closureReason: 'closure_reason', stage: 'stage',
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
      appendEntityEvent(ctx.db, { type: 'initiative', id, user, action: 'updated', detail: { fields: changedFields }, now });
    }
  }
  sendJson(res, req.method === 'POST' ? 201 : 200, { initiative: mapInitiative(ctx.db.prepare('SELECT * FROM initiatives WHERE id = ?').get(id)) });
}

function listAgreements(ctx, req, res) {
  requireUser(ctx, req);
  sendJson(res, 200, { agreements: ctx.db.prepare('SELECT * FROM framework_agreements ORDER BY created_at DESC').all().map(mapAgreement) });
}

async function createAgreement(ctx, req, res) {
  const user = requireUser(ctx, req);
  const body = await readJson(req);
  const id = randomUUID();
  const now = ctx.now().toISOString();
  const title = parseTextField(body.title, 'title', 160);
  const clientId = optionalId(ctx.db, 'clients', body.clientId, 'cliente');
  const ownerId = optionalId(ctx.db, 'people', body.ownerId, 'responsable');
  const endDate = typeof body.endDate === 'string' ? body.endDate.trim().slice(0, 40) : '';
  ctx.db.prepare('INSERT INTO framework_agreements (id,title,client_id,owner_id,end_date,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, title, clientId, ownerId, endDate, 'active', now, now);
  appendEntityEvent(ctx.db, { type: 'agreement', id, user, action: 'created', now });
  sendJson(res, 201, { agreement: mapAgreement(ctx.db.prepare('SELECT * FROM framework_agreements WHERE id = ?').get(id)) });
}

function listActions(ctx, req, res, type, rawId) {
  requireUser(ctx, req);
  const id = decodeId(rawId);
  const exists = type === 'initiative'
    ? ctx.db.prepare('SELECT id FROM initiatives WHERE id = ?').get(id)
    : ctx.db.prepare('SELECT id FROM opportunities WHERE id = ?').get(id);
  if (!exists) throw new HttpError(404, 'not_found', 'El registro no existe.');
  const rows = ctx.db.prepare('SELECT * FROM record_actions WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC').all(type, id);
  sendJson(res, 200, { actions: rows.map((row) => ({ id: row.id, text: row.text, kind: row.kind, status: row.status, userName: row.user_name, createdAt: row.created_at, completedAt: row.completed_at })) });
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
  const exists = type === 'initiative' ? ctx.db.prepare('SELECT id FROM initiatives WHERE id = ?').get(id) : ctx.db.prepare('SELECT id FROM opportunities WHERE id = ?').get(id);
  if (!exists) throw new HttpError(404, 'not_found', 'El registro no existe.');
  const body = await readJson(req);
  const text = parseTextField(body.text, 'acción', 500);
  const kind = body.kind === 'note' ? 'note' : 'action';
  const status = kind === 'note' ? 'note' : 'pending';
  const now = ctx.now().toISOString();
  const actionId = randomUUID();
  ctx.db.prepare('INSERT INTO record_actions (id,entity_type,entity_id,text,kind,status,user_id,user_name,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(actionId, type, id, text, kind, status, user.id, user.name, now);
  appendEntityEvent(ctx.db, { type, id, user, action: 'action_added', detail: { actionId }, now });
  sendJson(res, 201, { action: { id: actionId, text, kind, status, userName: user.name, createdAt: now, completedAt: null } });
}

async function updateAction(ctx, req, res, rawActionId) {
  const user = requireUser(ctx, req);
  const actionId = decodeId(rawActionId);
  const existing = ctx.db.prepare('SELECT * FROM record_actions WHERE id = ?').get(actionId);
  if (!existing) throw new HttpError(404, 'not_found', 'La acción no existe.');
  const body = await readJson(req);
  const status = body.status === 'completed' ? 'completed' : body.status === 'pending' ? 'pending' : null;
  if (!status) throw validationError('El estado debe ser pending o completed.');
  const now = ctx.now().toISOString();
  ctx.db.prepare('UPDATE record_actions SET status = ?, completed_at = ? WHERE id = ?').run(status, status === 'completed' ? now : null, actionId);
  appendEntityEvent(ctx.db, { type: existing.entity_type, id: existing.entity_id, user, action: status === 'completed' ? 'action_completed' : 'action_reopened', detail: { actionId }, now });
  sendJson(res, 200, { action: { id: actionId, text: existing.text, kind: existing.kind, status, userName: existing.user_name, createdAt: existing.created_at, completedAt: status === 'completed' ? now : null } });
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
const OPPORTUNITY_EVENTS_PATTERN = /^\/api\/opportunities\/([^/]+)\/events$/;
const MASTER_ITEM_PATTERN = /^\/api\/(clients|towers|people)\/([^/]+)$/;
const ACTIONS_PATTERN = /^\/api\/(initiatives|opportunities)\/([^/]+)\/actions$/;
const ACTION_ITEM_PATTERN = /^\/api\/actions\/([^/]+)$/;
const INITIATIVE_ITEM_PATTERN = /^\/api\/initiatives\/([^/]+)$/;
const INITIATIVE_EVENTS_PATTERN = /^\/api\/initiatives\/([^/]+)\/events$/;

async function handleApi(ctx, req, res, pathname, query) {
  // CSRF guard runs before any handler, including the auth routes.
  assertSameOrigin(req);

  if (pathname === '/api/health') {
    if (req.method !== 'GET') return rejectMethod(res, 'GET');
    return health(ctx, res);
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

  const masterItem = MASTER_ITEM_PATTERN.exec(pathname);
  if (masterItem) {
    if (req.method === 'PATCH') return mutateMaster(ctx, req, res, masterItem[1], masterItem[2]);
    if (req.method === 'DELETE') return mutateMaster(ctx, req, res, masterItem[1], masterItem[2]);
    return rejectMethod(res, 'PATCH', 'DELETE');
  }
  if (Object.hasOwn(MASTER_CONFIG, pathname.slice('/api/'.length)) && pathname.split('/').length === 3) {
    const kind = pathname.slice('/api/'.length);
    if (req.method === 'GET') return listMaster(ctx, req, res, kind);
    if (req.method === 'POST') return mutateMaster(ctx, req, res, kind);
    return rejectMethod(res, 'GET', 'POST');
  }
  if (pathname === '/api/initiatives') {
    if (req.method === 'GET') return listInitiatives(ctx, req, res);
    if (req.method === 'POST') return mutateInitiative(ctx, req, res);
    return rejectMethod(res, 'GET', 'POST');
  }
  if (pathname === '/api/agreements') {
    if (req.method === 'GET') return listAgreements(ctx, req, res);
    if (req.method === 'POST') return createAgreement(ctx, req, res);
    return rejectMethod(res, 'GET', 'POST');
  }
  const initiativeItem = INITIATIVE_ITEM_PATTERN.exec(pathname);
  if (initiativeItem) {
    if (req.method !== 'PATCH') return rejectMethod(res, 'PATCH');
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

  if (pathname === '/api/opportunities') {
    if (req.method === 'GET') return listOpportunities(ctx, req, res);
    if (req.method === 'POST') return createOpportunity(ctx, req, res);
    return rejectMethod(res, 'GET', 'POST');
  }

  const eventsMatch = OPPORTUNITY_EVENTS_PATTERN.exec(pathname);
  if (eventsMatch) {
    if (req.method !== 'GET') return rejectMethod(res, 'GET');
    return listEvents(ctx, req, res, eventsMatch[1], query);
  }

  const itemMatch = OPPORTUNITY_ITEM_PATTERN.exec(pathname);
  if (itemMatch) {
    if (req.method !== 'PATCH') return rejectMethod(res, 'PATCH');
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
