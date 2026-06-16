const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');
const mysql = require('mysql2/promise');

const PROJECT_ID = 'sistema-contable-csm-granada';
const BRANCH_ID = 'granada';
const BRANCH_NAME = 'CARNES SAN MARTIN GRANADA';
const DEFAULT_KEY_PATH = 'C:\\SICAR\\keys\\firebase-adminsdk.json';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const separator = trimmed.indexOf('=');
    if (separator === -1) return;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}

function parseArgs(argv) {
  return argv.reduce((acc, arg) => {
    if (arg === '--preview') acc.preview = true;
    else if (arg === '--stage-only') acc.stageOnly = true;
    else if (arg.startsWith('--date=')) acc.date = arg.slice('--date='.length);
    else if (arg.startsWith('--startDate=')) acc.startDate = arg.slice('--startDate='.length);
    else if (arg.startsWith('--endDate=')) acc.endDate = arg.slice('--endDate='.length);
    return acc;
  }, { preview: false, stageOnly: false });
}

function assertDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
    throw new Error(`${label} debe tener formato YYYY-MM-DD.`);
  }
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().substring(0, 10);
}

function formatLocalDate(value) {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

function toDateString(value) {
  if (!value) return '';
  if (value instanceof Date) return formatLocalDate(value);
  return String(value).substring(0, 10);
}

function toDateTimeString(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function money(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function normalizeText(value = '') {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function compactAddress(row = {}) {
  return [
    row.domicilio,
    row.noExt ? `No. ${row.noExt}` : '',
    row.noInt ? `Int. ${row.noInt}` : '',
    row.colonia,
    row.localidad,
    row.ciudad,
    row.estado,
    row.pais,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(', ');
}

function getMysqlConfig() {
  const host = process.env.MYSQL_HOST || process.env.SICAR_DB_HOST || '127.0.0.1';
  const port = Number(process.env.MYSQL_PORT || process.env.SICAR_DB_PORT || 3307);
  const database = process.env.MYSQL_DATABASE || process.env.SICAR_DB_NAME || 'sicar';
  const user = process.env.MYSQL_USER || process.env.SICAR_DB_USER || 'root';
  const password = process.env.MYSQL_PASSWORD || process.env.SICAR_DB_PASSWORD || '';

  if (!password) throw new Error('Falta MYSQL_PASSWORD o SICAR_DB_PASSWORD en el entorno local.');

  return { host, port, database, user, password, charset: 'utf8mb4' };
}

function initFirebase() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(DEFAULT_KEY_PATH)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = DEFAULT_KEY_PATH;
  }

  if (admin.apps.length > 0) return admin.firestore();

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID || PROJECT_ID,
  });

  return admin.firestore();
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

async function fetchClosuresWithFilter(connection, whereClause, params = []) {
  const [closures] = await connection.execute(`
    SELECT
      c.cor_id,
      c.fecha,
      c.contado,
      c.calculado,
      c.diferencia,
      c.retiro,
      c.caj_id,
      cj.nombre AS cajaName,
      r.rcc_id,
      r.venCon,
      r.venCre,
      r.venConC,
      r.venCreC,
      r.entVen,
      r.entCre,
      r.salVenC,
      r.salNot,
      r.entMov,
      r.salMov
    FROM cortecaja c
    LEFT JOIN caja cj ON cj.caj_id = c.caj_id
    LEFT JOIN resumencortecaja r ON r.cor_id = c.cor_id
    WHERE ${whereClause}
    ORDER BY c.fecha, c.caj_id, c.cor_id
  `, params);

  const corIds = closures.map((row) => row.cor_id).filter(Boolean);
  if (corIds.length === 0) return [];

  const [cutPayments] = await connection.execute(`
    SELECT
      ctp.cor_id,
      ctp.tpa_id,
      COALESCE(tp.nombre, CONCAT('TIPO ', ctp.tpa_id)) AS method,
      ctp.contado,
      ctp.calculado,
      ctp.diferencia,
      ctp.retiro
    FROM cortetipopago ctp
    LEFT JOIN tipopago tp ON tp.tpa_id = ctp.tpa_id
    WHERE ctp.cor_id IN (${placeholders(corIds)})
    ORDER BY ctp.cor_id, method
  `, corIds);

  const [ticketSummary] = await connection.execute(`
    SELECT
      r.cor_id,
      r.rcc_id,
      COUNT(v.ven_id) AS ticketCount,
      ROUND(SUM(CASE WHEN IFNULL(v.status, 0) >= 0 AND v.can_caj_id IS NULL AND v.can_rcc_id IS NULL THEN v.subtotal ELSE 0 END), 2) AS activeSubtotal,
      ROUND(SUM(CASE WHEN IFNULL(v.status, 0) >= 0 AND v.can_caj_id IS NULL AND v.can_rcc_id IS NULL THEN v.total ELSE 0 END), 2) AS activeTotal,
      ROUND(SUM(CASE WHEN IFNULL(v.status, 0) < 0 OR v.can_caj_id IS NOT NULL OR v.can_rcc_id IS NOT NULL THEN v.total ELSE 0 END), 2) AS cancelledTotal
    FROM resumencortecaja r
    LEFT JOIN venta v ON v.rcc_id = r.rcc_id
    WHERE r.cor_id IN (${placeholders(corIds)})
    GROUP BY r.cor_id, r.rcc_id
  `, corIds);

  const [ticketPayments] = await connection.execute(`
    SELECT
      r.cor_id,
      COALESCE(tp.nombre, CONCAT('TIPO ', vtp.tpa_id)) AS method,
      ROUND(SUM(vtp.total), 2) AS total
    FROM resumencortecaja r
    INNER JOIN venta v ON v.rcc_id = r.rcc_id
    INNER JOIN ventatipopago vtp ON vtp.ven_id = v.ven_id
    LEFT JOIN tipopago tp ON tp.tpa_id = vtp.tpa_id
    WHERE r.cor_id IN (${placeholders(corIds)})
      AND IFNULL(v.status, 0) >= 0
      AND v.can_caj_id IS NULL
      AND v.can_rcc_id IS NULL
    GROUP BY r.cor_id, COALESCE(tp.nombre, CONCAT('TIPO ', vtp.tpa_id))
    ORDER BY r.cor_id, method
  `, corIds);

  const paymentsByCor = new Map();
  cutPayments.forEach((row) => {
    const list = paymentsByCor.get(row.cor_id) || [];
    list.push({
      method: row.method || 'SIN METODO',
      tpaId: row.tpa_id,
      counted: money(row.contado),
      calculated: money(row.calculado),
      difference: money(row.diferencia),
      withdrawal: money(row.retiro),
    });
    paymentsByCor.set(row.cor_id, list);
  });

  const ticketPaymentsByCor = new Map();
  ticketPayments.forEach((row) => {
    const list = ticketPaymentsByCor.get(row.cor_id) || [];
    list.push({
      method: row.method || 'SIN METODO',
      total: money(row.total),
    });
    ticketPaymentsByCor.set(row.cor_id, list);
  });

  const summaryByCor = new Map(ticketSummary.map((row) => [row.cor_id, row]));

  return closures.map((row) => {
    const date = toDateString(row.fecha);
    const rawId = `cierre_caja_${row.cor_id}`;
    const summary = summaryByCor.get(row.cor_id) || {};
    const cashSalesGrossTotal = money(row.venCon);
    const cancelledCashSalesTotal = money(row.venConC);
    const creditSalesGrossTotal = money(row.venCre);
    const cancelledCreditSalesTotal = money(row.venCreC);
    const cashSalesNetTotal = money(cashSalesGrossTotal - cancelledCashSalesTotal);
    const creditSalesNetTotal = money(creditSalesGrossTotal - cancelledCreditSalesTotal);
    return {
      id: `sicar_cierre_${row.cor_id}`,
      rawId,
      date,
      month: date.substring(0, 7),
      closureDateTime: toDateTimeString(row.fecha),
      corId: row.cor_id,
      rccId: row.rcc_id || summary.rcc_id || null,
      cashboxId: row.caj_id,
      cashboxName: row.cajaName || `CAJA ${row.caj_id || ''}`.trim(),
      countedTotal: money(row.contado),
      calculatedTotal: money(row.calculado),
      sicarDifference: money(row.diferencia),
      withdrawalTotal: money(row.retiro),
      cashSalesGrossTotal,
      cashSalesTotal: cashSalesNetTotal,
      cashSalesNetTotal,
      creditSalesGrossTotal,
      creditSalesTotal: creditSalesNetTotal,
      creditSalesNetTotal,
      cancelledCashSalesTotal,
      cancelledCreditSalesTotal,
      salesIncomeTotal: money(row.entVen),
      creditRecoveryTotal: money(row.entCre),
      salesCancellationOutTotal: money(row.salVenC),
      activeTicketCount: Number(summary.ticketCount || 0),
      activeSalesSubtotal: money(summary.activeSubtotal),
      activeSalesTotal: money(summary.activeTotal),
      cancelledSalesTotal: money(summary.cancelledTotal),
      cutPaymentBreakdown: paymentsByCor.get(row.cor_id) || [],
      ticketPaymentBreakdown: ticketPaymentsByCor.get(row.cor_id) || [],
    };
  });
}

async function fetchClosures(connection, startDate, endExclusive) {
  return fetchClosuresWithFilter(connection, 'c.fecha >= ? AND c.fecha < ?', [startDate, endExclusive]);
}

async function fetchClosuresByIds(connection, corIds = []) {
  const ids = [...new Set((corIds || []).map((id) => Number(id)).filter(Number.isFinite))];
  if (ids.length === 0) return [];
  return fetchClosuresWithFilter(connection, `c.cor_id IN (${placeholders(ids)})`, ids);
}

function normalizeInvoiceRow(row, sourceDate = '') {
  const invoiceDate = toDateString(sourceDate || row.fecha || row.ventaFecha);
  const invoiceNumber = [row.letraFolio, row.folio].filter(Boolean).join('').trim() || String(row.fac_id || '');
  return {
    id: `sicar_factura_${row.fac_id}`,
    rawId: `factura_membretada_${row.fac_id}`,
    date: invoiceDate,
    saleDate: invoiceDate,
    month: invoiceDate.substring(0, 7),
    facId: row.fac_id,
    invoiceNumber,
    numeroFactura: invoiceNumber,
    folio: row.folio || '',
    letraFolio: row.letraFolio || '',
    customerId: row.cli_id || null,
    customerName: row.cliente || '',
    cashboxId: row.caj_id || null,
    cashboxName: row.cajaName || '',
    customerAddress: compactAddress(row),
    customerRfc: row.rfc || row.customerRfc || '',
    subtotalExento: money(row.subtotal0),
    subtotal: money(row.subtotal),
    iva: money(money(row.total) - money(row.subtotal)),
    total: money(row.total),
    status: row.status,
    sourceDateTime: toDateTimeString(row.fecha || row.ventaFecha),
    sicarSaleIds: [],
    items: [],
  };
}

async function fetchStampedInvoices(connection, startDate, endExclusive) {
  const [directRows] = await connection.execute(`
    SELECT
      f.fac_id,
      f.folio,
      f.letraFolio,
      f.fecha,
      f.subtotal0,
      f.subtotal,
      f.total,
      f.status,
      f.cli_id,
      cli.nombre AS cliente,
      cli.domicilio,
      cli.noExt,
      cli.noInt,
      cli.colonia,
      cli.localidad,
      cli.ciudad,
      cli.estado,
      cli.pais,
      cli.rfc,
      f.caj_id,
      cj.nombre AS cajaName
    FROM factura f
    LEFT JOIN cliente cli ON cli.cli_id = f.cli_id
    LEFT JOIN caja cj ON cj.caj_id = f.caj_id
    WHERE f.fecha >= ?
      AND f.fecha < ?
    ORDER BY f.fecha, f.fac_id
  `, [startDate, endExclusive]);

  const [linkedRows] = await connection.execute(`
    SELECT
      f.fac_id,
      f.folio,
      f.letraFolio,
      f.fecha,
      MIN(v.fecha) AS ventaFecha,
      f.subtotal0,
      f.subtotal,
      f.total,
      f.status,
      f.cli_id,
      cli.nombre AS cliente,
      cli.domicilio,
      cli.noExt,
      cli.noInt,
      cli.colonia,
      cli.localidad,
      cli.ciudad,
      cli.estado,
      cli.pais,
      cli.rfc,
      f.caj_id,
      cj.nombre AS cajaName
    FROM facturaven fv
    INNER JOIN factura f ON f.fac_id = fv.fac_id
    INNER JOIN venta v ON v.ven_id = fv.ven_id
    LEFT JOIN cliente cli ON cli.cli_id = f.cli_id
    LEFT JOIN caja cj ON cj.caj_id = f.caj_id
    WHERE v.fecha >= ?
      AND v.fecha < ?
    GROUP BY
      f.fac_id,
      f.folio,
      f.letraFolio,
      f.fecha,
      f.subtotal0,
      f.subtotal,
      f.total,
      f.status,
      f.cli_id,
      cli.nombre,
      cli.domicilio,
      cli.noExt,
      cli.noInt,
      cli.colonia,
      cli.localidad,
      cli.ciudad,
      cli.estado,
      cli.pais,
      cli.rfc,
      f.caj_id,
      cj.nombre
    ORDER BY ventaFecha, f.fac_id
  `, [startDate, endExclusive]);

  const map = new Map();
  directRows.forEach((row) => map.set(row.fac_id, normalizeInvoiceRow(row)));
  linkedRows.forEach((row) => map.set(row.fac_id, normalizeInvoiceRow(row, row.ventaFecha)));

  await attachInvoiceItems(connection, map);
  return [...map.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

async function attachInvoiceItems(connection, map) {
  const facIds = [...map.keys()].filter(Boolean);
  if (facIds.length === 0) return;

  const [lineRows] = await connection.execute(`
    SELECT
      fv.fac_id,
      fv.ven_id,
      dv.orden,
      dv.art_id,
      dv.clave,
      dv.descripcion,
      dv.cantidad,
      dv.unidad,
      dv.precioSin,
      dv.importeSin,
      dv.precioCon,
      dv.importeCon,
      dv.sinGravar
    FROM facturaven fv
    INNER JOIN detallev dv ON dv.ven_id = fv.ven_id
    WHERE fv.fac_id IN (${placeholders(facIds)})
    ORDER BY fv.fac_id, fv.ven_id, dv.orden, dv.descripcion
  `, facIds);

  lineRows.forEach((row) => {
    const invoice = map.get(row.fac_id);
    if (!invoice) return;
    const saleIds = new Set(invoice.sicarSaleIds || []);
    saleIds.add(row.ven_id);
    invoice.sicarSaleIds = [...saleIds];
    invoice.items = [
      ...(invoice.items || []),
      {
        saleId: row.ven_id,
        articleId: row.art_id,
        code: row.clave || '',
        description: row.descripcion || '',
        quantity: money(row.cantidad),
        unit: row.unidad || '',
        unitPriceWithoutTax: money(row.precioSin),
        unitPriceWithTax: money(row.precioCon),
        totalWithoutTax: money(row.importeSin),
        totalWithTax: money(row.importeCon),
        taxable: !row.sinGravar,
        order: Number(row.orden || 0),
      },
    ];
  });
}

async function fetchStampedInvoicesByIds(connection, facIds) {
  const ids = [...new Set((facIds || []).map((id) => Number(id)).filter(Number.isFinite))];
  if (ids.length === 0) return [];

  const [rows] = await connection.execute(`
    SELECT
      f.fac_id,
      f.folio,
      f.letraFolio,
      f.fecha,
      MIN(v.fecha) AS ventaFecha,
      f.subtotal0,
      f.subtotal,
      f.total,
      f.status,
      f.cli_id,
      cli.nombre AS cliente,
      cli.domicilio,
      cli.noExt,
      cli.noInt,
      cli.colonia,
      cli.localidad,
      cli.ciudad,
      cli.estado,
      cli.pais,
      cli.rfc,
      f.caj_id,
      cj.nombre AS cajaName
    FROM factura f
    LEFT JOIN facturaven fv ON fv.fac_id = f.fac_id
    LEFT JOIN venta v ON v.ven_id = fv.ven_id
    LEFT JOIN cliente cli ON cli.cli_id = f.cli_id
    LEFT JOIN caja cj ON cj.caj_id = f.caj_id
    WHERE f.fac_id IN (${placeholders(ids)})
    GROUP BY
      f.fac_id,
      f.folio,
      f.letraFolio,
      f.fecha,
      f.subtotal0,
      f.subtotal,
      f.total,
      f.status,
      f.cli_id,
      cli.nombre,
      cli.domicilio,
      cli.noExt,
      cli.noInt,
      cli.colonia,
      cli.localidad,
      cli.ciudad,
      cli.estado,
      cli.pais,
      cli.rfc,
      f.caj_id,
      cj.nombre
    ORDER BY f.fac_id
  `, ids);

  const map = new Map();
  rows.forEach((row) => map.set(row.fac_id, normalizeInvoiceRow(row, row.ventaFecha)));
  await attachInvoiceItems(connection, map);
  return [...map.values()].sort((a, b) => Number(a.facId || 0) - Number(b.facId || 0));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function buildClosureFingerprint(entry = {}) {
  return stableStringify({
    activeSalesSubtotal: entry.activeSalesSubtotal,
    activeSalesTotal: entry.activeSalesTotal,
    activeTicketCount: entry.activeTicketCount,
    calculatedTotal: entry.calculatedTotal,
    cancelledCashSalesTotal: entry.cancelledCashSalesTotal,
    cancelledCreditSalesTotal: entry.cancelledCreditSalesTotal,
    cancelledSalesTotal: entry.cancelledSalesTotal,
    cashSalesGrossTotal: entry.cashSalesGrossTotal,
    cashSalesNetTotal: entry.cashSalesNetTotal,
    cashSalesTotal: entry.cashSalesTotal,
    countedTotal: entry.countedTotal,
    creditRecoveryTotal: entry.creditRecoveryTotal,
    creditSalesGrossTotal: entry.creditSalesGrossTotal,
    creditSalesNetTotal: entry.creditSalesNetTotal,
    creditSalesTotal: entry.creditSalesTotal,
    cutPaymentBreakdown: entry.cutPaymentBreakdown,
    date: entry.date,
    rccId: entry.rccId,
    sicarDifference: entry.sicarDifference,
    ticketPaymentBreakdown: entry.ticketPaymentBreakdown,
    withdrawalTotal: entry.withdrawalTotal,
  });
}

async function writeClosure(db, entry, options) {
  const FieldValue = admin.firestore.FieldValue;
  const batch = db.batch();
  const rawRef = db.collection('integraciones_privadas').doc('sicar').collection('cierres_caja_raw').doc(entry.rawId);
  const visibleRef = db.collection('sicar_cierres_caja').doc(entry.id);

  batch.set(rawRef, {
    sourceSystem: 'SICAR',
    sourceType: 'cash_closure',
    sourceMode: 'local-worker',
    branch: BRANCH_ID,
    branchName: BRANCH_NAME,
    sourceRecordId: entry.corId,
    normalized: entry,
    rawPayload: entry,
    status: options.stageOnly ? 'pending' : 'processed',
    receivedAt: FieldValue.serverTimestamp(),
    lastSeenAt: FieldValue.serverTimestamp(),
    syncedAt: FieldValue.serverTimestamp(),
    seenCount: FieldValue.increment(1),
  }, { merge: true });

  if (!options.stageOnly) {
    batch.set(visibleRef, {
      ...entry,
      source: 'sicar',
      sourceSystem: 'SICAR',
      sourceType: 'cash_closure',
      sourceMode: 'local-worker',
      branch: BRANCH_ID,
      branchName: BRANCH_NAME,
      updatedAt: FieldValue.serverTimestamp(),
      syncedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  await batch.commit();
}

async function writeClosureIfChanged(db, entry, options = {}) {
  if (options.stageOnly) {
    await writeClosure(db, entry, options);
    return { written: true, reason: 'stage-only' };
  }

  const fingerprint = buildClosureFingerprint(entry);
  const visibleRef = db.collection('sicar_cierres_caja').doc(entry.id);
  const snapshot = await visibleRef.get();

  if (snapshot.exists && snapshot.get('sicarFingerprint') === fingerprint) {
    return { written: false, reason: 'unchanged' };
  }

  await writeClosure(db, { ...entry, sicarFingerprint: fingerprint }, options);
  return { written: true, reason: snapshot.exists ? 'changed' : 'new' };
}

async function writeInvoice(db, entry, options) {
  const FieldValue = admin.firestore.FieldValue;
  const batch = db.batch();
  const rawRef = db.collection('integraciones_privadas').doc('sicar').collection('facturas_membretadas_raw').doc(entry.rawId);
  const visibleRef = db.collection('sicar_facturas_membretadas').doc(entry.id);

  batch.set(rawRef, {
    sourceSystem: 'SICAR',
    sourceType: 'stamped_sale_invoice',
    sourceMode: 'local-worker',
    branch: BRANCH_ID,
    branchName: BRANCH_NAME,
    sourceRecordId: entry.facId,
    normalized: entry,
    rawPayload: entry,
    status: options.stageOnly ? 'pending' : 'processed',
    receivedAt: FieldValue.serverTimestamp(),
    lastSeenAt: FieldValue.serverTimestamp(),
    syncedAt: FieldValue.serverTimestamp(),
    seenCount: FieldValue.increment(1),
  }, { merge: true });

  if (!options.stageOnly) {
    batch.set(visibleRef, {
      ...entry,
      normalizedCustomerName: normalizeText(entry.customerName),
      source: 'sicar',
      sourceSystem: 'SICAR',
      sourceType: 'stamped_sale_invoice',
      sourceMode: 'local-worker',
      branch: BRANCH_ID,
      branchName: BRANCH_NAME,
      updatedAt: FieldValue.serverTimestamp(),
      syncedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  await batch.commit();
}

async function main() {
  const rootDir = path.resolve(__dirname, '..', '..');
  const functionsDir = path.resolve(__dirname, '..');
  loadEnvFile(path.join(rootDir, '.env.local'));
  loadEnvFile(path.join(functionsDir, '.env.local'));

  const args = parseArgs(process.argv.slice(2));
  const startDate = args.startDate || args.date || toDateString(new Date());
  const endDate = args.endDate || args.date || startDate;
  assertDate(startDate, 'startDate');
  assertDate(endDate, 'endDate');
  if (endDate < startDate) throw new Error('endDate no puede ser menor que startDate.');

  const endExclusive = addDays(endDate, 1);
  const connection = await mysql.createConnection(getMysqlConfig());

  try {
    const closures = await fetchClosures(connection, startDate, endExclusive);
    const invoices = await fetchStampedInvoices(connection, startDate, endExclusive);

    if (args.preview) {
      console.log(JSON.stringify({ ok: true, preview: true, startDate, endDate, closures, invoices }, null, 2));
      return;
    }

    const db = initFirebase();
    for (const entry of closures) await writeClosure(db, entry, { stageOnly: args.stageOnly });
    for (const entry of invoices) await writeInvoice(db, entry, { stageOnly: args.stageOnly });

    await db.collection('sicar_sync_logs').add({
      syncType: 'facturacion',
      sourceMode: 'local-worker',
      branchId: BRANCH_ID,
      branchName: BRANCH_NAME,
      startDate,
      endDate,
      closureCount: closures.length,
      invoiceCount: invoices.length,
      closureTotal: money(closures.reduce((sum, entry) => sum + entry.calculatedTotal, 0)),
      invoiceTotal: money(invoices.reduce((sum, entry) => sum + entry.total, 0)),
      stageOnly: args.stageOnly,
      status: 'ok',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(JSON.stringify({
      ok: true,
      preview: false,
      stageOnly: args.stageOnly,
      startDate,
      endDate,
      closureCount: closures.length,
      invoiceCount: invoices.length,
      closures: closures.map((entry) => ({
        id: entry.id,
        date: entry.date,
        cashboxName: entry.cashboxName,
        calculatedTotal: entry.calculatedTotal,
        creditRecoveryTotal: entry.creditRecoveryTotal,
      })),
      invoices: invoices.map((entry) => ({
        id: entry.id,
        date: entry.date,
        invoiceNumber: entry.invoiceNumber,
        customerName: entry.customerName,
        total: entry.total,
      })),
    }, null, 2));
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  addDays,
  fetchClosures,
  fetchClosuresByIds,
  fetchStampedInvoices,
  fetchStampedInvoicesByIds,
  getMysqlConfig,
  initFirebase,
  loadEnvFile,
  money,
  toDateString,
  writeClosure,
  writeClosureIfChanged,
  writeInvoice,
};
