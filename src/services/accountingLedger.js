import { doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { DEFAULT_ACCOUNT_CODES } from './chartOfAccounts';
import { getCashPaidAmountAfterRetentions, isCashPayment, isCreditPayment, money, normalizePaymentMethod } from './fiscalUtils';
import { DEFAULT_BRANCH_ID, branchName, getRecordBranchId } from '../constants';

export const ACCOUNTING_ENTRIES_COLLECTION = 'contabilidad_asientos';
export const ACCOUNTING_VERSION = 1;

const ACCOUNT_CATALOG = {
    inventory: {
        code: DEFAULT_ACCOUNT_CODES.purchase,
        name: 'INVENTARIO:Alimentos',
        type: 'Activos corrientes',
    },
    expense: {
        code: DEFAULT_ACCOUNT_CODES.expense,
        name: 'COSTOS Y GASTOS',
        type: 'Gastos',
    },
    ivaCredit: {
        code: DEFAULT_ACCOUNT_CODES.ivaCredit,
        name: 'IMPUESTOS ACREDITABLES:IVA Acreditable',
        type: 'Activos corrientes',
    },
    retentionIr: {
        code: DEFAULT_ACCOUNT_CODES.retentionIr,
        name: 'IMPTOS CORRIENTES X PAGAR:Anticipo IR',
        type: 'Pasivos corrientes',
    },
    retentionMunicipal: {
        code: DEFAULT_ACCOUNT_CODES.retentionMunicipal,
        name: 'IMPTOS CORRIENTES X PAGAR:Impuestos Municipales',
        type: 'Pasivos corrientes',
    },
    payable: {
        code: DEFAULT_ACCOUNT_CODES.payable,
        name: 'CUENTAS POR PAGAR - NIO',
        type: 'Cuentas por pagar (C/P)',
    },
    pettyCash: {
        code: '11013',
        name: 'Activos Circulantes Caja:Caja Chica',
        type: 'Efectivo y equivalentes de efectivo',
    },
    bankBac: {
        code: '1102101',
        name: 'BANCOS:MONEDA NACIONAL:BAC NO. 362843534 C$',
        type: 'Efectivo y equivalentes de efectivo',
    },
    bankBanpro: {
        code: '1102102',
        name: 'BANCOS:MONEDA NACIONAL:BANPRO NO 10013500002893',
        type: 'Efectivo y equivalentes de efectivo',
    },
    bankLafise: {
        code: '1102103',
        name: 'BANCOS:MONEDA NACIONAL:LA FISE NO.106014315 C$',
        type: 'Efectivo y equivalentes de efectivo',
    },
    cardAmex: {
        code: '21029-1',
        name: 'Tarjeta de Credito - Mayor:Amex',
        type: 'Tarjeta de credito',
    },
    cardBanproBlack: {
        code: '21029-2',
        name: 'Tarjeta de Credito - Mayor:Banpro Black',
        type: 'Tarjeta de credito',
    },
};

const cleanForFirestore = (value) => {
    if (value === undefined) return null;
    if (value === null) return null;
    if (Array.isArray(value)) return value.map(cleanForFirestore);
    if (typeof value === 'object' && !(value instanceof Date)) {
        if (typeof value.toDate === 'function') return value;
        return Object.entries(value).reduce((acc, [key, entry]) => {
            if (entry !== undefined) acc[key] = cleanForFirestore(entry);
            return acc;
        }, {});
    }
    return value;
};

const normalizeEntryIdPart = (value = '') => String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90) || 'sin_id';

export const accountingEntryId = (sourceCollection, sourceDocId) => (
    `${normalizeEntryIdPart(sourceCollection)}_${normalizeEntryIdPart(sourceDocId)}`
);

export const accountingEntryRef = (sourceCollection, sourceDocId) => (
    doc(db, ACCOUNTING_ENTRIES_COLLECTION, accountingEntryId(sourceCollection, sourceDocId))
);

const accountFromRecord = (record = {}, fallback = ACCOUNT_CATALOG.expense) => ({
    code: record.accountingAccountCode || record.accountingAccountId || fallback.code,
    name: record.accountingAccountName || record.accountingAccountFullName || fallback.name,
    type: record.accountingAccountType || fallback.type || '',
    detailType: record.accountingAccountDetailType || '',
});

