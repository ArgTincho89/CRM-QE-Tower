import { parseAmount } from './money.js';

/** Sort directions cycle asc -> desc -> default order. */
export const SORT_ASC = 'asc';
export const SORT_DESC = 'desc';
export const COLUMN_TYPES = ['text', 'number', 'amount', 'percent', 'date'];
export const TABLE_STORAGE_PREFIX = 'crm.table.';

const defaultCollator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

/** Placeholders the tables render for missing data count as empty values. */
export function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number') return Number.isNaN(value);
  const text = String(value).trim();
  return text === '' || text === '—' || text === '-';
}

function parseNumber(value) {
  if (typeof value === 'number') return value;
  const raw = String(value).replace(/\s|%/g, '');
  // Spanish formatting uses "." for thousands and "," for decimals; plain "12.5" stays decimal.
  const cleaned = raw.includes(',') || /^-?\d{1,3}(\.\d{3})+$/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw;
  if (cleaned === '') return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

/** Accepts ISO dates (AAAA-MM-DD or full timestamps) and Spanish DD/MM/AAAA dates. */
export function parseDateValue(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  const text = String(value).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(text);
  if (iso) {
    const time = text.length > 10 ? Date.parse(text) : Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(time) ? null : time;
  }
  const spanish = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (spanish) return Date.UTC(Number(spanish[3]), Number(spanish[2]) - 1, Number(spanish[1]));
  return null;
}

/**
 * Normalizes a raw cell value into a comparable key: `{ empty }` for missing data,
 * `{ number }` for numeric/amount/percent/date values and `{ text }` otherwise.
 * Values a typed column cannot parse (e.g. "Por definir" in a date column) fall back to text.
 */
export function toSortKey(value, type = 'text') {
  if (isEmptyValue(value)) return { empty: true };
  if (type === 'amount') {
    if (typeof value === 'number') return { number: value };
    return /\d/.test(String(value)) ? { number: parseAmount(value) } : { text: String(value) };
  }
  if (type === 'number' || type === 'percent') {
    const number = parseNumber(value);
    return number === null ? { text: String(value) } : { number };
  }
  if (type === 'date') {
    const time = parseDateValue(value);
    return time === null ? { text: String(value) } : { number: time };
  }
  return { text: String(value) };
}

/**
 * Ascending comparison of two raw values for a column type. Numbers sort before text
 * fallbacks; empty values always compare last (the caller keeps them last when descending).
 */
export function compareValues(a, b, type = 'text', collator = defaultCollator) {
  const left = toSortKey(a, type);
  const right = toSortKey(b, type);
  if (left.empty || right.empty) return left.empty === right.empty ? 0 : (left.empty ? 1 : -1);
  const leftIsNumber = left.number !== undefined;
  const rightIsNumber = right.number !== undefined;
  if (leftIsNumber && rightIsNumber) return left.number === right.number ? 0 : (left.number < right.number ? -1 : 1);
  if (leftIsNumber !== rightIsNumber) return leftIsNumber ? -1 : 1;
  return collator.compare(left.text, right.text);
}

/**
 * Returns a sorted copy of `rows`. `sort` is `{ columnId, direction }` or null (default order).
 * The sort is stable and empty values stay last in both directions.
 */
export function sortRows(rows, columns, sort, collator = defaultCollator) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  if (!sort) return list;
  const column = (columns || []).find((item) => item.id === sort.columnId);
  if (!column || column.sortable === false || typeof column.value !== 'function') return list;
  const factor = sort.direction === SORT_DESC ? -1 : 1;
  const type = column.type || 'text';
  const keyed = list.map((row, index) => ({ row, index, value: column.value(row) }));
  keyed.sort((a, b) => {
    const aEmpty = isEmptyValue(a.value);
    const bEmpty = isEmptyValue(b.value);
    if (aEmpty || bEmpty) {
      if (aEmpty && bEmpty) return a.index - b.index;
      return aEmpty ? 1 : -1;
    }
    return (compareValues(a.value, b.value, type, collator) * factor) || (a.index - b.index);
  });
  return keyed.map((item) => item.row);
}

/** Header click cycle: unsorted -> asc -> desc -> unsorted; another column starts at asc. */
export function nextSort(current, columnId) {
  if (!current || current.columnId !== columnId) return { columnId, direction: SORT_ASC };
  if (current.direction === SORT_ASC) return { columnId, direction: SORT_DESC };
  return null;
}

/** `aria-sort` value of a column header. */
export function ariaSortFor(sort, columnId) {
  if (!sort || sort.columnId !== columnId) return 'none';
  return sort.direction === SORT_DESC ? 'descending' : 'ascending';
}

