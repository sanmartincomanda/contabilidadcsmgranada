const admin = require('firebase-admin');

const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const shouldApply = process.argv.includes('--apply');

if (!serviceAccountPath) {
    throw new Error('Define GOOGLE_APPLICATION_CREDENTIALS antes de ejecutar la reparacion.');
}

admin.initializeApp({
    credential: admin.credential.cert(require(serviceAccountPath)),
});

const db = admin.firestore();
const invoices = db.collection('facturas_membretadas_ventas');
const tickets = db.collection('sicar_ventas_tickets');
const registry = db.collection('facturas_membretadas_numeros');
const repairId = 'granada-20260909-invoice-identity-collisions-v1';
const repairRef = db.collection('auditorias_reparaciones').doc(repairId);

const refs = {
    invoice7189: invoices.doc('membretada_granada_A_7189_20260909'),
    invoice7194: invoices.doc('membretada_granada_A_7194_20260909'),
    invoice7207: invoices.doc('membretada_granada_A_7207_20260909'),
    invoice7211: invoices.doc('membretada_granada_A_7211_20260909'),
    invoice7212: invoices.doc('membretada_granada_A_7212_20260909'),
    invoice7215: invoices.doc('membretada_granada_A_7215_20260909'),
    invoice7216: invoices.doc('membretada_granada_A_7216_20260909'),
    ticket7189: tickets.doc('sicar_ticket_granada_503917'),
    ticket7207: tickets.doc('sicar_ticket_granada_503951'),
    ticket7211: tickets.doc('sicar_ticket_granada_504000'),
    ticket7215: tickets.doc('sicar_ticket_granada_504031'),
    ticket7216: tickets.doc('sicar_ticket_granada_504032'),
};

const value = (snapshot) => ({ id: snapshot.id, ...snapshot.data() });
const numberOf = (invoice = {}) => String(invoice.invoiceNumber || invoice.numeroFactura || '').trim();
const sourceOf = (invoice = {}) => invoice.sourceSicarDocumentId || invoice.sourceSicarTicketDocumentId || '';

function assertRecord(condition, message) {
    if (!condition) throw new Error(`Validacion detenida: ${message}`);
}

function clearStaleAnnulmentFields(invoice) {
    const clean = { ...invoice };
    [
        'annulledAt',
        'annulledBy',
        'annulledReason',
        'annulmentOrigin',
        'annulmentSourceId',
    ].forEach((field) => delete clean[field]);
    return clean;
}

function buildSourceFields(ticket, ticketDocId) {
    const ticketNumber = String(ticket.ticketNumber || ticket.ticketId || ticket.ticId || '');
    return {
        source: 'sicar_ticket',
        sourceType: 'stamped_sale_invoice',
        sourceSicarInvoiceId: ticketDocId,
        sourceSicarInvoiceNumber: ticketNumber,
        sourceSicarCollection: 'sicar_ventas_tickets',
        sourceSicarDocumentId: ticketDocId,
        sourceSicarDocumentIds: [ticketDocId],
        sourceSicarTicketDocumentId: ticketDocId,
        sourceSicarDocumentType: 'ticket',
        sourceSicarDocumentNumber: ticketNumber,
        sourceSicarDocumentNumbers: [ticketNumber],
        sourceSicarSaleId: ticket.saleId ?? ticket.venId ?? null,
        sourceSicarSaleIds: [ticket.saleId ?? ticket.venId].filter((item) => item !== null && item !== undefined),
        sourceSicarTicketId: ticket.ticketId ?? ticket.ticId ?? null,
        sourceSicarTicketIds: [ticket.ticketId ?? ticket.ticId].filter((item) => item !== null && item !== undefined),
        sourceSicarTicketNumbers: [ticketNumber],
        sourceSicarCashboxId: ticket.cashboxId ?? null,
        sourceSicarCashboxIds: [ticket.cashboxId].filter((item) => item !== null && item !== undefined),
        sourceSicarCashboxName: ticket.cashboxName || '',
        sourceSicarCashboxNames: [ticket.cashboxName].filter(Boolean),
        sicarCashboxId: ticket.cashboxId ?? null,
        sicarCashboxName: ticket.cashboxName || '',
    };
}

