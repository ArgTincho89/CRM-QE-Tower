import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  createLoginThrottle,
  createSession,
  destroySession,
  formatSessionCookieValue,
  getSessionUser,
  hashPassword,
  readSessionCookieValue,
  serializeSessionCookie,
  clearSessionCookie,
  validatePassword,
  verifyLoginPassword,
  verifyPassword,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
} from './auth.js';
import { createTempDatabase } from './testing.js';

const SECRET = 'unit-test-secret';

function cookieHeader(token) {
  return `${SESSION_COOKIE_NAME}=${formatSessionCookieValue(token, SECRET)}`;
}

function insertUser(db, { email = 'user@example.com', name = 'Unit User', role = 'member' } = {}) {
  const id = randomUUID();
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, email, name, 'scrypt$16384$00$00', role, new Date().toISOString());
  return id;
}

test('a password hash round-trips and rejects the wrong password', async () => {
  const stored = await hashPassword('correct horse battery staple');

  assert.match(stored, /^scrypt\$16384\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(await verifyPassword('correct horse battery staple', stored), true);
  assert.equal(await verifyPassword('correct horse battery stapl', stored), false);
  assert.equal(await verifyPassword('', stored), false);
});

test('two hashes of the same password differ because of the random salt', async () => {
  const first = await hashPassword('same-password');
  const second = await hashPassword('same-password');

  assert.notEqual(first, second);
  assert.equal(await verifyPassword('same-password', first), true);
  assert.equal(await verifyPassword('same-password', second), true);
});

test('malformed stored hashes return false instead of throwing', async () => {
  const malformed = [
    '',
    'not-a-hash',
    'scrypt$16384$abcd',
    'scrypt$16384$zz$zz',
    'scrypt$16384$abc$def',
    'scrypt$12$aa$bb',
    'scrypt$-1$aa$bb',
    'bcrypt$16384$aa$bb',
    null,
    undefined,
    42,
    {},
  ];

  for (const stored of malformed) {
    assert.equal(await verifyPassword('password123', stored), false, `stored=${String(stored)}`);
  }
});

test('login verification is slow-path equivalent for unknown accounts', async () => {
  const stored = await hashPassword('password123');

  assert.equal(await verifyLoginPassword('password123', stored), true);
  assert.equal(await verifyLoginPassword('password123', null), false);
  assert.equal(await verifyLoginPassword('password123', undefined), false);
});

test('the password policy requires 8 to 200 characters', () => {
  assert.equal(validatePassword('1234567'), false);
  assert.equal(validatePassword('12345678'), true);
  assert.equal(validatePassword('a'.repeat(200)), true);
  assert.equal(validatePassword('a'.repeat(201)), false);
  assert.equal(validatePassword(undefined), false);
  assert.equal(validatePassword(12345678), false);
});

test('a signed session cookie resolves the user', () => {
  const temp = createTempDatabase();
  try {
    const userId = insertUser(temp.db, { email: 'cookie@example.com', name: 'Cookie User', role: 'admin' });
    const { token } = createSession(temp.db, userId);
    const config = { sessionSecret: SECRET };

    assert.equal(readSessionCookieValue(formatSessionCookieValue(token, SECRET), SECRET), token);

    const user = getSessionUser({ headers: { cookie: cookieHeader(token) } }, { db: temp.db, config });
    assert.deepEqual(user, {
      id: userId,
      email: 'cookie@example.com',
      name: 'Cookie User',
      role: 'admin',
    });
  } finally {
    temp.cleanup();
  }
});

test('a tampered cookie is rejected before the database is consulted', () => {
  const temp = createTempDatabase();
  try {
    const userId = insertUser(temp.db);
    const { token } = createSession(temp.db, userId);
    const config = { sessionSecret: SECRET };
    const valid = formatSessionCookieValue(token, SECRET);

    // Flip one character of the HMAC.
    const separator = valid.lastIndexOf('.');
    const signature = valid.slice(separator + 1);
    const flipped = signature[0] === 'A' ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;
    const tamperedSignature = `${valid.slice(0, separator)}.${flipped}`;
    assert.equal(readSessionCookieValue(tamperedSignature, SECRET), null);
    assert.equal(
      getSessionUser({ headers: { cookie: `${SESSION_COOKIE_NAME}=${tamperedSignature}` } }, { db: temp.db, config }),
      null,
    );

    // Swap the token for a different, valid-looking token.
    const otherToken = formatSessionCookieValue('x'.repeat(43), SECRET);
    assert.notEqual(otherToken, valid);
    assert.equal(readSessionCookieValue(`${'y'.repeat(43)}${valid.slice(43)}`, SECRET), null);

    // A cookie signed with another secret is rejected too.
    const foreign = formatSessionCookieValue(token, 'another-secret');
    assert.equal(readSessionCookieValue(foreign, SECRET), null);

    // The session row still exists: rejection happened at the HMAC step.
    const row = temp.db
      .prepare('SELECT token_hash FROM sessions WHERE token_hash = ?')
      .get(createHash('sha256').update(token).digest('hex'));
    assert.ok(row);
  } finally {
    temp.cleanup();
  }
});

test('expired sessions are rejected and deleted lazily', () => {
  const temp = createTempDatabase();
  try {
    const userId = insertUser(temp.db);
    const token = 'a'.repeat(43);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    temp.db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, userId, '2020-01-01T00:00:00.000Z', '2020-01-08T00:00:00.000Z');

    const config = { sessionSecret: SECRET };
    const user = getSessionUser(
      { headers: { cookie: cookieHeader(token) } },
      { db: temp.db, config },
      new Date('2020-01-09T00:00:00.000Z'),
    );

    assert.equal(user, null);
    assert.equal(temp.db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
  } finally {
    temp.cleanup();
  }
});

test('the session expiry slides at most once per hour', () => {
  const temp = createTempDatabase();
  try {
    const userId = insertUser(temp.db);
    const startedAt = new Date('2026-01-01T00:00:00.000Z');
    const { token } = createSession(temp.db, userId, startedAt);
    const config = { sessionSecret: SECRET };
    const req = { headers: { cookie: cookieHeader(token) } };
    const expiry = () =>
      temp.db
        .prepare('SELECT expires_at FROM sessions WHERE token_hash = ?')
        .get(createHash('sha256').update(token).digest('hex')).expires_at;

    assert.equal(new Date(expiry()).getTime(), startedAt.getTime() + SESSION_TTL_MS);

    // 30 minutes later: still inside the quiet window, no write.
    getSessionUser(req, { db: temp.db, config }, new Date('2026-01-01T00:30:00.000Z'));
    assert.equal(new Date(expiry()).getTime(), startedAt.getTime() + SESSION_TTL_MS);

    // Two hours later: refreshed.
    getSessionUser(req, { db: temp.db, config }, new Date('2026-01-01T02:00:00.000Z'));
    assert.equal(expiry(), '2026-01-08T02:00:00.000Z');

    // One minute after the refresh: inside the quiet window again.
    getSessionUser(req, { db: temp.db, config }, new Date('2026-01-01T02:01:00.000Z'));
    assert.equal(expiry(), '2026-01-08T02:00:00.000Z');
  } finally {
    temp.cleanup();
  }
});

test('logout deletes the session row', () => {
  const temp = createTempDatabase();
  try {
    const userId = insertUser(temp.db);
    const { token } = createSession(temp.db, userId);

    assert.equal(destroySession(temp.db, token), true);
    assert.equal(temp.db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
    assert.equal(destroySession(temp.db, token), false);
  } finally {
    temp.cleanup();
  }
});

test('session cookies carry the required attributes', () => {
  const production = serializeSessionCookie('token', { secret: SECRET, isProduction: true });
  assert.match(production, /^crm_session=/);
  assert.match(production, /; Path=\//);
  assert.match(production, /; Max-Age=604800/);
  assert.match(production, /; SameSite=Lax/);
  assert.match(production, /; HttpOnly/);
  assert.match(production, /; Secure/);

  const development = serializeSessionCookie('token', { secret: SECRET, isProduction: false });
  assert.doesNotMatch(development, /; Secure/);

  const cleared = clearSessionCookie({ isProduction: false });
  assert.match(cleared, /^crm_session=;/);
  assert.match(cleared, /Max-Age=0/);
});

test('the login throttle blocks after five failures and recovers after the window', () => {
  let clock = 1_000_000;
  const throttle = createLoginThrottle({ now: () => clock });
  const key = '127.0.0.1|user@example.com';

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(throttle.isBlocked(key), false, `attempt ${attempt} must not be blocked`);
    throttle.recordFailure(key);
  }

  assert.equal(throttle.isBlocked(key), true);
  assert.equal(throttle.retryAfterSeconds(key), 900);

  clock += 900_000;
  assert.equal(throttle.isBlocked(key), false);
});

test('a successful login clears the throttle counter', () => {
  const throttle = createLoginThrottle();
  const key = '127.0.0.1|user@example.com';

  throttle.recordFailure(key);
  throttle.recordFailure(key);
  throttle.clear(key);

  assert.equal(throttle.isBlocked(key), false);
  assert.equal(throttle.retryAfterSeconds(key), 0);
});

test('throttle buckets are isolated per key', () => {
  const throttle = createLoginThrottle();

  for (let attempt = 0; attempt < 5; attempt += 1) throttle.recordFailure('ip-a|a@example.com');

  assert.equal(throttle.isBlocked('ip-a|a@example.com'), true);
  assert.equal(throttle.isBlocked('ip-b|a@example.com'), false);
  assert.equal(throttle.isBlocked('ip-a|b@example.com'), false);
});
