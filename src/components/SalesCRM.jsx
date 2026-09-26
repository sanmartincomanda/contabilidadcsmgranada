import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import {
    ALL_BRANCH_IDS,
    CONSOLIDATED_BRANCH_ID,
    fmt,
    getBranchById,
    getRecordBranchId,
} from '../constants';
import {
    buildSalesCrmAnalytics,
    buildStampedInvoiceLinkIndex,
    getTicketPaymentTypes,
    getTicketStampedInvoiceInfo,
    isCancelledSicarTicket,
    isExcludedSicarTicket,
    mergeSicarTicketSources,
    normalizeCrmText,
} from '../services/salesCrmAnalytics';
import { isMasterEmail } from '../services/userAccess';
import ModalPortal from './ModalPortal';

const SICAR_SALES_START_DATE = '2026-01-01';
const PAGE_SIZE = 20;
const CUSTOMER_EXCLUSIONS_DOC = 'ventas_crm_exclusiones';
const MAX_CUSTOMER_EXCLUSIONS = 250;
const rangeCache = new Map();
const invoiceRangeCache = new Map();
const productCatalogCache = new Map();
let customerExclusionsCache = null;
const RANKING_LIMITS = [10, 20, 25, 100];
const SALES_CRM_TABS = [
    { id: 'general', label: 'General', caption: 'Tickets y comportamiento' },
    { id: 'departamentos', label: 'Departamentos', caption: 'Venta C$ y participacion' },
    { id: 'clientes', label: 'Clientes', caption: 'Valor y recurrencia' },
    { id: 'articulos', label: 'Articulos', caption: 'Top, NonTop y categorias' },
];

const SALES_DEPARTMENT_META = [
    { key: 'RES', label: 'RES', card: 'border-rose-200 bg-rose-50/80 text-rose-950', bar: 'bg-[#b4232f]', dot: 'bg-[#b4232f]' },
    { key: 'POLLO', label: 'POLLO', card: 'border-amber-200 bg-amber-50/80 text-amber-950', bar: 'bg-[#e4a11b]', dot: 'bg-[#e4a11b]' },
    { key: 'CERDO', label: 'CERDO', card: 'border-orange-200 bg-orange-50/80 text-orange-950', bar: 'bg-[#d76532]', dot: 'bg-[#d76532]' },
    { key: 'ABARROTERIA', label: 'ABARROTERIA', card: 'border-emerald-200 bg-emerald-50/80 text-emerald-950', bar: 'bg-[#198754]', dot: 'bg-[#198754]' },
];

const PAYMENT_META = {
    all: { label: 'Todos los metodos', short: 'Todos', color: 'bg-slate-700', text: 'text-slate-700' },
    cash: { label: 'Efectivo', short: 'Efectivo', color: 'bg-emerald-500', text: 'text-emerald-700' },
    card: { label: 'Tarjeta / POS', short: 'Tarjeta', color: 'bg-sky-500', text: 'text-sky-700' },
    transfer: { label: 'Transferencia', short: 'Transferencia', color: 'bg-amber-500', text: 'text-amber-700' },
    credit: { label: 'Credito', short: 'Credito', color: 'bg-rose-500', text: 'text-rose-700' },
    discount: { label: 'Descuento de la casa', short: 'Descuento', color: 'bg-orange-500', text: 'text-orange-700' },
    other: { label: 'Otro / Sin identificar', short: 'Otro', color: 'bg-slate-400', text: 'text-slate-600' },
};

const STATUS_OPTIONS = [
    { value: 'all', label: 'Todos los estados' },
    { value: 'active', label: 'Activos' },
    { value: 'linked', label: 'Con factura membretada' },
    { value: 'unlinked', label: 'Solo ticket' },
    { value: 'cancelled', label: 'Anulados' },
];

const localDateString = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const shiftDate = (dateString, days) => {
    const [year, month, day] = String(dateString).split('-').map(Number);
    const date = new Date(year, (month || 1) - 1, day || 1, 12);
    date.setDate(date.getDate() + days);
    return localDateString(date);
};

