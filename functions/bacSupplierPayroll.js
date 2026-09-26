const { createHash } = require('node:crypto');
const { BAC_PLAN, bacReference } = require('./bacF10');

const PROVIDER_CACHE_TTL_MS = 5 * 60 * 1000;
let providerCatalogCache = null;

const normalizeText = (value = '') => String(value ?? '').trim();
const normalizeKey = (value = '') => normalizeText(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .toUpperCase();
const money = (value = 0) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
};
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');

const accountingEntryId = (collectionName, id) => `${collectionName}_${id}`
  .trim()
  .replace(/[^a-zA-Z0-9_-]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 181);

function isCancelled(record = {}) {
  const status = normalizeKey(record.status || record.estado || record.pipelineStatus);
  return record.cancelled === true
    || record.canceled === true
    || record.anulado === true
    || record.isCancelled === true
    || ['ANULADO', 'ANULADA', 'CANCELLED', 'CANCELED', 'REVERSED', 'REVERSADO', 'ELIMINADO'].includes(status);
}

function resolveBranchId(record = {}) {
  const raw = normalizeKey(record.branchId || record.sucursalId || record.branch || record.sucursal || record.branchName);
  if (raw.includes('NINDIRI') || raw.includes('SERIE B') || raw === 'B') return 'nindiri';
  return 'granada';
}

function resolvePaymentAccountCode(record = {}) {
  const explicit = normalizeText(
    record.paymentAccountCode
    || record.expensePaymentOptionId
    || record.paymentAccount?.code
    || record.accountCode
  );
  if (explicit) return explicit;

  const method = normalizeKey(record.paymentMethodLabel || record.paymentMethod || record.paymentType || record.metodoPago);
  if (method === 'TRANSFERENCIA' || method === 'TRANSFERENCIA BAC' || method === 'BAC 362843534') {
    return BAC_PLAN.accountCode;
  }
  return '';
}

function getDate(record = {}, sourceType = '') {
  const raw = sourceType === 'payable_payment'
    ? record.fecha || record.paymentDate || record.date
    : record.date || record.fecha || record.paymentDate;
  if (raw?.toDate && typeof raw.toDate === 'function') return raw.toDate().toISOString().slice(0, 10);
  if (raw && typeof raw === 'object' && Number.isFinite(raw._seconds)) {
    return new Date(raw._seconds * 1000).toISOString().slice(0, 10);
  }
  return normalizeText(raw).slice(0, 10);
}

function normalizeReferenceItem(item = {}, fallbackName = '') {
  const reference = normalizeText(item.reference || item.beneficiaryReference || item.referencia);
  const bankAccount = normalizeText(item.bankAccount || item.account || item.cuentaBancaria);
  const beneficiaryName = normalizeText(item.beneficiaryName || item.name || item.nombre || fallbackName);
  if (!reference || !bankAccount || !beneficiaryName) return null;
  try {
    bacReference(reference);
  } catch {
    return null;
  }
  if (!/^\d{1,9}$/.test(bankAccount)) return null;
  return { reference, bankAccount, beneficiaryName };
}

function providerReferences(provider = {}) {
  const legalName = normalizeText(provider.legalName || provider.nombre || provider.name);
  const plan = provider.bacPaymentPlans?.[BAC_PLAN.code] || provider.bacPlans?.[BAC_PLAN.code] || {};
  const candidates = [
    ...(Array.isArray(plan.references) ? plan.references : []),
    ...(Array.isArray(provider.bacReferences) ? provider.bacReferences : []),
  ];
  const unique = new Map();
  candidates.forEach((candidate) => {
    if (candidate.planCode && candidate.planCode !== BAC_PLAN.code) return;
    const normalized = normalizeReferenceItem(candidate, legalName);
    if (!normalized) return;
    unique.set(`${normalized.reference}|${normalized.bankAccount}`, normalized);
  });
  return [...unique.values()].sort((left, right) => (
    left.reference.localeCompare(right.reference) || left.bankAccount.localeCompare(right.bankAccount)
  ));
}

