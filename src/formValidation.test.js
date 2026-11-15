import assert from 'node:assert/strict';
import test from 'node:test';
import { AGREEMENT_FORM_FIELDS, MASTER_FORM_FIELDS, OPPORTUNITY_FORM_FIELDS, clearFieldError, fieldErrorId, hasFieldErrors, mapServerFieldError, validateAgreementForm, validateInitiativeForm, validateMasterForm, validateOpportunityForm, validateServiceYearForm } from './formValidation.js';

const validOpportunity = {
  title: 'Modernización', opportunityType: 'offer', clientId: 'c1', stage: 'prospecting', qaPercent: 30, probability: '',
  origin: '', initiativeId: '', outcome: '', expectedCloseDate: '', closureReason: '',
};

test('a complete opportunity form has no errors', () => {
  assert.deepEqual(validateOpportunityForm(validOpportunity, { amountText: '125.000,00' }), {});
  assert.deepEqual(validateOpportunityForm(validOpportunity, { amountText: '0' }), {});
});

test('opportunity form reports every missing required field at once', () => {
  const errors = validateOpportunityForm({ ...validOpportunity, title: '   ', opportunityType: '' }, { amountText: '' });
  assert.deepEqual(Object.keys(errors), ['title', 'opportunityType', 'amount']);
  assert.equal(errors.title, 'Completa el nombre de la oportunidad.');
  assert.match(errors.opportunityType, /tipo de oportunidad/);
  assert.equal(errors.amount, 'Indica el importe estimado.');
});

test('opportunity form requires a client for Pliego and Oferta but not for Staffing', () => {
  for (const opportunityType of ['offer', 'tender']) {
    const errors = validateOpportunityForm({ ...validOpportunity, opportunityType, clientId: '' }, { amountText: '10' });
    assert.deepEqual(Object.keys(errors), ['clientId']);
    assert.match(errors.clientId, /cliente/);
  }
  assert.deepEqual(validateOpportunityForm({ ...validOpportunity, opportunityType: 'staffing', clientId: '' }, { amountText: '10' }), {});
  // Untouched legacy records without a client stay editable; switching their type does not.
  const legacy = { id: 'OP-1', opportunityType: 'offer', clientId: '' };
  assert.deepEqual(validateOpportunityForm({ ...validOpportunity, clientId: '' }, { amountText: '10', original: legacy }), {});
  const fromStaffing = { id: 'OP-2', opportunityType: 'staffing', clientId: '' };
  assert.ok(validateOpportunityForm({ ...validOpportunity, clientId: '' }, { amountText: '10', original: fromStaffing }).clientId);
});

test('opportunity form validates QA and probability ranges', () => {
  const errors = validateOpportunityForm({ ...validOpportunity, qaPercent: 120, probability: '-1' }, { amountText: '10' });
  assert.equal(errors.qaPercent, 'La participación QA debe estar entre 0 y 100 %.');
  assert.equal(errors.probability, 'La probabilidad debe estar entre 0 y 100 %.');
  assert.deepEqual(validateOpportunityForm({ ...validOpportunity, qaPercent: '', probability: '100' }, { amountText: '10' }), {});
  assert.equal(validateOpportunityForm({ ...validOpportunity, qaPercent: 'abc' }, { amountText: '10' }).qaPercent !== undefined, true);
});

test('opportunity form requires the source initiative for an internal-initiative origin', () => {
  const errors = validateOpportunityForm({ ...validOpportunity, origin: 'Iniciativa interna' }, { amountText: '10' });
  assert.match(errors.initiativeId, /iniciativa de origen/);
  const legacy = { id: 'OP-1', origin: 'Iniciativa interna', initiativeId: '' };
  assert.deepEqual(validateOpportunityForm({ ...validOpportunity, origin: 'Iniciativa interna' }, { amountText: '10', original: legacy }), {});
});

test('result stage requires outcome and close date, and a reason unless won', () => {
  const result = { ...validOpportunity, stage: 'result' };
  assert.deepEqual(Object.keys(validateOpportunityForm(result, { amountText: '10' })), ['expectedCloseDate', 'outcome']);
  const lost = validateOpportunityForm({ ...result, outcome: 'lost', expectedCloseDate: '2026-01-31' }, { amountText: '10' });
  assert.deepEqual(lost, { closureReason: 'Indica el motivo de pérdida o descarte.' });
  assert.deepEqual(validateOpportunityForm({ ...result, outcome: 'won', expectedCloseDate: '2026-01-31' }, { amountText: '10' }), {});
  assert.deepEqual(validateOpportunityForm({ ...result, outcome: 'discarded', expectedCloseDate: '2026-01-31', closureReason: 'Sin presupuesto' }, { amountText: '10' }), {});
});