const monthStart = (dateString = localDateString()) => `${String(dateString).substring(0, 7)}-01`;
const clampPercent = (value) => Math.max(0, Math.min(Number(value || 0), 1));
const formatPercent = (value, digits = 1) => `${(clampPercent(value) * 100).toLocaleString('es-NI', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
const formatInteger = (value) => Number(value || 0).toLocaleString('es-NI');

const formatDate = (value = '') => {
    const [year, month, day] = String(value).substring(0, 10).split('-');
    return year && month && day ? `${day}/${month}/${year}` : value || '-';
};

const formatTime = (value = '') => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || '').substring(11, 16) || '-';
    return date.toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' });
};

const ticketCode = (ticket = {}) => ticket.ticketCode || `V-${ticket.saleId || ticket.ticketId || ''}`;

const getRangeLabel = (fromDate, toDate) => (
    fromDate === toDate ? formatDate(fromDate) : `${formatDate(fromDate)} al ${formatDate(toDate)}`
);

const isTicketInBranch = (ticket, selectedBranchId) => (
    selectedBranchId === CONSOLIDATED_BRANCH_ID || getRecordBranchId(ticket) === selectedBranchId
);

const getCustomerExclusionKey = (ticket = {}) => {
    const branchId = getRecordBranchId(ticket);
    const customerId = String(ticket.customerId ?? ticket.clientId ?? ticket.cli_id ?? '').trim();
    if (customerId) return `${branchId}:id:${customerId}`;
    const rfc = normalizeCrmText(ticket.customerRfc || ticket.rfc).replace(/[^A-Z0-9]/g, '');
    if (rfc) return `${branchId}:rfc:${rfc}`;
    return `${branchId}:name:${normalizeCrmText(ticket.customerName || ticket.cliente || 'SIN CLIENTE')}`;
};

const normalizeCustomerExclusions = (records = []) => {
    const unique = new Map();
    (Array.isArray(records) ? records : []).forEach((record) => {
        const key = String(record?.key || '').trim();
        if (!key || unique.has(key)) return;
        unique.set(key, {
            branchId: String(record.branchId || '').trim(),
            customerId: String(record.customerId || '').trim(),
            key,
            name: String(record.name || 'SIN CLIENTE').trim(),
            rfc: String(record.rfc || '').trim(),
        });
    });
    return [...unique.values()].slice(0, MAX_CUSTOMER_EXCLUSIONS);
};

const mergeTicketRecords = (archiveRecords = [], liveRecords = [], fromDate = '', toDate = '') => {
    const map = new Map();
    archiveRecords.forEach((ticket) => map.set(ticket.id || ticket.docId, ticket));
    liveRecords
        .filter((ticket) => String(ticket.date || ticket.saleDate || '').substring(0, 10) >= fromDate)
        .filter((ticket) => String(ticket.date || ticket.saleDate || '').substring(0, 10) <= toDate)
        .forEach((ticket) => {
            const key = ticket.id || ticket.docId;
            map.set(key, { ...(map.get(key) || {}), ...ticket });
        });
    return [...map.values()];
};

const buildSearchText = (ticket = {}) => normalizeCrmText([
    ticketCode(ticket),
    ticket.saleId,
    ticket.ticketNumber,
    ticket.customerName,
    ticket.customerRfc,
    ticket.customerAddress,
    ticket.cashboxName,
    ticket.crmInvoiceLink?.invoiceNumbers?.join(' '),
    ...(ticket.paymentBreakdown || []).map((payment) => payment.method),
    ...(ticket.items || []).map((item) => `${item.code || ''} ${item.description || ''}`),
].join(' '));

const downloadCsv = (tickets = [], rangeLabel = '') => {
    const headers = [
        'Fecha', 'Hora', 'Sucursal', 'Ticket SICAR', 'Venta ID', 'Cliente', 'RUC', 'Caja',
        'Metodos de pago', 'Factura membretada', 'Subtotal', 'IVA', 'Total', 'Costo', 'Utilidad', 'Articulos', 'Estado',
    ];
    const rows = tickets.map((ticket) => [
        ticket.date || ticket.saleDate || '',
        formatTime(ticket.saleDateTime),
        getBranchById(getRecordBranchId(ticket)).shortName,
        ticketCode(ticket),
        ticket.saleId || '',
        ticket.customerName || '',
        ticket.customerRfc || '',
        ticket.cashboxName || '',
        (ticket.paymentBreakdown || []).map((payment) => payment.method).join(' + '),
        ticket.crmInvoiceLink?.invoiceNumbers?.join(' / ') || '',
        Number(ticket.subtotal || 0).toFixed(2),
        Number(ticket.iva || 0).toFixed(2),
        Number(ticket.total || 0).toFixed(2),
        Number(ticket.purchaseTotal || 0).toFixed(2),
        Number(ticket.grossProfitTotal ?? (Number(ticket.total || 0) - Number(ticket.purchaseTotal || 0))).toFixed(2),
        ticket.itemCount || ticket.items?.length || 0,
        isCancelledSicarTicket(ticket) ? 'ANULADO' : 'ACTIVO',
    ]);
    const escapeCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const content = `\uFEFF${[headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n')}`;
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `ventas-sicar-${rangeLabel.replace(/[^0-9a-z-]+/gi, '-')}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
};

function useSicarTicketRange(fromDate, toDate, refreshToken, selectedBranchId, enabled = true) {
    const [state, setState] = useState({ loading: true, error: '', records: [], updatedAt: null });

    useEffect(() => {
        if (!enabled) {
            setState({ loading: false, error: '', records: [], updatedAt: new Date() });
            return undefined;
        }
        if (!fromDate || !toDate || fromDate > toDate) {
            setState({ loading: false, error: 'El rango de fechas no es valido.', records: [], updatedAt: null });
            return undefined;
        }

        const shouldLoadNindiriLegacy = selectedBranchId === 'nindiri'
            || selectedBranchId === CONSOLIDATED_BRANCH_ID;
        const cacheKey = `${selectedBranchId}:${fromDate}:${toDate}`;
        const cached = rangeCache.get(cacheKey);
        if (cached && refreshToken === 0) {
            setState({ loading: false, error: '', records: cached.records, updatedAt: cached.updatedAt });
            return undefined;
        }

        let mounted = true;
        setState((current) => ({ ...current, loading: true, error: '' }));
        const buildRangeQuery = (collectionName) => getDocs(query(
            collection(db, collectionName),
            where('date', '>=', fromDate),
            where('date', '<', shiftDate(toDate, 1))
        ));
        Promise.all([
            buildRangeQuery('sicar_ventas_tickets'),
            shouldLoadNindiriLegacy ? buildRangeQuery('sicar_facturas_membretadas') : Promise.resolve(null),
        ])
            .then(([ticketSnapshot, legacySnapshot]) => {
                if (!mounted) return;
                const result = {
                    records: mergeSicarTicketSources(
                        ticketSnapshot.docs.map((ticketDoc) => ({ id: ticketDoc.id, ...ticketDoc.data() })),
                        legacySnapshot?.docs.map((ticketDoc) => ({ id: ticketDoc.id, ...ticketDoc.data() })) || []
                    ),
                    updatedAt: new Date(),
                };
                rangeCache.set(cacheKey, result);
                setState({ loading: false, error: '', ...result });
            })
            .catch((error) => {
                console.error('No se pudo cargar el historial de ventas SICAR', error);
                if (mounted) setState((current) => ({ ...current, loading: false, error: error.message || 'No se pudieron cargar las ventas.' }));
            });

        return () => { mounted = false; };
    }, [enabled, fromDate, refreshToken, selectedBranchId, toDate]);

    return state;
}

function useStampedInvoiceRange(fromDate, toDate, refreshToken) {
    const [state, setState] = useState({ loading: true, error: '', records: [] });

    useEffect(() => {
        if (!fromDate || !toDate || fromDate > toDate) {
            setState({ loading: false, error: 'El rango de fechas no es valido.', records: [] });
            return undefined;
        }

        const cacheKey = `${fromDate}:${toDate}`;
        const cached = invoiceRangeCache.get(cacheKey);
        if (cached && refreshToken === 0) {
            setState({ loading: false, error: '', records: cached });
            return undefined;
        }

        let mounted = true;
        setState((current) => ({ ...current, loading: true, error: '' }));
        getDocs(query(
            collection(db, 'facturas_membretadas_ventas'),
            where('saleDate', '>=', fromDate),
            where('saleDate', '<', shiftDate(toDate, 1))
        ))
            .then((snapshot) => {
                if (!mounted) return;
                const records = snapshot.docs.map((invoiceDoc) => ({ id: invoiceDoc.id, ...invoiceDoc.data() }));
                invoiceRangeCache.set(cacheKey, records);
                setState({ loading: false, error: '', records });
            })
            .catch((error) => {
                console.error('No se pudieron cargar los vinculos de facturas del CRM', error);
                if (mounted) setState({ loading: false, error: error.message || 'No se pudieron cargar los vinculos.', records: [] });
            });

        return () => { mounted = false; };
    }, [fromDate, refreshToken, toDate]);

    return state;
}

function useSicarProductCatalog(selectedBranchId, refreshToken, enabled = true) {
    const branchIds = selectedBranchId === CONSOLIDATED_BRANCH_ID ? ALL_BRANCH_IDS : [selectedBranchId];
    const cacheKey = [...branchIds].sort().join(':');
    const [state, setState] = useState({ articles: {}, categories: [], error: '', loading: enabled });

    useEffect(() => {
        if (!enabled) {
            setState({ articles: {}, categories: [], error: '', loading: false });
            return undefined;
        }
        const cached = productCatalogCache.get(cacheKey);
        if (cached && refreshToken === 0) {
            setState({ ...cached, error: '', loading: false });
            return undefined;
        }

        let mounted = true;
        setState((current) => ({ ...current, error: '', loading: true }));
        Promise.all(branchIds.map((branchId) => getDoc(doc(db, 'sicar_catalogos_articulos', branchId))))
            .then((snapshots) => {
                if (!mounted) return;
                const articles = {};
                const categoryMap = new Map();
                snapshots.forEach((snapshot, index) => {
                    if (!snapshot.exists()) return;
                    const payload = snapshot.data() || {};
                    const branchId = payload.branchId || branchIds[index];
                    Object.entries(payload.articles || {}).forEach(([articleId, article]) => {
                        articles[`${branchId}:${articleId}`] = article;
                        if (branchIds.length === 1) articles[articleId] = article;
                    });
                    (payload.categories || []).forEach((category) => {
                        const key = category.categoryKey || `${branchId}:${category.categoryId || 'uncategorized'}`;
                        categoryMap.set(key, { ...category, branchId, categoryKey: key });
                    });
                });
                const result = {
                    articles,
                    categories: [...categoryMap.values()].sort((a, b) => (
                        String(a.departmentName || '').localeCompare(String(b.departmentName || ''), 'es')
                        || String(a.categoryName || '').localeCompare(String(b.categoryName || ''), 'es')
                    )),
                };
                productCatalogCache.set(cacheKey, result);
                setState({ ...result, error: '', loading: false });
            })
            .catch((error) => {
                console.error('No se pudo cargar el catalogo de articulos SICAR', error);
                if (mounted) setState((current) => ({ ...current, error: error.message || 'No se pudo cargar el catalogo.', loading: false }));
            });

        return () => { mounted = false; };
    }, [cacheKey, enabled, refreshToken]);

    return state;
}

function useSalesCrmCustomerExclusions(userEmail = '') {
    const [state, setState] = useState({
        customers: customerExclusionsCache || [],
        error: '',
        loading: customerExclusionsCache === null,
        saving: false,
    });

    useEffect(() => {
        if (customerExclusionsCache !== null) return undefined;
        let mounted = true;
        getDoc(doc(db, 'configuracion', CUSTOMER_EXCLUSIONS_DOC))
            .then((snapshot) => {
                if (!mounted) return;
                const customers = normalizeCustomerExclusions(snapshot.exists() ? snapshot.data()?.customers : []);
                customerExclusionsCache = customers;
                setState({ customers, error: '', loading: false, saving: false });
            })
            .catch((error) => {
                console.error('No se pudo cargar la lista de clientes excluidos', error);
                if (mounted) setState((current) => ({ ...current, error: error.message || 'No se pudo cargar la lista.', loading: false }));
            });
        return () => { mounted = false; };
    }, []);

    const save = async (records) => {
        const customers = normalizeCustomerExclusions(records);
        setState((current) => ({ ...current, error: '', saving: true }));
        try {
            await setDoc(doc(db, 'configuracion', CUSTOMER_EXCLUSIONS_DOC), {
                customers,
                updatedAt: serverTimestamp(),
                updatedBy: String(userEmail || '').trim().toLowerCase(),
            }, { merge: true });
            customerExclusionsCache = customers;
            setState({ customers, error: '', loading: false, saving: false });
            return true;
        } catch (error) {
            console.error('No se pudo guardar la lista de clientes excluidos', error);
            setState((current) => ({ ...current, error: error.message || 'No se pudo guardar la lista.', saving: false }));
            return false;
        }
    };

    return { ...state, save };
}

function KpiCard({ eyebrow, value, caption, tone = 'slate', progress = null }) {
    const tones = {
        slate: 'border-slate-200 bg-white text-slate-950',
        green: 'border-emerald-200 bg-emerald-50/70 text-emerald-950',
        blue: 'border-sky-200 bg-sky-50/70 text-sky-950',
        amber: 'border-amber-200 bg-amber-50/70 text-amber-950',
        red: 'border-rose-200 bg-rose-50/70 text-rose-950',
    };

    return (
        <div className={`relative overflow-hidden rounded-[1.6rem] border p-4 shadow-sm ${tones[tone] || tones.slate}`}>
            <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full border-[18px] border-current opacity-[0.035]" />
            <div className="relative">
                <div className="text-[9px] font-black uppercase tracking-[0.24em] opacity-55">{eyebrow}</div>
                <div className="mt-2 font-mono text-2xl font-black tracking-tight">{value}</div>
                <div className="mt-2 text-[11px] font-bold leading-relaxed opacity-65">{caption}</div>
                {progress !== null && (
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-current/10">
                        <div className="h-full rounded-full bg-current transition-all duration-700" style={{ width: `${clampPercent(progress) * 100}%` }} />
                    </div>
                )}
            </div>
        </div>
    );
}

function ConversionRing({ value }) {
    const percent = clampPercent(value);
    const radius = 42;
    const circumference = 2 * Math.PI * radius;
    return (
        <div className="relative grid h-28 w-28 shrink-0 place-items-center">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
                <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="8" />
                <circle
                    cx="50"
                    cy="50"
                    r={radius}
                    fill="none"
                    stroke="#34d399"
                    strokeLinecap="round"
                    strokeWidth="8"
                    strokeDasharray={`${circumference * percent} ${circumference}`}
                    className="transition-all duration-700"
                />
            </svg>
            <span className="absolute font-mono text-xl font-black text-white">{formatPercent(percent, 0)}</span>
        </div>
    );
}

const buildSalesChartPeriods = (daily = [], fromDate = '', toDate = '') => {
    const rangeDays = Math.max(0, Math.round((new Date(`${toDate}T12:00:00`) - new Date(`${fromDate}T12:00:00`)) / 86400000));
    if (rangeDays <= 45) {
        return daily.map((item) => ({
            ...item,
            axisLabel: String(item.date).substring(8, 10),
            titleLabel: formatDate(item.date),
        }));
    }

    const months = new Map();
    daily.forEach((item) => {
        const key = String(item.date).substring(0, 7);
        const current = months.get(key) || { date: key, linked: 0, sales: 0, tickets: 0 };
        current.linked += Number(item.linked || 0);
        current.sales += Number(item.sales || 0);
        current.tickets += Number(item.tickets || 0);
        months.set(key, current);
    });
    return [...months.values()].map((item) => {
        const [year, month] = item.date.split('-').map(Number);
        return {
            ...item,
            axisLabel: new Date(year, month - 1, 1).toLocaleDateString('es-NI', { month: 'short' }).replace('.', ''),
            titleLabel: new Date(year, month - 1, 1).toLocaleDateString('es-NI', { month: 'long', year: 'numeric' }),
        };
    });
};

function DailySalesChart({ daily = [], fromDate = '', toDate = '' }) {
    const periods = useMemo(() => buildSalesChartPeriods(daily, fromDate, toDate), [daily, fromDate, toDate]);
    const maxSales = Math.max(1, ...periods.map((item) => item.sales));
    if (!periods.length) return <EmptyState text="No hay ventas activas para graficar." />;

    return (
        <div className="overflow-x-auto pb-1">
            <div className="flex h-56 min-w-[680px] items-end gap-2 border-b border-slate-200 px-1 pt-6">
                {periods.map((item) => {
                    const height = Math.max(5, (item.sales / maxSales) * 100);
                    const conversion = item.tickets ? item.linked / item.tickets : 0;
                    return (
                        <button
                            key={item.date}
                            type="button"
                            title={`${item.titleLabel}: ${fmt(item.sales)} · ${item.tickets} tickets · ${formatPercent(conversion)} a membretada`}
                            className="group flex h-full min-w-[34px] flex-1 flex-col justify-end"
                        >
                            <div className="mb-2 hidden text-center font-mono text-[9px] font-black text-slate-500 group-hover:block">{fmt(item.sales)}</div>
                            <div
                                className="relative w-full overflow-hidden rounded-t-xl bg-gradient-to-t from-[#9f111a] via-[#e30613] to-[#ff765f] shadow-sm transition-all duration-500 group-hover:brightness-110"
                                style={{ height: `${height}%` }}
                            >
                                <div className="absolute inset-x-0 bottom-0 bg-emerald-400/85" style={{ height: `${conversion * 100}%` }} />
                            </div>
                            <div className="mt-2 text-center text-[9px] font-black uppercase text-slate-400">{item.axisLabel}</div>
                        </button>
                    );
                })}
            </div>
            <div className="mt-3 flex items-center gap-4 text-[10px] font-bold text-slate-500">
                <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#e30613]" />Venta SICAR</span>
                <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-emerald-400" />Parte vinculada a membretada</span>
            </div>
        </div>
    );
}

function PaymentMix({ rows = [], total = 0 }) {
    if (!rows.length) return <EmptyState text="No hay metodos de pago en este rango." />;
    return (
        <div className="space-y-4">
            {rows.map((row) => {
                const meta = PAYMENT_META[row.type] || PAYMENT_META.other;
                const ratio = total ? row.total / total : 0;
                return (
                    <div key={row.type}>
                        <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                            <span className="font-black text-slate-700">{meta.label}</span>
                            <span className={`font-mono font-black ${meta.text}`}>{fmt(row.total)} <small className="ml-1 text-[9px] text-slate-400">{formatPercent(ratio)}</small></span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                            <div className={`h-full rounded-full ${meta.color} transition-all duration-700`} style={{ width: `${clampPercent(ratio) * 100}%` }} />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function DepartmentSalesPanel({ rows = [], total = 0, rangeLabel = '' }) {
    const salesByDepartment = new Map(rows.map((row) => [normalizeCrmText(row.departmentName), Number(row.sales || 0)]));
    const primaryKeys = new Set(SALES_DEPARTMENT_META.map((department) => department.key));
    const primaryRows = SALES_DEPARTMENT_META.map((department) => {
        const sales = salesByDepartment.get(department.key) || 0;
        return { ...department, percentage: total ? sales / total : 0, sales };
    });
    const otherRows = rows.filter((row) => !primaryKeys.has(normalizeCrmText(row.departmentName)));
    const otherSales = otherRows.reduce((sum, row) => sum + Number(row.sales || 0), 0);
    const otherPercentage = total ? otherSales / total : 0;
    const primarySales = primaryRows.reduce((sum, row) => sum + row.sales, 0);

    if (!total) return <EmptyState text="No hay venta de articulos clasificada para este rango." />;

    return (
        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.12),transparent_36%),linear-gradient(135deg,#fff_0%,#f8fafc_100%)] p-5 sm:p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <div className="text-[9px] font-black uppercase tracking-[0.26em] text-[#e30613]">Mezcla comercial</div>
                        <h3 className="mt-1 text-2xl font-black text-slate-950">Venta por departamentos</h3>
                        <p className="mt-2 text-sm font-semibold text-slate-500">Monto vendido y participacion porcentual de los articulos SICAR activos.</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white/90 px-5 py-3 text-right shadow-sm">
                        <div className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Venta analizada · {rangeLabel}</div>
                        <div className="mt-1 font-mono text-2xl font-black text-slate-950">{fmt(total)}</div>
                    </div>
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {primaryRows.map((department) => (
                        <article key={department.key} className={`relative overflow-hidden rounded-[1.5rem] border p-4 ${department.card}`}>
                            <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full border-[14px] border-current opacity-[0.05]" />
                            <div className="relative flex items-start justify-between gap-3">
                                <div>
                                    <div className="text-[9px] font-black uppercase tracking-[0.24em] opacity-60">Departamento</div>
                                    <div className="mt-1 text-lg font-black tracking-tight">{department.label}</div>
                                </div>
                                <span className="rounded-full bg-white/80 px-2.5 py-1 font-mono text-xs font-black shadow-sm">{formatPercent(department.percentage)}</span>
                            </div>
                            <div className="relative mt-5 font-mono text-2xl font-black">{fmt(department.sales)}</div>
                            <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-white/80">
                                <div className={`h-full rounded-full ${department.bar}`} style={{ width: `${clampPercent(department.percentage) * 100}%` }} />
                            </div>
                        </article>
                    ))}
                </div>

                <div className="mt-5 overflow-hidden rounded-full bg-slate-200" title="Distribucion porcentual de la venta">
                    <div className="flex h-3 w-full">
                        {primaryRows.map((department) => (
                            <div key={department.key} className={`${department.bar} transition-all duration-700`} style={{ width: `${clampPercent(department.percentage) * 100}%` }} />
                        ))}
                        <div className="bg-slate-500 transition-all duration-700" style={{ width: `${clampPercent(otherPercentage) * 100}%` }} />
                    </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-[9px] font-black uppercase tracking-wider text-slate-500">
                    {primaryRows.map((department) => <span key={department.key} className="flex items-center gap-1.5"><i className={`h-2 w-2 rounded-full ${department.dot}`} />{department.label}</span>)}
                    <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-slate-500" />Otros</span>
                </div>
            </div>

            <div className="grid gap-6 p-5 sm:p-6 xl:grid-cols-[1.45fr_0.75fr]">
                <div>
                    <div className="mb-3 text-[9px] font-black uppercase tracking-[0.22em] text-slate-400">Comparativo principal</div>
                    <div className="space-y-4">
                        {primaryRows.map((department) => (
                            <div key={department.key}>
                                <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                                    <span className="flex items-center gap-2 font-black text-slate-700"><i className={`h-2.5 w-2.5 rounded-full ${department.dot}`} />{department.label}</span>
                                    <span className="font-mono font-black text-slate-900">{fmt(department.sales)} <small className="ml-1 text-[9px] text-slate-400">{formatPercent(department.percentage)}</small></span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${department.bar}`} style={{ width: `${clampPercent(department.percentage) * 100}%` }} /></div>
                            </div>
                        ))}
                    </div>
                </div>

                <aside className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-[9px] font-black uppercase tracking-[0.22em] text-slate-400">Control del 100%</div>
                    <div className="mt-3 flex items-end justify-between gap-3 border-b border-slate-200 pb-3">
                        <div><div className="text-xs font-black text-slate-700">Cuatro departamentos</div><div className="mt-1 text-[10px] font-bold text-slate-400">RES + POLLO + CERDO + ABARROTERIA</div></div>
                        <div className="text-right"><div className="font-mono text-sm font-black text-slate-950">{fmt(primarySales)}</div><div className="text-[10px] font-black text-emerald-700">{formatPercent(total ? primarySales / total : 0)}</div></div>
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-3">
                        <div><div className="text-xs font-black text-slate-700">Otros departamentos SICAR</div><div className="mt-1 text-[10px] font-bold text-slate-400">Se muestran para completar la venta</div></div>
                        <div className="text-right"><div className="font-mono text-sm font-black text-slate-950">{fmt(otherSales)}</div><div className="text-[10px] font-black text-slate-600">{formatPercent(otherPercentage)}</div></div>
                    </div>
                    <div className="mt-4 space-y-2 border-t border-slate-200 pt-3">
                        {otherRows.map((department) => (
                            <div key={department.departmentName} className="flex items-center justify-between gap-3 text-[10px]">
                                <span className="font-bold text-slate-500">{department.departmentName}</span>
                                <span className="font-mono font-black text-slate-700">{fmt(department.sales)} · {formatPercent(department.percentage)}</span>
                            </div>
                        ))}
                        {!otherRows.length && <div className="text-[10px] font-bold text-slate-400">Toda la venta pertenece a los cuatro departamentos principales.</div>}
                    </div>
                </aside>
            </div>
        </section>
    );
}