const resolvePaymentAccount = (paymentValue = '') => {
    const method = normalizePaymentMethod(paymentValue);
    if (method === 'EFECTIVO') return ACCOUNT_CATALOG.pettyCash;
    if (method.includes('BANPRO')) return ACCOUNT_CATALOG.bankBanpro;
    if (method.includes('LAFISE')) return ACCOUNT_CATALOG.bankLafise;
    if (method.includes('AMEX') || method.includes('PRICESMART')) return ACCOUNT_CATALOG.cardAmex;
    if (method.includes('TARJETA')) return ACCOUNT_CATALOG.cardBanproBlack;
    return ACCOUNT_CATALOG.bankBac;
};

const getRecordDate = (record = {}) => (
    record.date || record.fecha || record.saleDate || new Date().toISOString().substring(0, 10)
);

const getDocumentLabel = (record = {}) => (
    record.invoiceNumber || record.factura || record.numero || record.document || record.reference || ''
);

const getPartyName = (record = {}) => (
    record.supplier || record.proveedor || record.customerName || record.cliente || record.description || record.descripcion || ''
);

const getDescription = (record = {}, fallback = 'ASIENTO CONTABLE') => (
    String(record.description || record.descripcion || fallback || '').trim().toUpperCase()
);

const addLine = (lines, {
    account,
    debit = 0,
    credit = 0,
    description = '',
    reference = '',
    meta = {},
}) => {
    const normalizedDebit = money(debit);
    const normalizedCredit = money(credit);
    if (normalizedDebit <= 0 && normalizedCredit <= 0) return;

    lines.push(cleanForFirestore({
        lineId: `line_${String(lines.length + 1).padStart(2, '0')}`,
        accountCode: account.code,
        accountName: account.name,
        accountType: account.type || '',
        accountDetailType: account.detailType || '',
        debit: normalizedDebit,
        credit: normalizedCredit,
        description,
        reference,
        ...meta,
    }));
};

const finalizeEntry = ({
    sourceCollection,
    sourceDocId,
    sourceType,
    record,
    lines,
}) => {
    const totalDebit = money(lines.reduce((sum, line) => sum + money(line.debit), 0));
    const totalCredit = money(lines.reduce((sum, line) => sum + money(line.credit), 0));
    const difference = money(totalDebit - totalCredit);
    const branchId = getRecordBranchId(record) || DEFAULT_BRANCH_ID;

    return cleanForFirestore({
        id: accountingEntryId(sourceCollection, sourceDocId),
        sourceCollection,
        sourceDocId,
        sourceType,
        source: record.source || record.origen || 'app',
        status: Math.abs(difference) <= 0.01 ? 'posted' : 'out_of_balance',
        requiresReview: Math.abs(difference) > 0.01,
        accountingVersion: ACCOUNTING_VERSION,
        date: getRecordDate(record),
        month: String(getRecordDate(record) || '').substring(0, 7),
        branchId,
        branchName: record.branchName || branchName(branchId),
        documentSeries: record.documentSeries || record.series || '',
        documentNumber: getDocumentLabel(record),
        partyName: getPartyName(record),
        description: getDescription(record, sourceType),
        totalDebit,
        totalCredit,
        difference,
        lines,
        sourceSnapshot: {
            subtotal: money(record.subtotal ?? record.amount ?? record.montoTotal ?? record.monto),
            iva: money(record.iva),
            total: money(record.total ?? record.montoTotal ?? record.monto ?? record.amount),
            retentionIr2: money(record.retentionIr2 ?? record.retencionIr2),
            retentionMunicipal1: money(record.retentionMunicipal1 ?? record.retencionMunicipal1),
            retentionTotal: money(record.retentionTotal),
            paymentType: record.paymentType || record.paymentMethod || '',
            accountingAccountCode: record.accountingAccountCode || '',
            accountingAccountName: record.accountingAccountName || '',
        },
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
    });
};

