import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildSalesCrmAnalytics,
    buildStampedInvoiceLinkIndex,
    getTicketStampedInvoiceInfo,
} from './salesCrmAnalytics.js';

const tickets = [
    {
        id: 'ticket-1',
        saleId: 10,
        date: '2026-09-07',
        customerId: 20,
        customerName: 'Cliente Uno',
        subtotal: 100,
        iva: 15,
        total: 115,
        purchaseTotal: 70,
        grossProfitTotal: 45,
        paymentBreakdown: [{ method: 'Efectivo', amount: 115 }],
        items: [{ articleId: 1, description: 'Producto A', quantity: 1, totalWithTax: 115 }],
        status: 'active',
    },
    {
        id: 'ticket-2',
        saleId: 11,
        date: '2026-09-07',
        customerId: 20,
        customerName: 'Cliente Uno',
        subtotal: 200,
        iva: 0,
        total: 200,
        purchaseTotal: 120,
        paymentBreakdown: [{ method: 'Tarjeta', amount: 200 }],
        items: [{ articleId: 2, description: 'Producto B', quantity: 2, totalWithTax: 200 }],
        status: 'active',
    },
    {
        id: 'ticket-3',
        saleId: 12,
        date: '2026-09-07',
        customerId: 1,
        customerName: 'Publico en General',
        total: 50,
        status: 'cancelled',
        isCancelled: true,
    },
];

test('calculates SICAR sales without counting cancelled tickets', () => {
    const index = buildStampedInvoiceLinkIndex([
        { id: 'invoice-1', invoiceNumber: '7001', sourceSicarDocumentId: 'ticket-1', status: 'active' },
    ]);
    const analytics = buildSalesCrmAnalytics(tickets, index);

    assert.equal(analytics.summary.ticketCount, 2);
    assert.equal(analytics.cancelledCount, 1);
    assert.equal(analytics.summary.sales, 315);
    assert.equal(analytics.summary.linkedCount, 1);
    assert.equal(analytics.summary.linkedConversion, 0.5);
    assert.equal(analytics.summary.linkedSalesConversion, 115 / 315);
    assert.equal(analytics.summary.customerCount, 1);
    assert.equal(analytics.summary.recurringCustomers, 1);
});

test('recognizes ticket links stored directly by the accounting workflow', () => {
    const info = getTicketStampedInvoiceInfo({
        id: 'ticket-9',
        accountingStatus: 'linked',
        accountingInvoiceIds: ['invoice-9a', 'invoice-9b'],
        accountingInvoiceNumbers: ['7100', '7101'],
    });

    assert.equal(info.linked, true);
    assert.deepEqual(info.invoiceNumbers, ['7100', '7101']);
});

test('does not treat an explicit unlinked status as a conversion', () => {
    const info = getTicketStampedInvoiceInfo({
        id: 'ticket-unlinked',
        accountingStatus: 'unlinked',
    });

    assert.equal(info.linked, false);
});

test('does not count a known annulled linked invoice as conversion', () => {
    const index = buildStampedInvoiceLinkIndex([
        { id: 'invoice-x', sourceSicarDocumentId: 'ticket-x', status: 'ANULADA' },
    ]);
    const info = getTicketStampedInvoiceInfo({
        id: 'ticket-x',
        accountingStatus: 'linked',
        accountingInvoiceId: 'invoice-x',
    }, index);

    assert.equal(info.linked, false);
});