function EmptyState({ text }) {
    return <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-400">{text}</div>;
}

const segmentClass = (segment) => ({
    VIP: 'bg-amber-100 text-amber-800',
    Frecuente: 'bg-emerald-100 text-emerald-800',
    Recurrente: 'bg-sky-100 text-sky-800',
    Nuevo: 'bg-slate-100 text-slate-700',
    'Publico general': 'bg-rose-100 text-rose-700',
}[segment] || 'bg-slate-100 text-slate-700');

function CustomerTable({ customers, totalSales, onOpen }) {
    if (!customers.length) return <EmptyState text="No hay clientes para los filtros seleccionados." />;
    return (
        <div className="overflow-x-auto rounded-3xl border border-slate-200">
            <table className="min-w-[920px] w-full text-left text-sm">
                <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">
                        <th className="px-4 py-3">Cliente</th>
                        <th className="px-4 py-3">Segmento</th>
                        <th className="px-4 py-3 text-right">Tickets</th>
                        <th className="px-4 py-3 text-right">Dias activos</th>
                        <th className="px-4 py-3 text-right">Venta</th>
                        <th className="px-4 py-3 text-right">Ticket prom.</th>
                        <th className="px-4 py-3 text-right">A membretada</th>
                        <th className="px-4 py-3">Ultima compra</th>
                    </tr>
                </thead>
                <tbody>
                    {customers.map((customer, index) => (
                        <tr
                            key={customer.key}
                            onDoubleClick={() => onOpen(customer.key)}
                            className="cursor-pointer border-b border-slate-100 transition last:border-b-0 hover:bg-sky-50/60"
                        >
                            <td className="px-4 py-3">
                                <button type="button" onClick={() => onOpen(customer.key)} className="text-left">
                                    <div className="font-black text-slate-900"><span className="mr-2 font-mono text-[10px] text-slate-400">#{index + 1}</span>{customer.name}</div>
                                    <div className="mt-0.5 text-[10px] font-bold text-slate-400">{customer.rfc || 'Sin RUC'} · {formatPercent(totalSales ? customer.sales / totalSales : 0)} de la venta</div>
                                </button>
                            </td>
                            <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${segmentClass(customer.segment)}`}>{customer.segment}</span></td>
                            <td className="px-4 py-3 text-right font-mono font-black text-slate-700">{customer.ticketCount}</td>
                            <td className="px-4 py-3 text-right font-mono font-black text-sky-700">{customer.activeDays}</td>
                            <td className="px-4 py-3 text-right font-mono font-black text-emerald-700">{fmt(customer.sales)}</td>
                            <td className="px-4 py-3 text-right font-mono font-bold text-slate-600">{fmt(customer.averageTicket)}</td>
                            <td className="px-4 py-3 text-right font-mono font-black text-sky-700">{formatPercent(customer.conversion)}</td>
                            <td className="px-4 py-3 font-bold text-slate-600">{formatDate(customer.lastPurchase)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 text-[10px] font-bold text-slate-500">Clic o doble clic sobre un cliente para abrir su perfil CRM.</div>
        </div>
    );
}

function GeneratePrompt({ title, text }) {
    return (
        <div className="rounded-[2rem] border border-dashed border-slate-300 bg-gradient-to-br from-slate-50 to-white px-6 py-14 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-950 text-xl font-black text-white shadow-lg">↗</div>
            <h4 className="mt-4 text-lg font-black text-slate-900">{title}</h4>
            <p className="mx-auto mt-2 max-w-lg text-sm font-semibold leading-relaxed text-slate-500">{text}</p>
        </div>
    );
}

function ProductTable({ products = [], totalSales = 0, mode = 'top' }) {
    if (!products.length) return <EmptyState text="No hay articulos vendidos para esta seleccion." />;
    return (
        <div className="overflow-x-auto rounded-3xl border border-slate-200">
            <table className="min-w-[940px] w-full text-left text-sm">
                <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">
                        <th className="px-4 py-3">Posicion</th>
                        <th className="px-4 py-3">Articulo</th>
                        <th className="px-4 py-3">Categoria SICAR</th>
                        <th className="px-4 py-3 text-right">Tickets</th>
                        <th className="px-4 py-3 text-right">Cantidad</th>
                        <th className="px-4 py-3 text-right">Prom. ticket</th>
                        <th className="px-4 py-3 text-right">Venta</th>
                    </tr>
                </thead>
                <tbody>
                    {products.map((product, index) => (
                        <tr key={`${product.branchId}-${product.code}-${product.description}`} className="border-b border-slate-100 last:border-b-0 hover:bg-sky-50/50">
                            <td className="px-4 py-3"><span className={`grid h-8 w-8 place-items-center rounded-xl font-mono text-xs font-black ${mode === 'top' ? 'bg-slate-950 text-white' : 'bg-amber-100 text-amber-800'}`}>{index + 1}</span></td>
                            <td className="px-4 py-3"><div className="font-black text-slate-900">{product.description}</div><div className="mt-0.5 text-[10px] font-bold text-slate-400">{product.code || 'Sin codigo'} · {product.branchId || 'SICAR'}</div></td>
                            <td className="px-4 py-3"><div className="font-black text-slate-700">{product.categoryName}</div><div className="mt-0.5 text-[10px] font-bold text-slate-400">{product.departmentName}</div></td>
                            <td className="px-4 py-3 text-right font-mono font-black text-slate-700">{formatInteger(product.ticketCount)}</td>
                            <td className="px-4 py-3 text-right font-mono font-black text-sky-700">{Number(product.quantity || 0).toLocaleString('es-NI', { maximumFractionDigits: 2 })}</td>
                            <td className="px-4 py-3 text-right font-mono font-bold text-slate-600">{fmt(product.averagePerTicket)}</td>
                            <td className="px-4 py-3 text-right"><div className="font-mono font-black text-emerald-700">{fmt(product.sales)}</div><div className="mt-0.5 text-[9px] font-bold text-slate-400">{formatPercent(totalSales ? product.sales / totalSales : 0)}</div></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function TicketTable({ tickets, page, onPageChange, onOpen }) {
    const totalPages = Math.max(1, Math.ceil(tickets.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const pageRows = tickets.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
    if (!tickets.length) return <EmptyState text="No hay tickets que coincidan con los filtros." />;

    return (
        <>
            <div className="overflow-x-auto rounded-3xl border border-slate-200">
                <table className="min-w-[980px] w-full text-left text-sm">
                    <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">
                            <th className="px-4 py-3">Fecha / Ticket</th>
                            <th className="px-4 py-3">Cliente</th>
                            <th className="px-4 py-3">Caja</th>
                            <th className="px-4 py-3">Pago</th>
                            <th className="px-4 py-3">Membretada</th>
                            <th className="px-4 py-3 text-right">Art.</th>
                            <th className="px-4 py-3 text-right">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {pageRows.map((ticket) => {
                            const cancelled = isCancelledSicarTicket(ticket);
                            const paymentLabels = getTicketPaymentTypes(ticket).map((type) => PAYMENT_META[type]?.short || type);
                            return (
                                <tr key={ticket.id} onDoubleClick={() => onOpen(ticket)} className="cursor-pointer border-b border-slate-100 transition last:border-b-0 hover:bg-sky-50/60">
                                    <td className="px-4 py-3">
                                        <button type="button" className="text-left" onClick={() => onOpen(ticket)}>
                                            <div className={`font-mono font-black ${cancelled ? 'text-rose-600 line-through' : 'text-slate-950'}`}>{ticketCode(ticket)}</div>
                                            <div className="mt-0.5 text-[10px] font-bold text-slate-400">{formatDate(ticket.date)} · {formatTime(ticket.saleDateTime)}</div>
                                        </button>
                                    </td>
                                    <td className="px-4 py-3"><div className="max-w-[230px] truncate font-black text-slate-800">{ticket.customerName || 'PUBLICO EN GENERAL'}</div><div className="text-[10px] font-bold text-slate-400">{ticket.customerRfc || 'Sin RUC'}</div></td>
                                    <td className="px-4 py-3 font-bold text-slate-600">{ticket.cashboxName || 'Sin caja'}</td>
                                    <td className="px-4 py-3 text-xs font-black text-slate-600">{paymentLabels.join(' + ') || 'Sin metodo'}</td>
                                    <td className="px-4 py-3">
                                        {ticket.crmInvoiceLink?.linked
                                            ? <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-emerald-800">{ticket.crmInvoiceLink.invoiceNumbers.join(' / ') || 'Vinculada'}</span>
                                            : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-slate-500">Solo ticket</span>}
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-600">{ticket.itemCount || ticket.items?.length || 0}</td>
                                    <td className={`px-4 py-3 text-right font-mono font-black ${cancelled ? 'text-rose-600 line-through' : 'text-emerald-700'}`}>{fmt(ticket.total)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs font-bold text-slate-500">Mostrando {((safePage - 1) * PAGE_SIZE) + 1}-{Math.min(safePage * PAGE_SIZE, tickets.length)} de {tickets.length}</div>
                <div className="flex gap-2">
                    <button type="button" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 disabled:opacity-40">Anterior</button>
                    <span className="grid min-w-20 place-items-center rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white">{safePage} / {totalPages}</span>
                    <button type="button" disabled={safePage >= totalPages} onClick={() => onPageChange(safePage + 1)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 disabled:opacity-40">Siguiente</button>
                </div>
            </div>
        </>
    );
}

function ModalShell({ eyebrow, title, subtitle, onClose, children }) {
    return (
        <ModalPortal onClose={onClose}>
        <div className="app-modal-root fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-2 backdrop-blur-sm sm:p-5" onMouseDown={onClose}>
            <div className="app-modal-panel max-h-[96dvh] w-full max-w-6xl overflow-y-auto rounded-[2rem] bg-[#f8fafc] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
                <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/10 bg-slate-950 px-5 py-4 text-white">
                    <div>
                        <div className="text-[9px] font-black uppercase tracking-[0.28em] text-emerald-300">{eyebrow}</div>
                        <h3 className="mt-1 text-xl font-black sm:text-2xl">{title}</h3>
                        {subtitle && <div className="mt-1 text-xs font-semibold text-white/60">{subtitle}</div>}
                    </div>
                    <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/15 bg-white/10 text-xl font-black hover:bg-white/20" aria-label="Cerrar">×</button>
                </header>
                <div className="p-4 sm:p-6">{children}</div>
            </div>
        </div>
        </ModalPortal>
    );
}

function CustomerExclusionModal({ customers = [], excludedCustomers = [], readOnly = false, saving = false, onClose, onSave }) {
    const [search, setSearch] = useState('');
    const [draftKeys, setDraftKeys] = useState(() => new Set(excludedCustomers.map((customer) => customer.key)));
    const allCustomers = useMemo(() => {
        const customerMap = new Map(excludedCustomers.map((customer) => [customer.key, customer]));
        customers.forEach((customer) => customerMap.set(customer.key, { ...(customerMap.get(customer.key) || {}), ...customer }));
        return [...customerMap.values()].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
    }, [customers, excludedCustomers]);
    const normalizedSearch = normalizeCrmText(search);
    const visibleCustomers = useMemo(() => allCustomers.filter((customer) => (
        (!readOnly || draftKeys.has(customer.key))
        && (!normalizedSearch || normalizeCrmText([
            customer.name,
            customer.rfc,
            customer.customerId,
            getBranchById(customer.branchId).shortName,
        ].join(' ')).includes(normalizedSearch))
    )), [allCustomers, draftKeys, normalizedSearch, readOnly]);

    const toggleCustomer = (key) => {
        if (readOnly) return;
        setDraftKeys((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else if (next.size < MAX_CUSTOMER_EXCLUSIONS) next.add(key);
            return next;
        });
    };

    const updateVisible = (selected) => {
        if (readOnly) return;
        setDraftKeys((current) => {
            const next = new Set(current);
            visibleCustomers.forEach((customer) => {
                if (selected && next.size < MAX_CUSTOMER_EXCLUSIONS) next.add(customer.key);
                if (!selected) next.delete(customer.key);
            });
            return next;
        });
    };

    const saveList = async () => {
        const selected = allCustomers
            .filter((customer) => draftKeys.has(customer.key))
            .map((customer) => ({
                branchId: customer.branchId,
                customerId: customer.customerId,
                key: customer.key,
                name: customer.name,
                rfc: customer.rfc,
            }));
        const saved = await onSave(selected);
        if (saved) onClose();
    };

    return (
        <ModalShell
            eyebrow="Configuracion del CRM"
            title="Clientes excluidos del analisis"
            subtitle="Estos clientes no se incluiran en ventas, KPIs, rankings, articulos ni exportaciones."
            onClose={onClose}
        >
            <div className="space-y-4">
                <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
                    <input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Buscar cliente por nombre, RUC, codigo o sucursal..."
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                        autoFocus
                    />
                    <div className="flex flex-wrap gap-2">
                        {!readOnly && <button type="button" onClick={() => updateVisible(true)} className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-sky-800">Excluir visibles</button>}
                        {!readOnly && <button type="button" onClick={() => updateVisible(false)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-[10px] font-black uppercase tracking-wider text-slate-600">Quitar visibles</button>}
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900">
                    <span>{draftKeys.size} clientes seleccionados</span>
                    <span className="text-amber-700/70">Maximo {MAX_CUSTOMER_EXCLUSIONS}</span>
                    {readOnly && <span className="ml-auto rounded-full bg-white px-3 py-1 text-[9px] font-black uppercase tracking-wider text-slate-600">Solo lectura</span>}
                </div>

                <div className="max-h-[55vh] overflow-y-auto rounded-3xl border border-slate-200 bg-white">
                    {visibleCustomers.map((customer) => {
                        const selected = draftKeys.has(customer.key);
                        return (
                            <button
                                key={customer.key}
                                type="button"
                                onClick={() => toggleCustomer(customer.key)}
                                disabled={readOnly}
                                className={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-slate-100 px-4 py-3 text-left transition last:border-b-0 ${selected ? 'bg-rose-50' : 'hover:bg-slate-50'} disabled:cursor-default`}
                            >
                                <span className={`grid h-6 w-6 place-items-center rounded-lg border text-xs font-black ${selected ? 'border-[#e30613] bg-[#e30613] text-white' : 'border-slate-300 bg-white text-transparent'}`}>✓</span>
                                <span className="min-w-0">
                                    <span className="block truncate text-sm font-black text-slate-900">{customer.name || 'SIN CLIENTE'}</span>
                                    <span className="mt-0.5 block text-[10px] font-bold text-slate-400">{customer.rfc || 'Sin RUC'} · {getBranchById(customer.branchId).shortName}</span>
                                </span>
                                <span className="text-right">
                                    <span className="block font-mono text-xs font-black text-emerald-700">{fmt(customer.sales)}</span>
                                    <span className="mt-0.5 block text-[9px] font-bold text-slate-400">{customer.ticketCount || 0} tickets</span>
                                </span>
                            </button>
                        );
                    })}
                    {!visibleCustomers.length && <div className="px-4 py-12 text-center text-sm font-bold text-slate-400">No hay clientes que coincidan con la busqueda.</div>}
                </div>

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-[10px] font-black uppercase tracking-wider text-slate-600">{readOnly ? 'Cerrar' : 'Cancelar'}</button>
                    {!readOnly && <button type="button" onClick={saveList} disabled={saving} className="rounded-xl bg-[#e30613] px-6 py-3 text-[10px] font-black uppercase tracking-wider text-white shadow-lg transition hover:bg-[#b8050f] disabled:opacity-50">{saving ? 'Guardando...' : 'Aplicar lista'}</button>}
                </div>
            </div>
        </ModalShell>
    );
}

