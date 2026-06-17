const admin = require('firebase-admin');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || '';
const CUTOVER_DATE = process.env.SICAR_PRIVATE_CUTOVER_DATE || '2026-05-14';
const BRANCH_ID = process.env.SICAR_BRANCH_ID || 'granada';
const BRANCH_NAME = process.env.SICAR_BRANCH_NAME || 'CARNES SAN MARTIN GRANADA';
const CASHBOX_NAME = process.env.SICAR_CASHBOX_NAME || 'CAJA 2';
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
const preview = process.argv.includes('--preview');
const requeueErrors = process.argv.includes('--requeue-errors');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = Number(limitArg?.split('=')[1] || 100);

if (!admin.apps.length) {
  const appConfig = {
    credential: admin.credential.applicationDefault(),
  };

  if (PROJECT_ID) {
    appConfig.projectId = PROJECT_ID;
  }

  admin.initializeApp(appConfig);
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeUpperText(value) {
  const normalized = normalizeText(value);
  return normalized ? normalized.toUpperCase() : '';
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

function normalizeAmount(value) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
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

function pickFirstValue(source, keys) {
  for (const key of keys) {
    if (source?.[key] !== undefined && source[key] !== null && source[key] !== '') {
      return source[key];
    }
  }

  return null;
}

function normalizePurchasePaymentMethod(value) {
  const comparable = normalizeComparableText(value);

  if (!comparable) return 'otro';
  if (comparable.includes('credito') || comparable.includes('cuenta por pagar') || comparable.includes('por pagar')) return 'credito';
  if (comparable.includes('efectivo') || comparable.includes('cash') || comparable.includes('caja')) return 'efectivo';
  if (comparable.includes('contado')) return 'transferencia';
  if (comparable.includes('transfer')) return 'transferencia';
  if (comparable.includes('cheque')) return 'cheque';
  if (comparable.includes('debito')) return 'debito';
  if (comparable.includes('deposito')) return 'deposito';
  return comparable || 'otro';
}

function resolvePurchaseRoute(paymentMethod) {
  if (paymentMethod === 'credito') return 'credito';
  if (paymentMethod === 'efectivo') return 'efectivo';
  return 'otro';
}

function isMeaningfulInvoiceValue(value) {
  const normalized = normalizeUpperText(value);
  if (!normalized) return false;
  return !['-', 'S/N', 'SN', 'N/A', 'NA', 'NULL', 'UNDEFINED'].includes(normalized);
}

function buildPurchaseInvoiceMetadata(source) {
  const explicitInvoiceNumber = normalizeUpperText(
    pickFirstValue(source, [
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
    pickFirstValue(source, [
      'purchaseFolio',
      'purchase_folio',
      'folio',
      'folio_compra',
      'folioCompra',
    ])
  );

  const purchaseSeries = normalizeUpperText(
    pickFirstValue(source, [
      'purchaseSeries',
      'purchase_series',
      'serieFolio',
      'serie_folio',
      'serieFactura',
      'serie_factura',
      'serie',
    ])
  );

  const parts = [];
  if (isMeaningfulInvoiceValue(purchaseSeries)) parts.push(purchaseSeries);
  if (isMeaningfulInvoiceValue(purchaseFolio)) parts.push(purchaseFolio);

  return {
    invoiceNumber: isMeaningfulInvoiceValue(explicitInvoiceNumber) ? explicitInvoiceNumber : parts.join('-'),
    purchaseFolio: isMeaningfulInvoiceValue(purchaseFolio) ? purchaseFolio : '',
    purchaseSeries: isMeaningfulInvoiceValue(purchaseSeries) ? purchaseSeries : '',
  };
}

function isCancellationKeyword(value) {
  const normalized = normalizeComparableText(value);
  if (!normalized) return false;

  return (
    normalized.includes('anulad') ||
    normalized.includes('cancelad') ||
    normalized === 'void' ||
    normalized === 'inactive'
  );
}

function isTruthyFlag(value) {
  return value === true || value === 'true' || value === 1 || value === '1' || value === 'si' || value === 'yes';
}

function isCancelled(rawData) {
  const source = {
    ...(rawData?.rawPayload || {}),
    ...(rawData?.normalized || {}),
    ...rawData,
  };

  if ([
    source?.canceled,
    source?.cancelled,
    source?.isCancelled,
    source?.isCanceled,
    source?.anulado,
    source?.cancelado,
  ].some(isTruthyFlag)) {
    return true;
  }

  if ([source?.businessStatus, source?.statusText, source?.estado].some(isCancellationKeyword)) {
    return true;
  }

  if (Number(source?.status) < 0 || Number(source?.can_caj_id) > 0 || Number(source?.can_rcc_id) > 0) {
    return true;
  }

  return false;
}

function buildDescription(normalized) {
  const supplier = normalized.supplier || 'COMPRA SICAR';
  const invoiceLabel = normalized.invoiceNumber ? `FACTURA ${normalized.invoiceNumber}` : 'SIN FACTURA';
  const detail = normalizeUpperText(normalized.description || normalized.notes);
  return [supplier, invoiceLabel, detail].filter(Boolean).join(' / ');
}

function extractNormalizedPurchase(rawData) {
  const source = {
    ...(rawData?.rawPayload || {}),
    ...(rawData?.normalized || {}),
    ...rawData,
  };

  const date = normalizeDate(
    pickFirstValue(source, [
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

  const subtotal = normalizeAmount(
    pickFirstValue(source, [
      'subtotal',
      'subTotal',
      'amount',
      'purchase_subtotal',
      'purchaseSubtotal',
    ])
  );
  const total = normalizeAmount(
    pickFirstValue(source, [
      'total',
      'monto',
      'importe',
      'purchase_total',
      'purchaseTotal',
    ])
  );
  const subtotalExento = normalizeAmount(pickFirstValue(source, ['subtotalExento', 'subtotal0', 'subtotal_exento']));
  const subtotalGravado = normalizeAmount(
    pickFirstValue(source, ['subtotalGravado', 'subtotal_gravado']) ||
    Math.max(subtotal - subtotalExento, 0)
  );
  const iva = normalizeAmount(
    pickFirstValue(source, ['iva', 'tax', 'impuesto']) ??
    Math.max(total - subtotal, 0)
  );
  const amount = subtotal || total;

  const paymentMethod = normalizePurchasePaymentMethod(
    pickFirstValue(source, [
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
      'paymentMethods',
    ])
  );

  const invoiceMetadata = buildPurchaseInvoiceMetadata(source);
  const sourceRecordId = normalizeText(
    pickFirstValue(source, [
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

  return {
    date,
    month: date ? date.substring(0, 7) : '',
    amount,
    subtotal: subtotal || amount,
    subtotalExento,
    subtotalGravado,
    iva,
    total: total || amount,
    supplier: normalizeUpperText(
      pickFirstValue(source, [
        'supplier',
        'proveedor',
        'vendor',
        'nombre_proveedor',
        'nombreProveedor',
      ])
    ) || 'PROVEEDOR NO IDENTIFICADO',
    invoiceNumber: invoiceMetadata.invoiceNumber,
    purchaseFolio: invoiceMetadata.purchaseFolio,
    purchaseSeries: invoiceMetadata.purchaseSeries,
    description: normalizeUpperText(
      pickFirstValue(source, [
        'description',
        'descripcion',
        'concepto',
        'detalle',
        'lineDescriptions',
      ])
    ).replace(/\s*\|\|\s*/g, ' | '),
    notes: normalizeUpperText(
      pickFirstValue(source, [
        'notes',
        'nota',
        'notas',
        'observacion',
        'observaciones',
        'comentario',
      ])
    ),
    dueDate: normalizeDate(
      pickFirstValue(source, [
        'dueDate',
        'due_date',
        'vencimiento',
        'fecha_vencimiento',
        'fechaVencimiento',
      ])
    ),
    paymentMethod,
    paymentRoute: resolvePurchaseRoute(paymentMethod),
    sourceRecordId: sourceRecordId || date,
    isCancelled: isCancelled(rawData),
  };
}

function getTargetIds(rawId) {
  return {
    compraId: `sicar_compra_${rawId}`,
    gastoDiarioId: `sicar_gd_${rawId}`,
    cuentaPorPagarId: `sicar_cxp_${rawId}`,
  };
}

async function getAbonosLinkedToFactura(facturaId) {
  const snapshot = await db.collection('abonos_pagar').get();

  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((abono) =>
      Array.isArray(abono.detalleAfectado) &&
      abono.detalleAfectado.some((item) => item?.id === facturaId)
    );
}

async function cancelCreditAbonos(batch, facturaId) {
  const abonos = await getAbonosLinkedToFactura(facturaId);

  for (const abono of abonos) {
    const detalle = Array.isArray(abono.detalleAfectado) ? abono.detalleAfectado : [];
    const touchesOnlyFactura = detalle.every((item) => item?.id === facturaId);

    if (!touchesOnlyFactura) {
      throw new Error(`La factura ${facturaId} ya tiene un abono compartido con otras facturas.`);
    }

    if (abono.paymentMethod === 'efectivo' && abono.linkedGastoDiarioId) {
      batch.delete(db.collection('gastosDiarios').doc(abono.linkedGastoDiarioId));
    }

    batch.delete(db.collection('abonos_pagar').doc(abono.id));
  }

  return abonos.map((abono) => abono.id);
}

async function markIgnored(rawRef, reason, rawDate) {
  await rawRef.set({
    status: 'ignored',
    ignoredAt: FieldValue.serverTimestamp(),
    ignoredReason: reason,
    rawDate,
  }, { merge: true });
}

async function processPurchaseDocument(docSnapshot) {
  const rawId = docSnapshot.id;
  const rawRef = docSnapshot.ref;
  const rawData = docSnapshot.data() || {};
  const normalized = extractNormalizedPurchase(rawData);

  if (!normalized.date || !normalized.amount) {
    await rawRef.set({
      status: 'error',
      error: 'El documento privado no tiene fecha o monto valido.',
      errorAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { rawId, status: 'error' };
  }

  if (normalized.date < CUTOVER_DATE) {
    await markIgnored(rawRef, 'before_cutover', normalized.date);
    return { rawId, status: 'ignored' };
  }

  const targetDocIds = getTargetIds(rawId);

  if (preview) {
    return {
      rawId,
      status: normalized.isCancelled ? 'preview_cancel' : 'preview_process',
      route: normalized.paymentRoute,
      targetDocIds,
    };
  }

  await rawRef.set({
    status: normalized.isCancelled ? 'cancelling' : 'processing',
    processingStartedAt: FieldValue.serverTimestamp(),
    processingBy: 'local-worker',
  }, { merge: true });

  try {
    const batch = db.batch();

    if (normalized.isCancelled) {
      let removedAbonoIds = [];
      if (normalized.paymentRoute === 'credito') {
        removedAbonoIds = await cancelCreditAbonos(batch, targetDocIds.cuentaPorPagarId);
        batch.delete(db.collection('cuentas_por_pagar').doc(targetDocIds.cuentaPorPagarId));
        batch.delete(db.collection('compras').doc(targetDocIds.compraId));
      } else if (normalized.paymentRoute === 'efectivo') {
        batch.delete(db.collection('gastosDiarios').doc(targetDocIds.gastoDiarioId));
        batch.delete(db.collection('compras').doc(targetDocIds.compraId));
      } else {
        batch.delete(db.collection('compras').doc(targetDocIds.compraId));
      }

      await batch.commit();
      await rawRef.set({
        status: 'cancelled',
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledBy: 'local-worker',
        targetDocIds,
        resolvedRoute: normalized.paymentRoute,
        removedAbonoIds,
      }, { merge: true });

      return { rawId, status: 'cancelled', route: normalized.paymentRoute };
    }

    const description = buildDescription(normalized);
    const categoryPayload = resolvePurchaseCategoryPayload(normalized);

    if (normalized.paymentRoute === 'efectivo') {
      batch.set(db.collection('gastosDiarios').doc(targetDocIds.gastoDiarioId), {
        fecha: normalized.date,
        caja: CASHBOX_NAME,
        descripcion: description,
        monto: normalized.total,
        amount: normalized.amount,
        subtotal: normalized.subtotal,
        subtotalExento: normalized.subtotalExento,
        subtotalGravado: normalized.subtotalGravado,
        iva: normalized.iva,
        total: normalized.total,
        tipo: 'Compra',
        ...categoryPayload,
        sucursal: BRANCH_ID,
        branch: BRANCH_ID,
        branchName: BRANCH_NAME,
        linkedExpenseId: null,
        linkedPurchaseId: targetDocIds.compraId,
        paymentMethod: 'efectivo',
        sourceCollection: `integraciones_privadas/sicar/compras_raw/${rawId}`,
        sourceRawId: rawId,
        sourceSystem: 'SICAR',
        sourceRecordId: normalized.sourceRecordId,
        timestamp: FieldValue.serverTimestamp(),
      });
    }

    if (normalized.paymentRoute === 'credito') {
      const cuentaPorPagarRef = db.collection('cuentas_por_pagar').doc(targetDocIds.cuentaPorPagarId);
      const existingPayableSnapshot = await cuentaPorPagarRef.get();
      const existingPayable = existingPayableSnapshot.exists ? existingPayableSnapshot.data() : null;
      const previousTotal = normalizeAmount(existingPayable?.total ?? existingPayable?.monto);
      const previousSaldo = normalizeAmount(existingPayable?.saldo ?? normalized.total);
      const saldo = existingPayable
        ? normalizeAmount(Math.max(previousSaldo + (normalized.total - previousTotal), 0))
        : normalized.total;

      batch.set(cuentaPorPagarRef, {
        fecha: normalized.date,
        month: normalized.month,
        proveedor: normalized.supplier,
        sucursal: BRANCH_NAME,
        branch: BRANCH_ID,
        branchName: BRANCH_NAME,
        numero: normalized.invoiceNumber,
        factura: normalized.invoiceNumber,
        purchaseFolio: normalized.purchaseFolio || '',
        purchaseSeries: normalized.purchaseSeries || '',
        vencimiento: normalized.dueDate || '',
        descripcion: description,
        monto: normalized.total,
        saldo,
        amount: normalized.amount,
        subtotal: normalized.subtotal,
        subtotalExento: normalized.subtotalExento,
        subtotalGravado: normalized.subtotalGravado,
        iva: normalized.iva,
        total: normalized.total,
        ...categoryPayload,
        estado: saldo <= 0 ? 'pagado' : saldo < normalized.total ? 'parcial' : 'pendiente',
        paymentType: 'credito',
        paymentMethodOriginal: 'credito',
        isInventoryCost: true,
        mirroredToCompras: true,
        mirroredPurchaseId: targetDocIds.compraId,
        sourceCollection: `integraciones_privadas/sicar/compras_raw/${rawId}`,
        sourceRawId: rawId,
        sourceSystem: 'SICAR',
        sourceMode: rawData.sourceMode || 'push',
        sourceRecordId: normalized.sourceRecordId,
        timestamp: FieldValue.serverTimestamp(),
      });
    }

    batch.set(db.collection('compras').doc(targetDocIds.compraId), {
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
      branch: BRANCH_ID,
      branchName: BRANCH_NAME,
      paymentType: normalized.paymentRoute === 'credito' ? 'credito' : normalized.paymentRoute === 'efectivo' ? 'contado' : 'Transferencia',
      paymentMethodOriginal: normalized.paymentMethod || normalized.paymentRoute,
      isInventoryCost: true,
      description,
      sourceCollection: `integraciones_privadas/sicar/compras_raw/${rawId}`,
      sourceRawId: rawId,
      sourceSystem: 'SICAR',
      sourceMode: rawData.sourceMode || 'push',
      sourceRecordId: normalized.sourceRecordId,
      sourceGastoDiarioId: normalized.paymentRoute === 'efectivo' ? targetDocIds.gastoDiarioId : null,
      sourceFacturaId: normalized.paymentRoute === 'credito' ? targetDocIds.cuentaPorPagarId : null,
      linkedPayableId: normalized.paymentRoute === 'credito' ? targetDocIds.cuentaPorPagarId : null,
      timestamp: FieldValue.serverTimestamp(),
    });

    await batch.commit();

    await rawRef.set({
      status: 'processed',
      processedAt: FieldValue.serverTimestamp(),
      processedBy: 'local-worker',
      targetDocIds,
      resolvedRoute: normalized.paymentRoute,
      normalized: {
        ...rawData.normalized,
        invoiceNumber: normalized.invoiceNumber,
        purchaseFolio: normalized.purchaseFolio,
        purchaseSeries: normalized.purchaseSeries,
        paymentRoute: normalized.paymentRoute,
        ...categoryPayload,
      },
    }, { merge: true });

    return { rawId, status: 'processed', route: normalized.paymentRoute, targetDocIds };
  } catch (error) {
    await rawRef.set({
      status: 'error',
      error: error.message || 'Error procesando compra privada SICAR.',
      errorAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { rawId, status: 'error', error: error.message };
  }
}

async function main() {
  const allowedStatuses = requeueErrors ? new Set(['pending', 'error']) : new Set(['pending']);
  const snapshot = await db.collection('integraciones_privadas/sicar/compras_raw').get();
  const candidates = snapshot.docs
    .filter((doc) => allowedStatuses.has(normalizeComparableText(doc.data()?.status || 'pending')))
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, limit);

  const results = [];
  for (const doc of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const result = await processPurchaseDocument(doc);
    results.push(result);
  }

  console.log(JSON.stringify({
    ok: true,
    preview,
    requeueErrors,
    limit,
    processedCount: results.length,
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