function buildProviderIndex(providers = []) {
  const byId = new Map();
  const byName = new Map();
  providers.forEach((provider) => byId.set(provider.id, provider));

  const resolveCanonical = (provider) => {
    let current = provider;
    const seen = new Set();
    while (current?.mergedInto && byId.has(current.mergedInto) && !seen.has(current.id)) {
      seen.add(current.id);
      current = byId.get(current.mergedInto);
    }
    return current || provider;
  };

  providers.forEach((provider) => {
    const canonical = resolveCanonical(provider);
    const names = [
      provider.nombre,
      provider.name,
      provider.legalName,
      ...(Array.isArray(provider.aliases) ? provider.aliases : []),
    ];
    names.map(normalizeKey).filter(Boolean).forEach((name) => {
      if (!byName.has(name) || canonical.active !== false) byName.set(name, canonical);
    });
  });

  return {
    resolve(providerId, supplierName) {
      const direct = providerId && byId.get(providerId);
      const provider = direct ? resolveCanonical(direct) : byName.get(normalizeKey(supplierName));
      if (!provider) return null;
      return {
        id: provider.id,
        legalName: normalizeText(provider.legalName || provider.nombre || provider.name || supplierName),
        references: providerReferences(provider),
        active: provider.active !== false,
      };
    },
  };
}

function providerIdentity(record = {}) {
  return {
    providerId: normalizeText(record.providerId || record.proveedorId || record.supplierId),
    supplierName: normalizeText(record.supplier || record.proveedor || record.provider || record.nombreProveedor),
  };
}

function invoiceNumber(record = {}) {
  return normalizeText(record.invoiceNumber || record.numero || record.factura || record.documentNumber || 'S/N') || 'S/N';
}

function buildVersion(candidate) {
  return hash(JSON.stringify({
    key: candidate.key,
    paymentDate: candidate.paymentDate,
    branchId: candidate.branchId,
    providerId: candidate.providerId,
    invoiceNumber: candidate.invoiceNumber,
    grossAmount: candidate.grossAmount,
    retentionAmount: candidate.retentionAmount,
    netAmount: candidate.netAmount,
    expectedBankAmount: candidate.expectedBankAmount,
    reconciled: candidate.reconciled,
    reconciliationReason: candidate.reconciliationReason,
    mirrorSources: candidate.mirrorSources,
    referenceKeys: candidate.bacReferences.map((item) => `${item.reference}|${item.bankAccount}`),
  }));
}

function directOperationKey(collectionName, id, record = {}) {
  const linkedId = normalizeText(
    record.paymentOperationId
    || record.bankMovementId
    || record.sourceGastoDiarioId
    || record.gastoDiarioId
    || record.linkedGastoDiarioId
  );
  return linkedId ? `operation:${linkedId}` : `${collectionName}:${id}`;
}

function buildDirectCandidate({ collectionName, id, record, providerIndex }) {
  if (isCancelled(record)) return null;
  if (resolvePaymentAccountCode(record) !== BAC_PLAN.accountCode) return null;
  const method = normalizeKey(record.paymentType || record.paymentMethod || record.paymentMethodLabel);
  if (method === 'CREDITO' || record.linkedPayableId || record.sourceFacturaId) return null;

  const identity = providerIdentity(record);
  const provider = providerIndex.resolve(identity.providerId, identity.supplierName);
  const grossAmount = money(record.total ?? record.montoTotal ?? record.monto ?? record.amount);
  const retentionAmount = money(
    record.retentionTotal
    ?? (money(record.retentionIr2 ?? record.retencionIr2) + money(record.retentionMunicipal1 ?? record.retencionMunicipal1))
  );
  const netAmount = money(record.netPayable ?? record.netPaymentAmount ?? Math.max(grossAmount - retentionAmount, 0));
  if (netAmount <= 0) return null;

  const candidate = {
    key: `${collectionName}:${id}`,
    operationKey: directOperationKey(collectionName, id, record),
    sourceCollection: collectionName,
    sourceDocId: id,
    sourceType: collectionName === 'compras' ? 'purchase' : 'expense',
    sourceLabel: collectionName === 'compras' ? 'Compra de contado' : 'Gasto de contado',
    paymentDate: getDate(record),
    branchId: resolveBranchId(record),
    branchName: resolveBranchId(record) === 'nindiri' ? 'Nindiri · Serie B' : 'Granada · Serie A',
    providerId: provider?.id || identity.providerId,
    supplierName: provider?.legalName || identity.supplierName || 'PROVEEDOR SIN IDENTIFICAR',
    invoiceNumber: invoiceNumber(record).slice(0, 20),
    paymentReference: normalizeText(record.paymentReference || record.reference || record.referencia),
    grossAmount,
    retentionAmount,
    netAmount,
    expectedBankAmount: netAmount,
    accountingEntryId: accountingEntryId(collectionName, id),
    bacReferences: provider?.references || [],
    providerActive: provider?.active !== false,
    exported: false,
    exportState: 'pending',
    reconciled: null,
    reconciliationReason: 'Pendiente validar el asiento de la cuenta BAC 1102101.',
    mirrorSources: [`${collectionName}:${id}`],
  };
  candidate.selectable = candidate.providerActive && candidate.bacReferences.length > 0;
  candidate.version = buildVersion(candidate);
  return candidate;
}

