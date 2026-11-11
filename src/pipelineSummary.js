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
  return (opportunities || []).filter(isActive).reduce((total, item) => {
    const qaPercent = Number(item.qaPercent) || 0;
    return total + (parseAmount(item.amount) * qaPercent) / 100;
  }, 0);
}

/** Probability-weighted amount for one Opportunity, or null when no probability exists. */
export function computeWeightedAmount(opportunity) {
  const { probability } = opportunity;
  if (probability === null || probability === undefined || probability === '') return null;
  const numeric = Number(probability);
  if (Number.isNaN(numeric)) return null;
  return (parseAmount(opportunity.amount) * numeric) / 100;
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
