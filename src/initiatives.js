import { COMPLETED_INITIATIVE_STAGE, initiativeCategories, initiativeStages, initiativeStatuses } from './data.js';
import { isAssignableService } from './serviceYears.js';

// Legacy commercial stages mapped to the four permanent initiative columns.
// Mirrors the server migration: lost becomes Pendiente (with a discarded status).
export const LEGACY_INITIATIVE_STAGE_MAP = {
  prospecting: 'pending',
  analysis: 'in_progress',
  waiting: 'following',
  proposal: 'following',
  won: 'completed',
  lost: 'pending',
};

export const INITIATIVE_STATUS_FILTERS = [
  { id: 'all', label: 'Todos los estados' },
  ...initiativeStatuses.map(({ id, label }) => ({ id, label })),
];

export const DEFAULT_INITIATIVE_ORIGIN = 'Iniciativa interna';

export function mapInitiativeStage(stage) {
  if (initiativeStages.some((item) => item.id === stage)) return stage;
  return LEGACY_INITIATIVE_STAGE_MAP[stage] || 'pending';
}

/** Legacy stages resolve first, so a legacy `won` initiative also counts as completed. */
export function isInitiativeCompleted(item) {
  return mapInitiativeStage(item?.stage) === COMPLETED_INITIATIVE_STAGE;
}

/**
 * Single predicate for every counter or metric of ACTIVE initiatives: archived and completed
 * (including legacy `won`) initiatives never count. Paused and discarded keep counting: they are
 * operational statuses on the working columns, not lifecycle ends.
 */
export function isActiveInitiative(item) {
  return Boolean(item) && !item.archivedAt && !isInitiativeCompleted(item);
}

/** Active and completed counts for a list of initiatives; archived ones count in neither. */
export function summarizeInitiatives(list) {
  return (list || []).reduce(
    (summary, item) => {
      if (isActiveInitiative(item)) summary.active += 1;
      else if (item && !item.archivedAt) summary.completed += 1;
      return summary;
    },
    { active: 0, completed: 0 },
  );
}

/** Board heading label, e.g. "3 activas · 1 completada". */
export function initiativeCountLabel(list) {
  const { active, completed } = summarizeInitiatives(list);
  return `${active} ${active === 1 ? 'activa' : 'activas'} · ${completed} ${completed === 1 ? 'completada' : 'completadas'}`;
}

export function initiativeStatusLabel(status) {
  return initiativeStatuses.find((item) => item.id === status)?.label || 'Activa';
}

// Paused and discarded are status filters over the same four columns, never columns.
export function filterInitiativesByStatus(list, statusFilter = 'all') {
  if (!statusFilter || statusFilter === 'all') return list;
  return list.filter((item) => (item.operationalStatus || 'active') === statusFilter);
}

/** Cross-selling category, including the legacy `cross_selling` id. */
export function isCrossSellingInitiative(item) {
  return item?.category === 'Cross-selling' || item?.category === 'cross_selling';
}

export function scopeInitiativesToPage(list, page) {
  if (page !== 'crossSelling') return list;
  return list.filter(isCrossSellingInitiative);
}

const LEGACY_INITIATIVE_CATEGORIES = {
  internal: 'Desarrollo de negocio interno (Seidor/Towers)',
  cross_selling: 'Cross-selling',
  external: 'Prospección externa',
};

/** Display label of an initiative category; legacy ids map to their current label. */
export function initiativeCategoryLabel(value) {
  return LEGACY_INITIATIVE_CATEGORIES[value] || (initiativeCategories.includes(value) ? value : (value || 'Otros'));
}

/** Free-text search shared by every initiative view (board, list and table). */
export function matchesInitiativeQuery(item, query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) return true;
  return `${item.id} ${item.title} ${item.clientName || ''} ${initiativeCategoryLabel(item.category)} ${item.priority || ''} ${item.assignedUserName || ''}`
    .toLowerCase()
    .includes(normalized);
}

/** Page scope, operational-status filter and search, in that order. */
export function filterInitiativeRecords(list, { page = 'initiatives', statusFilter = 'all', query = '' } = {}) {
  return filterInitiativesByStatus(scopeInitiativesToPage(list || [], page), statusFilter)
    .filter((item) => matchesInitiativeQuery(item, query));
}

