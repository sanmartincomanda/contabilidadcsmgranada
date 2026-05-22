const { createHash } = require('node:crypto');
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
  if (typeof value === 'string') return value.substring(0, 10);
  return '';
}

function normalizeAmount(value) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
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
  return `sicar_${getBranchId()}_${date}`;
}

function getIncomeSyncKey(date) {
  return `sicar:${getBranchId()}:${date}`;
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

  for (const row of rows || []) {
    const date = normalizeDate(
      row.date ||
      row.fecha ||
      row.sale_date ||
      row.saleDate ||
      row.dia ||
      row.day
    );

    const amount = normalizeAmount(
      row.amount ??
      row.monto ??
      row.total ??
      row.ingreso ??
      row.importe
    );

    if (!date) {
      continue;
    }

    aggregated.set(date, normalizeAmount((aggregated.get(date) || 0) + amount));
  }

  return Array.from(aggregated.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, amount]) => ({ date, amount }));
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

  entries.forEach(({ date, amount }) => {
    const ref = firestore.collection('ingresos').doc(getIncomeSyncDocumentId(date));
    batch.set(ref, {
      date,
      month: date.substring(0, 7),
      amount,
      branch: getBranchId(),
      branchName: getBranchName(),
      source: 'sicar',
      sourceLabel: 'SICAR',
      sourceSystem: 'SICAR',
      sourceBranch: getBranchName(),
      syncKey: getIncomeSyncKey(date),
      syncedBy: getActorLabel(actorEmail),
      syncedAt: FieldValue.serverTimestamp(),
      is_conciled: false,
      timezone: getTimezone(),
    }, { merge: true });
  });

  await batch.commit();
}

function buildIncomeSyncResponse({ startDate, endDate, preview, actorEmail, entries }) {
  const totalAmount = entries.reduce((total, item) => total + item.amount, 0);

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
    paymentMethod: entry.paymentMethod,
    paymentRoute: entry.paymentRoute,
    dueDate: entry.dueDate || '',
    sourceRecordId: entry.sourceRecordId || '',
  };
}

function buildRawSaleId(entry) {
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
    sourceRecordId: entry.sourceRecordId || '',
  };
}

function normalizePurchaseRow(row, index = 0) {
  const cancellation = resolveBusinessCancellationMetadata(row);
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

  const amount = normalizeAmount(
    pickFirstValue(row, [
      'amount',
      'monto',
      'total',
      'importe',
      'purchase_total',
      'purchaseTotal',
    ])
  );

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

  const amount = normalizeAmount(
    pickFirstValue(row, [
      'amount',
      'monto',
      'total',
      'ingreso',
      'importe',
      'sale_total',
      'saleTotal',
    ])
  );

  if (!date || amount <= 0) {
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
    ),
    description: normalizeUpperText(
      pickFirstValue(row, [
        'description',
        'descripcion',
        'concepto',
        'detalle',
      ]),
      'VENTA SICAR'
    ),
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
    sourceType: 'venta',
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

function getSaleTargetIds(rawId) {
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

function getResolvedSaleTargetIds(rawId, rawData) {
  const defaults = getSaleTargetIds(rawId);
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
  const { ingresoId } = getResolvedSaleTargetIds(rawId, rawData);
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
    monto: normalized.amount,
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
    monto: normalized.amount,
    saldo: normalized.amount,
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
  const { ingresoId } = getSaleTargetIds(rawId);

  await firestore.collection('ingresos').doc(ingresoId).set({
    date: normalized.date,
    month: normalized.month,
    amount: normalized.amount,
    description: normalized.description || 'VENTA SICAR',
    reference: normalized.reference || '',
    branch: getBranchId(),
    branchName: getBranchName(),
    source: 'sicar',
    sourceLabel: 'SICAR',
    sourceSystem: 'SICAR',
    sourceBranch: getBranchName(),
    sourceMode: rawData.sourceMode || 'push',
    sourceCollection: SALES_TRIGGER_DOCUMENT.replace('{rawId}', rawId),
    sourceRawId: rawId,
    sourceRecordId: normalized.sourceRecordId,
    syncKey: `sicar:venta:${rawId}`,
    syncedBy: 'cloud-function',
    syncedAt: FieldValue.serverTimestamp(),
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

  if (!normalized?.date || !normalized.amount) {
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
