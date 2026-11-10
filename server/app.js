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
import {
  HttpError,
  assertSameOrigin,
  readJson,
  sendError,
  sendJson,
  sendNoContent,
  serveStatic,
} from './http.js';

const STAGES = new Set(['prospecting', 'analysis', 'proposal', 'negotiation', 'won', 'waiting']);

const FIELD_LIMITS = {
  title: 160,
  account: 120,
  amount: 40,
  tower: 60,
  owner: 80,
  due: 40,
};

/** Field names a PATCH may touch. The order also drives the `updated` event payload. */
const EDITABLE_FIELDS = ['title', 'account', 'amount', 'stage', 'tower', 'owner', 'due', 'tags'];

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
    account: row.account,
    amount: row.amount,
    stage: row.stage,
    tower: row.tower,
    owner: row.owner,
    due: row.due,
    tags: safeParseJson(row.tags, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
function normalizeFieldValue(field, value) {
  if (field === 'stage') return parseStage(value);
  if (field === 'tags') return JSON.stringify(parseTags(value));
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
 * Builds the next `O-NNNN` id from the highest numeric suffix currently stored.
 * Uniqueness is re-checked for every candidate, and the caller retries the whole
 * insert on a unique violation (two processes on the same file).
 */
function nextOpportunityId(db) {
  const row = db
    .prepare("SELECT MAX(CAST(substr(id, 3) AS INTEGER)) AS max_id FROM opportunities WHERE id GLOB 'O-[0-9]*'")
    .get();
  const highest = Number(row?.max_id ?? 0);
  const start = Number.isFinite(highest) ? highest : 0;
  const exists = db.prepare('SELECT 1 AS found FROM opportunities WHERE id = ?');

  for (let offset = 1; offset <= 10000; offset += 1) {
    const candidate = `O-${String((start + offset) % 10000).padStart(4, '0')}`;
    if (!exists.get(candidate)) return candidate;
  }

  throw new HttpError(500, 'id_generation_failed', 'No se pudo generar un identificador único.');
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
    .prepare('SELECT * FROM opportunities ORDER BY created_at DESC, id DESC')
    .all();
  sendJson(res, 200, { opportunities: rows.map(mapOpportunity) });
}

async function createOpportunity(ctx, req, res) {
  const user = requireUser(ctx, req);
  const body = await readJson(req);

  const values = {
    title: parseTextField(body.title, 'title', FIELD_LIMITS.title),
    account: parseTextField(body.account, 'account', FIELD_LIMITS.account),
    amount: parseTextField(body.amount, 'amount', FIELD_LIMITS.amount),
    stage: parseStage(body.stage),
    tower: parseTextField(body.tower, 'tower', FIELD_LIMITS.tower),
    owner: parseTextField(body.owner, 'owner', FIELD_LIMITS.owner),
    due: parseTextField(body.due, 'due', FIELD_LIMITS.due),
    tags: JSON.stringify(body.tags === undefined ? [] : parseTags(body.tags)),
  };

  const nowIso = ctx.now().toISOString();
  const insert = ctx.db.prepare(
    `INSERT INTO opportunities
       (id, title, account, amount, stage, tower, owner, due, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        );
        insertCardEvent(ctx.db, {
          cardId: id,
          user,
          action: 'created',
          detail: {},
          createdAt: nowIso,
        });
        return id;
      });
      break;
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= 4) throw error;
    }
  }

  const row = ctx.db.prepare('SELECT * FROM opportunities WHERE id = ?').get(createdId);
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
  for (const field of EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const nextValue = normalizeFieldValue(field, body[field]);
    if (nextValue === existing[field]) continue;
    changes[field] = nextValue;
    changedFields.push(field);
  }

  // Nothing actually changed: return the row untouched and write no event.
  if (changedFields.length === 0) {
    sendJson(res, 200, { opportunity: mapOpportunity(existing), events: [] });
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
  });

  const updated = ctx.db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id);
  sendJson(res, 200, { opportunity: mapOpportunity(updated), events });
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
