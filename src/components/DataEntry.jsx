// src/components/DataEntry.jsx
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { db } from '../firebase';
import {
    collection, addDoc, Timestamp, query, where, getDocs, orderBy, doc, deleteDoc, updateDoc, setDoc, writeBatch
} from 'firebase/firestore';
import Papa from 'papaparse';
import { APP_BRAND_NAME, DEFAULT_BRANCH_ID, DEFAULT_BRANCH_NAME, fmt, branchName } from '../constants';
import { resolveIncomeEntries } from '../services/incomeAggregation';
import { syncSicarDailyIncome } from '../services/sicarIncomeSync';
import { deleteExpenseTransaction, deletePurchaseTransaction, updateExpenseTransaction, updatePurchaseTransaction } from '../services/linkedTransactions';
import {
    getProviderCode,
    getProviderDisplayName,
    migrateProvidersFromAccountingRecords,
    normalizeProviderName,
    upsertProviderByName,
} from '../services/providers';
import {
    PAYMENT_METHODS,
    PURCHASE_PAYMENT_METHODS,
    buildFiscalPayload,
    computeFiscalAmounts,
    computeRetentions,
    getSupportFiles,
    getSupportPath,
    getSupportUrl,
    hasSupport,
    isCashPayment,
    isCreditPayment,
    isPdfSupportRecord,
    SUPPORT_FILE_TYPES,
    uploadFiscalSupportFiles,
} from '../services/fiscalUtils';

// --- ICONOS SVG INLINE ---
const Icons = {
    plus: "M12 4v16m8-8H4",
    trash: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
    edit: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
    save: "M5 13l4 4L19 7",
    x: "M6 18L18 6M6 6l12 12",
    calendar: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
    building: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
    fileText: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
    alertCircle: "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    checkCircle: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
    chevronRight: "M9 5l7 7-7 7",
    trendingDown: "M13 17h8m0 0V9m0 8l-8-8-4 4-6-6",
    trendingUp: "M13 7h8m0 0v8m0-8l-8-8-4 4-6-6",
    users: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z",
    receipt: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01",
    cash: "M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z",
    printer: "M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z",
    filter: "M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z",
    upload: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0l-4-4m4 4v12",
    box: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
    shoppingCart: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z",
    target: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
    handCoin: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    scale: "M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3",
    dollar: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    tag: "M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z",
    refresh: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
    eye: "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
};

const Icon = ({ path, className = "w-5 h-5" }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
);

// --- COMPONENTES UI ---

const Card = ({ title, children, className = "", right, icon, gradient = false }) => (
    <div className={`rounded-xl shadow-md border border-[#d9e1e8]/60 bg-white overflow-hidden ${className}`}>
        <div className={`flex justify-between items-center px-5 py-3 border-b ${gradient ? 'bg-[#9f111a] border-[#5c0f14]' : 'bg-stone-50 border-[#d8dee6]'}`}>
            <div className="flex items-center gap-3">
                {icon && (
                    <div className={`p-2 rounded-lg ${gradient ? 'bg-white/10' : 'bg-[#fff1f2]'}`}>
                        <Icon path={Icons[icon]} className={`w-4 h-4 ${gradient ? 'text-white' : 'text-[#e30613]'}`} />
                    </div>
                )}
                <h3 className={`text-sm font-bold uppercase tracking-wider ${gradient ? 'text-white' : 'text-[#1f2937]'}`}>{title}</h3>
            </div>
            {right}
        </div>
        <div className="p-5">{children}</div>
    </div>
);

