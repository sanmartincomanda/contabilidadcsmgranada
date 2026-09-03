import test from 'node:test';
import assert from 'node:assert/strict';
import {
    OTHER_INCOME_ENTRY_TYPE,
    PURCHASE_DISCOUNT_ADJUSTMENT_TYPE,
    resolveReportIncomeEntries,
} from './incomeAggregation.js';

const entry = (overrides = {}) => ({
    date: '2026-09-03',
    branchId: 'granada',
    amount: 100,
    subtotal: 100,
    total: 100,
    ...overrides,
});

test('uses only ticket sales after cutover while preserving other manual income', () => {
    const result = resolveReportIncomeEntries([
        entry({ id: 'daily', source: 'sicar', sourceType: 'daily_sale', amount: 900 }),
        entry({ id: 'tickets', source: 'sicar', sourceType: 'ticket_sales_rollup', amount: 1000 }),
        entry({ id: 'extra', source: 'manual', entryType: OTHER_INCOME_ENTRY_TYPE, amount: 50 }),
        entry({ id: 'discount', source: 'manual', entryType: PURCHASE_DISCOUNT_ADJUSTMENT_TYPE, amount: 25 }),
    ]);

    assert.deepEqual(result.map((item) => item.id), ['tickets', 'extra', 'discount']);
});

test('never falls back to a daily sale after the ticket cutover', () => {
    const result = resolveReportIncomeEntries([
        entry({ id: 'daily', source: 'sicar', sourceType: 'daily_sale', amount: 900 }),
    ]);

    assert.deepEqual(result, []);
});

test('keeps historical daily sales and uses ticket rollups only as a fallback', () => {
    const historical = (overrides = {}) => entry({ date: '2026-09-02', ...overrides });
    const withLegacy = resolveReportIncomeEntries([
        historical({ id: 'daily', source: 'sicar', sourceType: 'daily_sale' }),
        historical({ id: 'tickets', source: 'sicar', sourceType: 'ticket_sales_rollup' }),
    ]);
    const ticketsOnly = resolveReportIncomeEntries([
        historical({ id: 'tickets', source: 'sicar', sourceType: 'ticket_sales_rollup' }),
    ]);

    assert.deepEqual(withLegacy.map((item) => item.id), ['daily']);
    assert.deepEqual(ticketsOnly.map((item) => item.id), ['tickets']);
});
