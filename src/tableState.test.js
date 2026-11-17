import assert from 'node:assert/strict';
import test from 'node:test';
import { ariaSortFor, compareValues, describeColumnMove, describeSortChange, isEmptyValue, loadTableState, mergeColumnOrder, moveColumn, moveColumnTo, nextSort, orderByIds, describeRowMove, parseDateValue, sanitizeSort, saveTableState, sortRows, tableStorageKey, toSortKey } from './tableState.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
  };
}

const throwingStorage = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
};

const columns = [
  { id: 'name', label: 'Nombre', value: (row) => row.name },
  { id: 'amount', label: 'Importe', type: 'amount', value: (row) => row.amount },
  { id: 'due', label: 'Fecha', type: 'date', value: (row) => row.due },
  { id: 'qa', label: 'QA %', type: 'percent', value: (row) => row.qa },
  { id: 'links', label: 'Enlaces', sortable: false, value: (row) => row.links },
];

test('isEmptyValue treats null, blanks and table placeholders as empty', () => {
  for (const value of [null, undefined, '', '   ', '—', '-', Number.NaN]) assert.equal(isEmptyValue(value), true, String(value));
  for (const value of [0, '0', 'a', false]) assert.equal(isEmptyValue(value), false, String(value));
});

test('compareValues orders text with Spanish collation ignoring accents and case', () => {
  const names = ['Zeta', 'árbol', 'Álvaro', 'alba', 'Ñandú', 'nube', 'Oscar'];
  assert.deepEqual(names.slice().sort((a, b) => compareValues(a, b)), ['alba', 'Álvaro', 'árbol', 'nube', 'Ñandú', 'Oscar', 'Zeta']);
  assert.equal(compareValues('Ángel', 'angel'), 0);
});

test('compareValues uses numeric collation for text with digits', () => {
  const ids = ['OP-10', 'OP-2', 'OP-1'];
  assert.deepEqual(ids.slice().sort((a, b) => compareValues(a, b)), ['OP-1', 'OP-2', 'OP-10']);
  assert.ok(compareValues('000009', '000010') < 0);
});

test('compareValues parses formatted currency amounts', () => {
  assert.ok(compareValues('185.000 €', '25.000,50 €', 'amount') > 0);
  assert.ok(compareValues('1.234,56 €', '1.234,57 €', 'amount') < 0);
  assert.equal(compareValues('100.000,00 €', 100000, 'amount'), 0);
});

test('compareValues compares percentages and plain numbers numerically', () => {
  assert.ok(compareValues('9%', '10%', 'percent') < 0);
  assert.ok(compareValues(5, 40, 'number') < 0);
  assert.ok(compareValues('12,5', '12.4', 'number') > 0);
  assert.ok(compareValues('1.500', '200', 'number') > 0);
});

test('compareValues handles ISO and Spanish dates, then unparseable text after dates', () => {
  assert.ok(compareValues('2026-01-15', '2025-12-31', 'date') > 0);
  assert.ok(compareValues('02/01/2026', '2026-01-01', 'date') > 0);
  assert.ok(compareValues('2026-01-01', 'Por definir', 'date') < 0);
  assert.equal(parseDateValue('31/12/2025'), Date.UTC(2025, 11, 31));
  assert.equal(parseDateValue('no es fecha'), null);
  assert.deepEqual(toSortKey('Por definir', 'date'), { text: 'Por definir' });
});

test('compareValues sorts empty values after any value', () => {
  assert.equal(compareValues('', 'a'), 1);
  assert.equal(compareValues('a', '—'), -1);
  assert.equal(compareValues(null, undefined), 0);
});

test('sortRows sorts ascending and descending while keeping empty values last', () => {
  const rows = [
    { name: 'Beta', amount: '20.000 €' },
    { name: '', amount: '' },
    { name: 'alfa', amount: '185.000 €' },
    { name: 'Ébano', amount: '3.000,50 €' },
  ];
  assert.deepEqual(sortRows(rows, columns, { columnId: 'name', direction: 'asc' }).map((row) => row.name), ['alfa', 'Beta', 'Ébano', '']);
  assert.deepEqual(sortRows(rows, columns, { columnId: 'name', direction: 'desc' }).map((row) => row.name), ['Ébano', 'Beta', 'alfa', '']);
  assert.deepEqual(sortRows(rows, columns, { columnId: 'amount', direction: 'desc' }).map((row) => row.amount), ['185.000 €', '20.000 €', '3.000,50 €', '']);
});

test('sortRows is stable and does not mutate the input', () => {
  const rows = [{ id: 1, name: 'b' }, { id: 2, name: 'a' }, { id: 3, name: 'B' }, { id: 4, name: 'A' }];
  const snapshot = rows.slice();
  assert.deepEqual(sortRows(rows, columns, { columnId: 'name', direction: 'asc' }).map((row) => row.id), [2, 4, 1, 3]);
  assert.deepEqual(sortRows(rows, columns, { columnId: 'name', direction: 'desc' }).map((row) => row.id), [1, 3, 2, 4]);
  assert.deepEqual(rows, snapshot);
});

test('sortRows keeps the default order without sort, for unknown or unsortable columns', () => {
  const rows = [{ name: 'b' }, { name: 'a' }];
  assert.deepEqual(sortRows(rows, columns, null), rows);
  assert.deepEqual(sortRows(rows, columns, { columnId: 'missing', direction: 'asc' }), rows);
  assert.deepEqual(sortRows(rows, columns, { columnId: 'links', direction: 'asc' }), rows);
  assert.deepEqual(sortRows(undefined, columns, null), []);
});

