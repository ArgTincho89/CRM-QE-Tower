// Pure helpers for the "Calendario" page. Every date is an ISO calendar date ('YYYY-MM-DD') and
// all arithmetic runs on UTC day numbers, so daylight saving changes never shift or repeat a day.
import { initiativeUrgency, isInitiativeCompleted } from './initiatives.js';
import { assignmentProjectLabel } from './people.js';
import { truncateActionText } from './recordActions.js';

export const CALENDAR_VIEWS = [
  { id: 'month', label: 'Mes' },
  { id: 'week', label: 'Semana' },
  { id: 'agenda', label: 'Agenda' },
];

/** Event types in legend order, with the color tone of each one. */
export const CALENDAR_EVENT_TYPES = [
  { id: 'initiative', label: 'Iniciativa', tone: 'teal' },
  { id: 'opportunity', label: 'Oportunidad', tone: 'violet' },
  { id: 'agreement', label: 'Acuerdo Marco', tone: 'amber' },
  { id: 'action', label: 'Acción', tone: 'blue' },
  { id: 'agreementEnd', label: 'Fin de acuerdo', tone: 'brown' },
  { id: 'assignment', label: 'Fin de asignación', tone: 'rose' },
];

/** Event types that place a record on its "Fecha próxima acción". */
const NEXT_ACTION_TYPES = ['initiative', 'opportunity', 'agreement'];

/** Singular label of each record type that owns actions, for the action event description. */
const RECORD_TYPE_LABELS = { initiative: 'Iniciativa', opportunity: 'Oportunidad', agreement: 'Acuerdo Marco' };

/** Events a month cell shows before collapsing the rest into "+N más". */
export const MONTH_CELL_EVENT_LIMIT = 3;

export const SPANISH_MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Weekday headers, Monday first. */
export const SPANISH_WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const SPANISH_WEEKDAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

