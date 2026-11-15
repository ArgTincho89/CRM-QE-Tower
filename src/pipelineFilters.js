import { parseAmount } from './money.js';
import { opportunityClientLabel } from './opportunities.js';

export function createDefaultAdvancedFilters() {
  return {
    account: '',
    opportunityType: 'all',
    serviceId: 'all',
    lobId: 'all',
    towerId: 'all',
    bidManagerId: 'all',
    assignedUserId: 'all',
    minAmount: '',
    maxAmount: '',
    minQaPercent: '',
    maxQaPercent: '',
    externalNumber: '',
    registryId: '',
    due: '',
    tags: '',
    closureReason: '',
    createdFrom: '',
    createdTo: '',
    updatedFrom: '',
    updatedTo: '',
    outcome: 'all',
    resolutionFrom: '',
    resolutionTo: '',
    marketScope: 'all',
    contractType: 'all',
    serviceType: 'all',
    reusable: 'all',
  };
}

function includesText(value, query) {
  return !query.trim() || String(value ?? '').toLowerCase().includes(query.trim().toLowerCase());
}

function withinRange(value, minimum, maximum) {
  const numericValue = Number(value) || 0;
  return (minimum === '' || numericValue >= Number(minimum))
    && (maximum === '' || numericValue <= Number(maximum));
}

function withinDateRange(value, from, to) {
  const date = String(value ?? '').slice(0, 10);
  return (!from || date >= from) && (!to || date <= to);
}

/** Advanced-filter value that selects legacy Opportunities without a type. */
export const MISSING_OPPORTUNITY_TYPE_FILTER = 'none';

function matchesOpportunityType(value, filter = 'all') {
  if (filter === 'all') return true;
  if (filter === MISSING_OPPORTUNITY_TYPE_FILTER) return !value;
  return value === filter;
}

/** Option-select filter value that selects opportunities without a value (Ámbito, contract and service types). */
export const MISSING_OPTION_FILTER = 'none';

/** 'all', 'none' (unset) or a concrete option id. */
export function matchesOptionFilter(value, filter = 'all') {
  if (!filter || filter === 'all') return true;
  if (filter === MISSING_OPTION_FILTER) return !value;
  return value === filter;
}

/** "Reutilizable" filter values besides 'all'. */
export const REUSABLE_FILTER = 'yes';
export const NOT_REUSABLE_FILTER = 'no';

/** "Reutilizable" filter: 'all', 'yes' or 'no'. */
export function matchesReusable(record, filter = 'all') {
  if (filter === REUSABLE_FILTER) return Boolean(record.reusable);
  if (filter === NOT_REUSABLE_FILTER) return !record.reusable;
  return true;
}

/** "Resultado" filter value that selects opportunities without an outcome (still open). */
export const OPEN_OUTCOME_FILTER = 'open';

/** "Resultado" filter: 'all', 'open' (no outcome yet) or an outcome id (won/lost/discarded). */
export function matchesOutcome(record, filter = 'all') {
  if (!filter || filter === 'all') return true;
  if (filter === OPEN_OUTCOME_FILTER) return !record.outcome;
  return record.outcome === filter;
}

/** Assignee filter values besides a concrete user id. */
export const UNASSIGNED_FILTER = 'none';
export const ASSIGNED_TO_ME_FILTER = 'me';

/**
 * "Asignado a" filter: 'all', 'none' (no assignee), 'me' (the current user) or a user id.
 * 'me' never matches when the current user is unknown.
 */
export function matchesAssignee(record, filter = 'all', currentUserId = '') {
  if (!filter || filter === 'all') return true;
  const assignee = record.assignedUserId || '';
  if (filter === UNASSIGNED_FILTER) return !assignee;
  if (filter === ASSIGNED_TO_ME_FILTER) return Boolean(currentUserId) && assignee === currentUserId;
  return assignee === filter;
}

function hasRelation(list, id) {
  return id === 'all' || (Array.isArray(list) && list.some((item) => item.id === id));
}

function pipelineSearchText(item) {
  const tags = Array.isArray(item.tags) ? item.tags.join(' ') : '';
  return `${item.title} ${opportunityClientLabel(item)} ${item.owner} ${item.tower} ${item.id} ${item.number || ''} ${item.registryId || ''} ${item.due || ''} ${tags} ${item.category || ''} ${item.status || ''} ${item.closureReason || ''}`.toLowerCase();
}

/**
 * Toolbar filters of the CRM QE page (search box, stage, tower and owner selects), shared by
 * every view mode and by the archived opportunities table.
 */
export function filterPipelineToolbar(records, { query = '', stage = 'all', tower = 'all', owner = 'all' } = {}) {
  const normalized = String(query || '').trim().toLowerCase();
  return (records || []).filter((item) => pipelineSearchText(item).includes(normalized)
    && (stage === 'all' || item.stage === stage)
    && (tower === 'all' || item.tower === tower)
    && (owner === 'all' || item.owner === owner));
}

/**
 * Filters Opportunity cards. The Pipeline page only shows Opportunities, so
 * Initiative-specific criteria (record type, category, status) do not exist here.
 * Services, LoBs, and Towers are matched independently against each many-to-many
 * relation; selecting a Tower never implies a LoB.
 */
export function filterPipelineCards(cards, filters, { currentUserId = '' } = {}) {
  return cards.filter((record) => {
    if (!matchesOpportunityType(record.opportunityType, filters.opportunityType)) return false;
    if (!hasRelation(record.services, filters.serviceId)) return false;
    if (!hasRelation(record.lobs, filters.lobId)) return false;
    if (!hasRelation(record.towers, filters.towerId)) return false;

    // Opportunities without a client (staffing) match "Sin cliente".
    if (!includesText(`${opportunityClientLabel(record)} ${record.clientId || ''}`, filters.account)) return false;
    if (filters.bidManagerId !== 'all' && record.bidManagerId !== filters.bidManagerId) return false;
    if (!matchesAssignee(record, filters.assignedUserId, currentUserId)) return false;
    if (!withinRange(parseAmount(record.amount), filters.minAmount, filters.maxAmount)) return false;
    if (!withinRange(record.qaPercent, filters.minQaPercent, filters.maxQaPercent)) return false;
    if (!includesText(record.closureReason, filters.closureReason)) return false;
    if (!withinDateRange(record.createdAt, filters.createdFrom, filters.createdTo)) return false;
    if (!withinDateRange(record.updatedAt, filters.updatedFrom, filters.updatedTo)) return false;
    if (!matchesOutcome(record, filters.outcome)) return false;
    // A resolution-date range only matches opportunities that have a resolution date.
    if ((filters.resolutionFrom || filters.resolutionTo) && !record.resolutionDate) return false;
    if (!withinDateRange(record.resolutionDate, filters.resolutionFrom, filters.resolutionTo)) return false;
    if (!matchesOptionFilter(record.marketScope, filters.marketScope)) return false;
    if (!matchesOptionFilter(record.contractType, filters.contractType)) return false;
    if (!matchesOptionFilter(record.serviceType, filters.serviceType)) return false;
    if (!matchesReusable(record, filters.reusable)) return false;

    if (!includesText(record.number, filters.externalNumber)) return false;
    if (!includesText(record.registryId, filters.registryId ?? '')) return false;
    if (!includesText(record.due, filters.due)) return false;
    const tags = Array.isArray(record.tags) ? record.tags.join(' ') : record.tags;
    if (!includesText(tags, filters.tags)) return false;
    return true;
  });
}