const Button = ({ children, variant = 'primary', className = '', disabled, size = 'md', ...props }) => {
    const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-6 py-3 text-sm' };
    const variants = {
        primary: 'bg-[#e30613] hover:bg-[#9f111a] text-white shadow-sm shadow-red-900/20',
        success: 'bg-emerald-600 hover:bg-emerald-700 text-white',
        danger: 'bg-rose-600 hover:bg-rose-700 text-white',
        warning: 'bg-amber-500 hover:bg-amber-600 text-white',
        purple: 'bg-purple-600 hover:bg-purple-700 text-white',
        sky: 'bg-sky-600 hover:bg-sky-700 text-white',
        ghost: 'bg-transparent hover:bg-stone-100 text-stone-600 border border-stone-200',
        dark: 'bg-[#111827] hover:bg-[#1a0a0b] text-white'
    };

    return (
        <button
            disabled={disabled}
            className={`${sizes[size]} rounded-lg font-bold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
            {...props}
        >
            {children}
        </button>
    );
};

const Input = ({ label, icon, type = "text", className = '', ...props }) => (
    <div className="space-y-1">
        {label && <label className="text-xs font-bold uppercase tracking-wider text-stone-500">{label}</label>}
        <div className="relative group">
            {icon && <Icon path={Icons[icon]} className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 group-focus-within:text-[#e30613] transition-colors" />}
            <input
                type={type}
                className={`w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm font-semibold text-stone-700 outline-none transition-all focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15 ${icon ? 'pl-10' : ''} ${className}`}
                {...props}
            />
        </div>
    </div>
);

const Select = ({ label, icon, options, ...props }) => (
    <div className="space-y-1">
        {label && <label className="text-xs font-bold uppercase tracking-wider text-stone-500">{label}</label>}
        <div className="relative">
            {icon && <Icon path={Icons[icon]} className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />}
            <select
                className={`w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm font-semibold text-stone-700 outline-none transition-all focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15 appearance-none cursor-pointer ${icon ? 'pl-10' : ''}`}
                {...props}
            >
                {options}
            </select>
            <Icon path={Icons.chevronRight} className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 rotate-90 pointer-events-none" />
        </div>
    </div>
);

const Badge = ({ children, variant = 'default' }) => {
    const variants = {
        default: 'bg-stone-100 text-stone-600',
        success: 'bg-emerald-100 text-emerald-700',
        danger: 'bg-rose-100 text-rose-700',
        warning: 'bg-amber-100 text-amber-700',
        info: 'bg-[#fff1f2] text-[#e30613]',
        purple: 'bg-purple-100 text-purple-700'
    };
    return <span className={`px-2 py-1 rounded-full text-xs font-bold ${variants[variant]}`}>{children}</span>;
};

const normalizeFilterText = (value) => (
    String(value ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
);

const PHOTO_EDIT_FOLDERS = {
    ingresos: 'facturas/ventas',
    facturas_membretadas_ventas: 'facturas/membretadas',
    gastos: 'facturas/gastos',
    compras: 'facturas/compras',
};

const createEmptySupportFilesState = () => SUPPORT_FILE_TYPES.reduce((acc, item) => {
    acc[item.key] = null;
    return acc;
}, {});

const SupportFilesInput = ({ files, onChange, disabled = false, compact = false }) => (
    <div className={`grid grid-cols-1 gap-3 ${compact ? '' : 'md:grid-cols-3'}`}>
        {SUPPORT_FILE_TYPES.map((type) => (
            <div key={type.key} className="rounded-xl border border-[#d8dee6] bg-white p-3">
                <label className="text-[10px] font-black uppercase tracking-[0.18em] text-[#9f111a]">{type.label}</label>
                <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(event) => onChange(type.key, event.target.files?.[0] || null)}
                    className="mt-2 block w-full text-xs text-stone-500 file:mr-2 file:rounded-lg file:border-0 file:bg-[#fff1f2] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[#e30613]"
                    disabled={disabled}
                />
                {files?.[type.key] && (
                    <p className="mt-2 truncate text-xs font-bold text-emerald-700">{files[type.key].name}</p>
                )}
            </div>
        ))}
    </div>
);

const cleanForFirestore = (value) => {
    if (value === undefined) return null;
    if (value === null) return null;
    if (value instanceof Timestamp) return value;
    if (Array.isArray(value)) return value.map(cleanForFirestore);
    if (typeof value === 'object') {
        return Object.entries(value).reduce((acc, [key, nestedValue]) => {
            acc[key] = cleanForFirestore(nestedValue);
            return acc;
        }, {});
    }
    return value;
};

const buildEditablePayload = (collectionName, editData, fields) => {
    const dataToSave = {};

    Object.entries(fields).forEach(([key, field]) => {
        if (key === 'id' || key === 'timestamp' || field?.readonly) return;
        const value = editData[key];
        if (field?.type === 'number' || field?.type === 'currency') {
            dataToSave[key] = parseFloat(value) || 0;
        } else {
            dataToSave[key] = value ?? '';
        }
    });

    if (dataToSave.date) dataToSave.month = String(dataToSave.date).substring(0, 7);
    if (dataToSave.saleDate) dataToSave.month = String(dataToSave.saleDate).substring(0, 7);

    if (['ingresos', 'facturas_membretadas_ventas', 'gastos', 'compras'].includes(collectionName)) {
        const fiscal = buildFiscalPayload({
            subtotal: dataToSave.subtotal ?? editData.subtotal,
            iva: dataToSave.iva ?? editData.iva,
            total: dataToSave.total ?? editData.total,
            retentionIr2: dataToSave.retentionIr2 ?? editData.retentionIr2,
            retentionMunicipal1: dataToSave.retentionMunicipal1 ?? editData.retentionMunicipal1,
        });

        dataToSave.amount = fiscal.amount;
        dataToSave.subtotal = fiscal.subtotal;
        dataToSave.iva = fiscal.iva;
        dataToSave.total = fiscal.total;
        dataToSave.retentionIr2 = fiscal.retentionIr2;
        dataToSave.retentionMunicipal1 = fiscal.retentionMunicipal1;
        dataToSave.retentionTotal = fiscal.retentionTotal;
    }

    return dataToSave;
};

const renderDisplayValue = (fields, key, value) => {
    const field = fields[key];
    if (value === null || value === undefined) return '---';
    if (typeof value === 'object' && value instanceof Timestamp) {
        try { return value.toDate().toLocaleString('es-ES'); } catch (e) { return '---'; }
    }
    if (field?.type === 'branch') return branchName(value);
    if (field?.type === 'currency') return fmt(Number(value));
    return String(value);
};

const getRecordDate = (item) => item?.date || item?.saleDate || item?.fecha || item?.month || item?.mes || '';

const getRecordTitle = (item, fields) => {
    const titleKey = ['description', 'descripcion', 'supplier', 'proveedor', 'numeroFactura', 'invoiceNumber', 'reference']
        .find((key) => item?.[key]);
    if (titleKey) return renderDisplayValue(fields, titleKey, item[titleKey]);
    return item?.id ? `Registro ${item.id}` : 'Registro contable';
};

const isPdfSupport = (item) => isPdfSupportRecord(item);

const ModalPortal = ({ children }) => {
    if (typeof document === 'undefined') return children;
    return createPortal(children, document.body);
};

const RecordDetailModal = ({ item, collectionName, fields, onClose, onEdit }) => {
    if (!item) return null;

    const supportFiles = getSupportFiles(item);
    const supportUrl = supportFiles[0]?.url || getSupportUrl(item);
    const detailRows = Object.entries(fields).map(([key, field]) => ({
        key,
        label: field.label,
        value: renderDisplayValue(fields, key, item[key]),
    }));
    const extraRows = [
        ['ID', item.id],
        ['Origen', item.sourceLabel || item.source || item.sourceSystem],
        ['Referencia SICAR', item.sourceRecordId || item.sourceRawId || item.dailySaleCode],
        ['Rutas soporte', supportFiles.map((file) => `${file.label}: ${file.path}`).join(' | ') || getSupportPath(item)],
    ].filter(([, value]) => value);

    return (
        <ModalPortal>
        <div className="app-modal-root fixed inset-0 z-50 flex items-center justify-center p-4">
            <button className="absolute inset-0 bg-[#111827]/55 backdrop-blur-sm" onClick={onClose} aria-label="Cerrar" />
            <div className="app-modal-panel relative grid max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-3xl border border-[#d9e1e8] bg-white shadow-2xl lg:grid-cols-[1.15fr_0.85fr]">
                <div className="flex max-h-[92vh] flex-col overflow-hidden">
                    <div className="border-b border-[#d8dee6] bg-gradient-to-br from-[#9f111a] to-[#111827] px-6 py-5 text-white">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <div className="text-xs font-bold uppercase tracking-[0.35em] text-[#f5b51b]">Vista documental</div>
                                <h2 className="mt-2 text-2xl font-black">{getRecordTitle(item, fields)}</h2>
                                <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold uppercase tracking-wider text-white/70">
                                    <span>{collectionName}</span>
                                    <span>Fecha: {getRecordDate(item) || 'Sin fecha'}</span>
                                    {supportUrl && <span>Con soporte</span>}
                                </div>
                            </div>
                            <button onClick={onClose} className="rounded-xl bg-white/10 p-2 text-white transition hover:bg-white/20">
                                <Icon path={Icons.x} className="h-5 w-5" />
                            </button>
                        </div>
                    </div>

                    <div className="overflow-y-auto p-6">
                        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                                <div className="text-xs font-bold uppercase tracking-wider text-stone-500">Subtotal</div>
                                <div className="mt-1 text-xl font-black text-[#9f111a]">{fmt(Number(item.subtotal ?? item.amount ?? 0))}</div>
                            </div>
                            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                                <div className="text-xs font-bold uppercase tracking-wider text-stone-500">IVA</div>
                                <div className="mt-1 text-xl font-black text-[#9f111a]">{fmt(Number(item.iva ?? 0))}</div>
                            </div>
                            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                                <div className="text-xs font-bold uppercase tracking-wider text-stone-500">Total</div>
                                <div className="mt-1 text-xl font-black text-[#9f111a]">{fmt(Number(item.total ?? item.amount ?? 0))}</div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            {detailRows.map((row) => (
                                <div key={row.key} className="rounded-xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
                                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-stone-400">{row.label}</div>
                                    <div className="mt-1 break-words text-sm font-bold text-stone-800">{row.value || '---'}</div>
                                </div>
                            ))}
                        </div>

                        {extraRows.length > 0 && (
                            <div className="mt-5 rounded-2xl border border-[#d8dee6] bg-[#f8fafc] p-4">
                                <div className="mb-3 text-xs font-black uppercase tracking-[0.25em] text-[#9f111a]">Metadatos</div>
                                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                    {extraRows.map(([label, value]) => (
                                        <div key={label} className="text-xs">
                                            <span className="font-black uppercase tracking-wider text-stone-500">{label}: </span>
                                            <span className="font-semibold text-stone-700">{String(value)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex flex-wrap justify-end gap-2 border-t border-[#d8dee6] bg-stone-50 px-6 py-4">
                        <Button type="button" variant="ghost" onClick={onClose}>Cerrar</Button>
                        <Button type="button" variant="warning" onClick={onEdit} className="flex items-center gap-2">
                            <Icon path={Icons.edit} className="h-4 w-4" /> Editar
                        </Button>
                    </div>
                </div>

                <div className="max-h-[92vh] overflow-y-auto border-l border-[#d8dee6] bg-[#fbf6f1] p-5">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                            <div className="text-xs font-black uppercase tracking-[0.25em] text-[#9f111a]">Soporte fiscal</div>
                            <p className="text-xs font-semibold text-stone-500">Factura y comprobantes de retenciones adjuntos</p>
                        </div>
                        {supportUrl && supportFiles.length === 1 && (
                            <a href={supportUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-[#e30613] px-3 py-1.5 text-xs font-bold text-white">
                                Abrir
                            </a>
                        )}
                    </div>

                    {supportFiles.length > 0 ? (
                        <div className="space-y-4">
                            {supportFiles.map((support) => (
                                <div key={`${support.type}-${support.path || support.url}`} className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[#9f111a]">{support.label}</div>
                                            {support.fileName && <div className="mt-1 text-xs font-semibold text-stone-400">{support.fileName}</div>}
                                        </div>
                                        {support.url && (
                                            <a href={support.url} target="_blank" rel="noreferrer" className="rounded-lg bg-[#e30613] px-3 py-1.5 text-xs font-bold text-white">
                                                Abrir
                                            </a>
                                        )}
                                    </div>
                                    {isPdfSupport(support) ? (
                                        <iframe title={support.label} src={support.url} className="h-[52vh] w-full rounded-xl border border-stone-200 bg-white" />
                                    ) : (
                                        <img src={support.url} alt={support.label} className="max-h-[56vh] w-full rounded-xl object-contain" />
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-stone-300 bg-white text-center">
                            <Icon path={Icons.receipt} className="mb-3 h-12 w-12 text-stone-300" />
                            <div className="text-sm font-black text-stone-500">Sin soporte adjunto</div>
                            <p className="mt-1 max-w-xs text-xs font-semibold text-stone-400">Usa Editar para agregar foto o PDF a este registro.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
        </ModalPortal>
    );
};

const EditRecordModal = ({ item, collectionName, fields, onClose, onSaved }) => {
    const [editData, setEditData] = useState(item);
    const [supportFiles, setSupportFiles] = useState(createEmptySupportFilesState());
    const [loading, setLoading] = useState(false);
    const canAttachPhoto = Boolean(PHOTO_EDIT_FOLDERS[collectionName]);
    const currentSupportFiles = getSupportFiles(item);

    useEffect(() => {
        setEditData(item);
        setSupportFiles(createEmptySupportFilesState());
    }, [item]);

    if (!item) return null;

    const renderInput = (key) => {
        const field = fields[key];
        const value = editData[key];
        if (key === 'timestamp' || field?.readonly) {
            return (
                <div className="rounded-lg border border-stone-200 bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-500">
                    {value === null || value === undefined ? 'No editable' : String(value)}
                </div>
            );
        }

        if (field?.type === 'branch') {
            return (
                <select
                    value={value === null || value === undefined ? '' : String(value)}
                    onChange={(e) => setEditData((prev) => ({ ...prev, [key]: e.target.value }))}
                    className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-semibold text-stone-700 outline-none focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15"
                    disabled={loading}
                >
                    <option value="">Seleccionar...</option>
                    {(field.options || []).map((option) => (
                        <option key={option.id} value={option.id}>{option.name}</option>
                    ))}
                </select>
            );
        }

        const inputType = field?.type === 'currency' || field?.type === 'number'
            ? 'number'
            : field?.type === 'date'
                ? 'date'
                : field?.type === 'month'
                    ? 'month'
                    : 'text';

        return (
            <input
                type={inputType}
                step={inputType === 'number' ? '0.01' : undefined}
                value={value === null || value === undefined ? '' : String(value)}
                onChange={(e) => setEditData((prev) => ({ ...prev, [key]: e.target.value }))}
                className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-semibold text-stone-700 outline-none focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15"
                disabled={loading}
            />
        );
    };

    const handleSave = async () => {
        setLoading(true);
        try {
            let dataToSave = buildEditablePayload(collectionName, editData, fields);

            if (canAttachPhoto && Object.values(supportFiles).some(Boolean)) {
                const photoPayload = await uploadFiscalSupportFiles(supportFiles, PHOTO_EDIT_FOLDERS[collectionName], item.id, item);
                dataToSave = { ...dataToSave, ...photoPayload };
            }

            dataToSave.updatedAt = Timestamp.now();

            if (collectionName === 'compras') {
                await updatePurchaseTransaction(item.id, dataToSave, { previousData: item });
            } else if (collectionName === 'gastos') {
                await updateExpenseTransaction(item.id, dataToSave, { previousData: item });
            } else {
                const batch = writeBatch(db);
                batch.set(doc(collection(db, 'historial_ediciones')), {
                    action: 'update',
                    collectionName,
                    recordId: item.id,
                    previousData: cleanForFirestore(item),
                    newData: cleanForFirestore({ ...item, ...dataToSave }),
                    changedFields: Object.keys(dataToSave),
                    changedAt: Timestamp.now(),
                });
                batch.update(doc(db, collectionName, item.id), cleanForFirestore(dataToSave));
                await batch.commit();
            }

            onSaved(item.id, dataToSave);
            onClose();
        } catch (error) {
            console.error('Error al guardar cambios:', error);
            alert('Error al guardar cambios: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <ModalPortal>
        <div className="app-modal-root fixed inset-0 z-50 flex items-center justify-center p-4">
            <button className="absolute inset-0 bg-[#111827]/50 backdrop-blur-sm" onClick={onClose} aria-label="Cerrar" />
            <div className="app-modal-panel relative max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-[#d9e1e8] bg-white shadow-2xl">
                <div className="flex items-start justify-between gap-4 border-b border-[#d8dee6] bg-[#9f111a] px-5 py-4">
                    <div>
                        <div className="text-xs font-bold uppercase tracking-[0.3em] text-[#f5b51b]">Edicion detallada</div>
                        <h2 className="mt-1 text-lg font-black text-white">Actualizar registro y respaldo fiscal</h2>
                        <p className="mt-1 text-xs font-semibold text-white/70">Cada guardado conserva copia anterior en historial de ediciones.</p>
                    </div>
                    <button onClick={onClose} className="rounded-lg bg-white/10 p-2 text-white transition hover:bg-white/20" disabled={loading}>
                        <Icon path={Icons.x} className="h-4 w-4" />
                    </button>
                </div>

                <div className="max-h-[calc(90vh-9rem)] overflow-y-auto p-5">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {Object.entries(fields).map(([key, field]) => (
                            <div key={key} className={['description', 'descripcion'].includes(key) ? 'md:col-span-2' : ''}>
                                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-stone-500">{field.label}</label>
                                {renderInput(key)}
                            </div>
                        ))}
                    </div>

                    {canAttachPhoto && (
                        <div className="mt-5 rounded-xl border border-[#d8dee6] bg-[#f8fafc] p-4">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <div className="text-xs font-black uppercase tracking-[0.2em] text-[#9f111a]">Soportes fiscales</div>
                                    <p className="text-xs font-semibold text-stone-500">Puedes adjuntar factura principal y comprobantes de retenciones.</p>
                                </div>
                                <Badge variant={currentSupportFiles.length ? 'success' : 'warning'}>
                                    {currentSupportFiles.length ? `${currentSupportFiles.length} soporte(s)` : 'Sin soporte'}
                                </Badge>
                            </div>
                            {currentSupportFiles.length > 0 && (
                                <div className="mb-3 flex flex-wrap gap-2">
                                    {currentSupportFiles.map((support) => (
                                        <a
                                            key={`${support.type}-${support.path || support.url}`}
                                            href={support.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="rounded-lg border border-[#e30613] px-3 py-1.5 text-xs font-bold text-[#e30613]"
                                        >
                                            Ver {support.label}
                                        </a>
                                    ))}
                                </div>
                            )}
                            <SupportFilesInput
                                files={supportFiles}
                                onChange={(type, file) => setSupportFiles((prev) => ({ ...prev, [type]: file }))}
                                disabled={loading}
                            />
                        </div>
                    )}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#d8dee6] bg-stone-50 px-5 py-4">
                    <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>Cancelar</Button>
                    <Button type="button" variant="success" onClick={handleSave} disabled={loading || !item.id} className="flex items-center gap-2">
                        <Icon path={Icons.save} className="h-4 w-4" />
                        {loading ? 'Guardando...' : 'Guardar cambios'}
                    </Button>
                </div>
            </div>
        </div>
        </ModalPortal>
    );
};

// --- COMPONENTE: EDITABLE LIST ---

const EditableRow = ({ item, collectionName, fields, onUpdate, onDelete }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [showViewModal, setShowViewModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [editData, setEditData] = useState(item);
    const [loading, setLoading] = useState(false);

    const buildBlockingMessage = (blockingAbonos = []) => {
        const abonosLabel = blockingAbonos.map((abono) => `#${abono.secuencia || abono.id}`).join(', ');
        return `No se puede eliminar esta compra porque la factura asociada ya tiene abono(s) ${abonosLabel}. Anulalos primero desde Cuentas por Pagar.`;
    };

    const handleSave = async () => {
        setLoading(true);
        try {
            const dataToSave = {};
            for (const key in editData) {
                if (key === 'id') continue;
                if (fields[key]?.readonly) continue;
                if (fields[key]?.type === 'number' || fields[key]?.type === 'currency') {
                    dataToSave[key] = parseFloat(editData[key]) || 0;
                } else if (key === 'timestamp') {
                    continue;
                } else {
                    dataToSave[key] = editData[key];
                }
            }
            if (collectionName === 'compras') {
                await updatePurchaseTransaction(item.id, dataToSave, { previousData: item });
            } else if (collectionName === 'gastos') {
                await updateExpenseTransaction(item.id, dataToSave, { previousData: item });
            } else {
                await updateDoc(doc(db, collectionName, item.id), dataToSave);
            }
            setIsEditing(false);
            onUpdate(item.id, dataToSave);
        } catch (error) {
            console.error("Error al actualizar:", error);
            alert("Error al guardar: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!window.confirm("?Eliminar este registro?")) return;
        setLoading(true);
        try {
            if (collectionName === 'compras') {
                const result = await deletePurchaseTransaction(item.id);
                if (result?.blocked) {
                    alert(buildBlockingMessage(result.blockingAbonos));
                    return;
                }
                await addDoc(collection(db, 'historial_ediciones'), {
                    action: 'delete',
                    collectionName,
                    recordId: item.id,
                    previousData: cleanForFirestore(item),
                    changedAt: Timestamp.now(),
                });
            } else if (collectionName === 'gastos') {
                const result = await deleteExpenseTransaction(item.id);
                if (result?.blocked) {
                    alert(buildBlockingMessage(result.blockingAbonos));
                    return;
                }
                await addDoc(collection(db, 'historial_ediciones'), {
                    action: 'delete',
                    collectionName,
                    recordId: item.id,
                    previousData: cleanForFirestore(item),
                    changedAt: Timestamp.now(),
                });
            } else {
                const batch = writeBatch(db);
                batch.set(doc(collection(db, 'historial_ediciones')), {
                    action: 'delete',
                    collectionName,
                    recordId: item.id,
                    previousData: cleanForFirestore(item),
                    changedAt: Timestamp.now(),
                });
                batch.delete(doc(db, collectionName, item.id));
                await batch.commit();
            }
            onDelete(item.id);
        } catch (error) {
            console.error("Error al eliminar:", error);
            alert("Error al eliminar: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    const renderValue = (key, value) => {
        const field = fields[key];
        if (value === null || value === undefined) return '-';
        if (typeof value === 'object' && value instanceof Timestamp) {
            try { return value.toDate().toLocaleString('es-ES'); } catch (e) { return '-'; }
        }
        if (field?.type === 'branch') return branchName(value);
        if (field?.type === 'currency') return fmt(Number(value));
        return String(value);
    };

    const renderInput = (key, value) => {
        const field = fields[key];
        if (key === 'timestamp') return <span className='text-stone-400 text-xs'>No editable</span>;
        if (field?.readonly) return <span className='text-stone-400 text-xs'>No editable</span>;

        if (field?.type === 'branch') {
            return (
                <select
                    value={value === null || value === undefined ? '' : String(value)}
                    onChange={(e) => setEditData({ ...editData, [key]: e.target.value })}
                    className="w-full rounded border border-[#e30613]/40 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#e30613]/30"
                    disabled={loading}
                >
                    <option value="">Seleccionar...</option>
                    {(field.options || []).map((option) => (
                        <option key={option.id} value={option.id}>{option.name}</option>
                    ))}
                </select>
            );
        }

        const type = field?.type === 'currency' || field?.type === 'number' ? 'number' : field?.type === 'date' ? 'date' : field?.type === 'month' ? 'month' : 'text';

        return (
            <input
                type={type}
                step={type === 'number' ? '0.01' : undefined}
                value={value === null || value === undefined ? '' : String(value)}
                onChange={(e) => setEditData({ ...editData, [key]: e.target.value })}
                className="w-full rounded border border-[#e30613]/40 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#e30613]/30"
                disabled={loading}
            />
        );
    };

    return (
        <tr className="border-b border-stone-100 hover:bg-stone-50 transition-colors">
            {Object.keys(fields).map(key => (
                <td key={key} className="py-2.5 px-3 text-sm">
                    {isEditing ? renderInput(key, editData[key]) : renderValue(key, item[key])}
                </td>
            ))}
            <td className="py-2.5 px-3">
                {hasSupport(item) ? (
                    <Badge variant="success">Con soporte</Badge>
                ) : (
                    <Badge>Sin soporte</Badge>
                )}
            </td>
            <td className="py-2.5 px-3 whitespace-nowrap">
                {isEditing ? (
                    <div className='flex gap-1'>
                        <Button onClick={handleSave} disabled={loading || !item.id} variant="success" size="sm" className="flex items-center gap-1">
                            <Icon path={Icons.save} className="w-3 h-3" /> Guardar
                        </Button>
                        <Button onClick={() => setIsEditing(false)} disabled={loading} variant="ghost" size="sm">Cancelar</Button>
                    </div>
                ) : (
                    <>
                        <div className='flex gap-1'>
                            <Button onClick={() => setShowViewModal(true)} disabled={!item.id} variant="ghost" size="sm" className="flex items-center gap-1">
                                <Icon path={Icons.eye} className="w-3 h-3" /> Ver
                            </Button>
                            <Button onClick={() => setShowEditModal(true)} disabled={!item.id} variant="warning" size="sm" className="flex items-center gap-1">
                                <Icon path={Icons.edit} className="w-3 h-3" /> Editar
                            </Button>
                            <Button onClick={handleDelete} disabled={loading || !item.id} variant="danger" size="sm" className="flex items-center gap-1">
                                <Icon path={Icons.trash} className="w-3 h-3" /> Eliminar
                            </Button>
                        </div>
                        {showEditModal && (
                            <EditRecordModal
                                item={item}
                                collectionName={collectionName}
                                fields={fields}
                                onClose={() => setShowEditModal(false)}
                                onSaved={onUpdate}
                            />
                        )}
                        {showViewModal && (
                            <RecordDetailModal
                                item={item}
                                collectionName={collectionName}
                                fields={fields}
                                onClose={() => setShowViewModal(false)}
                                onEdit={() => {
                                    setShowViewModal(false);
                                    setShowEditModal(true);
                                }}
                            />
                        )}
                    </>
                )}
            </td>
        </tr>
    );
};

const EditableMobileCard = ({ item, collectionName, fields, onUpdate, onDelete }) => {
    const [showEditModal, setShowEditModal] = useState(false);
    const [showViewModal, setShowViewModal] = useState(false);
    const [loading, setLoading] = useState(false);

    const fieldEntries = Object.entries(fields).slice(0, 5);
    const totalValue = Number(item.total ?? item.amount ?? item.monto ?? item.subtotal) || 0;
    const dateLabel = getRecordDate(item) || 'Sin fecha';

    const buildBlockingMessage = (blockingAbonos = []) => {
        const details = blockingAbonos
            .map((abono) => `- ${abono.fecha || 'sin fecha'}: ${fmt(Number(abono.monto) || 0)}`)
            .join('\n');
        return `No se puede eliminar esta compra porque tiene abonos registrados.\n\nElimina primero estos abonos en Cuentas por Pagar:\n${details}`;
    };

    const handleDelete = async () => {
        if (!item.id) return;
        if (!window.confirm("Seguro que deseas eliminar este registro?")) return;

        setLoading(true);
        try {
            if (collectionName === 'compras') {
                const result = await deletePurchaseTransaction(item.id);
                if (result?.blocked) {
                    alert(buildBlockingMessage(result.blockingAbonos));
                    return;
                }
                await addDoc(collection(db, 'historial_ediciones'), {
                    action: 'delete',
                    collectionName,
                    recordId: item.id,
                    previousData: cleanForFirestore(item),
                    changedAt: Timestamp.now(),
                });
            } else if (collectionName === 'gastos') {
                const result = await deleteExpenseTransaction(item.id);
                if (result?.blocked) {
                    alert(buildBlockingMessage(result.blockingAbonos));
                    return;
                }
                await addDoc(collection(db, 'historial_ediciones'), {
                    action: 'delete',
                    collectionName,
                    recordId: item.id,
                    previousData: cleanForFirestore(item),
                    changedAt: Timestamp.now(),
                });
            } else {
                const batch = writeBatch(db);
                batch.set(doc(collection(db, 'historial_ediciones')), {
                    action: 'delete',
                    collectionName,
                    recordId: item.id,
                    previousData: cleanForFirestore(item),
                    changedAt: Timestamp.now(),
                });
                batch.delete(doc(db, collectionName, item.id));
                await batch.commit();
            }
            onDelete(item.id);
        } catch (error) {
            console.error("Error al eliminar:", error);
            alert("Error al eliminar: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate text-base font-black text-slate-900">{getRecordTitle(item, fields)}</div>
                    <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">{dateLabel}</div>
                </div>
                <Badge variant={hasSupport(item) ? 'success' : 'default'}>{hasSupport(item) ? 'Soporte' : 'Sin soporte'}</Badge>
            </div>

            <div className="mt-4 rounded-2xl bg-slate-50 p-3">
                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Total</div>
                <div className="font-mono text-2xl font-black text-[#9f111a]">{fmt(totalValue)}</div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2">
                {fieldEntries.map(([key, field]) => (
                    <div key={key} className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2">
                        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{field.label}</span>
                        <span className="max-w-[58%] break-words text-right text-xs font-bold text-slate-700">{renderDisplayValue(fields, key, item[key])}</span>
                    </div>
                ))}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
                <Button onClick={() => setShowViewModal(true)} disabled={!item.id} variant="ghost" size="sm" className="w-full">
                    Ver
                </Button>
                <Button onClick={() => setShowEditModal(true)} disabled={!item.id} variant="warning" size="sm" className="w-full">
                    Editar
                </Button>
                <Button onClick={handleDelete} disabled={loading || !item.id} variant="danger" size="sm" className="w-full">
                    Eliminar
                </Button>
            </div>

            {showEditModal && (
                <EditRecordModal
                    item={item}
                    collectionName={collectionName}
                    fields={fields}
                    onClose={() => setShowEditModal(false)}
                    onSaved={onUpdate}
                />
            )}
            {showViewModal && (
                <RecordDetailModal
                    item={item}
                    collectionName={collectionName}
                    fields={fields}
                    onClose={() => setShowViewModal(false)}
                    onEdit={() => {
                        setShowViewModal(false);
                        setShowEditModal(true);
                    }}
                />
            )}
        </div>
    );
};

const EditableList = ({
    data,
    collectionName,
    fields,
    filterValue,
    filterType = 'month',
    filterLabel = 'Filtrar por Mes',
    onFilterChange,
    advancedFilters = {},
    advancedFilterConfig = [],
    onAdvancedFiltersChange,
}) => {
    const [localData, setLocalData] = useState(data);

    useEffect(() => {
        setLocalData(data);
    }, [data]);

    const handleUpdate = (id, newData) => {
        setLocalData(prev => prev.map(item => item.id === id ? { ...item, ...newData } : item));
    };

    const handleDelete = (id) => {
        setLocalData(prev => prev.filter(item => item.id !== id));
    };

    const getItemDate = (item) => {
        const dateStr = item.date || item.fecha || item.month || item.mes;
        if (!dateStr) return new Date(0);
        return new Date(dateStr);
    };

    const getItemDateString = (item) => {
        const dateStr = item.date || item.fecha || item.month || item.mes || '';
        return String(dateStr);
    };

    const itemMatchesText = (item, keys = [], filterText = '') => {
        const normalizedFilter = normalizeFilterText(filterText);
        if (!normalizedFilter) return true;
        return keys.some((key) => normalizeFilterText(item[key]).includes(normalizedFilter));
    };

    const filteredData = useMemo(() => {
        let result = localData;

        if (filterValue) {
            result = localData.filter(item => {
                const itemDate = item.date || item.month || item.fecha || item.mes;
                if (!itemDate) return false;
                return filterType === 'date'
                    ? itemDate.substring(0, 10) === filterValue
                    : itemDate.substring(0, 7) === filterValue;
            });
        }

        if (advancedFilters.dateFrom) {
            result = result.filter((item) => {
                const itemDate = getItemDateString(item).substring(0, 10);
                return itemDate && itemDate >= advancedFilters.dateFrom;
            });
        }

        if (advancedFilters.dateTo) {
            result = result.filter((item) => {
                const itemDate = getItemDateString(item).substring(0, 10);
                return itemDate && itemDate <= advancedFilters.dateTo;
            });
        }

        advancedFilterConfig.forEach((filterField) => {
            if (['dateFrom', 'dateTo'].includes(filterField.key)) return;
            const fieldValue = advancedFilters[filterField.key];
            if (!fieldValue) return;
            result = result.filter((item) => itemMatchesText(item, filterField.keys || [filterField.key], fieldValue));
        });

        return result.sort((a, b) => {
            const dateA = getItemDate(a);
            const dateB = getItemDate(b);
            return dateB - dateA;
        });
    }, [advancedFilterConfig, advancedFilters, filterType, filterValue, localData]);

    const hasData = filteredData && filteredData.length > 0;
    const filteredTotal = filteredData.reduce((sum, item) => sum + (Number(item.total ?? item.amount ?? item.monto ?? item.subtotal) || 0), 0);
    const supportCount = filteredData.filter((item) => hasSupport(item)).length;
    const activeAdvancedCount = Object.entries(advancedFilters || {})
        .filter(([key, value]) => !['dateFrom', 'dateTo'].includes(key) && value)
        .length;
    const averageTicket = filteredData.length ? filteredTotal / filteredData.length : 0;
    const supportCoverage = filteredData.length ? (supportCount / filteredData.length) * 100 : 0;
    const topRecords = filteredData.slice(0, 3);

    return (
        <div className="mt-4 space-y-4">
            {onFilterChange && (
                <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-[#f7f9fb] shadow-xl shadow-slate-900/5">
                    <div className="border-b border-slate-200 bg-white px-5 py-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.35em] text-slate-400">Centro de revision ERP</div>
                            <div className="mt-1 text-sm font-semibold text-stone-500">
                                {filteredData.length} registros filtrados · {supportCount} con soporte · Total {fmt(filteredTotal)}
                            </div>
                        </div>
                        <div className="flex flex-wrap items-end gap-3">
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">{filterLabel}</label>
                                <input
                                    type={filterType}
                                    value={filterValue}
                                    onChange={(e) => onFilterChange(e.target.value)}
                                    className="min-w-[170px] bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15 outline-none"
                                />
                            </div>
                            {(filterValue || activeAdvancedCount > 0 || advancedFilters.dateFrom || advancedFilters.dateTo) && (
                                <Button type="button" variant="ghost" size="md" onClick={() => {
                                    onFilterChange('');
                                    advancedFilterConfig.forEach((filterField) => onAdvancedFiltersChange?.(filterField.key, ''));
                                }}>
                                    Limpiar filtros
                                </Button>
                            )}
                        </div>
                    </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 border-b border-slate-200 p-4 sm:grid-cols-2 xl:grid-cols-4">
                        {[
                            ['Registros', filteredData.length, 'Documentos filtrados'],
                            ['Total', fmt(filteredTotal), 'Monto fiscal / contable'],
                            ['Ticket promedio', fmt(averageTicket), 'Promedio por registro'],
                            ['Soportes', `${supportCoverage.toFixed(0)}%`, `${supportCount} con archivo`],
                        ].map(([title, value, subtitle]) => (
                            <div key={title} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">{title}</div>
                                <div className="mt-1 font-mono text-lg font-black text-slate-900">{value}</div>
                                <div className="text-[11px] font-semibold text-slate-500">{subtitle}</div>
                            </div>
                        ))}
                    </div>

                    {advancedFilterConfig.length > 0 && onAdvancedFiltersChange && (
                        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
                            {advancedFilterConfig.map((filterField) => (
                                <div key={filterField.key} className="space-y-1">
                                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                                        {filterField.label}
                                    </label>
                                    <input
                                        type={filterField.type || 'text'}
                                        value={advancedFilters[filterField.key] || ''}
                                        placeholder={filterField.placeholder || ''}
                                        onChange={(e) => onAdvancedFiltersChange(filterField.key, e.target.value)}
                                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15 outline-none"
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {!hasData ? (
                <div className="p-8 border-2 border-dashed border-stone-200 rounded-xl bg-stone-50 text-stone-400 text-center">
                    <Icon path={Icons.alertCircle} className="w-10 h-10 mx-auto mb-3 text-stone-300" />
                    <p className="font-medium text-sm">
                        {filterValue ? `No hay registros para ${filterValue}` : "No hay registros recientes"}
                    </p>
                </div>
            ) : (
                <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
                    {topRecords.length > 0 && (
                        <div className="grid grid-cols-1 gap-3 border-b border-slate-200 bg-[#f8fafc] p-4 xl:grid-cols-3">
                            {topRecords.map((item) => (
                                <div key={`top-${item.id || getRecordTitle(item, fields)}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-black text-slate-900">{getRecordTitle(item, fields)}</div>
                                            <div className="mt-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">{getRecordDate(item) || 'Sin fecha'}</div>
                                        </div>
                                        <Badge variant={hasSupport(item) ? 'success' : 'default'}>{hasSupport(item) ? 'Soporte' : 'Pendiente'}</Badge>
                                    </div>
                                    <div className="mt-4 flex items-end justify-between">
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Total</div>
                                            <div className="font-mono text-lg font-black text-[#9f111a]">{fmt(Number(item.total ?? item.amount ?? item.monto ?? item.subtotal) || 0)}</div>
                                        </div>
                                        <div className="text-right text-[11px] font-semibold text-slate-500">
                                            IVA {fmt(Number(item.iva ?? 0) || 0)}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="flex flex-col gap-2 border-b border-slate-200 bg-white px-4 py-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.32em] text-slate-400">Matriz de documentos</div>
                            <div className="text-sm font-bold text-slate-700">Vista detallada editable con acciones por registro</div>
                        </div>
                        <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-wider text-slate-500">
                            <span className="rounded-full bg-slate-100 px-3 py-1">{filteredData.length} filas</span>
                            <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">{supportCount} soportes</span>
                        </div>
                    </div>
                    <div className="mobile-card-list p-4 md:hidden">
                        {filteredData.map((item, index) => (
                            <EditableMobileCard
                                key={`mobile-${item.id || getRecordTitle(item, fields) || index}`}
                                item={item}
                                collectionName={collectionName}
                                fields={fields}
                                onUpdate={handleUpdate}
                                onDelete={handleDelete}
                            />
                        ))}
                    </div>
                    <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 z-10">
                            <tr className="text-left bg-slate-900 border-b border-slate-800">
                                {Object.values(fields).map(field => (
                                    <th key={field.label} className="py-3 px-3 font-black text-white/80 text-xs uppercase tracking-wider">{field.label}</th>
                                ))}
                                <th className="py-3 px-3 font-black text-white/80 text-xs uppercase tracking-wider">Soporte</th>
                                <th className="py-3 px-3 font-black text-white/80 text-xs uppercase tracking-wider">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredData.map(item => (
                                <EditableRow
                                    key={item.id}
                                    item={item}
                                    collectionName={collectionName}
                                    fields={fields}
                                    onUpdate={handleUpdate}
                                    onDelete={handleDelete}
                                />
                            ))}
                        </tbody>
                    </table>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- FORMULARIOS ---

const IncomeForm = ({ loading, setLoading, onSuccess }) => {
    const [date, setDate] = useState(new Date().toISOString().substring(0, 10));
    const [description, setDescription] = useState('VENTA DEL DIA');
    const [reference, setReference] = useState('');
    const [amount, setAmount] = useState('');
    const [syncDate, setSyncDate] = useState(new Date().toISOString().substring(0, 10));
    const [syncLoading, setSyncLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const numAmount = Number(amount);
        if (!description.trim()) return alert('Complete fecha, detalle y monto.');
        if (isNaN(numAmount) || numAmount <= 0) return alert('Monto inv?lido.');

        setLoading(true);
        try {
            await addDoc(collection(db, 'ingresos'), {
                date,
                month: date.substring(0, 7),
                description: description.trim().toUpperCase(),
                reference: reference.trim().toUpperCase(),
                amount: numAmount,
                subtotal: numAmount,
                subtotalExento: 0,
                iva: 0,
                total: numAmount,
                branch: DEFAULT_BRANCH_ID,
                branchName: DEFAULT_BRANCH_NAME,
                source: 'manual',
                sourceLabel: 'MANUAL',
                timestamp: Timestamp.now(),
                is_conciled: false,
            });
            setDescription('VENTA DEL DIA');
            setReference('');
            setAmount('');
            onSuccess?.();
        } catch (error) {
            console.error('Error:', error);
            alert('Error al guardar');
        } finally {
            setLoading(false);
        }
    };

    const handleSyncIncome = async () => {
        setSyncLoading(true);
        try {
            const result = await syncSicarDailyIncome({ date: syncDate });
            const syncedTotal = Number(result?.totalAmount || 0);
            const syncedIva = Number(result?.totalIva || 0);
            const syncedGrandTotal = Number(result?.grandTotal || syncedTotal);
            const syncedCount = Number(result?.syncedCount || 0);
            const syncedDate = result?.startDate || syncDate;
            alert(`SICAR sincronizado para ${syncedDate}: ${syncedCount} registro(s). Subtotal ${fmt(syncedTotal)}, IVA ${fmt(syncedIva)}, total ${fmt(syncedGrandTotal)}.`);
            onSuccess?.();
        } catch (error) {
            console.error('Error sincronizando SICAR:', error);
            alert(error?.message || 'No se pudo sincronizar desde SICAR.');
        } finally {
            setSyncLoading(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="rounded-lg border border-[#f2c5c5] bg-[#fff8f8] px-4 py-2.5 text-xs font-semibold text-[#9f111a]">
                Todo se registra en {DEFAULT_BRANCH_NAME}.
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="mb-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-800">Sincronizar desde SICAR</h4>
                    <p className="text-xs text-emerald-700 mt-0.5">Sincroniza el total diario sin duplicar el ingreso manual del mismo dia.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Input label="Fecha SICAR" type="date" icon="calendar" value={syncDate} onChange={e => setSyncDate(e.target.value)} />
                    <Button type="button" variant="success" disabled={syncLoading} className="self-end w-full" onClick={handleSyncIncome}>
                        {syncLoading ? 'Sincronizando...' : 'Sincronizar SICAR'}
                    </Button>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-stone-600">Ingreso manual</h4>
                <Input label="Fecha" type="date" icon="calendar" value={date} onChange={e => setDate(e.target.value)} required />
                <Input label="Detalle del ingreso" icon="fileText" placeholder="Ej: Venta del dia, deposito..." value={description} onChange={e => setDescription(e.target.value)} required />
                <Input label="Referencia" icon="receipt" placeholder="Ej: Cierre caja, nota interna..." value={reference} onChange={e => setReference(e.target.value)} />
                <Input label="Monto" type="number" step="0.01" icon="dollar" placeholder="0.00" className="text-lg font-bold text-emerald-600" value={amount} onChange={e => setAmount(e.target.value)} required />
                <Button type="submit" variant="success" disabled={loading} className="w-full">{loading ? 'Guardando...' : 'Registrar Ingreso'}</Button>
            </form>
        </div>
    );
};

const ExpenseForm = ({ categories, loading, setLoading, onSuccess }) => {
    const [date, setDate] = useState(new Date().toISOString().substring(0, 10));
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [categoryId, setCategoryId] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        const numAmount = Number(amount);
        const selectedCategoryName = categories.find(c => c.id === categoryId)?.name;
        if (!description || isNaN(numAmount) || numAmount <= 0 || !selectedCategoryName) return alert('Complete todos los campos.');

        setLoading(true);
        try {
            await addDoc(collection(db, 'gastos'), {
                date,
                description,
                amount: numAmount,
                category: selectedCategoryName,
                branch: DEFAULT_BRANCH_ID,
                branchName: DEFAULT_BRANCH_NAME,
                timestamp: Timestamp.now(),
                is_conciled: false,
            });
            setDescription(''); setAmount(''); setCategoryId('');
            onSuccess?.();
        } catch (error) {
            console.error('Error:', error);
            alert('Error al guardar');
        } finally {
            setLoading(false);
        }
    };

    const handleCSVUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async ({ data, errors }) => {
                if (errors.length) return alert("Error en CSV.");
                const validData = data.filter(row => row['Monto'] && !isNaN(parseFloat(row['Monto']))).map(row => ({
                    date: row['Fecha'] || new Date().toISOString().substring(0, 10),
                    description: row['Descripcion'] || 'Sin Descripci?n',
                    amount: parseFloat(row['Monto']),
                    category: row['Categoria'] || 'Otros',
                    branch: DEFAULT_BRANCH_ID,
                    branchName: DEFAULT_BRANCH_NAME,
                    timestamp: Timestamp.now(), is_conciled: false
                }));
                setLoading(true);
                try {
                    for (const item of validData) await addDoc(collection(db, 'gastos'), item);
                    alert(`?xito: ${validData.length} gastos importados.`);
                    onSuccess?.();
                } catch (error) {
                    alert('Error al importar');
                } finally {
                    setLoading(false); e.target.value = null;
                }
            }
        });
    };

    return (
        <div className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-3">
                <div className="rounded-lg border border-[#f2c5c5] bg-[#fff8f8] px-4 py-2.5 text-xs font-semibold text-[#9f111a]">
                    Todo se registra en {DEFAULT_BRANCH_NAME}.
                </div>
                <Input label="Fecha" type="date" icon="calendar" value={date} onChange={e => setDate(e.target.value)} required />
                <Input label="Descripci?n" icon="fileText" placeholder="Ej: Pago de servicios..." value={description} onChange={e => setDescription(e.target.value)} required />
                <div className="grid grid-cols-2 gap-3">
                    <Input label="Monto" type="number" step="0.01" icon="dollar" placeholder="0.00" className="text-lg font-bold text-rose-600" value={amount} onChange={e => setAmount(e.target.value)} required />
                    <Select label="Categor?a" icon="tag" value={categoryId} onChange={e => setCategoryId(e.target.value)} required options={<><option value="">Seleccionar...</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</>} />
                </div>
                <Button type="submit" variant="danger" disabled={loading} className="w-full">{loading ? 'Guardando...' : 'Registrar Gasto'}</Button>
            </form>
            <div className="border-t border-stone-200 pt-4">
                <div className="bg-amber-50 border border-dashed border-amber-300 rounded-xl p-4 text-center">
                    <Icon path={Icons.upload} className="w-7 h-7 text-amber-500 mx-auto mb-2" />
                    <h4 className="font-bold text-stone-700 text-xs uppercase tracking-wider mb-2">Carga Masiva CSV</h4>
                    <input type="file" accept=".csv" onChange={handleCSVUpload} disabled={loading} className="block w-full text-xs text-stone-500 file:mr-2 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-amber-100 file:text-amber-700 hover:file:bg-amber-200 cursor-pointer" />
                </div>
            </div>
        </div>
    );
};

// --- OTROS FORMULARIOS ---

const getCurrentMonth = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const FiscalPreview = ({ subtotal, iva, total, retentionIr2, retentionMunicipal1 }) => {
    const fiscal = computeFiscalAmounts({ subtotal, iva, total });
    const retentions = computeRetentions({ subtotal: fiscal.subtotal, retentionIr2, retentionMunicipal1 });

    return (
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs font-bold text-stone-600 md:grid-cols-4">
            <div>
                <div className="uppercase tracking-wider text-stone-400">Subtotal</div>
                <div className="text-sm text-stone-800">{fmt(fiscal.subtotal)}</div>
            </div>
            <div>
                <div className="uppercase tracking-wider text-stone-400">IVA</div>
                <div className="text-sm text-stone-800">{fmt(fiscal.iva)}</div>
            </div>
            <div>
                <div className="uppercase tracking-wider text-stone-400">Total</div>
                <div className="text-sm text-[#9f111a]">{fmt(fiscal.total)}</div>
            </div>
            <div>
                <div className="uppercase tracking-wider text-stone-400">Retenciones</div>
                <div className="text-sm text-amber-700">{fmt(retentions.retentionTotal)}</div>
            </div>
        </div>
    );
};

const paymentOptions = (methods) => (
    <>
        <option value="">Seleccionar...</option>
        {methods.map((method) => (
            <option key={method} value={method}>{method}</option>
        ))}
    </>
);

const FiscalExpenseForm = ({ categories, providers = [], loading, setLoading, onSuccess }) => {
    const [date, setDate] = useState(new Date().toISOString().substring(0, 10));
    const [dueDate, setDueDate] = useState(new Date().toISOString().substring(0, 10));
    const [supplier, setSupplier] = useState('');
    const [newSupplier, setNewSupplier] = useState('');
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [description, setDescription] = useState('');
    const [categoryId, setCategoryId] = useState('');
    const [paymentType, setPaymentType] = useState('EFECTIVO');
    const [paymentReference, setPaymentReference] = useState('');
    const [subtotal, setSubtotal] = useState('');
    const [iva, setIva] = useState('');
    const [total, setTotal] = useState('');
    const [retentionIr2, setRetentionIr2] = useState('');
    const [retentionMunicipal1, setRetentionMunicipal1] = useState('');
    const [supportFiles, setSupportFiles] = useState(createEmptySupportFilesState());

    const resetForm = () => {
        setSupplier('');
        setNewSupplier('');
        setDueDate(new Date().toISOString().substring(0, 10));
        setInvoiceNumber('');
        setDescription('');
        setCategoryId('');
        setPaymentType('EFECTIVO');
        setPaymentReference('');
        setSubtotal('');
        setIva('');
        setTotal('');
        setRetentionIr2('');
        setRetentionMunicipal1('');
        setSupportFiles(createEmptySupportFilesState());
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const selectedCategoryName = categories.find(c => c.id === categoryId)?.name;
        const fiscal = buildFiscalPayload({ subtotal, iva, total, retentionIr2, retentionMunicipal1 });
        const cleanSupplier = normalizeProviderName(supplier === '__new__' ? newSupplier : supplier);
        if (!description.trim() || !cleanSupplier || !selectedCategoryName || fiscal.total <= 0) {
            return alert('Complete proveedor, categoria, descripcion y montos fiscales.');
        }

        setLoading(true);
        try {
            const provider = await upsertProviderByName(cleanSupplier, { source: 'gastos' });
            const batch = writeBatch(db);
            const gastoRef = doc(collection(db, 'gastos'));
            const photoPayload = await uploadFiscalSupportFiles(supportFiles, 'facturas/gastos', gastoRef.id);
            const expensePayload = {
                date,
                month: date.substring(0, 7),
                supplier: provider.nombre,
                proveedor: provider.nombre,
                providerId: provider.id,
                proveedorId: provider.id,
                providerCode: provider.code,
                codigoProveedor: provider.code,
                invoiceNumber: invoiceNumber.trim(),
                description: description.trim().toUpperCase(),
                category: selectedCategoryName,
                paymentType,
                paymentReference: paymentReference.trim().toUpperCase(),
                ...fiscal,
                ...photoPayload,
                branch: DEFAULT_BRANCH_ID,
                branchName: DEFAULT_BRANCH_NAME,
                timestamp: Timestamp.now(),
                is_conciled: false,
            };

            if (isCreditPayment(paymentType)) {
                const payableRef = doc(collection(db, 'cuentas_por_pagar'));
                const linkedPayload = {
                    ...expensePayload,
                    linkedPayableId: payableRef.id,
                    sourceFacturaId: payableRef.id,
                    payableType: 'gasto',
                };

                batch.set(gastoRef, linkedPayload);
                batch.set(payableRef, {
                    fecha: date,
                    month: date.substring(0, 7),
                    proveedor: provider.nombre,
                    proveedorId: provider.id,
                    providerCode: provider.code,
                    codigoProveedor: provider.code,
                    numero: invoiceNumber.trim(),
                    factura: invoiceNumber.trim(),
                    vencimiento: dueDate || date,
                    descripcion: description.trim().toUpperCase(),
                    category: selectedCategoryName,
                    expenseCategory: selectedCategoryName,
                    monto: fiscal.total,
                    saldo: fiscal.total,
                    amount: fiscal.subtotal,
                    estado: 'pendiente',
                    paymentType: 'credito',
                    paymentReference: paymentReference.trim().toUpperCase(),
                    isInventoryCost: false,
                    isOperatingExpense: true,
                    mirroredToGastos: true,
                    mirroredExpenseId: gastoRef.id,
                    linkedExpenseId: gastoRef.id,
                    sourceCollection: 'gastos',
                    sourceFacturaId: gastoRef.id,
                    ...fiscal,
                    ...photoPayload,
                    branch: DEFAULT_BRANCH_ID,
                    branchName: DEFAULT_BRANCH_NAME,
                    createdAt: Timestamp.now(),
                    updatedAt: Timestamp.now(),
                    timestamp: Timestamp.now(),
                });
            } else {
                batch.set(gastoRef, expensePayload);
            }

            await batch.commit();
            resetForm();
            onSuccess?.();
        } catch (error) {
            console.error('Error guardando gasto fiscal:', error);
            alert('Error al guardar: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-3">
            <div className="rounded-lg border border-[#f2c5c5] bg-[#fff8f8] px-4 py-2.5 text-xs font-semibold text-[#9f111a]">
                Todo se registra en {DEFAULT_BRANCH_NAME}.
            </div>
            <Input label="Fecha" type="date" icon="calendar" value={date} onChange={e => setDate(e.target.value)} required />
            {isCreditPayment(paymentType) && <Input label="Vencimiento" type="date" icon="calendar" value={dueDate} onChange={e => setDueDate(e.target.value)} required />}
            <Input label="Numero de factura" icon="receipt" placeholder="Dejar vacio si no aplica" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} />
            <Select
                label="Proveedor"
                icon="users"
                value={supplier}
                onChange={e => setSupplier(e.target.value)}
                required
                options={
                    <>
                        <option value="">Seleccionar proveedor...</option>
                        {providers.map((provider) => {
                            const name = getProviderDisplayName(provider);
                            return <option key={provider.id || name} value={name}>{provider.code || provider.codigo || getProviderCode(name)} - {name}</option>;
                        })}
                        <option value="__new__">+ Crear proveedor nuevo</option>
                    </>
                }
            />
            {supplier === '__new__' && (
                <Input label="Nuevo proveedor" icon="users" placeholder="Nombre del proveedor" value={newSupplier} onChange={e => setNewSupplier(e.target.value)} required />
            )}
            <Input label="Descripcion" icon="fileText" placeholder="Ej: Pago de servicios..." value={description} onChange={e => setDescription(e.target.value)} required />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Select label="Categoria" icon="tag" value={categoryId} onChange={e => setCategoryId(e.target.value)} required options={<><option value="">Seleccionar...</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</>} />
                <Select label="Tipo de pago" icon="cash" value={paymentType} onChange={e => setPaymentType(e.target.value)} required options={paymentOptions(PURCHASE_PAYMENT_METHODS)} />
            </div>
            <Input label="Referencia de pago" icon="fileText" placeholder="Referencia bancaria o tarjeta..." value={paymentReference} onChange={e => setPaymentReference(e.target.value)} />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input label="Subtotal" type="number" step="0.01" icon="dollar" placeholder="0.00" value={subtotal} onChange={e => setSubtotal(e.target.value)} required />
                <Input label="IVA" type="number" step="0.01" icon="dollar" placeholder="0.00" value={iva} onChange={e => setIva(e.target.value)} />
                <Input label="Total" type="number" step="0.01" icon="dollar" placeholder="0.00" value={total} onChange={e => setTotal(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input label="Retencion anticipo IR 2%" type="number" step="0.01" icon="scale" placeholder="0.00" value={retentionIr2} onChange={e => setRetentionIr2(e.target.value)} />
                <Input label="Retencion municipal 1%" type="number" step="0.01" icon="scale" placeholder="0.00" value={retentionMunicipal1} onChange={e => setRetentionMunicipal1(e.target.value)} />
            </div>
            <FiscalPreview subtotal={subtotal} iva={iva} total={total} retentionIr2={retentionIr2} retentionMunicipal1={retentionMunicipal1} />
            <div className="space-y-2 rounded-xl border border-[#d8dee6] bg-[#f8fafc] p-3">
                <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-stone-500">Soportes fiscales</label>
                    <p className="mt-1 text-xs font-semibold text-stone-400">Sube factura principal y, si aplica, las dos retenciones.</p>
                </div>
                <SupportFilesInput
                    files={supportFiles}
                    onChange={(type, file) => setSupportFiles((prev) => ({ ...prev, [type]: file }))}
                    disabled={loading}
                />
            </div>
            <Button type="submit" variant="danger" disabled={loading} className="w-full">{loading ? 'Guardando...' : 'Registrar Gasto'}</Button>
        </form>
    );
};

const FiscalPurchasesForm = ({ categories, providers = [], loading, setLoading, onSuccess }) => {
    const [date, setDate] = useState(new Date().toISOString().substring(0, 10));
    const [dueDate, setDueDate] = useState(new Date().toISOString().substring(0, 10));
    const [supplier, setSupplier] = useState('');
    const [newSupplier, setNewSupplier] = useState('');
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [description, setDescription] = useState('');
    const [categoryId, setCategoryId] = useState('');
    const [paymentType, setPaymentType] = useState('TRANSFERENCIA');
    const [paymentReference, setPaymentReference] = useState('');
    const [subtotal, setSubtotal] = useState('');
    const [iva, setIva] = useState('');
    const [total, setTotal] = useState('');
    const [retentionIr2, setRetentionIr2] = useState('');
    const [retentionMunicipal1, setRetentionMunicipal1] = useState('');
    const [supportFiles, setSupportFiles] = useState(createEmptySupportFilesState());

    const resetForm = () => {
        setSupplier('');
        setNewSupplier('');
        setDueDate(new Date().toISOString().substring(0, 10));
        setInvoiceNumber('');
        setDescription('');
        setCategoryId('');
        setPaymentType('TRANSFERENCIA');
        setPaymentReference('');
        setSubtotal('');
        setIva('');
        setTotal('');
        setRetentionIr2('');
        setRetentionMunicipal1('');
        setSupportFiles(createEmptySupportFilesState());
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const fiscal = buildFiscalPayload({ subtotal, iva, total, retentionIr2, retentionMunicipal1 });
        const categoryName = categories.find(c => c.id === categoryId)?.name || 'Compra de mercancia';
        const cleanSupplier = normalizeProviderName(supplier === '__new__' ? newSupplier : supplier);
        if (!cleanSupplier || fiscal.total <= 0 || !paymentType) {
            return alert('Complete proveedor, tipo de pago y montos fiscales.');
        }

        setLoading(true);
        try {
            const provider = await upsertProviderByName(cleanSupplier, { source: 'compras' });
            const batch = writeBatch(db);
            const purchaseRef = doc(collection(db, 'compras'));
            const photoPayload = await uploadFiscalSupportFiles(supportFiles, 'facturas/compras', purchaseRef.id);
            const purchasePayload = {
                date,
                month: date.substring(0, 7),
                supplier: provider.nombre,
                proveedor: provider.nombre,
                providerId: provider.id,
                proveedorId: provider.id,
                providerCode: provider.code,
                codigoProveedor: provider.code,
                invoiceNumber: invoiceNumber.trim(),
                description: description.trim().toUpperCase(),
                category: categoryName,
                paymentType,
                paymentReference: paymentReference.trim().toUpperCase(),
                isInventoryCost: true,
                source: 'manual',
                ...fiscal,
                ...photoPayload,
                branch: DEFAULT_BRANCH_ID,
                branchName: DEFAULT_BRANCH_NAME,
                timestamp: Timestamp.now(),
            };

            if (isCreditPayment(paymentType)) {
                const payableRef = doc(collection(db, 'cuentas_por_pagar'));
                batch.set(payableRef, {
                    proveedor: provider.nombre,
                    proveedorId: provider.id,
                    providerCode: provider.code,
                    codigoProveedor: provider.code,
                    factura: invoiceNumber.trim(),
                    numero: invoiceNumber.trim(),
                    fecha: date,
                    vencimiento: dueDate || date,
                    month: date.substring(0, 7),
                    monto: fiscal.total,
                    saldo: fiscal.total,
                    amount: fiscal.subtotal,
                    estado: 'pendiente',
                    descripcion: description.trim().toUpperCase(),
                    category: categoryName,
                    paymentType,
                    paymentReference: paymentReference.trim().toUpperCase(),
                    linkedPurchaseId: purchaseRef.id,
                    ...fiscal,
                    ...photoPayload,
                    branch: DEFAULT_BRANCH_ID,
                    branchName: DEFAULT_BRANCH_NAME,
                    createdAt: Timestamp.now(),
                    updatedAt: Timestamp.now(),
                });
                batch.set(purchaseRef, { ...purchasePayload, linkedPayableId: payableRef.id, sourceFacturaId: payableRef.id });
            } else if (isCashPayment(paymentType)) {
                const cashRef = doc(collection(db, 'gastosDiarios'));
                batch.set(cashRef, {
                    fecha: date,
                    date,
                    tipo: 'Compra',
                    descripcion: description.trim().toUpperCase() || `Compra ${provider.nombre}`,
                    proveedor: provider.nombre,
                    supplier: provider.nombre,
                    providerId: provider.id,
                    proveedorId: provider.id,
                    providerCode: provider.code,
                    codigoProveedor: provider.code,
                    factura: invoiceNumber.trim(),
                    invoiceNumber: invoiceNumber.trim(),
                    monto: fiscal.total,
                    amount: fiscal.subtotal,
                    category: categoryName,
                    paymentType,
                    paymentReference: paymentReference.trim().toUpperCase(),
                    ...fiscal,
                    ...photoPayload,
                    branch: DEFAULT_BRANCH_ID,
                    branchName: DEFAULT_BRANCH_NAME,
                    timestamp: Timestamp.now(),
                    is_conciled: false,
                });
                batch.set(purchaseRef, { ...purchasePayload, linkedCashExpenseId: cashRef.id });
            } else {
                batch.set(purchaseRef, purchasePayload);
            }

            await batch.commit();
            resetForm();
            onSuccess?.();
        } catch (error) {
            console.error('Error guardando compra fiscal:', error);
            alert('Error al guardar: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-3">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-700">
                CREDITO crea cuenta por pagar + compra. EFECTIVO crea gasto diario + compra. Transferencia y tarjetas quedan como compra de contado.
            </div>
            <div className="rounded-lg border border-[#f2c5c5] bg-[#fff8f8] px-4 py-2.5 text-xs font-semibold text-[#9f111a]">
                Todo se registra en {DEFAULT_BRANCH_NAME}.
            </div>
            <Input label="Fecha" type="date" icon="calendar" value={date} onChange={e => setDate(e.target.value)} required />
            {isCreditPayment(paymentType) && <Input label="Vencimiento" type="date" icon="calendar" value={dueDate} onChange={e => setDueDate(e.target.value)} required />}
            <Input label="Numero de factura" icon="fileText" placeholder="Dejar vacio si SICAR/proveedor no manda folio" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} />
            <Select
                label="Proveedor"
                icon="users"
                value={supplier}
                onChange={e => setSupplier(e.target.value)}
                required
                options={
                    <>
                        <option value="">Seleccionar proveedor...</option>
                        {providers.map((provider) => {
                            const name = getProviderDisplayName(provider);
                            return <option key={provider.id || name} value={name}>{provider.code || provider.codigo || getProviderCode(name)} - {name}</option>;
                        })}
                        <option value="__new__">+ Crear proveedor nuevo</option>
                    </>
                }
            />
            {supplier === '__new__' && (
                <Input label="Nuevo proveedor" icon="users" placeholder="Nombre del proveedor" value={newSupplier} onChange={e => setNewSupplier(e.target.value)} required />
            )}
            <Input label="Descripcion" icon="fileText" placeholder="Detalle de la compra" value={description} onChange={e => setDescription(e.target.value)} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Select label="Categoria" icon="tag" value={categoryId} onChange={e => setCategoryId(e.target.value)} options={<><option value="">Compra de mercancia</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</>} />
                <Select label="Tipo de pago" icon="cash" value={paymentType} onChange={e => setPaymentType(e.target.value)} required options={paymentOptions(PURCHASE_PAYMENT_METHODS)} />
            </div>
            <Input label="Referencia de pago" icon="fileText" placeholder="Referencia bancaria o tarjeta..." value={paymentReference} onChange={e => setPaymentReference(e.target.value)} />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input label="Subtotal" type="number" step="0.01" icon="shoppingCart" placeholder="0.00" value={subtotal} onChange={e => setSubtotal(e.target.value)} required />
                <Input label="IVA" type="number" step="0.01" icon="dollar" placeholder="0.00" value={iva} onChange={e => setIva(e.target.value)} />
                <Input label="Total" type="number" step="0.01" icon="dollar" placeholder="0.00" value={total} onChange={e => setTotal(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input label="Retencion anticipo IR 2%" type="number" step="0.01" icon="scale" placeholder="0.00" value={retentionIr2} onChange={e => setRetentionIr2(e.target.value)} />
                <Input label="Retencion municipal 1%" type="number" step="0.01" icon="scale" placeholder="0.00" value={retentionMunicipal1} onChange={e => setRetentionMunicipal1(e.target.value)} />
            </div>
            <FiscalPreview subtotal={subtotal} iva={iva} total={total} retentionIr2={retentionIr2} retentionMunicipal1={retentionMunicipal1} />
            <div className="space-y-2 rounded-xl border border-purple-200 bg-purple-50/60 p-3">
                <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-stone-500">Soportes fiscales</label>
                    <p className="mt-1 text-xs font-semibold text-stone-500">Sube factura principal y, si aplica, los soportes de retenciones.</p>
                </div>
                <SupportFilesInput
                    files={supportFiles}
                    onChange={(type, file) => setSupportFiles((prev) => ({ ...prev, [type]: file }))}
                    disabled={loading}
                />
            </div>
            <Button type="submit" variant="purple" disabled={loading} className="w-full">{loading ? 'Guardando...' : 'Registrar Compra'}</Button>
        </form>
    );
};

const StampedSalesInvoiceForm = ({ data, loading, setLoading, onSuccess }) => {
    const [saleDate, setSaleDate] = useState(new Date().toISOString().substring(0, 10));
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [subtotal, setSubtotal] = useState('');
    const [iva, setIva] = useState('');
    const [total, setTotal] = useState('');
    const [retentionIr2, setRetentionIr2] = useState('');
    const [retentionMunicipal1, setRetentionMunicipal1] = useState('');
    const [paymentMethod, setPaymentMethod] = useState('BAC POS');

    const dailySales = useMemo(() => (
        resolveIncomeEntries(data.ingresos || [])
            .filter((item) => item.source === 'sicar' || item.sourceType === 'daily_sale' || item.dailySaleCode)
            .map((item) => ({
                ...item,
                date: item.date || item.fecha || '',
                subtotal: Number(item.subtotal ?? item.amount ?? 0) || 0,
                iva: Number(item.iva ?? 0) || 0,
                total: Number(item.total ?? item.amount ?? 0) || 0,
                dailySaleCode: item.dailySaleCode || item.reference || `VENTA-${String(item.date || item.fecha || '').replaceAll('-', '')}`,
            }))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    ), [data.ingresos]);

    const selectedSale = dailySales.find((item) => item.date === saleDate);
    const linkedInvoices = (data.facturas_membretadas_ventas || []).filter((item) => (
        item.saleDate === saleDate || item.linkedIngresoId === selectedSale?.id || item.dailySaleCode === selectedSale?.dailySaleCode
    ));
    const alreadyStamped = linkedInvoices.reduce((sum, item) => sum + Number(item.total ?? item.amount ?? 0), 0);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!selectedSale) return alert('Primero debe existir la venta diaria SICAR para ese dia.');
        const fiscal = buildFiscalPayload({ subtotal, iva, total, retentionIr2, retentionMunicipal1 });
        if (!invoiceNumber.trim() || fiscal.total <= 0 || !paymentMethod) {
            return alert('Complete factura, metodo de pago y montos.');
        }
        if (alreadyStamped + fiscal.total > selectedSale.total + 0.01) {
            const confirmed = window.confirm('Las facturas membretadas superan el total diario SICAR. Desea continuar?');
            if (!confirmed) return;
        }

        setLoading(true);
        try {
            await addDoc(collection(db, 'facturas_membretadas_ventas'), {
                saleDate,
                linkedIngresoId: selectedSale.id,
                dailySaleCode: selectedSale.dailySaleCode,
                numeroFactura: invoiceNumber.trim(),
                paymentMethod,
                ...fiscal,
                dailySaleSubtotal: selectedSale.subtotal,
                dailySaleIva: selectedSale.iva,
                dailySaleTotal: selectedSale.total,
                source: 'manual',
                sourceType: 'stamped_sale_invoice',
                branch: DEFAULT_BRANCH_ID,
                branchName: DEFAULT_BRANCH_NAME,
                timestamp: Timestamp.now(),
            });
            setInvoiceNumber('');
            setSubtotal('');
            setIva('');
            setTotal('');
            setRetentionIr2('');
            setRetentionMunicipal1('');
            setPaymentMethod('BAC POS');
            onSuccess?.();
        } catch (error) {
            console.error('Error guardando factura membretada:', error);
            alert('Error al guardar: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-3">
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs font-semibold text-sky-800">
                Seleccione el dia de venta SICAR y registre cada factura membretada emitida sobre esa venta diaria.
            </div>
            <Input label="Dia de la venta" type="date" icon="calendar" value={saleDate} onChange={e => setSaleDate(e.target.value)} required />
            {selectedSale ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800">
                    <div>{selectedSale.dailySaleCode}</div>
                    <div className="mt-1 grid grid-cols-2 gap-2 md:grid-cols-4">
                        <span>Subtotal: {fmt(selectedSale.subtotal)}</span>
                        <span>IVA: {fmt(selectedSale.iva)}</span>
                        <span>Total: {fmt(selectedSale.total)}</span>
                        <span>Membretado: {fmt(alreadyStamped)}</span>
                    </div>
                </div>
            ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">
                    No hay venta diaria SICAR cargada para este dia. Sincronice ventas primero.
                </div>
            )}
            <Input label="Numero de factura" icon="receipt" placeholder="Numero membretado" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} required />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input label="Subtotal" type="number" step="0.01" icon="dollar" placeholder="0.00" value={subtotal} onChange={e => setSubtotal(e.target.value)} required />
                <Input label="IVA" type="number" step="0.01" icon="dollar" placeholder="0.00" value={iva} onChange={e => setIva(e.target.value)} />
                <Input label="Total" type="number" step="0.01" icon="dollar" placeholder="0.00" value={total} onChange={e => setTotal(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input label="Retencion anticipo IR 2%" type="number" step="0.01" icon="scale" placeholder="0.00" value={retentionIr2} onChange={e => setRetentionIr2(e.target.value)} />
                <Input label="Retencion municipal 1%" type="number" step="0.01" icon="scale" placeholder="0.00" value={retentionMunicipal1} onChange={e => setRetentionMunicipal1(e.target.value)} />
            </div>
            <Select label="Metodo de pago" icon="cash" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} required options={paymentOptions(PAYMENT_METHODS)} />
            <FiscalPreview subtotal={subtotal} iva={iva} total={total} retentionIr2={retentionIr2} retentionMunicipal1={retentionMunicipal1} />
            <Button type="submit" variant="sky" disabled={loading || !selectedSale} className="w-full">{loading ? 'Guardando...' : 'Registrar Factura Membretada'}</Button>
        </form>
    );
};

const InventoryForm = ({ loading, setLoading, onSuccess }) => {
    const [month, setMonth] = useState(getCurrentMonth());
    const [type, setType] = useState('inicial');
    const [amount, setAmount] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            await addDoc(collection(db, 'inventarios'), {
                month,
                type,
                amount: Number(amount) || 0,
                branch: DEFAULT_BRANCH_ID,
                branchName: DEFAULT_BRANCH_NAME,
                timestamp: Timestamp.now()
            });
            setAmount(''); onSuccess?.();
        } catch (error) { alert('Error'); }
        finally { setLoading(false); }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-3">
            <div className="rounded-lg border border-[#f2c5c5] bg-[#fff8f8] px-4 py-2.5 text-xs font-semibold text-[#9f111a]">
                Todo se registra en {DEFAULT_BRANCH_NAME}.
            </div>
            <Input label="Mes" type="month" icon="calendar" value={month} onChange={e => setMonth(e.target.value)} required />
            <Select label="Tipo" icon="box" value={type} onChange={e => setType(e.target.value)} options={<><option value="inicial">Inicial</option><option value="final">Final</option></>} />
            <Input label="Monto" type="number" step="0.01" icon="dollar" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} required />
            <Button type="submit" variant="primary" disabled={loading} className="w-full">{loading ? 'Guardando...' : 'Registrar'}</Button>
        </form>
    );
};

const PurchasesForm = ({ loading, setLoading, onSuccess }) => {
    const [date, setDate] = useState(new Date().toISOString().substring(0, 10));
    const [supplier, setSupplier] = useState('');
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [amount, setAmount] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        const numAmount = Number(amount);
        if (!supplier.trim() || isNaN(numAmount) || numAmount <= 0) {
            return alert('Complete proveedor y monto.');
        }
        setLoading(true);
        try {
            await addDoc(collection(db, 'compras'), {
                date,
                month: date.substring(0, 7),
                supplier: supplier.trim().toUpperCase(),
                invoiceNumber: invoiceNumber.trim() || 'S/N',
                amount: numAmount,
                branch: DEFAULT_BRANCH_ID,
                branchName: DEFAULT_BRANCH_NAME,
                paymentType: 'contado',
                isInventoryCost: true,
                timestamp: Timestamp.now(),
            });
            setSupplier('');
            setInvoiceNumber('');
            setAmount('');
            onSuccess?.();
        } catch (error) {
            console.error('Error:', error);
            alert('Error al guardar');
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-3">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-700">
                Las compras registradas aqui se contabilizan como costo de contado.
            </div>
            <div className="rounded-lg border border-[#f2c5c5] bg-[#fff8f8] px-4 py-2.5 text-xs font-semibold text-[#9f111a]">
                Todo se registra en {DEFAULT_BRANCH_NAME}.
            </div>
            <Input label="Fecha" type="date" icon="calendar" value={date} onChange={e => setDate(e.target.value)} required />
            <Input label="Proveedor" icon="users" placeholder="Nombre del proveedor" value={supplier} onChange={e => setSupplier(e.target.value)} required />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input label="Numero de Factura" icon="fileText" placeholder="Ej: 001-001-000000001" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} />
                <Input label="Monto Factura" type="number" step="0.01" icon="shoppingCart" placeholder="0.00" className="text-lg font-bold text-purple-600" value={amount} onChange={e => setAmount(e.target.value)} required />
            </div>
            <Button type="submit" variant="purple" disabled={loading} className="w-full">{loading ? 'Guardando...' : 'Registrar Compra de Contado'}</Button>
        </form>
    );
};

const BudgetForm = ({ categories, loading, setLoading, onSuccess }) => {
    const [month, setMonth] = useState(getCurrentMonth());
    const [amount, setAmount] = useState('');
    const [categoryId, setCategoryId] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const catName = categories.find(c => c.id === categoryId)?.name;
            await addDoc(collection(db, 'presupuestos'), { month, category: catName, amount: Number(amount) || 0, timestamp: Timestamp.now() });
            setAmount(''); setCategoryId(''); onSuccess?.();
        } catch (error) { alert('Error'); }
        finally { setLoading(false); }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-3">
            <Input label="Mes" type="month" icon="calendar" value={month} onChange={e => setMonth(e.target.value)} required />
            <Select label="Categor?a" icon="tag" value={categoryId} onChange={e => setCategoryId(e.target.value)} required options={<><option value="">Seleccionar...</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</>} />
            <Input label="Monto" type="number" step="0.01" icon="dollar" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} required />
            <Button type="submit" variant="warning" disabled={loading || !categoryId} className="w-full">{loading ? 'Guardando...' : 'Establecer Presupuesto'}</Button>
        </form>
    );
};

const ReceivableForm = ({ loading, setLoading, onSuccess }) => {
    const [date, setDate] = useState(new Date().toISOString().substring(0, 10));
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            await addDoc(collection(db, 'cuentasPorCobrar'), { date, description, amount: Number(amount) || 0, timestamp: Timestamp.now() });
            setDescription(''); setAmount(''); onSuccess?.();
        } catch (error) { alert('Error'); }
        finally { setLoading(false); }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-3">
            <Input label="Fecha" type="date" icon="calendar" value={date} onChange={e => setDate(e.target.value)} required />
            <Input label="Cliente/Concepto" icon="users" placeholder="Nombre..." value={description} onChange={e => setDescription(e.target.value)} required />
            <Input label="Monto" type="number" step="0.01" icon="dollar" placeholder="0.00" className="text-lg font-bold text-sky-600" value={amount} onChange={e => setAmount(e.target.value)} required />
            <Button type="submit" variant="sky" disabled={loading} className="w-full">{loading ? 'Guardando...' : 'Registrar'}</Button>
        </form>
    );
};

const EquityForm = ({ loading, setLoading, onSuccess }) => {
    const [date, setDate] = useState(new Date().toISOString().substring(0, 10));
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            await addDoc(collection(db, 'patrimonio'), { date, description, amount: Number(amount) || 0, timestamp: Timestamp.now() });
            setDescription(''); setAmount(''); onSuccess?.();
        } catch (error) { alert('Error'); }
        finally { setLoading(false); }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-3">
            <Input label="Fecha" type="date" icon="calendar" value={date} onChange={e => setDate(e.target.value)} required />
            <Input label="Descripci?n" icon="scale" placeholder="Capital, aporte..." value={description} onChange={e => setDescription(e.target.value)} required />
            <Input label="Monto" type="number" step="0.01" icon="dollar" placeholder="0.00" className="text-lg font-bold text-emerald-600" value={amount} onChange={e => setAmount(e.target.value)} required />
            <Button type="submit" variant="success" disabled={loading} className="w-full">{loading ? 'Guardando...' : 'Registrar Patrimonio'}</Button>
        </form>
    );
};

// --- COMPONENTE PRINCIPAL ---

const VALID_TABS = ['Ingresos', 'Facturas Membretadas', 'Gastos', 'Inventario', 'Compras', 'Presupuesto', 'Cuentas por Cobrar', 'Patrimonio'];

export function DataEntry({ categories, data }) {
    const [searchParams] = useSearchParams();
    const urlTab = searchParams.get('tab');

    const [activeTab, setActiveTab] = useState(() => {
        return VALID_TABS.includes(urlTab) ? urlTab : 'Ingresos';
    });
    const [loading, setLoading] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const providers = useMemo(() => (
        [...(data.proveedores || [])]
            .map((provider) => ({
                ...provider,
                nombre: getProviderDisplayName(provider),
                code: provider.code || provider.codigo || getProviderCode(getProviderDisplayName(provider)),
            }))
            .filter((provider) => provider.nombre)
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    ), [data.proveedores]);

    useEffect(() => {
        if (urlTab && VALID_TABS.includes(urlTab)) {
            setActiveTab(urlTab);
        }
    }, [urlTab]);

    useEffect(() => {
        const sessionKey = 'csm-provider-migration-v1';
        if (sessionStorage.getItem(sessionKey)) return;
        sessionStorage.setItem(sessionKey, 'running');
        migrateProvidersFromAccountingRecords()
            .then(() => sessionStorage.setItem(sessionKey, 'done'))
            .catch((error) => {
                sessionStorage.removeItem(sessionKey);
                console.warn('No se pudo migrar proveedores historicos:', error);
            });
    }, []);

    const [filterMonth, setFilterMonth] = useState({
        Ingresos: new Date().toISOString().substring(0, 10),
        'Facturas Membretadas': getCurrentMonth(),
        Gastos: getCurrentMonth(),
        Inventario: getCurrentMonth(),
        Compras: getCurrentMonth(),
        Presupuesto: getCurrentMonth(),
        'Cuentas por Cobrar': getCurrentMonth(),
        Patrimonio: getCurrentMonth(),
    });

    const [advancedFilters, setAdvancedFilters] = useState({
        Ingresos: { dateFrom: '', dateTo: '', search: '' },
        'Facturas Membretadas': { dateFrom: '', dateTo: '', invoiceNumber: '', dailySaleCode: '' },
        Gastos: { dateFrom: '', dateTo: '', search: '' },
        Inventario: {},
        Compras: { dateFrom: '', dateTo: '', supplier: '', invoiceNumber: '' },
        Presupuesto: {},
        'Cuentas por Cobrar': {},
        Patrimonio: {},
    });

    const tabsConfig = {
        'Ingresos': { icon: 'trendingUp', label: 'Ingresos' },
        'Facturas Membretadas': { icon: 'receipt', label: 'Membretadas' },
        'Gastos': { icon: 'trendingDown', label: 'Gastos' },
        'Inventario': { icon: 'box', label: 'Inventario' },
        'Compras': { icon: 'shoppingCart', label: 'Compras' },
        'Presupuesto': { icon: 'target', label: 'Presupuesto' },
        'Cuentas por Cobrar': { icon: 'handCoin', label: 'C. Cobrar' },
        'Patrimonio': { icon: 'scale', label: 'Patrimonio' }
    };

    const filterConfig = {
        Ingresos: { type: 'date', label: 'Filtrar por Dia' },
        'Facturas Membretadas': { type: 'month', label: 'Filtrar por Mes' },
        Gastos: { type: 'month', label: 'Filtrar por Mes' },
        Inventario: { type: 'month', label: 'Filtrar por Mes' },
        Compras: { type: 'month', label: 'Filtrar por Mes' },
        Presupuesto: { type: 'month', label: 'Filtrar por Mes' },
        'Cuentas por Cobrar': { type: 'month', label: 'Filtrar por Mes' },
        Patrimonio: { type: 'month', label: 'Filtrar por Mes' },
    };

    const handleSuccess = () => setRefreshKey(prev => prev + 1);

    const handleFilterChange = (tab, value) => {
        setFilterMonth(prev => ({ ...prev, [tab]: value }));
    };

    const handleAdvancedFilterChange = (tab, key, value) => {
        setAdvancedFilters((prev) => ({
            ...prev,
            [tab]: { ...(prev[tab] || {}), [key]: value },
        }));
    };

    const fieldsConfig = {
        Ingresos: {
            date: { label: 'Fecha', type: 'date' },
            description: { label: 'Detalle', type: 'text' },
            reference: { label: 'Referencia', type: 'text' },
            sourceLabel: { label: 'Origen', type: 'text', readonly: true },
            subtotal: { label: 'Subtotal', type: 'currency' },
            iva: { label: 'IVA', type: 'currency' },
            total: { label: 'Total', type: 'currency' },
            amount: { label: 'Venta Contable', type: 'currency' }
        },
        'Facturas Membretadas': {
            saleDate: { label: 'Fecha Venta', type: 'date' },
            dailySaleCode: { label: 'Venta Diaria', type: 'text', readonly: true },
            numeroFactura: { label: 'Factura', type: 'text' },
            paymentMethod: { label: 'Metodo Pago', type: 'text' },
            subtotal: { label: 'Subtotal', type: 'currency' },
            iva: { label: 'IVA', type: 'currency' },
            total: { label: 'Total', type: 'currency' },
            retentionIr2: { label: 'Ret. IR 2%', type: 'currency' },
            retentionMunicipal1: { label: 'Ret. Municipal 1%', type: 'currency' }
        },
        Gastos: {
            date: { label: 'Fecha', type: 'date' },
            providerCode: { label: 'Codigo', type: 'text', readonly: true },
            supplier: { label: 'Proveedor', type: 'text' },
            invoiceNumber: { label: 'Factura', type: 'text' },
            paymentType: { label: 'Tipo Pago', type: 'text' },
            subtotal: { label: 'Subtotal', type: 'currency' },
            iva: { label: 'IVA', type: 'currency' },
            total: { label: 'Total', type: 'currency' },
            retentionIr2: { label: 'Ret. IR 2%', type: 'currency' },
            retentionMunicipal1: { label: 'Ret. Municipal 1%', type: 'currency' },
            description: { label: 'Descripci?n', type: 'text' },
            category: { label: 'Categor?a', type: 'text' },
            amount: { label: 'Monto', type: 'currency' }
        },
        Inventario: {
            month: { label: 'Mes', type: 'month' },
            type: { label: 'Tipo', type: 'text' },
            amount: { label: 'Monto', type: 'currency' }
        },
        Compras: {
            date: { label: 'Fecha', type: 'date' },
            month: { label: 'Mes', type: 'month' },
            providerCode: { label: 'Codigo', type: 'text', readonly: true },
            supplier: { label: 'Proveedor', type: 'text' },
            invoiceNumber: { label: 'Factura', type: 'text' },
            paymentType: { label: 'Tipo', type: 'text' },
            subtotal: { label: 'Subtotal', type: 'currency' },
            iva: { label: 'IVA', type: 'currency' },
            total: { label: 'Total', type: 'currency' },
            retentionIr2: { label: 'Ret. IR 2%', type: 'currency' },
            retentionMunicipal1: { label: 'Ret. Municipal 1%', type: 'currency' }
        },
        Presupuesto: {
            month: { label: 'Mes', type: 'month' },
            category: { label: 'Categor?a', type: 'text' },
            amount: { label: 'Presupuesto', type: 'currency' }
        },
        'Cuentas por Cobrar': {
            date: { label: 'Fecha', type: 'date' },
            description: { label: 'Concepto', type: 'text' },
            amount: { label: 'Monto', type: 'currency' }
        },
        Patrimonio: {
            date: { label: 'Fecha', type: 'date' },
            description: { label: 'Descripci?n', type: 'text' },
            amount: { label: 'Monto', type: 'currency' }
        }
    };

    const advancedFilterConfig = {
        Ingresos: [
            { key: 'dateFrom', label: 'Desde', type: 'date' },
            { key: 'dateTo', label: 'Hasta', type: 'date' },
            { key: 'search', label: 'Detalle / Referencia', type: 'text', placeholder: 'Buscar ingreso...', keys: ['description', 'reference', 'sourceLabel'] },
        ],
        'Facturas Membretadas': [
            { key: 'dateFrom', label: 'Desde', type: 'date' },
            { key: 'dateTo', label: 'Hasta', type: 'date' },
            { key: 'invoiceNumber', label: 'No. Factura', type: 'text', placeholder: 'Buscar factura...', keys: ['numeroFactura'] },
            { key: 'dailySaleCode', label: 'Venta Diaria', type: 'text', placeholder: 'VENTA-YYYYMMDD', keys: ['dailySaleCode'] },
        ],
        Gastos: [
            { key: 'dateFrom', label: 'Desde', type: 'date' },
            { key: 'dateTo', label: 'Hasta', type: 'date' },
            { key: 'search', label: 'Proveedor / Factura / Categoria', type: 'text', placeholder: 'Buscar gasto...', keys: ['description', 'category', 'supplier', 'invoiceNumber'] },
        ],
        Compras: [
            { key: 'dateFrom', label: 'Desde', type: 'date' },
            { key: 'dateTo', label: 'Hasta', type: 'date' },
            { key: 'supplier', label: 'Proveedor', type: 'text', placeholder: 'Buscar proveedor...', keys: ['supplier'] },
            { key: 'invoiceNumber', label: 'No. Factura', type: 'text', placeholder: 'Buscar factura...', keys: ['invoiceNumber'] },
        ],
    };

    const getListData = () => {
        const collectionMap = {
            'Ingresos': 'ingresos',
            'Facturas Membretadas': 'facturas_membretadas_ventas',
            'Gastos': 'gastos',
            'Inventario': 'inventarios',
            'Compras': 'compras',
            'Presupuesto': 'presupuestos',
            'Cuentas por Cobrar': 'cuentasPorCobrar',
            'Patrimonio': 'patrimonio'
        };

        if (activeTab === 'Ingresos') {
            return resolveIncomeEntries(data.ingresos || []).map((item) => ({
                ...item,
                date: item.date || item.fecha || '',
                description: item.description || item.detalle || 'INGRESO DEL DIA',
                reference: item.reference || item.referencia || '',
                amount: Number(item.amount ?? item.monto ?? 0) || 0,
                subtotal: Number(item.subtotal ?? item.amount ?? item.monto ?? 0) || 0,
                iva: Number(item.iva ?? 0) || 0,
                total: Number(item.total ?? item.amount ?? item.monto ?? 0) || 0,
                sourceLabel: item.source === 'sicar' ? 'SICAR' : 'MANUAL',
            }));
        }

        if (activeTab === 'Facturas Membretadas') {
            return (data.facturas_membretadas_ventas || []).map((item) => ({
                ...item,
                date: item.saleDate || item.date || '',
                saleDate: item.saleDate || item.date || '',
                numeroFactura: item.numeroFactura || item.invoiceNumber || '',
                subtotal: Number(item.subtotal ?? item.amount ?? 0) || 0,
                iva: Number(item.iva ?? 0) || 0,
                total: Number(item.total ?? item.amount ?? 0) || 0,
                retentionIr2: Number(item.retentionIr2 ?? 0) || 0,
                retentionMunicipal1: Number(item.retentionMunicipal1 ?? 0) || 0,
            }));
        }

        if (activeTab === 'Compras') {
            return (data.compras || []).map((item) => ({
                ...item,
                date: item.date || item.fecha || '',
                month: item.month || ((item.date || item.fecha) ? (item.date || item.fecha).substring(0, 7) : ''),
                supplier: item.supplier || item.proveedor || 'REGISTRO LEGACY',
                providerCode: item.providerCode || item.codigoProveedor || getProviderCode(item.supplier || item.proveedor || ''),
                invoiceNumber: item.invoiceNumber || item.numero || '',
                branch: item.branch || DEFAULT_BRANCH_ID,
                branchName: item.branchName || DEFAULT_BRANCH_NAME,
                paymentType: item.paymentType || (item.sourceFacturaId || item.linkedPayableId ? 'credito' : ((item.date || item.fecha) ? 'contado' : 'legacy')),
                subtotal: Number(item.subtotal ?? item.amount ?? item.monto ?? 0) || 0,
                iva: Number(item.iva ?? 0) || 0,
                total: Number(item.total ?? item.amount ?? item.monto ?? 0) || 0,
                retentionIr2: Number(item.retentionIr2 ?? 0) || 0,
                retentionMunicipal1: Number(item.retentionMunicipal1 ?? 0) || 0,
            }));
        }

        if (activeTab === 'Gastos') {
            return (data.gastos || []).map((item) => ({
                ...item,
                date: item.date || item.fecha || '',
                month: item.month || ((item.date || item.fecha) ? (item.date || item.fecha).substring(0, 7) : ''),
                supplier: item.supplier || item.proveedor || 'REGISTRO LEGACY',
                providerCode: item.providerCode || item.codigoProveedor || getProviderCode(item.supplier || item.proveedor || ''),
                invoiceNumber: item.invoiceNumber || item.numero || item.factura || '',
                paymentType: item.paymentType || (item.linkedPayableId || item.sourceFacturaId ? 'CREDITO' : 'CONTADO'),
                subtotal: Number(item.subtotal ?? item.amount ?? item.monto ?? 0) || 0,
                iva: Number(item.iva ?? 0) || 0,
                total: Number(item.total ?? item.amount ?? item.monto ?? 0) || 0,
                retentionIr2: Number(item.retentionIr2 ?? 0) || 0,
                retentionMunicipal1: Number(item.retentionMunicipal1 ?? 0) || 0,
            }));
        }

        return data[collectionMap[activeTab]] || [];
    };

    const getCollectionName = () => {
        const map = {
            'Ingresos': 'ingresos',
            'Facturas Membretadas': 'facturas_membretadas_ventas',
            'Gastos': 'gastos',
            'Inventario': 'inventarios',
            'Compras': 'compras',
            'Presupuesto': 'presupuestos',
            'Cuentas por Cobrar': 'cuentasPorCobrar',
            'Patrimonio': 'patrimonio'
        };
        return map[activeTab];
    };

    return (
        <div className="space-y-5">
            <style>{`
                @keyframes fade-in { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
                .animate-fade-in { animation: fade-in 0.4s ease-out; }
                @media print { .no-print { display: none !important; } }
            `}</style>

            {/* Page header */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm no-print">
                <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.34em] text-[#e30613]">{APP_BRAND_NAME}</div>
                        <h1 className="mt-1 text-xl font-black text-slate-950">Registro operativo</h1>
                    </div>
                    <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                        {tabsConfig[activeTab].label}
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-sm no-print">
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

            {/* Main content */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="no-print animate-fade-in">
                    <Card title={`Nuevo - ${tabsConfig[activeTab].label}`} icon={tabsConfig[activeTab].icon} gradient={true}>
                        {activeTab === 'Ingresos' && <IncomeForm loading={loading} setLoading={setLoading} onSuccess={handleSuccess} />}
                        {activeTab === 'Facturas Membretadas' && <StampedSalesInvoiceForm data={data} loading={loading} setLoading={setLoading} onSuccess={handleSuccess} />}
                        {activeTab === 'Gastos' && <FiscalExpenseForm categories={categories} providers={providers} loading={loading} setLoading={setLoading} onSuccess={handleSuccess} />}
                        {activeTab === 'Inventario' && <InventoryForm loading={loading} setLoading={setLoading} onSuccess={handleSuccess} />}
                        {activeTab === 'Compras' && <FiscalPurchasesForm categories={categories} providers={providers} loading={loading} setLoading={setLoading} onSuccess={handleSuccess} />}
                        {activeTab === 'Presupuesto' && <BudgetForm categories={categories} loading={loading} setLoading={setLoading} onSuccess={handleSuccess} />}
                        {activeTab === 'Cuentas por Cobrar' && <ReceivableForm loading={loading} setLoading={setLoading} onSuccess={handleSuccess} />}
                        {activeTab === 'Patrimonio' && <EquityForm loading={loading} setLoading={setLoading} onSuccess={handleSuccess} />}
                    </Card>
                </div>

                <div className="animate-fade-in">
                    <Card title={`Historial - ${tabsConfig[activeTab].label}`} icon="receipt">
                        <EditableList
                            data={getListData()}
                            collectionName={getCollectionName()}
                            fields={fieldsConfig[activeTab]}
                            filterValue={filterMonth[activeTab]}
                            filterType={filterConfig[activeTab].type}
                            filterLabel={filterConfig[activeTab].label}
                            onFilterChange={(value) => handleFilterChange(activeTab, value)}
                            advancedFilters={advancedFilters[activeTab] || {}}
                            advancedFilterConfig={advancedFilterConfig[activeTab] || []}
                            onAdvancedFiltersChange={(key, value) => handleAdvancedFilterChange(activeTab, key, value)}
                        />
                    </Card>
                </div>
            </div>
        </div>
    );
}