const DAY_MS = 86400000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value) {
  return String(value).padStart(2, '0');
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * `{ year, month (0-11), day }` of a valid ISO calendar date, or null. Rejects impossible
 * dates such as 2026-02-30 or 2025-02-29.
 */
export function parseIsoDate(value) {
  const match = ISO_DATE.exec(String(value ?? '').trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const check = new Date(Date.UTC(year, month, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** ISO date from calendar parts; `month` is 0-based and may overflow (e.g. 12 is next January). */
export function isoDateFromParts(year, month, day) {
  const date = new Date(Date.UTC(year, month, day));
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Local calendar date of a Date (what the user's wall clock says), as ISO. */
export function toLocalIsoDate(date = new Date()) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayNumber(iso) {
  const parts = parseIsoDate(iso);
  if (!parts) throw new RangeError(`Invalid ISO date: ${iso}`);
  return Date.UTC(parts.year, parts.month, parts.day) / DAY_MS;
}

function fromDayNumber(days) {
  const date = new Date(days * DAY_MS);
  return isoDateFromParts(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Adds whole days to an ISO date. */
export function addDays(iso, amount) {
  return fromDayNumber(dayNumber(iso) + amount);
}

/** Day of the week with Monday = 0 … Sunday = 6. */
export function weekdayIndex(iso) {
  // Day 0 of the epoch (1970-01-01) was a Thursday (index 3).
  return (((dayNumber(iso) + 3) % 7) + 7) % 7;
}

/** Monday of the week that contains `iso`. */
export function startOfWeek(iso) {
  return addDays(iso, -weekdayIndex(iso));
}

/** The seven dates (Monday to Sunday) of the week that contains `iso`. */
export function weekDates(iso) {
  const monday = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

/** Number of days in a month (`month` 0-based). */
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Month grid, Monday first: whole weeks from the Monday on or before the 1st to the Sunday on
 * or after the last day (4 to 6 weeks). Each cell is `{ date, inMonth }`.
 */
export function monthGrid(year, month) {
  const first = isoDateFromParts(year, month, 1);
  const last = isoDateFromParts(year, month, daysInMonth(year, month));
  const start = startOfWeek(first);
  const end = addDays(startOfWeek(last), 6);
  const weeks = [];
  for (let cursor = start; dayNumber(cursor) <= dayNumber(end); cursor = addDays(cursor, 7)) {
    weeks.push(weekDates(cursor).map((date) => ({ date, inMonth: parseIsoDate(date).month === month })));
  }
  return weeks;
}

/** Unbounded range of the agenda: it lists every event, past and future. */
export const AGENDA_RANGE = Object.freeze({ from: '0000-01-01', to: '9999-12-31' });

/** Heading of the agenda view, which is not tied to one period. */
export const AGENDA_TITLE = 'Todos los eventos';

/** First and last date shown by a view around the anchor date (the agenda ignores the anchor). */
export function visibleRange(view, anchor) {
  if (view === 'agenda') return { ...AGENDA_RANGE };
  const { year, month } = parseIsoDate(anchor);
  if (view === 'week') {
    const dates = weekDates(anchor);
    return { from: dates[0], to: dates[6] };
  }
  const weeks = monthGrid(year, month);
  return { from: weeks[0][0].date, to: weeks.at(-1)[6].date };
}

/**
 * Anchor after moving one period (`direction` +1 / -1). Months keep the day when it exists and
 * clamp it otherwise (31 January + 1 month = 28/29 February).
 */
export function shiftAnchor(view, anchor, direction) {
  if (view === 'week') return addDays(anchor, 7 * direction);
  const { year, month, day } = parseIsoDate(anchor);
  const target = new Date(Date.UTC(year, month + direction, 1));
  const targetYear = target.getUTCFullYear();
  const targetMonth = target.getUTCMonth();
  return isoDateFromParts(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

/** "Noviembre 2026". */
export function monthTitle(year, month) {
  return `${capitalize(SPANISH_MONTHS[month])} ${year}`;
}

/** Heading of a view: the month, the date span for a week, or "Todos los eventos" for the agenda. */
export function periodTitle(view, anchor) {
  if (view === 'agenda') return AGENDA_TITLE;
  const { year, month } = parseIsoDate(anchor);
  if (view !== 'week') return monthTitle(year, month);
  const dates = weekDates(anchor);
  const first = parseIsoDate(dates[0]);
  const last = parseIsoDate(dates[6]);
  if (first.year !== last.year) return `${first.day} ${SPANISH_MONTHS[first.month]} ${first.year} – ${last.day} ${SPANISH_MONTHS[last.month]} ${last.year}`;
  if (first.month !== last.month) return `${first.day} ${SPANISH_MONTHS[first.month]} – ${last.day} ${SPANISH_MONTHS[last.month]} ${last.year}`;
  return `${first.day} – ${last.day} ${SPANISH_MONTHS[first.month]} ${first.year}`;
}

/** "lunes, 2 de marzo". */
export function dayHeading(iso) {
  const { month, day } = parseIsoDate(iso);
  return `${SPANISH_WEEKDAY_NAMES[weekdayIndex(iso)]}, ${day} de ${SPANISH_MONTHS[month]}`;
}

function isClosedOpportunity(item) {
  return item.stage === 'result' && Boolean(item.outcome);
}

/**
 * All-day calendar events:
 * - Open initiatives, open opportunities and active framework agreements on their "Fecha próxima
 *   acción" (`nextActionDate`). Archived records, completed initiatives, closed opportunities
 *   (Resultado with an outcome) and inactive agreements never show, nor do invalid dates.
 *   Initiative events carry their urgency ('due' / 'soon' / 'none').
 * - Active agreements also show their end date ("Fin de vigencia") as a separate "Fin de acuerdo".
 * - Pending actions with a due date (`actions`: `{ id, text, dueDate, entityType, entityId }`) as
 *   "Acción: <texto truncado> — <título del registro>", only when their record shows (see above).
 *   When an action lands on the same day as its record's next action event, the record event is
 *   dropped: the action event says the same thing and more.
 * - People assignments with an end date ("Fecha fin") as "Fin de asignación: <talento> en
 *   <cliente / tower / LoB>".
 */
export function buildCalendarEvents({ initiatives = [], opportunities = [], agreements = [], assignments = [], actions = [] } = {}, today = new Date()) {
  const events = [];
  const push = (type, record, date, extra = {}) => {
    if (!parseIsoDate(date)) return;
    events.push({ key: `${type}:${record.id}`, type, recordId: record.id, title: record.title || '', label: `${record.id} · ${record.title || ''}`, date: String(date).trim(), urgency: 'none', ...extra });
  };
  // Records whose actions may show, keyed "<entityType>:<id>".
  const visibleRecords = new Map();
  for (const item of initiatives || []) {
    if (!item || item.archivedAt || isInitiativeCompleted(item)) continue;
    visibleRecords.set(`initiative:${item.id}`, item);
    push('initiative', item, item.nextActionDate, { urgency: initiativeUrgency(item, today) });
  }
  for (const item of opportunities || []) {
    if (!item || item.archivedAt || item.archived || isClosedOpportunity(item)) continue;
    visibleRecords.set(`opportunity:${item.id}`, item);
    push('opportunity', item, item.nextActionDate);
  }
  for (const item of agreements || []) {
    if (!item || item.archivedAt || (item.status && item.status !== 'active')) continue;
    visibleRecords.set(`agreement:${item.id}`, item);
    push('agreement', item, item.nextActionDate);
    const endLabel = `Fin de acuerdo: ${item.id} · ${item.title || ''}`;
    push('agreementEnd', item, item.endDate, { entityType: 'agreement', label: endLabel, description: endLabel });
  }
  const actionDays = new Set();
  for (const action of actions || []) {
    if (!action || (action.status && action.status !== 'pending') || (action.kind && action.kind !== 'action')) continue;
    const record = visibleRecords.get(`${action.entityType}:${action.entityId}`);
    if (!record || !parseIsoDate(action.dueDate)) continue;
    const date = String(action.dueDate).trim();
    const label = `Acción: ${truncateActionText(action.text)} — ${record.title || record.id}`;
    const description = `Acción: ${String(action.text ?? '').trim()} — ${RECORD_TYPE_LABELS[action.entityType]} ${record.id} · ${record.title || ''}`;
    events.push({ key: `action:${action.id}`, type: 'action', entityType: action.entityType, recordId: record.id, title: String(action.text ?? ''), label, description, date, urgency: 'none' });
    actionDays.add(`${action.entityType}:${record.id}:${date}`);
  }
  for (const item of assignments || []) {
    if (!item) continue;
    const label = `Fin de asignación: ${item.talentName || 'talento'} en ${assignmentProjectLabel(item)}`;
    push('assignment', item, item.endDate, { title: label, label, description: label });
  }
  const typeOrder = CALENDAR_EVENT_TYPES.map((type) => type.id);
  return events
    .filter((event) => !(NEXT_ACTION_TYPES.includes(event.type) && actionDays.has(`${event.type}:${event.recordId}:${event.date}`)))
    .sort((a, b) => a.date.localeCompare(b.date)
      || typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type)
      || a.recordId.localeCompare(b.recordId)
      || a.key.localeCompare(b.key));
}

/** Events whose type is enabled in `enabledTypes` (a Set or array of type ids). */
export function filterEventsByType(events, enabledTypes) {
  const enabled = new Set(enabledTypes || []);
  return (events || []).filter((event) => enabled.has(event.type));
}

/** Events inside an inclusive ISO date range. */
export function eventsInRange(events, from, to) {
  return (events || []).filter((event) => event.date >= from && event.date <= to);
}

/** Map of ISO date to that day's events, keeping the incoming order. */
export function groupEventsByDay(events) {
  const groups = new Map();
  for (const event of events || []) {
    if (!groups.has(event.date)) groups.set(event.date, []);
    groups.get(event.date).push(event);
  }
  return groups;
}

/** Splits a day's events into the ones a month cell shows and the hidden count ("+N más"). */
export function splitCellEvents(events, limit = MONTH_CELL_EVENT_LIMIT) {
  const list = events || [];
  if (list.length <= limit) return { visible: list, hidden: 0 };
  // One slot goes to the "+N más" link, so it never shows "+1 más" instead of the event itself.
  return { visible: list.slice(0, limit - 1), hidden: list.length - (limit - 1) };
}

/**
 * Agenda: the days that have events, in date order, as `{ date, events }`. Without a range it
 * covers every event (past and future).
 */
export function agendaDays(events, from = AGENDA_RANGE.from, to = AGENDA_RANGE.to) {
  const grouped = groupEventsByDay(eventsInRange(events, from, to));
  return [...grouped.keys()].sort().map((date) => ({ date, events: grouped.get(date) }));
}

/** Agenda days grouped under their month, in date order: `{ key: 'YYYY-MM', title, days }`. */
export function agendaMonths(events) {
  const months = [];
  for (const day of agendaDays(events)) {
    const key = day.date.slice(0, 7);
    if (months.at(-1)?.key !== key) {
      const { year, month } = parseIsoDate(day.date);
      months.push({ key, title: monthTitle(year, month), days: [] });
    }
    months.at(-1).days.push(day);
  }
  return months;
}

/** Agenda day to scroll to for `today`: the first one on or after it, else the last one ('' when empty). */
export function agendaStartDay(days, today) {
  const list = days || [];
  return list.find((day) => day.date >= today)?.date || list.at(-1)?.date || '';
}