export const buildPurchaseExpenseAccountingEntry = ({
    sourceCollection,
    sourceDocId,
    record,
    defaultDebitType = 'expense',
} = {}) => {
    const subtotal = money(record.subtotal ?? record.amount ?? record.monto);
    const iva = money(record.iva);
    const total = money(record.total ?? record.monto ?? subtotal + iva);
    const retentionIr2 = money(record.retentionIr2 ?? record.retencionIr2);
    const retentionMunicipal1 = money(record.retentionMunicipal1 ?? record.retencionMunicipal1);
    const retentionTotal = money(record.retentionTotal ?? retentionIr2 + retentionMunicipal1);
    const netPayment = getCashPaidAmountAfterRetentions({
        total,
        retentionTotal,
    });
    const paymentValue = record.paymentType || record.paymentMethod || '';
    const description = getDescription(record, defaultDebitType === 'purchase' ? 'COMPRA' : 'GASTO');
    const reference = getDocumentLabel(record);
    const lines = [];
    const debitFallback = defaultDebitType === 'purchase' ? ACCOUNT_CATALOG.inventory : ACCOUNT_CATALOG.expense;

    addLine(lines, {
        account: accountFromRecord(record, debitFallback),
        debit: subtotal,
        description,
        reference,
        meta: {
            lineRole: defaultDebitType === 'purchase' ? 'inventory_or_cost' : 'expense',
            category: record.category || record.categoria || '',
            subcategory: record.subcategory || record.subcategoria || '',
        },
    });

    addLine(lines, {
        account: ACCOUNT_CATALOG.ivaCredit,
        debit: iva,
        description: `IVA ACREDITABLE ${reference}`.trim(),
        reference,
        meta: { lineRole: 'iva_credit' },
    });

    addLine(lines, {
        account: isCreditPayment(paymentValue) ? ACCOUNT_CATALOG.payable : resolvePaymentAccount(paymentValue),
        credit: netPayment,
        description: isCreditPayment(paymentValue) ? `CUENTA POR PAGAR ${getPartyName(record)}`.trim() : `PAGO ${normalizePaymentMethod(paymentValue) || 'CONTADO'}`,
        reference,
        meta: {
            lineRole: isCreditPayment(paymentValue) ? 'accounts_payable' : 'payment',
            paymentType: paymentValue,
        },
    });

    addLine(lines, {
        account: ACCOUNT_CATALOG.retentionIr,
        credit: retentionIr2,
        description: `RETENCION ANTICIPO IR ${reference}`.trim(),
        reference,
        meta: { lineRole: 'retention_ir_2' },
    });

    addLine(lines, {
        account: ACCOUNT_CATALOG.retentionMunicipal,
        credit: retentionMunicipal1,
        description: `RETENCION MUNICIPAL ${reference}`.trim(),
        reference,
        meta: { lineRole: 'retention_municipal_1' },
    });

    return finalizeEntry({
        sourceCollection,
        sourceDocId,
        sourceType: defaultDebitType,
        record,
        lines,
    });
};

export const buildPayablePaymentAccountingEntry = ({
    sourceCollection = 'abonos_pagar',
    sourceDocId,
    record = {},
} = {}) => {
    const amount = money(record.montoTotal ?? record.monto ?? record.amount);
    const paymentValue = record.paymentMethod || record.paymentType || 'TRANSFERENCIA';
    const reference = record.secuencia ? `ABONO #${record.secuencia}` : sourceDocId;
    const partyName = getPartyName(record);
    const description = getDescription(record, `ABONO A PROVEEDOR ${partyName}`.trim());
    const lines = [];

    addLine(lines, {
        account: ACCOUNT_CATALOG.payable,
        debit: amount,
        description,
        reference,
        meta: { lineRole: 'accounts_payable_payment' },
    });

    addLine(lines, {
        account: resolvePaymentAccount(paymentValue),
        credit: amount,
        description: `PAGO ${normalizePaymentMethod(paymentValue) || 'TRANSFERENCIA'}`,
        reference,
        meta: {
            lineRole: 'payment',
            paymentType: paymentValue,
        },
    });

    return finalizeEntry({
        sourceCollection,
        sourceDocId,
        sourceType: 'payable_payment',
        record,
        lines,
    });
};

export const setAccountingEntryInBatch = (batch, entry) => {
    if (!entry?.sourceCollection || !entry?.sourceDocId || !entry.lines?.length) return;
    batch.set(accountingEntryRef(entry.sourceCollection, entry.sourceDocId), entry, { merge: false });
};

export const deleteAccountingEntryInBatch = (batch, sourceCollection, sourceDocId) => {
    if (!sourceCollection || !sourceDocId) return;
    batch.delete(accountingEntryRef(sourceCollection, sourceDocId));
};

export const deleteAccountingEntryInTransaction = (transaction, sourceCollection, sourceDocId) => {
    if (!sourceCollection || !sourceDocId) return;
    transaction.delete(accountingEntryRef(sourceCollection, sourceDocId));
};
