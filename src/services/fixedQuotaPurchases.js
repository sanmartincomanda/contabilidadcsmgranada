const money = (value) => {
    const parsed = Number(value ?? 0);
    if (!Number.isFinite(parsed)) return 0;
    return Math.round(parsed * 100) / 100;
};

export const FIXED_QUOTA_CONFIRMATION_CODE = '1234';

export const isFixedQuotaPurchase = (purchase = {}) => (
    purchase.fixedQuota === true || purchase.ivaTreatment === 'CUOTA_FIJA'
);

export const getPurchaseFinancials = (purchase = {}) => {
    const subtotal = money(purchase.subtotal ?? purchase.amount ?? purchase.monto);
    const iva = money(purchase.iva);
    const total = money(purchase.total ?? purchase.monto ?? subtotal + iva);

    return {
        amount: money(purchase.amount ?? subtotal),
        subtotal,
        subtotalExento: money(purchase.subtotalExento),
        subtotalGravado: money(purchase.subtotalGravado ?? Math.max(subtotal - money(purchase.subtotalExento), 0)),
        iva,
        total,
    };
};

export const buildFixedQuotaPurchaseAdjustment = (purchase = {}, adjustedAt = new Date().toISOString()) => {
    const current = getPurchaseFinancials(purchase);
    const originalFinancials = purchase.fixedQuotaOriginalFinancials || current;
    const totalWithoutVat = current.subtotal || current.total;

    return {
        amount: totalWithoutVat,
        subtotal: totalWithoutVat,
        subtotalExento: totalWithoutVat,
        subtotalGravado: 0,
        iva: 0,
        total: totalWithoutVat,
        fixedQuota: true,
        ivaTreatment: 'CUOTA_FIJA',
        fixedQuotaOriginalFinancials: originalFinancials,
        fixedQuotaAdjustedAt: adjustedAt,
        fixedQuotaSource: 'SISTEMA_CONTABLE',
    };
};
