const money = (value) => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
};

export const normalizeCrmText = (value = '') => String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

const unique = (values = []) => [...new Set(
    values
        .flat()
        .filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
        .map((value) => String(value).trim())
)];

export const isCancelledSicarTicket = (ticket = {}) => {
    const status = normalizeCrmText(ticket.status);
    return Boolean(ticket.isCancelled) || status.includes('CANCEL') || status.includes('ANUL');
};

const isAnnulledInvoice = (invoice = {}) => {
    const status = normalizeCrmText(invoice.status || invoice.estado);
    return status.includes('ANUL') || status.includes('CANCEL') || status.includes('DELETED');
};

const getInvoiceNumber = (invoice = {}) => String(
    invoice.invoiceNumber || invoice.numeroFactura || invoice.folio || ''
).trim();

const getInvoiceDocumentIds = (invoice = {}) => unique([
    invoice.sourceSicarDocumentIds || [],
    invoice.sourceSicarDocumentId,
    invoice.sourceSicarTicketDocumentId,
]);

const getInvoiceSaleIds = (invoice = {}) => unique([
    invoice.sourceSicarSaleIds || [],
    invoice.sourceSicarSaleId,
]).map(Number).filter((value) => Number.isFinite(value) && value > 0);

const addInvoiceLink = (map, key, invoice) => {
    if (!key) return;
    const current = map.get(String(key)) || [];
    if (!current.some((item) => (item.id || item.docId) === (invoice.id || invoice.docId))) {
        current.push(invoice);
    }
    map.set(String(key), current);
};

export const buildStampedInvoiceLinkIndex = (invoices = []) => {
    const byTicketDocumentId = new Map();
    const bySaleId = new Map();
    const activeInvoiceIds = new Set();
    const annulledInvoiceIds = new Set();

    (invoices || []).forEach((invoice) => {
        const invoiceId = String(invoice.id || invoice.docId || '').trim();
        if (isAnnulledInvoice(invoice)) {
            if (invoiceId) annulledInvoiceIds.add(invoiceId);
            return;
        }

        if (invoiceId) activeInvoiceIds.add(invoiceId);
        getInvoiceDocumentIds(invoice).forEach((id) => addInvoiceLink(byTicketDocumentId, id, invoice));
        getInvoiceSaleIds(invoice).forEach((saleId) => addInvoiceLink(bySaleId, saleId, invoice));
    });

    return { activeInvoiceIds, annulledInvoiceIds, bySaleId, byTicketDocumentId };
};

export const getTicketStampedInvoiceInfo = (ticket = {}, linkIndex = buildStampedInvoiceLinkIndex()) => {
    const ticketId = String(ticket.id || ticket.docId || '').trim();
    const saleId = Number(ticket.saleId ?? ticket.venId ?? ticket.ven_id);
    const matchedInvoices = [
        ...(linkIndex.byTicketDocumentId?.get(ticketId) || []),
        ...(Number.isFinite(saleId) ? linkIndex.bySaleId?.get(String(saleId)) || [] : []),
    ].filter((invoice, index, rows) => (
        rows.findIndex((item) => (item.id || item.docId) === (invoice.id || invoice.docId)) === index
    ));

    const directIds = unique([
        ticket.accountingInvoiceIds || [],
        ticket.accountingInvoiceId,
        ticket.contabilidadInvoiceId,
    ]);
    const directNumbers = unique([
        ticket.accountingInvoiceNumbers || [],
        ticket.accountingInvoiceNumber,
    ]);
    const status = normalizeCrmText(ticket.accountingStatus || ticket.estadoContable);
    const explicitLinkedStatus = ['LINKED', 'CONTABILIZADA', 'CONTABILIZADO', 'CARGADA', 'CARGADO', 'ACCOUNTED', 'LOADED']
        .includes(status);
    const allDirectInvoicesAreKnownAnnulled = directIds.length > 0
        && directIds.every((id) => linkIndex.annulledInvoiceIds?.has(id))
        && !directIds.some((id) => linkIndex.activeInvoiceIds?.has(id));
    const linked = matchedInvoices.length > 0 || (
        !allDirectInvoicesAreKnownAnnulled
        && (directIds.length > 0 || directNumbers.length > 0 || explicitLinkedStatus)
    );
    const invoiceNumbers = unique([
        matchedInvoices.map(getInvoiceNumber),
        directNumbers,
    ]);

    return {
        invoiceIds: unique([matchedInvoices.map((invoice) => invoice.id || invoice.docId), directIds]),
        invoiceNumbers,
        invoices: matchedInvoices,
        linked,
    };
};

