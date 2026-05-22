// src/components/Reports.jsx
import React, { useMemo, useState, useCallback } from 'react';
import { APP_BRAND_NAME, fmt, peso, branchName, resolveBranchId } from '../constants';
import BalanceSheet from './BalanceSheet';
import DashboardGeneral from './DashboardGeneral';
import { resolveReportIncomeEntries } from '../services/incomeAggregation';

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

// --- COMPONENTES UI ---

const Card = ({ title, children, className = "", right, subtitle, icon, gradient = false }) => (
    <div className={`rounded-xl shadow-md border border-[#e6c9b8]/60 bg-white overflow-hidden ${className}`}>
        <div className={`flex justify-between items-center px-5 py-3 border-b ${gradient ? 'bg-[#7f1218] border-[#5e1318]' : 'bg-stone-50 border-[#ead5c5]'}`}>
            <div className="flex items-center gap-3">
                {icon && (
                    <div className={`p-2 rounded-lg ${gradient ? 'bg-white/10' : 'bg-[#fff0f0]'}`}>
                        <Icon path={Icons[icon]} className={`w-4 h-4 ${gradient ? 'text-white' : 'text-[#a81d24]'}`} />
                    </div>
                )}
                <div>
                    <h3 className={`text-sm font-bold uppercase tracking-wider ${gradient ? 'text-white' : 'text-[#5f1a1f]'}`}>{title}</h3>
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
                className={`w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5 font-semibold text-stone-700 outline-none transition-all focus:border-[#a81d24] focus:ring-2 focus:ring-[#a81d24]/15 appearance-none cursor-pointer ${icon ? 'pl-10' : ''}`}
            >
                {options}
            </select>
            <Icon path={Icons.chevronDown} className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
        </div>
    </div>
);

const StatCard = ({ title, value, subtitle, icon, variant = 'default', trend }) => {
    const variants = {
        default: 'bg-white border-[#e6c9b8]',
        wine: 'bg-[#a81d24] text-white border-[#7f1218]',
        success: 'bg-emerald-600 text-white border-emerald-700',
        danger: 'bg-rose-600 text-white border-rose-700',
        warning: 'bg-amber-500 text-white border-amber-600',
        dark: 'bg-[#2b1113] text-white border-[#1a0a0b]'
    };

    const isColored = variant !== 'default';

    return (
        <div className={`rounded-xl p-5 border shadow-sm ${variants[variant]}`}>
            <div className="flex items-start justify-between mb-3">
                <div className={`p-2.5 rounded-xl ${isColored ? 'bg-white/20' : 'bg-[#fff0f0]'}`}>
                    <Icon path={Icons[icon]} className={`w-5 h-5 ${isColored ? 'text-white' : 'text-[#a81d24]'}`} />
                </div>
                {trend !== undefined && (
                    <div className={`flex items-center gap-1 text-xs font-bold ${isColored ? 'text-white/70' : (parseFloat(trend) >= 0 ? 'text-emerald-600' : 'text-rose-600')}`}>
                        <Icon path={parseFloat(trend) >= 0 ? Icons.trendingUp : Icons.trendingDown} className="w-3.5 h-3.5" />
                        {Math.abs(parseFloat(trend))}%
                    </div>
                )}
            </div>
            <div className={`text-2xl font-black mb-0.5 ${isColored ? 'text-white' : 'text-[#2b1113]'}`}>{value}</div>
            <div className={`text-xs font-bold uppercase tracking-wider ${isColored ? 'text-white/70' : 'text-stone-500'}`}>{title}</div>
            {subtitle && <div className={`text-xs mt-1 ${isColored ? 'text-white/50' : 'text-stone-400'}`}>{subtitle}</div>}
        </div>
    );
};

// --- MODAL DE DETALLES DE GASTO ---
const ExpenseDetailModal = ({ category, expenses, onClose }) => {
    if (!category) return null;
    const total = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="absolute inset-0 bg-[#2b1113]/40 backdrop-blur-sm" />
            <div
                className="relative w-full max-w-lg rounded-2xl border border-[#e6c9b8] bg-white shadow-2xl shadow-[#7f1218]/20 overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Modal header */}
                <div className="bg-[#7f1218] px-5 py-4 flex items-center justify-between">
                    <div>
                        <div className="text-xs font-bold uppercase tracking-[0.3em] text-[#f2b635] mb-0.5">Detalle de transacciones</div>
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
                                <div className="text-sm font-black text-[#7f1218]">{fmt(peso(item.amount))}</div>
                            </div>
                        ))
                    )}
                </div>

                {/* Modal footer */}
                <div className="border-t border-[#ead5c5] bg-stone-50 px-5 py-3 flex items-center justify-between">
                    <div className="text-xs font-bold uppercase tracking-wider text-stone-500">Total {category}</div>
                    <div className="text-lg font-black text-[#7f1218]">{fmt(total)}</div>
                </div>
            </div>
        </div>
    );
};

