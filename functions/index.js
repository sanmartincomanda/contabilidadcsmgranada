const { createHash, randomUUID } = require('node:crypto');
const admin = require('firebase-admin');
const logger = require('firebase-functions/logger');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { defineSecret, defineString } = require('firebase-functions/params');
const mysql = require('mysql2/promise');

admin.initializeApp();

const firestore = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const SICAR_DB_HOST = defineSecret('SICAR_DB_HOST');
const SICAR_DB_PORT = defineString('SICAR_DB_PORT', { default: '3306' });
const SICAR_DB_USER = defineSecret('SICAR_DB_USER');
const SICAR_DB_PASSWORD = defineSecret('SICAR_DB_PASSWORD');
const SICAR_DB_NAME = defineSecret('SICAR_DB_NAME');
const SICAR_INGRESOS_QUERY = defineSecret('SICAR_INGRESOS_QUERY');
const SICAR_COMPRAS_QUERY = defineSecret('SICAR_COMPRAS_QUERY');
const SICAR_SYNC_API_TOKEN = defineSecret('SICAR_SYNC_API_TOKEN');
const WHATSAPP_VERIFY_TOKEN = defineSecret('WHATSAPP_VERIFY_TOKEN');
const WHATSAPP_ACCESS_TOKEN = defineSecret('WHATSAPP_ACCESS_TOKEN');
const WHATSAPP_GRAPH_VERSION = defineString('WHATSAPP_GRAPH_VERSION', { default: 'v21.0' });
const SICAR_BRANCH_ID = defineString('SICAR_BRANCH_ID', { default: 'granada' });
const SICAR_BRANCH_NAME = defineString('SICAR_BRANCH_NAME', { default: 'CARNES SAN MARTIN GRANADA' });
const SICAR_TIMEZONE = defineString('SICAR_TIMEZONE', { default: 'America/Managua' });
const SICAR_CASHBOX_NAME = defineString('SICAR_CASHBOX_NAME', { default: 'CAJA 2' });

const BASE_FUNCTION_OPTIONS = {
  region: 'us-central1',
  timeoutSeconds: 120,
  memory: '256MiB',
};

const ADMIN_ALLOWED_ORIGINS = [
  'https://csmgcontabilidad.sanmartinsr.com',
  'https://csmcontabilidad.netlify.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
];

const ADMIN_CALLABLE_FUNCTION_OPTIONS = {
  ...BASE_FUNCTION_OPTIONS,
  cors: ADMIN_ALLOWED_ORIGINS,
  invoker: 'public',
};

const INCOME_CALLABLE_FUNCTION_OPTIONS = {
  ...BASE_FUNCTION_OPTIONS,
  secrets: [
    SICAR_DB_HOST,
    SICAR_DB_USER,
    SICAR_DB_PASSWORD,
    SICAR_DB_NAME,
    SICAR_INGRESOS_QUERY,
  ],
};

const INCOME_HTTP_FUNCTION_OPTIONS = {
  ...INCOME_CALLABLE_FUNCTION_OPTIONS,
  secrets: [
    SICAR_DB_HOST,
    SICAR_DB_USER,
    SICAR_DB_PASSWORD,
    SICAR_DB_NAME,
    SICAR_INGRESOS_QUERY,
    SICAR_SYNC_API_TOKEN,
  ],
};

const PURCHASE_CALLABLE_FUNCTION_OPTIONS = {
  ...BASE_FUNCTION_OPTIONS,
  secrets: [
    SICAR_DB_HOST,
    SICAR_DB_USER,
    SICAR_DB_PASSWORD,
    SICAR_DB_NAME,
    SICAR_COMPRAS_QUERY,
  ],
};

const PURCHASE_HTTP_FUNCTION_OPTIONS = {
  ...PURCHASE_CALLABLE_FUNCTION_OPTIONS,
  secrets: [
    SICAR_DB_HOST,
    SICAR_DB_USER,
    SICAR_DB_PASSWORD,
    SICAR_DB_NAME,
    SICAR_COMPRAS_QUERY,
    SICAR_SYNC_API_TOKEN,
  ],
};

const PRIVATE_REPLAY_HTTP_FUNCTION_OPTIONS = {
  ...BASE_FUNCTION_OPTIONS,
  secrets: [
    SICAR_SYNC_API_TOKEN,
  ],
};

const WHATSAPP_WEBHOOK_FUNCTION_OPTIONS = {
  ...BASE_FUNCTION_OPTIONS,
  timeoutSeconds: 60,
  memory: '512MiB',
  secrets: [
    WHATSAPP_VERIFY_TOKEN,
    WHATSAPP_ACCESS_TOKEN,
  ],
};

const PURCHASE_TRIGGER_DOCUMENT = 'integraciones_privadas/sicar/compras_raw/{rawId}';
const SALES_TRIGGER_DOCUMENT = 'integraciones_privadas/sicar/ventas_raw/{rawId}';
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const LIMITED_USER_EMAIL = 'adriandiazc95@gmail.com';
const MASTER_USER_EMAIL = 'luis.s.97@hotmail.com';
const USER_PROFILES_COLLECTION = 'usuarios_sistema';
const USER_ACCESS_MODULES = [
  'dashboard',
  'ingresar',
  'caja_chica',
  'cuentas_pagar',
  'facturacion',
  'reportes',
  'categorias',
];
const PURCHASE_CATEGORY_PAYLOAD = {
  category: 'Costos de venta / compras',
  categoria: 'Costos de venta / compras',
  subcategory: 'Otros costos de producto',
  subcategoria: 'Otros costos de producto',
  expenseCategory: 'Costos de venta / compras',
  expenseSubcategory: 'Otros costos de producto',
  categoryLabel: 'Costos de venta / compras / Otros costos de producto',
};
const PURCHASE_SUPPLIER_SUBCATEGORY_RULES = [
  { supplierIncludes: 'industrial comercial san martin', subcategory: 'Compra de carne res' },
  { supplierIncludes: 'cargill', subcategory: 'Compra de pollo' },
  { supplierIncludes: 'matadero cacique', subcategory: 'Compra de cerdo' },
  { supplierIncludes: 'delmor', subcategory: 'Compra de embutidos' },
  { supplierIncludes: 'los artesanos', subcategory: 'Compra de embutidos' },
  { supplierIncludes: 'sigma alimentos', subcategory: 'Compra de embutidos' },
];
const SICAR_PRIVATE_CUTOVER_DATE = defineString('SICAR_PRIVATE_CUTOVER_DATE', { default: '2026-05-14' });
const PIPELINE_STATUSES = new Set([
  'pending',
  'processing',
  'processed',
  'error',
  'ignored',
  'cancelling',
  'cancelled',
  'canceling',
  'canceled',
]);

function assertValidDate(value, fieldName) {
  if (!DATE_REGEX.test(value || '')) {
    throw new HttpsError('invalid-argument', `El campo ${fieldName} debe tener formato YYYY-MM-DD.`);
  }
}

function normalizeBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeUpperText(value, fallback = '') {
  const normalized = normalizeText(value);
  return normalized ? normalized.toUpperCase() : fallback;
}

function isMeaningfulInvoiceValue(value) {
  const normalized = normalizeUpperText(value);

  if (!normalized) {
    return false;
  }

  return !['-', 'S/N', 'SN', 'N/A', 'NA', 'NULL', 'UNDEFINED'].includes(normalized);
}