export const classifySicarPaymentMethod = (method = '') => {
    const normalized = normalizeCrmText(method);
    if (normalized.includes('CREDITO')) return 'credit';
    if (normalized.includes('EFECTIVO')) return 'cash';
    if (normalized.includes('TRANSFER')) return 'transfer';
    if (normalized.includes('TARJETA') || normalized.includes('POS')) return 'card';
    if (normalized.includes('DESCUENTO')) return 'discount';
    return 'other';
};

export const getTicketPaymentTypes = (ticket = {}) => {
    const types = new Set(
        (ticket.paymentBreakdown || [])
            .map((payment) => classifySicarPaymentMethod(payment.method))
            .filter(Boolean)
    );
    if (!types.size && normalizeCrmText(ticket.saleType).includes('CREDITO')) types.add('credit');
    if (!types.size && Number(ticket.sicarCreditTotal || 0) > 0) types.add('credit');
    return [...types];
};

const isPublicCustomer = (ticket = {}) => {
    const customerId = Number(ticket.customerId);
    const name = normalizeCrmText(ticket.customerName || ticket.cliente);
    return customerId === 1 || name.includes('PUBLICO EN GENERAL') || name === 'PUBLICO GENERAL';
};

export const getTicketCustomerKey = (ticket = {}) => {
    if (isPublicCustomer(ticket)) return 'publico-general';
    const customerId = String(ticket.customerId || '').trim();
    if (customerId) return `id:${customerId}`;
    const rfc = normalizeCrmText(ticket.customerRfc || ticket.rfc).replace(/[^A-Z0-9]/g, '');
    if (rfc) return `rfc:${rfc}`;
    return `name:${normalizeCrmText(ticket.customerName || ticket.cliente || 'SIN CLIENTE')}`;
};

const getTicketProfit = (ticket = {}) => {
    if (ticket.grossProfitTotal !== undefined && ticket.grossProfitTotal !== null) {
        return money(ticket.grossProfitTotal);
    }
    return money(money(ticket.total) - money(ticket.purchaseTotal));
};

const addAmount = (map, key, amount) => {
    map.set(key, money((map.get(key) || 0) + money(amount)));
};

const getPaymentRows = (ticket = {}) => {
    const rows = (ticket.paymentBreakdown || []).filter((payment) => money(payment.amount) !== 0);
    if (rows.length) return rows;
    const fallbackType = getTicketPaymentTypes(ticket)[0] || 'other';
    return [{ method: fallbackType, amount: ticket.total, inferredType: fallbackType }];
};

const buildCustomerSegment = (customer, averageCustomerSales) => {
    if (customer.isPublic) return 'Publico general';
    if (customer.ticketCount >= 8 || customer.sales >= averageCustomerSales * 2.5) return 'VIP';
    if (customer.ticketCount >= 4) return 'Frecuente';
    if (customer.ticketCount >= 2) return 'Recurrente';
    return 'Nuevo';
};

