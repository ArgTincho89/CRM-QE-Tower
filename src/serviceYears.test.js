import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAssignable, toggleSelection } from './multiSelect.js';
import {
  buildServiceOptions,
  defaultServiceYear,
  isAssignableService,
  previousServiceYear,
  serviceLabel,
  servicesOfYear,
  suggestNewServiceYear,
  yearNumbers,
} from './serviceYears.js';

const services = [
  { id: 'qa-2025', name: 'QA Automation', active: true, year: 2025 },
  { id: 'qa-2026', name: 'QA Automation', active: true, year: 2026 },
  { id: 'api-2026', name: 'API Testing', active: false, year: 2026 },
  { id: 'ai-2027', name: 'AI Testing', active: true, year: 2027 },
];

test('year helpers pick the current year, the latest one, and the previous one', () => {
  const years = [{ year: 2027 }, { year: 2025 }, { year: 2026 }];
  assert.deepEqual(yearNumbers(years), [2025, 2026, 2027]);
  assert.equal(defaultServiceYear(years, 2026), 2026);
  assert.equal(defaultServiceYear([{ year: 2024 }, { year: 2025 }], 2026), 2025);
  assert.equal(defaultServiceYear([], 2026), null);
  assert.equal(previousServiceYear(years, 2027), 2026);
  assert.equal(previousServiceYear(years, 2025), null);
  assert.equal(previousServiceYear(years, 2030), 2027);
  assert.equal(suggestNewServiceYear(years, 2026), 2028);
  assert.equal(suggestNewServiceYear([{ year: 2025 }], 2026), 2026);
});

test('services are filtered per year and labelled with their year outside the current one', () => {
  assert.deepEqual(servicesOfYear(services, 2026).map((item) => item.id), ['qa-2026', 'api-2026']);
  assert.equal(serviceLabel(services[0], 2026), 'QA Automation (2025)');
  assert.equal(serviceLabel(services[1], 2026), 'QA Automation');
  assert.equal(isAssignableService(services[1], 2026), true);
  assert.equal(isAssignableService(services[2], 2026), false);
  assert.equal(isAssignableService(services[0], 2026), false);
});

test('service options offer the current year and keep other-year links removable but not addable', () => {
  const options = buildServiceOptions(services, ['qa-2025', 'qa-2026'], 2026);
  assert.deepEqual(options.map((item) => [item.id, item.name]), [
    ['qa-2026', 'QA Automation'],
    ['api-2026', 'API Testing'],
    ['qa-2025', 'QA Automation (2025)'],
  ]);
  const legacy = options.find((item) => item.id === 'qa-2025');
  assert.equal(legacy.assignable, false);
  // Unselected services of other years are not offered at all.
  assert.equal(options.some((item) => item.id === 'ai-2027'), false);

  // Selected legacy link: removable; once removed it cannot be added back.
  assert.equal(isAssignable(legacy, ['qa-2025']), true);
  assert.deepEqual(toggleSelection(['qa-2025'], legacy), []);
  assert.equal(isAssignable(legacy, []), false);
  assert.deepEqual(toggleSelection([], legacy), []);
  // Inactive current-year services stay disabled as before.
  assert.deepEqual(toggleSelection([], options[1]), []);
  assert.deepEqual(toggleSelection([], options[0]), ['qa-2026']);
});
