import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyOriginChange, describeOpportunityOutcome, describeOpportunityType, filterOpportunityRecords, originInitiativeOptions, requiresOriginInitiative, validateOpportunityResult, validateOpportunityType, validateOriginInitiative } from './opportunities.js';

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

  test('query matches the external registry id in both views', () => {
    const withRegistry = [{ ...active[0], registryId: 'LIC-2026/15' }];
    assert.deepEqual(filterOpportunityRecords(withRegistry, [], 'lic-2026', false).map((i) => i.id), ['OP-1']);
    assert.equal(filterOpportunityRecords([], [{ ...archived[0], registryId: 'ERP-9' }], 'erp-9', true).length, 1);
    assert.equal(filterOpportunityRecords(active, [], 'lic-2026', false).length, 0);
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

describe('origin initiative rules', () => {
  test('only Iniciativa interna requires a source initiative', () => {
    assert.equal(requiresOriginInitiative('Iniciativa interna'), true);
    assert.equal(requiresOriginInitiative('Cliente existente'), false);
    assert.equal(requiresOriginInitiative(''), false);
  });

  test('changing the origin away clears the link, keeping it otherwise', () => {
    const form = { origin: 'Iniciativa interna', initiativeId: 'IN-0001', title: 'X' };
    assert.deepEqual(applyOriginChange(form, 'Otros'), { origin: 'Otros', initiativeId: '', title: 'X' });
    assert.equal(applyOriginChange(form, 'Iniciativa interna').initiativeId, 'IN-0001');
  });

  test('new or changed internal origins need an initiative; untouched legacy records pass', () => {
    assert.match(validateOriginInitiative({ origin: 'Iniciativa interna', initiativeId: '' }), /iniciativa de origen/);
    assert.equal(validateOriginInitiative({ origin: 'Iniciativa interna', initiativeId: 'IN-0001' }), '');
    assert.equal(validateOriginInitiative({ origin: 'Otros', initiativeId: '' }), '');
    const legacy = { id: 'OP-1', origin: 'Iniciativa interna', initiativeId: '' };
    assert.equal(validateOriginInitiative({ origin: 'Iniciativa interna', initiativeId: '' }, legacy), '');
    const linked = { id: 'OP-2', origin: 'Iniciativa interna', initiativeId: 'IN-0001' };
    assert.match(validateOriginInitiative({ origin: 'Iniciativa interna', initiativeId: '' }, linked), /iniciativa de origen/);
    const otherOrigin = { id: 'OP-3', origin: 'Otros', initiativeId: '' };
    assert.match(validateOriginInitiative({ origin: 'Iniciativa interna', initiativeId: '' }, otherOrigin), /iniciativa de origen/);
  });

  test('options exclude archived initiatives except the current link', () => {
    const list = [{ id: 'IN-1' }, { id: 'IN-2', archivedAt: '2026-01-01' }, { id: 'IN-3', archivedAt: '2026-01-02' }];
    assert.deepEqual(originInitiativeOptions(list).map((item) => item.id), ['IN-1']);
    assert.deepEqual(originInitiativeOptions(list, 'IN-2').map((item) => item.id), ['IN-1', 'IN-2']);
  });
});

describe('describeOpportunityOutcome', () => {
  test('maps outcome ids and labels to their display label', () => {
    assert.deepEqual(describeOpportunityOutcome('won'), { label: 'Ganada', tone: 'green' });
    assert.deepEqual(describeOpportunityOutcome('Perdida'), { label: 'Perdida', tone: 'gray' });
  });

  test('returns null when there is no outcome', () => {
    assert.equal(describeOpportunityOutcome(''), null);
    assert.equal(describeOpportunityOutcome(null), null);
  });
});
