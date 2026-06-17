const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const admin = require('firebase-admin');
const mysql = require('mysql2/promise');

const PROJECT_ID = 'sistema-contable-csm-granada';
const BRANCH_ID = 'granada';
const BRANCH_NAME = 'CARNES SAN MARTIN GRANADA';
const TIMEZONE = 'America/Managua';
const DEFAULT_KEY_PATH = 'C:\\SICAR\\keys\\firebase-adminsdk.json';
const DEFAULT_EXCLUDED_SUPPLIER_ID = 136;
const DEFAULT_EXCLUDED_SUPPLIER_NAME = 'CARNES AMPARITO';
const PURCHASE_CATEGORY_PAYLOAD = {
  category: 'Costos de venta / compras',
  categoria: 'Costos de venta / compras',
  subcategory: 'Otros costos de producto',
  subcategoria: 'Otros costos de producto',
  expenseCategory: 'Costos de venta / compras',
  expenseSubcategory: 'Otros costos de producto',
  categoryLabel: 'Costos de venta / compras / Otros costos de producto',
};

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
    else if (arg.startsWith('--lookbackDays=')) acc.lookbackDays = arg.slice('--lookbackDays='.length);
    return acc;
  }, { preview: false, stageOnly: false });
}

function normalizeLookbackDays(value) {
  const parsed = Number(value ?? process.env.SICAR_PURCHASE_SYNC_LOOKBACK_DAYS ?? 7);
  if (!Number.isFinite(parsed) || parsed < 0) return 7;
  return Math.min(Math.floor(parsed), 31);
}

function getManaguaNowParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());

  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(lookup.hour || 0);

  return {
    date: `${lookup.year}-${lookup.month}-${lookup.day}`,
    hour: Number.isFinite(hour) ? hour : 0,
  };
}

