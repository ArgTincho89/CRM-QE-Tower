import { parseAmount } from './money.js';

export function createDefaultAdvancedFilters() {
  return {
    account: '',
    opportunityType: 'all',
    serviceId: 'all',
    lobId: 'all',
    towerId: 'all',
    bidManagerId: 'all',
    minAmount: '',
    maxAmount: '',
    minQaPercent: '',
    maxQaPercent: '',
    externalNumber: '',
    due: '',
    tags: '',
    closureReason: '',
    createdFrom: '',
    createdTo: '',
    updatedFrom: '',
    updatedTo: '',
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

function hasRelation(list, id) {
  return id === 'all' || (Array.isArray(list) && list.some((item) => item.id === id));
}

/**
 * Filters Opportunity cards. The Pipeline page only shows Opportunities, so
 * Initiative-specific criteria (record type, category, status) do not exist here.
 * Services, LoBs, and Towers are matched independently against each many-to-many
 * relation; selecting a Tower never implies a LoB.
 */
export function filterPipelineCards(cards, filters) {
  return cards.filter((record) => {
    if (!matchesOpportunityType(record.opportunityType, filters.opportunityType)) return false;
    if (!hasRelation(record.services, filters.serviceId)) return false;
    if (!hasRelation(record.lobs, filters.lobId)) return false;
    if (!hasRelation(record.towers, filters.towerId)) return false;

    if (!includesText(`${record.account || ''} ${record.clientId || ''}`, filters.account)) return false;
    if (filters.bidManagerId !== 'all' && record.bidManagerId !== filters.bidManagerId) return false;
    if (!withinRange(parseAmount(record.amount), filters.minAmount, filters.maxAmount)) return false;
    if (!withinRange(record.qaPercent, filters.minQaPercent, filters.maxQaPercent)) return false;
    if (!includesText(record.closureReason, filters.closureReason)) return false;
    if (!withinDateRange(record.createdAt, filters.createdFrom, filters.createdTo)) return false;
    if (!withinDateRange(record.updatedAt, filters.updatedFrom, filters.updatedTo)) return false;

    if (!includesText(record.number, filters.externalNumber)) return false;
    if (!includesText(record.due, filters.due)) return false;
    const tags = Array.isArray(record.tags) ? record.tags.join(' ') : record.tags;
    if (!includesText(tags, filters.tags)) return false;
    return true;
  });
}
