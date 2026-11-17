import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALL_YEARS, NO_DATE_YEAR, addMonths, buildCertificationMatrix, certificationExpiry, certificationLevel, certificationRecommendation, coursePlanDefaults,
  courseSelectOptions, effectiveCertificationStatus, filterPlanByYear, investmentSummary, matchCourseByName, matchTalentByName, planYearOptions,
  planYearSummary, strategyTargets, summarizeCertifications, validityLabel,
} from './training.js';

// Synthetic data only.
test('catalog select lists training courses first, each group by name', () => {
  const options = courseSelectOptions([
    { id: 'c1', name: 'Zeta cert', types: 'Certificación oficial' },
    { id: 'f2', name: 'Beta curso', types: 'Formación' },
    { id: 'f1', name: 'Alfa curso', types: 'formacion' },
    { id: 'x', name: 'Alfa cert', types: '' },
  ]);
  assert.deepEqual(options.map((option) => [option.value, option.group]), [
    ['f1', 'Formaciones'], ['f2', 'Formaciones'], ['x', 'Certificaciones y otros'], ['c1', 'Certificaciones y otros'],
  ]);
});

test('a selected course always sets family and hours; clearing it changes nothing', () => {
  assert.deepEqual(coursePlanDefaults({ family: 'IA', estimatedHours: 12.5 }), { family: 'IA', estimatedHours: '12,5' });
  assert.deepEqual(coursePlanDefaults({ family: '', estimatedHours: null }), { family: '', estimatedHours: '' });
  assert.deepEqual(coursePlanDefaults(undefined), {});
});

test('validity label shows "No expira", months or nothing', () => {
  assert.equal(validityLabel({ noExpiry: true, validityMonths: 12 }), 'No expira');
  assert.equal(validityLabel({ validityMonths: 36 }), '36 meses');
  assert.equal(validityLabel({ validityMonths: null }), '');
});

test('plan years come from "Fecha inicio" with "Sin fecha" and "Todos"', () => {
  const rows = [{ id: 'a', startDate: '2025-02-01' }, { id: 'b', startDate: '' }, { id: 'c', startDate: '2027-01-01' }];
  assert.deepEqual(planYearOptions(rows, 2026).map((option) => option.value), ['2027', '2026', '2025', NO_DATE_YEAR, ALL_YEARS]);
  assert.deepEqual(planYearOptions([], 2026).map((option) => option.label), ['2026', 'Todos']);
  assert.deepEqual(filterPlanByYear(rows, '2025').map((row) => row.id), ['a']);
  assert.deepEqual(filterPlanByYear(rows, NO_DATE_YEAR).map((row) => row.id), ['b']);
  assert.equal(filterPlanByYear(rows, ALL_YEARS).length, 3);
});

test('talent names match in any order, without accents, and partially only when unique', () => {
  const talents = [
    { id: '1', name: 'Pérez, Gómez, Ana' },
    { id: '2', name: 'Luis Ficticio' },
    { id: '3', name: 'Luis Ficticio Segundo' },
    { id: '4', name: 'Marta Prueba' },
  ];
  assert.equal(matchTalentByName('Ana Perez Gomez', talents)?.id, '1');
  assert.equal(matchTalentByName('Luis Ficticio', talents)?.id, '2', 'exact words win over a partial match');
  assert.equal(matchTalentByName('Marta Prueba Tercera', talents)?.id, '4');
  assert.equal(matchTalentByName('Ana Pérez', talents)?.id, '1');
  assert.equal(matchTalentByName('Marta Otra', talents), null, 'one shared word is not enough');
  assert.equal(matchTalentByName('', talents), null);
});

test('certifications match by name, by name without code, or by code', () => {
  const courses = [{ id: 'a', name: 'Cloud Basics' }, { id: 'b', name: 'Fundamentos Nube (NB-100)' }, { id: 'c', name: 'Tester Pro (TP-1)' }];
  assert.equal(matchCourseByName('cloud basics', courses)?.id, 'a');
  assert.equal(matchCourseByName('Cloud Basics (CB-9)', courses)?.id, 'a');
  assert.equal(matchCourseByName('Fundamentos Nube', courses)?.id, 'b');
  assert.equal(matchCourseByName('Otro nombre (TP-1)', courses)?.id, 'c');
  assert.equal(matchCourseByName('Nada', courses), null);
});

test('expiry derives from the obtained date and catalog validity', () => {
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2024-11-15', 14), '2026-01-15');
  assert.deepEqual(certificationExpiry({ status: 'Obtenida', obtainedDate: '2024-01-10' }, { validityMonths: 36 }), { kind: 'date', date: '2027-01-10' });
  assert.equal(certificationExpiry({ status: 'Obtenida', obtainedDate: '2024-01-10' }, { noExpiry: true }).kind, 'never');
  assert.equal(certificationExpiry({ status: 'Obtenida', obtainedDate: '' }, { validityMonths: 36 }).kind, 'unknown');
  assert.equal(certificationExpiry({ status: 'Pendiente', obtainedDate: '2024-01-10' }, { validityMonths: 36 }).kind, 'unknown');
  assert.equal(effectiveCertificationStatus({ status: 'Obtenida', obtainedDate: '2020-01-01' }, { validityMonths: 12 }, '2026-01-01'), 'Caducada');
  assert.equal(effectiveCertificationStatus({ status: 'Obtenida', obtainedDate: '2020-01-01' }, { noExpiry: true }, '2026-01-01'), 'Obtenida');
});

