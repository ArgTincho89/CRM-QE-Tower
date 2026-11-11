import { initiativeStages, initiativeStatuses } from './data.js';

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

// Prefill for "Crear oportunidad": client and active services are inherited but editable,
// the origin defaults to an internal initiative and the new record links back to it.
export function buildOpportunityPrefill(initiative, clients = [], services = []) {
  const serviceIds = (initiative.serviceIds
    || (initiative.services || []).map((item) => item.id)
    || []);
  const inherited = services.filter((item) => item.active && serviceIds.includes(item.id));
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
