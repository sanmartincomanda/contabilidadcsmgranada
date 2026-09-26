const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDirectCandidate,
  buildPayablePaymentCandidate,
  buildPayablePaymentCandidates,
  buildProviderIndex,
  deduplicatePaymentReflections,
  reconcileCandidates,
  resolvePaymentAccountCode,
} = require('./bacSupplierPayroll');

const providers = [{
  id: 'industrial',
  nombre: 'INDUSTRIAL COMERCIAL SAN MARTIN,S.A',
  legalName: 'INDUSTRIAL COMERCIAL SAN MARTIN,S.A',
  aliases: ['Industrial Comercial San Martin'],
  active: true,
  bacPaymentPlans: {
    AR19: {
      references: [{ reference: 'J0310000005680', bankAccount: '001234567', beneficiaryName: 'INDUSTRIAL COMERCIAL SAN MARTIN,S.A' }],
    },
  },
}, {
  id: 'industrial_viejo',
  nombre: 'INDUSTRIAL COMERCIAL SAN MARTIN',
  active: false,
  mergedInto: 'industrial',
}];

test('resuelve aliases y redirecciones al proveedor canonico', () => {
  const index = buildProviderIndex(providers);
  assert.equal(index.resolve('industrial_viejo', '').id, 'industrial');
  assert.equal(index.resolve('', 'Industrial Comercial San Martin').id, 'industrial');
  assert.equal(index.resolve('', 'Industrial Comercial San Martin').references.length, 1);
});

test('solo la transferencia BAC principal se vincula con 1102101', () => {
  assert.equal(resolvePaymentAccountCode({ paymentType: 'TRANSFERENCIA' }), '1102101');
  assert.equal(resolvePaymentAccountCode({ paymentMethod: 'TRANSFERENCIA BAC' }), '1102101');
  assert.equal(resolvePaymentAccountCode({ paymentAccountCode: '1102106', paymentType: 'TRANSFERENCIA' }), '1102106');
  assert.equal(resolvePaymentAccountCode({ paymentType: 'EFECTIVO' }), '');
});

test('compra de contado usa monto neto despues de retenciones', () => {
  const candidate = buildDirectCandidate({
    collectionName: 'compras',
    id: 'compra-1',
    providerIndex: buildProviderIndex(providers),
    record: {
      date: '2026-09-25',
      branchId: 'granada',
      supplier: 'Industrial Comercial San Martin',
      paymentAccountCode: '1102101',
      paymentType: 'TRANSFERENCIA',
      invoiceNumber: 'F-100',
      total: 1000,
      retentionIr2: 20,
      retentionMunicipal1: 10,
    },
  });
  assert.equal(candidate.grossAmount, 1000);
  assert.equal(candidate.retentionAmount, 30);
  assert.equal(candidate.netAmount, 970);
  assert.equal(candidate.selectable, true);
});

test('abono parcial o multifactura conserva el efectivo realmente pagado', () => {
  const candidates = buildPayablePaymentCandidates({
    id: 'abono-1',
    providerIndex: buildProviderIndex(providers),
    payablesById: new Map([
      ['p1', { numero: 'F-1' }],
      ['p2', { numero: 'F-2' }],
    ]),
    record: {
      fecha: '2026-09-25',
      branchId: 'nindiri',
      proveedorId: 'industrial_viejo',
      paymentMethod: 'TRANSFERENCIA',
      montoTotal: 125.55,
      detalleAfectado: [{ id: 'p1', montoAbonado: 100 }, { id: 'p2', montoAbonado: 25.55 }],
    },
  });
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((candidate) => candidate.netAmount), [100, 25.55]);
  assert.deepEqual(candidates.map((candidate) => candidate.invoiceNumber), ['F-1', 'F-2']);
  assert.equal(candidates.reduce((sum, candidate) => sum + candidate.netAmount, 0), 125.55);
  assert.equal(candidates[0].branchId, 'nindiri');
  assert.equal(buildPayablePaymentCandidate({
    id: 'abono-1',
    providerIndex: buildProviderIndex(providers),
    payablesById: new Map([['p1', { numero: 'F-1' }]]),
    record: {
      fecha: '2026-09-25', proveedorId: 'industrial', paymentMethod: 'TRANSFERENCIA',
      montoTotal: 100, detalleAfectado: [{ id: 'p1', montoAbonado: 100 }],
    },
  }).invoiceNumber, 'F-1');
});

test('concilia cada aplicacion contra una sola salida bancaria del abono', () => {
  const candidates = buildPayablePaymentCandidates({
    id: 'abono-2',
    providerIndex: buildProviderIndex(providers),
    payablesById: new Map([['p1', { numero: 'F-1' }], ['p2', { numero: 'F-2' }]]),
    record: {
      fecha: '2026-09-25', proveedorId: 'industrial', paymentMethod: 'TRANSFERENCIA',
      montoTotal: 125.55,
      detalleAfectado: [{ id: 'p1', montoAbonado: 100 }, { id: 'p2', montoAbonado: 25.55 }],
    },
  });
  const reconciled = reconcileCandidates(candidates, new Map([[
    'abonos_pagar_abono-2',
    { status: 'posted', lines: [{ accountCode: '1102101', debit: 0, credit: 125.55 }] },
  ]]));
  assert.equal(reconciled.length, 2);
  assert.equal(reconciled.every((candidate) => candidate.reconciled && candidate.selectable), true);
});

test('agrupa reflejos enlazados y bloquea importes contradictorios', () => {
  const index = buildProviderIndex(providers);
  const base = {
    date: '2026-09-25', supplier: 'Industrial Comercial San Martin', paymentType: 'TRANSFERENCIA',
    sourceGastoDiarioId: 'mov-1', total: 100,
  };
  const matching = deduplicatePaymentReflections([
    buildDirectCandidate({ collectionName: 'compras', id: 'c1', providerIndex: index, record: base }),
    buildDirectCandidate({ collectionName: 'gastos', id: 'g1', providerIndex: index, record: base }),
  ]);
  assert.equal(matching.length, 1);
  assert.equal(matching[0].mirrorSources.length, 2);

  const conflict = deduplicatePaymentReflections([
    buildDirectCandidate({ collectionName: 'compras', id: 'c1', providerIndex: index, record: base }),
    buildDirectCandidate({ collectionName: 'gastos', id: 'g1', providerIndex: index, record: { ...base, total: 90 } }),
  ]);
  assert.equal(conflict.length, 1);
  assert.equal(conflict[0].mirrorConflict, true);
  assert.equal(conflict[0].selectable, false);
});

test('excluye credito, otra cuenta BAC y anulaciones', () => {
  const index = buildProviderIndex(providers);
  const base = { date: '2026-09-25', supplier: 'Industrial Comercial San Martin', total: 100 };
  assert.equal(buildDirectCandidate({ collectionName: 'compras', id: '1', providerIndex: index, record: { ...base, paymentType: 'CREDITO' } }), null);
  assert.equal(buildDirectCandidate({ collectionName: 'compras', id: '2', providerIndex: index, record: { ...base, paymentAccountCode: '1102106' } }), null);
  assert.equal(buildDirectCandidate({ collectionName: 'gastos', id: '3', providerIndex: index, record: { ...base, paymentType: 'TRANSFERENCIA', estado: 'ANULADO' } }), null);
});
