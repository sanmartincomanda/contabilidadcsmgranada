const admin = require('firebase-admin');
const mysql = require('mysql2/promise');
const path = require('node:path');
const {
  addDays,
  getMysqlConfig,
  initFirebase,
  loadEnvFile,
  money,
} = require('./syncSicarBilling');
const {
  buildTicketFingerprint,
  fetchTicketSalesByIds,
} = require('./syncSicarTicketSales');

function parseArgs(argv = []) {
  return argv.reduce((options, argument) => {
    if (argument === '--apply') options.apply = true;
    else if (argument.startsWith('--date=')) options.date = argument.slice('--date='.length);
    return options;
  }, { apply: false, date: new Date().toISOString().substring(0, 10) });
}

function unique(values = []) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && String(value).trim() !== ''))];
}

function normalizeLegacyTicket(source = {}) {
  const ticketId = source.ticketId ?? source.ticId ?? source.tic_id ?? source.invoiceNumber ?? source.numeroFactura;
  const saleId = Number(source.saleId ?? source.venId ?? source.ven_id) || null;
  const ticketNumber = String(source.ticketNumber || source.invoiceNumber || source.numeroFactura || ticketId || '').trim();
  const numericStatus = Number(source.status);
  const isCancelled = Boolean(source.isCancelled || (Number.isFinite(numericStatus) && numericStatus < 0));
  return {
    ...source,
    id: source.id,
    sourceSystem: 'SICAR',
    sourceType: 'ticket_sale',
    sourceMode: source.sourceMode || 'legacy-ticket-migration',
    branch: source.branchId || source.branch || 'nindiri',
    branchId: source.branchId || source.branch || 'nindiri',
    date: source.date || source.saleDate || '',
    saleDate: source.saleDate || source.date || '',
    saleId,
    venId: saleId,
    ticketId,
    ticketNumber,
    ticketCode: source.ticketCode || `T-${ticketNumber}`,
    sourceDocumentType: 'ticket',
    sourceDocumentId: ticketId,
    sourceDocumentNumber: ticketNumber,
    sourceDocumentNumbers: ticketNumber ? [ticketNumber] : [],
    cashboxId: source.cashboxId ?? source.caj_id ?? null,
    cashboxName: source.cashboxName || source.caja || '',
    customerName: source.customerName || source.cliente || 'PUBLICO EN GENERAL',
    customerRfc: source.customerRfc || source.rfc || '',
    customerAddress: source.customerAddress || source.address || '',
    itemCount: Number(source.itemCount ?? source.items?.length ?? 0),
    items: source.items || [],
    subtotal: money(source.subtotal),
    iva: money(source.iva),
    total: money(source.total),
    status: isCancelled ? 'cancelled' : 'active',
    isCancelled,
  };
}