function buildPayablePaymentCandidates({ id, record, providerIndex, payablesById = new Map() }) {
  if (isCancelled(record)) return [];
  if (resolvePaymentAccountCode(record) !== BAC_PLAN.accountCode) return [];

  const detail = Array.isArray(record.detalleAfectado) ? record.detalleAfectado : [];
  const batchNetAmount = money(record.netPaymentAmount ?? record.montoTotal ?? record.monto ?? record.amount);
  if (batchNetAmount <= 0) return [];

  const applications = detail.length ? detail : [{
    id: normalizeText(record.payableId || record.facturaId),
    montoAbonado: batchNetAmount,
  }];
  const normalizedApplications = applications.map((item, index) => {
    const payable = payablesById.get(item.id) || {};
    const retentionAmount = money(
      item.retentionTotal
      ?? (money(item.retentionIr2 ?? item.retencionIr2) + money(item.retentionMunicipal1 ?? item.retencionMunicipal1))
    );
    const grossAmount = money(item.grossAmount ?? item.montoBruto ?? item.amount ?? item.montoAbonado);
    const netAmount = money(item.netPaymentAmount ?? item.neto ?? Math.max(grossAmount - retentionAmount, 0));
    return {
      id: normalizeText(item.id || item.payableId || item.facturaId || index + 1),
      index,
      payable,
      grossAmount,
      retentionAmount,
      netAmount,
    };
  }).filter((item) => item.netAmount > 0);

  const applicationTotal = money(normalizedApplications.reduce((sum, item) => sum + item.netAmount, 0));
  const batchMatchesApplications = Math.abs(applicationTotal - batchNetAmount) <= 0.01;

  return normalizedApplications.map((application) => {
    const recordIdentity = providerIdentity(record);
    const payableIdentity = providerIdentity(application.payable);
    const identity = {
      providerId: recordIdentity.providerId || payableIdentity.providerId,
      supplierName: recordIdentity.supplierName || payableIdentity.supplierName,
    };
    const provider = providerIndex.resolve(identity.providerId, identity.supplierName);
    const candidate = {
      key: `abonos_pagar:${id}:${application.id}:${application.index + 1}`,
      operationKey: `abonos_pagar:${id}`,
      sourceCollection: 'abonos_pagar',
      sourceDocId: id,
      sourceType: 'payable_payment',
      sourceLabel: normalizedApplications.length > 1
        ? `Abono multifactura · ${application.index + 1}/${normalizedApplications.length}`
        : 'Abono cuenta por pagar',
      paymentDate: getDate(record, 'payable_payment'),
      branchId: resolveBranchId(record),
      branchName: resolveBranchId(record) === 'nindiri' ? 'Nindiri · Serie B' : 'Granada · Serie A',
      providerId: provider?.id || identity.providerId,
      supplierName: provider?.legalName || identity.supplierName || 'PROVEEDOR SIN IDENTIFICAR',
      invoiceNumber: invoiceNumber(Object.keys(application.payable).length ? application.payable : record).slice(0, 20),
      paymentReference: normalizeText(record.paymentReference || record.reference || record.referencia),
      grossAmount: application.grossAmount,
      retentionAmount: application.retentionAmount,
      netAmount: application.netAmount,
      batchNetAmount,
      expectedBankAmount: batchNetAmount,
      applicationIndex: application.index + 1,
      applicationCount: normalizedApplications.length,
      applicationTotal,
      accountingEntryId: accountingEntryId('abonos_pagar', id),
      bacReferences: provider?.references || [],
      providerActive: provider?.active !== false,
      exported: false,
      exportState: 'pending',
      reconciled: null,
      reconciliationReason: batchMatchesApplications
        ? 'Pendiente validar el asiento de la cuenta BAC 1102101.'
        : 'El total aplicado a facturas no coincide con el monto total del abono.',
      applicationsMatchPayment: batchMatchesApplications,
      mirrorSources: [`abonos_pagar:${id}`],
    };
    candidate.selectable = candidate.providerActive
      && candidate.bacReferences.length > 0
      && batchMatchesApplications;
    candidate.version = buildVersion(candidate);
    return candidate;
  });
}