function TicketDetailModal({ ticket, onClose }) {
    if (!ticket) return null;
    const cancelled = isCancelledSicarTicket(ticket);
    const profit = Number(ticket.grossProfitTotal ?? (Number(ticket.total || 0) - Number(ticket.purchaseTotal || 0)));
    return (
        <ModalShell eyebrow="Detalle de venta SICAR" title={ticketCode(ticket)} subtitle={`${formatDate(ticket.date)} · ${formatTime(ticket.saleDateTime)} · ${getBranchById(getRecordBranchId(ticket)).shortName}`} onClose={onClose}>
            <div className="grid gap-4 lg:grid-cols-[1fr_0.42fr]">
                <div className="space-y-4">
                    <div className="rounded-3xl border border-slate-200 bg-white p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div><div className="text-lg font-black text-slate-950">{ticket.customerName || 'PUBLICO EN GENERAL'}</div><div className="mt-1 text-xs font-bold text-slate-500">RUC {ticket.customerRfc || '-'} · {ticket.customerAddress || 'Direccion no registrada'}</div></div>
                            <span className={`rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-wider ${cancelled ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>{cancelled ? 'Anulado' : 'Activo'}</span>
                        </div>
                    </div>
                    <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white">
                        <table className="min-w-[760px] w-full text-left text-sm">
                            <thead><tr className="border-b border-slate-200 bg-slate-50 text-[9px] font-black uppercase tracking-[0.16em] text-slate-400"><th className="px-4 py-3">Codigo</th><th className="px-4 py-3">Articulo</th><th className="px-4 py-3 text-right">Cant.</th><th className="px-4 py-3 text-right">Precio</th><th className="px-4 py-3 text-right">Total</th></tr></thead>
                            <tbody>{(ticket.items || []).map((item, index) => <tr key={`${item.articleId || item.code}-${index}`} className="border-b border-slate-100 last:border-b-0"><td className="px-4 py-3 font-mono text-xs font-bold text-slate-500">{item.code || '-'}</td><td className="px-4 py-3 font-black text-slate-800">{item.description || '-'}</td><td className="px-4 py-3 text-right font-mono font-bold">{Number(item.quantity || 0).toLocaleString('es-NI', { maximumFractionDigits: 3 })}</td><td className="px-4 py-3 text-right font-mono font-bold">{fmt(item.unitPriceWithTax)}</td><td className="px-4 py-3 text-right font-mono font-black text-emerald-700">{fmt(item.totalWithTax)}</td></tr>)}</tbody>
                        </table>
                        {!(ticket.items || []).length && <div className="p-8 text-center text-sm font-bold text-slate-400">Sin articulos sincronizados.</div>}
                    </div>
                </div>
                <aside className="space-y-4">
                    <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
                        <KpiCard eyebrow="Subtotal" value={fmt(ticket.subtotal)} caption={`IVA ${fmt(ticket.iva)}`} />
                        <KpiCard eyebrow="Total venta" value={fmt(ticket.total)} caption={`${ticket.itemCount || ticket.items?.length || 0} articulos`} tone="green" />
                        <KpiCard eyebrow="Utilidad bruta" value={fmt(profit)} caption={`Costo ${fmt(ticket.purchaseTotal)}`} tone="amber" />
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-white p-4">
                        <div className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Factura membretada</div>
                        <div className={`mt-2 text-sm font-black ${ticket.crmInvoiceLink?.linked ? 'text-emerald-700' : 'text-slate-500'}`}>{ticket.crmInvoiceLink?.linked ? ticket.crmInvoiceLink.invoiceNumbers.join(' / ') || 'Vinculada' : 'Este ticket no fue membretado'}</div>
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-white p-4">
                        <div className="mb-2 text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Metodos de pago</div>
                        <div className="divide-y divide-slate-100">{(ticket.paymentBreakdown || []).map((payment, index) => <div key={`${payment.method}-${index}`} className="flex justify-between gap-3 py-2 text-xs"><span className="font-black text-slate-600">{payment.method}</span><span className="font-mono font-black text-slate-950">{fmt(payment.amount)}</span></div>)}</div>
                    </div>
                </aside>
            </div>
        </ModalShell>
    );
}

function CustomerDetailModal({ customer, onClose, onOpenTicket }) {
    if (!customer) return null;
    return (
        <ModalShell eyebrow={`Perfil CRM · ${customer.segment}`} title={customer.name} subtitle={`${customer.rfc || 'Sin RUC'} · Ultima compra ${formatDate(customer.lastPurchase)}`} onClose={onClose}>
            <div className="grid gap-4 lg:grid-cols-[0.38fr_1fr]">
                <aside className="space-y-4">
                    <div className="rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-[#6f1117] p-5 text-white shadow-xl">
                        <div className="text-[9px] font-black uppercase tracking-[0.24em] text-white/50">Relacion comercial</div>
                        <div className="mt-4 flex items-center justify-between gap-4">
                            <div><div className="font-mono text-3xl font-black">{fmt(customer.sales)}</div><div className="mt-1 text-xs font-bold text-white/55">Venta en el periodo</div></div>
                            <ConversionRing value={customer.conversion} />
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/10 pt-4 text-xs"><div><span className="block text-white/45">Tickets</span><strong className="font-mono text-lg">{customer.ticketCount}</strong></div><div><span className="block text-white/45">Ticket promedio</span><strong className="font-mono text-lg">{fmt(customer.averageTicket)}</strong></div></div>
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-white p-4">
                        <div className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Datos del cliente</div>
                        <div className="mt-3 space-y-2 text-xs font-bold text-slate-600"><p>{customer.address || 'Direccion no registrada'}</p><p>Primera compra: {formatDate(customer.firstPurchase)}</p><p>{customer.linkedCount} de {customer.ticketCount} tickets membretados</p></div>
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-white p-4">
                        <div className="mb-3 text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Preferencia de pago</div>
                        <PaymentMix rows={customer.paymentTotals} total={customer.sales} />
                    </div>
                </aside>
                <div className="space-y-4">
                    <div className="rounded-3xl border border-slate-200 bg-white p-4">
                        <div className="mb-3 flex items-center justify-between"><div><div className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Afinidad</div><h4 className="mt-1 font-black text-slate-950">Productos favoritos</h4></div><span className="rounded-full bg-amber-100 px-3 py-1 text-[9px] font-black uppercase text-amber-800">Por venta</span></div>
                        <div className="space-y-3">{customer.products.slice(0, 8).map((product, index) => <div key={`${product.code}-${product.description}`} className="grid grid-cols-[28px_1fr_auto] items-center gap-3"><span className="grid h-7 w-7 place-items-center rounded-lg bg-slate-950 font-mono text-[10px] font-black text-white">{index + 1}</span><div><div className="text-xs font-black text-slate-800">{product.description}</div><div className="text-[10px] font-bold text-slate-400">{Number(product.quantity || 0).toLocaleString('es-NI', { maximumFractionDigits: 2 })} unidades / lb</div></div><span className="font-mono text-xs font-black text-emerald-700">{fmt(product.sales)}</span></div>)}</div>
                        {!customer.products.length && <EmptyState text="Sin articulos para analizar." />}
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-white p-4">
                        <div className="mb-3"><div className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Actividad</div><h4 className="mt-1 font-black text-slate-950">Tickets recientes</h4></div>
                        <div className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto">{customer.tickets.map((ticket) => <button key={ticket.id} type="button" onClick={() => onOpenTicket(ticket)} className="grid w-full grid-cols-[1fr_auto] gap-3 py-3 text-left hover:bg-slate-50"><div><div className="font-mono text-xs font-black text-slate-950">{ticketCode(ticket)}</div><div className="mt-1 text-[10px] font-bold text-slate-400">{formatDate(ticket.date)} · {ticket.crmInvoiceLink?.linked ? `Membretada ${ticket.crmInvoiceLink.invoiceNumbers.join(' / ') || ''}` : 'Solo ticket'}</div></div><span className="font-mono text-sm font-black text-emerald-700">{fmt(ticket.total)}</span></button>)}</div>
                    </div>
                </div>
            </div>
        </ModalShell>
    );
}

export default function SalesCRM({ data = {}, branchContext = {}, ticketsOverride = null, productCatalogOverride = null }) {
    const { user } = useAuth();
    const today = localDateString();
    const currentYearStart = `${today.substring(0, 4)}-01-01`;
    const availableYearStart = currentYearStart < SICAR_SALES_START_DATE ? SICAR_SALES_START_DATE : currentYearStart;
    const currentMonthStart = monthStart(today) < SICAR_SALES_START_DATE ? SICAR_SALES_START_DATE : monthStart(today);
    const defaultFromDate = currentMonthStart;
    const selectedBranchId = branchContext.selectedBranchId || 'granada';
    const branch = selectedBranchId === CONSOLIDATED_BRANCH_ID ? { shortName: 'Consolidado' } : getBranchById(selectedBranchId);
    const [fromDate, setFromDate] = useState(defaultFromDate);
    const [toDate, setToDate] = useState(today);
    const [search, setSearch] = useState('');
    const deferredSearch = useDeferredValue(search);
    const [paymentFilter, setPaymentFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [includePublic, setIncludePublic] = useState(false);
    const [activeCrmTab, setActiveCrmTab] = useState('general');
    const [customerLimitDraft, setCustomerLimitDraft] = useState('10');
    const [customerReportLimit, setCustomerReportLimit] = useState(null);
    const [productDraft, setProductDraft] = useState({ categoryKey: 'all', limit: '10', mode: 'top' });
    const [productReport, setProductReport] = useState(null);
    const [page, setPage] = useState(1);
    const [refreshToken, setRefreshToken] = useState(0);
    const [selectedTicket, setSelectedTicket] = useState(null);
    const [selectedCustomerKey, setSelectedCustomerKey] = useState('');
    const [customerExclusionsOpen, setCustomerExclusionsOpen] = useState(false);
    const hasTicketOverride = Array.isArray(ticketsOverride);
    const archive = useSicarTicketRange(fromDate, toDate, refreshToken, selectedBranchId, !hasTicketOverride);
    const invoiceArchive = useStampedInvoiceRange(fromDate, toDate, refreshToken);
    const remoteProductCatalog = useSicarProductCatalog(selectedBranchId, refreshToken, !hasTicketOverride && !productCatalogOverride);
    const productCatalog = productCatalogOverride || remoteProductCatalog;
    const customerExclusions = useSalesCrmCustomerExclusions(user?.email);
    const canManageCustomerExclusions = isMasterEmail(user?.email);

    const linkIndex = useMemo(() => {
        const invoicesById = new Map();
        [...invoiceArchive.records, ...(data.facturas_membretadas_ventas || [])].forEach((invoice) => {
            const key = invoice.id || invoice.docId || `${invoice.saleDate || invoice.date}:${invoice.invoiceNumber || invoice.numeroFactura}`;
            invoicesById.set(key, invoice);
        });
        return buildStampedInvoiceLinkIndex([...invoicesById.values()]);
    }, [data.facturas_membretadas_ventas, invoiceArchive.records]);
    const tickets = useMemo(() => mergeTicketRecords(
        archive.records,
        hasTicketOverride
            ? ticketsOverride
            : mergeSicarTicketSources(
                data.sicar_ventas_tickets || [],
                data.sicar_facturas_membretadas || []
            ),
        fromDate,
        toDate
    )
        .filter((ticket) => isTicketInBranch(ticket, selectedBranchId))
        .filter((ticket) => !isExcludedSicarTicket(ticket))
        .map((ticket) => ({ ...ticket, crmInvoiceLink: getTicketStampedInvoiceInfo(ticket, linkIndex) }))
        .sort((a, b) => Number(b.saleId || 0) - Number(a.saleId || 0)), [archive.records, data.sicar_facturas_membretadas, data.sicar_ventas_tickets, fromDate, hasTicketOverride, linkIndex, selectedBranchId, ticketsOverride, toDate]);

    const customerOptions = useMemo(() => {
        const optionMap = new Map();
        tickets.forEach((ticket) => {
            const key = getCustomerExclusionKey(ticket);
            const current = optionMap.get(key) || {
                branchId: getRecordBranchId(ticket),
                customerId: String(ticket.customerId ?? ticket.clientId ?? ticket.cli_id ?? '').trim(),
                key,
                name: ticket.customerName || ticket.cliente || 'PUBLICO EN GENERAL',
                rfc: ticket.customerRfc || ticket.rfc || '',
                sales: 0,
                ticketCount: 0,
            };
            if (!isCancelledSicarTicket(ticket)) {
                current.sales += Number(ticket.total || 0);
                current.ticketCount += 1;
            }
            optionMap.set(key, current);
        });
        return [...optionMap.values()];
    }, [tickets]);
    const excludedCustomerKeySet = useMemo(() => new Set(customerExclusions.customers.map((customer) => customer.key)), [customerExclusions.customers]);
    const applicableExclusionCount = useMemo(() => customerExclusions.customers.filter((customer) => (
        selectedBranchId === CONSOLIDATED_BRANCH_ID || customer.branchId === selectedBranchId
    )).length, [customerExclusions.customers, selectedBranchId]);
    const analysisTickets = useMemo(() => tickets.filter((ticket) => !excludedCustomerKeySet.has(getCustomerExclusionKey(ticket))), [excludedCustomerKeySet, tickets]);

    const normalizedSearch = normalizeCrmText(deferredSearch);
    const filteredTickets = useMemo(() => analysisTickets.filter((ticket) => {
        const cancelled = isCancelledSicarTicket(ticket);
        if (paymentFilter !== 'all' && !getTicketPaymentTypes(ticket).includes(paymentFilter)) return false;
        if (statusFilter === 'active' && cancelled) return false;
        if (statusFilter === 'cancelled' && !cancelled) return false;
        if (statusFilter === 'linked' && (cancelled || !ticket.crmInvoiceLink.linked)) return false;
        if (statusFilter === 'unlinked' && (cancelled || ticket.crmInvoiceLink.linked)) return false;
        if (normalizedSearch && !buildSearchText(ticket).includes(normalizedSearch)) return false;
        return true;
    }), [analysisTickets, normalizedSearch, paymentFilter, statusFilter]);

    const analytics = useMemo(() => buildSalesCrmAnalytics(
        analysisTickets,
        linkIndex,
        productCatalog.articles
    ), [analysisTickets, linkIndex, productCatalog.articles]);
    const visibleCustomers = useMemo(() => analytics.customers.filter((customer) => includePublic || !customer.isPublic), [analytics.customers, includePublic]);
    const topCustomers = useMemo(() => customerReportLimit
        ? [...visibleCustomers].sort((a, b) => b.sales - a.sales).slice(0, customerReportLimit)
        : [], [customerReportLimit, visibleCustomers]);
    const recurringCustomers = useMemo(() => customerReportLimit
        ? [...visibleCustomers]
            .sort((a, b) => b.ticketCount - a.ticketCount || b.activeDays - a.activeDays || b.sales - a.sales)
            .slice(0, customerReportLimit)
        : [], [customerReportLimit, visibleCustomers]);
    const soldCategoryKeys = useMemo(() => new Set(analytics.products.map((product) => product.categoryKey)), [analytics.products]);
    const categoryOptions = useMemo(() => productCatalog.categories.filter((category) => (
        soldCategoryKeys.has(category.categoryKey)
    )), [productCatalog.categories, soldCategoryKeys]);
    const generatedProducts = useMemo(() => {
        if (!productReport) return [];
        const candidates = productReport.categoryKey === 'all'
            ? analytics.products
            : analytics.products.filter((product) => product.categoryKey === productReport.categoryKey);
        return [...candidates]
            .sort((a, b) => productReport.mode === 'nontop' ? a.sales - b.sales : b.sales - a.sales)
            .slice(0, productReport.limit);
    }, [analytics.products, productReport]);
    const selectedCustomer = useMemo(() => analytics.customers.find((customer) => customer.key === selectedCustomerKey) || null, [analytics.customers, selectedCustomerKey]);
    const rangeLabel = getRangeLabel(fromDate, toDate);

    useEffect(() => { setPage(1); }, [deferredSearch, excludedCustomerKeySet, fromDate, paymentFilter, selectedBranchId, statusFilter, toDate]);
    useEffect(() => {
        setCustomerReportLimit(null);
        setProductReport(null);
    }, [fromDate, selectedBranchId, toDate]);
    useEffect(() => {
        setProductDraft((current) => ({ ...current, categoryKey: 'all' }));
    }, [selectedBranchId]);

    const applyPreset = (preset) => {
        if (preset === 'today') setFromDate(today);
        if (preset === 'week') setFromDate(shiftDate(today, -6));
        if (preset === 'month') setFromDate(currentMonthStart);
        if (preset === '30') setFromDate(shiftDate(today, -29));
        if (preset === 'year') setFromDate(availableYearStart);
        setToDate(today);
    };

    return (
        <div className="space-y-5">
            <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-slate-950 via-[#172033] to-[#75141a] p-5 text-white shadow-xl sm:p-7">
                <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full border-[42px] border-white/[0.035]" />
                <div className="absolute -bottom-24 left-1/3 h-48 w-48 rounded-full bg-emerald-400/10 blur-3xl" />
                <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
                    <div className="max-w-2xl">
                        <div className="text-[9px] font-black uppercase tracking-[0.34em] text-emerald-300">Inteligencia comercial SICAR · {branch.shortName}</div>
                        <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Ventas & Clientes</h2>
                        <p className="mt-2 max-w-xl text-sm font-semibold leading-relaxed text-white/60">Cada indicador nace de los tickets SICAR. Las facturas membretadas solo se usan para medir conversion, nunca para duplicar la venta.</p>
                    </div>
                    <div className="flex items-center gap-4 rounded-3xl border border-white/10 bg-white/[0.06] p-3 backdrop-blur">
                        <ConversionRing value={analytics.summary.linkedConversion} />
                        <div className="pr-3"><div className="text-[9px] font-black uppercase tracking-[0.22em] text-white/45">Tickets a membretada</div><div className="mt-1 font-mono text-xl font-black">{analytics.summary.linkedCount} / {analytics.summary.ticketCount}</div><div className="mt-1 text-[10px] font-bold text-emerald-300">{formatPercent(analytics.summary.linkedSalesConversion)} del monto vendido</div></div>
                    </div>
                </div>
            </section>

            <section className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end">
                    <div className="flex-1">
                        <div className="mb-2 text-[9px] font-black uppercase tracking-[0.22em] text-slate-400">Rango rapido</div>
                        <div className="flex flex-wrap gap-2">{[
                            ['today', 'Hoy'], ['week', '7 dias'], ['month', 'Este mes'], ['30', '30 dias'], ['year', 'Este año'],
                        ].map(([value, label]) => <button key={value} type="button" onClick={() => applyPreset(value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-600 transition hover:border-[#e30613] hover:bg-rose-50 hover:text-[#9f111a]">{label}</button>)}</div>
                    </div>
                    <label className="min-w-[165px]"><span className="mb-2 block text-[9px] font-black uppercase tracking-[0.22em] text-slate-400">Desde</span><input type="date" min={SICAR_SALES_START_DATE} max={toDate || today} value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-black text-slate-700 outline-none focus:border-sky-400" /></label>
                    <label className="min-w-[165px]"><span className="mb-2 block text-[9px] font-black uppercase tracking-[0.22em] text-slate-400">Hasta</span><input type="date" min={fromDate || SICAR_SALES_START_DATE} max={today} value={toDate} onChange={(event) => setToDate(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-black text-slate-700 outline-none focus:border-sky-400" /></label>
                    <button type="button" onClick={() => setRefreshToken((value) => value + 1)} disabled={archive.loading} className="rounded-xl bg-slate-950 px-4 py-3 text-[10px] font-black uppercase tracking-wider text-white transition hover:bg-[#e30613] disabled:opacity-50">{archive.loading ? 'Actualizando...' : 'Actualizar'}</button>
                    <button type="button" onClick={() => downloadCsv(filteredTickets, `${fromDate}-${toDate}`)} disabled={!filteredTickets.length} className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[10px] font-black uppercase tracking-wider text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-40">Exportar CSV</button>
                    {(canManageCustomerExclusions || applicableExclusionCount > 0) && (
                        <button
                            type="button"
                            onClick={() => setCustomerExclusionsOpen(true)}
                            disabled={customerExclusions.loading}
                            className={`rounded-xl border px-4 py-3 text-[10px] font-black uppercase tracking-wider transition disabled:opacity-50 ${applicableExclusionCount > 0 ? 'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100' : 'border-slate-200 bg-white text-slate-600 hover:border-rose-300 hover:text-rose-700'}`}
                        >
                            {customerExclusions.loading ? 'Cargando lista...' : `Excluir clientes${applicableExclusionCount ? ` (${applicableExclusionCount})` : ''}`}
                        </button>
                    )}
                </div>
                {archive.error && <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{archive.error}</div>}
                {customerExclusions.error && <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">Lista de exclusiones: {customerExclusions.error}</div>}
                <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4 text-[10px] font-bold text-slate-500"><span className="rounded-full bg-sky-100 px-3 py-1 text-sky-800">{rangeLabel}</span><span>{tickets.length} registros SICAR cargados</span>{applicableExclusionCount > 0 && <span className="rounded-full bg-rose-100 px-3 py-1 text-rose-800">{analysisTickets.length} considerados · {applicableExclusionCount} clientes excluidos</span>}{archive.updatedAt && <span>Actualizado {archive.updatedAt.toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' })}</span>}<span className="ml-auto text-emerald-700">El filtro no genera lecturas por cada KPI</span></div>
            </section>

            <nav className="grid gap-2 rounded-[2rem] border border-slate-200 bg-white p-2 shadow-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="Areas del CRM de ventas">
                {SALES_CRM_TABS.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveCrmTab(tab.id)}
                        className={`rounded-[1.4rem] px-4 py-3 text-left transition ${activeCrmTab === tab.id ? 'bg-slate-950 text-white shadow-lg' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                        <span className="block text-sm font-black">{tab.label}</span>
                        <span className={`mt-0.5 block text-[9px] font-bold uppercase tracking-[0.16em] ${activeCrmTab === tab.id ? 'text-emerald-300' : 'text-slate-400'}`}>{tab.caption}</span>
                    </button>
                ))}
            </nav>

            {activeCrmTab === 'general' && (
                <>
                    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                        <KpiCard eyebrow="Venta SICAR" value={fmt(analytics.summary.sales)} caption={`${formatInteger(analytics.summary.ticketCount)} tickets activos`} tone="green" />
                        <KpiCard eyebrow="Ticket promedio" value={fmt(analytics.summary.averageTicket)} caption={`${formatInteger(analytics.summary.customerCount)} clientes identificados`} tone="blue" />
                        <KpiCard eyebrow="Conversion membretada" value={formatPercent(analytics.summary.linkedConversion)} caption={`${analytics.summary.linkedCount} tickets · ${fmt(analytics.summary.linkedSales)}`} tone="amber" progress={analytics.summary.linkedConversion} />
                        <KpiCard eyebrow="Utilidad bruta" value={fmt(analytics.summary.profit)} caption={`Margen ${formatPercent(analytics.summary.margin)} · Costo ${fmt(analytics.summary.cost)}`} tone="slate" />
                        <KpiCard eyebrow="Clientes recurrentes" value={formatInteger(analytics.summary.recurringCustomers)} caption={`${analytics.cancelledCount} tickets anulados en el periodo`} tone="red" />
                    </section>

                    <section className="grid gap-5 xl:grid-cols-[1.55fr_0.75fr]">
                        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="mb-4"><div className="text-[9px] font-black uppercase tracking-[0.24em] text-[#e30613]">Comportamiento</div><div className="mt-1 flex items-end justify-between gap-3"><h3 className="text-lg font-black text-slate-950">Ritmo de ventas</h3><span className="text-[10px] font-bold text-slate-400">Verde: tickets convertidos a membretada</span></div></div>
                            <DailySalesChart daily={analytics.daily} fromDate={fromDate} toDate={toDate} />
                        </div>
                        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="mb-5"><div className="text-[9px] font-black uppercase tracking-[0.24em] text-sky-600">Cobranza</div><h3 className="mt-1 text-lg font-black text-slate-950">Mezcla de pago</h3></div>
                            <PaymentMix rows={analytics.paymentTotals} total={analytics.summary.sales} />
                        </div>
                    </section>

                    <section className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                        <div className="mb-5"><div className="text-[9px] font-black uppercase tracking-[0.24em] text-sky-600">Ventas por ticket</div><h3 className="mt-1 text-xl font-black text-slate-950">Explorador general SICAR</h3><p className="mt-1 text-xs font-semibold text-slate-500">Busca directamente por cliente, ticket, RUC, factura o articulo.</p></div>
                        <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_0.28fr_0.28fr]">
                            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Escribir nombre del cliente o buscar ticket..." className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100" />
                            <select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black text-slate-700 outline-none focus:border-sky-400">{Object.entries(PAYMENT_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select>
                            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black text-slate-700 outline-none focus:border-sky-400">{STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                        </div>
                        <TicketTable tickets={filteredTickets} page={page} onPageChange={setPage} onOpen={setSelectedTicket} />
                    </section>
                </>
            )}

            {activeCrmTab === 'departamentos' && (
                <DepartmentSalesPanel
                    rows={analytics.departments}
                    total={analytics.summary.productSales}
                    rangeLabel={rangeLabel}
                />
            )}

            {activeCrmTab === 'clientes' && (
                <section className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                    <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
                        <div className="max-w-2xl"><div className="text-[9px] font-black uppercase tracking-[0.26em] text-amber-600">CRM de clientes</div><h3 className="mt-1 text-2xl font-black text-slate-950">Valor comercial y recurrencia</h3><p className="mt-2 text-sm font-semibold text-slate-500">Genera dos lecturas: quienes aportan mayor venta y quienes compran con mayor frecuencia dentro del periodo.</p></div>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                            <label><span className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Cantidad</span><select value={customerLimitDraft} onChange={(event) => setCustomerLimitDraft(event.target.value)} className="min-w-36 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-black text-slate-700">{RANKING_LIMITS.map((limit) => <option key={limit} value={limit}>Top {limit}</option>)}</select></label>
                            <label className="flex h-[42px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 text-xs font-black text-slate-600"><input type="checkbox" checked={includePublic} onChange={(event) => setIncludePublic(event.target.checked)} className="h-4 w-4 accent-[#e30613]" />Incluir publico general</label>
                            <button type="button" onClick={() => setCustomerReportLimit(Number(customerLimitDraft))} className="h-[42px] rounded-xl bg-[#e30613] px-6 text-[10px] font-black uppercase tracking-[0.18em] text-white shadow-lg transition hover:bg-[#b8050f]">Generar</button>
                        </div>
                    </div>

                    <div className="mt-6">
                        {!customerReportLimit ? (
                            <GeneratePrompt title="Ranking listo para configurar" text="Selecciona Top 10, 20, 25 o 100 y pulsa Generar. La página mostrará solo el análisis solicitado." />
                        ) : (
                            <div className="space-y-7">
                                <div><div className="mb-3 flex items-end justify-between"><div><div className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-600">Por facturacion</div><h4 className="mt-1 text-lg font-black text-slate-950">Top {customerReportLimit} clientes por venta</h4></div><span className="text-xs font-bold text-slate-400">Mayor aporte monetario</span></div><CustomerTable customers={topCustomers} totalSales={analytics.summary.sales} onOpen={setSelectedCustomerKey} /></div>
                                <div><div className="mb-3 flex items-end justify-between"><div><div className="text-[9px] font-black uppercase tracking-[0.2em] text-sky-600">Por frecuencia</div><h4 className="mt-1 text-lg font-black text-slate-950">Top {customerReportLimit} clientes recurrentes</h4></div><span className="text-xs font-bold text-slate-400">Mas tickets y dias con compras</span></div><CustomerTable customers={recurringCustomers} totalSales={analytics.summary.sales} onOpen={setSelectedCustomerKey} /></div>
                            </div>
                        )}
                    </div>
                </section>
            )}

            {activeCrmTab === 'articulos' && (
                <section className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                    <div className="flex flex-col gap-5">
                        <div><div className="text-[9px] font-black uppercase tracking-[0.26em] text-sky-600">Inteligencia de producto</div><h3 className="mt-1 text-2xl font-black text-slate-950">Desempeño por articulo SICAR</h3><p className="mt-2 text-sm font-semibold text-slate-500">Compara los productos con mayor o menor venta usando las categorias y departamentos reales de SICAR.</p></div>
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[0.7fr_0.7fr_1.5fr_auto] xl:items-end">
                            <label><span className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Ranking</span><select value={productDraft.mode} onChange={(event) => setProductDraft((current) => ({ ...current, mode: event.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-black text-slate-700"><option value="top">Top - Mas vendidos</option><option value="nontop">NonTop - Menos vendidos</option></select></label>
                            <label><span className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Cantidad</span><select value={productDraft.limit} onChange={(event) => setProductDraft((current) => ({ ...current, limit: event.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-black text-slate-700">{RANKING_LIMITS.map((limit) => <option key={limit} value={limit}>{limit} articulos</option>)}</select></label>
                            <label><span className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Categoria SICAR</span><select value={productDraft.categoryKey} onChange={(event) => setProductDraft((current) => ({ ...current, categoryKey: event.target.value }))} disabled={productCatalog.loading} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-black text-slate-700 disabled:opacity-50"><option value="all">Todas las categorias</option>{categoryOptions.map((category) => <option key={category.categoryKey} value={category.categoryKey}>{category.departmentName} / {category.categoryName}{selectedBranchId === CONSOLIDATED_BRANCH_ID ? ` · ${category.branchId}` : ''}</option>)}</select></label>
                            <button type="button" onClick={() => setProductReport({ ...productDraft, limit: Number(productDraft.limit) })} disabled={productCatalog.loading} className="h-[42px] rounded-xl bg-[#e30613] px-6 text-[10px] font-black uppercase tracking-[0.18em] text-white shadow-lg transition hover:bg-[#b8050f] disabled:opacity-50">Generar</button>
                        </div>
                        {productCatalog.error && <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">No se pudo actualizar el catalogo SICAR: {productCatalog.error}</div>}
                    </div>

                    <div className="mt-6">
                        {!productReport ? (
                            <GeneratePrompt title="Analisis de articulos bajo demanda" text="Elige categoria, Top o NonTop y la cantidad. Pulsa Generar para mostrar solamente el ranking que necesitas." />
                        ) : (
                            <div><div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><div className={`text-[9px] font-black uppercase tracking-[0.2em] ${productReport.mode === 'top' ? 'text-emerald-600' : 'text-amber-600'}`}>{productReport.mode === 'top' ? 'Mayor venta' : 'Menor venta'}</div><h4 className="mt-1 text-lg font-black text-slate-950">{productReport.mode === 'top' ? 'Top' : 'NonTop'} {productReport.limit} articulos</h4></div><span className="text-xs font-bold text-slate-400">{generatedProducts.length} resultados · {rangeLabel}</span></div><ProductTable products={generatedProducts} totalSales={analytics.summary.sales} mode={productReport.mode} /></div>
                        )}
                    </div>
                </section>
            )}

            <TicketDetailModal ticket={selectedTicket} onClose={() => setSelectedTicket(null)} />
            <CustomerDetailModal customer={selectedCustomer} onClose={() => setSelectedCustomerKey('')} onOpenTicket={(ticket) => { setSelectedCustomerKey(''); setSelectedTicket(ticket); }} />
            {customerExclusionsOpen && (
                <CustomerExclusionModal
                    customers={customerOptions}
                    excludedCustomers={customerExclusions.customers}
                    readOnly={!canManageCustomerExclusions}
                    saving={customerExclusions.saving}
                    onClose={() => setCustomerExclusionsOpen(false)}
                    onSave={customerExclusions.save}
                />
            )}
        </div>
    );
}
