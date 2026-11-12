import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { describeOpportunityType, filterOpportunityRecords, validateOpportunityResult, validateOpportunityType } from './opportunities.js';

describe('opportunity result rules', () => {
  const base = { stage: 'result', outcome: 'won', expectedCloseDate: '2026-06-01', closureReason: '' };

  test('non-result stages have no outcome requirements', () => {
    assert.equal(validateOpportunityResult({ stage: 'proposal', outcome: '', expectedCloseDate: '', closureReason: '' }), '');
  });

  test('result requires an outcome and an expected close date', () => {
    assert.match(validateOpportunityResult({ ...base, outcome: '' }), /resultado/);
    assert.match(validateOpportunityResult({ ...base, expectedCloseDate: '' }), /fecha estimada/);
  });

  test('won needs no closure reason, lost and discarded do', () => {
    assert.equal(validateOpportunityResult(base), '');
    assert.match(validateOpportunityResult({ ...base, outcome: 'lost' }), /motivo/);
    assert.match(validateOpportunityResult({ ...base, outcome: 'discarded', closureReason: '   ' }), /motivo/);
    assert.equal(validateOpportunityResult({ ...base, outcome: 'lost', closureReason: 'Precio' }), '');
  });
});

describe('opportunity archive filtering', () => {
  const active = [{ id: 'OP-1', title: 'Alpha', account: 'Acme' }];
  const archived = [{ id: 'OP-2', title: 'Beta', account: 'Globex', archivedByName: 'Lucía' }];

  test('selects the active or archived list by view', () => {
    assert.deepEqual(filterOpportunityRecords(active, archived, '', false).map((i) => i.id), ['OP-1']);
    assert.deepEqual(filterOpportunityRecords(active, archived, '', true).map((i) => i.id), ['OP-2']);
  });

  test('query matches case-insensitively, and the archiver only in the archived view', () => {
    assert.equal(filterOpportunityRecords(active, archived, 'GLOBEX', true).length, 1);
    assert.equal(filterOpportunityRecords(active, archived, 'lucía', true).length, 1);
    assert.equal(filterOpportunityRecords([{ ...active[0], archivedByName: 'Lucía' }], [], 'lucía', false).length, 0);
    assert.equal(filterOpportunityRecords(active, archived, 'nada', true).length, 0);
  });
});

describe('opportunity type', () => {
  test('known ids resolve to their Spanish label and tone', () => {
    assert.deepEqual(describeOpportunityType('tender'), { id: 'tender', label: 'Pliego', tone: 'amber', missing: false });
    assert.equal(describeOpportunityType('offer').label, 'Oferta');
    assert.equal(describeOpportunityType('staffing').label, 'Staffing');
  });

  test('legacy records without a type, or with an unknown value, show a muted "Sin tipo"', () => {
    for (const value of [undefined, null, '', 'Pliego']) {
      assert.deepEqual(describeOpportunityType(value), { id: '', label: 'Sin tipo', tone: 'gray', missing: true });
    }
  });

  test('validation requires one of the three ids', () => {
    for (const value of ['tender', 'offer', 'staffing']) assert.equal(validateOpportunityType(value), '');
    for (const value of ['', undefined, null, 'Oferta']) assert.match(validateOpportunityType(value), /tipo de oportunidad/);
  });
});
