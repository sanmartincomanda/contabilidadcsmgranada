const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDailyRollup,
  buildDailyRollupFingerprint,
  buildTicketFingerprint,
} = require('./syncSicarTicketSales');

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
