const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');
const mysql = require('mysql2/promise');

const PROJECT_ID = 'sistema-contable-csm-granada';
const BRANCH_ID = 'granada';
const BRANCH_NAME = 'CARNES SAN MARTIN GRANADA';
const TIMEZONE = 'America/Managua';
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
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
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

function getManaguaDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
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

function getMysqlConfig() {
  const host = process.env.MYSQL_HOST || process.env.SICAR_DB_HOST || '127.0.0.1';
  const port = Number(process.env.MYSQL_PORT || process.env.SICAR_DB_PORT || 3307);
  const database = process.env.MYSQL_DATABASE || process.env.SICAR_DB_NAME || 'sicar';
  const user = process.env.MYSQL_USER || process.env.SICAR_DB_USER || 'root';
  const password = process.env.MYSQL_PASSWORD || process.env.SICAR_DB_PASSWORD || '';

  if (!password) {
    throw new Error('Falta MYSQL_PASSWORD o SICAR_DB_PASSWORD en el entorno local.');
  }

  return {
    host,
    port,
    database,
    user,
    password,
    charset: 'utf8mb4',
  };
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

async function fetchDailySales(connection, startDate, endExclusive) {
  const activeWhere = `
    v.fecha >= ?
    AND v.fecha < ?
    AND IFNULL(v.status, 0) >= 0
    AND v.can_caj_id IS NULL
    AND v.can_rcc_id IS NULL
  `;

  const [totals] = await connection.execute(`
    SELECT
      DATE(v.fecha) AS saleDate,
      COUNT(v.ven_id) AS ticketCount,
      GROUP_CONCAT(v.ven_id ORDER BY v.ven_id SEPARATOR ',') AS sicarIds,
      ROUND(SUM(v.subtotal), 2) AS subtotal,
      ROUND(SUM(v.subtotal0), 2) AS subtotalExento,
      ROUND(SUM(GREATEST(v.subtotal - v.subtotal0, 0)), 2) AS subtotalGravado,
      ROUND(SUM(v.total - v.subtotal), 2) AS iva,
      ROUND(SUM(v.total), 2) AS total,
      MIN(v.fecha) AS firstSaleAt,
      MAX(v.fecha) AS lastSaleAt
    FROM venta v
    WHERE ${activeWhere}
    GROUP BY DATE(v.fecha)
    ORDER BY DATE(v.fecha)
  `, [startDate, endExclusive]);

  const [payments] = await connection.execute(`
    SELECT
      DATE(v.fecha) AS saleDate,
      COALESCE(tp.nombre, CONCAT('TIPO ', vtp.tpa_id)) AS method,
      ROUND(SUM(vtp.total), 2) AS total
    FROM venta v
    INNER JOIN ventatipopago vtp ON vtp.ven_id = v.ven_id
    LEFT JOIN tipopago tp ON tp.tpa_id = vtp.tpa_id
    WHERE ${activeWhere}
    GROUP BY DATE(v.fecha), COALESCE(tp.nombre, CONCAT('TIPO ', vtp.tpa_id))
    ORDER BY DATE(v.fecha), method
  `, [startDate, endExclusive]);

  const [cancelled] = await connection.execute(`
    SELECT
      DATE(v.fecha) AS saleDate,
      COUNT(v.ven_id) AS cancelledCount,
      GROUP_CONCAT(v.ven_id ORDER BY v.ven_id SEPARATOR ',') AS cancelledSicarIds,
      ROUND(SUM(v.subtotal), 2) AS cancelledSubtotal,
      ROUND(SUM(v.total), 2) AS cancelledTotal
    FROM venta v
    WHERE v.fecha >= ?
      AND v.fecha < ?
      AND (IFNULL(v.status, 0) < 0 OR v.can_caj_id IS NOT NULL OR v.can_rcc_id IS NOT NULL)
    GROUP BY DATE(v.fecha)
    ORDER BY DATE(v.fecha)
  `, [startDate, endExclusive]);

  return { totals, payments, cancelled };
}

function buildEntries({ totals, payments, cancelled }) {
  const totalsByDate = new Map(totals.map((row) => [toDateString(row.saleDate), row]));
  const cancelledByDate = new Map(cancelled.map((row) => [toDateString(row.saleDate), row]));
  const paymentsByDate = new Map();

  payments.forEach((row) => {
    const date = toDateString(row.saleDate);
    const items = paymentsByDate.get(date) || [];
    items.push({
      method: row.method || 'SIN METODO',
      total: money(row.total),
    });
    paymentsByDate.set(date, items);
  });

  const dates = new Set([...totalsByDate.keys(), ...cancelledByDate.keys()]);

  return Array.from(dates).sort().map((date) => {
    const totalRow = totalsByDate.get(date) || {};
    const cancelledRow = cancelledByDate.get(date) || {};
    const subtotal = money(totalRow.subtotal);
    const subtotalExento = money(totalRow.subtotalExento);
    const iva = money(totalRow.iva);
    const total = money(totalRow.total);
    const dailySaleCode = `VENTA-${date.replace(/-/g, '')}`;
    const rawId = `venta_diaria_${date}`;
    const paymentBreakdown = paymentsByDate.get(date) || [];

    return {
      rawId,
      ingresoId: `sicar_venta_diaria_${date}`,
      sourceSystem: 'SICAR',
      sourceType: 'daily_sale',
      type: 'daily_sale',
      saleDate: date,
      date,
      month: date.substring(0, 7),
      dailySaleCode,
      description: `VENTA DIARIA SICAR ${date}`,
      reference: dailySaleCode,
      amount: subtotal,
      subtotal,
      subtotalExento,
      subtotalGravado: money(totalRow.subtotalGravado || Math.max(subtotal - subtotalExento, 0)),
      iva,
      total,
      status: 'active',
      isCancelled: false,
      ticketCount: Number(totalRow.ticketCount || 0),
      sicarIds: totalRow.sicarIds ? String(totalRow.sicarIds).split(',') : [],
      paymentBreakdown,
      cancelledSummary: {
        cancelledCount: Number(cancelledRow.cancelledCount || 0),
        cancelledSicarIds: cancelledRow.cancelledSicarIds ? String(cancelledRow.cancelledSicarIds).split(',') : [],
        cancelledSubtotal: money(cancelledRow.cancelledSubtotal),
        cancelledTotal: money(cancelledRow.cancelledTotal),
      },
      firstSaleAt: toDateTimeString(totalRow.firstSaleAt),
      lastSaleAt: toDateTimeString(totalRow.lastSaleAt),
    };
  });
}

async function writeEntry(db, entry, options) {
  const FieldValue = admin.firestore.FieldValue;
  const rawRef = db.collection('integraciones_privadas').doc('sicar').collection('ventas_raw').doc(entry.rawId);
  const incomeRef = db.collection('ingresos').doc(entry.ingresoId);
  const rawStatus = options.stageOnly ? 'pending' : 'processed';
  const batch = db.batch();

  batch.set(rawRef, {
    sourceSystem: 'SICAR',
    sourceType: 'daily_sale',
    sourceMode: 'local-worker',
    branch: BRANCH_ID,
    branchName: BRANCH_NAME,
    sourceRecordId: entry.dailySaleCode,
    normalized: {
      type: 'daily_sale',
      sourceType: 'daily_sale',
      date: entry.date,
      month: entry.month,
      saleDate: entry.saleDate,
      dailySaleCode: entry.dailySaleCode,
      description: entry.description,
      reference: entry.reference,
      amount: entry.amount,
      subtotal: entry.subtotal,
      subtotalExento: entry.subtotalExento,
      subtotalGravado: entry.subtotalGravado,
      iva: entry.iva,
      total: entry.total,
      status: entry.status,
      isCancelled: entry.isCancelled,
      sicarIds: entry.sicarIds,
      paymentBreakdown: entry.paymentBreakdown,
      cancelledSummary: entry.cancelledSummary,
    },
    rawPayload: {
      ticketCount: entry.ticketCount,
      sicarIds: entry.sicarIds,
      paymentBreakdown: entry.paymentBreakdown,
      cancelledSummary: entry.cancelledSummary,
      firstSaleAt: entry.firstSaleAt,
      lastSaleAt: entry.lastSaleAt,
    },
    targetDocIds: {
      ingresoId: entry.ingresoId,
    },
    status: rawStatus,
    receivedAt: FieldValue.serverTimestamp(),
    lastSeenAt: FieldValue.serverTimestamp(),
    lastSeenBy: 'local-worker',
    syncedAt: FieldValue.serverTimestamp(),
    processedAt: options.stageOnly ? FieldValue.delete() : FieldValue.serverTimestamp(),
    processedBy: options.stageOnly ? FieldValue.delete() : 'local-worker',
    seenCount: FieldValue.increment(1),
  }, { merge: true });

  if (!options.stageOnly) {
    batch.set(incomeRef, {
      date: entry.date,
      month: entry.month,
      description: entry.description,
      reference: entry.reference,
      dailySaleCode: entry.dailySaleCode,
      amount: entry.amount,
      subtotal: entry.subtotal,
      subtotalExento: entry.subtotalExento,
      subtotalGravado: entry.subtotalGravado,
      iva: entry.iva,
      total: entry.total,
      branch: BRANCH_ID,
      branchName: BRANCH_NAME,
      source: 'sicar',
      sourceType: 'daily_sale',
      sourceLabel: 'SICAR',
      sourceSystem: 'SICAR',
      sourceBranch: BRANCH_NAME,
      sourceMode: 'local-worker',
      sourceCollection: `integraciones_privadas/sicar/ventas_raw/${entry.rawId}`,
      sourceRawId: entry.rawId,
      sourceRecordId: entry.dailySaleCode,
      sourceRecordIds: entry.sicarIds,
      paymentBreakdown: entry.paymentBreakdown,
      syncKey: `sicar:venta-diaria:${BRANCH_ID}:${entry.date}`,
      syncedBy: 'local-worker',
      syncedAt: FieldValue.serverTimestamp(),
      lastSyncedAt: FieldValue.serverTimestamp(),
      timestamp: FieldValue.serverTimestamp(),
      is_conciled: false,
      timezone: TIMEZONE,
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
  const startDate = args.startDate || args.date || getManaguaDate();
  const endDate = args.endDate || args.date || startDate;
  assertDate(startDate, 'startDate');
  assertDate(endDate, 'endDate');

  if (endDate < startDate) {
    throw new Error('endDate no puede ser menor que startDate.');
  }

  const connection = await mysql.createConnection(getMysqlConfig());
  const db = initFirebase();

  try {
    const rows = await fetchDailySales(connection, startDate, addDays(endDate, 1));
    const entries = buildEntries(rows);

    if (args.preview) {
      console.log(JSON.stringify({ ok: true, preview: true, startDate, endDate, entries }, null, 2));
      return;
    }

    for (const entry of entries) {
      await writeEntry(db, entry, { stageOnly: args.stageOnly });
    }

    await db.collection('sicar_sync_logs').add({
      syncType: 'ventas_diarias',
      sourceMode: 'local-worker',
      branchId: BRANCH_ID,
      branchName: BRANCH_NAME,
      startDate,
      endDate,
      entryCount: entries.length,
      subtotal: money(entries.reduce((sum, entry) => sum + entry.subtotal, 0)),
      iva: money(entries.reduce((sum, entry) => sum + entry.iva, 0)),
      total: money(entries.reduce((sum, entry) => sum + entry.total, 0)),
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
      entries: entries.map((entry) => ({
        rawId: entry.rawId,
        ingresoId: entry.ingresoId,
        subtotal: entry.subtotal,
        iva: entry.iva,
        total: entry.total,
      })),
    }, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