function buildActiveInvoice(current, targetId, invoiceNumber, ticket, ticketDocId) {
    return {
        ...clearStaleAnnulmentFields(current),
        ...buildSourceFields(ticket, ticketDocId),
        id: targetId,
        fiscalDocumentId: targetId,
        numeroFactura: invoiceNumber,
        invoiceNumber,
        originalInvoiceNumber: invoiceNumber,
        invoiceNumberHistory: [invoiceNumber],
        documentDisplayNumber: `A-${invoiceNumber}`,
        status: 'active',
        customerName: ticket.customerName || current.customerName || '',
        customerAddress: ticket.customerAddress || current.customerAddress || '',
        customerRfc: ticket.customerRfc || current.customerRfc || '',
        identityRepairId: repairId,
        identityRepairedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
}

function zeroInvoiceItems(items = []) {
    return items.map((item) => ({
        ...item,
        unitPriceWithoutTax: 0,
        unitPriceWithTax: 0,
        totalWithoutTax: 0,
        totalWithTax: 0,
        taxAmount: 0,
        precioSin: 0,
        precioCon: 0,
        importeSin: 0,
        importeCon: 0,
        iva: 0,
    }));
}

function buildAnnulledInvoice(template, targetId, invoiceNumber, ticket, ticketDocId) {
    const ticketTotal = Number(ticket.total) || 0;
    return {
        ...template,
        ...buildSourceFields(ticket, ticketDocId),
        id: targetId,
        fiscalDocumentId: targetId,
        numeroFactura: invoiceNumber,
        invoiceNumber,
        originalInvoiceNumber: invoiceNumber,
        invoiceNumberHistory: [invoiceNumber],
        documentDisplayNumber: `A-${invoiceNumber}`,
        date: ticket.date || '2026-09-09',
        saleDate: ticket.date || '2026-09-09',
        month: String(ticket.date || '2026-09-09').slice(0, 7),
        customerName: ticket.customerName || '',
        customerAddress: ticket.customerAddress || '',
        customerRfc: ticket.customerRfc || '',
        amount: 0,
        subtotal: 0,
        iva: 0,
        total: 0,
        netTotal: 0,
        retentionIr2: 0,
        retentionMunicipal1: 0,
        retentionTotal: 0,
        paymentMethod: '',
        metodoPago: 'CREDITO',
        paymentDisplayMethod: 'CREDITO',
        paymentBreakdown: [],
        paymentNetTotal: 0,
        cashPaidAmount: ticketTotal,
        isCreditSale: true,
        creditOriginalAmount: ticketTotal,
        creditPaidAmount: 0,
        creditBalance: ticketTotal,
        creditReceiptIds: [],
        creditStatus: 'pending',
        creditStatusLabel: 'Credito - Pendiente',
        items: zeroInvoiceItems(ticket.items || []),
        status: 'ANULADA',
        splitGroupId: '',
        splitPart: null,
        splitTotalParts: null,
        createdAt: ticket.accountingLoadedAt || admin.firestore.FieldValue.serverTimestamp(),
        annulledAt: ticket.updatedAt || admin.firestore.FieldValue.serverTimestamp(),
        annulmentOrigin: 'sicar_alert_confirmed',
        annulmentSourceId: ticketDocId,
        identityRepairId: repairId,
        identityRepairedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
}

function buildTicketLink(invoiceId, invoiceNumber, isCancelled) {
    return {
        accountingStatus: 'linked',
        accountingInvoiceId: invoiceId,
        accountingInvoiceIds: [invoiceId],
        accountingInvoiceNumber: invoiceNumber,
        accountingInvoiceNumbers: [invoiceNumber],
        accountingIdentityRepairId: repairId,
        ...(isCancelled ? {
            accountingCancellationStatus: 'confirmed',
            accountingCancellationConfirmedAt: admin.firestore.FieldValue.serverTimestamp(),
        } : {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
}

function buildRegistry(invoiceId, invoiceNumber, invoice) {
    const matchKey = `invoice:granada:a:${invoiceNumber}`;
    return {
        ref: registry.doc(matchKey),
        data: {
            matchKey,
            ownerDocumentId: invoiceId,
            invoiceNumber,
            branchId: 'granada',
            invoiceSeries: 'A',
            customerName: invoice.customerName || '',
            total: Number(invoice.total) || 0,
            repairId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
    };
}

async function inspect() {
    const snapshots = await db.getAll(...Object.values(refs));
    const records = Object.fromEntries(Object.keys(refs).map((key, index) => [key, snapshots[index].exists ? value(snapshots[index]) : null]));
    return {
        records,
        summary: {
            invoice7189: records.invoice7189 && `${numberOf(records.invoice7189)} / ${records.invoice7189.customerName} / ${records.invoice7189.total}`,
            invoice7207: records.invoice7207 && `${numberOf(records.invoice7207)} / ${records.invoice7207.customerName} / ${records.invoice7207.total}`,
            invoice7211: records.invoice7211 && `${numberOf(records.invoice7211)} / ${records.invoice7211.customerName} / ${records.invoice7211.total}`,
            invoice7215: records.invoice7215 && `${numberOf(records.invoice7215)} / ${records.invoice7215.customerName} / ${records.invoice7215.total}`,
            invoice7216: records.invoice7216 && `${numberOf(records.invoice7216)} / ${records.invoice7216.customerName} / ${records.invoice7216.total}`,
        },
    };
}

async function applyRepair() {
    await db.runTransaction(async (transaction) => {
        const snapshots = await Promise.all(Object.values(refs).map((ref) => transaction.get(ref)));
        const records = Object.fromEntries(Object.keys(refs).map((key, index) => [key, snapshots[index].exists ? value(snapshots[index]) : null]));

        const alreadyRepaired = numberOf(records.invoice7189) === '7189'
            && numberOf(records.invoice7207) === '7207'
            && numberOf(records.invoice7211) === '7211'
            && records.invoice7211?.status === 'ANULADA'
            && numberOf(records.invoice7215) === '7215'
            && records.invoice7215?.customerName === 'TELEPIZZA'
            && numberOf(records.invoice7216) === '7216';
        if (alreadyRepaired) return;

        assertRecord(records.invoice7189 && numberOf(records.invoice7189) === '7207' && sourceOf(records.invoice7189) === refs.ticket7207.id, '7189 ya no contiene exactamente la factura 7207 desplazada.');
        assertRecord(!records.invoice7207, 'el documento destino 7207 ya existe.');
        assertRecord(records.invoice7211 && records.invoice7211.customerName === 'TELEPIZZA' && sourceOf(records.invoice7211) === refs.ticket7215.id, '7211 ya no contiene exactamente TELEPIZZA desplazada.');
        assertRecord(records.invoice7215 && records.invoice7215.customerName === 'SELINA OPERATION GRANADA' && sourceOf(records.invoice7215) === refs.ticket7216.id, '7215 ya no contiene exactamente SELINA desplazada.');
        assertRecord(!records.invoice7216, 'el documento destino 7216 ya existe.');
        assertRecord(records.ticket7189?.isCancelled && records.ticket7189?.accountingInvoiceNumber === '7189', 'el origen cancelado de 7189 no coincide.');
        assertRecord(records.ticket7211?.isCancelled && records.ticket7211?.accountingInvoiceNumber === '7211', 'el origen cancelado de 7211 no coincide.');

        const repaired = {
            invoice7189: buildAnnulledInvoice(records.invoice7194, refs.invoice7189.id, '7189', records.ticket7189, refs.ticket7189.id),
            invoice7207: buildActiveInvoice(records.invoice7189, refs.invoice7207.id, '7207', records.ticket7207, refs.ticket7207.id),
            invoice7211: buildAnnulledInvoice(records.invoice7212, refs.invoice7211.id, '7211', records.ticket7211, refs.ticket7211.id),
            invoice7215: buildActiveInvoice(records.invoice7211, refs.invoice7215.id, '7215', records.ticket7215, refs.ticket7215.id),
            invoice7216: buildActiveInvoice(records.invoice7215, refs.invoice7216.id, '7216', records.ticket7216, refs.ticket7216.id),
        };

        const changedKeys = ['invoice7189', 'invoice7207', 'invoice7211', 'invoice7215', 'invoice7216', 'ticket7189', 'ticket7207', 'ticket7211', 'ticket7215', 'ticket7216'];
        changedKeys.forEach((key) => {
            const original = records[key];
            transaction.set(repairRef.collection('snapshots').doc(key), {
                documentPath: refs[key].path,
                existed: Boolean(original),
                data: original || null,
                capturedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        });

        transaction.set(refs.invoice7189, repaired.invoice7189);
        transaction.set(refs.invoice7207, repaired.invoice7207);
        transaction.set(refs.invoice7211, repaired.invoice7211);
        transaction.set(refs.invoice7215, repaired.invoice7215);
        transaction.set(refs.invoice7216, repaired.invoice7216);

        transaction.set(refs.ticket7189, buildTicketLink(refs.invoice7189.id, '7189', true), { merge: true });
        transaction.set(refs.ticket7207, buildTicketLink(refs.invoice7207.id, '7207', false), { merge: true });
        transaction.set(refs.ticket7211, buildTicketLink(refs.invoice7211.id, '7211', true), { merge: true });
        transaction.set(refs.ticket7215, buildTicketLink(refs.invoice7215.id, '7215', false), { merge: true });
        transaction.set(refs.ticket7216, buildTicketLink(refs.invoice7216.id, '7216', false), { merge: true });

        Object.entries(repaired).forEach(([key, invoice]) => {
            const invoiceNumber = numberOf(invoice);
            const reservation = buildRegistry(refs[key].id, invoiceNumber, invoice);
            transaction.set(reservation.ref, reservation.data, { merge: true });
        });

        transaction.set(repairRef, {
            repairId,
            branchId: 'granada',
            date: '2026-09-09',
            reason: 'Recuperacion de facturas sobreescritas por reutilizacion de folios anulados.',
            affectedInvoiceNumbers: ['7189', '7207', '7211', '7215', '7216'],
            status: 'completed',
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    });
}

async function main() {
    const before = await inspect();
    console.log(JSON.stringify({ mode: shouldApply ? 'apply' : 'dry-run', before: before.summary }, null, 2));
    if (!shouldApply) return;
    await applyRepair();
    const after = await inspect();
    console.log(JSON.stringify({ status: 'completed', after: after.summary }, null, 2));
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await admin.app().delete();
    });
