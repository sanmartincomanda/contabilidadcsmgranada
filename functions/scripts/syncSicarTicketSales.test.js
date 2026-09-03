const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDailyRollup,
  buildDailyRollupFingerprint,
  buildTicketFingerprint,
  getSourceDocument,
  parsePositiveIds,
} = require('./syncSicarTicketSales');
const {
  buildSicarCreditReceiptFingerprint,
  getCreditReceiptGroupKey,
} = require('./syncSicarCreditReceipts');
const {
  buildCancellationMarker,
  findChangedCancellationMarkers,
} = require('./watchSicarTicketSales');

test('daily ticket rollup excludes cancelled sales and sums fiscal values', () => {
  const rollup = buildDailyRollup([
    {
      id: 'ticket-1',
      saleId: 1,
      status: 'active',
      isCancelled: false,
      subtotal: 100,
      subtotalExento: 40,
      total: 109,
      discount: 5,
      purchaseTotal: 70,
      grossProfitTotal: 39,
      itemCount: 2,
      paymentBreakdown: [{ method: 'Efectivo', amount: 109 }],
    },
    {
      id: 'ticket-2',
      saleId: 2,
      status: 'cancelled',
      isCancelled: true,
      subtotal: 500,
      subtotalExento: 0,
      total: 575,
      itemCount: 1,
      paymentBreakdown: [{ method: 'Tarjeta', amount: 575 }],
    },
  ], '2026-09-02');

  assert.equal(rollup.ticketCount, 1);
  assert.equal(rollup.cancelledTicketCount, 1);
  assert.equal(rollup.subtotal, 100);
  assert.equal(rollup.subtotalExento, 40);
  assert.equal(rollup.subtotalGravado, 60);
  assert.equal(rollup.iva, 9);
  assert.equal(rollup.total, 109);
  assert.deepEqual(rollup.sourceRecordIds, ['1']);
  assert.deepEqual(rollup.paymentBreakdown, [{ method: 'Efectivo', total: 109 }]);
});

test('fingerprints are stable when object key order changes', () => {
  const first = buildTicketFingerprint({
    saleId: 10,
    total: 25,
    items: [{ code: 'A', quantity: 1 }],
    paymentBreakdown: [{ method: 'Efectivo', amount: 25 }],
  });
  const second = buildTicketFingerprint({
    paymentBreakdown: [{ amount: 25, method: 'Efectivo' }],
    items: [{ quantity: 1, code: 'A' }],
    total: 25,
    saleId: 10,
  });

  assert.equal(first, second);
  assert.equal(
    buildDailyRollupFingerprint({ total: 10, ticketCount: 1 }),
    buildDailyRollupFingerprint({ ticketCount: 1, total: 10 })
  );
});

test('detects only new or changed SICAR cancellation markers', () => {
  const first = buildCancellationMarker({
    ven_id: 100,
    status: -1,
    can_caj_id: 2,
    can_rcc_id: null,
  });
  const updated = buildCancellationMarker({
    ven_id: 101,
    status: -1,
    can_caj_id: 3,
    can_rcc_id: 7250,
  });

  assert.deepEqual(first, { saleId: 100, signature: '-1|2|' });
  assert.deepEqual(
    findChangedCancellationMarkers([first, updated], { 100: '-1|2|' }),
    [updated]
  );
});

test('identifies the real SICAR source document without losing its ticket', () => {
  assert.deepEqual(getSourceDocument({
    ven_id: 88,
    tic_id: 77,
    invoiceFacId: 15,
    invoiceNumbers: 'A10788',
  }), {
    sourceDocumentType: 'factura',
    sourceDocumentId: 15,
    sourceDocumentNumber: 'A10788',
    sourceDocumentNumbers: ['A10788'],
  });
  assert.equal(getCreditReceiptGroupKey({ acl_id: 20, acp_id: 8 }), 'p_8');
  assert.equal(getCreditReceiptGroupKey({ acl_id: 20, acp_id: null }), 'a_20');
});

test('credit receipt fingerprints include applications and cancellation state', () => {
  const active = buildSicarCreditReceiptFingerprint({
    amount: 100,
    status: 'active',
    applications: [{ sicarCreditId: 1, appliedAmount: 100 }],
  });
  const cancelled = buildSicarCreditReceiptFingerprint({
    amount: 0,
    status: 'cancelled',
    applications: [{ sicarCreditId: 1, appliedAmount: 100, isCancelled: true }],
  });
  assert.notEqual(active, cancelled);
});

test('empty SICAR credit identifiers never turn into a fake credit id zero', () => {
  assert.deepEqual(parsePositiveIds(''), []);
  assert.deepEqual(parsePositiveIds('0, 12, , 18'), [12, 18]);
});
