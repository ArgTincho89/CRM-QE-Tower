import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildActivityMatrix, computeAssignmentTotals, describeMatrixCell, filterRecords, mergeOptions, overAllocatedTalents, parseTestingScope,
  safeExternalUrl, skillLevelLabel, validateAssignmentForm, validateCourseForm, validatePlanForm, validateProjectForm, validateSkillForm, validateTalentForm,
} from './people.js';

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
    assert.ok(validatePlanForm({ talentId: 't' }).courseName);
    assert.deepEqual(validatePlanForm({ talentId: 't', courseName: 'Libre', progress: '150 %', dedicatedHours: '10,5' }), {});
    assert.deepEqual(Object.keys(validateProjectForm({ applicationName: '', projectUrl: 'javascript:x' })), ['applicationName', 'projectUrl']);
  });
});
