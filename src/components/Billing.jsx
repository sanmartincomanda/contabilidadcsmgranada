import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { APP_BRAND_NAME, fmt } from '../constants';
import { PAYMENT_METHODS, buildFiscalPayload, uploadFiscalSupportFiles } from '../services/fiscalUtils';

const PAYMENT_BANKS = [
    { key: 'bac', label: 'BAC' },
    { key: 'banpro', label: 'Banpro' },
    { key: 'lafise', label: 'Lafise' },
];

const CASH_DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 1];

const CASHIER_OPTIONS = [
    'Dania Espinoza',
    'Katherine Obando',
    'Jose Flores',
    'Nicol Barbosa',
];

const safeNumber = (value) => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
};

const todayString = () => new Date().toISOString().substring(0, 10);

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

const isAccountingLoadedStatus = (value = '') => (
    ['CONTABILIZADA', 'CONTABILIZADO', 'CARGADA', 'CARGADO', 'LOADED', 'ACCOUNTED'].includes(normalizeText(value))
);

const buildLoadedInvoiceIndex = (savedInvoices = []) => {
    const sourceKeys = new Set();
    const invoiceNumbers = new Set();

    savedInvoices
        .filter((invoice) => !['ANULADA', 'ANULADO', 'CANCELADA', 'CANCELADO', 'DELETED'].includes(normalizeText(invoice.status)))
        .forEach((invoice) => {
            getSicarInvoiceKeys(invoice).forEach((key) => sourceKeys.add(key));
            const numberKey = getInvoiceNumberForMatch(invoice);
            if (numberKey) invoiceNumbers.add(numberKey);
        });

    return { sourceKeys, invoiceNumbers };
};

const isSicarInvoicePendingAccounting = (invoice = {}, loadedIndex = buildLoadedInvoiceIndex()) => {
    if (invoice.accountingInvoiceId || invoice.contabilidadInvoiceId || invoice.membretadaInvoiceId) return false;
    if (isAccountingLoadedStatus(invoice.accountingStatus || invoice.estadoContable)) return false;

    if (getSicarInvoiceKeys(invoice).some((key) => loadedIndex.sourceKeys.has(key))) return false;

    const numberKey = getInvoiceNumberForMatch(invoice);
    if (numberKey && loadedIndex.invoiceNumbers.has(numberKey)) return false;

    return true;
};

const getMonth = (date = '') => String(date || todayString()).substring(0, 7);

const getRecordDate = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value.substring(0, 10);
    if (value?.toDate) return value.toDate().toISOString().substring(0, 10);
    if (value instanceof Date) return value.toISOString().substring(0, 10);
    return String(value).substring(0, 10);
};

const createLineId = (prefix = 'line') => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const emptyTransfer = () => ({ localId: createLineId('transfer'), clientName: '', amount: '', reference: '' });
const emptyPos = () => ({ localId: createLineId('pos'), amount: '', reference: '' });

