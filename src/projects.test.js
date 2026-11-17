import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCalendarEvents, CALENDAR_EVENT_TYPES } from './calendar.js';
import { DEFAULT_PROJECT_TAB, DEFAULT_REPORT_TAB, PROJECT_TABS, REPORT_TABS, isProjectTab, isReportTab } from './navigation.js';
import {
  DELIVERY_TARGETS, NAQ_LEVELS, PROJECT_TYPES, normalizeDeliveryTarget, normalizeNaq, validateDeliveryProjectForm,
} from './people.js';
import { loadProjectTab, loadReportTab, saveProjectTab, saveReportTab } from './preferences.js';

// Synthetic data only: "Proyectos" catalogs, calendar events and tab preferences.
test('project catalogs follow the Quality Gates model', () => {
  assert.equal(PROJECT_TYPES.length, 15);
  assert.equal(PROJECT_TYPES[3], 'Hotfix / Emergencia (QG-Exprés)');
  assert.deepEqual(NAQ_LEVELS, ['Bajo', 'Medio', 'Alto']);
  assert.deepEqual(DELIVERY_TARGETS, ['Tradicional', 'Integrado', 'Continuo']);
});

test('NAQ and delivery target accept legacy English values and keep unknown ones', () => {
  assert.equal(normalizeNaq('Medium'), 'Medio');
  assert.equal(normalizeNaq(' alto '), 'Alto');
  assert.equal(normalizeNaq(''), '');
  assert.equal(normalizeNaq('N/A'), 'N/A');
  assert.equal(normalizeDeliveryTarget('Continuos'), 'Continuo');
  assert.equal(normalizeDeliveryTarget('Traditional'), 'Tradicional');
  assert.equal(normalizeDeliveryTarget('integrado'), 'Integrado');
  assert.equal(normalizeDeliveryTarget(null), '');
});

test('delivery project form needs a name and a client and dates in order', () => {
  assert.deepEqual(Object.keys(validateDeliveryProjectForm({ name: ' ', clientId: '' })).sort(), ['clientId', 'name']);
  assert.equal(validateDeliveryProjectForm({ name: 'P', clientId: 'c', startDate: '2026-02-01', endDate: '2026-01-01' }).endDate, 'La fecha fin no puede ser anterior a la fecha inicio.');
  assert.deepEqual(validateDeliveryProjectForm({ name: 'P', clientId: 'c', startDate: '2026-01-01', endDate: '2026-01-01' }), {});
});

test('open delivery projects show their next action and next milestone in the calendar', () => {
  assert.ok(CALENDAR_EVENT_TYPES.some((type) => type.id === 'project' && type.label === 'Proyecto'));
  const events = buildCalendarEvents({
    deliveryProjects: [
      { id: 'p1', name: 'Proyecto Uno', status: 'En curso', nextActionDate: '2026-11-20', nextMilestoneDate: '2026-12-01', nextMilestone: 'Go live' },
      { id: 'p2', name: 'Proyecto Cerrado', status: 'Cerrado', nextActionDate: '2026-11-20', nextMilestoneDate: '2026-12-01' },
      { id: 'p3', name: 'Proyecto Sin Fechas', status: 'Planificado', nextActionDate: '', nextMilestoneDate: 'no-date' },
    ],
  });
  assert.deepEqual(events.map((event) => [event.key, event.type, event.date, event.label]), [
    ['project:p1:action', 'project', '2026-11-20', 'Próxima acción: Proyecto Uno'],
    ['project:p1:milestone', 'project', '2026-12-01', 'Hito: Go live — Proyecto Uno'],
  ]);
  assert.equal(events[1].recordId, 'p1');
});

function memoryStorage() {
  const data = new Map();
  return { getItem: (key) => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)) };
}

test('Proyectos and Informes remember their last tab and ignore unknown ones', () => {
  assert.deepEqual(PROJECT_TABS.map((tab) => tab.label), ['QE - NAQ Application Portfolio', 'Proyectos']);
  assert.deepEqual(REPORT_TABS.slice(0, 3).map((tab) => tab.label), ['Resumen actual', 'Evolución mensual', 'Informe mensual']);
  assert.ok(isProjectTab('deliveryProjects'));
  assert.ok(!isReportTab('nope'));
  const storage = memoryStorage();
  assert.equal(loadProjectTab(storage), DEFAULT_PROJECT_TAB);
  assert.equal(saveProjectTab('deliveryProjects', storage), true);
  assert.equal(loadProjectTab(storage), 'deliveryProjects');
  assert.equal(saveProjectTab('nope', storage), false);
  assert.equal(loadReportTab(storage), DEFAULT_REPORT_TAB);
  assert.equal(saveReportTab('people', storage), true);
  assert.equal(loadReportTab(storage), 'people');
  assert.equal(loadReportTab(null), DEFAULT_REPORT_TAB);
});
