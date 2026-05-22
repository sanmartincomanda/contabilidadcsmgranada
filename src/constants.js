// src/constants.js

export const DEFAULT_BRANCH_ID = 'granada';
export const DEFAULT_BRANCH_NAME = 'CARNES SAN MARTIN GRANADA';
export const DEFAULT_CASHBOX_NAME = 'CAJA 2';
export const APP_BRAND_NAME = 'Carnes San Martin Granada';
export const APP_BRAND_WORDMARK_TOP = 'Carnes San Martin';
export const APP_BRAND_WORDMARK_BOTTOM = 'Granada';
export const APP_BRAND_LOGO = '/logo.png';

// 1. Constantes de Categorias
export const CATEGORIES = ['Alquiler', 'Servicios', 'Sueldos', 'Compra Inventario', 'Mantenimiento', 'Marketing', 'Otros'];

// 2. Sucursal unica del sistema
export const BRANCHES = [
    { id: DEFAULT_BRANCH_ID, name: DEFAULT_BRANCH_NAME },
];

// 3. Constantes de Columnas para Carga CSV
export const GASTOS_CSV_COLUMNS = ['Fecha', 'Descripcion', 'Categoria', 'Monto'];

// 4. Utilidades generales
export const peso = (n) => (isNaN(n) || n === null || n === '' ? 0 : Number(n));

export const fmt = (n, currency = 'C$') =>
    `${currency} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const resolveBranchId = () => DEFAULT_BRANCH_ID;

export const resolveBranchName = () => DEFAULT_BRANCH_NAME;

export const branchName = () => DEFAULT_BRANCH_NAME;