const createInvoiceDraft = (invoice = {}, fallbackDate = todayString()) => {
    const date = invoice.saleDate || invoice.date || fallbackDate;
    const invoiceNumber = invoice.numeroFactura || invoice.invoiceNumber || '';
    const subtotal = safeNumber(invoice.subtotal ?? invoice.amount);
    const iva = safeNumber(invoice.iva);
    const total = safeNumber(invoice.total || subtotal + iva);

    return {
        localId: invoice.localId || createLineId('invoice'),
        docId: invoice.id || invoice.docId || '',
        date,
        invoiceNumber,
        customerName: invoice.customerName || invoice.cliente || '',
        paymentMethod: invoice.paymentMethod || '',
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

const PaymentMethodSelect = ({ value, onChange, required = false }) => (
    <select className={inputClass} value={value || ''} onChange={(event) => onChange(event.target.value)} required={required}>
        <option value="">Seleccionar metodo...</option>
        {PAYMENT_METHODS.map((method) => (
            <option key={method} value={method}>{method}</option>
        ))}
    </select>
);

const STAMPED_PRINT_LAYOUT_DOC = 'factura_membretada_preimpresa';
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

const DetailRows = ({ title, rows, onChange, onAdd, onRemove, type, clients = [], onCreateClient }) => (
    <div className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
            <div>
                <div className="text-sm font-black text-slate-950">{title}</div>
                <div className="text-xs font-semibold text-slate-500">
                    {type === 'transfer' ? 'Detalle por cliente y referencia bancaria.' : 'Detalle por cierre POS y referencia.'}
                </div>
            </div>
            <button type="button" onClick={onAdd} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white transition hover:bg-[#e30613]">
                Agregar
            </button>
        </div>

        <div className="space-y-2">
            {rows.map((row, index) => (
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
                    <input
                        className={inputClass}
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="Monto"
                        value={row.amount}
                        onChange={(event) => onChange(index, 'amount', event.target.value)}
                    />
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
            ))}
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

function CashClosure({ data }) {
    const sicarClosures = useMemo(() => (
        [...(data.sicar_cierres_caja || [])]
            .map((item) => ({ ...item, date: item.date || getRecordDate(item.closureDateTime || item.fecha) }))
            .sort((a, b) => String(b.closureDateTime || b.fecha || b.date).localeCompare(String(a.closureDateTime || a.fecha || a.date)))
    ), [data.sicar_cierres_caja]);

    const stampedInvoices = useMemo(() => (
        [...(data.facturas_membretadas_ventas || [])]
            .map((item) => ({
                ...item,
                date: item.saleDate || item.date || '',
                invoiceNumber: item.numeroFactura || item.invoiceNumber || '',
                retentionTotal: safeNumber(item.retentionTotal ?? (safeNumber(item.retentionIr2) + safeNumber(item.retentionMunicipal1))),
            }))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    ), [data.facturas_membretadas_ventas]);

    const clients = useMemo(() => (
        [...(data.clientes_facturacion || [])]
            .map((item) => ({ ...item, name: item.name || item.nombre || '' }))
            .filter((item) => item.name)
            .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    ), [data.clientes_facturacion]);

    const waitingClosures = useMemo(() => (
        [...(data.cierres_caja || [])]
            .filter((item) => item.status === 'en_espera')
            .sort((a, b) => String(b.updatedAt?.seconds || b.date || '').localeCompare(String(a.updatedAt?.seconds || a.date || '')))
    ), [data.cierres_caja]);

    const [activeClosureDocId, setActiveClosureDocId] = useState('');
    const [selectedClosureId, setSelectedClosureId] = useState('');
    const [closureDate, setClosureDate] = useState(todayString());
    const [cashierName, setCashierName] = useState('');
    const [cashCount, setCashCount] = useState({});
    const [transfers, setTransfers] = useState({ bac: [], banpro: [], lafise: [] });
    const [posDetails, setPosDetails] = useState({ bac: [], banpro: [], lafise: [] });
    const [closureInvoices, setClosureInvoices] = useState([]);
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [sicarClosureSearch, setSicarClosureSearch] = useState('');
    const [sicarClosurePage, setSicarClosurePage] = useState(1);
    const [closureInvoiceSearch, setClosureInvoiceSearch] = useState('');
    const [closureInvoicePage, setClosureInvoicePage] = useState(1);

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

    const filteredStampedInvoices = useMemo(() => filterRecords(stampedInvoices, closureInvoiceSearch, [
        'date',
        'invoiceNumber',
        'numeroFactura',
        'customerName',
        'cliente',
        'total',
    ]), [stampedInvoices, closureInvoiceSearch]);

    const pagedStampedInvoices = useMemo(() => (
        paginateRecords(filteredStampedInvoices, closureInvoicePage)
    ), [filteredStampedInvoices, closureInvoicePage]);

    useEffect(() => {
        setSicarClosurePage(1);
    }, [sicarClosureSearch]);

    useEffect(() => {
        setClosureInvoicePage(1);
    }, [closureInvoiceSearch]);

    useEffect(() => {
        if (sicarClosurePage !== pagedSicarClosures.page) setSicarClosurePage(pagedSicarClosures.page);
    }, [sicarClosurePage, pagedSicarClosures.page]);

    useEffect(() => {
        if (closureInvoicePage !== pagedStampedInvoices.page) setClosureInvoicePage(pagedStampedInvoices.page);
    }, [closureInvoicePage, pagedStampedInvoices.page]);

    const selectedInvoiceIds = useMemo(() => (
        closureInvoices.map((invoice) => invoice.docId).filter(Boolean)
    ), [closureInvoices]);

    const cashTotal = useMemo(() => (
        CASH_DENOMINATIONS.reduce((sum, denomination) => sum + denomination * safeNumber(cashCount[denomination]), 0)
    ), [cashCount]);

    const transferTotals = useMemo(() => Object.fromEntries(PAYMENT_BANKS.map(({ key }) => [
        key,
        safeNumber((transfers[key] || []).reduce((sum, item) => sum + safeNumber(item.amount), 0)),
    ])), [transfers]);

    const posTotals = useMemo(() => Object.fromEntries(PAYMENT_BANKS.map(({ key }) => [
        key,
        safeNumber((posDetails[key] || []).reduce((sum, item) => sum + safeNumber(item.amount), 0)),
    ])), [posDetails]);

    const manualTotal = safeNumber(
        cashTotal
        + Object.values(transferTotals).reduce((sum, value) => sum + value, 0)
        + Object.values(posTotals).reduce((sum, value) => sum + value, 0)
    );
    const retentionTotal = safeNumber(closureInvoices.reduce((sum, invoice) => (
        sum + safeNumber(invoice.retentionIr2) + safeNumber(invoice.retentionMunicipal1)
    ), 0));
    const sicarExpected = safeNumber(selectedClosure?.calculatedTotal ?? selectedClosure?.calculado ?? selectedClosure?.totalDineroIngresado);
    const expectedAfterRetentions = safeNumber(sicarExpected - retentionTotal);
    const difference = safeNumber(manualTotal - expectedAfterRetentions);

    const loadClosure = (closure) => {
        setActiveClosureDocId(closure.corId ? `cierre_${closure.date || getRecordDate(closure.closureDateTime || closure.fecha)}_${closure.corId}` : '');
        setSelectedClosureId(closure.id);
        setClosureDate(closure.date || getRecordDate(closure.closureDateTime || closure.fecha) || todayString());
        setMessage(`Cargado ${closure.cashboxName || closure.cajaName || 'cierre SICAR'} ${closure.corId || closure.cor_id || ''}.`);
    };

    const loadWaitingClosure = (closure) => {
        setActiveClosureDocId(closure.id || '');
        setClosureDate(closure.date || todayString());
        setCashierName(closure.cashierName || '');
        setSelectedClosureId(closure.linkedSicarClosureId || '');
        setCashCount(closure.cashCount || {});
        setTransfers(closure.transferDetails || { bac: [], banpro: [], lafise: [] });
        setPosDetails(closure.posDetails || { bac: [], banpro: [], lafise: [] });
        setClosureInvoices((closure.stampedInvoiceDrafts || closure.stampedInvoices || []).map((invoice) => createInvoiceDraft(invoice, closure.date || todayString())));
        setNotes(closure.notes || '');
        setMessage(`Cierre en espera cargado: ${closure.date || ''}.`);
    };

    const addClosureInvoice = (invoice) => {
        const draft = createInvoiceDraft(invoice, closureDate);
        setClosureInvoices((prev) => {
            if (draft.docId && prev.some((item) => item.docId === draft.docId)) return prev;
            return [...prev, draft];
        });
    };

    const toggleClosureInvoice = (invoice, checked) => {
        if (checked) {
            addClosureInvoice(invoice);
            return;
        }
        setClosureInvoices((prev) => prev.filter((item) => item.docId !== invoice.id));
    };

    const addBlankClosureInvoice = () => {
        setClosureInvoices((prev) => [...prev, createInvoiceDraft({ date: closureDate }, closureDate)]);
    };

    const removeClosureInvoice = (localId) => {
        setClosureInvoices((prev) => prev.filter((invoice) => invoice.localId !== localId));
    };

    const updateClosureInvoice = (localId, key, value) => {
        setClosureInvoices((prev) => prev.map((invoice) => {
            if (invoice.localId !== localId) return invoice;
            const next = { ...invoice, [key]: value };
            if (key === 'subtotal' || key === 'iva') {
                next.total = String(safeNumber(next.subtotal) + safeNumber(next.iva));
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

        await Promise.all([...touchedClients].map((name) => upsertClientRecord(name, 'cierre_caja')));

        const safeCashierName = String(cashierName || '').trim();
        if (safeCashierName) {
            await upsertCashierRecord(safeCashierName, 'cierre_caja');
        }
    };

    const saveClosure = async (mode = 'closed') => {
        setSaving(true);
        setMessage('');
        try {
            await ensurePeopleRecords();
            const cashierCode = cashierName ? `CAJ-${slugify(cashierName)}` : '';
            const docId = activeClosureDocId || (selectedClosure?.corId
                ? `cierre_${closureDate}_${selectedClosure.corId}`
                : `cierre_${closureDate}_${Date.now()}`);
            const isWaiting = mode === 'waiting';
            const validInvoiceDrafts = closureInvoices.filter(hasInvoiceDraftContent);
            const savedInvoices = [];

            for (const invoice of validInvoiceDrafts) {
                if (!String(invoice.invoiceNumber || '').trim()) {
                    throw new Error('Cada factura membretada del cierre necesita numero de factura.');
                }

                const invoiceDate = invoice.date || closureDate;
                const invoiceDocId = invoice.docId || `membretada_${slugify(invoice.invoiceNumber)}_${invoiceDate.replace(/-/g, '')}`;
                const fiscal = buildFiscalPayload({
                    subtotal: safeNumber(invoice.subtotal),
                    iva: safeNumber(invoice.iva),
                    total: safeNumber(invoice.total) || safeNumber(invoice.subtotal) + safeNumber(invoice.iva),
                    retentionIr2: safeNumber(invoice.retentionIr2),
                    retentionMunicipal1: safeNumber(invoice.retentionMunicipal1),
                });
                const existingInvoice = stampedInvoices.find((item) => item.id === invoiceDocId) || {};
                const supportPayload = await uploadFiscalSupportFiles(
                    invoice.supportFiles || {},
                    'facturacion/facturas_membretadas',
                    invoiceDocId,
                    existingInvoice
                );
                const invoicePayload = {
                    date: invoiceDate,
                    saleDate: invoiceDate,
                    month: getMonth(invoiceDate),
                    numeroFactura: String(invoice.invoiceNumber || '').trim(),
                    invoiceNumber: String(invoice.invoiceNumber || '').trim(),
                    customerName: String(invoice.customerName || '').trim(),
                    paymentMethod: String(invoice.paymentMethod || '').trim(),
                    ...fiscal,
                    source: invoice.sourceSicarInvoiceId ? 'sicar_factura' : (invoice.docId ? 'manual' : 'cierre_caja'),
                    sourceType: 'stamped_sale_invoice',
                    sourceSicarInvoiceId: invoice.sourceSicarInvoiceId || '',
                    status: isWaiting ? 'en_cierre' : 'conciliada',
                    closureStatus: isWaiting ? 'en_espera' : 'conciliada',
                    linkedCashClosureId: docId,
                    linkedSicarClosureId: selectedClosure?.id || '',
                    linkedSicarCorId: selectedClosure?.corId || selectedClosure?.cor_id || null,
                    reconciledAt: isWaiting ? null : serverTimestamp(),
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
                    total: fiscal.total,
                    retentionTotal: fiscal.retentionTotal,
                });
            }

            const payload = {
                date: closureDate,
                month: getMonth(closureDate),
                status: isWaiting ? 'en_espera' : (Math.abs(difference) > 0.01 ? 'con_diferencia' : 'cuadrado'),
                cashierName: cashierName || '',
                cashierCode,
                linkedSicarClosureId: selectedClosure?.id || '',
                linkedSicarCorId: selectedClosure?.corId || selectedClosure?.cor_id || null,
                linkedSicarRccId: selectedClosure?.rccId || selectedClosure?.rcc_id || null,
                sicar: selectedClosure || null,
                sicarExpected,
                retentionAdjustment: retentionTotal,
                expectedAfterRetentions,
                cashCount,
                cashTotal: safeNumber(cashTotal),
                transferDetails: transfers,
                transferTotals,
                posDetails,
                posTotals,
                manualTotal,
                difference,
                stampedInvoiceIds: savedInvoices.map((invoice) => invoice.id),
                stampedInvoices: savedInvoices.map((invoice) => ({
                    id: invoice.id,
                    invoiceNumber: invoice.invoiceNumber,
                    date: invoice.saleDate || invoice.date,
                    subtotal: safeNumber(invoice.subtotal),
                    iva: safeNumber(invoice.iva),
                    total: safeNumber(invoice.total),
                    retentionTotal: safeNumber(invoice.retentionTotal),
                })),
                stampedInvoiceDrafts: validInvoiceDrafts.map((invoice) => ({
                    ...invoice,
                    supportFiles: {},
                    docId: invoice.docId || `membretada_${slugify(invoice.invoiceNumber)}_${(invoice.date || closureDate).replace(/-/g, '')}`,
                })),
                notes,
                source: 'manual_app',
                sourceType: 'cash_closure',
                updatedAt: serverTimestamp(),
                createdAt: serverTimestamp(),
            };

            await setDoc(doc(db, 'cierres_caja', docId), payload, { merge: true });
            setActiveClosureDocId(docId);

            if (!isWaiting && cashierCode && Math.abs(difference) > 0.01) {
                await setDoc(doc(db, 'diferencias_caja', `${docId}_${cashierCode}`), {
                    closureId: docId,
                    date: closureDate,
                    month: getMonth(closureDate),
                    cashierName,
                    cashierCode,
                    amount: difference,
                    status: 'pendiente',
                    source: 'cierre_caja',
                    updatedAt: serverTimestamp(),
                    createdAt: serverTimestamp(),
                }, { merge: true });
            }

            setMessage(isWaiting ? 'Cierre guardado en espera. Podes volver y continuar luego.' : 'Cierre guardado y facturas membretadas conciliadas.');
        } catch (error) {
            console.error(error);
            setMessage(error?.message || 'No se pudo guardar el cierre.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="grid gap-5 xl:grid-cols-[0.9fr_1.3fr]">
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
                                    <button
                                        key={closure.id}
                                        type="button"
                                        onClick={() => loadWaitingClosure(closure)}
                                        className="w-full rounded-2xl border border-amber-200 bg-white p-3 text-left transition hover:border-amber-400"
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <div className="text-sm font-black text-slate-950">{closure.cashierName || 'Sin cajero'}</div>
                                                <div className="text-xs font-bold text-slate-500">{closure.date} · {closure.linkedSicarCorId ? `Corte ${closure.linkedSicarCorId}` : 'Manual'}</div>
                                            </div>
                                            <div className="font-mono text-sm font-black text-amber-700">{fmt(closure.manualTotal || 0)}</div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    {sicarClosures.length === 0 ? (
                        <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-center text-sm font-bold text-slate-400">
                            Aun no hay cierres sincronizados. Ejecuta el worker de facturacion para cargar SICAR.
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
                                <span>Ventas contado: {fmt(closure.cashSalesTotal ?? closure.ventasContado ?? 0)}</span>
                                <span>Recup. credito: {fmt(closure.creditRecoveryTotal ?? closure.recuperacionCredito ?? 0)}</span>
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

            <div className="space-y-5">
                <Section title="Cierre de caja" eyebrow="Formulario operativo" action={<Badge tone={Math.abs(difference) > 0.01 ? 'red' : 'green'}>{Math.abs(difference) > 0.01 ? 'Con diferencia' : 'Cuadrado'}</Badge>}>
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
                            <select className={inputClass} value={selectedClosureId} onChange={(event) => setSelectedClosureId(event.target.value)}>
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
                        <SummaryCard label="Total contado app" value={fmt(manualTotal)} tone="slate" />
                        <SummaryCard label="Diferencia" value={fmt(difference)} tone={Math.abs(difference) > 0.01 ? 'red' : 'green'} />
                    </div>

                    <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                        <div className="mb-3 flex items-center justify-between">
                            <div>
                                <div className="text-sm font-black text-slate-950">Contador de dinero contado</div>
                                <div className="text-xs font-semibold text-slate-500">Ingresa cantidad de billetes/monedas; el total se calcula solo.</div>
                            </div>
                            <div className="font-mono text-xl font-black text-slate-950">{fmt(cashTotal)}</div>
                        </div>
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
                    </div>
                </Section>

                <Section title="Transferencias por cliente" eyebrow="Detalle bancario">
                    <div className="grid gap-4">
                        {PAYMENT_BANKS.map((bank) => (
                            <DetailRows
                                key={bank.key}
                                title={`Transferencia ${bank.label} · ${fmt(transferTotals[bank.key])}`}
                                rows={transfers[bank.key] || []}
                                type="transfer"
                                clients={clients}
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
                        {PAYMENT_BANKS.map((bank) => (
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

                <Section title="Facturas membretadas del cierre" eyebrow="Retenciones que reducen caja">
                    <div className="mb-4 flex flex-col gap-3 rounded-3xl border border-slate-200 bg-slate-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <div className="text-sm font-black text-slate-950">Facturas aplicadas al cierre</div>
                            <div className="text-xs font-semibold text-slate-500">Marca una existente o crea una nueva si SICAR todavia no la cargo.</div>
                        </div>
                        <button type="button" onClick={addBlankClosureInvoice} className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-[#e30613]">
                            Agregar nueva
                        </button>
                    </div>

                    <div className="mb-4">
                        <SearchBox
                            value={closureInvoiceSearch}
                            onChange={setClosureInvoiceSearch}
                            placeholder="Buscar factura membretada por fecha, numero o cliente..."
                            resultLabel={`${filteredStampedInvoices.length} de ${stampedInvoices.length}`}
                        />
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                        {stampedInvoices.length === 0 ? (
                            <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-center text-sm font-bold text-slate-400 md:col-span-2">
                                No hay facturas membretadas guardadas todavia.
                            </div>
                        ) : filteredStampedInvoices.length === 0 ? (
                            <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-center text-sm font-bold text-slate-400 md:col-span-2">
                                No hay facturas membretadas que coincidan con la busqueda.
                            </div>
                        ) : pagedStampedInvoices.records.map((invoice) => (
                            <label key={invoice.id} className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 transition hover:border-[#e30613]">
                                <input
                                    type="checkbox"
                                    checked={selectedInvoiceIds.includes(invoice.id)}
                                    onChange={(event) => toggleClosureInvoice(invoice, event.target.checked)}
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-black text-slate-950">Factura {invoice.invoiceNumber || '-'}</div>
                                    <div className="text-xs font-bold text-slate-500">{invoice.date} · Ret. {fmt(invoice.retentionTotal)}</div>
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
                        ) : closureInvoices.map((invoice, index) => (
                            <div key={invoice.localId} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                                <div className="mb-3 flex items-center justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-black text-slate-950">Factura aplicada #{index + 1}</div>
                                        <div className="text-xs font-bold text-slate-500">Editable antes de guardar en espera o cerrar caja.</div>
                                    </div>
                                    <button type="button" onClick={() => removeClosureInvoice(invoice.localId)} className="rounded-xl border border-red-200 px-3 py-2 text-xs font-black text-red-700 transition hover:bg-red-50">
                                        Quitar
                                    </button>
                                </div>

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
                        ))}
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
                        <button type="button" onClick={() => saveClosure('closed')} disabled={saving} className="rounded-2xl bg-[#e30613] px-5 py-4 text-sm font-black uppercase tracking-[0.2em] text-white shadow-lg shadow-red-950/20 transition hover:bg-[#9f111a] disabled:cursor-not-allowed disabled:opacity-60">
                            {saving ? 'Cerrando...' : 'Cerrar caja y conciliar'}
                        </button>
                    </div>
                </Section>
            </div>
        </div>
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

function StampedInvoices({ data }) {
    const savedInvoices = useMemo(() => (
        [...(data.facturas_membretadas_ventas || [])]
            .map((item) => ({
                ...item,
                date: item.saleDate || item.date || '',
                invoiceNumber: item.numeroFactura || item.invoiceNumber || '',
                items: item.items || [],
            }))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    ), [data.facturas_membretadas_ventas]);

    const loadedInvoiceIndex = useMemo(() => buildLoadedInvoiceIndex(savedInvoices), [savedInvoices]);

    const sicarInvoices = useMemo(() => (
        [...(data.sicar_facturas_membretadas || [])]
            .map((item) => ({
                ...item,
                date: item.date || getRecordDate(item.fecha || item.invoiceDate),
                invoiceNumber: item.numeroFactura || item.invoiceNumber || item.folio || '',
                items: item.items || [],
            }))
            .filter((invoice) => isSicarInvoicePendingAccounting(invoice, loadedInvoiceIndex))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    ), [data.sicar_facturas_membretadas, loadedInvoiceIndex]);

    const clients = useMemo(() => (
        [...(data.clientes_facturacion || [])]
            .map((item) => ({ ...item, name: item.name || item.nombre || '' }))
            .filter((item) => item.name)
            .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    ), [data.clientes_facturacion]);

    const [form, setForm] = useState({
        date: todayString(),
        invoiceNumber: '',
        customerName: '',
        customerAddress: '',
        customerRfc: '',
        subtotal: '',
        iva: '',
        total: '',
        retentionIr2: '',
        retentionMunicipal1: '',
        paymentMethod: '',
        sourceSicarInvoiceId: '',
        items: [],
    });
    const [supportFiles, setSupportFiles] = useState({});
    const [printTarget, setPrintTarget] = useState(null);
    const [printLayout, setPrintLayout] = useState(DEFAULT_STAMPED_PRINT_LAYOUT);
    const [printTemplates, setPrintTemplates] = useState([
        { id: DEFAULT_PRINT_TEMPLATE_ID, name: DEFAULT_PRINT_TEMPLATE_NAME, layout: DEFAULT_STAMPED_PRINT_LAYOUT },
    ]);
    const [activePrintTemplateId, setActivePrintTemplateId] = useState(DEFAULT_PRINT_TEMPLATE_ID);
    const [printTemplateName, setPrintTemplateName] = useState(DEFAULT_PRINT_TEMPLATE_NAME);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [sicarInvoiceSearch, setSicarInvoiceSearch] = useState('');
    const [sicarInvoicePage, setSicarInvoicePage] = useState(1);
    const [savedInvoiceSearch, setSavedInvoiceSearch] = useState('');
    const [savedInvoicePage, setSavedInvoicePage] = useState(1);

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

    const filteredSavedInvoices = useMemo(() => filterRecords(savedInvoices, savedInvoiceSearch, [
        'date',
        'saleDate',
        'invoiceNumber',
        'numeroFactura',
        'customerName',
        'cliente',
        'paymentMethod',
        'total',
    ]), [savedInvoices, savedInvoiceSearch]);

    const pagedSavedInvoices = useMemo(() => (
        paginateRecords(filteredSavedInvoices, savedInvoicePage)
    ), [filteredSavedInvoices, savedInvoicePage]);

    useEffect(() => {
        setSicarInvoicePage(1);
    }, [sicarInvoiceSearch]);

    useEffect(() => {
        setSavedInvoicePage(1);
    }, [savedInvoiceSearch]);

    useEffect(() => {
        if (sicarInvoicePage !== pagedSicarInvoices.page) setSicarInvoicePage(pagedSicarInvoices.page);
    }, [sicarInvoicePage, pagedSicarInvoices.page]);

    useEffect(() => {
        if (savedInvoicePage !== pagedSavedInvoices.page) setSavedInvoicePage(pagedSavedInvoices.page);
    }, [savedInvoicePage, pagedSavedInvoices.page]);

    const update = (key, value) => {
        setForm((prev) => {
            const next = { ...prev, [key]: value };
            if (key === 'subtotal' || key === 'iva') {
                next.total = String(safeNumber(next.subtotal) + safeNumber(next.iva));
            }
            return next;
        });
    };

    const loadSicarInvoice = (invoice) => {
        setForm({
            date: invoice.date || todayString(),
            invoiceNumber: invoice.invoiceNumber || '',
            customerName: invoice.customerName || invoice.cliente || '',
            customerAddress: invoice.customerAddress || invoice.address || '',
            customerRfc: invoice.customerRfc || invoice.rfc || '',
            subtotal: String(safeNumber(invoice.subtotal)),
            iva: String(safeNumber(invoice.iva)),
            total: String(safeNumber(invoice.total)),
            retentionIr2: '',
            retentionMunicipal1: '',
            paymentMethod: invoice.paymentMethod || '',
            sourceSicarInvoiceId: invoice.id || '',
            items: invoice.items || [],
        });
        setMessage(`Factura SICAR ${invoice.invoiceNumber || invoice.id} cargada con ${(invoice.items || []).length} articulo(s).`);
    };

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

    const updateSavedInvoicePaymentMethod = async (invoice, paymentMethod) => {
        const invoiceId = invoice.id || invoice.docId;
        if (!invoiceId) return;
        try {
            await setDoc(doc(db, 'facturas_membretadas_ventas', invoiceId), {
                paymentMethod,
                updatedAt: serverTimestamp(),
            }, { merge: true });
            setMessage(`Metodo de pago actualizado para factura ${invoice.invoiceNumber || invoice.numeroFactura || invoiceId}.`);
        } catch (error) {
            console.error(error);
            setMessage(error?.message || 'No se pudo actualizar el metodo de pago.');
        }
    };

    const saveInvoice = async (event) => {
        event.preventDefault();
        setSaving(true);
        setMessage('');
        try {
            if (!form.invoiceNumber.trim()) throw new Error('Ingresa el numero de factura.');
            if (!safeNumber(form.subtotal) && !safeNumber(form.total)) throw new Error('Ingresa subtotal o total.');

            const docId = `membretada_${slugify(form.invoiceNumber)}_${form.date.replace(/-/g, '')}`;
            const existingInvoice = savedInvoices.find((item) => item.id === docId) || {};
            const supportPayload = await uploadFiscalSupportFiles(
                supportFiles,
                'facturacion/facturas_membretadas',
                docId,
                existingInvoice
            );

            if (form.customerName.trim()) {
                await upsertClientRecord(form.customerName.trim(), 'factura_membretada');
            }

            await setDoc(doc(db, 'facturas_membretadas_ventas', docId), {
                date: form.date,
                saleDate: form.date,
                month: getMonth(form.date),
                numeroFactura: form.invoiceNumber.trim(),
                invoiceNumber: form.invoiceNumber.trim(),
                customerName: form.customerName.trim(),
                customerAddress: form.customerAddress.trim(),
                customerRfc: form.customerRfc.trim(),
                paymentMethod: form.paymentMethod.trim(),
                items: form.items || [],
                ...fiscal,
                source: form.sourceSicarInvoiceId ? 'sicar_factura' : 'manual',
                sourceType: 'stamped_sale_invoice',
                sourceSicarInvoiceId: form.sourceSicarInvoiceId || '',
                status: 'active',
                ...supportPayload,
                updatedAt: serverTimestamp(),
                createdAt: serverTimestamp(),
            }, { merge: true });

            if (form.sourceSicarInvoiceId) {
                await setDoc(doc(db, 'sicar_facturas_membretadas', form.sourceSicarInvoiceId), {
                    accountingStatus: 'contabilizada',
                    accountingInvoiceId: docId,
                    accountingInvoiceNumber: form.invoiceNumber.trim(),
                    accountingLoadedAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                }, { merge: true });
            }

            setMessage('Factura membretada guardada e integrada al reporte tributario.');
            setSupportFiles({});
            setForm({
                date: todayString(),
                invoiceNumber: '',
                customerName: '',
                customerAddress: '',
                customerRfc: '',
                subtotal: '',
                iva: '',
                total: '',
                retentionIr2: '',
                retentionMunicipal1: '',
                paymentMethod: '',
                sourceSicarInvoiceId: '',
                items: [],
            });
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
                    <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Fecha">
                            <input className={inputClass} type="date" value={form.date} onChange={(event) => update('date', event.target.value)} required />
                        </Field>
                        <Field label="Numero de factura">
                            <input className={inputClass} value={form.invoiceNumber} onChange={(event) => update('invoiceNumber', event.target.value)} required />
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
                            <PaymentMethodSelect value={form.paymentMethod} onChange={(value) => update('paymentMethod', value)} required />
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
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                                <div className="text-sm font-black text-slate-950">Detalle de articulos SICAR</div>
                                <div className="text-xs font-semibold text-slate-500">Se imprimen cantidad, producto, precio sin IVA y total sin IVA.</div>
                            </div>
                            <Badge tone={form.items?.length ? 'green' : 'slate'}>{form.items?.length || 0} lineas</Badge>
                        </div>
                        <InvoiceItemsTable items={form.items || []} />
                    </div>

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

            <div className="space-y-5">
                <Section title="Facturas SICAR para cargar" eyebrow="Pendientes por facturar" action={<Badge tone="blue">{sicarInvoices.length} pendientes</Badge>}>
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
                                No hay facturas SICAR pendientes por cargar.
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
            </div>
        </div>
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

function CashDifferences({ data }) {
    const differences = useMemo(() => (
        [...(data.diferencias_caja || [])]
            .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    ), [data.diferencias_caja]);

    const byCashier = useMemo(() => {
        const map = new Map();
        differences.forEach((item) => {
            const key = item.cashierCode || item.cashierName || 'SIN-CAJERO';
            const current = map.get(key) || { cashierName: item.cashierName || 'Sin cajero', amount: 0, count: 0 };
            current.amount = safeNumber(current.amount + safeNumber(item.amount));
            current.count += 1;
            map.set(key, current);
        });
        return [...map.values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    }, [differences]);

    return (
        <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
            <Section title="Saldo por cajero" eyebrow="Diferencias de caja" action={<Badge tone="red">{byCashier.length} cajeros</Badge>}>
                <div className="space-y-3">
                    {byCashier.length === 0 ? (
                        <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-center text-sm font-bold text-slate-400">
                            No hay diferencias pendientes.
                        </div>
                    ) : byCashier.map((item) => (
                        <div key={item.cashierName} className="rounded-2xl border border-slate-200 bg-white p-4">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-sm font-black text-slate-950">{item.cashierName}</div>
                                    <div className="text-xs font-bold text-slate-500">{item.count} cierre(s)</div>
                                </div>
                                <div className="font-mono text-lg font-black text-red-700">{fmt(item.amount)}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </Section>

            <Section title="Movimientos" eyebrow="Auditoria">
                <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                        <thead>
                            <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                                <th className="py-3 pr-4">Fecha</th>
                                <th className="py-3 pr-4">Cajero</th>
                                <th className="py-3 pr-4">Estado</th>
                                <th className="py-3 text-right">Monto</th>
                            </tr>
                        </thead>
                        <tbody>
                            {differences.map((item) => (
                                <tr key={item.id} className="border-b border-slate-100">
                                    <td className="py-3 pr-4 font-bold text-slate-700">{item.date || '-'}</td>
                                    <td className="py-3 pr-4 font-black text-slate-950">{item.cashierName || 'Sin cajero'}</td>
                                    <td className="py-3 pr-4"><Badge tone={item.status === 'pendiente' ? 'red' : 'green'}>{item.status || 'pendiente'}</Badge></td>
                                    <td className="py-3 text-right font-mono font-black text-red-700">{fmt(item.amount)}</td>
                                </tr>
                            ))}
                            {differences.length === 0 && (
                                <tr>
                                    <td className="py-10 text-center text-sm font-bold text-slate-400" colSpan="4">Sin movimientos.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Section>
        </div>
    );
}

function ComingSoon() {
    return (
        <Section title="Depositos bancarios" eyebrow="Proximamente" action={<Badge tone="amber">En diseno</Badge>}>
            <div className="rounded-[2rem] border border-dashed border-amber-300 bg-amber-50 p-10 text-center">
                <div className="text-4xl font-black text-amber-600">PROXIMAMENTE</div>
                <p className="mx-auto mt-3 max-w-xl text-sm font-semibold text-amber-800">
                    Este espacio quedo reservado para formalizar depositos bancarios y conciliarlos con cierres de caja.
                </p>
            </div>
        </Section>
    );
}

export default function Billing({ data = {} }) {
    const [activeTab, setActiveTab] = useState('cierre');

    const tabs = [
        { key: 'cierre', label: 'Cierre de caja' },
        { key: 'membretadas', label: 'Facturas membretadas' },
        { key: 'diferencias', label: 'Diferencias de caja' },
        { key: 'depositos', label: 'Depositos bancarios' },
    ];

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
                            <Badge tone="green">SICAR</Badge>
                            <Badge tone="blue">Caja</Badge>
                            <Badge tone="amber">Retenciones</Badge>
                        </div>
                    </div>
                </div>

                <div className="border-t border-slate-200 p-3">
                    <div className="flex flex-wrap gap-1.5">
                        {tabs.map((tab) => (
                            <button
                                key={tab.key}
                                type="button"
                                onClick={() => setActiveTab(tab.key)}
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

            {activeTab === 'cierre' && <CashClosure data={data} />}
            {activeTab === 'membretadas' && <StampedInvoices data={data} />}
            {activeTab === 'diferencias' && <CashDifferences data={data} />}
            {activeTab === 'depositos' && <ComingSoon />}
        </div>
    );
}