function normalizeComparableText(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function buildPurchaseCategoryPayload(subcategory = PURCHASE_CATEGORY_PAYLOAD.subcategory) {
  return {
    ...PURCHASE_CATEGORY_PAYLOAD,
    subcategory,
    subcategoria: subcategory,
    expenseSubcategory: subcategory,
    categoryLabel: `${PURCHASE_CATEGORY_PAYLOAD.category} / ${subcategory}`,
  };
}

function resolvePurchaseCategoryPayload(entry = {}) {
  const supplierKey = normalizeComparableText(typeof entry === 'string' ? entry : entry.supplier);
  const rule = PURCHASE_SUPPLIER_SUBCATEGORY_RULES.find((item) => supplierKey.includes(item.supplierIncludes));
  return buildPurchaseCategoryPayload(rule?.subcategory || PURCHASE_CATEGORY_PAYLOAD.subcategory);
}

function normalizeAiLearningDocId(value) {
  return normalizeComparableText(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180) || 'sin_proveedor';
}

function normalizeDate(value) {
  if (!value) return '';
  if (value?.toDate && typeof value.toDate === 'function') {
    return value.toDate().toISOString().substring(0, 10);
  }
  if (typeof value === 'object' && Number.isFinite(value._seconds)) {
    return new Date(value._seconds * 1000).toISOString().substring(0, 10);
  }
  if (value instanceof Date) return value.toISOString().substring(0, 10);
  if (typeof value === 'string') {
    const raw = value.trim();
    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

    const numericMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (numericMatch) {
      const day = numericMatch[1].padStart(2, '0');
      const month = numericMatch[2].padStart(2, '0');
      const year = numericMatch[3].length === 2 ? `20${numericMatch[3]}` : numericMatch[3];
      return `${year}-${month}-${day}`;
    }

    const monthNames = {
      jan: '01', january: '01', ene: '01', enero: '01',
      feb: '02', february: '02', febrero: '02',
      mar: '03', march: '03', marzo: '03',
      apr: '04', april: '04', abr: '04', abril: '04',
      may: '05', mayo: '05',
      jun: '06', june: '06', junio: '06',
      jul: '07', july: '07', julio: '07',
      aug: '08', august: '08', ago: '08', agosto: '08',
      sep: '09', sept: '09', september: '09', septiembre: '09',
      oct: '10', october: '10', octubre: '10',
      nov: '11', november: '11', noviembre: '11',
      dec: '12', december: '12', dic: '12', diciembre: '12',
    };
    const textMatch = raw.match(/^(\d{1,2})[-/\s.]([A-Za-zÁÉÍÓÚáéíóúñÑ]+)[-/\s.](\d{2,4})$/);
    if (textMatch) {
      const day = textMatch[1].padStart(2, '0');
      const monthKey = normalizeComparableText(textMatch[2]);
      const month = monthNames[monthKey];
      const year = textMatch[3].length === 2 ? `20${textMatch[3]}` : textMatch[3];
      if (month) return `${year}-${month}-${day}`;
    }

    return raw.substring(0, 10);
  }
  return '';
}

function normalizeAmount(value) {
  if (typeof value === 'string') {
    const cleaned = value
      .replace(/[^\d,.-]/g, '')
      .replace(/,(?=\d{3}(\D|$))/g, '')
      .replace(',', '.');
    const parsedString = Number(cleaned || 0);
    if (Number.isFinite(parsedString)) return Math.round(parsedString * 100) / 100;
  }

  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function normalizeAmountFrom(source, keys, fallback = 0) {
  return normalizeAmount(pickFirstValue(source, keys) ?? fallback);
}

function formatFiscalAmount(value) {
  return `C$ ${normalizeAmount(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function resolveSaleFinancials(row) {
  const total = normalizeAmountFrom(row, [
    'total',
    'grandTotal',
    'grand_total',
    'sale_total',
    'saleTotal',
    'monto_total',
    'montoTotal',
  ]);

  const explicitSubtotal = pickFirstValue(row, [
    'subtotal',
    'subTotal',
    'sub_total',
    'sale_subtotal',
    'saleSubtotal',
    'monto_subtotal',
    'montoSubtotal',
    'amount',
    'monto',
    'ingreso',
    'importe',
  ]);

  const explicitIva = pickFirstValue(row, [
    'iva',
    'tax',
    'impuesto',
    'impuestos',
    'vat',
    'sale_iva',
    'saleIva',
  ]);

  const subtotal = normalizeAmount(explicitSubtotal ?? total);
  const iva = explicitIva === null || explicitIva === undefined || explicitIva === ''
    ? normalizeAmount(total - subtotal)
    : normalizeAmount(explicitIva);
  const subtotalExento = normalizeAmountFrom(row, [
    'subtotalExento',
    'subtotal_exento',
    'subtotal0',
    'subTotal0',
    'subtotal_0',
    'exento',
  ]);
  const subtotalGravado = normalizeAmountFrom(row, [
    'subtotalGravado',
    'subtotal_gravado',
    'gravado',
  ], Math.max(subtotal - subtotalExento, 0));
  const resolvedTotal = total || normalizeAmount(subtotal + iva);

  return {
    amount: subtotal,
    subtotal,
    subtotalExento,
    subtotalGravado,
    iva,
    total: resolvedTotal,
  };
}

function resolvePurchaseFinancials(row) {
  const total = normalizeAmountFrom(row, [
    'total',
    'grandTotal',
    'grand_total',
    'purchase_total',
    'purchaseTotal',
    'monto_total',
    'montoTotal',
    'monto',
    'importe',
  ]);

  const explicitSubtotal = pickFirstValue(row, [
    'subtotal',
    'subTotal',
    'sub_total',
    'purchase_subtotal',
    'purchaseSubtotal',
    'monto_subtotal',
    'montoSubtotal',
    'amount',
  ]);

  const explicitIva = pickFirstValue(row, [
    'iva',
    'tax',
    'impuesto',
    'impuestos',
    'vat',
    'purchase_iva',
    'purchaseIva',
  ]);

  const subtotal = normalizeAmount(explicitSubtotal ?? total);
  const iva = explicitIva === null || explicitIva === undefined || explicitIva === ''
    ? normalizeAmount(total - subtotal)
    : normalizeAmount(explicitIva);
  const subtotalExento = normalizeAmountFrom(row, [
    'subtotalExento',
    'subtotal_exento',
    'subtotal0',
    'subTotal0',
    'subtotal_0',
    'exento',
  ]);
  const subtotalGravado = normalizeAmountFrom(row, [
    'subtotalGravado',
    'subtotal_gravado',
    'gravado',
  ], Math.max(subtotal - subtotalExento, 0));
  const resolvedTotal = total || normalizeAmount(subtotal + iva);

  return {
    amount: subtotal,
    subtotal,
    subtotalExento,
    subtotalGravado,
    iva,
    total: resolvedTotal,
  };
}

function isTruthyFlag(value) {
  return value === true || value === 'true' || value === 1 || value === '1' || value === 'si' || value === 'yes';
}

function isCancellationKeyword(value) {
  const normalized = normalizeComparableText(value);

  if (!normalized) {
    return false;
  }

  return (
    normalized.includes('anulad') ||
    normalized.includes('cancelad') ||
    normalized.includes('void') ||
    normalized.includes('inactiv') ||
    normalized.includes('eliminad')
  );
}

function getPipelineStatus(data, fallback = 'pending') {
  const normalized = normalizeComparableText(data?.status);
  if (normalized && PIPELINE_STATUSES.has(normalized)) {
    if (normalized === 'canceled') return 'cancelled';
    if (normalized === 'canceling') return 'cancelling';
    return normalized;
  }

  return fallback;
}

function getCancellationReason(source) {
  return normalizeUpperText(
    pickFirstValue(source, [
      'cancelReason',
      'cancel_reason',
      'cancellationReason',
      'cancellation_reason',
      'motivoAnulacion',
      'motivo_anulacion',
      'motivoCancelacion',
      'motivo_cancelacion',
      'motivo',
      'razon',
      'reason',
      'observacion',
      'observaciones',
      'nota',
      'notes',
    ])
  );
}

function isRawBusinessCancelled(rawData) {
  const sources = [rawData?.normalized, rawData?.rawPayload, rawData];

  for (const source of sources) {
    if (!source || typeof source !== 'object') {
      continue;
    }

    const flags = [
      source.isCancelled,
      source.isCanceled,
      source.cancelled,
      source.canceled,
      source.anulado,
      source.anulada,
      source.isAnulado,
      source.isAnulada,
      source.voided,
      source.isVoided,
      source.isVoid,
    ];

    if (flags.some(isTruthyFlag)) {
      return true;
    }

    if (typeof source.status === 'number' && source.status < 0) {
      return true;
    }

    if (source.can_caj_id || source.can_rcc_id) {
      return true;
    }

    const statusValues = [
      source.businessStatus,
      source.business_status,
      source.documentStatus,
      source.document_status,
      source.integrationStatus,
      source.integration_status,
      source.cancelState,
      source.cancel_state,
      source.estado,
      source.situacion,
      source.condition,
      source.status,
    ];

    for (const statusValue of statusValues) {
      const comparable = normalizeComparableText(statusValue);
      if (!comparable) {
        continue;
      }

      if (source === rawData && PIPELINE_STATUSES.has(comparable)) {
        continue;
      }

      if (isCancellationKeyword(comparable)) {
        return true;
      }
    }
  }

  return false;
}

function getBusinessStatusLabel(source) {
  return normalizeUpperText(
    pickFirstValue(source, [
      'businessStatus',
      'business_status',
      'documentStatus',
      'document_status',
      'integrationStatus',
      'integration_status',
      'estado',
      'situacion',
      'condition',
    ])
  );
}

function resolveBusinessCancellationMetadata(source) {
  return {
    businessStatus: getBusinessStatusLabel(source),
    cancelReason: getCancellationReason(source),
    isCancelled: isRawBusinessCancelled(source),
  };
}

function getBranchId() {
  return normalizeText(SICAR_BRANCH_ID.value()) || 'granada';
}

function getBranchName() {
  return normalizeText(SICAR_BRANCH_NAME.value()) || 'CARNES SAN MARTIN GRANADA';
}

function getCashboxName() {
  return normalizeText(SICAR_CASHBOX_NAME.value()) || 'CAJA 2';
}

function getTimezone() {
  return normalizeText(SICAR_TIMEZONE.value()) || 'America/Managua';
}

function getActorLabel(actorEmail) {
  return actorEmail || 'api';
}

function getPrivateCutoverDate() {
  const value = normalizeDate(SICAR_PRIVATE_CUTOVER_DATE.value() || '2026-05-14');
  return DATE_REGEX.test(value) ? value : '2026-05-14';
}

function isOnOrAfterCutover(date) {
  const normalized = normalizeDate(date);
  if (!normalized) return false;
  return normalized >= getPrivateCutoverDate();
}

function getIncomeSyncDocumentId(date) {
  return `sicar_venta_diaria_${date}`;
}

function getIncomeSyncKey(date) {
  return `sicar:venta-diaria:${getBranchId()}:${date}`;
}

function getSicarPrivateRoot() {
  return firestore.collection('integraciones_privadas').doc('sicar');
}

function getRawPurchasesCollection() {
  return getSicarPrivateRoot().collection('compras_raw');
}

function getRawSalesCollection() {
  return getSicarPrivateRoot().collection('ventas_raw');
}

function buildQuery(connection, template, { startDate, endDate, branchName }) {
  return template
    .replace(/\{\{startDate\}\}/g, connection.escape(startDate))
    .replace(/\{\{endDate\}\}/g, connection.escape(endDate))
    .replace(/\{\{branchName\}\}/g, connection.escape(branchName));
}

async function createMysqlConnection() {
  return mysql.createConnection({
    host: SICAR_DB_HOST.value(),
    port: Number(SICAR_DB_PORT.value() || 3306),
    user: SICAR_DB_USER.value(),
    password: SICAR_DB_PASSWORD.value(),
    database: SICAR_DB_NAME.value(),
    charset: 'utf8mb4',
  });
}

async function runMysqlTemplateQuery(template, params) {
  const connection = await createMysqlConnection();

  try {
    const sql = buildQuery(connection, template, params);
    const [rows] = await connection.query(sql);
    return rows || [];
  } finally {
    await connection.end();
  }
}

function aggregateRowsByDate(rows) {
  const aggregated = new Map();

  for (const [index, row] of (rows || []).entries()) {
    const entry = normalizeSaleRow(row, index);

    if (!entry?.date) {
      continue;
    }

    const existing = aggregated.get(entry.date) || {
      date: entry.date,
      month: entry.month,
      amount: 0,
      subtotal: 0,
      subtotalExento: 0,
      subtotalGravado: 0,
      iva: 0,
      total: 0,
      sourceRecordIds: [],
      paymentBreakdown: [],
    };

    existing.amount = normalizeAmount(existing.amount + entry.amount);
    existing.subtotal = normalizeAmount(existing.subtotal + entry.subtotal);
    existing.subtotalExento = normalizeAmount(existing.subtotalExento + entry.subtotalExento);
    existing.subtotalGravado = normalizeAmount(existing.subtotalGravado + entry.subtotalGravado);
    existing.iva = normalizeAmount(existing.iva + entry.iva);
    existing.total = normalizeAmount(existing.total + entry.total);
    if (entry.sourceRecordId) existing.sourceRecordIds.push(entry.sourceRecordId);

    aggregated.set(entry.date, existing);
  }

  return Array.from(aggregated.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((entry) => ({
      ...entry,
      dailySaleCode: `VENTA-${entry.date.replace(/-/g, '')}`,
      reference: `VENTA-${entry.date.replace(/-/g, '')}`,
      description: `VENTA DIARIA SICAR ${entry.date}`,
      sourceRecordId: entry.sourceRecordIds.join(','),
    }));
}

async function fetchDailyIncomeRows({ startDate, endDate, branchName }) {
  const rows = await runMysqlTemplateQuery(SICAR_INGRESOS_QUERY.value(), {
    startDate,
    endDate,
    branchName,
  });

  return aggregateRowsByDate(rows);
}

async function writeSyncLog(summary) {
  await firestore.collection('sicar_sync_logs').add({
    ...summary,
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function upsertDailyIncomes(entries, actorEmail) {
  const batch = firestore.batch();

  entries.forEach((entry) => {
    const { date } = entry;
    const ref = firestore.collection('ingresos').doc(getIncomeSyncDocumentId(date));
    const dailySaleCode = entry.dailySaleCode || `VENTA-${date.replace(/-/g, '')}`;

    batch.set(ref, {
      date,
      month: date.substring(0, 7),
      description: entry.description || `VENTA DIARIA SICAR ${date}`,
      reference: entry.reference || dailySaleCode,
      dailySaleCode,
      amount: normalizeAmount(entry.subtotal ?? entry.amount),
      subtotal: normalizeAmount(entry.subtotal ?? entry.amount),
      subtotalExento: normalizeAmount(entry.subtotalExento),
      subtotalGravado: normalizeAmount(entry.subtotalGravado),
      iva: normalizeAmount(entry.iva),
      total: normalizeAmount(entry.total ?? entry.amount),
      branch: getBranchId(),
      branchName: getBranchName(),
      source: 'sicar',
      sourceType: 'daily_sale',
      sourceLabel: 'SICAR',
      sourceSystem: 'SICAR',
      sourceBranch: getBranchName(),
      sourceRecordIds: entry.sourceRecordIds || [],
      paymentBreakdown: entry.paymentBreakdown || [],
      syncKey: getIncomeSyncKey(date),
      syncedBy: getActorLabel(actorEmail),
      syncedAt: FieldValue.serverTimestamp(),
      lastSyncedAt: FieldValue.serverTimestamp(),
      is_conciled: false,
      timezone: getTimezone(),
    }, { merge: true });
  });

  await batch.commit();
}

function buildIncomeSyncResponse({ startDate, endDate, preview, actorEmail, entries }) {
  const totalAmount = entries.reduce((total, item) => total + item.amount, 0);
  const totalIva = entries.reduce((total, item) => total + normalizeAmount(item.iva), 0);
  const grandTotal = entries.reduce((total, item) => total + normalizeAmount(item.total), 0);

  return {
    ok: true,
    preview,
    syncType: 'ingresos',
    startDate,
    endDate,
    branchId: getBranchId(),
    branchName: getBranchName(),
    syncedCount: entries.length,
    totalAmount: normalizeAmount(totalAmount),
    totalIva: normalizeAmount(totalIva),
    grandTotal: normalizeAmount(grandTotal),
    actor: getActorLabel(actorEmail),
    entries,
  };
}

async function executeIncomeSync({ startDate, endDate, preview, actorEmail }) {
  assertValidDate(startDate, 'startDate');
  assertValidDate(endDate, 'endDate');

  if (endDate < startDate) {
    throw new HttpsError('invalid-argument', 'endDate no puede ser menor que startDate.');
  }

  const entries = await fetchDailyIncomeRows({
    startDate,
    endDate,
    branchName: getBranchName(),
  });

  if (!preview) {
    await upsertDailyIncomes(entries, actorEmail);
  }

  const response = buildIncomeSyncResponse({
    startDate,
    endDate,
    preview,
    actorEmail,
    entries,
  });

  await writeSyncLog({
    syncType: 'ingresos',
    actor: response.actor,
    preview,
    startDate,
    endDate,
    branchId: response.branchId,
    branchName: response.branchName,
    syncedCount: response.syncedCount,
    totalAmount: response.totalAmount,
    totalIva: response.totalIva,
    grandTotal: response.grandTotal,
    status: 'ok',
  });

  return response;
}

function pickFirstValue(source, keys) {
  for (const key of keys) {
    if (source?.[key] !== undefined && source[key] !== null && source[key] !== '') {
      return source[key];
    }
  }

  return null;
}

function toPlainObject(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function normalizePurchasePaymentMethod(value) {
  const comparable = normalizeComparableText(value);

  if (!comparable) {
    return 'otro';
  }

  if (comparable.includes('credito') || comparable.includes('cuenta por pagar') || comparable.includes('por pagar')) {
    return 'credito';
  }

  if (comparable.includes('efectivo') || comparable.includes('cash') || comparable.includes('caja')) {
    return 'efectivo';
  }

  if (comparable.includes('contado')) {
    return 'contado';
  }

  if (comparable.includes('transferencia')) {
    return 'transferencia';
  }

  if (comparable.includes('tarjeta')) {
    return comparable.includes('credito') ? 'tarjeta_credito' : 'tarjeta';
  }

  if (comparable.includes('cheque')) {
    return 'cheque';
  }

  if (comparable.includes('debito')) {
    return 'debito';
  }

  if (comparable.includes('deposito')) {
    return 'deposito';
  }

  return comparable;
}

function resolvePurchaseRoute(paymentMethod) {
  if (paymentMethod === 'credito') {
    return 'credito';
  }

  if (paymentMethod === 'efectivo') {
    return 'efectivo';
  }

  return 'otro';
}

function buildPurchaseInvoiceMetadata(row) {
  const explicitInvoiceNumber = normalizeUpperText(
    pickFirstValue(row, [
      'invoiceNumber',
      'invoice_number',
      'numero_factura',
      'numeroFactura',
      'factura',
      'folio_factura',
      'folioFactura',
    ])
  );

  const purchaseFolio = normalizeUpperText(
    pickFirstValue(row, [
      'purchaseFolio',
      'purchase_folio',
      'folio',
      'folio_compra',
      'folioCompra',
    ])
  );

  const purchaseSeries = normalizeUpperText(
    pickFirstValue(row, [
      'purchaseSeries',
      'purchase_series',
      'serieFolio',
      'serie_folio',
      'serieFactura',
      'serie_factura',
      'serie',
    ])
  );

  const invoiceParts = [];
  if (isMeaningfulInvoiceValue(purchaseSeries)) invoiceParts.push(purchaseSeries);
  if (isMeaningfulInvoiceValue(purchaseFolio)) invoiceParts.push(purchaseFolio);

  const composedInvoiceNumber = invoiceParts.join('-');
  const invoiceNumber = isMeaningfulInvoiceValue(explicitInvoiceNumber)
    ? explicitInvoiceNumber
    : composedInvoiceNumber;

  return {
    invoiceNumber,
    purchaseFolio: isMeaningfulInvoiceValue(purchaseFolio) ? purchaseFolio : '',
    purchaseSeries: isMeaningfulInvoiceValue(purchaseSeries) ? purchaseSeries : '',
  };
}

function buildPurchaseDescription(normalized) {
  const supplier = normalized.supplier || 'COMPRA SICAR';
  const invoiceLabel = normalized.invoiceNumber
    ? `FACTURA ${normalized.invoiceNumber}`
    : 'SIN FACTURA';
  const extra = normalizeUpperText(normalized.description || normalized.notes);

  return [supplier, invoiceLabel, extra].filter(Boolean).join(' / ');
}

function buildRawPurchaseId(entry) {
  const fingerprint = createHash('sha1')
    .update(JSON.stringify([
      entry.sourceRecordId || '',
      entry.date,
      entry.supplier,
      entry.invoiceNumber,
      entry.amount,
      entry.iva,
      entry.total,
      entry.paymentMethod,
    ]))
    .digest('hex')
    .slice(0, 24);

  return `compra_${entry.date}_${fingerprint}`;
}

function buildPurchasePreview(entry, rawId = buildRawPurchaseId(entry)) {
  return {
    rawId,
    date: entry.date,
    month: entry.month,
    supplier: entry.supplier,
    invoiceNumber: entry.invoiceNumber,
    amount: entry.amount,
    subtotal: entry.subtotal,
    iva: entry.iva,
    total: entry.total,
    paymentMethod: entry.paymentMethod,
    paymentRoute: entry.paymentRoute,
    dueDate: entry.dueDate || '',
    sourceRecordId: entry.sourceRecordId || '',
  };
}

function buildRawSaleId(entry) {
  if (entry.type === 'daily_sale' || entry.sourceType === 'daily_sale') {
    return `venta_diaria_${entry.date}`;
  }

  const fingerprint = createHash('sha1')
    .update(JSON.stringify([
      entry.sourceRecordId || '',
      entry.date,
      entry.reference,
      entry.amount,
    ]))
    .digest('hex')
    .slice(0, 24);

  return `venta_${entry.date}_${fingerprint}`;
}

function buildSalePreview(entry, rawId = buildRawSaleId(entry)) {
  return {
    rawId,
    date: entry.date,
    month: entry.month,
    description: entry.description,
    reference: entry.reference,
    amount: entry.amount,
    subtotal: entry.subtotal,
    iva: entry.iva,
    total: entry.total,
    dailySaleCode: entry.dailySaleCode,
    sourceRecordId: entry.sourceRecordId || '',
  };
}

function normalizePurchaseRow(row, index = 0) {
  const cancellation = resolveBusinessCancellationMetadata(row);
  const financials = resolvePurchaseFinancials(row);
  const date = normalizeDate(
    pickFirstValue(row, [
      'date',
      'fecha',
      'purchase_date',
      'purchaseDate',
      'compra_date',
      'compraDate',
      'dia',
      'day',
    ])
  );

  const amount = financials.amount;

  if (!date || amount <= 0) {
    return null;
  }

  const paymentMethod = normalizePurchasePaymentMethod(
    pickFirstValue(row, [
      'paymentMethod',
      'payment_method',
      'metodo_pago',
      'metodoPago',
      'forma_pago',
      'formaPago',
      'tipo_pago',
      'tipoPago',
      'condicion_pago',
      'condicionPago',
    ])
  );

  const sourceRecordId = normalizeText(
    pickFirstValue(row, [
      'sourceRecordId',
      'source_record_id',
      'id',
      'compra_id',
      'compraId',
      'purchase_id',
      'purchaseId',
      'movimiento_id',
      'movimientoId',
      'folio',
      'uuid',
    ])
  );

  const invoiceMetadata = buildPurchaseInvoiceMetadata(row);

  const normalized = {
    sourceRecordId: sourceRecordId || `${date}-${index}`,
    date,
    month: date.substring(0, 7),
    supplier: normalizeUpperText(
      pickFirstValue(row, [
        'supplier',
        'proveedor',
        'vendor',
        'nombre_proveedor',
        'nombreProveedor',
      ]),
      'PROVEEDOR NO IDENTIFICADO'
    ),
    invoiceNumber: invoiceMetadata.invoiceNumber,
    purchaseFolio: invoiceMetadata.purchaseFolio,
    purchaseSeries: invoiceMetadata.purchaseSeries,
    amount,
    subtotal: financials.subtotal,
    subtotalExento: financials.subtotalExento,
    subtotalGravado: financials.subtotalGravado,
    iva: financials.iva,
    total: financials.total,
    paymentMethod,
    paymentRoute: resolvePurchaseRoute(paymentMethod),
    dueDate: normalizeDate(
      pickFirstValue(row, [
        'dueDate',
        'due_date',
        'vencimiento',
        'fecha_vencimiento',
        'fechaVencimiento',
      ])
    ),
    description: normalizeUpperText(
      pickFirstValue(row, [
        'description',
        'descripcion',
        'concepto',
        'detalle',
      ])
    ),
    cashboxName: normalizeUpperText(
      pickFirstValue(row, [
        'cashboxName',
        'cashbox_name',
        'caja',
        'caja_nombre',
        'cajaNombre',
      ])
    ),
    businessStatus: cancellation.businessStatus,
    cancelReason: cancellation.cancelReason,
    isCancelled: cancellation.isCancelled,
    notes: normalizeUpperText(
      pickFirstValue(row, [
        'notes',
        'nota',
        'notas',
        'observacion',
        'observaciones',
      ])
    ),
    rawPayload: toPlainObject(row),
  };

  return normalized;
}

function normalizeSaleRow(row, index = 0) {
  const cancellation = resolveBusinessCancellationMetadata(row);
  const financials = resolveSaleFinancials(row);
  const date = normalizeDate(
    pickFirstValue(row, [
      'date',
      'fecha',
      'sale_date',
      'saleDate',
      'venta_date',
      'ventaDate',
      'dia',
      'day',
    ])
  );

  const amount = financials.amount;
  const rawType = normalizeText(pickFirstValue(row, ['type', 'sourceType', 'tipo'])) || 'sale_ticket';
  const isDailySale = rawType === 'daily_sale';

  if (!date || (!isDailySale && amount <= 0)) {
    return null;
  }

  const sourceRecordId = normalizeText(
    pickFirstValue(row, [
      'sourceRecordId',
      'source_record_id',
      'id',
      'venta_id',
      'ventaId',
      'sale_id',
      'saleId',
      'movimiento_id',
      'movimientoId',
      'folio',
      'ticket',
      'uuid',
    ])
  );

  return {
    sourceRecordId: sourceRecordId || `${date}-${index}`,
    date,
    month: date.substring(0, 7),
    amount,
    subtotal: financials.subtotal,
    subtotalExento: financials.subtotalExento,
    subtotalGravado: financials.subtotalGravado,
    iva: financials.iva,
    total: financials.total,
    type: rawType,
    dailySaleCode: normalizeUpperText(
      pickFirstValue(row, [
        'dailySaleCode',
        'daily_sale_code',
        'codigoVentaDiaria',
        'codigo_venta_diaria',
      ]),
      `VENTA-${date.replace(/-/g, '')}`
    ),
    businessStatus: cancellation.businessStatus,
    cancelReason: cancellation.cancelReason,
    isCancelled: cancellation.isCancelled,
    reference: normalizeUpperText(
      pickFirstValue(row, [
        'reference',
        'referencia',
        'numero',
        'numero_venta',
        'numeroVenta',
        'folio',
        'ticket',
        'comprobante',
      ])
    ) || `VENTA-${date.replace(/-/g, '')}`,
    description: normalizeUpperText(
      pickFirstValue(row, [
        'description',
        'descripcion',
        'concepto',
        'detalle',
      ]),
      `VENTA DIARIA SICAR ${date}`
    ),
    paymentBreakdown: Array.isArray(row.paymentBreakdown) ? row.paymentBreakdown : [],
    rawPayload: toPlainObject(row),
  };
}

function extractNormalizedPurchase(rawData) {
  const source = {
    ...(rawData?.rawPayload || {}),
    ...(rawData?.normalized || {}),
    ...rawData,
  };

  const normalized = normalizePurchaseRow(source);
  if (!normalized) return null;

  return {
    ...normalized,
    paymentRoute: rawData?.normalized?.paymentRoute || normalized.paymentRoute,
    rawPayload: rawData?.rawPayload || normalized.rawPayload || {},
  };
}

function extractNormalizedSale(rawData) {
  const source = {
    ...(rawData?.rawPayload || {}),
    ...(rawData?.normalized || {}),
    ...rawData,
  };

  const normalized = normalizeSaleRow(source);
  if (!normalized) return null;

  return {
    ...normalized,
    rawPayload: rawData?.rawPayload || normalized.rawPayload || {},
  };
}

async function fetchPurchaseEntries({ startDate, endDate, branchName }) {
  const rows = await runMysqlTemplateQuery(SICAR_COMPRAS_QUERY.value(), {
    startDate,
    endDate,
    branchName,
  });

  return rows
    .map((row, index) => normalizePurchaseRow(row, index))
    .filter(Boolean);
}

function getRequestRows(source) {
  if (Array.isArray(source)) {
    return source;
  }

  if (Array.isArray(source?.rows)) {
    return source.rows;
  }

  if (Array.isArray(source?.records)) {
    return source.records;
  }

  if (Array.isArray(source?.data)) {
    return source.data;
  }

  return null;
}

function buildRawPurchaseDocument(entry, actorEmail, sourceMode) {
  const { rawPayload, ...normalized } = entry;

  return {
    sourceSystem: 'SICAR',
    sourceType: 'compra',
    sourceMode,
    branch: getBranchId(),
    branchName: getBranchName(),
    sourceRecordId: normalized.sourceRecordId,
    normalized,
    rawPayload: rawPayload || {},
    status: 'pending',
    receivedAt: FieldValue.serverTimestamp(),
    lastSeenAt: FieldValue.serverTimestamp(),
    lastSeenBy: getActorLabel(actorEmail),
    seenCount: 1,
  };
}

function buildRawSaleDocument(entry, actorEmail, sourceMode) {
  const { rawPayload, ...normalized } = entry;

  return {
    sourceSystem: 'SICAR',
    sourceType: normalized.sourceType || normalized.type || 'venta',
    sourceMode,
    branch: getBranchId(),
    branchName: getBranchName(),
    sourceRecordId: normalized.sourceRecordId,
    normalized,
    rawPayload: rawPayload || {},
    status: 'pending',
    receivedAt: FieldValue.serverTimestamp(),
    lastSeenAt: FieldValue.serverTimestamp(),
    lastSeenBy: getActorLabel(actorEmail),
    seenCount: 1,
  };
}

async function stagePurchaseEntry(entry, actorEmail, sourceMode) {
  const rawId = buildRawPurchaseId(entry);
  const ref = getRawPurchasesCollection().doc(rawId);
  let action = 'existing';

  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);

    if (!snapshot.exists) {
      transaction.create(ref, buildRawPurchaseDocument(entry, actorEmail, sourceMode));
      action = 'created';
      return;
    }

    const existing = snapshot.data() || {};
    const update = {
      sourceMode,
      normalized: buildRawPurchaseDocument(entry, actorEmail, sourceMode).normalized,
      rawPayload: entry.rawPayload || {},
      lastSeenAt: FieldValue.serverTimestamp(),
      lastSeenBy: getActorLabel(actorEmail),
      seenCount: FieldValue.increment(1),
    };

    if (existing.status === 'error') {
      update.status = 'pending';
      update.error = FieldValue.delete();
      update.errorAt = FieldValue.delete();
      update.processedAt = FieldValue.delete();
      update.processingStartedAt = FieldValue.delete();
      update.targetDocIds = FieldValue.delete();
      action = 'requeued';
    }

    transaction.set(ref, update, { merge: true });
  });

  return {
    rawId,
    action,
    amount: entry.amount,
    paymentRoute: entry.paymentRoute,
  };
}

async function stagePurchaseEntries(entries, actorEmail, sourceMode) {
  const staged = [];

  for (const entry of entries) {
    staged.push(await stagePurchaseEntry(entry, actorEmail, sourceMode));
  }

  return staged;
}

async function lockRawPrivateDocument(collectionRef, rawId, options = {}) {
  const allowedStatuses = options.allowedStatuses || ['pending'];
  const nextStatus = options.nextStatus || 'processing';
  const nextFields = options.nextFields || {};
  const ref = collectionRef.doc(rawId);

  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);

    if (!snapshot.exists) {
      return { locked: false, reason: 'missing', ref };
    }

    const data = snapshot.data() || {};
    const status = getPipelineStatus(data, 'pending');

    if (!allowedStatuses.includes(status)) {
      return { locked: false, reason: status, ref };
    }

    transaction.update(ref, {
      status: nextStatus,
      ...nextFields,
    });

    return { locked: true, data, ref };
  });
}

async function ignoreRawDocument(ref, reason, rawDate = '') {
  await ref.set({
    status: 'ignored',
    ignoredReason: reason,
    ignoredAt: FieldValue.serverTimestamp(),
    ignoredCutoverDate: getPrivateCutoverDate(),
    rawDate,
  }, { merge: true });
}

function summarizeStagedActions(staged) {
  return staged.reduce((summary, item) => {
    summary[item.action] = (summary[item.action] || 0) + 1;
    return summary;
  }, { created: 0, requeued: 0, existing: 0 });
}

function summarizePurchaseRoutes(entries) {
  return entries.reduce((summary, entry) => {
    summary[entry.paymentRoute] = (summary[entry.paymentRoute] || 0) + 1;
    return summary;
  }, { efectivo: 0, credito: 0, otro: 0 });
}

function buildPurchaseSyncResponse({
  preview,
  actorEmail,
  startDate,
  endDate,
  sourceMode,
  entries,
  staged = [],
}) {
  const totalAmount = entries.reduce((total, item) => total + item.amount, 0);

  return {
    ok: true,
    preview,
    syncType: 'compras',
    sourceMode,
    startDate: startDate || null,
    endDate: endDate || null,
    branchId: getBranchId(),
    branchName: getBranchName(),
    actor: getActorLabel(actorEmail),
    stagedCount: staged.length,
    entryCount: entries.length,
    totalAmount: normalizeAmount(totalAmount),
    stagedActions: summarizeStagedActions(staged),
    routes: summarizePurchaseRoutes(entries),
    entries: entries.map((entry) => buildPurchasePreview(entry)),
  };
}

async function executePurchaseSync({ startDate, endDate, preview, actorEmail, rows }) {
  let entries = [];
  let sourceMode = 'mysql-query';

  if (Array.isArray(rows) && rows.length > 0) {
    sourceMode = 'push';
    entries = rows
      .map((row, index) => normalizePurchaseRow(row, index))
      .filter(Boolean);
  } else {
    assertValidDate(startDate, 'startDate');
    assertValidDate(endDate, 'endDate');

    if (endDate < startDate) {
      throw new HttpsError('invalid-argument', 'endDate no puede ser menor que startDate.');
    }

    entries = await fetchPurchaseEntries({
      startDate,
      endDate,
      branchName: getBranchName(),
    });
  }

  const staged = preview ? [] : await stagePurchaseEntries(entries, actorEmail, sourceMode);
  const response = buildPurchaseSyncResponse({
    preview,
    actorEmail,
    startDate,
    endDate,
    sourceMode,
    entries,
    staged,
  });

  await writeSyncLog({
    syncType: 'compras',
    actor: response.actor,
    preview,
    startDate: response.startDate,
    endDate: response.endDate,
    branchId: response.branchId,
    branchName: response.branchName,
    stagedCount: response.stagedCount,
    entryCount: response.entryCount,
    totalAmount: response.totalAmount,
    sourceMode,
    status: 'ok',
    routes: response.routes,
    stagedActions: response.stagedActions,
  });

  return response;
}

function getPurchaseTargetIds(rawId) {
  return {
    compraId: `sicar_compra_${rawId}`,
    gastoDiarioId: `sicar_gd_${rawId}`,
    cuentaPorPagarId: `sicar_cxp_${rawId}`,
  };
}

function getSaleTargetIds(rawId, normalized = null) {
  const date = normalized?.date || rawId.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
  const isDailySale = normalized?.type === 'daily_sale' ||
    normalized?.sourceType === 'daily_sale' ||
    rawId.startsWith('venta_diaria_');

  if (isDailySale && date) {
    return {
      ingresoId: getIncomeSyncDocumentId(date),
    };
  }

  return {
    ingresoId: `sicar_venta_${rawId}`,
  };
}

function getResolvedPurchaseRoute(rawData, normalized) {
  return rawData?.resolvedRoute ||
    rawData?.normalized?.paymentRoute ||
    normalized?.paymentRoute ||
    'otro';
}

function getResolvedPurchaseTargetIds(rawId, rawData) {
  const defaults = getPurchaseTargetIds(rawId);
  return {
    ...defaults,
    ...(rawData?.targetDocIds || {}),
  };
}

function getResolvedSaleTargetIds(rawId, rawData, normalized = null) {
  const defaults = getSaleTargetIds(rawId, normalized || rawData?.normalized);
  return {
    ...defaults,
    ...(rawData?.targetDocIds || {}),
  };
}

async function getAbonosLinkedToFactura(facturaId) {
  const snapshot = await firestore.collection('abonos_pagar').get();

  return snapshot.docs
    .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
    .filter((abono) => (
      Array.isArray(abono.detalleAfectado) &&
      abono.detalleAfectado.some((item) => item?.id === facturaId)
    ));
}

async function cancelCreditAbonos(batch, facturaId) {
  const abonos = await getAbonosLinkedToFactura(facturaId);

  for (const abono of abonos) {
    const detalle = Array.isArray(abono.detalleAfectado) ? abono.detalleAfectado : [];
    const touchesOnlyFactura = detalle.every((item) => item?.id === facturaId);

    if (!touchesOnlyFactura) {
      throw new Error(`La factura ${facturaId} ya tiene un abono compartido con otras facturas. Requiere revision manual antes de anular.`);
    }

    if (abono.paymentMethod === 'efectivo' && abono.linkedGastoDiarioId) {
      batch.delete(firestore.collection('gastosDiarios').doc(abono.linkedGastoDiarioId));
    }

    batch.delete(firestore.collection('abonos_pagar').doc(abono.id));
  }

  return abonos.map((abono) => abono.id);
}

async function cancelPurchaseTargets(rawId, rawData, normalized) {
  const batch = firestore.batch();
  const targetDocIds = getResolvedPurchaseTargetIds(rawId, rawData);
  const route = getResolvedPurchaseRoute(rawData, normalized);
  let removedAbonoIds = [];

  if (route === 'credito') {
    removedAbonoIds = await cancelCreditAbonos(batch, targetDocIds.cuentaPorPagarId);
    batch.delete(firestore.collection('cuentas_por_pagar').doc(targetDocIds.cuentaPorPagarId));
    batch.delete(firestore.collection('compras').doc(targetDocIds.compraId));
  } else if (route === 'efectivo') {
    batch.delete(firestore.collection('gastosDiarios').doc(targetDocIds.gastoDiarioId));
    batch.delete(firestore.collection('compras').doc(targetDocIds.compraId));
  } else {
    batch.delete(firestore.collection('compras').doc(targetDocIds.compraId));
  }

  await batch.commit();

  return {
    route,
    targetDocIds,
    removedAbonoIds,
  };
}

async function cancelSaleTargets(rawId, rawData) {
  const normalized = extractNormalizedSale(rawData);
  const { ingresoId } = getResolvedSaleTargetIds(rawId, rawData, normalized);
  await firestore.collection('ingresos').doc(ingresoId).delete();

  return {
    route: 'venta',
    targetDocIds: { ingresoId },
  };
}

async function createCashPurchase(rawId, normalized, rawData) {
  const { compraId, gastoDiarioId } = getPurchaseTargetIds(rawId);
  const batch = firestore.batch();
  const description = buildPurchaseDescription(normalized);
  const categoryPayload = resolvePurchaseCategoryPayload(normalized);

  batch.set(firestore.collection('gastosDiarios').doc(gastoDiarioId), {
    fecha: normalized.date,
    caja: normalized.cashboxName || getCashboxName(),
    descripcion: description,
    monto: normalizeAmount(normalized.total ?? normalized.amount),
    amount: normalized.amount,
    subtotal: normalized.subtotal,
    subtotalExento: normalized.subtotalExento,
    subtotalGravado: normalized.subtotalGravado,
    iva: normalized.iva,
    total: normalized.total,
    tipo: 'Compra',
    ...categoryPayload,
    sucursal: getBranchId(),
    branch: getBranchId(),
    branchName: getBranchName(),
    linkedExpenseId: null,
    linkedPurchaseId: compraId,
    paymentMethod: 'efectivo',
    sourceCollection: PURCHASE_TRIGGER_DOCUMENT.replace('{rawId}', rawId),
    sourceRawId: rawId,
    sourceSystem: 'SICAR',
    sourceRecordId: normalized.sourceRecordId,
    timestamp: FieldValue.serverTimestamp(),
  });

  batch.set(firestore.collection('compras').doc(compraId), {
    date: normalized.date,
    month: normalized.month,
    supplier: normalized.supplier,
    invoiceNumber: normalized.invoiceNumber,
    purchaseFolio: normalized.purchaseFolio || '',
    purchaseSeries: normalized.purchaseSeries || '',
    amount: normalized.amount,
    subtotal: normalized.subtotal,
    subtotalExento: normalized.subtotalExento,
    subtotalGravado: normalized.subtotalGravado,
    iva: normalized.iva,
    total: normalized.total,
    ...categoryPayload,
    branch: getBranchId(),
    branchName: getBranchName(),
    paymentType: 'contado',
    paymentMethodOriginal: 'efectivo',
    isInventoryCost: true,
    description,
    sourceCollection: PURCHASE_TRIGGER_DOCUMENT.replace('{rawId}', rawId),
    sourceRawId: rawId,
    sourceSystem: 'SICAR',
    sourceMode: rawData.sourceMode || 'push',
    sourceRecordId: normalized.sourceRecordId,
    sourceGastoDiarioId: gastoDiarioId,
    timestamp: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  return {
    route: 'efectivo',
    targetDocIds: {
      gastoDiarioId,
      compraId,
    },
  };
}

async function createCreditPurchase(rawId, normalized, rawData) {
  const { compraId, cuentaPorPagarId } = getPurchaseTargetIds(rawId);
  const batch = firestore.batch();
  const categoryPayload = resolvePurchaseCategoryPayload(normalized);
  const cuentaPorPagarRef = firestore.collection('cuentas_por_pagar').doc(cuentaPorPagarId);
  const existingPayableSnapshot = await cuentaPorPagarRef.get();
  const existingPayable = existingPayableSnapshot.exists ? existingPayableSnapshot.data() : null;
  const newTotal = normalizeAmount(normalized.total ?? normalized.amount);
  const previousTotal = normalizeAmount(existingPayable?.total ?? existingPayable?.monto);
  const previousSaldo = normalizeAmount(existingPayable?.saldo ?? newTotal);
  const saldo = existingPayable
    ? normalizeAmount(Math.max(previousSaldo + (newTotal - previousTotal), 0))
    : newTotal;

  batch.set(cuentaPorPagarRef, {
    fecha: normalized.date,
    month: normalized.month,
    proveedor: normalized.supplier,
    sucursal: getBranchName(),
    branch: getBranchId(),
    branchName: getBranchName(),
    numero: normalized.invoiceNumber,
    purchaseFolio: normalized.purchaseFolio || '',
    purchaseSeries: normalized.purchaseSeries || '',
    vencimiento: normalized.dueDate || '',
    monto: newTotal,
    saldo,
    amount: normalized.amount,
    subtotal: normalized.subtotal,
    subtotalExento: normalized.subtotalExento,
    subtotalGravado: normalized.subtotalGravado,
    iva: normalized.iva,
    total: normalized.total,
    ...categoryPayload,
    estado: saldo <= 0 ? 'pagado' : saldo < newTotal ? 'parcial' : 'pendiente',
    paymentType: 'credito',
    paymentMethodOriginal: 'credito',
    isInventoryCost: true,
    mirroredToCompras: true,
    mirroredPurchaseId: compraId,
    sourceCollection: PURCHASE_TRIGGER_DOCUMENT.replace('{rawId}', rawId),
    sourceRawId: rawId,
    sourceSystem: 'SICAR',
    sourceMode: rawData.sourceMode || 'push',
    sourceRecordId: normalized.sourceRecordId,
    timestamp: FieldValue.serverTimestamp(),
  });

  batch.set(firestore.collection('compras').doc(compraId), {
    date: normalized.date,
    month: normalized.month,
    supplier: normalized.supplier,
    invoiceNumber: normalized.invoiceNumber,
    purchaseFolio: normalized.purchaseFolio || '',
    purchaseSeries: normalized.purchaseSeries || '',
    amount: normalized.amount,
    subtotal: normalized.subtotal,
    subtotalExento: normalized.subtotalExento,
    subtotalGravado: normalized.subtotalGravado,
    iva: normalized.iva,
    total: normalized.total,
    ...categoryPayload,
    branch: getBranchId(),
    branchName: getBranchName(),
    paymentType: 'credito',
    paymentMethodOriginal: 'credito',
    isInventoryCost: true,
    sourceCollection: PURCHASE_TRIGGER_DOCUMENT.replace('{rawId}', rawId),
    sourceRawId: rawId,
    sourceSystem: 'SICAR',
    sourceMode: rawData.sourceMode || 'push',
    sourceRecordId: normalized.sourceRecordId,
    sourceFacturaId: cuentaPorPagarId,
    linkedPayableId: cuentaPorPagarId,
    timestamp: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  return {
    route: 'credito',
    targetDocIds: {
      cuentaPorPagarId,
      compraId,
    },
  };
}

async function createOtherPurchase(rawId, normalized, rawData) {
  const { compraId } = getPurchaseTargetIds(rawId);
  const categoryPayload = resolvePurchaseCategoryPayload(normalized);

  await firestore.collection('compras').doc(compraId).set({
    date: normalized.date,
    month: normalized.month,
    supplier: normalized.supplier,
    invoiceNumber: normalized.invoiceNumber,
    purchaseFolio: normalized.purchaseFolio || '',
    purchaseSeries: normalized.purchaseSeries || '',
    amount: normalized.amount,
    subtotal: normalized.subtotal,
    subtotalExento: normalized.subtotalExento,
    subtotalGravado: normalized.subtotalGravado,
    iva: normalized.iva,
    total: normalized.total,
    ...categoryPayload,
    branch: getBranchId(),
    branchName: getBranchName(),
    paymentType: 'Transferencia',
    paymentMethodOriginal: normalized.paymentMethod || 'otro',
    isInventoryCost: true,
    description: buildPurchaseDescription(normalized),
    sourceCollection: PURCHASE_TRIGGER_DOCUMENT.replace('{rawId}', rawId),
    sourceRawId: rawId,
    sourceSystem: 'SICAR',
    sourceMode: rawData.sourceMode || 'push',
    sourceRecordId: normalized.sourceRecordId,
    timestamp: FieldValue.serverTimestamp(),
  });

  return {
    route: 'otro',
    targetDocIds: {
      compraId,
    },
  };
}

async function createSaleIncome(rawId, normalized, rawData) {
  const { ingresoId } = getResolvedSaleTargetIds(rawId, rawData, normalized);
  const dailySaleCode = normalized.dailySaleCode || `VENTA-${normalized.date.replace(/-/g, '')}`;

  await firestore.collection('ingresos').doc(ingresoId).set({
    date: normalized.date,
    month: normalized.month,
    amount: normalizeAmount(normalized.subtotal ?? normalized.amount),
    subtotal: normalizeAmount(normalized.subtotal ?? normalized.amount),
    subtotalExento: normalizeAmount(normalized.subtotalExento),
    subtotalGravado: normalizeAmount(normalized.subtotalGravado),
    iva: normalizeAmount(normalized.iva),
    total: normalizeAmount(normalized.total ?? normalized.amount),
    description: normalized.description || `VENTA DIARIA SICAR ${normalized.date}`,
    reference: normalized.reference || dailySaleCode,
    dailySaleCode,
    branch: getBranchId(),
    branchName: getBranchName(),
    source: 'sicar',
    sourceType: normalized.type || rawData.sourceType || 'venta',
    sourceLabel: 'SICAR',
    sourceSystem: 'SICAR',
    sourceBranch: getBranchName(),
    sourceMode: rawData.sourceMode || 'push',
    sourceCollection: SALES_TRIGGER_DOCUMENT.replace('{rawId}', rawId),
    sourceRawId: rawId,
    sourceRecordId: normalized.sourceRecordId,
    sourceRecordIds: normalized.sourceRecordIds || [],
    paymentBreakdown: normalized.paymentBreakdown || [],
    syncKey: normalized.type === 'daily_sale' ? getIncomeSyncKey(normalized.date) : `sicar:venta:${rawId}`,
    syncedBy: 'cloud-function',
    syncedAt: FieldValue.serverTimestamp(),
    lastSyncedAt: FieldValue.serverTimestamp(),
    timestamp: FieldValue.serverTimestamp(),
    is_conciled: false,
    timezone: getTimezone(),
  }, { merge: true });

  return {
    route: 'venta',
    targetDocIds: {
      ingresoId,
    },
  };
}

async function cancelRawPurchase(rawId, options = {}) {
  const allowedStatuses = options.allowedStatuses || ['pending', 'processing', 'processed', 'error', 'ignored'];
  const lock = await lockRawPrivateDocument(getRawPurchasesCollection(), rawId, {
    allowedStatuses,
    nextStatus: 'cancelling',
    nextFields: {
      cancellationStartedAt: FieldValue.serverTimestamp(),
      cancellingBy: 'cloud-function',
    },
  });

  if (!lock.locked) {
    return { skipped: true, reason: lock.reason };
  }

  const rawData = lock.data || {};
  const normalized = extractNormalizedPurchase(rawData);
  const cancelReason = getCancellationReason(rawData) || 'ANULADO EN INTEGRADOR';

  try {
    const result = await cancelPurchaseTargets(rawId, rawData, normalized);

    await lock.ref.set({
      status: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: 'cloud-function',
      cancelReason,
      targetDocIds: result.targetDocIds,
      resolvedRoute: result.route,
      removedAbonoIds: result.removedAbonoIds || [],
    }, { merge: true });

    return result;
  } catch (error) {
    await lock.ref.set({
      status: 'error',
      error: error.message || 'Error anulando compra SICAR.',
      errorAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    throw error;
  }
}

async function cancelRawSale(rawId, options = {}) {
  const allowedStatuses = options.allowedStatuses || ['pending', 'processing', 'processed', 'error', 'ignored'];
  const lock = await lockRawPrivateDocument(getRawSalesCollection(), rawId, {
    allowedStatuses,
    nextStatus: 'cancelling',
    nextFields: {
      cancellationStartedAt: FieldValue.serverTimestamp(),
      cancellingBy: 'cloud-function',
    },
  });

  if (!lock.locked) {
    return { skipped: true, reason: lock.reason };
  }

  const rawData = lock.data || {};
  const cancelReason = getCancellationReason(rawData) || 'ANULADO EN INTEGRADOR';

  try {
    const result = await cancelSaleTargets(rawId, rawData);

    await lock.ref.set({
      status: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: 'cloud-function',
      cancelReason,
      targetDocIds: result.targetDocIds,
      resolvedRoute: result.route,
    }, { merge: true });

    return result;
  } catch (error) {
    await lock.ref.set({
      status: 'error',
      error: error.message || 'Error anulando venta SICAR.',
      errorAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    throw error;
  }
}

async function processRawPurchase(rawId, options = {}) {
  const allowedStatuses = options.allowedStatuses || ['pending'];
  const lock = await lockRawPrivateDocument(getRawPurchasesCollection(), rawId, {
    allowedStatuses,
    nextStatus: 'processing',
    nextFields: {
      processingStartedAt: FieldValue.serverTimestamp(),
      processingBy: 'cloud-function',
    },
  });

  if (!lock.locked) {
    return { skipped: true, reason: lock.reason };
  }

  const rawData = lock.data || {};
  const normalized = extractNormalizedPurchase(rawData);

  if (!normalized?.date || !normalized.amount) {
    const message = 'El documento privado no tiene fecha o monto valido.';
    await lock.ref.set({
      status: 'error',
      error: message,
      errorAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    throw new Error(message);
  }

  if (!isOnOrAfterCutover(normalized.date)) {
    await ignoreRawDocument(lock.ref, 'before_cutover', normalized.date);
    return {
      skipped: true,
      reason: 'before_cutover',
      rawDate: normalized.date,
      cutoverDate: getPrivateCutoverDate(),
    };
  }

  try {
    let result;

    if (normalized.paymentRoute === 'credito') {
      result = await createCreditPurchase(rawId, normalized, rawData);
    } else if (normalized.paymentRoute === 'efectivo') {
      result = await createCashPurchase(rawId, normalized, rawData);
    } else {
      result = await createOtherPurchase(rawId, normalized, rawData);
    }

    await lock.ref.set({
      status: 'processed',
      processedAt: FieldValue.serverTimestamp(),
      processedBy: 'cloud-function',
      targetDocIds: result.targetDocIds,
      resolvedRoute: result.route,
    }, { merge: true });

    return result;
  } catch (error) {
    await lock.ref.set({
      status: 'error',
      error: error.message || 'Error procesando compra SICAR.',
      errorAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    throw error;
  }
}

async function processRawSale(rawId, options = {}) {
  const allowedStatuses = options.allowedStatuses || ['pending'];
  const lock = await lockRawPrivateDocument(getRawSalesCollection(), rawId, {
    allowedStatuses,
    nextStatus: 'processing',
    nextFields: {
      processingStartedAt: FieldValue.serverTimestamp(),
      processingBy: 'cloud-function',
    },
  });

  if (!lock.locked) {
    return { skipped: true, reason: lock.reason };
  }

  const rawData = lock.data || {};
  const normalized = extractNormalizedSale(rawData);

  const allowsZeroAmount = normalized?.type === 'daily_sale' || normalized?.sourceType === 'daily_sale';

  if (!normalized?.date || (!allowsZeroAmount && !normalized.amount)) {
    const message = 'El documento privado de venta no tiene fecha o monto valido.';
    await lock.ref.set({
      status: 'error',
      error: message,
      errorAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    throw new Error(message);
  }

  if (!isOnOrAfterCutover(normalized.date)) {
    await ignoreRawDocument(lock.ref, 'before_cutover', normalized.date);
    return {
      skipped: true,
      reason: 'before_cutover',
      rawDate: normalized.date,
      cutoverDate: getPrivateCutoverDate(),
    };
  }

  try {
    const result = await createSaleIncome(rawId, normalized, rawData);

    await lock.ref.set({
      status: 'processed',
      processedAt: FieldValue.serverTimestamp(),
      processedBy: 'cloud-function',
      targetDocIds: result.targetDocIds,
      resolvedRoute: result.route,
    }, { merge: true });

    return result;
  } catch (error) {
    await lock.ref.set({
      status: 'error',
      error: error.message || 'Error procesando venta SICAR.',
      errorAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    throw error;
  }
}

async function collectReplayCandidates(collectionRef, sourceType) {
  const snapshot = await collectionRef.get();

  return snapshot.docs
    .map((docSnapshot) => {
      const data = docSnapshot.data() || {};
      const normalized = sourceType === 'compra'
        ? extractNormalizedPurchase(data)
        : extractNormalizedSale(data);

      return {
        id: docSnapshot.id,
        ref: docSnapshot.ref,
        sourceType,
        status: getPipelineStatus(data, 'pending'),
        date: normalized?.date || '',
        amount: normalized?.amount || 0,
        isCancelled: isRawBusinessCancelled(data),
      };
    })
    .sort((left, right) => {
      if (left.date === right.date) return left.id.localeCompare(right.id);
      return left.date.localeCompare(right.date);
    });
}

async function replayPrivateSicarStaging({ preview = false, requeueErrors = true, limit = 200 }) {
  const cutoverDate = getPrivateCutoverDate();
  const purchaseCandidates = await collectReplayCandidates(getRawPurchasesCollection(), 'compra');
  const saleCandidates = await collectReplayCandidates(getRawSalesCollection(), 'venta');
  const allCandidates = [...purchaseCandidates, ...saleCandidates];
  const processable = [];
  const ignored = [];

  for (const candidate of allCandidates) {
    const canRetryStatus = candidate.isCancelled
      ? !['cancelling', 'cancelled'].includes(candidate.status)
      : candidate.status === 'pending' || (requeueErrors && candidate.status === 'error');
    if (!canRetryStatus) continue;

    if (!candidate.date || candidate.date < cutoverDate) {
      ignored.push(candidate);
      continue;
    }

    processable.push(candidate);
  }

  const selected = processable.slice(0, Math.max(1, Math.min(Number(limit) || 200, 500)));

  if (!preview) {
    for (const candidate of ignored) {
      await ignoreRawDocument(candidate.ref, 'before_cutover', candidate.date);
    }
  }

  const results = [];

  if (!preview) {
    for (const candidate of selected) {
      if (candidate.sourceType === 'compra' && candidate.isCancelled) {
        results.push(await cancelRawPurchase(candidate.id, { allowedStatuses: ['pending', 'processing', 'processed', 'error', 'ignored'] }));
      } else if (candidate.sourceType === 'compra') {
        results.push(await processRawPurchase(candidate.id, { allowedStatuses: ['pending', 'error'] }));
      } else if (candidate.isCancelled) {
        results.push(await cancelRawSale(candidate.id, { allowedStatuses: ['pending', 'processing', 'processed', 'error', 'ignored'] }));
      } else {
        results.push(await processRawSale(candidate.id, { allowedStatuses: ['pending', 'error'] }));
      }
    }
  }

  return {
    ok: true,
    cutoverDate,
    preview,
    selectedCount: selected.length,
    ignoredBeforeCutover: ignored.length,
    processedCount: preview ? 0 : results.filter((item) => !item?.skipped).length,
    skippedCount: preview ? 0 : results.filter((item) => item?.skipped).length,
    selected: selected.map((candidate) => ({
      id: candidate.id,
      sourceType: candidate.sourceType,
      date: candidate.date,
      amount: candidate.amount,
      status: candidate.status,
      isCancelled: candidate.isCancelled,
    })),
  };
}

function ensureAdminUser(auth, actionLabel = 'sincronizar SICAR') {
  const email = auth?.token?.email || '';

  if (!auth) {
    throw new HttpsError('unauthenticated', `Debes iniciar sesion para ${actionLabel}.`);
  }

  if (!email || email === LIMITED_USER_EMAIL) {
    throw new HttpsError('permission-denied', `No tienes permisos para ${actionLabel}.`);
  }

  return email;
}

function normalizeUserEmail(email = '') {
  return normalizeText(email).toLowerCase();
}

function getUserProfileDocId(email = '') {
  return normalizeUserEmail(email).replace(/\//g, '_');
}

function ensureMasterUser(auth, actionLabel = 'administrar usuarios') {
  const email = normalizeUserEmail(auth?.token?.email || '');

  if (!auth) {
    throw new HttpsError('unauthenticated', `Debes iniciar sesion para ${actionLabel}.`);
  }

  if (email !== MASTER_USER_EMAIL) {
    throw new HttpsError('permission-denied', `Solo el usuario master puede ${actionLabel}.`);
  }

  return email;
}

function normalizeUserModules(modules = {}) {
  return USER_ACCESS_MODULES.reduce((acc, moduleId) => {
    acc[moduleId] = modules?.[moduleId] === true;
    return acc;
  }, {});
}

function publicAuthUserPayload(userRecord, profile = {}) {
  const email = normalizeUserEmail(userRecord.email || profile.email || '');

  return {
    uid: userRecord.uid || profile.uid || '',
    email,
    displayName: userRecord.displayName || profile.displayName || profile.name || '',
    disabled: userRecord.disabled === true,
    active: profile.active !== false && userRecord.disabled !== true,
    modules: normalizeUserModules(profile.modules || {}),
    role: email === MASTER_USER_EMAIL ? 'master' : (profile.role || 'limited'),
    createdAt: userRecord.metadata?.creationTime || profile.createdAt || null,
    lastSignInAt: userRecord.metadata?.lastSignInTime || profile.lastSignInAt || null,
  };
}

exports.adminListAppUsers = onCall(ADMIN_CALLABLE_FUNCTION_OPTIONS, async (request) => {
  ensureMasterUser(request.auth, 'listar usuarios del sistema');

  const [listResult, profilesSnapshot] = await Promise.all([
    admin.auth().listUsers(1000),
    firestore.collection(USER_PROFILES_COLLECTION).get(),
  ]);

  const profilesByEmail = new Map();
  profilesSnapshot.forEach((docSnap) => {
    const profile = docSnap.data() || {};
    const email = normalizeUserEmail(profile.email || docSnap.id);
    if (email) profilesByEmail.set(email, { id: docSnap.id, ...profile });
  });

  const users = listResult.users.map((userRecord) => {
    const email = normalizeUserEmail(userRecord.email || '');
    return publicAuthUserPayload(userRecord, profilesByEmail.get(email) || {});
  });

  const authEmails = new Set(users.map((user) => user.email));
  profilesByEmail.forEach((profile, email) => {
    if (!authEmails.has(email)) {
      users.push(publicAuthUserPayload({
        uid: profile.uid || '',
        email,
        displayName: profile.displayName || profile.name || '',
        disabled: profile.active === false,
        metadata: {},
      }, profile));
    }
  });

  return {
    ok: true,
    users: users.sort((a, b) => {
      if (a.role === 'master' && b.role !== 'master') return -1;
      if (b.role === 'master' && a.role !== 'master') return 1;
      return String(a.email).localeCompare(String(b.email), 'es');
    }),
  };
});

exports.adminCreateAppUser = onCall(ADMIN_CALLABLE_FUNCTION_OPTIONS, async (request) => {
  const actorEmail = ensureMasterUser(request.auth, 'crear o actualizar usuarios del sistema');
  const payload = request.data || {};
  const email = normalizeUserEmail(payload.email);
  const password = normalizeText(payload.password);
  const displayName = normalizeText(payload.displayName || payload.name);
  const active = payload.active !== false;
  const modules = normalizeUserModules(payload.modules || {});

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'Debes indicar un correo valido.');
  }

  if (email === MASTER_USER_EMAIL) {
    throw new HttpsError('invalid-argument', 'El usuario master no se edita desde este panel.');
  }

  let userRecord = null;

  try {
    userRecord = await admin.auth().getUserByEmail(email);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') {
      throw error;
    }
  }

  if (!userRecord && password.length < 6) {
    throw new HttpsError('invalid-argument', 'La contrasena debe tener al menos 6 caracteres para usuarios nuevos.');
  }

  if (userRecord) {
    const updates = {
      disabled: !active,
    };

    if (displayName) updates.displayName = displayName;

    if (password) {
      if (password.length < 6) {
        throw new HttpsError('invalid-argument', 'La contrasena debe tener al menos 6 caracteres.');
      }
      updates.password = password;
    }

    userRecord = await admin.auth().updateUser(userRecord.uid, updates);
  } else {
    userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: displayName || undefined,
      disabled: !active,
      emailVerified: false,
    });
  }

  const profileRef = firestore.collection(USER_PROFILES_COLLECTION).doc(getUserProfileDocId(email));
  const existingProfile = await profileRef.get();
  const profilePayload = {
    uid: userRecord.uid,
    email,
    displayName,
    active,
    role: 'limited',
    modules,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actorEmail,
  };

  if (!existingProfile.exists) {
    profilePayload.createdAt = FieldValue.serverTimestamp();
  }

  await profileRef.set(profilePayload, { merge: true });

  return {
    ok: true,
    user: publicAuthUserPayload(userRecord, { email, displayName, active, role: 'limited', modules }),
  };
});

function getWhatsappMedia(message = {}) {
  const supportedTypes = ['image', 'document', 'audio', 'video'];
  const type = supportedTypes.find((candidate) => message[candidate]?.id);

  if (!type) return null;

  return {
    type,
    id: message[type].id,
    mimeType: message[type].mime_type || '',
    sha256: message[type].sha256 || '',
    caption: message[type].caption || '',
    fileName: message[type].filename || '',
  };
}

function getWhatsappMessages(body = {}) {
  const messages = [];

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const contactByWaId = new Map((value.contacts || []).map((contact) => [contact.wa_id, contact]));

      for (const message of value.messages || []) {
        messages.push({
          message,
          value,
          contact: contactByWaId.get(message.from) || {},
        });
      }
    }
  }

  return messages;
}

function sanitizeStorageSegment(value, fallback = 'sin_identificar') {
  return normalizeText(value || fallback)
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96) || fallback;
}

function extensionFromMime(mimeType = '', fileName = '') {
  const existingExtension = normalizeText(fileName).split('.').pop();
  if (existingExtension && existingExtension.length <= 8 && existingExtension !== fileName) {
    return existingExtension.toLowerCase();
  }

  const normalized = mimeType.toLowerCase();
  if (normalized.includes('pdf')) return 'pdf';
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  if (normalized.includes('mp4')) return 'mp4';
  if (normalized.includes('mpeg')) return 'mp3';
  return 'bin';
}

function firebaseStorageUrl(bucketName, storagePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
}

async function fetchWhatsappJson(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WhatsApp API respondio ${response.status}: ${text}`);
  }

  return response.json();
}

