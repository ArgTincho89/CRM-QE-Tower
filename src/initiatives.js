import { COMPLETED_INITIATIVE_STAGE, initiativeStages, initiativeStatuses } from './data.js';
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

export function scopeInitiativesToPage(list, page) {
  if (page !== 'crossSelling') return list;
  return list.filter((item) => item.category === 'Cross-selling' || item.category === 'cross_selling');
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
  };
}

export function removeInitiative(list, id) {
  return list.filter((item) => item.id !== id);
}

export function addInitiative(list, initiative) {
  return [initiative, ...removeInitiative(list, initiative.id)];
}
