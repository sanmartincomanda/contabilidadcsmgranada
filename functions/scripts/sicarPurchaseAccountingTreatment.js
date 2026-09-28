function money(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function isFixedQuota(metadata = {}) {
  return metadata.supplierTaxRegime === 'fixed-quota'
    && metadata.excludeRecoverableVat === true;
}

function buildSupplierTaxAccountingPayload(entry = {}, metadata = {}) {
  if (!isFixedQuota(metadata)) return {};

  const sicarSubtotal = money(metadata.sicarSubtotal ?? entry.subtotal ?? entry.amount);
  const sicarTaxTotal = money(metadata.sicarTaxTotal ?? entry.iva);
  const sicarTotal = money(metadata.sicarTotal ?? entry.total ?? sicarSubtotal + sicarTaxTotal);
  const accountingSubtotal = money(metadata.accountingSubtotal ?? sicarSubtotal);
  const accountingTotal = money(metadata.accountingTotal ?? accountingSubtotal);

  if (accountingSubtotal < 0 || accountingTotal < 0) {
    throw new Error('Los importes contables de cuota fija no pueden ser negativos.');
  }
  if (Math.abs(accountingTotal - accountingSubtotal) > 0.01) {
    throw new Error('Cuota fija requiere que el total contable sea igual al subtotal sin IVA.');
  }

  return {
    supplierTaxRegime: 'fixed-quota',
    excludeRecoverableVat: true,
    ivaAcreditable: 0,
    recoverableVat: 0,
    accountingSubtotal,
    accountingTaxTotal: 0,
    accountingTotal,
    sicarSubtotal,
    sicarTaxTotal,
    sicarTotal,
  };
}

function applySupplierTaxTreatment(entry = {}, accountingPayload = {}) {
  if (!isFixedQuota(accountingPayload)) {
    return { ...entry, accountingPayload };
  }

  const accountingSubtotal = money(accountingPayload.accountingSubtotal);
  const accountingTotal = money(accountingPayload.accountingTotal);

  return {
    ...entry,
    amount: accountingSubtotal,
    subtotal: accountingSubtotal,
    subtotalExento: 0,
    subtotalGravado: accountingSubtotal,
    iva: 0,
    total: accountingTotal,
    accountingPayload,
  };
}

module.exports = {
  applySupplierTaxTreatment,
  buildSupplierTaxAccountingPayload,
  isFixedQuota,
  money,
};