/** Moves `columnId` by `delta` positions (clamped). Unknown ids leave the order untouched. */
export function moveColumn(order, columnId, delta) {
  const list = Array.isArray(order) ? order.slice() : [];
  const from = list.indexOf(columnId);
  if (from === -1 || !Number.isInteger(delta) || delta === 0) return list;
  const to = Math.max(0, Math.min(list.length - 1, from + delta));
  if (to === from) return list;
  list.splice(from, 1);
  list.splice(to, 0, columnId);
  return list;
}

/** Drag-and-drop move: `sourceId` takes the position of `targetId`. */
export function moveColumnTo(order, sourceId, targetId) {
  const list = Array.isArray(order) ? order.slice() : [];
  const from = list.indexOf(sourceId);
  const to = list.indexOf(targetId);
  if (from === -1 || to === -1 || from === to) return list;
  return moveColumn(list, sourceId, to - from);
}

/**
 * Rows in the order of `ids` (by `rowKey`); rows whose key is not listed keep their relative
 * order after the listed ones, and unknown ids are ignored.
 */
export function orderByIds(rows, ids, rowKey = (row) => row.id) {
  const list = Array.isArray(rows) ? rows : [];
  const position = new Map((ids || []).map((id, index) => [id, index]));
  const listed = list.filter((row) => position.has(rowKey(row))).sort((a, b) => position.get(rowKey(a)) - position.get(rowKey(b)));
  return [...listed, ...list.filter((row) => !position.has(rowKey(row)))];
}

/** Screen-reader announcement after a row move (manual order). */
export function describeRowMove(label, position, total) {
  return `${label} movido a la posición ${position} de ${total}.`;
}

/**
 * Reconciles a saved order with the current column ids: unknown (stale) and duplicate ids
 * are dropped, and columns missing from the saved order are appended in default order.
 */
export function mergeColumnOrder(savedOrder, columnIds) {
  const known = new Set(columnIds);
  const merged = [];
  for (const id of Array.isArray(savedOrder) ? savedOrder : []) {
    if (known.has(id) && !merged.includes(id)) merged.push(id);
  }
  for (const id of columnIds) {
    if (!merged.includes(id)) merged.push(id);
  }
  return merged;
}

/** Keeps a saved sort only when it targets a sortable column with a valid direction. */
export function sanitizeSort(sort, sortableIds) {
  if (!sort || typeof sort !== 'object') return null;
  if (!sortableIds.includes(sort.columnId)) return null;
  if (sort.direction !== SORT_ASC && sort.direction !== SORT_DESC) return null;
  return { columnId: sort.columnId, direction: sort.direction };
}

export function tableStorageKey(tableId) {
  return `${TABLE_STORAGE_PREFIX}${tableId}`;
}

/** Browser storage, or null when it is unavailable (private mode, blocked site data, SSR). */
export function defaultTableStorage() {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Reads the persisted `{ order, sort }` of a table, already reconciled with the current
 * columns. Any storage or JSON failure returns the default state.
 */
export function loadTableState(tableId, columns, storage = defaultTableStorage()) {
  const columnIds = columns.map((column) => column.id);
  const sortableIds = columns.filter((column) => column.sortable !== false).map((column) => column.id);
  const fallback = { order: columnIds.slice(), sort: null };
  if (!storage) return fallback;
  let saved;
  try {
    const raw = storage.getItem(tableStorageKey(tableId));
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    return fallback;
  }
  if (!saved || typeof saved !== 'object') return fallback;
  return { order: mergeColumnOrder(saved.order, columnIds), sort: sanitizeSort(saved.sort, sortableIds) };
}

/** Persists `{ order, sort }`; returns false when storage is unavailable or throws (quota, privacy). */
export function saveTableState(tableId, state, storage = defaultTableStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(tableStorageKey(tableId), JSON.stringify({ order: state.order || [], sort: state.sort || null }));
    return true;
  } catch {
    return false;
  }
}

/** Screen-reader announcement after a sort change. */
export function describeSortChange(sort, label) {
  if (!sort) return 'Orden predeterminado restaurado.';
  return `Ordenado por ${label}, ${sort.direction === SORT_DESC ? 'descendente' : 'ascendente'}.`;
}

/** Screen-reader announcement after a column move. */
export function describeColumnMove(order, columnId, label) {
  const position = order.indexOf(columnId) + 1;
  return `Columna ${label} movida a la posición ${position} de ${order.length}.`;
}
