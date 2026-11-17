import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildActivityMatrix, composeTalentName, computeAssignmentTotals, describeMatrixCell, filterRecords, mergeOptions, overAllocatedTalents, parseTestingScope,
  safeExternalUrl, skillLevelLabel, syncPrimaryTower, validateAssignmentForm, validateCourseForm, validatePlanForm, validateProjectForm, validateSkillForm,
  validateTalentCreateForm, validateTalentForm, TALENT_PROFILES, PERFORMANCE_STATUSES, parseTalentProfiles, isAssignmentActive, computeAvailability,
  talentAvailability, isAvailable, assignmentProjectLabel, configuredCareerLevels, validateActivityForm, validatePerformanceForm, validatePerformanceCreateForm,
  performanceYears,
} from './people.js';

describe('main tower', () => {
  test('keeps a still-selected main tower, picks the only tower, otherwise clears it', () => {
    assert.equal(syncPrimaryTower(['t1', 't2'], 't2'), 't2');
    assert.equal(syncPrimaryTower(['t1'], ''), 't1');
    assert.equal(syncPrimaryTower(['t1'], 't2'), 't1');
    assert.equal(syncPrimaryTower(['t1', 't3'], 't2'), '');
    assert.equal(syncPrimaryTower([], 't1'), '');
  });
});