function totalsMatch(left, right) {
  return Math.abs(money(left) - money(right)) <= 0.05;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(__dirname, '..', '..');
  loadEnvFile(path.join(projectRoot, '.env.local'));
  loadEnvFile(path.join(projectRoot, 'functions', '.env.local'));
  const db = initFirebase();
  const endExclusive = addDays(options.date, 1);

  const invoiceSnapshot = await db.collection('facturas_membretadas_ventas')
    .where('saleDate', '>=', options.date)
    .where('saleDate', '<', endExclusive)
    .get();
  const invoices = invoiceSnapshot.docs
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
    .filter((invoice) => !['ANULADO', 'ANULADA', 'CANCELADO', 'CANCELADA'].includes(String(invoice.status || '').toUpperCase()));
  const groups = new Map();

  invoices.forEach((invoice) => {
    const legacySourceId = String(invoice.sourceSicarInvoiceId || '').trim();
    if (!legacySourceId || invoice.sourceSicarCollection === 'sicar_ventas_tickets') return;
    const group = groups.get(legacySourceId) || [];
    group.push(invoice);
    groups.set(legacySourceId, group);
  });

  const legacySnapshots = groups.size
    ? await db.getAll(...[...groups.keys()].map((id) => db.collection('sicar_facturas_membretadas').doc(id)))
    : [];
  const legacySources = new Map(
    legacySnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, { id: snapshot.id, ...snapshot.data() }])
  );
  const granadaSaleIds = unique(
    [...legacySources.values()]
      .filter((source) => String(source.branchId || source.branch || 'granada').toLowerCase() === 'granada')
      .flatMap((source) => source.sicarSaleIds || [])
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > 0)
  );
  let connection;
  let granadaTickets = [];
  if (granadaSaleIds.length) {
    connection = await mysql.createConnection(getMysqlConfig());
    granadaTickets = await fetchTicketSalesByIds(connection, granadaSaleIds);
  }
  const granadaTicketIndex = new Map(granadaTickets.map((ticket) => [Number(ticket.saleId), ticket]));
  const plans = [];
  const skipped = [];

  for (const [legacySourceId, appInvoices] of groups.entries()) {
    const legacySource = legacySources.get(legacySourceId);
    if (!legacySource) {
      skipped.push({ legacySourceId, reason: 'No existe el origen SICAR anterior.' });
      continue;
    }
    const branchId = String(legacySource.branchId || legacySource.branch || appInvoices[0]?.branchId || 'granada').toLowerCase();
    let tickets = [];
    if (legacySourceId.startsWith('sicar_ticket_')) {
      tickets = [normalizeLegacyTicket(legacySource)];
    } else if (branchId === 'granada') {
      tickets = unique((legacySource.sicarSaleIds || []).map(Number))
        .map((saleId) => granadaTicketIndex.get(Number(saleId)))
        .filter(Boolean);
    }

    const expectedSaleIds = unique((legacySource.sicarSaleIds || []).map(Number).filter((value) => Number.isFinite(value) && value > 0));
    const actualSaleIds = unique(tickets.map((ticket) => Number(ticket.saleId)).filter((value) => Number.isFinite(value) && value > 0));
    const sourceTotal = money(legacySource.total || appInvoices.reduce((sum, invoice) => sum + money(invoice.total), 0));
    const ticketTotal = money(tickets.reduce((sum, ticket) => sum + money(ticket.total), 0));
    const saleIdsComplete = !expectedSaleIds.length || expectedSaleIds.every((saleId) => actualSaleIds.includes(saleId));
    if (!tickets.length || !saleIdsComplete || !totalsMatch(sourceTotal, ticketTotal)) {
      skipped.push({
        legacySourceId,
        reason: !tickets.length ? 'No se encontraron tickets.' : !saleIdsComplete ? 'Faltan ventas SICAR.' : 'Los totales no coinciden.',
        sourceTotal,
        ticketTotal,
        expectedSaleIds,
        actualSaleIds,
      });
      continue;
    }

    plans.push({ legacySource, legacySourceId, branchId, appInvoices, tickets });
  }

  const sourceDocumentIds = unique(plans.flatMap((plan) => plan.tickets.map((ticket) => ticket.id)));
  const currentSourceSnapshots = sourceDocumentIds.length
    ? await db.getAll(...sourceDocumentIds.map((id) => db.collection('sicar_ventas_tickets').doc(id)))
    : [];
  const currentSources = new Map(currentSourceSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data()]));
  const safePlans = plans.filter((plan) => {
    const intendedIds = plan.appInvoices.map((invoice) => invoice.id).sort();
    const conflict = plan.tickets.find((ticket) => {
      const source = currentSources.get(ticket.id) || {};
      const linkedIds = unique([...(source.accountingInvoiceIds || []), source.accountingInvoiceId]).map(String).sort();
      return linkedIds.length && linkedIds.some((id) => !intendedIds.includes(id));
    });
    if (!conflict) return true;
    skipped.push({ legacySourceId: plan.legacySourceId, reason: `El ticket ${conflict.id} ya tiene otro vinculo contable.` });
    return false;
  });

  const summary = safePlans.map((plan) => ({
    legacySourceId: plan.legacySourceId,
    invoices: plan.appInvoices.map((invoice) => invoice.invoiceNumber || invoice.numeroFactura),
    tickets: plan.tickets.map((ticket) => ticket.ticketNumber || ticket.ticketId),
    saleIds: plan.tickets.map((ticket) => ticket.saleId),
    total: money(plan.tickets.reduce((sum, ticket) => sum + money(ticket.total), 0)),
    branchId: plan.branchId,
  }));
  const safeSourceDocumentIds = unique(safePlans.flatMap((plan) => plan.tickets.map((ticket) => ticket.id)));

  console.log(JSON.stringify({ mode: options.apply ? 'apply' : 'preview', date: options.date, linkedGroups: summary.length, linkedInvoices: safePlans.reduce((sum, plan) => sum + plan.appInvoices.length, 0), linkedTickets: safeSourceDocumentIds.length, skipped, plans: summary }, null, 2));

  if (options.apply && safePlans.length) {
    const batch = db.batch();
    const FieldValue = admin.firestore.FieldValue;
    safePlans.forEach((plan) => {
      const invoiceIds = plan.appInvoices.map((invoice) => invoice.id);
      const invoiceNumbers = plan.appInvoices.map((invoice) => String(invoice.invoiceNumber || invoice.numeroFactura || '')).filter(Boolean);
      const documentIds = plan.tickets.map((ticket) => ticket.id);
      const saleIds = unique(plan.tickets.map((ticket) => Number(ticket.saleId)).filter((value) => Number.isFinite(value) && value > 0));
      const ticketIds = unique(plan.tickets.map((ticket) => ticket.ticketId).filter(Boolean));
      const ticketNumbers = unique(plan.tickets.map((ticket) => String(ticket.ticketNumber || ticket.ticketId || '')).filter(Boolean));
      const documentNumbers = unique(plan.tickets.map((ticket) => String(ticket.sourceDocumentNumber || ticket.ticketNumber || '')).filter(Boolean));
      const cashboxIds = unique([plan.legacySource.cashboxId, ...plan.tickets.map((ticket) => ticket.cashboxId)]);
      const cashboxNames = unique([plan.legacySource.cashboxName, ...plan.tickets.map((ticket) => ticket.cashboxName)]);
      const primary = plan.tickets[0];

      plan.tickets.forEach((ticket) => {
        batch.set(db.collection('sicar_ventas_tickets').doc(ticket.id), {
          ...ticket,
          sicarFingerprint: buildTicketFingerprint(ticket),
          accountingStatus: 'linked',
          accountingInvoiceId: invoiceIds[0] || '',
          accountingInvoiceIds: invoiceIds,
          accountingInvoiceNumber: invoiceNumbers[0] || '',
          accountingInvoiceNumbers: invoiceNumbers,
          accountingSourceSicarInvoiceId: plan.legacySourceId,
          accountingAutoLinkedAt: FieldValue.serverTimestamp(),
          syncedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });

      plan.appInvoices.forEach((invoice) => {
        batch.set(db.collection('facturas_membretadas_ventas').doc(invoice.id), {
          source: 'sicar_ticket',
          sourceSicarCollection: 'sicar_ventas_tickets',
          sourceSicarDocumentId: primary.id,
          sourceSicarDocumentIds: documentIds,
          sourceSicarTicketDocumentId: primary.id,
          sourceSicarDocumentType: plan.tickets.length > 1 ? 'multiple' : primary.sourceDocumentType || 'ticket',
          sourceSicarDocumentNumber: primary.sourceDocumentNumber || primary.ticketNumber || '',
          sourceSicarDocumentNumbers: documentNumbers,
          sourceSicarSaleId: primary.saleId ?? null,
          sourceSicarSaleIds: saleIds,
          sourceSicarTicketId: primary.ticketId ?? null,
          sourceSicarTicketIds: ticketIds,
          sourceSicarInvoiceNumber: primary.ticketNumber || primary.ticketId || '',
          sourceSicarTicketNumbers: ticketNumbers,
          sourceSicarCashboxId: plan.legacySource.cashboxId ?? primary.cashboxId ?? null,
          sourceSicarCashboxIds: cashboxIds,
          sourceSicarCashboxName: plan.legacySource.cashboxName || primary.cashboxName || '',
          sourceSicarCashboxNames: cashboxNames,
          sicarCashboxId: plan.legacySource.cashboxId ?? primary.cashboxId ?? null,
          sicarCashboxName: plan.legacySource.cashboxName || primary.cashboxName || '',
          sourceSicarAutoLinked: true,
          sourceSicarAutoLinkedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });
    });
    await batch.commit();
    console.log(`Vinculacion aplicada: ${safePlans.length} origenes y ${safePlans.reduce((sum, plan) => sum + plan.appInvoices.length, 0)} facturas.`);
  }

  if (connection) await connection.end();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