export const buildSalesCrmAnalytics = (tickets = [], linkIndex = buildStampedInvoiceLinkIndex()) => {
    const activeTickets = (tickets || []).filter((ticket) => !isCancelledSicarTicket(ticket));
    const cancelledCount = (tickets || []).length - activeTickets.length;
    const paymentTotals = new Map();
    const dailyMap = new Map();
    const customerMap = new Map();
    const productMap = new Map();
    let sales = 0;
    let subtotal = 0;
    let iva = 0;
    let cost = 0;
    let profit = 0;
    let linkedCount = 0;
    let linkedSales = 0;

    activeTickets.forEach((ticket) => {
        const total = money(ticket.total);
        const ticketSubtotal = money(ticket.subtotal);
        const ticketCost = money(ticket.purchaseTotal);
        const ticketProfit = getTicketProfit(ticket);
        const link = ticket.crmInvoiceLink || getTicketStampedInvoiceInfo(ticket, linkIndex);
        const date = String(ticket.date || ticket.saleDate || '').substring(0, 10);
        sales = money(sales + total);
        subtotal = money(subtotal + ticketSubtotal);
        iva = money(iva + money(ticket.iva));
        cost = money(cost + ticketCost);
        profit = money(profit + ticketProfit);
        if (link.linked) {
            linkedCount += 1;
            linkedSales = money(linkedSales + total);
        }

        const daily = dailyMap.get(date) || { date, linked: 0, sales: 0, tickets: 0 };
        daily.sales = money(daily.sales + total);
        daily.tickets += 1;
        if (link.linked) daily.linked += 1;
        dailyMap.set(date, daily);

        getPaymentRows(ticket).forEach((payment) => {
            const type = payment.inferredType || classifySicarPaymentMethod(payment.method);
            addAmount(paymentTotals, type, payment.amount);
        });

        const customerKey = getTicketCustomerKey(ticket);
        const customer = customerMap.get(customerKey) || {
            address: ticket.customerAddress || ticket.address || '',
            firstPurchase: date,
            isPublic: isPublicCustomer(ticket),
            key: customerKey,
            lastPurchase: date,
            linkedCount: 0,
            name: ticket.customerName || ticket.cliente || 'SIN CLIENTE',
            paymentTotals: new Map(),
            products: new Map(),
            profit: 0,
            rfc: ticket.customerRfc || ticket.rfc || '',
            sales: 0,
            ticketCount: 0,
            tickets: [],
        };
        customer.address = customer.address || ticket.customerAddress || ticket.address || '';
        customer.rfc = customer.rfc || ticket.customerRfc || ticket.rfc || '';
        customer.firstPurchase = !customer.firstPurchase || date < customer.firstPurchase ? date : customer.firstPurchase;
        customer.lastPurchase = date > customer.lastPurchase ? date : customer.lastPurchase;
        customer.sales = money(customer.sales + total);
        customer.profit = money(customer.profit + ticketProfit);
        customer.ticketCount += 1;
        if (link.linked) customer.linkedCount += 1;
        customer.tickets.push({ ...ticket, crmInvoiceLink: link });

        getPaymentRows(ticket).forEach((payment) => {
            const type = payment.inferredType || classifySicarPaymentMethod(payment.method);
            addAmount(customer.paymentTotals, type, payment.amount);
        });

        (ticket.items || []).forEach((item) => {
            const productKey = String(item.articleId || item.code || normalizeCrmText(item.description)).trim();
            if (!productKey) return;
            const product = customer.products.get(productKey) || {
                code: item.code || '',
                description: item.description || 'Articulo',
                quantity: 0,
                sales: 0,
            };
            product.quantity = money(product.quantity + Number(item.quantity || 0));
            product.sales = money(product.sales + money(item.totalWithTax ?? item.totalWithoutTax));
            customer.products.set(productKey, product);

            const globalProduct = productMap.get(productKey) || { ...product, quantity: 0, sales: 0 };
            globalProduct.quantity = money(globalProduct.quantity + Number(item.quantity || 0));
            globalProduct.sales = money(globalProduct.sales + money(item.totalWithTax ?? item.totalWithoutTax));
            productMap.set(productKey, globalProduct);
        });
        customerMap.set(customerKey, customer);
    });

    const identifiedCustomers = [...customerMap.values()].filter((customer) => !customer.isPublic);
    const averageCustomerSales = identifiedCustomers.length
        ? identifiedCustomers.reduce((sum, customer) => sum + customer.sales, 0) / identifiedCustomers.length
        : 0;
    const customers = [...customerMap.values()]
        .map((customer) => ({
            ...customer,
            averageTicket: customer.ticketCount ? money(customer.sales / customer.ticketCount) : 0,
            conversion: customer.ticketCount ? customer.linkedCount / customer.ticketCount : 0,
            margin: customer.sales ? customer.profit / customer.sales : 0,
            paymentTotals: [...customer.paymentTotals.entries()].map(([type, total]) => ({ type, total })),
            products: [...customer.products.values()].sort((a, b) => b.sales - a.sales),
            segment: buildCustomerSegment(customer, averageCustomerSales),
            tickets: customer.tickets.sort((a, b) => Number(b.saleId || 0) - Number(a.saleId || 0)),
        }))
        .sort((a, b) => b.sales - a.sales);

    return {
        activeTickets,
        cancelledCount,
        customers,
        daily: [...dailyMap.values()].filter((item) => item.date).sort((a, b) => a.date.localeCompare(b.date)),
        paymentTotals: [...paymentTotals.entries()].map(([type, total]) => ({ type, total })).sort((a, b) => b.total - a.total),
        products: [...productMap.values()].sort((a, b) => b.sales - a.sales),
        summary: {
            averageTicket: activeTickets.length ? money(sales / activeTickets.length) : 0,
            cost,
            customerCount: identifiedCustomers.length,
            iva,
            linkedConversion: activeTickets.length ? linkedCount / activeTickets.length : 0,
            linkedCount,
            linkedSales,
            linkedSalesConversion: sales ? linkedSales / sales : 0,
            margin: sales ? profit / sales : 0,
            profit,
            recurringCustomers: identifiedCustomers.filter((customer) => customer.ticketCount > 1).length,
            sales,
            subtotal,
            ticketCount: activeTickets.length,
        },
    };
};
