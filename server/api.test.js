import assert from 'node:assert/strict';
import net from 'node:net';
import { after, before, describe, test } from 'node:test';
import { startTestServer } from './testing.js';

const OPPORTUNITY_PAYLOAD = {
  title: 'Modernización de la plataforma de datos',
  account: 'Grupo Albor',
  amount: '185.000 €',
  stage: 'prospecting',
  tower: 'Data',
  owner: 'Lucía Martín',
  due: '12 jun',
  tags: ['Cross-selling', 'Alta prioridad'],
};

/** Sends a request with a raw path so the test can bypass client-side URL normalization. */
function rawGet(port, requestPath) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(
        `GET ${requestPath} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
      );
    });

    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      data += chunk;
    });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
    socket.setTimeout(5000, () => socket.destroy(new Error('raw request timed out')));
  });
}

function statusOf(rawResponse) {
  return Number(rawResponse.split(' ')[1]);
}

describe('CRM API', () => {
  /** @type {Awaited<ReturnType<typeof startTestServer>>} */
  let app;
  /** @type {string} */
  let session;

  before(async () => {
    app = await startTestServer();
    const first = await app.register({
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      password: 'password123',
    });
    assert.equal(first.status, 201);
    session = first.cookie;
  });

  after(async () => {
    await app.cleanup();
  });

  test('GET /api/health is public and reports ok', async () => {
    const response = await app.json('GET', '/api/health');

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ok');
    assert.ok(!Number.isNaN(Date.parse(response.body.time)));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  });

  test('malformed and oversized JSON bodies are rejected with typed errors', async () => {
    const invalid = await fetch(`${app.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ this is not json',
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'invalid_json');

    const analysisBody = JSON.stringify({ email: 'a@example.com', password: 'p'.repeat(20000) });
    const oversized = await fetch(`${app.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: analysisBody,
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error.code, 'payload_too_large');
  });

  test('requests without a session are rejected with 401', async () => {
    const list = await app.json('GET', '/api/opportunities');
    assert.equal(list.status, 401);
    assert.equal(list.body.error.code, 'unauthorized');

    const me = await app.json('GET', '/api/me');
    assert.equal(me.status, 401);
    assert.equal(me.body.error.code, 'unauthorized');
  });

  test('registration rejects a wrong invite code', async () => {
    const response = await app.register({
      email: 'wrong-invite@example.com',
      inviteCode: 'not-the-invite-code',
    });

    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'invalid_invite_code');
    assert.match(response.body.error.message, /invitación/i);
  });

  test('the first registered user is an admin, every later one a member', async () => {
    const fresh = await startTestServer();
    try {
      const first = await fresh.json('POST', '/api/auth/register', {
        body: {
          email: 'owner@example.com',
          name: 'Owner One',
          password: 'password123',
          inviteCode: fresh.config.inviteCode,
        },
      });

      assert.equal(first.status, 201);
      assert.deepEqual(first.body.user, {
        id: first.body.user.id,
        email: 'owner@example.com',
        name: 'Owner One',
        role: 'admin',
      });
      assert.match(first.setCookie, /^crm_session=/);
      assert.match(first.setCookie, /; HttpOnly/);
      assert.match(first.setCookie, /; SameSite=Lax/);
      assert.doesNotMatch(first.setCookie, /; Secure/);

      const second = await fresh.json('POST', '/api/auth/register', {
        body: {
          email: 'member@example.com',
          name: 'Member Two',
          password: 'password123',
          inviteCode: fresh.config.inviteCode,
        },
      });

      assert.equal(second.status, 201);
      assert.equal(second.body.user.role, 'member');
    } finally {
      await fresh.cleanup();
    }
  });

  test('registration is closed when INVITE_CODE is not configured', async () => {
    const closed = await startTestServer({ inviteCode: '' });
    try {
      const response = await closed.register({ email: 'nobody@example.com' });

      assert.equal(response.status, 403);
      assert.equal(response.body.error.code, 'registration_disabled');
      assert.match(response.body.error.message, /registro está deshabilitado/i);
    } finally {
      await closed.cleanup();
    }
  });

  test('a duplicate email is rejected with 409 regardless of case', async () => {
    const response = await app.register({ email: 'ADA@example.com', name: 'Copy Cat' });

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'email_taken');
    assert.match(response.body.error.message, /Ya existe una cuenta/i);
  });

  test('registration validates the payload', async () => {
    const badEmail = await app.register({ email: 'not-an-email' });
    assert.equal(badEmail.status, 400);
    assert.equal(badEmail.body.error.code, 'validation_error');

    const badName = await app.register({ email: 'blank-name@example.com', name: '   ' });
    assert.equal(badName.status, 400);

    const shortPassword = await app.register({ email: 'short-password@example.com', password: 'short' });
    assert.equal(shortPassword.status, 400);
    assert.match(shortPassword.body.error.message, /al menos 8 caracteres/i);

    const hugePassword = await app.register({
      email: 'huge-password@example.com',
      password: 'a'.repeat(201),
    });
    assert.equal(hugePassword.status, 400);
    assert.match(hugePassword.body.error.message, /200 caracteres/i);
  });

  test('login failures do not reveal whether the email exists', async () => {
    const wrongPassword = await app.login({ email: 'owner@example.com', password: 'wrong-password' });
    const unknownEmail = await app.login({ email: 'ghost@example.com', password: 'wrong-password' });

    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownEmail.status, 401);
    assert.equal(wrongPassword.body.error.code, 'invalid_credentials');
    assert.equal(unknownEmail.body.error.code, 'invalid_credentials');
    assert.equal(wrongPassword.body.error.message, unknownEmail.body.error.message);
    assert.equal(wrongPassword.setCookie, null);
    assert.equal(unknownEmail.setCookie, null);
  });

  test('login sets an HttpOnly session cookie and /api/me returns the caller', async () => {
    const response = await app.login({ email: 'ada@example.com', password: 'password123' });

    assert.equal(response.status, 200);
    assert.match(response.setCookie, /^crm_session=/);
    assert.match(response.setCookie, /; HttpOnly/);
    assert.match(response.setCookie, /; SameSite=Lax/);
    assert.match(response.setCookie, /; Path=\//);
    assert.match(response.setCookie, /; Max-Age=604800/);
    assert.doesNotMatch(response.setCookie, /; Secure/);
    assert.deepEqual(response.body.user, {
      id: response.body.user.id,
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      role: 'admin',
    });

    const me = await app.json('GET', '/api/me', { cookie: response.cookie });
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.user, response.body.user);

    session = response.cookie;
  });

  test('a cookie with a forged signature is rejected', async () => {
    const response = await app.login({ email: 'ada@example.com', password: 'password123' });
    const [name, value] = response.cookie.split('=');
    const separator = value.lastIndexOf('.');
    const forged = `${value.slice(0, separator + 1)}${'A'.repeat(value.length - separator - 1)}`;

    const me = await app.json('GET', '/api/me', { cookie: `${name}=${forged}` });
    assert.equal(me.status, 401);
    assert.equal(me.body.error.code, 'unauthorized');
  });

  test('a mutating request with a foreign Origin is rejected', async () => {
    const response = await app.json('POST', '/api/opportunities', {
      body: OPPORTUNITY_PAYLOAD,
      cookie: session,
      origin: 'https://evil.example',
    });

    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'origin_mismatch');

    const sameOrigin = await app.json('POST', '/api/opportunities', {
      body: { ...OPPORTUNITY_PAYLOAD, title: 'Origen correcto' },
      cookie: session,
      origin: app.baseUrl,
    });
    assert.equal(sameOrigin.status, 201);
  });

  test('creating an opportunity stores the row and exactly one created event', async () => {
    const response = await app.json('POST', '/api/opportunities', {
      body: OPPORTUNITY_PAYLOAD,
      cookie: session,
    });

    assert.equal(response.status, 201);
    const opportunity = response.body.opportunity;
    assert.match(opportunity.id, /^O-\d{4}$/);
    assert.equal(opportunity.title, OPPORTUNITY_PAYLOAD.title);
    assert.equal(opportunity.stage, 'prospecting');
    assert.deepEqual(opportunity.tags, ['Cross-selling', 'Alta prioridad']);

    const events = await app.json('GET', `/api/opportunities/${opportunity.id}/events`, {
      cookie: session,
    });
    assert.equal(events.status, 200);
    assert.equal(events.body.events.length, 1);
    assert.equal(events.body.events[0].action, 'created');
    assert.equal(events.body.events[0].userName, 'Ada Lovelace');
    assert.deepEqual(events.body.events[0].detail, {});
  });

  test('creating an opportunity validates required fields and the stage', async () => {
    const missingTitle = await app.json('POST', '/api/opportunities', {
      body: { ...OPPORTUNITY_PAYLOAD, title: '' },
      cookie: session,
    });
    assert.equal(missingTitle.status, 400);
    assert.equal(missingTitle.body.error.code, 'validation_error');

    const badStage = await app.json('POST', '/api/opportunities', {
      body: { ...OPPORTUNITY_PAYLOAD, stage: 'archived' },
      cookie: session,
    });
    assert.equal(badStage.status, 400);
    assert.equal(badStage.body.error.code, 'validation_error');
    assert.match(badStage.body.error.message, /etapa/i);
  });

  test('created ids stay unique and fully padded to four digits', async () => {
    const first = await app.json('POST', '/api/opportunities', {
      body: { ...OPPORTUNITY_PAYLOAD, title: 'Idempotencia A' },
      cookie: session,
    });
    const second = await app.json('POST', '/api/opportunities', {
      body: { ...OPPORTUNITY_PAYLOAD, title: 'Idempotencia B' },
      cookie: session,
    });

    assert.notEqual(first.body.opportunity.id, second.body.opportunity.id);
    assert.match(first.body.opportunity.id, /^O-\d{4}$/);
    assert.match(second.body.opportunity.id, /^O-\d{4}$/);
  });

  test('PATCH with identical values writes no event', async () => {
    const created = await app.json('POST', '/api/opportunities', {
      body: { ...OPPORTUNITY_PAYLOAD, title: 'Sin cambios' },
      cookie: session,
    });
    const { id } = created.body.opportunity;

    const before = await app.json('GET', `/api/opportunities/${id}/events`, { cookie: session });
    const patch = await app.json('PATCH', `/api/opportunities/${id}`, {
      body: { ...OPPORTUNITY_PAYLOAD, title: 'Sin cambios' },
      cookie: session,
    });
    const after = await app.json('GET', `/api/opportunities/${id}/events`, { cookie: session });

    assert.equal(patch.status, 200);
    assert.deepEqual(patch.body.events, []);
    assert.equal(patch.body.opportunity.title, 'Sin cambios');
    assert.equal(after.body.events.length, before.body.events.length);
  });

  test('a stage change writes exactly one moved event', async () => {
    const created = await app.json('POST', '/api/opportunities', {
      body: { ...OPPORTUNITY_PAYLOAD, title: 'Cambio de etapa' },
      cookie: session,
    });
    const { id } = created.body.opportunity;

    const patch = await app.json('PATCH', `/api/opportunities/${id}`, {
      body: { stage: 'proposal' },
      cookie: session,
    });

    assert.equal(patch.status, 200);
    assert.equal(patch.body.opportunity.stage, 'proposal');
    assert.equal(patch.body.events.length, 1);
    assert.equal(patch.body.events[0].action, 'moved');
    assert.deepEqual(patch.body.events[0].detail, { from: 'prospecting', to: 'proposal' });
    assert.equal(patch.body.events[0].userName, 'Ada Lovelace');

    const events = await app.json('GET', `/api/opportunities/${id}/events`, { cookie: session });
    assert.equal(events.body.events.filter((event) => event.action === 'moved').length, 1);
  });

  test('a field change writes an updated event with field names only', async () => {
    const created = await app.json('POST', '/api/opportunities', {
      body: { ...OPPORTUNITY_PAYLOAD, title: 'Título original' },
      cookie: session,
    });
    const { id } = created.body.opportunity;

    const patch = await app.json('PATCH', `/api/opportunities/${id}`, {
      body: { title: 'Título renovado', amount: '200.000 €' },
      cookie: session,
    });

    assert.equal(patch.status, 200);
    assert.equal(patch.body.events.length, 1);
    assert.equal(patch.body.events[0].action, 'updated');
    assert.deepEqual(patch.body.events[0].detail, { fields: ['title', 'amount'] });
    const serialized = JSON.stringify(patch.body.events[0].detail);
    assert.ok(!serialized.includes('Título renovado'));
    assert.ok(!serialized.includes('200.000'));
  });

  test('a stage and field change in the same PATCH writes moved then updated', async () => {
    const created = await app.json('POST', '/api/opportunities', {
      body: { ...OPPORTUNITY_PAYLOAD, title: 'Doble cambio' },
      cookie: session,
    });
    const { id } = created.body.opportunity;

    const patch = await app.json('PATCH', `/api/opportunities/${id}`, {
      body: { stage: 'negotiation', title: 'Doble cambio aplicado' },
      cookie: session,
    });

    assert.equal(patch.status, 200);
    assert.equal(patch.body.events.length, 2);
    assert.equal(patch.body.events[0].action, 'moved');
    assert.deepEqual(patch.body.events[0].detail, { from: 'prospecting', to: 'negotiation' });
    assert.equal(patch.body.events[1].action, 'updated');
    assert.deepEqual(patch.body.events[1].detail, { fields: ['title'] });

    const stored = await app.json('GET', `/api/opportunities/${id}/events`, { cookie: session });
    // Newest first: the updated event has the higher id.
    assert.deepEqual(
      stored.body.events.map((event) => event.action),
      ['updated', 'moved', 'created'],
    );
  });

  test('PATCH on an unknown opportunity returns 404', async () => {
    const response = await app.json('PATCH', '/api/opportunities/O-0000', {
      body: { title: 'Fantasma' },
      cookie: session,
    });

    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'not_found');
  });

  test('the events endpoint clamps the limit and validates it', async () => {
    const created = await app.json('POST', '/api/opportunities', {
      body: { ...OPPORTUNITY_PAYLOAD, title: 'Historial largo' },
      cookie: session,
    });
    const { id } = created.body.opportunity;

    for (let index = 0; index < 5; index += 1) {
      await app.json('PATCH', `/api/opportunities/${id}`, {
        body: { title: `Historial largo ${index}` },
        cookie: session,
      });
    }

    const two = await app.json('GET', `/api/opportunities/${id}/events?limit=2`, { cookie: session });
    assert.equal(two.body.events.length, 2);

    const clampedLow = await app.json('GET', `/api/opportunities/${id}/events?limit=0`, {
      cookie: session,
    });
    assert.equal(clampedLow.body.events.length, 1);

    const clampedHigh = await app.json('GET', `/api/opportunities/${id}/events?limit=10000`, {
      cookie: session,
    });
    assert.equal(clampedHigh.body.events.length, 6);

    const invalid = await app.json('GET', `/api/opportunities/${id}/events?limit=abc`, {
      cookie: session,
    });
    assert.equal(invalid.status, 400);
  });

  test('events for an unknown opportunity return 404', async () => {
    const response = await app.json('GET', '/api/opportunities/O-0000/events', { cookie: session });

    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'not_found');
  });

  test('the opportunity list is ordered by created_at DESC, id DESC', async () => {
    const response = await app.json('GET', '/api/opportunities', { cookie: session });

    assert.equal(response.status, 200);
    const rows = response.body.opportunities;
    assert.ok(rows.length >= 29);
    assert.ok(Array.isArray(rows[0].tags));

    const ids = rows.map((row) => row.id);
    assert.equal(new Set(ids).size, ids.length, 'every row must be unique');

    for (let index = 1; index < rows.length; index += 1) {
      const previous = `${rows[index - 1].createdAt}|${rows[index - 1].id}`;
      const current = `${rows[index].createdAt}|${rows[index].id}`;
      assert.ok(previous >= current, `row ${index} breaks the newest-first order`);
    }
  });

  test('logout deletes the session and clears the cookie', async () => {
    const login = await app.login({ email: 'ada@example.com', password: 'password123' });
    assert.equal(login.status, 200);

    const logout = await app.json('POST', '/api/auth/logout', { cookie: login.cookie });
    assert.equal(logout.status, 204);
    assert.match(logout.setCookie, /^crm_session=;/);
    assert.match(logout.setCookie, /Max-Age=0/);

    const afterLogout = await app.json('GET', '/api/me', { cookie: login.cookie });
    assert.equal(afterLogout.status, 401);
  });

  test('five failed logins block the account+ip pair with 429', async () => {
    await app.json('POST', '/api/auth/register', {
      body: {
        email: 'throttled@example.com',
        name: 'Throttled User',
        password: 'password123',
        inviteCode: app.config.inviteCode,
      },
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failure = await app.login({ email: 'throttled@example.com', password: 'nope-nope' });
      assert.equal(failure.status, 401);
    }

    const blocked = await app.login({ email: 'throttled@example.com', password: 'password123' });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error.code, 'too_many_attempts');
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  });

  test('no response ever exposes password hashes or session tokens', async () => {
    const me = await app.json('GET', '/api/me', { cookie: session });
    const list = await app.json('GET', '/api/opportunities', { cookie: session });

    for (const payload of [me.body, list.body]) {
      const serialized = JSON.stringify(payload);
      assert.ok(!serialized.includes('password'));
      assert.ok(!serialized.includes('scrypt$'));
      assert.ok(!serialized.includes('token_hash'));
    }
  });

  test('the SPA shell is served with no-store and assets are immutable', async () => {
    const index = await fetch(`${app.baseUrl}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /text\/html/);
    assert.equal(index.headers.get('cache-control'), 'no-store');

    const asset = await fetch(`${app.baseUrl}/assets/app.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type'), /text\/javascript/);
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');

    const spaRoute = await fetch(`${app.baseUrl}/pipeline`);
    assert.equal(spaRoute.status, 200);
    assert.match(await spaRoute.text(), /CRM/);

    const missingAsset = await fetch(`${app.baseUrl}/assets/missing.js`);
    assert.equal(missingAsset.status, 404);
  });

  test('static path traversal is rejected', async () => {
    const attempts = [
      '/..%2f..%2fsecret.txt',
      '/assets/..%2f..%2f..%2fsecret.txt',
      '/%2e%2e%2f%2e%2e%2fsecret.txt',
    ];

    for (const attempt of attempts) {
      const response = await rawGet(app.port, attempt);
      assert.equal(statusOf(response), 403, `expected 403 for ${attempt}`);
      assert.ok(!response.includes('top-secret'), `leaked the file for ${attempt}`);
    }
  });

  test('API routes are not reachable through the SPA fallback', async () => {
    const response = await app.json('GET', '/api/does-not-exist');
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'not_found');
  });

  test('unsupported methods on a known route return 405 with an Allow header', async () => {
    const response = await app.json('DELETE', '/api/opportunities', { cookie: session });

    assert.equal(response.status, 405);
    assert.equal(response.body.error.code, 'method_not_allowed');
    assert.equal(response.headers.get('allow'), 'GET, POST');
  });
});

describe('registration throttle', () => {
  test('guessing the invite code is rate limited per client IP', async () => {
    const app = await startTestServer({ inviteCode: 'correct-code' });
    try {
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        const response = await app.register({
          email: `guess${attempt}@example.com`,
          inviteCode: `wrong-${attempt}`,
        });
        assert.equal(response.status, 403, `attempt ${attempt} should be rejected`);
        assert.equal(response.body.error.code, 'invalid_invite_code');
      }

      const blocked = await app.register({ email: 'guess11@example.com', inviteCode: 'wrong-11' });
      assert.equal(blocked.status, 429);
      assert.equal(blocked.body.error.code, 'too_many_attempts');
      assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    } finally {
      await app.cleanup();
    }
  });

  test('a successful registration clears the failure counter', async () => {
    const app = await startTestServer({ inviteCode: 'correct-code' });
    try {
      // Nine failures leave the bucket one attempt short of the block threshold.
      for (let attempt = 1; attempt <= 9; attempt += 1) {
        const rejected = await app.register({
          email: `typo${attempt}@example.com`,
          inviteCode: 'wrong',
        });
        assert.equal(rejected.status, 403);
      }

      const response = await app.register({ email: 'member@example.com', inviteCode: 'correct-code' });
      assert.equal(response.status, 201);
      assert.equal(response.body.user.role, 'admin');

      // Without the reset the very next failure would trip the limit.
      for (let attempt = 1; attempt <= 9; attempt += 1) {
        const rejected = await app.register({
          email: `again${attempt}@example.com`,
          inviteCode: 'wrong',
        });
        assert.equal(rejected.status, 403, `failure ${attempt} after the reset should not be throttled`);
      }
    } finally {
      await app.cleanup();
    }
  });
});