test('initiative and agreement forms require a name', () => {
  assert.deepEqual(validateInitiativeForm({ title: ' ' }), { title: 'Indica el nombre de la iniciativa.' });
  assert.deepEqual(validateInitiativeForm({ title: 'Iniciativa' }), {});
  assert.deepEqual(validateAgreementForm({ title: '' }), { title: 'Indica el nombre del acuerdo marco.' });
  assert.deepEqual(validateAgreementForm({ title: 'Acuerdo' }), {});
});

test('master forms require a name; towers also need a responsible', () => {
  for (const kind of ['clients', 'services', 'lobs', 'people']) {
    assert.deepEqual(validateMasterForm(kind, { name: '' }), { name: 'Indica el nombre.' });
    assert.deepEqual(validateMasterForm(kind, { name: 'Registro', responsibleId: '' }), {});
  }
  assert.deepEqual(validateMasterForm('towers', { name: '', responsibleId: '' }), { name: 'Indica el nombre.', responsibleId: 'Selecciona un responsable para la tower.' });
  assert.deepEqual(validateMasterForm('towers', { name: 'Tower', responsibleId: 'p1' }), {});
});

test('service year form accepts integers between 2000 and 2100', () => {
  assert.deepEqual(validateServiceYearForm({ year: '' }), { year: 'Indica el año del ejercicio.' });
  for (const year of ['1999', '2101', '2026.5', 'abc']) assert.ok(validateServiceYearForm({ year }).year, year);
  assert.deepEqual(validateServiceYearForm({ year: '2026' }), {});
  assert.deepEqual(validateServiceYearForm({ year: 2000 }), {});
});

test('hasFieldErrors and clearFieldError manage the error map', () => {
  assert.equal(hasFieldErrors({}), false);
  assert.equal(hasFieldErrors(null), false);
  assert.equal(hasFieldErrors({ title: 'x' }), true);
  const errors = { title: 'x', amount: 'y' };
  assert.deepEqual(clearFieldError(errors, 'title'), { amount: 'y' });
  assert.deepEqual(errors, { title: 'x', amount: 'y' });
  assert.equal(clearFieldError(errors, 'missing'), errors);
});

test('mapServerFieldError maps API field errors that belong to the form', () => {
  assert.deepEqual(mapServerFieldError({ field: 'title', message: 'El campo "title" no puede estar vacío.' }, OPPORTUNITY_FORM_FIELDS), { title: 'El campo "title" no puede estar vacío.' });
  assert.deepEqual(mapServerFieldError({ field: 'expected_close_date', message: 'Fecha no válida.' }, OPPORTUNITY_FORM_FIELDS), { expectedCloseDate: 'Fecha no válida.' });
  assert.deepEqual(mapServerFieldError({ field: 'clientId', message: 'Selecciona el cliente.' }, OPPORTUNITY_FORM_FIELDS), { clientId: 'Selecciona el cliente.' });
  assert.deepEqual(mapServerFieldError({ field: 'next_action_date', message: 'Fecha no válida.' }, OPPORTUNITY_FORM_FIELDS), { nextActionDate: 'Fecha no válida.' });
  assert.deepEqual(mapServerFieldError({ field: 'responsibleId', message: 'Selecciona un responsable para la tower.' }, MASTER_FORM_FIELDS), { responsibleId: 'Selecciona un responsable para la tower.' });
  assert.deepEqual(mapServerFieldError({ field: 'amount', message: '' }, AGREEMENT_FORM_FIELDS), { amount: 'Revisa este campo.' });
});

test('mapServerFieldError returns null for errors without a known field', () => {
  assert.equal(mapServerFieldError({ message: 'Error' }, OPPORTUNITY_FORM_FIELDS), null);
  assert.equal(mapServerFieldError({ field: 'stage', message: 'Error' }, OPPORTUNITY_FORM_FIELDS), null);
  assert.equal(mapServerFieldError(null, OPPORTUNITY_FORM_FIELDS), null);
});

test('fieldErrorId builds a stable id per form and field', () => {
  assert.equal(fieldErrorId('form1', 'title'), 'form1-title-error');
});
