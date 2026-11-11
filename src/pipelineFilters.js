import { parseAmount } from './money.js';

export function createDefaultAdvancedFilters() {
  return {
    entityType: 'all',
    account: '',
    category: 'all',
    bidManagerId: 'all',
    minAmount: '',
    maxAmount: '',
    minQaPercent: '',
    maxQaPercent: '',
    status: '',
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

export function filterPipelineCards(cards, filters) {
  return cards.filter((record) => {
    const isInitiative = record.entityType === 'initiative';
    if (filters.entityType !== 'all' && filters.entityType !== record.entityType) return false;
    if (filters.category !== 'all' && (!isInitiative || record.category !== filters.category)) return false;
    if (filters.status && (!isInitiative || !includesText(record.status, filters.status))) return false;

    if (!includesText(`${record.account || ''} ${record.clientId || ''}`, filters.account)) return false;
    if (filters.bidManagerId !== 'all' && record.bidManagerId !== filters.bidManagerId) return false;
    if (!withinRange(parseAmount(record.amount), filters.minAmount, filters.maxAmount)) return false;
    if (!withinRange(record.qaPercent, filters.minQaPercent, filters.maxQaPercent)) return false;
    if (!includesText(record.closureReason, filters.closureReason)) return false;
    if (!withinDateRange(record.createdAt, filters.createdFrom, filters.createdTo)) return false;
    if (!withinDateRange(record.updatedAt, filters.updatedFrom, filters.updatedTo)) return false;

    // Opportunity-only filters are ignored for initiatives unless category/status/type explicitly selects them.
    if (!isInitiative) {
      if (!includesText(record.number, filters.externalNumber)) return false;
      if (!includesText(record.due, filters.due)) return false;
      const tags = Array.isArray(record.tags) ? record.tags.join(' ') : record.tags;
      if (!includesText(tags, filters.tags)) return false;
    }
    return true;
  });
}
