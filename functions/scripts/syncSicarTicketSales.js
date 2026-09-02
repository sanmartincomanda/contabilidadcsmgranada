const admin = require('firebase-admin');

const DEFAULT_EXCLUDED_CLIENT_ID = 7878;
const DEFAULT_EXCLUDED_CLIENT_NAME = 'CARNES AMPARITO';
const DEFAULT_BRANCH_ID = 'granada';
const DEFAULT_BRANCH_NAME = 'CARNES SAN MARTIN GRANADA';
const TIMEZONE = 'America/Managua';

function money(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function normalizeText(value = '') {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function placeholders(values = []) {
  return values.map(() => '?').join(',');
}

function toLocalDate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value).substring(0, 10);
}

function toDateTime(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function getBranchConfig() {
  return {
    branchId: String(process.env.SICAR_BRANCH_ID || process.env.BRANCH_ID || DEFAULT_BRANCH_ID).trim().toLowerCase() || DEFAULT_BRANCH_ID,
    branchName: String(process.env.SICAR_BRANCH_NAME || process.env.BRANCH_NAME || DEFAULT_BRANCH_NAME).trim() || DEFAULT_BRANCH_NAME,
  };
}

function getExcludedClientId() {
  const parsed = Number(process.env.SICAR_EXCLUDED_SALE_CLIENT_ID || DEFAULT_EXCLUDED_CLIENT_ID);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EXCLUDED_CLIENT_ID;
}

function compactAddress(row = {}) {
  return [row.domicilio, row.noExt, row.noInt, row.colonia, row.localidad, row.ciudad]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(', ');
}

function isCashMethod(value = '') {
  return normalizeText(value).includes('EFECTIVO');
}

function getSaleType(row = {}) {
  if (row.tic_id) return 'ticket';
  if (row.rem_id) return 'remision';
  if (row.creditClientId) return 'credito';
  if (row.invoiceFacId) return 'factura';
  return 'venta';
}

function buildTicketCode(row = {}) {
  if (row.tic_id) return `T-${row.tic_id}`;
  return `V-${row.ven_id}`;
}

async function attachSaleItems(connection, entriesBySaleId) {
  const saleIds = [...entriesBySaleId.keys()];
  if (!saleIds.length) return;

  const [rows] = await connection.execute(`
    SELECT
      dv.ven_id,
      dv.orden,
      dv.art_id,
      dv.clave,
      dv.descripcion,
      dv.cantidad,
      dv.unidad,
      dv.precioSin,
      dv.precioCon,
      dv.importeSin,
      dv.importeCon,
      dv.descPorcentaje,
      dv.descTotal,
      dv.precioCompra,
      dv.importeCompra,
      dv.subtotalCompra,
      dv.sinGravar
    FROM detallev dv
    WHERE dv.ven_id IN (${placeholders(saleIds)})
    ORDER BY dv.ven_id, dv.orden, dv.art_id
  `, saleIds);

  rows.forEach((row) => {
    const entry = entriesBySaleId.get(Number(row.ven_id));
    if (!entry) return;
    entry.items.push({
      order: Number(row.orden || 0),
      articleId: row.art_id || null,
      code: String(row.clave || '').trim(),
      description: String(row.descripcion || '').trim(),
      quantity: money(row.cantidad),
      unit: String(row.unidad || '').trim(),
      unitPriceWithoutTax: money(row.precioSin),
      unitPriceWithTax: money(row.precioCon),
      totalWithoutTax: money(row.importeSin),
      totalWithTax: money(row.importeCon),
      discountPercent: money(row.descPorcentaje),
      discountTotal: money(row.descTotal),
      purchaseUnitCost: money(row.precioCompra),
      purchaseTotal: money(row.importeCompra || row.subtotalCompra),
      taxable: !Boolean(row.sinGravar),
    });
  });
}

async function attachSalePayments(connection, entriesBySaleId) {
  const saleIds = [...entriesBySaleId.keys()];
  if (!saleIds.length) return;

  const [rows] = await connection.execute(`
    SELECT
      vtp.ven_id,
      vtp.tpa_id,
      COALESCE(tp.nombre, CONCAT('TIPO ', vtp.tpa_id)) AS method,
      vtp.total
    FROM ventatipopago vtp
    LEFT JOIN tipopago tp ON tp.tpa_id = vtp.tpa_id
    WHERE vtp.ven_id IN (${placeholders(saleIds)})
    ORDER BY vtp.ven_id, vtp.tpa_id
  `, saleIds);

  rows.forEach((row) => {
    const entry = entriesBySaleId.get(Number(row.ven_id));
    if (!entry) return;
    entry.paymentBreakdown.push({
      paymentTypeId: row.tpa_id || null,
      method: String(row.method || 'SIN METODO').trim(),
      tenderedAmount: money(row.total),
      amount: money(row.total),
    });
  });

  entriesBySaleId.forEach((entry) => {
    let pendingChange = money(entry.change);
    entry.paymentBreakdown = entry.paymentBreakdown.map((payment) => {
      if (!isCashMethod(payment.method) || pendingChange <= 0) return payment;
      const appliedChange = Math.min(payment.amount, pendingChange);
      pendingChange = money(pendingChange - appliedChange);
      return {
        ...payment,
        amount: money(payment.amount - appliedChange),
        changeApplied: appliedChange,
      };
    });

    if (!entry.paymentBreakdown.length && entry.saleType === 'credito') {
      entry.paymentBreakdown = [{
        paymentTypeId: 3,
        method: 'Credito',
        tenderedAmount: entry.total,
        amount: entry.total,
      }];
    }
  });
}

async function fetchSalesWithFilter(connection, filterSql, params = []) {
  const excludedClientId = getExcludedClientId();
  const [rows] = await connection.execute(`
    SELECT
      v.ven_id,
      v.fecha,
      v.subtotal0,
      v.subtotal,
      v.descuento,
      v.total,
      v.cambio,
      v.totalCompra,
      v.totalUtilidad,
      v.subtotalCompra,
      v.subtotalUtilidad,
      v.peso,
      v.comentario,
      v.monAbr,
      v.monTipoCambio,
      v.status,
      v.tic_id,
      v.rem_id,
      v.caj_id,
      v.can_caj_id,
      v.can_rcc_id,
      v.afFolio,
      c.nombre AS cashboxName,
      COALESCE(t.cli_id, r.cli_id, cc.cli_id, fi.cli_id, NULLIF(v.afCliente, 0)) AS customerId,
      cli.nombre AS customerName,
      cli.rfc AS customerRfc,
      cli.domicilio,
      cli.noExt,
      cli.noInt,
      cli.colonia,
      cli.localidad,
      cli.ciudad,
      cc.cli_id AS creditClientId,
      fi.fac_id AS invoiceFacId,
      fi.invoiceNumbers
    FROM venta v
    LEFT JOIN ticket t ON t.tic_id = v.tic_id
    LEFT JOIN remision r ON r.rem_id = v.rem_id
    LEFT JOIN (
      SELECT ven_id, MIN(cli_id) AS cli_id
      FROM creditocliente
      GROUP BY ven_id
    ) cc ON cc.ven_id = v.ven_id
    LEFT JOIN (
      SELECT
        fv.ven_id,
        MIN(f.fac_id) AS fac_id,
        MIN(f.cli_id) AS cli_id,
        GROUP_CONCAT(DISTINCT CONCAT(COALESCE(f.letraFolio, ''), COALESCE(f.folio, '')) ORDER BY f.fac_id SEPARATOR ',') AS invoiceNumbers
      FROM facturaven fv
      INNER JOIN factura f ON f.fac_id = fv.fac_id
      GROUP BY fv.ven_id
    ) fi ON fi.ven_id = v.ven_id
    LEFT JOIN cliente cli ON cli.cli_id = COALESCE(t.cli_id, r.cli_id, cc.cli_id, fi.cli_id, NULLIF(v.afCliente, 0))
    LEFT JOIN caja c ON c.caj_id = v.caj_id
    WHERE ${filterSql}
      AND COALESCE(t.cli_id, r.cli_id, cc.cli_id, fi.cli_id, NULLIF(v.afCliente, 0), 0) <> ?
    ORDER BY v.ven_id
  `, [...params, excludedClientId]);

  const entriesBySaleId = new Map();
  const { branchId, branchName } = getBranchConfig();

  rows.forEach((row) => {
    const saleId = Number(row.ven_id);
    const date = toLocalDate(row.fecha);
    const subtotal = money(row.subtotal);
    const subtotalExento = money(row.subtotal0);
    const total = money(row.total);
    const saleType = getSaleType(row);
    const ticketCode = buildTicketCode(row);
    const customerName = String(row.customerName || 'PUBLICO EN GENERAL').trim();
    const isCancelled = Number(row.status || 0) < 0 || row.can_caj_id !== null || row.can_rcc_id !== null;

    entriesBySaleId.set(saleId, {
      id: `sicar_ticket_${branchId}_${saleId}`,
      sourceSystem: 'SICAR',
      sourceType: 'ticket_sale',
      sourceMode: 'local-worker-watch',
      branch: branchId,
      branchId,
      branchName,
      date,
      month: date.substring(0, 7),
      saleDateTime: toDateTime(row.fecha),
      saleId,
      venId: saleId,
      ticketId: row.tic_id || null,
      ticId: row.tic_id || null,
      ticketNumber: row.tic_id ? String(row.tic_id) : String(saleId),
      ticketCode,
      saleType,
      customerId: row.customerId || null,
      customerName,
      customerRfc: String(row.customerRfc || '').trim(),
      customerAddress: compactAddress(row),
      cashboxId: row.caj_id || null,
      cashboxName: String(row.cashboxName || '').trim(),
      subtotal,
      subtotalExento,
      subtotalGravado: money(Math.max(subtotal - subtotalExento, 0)),
      iva: money(total - subtotal),
      discount: money(row.descuento),
      total,
      change: money(row.cambio),
      purchaseSubtotal: money(row.subtotalCompra),
      purchaseTotal: money(row.totalCompra),
      grossProfitSubtotal: money(row.subtotalUtilidad),
      grossProfitTotal: money(row.totalUtilidad),
      weight: money(row.peso),
      currency: String(row.monAbr || 'NIO').trim() || 'NIO',
      exchangeRate: money(row.monTipoCambio || 1),
      comment: String(row.comentario || '').trim(),
      fiscalFolio: String(row.afFolio || '').trim(),
      linkedInvoiceNumbers: String(row.invoiceNumbers || '').split(',').map((value) => value.trim()).filter(Boolean),
      status: isCancelled ? 'cancelled' : 'active',
      isCancelled,
      cancellationCashboxId: row.can_caj_id || null,
      cancellationClosureId: row.can_rcc_id || null,
      paymentBreakdown: [],
      items: [],
    });
  });

  await attachSaleItems(connection, entriesBySaleId);
  await attachSalePayments(connection, entriesBySaleId);

  return [...entriesBySaleId.values()].map((entry) => ({
    ...entry,
    itemCount: entry.items.length,
    paymentTotal: money(entry.paymentBreakdown.reduce((sum, payment) => sum + money(payment.amount), 0)),
  }));
}

async function fetchTicketSalesByIds(connection, saleIds = []) {
  const ids = [...new Set(saleIds.map(Number).filter(Number.isFinite))];
  if (!ids.length) return [];
  return fetchSalesWithFilter(connection, `v.ven_id IN (${placeholders(ids)})`, ids);
}

async function fetchTicketSales(connection, startDate, endExclusive) {
  return fetchSalesWithFilter(connection, 'v.fecha >= ? AND v.fecha < ?', [startDate, endExclusive]);
}

function buildTicketFingerprint(entry = {}) {
  return stableStringify({
    cashboxId: entry.cashboxId,
    change: entry.change,
    customerId: entry.customerId,
    customerName: entry.customerName,
    customerRfc: entry.customerRfc,
    date: entry.date,
    discount: entry.discount,
    isCancelled: entry.isCancelled,
    items: entry.items,
    linkedInvoiceNumbers: entry.linkedInvoiceNumbers,
    paymentBreakdown: entry.paymentBreakdown,
    saleDateTime: entry.saleDateTime,
    saleType: entry.saleType,
    subtotal: entry.subtotal,
    subtotalExento: entry.subtotalExento,
    total: entry.total,
  });
}

function buildDailyRollup(entries = [], date = '') {
  const activeEntries = entries.filter((entry) => !entry.isCancelled && entry.status === 'active');
  const { branchId, branchName } = getBranchConfig();
  const paymentMap = new Map();

  activeEntries.forEach((entry) => {
    entry.paymentBreakdown.forEach((payment) => {
      const key = String(payment.method || 'SIN METODO').trim();
      paymentMap.set(key, money((paymentMap.get(key) || 0) + money(payment.amount)));
    });
  });

  const subtotal = money(activeEntries.reduce((sum, entry) => sum + entry.subtotal, 0));
  const subtotalExento = money(activeEntries.reduce((sum, entry) => sum + entry.subtotalExento, 0));
  const total = money(activeEntries.reduce((sum, entry) => sum + entry.total, 0));
  const dailySaleCode = `VENTA-${date.replace(/-/g, '')}`;

  return {
    id: `sicar_ticket_sales_${branchId}_${date.replace(/-/g, '')}`,
    date,
    month: date.substring(0, 7),
    saleDate: date,
    dailySaleCode,
    description: `VENTAS POR TICKET SICAR ${date}`,
    reference: dailySaleCode,
    amount: subtotal,
    subtotal,
    subtotalExento,
    subtotalGravado: money(Math.max(subtotal - subtotalExento, 0)),
    iva: money(total - subtotal),
    total,
    discount: money(activeEntries.reduce((sum, entry) => sum + entry.discount, 0)),
    purchaseTotal: money(activeEntries.reduce((sum, entry) => sum + entry.purchaseTotal, 0)),
    grossProfitTotal: money(activeEntries.reduce((sum, entry) => sum + entry.grossProfitTotal, 0)),
    ticketCount: activeEntries.length,
    cancelledTicketCount: entries.length - activeEntries.length,
    itemCount: activeEntries.reduce((sum, entry) => sum + Number(entry.itemCount || 0), 0),
    sourceRecordIds: activeEntries.map((entry) => String(entry.saleId)),
    ticketDocumentIds: activeEntries.map((entry) => entry.id),
    paymentBreakdown: [...paymentMap.entries()].map(([method, paymentTotal]) => ({ method, total: paymentTotal })),
    status: 'active',
    isCancelled: false,
    source: 'sicar',
    sourceLabel: 'SICAR TICKETS',
    sourceSystem: 'SICAR',
    sourceType: 'ticket_sales_rollup',
    sourceMode: 'local-worker-watch',
    sourceBranch: branchName,
    branch: branchId,
    branchId,
    branchName,
    syncKey: `sicar:ticket-sales:${branchId}:${date}`,
    timezone: TIMEZONE,
    is_conciled: false,
  };
}

function buildDailyRollupFingerprint(rollup = {}) {
  return stableStringify({
    amount: rollup.amount,
    cancelledTicketCount: rollup.cancelledTicketCount,
    discount: rollup.discount,
    grossProfitTotal: rollup.grossProfitTotal,
    itemCount: rollup.itemCount,
    iva: rollup.iva,
    paymentBreakdown: rollup.paymentBreakdown,
    purchaseTotal: rollup.purchaseTotal,
    sourceRecordIds: rollup.sourceRecordIds,
    subtotal: rollup.subtotal,
    subtotalExento: rollup.subtotalExento,
    ticketCount: rollup.ticketCount,
    total: rollup.total,
  });
}

async function writeTicketSale(db, entry, fingerprint = buildTicketFingerprint(entry)) {
  const FieldValue = admin.firestore.FieldValue;
  await db.collection('sicar_ventas_tickets').doc(entry.id).set({
    ...entry,
    sicarFingerprint: fingerprint,
    syncedBy: 'local-worker-watch',
    syncedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function writeDailyRollup(db, rollup, fingerprint = buildDailyRollupFingerprint(rollup)) {
  const FieldValue = admin.firestore.FieldValue;
  await db.collection('ingresos').doc(rollup.id).set({
    ...rollup,
    sicarFingerprint: fingerprint,
    syncedBy: 'local-worker-watch',
    syncedAt: FieldValue.serverTimestamp(),
    lastSyncedAt: FieldValue.serverTimestamp(),
    timestamp: FieldValue.serverTimestamp(),
  }, { merge: true });
}

module.exports = {
  buildDailyRollup,
  buildDailyRollupFingerprint,
  buildTicketFingerprint,
  fetchTicketSales,
  fetchTicketSalesByIds,
  getBranchConfig,
  getExcludedClientId,
  money,
  normalizeText,
  stableStringify,
  writeDailyRollup,
  writeTicketSale,
};