function getDefaultClosingDate() {
  const now = getManaguaNowParts();
  return now.hour >= 20 ? now.date : addDays(now.date, -1);
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

function money(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function cleanText(value) {
  return String(value || '').trim();
}

function normalizeComparableText(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
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

function resolvePaymentFromSicar(row) {
  const ids = cleanText(row.paymentTypeIds)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const names = normalizeComparableText(row.paymentTypeNames);
  const hasCreditRecord = Boolean(row.creditDueDate || Number(row.creditTotal || 0) > 0);

  if (ids.includes('3') || names.includes('credito') || names.includes('crédito') || hasCreditRecord) {
    return {
      paymentMethod: 'credito',
      paymentRoute: 'credito',
      paymentType: 'Credito',
    };
  }

  if (ids.includes('1') || names.includes('efectivo') || names.includes('cash')) {
    return {
      paymentMethod: 'efectivo',
      paymentRoute: 'efectivo',
      paymentType: 'Efectivo',
    };
  }

  return {
    paymentMethod: names || 'transferencia',
    paymentRoute: 'otro',
    paymentType: 'Transferencia',
  };
}

function buildPurchaseDescription(entry) {
  return [
    entry.supplier || 'COMPRA SICAR',
    entry.invoiceNumber ? `FACTURA ${entry.invoiceNumber}` : 'SIN FACTURA',
    entry.description,
  ].filter(Boolean).join(' / ');
}

function buildRawSourcePath(rawId) {
  return `integraciones_privadas/sicar/compras_raw/${rawId}`;
}

function getPurchaseTargetIds(rawId) {
  return {
    compraId: `sicar_compra_${rawId}`,
    gastoDiarioId: `sicar_gd_${rawId}`,
    cuentaPorPagarId: `sicar_cxp_${rawId}`,
  };
}

function buildSyncFingerprint(entry) {
  return createHash('sha1')
    .update(JSON.stringify({
      date: entry.date,
      supplier: entry.supplier,
      invoiceNumber: entry.invoiceNumber,
      subtotal: entry.subtotal,
      subtotalExento: entry.subtotalExento,
      subtotalGravado: entry.subtotalGravado,
      iva: entry.iva,
      total: entry.total,
      paymentRoute: entry.paymentRoute,
      paymentType: entry.paymentType,
      paymentTypeIds: entry.paymentTypeIds,
      paymentTypeNames: entry.paymentTypeNames,
      dueDate: entry.dueDate || '',
      status: 'active',
    }))
    .digest('hex');
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

function getExcludedSupplierId() {
  const parsed = Number(process.env.SICAR_EXCLUDED_PURCHASE_SUPPLIER_ID || DEFAULT_EXCLUDED_SUPPLIER_ID);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EXCLUDED_SUPPLIER_ID;
}

function getExcludedSupplierName() {
  return cleanText(process.env.SICAR_EXCLUDED_PURCHASE_SUPPLIER_NAME || DEFAULT_EXCLUDED_SUPPLIER_NAME)
    .toUpperCase() || DEFAULT_EXCLUDED_SUPPLIER_NAME;
}

function getExcludedSupplierParams() {
  return [getExcludedSupplierId(), getExcludedSupplierName()];
}

function getExcludedSupplierFilterSql(alias = 'p') {
  return `
    AND NOT (
      ${alias}.pro_id = ?
      OR UPPER(TRIM(${alias}.nombre)) = ?
    )
  `;
}

function getOnlyExcludedSupplierFilterSql(alias = 'p') {
  return `
    AND (
      ${alias}.pro_id = ?
      OR UPPER(TRIM(${alias}.nombre)) = ?
    )
  `;
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
  const excludedSupplierFilterSql = getExcludedSupplierFilterSql('p');
  const excludedSupplierParams = getExcludedSupplierParams();
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
      p.nombre AS proveedor,
      GROUP_CONCAT(DISTINCT ctp.tpa_id ORDER BY ctp.tpa_id SEPARATOR ',') AS paymentTypeIds,
      GROUP_CONCAT(DISTINCT tp.nombre ORDER BY tp.tpa_id SEPARATOR ', ') AS paymentTypeNames,
      SUM(IFNULL(ctp.total, 0)) AS paymentTypeTotal,
      MAX(cp.fechaLimite) AS creditDueDate,
      SUM(IFNULL(cp.total, 0)) AS creditTotal
    FROM compra c
    LEFT JOIN proveedor p ON p.pro_id = c.pro_id
    LEFT JOIN compratipopago ctp ON ctp.com_id = c.com_id
    LEFT JOIN tipopago tp ON tp.tpa_id = ctp.tpa_id
    LEFT JOIN creditoproveedor cp ON cp.com_id = c.com_id AND IFNULL(cp.status, 0) >= 0
    WHERE c.fecha >= ?
      AND c.fecha < ?
      AND IFNULL(c.status, 0) >= 0
      AND c.can_caj_id IS NULL
      AND c.can_rcc_id IS NULL
      ${excludedSupplierFilterSql}
    GROUP BY
      c.com_id,
      c.fecha,
      c.folio,
      c.serieFolio,
      c.subtotal,
      c.subtotal0,
      c.total,
      c.comentario,
      c.status,
      c.can_caj_id,
      c.can_rcc_id,
      p.nombre
    ORDER BY c.fecha, c.com_id
  `, [startDate, endExclusive, ...excludedSupplierParams]);

  return rows.map((row) => {
    const date = toDateString(row.fecha);
    const rawId = `compra_${row.com_id}`;
    const targetIds = getPurchaseTargetIds(rawId);
    const invoiceNumber = buildInvoiceNumber(row);
    const subtotal = money(row.subtotal);
    const subtotalExento = money(row.subtotal0);
    const iva = money(row.iva);
    const total = money(row.total);
    const supplier = cleanText(row.proveedor).toUpperCase() || 'PROVEEDOR NO IDENTIFICADO';
    const payment = resolvePaymentFromSicar(row);

    return {
      rawId,
      ...targetIds,
      sourceRecordId: String(row.com_id),
      date,
      month: date.substring(0, 7),
      supplier,
      invoiceNumber,
      purchaseFolio: meaningfulText(row.folio),
      purchaseSeries: meaningfulText(row.serieFolio),
      description: cleanText(row.comentario).toUpperCase(),
      dueDate: toDateString(row.creditDueDate),
      amount: subtotal,
      subtotal,
      subtotalExento,
      subtotalGravado: money(row.subtotalGravado),
      iva,
      total,
      paymentMethod: payment.paymentMethod,
      paymentRoute: payment.paymentRoute,
      paymentType: payment.paymentType,
      paymentTypeIds: cleanText(row.paymentTypeIds),
      paymentTypeNames: cleanText(row.paymentTypeNames),
      paymentTypeTotal: money(row.paymentTypeTotal),
      rawPayload: {
        ...row,
        fecha: row.fecha instanceof Date ? row.fecha.toISOString() : row.fecha,
      },
    };
  });
}

async function fetchExcludedPurchases(connection, startDate, endExclusive) {
  const onlyExcludedSupplierFilterSql = getOnlyExcludedSupplierFilterSql('p');
  const excludedSupplierParams = getExcludedSupplierParams();
  const [rows] = await connection.execute(`
    SELECT
      c.com_id,
      c.fecha,
      c.folio,
      c.serieFolio,
      c.subtotal,
      ROUND(c.total - c.subtotal, 2) AS iva,
      c.total,
      p.pro_id AS supplierId,
      p.nombre AS supplier
    FROM compra c
    LEFT JOIN proveedor p ON p.pro_id = c.pro_id
    WHERE c.fecha >= ?
      AND c.fecha < ?
      AND IFNULL(c.status, 0) >= 0
      AND c.can_caj_id IS NULL
      AND c.can_rcc_id IS NULL
      ${onlyExcludedSupplierFilterSql}
    ORDER BY c.fecha, c.com_id
  `, [startDate, endExclusive, ...excludedSupplierParams]);

  return rows.map((row) => {
    const rawId = `compra_${row.com_id}`;
    return {
      rawId,
      ...getPurchaseTargetIds(rawId),
      sourceRecordId: String(row.com_id),
      date: toDateString(row.fecha),
      supplierId: Number(row.supplierId || 0),
      supplier: cleanText(row.supplier).toUpperCase() || getExcludedSupplierName(),
      invoiceNumber: buildInvoiceNumber(row),
      subtotal: money(row.subtotal),
      iva: money(row.iva),
      total: money(row.total),
    };
  });
}

async function deleteExcludedPurchases(db, excludedEntries, options) {
  if (options.stageOnly || excludedEntries.length === 0) {
    return { deletedCount: 0 };
  }

  const batch = db.batch();
  excludedEntries.forEach((entry) => {
    batch.delete(db.collection('integraciones_privadas').doc('sicar').collection('compras_raw').doc(entry.rawId));
    batch.delete(db.collection('compras').doc(entry.compraId));
    batch.delete(db.collection('gastosDiarios').doc(entry.gastoDiarioId));
    batch.delete(db.collection('cuentas_por_pagar').doc(entry.cuentaPorPagarId));
  });
  await batch.commit();
  return { deletedCount: excludedEntries.length };
}

async function writePurchase(db, entry, options) {
  const FieldValue = admin.firestore.FieldValue;
  const rawRef = db.collection('integraciones_privadas').doc('sicar').collection('compras_raw').doc(entry.rawId);
  const purchaseRef = db.collection('compras').doc(entry.compraId);
  const gastoDiarioRef = db.collection('gastosDiarios').doc(entry.gastoDiarioId);
  const cuentaPorPagarRef = db.collection('cuentas_por_pagar').doc(entry.cuentaPorPagarId);
  const sourceCollection = buildRawSourcePath(entry.rawId);
  const description = buildPurchaseDescription(entry).toUpperCase();
  const route = entry.paymentRoute;
  const syncFingerprint = buildSyncFingerprint(entry);
  const targetDocIds = {
    compraId: entry.compraId,
    gastoDiarioId: route === 'efectivo' ? entry.gastoDiarioId : null,
    cuentaPorPagarId: route === 'credito' ? entry.cuentaPorPagarId : null,
  };

  if (!options.stageOnly) {
    const existingRawSnapshot = await rawRef.get();
    if (existingRawSnapshot.exists && existingRawSnapshot.data()?.syncFingerprint === syncFingerprint) {
      const targetSnapshots = await Promise.all([
        purchaseRef.get(),
        route === 'credito' ? cuentaPorPagarRef.get() : Promise.resolve({ exists: true }),
        route === 'efectivo' ? gastoDiarioRef.get() : Promise.resolve({ exists: true }),
      ]);
      if (targetSnapshots.every((snapshot) => snapshot.exists)) {
        return { rawId: entry.rawId, skipped: true, route };
      }
    }
  }

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
      paymentType: entry.paymentType,
      paymentTypeIds: entry.paymentTypeIds,
      paymentTypeNames: entry.paymentTypeNames,
      paymentTypeTotal: entry.paymentTypeTotal,
      dueDate: entry.dueDate || '',
      sourceRecordId: entry.sourceRecordId,
      isCancelled: false,
    },
    rawPayload: entry.rawPayload,
    targetDocIds,
    resolvedRoute: route,
    syncFingerprint,
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
    const existingPayableSnapshot = route === 'credito'
      ? await cuentaPorPagarRef.get()
      : null;
    const existingPayable = existingPayableSnapshot?.exists ? existingPayableSnapshot.data() : null;
    const previousPayableTotal = money(existingPayable?.total ?? existingPayable?.monto);
    const previousPayableSaldo = money(existingPayable?.saldo ?? entry.total);
    const payableSaldo = existingPayable
      ? money(Math.max(previousPayableSaldo + (entry.total - previousPayableTotal), 0))
      : entry.total;

    const basePurchasePayload = {
      date: entry.date,
      month: entry.month,
      supplier: entry.supplier,
      invoiceNumber: entry.invoiceNumber,
      purchaseFolio: entry.purchaseFolio,
      purchaseSeries: entry.purchaseSeries,
      description,
      amount: entry.amount,
      subtotal: entry.subtotal,
      subtotalExento: entry.subtotalExento,
      subtotalGravado: entry.subtotalGravado,
      iva: entry.iva,
      total: entry.total,
      ...PURCHASE_CATEGORY_PAYLOAD,
      branch: BRANCH_ID,
      branchName: BRANCH_NAME,
      isInventoryCost: true,
      sourceCollection,
      sourceRawId: entry.rawId,
      sourceSystem: 'SICAR',
      sourceMode: 'local-worker',
      sourceRecordId: entry.sourceRecordId,
      paymentMethodOriginal: entry.paymentMethod,
      paymentRoute: route,
      syncedAt: FieldValue.serverTimestamp(),
      lastSyncedAt: FieldValue.serverTimestamp(),
      timestamp: FieldValue.serverTimestamp(),
    };

    if (route === 'credito') {
      batch.delete(gastoDiarioRef);
      batch.set(cuentaPorPagarRef, {
        fecha: entry.date,
        month: entry.month,
        proveedor: entry.supplier,
        sucursal: BRANCH_NAME,
        branch: BRANCH_ID,
        branchName: BRANCH_NAME,
        numero: entry.invoiceNumber,
        factura: entry.invoiceNumber,
        purchaseFolio: entry.purchaseFolio,
        purchaseSeries: entry.purchaseSeries,
        vencimiento: entry.dueDate || '',
        descripcion: description,
        monto: entry.total,
        saldo: payableSaldo,
        amount: entry.amount,
        subtotal: entry.subtotal,
        subtotalExento: entry.subtotalExento,
        subtotalGravado: entry.subtotalGravado,
        iva: entry.iva,
        total: entry.total,
        ...PURCHASE_CATEGORY_PAYLOAD,
        estado: payableSaldo <= 0 ? 'pagado' : payableSaldo < entry.total ? 'parcial' : 'pendiente',
        paymentType: 'credito',
        paymentMethodOriginal: 'credito',
        isInventoryCost: true,
        mirroredToCompras: true,
        mirroredPurchaseId: entry.compraId,
        sourceCollection,
        sourceRawId: entry.rawId,
        sourceSystem: 'SICAR',
        sourceMode: 'local-worker',
        sourceRecordId: entry.sourceRecordId,
        syncedAt: FieldValue.serverTimestamp(),
        lastSyncedAt: FieldValue.serverTimestamp(),
        timestamp: FieldValue.serverTimestamp(),
      }, { merge: true });
      batch.set(purchaseRef, {
        ...basePurchasePayload,
        paymentType: 'credito',
        sourceFacturaId: entry.cuentaPorPagarId,
        linkedPayableId: entry.cuentaPorPagarId,
        sourceGastoDiarioId: null,
      }, { merge: true });
    } else if (route === 'efectivo') {
      batch.delete(cuentaPorPagarRef);
      batch.set(gastoDiarioRef, {
        fecha: entry.date,
        caja: process.env.SICAR_CASHBOX_NAME || 'CAJA 2',
        descripcion: description,
        monto: entry.total,
        amount: entry.amount,
        subtotal: entry.subtotal,
        subtotalExento: entry.subtotalExento,
        subtotalGravado: entry.subtotalGravado,
        iva: entry.iva,
        total: entry.total,
        tipo: 'Compra',
        ...PURCHASE_CATEGORY_PAYLOAD,
        sucursal: BRANCH_ID,
        branch: BRANCH_ID,
        branchName: BRANCH_NAME,
        linkedExpenseId: null,
        linkedPurchaseId: entry.compraId,
        paymentMethod: 'efectivo',
        sourceCollection,
        sourceRawId: entry.rawId,
        sourceSystem: 'SICAR',
        sourceMode: 'local-worker',
        sourceRecordId: entry.sourceRecordId,
        syncedAt: FieldValue.serverTimestamp(),
        lastSyncedAt: FieldValue.serverTimestamp(),
        timestamp: FieldValue.serverTimestamp(),
      }, { merge: true });
      batch.set(purchaseRef, {
        ...basePurchasePayload,
        paymentType: 'contado',
        sourceGastoDiarioId: entry.gastoDiarioId,
        sourceFacturaId: null,
        linkedPayableId: null,
      }, { merge: true });
    } else {
      batch.delete(cuentaPorPagarRef);
      batch.delete(gastoDiarioRef);
      batch.set(purchaseRef, {
        ...basePurchasePayload,
        paymentType: 'Transferencia',
        paymentMethodOriginal: entry.paymentMethod || 'transferencia',
        sourceGastoDiarioId: null,
        sourceFacturaId: null,
        linkedPayableId: null,
      }, { merge: true });
    }
  }

  await batch.commit();
  return { rawId: entry.rawId, skipped: false, route };
}

async function main() {
  const rootDir = path.resolve(__dirname, '..', '..');
  const functionsDir = path.resolve(__dirname, '..');
  loadEnvFile(path.join(rootDir, '.env.local'));
  loadEnvFile(path.join(functionsDir, '.env.local'));

  const args = parseArgs(process.argv.slice(2));
  const defaultClosingDate = getManaguaNowParts().date;
  const lookbackDays = normalizeLookbackDays(args.lookbackDays);
  const startDate = args.startDate || args.date || addDays(defaultClosingDate, -lookbackDays);
  const endDate = args.endDate || args.date || defaultClosingDate;
  assertDate(startDate, 'startDate');
  assertDate(endDate, 'endDate');
  if (endDate < startDate) throw new Error('endDate no puede ser menor que startDate.');

  const connection = await mysql.createConnection(getMysqlConfig());
  const db = initFirebase();

  try {
    const entries = await fetchPurchases(connection, startDate, addDays(endDate, 1));
    const excludedEntries = await fetchExcludedPurchases(connection, startDate, addDays(endDate, 1));
    const routes = entries.reduce((acc, entry) => {
      acc[entry.paymentRoute] = (acc[entry.paymentRoute] || 0) + 1;
      return acc;
    }, {});

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
        excludedSupplierId: getExcludedSupplierId(),
        excludedSupplierName: getExcludedSupplierName(),
        excludedCount: excludedEntries.length,
        excludedSubtotal: money(excludedEntries.reduce((sum, entry) => sum + entry.subtotal, 0)),
        excludedIva: money(excludedEntries.reduce((sum, entry) => sum + entry.iva, 0)),
        excludedTotal: money(excludedEntries.reduce((sum, entry) => sum + entry.total, 0)),
        routes,
        excludedEntries: excludedEntries.slice(0, 20),
        firstEntries: entries.slice(0, 10).map((entry) => ({
          rawId: entry.rawId,
          date: entry.date,
          supplier: entry.supplier,
          invoiceNumber: entry.invoiceNumber,
          subtotal: entry.subtotal,
          iva: entry.iva,
          total: entry.total,
          paymentType: entry.paymentType,
          paymentRoute: entry.paymentRoute,
          paymentTypeNames: entry.paymentTypeNames,
        })),
      }, null, 2));
      return;
    }

    const excludedCleanup = await deleteExcludedPurchases(db, excludedEntries, { stageOnly: args.stageOnly });
    const writeResults = [];
    for (const entry of entries) {
      writeResults.push(await writePurchase(db, entry, { stageOnly: args.stageOnly }));
    }
    const skippedUnchanged = writeResults.filter((result) => result?.skipped).length;
    const writtenCount = writeResults.length - skippedUnchanged;

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
      excludedSupplierId: getExcludedSupplierId(),
      excludedSupplierName: getExcludedSupplierName(),
      excludedCount: excludedEntries.length,
      excludedSubtotal: money(excludedEntries.reduce((sum, entry) => sum + entry.subtotal, 0)),
      excludedIva: money(excludedEntries.reduce((sum, entry) => sum + entry.iva, 0)),
      excludedTotal: money(excludedEntries.reduce((sum, entry) => sum + entry.total, 0)),
      excludedDeletedCount: excludedCleanup.deletedCount,
      routes,
      writtenCount,
      skippedUnchanged,
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
      excludedSupplierId: getExcludedSupplierId(),
      excludedSupplierName: getExcludedSupplierName(),
      excludedCount: excludedEntries.length,
      excludedSubtotal: money(excludedEntries.reduce((sum, entry) => sum + entry.subtotal, 0)),
      excludedIva: money(excludedEntries.reduce((sum, entry) => sum + entry.iva, 0)),
      excludedTotal: money(excludedEntries.reduce((sum, entry) => sum + entry.total, 0)),
      excludedDeletedCount: excludedCleanup.deletedCount,
      routes,
      writtenCount,
      skippedUnchanged,
    }, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