async function fetchWhatsappBuffer(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`No se pudo descargar media WhatsApp ${response.status}: ${text}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function storeWhatsappMedia({ message, media, senderPhone, contactName }) {
  const accessToken = WHATSAPP_ACCESS_TOKEN.value();
  const graphVersion = WHATSAPP_GRAPH_VERSION.value();
  const metadata = await fetchWhatsappJson(`https://graph.facebook.com/${graphVersion}/${media.id}`, accessToken);
  const buffer = await fetchWhatsappBuffer(metadata.url, accessToken);
  const contentType = metadata.mime_type || media.mimeType || 'application/octet-stream';
  const extension = extensionFromMime(contentType, media.fileName);
  const messageId = sanitizeStorageSegment(message.id || createHash('sha1').update(JSON.stringify(message)).digest('hex'));
  const safePhone = sanitizeStorageSegment(senderPhone);
  const safeMediaId = sanitizeStorageSegment(media.id, 'media');
  const safeName = sanitizeStorageSegment(media.fileName || `${media.type}_${safeMediaId}`, media.type);
  const storagePath = `whatsapp/inbox/${safePhone}/${messageId}/${safeName}.${extension}`;
  const bucket = admin.storage().bucket();
  const downloadToken = randomUUID();

  await bucket.file(storagePath).save(buffer, {
    resumable: false,
    metadata: {
      contentType,
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
        whatsappMediaId: media.id,
        whatsappMessageId: message.id || '',
        whatsappSenderPhone: senderPhone || '',
        whatsappSenderName: contactName || '',
      },
    },
  });

  return {
    url: firebaseStorageUrl(bucket.name, storagePath, downloadToken),
    path: storagePath,
    mimeType: contentType,
    fileName: media.fileName || `${safeName}.${extension}`,
    size: buffer.length,
    mediaId: media.id,
    sha256: metadata.sha256 || media.sha256 || '',
  };
}

