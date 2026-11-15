import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startTestServer } from './testing.js';

// Synthetic data only.
describe('People and Proyectos API', () => {
  let app;
  let cookie;

  before(async () => {
    app = await startTestServer();
    const registered = await app.register({ email: 'people-admin@example.com', name: 'People Admin' });
    cookie = registered.cookie;
    const now = new Date().toISOString();
    const insert = app.db.prepare('INSERT INTO activity_catalog (id, name, category, l1, l3, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    insert.run('A1', 'Actividad ficticia uno', 'Funcional', '✅', '⚪', 1, now);
    insert.run('A2', 'Actividad ficticia dos', 'Strategy', '', 'Lidera', 2, now);
  });
  after(() => app.cleanup());

  const call = (method, path, body) => app.json(method, path, { body, cookie });

  test('every endpoint requires a session', async () => {
    for (const path of ['/api/talents', '/api/talent-skills', '/api/activity-catalog', '/api/assignments', '/api/training-catalog', '/api/training-plan', '/api/projects']) {
      const response = await app.json('GET', path);
      assert.equal(response.status, 401, path);
    }
    assert.equal((await app.json('POST', '/api/talents', { body: { name: 'Sin sesión' } })).status, 401);
  });

  test('activity catalog lists the levels of each activity', async () => {
    const response = await call('GET', '/api/activity-catalog');
    assert.equal(response.status, 200);
    assert.equal(response.body.records.length, 2);
    assert.deepEqual(response.body.records[0].levels, { L1: '✅', L2: '', L3: '⚪', L4: '', L5: '', L6: '', L7: '' });
    assert.equal((await call('POST', '/api/activity-catalog', {})).status, 405);
  });

  test('talents CRUD validates fields and records history', async () => {
    const missing = await call('POST', '/api/talents', { name: '  ' });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error.field, 'name');
    const badCategory = await call('POST', '/api/talents', { name: 'Talento X', category: 'Jefe' });
    assert.equal(badCategory.status, 400);
    assert.equal(badCategory.body.error.field, 'category');

    const created = await call('POST', '/api/talents', { name: 'Talento Uno', location: 'Ciudad Ficticia', category: 'QA Engineer', profile: 'Ambos' });
    assert.equal(created.status, 201);
    assert.equal(created.body.record.category, 'QA Engineer');
    const duplicate = await call('POST', '/api/talents', { name: 'talento uno' });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.field, 'name');

    const updated = await call('PATCH', `/api/talents/${created.body.record.id}`, { profile: 'Funcional' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.record.profile, 'Funcional');
    assert.equal(updated.body.record.location, 'Ciudad Ficticia');
    const events = app.db.prepare("SELECT action FROM entity_events WHERE entity_type = 'talent' AND entity_id = ? ORDER BY id").all(created.body.record.id);
    assert.deepEqual(events.map((row) => row.action), ['created', 'updated']);

    const removed = await call('DELETE', `/api/talents/${created.body.record.id}`);
    assert.equal(removed.status, 200);
    assert.equal((await call('PATCH', `/api/talents/${created.body.record.id}`, { name: 'X' })).status, 404);
  });

  test('talent skills reference a talent and a catalog activity with levels 1..4', async () => {
    const talent = (await call('POST', '/api/talents', { name: 'Talento Skills' })).body.record;
    const noActivity = await call('POST', '/api/talent-skills', { talentId: talent.id, activityId: 'nope', currentLevel: 2 });
    assert.equal(noActivity.status, 400);
    assert.equal(noActivity.body.error.field, 'activityId');
    const badLevel = await call('POST', '/api/talent-skills', { talentId: talent.id, activityId: 'A1', currentLevel: 5 });
    assert.equal(badLevel.status, 400);
    assert.equal(badLevel.body.error.field, 'currentLevel');
    const badCareer = await call('POST', '/api/talent-skills', { talentId: talent.id, activityId: 'A1', currentLevel: 2, careerLevel: 'L9' });
    assert.equal(badCareer.body.error.field, 'careerLevel');

    const created = await call('POST', '/api/talent-skills', { talentId: talent.id, activityId: 'A1', currentLevel: 2, targetLevel: 4, certificate: 'Cert ficticio', careerLevel: 'L3' });
    assert.equal(created.status, 201);
    assert.equal(created.body.record.talentName, 'Talento Skills');
    assert.equal(created.body.record.activityName, 'Actividad ficticia uno');
    assert.equal(created.body.record.activityCategory, 'Funcional');
    assert.equal(created.body.record.targetLevel, 4);
    const duplicate = await call('POST', '/api/talent-skills', { talentId: talent.id, activityId: 'A1', currentLevel: 1 });
    assert.equal(duplicate.status, 409);

    const blocked = await call('DELETE', `/api/talents/${talent.id}`);
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error.message, /1 skill/);

    assert.equal((await call('DELETE', `/api/talent-skills/${created.body.record.id}`)).status, 200);
    assert.equal((await call('DELETE', `/api/talents/${talent.id}`)).status, 200);
  });

  test('assignments validate the percentage and block deleting referenced masters', async () => {
    const talent = (await call('POST', '/api/talents', { name: 'Talento Asignado' })).body.record;
    const person = (await call('POST', '/api/people', { name: 'Responsable Ficticio' })).body.record;
    const tower = (await call('POST', '/api/towers', { name: 'Tower Ficticia', responsibleId: person.id })).body.record;
    const lob = (await call('POST', '/api/lobs', { name: 'LoB Ficticia' })).body.record;
    const client = (await call('POST', '/api/clients', { name: 'Cliente Ficticio' })).body.record;

    const missing = await call('POST', '/api/assignments', { talentId: talent.id });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error.field, 'percentage');
    const tooHigh = await call('POST', '/api/assignments', { talentId: talent.id, percentage: 120 });
    assert.equal(tooHigh.body.error.field, 'percentage');
    const noTalent = await call('POST', '/api/assignments', { percentage: 10 });
    assert.equal(noTalent.body.error.field, 'talentId');

    const first = await call('POST', '/api/assignments', { talentId: talent.id, towerId: tower.id, lobId: lob.id, clientId: client.id, percentage: '62,5' });
    assert.equal(first.status, 201);
    assert.equal(first.body.record.percentage, 62.5);
    assert.equal(first.body.record.towerName, 'Tower Ficticia');
    assert.equal(first.body.record.clientName, 'Cliente Ficticio');
    // Over 100 % in total is allowed (the UI warns), each row stays within 0..100.
    assert.equal((await call('POST', '/api/assignments', { talentId: talent.id, percentage: 50 })).status, 201);

    for (const [path, pattern] of [[`/api/towers/${tower.id}`, /1 asignación de talento/], [`/api/lobs/${lob.id}`, /1 asignación de talento/], [`/api/clients/${client.id}`, /1 asignación de talento/]]) {
      const response = await call('DELETE', path);
      assert.equal(response.status, 409, path);
      assert.match(response.body.error.message, pattern);
    }
    const talentBlocked = await call('DELETE', `/api/talents/${talent.id}`);
    assert.match(talentBlocked.body.error.message, /2 asignaciones/);

    const cleared = await call('PATCH', `/api/assignments/${first.body.record.id}`, { towerId: '', lobId: '', clientId: '' });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.record.towerId, null);
    assert.equal((await call('DELETE', `/api/towers/${tower.id}`)).status, 200);
  });

  test('training catalog and plan link courses, accept free text and guard deletes', async () => {
    const badUrl = await call('POST', '/api/training-catalog', { name: 'Curso con enlace', url: 'javascript:alert(1)' });
    assert.equal(badUrl.body.error.field, 'url');
    const course = await call('POST', '/api/training-catalog', { name: 'Curso Ficticio', family: 'QA', estimatedHours: '24', validityMonths: 36 });
    assert.equal(course.status, 201);
    assert.equal(course.body.record.estimatedHours, 24);
    const talent = (await call('POST', '/api/talents', { name: 'Talento Formación' })).body.record;

    const noCourse = await call('POST', '/api/training-plan', { talentId: talent.id });
    assert.equal(noCourse.status, 400);
    assert.equal(noCourse.body.error.field, 'courseName');
    const badDate = await call('POST', '/api/training-plan', { talentId: talent.id, courseName: 'Libre', startDate: '31/12/2026' });
    assert.equal(badDate.body.error.field, 'startDate');

    const linked = await call('POST', '/api/training-plan', {
      talentId: talent.id, courseId: course.body.record.id, courseName: 'ignorado', dedicatedHours: '10,5', progress: '150 %', status: 'En curso', startDate: '2026-08-03',
    });
    assert.equal(linked.status, 201);
    assert.equal(linked.body.record.courseLabel, 'Curso Ficticio');
    assert.equal(linked.body.record.dedicatedHours, 10.5);
    assert.equal(linked.body.record.progress, 150);
    assert.equal(linked.body.record.talentName, 'Talento Formación');

    const free = await call('POST', '/api/training-plan', { talentId: talent.id, courseName: 'Curso libre ficticio' });
    assert.equal(free.status, 201);
    assert.equal(free.body.record.courseId, null);
    assert.equal(free.body.record.courseLabel, 'Curso libre ficticio');

    const blocked = await call('DELETE', `/api/training-catalog/${course.body.record.id}`);
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error.message, /1 fila del plan de formación/);

    const unlinked = await call('PATCH', `/api/training-plan/${linked.body.record.id}`, { courseId: '', courseName: 'Otro curso libre' });
    assert.equal(unlinked.status, 200);
    assert.equal(unlinked.body.record.courseLabel, 'Otro curso libre');
    assert.equal((await call('DELETE', `/api/training-catalog/${course.body.record.id}`)).status, 200);
    const list = await call('GET', '/api/training-plan');
    assert.equal(list.body.records.length, 2);
  });

  test('projects CRUD keeps testing scope as a list and only accepts http(s) URLs', async () => {
    const missing = await call('POST', '/api/projects', { version: '1' });
    assert.equal(missing.body.error.field, 'applicationName');
    const badUrl = await call('POST', '/api/projects', { applicationName: 'App', projectUrl: 'ftp://example.com' });
    assert.equal(badUrl.body.error.field, 'projectUrl');
    const badScope = await call('POST', '/api/projects', { applicationName: 'App', testingScope: 'API' });
    assert.equal(badScope.body.error.field, 'testingScope');

    const created = await call('POST', '/api/projects', {
      applicationName: 'App Ficticia', code: '42', testingScope: ['API', 'E2E', 'api'], projectUrl: 'https://example.com/app', qaEntryDate: '2026-08-03', riskLevel: 'High',
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.record.testingScope, ['API', 'E2E']);
    const updated = await call('PATCH', `/api/projects/${created.body.record.id}`, { testingScope: [], status: 'Done' });
    assert.deepEqual(updated.body.record.testingScope, []);
    assert.equal(updated.body.record.status, 'Done');
    assert.equal((await call('DELETE', `/api/projects/${created.body.record.id}`)).status, 200);
    assert.equal((await call('DELETE', `/api/projects/${created.body.record.id}`)).status, 404);
    assert.equal((await call('PUT', '/api/projects', {})).status, 405);
  });
});
