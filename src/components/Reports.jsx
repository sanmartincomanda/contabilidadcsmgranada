// src/components/Reports.jsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
    APP_BRAND_LOGO,
    APP_BRAND_NAME,
    BRANCHES,
    CONSOLIDATED_BRANCH_ID,
    DEFAULT_BRANCH_ID,
    fmt,
    peso,
    branchName,
    getBranchById,
    getRecordBranchId,
    resolveBranchId,
} from '../constants';
import BalanceSheet from './BalanceSheet';
import DashboardGeneral from './DashboardGeneral';
import ExecutiveFlowDiagram from './ExecutiveFlowDiagram';
import {
    resolvePurchaseDiscountEntries,
    resolveSalesIncomeEntries,
} from '../services/incomeAggregation';
import { DEFAULT_PURCHASE_CATEGORY_ID, getExpenseCategoryFromRecord } from '../services/expenseCategories';

// --- ICONOS SVG INLINE ---
const Icons = {
    chart: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
    scale: "M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3",
    dashboard: "M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z",
    calendar: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
    chevronDown: "M19 9l-7 7-7-7",
    chevronRight: "M9 5l7 7-7 7",
    trendingUp: "M13 7h8m0 0v8m0-8l-8-8-4 4-6-6",
    trendingDown: "M13 17h8m0 0V9m0 8l-8-8-4 4-6-6",
    dollar: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    wallet: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
    receipt: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01",
    x: "M6 18L18 6M6 6l12 12",
    shoppingCart: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z",
    box: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
    alert: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
};

const Icon = ({ path, className = "w-5 h-5" }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
);