async function upsertWhatsappInboxMessage({ message, value, contact }) {
  const media = getWhatsappMedia(message);
  const senderPhone = normalizeText(message.from);
  const contactName = normalizeText(contact?.profile?.name);
  const messageId = message.id || createHash('sha1').update(JSON.stringify(message)).digest('hex');
  const inboxRef = firestore.collection('whatsapp_inbox').doc(messageId);
  const textBody = message.text?.body || media?.caption || '';
  let mediaPayload = {};
  let supportPayload = {};
  let status = 'received';
  let errorMessage = '';

  if (media?.id) {
    try {
      const storedMedia = await storeWhatsappMedia({ message, media, senderPhone, contactName });
      mediaPayload = {
        ...storedMedia,
        type: media.type,
      };
      supportPayload = {
        fotoFacturaUrl: storedMedia.url,
        fotoFacturaPath: storedMedia.path,
        support: {
          url: storedMedia.url,
          path: storedMedia.path,
          source: 'whatsapp',
          sourceCollection: 'whatsapp_inbox',
          sourceDocId: messageId,
          fileName: storedMedia.fileName,
          contentType: storedMedia.mimeType,
          uploadedAt: new Date().toISOString(),
          whatsappMediaId: media.id,
          whatsappMessageId: messageId,
        },
      };
    } catch (error) {
      status = 'error';
      errorMessage = error.message;
      logger.error('Error guardando media WhatsApp', {
        messageId,
        mediaId: media.id,
        error: error.message,
      });
    }
  }

  await inboxRef.set({
    source: 'whatsapp',
    channel: 'whatsapp',
    status,
    targetType: 'unknown',
    messageId,
    senderPhone,
    senderName: contactName,
    phoneNumberId: value.metadata?.phone_number_id || '',
    displayPhoneNumber: value.metadata?.display_phone_number || '',
    messageType: message.type || '',
    text: normalizeText(textBody),
    media: mediaPayload,
    error: errorMessage,
    receivedAt: message.timestamp
      ? admin.firestore.Timestamp.fromMillis(Number(message.timestamp) * 1000)
      : FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...supportPayload,
  }, { merge: true });

  return {
    messageId,
    status,
    hasMedia: Boolean(media?.id),
    supportPath: supportPayload.fotoFacturaPath || '',
  };
}

