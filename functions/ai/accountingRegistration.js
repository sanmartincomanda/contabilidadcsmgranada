const { createHash } = require('node:crypto');

const REGISTRATION_COLLECTION = 'agente_ia_registros';
const REGISTRATION_KEYS_COLLECTION = 'agente_ia_registros_claves';

const money = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
};
const normalizeText = (value = '') => String(value || '').trim();
const normalizeKey = (value = '') => normalizeText(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, ' ')
  .trim();
const safeId = (value = '') => normalizeText(value)
  .replace(/[^a-zA-Z0-9_-]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 120) || 'sin_id';
const slugify = (value = '') => normalizeText(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const branchPayload = (branchId = 'granada') => {
  if (branchId === 'nindiri') {
    return {
      branch: 'nindiri', branchId: 'nindiri', branchCode: 'NINDIRI', branchName: 'CARNES SAN MARTIN NINDIRI',
      sucursal: 'nindiri', sucursalNombre: 'CARNES SAN MARTIN NINDIRI', invoiceSeries: 'B', receiptSeries: 'B',
      documentSeries: 'B', cashboxName: 'CAJA NINDIRI', caja: 'CAJA NINDIRI',
    };
  }
  return {
    branch: 'granada', branchId: 'granada', branchCode: 'GRANADA', branchName: 'CARNES SAN MARTIN GRANADA',
    sucursal: 'granada', sucursalNombre: 'CARNES SAN MARTIN GRANADA', invoiceSeries: 'A', receiptSeries: 'A',
    documentSeries: 'A', cashboxName: 'CAJA 2', caja: 'CAJA 2',
  };
};

const categoryPayload = (category, subcategory) => ({
  categoryId: `${slugify(category)}__${slugify(subcategory)}`,
  category,
  categoria: category,
  subcategory,
  subcategoria: subcategory,
  expenseCategory: category,
  expenseSubcategory: subcategory,
  categoryLabel: `${category} / ${subcategory}`,
});

const accountPayload = (draft = {}) => ({
  accountingAccountId: draft.accountingAccountId || draft.accountingAccountCode,
  accountingAccountCode: draft.accountingAccountCode || draft.accountingAccountId,
  accountingAccountName: draft.accountingAccountName || '',
  accountingAccountFullName: draft.accountingAccountName || '',
  accountingAccountType: draft.accountingAccountType || '',
  accountingAccountDetailType: draft.accountingAccountDetailType || '',
  accountingAccountSource: 'quickbooks_chart',
});

const supportPayload = (draft = {}) => {
  const primary = (draft.supportFiles || [])[0] || {};
  return {
    supportFiles: draft.supportFiles || [],
    fotoFacturaUrl: draft.fotoFacturaUrl || primary.url || '',
    fotoFacturaPath: draft.fotoFacturaPath || primary.path || '',
    support: primary.url || primary.path ? {
      ...primary,
      source: 'whatsapp',
      sourceCollection: 'whatsapp_inbox',
      sourceDocId: draft.messageId || draft.id || '',
    } : null,
  };
};

const paymentAccount = (method = '') => {
  const normalized = normalizeKey(method);
  if (normalized === 'EFECTIVO') return { code: '11013', name: 'Activos Circulantes Caja:Caja Chica', type: 'Efectivo y equivalentes de efectivo' };
  if (normalized.includes('BANPRO')) return { code: '1102102', name: 'BANCOS:MONEDA NACIONAL:BANPRO NO 10013500002893', type: 'Efectivo y equivalentes de efectivo' };
  if (normalized.includes('LAFISE')) return { code: '1102103', name: 'BANCOS:MONEDA NACIONAL:LA FISE NO.106014315 C$', type: 'Efectivo y equivalentes de efectivo' };
  if (normalized.includes('AMEX') || normalized.includes('PRICESMART')) return { code: '21029-1', name: 'Tarjeta de Credito - Mayor:Amex', type: 'Tarjeta de credito' };
  if (normalized.includes('TARJETA')) return { code: '21029-2', name: 'Tarjeta de Credito - Mayor:Banpro Black', type: 'Tarjeta de credito' };
  return { code: '1102101', name: 'BANCOS:MONEDA NACIONAL:BAC NO. 362843534 C$', type: 'Efectivo y equivalentes de efectivo' };
};

function buildAccountingEntry({ sourceCollection, sourceDocId, record, draft }) {
  const lines = [];
  const pushLine = (account, debit, credit, lineRole, description) => {
    if (money(debit) <= 0 && money(credit) <= 0) return;
    lines.push({
      lineId: `line_${String(lines.length + 1).padStart(2, '0')}`,
      accountCode: account.code,
      accountName: account.name,
      accountType: account.type || '',
      debit: money(debit),
      credit: money(credit),
      lineRole,
      description,
      reference: draft.numeroFactura || '',
    });
  };
  const selectedAccount = {
    code: draft.accountingAccountCode || draft.accountingAccountId,
    name: draft.accountingAccountName || (draft.tipoRegistro === 'compra' ? 'INVENTARIO:Alimentos' : 'COSTOS Y GASTOS'),
    type: draft.accountingAccountType || (draft.tipoRegistro === 'compra' ? 'Activos corrientes' : 'Gastos'),
  };
  const ivaAccount = { code: '110702', name: 'IMPUESTOS ACREDITABLES:IVA Acreditable', type: 'Activos corrientes' };
  const payableAccount = { code: '2101', name: 'CUENTAS POR PAGAR - NIO', type: 'Cuentas por pagar (C/P)' };
  const irAccount = { code: '21041', name: 'IMPTOS CORRIENTES X PAGAR:Anticipo IR', type: 'Pasivos corrientes' };
  const municipalAccount = { code: '21043', name: 'IMPTOS CORRIENTES X PAGAR:Impuestos Municipales', type: 'Pasivos corrientes' };
  const description = normalizeText(draft.descripcion).toUpperCase();
  pushLine(selectedAccount, draft.subtotal, 0, draft.tipoRegistro === 'compra' ? 'inventory_or_cost' : 'expense', description);
  pushLine(ivaAccount, draft.iva, 0, 'iva_credit', `IVA ACREDITABLE ${draft.numeroFactura || ''}`.trim());
  pushLine(normalizeKey(draft.metodoPago) === 'CREDITO' ? payableAccount : paymentAccount(draft.metodoPago), 0, draft.pagoNeto, normalizeKey(draft.metodoPago) === 'CREDITO' ? 'accounts_payable' : 'payment', `PAGO ${draft.metodoPago}`);
  pushLine(irAccount, 0, draft.retencionIr2, 'retention_ir_2', `RETENCION ANTICIPO IR ${draft.numeroFactura || ''}`.trim());
  pushLine(municipalAccount, 0, draft.retencionMunicipal1, 'retention_municipal_1', `RETENCION MUNICIPAL ${draft.numeroFactura || ''}`.trim());
  const totalDebit = money(lines.reduce((sum, line) => sum + line.debit, 0));
  const totalCredit = money(lines.reduce((sum, line) => sum + line.credit, 0));
  const difference = money(totalDebit - totalCredit);
  return {
    id: `${safeId(sourceCollection)}_${safeId(sourceDocId)}`,
    sourceCollection,
    sourceDocId,
    sourceType: draft.tipoRegistro,
    source: 'whatsapp_ai',
    status: Math.abs(difference) <= 0.01 ? 'posted' : 'out_of_balance',
    requiresReview: Math.abs(difference) > 0.01,
    accountingVersion: 1,
    date: draft.fecha,
    month: draft.fecha.substring(0, 7),
    branchId: draft.branchId,
    branchName: record.branchName,
    documentSeries: record.documentSeries,
    documentNumber: draft.numeroFactura || '',
    partyName: draft.proveedor,
    description,
    totalDebit,
    totalCredit,
    difference,
    lines,
    sourceSnapshot: {
      subtotal: money(draft.subtotal), iva: money(draft.iva), total: money(draft.total),
      retentionIr2: money(draft.retencionIr2), retentionMunicipal1: money(draft.retencionMunicipal1),
      retentionTotal: money(draft.totalRetenciones), paymentType: draft.metodoPago,
      accountingAccountCode: draft.accountingAccountCode || '', accountingAccountName: draft.accountingAccountName || '',
    },
  };
}

function buildRegistrationPayloads(draft, { Timestamp, actorEmail }) {
  const draftId = safeId(draft.id || draft.messageId);
  const recordType = draft.tipoRegistro === 'compra' ? 'compra' : 'gasto';
  const sourceCollection = recordType === 'compra' ? 'compras' : 'gastos';
  const recordId = `${recordType}_ai_${draftId}`;
  const payableId = `cxp_ai_${draftId}`;
  const cashId = `caja_ai_${draftId}`;
  const now = Timestamp.now();
  const branch = branchPayload(draft.branchId);
  const category = categoryPayload(draft.categoria, draft.subcategoria);
  const account = accountPayload(draft);
  const support = supportPayload(draft);
  const fiscal = {
    subtotal: money(draft.subtotal), iva: money(draft.iva), total: money(draft.total),
    amount: money(draft.subtotal), monto: money(draft.total),
    retentionIr2: money(draft.retencionIr2), retentionMunicipal1: money(draft.retencionMunicipal1),
    retentionTotal: money(draft.totalRetenciones), cashPaidAmount: money(draft.pagoNeto), pagoNeto: money(draft.pagoNeto),
  };
  const base = {
    date: draft.fecha,
    fecha: draft.fecha,
    month: draft.fecha.substring(0, 7),
    supplier: draft.proveedor,
    proveedor: draft.proveedor,
    providerId: draft.providerId,
    proveedorId: draft.providerId,
    providerCode: draft.providerCode || '',
    codigoProveedor: draft.providerCode || '',
    rucProveedor: draft.rucProveedor || '',
    invoiceNumber: draft.numeroFactura || '',
    factura: draft.numeroFactura || '',
    description: normalizeText(draft.descripcion).toUpperCase(),
    descripcion: normalizeText(draft.descripcion).toUpperCase(),
    paymentType: draft.metodoPago,
    paymentReference: normalizeText(draft.referenciaPago).toUpperCase(),
    source: 'whatsapp_ai',
    sourceType: `whatsapp_ai_${recordType}`,
    agentDraftId: draft.id || draft.messageId,
    whatsappMessageId: draft.messageId || draft.id,
    registeredBy: actorEmail,
    ...branch,
    ...category,
    ...account,
    ...fiscal,
    ...support,
    timestamp: now,
    createdAt: now,
    updatedAt: now,
    is_conciled: false,
  };
  let record = { ...base };
  let payable = null;
  let cashRecord = null;
  let pettyMovement = null;
  if (normalizeKey(draft.metodoPago) === 'CREDITO') {
    record = {
      ...record,
      linkedPayableId: payableId,
      sourceFacturaId: payableId,
      ...(recordType === 'gasto' ? { payableType: 'gasto' } : {}),
    };
    payable = {
      ...base,
      numero: draft.numeroFactura || '',
      vencimiento: draft.vencimiento,
      monto: money(draft.total),
      saldo: money(draft.total),
      estado: 'pendiente',
      paymentType: 'credito',
      isInventoryCost: recordType === 'compra',
      isOperatingExpense: recordType === 'gasto',
      ...(recordType === 'compra'
        ? { linkedPurchaseId: recordId, mirroredPurchaseId: recordId }
        : { linkedExpenseId: recordId, mirroredExpenseId: recordId, mirroredToGastos: true }),
      sourceCollection,
      sourceFacturaId: recordId,
    };
  } else if (normalizeKey(draft.metodoPago) === 'EFECTIVO') {
    record = { ...record, linkedCashExpenseId: cashId, sourceGastoDiarioId: cashId };
    cashRecord = {
      ...base,
      tipo: recordType === 'compra' ? 'Compra' : 'Gasto',
      linkedPurchaseId: recordType === 'compra' ? recordId : '',
      linkedExpenseId: recordType === 'gasto' ? recordId : '',
      sourceCollection,
      sourcePurchaseId: recordType === 'compra' ? recordId : '',
      sourceExpenseId: recordType === 'gasto' ? recordId : '',
    };
    pettyMovement = {
      ...base,
      movementType: 'salida',
      direction: 'salida',
      amount: money(draft.pagoNeto),
      monto: money(draft.pagoNeto),
      signedAmount: -money(draft.pagoNeto),
      accountingTotal: money(draft.total),
      sourceCollection: 'gastosDiarios',
      sourceDocId: cashId,
      linkedGastoDiarioId: cashId,
      linkedPurchaseId: recordType === 'compra' ? recordId : '',
      linkedExpenseId: recordType === 'gasto' ? recordId : '',
    };
  }
  const accountingEntry = buildAccountingEntry({ sourceCollection, sourceDocId: recordId, record, draft });
  accountingEntry.timestamp = now;
  accountingEntry.createdAt = now;
  accountingEntry.updatedAt = now;
  return { recordType, sourceCollection, recordId, payableId, cashId, record, payable, cashRecord, pettyMovement, accountingEntry };
}

function registrationDedupeKey(draft) {
  const invoiceOrSupport = normalizeText(draft.numeroFactura) || draft.supportHash || normalizeKey(draft.descripcion);
  return createHash('sha256').update([
    draft.branchId,
    draft.providerId,
    invoiceOrSupport,
    draft.fecha,
    money(draft.total).toFixed(2),
  ].join('|')).digest('hex');
}

async function registerAccountingDraft({ firestore, FieldValue, Timestamp, draft, actorEmail }) {
  const draftId = safeId(draft.id || draft.messageId);
  const lockRef = firestore.collection(REGISTRATION_COLLECTION).doc(draftId);
  const dedupeKey = registrationDedupeKey(draft);
  const dedupeRef = firestore.collection(REGISTRATION_KEYS_COLLECTION).doc(dedupeKey);
  const payloads = buildRegistrationPayloads(draft, { Timestamp, actorEmail });
  const refs = {
    record: firestore.collection(payloads.sourceCollection).doc(payloads.recordId),
    payable: firestore.collection('cuentas_por_pagar').doc(payloads.payableId),
    cash: firestore.collection('gastosDiarios').doc(payloads.cashId),
    petty: firestore.collection('caja_chica_movimientos').doc(`salida_gastosDiarios_${payloads.cashId}`),
    entry: firestore.collection('contabilidad_asientos').doc(`${payloads.sourceCollection}_${payloads.recordId}`),
  };
  const result = await firestore.runTransaction(async (transaction) => {
    const [lockSnap, dedupeSnap] = await Promise.all([transaction.get(lockRef), transaction.get(dedupeRef)]);
    if (lockSnap.exists && lockSnap.data().status === 'registered') {
      return { alreadyRegistered: true, ...lockSnap.data().targetDocIds };
    }
    if (dedupeSnap.exists && dedupeSnap.data().draftId !== (draft.id || draft.messageId)) {
      throw new Error(`Documento duplicado: ya fue registrado por el borrador ${dedupeSnap.data().draftId}.`);
    }
    transaction.set(refs.record, payloads.record, { merge: false });
    if (payloads.payable) transaction.set(refs.payable, payloads.payable, { merge: false });
    if (payloads.cashRecord) transaction.set(refs.cash, payloads.cashRecord, { merge: false });
    if (payloads.pettyMovement) transaction.set(refs.petty, payloads.pettyMovement, { merge: false });
    transaction.set(refs.entry, payloads.accountingEntry, { merge: false });
    const targetDocIds = {
      [payloads.sourceCollection]: payloads.recordId,
      ...(payloads.payable ? { cuentas_por_pagar: payloads.payableId } : {}),
      ...(payloads.cashRecord ? { gastosDiarios: payloads.cashId, caja_chica_movimientos: refs.petty.id } : {}),
      contabilidad_asientos: refs.entry.id,
    };
    transaction.set(dedupeRef, {
      draftId: draft.id || draft.messageId,
      dedupeKey,
      targetDocIds,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: false });
    transaction.set(lockRef, {
      status: 'registered',
      draftId: draft.id || draft.messageId,
      recordType: payloads.recordType,
      targetDocIds,
      registeredBy: actorEmail,
      registeredAt: FieldValue.serverTimestamp(),
    }, { merge: false });
    return { alreadyRegistered: false, ...targetDocIds };
  });
  return result;
}

module.exports = {
  REGISTRATION_COLLECTION,
  REGISTRATION_KEYS_COLLECTION,
  buildRegistrationPayloads,
  registerAccountingDraft,
  registrationDedupeKey,
};
