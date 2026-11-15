// Pure rules of the opportunity classification, date and value fields, shared by the dialog
// (src/formValidation.js) and the API (server/app.js) so both reject the same input.
import { opportunityContractTypes, opportunityMarketScopes, opportunityServiceTypes } from './data.js';

export const AI_SCORE_MIN = 1;
export const AI_SCORE_MAX = 10;
export const REUSABLE_REASON_LIMIT = 2000;

const AI_SCORE_PATTERN = /^\d+(?:[.,]\d+)?$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written as 'YYYY-MM-DD' (rejects e.g. '2026-02-31'). */
export function isIsoDate(value) {
  const match = ISO_DATE_PATTERN.exec(String(value ?? ''));
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * "Scoring calificación IA": blank is null; a number or a decimal text with comma or dot
 * ("7,5", "7.25") becomes a number rounded to two decimals. Anything else is NaN. The range is
 * checked by `validateOpportunityFields`.
 */
export function parseAiScore(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : Number.NaN;
  if (typeof value !== 'string') return Number.NaN;
  const text = value.trim();
  if (text === '') return null;
  if (!AI_SCORE_PATTERN.test(text)) return Number.NaN;
  return Math.round(Number(text.replace(',', '.')) * 100) / 100;
}

/** Score shown in inputs and tables with a decimal comma ("7,5"); '' when there is none. */
export function formatAiScore(value) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '';
  return String(Number(value)).replace('.', ',');
}

function optionLabel(list, id) {
  return list.find((item) => item.id === id)?.label || '';
}

export const marketScopeLabel = (id) => optionLabel(opportunityMarketScopes, id);
export const contractTypeLabel = (id) => optionLabel(opportunityContractTypes, id);
export const serviceTypeLabel = (id) => optionLabel(opportunityServiceTypes, id);

const isPresent = (value) => value !== null && value !== undefined && value !== '';

/**
 * Cross-field rules of the opportunity dates, scoring, reuse and values. Amounts are numbers
 * (or null/undefined when empty), `aiScore` is the output of `parseAiScore`. Returns
 * `{ fieldId: message }` in form order; an empty object means valid.
 *
 * - "Fecha fin" cannot be earlier than "Fecha inicio" (checked when both are set).
 * - "Scoring calificación IA" is optional, between 1 and 10.
 * - "Reutilizable" needs a "Motivo" (at most 2000 characters).
 * - "Valor añadido" is never above "Importe"; "VA Servicios" is the professional-services part
 *   of the added value, so it is never above "Valor añadido" (checked when both are set).
 */
export function validateOpportunityFields({ startDate, endDate, aiScore, reusable, reusableReason, amount, addedValue, servicesAddedValue }) {
  const errors = {};
  if (startDate && endDate && endDate < startDate) errors.endDate = 'La fecha fin no puede ser anterior a la fecha inicio.';
  if (isPresent(aiScore) && !(aiScore >= AI_SCORE_MIN && aiScore <= AI_SCORE_MAX)) {
    errors.aiScore = `El scoring de calificación IA debe ser un número entre ${AI_SCORE_MIN} y ${AI_SCORE_MAX} (admite decimales).`;
  }
  const reason = String(reusableReason ?? '').trim();
  if (reusable && reason === '') errors.reusableReason = 'Indica el motivo por el que la oportunidad es reutilizable.';
  else if (reason.length > REUSABLE_REASON_LIMIT) errors.reusableReason = `El motivo no puede superar los ${REUSABLE_REASON_LIMIT} caracteres.`;
  if (isPresent(addedValue)) {
    if (!(Number(addedValue) >= 0)) errors.addedValue = 'El valor añadido debe ser igual o superior a cero.';
    else if (Number(addedValue) > Number(amount || 0)) errors.addedValue = 'El valor añadido no puede superar el importe.';
  }
  if (isPresent(servicesAddedValue)) {
    if (!(Number(servicesAddedValue) >= 0)) errors.servicesAddedValue = 'VA Servicios debe ser igual o superior a cero.';
    else if (isPresent(addedValue) && Number(servicesAddedValue) > Number(addedValue)) errors.servicesAddedValue = 'VA Servicios no puede superar el valor añadido.';
  }
  return errors;
}