const normalizeReportText = (value = '') => (
    String(value || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
);

const PAYMENT_ROWS_SYMBOL = Symbol('paymentRows');
const BRANCH_COST_TRANSFER_COLLECTION = 'traspasos_costos_sucursal';

const DATA_COLLECTION_KEYS = [
    'ingresos',
    'compras',
    'gastos',
    'facturas_membretadas_ventas',
    'recibos_caja_membretados',
    'inventario',
    'presupuestos',
    'cuentas_por_pagar',
    'gastosDiarios',
    BRANCH_COST_TRANSFER_COLLECTION,
];

const filterDataByBranchScope = (data = {}, branchScope = CONSOLIDATED_BRANCH_ID, allowedBranchIds = []) => {
    const allowed = new Set(Array.isArray(allowedBranchIds) && allowedBranchIds.length ? allowedBranchIds : [DEFAULT_BRANCH_ID]);
    if (branchScope === CONSOLIDATED_BRANCH_ID) {
        return Object.fromEntries(Object.entries(data).map(([key, value]) => (
            DATA_COLLECTION_KEYS.includes(key) && Array.isArray(value)
                ? [key, key === BRANCH_COST_TRANSFER_COLLECTION
                    ? value.filter((item) => allowed.has(resolveBranchId(item.fromBranchId || item.branchFrom || DEFAULT_BRANCH_ID)) || allowed.has(resolveBranchId(item.toBranchId || item.branchTo || DEFAULT_BRANCH_ID)))
                    : value.filter((item) => allowed.has(getRecordBranchId(item)))]
                : [key, value]
        )));
    }

    return Object.fromEntries(Object.entries(data).map(([key, value]) => (
        DATA_COLLECTION_KEYS.includes(key) && Array.isArray(value)
            ? [key, key === BRANCH_COST_TRANSFER_COLLECTION
                ? value.filter((item) => resolveBranchId(item.fromBranchId || item.branchFrom || DEFAULT_BRANCH_ID) === branchScope || resolveBranchId(item.toBranchId || item.branchTo || DEFAULT_BRANCH_ID) === branchScope)
                : value.filter((item) => getRecordBranchId(item) === branchScope)]
            : [key, value]
    )));
};

const normalizePaymentBreakdownRows = (rows = []) => (
    (Array.isArray(rows) ? rows : [])
        .map((row) => ({
            method: String(row.method || row.paymentMethod || '').trim(),
            amount: peso(row.amount),
            reference: String(row.reference || '').trim(),
        }))
        .filter((row) => row.method && row.amount > 0)
);

const paymentBreakdownTotal = (rows = []) => peso(
    normalizePaymentBreakdownRows(rows).reduce((sum, row) => sum + peso(row.amount), 0)
);

const invoicePaymentTarget = (item = {}) => {
    const total = peso(item.total);
    const retentions = peso(item.retentionTotal ?? (peso(item.retentionIr2) + peso(item.retentionMunicipal1)));
    const net = peso(total - retentions);
    return net > 0 ? net : total;
};

const getInvoicePaymentRows = (item = {}) => {
    const rows = normalizePaymentBreakdownRows(item.paymentBreakdown);
    if (rows.length) return rows;
    const method = String(item.paymentMethod || '').trim();
    if (!method) return [];
    return [{ method, amount: invoicePaymentTarget(item), reference: '' }];
};

const paymentMethodLabel = (item = {}) => {
    const rows = normalizePaymentBreakdownRows(item.paymentBreakdown);
    if (!rows.length) return item.paymentMethod || '';
    if (rows.length === 1) return rows[0].method;
    return rows.map((row) => `${row.method} ${fmt(row.amount)}`).join(' / ');
};

// --- COMPONENTES UI ---

const Card = ({ title, children, className = "", right, subtitle, icon, gradient = false }) => (
    <div className={`rounded-xl shadow-md border border-[#d9e1e8]/60 bg-white overflow-hidden ${className}`}>
        <div className={`flex justify-between items-center px-5 py-3 border-b ${gradient ? 'bg-[#9f111a] border-[#5c0f14]' : 'bg-stone-50 border-[#d8dee6]'}`}>
            <div className="flex items-center gap-3">
                {icon && (
                    <div className={`p-2 rounded-lg ${gradient ? 'bg-white/10' : 'bg-[#fff1f2]'}`}>
                        <Icon path={Icons[icon]} className={`w-4 h-4 ${gradient ? 'text-white' : 'text-[#e30613]'}`} />
                    </div>
                )}
                <div>
                    <h3 className={`text-sm font-bold uppercase tracking-wider ${gradient ? 'text-white' : 'text-[#1f2937]'}`}>{title}</h3>
                    {subtitle && <p className={`text-xs mt-0.5 ${gradient ? 'text-white/60' : 'text-stone-400'}`}>{subtitle}</p>}
                </div>
            </div>
            {right}
        </div>
        <div className="p-5">{children}</div>
    </div>
);

const Select = ({ label, icon, value, onChange, options = [] }) => (
    <div className="space-y-1">
        {label && <label className="text-xs font-bold uppercase tracking-wider text-stone-500">{label}</label>}
        <div className="relative">
            {icon && <Icon path={Icons[icon]} className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />}
            <select
                value={value}
                onChange={onChange}
                className={`w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5 font-semibold text-stone-700 outline-none transition-all focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15 appearance-none cursor-pointer ${icon ? 'pl-10' : ''}`}
            >
                {options}
            </select>
            <Icon path={Icons.chevronDown} className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
        </div>
    </div>
);

const StatCard = ({ title, value, subtitle, icon, variant = 'default', trend }) => {
    const variants = {
        default: 'bg-white border-[#d9e1e8]',
        wine: 'bg-[#e30613] text-white border-[#9f111a]',
        success: 'bg-emerald-600 text-white border-emerald-700',
        danger: 'bg-rose-600 text-white border-rose-700',
        warning: 'bg-amber-500 text-white border-amber-600',
        dark: 'bg-[#111827] text-white border-[#1a0a0b]'
    };

    const isColored = variant !== 'default';

    return (
        <div className={`rounded-xl p-5 border shadow-sm ${variants[variant]}`}>
            <div className="flex items-start justify-between mb-3">
                <div className={`p-2.5 rounded-xl ${isColored ? 'bg-white/20' : 'bg-[#fff1f2]'}`}>
                    <Icon path={Icons[icon]} className={`w-5 h-5 ${isColored ? 'text-white' : 'text-[#e30613]'}`} />
                </div>
                {trend !== undefined && (
                    <div className={`flex items-center gap-1 text-xs font-bold ${isColored ? 'text-white/70' : (parseFloat(trend) >= 0 ? 'text-emerald-600' : 'text-rose-600')}`}>
                        <Icon path={parseFloat(trend) >= 0 ? Icons.trendingUp : Icons.trendingDown} className="w-3.5 h-3.5" />
                        {Math.abs(parseFloat(trend))}%
                    </div>
                )}
            </div>
            <div className={`text-2xl font-black mb-0.5 ${isColored ? 'text-white' : 'text-[#111827]'}`}>{value}</div>
            <div className={`text-xs font-bold uppercase tracking-wider ${isColored ? 'text-white/70' : 'text-stone-500'}`}>{title}</div>
            {subtitle && <div className={`text-xs mt-1 ${isColored ? 'text-white/50' : 'text-stone-400'}`}>{subtitle}</div>}
        </div>
    );
};

const addCategoryAmount = (tree, item, amount, fallbackId) => {
    const categoryInfo = getExpenseCategoryFromRecord(item, fallbackId);
    const category = categoryInfo.category;
    const subcategory = categoryInfo.subcategory;

    if (!tree[category]) {
        tree[category] = { category, total: 0, subcategories: {} };
    }
    if (!tree[category].subcategories[subcategory]) {
        tree[category].subcategories[subcategory] = { subcategory, total: 0 };
    }

    tree[category].total += amount;
    tree[category].subcategories[subcategory].total += amount;
    return categoryInfo;
};

const mergeCategoryTrees = (trees = []) => {
    const merged = {};
    trees.forEach((tree = {}) => {
        Object.values(tree).forEach((categoryNode) => {
            if (!merged[categoryNode.category]) {
                merged[categoryNode.category] = {
                    category: categoryNode.category,
                    total: 0,
                    subcategories: {},
                };
            }
            merged[categoryNode.category].total += peso(categoryNode.total);
            Object.values(categoryNode.subcategories || {}).forEach((subNode) => {
                if (!merged[categoryNode.category].subcategories[subNode.subcategory]) {
                    merged[categoryNode.category].subcategories[subNode.subcategory] = {
                        subcategory: subNode.subcategory,
                        total: 0,
                    };
                }
                merged[categoryNode.category].subcategories[subNode.subcategory].total += peso(subNode.total);
            });
        });
    });
    return merged;
};

const categoryTreeToRows = (tree = {}) => Object.values(tree)
    .map((categoryNode) => ({
        ...categoryNode,
        total: peso(categoryNode.total),
        subcategories: Object.values(categoryNode.subcategories || {})
            .map((subNode) => ({ ...subNode, total: peso(subNode.total) }))
            .sort((a, b) => b.total - a.total),
    }))
    .sort((a, b) => b.total - a.total);

const isCostCategory = (item) => (
    getExpenseCategoryFromRecord(item, DEFAULT_PURCHASE_CATEGORY_ID).category === 'Costos de venta / compras'
);

const PURCHASE_DISCOUNT_CATEGORY_RECORD = {
    category: 'Costos de venta / compras',
    categoria: 'Costos de venta / compras',
    subcategory: 'Descuentos sobre compras',
    subcategoria: 'Descuentos sobre compras',
    expenseCategory: 'Costos de venta / compras',
    expenseSubcategory: 'Descuentos sobre compras',
    categoryLabel: 'Costos de venta / compras / Descuentos sobre compras',
};

const isDepreciationOrAmortization = (item = {}) => {
    const categoryInfo = getExpenseCategoryFromRecord(item);
    const normalized = `${categoryInfo.category} ${categoryInfo.subcategory} ${categoryInfo.label || ''} ${item.description || item.descripcion || ''}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

    return normalized.includes('depreciacion') || normalized.includes('amortizacion');
};

const CategoryBreakdown = ({ rows = [], budgets = {}, onCategoryClick, emptyLabel = 'Sin movimientos para mostrar.' }) => {
    if (!rows.length) {
        return (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-400">
                {emptyLabel}
            </div>
        );
    }

    const readBudget = (category, subcategory = '') => {
        const fullKey = subcategory ? `${category} / ${subcategory}` : category;
        if (subcategory) return peso(budgets[fullKey] ?? budgets[subcategory] ?? 0);
        const direct = peso(budgets[category]);
        if (direct) return direct;
        return Object.entries(budgets)
            .filter(([key]) => key.startsWith(`${category} / `))
            .reduce((sum, [, value]) => sum + peso(value), 0);
    };

    return (
        <div className="space-y-2">
            {rows.map((row) => {
                const budget = readBudget(row.category);
                const execution = budget > 0 ? (row.total / budget) * 100 : 0;

                return (
                    <details key={row.category} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" open>
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-slate-50 px-4 py-3 transition hover:bg-slate-100">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <Icon path={Icons.chevronRight} className="h-3.5 w-3.5 text-slate-400 transition group-open:rotate-90" />
                                    <span className="truncate text-sm font-black uppercase tracking-wide text-slate-800">{row.category}</span>
                                </div>
                                <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                    {row.subcategories.length} subcategorias
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-3 text-right">
                                {budget > 0 && (
                                    <div className="hidden sm:block">
                                        <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Presupuesto</div>
                                        <div className="text-xs font-black text-slate-700">{fmt(budget)}</div>
                                    </div>
                                )}
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Real</div>
                                    <div className="text-sm font-black text-[#9f111a]">{fmt(row.total)}</div>
                                </div>
                                {budget > 0 && (
                                    <span className={`hidden rounded-full px-2 py-1 text-[10px] font-black sm:inline-flex ${
                                        execution > 100 ? 'bg-rose-100 text-rose-700' : execution > 85 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                                    }`}>
                                        {execution.toFixed(1)}%
                                    </span>
                                )}
                                {onCategoryClick && row.total > 0 && (
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            onCategoryClick(row.category);
                                        }}
                                        className="rounded-full border border-[#e30613]/20 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[#e30613] transition hover:bg-[#fff1f2]"
                                    >
                                        Detalle
                                    </button>
                                )}
                            </div>
                        </summary>
                        <div className="divide-y divide-slate-100 px-4">
                            {row.subcategories.map((subNode) => {
                                const subBudget = readBudget(row.category, subNode.subcategory);
                                const subExecution = subBudget > 0 ? (subNode.total / subBudget) * 100 : 0;
                                return (
                                    <div key={subNode.subcategory} className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                                        <div>
                                            <div className="text-sm font-bold text-slate-700">{subNode.subcategory}</div>
                                            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{row.category}</div>
                                        </div>
                                        <div className="text-left sm:text-right">
                                            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Real</div>
                                            <div className="font-black text-slate-900">{fmt(subNode.total)}</div>
                                        </div>
                                        <div className="text-left sm:min-w-[110px] sm:text-right">
                                            {subBudget > 0 ? (
                                                <>
                                                    <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Presupuesto</div>
                                                    <div className={`font-black ${subExecution > 100 ? 'text-rose-700' : 'text-slate-600'}`}>{fmt(subBudget)} · {subExecution.toFixed(1)}%</div>
                                                </>
                                            ) : (
                                                <span className="text-xs font-bold text-slate-300">Sin presupuesto</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </details>
                );
            })}
        </div>
    );
};

// --- MODAL DE DETALLES DE GASTO ---
const ExpenseDetailModal = ({ category, expenses, onClose }) => {
    if (!category) return null;
    const total = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="absolute inset-0 bg-[#111827]/40 backdrop-blur-sm" />
            <div
                className="relative w-full max-w-lg rounded-2xl border border-[#d9e1e8] bg-white shadow-2xl shadow-[#9f111a]/20 overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Modal header */}
                <div className="bg-[#9f111a] px-5 py-4 flex items-center justify-between">
                    <div>
                        <div className="text-xs font-bold uppercase tracking-[0.3em] text-[#f5b51b] mb-0.5">Detalle de transacciones</div>
                        <div className="text-base font-black text-white uppercase">{category}</div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition"
                    >
                        <Icon path={Icons.x} className="w-4 h-4" />
                    </button>
                </div>

                {/* Modal body */}
                <div className="p-5 max-h-96 overflow-y-auto space-y-2">
                    {expenses.length === 0 ? (
                        <p className="text-center text-stone-400 text-sm py-6">Sin transacciones</p>
                    ) : (
                        expenses.map((item, idx) => (
                            <div key={idx} className="flex items-center justify-between rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
                                <div>
                                    <div className="text-xs font-bold text-stone-400">{item.dateStr}</div>
                                    <div className="text-sm font-semibold text-stone-800">{item.description}</div>
                                </div>
                                <div className="text-sm font-black text-[#9f111a]">{fmt(peso(item.amount))}</div>
                            </div>
                        ))
                    )}
                </div>

                {/* Modal footer */}
                <div className="border-t border-[#d8dee6] bg-stone-50 px-5 py-3 flex items-center justify-between">
                    <div className="text-xs font-bold uppercase tracking-wider text-stone-500">Total {category}</div>
                    <div className="text-lg font-black text-[#9f111a]">{fmt(total)}</div>
                </div>
            </div>
        </div>
    );
};

// --- LOGICA DE AGREGACION (preservada exactamente) ---
const aggregateData = (data, branchScope = CONSOLIDATED_BRANCH_ID) => {
    const results = {};
    const {
        ingresos = [],
        gastos = [],
        inventarios = [],
        compras = [],
        presupuestos = [],
        cuentas_por_pagar: facturasCredito = [],
        traspasos_costos_sucursal: traspasosCostos = [],
    } = data;
    const normalizedIngresos = resolveSalesIncomeEntries(ingresos);
    const purchaseDiscountEntries = resolvePurchaseDiscountEntries(ingresos);
    const accountingAmount = (item) => peso(item.subtotal ?? item.amount ?? item.monto);

    const getDateString = (firestoreDate, fallback = '') => {
        if (typeof firestoreDate === 'string') return firestoreDate;
        if (firestoreDate && firestoreDate.toDate) return firestoreDate.toDate().toISOString().substring(0, 10);
        return fallback;
    };

    const getMonthString = (item, primaryKeys = []) => {
        const directDate = primaryKeys.map((key) => item[key]).find(Boolean);
        const dateString = getDateString(directDate);
        if (dateString) return dateString.substring(0, 7);
        return item.month || item.mes || '';
    };

    const ensureBranchData = (month, branchId) => {
        if (!month || !branchId) return null;

        results[month] = results[month] || {};
        results[month][branchId] = results[month][branchId] || {
            totalIncome: 0,
            totalExpense: 0,
            totalPurchases: 0,
            expenseDetails: {},
            expenseTree: {},
            costTree: {},
            rawExpenses: []
        };

        return results[month][branchId];
    };

    const legacyPurchasesByMonth = {};

    const budgetsByMonth = presupuestos.reduce((acc, p) => {
        const categoryInfo = getExpenseCategoryFromRecord(p);
        acc[p.month] = acc[p.month] || {};
        acc[p.month][categoryInfo.label] = (acc[p.month][categoryInfo.label] || 0) + peso(p.amount);
        return acc;
    }, {});

    const mirroredFacturaIds = new Set(
        compras
            .map((item) => item.sourceFacturaId || item.linkedPayableId || (item.id?.startsWith('credito_') ? item.id.replace('credito_', '') : ''))
            .filter(Boolean)
    );

    [...normalizedIngresos, ...gastos].forEach(item => {
        const dateString = getDateString(item.date || item.fecha);
        const month = dateString.substring(0, 7);
        const branchId = resolveBranchId(item.branch || item.branchId || item.sucursal || item.branchName);
        const branchData = ensureBranchData(month, branchId);
        if (!branchData) return;

        if (item.category) {
            const amount = accountingAmount(item);
            const categoryInfo = addCategoryAmount(branchData.expenseTree, item, amount);
            branchData.totalExpense += amount;
            branchData.expenseDetails[categoryInfo.category] = (branchData.expenseDetails[categoryInfo.category] || 0) + amount;
            branchData.rawExpenses.push({
                ...item,
                dateStr: dateString,
                amount,
                category: categoryInfo.category,
                categoria: categoryInfo.category,
                subcategory: categoryInfo.subcategory,
                subcategoria: categoryInfo.subcategory,
                categoryLabel: categoryInfo.label,
            });
        } else {
            branchData.totalIncome += accountingAmount(item);
        }
    });

    inventarios.forEach(item => {
        const month = item.month || item.mes;
        const branchId = resolveBranchId(item.branch || item.branchId || item.sucursal || item.branchName);
        const branchData = ensureBranchData(month, branchId);
        if (!branchData) return;

        if (item.type === 'inicial') branchData.initialInventory = peso(item.amount);
        else if (item.type === 'final') branchData.finalInventory = peso(item.amount);
    });

    compras.forEach(item => {
        const month = getMonthString(item, ['date', 'fecha']);
        const branchId = resolveBranchId(item.branch || item.branchId || item.sucursal || item.branchName);
        const amount = accountingAmount(item);

        if (!amount || !month) return;
        results[month] = results[month] || {};

        if (!branchId) {
            legacyPurchasesByMonth[month] = (legacyPurchasesByMonth[month] || 0) + amount;
            return;
        }

        const branchData = ensureBranchData(month, branchId);
        if (!branchData) return;
        const categoryInfo = getExpenseCategoryFromRecord(item, DEFAULT_PURCHASE_CATEGORY_ID);
        if (categoryInfo.category === 'Costos de venta / compras') {
            branchData.totalPurchases += amount;
            addCategoryAmount(branchData.costTree, item, amount, DEFAULT_PURCHASE_CATEGORY_ID);
        } else {
            branchData.totalExpense += amount;
            addCategoryAmount(branchData.expenseTree, item, amount);
            branchData.expenseDetails[categoryInfo.category] = (branchData.expenseDetails[categoryInfo.category] || 0) + amount;
            branchData.rawExpenses.push({
                ...item,
                dateStr: getDateString(item.date || item.fecha),
                amount,
                category: categoryInfo.category,
                categoria: categoryInfo.category,
                subcategory: categoryInfo.subcategory,
                subcategoria: categoryInfo.subcategory,
                categoryLabel: categoryInfo.label,
            });
        }
    });

    purchaseDiscountEntries.forEach(item => {
        const month = getMonthString(item, ['date', 'fecha']);
        const branchId = resolveBranchId(item.branch || item.branchId || item.sucursal || item.branchName);
        const amount = accountingAmount(item);

        if (!amount || !month) return;
        results[month] = results[month] || {};

        if (!branchId) {
            legacyPurchasesByMonth[month] = (legacyPurchasesByMonth[month] || 0) - amount;
            return;
        }

        const branchData = ensureBranchData(month, branchId);
        if (!branchData) return;
        branchData.totalPurchases -= amount;
        addCategoryAmount(branchData.costTree, {
            ...item,
            ...PURCHASE_DISCOUNT_CATEGORY_RECORD,
        }, -amount, DEFAULT_PURCHASE_CATEGORY_ID);
    });

    facturasCredito.forEach(item => {
        if (item.id && mirroredFacturaIds.has(item.id)) return;

        const month = getMonthString(item, ['fecha', 'date']);
        const branchId = resolveBranchId(item.branch || item.branchId || item.sucursal || item.branchName);
        const amount = accountingAmount(item);

        if (!amount || !month) return;
        results[month] = results[month] || {};

        if (!branchId) {
            legacyPurchasesByMonth[month] = (legacyPurchasesByMonth[month] || 0) + amount;
            return;
        }

        const branchData = ensureBranchData(month, branchId);
        if (!branchData) return;
        const categoryInfo = getExpenseCategoryFromRecord(item, DEFAULT_PURCHASE_CATEGORY_ID);
        if (categoryInfo.category === 'Costos de venta / compras') {
            branchData.totalPurchases += amount;
            addCategoryAmount(branchData.costTree, item, amount, DEFAULT_PURCHASE_CATEGORY_ID);
        } else {
            branchData.totalExpense += amount;
            addCategoryAmount(branchData.expenseTree, item, amount);
            branchData.expenseDetails[categoryInfo.category] = (branchData.expenseDetails[categoryInfo.category] || 0) + amount;
            branchData.rawExpenses.push({
                ...item,
                dateStr: getDateString(item.fecha || item.date),
                amount,
                category: categoryInfo.category,
                categoria: categoryInfo.category,
                subcategory: categoryInfo.subcategory,
                subcategoria: categoryInfo.subcategory,
                categoryLabel: categoryInfo.label,
            });
        }
    });

    traspasosCostos.forEach((item) => {
        if (String(item.status || 'activo').toLowerCase() === 'anulado') return;

        const month = getMonthString(item, ['date', 'fecha']);
        const amount = accountingAmount(item);
        const fromBranchId = resolveBranchId(item.fromBranchId || item.branchFrom || item.originBranchId || DEFAULT_BRANCH_ID);
        const toBranchId = resolveBranchId(item.toBranchId || item.branchTo || item.targetBranchId || DEFAULT_BRANCH_ID);

        if (!month || !amount || fromBranchId === toBranchId) return;

        const transferEntries = branchScope === CONSOLIDATED_BRANCH_ID
            ? [
                { branchId: fromBranchId, signedAmount: -amount, transferDirection: 'salida' },
                { branchId: toBranchId, signedAmount: amount, transferDirection: 'entrada' },
            ]
            : [
                fromBranchId === branchScope && { branchId: fromBranchId, signedAmount: -amount, transferDirection: 'salida' },
                toBranchId === branchScope && { branchId: toBranchId, signedAmount: amount, transferDirection: 'entrada' },
            ].filter(Boolean);

        transferEntries.forEach(({ branchId, signedAmount, transferDirection }) => {
            const branchData = ensureBranchData(month, branchId);
            if (!branchData) return;

            const transferRecord = {
                ...item,
                amount: signedAmount,
                monto: signedAmount,
                category: item.category || item.categoria || 'Costos de venta / compras',
                categoria: item.category || item.categoria || 'Costos de venta / compras',
                subcategory: item.subcategory || item.subcategoria || 'Otros costos de producto',
                subcategoria: item.subcategory || item.subcategoria || 'Otros costos de producto',
                expenseCategory: item.category || item.categoria || 'Costos de venta / compras',
                expenseSubcategory: item.subcategory || item.subcategoria || 'Otros costos de producto',
                categoryLabel: `${item.category || item.categoria || 'Costos de venta / compras'} / ${item.subcategory || item.subcategoria || 'Otros costos de producto'}`,
                transferDirection,
                description: item.description || `Traspaso de costo ${transferDirection}`,
            };

            branchData.totalPurchases += signedAmount;
            addCategoryAmount(branchData.costTree, transferRecord, signedAmount, DEFAULT_PURCHASE_CATEGORY_ID);
        });
    });

    return Object.entries(results).map(([month, branchesData]) => {
        const branchEntriesArray = Object.values(branchesData);
        const totalIncomeMonth = branchEntriesArray.reduce((sum, data) => sum + data.totalIncome, 0);
        const totalLegacyPurchases = legacyPurchasesByMonth[month] || 0;
        const monthlyBudget = budgetsByMonth[month] || {};

        const branchEntries = Object.entries(branchesData).map(([branchId, data]) => {
            const salesPercentage = totalIncomeMonth > 0 ? (data.totalIncome / totalIncomeMonth) : 0;
            const distributedLegacyPurchases = totalLegacyPurchases * salesPercentage;
            const initialInv = data.initialInventory || 0;
            const finalInv = data.finalInventory || 0;
            const totalPurchases = (data.totalPurchases || 0) + distributedLegacyPurchases;

            const COGS = initialInv + totalPurchases - finalInv;
            const grossProfit = data.totalIncome - COGS;
            const netProfit = grossProfit - data.totalExpense;

            return {
                month,
                branchId,
                branchName: branchName(branchId),
                totalIncome: data.totalIncome,
                totalExpense: data.totalExpense,
                initialInventory: initialInv,
                finalInventory: finalInv,
                totalPurchases: totalPurchases,
                COGS: COGS,
                grossProfit: grossProfit,
                netProfit: netProfit,
                expenseDetails: Object.entries(data.expenseDetails),
                expenseTree: data.expenseTree,
                costTree: data.costTree,
                rawExpenses: data.rawExpenses,
                budgets: monthlyBudget
            };
        });

        const totalInitialInv = branchEntries.reduce((sum, b) => sum + (b.initialInventory || 0), 0);
        const totalFinalInv = branchEntries.reduce((sum, b) => sum + (b.finalInventory || 0), 0);
        const totalExpenseMonth = branchEntries.reduce((sum, b) => sum + b.totalExpense, 0);
        const totalDirectPurchasesMonth = branchEntriesArray.reduce((sum, branchData) => sum + (branchData.totalPurchases || 0), 0);
        const totalPurchasesGlobal = totalDirectPurchasesMonth + totalLegacyPurchases;
        const COGS_consolidado = totalInitialInv + totalPurchasesGlobal - totalFinalInv;

        branchEntries.push({
            month,
            branchId: 'consolidado',
            branchName: 'Reporte Consolidado Mensual',
            isConsolidated: true,
            totalIncome: totalIncomeMonth,
            totalExpense: totalExpenseMonth,
            totalPurchases: totalPurchasesGlobal,
            initialInventory: totalInitialInv,
            finalInventory: totalFinalInv,
            COGS: COGS_consolidado,
            expenseDetails: [],
            expenseTree: mergeCategoryTrees(branchEntries.filter((b) => !b.isConsolidated).map((b) => b.expenseTree)),
            costTree: mergeCategoryTrees(branchEntries.filter((b) => !b.isConsolidated).map((b) => b.costTree)),
            rawExpenses: branchEntries.reduce((acc, b) => [...acc, ...b.rawExpenses], []),
            budgets: monthlyBudget
        });

        return branchEntries;
    }).flat().sort((a, b) => b.month.localeCompare(a.month));
};

const getDocDate = (item) => {
    const dateValue = item.date || item.fecha || item.saleDate || item.month || item.mes || '';
    if (typeof dateValue === 'string') return dateValue;
    if (dateValue?.toDate) return dateValue.toDate().toISOString().substring(0, 10);
    return '';
};

const getDocMonth = (item) => {
    const date = getDocDate(item);
    return String(date || item.month || item.mes || '').substring(0, 7);
};

const buildTaxReport = (data, selectedMonth, branchScope = CONSOLIDATED_BRANCH_ID) => {
    const inMonth = (item) => !selectedMonth || getDocMonth(item) === selectedMonth;
    const accountingAmount = (item) => peso(item.subtotal ?? item.amount ?? item.monto);
    const fiscalTotal = (item) => peso(item.total ?? item.monto ?? item.amount);
    const fiscalIva = (item) => peso(item.iva);
    const invoiceLabel = (item) => item.invoiceNumber || item.numeroFactura || item.factura || item.numero || item.reference || item.dailySaleCode || '';
    const dailySaleKey = (item) => item.dailySaleCode || item.reference || (getDocDate(item) ? `VENTA-${getDocDate(item).replaceAll('-', '')}` : '');
    const salesIncomeEntries = resolveSalesIncomeEntries(data.ingresos || []);
    const purchaseDiscountEntries = resolvePurchaseDiscountEntries(data.ingresos || []);
    const reportBranchLabel = (item) => getBranchById(getRecordBranchId(item)).shortName;

    const incomeRows = salesIncomeEntries
        .filter(inMonth)
        .map((item) => ({
            sucursal: reportBranchLabel(item),
            type: 'IVA vendido',
            date: getDocDate(item),
            source: item.source === 'sicar' ? 'SICAR venta diaria' : 'Ingreso manual',
            document: item.dailySaleCode || item.reference || item.id || '',
            description: item.description || item.detalle || '',
            subtotal: accountingAmount(item),
            iva: fiscalIva(item),
            total: fiscalTotal(item),
        }));

    const dailySales = salesIncomeEntries
        .filter(inMonth)
        .filter((item) => item.source === 'sicar' || item.sourceType === 'daily_sale' || item.dailySaleCode)
        .map((item) => ({
            id: item.id || '',
            date: getDocDate(item),
            dailySaleCode: dailySaleKey(item),
            subtotal: accountingAmount(item),
            iva: fiscalIva(item),
            total: fiscalTotal(item),
        }));

    const purchaseDiscountRows = purchaseDiscountEntries
        .filter(inMonth)
        .map((item) => ({
            sucursal: reportBranchLabel(item),
            type: 'Descuento sobre compras',
            date: getDocDate(item),
            source: item.sourceLabel || 'Ajuste manual',
            document: item.reference || item.referencia || item.id || '',
            description: item.description || item.detalle || 'DESCUENTO SOBRE COMPRAS',
            subtotal: accountingAmount(item),
            iva: fiscalIva(item),
            total: fiscalTotal(item),
        }));

    const dailySalesByCode = new Map(dailySales.map((item) => [item.dailySaleCode, item]));
    const dailySalesByDate = new Map(dailySales.map((item) => [item.date, item]));

    const purchaseRows = [...(data.compras || []), ...(data.gastos || [])]
        .filter(inMonth)
        .map((item) => ({
            sucursal: reportBranchLabel(item),
            type: item.supplier || item.proveedor ? 'IVA comprado' : 'IVA gasto',
            date: getDocDate(item),
            source: item.supplier || item.proveedor || item.category || 'Registro',
            document: invoiceLabel(item),
            description: item.description || item.descripcion || item.category || '',
            subtotal: accountingAmount(item),
            iva: fiscalIva(item),
            total: fiscalTotal(item),
        }));

    const stampedInvoiceRows = (data.facturas_membretadas_ventas || [])
        .filter(inMonth)
        .map((item) => {
            const date = getDocDate(item);
            const saleDate = item.saleDate || date;
            const linkedDailySale = dailySalesByCode.get(item.dailySaleCode) || dailySalesByDate.get(saleDate) || {};
            const branch = getBranchById(getRecordBranchId(item));
            const subtotal = accountingAmount(item);
            const iva = fiscalIva(item);
            const total = fiscalTotal(item);
            const retentionIr2 = peso(item.retentionIr2);
            const retentionMunicipal1 = peso(item.retentionMunicipal1);
            const retentionTotal = peso(item.retentionTotal ?? (retentionIr2 + retentionMunicipal1));
            const paymentRows = normalizePaymentBreakdownRows(item.paymentBreakdown);

            return {
                sucursal: branch.shortName,
                serie: item.invoiceSeries || item.documentSeries || branch.invoiceSeries || '',
                date: saleDate || date,
                dailySaleCode: item.dailySaleCode || linkedDailySale.dailySaleCode || (saleDate ? `VENTA-${saleDate.replaceAll('-', '')}` : ''),
                document: item.numeroFactura || item.invoiceNumber || '',
                paymentMethod: paymentMethodLabel(item),
                paymentDetail: paymentRows.length ? paymentRows.map((row) => `${row.method} ${fmt(row.amount)}`).join(' / ') : (item.paymentMethod || ''),
                paymentNetTotal: paymentBreakdownTotal(paymentRows) || invoicePaymentTarget(item),
                [PAYMENT_ROWS_SYMBOL]: paymentRows,
                subtotal,
                iva,
                total,
                retentionIr2,
                retentionMunicipal1,
                retentionTotal,
                netTotal: peso(total - retentionTotal),
            };
        })
        .sort((a, b) => `${a.date}-${a.document}`.localeCompare(`${b.date}-${b.document}`));

    const stampedInvoicesByDay = stampedInvoiceRows.reduce((acc, row) => {
        const key = `${row.sucursal || 'Sucursal'}|${row.serie || ''}|${row.dailySaleCode || row.date || 'SIN VENTA'}`;
        if (!acc[key]) {
            acc[key] = {
                sucursal: row.sucursal,
                serie: row.serie,
                date: row.date,
                dailySaleCode: row.dailySaleCode || row.date || 'SIN VENTA',
                invoiceCount: 0,
                subtotal: 0,
                iva: 0,
                total: 0,
                retentionIr2: 0,
                retentionMunicipal1: 0,
                retentionTotal: 0,
                netTotal: 0,
                paymentMethods: [],
            };
        }

        acc[key].invoiceCount += 1;
        if (row.paymentMethod && !acc[key].paymentMethods.includes(row.paymentMethod)) {
            acc[key].paymentMethods.push(row.paymentMethod);
        }
        acc[key].subtotal += row.subtotal;
        acc[key].iva += row.iva;
        acc[key].total += row.total;
        acc[key].retentionIr2 += row.retentionIr2;
        acc[key].retentionMunicipal1 += row.retentionMunicipal1;
        acc[key].retentionTotal += row.retentionTotal;
        acc[key].netTotal += row.netTotal;
        return acc;
    }, {});

    const stampedInvoiceDailyRows = Object.values(stampedInvoicesByDay)
        .map((row) => ({
            ...row,
            subtotal: peso(row.subtotal),
            iva: peso(row.iva),
            total: peso(row.total),
            retentionIr2: peso(row.retentionIr2),
            retentionMunicipal1: peso(row.retentionMunicipal1),
            retentionTotal: peso(row.retentionTotal),
            netTotal: peso(row.netTotal),
            paymentMethods: row.paymentMethods.join(' / '),
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

    const stampedInvoicePaymentSummaryRows = [
        ['VENTAS POS BAC', 'POS BAC'],
        ['VENTAS POS BANPRO', 'POS BANPRO'],
        ['VENTAS POS LAFISE', 'POS LAFISE'],
        ['VENTAS TRANSFERENCIA BAC', 'TRANSFERENCIA BAC'],
        ['VENTAS TRANSFERENCIA BANPRO', 'TRANSFERENCIA BANPRO'],
        ['VENTAS TRANSFERENCIA LAFISE', 'TRANSFERENCIA LAFISE'],
        ['VENTAS EFECTIVO', 'EFECTIVO'],
        ['VENTAS CREDITO', 'CREDITO'],
    ].map(([label, method]) => ({
        ITEM: label,
        TOTAL: peso(stampedInvoiceRows
            .reduce((sum, row) => {
                const rows = row[PAYMENT_ROWS_SYMBOL] || [];
                if (rows.length) {
                    return sum + rows
                        .filter((payment) => normalizeReportText(payment.method) === normalizeReportText(method))
                        .reduce((paymentSum, payment) => paymentSum + peso(payment.amount), 0);
                }
                return normalizeReportText(row.paymentMethod) === normalizeReportText(method)
                    ? sum + peso(row.paymentNetTotal || row.total)
                    : sum;
            }, 0)),
    }));

    stampedInvoicePaymentSummaryRows.push(
        {
            ITEM: 'TOTAL RETENCION MUNICIPAL',
            TOTAL: peso(stampedInvoiceRows.reduce((sum, row) => sum + peso(row.retentionMunicipal1), 0)),
        },
        {
            ITEM: 'TOTAL RETENCION IR 2',
            TOTAL: peso(stampedInvoiceRows.reduce((sum, row) => sum + peso(row.retentionIr2), 0)),
        }
    );

    const salesRetentionRows = (data.facturas_membretadas_ventas || [])
        .filter(inMonth)
        .map((item) => ({
            sucursal: reportBranchLabel(item),
            type: 'Retencion venta',
            date: getDocDate(item),
            source: item.dailySaleCode || 'Factura membretada',
            document: item.numeroFactura || '',
            subtotal: accountingAmount(item),
            retentionIr2: peso(item.retentionIr2),
            retentionMunicipal1: peso(item.retentionMunicipal1),
            retentionTotal: peso(item.retentionTotal ?? (peso(item.retentionIr2) + peso(item.retentionMunicipal1))),
            paymentMethod: item.paymentMethod || '',
        }))
        .filter((item) => item.retentionTotal > 0);

    const cashReceiptRetentionRows = (data.recibos_caja_membretados || [])
        .filter(inMonth)
        .map((item) => ({
            sucursal: reportBranchLabel(item),
            type: 'Retencion venta',
            date: getDocDate(item),
            source: 'Recibo de caja',
            document: item.receiptNumber || item.numeroRecibo || '',
            subtotal: peso(item.amount ?? item.cantidad),
            retentionIr2: peso(item.retentionIr2 ?? item.retencionIr2),
            retentionMunicipal1: peso(item.retentionMunicipal1 ?? item.retencionMunicipal1),
            retentionTotal: peso(item.retentionTotal ?? item.retencionTotal ?? (peso(item.retentionIr2 ?? item.retencionIr2) + peso(item.retentionMunicipal1 ?? item.retencionMunicipal1))),
            paymentMethod: item.paymentMethod || item.metodoPago || '',
        }))
        .filter((item) => item.retentionTotal > 0);

    const combinedSalesRetentionRows = [...salesRetentionRows, ...cashReceiptRetentionRows]
        .sort((a, b) => `${a.date}-${a.document}`.localeCompare(`${b.date}-${b.document}`));

    const purchaseRetentionRows = [...(data.compras || []), ...(data.gastos || [])]
        .filter(inMonth)
        .map((item) => ({
            sucursal: reportBranchLabel(item),
            type: 'Retencion compra/gasto',
            date: getDocDate(item),
            source: item.supplier || item.proveedor || item.category || '',
            document: invoiceLabel(item),
            subtotal: accountingAmount(item),
            retentionIr2: peso(item.retentionIr2),
            retentionMunicipal1: peso(item.retentionMunicipal1),
            retentionTotal: peso(item.retentionTotal ?? (peso(item.retentionIr2) + peso(item.retentionMunicipal1))),
            paymentMethod: item.paymentType || '',
        }))
        .filter((item) => item.retentionTotal > 0);

    const sumBy = (rows, key) => rows.reduce((sum, row) => sum + peso(row[key]), 0);
    const ivaSold = sumBy(incomeRows, 'iva');
    const ivaBought = sumBy(purchaseRows, 'iva');
    const salesSubtotal = sumBy(incomeRows, 'subtotal');
    const purchaseCategoryTree = {};
    const operatingExpenseTree = {};
    let purchaseSubtotal = 0;
    let operatingExpenseSubtotal = 0;
    let depreciationAmortization = 0;

    (data.compras || [])
        .filter(inMonth)
        .forEach((item) => {
            const amount = accountingAmount(item);
            if (isCostCategory(item)) {
                purchaseSubtotal += amount;
                addCategoryAmount(purchaseCategoryTree, item, amount, DEFAULT_PURCHASE_CATEGORY_ID);
            } else {
                operatingExpenseSubtotal += amount;
                if (isDepreciationOrAmortization(item)) depreciationAmortization += amount;
                addCategoryAmount(operatingExpenseTree, item, amount);
            }
        });
    (data.gastos || [])
        .filter(inMonth)
        .forEach((item) => {
            const amount = accountingAmount(item);
            operatingExpenseSubtotal += amount;
            if (isDepreciationOrAmortization(item)) depreciationAmortization += amount;
            addCategoryAmount(operatingExpenseTree, item, amount);
        });
    const purchaseDiscountSubtotal = sumBy(purchaseDiscountRows, 'subtotal');
    purchaseDiscountRows.forEach((item) => {
        const amount = peso(item.subtotal);
        if (!amount) return;
        purchaseSubtotal -= amount;
        addCategoryAmount(purchaseCategoryTree, {
            ...item,
            ...PURCHASE_DISCOUNT_CATEGORY_RECORD,
        }, -amount, DEFAULT_PURCHASE_CATEGORY_ID);
    });
    (data[BRANCH_COST_TRANSFER_COLLECTION] || [])
        .filter(inMonth)
        .filter((item) => String(item.status || 'activo').toLowerCase() !== 'anulado')
        .forEach((item) => {
            const amount = accountingAmount(item);
            if (!amount) return;

            const categoryRecord = {
                ...item,
                category: item.category || item.categoria || 'Costos de venta / compras',
                categoria: item.category || item.categoria || 'Costos de venta / compras',
                subcategory: item.subcategory || item.subcategoria || 'Otros costos de producto',
                subcategoria: item.subcategory || item.subcategoria || 'Otros costos de producto',
                expenseCategory: item.category || item.categoria || 'Costos de venta / compras',
                expenseSubcategory: item.subcategory || item.subcategoria || 'Otros costos de producto',
            };

            if (branchScope === CONSOLIDATED_BRANCH_ID) return;

            const fromBranchId = resolveBranchId(item.fromBranchId || item.branchFrom || item.originBranchId || DEFAULT_BRANCH_ID);
            const toBranchId = resolveBranchId(item.toBranchId || item.branchTo || item.targetBranchId || DEFAULT_BRANCH_ID);
            const signedAmount = fromBranchId === branchScope ? -amount : toBranchId === branchScope ? amount : 0;
            if (!signedAmount) return;

            purchaseSubtotal += signedAmount;
            addCategoryAmount(purchaseCategoryTree, {
                ...categoryRecord,
                amount: signedAmount,
                monto: signedAmount,
                transferDirection: signedAmount > 0 ? 'entrada' : 'salida',
            }, signedAmount, DEFAULT_PURCHASE_CATEGORY_ID);
        });
    const stampedInvoiceTotal = sumBy(stampedInvoiceRows, 'total');
    const grossProfit = salesSubtotal - purchaseSubtotal;
    const operatingProfit = grossProfit - operatingExpenseSubtotal;
    const ebitda = operatingProfit + depreciationAmortization;
    const municipalTax = salesSubtotal * 0.01;
    const profitBeforeTax = operatingProfit;
    const profitAfterMunicipal = profitBeforeTax - municipalTax;
        const incomeTax30 = profitAfterMunicipal > 0 ? profitAfterMunicipal * 0.30 : 0;

    return {
        ivaRows: [...incomeRows, ...purchaseRows],
        retentionRows: [...combinedSalesRetentionRows, ...purchaseRetentionRows],
        retentionSalesRows: combinedSalesRetentionRows,
        retentionPurchaseRows: purchaseRetentionRows,
        stampedInvoiceRows,
        stampedInvoiceDailyRows,
        stampedInvoicePaymentSummaryRows,
        purchaseCategoryRows: categoryTreeToRows(purchaseCategoryTree),
        operatingExpenseRows: categoryTreeToRows(operatingExpenseTree),
        totals: {
            ivaSold,
            ivaBought,
            ivaNet: ivaSold - ivaBought,
            retentionSales: sumBy(combinedSalesRetentionRows, 'retentionTotal'),
            retentionPurchases: sumBy(purchaseRetentionRows, 'retentionTotal'),
            stampedInvoiceCount: stampedInvoiceRows.length,
            stampedInvoiceSubtotal: sumBy(stampedInvoiceRows, 'subtotal'),
            stampedInvoiceIva: sumBy(stampedInvoiceRows, 'iva'),
            stampedInvoiceTotal,
            stampedInvoiceRetentions: sumBy(stampedInvoiceRows, 'retentionTotal'),
            stampedInvoiceNet: sumBy(stampedInvoiceRows, 'netTotal'),
            salesSubtotal,
            purchaseSubtotal,
            purchaseDiscountSubtotal,
            operatingExpenseSubtotal,
            grossProfit,
            operatingProfit,
            depreciationAmortization,
            ebitda,
            profitBeforeTax,
            municipalTax,
            profitAfterMunicipal,
            incomeTax30,
            netProfitAfterTax: profitAfterMunicipal - incomeTax30,
        }
    };
};

const downloadCsv = (filename, rows) => {
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
};

const escapeXml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const isCurrencyHeader = (header = '') => (
    ['subtotal', 'iva', 'total', 'retentionir2', 'retentionmunicipal1', 'retentiontotal', 'nettotal'].includes(normalizeReportText(header).replace(/[^A-Z0-9]/g, '').toLowerCase())
);

const safeSheetName = (value = 'Reporte') => (
    String(value || 'Reporte')
        .replace(/[\\/?*[\]:]/g, ' ')
        .trim()
        .slice(0, 31) || 'Reporte'
);

const buildWorksheetXml = ({ name = 'Reporte', rows = [] }) => {
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const rowXml = [
        `<Row>${headers.map((header) => `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(header)}</Data></Cell>`).join('')}</Row>`,
        ...rows.map((row) => (
            `<Row>${headers.map((header) => {
                const value = row[header];
                const isNumber = typeof value === 'number' && Number.isFinite(value);
                const style = isNumber && isCurrencyHeader(header) ? 'Currency' : 'Text';
                return `<Cell ss:StyleID="${style}"><Data ss:Type="${isNumber ? 'Number' : 'String'}">${escapeXml(value)}</Data></Cell>`;
            }).join('')}</Row>`
        )),
    ].join('');

    return `<Worksheet ss:Name="${escapeXml(safeSheetName(name))}">
        <Table>${rowXml}</Table>
        <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
            <Selected/>
            <Panes><Pane><Number>3</Number><ActiveRow>1</ActiveRow></Pane></Panes>
        </WorksheetOptions>
    </Worksheet>`;
};

const downloadXls = (filename, rowsOrSheets, sheetName = 'Reporte') => {
    const sheets = Array.isArray(rowsOrSheets) && rowsOrSheets.some((item) => item?.rows)
        ? rowsOrSheets
        : [{ name: sheetName, rows: rowsOrSheets || [] }];
    const filledSheets = sheets.filter((sheet) => (sheet.rows || []).length);
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
    ${filledSheets.map(buildWorksheetXml).join('')}
</Workbook>`;
    const blob = new Blob([workbook], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
};

const TaxIncomeFlowDiagram = ({ totals, selectedMonth }) => {
    const maxValue = Math.max(
        Math.abs(totals.salesSubtotal || 0),
        Math.abs(totals.purchaseSubtotal || 0),
        Math.abs(totals.profitBeforeTax || 0),
        Math.abs(totals.netProfitAfterTax || 0),
        1
    );
    const ribbon = (value, min = 10, max = 58) => Math.max(min, Math.min(max, (Math.abs(value) / maxValue) * max));
    const margin = totals.salesSubtotal > 0 ? (totals.netProfitAfterTax / totals.salesSubtotal) * 100 : 0;
    const profitColor = totals.netProfitAfterTax >= 0 ? '#16a34a' : '#dc2626';

    return (
        <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-[#f7f9fb] shadow-xl shadow-slate-900/5">
            <div className="border-b border-slate-200 bg-white px-5 py-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.35em] text-slate-400">Income statement flow</div>
                        <h3 className="mt-1 text-2xl font-black text-slate-900">Estado de resultado tributario</h3>
                        <p className="text-xs font-semibold text-slate-500">Periodo {selectedMonth || 'Todos'} ? ventas subtotal, IMI 1% e IR 30%</p>
                    </div>
                    <div className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-wider ${totals.netProfitAfterTax >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                        Margen neto {margin.toFixed(1)}%
                    </div>
                </div>
            </div>

            <div className="relative min-h-[430px] overflow-x-auto overflow-y-hidden bg-gradient-to-br from-white via-[#f8fbff] to-[#fff5ec] p-4 md:p-6">
                <div className="absolute inset-0 opacity-70" style={{ backgroundImage: 'linear-gradient(#e8eef5 1px, transparent 1px), linear-gradient(90deg, #e8eef5 1px, transparent 1px)', backgroundSize: '30px 30px' }} />
                <svg className="relative h-[390px] min-w-[760px] w-full" viewBox="0 0 1100 390" role="img" aria-label="Diagrama de estado de resultado tributario">
                    <defs>
                        <filter id="flowShadow" x="-20%" y="-20%" width="140%" height="140%">
                            <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#0f172a" floodOpacity="0.16" />
                        </filter>
                        <linearGradient id="salesRibbon" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.86" />
                            <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.48" />
                        </linearGradient>
                        <linearGradient id="profitRibbon" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#86efac" stopOpacity="0.78" />
                            <stop offset="100%" stopColor={profitColor} stopOpacity="0.64" />
                        </linearGradient>
                        <linearGradient id="costRibbon" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.72" />
                            <stop offset="100%" stopColor="#ef4444" stopOpacity="0.62" />
                        </linearGradient>
                    </defs>

                    <path d="M135 174 C250 118, 325 118, 445 170" fill="none" stroke="url(#salesRibbon)" strokeWidth={ribbon(totals.salesSubtotal, 38, 78)} strokeLinecap="round" filter="url(#flowShadow)" />
                    <path d="M470 184 C585 120, 645 90, 770 86" fill="none" stroke="url(#costRibbon)" strokeWidth={ribbon(totals.purchaseSubtotal, 18, 54)} strokeLinecap="round" opacity="0.9" />
                    <path d="M470 202 C600 202, 662 210, 790 218" fill="none" stroke="#ef4444" strokeWidth={ribbon(totals.municipalTax + totals.incomeTax30, 8, 28)} strokeLinecap="round" opacity="0.72" />
                    <path d="M470 230 C604 300, 730 316, 902 282" fill="none" stroke="url(#profitRibbon)" strokeWidth={ribbon(totals.netProfitAfterTax, 18, 60)} strokeLinecap="round" filter="url(#flowShadow)" />

                    <rect x="44" y="115" width="190" height="120" rx="18" fill="#0ea5e9" filter="url(#flowShadow)" />
                    <text x="72" y="152" fill="white" fontSize="15" fontWeight="800" letterSpacing="1.5">VENTAS SUBTOTAL</text>
                    <text x="72" y="188" fill="white" fontSize="27" fontWeight="900">{fmt(totals.salesSubtotal)}</text>
                    <text x="72" y="214" fill="rgba(255,255,255,.78)" fontSize="13" fontWeight="700">Base contable sin IVA</text>

                    <rect x="385" y="142" width="170" height="130" rx="18" fill="#334155" filter="url(#flowShadow)" />
                    <text x="414" y="178" fill="white" fontSize="14" fontWeight="800" letterSpacing="1.5">UTILIDAD</text>
                    <text x="414" y="200" fill="rgba(255,255,255,.7)" fontSize="12" fontWeight="700">antes de impuesto</text>
                    <text x="414" y="236" fill="white" fontSize="25" fontWeight="900">{fmt(totals.profitBeforeTax)}</text>

                    <rect x="770" y="44" width="230" height="84" rx="16" fill="#fff7ed" stroke="#fed7aa" />
                    <text x="798" y="76" fill="#9a3412" fontSize="13" fontWeight="900" letterSpacing="1.4">COSTO SUBTOTAL</text>
                    <text x="798" y="105" fill="#9a3412" fontSize="23" fontWeight="900">{fmt(totals.purchaseSubtotal)}</text>

                    <rect x="790" y="176" width="230" height="104" rx="16" fill="#fff1f2" stroke="#fecdd3" />
                    <text x="818" y="207" fill="#be123c" fontSize="13" fontWeight="900" letterSpacing="1.4">IMPUESTOS</text>
                    <text x="818" y="232" fill="#be123c" fontSize="18" fontWeight="900">IMI {fmt(totals.municipalTax)}</text>
                    <text x="818" y="255" fill="#be123c" fontSize="18" fontWeight="900">IR {fmt(totals.incomeTax30)}</text>

                    <rect x="900" y="292" width="184" height="76" rx="18" fill={profitColor} filter="url(#flowShadow)" />
                    <text x="925" y="322" fill="white" fontSize="13" fontWeight="900" letterSpacing="1.4">UTILIDAD NETA</text>
                    <text x="925" y="350" fill="white" fontSize="23" fontWeight="900">{fmt(totals.netProfitAfterTax)}</text>
                </svg>
            </div>
        </div>
    );
};

const TaxStatementPrintableReport = ({ taxReport, selectedMonth, onPrint }) => {
    const totalTaxes = taxReport.totals.municipalTax + taxReport.totals.incomeTax30;
    const printedAt = new Date().toLocaleDateString('es-NI', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });

    const Line = ({ label, value, tone = 'default', strong = false, indent = false, category = false, plainAmount = false }) => (
        <tr className={`${strong ? 'bg-slate-50' : ''} ${tone === 'final' ? 'bg-emerald-50' : ''}`}>
            <td className={`tax-pdf-cell ${
                indent
                    ? 'pl-10 text-[11px] font-semibold text-slate-600'
                    : category
                        ? 'pl-5 font-black text-slate-800'
                        : 'font-bold text-slate-800'
            } ${(strong && !category) || tone === 'final' ? 'uppercase tracking-wide' : ''}`}>
                {label}
            </td>
            <td className={`tax-pdf-cell text-right font-black ${tone === 'negative' ? 'text-rose-700' : tone === 'final' ? 'text-emerald-700' : 'text-slate-900'}`}>
                {tone === 'negative' && value > 0 && !plainAmount ? `(${fmt(value)})` : fmt(value)}
            </td>
        </tr>
    );

    const CategoryLines = ({ rows = [], emptyLabel = 'Sin subcategorias registradas' }) => {
        if (!rows.length) {
            return <Line label={emptyLabel} value={0} indent plainAmount />;
        }

        return rows.map((row) => (
            <React.Fragment key={`category-${row.category}`}>
                <Line label={row.category} value={row.total} category plainAmount />
                {(row.subcategories || []).map((subNode) => (
                    <Line
                        key={`subcategory-${row.category}-${subNode.subcategory}`}
                        label={`- ${subNode.subcategory}`}
                        value={subNode.total}
                        indent
                        plainAmount
                    />
                ))}
            </React.Fragment>
        ));
    };

    return (
        <Card
            title="Reporte fiscal para PDF"
            subtitle="Formato carta con desglose completo para soporte fiscal"
            icon="receipt"
            className="tax-statement-report"
            right={
                <button
                    type="button"
                    onClick={onPrint}
                    className="no-print rounded-lg bg-[#e30613] px-3 py-1.5 text-xs font-bold text-white"
                >
                    Exportar PDF / Imprimir
                </button>
            }
        >
            <div className="tax-pdf-page rounded-2xl border border-slate-200 bg-white p-6 text-slate-900">
                <header className="mb-5 flex items-start justify-between gap-4 border-b-2 border-slate-900 pb-4">
                    <div className="flex items-center gap-3">
                        <img src={APP_BRAND_LOGO} alt={APP_BRAND_NAME} className="h-16 w-16 rounded-xl border border-slate-200 object-contain p-1.5" />
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.32em] text-[#e30613]">{APP_BRAND_NAME}</div>
                            <h2 className="mt-1 text-2xl font-black uppercase tracking-tight text-slate-950">Estado de resultado fiscal</h2>
                            <p className="mt-1 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Soporte fiscal para impresion / PDF</p>
                        </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-right">
                        <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Periodo</div>
                        <div className="text-lg font-black text-[#9f111a]">{selectedMonth || 'Todos'}</div>
                        <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Emitido</div>
                        <div className="text-xs font-bold text-slate-600">{printedAt}</div>
                    </div>
                </header>

                <section className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div className="tax-pdf-kpi">
                        <div>Ingresos</div>
                        <strong>{fmt(taxReport.totals.salesSubtotal)}</strong>
                    </div>
                    <div className="tax-pdf-kpi">
                        <div>Costo ventas</div>
                        <strong>{fmt(taxReport.totals.purchaseSubtotal)}</strong>
                    </div>
                    <div className="tax-pdf-kpi">
                        <div>Gastos operativos</div>
                        <strong>{fmt(taxReport.totals.operatingExpenseSubtotal)}</strong>
                    </div>
                    <div className="tax-pdf-kpi">
                        <div>Utilidad neta</div>
                        <strong>{fmt(taxReport.totals.netProfitAfterTax)}</strong>
                    </div>
                </section>

                <div className="overflow-hidden rounded-xl border border-slate-200">
                    <table className="w-full border-collapse text-xs">
                        <thead>
                            <tr className="bg-slate-950 text-white">
                                <th className="tax-pdf-head text-left">Concepto</th>
                                <th className="tax-pdf-head text-right">Monto C$</th>
                            </tr>
                        </thead>
                        <tbody>
                            <Line label="Ingresos" value={taxReport.totals.salesSubtotal} strong />
                            <Line label="Ventas subtotal sin IVA" value={taxReport.totals.salesSubtotal} indent />

                            <Line label="Costo de ventas totalizado" value={taxReport.totals.purchaseSubtotal} tone="negative" strong />
                            <CategoryLines rows={taxReport.purchaseCategoryRows} emptyLabel="Sin subcategorias de costo registradas" />

                            <Line label="Utilidad bruta" value={taxReport.totals.grossProfit} strong />

                            <Line label="Gastos operativos totalizados" value={taxReport.totals.operatingExpenseSubtotal} tone="negative" strong />
                            <CategoryLines rows={taxReport.operatingExpenseRows} emptyLabel="Sin subcategorias de gasto registradas" />

                            <Line label="Utilidad operativa" value={taxReport.totals.operatingProfit} strong />
                            <Line label="Depreciacion y amortizaciones" value={taxReport.totals.depreciationAmortization} indent plainAmount />
                            <Line label="EBITDA" value={taxReport.totals.ebitda} strong />
                            <Line label="Impuestos" value={totalTaxes} tone="negative" strong />
                            <Line label="Impuesto municipal 1% sobre ingresos" value={taxReport.totals.municipalTax} tone="negative" indent />
                            <Line label="IR 30% sobre utilidad despues de IMI" value={taxReport.totals.incomeTax30} tone="negative" indent />
                            <Line label="Utilidad neta" value={taxReport.totals.netProfitAfterTax} tone="final" strong />
                        </tbody>
                    </table>
                </div>

                <footer className="mt-5 grid grid-cols-1 gap-3 text-[10px] font-semibold text-slate-500 md:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        Los ingresos se presentan sobre subtotal contable sin IVA. El IVA se controla en el reporte tributario correspondiente.
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        Documento generado desde el sistema contable CSM Granada para soporte interno y fiscal.
                    </div>
                </footer>
            </div>
        </Card>
    );
};

const TaxReportsPanel = ({ taxReport, taxTab, setTaxTab, selectedMonth, setSelectedMonth, availableMonths, scopeLabel }) => {
    const subTabs = ['IVA', 'Retenciones', 'Facturas membretadas', 'Resultado despues de impuestos'];
    const [retentionSubTab, setRetentionSubTab] = useState('ventas');
    const tableClass = "w-full text-sm";
    const thClass = "pb-3 text-left text-xs font-bold uppercase tracking-wider text-stone-500";
    const tdClass = "py-2.5 border-t border-stone-100 text-stone-700";
    const handlePrintStampedInvoices = () => {
        document.body.classList.add('print-stamped-tax-report');
        const cleanup = () => document.body.classList.remove('print-stamped-tax-report');
        window.addEventListener('afterprint', cleanup, { once: true });
        window.print();
        window.setTimeout(cleanup, 1000);
    };
    const handlePrintTaxStatement = () => {
        document.body.classList.add('print-tax-statement-report');
        const cleanup = () => document.body.classList.remove('print-tax-statement-report');
        window.addEventListener('afterprint', cleanup, { once: true });
        window.print();
        window.setTimeout(cleanup, 1000);
    };
    const activeRetentionRows = retentionSubTab === 'ventas'
        ? taxReport.retentionSalesRows
        : taxReport.retentionPurchaseRows;
    const activeRetentionTitle = retentionSubTab === 'ventas'
        ? 'Retenciones de ventas'
        : 'Retenciones de compras';
    const activeRetentionSlug = retentionSubTab === 'ventas' ? 'ventas' : 'compras';
    const activeRetentionHelp = retentionSubTab === 'ventas'
        ? 'Ventas incluye facturas membretadas y recibos de caja con retencion.'
        : 'Compras incluye compras y gastos con retenciones registradas.';

    return (
        <div className="animate-fade-in space-y-5">
            <div className="max-w-sm">
                <Select
                    label="Periodo Tributario"
                    icon="calendar"
                    value={selectedMonth || ''}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    options={availableMonths.map(month => (
                        <option key={month} value={month}>{month}</option>
                    ))}
                />
            </div>

            <div className="flex flex-wrap gap-2">
                {subTabs.map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setTaxTab(tab)}
                        className={`rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-wide transition ${
                            taxTab === tab ? 'bg-[#e30613] text-white' : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50'
                        }`}
                    >
                        {tab}
                    </button>
                ))}
            </div>

            {taxTab === 'IVA' && (
                <div className="space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <StatCard title="IVA Vendido" value={fmt(taxReport.totals.ivaSold)} icon="trendingUp" variant="success" />
                        <StatCard title="IVA Comprado" value={fmt(taxReport.totals.ivaBought)} icon="shoppingCart" variant="warning" />
                        <StatCard title="IVA Neto" value={fmt(taxReport.totals.ivaNet)} icon="receipt" variant={taxReport.totals.ivaNet >= 0 ? 'wine' : 'danger'} />
                    </div>
                    <Card
                        title="Detalle de IVA"
                        subtitle="Ventas, compras y gastos del periodo"
                        icon="receipt"
                        right={<button onClick={() => downloadCsv(`reporte-iva-${selectedMonth}.csv`, taxReport.ivaRows)} className="rounded-lg bg-[#e30613] px-3 py-1.5 text-xs font-bold text-white">Exportar CSV</button>}
                    >
                        <div className="overflow-x-auto">
                            <table className={tableClass}>
                                <thead>
                                    <tr>
                                        <th className={thClass}>Sucursal</th>
                                        <th className={thClass}>Tipo</th>
                                        <th className={thClass}>Fecha</th>
                                        <th className={thClass}>Documento</th>
                                        <th className={thClass}>Fuente</th>
                                        <th className={`${thClass} text-right`}>Subtotal</th>
                                        <th className={`${thClass} text-right`}>IVA</th>
                                        <th className={`${thClass} text-right`}>Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {taxReport.ivaRows.map((row, idx) => (
                                        <tr key={`${row.type}-${row.document}-${idx}`}>
                                            <td className={tdClass}>{row.sucursal || '-'}</td>
                                            <td className={tdClass}>{row.type}</td>
                                            <td className={tdClass}>{row.date}</td>
                                            <td className={tdClass}>{row.document || '-'}</td>
                                            <td className={tdClass}>{row.source}</td>
                                            <td className={`${tdClass} text-right font-semibold`}>{fmt(row.subtotal)}</td>
                                            <td className={`${tdClass} text-right font-semibold`}>{fmt(row.iva)}</td>
                                            <td className={`${tdClass} text-right font-semibold`}>{fmt(row.total)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                </div>
            )}

            {taxTab === 'Retenciones' && (
                <div className="space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <StatCard title="Retenciones Ventas" value={fmt(taxReport.totals.retentionSales)} icon="trendingUp" variant="success" />
                        <StatCard title="Retenciones Compras" value={fmt(taxReport.totals.retentionPurchases)} icon="shoppingCart" variant="warning" />
                        <StatCard title="Total Retenciones" value={fmt(taxReport.totals.retentionSales + taxReport.totals.retentionPurchases)} icon="receipt" variant="wine" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {[
                            { key: 'ventas', label: 'Retenciones de ventas' },
                            { key: 'compras', label: 'Retenciones de compras' },
                        ].map((tab) => (
                            <button
                                key={tab.key}
                                type="button"
                                onClick={() => setRetentionSubTab(tab.key)}
                                className={`rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-wide transition ${
                                    retentionSubTab === tab.key ? 'bg-[#9f111a] text-white' : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                    <Card
                        title={activeRetentionTitle}
                        subtitle={activeRetentionHelp}
                        icon="receipt"
                        right={(
                            <div className="flex flex-wrap gap-2">
                                <button onClick={() => downloadCsv(`retenciones-${activeRetentionSlug}-${selectedMonth || 'todos'}.csv`, activeRetentionRows)} className="rounded-lg bg-[#e30613] px-3 py-1.5 text-xs font-bold text-white">Exportar CSV</button>
                                <button onClick={() => downloadXls(`retenciones-${activeRetentionSlug}-${selectedMonth || 'todos'}.xls`, activeRetentionRows, activeRetentionTitle)} className="rounded-lg border border-[#e30613] px-3 py-1.5 text-xs font-bold text-[#e30613]">Exportar XLS</button>
                            </div>
                        )}
                    >
                        <div className="mb-4 rounded-xl border border-[#d8dee6] bg-[#f8fafc] p-4">
                            <div className="text-xs font-bold uppercase tracking-[0.3em] text-[#e30613]">{APP_BRAND_NAME}</div>
                            <div className="text-lg font-black text-[#111827]">{activeRetentionTitle}</div>
                            <div className="text-xs font-semibold text-stone-500">Periodo: {selectedMonth || 'Todos'}</div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className={tableClass}>
                                <thead>
                                    <tr>
                                        <th className={thClass}>Sucursal</th>
                                        <th className={thClass}>Tipo</th>
                                        <th className={thClass}>Fecha</th>
                                        <th className={thClass}>Documento</th>
                                        <th className={thClass}>Fuente</th>
                                        <th className={`${thClass} text-right`}>IR 2%</th>
                                        <th className={`${thClass} text-right`}>Municipal 1%</th>
                                        <th className={`${thClass} text-right`}>Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {activeRetentionRows.map((row, idx) => (
                                        <tr key={`${row.type}-${row.document}-${idx}`}>
                                            <td className={tdClass}>{row.sucursal || '-'}</td>
                                            <td className={tdClass}>{row.type}</td>
                                            <td className={tdClass}>{row.date}</td>
                                            <td className={tdClass}>{row.document || '-'}</td>
                                            <td className={tdClass}>{row.source}</td>
                                            <td className={`${tdClass} text-right font-semibold`}>{fmt(row.retentionIr2)}</td>
                                            <td className={`${tdClass} text-right font-semibold`}>{fmt(row.retentionMunicipal1)}</td>
                                            <td className={`${tdClass} text-right font-black text-[#9f111a]`}>{fmt(row.retentionTotal)}</td>
                                        </tr>
                                    ))}
                                    {activeRetentionRows.length === 0 && (
                                        <tr>
                                            <td colSpan="8" className="py-6 text-center text-sm font-semibold text-stone-400">
                                                No hay retenciones registradas en esta vista.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                </div>
            )}

            {taxTab === 'Facturas membretadas' && (
                <div className="space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <StatCard title="Facturas Emitidas" value={taxReport.totals.stampedInvoiceCount} icon="receipt" variant="wine" />
                        <StatCard title="Subtotal Facturado" value={fmt(taxReport.totals.stampedInvoiceSubtotal)} icon="trendingUp" variant="success" />
                        <StatCard title="IVA Facturado" value={fmt(taxReport.totals.stampedInvoiceIva)} icon="receipt" variant="warning" />
                        <StatCard title="Total Fiscal Membretado" value={fmt(taxReport.totals.stampedInvoiceTotal)} icon="wallet" variant="dark" />
                    </div>

                    <Card
                        title="Reporte Fiscal Membretado"
                        subtitle="El total de este reporte suma solo facturas membretadas registradas"
                        icon="receipt"
                        className="stamped-tax-report"
                        right={
                            <div className="no-print flex flex-wrap gap-2">
                                <button onClick={() => downloadCsv(`resumen-facturas-membretadas-${selectedMonth}.csv`, taxReport.stampedInvoiceDailyRows)} className="rounded-lg border border-[#e30613] px-3 py-1.5 text-xs font-bold text-[#e30613]">Exportar resumen</button>
                                <button onClick={() => downloadCsv(`facturas-membretadas-${selectedMonth}.csv`, taxReport.stampedInvoiceRows)} className="rounded-lg border border-[#e30613] px-3 py-1.5 text-xs font-bold text-[#e30613]">Exportar detalle</button>
                                <button onClick={() => downloadXls(`resumen-facturas-membretadas-${selectedMonth}.xls`, [
                                    { name: 'Resumen facturas', rows: taxReport.stampedInvoiceDailyRows },
                                    { name: 'Resumen pagos', rows: taxReport.stampedInvoicePaymentSummaryRows },
                                ])} className="rounded-lg border border-emerald-600 px-3 py-1.5 text-xs font-bold text-emerald-700">Resumen XLS</button>
                                <button onClick={() => downloadXls(`facturas-membretadas-${selectedMonth}.xls`, [
                                    { name: 'Detalle facturas', rows: taxReport.stampedInvoiceRows },
                                    { name: 'Resumen pagos', rows: taxReport.stampedInvoicePaymentSummaryRows },
                                ])} className="rounded-lg border border-emerald-600 px-3 py-1.5 text-xs font-bold text-emerald-700">Detalle XLS</button>
                                <button onClick={handlePrintStampedInvoices} className="rounded-lg bg-[#e30613] px-3 py-1.5 text-xs font-bold text-white">Imprimir membretado</button>
                            </div>
                        }
                    >
                        <div className="mb-5 rounded-2xl border border-[#d6b8a7] bg-gradient-to-br from-white via-[#f8fafc] to-[#f7e8dc] p-5">
                            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                                <div className="flex items-center gap-4">
                                    <img src={APP_BRAND_LOGO} alt={APP_BRAND_NAME} className="h-20 w-20 rounded-2xl border border-[#d8dee6] bg-white object-contain p-2 shadow-sm" />
                                    <div>
                                        <div className="text-xs font-black uppercase tracking-[0.35em] text-[#e30613]">{APP_BRAND_NAME}</div>
                                        <div className="mt-1 text-2xl font-black uppercase text-[#111827]">Reporte de facturas membretadas</div>
                                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Documento de soporte fiscal para agentes fiscales</div>
                                    </div>
                                </div>
                                <div className="rounded-xl border border-[#d8dee6] bg-white/80 px-4 py-3 text-left md:text-right">
                                    <div className="text-xs font-bold uppercase tracking-wider text-stone-500">Periodo fiscal</div>
                                    <div className="text-xl font-black text-[#9f111a]">{selectedMonth || 'Todos'}</div>
                                    <div className="mt-1 text-xs font-black uppercase tracking-[0.18em] text-slate-600">{scopeLabel}</div>
                                    <div className="mt-1 text-xs font-semibold text-stone-500">Base: facturas membretadas emitidas</div>
                                </div>
                            </div>
                            <div className="mt-4 rounded-xl border border-[#e30613]/20 bg-white px-4 py-3 text-sm font-semibold text-[#1f2937]">
                                Este reporte formaliza unicamente las facturas membretadas registradas. No toma como total la venta diaria SICAR; la venta diaria se muestra solo como referencia de origen.
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
                            <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
                                <div className="text-xs font-bold uppercase tracking-wider text-stone-500">Subtotal membretado</div>
                                <div className="mt-1 text-lg font-black text-[#9f111a]">{fmt(taxReport.totals.stampedInvoiceSubtotal)}</div>
                            </div>
                            <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
                                <div className="text-xs font-bold uppercase tracking-wider text-stone-500">IVA membretado</div>
                                <div className="mt-1 text-lg font-black text-[#9f111a]">{fmt(taxReport.totals.stampedInvoiceIva)}</div>
                            </div>
                            <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
                                <div className="text-xs font-bold uppercase tracking-wider text-stone-500">Total membretado</div>
                                <div className="mt-1 text-lg font-black text-[#9f111a]">{fmt(taxReport.totals.stampedInvoiceTotal)}</div>
                            </div>
                            <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
                                <div className="text-xs font-bold uppercase tracking-wider text-stone-500">Retenciones</div>
                                <div className="mt-1 text-lg font-black text-[#9f111a]">{fmt(taxReport.totals.stampedInvoiceRetentions)}</div>
                            </div>
                            <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
                                <div className="text-xs font-bold uppercase tracking-wider text-stone-500">Neto despues de retenciones</div>
                                <div className="mt-1 text-lg font-black text-[#9f111a]">{fmt(taxReport.totals.stampedInvoiceNet)}</div>
                            </div>
                        </div>

                        <div className="mb-5 overflow-x-auto">
                            <div className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-[#9f111a]">Resumen por venta diaria</div>
                            <table className={tableClass}>
                                <thead>
                                    <tr>
                                        <th className={thClass}>Sucursal</th>
                                        <th className={thClass}>Fecha</th>
                                        <th className={thClass}>Referencia venta diaria</th>
                                        <th className={thClass}>Metodos</th>
                                        <th className={`${thClass} text-right`}>Facturas</th>
                                        <th className={`${thClass} text-right`}>Subtotal</th>
                                        <th className={`${thClass} text-right`}>IVA</th>
                                        <th className={`${thClass} text-right`}>Total membretado</th>
                                        <th className={`${thClass} text-right`}>Retenciones</th>
                                        <th className={`${thClass} text-right`}>Neto</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {taxReport.stampedInvoiceDailyRows.length === 0 ? (
                                        <tr><td colSpan="10" className="py-6 text-center text-sm font-semibold text-stone-400">No hay facturas membretadas en este periodo.</td></tr>
                                    ) : taxReport.stampedInvoiceDailyRows.map((row) => (
                                        <tr key={`${row.sucursal}-${row.serie}-${row.dailySaleCode}`}>
                                            <td className={tdClass}>{row.sucursal} {row.serie ? `· Serie ${row.serie}` : ''}</td>
                                            <td className={tdClass}>{row.date}</td>
                                            <td className={tdClass}>{row.dailySaleCode}</td>
                                            <td className={tdClass}>{row.paymentMethods || '-'}</td>
                                            <td className={`${tdClass} text-right font-semibold`}>{row.invoiceCount}</td>
                                            <td className={`${tdClass} text-right font-semibold`}>{fmt(row.subtotal)}</td>
                                            <td className={`${tdClass} text-right font-semibold`}>{fmt(row.iva)}</td>
                                            <td className={`${tdClass} text-right font-semibold`}>{fmt(row.total)}</td>
                                            <td className={`${tdClass} text-right font-semibold`}>{fmt(row.retentionTotal)}</td>
                                            <td className={`${tdClass} text-right font-semibold`}>{fmt(row.netTotal)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="overflow-x-auto">
                            <div className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-[#9f111a]">Detalle factura por factura</div>
                            <table className={tableClass}>
                                <thead>
                                    <tr>
                                        <th className={thClass}>Sucursal</th>
                                        <th className={thClass}>Fecha</th>
                                        <th className={thClass}>Referencia venta diaria</th>
                                        <th className={thClass}>Factura</th>
                                        <th className={thClass}>Metodo</th>
                                        <th className={`${thClass} text-right`}>Subtotal</th>
                                        <th className={`${thClass} text-right`}>IVA</th>
                                        <th className={`${thClass} text-right`}>Total</th>
                                        <th className={`${thClass} text-right`}>Ret. IR 2%</th>
                                        <th className={`${thClass} text-right`}>Ret. Mun. 1%</th>
                                        <th className={`${thClass} text-right`}>Neto</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {taxReport.stampedInvoiceRows.length === 0 ? (
                                        <tr><td colSpan="11" className="py-6 text-center text-sm font-semibold text-stone-400">Sin detalle para mostrar.</td></tr>
                                    ) : taxReport.stampedInvoiceRows.map((row, idx) => (
                                        <tr key={`${row.dailySaleCode}-${row.document}-${idx}`}>
                                            <td className={tdClass}>{row.sucursal} {row.serie ? `· Serie ${row.serie}` : ''}</td>
                                            <td className={tdClass}>{row.date}</td>
                                            <td className={tdClass}>{row.dailySaleCode}</td>
                                            <td className={tdClass}>{row.document || '-'}</td>
                                            <td className={tdClass}>{row.paymentMethod || '-'}</td>
                                            <td className={`${tdClass} text-right font-semibold`}>{fmt(row.subtotal)}</td>
                                            <td className={`${tdClass} text-right font-semibold`}>{fmt(row.iva)}</td>
                                            <td className={`${tdClass} text-right font-semibold`}>{fmt(row.total)}</td>
                                            <td className={`${tdClass} text-right font-semibold`}>{fmt(row.retentionIr2)}</td>
                                            <td className={`${tdClass} text-right font-semibold`}>{fmt(row.retentionMunicipal1)}</td>
                                            <td className={`${tdClass} text-right font-black text-[#9f111a]`}>{fmt(row.netTotal)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                </div>
            )}

            {taxTab === 'Resultado despues de impuestos' && (
                <div className="space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
                        <StatCard title="Ventas Subtotal" value={fmt(taxReport.totals.salesSubtotal)} icon="trendingUp" variant="success" />
                        <StatCard title="Costo Subtotal" value={fmt(taxReport.totals.purchaseSubtotal)} icon="shoppingCart" variant="warning" />
                        <StatCard title="Utilidad Antes Imp." value={fmt(taxReport.totals.profitBeforeTax)} icon="dollar" variant={taxReport.totals.profitBeforeTax >= 0 ? 'wine' : 'danger'} />
                        <StatCard title="EBITDA" value={fmt(taxReport.totals.ebitda)} subtitle="Antes de imp., dep. y amort." icon="chart" variant={taxReport.totals.ebitda >= 0 ? 'success' : 'danger'} />
                        <StatCard title="Utilidad Neta" value={fmt(taxReport.totals.netProfitAfterTax)} icon="wallet" variant={taxReport.totals.netProfitAfterTax >= 0 ? 'dark' : 'danger'} />
                    </div>
                    <ExecutiveFlowDiagram
                        eyebrow="Income statement flow"
                        title="Estado de resultado tributario"
                        subtitle="Ingresos brutos, costos, gastos operativos, impuestos y utilidad neta"
                        period={selectedMonth || 'Todos'}
                        source={{ label: 'Ingresos bruto', value: taxReport.totals.salesSubtotal, subtitle: 'ventas base sin IVA' }}
                        stages={[
                            {
                                id: 'gross-profit',
                                up: { label: 'Costos', value: taxReport.totals.purchaseSubtotal, subtitle: 'compras / costo fiscal', tone: 'cost' },
                                down: { label: 'Utilidad bruta', value: taxReport.totals.grossProfit, subtitle: 'ingresos - costos', tone: taxReport.totals.grossProfit >= 0 ? 'gross' : 'danger' },
                            },
                            {
                                id: 'operating-profit',
                                up: { label: 'Gastos operativos', value: taxReport.totals.operatingExpenseSubtotal, subtitle: 'egresos del periodo', tone: 'expense' },
                                down: { label: 'Utilidades operativas', value: taxReport.totals.operatingProfit, subtitle: 'utilidad bruta - gastos', tone: taxReport.totals.operatingProfit >= 0 ? 'operating' : 'danger' },
                            },
                            {
                                id: 'net-profit',
                                up: {
                                    label: 'Impuestos',
                                    value: taxReport.totals.municipalTax + taxReport.totals.incomeTax30,
                                    subtitle: 'IMI 1% + IR 30%',
                                    tone: 'tax',
                                    lines: [
                                        { label: 'IMI', value: taxReport.totals.municipalTax },
                                        { label: 'IR', value: taxReport.totals.incomeTax30 },
                                    ],
                                },
                                down: {
                                    label: 'Utilidad neta',
                                    value: taxReport.totals.netProfitAfterTax,
                                    subtitle: 'resultado final',
                                    tone: taxReport.totals.netProfitAfterTax >= 0 ? 'profit' : 'danger',
                                },
                            },
                        ]}
                    />
                    <Card title="Estado de resultado despues de impuesto" subtitle="Formula fiscal: ingresos - costos - gastos operativos - impuestos" icon="chart" gradient={true}>
                        <div className="space-y-3 text-sm">
                            {[
                                ['Ingresos brutos (ventas subtotal)', taxReport.totals.salesSubtotal],
                                ['Costos (compras subtotal)', -taxReport.totals.purchaseSubtotal],
                                ['Utilidad bruta', taxReport.totals.grossProfit],
                                ['Gastos operativos', -taxReport.totals.operatingExpenseSubtotal],
                                ['Utilidades operativas', taxReport.totals.operatingProfit],
                                ['Depreciacion y amortizaciones', taxReport.totals.depreciationAmortization],
                                ['EBITDA', taxReport.totals.ebitda],
                                ['Impuesto municipal 1% sobre ventas', -taxReport.totals.municipalTax],
                                ['Utilidad despues de IMI', taxReport.totals.profitAfterMunicipal],
                                ['IR 30% sobre utilidad despues de IMI', -taxReport.totals.incomeTax30],
                                ['Utilidad neta despues de impuestos', taxReport.totals.netProfitAfterTax],
                            ].map(([label, value]) => (
                                <div key={label} className="flex items-center justify-between rounded-xl border border-stone-200 bg-white px-4 py-3">
                                    <span className="font-bold text-stone-600">{label}</span>
                                    <span className={`font-black ${value < 0 ? 'text-rose-700' : 'text-[#9f111a]'}`}>{fmt(value)}</span>
                                </div>
                            ))}
                        </div>
                    </Card>
                    <TaxStatementPrintableReport
                        taxReport={taxReport}
                        selectedMonth={selectedMonth}
                        onPrint={handlePrintTaxStatement}
                    />
                    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                        <Card title="Costos por categoria" subtitle="Compras y costos fiscales del periodo" icon="shoppingCart">
                            <CategoryBreakdown rows={taxReport.purchaseCategoryRows} emptyLabel="Sin compras registradas en este periodo." />
                        </Card>
                        <Card title="Gastos operativos por categoria" subtitle="Gastos agrupados con subcategorias" icon="receipt">
                            <CategoryBreakdown rows={taxReport.operatingExpenseRows} emptyLabel="Sin gastos registrados en este periodo." />
                        </Card>
                    </div>
                </div>
            )}
        </div>
    );
};

export default function Reports({ data, branchContext }) {
    const [activeTab, setActiveTab] = useState('Resultados');
    const [taxTab, setTaxTab] = useState('IVA');
    const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().substring(0, 7));
    const [modalCategory, setModalCategory] = useState(null);
    const allowedBranchIds = useMemo(
        () => (branchContext?.allowedBranchIds?.length ? branchContext.allowedBranchIds : [branchContext?.selectedBranchId || DEFAULT_BRANCH_ID]),
        [branchContext?.allowedBranchIds, branchContext?.selectedBranchId]
    );
    const [branchScope, setBranchScope] = useState(branchContext?.selectedBranchId || DEFAULT_BRANCH_ID);

    const branchScopeOptions = useMemo(() => {
        const allowed = new Set(allowedBranchIds);
        const branches = BRANCHES.filter((branch) => allowed.has(branch.id));
        return branches.length > 1
            ? [{ id: CONSOLIDATED_BRANCH_ID, shortName: 'Ambas sucursales', invoiceSeries: 'A+B' }, ...branches]
            : branches;
    }, [allowedBranchIds]);

    const scopedData = useMemo(
        () => filterDataByBranchScope(data, branchScope, allowedBranchIds),
        [data, branchScope, allowedBranchIds]
    );
    const scopeLabel = branchScope === CONSOLIDATED_BRANCH_ID
        ? 'Granada + Nindiri'
        : `${getBranchById(branchScope).shortName} · Serie ${getBranchById(branchScope).invoiceSeries}`;

    useEffect(() => {
        if (branchScope !== CONSOLIDATED_BRANCH_ID && !allowedBranchIds.includes(branchScope)) {
            setBranchScope(branchContext?.selectedBranchId || allowedBranchIds[0] || DEFAULT_BRANCH_ID);
        }
    }, [allowedBranchIds, branchContext?.selectedBranchId, branchScope]);

    const aggregatedData = useMemo(() => aggregateData(scopedData, branchScope), [scopedData, branchScope]);
    const taxReport = useMemo(() => buildTaxReport(scopedData, selectedMonth, branchScope), [scopedData, selectedMonth, branchScope]);

    const availableMonths = useMemo(() => {
        const fiscalMonths = [
            ...(scopedData.ingresos || []),
            ...(scopedData.compras || []),
            ...(scopedData.gastos || []),
            ...(scopedData.facturas_membretadas_ventas || []),
            ...(scopedData[BRANCH_COST_TRANSFER_COLLECTION] || []),
        ].map(getDocMonth).filter(Boolean);
        const months = [...new Set([...aggregatedData.map(d => d.month), ...fiscalMonths])];
        return months.sort((a, b) => b.localeCompare(a));
    }, [aggregatedData, scopedData]);

    const filteredReport = useMemo(() => {
        return aggregatedData.filter(d => selectedMonth ? d.month === selectedMonth : true);
    }, [aggregatedData, selectedMonth]);

    let totalIncome = 0;
    let totalExpenses = 0;
    let totalCOGS = 0;
    let totalPurchasesOnly = 0;
    let inventoryAdjustment = 0;
    let totalGrossProfit = 0;
    let totalNetProfit = 0;
    let currentBudgets = {};
    let filteredRawExpenses = [];
    let finalExpenseRows = [];
    let finalCostRows = [];

    if (filteredReport.length > 0) {
        const d = filteredReport.find(x => x.branchId === 'consolidado');
        if (d) {
            totalIncome = d.totalIncome;
            totalExpenses = d.totalExpense;
            totalCOGS = d.COGS;
            totalPurchasesOnly = d.totalPurchases;
            // Ajuste de inventario = Inicial - Final (stored in consolidated since we added them)
            inventoryAdjustment = (d.initialInventory || 0) - (d.finalInventory || 0);
            currentBudgets = d.budgets || {};
            filteredRawExpenses = d.rawExpenses;
            finalExpenseRows = categoryTreeToRows(d.expenseTree || {});
            finalCostRows = categoryTreeToRows(d.costTree || {});
        }
        totalGrossProfit = totalIncome - totalCOGS;
        totalNetProfit = totalGrossProfit - totalExpenses;
    }

    const totalBudgetLimit = useMemo(() => {
        return Object.values(currentBudgets).reduce((acc, val) => acc + val, 0);
    }, [currentBudgets]);

    const totalExecution = totalBudgetLimit > 0 ? (totalExpenses / totalBudgetLimit) * 100 : 0;

    const tabsConfig = {
        'Resultados': { icon: 'chart', label: 'Estado de Resultados' },
        'Tributarios': { icon: 'receipt', label: 'Reportes Tributarios' },
        'Balance': { icon: 'scale', label: 'Balance General' },
        'Dashboard': { icon: 'dashboard', label: 'Dashboard' }
    };

    const modalExpenses = modalCategory
        ? filteredRawExpenses.filter(item => item.category === modalCategory)
        : [];

    return (
        <div className="space-y-5">
            <style>{`
                @keyframes fade-in { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
                .animate-fade-in { animation: fade-in 0.4s ease-out; }
                .custom-scrollbar::-webkit-scrollbar { width: 5px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: #f5f0ec; border-radius: 3px; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #c8a898; border-radius: 3px; }
                .tax-pdf-cell { border-top: 1px solid #e2e8f0; padding: 7px 12px; vertical-align: top; }
                .tax-pdf-head { padding: 9px 12px; font-size: 10px; font-weight: 900; letter-spacing: 0.18em; text-transform: uppercase; }
                .tax-pdf-kpi { border: 1px solid #e2e8f0; border-radius: 12px; background: #f8fafc; padding: 10px 12px; }
                .tax-pdf-kpi div { color: #64748b; font-size: 10px; font-weight: 900; letter-spacing: 0.16em; text-transform: uppercase; }
                .tax-pdf-kpi strong { display: block; margin-top: 4px; color: #0f172a; font-size: 15px; font-weight: 900; }
                @media print {
                    @page { size: letter portrait; margin: 0.42in; }
                    body.print-stamped-tax-report * { visibility: hidden !important; }
                    body.print-stamped-tax-report .stamped-tax-report,
                    body.print-stamped-tax-report .stamped-tax-report * { visibility: visible !important; }
                    body.print-stamped-tax-report .stamped-tax-report {
                        position: absolute !important;
                        inset: 0 auto auto 0 !important;
                        width: 100% !important;
                        border: 0 !important;
                        box-shadow: none !important;
                    }
                    body.print-stamped-tax-report .no-print { display: none !important; }
                    body.print-stamped-tax-report table { page-break-inside: auto; }
                    body.print-stamped-tax-report tr { page-break-inside: avoid; page-break-after: auto; }
                    body.print-tax-statement-report * { visibility: hidden !important; }
                    body.print-tax-statement-report .tax-statement-report,
                    body.print-tax-statement-report .tax-statement-report * { visibility: visible !important; }
                    body.print-tax-statement-report .tax-statement-report {
                        position: absolute !important;
                        inset: 0 auto auto 0 !important;
                        width: 100% !important;
                        border: 0 !important;
                        box-shadow: none !important;
                        overflow: visible !important;
                    }
                    body.print-tax-statement-report .tax-statement-report > div:first-child,
                    body.print-tax-statement-report .tax-statement-report .no-print { display: none !important; }
                    body.print-tax-statement-report .tax-statement-report > div:last-child { padding: 0 !important; }
                    body.print-tax-statement-report .tax-pdf-page {
                        border: 0 !important;
                        border-radius: 0 !important;
                        padding: 0 !important;
                        box-shadow: none !important;
                        color: #0f172a !important;
                    }
                    body.print-tax-statement-report .tax-pdf-cell { padding: 5px 9px !important; font-size: 10.5px !important; }
                    body.print-tax-statement-report .tax-pdf-head { padding: 7px 9px !important; font-size: 9px !important; }
                    body.print-tax-statement-report .tax-pdf-kpi { padding: 7px 9px !important; break-inside: avoid; }
                    body.print-tax-statement-report table { page-break-inside: auto; }
                    body.print-tax-statement-report tr { page-break-inside: avoid; page-break-after: auto; }
                }
            `}</style>

            {/* Expense detail modal */}
            <ExpenseDetailModal
                category={modalCategory}
                expenses={modalExpenses}
                onClose={() => setModalCategory(null)}
            />

            {/* Page header */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.34em] text-[#e30613]">{APP_BRAND_NAME}</div>
                        <h1 className="mt-1 text-xl font-black text-slate-950">Reportes financieros</h1>
                        <div className="mt-1 text-xs font-bold text-slate-500">Alcance: {scopeLabel}</div>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                            <span className="text-[9px] font-black uppercase tracking-[0.22em] text-slate-500">Sucursal</span>
                            <select
                                value={branchScope}
                                onChange={(event) => {
                                    setBranchScope(event.target.value);
                                    setModalCategory(null);
                                }}
                                className="bg-transparent text-xs font-black text-slate-900 outline-none"
                            >
                                {branchScopeOptions.map((branch) => (
                                    <option key={branch.id} value={branch.id}>
                                        {branch.id === CONSOLIDATED_BRANCH_ID ? branch.shortName : `${branch.shortName} · Serie ${branch.invoiceSeries}`}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                            {activeTab}
                        </div>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
                <div className="flex flex-wrap gap-1.5">
                    {Object.entries(tabsConfig).map(([tab, config]) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wide transition-all ${
                                activeTab === tab
                                    ? 'bg-[#e30613] text-white shadow-sm shadow-red-900/20'
                                    : 'text-stone-600 hover:bg-stone-100'
                            }`}
                        >
                            <Icon path={Icons[config.icon]} className="w-3.5 h-3.5" />
                            {config.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content */}
            {activeTab === 'Balance' && (
                <div className="animate-fade-in">
                    <BalanceSheet data={data} />
                </div>
            )}

            {activeTab === 'Dashboard' && (
                <div className="animate-fade-in">
                    <DashboardGeneral />
                </div>
            )}

            {activeTab === 'Tributarios' && (
                <TaxReportsPanel
                    taxReport={taxReport}
                    taxTab={taxTab}
                    setTaxTab={setTaxTab}
                    selectedMonth={selectedMonth}
                    setSelectedMonth={setSelectedMonth}
                    availableMonths={availableMonths}
                    scopeLabel={scopeLabel}
                />
            )}

            {activeTab === 'Resultados' && (
                <div className="animate-fade-in space-y-5">
                    {/* Filtro de periodo */}
                    <div className="max-w-sm">
                        <Select
                            label="Periodo de An?lisis"
                            icon="calendar"
                            value={selectedMonth || ''}
                            onChange={(e) => {
                                setSelectedMonth(e.target.value);
                                setModalCategory(null);
                            }}
                            options={availableMonths.map(month => (
                                <option key={month} value={month}>{month}</option>
                            ))}
                        />
                    </div>

                    {/* KPI cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <StatCard
                            title="Ingresos Totales"
                            value={fmt(totalIncome)}
                            icon="trendingUp"
                            variant="success"
                        />
                        <StatCard
                            title="Costo con Merma"
                            value={fmt(totalCOGS)}
                            subtitle="Compras + Ajuste Inv."
                            icon="shoppingCart"
                            variant="warning"
                        />
                        <StatCard
                            title="Utilidad Bruta"
                            value={fmt(totalGrossProfit)}
                            icon="dollar"
                            variant={totalGrossProfit >= 0 ? 'wine' : 'danger'}
                            trend={totalIncome > 0 ? ((totalGrossProfit / totalIncome) * 100).toFixed(1) : 0}
                        />
                        <StatCard
                            title="Utilidad Neta"
                            value={fmt(totalNetProfit)}
                            icon="wallet"
                            variant={totalNetProfit >= 0 ? 'dark' : 'danger'}
                            trend={totalIncome > 0 ? ((totalNetProfit / totalIncome) * 100).toFixed(1) : 0}
                        />
                    </div>

                    {/* Main grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                        {/* Resumen Ejecutivo */}
                        <div className="lg:col-span-1">
                            <Card title="Resumen Ejecutivo" subtitle="Rentabilidad mensual" icon="chart" gradient={true}>
                                <div className="space-y-2">
                                    {/* Ingresos */}
                                    <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-white p-3">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                                                <Icon path={Icons.trendingUp} className="w-4 h-4 text-emerald-700" />
                                            </div>
                                            <div>
                                                <div className="text-xs text-stone-500 font-bold uppercase tracking-wide">Ingresos</div>
                                                <div className="text-base font-black text-stone-800">{fmt(totalIncome)}</div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Separador COGS */}
                                    <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
                                        <div className="px-3 py-2 bg-stone-50 border-b border-stone-200">
                                            <div className="text-xs font-bold uppercase tracking-wide text-stone-500">Costo de Venta</div>
                                        </div>
                                        {/* Compra de Mercancia */}
                                        <div className="flex items-center justify-between px-3 py-2.5 border-b border-stone-100">
                                            <div className="flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-stone-400" />
                                                <div className="text-xs font-semibold text-stone-600">Compra de Mercancia</div>
                                            </div>
                                            <div className="text-sm font-bold text-stone-700">{fmt(totalPurchasesOnly)}</div>
                                        </div>
                                        {/* Ajuste de inventario */}
                                        <div className="flex items-center justify-between px-3 py-2.5 border-b border-stone-100">
                                            <div className="flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-stone-400" />
                                                <div className="text-xs font-semibold text-stone-600">Ajuste Inv. (Inicial - Final)</div>
                                            </div>
                                            <div className={`text-sm font-bold ${inventoryAdjustment >= 0 ? 'text-stone-700' : 'text-emerald-700'}`}>
                                                {inventoryAdjustment >= 0 ? '' : '-'}{fmt(Math.abs(inventoryAdjustment))}
                                            </div>
                                        </div>
                                        {/* Costo con merma */}
                                        <div className="flex items-center justify-between px-3 py-2.5 bg-amber-50">
                                            <div className="flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                                <div className="text-xs font-bold text-amber-800 uppercase tracking-wide">Costo con Merma Ajustada</div>
                                            </div>
                                            <div className="text-sm font-black text-amber-800">{fmt(totalCOGS)}</div>
                                        </div>
                                    </div>

                                    {/* Utilidad Bruta */}
                                    <div className="flex items-center justify-between rounded-xl bg-emerald-500 p-3">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                                                <Icon path={Icons.dollar} className="w-4 h-4 text-white" />
                                            </div>
                                            <div>
                                                <div className="text-xs text-emerald-100 font-bold uppercase tracking-wide">Utilidad Bruta</div>
                                                <div className="text-base font-black text-white">{fmt(totalGrossProfit)}</div>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-xs text-emerald-100 font-bold">Margen</div>
                                            <div className="text-sm font-bold text-white">
                                                {totalIncome > 0 ? ((totalGrossProfit / totalIncome) * 100).toFixed(1) : 0}%
                                            </div>
                                        </div>
                                    </div>

                                    {/* Gastos operativos */}
                                    <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-white p-3">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center">
                                                <Icon path={Icons.trendingDown} className="w-4 h-4 text-orange-700" />
                                            </div>
                                            <div>
                                                <div className="text-xs text-stone-500 font-bold uppercase tracking-wide">Gastos Operativos</div>
                                                <div className="text-base font-black text-stone-700">{fmt(totalExpenses)}</div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Utilidad Neta */}
                                    <div className={`flex items-center justify-between rounded-xl p-3 ${
                                        totalNetProfit >= 0 ? 'bg-[#9f111a]' : 'bg-rose-600'
                                    }`}>
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
                                                <Icon path={Icons.wallet} className="w-5 h-5 text-white" />
                                            </div>
                                            <div>
                                                <div className="text-xs text-white/70 font-bold uppercase tracking-wide">Utilidad Neta</div>
                                                <div className="text-xl font-black text-white">{fmt(totalNetProfit)}</div>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-xs text-white/70 font-bold">% Ingreso</div>
                                            <div className="text-base font-bold text-white">
                                                {totalIncome > 0 ? ((totalNetProfit / totalIncome) * 100).toFixed(1) : 0}%
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        </div>

                        {/* Desglose de Gastos */}
                        <div className="lg:col-span-2">
                            <Card
                                title="Desglose por categoria y subcategoria"
                                subtitle="Costos y gastos separados para lectura fiscal y gerencial"
                                icon="receipt"
                            >
                                <div className="space-y-5">
                                    <div>
                                        <div className="mb-2 flex items-center justify-between">
                                            <div>
                                                <div className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">Costos de venta</div>
                                                <div className="text-[11px] font-semibold text-slate-400">Compras, inventario y costos directos</div>
                                            </div>
                                            <div className="text-right text-sm font-black text-amber-700">{fmt(totalPurchasesOnly)}</div>
                                        </div>
                                        <CategoryBreakdown rows={finalCostRows} budgets={currentBudgets} emptyLabel="Sin costos registrados en este periodo." />
                                    </div>

                                    <div>
                                        <div className="mb-2 flex items-center justify-between">
                                            <div>
                                                <div className="text-xs font-black uppercase tracking-[0.2em] text-[#9f111a]">Gastos operativos</div>
                                                <div className="text-[11px] font-semibold text-slate-400">Gastos por categoria y subcategoria</div>
                                            </div>
                                            <div className="text-right text-sm font-black text-[#9f111a]">{fmt(totalExpenses)}</div>
                                        </div>
                                        <CategoryBreakdown
                                            rows={finalExpenseRows}
                                            budgets={currentBudgets}
                                            onCategoryClick={setModalCategory}
                                            emptyLabel="Sin gastos operativos registrados en este periodo."
                                        />
                                    </div>
                                </div>

                                {/* Barra presupuesto */}
                                {totalBudgetLimit > 0 && (
                                    <div className="mt-5 rounded-xl border border-stone-200 bg-stone-50 p-4">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-xs font-bold uppercase tracking-wider text-stone-500">Ejecucion del Presupuesto Total</span>
                                            <span className={`text-sm font-black ${totalExecution > 100 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                                {totalExecution.toFixed(1)}% utilizado
                                            </span>
                                        </div>
                                        <div className="h-2.5 bg-stone-200 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full rounded-full transition-all duration-700 ${
                                                    totalExecution > 100 ? 'bg-rose-500' : totalExecution > 90 ? 'bg-amber-500' : 'bg-[#e30613]'
                                                }`}
                                                style={{ width: `${Math.min(totalExecution, 100)}%` }}
                                            />
                                        </div>
                                    </div>
                                )}
                            </Card>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
