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

  test('GET /api/version is public and returns the package.json version', async () => {
    const { readFileSync } = await import('node:fs');
    const expected = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
    const response = await fetch(`${app.baseUrl}/api/version`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { version: expected });
    const post = await fetch(`${app.baseUrl}/api/version`, { method: 'POST', headers: { origin: app.baseUrl } });
    assert.equal(post.status, 405);
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

  test('members can list and update records created by the admin', async () => {
    const fresh = await startTestServer();
    try {
      const admin = await fresh.register({ email: 'shared-admin@example.com', name: 'Shared Admin' });
      const member = await fresh.register({ email: 'shared-member@example.com', name: 'Shared Member' });
      assert.equal(admin.status, 201);
      assert.equal(admin.body.user.role, 'admin');
      assert.equal(member.status, 201);
      assert.equal(member.body.user.role, 'member');

      const client = await fresh.json('POST', '/api/clients', {
        body: { name: 'Admin Client', sector: 'Technology' }, cookie: admin.cookie,
      });
      const firstPerson = await fresh.json('POST', '/api/people', {
        body: { name: 'Admin Responsible', email: 'admin-responsible@example.com' }, cookie: admin.cookie,
      });
      const secondPerson = await fresh.json('POST', '/api/people', {
        body: { name: 'Replacement Responsible', email: 'replacement@example.com' }, cookie: admin.cookie,
      });
      const tower = await fresh.json('POST', '/api/towers', {
        body: { name: 'Admin Tower', responsibleId: firstPerson.body.record.id }, cookie: admin.cookie,
      });
      const initiative = await fresh.json('POST', '/api/initiatives', {
        body: {
          title: 'Admin Initiative', clientId: client.body.record.id,
          towerId: tower.body.record.id, ownerId: firstPerson.body.record.id,
        },
        cookie: admin.cookie,
      });
      const opportunity = await fresh.json('POST', '/api/opportunities', {
        body: {
          ...OPPORTUNITY_PAYLOAD,
          title: 'Admin Opportunity',
          clientId: client.body.record.id,
          towerId: tower.body.record.id,
          ownerId: firstPerson.body.record.id,
        },
        cookie: admin.cookie,
      });
      for (const response of [client, firstPerson, secondPerson, tower, initiative, opportunity]) {
        assert.equal(response.status, 201);
      }

      const [clients, towers, people, initiatives, opportunities] = await Promise.all([
        fresh.json('GET', '/api/clients', { cookie: member.cookie }),
        fresh.json('GET', '/api/towers', { cookie: member.cookie }),
        fresh.json('GET', '/api/people', { cookie: member.cookie }),
        fresh.json('GET', '/api/initiatives', { cookie: member.cookie }),
        fresh.json('GET', '/api/opportunities', { cookie: member.cookie }),
      ]);
      for (const response of [clients, towers, people, initiatives, opportunities]) {
        assert.equal(response.status, 200);
      }
      assert.ok(clients.body.records.some((record) => record.id === client.body.record.id));
      assert.ok(towers.body.records.some((record) => record.id === tower.body.record.id));
      assert.ok(people.body.records.some((record) => record.id === firstPerson.body.record.id));
      assert.ok(initiatives.body.initiatives.some((record) => record.id === initiative.body.initiative.id));
      assert.ok(opportunities.body.opportunities.some((record) => record.id === opportunity.body.opportunity.id));

      const updatedClient = await fresh.json('PATCH', `/api/clients/${client.body.record.id}`, {
        body: { name: 'Member Client', sector: 'Finance' }, cookie: member.cookie,
      });
      const updatedTower = await fresh.json('PATCH', `/api/towers/${tower.body.record.id}`, {
        body: { name: 'Member Tower', responsibleId: secondPerson.body.record.id }, cookie: member.cookie,
      });
      const updatedPerson = await fresh.json('PATCH', `/api/people/${firstPerson.body.record.id}`, {
        body: { name: 'Member Responsible', email: 'member-responsible@example.com' }, cookie: member.cookie,
      });
      const updatedInitiative = await fresh.json('PATCH', `/api/initiatives/${initiative.body.initiative.id}`, {
        body: { title: 'Member Initiative' }, cookie: member.cookie,
      });
      const updatedOpportunity = await fresh.json('PATCH', `/api/opportunities/${opportunity.body.opportunity.id}`, {
        body: { title: 'Member Opportunity' }, cookie: member.cookie,
      });
      for (const response of [updatedClient, updatedTower, updatedPerson, updatedInitiative, updatedOpportunity]) {
        assert.equal(response.status, 200);
      }

      const [updatedClients, updatedTowers, updatedPeople, updatedInitiatives, updatedOpportunities] = await Promise.all([
        fresh.json('GET', '/api/clients', { cookie: member.cookie }),
        fresh.json('GET', '/api/towers', { cookie: member.cookie }),
        fresh.json('GET', '/api/people', { cookie: member.cookie }),
        fresh.json('GET', '/api/initiatives', { cookie: member.cookie }),
        fresh.json('GET', '/api/opportunities', { cookie: member.cookie }),
      ]);
      const savedClient = updatedClients.body.records.find((record) => record.id === client.body.record.id);
      assert.equal(savedClient.name, 'Member Client');
      assert.equal(savedClient.sector, 'Finance');
      const savedTower = updatedTowers.body.records.find((record) => record.id === tower.body.record.id);
      assert.equal(savedTower.name, 'Member Tower');
      assert.equal(savedTower.responsibleId, secondPerson.body.record.id);
      assert.equal(savedTower.responsibleName, 'Replacement Responsible');
      const savedPerson = updatedPeople.body.records.find((record) => record.id === firstPerson.body.record.id);
      assert.equal(savedPerson.name, 'Member Responsible');
      assert.equal(savedPerson.email, 'member-responsible@example.com');
      assert.equal(updatedInitiatives.body.initiatives.find((record) => record.id === initiative.body.initiative.id).title, 'Member Initiative');
      assert.equal(updatedOpportunities.body.opportunities.find((record) => record.id === opportunity.body.opportunity.id).title, 'Member Opportunity');
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
    assert.match(opportunity.id, /^OP-\d{4}$/);
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
    const removedStage = await app.json('POST', '/api/opportunities', {
      body: { ...OPPORTUNITY_PAYLOAD, stage: 'analysis' }, cookie: session,
    });
    assert.equal(removedStage.status, 400);
  });

  test('master records can be created, linked and deactivated without deleting references', async () => {
    const client = await app.json('POST', '/api/clients', { body: { name: 'Cliente maestro', sector: 'Tecnología' }, cookie: session });
    const person = await app.json('POST', '/api/people', { body: { name: 'Responsable QE', email: 'qe@example.com' }, cookie: session });
    const tower = await app.json('POST', '/api/towers', { body: { name: 'QE Platform', responsibleId: person.body.record.id }, cookie: session });
    assert.equal(client.status, 201);
    assert.equal(tower.status, 201);
    assert.equal(person.status, 201);

    const linked = await app.json('POST', '/api/opportunities', {
      body: { ...OPPORTUNITY_PAYLOAD, clientId: client.body.record.id, towerId: tower.body.record.id, ownerId: person.body.record.id, bidManagerId: person.body.record.id, number: 'EXT-123', qaPercent: 35 },
      cookie: session,
    });
    assert.equal(linked.status, 201);
    assert.equal(linked.body.opportunity.number, 'EXT-123');
    assert.equal(linked.body.opportunity.clientId, client.body.record.id);
    assert.equal(linked.body.opportunity.qaPercent, 35);

    const blockedTowerDelete = await app.json('DELETE', `/api/towers/${tower.body.record.id}`, { cookie: session });
    assert.equal(blockedTowerDelete.status, 409);
    assert.equal(blockedTowerDelete.body.error.code, 'tower_in_use');
    assert.match(blockedTowerDelete.body.error.message, /oportunidades o iniciativas/i);
    assert.ok(app.db.prepare('SELECT id FROM towers WHERE id = ?').get(tower.body.record.id));

    const deactivate = await app.json('DELETE', `/api/clients/${client.body.record.id}`, { cookie: session });
    assert.equal(deactivate.status, 200);
    assert.equal(deactivate.body.record.active, false);
    const stillLinked = await app.json('GET', '/api/opportunities', { cookie: session });
    assert.equal(stillLinked.body.opportunities.find((item) => item.id === linked.body.opportunity.id).clientId, client.body.record.id);
    const inactiveLink = await app.json('POST', '/api/opportunities', {
      body: { ...OPPORTUNITY_PAYLOAD, clientId: client.body.record.id }, cookie: session,
    });
    assert.equal(inactiveLink.status, 400);
  });

  test('towers require and can change a responsible, hide lifecycle status, and delete only when unreferenced', async () => {
    const firstPerson = await app.json('POST', '/api/people', { body: { name: 'Tower Owner One' }, cookie: session });
    const secondPerson = await app.json('POST', '/api/people', { body: { name: 'Tower Owner Two' }, cookie: session });
    const missingResponsible = await app.json('POST', '/api/towers', { body: { name: 'Tower sin responsable' }, cookie: session });
    assert.equal(missingResponsible.status, 400);
    assert.equal(missingResponsible.body.error.code, 'validation_error');

    const created = await app.json('POST', '/api/towers', { body: { name: 'Tower administrable', responsibleId: firstPerson.body.record.id }, cookie: session });
    assert.equal(created.status, 201);
    assert.equal(created.body.record.responsibleId, firstPerson.body.record.id);
    assert.equal(created.body.record.responsibleName, 'Tower Owner One');
    assert.equal(Object.hasOwn(created.body.record, 'active'), false);

    const changed = await app.json('PATCH', `/api/towers/${created.body.record.id}`, { body: { responsibleId: secondPerson.body.record.id }, cookie: session });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.record.responsibleId, secondPerson.body.record.id);
    assert.equal(changed.body.record.responsibleName, 'Tower Owner Two');

    const lifecycleChange = await app.json('PATCH', `/api/towers/${created.body.record.id}`, { body: { active: false }, cookie: session });
    assert.equal(lifecycleChange.status, 400);
    assert.match(lifecycleChange.body.error.message, /no tienen estado activo o inactivo/i);

    const deleted = await app.json('DELETE', `/api/towers/${created.body.record.id}`, { cookie: session });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.deleted, true);
    assert.equal(app.db.prepare('SELECT id FROM towers WHERE id = ?').get(created.body.record.id), undefined);

    const legacyInactive = await app.json('POST', '/api/towers', { body: { name: 'Tower legacy inactiva', responsibleId: firstPerson.body.record.id }, cookie: session });
    app.db.prepare("UPDATE towers SET status = 'inactive' WHERE id = ?").run(legacyInactive.body.record.id);
    const listedTowers = await app.json('GET', '/api/towers', { cookie: session });
    const inactiveRecord = listedTowers.body.records.find((tower) => tower.id === legacyInactive.body.record.id);
    assert.equal(Object.hasOwn(inactiveRecord, 'active'), false);
    const linkedLegacyTower = await app.json('POST', '/api/opportunities', { body: { ...OPPORTUNITY_PAYLOAD, towerId: legacyInactive.body.record.id }, cookie: session });
    assert.equal(linkedLegacyTower.status, 201);
    const blockedLegacyDelete = await app.json('DELETE', `/api/towers/${legacyInactive.body.record.id}`, { cookie: session });
    assert.equal(blockedLegacyDelete.status, 409);

    const initiativeTower = await app.json('POST', '/api/towers', { body: { name: 'Tower ya no vinculada a iniciativa', responsibleId: firstPerson.body.record.id }, cookie: session });
    const initiative = await app.json('POST', '/api/initiatives', { body: { title: 'Iniciativa sin tower', towerId: initiativeTower.body.record.id }, cookie: session });
    assert.equal(initiative.status, 201);
    assert.equal(initiative.body.initiative.towerId, '');
    const noLongerBlocked = await app.json('DELETE', `/api/towers/${initiativeTower.body.record.id}`, { cookie: session });
    assert.equal(noLongerBlocked.status, 200);
  });

  test('services and LoB catalogs expose shared CRUD, unique names, and deactivation guards', async () => {
    const services = await app.json('GET', '/api/services', { cookie: session });
    assert.equal(services.status, 200);
    assert.equal(services.body.records.length, 9);
    assert.ok(services.body.records.some((service) => service.name === 'QA Automation' && service.active));

    const createdService = await app.json('POST', '/api/services', { body: { name: 'Service Discovery', description: 'Exploración inicial' }, cookie: session });
    assert.equal(createdService.status, 201);
    assert.equal(createdService.body.record.description, 'Exploración inicial');
    const duplicateService = await app.json('POST', '/api/services', { body: { name: 'service discovery' }, cookie: session });
    assert.equal(duplicateService.status, 409);
    assert.equal(duplicateService.body.error.code, 'duplicate_record');
    const deactivatedService = await app.json('DELETE', `/api/services/${createdService.body.record.id}`, { cookie: session });
    assert.equal(deactivatedService.status, 200);
    assert.equal(deactivatedService.body.record.active, false);
    const reactivatedService = await app.json('PATCH', `/api/services/${createdService.body.record.id}`, { body: { active: true }, cookie: session });
    assert.equal(reactivatedService.body.record.active, true);

    const lob = await app.json('POST', '/api/lobs', { body: { name: 'Quality Engineering', description: 'LoB de QE' }, cookie: session });
    assert.equal(lob.status, 201);
    assert.equal(lob.body.record.active, true);
    const duplicateLob = await app.json('POST', '/api/lobs', { body: { name: 'quality engineering' }, cookie: session });
    assert.equal(duplicateLob.status, 409);

    const person = await app.json('POST', '/api/people', { body: { name: 'LoB Tower Owner' }, cookie: session });
    const tower = await app.json('POST', '/api/towers', { body: { name: 'Tower con LoB', responsibleId: person.body.record.id, lobId: lob.body.record.id }, cookie: session });
    assert.equal(tower.status, 201);
    assert.equal(tower.body.record.lobId, lob.body.record.id);
    assert.equal(tower.body.record.lobName, 'Quality Engineering');

    const blockedLobDeactivation = await app.json('PATCH', `/api/lobs/${lob.body.record.id}`, { body: { active: false }, cookie: session });
    assert.equal(blockedLobDeactivation.status, 409);
    assert.equal(blockedLobDeactivation.body.error.code, 'lob_in_use');
    const blockedLobDelete = await app.json('DELETE', `/api/lobs/${lob.body.record.id}`, { cookie: session });
    assert.equal(blockedLobDelete.status, 409);

    const clearedTower = await app.json('PATCH', `/api/towers/${tower.body.record.id}`, { body: { lobId: '' }, cookie: session });
    assert.equal(clearedTower.status, 200);
    assert.equal(clearedTower.body.record.lobId, '');
    const deactivatedLob = await app.json('DELETE', `/api/lobs/${lob.body.record.id}`, { cookie: session });
    assert.equal(deactivatedLob.status, 200);
    assert.equal(deactivatedLob.body.record.active, false);
    const listedLobs = await app.json('GET', '/api/lobs', { cookie: session });
    assert.equal(listedLobs.body.records.find((item) => item.id === lob.body.record.id).active, false);
  });

  test('opportunity display fields use linked master names and retain legacy fallbacks', async () => {
    const client = await app.json('POST', '/api/clients', { body: { name: 'Cliente vinculado' }, cookie: session });
    const owner = await app.json('POST', '/api/people', { body: { name: 'Responsable vinculado' }, cookie: session });
    const replacementClient = await app.json('POST', '/api/clients', { body: { name: 'Cliente actualizado' }, cookie: session });
    const replacementOwner = await app.json('POST', '/api/people', { body: { name: 'Responsable actualizado' }, cookie: session });
    const tower = await app.json('POST', '/api/towers', { body: { name: 'Tower vinculada', responsibleId: owner.body.record.id }, cookie: session });
    const replacementTower = await app.json('POST', '/api/towers', { body: { name: 'Tower actualizada', responsibleId: replacementOwner.body.record.id }, cookie: session });

    const linked = await app.json('POST', '/api/opportunities', {
      body: { ...OPPORTUNITY_PAYLOAD, account: '', tower: '', owner: '', clientId: client.body.record.id, towerId: tower.body.record.id, ownerId: owner.body.record.id },
      cookie: session,
    });
    assert.equal(linked.status, 201);
    assert.deepEqual({ ...app.db.prepare('SELECT account, tower, owner FROM opportunities WHERE id = ?').get(linked.body.opportunity.id) }, { account: '', tower: '', owner: '' });
    assert.equal(linked.body.opportunity.account, 'Cliente vinculado');
    assert.equal(linked.body.opportunity.tower, 'Tower vinculada');
    assert.equal(linked.body.opportunity.owner, 'Responsable vinculado');

    const updated = await app.json('PATCH', `/api/opportunities/${linked.body.opportunity.id}`, {
      body: { clientId: replacementClient.body.record.id, towerId: replacementTower.body.record.id, ownerId: replacementOwner.body.record.id },
      cookie: session,
    });
    assert.equal(updated.body.opportunity.account, 'Cliente actualizado');
    assert.equal(updated.body.opportunity.tower, 'Tower actualizada');
    assert.equal(updated.body.opportunity.owner, 'Responsable actualizado');

    const listed = await app.json('GET', '/api/opportunities', { cookie: session });
    const row = listed.body.opportunities.find((item) => item.id === linked.body.opportunity.id);
    assert.equal(row.account, 'Cliente actualizado');
    assert.equal(row.tower, 'Tower actualizada');
    assert.equal(row.owner, 'Responsable actualizado');

    const legacy = await app.json('POST', '/api/opportunities', { body: OPPORTUNITY_PAYLOAD, cookie: session });
    assert.equal(legacy.body.opportunity.account, OPPORTUNITY_PAYLOAD.account);
    assert.equal(legacy.body.opportunity.tower, OPPORTUNITY_PAYLOAD.tower);
    assert.equal(legacy.body.opportunity.owner, OPPORTUNITY_PAYLOAD.owner);
  });

  test('opportunities persist multi-value relations, commercial fields, and weighted amounts', async () => {
    const firstOwner = await app.json('POST', '/api/people', { body: { name: 'Tower Owner Multi One' }, cookie: session });
    const secondOwner = await app.json('POST', '/api/people', { body: { name: 'Tower Owner Multi Two' }, cookie: session });
    const towerA = await app.json('POST', '/api/towers', { body: { name: 'Tower multi A', responsibleId: firstOwner.body.record.id }, cookie: session });
    const towerB = await app.json('POST', '/api/towers', { body: { name: 'Tower multi B', responsibleId: secondOwner.body.record.id }, cookie: session });
    const lobA = await app.json('POST', '/api/lobs', { body: { name: 'LoB multi A' }, cookie: session });
    const lobB = await app.json('POST', '/api/lobs', { body: { name: 'LoB multi B' }, cookie: session });
    const services = await app.json('GET', '/api/services', { cookie: session });
    const serviceA = services.body.records.find((item) => item.name === 'QA Automation');
    const serviceB = services.body.records.find((item) => item.name === 'API Testing');

    const created = await app.json('POST', '/api/opportunities', {
      body: {
        title: 'Oportunidad multi',
        account: 'Cliente multi',
        amount: '10000',
        stage: 'contacted',
        towerIds: [towerA.body.record.id, towerB.body.record.id, towerA.body.record.id],
        lobIds: [lobA.body.record.id, lobB.body.record.id],
        serviceIds: [serviceA.id, serviceB.id],
        probability: 40,
        expectedCloseDate: '2026-12-31',
        nextMilestone: 'Enviar propuesta',
        nextMilestoneDate: '2026-11-30',
        need: 'Cubrir QA del core',
        origin: 'Prospección directa',
        qaPercent: 50,
        pep: 'PEP-42',
        links: [
          { title: 'Enlace Workspace 1', url: 'https://workspaces.example/one' },
          { title: 'Enlace Workspace 2', url: 'https://workspaces.example/two' },
        ],
      },
      cookie: session,
    });
    assert.equal(created.status, 201);
    const opportunity = created.body.opportunity;
    assert.equal(opportunity.stage, 'contacted');
    assert.equal(opportunity.origin, 'Prospección directa');
    assert.equal(opportunity.probability, 40);
    assert.deepEqual(opportunity.towers.map((item) => item.id).sort(), [towerA.body.record.id, towerB.body.record.id].sort());
    assert.deepEqual(opportunity.lobs.map((item) => item.id).sort(), [lobA.body.record.id, lobB.body.record.id].sort());
    assert.equal(opportunity.services.length, 2);
    assert.equal(opportunity.links.length, 2);
    assert.equal(opportunity.weightedAmount, 4000);
    assert.equal(opportunity.qaWeightedAmount, 5000);
    assert.equal(opportunity.expectedCloseDate, '2026-12-31');
    assert.equal(opportunity.nextMilestone, 'Enviar propuesta');
    assert.equal(opportunity.pep, 'PEP-42');
    assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM opportunity_towers WHERE opportunity_id = ?').get(opportunity.id).count, 2);

    const withoutProbability = await app.json('POST', '/api/opportunities', {
      body: { ...OPPORTUNITY_PAYLOAD, title: 'Sin probabilidad', amount: '1000' },
      cookie: session,
    });
    assert.equal(withoutProbability.body.opportunity.probability, null);
    assert.equal(withoutProbability.body.opportunity.weightedAmount, null);
    assert.deepEqual(withoutProbability.body.opportunity.lobs, []);

    const updated = await app.json('PATCH', `/api/opportunities/${opportunity.id}`, {
      body: { towerIds: [towerB.body.record.id], lobIds: [lobA.body.record.id], serviceIds: [serviceA.id], links: [{ title: 'Solo uno', url: 'https://workspaces.example/one' }] },
      cookie: session,
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body.opportunity.towers.map((item) => item.id), [towerB.body.record.id]);
    assert.deepEqual(updated.body.opportunity.lobs.map((item) => item.id), [lobA.body.record.id]);
    assert.equal(updated.body.opportunity.services.length, 1);
    assert.equal(updated.body.opportunity.links.length, 1);
  });

  test('opportunity origin, outcome, close date, loss reason, and archived edits are validated', async () => {
    const badOrigin = await app.json('POST', '/api/opportunities', { body: { ...OPPORTUNITY_PAYLOAD, origin: 'Inventado' }, cookie: session });
    assert.equal(badOrigin.status, 400);
    const badProbability = await app.json('POST', '/api/opportunities', { body: { ...OPPORTUNITY_PAYLOAD, probability: 140 }, cookie: session });
    assert.equal(badProbability.status, 400);
    const badLink = await app.json('POST', '/api/opportunities', { body: { ...OPPORTUNITY_PAYLOAD, links: [{ title: 'Malo', url: 'ftp://example.com' }] }, cookie: session });
    assert.equal(badLink.status, 400);

    const resultWithoutOutcome = await app.json('POST', '/api/opportunities', { body: { ...OPPORTUNITY_PAYLOAD, stage: 'result' }, cookie: session });
    assert.equal(resultWithoutOutcome.status, 400);
    const resultWithoutDate = await app.json('POST', '/api/opportunities', { body: { ...OPPORTUNITY_PAYLOAD, stage: 'result', outcome: 'won' }, cookie: session });
    assert.equal(resultWithoutDate.status, 400);
    const lostWithoutReason = await app.json('POST', '/api/opportunities', {
      body: { ...OPPORTUNITY_PAYLOAD, stage: 'result', outcome: 'lost', expectedCloseDate: '2026-12-01' },
      cookie: session,
    });
    assert.equal(lostWithoutReason.status, 400);
    const outcomeOutsideResult = await app.json('POST', '/api/opportunities', { body: { ...OPPORTUNITY_PAYLOAD, outcome: 'won' }, cookie: session });
    assert.equal(outcomeOutsideResult.status, 400);

    const won = await app.json('POST', '/api/opportunities', {
      body: { ...OPPORTUNITY_PAYLOAD, stage: 'result', outcome: 'won', expectedCloseDate: '2026-12-01', pep: 'PEP-1' },
      cookie: session,
    });
    assert.equal(won.status, 201);
    assert.equal(won.body.opportunity.outcome, 'won');
    const movedBack = await app.json('PATCH', `/api/opportunities/${won.body.opportunity.id}`, { body: { stage: 'proposal' }, cookie: session });
    assert.equal(movedBack.status, 200);
    assert.equal(movedBack.body.opportunity.outcome, '');
    assert.equal(movedBack.body.opportunity.pep, 'PEP-1');

    const archived = await app.json('POST', `/api/opportunities/${won.body.opportunity.id}/archive`, { cookie: session });
    assert.equal(archived.status, 200);
    assert.ok(archived.body.opportunity.archivedAt);
    const blockedEdit = await app.json('PATCH', `/api/opportunities/${won.body.opportunity.id}`, { body: { title: 'No permitido' }, cookie: session });
    assert.equal(blockedEdit.status, 409);
    assert.equal(blockedEdit.body.error.code, 'record_archived');
  });

  test('archiving hides opportunities from the active board and restore preserves data', async () => {
    const created = await app.json('POST', '/api/opportunities', {
      body: { ...OPPORTUNITY_PAYLOAD, title: 'Archivable', links: [{ title: 'Doc', url: 'https://example.com/doc' }] },
      cookie: session,
    });
    assert.equal(created.status, 201);
    const id = created.body.opportunity.id;
    const archived = await app.json('POST', `/api/opportunities/${id}/archive`, { cookie: session });
    assert.equal(archived.status, 200);
    assert.equal(archived.body.opportunity.links.length, 1);
    const active = await app.json('GET', '/api/opportunities', { cookie: session });
    assert.equal(active.body.opportunities.some((item) => item.id === id), false);
    const archivedList = await app.json('GET', '/api/opportunities?archived=1', { cookie: session });
    const archivedRow = archivedList.body.opportunities.find((item) => item.id === id);
    assert.ok(archivedRow);
    assert.equal(archivedRow.archivedByName, 'Ada Lovelace');
    const restored = await app.json('POST', `/api/opportunities/${id}/restore`, { cookie: session });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.opportunity.archivedAt, '');
    assert.equal(restored.body.opportunity.links.length, 1);
    const activeAgain = await app.json('GET', '/api/opportunities', { cookie: session });
    assert.equal(activeAgain.body.opportunities.some((item) => item.id === id), true);
  });

  test('opportunities link to an initiative without coupling lifecycles and default the origin', async () => {
    const client = await app.json('POST', '/api/clients', { body: { name: 'Cliente iniciativa origen' }, cookie: session });
    const initiative = await app.json('POST', '/api/initiatives', { body: { title: 'Iniciativa origen', clientId: client.body.record.id }, cookie: session });
    assert.equal(initiative.status, 201);
    const derived = await app.json('POST', '/api/opportunities', {
      body: { ...OPPORTUNITY_PAYLOAD, title: 'Derivada', account: '', clientId: client.body.record.id, initiativeId: initiative.body.initiative.id },
      cookie: session,
    });
    assert.equal(derived.status, 201);
    assert.equal(derived.body.opportunity.origin, 'Iniciativa interna');
    assert.equal(derived.body.opportunity.initiativeId, initiative.body.initiative.id);
    assert.equal(derived.body.opportunity.initiativeTitle, 'Iniciativa origen');
    const editable = await app.json('PATCH', `/api/opportunities/${derived.body.opportunity.id}`, { body: { origin: 'Cliente existente' }, cookie: session });
    assert.equal(editable.body.opportunity.origin, 'Cliente existente');
    const missingInitiative = await app.json('POST', '/api/opportunities', { body: { ...OPPORTUNITY_PAYLOAD, initiativeId: 'IN-9999' }, cookie: session });
    assert.equal(missingInitiative.status, 400);
  });

  test('inactive services cannot be newly assigned but stay on historical links', async () => {
    const services = await app.json('GET', '/api/services', { cookie: session });
    const service = services.body.records.find((item) => item.name === 'Accessibility Testing');
    const created = await app.json('POST', '/api/opportunities', { body: { ...OPPORTUNITY_PAYLOAD, serviceIds: [service.id] }, cookie: session });
    assert.equal(created.status, 201);
    await app.json('DELETE', `/api/services/${service.id}`, { cookie: session });
    const blocked = await app.json('POST', '/api/opportunities', { body: { ...OPPORTUNITY_PAYLOAD, serviceIds: [service.id] }, cookie: session });
    assert.equal(blocked.status, 400);
    const listed = await app.json('GET', '/api/opportunities', { cookie: session });
    const row = listed.body.opportunities.find((item) => item.id === created.body.opportunity.id);
    assert.equal(row.services.length, 1);
    assert.equal(row.services[0].status, 'inactive');
    await app.json('PATCH', `/api/services/${service.id}`, { body: { active: true }, cookie: session });
  });

  test('initiative and framework agreement records persist, with notes and action completion', async () => {
    const client = await app.json('POST', '/api/clients', { body: { name: 'Cliente iniciativa' }, cookie: session });
    const created = await app.json('POST', '/api/initiatives', {
      body: { title: 'Explorar servicio QE', category: 'Cross-selling', clientId: client.body.record.id },
      cookie: session,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.initiative.category, 'Cross-selling');
    assert.equal(created.body.initiative.clientName, 'Cliente iniciativa');
    assert.equal(created.body.initiative.stage, 'pending');
    const list = await app.json('GET', '/api/initiatives', { cookie: session });
    assert.equal(list.body.initiatives.some((item) => item.id === created.body.initiative.id), true);
    const initialEvents = await app.json('GET', `/api/initiatives/${created.body.initiative.id}/events`, { cookie: session });
    assert.equal(initialEvents.body.events[0].userName, 'Ada Lovelace');
    assert.equal(initialEvents.body.events[0].action, 'created');

    const note = await app.json('POST', `/api/initiatives/${created.body.initiative.id}/actions`, { body: { text: 'Alinear alcance', kind: 'note' }, cookie: session });
    const action = await app.json('POST', `/api/initiatives/${created.body.initiative.id}/actions`, { body: { text: 'Preparar reunión' }, cookie: session });
    assert.equal(note.body.action.kind, 'note');
    assert.equal(note.body.action.status, 'note');
    assert.equal(action.body.action.status, 'pending');
    assert.deepEqual(action.body.action.comments, []);
    const comment = await app.json('POST', `/api/actions/${action.body.action.id}/comments`, { body: { text: 'Confirmar disponibilidad' }, cookie: session });
    assert.equal(comment.status, 201);
    assert.equal(comment.body.comment.text, 'Confirmar disponibilidad');
    assert.equal(comment.body.comment.userName, 'Ada Lovelace');
    assert.ok(Number.isFinite(Date.parse(comment.body.comment.createdAt)));
    assert.equal((await app.json('POST', `/api/actions/${action.body.action.id}/comments`, { body: { text: 'Unauthorized' } })).status, 401);
    assert.equal((await app.json('POST', `/api/actions/${note.body.action.id}/comments`, { body: { text: 'No corresponde' }, cookie: session })).status, 404);
    for (const text of ['', '   ', 'x'.repeat(501)]) {
      const invalidComment = await app.json('POST', `/api/actions/${action.body.action.id}/comments`, { body: { text }, cookie: session });
      assert.equal(invalidComment.status, 400);
      assert.equal(invalidComment.body.error.code, 'validation_error');
    }
    const completed = await app.json('PATCH', `/api/actions/${action.body.action.id}`, { body: { status: 'completed' }, cookie: session });
    assert.equal(completed.body.action.status, 'completed');
    const actions = await app.json('GET', `/api/initiatives/${created.body.initiative.id}/actions`, { cookie: session });
    assert.equal(actions.body.actions.length, 2);
    assert.equal(actions.body.actions.find((item) => item.id === action.body.action.id).userName, 'Ada Lovelace');
    assert.equal(actions.body.actions.find((item) => item.id === action.body.action.id).status, 'completed');
    assert.equal(actions.body.actions.find((item) => item.id === note.body.action.id).text, 'Alinear alcance');
    assert.deepEqual(actions.body.actions.find((item) => item.id === action.body.action.id).comments, [comment.body.comment]);
    assert.deepEqual(actions.body.actions.find((item) => item.id === note.body.action.id).comments, []);
    const reopened = await app.json('PATCH', `/api/actions/${action.body.action.id}`, { body: { status: 'pending' }, cookie: session });
    assert.equal(reopened.body.action.status, 'pending');
    assert.equal(reopened.body.action.completedAt, null);
    const audit = await app.json('GET', `/api/initiatives/${created.body.initiative.id}/events`, { cookie: session });
    assert.ok(audit.body.events.some((event) => event.action === 'action_added'));
    assert.ok(audit.body.events.some((event) => event.action === 'action_completed'));
    assert.ok(audit.body.events.some((event) => event.action === 'action_reopened'));
    assert.ok(audit.body.events.some((event) => event.action === 'action_comment_added' && event.detail.commentId === comment.body.comment.id));

    app.db.exec(`CREATE TRIGGER reject_action_comment_event BEFORE INSERT ON entity_events
      WHEN NEW.action = 'action_comment_added' BEGIN SELECT RAISE(ABORT, 'rejected'); END`);
    try {
      const failedComment = await app.json('POST', `/api/actions/${action.body.action.id}/comments`, { body: { text: 'Must roll back' }, cookie: session });
      assert.equal(failedComment.status, 500);
      assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM record_action_comments WHERE action_id = ?').get(action.body.action.id).count, 1);
    } finally {
      app.db.exec('DROP TRIGGER reject_action_comment_event');
    }

    const agreement = await app.json('POST', '/api/agreements', { body: { title: 'Acuerdo de soporte', clientId: client.body.record.id }, cookie: session });
    assert.equal(agreement.status, 201);
    const agreements = await app.json('GET', '/api/agreements', { cookie: session });
    assert.equal(agreements.body.agreements.some((item) => item.id === agreement.body.agreement.id), true);
  });

  test('initiatives follow the four-stage lifecycle, fixed categories, priority, status, and services', async () => {
    const client = await app.json('POST', '/api/clients', { body: { name: 'Cliente ciclo iniciativa' }, cookie: session });
    const services = await app.json('GET', '/api/services', { cookie: session });
    const serviceA = services.body.records.find((item) => item.name === 'QA Automation');
    const serviceB = services.body.records.find((item) => item.name === 'QA Consulting');

    const created = await app.json('POST', '/api/initiatives', {
      body: {
        title: 'Iniciativa comercial',
        category: 'Desarrollo de negocio en cliente existente',
        clientId: client.body.record.id,
        priority: 'Alta',
        nextAction: 'Agendar reunión',
        nextActionDate: '2026-12-15',
        description: 'Ampliar alcance de QA',
        operationalStatus: 'active',
        serviceIds: [serviceA.id, serviceB.id, serviceA.id],
        links: [{ title: 'Enlace Workspace', url: 'https://workspaces.example/initiative' }],
      },
      cookie: session,
    });
    assert.equal(created.status, 201);
    const initiative = created.body.initiative;
    assert.equal(initiative.stage, 'pending');
    assert.equal(initiative.category, 'Desarrollo de negocio en cliente existente');
    assert.equal(initiative.priority, 'Alta');
    assert.equal(initiative.nextAction, 'Agendar reunión');
    assert.equal(initiative.nextActionDate, '2026-12-15');
    assert.equal(initiative.description, 'Ampliar alcance de QA');
    assert.equal(initiative.operationalStatus, 'active');
    assert.deepEqual(initiative.services.map((item) => item.id).sort(), [serviceA.id, serviceB.id].sort());
    assert.equal(initiative.links.length, 1);
    assert.equal(initiative.archivedAt, '');
    assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM initiative_services WHERE initiative_id = ?').get(initiative.id).count, 2);

    for (const stage of ['in_progress', 'following', 'completed', 'pending']) {
      const moved = await app.json('PATCH', `/api/initiatives/${initiative.id}`, { body: { stage }, cookie: session });
      assert.equal(moved.status, 200);
      assert.equal(moved.body.initiative.stage, stage);
    }

    const paused = await app.json('PATCH', `/api/initiatives/${initiative.id}`, { body: { operationalStatus: 'paused' }, cookie: session });
    assert.equal(paused.body.initiative.operationalStatus, 'paused');
    assert.equal(paused.body.initiative.stage, 'pending');
    const discarded = await app.json('PATCH', `/api/initiatives/${initiative.id}`, { body: { operationalStatus: 'discarded' }, cookie: session });
    assert.equal(discarded.body.initiative.operationalStatus, 'discarded');

    for (const category of ['Prospección externa', 'Desarrollo de negocio interno (Seidor/Towers)', 'Desarrollo de nuevos servicios QE', 'Alianzas/colaboraciones', 'Otros']) {
      const response = await app.json('PATCH', `/api/initiatives/${initiative.id}`, { body: { category }, cookie: session });
      assert.equal(response.status, 200);
      assert.equal(response.body.initiative.category, category);
    }
    const badCategory = await app.json('PATCH', `/api/initiatives/${initiative.id}`, { body: { category: 'external' }, cookie: session });
    assert.equal(badCategory.status, 400);
    const badPriority = await app.json('PATCH', `/api/initiatives/${initiative.id}`, { body: { priority: 'Urgente' }, cookie: session });
    assert.equal(badPriority.status, 400);
    const badStatus = await app.json('PATCH', `/api/initiatives/${initiative.id}`, { body: { operationalStatus: 'archived' }, cookie: session });
    assert.equal(badStatus.status, 400);
    const invalidStage = await app.json('PATCH', `/api/initiatives/${initiative.id}`, { body: { stage: 'prospecting' }, cookie: session });
    assert.equal(invalidStage.status, 400);

    const clearedServices = await app.json('PATCH', `/api/initiatives/${initiative.id}`, { body: { serviceIds: [] }, cookie: session });
    assert.deepEqual(clearedServices.body.initiative.services, []);
    const clearedLinks = await app.json('PATCH', `/api/initiatives/${initiative.id}`, { body: { links: [] }, cookie: session });
    assert.deepEqual(clearedLinks.body.initiative.links, []);
  });

  test('initiatives expose generated opportunities without coupling lifecycles', async () => {
    const client = await app.json('POST', '/api/clients', { body: { name: 'Cliente oportunidades generadas' }, cookie: session });
    const initiative = await app.json('POST', '/api/initiatives', { body: { title: 'Iniciativa con derivadas', clientId: client.body.record.id }, cookie: session });
    const opportunity = await app.json('POST', '/api/opportunities', {
      body: { ...OPPORTUNITY_PAYLOAD, title: 'Derivada de iniciativa', initiativeId: initiative.body.initiative.id },
      cookie: session,
    });
    assert.equal(opportunity.status, 201);

    const listed = await app.json('GET', '/api/initiatives', { cookie: session });
    const row = listed.body.initiatives.find((item) => item.id === initiative.body.initiative.id);
    assert.equal(row.linkedOpportunityCount, 1);
    assert.equal(row.opportunities[0].id, opportunity.body.opportunity.id);
    assert.equal(row.opportunities[0].archived, false);

    await app.json('PATCH', `/api/opportunities/${opportunity.body.opportunity.id}`, { body: { stage: 'contacted' }, cookie: session });
    const afterMove = await app.json('GET', '/api/initiatives', { cookie: session });
    const movedRow = afterMove.body.initiatives.find((item) => item.id === initiative.body.initiative.id);
    assert.equal(movedRow.stage, 'pending');
    assert.equal(movedRow.opportunities[0].stage, 'contacted');
  });

  test('initiatives archive logically, hide from the active board, and restore without data loss', async () => {
    const created = await app.json('POST', '/api/initiatives', { body: { title: 'Iniciativa archivada' }, cookie: session });
    const id = created.body.initiative.id;
    await app.json('POST', `/api/initiatives/${id}/actions`, { body: { text: 'Revisar alcance' }, cookie: session });

    const archived = await app.json('POST', `/api/initiatives/${id}/archive`, { cookie: session });
    assert.equal(archived.status, 200);
    assert.ok(archived.body.initiative.archivedAt);
    assert.equal(archived.body.initiative.archivedByName, 'Ada Lovelace');
    const blockedEdit = await app.json('PATCH', `/api/initiatives/${id}`, { body: { title: 'No permitido' }, cookie: session });
    assert.equal(blockedEdit.status, 409);
    assert.equal(blockedEdit.body.error.code, 'record_archived');

    const active = await app.json('GET', '/api/initiatives', { cookie: session });
    assert.equal(active.body.initiatives.some((item) => item.id === id), false);
    const archivedList = await app.json('GET', '/api/initiatives?archived=1', { cookie: session });
    assert.equal(archivedList.body.initiatives.some((item) => item.id === id), true);

    const actions = await app.json('GET', `/api/initiatives/${id}/actions`, { cookie: session });
    assert.equal(actions.body.actions.length, 1);

    const restored = await app.json('POST', `/api/initiatives/${id}/restore`, { cookie: session });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.initiative.archivedAt, '');
    const activeAgain = await app.json('GET', '/api/initiatives', { cookie: session });
    assert.equal(activeAgain.body.initiatives.some((item) => item.id === id), true);
  });

  test('retired initiative fields stay readable but cannot be written through the active form', async () => {
    const owner = await app.json('POST', '/api/people', { body: { name: 'Retired Owner' }, cookie: session });
    const tower = await app.json('POST', '/api/towers', { body: { name: 'Retired Tower', responsibleId: owner.body.record.id }, cookie: session });
    const created = await app.json('POST', '/api/initiatives', {
      body: { title: 'Campos retirados', towerId: tower.body.record.id, ownerId: owner.body.record.id, amount: '25000', qaPercent: 20, status: 'won' },
      cookie: session,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.initiative.amount, '0');
    assert.equal(created.body.initiative.qaPercent, 0);
    assert.equal(created.body.initiative.towerId, '');
    assert.equal(created.body.initiative.ownerId, '');
    assert.equal(created.body.initiative.status, 'open');

    app.db.prepare("UPDATE initiatives SET tower_id = ?, amount = '25000', qa_percent = 20, status = 'won' WHERE id = ?").run(tower.body.record.id, created.body.initiative.id);
    const updated = await app.json('PATCH', `/api/initiatives/${created.body.initiative.id}`, {
      body: { amount: '1', qaPercent: 90, status: 'lost', towerId: tower.body.record.id },
      cookie: session,
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.initiative.amount, '25000');
    assert.equal(updated.body.initiative.qaPercent, 20);
    assert.equal(updated.body.initiative.status, 'won');
    assert.equal(updated.body.initiative.towerId, tower.body.record.id);
  });

  test('DELETE opportunity archives the record instead of destroying its history', async () => {
    const created = await app.json('POST', '/api/opportunities', { body: OPPORTUNITY_PAYLOAD, cookie: session });
    const id = created.body.opportunity.id;
    const action = await app.json('POST', `/api/opportunities/${id}/actions`, { body: { text: 'Preparar propuesta' }, cookie: session });
    assert.equal(action.status, 201);
    const comment = await app.json('POST', `/api/actions/${action.body.action.id}/comments`, { body: { text: 'Revisar versión final' }, cookie: session });
    assert.equal(comment.status, 201);
    assert.ok(app.db.prepare('SELECT id FROM card_events WHERE card_id = ?').get(id));
    assert.ok(app.db.prepare('SELECT id FROM entity_events WHERE entity_type = ? AND entity_id = ?').get('opportunity', id));

    const deleted = await app.json('DELETE', `/api/opportunities/${id}`, { cookie: session });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.deleted, true);
    assert.equal(deleted.body.archived, true);
    const stored = app.db.prepare('SELECT id, archived_at, archived_by_name FROM opportunities WHERE id = ?').get(id);
    assert.ok(stored);
    assert.ok(stored.archived_at);
    assert.equal(stored.archived_by_name, 'Ada Lovelace');
    assert.ok(app.db.prepare('SELECT id FROM record_actions WHERE entity_type = ? AND entity_id = ?').get('opportunity', id));
    assert.ok(app.db.prepare('SELECT id FROM record_action_comments WHERE action_id = ?').get(action.body.action.id));
    assert.ok(app.db.prepare('SELECT id FROM entity_events WHERE entity_type = ? AND entity_id = ?').get('opportunity', id));
    assert.ok(app.db.prepare('SELECT id FROM card_events WHERE card_id = ?').get(id));
    assert.equal((await app.json('GET', '/api/opportunities', { cookie: session })).body.opportunities.some((item) => item.id === id), false);
    assert.equal((await app.json('POST', `/api/opportunities/${id}/restore`, { cookie: session })).status, 200);
    assert.equal((await app.json('DELETE', `/api/opportunities/${id}`, { cookie: session })).status, 200);
    assert.equal((await app.json('DELETE', `/api/opportunities/${id}`, { cookie: session })).status, 409);
    assert.equal((await app.json('DELETE', '/api/opportunities/OP-9999', { cookie: session })).status, 404);
  });

  test('DELETE initiative archives the record instead of destroying its history', async () => {
    const created = await app.json('POST', '/api/initiatives', { body: { title: 'Iniciativa a archivar' }, cookie: session });
    const id = created.body.initiative.id;
    const action = await app.json('POST', `/api/initiatives/${id}/actions`, { body: { text: 'Revisar alcance' }, cookie: session });
    assert.equal(action.status, 201);
    assert.ok(app.db.prepare('SELECT id FROM entity_events WHERE entity_type = ? AND entity_id = ?').get('initiative', id));

    const deleted = await app.json('DELETE', `/api/initiatives/${id}`, { cookie: session });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.deleted, true);
    assert.equal(deleted.body.archived, true);
    assert.ok(app.db.prepare('SELECT archived_at FROM initiatives WHERE id = ?').get(id).archived_at);
    assert.ok(app.db.prepare('SELECT id FROM record_actions WHERE entity_type = ? AND entity_id = ?').get('initiative', id));
    assert.ok(app.db.prepare('SELECT id FROM entity_events WHERE entity_type = ? AND entity_id = ?').get('initiative', id));
    assert.equal((await app.json('GET', '/api/initiatives', { cookie: session })).body.initiatives.some((item) => item.id === id), false);
    assert.equal((await app.json('GET', `/api/initiatives/${id}/events`, { cookie: session })).status, 200);
    assert.equal((await app.json('POST', `/api/initiatives/${id}/restore`, { cookie: session })).status, 200);
    assert.equal((await app.json('DELETE', `/api/initiatives/${id}`, { cookie: session })).status, 200);
    assert.equal((await app.json('DELETE', `/api/initiatives/${id}`, { cookie: session })).status, 409);
  });

  test('amount and QA percentage reject invalid values', async () => {
    const negativeAmount = await app.json('POST', '/api/opportunities', { body: { ...OPPORTUNITY_PAYLOAD, amount: '-1' }, cookie: session });
    const badPercent = await app.json('POST', '/api/opportunities', { body: { ...OPPORTUNITY_PAYLOAD, qaPercent: 101 }, cookie: session });
    assert.equal(negativeAmount.status, 400);
    assert.equal(badPercent.status, 400);
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
    assert.match(first.body.opportunity.id, /^OP-\d{4}$/);
    assert.match(second.body.opportunity.id, /^OP-\d{4}$/);
  });

  test('opportunity and initiative IDs start at their prefixes and advance without changing legacy records', async () => {
    const fresh = await startTestServer();
    try {
      const registered = await fresh.register({ email: 'sequence@example.com', name: 'Sequence User', password: 'password123' });
      const cookie = registered.cookie;
      const opportunity = await fresh.json('POST', '/api/opportunities', { body: OPPORTUNITY_PAYLOAD, cookie });
      fresh.db.exec(`CREATE TRIGGER reject_initiative_event BEFORE INSERT ON entity_events
        WHEN NEW.entity_type = 'initiative' BEGIN SELECT RAISE(ABORT, 'test rollback'); END`);
      const rolledBack = await fresh.json('POST', '/api/initiatives', { body: { title: 'No debe persistir' }, cookie });
      assert.equal(rolledBack.status, 500);
      assert.equal(fresh.db.prepare('SELECT COUNT(*) AS count FROM initiatives').get().count, 0);
      fresh.db.exec('DROP TRIGGER reject_initiative_event');
      const initiative = await fresh.json('POST', '/api/initiatives', { body: { title: 'Primera iniciativa', amount: '100' }, cookie });
      assert.equal(opportunity.body.opportunity.id, 'OP-0001');
      assert.equal(initiative.body.initiative.id, 'IN-0001');

      const now = new Date().toISOString();
      fresh.db.prepare(`INSERT INTO opportunities (id,title,account,amount,stage,tower,owner,due,tags,created_at,updated_at) VALUES ('OP-0012','Legacy OP','','0','prospecting','','','','[]',?,?)`).run(now, now);
      fresh.db.prepare(`INSERT INTO opportunities (id,title,account,amount,stage,tower,owner,due,tags,created_at,updated_at) VALUES ('O-0009','Legacy O','','0','prospecting','','','','[]',?,?)`).run(now, now);
      fresh.db.prepare(`INSERT INTO card_events (card_id,user_name,action,detail,created_at) VALUES ('OP-0012','Sistema','created','{}',?)`).run(now);
      fresh.db.prepare(`INSERT INTO initiatives (id,title,created_at,updated_at) VALUES ('IN-0007','Legacy IN',?,?)`).run(now, now);
      fresh.db.prepare(`INSERT INTO initiatives (id,title,created_at,updated_at) VALUES ('legacy-initiative','Legacy initiative',?,?)`).run(now, now);

      const nextOpportunity = await fresh.json('POST', '/api/opportunities', { body: { ...OPPORTUNITY_PAYLOAD, title: 'Siguiente oportunidad' }, cookie });
      const nextInitiative = await fresh.json('POST', '/api/initiatives', { body: { title: 'Siguiente iniciativa' }, cookie });
      assert.equal(nextOpportunity.body.opportunity.id, 'OP-0013');
      assert.equal(nextInitiative.body.initiative.id, 'IN-0008');
      assert.ok(fresh.db.prepare('SELECT id FROM opportunities WHERE id = ?').get('O-0009'));
      assert.ok(fresh.db.prepare('SELECT id FROM opportunities WHERE id = ?').get('OP-0012'));
      assert.ok(fresh.db.prepare('SELECT id FROM card_events WHERE card_id = ?').get('OP-0012'));
      assert.ok(fresh.db.prepare('SELECT id FROM initiatives WHERE id = ?').get('legacy-initiative'));
    } finally {
      await fresh.cleanup();
    }
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
      body: { stage: 'contacted', title: 'Doble cambio aplicado' },
      cookie: session,
    });

    assert.equal(patch.status, 200);
    assert.equal(patch.body.events.length, 2);
    assert.equal(patch.body.events[0].action, 'moved');
    assert.deepEqual(patch.body.events[0].detail, { from: 'prospecting', to: 'contacted' });
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
    assert.ok(rows.length > 0);
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
