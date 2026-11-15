// Pure helpers of the "Informes" page.
import { opportunityOutcomes } from './data.js';

/** Outcome columns of the monthly table, as [outcome id, plural Spanish label]. */
export const reportOutcomeColumns = opportunityOutcomes.map((outcome) => [outcome.id, `${outcome.label}s`]);

/**
 * Counts of open (no outcome) and closed opportunities per outcome. Archived opportunities are
 * left out, as in every CRM QE metric.
 */
export function summarizeOpportunityOutcomes(opportunities) {
  const summary = { open: 0, ...Object.fromEntries(opportunityOutcomes.map((outcome) => [outcome.id, 0])) };
  for (const item of opportunities || []) {
    if (!item || item.archivedAt || item.archived) continue;
    if (!item.outcome) summary.open += 1;
    else if (Object.hasOwn(summary, item.outcome)) summary[item.outcome] += 1;
  }
  return summary;
}

/** Inclusive ISO date range ('YYYY-MM-DD') of a 'YYYY-MM' period, for date filters. */
export function monthFilterRange(period) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
  if (!match) return { from: '', to: '' };
  const lastDay = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(lastDay).padStart(2, '0')}` };
}