/**
 * One display record per initiative, shared by the board cards, the list rows and the table:
 * resolved labels plus the counts the table shows. `sourceRecord` keeps the API object for
 * edit and restore.
 */
export function toInitiativeRecord(item) {
  const stage = mapInitiativeStage(item.stage);
  const stageInfo = initiativeStages.find((entry) => entry.id === stage);
  const services = Array.isArray(item.services) ? item.services : [];
  const links = Array.isArray(item.links) ? item.links : [];
  const generated = Array.isArray(item.opportunities) ? item.opportunities.length : Number(item.linkedOpportunityCount) || 0;
  return {
    ...item,
    account: item.clientName || 'Sin cliente',
    categoryLabel: initiativeCategoryLabel(item.category),
    stage,
    stageLabel: stageInfo?.label || stage,
    stageTone: stageInfo?.tone || '',
    statusLabel: initiativeStatusLabel(item.operationalStatus),
    priority: item.priority || 'Media',
    initiativeDue: item.nextActionDate || '',
    servicesLabel: services.map((service) => service.name).filter(Boolean).join(', '),
    linkCount: links.length,
    generatedOpportunityCount: generated,
    entityType: 'initiative',
    cardKey: `initiative:${item.id}`,
    sourceRecord: item,
  };
}

// Prefill for "Crear oportunidad": client and the services that are still assignable (active
// and of the current fiscal year) are inherited but editable,
// the origin defaults to an internal initiative and the new record links back to it.
export function buildOpportunityPrefill(initiative, clients = [], services = [], currentYear = new Date().getFullYear()) {
  const serviceIds = (initiative.serviceIds
    || (initiative.services || []).map((item) => item.id)
    || []);
  const inherited = services.filter((item) => isAssignableService(item, currentYear) && serviceIds.includes(item.id));
  return {
    clientId: initiative.clientId || '',
    account: clients.find((item) => item.id === initiative.clientId)?.name || initiative.clientName || '',
    initiativeId: initiative.id || '',
    origin: DEFAULT_INITIATIVE_ORIGIN,
    serviceIds: inherited.map((item) => item.id),
    services: inherited,
    // The initiative's assignee keeps ownership of the opportunity it becomes.
    assignedUserId: initiative.assignedUserId || '',
  };
}

/** Days ahead (inclusive) in which a next action counts as due soon. */
export const INITIATIVE_SOON_DAYS = 5;

/**
 * Whole calendar days from `today` (local date) to an ISO `YYYY-MM-DD` date: 0 today, negative
 * when past. Both sides use local calendar dates, never UTC instants, so the result does not
 * shift around midnight. Returns null for an empty or malformed date.
 */
export function daysUntilDate(isoDate, today = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || '').trim());
  if (!match) return null;
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const base = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - base) / 86400000);
}

/**
 * Kanban tint of an initiative by its next action date: 'due' (today or past), 'soon' (1 to 5
 * days ahead) or 'none' (no date, further ahead, completed or archived).
 */
export function initiativeUrgency(initiative, today = new Date()) {
  if (!initiative || initiative.archivedAt || isInitiativeCompleted(initiative)) return 'none';
  const days = daysUntilDate(initiative.nextActionDate, today);
  if (days === null) return 'none';
  if (days <= 0) return 'due';
  return days <= INITIATIVE_SOON_DAYS ? 'soon' : 'none';
}

/** Urgency plus the Spanish text cue that accompanies the color (empty label when there is none). */
export function describeInitiativeUrgency(initiative, today = new Date()) {
  const level = initiativeUrgency(initiative, today);
  if (level === 'none') return { level, label: '' };
  const days = daysUntilDate(initiative.nextActionDate, today);
  if (level === 'due') {
    if (days === 0) return { level, label: 'Vence hoy' };
    return { level, label: days === -1 ? 'Vencida hace 1 día' : `Vencida hace ${-days} días` };
  }
  return { level, label: days === 1 ? 'Vence mañana' : `Vence en ${days} días` };
}

export function removeInitiative(list, id) {
  return list.filter((item) => item.id !== id);
}

export function addInitiative(list, initiative) {
  return [initiative, ...removeInitiative(list, initiative.id)];
}