exports.whatsappWebhook = onRequest(WHATSAPP_WEBHOOK_FUNCTION_OPTIONS, async (request, response) => {
  if (request.method === 'GET') {
    const mode = request.query['hub.mode'];
    const token = request.query['hub.verify_token'];
    const challenge = request.query['hub.challenge'];

    if (mode === 'subscribe' && normalizeText(token) === normalizeText(WHATSAPP_VERIFY_TOKEN.value())) {
      response.status(200).send(challenge || '');
      return;
    }

    response.status(403).send('Token de verificacion invalido.');
    return;
  }

  if (request.method !== 'POST') {
    response.status(405).json({ ok: false, error: 'Metodo no permitido.' });
    return;
  }

  try {
    const messages = getWhatsappMessages(request.body || {});
    const processed = [];

    for (const item of messages) {
      processed.push(await upsertWhatsappInboxMessage(item));
    }

    response.status(200).json({
      ok: true,
      received: messages.length,
      processed,
    });
  } catch (error) {
    logger.error('Error en whatsappWebhook', error);
    response.status(500).json({
      ok: false,
      error: error.message || 'Error procesando webhook de WhatsApp.',
    });
  }
});

exports.syncSicarIngresosCarnesAmparito = onCall(INCOME_CALLABLE_FUNCTION_OPTIONS, async (request) => {
  const actorEmail = ensureAdminUser(request.auth, 'sincronizar ingresos SICAR');
  const startDate = request.data?.startDate || request.data?.date;
  const endDate = request.data?.endDate || request.data?.date || startDate;
  const preview = normalizeBoolean(request.data?.preview);

  logger.info('Iniciando sincronizacion SICAR callable', {
    syncType: 'ingresos',
    actorEmail,
    startDate,
    endDate,
    preview,
  });

  return executeIncomeSync({
    startDate,
    endDate,
    preview,
    actorEmail,
  });
});

