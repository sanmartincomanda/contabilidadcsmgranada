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
const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');
const WHATSAPP_GRAPH_VERSION = defineString('WHATSAPP_GRAPH_VERSION', { default: 'v21.0' });
const OPENAI_FISCAL_MODEL = defineString('OPENAI_FISCAL_MODEL', { default: 'gpt-5-mini' });
const SICAR_BRANCH_ID = defineString('SICAR_BRANCH_ID', { default: 'granada' });
const SICAR_BRANCH_NAME = defineString('SICAR_BRANCH_NAME', { default: 'CARNES SAN MARTIN GRANADA' });
const SICAR_TIMEZONE = defineString('SICAR_TIMEZONE', { default: 'America/Managua' });
const SICAR_CASHBOX_NAME = defineString('SICAR_CASHBOX_NAME', { default: 'CAJA 2' });

const BASE_FUNCTION_OPTIONS = {
  region: 'us-central1',
  timeoutSeconds: 120,
  memory: '256MiB',
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

const FISCAL_ASSISTANT_FUNCTION_OPTIONS = {
  ...BASE_FUNCTION_OPTIONS,
  timeoutSeconds: 90,
  memory: '512MiB',
  secrets: [
    OPENAI_API_KEY,
  ],
};

const PURCHASE_TRIGGER_DOCUMENT = 'integraciones_privadas/sicar/compras_raw/{rawId}';
const SALES_TRIGGER_DOCUMENT = 'integraciones_privadas/sicar/ventas_raw/{rawId}';
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const LIMITED_USER_EMAIL = 'adriandiazc95@gmail.com';
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
    categoria: 'Compra',
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

  batch.set(firestore.collection('cuentas_por_pagar').doc(cuentaPorPagarId), {
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
    monto: normalizeAmount(normalized.total ?? normalized.amount),
    saldo: normalizeAmount(normalized.total ?? normalized.amount),
    amount: normalized.amount,
    subtotal: normalized.subtotal,
    subtotalExento: normalized.subtotalExento,
    subtotalGravado: normalized.subtotalGravado,
    iva: normalized.iva,
    total: normalized.total,
    estado: 'pendiente',
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
    branch: getBranchId(),
    branchName: getBranchName(),
    paymentType: 'contado',
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
  const inboxRef = firestore.collection('whatsapp_ai_inbox').doc(messageId);
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
          sourceCollection: 'whatsapp_ai_inbox',
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
    aiStatus: 'pending_review',
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

    if (mode === 'subscribe' && token && token === WHATSAPP_VERIFY_TOKEN.value()) {
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

function getMonthStart(monthsBack = 0) {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCMonth(date.getUTCMonth() - monthsBack);
  return date.toISOString().substring(0, 7);
}

function sumBy(items, amountKeys = ['amount', 'monto', 'total']) {
  return items.reduce((sum, item) => {
    const value = amountKeys.map((key) => item[key]).find((candidate) => candidate !== undefined && candidate !== null);
    return normalizeAmount(sum + normalizeAmount(value));
  }, 0);
}

function topByAmount(items, labelKeys, amountKeys, limit = 8) {
  return [...items]
    .map((item) => {
      const label = labelKeys.map((key) => item[key]).find(Boolean) || item.id || 'Sin detalle';
      const amount = amountKeys.map((key) => item[key]).find((candidate) => candidate !== undefined && candidate !== null);
      return {
        label: normalizeText(label).slice(0, 120),
        amount: normalizeAmount(amount),
        date: normalizeDate(item.date || item.fecha || item.saleDate),
        id: item.id || '',
      };
    })
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

function buildSupplierLearningProfiles({ gastos = [], compras = [], cuentasPorPagar = [], savedProfiles = [] }) {
  const profiles = new Map();

  function addProfile(rawSupplier, patch = {}) {
    const supplier = normalizeText(rawSupplier).toUpperCase();
    const key = normalizeComparableText(supplier);
    if (!key) return;

    const existing = profiles.get(key) || {
      supplier,
      supplierKey: key,
      gastoCount: 0,
      compraCount: 0,
      creditCount: 0,
      contadoCount: 0,
      categories: {},
      paymentMethods: {},
      retentionModes: {},
      lastInvoiceNumber: '',
      lastSeenAt: '',
    };

    if (patch.kind === 'gasto') existing.gastoCount += 1;
    if (patch.kind === 'compra') existing.compraCount += 1;
    if (patch.credit === true) existing.creditCount += 1;
    if (patch.credit === false) existing.contadoCount += 1;
    if (patch.category) {
      const category = normalizeText(patch.category);
      existing.categories[category] = (existing.categories[category] || 0) + 1;
    }
    if (patch.paymentMethod) {
      const paymentMethod = normalizeText(patch.paymentMethod);
      existing.paymentMethods[paymentMethod] = (existing.paymentMethods[paymentMethod] || 0) + 1;
    }
    const ir = normalizeAmount(patch.retentionIr2);
    const municipal = normalizeAmount(patch.retentionMunicipal1);
    const retentionMode = ir > 0 && municipal > 0
      ? 'both'
      : ir > 0
        ? 'ir2'
        : municipal > 0
          ? 'municipal1'
          : 'none';
    existing.retentionModes[retentionMode] = (existing.retentionModes[retentionMode] || 0) + 1;
    if (patch.invoiceNumber) existing.lastInvoiceNumber = normalizeText(patch.invoiceNumber);
    if (patch.lastSeenAt && (!existing.lastSeenAt || patch.lastSeenAt > existing.lastSeenAt)) {
      existing.lastSeenAt = patch.lastSeenAt;
    }

    profiles.set(key, existing);
  }

  savedProfiles.forEach((profile) => {
    addProfile(profile.supplier, {
      kind: profile.kind,
      credit: profile.credit,
      category: profile.category,
      paymentMethod: profile.paymentMethod,
      retentionIr2: profile.retentionIr2,
      retentionMunicipal1: profile.retentionMunicipal1,
      invoiceNumber: profile.lastInvoiceNumber,
      lastSeenAt: profile.lastSeenAt,
    });
  });

  gastos.forEach((item) => addProfile(item.supplier || item.proveedor, {
    kind: 'gasto',
    credit: Boolean(item.linkedPayableId || normalizeComparableText(item.paymentType).includes('credito')),
    category: item.category || item.categoria,
    paymentMethod: item.paymentType || item.paymentMethod,
    retentionIr2: item.retentionIr2,
    retentionMunicipal1: item.retentionMunicipal1,
    invoiceNumber: item.invoiceNumber || item.factura,
    lastSeenAt: item.date || item.fecha || '',
  }));

  compras.forEach((item) => addProfile(item.supplier || item.proveedor, {
    kind: 'compra',
    credit: Boolean(item.linkedPayableId || normalizeComparableText(item.paymentType).includes('credito')),
    category: item.category || item.categoria,
    paymentMethod: item.paymentType || item.paymentMethod,
    retentionIr2: item.retentionIr2,
    retentionMunicipal1: item.retentionMunicipal1,
    invoiceNumber: item.invoiceNumber || item.factura,
    lastSeenAt: item.date || item.fecha || '',
  }));

  cuentasPorPagar.forEach((item) => addProfile(item.proveedor || item.supplier, {
    kind: item.isInventoryCost ? 'compra' : 'gasto',
    credit: true,
    category: item.category || item.categoria,
    paymentMethod: 'credito',
    retentionIr2: item.retentionIr2,
    retentionMunicipal1: item.retentionMunicipal1,
    invoiceNumber: item.numero || item.factura || item.invoiceNumber,
    lastSeenAt: item.fecha || item.date || '',
  }));

  const mostUsed = (values = {}) => Object.entries(values)
    .sort((left, right) => right[1] - left[1])
    .map(([value]) => value)[0] || '';

  return Array.from(profiles.values())
    .map((profile) => ({
      supplier: profile.supplier,
      usualType: profile.compraCount > profile.gastoCount ? 'compra' : 'gasto',
      confidence: normalizeAmount(Math.max(profile.compraCount, profile.gastoCount) / Math.max(profile.compraCount + profile.gastoCount, 1)),
      usualCredit: profile.creditCount > profile.contadoCount,
      usualCategory: mostUsed(profile.categories),
      usualPaymentMethod: mostUsed(profile.paymentMethods),
      usualRetentionMode: mostUsed(profile.retentionModes),
      retentionConfidence: normalizeAmount((profile.retentionModes[mostUsed(profile.retentionModes)] || 0) / Math.max(profile.compraCount + profile.gastoCount, 1)),
      lastInvoiceNumber: profile.lastInvoiceNumber,
      evidenceCount: profile.compraCount + profile.gastoCount,
      lastSeenAt: profile.lastSeenAt,
    }))
    .sort((left, right) => right.evidenceCount - left.evidenceCount)
    .slice(0, 40);
}

async function fetchAssistantLearningProfiles() {
  const snapshot = await firestore.collection('ai_fiscal_learning').limit(120).get();
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

async function fetchAssistantCategories() {
  const snapshot = await firestore.collection('categorias').limit(250).get();
  return snapshot.docs
    .map((entry) => ({
      id: entry.id,
      name: normalizeText(entry.data()?.name),
      order: normalizeAmount(entry.data()?.order),
    }))
    .filter((category) => category.name)
    .sort((left, right) => {
      const leftOrder = Number.isFinite(left.order) && left.order > 0 ? left.order : 9999;
      const rightOrder = Number.isFinite(right.order) && right.order > 0 ? right.order : 9999;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.name.localeCompare(right.name, 'es');
    });
}

async function fetchCollectionSince(collectionName, field, sinceValue, limitCount = 350) {
  const snapshot = await firestore
    .collection(collectionName)
    .where(field, '>=', sinceValue)
    .limit(limitCount)
    .get();

  return snapshot.docs.map((entry) => ({
    id: entry.id,
    ...entry.data(),
  }));
}

async function buildFiscalAssistantContext() {
  const monthStart = getMonthStart(0);
  const sixMonths = getMonthStart(6);
  const dateStart = `${sixMonths}-01`;

  const [
    ingresos,
    facturasMembretadas,
    gastos,
    compras,
    cuentasPorPagar,
    abonosPagar,
    assistantLearning,
    assistantCategories,
  ] = await Promise.all([
    fetchCollectionSince('ingresos', 'month', sixMonths),
    fetchCollectionSince('facturas_membretadas_ventas', 'saleDate', dateStart),
    fetchCollectionSince('gastos', 'date', dateStart),
    fetchCollectionSince('compras', 'month', sixMonths),
    fetchCollectionSince('cuentas_por_pagar', 'month', sixMonths),
    fetchCollectionSince('abonos_pagar', 'fecha', dateStart),
    fetchAssistantLearningProfiles(),
    fetchAssistantCategories(),
  ]);

  const currentMonthIncome = ingresos.filter((item) => item.month === monthStart);
  const currentMonthGastos = gastos.filter((item) => String(item.date || '').startsWith(monthStart));
  const currentMonthCompras = compras.filter((item) => item.month === monthStart);
  const pendingPayables = cuentasPorPagar.filter((item) => ['pendiente', 'parcial'].includes(normalizeComparableText(item.estado)));
  const overduePayables = pendingPayables.filter((item) => item.vencimiento && item.vencimiento < new Date().toISOString().substring(0, 10));

  return {
    generatedAt: new Date().toISOString(),
    branchName: getBranchName(),
    currentMonth: monthStart,
    windowStartMonth: sixMonths,
    totals: {
      currentMonthIncomeSubtotal: sumBy(currentMonthIncome, ['subtotal', 'amount']),
      currentMonthIncomeIva: sumBy(currentMonthIncome, ['iva']),
      currentMonthIncomeTotal: sumBy(currentMonthIncome, ['total', 'amount']),
      currentMonthGastos: sumBy(currentMonthGastos, ['amount', 'monto', 'total']),
      currentMonthComprasSubtotal: sumBy(currentMonthCompras, ['subtotal', 'amount']),
      currentMonthComprasIva: sumBy(currentMonthCompras, ['iva']),
      currentMonthComprasTotal: sumBy(currentMonthCompras, ['total', 'amount']),
      pendingPayablesBalance: sumBy(pendingPayables, ['saldo']),
      overduePayablesBalance: sumBy(overduePayables, ['saldo']),
      sixMonthRetentionsIr2: sumBy([...compras, ...gastos, ...facturasMembretadas], ['retentionIr2']),
      sixMonthRetentionsMunicipal1: sumBy([...compras, ...gastos, ...facturasMembretadas], ['retentionMunicipal1']),
      sixMonthSalesIva: sumBy(ingresos, ['iva']),
      sixMonthPurchaseIva: sumBy([...compras, ...gastos], ['iva']),
    },
    counts: {
      ingresos: ingresos.length,
      facturasMembretadas: facturasMembretadas.length,
      gastos: gastos.length,
      compras: compras.length,
      cuentasPorPagar: cuentasPorPagar.length,
      pendingPayables: pendingPayables.length,
      overduePayables: overduePayables.length,
      abonosPagar: abonosPagar.length,
    },
    highlights: {
      topPendingPayables: topByAmount(pendingPayables, ['proveedor', 'supplier', 'descripcion'], ['saldo']),
      topCurrentMonthExpenses: topByAmount(currentMonthGastos, ['description', 'descripcion', 'category', 'categoria'], ['amount', 'monto', 'total']),
      topCurrentMonthPurchases: topByAmount(currentMonthCompras, ['supplier', 'proveedor', 'description'], ['total', 'amount']),
      recentPayments: topByAmount(abonosPagar, ['proveedor'], ['montoTotal'], 6),
    },
    learning: {
      supplierProfiles: buildSupplierLearningProfiles({
        gastos,
        compras,
        cuentasPorPagar,
        savedProfiles: assistantLearning,
      }),
    },
    categories: {
      expenseCategories: assistantCategories.map((category) => category.name),
      fallbackExpenseCategory: 'Otros gastos (no categorizado)',
      operationSupplyHints: [
        'rollos termicos',
        'papel termico',
        'bolsas',
        'empaque',
        'etiquetas',
        'limpieza',
        'oficina',
        'mantenimiento',
        'servicios basicos',
      ],
      inventoryPurchaseHints: [
        'camaron',
        'langosta',
        'carne',
        'pollo',
        'cerdo',
        'pescado',
        'mariscos',
        'mercaderia',
        'producto para vender',
        'materia prima vendible',
      ],
    },
  };
}

function fiscalDraftSchema() {
  return {
    type: 'json_schema',
    name: 'fiscal_assistant_response',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reply: { type: 'string' },
        intent: {
          type: 'string',
          enum: ['answer_question', 'create_draft', 'analyze_support', 'request_more_info', 'system_status'],
        },
        confidence: { type: 'number' },
        warnings: {
          type: 'array',
          items: { type: 'string' },
        },
        suggestedDraft: {
          type: 'object',
          additionalProperties: false,
          properties: {
            targetType: {
              type: 'string',
              enum: ['none', 'gasto_credito', 'gasto_contado', 'compra_credito', 'compra_contado', 'abono_cxp', 'factura_membretada_venta'],
            },
            date: { type: 'string' },
            supplier: { type: 'string' },
            invoiceNumber: { type: 'string' },
            category: { type: 'string' },
            description: { type: 'string' },
            paymentMethod: { type: 'string' },
            paymentReference: { type: 'string' },
            subtotal: { type: 'number' },
            iva: { type: 'number' },
            total: { type: 'number' },
            retentionIr2: { type: 'number' },
            retentionMunicipal1: { type: 'number' },
            payableProvider: { type: 'string' },
            payableInvoiceNumber: { type: 'string' },
            amountPaid: { type: 'number' },
          },
          required: [
            'targetType',
            'date',
            'supplier',
            'invoiceNumber',
            'category',
            'description',
            'paymentMethod',
            'paymentReference',
            'subtotal',
            'iva',
            'total',
            'retentionIr2',
            'retentionMunicipal1',
            'payableProvider',
            'payableInvoiceNumber',
            'amountPaid',
          ],
        },
        followUpQuestions: {
          type: 'array',
          items: { type: 'string' },
        },
        quickReplies: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['reply', 'intent', 'confidence', 'warnings', 'suggestedDraft', 'followUpQuestions', 'quickReplies'],
    },
  };
}

function fiscalExtractionSchema() {
  return {
    type: 'json_schema',
    name: 'fiscal_invoice_extraction',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        confidence: { type: 'number' },
        warnings: {
          type: 'array',
          items: { type: 'string' },
        },
        suggestedDraft: {
          type: 'object',
          additionalProperties: false,
          properties: {
            targetType: {
              type: 'string',
              enum: ['none', 'gasto_credito', 'gasto_contado', 'compra_credito', 'compra_contado', 'abono_cxp', 'factura_membretada_venta'],
            },
            date: { type: 'string' },
            supplier: { type: 'string' },
            invoiceNumber: { type: 'string' },
            category: { type: 'string' },
            description: { type: 'string' },
            paymentMethod: { type: 'string' },
            paymentReference: { type: 'string' },
            subtotal: { type: 'number' },
            iva: { type: 'number' },
            total: { type: 'number' },
            retentionIr2: { type: 'number' },
            retentionMunicipal1: { type: 'number' },
            payableProvider: { type: 'string' },
            payableInvoiceNumber: { type: 'string' },
            amountPaid: { type: 'number' },
          },
          required: [
            'targetType',
            'date',
            'supplier',
            'invoiceNumber',
            'category',
            'description',
            'paymentMethod',
            'paymentReference',
            'subtotal',
            'iva',
            'total',
            'retentionIr2',
            'retentionMunicipal1',
            'payableProvider',
            'payableInvoiceNumber',
            'amountPaid',
          ],
        },
        followUpQuestions: {
          type: 'array',
          items: { type: 'string' },
        },
        quickReplies: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['confidence', 'warnings', 'suggestedDraft', 'followUpQuestions', 'quickReplies'],
    },
  };
}

function normalizeClassificationHint(value) {
  const hint = normalizeComparableText(value);
  if (hint === 'gasto' || hint === 'compra') return hint;
  return 'auto';
}

function normalizeDigitizerOptions(value = {}) {
  const mode = normalizeComparableText(value.mode) === 'digitizer' ? 'digitizer' : 'chat';
  return {
    mode,
    autoRegister: mode === 'digitizer' && normalizeBoolean(value.autoRegister),
  };
}

function sanitizeConversationHistory(value) {
  if (!Array.isArray(value)) return [];

  return value.slice(-10).map((entry) => ({
    role: normalizeComparableText(entry?.role) === 'assistant' ? 'assistant' : 'user',
    text: normalizeText(entry?.text).slice(0, 700),
    followUpQuestions: Array.isArray(entry?.followUpQuestions)
      ? entry.followUpQuestions.map((question) => normalizeText(question).slice(0, 220)).filter(Boolean).slice(0, 4)
      : [],
    quickReplies: Array.isArray(entry?.quickReplies)
      ? entry.quickReplies.map((reply) => normalizeText(reply).slice(0, 80)).filter(Boolean).slice(0, 4)
      : [],
    hasSupport: Boolean(entry?.hasSupport),
    supportUrl: normalizeText(entry?.supportUrl).slice(0, 500),
    supportFiles: sanitizeAiSupportFiles(entry?.supportFiles).map((file) => ({
      type: file.type,
      label: file.label,
      url: file.url,
      fileName: file.fileName,
      contentType: file.contentType,
    })),
    draftTargetType: normalizeText(entry?.draftTargetType).slice(0, 80),
  })).filter((entry) => entry.text || entry.hasSupport || entry.followUpQuestions.length);
}

function getAiSupportLabel(type = '') {
  const normalized = normalizeComparableText(type);
  if (normalized === 'retentionir2') return 'Retencion anticipo IR 2%';
  if (normalized === 'retentionmunicipal1') return 'Retencion municipal 1%';
  return 'Factura / soporte principal';
}

function sanitizeAiSupportFile(file = {}, fallbackType = 'invoice') {
  const type = normalizeText(file.type || fallbackType).slice(0, 60) || fallbackType;
  const url = normalizeText(file.url || file.fotoFacturaUrl || file.media?.url).slice(0, 1200);
  const path = normalizeText(file.path || file.fotoFacturaPath || file.media?.path).slice(0, 600);
  if (!url && !path) return null;

  return {
    type,
    label: normalizeText(file.label).slice(0, 120) || getAiSupportLabel(type),
    url,
    path,
    source: normalizeText(file.source).slice(0, 80) || 'ai_fiscal_assistant',
    sourceCollection: normalizeText(file.sourceCollection).slice(0, 120) || '',
    sourceDocId: normalizeText(file.sourceDocId).slice(0, 160) || '',
    fileName: normalizeText(file.fileName || file.name || file.filename).slice(0, 220),
    contentType: normalizeText(file.contentType || file.mimeType || file.media?.mimeType).slice(0, 160),
    uploadedAt: file.uploadedAt || null,
  };
}

function sanitizeAiSupportFiles(value, support = null) {
  const files = [];

  if (Array.isArray(value)) {
    value.forEach((file) => {
      const normalized = sanitizeAiSupportFile(file);
      if (normalized) files.push(normalized);
    });
  }

  const single = sanitizeAiSupportFile(support || {});
  if (single) files.push(single);

  const seen = new Set();
  return files.filter((file) => {
    const key = file.path || file.url;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => {
    const order = { invoice: 0, retentionIr2: 1, retentionMunicipal1: 2 };
    return (order[left.type] ?? 99) - (order[right.type] ?? 99);
  }).slice(0, 3);
}

function isPdfAiSupport(file = {}) {
  const source = `${file.url || ''} ${file.path || ''} ${file.contentType || ''}`.toLowerCase();
  return source.includes('.pdf') || source.includes('application/pdf');
}

function inferMimeType(file = {}) {
  const contentType = normalizeComparableText(file.contentType);
  const source = `${file.fileName || ''} ${file.path || ''} ${file.url || ''}`.toLowerCase();

  if (contentType.includes('png') || source.includes('.png')) return 'image/png';
  if (contentType.includes('webp') || source.includes('.webp')) return 'image/webp';
  if (contentType.includes('pdf') || source.includes('.pdf')) return 'application/pdf';
  return 'image/jpeg';
}

async function buildOpenAiSupportContent(file = {}) {
  if (!file?.url && !file?.path) return null;

  if (isPdfAiSupport(file)) {
    if (!file.url) return null;
    return {
      type: 'input_file',
      file_url: file.url,
      filename: file.fileName || `${file.type}.pdf`,
    };
  }

  if (file.url) {
    return {
      type: 'input_image',
      image_url: file.url,
      detail: 'high',
    };
  }

  if (file.path) {
    try {
      const [buffer] = await admin.storage().bucket().file(file.path).download();
      if (buffer.length <= 12 * 1024 * 1024) {
        return {
          type: 'input_image',
          image_url: `data:${inferMimeType(file)};base64,${buffer.toString('base64')}`,
          detail: 'high',
        };
      }
      logger.warn('Soporte IA demasiado grande para enviarlo como data URL; usando URL publico', {
        path: file.path,
        size: buffer.length,
      });
    } catch (error) {
      logger.warn('No pude descargar soporte IA desde Storage; usando URL publico si existe', {
        path: file.path,
        error: error?.message,
      });
    }
  }

  return null;
}

async function appendSupportFilesToOpenAiContent(content, supportFiles = []) {
  for (const [index, file] of supportFiles.entries()) {
    content.push({
      type: 'input_text',
      text: `Soporte ${index + 1}: ${file.label || getAiSupportLabel(file.type)}. Tipo interno: ${file.type || 'invoice'}. Esta etiqueta es autoritativa: si dice retentionIr2 es retencion IR 2%, si dice retentionMunicipal1 es retencion municipal 1%. Lee esta imagen/PDF antes de responder.`,
    });
    const supportContent = await buildOpenAiSupportContent(file);
    if (supportContent) content.push(supportContent);
  }
}

function emptyFiscalAssistantDraft() {
  return {
    targetType: 'none',
    date: '',
    supplier: '',
    invoiceNumber: '',
    category: '',
    description: '',
    paymentMethod: '',
    paymentReference: '',
    subtotal: 0,
    iva: 0,
    total: 0,
    retentionIr2: 0,
    retentionMunicipal1: 0,
    payableProvider: '',
    payableInvoiceNumber: '',
    amountPaid: 0,
  };
}

function categoryKey(value) {
  return normalizeComparableText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickExpenseCategory(rawCategory, context = {}) {
  const categories = Array.isArray(context?.categories?.expenseCategories)
    ? context.categories.expenseCategories.filter(Boolean)
    : [];
  const fallbackCategory = normalizeText(context?.categories?.fallbackExpenseCategory)
    || 'Otros gastos (no categorizado)';
  const requestedKey = categoryKey(rawCategory);

  if (!categories.length) return normalizeText(rawCategory) || fallbackCategory;

  const exact = categories.find((category) => categoryKey(category) === requestedKey);
  if (exact) return exact;

  const loose = requestedKey.length > 4
    ? categories.find((category) => {
      const currentKey = categoryKey(category);
      return currentKey.includes(requestedKey) || requestedKey.includes(currentKey);
    })
    : null;
  if (loose) return loose;

  const keywordGroups = [
    {
      keys: ['rollo termico', 'rollos termicos', 'papel termico', 'equipo operacion', 'material operacion'],
      categoryWords: ['material', 'equipo', 'operacion'],
    },
    {
      keys: ['bolsa', 'bolsas', 'empaque', 'empaques', 'aditivo', 'aditivos'],
      categoryWords: ['insumo', 'operativo'],
    },
    {
      keys: ['limpieza', 'higiene', 'inocuidad'],
      categoryWords: ['limpieza', 'higiene', 'inocuidad'],
    },
    {
      keys: ['oficina', 'papeleria'],
      categoryWords: ['oficina'],
    },
    {
      keys: ['combustible', 'gasolina', 'diesel'],
      categoryWords: ['combustible'],
    },
    {
      keys: ['banco', 'bancario', 'comision'],
      categoryWords: ['bancario'],
    },
  ];

  const hint = keywordGroups.find((group) => group.keys.some((key) => requestedKey.includes(key)));
  if (hint) {
    const matched = categories.find((category) => {
      const currentKey = categoryKey(category);
      return hint.categoryWords.some((word) => currentKey.includes(word));
    });
    if (matched) return matched;
  }

  return categories.find((category) => categoryKey(category) === categoryKey(fallbackCategory))
    || fallbackCategory;
}

function normalizeFiscalAssistantResult(value = {}, fallback = {}, context = {}) {
  const allowedIntents = new Set(['answer_question', 'create_draft', 'analyze_support', 'request_more_info', 'system_status']);
  const allowedTargets = new Set(['none', 'gasto_credito', 'gasto_contado', 'compra_credito', 'compra_contado', 'abono_cxp', 'factura_membretada_venta']);
  const rawDraft = value?.suggestedDraft && typeof value.suggestedDraft === 'object' ? value.suggestedDraft : {};
  const draft = { ...emptyFiscalAssistantDraft(), ...rawDraft };
  const numberFields = ['subtotal', 'iva', 'total', 'retentionIr2', 'retentionMunicipal1', 'amountPaid'];

  numberFields.forEach((field) => {
    draft[field] = normalizeAmount(draft[field]);
  });

  draft.targetType = allowedTargets.has(draft.targetType) ? draft.targetType : 'none';
  if (draft.targetType.startsWith('gasto_')) {
    draft.category = pickExpenseCategory(draft.category || draft.description, context);
  }
  if (draft.targetType.startsWith('compra_') && !normalizeText(draft.category)) {
    draft.category = 'Compra';
  }

  return {
    reply: normalizeText(value?.reply || fallback.reply).slice(0, 2400)
      || 'Puedo ayudarte, pero necesito confirmar un dato antes de registrar.',
    intent: allowedIntents.has(value?.intent) ? value.intent : (fallback.intent || 'request_more_info'),
    confidence: Math.max(0, Math.min(1, Number(value?.confidence ?? fallback.confidence ?? 0.35) || 0.35)),
    warnings: Array.isArray(value?.warnings)
      ? value.warnings.map((item) => normalizeText(item).slice(0, 220)).filter(Boolean).slice(0, 6)
      : (fallback.warnings || []),
    suggestedDraft: draft,
    followUpQuestions: Array.isArray(value?.followUpQuestions)
      ? value.followUpQuestions.map((item) => normalizeText(item).slice(0, 220)).filter(Boolean).slice(0, 4)
      : (fallback.followUpQuestions || []),
    quickReplies: Array.isArray(value?.quickReplies)
      ? value.quickReplies.map((item) => normalizeText(item).slice(0, 80)).filter(Boolean).slice(0, 4)
      : (fallback.quickReplies || []),
  };
}

function getRetentionSupportFlags(supportFiles = []) {
  return {
    hasIr2: supportFiles.some((file) => normalizeComparableText(file.type) === 'retentionir2'),
    hasMunicipal1: supportFiles.some((file) => normalizeComparableText(file.type) === 'retentionmunicipal1'),
  };
}

function isRetentionOnlyPrompt(value = '') {
  const text = normalizeComparableText(value);
  return text.includes('retencion') || text.includes('retenciones');
}

function hasCompleteFiscalDraft(draft = {}) {
  const targetType = normalizeText(draft.targetType);
  const allowedTargets = new Set(['gasto_credito', 'gasto_contado', 'compra_credito', 'compra_contado']);
  return allowedTargets.has(targetType)
    && DATE_REGEX.test(normalizeDate(draft.date))
    && Boolean(cleanAiText(draft.supplier || draft.payableProvider))
    && Boolean(cleanAiText(draft.invoiceNumber || draft.payableInvoiceNumber))
    && normalizeAmount(draft.subtotal) > 0
    && normalizeAmount(draft.total) > 0;
}

function applyRetentionSupportRules(aiResult = {}, supportFiles = []) {
  const flags = getRetentionSupportFlags(supportFiles);
  if (!flags.hasIr2 && !flags.hasMunicipal1) return aiResult;

  const draft = { ...(aiResult.suggestedDraft || {}) };
  const subtotal = normalizeAmount(draft.subtotal);

  if (subtotal > 0 && flags.hasIr2 && normalizeAmount(draft.retentionIr2) <= 0) {
    draft.retentionIr2 = normalizeAmount(subtotal * 0.02);
  }

  if (subtotal > 0 && flags.hasMunicipal1 && normalizeAmount(draft.retentionMunicipal1) <= 0) {
    draft.retentionMunicipal1 = normalizeAmount(subtotal * 0.01);
  }

  const cleanedQuestions = (aiResult.followUpQuestions || [])
    .filter((question) => !isRetentionOnlyPrompt(question));
  const cleanedWarnings = (aiResult.warnings || [])
    .filter((warning) => !isRetentionOnlyPrompt(warning));
  const cleanedQuickReplies = (aiResult.quickReplies || [])
    .filter((reply) => !isRetentionOnlyPrompt(reply));

  const confidence = hasCompleteFiscalDraft(draft)
    ? Math.max(Number(aiResult.confidence || 0), 0.92)
    : Number(aiResult.confidence || 0);

  const supportText = [
    flags.hasIr2 ? 'retencion IR 2%' : '',
    flags.hasMunicipal1 ? 'retencion municipal 1%' : '',
  ].filter(Boolean).join(' y ');
  const reply = normalizeText(aiResult.reply).includes('Soportes de retencion vinculados')
    ? aiResult.reply
    : `${normalizeText(aiResult.reply)}\nSoportes de retencion vinculados: ${supportText}.`.trim();

  return {
    ...aiResult,
    reply,
    confidence,
    warnings: cleanedWarnings,
    suggestedDraft: draft,
    followUpQuestions: cleanedQuestions,
    quickReplies: cleanedQuickReplies,
  };
}

function extractJsonObjectFromText(value = '') {
  const raw = normalizeText(value)
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  if (!raw) return '';
  if (raw.startsWith('{') && raw.endsWith('}')) return raw;

  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return raw.slice(start, index + 1);
      }
    }
  }

  return '';
}

function collectOpenAiPayloadCandidates(payload = {}) {
  const candidates = [];

  if (payload.output_parsed) candidates.push(payload.output_parsed);
  if (payload.output_text) candidates.push(payload.output_text);

  (payload.output || []).forEach((item) => {
    (item.content || []).forEach((contentItem) => {
      if (contentItem.parsed) candidates.push(contentItem.parsed);
      if (contentItem.text) candidates.push(contentItem.text);
      if (contentItem.output_text) candidates.push(contentItem.output_text);
    });
  });

  return candidates;
}

function parseFiscalAssistantPayload(payload = {}, fallback = {}, context = {}) {
  const candidates = collectOpenAiPayloadCandidates(payload);

  for (const candidate of candidates) {
    if (!candidate) continue;

    if (typeof candidate === 'object') {
      return normalizeFiscalAssistantResult(candidate, fallback, context);
    }

    const text = normalizeText(candidate);
    const attempts = [text, extractJsonObjectFromText(text)].filter(Boolean);
    for (const attempt of attempts) {
      try {
        return normalizeFiscalAssistantResult(JSON.parse(attempt), fallback, context);
      } catch (error) {
        // Try the next candidate; if all fail, we fall back below.
      }
    }
  }

  logger.warn('Respuesta OpenAI no fue JSON recuperable; usando fallback seguro', {
    status: payload.status,
    incompleteDetails: payload.incomplete_details,
    error: payload.error,
    outputTypes: Array.isArray(payload.output) ? payload.output.map((item) => item.type || item.role || 'unknown').slice(0, 8) : [],
    contentTypes: Array.isArray(payload.output)
      ? payload.output.flatMap((item) => (item.content || []).map((contentItem) => contentItem.type || 'unknown')).slice(0, 12)
      : [],
    outputTextPreview: normalizeText(payload.output_text).slice(0, 600),
  });
  return normalizeFiscalAssistantResult({}, fallback, context);
}

function parseFiscalExtractionPayload(payload = {}) {
  const candidates = collectOpenAiPayloadCandidates(payload);

  for (const candidate of candidates) {
    if (!candidate) continue;

    if (typeof candidate === 'object') return candidate;

    const text = normalizeText(candidate);
    const attempts = [text, extractJsonObjectFromText(text)].filter(Boolean);
    for (const attempt of attempts) {
      try {
        return JSON.parse(attempt);
      } catch (error) {
        // Try the next candidate; if all fail, we fall back below.
      }
    }
  }

  logger.warn('Extraccion OpenAI no fue JSON recuperable', {
    status: payload.status,
    incompleteDetails: payload.incomplete_details,
    error: payload.error,
    outputTypes: Array.isArray(payload.output) ? payload.output.map((item) => item.type || item.role || 'unknown').slice(0, 8) : [],
    contentTypes: Array.isArray(payload.output)
      ? payload.output.flatMap((item) => (item.content || []).map((contentItem) => contentItem.type || 'unknown')).slice(0, 12)
      : [],
    outputTextPreview: normalizeText(payload.output_text).slice(0, 600),
  });
  return null;
}

function normalizeWorkerProfile(value = {}) {
  const role = normalizeComparableText(value.role) || 'administracion';
  const allowedRoles = new Set(['administracion', 'contabilidad', 'caja', 'bodega']);
  return {
    name: normalizeText(value.name).slice(0, 80),
    role: allowedRoles.has(role) ? role : 'administracion',
    roleLabel: normalizeText(value.roleLabel).slice(0, 80) || 'Administracion',
    tone: normalizeText(value.tone).slice(0, 220) || 'resumen ejecutivo, acciones claras y control fiscal',
  };
}

function buildDigitizerReplyFromDraft(aiResult = {}) {
  const draft = aiResult.suggestedDraft || {};
  const typeLabel = {
    gasto_credito: 'gasto a credito',
    gasto_contado: 'gasto de contado',
    compra_credito: 'compra a credito',
    compra_contado: 'compra de contado',
    abono_cxp: 'abono a cuenta por pagar',
    factura_membretada_venta: 'factura membretada de venta',
    none: 'soporte pendiente de clasificar',
  }[draft.targetType] || 'soporte fiscal';

  const summary = [
    draft.supplier ? `proveedor ${draft.supplier}` : '',
    draft.invoiceNumber ? `factura ${draft.invoiceNumber}` : '',
    draft.date ? `fecha ${draft.date}` : '',
    draft.total ? `total ${formatFiscalAmount(draft.total)}` : '',
  ].filter(Boolean).join(', ');

  const fiscal = [
    Number(draft.subtotal) > 0 ? `Subtotal ${formatFiscalAmount(draft.subtotal)}` : '',
    Number(draft.iva) > 0 ? `IVA ${formatFiscalAmount(draft.iva)}` : '',
    Number(draft.retentionIr2) > 0 ? `Ret. IR 2% ${formatFiscalAmount(draft.retentionIr2)}` : '',
    Number(draft.retentionMunicipal1) > 0 ? `Ret. municipal 1% ${formatFiscalAmount(draft.retentionMunicipal1)}` : '',
  ].filter(Boolean).join(' | ');

  const parts = [];
  parts.push(`Modo Digitador activo. Lei los soportes y prepare un borrador como ${typeLabel}.`);
  if (summary) parts.push(`Datos detectados: ${summary}.`);
  if (fiscal) parts.push(fiscal);
  if (draft.category) parts.push(`Categoria sugerida: ${draft.category}.`);
  if ((aiResult.followUpQuestions || []).length) {
    parts.push(`Antes de registrar necesito confirmar: ${(aiResult.followUpQuestions || []).slice(0, 2).join(' ')}`);
  } else {
    parts.push('Si todo esta correcto, podes confirmar el registro.');
  }

  return parts.join('\n');
}

async function callOpenAIFiscalExtractor({
  apiKey,
  message,
  supportFiles = [],
  context,
  classificationHint = 'auto',
  digitizerOptions = {},
  conversationHistory = [],
}) {
  const hint = normalizeClassificationHint(classificationHint);
  const safeDigitizerOptions = normalizeDigitizerOptions(digitizerOptions);
  const safeConversationHistory = sanitizeConversationHistory(conversationHistory);
  const safeSupportFiles = sanitizeAiSupportFiles(supportFiles);
  const retentionFlags = getRetentionSupportFlags(safeSupportFiles);
  const hasRetentionSupport = retentionFlags.hasIr2 || retentionFlags.hasMunicipal1;
  const content = [
    {
      type: 'input_text',
      text: [
        'Eres MARTIN IA en modo digitador fiscal. Tarea unica: leer soportes/fotos/PDF y devolver JSON estructurado corto.',
        'No escribas explicaciones largas. No inventes datos. Si un campo no se lee, dejalo vacio o 0 y pregunta solo lo indispensable.',
        'Lee todos los soportes: factura principal, retencion anticipo IR 2%, retencion municipal 1%. Cada imagen viene precedida por su etiqueta.',
        'Relaciona retenciones con la factura principal usando numero de factura, proveedor, RUC, fecha y monto base. Si fueron subidas en el mismo turno, tratalas como documentos vinculados salvo que claramente pertenezcan a otro proveedor/factura.',
        'Si hay soporte etiquetado como retentionIr2, extrae retentionIr2 aunque el documento use frases como anticipo IR, retencion definitiva, impuesto sobre la renta o 2%.',
        'Si hay soporte etiquetado como retentionMunicipal1, extrae retentionMunicipal1 aunque el documento use frases como alcaldia, municipal, IMI, impuesto municipal o 1%.',
        'Si el soporte de retencion muestra numero de factura o proveedor, comparalo con la factura principal y menciona mismatch solo si contradice claramente.',
        'Si hay factura y retenciones adjuntas, NO preguntes si lleva retenciones. Ya lleva retenciones porque los soportes fueron adjuntados.',
        'Si el monto de una retencion no es legible pero el soporte existe y el subtotal/base de la factura es visible, calcula IR como subtotal*0.02 y municipal como subtotal*0.01 segun el tipo de soporte.',
        'Si ves NO SUJETOS A RETENCIONES y no hay soportes de retencion, usa retenciones 0.',
        'Compra = productos vendibles o costo directo de inventario: camaron, langosta, carne, pollo, pescado, mariscos, mercaderia.',
        'Gasto = insumos no revendibles/operativos: rollos termicos, papel termico, bolsas, limpieza, oficina, mantenimiento, servicios.',
        'Si es gasto, category debe ser exactamente una de context.categories.expenseCategories. Si no hay coincidencia, usa context.categories.fallbackExpenseCategory.',
        'Si es compra, usa category "Compra" salvo que el contexto indique algo mejor.',
        'Si condicion dice contado, 1 dia contado o similar, usa *_contado y paymentMethod "Contado". Si dice credito, usa *_credito.',
        `Pista usuario: ${hint}.`,
        `Auto-registro seguro: ${safeDigitizerOptions.autoRegister ? 'si' : 'no'}.`,
        `Hay soportes de retencion adjuntos: ${hasRetentionSupport ? 'si' : 'no'}.`,
        `Historial reciente JSON: ${JSON.stringify(safeConversationHistory)}`,
        `Mensaje usuario: ${message}`,
        `Contexto categorias/aprendizaje JSON: ${JSON.stringify({
          learning: context.learning,
          categories: context.categories,
        })}`,
      ].join('\n'),
    },
  ];

  await appendSupportFilesToOpenAiContent(content, safeSupportFiles);

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_FISCAL_MODEL.value(),
      input: [
        {
          role: 'user',
          content,
        },
      ],
      text: {
        format: fiscalExtractionSchema(),
      },
      reasoning: {
        effort: 'minimal',
      },
      max_output_tokens: 2200,
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    logger.error('OpenAI fiscal extractor error', {
      status: response.status,
      payload,
    });
    return null;
  }

  const extracted = parseFiscalExtractionPayload(payload);
  if (!extracted) return null;

  let normalized = normalizeFiscalAssistantResult({
    reply: buildDigitizerReplyFromDraft(extracted),
    intent: (extracted.followUpQuestions || []).length
      ? 'request_more_info'
      : (extracted.suggestedDraft?.targetType === 'none' ? 'analyze_support' : 'create_draft'),
    confidence: extracted.confidence,
    warnings: extracted.warnings,
    suggestedDraft: extracted.suggestedDraft,
    followUpQuestions: extracted.followUpQuestions,
    quickReplies: extracted.quickReplies,
  }, {}, context);

  normalized = applyRetentionSupportRules(normalized, safeSupportFiles);
  normalized.reply = buildDigitizerReplyFromDraft(normalized);
  if (retentionFlags.hasIr2 || retentionFlags.hasMunicipal1) {
    normalized.reply = `${normalized.reply}\nSoportes de retencion vinculados: ${[
      retentionFlags.hasIr2 ? 'IR 2%' : '',
      retentionFlags.hasMunicipal1 ? 'municipal 1%' : '',
    ].filter(Boolean).join(' y ')}.`;
  }
  return normalized;
}

async function callOpenAIFiscalAssistant({
  message,
  support,
  supportFiles = [],
  context,
  classificationHint = 'auto',
  digitizerOptions = {},
  conversationHistory = [],
  workerProfile = {},
}) {
  const apiKey = OPENAI_API_KEY.value();
  if (!apiKey) {
    throw new HttpsError('failed-precondition', 'Falta configurar OPENAI_API_KEY en Firebase Functions.');
  }

  const hint = normalizeClassificationHint(classificationHint);
  const safeDigitizerOptions = normalizeDigitizerOptions(digitizerOptions);
  const safeConversationHistory = sanitizeConversationHistory(conversationHistory);
  const safeWorkerProfile = normalizeWorkerProfile(workerProfile);
  const safeSupportFiles = sanitizeAiSupportFiles(supportFiles, support);
  const hasSupport = safeSupportFiles.length > 0;
  const retentionFlags = getRetentionSupportFlags(safeSupportFiles);
  const hasRetentionSupport = retentionFlags.hasIr2 || retentionFlags.hasMunicipal1;
  const safeFallbackResult = {
    reply: hasSupport
      ? `${safeDigitizerOptions.mode === 'digitizer' ? 'Modo Digitador activo. ' : ''}Ya guarde el soporte en la bandeja de MARTIN IA, pero necesito confirmar un dato fiscal antes de armar el borrador. ¿Esta factura lleva retencion de anticipo IR 2%, retencion municipal 1%, ambas o ninguna?`
      : 'Te escucho. Decime que necesitas revisar o adjunta una factura para analizarla.',
    intent: hasSupport ? 'request_more_info' : 'answer_question',
    confidence: 0.35,
    warnings: hasSupport ? ['No pude estructurar la respuesta automaticamente, pero el soporte quedo conservado para continuar.'] : [],
    followUpQuestions: hasSupport
      ? ['¿Esta factura lleva retencion de anticipo IR 2%, retencion municipal 1%, ambas o ninguna?']
      : [],
    quickReplies: hasSupport
      ? ['No tiene retenciones', 'Solo IR 2%', 'Solo municipal 1%', 'Ambas retenciones']
      : ['Revisar ventas', 'Revisar CxP', 'Subir factura'],
  };

  if (hasRetentionSupport) {
    safeFallbackResult.reply = `${safeDigitizerOptions.mode === 'digitizer' ? 'Modo Digitador activo. ' : ''}Ya guarde la factura y los soportes de retencion en la bandeja de MARTIN IA. No voy a preguntarte si lleva retencion porque ya adjuntaste el soporte; necesito reintentar lectura o confirmar manualmente los datos que no se lean.`;
    safeFallbackResult.followUpQuestions = ['No pude leer todos los campos; confirma proveedor, factura o montos si no aparecen en el borrador.'];
    safeFallbackResult.quickReplies = ['Reintentar lectura', 'Confirmo datos', 'Registrar manual'];
  }

  if (hasSupport && safeDigitizerOptions.mode === 'digitizer') {
    const extractedResult = await callOpenAIFiscalExtractor({
      apiKey,
      message,
      supportFiles: safeSupportFiles,
      context,
      classificationHint: hint,
      digitizerOptions: safeDigitizerOptions,
      conversationHistory: safeConversationHistory,
    });

    if (extractedResult) return extractedResult;
  }

  const content = [
    {
      type: 'input_text',
      text: [
        'Eres el Agente IA Fiscal de Carnes San Martin Granada.',
        'Tu nombre es MARTIN IA. Actua como un companero contable de confianza, paciente, conversacional y practico.',
        safeDigitizerOptions.mode === 'digitizer'
          ? 'MODO DIGITADOR ACTIVO: tu prioridad es leer facturas y soportes como digitador experto, extraer campos contables, aprender patrones y dejar un borrador listo.'
          : 'MODO CHAT ACTIVO: ayuda con consultas, explicaciones y borradores cuando el usuario lo pida.',
        safeDigitizerOptions.mode === 'digitizer'
          ? 'En Modo Digitador debes revisar: fecha, proveedor, numero de factura, subtotal, IVA, total, retenciones, tipo gasto/compra, credito/contado, metodo de pago, categoria y descripcion.'
          : '',
        safeDigitizerOptions.mode === 'digitizer'
          ? 'Reglas OCR para facturas nicaraguenses: lee FACTURA como invoiceNumber; convierte fechas tipo 23-May-2026, 23/MAY/2026 o 23-mayo-2026 a formato ISO YYYY-MM-DD; interpreta montos como 12,819.38, 1,922.91 y 14,742.29 sin perder decimales.'
          : '',
        safeDigitizerOptions.mode === 'digitizer'
          ? 'Si ves la leyenda "NO SUJETOS A RETENCIONES", "NO SUJETO A RETENCION" o similar, eso confirma que no lleva retenciones: usa retentionIr2=0, retentionMunicipal1=0, no preguntes por retenciones y no lo marques como alerta.'
          : '',
        safeDigitizerOptions.mode === 'digitizer'
          ? 'Si la factura trae productos vendibles, inventario o costo directo de venta como camaron, langosta, carne, pollo, cerdo, pescado, mariscos, alimentos para vender o mercaderia, clasificala como compra_contado o compra_credito, no como gasto.'
          : '',
        safeDigitizerOptions.mode === 'digitizer'
          ? 'Si la factura trae insumos de operacion no revendibles como rollos termicos, papel termico, bolsas, empaques, etiquetas, limpieza, oficina, mantenimiento o servicios, clasificala como gasto_contado o gasto_credito y elige una categoria existente del contexto.'
          : '',
        safeDigitizerOptions.mode === 'digitizer'
          ? 'Si la factura dice CONDICION: contado, 1 dia contado o similar, usa compra_contado/gasto_contado y paymentMethod="Contado" salvo que el usuario indique transferencia, POS o efectivo.'
          : '',
        safeDigitizerOptions.mode === 'digitizer'
          ? 'En Modo Digitador pregunta solo lo que bloquea el registro. Si algo puede inferirse por learning.supplierProfiles con alta confianza, usalo y menciona que lo aprendiste.'
          : '',
        safeDigitizerOptions.autoRegister
          ? 'El usuario activo Auto-registro seguro. Aun asi, solo propone borrador confirmable si estas muy seguro y no hay preguntas pendientes.'
          : '',
        'Responde en espanol claro, natural y cercano. No suenes como formulario ni como robot.',
        'Relacionate bien con trabajadores: explica sin reganar, guia paso a paso y confirma antes de asumir.',
        'Si habla caja o bodega, usa instrucciones cortas. Si habla contabilidad, da detalle fiscal. Si habla administracion, resume con acciones.',
        'Haz maximo dos preguntas de seguimiento por turno. Si falta informacion critica, pregunta una cosa primero y ofrece botones cortos en quickReplies.',
        'Cuando adjunten facturas, primero reconoce lo que ves, luego di que falta, luego propone el siguiente paso.',
        'Regla obligatoria para facturas con soporte: antes de preparar un borrador confirmable, valida retenciones.',
        'Si hay soporte adjunto y no hay comprobante de retencion ni confirmacion del usuario en el mensaje/historial, la primera pregunta debe ser: "Esta factura lleva retencion de anticipo IR 2%, retencion municipal 1%, ambas o ninguna?".',
        'Para esa pregunta usa exactamente quickReplies: ["No tiene retenciones", "Solo IR 2%", "Solo municipal 1%", "Ambas retenciones"].',
        'Aunque falte confirmar retenciones, primero debes leer la factura y llenar suggestedDraft con fecha, proveedor, factura, subtotal, IVA, total, tipo compra/gasto, metodo y categoria si son visibles o inferibles.',
        'No pongas suggestedDraft.targetType="none" solo porque faltan retenciones. Usa targetType none solo si no puedes leer el soporte o no puedes distinguir compra/gasto despues de aplicar reglas e historial.',
        'Si faltan retenciones, bloquea solo el registro automatico usando followUpQuestions y warnings, pero deja el borrador preparado para que el usuario responda rapido.',
        'Si hay soportes de retencion adjuntos, leelos y extrae numero, fecha, proveedor, base y monto retenido cuando sea visible.',
        'Si las retenciones fueron adjuntadas en el mismo turno, relacionalas con la factura principal por numero de factura/proveedor/RUC/fecha. No vuelvas a preguntar si lleva retencion; extrae o calcula el monto segun el soporte adjunto.',
        'Si hay soporte IR 2% y el monto no se lee pero el subtotal/base si, calcula retentionIr2=subtotal*0.02. Si hay soporte municipal 1% y el monto no se lee pero el subtotal/base si, calcula retentionMunicipal1=subtotal*0.01.',
        'Si hay una retencion adjunta pero no puedes leerla bien y tampoco puedes calcularla por subtotal/base, pregunta por el monto o pide otra foto antes de confirmar.',
        'Si el usuario responde "No tiene retenciones", continua con retentionIr2=0 y retentionMunicipal1=0.',
        'Si responde "Solo IR 2%", calcula retentionIr2 sobre subtotal cuando sea posible y deja retentionMunicipal1=0.',
        'Si responde "Solo municipal 1%", calcula retentionMunicipal1 sobre subtotal cuando sea posible y deja retentionIr2=0.',
        'Si responde "Ambas retenciones", calcula ambas sobre subtotal cuando sea posible.',
        'Si el trabajador responde a una pregunta anterior, usa conversationHistory para continuar, no empieces desde cero.',
        'Puedes contestar preguntas usando el contexto contable resumido.',
        'Si hay soporte/foto, extrae datos para crear un borrador fiscal, pero nunca confirmes registro definitivo.',
        'Aprende patrones del contexto learning.supplierProfiles: proveedor habitual, tipo usual, categoria usual y forma de pago usual.',
        'Si el proveedor ya existe en learning.supplierProfiles, usa ese historial como pista fuerte para distinguir gasto vs compra, salvo que la factura contradiga claramente.',
        'Clasificacion: compra = inventario, materia prima vendible, mercaderia, carne, camaron, langosta, pollo, pescado, mariscos o costo directo de venta.',
        'Clasificacion: gasto operativo = servicios, mantenimiento, oficina, limpieza, viaticos, banco, seguros, nomina, rollos termicos, papel termico, bolsas, empaques, etiquetas u otros gastos administrativos/operativos no revendibles.',
        'Ejemplo obligatorio: camaron o langosta son productos vendibles, por tanto son compra, no gasto.',
        'Ejemplo obligatorio: rollos termicos o papel termico son insumos de operacion, por tanto son gasto. Usa la categoria existente mas cercana, por ejemplo "Gastos por materiales y equipos de operaciones" o "Gastos por insumos operativos (bolsas,aditivos...)" si existe.',
        'Para gastos, suggestedDraft.category debe ser EXACTAMENTE una categoria de context.categories.expenseCategories. No inventes categorias. Si no hay coincidencia clara, usa context.categories.fallbackExpenseCategory.',
        'Para compras, suggestedDraft.category puede ser "Compra" o una categoria de inventario/costo directa si el contexto la trae, pero targetType debe iniciar con compra_.',
        `Pista directa del usuario para esta factura: ${hint}.`,
        'Si la pista directa es gasto, prioriza targetType gasto_credito o gasto_contado. Si es compra, prioriza compra_credito o compra_contado.',
        'Si la pista es auto y no puedes distinguir gasto vs compra con confianza, no inventes: usa request_more_info y pregunta "Esta factura la registro como gasto o como compra?".',
        'Para estado de resultado, ventas contables usan subtotal, no total con IVA.',
        'Si no puedes leer fecha, proveedor, factura o montos con confianza, no inventes: usa request_more_info y pregunta exactamente que falta.',
        'Si tienes dudas fuertes, suggestedDraft.targetType debe ser none o la mejor opcion con warnings claros.',
        'quickReplies debe traer 2 a 4 respuestas cortas y utiles cuando convenga, por ejemplo: "Es gasto", "Es compra", "Es credito", "Es contado". Si no aplica, usa [].',
        `Hay soporte adjunto: ${hasSupport ? 'si' : 'no'}.`,
        `Hay comprobante de retencion adjunto: ${hasRetentionSupport ? 'si' : 'no'}.`,
        `Opciones digitador JSON: ${JSON.stringify(safeDigitizerOptions)}.`,
        `Soportes adjuntos JSON: ${JSON.stringify(safeSupportFiles.map((file) => ({
          type: file.type,
          label: file.label,
          fileName: file.fileName,
          contentType: file.contentType,
          url: file.url,
        })))}`,
        `Perfil de quien conversa JSON: ${JSON.stringify(safeWorkerProfile)}`,
        `Historial reciente JSON: ${JSON.stringify(safeConversationHistory)}`,
        `Pregunta o instruccion del usuario: ${message}`,
        `Contexto contable JSON: ${JSON.stringify(context)}`,
      ].join('\n'),
    },
  ];

  await appendSupportFilesToOpenAiContent(content, safeSupportFiles);

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_FISCAL_MODEL.value(),
      input: [
        {
          role: 'user',
          content,
        },
      ],
      text: {
        format: fiscalDraftSchema(),
      },
      reasoning: {
        effort: 'minimal',
      },
      max_output_tokens: 5000,
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    logger.error('OpenAI fiscal assistant error', {
      status: response.status,
      payload,
    });
    throw new HttpsError('internal', payload?.error?.message || 'OpenAI no pudo procesar la solicitud.');
  }

  return applyRetentionSupportRules(
    parseFiscalAssistantPayload(payload, safeFallbackResult, context),
    safeSupportFiles,
  );
}

exports.fiscalAssistantChat = onCall(FISCAL_ASSISTANT_FUNCTION_OPTIONS, async (request) => {
  const actorEmail = ensureAdminUser(request.auth, 'usar el agente IA fiscal');
  const message = normalizeText(request.data?.message);
  const support = request.data?.support || null;
  const supportFiles = sanitizeAiSupportFiles(request.data?.supportFiles, support);
  const classificationHint = normalizeClassificationHint(request.data?.classificationHint);
  const digitizerOptions = normalizeDigitizerOptions(request.data?.digitizerOptions || {});
  const conversationHistory = sanitizeConversationHistory(request.data?.conversationHistory);
  const workerProfile = normalizeWorkerProfile(request.data?.workerProfile || {});

  if (!message && supportFiles.length === 0) {
    throw new HttpsError('invalid-argument', 'Escribe una pregunta o adjunta una foto/documento.');
  }

  const context = await buildFiscalAssistantContext();
  const aiResult = await callOpenAIFiscalAssistant({
    message,
    support,
    supportFiles,
    context,
    classificationHint,
    digitizerOptions,
    conversationHistory,
    workerProfile,
  });

  const chatRef = await firestore.collection('ai_fiscal_chats').add({
    actorEmail,
    message,
    classificationHint,
    digitizerOptions,
    workerProfile,
    conversationHistory,
    support: support || null,
    supportFiles,
    result: aiResult,
    contextSnapshot: context,
    createdAt: FieldValue.serverTimestamp(),
  });

  let draftId = '';
  let autoRegistration = {
    attempted: false,
    confirmed: false,
    blockers: [],
  };

  if (supportFiles.length > 0 || aiResult?.suggestedDraft?.targetType !== 'none') {
    const primarySupport = supportFiles[0] || support || null;
    const inboxRef = firestore.collection('ai_fiscal_inbox').doc();
    draftId = inboxRef.id;
    const inboxPayload = {
      actorEmail,
      source: primarySupport?.source || 'app_chat',
      status: 'draft',
      aiStatus: 'review_required',
      userMessage: message,
      classificationHint,
      digitizerOptions,
      workerProfile,
      support: primarySupport,
      supportFiles,
      fotoFacturaUrl: primarySupport?.url || '',
      fotoFacturaPath: primarySupport?.path || '',
      aiResult,
      suggestedDraft: aiResult?.suggestedDraft || null,
      confidence: aiResult?.confidence || 0,
      chatId: chatRef.id,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await inboxRef.set(inboxPayload);

    if (digitizerOptions.mode === 'digitizer' && digitizerOptions.autoRegister) {
      const blockers = getDigitizerAutoRegisterBlockers({
        aiResult,
        digitizerOptions,
        supportFiles,
        message,
        conversationHistory,
        context,
      });

      autoRegistration = {
        attempted: true,
        confirmed: false,
        blockers,
      };

      if (blockers.length === 0) {
        try {
          const confirmation = await confirmFiscalAssistantDraftInternal({
            actorEmail,
            draftId,
            overrides: {},
          });
          autoRegistration = {
            attempted: true,
            confirmed: true,
            blockers: [],
            targetCollection: confirmation.targetCollection || '',
            targetDocIds: confirmation.targetDocIds || {},
          };
          await inboxRef.set({
            digitizerAutoRegistered: true,
            digitizerAutoRegisteredAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        } catch (error) {
          logger.warn('Auto-registro digitador no pudo confirmarse', {
            draftId,
            message: error.message,
          });
          autoRegistration = {
            attempted: true,
            confirmed: false,
            blockers: [error.message || 'No se pudo confirmar automaticamente'],
          };
          await inboxRef.set({
            digitizerAutoRegisterError: error.message || 'No se pudo confirmar automaticamente',
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
      }
    }
  }

  return {
    ok: true,
    chatId: chatRef.id,
    draftId,
    autoRegistration,
    result: aiResult,
  };
});

function cleanAiText(value) {
  return normalizeText(value).slice(0, 260);
}

function getAiDraftDate(draft) {
  const value = normalizeDate(draft?.date);
  return DATE_REGEX.test(value) ? value : new Date().toISOString().substring(0, 10);
}

function buildAiFiscalNumbers(draft = {}) {
  const subtotal = normalizeAmount(draft.subtotal || Math.max(normalizeAmount(draft.total) - normalizeAmount(draft.iva), 0));
  const iva = normalizeAmount(draft.iva);
  const total = normalizeAmount(draft.total || subtotal + iva || draft.amountPaid);
  const retentionIr2 = normalizeAmount(draft.retentionIr2);
  const retentionMunicipal1 = normalizeAmount(draft.retentionMunicipal1);

  return {
    amount: subtotal,
    subtotal,
    iva,
    total,
    retentionIr2,
    retentionMunicipal1,
    retentionTotal: normalizeAmount(retentionIr2 + retentionMunicipal1),
  };
}

function buildAiSupportPayload(inbox = {}) {
  const files = sanitizeAiSupportFiles(inbox.supportFiles, {
    ...(inbox.support || {}),
    url: inbox.support?.url || inbox.fotoFacturaUrl,
    path: inbox.support?.path || inbox.fotoFacturaPath,
  }).map((file) => ({
    ...file,
    source: file.source || inbox.source || 'ai_fiscal_assistant',
    sourceCollection: file.sourceCollection || 'ai_fiscal_inbox',
    sourceDocId: file.sourceDocId || inbox.id || '',
  }));

  const support = files.find((file) => file.type === 'invoice') || files[0] || {};
  const url = normalizeText(support.url);
  const path = normalizeText(support.path);

  if (!url && !path) return {};

  return {
    fotoFacturaUrl: url,
    fotoFacturaPath: path,
    support,
    supportFiles: files,
  };
}

function buildAiCommonPayload({ inbox, draftId, actorEmail }) {
  return {
    source: 'ai_fiscal_assistant',
    sourceType: 'ai_reviewed_draft',
    sourceDraftId: draftId,
    sourceChatId: inbox.chatId || '',
    confirmedBy: actorEmail,
    confirmedAt: FieldValue.serverTimestamp(),
  };
}

function findSupplierProfileForDraft(context = {}, draft = {}) {
  const supplierKey = normalizeComparableText(draft.supplier || draft.payableProvider);
  if (!supplierKey) return null;

  return (context.learning?.supplierProfiles || []).find((profile) => {
    const profileKey = normalizeComparableText(profile.supplier);
    return profileKey && (profileKey === supplierKey || profileKey.includes(supplierKey) || supplierKey.includes(profileKey));
  }) || null;
}

function getRetentionIntentText(message = '', conversationHistory = []) {
  return normalizeComparableText([
    message,
    ...conversationHistory.map((entry) => entry?.text || ''),
    ...conversationHistory.flatMap((entry) => entry?.quickReplies || []),
  ].join(' '));
}

function getDigitizerAutoRegisterBlockers({
  aiResult = {},
  digitizerOptions = {},
  supportFiles = [],
  message = '',
  conversationHistory = [],
  context = {},
}) {
  const options = normalizeDigitizerOptions(digitizerOptions);
  const draft = aiResult.suggestedDraft || {};
  const blockers = [];
  const targetType = normalizeText(draft.targetType);
  const allowedTargets = new Set(['gasto_credito', 'gasto_contado', 'compra_credito', 'compra_contado']);
  const fiscal = buildAiFiscalNumbers(draft);
  const confidence = Number(aiResult.confidence || 0);
  const date = normalizeDate(draft.date);
  const supplier = cleanAiText(draft.supplier || draft.payableProvider);
  const invoiceNumber = cleanAiText(draft.invoiceNumber || draft.payableInvoiceNumber);
  const retentionText = getRetentionIntentText([
    message,
    aiResult.reply || '',
    ...(aiResult.followUpQuestions || []),
    ...(aiResult.quickReplies || []),
  ].join(' '), conversationHistory);
  const hasRetentionSupport = supportFiles.some((file) => ['retentionIr2', 'retentionMunicipal1'].includes(file.type));
  const profile = findSupplierProfileForDraft(context, draft);
  const learnedNoRetention = profile?.usualRetentionMode === 'none'
    && normalizeAmount(profile.retentionConfidence) >= 0.85
    && normalizeAmount(profile.evidenceCount) >= 3;
  const compactRetentionText = retentionText.replace(/\s+/g, '');
  const userConfirmedNoRetention = compactRetentionText.includes('notieneretenciones')
    || compactRetentionText.includes('sinretencion')
    || compactRetentionText.includes('nosujetosaretenciones')
    || compactRetentionText.includes('nosujetoaretencion')
    || retentionText.includes('ninguna');
  const userConfirmedRetention = compactRetentionText.includes('soloir2')
    || compactRetentionText.includes('solomunicipal')
    || compactRetentionText.includes('ambasretenciones')
    || retentionText.includes('retencion');

  if (options.mode !== 'digitizer') blockers.push('Modo Digitador no esta activo');
  if (!options.autoRegister) blockers.push('Auto-registro seguro esta apagado');
  if (!supportFiles.length) blockers.push('No hay foto/PDF de soporte');
  if (!allowedTargets.has(targetType)) blockers.push('La IA no propuso gasto o compra confirmable');
  if (confidence < 0.9) blockers.push('Confianza menor a 90%');
  if ((aiResult.warnings || []).length) blockers.push('Hay alertas pendientes');
  if ((aiResult.followUpQuestions || []).length) blockers.push('Hay preguntas pendientes');
  if (!DATE_REGEX.test(date)) blockers.push('Falta fecha valida');
  if (!supplier) blockers.push('Falta proveedor');
  if (!invoiceNumber) blockers.push('Falta numero de factura');
  if (fiscal.total <= 0 || fiscal.subtotal <= 0) blockers.push('Faltan montos validos');
  if (!cleanAiText(draft.paymentMethod) && !targetType.includes('credito')) blockers.push('Falta metodo de pago');

  if (fiscal.retentionTotal <= 0 && !userConfirmedNoRetention && !learnedNoRetention && !hasRetentionSupport) {
    blockers.push('Retenciones no confirmadas ni aprendidas');
  }

  if (fiscal.retentionTotal > 0 && !hasRetentionSupport && !userConfirmedRetention) {
    blockers.push('La retencion tiene monto, pero falta soporte o confirmacion');
  }

  return blockers;
}

async function rememberAiFiscalLearning({ draft, kind, credit, targetCollection, targetDocIds, actorEmail }) {
  const supplier = cleanAiText(draft.supplier || draft.payableProvider || '').toUpperCase();
  const supplierKey = normalizeComparableText(supplier);
  if (!supplierKey) return;

  await firestore.collection('ai_fiscal_learning').doc(supplierKey).set({
    supplier,
    supplierKey,
    kind,
    credit,
    targetCollection,
    category: cleanAiText(draft.category || ''),
    paymentMethod: cleanAiText(draft.paymentMethod || (credit ? 'credito' : '')),
    retentionIr2: normalizeAmount(draft.retentionIr2),
    retentionMunicipal1: normalizeAmount(draft.retentionMunicipal1),
    lastInvoiceNumber: cleanAiText(draft.invoiceNumber || draft.payableInvoiceNumber || ''),
    lastDescription: cleanAiText(draft.description || ''),
    lastTargetDocIds: targetDocIds || {},
    evidenceCount: FieldValue.increment(1),
    updatedBy: actorEmail,
    updatedAt: FieldValue.serverTimestamp(),
    lastSeenAt: new Date().toISOString().substring(0, 10),
  }, { merge: true });
}

async function findDailySaleByDate(date) {
  const snapshot = await firestore.collection('ingresos').where('date', '==', date).limit(1).get();
  if (!snapshot.empty) {
    const docSnap = snapshot.docs[0];
    return { id: docSnap.id, ...docSnap.data() };
  }

  return null;
}

async function findPayableForAiAbono(draft) {
  const providerNeedle = normalizeComparableText(draft.payableProvider || draft.supplier);
  const invoiceNeedle = normalizeComparableText(draft.payableInvoiceNumber || draft.invoiceNumber);
  const snapshot = await firestore.collection('cuentas_por_pagar').where('estado', 'in', ['pendiente', 'parcial']).limit(350).get();
  const candidates = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));

  return candidates.find((item) => {
    const provider = normalizeComparableText(item.proveedor || item.supplier);
    const invoice = normalizeComparableText(item.numero || item.factura || item.invoiceNumber);
    const providerMatches = providerNeedle ? provider.includes(providerNeedle) || providerNeedle.includes(provider) : true;
    const invoiceMatches = invoiceNeedle ? invoice === invoiceNeedle || invoice.includes(invoiceNeedle) || invoiceNeedle.includes(invoice) : true;
    return providerMatches && invoiceMatches;
  }) || null;
}

async function getNextAbonoSequence() {
  const snapshot = await firestore.collection('abonos_pagar').orderBy('secuencia', 'desc').limit(1).get();
  return snapshot.empty ? 1 : normalizeAmount(snapshot.docs[0].data().secuencia) + 1;
}

async function confirmAiPurchaseOrExpense({ inboxRef, inbox, draftId, draft, actorEmail, kind, credit }) {
  const date = getAiDraftDate(draft);
  const month = date.substring(0, 7);
  const fiscal = buildAiFiscalNumbers(draft);
  if (fiscal.total <= 0) {
    throw new HttpsError('failed-precondition', 'El borrador no tiene un total valido.');
  }

  const isPurchase = kind === 'compra';
  const targetCollection = isPurchase ? 'compras' : 'gastos';
  const targetRef = firestore.collection(targetCollection).doc();
  const payableRef = credit ? firestore.collection('cuentas_por_pagar').doc() : null;
  const supportPayload = buildAiSupportPayload({ ...inbox, id: draftId });
  const commonPayload = buildAiCommonPayload({ inbox, draftId, actorEmail });
  const supplier = cleanAiText(draft.supplier || draft.payableProvider || 'SIN PROVEEDOR').toUpperCase();
  const invoiceNumber = cleanAiText(draft.invoiceNumber || draft.payableInvoiceNumber);
  const description = cleanAiText(draft.description || draft.category || 'REGISTRO IA FISCAL').toUpperCase();
  const paymentType = credit ? 'credito' : cleanAiText(draft.paymentMethod || 'Transferencia');
  const batch = firestore.batch();

  const targetPayload = isPurchase ? {
    date,
    month,
    supplier,
    invoiceNumber,
    description,
    paymentType,
    paymentReference: cleanAiText(draft.paymentReference).toUpperCase(),
    branch: getBranchId(),
    branchName: getBranchName(),
    isInventoryCost: true,
    linkedPayableId: payableRef?.id || null,
    sourceFacturaId: payableRef?.id || null,
    ...fiscal,
    ...supportPayload,
    ...commonPayload,
    timestamp: FieldValue.serverTimestamp(),
  } : {
    date,
    month,
    supplier,
    proveedor: supplier,
    invoiceNumber,
    factura: invoiceNumber,
    category: cleanAiText(draft.category || 'Otros gastos (no categorizado)'),
    categoria: cleanAiText(draft.category || 'Otros gastos (no categorizado)'),
    description,
    paymentType,
    paymentReference: cleanAiText(draft.paymentReference).toUpperCase(),
    branch: getBranchId(),
    branchName: getBranchName(),
    linkedPayableId: payableRef?.id || null,
    ...fiscal,
    ...supportPayload,
    ...commonPayload,
    timestamp: FieldValue.serverTimestamp(),
  };

  batch.set(targetRef, targetPayload);

  if (payableRef) {
    batch.set(payableRef, {
      fecha: date,
      month,
      proveedor: supplier,
      sucursal: getBranchName(),
      branch: getBranchId(),
      branchName: getBranchName(),
      numero: invoiceNumber,
      factura: invoiceNumber,
      vencimiento: '',
      descripcion: description,
      monto: fiscal.total,
      saldo: fiscal.total,
      amount: fiscal.subtotal,
      estado: 'pendiente',
      paymentType: 'credito',
      paymentReference: cleanAiText(draft.paymentReference).toUpperCase(),
      isInventoryCost: isPurchase,
      mirroredToCompras: isPurchase,
      mirroredPurchaseId: isPurchase ? targetRef.id : null,
      mirroredExpenseId: isPurchase ? null : targetRef.id,
      ...fiscal,
      ...supportPayload,
      ...commonPayload,
      timestamp: FieldValue.serverTimestamp(),
    });
  }

  batch.set(inboxRef, {
    status: 'confirmed',
    targetCollection,
    targetDocIds: {
      [isPurchase ? 'compraId' : 'gastoId']: targetRef.id,
      cuentaPorPagarId: payableRef?.id || null,
    },
    confirmedBy: actorEmail,
    confirmedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await batch.commit();

  const targetDocIds = {
    [isPurchase ? 'compraId' : 'gastoId']: targetRef.id,
    cuentaPorPagarId: payableRef?.id || null,
  };

  await rememberAiFiscalLearning({
    draft,
    kind,
    credit,
    targetCollection,
    targetDocIds,
    actorEmail,
  });

  return {
    targetCollection,
    targetDocIds,
  };
}

async function confirmAiStampedInvoice({ inboxRef, inbox, draftId, draft, actorEmail }) {
  const saleDate = getAiDraftDate(draft);
  const selectedSale = await findDailySaleByDate(saleDate);
  if (!selectedSale) {
    throw new HttpsError('failed-precondition', `Primero debe existir la venta diaria SICAR del ${saleDate}.`);
  }

  const fiscal = buildAiFiscalNumbers(draft);
  if (fiscal.total <= 0) {
    throw new HttpsError('failed-precondition', 'La factura membretada no tiene total valido.');
  }

  const invoiceRef = firestore.collection('facturas_membretadas_ventas').doc();
  const supportPayload = buildAiSupportPayload({ ...inbox, id: draftId });
  const commonPayload = buildAiCommonPayload({ inbox, draftId, actorEmail });
  const batch = firestore.batch();

  batch.set(invoiceRef, {
    saleDate,
    linkedIngresoId: selectedSale.id,
    dailySaleCode: selectedSale.dailySaleCode || selectedSale.reference || `VENTA-${saleDate.replaceAll('-', '')}`,
    numeroFactura: cleanAiText(draft.invoiceNumber || draft.payableInvoiceNumber),
    paymentMethod: cleanAiText(draft.paymentMethod || 'Transferencia BAC'),
    dailySaleSubtotal: normalizeAmount(selectedSale.subtotal || selectedSale.amount),
    dailySaleIva: normalizeAmount(selectedSale.iva),
    dailySaleTotal: normalizeAmount(selectedSale.total || selectedSale.amount),
    branch: getBranchId(),
    branchName: getBranchName(),
    ...fiscal,
    ...supportPayload,
    ...commonPayload,
    timestamp: FieldValue.serverTimestamp(),
  });

  batch.set(inboxRef, {
    status: 'confirmed',
    targetCollection: 'facturas_membretadas_ventas',
    targetDocIds: {
      facturaMembretadaId: invoiceRef.id,
    },
    confirmedBy: actorEmail,
    confirmedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await batch.commit();

  return {
    targetCollection: 'facturas_membretadas_ventas',
    targetDocIds: {
      facturaMembretadaId: invoiceRef.id,
    },
  };
}

async function confirmAiAbono({ inboxRef, inbox, draftId, draft, actorEmail }) {
  const payable = await findPayableForAiAbono(draft);
  if (!payable) {
    throw new HttpsError('failed-precondition', 'No encontre una cuenta por pagar pendiente que coincida con proveedor/factura.');
  }

  const amount = normalizeAmount(draft.amountPaid || draft.total);
  if (amount <= 0) {
    throw new HttpsError('failed-precondition', 'El abono no tiene monto valido.');
  }

  const fecha = getAiDraftDate(draft);
  const paymentMethod = normalizeComparableText(draft.paymentMethod).includes('efectivo') ? 'efectivo' : 'transferencia';
  const supportPayload = buildAiSupportPayload({ ...inbox, id: draftId });
  const commonPayload = buildAiCommonPayload({ inbox, draftId, actorEmail });
  const secuencia = await getNextAbonoSequence();
  const abonoRef = firestore.collection('abonos_pagar').doc();
  const gastoDiarioRef = paymentMethod === 'efectivo' ? firestore.collection('gastosDiarios').doc() : null;
  const payableRef = firestore.collection('cuentas_por_pagar').doc(payable.id);

  await firestore.runTransaction(async (transaction) => {
    const payableSnapshot = await transaction.get(payableRef);
    if (!payableSnapshot.exists) {
      throw new HttpsError('not-found', 'La cuenta por pagar ya no existe.');
    }

    const payableData = payableSnapshot.data();
    const pago = Math.min(normalizeAmount(payableData.saldo), amount);
    const nuevoSaldo = normalizeAmount(normalizeAmount(payableData.saldo) - pago);

    transaction.update(payableRef, {
      saldo: nuevoSaldo,
      estado: nuevoSaldo <= 0 ? 'pagado' : 'parcial',
      updatedAt: FieldValue.serverTimestamp(),
    });

    transaction.set(abonoRef, {
      fecha,
      montoTotal: pago,
      proveedor: payableData.proveedor || draft.payableProvider || draft.supplier || '',
      secuencia,
      paymentMethod,
      linkedGastoDiarioId: gastoDiarioRef?.id || null,
      detalleAfectado: [{ id: payable.id, montoAbonado: pago }],
      ...supportPayload,
      ...commonPayload,
      timestamp: FieldValue.serverTimestamp(),
    });

    if (gastoDiarioRef) {
      transaction.set(gastoDiarioRef, {
        fecha,
        caja: getCashboxName(),
        descripcion: `ABONO A PROVEEDOR ${payableData.proveedor || draft.payableProvider || draft.supplier || ''}`,
        monto: pago,
        tipo: 'ABONO',
        categoria: 'ABONO',
        sucursal: getBranchId(),
        branch: getBranchId(),
        branchName: getBranchName(),
        origen: 'abonos_pagar',
        linkedAbonoId: abonoRef.id,
        paymentMethod,
        ...supportPayload,
        ...commonPayload,
        timestamp: FieldValue.serverTimestamp(),
      });
    }

    transaction.set(inboxRef, {
      status: 'confirmed',
      targetCollection: 'abonos_pagar',
      targetDocIds: {
        abonoId: abonoRef.id,
        cuentaPorPagarId: payable.id,
        gastoDiarioId: gastoDiarioRef?.id || null,
      },
      confirmedBy: actorEmail,
      confirmedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  return {
    targetCollection: 'abonos_pagar',
    targetDocIds: {
      abonoId: abonoRef.id,
      cuentaPorPagarId: payable.id,
      gastoDiarioId: gastoDiarioRef?.id || null,
    },
  };
}

async function confirmFiscalAssistantDraftInternal({ actorEmail, draftId, overrides = {} }) {
  if (!draftId) {
    throw new HttpsError('invalid-argument', 'Falta draftId.');
  }

  const inboxRef = firestore.collection('ai_fiscal_inbox').doc(draftId);
  const inboxSnapshot = await inboxRef.get();
  if (!inboxSnapshot.exists) {
    throw new HttpsError('not-found', 'El borrador IA no existe.');
  }

  const inbox = { id: draftId, ...inboxSnapshot.data() };
  if (inbox.status === 'confirmed') {
    return {
      ok: true,
      alreadyConfirmed: true,
      targetCollection: inbox.targetCollection || '',
      targetDocIds: inbox.targetDocIds || {},
    };
  }

  if (inbox.status === 'rejected') {
    throw new HttpsError('failed-precondition', 'Este borrador ya fue rechazado.');
  }

  const draft = {
    ...(inbox.suggestedDraft || {}),
    ...overrides,
  };

  switch (draft.targetType) {
    case 'gasto_credito':
      return { ok: true, ...(await confirmAiPurchaseOrExpense({ inboxRef, inbox, draftId, draft, actorEmail, kind: 'gasto', credit: true })) };
    case 'gasto_contado':
      return { ok: true, ...(await confirmAiPurchaseOrExpense({ inboxRef, inbox, draftId, draft, actorEmail, kind: 'gasto', credit: false })) };
    case 'compra_credito':
      return { ok: true, ...(await confirmAiPurchaseOrExpense({ inboxRef, inbox, draftId, draft, actorEmail, kind: 'compra', credit: true })) };
    case 'compra_contado':
      return { ok: true, ...(await confirmAiPurchaseOrExpense({ inboxRef, inbox, draftId, draft, actorEmail, kind: 'compra', credit: false })) };
    case 'factura_membretada_venta':
      return { ok: true, ...(await confirmAiStampedInvoice({ inboxRef, inbox, draftId, draft, actorEmail })) };
    case 'abono_cxp':
      return { ok: true, ...(await confirmAiAbono({ inboxRef, inbox, draftId, draft, actorEmail })) };
    default:
      throw new HttpsError('failed-precondition', 'La IA no propuso un tipo de registro confirmable.');
  }
}

exports.confirmFiscalAssistantDraft = onCall(BASE_FUNCTION_OPTIONS, async (request) => {
  const actorEmail = ensureAdminUser(request.auth, 'confirmar borradores del agente IA');
  const draftId = normalizeText(request.data?.draftId);
  const overrides = request.data?.overrides || {};

  return confirmFiscalAssistantDraftInternal({ actorEmail, draftId, overrides });
});

exports.rejectFiscalAssistantDraft = onCall(BASE_FUNCTION_OPTIONS, async (request) => {
  const actorEmail = ensureAdminUser(request.auth, 'rechazar borradores del agente IA');
  const draftId = normalizeText(request.data?.draftId);

  if (!draftId) {
    throw new HttpsError('invalid-argument', 'Falta draftId.');
  }

  await firestore.collection('ai_fiscal_inbox').doc(draftId).set({
    status: 'rejected',
    rejectedBy: actorEmail,
    rejectedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true };
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
