import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildSalesCrmAnalytics,
    buildStampedInvoiceLinkIndex,
    getTicketStampedInvoiceInfo,
    isExcludedSicarTicket,
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

test('excludes Carnes Amparito from tickets and every sales KPI', () => {
    const amparitoTicket = {
        id: 'ticket-amparito',
        customerId: 9000,
        customerName: 'Carnes Amparito S.A.',
        date: '2026-09-07',
        status: 'active',
        subtotal: 1000,
        total: 1150,
    };
    const analytics = buildSalesCrmAnalytics([...tickets, amparitoTicket]);

    assert.equal(isExcludedSicarTicket(amparitoTicket), true);
    assert.equal(isExcludedSicarTicket({ customerId: 7878, customerName: 'Otro nombre' }), true);
    assert.equal(analytics.summary.ticketCount, 2);
    assert.equal(analytics.summary.sales, 315);
    assert.equal(analytics.customers.some((customer) => customer.name.includes('Amparito')), false);
});

test('enriches article KPIs with the SICAR category catalog', () => {
    const analytics = buildSalesCrmAnalytics(tickets, buildStampedInvoiceLinkIndex(), {
        '1': {
            articleId: 1,
            categoryId: 14,
            categoryKey: 'granada:14',
            categoryName: 'PRODUCIDOS',
            departmentName: 'RES',
        },
        '2': {
            articleId: 2,
            categoryId: 22,
            categoryKey: 'granada:22',
            categoryName: 'CERDO CORTES ESPECIALES',
            departmentName: 'CERDO',
        },
    });
    const product = analytics.products.find((item) => item.description === 'Producto A');
    const resDepartment = analytics.departments.find((item) => item.departmentName === 'RES');
    const porkDepartment = analytics.departments.find((item) => item.departmentName === 'CERDO');

    assert.equal(product.categoryName, 'PRODUCIDOS');
    assert.equal(product.departmentName, 'RES');
    assert.equal(product.ticketCount, 1);
    assert.equal(product.averagePerTicket, 115);
    assert.equal(analytics.customers[0].activeDays, 1);
    assert.equal(analytics.summary.productSales, 315);
    assert.equal(resDepartment.sales, 115);
    assert.equal(resDepartment.percentage, 115 / 315);
    assert.equal(porkDepartment.sales, 200);
    assert.equal(porkDepartment.percentage, 200 / 315);
});