exports.sicarIngresosApi = onRequest(INCOME_HTTP_FUNCTION_OPTIONS, async (request, response) => {
  if (!['GET', 'POST'].includes(request.method)) {
    response.status(405).json({ ok: false, error: 'Metodo no permitido.' });
    return;
  }

  const providedToken = request.headers.authorization?.replace(/^Bearer\s+/i, '') || request.headers['x-api-key'];

  if (!providedToken || providedToken !== SICAR_SYNC_API_TOKEN.value()) {
    response.status(401).json({ ok: false, error: 'Token invalido.' });
    return;
  }

  const source = request.method === 'GET' ? request.query : request.body;
  const startDate = source.startDate || source.date;
  const endDate = source.endDate || source.date || startDate;
  const preview = normalizeBoolean(source.preview);

  try {
    const result = await executeIncomeSync({
      startDate,
      endDate,
      preview,
      actorEmail: 'api',
    });

    response.status(200).json(result);
  } catch (error) {
    logger.error('Error en sicarIngresosApi', error);

    const message = error instanceof HttpsError ? error.message : 'Error interno sincronizando SICAR.';
    const status = error instanceof HttpsError && error.code === 'invalid-argument' ? 400 : 500;

    await writeSyncLog({
      syncType: 'ingresos',
      actor: 'api',
      preview,
      startDate,
      endDate,
      branchId: getBranchId(),
      branchName: getBranchName(),
      syncedCount: 0,
      totalAmount: 0,
      status: 'error',
      error: message,
    });

    response.status(status).json({ ok: false, error: message });
  }
});

