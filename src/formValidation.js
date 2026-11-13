import { parseAmount } from './money.js';
import { validateOpportunityType, validateOriginInitiative } from './opportunities.js';

/**
 * Per-form validators. Each returns `{ fieldId: message }` in form order; an empty object
 * means the form is valid. Messages are Spanish UI copy shown under each field.
 */

export const OPPORTUNITY_FORM_FIELDS = ['title', 'opportunityType', 'amount', 'initiativeId', 'probability', 'expectedCloseDate', 'qaPercent', 'outcome', 'closureReason'];
export const INITIATIVE_FORM_FIELDS = ['title'];
export const AGREEMENT_FORM_FIELDS = ['title', 'amount'];
export const MASTER_FORM_FIELDS = ['name', 'responsibleId'];
export const SERVICE_YEAR_FORM_FIELDS = ['year'];

const isBlank = (value) => String(value ?? '').trim() === '';

function inRange(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max;
}

/** Opportunity dialog. `amountText` is the formatted amount input; `original` the edited record. */
export function validateOpportunityForm(form, { amountText = '', original = {} } = {}) {
  const errors = {};
  if (isBlank(form.title)) errors.title = 'Completa el nombre de la oportunidad.';
  const typeError = validateOpportunityType(form.opportunityType);
  if (typeError) errors.opportunityType = typeError;
  if (!/\d/.test(String(amountText ?? ''))) errors.amount = 'Indica el importe estimado.';
  else if (!(parseAmount(amountText) >= 0)) errors.amount = 'El importe debe ser igual o superior a cero.';
  const originError = validateOriginInitiative(form, original);
  if (originError) errors.initiativeId = originError;
  if (!isBlank(form.probability) && !inRange(form.probability, 0, 100)) errors.probability = 'La probabilidad debe estar entre 0 y 100 %.';
  if (form.stage === 'result' && !form.expectedCloseDate) errors.expectedCloseDate = 'La etapa Resultado requiere una fecha estimada de cierre.';
  if (!inRange(isBlank(form.qaPercent) ? 0 : form.qaPercent, 0, 100)) errors.qaPercent = 'La participación QA debe estar entre 0 y 100 %.';
  if (form.stage === 'result') {
    if (!form.outcome) errors.outcome = 'Selecciona el resultado (Ganada, Perdida o Descartada).';
    else if (form.outcome !== 'won' && isBlank(form.closureReason)) errors.closureReason = 'Indica el motivo de pérdida o descarte.';
  }
  return errors;
}

export function validateInitiativeForm(form) {
  return isBlank(form.title) ? { title: 'Indica el nombre de la iniciativa.' } : {};
}

export function validateAgreementForm(form) {
  return isBlank(form.title) ? { title: 'Indica el nombre del acuerdo marco.' } : {};
}

/** Master data dialog (clients, towers, services, LoB, people). */
export function validateMasterForm(kind, values) {
  const errors = {};
  if (isBlank(values.name)) errors.name = 'Indica el nombre.';
  if (kind === 'towers' && isBlank(values.responsibleId)) errors.responsibleId = 'Selecciona un responsable para la tower.';
  return errors;
}

/** "Nuevo ejercicio": the year must be an integer between 2000 and 2100. */
export function validateServiceYearForm({ year }) {
  const text = String(year ?? '').trim();
  if (text === '') return { year: 'Indica el año del ejercicio.' };
  const number = Number(text);
  if (!Number.isInteger(number) || number < 2000 || number > 2100) return { year: 'El ejercicio debe ser un año entre 2000 y 2100.' };
  return {};
}

export function hasFieldErrors(errors) {
  return Boolean(errors) && Object.keys(errors).length > 0;
}

/** Removes one field's error (used when the user edits that field). Returns the same object when unchanged. */
export function clearFieldError(errors, field) {
  if (!errors || !Object.hasOwn(errors, field)) return errors;
  const next = { ...errors };
  delete next[field];
  return next;
}

/** Server column names the API may report, mapped to the form field ids. */
const SERVER_FIELD_ALIASES = {
  opportunity_type: 'opportunityType',
  qa_percent: 'qaPercent',
  initiative_id: 'initiativeId',
  expected_close_date: 'expectedCloseDate',
  closure_reason: 'closureReason',
  responsible_id: 'responsibleId',
};

/**
 * Maps an API validation error carrying a `field` to `{ fieldId: message }` when that field
 * belongs to the form; returns null otherwise (the caller shows a general form error).
 */
export function mapServerFieldError(error, formFields) {
  const raw = error?.field;
  if (typeof raw !== 'string' || raw === '') return null;
  const field = SERVER_FIELD_ALIASES[raw] || raw;
  if (!formFields.includes(field)) return null;
  return { [field]: error.message || 'Revisa este campo.' };
}

/** DOM id of a field's error text, linked from the control through `aria-describedby`. */
export function fieldErrorId(formId, field) {
  return `${formId}-${field}-error`;
}