function buildPayablePaymentCandidate(options) {
  return buildPayablePaymentCandidates(options)[0] || null;
}

async function loadProviderCatalog(db, { force = false } = {}) {
  const now = Date.now();
  if (!force && providerCatalogCache && now - providerCatalogCache.loadedAt < PROVIDER_CACHE_TTL_MS) {
    return providerCatalogCache.providers;
  }
  const snapshot = await db.collection('proveedores').get();
  const providers = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  providerCatalogCache = { loadedAt: now, providers };
  return providers;
}

async function queryDateRange(db, collectionName, field, from, to) {
  const snapshot = await db.collection(collectionName)
    .where(field, '>=', from)
    .where(field, '<=', to)
    .get();
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function loadPayables(db, abonos = []) {
  const ids = [...new Set(abonos.flatMap((record) => (
    Array.isArray(record.detalleAfectado) ? record.detalleAfectado.map((item) => item.id) : []
  )).filter(Boolean))];
  const result = new Map();
  for (let index = 0; index < ids.length; index += 250) {
    const refs = ids.slice(index, index + 250).map((id) => db.collection('cuentas_por_pagar').doc(id));
    if (!refs.length) continue;
    const snapshots = await db.getAll(...refs);
    snapshots.forEach((snapshot) => {
      if (snapshot.exists) result.set(snapshot.id, snapshot.data());
    });
  }
  return result;
}

async function loadAccountingEntries(db, candidates = []) {
  const ids = [...new Set(candidates.map((candidate) => candidate.accountingEntryId).filter(Boolean))];
  const result = new Map();
  for (let index = 0; index < ids.length; index += 250) {
    const refs = ids.slice(index, index + 250).map((id) => db.collection('contabilidad_asientos').doc(id));
    if (!refs.length) continue;
    const snapshots = await db.getAll(...refs);
    snapshots.forEach((snapshot) => {
      if (snapshot.exists) result.set(snapshot.id, snapshot.data());
    });
  }
  return result;
}

function bankOutflowFromEntry(entry = {}) {
  if (normalizeKey(entry.status) !== 'POSTED' || !Array.isArray(entry.lines)) return null;
  return money(entry.lines
    .filter((line) => normalizeText(line.accountCode) === BAC_PLAN.accountCode)
    .reduce((sum, line) => sum + money(line.credit) - money(line.debit), 0));
}

function reconcileCandidates(candidates = [], accountingEntries = new Map()) {
  return candidates.map((candidate) => {
    if (candidate.applicationsMatchPayment === false || candidate.mirrorConflict) {
      return {
        ...candidate,
        reconciled: false,
        selectable: false,
        version: buildVersion({ ...candidate, reconciled: false }),
      };
    }

    const entry = accountingEntries.get(candidate.accountingEntryId);
    const bankOutflow = entry ? bankOutflowFromEntry(entry) : null;
    const expected = money(candidate.expectedBankAmount ?? candidate.netAmount);
    const reconciled = bankOutflow !== null && bankOutflow > 0 && Math.abs(bankOutflow - expected) <= 0.01;
    let reconciliationReason = '';
    if (!entry) reconciliationReason = 'Sin asiento contable para validar la salida de BAC 1102101.';
    else if (bankOutflow === null) reconciliationReason = 'El asiento no esta contabilizado o no contiene lineas validas.';
    else if (!reconciled) reconciliationReason = `La salida BAC registrada es C$ ${bankOutflow.toFixed(2)} y el pago esperado es C$ ${expected.toFixed(2)}.`;

    const next = {
      ...candidate,
      bankOutflow,
      reconciled,
      reconciliationReason,
      selectable: candidate.providerActive
        && candidate.bacReferences.length > 0
        && reconciled,
    };
    next.version = buildVersion(next);
    return next;
  });
}

function deduplicatePaymentReflections(candidates = []) {
  const unique = new Map();
  candidates.forEach((candidate) => {
    const dedupKey = candidate.sourceType === 'payable_payment' ? candidate.key : candidate.operationKey;
    const existing = unique.get(dedupKey);
    if (!existing) {
      unique.set(dedupKey, candidate);
      return;
    }
    const sources = [...new Set([...(existing.mirrorSources || []), ...(candidate.mirrorSources || [])])];
    const amountsMatch = Math.abs(money(existing.netAmount) - money(candidate.netAmount)) <= 0.01;
    unique.set(dedupKey, {
      ...existing,
      mirrorSources: sources,
      mirrorConflict: !amountsMatch,
      reconciliationReason: amountsMatch
        ? existing.reconciliationReason
        : 'Los reflejos enlazados de la misma operacion tienen importes distintos.',
      selectable: amountsMatch ? existing.selectable : false,
    });
  });
  return [...unique.values()];
}

function withinFilters(candidate, { from, to, branchId }) {
  if (!candidate?.paymentDate || candidate.paymentDate < from || candidate.paymentDate > to) return false;
  return branchId === 'all' || candidate.branchId === branchId;
}

async function listBacSupplierPayments(db, { from, to, branchId = 'all' }) {
  const [providers, purchases, expenses, payments] = await Promise.all([
    loadProviderCatalog(db),
    queryDateRange(db, 'compras', 'date', from, to),
    queryDateRange(db, 'gastos', 'date', from, to),
    queryDateRange(db, 'abonos_pagar', 'fecha', from, to),
  ]);
  const providerIndex = buildProviderIndex(providers);
  const payablesById = await loadPayables(db, payments);
  const candidates = [
    ...purchases.map((record) => buildDirectCandidate({ collectionName: 'compras', id: record.id, record, providerIndex })),
    ...expenses.map((record) => buildDirectCandidate({ collectionName: 'gastos', id: record.id, record, providerIndex })),
    ...payments.flatMap((record) => buildPayablePaymentCandidates({ id: record.id, record, providerIndex, payablesById })),
  ].filter((candidate) => candidate && withinFilters(candidate, { from, to, branchId }));
  const unique = deduplicatePaymentReflections(candidates);
  const accountingEntries = await loadAccountingEntries(db, unique);
  return reconcileCandidates(unique, accountingEntries).sort((left, right) => (
    left.paymentDate.localeCompare(right.paymentDate)
    || left.supplierName.localeCompare(right.supplierName, 'es')
    || left.key.localeCompare(right.key)
  ));
}

function clearProviderCatalogCache() {
  providerCatalogCache = null;
}

module.exports = {
  buildDirectCandidate,
  buildPayablePaymentCandidate,
  buildPayablePaymentCandidates,
  buildProviderIndex,
  clearProviderCatalogCache,
  deduplicatePaymentReflections,
  isCancelled,
  listBacSupplierPayments,
  money,
  normalizeKey,
  providerReferences,
  reconcileCandidates,
  resolveBranchId,
  resolvePaymentAccountCode,
};
