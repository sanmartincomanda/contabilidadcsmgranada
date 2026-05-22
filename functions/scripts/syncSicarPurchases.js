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

function toDateString(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().substring(0, 10);
  return String(value).substring(0, 10);
}

function money(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function cleanText(value) {
  return String(value || '').trim();
}

function meaningfulText(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return '';
  if (['-', 'S/N', 'SN', 'N/A', 'NA', 'NULL', 'UNDEFINED'].includes(cleaned.toUpperCase())) return '';
  return cleaned;
}

function buildInvoiceNumber(row) {
  const series = meaningfulText(row.serieFolio);
  const folio = meaningfulText(row.folio);
  return [series, folio].filter(Boolean).join('-');
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

async function fetchPurchases(connection, startDate, endExclusive) {
  const [rows] = await connection.execute(`
    SELECT
      c.com_id,
      c.fecha,
      c.folio,
      c.serieFolio,
      c.subtotal,
      c.subtotal0,
      ROUND(GREATEST(c.subtotal - IFNULL(c.subtotal0, 0), 0), 2) AS subtotalGravado,
      ROUND(c.total - c.subtotal, 2) AS iva,
      c.total,
      c.comentario,
      c.status,
      c.can_caj_id,
      c.can_rcc_id,
      p.nombre AS proveedor
    FROM compra c
    LEFT JOIN proveedor p ON p.pro_id = c.pro_id
    WHERE c.fecha >= ?
      AND c.fecha < ?
      AND IFNULL(c.status, 0) >= 0
      AND c.can_caj_id IS NULL
      AND c.can_rcc_id IS NULL
    ORDER BY c.fecha, c.com_id
  `, [startDate, endExclusive]);

  return rows.map((row) => {
    const date = toDateString(row.fecha);
    const rawId = `compra_${row.com_id}`;
    const invoiceNumber = buildInvoiceNumber(row);
    const subtotal = money(row.subtotal);
    const subtotalExento = money(row.subtotal0);
    const iva = money(row.iva);
    const total = money(row.total);
    const supplier = cleanText(row.proveedor).toUpperCase() || 'PROVEEDOR NO IDENTIFICADO';

    return {
      rawId,
      compraId: `sicar_compra_${rawId}`,
      gastoDiarioId: `sicar_gd_${rawId}`,
      cuentaPorPagarId: `sicar_cxp_${rawId}`,
      sourceRecordId: String(row.com_id),
      date,
      month: date.substring(0, 7),
      supplier,
      invoiceNumber,
      purchaseFolio: meaningfulText(row.folio),
      purchaseSeries: meaningfulText(row.serieFolio),
      description: cleanText(row.comentario).toUpperCase(),
      amount: subtotal,
      subtotal,
      subtotalExento,
      subtotalGravado: money(row.subtotalGravado),
      iva,
      total,
      paymentMethod: 'transferencia',
      paymentRoute: 'otro',
      paymentType: 'Transferencia',
      rawPayload: {
        ...row,
        fecha: row.fecha instanceof Date ? row.fecha.toISOString() : row.fecha,
      },
    };
  });
}

async function writePurchase(db, entry, options) {
  const FieldValue = admin.firestore.FieldValue;
  const rawRef = db.collection('integraciones_privadas').doc('sicar').collection('compras_raw').doc(entry.rawId);
  const purchaseRef = db.collection('compras').doc(entry.compraId);
  const batch = db.batch();

  batch.set(rawRef, {
    sourceSystem: 'SICAR',
    sourceType: 'compra',
    sourceMode: 'local-worker',
    branch: BRANCH_ID,
    branchName: BRANCH_NAME,
    sourceRecordId: entry.sourceRecordId,
    normalized: {
      date: entry.date,
      month: entry.month,
      amount: entry.amount,
      subtotal: entry.subtotal,
      subtotalExento: entry.subtotalExento,
      subtotalGravado: entry.subtotalGravado,
      iva: entry.iva,
      total: entry.total,
      supplier: entry.supplier,
      invoiceNumber: entry.invoiceNumber,
      purchaseFolio: entry.purchaseFolio,
      purchaseSeries: entry.purchaseSeries,
      description: entry.description,
      paymentMethod: entry.paymentMethod,
      paymentRoute: entry.paymentRoute,
      sourceRecordId: entry.sourceRecordId,
      isCancelled: false,
    },
    rawPayload: entry.rawPayload,
    targetDocIds: {
      compraId: entry.compraId,
      gastoDiarioId: null,
      cuentaPorPagarId: null,
    },
    status: options.stageOnly ? 'pending' : 'processed',
    receivedAt: FieldValue.serverTimestamp(),
    lastSeenAt: FieldValue.serverTimestamp(),
    lastSeenBy: 'local-worker',
    syncedAt: FieldValue.serverTimestamp(),
    processedAt: options.stageOnly ? FieldValue.delete() : FieldValue.serverTimestamp(),
    processedBy: options.stageOnly ? FieldValue.delete() : 'local-worker',
    seenCount: FieldValue.increment(1),
  }, { merge: true });

  if (!options.stageOnly) {
    batch.delete(db.collection('cuentas_por_pagar').doc(entry.cuentaPorPagarId));
    batch.delete(db.collection('gastosDiarios').doc(entry.gastoDiarioId));
    batch.set(purchaseRef, {
      date: entry.date,
      month: entry.month,
      supplier: entry.supplier,
      invoiceNumber: entry.invoiceNumber,
      purchaseFolio: entry.purchaseFolio,
      purchaseSeries: entry.purchaseSeries,
      description: entry.description,
      amount: entry.amount,
      subtotal: entry.subtotal,
      subtotalExento: entry.subtotalExento,
      subtotalGravado: entry.subtotalGravado,
      iva: entry.iva,
      total: entry.total,
      branch: BRANCH_ID,
      branchName: BRANCH_NAME,
      paymentType: 'Transferencia',
      paymentMethodOriginal: 'transferencia',
      paymentRoute: 'otro',
      isInventoryCost: true,
      sourceCollection: `integraciones_privadas/sicar/compras_raw/${entry.rawId}`,
      sourceRawId: entry.rawId,
      sourceSystem: 'SICAR',
      sourceMode: 'local-worker',
      sourceRecordId: entry.sourceRecordId,
      sourceGastoDiarioId: null,
      sourceFacturaId: null,
      linkedPayableId: null,
      timestamp: FieldValue.serverTimestamp(),
      syncedAt: FieldValue.serverTimestamp(),
      lastSyncedAt: FieldValue.serverTimestamp(),
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
  const startDate = args.startDate || args.date;
  const endDate = args.endDate || args.date || startDate;
  assertDate(startDate, 'startDate');
  assertDate(endDate, 'endDate');
  if (endDate < startDate) throw new Error('endDate no puede ser menor que startDate.');

  const connection = await mysql.createConnection(getMysqlConfig());
  const db = initFirebase();

  try {
    const entries = await fetchPurchases(connection, startDate, addDays(endDate, 1));

    if (args.preview) {
      console.log(JSON.stringify({
        ok: true,
        preview: true,
        startDate,
        endDate,
        entryCount: entries.length,
        subtotal: money(entries.reduce((sum, entry) => sum + entry.subtotal, 0)),
        iva: money(entries.reduce((sum, entry) => sum + entry.iva, 0)),
        total: money(entries.reduce((sum, entry) => sum + entry.total, 0)),
        firstEntries: entries.slice(0, 10).map((entry) => ({
          rawId: entry.rawId,
          date: entry.date,
          supplier: entry.supplier,
          invoiceNumber: entry.invoiceNumber,
          subtotal: entry.subtotal,
          iva: entry.iva,
          total: entry.total,
          paymentType: entry.paymentType,
        })),
      }, null, 2));
      return;
    }

    for (const entry of entries) {
      await writePurchase(db, entry, { stageOnly: args.stageOnly });
    }

    await db.collection('sicar_sync_logs').add({
      syncType: 'compras',
      sourceMode: 'local-worker',
      branchId: BRANCH_ID,
      branchName: BRANCH_NAME,
      startDate,
      endDate,
      entryCount: entries.length,
      subtotal: money(entries.reduce((sum, entry) => sum + entry.subtotal, 0)),
      iva: money(entries.reduce((sum, entry) => sum + entry.iva, 0)),
      total: money(entries.reduce((sum, entry) => sum + entry.total, 0)),
      forcedPaymentType: 'Transferencia',
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
      entryCount: entries.length,
      subtotal: money(entries.reduce((sum, entry) => sum + entry.subtotal, 0)),
      iva: money(entries.reduce((sum, entry) => sum + entry.iva, 0)),
      total: money(entries.reduce((sum, entry) => sum + entry.total, 0)),
      paymentType: 'Transferencia',
    }, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