exports.syncSicarComprasCarnesAmparito = onCall(PURCHASE_CALLABLE_FUNCTION_OPTIONS, async (request) => {
  const actorEmail = ensureAdminUser(request.auth, 'sincronizar compras SICAR');
  const rows = getRequestRows(request.data);
  const startDate = request.data?.startDate || request.data?.date;
  const endDate = request.data?.endDate || request.data?.date || startDate;
  const preview = normalizeBoolean(request.data?.preview);

  logger.info('Iniciando sincronizacion de compras SICAR callable', {
    syncType: 'compras',
    actorEmail,
    startDate,
    endDate,
    preview,
    pushedRows: Array.isArray(rows) ? rows.length : 0,
  });

  return executePurchaseSync({
    startDate,
    endDate,
    preview,
    actorEmail,
    rows,
  });
});

exports.sicarComprasApi = onRequest(PURCHASE_HTTP_FUNCTION_OPTIONS, async (request, response) => {
  if (!['GET', 'POST'].includes(request.method)) {
    response.status(405).json({ ok: false, error: 'Metodo no permitido.' });
    return;
  }

  const providedToken = request.headers.authorization?.replace(/^Bearer\s+/i, '') || request.headers['x-api-key'];

  if (!providedToken || providedToken !== SICAR_SYNC_API_TOKEN.value()) {
    response.status(401).json({ ok: false, error: 'Token invalido.' });
    return;
  }

  const source = request.method === 'GET' ? request.query : request.body;
  const rows = getRequestRows(source);
  const startDate = source?.startDate || source?.date;
  const endDate = source?.endDate || source?.date || startDate;
  const preview = normalizeBoolean(source?.preview);

  try {
    const result = await executePurchaseSync({
      startDate,
      endDate,
      preview,
      actorEmail: 'api',
      rows,
    });

    response.status(200).json(result);
  } catch (error) {
    logger.error('Error en sicarComprasApi', error);

    const message = error instanceof HttpsError ? error.message : 'Error interno sincronizando compras SICAR.';
    const status = error instanceof HttpsError && error.code === 'invalid-argument' ? 400 : 500;

    await writeSyncLog({
      syncType: 'compras',
      actor: 'api',
      preview,
      startDate,
      endDate,
      branchId: getBranchId(),
      branchName: getBranchName(),
      stagedCount: 0,
      totalAmount: 0,
      status: 'error',
      error: message,
    });

    response.status(status).json({ ok: false, error: message });
  }
});

