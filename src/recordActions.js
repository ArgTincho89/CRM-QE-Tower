// Pure helpers for "Notas y acciones" (record actions) shared by the server and the UI.
import { isIsoDate } from './opportunityFields.js';

/** Entity types that own record actions, keyed by their API path segment. */
export const RECORD_ACTION_ENTITY_TYPES = Object.freeze({ opportunities: 'opportunity', initiatives: 'initiative', agreements: 'agreement' });

/** True for a pending action (not a note, not completed) with a valid ISO due date. */
export function isScheduledPendingAction(action) {
  return Boolean(action) && action.kind === 'action' && action.status === 'pending' && isIsoDate(String(action.dueDate ?? '').trim());
}

/**
 * Earliest due date among the pending, dated actions of a record, or '' when there is none.
 * Overdue dates count too: the earliest pending date is the most urgent one, so it wins.
 */
export function earliestPendingDueDate(actions) {
  let earliest = '';
  for (const action of actions || []) {
    if (!isScheduledPendingAction(action)) continue;
    const date = String(action.dueDate).trim();
    if (!earliest || date < earliest) earliest = date;
  }
  return earliest;
}

/**
 * "Fecha próxima acción" of a record: the earliest pending due date of its actions (see
 * `earliestPendingDueDate`), or `currentValue` (the manually entered date) when no pending action
 * has a due date.
 */
export function deriveNextActionDate(actions, currentValue = '') {
  return earliestPendingDueDate(actions) || (currentValue ?? '');
}

/** "Acción: <texto truncado>" for calendar labels; `limit` counts characters of the text. */
export function truncateActionText(text, limit = 40) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1).trimEnd()}…`;
}
