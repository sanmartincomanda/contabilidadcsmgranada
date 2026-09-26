const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildImportPlan,
  parseBacCsv,
  validateCatalog,
} = require('./importBacSupplierReferences');

const csv = Buffer.from([
  'Consulta',
  '25/09/2026,"04:53:49 PM"',
  '',
  '"Referencia","Cta. Bancaria","A nombre","Fecha de Ingreso","Tipo de Cuenta","E-mail","Tipo de Cliente","Tipo de Identificacion","Identificacion"',
  '"REF01","000000001","BIMBO DE NICARAGUA SOCIEDAD ANONIMA","25/09/2026"," "," "," "," "," "',
  '"REF02","000000002","LUIS MANUEL SAENZ ROBLERO","25/09/2026"," "," "," "," "," "',
].join('\r\n'), 'latin1');

test('parsea referencias y cuentas como texto con ceros iniciales', () => {
  const rows = parseBacCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].bankAccount, '000000001');
  assert.equal(rows[0].reference, 'REF01');
  assert.equal(rows[0].identification, '');
});

test('unifica solo alias confirmado y conserva multiples referencias', () => {
  const rows = [
    { reference: 'REF01', bankAccount: '000000001', legalName: 'BIMBO DE NICARAGUA SOCIEDAD ANONIMA', enrolledAt: '', identification: '' },
    { reference: 'REF02', bankAccount: '000000002', legalName: 'BIMBO DE NICARAGUA SOCIEDAD ANONIMA', enrolledAt: '', identification: '' },
  ];
  const providers = [
    { id: 'bimbo', nombre: 'BIMBO', active: true },
    { id: 'otro', nombre: 'PROVEEDOR PARECIDO BIMBO', active: true },
  ];
  const plan = buildImportPlan(rows, providers);
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.actions[0].canonicalId, 'bimbo');
  assert.equal(plan.actions[0].references.length, 2);
  assert.equal(plan.actions[0].matches.length, 1);
});

test('detiene RUC contradictorio en duplicados confirmados', () => {
  const rows = [{ reference: 'REF01', bankAccount: '000000001', legalName: 'INDUSTRIAL COMERCIAL SAN MARTIN,S.A', enrolledAt: '', identification: '' }];
  const providers = [
    { id: 'uno', nombre: 'INDUSTRIAL COMERCIAL SAN MARTIN', ruc: 'J0310000005680' },
    { id: 'dos', nombre: 'INDUSTRIAL COMERCIAL SAN MARTIN S.A', ruc: 'RUC-DIFERENTE' },
  ];
  const plan = buildImportPlan(rows, providers);
  assert.ok(plan.conflicts.length >= 1);
});

test('valida conteos revisados antes de escribir', () => {
  assert.throws(() => validateCatalog(parseBacCsv(csv)), /se esperaban 58 y 55/);
});
