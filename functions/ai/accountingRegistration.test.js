const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRegistrationPayloads, registrationDedupeKey } = require('./accountingRegistration');

const Timestamp = { now: () => 'NOW' };
const draft = (overrides = {}) => ({
  id: 'wamid.test-123',
  messageId: 'wamid.test-123',
  tipoRegistro: 'gasto',
  branchId: 'granada',
  fecha: '2026-08-19',
  vencimiento: null,
  providerId: 'provider-1',
  providerCode: 'PRV-001',
  proveedor: 'PROVEEDOR PRUEBA',
  rucProveedor: 'J0310000000001',
  numeroFactura: 'F-100',
  descripcion: 'PAPELERIA',
  categoria: 'Gastos administrativos',
  subcategoria: 'Papeleria y utiles',
  accountingAccountId: '5',
  accountingAccountCode: '5',
  accountingAccountName: 'COSTOS Y GASTOS',
  accountingAccountType: 'Gastos',
  metodoPago: 'TRANSFERENCIA',
  referenciaPago: 'REF-1',
  subtotal: 100,
  iva: 15,
  total: 115,
  retencionIr2: 0,
  retencionMunicipal1: 0,
  totalRetenciones: 0,
  pagoNeto: 115,
  supportHash: 'hash-1',
  supportFiles: [{ type: 'invoice', path: 'whatsapp/test.jpg', url: 'https://example.test/file' }],
  ...overrides,
});

const build = (value) => buildRegistrationPayloads(value, { Timestamp, actorEmail: 'tester@example.com' });

test('transferencia crea solamente el gasto y el asiento', () => {
  const result = build(draft());
  assert.equal(result.sourceCollection, 'gastos');
  assert.equal(result.payable, null);
  assert.equal(result.cashRecord, null);
  assert.equal(result.record.paymentType, 'TRANSFERENCIA');
  assert.equal(result.accountingEntry.status, 'posted');
});

test('crédito crea CxP enlazada al registro principal', () => {
  const result = build(draft({ metodoPago: 'CREDITO', vencimiento: '2026-09-19' }));
  assert.equal(result.record.linkedPayableId, result.payableId);
  assert.equal(result.payable.linkedExpenseId, result.recordId);
  assert.equal(result.payable.saldo, 115);
});

test('compra a crédito queda enlazada como compra y costo de inventario', () => {
  const result = build(draft({
    tipoRegistro: 'compra',
    metodoPago: 'CREDITO',
    vencimiento: '2026-09-19',
    categoria: 'Costos de venta / compras',
    subcategoria: 'Compra de pollo',
    accountingAccountId: '11060',
    accountingAccountCode: '11060',
    accountingAccountName: 'INVENTARIO:Alimentos',
    accountingAccountType: 'Activos corrientes',
  }));
  assert.equal(result.sourceCollection, 'compras');
  assert.equal(result.payable.linkedPurchaseId, result.recordId);
  assert.equal(result.payable.isInventoryCost, true);
});

test('efectivo descuenta Caja Chica por pago neto después de retenciones', () => {
  const result = build(draft({
    metodoPago: 'EFECTIVO',
    retencionIr2: 2,
    retencionMunicipal1: 1,
    totalRetenciones: 3,
    pagoNeto: 112,
  }));
  assert.equal(result.cashRecord.monto, 115);
  assert.equal(result.pettyMovement.amount, 112);
  assert.equal(result.pettyMovement.signedAmount, -112);
  assert.equal(result.accountingEntry.status, 'posted');
});

test('soporte original se referencia sin duplicar el archivo', () => {
  const result = build(draft());
  assert.equal(result.record.fotoFacturaPath, 'whatsapp/test.jpg');
  assert.equal(result.record.supportFiles.length, 1);
});

test('clave de idempotencia es estable y cambia con el total', () => {
  assert.equal(registrationDedupeKey(draft()), registrationDedupeKey(draft()));
  assert.notEqual(registrationDedupeKey(draft()), registrationDedupeKey(draft({ total: 116 })));
});