test('level and recommendation follow the roadmap sheet rules', () => {
  assert.equal(certificationLevel({ Foundation: 1, 'Core Advanced': 2 }), 'Advanced+');
  assert.equal(certificationLevel({ Foundation: 1, 'Core Advanced': 1 }), 'Core Advanced');
  assert.equal(certificationLevel({ Foundation: 1 }), 'Foundation');
  assert.equal(certificationLevel({}), 'Sin Foundation');
  assert.equal(certificationRecommendation({}), 'Obtener ISTQB Foundation');
  assert.equal(certificationRecommendation({ Foundation: 1 }), 'Priorizar CTAL-TA / CTAL-TM / CTAL-TAE según rol');
  assert.equal(certificationRecommendation({ Foundation: 1, 'Core Advanced': 1 }), 'Complementar con Cloud / IA / DevOps / Security');
  assert.equal(certificationRecommendation({ Foundation: 1, 'Core Advanced': 1, Extras: 1 }), 'Perfil referente / especialización por proyecto');
});

const COURSES = [
  { id: 'f', name: 'Fundación X', istqbCategory: 'Foundation', validityMonths: 12 },
  { id: 'a', name: 'Avanzado Y', istqbCategory: 'Core Advanced' },
  { id: 'e', name: 'Extra Z', istqbCategory: 'extras', noExpiry: true },
  { id: 'i', name: 'Interno', istqbCategory: '' },
];
const RECORDS = [
  { id: '1', talentId: 't1', talentName: 'Ana', courseId: 'f', status: 'Obtenida', obtainedDate: '2020-01-01' },
  { id: '2', talentId: 't1', talentName: 'Ana', courseId: 'a', status: 'Pendiente' },
  { id: '3', talentId: 't2', talentName: 'Beto', courseId: 'f', status: 'Obtenida' },
  { id: '4', talentId: 't2', talentName: 'Beto', courseId: 'e', status: 'Obtenida' },
];

test('matrix columns follow the category order and rows rank by obtained certifications', () => {
  const matrix = buildCertificationMatrix(RECORDS, COURSES, '2026-01-01');
  assert.deepEqual(matrix.columns.map((column) => [column.id, column.category]), [['f', 'Foundation'], ['a', 'Core Advanced'], ['e', 'Extras']]);
  assert.deepEqual(matrix.rows.map((row) => row.talentName), ['Beto', 'Ana']);
  const ana = matrix.rows[1];
  assert.equal(ana.cells.f.status, 'Caducada', 'expired certifications are flagged and not counted');
  assert.equal(ana.counts.total, 0);
  assert.equal(ana.counts.pending, 1);
  assert.equal(matrix.rows[0].level, 'Foundation');
  assert.equal(matrix.rows[0].recommendation, 'Priorizar CTAL-TA / CTAL-TM / CTAL-TAE según rol');
});

test('certification summary and strategy targets compare live counts with stored targets', () => {
  const summary = summarizeCertifications(RECORDS, COURSES);
  assert.equal(summary.people, 2);
  assert.equal(summary.obtained, 3);
  assert.equal(summary.pending, 1);
  assert.deepEqual(summary.byCategory.find((item) => item.category === 'Foundation'), { category: 'Foundation', obtained: 2, pending: 0 });
  const targets = strategyTargets({ categoryTargets: [{ category: 'Foundation', target: 5 }, { category: 'Seguridad', target: 2 }] }, summary);
  assert.deepEqual(targets.map((row) => [row.category, row.actual, row.target, row.gap]), [
    ['Foundation', 2, 5, 3], ['Core Advanced', 0, null, null], ['ISTQB Specialist', 0, null, null], ['Extras', 1, null, null], ['Seguridad', 0, 2, 2],
  ]);
});

test('investment amounts multiply unit price by vouchers; plan year summary counts rows and hours', () => {
  const investment = investmentSummary([{ line: 'A', unitPrice: 200, vouchers: 4 }, { line: 'B', unitPrice: 180, vouchers: null }]);
  assert.deepEqual(investment.rows.map((row) => row.amount), [800, 0]);
  assert.equal(investment.total, 800);
  const plan = planYearSummary([{ talentId: 't1', startDate: '2026-02-01', estimatedHours: 10 }, { talentId: 't1', startDate: '2026-05-01', estimatedHours: 5.5 }, { talentId: 't2', startDate: '2025-01-01', estimatedHours: 3 }], 2026);
  assert.deepEqual(plan, { rows: 2, people: 1, estimatedHours: 15.5 });
});

test('certification and strategy forms validate required fields, years and numbers', async () => {
  const { validateCertificationForm, validateStrategyForm } = await import('./training.js');
  assert.deepEqual(Object.keys(validateCertificationForm({ talentId: '', courseId: '', obtainedYear: '1999' })), ['talentId', 'courseId', 'obtainedYear']);
  assert.deepEqual(validateCertificationForm({ talentId: 't', courseId: 'c', obtainedYear: '' }), {});
  assert.equal(validateStrategyForm({ year: '2026' }, { usedYears: [2026] }).year, 'Ya existe una estrategia para ese año.');
  assert.deepEqual(Object.keys(validateStrategyForm({
    year: '2027',
    investmentLines: [{ line: '', unitPrice: '10' }, { line: 'B', vouchers: 'x' }],
    categoryTargets: [{ category: 'Foundation', target: '-1' }],
    businessCase: [{ concept: '', detail: '' }],
  })).sort(), ['categoryTargets.0.target', 'investmentLines.0.line', 'investmentLines.1.vouchers']);
});
