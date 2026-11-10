import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { parseCookies, serializeCookie } from './http.js';

const scryptAsync = promisify(scrypt);

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SALT_BYTES = 16;
const MIN_ACCEPTED_N = 1024;
const MAX_ACCEPTED_N = 1048576;

export const SESSION_COOKIE_NAME = 'crm_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_MAX_AGE_SECONDS = 604800;
/** Sliding refresh granularity: at most one `expires_at` write per session per hour. */
export const SESSION_REFRESH_MS = 60 * 60 * 1000;

/** At least 8 characters, at most 200. Anything else is rejected before hashing. */
export function validatePassword(password) {
  if (typeof password !== 'string') return false;
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
}

/** Compares two strings without leaking the position of the first difference. */
export function timingSafeStringEquals(left, right) {
  const a = Buffer.from(typeof left === 'string' ? left : '', 'utf8');
  const b = Buffer.from(typeof right === 'string' ? right : '', 'utf8');
  if (a.length !== b.length) {
    // Still perform one comparison so a length mismatch is not measurably faster.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

function scryptKey(password, salt, keyLength, options) {
  return scryptAsync(password, salt, keyLength, options);
}

/**
 * Produces `scrypt$<N>$<saltHex>$<hashHex>`.
 * N=16384, r=8, p=1, 64-byte key, 16-byte random salt.
 */
export async function hashPassword(password) {
  if (typeof password !== 'string') {
    throw new TypeError('hashPassword requires a string password');
  }
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptKey(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * Verifies a password against a stored hash. Returns false for every malformed
 * input instead of throwing, so callers never turn a corrupt row into a 500.
 */
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;

  const parts = stored.split('$');
  if (parts.length !== 4) return false;
  if (parts[0] !== 'scrypt') return false;

  const cost = Number(parts[1]);
  if (!Number.isInteger(cost) || cost < MIN_ACCEPTED_N || cost > MAX_ACCEPTED_N) return false;

  const saltHex = parts[2];
  const hashHex = parts[3];
  if (saltHex.length === 0 || hashHex.length === 0) return false;
  if (saltHex.length % 2 !== 0 || hashHex.length % 2 !== 0) return false;
  if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) return false;

  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length === 0) return false;

  let actual;
  try {
    actual = await scryptKey(password, Buffer.from(saltHex, 'hex'), expected.length, {
      N: cost,
      r: SCRYPT_R,
      p: SCRYPT_P,
    });
  } catch {
    return false;
  }

  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

let dummyHashPromise;
function getDummyHash() {
  dummyHashPromise ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHashPromise;
}

/**
 * Login helper. When `stored` is missing (unknown email) a dummy scrypt run still
 * happens, so response time does not reveal whether the account exists.
 */
export async function verifyLoginPassword(password, stored) {
  if (typeof stored !== 'string' || stored.length === 0) {
    await verifyPassword(password, await getDummyHash());
    return false;
  }
  return verifyPassword(password, stored);
}

export function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function signSessionToken(token, secret) {
  return createHmac('sha256', secret).update(token).digest('base64url');
}

/** Cookie value is `<token>.<hmac>`, so a forged value is rejected before any DB lookup. */
export function formatSessionCookieValue(token, secret) {
  return `${token}.${signSessionToken(token, secret)}`;
}

/** Returns the token when the signature is valid, otherwise null. */
export function readSessionCookieValue(rawValue, secret) {
  if (typeof rawValue !== 'string' || !rawValue) return null;

  const separator = rawValue.lastIndexOf('.');
  if (separator <= 0 || separator === rawValue.length - 1) return null;

  const token = rawValue.slice(0, separator);
  const signature = rawValue.slice(separator + 1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;

  const expected = Buffer.from(signSessionToken(token, secret), 'utf8');
  const provided = Buffer.from(signature, 'utf8');
  if (expected.length !== provided.length) return null;
  return timingSafeEqual(expected, provided) ? token : null;
}

/** Reads and verifies the session cookie of a request. */
export function readSessionToken(req, secret) {
  const cookies = parseCookies(req.headers?.cookie);
  const rawValue = cookies[SESSION_COOKIE_NAME];
  if (!rawValue) return null;
  return readSessionCookieValue(rawValue, secret);
}

export function serializeSessionCookie(token, { secret, isProduction = false } = {}) {
  return serializeCookie(SESSION_COOKIE_NAME, formatSessionCookieValue(token, secret), {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: Boolean(isProduction),
  });
}

export function clearSessionCookie({ isProduction = false } = {}) {
  return serializeCookie(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 0,
    secure: Boolean(isProduction),
  });
}

export function createSession(db, userId, now = new Date()) {
  const token = createSessionToken();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(hashSessionToken(token), userId, createdAt, expiresAt);

  return { token, createdAt, expiresAt };
}

export function destroySession(db, token) {
  if (typeof token !== 'string' || !token) return false;
  const result = db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashSessionToken(token));
  return result.changes > 0;
}

/**
 * Resolves the authenticated user for a request, or null.
 * Expired rows for the presented token are deleted lazily, and a valid session is
 * extended at most once per hour (sliding expiry without write amplification).
 *
 * Returns `{ id, email, name, role }` — never the password hash.
 */
export function getSessionUser(req, { db, config }, now = new Date()) {
  const token = readSessionToken(req, config.sessionSecret);
  if (!token) return null;

  const tokenHash = hashSessionToken(token);
  const row = db
    .prepare(
      `SELECT s.expires_at, u.id, u.email, u.name, u.role
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    )
    .get(tokenHash);
  if (!row) return null;

  const nowMs = now.getTime();
  const expiresMs = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }

  const user = { id: row.id, email: row.email, name: row.name, role: row.role };

  if (expiresMs - nowMs <= SESSION_TTL_MS - SESSION_REFRESH_MS) {
    const nowIso = new Date(nowMs).toISOString();
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(
      new Date(nowMs + SESSION_TTL_MS).toISOString(),
      tokenHash,
    );
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso);
  }

  return user;
}

/**
 * In-memory, per-process login throttle: max `maxAttempts` failures per key inside
 * `windowMs`. It is intentionally NOT shared between processes — a multi-instance
 * deployment would need a shared store.
 */
export function createLoginThrottle({
  maxAttempts = 5,
  windowMs = 15 * 60 * 1000,
  now = () => Date.now(),
  maxEntries = 500,
} = {}) {
  /** @type {Map<string, { count: number, firstAt: number }>} */
  const buckets = new Map();

  function pruneExpired(nowMs) {
    for (const [key, bucket] of buckets) {
      if (nowMs - bucket.firstAt >= windowMs) buckets.delete(key);
    }
  }

  function activeBucket(key, nowMs) {
    const bucket = buckets.get(key);
    if (!bucket) return null;
    if (nowMs - bucket.firstAt >= windowMs) {
      buckets.delete(key);
      return null;
    }
    return bucket;
  }

  return {
    isBlocked(key, nowMs = now()) {
      const bucket = activeBucket(key, nowMs);
      return bucket ? bucket.count >= maxAttempts : false;
    },
    retryAfterSeconds(key, nowMs = now()) {
      const bucket = activeBucket(key, nowMs);
      if (!bucket) return 0;
      return Math.max(1, Math.ceil((bucket.firstAt + windowMs - nowMs) / 1000));
    },
    recordFailure(key, nowMs = now()) {
      const bucket = activeBucket(key, nowMs);
      if (bucket) {
        bucket.count += 1;
      } else {
        buckets.set(key, { count: 1, firstAt: nowMs });
      }
      if (buckets.size > maxEntries) pruneExpired(nowMs);
    },
    clear(key) {
      buckets.delete(key);
    },
    get size() {
      return buckets.size;
    },
  };
}
