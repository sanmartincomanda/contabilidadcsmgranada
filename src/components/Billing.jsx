import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { collection, deleteDoc, doc, getDoc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import {
    APP_BRAND_NAME,
    BRANCHES,
    CONSOLIDATED_BRANCH_ID,
    DEFAULT_BRANCH_ID,
    buildDocumentDisplayNumber,
    fmt,
    getBranchById,
    getBranchPayload,
    getRecordBranchId,
} from '../constants';
import { PAYMENT_METHODS, buildFiscalPayload, getSupportFiles, uploadFiscalSupportFiles, uploadSupportFile } from '../services/fiscalUtils';
import { isMasterEmail } from '../services/userAccess';

const TRANSFER_BANKS = [
    { key: 'bac', label: 'BAC' },
    { key: 'bac2', label: 'BAC (2)' },
    { key: 'banpro', label: 'Banpro' },
    { key: 'lafise', label: 'Lafise' },
    { key: 'bacUsd', label: 'BAC USD', currency: 'USD' },
    { key: 'lafiseUsd', label: 'Lafise USD', currency: 'USD' },
];

const POS_BANKS = [
    { key: 'bac', label: 'BAC' },
    { key: 'banpro', label: 'Banpro' },
    { key: 'lafise', label: 'Lafise' },
];

const BILLING_TABS = [
    { key: 'cierre', label: 'Cierre Caja' },
    { key: 'registro', label: 'Registro Contable' },
    { key: 'historial', label: 'Historial' },
    { key: 'depositos', label: 'Deposito Bancario' },
];
const BILLING_TAB_KEYS = new Set(BILLING_TABS.map((tab) => tab.key));
const BILLING_READ_ONLY_TABS = BILLING_TABS.filter((tab) => tab.key === 'historial');

function getBillingTabFromSearch(search = '') {
    const tabFromUrl = new URLSearchParams(search).get('tab');
    return BILLING_TAB_KEYS.has(tabFromUrl) ? tabFromUrl : 'cierre';
}

const CASH_DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 1];
const USD_DENOMINATIONS = [100, 50, 20, 10, 5, 1];
const CASH_DIFFERENCE_THRESHOLD = 30;
const CASH_CLOSURE_EXCHANGE_RATE = 36.50;
const TRANSFER_USD_EXCHANGE_RATE = 36.62;
const CASH_CLOSURE_EDIT_PIN = '210397';
const SICAR_CASH_CLOSURE_AVAILABLE_FROM_DATE = '2026-06-14';
const CASH_CLOSURE_POSITIVE_RC_THRESHOLD = 0.009;
const CASH_CLOSURE_POSITIVE_RC_MESSAGE = 'NO SE PUEDE REALIZAR CONCILIACION Y CIERRE DE CAJA PORQUE RC ES POSITIVO.';

const CASHIER_OPTIONS = [
    'Dania Espinoza',
    'Katherine Obando',
    'Jose Flores',
    'Nicol Barbosa',
];

const BANK_DEPOSIT_OWNER = 'LUIS MANUEL SAENZ ROBLERO';
const BANK_DEPOSIT_DEFAULT_NIO_ACCOUNT = '362705105';
const BANK_DEPOSIT_DEFAULT_USD_ACCOUNT = '366250942';
const BANK_DEPOSIT_AVAILABLE_FROM_DATE = '2026-07-07';

const BANK_DEPOSIT_NIO_ACCOUNTS = [
    { accountNumber: '362705105', bank: 'BAC', holder: BANK_DEPOSIT_OWNER, label: 'BAC 362705105 - LUIS MANUEL SAENZ ROBLERO' },
    { accountNumber: '362843534', bank: 'BAC', holder: BANK_DEPOSIT_OWNER, label: 'BAC 362843534 - LUIS MANUEL SAENZ ROBLERO' },
    { accountNumber: '10013500002893', bank: 'BANPRO', holder: BANK_DEPOSIT_OWNER, label: 'BANPRO 10013500002893 - LUIS MANUEL SAENZ ROBLERO' },
    { accountNumber: '106014315', bank: 'Lafise Bancentro', holder: BANK_DEPOSIT_OWNER, label: 'Lafise Bancentro 106014315 - LUIS MANUEL SAENZ ROBLERO' },
];

const BANK_DEPOSIT_USD_ACCOUNTS = [
    { accountNumber: '366250942', bank: 'BAC USD', holder: BANK_DEPOSIT_OWNER, label: 'BAC USD 366250942 - LUIS MANUEL SAENZ ROBLERO' },
    { accountNumber: '107233393', bank: 'Lafise Bancentro USD', holder: BANK_DEPOSIT_OWNER, label: 'Lafise Bancentro 107233393 - LUIS MANUEL SAENZ ROBLERO' },
    { accountNumber: '362785164', bank: 'BAC USD', holder: BANK_DEPOSIT_OWNER, label: 'BAC USD 362785164 - LUIS MANUEL SAENZ ROBLERO' },
];

const safeNumber = (value) => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
};

const isPlainObject = (value) => (
    value
    && typeof value === 'object'
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
);

const sanitizeFirestoreData = (value, { inArray = false } = {}) => {
    if (value === undefined || typeof value === 'function') return inArray ? null : undefined;
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeFirestoreData(item, { inArray: true }));
    }
    if (!isPlainObject(value)) return value;

    return Object.fromEntries(
        Object.entries(value)
            .map(([key, item]) => [key, sanitizeFirestoreData(item)])
            .filter(([, item]) => item !== undefined)
    );
};

const getCashClosureRcValue = (summary = {}) => safeNumber(summary?.internalRatio?.rc);

const getCashClosureRcDisplayValue = (summary = {}) => {
    const ratio = summary?.internalRatio || {};
    if (hasNumericValue(ratio.cashResidual)) return safeNumber(ratio.cashResidual);
    return Math.abs(safeNumber(ratio.rc));
};

const getRcEligibleTransferTotal = (transferTotals = {}) => safeNumber(
    (transferTotals.bac || 0)
    + (transferTotals.banpro || 0)
    + (transferTotals.lafise || 0)
    + (transferTotals.bacUsd || 0)
    + (transferTotals.lafiseUsd || 0)
);

const getRcEligibleTransferTotalFromPayment = (payment = {}) => safeNumber(
    safeNumber(payment.transferBac)
    + safeNumber(payment.transferBanpro)
    + safeNumber(payment.transferLafise)
    + safeNumber(payment.transferBacUsd)
    + safeNumber(payment.transferLafiseUsd)
);

const isPositiveCashClosureRc = (value = 0) => safeNumber(value) > CASH_CLOSURE_POSITIVE_RC_THRESHOLD;

const buildPositiveCashClosureRcMessage = (rc = 0) => `${CASH_CLOSURE_POSITIVE_RC_MESSAGE} RC ACTUAL: ${fmt(rc)}.`;

const assertCashClosureRcAllowed = (summary = {}, { shouldAlert = true } = {}) => {
    const rc = getCashClosureRcValue(summary);
    if (!isPositiveCashClosureRc(rc)) return rc;
    const message = buildPositiveCashClosureRcMessage(rc);
    if (shouldAlert) window.alert(message);
    throw new Error(message);
};

const parsePromptAmount = (value = '') => {
    const raw = String(value || '').trim().replace(/\s/g, '');
    if (!raw) return 0;
    const normalized = raw.includes(',') && raw.includes('.')
        ? raw.replace(/\./g, '').replace(',', '.')
        : raw.replace(',', '.');
    return safeNumber(normalized);
};

const getTransferBankExchangeRate = (bank = {}) => (bank.currency === 'USD' ? TRANSFER_USD_EXCHANGE_RATE : 1);

const getBankRowsTotal = (rows = [], bank = {}) => safeNumber(
    rows.reduce((sum, row) => sum + safeNumber(row.amount) * getTransferBankExchangeRate(bank), 0)
);

const getHouseDiscountTotal = (rows = []) => safeNumber(
    (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + safeNumber(row.amount ?? row.total ?? row.value), 0)
);

const requestCashClosureEditPin = (action = 'editar cierre') => {
    const pin = window.prompt(`PIN secreto para ${action}:`);
    if (pin === null) return false;
    if (String(pin).trim() !== CASH_CLOSURE_EDIT_PIN) {
        window.alert('PIN incorrecto. No se autorizo la operacion.');
        return false;
    }
    return true;
};

const todayString = () => {
    const date = new Date();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
};

const normalizeText = (value = '') => (
    String(value || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
);

const slugify = (value = '') => (
    normalizeText(value)
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 20) || 'SIN-NOMBRE'
);

const getCashierName = (record = {}) => (
    record.cashierName || record.cajero || record.cashier || ''
);

const getCashierCode = (cashierName = '') => (
    cashierName ? `CAJ-${slugify(cashierName)}` : ''
);

const getRecordCashierCode = (record = {}) => (
    record.cashierCode || record.codigoCajero || getCashierCode(getCashierName(record))
);

const isSameCashier = (record = {}, cashierName = '') => {
    const targetName = normalizeText(cashierName);
    if (!targetName) return false;
    const targetCode = normalizeText(getCashierCode(cashierName));
    return normalizeText(getCashierName(record)) === targetName
        || normalizeText(getRecordCashierCode(record)) === targetCode;
};

const getStampedInvoiceDisplayNumber = (invoice = {}) => (
    invoice.invoiceNumber || invoice.numeroFactura || invoice.document || invoice.id || invoice.docId || ''
);

const buildMissingClosureInvoiceMessage = (invoice = {}) => (
    `Fact ${getStampedInvoiceDisplayNumber(invoice) || 'sin numero'} no esta registrado en cierre.`
);

const getCashClosureCodeValue = (closure = {}) => (
    closure.linkedSicarCorId
    || closure.sicar?.corId
    || closure.sicar?.cor_id
    || closure.corId
    || closure.cor_id
    || closure.code
    || closure.id
    || ''
);

const isDaniaClosure7102 = (closure = {}) => {
    const code = String(getCashClosureCodeValue(closure) || '').trim().replace(/^0+/, '');
    return code === '7102' && normalizeText(getCashierName(closure)) === 'DANIA ESPINOZA';
};

const recordExistsByName = (records = [], name = '') => {
    const normalized = normalizeText(name);
    return Boolean(normalized) && records.some((record) => normalizeText(record.name || record.nombre) === normalized);
};

const normalizeInvoiceMatchKey = (value = '') => (
    normalizeText(value)
        .replace(/[^A-Z0-9]/g, '')
);

const getInvoiceNumberForMatch = (invoice = {}) => normalizeInvoiceMatchKey(
    invoice.numeroFactura || invoice.invoiceNumber || invoice.folio || invoice.factura || ''
);

const getInvoiceSeriesForMatch = (invoice = {}) => (
    normalizeInvoiceMatchKey(invoice.invoiceSeries || invoice.documentSeries || 'A') || 'A'
);

const getReceiptSeriesForMatch = (receipt = {}) => (
    normalizeInvoiceMatchKey(receipt.receiptSeries || receipt.documentSeries || 'A') || 'A'
);

const getFiscalDocumentMatchKey = (record = {}, documentType = 'invoice') => {
    const number = documentType === 'receipt'
        ? normalizeInvoiceMatchKey(record.receiptNumber || record.numeroRecibo || record.document || '')
        : getInvoiceNumberForMatch(record);
    if (!number) return '';
    const branchId = normalizeInvoiceMatchKey(getRecordBranchId(record));
    const series = documentType === 'receipt' ? getReceiptSeriesForMatch(record) : getInvoiceSeriesForMatch(record);
    return [documentType, branchId, series, number].filter(Boolean).join(':');
};

const getActiveBillingBranchId = (branchContext = {}) => branchContext?.selectedBranchId || DEFAULT_BRANCH_ID;

const isRecordInBillingBranch = (record = {}, branchId = DEFAULT_BRANCH_ID) => (
    getRecordBranchId(record) === branchId
);

const buildBranchScopedFiscalDocId = (prefix = 'doc', branchPayload = {}, number = '', date = todayString()) => (
    `${prefix}_${branchPayload.branchId || DEFAULT_BRANCH_ID}_${branchPayload.documentSeries || branchPayload.invoiceSeries || branchPayload.receiptSeries || 'A'}_${slugify(number)}_${String(date || todayString()).replace(/-/g, '')}`
);

const buildInvoiceDocumentFields = (invoice = {}, branchPayload = {}) => ({
    ...branchPayload,
    invoiceSeries: branchPayload.invoiceSeries || branchPayload.documentSeries || 'A',
    documentSeries: branchPayload.invoiceSeries || branchPayload.documentSeries || 'A',
    documentDisplayNumber: buildDocumentDisplayNumber({
        series: branchPayload.invoiceSeries || branchPayload.documentSeries || 'A',
        number: invoice.invoiceNumber || invoice.numeroFactura || '',
    }),
});

const buildReceiptDocumentFields = (receipt = {}, branchPayload = {}) => ({
    ...branchPayload,
    receiptSeries: branchPayload.receiptSeries || branchPayload.documentSeries || 'A',
    documentSeries: branchPayload.receiptSeries || branchPayload.documentSeries || 'A',
    documentDisplayNumber: buildDocumentDisplayNumber({
        series: branchPayload.receiptSeries || branchPayload.documentSeries || 'A',
        number: receipt.receiptNumber || receipt.numeroRecibo || '',
    }),
});

const INACTIVE_STAMPED_INVOICE_STATUSES = ['ANULADA', 'ANULADO', 'CANCELADA', 'CANCELADO', 'DELETED'];

const isActiveStampedInvoice = (invoice = {}) => (
    !INACTIVE_STAMPED_INVOICE_STATUSES.includes(normalizeText(invoice.status))
);

const getInvoiceRecordIdentityKeys = (invoice = {}) => ([
    invoice.wasExistingDoc === false ? '' : invoice.id,
    invoice.wasExistingDoc === false ? '' : invoice.docId,
    invoice.wasExistingDoc === false ? '' : invoice.accountingInvoiceId,
    invoice.wasExistingDoc === false ? '' : invoice.contabilidadInvoiceId,
    invoice.wasExistingDoc === false ? '' : invoice.membretadaInvoiceId,
])
    .map((value) => normalizeInvoiceMatchKey(value))
    .filter(Boolean);

const findStampedInvoiceNumberDuplicate = (invoices = [], invoiceNumber = '', ignoredIds = [], draft = {}) => {
    const target = getFiscalDocumentMatchKey({ ...draft, invoiceNumber }, 'invoice');
    if (!target) return null;
    const ignored = new Set(ignoredIds.map((value) => normalizeInvoiceMatchKey(value)).filter(Boolean));
    return invoices.find((invoice) => (
        isActiveStampedInvoice(invoice)
        && getFiscalDocumentMatchKey(invoice, 'invoice') === target
        && !getInvoiceRecordIdentityKeys(invoice).some((key) => ignored.has(key))
    )) || null;
};

const buildDuplicateInvoiceNumberMessage = (invoiceNumber, duplicate = {}) => {
    const details = [
        duplicate.invoiceNumber || duplicate.numeroFactura ? `factura ${duplicate.invoiceNumber || duplicate.numeroFactura}` : '',
        duplicate.customerName ? duplicate.customerName : '',
        safeNumber(duplicate.total) ? fmt(safeNumber(duplicate.total)) : '',
    ].filter(Boolean).join(' - ');
    return `Este numero de factura ya existe: ${invoiceNumber}. ${details ? `${details}. ` : ''}No se puede guardar una factura membretada duplicada.`;
};

const assertUniqueStampedInvoiceNumbers = (drafts = [], existingInvoices = []) => {
    const seen = new Map();
    drafts.forEach((draft) => {
        const invoiceNumber = String(draft.invoiceNumber || draft.numeroFactura || '').trim();
        const key = getFiscalDocumentMatchKey(draft, 'invoice');
        if (!key) return;
        const ownIds = getInvoiceRecordIdentityKeys(draft);
        const previous = seen.get(key);
        if (previous && !getInvoiceRecordIdentityKeys(previous).some((id) => ownIds.includes(id))) {
            throw new Error(`Este numero de factura ya existe: ${invoiceNumber}. No se puede guardar la misma factura dos veces en el mismo proceso.`);
        }
        seen.set(key, draft);

        const duplicate = findStampedInvoiceNumberDuplicate(existingInvoices, invoiceNumber, ownIds, draft);
        if (duplicate) {
            throw new Error(buildDuplicateInvoiceNumberMessage(invoiceNumber, duplicate));
        }
    });
};

const findCashReceiptNumberDuplicate = (receipts = [], receiptNumber = '', ignoredIds = [], draft = {}) => {
    const target = getFiscalDocumentMatchKey({ ...draft, receiptNumber }, 'receipt');
    if (!target) return null;
    const ignored = new Set(ignoredIds.map((value) => normalizeInvoiceMatchKey(value)).filter(Boolean));
    return receipts.find((receipt) => (
        !['ANULADO', 'ANULADA', 'CANCELADO', 'CANCELADA', 'DELETED'].includes(normalizeText(receipt.status))
        && getFiscalDocumentMatchKey(receipt, 'receipt') === target
        && ![receipt.id, receipt.docId, receipt.receiptId]
            .map((value) => normalizeInvoiceMatchKey(value))
            .filter(Boolean)
            .some((key) => ignored.has(key))
    )) || null;
};

const assertUniqueCashReceiptNumber = (receipt = {}, existingReceipts = [], ignoredIds = []) => {
    const receiptNumber = String(receipt.receiptNumber || receipt.numeroRecibo || '').trim();
    if (!receiptNumber) return;
    const duplicate = findCashReceiptNumberDuplicate(existingReceipts, receiptNumber, ignoredIds, receipt);
    if (duplicate) {
        const details = [
            duplicate.receiptNumber || duplicate.numeroRecibo ? `recibo ${duplicate.receiptNumber || duplicate.numeroRecibo}` : '',
            duplicate.customerName || duplicate.recibiDe || '',
            safeNumber(duplicate.amount || duplicate.cantidad) ? fmt(safeNumber(duplicate.amount || duplicate.cantidad)) : '',
        ].filter(Boolean).join(' - ');
        throw new Error(`Este numero de recibo ya existe: ${receiptNumber}. ${details ? `${details}. ` : ''}No se puede guardar duplicado en la misma sucursal/serie.`);
    }
};

const getSicarInvoiceKeys = (invoice = {}) => ([
    invoice.id,
    invoice.sourceSicarInvoiceId,
    invoice.sourceSicarId,
    invoice.sicarInvoiceId,
    invoice.sourceRecordId,
    invoice.rawId,
    invoice.facId ? `sicar_factura_${invoice.facId}` : '',
    invoice.facId ? `factura_membretada_${invoice.facId}` : '',
    invoice.facId ? String(invoice.facId) : '',
])
    .map((value) => normalizeInvoiceMatchKey(value))
    .filter(Boolean);

const getAccountingInvoiceDocKeys = (invoice = {}) => ([
    invoice.accountingInvoiceId,
    invoice.contabilidadInvoiceId,
    invoice.membretadaInvoiceId,
    ...(Array.isArray(invoice.accountingInvoiceIds) ? invoice.accountingInvoiceIds : []),
])
    .map((value) => normalizeInvoiceMatchKey(value))
    .filter(Boolean);

const isAccountingLoadedStatus = (value = '') => (
    ['CONTABILIZADA', 'CONTABILIZADO', 'CARGADA', 'CARGADO', 'LOADED', 'ACCOUNTED'].includes(normalizeText(value))
);

const CREDIT_STATUS_META = {
    pending: { label: 'Credito - Pendiente', tone: 'amber' },
    partial: { label: 'Credito - Pagada Parcial', tone: 'blue' },
    cancelled: { label: 'Credito - Cancelada', tone: 'green' },
};

const uniqueStrings = (values = []) => [...new Set(
    (Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
)];

const getInvoiceDocId = (invoice = {}) => invoice.id || invoice.docId || '';

const normalizeCreditStatusKey = (value = '') => {
    const normalized = normalizeText(value);
    if (!normalized) return '';
    if (normalized.includes('CANCEL')) return 'cancelled';
    if (normalized.includes('PARCIAL')) return 'partial';
    if (normalized.includes('PENDIENT')) return 'pending';
    return '';
};

const getInvoiceCreditOriginalAmount = (invoice = {}) => {
    const stored = invoice.creditOriginalAmount ?? invoice.originalCreditAmount ?? invoice.montoCredito ?? invoice.creditAmount;
    if (stored !== undefined && stored !== null && stored !== '') return safeNumber(stored);
    return isCreditPaymentMethod(invoice.paymentMethod) ? getInvoicePaymentTargetAmount(invoice) : 0;
};

const getInvoiceCreditPaidAmount = (invoice = {}) => safeNumber(
    invoice.creditPaidAmount
    ?? invoice.montoCobradoCredito
    ?? invoice.creditCollectedAmount
);

const getInvoiceCreditBalance = (invoice = {}) => {
    const stored = invoice.creditBalance ?? invoice.saldoCredito;
    if (stored !== undefined && stored !== null && stored !== '') return safeNumber(Math.max(stored, 0));
    return safeNumber(Math.max(getInvoiceCreditOriginalAmount(invoice) - getInvoiceCreditPaidAmount(invoice), 0));
};

const getInvoiceCreditReceiptIds = (invoice = {}) => uniqueStrings(
    invoice.creditReceiptIds
    || invoice.linkedReceiptIds
    || []
);

const getInvoiceCreditStatusKey = (invoice = {}) => {
    const stored = normalizeCreditStatusKey(invoice.creditStatus || invoice.creditStatusLabel || invoice.estadoCredito);
    if (stored) return stored;
    const original = getInvoiceCreditOriginalAmount(invoice);
    const paid = getInvoiceCreditPaidAmount(invoice);
    const balance = getInvoiceCreditBalance(invoice);
    if (balance <= 0.01 && (original > 0 || paid > 0)) return 'cancelled';
    if (paid > 0 && balance > 0.01) return 'partial';
    if (original > 0 || isCreditPaymentMethod(invoice.paymentMethod)) return 'pending';
    return '';
};

const getInvoiceCreditStatusLabel = (invoice = {}) => {
    const statusKey = getInvoiceCreditStatusKey(invoice);
    return CREDIT_STATUS_META[statusKey]?.label || '';
};

const buildCreditInvoiceSnapshot = (invoice = {}, overrides = {}) => {
    const merged = { ...invoice, ...overrides };
    if (!isCreditPaymentMethod(merged.paymentMethod)) {
        return {
            isCreditSale: false,
            creditOriginalAmount: 0,
            creditPaidAmount: 0,
            creditBalance: 0,
            creditReceiptIds: [],
            creditStatus: '',
            creditStatusLabel: '',
        };
    }

    const creditOriginalAmount = safeNumber(
        overrides.creditOriginalAmount ?? getInvoiceCreditOriginalAmount(merged)
    );
    const creditPaidAmount = safeNumber(
        overrides.creditPaidAmount ?? getInvoiceCreditPaidAmount(merged)
    );

    if (creditPaidAmount > creditOriginalAmount + 0.01) {
        throw new Error(`La factura ${merged.invoiceNumber || merged.numeroFactura || getInvoiceDocId(merged) || ''} ya tiene abonos por ${fmt(creditPaidAmount)} y no puede quedar con un saldo base menor a ${fmt(creditOriginalAmount)}.`);
    }

    const creditReceiptIds = uniqueStrings(
        overrides.creditReceiptIds ?? getInvoiceCreditReceiptIds(merged)
    );
    const creditBalance = safeNumber(Math.max(creditOriginalAmount - creditPaidAmount, 0));
    const creditStatus = creditBalance <= 0.01 && creditOriginalAmount > 0
        ? 'cancelled'
        : creditPaidAmount > 0
            ? 'partial'
            : 'pending';

    return {
        isCreditSale: true,
        creditOriginalAmount,
        creditPaidAmount,
        creditBalance,
        creditReceiptIds,
        creditStatus,
        creditStatusLabel: CREDIT_STATUS_META[creditStatus]?.label || '',
    };
};

const assertInvoiceCreditMethodChangeAllowed = (invoice = {}, nextPaymentMethod = '') => {
    if (isCreditPaymentMethod(nextPaymentMethod)) return;
    if (!isCreditPaymentMethod(invoice.paymentMethod)) return;
    const paid = getInvoiceCreditPaidAmount(invoice);
    const receiptIds = getInvoiceCreditReceiptIds(invoice);
    if (paid > 0.01 || receiptIds.length) {
        throw new Error(`La factura ${invoice.invoiceNumber || invoice.numeroFactura || getInvoiceDocId(invoice) || ''} ya tiene recibos aplicados. No puedes quitarle el metodo CREDITO mientras existan abonos.`);
    }
};

const isStampedInvoiceAnnulled = (invoice = {}) => ['ANULADA', 'ANULADO'].includes(normalizeText(invoice.status));

const assertStampedInvoiceAnnulmentAllowed = (invoice = {}) => {
    if (isStampedInvoiceAnnulled(invoice)) {
        throw new Error(`La factura ${invoice.invoiceNumber || invoice.numeroFactura || getInvoiceDocId(invoice) || ''} ya esta ANULADA.`);
    }
    const paid = getInvoiceCreditPaidAmount(invoice);
    const receiptIds = getInvoiceCreditReceiptIds(invoice);
    if (paid > 0.01 || receiptIds.length) {
        throw new Error(`La factura ${invoice.invoiceNumber || invoice.numeroFactura || getInvoiceDocId(invoice) || ''} ya tiene recibos de caja aplicados. No se puede anular mientras existan abonos.`);
    }
};

const buildAnnulledInvoiceItems = (items = []) => (
    (Array.isArray(items) ? items : []).map((item) => ({
        ...item,
        unitPriceWithoutTax: 0,
        unitPriceWithTax: 0,
        totalWithoutTax: 0,
        taxAmount: 0,
        totalWithTax: 0,
        precioSin: 0,
        precioCon: 0,
        importeSin: 0,
        importeCon: 0,
        iva: 0,
    }))
);

const buildAnnulledStampedInvoiceSnapshot = (invoice = {}, { includeServerFields = false } = {}) => {
    const base = {
        ...invoice,
        status: 'ANULADA',
        subtotal: 0,
        iva: 0,
        total: 0,
        amount: 0,
        retentionIr2: 0,
        retentionMunicipal1: 0,
        retentionTotal: 0,
        netTotal: 0,
        paymentMethod: '',
        paymentBreakdown: [],
        paymentNetTotal: 0,
        items: buildAnnulledInvoiceItems(invoice.items),
        ...buildCreditInvoiceSnapshot({ ...invoice, paymentMethod: '' }),
    };

    if (!includeServerFields) return base;

    return {
        ...base,
        annulledAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    };
};

const normalizeReceiptInvoiceApplication = (application = {}) => ({
    invoiceId: application.invoiceId || application.id || application.docId || application.facturaId || '',
    invoiceNumber: application.invoiceNumber || application.numeroFactura || application.factura || '',
    customerName: application.customerName || application.cliente || '',
    appliedAmount: safeNumber(
        application.appliedAmount
        ?? application.amount
        ?? application.monto
        ?? application.abono
    ),
    balanceBeforeApplication: safeNumber(
        application.balanceBeforeApplication
        ?? application.previousBalance
        ?? application.saldoAnterior
    ),
    remainingBalance: safeNumber(
        application.remainingBalance
        ?? application.nextBalance
        ?? application.saldoRestante
    ),
});

const getReceiptInvoiceApplications = (receipt = {}) => (
    (Array.isArray(receipt.invoiceApplications) ? receipt.invoiceApplications : Array.isArray(receipt.linkedInvoices) ? receipt.linkedInvoices : [])
        .map(normalizeReceiptInvoiceApplication)
        .filter((application) => application.invoiceId)
);

const createCashReceiptForm = () => ({
    date: todayString(),
    receiptNumber: '',
    customerName: '',
    amount: '',
    retentionIr2: '',
    retentionMunicipal1: '',
    concept: '',
    paymentMethod: '',
    reference: '',
    isOtherReceipt: false,
    invoiceApplications: [],
});

const createCashReceiptEditForm = (receipt = {}) => {
    const normalized = normalizeCashReceiptRecord(receipt);
    const invoiceApplications = getReceiptInvoiceApplications(normalized).map((application) => ({
        ...application,
        appliedAmount: String(application.appliedAmount || ''),
    }));
    return {
        ...createCashReceiptForm(),
        id: normalized.id || receipt.id || receipt.docId || '',
        date: normalized.date || todayString(),
        receiptNumber: normalized.receiptNumber || '',
        customerName: normalized.customerName || invoiceApplications[0]?.customerName || '',
        amount: String(safeNumber(normalized.amount) || ''),
        retentionIr2: String(safeNumber(normalized.retentionIr2) || ''),
        retentionMunicipal1: String(safeNumber(normalized.retentionMunicipal1) || ''),
        concept: normalized.concept || '',
        paymentMethod: normalized.paymentMethod || '',
        reference: normalized.reference || '',
        linkedCashClosureId: normalized.linkedCashClosureId || receipt.linkedCashClosureId || '',
        isOtherReceipt: Boolean(normalized.isOtherReceipt || !invoiceApplications.length),
        invoiceApplications,
    };
};

const buildLoadedInvoiceIndex = (savedInvoices = []) => {
    const sourceKeys = new Set();
    const docSourceKeys = new Map();
    const docIds = new Set();

    savedInvoices
        .filter((invoice) => !['ANULADA', 'ANULADO', 'CANCELADA', 'CANCELADO', 'DELETED'].includes(normalizeText(invoice.status)))
        .forEach((invoice) => {
            const invoiceSourceKeys = getSicarInvoiceKeys(invoice);
            invoiceSourceKeys.forEach((key) => sourceKeys.add(key));
            const docKey = normalizeInvoiceMatchKey(invoice.id || invoice.docId);
            if (docKey) {
                docIds.add(docKey);
                docSourceKeys.set(docKey, new Set(invoiceSourceKeys));
            }
        });

    return { sourceKeys, docSourceKeys, docIds };
};

const isSicarInvoicePendingAccounting = (invoice = {}, loadedIndex = buildLoadedInvoiceIndex()) => {
    const invoiceKeys = getSicarInvoiceKeys(invoice);
    if (invoiceKeys.some((key) => loadedIndex.sourceKeys.has(key))) return false;

    const accountingDocKeys = getAccountingInvoiceDocKeys(invoice);
    const accountingDocSources = accountingDocKeys
        .map((key) => loadedIndex.docSourceKeys.get(key))
        .filter(Boolean);
    if (accountingDocSources.some((sources) => invoiceKeys.some((key) => sources.has(key)))) return false;

    const explicitAccountingSourceKey = normalizeInvoiceMatchKey(invoice.accountingSourceSicarInvoiceId || invoice.accountingSicarInvoiceId);
    const hasMatchingOrLegacyAccountingDoc = accountingDocKeys.some((key) => {
        if (!loadedIndex.docIds?.has(key)) return false;
        const knownSources = loadedIndex.docSourceKeys.get(key);
        if (!knownSources || knownSources.size === 0) return true;
        return invoiceKeys.some((invoiceKey) => knownSources.has(invoiceKey));
    });
    if (
        explicitAccountingSourceKey
        && isAccountingLoadedStatus(invoice.accountingStatus || invoice.estadoContable)
        && invoiceKeys.includes(explicitAccountingSourceKey)
        && hasMatchingOrLegacyAccountingDoc
    ) {
        return false;
    }

    return true;
};

const normalizeStampedInvoiceRecord = (item = {}) => ({
    ...item,
    date: item.saleDate || item.date || '',
    invoiceNumber: item.numeroFactura || item.invoiceNumber || '',
    customerName: item.customerName || item.cliente || '',
    customerRfc: item.customerRfc || item.rfc || '',
    customerAddress: item.customerAddress || item.address || '',
    cashierName: getCashierName(item),
    cashierCode: getRecordCashierCode(item),
    paymentMethod: getInvoicePaymentMethodLabel(item),
    paymentBreakdown: normalizePaymentBreakdownRows(item.paymentBreakdown),
    paymentNetTotal: safeNumber(item.paymentNetTotal || getPaymentBreakdownTotal(item.paymentBreakdown) || getInvoicePaymentTargetAmount(item)),
    creditOriginalAmount: getInvoiceCreditOriginalAmount(item),
    creditPaidAmount: getInvoiceCreditPaidAmount(item),
    creditBalance: getInvoiceCreditBalance(item),
    creditReceiptIds: getInvoiceCreditReceiptIds(item),
    creditStatus: getInvoiceCreditStatusKey(item),
    creditStatusLabel: getInvoiceCreditStatusLabel(item),
    items: Array.isArray(item.items) ? item.items : [],
});

const getCashReceiptRetentionTotal = (receipt = {}) => safeNumber(
    receipt.retentionTotal
    ?? receipt.retencionTotal
    ?? (safeNumber(receipt.retentionIr2 || receipt.retencionIr2) + safeNumber(receipt.retentionMunicipal1 || receipt.retencionMunicipal1))
);

const getCashReceiptNetAmount = (receipt = {}) => {
    const amount = safeNumber(receipt.amount || receipt.cantidad);
    const retentionTotal = getCashReceiptRetentionTotal(receipt);
    if (retentionTotal > 0) return safeNumber(amount - retentionTotal);
    const storedNet = safeNumber(receipt.netAmount || receipt.montoNeto);
    if (storedNet > 0) return storedNet;
    return amount;
};

const normalizeCashReceiptRecord = (item = {}) => {
    const amount = safeNumber(item.amount || item.cantidad);
    const retentionIr2 = safeNumber(item.retentionIr2 || item.retencionIr2);
    const retentionMunicipal1 = safeNumber(item.retentionMunicipal1 || item.retencionMunicipal1);
    const retentionTotal = safeNumber(item.retentionTotal ?? item.retencionTotal ?? (retentionIr2 + retentionMunicipal1));
    return {
        ...item,
        id: item.id || item.docId || item.receiptId || '',
        date: item.date || item.receiptDate || '',
        month: item.month || getMonth(item.date || item.receiptDate || todayString()),
        receiptNumber: item.receiptNumber || item.numeroRecibo || '',
        customerName: item.customerName || item.recibiDe || item.cliente || '',
        amount,
        retentionIr2,
        retentionMunicipal1,
        retentionTotal,
        concept: item.concept || item.concepto || '',
        paymentMethod: item.paymentMethod || item.metodoPago || '',
        reference: item.reference || item.referencia || '',
        netAmount: getCashReceiptNetAmount({ ...item, amount, retentionIr2, retentionMunicipal1, retentionTotal }),
        linkedCashClosureId: item.linkedCashClosureId || item.cashClosureId || '',
        isOtherReceipt: Boolean(item.isOtherReceipt || normalizeText(item.receiptMode) === 'OTHER'),
        invoiceApplications: getReceiptInvoiceApplications(item),
    };
};

const isPdfSupportFile = (support = {}) => (
    `${support.url || ''} ${support.path || ''} ${support.contentType || ''}`.toLowerCase().includes('.pdf')
    || String(support.contentType || '').toLowerCase().includes('pdf')
);

const getMonth = (date = '') => String(date || todayString()).substring(0, 7);

const getRecordDate = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value.substring(0, 10);
    if (value?.toDate) return value.toDate().toISOString().substring(0, 10);
    if (value instanceof Date) return value.toISOString().substring(0, 10);
    return String(value).substring(0, 10);
};

const matchesHistoryDateFilters = (value, selectedMonth = '', selectedDate = '') => {
    const recordDate = getRecordDate(value);
    if (selectedDate) return recordDate === selectedDate;
    if (!selectedMonth) return true;
    return getMonth(recordDate) === selectedMonth;
};

const createLineId = (prefix = 'line') => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const getCashDifferencePendingAmount = (item = {}) => {
    if (['pagado', 'cerrado'].includes(String(item.status || '').toLowerCase())) return 0;
    const storedBalance = safeNumber(item.pendingAmount ?? item.saldo);
    if (storedBalance > 0) return storedBalance;
    return Math.abs(safeNumber(item.amount));
};

const getEffectiveCashDifferencePendingAmount = (item = {}) => (
    hasNumericValue(item.effectivePendingAmount)
        ? safeNumber(item.effectivePendingAmount)
        : getCashDifferencePendingAmount(item)
);

const getCashDifferenceType = (amount = 0) => (safeNumber(amount) < 0 ? 'faltante' : 'sobrante');

const getCashClosureComparableExpectedTotal = (sicarExpected = 0) => safeNumber(sicarExpected);

const getCashClosureManualTotalWithRetentions = (manualTotal = 0, retentionAdjustment = 0) => (
    safeNumber(safeNumber(manualTotal) + safeNumber(retentionAdjustment))
);

const getCashClosureDifference = (manualTotal = 0, sicarExpected = 0, retentionAdjustment = 0) => (
    safeNumber(getCashClosureManualTotalWithRetentions(manualTotal, retentionAdjustment) - getCashClosureComparableExpectedTotal(sicarExpected))
);

const getCashClosureStatusFromDifference = (currentStatus = '', difference = 0) => {
    const normalizedStatus = String(currentStatus || '').toLowerCase();
    if (['en_espera', 'anulado', 'anulada'].includes(normalizedStatus)) return normalizedStatus;
    return Math.abs(safeNumber(difference)) > CASH_DIFFERENCE_THRESHOLD ? 'con_diferencia' : 'cuadrado';
};

const normalizeCashClosureStoredTotals = (closure = {}) => {
    const manualTotal = safeNumber(closure.manualTotal);
    const retentionAdjustment = safeNumber(closure.retentionAdjustment);
    const sicarExpected = safeNumber(closure.sicarExpected);
    const expectedAfterRetentions = getCashClosureComparableExpectedTotal(sicarExpected);
    const manualTotalWithRetentions = getCashClosureManualTotalWithRetentions(manualTotal, retentionAdjustment);
    const difference = getCashClosureDifference(manualTotal, sicarExpected, retentionAdjustment);
    return {
        manualTotal,
        manualTotalWithRetentions,
        retentionAdjustment,
        sicarExpected,
        expectedAfterRetentions,
        difference,
        status: getCashClosureStatusFromDifference(closure.status || 'cerrado', difference),
    };
};

const getReconciledCashDifferencePendingAmount = (item = {}, closureIndex = new Map()) => {
    const closureId = item.closureId || '';
    const closure = closureId ? closureIndex.get(closureId) : null;
    if (!closure) return getCashDifferencePendingAmount(item);

    const totals = normalizeCashClosureStoredTotals(closure);
    if (['en_espera', 'anulado', 'anulada'].includes(totals.status)) return 0;
    if (Math.abs(totals.difference) <= CASH_DIFFERENCE_THRESHOLD) return 0;

    const paidAmount = safeNumber(item.paidAmount);
    return safeNumber(Math.max(Math.abs(totals.difference) - paidAmount, 0));
};

const MIXED_PAYMENT_METHOD = 'MIXTO';

const isCreditPaymentMethod = (method = '') => normalizeText(method).includes('CREDITO');

const getInvoicePaymentTargetAmount = (invoice = {}) => {
    const total = safeNumber(invoice.total || safeNumber(invoice.subtotal) + safeNumber(invoice.iva));
    const retentions = safeNumber(invoice.retentionTotal ?? (safeNumber(invoice.retentionIr2) + safeNumber(invoice.retentionMunicipal1)));
    const net = safeNumber(total - retentions);
    return net > 0 ? net : total;
};

const normalizePaymentBreakdownRows = (rows = []) => (
    (Array.isArray(rows) ? rows : [])
        .map((row) => ({
            id: row.id || row.localId || createLineId('payment'),
            method: String(row.method || row.paymentMethod || '').trim(),
            amount: safeNumber(row.amount),
            reference: String(row.reference || '').trim(),
        }))
        .filter((row) => row.method && row.amount > 0)
);

const getPaymentBreakdownTotal = (rows = []) => safeNumber(
    normalizePaymentBreakdownRows(rows).reduce((sum, row) => sum + safeNumber(row.amount), 0)
);

const getPaymentMethodFromBreakdown = (rows = [], fallback = '') => {
    const normalizedRows = normalizePaymentBreakdownRows(rows);
    if (normalizedRows.length > 1) return MIXED_PAYMENT_METHOD;
    if (normalizedRows.length === 1) return normalizedRows[0].method;
    return fallback || '';
};

const validatePaymentBreakdownForInvoice = (invoice = {}) => {
    const rows = normalizePaymentBreakdownRows(invoice.paymentBreakdown);
    if (!rows.length) return [];
    const target = getInvoicePaymentTargetAmount(invoice);
    const paid = getPaymentBreakdownTotal(rows);
    if (target <= 0) {
        throw new Error(`La factura ${invoice.invoiceNumber || ''} necesita total para dividir el pago.`);
    }
    if (Math.abs(paid - target) > 0.05) {
        throw new Error(`El pago dividido de la factura ${invoice.invoiceNumber || ''} debe sumar ${fmt(target)}. Actualmente suma ${fmt(paid)}.`);
    }
    return rows;
};

const getPaymentBreakdownLabel = (invoice = {}) => {
    const rows = normalizePaymentBreakdownRows(invoice.paymentBreakdown);
    if (!rows.length) return invoice.paymentMethod || '';
    return rows.map((row) => `${row.method} ${fmt(row.amount)}`).join(' / ');
};

const getInvoicePaymentMethodLabel = (invoice = {}) => (
    normalizePaymentBreakdownRows(invoice.paymentBreakdown).length > 1
        ? MIXED_PAYMENT_METHOD
        : (getPaymentMethodFromBreakdown(invoice.paymentBreakdown, invoice.paymentMethod) || invoice.paymentMethod || '')
);

const getInvoicePaymentRows = (invoice = {}) => {
    const rows = normalizePaymentBreakdownRows(invoice.paymentBreakdown);
    if (rows.length) return rows;
    const method = String(invoice.paymentMethod || '').trim();
    if (!method) return [];
    return [{ id: `${method}-${invoice.id || invoice.docId || ''}`, method, amount: getInvoicePaymentTargetAmount(invoice), reference: '' }];
};

const hasNumericValue = (value) => value !== undefined && value !== null && value !== '';

const firstNumber = (...values) => {
    const found = values.find(hasNumericValue);
    return safeNumber(found);
};

const getNetSicarSalesTotals = (closure = {}) => {
    const cashGross = firstNumber(closure.cashSalesGrossTotal, closure.grossCashSalesTotal, closure.ventasContadoBruto, closure.cashSalesTotal, closure.ventasContado, closure.venCon);
    const cashCancelled = firstNumber(closure.cancelledCashSalesTotal, closure.cashSalesCancelledTotal, closure.ventasCanceladas, closure.venConC);
    const creditGross = firstNumber(closure.creditSalesGrossTotal, closure.grossCreditSalesTotal, closure.ventasCreditoBruto, closure.creditSalesTotal, closure.ventasCredito, closure.venCre);
    const creditCancelled = firstNumber(closure.cancelledCreditSalesTotal, closure.creditSalesCancelledTotal, closure.ventasCreditoCanceladas, closure.venCreC);
    const cashNet = hasNumericValue(closure.cashSalesNetTotal)
        ? safeNumber(closure.cashSalesNetTotal)
        : safeNumber(cashGross - cashCancelled);
    const creditNet = hasNumericValue(closure.creditSalesNetTotal)
        ? safeNumber(closure.creditSalesNetTotal)
        : safeNumber(creditGross - creditCancelled);

    return {
        cashSalesGrossTotal: cashGross,
        cancelledCashSalesTotal: cashCancelled,
        cashSalesNetTotal: cashNet,
        creditSalesGrossTotal: creditGross,
        cancelledCreditSalesTotal: creditCancelled,
        creditSalesNetTotal: creditNet,
    };
};

const buildClosureAccountingSummary = ({
    cashSalesTotal = 0,
    creditSalesTotal = 0,
    creditRecoveryTotal = 0,
    stampedInvoices = [],
    cashReceipts = [],
    transferTotals = {},
    posTotals = {},
    cashCordobasTotal = 0,
    dollarCashTotalCordobas = 0,
    preCloseDepositTotal = 0,
    houseDiscountTotal = 0,
} = {}) => {
    const stampedCashTotal = safeNumber(stampedInvoices.reduce((sum, invoice) => (
        sum + getInvoicePaymentRows(invoice).reduce((paymentSum, row) => (
            paymentSum + (!isCreditPaymentMethod(row.method) ? safeNumber(row.amount) : 0)
        ), 0)
    ), 0));
    const stampedCreditTotal = safeNumber(stampedInvoices.reduce((sum, invoice) => (
        sum + getInvoicePaymentRows(invoice).reduce((paymentSum, row) => (
            paymentSum + (isCreditPaymentMethod(row.method) ? safeNumber(row.amount) : 0)
        ), 0)
    ), 0));
    const stampedInvoiceRetentionTotal = safeNumber(stampedInvoices.reduce((sum, invoice) => (
        sum + safeNumber(invoice.retentionTotal ?? (safeNumber(invoice.retentionIr2) + safeNumber(invoice.retentionMunicipal1)))
    ), 0));
    const cashReceiptGrossTotal = safeNumber(cashReceipts.reduce((sum, receipt) => sum + safeNumber(receipt.amount), 0));
    const cashReceiptRetentionTotal = safeNumber(cashReceipts.reduce((sum, receipt) => sum + getCashReceiptRetentionTotal(receipt), 0));
    const cashReceiptNetTotal = safeNumber(cashReceipts.reduce((sum, receipt) => sum + getCashReceiptNetAmount(receipt), 0));
    const cashIncomeNetTotal = safeNumber(stampedCashTotal + cashReceiptNetTotal);
    const ticketCashSales = safeNumber(cashSalesTotal - stampedCashTotal);
    const ticketCreditSales = safeNumber(creditSalesTotal - stampedCreditTotal);
    const ticketCashReceipts = safeNumber(creditRecoveryTotal - cashReceiptGrossTotal);
    const cardTotal = safeNumber((posTotals.bac || 0) + (posTotals.banpro || 0) + (posTotals.lafise || 0));
    const transferTotal = safeNumber(
        (transferTotals.bac || 0)
        + (transferTotals.bac2 || 0)
        + (transferTotals.banpro || 0)
        + (transferTotals.lafise || 0)
        + (transferTotals.bacUsd || 0)
        + (transferTotals.lafiseUsd || 0)
    );
    const rcEligibleTransferTotal = getRcEligibleTransferTotal(transferTotals);
    const cashTotal = safeNumber(cashCordobasTotal + dollarCashTotalCordobas + preCloseDepositTotal);
    const houseDiscount = safeNumber(houseDiscountTotal);
    const rc = safeNumber(cardTotal + rcEligibleTransferTotal + houseDiscount - cashIncomeNetTotal);
    const cashResidual = safeNumber(cashIncomeNetTotal - cardTotal - rcEligibleTransferTotal - houseDiscount);

    return {
        general: {
            cashSalesTotal: safeNumber(cashSalesTotal),
            creditSalesTotal: safeNumber(creditSalesTotal),
            creditRecoveryTotal: safeNumber(creditRecoveryTotal),
        },
        stampedDocuments: {
            stampedCashInvoices: stampedCashTotal,
            stampedCreditInvoices: stampedCreditTotal,
            stampedInvoiceRetentions: stampedInvoiceRetentionTotal,
            stampedCashReceipts: cashReceiptGrossTotal,
            stampedCashReceiptsNet: cashReceiptNetTotal,
            stampedCashReceiptRetentions: cashReceiptRetentionTotal,
            stampedCashIncomeNetTotal: cashIncomeNetTotal,
        },
        sicarTickets: {
            cashSalesTickets: ticketCashSales,
            creditSalesTickets: ticketCreditSales,
            cashReceiptTickets: ticketCashReceipts,
        },
        paymentBreakdown: {
            cardTotal,
            posBac: safeNumber(posTotals.bac),
            posBanpro: safeNumber(posTotals.banpro),
            posLafise: safeNumber(posTotals.lafise),
            transferTotal,
            transferBac: safeNumber(transferTotals.bac),
            transferBac2: safeNumber(transferTotals.bac2),
            transferBanpro: safeNumber(transferTotals.banpro),
            transferLafise: safeNumber(transferTotals.lafise),
            transferBacUsd: safeNumber(transferTotals.bacUsd),
            transferLafiseUsd: safeNumber(transferTotals.lafiseUsd),
            rcEligibleTransferTotal,
            houseDiscountTotal: houseDiscount,
            cashTotal,
            cashCordobas: safeNumber(cashCordobasTotal),
            cashDollarsConverted: safeNumber(dollarCashTotalCordobas),
            preCloseDepositTotal: safeNumber(preCloseDepositTotal),
        },
        internalRatio: {
            rc,
            cashResidual,
            formula: 'Tarjeta + transferencias sin BAC (2) + descuentos casa - flujo de caja',
        },
    };
};

const normalizeClosureAccountingSummarySales = (summary = {}, netSalesTotals = {}, closure = {}) => {
    const stamped = summary.stampedDocuments || {};
    const payment = summary.paymentBreakdown || {};
    const creditRecoveryTotal = safeNumber(summary.general?.creditRecoveryTotal);
    const cashSalesTotal = safeNumber(netSalesTotals.cashSalesNetTotal);
    const creditSalesTotal = safeNumber(netSalesTotals.creditSalesNetTotal);
    const stampedCashInvoices = safeNumber(stamped.stampedCashInvoices);
    const stampedCreditInvoices = safeNumber(stamped.stampedCreditInvoices);
    const stampedCashReceipts = safeNumber(stamped.stampedCashReceipts);
    const closureStampedInvoices = Array.isArray(closure.stampedInvoices) && closure.stampedInvoices.length
        ? closure.stampedInvoices
        : Array.isArray(closure.stampedInvoiceDrafts) ? closure.stampedInvoiceDrafts : [];
    const stampedInvoiceRetentionTotal = hasNumericValue(stamped.stampedInvoiceRetentions)
        ? safeNumber(stamped.stampedInvoiceRetentions)
        : safeNumber(closureStampedInvoices.reduce((sum, invoice) => (
            sum + safeNumber(invoice.retentionTotal ?? (safeNumber(invoice.retentionIr2) + safeNumber(invoice.retentionMunicipal1)))
        ), 0));
    const stampedCashReceiptsNet = hasNumericValue(stamped.stampedCashReceiptsNet)
        ? safeNumber(stamped.stampedCashReceiptsNet)
        : safeNumber(stampedCashReceipts - safeNumber(stamped.stampedCashReceiptRetentions));
    const cashIncomeNetTotal = safeNumber(stampedCashInvoices + stampedCashReceiptsNet);
    const cardTotal = safeNumber(payment.cardTotal);
    const transferTotal = hasNumericValue(payment.transferTotal)
        ? safeNumber(payment.transferTotal)
        : safeNumber(
            safeNumber(payment.transferBac)
            + safeNumber(payment.transferBac2)
            + safeNumber(payment.transferBanpro)
            + safeNumber(payment.transferLafise)
            + safeNumber(payment.transferBacUsd)
            + safeNumber(payment.transferLafiseUsd)
        );
    const rcEligibleTransferTotal = hasNumericValue(payment.rcEligibleTransferTotal)
        ? safeNumber(payment.rcEligibleTransferTotal)
        : getRcEligibleTransferTotalFromPayment(payment);
    const houseDiscountTotal = safeNumber(payment.houseDiscountTotal ?? closure.houseDiscountTotal ?? getHouseDiscountTotal(closure.houseDiscountDetails));
    const rc = safeNumber(cardTotal + rcEligibleTransferTotal + houseDiscountTotal - cashIncomeNetTotal);
    const cashResidual = safeNumber(cashIncomeNetTotal - cardTotal - rcEligibleTransferTotal - houseDiscountTotal);
    const ratioFormula = normalizeText(summary.internalRatio?.formula || '');
    const shouldUseRecalculatedRc = ratioFormula.includes('TOTAL INGRESO DE CAJA')
        || ratioFormula.includes('CON RETENCIONES')
        || isDaniaClosure7102(closure);
    const cashCordobas = safeNumber(payment.cashCordobas ?? closure.cashCordobasTotal);
    const cashDollarsConverted = safeNumber(payment.cashDollarsConverted ?? closure.dollarCashTotalCordobas);
    const preCloseDepositTotal = safeNumber(payment.preCloseDepositTotal ?? closure.preCloseDepositTotal ?? closure.preCloseDeposit?.totalCordobas);

    return {
        ...summary,
        general: {
            ...(summary.general || {}),
            cashSalesTotal,
            creditSalesTotal,
        },
        sicarTickets: {
            ...(summary.sicarTickets || {}),
            cashSalesTickets: safeNumber(cashSalesTotal - stampedCashInvoices),
            creditSalesTickets: safeNumber(creditSalesTotal - stampedCreditInvoices),
            cashReceiptTickets: safeNumber(creditRecoveryTotal - stampedCashReceipts),
        },
        stampedDocuments: {
            ...stamped,
            ...(shouldUseRecalculatedRc ? {
                stampedInvoiceRetentions: stampedInvoiceRetentionTotal,
                stampedCashReceiptsNet,
                stampedCashIncomeNetTotal: cashIncomeNetTotal,
            } : {}),
        },
        paymentBreakdown: {
            ...payment,
            transferTotal,
            rcEligibleTransferTotal,
            houseDiscountTotal,
            cashTotal: safeNumber(cashCordobas + cashDollarsConverted + preCloseDepositTotal),
            cashCordobas,
            cashDollarsConverted,
            preCloseDepositTotal,
        },
        internalRatio: {
            ...(summary.internalRatio || {}),
            rc,
            cashResidual,
            formula: 'Tarjeta + transferencias sin BAC (2) + descuentos casa - flujo de caja',
        },
    };
};

const isInvoiceExcludedFromCashClosureSelection = (invoice = {}) => {
    const status = normalizeText(invoice.cashClosureLinkStatus || invoice.closureStatus || '');
    return Boolean(
        invoice.excludeFromCashClosure
        || invoice.excludedFromCashClosure
        || invoice.linkedCashClosureId
        || invoice.linkedSicarClosureId
        || ['SIN CIERRE', 'SIN_CIERRE', 'CONCILIADA', 'CONCILIADO', 'EN CIERRE', 'EN_CIERRE'].includes(status)
    );
};

const getClosureLabel = (closure = {}) => {
    if (!closure?.id) return '';
    const code = closure.linkedSicarCorId || closure.sicar?.corId || closure.sicar?.cor_id || closure.id;
    const date = closure.date || '-';
    const cashbox = closure.sicar?.cashboxName || closure.sicar?.cajaName || closure.cashboxName || closure.cajaName || 'Caja';
    return `Cierre ${code} · ${date} · ${cashbox}`;
};

const getInvoiceClosureInfo = (invoice = {}, closureIndex = new Map()) => {
    const status = normalizeText(invoice.cashClosureLinkStatus || invoice.closureStatus);
    if (['SIN CIERRE', 'SIN_CIERRE', 'SIN-CIERRE'].includes(status) || invoice.excludeFromCashClosure || invoice.excludedFromCashClosure) {
        return { status: 'sin_cierre', label: 'Sin cierre de caja vinculado' };
    }

    const closureId = invoice.linkedCashClosureId || invoice.cashClosureId || '';
    if (!closureId) return { status: 'pendiente', label: 'Pendiente de vincular' };

    const closure = closureIndex.get(closureId);
    if (!closure || normalizeText(closure.status) === 'EN_ESPERA' || normalizeText(closure.status) === 'EN ESPERA') {
        return { status: 'pendiente', label: 'Pendiente de vincular' };
    }

    return {
        status: 'vinculada',
        label: closure ? getClosureLabel(closure) : `Cierre ${closureId}`,
    };
};

const addClosureMatchKey = (set, type, value, date = '') => {
    const normalizedValue = normalizeText(value);
    if (!normalizedValue) return;
    const normalizedDate = String(date || '').substring(0, 10);
    set.add(`${type}:${normalizedValue}`);
    if (normalizedDate) set.add(`${type}:${normalizedDate}:${normalizedValue}`);
};

const getSicarClosureMatchKeys = (closure = {}) => {
    const keys = new Set();
    const date = closure.date || getRecordDate(closure.closureDateTime || closure.fecha);
    addClosureMatchKey(keys, 'id', closure.id, date);
    addClosureMatchKey(keys, 'cor', closure.corId || closure.cor_id, date);
    addClosureMatchKey(keys, 'rcc', closure.rccId || closure.rcc_id, date);
    return keys;
};

const getSavedClosureSicarMatchKeys = (closure = {}) => {
    const keys = new Set();
    const date = closure.date || getRecordDate(closure.createdAt || closure.updatedAt);
    addClosureMatchKey(keys, 'id', closure.linkedSicarClosureId || closure.sicar?.id, date);
    addClosureMatchKey(keys, 'cor', closure.linkedSicarCorId || closure.sicar?.corId || closure.sicar?.cor_id, date);
    addClosureMatchKey(keys, 'rcc', closure.linkedSicarRccId || closure.sicar?.rccId || closure.sicar?.rcc_id, date);
    return keys;
};

const isSicarClosureHiddenFromCashClosure = (closure = {}) => {
    const status = normalizeText(closure.status || closure.estado || closure.closureStatus || '');
    return Boolean(
        closure.excludeFromCashClosure
        || closure.hiddenFromCashClosure
        || closure.isVoided
        || ['ANULADA', 'ANULADO', 'VOID', 'VOIDED', 'HIDDEN', 'OCULTA', 'OCULTO'].includes(status)
    );
};

const emptyTransfer = () => ({ localId: createLineId('transfer'), clientName: '', amount: '', reference: '' });
const emptyPos = () => ({ localId: createLineId('pos'), amount: '', reference: '' });
const emptyHouseDiscount = () => ({ localId: createLineId('house_discount'), description: '', amount: '' });

const normalizeHouseDiscountDetails = (details = []) => (
    (Array.isArray(details) ? details : []).map((row, index) => ({
        localId: row.localId || row.id || `house_discount_${index}`,
        description: row.description || row.descripcion || row.concept || row.concepto || '',
        amount: row.amount ?? row.total ?? row.value ?? '',
    }))
);

const createInvoiceDraft = (invoice = {}, fallbackDate = todayString()) => {
    const date = invoice.saleDate || invoice.date || fallbackDate;
    const invoiceNumber = invoice.numeroFactura || invoice.invoiceNumber || '';
    const subtotal = safeNumber(invoice.subtotal ?? invoice.amount);
    const iva = safeNumber(invoice.iva);
    const total = safeNumber(invoice.total || subtotal + iva);
    const invoiceBranchPayload = getBranchPayload(getRecordBranchId(invoice), 'invoice');
    const wasExistingDoc = invoice.wasExistingDoc !== undefined
        ? Boolean(invoice.wasExistingDoc)
        : Boolean(invoice.id || invoice.docId);

    return {
        ...invoiceBranchPayload,
        localId: invoice.localId || createLineId('invoice'),
        docId: invoice.id || invoice.docId || '',
        wasExistingDoc,
        date,
        invoiceNumber,
        customerName: invoice.customerName || invoice.cliente || '',
        cashierName: getCashierName(invoice),
        cashierCode: getRecordCashierCode(invoice),
        paymentMethod: getInvoicePaymentMethodLabel(invoice),
        paymentBreakdown: normalizePaymentBreakdownRows(invoice.paymentBreakdown),
        paymentNetTotal: safeNumber(invoice.paymentNetTotal || getPaymentBreakdownTotal(invoice.paymentBreakdown) || getInvoicePaymentTargetAmount(invoice)),
        subtotal: subtotal ? String(subtotal) : '',
        iva: iva ? String(iva) : '',
        total: total ? String(total) : '',
        retentionIr2: safeNumber(invoice.retentionIr2) ? String(safeNumber(invoice.retentionIr2)) : '',
        retentionMunicipal1: safeNumber(invoice.retentionMunicipal1) ? String(safeNumber(invoice.retentionMunicipal1)) : '',
        sourceSicarInvoiceId: invoice.sourceSicarInvoiceId || invoice.sourceSicarId || '',
        status: invoice.status || 'active',
        supportFiles: {},
    };
};

const createCashReceiptDraft = (receipt = {}, fallbackDate = todayString()) => {
    const normalized = normalizeCashReceiptRecord(receipt);
    const docId = receipt.id || receipt.docId || receipt.receiptId || '';

    return {
        ...normalized,
        localId: receipt.localId || createLineId('receipt'),
        id: docId,
        docId,
        date: normalized.date || fallbackDate,
        receiptNumber: normalized.receiptNumber || receipt.numeroRecibo || '',
        customerName: normalized.customerName || receipt.recibiDe || '',
        amount: safeNumber(normalized.amount),
        retentionIr2: safeNumber(normalized.retentionIr2),
        retentionMunicipal1: safeNumber(normalized.retentionMunicipal1),
        retentionTotal: safeNumber(normalized.retentionTotal),
        concept: normalized.concept || '',
        paymentMethod: normalized.paymentMethod || '',
        netAmount: safeNumber(normalized.netAmount),
        linkedCashClosureId: normalized.linkedCashClosureId || '',
        isOtherReceipt: Boolean(normalized.isOtherReceipt),
        invoiceApplications: (normalized.invoiceApplications || []).map((application) => ({
            ...application,
            appliedAmount: safeNumber(application.appliedAmount),
        })),
    };
};

const syncLinkedClosureForCashReceipt = async (receiptId = '', receiptPayload = {}) => {
    const linkedCashClosureId = receiptPayload.linkedCashClosureId || receiptPayload.cashClosureId || '';
    if (!receiptId || !linkedCashClosureId) return;

    const closureRef = doc(db, 'cierres_caja', linkedCashClosureId);
    const closureSnap = await getDoc(closureRef);
    if (!closureSnap.exists()) return;

    const closure = closureSnap.data() || {};
    const matchesReceipt = (receipt = {}) => [receipt.id, receipt.docId, receipt.receiptId]
        .filter(Boolean)
        .includes(receiptId);
    const mergeReceipt = (receipt = {}) => (
        matchesReceipt(receipt)
            ? normalizeCashReceiptRecord({ ...receipt, ...receiptPayload, id: receipt.id || receiptId, docId: receipt.docId || receiptId })
            : receipt
    );
    const cashReceipts = Array.isArray(closure.cashReceipts) ? closure.cashReceipts.map(mergeReceipt) : [];
    const cashReceiptDrafts = Array.isArray(closure.cashReceiptDrafts) ? closure.cashReceiptDrafts.map(mergeReceipt) : [];
    const receiptsForTotals = cashReceipts.length ? cashReceipts : cashReceiptDrafts;
    const invoiceRetentionTotal = (closure.stampedInvoices || []).reduce((sum, invoice) => (
        safeNumber(sum + safeNumber(invoice.retentionTotal || safeNumber(invoice.retentionIr2) + safeNumber(invoice.retentionMunicipal1)))
    ), 0);
    const cashReceiptRetentionTotal = receiptsForTotals.reduce((sum, receipt) => (
        safeNumber(sum + getCashReceiptRetentionTotal(receipt))
    ), 0);
    const cashReceiptGrossTotal = receiptsForTotals.reduce((sum, receipt) => (
        safeNumber(sum + safeNumber(receipt.amount))
    ), 0);
    const cashReceiptNetTotal = receiptsForTotals.reduce((sum, receipt) => (
        safeNumber(sum + getCashReceiptNetAmount(receipt))
    ), 0);
    const retentionAdjustment = safeNumber(invoiceRetentionTotal + cashReceiptRetentionTotal);
    const sicarExpected = safeNumber(closure.sicarExpected);
    const manualTotal = safeNumber(closure.manualTotal);
    const expectedAfterRetentions = getCashClosureComparableExpectedTotal(sicarExpected);
    const difference = getCashClosureDifference(manualTotal, sicarExpected, retentionAdjustment);
    const payment = closure.accountingSummary?.paymentBreakdown || {};
    const stamped = closure.accountingSummary?.stampedDocuments || {};
    const cashIncomeNetTotal = safeNumber(safeNumber(stamped.stampedCashInvoices) + cashReceiptNetTotal);
    const rcEligibleTransferTotal = hasNumericValue(payment.rcEligibleTransferTotal)
        ? safeNumber(payment.rcEligibleTransferTotal)
        : getRcEligibleTransferTotalFromPayment(payment);
    const houseDiscountTotal = safeNumber(payment.houseDiscountTotal ?? closure.houseDiscountTotal ?? getHouseDiscountTotal(closure.houseDiscountDetails));
    const rc = safeNumber(safeNumber(payment.cardTotal) + rcEligibleTransferTotal + houseDiscountTotal - cashIncomeNetTotal);
    const cashResidual = safeNumber(cashIncomeNetTotal - safeNumber(payment.cardTotal) - rcEligibleTransferTotal - houseDiscountTotal);
    const accountingSummary = closure.accountingSummary ? {
        ...closure.accountingSummary,
        stampedDocuments: {
            ...(closure.accountingSummary.stampedDocuments || {}),
            stampedInvoiceRetentions: invoiceRetentionTotal,
            stampedCashReceipts: cashReceiptGrossTotal,
            stampedCashReceiptsNet: cashReceiptNetTotal,
            stampedCashReceiptRetentions: cashReceiptRetentionTotal,
            stampedCashIncomeNetTotal: cashIncomeNetTotal,
        },
        sicarTickets: {
            ...(closure.accountingSummary.sicarTickets || {}),
            cashReceiptTickets: safeNumber(safeNumber(closure.accountingSummary.general?.creditRecoveryTotal) - cashReceiptGrossTotal),
        },
        paymentBreakdown: {
            ...(closure.accountingSummary.paymentBreakdown || {}),
            houseDiscountTotal,
        },
        internalRatio: {
            ...(closure.accountingSummary.internalRatio || {}),
            rc,
            cashResidual,
            formula: 'Tarjeta + transferencias sin BAC (2) + descuentos casa - flujo de caja',
        },
    } : null;

    await setDoc(closureRef, {
        ...(cashReceipts.length ? { cashReceipts } : {}),
        ...(cashReceiptDrafts.length ? { cashReceiptDrafts } : {}),
        retentionAdjustment,
        expectedAfterRetentions,
        manualTotalWithRetentions: getCashClosureManualTotalWithRetentions(manualTotal, retentionAdjustment),
        difference,
        ...(accountingSummary ? { accountingSummary } : {}),
        updatedAt: serverTimestamp(),
    }, { merge: true });
};

const syncLinkedClosureForStampedInvoice = async (invoiceId = '', invoicePayload = {}) => {
    const linkedCashClosureId = invoicePayload.linkedCashClosureId || invoicePayload.cashClosureId || '';
    if (!invoiceId || !linkedCashClosureId) return;

    const closureRef = doc(db, 'cierres_caja', linkedCashClosureId);
    const closureSnap = await getDoc(closureRef);
    if (!closureSnap.exists()) return;

    const closure = closureSnap.data() || {};
    const matchesInvoice = (invoice = {}) => [invoice.id, invoice.docId]
        .filter(Boolean)
        .includes(invoiceId);
    const mergeInvoice = (invoice = {}) => (
        matchesInvoice(invoice)
            ? normalizeStampedInvoiceRecord({ ...invoice, ...invoicePayload, id: invoice.id || invoiceId, docId: invoice.docId || invoiceId })
            : invoice
    );
    const stampedInvoices = Array.isArray(closure.stampedInvoices) ? closure.stampedInvoices.map(mergeInvoice) : [];
    const stampedInvoiceDrafts = Array.isArray(closure.stampedInvoiceDrafts) ? closure.stampedInvoiceDrafts.map(mergeInvoice) : [];
    const invoicesForTotals = stampedInvoices.length ? stampedInvoices : stampedInvoiceDrafts;
    const cashReceipts = getCashClosureReceipts(closure);
    const netSalesTotals = getNetSicarSalesTotals({ ...(closure.sicar || {}), ...closure });
    const accountingSummary = buildClosureAccountingSummary({
        cashSalesTotal: netSalesTotals.cashSalesNetTotal,
        creditSalesTotal: netSalesTotals.creditSalesNetTotal,
        creditRecoveryTotal: safeNumber(closure.creditRecoveryTotal || closure.sicar?.creditRecoveryTotal || closure.sicar?.recuperacionCredito || closure.sicar?.entCre),
        stampedInvoices: invoicesForTotals,
        cashReceipts,
        transferTotals: closure.transferTotals || {},
        posTotals: closure.posTotals || {},
        houseDiscountTotal: closure.houseDiscountTotal ?? getHouseDiscountTotal(closure.houseDiscountDetails),
        cashCordobasTotal: closure.cashCordobasTotal,
        dollarCashTotalCordobas: closure.dollarCashTotalCordobas,
        preCloseDepositTotal: closure.preCloseDepositTotal || closure.preCloseDeposit?.totalCordobas,
    });
    const invoiceRetentionTotal = invoicesForTotals.reduce((sum, invoice) => (
        safeNumber(sum + safeNumber(invoice.retentionTotal || safeNumber(invoice.retentionIr2) + safeNumber(invoice.retentionMunicipal1)))
    ), 0);
    const cashReceiptRetentionTotal = cashReceipts.reduce((sum, receipt) => (
        safeNumber(sum + getCashReceiptRetentionTotal(receipt))
    ), 0);
    const retentionAdjustment = safeNumber(invoiceRetentionTotal + cashReceiptRetentionTotal);
    const sicarExpected = safeNumber(closure.sicarExpected);
    const manualTotal = safeNumber(closure.manualTotal);
    const expectedAfterRetentions = getCashClosureComparableExpectedTotal(sicarExpected);
    const difference = getCashClosureDifference(manualTotal, sicarExpected, retentionAdjustment);

    await setDoc(closureRef, {
        ...(stampedInvoices.length ? { stampedInvoices } : {}),
        ...(stampedInvoiceDrafts.length ? { stampedInvoiceDrafts } : {}),
        retentionAdjustment,
        expectedAfterRetentions,
        manualTotalWithRetentions: getCashClosureManualTotalWithRetentions(manualTotal, retentionAdjustment),
        difference,
        accountingSummary,
        updatedAt: serverTimestamp(),
    }, { merge: true });
};

const getCashReceiptApplicationsTotal = (applications = []) => safeNumber(
    (Array.isArray(applications) ? applications : []).reduce(
        (sum, application) => sum + safeNumber(application.appliedAmount),
        0
    )
);

const buildValidatedReceiptInvoiceApplications = ({
    applications = [],
    invoiceIndex = new Map(),
    previousApplicationsMap = new Map(),
}) => {
    const normalizedApplications = (Array.isArray(applications) ? applications : [])
        .map((application) => ({
            invoiceId: application.invoiceId || application.id || application.docId || '',
            appliedAmount: safeNumber(application.appliedAmount),
        }))
        .filter((application) => application.invoiceId && application.appliedAmount > 0);

    if (!normalizedApplications.length) {
        return { applications: [], total: 0, customerName: '' };
    }

    const customerKeys = new Set();
    const rows = normalizedApplications.map((application) => {
        const invoice = invoiceIndex.get(application.invoiceId);
        if (!invoice) {
            throw new Error(`No encontre la factura ${application.invoiceId} dentro de las membretadas cargadas.`);
        }
        if (!isCreditPaymentMethod(invoice.paymentMethod)) {
            throw new Error(`La factura ${invoice.invoiceNumber || invoice.numeroFactura || application.invoiceId} no esta registrada como CREDITO.`);
        }

        const previousAppliedAmount = safeNumber(previousApplicationsMap.get(application.invoiceId));
        const availableBalance = safeNumber(getInvoiceCreditBalance(invoice) + previousAppliedAmount);
        if (availableBalance <= 0.01) {
            throw new Error(`La factura ${invoice.invoiceNumber || invoice.numeroFactura || application.invoiceId} ya no tiene saldo pendiente.`);
        }
        if (application.appliedAmount > availableBalance + 0.01) {
            throw new Error(`El abono de la factura ${invoice.invoiceNumber || invoice.numeroFactura || application.invoiceId} no puede superar el saldo disponible ${fmt(availableBalance)}.`);
        }

        const customerName = String(invoice.customerName || invoice.cliente || '').trim();
        if (customerName) customerKeys.add(normalizeText(customerName));

        return {
            invoiceId: getInvoiceDocId(invoice),
            invoiceNumber: invoice.invoiceNumber || invoice.numeroFactura || application.invoiceId,
            customerName,
            appliedAmount: application.appliedAmount,
            balanceBeforeApplication: availableBalance,
            remainingBalance: safeNumber(Math.max(availableBalance - application.appliedAmount, 0)),
        };
    });

    if (customerKeys.size > 1) {
        throw new Error('Un mismo recibo solo puede aplicarse a facturas del mismo cliente.');
    }

    return {
        applications: rows,
        total: getCashReceiptApplicationsTotal(rows),
        customerName: rows[0]?.customerName || '',
    };
};

const buildReceiptConcept = (form = {}, invoiceApplications = []) => {
    const customConcept = String(form.concept || '').trim();
    if (customConcept) return customConcept;
    if (!invoiceApplications.length) return '';
    const numbers = invoiceApplications
        .map((application) => String(application.invoiceNumber || '').trim())
        .filter(Boolean);
    return numbers.length
        ? `Pago factura${numbers.length > 1 ? 's' : ''} ${numbers.join(', ')}`
        : 'Pago a facturas de credito';
};

const buildCashReceiptPayload = ({
    form = {},
    amount = 0,
    customerName = '',
    invoiceApplications = [],
    isNew = false,
    branchPayload = getBranchPayload(DEFAULT_BRANCH_ID, 'receipt'),
}) => {
    const date = form.date || todayString();
    const retentionIr2 = safeNumber(form.retentionIr2);
    const retentionMunicipal1 = safeNumber(form.retentionMunicipal1);
    const retentionTotal = safeNumber(retentionIr2 + retentionMunicipal1);
    const netAmount = safeNumber(amount - retentionTotal);
    const linkedInvoiceIds = invoiceApplications.map((application) => application.invoiceId).filter(Boolean);

    return {
        date,
        receiptDate: date,
        month: getMonth(date),
        receiptNumber: String(form.receiptNumber || '').trim(),
        numeroRecibo: String(form.receiptNumber || '').trim(),
        ...buildReceiptDocumentFields(form, branchPayload),
        customerName: String(customerName || '').trim(),
        recibiDe: String(customerName || '').trim(),
        amount,
        cantidad: amount,
        retentionIr2,
        retencionIr2: retentionIr2,
        retentionMunicipal1,
        retencionMunicipal1: retentionMunicipal1,
        retentionTotal,
        retencionTotal: retentionTotal,
        netAmount,
        montoNeto: netAmount,
        concept: buildReceiptConcept(form, invoiceApplications),
        concepto: buildReceiptConcept(form, invoiceApplications),
        paymentMethod: String(form.paymentMethod || '').trim(),
        metodoPago: String(form.paymentMethod || '').trim(),
        reference: String(form.reference || '').trim(),
        linkedCashClosureId: form.linkedCashClosureId || '',
        receiptMode: invoiceApplications.length ? 'linked_invoices' : 'other',
        isOtherReceipt: !invoiceApplications.length,
        invoiceApplications,
        linkedInvoices: invoiceApplications,
        linkedInvoiceIds,
        source: 'manual_app',
        sourceType: 'cash_receipt',
        status: 'active',
        updatedAt: serverTimestamp(),
        ...(isNew ? { createdAt: serverTimestamp() } : {}),
    };
};

const persistCashReceiptRecord = async ({
    receiptId = '',
    form = {},
    existingReceipt = {},
    invoiceIndex = new Map(),
    branchPayload = getBranchPayload(DEFAULT_BRANCH_ID, 'receipt'),
}) => {
    if (!receiptId) throw new Error('No se pudo generar el identificador del recibo.');
    if (!String(form.paymentMethod || '').trim()) throw new Error('Selecciona metodo de pago.');

    const previousApplications = getReceiptInvoiceApplications(existingReceipt);
    const previousApplicationsMap = new Map(
        previousApplications.map((application) => [application.invoiceId, safeNumber(application.appliedAmount)])
    );
    const shouldLinkInvoices = !form.isOtherReceipt;
    const validatedApplications = shouldLinkInvoices
        ? buildValidatedReceiptInvoiceApplications({
            applications: form.invoiceApplications,
            invoiceIndex,
            previousApplicationsMap,
        })
        : { applications: [], total: 0, customerName: '' };

    if (shouldLinkInvoices && !validatedApplications.applications.length) {
        throw new Error('Selecciona al menos una factura o marca RECIBO - OTROS.');
    }

    const amount = shouldLinkInvoices ? validatedApplications.total : safeNumber(form.amount);
    if (!amount) throw new Error('Ingresa la cantidad del recibo.');

    const customerName = shouldLinkInvoices
        ? validatedApplications.customerName || String(form.customerName || '').trim()
        : String(form.customerName || '').trim();
    if (!customerName) throw new Error('Selecciona o escribe el cliente.');

    const receiptPayload = buildCashReceiptPayload({
        form,
        amount,
        customerName,
        invoiceApplications: validatedApplications.applications,
        isNew: !existingReceipt?.id && !existingReceipt?.docId,
        branchPayload,
    });

    const batch = writeBatch(db);
    batch.set(doc(db, 'recibos_caja_membretados', receiptId), receiptPayload, { merge: true });

    const invoiceStates = new Map();
    const getInvoiceState = (invoiceId) => {
        if (invoiceStates.has(invoiceId)) return invoiceStates.get(invoiceId);
        const invoice = invoiceIndex.get(invoiceId);
        if (!invoice) {
            throw new Error(`No encontre la factura ${invoiceId} para actualizar su saldo.`);
        }
        const baseCreditSnapshot = buildCreditInvoiceSnapshot(invoice);
        const state = {
            invoice,
            creditOriginalAmount: baseCreditSnapshot.creditOriginalAmount,
            creditPaidAmount: baseCreditSnapshot.creditPaidAmount,
            creditReceiptIds: [...baseCreditSnapshot.creditReceiptIds],
        };
        invoiceStates.set(invoiceId, state);
        return state;
    };

    previousApplications.forEach((application) => {
        const state = getInvoiceState(application.invoiceId);
        state.creditPaidAmount = safeNumber(Math.max(state.creditPaidAmount - safeNumber(application.appliedAmount), 0));
        state.creditReceiptIds = state.creditReceiptIds.filter((linkedReceiptId) => linkedReceiptId !== receiptId);
    });

    validatedApplications.applications.forEach((application) => {
        const state = getInvoiceState(application.invoiceId);
        state.creditPaidAmount = safeNumber(state.creditPaidAmount + safeNumber(application.appliedAmount));
        if (!state.creditReceiptIds.includes(receiptId)) {
            state.creditReceiptIds.push(receiptId);
        }
    });

    invoiceStates.forEach((state, invoiceId) => {
        const creditSnapshot = buildCreditInvoiceSnapshot(state.invoice, {
            creditOriginalAmount: state.creditOriginalAmount,
            creditPaidAmount: state.creditPaidAmount,
            creditReceiptIds: state.creditReceiptIds,
        });
        batch.set(doc(db, 'facturas_membretadas_ventas', invoiceId), {
            ...creditSnapshot,
            updatedAt: serverTimestamp(),
        }, { merge: true });
    });

    await batch.commit();

    if (receiptPayload.linkedCashClosureId) {
        await syncLinkedClosureForCashReceipt(receiptId, receiptPayload);
    }

    return {
        receiptPayload,
        invoiceApplications: validatedApplications.applications,
    };
};

const hasInvoiceDraftContent = (invoice = {}) => (
    Boolean(
        String(invoice.invoiceNumber || '').trim()
        || String(invoice.customerName || '').trim()
        || safeNumber(invoice.subtotal)
        || safeNumber(invoice.iva)
        || safeNumber(invoice.total)
        || safeNumber(invoice.retentionIr2)
        || safeNumber(invoice.retentionMunicipal1)
        || invoice.supportFiles?.invoice
        || invoice.supportFiles?.retentionIr2
        || invoice.supportFiles?.retentionMunicipal1
    )
);

const Badge = ({ children, tone = 'slate' }) => {
    const tones = {
        slate: 'border-slate-200 bg-slate-50 text-slate-600',
        red: 'border-red-200 bg-red-50 text-red-700',
        green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        amber: 'border-amber-200 bg-amber-50 text-amber-700',
        blue: 'border-sky-200 bg-sky-50 text-sky-700',
    };

    return (
        <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] ${tones[tone] || tones.slate}`}>
            {children}
        </span>
    );
};

const Field = ({ label, children, span = '' }) => (
    <label className={`block ${span}`}>
        <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{label}</span>
        {children}
    </label>
);

const inputClass = 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none transition focus:border-[#e30613] focus:ring-4 focus:ring-red-100';
const BILLING_PAGE_SIZE = 15;

const recordSearchText = (record = {}, fields = []) => (
    normalizeText(fields.map((field) => {
        if (typeof field === 'function') return field(record);
        return record?.[field];
    }).filter((value) => value !== undefined && value !== null).join(' '))
);

const filterRecords = (records = [], query = '', fields = []) => {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return records;
    return records.filter((record) => recordSearchText(record, fields).includes(normalizedQuery));
};

const paginateRecords = (records = [], page = 1, pageSize = BILLING_PAGE_SIZE) => {
    const totalPages = Math.max(1, Math.ceil(records.length / pageSize));
    const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
    const start = (safePage - 1) * pageSize;
    return {
        page: safePage,
        totalPages,
        records: records.slice(start, start + pageSize),
        start: records.length ? start + 1 : 0,
        end: Math.min(start + pageSize, records.length),
    };
};

const SearchBox = ({ value, onChange, placeholder, resultLabel }) => (
    <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1">
                <input
                    className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-4 pr-4 text-sm font-bold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#e30613] focus:ring-4 focus:ring-red-100"
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder={placeholder}
                />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                {resultLabel}
            </div>
        </div>
    </div>
);

const PaginationControls = ({ page, totalPages, total, start, end, onPageChange }) => {
    if (total <= BILLING_PAGE_SIZE && totalPages <= 1) return null;

    return (
        <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                Mostrando {start}-{end} de {total}
            </div>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => onPageChange(Math.max(1, page - 1))}
                    disabled={page <= 1}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-700 transition hover:border-[#e30613] hover:text-[#e30613] disabled:cursor-not-allowed disabled:opacity-40"
                >
                    Anterior
                </button>
                <span className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-black text-white">
                    {page} / {totalPages}
                </span>
                <button
                    type="button"
                    onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                    disabled={page >= totalPages}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-700 transition hover:border-[#e30613] hover:text-[#e30613] disabled:cursor-not-allowed disabled:opacity-40"
                >
                    Siguiente
                </button>
            </div>
        </div>
    );
};

const PaymentMethodSelect = ({ value, onChange, required = false, disabled = false }) => (
    <select className={inputClass} value={value || ''} onChange={(event) => onChange(event.target.value)} required={required} disabled={disabled}>
        <option value="">Seleccionar metodo...</option>
        {value === MIXED_PAYMENT_METHOD && <option value={MIXED_PAYMENT_METHOD}>MIXTO</option>}
        {PAYMENT_METHODS.map((method) => (
            <option key={method} value={method}>{method}</option>
        ))}
    </select>
);

const PaymentBreakdownPreview = ({ invoice = {} }) => {
    const rows = normalizePaymentBreakdownRows(invoice.paymentBreakdown);
    if (!rows.length) return null;
    return (
        <div className="mt-2 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-sky-700">Pago dividido</div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs font-black text-slate-700">
                {rows.map((row) => (
                    <span key={row.id || `${row.method}-${row.amount}`} className="rounded-full border border-sky-200 bg-white px-3 py-1">
                        {row.method} {fmt(row.amount)}
                    </span>
                ))}
            </div>
            <div className="mt-1 text-xs font-bold text-sky-700">Total aplicado: {fmt(getPaymentBreakdownTotal(rows))}</div>
        </div>
    );
};

const PaymentSplitModal = ({
    open,
    title = 'Dividir pago',
    targetAmount = 0,
    initialRows = [],
    fallbackMethod = '',
    onClose,
    onSave,
}) => {
    const [rows, setRows] = useState([]);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!open) return;
        const normalized = normalizePaymentBreakdownRows(initialRows);
        setRows(normalized.length ? normalized : [{
            id: createLineId('payment'),
            method: fallbackMethod && fallbackMethod !== MIXED_PAYMENT_METHOD ? fallbackMethod : '',
            amount: targetAmount ? String(targetAmount) : '',
            reference: '',
        }]);
        setError('');
    }, [fallbackMethod, initialRows, open, targetAmount]);

    if (!open) return null;

    const totalPaid = getPaymentBreakdownTotal(rows);
    const difference = safeNumber(targetAmount - totalPaid);
    const updateRow = (id, key, value) => {
        setRows((current) => current.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
    };
    const addRow = () => setRows((current) => [...current, { id: createLineId('payment'), method: '', amount: '', reference: '' }]);
    const removeRow = (id) => setRows((current) => current.filter((row) => row.id !== id));
    const saveRows = () => {
        const normalized = normalizePaymentBreakdownRows(rows);
        if (!normalized.length) {
            setError('Agrega al menos una linea de pago.');
            return;
        }
        if (normalized.length !== rows.filter((row) => String(row.method || '').trim() || safeNumber(row.amount)).length) {
            setError('Cada linea debe tener metodo y monto mayor que cero.');
            return;
        }
        const paid = getPaymentBreakdownTotal(normalized);
        if (Math.abs(paid - targetAmount) > 0.05) {
            setError(`El pago debe sumar ${fmt(targetAmount)}. Actualmente suma ${fmt(paid)}.`);
            return;
        }
        onSave(normalized);
    };

    return (
        <div className="fixed inset-0 z-[95] flex items-center justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm">
            <div className="w-full max-w-3xl overflow-hidden rounded-[2rem] border border-white/10 bg-white shadow-2xl">
                <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-950 px-5 py-4 text-white sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-sky-300">Pago mixto</div>
                        <h3 className="text-xl font-black">{title}</h3>
                        <p className="mt-1 text-sm font-semibold text-slate-300">Monto neto a cobrar: {fmt(targetAmount)}</p>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-2xl bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-slate-950 transition hover:bg-slate-200">
                        Cerrar
                    </button>
                </div>

                <div className="space-y-4 p-5">
                    <div className="space-y-3">
                        {rows.map((row, index) => (
                            <div key={row.id} className="grid gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-[1.2fr_0.8fr_1fr_auto] md:items-end">
                                <Field label={`Metodo ${index + 1}`}>
                                    <PaymentMethodSelect value={row.method || ''} onChange={(value) => updateRow(row.id, 'method', value)} required />
                                </Field>
                                <Field label="Monto">
                                    <input className={inputClass} type="number" step="0.01" min="0" value={row.amount || ''} onChange={(event) => updateRow(row.id, 'amount', event.target.value)} placeholder="0.00" />
                                </Field>
                                <Field label="Referencia opcional">
                                    <input className={inputClass} value={row.reference || ''} onChange={(event) => updateRow(row.id, 'reference', event.target.value)} placeholder="Voucher / referencia" />
                                </Field>
                                <button type="button" onClick={() => removeRow(row.id)} disabled={rows.length === 1} className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40">
                                    Quitar
                                </button>
                            </div>
                        ))}
                    </div>

                    <button type="button" onClick={addRow} className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-sky-700 transition hover:bg-sky-100">
                        Agregar metodo
                    </button>

                    <div className="grid gap-3 md:grid-cols-3">
                        <SummaryCard label="Neto factura" value={fmt(targetAmount)} tone="blue" />
                        <SummaryCard label="Pagado" value={fmt(totalPaid)} tone="green" />
                        <SummaryCard label="Diferencia" value={fmt(difference)} tone={Math.abs(difference) <= 0.05 ? 'green' : 'red'} />
                    </div>

                    {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}

                    <button type="button" onClick={saveRows} className="w-full rounded-2xl bg-[#e30613] px-5 py-4 text-sm font-black uppercase tracking-[0.2em] text-white shadow-lg shadow-red-950/20 transition hover:bg-[#9f111a]">
                        Guardar pago dividido
                    </button>
                </div>
            </div>
        </div>
    );
};

const STAMPED_PRINT_LAYOUT_DOC = 'factura_membretada_preimpresa';
const CASH_RECEIPT_PRINT_LAYOUT_DOC = 'recibo_caja_preimpreso';
const DEFAULT_PRINT_TEMPLATE_ID = 'principal';
const DEFAULT_PRINT_TEMPLATE_NAME = 'Plantilla principal';

const DEFAULT_STAMPED_PRINT_LAYOUT = {
    pageWidthCm: 17.8,
    pageHeightCm: 22.3,
    fontSizePt: 9,
    itemFontSizePt: 8,
    date: { x: 14.45, y: 4.32, width: 2.8 },
    customerName: { x: 3.05, y: 4.32, width: 9.7 },
    customerAddress: { x: 3.05, y: 5.12, width: 9.7 },
    customerRfc: { x: 14.15, y: 5.12, width: 2.9 },
    items: {
        quantityX: 0.8,
        descriptionX: 3.15,
        unitPriceX: 13.55,
        totalX: 15.45,
        y: 6.58,
        rowHeight: 0.47,
        quantityWidth: 1.6,
        descriptionWidth: 8.9,
        unitPriceWidth: 1.45,
        totalWidth: 1.5,
        maxRows: 15,
    },
    subtotal: { x: 15.35, y: 15.28, width: 1.7 },
    iva: { x: 15.35, y: 16.28, width: 1.7 },
    total: { x: 15.35, y: 17.28, width: 1.7 },
};

const PRINT_LAYOUT_FIELDS = [
    { key: 'date', label: 'Fecha' },
    { key: 'customerName', label: 'Cliente' },
    { key: 'customerAddress', label: 'Direccion' },
    { key: 'customerRfc', label: 'R.F.C / RUC' },
    { key: 'subtotal', label: 'Subtotal' },
    { key: 'iva', label: 'IVA' },
    { key: 'total', label: 'Total' },
];

const DEFAULT_CASH_RECEIPT_PRINT_LAYOUT = {
    pageWidthCm: 21.59,
    pageHeightCm: 13.97,
    fontSizePt: 9,
    date: { x: 1.45, y: 4.82, width: 6.2 },
    amount: { x: 15.75, y: 4.82, width: 4.2 },
    customerName: { x: 1.95, y: 5.72, width: 17.4 },
    amountText: { x: 2.85, y: 6.62, width: 8.7 },
    retentionIr2: { x: 17.55, y: 7.35, width: 2.2 },
    concept: { x: 3.15, y: 8.28, width: 16.4 },
    cashMark: { x: 3.88, y: 9.95, width: 0.35 },
    reference: { x: 6.25, y: 10.02, width: 3.7 },
    bank: { x: 11.65, y: 10.02, width: 5.4 },
};

const CASH_RECEIPT_PRINT_FIELDS = [
    { key: 'date', label: 'Fecha' },
    { key: 'amount', label: 'Por C$' },
    { key: 'customerName', label: 'Recibi de' },
    { key: 'amountText', label: 'La cantidad de' },
    { key: 'retentionIr2', label: 'Retencion 2%' },
    { key: 'concept', label: 'Concepto' },
    { key: 'cashMark', label: 'Marca efectivo' },
    { key: 'reference', label: 'CK / referencia' },
    { key: 'bank', label: 'Banco' },
];

const mergePrintLayout = (layout = {}) => ({
    ...DEFAULT_STAMPED_PRINT_LAYOUT,
    ...layout,
    date: { ...DEFAULT_STAMPED_PRINT_LAYOUT.date, ...(layout.date || {}) },
    customerName: { ...DEFAULT_STAMPED_PRINT_LAYOUT.customerName, ...(layout.customerName || {}) },
    customerAddress: { ...DEFAULT_STAMPED_PRINT_LAYOUT.customerAddress, ...(layout.customerAddress || {}) },
    customerRfc: { ...DEFAULT_STAMPED_PRINT_LAYOUT.customerRfc, ...(layout.customerRfc || {}) },
    subtotal: { ...DEFAULT_STAMPED_PRINT_LAYOUT.subtotal, ...(layout.subtotal || {}) },
    iva: { ...DEFAULT_STAMPED_PRINT_LAYOUT.iva, ...(layout.iva || {}) },
    total: { ...DEFAULT_STAMPED_PRINT_LAYOUT.total, ...(layout.total || {}) },
    items: { ...DEFAULT_STAMPED_PRINT_LAYOUT.items, ...(layout.items || {}) },
});

const mergeCashReceiptPrintLayout = (layout = {}) => ({
    ...DEFAULT_CASH_RECEIPT_PRINT_LAYOUT,
    ...layout,
    date: { ...DEFAULT_CASH_RECEIPT_PRINT_LAYOUT.date, ...(layout.date || {}) },
    amount: { ...DEFAULT_CASH_RECEIPT_PRINT_LAYOUT.amount, ...(layout.amount || {}) },
    customerName: { ...DEFAULT_CASH_RECEIPT_PRINT_LAYOUT.customerName, ...(layout.customerName || {}) },
    amountText: { ...DEFAULT_CASH_RECEIPT_PRINT_LAYOUT.amountText, ...(layout.amountText || {}) },
    retentionIr2: { ...DEFAULT_CASH_RECEIPT_PRINT_LAYOUT.retentionIr2, ...(layout.retentionIr2 || {}) },
    concept: { ...DEFAULT_CASH_RECEIPT_PRINT_LAYOUT.concept, ...(layout.concept || {}) },
    cashMark: { ...DEFAULT_CASH_RECEIPT_PRINT_LAYOUT.cashMark, ...(layout.cashMark || {}) },
    reference: { ...DEFAULT_CASH_RECEIPT_PRINT_LAYOUT.reference, ...(layout.reference || {}) },
    bank: { ...DEFAULT_CASH_RECEIPT_PRINT_LAYOUT.bank, ...(layout.bank || {}) },
});

const createPrintTemplateId = (name = '') => (
    `plantilla_${slugify(name || 'factura')}_${Date.now()}`
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
);

const normalizePrintTemplate = (template = {}, fallbackIndex = 0) => ({
    id: template.id || (fallbackIndex === 0 ? DEFAULT_PRINT_TEMPLATE_ID : createPrintTemplateId(template.name || template.nombre || `Plantilla ${fallbackIndex + 1}`)),
    name: template.name || template.nombre || (fallbackIndex === 0 ? DEFAULT_PRINT_TEMPLATE_NAME : `Plantilla ${fallbackIndex + 1}`),
    layout: mergePrintLayout(template.layout || template),
});

const normalizeCashReceiptPrintTemplate = (template = {}, fallbackIndex = 0) => ({
    id: template.id || (fallbackIndex === 0 ? DEFAULT_PRINT_TEMPLATE_ID : createPrintTemplateId(template.name || template.nombre || `Plantilla ${fallbackIndex + 1}`)),
    name: template.name || template.nombre || (fallbackIndex === 0 ? DEFAULT_PRINT_TEMPLATE_NAME : `Plantilla ${fallbackIndex + 1}`),
    layout: mergeCashReceiptPrintLayout(template.layout || template),
});

const readPrintTemplates = (config = {}) => {
    if (Array.isArray(config.templates) && config.templates.length > 0) {
        return config.templates.map(normalizePrintTemplate);
    }

    if (config.templates && typeof config.templates === 'object') {
        const templates = Object.entries(config.templates).map(([id, template], index) => (
            normalizePrintTemplate({ ...(template || {}), id }, index)
        ));
        if (templates.length > 0) return templates;
    }

    return [
        normalizePrintTemplate({
            id: DEFAULT_PRINT_TEMPLATE_ID,
            name: DEFAULT_PRINT_TEMPLATE_NAME,
            layout: config.layout || config,
        }, 0),
    ];
};

const readCashReceiptPrintTemplates = (config = {}) => {
    if (Array.isArray(config.templates) && config.templates.length > 0) {
        return config.templates.map(normalizeCashReceiptPrintTemplate);
    }

    if (config.templates && typeof config.templates === 'object') {
        const templates = Object.entries(config.templates).map(([id, template], index) => (
            normalizeCashReceiptPrintTemplate({ ...(template || {}), id }, index)
        ));
        if (templates.length > 0) return templates;
    }

    return [
        normalizeCashReceiptPrintTemplate({
            id: DEFAULT_PRINT_TEMPLATE_ID,
            name: DEFAULT_PRINT_TEMPLATE_NAME,
            layout: config.layout || config,
        }, 0),
    ];
};

const cm = (value) => `${safeNumber(value)}cm`;

const formatInvoiceMoney = (value) => (
    new Intl.NumberFormat('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(safeNumber(value))
);

const formatQuantity = (value) => (
    new Intl.NumberFormat('es-NI', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value || 0))
);

const formatInvoiceDate = (date = '') => {
    const [year, month, day] = String(date || '').substring(0, 10).split('-');
    return [day, month, year].filter(Boolean).join(' / ');
};

const escapeHtml = (value = '') => (
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
);

const buildPrintTextHtml = ({ x, y, width }, content, layout, options = {}) => {
    const align = options.align || 'left';
    const fontSize = safeNumber(options.fontSizePt ?? layout.fontSizePt) || 9;
    const family = options.mono ? 'Consolas, \"Courier New\", monospace' : 'Arial, Helvetica, sans-serif';
    return `
        <div class="txt" style="
            left:${cm(x)};
            top:${cm(y)};
            width:${cm(width || 2)};
            font-size:${fontSize}pt;
            font-family:${family};
            text-align:${align};
        ">${escapeHtml(content)}</div>
    `;
};

const buildStampedInvoicePrintHtml = (invoice, layout) => {
    const mergedLayout = mergePrintLayout(layout);
    const itemsLayout = mergedLayout.items;
    const items = (invoice?.items || []).slice(0, Number(itemsLayout.maxRows || 15));
    const itemRows = items.map((item, index) => {
        const y = safeNumber(itemsLayout.y) + index * safeNumber(itemsLayout.rowHeight || 0.47);
        return [
            buildPrintTextHtml({ x: itemsLayout.quantityX, y, width: itemsLayout.quantityWidth }, formatQuantity(item.quantity), mergedLayout, { align: 'center', mono: true, fontSizePt: mergedLayout.itemFontSizePt }),
            buildPrintTextHtml({ x: itemsLayout.descriptionX, y, width: itemsLayout.descriptionWidth }, item.description || item.descripcion || '', mergedLayout, { fontSizePt: mergedLayout.itemFontSizePt }),
            buildPrintTextHtml({ x: itemsLayout.unitPriceX, y, width: itemsLayout.unitPriceWidth }, formatInvoiceMoney(item.unitPriceWithoutTax ?? item.precioSin), mergedLayout, { align: 'right', mono: true, fontSizePt: mergedLayout.itemFontSizePt }),
            buildPrintTextHtml({ x: itemsLayout.totalX, y, width: itemsLayout.totalWidth }, formatInvoiceMoney(item.totalWithoutTax ?? item.importeSin), mergedLayout, { align: 'right', mono: true, fontSizePt: mergedLayout.itemFontSizePt }),
        ].join('');
    }).join('');

    return `<!doctype html>
<html>
<head>
    <meta charset="utf-8" />
    <title></title>
    <style>
        @page {
            size: ${cm(mergedLayout.pageWidthCm)} ${cm(mergedLayout.pageHeightCm)};
            margin: 0;
        }
        html,
        body {
            width: ${cm(mergedLayout.pageWidthCm)};
            height: ${cm(mergedLayout.pageHeightCm)};
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
            background: transparent !important;
        }
        * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        .sheet {
            position: relative;
            width: ${cm(mergedLayout.pageWidthCm)};
            height: ${cm(mergedLayout.pageHeightCm)};
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden;
            background: transparent;
        }
        .txt {
            position: absolute;
            color: #000;
            font-weight: 700;
            line-height: 1.05;
            white-space: nowrap;
            overflow: hidden;
        }
        @media print {
            html,
            body,
            .sheet {
                width: ${cm(mergedLayout.pageWidthCm)} !important;
                height: ${cm(mergedLayout.pageHeightCm)} !important;
                margin: 0 !important;
                padding: 0 !important;
            }
        }
    </style>
</head>
<body>
    <main class="sheet">
        ${buildPrintTextHtml(mergedLayout.customerName, invoice.customerName || invoice.cliente || '', mergedLayout)}
        ${buildPrintTextHtml(mergedLayout.customerAddress, invoice.customerAddress || invoice.address || '', mergedLayout)}
        ${buildPrintTextHtml(mergedLayout.customerRfc, invoice.customerRfc || invoice.rfc || '', mergedLayout)}
        ${buildPrintTextHtml(mergedLayout.date, formatInvoiceDate(invoice.date || invoice.saleDate), mergedLayout)}
        ${itemRows}
        ${buildPrintTextHtml(mergedLayout.subtotal, formatInvoiceMoney(invoice.subtotal), mergedLayout, { align: 'right', mono: true })}
        ${buildPrintTextHtml(mergedLayout.iva, formatInvoiceMoney(invoice.iva), mergedLayout, { align: 'right', mono: true })}
        ${buildPrintTextHtml(mergedLayout.total, formatInvoiceMoney(invoice.total), mergedLayout, { align: 'right', mono: true })}
    </main>
</body>
</html>`;
};

const getReceiptPaymentBank = (method = '') => {
    const normalized = normalizeText(method);
    if (normalized.includes('BAC')) return 'BAC';
    if (normalized.includes('BANPRO')) return 'BANPRO';
    if (normalized.includes('LAFISE')) return 'LAFISE';
    return method || '';
};

const buildCashReceiptPrintHtml = (receipt = {}, layout = DEFAULT_CASH_RECEIPT_PRINT_LAYOUT) => {
    const mergedLayout = mergeCashReceiptPrintLayout(layout);
    const amount = safeNumber(receipt.amount);
    const retention = safeNumber(receipt.retentionIr2);
    const paymentMethod = receipt.paymentMethod || '';
    const isCash = normalizeText(paymentMethod) === 'EFECTIVO';
    const bank = getReceiptPaymentBank(paymentMethod);
    const text = (fieldKey, content, options = {}) => buildPrintTextHtml(
        mergedLayout[fieldKey],
        content,
        mergedLayout,
        { align: options.align || 'left', mono: options.mono, fontSizePt: options.fontSizePt || mergedLayout.fontSizePt }
    );

    return `<!doctype html>
<html>
<head>
    <meta charset="utf-8" />
    <title></title>
    <style>
        @page { size: ${cm(mergedLayout.pageWidthCm)} ${cm(mergedLayout.pageHeightCm)}; margin: 0; }
        html, body {
            width: ${cm(mergedLayout.pageWidthCm)};
            height: ${cm(mergedLayout.pageHeightCm)};
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
            background: transparent !important;
        }
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .sheet {
            position: relative;
            width: ${cm(mergedLayout.pageWidthCm)};
            height: ${cm(mergedLayout.pageHeightCm)};
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden;
            background: transparent;
            transform-origin: top left;
        }
        .txt {
            position: absolute;
            color: #000;
            font-weight: 700;
            line-height: 1.05;
            white-space: nowrap;
            overflow: hidden;
        }
        @media print {
            html,
            body,
            .sheet {
                width: ${cm(mergedLayout.pageWidthCm)} !important;
                height: ${cm(mergedLayout.pageHeightCm)} !important;
                margin: 0 !important;
                padding: 0 !important;
            }
        }
    </style>
</head>
<body>
    <main class="sheet">
        ${text('date', formatInvoiceDate(receipt.date))}
        ${text('amount', formatInvoiceMoney(amount), { align: 'right', mono: true })}
        ${text('customerName', receipt.customerName || receipt.recibiDe || '')}
        ${text('amountText', `C$ ${formatInvoiceMoney(amount)}`)}
        ${text('retentionIr2', formatInvoiceMoney(retention), { align: 'right', mono: true })}
        ${text('concept', receipt.concept || receipt.concepto || '')}
        ${text('cashMark', isCash ? 'X' : '', { align: 'center', fontSizePt: safeNumber(mergedLayout.fontSizePt) + 4 })}
        ${text('reference', receipt.reference || receipt.referencia || '', { fontSizePt: Math.max(7, safeNumber(mergedLayout.fontSizePt) - 1) })}
        ${text('bank', bank, { fontSizePt: Math.max(7, safeNumber(mergedLayout.fontSizePt) - 1) })}
    </main>
</body>
</html>`;
};

const Section = ({ title, eyebrow, action, children }) => (
    <section className="overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
                {eyebrow && <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#e30613]">{eyebrow}</div>}
                <h2 className="text-lg font-black text-slate-950">{title}</h2>
            </div>
            {action}
        </div>
        <div className="p-5">{children}</div>
    </section>
);

const SummaryCard = ({ label, value, tone = 'slate' }) => {
    const styles = {
        slate: 'border-slate-200 bg-white text-slate-950',
        red: 'border-red-200 bg-red-50 text-red-800',
        green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        amber: 'border-amber-200 bg-amber-50 text-amber-800',
        blue: 'border-sky-200 bg-sky-50 text-sky-800',
    };

    return (
        <div className={`rounded-2xl border p-4 shadow-sm ${styles[tone] || styles.slate}`}>
            <div className="text-[10px] font-black uppercase tracking-[0.24em] opacity-60">{label}</div>
            <div className="mt-1 font-mono text-xl font-black">{value}</div>
        </div>
    );
};

const CashClosureRcAlarm = ({ rc = 0 }) => {
    if (!isPositiveCashClosureRc(rc)) return null;

    return (
        <div className="rounded-3xl border border-red-300 bg-red-50 px-4 py-4 text-red-900 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-red-700">Alarma de conciliacion</div>
            <div className="mt-2 text-sm font-black">{CASH_CLOSURE_POSITIVE_RC_MESSAGE}</div>
            <div className="mt-1 text-xs font-bold text-red-700">RC actual: {fmt(rc)}</div>
        </div>
    );
};

const DetailRows = ({ title, rows, onChange, onAdd, onRemove, type, clients = [], onCreateClient, currency = 'NIO', exchangeRate = 1 }) => (
    <div className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
            <div>
                <div className="text-sm font-black text-slate-950">{title}</div>
                <div className="text-xs font-semibold text-slate-500">
                    {type === 'discount'
                        ? 'Detalle de descuentos autorizados por la casa.'
                        : type === 'transfer' ? 'Detalle por cliente y referencia bancaria.' : 'Detalle por cierre POS y referencia.'}
                </div>
            </div>
            <button type="button" onClick={onAdd} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white transition hover:bg-[#e30613]">
                Agregar
            </button>
        </div>

        <div className="space-y-2">
            {rows.map((row, index) => {
                const isUsd = currency === 'USD';
                const convertedAmount = safeNumber(safeNumber(row.amount) * safeNumber(exchangeRate || 1));

                if (type === 'discount') {
                    return (
                        <div key={row.localId || index} className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 md:grid-cols-[1.7fr_0.8fr_auto]">
                            <input
                                className={inputClass}
                                placeholder="Descripcion del descuento"
                                value={row.description || ''}
                                onChange={(event) => onChange(index, 'description', event.target.value)}
                            />
                            <input
                                className={inputClass}
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="Monto"
                                value={row.amount}
                                onChange={(event) => onChange(index, 'amount', event.target.value)}
                            />
                            <button type="button" onClick={() => onRemove(index)} className="rounded-xl border border-red-200 px-3 py-2 text-xs font-black text-red-700 transition hover:bg-red-50">
                                Quitar
                            </button>
                        </div>
                    );
                }

                return (
                <div key={row.localId || index} className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 md:grid-cols-[1.4fr_1fr_1fr_auto]">
                    {type === 'transfer' ? (
                        <div>
                            <input
                                className={inputClass}
                                list="billing-clients"
                                placeholder="Cliente"
                                value={row.clientName}
                                onChange={(event) => onChange(index, 'clientName', event.target.value)}
                            />
                            {String(row.clientName || '').trim() && !recordExistsByName(clients, row.clientName) && (
                                <button
                                    type="button"
                                    onClick={() => onCreateClient?.(row.clientName)}
                                    className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700 transition hover:bg-emerald-100"
                                >
                                    Agregar cliente
                                </button>
                            )}
                        </div>
                    ) : (
                        <input
                            className={inputClass}
                            placeholder="Cierre POS / lote"
                            value={row.reference}
                            onChange={(event) => onChange(index, 'reference', event.target.value)}
                        />
                    )}
                    <div>
                        <input
                            className={inputClass}
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder={isUsd ? 'Monto USD' : 'Monto'}
                            value={row.amount}
                            onChange={(event) => onChange(index, 'amount', event.target.value)}
                        />
                        {isUsd && (
                            <div className="mt-1 rounded-xl bg-emerald-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">
                                Equivale {fmt(convertedAmount)} / TC {safeNumber(exchangeRate).toFixed(2)}
                            </div>
                        )}
                    </div>
                    {type === 'transfer' ? (
                        <input
                            className={inputClass}
                            placeholder="Referencia"
                            value={row.reference}
                            onChange={(event) => onChange(index, 'reference', event.target.value)}
                        />
                    ) : (
                        <div className="flex items-center rounded-2xl border border-slate-200 bg-slate-50 px-4 text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                            POS
                        </div>
                    )}
                    <button type="button" onClick={() => onRemove(index)} className="rounded-xl border border-red-200 px-3 py-2 text-xs font-black text-red-700 transition hover:bg-red-50">
                        Quitar
                    </button>
                </div>
                );
            })}
            {rows.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-center text-sm font-bold text-slate-400">
                    Sin detalle todavia.
                </div>
            )}
        </div>
        <datalist id="billing-clients">
            {clients.map((client) => (
                <option key={client.id || client.code || client.name} value={client.name || client.nombre || ''} />
            ))}
        </datalist>
    </div>
);

const ClosureAccountingSummaryPanel = ({ summary = {} }) => {
    const general = summary.general || {};
    const stamped = summary.stampedDocuments || {};
    const tickets = summary.sicarTickets || {};
    const payment = summary.paymentBreakdown || {};
    const ratio = summary.internalRatio || {};
    const rcDisplay = getCashClosureRcDisplayValue(summary);

    return (
        <div className="rounded-[1.8rem] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#e30613]">Resumen final del cierre</div>
                    <div className="text-lg font-black text-slate-950">Cuadre contable y ratio RC</div>
                </div>
                <Badge tone={isPositiveCashClosureRc(ratio.rc) ? 'red' : 'green'}>RC {fmt(rcDisplay)}</Badge>
            </div>
            <div className="grid gap-4 xl:grid-cols-5">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">1.1 Total general</div>
                    <SummaryCard label="Ventas contado" value={fmt(general.cashSalesTotal)} tone="green" />
                    <div className="mt-2"><SummaryCard label="Ventas credito" value={fmt(general.creditSalesTotal)} tone="blue" /></div>
                    <div className="mt-2"><SummaryCard label="Recup. credito" value={fmt(general.creditRecoveryTotal)} tone="amber" /></div>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">1.2 Documentos membretados</div>
                    <SummaryCard label="Fact. contado" value={fmt(stamped.stampedCashInvoices)} tone="green" />
                    <div className="mt-2"><SummaryCard label="Fact. credito" value={fmt(stamped.stampedCreditInvoices)} tone="blue" /></div>
                    <div className="mt-2"><SummaryCard label="Recibos caja" value={fmt(stamped.stampedCashReceipts)} tone="amber" /></div>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">1.3 Ticket SICAR</div>
                    <SummaryCard label="Ventas ticket" value={fmt(tickets.cashSalesTickets)} tone="green" />
                    <div className="mt-2"><SummaryCard label="Ventas credito ticket" value={fmt(tickets.creditSalesTickets)} tone="blue" /></div>
                    <div className="mt-2"><SummaryCard label="Recibos ticket" value={fmt(tickets.cashReceiptTickets)} tone="amber" /></div>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">1.4 Metodos de pago</div>
                    <SummaryCard label="Tarjeta total" value={fmt(payment.cardTotal)} tone="blue" />
                    <div className="mt-2 text-xs font-black text-slate-600">POS BAC {fmt(payment.posBac)}</div>
                    <div className="text-xs font-black text-slate-600">POS Banpro {fmt(payment.posBanpro)}</div>
                    <div className="text-xs font-black text-slate-600">POS Lafise {fmt(payment.posLafise)}</div>
                    <div className="mt-3"><SummaryCard label="Transferencias" value={fmt(payment.transferTotal)} tone="green" /></div>
                    <div className="mt-2 text-xs font-black text-slate-600">BAC {fmt(payment.transferBac)}</div>
                    <div className="text-xs font-black text-slate-600">BAC (2) {fmt(payment.transferBac2)}</div>
                    <div className="text-xs font-black text-slate-600">Banpro {fmt(payment.transferBanpro)}</div>
                    <div className="text-xs font-black text-slate-600">Lafise {fmt(payment.transferLafise)}</div>
                    <div className="text-xs font-black text-slate-600">BAC USD {fmt(payment.transferBacUsd)}</div>
                    <div className="text-xs font-black text-slate-600">Lafise USD {fmt(payment.transferLafiseUsd)}</div>
                    <div className="mt-3"><SummaryCard label="Descuentos casa" value={fmt(payment.houseDiscountTotal)} tone="amber" /></div>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">1.5 Calculo interno</div>
                    <SummaryCard label="Efectivo total" value={fmt(payment.cashTotal)} />
                    <div className="mt-2 text-xs font-black text-slate-600">Cordobas {fmt(payment.cashCordobas)}</div>
                    <div className="text-xs font-black text-slate-600">Dolares {fmt(payment.cashDollarsConverted)}</div>
                    <div className="text-xs font-black text-slate-600">Pre-cierre {fmt(payment.preCloseDepositTotal)}</div>
                    <div className="mt-3"><SummaryCard label="RC" value={fmt(rcDisplay)} tone={isPositiveCashClosureRc(ratio.rc) ? 'red' : 'green'} /></div>
                    <div className="mt-2 text-[11px] font-bold text-slate-500">{ratio.formula}</div>
                </div>
            </div>
        </div>
    );
};

function CashClosure({ data, branchContext }) {
    const { user } = useAuth();
    const isMaster = isMasterEmail(user?.email);
    const selectedBranchId = getActiveBillingBranchId(branchContext);
    const branchPayload = useMemo(() => getBranchPayload(selectedBranchId), [selectedBranchId]);
    const invoiceBranchPayload = useMemo(() => getBranchPayload(selectedBranchId, 'invoice'), [selectedBranchId]);
    const receiptBranchPayload = useMemo(() => getBranchPayload(selectedBranchId, 'receipt'), [selectedBranchId]);

    const closedSicarClosureKeys = useMemo(() => {
        const keys = new Set();
        (data.cierres_caja || [])
            .filter((closure) => isRecordInBillingBranch(closure, selectedBranchId))
            .filter((closure) => closure.status !== 'en_espera')
            .forEach((closure) => {
                getSavedClosureSicarMatchKeys(closure).forEach((key) => keys.add(key));
            });
        return keys;
    }, [data.cierres_caja, selectedBranchId]);

    const sicarClosures = useMemo(() => (
        [...(data.sicar_cierres_caja || [])]
            .map((item) => {
                const datedClosure = { ...item, date: item.date || getRecordDate(item.closureDateTime || item.fecha) };
                return { ...datedClosure, ...getBranchPayload(getRecordBranchId(datedClosure)), ...getNetSicarSalesTotals(datedClosure) };
            })
            .filter((closure) => isRecordInBillingBranch(closure, selectedBranchId))
            .filter((closure) => !isSicarClosureHiddenFromCashClosure(closure))
            .filter((closure) => String(closure.date || '').substring(0, 10) >= SICAR_CASH_CLOSURE_AVAILABLE_FROM_DATE)
            .filter((closure) => ![...getSicarClosureMatchKeys(closure)].some((key) => closedSicarClosureKeys.has(key)))
            .sort((a, b) => String(b.closureDateTime || b.fecha || b.date).localeCompare(String(a.closureDateTime || a.fecha || a.date)))
    ), [closedSicarClosureKeys, data.sicar_cierres_caja, selectedBranchId]);

    const stampedInvoices = useMemo(() => (
        [...(data.facturas_membretadas_ventas || [])]
            .map((item) => ({
                ...item,
                ...getBranchPayload(getRecordBranchId(item), 'invoice'),
                date: item.saleDate || item.date || '',
                invoiceNumber: item.numeroFactura || item.invoiceNumber || '',
                cashierName: getCashierName(item),
                cashierCode: getRecordCashierCode(item),
                retentionTotal: safeNumber(item.retentionTotal ?? (safeNumber(item.retentionIr2) + safeNumber(item.retentionMunicipal1))),
            }))
            .filter((invoice) => isRecordInBillingBranch(invoice, selectedBranchId))
            .filter((invoice) => !isInvoiceExcludedFromCashClosureSelection(invoice))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    ), [data.facturas_membretadas_ventas, selectedBranchId]);

    const cashReceipts = useMemo(() => (
        [...(data.recibos_caja_membretados || [])]
            .map(normalizeCashReceiptRecord)
            .map((receipt) => ({ ...receipt, ...getBranchPayload(getRecordBranchId(receipt), 'receipt') }))
            .filter((receipt) => isRecordInBillingBranch(receipt, selectedBranchId))
            .filter((receipt) => normalizeText(receipt.status) !== 'ANULADO')
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    ), [data.recibos_caja_membretados, selectedBranchId]);

    const clients = useMemo(() => (
        [...(data.clientes_facturacion || [])]
            .map((item) => ({ ...item, name: item.name || item.nombre || '' }))
            .filter((item) => item.name)
            .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    ), [data.clientes_facturacion]);

    const waitingClosures = useMemo(() => (
        [...(data.cierres_caja || [])]
            .filter((item) => isRecordInBillingBranch(item, selectedBranchId))
            .filter((item) => item.status === 'en_espera')
            .sort((a, b) => String(b.updatedAt?.seconds || b.date || '').localeCompare(String(a.updatedAt?.seconds || a.date || '')))
    ), [data.cierres_caja, selectedBranchId]);

    const [activeClosureDocId, setActiveClosureDocId] = useState('');
    const [selectedClosureId, setSelectedClosureId] = useState('');
    const [closureDate, setClosureDate] = useState(todayString());
    const [cashierName, setCashierName] = useState('');
    const [cashCount, setCashCount] = useState({});
    const [dollarCashCount, setDollarCashCount] = useState({});
    const [preCloseDeposit, setPreCloseDeposit] = useState({ cordobas: '', dollars: '' });
    const [transfers, setTransfers] = useState({ bac: [], bac2: [], banpro: [], lafise: [], bacUsd: [], lafiseUsd: [] });
    const [posDetails, setPosDetails] = useState({ bac: [], banpro: [], lafise: [] });
    const [houseDiscountDetails, setHouseDiscountDetails] = useState([]);
    const [closureInvoices, setClosureInvoices] = useState([]);
    const [closureCashReceipts, setClosureCashReceipts] = useState([]);
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [sicarClosureSearch, setSicarClosureSearch] = useState('');
    const [sicarClosurePage, setSicarClosurePage] = useState(1);
    const [closureInvoiceSearch, setClosureInvoiceSearch] = useState('');
    const [closureInvoicePage, setClosureInvoicePage] = useState(1);
    const [closureReceiptSearch, setClosureReceiptSearch] = useState('');
    const [closureReceiptPage, setClosureReceiptPage] = useState(1);
    const [quickInvoiceNumber, setQuickInvoiceNumber] = useState('');
    const [activeClosureInvoiceLocalId, setActiveClosureInvoiceLocalId] = useState('');
    const [closureSuccessOpen, setClosureSuccessOpen] = useState(false);
    const [lastSavedClosure, setLastSavedClosure] = useState(null);

    const selectedClosure = useMemo(() => (
        sicarClosures.find((closure) => closure.id === selectedClosureId) || null
    ), [selectedClosureId, sicarClosures]);

    const filteredSicarClosures = useMemo(() => filterRecords(sicarClosures, sicarClosureSearch, [
        'date',
        'corId',
        'cor_id',
        'cashboxName',
        'cajaName',
        'cashboxId',
        'rccId',
        'rcc_id',
        'closureDateTime',
        'fecha',
    ]), [sicarClosures, sicarClosureSearch]);

    const pagedSicarClosures = useMemo(() => (
        paginateRecords(filteredSicarClosures, sicarClosurePage)
    ), [filteredSicarClosures, sicarClosurePage]);

    const dayStampedInvoices = useMemo(() => (
        stampedInvoices.filter((invoice) => String(invoice.date || '').substring(0, 10) === closureDate)
    ), [stampedInvoices, closureDate]);

    const cashierStampedInvoices = useMemo(() => (
        cashierName
            ? dayStampedInvoices.filter((invoice) => isSameCashier(invoice, cashierName))
            : []
    ), [cashierName, dayStampedInvoices]);

    const filteredStampedInvoices = useMemo(() => filterRecords(cashierStampedInvoices, closureInvoiceSearch, [
        'date',
        'invoiceNumber',
        'numeroFactura',
        'cashierName',
        'customerName',
        'cliente',
        'total',
    ]), [cashierStampedInvoices, closureInvoiceSearch]);

    const pagedStampedInvoices = useMemo(() => (
        paginateRecords(filteredStampedInvoices, closureInvoicePage, 6)
    ), [filteredStampedInvoices, closureInvoicePage]);

    const selectedReceiptIds = useMemo(() => (
        closureCashReceipts.map((receipt) => receipt.docId || receipt.id).filter(Boolean)
    ), [closureCashReceipts]);

    const dayCashReceipts = useMemo(() => (
        cashReceipts.filter((receipt) => {
            const receiptId = receipt.docId || receipt.id;
            const isSameDay = String(receipt.date || '').substring(0, 10) === closureDate;
            const linkedClosureId = receipt.linkedCashClosureId || receipt.cashClosureId || '';
            const canUse = !linkedClosureId || linkedClosureId === activeClosureDocId || selectedReceiptIds.includes(receiptId);
            return isSameDay && canUse;
        })
    ), [activeClosureDocId, cashReceipts, closureDate, selectedReceiptIds]);

    const filteredCashReceipts = useMemo(() => filterRecords(dayCashReceipts, closureReceiptSearch, [
        'date',
        'receiptNumber',
        'numeroRecibo',
        'customerName',
        'recibiDe',
        'concept',
        'paymentMethod',
        'amount',
    ]), [dayCashReceipts, closureReceiptSearch]);

    const pagedCashReceipts = useMemo(() => (
        paginateRecords(filteredCashReceipts, closureReceiptPage, 6)
    ), [filteredCashReceipts, closureReceiptPage]);

    useEffect(() => {
        setSicarClosurePage(1);
    }, [sicarClosureSearch]);

    useEffect(() => {
        setClosureInvoicePage(1);
    }, [closureInvoiceSearch, closureDate]);

    useEffect(() => {
        setClosureReceiptPage(1);
    }, [closureReceiptSearch, closureDate]);

    useEffect(() => {
        if (sicarClosurePage !== pagedSicarClosures.page) setSicarClosurePage(pagedSicarClosures.page);
    }, [sicarClosurePage, pagedSicarClosures.page]);

    useEffect(() => {
        if (closureInvoicePage !== pagedStampedInvoices.page) setClosureInvoicePage(pagedStampedInvoices.page);
    }, [closureInvoicePage, pagedStampedInvoices.page]);

    useEffect(() => {
        if (closureReceiptPage !== pagedCashReceipts.page) setClosureReceiptPage(pagedCashReceipts.page);
    }, [closureReceiptPage, pagedCashReceipts.page]);

    useEffect(() => {
        if (!cashierName) return;
        const requiredIds = new Set(cashierStampedInvoices.map((invoice) => invoice.id || invoice.docId).filter(Boolean));
        setClosureInvoices((prev) => {
            const existingByDocId = new Map(
                prev
                    .filter((invoice) => invoice.docId)
                    .map((invoice) => [invoice.docId, invoice])
            );
            const requiredDrafts = cashierStampedInvoices.map((invoice) => (
                existingByDocId.get(invoice.id || invoice.docId) || createInvoiceDraft(invoice, closureDate)
            ));
            const manualDrafts = prev.filter((invoice) => (
                !invoice.docId
                && hasInvoiceDraftContent(invoice)
                && !requiredIds.has(invoice.id)
            ));
            return [...requiredDrafts, ...manualDrafts];
        });
    }, [cashierName, cashierStampedInvoices, closureDate]);

    const selectedInvoiceIds = useMemo(() => (
        closureInvoices.map((invoice) => invoice.docId).filter(Boolean)
    ), [closureInvoices]);

    const missingClosureInvoices = useMemo(() => {
        const selectedKeys = new Set(selectedInvoiceIds.map((id) => normalizeInvoiceMatchKey(id)));
        return cashierStampedInvoices.filter((invoice) => (
            !selectedKeys.has(normalizeInvoiceMatchKey(invoice.id || invoice.docId))
        ));
    }, [cashierStampedInvoices, selectedInvoiceIds]);

    const cashTotal = useMemo(() => (
        CASH_DENOMINATIONS.reduce((sum, denomination) => sum + denomination * safeNumber(cashCount[denomination]), 0)
    ), [cashCount]);

    const dollarCashTotal = useMemo(() => (
        USD_DENOMINATIONS.reduce((sum, denomination) => sum + denomination * safeNumber(dollarCashCount[denomination]), 0)
    ), [dollarCashCount]);

    const dollarCashTotalCordobas = safeNumber(dollarCashTotal * CASH_CLOSURE_EXCHANGE_RATE);
    const preCloseDepositCordobas = safeNumber(preCloseDeposit.cordobas);
    const preCloseDepositDollars = safeNumber(preCloseDeposit.dollars);
    const preCloseDepositTotal = safeNumber(preCloseDepositCordobas + (preCloseDepositDollars * CASH_CLOSURE_EXCHANGE_RATE));
    const cashClosureTotal = safeNumber(cashTotal + dollarCashTotalCordobas + preCloseDepositTotal);

    const transferTotals = useMemo(() => Object.fromEntries(TRANSFER_BANKS.map((bank) => [
        bank.key,
        getBankRowsTotal(transfers[bank.key] || [], bank),
    ])), [transfers]);

    const posTotals = useMemo(() => Object.fromEntries(POS_BANKS.map(({ key }) => [
        key,
        safeNumber((posDetails[key] || []).reduce((sum, item) => sum + safeNumber(item.amount), 0)),
    ])), [posDetails]);
    const houseDiscountTotal = useMemo(() => getHouseDiscountTotal(houseDiscountDetails), [houseDiscountDetails]);

    const manualTotal = safeNumber(
        cashClosureTotal
        + Object.values(transferTotals).reduce((sum, value) => sum + value, 0)
        + Object.values(posTotals).reduce((sum, value) => sum + value, 0)
        + houseDiscountTotal
    );
    const invoiceRetentionTotal = safeNumber(closureInvoices.reduce((sum, invoice) => (
        sum + safeNumber(invoice.retentionIr2) + safeNumber(invoice.retentionMunicipal1)
    ), 0));
    const cashReceiptRetentionTotal = safeNumber(closureCashReceipts.reduce((sum, receipt) => (
        sum + getCashReceiptRetentionTotal(receipt)
    ), 0));
    const retentionTotal = safeNumber(invoiceRetentionTotal + cashReceiptRetentionTotal);
    const sicarExpected = safeNumber(selectedClosure?.calculatedTotal ?? selectedClosure?.calculado ?? selectedClosure?.totalDineroIngresado);
    const sicarNetSalesTotals = useMemo(() => getNetSicarSalesTotals(selectedClosure || {}), [selectedClosure]);
    const sicarCashSalesTotal = sicarNetSalesTotals.cashSalesNetTotal;
    const sicarCreditRecoveryTotal = safeNumber(selectedClosure?.creditRecoveryTotal ?? selectedClosure?.recuperacionCredito ?? selectedClosure?.entCre);
    const sicarCreditSalesTotal = sicarNetSalesTotals.creditSalesNetTotal;
    const closureAccountingSummary = useMemo(() => buildClosureAccountingSummary({
        cashSalesTotal: sicarCashSalesTotal,
        creditSalesTotal: sicarCreditSalesTotal,
        creditRecoveryTotal: sicarCreditRecoveryTotal,
        stampedInvoices: closureInvoices,
        cashReceipts: closureCashReceipts,
        transferTotals,
        posTotals,
        houseDiscountTotal,
        cashCordobasTotal: cashTotal,
        dollarCashTotalCordobas,
        preCloseDepositTotal,
    }), [sicarCashSalesTotal, sicarCreditSalesTotal, sicarCreditRecoveryTotal, closureInvoices, closureCashReceipts, transferTotals, posTotals, houseDiscountTotal, cashTotal, dollarCashTotalCordobas, preCloseDepositTotal]);
    const closureRc = getCashClosureRcValue(closureAccountingSummary);
    const isClosureRcPositive = isPositiveCashClosureRc(closureRc);
    const expectedAfterRetentions = getCashClosureComparableExpectedTotal(sicarExpected);
    const manualTotalWithRetentions = getCashClosureManualTotalWithRetentions(manualTotal, retentionTotal);
    const difference = getCashClosureDifference(manualTotal, sicarExpected, retentionTotal);
    const shouldTrackDifference = Math.abs(difference) > CASH_DIFFERENCE_THRESHOLD;

    const resetClosureWorkspace = () => {
        setActiveClosureDocId('');
        setSelectedClosureId('');
        setClosureDate(todayString());
        setCashierName('');
        setCashCount({});
        setDollarCashCount({});
        setPreCloseDeposit({ cordobas: '', dollars: '' });
        setTransfers({ bac: [], bac2: [], banpro: [], lafise: [], bacUsd: [], lafiseUsd: [] });
        setPosDetails({ bac: [], banpro: [], lafise: [] });
        setHouseDiscountDetails([]);
        setClosureInvoices([]);
        setClosureCashReceipts([]);
        setNotes('');
        setMessage('');
        setSicarClosureSearch('');
        setSicarClosurePage(1);
        setClosureInvoiceSearch('');
        setClosureInvoicePage(1);
        setClosureReceiptSearch('');
        setClosureReceiptPage(1);
        setQuickInvoiceNumber('');
        setActiveClosureInvoiceLocalId('');
    };

    const loadClosure = (closure) => {
        setClosureSuccessOpen(false);
        setActiveClosureDocId(closure.corId ? `cierre_${selectedBranchId}_${closure.date || getRecordDate(closure.closureDateTime || closure.fecha)}_${closure.corId}` : '');
        setSelectedClosureId(closure.id);
        setClosureDate(closure.date || getRecordDate(closure.closureDateTime || closure.fecha) || todayString());
        setMessage(`Cargado ${closure.cashboxName || closure.cajaName || 'cierre SICAR'} ${closure.corId || closure.cor_id || ''}.`);
    };

    const loadWaitingClosure = (closure) => {
        setClosureSuccessOpen(false);
        setActiveClosureDocId(closure.id || '');
        setClosureDate(closure.date || todayString());
        setCashierName(closure.cashierName || '');
        setSelectedClosureId(closure.linkedSicarClosureId || '');
        setCashCount(closure.cashCount || {});
        setDollarCashCount(closure.dollarCashCount || {});
        setPreCloseDeposit(closure.preCloseDeposit || { cordobas: '', dollars: '' });
        setTransfers({ bac: [], bac2: [], banpro: [], lafise: [], bacUsd: [], lafiseUsd: [], ...(closure.transferDetails || {}) });
        setPosDetails(closure.posDetails || { bac: [], banpro: [], lafise: [] });
        setHouseDiscountDetails(normalizeHouseDiscountDetails(closure.houseDiscountDetails || closure.discountDetails));
        const loadedInvoices = (closure.stampedInvoiceDrafts || closure.stampedInvoices || []).map((invoice) => createInvoiceDraft(invoice, closure.date || todayString()));
        setClosureInvoices(loadedInvoices);
        const loadedReceipts = (closure.cashReceiptDrafts || closure.cashReceipts || []).map((receipt) => createCashReceiptDraft(receipt, closure.date || todayString()));
        setClosureCashReceipts(loadedReceipts);
        setActiveClosureInvoiceLocalId(loadedInvoices[0]?.localId || '');
        setNotes(closure.notes || '');
        setMessage(`Cierre en espera cargado: ${closure.date || ''}.`);
    };

    const addClosureInvoice = (invoice) => {
        const draft = createInvoiceDraft(invoice, closureDate);
        const existing = draft.docId ? closureInvoices.find((item) => item.docId === draft.docId) : null;
        if (existing) {
            setActiveClosureInvoiceLocalId(existing.localId);
            setMessage(`Factura ${existing.invoiceNumber || invoice.invoiceNumber || ''} ya estaba agregada al cierre.`);
            return;
        }
        setClosureInvoices((prev) => [...prev, draft]);
        setActiveClosureInvoiceLocalId(draft.localId);
    };

    const toggleClosureInvoice = (invoice, checked) => {
        if (checked) {
            addClosureInvoice(invoice);
            return;
        }
        const removed = closureInvoices.find((item) => item.docId === invoice.id);
        const next = closureInvoices.filter((item) => item.docId !== invoice.id);
        setClosureInvoices(next);
        if (removed?.localId === activeClosureInvoiceLocalId) {
            setActiveClosureInvoiceLocalId(next[0]?.localId || '');
        }
    };

    const addClosureCashReceipt = (receipt) => {
        const draft = createCashReceiptDraft(receipt, closureDate);
        const receiptId = draft.docId || draft.id;
        const existing = receiptId ? closureCashReceipts.find((item) => (item.docId || item.id) === receiptId) : null;
        if (existing) {
            setMessage(`Recibo ${existing.receiptNumber || receipt.receiptNumber || ''} ya estaba agregado al cierre.`);
            return;
        }
        setClosureCashReceipts((prev) => [...prev, draft]);
    };

    const toggleClosureCashReceipt = (receipt, checked) => {
        const receiptId = receipt.docId || receipt.id;
        if (checked) {
            addClosureCashReceipt(receipt);
            return;
        }
        setClosureCashReceipts((prev) => prev.filter((item) => (item.docId || item.id) !== receiptId));
    };

    const removeClosureCashReceipt = (receiptId) => {
        setClosureCashReceipts((prev) => prev.filter((item) => (item.docId || item.id || item.localId) !== receiptId));
    };

    const addBlankClosureInvoice = () => {
        const draft = createInvoiceDraft({ date: closureDate }, closureDate);
        setClosureInvoices((prev) => [...prev, draft]);
        setActiveClosureInvoiceLocalId(draft.localId);
    };

    const removeClosureInvoice = (localId) => {
        const next = closureInvoices.filter((invoice) => invoice.localId !== localId);
        setClosureInvoices(next);
        if (localId === activeClosureInvoiceLocalId) {
            setActiveClosureInvoiceLocalId(next[0]?.localId || '');
        }
    };

    const addQuickClosureInvoice = () => {
        const query = String(quickInvoiceNumber || '').trim();
        if (!query) return;
        if (!cashierName) {
            setMessage('Selecciona cajero antes de agregar facturas al cierre.');
            return;
        }
        const normalizedQuery = normalizeText(query);
        const invoice = cashierStampedInvoices.find((item) => normalizeText(item.invoiceNumber || item.numeroFactura || '') === normalizedQuery);
        if (!invoice) {
            setMessage(`No encontre la factura ${query} en las membretadas del dia ${closureDate} para ${cashierName}.`);
            return;
        }
        addClosureInvoice(invoice);
        setQuickInvoiceNumber('');
        setMessage(`Factura ${invoice.invoiceNumber || query} agregada al cierre.`);
    };

    const updateClosureInvoice = (localId, key, value) => {
        if (key === 'invoiceNumber') {
            const currentInvoice = closureInvoices.find((invoice) => invoice.localId === localId) || {};
            const duplicate = findStampedInvoiceNumberDuplicate(
                stampedInvoices,
                value,
                getInvoiceRecordIdentityKeys(currentInvoice),
                { ...invoiceBranchPayload, ...currentInvoice }
            );
            if (duplicate) {
                setMessage(buildDuplicateInvoiceNumberMessage(value, duplicate));
                return;
            }
        }

        setClosureInvoices((prev) => prev.map((invoice) => {
            if (invoice.localId !== localId) return invoice;
            const next = { ...invoice, [key]: value };
            if (key === 'subtotal' || key === 'iva') {
                next.total = String(safeNumber(next.subtotal) + safeNumber(next.iva));
            }
            if (key === 'paymentMethod') {
                next.paymentBreakdown = [];
                next.paymentNetTotal = 0;
            }
            return next;
        }));
    };

    const updateClosureInvoiceFile = (localId, key, file) => {
        setClosureInvoices((prev) => prev.map((invoice) => (
            invoice.localId === localId
                ? { ...invoice, supportFiles: { ...(invoice.supportFiles || {}), [key]: file } }
                : invoice
        )));
    };

    const upsertClientRecord = async (name, source = 'manual') => {
        const safeName = String(name || '').trim();
        if (!safeName) return '';
        const code = `CLI-${slugify(safeName)}`;
        await setDoc(doc(db, 'clientes_facturacion', code), {
            code,
            name: safeName,
            normalizedName: normalizeText(safeName),
            source,
            updatedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
        }, { merge: true });
        return code;
    };

    const upsertCashierRecord = async (name, source = 'manual') => {
        const safeName = String(name || '').trim();
        if (!safeName) return '';
        const code = `CAJ-${slugify(safeName)}`;
        await setDoc(doc(db, 'cajeros', code), {
            code,
            name: safeName,
            normalizedName: normalizeText(safeName),
            source,
            updatedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
        }, { merge: true });
        return code;
    };

    const requestCreateClient = async (name) => {
        const safeName = String(name || '').trim();
        if (!safeName) return;
        if (recordExistsByName(clients, safeName)) {
            setMessage(`Cliente ya existe: ${safeName}.`);
            return;
        }
        if (!window.confirm(`El cliente "${safeName}" no existe. Deseas agregarlo a la base de clientes?`)) return;
        await upsertClientRecord(safeName, 'manual_facturacion');
        setMessage(`Cliente agregado a la base: ${safeName}.`);
    };

    const updateTransfer = (bank, index, field, value) => {
        setTransfers((prev) => ({
            ...prev,
            [bank]: (prev[bank] || []).map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)),
        }));
    };

    const updatePos = (bank, index, field, value) => {
        setPosDetails((prev) => ({
            ...prev,
            [bank]: (prev[bank] || []).map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)),
        }));
    };

    const updateHouseDiscount = (index, field, value) => {
        setHouseDiscountDetails((prev) => (
            prev.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row))
        ));
    };

    const deleteWaitingClosure = async (closure) => {
        if (!closure?.id) return;
        if (!window.confirm(`Eliminar el cierre en espera de ${closure.date || 'sin fecha'}? Esta accion no afecta SICAR ni cierres ya cerrados.`)) return;
        setSaving(true);
        setMessage('');
        try {
            const invoiceIds = [
                ...(Array.isArray(closure.stampedInvoiceIds) ? closure.stampedInvoiceIds : []),
                ...(Array.isArray(closure.stampedInvoices) ? closure.stampedInvoices : []),
                ...(Array.isArray(closure.stampedInvoiceDrafts) ? closure.stampedInvoiceDrafts : []),
            ]
                .map((invoice) => (typeof invoice === 'string' ? invoice : invoice.id || invoice.docId))
                .filter(Boolean);
            const receiptIds = [
                ...(Array.isArray(closure.cashReceiptIds) ? closure.cashReceiptIds : []),
                ...(Array.isArray(closure.cashReceipts) ? closure.cashReceipts : []),
                ...(Array.isArray(closure.cashReceiptDrafts) ? closure.cashReceiptDrafts : []),
            ]
                .map((receipt) => (typeof receipt === 'string' ? receipt : receipt.id || receipt.docId))
                .filter(Boolean);

            await Promise.all([...new Set(invoiceIds)].map(async (invoiceId) => {
                const invoiceRef = doc(db, 'facturas_membretadas_ventas', invoiceId);
                const invoiceSnap = await getDoc(invoiceRef);
                if (!invoiceSnap.exists()) return;
                await setDoc(invoiceRef, {
                    status: 'active',
                    closureStatus: '',
                    linkedCashClosureId: '',
                    linkedSicarClosureId: '',
                    linkedSicarCorId: null,
                    reconciledAt: null,
                    unlinkedFromCashClosureId: closure.id,
                    unlinkedFromCashClosureAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                }, { merge: true });
            }));

            await Promise.all([...new Set(receiptIds)].map((receiptId) => setDoc(doc(db, 'recibos_caja_membretados', receiptId), {
                status: 'active',
                closureStatus: '',
                linkedCashClosureId: '',
                linkedSicarClosureId: '',
                linkedSicarCorId: null,
                reconciledAt: null,
                unlinkedFromCashClosureId: closure.id,
                unlinkedFromCashClosureAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            }, { merge: true })));

            await deleteDoc(doc(db, 'cierres_caja', closure.id));
            if (activeClosureDocId === closure.id) {
                setActiveClosureDocId('');
                setCashCount({});
                setDollarCashCount({});
                setPreCloseDeposit({ cordobas: '', dollars: '' });
                setTransfers({ bac: [], bac2: [], banpro: [], lafise: [], bacUsd: [], lafiseUsd: [] });
                setPosDetails({ bac: [], banpro: [], lafise: [] });
                setClosureInvoices([]);
                setClosureCashReceipts([]);
                setActiveClosureInvoiceLocalId('');
                setQuickInvoiceNumber('');
                setNotes('');
            }
            setMessage('Cierre en espera eliminado.');
        } catch (error) {
            console.error(error);
            setMessage(error?.message || 'No se pudo eliminar el cierre en espera.');
        } finally {
            setSaving(false);
        }
    };

    const ensurePeopleRecords = async () => {
        const touchedClients = new Set();
        Object.values(transfers).flat().forEach((row) => {
            const name = String(row.clientName || '').trim();
            if (name) touchedClients.add(name);
        });

        closureInvoices.forEach((invoice) => {
            const name = String(invoice.customerName || '').trim();
            if (name) touchedClients.add(name);
        });

        closureCashReceipts.forEach((receipt) => {
            const name = String(receipt.customerName || '').trim();
            if (name) touchedClients.add(name);
        });

        await Promise.all([...touchedClients].map((name) => upsertClientRecord(name, 'cierre_caja')));

        const safeCashierName = String(cashierName || '').trim();
        if (safeCashierName) {
            await upsertCashierRecord(safeCashierName, 'cierre_caja');
        }
    };

    const saveClosure = async (mode = 'closed') => {
        setMessage('');
        const safeCashierName = String(cashierName || '').trim();
        if (!safeCashierName) {
            setMessage('Selecciona cajero antes de guardar el cierre.');
            return;
        }
        if (mode !== 'waiting' && (!selectedClosureId || !selectedClosure)) {
            setMessage('Carga un cierre SICAR antes de cerrar caja.');
            return;
        }
        if (mode !== 'waiting' && missingClosureInvoices.length) {
            setMessage(buildMissingClosureInvoiceMessage(missingClosureInvoices[0]));
            return;
        }
        if (mode !== 'waiting') {
            try {
                assertCashClosureRcAllowed(closureAccountingSummary);
            } catch (error) {
                setMessage(error?.message || CASH_CLOSURE_POSITIVE_RC_MESSAGE);
                return;
            }
        }
        setSaving(true);
        try {
            await ensurePeopleRecords();
            const cashierCode = getCashierCode(safeCashierName);
            const docId = activeClosureDocId || (selectedClosure?.corId
                ? `cierre_${selectedBranchId}_${closureDate}_${selectedClosure.corId}`
                : `cierre_${selectedBranchId}_${closureDate}_${Date.now()}`);
            const isWaiting = mode === 'waiting';
            const validInvoiceDrafts = closureInvoices.filter(hasInvoiceDraftContent);
            const validCashReceiptDrafts = closureCashReceipts.filter((receipt) => receipt.docId || receipt.id || safeNumber(receipt.amount));
            const savedInvoices = [];
            const savedCashReceipts = [];

            assertUniqueStampedInvoiceNumbers(
                validInvoiceDrafts.map((invoice) => ({ ...invoiceBranchPayload, ...invoice })),
                stampedInvoices
            );

            const preparedInvoiceDrafts = validInvoiceDrafts.map((invoice) => {
                if (!String(invoice.invoiceNumber || '').trim()) {
                    throw new Error('Cada factura membretada del cierre necesita numero de factura.');
                }

                const invoiceDate = invoice.date || closureDate;
                const invoiceCashierName = String(invoice.cashierName || safeCashierName).trim();
                const invoiceCashierCode = getCashierCode(invoiceCashierName);
                const invoiceDocId = invoice.docId || buildBranchScopedFiscalDocId('membretada', invoiceBranchPayload, invoice.invoiceNumber, invoiceDate);
                const fiscal = buildFiscalPayload({
                    subtotal: safeNumber(invoice.subtotal),
                    iva: safeNumber(invoice.iva),
                    total: safeNumber(invoice.total) || safeNumber(invoice.subtotal) + safeNumber(invoice.iva),
                    retentionIr2: safeNumber(invoice.retentionIr2),
                    retentionMunicipal1: safeNumber(invoice.retentionMunicipal1),
                });

                return {
                    ...invoiceBranchPayload,
                    ...invoice,
                    wasExistingDoc: Boolean(invoice.docId),
                    id: invoiceDocId,
                    docId: invoiceDocId,
                    date: invoiceDate,
                    saleDate: invoiceDate,
                    subtotal: fiscal.subtotal,
                    iva: fiscal.iva,
                    total: fiscal.total,
                    retentionIr2: fiscal.retentionIr2,
                    retentionMunicipal1: fiscal.retentionMunicipal1,
                    retentionTotal: fiscal.retentionTotal,
                    netTotal: fiscal.netTotal,
                    cashierName: invoiceCashierName,
                    cashierCode: invoiceCashierCode,
                    paymentMethod: getInvoicePaymentMethodLabel(invoice),
                    paymentBreakdown: normalizePaymentBreakdownRows(invoice.paymentBreakdown),
                    paymentNetTotal: safeNumber(invoice.paymentNetTotal || getPaymentBreakdownTotal(invoice.paymentBreakdown) || getInvoicePaymentTargetAmount({ ...invoice, ...fiscal })),
                    supportFiles: invoice.supportFiles || {},
                };
            });

            if (!isWaiting) {
            for (const invoice of preparedInvoiceDrafts) {
                const paymentBreakdown = validatePaymentBreakdownForInvoice(invoice);
                const paymentMethod = getPaymentMethodFromBreakdown(paymentBreakdown, invoice.paymentMethod);
                const invoiceDocId = invoice.docId;
                const existingInvoice = stampedInvoices.find((item) => item.id === invoiceDocId) || {};
                const supportPayload = await uploadFiscalSupportFiles(
                    invoice.supportFiles || {},
                    'facturacion/facturas_membretadas',
                    invoiceDocId,
                    existingInvoice
                );
                const invoicePayload = {
                    ...buildInvoiceDocumentFields(invoice, invoiceBranchPayload),
                    date: invoice.date,
                    saleDate: invoice.saleDate || invoice.date,
                    month: getMonth(invoice.date),
                    numeroFactura: String(invoice.invoiceNumber || '').trim(),
                    invoiceNumber: String(invoice.invoiceNumber || '').trim(),
                    customerName: String(invoice.customerName || '').trim(),
                    cashierName: invoice.cashierName || safeCashierName,
                    cashierCode: invoice.cashierCode || getCashierCode(invoice.cashierName || safeCashierName),
                    paymentMethod: String(paymentMethod || '').trim(),
                    paymentBreakdown,
                    paymentNetTotal: paymentBreakdown.length ? getPaymentBreakdownTotal(paymentBreakdown) : getInvoicePaymentTargetAmount(invoice),
                    subtotal: safeNumber(invoice.subtotal),
                    iva: safeNumber(invoice.iva),
                    total: safeNumber(invoice.total),
                    retentionIr2: safeNumber(invoice.retentionIr2),
                    retentionMunicipal1: safeNumber(invoice.retentionMunicipal1),
                    retentionTotal: safeNumber(invoice.retentionTotal),
                    netTotal: safeNumber(invoice.netTotal),
                    amount: safeNumber(invoice.subtotal),
                    source: invoice.sourceSicarInvoiceId ? 'sicar_factura' : (invoice.source || (invoice.wasExistingDoc ? 'manual' : 'cierre_caja')),
                    sourceType: 'stamped_sale_invoice',
                    sourceSicarInvoiceId: invoice.sourceSicarInvoiceId || '',
                    status: 'conciliada',
                    closureStatus: 'conciliada',
                    linkedCashClosureId: docId,
                    linkedSicarClosureId: selectedClosure?.id || '',
                    linkedSicarCorId: selectedClosure?.corId || selectedClosure?.cor_id || null,
                    reconciledAt: serverTimestamp(),
                    ...supportPayload,
                    updatedAt: serverTimestamp(),
                    createdAt: serverTimestamp(),
                };

                await setDoc(doc(db, 'facturas_membretadas_ventas', invoiceDocId), invoicePayload, { merge: true });
                savedInvoices.push({
                    localId: invoice.localId,
                    id: invoiceDocId,
                    docId: invoiceDocId,
                    ...invoicePayload,
                    total: safeNumber(invoice.total),
                    retentionTotal: safeNumber(invoice.retentionTotal),
                });
            }
            }

            const preparedCashReceiptDrafts = validCashReceiptDrafts.map((receipt) => createCashReceiptDraft(receipt, closureDate));

            if (!isWaiting) {
            for (const receipt of preparedCashReceiptDrafts) {
                const receiptDocId = receipt.docId || receipt.id;
                if (!receiptDocId) continue;
                const receiptPayload = {
                    ...buildReceiptDocumentFields(receipt, receiptBranchPayload),
                    status: 'conciliado',
                    closureStatus: 'conciliado',
                    linkedCashClosureId: docId,
                    linkedSicarClosureId: selectedClosure?.id || '',
                    linkedSicarCorId: selectedClosure?.corId || selectedClosure?.cor_id || null,
                    reconciledAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                };

                await setDoc(doc(db, 'recibos_caja_membretados', receiptDocId), receiptPayload, { merge: true });
                savedCashReceipts.push({
                    ...receipt,
                    id: receiptDocId,
                    docId: receiptDocId,
                    ...receiptPayload,
                    reconciledAt: null,
                });
            }
            }

            const payload = {
                ...branchPayload,
                date: closureDate,
                month: getMonth(closureDate),
                status: isWaiting ? 'en_espera' : (shouldTrackDifference ? 'con_diferencia' : 'cuadrado'),
                cashierName: safeCashierName,
                cashierCode,
                linkedSicarClosureId: selectedClosure?.id || '',
                linkedSicarCorId: selectedClosure?.corId || selectedClosure?.cor_id || null,
                linkedSicarRccId: selectedClosure?.rccId || selectedClosure?.rcc_id || null,
                sicar: selectedClosure || null,
                sicarExpected,
                cashSalesGrossTotal: sicarNetSalesTotals.cashSalesGrossTotal,
                cancelledCashSalesTotal: sicarNetSalesTotals.cancelledCashSalesTotal,
                cashSalesNetTotal: sicarNetSalesTotals.cashSalesNetTotal,
                cashSalesTotal: sicarCashSalesTotal,
                creditSalesGrossTotal: sicarNetSalesTotals.creditSalesGrossTotal,
                cancelledCreditSalesTotal: sicarNetSalesTotals.cancelledCreditSalesTotal,
                creditSalesNetTotal: sicarNetSalesTotals.creditSalesNetTotal,
                creditSalesTotal: sicarCreditSalesTotal,
                creditRecoveryTotal: sicarCreditRecoveryTotal,
                retentionAdjustment: retentionTotal,
                expectedAfterRetentions,
                accountingSummary: closureAccountingSummary,
                cashCount,
                cashCordobasTotal: safeNumber(cashTotal),
                dollarCashCount,
                dollarCashTotal: safeNumber(dollarCashTotal),
                exchangeRate: CASH_CLOSURE_EXCHANGE_RATE,
                dollarCashTotalCordobas,
                preCloseDeposit: {
                    cordobas: preCloseDepositCordobas,
                    dollars: preCloseDepositDollars,
                    exchangeRate: CASH_CLOSURE_EXCHANGE_RATE,
                    totalCordobas: preCloseDepositTotal,
                },
                preCloseDepositTotal,
                cashTotal: safeNumber(cashClosureTotal),
                transferDetails: transfers,
                transferTotals,
                transferUsdExchangeRate: TRANSFER_USD_EXCHANGE_RATE,
                posDetails,
                posTotals,
                houseDiscountDetails: normalizeHouseDiscountDetails(houseDiscountDetails),
                houseDiscountTotal,
                manualTotal,
                difference,
                stampedInvoiceIds: isWaiting ? [] : savedInvoices.map((invoice) => invoice.id),
                stampedInvoices: isWaiting ? [] : savedInvoices.map((invoice) => ({
                    ...buildInvoiceDocumentFields(invoice, invoiceBranchPayload),
                    id: invoice.id,
                    invoiceNumber: invoice.invoiceNumber,
                    date: invoice.saleDate || invoice.date,
                    cashierName: invoice.cashierName || safeCashierName,
                    cashierCode: invoice.cashierCode || getCashierCode(invoice.cashierName || safeCashierName),
                    subtotal: safeNumber(invoice.subtotal),
                    iva: safeNumber(invoice.iva),
                    total: safeNumber(invoice.total),
                    retentionIr2: safeNumber(invoice.retentionIr2),
                    retentionMunicipal1: safeNumber(invoice.retentionMunicipal1),
                    retentionTotal: safeNumber(invoice.retentionTotal),
                    paymentMethod: invoice.paymentMethod,
                    paymentBreakdown: normalizePaymentBreakdownRows(invoice.paymentBreakdown),
                    paymentNetTotal: safeNumber(invoice.paymentNetTotal),
                })),
                stampedInvoiceDrafts: isWaiting ? preparedInvoiceDrafts.map((invoice) => ({
                    ...invoice,
                    supportFiles: {},
                })) : [],
                cashReceiptIds: isWaiting ? [] : savedCashReceipts.map((receipt) => receipt.id),
                cashReceipts: isWaiting ? [] : savedCashReceipts.map((receipt) => ({
                    ...buildReceiptDocumentFields(receipt, receiptBranchPayload),
                    id: receipt.id,
                    docId: receipt.docId,
                    receiptNumber: receipt.receiptNumber,
                    date: receipt.date,
                    customerName: receipt.customerName,
                    amount: safeNumber(receipt.amount),
                    retentionIr2: safeNumber(receipt.retentionIr2),
                    retentionMunicipal1: safeNumber(receipt.retentionMunicipal1),
                    retentionTotal: getCashReceiptRetentionTotal(receipt),
                    netAmount: safeNumber(receipt.netAmount),
                    concept: receipt.concept,
                    paymentMethod: receipt.paymentMethod,
                    status: receipt.status,
                    closureStatus: receipt.closureStatus,
                })),
                cashReceiptDrafts: isWaiting ? preparedCashReceiptDrafts.map((receipt) => ({
                    ...receipt,
                    docId: receipt.docId || receipt.id || '',
                })) : [],
                manualTotalWithRetentions,
                notes,
                source: 'manual_app',
                sourceType: 'cash_closure',
                updatedAt: serverTimestamp(),
                createdAt: serverTimestamp(),
            };

            const cleanPayload = sanitizeFirestoreData(payload);
            await setDoc(doc(db, 'cierres_caja', docId), cleanPayload, { merge: true });
            setActiveClosureDocId(docId);

            if (!isWaiting && cashierCode && shouldTrackDifference) {
                const pendingAmount = Math.abs(difference);
                await setDoc(doc(db, 'diferencias_caja', `${docId}_${cashierCode}`), {
                    ...branchPayload,
                    closureId: docId,
                    date: closureDate,
                    month: getMonth(closureDate),
                    cashierName,
                    cashierCode,
                    amount: difference,
                    pendingAmount,
                    saldo: pendingAmount,
                    paidAmount: 0,
                    differenceType: getCashDifferenceType(difference),
                    threshold: CASH_DIFFERENCE_THRESHOLD,
                    status: 'pendiente',
                    source: 'cierre_caja',
                    updatedAt: serverTimestamp(),
                    createdAt: serverTimestamp(),
                }, { merge: true });
            }

            if (isWaiting) {
                setMessage('Cierre guardado en espera. Podes volver y continuar luego.');
            } else {
                setLastSavedClosure({ id: docId, ...cleanPayload });
                resetClosureWorkspace();
                setClosureSuccessOpen(true);
            }
        } catch (error) {
            console.error(error);
            setMessage(error?.message || 'No se pudo guardar el cierre.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
        {closureSuccessOpen && (
            <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
                <div className="w-full max-w-md rounded-[2rem] border border-emerald-100 bg-white p-7 text-center shadow-2xl shadow-slate-950/25">
                    <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 shadow-inner">
                        <svg viewBox="0 0 24 24" className="h-11 w-11" aria-hidden="true">
                            <path
                                fill="none"
                                stroke="currentColor"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2.6"
                                d="M5 12.5l4.3 4.3L19 7"
                            />
                        </svg>
                    </div>
                    <div className="mt-5 text-[11px] font-black uppercase tracking-[0.28em] text-emerald-700">Conciliacion completada</div>
                    <h3 className="mt-2 text-2xl font-black text-slate-950">Cierre guardado exitosamente</h3>
                    <p className="mt-3 text-sm font-bold leading-6 text-slate-500">
                        El cierre quedo registrado y la pantalla ya esta limpia para iniciar un nuevo cierre.
                    </p>
                    <button
                        type="button"
                        onClick={printCashClosureTicket}
                        disabled={!lastSavedClosure}
                        className="mt-6 w-full rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm font-black uppercase tracking-[0.2em] text-slate-800 transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Imprimir ticket 80mm
                    </button>
                    <button
                        type="button"
                        onClick={() => setClosureSuccessOpen(false)}
                        className="mt-3 w-full rounded-2xl bg-emerald-600 px-5 py-4 text-sm font-black uppercase tracking-[0.2em] text-white shadow-lg shadow-emerald-950/20 transition hover:-translate-y-0.5 hover:bg-emerald-700"
                    >
                        Iniciar nuevo cierre
                    </button>
                </div>
            </div>
        )}
        <CashClosureTicketPrint closure={lastSavedClosure} />
        <div className="grid gap-5 xl:grid-cols-[0.9fr_1.3fr]">
            <div className="space-y-5">
                <Section
                    title="Cierres SICAR disponibles"
                    eyebrow="Integracion"
                    action={<Badge tone="blue">{sicarClosures.length} cierres</Badge>}
                >
                <div className="space-y-3">
                    <SearchBox
                        value={sicarClosureSearch}
                        onChange={setSicarClosureSearch}
                        placeholder="Buscar por numero de cierre, fecha, caja o RCC..."
                        resultLabel={`${filteredSicarClosures.length} de ${sicarClosures.length}`}
                    />
                </div>
                <div className="mt-3 max-h-[34rem] space-y-3 overflow-y-auto pr-1">
                    {waitingClosures.length > 0 && (
                        <div className="mb-4 rounded-3xl border border-amber-200 bg-amber-50 p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                                <div className="text-xs font-black uppercase tracking-[0.22em] text-amber-700">Cierres en espera</div>
                                <Badge tone="amber">{waitingClosures.length}</Badge>
                            </div>
                            <div className="space-y-2">
                                {waitingClosures.map((closure) => (
                                    <div
                                        key={closure.id}
                                        className="rounded-2xl border border-amber-200 bg-white p-3 transition hover:border-amber-400"
                                    >
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                            <div>
                                                <div className="text-sm font-black text-slate-950">{closure.cashierName || 'Sin cajero'}</div>
                                                <div className="text-xs font-bold text-slate-500">{closure.date} · {closure.linkedSicarCorId ? `Corte ${closure.linkedSicarCorId}` : 'Manual'}</div>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <div className="font-mono text-sm font-black text-amber-700">{fmt(closure.manualTotal || 0)}</div>
                                                <button
                                                    type="button"
                                                    onClick={() => loadWaitingClosure(closure)}
                                                    className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-amber-800 transition hover:bg-amber-100"
                                                >
                                                    Continuar
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => deleteWaitingClosure(closure)}
                                                    disabled={saving}
                                                    className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-red-700 transition hover:bg-red-100 disabled:opacity-60"
                                                >
                                                    Eliminar
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {sicarClosures.length === 0 ? (
                        <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-center text-sm font-bold text-slate-400">
                            No hay cierres SICAR pendientes desde 14/06/2026. Si acabas de cerrar caja, espera el refresco automatico.
                        </div>
                    ) : filteredSicarClosures.length === 0 ? (
                        <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-center text-sm font-bold text-slate-400">
                            No hay cierres que coincidan con la busqueda.
                        </div>
                    ) : pagedSicarClosures.records.map((closure) => (
                        <button
                            key={closure.id}
                            type="button"
                            onClick={() => loadClosure(closure)}
                            onDoubleClick={() => loadClosure(closure)}
                            className={`w-full rounded-3xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lg ${
                                selectedClosureId === closure.id
                                    ? 'border-[#e30613] bg-red-50 shadow-red-950/10'
                                    : 'border-slate-200 bg-white hover:border-slate-300'
                            }`}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="text-sm font-black text-slate-950">{closure.cashboxName || closure.cajaName || `Caja ${closure.cashboxId || ''}`}</div>
                                    <div className="text-xs font-bold text-slate-500">{closure.date} · Corte {closure.corId || closure.cor_id}</div>
                                </div>
                                <div className="font-mono text-sm font-black text-[#e30613]">{fmt(closure.calculatedTotal ?? closure.calculado ?? 0)}</div>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-500">
                                <span>Ventas contado neta: {fmt(closure.cashSalesNetTotal ?? closure.cashSalesTotal ?? closure.ventasContado ?? 0)}</span>
                                <span>Recup. credito: {fmt(closure.creditRecoveryTotal ?? closure.recuperacionCredito ?? 0)}</span>
                                <span>Ventas credito neta: {fmt(closure.creditSalesNetTotal ?? closure.creditSalesTotal ?? closure.ventasCredito ?? 0)}</span>
                                <span>Diferencia SICAR: {fmt(closure.sicarDifference ?? closure.diferencia ?? 0)}</span>
                                <span>RCC: {closure.rccId || closure.rcc_id || '-'}</span>
                            </div>
                        </button>
                    ))}
                </div>
                <div className="mt-3">
                    <PaginationControls
                        page={pagedSicarClosures.page}
                        totalPages={pagedSicarClosures.totalPages}
                        total={filteredSicarClosures.length}
                        start={pagedSicarClosures.start}
                        end={pagedSicarClosures.end}
                        onPageChange={setSicarClosurePage}
                    />
                </div>
                </Section>

                <Section title="Transferencias por cliente" eyebrow="Detalle bancario">
                    <div className="grid gap-4">
                        {TRANSFER_BANKS.map((bank) => (
                            <DetailRows
                                key={bank.key}
                                title={`Transferencia ${bank.label} - ${fmt(transferTotals[bank.key])}${bank.currency === 'USD' ? ` / TC ${TRANSFER_USD_EXCHANGE_RATE.toFixed(2)}` : ''}`}
                                rows={transfers[bank.key] || []}
                                type="transfer"
                                clients={clients}
                                currency={bank.currency || 'NIO'}
                                exchangeRate={getTransferBankExchangeRate(bank)}
                                onCreateClient={requestCreateClient}
                                onAdd={() => setTransfers((prev) => ({ ...prev, [bank.key]: [...(prev[bank.key] || []), emptyTransfer()] }))}
                                onRemove={(index) => setTransfers((prev) => ({ ...prev, [bank.key]: (prev[bank.key] || []).filter((_, rowIndex) => rowIndex !== index) }))}
                                onChange={(index, field, value) => updateTransfer(bank.key, index, field, value)}
                            />
                        ))}
                    </div>
                </Section>

                <Section title="Cierres POS" eyebrow="Baucher / lote POS">
                    <div className="grid gap-4">
                        {POS_BANKS.map((bank) => (
                            <DetailRows
                                key={bank.key}
                                title={`POS ${bank.label} · ${fmt(posTotals[bank.key])}`}
                                rows={posDetails[bank.key] || []}
                                type="pos"
                                onAdd={() => setPosDetails((prev) => ({ ...prev, [bank.key]: [...(prev[bank.key] || []), emptyPos()] }))}
                                onRemove={(index) => setPosDetails((prev) => ({ ...prev, [bank.key]: (prev[bank.key] || []).filter((_, rowIndex) => rowIndex !== index) }))}
                                onChange={(index, field, value) => updatePos(bank.key, index, field, value)}
                            />
                        ))}
                    </div>
                </Section>

                <Section title="Descuentos de la casa" eyebrow="Ajustes autorizados">
                    <DetailRows
                        title={`Descuentos de la casa - ${fmt(houseDiscountTotal)}`}
                        rows={houseDiscountDetails}
                        type="discount"
                        onAdd={() => setHouseDiscountDetails((prev) => [...prev, emptyHouseDiscount()])}
                        onRemove={(index) => setHouseDiscountDetails((prev) => prev.filter((_, rowIndex) => rowIndex !== index))}
                        onChange={updateHouseDiscount}
                    />
                </Section>

            </div>

            <div className="space-y-5">
                <Section title="Cierre de caja" eyebrow="Formulario operativo" action={<Badge tone={shouldTrackDifference ? 'red' : 'green'}>{shouldTrackDifference ? 'Con diferencia' : 'Cuadrado'}</Badge>}>
                    <div className="grid gap-4 md:grid-cols-3">
                        <Field label="Fecha de cierre">
                            <input className={inputClass} type="date" value={closureDate} onChange={(event) => setClosureDate(event.target.value)} />
                        </Field>
                        <Field label="Cajero">
                            <select className={inputClass} value={cashierName} onChange={(event) => setCashierName(event.target.value)}>
                                <option value="">Seleccionar cajero...</option>
                                {CASHIER_OPTIONS.map((cashier) => (
                                    <option key={cashier} value={cashier}>{cashier}</option>
                                ))}
                            </select>
                        </Field>
                        <Field label="Cierre SICAR">
                            <select className={inputClass} value={selectedClosureId} onChange={(event) => setSelectedClosureId(event.target.value)} required>
                                <option value="">Sin cargar</option>
                                {sicarClosures.map((closure) => (
                                    <option key={closure.id} value={closure.id}>
                                        {closure.date} · {closure.cashboxName || closure.cajaName} · {closure.corId || closure.cor_id}
                                    </option>
                                ))}
                            </select>
                        </Field>
                    </div>

                    <div className="mt-5 grid gap-3 md:grid-cols-4">
                        <SummaryCard label="SICAR esperado" value={fmt(sicarExpected)} tone="blue" />
                        <SummaryCard label="Retenciones membretadas" value={fmt(retentionTotal)} tone="amber" />
                        <SummaryCard label="App + retenciones" value={fmt(manualTotalWithRetentions)} tone="slate" />
                        <SummaryCard label="Diferencia" value={fmt(difference)} tone={shouldTrackDifference ? 'red' : 'green'} />
                    </div>

                    {isClosureRcPositive && (
                        <div className="mt-5">
                            <CashClosureRcAlarm rc={closureRc} />
                        </div>
                    )}

                    {isMaster && (
                    <div className="mt-5">
                        <ClosureAccountingSummaryPanel summary={closureAccountingSummary} />
                    </div>
                    )}

                    <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                        <div className="mb-3 flex items-center justify-between">
                            <div>
                                <div className="text-sm font-black text-slate-950">Contador de dinero contado</div>
                                <div className="text-xs font-semibold text-slate-500">Cordobas, dolares y deposito pre-cierre. Tasa fija: C$ {CASH_CLOSURE_EXCHANGE_RATE.toFixed(2)}</div>
                            </div>
                            <div className="text-right">
                                <div className="font-mono text-xl font-black text-slate-950">{fmt(cashClosureTotal)}</div>
                                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Efectivo + pre-cierre</div>
                            </div>
                        </div>
                        <div className="mb-4 grid gap-3 md:grid-cols-2">
                            <Field label="Deposito pre-cierre cordobas">
                                <input
                                    className={inputClass}
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={preCloseDeposit.cordobas || ''}
                                    onChange={(event) => setPreCloseDeposit((prev) => ({ ...prev, cordobas: event.target.value }))}
                                    placeholder="0.00"
                                />
                            </Field>
                            <Field label="Deposito pre-cierre dolares">
                                <input
                                    className={inputClass}
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={preCloseDeposit.dollars || ''}
                                    onChange={(event) => setPreCloseDeposit((prev) => ({ ...prev, dollars: event.target.value }))}
                                    placeholder="0.00"
                                />
                            </Field>
                            <SummaryCard label="Pre-cierre convertido" value={fmt(preCloseDepositTotal)} tone="blue" />
                            <SummaryCard label="Dolares contado" value={`US$ ${dollarCashTotal.toFixed(2)} / ${fmt(dollarCashTotalCordobas)}`} tone="green" />
                        </div>
                        <div className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Conteo en cordobas</div>
                        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
                            {CASH_DENOMINATIONS.map((denomination) => (
                                <label key={denomination} className="rounded-2xl border border-slate-200 bg-white p-3">
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">C$ {denomination}</span>
                                    <input
                                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-black outline-none focus:border-[#e30613]"
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={cashCount[denomination] || ''}
                                        onChange={(event) => setCashCount((prev) => ({ ...prev, [denomination]: event.target.value }))}
                                    />
                                </label>
                            ))}
                        </div>
                        <div className="mb-2 mt-4 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Conteo en dolares</div>
                        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                            {USD_DENOMINATIONS.map((denomination) => (
                                <label key={denomination} className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3">
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">US$ {denomination}</span>
                                    <input
                                        className="mt-1 w-full rounded-xl border border-emerald-200 px-3 py-2 text-sm font-black outline-none focus:border-emerald-500"
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={dollarCashCount[denomination] || ''}
                                        onChange={(event) => setDollarCashCount((prev) => ({ ...prev, [denomination]: event.target.value }))}
                                    />
                                </label>
                            ))}
                        </div>
                    </div>
                </Section>

                <Section title="Facturas membretadas del cierre" eyebrow="Retenciones que reducen caja">
                    <div className="mb-4 flex flex-col gap-3 rounded-3xl border border-slate-200 bg-slate-50/70 p-4 xl:flex-row xl:items-center xl:justify-between">
                        <div>
                            <div className="text-sm font-black text-slate-950">Facturas aplicadas al cierre</div>
                            <div className="text-xs font-semibold text-slate-500">Se cargan automaticamente las facturas del dia {closureDate} registradas por el cajero seleccionado.</div>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <input
                                className={`${inputClass} min-w-0 sm:w-64`}
                                value={quickInvoiceNumber}
                                onChange={(event) => setQuickInvoiceNumber(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        addQuickClosureInvoice();
                                    }
                                }}
                                placeholder="Numero factura + Enter"
                            />
                            <button type="button" onClick={addQuickClosureInvoice} className="rounded-xl border border-[#e30613] bg-white px-4 py-2.5 text-xs font-black uppercase tracking-[0.16em] text-[#e30613] transition hover:bg-red-50">
                                Agregar rapido
                            </button>
                            <button type="button" onClick={addBlankClosureInvoice} className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-[#e30613]">
                                Manual
                            </button>
                        </div>
                    </div>

                    <div className="mb-4">
                        <SearchBox
                            value={closureInvoiceSearch}
                            onChange={setClosureInvoiceSearch}
                            placeholder="Buscar factura del dia por numero o cliente..."
                            resultLabel={`${filteredStampedInvoices.length} de ${cashierStampedInvoices.length} del cajero`}
                        />
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                        {!cashierName ? (
                            <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-center text-sm font-bold text-slate-400 md:col-span-2">
                                Selecciona un cajero para cargar automaticamente sus facturas membretadas.
                            </div>
                        ) : stampedInvoices.length === 0 ? (
                            <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-center text-sm font-bold text-slate-400 md:col-span-2">
                                No hay facturas membretadas guardadas todavia.
                            </div>
                        ) : filteredStampedInvoices.length === 0 ? (
                            <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-center text-sm font-bold text-slate-400 md:col-span-2">
                                No hay facturas membretadas del dia {closureDate} que coincidan con la busqueda.
                            </div>
                        ) : pagedStampedInvoices.records.map((invoice) => (
                            <label key={invoice.id} className="flex cursor-default items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-3">
                                <input
                                    type="checkbox"
                                    checked={selectedInvoiceIds.includes(invoice.id)}
                                    disabled
                                    onChange={(event) => toggleClosureInvoice(invoice, event.target.checked)}
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-black text-slate-950">Factura {invoice.invoiceNumber || '-'}</div>
                                    <div className="text-xs font-bold text-slate-500">{invoice.date} · {invoice.cashierName || 'Sin cajero'} · Ret. {fmt(invoice.retentionTotal)}</div>
                                </div>
                                <div className="font-mono text-sm font-black text-slate-900">{fmt(invoice.total)}</div>
                            </label>
                        ))}
                    </div>
                    <div className="mt-4">
                        <PaginationControls
                            page={pagedStampedInvoices.page}
                            totalPages={pagedStampedInvoices.totalPages}
                            total={filteredStampedInvoices.length}
                            start={pagedStampedInvoices.start}
                            end={pagedStampedInvoices.end}
                            onPageChange={setClosureInvoicePage}
                        />
                    </div>

                    <div className="mt-4 space-y-3">
                        {closureInvoices.length === 0 ? (
                            <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm font-bold text-slate-400">
                                No hay facturas aplicadas al cierre todavia.
                            </div>
                        ) : closureInvoices.map((invoice, index) => {
                            const isActive = activeClosureInvoiceLocalId === invoice.localId;
                            return (
                                <div key={invoice.localId} className={`rounded-3xl border bg-white p-4 shadow-sm transition ${isActive ? 'border-[#e30613] shadow-red-950/10' : 'border-slate-200'}`}>
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                        <div className="min-w-0">
                                            <div className="text-sm font-black text-slate-950">#{index + 1} · Factura {invoice.invoiceNumber || 'sin numero'}</div>
                                            <div className="mt-1 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
                                                <span>{invoice.date || closureDate}</span>
                                                <span>{invoice.customerName || 'Sin cliente'}</span>
                                                <span>{invoice.paymentMethod || 'Sin metodo'}</span>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <div className="rounded-2xl bg-slate-50 px-3 py-2 text-right">
                                                <div className="font-mono text-sm font-black text-slate-950">{fmt(invoice.total)}</div>
                                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Ret. {fmt(safeNumber(invoice.retentionIr2) + safeNumber(invoice.retentionMunicipal1))}</div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setActiveClosureInvoiceLocalId(invoice.localId)}
                                                className={`rounded-xl px-3 py-2 text-xs font-black uppercase tracking-[0.16em] transition ${isActive ? 'bg-[#e30613] text-white' : 'border border-slate-200 text-slate-700 hover:border-[#e30613] hover:text-[#e30613]'}`}
                                            >
                                                {isActive ? 'Editando' : 'Editar'}
                                            </button>
                                            <button type="button" onClick={() => removeClosureInvoice(invoice.localId)} className="rounded-xl border border-red-200 px-3 py-2 text-xs font-black text-red-700 transition hover:bg-red-50">
                                                Quitar
                                            </button>
                                        </div>
                                    </div>

                                    {isActive && (
                                        <div className="mt-4 rounded-3xl border border-red-100 bg-red-50/30 p-4">
                                            <div className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-[#e30613]">Edicion detallada</div>
                                            <div className="grid gap-3 md:grid-cols-2">
                                                <Field label="Numero de factura">
                                                    <input className={inputClass} value={invoice.invoiceNumber} onChange={(event) => updateClosureInvoice(invoice.localId, 'invoiceNumber', event.target.value)} />
                                                </Field>
                                                <Field label="Fecha">
                                                    <input className={inputClass} type="date" value={invoice.date} onChange={(event) => updateClosureInvoice(invoice.localId, 'date', event.target.value)} />
                                                </Field>
                                                <Field label="Cliente">
                                                    <input className={inputClass} list="billing-clients" value={invoice.customerName} onChange={(event) => updateClosureInvoice(invoice.localId, 'customerName', event.target.value)} placeholder="Cliente / razon social" />
                                                    {String(invoice.customerName || '').trim() && !recordExistsByName(clients, invoice.customerName) && (
                                                        <button
                                                            type="button"
                                                            onClick={() => requestCreateClient(invoice.customerName)}
                                                            className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700 transition hover:bg-emerald-100"
                                                        >
                                                            Agregar cliente
                                                        </button>
                                                    )}
                                                </Field>
                                                <Field label="Metodo de pago">
                                                    <PaymentMethodSelect value={invoice.paymentMethod} onChange={(value) => updateClosureInvoice(invoice.localId, 'paymentMethod', value)} />
                                                </Field>
                                                <Field label="Subtotal">
                                                    <input className={inputClass} type="number" step="0.01" min="0" value={invoice.subtotal} onChange={(event) => updateClosureInvoice(invoice.localId, 'subtotal', event.target.value)} />
                                                </Field>
                                                <Field label="IVA">
                                                    <input className={inputClass} type="number" step="0.01" min="0" value={invoice.iva} onChange={(event) => updateClosureInvoice(invoice.localId, 'iva', event.target.value)} />
                                                </Field>
                                                <Field label="Total">
                                                    <input className={inputClass} type="number" step="0.01" min="0" value={invoice.total} onChange={(event) => updateClosureInvoice(invoice.localId, 'total', event.target.value)} />
                                                </Field>
                                                <Field label="Retencion IR 2%">
                                                    <input className={inputClass} type="number" step="0.01" min="0" value={invoice.retentionIr2} onChange={(event) => updateClosureInvoice(invoice.localId, 'retentionIr2', event.target.value)} />
                                                </Field>
                                                <Field label="Retencion municipal 1%">
                                                    <input className={inputClass} type="number" step="0.01" min="0" value={invoice.retentionMunicipal1} onChange={(event) => updateClosureInvoice(invoice.localId, 'retentionMunicipal1', event.target.value)} />
                                                </Field>
                                            </div>

                                            <div className="mt-4 grid gap-3 md:grid-cols-3">
                                                <Field label="Foto factura">
                                                    <input className={inputClass} type="file" accept="image/*,application/pdf" onChange={(event) => updateClosureInvoiceFile(invoice.localId, 'invoice', event.target.files?.[0] || null)} />
                                                </Field>
                                                <Field label="Soporte IR 2%">
                                                    <input className={inputClass} type="file" accept="image/*,application/pdf" onChange={(event) => updateClosureInvoiceFile(invoice.localId, 'retentionIr2', event.target.files?.[0] || null)} />
                                                </Field>
                                                <Field label="Soporte municipal 1%">
                                                    <input className={inputClass} type="file" accept="image/*,application/pdf" onChange={(event) => updateClosureInvoiceFile(invoice.localId, 'retentionMunicipal1', event.target.files?.[0] || null)} />
                                                </Field>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <div className="mt-6 rounded-3xl border border-amber-200 bg-amber-50/30 p-4">
                        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                            <div>
                                <div className="text-sm font-black text-slate-950">Recibos de caja membretados</div>
                                <div className="text-xs font-semibold text-slate-500">
                                    Selecciona los recibos del dia que pertenecen a este cierre. Se restan de recuperacion de credito para calcular recibos ticket SICAR.
                                </div>
                            </div>
                            <Badge tone="amber">{fmt(closureCashReceipts.reduce((sum, receipt) => safeNumber(sum + safeNumber(receipt.amount)), 0))}</Badge>
                        </div>

                        <div className="mb-4">
                            <SearchBox
                                value={closureReceiptSearch}
                                onChange={setClosureReceiptSearch}
                                placeholder="Buscar recibo por numero, cliente, concepto o metodo..."
                                resultLabel={`${filteredCashReceipts.length} de ${dayCashReceipts.length} del dia`}
                            />
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                            {cashReceipts.length === 0 ? (
                                <div className="rounded-3xl border border-dashed border-amber-300 bg-white p-8 text-center text-sm font-bold text-slate-400 md:col-span-2">
                                    No hay recibos de caja membretados guardados todavia.
                                </div>
                            ) : filteredCashReceipts.length === 0 ? (
                                <div className="rounded-3xl border border-dashed border-amber-300 bg-white p-8 text-center text-sm font-bold text-slate-400 md:col-span-2">
                                    No hay recibos de caja del dia {closureDate} que coincidan con la busqueda.
                                </div>
                            ) : pagedCashReceipts.records.map((receipt) => {
                                const receiptId = receipt.docId || receipt.id;
                                return (
                                    <label key={receiptId || receipt.localId} className="flex cursor-pointer items-center gap-3 rounded-2xl border border-amber-200 bg-white p-3 transition hover:border-amber-500">
                                        <input
                                            type="checkbox"
                                            checked={selectedReceiptIds.includes(receiptId)}
                                            onChange={(event) => toggleClosureCashReceipt(receipt, event.target.checked)}
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm font-black text-slate-950">Recibo {receipt.receiptNumber || '-'}</div>
                                            <div className="text-xs font-bold text-slate-500">{receipt.date} - {receipt.customerName || 'Sin cliente'}</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="font-mono text-sm font-black text-slate-900">{fmt(receipt.amount)}</div>
                                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-700">Ret. {fmt(getCashReceiptRetentionTotal(receipt))}</div>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>

                        <div className="mt-4">
                            <PaginationControls
                                page={pagedCashReceipts.page}
                                totalPages={pagedCashReceipts.totalPages}
                                total={filteredCashReceipts.length}
                                start={pagedCashReceipts.start}
                                end={pagedCashReceipts.end}
                                onPageChange={setClosureReceiptPage}
                            />
                        </div>

                        {closureCashReceipts.length > 0 && (
                            <div className="mt-4 space-y-2">
                                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-700">Recibos aplicados al cierre</div>
                                {closureCashReceipts.map((receipt) => {
                                    const receiptId = receipt.docId || receipt.id || receipt.localId;
                                    return (
                                        <div key={receiptId} className="flex flex-col gap-2 rounded-2xl border border-amber-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-black text-slate-950">Recibo {receipt.receiptNumber || '-'}</div>
                                                <div className="text-xs font-bold text-slate-500">{receipt.customerName || 'Sin cliente'} - {receipt.paymentMethod || 'Sin metodo'}</div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="text-right font-mono text-sm font-black text-amber-800">{fmt(receipt.amount)}</div>
                                                <button type="button" onClick={() => removeClosureCashReceipt(receiptId)} className="rounded-xl border border-red-200 px-3 py-2 text-xs font-black text-red-700 transition hover:bg-red-50">
                                                    Quitar
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <textarea
                        className={`${inputClass} mt-4 min-h-24`}
                        placeholder="Notas internas del cierre..."
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                    />

                    {message && <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-700">{message}</div>}

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <button type="button" onClick={() => saveClosure('waiting')} disabled={saving} className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm font-black uppercase tracking-[0.2em] text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60">
                            {saving ? 'Guardando...' : 'Guardar en espera'}
                        </button>
                        <button
                            type="button"
                            onClick={() => saveClosure('closed')}
                            disabled={saving}
                            title={isClosureRcPositive ? buildPositiveCashClosureRcMessage(closureRc) : undefined}
                            className={`rounded-2xl px-5 py-4 text-sm font-black uppercase tracking-[0.2em] transition disabled:cursor-not-allowed disabled:opacity-60 ${isClosureRcPositive ? 'border border-red-300 bg-red-50 text-red-800 hover:bg-red-100' : 'bg-[#e30613] text-white shadow-lg shadow-red-950/20 hover:bg-[#9f111a]'}`}
                        >
                            {saving ? 'Cerrando...' : 'Cerrar caja y conciliar'}
                        </button>
                    </div>
                </Section>
            </div>
        </div>
        </>
    );
}

const InvoiceItemsTable = ({ items = [] }) => (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
        <div className="grid grid-cols-[0.6fr_2fr_0.8fr_0.8fr] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
            <span>Cant.</span>
            <span>Producto</span>
            <span className="text-right">Precio s/IVA</span>
            <span className="text-right">Total s/IVA</span>
        </div>
        {items.length === 0 ? (
            <div className="p-5 text-center text-sm font-bold text-slate-400">
                Esta factura todavia no tiene articulos sincronizados desde SICAR.
            </div>
        ) : items.map((item, index) => (
            <div key={`${item.saleId || 'line'}-${item.articleId || index}-${index}`} className="grid grid-cols-[0.6fr_2fr_0.8fr_0.8fr] gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-0">
                <span className="font-mono font-black text-slate-800">{formatQuantity(item.quantity)}</span>
                <span className="min-w-0 font-bold text-slate-700">
                    <span className="block truncate">{item.description || item.descripcion || '-'}</span>
                    {item.code && <span className="block text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{item.code}</span>}
                </span>
                <span className="text-right font-mono font-black text-slate-800">{formatInvoiceMoney(item.unitPriceWithoutTax ?? item.precioSin)}</span>
                <span className="text-right font-mono font-black text-slate-950">{formatInvoiceMoney(item.totalWithoutTax ?? item.importeSin)}</span>
            </div>
        ))}
    </div>
);

const createManualInvoiceItem = () => ({
    localId: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    code: '',
    description: '',
    quantity: '',
    unit: 'UND',
    unitPriceWithoutTax: '',
    totalWithoutTax: '',
    taxAmount: '',
    totalWithTax: '',
});

const getInvoiceItemSubtotal = (item = {}) => {
    const explicitTotal = item.totalWithoutTax ?? item.importeSin;
    if (explicitTotal !== undefined && explicitTotal !== '') return safeNumber(explicitTotal);
    return safeNumber(safeNumber(item.quantity ?? item.cantidad) * safeNumber(item.unitPriceWithoutTax ?? item.precioSin));
};

const getInvoiceItemTax = (item = {}) => {
    if (item.taxAmount !== undefined && item.taxAmount !== '') return safeNumber(item.taxAmount);
    if (item.iva !== undefined && item.iva !== '') return safeNumber(item.iva);
    const subtotal = getInvoiceItemSubtotal(item);
    const totalWithTax = item.totalWithTax ?? item.importeCon;
    if (totalWithTax !== undefined && totalWithTax !== '') return safeNumber(safeNumber(totalWithTax) - subtotal);
    return 0;
};

const calculateInvoiceItemsFiscal = (items = []) => {
    const subtotal = safeNumber(items.reduce((sum, item) => sum + getInvoiceItemSubtotal(item), 0));
    const iva = safeNumber(items.reduce((sum, item) => sum + getInvoiceItemTax(item), 0));
    return {
        subtotal,
        iva,
        total: safeNumber(subtotal + iva),
    };
};

const normalizeInvoiceItemsForSave = (items = []) => (
    items
        .map((item, index) => {
            const quantity = safeNumber(item.quantity ?? item.cantidad);
            const subtotal = getInvoiceItemSubtotal(item);
            const taxAmount = getInvoiceItemTax(item);
            const unitPriceWithoutTax = item.unitPriceWithoutTax ?? item.precioSin;
            return {
                saleId: item.saleId || item.ven_id || '',
                articleId: item.articleId || item.art_id || '',
                code: item.code || item.clave || '',
                description: item.description || item.descripcion || '',
                quantity,
                unit: item.unit || item.unidad || 'UND',
                unitPriceWithoutTax: safeNumber(unitPriceWithoutTax || (quantity ? subtotal / quantity : subtotal)),
                unitPriceWithTax: safeNumber(item.unitPriceWithTax ?? item.precioCon ?? (quantity ? (subtotal + taxAmount) / quantity : subtotal + taxAmount)),
                totalWithoutTax: subtotal,
                taxAmount,
                totalWithTax: safeNumber(item.totalWithTax ?? item.importeCon ?? subtotal + taxAmount),
                taxable: taxAmount > 0 || Boolean(item.taxable),
                order: Number(item.order ?? item.orden ?? index),
            };
        })
        .filter((item) => item.description || item.quantity || item.totalWithoutTax)
);

const ManualInvoiceItemsEditor = ({ items = [], onAdd, onChange, onRemove }) => (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
        <div className="grid grid-cols-[0.55fr_1.4fr_0.7fr_0.75fr_0.75fr_0.75fr_auto] gap-2 border-b border-slate-200 bg-slate-50 px-3 py-3 text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">
            <span>Cant.</span>
            <span>Producto</span>
            <span>Unidad</span>
            <span className="text-right">Precio s/IVA</span>
            <span className="text-right">IVA</span>
            <span className="text-right">Total s/IVA</span>
            <span />
        </div>
        <div className="divide-y divide-slate-100">
            {items.length === 0 ? (
                <div className="p-5 text-center text-sm font-bold text-slate-400">
                    Los articulos son opcionales en captura manual. Podes guardar solo los montos fiscales.
                </div>
            ) : items.map((item, index) => (
                <div key={item.localId || index} className="grid grid-cols-[0.55fr_1.4fr_0.7fr_0.75fr_0.75fr_0.75fr_auto] gap-2 px-3 py-3">
                    <input className="rounded-xl border border-slate-200 px-2 py-2 text-sm font-bold text-slate-900 outline-none focus:border-[#e30613]" type="number" step="0.01" min="0" value={item.quantity || ''} onChange={(event) => onChange(index, 'quantity', event.target.value)} placeholder="0" />
                    <input className="rounded-xl border border-slate-200 px-2 py-2 text-sm font-bold text-slate-900 outline-none focus:border-[#e30613]" value={item.description || ''} onChange={(event) => onChange(index, 'description', event.target.value)} placeholder="Descripcion del articulo" />
                    <input className="rounded-xl border border-slate-200 px-2 py-2 text-sm font-bold text-slate-900 outline-none focus:border-[#e30613]" value={item.unit || ''} onChange={(event) => onChange(index, 'unit', event.target.value)} placeholder="UND" />
                    <input className="rounded-xl border border-slate-200 px-2 py-2 text-right text-sm font-bold text-slate-900 outline-none focus:border-[#e30613]" type="number" step="0.01" min="0" value={item.unitPriceWithoutTax || ''} onChange={(event) => onChange(index, 'unitPriceWithoutTax', event.target.value)} placeholder="0.00" />
                    <input className="rounded-xl border border-slate-200 px-2 py-2 text-right text-sm font-bold text-slate-900 outline-none focus:border-[#e30613]" type="number" step="0.01" min="0" value={item.taxAmount || ''} onChange={(event) => onChange(index, 'taxAmount', event.target.value)} placeholder="0.00" />
                    <input className="rounded-xl border border-slate-200 px-2 py-2 text-right text-sm font-bold text-slate-900 outline-none focus:border-[#e30613]" type="number" step="0.01" min="0" value={item.totalWithoutTax || ''} onChange={(event) => onChange(index, 'totalWithoutTax', event.target.value)} placeholder="0.00" />
                    <button type="button" onClick={() => onRemove(index)} className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-red-700 transition hover:bg-red-100">
                        Quitar
                    </button>
                </div>
            ))}
        </div>
        <div className="border-t border-slate-200 bg-slate-50/70 p-3">
            <button type="button" onClick={onAdd} className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-[#e30613]">
                Agregar articulo
            </button>
        </div>
    </div>
);

const createStampedInvoiceForm = () => ({
    date: todayString(),
    invoiceNumber: '',
    customerName: '',
    customerAddress: '',
    customerRfc: '',
    cashierName: '',
    subtotal: '',
    iva: '',
    total: '',
    retentionIr2: '',
    retentionMunicipal1: '',
    paymentMethod: '',
    paymentBreakdown: [],
    paymentNetTotal: 0,
    sourceSicarInvoiceId: '',
    sourceSicarInvoiceNumber: '',
    items: [],
});

const createStampedInvoiceEditForm = (invoice = {}) => ({
    id: invoice.id || invoice.docId || '',
    docId: invoice.docId || invoice.id || '',
    date: invoice.date || invoice.saleDate || todayString(),
    invoiceNumber: invoice.invoiceNumber || invoice.numeroFactura || '',
    customerName: invoice.customerName || invoice.cliente || '',
    customerAddress: invoice.customerAddress || invoice.address || '',
    customerRfc: invoice.customerRfc || invoice.rfc || '',
    cashierName: getCashierName(invoice),
    cashierCode: getRecordCashierCode(invoice),
    subtotal: String(safeNumber(invoice.subtotal)),
    iva: String(safeNumber(invoice.iva)),
    total: String(safeNumber(invoice.total) || safeNumber(invoice.subtotal) + safeNumber(invoice.iva)),
    retentionIr2: String(safeNumber(invoice.retentionIr2)),
    retentionMunicipal1: String(safeNumber(invoice.retentionMunicipal1)),
    paymentMethod: getInvoicePaymentMethodLabel(invoice),
    paymentBreakdown: normalizePaymentBreakdownRows(invoice.paymentBreakdown),
    paymentNetTotal: safeNumber(invoice.paymentNetTotal || getPaymentBreakdownTotal(invoice.paymentBreakdown) || getInvoicePaymentTargetAmount(invoice)),
    source: invoice.source || 'manual',
    sourceSicarInvoiceId: invoice.sourceSicarInvoiceId || '',
    sourceSicarInvoiceNumber: invoice.sourceSicarInvoiceNumber || '',
    linkedCashClosureId: invoice.linkedCashClosureId || '',
    linkedSicarClosureId: invoice.linkedSicarClosureId || '',
    linkedSicarCorId: invoice.linkedSicarCorId || null,
    cashClosureLinkStatus: invoice.cashClosureLinkStatus || '',
    closureStatus: invoice.closureStatus || '',
    excludeFromCashClosure: Boolean(invoice.excludeFromCashClosure),
    creditOriginalAmount: getInvoiceCreditOriginalAmount(invoice),
    creditPaidAmount: getInvoiceCreditPaidAmount(invoice),
    creditBalance: getInvoiceCreditBalance(invoice),
    creditReceiptIds: getInvoiceCreditReceiptIds(invoice),
    creditStatus: getInvoiceCreditStatusKey(invoice),
    creditStatusLabel: getInvoiceCreditStatusLabel(invoice),
    splitGroupId: invoice.splitGroupId || '',
    splitPart: invoice.splitPart || null,
    splitTotalParts: invoice.splitTotalParts || null,
    items: (invoice.items || []).map((item, index) => ({
        localId: item.localId || createLineId('edit_line'),
        saleId: item.saleId || item.ven_id || '',
        articleId: item.articleId || item.art_id || '',
        code: item.code || item.clave || '',
        description: item.description || item.descripcion || '',
        quantity: item.quantity ?? item.cantidad ?? '',
        unit: item.unit || item.unidad || 'UND',
        unitPriceWithoutTax: item.unitPriceWithoutTax ?? item.precioSin ?? '',
        unitPriceWithTax: item.unitPriceWithTax ?? item.precioCon ?? '',
        totalWithoutTax: item.totalWithoutTax ?? item.importeSin ?? '',
        taxAmount: item.taxAmount ?? item.iva ?? '',
        totalWithTax: item.totalWithTax ?? item.importeCon ?? '',
        taxable: item.taxable || false,
        order: Number(item.order ?? item.orden ?? index),
    })),
});

const PrintText = ({ field, layout, children, align = 'left', mono = false, className = '' }) => (
    <div
        className={`absolute leading-tight text-slate-950 ${mono ? 'font-mono' : 'font-sans'} ${className}`}
        style={{
            left: cm(field.x),
            top: cm(field.y),
            width: cm(field.width || 2),
            fontSize: `${safeNumber(layout.fontSizePt) || 9}pt`,
            fontWeight: 700,
            textAlign: align,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
        }}
    >
        {children}
    </div>
);

const StampedInvoicePrintSheet = ({ invoice, layout }) => {
    const itemsLayout = layout.items || DEFAULT_STAMPED_PRINT_LAYOUT.items;
    const items = (invoice?.items || []).slice(0, Number(itemsLayout.maxRows || 15));

    return (
        <div
            className="stamped-invoice-print-sheet relative mx-auto overflow-hidden bg-white shadow-2xl shadow-slate-950/20 ring-1 ring-slate-300"
            style={{ width: cm(layout.pageWidthCm), height: cm(layout.pageHeightCm) }}
        >
            <div className="stamped-invoice-screen-guide absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.05)_1px,transparent_1px)] bg-[size:0.5cm_0.5cm]" />
            <div className="stamped-invoice-screen-guide absolute left-[0.45cm] top-[6.1cm] h-[7.9cm] w-[16.9cm] rounded-sm border border-dashed border-red-300" />

            <PrintText field={layout.customerName} layout={layout}>{invoice.customerName || invoice.cliente || ''}</PrintText>
            <PrintText field={layout.customerAddress} layout={layout}>{invoice.customerAddress || invoice.address || ''}</PrintText>
            <PrintText field={layout.customerRfc} layout={layout}>{invoice.customerRfc || invoice.rfc || ''}</PrintText>
            <PrintText field={layout.date} layout={layout}>{formatInvoiceDate(invoice.date || invoice.saleDate)}</PrintText>

            {items.map((item, index) => {
                const y = safeNumber(itemsLayout.y) + index * safeNumber(itemsLayout.rowHeight || 0.47);
                return (
                    <React.Fragment key={`${item.saleId || 'item'}-${item.articleId || index}-${index}`}>
                        <PrintText field={{ x: itemsLayout.quantityX, y, width: itemsLayout.quantityWidth }} layout={{ ...layout, fontSizePt: layout.itemFontSizePt }} align="center" mono>
                            {formatQuantity(item.quantity)}
                        </PrintText>
                        <PrintText field={{ x: itemsLayout.descriptionX, y, width: itemsLayout.descriptionWidth }} layout={{ ...layout, fontSizePt: layout.itemFontSizePt }}>
                            {item.description || item.descripcion || ''}
                        </PrintText>
                        <PrintText field={{ x: itemsLayout.unitPriceX, y, width: itemsLayout.unitPriceWidth }} layout={{ ...layout, fontSizePt: layout.itemFontSizePt }} align="right" mono>
                            {formatInvoiceMoney(item.unitPriceWithoutTax ?? item.precioSin)}
                        </PrintText>
                        <PrintText field={{ x: itemsLayout.totalX, y, width: itemsLayout.totalWidth }} layout={{ ...layout, fontSizePt: layout.itemFontSizePt }} align="right" mono>
                            {formatInvoiceMoney(item.totalWithoutTax ?? item.importeSin)}
                        </PrintText>
                    </React.Fragment>
                );
            })}

            <PrintText field={layout.subtotal} layout={layout} align="right" mono>{formatInvoiceMoney(invoice.subtotal)}</PrintText>
            <PrintText field={layout.iva} layout={layout} align="right" mono>{formatInvoiceMoney(invoice.iva)}</PrintText>
            <PrintText field={layout.total} layout={layout} align="right" mono>{formatInvoiceMoney(invoice.total)}</PrintText>
        </div>
    );
};

const StampedInvoicePrintModal = ({
    invoice,
    layout,
    templates,
    activeTemplateId,
    templateName,
    onSelectTemplate,
    onTemplateNameChange,
    onLayoutChange,
    onSaveLayout,
    onSaveNewLayout,
    onClose,
}) => {
    if (!invoice) return null;

    const updateField = (fieldKey, prop, value) => {
        onLayoutChange(mergePrintLayout({
            ...layout,
            [fieldKey]: {
                ...(layout[fieldKey] || {}),
                [prop]: Number(value),
            },
        }));
    };

    const updateItems = (prop, value) => {
        onLayoutChange(mergePrintLayout({
            ...layout,
            items: {
                ...(layout.items || {}),
                [prop]: Number(value),
            },
        }));
    };

    const printInvoice = () => {
        const iframe = document.createElement('iframe');
        iframe.title = '';
        iframe.setAttribute('aria-hidden', 'true');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        iframe.style.opacity = '0';
        document.body.appendChild(iframe);

        const iframeWindow = iframe.contentWindow;
        const iframeDocument = iframe.contentDocument || iframeWindow?.document;
        if (!iframeWindow || !iframeDocument) {
            iframe.remove();
            return;
        }

        iframeDocument.open();
        iframeDocument.write(buildStampedInvoicePrintHtml(invoice, layout));
        iframeDocument.close();

        const cleanup = () => setTimeout(() => iframe.remove(), 500);
        iframeWindow.onafterprint = cleanup;
        setTimeout(() => {
            iframeWindow.focus();
            iframeWindow.print();
            cleanup();
        }, 180);
    };

    return (
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm">
            <div className="w-full max-w-7xl rounded-[2rem] border border-white/10 bg-slate-50 shadow-2xl">
                <div className="no-print flex flex-col gap-3 border-b border-slate-200 bg-slate-950 px-5 py-4 text-white sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-red-300">Formato preimpreso 17.8 x 22.3 cm</div>
                        <h3 className="text-xl font-black">Imprimir factura {invoice.invoiceNumber || invoice.numeroFactura || '-'}</h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={onSaveLayout} className="rounded-2xl border border-white/20 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-white/10">
                            Guardar
                        </button>
                        <button type="button" onClick={onSaveNewLayout} className="rounded-2xl border border-white/20 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-white/10">
                            Guardar nueva
                        </button>
                        <button type="button" onClick={printInvoice} className="rounded-2xl bg-[#e30613] px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-red-700">
                            Imprimir texto
                        </button>
                        <button type="button" onClick={onClose} className="rounded-2xl bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-slate-950 transition hover:bg-slate-200">
                            Cerrar
                        </button>
                    </div>
                </div>

                <div className="grid gap-5 p-5 xl:grid-cols-[0.85fr_1.15fr]">
                    <div className="no-print space-y-4">
                        <div className="rounded-3xl border border-slate-200 bg-white p-4">
                            <div className="text-sm font-black text-slate-950">Plantilla de impresion</div>
                            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr]">
                                <Field label="Elegir plantilla">
                                    <select className={inputClass} value={activeTemplateId || ''} onChange={(event) => onSelectTemplate(event.target.value)}>
                                        {(templates || []).map((template) => (
                                            <option key={template.id} value={template.id}>{template.name}</option>
                                        ))}
                                    </select>
                                </Field>
                                <Field label="Nombre">
                                    <input className={inputClass} value={templateName || ''} onChange={(event) => onTemplateNameChange(event.target.value)} placeholder="Ej: Epson oficina, PDF, impresora caja..." />
                                </Field>
                            </div>
                            <div className="mt-2 text-xs font-semibold text-slate-500">
                                Podes tener varias alineaciones segun impresora o bandeja. Guardar actualiza la seleccionada; guardar nueva crea otra plantilla.
                            </div>
                        </div>

                        <div className="rounded-3xl border border-slate-200 bg-white p-4">
                            <div className="text-sm font-black text-slate-950">Ajuste general</div>
                            <div className="mt-3 grid grid-cols-2 gap-3">
                                <Field label="Fuente datos">
                                    <input className={inputClass} type="number" step="0.5" value={layout.fontSizePt} onChange={(event) => onLayoutChange({ ...layout, fontSizePt: Number(event.target.value) })} />
                                </Field>
                                <Field label="Fuente articulos">
                                    <input className={inputClass} type="number" step="0.5" value={layout.itemFontSizePt} onChange={(event) => onLayoutChange({ ...layout, itemFontSizePt: Number(event.target.value) })} />
                                </Field>
                            </div>
                        </div>

                        <div className="max-h-[46rem] space-y-3 overflow-y-auto pr-1">
                            {PRINT_LAYOUT_FIELDS.map((field) => (
                                <div key={field.key} className="rounded-3xl border border-slate-200 bg-white p-4">
                                    <div className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-slate-500">{field.label}</div>
                                    <div className="grid grid-cols-3 gap-2">
                                        <Field label="X cm">
                                            <input className={inputClass} type="number" step="0.05" value={layout[field.key]?.x || 0} onChange={(event) => updateField(field.key, 'x', event.target.value)} />
                                        </Field>
                                        <Field label="Y cm">
                                            <input className={inputClass} type="number" step="0.05" value={layout[field.key]?.y || 0} onChange={(event) => updateField(field.key, 'y', event.target.value)} />
                                        </Field>
                                        <Field label="Ancho">
                                            <input className={inputClass} type="number" step="0.05" value={layout[field.key]?.width || 2} onChange={(event) => updateField(field.key, 'width', event.target.value)} />
                                        </Field>
                                    </div>
                                </div>
                            ))}

                            <div className="rounded-3xl border border-slate-200 bg-white p-4">
                                <div className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-slate-500">Renglones de articulos</div>
                                <div className="grid grid-cols-2 gap-2">
                                    {[
                                        ['quantityX', 'X cantidad'],
                                        ['descriptionX', 'X descripcion'],
                                        ['unitPriceX', 'X precio'],
                                        ['totalX', 'X total'],
                                        ['y', 'Y inicial'],
                                        ['rowHeight', 'Alto renglon'],
                                        ['maxRows', 'Max renglones'],
                                    ].map(([key, label]) => (
                                        <Field key={key} label={label}>
                                            <input className={inputClass} type="number" step={key === 'maxRows' ? '1' : '0.05'} value={layout.items?.[key] || 0} onChange={(event) => updateItems(key, event.target.value)} />
                                        </Field>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="stamped-invoice-print-area overflow-auto rounded-3xl border border-slate-200 bg-slate-100 p-4">
                        <StampedInvoicePrintSheet invoice={invoice} layout={layout} />
                    </div>
                </div>

                <style>{`
                    @media print {
                        @page { size: 17.8cm 22.3cm; margin: 0; }
                        body.print-stamped-invoice-overlay * { visibility: hidden !important; }
                        body.print-stamped-invoice-overlay .stamped-invoice-print-area,
                        body.print-stamped-invoice-overlay .stamped-invoice-print-area * { visibility: visible !important; }
                        body.print-stamped-invoice-overlay .stamped-invoice-print-area {
                            position: absolute !important;
                            inset: 0 auto auto 0 !important;
                            width: 17.8cm !important;
                            height: 22.3cm !important;
                            overflow: hidden !important;
                            border: 0 !important;
                            border-radius: 0 !important;
                            background: transparent !important;
                            padding: 0 !important;
                        }
                        body.print-stamped-invoice-overlay .stamped-invoice-print-sheet {
                            width: 17.8cm !important;
                            height: 22.3cm !important;
                            margin: 0 !important;
                            box-shadow: none !important;
                            border: 0 !important;
                            background: transparent !important;
                        }
                        body.print-stamped-invoice-overlay .stamped-invoice-screen-guide { display: none !important; }
                    }
                `}</style>
            </div>
        </div>
    );
};

const getCashReceiptPrintSample = (receipt = {}) => normalizeCashReceiptRecord({
    id: receipt.id || 'preview',
    date: receipt.date || todayString(),
    receiptNumber: receipt.receiptNumber || receipt.numeroRecibo || '0051',
    customerName: receipt.customerName || receipt.recibiDe || 'CLIENTE DE PRUEBA',
    amount: safeNumber(receipt.amount) || 1250,
    retentionIr2: safeNumber(receipt.retentionIr2),
    concept: receipt.concept || receipt.concepto || 'PAGO A CUENTA / RECUPERACION DE CREDITO',
    paymentMethod: receipt.paymentMethod || receipt.metodoPago || 'EFECTIVO',
    reference: receipt.reference || receipt.referencia || 'REF-001',
});

const CashReceiptPrintSheet = ({ receipt, layout }) => {
    const mergedLayout = mergeCashReceiptPrintLayout(layout);
    const sample = getCashReceiptPrintSample(receipt);
    const amount = safeNumber(sample.amount);
    const retention = safeNumber(sample.retentionIr2);
    const paymentMethod = sample.paymentMethod || '';
    const isCash = normalizeText(paymentMethod) === 'EFECTIVO';
    const bank = getReceiptPaymentBank(paymentMethod);

    return (
        <div
            className="cash-receipt-print-sheet relative mx-auto overflow-hidden bg-white shadow-2xl shadow-slate-950/20 ring-1 ring-slate-300"
            style={{ width: cm(mergedLayout.pageWidthCm), height: cm(mergedLayout.pageHeightCm) }}
        >
            <div className="cash-receipt-screen-guide absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.05)_1px,transparent_1px)] bg-[size:0.5cm_0.5cm]" />
            <div className="cash-receipt-screen-guide absolute inset-[0.35cm] rounded-sm border border-dashed border-red-300" />

            <PrintText field={mergedLayout.date} layout={mergedLayout}>{formatInvoiceDate(sample.date)}</PrintText>
            <PrintText field={mergedLayout.amount} layout={mergedLayout} align="right" mono>{formatInvoiceMoney(amount)}</PrintText>
            <PrintText field={mergedLayout.customerName} layout={mergedLayout}>{sample.customerName || ''}</PrintText>
            <PrintText field={mergedLayout.amountText} layout={mergedLayout}>{`C$ ${formatInvoiceMoney(amount)}`}</PrintText>
            <PrintText field={mergedLayout.retentionIr2} layout={mergedLayout} align="right" mono>{formatInvoiceMoney(retention)}</PrintText>
            <PrintText field={mergedLayout.concept} layout={mergedLayout}>{sample.concept || ''}</PrintText>
            <PrintText field={mergedLayout.cashMark} layout={{ ...mergedLayout, fontSizePt: safeNumber(mergedLayout.fontSizePt) + 4 }} align="center">{isCash ? 'X' : ''}</PrintText>
            <PrintText field={mergedLayout.reference} layout={{ ...mergedLayout, fontSizePt: Math.max(7, safeNumber(mergedLayout.fontSizePt) - 1) }}>{sample.reference || ''}</PrintText>
            <PrintText field={mergedLayout.bank} layout={{ ...mergedLayout, fontSizePt: Math.max(7, safeNumber(mergedLayout.fontSizePt) - 1) }}>{bank}</PrintText>
        </div>
    );
};

const CashReceiptPrintModal = ({
    receipt,
    layout,
    templates,
    activeTemplateId,
    templateName,
    onSelectTemplate,
    onTemplateNameChange,
    onLayoutChange,
    onSaveLayout,
    onSaveNewLayout,
    onClose,
}) => {
    if (!receipt) return null;
    const mergedLayout = mergeCashReceiptPrintLayout(layout);
    const sample = getCashReceiptPrintSample(receipt);

    const updateField = (fieldKey, prop, value) => {
        onLayoutChange(mergeCashReceiptPrintLayout({
            ...mergedLayout,
            [fieldKey]: {
                ...(mergedLayout[fieldKey] || {}),
                [prop]: Number(value),
            },
        }));
    };

    const updateLayout = (prop, value) => {
        onLayoutChange(mergeCashReceiptPrintLayout({
            ...mergedLayout,
            [prop]: Number(value),
        }));
    };

    const swapPageSize = () => {
        onLayoutChange(mergeCashReceiptPrintLayout({
            ...mergedLayout,
            pageWidthCm: mergedLayout.pageHeightCm,
            pageHeightCm: mergedLayout.pageWidthCm,
        }));
    };

    const printReceipt = () => {
        const iframe = document.createElement('iframe');
        iframe.title = '';
        iframe.setAttribute('aria-hidden', 'true');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        iframe.style.opacity = '0';
        document.body.appendChild(iframe);

        const iframeWindow = iframe.contentWindow;
        const iframeDocument = iframe.contentDocument || iframeWindow?.document;
        if (!iframeWindow || !iframeDocument) {
            iframe.remove();
            return;
        }

        iframeDocument.open();
        iframeDocument.write(buildCashReceiptPrintHtml(sample, mergedLayout));
        iframeDocument.close();

        const cleanup = () => setTimeout(() => iframe.remove(), 500);
        iframeWindow.onafterprint = cleanup;
        setTimeout(() => {
            iframeWindow.focus();
            iframeWindow.print();
            cleanup();
        }, 180);
    };

    return (
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm">
            <div className="w-full max-w-7xl rounded-[2rem] border border-white/10 bg-slate-50 shadow-2xl">
                <div className="no-print flex flex-col gap-3 border-b border-slate-200 bg-slate-950 px-5 py-4 text-white sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-red-300">Recibo oficial de caja preimpreso</div>
                        <h3 className="text-xl font-black">Ajustar impresion de recibo</h3>
                        <p className="mt-1 text-xs font-semibold text-slate-300">
                            Mueve cada campo en centimetros. X mueve horizontal, Y mueve vertical.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={onSaveLayout} className="rounded-2xl border border-white/20 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-white/10">
                            Guardar
                        </button>
                        <button type="button" onClick={onSaveNewLayout} className="rounded-2xl border border-white/20 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-white/10">
                            Guardar nueva
                        </button>
                        <button type="button" onClick={printReceipt} className="rounded-2xl bg-[#e30613] px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-red-700">
                            Probar impresion
                        </button>
                        <button type="button" onClick={onClose} className="rounded-2xl bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-slate-950 transition hover:bg-slate-200">
                            Cerrar
                        </button>
                    </div>
                </div>

                <div className="grid gap-5 p-5 xl:grid-cols-[0.85fr_1.15fr]">
                    <div className="no-print space-y-4">
                        <div className="rounded-3xl border border-slate-200 bg-white p-4">
                            <div className="text-sm font-black text-slate-950">Plantilla de impresion</div>
                            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr]">
                                <Field label="Elegir plantilla">
                                    <select className={inputClass} value={activeTemplateId || ''} onChange={(event) => onSelectTemplate(event.target.value)}>
                                        {(templates || []).map((template) => (
                                            <option key={template.id} value={template.id}>{template.name}</option>
                                        ))}
                                    </select>
                                </Field>
                                <Field label="Nombre">
                                    <input className={inputClass} value={templateName || ''} onChange={(event) => onTemplateNameChange(event.target.value)} placeholder="Ej: Epson recibos, bandeja manual..." />
                                </Field>
                            </div>
                        </div>

                        <div className="rounded-3xl border border-slate-200 bg-white p-4">
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-black text-slate-950">Ajuste general</div>
                                <button type="button" onClick={swapPageSize} className="rounded-xl border border-slate-200 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-600 transition hover:border-[#e30613] hover:text-[#e30613]">
                                    Girar tamano
                                </button>
                            </div>
                            <div className="mt-3 grid grid-cols-3 gap-3">
                                <Field label="Ancho cm">
                                    <input className={inputClass} type="number" step="0.05" value={mergedLayout.pageWidthCm} onChange={(event) => updateLayout('pageWidthCm', event.target.value)} />
                                </Field>
                                <Field label="Alto cm">
                                    <input className={inputClass} type="number" step="0.05" value={mergedLayout.pageHeightCm} onChange={(event) => updateLayout('pageHeightCm', event.target.value)} />
                                </Field>
                                <Field label="Fuente">
                                    <input className={inputClass} type="number" step="0.5" value={mergedLayout.fontSizePt} onChange={(event) => updateLayout('fontSizePt', event.target.value)} />
                                </Field>
                            </div>
                            <div className="mt-2 text-xs font-semibold text-slate-500">
                                Si el navegador centra el recibo, usa el tamano fisico real del papel y ajusta X/Y desde esta pantalla.
                            </div>
                        </div>

                        <div className="max-h-[46rem] space-y-3 overflow-y-auto pr-1">
                            {CASH_RECEIPT_PRINT_FIELDS.map((field) => (
                                <div key={field.key} className="rounded-3xl border border-slate-200 bg-white p-4">
                                    <div className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-slate-500">{field.label}</div>
                                    <div className="grid grid-cols-3 gap-2">
                                        <Field label="X cm">
                                            <input className={inputClass} type="number" step="0.05" value={mergedLayout[field.key]?.x || 0} onChange={(event) => updateField(field.key, 'x', event.target.value)} />
                                        </Field>
                                        <Field label="Y cm">
                                            <input className={inputClass} type="number" step="0.05" value={mergedLayout[field.key]?.y || 0} onChange={(event) => updateField(field.key, 'y', event.target.value)} />
                                        </Field>
                                        <Field label="Ancho">
                                            <input className={inputClass} type="number" step="0.05" value={mergedLayout[field.key]?.width || 2} onChange={(event) => updateField(field.key, 'width', event.target.value)} />
                                        </Field>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="cash-receipt-print-area overflow-auto rounded-3xl border border-slate-200 bg-slate-100 p-4">
                        <CashReceiptPrintSheet receipt={sample} layout={mergedLayout} />
                    </div>
                </div>

                <style>{`
                    @media print {
                        @page { size: ${cm(mergedLayout.pageWidthCm)} ${cm(mergedLayout.pageHeightCm)}; margin: 0; }
                        body.print-cash-receipt-overlay * { visibility: hidden !important; }
                        body.print-cash-receipt-overlay .cash-receipt-print-area,
                        body.print-cash-receipt-overlay .cash-receipt-print-area * { visibility: visible !important; }
                        body.print-cash-receipt-overlay .cash-receipt-print-area {
                            position: absolute !important;
                            inset: 0 auto auto 0 !important;
                            width: ${cm(mergedLayout.pageWidthCm)} !important;
                            height: ${cm(mergedLayout.pageHeightCm)} !important;
                            overflow: hidden !important;
                            border: 0 !important;
                            border-radius: 0 !important;
                            background: transparent !important;
                            padding: 0 !important;
                        }
                        body.print-cash-receipt-overlay .cash-receipt-print-sheet {
                            width: ${cm(mergedLayout.pageWidthCm)} !important;
                            height: ${cm(mergedLayout.pageHeightCm)} !important;
                            margin: 0 !important;
                            box-shadow: none !important;
                            border: 0 !important;
                            background: transparent !important;
                        }
                        body.print-cash-receipt-overlay .cash-receipt-screen-guide { display: none !important; }
                    }
                `}</style>
            </div>
        </div>
    );
};

const ReceiptInvoiceApplicationsEditor = ({
    isOtherReceipt = false,
    onToggleOtherReceipt,
    applications = [],
    availableInvoices = [],
    onToggleInvoice,
    onUpdateApplicationAmount,
    searchValue = '',
    onSearchChange,
}) => {
    const selectedMap = new Map(
        (applications || []).map((application) => [application.invoiceId, application])
    );
    const selectedTotal = getCashReceiptApplicationsTotal(applications);

    return (
        <div className="space-y-4 rounded-[1.8rem] border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div className="text-sm font-black text-slate-950">Facturas a credito vinculadas</div>
                    <div className="text-xs font-semibold text-slate-500">
                        Selecciona las facturas membretadas a credito y define el monto que pagara este recibo.
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <label className="inline-flex items-center gap-2 rounded-2xl border border-amber-200 bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-amber-800">
                        <input
                            type="checkbox"
                            checked={isOtherReceipt}
                            onChange={(event) => onToggleOtherReceipt(event.target.checked)}
                        />
                        RECIBO - OTROS
                    </label>
                    <Badge tone={selectedTotal > 0 ? 'green' : 'slate'}>{fmt(selectedTotal)}</Badge>
                </div>
            </div>

            {!isOtherReceipt && (
                <>
                    <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
                        <input
                            className={inputClass}
                            value={searchValue}
                            onChange={(event) => onSearchChange(event.target.value)}
                            placeholder="Buscar factura a credito por numero, cliente o fecha..."
                        />
                        <div className="flex items-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                            {applications.length} seleccionada(s)
                        </div>
                    </div>

                    <div className="space-y-3">
                        {availableInvoices.length === 0 ? (
                            <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm font-bold text-slate-400">
                                No hay facturas a credito disponibles para este filtro.
                            </div>
                        ) : availableInvoices.map((invoice) => {
                            const invoiceId = getInvoiceDocId(invoice);
                            const selectedApplication = selectedMap.get(invoiceId);
                            return (
                                <label key={invoiceId} className={`block rounded-3xl border p-4 transition ${selectedApplication ? 'border-sky-300 bg-sky-50/60' : 'border-slate-200 bg-white hover:border-sky-200'}`}>
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    checked={Boolean(selectedApplication)}
                                                    onChange={(event) => onToggleInvoice(invoice, event.target.checked)}
                                                />
                                                <div className="truncate text-sm font-black text-slate-950">Factura {invoice.invoiceNumber || '-'}</div>
                                                <Badge tone={invoice.creditStatus === 'cancelled' ? 'green' : invoice.creditStatus === 'partial' ? 'blue' : 'amber'}>
                                                    {invoice.creditStatusLabel || 'Credito'}
                                                </Badge>
                                            </div>
                                            <div className="mt-1 text-xs font-bold text-slate-500">
                                                {invoice.customerName || 'Sin cliente'} · {invoice.date || '-'} · Saldo disponible {fmt(invoice.availableCreditBalance)}
                                            </div>
                                        </div>
                                        <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[24rem]">
                                            <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Monto credito</div>
                                                <div className="font-mono text-sm font-black text-slate-900">{fmt(invoice.creditOriginalAmount)}</div>
                                            </div>
                                            <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Pagado</div>
                                                <div className="font-mono text-sm font-black text-slate-900">{fmt(invoice.creditPaidAmount)}</div>
                                            </div>
                                            <div>
                                                <div className="mb-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Abono recibo</div>
                                                <input
                                                    className={inputClass}
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    disabled={!selectedApplication}
                                                    value={selectedApplication?.appliedAmount || ''}
                                                    onChange={(event) => onUpdateApplicationAmount(invoiceId, event.target.value)}
                                                    placeholder="0.00"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </label>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
};

const CashReceiptEditModal = ({
    form,
    saving = false,
    availableInvoices = [],
    invoiceSearch = '',
    onInvoiceSearchChange,
    onClose,
    onSave,
    onUpdate,
    onToggleOtherReceipt,
    onToggleInvoice,
    onUpdateInvoiceAmount,
}) => {
    if (!form) return null;
    const netAmount = safeNumber(safeNumber(form.amount) - safeNumber(form.retentionIr2) - safeNumber(form.retentionMunicipal1));

    return (
        <div className="fixed inset-0 z-[85] flex items-start justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm">
            <div className="w-full max-w-4xl overflow-hidden rounded-[2rem] border border-white/10 bg-white shadow-2xl">
                <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-950 px-5 py-4 text-white sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-red-300">Edicion master</div>
                        <h3 className="text-xl font-black">Editar recibo {form.receiptNumber || '-'}</h3>
                        <p className="mt-1 text-sm font-semibold text-slate-300">Actualiza montos y retenciones del recibo de caja.</p>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-2xl bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-slate-950 transition hover:bg-slate-200">
                        Cerrar
                    </button>
                </div>

                <form onSubmit={onSave} className="space-y-4 p-5">
                    <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Fecha">
                            <input className={inputClass} type="date" value={form.date || ''} onChange={(event) => onUpdate('date', event.target.value)} required />
                        </Field>
                        <Field label="Numero de recibo">
                            <input className={inputClass} value={form.receiptNumber || ''} onChange={(event) => onUpdate('receiptNumber', event.target.value)} />
                        </Field>
                        <Field label="Recibi de">
                            <input
                                className={inputClass}
                                value={form.customerName || ''}
                                onChange={(event) => onUpdate('customerName', event.target.value)}
                                required
                                readOnly={!form.isOtherReceipt && (form.invoiceApplications || []).length > 0}
                            />
                        </Field>
                        <Field label="Metodo de pago">
                            <PaymentMethodSelect value={form.paymentMethod || ''} onChange={(value) => onUpdate('paymentMethod', value)} required />
                        </Field>
                        <Field label="Cantidad">
                            <input
                                className={inputClass}
                                type="number"
                                step="0.01"
                                min="0"
                                value={form.amount || ''}
                                onChange={(event) => onUpdate('amount', event.target.value)}
                                required
                                readOnly={!form.isOtherReceipt && (form.invoiceApplications || []).length > 0}
                            />
                        </Field>
                        <Field label="Retencion anticipo IR 2%">
                            <input className={inputClass} type="number" step="0.01" min="0" value={form.retentionIr2 || ''} onChange={(event) => onUpdate('retentionIr2', event.target.value)} />
                        </Field>
                        <Field label="Retencion municipal 1%">
                            <input className={inputClass} type="number" step="0.01" min="0" value={form.retentionMunicipal1 || ''} onChange={(event) => onUpdate('retentionMunicipal1', event.target.value)} />
                        </Field>
                        <Field label="Neto recibido">
                            <input className={inputClass} readOnly value={formatInvoiceMoney(netAmount)} />
                        </Field>
                        <Field label="Referencia / CK No.">
                            <input className={inputClass} value={form.reference || ''} onChange={(event) => onUpdate('reference', event.target.value)} />
                        </Field>
                        <Field label="Concepto" span="md:col-span-2">
                            <textarea className={`${inputClass} min-h-[110px]`} value={form.concept || ''} onChange={(event) => onUpdate('concept', event.target.value)} />
                        </Field>
                    </div>
                    <ReceiptInvoiceApplicationsEditor
                        isOtherReceipt={Boolean(form.isOtherReceipt)}
                        onToggleOtherReceipt={onToggleOtherReceipt}
                        applications={form.invoiceApplications || []}
                        availableInvoices={availableInvoices}
                        onToggleInvoice={onToggleInvoice}
                        onUpdateApplicationAmount={onUpdateInvoiceAmount}
                        searchValue={invoiceSearch}
                        onSearchChange={onInvoiceSearchChange}
                    />
                    <button type="submit" disabled={saving} className="w-full rounded-2xl bg-[#e30613] px-5 py-4 text-sm font-black uppercase tracking-[0.2em] text-white shadow-lg shadow-red-950/20 transition hover:bg-[#9f111a] disabled:cursor-not-allowed disabled:opacity-60">
                        {saving ? 'Guardando...' : 'Guardar cambios'}
                    </button>
                </form>
            </div>
        </div>
    );
};

function useStampedPrintTemplates(setMessage = () => {}) {
    const [printLayout, setPrintLayout] = useState(DEFAULT_STAMPED_PRINT_LAYOUT);
    const [printTemplates, setPrintTemplates] = useState([
        { id: DEFAULT_PRINT_TEMPLATE_ID, name: DEFAULT_PRINT_TEMPLATE_NAME, layout: DEFAULT_STAMPED_PRINT_LAYOUT },
    ]);
    const [activePrintTemplateId, setActivePrintTemplateId] = useState(DEFAULT_PRINT_TEMPLATE_ID);
    const [printTemplateName, setPrintTemplateName] = useState(DEFAULT_PRINT_TEMPLATE_NAME);

    useEffect(() => {
        let mounted = true;
        getDoc(doc(db, 'configuracion', STAMPED_PRINT_LAYOUT_DOC))
            .then((snapshot) => {
                if (!mounted || !snapshot.exists()) return;
                const config = snapshot.data() || {};
                const templates = readPrintTemplates(config);
                const selectedId = config.selectedTemplateId || templates[0]?.id || DEFAULT_PRINT_TEMPLATE_ID;
                const selectedTemplate = templates.find((template) => template.id === selectedId) || templates[0];
                setPrintTemplates(templates);
                setActivePrintTemplateId(selectedTemplate.id);
                setPrintTemplateName(selectedTemplate.name);
                setPrintLayout(mergePrintLayout(selectedTemplate.layout));
            })
            .catch((error) => console.warn('No se pudo cargar plantilla de factura membretada:', error));
        return () => {
            mounted = false;
        };
    }, []);

    const persistPrintTemplates = async (templates, selectedTemplateId, successMessage) => {
        const normalizedTemplates = templates.map((template, index) => normalizePrintTemplate(template, index));
        await setDoc(doc(db, 'configuracion', STAMPED_PRINT_LAYOUT_DOC), {
            templates: normalizedTemplates,
            selectedTemplateId,
            layout: normalizedTemplates.find((template) => template.id === selectedTemplateId)?.layout || normalizedTemplates[0]?.layout || mergePrintLayout(printLayout),
            updatedAt: serverTimestamp(),
        }, { merge: true });
        setPrintTemplates(normalizedTemplates);
        setActivePrintTemplateId(selectedTemplateId);
        const selected = normalizedTemplates.find((template) => template.id === selectedTemplateId) || normalizedTemplates[0];
        setPrintTemplateName(selected?.name || DEFAULT_PRINT_TEMPLATE_NAME);
        setPrintLayout(mergePrintLayout(selected?.layout || printLayout));
        setMessage(successMessage);
    };

    const selectPrintTemplate = (templateId) => {
        const selected = printTemplates.find((template) => template.id === templateId);
        if (!selected) return;
        setActivePrintTemplateId(selected.id);
        setPrintTemplateName(selected.name);
        setPrintLayout(mergePrintLayout(selected.layout));
    };

    const savePrintLayout = async () => {
        const name = String(printTemplateName || '').trim() || DEFAULT_PRINT_TEMPLATE_NAME;
        const templateId = activePrintTemplateId || DEFAULT_PRINT_TEMPLATE_ID;
        const nextTemplates = printTemplates.map((template) => (
            template.id === templateId
                ? { ...template, name, layout: mergePrintLayout(printLayout) }
                : template
        ));

        if (!nextTemplates.some((template) => template.id === templateId)) {
            nextTemplates.push({ id: templateId, name, layout: mergePrintLayout(printLayout) });
        }

        await persistPrintTemplates(nextTemplates, templateId, `Plantilla "${name}" guardada.`);
    };

    const saveNewPrintLayout = async () => {
        const name = String(printTemplateName || '').trim() || `Plantilla ${printTemplates.length + 1}`;
        const templateId = createPrintTemplateId(name);
        const nextTemplates = [
            ...printTemplates,
            { id: templateId, name, layout: mergePrintLayout(printLayout) },
        ];
        await persistPrintTemplates(nextTemplates, templateId, `Nueva plantilla "${name}" guardada.`);
    };

    return {
        printLayout,
        printTemplates,
        activePrintTemplateId,
        printTemplateName,
        setPrintLayout,
        setPrintTemplateName,
        selectPrintTemplate,
        savePrintLayout,
        saveNewPrintLayout,
    };
}

function useCashReceiptPrintTemplates(setMessage = () => {}) {
    const [cashReceiptLayout, setCashReceiptLayout] = useState(DEFAULT_CASH_RECEIPT_PRINT_LAYOUT);
    const [cashReceiptTemplates, setCashReceiptTemplates] = useState([
        { id: DEFAULT_PRINT_TEMPLATE_ID, name: DEFAULT_PRINT_TEMPLATE_NAME, layout: DEFAULT_CASH_RECEIPT_PRINT_LAYOUT },
    ]);
    const [activeCashReceiptTemplateId, setActiveCashReceiptTemplateId] = useState(DEFAULT_PRINT_TEMPLATE_ID);
    const [cashReceiptTemplateName, setCashReceiptTemplateName] = useState(DEFAULT_PRINT_TEMPLATE_NAME);

    useEffect(() => {
        let mounted = true;
        getDoc(doc(db, 'configuracion', CASH_RECEIPT_PRINT_LAYOUT_DOC))
            .then((snapshot) => {
                if (!mounted || !snapshot.exists()) return;
                const config = snapshot.data() || {};
                const templates = readCashReceiptPrintTemplates(config);
                const selectedId = config.selectedTemplateId || templates[0]?.id || DEFAULT_PRINT_TEMPLATE_ID;
                const selectedTemplate = templates.find((template) => template.id === selectedId) || templates[0];
                setCashReceiptTemplates(templates);
                setActiveCashReceiptTemplateId(selectedTemplate.id);
                setCashReceiptTemplateName(selectedTemplate.name);
                setCashReceiptLayout(mergeCashReceiptPrintLayout(selectedTemplate.layout));
            })
            .catch((error) => console.warn('No se pudo cargar plantilla de recibo de caja:', error));
        return () => {
            mounted = false;
        };
    }, []);

    const persistCashReceiptTemplates = async (templates, selectedTemplateId, successMessage) => {
        const normalizedTemplates = templates.map((template, index) => normalizeCashReceiptPrintTemplate(template, index));
        await setDoc(doc(db, 'configuracion', CASH_RECEIPT_PRINT_LAYOUT_DOC), {
            templates: normalizedTemplates,
            selectedTemplateId,
            layout: normalizedTemplates.find((template) => template.id === selectedTemplateId)?.layout || normalizedTemplates[0]?.layout || mergeCashReceiptPrintLayout(cashReceiptLayout),
            updatedAt: serverTimestamp(),
        }, { merge: true });
        setCashReceiptTemplates(normalizedTemplates);
        setActiveCashReceiptTemplateId(selectedTemplateId);
        const selected = normalizedTemplates.find((template) => template.id === selectedTemplateId) || normalizedTemplates[0];
        setCashReceiptTemplateName(selected?.name || DEFAULT_PRINT_TEMPLATE_NAME);
        setCashReceiptLayout(mergeCashReceiptPrintLayout(selected?.layout || cashReceiptLayout));
        setMessage(successMessage);
    };

    const selectCashReceiptTemplate = (templateId) => {
        const selected = cashReceiptTemplates.find((template) => template.id === templateId);
        if (!selected) return;
        setActiveCashReceiptTemplateId(selected.id);
        setCashReceiptTemplateName(selected.name);
        setCashReceiptLayout(mergeCashReceiptPrintLayout(selected.layout));
    };

    const saveCashReceiptLayout = async () => {
        const name = String(cashReceiptTemplateName || '').trim() || DEFAULT_PRINT_TEMPLATE_NAME;
        const templateId = activeCashReceiptTemplateId || DEFAULT_PRINT_TEMPLATE_ID;
        const nextTemplates = cashReceiptTemplates.map((template) => (
            template.id === templateId
                ? { ...template, name, layout: mergeCashReceiptPrintLayout(cashReceiptLayout) }
                : template
        ));

        if (!nextTemplates.some((template) => template.id === templateId)) {
            nextTemplates.push({ id: templateId, name, layout: mergeCashReceiptPrintLayout(cashReceiptLayout) });
        }

        await persistCashReceiptTemplates(nextTemplates, templateId, `Plantilla de recibo "${name}" guardada.`);
    };

    const saveNewCashReceiptLayout = async () => {
        const name = String(cashReceiptTemplateName || '').trim() || `Plantilla ${cashReceiptTemplates.length + 1}`;
        const templateId = createPrintTemplateId(name);
        const nextTemplates = [
            ...cashReceiptTemplates,
            { id: templateId, name, layout: mergeCashReceiptPrintLayout(cashReceiptLayout) },
        ];
        await persistCashReceiptTemplates(nextTemplates, templateId, `Nueva plantilla de recibo "${name}" guardada.`);
    };

    return {
        cashReceiptLayout,
        cashReceiptTemplates,
        activeCashReceiptTemplateId,
        cashReceiptTemplateName,
        setCashReceiptLayout,
        setCashReceiptTemplateName,
        selectCashReceiptTemplate,
        saveCashReceiptLayout,
        saveNewCashReceiptLayout,
    };
}

function CashReceipts({ data, branchContext }) {
    const { user } = useAuth();
    const isMaster = isMasterEmail(user?.email);
    const selectedBranchId = getActiveBillingBranchId(branchContext);
    const receiptBranchPayload = useMemo(() => getBranchPayload(selectedBranchId, 'receipt'), [selectedBranchId]);
    const clients = useMemo(() => (
        [...(data.clientes_facturacion || [])]
            .map((item) => ({ ...item, name: item.name || item.nombre || '' }))
            .filter((item) => item.name)
            .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    ), [data.clientes_facturacion]);
    const savedInvoices = useMemo(() => (
        [...(data.facturas_membretadas_ventas || [])]
            .map(normalizeStampedInvoiceRecord)
            .filter((invoice) => isRecordInBillingBranch(invoice, selectedBranchId))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    ), [data.facturas_membretadas_ventas, selectedBranchId]);
    const invoiceIndex = useMemo(() => new Map(
        savedInvoices
            .map((invoice) => [getInvoiceDocId(invoice), invoice])
            .filter(([invoiceId]) => invoiceId)
    ), [savedInvoices]);
    const creditInvoices = useMemo(() => (
        savedInvoices
            .filter((invoice) => isActiveStampedInvoice(invoice) && isCreditPaymentMethod(invoice.paymentMethod))
            .filter((invoice) => getInvoiceCreditBalance(invoice) > 0.01 || getInvoiceCreditReceiptIds(invoice).length > 0 || getInvoiceCreditPaidAmount(invoice) > 0.01)
    ), [savedInvoices]);

    const receipts = useMemo(() => (
        [...(data.recibos_caja_membretados || [])]
            .map(normalizeCashReceiptRecord)
            .filter((receipt) => isRecordInBillingBranch(receipt, selectedBranchId))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    ), [data.recibos_caja_membretados, selectedBranchId]);

    const [form, setForm] = useState(createCashReceiptForm);
    const [search, setSearch] = useState('');
    const [invoiceSearch, setInvoiceSearch] = useState('');
    const [page, setPage] = useState(1);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [printTarget, setPrintTarget] = useState(null);
    const [editForm, setEditForm] = useState(null);
    const [editSaving, setEditSaving] = useState(false);
    const [editInvoiceSearch, setEditInvoiceSearch] = useState('');
    const {
        cashReceiptLayout,
        cashReceiptTemplates,
        activeCashReceiptTemplateId,
        cashReceiptTemplateName,
        setCashReceiptLayout,
        setCashReceiptTemplateName,
        selectCashReceiptTemplate,
        saveCashReceiptLayout,
        saveNewCashReceiptLayout,
    } = useCashReceiptPrintTemplates(setMessage);
    const buildAvailableCreditInvoices = useCallback((customerName, searchValue, selectedApplications = []) => {
        const selectedAmounts = new Map(
            (selectedApplications || []).map((application) => [
                application.invoiceId,
                safeNumber(application.appliedAmount),
            ])
        );
        const customerKey = normalizeText(customerName);
        const searchKey = normalizeText(searchValue);

        return creditInvoices
            .map((invoice) => {
                const invoiceId = getInvoiceDocId(invoice);
                return {
                    ...invoice,
                    availableCreditBalance: safeNumber(getInvoiceCreditBalance(invoice) + safeNumber(selectedAmounts.get(invoiceId))),
                };
            })
            .filter((invoice) => {
                const invoiceId = getInvoiceDocId(invoice);
                const selected = selectedAmounts.has(invoiceId);
                const matchesCustomer = !customerKey || normalizeText(invoice.customerName || invoice.cliente || '') === customerKey || selected;
                const matchesSearch = !searchKey || recordSearchText(invoice, [
                    'date',
                    'invoiceNumber',
                    'customerName',
                    'total',
                    'creditStatusLabel',
                ]).includes(searchKey);
                return matchesCustomer && matchesSearch && (invoice.availableCreditBalance > 0.01 || selected);
            });
    }, [creditInvoices]);
    const availableCreditInvoices = useMemo(() => (
        buildAvailableCreditInvoices(form.customerName, invoiceSearch, form.invoiceApplications)
    ), [buildAvailableCreditInvoices, form.customerName, form.invoiceApplications, invoiceSearch]);
    const availableEditCreditInvoices = useMemo(() => (
        editForm ? buildAvailableCreditInvoices(editForm.customerName, editInvoiceSearch, editForm.invoiceApplications) : []
    ), [buildAvailableCreditInvoices, editForm, editInvoiceSearch]);

    const filteredReceipts = useMemo(() => filterRecords(receipts, search, [
        'date',
        'receiptNumber',
        'customerName',
        'concept',
        'paymentMethod',
        'amount',
    ]), [receipts, search]);

    const pagedReceipts = useMemo(() => paginateRecords(filteredReceipts, page), [filteredReceipts, page]);

    useEffect(() => {
        setPage(1);
    }, [search]);

    useEffect(() => {
        if (page !== pagedReceipts.page) setPage(pagedReceipts.page);
    }, [page, pagedReceipts.page]);

    const update = (key, value) => {
        setForm((prev) => ({ ...prev, [key]: value }));
    };

    const toggleOtherReceipt = (checked) => {
        setForm((prev) => ({
            ...prev,
            isOtherReceipt: checked,
            invoiceApplications: checked ? [] : prev.invoiceApplications,
            amount: checked ? '' : (prev.invoiceApplications?.length ? String(getCashReceiptApplicationsTotal(prev.invoiceApplications)) : ''),
        }));
    };

    const toggleReceiptInvoice = (invoice, checked) => {
        const invoiceId = getInvoiceDocId(invoice);
        if (!invoiceId) return;
        const invoiceCustomerName = String(invoice.customerName || invoice.cliente || '').trim();
        const formCustomerKey = normalizeText(form.customerName);
        const invoiceCustomerKey = normalizeText(invoiceCustomerName);
        if (checked && formCustomerKey && invoiceCustomerKey && formCustomerKey !== invoiceCustomerKey) {
            setMessage('Un mismo recibo solo puede mezclar facturas del mismo cliente.');
            return;
        }

        setForm((prev) => {
            const currentApplications = Array.isArray(prev.invoiceApplications) ? prev.invoiceApplications : [];
            const nextApplications = checked
                ? currentApplications.some((application) => application.invoiceId === invoiceId)
                    ? currentApplications
                    : [
                        ...currentApplications,
                        {
                            invoiceId,
                            invoiceNumber: invoice.invoiceNumber || invoice.numeroFactura || '',
                            customerName: invoiceCustomerName,
                            appliedAmount: String(safeNumber(invoice.availableCreditBalance ?? getInvoiceCreditBalance(invoice))),
                        },
                    ]
                : currentApplications.filter((application) => application.invoiceId !== invoiceId);

            return {
                ...prev,
                isOtherReceipt: false,
                customerName: prev.customerName || invoiceCustomerName,
                invoiceApplications: nextApplications,
                amount: nextApplications.length ? String(getCashReceiptApplicationsTotal(nextApplications)) : '',
            };
        });
    };

    const updateReceiptInvoiceAmount = (invoiceId, value) => {
        setForm((prev) => {
            const nextApplications = (prev.invoiceApplications || []).map((application) => (
                application.invoiceId === invoiceId
                    ? { ...application, appliedAmount: value }
                    : application
            ));
            return {
                ...prev,
                invoiceApplications: nextApplications,
                amount: nextApplications.length ? String(getCashReceiptApplicationsTotal(nextApplications)) : '',
            };
        });
    };

    const openEditReceipt = (receipt) => {
        if (!isMaster) return;
        setEditForm(createCashReceiptEditForm(receipt));
        setEditInvoiceSearch('');
    };

    const updateEditReceipt = (key, value) => {
        setEditForm((prev) => prev ? { ...prev, [key]: value } : prev);
    };

    const toggleEditOtherReceipt = (checked) => {
        setEditForm((prev) => prev ? ({
            ...prev,
            isOtherReceipt: checked,
            invoiceApplications: checked ? [] : prev.invoiceApplications,
            amount: checked ? '' : (prev.invoiceApplications?.length ? String(getCashReceiptApplicationsTotal(prev.invoiceApplications)) : ''),
        }) : prev);
    };

    const toggleEditReceiptInvoice = (invoice, checked) => {
        if (!editForm) return;
        const invoiceId = getInvoiceDocId(invoice);
        if (!invoiceId) return;
        const invoiceCustomerName = String(invoice.customerName || invoice.cliente || '').trim();
        const editCustomerKey = normalizeText(editForm.customerName);
        const invoiceCustomerKey = normalizeText(invoiceCustomerName);
        if (checked && editCustomerKey && invoiceCustomerKey && editCustomerKey !== invoiceCustomerKey) {
            setMessage('Un mismo recibo solo puede mezclar facturas del mismo cliente.');
            return;
        }

        setEditForm((prev) => {
            if (!prev) return prev;
            const currentApplications = Array.isArray(prev.invoiceApplications) ? prev.invoiceApplications : [];
            const nextApplications = checked
                ? currentApplications.some((application) => application.invoiceId === invoiceId)
                    ? currentApplications
                    : [
                        ...currentApplications,
                        {
                            invoiceId,
                            invoiceNumber: invoice.invoiceNumber || invoice.numeroFactura || '',
                            customerName: invoiceCustomerName,
                            appliedAmount: String(safeNumber(invoice.availableCreditBalance ?? getInvoiceCreditBalance(invoice))),
                        },
                    ]
                : currentApplications.filter((application) => application.invoiceId !== invoiceId);

            return {
                ...prev,
                isOtherReceipt: false,
                customerName: prev.customerName || invoiceCustomerName,
                invoiceApplications: nextApplications,
                amount: nextApplications.length ? String(getCashReceiptApplicationsTotal(nextApplications)) : '',
            };
        });
    };

    const updateEditReceiptInvoiceAmount = (invoiceId, value) => {
        setEditForm((prev) => {
            if (!prev) return prev;
            const nextApplications = (prev.invoiceApplications || []).map((application) => (
                application.invoiceId === invoiceId
                    ? { ...application, appliedAmount: value }
                    : application
            ));
            return {
                ...prev,
                invoiceApplications: nextApplications,
                amount: nextApplications.length ? String(getCashReceiptApplicationsTotal(nextApplications)) : '',
            };
        });
    };

    const upsertClientRecord = async (name, source = 'recibo_caja') => {
        const safeName = String(name || '').trim();
        if (!safeName) return '';
        const code = `CLI-${slugify(safeName)}`;
        await setDoc(doc(db, 'clientes_facturacion', code), {
            code,
            name: safeName,
            normalizedName: normalizeText(safeName),
            source,
            updatedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
        }, { merge: true });
        return code;
    };

    const saveReceipt = async (event) => {
        event.preventDefault();
        setSaving(true);
        setMessage('');
        try {
            assertUniqueCashReceiptNumber({ ...receiptBranchPayload, ...form }, receipts);
            const receiptId = form.receiptNumber
                ? buildBranchScopedFiscalDocId('recibo', receiptBranchPayload, form.receiptNumber, form.date || todayString())
                : `recibo_${selectedBranchId}_${String(form.date || todayString()).replace(/-/g, '')}_${Date.now()}`;
            const { receiptPayload } = await persistCashReceiptRecord({
                receiptId,
                form,
                existingReceipt: {},
                invoiceIndex,
                branchPayload: receiptBranchPayload,
            });
            await upsertClientRecord(receiptPayload.customerName, receiptPayload.invoiceApplications?.length ? 'recibo_caja_credito' : 'recibo_caja');
            setForm(createCashReceiptForm());
            setInvoiceSearch('');
            setMessage('Recibo de caja guardado correctamente.');
        } catch (error) {
            console.error(error);
            setMessage(error?.message || 'No se pudo guardar el recibo de caja.');
        } finally {
            setSaving(false);
        }
    };

    const saveEditedReceipt = async (event) => {
        event.preventDefault();
        if (!isMaster || !editForm?.id) return;
        setEditSaving(true);
        setMessage('');
        try {
            const existingReceipt = receipts.find((receipt) => receipt.id === editForm.id) || {};
            assertUniqueCashReceiptNumber(
                { ...receiptBranchPayload, ...editForm },
                receipts,
                [editForm.id, editForm.docId]
            );
            const { receiptPayload } = await persistCashReceiptRecord({
                receiptId: editForm.id,
                form: editForm,
                existingReceipt,
                invoiceIndex,
                branchPayload: receiptBranchPayload,
            });
            await upsertClientRecord(receiptPayload.customerName, receiptPayload.invoiceApplications?.length ? 'recibo_caja_credito' : 'recibo_caja');
            setMessage(`Recibo ${editForm.receiptNumber || editForm.id} actualizado.`);
            setEditForm(null);
            setEditInvoiceSearch('');
        } catch (error) {
            console.error(error);
            setMessage(error?.message || 'No se pudo actualizar el recibo.');
        } finally {
            setEditSaving(false);
        }
    };

    const printReceipt = (receipt) => {
        const iframe = document.createElement('iframe');
        iframe.title = '';
        iframe.setAttribute('aria-hidden', 'true');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        iframe.style.opacity = '0';
        document.body.appendChild(iframe);

        const iframeWindow = iframe.contentWindow;
        const iframeDocument = iframe.contentDocument || iframeWindow?.document;
        if (!iframeWindow || !iframeDocument) {
            iframe.remove();
            return;
        }

        iframeDocument.open();
        iframeDocument.write(buildCashReceiptPrintHtml(receipt, cashReceiptLayout));
        iframeDocument.close();

        const cleanup = () => setTimeout(() => iframe.remove(), 500);
        iframeWindow.onafterprint = cleanup;
        setTimeout(() => {
            iframeWindow.focus();
            iframeWindow.print();
            cleanup();
        }, 180);
    };

    return (
        <>
        <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
            <Section
                title="Nuevo recibo de caja"
                eyebrow="Registro contable"
                action={(
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="green">Media carta</Badge>
                        <button
                            type="button"
                            onClick={() => setPrintTarget(receipts[0] || getCashReceiptPrintSample(form))}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-700 transition hover:border-[#e30613] hover:text-[#e30613]"
                        >
                            Ajustar impresion
                        </button>
                    </div>
                )}
            >
                <form onSubmit={saveReceipt} className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Fecha">
                            <input className={inputClass} type="date" value={form.date} onChange={(event) => update('date', event.target.value)} required />
                        </Field>
                        <Field label="Numero de recibo">
                            <input className={inputClass} value={form.receiptNumber} onChange={(event) => update('receiptNumber', event.target.value)} placeholder="Opcional / preimpreso" />
                        </Field>
                        <Field label="Recibi de">
                            <input
                                className={inputClass}
                                list="cash-receipt-clients"
                                value={form.customerName}
                                onChange={(event) => update('customerName', event.target.value)}
                                placeholder="Cliente"
                                required
                                readOnly={!form.isOtherReceipt && (form.invoiceApplications || []).length > 0}
                            />
                            <datalist id="cash-receipt-clients">
                                {clients.map((client) => (
                                    <option key={client.id || client.code || client.name} value={client.name || client.nombre || ''} />
                                ))}
                            </datalist>
                        </Field>
                        <Field label="Metodo de pago">
                            <PaymentMethodSelect value={form.paymentMethod} onChange={(value) => update('paymentMethod', value)} required />
                        </Field>
                        <Field label="Cantidad">
                            <input
                                className={inputClass}
                                type="number"
                                step="0.01"
                                min="0"
                                value={form.amount}
                                onChange={(event) => update('amount', event.target.value)}
                                required
                                readOnly={!form.isOtherReceipt && (form.invoiceApplications || []).length > 0}
                            />
                        </Field>
                        <Field label="Retencion 2%">
                            <input className={inputClass} type="number" step="0.01" min="0" value={form.retentionIr2} onChange={(event) => update('retentionIr2', event.target.value)} />
                        </Field>
                        <Field label="Retencion municipal 1%">
                            <input className={inputClass} type="number" step="0.01" min="0" value={form.retentionMunicipal1} onChange={(event) => update('retentionMunicipal1', event.target.value)} />
                        </Field>
                        <Field label="Referencia / CK No.">
                            <input className={inputClass} value={form.reference} onChange={(event) => update('reference', event.target.value)} placeholder="Opcional" />
                        </Field>
                        <Field label="Neto">
                            <input className={inputClass} readOnly value={formatInvoiceMoney(safeNumber(form.amount) - safeNumber(form.retentionIr2) - safeNumber(form.retentionMunicipal1))} />
                        </Field>
                        <Field label="En concepto de" span="md:col-span-2">
                            <textarea className={`${inputClass} min-h-[110px]`} value={form.concept} onChange={(event) => update('concept', event.target.value)} placeholder="Concepto del pago o recuperacion de credito" />
                        </Field>
                    </div>
                    <ReceiptInvoiceApplicationsEditor
                        isOtherReceipt={Boolean(form.isOtherReceipt)}
                        onToggleOtherReceipt={toggleOtherReceipt}
                        applications={form.invoiceApplications || []}
                        availableInvoices={availableCreditInvoices}
                        onToggleInvoice={toggleReceiptInvoice}
                        onUpdateApplicationAmount={updateReceiptInvoiceAmount}
                        searchValue={invoiceSearch}
                        onSearchChange={setInvoiceSearch}
                    />
                    {message && <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">{message}</div>}
                    <button type="submit" disabled={saving} className="w-full rounded-2xl bg-[#e30613] px-5 py-4 text-sm font-black uppercase tracking-[0.2em] text-white shadow-lg shadow-red-950/20 transition hover:bg-[#9f111a] disabled:cursor-not-allowed disabled:opacity-60">
                        {saving ? 'Guardando...' : 'Guardar recibo de caja'}
                    </button>
                </form>
            </Section>

            <Section title="Historial de recibos" eyebrow="Recibos de caja membretados" action={<Badge tone="blue">{filteredReceipts.length} registros</Badge>}>
                <SearchBox
                    value={search}
                    onChange={setSearch}
                    placeholder="Buscar por fecha, cliente, concepto, metodo o monto..."
                    resultLabel={`${filteredReceipts.length} de ${receipts.length}`}
                />
                <div className="mt-4 overflow-x-auto rounded-3xl border border-slate-200 bg-white">
                    <table className="min-w-full text-left text-sm">
                        <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                                <th className="px-4 py-3">Fecha</th>
                                <th className="px-4 py-3">Recibo</th>
                                <th className="px-4 py-3">Cliente</th>
                                <th className="px-4 py-3">Metodo</th>
                                <th className="px-4 py-3 text-right">Cantidad</th>
                                <th className="px-4 py-3 text-right">Retenciones</th>
                                <th className="px-4 py-3 text-right">Accion</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pagedReceipts.records.map((receipt) => (
                                <tr key={receipt.id} className="border-b border-slate-100 last:border-b-0">
                                    <td className="px-4 py-3 font-bold text-slate-700">{receipt.date || '-'}</td>
                                    <td className="px-4 py-3 font-black text-slate-950">{receipt.receiptNumber || '-'}</td>
                                    <td className="px-4 py-3 font-bold text-slate-600">{receipt.customerName || '-'}</td>
                                    <td className="px-4 py-3 font-bold text-slate-500">{receipt.paymentMethod || '-'}</td>
                                    <td className="px-4 py-3 text-right font-mono font-black text-emerald-700">{fmt(receipt.amount)}</td>
                                    <td className="px-4 py-3 text-right font-mono font-black text-amber-700">{fmt(getCashReceiptRetentionTotal(receipt))}</td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="flex justify-end gap-2">
                                            {isMaster && (
                                                <button type="button" onClick={() => openEditReceipt(receipt)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-700 transition hover:border-sky-500 hover:text-sky-700">
                                                    Editar
                                                </button>
                                            )}
                                            <button type="button" onClick={() => printReceipt(receipt)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-700 transition hover:border-[#e30613] hover:text-[#e30613]">
                                                Imprimir
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {pagedReceipts.records.length === 0 && (
                                <tr>
                                    <td className="px-4 py-10 text-center text-sm font-bold text-slate-400" colSpan="7">
                                        No hay recibos de caja para mostrar.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="mt-4">
                    <PaginationControls
                        page={pagedReceipts.page}
                        totalPages={pagedReceipts.totalPages}
                        total={filteredReceipts.length}
                        start={pagedReceipts.start}
                        end={pagedReceipts.end}
                        onPageChange={setPage}
                    />
                </div>
            </Section>
        </div>
        <CashReceiptPrintModal
            receipt={printTarget}
            layout={cashReceiptLayout}
            templates={cashReceiptTemplates}
            activeTemplateId={activeCashReceiptTemplateId}
            templateName={cashReceiptTemplateName}
            onSelectTemplate={selectCashReceiptTemplate}
            onTemplateNameChange={setCashReceiptTemplateName}
            onLayoutChange={setCashReceiptLayout}
            onSaveLayout={saveCashReceiptLayout}
            onSaveNewLayout={saveNewCashReceiptLayout}
            onClose={() => setPrintTarget(null)}
        />
        <CashReceiptEditModal
            form={editForm}
            saving={editSaving}
            availableInvoices={availableEditCreditInvoices}
            invoiceSearch={editInvoiceSearch}
            onInvoiceSearchChange={setEditInvoiceSearch}
            onClose={() => setEditForm(null)}
            onSave={saveEditedReceipt}
            onUpdate={updateEditReceipt}
            onToggleOtherReceipt={toggleEditOtherReceipt}
            onToggleInvoice={toggleEditReceiptInvoice}
            onUpdateInvoiceAmount={updateEditReceiptInvoiceAmount}
        />
        </>
    );
}

function CashReceiptHistory({ data, canEdit = true, branchContext }) {
    const { user } = useAuth();
    const isMaster = isMasterEmail(user?.email);
    const selectedBranchId = getActiveBillingBranchId(branchContext);
    const receiptBranchPayload = useMemo(() => getBranchPayload(selectedBranchId, 'receipt'), [selectedBranchId]);
    const [search, setSearch] = useState('');
    const [selectedMonth, setSelectedMonth] = useState(getMonth(todayString()));
    const [selectedDate, setSelectedDate] = useState('');
    const [page, setPage] = useState(1);
    const [message, setMessage] = useState('');
    const [printTarget, setPrintTarget] = useState(null);
    const [editForm, setEditForm] = useState(null);
    const [editSaving, setEditSaving] = useState(false);
    const [editInvoiceSearch, setEditInvoiceSearch] = useState('');
    const {
        cashReceiptLayout,
        cashReceiptTemplates,
        activeCashReceiptTemplateId,
        cashReceiptTemplateName,
        setCashReceiptLayout,
        setCashReceiptTemplateName,
        selectCashReceiptTemplate,
        saveCashReceiptLayout,
        saveNewCashReceiptLayout,
    } = useCashReceiptPrintTemplates(setMessage);
    const savedInvoices = useMemo(() => (
        [...(data.facturas_membretadas_ventas || [])]
            .map(normalizeStampedInvoiceRecord)
            .filter((invoice) => isRecordInBillingBranch(invoice, selectedBranchId))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    ), [data.facturas_membretadas_ventas, selectedBranchId]);
    const invoiceIndex = useMemo(() => new Map(
        savedInvoices
            .map((invoice) => [getInvoiceDocId(invoice), invoice])
            .filter(([invoiceId]) => invoiceId)
    ), [savedInvoices]);
    const creditInvoices = useMemo(() => (
        savedInvoices
            .filter((invoice) => isActiveStampedInvoice(invoice) && isCreditPaymentMethod(invoice.paymentMethod))
            .filter((invoice) => getInvoiceCreditBalance(invoice) > 0.01 || getInvoiceCreditReceiptIds(invoice).length > 0 || getInvoiceCreditPaidAmount(invoice) > 0.01)
    ), [savedInvoices]);
    const buildAvailableCreditInvoices = useCallback((customerName, searchValue, selectedApplications = []) => {
        const selectedAmounts = new Map(
            (selectedApplications || []).map((application) => [
                application.invoiceId,
                safeNumber(application.appliedAmount),
            ])
        );
        const customerKey = normalizeText(customerName);
        const searchKey = normalizeText(searchValue);

        return creditInvoices
            .map((invoice) => {
                const invoiceId = getInvoiceDocId(invoice);
                return {
                    ...invoice,
                    availableCreditBalance: safeNumber(getInvoiceCreditBalance(invoice) + safeNumber(selectedAmounts.get(invoiceId))),
                };
            })
            .filter((invoice) => {
                const invoiceId = getInvoiceDocId(invoice);
                const selected = selectedAmounts.has(invoiceId);
                const matchesCustomer = !customerKey || normalizeText(invoice.customerName || invoice.cliente || '') === customerKey || selected;
                const matchesSearch = !searchKey || recordSearchText(invoice, [
                    'date',
                    'invoiceNumber',
                    'customerName',
                    'creditStatusLabel',
                ]).includes(searchKey);
                return matchesCustomer && matchesSearch && (invoice.availableCreditBalance > 0.01 || selected);
            });
    }, [creditInvoices]);
    const availableEditCreditInvoices = useMemo(() => (
        editForm ? buildAvailableCreditInvoices(editForm.customerName, editInvoiceSearch, editForm.invoiceApplications) : []
    ), [buildAvailableCreditInvoices, editForm, editInvoiceSearch]);

    const receipts = useMemo(() => (
        [...(data.recibos_caja_membretados || [])]
            .map(normalizeCashReceiptRecord)
            .filter((receipt) => isRecordInBillingBranch(receipt, selectedBranchId))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    ), [data.recibos_caja_membretados, selectedBranchId]);

    const searchedReceipts = useMemo(() => filterRecords(receipts, search, [
        'date',
        'receiptNumber',
        'customerName',
        'concept',
        'paymentMethod',
        'amount',
    ]), [receipts, search]);

    const filteredReceipts = useMemo(() => (
        searchedReceipts.filter((receipt) => matchesHistoryDateFilters(receipt.date, selectedMonth, selectedDate))
    ), [searchedReceipts, selectedMonth, selectedDate]);

    const pagedReceipts = useMemo(() => paginateRecords(filteredReceipts, page), [filteredReceipts, page]);
    const totals = useMemo(() => (
        filteredReceipts.reduce((acc, receipt) => ({
            amount: safeNumber(acc.amount + safeNumber(receipt.amount)),
            retentionIr2: safeNumber(acc.retentionIr2 + safeNumber(receipt.retentionIr2)),
            retentionMunicipal1: safeNumber(acc.retentionMunicipal1 + safeNumber(receipt.retentionMunicipal1)),
            retentionTotal: safeNumber(acc.retentionTotal + getCashReceiptRetentionTotal(receipt)),
            count: acc.count + 1,
        }), { amount: 0, retentionIr2: 0, retentionMunicipal1: 0, retentionTotal: 0, count: 0 })
    ), [filteredReceipts]);

    useEffect(() => setPage(1), [search, selectedMonth, selectedDate]);
    useEffect(() => {
        if (page !== pagedReceipts.page) setPage(pagedReceipts.page);
    }, [page, pagedReceipts.page]);

    const printReceipt = (receipt) => {
        const iframe = document.createElement('iframe');
        iframe.title = '';
        iframe.setAttribute('aria-hidden', 'true');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        iframe.style.opacity = '0';
        document.body.appendChild(iframe);
        const iframeWindow = iframe.contentWindow;
        const iframeDocument = iframe.contentDocument || iframeWindow?.document;
        if (!iframeWindow || !iframeDocument) {
            iframe.remove();
            return;
        }
        iframeDocument.open();
        iframeDocument.write(buildCashReceiptPrintHtml(receipt, cashReceiptLayout));
        iframeDocument.close();
        const cleanup = () => setTimeout(() => iframe.remove(), 500);
        iframeWindow.onafterprint = cleanup;
        setTimeout(() => {
            iframeWindow.focus();
            iframeWindow.print();
            cleanup();
        }, 180);
    };

    const openEditReceipt = (receipt) => {
        if (!isMaster) return;
        setEditForm(createCashReceiptEditForm(receipt));
        setEditInvoiceSearch('');
    };

    const updateEditReceipt = (key, value) => {
        setEditForm((prev) => prev ? { ...prev, [key]: value } : prev);
    };

    const toggleEditOtherReceipt = (checked) => {
        setEditForm((prev) => prev ? ({
            ...prev,
            isOtherReceipt: checked,
            invoiceApplications: checked ? [] : prev.invoiceApplications,
            amount: checked ? '' : (prev.invoiceApplications?.length ? String(getCashReceiptApplicationsTotal(prev.invoiceApplications)) : ''),
        }) : prev);
    };

    const toggleEditReceiptInvoice = (invoice, checked) => {
        if (!editForm) return;
        const invoiceId = getInvoiceDocId(invoice);
        if (!invoiceId) return;
        const invoiceCustomerName = String(invoice.customerName || invoice.cliente || '').trim();
        const editCustomerKey = normalizeText(editForm.customerName);
        const invoiceCustomerKey = normalizeText(invoiceCustomerName);
        if (checked && editCustomerKey && invoiceCustomerKey && editCustomerKey !== invoiceCustomerKey) {
            setMessage('Un mismo recibo solo puede mezclar facturas del mismo cliente.');
            return;
        }

        setEditForm((prev) => {
            if (!prev) return prev;
            const currentApplications = Array.isArray(prev.invoiceApplications) ? prev.invoiceApplications : [];
            const nextApplications = checked
                ? currentApplications.some((application) => application.invoiceId === invoiceId)
                    ? currentApplications
                    : [
                        ...currentApplications,
                        {
                            invoiceId,
                            invoiceNumber: invoice.invoiceNumber || invoice.numeroFactura || '',
                            customerName: invoiceCustomerName,
                            appliedAmount: String(safeNumber(invoice.availableCreditBalance ?? getInvoiceCreditBalance(invoice))),
                        },
                    ]
                : currentApplications.filter((application) => application.invoiceId !== invoiceId);

            return {
                ...prev,
                isOtherReceipt: false,
                customerName: prev.customerName || invoiceCustomerName,
                invoiceApplications: nextApplications,
                amount: nextApplications.length ? String(getCashReceiptApplicationsTotal(nextApplications)) : '',
            };
        });
    };

    const updateEditReceiptInvoiceAmount = (invoiceId, value) => {
        setEditForm((prev) => {
            if (!prev) return prev;
            const nextApplications = (prev.invoiceApplications || []).map((application) => (
                application.invoiceId === invoiceId
                    ? { ...application, appliedAmount: value }
                    : application
            ));
            return {
                ...prev,
                invoiceApplications: nextApplications,
                amount: nextApplications.length ? String(getCashReceiptApplicationsTotal(nextApplications)) : '',
            };
        });
    };

    const saveEditedReceipt = async (event) => {
        event.preventDefault();
        if (!isMaster || !editForm?.id) return;
        setEditSaving(true);
        setMessage('');
        try {
            const existingReceipt = receipts.find((receipt) => receipt.id === editForm.id) || {};
            assertUniqueCashReceiptNumber(
                { ...receiptBranchPayload, ...editForm },
                receipts,
                [editForm.id, editForm.docId]
            );
            const { receiptPayload } = await persistCashReceiptRecord({
                receiptId: editForm.id,
                form: editForm,
                existingReceipt,
                invoiceIndex,
                branchPayload: receiptBranchPayload,
            });
            await setDoc(doc(db, 'clientes_facturacion', `CLI-${slugify(receiptPayload.customerName)}`), {
                code: `CLI-${slugify(receiptPayload.customerName)}`,
                name: receiptPayload.customerName,
                normalizedName: normalizeText(receiptPayload.customerName),
                source: receiptPayload.invoiceApplications?.length ? 'recibo_caja_credito' : 'recibo_caja',
                updatedAt: serverTimestamp(),
                createdAt: serverTimestamp(),
            }, { merge: true });
            setMessage(`Recibo ${editForm.receiptNumber || editForm.id} actualizado.`);
            setEditForm(null);
            setEditInvoiceSearch('');
        } catch (error) {
            console.error(error);
            setMessage(error?.message || 'No se pudo actualizar el recibo.');
        } finally {
            setEditSaving(false);
        }
    };

    return (
        <>
        <div className="space-y-5">
            <Section
                title="Historial de recibos de caja"
                eyebrow="Recibos membretados"
                action={(
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="blue">{filteredReceipts.length} recibos</Badge>
                        <button
                            type="button"
                            onClick={() => setPrintTarget(filteredReceipts[0] || receipts[0] || getCashReceiptPrintSample())}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-700 transition hover:border-[#e30613] hover:text-[#e30613]"
                        >
                            Ajustar impresion
                        </button>
                    </div>
                )}
            >
                <div className="grid gap-3 lg:grid-cols-[1fr_0.35fr_0.35fr_auto]">
                    <SearchBox value={search} onChange={setSearch} placeholder="Buscar recibo, cliente, concepto o metodo..." resultLabel={`${searchedReceipts.length} encontrados`} />
                    <Field label="Mes">
                        <input className={inputClass} type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} />
                    </Field>
                    <Field label="Dia especifico">
                        <input className={inputClass} type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
                    </Field>
                    <div className="flex items-end">
                        <button
                            type="button"
                            onClick={() => {
                                setSearch('');
                                setSelectedMonth('');
                                setSelectedDate('');
                            }}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-slate-600 transition hover:border-[#e30613] hover:text-[#e30613]"
                        >
                            Limpiar
                        </button>
                    </div>
                </div>
                {message && <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">{message}</div>}
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                    <SummaryCard label="Recibos" value={totals.count} />
                    <SummaryCard label="Cantidad total" value={fmt(totals.amount)} tone="green" />
                    <SummaryCard label="Retenciones" value={fmt(totals.retentionTotal)} tone="amber" />
                </div>
            </Section>
            <Section title="Recibos registrados" eyebrow="Detalle">
                <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white">
                    <table className="min-w-full text-left text-sm">
                        <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                                <th className="px-4 py-3">Fecha</th>
                                <th className="px-4 py-3">Recibo</th>
                                <th className="px-4 py-3">Cliente</th>
                                <th className="px-4 py-3">Concepto</th>
                                <th className="px-4 py-3">Metodo</th>
                                <th className="px-4 py-3 text-right">Cantidad</th>
                                <th className="px-4 py-3 text-right">Retenciones</th>
                                <th className="px-4 py-3 text-right">Accion</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pagedReceipts.records.map((receipt) => (
                                <tr key={receipt.id} className="border-b border-slate-100 last:border-b-0">
                                    <td className="px-4 py-3 font-bold text-slate-700">{receipt.date || '-'}</td>
                                    <td className="px-4 py-3 font-black text-slate-950">{receipt.receiptNumber || '-'}</td>
                                    <td className="px-4 py-3 font-bold text-slate-600">{receipt.customerName || '-'}</td>
                                    <td className="px-4 py-3 font-bold text-slate-500">{receipt.concept || '-'}</td>
                                    <td className="px-4 py-3 font-bold text-slate-500">{receipt.paymentMethod || '-'}</td>
                                    <td className="px-4 py-3 text-right font-mono font-black text-emerald-700">{fmt(receipt.amount)}</td>
                                    <td className="px-4 py-3 text-right font-mono font-black text-amber-700">{fmt(getCashReceiptRetentionTotal(receipt))}</td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="flex justify-end gap-2">
                                            {isMaster && canEdit && (
                                                <button type="button" onClick={() => openEditReceipt(receipt)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-700 transition hover:border-sky-500 hover:text-sky-700">Editar</button>
                                            )}
                                            <button type="button" onClick={() => printReceipt(receipt)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-700 transition hover:border-[#e30613] hover:text-[#e30613]">Imprimir</button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {pagedReceipts.records.length === 0 && (
                                <tr><td className="px-4 py-10 text-center text-sm font-bold text-slate-400" colSpan="8">No hay recibos para este filtro.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="mt-4">
                    <PaginationControls page={pagedReceipts.page} totalPages={pagedReceipts.totalPages} total={filteredReceipts.length} start={pagedReceipts.start} end={pagedReceipts.end} onPageChange={setPage} />
                </div>
            </Section>
        </div>
        <CashReceiptPrintModal
            receipt={printTarget}
            layout={cashReceiptLayout}
            templates={cashReceiptTemplates}
            activeTemplateId={activeCashReceiptTemplateId}
            templateName={cashReceiptTemplateName}
            onSelectTemplate={selectCashReceiptTemplate}
            onTemplateNameChange={setCashReceiptTemplateName}
            onLayoutChange={setCashReceiptLayout}
            onSaveLayout={saveCashReceiptLayout}
            onSaveNewLayout={saveNewCashReceiptLayout}
            onClose={() => setPrintTarget(null)}
        />
        <CashReceiptEditModal
            form={editForm}
            saving={editSaving}
            availableInvoices={availableEditCreditInvoices}
            invoiceSearch={editInvoiceSearch}
            onInvoiceSearchChange={setEditInvoiceSearch}
            onClose={() => setEditForm(null)}
            onSave={saveEditedReceipt}
            onUpdate={updateEditReceipt}
            onToggleOtherReceipt={toggleEditOtherReceipt}
            onToggleInvoice={toggleEditReceiptInvoice}
            onUpdateInvoiceAmount={updateEditReceiptInvoiceAmount}
        />
        </>
    );
}

function StampedInvoices({ data, branchContext }) {
    const todaySicarInvoiceDate = todayString();
    const selectedBranchId = getActiveBillingBranchId(branchContext);
    const invoiceBranchPayload = useMemo(() => getBranchPayload(selectedBranchId, 'invoice'), [selectedBranchId]);
    const savedInvoices = useMemo(() => (
        [...(data.facturas_membretadas_ventas || [])]
            .map(normalizeStampedInvoiceRecord)
            .filter((invoice) => isRecordInBillingBranch(invoice, selectedBranchId))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    ), [data.facturas_membretadas_ventas, selectedBranchId]);

    const loadedInvoiceIndex = useMemo(() => buildLoadedInvoiceIndex(savedInvoices), [savedInvoices]);

    const sicarInvoices = useMemo(() => (
        [...(data.sicar_facturas_membretadas || [])]
            .map((item) => ({
                ...item,
                date: item.date || getRecordDate(item.fecha || item.invoiceDate),
                invoiceNumber: item.numeroFactura || item.invoiceNumber || item.folio || '',
                items: item.items || [],
                ...getBranchPayload(getRecordBranchId(item)),
            }))
            .filter((invoice) => isRecordInBillingBranch(invoice, selectedBranchId))
            .filter((invoice) => String(invoice.date || '').substring(0, 10) === todaySicarInvoiceDate)
            .filter((invoice) => isSicarInvoicePendingAccounting(invoice, loadedInvoiceIndex))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    ), [data.sicar_facturas_membretadas, loadedInvoiceIndex, selectedBranchId, todaySicarInvoiceDate]);

    const clients = useMemo(() => (
        [...(data.clientes_facturacion || [])]
            .map((item) => ({ ...item, name: item.name || item.nombre || '' }))
            .filter((item) => item.name)
            .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    ), [data.clientes_facturacion]);

    const [entryMode, setEntryMode] = useState('sicar');
    const [form, setForm] = useState(createStampedInvoiceForm);
    const [splitInvoice, setSplitInvoice] = useState(null);
    const [supportFiles, setSupportFiles] = useState({});
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [paymentSplitOpen, setPaymentSplitOpen] = useState(false);
    const [sicarInvoiceSearch, setSicarInvoiceSearch] = useState('');
    const [sicarInvoicePage, setSicarInvoicePage] = useState(1);

    const fiscal = buildFiscalPayload({
        subtotal: safeNumber(form.subtotal),
        iva: safeNumber(form.iva),
        total: safeNumber(form.total) || safeNumber(form.subtotal) + safeNumber(form.iva),
        retentionIr2: safeNumber(form.retentionIr2),
        retentionMunicipal1: safeNumber(form.retentionMunicipal1),
    });

    const filteredSicarInvoices = useMemo(() => filterRecords(sicarInvoices, sicarInvoiceSearch, [
        'date',
        'invoiceNumber',
        'numeroFactura',
        'folio',
        'customerName',
        'cliente',
        'customerRfc',
        'rfc',
        'total',
    ]), [sicarInvoices, sicarInvoiceSearch]);

    const pagedSicarInvoices = useMemo(() => (
        paginateRecords(filteredSicarInvoices, sicarInvoicePage)
    ), [filteredSicarInvoices, sicarInvoicePage]);
    const canSplitCurrentInvoice = (form.items || []).length > 10 && !splitInvoice;

    useEffect(() => {
        setSicarInvoicePage(1);
    }, [sicarInvoiceSearch]);

    useEffect(() => {
        if (sicarInvoicePage !== pagedSicarInvoices.page) setSicarInvoicePage(pagedSicarInvoices.page);
    }, [sicarInvoicePage, pagedSicarInvoices.page]);

    const update = (key, value) => {
        if (key === 'cashierName') {
            setSplitInvoice((prev) => prev ? { ...prev, cashierName: value } : prev);
        }
        setForm((prev) => {
            const next = { ...prev, [key]: value };
            if (key === 'subtotal' || key === 'iva') {
                next.total = String(safeNumber(next.subtotal) + safeNumber(next.iva));
            }
            if (key === 'paymentMethod') {
                next.paymentBreakdown = [];
                next.paymentNetTotal = 0;
            }
            return next;
        });
    };

    const applyPaymentSplit = (rows) => {
        const normalizedRows = normalizePaymentBreakdownRows(rows);
        setForm((prev) => ({
            ...prev,
            paymentBreakdown: normalizedRows,
            paymentNetTotal: getPaymentBreakdownTotal(normalizedRows),
            paymentMethod: getPaymentMethodFromBreakdown(normalizedRows, prev.paymentMethod),
        }));
        setPaymentSplitOpen(false);
        setMessage('Pago dividido aplicado a la factura.');
    };

    const applyItemTotals = (items = []) => {
        const totals = calculateInvoiceItemsFiscal(items);
        return {
            items,
            subtotal: String(totals.subtotal),
            iva: String(totals.iva),
            total: String(totals.total),
        };
    };

    const setMode = (mode) => {
        setEntryMode(mode);
        setSplitInvoice(null);
        setSupportFiles({});
        setForm((prev) => {
            if (mode === 'manual') {
                const items = prev.sourceSicarInvoiceId ? [createManualInvoiceItem()] : (prev.items?.length ? prev.items : [createManualInvoiceItem()]);
                return {
                    ...prev,
                    sourceSicarInvoiceId: '',
                    sourceSicarInvoiceNumber: '',
                    cashierName: prev.cashierName || '',
                    paymentBreakdown: [],
                    paymentNetTotal: 0,
                    ...applyItemTotals(items),
                };
            }
            return {
                ...createStampedInvoiceForm(),
                date: prev.date || todayString(),
                cashierName: prev.cashierName || '',
                paymentMethod: prev.paymentMethod || '',
                paymentBreakdown: [],
                paymentNetTotal: 0,
            };
        });
        setMessage(mode === 'manual' ? 'Modo manual activo: podes escribir articulos, cantidades y precios.' : 'Modo SICAR activo: carga una factura pendiente desde MySQL.');
    };

    const loadSicarInvoice = (invoice) => {
        setEntryMode('sicar');
        setSplitInvoice(null);
        setForm({
            date: invoice.date || todayString(),
            invoiceNumber: '',
            customerName: invoice.customerName || invoice.cliente || '',
            customerAddress: invoice.customerAddress || invoice.address || '',
            customerRfc: invoice.customerRfc || invoice.rfc || '',
            cashierName: form.cashierName || getCashierName(invoice),
            subtotal: String(safeNumber(invoice.subtotal)),
            iva: String(safeNumber(invoice.iva)),
            total: String(safeNumber(invoice.total)),
            retentionIr2: '',
            retentionMunicipal1: '',
            paymentMethod: invoice.paymentMethod || '',
            paymentBreakdown: [],
            paymentNetTotal: 0,
            sourceSicarInvoiceId: invoice.id || '',
            sourceSicarInvoiceNumber: invoice.invoiceNumber || invoice.numeroFactura || invoice.folio || '',
            items: invoice.items || [],
        });
        setMessage(`Factura SICAR ${invoice.invoiceNumber || invoice.id} cargada con ${(invoice.items || []).length} articulo(s). Ingresa el numero consecutivo de la factura membretada de la app.`);
    };

    const updateManualItem = (index, key, value) => {
        setSplitInvoice(null);
        setForm((prev) => {
            const items = [...(prev.items || [])];
            const current = { ...(items[index] || createManualInvoiceItem()), [key]: value };
            if (['quantity', 'unitPriceWithoutTax'].includes(key)) {
                current.totalWithoutTax = String(safeNumber(safeNumber(current.quantity) * safeNumber(current.unitPriceWithoutTax)));
            }
            if (['quantity', 'unitPriceWithoutTax', 'totalWithoutTax', 'taxAmount'].includes(key)) {
                current.totalWithTax = String(safeNumber(getInvoiceItemSubtotal(current) + getInvoiceItemTax(current)));
            }
            items[index] = current;
            return { ...prev, ...applyItemTotals(items) };
        });
    };

    const addManualItem = () => {
        setSplitInvoice(null);
        setForm((prev) => {
            const items = [...(prev.items || []), createManualInvoiceItem()];
            return { ...prev, ...applyItemTotals(items) };
        });
    };

    const removeManualItem = (index) => {
        setSplitInvoice(null);
        setForm((prev) => {
            const items = (prev.items || []).filter((_, itemIndex) => itemIndex !== index);
            return { ...prev, ...applyItemTotals(items) };
        });
    };

    const splitCurrentInvoice = () => {
        const items = form.items || [];
        if (items.length <= 10) {
            setMessage('La factura solo se divide cuando tiene mas de 10 articulos.');
            return;
        }
        if (!String(form.invoiceNumber || '').trim()) {
            setMessage('Ingresa primero el numero de la factura principal de la app.');
            return;
        }
        const secondInvoiceNumber = window.prompt('Numero de factura para la segunda factura membretada:');
        if (!String(secondInvoiceNumber || '').trim()) return;
        if (normalizeInvoiceMatchKey(secondInvoiceNumber) === normalizeInvoiceMatchKey(form.invoiceNumber)) {
            setMessage('El numero de la segunda factura debe ser diferente al de la primera.');
            return;
        }
        const duplicateAppInvoice = findStampedInvoiceNumberDuplicate(savedInvoices, secondInvoiceNumber, [], invoiceBranchPayload);
        if (duplicateAppInvoice) {
            setMessage(buildDuplicateInvoiceNumberMessage(secondInvoiceNumber, duplicateAppInvoice));
            return;
        }

        const firstItems = items.slice(0, 10);
        const secondItems = items.slice(10);
        const firstTotals = calculateInvoiceItemsFiscal(firstItems);
        const secondTotals = calculateInvoiceItemsFiscal(secondItems);
        setForm((prev) => ({
            ...prev,
            items: firstItems,
            subtotal: String(firstTotals.subtotal),
            iva: String(firstTotals.iva),
            total: String(firstTotals.total),
            paymentBreakdown: [],
            paymentNetTotal: 0,
            paymentMethod: '',
        }));
        setSplitInvoice({
            ...form,
            invoiceNumber: String(secondInvoiceNumber).trim(),
            items: secondItems,
            subtotal: String(secondTotals.subtotal),
            iva: String(secondTotals.iva),
            total: String(secondTotals.total),
            retentionIr2: '',
            retentionMunicipal1: '',
            paymentMethod: '',
            paymentBreakdown: [],
            paymentNetTotal: 0,
            splitPart: 2,
        });
        setMessage(`Factura dividida: 10 articulos quedan en ${form.invoiceNumber}; ${secondItems.length} articulos pasan a ${String(secondInvoiceNumber).trim()}. Al guardar se crean ambas.`);
    };

    const updateSplitInvoiceNumber = (value) => {
        setSplitInvoice((prev) => prev ? { ...prev, invoiceNumber: value } : prev);
    };

    const upsertClientRecord = async (name, source = 'factura_membretada') => {
        const safeName = String(name || '').trim();
        if (!safeName) return '';
        const code = `CLI-${slugify(safeName)}`;
        await setDoc(doc(db, 'clientes_facturacion', code), {
            code,
            name: safeName,
            normalizedName: normalizeText(safeName),
            source,
            updatedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
        }, { merge: true });
        return code;
    };

    const requestCreateClient = async (name) => {
        const safeName = String(name || '').trim();
        if (!safeName) return;
        if (recordExistsByName(clients, safeName)) {
            setMessage(`Cliente ya existe: ${safeName}.`);
            return;
        }
        if (!window.confirm(`El cliente "${safeName}" no existe. Deseas agregarlo a la base de clientes?`)) return;
        await upsertClientRecord(safeName, 'manual_factura_membretada');
        setMessage(`Cliente agregado a la base: ${safeName}.`);
    };

    const saveInvoice = async (event) => {
        event.preventDefault();
        setSaving(true);
        setMessage('');
        try {
            const invoicesToSave = [form, splitInvoice].filter(Boolean).map((invoice, index, list) => ({
                ...invoiceBranchPayload,
                ...invoice,
                splitPart: list.length > 1 ? index + 1 : null,
                splitTotalParts: list.length > 1 ? list.length : null,
                items: normalizeInvoiceItemsForSave(invoice.items || []),
            }));

            invoicesToSave.forEach((invoice) => {
                if (!String(invoice.invoiceNumber || '').trim()) throw new Error('Ingresa el numero de factura.');
                if (!String(invoice.cashierName || '').trim()) throw new Error(`Selecciona cajero para la factura ${invoice.invoiceNumber || ''}.`);
                if (!safeNumber(invoice.subtotal) && !safeNumber(invoice.total)) throw new Error(`Ingresa subtotal o total para la factura ${invoice.invoiceNumber}.`);
                validatePaymentBreakdownForInvoice(invoice);
            });

            const invoiceNumberKeys = invoicesToSave.map((invoice) => getFiscalDocumentMatchKey(invoice, 'invoice')).filter(Boolean);
            if (new Set(invoiceNumberKeys).size !== invoiceNumberKeys.length) {
                throw new Error('Este numero de factura ya existe en la division. Las facturas divididas deben tener numeros diferentes.');
            }

            const invoiceMeta = invoicesToSave.map((invoice) => ({
                invoice,
                docId: buildBranchScopedFiscalDocId('membretada', invoiceBranchPayload, invoice.invoiceNumber, invoice.date),
            }));

            assertUniqueStampedInvoiceNumbers(invoicesToSave, savedInvoices);

            const primaryDocId = invoiceMeta[0].docId;
            const existingInvoice = savedInvoices.find((item) => item.id === primaryDocId) || {};
            const supportPayload = await uploadFiscalSupportFiles(
                supportFiles,
                'facturacion/facturas_membretadas',
                primaryDocId,
                existingInvoice
            );

            if (form.customerName.trim()) {
                await upsertClientRecord(form.customerName.trim(), 'factura_membretada');
            }

            for (const { invoice, docId } of invoiceMeta) {
                const cashierName = String(invoice.cashierName || '').trim();
                const cashierCode = getCashierCode(cashierName);
                const paymentBreakdown = validatePaymentBreakdownForInvoice(invoice);
                const paymentMethod = getPaymentMethodFromBreakdown(paymentBreakdown, invoice.paymentMethod);
                const itemFiscal = calculateInvoiceItemsFiscal(invoice.items || []);
                const invoiceFiscal = buildFiscalPayload({
                    subtotal: itemFiscal.subtotal || safeNumber(invoice.subtotal),
                    iva: itemFiscal.iva || safeNumber(invoice.iva),
                    total: itemFiscal.total || safeNumber(invoice.total) || safeNumber(invoice.subtotal) + safeNumber(invoice.iva),
                    retentionIr2: safeNumber(invoice.retentionIr2),
                    retentionMunicipal1: safeNumber(invoice.retentionMunicipal1),
                });
                const creditSnapshot = buildCreditInvoiceSnapshot(
                    { ...invoice, paymentMethod, ...invoiceFiscal },
                    isCreditPaymentMethod(paymentMethod)
                        ? {
                            creditOriginalAmount: getInvoicePaymentTargetAmount({ ...invoice, paymentMethod, ...invoiceFiscal }),
                            creditPaidAmount: 0,
                            creditReceiptIds: [],
                        }
                        : {}
                );

                await setDoc(doc(db, 'facturas_membretadas_ventas', docId), {
                    ...buildInvoiceDocumentFields(invoice, invoiceBranchPayload),
                    date: invoice.date,
                    saleDate: invoice.date,
                    month: getMonth(invoice.date),
                    numeroFactura: String(invoice.invoiceNumber || '').trim(),
                    invoiceNumber: String(invoice.invoiceNumber || '').trim(),
                    customerName: String(invoice.customerName || '').trim(),
                    customerAddress: String(invoice.customerAddress || '').trim(),
                    customerRfc: String(invoice.customerRfc || '').trim(),
                    cashierName,
                    cashierCode,
                    paymentMethod: String(paymentMethod || '').trim(),
                    paymentBreakdown,
                    paymentNetTotal: paymentBreakdown.length ? getPaymentBreakdownTotal(paymentBreakdown) : getInvoicePaymentTargetAmount({ ...invoice, ...invoiceFiscal }),
                    items: invoice.items || [],
                    ...invoiceFiscal,
                    source: invoice.sourceSicarInvoiceId ? 'sicar_factura' : 'manual',
                    sourceType: 'stamped_sale_invoice',
                    sourceSicarInvoiceId: invoice.sourceSicarInvoiceId || '',
                    sourceSicarInvoiceNumber: invoice.sourceSicarInvoiceNumber || '',
                    ...creditSnapshot,
                    splitGroupId: invoiceMeta.length > 1 ? primaryDocId : '',
                    splitPart: invoice.splitPart || null,
                    splitTotalParts: invoice.splitTotalParts || null,
                    status: 'active',
                    ...supportPayload,
                    updatedAt: serverTimestamp(),
                    createdAt: serverTimestamp(),
                }, { merge: true });
            }

            const sicarAccountingGroups = new Map();
            invoiceMeta.forEach(({ invoice, docId }) => {
                const sourceId = String(invoice.sourceSicarInvoiceId || '').trim();
                if (!sourceId) return;
                const current = sicarAccountingGroups.get(sourceId) || {
                    docIds: [],
                    invoiceNumbers: [],
                    sourceSicarInvoiceNumber: invoice.sourceSicarInvoiceNumber || '',
                };
                current.docIds.push(docId);
                current.invoiceNumbers.push(String(invoice.invoiceNumber || '').trim());
                current.sourceSicarInvoiceNumber = current.sourceSicarInvoiceNumber || invoice.sourceSicarInvoiceNumber || '';
                sicarAccountingGroups.set(sourceId, current);
            });

            for (const [sourceId, accountingGroup] of sicarAccountingGroups.entries()) {
                await setDoc(doc(db, 'sicar_facturas_membretadas', sourceId), {
                    accountingStatus: 'contabilizada',
                    accountingInvoiceId: accountingGroup.docIds[0] || '',
                    accountingInvoiceIds: accountingGroup.docIds,
                    accountingInvoiceNumber: accountingGroup.invoiceNumbers[0] || '',
                    accountingInvoiceNumbers: accountingGroup.invoiceNumbers,
                    accountingSourceSicarInvoiceId: sourceId,
                    sourceSicarInvoiceNumber: accountingGroup.sourceSicarInvoiceNumber || '',
                    accountingLoadedAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                }, { merge: true });
            }

            setMessage(invoiceMeta.length > 1 ? 'Facturas membretadas divididas guardadas e integradas al reporte tributario.' : 'Factura membretada guardada e integrada al reporte tributario.');
            setSupportFiles({});
            setSplitInvoice(null);
            setForm(createStampedInvoiceForm());
        } catch (error) {
            console.error(error);
            setMessage(error?.message || 'No se pudo guardar la factura membretada.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
        <div className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
            <Section
                title="Nueva factura membretada"
                eyebrow="Retenciones fiscales"
                action={<Badge tone="green">Reporte tributario</Badge>}
            >
                <form onSubmit={saveInvoice} className="space-y-5">
                    <div className="rounded-[1.8rem] border border-slate-200 bg-slate-50/70 p-3">
                        <div className="mb-2 text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Modo de captura</div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <button
                                type="button"
                                onClick={() => setMode('sicar')}
                                className={`rounded-2xl border px-4 py-3 text-sm font-black uppercase tracking-[0.18em] transition ${entryMode === 'sicar' ? 'border-[#e30613] bg-[#e30613] text-white shadow-lg shadow-red-950/20' : 'border-slate-200 bg-white text-slate-700 hover:border-[#e30613] hover:text-[#e30613]'}`}
                            >
                                SICAR
                            </button>
                            <button
                                type="button"
                                onClick={() => setMode('manual')}
                                className={`rounded-2xl border px-4 py-3 text-sm font-black uppercase tracking-[0.18em] transition ${entryMode === 'manual' ? 'border-slate-950 bg-slate-950 text-white shadow-lg shadow-slate-950/20' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-950 hover:text-slate-950'}`}
                            >
                                Manual
                            </button>
                        </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Fecha">
                            <input className={inputClass} type="date" value={form.date} onChange={(event) => update('date', event.target.value)} required />
                        </Field>
                        <Field label="Numero factura app / membretada">
                            <input className={inputClass} value={form.invoiceNumber} onChange={(event) => update('invoiceNumber', event.target.value)} required />
                            {form.sourceSicarInvoiceId && (
                                <div className="mt-2 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-black text-sky-700">
                                    Origen SICAR: factura {form.sourceSicarInvoiceNumber || form.sourceSicarInvoiceId}. Este numero no se copia como consecutivo de la app.
                                </div>
                            )}
                        </Field>
                        <Field label="Cajero">
                            <select className={inputClass} value={form.cashierName || ''} onChange={(event) => update('cashierName', event.target.value)} required>
                                <option value="">Seleccionar cajero...</option>
                                {CASHIER_OPTIONS.map((cashier) => (
                                    <option key={cashier} value={cashier}>{cashier}</option>
                                ))}
                            </select>
                        </Field>
                        <Field label="Cliente">
                            <input className={inputClass} list="stamped-invoice-clients" value={form.customerName} onChange={(event) => update('customerName', event.target.value)} placeholder="Cliente / razon social" />
                            <datalist id="stamped-invoice-clients">
                                {clients.map((client) => <option key={client.id || client.code || client.name} value={client.name} />)}
                            </datalist>
                            {String(form.customerName || '').trim() && !recordExistsByName(clients, form.customerName) && (
                                <button
                                    type="button"
                                    onClick={() => requestCreateClient(form.customerName)}
                                    className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700 transition hover:bg-emerald-100"
                                >
                                    Agregar cliente
                                </button>
                            )}
                        </Field>
                        <Field label="Direccion cliente" span="md:col-span-2">
                            <input className={inputClass} value={form.customerAddress} onChange={(event) => update('customerAddress', event.target.value)} placeholder="Direccion fiscal / direccion de entrega" />
                        </Field>
                        <Field label="R.F.C / RUC">
                            <input className={inputClass} value={form.customerRfc} onChange={(event) => update('customerRfc', event.target.value)} placeholder="RUC / RFC del cliente" />
                        </Field>
                        <Field label="Metodo de pago">
                            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                                <PaymentMethodSelect value={form.paymentMethod} onChange={(value) => update('paymentMethod', value)} required />
                                <button
                                    type="button"
                                    onClick={() => setPaymentSplitOpen(true)}
                                    className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-sky-700 transition hover:bg-sky-100"
                                >
                                    Dividir pago
                                </button>
                            </div>
                            <PaymentBreakdownPreview invoice={form} />
                        </Field>
                        <Field label="Subtotal">
                            <input className={inputClass} type="number" step="0.01" min="0" value={form.subtotal} onChange={(event) => update('subtotal', event.target.value)} required />
                        </Field>
                        <Field label="IVA">
                            <input className={inputClass} type="number" step="0.01" min="0" value={form.iva} onChange={(event) => update('iva', event.target.value)} />
                        </Field>
                        <Field label="Total">
                            <input className={inputClass} type="number" step="0.01" min="0" value={form.total} onChange={(event) => update('total', event.target.value)} required />
                        </Field>
                        <Field label="Retencion anticipo IR 2%">
                            <input className={inputClass} type="number" step="0.01" min="0" value={form.retentionIr2} onChange={(event) => update('retentionIr2', event.target.value)} />
                        </Field>
                        <Field label="Retencion municipal 1%">
                            <input className={inputClass} type="number" step="0.01" min="0" value={form.retentionMunicipal1} onChange={(event) => update('retentionMunicipal1', event.target.value)} />
                        </Field>
                        <Field label="Foto factura">
                            <input className={inputClass} type="file" accept="image/*,application/pdf" onChange={(event) => setSupportFiles((prev) => ({ ...prev, invoice: event.target.files?.[0] || null }))} />
                        </Field>
                        <Field label="Soporte retencion IR 2%">
                            <input className={inputClass} type="file" accept="image/*,application/pdf" onChange={(event) => setSupportFiles((prev) => ({ ...prev, retentionIr2: event.target.files?.[0] || null }))} />
                        </Field>
                        <Field label="Soporte retencion municipal 1%">
                            <input className={inputClass} type="file" accept="image/*,application/pdf" onChange={(event) => setSupportFiles((prev) => ({ ...prev, retentionMunicipal1: event.target.files?.[0] || null }))} />
                        </Field>
                    </div>

                    <div className="rounded-[1.8rem] border border-slate-200 bg-slate-50/70 p-4">
                        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <div className="text-sm font-black text-slate-950">{entryMode === 'manual' ? 'Detalle de articulos manuales' : 'Detalle de articulos SICAR'}</div>
                                <div className="text-xs font-semibold text-slate-500">
                                    {entryMode === 'manual'
                                        ? 'Opcional: si solo queres registrar subtotal, IVA, total y retenciones, podes dejar articulos vacios.'
                                        : 'Se imprimen cantidad, producto, precio sin IVA y total sin IVA.'}
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                {canSplitCurrentInvoice && (
                                    <button
                                        type="button"
                                        onClick={splitCurrentInvoice}
                                        className="rounded-xl border border-amber-300 bg-amber-100 px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-amber-800 shadow-sm transition hover:bg-amber-200"
                                    >
                                        Dividir factura
                                    </button>
                                )}
                                {splitInvoice && (
                                    <button
                                        type="button"
                                        onClick={() => setSplitInvoice(null)}
                                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-600 transition hover:border-[#e30613] hover:text-[#e30613]"
                                    >
                                        Cancelar division
                                    </button>
                                )}
                                <Badge tone={form.items?.length ? 'green' : 'slate'}>{form.items?.length || 0} lineas</Badge>
                            </div>
                        </div>
                        {canSplitCurrentInvoice && (
                            <div className="mb-3 flex flex-col gap-3 rounded-3xl border border-amber-300 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <div className="text-sm font-black text-amber-900">Esta factura tiene {(form.items || []).length} articulos.</div>
                                    <div className="text-xs font-bold text-amber-700">
                                        Puede dividirse tambien cuando viene desde SICAR: 10 articulos quedan en la primera factura y el resto pasa a una segunda.
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={splitCurrentInvoice}
                                    className="rounded-2xl bg-amber-600 px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white shadow-lg shadow-amber-900/20 transition hover:bg-amber-700"
                                >
                                    Dividir factura
                                </button>
                            </div>
                        )}
                        {entryMode === 'manual' ? (
                            <ManualInvoiceItemsEditor
                                items={form.items || []}
                                onAdd={addManualItem}
                                onChange={updateManualItem}
                                onRemove={removeManualItem}
                            />
                        ) : (
                            <InvoiceItemsTable items={form.items || []} />
                        )}
                    </div>

                    {splitInvoice && (
                        <div className="rounded-[1.8rem] border border-amber-200 bg-amber-50/70 p-4">
                            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-700">Factura dividida</div>
                                    <div className="text-sm font-black text-slate-950">Segunda factura con articulos restantes</div>
                                    <div className="text-xs font-semibold text-slate-500">{splitInvoice.items?.length || 0} articulos se guardaran como otra factura.</div>
                                </div>
                                <div className="w-full sm:w-64">
                                    <input
                                        className={inputClass}
                                        value={splitInvoice.invoiceNumber || ''}
                                        onChange={(event) => updateSplitInvoiceNumber(event.target.value)}
                                        placeholder="Numero segunda factura"
                                        required
                                    />
                                </div>
                            </div>
                            <InvoiceItemsTable items={splitInvoice.items || []} />
                            <div className="mt-3 grid gap-3 md:grid-cols-3">
                                <SummaryCard label="Subtotal factura 2" value={fmt(splitInvoice.subtotal)} />
                                <SummaryCard label="IVA factura 2" value={fmt(splitInvoice.iva)} tone="blue" />
                                <SummaryCard label="Total factura 2" value={fmt(splitInvoice.total)} tone="green" />
                            </div>
                        </div>
                    )}

                    <div className="grid gap-3 md:grid-cols-4">
                        <SummaryCard label="Subtotal" value={fmt(fiscal.subtotal)} />
                        <SummaryCard label="IVA" value={fmt(fiscal.iva)} tone="blue" />
                        <SummaryCard label="Total" value={fmt(fiscal.total)} tone="green" />
                        <SummaryCard label="Retenciones" value={fmt(fiscal.retentionTotal)} tone="amber" />
                    </div>

                    {message && <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-700">{message}</div>}

                    <button type="submit" disabled={saving} className="w-full rounded-2xl bg-[#e30613] px-5 py-4 text-sm font-black uppercase tracking-[0.2em] text-white shadow-lg shadow-red-950/20 transition hover:bg-[#9f111a] disabled:cursor-not-allowed disabled:opacity-60">
                        {saving ? 'Guardando...' : 'Guardar factura membretada'}
                    </button>
                </form>
            </Section>

            {entryMode === 'sicar' ? (
            <div className="space-y-5">
                <Section title="Facturas SICAR para cargar" eyebrow={`Pendientes de hoy ${todaySicarInvoiceDate}`} action={<Badge tone="blue">{sicarInvoices.length} pendientes</Badge>}>
                    <div className="space-y-3">
                        <SearchBox
                            value={sicarInvoiceSearch}
                            onChange={setSicarInvoiceSearch}
                            placeholder="Buscar por fecha, numero de factura, cliente o RUC..."
                            resultLabel={`${filteredSicarInvoices.length} de ${sicarInvoices.length}`}
                        />
                    </div>
                    <div className="mt-3 space-y-2">
                        {sicarInvoices.length === 0 ? (
                            <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-center text-sm font-bold text-slate-400">
                                No hay facturas SICAR pendientes por cargar para hoy.
                            </div>
                        ) : filteredSicarInvoices.length === 0 ? (
                            <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-center text-sm font-bold text-slate-400">
                                No hay facturas SICAR que coincidan con la busqueda.
                            </div>
                        ) : pagedSicarInvoices.records.map((invoice) => (
                            <button key={invoice.id} type="button" onClick={() => loadSicarInvoice(invoice)} className="w-full rounded-2xl border border-slate-200 bg-white p-3 text-left transition hover:border-[#e30613] hover:bg-red-50">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-black text-slate-950">Factura {invoice.invoiceNumber || '-'}</div>
                                        <div className="text-xs font-bold text-slate-500">{invoice.date} · {invoice.customerName || invoice.cliente || 'Sin cliente'} · {(invoice.items || []).length} articulos</div>
                                    </div>
                                    <div className="font-mono text-sm font-black text-slate-900">{fmt(invoice.total)}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                    <div className="mt-3">
                        <PaginationControls
                            page={pagedSicarInvoices.page}
                            totalPages={pagedSicarInvoices.totalPages}
                            total={filteredSicarInvoices.length}
                            start={pagedSicarInvoices.start}
                            end={pagedSicarInvoices.end}
                            onPageChange={setSicarInvoicePage}
                        />
                    </div>
                </Section>
            </div>
            ) : (
            <div className="space-y-5">
                <Section title="Captura manual" eyebrow="Factura sin origen SICAR" action={<Badge tone="amber">Manual</Badge>}>
                    <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center">
                        <div className="text-lg font-black text-slate-950">Escritura manual habilitada</div>
                        <div className="mx-auto mt-2 max-w-md text-sm font-bold text-slate-500">
                            Ingresa cliente, numero de factura y articulos. La app recalcula subtotal, IVA y total desde las lineas.
                        </div>
                    </div>
                </Section>
            </div>
            )}

                <PaymentSplitModal
                    open={paymentSplitOpen}
                    title={`Dividir pago factura ${form.invoiceNumber || ''}`}
                    targetAmount={getInvoicePaymentTargetAmount(fiscal)}
                    initialRows={form.paymentBreakdown}
                    fallbackMethod={form.paymentMethod}
                    onClose={() => setPaymentSplitOpen(false)}
                    onSave={applyPaymentSplit}
                />

                {false && (
                <Section title="Guardadas" eyebrow="Facturas membretadas" action={<Badge tone="green">{savedInvoices.length} registros</Badge>}>
                    <div className="space-y-3">
                        <SearchBox
                            value={savedInvoiceSearch}
                            onChange={setSavedInvoiceSearch}
                            placeholder="Buscar guardadas por fecha, factura, cliente o metodo de pago..."
                            resultLabel={`${filteredSavedInvoices.length} de ${savedInvoices.length}`}
                        />
                    </div>
                    <div className="mt-3 space-y-2">
                        {savedInvoices.length === 0 ? (
                            <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-center text-sm font-bold text-slate-400">
                                Todavia no hay facturas membretadas guardadas.
                            </div>
                        ) : filteredSavedInvoices.length === 0 ? (
                            <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-center text-sm font-bold text-slate-400">
                                No hay facturas guardadas que coincidan con la busqueda.
                            </div>
                        ) : pagedSavedInvoices.records.map((invoice) => (
                            <div key={invoice.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-black text-slate-950">Factura {invoice.invoiceNumber || '-'}</div>
                                        <div className="text-xs font-bold text-slate-500">{invoice.date} · Ret. {fmt(invoice.retentionTotal || 0)} · {(invoice.items || []).length} articulos</div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        <div className="font-mono text-sm font-black text-slate-900">{fmt(invoice.total)}</div>
                                        <select
                                            className="max-w-[190px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-slate-700 outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-red-100"
                                            value={invoice.paymentMethod || ''}
                                            onChange={(event) => updateSavedInvoicePaymentMethod(invoice, event.target.value)}
                                        >
                                            <option value="">Metodo...</option>
                                            {PAYMENT_METHODS.map((method) => (
                                                <option key={method} value={method}>{method}</option>
                                            ))}
                                        </select>
                                        <button
                                            type="button"
                                            onClick={() => setPrintTarget(invoice)}
                                            className="rounded-xl border border-slate-200 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-700 transition hover:border-[#e30613] hover:text-[#e30613]"
                                        >
                                            Imprimir
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-3">
                        <PaginationControls
                            page={pagedSavedInvoices.page}
                            totalPages={pagedSavedInvoices.totalPages}
                            total={filteredSavedInvoices.length}
                            start={pagedSavedInvoices.start}
                            end={pagedSavedInvoices.end}
                            onPageChange={setSavedInvoicePage}
                        />
                    </div>
                </Section>
                )}
        </div>
        {false && <StampedInvoicePrintModal
            invoice={printTarget}
            layout={printLayout}
            templates={printTemplates}
            activeTemplateId={activePrintTemplateId}
            templateName={printTemplateName}
            onSelectTemplate={selectPrintTemplate}
            onTemplateNameChange={setPrintTemplateName}
            onLayoutChange={setPrintLayout}
            onSaveLayout={savePrintLayout}
            onSaveNewLayout={saveNewPrintLayout}
            onClose={() => setPrintTarget(null)}
        />}
        </>
    );
}

const StampedInvoiceDetailModal = ({
    invoice,
    onClose,
    onPrint,
    onEdit,
    onPaymentMethodChange,
    canEdit = true,
    supportUploadFiles = {},
    onSupportFileChange,
    onSupportUpload,
    supportSaving = false,
}) => {
    if (!invoice) return null;
    const isAnnulled = isStampedInvoiceAnnulled(invoice);
    const supportFiles = getSupportFiles(invoice);
    const hasPendingSupportFiles = Object.values(supportUploadFiles || {}).some(Boolean);

    return (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm">
            <div className="w-full max-w-6xl overflow-hidden rounded-[2rem] border border-white/10 bg-white shadow-2xl">
                <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-950 px-5 py-4 text-white sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-red-300">Detalle fiscal</div>
                        <h3 className="text-xl font-black">Factura {invoice.invoiceNumber || invoice.numeroFactura || '-'}</h3>
                        <p className="mt-1 text-sm font-semibold text-slate-300">{invoice.date || invoice.saleDate || '-'} · {invoice.customerName || invoice.cliente || 'Sin cliente'}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {isAnnulled && <Badge tone="red">ANULADA</Badge>}
                        {canEdit && (
                            <>
                                <button type="button" onClick={() => onPrint(invoice)} className="rounded-2xl bg-[#e30613] px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-red-700">
                                    Imprimir
                                </button>
                                <button type="button" onClick={() => onEdit(invoice)} disabled={isAnnulled} className="rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50">
                                    Editar
                                </button>
                            </>
                        )}
                        <button type="button" onClick={onClose} className="rounded-2xl bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-slate-950 transition hover:bg-slate-200">
                            Cerrar
                        </button>
                    </div>
                </div>

                <div className="grid gap-5 p-5 xl:grid-cols-[0.8fr_1.2fr]">
                    <div className="space-y-4">
                        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Cliente</div>
                            <div className="mt-1 text-lg font-black text-slate-950">{invoice.customerName || invoice.cliente || 'Sin cliente'}</div>
                            <div className="mt-2 space-y-1 text-sm font-semibold text-slate-600">
                                <div>RUC/RFC: {invoice.customerRfc || invoice.rfc || '-'}</div>
                                <div>Direccion: {invoice.customerAddress || invoice.address || '-'}</div>
                                <div>Cajero: {invoice.cashierName || 'Sin cajero'}</div>
                            </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <SummaryCard label="Subtotal" value={fmt(invoice.subtotal)} />
                            <SummaryCard label="IVA" value={fmt(invoice.iva)} tone="blue" />
                            <SummaryCard label="Total" value={fmt(invoice.total)} tone="green" />
                            <SummaryCard label="Retenciones" value={fmt(invoice.retentionTotal || safeNumber(invoice.retentionIr2) + safeNumber(invoice.retentionMunicipal1))} tone="amber" />
                        </div>

                        {invoice.creditStatusLabel && (
                            <div className="grid gap-3 sm:grid-cols-3">
                                <SummaryCard label="Estado credito" value={invoice.creditStatusLabel} tone={invoice.creditStatus === 'cancelled' ? 'green' : invoice.creditStatus === 'partial' ? 'blue' : 'amber'} />
                                <SummaryCard label="Abonado" value={fmt(invoice.creditPaidAmount)} tone="blue" />
                                <SummaryCard label="Saldo" value={fmt(invoice.creditBalance)} tone={invoice.creditBalance <= 0.01 ? 'green' : 'amber'} />
                            </div>
                        )}

                        <div className="rounded-3xl border border-slate-200 bg-white p-4">
                        <Field label="Metodo de pago">
                            <PaymentMethodSelect value={invoice.paymentMethod || ''} onChange={(value) => onPaymentMethodChange(invoice, value)} disabled={isAnnulled || !canEdit} />
                            <PaymentBreakdownPreview invoice={invoice} />
                        </Field>
                        </div>

                        <div className="rounded-3xl border border-slate-200 bg-white p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-sm font-black text-slate-950">Soportes</div>
                                    <div className="text-xs font-semibold text-slate-500">Factura y retenciones asociadas. Podes subir o reemplazar soportes desde aqui.</div>
                                </div>
                                <Badge tone={supportFiles.length ? 'green' : 'slate'}>{supportFiles.length}</Badge>
                            </div>

                            {canEdit && (
                            <div className="mb-4 rounded-3xl border border-dashed border-red-200 bg-red-50/40 p-4">
                                <div className="mb-3 text-[10px] font-black uppercase tracking-[0.24em] text-[#9f111a]">Adjuntar soportes</div>
                                <div className="grid gap-3">
                                    <Field label="Foto factura">
                                        <input
                                            className={inputClass}
                                            type="file"
                                            accept="image/*,application/pdf"
                                            onChange={(event) => onSupportFileChange('invoice', event.target.files?.[0] || null)}
                                        />
                                    </Field>
                                    <Field label="Soporte retencion IR 2%">
                                        <input
                                            className={inputClass}
                                            type="file"
                                            accept="image/*,application/pdf"
                                            onChange={(event) => onSupportFileChange('retentionIr2', event.target.files?.[0] || null)}
                                        />
                                    </Field>
                                    <Field label="Soporte retencion municipal 1%">
                                        <input
                                            className={inputClass}
                                            type="file"
                                            accept="image/*,application/pdf"
                                            onChange={(event) => onSupportFileChange('retentionMunicipal1', event.target.files?.[0] || null)}
                                        />
                                    </Field>
                                </div>
                                <button
                                    type="button"
                                    onClick={onSupportUpload}
                                    disabled={supportSaving || !hasPendingSupportFiles}
                                    className="mt-4 w-full rounded-2xl bg-[#e30613] px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-white shadow-lg shadow-red-950/10 transition hover:bg-[#9f111a] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {supportSaving ? 'Subiendo soportes...' : 'Guardar soportes'}
                                </button>
                            </div>
                            )}

                            {supportFiles.length === 0 ? (
                                <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-center text-sm font-bold text-slate-400">
                                    No hay soportes adjuntos.
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {supportFiles.map((support) => (
                                        <div key={`${support.type}-${support.path || support.url}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                            <div className="mb-2 flex items-center justify-between gap-3">
                                                <div>
                                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#e30613]">{support.label}</div>
                                                    {support.fileName && <div className="text-xs font-semibold text-slate-500">{support.fileName}</div>}
                                                </div>
                                                {support.url && (
                                                    <a href={support.url} target="_blank" rel="noreferrer" className="rounded-xl bg-slate-950 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white">
                                                        Abrir
                                                    </a>
                                                )}
                                            </div>
                                            {support.url && (
                                                isPdfSupportFile(support) ? (
                                                    <iframe title={support.label} src={support.url} className="h-72 w-full rounded-xl border border-slate-200 bg-white" />
                                                ) : (
                                                    <img src={support.url} alt={support.label} className="max-h-72 w-full rounded-xl object-contain" />
                                                )
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                                <div className="text-sm font-black text-slate-950">Detalle de articulos</div>
                                <div className="text-xs font-semibold text-slate-500">Cantidad, producto, precio sin IVA y total sin IVA.</div>
                            </div>
                            <Badge tone={invoice.items?.length ? 'green' : 'slate'}>{invoice.items?.length || 0} lineas</Badge>
                        </div>
                        <InvoiceItemsTable items={invoice.items || []} />
                    </div>
                </div>
            </div>
        </div>
    );
};

const StampedInvoiceEditModal = ({
    form,
    splitInvoice,
    saving = false,
    onClose,
    onSave,
    onUpdate,
    onItemChange,
    onAddItem,
    onRemoveItem,
    onSplit,
    onSplitInvoiceNumberChange,
    onOpenPaymentSplit,
}) => {
    if (!form) return null;
    const fiscal = buildFiscalPayload({
        subtotal: safeNumber(form.subtotal),
        iva: safeNumber(form.iva),
        total: safeNumber(form.total) || safeNumber(form.subtotal) + safeNumber(form.iva),
        retentionIr2: safeNumber(form.retentionIr2),
        retentionMunicipal1: safeNumber(form.retentionMunicipal1),
    });
    const canSplit = (form.items || []).length > 10 && !splitInvoice;

    return (
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm">
            <div className="w-full max-w-7xl overflow-hidden rounded-[2rem] border border-white/10 bg-white shadow-2xl">
                <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-950 px-5 py-4 text-white sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-red-300">Edicion fiscal</div>
                        <h3 className="text-xl font-black">Editar factura membretada</h3>
                        <p className="mt-1 text-sm font-semibold text-slate-300">
                            Ajusta numero, cliente, metodo, retenciones y articulos. Si tiene mas de 10 lineas podes dividirla desde aqui.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={onSave} disabled={saving} className="rounded-2xl bg-[#e30613] px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60">
                            {saving ? 'Guardando...' : 'Guardar cambios'}
                        </button>
                        <button type="button" onClick={onClose} className="rounded-2xl bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-slate-950 transition hover:bg-slate-200">
                            Cerrar
                        </button>
                    </div>
                </div>

                <div className="space-y-5 p-5">
                    <div className="grid gap-4 lg:grid-cols-2">
                        <Field label="Fecha">
                            <input className={inputClass} type="date" value={form.date || ''} onChange={(event) => onUpdate('date', event.target.value)} />
                        </Field>
                        <Field label="Numero factura app / membretada">
                            <input className={inputClass} value={form.invoiceNumber || ''} onChange={(event) => onUpdate('invoiceNumber', event.target.value)} />
                        </Field>
                        <Field label="Cajero">
                            <select className={inputClass} value={form.cashierName || ''} onChange={(event) => onUpdate('cashierName', event.target.value)} required>
                                <option value="">Seleccionar cajero...</option>
                                {CASHIER_OPTIONS.map((cashier) => (
                                    <option key={cashier} value={cashier}>{cashier}</option>
                                ))}
                            </select>
                        </Field>
                        <Field label="Cliente">
                            <input className={inputClass} value={form.customerName || ''} onChange={(event) => onUpdate('customerName', event.target.value)} />
                        </Field>
                        <Field label="Metodo de pago">
                            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                                <PaymentMethodSelect value={form.paymentMethod || ''} onChange={(value) => onUpdate('paymentMethod', value)} />
                                <button
                                    type="button"
                                    onClick={onOpenPaymentSplit}
                                    className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-sky-700 transition hover:bg-sky-100"
                                >
                                    Dividir pago
                                </button>
                            </div>
                            <PaymentBreakdownPreview invoice={form} />
                        </Field>
                        <Field label="Direccion cliente">
                            <input className={inputClass} value={form.customerAddress || ''} onChange={(event) => onUpdate('customerAddress', event.target.value)} />
                        </Field>
                        <Field label="R.F.C / RUC">
                            <input className={inputClass} value={form.customerRfc || ''} onChange={(event) => onUpdate('customerRfc', event.target.value)} />
                        </Field>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-5">
                        <Field label="Subtotal">
                            <input className={inputClass} type="number" step="0.01" min="0" value={form.subtotal || ''} onChange={(event) => onUpdate('subtotal', event.target.value)} />
                        </Field>
                        <Field label="IVA">
                            <input className={inputClass} type="number" step="0.01" min="0" value={form.iva || ''} onChange={(event) => onUpdate('iva', event.target.value)} />
                        </Field>
                        <Field label="Total">
                            <input className={inputClass} type="number" step="0.01" min="0" value={form.total || ''} onChange={(event) => onUpdate('total', event.target.value)} />
                        </Field>
                        <Field label="Retencion IR 2%">
                            <input className={inputClass} type="number" step="0.01" min="0" value={form.retentionIr2 || ''} onChange={(event) => onUpdate('retentionIr2', event.target.value)} />
                        </Field>
                        <Field label="Retencion municipal 1%">
                            <input className={inputClass} type="number" step="0.01" min="0" value={form.retentionMunicipal1 || ''} onChange={(event) => onUpdate('retentionMunicipal1', event.target.value)} />
                        </Field>
                    </div>

                    <div className="grid gap-3 md:grid-cols-4">
                        <SummaryCard label="Subtotal" value={fmt(fiscal.subtotal)} />
                        <SummaryCard label="IVA" value={fmt(fiscal.iva)} tone="blue" />
                        <SummaryCard label="Total" value={fmt(fiscal.total)} tone="green" />
                        <SummaryCard label="Retenciones" value={fmt(fiscal.retentionTotal)} tone="amber" />
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                        <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div>
                                <div className="text-sm font-black text-slate-950">Articulos de factura</div>
                                <div className="text-xs font-semibold text-slate-500">Edita cantidades, productos, IVA y totales. Se recalculan los importes principales.</div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Badge tone={(form.items || []).length ? 'green' : 'slate'}>{(form.items || []).length} lineas</Badge>
                                {canSplit && (
                                    <button
                                        type="button"
                                        onClick={onSplit}
                                        className="rounded-2xl bg-amber-500 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white shadow-lg shadow-amber-900/10 transition hover:bg-amber-600"
                                    >
                                        Dividir factura
                                    </button>
                                )}
                            </div>
                        </div>
                        {canSplit && (
                            <div className="mb-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
                                Esta factura tiene {(form.items || []).length} articulos. Al dividir, 10 quedan en esta factura y el resto pasa a una segunda factura con otro numero.
                            </div>
                        )}
                        <ManualInvoiceItemsEditor
                            items={form.items || []}
                            onAdd={onAddItem}
                            onChange={onItemChange}
                            onRemove={onRemoveItem}
                        />
                    </div>

                    {splitInvoice && (
                        <div className="rounded-3xl border border-amber-300 bg-amber-50 p-4">
                            <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                <div>
                                    <div className="text-sm font-black text-amber-950">Segunda factura creada por division</div>
                                    <div className="text-xs font-semibold text-amber-800">{splitInvoice.items?.length || 0} articulos se guardaran como factura separada.</div>
                                </div>
                                <Field label="Numero factura 2">
                                    <input className={inputClass} value={splitInvoice.invoiceNumber || ''} onChange={(event) => onSplitInvoiceNumberChange(event.target.value)} />
                                </Field>
                            </div>
                            <InvoiceItemsTable items={splitInvoice.items || []} />
                            <div className="mt-3 grid gap-3 md:grid-cols-3">
                                <SummaryCard label="Subtotal factura 2" value={fmt(splitInvoice.subtotal)} />
                                <SummaryCard label="IVA factura 2" value={fmt(splitInvoice.iva)} tone="blue" />
                                <SummaryCard label="Total factura 2" value={fmt(splitInvoice.total)} tone="green" />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

function StampedInvoiceHistory({ data, canEdit = true, branchContext }) {
    const selectedBranchId = getActiveBillingBranchId(branchContext);
    const allowedBranchIds = useMemo(
        () => (branchContext?.allowedBranchIds?.length ? branchContext.allowedBranchIds : [selectedBranchId]),
        [branchContext?.allowedBranchIds, selectedBranchId]
    );
    const [branchFilter, setBranchFilter] = useState(selectedBranchId);
    const isCombinedBranchFilter = branchFilter === CONSOLIDATED_BRANCH_ID;
    const effectiveEditBranchId = isCombinedBranchFilter ? selectedBranchId : branchFilter;
    const invoiceBranchPayload = useMemo(() => getBranchPayload(effectiveEditBranchId, 'invoice'), [effectiveEditBranchId]);
    const canEditCurrentScope = canEdit && !isCombinedBranchFilter;
    const [search, setSearch] = useState('');
    const [selectedMonth, setSelectedMonth] = useState(getMonth(todayString()));
    const [selectedDate, setSelectedDate] = useState('');
    const [paymentMethodFilter, setPaymentMethodFilter] = useState('');
    const [page, setPage] = useState(1);
    const [message, setMessage] = useState('');
    const [detailTarget, setDetailTarget] = useState(null);
    const [editTarget, setEditTarget] = useState(null);
    const [editForm, setEditForm] = useState(null);
    const [splitEditInvoice, setSplitEditInvoice] = useState(null);
    const [editPaymentSplitOpen, setEditPaymentSplitOpen] = useState(false);
    const [editSaving, setEditSaving] = useState(false);
    const [printTarget, setPrintTarget] = useState(null);
    const [supportUploadFiles, setSupportUploadFiles] = useState({});
    const [supportSaving, setSupportSaving] = useState(false);
    const {
        printLayout,
        printTemplates,
        activePrintTemplateId,
        printTemplateName,
        setPrintLayout,
        setPrintTemplateName,
        selectPrintTemplate,
        savePrintLayout,
        saveNewPrintLayout,
    } = useStampedPrintTemplates(setMessage);

    const branchFilterOptions = useMemo(() => {
        const allowed = new Set(allowedBranchIds);
        const branches = BRANCHES.filter((branch) => allowed.has(branch.id));
        return branches.length > 1
            ? [{ id: CONSOLIDATED_BRANCH_ID, shortName: 'Ambas sucursales', invoiceSeries: 'A+B' }, ...branches]
            : branches;
    }, [allowedBranchIds]);

    useEffect(() => {
        if (branchFilter !== CONSOLIDATED_BRANCH_ID && !allowedBranchIds.includes(branchFilter)) {
            setBranchFilter(selectedBranchId || allowedBranchIds[0] || DEFAULT_BRANCH_ID);
        }
    }, [allowedBranchIds, branchFilter, selectedBranchId]);

    const savedInvoices = useMemo(() => (
        [...(data.facturas_membretadas_ventas || [])]
            .map(normalizeStampedInvoiceRecord)
            .filter((invoice) => {
                const invoiceBranchId = getRecordBranchId(invoice);
                return isCombinedBranchFilter
                    ? allowedBranchIds.includes(invoiceBranchId)
                    : invoiceBranchId === branchFilter;
            })
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    ), [allowedBranchIds, branchFilter, data.facturas_membretadas_ventas, isCombinedBranchFilter]);

    const closureIndex = useMemo(() => {
        const map = new Map();
        (data.cierres_caja || []).forEach((closure) => {
            if (closure.id) map.set(closure.id, closure);
        });
        return map;
    }, [data.cierres_caja]);

    const searchedInvoices = useMemo(() => filterRecords(savedInvoices, search, [
        'date',
        'saleDate',
        'invoiceNumber',
        'numeroFactura',
        'customerName',
        'cliente',
        'customerRfc',
        'rfc',
        'paymentMethod',
        'total',
    ]), [savedInvoices, search]);

    const filteredInvoices = useMemo(() => (
        searchedInvoices.filter((invoice) => {
            const matchesDate = matchesHistoryDateFilters(invoice.date || invoice.saleDate || '', selectedMonth, selectedDate);
            const paymentRows = normalizePaymentBreakdownRows(invoice.paymentBreakdown);
            const matchesPayment = !paymentMethodFilter
                || normalizeText(invoice.paymentMethod) === normalizeText(paymentMethodFilter)
                || paymentRows.some((row) => normalizeText(row.method) === normalizeText(paymentMethodFilter));
            return matchesDate && matchesPayment;
        })
    ), [searchedInvoices, selectedMonth, selectedDate, paymentMethodFilter]);

    const pagedInvoices = useMemo(() => (
        paginateRecords(filteredInvoices, page)
    ), [filteredInvoices, page]);

    const stats = useMemo(() => (
        filteredInvoices.reduce((acc, invoice) => {
            acc.subtotal = safeNumber(acc.subtotal + safeNumber(invoice.subtotal));
            acc.iva = safeNumber(acc.iva + safeNumber(invoice.iva));
            acc.total = safeNumber(acc.total + safeNumber(invoice.total));
            acc.retentionTotal = safeNumber(acc.retentionTotal + safeNumber(invoice.retentionTotal || safeNumber(invoice.retentionIr2) + safeNumber(invoice.retentionMunicipal1)));
            acc.items += (invoice.items || []).length;
            return acc;
        }, { subtotal: 0, iva: 0, total: 0, retentionTotal: 0, items: 0 })
    ), [filteredInvoices]);

    useEffect(() => {
        setPage(1);
    }, [search, selectedMonth, selectedDate, paymentMethodFilter, branchFilter]);

    useEffect(() => {
        if (page !== pagedInvoices.page) setPage(pagedInvoices.page);
    }, [page, pagedInvoices.page]);

    const updatePaymentMethod = async (invoice, paymentMethod) => {
        if (!canEditCurrentScope) {
            setMessage(isCombinedBranchFilter ? 'Para editar, selecciona una sucursal especifica. La vista Ambas es solo consulta consolidada.' : 'Este usuario solo tiene permiso para ver facturas membretadas.');
            return;
        }
        const invoiceId = invoice.id || invoice.docId;
        if (!invoiceId) return;
        if (isStampedInvoiceAnnulled(invoice)) {
            setMessage(`La factura ${invoice.invoiceNumber || invoice.numeroFactura || invoiceId} esta ANULADA y no se puede editar.`);
            return;
        }
        try {
            assertInvoiceCreditMethodChangeAllowed(invoice, paymentMethod);
            const creditSnapshot = buildCreditInvoiceSnapshot(
                { ...invoice, paymentMethod },
                isCreditPaymentMethod(paymentMethod)
                    ? {
                        creditOriginalAmount: getInvoicePaymentTargetAmount({ ...invoice, paymentMethod }),
                        creditPaidAmount: getInvoiceCreditPaidAmount(invoice),
                        creditReceiptIds: getInvoiceCreditReceiptIds(invoice),
                    }
                    : {}
            );
            await setDoc(doc(db, 'facturas_membretadas_ventas', invoiceId), {
                paymentMethod,
                paymentBreakdown: [],
                paymentNetTotal: 0,
                ...creditSnapshot,
                updatedAt: serverTimestamp(),
            }, { merge: true });
            setDetailTarget((current) => (
                current && (current.id || current.docId) === invoiceId
                    ? { ...current, paymentMethod, paymentBreakdown: [], paymentNetTotal: 0, ...creditSnapshot }
                    : current
            ));
            setMessage(`Metodo de pago actualizado para factura ${invoice.invoiceNumber || invoice.numeroFactura || invoiceId}.`);
        } catch (error) {
            console.error(error);
            setMessage(error?.message || 'No se pudo actualizar el metodo de pago.');
        }
    };

    const markInvoiceWithoutClosure = async (invoice) => {
        if (!canEditCurrentScope) {
            setMessage(isCombinedBranchFilter ? 'Para editar, selecciona una sucursal especifica. La vista Ambas es solo consulta consolidada.' : 'Este usuario solo tiene permiso para ver facturas membretadas.');
            return;
        }
        const invoiceId = invoice.id || invoice.docId;
        if (!invoiceId) return;
        if (isStampedInvoiceAnnulled(invoice)) {
            setMessage(`La factura ${invoice.invoiceNumber || invoice.numeroFactura || invoiceId} esta ANULADA y no se puede editar.`);
            return;
        }
        if (!window.confirm(`Estas seguro que deseas dejar la factura ${invoice.invoiceNumber || invoice.numeroFactura || invoiceId} sin cierre de caja vinculado?`)) return;
        try {
            await setDoc(doc(db, 'facturas_membretadas_ventas', invoiceId), {
                linkedCashClosureId: '',
                linkedSicarClosureId: '',
                linkedSicarCorId: null,
                cashClosureLinkStatus: 'sin_cierre',
                closureStatus: 'sin_cierre',
                excludeFromCashClosure: true,
                updatedAt: serverTimestamp(),
            }, { merge: true });
            setDetailTarget((current) => (
                current && (current.id || current.docId) === invoiceId
                    ? {
                        ...current,
                        linkedCashClosureId: '',
                        linkedSicarClosureId: '',
                        linkedSicarCorId: null,
                        cashClosureLinkStatus: 'sin_cierre',
                        closureStatus: 'sin_cierre',
                        excludeFromCashClosure: true,
                    }
                    : current
            ));
            setMessage(`Factura ${invoice.invoiceNumber || invoice.numeroFactura || invoiceId} marcada sin cierre de caja vinculado.`);
        } catch (error) {
            console.error(error);
            setMessage(error?.message || 'No se pudo actualizar el vinculo de cierre.');
        }
    };

    const annulInvoice = async (invoice) => {
        if (!canEditCurrentScope) {
            setMessage(isCombinedBranchFilter ? 'Para editar, selecciona una sucursal especifica. La vista Ambas es solo consulta consolidada.' : 'Este usuario solo tiene permiso para ver facturas membretadas.');
            return;
        }
        const invoiceId = invoice.id || invoice.docId;
        if (!invoiceId) return;
        if (!window.confirm(`Estas seguro que deseas ANULAR la factura ${invoice.invoiceNumber || invoice.numeroFactura || invoiceId}? La factura quedara en cero y marcada en rojo.`)) return;
        try {
            assertStampedInvoiceAnnulmentAllowed(invoice);
            const annulledLocalSnapshot = normalizeStampedInvoiceRecord({
                ...buildAnnulledStampedInvoiceSnapshot(invoice),
                id: invoiceId,
                docId: invoiceId,
            });
            await setDoc(doc(db, 'facturas_membretadas_ventas', invoiceId), buildAnnulledStampedInvoiceSnapshot(invoice, { includeServerFields: true }), { merge: true });
            await syncLinkedClosureForStampedInvoice(invoiceId, annulledLocalSnapshot);
            setDetailTarget((current) => (
                current && (current.id || current.docId) === invoiceId
                    ? annulledLocalSnapshot
                    : current
            ));
            setMessage(`Factura ${invoice.invoiceNumber || invoice.numeroFactura || invoiceId} anulada correctamente.`);
        } catch (error) {
            console.error(error);
            setMessage(error?.message || 'No se pudo anular la factura.');
        }
    };

    const openInvoiceDetail = (invoice) => {
        setDetailTarget(invoice);
        setSupportUploadFiles({});
    };

    const openInvoiceEdit = (invoice) => {
        if (!canEditCurrentScope) {
            setMessage(isCombinedBranchFilter ? 'Para editar, selecciona una sucursal especifica. La vista Ambas es solo consulta consolidada.' : 'Este usuario solo tiene permiso para ver facturas membretadas.');
            return;
        }
        if (isStampedInvoiceAnnulled(invoice)) {
            setMessage(`La factura ${invoice.invoiceNumber || invoice.numeroFactura || invoice.id || invoice.docId || ''} esta ANULADA y no se puede editar.`);
            return;
        }
        setDetailTarget(null);
        setEditTarget(invoice);
        setEditForm(createStampedInvoiceEditForm(invoice));
        setSplitEditInvoice(null);
    };

    const closeInvoiceEdit = () => {
        setEditTarget(null);
        setEditForm(null);
        setSplitEditInvoice(null);
        setEditPaymentSplitOpen(false);
    };

    const updateEditField = (key, value) => {
        if (key === 'cashierName') {
            setSplitEditInvoice((prev) => prev ? { ...prev, cashierName: value, cashierCode: getCashierCode(value) } : prev);
        }
        setEditForm((prev) => {
            if (!prev) return prev;
            const next = { ...prev, [key]: value };
            if (key === 'subtotal' || key === 'iva') {
                next.total = String(safeNumber(next.subtotal) + safeNumber(next.iva));
            }
            if (key === 'paymentMethod') {
                next.paymentBreakdown = [];
                next.paymentNetTotal = 0;
            }
            return next;
        });
    };

    const applyEditPaymentSplit = (rows) => {
        const normalizedRows = normalizePaymentBreakdownRows(rows);
        setEditForm((prev) => prev ? {
            ...prev,
            paymentBreakdown: normalizedRows,
            paymentNetTotal: getPaymentBreakdownTotal(normalizedRows),
            paymentMethod: getPaymentMethodFromBreakdown(normalizedRows, prev.paymentMethod),
        } : prev);
        setEditPaymentSplitOpen(false);
        setMessage('Pago dividido aplicado a la factura en edicion.');
    };

    const applyEditItemTotals = (items = []) => {
        const totals = calculateInvoiceItemsFiscal(items);
        return {
            items,
            subtotal: String(totals.subtotal),
            iva: String(totals.iva),
            total: String(totals.total),
        };
    };

    const updateEditItem = (index, key, value) => {
        setSplitEditInvoice(null);
        setEditForm((prev) => {
            if (!prev) return prev;
            const items = [...(prev.items || [])];
            const current = { ...(items[index] || createManualInvoiceItem()), [key]: value };
            if (['quantity', 'unitPriceWithoutTax'].includes(key)) {
                current.totalWithoutTax = String(safeNumber(safeNumber(current.quantity) * safeNumber(current.unitPriceWithoutTax)));
            }
            if (['quantity', 'unitPriceWithoutTax', 'totalWithoutTax', 'taxAmount'].includes(key)) {
                current.totalWithTax = String(safeNumber(getInvoiceItemSubtotal(current) + getInvoiceItemTax(current)));
            }
            items[index] = current;
            return { ...prev, ...applyEditItemTotals(items) };
        });
    };

    const addEditItem = () => {
        setSplitEditInvoice(null);
        setEditForm((prev) => {
            if (!prev) return prev;
            const items = [...(prev.items || []), createManualInvoiceItem()];
            return { ...prev, ...applyEditItemTotals(items) };
        });
    };

    const removeEditItem = (index) => {
        setSplitEditInvoice(null);
        setEditForm((prev) => {
            if (!prev) return prev;
            const items = (prev.items || []).filter((_, itemIndex) => itemIndex !== index);
            return { ...prev, ...applyEditItemTotals(items) };
        });
    };

    const splitEditedInvoice = () => {
        if (!editForm) return;
        const items = editForm.items || [];
        if (items.length <= 10) {
            setMessage('La factura solo se divide cuando tiene mas de 10 articulos.');
            return;
        }
        if (!String(editForm.invoiceNumber || '').trim()) {
            setMessage('Ingresa primero el numero de factura principal.');
            return;
        }
        const secondInvoiceNumber = window.prompt('Numero de factura para la segunda factura membretada:');
        if (!String(secondInvoiceNumber || '').trim()) return;
        if (normalizeInvoiceMatchKey(secondInvoiceNumber) === normalizeInvoiceMatchKey(editForm.invoiceNumber)) {
            setMessage('El numero de la segunda factura debe ser diferente.');
            return;
        }
        const duplicateAppInvoice = findStampedInvoiceNumberDuplicate(
            savedInvoices,
            secondInvoiceNumber,
            getInvoiceRecordIdentityKeys(editForm),
            { ...invoiceBranchPayload, ...editForm }
        );
        if (duplicateAppInvoice) {
            setMessage(buildDuplicateInvoiceNumberMessage(secondInvoiceNumber, duplicateAppInvoice));
            return;
        }

        const firstItems = items.slice(0, 10);
        const secondItems = items.slice(10);
        const firstTotals = calculateInvoiceItemsFiscal(firstItems);
        const secondTotals = calculateInvoiceItemsFiscal(secondItems);
        setEditForm((prev) => ({
            ...prev,
            items: firstItems,
            subtotal: String(firstTotals.subtotal),
            iva: String(firstTotals.iva),
            total: String(firstTotals.total),
            paymentBreakdown: [],
            paymentNetTotal: 0,
            paymentMethod: '',
            splitPart: 1,
            splitTotalParts: 2,
        }));
        setSplitEditInvoice({
            ...editForm,
            id: '',
            docId: '',
            invoiceNumber: String(secondInvoiceNumber).trim(),
            items: secondItems,
            subtotal: String(secondTotals.subtotal),
            iva: String(secondTotals.iva),
            total: String(secondTotals.total),
            retentionIr2: '',
            retentionMunicipal1: '',
            paymentMethod: '',
            paymentBreakdown: [],
            paymentNetTotal: 0,
            creditOriginalAmount: 0,
            creditPaidAmount: 0,
            creditBalance: 0,
            creditReceiptIds: [],
            creditStatus: '',
            creditStatusLabel: '',
            splitPart: 2,
            splitTotalParts: 2,
        });
        setMessage(`Factura preparada para dividir: 10 articulos quedan en ${editForm.invoiceNumber}; ${secondItems.length} pasan a ${String(secondInvoiceNumber).trim()}.`);
    };

    const updateSplitEditInvoiceNumber = (value) => {
        setSplitEditInvoice((prev) => prev ? { ...prev, invoiceNumber: value } : prev);
    };

    const saveEditedInvoice = async () => {
        if (!editForm) return;
        const originalDocId = editForm.id || editForm.docId || editTarget?.id || editTarget?.docId;
        if (!originalDocId) {
            setMessage('No se pudo identificar la factura para editar.');
            return;
        }

        setEditSaving(true);
        try {
            const invoicesToSave = [editForm, splitEditInvoice].filter(Boolean).map((invoice, index, list) => ({
                ...invoiceBranchPayload,
                ...invoice,
                splitPart: list.length > 1 ? index + 1 : invoice.splitPart || null,
                splitTotalParts: list.length > 1 ? list.length : invoice.splitTotalParts || null,
                items: normalizeInvoiceItemsForSave(invoice.items || []),
            }));

            invoicesToSave.forEach((invoice) => {
                if (!String(invoice.invoiceNumber || '').trim()) throw new Error('Ingresa el numero de factura.');
                if (!String(invoice.cashierName || '').trim()) throw new Error(`Selecciona cajero para la factura ${invoice.invoiceNumber || ''}.`);
                if (!safeNumber(invoice.subtotal) && !safeNumber(invoice.total)) throw new Error(`Ingresa subtotal o total para la factura ${invoice.invoiceNumber}.`);
                validatePaymentBreakdownForInvoice(invoice);
            });

            const invoiceNumberKeys = invoicesToSave.map((invoice) => getFiscalDocumentMatchKey(invoice, 'invoice')).filter(Boolean);
            if (new Set(invoiceNumberKeys).size !== invoiceNumberKeys.length) {
                throw new Error('Este numero de factura ya existe en la division. Las facturas divididas deben tener numeros diferentes.');
            }

            const invoiceMeta = invoicesToSave.map((invoice, index) => ({
                invoice,
                docId: index === 0 ? originalDocId : buildBranchScopedFiscalDocId('membretada', invoiceBranchPayload, invoice.invoiceNumber, invoice.date || todayString()),
            }));
            const docIdsBeingSaved = new Set(invoiceMeta.map(({ docId }) => normalizeInvoiceMatchKey(docId)));

            for (const { docId } of invoiceMeta) {
                if (!docId) throw new Error('No se pudo generar el identificador de la factura.');
            }

            assertUniqueStampedInvoiceNumbers(
                invoiceMeta.map(({ invoice }, index) => (
                    index === 0 ? { ...invoice, id: originalDocId, docId: originalDocId } : invoice
                )),
                savedInvoices
            );

            const splitGroupId = invoiceMeta.length > 1 ? originalDocId : editForm.splitGroupId || '';
            const batch = writeBatch(db);

            invoiceMeta.forEach(({ invoice, docId }) => {
                const existingSavedInvoice = savedInvoices.find((item) => getInvoiceDocId(item) === docId) || {};
                const cashierName = String(invoice.cashierName || '').trim();
                const cashierCode = getCashierCode(cashierName);
                const paymentBreakdown = validatePaymentBreakdownForInvoice(invoice);
                const paymentMethod = getPaymentMethodFromBreakdown(paymentBreakdown, invoice.paymentMethod);
                assertInvoiceCreditMethodChangeAllowed(existingSavedInvoice, paymentMethod);
                const itemFiscal = calculateInvoiceItemsFiscal(invoice.items || []);
                const invoiceFiscal = buildFiscalPayload({
                    subtotal: itemFiscal.subtotal || safeNumber(invoice.subtotal),
                    iva: itemFiscal.iva || safeNumber(invoice.iva),
                    total: itemFiscal.total || safeNumber(invoice.total) || safeNumber(invoice.subtotal) + safeNumber(invoice.iva),
                    retentionIr2: safeNumber(invoice.retentionIr2),
                    retentionMunicipal1: safeNumber(invoice.retentionMunicipal1),
                });
                const creditSnapshot = buildCreditInvoiceSnapshot(
                    { ...existingSavedInvoice, ...invoice, paymentMethod, ...invoiceFiscal },
                    isCreditPaymentMethod(paymentMethod)
                        ? {
                            creditOriginalAmount: getInvoicePaymentTargetAmount({ ...invoice, paymentMethod, ...invoiceFiscal }),
                            creditPaidAmount: getInvoiceCreditPaidAmount(existingSavedInvoice),
                            creditReceiptIds: getInvoiceCreditReceiptIds(existingSavedInvoice),
                        }
                        : {}
                );
                batch.set(doc(db, 'facturas_membretadas_ventas', docId), {
                    ...buildInvoiceDocumentFields(invoice, invoiceBranchPayload),
                    date: invoice.date || todayString(),
                    saleDate: invoice.date || todayString(),
                    month: getMonth(invoice.date || todayString()),
                    numeroFactura: String(invoice.invoiceNumber || '').trim(),
                    invoiceNumber: String(invoice.invoiceNumber || '').trim(),
                    customerName: String(invoice.customerName || '').trim(),
                    customerAddress: String(invoice.customerAddress || '').trim(),
                    customerRfc: String(invoice.customerRfc || '').trim(),
                    cashierName,
                    cashierCode,
                    paymentMethod: String(paymentMethod || '').trim(),
                    paymentBreakdown,
                    paymentNetTotal: paymentBreakdown.length ? getPaymentBreakdownTotal(paymentBreakdown) : getInvoicePaymentTargetAmount({ ...invoice, ...invoiceFiscal }),
                    items: invoice.items || [],
                    ...invoiceFiscal,
                    source: invoice.source || (invoice.sourceSicarInvoiceId ? 'sicar_factura' : 'manual'),
                    sourceType: 'stamped_sale_invoice',
                    sourceSicarInvoiceId: invoice.sourceSicarInvoiceId || '',
                    sourceSicarInvoiceNumber: invoice.sourceSicarInvoiceNumber || '',
                    linkedCashClosureId: invoice.linkedCashClosureId || '',
                    linkedSicarClosureId: invoice.linkedSicarClosureId || '',
                    linkedSicarCorId: invoice.linkedSicarCorId || null,
                    cashClosureLinkStatus: invoice.cashClosureLinkStatus || '',
                    closureStatus: invoice.closureStatus || '',
                    excludeFromCashClosure: Boolean(invoice.excludeFromCashClosure),
                    ...creditSnapshot,
                    splitGroupId,
                    splitPart: invoice.splitPart || null,
                    splitTotalParts: invoice.splitTotalParts || null,
                    status: 'active',
                    updatedAt: serverTimestamp(),
                    ...(docId === originalDocId ? {} : { createdAt: serverTimestamp() }),
                }, { merge: true });
            });

            const editedSicarAccountingGroups = new Map();
            invoiceMeta.forEach(({ invoice, docId }) => {
                const sourceId = String(invoice.sourceSicarInvoiceId || '').trim();
                if (!sourceId) return;
                const current = editedSicarAccountingGroups.get(sourceId) || {
                    docIds: [],
                    invoiceNumbers: [],
                    sourceSicarInvoiceNumber: invoice.sourceSicarInvoiceNumber || '',
                };
                current.docIds.push(docId);
                current.invoiceNumbers.push(String(invoice.invoiceNumber || '').trim());
                current.sourceSicarInvoiceNumber = current.sourceSicarInvoiceNumber || invoice.sourceSicarInvoiceNumber || '';
                editedSicarAccountingGroups.set(sourceId, current);
            });

            editedSicarAccountingGroups.forEach((accountingGroup, sourceId) => {
                batch.set(doc(db, 'sicar_facturas_membretadas', sourceId), {
                    accountingStatus: 'contabilizada',
                    accountingInvoiceId: accountingGroup.docIds[0] || '',
                    accountingInvoiceIds: accountingGroup.docIds,
                    accountingInvoiceNumber: accountingGroup.invoiceNumbers[0] || '',
                    accountingInvoiceNumbers: accountingGroup.invoiceNumbers,
                    accountingSourceSicarInvoiceId: sourceId,
                    sourceSicarInvoiceNumber: accountingGroup.sourceSicarInvoiceNumber || '',
                    accountingLoadedAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                }, { merge: true });
            });

            if (editForm.linkedCashClosureId && closureIndex.has(editForm.linkedCashClosureId)) {
                const closure = closureIndex.get(editForm.linkedCashClosureId) || {};
                const editedDocIds = invoiceMeta.map(({ docId }) => docId);
                const editedDocKeySet = new Set(editedDocIds.map((id) => normalizeInvoiceMatchKey(id)));
                const previousIds = Array.isArray(closure.stampedInvoiceIds) ? closure.stampedInvoiceIds : [];
                const nextIds = [...new Set([...previousIds, ...editedDocIds].filter(Boolean))];
                const previousInvoices = Array.isArray(closure.stampedInvoices) ? closure.stampedInvoices : [];
                const nextSummaries = invoiceMeta.map(({ invoice, docId }) => {
                    const itemFiscal = calculateInvoiceItemsFiscal(invoice.items || []);
                    const invoiceFiscal = buildFiscalPayload({
                        subtotal: itemFiscal.subtotal || safeNumber(invoice.subtotal),
                        iva: itemFiscal.iva || safeNumber(invoice.iva),
                        total: itemFiscal.total || safeNumber(invoice.total) || safeNumber(invoice.subtotal) + safeNumber(invoice.iva),
                        retentionIr2: safeNumber(invoice.retentionIr2),
                        retentionMunicipal1: safeNumber(invoice.retentionMunicipal1),
                    });
                    return {
                        id: docId,
                        invoiceNumber: String(invoice.invoiceNumber || '').trim(),
                        date: invoice.saleDate || invoice.date,
                        cashierName: String(invoice.cashierName || '').trim(),
                        cashierCode: getCashierCode(invoice.cashierName || ''),
                        subtotal: safeNumber(invoiceFiscal.subtotal),
                        iva: safeNumber(invoiceFiscal.iva),
                        total: safeNumber(invoiceFiscal.total),
                        retentionTotal: safeNumber(invoiceFiscal.retentionTotal),
                    };
                });
                batch.set(doc(db, 'cierres_caja', editForm.linkedCashClosureId), sanitizeFirestoreData({
                    stampedInvoiceIds: nextIds,
                    stampedInvoices: [
                        ...previousInvoices.filter((invoice) => !editedDocKeySet.has(normalizeInvoiceMatchKey(invoice.id || invoice.docId))),
                        ...nextSummaries,
                    ],
                    updatedAt: serverTimestamp(),
                }), { merge: true });
            }

            await batch.commit();
            setMessage(invoiceMeta.length > 1 ? 'Factura actualizada y dividida correctamente desde historial.' : 'Factura actualizada correctamente desde historial.');
            closeInvoiceEdit();
        } catch (error) {
            console.error(error);
            setMessage(error?.message || 'No se pudo guardar la edicion de la factura.');
        } finally {
            setEditSaving(false);
        }
    };

    const updateSupportUploadFile = (type, file) => {
        setSupportUploadFiles((current) => ({ ...current, [type]: file }));
    };

    const uploadDetailSupports = async () => {
        if (!canEdit) {
            setMessage('Este usuario solo tiene permiso para ver facturas membretadas.');
            return;
        }
        if (!detailTarget) return;
        const invoiceId = detailTarget.id || detailTarget.docId;
        if (!invoiceId) {
            setMessage('No se pudo identificar la factura para guardar soportes.');
            return;
        }
        if (!Object.values(supportUploadFiles).some(Boolean)) {
            setMessage('Selecciona al menos una foto o PDF para guardar.');
            return;
        }

        setSupportSaving(true);
        try {
            const supportPayload = await uploadFiscalSupportFiles(
                supportUploadFiles,
                'facturacion/facturas_membretadas',
                invoiceId,
                detailTarget
            );

            await setDoc(doc(db, 'facturas_membretadas_ventas', invoiceId), {
                ...supportPayload,
                updatedAt: serverTimestamp(),
            }, { merge: true });

            setDetailTarget((current) => (
                current && (current.id || current.docId) === invoiceId
                    ? { ...current, ...supportPayload }
                    : current
            ));
            setSupportUploadFiles({});
            setMessage(`Soportes actualizados para factura ${detailTarget.invoiceNumber || detailTarget.numeroFactura || invoiceId}.`);
        } catch (error) {
            console.error(error);
            setMessage(error?.message || 'No se pudieron subir los soportes.');
        } finally {
            setSupportSaving(false);
        }
    };

    return (
        <>
            <div className="space-y-5">
                <Section
                    title="Historial Fact. Membretadas"
                    eyebrow="Facturas ya registradas"
                    action={<Badge tone="green">{filteredInvoices.length} de {savedInvoices.length}</Badge>}
                >
                    <div className="grid gap-3 lg:grid-cols-[1.3fr_0.55fr_0.5fr_0.5fr_0.75fr_auto]">
                        <SearchBox
                            value={search}
                            onChange={setSearch}
                            placeholder="Buscar por factura, cliente, RUC, fecha o metodo..."
                            resultLabel={`${searchedInvoices.length} encontrados`}
                        />
                        <Field label="Sucursal">
                            <select className={inputClass} value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
                                {branchFilterOptions.map((branch) => (
                                    <option key={branch.id} value={branch.id}>
                                        {branch.id === CONSOLIDATED_BRANCH_ID ? branch.shortName : `${branch.shortName} · Serie ${branch.invoiceSeries}`}
                                    </option>
                                ))}
                            </select>
                        </Field>
                        <Field label="Mes">
                            <input className={inputClass} type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} />
                        </Field>
                        <Field label="Dia especifico">
                            <input className={inputClass} type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
                        </Field>
                        <Field label="Metodo de pago">
                            <select className={inputClass} value={paymentMethodFilter} onChange={(event) => setPaymentMethodFilter(event.target.value)}>
                                <option value="">Todos</option>
                                {PAYMENT_METHODS.map((method) => (
                                    <option key={method} value={method}>{method}</option>
                                ))}
                            </select>
                        </Field>
                        <div className="flex items-end">
                            <button
                                type="button"
                                onClick={() => {
                                    setSearch('');
                                    setSelectedMonth('');
                                    setSelectedDate('');
                                    setPaymentMethodFilter('');
                                    setBranchFilter(selectedBranchId);
                                }}
                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-slate-600 transition hover:border-[#e30613] hover:text-[#e30613]"
                            >
                                Limpiar
                            </button>
                        </div>
                    </div>

                    <div className="mt-5 grid gap-3 md:grid-cols-5">
                        <SummaryCard label="Facturas" value={filteredInvoices.length} />
                        <SummaryCard label="Subtotal" value={fmt(stats.subtotal)} />
                        <SummaryCard label="IVA" value={fmt(stats.iva)} tone="blue" />
                        <SummaryCard label="Total" value={fmt(stats.total)} tone="green" />
                        <SummaryCard label="Retenciones" value={fmt(stats.retentionTotal)} tone="amber" />
                    </div>

                    {message && <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-700">{message}</div>}
                </Section>

                <Section title="Facturas registradas" eyebrow="Consulta y revision" action={<Badge tone="blue">{stats.items} articulos</Badge>}>
                    <div className="space-y-3">
                        {savedInvoices.length === 0 ? (
                            <div className="rounded-3xl border border-dashed border-slate-300 p-10 text-center text-sm font-bold text-slate-400">
                                Todavia no hay facturas membretadas guardadas.
                            </div>
                        ) : filteredInvoices.length === 0 ? (
                            <div className="rounded-3xl border border-dashed border-slate-300 p-10 text-center text-sm font-bold text-slate-400">
                                No hay facturas membretadas que coincidan con los filtros.
                            </div>
                        ) : pagedInvoices.records.map((invoice) => {
                            const closureInfo = getInvoiceClosureInfo(invoice, closureIndex);
                            const isAnnulled = isStampedInvoiceAnnulled(invoice);
                            const invoiceBranch = getBranchById(getRecordBranchId(invoice));
                            const invoiceSeries = invoice.invoiceSeries || invoice.documentSeries || invoiceBranch.invoiceSeries || '';
                            return (
                            <div key={invoice.id || `${invoice.invoiceNumber}-${invoice.date}`} className={`rounded-[1.6rem] border p-4 shadow-sm transition ${isAnnulled ? 'border-red-300 bg-red-50/70 shadow-red-100/40' : 'border-slate-200 bg-white hover:-translate-y-0.5 hover:border-red-200 hover:shadow-lg hover:shadow-slate-900/5'}`}>
                                <div className="grid gap-4 xl:grid-cols-[1fr_0.58fr_0.8fr_auto] xl:items-center">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <div className={`truncate text-base font-black ${isAnnulled ? 'text-red-900' : 'text-slate-950'}`}>Factura {invoice.invoiceNumber || '-'}</div>
                                            <Badge tone="blue">{invoiceBranch.shortName} {invoiceSeries ? `· Serie ${invoiceSeries}` : ''}</Badge>
                                            <Badge tone={invoice.source === 'sicar_factura' ? 'blue' : 'slate'}>{invoice.source === 'sicar_factura' ? 'SICAR' : 'Manual'}</Badge>
                                            <Badge tone={invoice.cashierName ? 'green' : 'amber'}>{invoice.cashierName || 'Sin cajero'}</Badge>
                                            <Badge tone={closureInfo.status === 'vinculada' ? 'green' : closureInfo.status === 'sin_cierre' ? 'amber' : 'slate'}>{closureInfo.status === 'vinculada' ? 'Con cierre' : closureInfo.status === 'sin_cierre' ? 'Sin cierre' : 'Pendiente'}</Badge>
                                            {isAnnulled && <Badge tone="red">ANULADA</Badge>}
                                            {invoice.creditStatusLabel && (
                                                <Badge tone={invoice.creditStatus === 'cancelled' ? 'green' : invoice.creditStatus === 'partial' ? 'blue' : 'amber'}>
                                                    {invoice.creditStatusLabel}
                                                </Badge>
                                            )}
                                        </div>
                                        <div className={`mt-1 text-sm font-bold ${isAnnulled ? 'text-red-700' : 'text-slate-600'}`}>{invoice.customerName || invoice.cliente || 'Sin cliente'}</div>
                                        <div className={`mt-1 text-xs font-bold ${isAnnulled ? 'text-red-500' : 'text-slate-400'}`}>{invoice.date || '-'} · RUC {invoice.customerRfc || invoice.rfc || '-'} · {(invoice.items || []).length} articulo(s)</div>
                                        <div className={`mt-2 rounded-2xl border px-3 py-2 text-xs font-black ${isAnnulled ? 'border-red-200 bg-white text-red-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                                            Cierre de caja vinculado: <span className={isAnnulled ? 'text-red-900' : 'text-slate-950'}>{closureInfo.label}</span>
                                        </div>
                                        {invoice.creditStatusLabel && (
                                            <div className="mt-2 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-black text-sky-800">
                                                Abonado {fmt(invoice.creditPaidAmount)} · Saldo {fmt(invoice.creditBalance)}
                                            </div>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-2 gap-2 text-xs font-bold text-slate-500">
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Subtotal</div>
                                            <div className={`font-mono text-sm font-black ${isAnnulled ? 'text-red-800' : 'text-slate-950'}`}>{fmt(invoice.subtotal)}</div>
                                        </div>
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Total</div>
                                            <div className={`font-mono text-sm font-black ${isAnnulled ? 'text-red-800' : 'text-emerald-700'}`}>{fmt(invoice.total)}</div>
                                        </div>
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">IVA</div>
                                            <div className={`font-mono text-sm font-black ${isAnnulled ? 'text-red-700' : 'text-sky-700'}`}>{fmt(invoice.iva)}</div>
                                        </div>
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Ret.</div>
                                            <div className={`font-mono text-sm font-black ${isAnnulled ? 'text-red-700' : 'text-amber-700'}`}>{fmt(invoice.retentionTotal || 0)}</div>
                                        </div>
                                    </div>

                                    <Field label="Metodo">
                                        <PaymentMethodSelect value={invoice.paymentMethod || ''} onChange={(value) => updatePaymentMethod(invoice, value)} disabled={isAnnulled || !canEditCurrentScope} />
                                        <PaymentBreakdownPreview invoice={invoice} />
                                    </Field>

                                    <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
                                        <button
                                            type="button"
                                            onClick={() => openInvoiceDetail(invoice)}
                                            className="rounded-xl bg-slate-950 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-white transition hover:bg-slate-800"
                                        >
                                            Ver detalle
                                        </button>
                                        {canEditCurrentScope && (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={() => openInvoiceEdit(invoice)}
                                                    disabled={isAnnulled}
                                                    className="rounded-xl bg-[#e30613] px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    Editar
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setPrintTarget(invoice)}
                                                    className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-slate-700 transition hover:border-[#e30613] hover:text-[#e30613]"
                                                >
                                                    Imprimir
                                                </button>
                                                {closureInfo.status !== 'sin_cierre' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => markInvoiceWithoutClosure(invoice)}
                                                        disabled={isAnnulled}
                                                        className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                                                    >
                                                        Sin cierre
                                                    </button>
                                                )}
                                                {!isAnnulled && (
                                                    <button
                                                        type="button"
                                                        onClick={() => annulInvoice(invoice)}
                                                        className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-red-800 transition hover:bg-red-100"
                                                    >
                                                        Anular
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                            );
                        })}
                    </div>

                    <div className="mt-4">
                        <PaginationControls
                            page={pagedInvoices.page}
                            totalPages={pagedInvoices.totalPages}
                            total={filteredInvoices.length}
                            start={pagedInvoices.start}
                            end={pagedInvoices.end}
                            onPageChange={setPage}
                        />
                    </div>
                </Section>
            </div>

            <StampedInvoiceDetailModal
                invoice={detailTarget}
                onClose={() => {
                    setDetailTarget(null);
                    setSupportUploadFiles({});
                }}
                onPrint={setPrintTarget}
                onEdit={openInvoiceEdit}
                onPaymentMethodChange={updatePaymentMethod}
                canEdit={canEditCurrentScope}
                supportUploadFiles={supportUploadFiles}
                onSupportFileChange={updateSupportUploadFile}
                onSupportUpload={uploadDetailSupports}
                supportSaving={supportSaving}
            />
            {canEditCurrentScope && (
                <>
                    <StampedInvoiceEditModal
                        form={editForm}
                        splitInvoice={splitEditInvoice}
                        saving={editSaving}
                        onClose={closeInvoiceEdit}
                        onSave={saveEditedInvoice}
                        onUpdate={updateEditField}
                        onItemChange={updateEditItem}
                        onAddItem={addEditItem}
                        onRemoveItem={removeEditItem}
                        onSplit={splitEditedInvoice}
                        onSplitInvoiceNumberChange={updateSplitEditInvoiceNumber}
                        onOpenPaymentSplit={() => setEditPaymentSplitOpen(true)}
                    />
                    <PaymentSplitModal
                        open={editPaymentSplitOpen}
                        title={`Dividir pago factura ${editForm?.invoiceNumber || ''}`}
                        targetAmount={getInvoicePaymentTargetAmount(editForm || {})}
                        initialRows={editForm?.paymentBreakdown || []}
                        fallbackMethod={editForm?.paymentMethod || ''}
                        onClose={() => setEditPaymentSplitOpen(false)}
                        onSave={applyEditPaymentSplit}
                    />
                </>
            )}
            <StampedInvoicePrintModal
                invoice={printTarget}
                layout={printLayout}
                templates={printTemplates}
                activeTemplateId={activePrintTemplateId}
                templateName={printTemplateName}
                onSelectTemplate={selectPrintTemplate}
                onTemplateNameChange={setPrintTemplateName}
                onLayoutChange={setPrintLayout}
                onSaveLayout={savePrintLayout}
                onSaveNewLayout={saveNewPrintLayout}
                onClose={() => setPrintTarget(null)}
            />
        </>
    );
}

function CashDifferences({ data, branchContext }) {
    const { user } = useAuth();
    const isMaster = isMasterEmail(user?.email);
    const selectedBranchId = getActiveBillingBranchId(branchContext);
    const branchPayload = useMemo(() => getBranchPayload(selectedBranchId), [selectedBranchId]);
    const [message, setMessage] = useState('');
    const [selectedMonth, setSelectedMonth] = useState('');
    const [selectedDate, setSelectedDate] = useState('');

    const closureIndex = useMemo(() => {
        const map = new Map();
        (data.cierres_caja || [])
            .filter((closure) => isRecordInBillingBranch(closure, selectedBranchId))
            .forEach((closure) => {
            if (closure.id) map.set(closure.id, closure);
        });
        return map;
    }, [data.cierres_caja, selectedBranchId]);

    const differences = useMemo(() => (
        [...(data.diferencias_caja || [])]
            .filter((item) => isRecordInBillingBranch(item, selectedBranchId))
            .map((item) => ({
                ...item,
                effectivePendingAmount: getReconciledCashDifferencePendingAmount(item, closureIndex),
            }))
            .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    ), [closureIndex, data.diferencias_caja, selectedBranchId]);

    const filteredDifferences = useMemo(() => (
        differences.filter((item) => matchesHistoryDateFilters(item.date, selectedMonth, selectedDate))
    ), [differences, selectedMonth, selectedDate]);

    const byCashier = useMemo(() => {
        const map = new Map();
        differences.forEach((item) => {
            const pendingAmount = getEffectiveCashDifferencePendingAmount(item);
            if (pendingAmount <= 0.01) return;
            const key = item.cashierCode || item.cashierName || 'SIN-CAJERO';
            const current = map.get(key) || {
                cashierCode: item.cashierCode || '',
                cashierName: item.cashierName || 'Sin cajero',
                amount: 0,
                count: 0,
                rawNet: 0,
            };
            current.amount = safeNumber(current.amount + pendingAmount);
            current.rawNet = safeNumber(current.rawNet + safeNumber(item.amount));
            current.count += 1;
            map.set(key, current);
        });
        return [...map.values()].sort((a, b) => b.amount - a.amount);
    }, [differences]);

    const handleCashierPayment = async (cashier) => {
        if (!isMaster) return;

        const amountInput = window.prompt(`Monto a abonar a ${cashier.cashierName}:`, '');
        if (amountInput === null) return;

        const requestedAmount = parsePromptAmount(amountInput);
        if (requestedAmount <= 0) {
            setMessage('Ingresa un monto de abono mayor que cero.');
            return;
        }

        const note = window.prompt('Nota del abono / deduccion de salario:', 'Deduccion de salario') || '';
        const cashierKey = cashier.cashierCode || cashier.cashierName || 'SIN-CAJERO';
        const pendingRows = differences
            .filter((item) => (item.cashierCode || item.cashierName || 'SIN-CAJERO') === cashierKey)
            .filter((item) => getEffectiveCashDifferencePendingAmount(item) > 0.01)
            .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

        let remaining = requestedAmount;
        const allocations = [];
        const batch = writeBatch(db);

        pendingRows.forEach((item) => {
            if (remaining <= 0.01) return;
            const pendingAmount = getEffectiveCashDifferencePendingAmount(item);
            const applied = safeNumber(Math.min(pendingAmount, remaining));
            const nextPending = safeNumber(Math.max(pendingAmount - applied, 0));
            remaining = safeNumber(remaining - applied);
            allocations.push({
                differenceId: item.id,
                closureId: item.closureId || '',
                date: item.date || '',
                previousPending: pendingAmount,
                applied,
                nextPending,
            });
            batch.set(doc(db, 'diferencias_caja', item.id), {
                pendingAmount: nextPending,
                saldo: nextPending,
                paidAmount: safeNumber(safeNumber(item.paidAmount) + applied),
                status: nextPending <= 0.01 ? 'pagado' : 'pendiente',
                lastPaymentAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            }, { merge: true });
        });

        const appliedTotal = safeNumber(requestedAmount - remaining);
        if (appliedTotal <= 0) {
            setMessage('No hay saldo pendiente para abonar a ese cajero.');
            return;
        }

        batch.set(doc(collection(db, 'abonos_diferencias_caja')), {
            ...branchPayload,
            date: todayString(),
            month: getMonth(todayString()),
            cashierCode: cashier.cashierCode || '',
            cashierName: cashier.cashierName || '',
            amount: appliedTotal,
            requestedAmount,
            unusedAmount: remaining,
            note,
            source: 'deduccion_salario',
            createdBy: user?.email || '',
            allocations,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });

        await batch.commit();
        setMessage(`Abono registrado a ${cashier.cashierName}: ${fmt(appliedTotal)}.`);
    };

    return (
        <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
            <Section title="Saldo por cajero" eyebrow="Diferencias de caja" action={<Badge tone="red">{byCashier.length} cajeros</Badge>}>
                <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">
                    Solo se acumulan diferencias mayores a {fmt(CASH_DIFFERENCE_THRESHOLD)}. Los abonos por deduccion salarial solo los puede registrar el usuario master.
                </div>
                {message && (
                    <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
                        {message}
                    </div>
                )}
                <div className="space-y-3">
                    {byCashier.length === 0 ? (
                        <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-center text-sm font-bold text-slate-400">
                            No hay diferencias pendientes.
                        </div>
                    ) : byCashier.map((item) => (
                        <div key={item.cashierName} className="rounded-2xl border border-slate-200 bg-white p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <div className="text-sm font-black text-slate-950">{item.cashierName}</div>
                                    <div className="text-xs font-bold text-slate-500">{item.count} movimiento(s) pendiente(s)</div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="text-right">
                                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Saldo</div>
                                        <div className="font-mono text-lg font-black text-red-700">{fmt(item.amount)}</div>
                                    </div>
                                    {isMaster && (
                                        <button
                                            type="button"
                                            onClick={() => handleCashierPayment(item)}
                                            className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-white transition hover:bg-emerald-700"
                                        >
                                            Abonar
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </Section>

            <Section title="Movimientos" eyebrow="Auditoria" action={<Badge tone="blue">{filteredDifferences.length} registros</Badge>}>
                <div className="mb-4 grid gap-3 md:grid-cols-[0.4fr_0.4fr_auto]">
                    <Field label="Mes">
                        <input className={inputClass} type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} />
                    </Field>
                    <Field label="Dia especifico">
                        <input className={inputClass} type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
                    </Field>
                    <div className="flex items-end">
                        <button
                            type="button"
                            onClick={() => {
                                setSelectedMonth('');
                                setSelectedDate('');
                            }}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-slate-600 transition hover:border-[#e30613] hover:text-[#e30613]"
                        >
                            Limpiar
                        </button>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                        <thead>
                            <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                                <th className="py-3 pr-4">Fecha</th>
                                <th className="py-3 pr-4">Cajero</th>
                                <th className="py-3 pr-4">Tipo</th>
                                <th className="py-3 pr-4">Estado</th>
                                <th className="py-3 pr-4 text-right">Monto</th>
                                <th className="py-3 text-right">Saldo</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredDifferences.map((item) => (
                                <tr key={item.id} className="border-b border-slate-100">
                                    <td className="py-3 pr-4 font-bold text-slate-700">{item.date || '-'}</td>
                                    <td className="py-3 pr-4 font-black text-slate-950">{item.cashierName || 'Sin cajero'}</td>
                                    <td className="py-3 pr-4 font-bold capitalize text-slate-600">{item.differenceType || getCashDifferenceType(item.amount)}</td>
                                    <td className="py-3 pr-4"><Badge tone={item.status === 'pendiente' ? 'red' : 'green'}>{item.status || 'pendiente'}</Badge></td>
                                    <td className="py-3 pr-4 text-right font-mono font-black text-red-700">{fmt(item.amount)}</td>
                                    <td className="py-3 text-right font-mono font-black text-slate-900">{fmt(getEffectiveCashDifferencePendingAmount(item))}</td>
                                </tr>
                            ))}
                            {filteredDifferences.length === 0 && (
                                <tr>
                                    <td className="py-10 text-center text-sm font-bold text-slate-400" colSpan="6">Sin movimientos.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Section>
        </div>
    );
}

const buildDenominationRows = (count = {}, denominations = [], multiplier = 1) => (
    denominations
        .map((denomination) => {
            const quantity = safeNumber(count?.[denomination]);
            return {
                denomination,
                quantity,
                total: safeNumber(denomination * quantity * multiplier),
            };
        })
        .filter((row) => row.quantity > 0)
);

const getClosureRowsTotal = (rows = []) => (
    rows.reduce((sum, row) => safeNumber(sum + safeNumber(row.amountCordobas ?? row.amount ?? row.total ?? row.value)), 0)
);

const getClosureBankRows = (details = {}, bankKey) => (
    Array.isArray(details?.[bankKey]) ? details[bankKey] : []
);

const normalizeClosureBankDetails = (details = {}, type = 'transfer') => (
    Object.fromEntries((type === 'transfer' ? TRANSFER_BANKS : POS_BANKS).map(({ key }) => [
        key,
        (Array.isArray(details?.[key]) ? details[key] : []).map((row, index) => ({
            localId: row.localId || row.id || createLineId(`${type}_${key}_${index}`),
            clientName: row.clientName || row.customerName || '',
            amount: row.amount ?? row.total ?? '',
            reference: row.reference || row.ref || '',
        })),
    ]))
);

const calculateClosureEditTotals = (form = {}) => {
    const cashCordobasTotal = CASH_DENOMINATIONS.reduce((sum, denomination) => (
        safeNumber(sum + denomination * safeNumber(form.cashCount?.[denomination]))
    ), 0);
    const dollarCashTotal = USD_DENOMINATIONS.reduce((sum, denomination) => (
        safeNumber(sum + denomination * safeNumber(form.dollarCashCount?.[denomination]))
    ), 0);
    const dollarCashTotalCordobas = safeNumber(dollarCashTotal * CASH_CLOSURE_EXCHANGE_RATE);
    const preCloseDepositCordobas = safeNumber(form.preCloseDeposit?.cordobas);
    const preCloseDepositDollars = safeNumber(form.preCloseDeposit?.dollars);
    const preCloseDepositTotal = safeNumber(preCloseDepositCordobas + preCloseDepositDollars * CASH_CLOSURE_EXCHANGE_RATE);
    const cashTotal = safeNumber(cashCordobasTotal + dollarCashTotalCordobas + preCloseDepositTotal);
    const transferTotals = Object.fromEntries(TRANSFER_BANKS.map((bank) => [
        bank.key,
        getBankRowsTotal(form.transferDetails?.[bank.key] || [], bank),
    ]));
    const posTotals = Object.fromEntries(POS_BANKS.map(({ key }) => [
        key,
        safeNumber((form.posDetails?.[key] || []).reduce((sum, row) => sum + safeNumber(row.amount), 0)),
    ]));
    const houseDiscountTotal = getHouseDiscountTotal(form.houseDiscountDetails);
    const manualTotal = safeNumber(
        cashTotal
        + Object.values(transferTotals).reduce((sum, value) => safeNumber(sum + value), 0)
        + Object.values(posTotals).reduce((sum, value) => safeNumber(sum + value), 0)
        + houseDiscountTotal
    );
    const retentionAdjustment = safeNumber(form.retentionAdjustment);
    const sicarExpected = safeNumber(form.sicarExpected);
    const expectedAfterRetentions = getCashClosureComparableExpectedTotal(sicarExpected);
    const manualTotalWithRetentions = getCashClosureManualTotalWithRetentions(manualTotal, retentionAdjustment);
    const difference = getCashClosureDifference(manualTotal, sicarExpected, retentionAdjustment);
    const shouldTrackDifference = Math.abs(difference) > CASH_DIFFERENCE_THRESHOLD;

    return {
        cashCordobasTotal,
        dollarCashTotal,
        dollarCashTotalCordobas,
        preCloseDepositCordobas,
        preCloseDepositDollars,
        preCloseDepositTotal,
        cashTotal,
        transferTotals,
        posTotals,
        houseDiscountTotal,
        manualTotal,
        manualTotalWithRetentions,
        retentionAdjustment,
        sicarExpected,
        expectedAfterRetentions,
        difference,
        shouldTrackDifference,
    };
};

const createCashClosureEditForm = (closure = {}) => {
    const netSalesTotals = getNetSicarSalesTotals({ ...(closure.sicar || {}), ...closure });
    return {
        id: closure.id || '',
        date: closure.date || todayString(),
        cashierName: closure.cashierName || '',
        cashierCode: closure.cashierCode || (closure.cashierName ? `CAJ-${slugify(closure.cashierName)}` : ''),
        status: closure.status || 'cuadrado',
        cashCount: { ...(closure.cashCount || {}) },
        dollarCashCount: { ...(closure.dollarCashCount || {}) },
        preCloseDeposit: {
            cordobas: closure.preCloseDeposit?.cordobas ?? '',
            dollars: closure.preCloseDeposit?.dollars ?? '',
        },
        transferDetails: normalizeClosureBankDetails(closure.transferDetails, 'transfer'),
        posDetails: normalizeClosureBankDetails(closure.posDetails, 'pos'),
        houseDiscountDetails: normalizeHouseDiscountDetails(closure.houseDiscountDetails || closure.discountDetails),
        sicarExpected: String(safeNumber(closure.sicarExpected)),
        cashSalesTotal: String(netSalesTotals.cashSalesNetTotal),
        creditSalesTotal: String(netSalesTotals.creditSalesNetTotal),
        creditRecoveryTotal: String(safeNumber(closure.creditRecoveryTotal || closure.sicar?.creditRecoveryTotal || closure.sicar?.recuperacionCredito || closure.sicar?.entCre)),
        retentionAdjustment: String(safeNumber(closure.retentionAdjustment)),
        notes: closure.notes || '',
        linkedSicarClosureId: closure.linkedSicarClosureId || closure.sicar?.id || '',
        linkedSicarCorId: closure.linkedSicarCorId || closure.sicar?.corId || closure.sicar?.cor_id || null,
        linkedSicarRccId: closure.linkedSicarRccId || closure.sicar?.rccId || closure.sicar?.rcc_id || null,
        sicar: closure.sicar || null,
    };
};

const getCashClosureInvoices = (closure = {}) => {
    const detailedInvoices = Array.isArray(closure.stampedInvoices) ? closure.stampedInvoices : [];
    const draftInvoices = Array.isArray(closure.stampedInvoiceDrafts) ? closure.stampedInvoiceDrafts : [];
    if (detailedInvoices.length) return detailedInvoices;
    if (draftInvoices.length) return draftInvoices;
    return (closure.stampedInvoiceIds || []).map((id) => ({ id, invoiceNumber: id }));
};

const getCashClosureReceipts = (closure = {}) => {
    const detailedReceipts = Array.isArray(closure.cashReceipts) ? closure.cashReceipts : [];
    const draftReceipts = Array.isArray(closure.cashReceiptDrafts) ? closure.cashReceiptDrafts : [];
    if (detailedReceipts.length) return detailedReceipts.map((receipt) => createCashReceiptDraft(receipt, closure.date || todayString()));
    if (draftReceipts.length) return draftReceipts.map((receipt) => createCashReceiptDraft(receipt, closure.date || todayString()));
    return (closure.cashReceiptIds || []).map((id) => ({ id, docId: id, receiptNumber: id, amount: 0 }));
};

const escapeClosureReportXml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const isClosureReportCurrencyHeader = (header = '') => (
    [
        'subtotal',
        'iva',
        'total',
        'nettotal',
        'retentionir2',
        'retentionmunicipal1',
        'retentiontotal',
        'retencionir2',
        'retencionmunicipal1',
        'retenciontotal',
    ].includes(
        normalizeText(header)
            .replace(/[^A-Z0-9]/g, '')
            .toLowerCase()
    )
);

const safeClosureReportSheetName = (value = 'Reporte') => (
    String(value || 'Reporte')
        .replace(/[\\/?*[\]:]/g, ' ')
        .trim()
        .slice(0, 31) || 'Reporte'
);

const buildClosureReportWorksheetXml = ({ name = 'Reporte', rows = [] }) => {
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const rowXml = [
        `<Row>${headers.map((header) => `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeClosureReportXml(header)}</Data></Cell>`).join('')}</Row>`,
        ...rows.map((row) => (
            `<Row>${headers.map((header) => {
                const value = row[header];
                const isNumber = typeof value === 'number' && Number.isFinite(value);
                const style = isNumber && isClosureReportCurrencyHeader(header) ? 'Currency' : 'Text';
                return `<Cell ss:StyleID="${style}"><Data ss:Type="${isNumber ? 'Number' : 'String'}">${escapeClosureReportXml(value)}</Data></Cell>`;
            }).join('')}</Row>`
        )),
    ].join('');

    return `<Worksheet ss:Name="${escapeClosureReportXml(safeClosureReportSheetName(name))}">
        <Table>${rowXml}</Table>
        <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
            <Selected/>
            <Panes><Pane><Number>3</Number><ActiveRow>1</ActiveRow></Pane></Panes>
        </WorksheetOptions>
    </Worksheet>`;
};

const downloadClosureReportXls = (filename, sheets = []) => {
    const filledSheets = (Array.isArray(sheets) ? sheets : []).filter((sheet) => (sheet.rows || []).length);
    if (!filledSheets.length) return;

    const workbook = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
    xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:x="urn:schemas-microsoft-com:office:excel"
    xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
    xmlns:html="http://www.w3.org/TR/REC-html40">
    <Styles>
        <Style ss:ID="Header">
            <Font ss:Bold="1" ss:Color="#FFFFFF"/>
            <Interior ss:Color="#9F111A" ss:Pattern="Solid"/>
            <Borders>
                <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D8DEE6"/>
                <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D8DEE6"/>
                <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D8DEE6"/>
                <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D8DEE6"/>
            </Borders>
        </Style>
        <Style ss:ID="Text">
            <Borders>
                <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D8DEE6"/>
                <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D8DEE6"/>
                <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D8DEE6"/>
                <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D8DEE6"/>
            </Borders>
        </Style>
        <Style ss:ID="Currency">
            <NumberFormat ss:Format="&quot;C$&quot; #,##0.00"/>
            <Borders>
                <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D8DEE6"/>
                <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D8DEE6"/>
                <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D8DEE6"/>
                <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D8DEE6"/>
            </Borders>
        </Style>
    </Styles>
    ${filledSheets.map(buildClosureReportWorksheetXml).join('')}
</Workbook>`;
    const blob = new Blob([workbook], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
};

const buildCashClosureReportContext = (closure = {}) => {
    const exchangeRate = safeNumber(closure.exchangeRate || closure.preCloseDeposit?.exchangeRate || CASH_CLOSURE_EXCHANGE_RATE);
    const linkedInvoices = getCashClosureInvoices(closure);
    const linkedReceipts = getCashClosureReceipts(closure);
    const transferRows = TRANSFER_BANKS.flatMap((bank) => (
        getClosureBankRows(closure.transferDetails, bank.key).map((row, index) => ({
            ...row,
            bankKey: bank.key,
            bank: bank.label,
            currency: bank.currency || 'NIO',
            exchangeRate: getTransferBankExchangeRate(bank),
            amountCordobas: safeNumber(safeNumber(row.amount ?? row.total ?? row.value) * getTransferBankExchangeRate(bank)),
            id: row.localId || row.id || `${bank.key}-transfer-${index}`,
        }))
    ));
    const posRows = POS_BANKS.flatMap((bank) => (
        getClosureBankRows(closure.posDetails, bank.key).map((row, index) => ({
            ...row,
            bankKey: bank.key,
            bank: bank.label,
            id: row.localId || row.id || `${bank.key}-pos-${index}`,
        }))
    ));
    const houseDiscountRows = normalizeHouseDiscountDetails(closure.houseDiscountDetails || closure.discountDetails)
        .map((row, index) => ({
            ...row,
            id: row.localId || row.id || `house-discount-${index}`,
            amountCordobas: safeNumber(row.amount ?? row.total ?? row.value),
        }));
    const transferTotal = getClosureRowsTotal(transferRows);
    const posTotal = getClosureRowsTotal(posRows);
    const houseDiscountTotal = getHouseDiscountTotal(houseDiscountRows);
    const status = closure.status || 'cerrado';
    const sicar = closure.sicar || {};
    const code = closure.code || closure.linkedSicarCorId || sicar.corId || sicar.cor_id || closure.id;
    const cashboxName = closure.cashboxName || sicar.cashboxName || sicar.cajaName || sicar.caja || 'Caja';
    const preClose = closure.preCloseDeposit || {};
    const detailNetSalesTotals = getNetSicarSalesTotals({ ...sicar, ...closure });
    const detailAccountingSummary = closure.accountingSummary
        ? normalizeClosureAccountingSummarySales(closure.accountingSummary, detailNetSalesTotals, closure)
        : buildClosureAccountingSummary({
            cashSalesTotal: detailNetSalesTotals.cashSalesNetTotal,
            creditSalesTotal: detailNetSalesTotals.creditSalesNetTotal,
            creditRecoveryTotal: closure.creditRecoveryTotal || sicar.creditRecoveryTotal || sicar.recuperacionCredito || sicar.entCre,
            stampedInvoices: linkedInvoices,
            cashReceipts: linkedReceipts,
            transferTotals: closure.transferTotals || {},
            posTotals: closure.posTotals || {},
            houseDiscountTotal: closure.houseDiscountTotal ?? houseDiscountTotal,
            cashCordobasTotal: closure.cashCordobasTotal,
            dollarCashTotalCordobas: closure.dollarCashTotalCordobas,
            preCloseDepositTotal: closure.preCloseDepositTotal || closure.preCloseDeposit?.totalCordobas,
        });

    return {
        exchangeRate,
        linkedInvoices,
        linkedReceipts,
        transferRows,
        posRows,
        houseDiscountRows,
        transferTotal,
        posTotal,
        houseDiscountTotal,
        status,
        sicar,
        code,
        cashboxName,
        preClose,
        detailAccountingSummary,
    };
};

const formatCashClosureTicketCode = (code = '') => {
    const value = String(code || '').trim();
    if (!value) return '-';
    return /^\d+$/.test(value) ? value.padStart(3, '0') : value;
};

const sumInvoiceField = (invoices = [], field) => safeNumber(
    invoices.reduce((sum, invoice) => sum + safeNumber(invoice[field]), 0)
);

const splitStampedInvoiceRetentionsForTicket = (invoice = {}) => {
    const hasIr = hasNumericValue(invoice.retentionIr2);
    const hasMunicipal = hasNumericValue(invoice.retentionMunicipal1);
    if (hasIr || hasMunicipal) {
        return {
            ir: safeNumber(invoice.retentionIr2),
            municipal: safeNumber(invoice.retentionMunicipal1),
        };
    }

    const totalRetention = safeNumber(invoice.retentionTotal);
    if (!totalRetention) return { ir: 0, municipal: 0 };

    const subtotal = safeNumber(invoice.subtotal || invoice.amount);
    const expectedIr = safeNumber(subtotal * 0.02);
    const expectedMunicipal = safeNumber(subtotal * 0.01);
    const expectedBoth = safeNumber(expectedIr + expectedMunicipal);

    if (subtotal > 0 && Math.abs(totalRetention - expectedIr) <= 0.1) {
        return { ir: totalRetention, municipal: 0 };
    }

    if (subtotal > 0 && Math.abs(totalRetention - expectedMunicipal) <= 0.1) {
        return { ir: 0, municipal: totalRetention };
    }

    if (subtotal > 0 && Math.abs(totalRetention - expectedBoth) <= 0.15) {
        return {
            ir: expectedIr,
            municipal: safeNumber(totalRetention - expectedIr),
        };
    }

    const inferredIr = safeNumber(totalRetention * (2 / 3));
    return {
        ir: inferredIr,
        municipal: safeNumber(totalRetention - inferredIr),
    };
};

const getStampedInvoiceTicketAmounts = (invoice = {}) => {
    const rows = getInvoicePaymentRows(invoice);
    const total = safeNumber(invoice.total || safeNumber(invoice.subtotal) + safeNumber(invoice.iva));
    if (!rows.length) {
        return isCreditPaymentMethod(invoice.paymentMethod)
            ? { credit: total, cash: 0 }
            : { credit: 0, cash: total };
    }

    const creditRowsTotal = safeNumber(rows.reduce((sum, row) => (
        sum + (isCreditPaymentMethod(row.method) ? safeNumber(row.amount) : 0)
    ), 0));
    const cashRowsTotal = safeNumber(rows.reduce((sum, row) => (
        sum + (!isCreditPaymentMethod(row.method) ? safeNumber(row.amount) : 0)
    ), 0));

    if (creditRowsTotal > 0 && cashRowsTotal <= 0) return { credit: total, cash: 0 };
    if (cashRowsTotal > 0 && creditRowsTotal <= 0) return { credit: 0, cash: total };
    const rowsTotal = safeNumber(creditRowsTotal + cashRowsTotal);
    if (rowsTotal <= 0) return { credit: 0, cash: total };

    const creditGross = safeNumber(total * (creditRowsTotal / rowsTotal));
    return {
        credit: creditGross,
        cash: safeNumber(total - creditGross),
    };
};

const getStampedInvoiceVatForTicket = (invoice = {}) => {
    if (hasNumericValue(invoice.iva)) return safeNumber(invoice.iva);
    if (hasNumericValue(invoice.tax)) return safeNumber(invoice.tax);
    const total = safeNumber(invoice.total);
    const subtotal = safeNumber(invoice.subtotal);
    return total > 0 && subtotal > 0 ? safeNumber(Math.max(total - subtotal, 0)) : 0;
};

const normalizeTicketDetailAmount = (row = {}) => (
    safeNumber(row.amountCordobas ?? row.amount ?? row.total ?? row.value)
);

const formatTicketUsdAmount = (value = 0) => (
    `$${safeNumber(value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
);

const getTicketPaymentConversionLabel = (row = {}) => {
    const currency = String(row.currency || '').toUpperCase();
    if (currency !== 'USD') return '';
    const dollarAmount = safeNumber(row.amount ?? row.total ?? row.value);
    return dollarAmount > 0 ? `Conv: ${formatTicketUsdAmount(dollarAmount)}` : '';
};

const getTicketPaymentDetailLabel = (row = {}, type = 'transfer') => {
    const clientName = String(row.clientName || row.customerName || '').trim();
    const reference = String(row.reference || row.ref || '').trim();
    const description = String(row.description || row.descripcion || row.concept || row.concepto || '').trim();

    if (type === 'discount') return description || 'Descuento de la casa';
    if (type === 'pos') return reference || clientName || 'Sin referencia';
    if (clientName && reference) return `${clientName} - ${reference}`;
    return clientName || reference || 'Sin referencia';
};

const buildTicketPaymentMethod = ({ label, total = 0, rows = [], type = 'transfer', alwaysShow = false }) => ({
    label,
    total: safeNumber(total),
    alwaysShow,
    details: rows
        .map((row, index) => ({
            id: row.localId || row.id || `${label}-${index}`,
            label: getTicketPaymentDetailLabel(row, type),
            amount: normalizeTicketDetailAmount(row),
            conversionLabel: getTicketPaymentConversionLabel(row),
        }))
        .filter((row) => row.amount > 0),
});

const getRowsByBankKey = (rows = [], bankKey) => (
    rows.filter((row) => row.bankKey === bankKey || row.key === bankKey)
);

const buildCashClosureTicketData = (closure = {}) => {
    const context = buildCashClosureReportContext(closure);
    const invoices = context.linkedInvoices || [];
    const receipts = context.linkedReceipts || [];
    const summary = context.detailAccountingSummary || {};
    const payment = summary.paymentBreakdown || {};
    const invoiceTotal = safeNumber(invoices.reduce((sum, invoice) => sum + safeNumber(invoice.total), 0));
    const invoiceVatTotal = safeNumber(invoices.reduce((sum, invoice) => sum + getStampedInvoiceVatForTicket(invoice), 0));
    const invoicePaymentTotals = invoices.reduce((acc, invoice) => {
        const amounts = getStampedInvoiceTicketAmounts(invoice);
        return {
            credit: safeNumber(acc.credit + amounts.credit),
            cash: safeNumber(acc.cash + amounts.cash),
        };
    }, { credit: 0, cash: 0 });
    const receiptTotal = safeNumber(receipts.reduce((sum, receipt) => sum + safeNumber(receipt.amount), 0));
    const invoiceRetentions = invoices.reduce((acc, invoice) => {
        const split = splitStampedInvoiceRetentionsForTicket(invoice);
        return {
            ir: safeNumber(acc.ir + split.ir),
            municipal: safeNumber(acc.municipal + split.municipal),
        };
    }, { ir: 0, municipal: 0 });
    const receiptRetentionIr = sumInvoiceField(receipts, 'retentionIr2');
    const receiptRetentionMunicipal = sumInvoiceField(receipts, 'retentionMunicipal1');
    const retentionIr = safeNumber(invoiceRetentions.ir + receiptRetentionIr);
    const retentionMunicipal = safeNumber(invoiceRetentions.municipal + receiptRetentionMunicipal);
    const retentionTotal = safeNumber(retentionIr + retentionMunicipal);
    const taxableSubtotal = invoiceVatTotal > 0 ? safeNumber(invoiceVatTotal / 0.15) : 0;
    const exemptSubtotalRaw = safeNumber(invoiceTotal - invoiceVatTotal - taxableSubtotal);
    const exemptSubtotal = Math.abs(exemptSubtotalRaw) <= 0.05 ? 0 : safeNumber(Math.max(exemptSubtotalRaw, 0));
    const cashIncomeTotal = safeNumber(invoicePaymentTotals.cash + receiptTotal - retentionTotal);
    const posBacTotal = safeNumber(payment.posBac ?? closure.posTotals?.bac);
    const posBanproTotal = safeNumber(payment.posBanpro ?? closure.posTotals?.banpro);
    const posLafiseTotal = safeNumber(payment.posLafise ?? closure.posTotals?.lafise);
    const transferBacTotal = safeNumber(payment.transferBac ?? closure.transferTotals?.bac);
    const transferBacUsdTotal = safeNumber(payment.transferBacUsd ?? closure.transferTotals?.bacUsd);
    const transferLafiseTotal = safeNumber(payment.transferLafise ?? closure.transferTotals?.lafise);
    const transferLafiseUsdTotal = safeNumber(payment.transferLafiseUsd ?? closure.transferTotals?.lafiseUsd);
    const transferBanproTotal = safeNumber(payment.transferBanpro ?? closure.transferTotals?.banpro);
    const houseDiscountTotal = safeNumber(payment.houseDiscountTotal ?? closure.houseDiscountTotal ?? context.houseDiscountTotal);
    const visibleCardTotal = safeNumber(posBacTotal + posBanproTotal + posLafiseTotal);
    // BAC (2) no se imprime; queda absorbido en efectivo para cuadrar el ticket.
    const visibleTransferTotal = safeNumber(
        transferBacTotal
        + transferBacUsdTotal
        + transferLafiseTotal
        + transferLafiseUsdTotal
        + transferBanproTotal
    );
    const efectivoResidual = safeNumber(cashIncomeTotal - visibleCardTotal - visibleTransferTotal - houseDiscountTotal);
    const paymentMethods = [
        buildTicketPaymentMethod({
            label: 'POS BAC TOTAL:',
            total: posBacTotal,
            rows: getRowsByBankKey(context.posRows, 'bac'),
            type: 'pos',
            alwaysShow: true,
        }),
        buildTicketPaymentMethod({
            label: 'POS LAFISE TOTAL:',
            total: posLafiseTotal,
            rows: getRowsByBankKey(context.posRows, 'lafise'),
            type: 'pos',
            alwaysShow: true,
        }),
        buildTicketPaymentMethod({
            label: 'POS BANPRO TOTAL:',
            total: posBanproTotal,
            rows: getRowsByBankKey(context.posRows, 'banpro'),
            type: 'pos',
            alwaysShow: true,
        }),
        buildTicketPaymentMethod({
            label: 'TRANSFERENCIA BAC TOTAL:',
            total: transferBacTotal,
            rows: getRowsByBankKey(context.transferRows, 'bac'),
            type: 'transfer',
        }),
        buildTicketPaymentMethod({
            label: 'TRANSFERENCIA BAC USD TOTAL:',
            total: transferBacUsdTotal,
            rows: getRowsByBankKey(context.transferRows, 'bacUsd'),
            type: 'transfer',
        }),
        buildTicketPaymentMethod({
            label: 'TRANSFERENCIA LAFISE TOTAL:',
            total: transferLafiseTotal,
            rows: getRowsByBankKey(context.transferRows, 'lafise'),
            type: 'transfer',
        }),
        buildTicketPaymentMethod({
            label: 'TRANSFERENCIA LAFISE USD TOTAL:',
            total: transferLafiseUsdTotal,
            rows: getRowsByBankKey(context.transferRows, 'lafiseUsd'),
            type: 'transfer',
        }),
        buildTicketPaymentMethod({
            label: 'TRANSFERENCIA BANPRO TOTAL:',
            total: transferBanproTotal,
            rows: getRowsByBankKey(context.transferRows, 'banpro'),
            type: 'transfer',
        }),
        buildTicketPaymentMethod({
            label: 'DESCUENTOS DE LA CASA:',
            total: houseDiscountTotal,
            rows: context.houseDiscountRows || [],
            type: 'discount',
        }),
    ].filter((method) => method.alwaysShow || method.total > 0 || method.details.length);

    return {
        code: formatCashClosureTicketCode(context.code),
        cashierName: closure.cashierName || 'Sin cajero',
        date: closure.date || '-',
        salesCashTotal: invoicePaymentTotals.cash,
        salesCreditTotal: invoicePaymentTotals.credit,
        salesTotal: invoiceTotal,
        invoiceVatTotal,
        taxableSubtotal,
        exemptSubtotal,
        stampedCreditInvoiceTotal: invoicePaymentTotals.credit,
        stampedCashInvoiceTotal: invoicePaymentTotals.cash,
        stampedInvoiceTotal: invoiceTotal,
        stampedCashReceiptTotal: receiptTotal,
        stampedIncomeTotal: safeNumber(invoicePaymentTotals.cash + receiptTotal),
        retentionTotal,
        retentionIr,
        retentionMunicipal,
        cashIncomeTotal,
        posBac: posBacTotal,
        posBanpro: posBanproTotal,
        posLafise: posLafiseTotal,
        transferBac: transferBacTotal,
        transferBacUsd: transferBacUsdTotal,
        transferLafise: safeNumber(transferLafiseTotal + transferLafiseUsdTotal),
        transferBanpro: transferBanproTotal,
        houseDiscountTotal,
        rc: efectivoResidual,
        paymentMethods,
        invoices: invoices.map((invoice) => ({
            id: invoice.id || invoice.docId || invoice.invoiceNumber || invoice.numeroFactura,
            number: invoice.invoiceNumber || invoice.numeroFactura || invoice.document || '-',
            total: safeNumber(invoice.total),
        })),
        receipts: receipts.map((receipt) => ({
            id: receipt.id || receipt.docId || receipt.receiptNumber,
            number: receipt.receiptNumber || receipt.numeroRecibo || receipt.document || '-',
            total: safeNumber(receipt.amount),
        })),
    };
};

const printCashClosureTicket = () => {
    document.body.classList.add('print-cash-closure-ticket');
    const cleanup = () => {
        document.body.classList.remove('print-cash-closure-ticket');
        window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.setTimeout(() => {
        window.print();
        window.setTimeout(cleanup, 1000);
    }, 60);
};

const CashClosureTicketPrint = ({ closure }) => {
    if (!closure) return null;
    const ticket = buildCashClosureTicketData(closure);
    const sections = [
        {
            title: 'VENTAS DEL DIA',
            rows: [
                { label: 'Ventas contado:', value: ticket.salesCashTotal },
                { label: 'Ventas Credito:', value: ticket.salesCreditTotal },
                { label: 'Total Venta:', value: ticket.salesTotal, highlight: true },
                { label: 'IVA Facturado:', value: ticket.invoiceVatTotal },
                { label: 'Subtotal Total Venta Gravada:', value: ticket.taxableSubtotal },
                { label: 'Subtotal Venta Exenta:', value: ticket.exemptSubtotal },
            ],
        },
        {
            title: 'RECIBOS DE CAJA',
            rows: [
                { label: 'Recibo caja membretados:', value: ticket.stampedCashReceiptTotal },
            ],
        },
        {
            title: 'DEDUCCIONES',
            rows: [
                { label: 'Retencion IR:', value: ticket.retentionIr },
                { label: 'Retencion Municipal:', value: ticket.retentionMunicipal },
                { label: 'Total Deducciones:', value: ticket.retentionTotal, highlight: true },
            ],
        },
        {
            title: '',
            rows: [
                { label: 'Flujo de Caja:', value: ticket.cashIncomeTotal, highlight: true },
            ],
        },
    ];

    return (
        <>
            <div className="cash-closure-ticket-print-area">
                <div className="cash-closure-ticket">
                    <div className="ticket-title">Cierre de Caja {ticket.code}</div>
                    <div className="ticket-meta">
                        <div><span>Cajero:</span> {ticket.cashierName}</div>
                        <div><span>Fecha:</span> {ticket.date}</div>
                    </div>
                    {sections.map((section) => (
                        <div className="ticket-section" key={section.title || 'total-income'}>
                            {section.title ? <div className="ticket-subtitle">{section.title}</div> : null}
                            {section.rows.map((row) => (
                                <div className={`ticket-row${row.highlight ? ' ticket-total-row' : ''}`} key={row.label}>
                                    <span>{row.label}</span>
                                    <strong>{fmt(row.value)}</strong>
                                </div>
                            ))}
                        </div>
                    ))}
                    <div className="ticket-subtitle">DESGLOSE DE METODO PAGO</div>
                    <div className="ticket-section">
                        {ticket.paymentMethods.length ? ticket.paymentMethods.map((method) => (
                            <div className="ticket-method" key={method.label}>
                                <div className="ticket-row ticket-total-row">
                                    <span>{method.label}</span>
                                    <strong>{fmt(method.total)}</strong>
                                </div>
                                {method.details.map((detail) => (
                                    <div className="ticket-row ticket-detail-row" key={detail.id}>
                                        <span>
                                            {detail.label}
                                            {detail.conversionLabel ? <small>{detail.conversionLabel}</small> : null}
                                        </span>
                                        <strong>{fmt(detail.amount)}</strong>
                                    </div>
                                ))}
                            </div>
                        )) : (
                            <div className="ticket-empty">Sin metodos de pago detallados.</div>
                        )}
                        <div className="ticket-row ticket-total-row">
                            <span>EFECTIVO:</span>
                            <strong>{fmt(ticket.rc)}</strong>
                        </div>
                    </div>
                    <div className="ticket-subtitle">DESGLOSE FACTURAS MEMBRETADAS</div>
                    <div className="ticket-section">
                        {ticket.invoices.length ? ticket.invoices.map((invoice) => (
                            <div className="ticket-row" key={invoice.id}>
                                <span>{invoice.number}</span>
                                <strong>{fmt(invoice.total)}</strong>
                            </div>
                        )) : (
                            <div className="ticket-empty">Sin facturas membretadas vinculadas.</div>
                        )}
                    </div>
                    <div className="ticket-subtitle">DESGLOSE DE RECIBO DE CAJA</div>
                    <div className="ticket-section">
                        {ticket.receipts.length ? ticket.receipts.map((receipt) => (
                            <div className="ticket-row" key={receipt.id}>
                                <span>{receipt.number}</span>
                                <strong>{fmt(receipt.total)}</strong>
                            </div>
                        )) : (
                            <div className="ticket-empty">Sin recibos de caja vinculados.</div>
                        )}
                    </div>
                </div>
            </div>
            <style>{`
                .cash-closure-ticket-print-area { display: none; }
                @media print {
                    @page { size: 80mm 220mm; margin: 3mm; }
                    body.print-cash-closure-ticket * { visibility: hidden !important; }
                    body.print-cash-closure-ticket .cash-closure-ticket-print-area,
                    body.print-cash-closure-ticket .cash-closure-ticket-print-area * { visibility: visible !important; }
                    body.print-cash-closure-ticket .cash-closure-ticket-print-area {
                        display: block !important;
                        position: fixed;
                        inset: 0 auto auto 0;
                        width: 74mm;
                        background: #fff;
                        color: #000;
                        font-family: "Arial", sans-serif;
                    }
                    body.print-cash-closure-ticket .cash-closure-ticket {
                        width: 74mm;
                        padding: 0;
                        font-family: Arial, sans-serif;
                        font-size: 12px;
                        font-weight: 400;
                        line-height: 1.36;
                    }
                    body.print-cash-closure-ticket .ticket-title {
                        border-bottom: 1px dashed #000;
                        font-size: 12px;
                        font-weight: 400;
                        padding-bottom: 5px;
                        text-align: center;
                        text-transform: uppercase;
                    }
                    body.print-cash-closure-ticket .ticket-meta {
                        border-bottom: 1px dashed #000;
                        margin-bottom: 6px;
                        padding: 5px 0;
                    }
                    body.print-cash-closure-ticket .ticket-meta span,
                    body.print-cash-closure-ticket .ticket-row span {
                        font-weight: 400;
                    }
                    body.print-cash-closure-ticket .ticket-section {
                        border-bottom: 1px dashed #000;
                        margin-bottom: 7px;
                        padding-bottom: 6px;
                    }
                    body.print-cash-closure-ticket .ticket-row {
                        align-items: flex-start;
                        display: flex;
                        gap: 6px;
                        justify-content: space-between;
                        padding: 1px 0;
                    }
                    body.print-cash-closure-ticket .ticket-total-row {
                        border-bottom: 1px solid #d9d9d9;
                        margin: 2px 0;
                        padding-bottom: 2px;
                    }
                    body.print-cash-closure-ticket .ticket-total-row span,
                    body.print-cash-closure-ticket .ticket-total-row strong {
                        font-weight: 700;
                    }
                    body.print-cash-closure-ticket .ticket-method {
                        padding: 2px 0;
                    }
                    body.print-cash-closure-ticket .ticket-detail-row {
                        padding-left: 8px;
                        font-size: 12px;
                    }
                    body.print-cash-closure-ticket .ticket-detail-row span {
                        max-width: 43mm;
                    }
                    body.print-cash-closure-ticket .ticket-detail-row small {
                        display: block;
                        font-size: 10px;
                        line-height: 1.15;
                    }
                    body.print-cash-closure-ticket .ticket-row strong {
                        font-family: Arial, sans-serif;
                        font-weight: 400;
                        text-align: right;
                        white-space: nowrap;
                    }
                    body.print-cash-closure-ticket .ticket-subtitle {
                        font-size: 12px;
                        font-weight: 400;
                        margin: 5px 0 3px;
                        text-align: center;
                        text-transform: uppercase;
                    }
                    body.print-cash-closure-ticket .ticket-empty {
                        font-size: 12px;
                        font-weight: 400;
                        padding: 4px 0;
                        text-align: center;
                    }
                }
            `}</style>
        </>
    );
};

const buildCashClosureRcReportSheets = (closure = {}) => {
    const context = buildCashClosureReportContext(closure);
    const stamped = context.detailAccountingSummary?.stampedDocuments || {};
    const payment = context.detailAccountingSummary?.paymentBreakdown || {};
    const ratio = context.detailAccountingSummary?.internalRatio || {};

    const summaryRows = [
        { Seccion: 'Cierre', Concepto: 'Fecha', Detalle: closure.date || '-', Total: '' },
        { Seccion: 'Cierre', Concepto: 'Caja', Detalle: context.cashboxName || '-', Total: '' },
        { Seccion: 'Cierre', Concepto: 'Cajero', Detalle: closure.cashierName || 'Sin cajero', Total: '' },
        { Seccion: 'Cierre', Concepto: 'Codigo cierre', Detalle: context.code || '-', Total: '' },
        { Seccion: 'Cierre', Concepto: 'RCC', Detalle: closure.linkedSicarRccId || context.sicar.rccId || context.sicar.rcc_id || '-', Total: '' },
        { Seccion: 'Cierre', Concepto: 'Estado', Detalle: String(context.status || 'cerrado').replace(/_/g, ' '), Total: '' },
        { Seccion: '1.2 Documentos membretados', Concepto: 'Fact. contado', Detalle: '', Total: safeNumber(stamped.stampedCashInvoices) },
        { Seccion: '1.2 Documentos membretados', Concepto: 'Fact. credito', Detalle: '', Total: safeNumber(stamped.stampedCreditInvoices) },
        { Seccion: '1.2 Documentos membretados', Concepto: 'Recibos caja', Detalle: '', Total: safeNumber(stamped.stampedCashReceipts) },
        { Seccion: '1.4 Metodos de pago', Concepto: 'Tarjeta total', Detalle: '', Total: safeNumber(payment.cardTotal) },
        { Seccion: '1.4 Metodos de pago', Concepto: 'POS BAC', Detalle: '', Total: safeNumber(payment.posBac) },
        { Seccion: '1.4 Metodos de pago', Concepto: 'POS Banpro', Detalle: '', Total: safeNumber(payment.posBanpro) },
        { Seccion: '1.4 Metodos de pago', Concepto: 'POS Lafise', Detalle: '', Total: safeNumber(payment.posLafise) },
        { Seccion: '1.4 Metodos de pago', Concepto: 'Transferencias', Detalle: '', Total: safeNumber(payment.transferTotal) },
        { Seccion: '1.4 Metodos de pago', Concepto: 'BAC', Detalle: '', Total: safeNumber(payment.transferBac) },
        { Seccion: '1.4 Metodos de pago', Concepto: 'BAC (2)', Detalle: '', Total: safeNumber(payment.transferBac2) },
        { Seccion: '1.4 Metodos de pago', Concepto: 'Banpro', Detalle: '', Total: safeNumber(payment.transferBanpro) },
        { Seccion: '1.4 Metodos de pago', Concepto: 'Lafise', Detalle: '', Total: safeNumber(payment.transferLafise) },
        { Seccion: '1.4 Metodos de pago', Concepto: 'BAC USD', Detalle: '', Total: safeNumber(payment.transferBacUsd) },
        { Seccion: '1.4 Metodos de pago', Concepto: 'Lafise USD', Detalle: '', Total: safeNumber(payment.transferLafiseUsd) },
        { Seccion: '1.4 Metodos de pago', Concepto: 'Descuentos de la casa', Detalle: '', Total: safeNumber(payment.houseDiscountTotal) },
        { Seccion: '1.5 Calculo interno', Concepto: 'RC EFECTIVO', Detalle: '', Total: getCashClosureRcDisplayValue(context.detailAccountingSummary) },
    ];

    return [
        { name: 'RC Contador', rows: summaryRows },
        ...(context.houseDiscountRows.length ? [{
            name: 'Descuentos casa',
            rows: context.houseDiscountRows.map((row, index) => ({
                Linea: index + 1,
                Descripcion: row.description || row.descripcion || 'Descuento de la casa',
                Total: safeNumber(row.amount || row.total),
            })),
        }] : []),
    ];
};

const ClosureInfoItem = ({ label, value }) => (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">{label}</div>
        <div className="mt-1 text-sm font-black text-slate-950">{value || '-'}</div>
    </div>
);

const DenominationCountEditor = ({ title, denominations, count = {}, currencyLabel, tone = 'slate', onChange }) => (
    <div>
        <div className={`mb-2 text-[10px] font-black uppercase tracking-[0.22em] ${tone === 'green' ? 'text-emerald-700' : 'text-slate-500'}`}>{title}</div>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {denominations.map((denomination) => (
                <label key={denomination} className={`rounded-2xl border p-3 ${tone === 'green' ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white'}`}>
                    <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${tone === 'green' ? 'text-emerald-700' : 'text-slate-400'}`}>{currencyLabel} {denomination}</span>
                    <input
                        className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm font-black outline-none ${tone === 'green' ? 'border-emerald-200 focus:border-emerald-500' : 'border-slate-200 focus:border-[#e30613]'}`}
                        type="number"
                        min="0"
                        step="1"
                        value={count?.[denomination] || ''}
                        onChange={(event) => onChange(denomination, event.target.value)}
                    />
                </label>
            ))}
        </div>
    </div>
);

const CashClosureEditModal = ({
    form,
    clients = [],
    saving = false,
    rcValue = 0,
    rcBlocked = false,
    onClose,
    onSave,
    onUndoConciliation,
    onFieldChange,
    onCashCountChange,
    onDollarCashCountChange,
    onPreCloseChange,
    onBankRowAdd,
    onBankRowRemove,
    onBankRowChange,
    onHouseDiscountAdd,
    onHouseDiscountRemove,
    onHouseDiscountChange,
}) => {
    if (!form) return null;
    const totals = calculateClosureEditTotals(form);

    return (
        <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm">
            <div className="w-full max-w-7xl overflow-hidden rounded-[2rem] border border-white/10 bg-white shadow-2xl">
                <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-950 px-5 py-4 text-white lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#ffc400]">Edicion protegida con PIN</div>
                        <h3 className="text-xl font-black">Editar cierre de caja</h3>
                        <p className="mt-1 text-sm font-semibold text-slate-300">
                            Puedes corregir conteos, POS, transferencias y notas. Deshacer conciliacion libera facturas y diferencias vinculadas.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={onUndoConciliation} disabled={saving} className="rounded-2xl border border-amber-300 bg-amber-400 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-amber-950 transition hover:bg-amber-300 disabled:opacity-60">
                            Deshacer conciliacion
                        </button>
                        <button
                            type="button"
                            onClick={onSave}
                            disabled={saving}
                            title={rcBlocked ? buildPositiveCashClosureRcMessage(rcValue) : undefined}
                            className={`rounded-2xl px-4 py-2 text-xs font-black uppercase tracking-[0.16em] transition disabled:opacity-60 ${rcBlocked ? 'border border-red-300 bg-red-50 text-red-800 hover:bg-red-100' : 'bg-[#e30613] text-white hover:bg-red-700'}`}
                        >
                            {saving ? 'Guardando...' : 'Guardar edicion'}
                        </button>
                        <button type="button" onClick={onClose} className="rounded-2xl bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-slate-950 transition hover:bg-slate-200">
                            Cerrar
                        </button>
                    </div>
                </div>

                <div className="space-y-5 p-5">
                    <div className="grid gap-4 lg:grid-cols-4">
                        <Field label="Fecha">
                            <input className={inputClass} type="date" value={form.date || ''} onChange={(event) => onFieldChange('date', event.target.value)} />
                        </Field>
                        <Field label="Cajero">
                            <select className={inputClass} value={form.cashierName || ''} onChange={(event) => onFieldChange('cashierName', event.target.value)}>
                                <option value="">Seleccionar cajero...</option>
                                {CASHIER_OPTIONS.map((name) => <option key={name} value={name}>{name}</option>)}
                            </select>
                        </Field>
                        <Field label="SICAR esperado">
                            <input className={inputClass} type="number" step="0.01" value={form.sicarExpected || ''} onChange={(event) => onFieldChange('sicarExpected', event.target.value)} />
                        </Field>
                        <Field label="Retenciones">
                            <input className={inputClass} type="number" step="0.01" value={form.retentionAdjustment || ''} onChange={(event) => onFieldChange('retentionAdjustment', event.target.value)} />
                        </Field>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-7">
                        <SummaryCard label="Ingresado app" value={fmt(totals.manualTotal)} tone="green" />
                        <SummaryCard label="App + retenciones" value={fmt(totals.manualTotalWithRetentions)} tone="amber" />
                        <SummaryCard label="SICAR esperado" value={fmt(totals.expectedAfterRetentions)} tone="blue" />
                        <SummaryCard label="Diferencia" value={fmt(totals.difference)} tone={Math.abs(totals.difference) > 0.01 ? 'red' : 'green'} />
                        <SummaryCard label="Efectivo total" value={fmt(totals.cashTotal)} />
                        <SummaryCard label="Estado sugerido" value={form.status === 'en_espera' ? 'En espera' : totals.shouldTrackDifference ? 'Con diferencia' : 'Cuadrado'} tone={form.status === 'en_espera' ? 'amber' : totals.shouldTrackDifference ? 'red' : 'green'} />
                        <SummaryCard label="RC" value={fmt(Math.abs(safeNumber(rcValue)))} tone={rcBlocked ? 'red' : 'green'} />
                    </div>

                    {rcBlocked && <CashClosureRcAlarm rc={rcValue} />}

                    <Section title="Efectivo y deposito pre-cierre" eyebrow="Conteo editable">
                        <div className="mb-4 grid gap-3 md:grid-cols-4">
                            <Field label="Deposito pre-cierre cordobas">
                                <input className={inputClass} type="number" step="0.01" min="0" value={form.preCloseDeposit?.cordobas || ''} onChange={(event) => onPreCloseChange('cordobas', event.target.value)} />
                            </Field>
                            <Field label="Deposito pre-cierre dolares">
                                <input className={inputClass} type="number" step="0.01" min="0" value={form.preCloseDeposit?.dollars || ''} onChange={(event) => onPreCloseChange('dollars', event.target.value)} />
                            </Field>
                            <SummaryCard label="Pre-cierre convertido" value={fmt(totals.preCloseDepositTotal)} tone="blue" />
                            <SummaryCard label="Dolares contado" value={`US$ ${totals.dollarCashTotal.toFixed(2)} / ${fmt(totals.dollarCashTotalCordobas)}`} tone="green" />
                        </div>
                        <DenominationCountEditor
                            title="Conteo en cordobas"
                            denominations={CASH_DENOMINATIONS}
                            count={form.cashCount}
                            currencyLabel="C$"
                            onChange={onCashCountChange}
                        />
                        <div className="mt-4">
                            <DenominationCountEditor
                                title="Conteo en dolares"
                                denominations={USD_DENOMINATIONS}
                                count={form.dollarCashCount}
                                currencyLabel="US$"
                                tone="green"
                                onChange={onDollarCashCountChange}
                            />
                        </div>
                    </Section>

                    <div className="grid gap-5 xl:grid-cols-2">
                        <Section title="Transferencias por cliente" eyebrow="Detalle bancario">
                            <div className="grid gap-4">
                                {TRANSFER_BANKS.map((bank) => (
                                    <DetailRows
                                        key={bank.key}
                                        title={`Transferencia ${bank.label} - ${fmt(totals.transferTotals[bank.key])}${bank.currency === 'USD' ? ` / TC ${TRANSFER_USD_EXCHANGE_RATE.toFixed(2)}` : ''}`}
                                        rows={form.transferDetails?.[bank.key] || []}
                                        type="transfer"
                                        clients={clients}
                                        currency={bank.currency || 'NIO'}
                                        exchangeRate={getTransferBankExchangeRate(bank)}
                                        onAdd={() => onBankRowAdd('transferDetails', bank.key)}
                                        onRemove={(index) => onBankRowRemove('transferDetails', bank.key, index)}
                                        onChange={(index, field, value) => onBankRowChange('transferDetails', bank.key, index, field, value)}
                                    />
                                ))}
                            </div>
                        </Section>

                        <Section title="POS por banco" eyebrow="Cierres de tarjeta">
                            <div className="grid gap-4">
                                {POS_BANKS.map((bank) => (
                                    <DetailRows
                                        key={bank.key}
                                        title={`POS ${bank.label} · ${fmt(totals.posTotals[bank.key])}`}
                                        rows={form.posDetails?.[bank.key] || []}
                                        type="pos"
                                        onAdd={() => onBankRowAdd('posDetails', bank.key)}
                                        onRemove={(index) => onBankRowRemove('posDetails', bank.key, index)}
                                        onChange={(index, field, value) => onBankRowChange('posDetails', bank.key, index, field, value)}
                                    />
                                ))}
                            </div>
                        </Section>
                    </div>

                    <Section title="Descuentos de la casa" eyebrow="Ajustes autorizados">
                        <DetailRows
                            title={`Descuentos de la casa - ${fmt(totals.houseDiscountTotal)}`}
                            rows={form.houseDiscountDetails || []}
                            type="discount"
                            onAdd={onHouseDiscountAdd}
                            onRemove={onHouseDiscountRemove}
                            onChange={onHouseDiscountChange}
                        />
                    </Section>

                    <Field label="Notas">
                        <textarea className={`${inputClass} min-h-[120px]`} value={form.notes || ''} onChange={(event) => onFieldChange('notes', event.target.value)} />
                    </Field>
                </div>
            </div>
        </div>
    );
};

const CashClosureDetailModal = ({ closure, onClose, onEdit, onExport, onPrintTicket, canEdit = true }) => {
    if (!closure) return null;

    const context = buildCashClosureReportContext(closure);
    const exchangeRate = context.exchangeRate;
    const cordobaRows = buildDenominationRows(closure.cashCount, CASH_DENOMINATIONS);
    const dollarRows = buildDenominationRows(closure.dollarCashCount, USD_DENOMINATIONS);
    const linkedInvoices = context.linkedInvoices;
    const linkedReceipts = context.linkedReceipts;
    const transferRows = context.transferRows;
    const posRows = context.posRows;
    const houseDiscountRows = context.houseDiscountRows;
    const transferTotal = context.transferTotal;
    const posTotal = context.posTotal;
    const houseDiscountTotal = context.houseDiscountTotal;
    const dollarTotal = dollarRows.reduce((sum, row) => safeNumber(sum + safeNumber(row.denomination * row.quantity)), 0);
    const status = context.status;
    const statusTone = status === 'con_diferencia' ? 'red' : status === 'en_espera' ? 'amber' : 'green';
    const sicar = context.sicar;
    const code = context.code;
    const cashboxName = context.cashboxName;
    const preClose = context.preClose;
    const detailAccountingSummary = context.detailAccountingSummary;

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6">
            <button
                type="button"
                aria-label="Cerrar detalle"
                className="absolute inset-0 bg-slate-950/65 backdrop-blur-sm"
                onClick={onClose}
            />
            <div className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-white/30 bg-white shadow-2xl shadow-slate-950/30">
                <div className="flex flex-col gap-4 border-b border-slate-200 bg-slate-950 px-5 py-5 text-white sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#ffc400]">Historial de cierre</div>
                        <h3 className="text-2xl font-black">Detalle de cierre de caja</h3>
                        <div className="mt-1 text-sm font-bold text-slate-300">
                            {closure.date || '-'} / {cashboxName} / Corte {code || '-'}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Badge tone={statusTone}>{String(status).replace(/_/g, ' ')}</Badge>
                        <button
                            type="button"
                            onClick={() => onExport?.(closure)}
                            className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-emerald-800 transition hover:bg-emerald-100"
                        >
                            Reporte RC XLS
                        </button>
                        {canEdit && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => onPrintTicket?.(closure)}
                                    className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-amber-800 transition hover:bg-amber-100"
                                >
                                    Ticket 80mm
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onEdit?.(closure)}
                                    className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:bg-white hover:text-slate-950"
                                >
                                    Editar
                                </button>
                            </>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:bg-white hover:text-slate-950"
                        >
                            Cerrar
                        </button>
                    </div>
                </div>

                <div className="overflow-y-auto p-5">
                    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-7">
                        <SummaryCard label="SICAR esperado" value={fmt(closure.sicarExpected)} tone="blue" />
                        <SummaryCard label="Retenciones" value={fmt(closure.retentionAdjustment)} tone="amber" />
                        <SummaryCard label="Ingresado app" value={fmt(closure.manualTotal)} tone="green" />
                        <SummaryCard label="App + retenciones" value={fmt(closure.manualTotalWithRetentions ?? getCashClosureManualTotalWithRetentions(closure.manualTotal, closure.retentionAdjustment))} tone="amber" />
                        <SummaryCard label="Diferencia" value={fmt(closure.difference)} tone={Math.abs(safeNumber(closure.difference)) > 0.01 ? 'red' : 'green'} />
                        <SummaryCard label="Efectivo total" value={fmt(closure.cashTotal)} tone="slate" />
                        <SummaryCard label="Pre-cierre" value={fmt(closure.preCloseDepositTotal)} tone="blue" />
                    </div>

                    <div className="mt-5">
                        <ClosureAccountingSummaryPanel summary={detailAccountingSummary} />
                    </div>

                    <div className="mt-5 grid gap-4 lg:grid-cols-3">
                        <ClosureInfoItem label="Fecha" value={closure.date} />
                        <ClosureInfoItem label="Caja" value={cashboxName} />
                        <ClosureInfoItem label="Cajero" value={closure.cashierName || 'Sin cajero'} />
                        <ClosureInfoItem label="Codigo cierre" value={code} />
                        <ClosureInfoItem label="RCC" value={closure.linkedSicarRccId || sicar.rccId || sicar.rcc_id} />
                        <ClosureInfoItem label="Tasa cambio" value={`C$ ${exchangeRate.toFixed(2)}`} />
                    </div>

                    <div className="mt-5 grid gap-4 xl:grid-cols-2">
                        <div className="rounded-3xl border border-slate-200 bg-white p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[#e30613]">Conteo efectivo</div>
                                    <div className="text-lg font-black text-slate-950">Cordobas</div>
                                </div>
                                <Badge tone="blue">{fmt(closure.cashCordobasTotal)}</Badge>
                            </div>
                            {cordobaRows.length ? (
                                <div className="grid gap-2 sm:grid-cols-2">
                                    {cordobaRows.map((row) => (
                                        <div key={row.denomination} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-sm">
                                            <span className="font-black text-slate-600">C$ {row.denomination} x {row.quantity}</span>
                                            <span className="font-mono font-black text-slate-950">{fmt(row.total)}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm font-bold text-slate-400">Sin desglose de cordobas.</div>
                            )}
                        </div>

                        <div className="rounded-3xl border border-emerald-200 bg-emerald-50/40 p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-700">Conteo efectivo</div>
                                    <div className="text-lg font-black text-slate-950">Dolares</div>
                                </div>
                                <Badge tone="green">US$ {dollarTotal.toFixed(2)}</Badge>
                            </div>
                            {dollarRows.length ? (
                                <div className="grid gap-2 sm:grid-cols-2">
                                    {dollarRows.map((row) => (
                                        <div key={row.denomination} className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 text-sm">
                                            <span className="font-black text-slate-600">US$ {row.denomination} x {row.quantity}</span>
                                            <span className="font-mono font-black text-slate-950">{fmt(row.total)}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="rounded-2xl border border-dashed border-emerald-300 p-6 text-center text-sm font-bold text-emerald-500">Sin desglose de dolares.</div>
                            )}
                            <div className="mt-3 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-700">
                                Convertido: {fmt(closure.dollarCashTotalCordobas || (dollarTotal * exchangeRate))}
                            </div>
                        </div>
                    </div>

                    <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                        <div className="mb-3 text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Deposito pre-cierre</div>
                        <div className="grid gap-3 md:grid-cols-3">
                            <SummaryCard label="Cordobas" value={fmt(preClose.cordobas)} />
                            <SummaryCard label="Dolares" value={`US$ ${safeNumber(preClose.dollars).toFixed(2)}`} tone="green" />
                            <SummaryCard label="Total convertido" value={fmt(preClose.totalCordobas || closure.preCloseDepositTotal)} tone="blue" />
                        </div>
                    </div>

                    <div className="mt-5 grid gap-4 xl:grid-cols-2">
                        <div className="rounded-3xl border border-slate-200 bg-white p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[#e30613]">Transferencias</div>
                                    <div className="text-lg font-black text-slate-950">Detalle por cliente</div>
                                </div>
                                <Badge tone="green">{fmt(transferTotal)}</Badge>
                            </div>
                            <div className="space-y-2">
                                {transferRows.length ? transferRows.map((row) => (
                                    <div key={row.id} className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm sm:grid-cols-[0.5fr_1.2fr_1fr_0.8fr]">
                                        <span className="font-black text-slate-950">{row.bank}</span>
                                        <span className="font-bold text-slate-600">{row.clientName || row.customerName || 'Sin cliente'}</span>
                                        <span className="font-bold text-slate-500">{row.reference || row.ref || 'Sin referencia'}</span>
                                        <span className="text-right font-mono font-black text-emerald-700">
                                            {row.currency === 'USD'
                                                ? `US$ ${safeNumber(row.amount ?? row.total ?? row.value).toFixed(2)} / ${fmt(row.amountCordobas)}`
                                                : fmt(row.amount || row.total)}
                                        </span>
                                    </div>
                                )) : (
                                    <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm font-bold text-slate-400">Sin transferencias registradas.</div>
                                )}
                            </div>
                        </div>

                        <div className="rounded-3xl border border-slate-200 bg-white p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[#e30613]">POS</div>
                                    <div className="text-lg font-black text-slate-950">Cierres de POS</div>
                                </div>
                                <Badge tone="blue">{fmt(posTotal)}</Badge>
                            </div>
                            <div className="space-y-2">
                                {posRows.length ? posRows.map((row) => (
                                    <div key={row.id} className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm sm:grid-cols-[0.5fr_1fr_0.8fr]">
                                        <span className="font-black text-slate-950">{row.bank}</span>
                                        <span className="font-bold text-slate-500">{row.reference || row.ref || 'Sin referencia'}</span>
                                        <span className="text-right font-mono font-black text-sky-700">{fmt(row.amount || row.total)}</span>
                                    </div>
                                )) : (
                                    <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm font-bold text-slate-400">Sin POS registrados.</div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="mt-5 rounded-3xl border border-amber-200 bg-amber-50/40 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-700">Descuentos de la casa</div>
                                <div className="text-lg font-black text-slate-950">Detalle autorizado</div>
                            </div>
                            <Badge tone="amber">{fmt(houseDiscountTotal)}</Badge>
                        </div>
                        <div className="space-y-2">
                            {houseDiscountRows.length ? houseDiscountRows.map((row) => (
                                <div key={row.id || row.localId} className="grid gap-2 rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm sm:grid-cols-[1.4fr_0.6fr]">
                                    <span className="font-bold text-slate-600">{row.description || row.descripcion || 'Descuento de la casa'}</span>
                                    <span className="text-right font-mono font-black text-amber-700">{fmt(row.amount || row.total)}</span>
                                </div>
                            )) : (
                                <div className="rounded-2xl border border-dashed border-amber-300 p-6 text-center text-sm font-bold text-amber-500">Sin descuentos de la casa registrados.</div>
                            )}
                        </div>
                    </div>

                    <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-4">
                        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[#e30613]">Facturas membretadas</div>
                                <div className="text-lg font-black text-slate-950">Vinculadas a este cierre</div>
                            </div>
                            <Badge tone="amber">{linkedInvoices.length} factura(s)</Badge>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-left text-sm">
                                <thead>
                                    <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                                        <th className="py-3 pr-4">Factura</th>
                                        <th className="py-3 pr-4">Fecha</th>
                                        <th className="py-3 pr-4">Cliente</th>
                                        <th className="py-3 pr-4">Metodo</th>
                                        <th className="py-3 pr-4 text-right">Subtotal</th>
                                        <th className="py-3 pr-4 text-right">IVA</th>
                                        <th className="py-3 pr-4 text-right">Retencion</th>
                                        <th className="py-3 text-right">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {linkedInvoices.map((invoice, index) => (
                                        <tr key={invoice.id || invoice.docId || `${invoice.invoiceNumber}-${index}`} className="border-b border-slate-100 last:border-b-0">
                                            <td className="py-3 pr-4 font-black text-slate-950">{invoice.invoiceNumber || invoice.numeroFactura || '-'}</td>
                                            <td className="py-3 pr-4 font-bold text-slate-600">{invoice.date || invoice.saleDate || '-'}</td>
                                            <td className="py-3 pr-4 font-bold text-slate-600">{invoice.customerName || invoice.cliente || '-'}</td>
                                            <td className="py-3 pr-4 font-bold text-slate-500">{invoice.paymentMethod || '-'}</td>
                                            <td className="py-3 pr-4 text-right font-mono font-black text-slate-900">{fmt(invoice.subtotal)}</td>
                                            <td className="py-3 pr-4 text-right font-mono font-black text-sky-700">{fmt(invoice.iva)}</td>
                                            <td className="py-3 pr-4 text-right font-mono font-black text-amber-700">{fmt(invoice.retentionTotal || (safeNumber(invoice.retentionIr2) + safeNumber(invoice.retentionMunicipal1)))}</td>
                                            <td className="py-3 text-right font-mono font-black text-emerald-700">{fmt(invoice.total)}</td>
                                        </tr>
                                    ))}
                                    {linkedInvoices.length === 0 && (
                                        <tr>
                                            <td className="py-10 text-center text-sm font-bold text-slate-400" colSpan="8">
                                                Este cierre no tiene facturas membretadas vinculadas.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="mt-5 rounded-3xl border border-amber-200 bg-amber-50/30 p-4">
                        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-700">Recibos de caja membretados</div>
                                <div className="text-lg font-black text-slate-950">Vinculados a este cierre</div>
                            </div>
                            <Badge tone="amber">{linkedReceipts.length} recibo(s)</Badge>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-left text-sm">
                                <thead>
                                    <tr className="border-b border-amber-200 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                                        <th className="py-3 pr-4">Recibo</th>
                                        <th className="py-3 pr-4">Fecha</th>
                                        <th className="py-3 pr-4">Cliente</th>
                                        <th className="py-3 pr-4">Metodo</th>
                                        <th className="py-3 pr-4">Concepto</th>
                                        <th className="py-3 pr-4 text-right">Ret. IR</th>
                                        <th className="py-3 text-right">Monto</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {linkedReceipts.map((receipt, index) => (
                                        <tr key={receipt.id || receipt.docId || `${receipt.receiptNumber}-${index}`} className="border-b border-amber-100 last:border-b-0">
                                            <td className="py-3 pr-4 font-black text-slate-950">{receipt.receiptNumber || '-'}</td>
                                            <td className="py-3 pr-4 font-bold text-slate-600">{receipt.date || '-'}</td>
                                            <td className="py-3 pr-4 font-bold text-slate-600">{receipt.customerName || '-'}</td>
                                            <td className="py-3 pr-4 font-bold text-slate-500">{receipt.paymentMethod || '-'}</td>
                                            <td className="py-3 pr-4 font-bold text-slate-500">{receipt.concept || '-'}</td>
                                            <td className="py-3 pr-4 text-right font-mono font-black text-amber-700">{fmt(getCashReceiptRetentionTotal(receipt))}</td>
                                            <td className="py-3 text-right font-mono font-black text-emerald-700">{fmt(receipt.amount)}</td>
                                        </tr>
                                    ))}
                                    {linkedReceipts.length === 0 && (
                                        <tr>
                                            <td className="py-10 text-center text-sm font-bold text-slate-400" colSpan="7">
                                                Este cierre no tiene recibos de caja membretados vinculados.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {closure.notes && (
                        <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Notas</div>
                            <div className="mt-2 whitespace-pre-wrap text-sm font-bold text-slate-700">{closure.notes}</div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

function CashClosureHistory({ data, canEdit = true, branchContext }) {
    const { user } = useAuth();
    const isMaster = isMasterEmail(user?.email);
    const canManageClosures = isMaster && canEdit;
    const canPrintClosureTicket = canManageClosures || !canEdit;
    const selectedBranchId = getActiveBillingBranchId(branchContext);
    const branchPayload = useMemo(() => getBranchPayload(selectedBranchId), [selectedBranchId]);
    const [search, setSearch] = useState('');
    const [selectedMonth, setSelectedMonth] = useState(getMonth(todayString()));
    const [selectedDate, setSelectedDate] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [page, setPage] = useState(1);
    const [detailClosure, setDetailClosure] = useState(null);
    const [editClosure, setEditClosure] = useState(null);
    const [editForm, setEditForm] = useState(null);
    const [editSaving, setEditSaving] = useState(false);
    const [ticketClosure, setTicketClosure] = useState(null);
    const [message, setMessage] = useState('');

    const closures = useMemo(() => (
        [...(data.cierres_caja || [])]
            .filter((closure) => isRecordInBillingBranch(closure, selectedBranchId))
            .map((closure) => {
                const totals = normalizeCashClosureStoredTotals(closure);
                return {
                    ...branchPayload,
                    ...closure,
                    date: closure.date || getRecordDate(closure.createdAt || closure.updatedAt),
                    invoiceCount: (closure.stampedInvoices || closure.stampedInvoiceDrafts || []).length,
                    cashboxName: closure.sicar?.cashboxName || closure.sicar?.cajaName || closure.cashboxName || closure.cajaName || 'Caja',
                    code: closure.linkedSicarCorId || closure.sicar?.corId || closure.sicar?.cor_id || closure.id,
                    manualTotal: totals.manualTotal,
                    manualTotalWithRetentions: totals.manualTotalWithRetentions,
                    sicarExpected: totals.sicarExpected,
                    expectedAfterRetentions: totals.expectedAfterRetentions,
                    cashTotal: safeNumber(closure.cashTotal),
                    difference: totals.difference,
                    retentionAdjustment: totals.retentionAdjustment,
                    status: totals.status,
                };
            })
            .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    ), [branchPayload, data.cierres_caja, selectedBranchId]);

    const clients = useMemo(() => (
        [...(data.clientes_facturacion || [])]
            .map((item) => ({ ...item, name: item.name || item.nombre || '' }))
            .filter((item) => item.name)
            .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    ), [data.clientes_facturacion]);

    const differencesByClosureId = useMemo(() => {
        const map = new Map();
        (data.diferencias_caja || [])
            .filter((item) => isRecordInBillingBranch(item, selectedBranchId))
            .forEach((item) => {
            const closureId = item.closureId || '';
            if (!closureId) return;
            const rows = map.get(closureId) || [];
            rows.push(item);
            map.set(closureId, rows);
        });
        return map;
    }, [data.diferencias_caja, selectedBranchId]);

    const searchedClosures = useMemo(() => filterRecords(closures, search, [
        'date',
        'code',
        'cashboxName',
        'cashierName',
        'status',
        'manualTotal',
        'difference',
    ]), [closures, search]);

    const filteredClosures = useMemo(() => (
        searchedClosures.filter((closure) => {
            const matchesDate = matchesHistoryDateFilters(closure.date, selectedMonth, selectedDate);
            const matchesStatus = !statusFilter || normalizeText(closure.status) === normalizeText(statusFilter);
            return matchesDate && matchesStatus;
        })
    ), [searchedClosures, selectedMonth, selectedDate, statusFilter]);

    const pagedClosures = useMemo(() => paginateRecords(filteredClosures, page), [filteredClosures, page]);

    const stats = useMemo(() => (
        filteredClosures.reduce((acc, closure) => {
            acc.manualTotal = safeNumber(acc.manualTotal + closure.manualTotal);
            acc.manualTotalWithRetentions = safeNumber(acc.manualTotalWithRetentions + (closure.manualTotalWithRetentions ?? getCashClosureManualTotalWithRetentions(closure.manualTotal, closure.retentionAdjustment)));
            acc.cashTotal = safeNumber(acc.cashTotal + closure.cashTotal);
            acc.difference = safeNumber(acc.difference + closure.difference);
            acc.retentionAdjustment = safeNumber(acc.retentionAdjustment + closure.retentionAdjustment);
            acc.invoiceCount += closure.invoiceCount;
            return acc;
        }, { manualTotal: 0, manualTotalWithRetentions: 0, cashTotal: 0, difference: 0, retentionAdjustment: 0, invoiceCount: 0 })
    ), [filteredClosures]);

    useEffect(() => {
        setPage(1);
    }, [search, selectedMonth, selectedDate, statusFilter]);

    useEffect(() => {
        if (page !== pagedClosures.page) setPage(pagedClosures.page);
    }, [page, pagedClosures.page]);

    const openEditClosure = (closure) => {
        if (!closure?.id) return;
        if (!canManageClosures) {
            setMessage('Este usuario solo tiene permiso para ver cierres de caja.');
            return;
        }
        if (!requestCashClosureEditPin('editar cierre de caja')) return;
        setDetailClosure(null);
        setEditClosure(closure);
        setEditForm(createCashClosureEditForm(closure));
        setMessage('');
    };

    const closeEditClosure = () => {
        setEditClosure(null);
        setEditForm(null);
    };

    const exportClosureRcReport = (closure) => {
        if (!closure?.id) return;
        const context = buildCashClosureReportContext(closure);
        const filename = `reporte-contador-rc-${closure.date || todayString()}-${slugify(context.code || closure.id || 'cierre')}.xls`;
        downloadClosureReportXls(filename, buildCashClosureRcReportSheets(closure));
        setMessage(`Reporte contador RC generado para el cierre ${context.code || closure.id}.`);
    };

    const reprintClosureTicket = (closure) => {
        if (!closure?.id) return;
        setTicketClosure(closure);
        window.setTimeout(printCashClosureTicket, 80);
    };

    const editAccountingSummary = useMemo(() => {
        if (!editForm || !editClosure) return null;
        const totals = calculateClosureEditTotals(editForm);
        return buildClosureAccountingSummary({
            cashSalesTotal: safeNumber(editForm.cashSalesTotal),
            creditSalesTotal: safeNumber(editForm.creditSalesTotal),
            creditRecoveryTotal: safeNumber(editForm.creditRecoveryTotal),
            stampedInvoices: getCashClosureInvoices(editClosure),
            cashReceipts: getCashClosureReceipts(editClosure),
            transferTotals: totals.transferTotals,
            posTotals: totals.posTotals,
            houseDiscountTotal: totals.houseDiscountTotal,
            cashCordobasTotal: totals.cashCordobasTotal,
            dollarCashTotalCordobas: totals.dollarCashTotalCordobas,
            preCloseDepositTotal: totals.preCloseDepositTotal,
        });
    }, [editForm, editClosure]);
    const editClosureRc = getCashClosureRcValue(editAccountingSummary);
    const isEditClosureRcPositive = editForm?.status !== 'en_espera' && isPositiveCashClosureRc(editClosureRc);

    const updateEditField = (key, value) => {
        setEditForm((prev) => {
            if (!prev) return prev;
            const next = { ...prev, [key]: value };
            if (key === 'cashierName') next.cashierCode = value ? `CAJ-${slugify(value)}` : '';
            return next;
        });
    };

    const updateCashCount = (denomination, value) => {
        setEditForm((prev) => prev ? ({
            ...prev,
            cashCount: { ...(prev.cashCount || {}), [denomination]: value },
        }) : prev);
    };

    const updateDollarCashCount = (denomination, value) => {
        setEditForm((prev) => prev ? ({
            ...prev,
            dollarCashCount: { ...(prev.dollarCashCount || {}), [denomination]: value },
        }) : prev);
    };

    const updatePreClose = (key, value) => {
        setEditForm((prev) => prev ? ({
            ...prev,
            preCloseDeposit: { ...(prev.preCloseDeposit || {}), [key]: value },
        }) : prev);
    };

    const addBankRow = (groupKey, bankKey) => {
        setEditForm((prev) => {
            if (!prev) return prev;
            const emptyRow = groupKey === 'transferDetails' ? emptyTransfer() : emptyPos();
            return {
                ...prev,
                [groupKey]: {
                    ...(prev[groupKey] || {}),
                    [bankKey]: [...(prev[groupKey]?.[bankKey] || []), emptyRow],
                },
            };
        });
    };

    const removeBankRow = (groupKey, bankKey, index) => {
        setEditForm((prev) => prev ? ({
            ...prev,
            [groupKey]: {
                ...(prev[groupKey] || {}),
                [bankKey]: (prev[groupKey]?.[bankKey] || []).filter((_, rowIndex) => rowIndex !== index),
            },
        }) : prev);
    };

    const updateBankRow = (groupKey, bankKey, index, field, value) => {
        setEditForm((prev) => {
            if (!prev) return prev;
            const rows = [...(prev[groupKey]?.[bankKey] || [])];
            rows[index] = { ...(rows[index] || {}), [field]: value };
            return {
                ...prev,
                [groupKey]: {
                    ...(prev[groupKey] || {}),
                    [bankKey]: rows,
                },
            };
        });
    };

    const addEditHouseDiscount = () => {
        setEditForm((prev) => prev ? ({
            ...prev,
            houseDiscountDetails: [...(prev.houseDiscountDetails || []), emptyHouseDiscount()],
        }) : prev);
    };

    const removeEditHouseDiscount = (index) => {
        setEditForm((prev) => prev ? ({
            ...prev,
            houseDiscountDetails: (prev.houseDiscountDetails || []).filter((_, rowIndex) => rowIndex !== index),
        }) : prev);
    };

    const updateEditHouseDiscount = (index, field, value) => {
        setEditForm((prev) => {
            if (!prev) return prev;
            const rows = [...(prev.houseDiscountDetails || [])];
            rows[index] = { ...(rows[index] || {}), [field]: value };
            return { ...prev, houseDiscountDetails: rows };
        });
    };

    const markClosureDifferencesVoided = (batch, closureId, reason = 'Edicion de cierre', skipIds = new Set()) => {
        (differencesByClosureId.get(closureId) || []).forEach((item) => {
            if (!item.id) return;
            if (skipIds.has(item.id)) return;
            batch.set(doc(db, 'diferencias_caja', item.id), {
                pendingAmount: 0,
                saldo: 0,
                status: 'anulado',
                voidReason: reason,
                voidedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            }, { merge: true });
        });
    };

    const saveEditedClosure = async () => {
        if (!editForm?.id) return;
        setMessage('');
        const totals = calculateClosureEditTotals(editForm);
        const cashierCode = editForm.cashierName ? `CAJ-${slugify(editForm.cashierName)}` : '';
        const nextStatus = editForm.status === 'en_espera'
            ? 'en_espera'
            : totals.shouldTrackDifference ? 'con_diferencia' : 'cuadrado';
        const linkedCashReceipts = getCashClosureReceipts(editClosure);
        const accountingSummary = buildClosureAccountingSummary({
            cashSalesTotal: safeNumber(editForm.cashSalesTotal),
            creditSalesTotal: safeNumber(editForm.creditSalesTotal),
            creditRecoveryTotal: safeNumber(editForm.creditRecoveryTotal),
            stampedInvoices: getCashClosureInvoices(editClosure),
            cashReceipts: linkedCashReceipts,
            transferTotals: totals.transferTotals,
            posTotals: totals.posTotals,
            houseDiscountTotal: totals.houseDiscountTotal,
            cashCordobasTotal: totals.cashCordobasTotal,
            dollarCashTotalCordobas: totals.dollarCashTotalCordobas,
            preCloseDepositTotal: totals.preCloseDepositTotal,
        });

        if (nextStatus !== 'en_espera') {
            try {
                assertCashClosureRcAllowed(accountingSummary);
            } catch (error) {
                setMessage(error?.message || CASH_CLOSURE_POSITIVE_RC_MESSAGE);
                return;
            }
        }

        setEditSaving(true);
        try {
            const batch = writeBatch(db);
            const nextDifferenceId = `${editForm.id}_${cashierCode}`;
            const editedClosureDate = editForm.date || todayString();

            batch.set(doc(db, 'cierres_caja', editForm.id), sanitizeFirestoreData({
                ...branchPayload,
                date: editedClosureDate,
                month: getMonth(editedClosureDate),
                status: nextStatus,
                cashierName: editForm.cashierName || '',
                cashierCode,
                linkedSicarClosureId: editForm.linkedSicarClosureId || '',
                linkedSicarCorId: editForm.linkedSicarCorId || null,
                linkedSicarRccId: editForm.linkedSicarRccId || null,
                sicar: editForm.sicar || null,
                sicarExpected: totals.sicarExpected,
                cashSalesTotal: safeNumber(editForm.cashSalesTotal),
                creditSalesTotal: safeNumber(editForm.creditSalesTotal),
                creditRecoveryTotal: safeNumber(editForm.creditRecoveryTotal),
                retentionAdjustment: totals.retentionAdjustment,
                expectedAfterRetentions: totals.expectedAfterRetentions,
                cashCount: editForm.cashCount || {},
                cashCordobasTotal: totals.cashCordobasTotal,
                dollarCashCount: editForm.dollarCashCount || {},
                dollarCashTotal: totals.dollarCashTotal,
                exchangeRate: CASH_CLOSURE_EXCHANGE_RATE,
                dollarCashTotalCordobas: totals.dollarCashTotalCordobas,
                preCloseDeposit: {
                    cordobas: totals.preCloseDepositCordobas,
                    dollars: totals.preCloseDepositDollars,
                    exchangeRate: CASH_CLOSURE_EXCHANGE_RATE,
                    totalCordobas: totals.preCloseDepositTotal,
                },
                preCloseDepositTotal: totals.preCloseDepositTotal,
                cashTotal: totals.cashTotal,
                transferDetails: editForm.transferDetails || {},
                transferTotals: totals.transferTotals,
                transferUsdExchangeRate: TRANSFER_USD_EXCHANGE_RATE,
                posDetails: editForm.posDetails || {},
                posTotals: totals.posTotals,
                houseDiscountDetails: normalizeHouseDiscountDetails(editForm.houseDiscountDetails),
                houseDiscountTotal: totals.houseDiscountTotal,
                manualTotal: totals.manualTotal,
                manualTotalWithRetentions: totals.manualTotalWithRetentions,
                difference: totals.difference,
                cashReceiptIds: linkedCashReceipts.map((receipt) => receipt.id || receipt.docId).filter(Boolean),
                cashReceipts: linkedCashReceipts,
                accountingSummary,
                notes: editForm.notes || '',
                editedWithPinAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            }), { merge: true });

            markClosureDifferencesVoided(
                batch,
                editForm.id,
                'Recalculado por edicion de cierre',
                nextStatus !== 'en_espera' && cashierCode && totals.shouldTrackDifference ? new Set([nextDifferenceId]) : new Set()
            );
            if (nextStatus !== 'en_espera' && cashierCode && totals.shouldTrackDifference) {
                const pendingAmount = Math.abs(totals.difference);
                batch.set(doc(db, 'diferencias_caja', nextDifferenceId), {
                    ...branchPayload,
                    closureId: editForm.id,
                    date: editForm.date || todayString(),
                    month: getMonth(editForm.date || todayString()),
                    cashierName: editForm.cashierName || '',
                    cashierCode,
                    amount: totals.difference,
                    pendingAmount,
                    saldo: pendingAmount,
                    paidAmount: 0,
                    differenceType: getCashDifferenceType(totals.difference),
                    threshold: CASH_DIFFERENCE_THRESHOLD,
                    status: 'pendiente',
                    source: 'cierre_caja',
                    recalculatedFromEdit: true,
                    updatedAt: serverTimestamp(),
                    createdAt: serverTimestamp(),
                }, { merge: true });
            }

            await batch.commit();
            setMessage('Cierre editado correctamente.');
            closeEditClosure();
        } catch (error) {
            console.error(error);
            setMessage(error?.message || 'No se pudo editar el cierre.');
        } finally {
            setEditSaving(false);
        }
    };

    const undoClosureConciliation = async () => {
        if (!editForm?.id || !editClosure) return;
        if (!requestCashClosureEditPin('deshacer conciliacion del cierre')) return;
        if (!window.confirm('Esto dejara el cierre en espera, liberara sus facturas y recibos membretados, y anulara la diferencia de caja vinculada. Deseas continuar?')) return;

        setEditSaving(true);
        setMessage('');
        try {
            const batch = writeBatch(db);
            const linkedInvoices = getCashClosureInvoices(editClosure);
            const linkedReceipts = getCashClosureReceipts(editClosure);
            const invoiceIds = [
                ...(Array.isArray(editClosure.stampedInvoiceIds) ? editClosure.stampedInvoiceIds : []),
                ...linkedInvoices.map((invoice) => invoice.id || invoice.docId).filter(Boolean),
            ];
            const receiptIds = [
                ...(Array.isArray(editClosure.cashReceiptIds) ? editClosure.cashReceiptIds : []),
                ...linkedReceipts.map((receipt) => receipt.id || receipt.docId).filter(Boolean),
            ];
            const uniqueInvoiceIds = [...new Set(invoiceIds.filter(Boolean))];
            const uniqueReceiptIds = [...new Set(receiptIds.filter(Boolean))];
            const draftInvoices = (Array.isArray(editClosure.stampedInvoiceDrafts) && editClosure.stampedInvoiceDrafts.length
                ? editClosure.stampedInvoiceDrafts
                : linkedInvoices
            ).map((invoice) => ({
                ...invoice,
                docId: invoice.docId || invoice.id || '',
                supportFiles: {},
            }));
            const draftReceipts = (Array.isArray(editClosure.cashReceiptDrafts) && editClosure.cashReceiptDrafts.length
                ? editClosure.cashReceiptDrafts
                : linkedReceipts
            ).map((receipt) => ({
                ...receipt,
                docId: receipt.docId || receipt.id || '',
            }));

            uniqueInvoiceIds.forEach((invoiceId) => {
                batch.set(doc(db, 'facturas_membretadas_ventas', invoiceId), {
                    status: 'active',
                    closureStatus: '',
                    cashClosureLinkStatus: '',
                    linkedCashClosureId: '',
                    linkedSicarClosureId: '',
                    linkedSicarCorId: null,
                    reconciledAt: null,
                    excludeFromCashClosure: false,
                    unlinkedFromCashClosureId: editForm.id,
                    unlinkedFromCashClosureAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                }, { merge: true });
            });

            uniqueReceiptIds.forEach((receiptId) => {
                batch.set(doc(db, 'recibos_caja_membretados', receiptId), {
                    status: 'active',
                    closureStatus: '',
                    linkedCashClosureId: '',
                    linkedSicarClosureId: '',
                    linkedSicarCorId: null,
                    reconciledAt: null,
                    unlinkedFromCashClosureId: editForm.id,
                    unlinkedFromCashClosureAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                }, { merge: true });
            });

            markClosureDifferencesVoided(batch, editForm.id, 'Conciliacion deshecha');
            batch.set(doc(db, 'cierres_caja', editForm.id), sanitizeFirestoreData({
                status: 'en_espera',
                stampedInvoiceIds: [],
                stampedInvoices: [],
                stampedInvoiceDrafts: draftInvoices,
                cashReceiptIds: [],
                cashReceipts: [],
                cashReceiptDrafts: draftReceipts,
                reconciledAt: null,
                conciliationUndoneAt: serverTimestamp(),
                conciliationUndoneWithPin: true,
                updatedAt: serverTimestamp(),
            }), { merge: true });

            await batch.commit();
            setMessage('Conciliacion deshecha. El cierre quedo en espera y los documentos membretados quedaron libres.');
            closeEditClosure();
        } catch (error) {
            console.error(error);
            setMessage(error?.message || 'No se pudo deshacer la conciliacion.');
        } finally {
            setEditSaving(false);
        }
    };

    return (
        <div className="space-y-5">
            <Section title="Historial de cierres de caja" eyebrow="Auditoria de caja" action={<Badge tone="blue">{filteredClosures.length} cierres</Badge>}>
                <div className="grid gap-3 lg:grid-cols-[1.4fr_0.5fr_0.5fr_0.7fr_auto]">
                    <SearchBox
                        value={search}
                        onChange={setSearch}
                        placeholder="Buscar por codigo, fecha, caja, cajero o estado..."
                        resultLabel={`${searchedClosures.length} encontrados`}
                    />
                    <Field label="Mes">
                        <input className={inputClass} type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} />
                    </Field>
                    <Field label="Dia especifico">
                        <input className={inputClass} type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
                    </Field>
                    <Field label="Estado">
                        <select className={inputClass} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                            <option value="">Todos</option>
                            <option value="cuadrado">Cuadrado</option>
                            <option value="con_diferencia">Con diferencia</option>
                            <option value="en_espera">En espera</option>
                        </select>
                    </Field>
                    <div className="flex items-end">
                        <button
                            type="button"
                            onClick={() => {
                                setSearch('');
                                setSelectedMonth('');
                                setSelectedDate('');
                                setStatusFilter('');
                            }}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-slate-600 transition hover:border-[#e30613] hover:text-[#e30613]"
                        >
                            Limpiar
                        </button>
                    </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                    <SummaryCard label="Cierres" value={filteredClosures.length} />
                    <SummaryCard label="Ingresado app" value={fmt(stats.manualTotal)} tone="green" />
                    <SummaryCard label="App + retenciones" value={fmt(stats.manualTotalWithRetentions)} tone="amber" />
                    <SummaryCard label="Efectivo contado" value={fmt(stats.cashTotal)} tone="blue" />
                    <SummaryCard label="Diferencia" value={fmt(stats.difference)} tone={Math.abs(stats.difference) > 0.01 ? 'red' : 'green'} />
                    <SummaryCard label="Retenciones" value={fmt(stats.retentionAdjustment)} tone="amber" />
                </div>
                {message && (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
                        {message}
                    </div>
                )}
            </Section>

            <Section title="Cierres registrados" eyebrow="Detalle">
                <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white">
                    <table className="min-w-full text-left text-sm">
                        <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                                <th className="px-4 py-3">Fecha</th>
                                <th className="px-4 py-3">Codigo</th>
                                <th className="px-4 py-3">Caja</th>
                                <th className="px-4 py-3">Cajero</th>
                                <th className="px-4 py-3">Estado</th>
                                <th className="px-4 py-3 text-right">Facturas</th>
                                <th className="px-4 py-3 text-right">App + ret.</th>
                                <th className="px-4 py-3 text-right">Diferencia</th>
                                <th className="px-4 py-3 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pagedClosures.records.map((closure) => (
                                <tr key={closure.id} className="border-b border-slate-100 last:border-b-0">
                                    <td className="px-4 py-3 font-bold text-slate-700">{closure.date || '-'}</td>
                                    <td className="px-4 py-3 font-black text-slate-950">{closure.code || '-'}</td>
                                    <td className="px-4 py-3 font-bold text-slate-600">{closure.cashboxName}</td>
                                    <td className="px-4 py-3 font-bold text-slate-600">{closure.cashierName || 'Sin cajero'}</td>
                                    <td className="px-4 py-3">
                                        <Badge tone={closure.status === 'con_diferencia' ? 'red' : closure.status === 'en_espera' ? 'amber' : 'green'}>
                                            {String(closure.status || 'cerrado').replace(/_/g, ' ')}
                                        </Badge>
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono font-black text-slate-900">{closure.invoiceCount}</td>
                                    <td className="px-4 py-3 text-right font-mono font-black text-emerald-700">{fmt(closure.manualTotalWithRetentions ?? getCashClosureManualTotalWithRetentions(closure.manualTotal, closure.retentionAdjustment))}</td>
                                    <td className={`px-4 py-3 text-right font-mono font-black ${Math.abs(closure.difference) > 0.01 ? 'text-red-700' : 'text-emerald-700'}`}>{fmt(closure.difference)}</td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="flex justify-end gap-2">
                                            {canManageClosures && (
                                                <button
                                                    type="button"
                                                    onClick={() => setDetailClosure(closure)}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-700 transition hover:border-[#e30613] hover:bg-red-50 hover:text-[#e30613]"
                                                >
                                                    Ver
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => exportClosureRcReport(closure)}
                                                className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-800 transition hover:bg-emerald-100"
                                            >
                                                RC XLS
                                            </button>
                                            {canPrintClosureTicket && (
                                                <button
                                                    type="button"
                                                    onClick={() => reprintClosureTicket(closure)}
                                                    className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-amber-800 transition hover:bg-amber-100"
                                                >
                                                    Ticket
                                                </button>
                                            )}
                                            {canManageClosures && (
                                                <button
                                                    type="button"
                                                    onClick={() => openEditClosure(closure)}
                                                    className="rounded-xl bg-slate-950 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white transition hover:bg-[#e30613]"
                                                >
                                                    Editar
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {pagedClosures.records.length === 0 && (
                                <tr>
                                    <td className="px-4 py-10 text-center text-sm font-bold text-slate-400" colSpan="9">
                                        No hay cierres que coincidan con los filtros.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="mt-4">
                    <PaginationControls
                        page={pagedClosures.page}
                        totalPages={pagedClosures.totalPages}
                        total={filteredClosures.length}
                        start={pagedClosures.start}
                        end={pagedClosures.end}
                        onPageChange={setPage}
                    />
                </div>
            </Section>
            <CashClosureDetailModal
                closure={detailClosure}
                onClose={() => setDetailClosure(null)}
                onEdit={openEditClosure}
                onExport={exportClosureRcReport}
                onPrintTicket={reprintClosureTicket}
                canEdit={canManageClosures}
            />
            <CashClosureTicketPrint closure={ticketClosure} />
            {canManageClosures && (
                <CashClosureEditModal
                    form={editForm}
                    clients={clients}
                    saving={editSaving}
                    rcValue={editClosureRc}
                    rcBlocked={isEditClosureRcPositive}
                    onClose={closeEditClosure}
                    onSave={saveEditedClosure}
                    onUndoConciliation={undoClosureConciliation}
                    onFieldChange={updateEditField}
                    onCashCountChange={updateCashCount}
                    onDollarCashCountChange={updateDollarCashCount}
                    onPreCloseChange={updatePreClose}
                    onBankRowAdd={addBankRow}
                    onBankRowRemove={removeBankRow}
                    onBankRowChange={updateBankRow}
                    onHouseDiscountAdd={addEditHouseDiscount}
                    onHouseDiscountRemove={removeEditHouseDiscount}
                    onHouseDiscountChange={updateEditHouseDiscount}
                />
            )}
        </div>
    );
}

function RetentionHistory({ data, type, branchContext }) {
    const selectedBranchId = getActiveBillingBranchId(branchContext);
    const [search, setSearch] = useState('');
    const [selectedMonth, setSelectedMonth] = useState(getMonth(todayString()));
    const [selectedDate, setSelectedDate] = useState('');
    const [page, setPage] = useState(1);
    const isMunicipal = type === 'municipal';
    const amountField = isMunicipal ? 'retentionMunicipal1' : 'retentionIr2';
    const title = isMunicipal ? 'Retencion Municipal' : 'Anticipo de IR';
    const eyebrow = isMunicipal ? '1% vinculado a facturas' : '2% vinculado a facturas';

    const closureIndex = useMemo(() => {
        const map = new Map();
        (data.cierres_caja || [])
            .filter((closure) => isRecordInBillingBranch(closure, selectedBranchId))
            .forEach((closure) => {
            if (closure.id) map.set(closure.id, closure);
        });
        return map;
    }, [data.cierres_caja, selectedBranchId]);

    const retentions = useMemo(() => (
        [...(data.facturas_membretadas_ventas || [])]
            .map(normalizeStampedInvoiceRecord)
            .filter((invoice) => isRecordInBillingBranch(invoice, selectedBranchId))
            .map((invoice) => ({
                ...invoice,
                retentionAmount: safeNumber(invoice[amountField]),
                closureInfo: getInvoiceClosureInfo(invoice, closureIndex),
            }))
            .filter((invoice) => invoice.retentionAmount > 0)
            .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    ), [amountField, closureIndex, data.facturas_membretadas_ventas, selectedBranchId]);

    const searchedRetentions = useMemo(() => filterRecords(retentions, search, [
        'date',
        'invoiceNumber',
        'numeroFactura',
        'customerName',
        'cliente',
        'paymentMethod',
        (invoice) => invoice.closureInfo?.label,
    ]), [retentions, search]);

    const filteredRetentions = useMemo(() => (
        searchedRetentions.filter((invoice) => matchesHistoryDateFilters(invoice.date, selectedMonth, selectedDate))
    ), [searchedRetentions, selectedMonth, selectedDate]);

    const pagedRetentions = useMemo(() => paginateRecords(filteredRetentions, page), [filteredRetentions, page]);
    const totalRetention = useMemo(() => (
        filteredRetentions.reduce((sum, invoice) => safeNumber(sum + invoice.retentionAmount), 0)
    ), [filteredRetentions]);

    useEffect(() => {
        setPage(1);
    }, [search, selectedMonth, selectedDate]);

    useEffect(() => {
        if (page !== pagedRetentions.page) setPage(pagedRetentions.page);
    }, [page, pagedRetentions.page]);

    return (
        <div className="space-y-5">
            <Section title={title} eyebrow={eyebrow} action={<Badge tone="amber">No editable</Badge>}>
                <div className="grid gap-3 md:grid-cols-[1fr_0.35fr_0.35fr_auto]">
                    <SearchBox
                        value={search}
                        onChange={setSearch}
                        placeholder="Buscar por factura, cliente, metodo o cierre..."
                        resultLabel={`${searchedRetentions.length} encontrados`}
                    />
                    <Field label="Mes">
                        <input className={inputClass} type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} />
                    </Field>
                    <Field label="Dia especifico">
                        <input className={inputClass} type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
                    </Field>
                    <div className="flex items-end">
                        <button
                            type="button"
                            onClick={() => {
                                setSearch('');
                                setSelectedMonth('');
                                setSelectedDate('');
                            }}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-slate-600 transition hover:border-[#e30613] hover:text-[#e30613]"
                        >
                            Limpiar
                        </button>
                    </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-3">
                    <SummaryCard label="Registros" value={filteredRetentions.length} />
                    <SummaryCard label="Total retencion" value={fmt(totalRetention)} tone="amber" />
                    <SummaryCard label="Origen" value="Facturas membretadas" tone="blue" />
                </div>
            </Section>

            <Section title={`Detalle ${title}`} eyebrow="Fiscal">
                <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white">
                    <table className="min-w-full text-left text-sm">
                        <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                                <th className="px-4 py-3">Fecha</th>
                                <th className="px-4 py-3">Factura</th>
                                <th className="px-4 py-3">Cliente</th>
                                <th className="px-4 py-3">Metodo</th>
                                <th className="px-4 py-3">Cierre vinculado</th>
                                <th className="px-4 py-3 text-right">Monto</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pagedRetentions.records.map((invoice) => (
                                <tr key={`${invoice.id || invoice.invoiceNumber}-${amountField}`} className="border-b border-slate-100 last:border-b-0">
                                    <td className="px-4 py-3 font-bold text-slate-700">{invoice.date || '-'}</td>
                                    <td className="px-4 py-3 font-black text-slate-950">{invoice.invoiceNumber || '-'}</td>
                                    <td className="px-4 py-3 font-bold text-slate-600">{invoice.customerName || 'Sin cliente'}</td>
                                    <td className="px-4 py-3 font-bold text-slate-600">{invoice.paymentMethod || '-'}</td>
                                    <td className="px-4 py-3 font-bold text-slate-600">{invoice.closureInfo?.label || 'Pendiente'}</td>
                                    <td className="px-4 py-3 text-right font-mono font-black text-amber-700">{fmt(invoice.retentionAmount)}</td>
                                </tr>
                            ))}
                            {pagedRetentions.records.length === 0 && (
                                <tr>
                                    <td className="px-4 py-10 text-center text-sm font-bold text-slate-400" colSpan="6">
                                        No hay retenciones para este filtro.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="mt-4">
                    <PaginationControls
                        page={pagedRetentions.page}
                        totalPages={pagedRetentions.totalPages}
                        total={filteredRetentions.length}
                        start={pagedRetentions.start}
                        end={pagedRetentions.end}
                        onPageChange={setPage}
                    />
                </div>
            </Section>
        </div>
    );
}

function BillingHistory({ data, canEdit = true, branchContext }) {
    const [activeHistoryTab, setActiveHistoryTab] = useState('membretadas');
    const historyTabs = useMemo(() => [
        { key: 'membretadas', label: 'Facturas Membretadas' },
        { key: 'recibos', label: 'Recibos de Caja' },
        { key: 'cierres', label: 'Cierres de caja' },
        ...(canEdit ? [{ key: 'diferencias', label: 'Diferencias de caja' }] : []),
        { key: 'municipal', label: 'Municipal' },
        { key: 'ir', label: 'Anticipo de IR' },
    ], [canEdit]);

    useEffect(() => {
        if (!historyTabs.some((tab) => tab.key === activeHistoryTab)) {
            setActiveHistoryTab('membretadas');
        }
    }, [activeHistoryTab, historyTabs]);

    return (
        <div className="space-y-5">
            <Section title="Historial" eyebrow="Facturacion y retenciones" action={<Badge tone="blue">Auditoria</Badge>}>
                <div className="flex flex-wrap gap-2">
                    {historyTabs.map((tab) => (
                        <button
                            key={tab.key}
                            type="button"
                            onClick={() => setActiveHistoryTab(tab.key)}
                            className={`rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-[0.16em] transition ${activeHistoryTab === tab.key
                                ? 'bg-[#e30613] text-white shadow-lg shadow-red-900/15'
                                : 'border border-slate-200 bg-white text-slate-600 hover:border-[#e30613] hover:text-[#e30613]'}`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </Section>

            {activeHistoryTab === 'membretadas' && <StampedInvoiceHistory data={data} canEdit={canEdit} branchContext={branchContext} />}
            {activeHistoryTab === 'recibos' && <CashReceiptHistory data={data} canEdit={canEdit} branchContext={branchContext} />}
            {activeHistoryTab === 'cierres' && <CashClosureHistory data={data} canEdit={canEdit} branchContext={branchContext} />}
            {activeHistoryTab === 'diferencias' && <CashDifferences data={data} branchContext={branchContext} />}
            {activeHistoryTab === 'municipal' && <RetentionHistory data={data} type="municipal" branchContext={branchContext} />}
            {activeHistoryTab === 'ir' && <RetentionHistory data={data} type="ir" branchContext={branchContext} />}
        </div>
    );
}

function AccountingRegister({ data, branchContext }) {
    const [activeRegisterTab, setActiveRegisterTab] = useState('membretadas');
    const registerTabs = [
        { key: 'membretadas', label: 'Facturas membretadas' },
        { key: 'recibos', label: 'Recibo de Caja' },
    ];

    return (
        <div className="space-y-5">
            <Section title="Registro Contables" eyebrow="Documentos oficiales" action={<Badge tone="green">Membretados</Badge>}>
                <div className="flex flex-wrap gap-2">
                    {registerTabs.map((tab) => (
                        <button
                            key={tab.key}
                            type="button"
                            onClick={() => setActiveRegisterTab(tab.key)}
                            className={`rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-[0.16em] transition ${activeRegisterTab === tab.key
                                ? 'bg-[#e30613] text-white shadow-lg shadow-red-900/15'
                                : 'border border-slate-200 bg-white text-slate-600 hover:border-[#e30613] hover:text-[#e30613]'}`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </Section>

            {activeRegisterTab === 'membretadas' && <StampedInvoices data={data} branchContext={branchContext} />}
            {activeRegisterTab === 'recibos' && <CashReceipts data={data} branchContext={branchContext} />}
        </div>
    );
}

const getBankDepositAccount = (accountNumber = '', currency = 'NIO') => {
    const accounts = currency === 'USD' ? BANK_DEPOSIT_USD_ACCOUNTS : BANK_DEPOSIT_NIO_ACCOUNTS;
    return accounts.find((account) => account.accountNumber === accountNumber) || accounts[0] || {};
};

const buildBankDepositAccountPayload = (accountNumber = '', currency = 'NIO') => {
    const account = getBankDepositAccount(accountNumber, currency);
    return {
        accountNumber: account.accountNumber || accountNumber || '',
        bank: account.bank || '',
        holder: account.holder || BANK_DEPOSIT_OWNER,
        label: account.label || `${account.bank || 'Banco'} ${account.accountNumber || accountNumber || ''}`.trim(),
        currency,
    };
};

const getBankDepositClosureCode = (closure = {}) => (
    getCashClosureCodeValue(closure) || closure.code || closure.id || ''
);

const getBankDepositClosureLabel = (closure = {}) => {
    const code = getBankDepositClosureCode(closure);
    const date = closure.date || getRecordDate(closure.createdAt || closure.updatedAt);
    return [code ? `Cierre ${code}` : 'Cierre sin codigo', date].filter(Boolean).join(' - ');
};

const getClosureCashForBankDeposit = (closure = {}) => {
    const context = buildCashClosureReportContext(closure);
    const payment = context.detailAccountingSummary?.paymentBreakdown || {};
    const exchangeRate = safeNumber(context.exchangeRate) || CASH_CLOSURE_EXCHANGE_RATE;
    const preClose = closure.preCloseDeposit || {};
    const cashCordobasBase = hasNumericValue(closure.cashCordobasTotal)
        ? safeNumber(closure.cashCordobasTotal)
        : safeNumber(payment.cashCordobas);
    const preCloseCordobas = safeNumber(preClose.cordobas);
    const cashDollarsBase = hasNumericValue(closure.dollarCashTotal)
        ? safeNumber(closure.dollarCashTotal)
        : safeNumber(closure.dollarCashTotalCordobas) / exchangeRate;
    const preCloseDollars = safeNumber(preClose.dollars);
    const rcValue = getCashClosureRcDisplayValue(context.detailAccountingSummary || closure.accountingSummary || {});

    return {
        closureId: closure.id || '',
        code: getBankDepositClosureCode(closure),
        label: getBankDepositClosureLabel(closure),
        date: closure.date || getRecordDate(closure.createdAt || closure.updatedAt),
        cashierName: closure.cashierName || '',
        cashCordobas: safeNumber(cashCordobasBase + preCloseCordobas),
        cashDollars: safeNumber(cashDollarsBase + preCloseDollars),
        exchangeRate,
        rcValue,
    };
};

const calculateBankDepositAllocation = (closures = []) => {
    const closureSummaries = closures.map(getClosureCashForBankDeposit).filter((item) => item.closureId);
    const cashCordobas = safeNumber(closureSummaries.reduce((sum, item) => sum + item.cashCordobas, 0));
    const cashDollars = safeNumber(closureSummaries.reduce((sum, item) => sum + item.cashDollars, 0));
    const rcRequested = safeNumber(closureSummaries.reduce((sum, item) => sum + item.rcValue, 0));
    const exchangeRate = CASH_CLOSURE_EXCHANGE_RATE;
    const cashDollarsCordobas = safeNumber(cashDollars * exchangeRate);
    const cashEquivalentTotal = safeNumber(cashCordobas + cashDollarsCordobas);
    const rcTarget = safeNumber(Math.min(rcRequested, cashEquivalentTotal));
    const efectivo2Target = safeNumber(Math.max(cashEquivalentTotal - rcTarget, 0));
    const efectivo2UsdCordobas = safeNumber(Math.min(cashDollarsCordobas, efectivo2Target));
    const efectivo2Usd = safeNumber(efectivo2UsdCordobas / exchangeRate);
    const efectivo2Cordobas = safeNumber(Math.max(efectivo2Target - efectivo2UsdCordobas, 0));
    const remainingUsdCordobas = safeNumber(Math.max(cashDollarsCordobas - efectivo2UsdCordobas, 0));
    const efectivoRcUsdCordobas = safeNumber(Math.min(remainingUsdCordobas, rcTarget));
    const efectivoRcUsd = safeNumber(efectivoRcUsdCordobas / exchangeRate);
    const efectivoRcCordobas = safeNumber(Math.max(rcTarget - efectivoRcUsdCordobas, 0));

    return {
        closureSummaries,
        closureIds: closureSummaries.map((item) => item.closureId),
        closureCodes: closureSummaries.map((item) => item.code).filter(Boolean),
        concept: closureSummaries.map((item) => item.label).join(', '),
        cashCordobas,
        cashDollars,
        cashDollarsCordobas,
        cashEquivalentTotal,
        rcRequested,
        rcTarget,
        efectivo2Target,
        efectivoRcCordobas,
        efectivoRcUsd,
        efectivoRcUsdCordobas,
        efectivo2Cordobas,
        efectivo2Usd,
        efectivo2UsdCordobas,
        exchangeRate,
    };
};

const roundBankDepositAmount = (value = 0) => Math.round(safeNumber(value));

const roundBankDepositRow = (row = {}) => {
    if (row.currency === 'USD') {
        const roundedUsd = roundBankDepositAmount(row.amount);
        const exchangeRate = safeNumber(row.exchangeRate) || CASH_CLOSURE_EXCHANGE_RATE;
        return {
            ...row,
            amount: roundedUsd,
            amountCordobas: safeNumber(roundedUsd * exchangeRate),
            roundedDeposit: true,
        };
    }

    const roundedNio = roundBankDepositAmount(row.amountCordobas);
    return {
        ...row,
        amount: roundedNio,
        amountCordobas: roundedNio,
        roundedDeposit: true,
    };
};

const buildBankDepositDetails = (allocation = {}, accounts = {}) => {
    const rows = [
        {
            id: 'efectivo_rc_nio',
            type: 'efectivo_rc',
            label: 'Efectivo RC C$',
            currency: 'NIO',
            amount: safeNumber(allocation.efectivoRcCordobas),
            amountCordobas: safeNumber(allocation.efectivoRcCordobas),
            account: buildBankDepositAccountPayload(accounts.efectivoRcNio, 'NIO'),
        },
        {
            id: 'efectivo2_nio',
            type: 'efectivo_2',
            label: 'Efectivo (2) C$',
            currency: 'NIO',
            amount: safeNumber(allocation.efectivo2Cordobas),
            amountCordobas: safeNumber(allocation.efectivo2Cordobas),
            account: buildBankDepositAccountPayload(accounts.efectivo2Nio || BANK_DEPOSIT_DEFAULT_NIO_ACCOUNT, 'NIO'),
        },
        {
            id: 'efectivo2_usd',
            type: 'efectivo_2_usd',
            label: 'Efectivo (2) USD',
            currency: 'USD',
            amount: safeNumber(allocation.efectivo2Usd),
            amountCordobas: safeNumber(allocation.efectivo2UsdCordobas),
            exchangeRate: allocation.exchangeRate || CASH_CLOSURE_EXCHANGE_RATE,
            account: buildBankDepositAccountPayload(accounts.efectivo2Usd || BANK_DEPOSIT_DEFAULT_USD_ACCOUNT, 'USD'),
        },
        {
            id: 'efectivo_rc_usd',
            type: 'efectivo_rc_usd',
            label: 'Efectivo RC USD',
            currency: 'USD',
            amount: safeNumber(allocation.efectivoRcUsd),
            amountCordobas: safeNumber(allocation.efectivoRcUsdCordobas),
            exchangeRate: allocation.exchangeRate || CASH_CLOSURE_EXCHANGE_RATE,
            account: buildBankDepositAccountPayload(accounts.efectivoRcUsd, 'USD'),
        },
    ];

    return rows
        .map(roundBankDepositRow)
        .filter((row) => row.amount > 0 || row.amountCordobas > 0)
        .map((row) => ({
            ...row,
            concept: allocation.concept || 'Cierres de caja',
            status: 'pendiente_confirmacion',
        }));
};

const formatBankDepositAmount = (detail = {}) => (
    detail.currency === 'USD'
        ? `US$ ${safeNumber(detail.amount).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / ${fmt(detail.amountCordobas)}`
        : fmt(detail.amountCordobas)
);

const isBankDepositDetailConfirmed = (detail = {}) => normalizeText(detail.status) === 'CONFIRMADO';

const isBankDepositConfirmed = (deposit = {}) => (
    normalizeText(deposit.status) === 'CONFIRMADO'
    || ((deposit.depositDetails || []).length > 0 && (deposit.depositDetails || []).every(isBankDepositDetailConfirmed))
);

const getBankDepositPendingDetails = (deposit = {}) => (
    (deposit.depositDetails || []).filter((detail) => !isBankDepositDetailConfirmed(detail))
);

const getBankDepositSupportUrl = (detail = {}) => (
    detail.minuteSupport?.url || detail.support?.url || detail.minutaUrl || ''
);

const isBankDepositSupportImage = (detail = {}) => {
    const contentType = String(detail.minuteSupport?.contentType || detail.support?.contentType || '').toLowerCase();
    const url = String(getBankDepositSupportUrl(detail) || '').toLowerCase();
    return contentType.startsWith('image/') || /\.(png|jpe?g|webp|gif)(\?|$)/.test(url);
};

const printBankDepositDetails = () => {
    document.body.classList.add('print-bank-deposit-details');
    const cleanup = () => {
        document.body.classList.remove('print-bank-deposit-details');
        window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.setTimeout(() => {
        window.print();
        window.setTimeout(cleanup, 1000);
    }, 60);
};

const BankDepositPrintArea = ({ deposit }) => {
    if (!deposit) return null;
    const details = deposit.depositDetails || [];

    return (
        <>
            <div className="bank-deposit-print-area">
                {details.map((detail) => (
                    <div className="bank-deposit-ticket" key={detail.id}>
                        <div className="ticket-title">Detalle de deposito</div>
                        <div className="ticket-row ticket-holder">{BANK_DEPOSIT_OWNER}</div>
                        <div className="ticket-line">
                            <span>Cuenta a depositar:</span>
                            <strong>{detail.account?.label || detail.account?.accountNumber || '-'}</strong>
                        </div>
                        <div className="ticket-line">
                            <span>Monto:</span>
                            <strong>{formatBankDepositAmount(detail)}</strong>
                        </div>
                        <div className="ticket-line ticket-concept">
                            <span>Concepto:</span>
                            <strong>{detail.concept || deposit.concept || '-'}</strong>
                        </div>
                    </div>
                ))}
            </div>
            <style>{`
                .bank-deposit-print-area { display: none; }
                @media print {
                    body.print-bank-deposit-details * { visibility: hidden !important; }
                    body.print-bank-deposit-details .bank-deposit-print-area,
                    body.print-bank-deposit-details .bank-deposit-print-area * { visibility: visible !important; }
                    body.print-bank-deposit-details .bank-deposit-print-area {
                        display: block !important;
                        position: fixed;
                        inset: 0 auto auto 0;
                        width: 80mm;
                        background: #fff;
                        color: #000;
                        font-family: Arial, Helvetica, sans-serif;
                    }
                    body.print-bank-deposit-details .bank-deposit-ticket {
                        width: 74mm;
                        min-height: 55mm;
                        padding: 4mm 3mm;
                        page-break-after: always;
                        font-size: 12px;
                        line-height: 1.35;
                    }
                    body.print-bank-deposit-details .ticket-title {
                        border-bottom: 1px dashed #000;
                        margin-bottom: 6px;
                        padding-bottom: 5px;
                        text-align: center;
                        text-transform: uppercase;
                    }
                    body.print-bank-deposit-details .ticket-row {
                        padding: 4px 0;
                        text-align: center;
                    }
                    body.print-bank-deposit-details .ticket-holder {
                        font-size: 13px;
                        font-weight: 700;
                    }
                    body.print-bank-deposit-details .ticket-line {
                        border-top: 1px dashed #000;
                        display: grid;
                        gap: 3px;
                        padding: 6px 0;
                    }
                    body.print-bank-deposit-details .ticket-line span {
                        text-transform: uppercase;
                    }
                    body.print-bank-deposit-details .ticket-line strong {
                        font-weight: 400;
                    }
                    body.print-bank-deposit-details .ticket-concept strong {
                        text-align: left;
                    }
                }
            `}</style>
        </>
    );
};

const BankDepositHistoryModal = ({ deposit, onClose, onPrint }) => {
    if (!deposit) return null;
    const details = deposit.depositDetails || [];

    return (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-3 sm:p-6">
            <button
                type="button"
                aria-label="Cerrar historial de deposito"
                className="absolute inset-0 bg-slate-950/65 backdrop-blur-sm"
                onClick={onClose}
            />
            <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-white/30 bg-white shadow-2xl shadow-slate-950/30">
                <div className="flex flex-col gap-4 border-b border-slate-200 bg-slate-950 px-5 py-5 text-white sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#ffc400]">Historial de deposito</div>
                        <h3 className="text-2xl font-black">{deposit.closureCodes?.length ? `Cierres ${deposit.closureCodes.join(', ')}` : 'Deposito bancario'}</h3>
                        <div className="mt-1 text-sm font-bold text-slate-300">
                            {deposit.date || '-'} / {fmt(deposit.totalCordobas)} / {details.length} detalle(s)
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => onPrint?.(deposit)}
                            className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-amber-800 transition hover:bg-amber-100"
                        >
                            Reimprimir
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:bg-white hover:text-slate-950"
                        >
                            Cerrar
                        </button>
                    </div>
                </div>

                <div className="overflow-y-auto p-5">
                    <div className="grid gap-3 md:grid-cols-3">
                        <SummaryCard label="Fecha" value={deposit.date || '-'} tone="blue" />
                        <SummaryCard label="Total depositado" value={fmt(deposit.totalCordobas)} tone="green" />
                        <SummaryCard label="Estado" value={String(deposit.status || '').replace(/_/g, ' ') || 'Confirmado'} tone="green" />
                    </div>

                    <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
                        <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Concepto</div>
                        <div className="mt-1 text-sm font-bold text-slate-700">{deposit.concept || '-'}</div>
                    </div>

                    <div className="mt-5 space-y-4">
                        {details.map((detail) => {
                            const supportUrl = getBankDepositSupportUrl(detail);
                            const isImage = isBankDepositSupportImage(detail);
                            return (
                                <div key={detail.id} className="rounded-[1.8rem] border border-slate-200 bg-white p-4 shadow-sm">
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[#e30613]">{detail.label}</div>
                                            <div className="mt-1 font-mono text-2xl font-black text-slate-950">{formatBankDepositAmount(detail)}</div>
                                            <div className="mt-1 text-xs font-bold text-slate-500">{detail.account?.label || '-'}</div>
                                        </div>
                                        <Badge tone={isBankDepositDetailConfirmed(detail) ? 'green' : 'amber'}>
                                            {isBankDepositDetailConfirmed(detail) ? 'Confirmado' : 'Pendiente'}
                                        </Badge>
                                    </div>
                                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                                        <ClosureInfoItem label="Referencia" value={detail.reference || detail.confirmationReference || '-'} />
                                        <ClosureInfoItem label="Confirmado por" value={detail.confirmedBy || '-'} />
                                    </div>
                                    {supportUrl ? (
                                        <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50 p-4">
                                            <div className="mb-3 flex items-center justify-between gap-3">
                                                <div>
                                                    <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Minuta</div>
                                                    <div className="text-sm font-black text-slate-950">Soporte del deposito</div>
                                                </div>
                                                <a className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-slate-700 transition hover:border-[#e30613] hover:text-[#e30613]" href={supportUrl} target="_blank" rel="noreferrer">
                                                    Abrir
                                                </a>
                                            </div>
                                            {isImage ? (
                                                <img src={supportUrl} alt="Minuta de deposito" className="max-h-[420px] w-full rounded-2xl border border-slate-200 object-contain" />
                                            ) : (
                                                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm font-bold text-slate-500">
                                                    Minuta disponible como archivo. Usa Abrir para verla.
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm font-bold text-slate-400">
                                            Sin foto de minuta registrada.
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

function BankDeposits({ data, branchContext }) {
    const { user } = useAuth();
    const selectedBranchId = getActiveBillingBranchId(branchContext);
    const branchPayload = useMemo(() => getBranchPayload(selectedBranchId), [selectedBranchId]);
    const [activeDepositTab, setActiveDepositTab] = useState('ingresar');
    const [activeConfirmationTab, setActiveConfirmationTab] = useState('pendientes');
    const [selectedClosureIds, setSelectedClosureIds] = useState([]);
    const [accountSelections, setAccountSelections] = useState({
        efectivo2Nio: BANK_DEPOSIT_DEFAULT_NIO_ACCOUNT,
        efectivo2Usd: BANK_DEPOSIT_DEFAULT_USD_ACCOUNT,
        efectivoRcNio: BANK_DEPOSIT_NIO_ACCOUNTS[1]?.accountNumber || '',
        efectivoRcUsd: BANK_DEPOSIT_USD_ACCOUNTS[1]?.accountNumber || '',
    });
    const [message, setMessage] = useState('');
    const [saving, setSaving] = useState(false);
    const [printDeposit, setPrintDeposit] = useState(null);
    const [confirmationRefs, setConfirmationRefs] = useState({});
    const [confirmationFiles, setConfirmationFiles] = useState({});
    const [confirmingKey, setConfirmingKey] = useState('');
    const [historyDeposit, setHistoryDeposit] = useState(null);

    const deposits = useMemo(() => (
        [...(data.depositos_bancarios || [])]
            .filter((deposit) => isRecordInBillingBranch(deposit, selectedBranchId))
            .sort((a, b) => String(b.createdAt?.seconds || b.date || '').localeCompare(String(a.createdAt?.seconds || a.date || '')))
    ), [data.depositos_bancarios, selectedBranchId]);

    const depositedClosureIds = useMemo(() => {
        const ids = new Set();
        deposits
            .filter((deposit) => normalizeText(deposit.status) !== 'ANULADO')
            .forEach((deposit) => (deposit.closureIds || []).forEach((id) => ids.add(id)));
        return ids;
    }, [deposits]);

    const pendingClosures = useMemo(() => (
        [...(data.cierres_caja || [])]
            .filter((closure) => closure.id)
            .filter((closure) => isRecordInBillingBranch(closure, selectedBranchId))
            .filter((closure) => !['EN_ESPERA', 'ANULADO'].includes(normalizeText(closure.status)))
            .filter((closure) => String(closure.date || getRecordDate(closure.createdAt || closure.updatedAt) || '').substring(0, 10) >= BANK_DEPOSIT_AVAILABLE_FROM_DATE)
            .filter((closure) => !closure.bankDepositId && !depositedClosureIds.has(closure.id))
            .map((closure) => ({
                ...closure,
                depositCash: getClosureCashForBankDeposit(closure),
            }))
            .filter((closure) => safeNumber(closure.depositCash.cashCordobas + closure.depositCash.cashDollars * CASH_CLOSURE_EXCHANGE_RATE) > 0.01)
            .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    ), [data.cierres_caja, depositedClosureIds, selectedBranchId]);

    const selectedClosures = useMemo(() => (
        pendingClosures.filter((closure) => selectedClosureIds.includes(closure.id))
    ), [pendingClosures, selectedClosureIds]);

    const allocation = useMemo(() => calculateBankDepositAllocation(selectedClosures), [selectedClosures]);
    const depositDetails = useMemo(() => (
        buildBankDepositDetails(allocation, accountSelections)
    ), [allocation, accountSelections]);
    const roundedDepositSummary = useMemo(() => {
        const byId = Object.fromEntries(depositDetails.map((detail) => [detail.id, detail]));
        const totalCordobas = safeNumber(depositDetails.reduce((sum, detail) => sum + safeNumber(detail.amountCordobas), 0));
        const usdTotal = safeNumber(depositDetails
            .filter((detail) => detail.currency === 'USD')
            .reduce((sum, detail) => sum + safeNumber(detail.amount), 0));
        const rcCordobas = safeNumber(safeNumber(byId.efectivo_rc_nio?.amountCordobas) + safeNumber(byId.efectivo_rc_usd?.amountCordobas));
        const efectivo2Cordobas = safeNumber(safeNumber(byId.efectivo2_nio?.amountCordobas) + safeNumber(byId.efectivo2_usd?.amountCordobas));
        return {
            totalCordobas,
            usdTotal,
            rcCordobas,
            efectivo2Cordobas,
            efectivo2Usd: safeNumber(byId.efectivo2_usd?.amount),
            efectivoRcUsd: safeNumber(byId.efectivo_rc_usd?.amount),
        };
    }, [depositDetails]);

    const pendingConfirmationDeposits = useMemo(() => (
        deposits.filter((deposit) => (
            normalizeText(deposit.status) !== 'ANULADO'
            && !isBankDepositConfirmed(deposit)
            && getBankDepositPendingDetails(deposit).length > 0
        ))
    ), [deposits]);

    const confirmedDeposits = useMemo(() => (
        deposits.filter((deposit) => normalizeText(deposit.status) !== 'ANULADO' && isBankDepositConfirmed(deposit))
    ), [deposits]);

    useEffect(() => {
        setSelectedClosureIds((current) => current.filter((id) => pendingClosures.some((closure) => closure.id === id)));
    }, [pendingClosures]);

    const toggleClosure = (closureId) => {
        setSelectedClosureIds((current) => (
            current.includes(closureId)
                ? current.filter((id) => id !== closureId)
                : [...current, closureId]
        ));
    };

    const toggleAllClosures = () => {
        setSelectedClosureIds(
            selectedClosureIds.length === pendingClosures.length
                ? []
                : pendingClosures.map((closure) => closure.id)
        );
    };

    const updateAccountSelection = (key, value) => {
        setAccountSelections((current) => ({ ...current, [key]: value }));
    };

    const saveBankDeposit = async () => {
        setMessage('');
        if (!selectedClosures.length) {
            setMessage('Selecciona al menos un cierre para depositar.');
            return;
        }
        if (!depositDetails.length) {
            setMessage('No hay efectivo disponible para generar deposito.');
            return;
        }
        const missingAccount = depositDetails.find((detail) => !detail.account?.accountNumber);
        if (missingAccount) {
            setMessage(`Selecciona cuenta para ${missingAccount.label}.`);
            return;
        }

        setSaving(true);
        try {
            const depositId = `deposito_${todayString()}_${Date.now()}`;
            const depositPayload = sanitizeFirestoreData({
                ...branchPayload,
                id: depositId,
                date: todayString(),
                month: getMonth(todayString()),
                status: 'pendiente_confirmacion',
                owner: BANK_DEPOSIT_OWNER,
                closureIds: allocation.closureIds,
                closureCodes: allocation.closureCodes,
                closures: allocation.closureSummaries,
                concept: allocation.concept,
                cashSummary: allocation,
                depositDetails,
                totalCordobas: safeNumber(depositDetails.reduce((sum, detail) => sum + safeNumber(detail.amountCordobas), 0)),
                createdBy: user?.email || '',
                source: 'cierres_caja',
                sourceType: 'bank_deposit',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });

            const batch = writeBatch(db);
            batch.set(doc(db, 'depositos_bancarios', depositId), depositPayload, { merge: true });
            selectedClosures.forEach((closure) => {
                batch.set(doc(db, 'cierres_caja', closure.id), {
                    ...branchPayload,
                    bankDepositId: depositId,
                    bankDepositStatus: 'pendiente_confirmacion',
                    bankDepositLinkedAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                }, { merge: true });
            });
            await batch.commit();

            setPrintDeposit({ ...depositPayload, createdAt: null, updatedAt: null });
            setSelectedClosureIds([]);
            setMessage('Deposito creado. Se movio a Confirmacion de depositos.');
            window.setTimeout(printBankDepositDetails, 80);
            setActiveDepositTab('confirmacion');
        } catch (error) {
            console.error(error);
            setMessage(error?.message || 'No se pudo crear el deposito bancario.');
        } finally {
            setSaving(false);
        }
    };

    const updateConfirmationReference = (depositId, detailId, value) => {
        setConfirmationRefs((current) => ({ ...current, [`${depositId}_${detailId}`]: value }));
    };

    const updateConfirmationFile = (depositId, detailId, file) => {
        setConfirmationFiles((current) => ({ ...current, [`${depositId}_${detailId}`]: file }));
    };

    const confirmDepositDetail = async (deposit, detail) => {
        const formKey = `${deposit.id}_${detail.id}`;
        const reference = String(confirmationRefs[formKey] || detail.reference || '').trim();
        const file = confirmationFiles[formKey];
        if (!reference) {
            setMessage('Ingresa el numero de referencia del deposito.');
            return;
        }
        if (!file && !detail.minuteSupport?.url) {
            setMessage('Sube la foto de la minuta del deposito.');
            return;
        }

        setConfirmingKey(formKey);
        setMessage('');
        try {
            const uploadedSupport = file
                ? await uploadSupportFile(file, 'depositos_bancarios', `${deposit.id}_${detail.id}`, 'minuta_deposito')
                : detail.minuteSupport;
            const nextDetails = (deposit.depositDetails || []).map((row) => (
                row.id === detail.id
                    ? {
                        ...row,
                        status: 'confirmado',
                        reference,
                        minuteSupport: uploadedSupport,
                        confirmedAt: new Date().toISOString(),
                        confirmedBy: user?.email || '',
                    }
                    : row
            ));
            const allConfirmed = nextDetails.every((row) => normalizeText(row.status) === 'CONFIRMADO');
            const batch = writeBatch(db);
            batch.set(doc(db, 'depositos_bancarios', deposit.id), sanitizeFirestoreData({
                depositDetails: nextDetails,
                status: allConfirmed ? 'confirmado' : 'pendiente_confirmacion',
                confirmedAt: allConfirmed ? serverTimestamp() : undefined,
                updatedAt: serverTimestamp(),
            }), { merge: true });
            if (allConfirmed) {
                (deposit.closureIds || []).forEach((closureId) => {
                    batch.set(doc(db, 'cierres_caja', closureId), {
                        bankDepositStatus: 'confirmado',
                        bankDepositConfirmedAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                    }, { merge: true });
                });
            }
            await batch.commit();
            setConfirmationFiles((current) => {
                const next = { ...current };
                delete next[formKey];
                return next;
            });
            if (allConfirmed) setActiveConfirmationTab('historial');
            setMessage(allConfirmed ? 'Deposito confirmado completamente.' : 'Detalle de deposito confirmado.');
        } catch (error) {
            console.error(error);
            setMessage(error?.message || 'No se pudo confirmar el deposito.');
        } finally {
            setConfirmingKey('');
        }
    };

    return (
        <div className="space-y-5">
            <BankDepositPrintArea deposit={printDeposit} />
            <Section title="Depositos bancarios" eyebrow="Control de efectivo" action={<Badge tone="green">Cierres a banco</Badge>}>
                <div className="flex flex-wrap gap-2">
                    {[
                        { key: 'ingresar', label: 'Ingresar depositos' },
                        { key: 'confirmacion', label: 'Confirmacion de depositos' },
                    ].map((tab) => (
                        <button
                            key={tab.key}
                            type="button"
                            onClick={() => setActiveDepositTab(tab.key)}
                            className={`rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-[0.16em] transition ${activeDepositTab === tab.key
                                ? 'bg-[#e30613] text-white shadow-lg shadow-red-900/15'
                                : 'border border-slate-200 bg-white text-slate-600 hover:border-[#e30613] hover:text-[#e30613]'}`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
                {message && (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
                        {message}
                    </div>
                )}
            </Section>

            {activeDepositTab === 'ingresar' && (
                <div className="grid gap-5 xl:grid-cols-[1fr_1.1fr]">
                    <Section title="Efectivo pendiente" eyebrow="Cierres cerrados" action={<Badge tone="blue">{pendingClosures.length} pendientes</Badge>}>
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <button
                                type="button"
                                onClick={toggleAllClosures}
                                disabled={!pendingClosures.length}
                                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-slate-700 transition hover:border-[#e30613] hover:text-[#e30613] disabled:opacity-50"
                            >
                                {selectedClosureIds.length === pendingClosures.length && pendingClosures.length ? 'Limpiar seleccion' : 'Seleccionar todos'}
                            </button>
                            <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{selectedClosureIds.length} seleccionado(s)</div>
                        </div>
                        <div className="max-h-[34rem] space-y-3 overflow-y-auto pr-1">
                            {pendingClosures.map((closure) => {
                                const selected = selectedClosureIds.includes(closure.id);
                                return (
                                    <button
                                        key={closure.id}
                                        type="button"
                                        onClick={() => toggleClosure(closure.id)}
                                        className={`w-full rounded-3xl border p-4 text-left transition ${selected ? 'border-emerald-300 bg-emerald-50 shadow-lg shadow-emerald-950/10' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="text-sm font-black text-slate-950">{getBankDepositClosureLabel(closure)}</div>
                                                <div className="mt-1 text-xs font-bold text-slate-500">{closure.cashierName || 'Sin cajero'}</div>
                                            </div>
                                            <Badge tone={selected ? 'green' : 'slate'}>{selected ? 'Seleccionado' : 'Pendiente'}</Badge>
                                        </div>
                                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                                            <SummaryCard label="Efectivo C$" value={fmt(closure.depositCash.cashCordobas)} />
                                            <SummaryCard label="Efectivo $" value={`US$ ${closure.depositCash.cashDollars.toFixed(2)}`} tone="green" />
                                            <SummaryCard label="RC efectivo" value={fmt(closure.depositCash.rcValue)} tone="amber" />
                                        </div>
                                    </button>
                                );
                            })}
                            {pendingClosures.length === 0 && (
                                <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm font-bold text-slate-400">
                                    No hay cierres con efectivo pendiente de deposito.
                                </div>
                            )}
                        </div>
                    </Section>

                    <Section title="Preparar deposito" eyebrow="Distribucion bancaria" action={<Badge tone="amber">Tasa C$ {CASH_CLOSURE_EXCHANGE_RATE.toFixed(2)}</Badge>}>
                        <div className="grid gap-3 md:grid-cols-2">
                            <SummaryCard label="Efectivo total C$" value={fmt(roundedDepositSummary.totalCordobas)} tone="green" />
                            <SummaryCard label="Efectivo $" value={`US$ ${roundedDepositSummary.usdTotal.toFixed(2)}`} tone="blue" />
                            <SummaryCard label="Efectivo RC" value={fmt(roundedDepositSummary.rcCordobas)} tone="amber" />
                            <SummaryCard label="Efectivo (2)" value={fmt(roundedDepositSummary.efectivo2Cordobas)} />
                            <SummaryCard label="Efectivo (2) $" value={`US$ ${roundedDepositSummary.efectivo2Usd.toFixed(2)}`} tone="green" />
                            <SummaryCard label="Efectivo RC $" value={`US$ ${roundedDepositSummary.efectivoRcUsd.toFixed(2)}`} tone="amber" />
                        </div>

                        <div className="mt-5 space-y-4">
                            {depositDetails.map((detail) => {
                                const accountKey = detail.id === 'efectivo_rc_nio'
                                    ? 'efectivoRcNio'
                                    : detail.id === 'efectivo_rc_usd'
                                        ? 'efectivoRcUsd'
                                        : detail.id === 'efectivo2_usd'
                                            ? 'efectivo2Usd'
                                            : 'efectivo2Nio';
                                const accountOptions = detail.currency === 'USD' ? BANK_DEPOSIT_USD_ACCOUNTS : BANK_DEPOSIT_NIO_ACCOUNTS;
                                const isFixedAccount = detail.id === 'efectivo2_nio' || detail.id === 'efectivo2_usd';
                                return (
                                    <div key={detail.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                            <div>
                                                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">{detail.label}</div>
                                                <div className="font-mono text-2xl font-black text-slate-950">{formatBankDepositAmount(detail)}</div>
                                            </div>
                                            <Badge tone={detail.currency === 'USD' ? 'blue' : 'green'}>{detail.currency}</Badge>
                                        </div>
                                        {isFixedAccount ? (
                                            <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Cuenta predeterminada unica</div>
                                                <div className="mt-1 text-sm font-black text-slate-900">{detail.account?.label || '-'}</div>
                                            </div>
                                        ) : (
                                            <Field label="Seleccionar cuenta a depositar" span="mt-4">
                                                <select className={inputClass} value={accountSelections[accountKey] || ''} onChange={(event) => updateAccountSelection(accountKey, event.target.value)}>
                                                    <option value="">Seleccionar cuenta...</option>
                                                    {accountOptions.map((account) => (
                                                        <option key={account.accountNumber} value={account.accountNumber}>{account.label}</option>
                                                    ))}
                                                </select>
                                            </Field>
                                        )}
                                    </div>
                                );
                            })}
                            {depositDetails.length === 0 && (
                                <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm font-bold text-slate-400">
                                    Selecciona cierres para calcular los depositos.
                                </div>
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={saveBankDeposit}
                            disabled={saving || !selectedClosures.length || !depositDetails.length}
                            className="mt-5 w-full rounded-2xl bg-[#e30613] px-5 py-4 text-sm font-black uppercase tracking-[0.2em] text-white shadow-lg shadow-red-950/20 transition hover:bg-[#9f111a] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {saving ? 'Guardando deposito...' : 'Crear deposito e imprimir detalles'}
                        </button>
                    </Section>
                </div>
            )}

            {activeDepositTab === 'confirmacion' && (
                <Section title="Confirmacion de depositos" eyebrow="Referencia y minuta" action={<Badge tone="blue">{pendingConfirmationDeposits.length} pendientes</Badge>}>
                    <div className="mb-5 flex flex-wrap gap-2 rounded-3xl border border-slate-200 bg-slate-50/70 p-2">
                        {[
                            { key: 'pendientes', label: 'Para confirmar pendientes', count: pendingConfirmationDeposits.length },
                            { key: 'historial', label: 'Historial', count: confirmedDeposits.length },
                        ].map((tab) => (
                            <button
                                key={tab.key}
                                type="button"
                                onClick={() => setActiveConfirmationTab(tab.key)}
                                className={`rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-[0.16em] transition ${activeConfirmationTab === tab.key
                                    ? 'bg-slate-950 text-white shadow-lg shadow-slate-950/15'
                                    : 'bg-white text-slate-600 hover:text-[#e30613]'
                                }`}
                            >
                                {tab.label} ({tab.count})
                            </button>
                        ))}
                    </div>

                    {activeConfirmationTab === 'pendientes' && (
                        <div className="space-y-4">
                            {pendingConfirmationDeposits.map((deposit) => {
                                const pendingDetails = getBankDepositPendingDetails(deposit);
                                return (
                                    <div key={deposit.id} className="rounded-[1.8rem] border border-slate-200 bg-white p-4 shadow-sm">
                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                            <div>
                                                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">{deposit.date || '-'}</div>
                                                <div className="text-lg font-black text-slate-950">{deposit.closureCodes?.length ? `Cierres ${deposit.closureCodes.join(', ')}` : deposit.concept}</div>
                                                <div className="mt-1 text-xs font-bold text-slate-500">{fmt(deposit.totalCordobas)} / {pendingDetails.length} pendiente(s) por confirmar</div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setPrintDeposit(deposit);
                                                    window.setTimeout(printBankDepositDetails, 80);
                                                }}
                                                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-slate-700 transition hover:border-[#e30613] hover:text-[#e30613]"
                                            >
                                                Reimprimir detalles
                                            </button>
                                        </div>
                                        <div className="mt-4 grid gap-3 xl:grid-cols-2">
                                            {pendingDetails.map((detail) => {
                                                const formKey = `${deposit.id}_${detail.id}`;
                                                return (
                                                    <div key={detail.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div>
                                                                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">{detail.label}</div>
                                                                <div className="font-mono text-xl font-black text-slate-950">{formatBankDepositAmount(detail)}</div>
                                                                <div className="mt-1 text-xs font-bold text-slate-500">{detail.account?.label || '-'}</div>
                                                            </div>
                                                            <Badge tone="amber">Pendiente</Badge>
                                                        </div>
                                                        <div className="mt-4 grid gap-3">
                                                            <Field label="Numero de referencia">
                                                                <input className={inputClass} value={confirmationRefs[formKey] || ''} onChange={(event) => updateConfirmationReference(deposit.id, detail.id, event.target.value)} placeholder="Referencia bancaria" />
                                                            </Field>
                                                            <Field label="Foto de minuta">
                                                                <input className={inputClass} type="file" accept="image/*,.pdf" onChange={(event) => updateConfirmationFile(deposit.id, detail.id, event.target.files?.[0] || null)} />
                                                            </Field>
                                                            <button
                                                                type="button"
                                                                onClick={() => confirmDepositDetail(deposit, detail)}
                                                                disabled={confirmingKey === formKey}
                                                                className="rounded-2xl bg-emerald-600 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-emerald-700 disabled:opacity-50"
                                                            >
                                                                {confirmingKey === formKey ? 'Confirmando...' : 'Confirmar deposito'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                            {pendingConfirmationDeposits.length === 0 && (
                                <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm font-bold text-slate-400">
                                    No hay depositos pendientes de confirmacion.
                                </div>
                            )}
                        </div>
                    )}

                    {activeConfirmationTab === 'historial' && (
                        <div>
                            <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500">
                                Doble clic en un deposito para ver detalle, referencias y foto de minuta.
                            </div>
                            <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white">
                                <table className="min-w-full text-left text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                                            <th className="px-4 py-3">Fecha</th>
                                            <th className="px-4 py-3">Cierres</th>
                                            <th className="px-4 py-3">Referencias</th>
                                            <th className="px-4 py-3 text-right">Total</th>
                                            <th className="px-4 py-3 text-right">Detalles</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {confirmedDeposits.map((deposit) => (
                                            <tr
                                                key={deposit.id}
                                                onDoubleClick={() => setHistoryDeposit(deposit)}
                                                className="cursor-pointer border-b border-slate-100 transition hover:bg-red-50/50"
                                                title="Doble clic para ver detalle"
                                            >
                                                <td className="px-4 py-3 font-bold text-slate-700">{deposit.date || '-'}</td>
                                                <td className="px-4 py-3 font-black text-slate-950">{deposit.closureCodes?.length ? deposit.closureCodes.join(', ') : '-'}</td>
                                                <td className="px-4 py-3 font-bold text-slate-500">
                                                    {(deposit.depositDetails || []).map((detail) => detail.reference).filter(Boolean).join(' / ') || '-'}
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono font-black text-emerald-700">{fmt(deposit.totalCordobas)}</td>
                                                <td className="px-4 py-3 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => setHistoryDeposit(deposit)}
                                                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-700 transition hover:border-[#e30613] hover:text-[#e30613]"
                                                    >
                                                        Ver
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                        {confirmedDeposits.length === 0 && (
                                            <tr>
                                                <td colSpan={5} className="px-4 py-10 text-center text-sm font-bold text-slate-400">
                                                    No hay depositos confirmados en historial.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </Section>
            )}
            <BankDepositHistoryModal
                deposit={historyDeposit}
                onClose={() => setHistoryDeposit(null)}
                onPrint={(deposit) => {
                    setPrintDeposit(deposit);
                    window.setTimeout(printBankDepositDetails, 80);
                }}
            />
        </div>
    );
}

export default function Billing({ data = {}, canEdit = true, branchContext }) {
    const location = useLocation();
    const navigate = useNavigate();
    const selectedBranchId = getActiveBillingBranchId(branchContext);
    const branchPayload = useMemo(() => getBranchPayload(selectedBranchId), [selectedBranchId]);
    const availableTabs = canEdit ? BILLING_TABS : BILLING_READ_ONLY_TABS;
    const [activeTab, setActiveTab] = useState(() => (canEdit ? getBillingTabFromSearch(location.search) : 'historial'));

    useEffect(() => {
        const requestedTab = getBillingTabFromSearch(location.search);
        const nextTab = canEdit ? requestedTab : 'historial';
        if (nextTab !== activeTab) {
            setActiveTab(nextTab);
        }
        if (!canEdit && requestedTab !== 'historial') {
            navigate('/facturacion?tab=historial', { replace: true });
        }
    }, [activeTab, canEdit, location.search, navigate]);

    const handleTabChange = useCallback((tabKey) => {
        setActiveTab(tabKey);
        navigate(`/facturacion?tab=${tabKey}`, { replace: false });
    }, [navigate]);

    return (
        <div className="space-y-5">
            <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
                <div className="command-register-header px-5 py-5 sm:px-6">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.38em] text-[#e30613]">{APP_BRAND_NAME}</div>
                            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Facturacion</h1>
                            <p className="mt-1 max-w-2xl text-sm font-semibold text-slate-500">
                                Cierres de caja, facturas membretadas, retenciones y respaldo fiscal.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {!canEdit && <Badge tone="amber">Solo lectura</Badge>}
                            <Badge tone="slate">{branchPayload.branchName}</Badge>
                            <Badge tone="amber">Serie {branchPayload.invoiceSeries}</Badge>
                            <Badge tone="green">SICAR</Badge>
                            <Badge tone="blue">Caja</Badge>
                            <Badge tone="amber">Retenciones</Badge>
                        </div>
                    </div>
                </div>

                <div className="border-t border-slate-200 p-3">
                    <div className="flex flex-wrap gap-1.5">
                        {availableTabs.map((tab) => (
                            <button
                                key={tab.key}
                                type="button"
                                onClick={() => handleTabChange(tab.key)}
                                className={`rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-wide transition-all ${
                                    activeTab === tab.key
                                        ? 'bg-[#e30613] text-white shadow-sm shadow-red-900/20'
                                        : 'text-stone-600 hover:bg-stone-100'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>
            </section>

            {!canEdit && (
                <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-bold text-amber-900">
                    Acceso visualizador: este usuario puede consultar Historial de Facturacion, pero no crear cierres, registrar facturas, editar documentos ni confirmar depositos.
                </div>
            )}

            {canEdit && activeTab === 'cierre' && <CashClosure data={data} branchContext={branchContext} />}
            {canEdit && activeTab === 'registro' && <AccountingRegister data={data} branchContext={branchContext} />}
            {activeTab === 'historial' && <BillingHistory data={data} canEdit={canEdit} branchContext={branchContext} />}
            {canEdit && activeTab === 'depositos' && <BankDeposits data={data} branchContext={branchContext} />}
        </div>
    );
}
