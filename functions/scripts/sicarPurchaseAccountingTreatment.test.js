const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applySupplierTaxTreatment,
  buildSupplierTaxAccountingPayload,
} = require('./sicarPurchaseAccountingTreatment');

const sicarPurchase = {
  amount: 25590,
  subtotal: 25590,
  subtotalExento: 0,
  subtotalGravado: 25590,
  iva: 3838.5,
  total: 29428.5,
};

test('cuota fija conserva los importes SICAR pero excluye el IVA de contabilidad', () => {
  const accountingPayload = buildSupplierTaxAccountingPayload(sicarPurchase, {
    supplierTaxRegime: 'fixed-quota',
    excludeRecoverableVat: true,
    accountingSubtotal: 25590,
    accountingTaxTotal: 0,
    accountingTotal: 25590,
    sicarSubtotal: 25590,
    sicarTaxTotal: 3838.5,
    sicarTotal: 29428.5,
  });
  const treated = applySupplierTaxTreatment(sicarPurchase, accountingPayload);

  assert.equal(treated.subtotal, 25590);
  assert.equal(treated.subtotalGravado, 25590);
  assert.equal(treated.iva, 0);
  assert.equal(treated.total, 25590);
  assert.equal(treated.accountingPayload.ivaAcreditable, 0);
  assert.equal(treated.accountingPayload.sicarTaxTotal, 3838.5);
  assert.equal(treated.accountingPayload.sicarTotal, 29428.5);
});

test('una compra general no cambia sus importes', () => {
  const accountingPayload = buildSupplierTaxAccountingPayload(sicarPurchase, {});
  const treated = applySupplierTaxTreatment(sicarPurchase, accountingPayload);

  assert.equal(treated.iva, 3838.5);
  assert.equal(treated.total, 29428.5);
});

test('cuota fija rechaza un total contable que incluya IVA', () => {
  assert.throws(() => buildSupplierTaxAccountingPayload(sicarPurchase, {
    supplierTaxRegime: 'fixed-quota',
    excludeRecoverableVat: true,
    accountingSubtotal: 25590,
    accountingTotal: 29428.5,
  }), /total contable/);
});
