import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildFixedQuotaPurchaseAdjustment,
    getPurchaseFinancials,
    isFixedQuotaPurchase,
} from './fixedQuotaPurchases.js';

test('removes SICAR VAT and keeps the supplier subtotal as the accounting total', () => {
    const result = buildFixedQuotaPurchaseAdjustment({
        amount: 1000,
        subtotal: 1000,
        subtotalExento: 0,
        subtotalGravado: 1000,
        iva: 150,
        total: 1150,
    }, '2026-09-10T12:00:00.000Z');

    assert.equal(result.amount, 1000);
    assert.equal(result.subtotal, 1000);
    assert.equal(result.subtotalExento, 1000);
    assert.equal(result.subtotalGravado, 0);
    assert.equal(result.iva, 0);
    assert.equal(result.total, 1000);
    assert.equal(result.fixedQuota, true);
    assert.equal(result.fixedQuotaOriginalFinancials.iva, 150);
});

test('derives a missing total and preserves the first SICAR snapshot', () => {
    const first = buildFixedQuotaPurchaseAdjustment({ subtotal: 250, iva: 37.5 }, 'first');
    const second = buildFixedQuotaPurchaseAdjustment(first, 'second');

    assert.equal(first.total, 250);
    assert.deepEqual(second.fixedQuotaOriginalFinancials, first.fixedQuotaOriginalFinancials);
    assert.equal(second.fixedQuotaAdjustedAt, 'second');
    assert.equal(isFixedQuotaPurchase(second), true);
    assert.deepEqual(getPurchaseFinancials(second), {
        amount: 250,
        subtotal: 250,
        subtotalExento: 250,
        subtotalGravado: 0,
        iva: 0,
        total: 250,
    });
});
