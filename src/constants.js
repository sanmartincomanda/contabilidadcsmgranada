// src/constants.js

export const DEFAULT_BRANCH_ID = 'granada';
export const DEFAULT_BRANCH_NAME = 'CARNES SAN MARTIN GRANADA';
export const DEFAULT_BRANCH_CODE = 'GRANADA';
export const DEFAULT_DOCUMENT_SERIES = 'A';
export const NINDIRI_BRANCH_ID = 'nindiri';
export const NINDIRI_BRANCH_NAME = 'CARNES SAN MARTIN NINDIRI';
export const CONSOLIDATED_BRANCH_ID = 'consolidado';
export const DEFAULT_CASHBOX_NAME = 'CAJA 2';
export const APP_BRAND_NAME = 'Carnes San Martin Granada';
export const APP_BRAND_WORDMARK_TOP = 'Carnes San Martin';
export const APP_BRAND_WORDMARK_BOTTOM = 'Granada';
export const APP_BRAND_LOGO = '/logo.png';

// 1. Constantes de Categorias
export const CATEGORIES = [
    'Costos de venta / compras',
    'Gastos de Nomina',
    'Gastos del Local',
    'Equipos y Operacion de Carniceria',
    'Gastos de venta - Operaciones',
    'Gastos administrativos',
    'Impuestos, permisos y tasas',
    'Gastos financieros',
    'Otros Gastos',
];

const normalizeBranchText = (value = '') => (
    String(value || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
);

// 2. Sucursales fiscales del sistema
export const BRANCHES = [
    {
        id: DEFAULT_BRANCH_ID,
        code: DEFAULT_BRANCH_CODE,
        name: DEFAULT_BRANCH_NAME,
        shortName: 'Granada',
        invoiceSeries: 'A',
        receiptSeries: 'A',
        cashboxName: DEFAULT_CASHBOX_NAME,
        isDefault: true,
    },
    {
        id: NINDIRI_BRANCH_ID,
        code: 'NINDIRI',
        name: NINDIRI_BRANCH_NAME,
        shortName: 'Nindiri',
        invoiceSeries: 'B',
        receiptSeries: 'B',
        cashboxName: 'CAJA NINDIRI',
        isDefault: false,
    },
];

export const CONSOLIDATED_BRANCH = {
    id: CONSOLIDATED_BRANCH_ID,
    code: 'CONSOLIDADO',
    name: 'REPORTE CONSOLIDADO',
    shortName: 'Consolidado',
    invoiceSeries: '',
    receiptSeries: '',
};

export const ALL_BRANCH_IDS = BRANCHES.map((branch) => branch.id);

export const getBranchById = (branchId = DEFAULT_BRANCH_ID) => {
    const normalized = normalizeBranchText(branchId);
    return BRANCHES.find((branch) => (
        normalizeBranchText(branch.id) === normalized
        || normalizeBranchText(branch.code) === normalized
        || normalizeBranchText(branch.name) === normalized
        || normalizeBranchText(branch.shortName) === normalized
    )) || BRANCHES[0];
};

// 3. Constantes de Columnas para Carga CSV
export const GASTOS_CSV_COLUMNS = ['Fecha', 'Descripcion', 'Categoria', 'Monto'];

// 4. Utilidades generales
export const peso = (n) => (isNaN(n) || n === null || n === '' ? 0 : Number(n));

export const fmt = (n, currency = 'C$') =>
    `${currency} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const resolveBranchId = (value = DEFAULT_BRANCH_ID) => getBranchById(value).id;

export const resolveBranchName = (value = DEFAULT_BRANCH_ID) => getBranchById(value).name;

export const branchName = (value = DEFAULT_BRANCH_ID) => {
    if (normalizeBranchText(value) === CONSOLIDATED_BRANCH_ID) return CONSOLIDATED_BRANCH.name;
    return getBranchById(value).name;
};

export const getBranchCode = (value = DEFAULT_BRANCH_ID) => getBranchById(value).code;

export const getBranchShortName = (value = DEFAULT_BRANCH_ID) => getBranchById(value).shortName;

export const getBranchInvoiceSeries = (value = DEFAULT_BRANCH_ID) => getBranchById(value).invoiceSeries || DEFAULT_DOCUMENT_SERIES;

export const getBranchReceiptSeries = (value = DEFAULT_BRANCH_ID) => getBranchById(value).receiptSeries || DEFAULT_DOCUMENT_SERIES;

export const getBranchCashboxName = (value = DEFAULT_BRANCH_ID) => getBranchById(value).cashboxName || DEFAULT_CASHBOX_NAME;

export const getBranchPayload = (value = DEFAULT_BRANCH_ID, documentType = '') => {
    const branch = getBranchById(value);
    const invoiceSeries = getBranchInvoiceSeries(branch.id);
    const receiptSeries = getBranchReceiptSeries(branch.id);
    const documentSeries = documentType === 'receipt' ? receiptSeries : invoiceSeries;

    return {
        branch: branch.id,
        branchId: branch.id,
        branchCode: branch.code,
        branchName: branch.name,
        sucursal: branch.id,
        sucursalNombre: branch.name,
        invoiceSeries,
        receiptSeries,
        documentSeries,
    };
};

export const getRecordBranchId = (record = {}) => resolveBranchId(
    record.branchId
    || record.branch
    || record.sucursal
    || record.branchName
    || record.sucursalNombre
    || DEFAULT_BRANCH_ID
);

export const buildDocumentDisplayNumber = ({ series = '', number = '' } = {}) => {
    const cleanSeries = String(series || '').trim().toUpperCase();
    const cleanNumber = String(number || '').trim();
    return cleanSeries && cleanNumber ? `${cleanSeries}-${cleanNumber}` : cleanNumber || cleanSeries;
};
