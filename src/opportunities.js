/** Searchable text for the opportunity management table; archived view also searches the archiver. */
export function matchesOpportunityQuery(item, query, archivedView = false) {
  const parts = [item.id, item.number, item.title, item.account, item.tower, item.owner, item.bidManager, item.due, item.closureReason];
  if (archivedView) parts.push(item.archivedByName);
  return parts.join(' ').toLowerCase().includes(String(query || '').trim().toLowerCase());
}

export function filterOpportunityRecords(active, archived, query, archivedView) {
  return (archivedView ? archived : active).filter((item) => matchesOpportunityQuery(item, query, archivedView));
}

/**
 * Result-stage rules. Returns a Spanish error message, or '' when the form is valid.
 * Outcome and expected close date are required in `result`; non-won outcomes need a closure reason.
 */
export function validateOpportunityResult({ stage, outcome, expectedCloseDate, closureReason }) {
  if (stage !== 'result') return '';
  if (!outcome) return 'Selecciona el resultado (Ganada, Perdida o Descartada).';
  if (!expectedCloseDate) return 'La etapa Resultado requiere una fecha estimada de cierre.';
  if (outcome !== 'won' && !String(closureReason || '').trim()) return 'Indica el motivo de pérdida o descarte.';
  return '';
}