describe('activity matrix', () => {
  test('classifies cells with accessible labels', () => {
    assert.deepEqual(describeMatrixCell('✅'), { kind: 'required', symbol: '✅', label: 'Requerido' });
    assert.deepEqual(describeMatrixCell(' ⚪ '), { kind: 'optional', symbol: '⚪', label: 'Opcional' });
    assert.deepEqual(describeMatrixCell(''), { kind: 'none', symbol: '', label: 'No aplica' });
    assert.deepEqual(describeMatrixCell('Lidera'), { kind: 'text', symbol: 'Lidera', label: 'Lidera' });
  });

  test('builds one row per activity with the seven levels in order', () => {
    const [row] = buildActivityMatrix([{ id: 'A1', name: 'Actividad', category: 'Funcional', levels: { L2: '✅', L7: 'Aprueba' } }]);
    assert.equal(row.cells.length, 7);
    assert.deepEqual(row.cells.map((cell) => cell.level), ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7']);
    assert.equal(row.cells[0].kind, 'none');
    assert.equal(row.cells[1].kind, 'required');
    assert.equal(row.cells[6].label, 'Aprueba');
  });
});

describe('assignment totals', () => {
  const assignments = [
    { talentId: 't1', talentName: 'Ana Prueba', percentage: 62.5 },
    { talentId: 't1', talentName: 'Ana Prueba', percentage: 50 },
    { talentId: 't2', talentName: 'Beto Ficticio', percentage: 100 },
    { talentId: 't3', talentName: 'Sin dato', percentage: 'x' },
  ];

  test('sums percentages per talent', () => {
    const totals = computeAssignmentTotals(assignments);
    assert.equal(totals.get('t1'), 112.5);
    assert.equal(totals.get('t2'), 100);
    assert.equal(totals.has('t3'), false);
  });

  test('flags only talents above 100 %', () => {
    assert.deepEqual(overAllocatedTalents(assignments), [{ talentId: 't1', talentName: 'Ana Prueba', total: 112.5 }]);
  });
});

describe('option and search helpers', () => {
  test('mergeOptions keeps defaults first and adds distinct values case-insensitively', () => {
    assert.deepEqual(mergeOptions(['No iniciada', 'En curso'], ['en curso', 'Pausada', '', ['Pausada', 'Otra']]), ['No iniciada', 'En curso', 'Pausada', 'Otra']);
  });

  test('filterRecords ignores case and accents across fields and arrays', () => {
    const records = [{ name: 'José Ficticio', tags: ['API'] }, { name: 'Ana', tags: ['E2E'] }];
    assert.deepEqual(filterRecords(records, 'jose', ['name']), [records[0]]);
    assert.deepEqual(filterRecords(records, 'e2e', ['name', 'tags']), [records[1]]);
    assert.equal(filterRecords(records, '  ', ['name']), records);
  });

  test('safeExternalUrl only allows http and https', () => {
    assert.equal(safeExternalUrl('https://example.com/a'), 'https://example.com/a');
    assert.equal(safeExternalUrl('javascript:alert(1)'), '');
    assert.equal(safeExternalUrl('not a url'), '');
  });

  test('parseTestingScope reads JSON arrays, arrays and separated lists', () => {
    assert.deepEqual(parseTestingScope('["Functional","API"]'), ['Functional', 'API']);
    assert.deepEqual(parseTestingScope(['API', 'api', ' E2E ']), ['API', 'E2E']);
    assert.deepEqual(parseTestingScope('API; E2E'), ['API', 'E2E']);
    assert.deepEqual(parseTestingScope(''), []);
  });

  test('skillLevelLabel names the 1..4 levels', () => {
    assert.equal(skillLevelLabel(3), '3. Autónomo');
    assert.equal(skillLevelLabel(9), '');
  });
});

describe('form validators', () => {
  test('talent and skill forms require their key fields', () => {
    assert.deepEqual(validateTalentForm({ name: ' ' }), { name: 'Indica el nombre del talento.' });
    assert.deepEqual(Object.keys(validateTalentForm({ name: 'Ana', towerIds: ['t1', 't2'], primaryTowerId: '' })), ['primaryTowerId']);
    assert.deepEqual(Object.keys(validateTalentForm({ name: 'Ana', towerIds: ['t1'], primaryTowerId: 't2' })), ['primaryTowerId']);
    assert.deepEqual(validateTalentForm({ name: 'Ana', towerIds: ['t1', 't2'], primaryTowerId: 't2' }), {});
    assert.deepEqual(validateTalentForm({ name: 'Ana', towerIds: [], primaryTowerId: '' }), {});
    assert.deepEqual(Object.keys(validateSkillForm({})), ['talentId', 'activityId', 'currentLevel']);
    assert.deepEqual(validateSkillForm({ talentId: 't', activityId: 'a', currentLevel: '2' }), {});
  });

  test('assignment percentage is required and between 0 and 100, decimals allowed', () => {
    assert.ok(validateAssignmentForm({ talentId: 't', percentage: '' }).percentage);
    assert.ok(validateAssignmentForm({ talentId: 't', percentage: '101' }).percentage);
    assert.ok(validateAssignmentForm({ talentId: 't', percentage: 'abc' }).percentage);
    assert.deepEqual(validateAssignmentForm({ talentId: 't', percentage: '62,5' }), {});
  });

  test('course, plan and project forms check numbers, links and required names', () => {
    assert.deepEqual(Object.keys(validateCourseForm({ name: '', estimatedHours: '-1', url: 'ftp://x', validityMonths: '1,5' })), ['name', 'estimatedHours', 'url', 'validityMonths']);
    assert.deepEqual(validateCourseForm({ name: 'Curso', estimatedHours: '6,0', url: 'https://example.com', validityMonths: '24' }), {});
    assert.deepEqual(validateCourseForm({ name: 'Curso', validityMonths: '1,5', noExpiry: true, approxPrice: '99,5' }), {}, '"No expira" skips the validity');
    assert.deepEqual(Object.keys(validateCourseForm({ name: 'Curso', approxPrice: 'caro' })), ['approxPrice']);
    assert.ok(validatePlanForm({ talentId: 't' }).courseName);
    assert.deepEqual(validatePlanForm({ talentId: 't', courseName: 'Libre', progress: '150 %', dedicatedHours: '10,5' }), {});
    assert.deepEqual(Object.keys(validateProjectForm({ applicationName: '', projectUrl: 'javascript:x' })), ['applicationName', 'projectUrl']);
  });
});

describe('talent create form', () => {
  test('composes "primer apellido, segundo apellido, nombre" and skips missing parts', () => {
    assert.equal(composeTalentName({ firstName: 'Ana', lastName: 'Pérez', secondLastName: 'Gómez' }), 'Pérez, Gómez, Ana');
    assert.equal(composeTalentName({ firstName: ' Ana ', lastName: ' Pérez ', secondLastName: ' Gómez ' }), 'Pérez, Gómez, Ana');
    assert.equal(composeTalentName({ firstName: 'Ana', lastName: 'Pérez', secondLastName: '' }), 'Pérez, Ana');
    assert.equal(composeTalentName({ firstName: '', lastName: 'Pérez', secondLastName: '' }), 'Pérez');
    assert.equal(composeTalentName({}), '');
  });

  test('requires first name, first surname and second surname, then applies the talent rules', () => {
    assert.deepEqual(Object.keys(validateTalentCreateForm({})), ['firstName', 'lastName', 'secondLastName']);
    assert.deepEqual(Object.keys(validateTalentCreateForm({ firstName: 'Ana', lastName: 'Pérez', secondLastName: 'Gómez', towerIds: ['t1', 't2'] })), ['primaryTowerId']);
    assert.deepEqual(validateTalentCreateForm({ firstName: 'Ana', lastName: 'Pérez', secondLastName: 'Gómez', towerIds: ['t1'], primaryTowerId: 't1' }), {});
  });
});

describe('talent profiles', () => {
  test('reads arrays, JSON strings and legacy single values in catalog order', () => {
    assert.deepEqual(TALENT_PROFILES, ['Funcional', 'No funcional', 'Automatización']);
    assert.deepEqual(parseTalentProfiles('Ambos'), ['Funcional', 'No funcional']);
    assert.deepEqual(parseTalentProfiles('No funcional'), ['No funcional']);
    assert.deepEqual(parseTalentProfiles('["Automatización","Funcional","Funcional"]'), ['Funcional', 'Automatización']);
    assert.deepEqual(parseTalentProfiles(['Otro', 'Automatización']), ['Automatización']);
    assert.deepEqual(parseTalentProfiles(''), []);
    assert.deepEqual(parseTalentProfiles(null), []);
    assert.deepEqual(parseTalentProfiles('[roto'), []);
  });
});

describe('availability', () => {
  const today = '2026-11-17';
  test('an assignment is active between its dates; a missing date is open', () => {
    assert.equal(isAssignmentActive({}, today), true);
    assert.equal(isAssignmentActive({ startDate: '2026-11-17', endDate: '2026-11-17' }, today), true);
    assert.equal(isAssignmentActive({ startDate: '2026-11-18' }, today), false);
    assert.equal(isAssignmentActive({ endDate: '2026-11-16' }, today), false);
    assert.equal(isAssignmentActive({ startDate: '2026-01-01', endDate: '' }, today), true);
  });

  test('is 100 minus the percentage of the assignments active today', () => {
    const availability = computeAvailability([
      { talentId: 'a', percentage: 40 },
      { talentId: 'a', percentage: 20, startDate: '2026-12-01' },
      { talentId: 'a', percentage: 12.5, endDate: '2026-12-31' },
      { talentId: 'b', percentage: 100 },
      { talentId: 'c', percentage: 70, endDate: '2026-10-31' },
      { talentId: 'd', percentage: 80 },
      { talentId: 'd', percentage: 30 },
    ], today);
    assert.equal(talentAvailability(availability, 'a'), 47.5);
    assert.equal(talentAvailability(availability, 'b'), 0);
    assert.equal(talentAvailability(availability, 'c'), 100);
    assert.equal(talentAvailability(availability, 'd'), -10);
    assert.equal(talentAvailability(availability, 'nobody'), 100);
  });

  test('"Disponible" means between 1 % and 100 % free', () => {
    assert.deepEqual([100, 47.5, 1, 0.5, 0, -10].map(isAvailable), [true, true, true, false, false, false]);
  });

  test('the project of an assignment is its client, else tower, else LoB', () => {
    assert.equal(assignmentProjectLabel({ clientName: 'C', towerName: 'T', lobName: 'L' }), 'C');
    assert.equal(assignmentProjectLabel({ towerName: 'T', lobName: 'L' }), 'T');
    assert.equal(assignmentProjectLabel({ lobName: 'L' }), 'L');
    assert.equal(assignmentProjectLabel({}), 'sin proyecto');
  });

  test('assignment end date cannot be before the start date', () => {
    assert.ok(validateAssignmentForm({ talentId: 't', percentage: '10', startDate: '2026-05-02', endDate: '2026-05-01' }).endDate);
    assert.deepEqual(validateAssignmentForm({ talentId: 't', percentage: '10', startDate: '2026-05-01', endDate: '2026-05-01' }), {});
    assert.deepEqual(validateAssignmentForm({ talentId: 't', percentage: '10', endDate: '2026-05-01' }), {});
  });
});

describe('activity levels', () => {
  test('only the non-empty catalog cells are configured levels', () => {
    assert.deepEqual(configuredCareerLevels({ levels: { L1: '✅', L2: '', L3: 'Lidera', L4: ' ', L7: '⚪' } }), ['L1', 'L3', 'L7']);
    assert.deepEqual(configuredCareerLevels({ l2: '✅' }), ['L2']);
    assert.deepEqual(configuredCareerLevels(null), []);
  });

  test('the skill form rejects a level the activity does not configure', () => {
    const base = { talentId: 't', activityId: 'a', currentLevel: '2' };
    assert.ok(validateSkillForm({ ...base, careerLevel: 'L2' }, { allowedCareerLevels: ['L1'] }).careerLevel);
    assert.deepEqual(validateSkillForm({ ...base, careerLevel: 'L1' }, { allowedCareerLevels: ['L1'] }), {});
    assert.deepEqual(validateSkillForm({ ...base, careerLevel: '' }, { allowedCareerLevels: [] }), {});
    assert.deepEqual(validateActivityForm({ name: ' ' }), { name: 'Indica el nombre de la actividad.' });
  });
});

describe('performance review', () => {
  test('validates one objective', () => {
    assert.deepEqual(Object.keys(validatePerformanceForm({ year: '1999', linkUrl: 'javascript:x' })), ['talentId', 'year', 'objective', 'linkUrl']);
    assert.deepEqual(validatePerformanceForm({ talentId: 't', year: '2026', objective: 'Certificarse', linkUrl: 'https://example.com' }), {});
  });

  test('validates the create form with several objectives', () => {
    assert.deepEqual(validatePerformanceCreateForm({ talentId: 't', year: '2026', objectives: [] }), { objectives: 'Añade al menos un objetivo.' });
    assert.deepEqual(Object.keys(validatePerformanceCreateForm({ talentId: 't', year: '2026', objectives: [{ objective: 'Uno' }, { objective: '', linkUrl: 'ftp://x' }] })),
      ['objectives.1.objective', 'objectives.1.linkUrl']);
    assert.deepEqual(validatePerformanceCreateForm({ talentId: 't', year: '2026', objectives: [{ objective: 'Uno' }, { objective: 'Dos' }] }), {});
    assert.deepEqual(PERFORMANCE_STATUSES, ['Pendiente', 'Cumplido', 'No cumplido']);
  });

  test('filter years include the current year and every stored one, newest first', () => {
    assert.deepEqual(performanceYears([{ year: 2024 }, { year: 2027 }, { year: 2024 }, { year: null }], 2026), [2027, 2026, 2024]);
    assert.deepEqual(performanceYears([], 2026), [2026]);
  });
});