test('nextSort cycles asc, desc and default order; another column restarts at asc', () => {
  const asc = nextSort(null, 'name');
  assert.deepEqual(asc, { columnId: 'name', direction: 'asc' });
  const desc = nextSort(asc, 'name');
  assert.deepEqual(desc, { columnId: 'name', direction: 'desc' });
  assert.equal(nextSort(desc, 'name'), null);
  assert.deepEqual(nextSort(desc, 'amount'), { columnId: 'amount', direction: 'asc' });
});

test('ariaSortFor reports the header state', () => {
  assert.equal(ariaSortFor(null, 'name'), 'none');
  assert.equal(ariaSortFor({ columnId: 'name', direction: 'asc' }, 'name'), 'ascending');
  assert.equal(ariaSortFor({ columnId: 'name', direction: 'desc' }, 'name'), 'descending');
  assert.equal(ariaSortFor({ columnId: 'name', direction: 'desc' }, 'amount'), 'none');
});

test('moveColumn moves by offset, clamps at the edges and ignores unknown ids', () => {
  const order = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveColumn(order, 'b', 1), ['a', 'c', 'b', 'd']);
  assert.deepEqual(moveColumn(order, 'b', -1), ['b', 'a', 'c', 'd']);
  assert.deepEqual(moveColumn(order, 'a', -1), order);
  assert.deepEqual(moveColumn(order, 'd', 5), order);
  assert.deepEqual(moveColumn(order, 'x', 1), order);
  assert.deepEqual(order, ['a', 'b', 'c', 'd']);
});

test('moveColumnTo places the dragged column at the target position', () => {
  const order = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveColumnTo(order, 'a', 'c'), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveColumnTo(order, 'd', 'a'), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveColumnTo(order, 'a', 'a'), order);
  assert.deepEqual(moveColumnTo(order, 'a', 'zz'), order);
});

test('mergeColumnOrder drops stale and duplicate ids and appends new columns', () => {
  assert.deepEqual(mergeColumnOrder(['c', 'old', 'a', 'c'], ['a', 'b', 'c', 'd']), ['c', 'a', 'b', 'd']);
  assert.deepEqual(mergeColumnOrder(null, ['a', 'b']), ['a', 'b']);
  assert.deepEqual(mergeColumnOrder('garbage', ['a', 'b']), ['a', 'b']);
});

test('sanitizeSort keeps only valid sorts on sortable columns', () => {
  assert.deepEqual(sanitizeSort({ columnId: 'name', direction: 'desc' }, ['name']), { columnId: 'name', direction: 'desc' });
  assert.equal(sanitizeSort({ columnId: 'links', direction: 'asc' }, ['name']), null);
  assert.equal(sanitizeSort({ columnId: 'name', direction: 'sideways' }, ['name']), null);
  assert.equal(sanitizeSort('asc', ['name']), null);
});

test('saveTableState and loadTableState round-trip under crm.table.<id>', () => {
  const storage = memoryStorage();
  assert.equal(tableStorageKey('agreements'), 'crm.table.agreements');
  const state = { order: ['amount', 'name', 'due', 'qa', 'links'], sort: { columnId: 'amount', direction: 'desc' } };
  assert.equal(saveTableState('agreements', state, storage), true);
  assert.deepEqual(JSON.parse(storage.data.get('crm.table.agreements')), state);
  assert.deepEqual(loadTableState('agreements', columns, storage), state);
});

test('loadTableState reconciles stale saved columns and drops an invalid sort', () => {
  const storage = memoryStorage({ 'crm.table.t': JSON.stringify({ order: ['qa', 'removed', 'name'], sort: { columnId: 'removed', direction: 'asc' } }) });
  assert.deepEqual(loadTableState('t', columns, storage), { order: ['qa', 'name', 'amount', 'due', 'links'], sort: null });
});

test('loadTableState falls back to defaults on missing, corrupt or failing storage', () => {
  const defaults = { order: ['name', 'amount', 'due', 'qa', 'links'], sort: null };
  assert.deepEqual(loadTableState('t', columns, memoryStorage()), defaults);
  assert.deepEqual(loadTableState('t', columns, memoryStorage({ 'crm.table.t': '{not json' })), defaults);
  assert.deepEqual(loadTableState('t', columns, memoryStorage({ 'crm.table.t': '42' })), defaults);
  assert.deepEqual(loadTableState('t', columns, throwingStorage), defaults);
  assert.deepEqual(loadTableState('t', columns, null), defaults);
});

test('saveTableState reports failure instead of throwing', () => {
  assert.equal(saveTableState('t', { order: [], sort: null }, throwingStorage), false);
  assert.equal(saveTableState('t', { order: [], sort: null }, null), false);
});

test('announcements describe sort changes and column moves in Spanish', () => {
  assert.equal(describeSortChange({ columnId: 'name', direction: 'asc' }, 'Cliente'), 'Ordenado por Cliente, ascendente.');
  assert.equal(describeSortChange({ columnId: 'name', direction: 'desc' }, 'Cliente'), 'Ordenado por Cliente, descendente.');
  assert.equal(describeSortChange(null, 'Cliente'), 'Orden predeterminado restaurado.');
  assert.equal(describeColumnMove(['a', 'b', 'c'], 'b', 'Importe'), 'Columna Importe movida a la posición 2 de 3.');
});

test('orderByIds puts listed rows first and keeps the rest in their order', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  assert.deepEqual(orderByIds(rows, ['c', 'a', 'zz']).map((row) => row.id), ['c', 'a', 'b', 'd']);
  assert.deepEqual(orderByIds(rows, []).map((row) => row.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(orderByIds(null, ['a']), []);
  assert.equal(describeRowMove('Pérez, Ana', 2, 5), 'Pérez, Ana movido a la posición 2 de 5.');
});
