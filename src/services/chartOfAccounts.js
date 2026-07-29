import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

export const CHART_OF_ACCOUNTS_COLLECTION = 'configuracion';
export const CHART_OF_ACCOUNTS_DOC_ID = 'plan_cuentas_quickbooks';

export const ACCOUNTING_TRANSACTION_TYPES = {
    expense: 'expense',
    purchase: 'purchase',
    income: 'income',
    payment: 'payment',
    payable: 'payable',
};

export const DEFAULT_ACCOUNT_CODES = {
    purchase: '11060',
    expense: '5',
    income: '4100',
    payment: '1102101',
    payable: '2101',
    ivaCredit: '110702',
    retentionIr: '21041',
    retentionMunicipal: '21043',
};

const DEFAULT_CHART_ACCOUNTS = [
    { number: '11060', name: 'INVENTARIO:Alimentos', type: 'Activos corrientes', detailType: 'Inventario', locked: false },
    { number: '110702', name: 'IMPUESTOS ACREDITABLES:IVA Acreditable', type: 'Activos corrientes', detailType: 'Otros activos corrientes', locked: false },
    { number: '21041', name: 'IMPTOS CORRIENTES X PAGAR:Anticipo IR', type: 'Pasivos corrientes', detailType: 'Impuesto a las ganancias por pagar', locked: false },
    { number: '21043', name: 'IMPTOS CORRIENTES X PAGAR:Impuestos Municipales', type: 'Pasivos corrientes', detailType: 'Pasivos por impuestos corriente', locked: false },
    { number: '1102101', name: 'BANCOS:MONEDA NACIONAL:BAC NO. 362843534 C$', type: 'Efectivo y equivalentes de efectivo', detailType: 'Banco', locked: false },
    { number: '1102102', name: 'BANCOS:MONEDA NACIONAL:BANPRO NO 10013500002893', type: 'Efectivo y equivalentes de efectivo', detailType: 'Banco', locked: false },
    { number: '1102103', name: 'BANCOS:MONEDA NACIONAL:LA FISE NO.106014315 C$', type: 'Efectivo y equivalentes de efectivo', detailType: 'Banco', locked: false },
    { number: '1102201', name: 'BANCOS:MONEDA EXTRANJERA:BAC NO.362785164 $', type: 'Efectivo y equivalentes de efectivo', detailType: 'Banco', locked: false },
    { number: '21029-1', name: 'Tarjeta de Credito - Mayor:Amex', type: 'Tarjeta de credito', detailType: 'Tarjeta de credito', locked: false },
    { number: '21029-2', name: 'Tarjeta de Credito - Mayor:Banpro Black', type: 'Tarjeta de credito', detailType: 'Tarjeta de credito', locked: false },
    { number: '5', name: 'COSTOS Y GASTOS', type: 'Gastos', detailType: 'Gastos', locked: false },
];

let cachedAccounts = null;
let cachedPromise = null;

const normalizeText = (value = '') => String(value || '').trim();

export const buildAccountId = (account = {}) => (
    normalizeText(account.id)
    || normalizeText(account.number)
    || normalizeText(account.name).toLowerCase().replace(/[^a-z0-9]+/g, '_')
);

export const normalizeAccountingAccount = (account = {}) => {
    const number = normalizeText(account.number || account.accountNumber || account.codigo || account.code);
    const name = normalizeText(account.name || account.accountName || account.nombre);
    const type = normalizeText(account.type || account.accountType || account.tipo);
    const detailType = normalizeText(account.detailType || account.accountDetailType || account.detalle);
    const locked = account.locked === true || String(account.locked || account.bloquear || '').toLowerCase() === 'yes';
    const id = buildAccountId({ ...account, number, name });

    return {
        id,
        number,
        code: number,
        name,
        fullName: name,
        type,
        detailType,
        locked,
        isPosting: Boolean(number && name && !locked),
    };
};

const normalizeAccounts = (accounts = []) => accounts
    .map(normalizeAccountingAccount)
    .filter((account) => account.id && account.name);

