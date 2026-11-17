import { opportunityTypes } from './data.js';
import { isActiveInitiative } from './initiatives.js';
import { MISSING_OPPORTUNITY_TYPE_LABEL, isActiveOpportunity } from './opportunities.js';
import { computePipelineQe, computeWeightedPipeline } from './pipelineSummary.js';

/** Year-selector value that disables the year filter. */
export const ALL_YEARS = 'all';

/** Breakdown id for opportunities without a (known) type. */
export const MISSING_TYPE_BREAKDOWN_ID = 'none';

/**
 * Creation year of a record from `createdAt` (API) or `created_at` (raw rows), or null when
 * the record has no usable creation date. ISO strings are read literally (no timezone shift).
 */
export function recordYear(record) {
  const value = record?.createdAt ?? record?.created_at;
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-\d{2}/.exec(value.trim());
  return match ? Number(match[1]) : null;
}

/** Normalizes a stored/selected year to a number or ALL_YEARS; anything else is null. */
export function normalizeYearSelection(value) {
  if (value === ALL_YEARS) return ALL_YEARS;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 1900 && numeric <= 9999 ? numeric : null;
}

/**
 * Records created in `year`. ALL_YEARS keeps every record; with a concrete year, records
 * without a creation date are left out because they cannot be attributed to any year.
 */
export function filterByYear(list, year) {
  const records = Array.isArray(list) ? list : [];
  const selected = normalizeYearSelection(year);
  if (selected === ALL_YEARS || selected === null) return records;
  return records.filter((record) => recordYear(record) === selected);
}

/**
 * Years offered by the selector, newest first: every year with data in any collection, the
 * current year, and the selected year (so a persisted choice never dangles).
 */
export function availableYears(collections, currentYear, selectedYear = null) {
  const years = new Set();
  for (const list of collections || []) {
    for (const record of list || []) {
      const year = recordYear(record);
      if (year !== null) years.add(year);
    }
  }
  const current = normalizeYearSelection(currentYear);
  if (typeof current === 'number') years.add(current);
  const selected = normalizeYearSelection(selectedYear);
  if (typeof selected === 'number') years.add(selected);
  return [...years].sort((a, b) => b - a);
}

/** Opportunity count per type (Pliego / Oferta / Staffing / Sin tipo), in that order. */
export function opportunityTypeBreakdown(opportunities) {
  const counts = new Map(opportunityTypes.map((type) => [type.id, 0]));
  let missing = 0;
  for (const item of opportunities || []) {
    if (counts.has(item?.opportunityType)) counts.set(item.opportunityType, counts.get(item.opportunityType) + 1);
    else missing += 1;
  }
  return [
    ...opportunityTypes.map((type) => ({ id: type.id, label: type.label, tone: type.tone, count: counts.get(type.id) })),
    { id: MISSING_TYPE_BREAKDOWN_ID, label: MISSING_OPPORTUNITY_TYPE_LABEL, tone: 'gray', count: missing },
  ];
}

/**
 * Every KPI of the CRM QE page for one year (or ALL_YEARS), filtered by each record's
 * creation date. Archived opportunities never count; the "Oportunidades activas" card and its
 * type breakdown also leave out opportunities in Resultado. Initiatives use the shared
 * active-initiative predicate (completed and archived excluded).
 */
export function computePipelineKpis({ opportunities = [], initiatives = [], agreements = [], clients = [] } = {}, year = ALL_YEARS) {
  const yearOpportunities = filterByYear(opportunities, year).filter((item) => !item.archivedAt && !item.archived);
  const activeOpportunities = yearOpportunities.filter(isActiveOpportunity);
  return {
    activeClients: filterByYear(clients, year).filter((item) => item.active).length,
    activeInitiatives: filterByYear(initiatives, year).filter(isActiveInitiative).length,
    activeOpportunities: activeOpportunities.length,
    opportunityTypes: opportunityTypeBreakdown(activeOpportunities),
    activeAgreements: filterByYear(agreements, year).filter((item) => item.status === 'active').length,
    pipelineQe: computePipelineQe(yearOpportunities),
    weightedPipeline: computeWeightedPipeline(yearOpportunities),
  };
}