// --- LÓGICA DE AGREGACIÓN (preservada exactamente) ---
const aggregateData = (data) => {
    const results = {};
    const { ingresos = [], gastos = [], inventarios = [], compras = [], presupuestos = [], cuentas_por_pagar: facturasCredito = [] } = data;
    const normalizedIngresos = resolveReportIncomeEntries(ingresos);
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
            rawExpenses: []
        };

        return results[month][branchId];
    };

    const legacyPurchasesByMonth = {};

    const budgetsByMonth = presupuestos.reduce((acc, p) => {
        acc[p.month] = acc[p.month] || {};
        acc[p.month][p.category] = (acc[p.month][p.category] || 0) + peso(p.amount);
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
            branchData.totalExpense += amount;
            branchData.expenseDetails[item.category] = (branchData.expenseDetails[item.category] || 0) + amount;
            branchData.rawExpenses.push({ ...item, dateStr: dateString, amount });
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
        branchData.totalPurchases += amount;
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
        branchData.totalPurchases += amount;
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

const buildTaxReport = (data, selectedMonth) => {
    const inMonth = (item) => !selectedMonth || getDocMonth(item) === selectedMonth;
    const accountingAmount = (item) => peso(item.subtotal ?? item.amount ?? item.monto);
    const fiscalTotal = (item) => peso(item.total ?? item.monto ?? item.amount);
    const fiscalIva = (item) => peso(item.iva);
    const invoiceLabel = (item) => item.invoiceNumber || item.numeroFactura || item.factura || item.numero || item.reference || item.dailySaleCode || '';

    const incomeRows = resolveReportIncomeEntries(data.ingresos || [])
        .filter(inMonth)
        .map((item) => ({
            type: 'IVA vendido',
            date: getDocDate(item),
            source: item.source === 'sicar' ? 'SICAR venta diaria' : 'Ingreso manual',
            document: item.dailySaleCode || item.reference || item.id || '',
            description: item.description || item.detalle || '',
            subtotal: accountingAmount(item),
            iva: fiscalIva(item),
            total: fiscalTotal(item),
        }));

    const purchaseRows = [...(data.compras || []), ...(data.gastos || [])]
        .filter(inMonth)
        .map((item) => ({
            type: item.supplier || item.proveedor ? 'IVA comprado' : 'IVA gasto',
            date: getDocDate(item),
            source: item.supplier || item.proveedor || item.category || 'Registro',
            document: invoiceLabel(item),
            description: item.description || item.descripcion || item.category || '',
            subtotal: accountingAmount(item),
            iva: fiscalIva(item),
            total: fiscalTotal(item),
        }));

    const salesRetentionRows = (data.facturas_membretadas_ventas || [])
        .filter(inMonth)
        .map((item) => ({
            type: 'Retencion venta',
            date: getDocDate(item),
            source: item.dailySaleCode || 'Factura membretada',
            document: item.numeroFactura || '',
            subtotal: accountingAmount(item),
            retentionIr2: peso(item.retentionIr2),
            retentionMunicipal1: peso(item.retentionMunicipal1),
            retentionTotal: peso(item.retentionTotal ?? (peso(item.retentionIr2) + peso(item.retentionMunicipal1))),
            paymentMethod: item.paymentMethod || '',
        }));

    const purchaseRetentionRows = [...(data.compras || []), ...(data.gastos || [])]
        .filter(inMonth)
        .map((item) => ({
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
    const purchaseSubtotal = (data.compras || []).filter(inMonth).reduce((sum, item) => sum + accountingAmount(item), 0);
    const municipalTax = salesSubtotal * 0.01;
    const profitBeforeTax = salesSubtotal - purchaseSubtotal;
    const profitAfterMunicipal = profitBeforeTax - municipalTax;
    const incomeTax30 = profitAfterMunicipal > 0 ? profitAfterMunicipal * 0.30 : 0;

    return {
        ivaRows: [...incomeRows, ...purchaseRows],
        retentionRows: [...salesRetentionRows, ...purchaseRetentionRows],
        totals: {
            ivaSold,
            ivaBought,
            ivaNet: ivaSold - ivaBought,
            retentionSales: sumBy(salesRetentionRows, 'retentionTotal'),
            retentionPurchases: sumBy(purchaseRetentionRows, 'retentionTotal'),
            salesSubtotal,
            purchaseSubtotal,
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

const TaxReportsPanel = ({ taxReport, taxTab, setTaxTab, selectedMonth, setSelectedMonth, availableMonths }) => {
    const subTabs = ['IVA', 'Retenciones', 'Resultado despues de impuestos'];
    const tableClass = "w-full text-sm";
    const thClass = "pb-3 text-left text-xs font-bold uppercase tracking-wider text-stone-500";
    const tdClass = "py-2.5 border-t border-stone-100 text-stone-700";

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
                            taxTab === tab ? 'bg-[#a81d24] text-white' : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50'
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
                        right={<button onClick={() => downloadCsv(`reporte-iva-${selectedMonth}.csv`, taxReport.ivaRows)} className="rounded-lg bg-[#a81d24] px-3 py-1.5 text-xs font-bold text-white">Exportar CSV</button>}
                    >
                        <div className="overflow-x-auto">
                            <table className={tableClass}>
                                <thead>
                                    <tr>
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
                    <Card
                        title="Reporte Membretado de Retenciones"
                        subtitle="Detalle fiscal para soporte ante DGI"
                        icon="receipt"
                        right={<button onClick={() => downloadCsv(`reporte-retenciones-${selectedMonth}.csv`, taxReport.retentionRows)} className="rounded-lg bg-[#a81d24] px-3 py-1.5 text-xs font-bold text-white">Exportar CSV</button>}
                    >
                        <div className="mb-4 rounded-xl border border-[#ead5c5] bg-[#fff8f5] p-4">
                            <div className="text-xs font-bold uppercase tracking-[0.3em] text-[#a81d24]">{APP_BRAND_NAME}</div>
                            <div className="text-lg font-black text-[#2b1113]">Reporte de retenciones fiscales</div>
                            <div className="text-xs font-semibold text-stone-500">Periodo: {selectedMonth || 'Todos'}</div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className={tableClass}>
                                <thead>
                                    <tr>
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
                                    {taxReport.retentionRows.map((row, idx) => (
                                        <tr key={`${row.type}-${row.document}-${idx}`}>
                                            <td className={tdClass}>{row.type}</td>
                                            <td className={tdClass}>{row.date}</td>
                                            <td className={tdClass}>{row.document || '-'}</td>
                                            <td className={tdClass}>{row.source}</td>
                                            <td className={`${tdClass} text-right font-semibold`}>{fmt(row.retentionIr2)}</td>
                                            <td className={`${tdClass} text-right font-semibold`}>{fmt(row.retentionMunicipal1)}</td>
                                            <td className={`${tdClass} text-right font-black text-[#7f1218]`}>{fmt(row.retentionTotal)}</td>
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <StatCard title="Ventas Subtotal" value={fmt(taxReport.totals.salesSubtotal)} icon="trendingUp" variant="success" />
                        <StatCard title="Costo Subtotal" value={fmt(taxReport.totals.purchaseSubtotal)} icon="shoppingCart" variant="warning" />
                        <StatCard title="Utilidad Antes Imp." value={fmt(taxReport.totals.profitBeforeTax)} icon="dollar" variant={taxReport.totals.profitBeforeTax >= 0 ? 'wine' : 'danger'} />
                        <StatCard title="Utilidad Neta" value={fmt(taxReport.totals.netProfitAfterTax)} icon="wallet" variant={taxReport.totals.netProfitAfterTax >= 0 ? 'dark' : 'danger'} />
                    </div>
                    <Card title="Estado de resultado despues de impuesto" subtitle="Formula fiscal solicitada: ventas - costo, IMI 1%, IR 30%" icon="chart" gradient={true}>
                        <div className="space-y-3 text-sm">
                            {[
                                ['Ventas contables (subtotal)', taxReport.totals.salesSubtotal],
                                ['Costo de ventas (subtotal compras)', taxReport.totals.purchaseSubtotal],
                                ['Utilidad antes de impuesto', taxReport.totals.profitBeforeTax],
                                ['Impuesto municipal 1% sobre ventas', -taxReport.totals.municipalTax],
                                ['Utilidad despues de IMI', taxReport.totals.profitAfterMunicipal],
                                ['IR 30% sobre utilidad despues de IMI', -taxReport.totals.incomeTax30],
                                ['Utilidad neta despues de impuestos', taxReport.totals.netProfitAfterTax],
                            ].map(([label, value]) => (
                                <div key={label} className="flex items-center justify-between rounded-xl border border-stone-200 bg-white px-4 py-3">
                                    <span className="font-bold text-stone-600">{label}</span>
                                    <span className={`font-black ${value < 0 ? 'text-rose-700' : 'text-[#7f1218]'}`}>{fmt(value)}</span>
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
};

export default function Reports({ data }) {
    const [activeTab, setActiveTab] = useState('Resultados');
    const [taxTab, setTaxTab] = useState('IVA');
    const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().substring(0, 7));
    const [modalCategory, setModalCategory] = useState(null);

    const aggregatedData = useMemo(() => aggregateData(data), [data]);
    const taxReport = useMemo(() => buildTaxReport(data, selectedMonth), [data, selectedMonth]);

    const availableMonths = useMemo(() => {
        const months = [...new Set(aggregatedData.map(d => d.month))];
        return months.sort((a, b) => b.localeCompare(a));
    }, [aggregatedData]);

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

            const allCategories = new Set([
                ...Object.keys(currentBudgets),
                ...filteredReport.filter(x => !x.isConsolidated).flatMap(x => x.expenseDetails.map(ed => ed[0]))
            ]);

            const expenseMap = {};
            allCategories.forEach(cat => {
                const realAmount = filteredReport
                    .filter(x => !x.isConsolidated)
                    .reduce((acc, curr) => acc + (curr.expenseDetails.find(ed => ed[0] === cat)?.[1] || 0), 0);
                expenseMap[cat] = realAmount;
            });

            finalExpenseRows = Object.entries(expenseMap).sort((a, b) => b[1] - a[1]);
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
            `}</style>

            {/* Expense detail modal */}
            <ExpenseDetailModal
                category={modalCategory}
                expenses={modalExpenses}
                onClose={() => setModalCategory(null)}
            />

            {/* Page header */}
            <div className="overflow-hidden rounded-xl border border-[#e6c9b8] bg-white shadow-sm">
                <div className="h-1 bg-gradient-to-r from-[#a81d24] via-[#f2b635] to-[#a81d24]" />
                <div className="px-6 py-4">
                    <div className="inline-flex items-center gap-2 rounded-full border border-[#f2b635]/40 bg-[#fdf1d6] px-3 py-1 text-xs font-bold uppercase tracking-[0.3em] text-[#8a141b] mb-2">
                        {APP_BRAND_NAME}
                    </div>
                    <h1 className="text-xl font-black text-[#7f1218]">Reportes <span className="text-[#a81d24]">Financieros</span></h1>
                    <p className="text-xs font-medium text-[#8b6a5f] mt-0.5">Análisis de resultados, balance y métricas</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="overflow-hidden rounded-xl border border-[#e6c9b8] bg-white shadow-sm p-2">
                <div className="flex flex-wrap gap-1.5">
                    {Object.entries(tabsConfig).map(([tab, config]) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wide transition-all ${
                                activeTab === tab
                                    ? 'bg-[#a81d24] text-white shadow-sm shadow-red-900/20'
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
                />
            )}

            {activeTab === 'Resultados' && (
                <div className="animate-fade-in space-y-5">
                    {/* Filtro de periodo */}
                    <div className="max-w-sm">
                        <Select
                            label="Periodo de Análisis"
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
                                        {/* Compra de Mercancía */}
                                        <div className="flex items-center justify-between px-3 py-2.5 border-b border-stone-100">
                                            <div className="flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-stone-400" />
                                                <div className="text-xs font-semibold text-stone-600">Compra de Mercancía</div>
                                            </div>
                                            <div className="text-sm font-bold text-stone-700">{fmt(totalPurchasesOnly)}</div>
                                        </div>
                                        {/* Ajuste de inventario */}
                                        <div className="flex items-center justify-between px-3 py-2.5 border-b border-stone-100">
                                            <div className="flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-stone-400" />
                                                <div className="text-xs font-semibold text-stone-600">Ajuste Inv. (Inicial − Final)</div>
                                            </div>
                                            <div className={`text-sm font-bold ${inventoryAdjustment >= 0 ? 'text-stone-700' : 'text-emerald-700'}`}>
                                                {inventoryAdjustment >= 0 ? '' : '−'}{fmt(Math.abs(inventoryAdjustment))}
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
                                        totalNetProfit >= 0 ? 'bg-[#7f1218]' : 'bg-rose-600'
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
                                title="Desglose Operativo"
                                subtitle="Haz clic en una categoría para ver el detalle"
                                icon="receipt"
                            >
                                <div className="overflow-x-auto custom-scrollbar">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="text-left border-b-2 border-[#ead5c5]">
                                                <th className="pb-3 text-xs font-bold uppercase tracking-wider text-stone-500">Categoría</th>
                                                <th className="pb-3 text-xs font-bold uppercase tracking-wider text-stone-500 text-right">Real</th>
                                                <th className="pb-3 text-xs font-bold uppercase tracking-wider text-stone-500 text-right">Presupuesto</th>
                                                <th className="pb-3 text-xs font-bold uppercase tracking-wider text-stone-500 text-right">Ejec.</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-stone-100">
                                            {finalExpenseRows.map(([category, amount]) => {
                                                const budget = currentBudgets[category] || 0;
                                                const execPercent = budget > 0 ? (amount / budget) * 100 : 0;
                                                const hasData = amount > 0;

                                                return (
                                                    <tr
                                                        key={category}
                                                        className={`transition-colors ${hasData ? 'cursor-pointer hover:bg-[#fff8f5]' : 'opacity-60'}`}
                                                        onClick={() => hasData && setModalCategory(category)}
                                                    >
                                                        <td className="py-3">
                                                            <div className="flex items-center gap-2">
                                                                <div className={`w-5 h-5 rounded-md flex items-center justify-center ${hasData ? 'bg-[#fff0f0]' : 'bg-stone-100'}`}>
                                                                    <Icon
                                                                        path={Icons.receipt}
                                                                        className={`w-3 h-3 ${hasData ? 'text-[#a81d24]' : 'text-stone-400'}`}
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <div className="font-bold text-stone-700 text-sm uppercase">{category}</div>
                                                                    {!hasData && (
                                                                        <span className="text-[10px] bg-stone-100 px-1.5 py-0.5 rounded text-stone-500 font-medium">Sin movimientos</span>
                                                                    )}
                                                                    {hasData && (
                                                                        <div className="text-[10px] text-[#a81d24] font-semibold">Ver detalle →</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="py-3 text-right">
                                                            <div className="font-bold text-stone-800 text-sm">{fmt(amount)}</div>
                                                        </td>
                                                        <td className="py-3 text-right">
                                                            <div className="text-stone-500 text-sm font-medium">
                                                                {budget > 0 ? fmt(budget) : '—'}
                                                            </div>
                                                        </td>
                                                        <td className="py-3 text-right">
                                                            {budget > 0 ? (
                                                                <div className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold ${
                                                                    execPercent > 100
                                                                        ? 'bg-rose-100 text-rose-700'
                                                                        : execPercent > 80
                                                                            ? 'bg-amber-100 text-amber-700'
                                                                            : 'bg-emerald-100 text-emerald-700'
                                                                }`}>
                                                                    {execPercent.toFixed(1)}%
                                                                </div>
                                                            ) : (
                                                                <span className="text-stone-400">—</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                        <tfoot>
                                            <tr className="border-t-2 border-[#7f1218] bg-stone-50">
                                                <td className="py-3 pl-2">
                                                    <div className="font-bold text-stone-800 uppercase text-xs tracking-wider">Total Operativo</div>
                                                </td>
                                                <td className="py-3 text-right">
                                                    <div className="font-black text-stone-800 text-sm">{fmt(totalExpenses)}</div>
                                                </td>
                                                <td className="py-3 text-right">
                                                    <div className="font-bold text-stone-600 text-sm">{fmt(totalBudgetLimit)}</div>
                                                </td>
                                                <td className="py-3 text-right pr-1">
                                                    <div className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-black ${
                                                        totalExecution > 100
                                                            ? 'bg-rose-600 text-white'
                                                            : totalExecution > 90
                                                                ? 'bg-amber-500 text-white'
                                                                : 'bg-emerald-600 text-white'
                                                    }`}>
                                                        {totalExecution.toFixed(1)}%
                                                    </div>
                                                </td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>

                                {/* Barra presupuesto */}
                                {totalBudgetLimit > 0 && (
                                    <div className="mt-5 rounded-xl border border-stone-200 bg-stone-50 p-4">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-xs font-bold uppercase tracking-wider text-stone-500">Ejecución del Presupuesto Total</span>
                                            <span className={`text-sm font-black ${totalExecution > 100 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                                {totalExecution.toFixed(1)}% utilizado
                                            </span>
                                        </div>
                                        <div className="h-2.5 bg-stone-200 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full rounded-full transition-all duration-700 ${
                                                    totalExecution > 100 ? 'bg-rose-500' : totalExecution > 90 ? 'bg-amber-500' : 'bg-[#a81d24]'
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