export const getFallbackChartOfAccounts = () => normalizeAccounts(DEFAULT_CHART_ACCOUNTS);

export const loadChartOfAccounts = async ({ force = false } = {}) => {
    if (!force && cachedAccounts) return cachedAccounts;
    if (!force && cachedPromise) return cachedPromise;

    cachedPromise = (async () => {
        try {
            const snap = await getDoc(doc(db, CHART_OF_ACCOUNTS_COLLECTION, CHART_OF_ACCOUNTS_DOC_ID));
            const importedAccounts = snap.exists() ? snap.data()?.accounts || [] : [];
            const normalized = normalizeAccounts(importedAccounts);
            cachedAccounts = normalized.length ? normalized : getFallbackChartOfAccounts();
        } catch (error) {
            console.warn('No se pudo cargar plan de cuentas QuickBooks, usando base local.', error);
            cachedAccounts = getFallbackChartOfAccounts();
        }
        return cachedAccounts;
    })();

    return cachedPromise;
};

export const clearChartOfAccountsCache = () => {
    cachedAccounts = null;
    cachedPromise = null;
};

export const filterAccountingAccounts = (accounts = [], transactionType = '') => {
    const postingAccounts = accounts.filter((account) => account.isPosting);
    const type = String(transactionType || '').toLowerCase();

    if (type === ACCOUNTING_TRANSACTION_TYPES.purchase) {
        return postingAccounts.filter((account) => ['Activos corrientes', 'Costo de las ventas', 'Gastos'].includes(account.type));
    }

    if (type === ACCOUNTING_TRANSACTION_TYPES.expense) {
        return postingAccounts.filter((account) => ['Gastos', 'Otros gastos', 'Costo de las ventas'].includes(account.type));
    }

    if (type === ACCOUNTING_TRANSACTION_TYPES.income) {
        return postingAccounts.filter((account) => ['Ingresos', 'Otros ingresos'].includes(account.type));
    }

    if (type === ACCOUNTING_TRANSACTION_TYPES.payment) {
        return postingAccounts.filter((account) => ['Efectivo y equivalentes de efectivo', 'Tarjeta de credito', 'Tarjeta de crédito', 'Activos corrientes'].includes(account.type));
    }

    if (type === ACCOUNTING_TRANSACTION_TYPES.payable) {
        return postingAccounts.filter((account) => ['Cuentas por pagar (C/P)', 'Pasivos corrientes', 'Tarjeta de credito', 'Tarjeta de crédito'].includes(account.type));
    }

    return postingAccounts;
};

export const findAccountingAccount = (accounts = [], value = '') => {
    const key = normalizeText(value).toLowerCase();
    if (!key) return null;
    return accounts.find((account) => (
        String(account.id).toLowerCase() === key
        || String(account.number).toLowerCase() === key
        || String(account.name).toLowerCase() === key
    )) || null;
};

export const getDefaultAccountingAccountId = (transactionType = '') => {
    const key = String(transactionType || '').toLowerCase();
    return DEFAULT_ACCOUNT_CODES[key] || DEFAULT_ACCOUNT_CODES.expense;
};

export const buildAccountingAccountPayload = (accountId, {
    accounts = cachedAccounts || getFallbackChartOfAccounts(),
    transactionType = '',
    fallbackAccountId,
} = {}) => {
    const fallbackId = fallbackAccountId || getDefaultAccountingAccountId(transactionType);
    const account = findAccountingAccount(accounts, accountId) || findAccountingAccount(accounts, fallbackId);

    if (!account) return {};

    return {
        accountingAccountId: account.id,
        accountingAccountCode: account.number,
        accountingAccountName: account.name,
        accountingAccountFullName: account.fullName,
        accountingAccountType: account.type,
        accountingAccountDetailType: account.detailType,
        accountingAccountSource: 'quickbooks_chart',
    };
};

export const groupAccountingAccountsByType = (accounts = []) => accounts.reduce((groups, account) => {
    const key = account.type || 'Sin tipo';
    if (!groups[key]) groups[key] = [];
    groups[key].push(account);
    return groups;
}, {});