exports.processSicarPrivateStagingFromCutover = onCall(BASE_FUNCTION_OPTIONS, async (request) => {
  ensureAdminUser(request.auth, 'procesar staging privado SICAR');
  const preview = normalizeBoolean(request.data?.preview);
  const requeueErrors = request.data?.requeueErrors === undefined
    ? true
    : normalizeBoolean(request.data?.requeueErrors);
  const limit = request.data?.limit;

  return replayPrivateSicarStaging({
    preview,
    requeueErrors,
    limit,
  });
});

exports.sicarPrivateReplayApi = onRequest(PRIVATE_REPLAY_HTTP_FUNCTION_OPTIONS, async (request, response) => {
  if (!['GET', 'POST'].includes(request.method)) {
    response.status(405).json({ ok: false, error: 'Metodo no permitido.' });
    return;
  }

  const providedToken = request.headers.authorization?.replace(/^Bearer\s+/i, '') || request.headers['x-api-key'];

  if (!providedToken || providedToken !== SICAR_SYNC_API_TOKEN.value()) {
    response.status(401).json({ ok: false, error: 'Token invalido.' });
    return;
  }

  const source = request.method === 'GET' ? request.query : request.body;
  const preview = normalizeBoolean(source?.preview);
  const requeueErrors = source?.requeueErrors === undefined
    ? true
    : normalizeBoolean(source?.requeueErrors);
  const limit = source?.limit;

  try {
    const result = await replayPrivateSicarStaging({
      preview,
      requeueErrors,
      limit,
    });

    response.status(200).json(result);
  } catch (error) {
    logger.error('Error en sicarPrivateReplayApi', error);
    response.status(500).json({
      ok: false,
      error: error?.message || 'Error procesando staging privado SICAR.',
    });
  }
});

exports.processPendingSicarPurchase = onDocumentWritten({
  ...BASE_FUNCTION_OPTIONS,
  document: PURCHASE_TRIGGER_DOCUMENT,
}, async (event) => {
  const after = event.data?.after;
  const afterData = after?.data();
  const afterPipelineStatus = getPipelineStatus(afterData, 'pending');

  if (!afterData) {
    return;
  }

  const before = event.data?.before;
  const beforeData = before?.exists ? before.data() : null;
  const beforePipelineStatus = getPipelineStatus(beforeData, 'pending');

  if (isRawBusinessCancelled(afterData)) {
    if (['cancelling', 'cancelled'].includes(afterPipelineStatus)) {
      return;
    }

    try {
      const result = await cancelRawPurchase(event.params.rawId, {
        allowedStatuses: ['pending', 'processing', 'processed', 'error', 'ignored'],
      });

      logger.info('Compra SICAR privada anulada', {
        rawId: event.params.rawId,
        result,
      });
    } catch (error) {
      logger.error('Error anulando compra SICAR privada', {
        rawId: event.params.rawId,
        error: error.message,
      });
    }

    return;
  }

  if (afterPipelineStatus !== 'pending') {
    return;
  }

  if (beforePipelineStatus === 'pending' && afterData.processingStartedAt) {
    return;
  }

  try {
    const result = await processRawPurchase(event.params.rawId);

    logger.info('Compra SICAR privada procesada', {
      rawId: event.params.rawId,
      result,
    });
  } catch (error) {
    logger.error('Error procesando compra SICAR privada', {
      rawId: event.params.rawId,
      error: error.message,
    });
  }
});

exports.processPendingSicarSale = onDocumentWritten({
  ...BASE_FUNCTION_OPTIONS,
  document: SALES_TRIGGER_DOCUMENT,
}, async (event) => {
  const after = event.data?.after;
  const afterData = after?.data();
  const afterPipelineStatus = getPipelineStatus(afterData, 'pending');

  if (!afterData) {
    return;
  }

  const before = event.data?.before;
  const beforeData = before?.exists ? before.data() : null;
  const beforePipelineStatus = getPipelineStatus(beforeData, 'pending');

  if (isRawBusinessCancelled(afterData)) {
    if (['cancelling', 'cancelled'].includes(afterPipelineStatus)) {
      return;
    }

    try {
      const result = await cancelRawSale(event.params.rawId, {
        allowedStatuses: ['pending', 'processing', 'processed', 'error', 'ignored'],
      });

      logger.info('Venta SICAR privada anulada', {
        rawId: event.params.rawId,
        result,
      });
    } catch (error) {
      logger.error('Error anulando venta SICAR privada', {
        rawId: event.params.rawId,
        error: error.message,
      });
    }

    return;
  }

  if (afterPipelineStatus !== 'pending') {
    return;
  }

  if (beforePipelineStatus === 'pending' && afterData.processingStartedAt) {
    return;
  }

  try {
    const result = await processRawSale(event.params.rawId);

    logger.info('Venta SICAR privada procesada', {
      rawId: event.params.rawId,
      result,
    });
  } catch (error) {
    logger.error('Error procesando venta SICAR privada', {
      rawId: event.params.rawId,
      error: error.message,
    });
  }
});
