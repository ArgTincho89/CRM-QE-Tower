import { opportunityTypes } from './data.js';

/** Searchable text for the opportunity management table; archived view also searches the archiver. */
export function matchesOpportunityQuery(item, query, archivedView = false) {
  const parts = [item.id, item.number, item.registryId, item.title, item.account, item.tower, item.owner, item.bidManager, item.due, item.closureReason];
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

export const MISSING_OPPORTUNITY_TYPE_LABEL = 'Sin tipo';

/**
 * Display data for an opportunity type id. Legacy records (no type, or an unknown value)
 * resolve to a muted "Sin tipo" descriptor so the UI never shows a raw id.
 */
export function describeOpportunityType(id) {
  const type = opportunityTypes.find((item) => item.id === id);
  if (!type) return { id: '', label: MISSING_OPPORTUNITY_TYPE_LABEL, tone: 'gray', missing: true };
  return { id: type.id, label: type.label, tone: type.tone, missing: false };
}

/** Returns a Spanish error message, or '' when the type is one of the allowed ids. */
export function validateOpportunityType(value) {
  return opportunityTypes.some((item) => item.id === value)
    ? ''
    : 'Selecciona el tipo de oportunidad (Pliego, Oferta o Staffing).';
}

export const INTERNAL_INITIATIVE_ORIGIN = 'Iniciativa interna';

/** Only the internal-initiative origin links an opportunity to its source initiative. */
export function requiresOriginInitiative(origin) {
  return origin === INTERNAL_INITIATIVE_ORIGIN;
}

/** Changing the origin away from an internal initiative drops the initiative link. */
export function applyOriginChange(form, origin) {
  return { ...form, origin, initiativeId: requiresOriginInitiative(origin) ? form.initiativeId : '' };
}

/**
 * Mirrors the API rule: an internal-initiative origin needs a linked initiative whenever the
 * origin or link is set or changed. Untouched legacy records (same origin, still unlinked) pass.
 * Returns a Spanish error message, or '' when valid.
 */
export function validateOriginInitiative(form, original = {}) {
  if (!requiresOriginInitiative(form.origin) || form.initiativeId) return '';
  const untouchedLegacy = Boolean(original.id) && original.origin === form.origin && !original.initiativeId;
  return untouchedLegacy ? '' : 'Selecciona la iniciativa de origen para el origen «Iniciativa interna».';
}

/** Selectable source initiatives: non-archived ones, plus the current link even if archived. */
export function originInitiativeOptions(initiatives, currentId = '') {
  return (initiatives || []).filter((item) => !item.archivedAt || item.id === currentId);
}
