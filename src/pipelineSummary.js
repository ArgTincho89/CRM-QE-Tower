import { parseAmount } from './money.js';

function isActive(opportunity) {
  return !opportunity.archivedAt && !opportunity.archived;
}

/**
 * Pipeline QE = sum of amount x QA participation / 100 over active (non-archived)
 * Opportunities. Initiatives never contribute, and view filters are not applied
 * by callers: the KPI is global.
 */
export function computePipelineQe(opportunities) {
  return (opportunities || []).filter(isActive).reduce((total, item) => total + computeQeAmount(item), 0);
}

/** QE amount for one Opportunity: estimated amount x QA participation / 100. */
export function computeQeAmount(opportunity) {
  const qaPercent = Number(opportunity.qaPercent) || 0;
  return (parseAmount(opportunity.amount) * qaPercent) / 100;
}

/**
 * Probability-weighted amount for one Opportunity: QE amount x probability / 100,
 * or null when no probability exists.
 */
export function computeWeightedAmount(opportunity) {
  const { probability } = opportunity;
  if (probability === null || probability === undefined || probability === '') return null;
  const numeric = Number(probability);
  if (Number.isNaN(numeric)) return null;
  return (computeQeAmount(opportunity) * numeric) / 100;
}

/**
 * Separate metric: sum of weighted amounts over active Opportunities that have a
 * probability. Returns null when none has one. Never added to Pipeline QE.
 */
export function computeWeightedPipeline(opportunities) {
  let total = null;
  for (const item of (opportunities || []).filter(isActive)) {
    const weighted = computeWeightedAmount(item);
    if (weighted !== null) total = (total ?? 0) + weighted;
  }
  return total;
}
