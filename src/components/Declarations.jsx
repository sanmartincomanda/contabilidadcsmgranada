import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import {
    APP_BRAND_LOGO,
    APP_BRAND_NAME,
    BRANCHES,
    CONSOLIDATED_BRANCH_ID,
    DEFAULT_BRANCH_ID,
    fmt,
    getBranchById,
    getRecordBranchId,
    peso,
} from '../constants';

const DECLARATIONS_COLLECTION = 'declaraciones_retenciones';
const VAT_DECLARATIONS_COLLECTION = 'declaraciones_iva';
const STAMPED_INVOICE_DECLARATIONS_COLLECTION = 'declaraciones_facturas_membretadas';
const INVOICE_COLLECTION = 'facturas_membretadas_ventas';
const RECEIPT_COLLECTION = 'recibos_caja_membretados';
const PURCHASE_COLLECTION = 'compras';
const EXPENSE_COLLECTION = 'gastos';
const MAX_DECLARATION_AGE_MONTHS = 6;
const DECLARATION_MODULES = {
    RETENTION_IR: 'retention_ir',
    IVA: 'iva',
    STAMPED_INVOICES: 'facturas_membretadas',
};

const Icons = {
    receipt: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
    check: 'M5 13l4 4L19 7',
    calendar: 'M8 7V3m8 4V3M5 11h14M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z',
    printer: 'M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z',
    alert: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
};

const Icon = ({ path, className = 'h-4 w-4' }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
);

const currentMonth = () => new Date().toISOString().substring(0, 7);

const cleanText = (value = '') => String(value || '').trim();

const normalizeText = (value = '') => cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

const isActiveFiscalDocument = (item = {}) => {
    const status = normalizeText(item.status || item.estado || item.accountingStatus || item.integrationStatus || 'ACTIVO');
    return !['ANULADA', 'ANULADO', 'CANCELADA', 'CANCELADO', 'DELETED', 'VOID', 'VOIDED'].includes(status);
};

const getDateString = (value, fallback = '') => {
    if (typeof value === 'string') return value.substring(0, 10);
    if (value?.toDate) return value.toDate().toISOString().substring(0, 10);
    return cleanText(fallback).substring(0, 10);
};

const getMonthString = (date = '') => cleanText(date).substring(0, 7);

const monthIndex = (month = '') => {
    const [year, monthNumber] = cleanText(month).split('-').map(Number);
    if (!year || !monthNumber) return 0;
    return year * 12 + (monthNumber - 1);
};

const monthDiff = (fromMonth = '', toMonth = '') => monthIndex(toMonth) - monthIndex(fromMonth);

const getDocumentNumber = (item = {}, fallback = '') => (
    cleanText(
        item.documentDisplayNumber
        || item.invoiceNumber
        || item.numeroFactura
        || item.receiptNumber
        || item.receiptDisplayNumber
        || item.folio
        || item.number
        || item.numero
        || fallback
    )
);

const getDocumentPrefix = (sourceCollection) => {
    if (sourceCollection === RECEIPT_COLLECTION) return 'R';
    if (sourceCollection === PURCHASE_COLLECTION) return 'C';
    if (sourceCollection === EXPENSE_COLLECTION) return 'G';
    return 'F';
};

const formatDeclarationDocument = (sourceCollection, document = '') => {
    const cleanDocument = cleanText(document).replace(/^[FRCG]\s*-\s*/i, '');
    const prefix = getDocumentPrefix(sourceCollection);
    return cleanDocument ? `${prefix} - ${cleanDocument}` : `${prefix} -`;
};

const getClientName = (item = {}) => cleanText(
    item.client
    || item.cliente
    || item.customerName
    || item.customer
    || item.recibiDe
    || item.receivedFrom
    || item.partyName
    || 'Cliente no especificado'
);

const getProviderName = (item = {}) => cleanText(
    item.supplier
    || item.proveedor
    || item.provider
    || item.vendor
    || item.vendorName
    || item.concept
    || item.description
    || 'Proveedor no especificado'
);

const getRetentionSupportStatus = (item = {}) => {
    const support = item.supportFiles || {};
    return {
        invoice: Boolean(support.invoice || support.main || item.invoiceFileUrl || item.supportUrl),
        ir: Boolean(support.retentionIr2 || item.retentionIrSupportUrl),
    };
};

const normalizeDeclarationItem = (sourceCollection, item = {}) => {
    const retentionIr2 = peso(item.retentionIr2 ?? item.retencionIr2);
    const date = getDateString(item.saleDate || item.date || item.fecha || item.createdAt);
    const sourceId = cleanText(item.id);
    const sourceType = sourceCollection === INVOICE_COLLECTION ? 'Factura membretada' : 'Recibo de caja';
    const sourceKey = `${sourceCollection}:${sourceId}`;

    return {
        id: sourceKey,
        sourceKey,
        sourceId,
        sourceCollection,
        sourceType,
        date,
        month: getMonthString(date || item.month || item.mes),
        branchId: getRecordBranchId(item),
        branchName: getBranchById(getRecordBranchId(item)).shortName,
        document: formatDeclarationDocument(sourceCollection, getDocumentNumber(item, sourceId)),
        client: getClientName(item),
        subtotal: peso(item.subtotal),
        total: peso(item.total ?? item.amount ?? item.monto),
        retentionIr2,
        retentionTotal: retentionIr2,
        supportStatus: getRetentionSupportStatus(item),
        retentionDeclared: item.retentionDeclared === true || item.retentionDeclarationStatus === 'declarada',
        retentionDeclaredMonth: item.retentionDeclaredMonth || item.declarationMonth || '',
    };
};

const buildRetentionRows = (data = {}) => ([
    ...(data[INVOICE_COLLECTION] || []).filter(isActiveFiscalDocument).map((item) => normalizeDeclarationItem(INVOICE_COLLECTION, item)),
    ...(data[RECEIPT_COLLECTION] || []).filter(isActiveFiscalDocument).map((item) => normalizeDeclarationItem(RECEIPT_COLLECTION, item)),
]).filter((row) => row.sourceId && row.month && row.retentionIr2 > 0);

const normalizeVatItem = (sourceCollection, item = {}) => {
    const iva = peso(item.iva ?? item.tax ?? item.taxAmount);
    const date = getDateString(item.saleDate || item.date || item.fecha || item.createdAt);
    const sourceId = cleanText(item.id);
    const isSoldVat = sourceCollection === INVOICE_COLLECTION;
    const sourceKey = `${sourceCollection}:${sourceId}`;
    const sourceType = isSoldVat
        ? 'Factura membretada'
        : sourceCollection === PURCHASE_COLLECTION
            ? 'Compra'
            : 'Gasto';

    return {
        id: sourceKey,
        sourceKey,
        sourceId,
        sourceCollection,
        sourceType,
        vatType: isSoldVat ? 'sold' : 'purchased',
        date,
        month: getMonthString(date || item.month || item.mes),
        branchId: getRecordBranchId(item),
        branchName: getBranchById(getRecordBranchId(item)).shortName,
        document: formatDeclarationDocument(sourceCollection, getDocumentNumber(item, sourceId)),
        party: isSoldVat ? getClientName(item) : getProviderName(item),
        subtotal: peso(item.subtotal ?? item.amount ?? item.monto),
        iva,
        total: peso(item.total ?? item.amount ?? item.monto),
        vatDeclared: item.vatDeclared === true || item.vatDeclarationStatus === 'declarada',
        vatDeclaredMonth: item.vatDeclaredMonth || item.vatDeclarationMonth || '',
    };
};

const buildVatRows = (data = {}) => ([
    ...(data[INVOICE_COLLECTION] || []).filter(isActiveFiscalDocument).map((item) => normalizeVatItem(INVOICE_COLLECTION, item)),
    ...(data[PURCHASE_COLLECTION] || []).filter(isActiveFiscalDocument).map((item) => normalizeVatItem(PURCHASE_COLLECTION, item)),
    ...(data[EXPENSE_COLLECTION] || []).filter(isActiveFiscalDocument).map((item) => normalizeVatItem(EXPENSE_COLLECTION, item)),
]).filter((row) => row.sourceId && row.month && row.iva > 0);

const normalizeStampedInvoiceDeclarationItem = (item = {}) => {
    const date = getDateString(item.saleDate || item.date || item.fecha || item.createdAt);
    const sourceId = cleanText(item.id);
    const sourceKey = `${INVOICE_COLLECTION}:${sourceId}`;
    const subtotal = peso(item.subtotal);
    const iva = peso(item.iva ?? item.tax ?? item.taxAmount);
    const total = peso(item.total ?? item.amount ?? item.monto);
    const retentionIr2 = peso(item.retentionIr2 ?? item.retencionIr2);
    const retentionMunicipal1 = peso(item.retentionMunicipal1 ?? item.retencionMunicipal1);
    const retentionTotal = peso(item.retentionTotal || retentionIr2 + retentionMunicipal1);

    return {
        id: sourceKey,
        sourceKey,
        sourceId,
        sourceCollection: INVOICE_COLLECTION,
        sourceType: 'Factura membretada',
        date,
        month: getMonthString(date || item.month || item.mes),
        branchId: getRecordBranchId(item),
        branchName: getBranchById(getRecordBranchId(item)).shortName,
        document: formatDeclarationDocument(INVOICE_COLLECTION, getDocumentNumber(item, sourceId)),
        client: getClientName(item),
        paymentMethod: cleanText(item.paymentMethod || item.metodoPago || item.paymentType || ''),
        subtotal,
        iva,
        total,
        retentionIr2,
        retentionMunicipal1,
        retentionTotal,
        netTotal: peso(item.netTotal ?? item.paymentNetTotal ?? (total - retentionTotal)),
        declared: item.stampedInvoiceDeclared === true || item.stampedInvoiceDeclarationStatus === 'declarada',
        declaredMonth: item.stampedInvoiceDeclaredMonth || item.stampedInvoiceDeclarationMonth || '',
    };
};

const buildStampedInvoiceRows = (data = {}) => (
    (data[INVOICE_COLLECTION] || [])
        .filter(isActiveFiscalDocument)
        .map(normalizeStampedInvoiceDeclarationItem)
        .filter((row) => row.sourceId && row.month && row.total > 0)
);

const buildDeclaredKeySet = (declarations = []) => {
    const set = new Set();
    declarations
        .filter((declaration) => String(declaration.status || 'declarada').toLowerCase() !== 'anulada')
        .forEach((declaration) => {
            (declaration.items || []).forEach((item) => {
                if (item.sourceKey) set.add(item.sourceKey);
                else if (item.sourceCollection && item.sourceId) set.add(`${item.sourceCollection}:${item.sourceId}`);
            });
        });
    return set;
};

const sumRows = (rows = []) => rows.reduce((acc, row) => ({
    retentionIr2: acc.retentionIr2 + peso(row.retentionIr2),
    retentionTotal: acc.retentionTotal + peso(row.retentionIr2),
    subtotal: acc.subtotal + peso(row.subtotal),
    total: acc.total + peso(row.total),
}), { retentionIr2: 0, retentionTotal: 0, subtotal: 0, total: 0 });

const sumVatRows = (rows = []) => rows.reduce((acc, row) => {
    const iva = peso(row.iva);
    const subtotal = peso(row.subtotal);
    const total = peso(row.total);
    if (row.vatType === 'sold') {
        acc.soldVat += iva;
        acc.soldSubtotal += subtotal;
        acc.soldTotal += total;
    } else {
        acc.purchasedVat += iva;
        acc.purchasedSubtotal += subtotal;
        acc.purchasedTotal += total;
    }
    acc.netVat = acc.soldVat - acc.purchasedVat;
    return acc;
}, {
    soldVat: 0,
    purchasedVat: 0,
    netVat: 0,
    soldSubtotal: 0,
    purchasedSubtotal: 0,
    soldTotal: 0,
    purchasedTotal: 0,
});

const sumVatTableRows = (rows = []) => rows.reduce((acc, row) => ({
    subtotal: acc.subtotal + peso(row.subtotal),
    iva: acc.iva + peso(row.iva),
    total: acc.total + peso(row.total),
}), { subtotal: 0, iva: 0, total: 0 });

const sumStampedInvoiceRows = (rows = []) => rows.reduce((acc, row) => ({
    subtotal: acc.subtotal + peso(row.subtotal),
    iva: acc.iva + peso(row.iva),
    total: acc.total + peso(row.total),
    retentionIr2: acc.retentionIr2 + peso(row.retentionIr2),
    retentionMunicipal1: acc.retentionMunicipal1 + peso(row.retentionMunicipal1),
    retentionTotal: acc.retentionTotal + peso(row.retentionTotal),
    netTotal: acc.netTotal + peso(row.netTotal),
}), {
    subtotal: 0,
    iva: 0,
    total: 0,
    retentionIr2: 0,
    retentionMunicipal1: 0,
    retentionTotal: 0,
    netTotal: 0,
});

const Card = ({ children, className = '' }) => (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>
);

const StatCard = ({ label, value, tone = 'slate', help = '' }) => {
    const tones = {
        slate: 'border-slate-200 bg-slate-50 text-slate-900',
        green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        amber: 'border-amber-200 bg-amber-50 text-amber-800',
        red: 'border-rose-200 bg-rose-50 text-rose-800',
        blue: 'border-sky-200 bg-sky-50 text-sky-800',
    };

    return (
        <div className={`rounded-2xl border p-4 ${tones[tone] || tones.slate}`}>
            <div className="text-[10px] font-black uppercase tracking-[0.22em] opacity-70">{label}</div>
            <div className="mt-1 font-mono text-2xl font-black">{value}</div>
            {help && <div className="mt-1 text-xs font-bold opacity-70">{help}</div>}
        </div>
    );
};

const SourceBadge = ({ row }) => (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
        row.sourceCollection === INVOICE_COLLECTION
            ? 'bg-sky-100 text-sky-700'
            : 'bg-emerald-100 text-emerald-700'
    }`}>
        {row.sourceType}
    </span>
);

const VatReportTable = ({ title, rows = [], emptyMessage, tone = 'sky', rowKeyPrefix = 'iva' }) => {
    const totals = sumVatTableRows(rows);
    const toneClasses = {
        green: 'bg-emerald-50 text-emerald-800 border-emerald-200',
        amber: 'bg-amber-50 text-amber-800 border-amber-200',
        sky: 'bg-sky-50 text-sky-800 border-sky-200',
    };

    return (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className={`flex items-center justify-between gap-3 border-b px-4 py-3 ${toneClasses[tone] || toneClasses.sky}`}>
                <div>
                    <h3 className="text-sm font-black uppercase tracking-[0.18em]">{title}</h3>
                    <p className="mt-0.5 text-[10px] font-bold opacity-70">{rows.length} documento(s)</p>
                </div>
                <div className="text-right">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] opacity-70">IVA</div>
                    <div className="font-mono text-sm font-black">{fmt(totals.iva)}</div>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="border-b border-slate-300 text-left font-black uppercase tracking-[0.16em] text-slate-500">
                            <th className="py-2 pl-4 pr-2">Fecha</th>
                            <th className="px-2 py-2">Documento</th>
                            <th className="px-2 py-2">Cliente / proveedor</th>
                            <th className="px-2 py-2">Sucursal</th>
                            <th className="px-2 py-2 text-right">Subtotal</th>
                            <th className="px-2 py-2 text-right">IVA</th>
                            <th className="py-2 pl-2 pr-4 text-right">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={`${rowKeyPrefix}-${row.sourceKey || row.sourceId || row.document}`} className="border-b border-slate-100 last:border-b-0">
                                <td className="py-2 pl-4 pr-2 font-semibold">{row.date}</td>
                                <td className="px-2 py-2 font-black">{formatDeclarationDocument(row.sourceCollection, row.document)}</td>
                                <td className="px-2 py-2 font-semibold">{row.party}</td>
                                <td className="px-2 py-2 font-semibold">{row.branchName}</td>
                                <td className="px-2 py-2 text-right font-mono font-bold">{fmt(row.subtotal)}</td>
                                <td className="px-2 py-2 text-right font-mono font-black">{fmt(row.iva)}</td>
                                <td className="py-2 pl-2 pr-4 text-right font-mono font-bold">{fmt(row.total)}</td>
                            </tr>
                        ))}
                        {!rows.length && (
                            <tr>
                                <td colSpan={7} className="py-8 text-center font-bold text-slate-400">
                                    {emptyMessage}
                                </td>
                            </tr>
                        )}
                    </tbody>
                    {rows.length > 0 && (
                        <tfoot>
                            <tr className="border-t border-slate-300 bg-slate-50 font-black text-slate-900">
                                <td colSpan={4} className="py-2 pl-4 pr-2">Total {title.toLowerCase()}</td>
                                <td className="px-2 py-2 text-right font-mono">{fmt(totals.subtotal)}</td>
                                <td className="px-2 py-2 text-right font-mono">{fmt(totals.iva)}</td>
                                <td className="py-2 pl-2 pr-4 text-right font-mono">{fmt(totals.total)}</td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </div>
    );
};

const StampedInvoiceReportTable = ({ rows = [], emptyMessage = 'No hay facturas membretadas para mostrar.', rowKeyPrefix = 'stamped' }) => {
    const totals = sumStampedInvoiceRows(rows);

    return (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-sky-200 bg-sky-50 px-4 py-3 text-sky-800">
                <div>
                    <h3 className="text-sm font-black uppercase tracking-[0.18em]">Facturas membretadas</h3>
                    <p className="mt-0.5 text-[10px] font-bold opacity-70">{rows.length} factura(s)</p>
                </div>
                <div className="text-right">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] opacity-70">Total</div>
                    <div className="font-mono text-sm font-black">{fmt(totals.total)}</div>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="border-b border-slate-300 text-left font-black uppercase tracking-[0.16em] text-slate-500">
                            <th className="py-2 pl-4 pr-2">Fecha</th>
                            <th className="px-2 py-2">Factura</th>
                            <th className="px-2 py-2">Cliente</th>
                            <th className="px-2 py-2">Sucursal</th>
                            <th className="px-2 py-2">Metodo</th>
                            <th className="px-2 py-2 text-right">Subtotal</th>
                            <th className="px-2 py-2 text-right">IVA</th>
                            <th className="px-2 py-2 text-right">Total</th>
                            <th className="px-2 py-2 text-right">Ret.</th>
                            <th className="py-2 pl-2 pr-4 text-right">Neto</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={`${rowKeyPrefix}-${row.sourceKey || row.sourceId || row.document}`} className="border-b border-slate-100 last:border-b-0">
                                <td className="py-2 pl-4 pr-2 font-semibold">{row.date}</td>
                                <td className="px-2 py-2 font-black">{formatDeclarationDocument(row.sourceCollection, row.document)}</td>
                                <td className="px-2 py-2 font-semibold">{row.client}</td>
                                <td className="px-2 py-2 font-semibold">{row.branchName}</td>
                                <td className="px-2 py-2 font-semibold">{row.paymentMethod || '-'}</td>
                                <td className="px-2 py-2 text-right font-mono font-bold">{fmt(row.subtotal)}</td>
                                <td className="px-2 py-2 text-right font-mono font-bold">{fmt(row.iva)}</td>
                                <td className="px-2 py-2 text-right font-mono font-black">{fmt(row.total)}</td>
                                <td className="px-2 py-2 text-right font-mono font-bold">{fmt(row.retentionTotal)}</td>
                                <td className="py-2 pl-2 pr-4 text-right font-mono font-bold">{fmt(row.netTotal)}</td>
                            </tr>
                        ))}
                        {!rows.length && (
                            <tr>
                                <td colSpan={10} className="py-8 text-center font-bold text-slate-400">
                                    {emptyMessage}
                                </td>
                            </tr>
                        )}
                    </tbody>
                    {rows.length > 0 && (
                        <tfoot>
                            <tr className="border-t border-slate-300 bg-slate-50 font-black text-slate-900">
                                <td colSpan={5} className="py-2 pl-4 pr-2">Total facturas membretadas</td>
                                <td className="px-2 py-2 text-right font-mono">{fmt(totals.subtotal)}</td>
                                <td className="px-2 py-2 text-right font-mono">{fmt(totals.iva)}</td>
                                <td className="px-2 py-2 text-right font-mono">{fmt(totals.total)}</td>
                                <td className="px-2 py-2 text-right font-mono">{fmt(totals.retentionTotal)}</td>
                                <td className="py-2 pl-2 pr-4 text-right font-mono">{fmt(totals.netTotal)}</td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </div>
    );
};

export default function Declarations({ data = {}, branchContext }) {
    const [moduleTab, setModuleTab] = useState(DECLARATION_MODULES.RETENTION_IR);
    const [activeTab, setActiveTab] = useState('pendientes');
    const [declarationMonth, setDeclarationMonth] = useState(currentMonth());
    const [branchFilter, setBranchFilter] = useState(() => (
        branchContext?.allowedBranchIds?.length > 1 ? CONSOLIDATED_BRANCH_ID : (branchContext?.selectedBranchId || DEFAULT_BRANCH_ID)
    ));
    const [originMonthFilter, setOriginMonthFilter] = useState('all');
    const [vatTypeFilter, setVatTypeFilter] = useState('all');
    const [selectedKeys, setSelectedKeys] = useState(() => new Set());
    const [selectedVatKeys, setSelectedVatKeys] = useState(() => new Set());
    const [selectedStampedInvoiceKeys, setSelectedStampedInvoiceKeys] = useState(() => new Set());
    const [declaring, setDeclaring] = useState(false);
    const [declaringVat, setDeclaringVat] = useState(false);
    const [declaringStampedInvoices, setDeclaringStampedInvoices] = useState(false);

    const allowedBranchIds = useMemo(
        () => (branchContext?.allowedBranchIds?.length ? branchContext.allowedBranchIds : [branchContext?.selectedBranchId || DEFAULT_BRANCH_ID]),
        [branchContext?.allowedBranchIds, branchContext?.selectedBranchId]
    );

    const branchOptions = useMemo(() => {
        const allowed = new Set(allowedBranchIds);
        const branches = BRANCHES.filter((branch) => allowed.has(branch.id));
        return branches.length > 1
            ? [{ id: CONSOLIDATED_BRANCH_ID, shortName: 'Todas', invoiceSeries: 'A+B' }, ...branches]
            : branches;
    }, [allowedBranchIds]);

    const declarations = useMemo(() => (
        [...(data[DECLARATIONS_COLLECTION] || [])].sort((a, b) => String(b.declarationMonth || '').localeCompare(String(a.declarationMonth || '')))
    ), [data]);

    const vatDeclarations = useMemo(() => (
        [...(data[VAT_DECLARATIONS_COLLECTION] || [])].sort((a, b) => String(b.declarationMonth || '').localeCompare(String(a.declarationMonth || '')))
    ), [data]);

    const stampedInvoiceDeclarations = useMemo(() => (
        [...(data[STAMPED_INVOICE_DECLARATIONS_COLLECTION] || [])].sort((a, b) => String(b.declarationMonth || '').localeCompare(String(a.declarationMonth || '')))
    ), [data]);

    const declaredKeys = useMemo(() => buildDeclaredKeySet(declarations), [declarations]);
    const declaredVatKeys = useMemo(() => buildDeclaredKeySet(vatDeclarations), [vatDeclarations]);
    const declaredStampedInvoiceKeys = useMemo(() => buildDeclaredKeySet(stampedInvoiceDeclarations), [stampedInvoiceDeclarations]);

    const allRows = useMemo(() => (
        buildRetentionRows(data)
            .filter((row) => allowedBranchIds.includes(row.branchId))
            .sort((a, b) => `${a.date}-${a.document}`.localeCompare(`${b.date}-${b.document}`))
    ), [allowedBranchIds, data]);

    const visibleRows = useMemo(() => allRows.filter((row) => (
        branchFilter === CONSOLIDATED_BRANCH_ID || row.branchId === branchFilter
    )), [allRows, branchFilter]);

    const pendingRows = useMemo(() => visibleRows
        .map((row) => ({
            ...row,
            ageMonths: monthDiff(row.month, declarationMonth),
            isDeclared: row.retentionDeclared || declaredKeys.has(row.sourceKey),
        }))
        .filter((row) => !row.isDeclared && row.ageMonths >= 0), [declarationMonth, declaredKeys, visibleRows]);

    const eligibleRows = useMemo(() => pendingRows
        .filter((row) => row.ageMonths < MAX_DECLARATION_AGE_MONTHS), [pendingRows]);

    const expiredRows = useMemo(() => pendingRows
        .filter((row) => row.ageMonths >= MAX_DECLARATION_AGE_MONTHS), [pendingRows]);

    const originMonthOptions = useMemo(() => (
        [...new Set(pendingRows.map((row) => row.month).filter(Boolean))]
            .sort((a, b) => String(b).localeCompare(String(a)))
    ), [pendingRows]);

    const displayedEligibleRows = useMemo(() => eligibleRows.filter((row) => (
        originMonthFilter === 'all' || row.month === originMonthFilter
    )), [eligibleRows, originMonthFilter]);

    const displayedExpiredRows = useMemo(() => expiredRows.filter((row) => (
        originMonthFilter === 'all' || row.month === originMonthFilter
    )), [expiredRows, originMonthFilter]);

    const displayedEligibleKeys = useMemo(() => new Set(displayedEligibleRows.map((row) => row.sourceKey)), [displayedEligibleRows]);
    const displayedSelectedCount = useMemo(() => (
        displayedEligibleRows.filter((row) => selectedKeys.has(row.sourceKey)).length
    ), [displayedEligibleRows, selectedKeys]);
    const selectedRows = useMemo(() => displayedEligibleRows.filter((row) => selectedKeys.has(row.sourceKey)), [displayedEligibleRows, selectedKeys]);
    const selectedTotals = useMemo(() => sumRows(selectedRows), [selectedRows]);
    const pendingTotals = useMemo(() => sumRows(displayedEligibleRows), [displayedEligibleRows]);
    const expiredTotals = useMemo(() => sumRows(displayedExpiredRows), [displayedExpiredRows]);

    const allVatRows = useMemo(() => (
        buildVatRows(data)
            .filter((row) => allowedBranchIds.includes(row.branchId))
            .sort((a, b) => `${a.date}-${a.document}`.localeCompare(`${b.date}-${b.document}`))
    ), [allowedBranchIds, data]);

    const visibleVatRows = useMemo(() => allVatRows.filter((row) => (
        branchFilter === CONSOLIDATED_BRANCH_ID || row.branchId === branchFilter
    )), [allVatRows, branchFilter]);

    const pendingVatRows = useMemo(() => visibleVatRows
        .map((row) => ({
            ...row,
            ageMonths: monthDiff(row.month, declarationMonth),
            isDeclared: row.vatDeclared || declaredVatKeys.has(row.sourceKey),
        }))
        .filter((row) => !row.isDeclared && row.ageMonths >= 0), [declarationMonth, declaredVatKeys, visibleVatRows]);

    const typedPendingVatRows = useMemo(() => pendingVatRows.filter((row) => (
        vatTypeFilter === 'all' || row.vatType === vatTypeFilter
    )), [pendingVatRows, vatTypeFilter]);

    const eligibleVatRows = useMemo(() => typedPendingVatRows
        .filter((row) => row.ageMonths < MAX_DECLARATION_AGE_MONTHS), [typedPendingVatRows]);

    const expiredVatRows = useMemo(() => typedPendingVatRows
        .filter((row) => row.ageMonths >= MAX_DECLARATION_AGE_MONTHS), [typedPendingVatRows]);

    const vatOriginMonthOptions = useMemo(() => (
        [...new Set(typedPendingVatRows.map((row) => row.month).filter(Boolean))]
            .sort((a, b) => String(b).localeCompare(String(a)))
    ), [typedPendingVatRows]);

    const displayedEligibleVatRows = useMemo(() => eligibleVatRows.filter((row) => (
        originMonthFilter === 'all' || row.month === originMonthFilter
    )), [eligibleVatRows, originMonthFilter]);

    const displayedExpiredVatRows = useMemo(() => expiredVatRows.filter((row) => (
        originMonthFilter === 'all' || row.month === originMonthFilter
    )), [expiredVatRows, originMonthFilter]);

    const displayedEligibleVatKeys = useMemo(() => new Set(displayedEligibleVatRows.map((row) => row.sourceKey)), [displayedEligibleVatRows]);
    const displayedSelectedVatCount = useMemo(() => (
        displayedEligibleVatRows.filter((row) => selectedVatKeys.has(row.sourceKey)).length
    ), [displayedEligibleVatRows, selectedVatKeys]);
    const selectedVatRows = useMemo(() => displayedEligibleVatRows.filter((row) => selectedVatKeys.has(row.sourceKey)), [displayedEligibleVatRows, selectedVatKeys]);
    const selectedSoldVatRows = useMemo(() => selectedVatRows.filter((row) => row.vatType === 'sold'), [selectedVatRows]);
    const selectedPurchasedVatRows = useMemo(() => selectedVatRows.filter((row) => row.vatType === 'purchased'), [selectedVatRows]);
    const selectedVatTotals = useMemo(() => sumVatRows(selectedVatRows), [selectedVatRows]);
    const pendingVatTotals = useMemo(() => sumVatRows(displayedEligibleVatRows), [displayedEligibleVatRows]);
    const expiredVatTotals = useMemo(() => sumVatRows(displayedExpiredVatRows), [displayedExpiredVatRows]);

    const allStampedInvoiceRows = useMemo(() => (
        buildStampedInvoiceRows(data)
            .filter((row) => allowedBranchIds.includes(row.branchId))
            .sort((a, b) => `${a.date}-${a.document}`.localeCompare(`${b.date}-${b.document}`))
    ), [allowedBranchIds, data]);

    const visibleStampedInvoiceRows = useMemo(() => allStampedInvoiceRows.filter((row) => (
        branchFilter === CONSOLIDATED_BRANCH_ID || row.branchId === branchFilter
    )), [allStampedInvoiceRows, branchFilter]);

    const pendingStampedInvoiceRows = useMemo(() => visibleStampedInvoiceRows
        .map((row) => ({
            ...row,
            ageMonths: monthDiff(row.month, declarationMonth),
            isDeclared: row.declared || declaredStampedInvoiceKeys.has(row.sourceKey),
        }))
        .filter((row) => !row.isDeclared && row.ageMonths >= 0), [declarationMonth, declaredStampedInvoiceKeys, visibleStampedInvoiceRows]);

    const eligibleStampedInvoiceRows = useMemo(() => pendingStampedInvoiceRows
        .filter((row) => row.ageMonths < MAX_DECLARATION_AGE_MONTHS), [pendingStampedInvoiceRows]);

    const expiredStampedInvoiceRows = useMemo(() => pendingStampedInvoiceRows
        .filter((row) => row.ageMonths >= MAX_DECLARATION_AGE_MONTHS), [pendingStampedInvoiceRows]);

    const stampedInvoiceOriginMonthOptions = useMemo(() => (
        [...new Set(pendingStampedInvoiceRows.map((row) => row.month).filter(Boolean))]
            .sort((a, b) => String(b).localeCompare(String(a)))
    ), [pendingStampedInvoiceRows]);

    const displayedEligibleStampedInvoiceRows = useMemo(() => eligibleStampedInvoiceRows.filter((row) => (
        originMonthFilter === 'all' || row.month === originMonthFilter
    )), [eligibleStampedInvoiceRows, originMonthFilter]);

    const displayedExpiredStampedInvoiceRows = useMemo(() => expiredStampedInvoiceRows.filter((row) => (
        originMonthFilter === 'all' || row.month === originMonthFilter
    )), [expiredStampedInvoiceRows, originMonthFilter]);

    const displayedEligibleStampedInvoiceKeys = useMemo(() => new Set(displayedEligibleStampedInvoiceRows.map((row) => row.sourceKey)), [displayedEligibleStampedInvoiceRows]);
    const displayedSelectedStampedInvoiceCount = useMemo(() => (
        displayedEligibleStampedInvoiceRows.filter((row) => selectedStampedInvoiceKeys.has(row.sourceKey)).length
    ), [displayedEligibleStampedInvoiceRows, selectedStampedInvoiceKeys]);
    const selectedStampedInvoiceRows = useMemo(() => (
        displayedEligibleStampedInvoiceRows.filter((row) => selectedStampedInvoiceKeys.has(row.sourceKey))
    ), [displayedEligibleStampedInvoiceRows, selectedStampedInvoiceKeys]);
    const selectedStampedInvoiceTotals = useMemo(() => sumStampedInvoiceRows(selectedStampedInvoiceRows), [selectedStampedInvoiceRows]);
    const pendingStampedInvoiceTotals = useMemo(() => sumStampedInvoiceRows(displayedEligibleStampedInvoiceRows), [displayedEligibleStampedInvoiceRows]);
    const expiredStampedInvoiceTotals = useMemo(() => sumStampedInvoiceRows(displayedExpiredStampedInvoiceRows), [displayedExpiredStampedInvoiceRows]);

    const originMonthOptionsForActiveModule = moduleTab === DECLARATION_MODULES.IVA
        ? vatOriginMonthOptions
        : moduleTab === DECLARATION_MODULES.STAMPED_INVOICES
            ? stampedInvoiceOriginMonthOptions
            : originMonthOptions;

    useEffect(() => {
        setSelectedKeys((current) => new Set([...current].filter((key) => eligibleRows.some((row) => row.sourceKey === key))));
    }, [eligibleRows]);

    useEffect(() => {
        setSelectedVatKeys((current) => new Set([...current].filter((key) => eligibleVatRows.some((row) => row.sourceKey === key))));
    }, [eligibleVatRows]);

    useEffect(() => {
        setSelectedStampedInvoiceKeys((current) => new Set([...current].filter((key) => eligibleStampedInvoiceRows.some((row) => row.sourceKey === key))));
    }, [eligibleStampedInvoiceRows]);

    const toggleRow = (row) => {
        setSelectedKeys((current) => {
            const next = new Set(current);
            if (next.has(row.sourceKey)) next.delete(row.sourceKey);
            else next.add(row.sourceKey);
            return next;
        });
    };

    const toggleAll = () => {
        setSelectedKeys((current) => {
            const allVisibleSelected = displayedEligibleRows.length > 0
                && displayedEligibleRows.every((row) => current.has(row.sourceKey));
            const next = new Set(current);
            if (allVisibleSelected) {
                displayedEligibleKeys.forEach((key) => next.delete(key));
            } else {
                displayedEligibleRows.forEach((row) => next.add(row.sourceKey));
            }
            return next;
        });
    };

    const toggleVatRow = (row) => {
        setSelectedVatKeys((current) => {
            const next = new Set(current);
            if (next.has(row.sourceKey)) next.delete(row.sourceKey);
            else next.add(row.sourceKey);
            return next;
        });
    };

    const toggleAllVat = () => {
        setSelectedVatKeys((current) => {
            const allVisibleSelected = displayedEligibleVatRows.length > 0
                && displayedEligibleVatRows.every((row) => current.has(row.sourceKey));
            const next = new Set(current);
            if (allVisibleSelected) {
                displayedEligibleVatKeys.forEach((key) => next.delete(key));
            } else {
                displayedEligibleVatRows.forEach((row) => next.add(row.sourceKey));
            }
            return next;
        });
    };

    const toggleStampedInvoiceRow = (row) => {
        setSelectedStampedInvoiceKeys((current) => {
            const next = new Set(current);
            if (next.has(row.sourceKey)) next.delete(row.sourceKey);
            else next.add(row.sourceKey);
            return next;
        });
    };

    const toggleAllStampedInvoices = () => {
        setSelectedStampedInvoiceKeys((current) => {
            const allVisibleSelected = displayedEligibleStampedInvoiceRows.length > 0
                && displayedEligibleStampedInvoiceRows.every((row) => current.has(row.sourceKey));
            const next = new Set(current);
            if (allVisibleSelected) {
                displayedEligibleStampedInvoiceKeys.forEach((key) => next.delete(key));
            } else {
                displayedEligibleStampedInvoiceRows.forEach((row) => next.add(row.sourceKey));
            }
            return next;
        });
    };

    const selectModuleTab = (nextModuleTab) => {
        setModuleTab(nextModuleTab);
        setActiveTab('pendientes');
        setOriginMonthFilter('all');
        setVatTypeFilter('all');
    };

    const handlePrintPreDeclaration = () => {
        document.body.classList.add('print-retention-predeclaration');
        const cleanup = () => document.body.classList.remove('print-retention-predeclaration');
        window.addEventListener('afterprint', cleanup, { once: true });
        window.print();
        window.setTimeout(cleanup, 1000);
    };

    const handleDeclare = async () => {
        if (!selectedRows.length) {
            window.alert('Selecciona al menos una retencion para declarar.');
            return;
        }

        const confirmed = window.confirm(`Vas a declarar ${selectedRows.length} documento(s) por ${fmt(selectedTotals.retentionTotal)} en ${declarationMonth}. Deseas continuar?`);
        if (!confirmed) return;

        setDeclaring(true);
        try {
            const declarationId = `retenciones_${declarationMonth}_${Date.now()}`;
            const batch = writeBatch(db);
            const declarationRef = doc(collection(db, DECLARATIONS_COLLECTION), declarationId);
            const items = selectedRows.map((row) => ({
                sourceKey: row.sourceKey,
                sourceId: row.sourceId,
                sourceCollection: row.sourceCollection,
                sourceType: row.sourceType,
                date: row.date,
                month: row.month,
                branchId: row.branchId,
                branchName: row.branchName,
                document: row.document,
                client: row.client,
                subtotal: peso(row.subtotal),
                total: peso(row.total),
                retentionIr2: peso(row.retentionIr2),
                retentionTotal: peso(row.retentionIr2),
                supportStatus: row.supportStatus,
            }));

            batch.set(declarationRef, {
                id: declarationId,
                status: 'declarada',
                declarationMonth,
                branchFilter,
                itemCount: items.length,
                totals: selectedTotals,
                items,
                createdAt: serverTimestamp(),
                declaredAt: serverTimestamp(),
            });

            selectedRows.forEach((row) => {
                batch.set(doc(db, row.sourceCollection, row.sourceId), {
                    retentionDeclared: true,
                    retentionDeclarationStatus: 'declarada',
                    retentionDeclarationId: declarationId,
                    retentionDeclaredMonth: declarationMonth,
                    retentionDeclaredAt: serverTimestamp(),
                }, { merge: true });
            });

            await batch.commit();
            setSelectedKeys(new Set());
            window.alert('Declaracion registrada. Las retenciones seleccionadas ya no apareceran como pendientes.');
        } catch (error) {
            console.error('Error declarando retenciones:', error);
            window.alert(`No se pudo declarar: ${error.message}`);
        } finally {
            setDeclaring(false);
        }
    };

    const handleDeclareVat = async () => {
        if (!selectedVatRows.length) {
            window.alert('Selecciona al menos un documento con IVA para declarar.');
            return;
        }

        const netLabel = selectedVatTotals.netVat >= 0 ? 'IVA a pagar' : 'saldo a favor';
        const confirmed = window.confirm(`Vas a declarar IVA de ${selectedVatRows.length} documento(s). ${netLabel}: ${fmt(Math.abs(selectedVatTotals.netVat))} en ${declarationMonth}. Deseas continuar?`);
        if (!confirmed) return;

        setDeclaringVat(true);
        try {
            const declarationId = `iva_${declarationMonth}_${Date.now()}`;
            const batch = writeBatch(db);
            const declarationRef = doc(collection(db, VAT_DECLARATIONS_COLLECTION), declarationId);
            const totals = {
                ...selectedVatTotals,
                vatPayable: Math.max(selectedVatTotals.netVat, 0),
                vatCredit: Math.max(selectedVatTotals.netVat * -1, 0),
            };
            const items = selectedVatRows.map((row) => ({
                sourceKey: row.sourceKey,
                sourceId: row.sourceId,
                sourceCollection: row.sourceCollection,
                sourceType: row.sourceType,
                vatType: row.vatType,
                date: row.date,
                month: row.month,
                branchId: row.branchId,
                branchName: row.branchName,
                document: row.document,
                party: row.party,
                subtotal: peso(row.subtotal),
                iva: peso(row.iva),
                total: peso(row.total),
            }));

            batch.set(declarationRef, {
                id: declarationId,
                status: 'declarada',
                declarationMonth,
                branchFilter,
                itemCount: items.length,
                totals,
                items,
                createdAt: serverTimestamp(),
                declaredAt: serverTimestamp(),
            });

            selectedVatRows.forEach((row) => {
                batch.set(doc(db, row.sourceCollection, row.sourceId), {
                    vatDeclared: true,
                    vatDeclarationStatus: 'declarada',
                    vatDeclarationId: declarationId,
                    vatDeclaredMonth: declarationMonth,
                    vatDeclaredAt: serverTimestamp(),
                }, { merge: true });
            });

            await batch.commit();
            setSelectedVatKeys(new Set());
            window.alert('Declaracion IVA registrada. Los documentos seleccionados ya no apareceran como pendientes.');
        } catch (error) {
            console.error('Error declarando IVA:', error);
            window.alert(`No se pudo declarar IVA: ${error.message}`);
        } finally {
            setDeclaringVat(false);
        }
    };

    const handleDeclareStampedInvoices = async () => {
        if (!selectedStampedInvoiceRows.length) {
            window.alert('Selecciona al menos una factura membretada para declarar.');
            return;
        }

        const confirmed = window.confirm(`Vas a declarar ${selectedStampedInvoiceRows.length} factura(s) membretada(s) por ${fmt(selectedStampedInvoiceTotals.total)} en ${declarationMonth}. Deseas continuar?`);
        if (!confirmed) return;

        setDeclaringStampedInvoices(true);
        try {
            const declarationId = `facturas_membretadas_${declarationMonth}_${Date.now()}`;
            const batch = writeBatch(db);
            const declarationRef = doc(collection(db, STAMPED_INVOICE_DECLARATIONS_COLLECTION), declarationId);
            const items = selectedStampedInvoiceRows.map((row) => ({
                sourceKey: row.sourceKey,
                sourceId: row.sourceId,
                sourceCollection: row.sourceCollection,
                sourceType: row.sourceType,
                date: row.date,
                month: row.month,
                branchId: row.branchId,
                branchName: row.branchName,
                document: row.document,
                client: row.client,
                paymentMethod: row.paymentMethod,
                subtotal: peso(row.subtotal),
                iva: peso(row.iva),
                total: peso(row.total),
                retentionIr2: peso(row.retentionIr2),
                retentionMunicipal1: peso(row.retentionMunicipal1),
                retentionTotal: peso(row.retentionTotal),
                netTotal: peso(row.netTotal),
            }));

            batch.set(declarationRef, {
                id: declarationId,
                status: 'declarada',
                declarationMonth,
                branchFilter,
                itemCount: items.length,
                totals: selectedStampedInvoiceTotals,
                items,
                createdAt: serverTimestamp(),
                declaredAt: serverTimestamp(),
            });

            selectedStampedInvoiceRows.forEach((row) => {
                batch.set(doc(db, row.sourceCollection, row.sourceId), {
                    stampedInvoiceDeclared: true,
                    stampedInvoiceDeclarationStatus: 'declarada',
                    stampedInvoiceDeclarationId: declarationId,
                    stampedInvoiceDeclaredMonth: declarationMonth,
                    stampedInvoiceDeclaredAt: serverTimestamp(),
                }, { merge: true });
            });

            await batch.commit();
            setSelectedStampedInvoiceKeys(new Set());
            window.alert('Declaracion de facturas membretadas registrada. Las facturas seleccionadas ya no apareceran como pendientes.');
        } catch (error) {
            console.error('Error declarando facturas membretadas:', error);
            window.alert(`No se pudo declarar facturas membretadas: ${error.message}`);
        } finally {
            setDeclaringStampedInvoices(false);
        }
    };

    const historyTotals = useMemo(() => declarations.reduce((acc, declaration) => ({
        retentionIr2: acc.retentionIr2 + peso(declaration.totals?.retentionIr2),
        retentionTotal: acc.retentionTotal + peso(declaration.totals?.retentionIr2 || declaration.totals?.retentionTotal),
        itemCount: acc.itemCount + peso(declaration.itemCount),
    }), { retentionIr2: 0, retentionTotal: 0, itemCount: 0 }), [declarations]);

    const vatHistoryTotals = useMemo(() => vatDeclarations.reduce((acc, declaration) => ({
        soldVat: acc.soldVat + peso(declaration.totals?.soldVat),
        purchasedVat: acc.purchasedVat + peso(declaration.totals?.purchasedVat),
        netVat: acc.netVat + peso(declaration.totals?.netVat),
        itemCount: acc.itemCount + peso(declaration.itemCount),
    }), { soldVat: 0, purchasedVat: 0, netVat: 0, itemCount: 0 }), [vatDeclarations]);

    const stampedInvoiceHistoryTotals = useMemo(() => stampedInvoiceDeclarations.reduce((acc, declaration) => ({
        subtotal: acc.subtotal + peso(declaration.totals?.subtotal),
        iva: acc.iva + peso(declaration.totals?.iva),
        total: acc.total + peso(declaration.totals?.total),
        retentionTotal: acc.retentionTotal + peso(declaration.totals?.retentionTotal),
        netTotal: acc.netTotal + peso(declaration.totals?.netTotal),
        itemCount: acc.itemCount + peso(declaration.itemCount),
    }), { subtotal: 0, iva: 0, total: 0, retentionTotal: 0, netTotal: 0, itemCount: 0 }), [stampedInvoiceDeclarations]);

    return (
        <div className="space-y-5">
            <style>{`
                @media print {
                    body.print-retention-predeclaration * { visibility: hidden !important; }
                    body.print-retention-predeclaration .retention-predeclaration-report,
                    body.print-retention-predeclaration .retention-predeclaration-report * { visibility: visible !important; }
                    body.print-retention-predeclaration .retention-predeclaration-report {
                        position: absolute !important;
                        inset: 0 auto auto 0 !important;
                        width: 100% !important;
                        border: 0 !important;
                        box-shadow: none !important;
                    }
                    body.print-retention-predeclaration .no-print { display: none !important; }
                    @page { size: letter portrait; margin: 0.45in; }
                }
            `}</style>

            <section className="no-print overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
                <div className="bg-slate-950 px-5 py-5 text-white">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.38em] text-[#f5b51b]">{APP_BRAND_NAME}</div>
                            <h1 className="mt-1 text-2xl font-black tracking-tight">Declaraciones</h1>
                            <p className="mt-1 max-w-3xl text-sm font-semibold text-white/65">
                                Control de retenciones de anticipo IR que nos hicieron sobre ventas. Lo no declarado se arrastra al siguiente mes hasta 6 meses.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-white/80">
                                Pre declaracion fiscal
                            </span>
                            <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-emerald-100">
                                Ventas
                            </span>
                        </div>
                    </div>
                </div>

                <div className="grid gap-2 border-t border-slate-200 p-4 sm:grid-cols-3">
                    <button
                        type="button"
                        onClick={() => selectModuleTab(DECLARATION_MODULES.RETENTION_IR)}
                        className={`rounded-2xl px-4 py-3 text-left transition ${moduleTab === DECLARATION_MODULES.RETENTION_IR ? 'bg-[#e30613] text-white shadow-sm shadow-red-900/20' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                    >
                        <div className="text-[10px] font-black uppercase tracking-[0.24em] opacity-75">Submodulo</div>
                        <div className="mt-1 text-sm font-black">Retenciones IR</div>
                        <div className="mt-0.5 text-xs font-semibold opacity-70">Anticipo IR 2% sobre ventas.</div>
                    </button>
                    <button
                        type="button"
                        onClick={() => selectModuleTab(DECLARATION_MODULES.IVA)}
                        className={`rounded-2xl px-4 py-3 text-left transition ${moduleTab === DECLARATION_MODULES.IVA ? 'bg-sky-600 text-white shadow-sm shadow-sky-900/20' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                    >
                        <div className="text-[10px] font-black uppercase tracking-[0.24em] opacity-75">Submodulo</div>
                        <div className="mt-1 text-sm font-black">Declaracion IVA</div>
                        <div className="mt-0.5 text-xs font-semibold opacity-70">IVA comprado vs. IVA vendido de facturas membretadas.</div>
                    </button>
                    <button
                        type="button"
                        onClick={() => selectModuleTab(DECLARATION_MODULES.STAMPED_INVOICES)}
                        className={`rounded-2xl px-4 py-3 text-left transition ${moduleTab === DECLARATION_MODULES.STAMPED_INVOICES ? 'bg-slate-950 text-white shadow-sm shadow-slate-900/20' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                    >
                        <div className="text-[10px] font-black uppercase tracking-[0.24em] opacity-75">Submodulo</div>
                        <div className="mt-1 text-sm font-black">Facturas membretadas</div>
                        <div className="mt-0.5 text-xs font-semibold opacity-70">Control de facturas ya declaradas.</div>
                    </button>
                </div>

                <div className="grid gap-3 border-t border-slate-200 p-4 lg:grid-cols-[190px_190px_190px_190px_1fr]">
                    <label className="space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Mes a declarar</span>
                        <input
                            type="month"
                            value={declarationMonth}
                            onChange={(event) => setDeclarationMonth(event.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-black text-slate-900 outline-none focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15"
                        />
                    </label>
                    <label className="space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Sucursal</span>
                        <select
                            value={branchFilter}
                            onChange={(event) => setBranchFilter(event.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-black text-slate-900 outline-none focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15"
                        >
                            {branchOptions.map((branch) => (
                                <option key={branch.id} value={branch.id}>
                                    {branch.id === CONSOLIDATED_BRANCH_ID ? branch.shortName : `${branch.shortName} - Serie ${branch.invoiceSeries}`}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Mes origen</span>
                        <select
                            value={originMonthFilter}
                            onChange={(event) => setOriginMonthFilter(event.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-black text-slate-900 outline-none focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15"
                        >
                            <option value="all">Ultimos 6 meses</option>
                            {originMonthOptionsForActiveModule.map((month) => (
                                <option key={month} value={month}>{month}</option>
                            ))}
                        </select>
                    </label>
                    {moduleTab === DECLARATION_MODULES.IVA && (
                        <label className="space-y-1">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Tipo IVA</span>
                            <select
                                value={vatTypeFilter}
                                onChange={(event) => setVatTypeFilter(event.target.value)}
                                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-black text-slate-900 outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-600/15"
                            >
                                <option value="all">Todos</option>
                                <option value="sold">Vendido</option>
                                <option value="purchased">Comprado</option>
                            </select>
                        </label>
                    )}
                    <div className="flex flex-wrap items-end gap-2">
                        <button
                            type="button"
                            onClick={() => setActiveTab('pendientes')}
                            className={`rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-[0.16em] transition ${activeTab === 'pendientes' ? 'bg-[#e30613] text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                        >
                            Por declarar
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('historial')}
                            className={`rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-[0.16em] transition ${activeTab === 'historial' ? 'bg-[#e30613] text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                        >
                            Historial
                        </button>
                    </div>
                </div>
            </section>

            {moduleTab === DECLARATION_MODULES.RETENTION_IR && activeTab === 'pendientes' && (
                <div className="space-y-5">
                    <div className="grid gap-3 md:grid-cols-3">
                        <StatCard label="Pendientes visibles" value={displayedEligibleRows.length} tone="blue" help={originMonthFilter === 'all' ? `${MAX_DECLARATION_AGE_MONTHS} meses maximo` : `Origen ${originMonthFilter}`} />
                        <StatCard label="Retencion IR 2%" value={fmt(pendingTotals.retentionIr2)} tone="green" />
                        <StatCard label="Total IR pendiente" value={fmt(pendingTotals.retentionTotal)} tone="slate" />
                    </div>

                    {displayedExpiredRows.length > 0 && (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">
                            <div className="flex items-center gap-2">
                                <Icon path={Icons.alert} />
                                Hay {displayedExpiredRows.length} retencion(es) fuera del plazo de 6 meses por {fmt(expiredTotals.retentionTotal)}. Revisalas antes de cerrar declaraciones.
                            </div>
                        </div>
                    )}

                    <Card className="overflow-hidden">
                        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#e30613]">Bandeja fiscal</div>
                                <h2 className="mt-1 text-lg font-black text-slate-950">Retenciones de ventas por declarar</h2>
                                <p className="mt-1 text-xs font-semibold text-slate-500">
                                    Selecciona las retenciones que vas a declarar en {declarationMonth}. Las no seleccionadas seguiran pendientes para el siguiente mes.
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={toggleAll} disabled={!displayedEligibleRows.length} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-slate-700 transition hover:bg-slate-100 disabled:opacity-50">
                                    {displayedSelectedCount === displayedEligibleRows.length && displayedEligibleRows.length ? 'Limpiar seleccion visible' : 'Seleccionar visible'}
                                </button>
                                <button type="button" onClick={handlePrintPreDeclaration} disabled={!selectedRows.length} className="inline-flex items-center gap-2 rounded-xl border border-[#e30613] bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-[#e30613] transition hover:bg-[#fff1f2] disabled:opacity-50">
                                    <Icon path={Icons.printer} />
                                    Reporte pre declaracion
                                </button>
                                <button type="button" onClick={handleDeclare} disabled={declaring || !selectedRows.length} className="inline-flex items-center gap-2 rounded-xl bg-[#e30613] px-4 py-2 text-xs font-black uppercase tracking-wider text-white shadow-sm shadow-red-900/20 transition hover:bg-[#9f111a] disabled:opacity-50">
                                    <Icon path={Icons.check} />
                                    {declaring ? 'Declarando...' : 'Declarar seleccionadas'}
                                </button>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-slate-100 text-sm">
                                <thead className="bg-white">
                                    <tr className="text-left text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                                        <th className="px-5 py-3">Sel.</th>
                                        <th className="px-5 py-3">Documento</th>
                                        <th className="px-5 py-3">Cliente</th>
                                        <th className="px-5 py-3">Mes origen</th>
                                        <th className="px-5 py-3">Soportes</th>
                                        <th className="px-5 py-3 text-right">IR 2%</th>
                                        <th className="px-5 py-3 text-right">Total IR</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 bg-white">
                                    {displayedEligibleRows.map((row) => (
                                        <tr key={row.sourceKey} className="transition hover:bg-slate-50">
                                            <td className="px-5 py-3">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedKeys.has(row.sourceKey)}
                                                    onChange={() => toggleRow(row)}
                                                    className="h-4 w-4 accent-[#e30613]"
                                                />
                                            </td>
                                            <td className="px-5 py-3">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <div className="font-black text-slate-950">{row.document || '-'}</div>
                                                    <SourceBadge row={row} />
                                                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-slate-500">{row.branchName}</span>
                                                </div>
                                                <div className="mt-1 text-xs font-bold text-slate-400">{row.date}</div>
                                            </td>
                                            <td className="px-5 py-3 font-bold text-slate-700">{row.client}</td>
                                            <td className="px-5 py-3">
                                                <div className="font-mono font-black text-slate-900">{row.month}</div>
                                                <div className="text-xs font-semibold text-slate-400">
                                                    {Math.max(MAX_DECLARATION_AGE_MONTHS - row.ageMonths, 0)} mes(es) de plazo
                                                </div>
                                            </td>
                                            <td className="px-5 py-3">
                                                <div className="flex flex-wrap gap-1">
                                                    {row.retentionIr2 > 0 && <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${row.supportStatus.ir ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>IR</span>}
                                                </div>
                                            </td>
                                            <td className="px-5 py-3 text-right font-mono font-black text-emerald-700">{fmt(row.retentionIr2)}</td>
                                            <td className="px-5 py-3 text-right font-mono font-black text-slate-950">{fmt(row.retentionTotal)}</td>
                                        </tr>
                                    ))}
                                    {displayedEligibleRows.length === 0 && (
                                        <tr>
                                            <td colSpan={7} className="px-5 py-10 text-center text-sm font-bold text-slate-400">
                                                No hay retenciones pendientes para declarar en este mes y sucursal.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </Card>

                    <Card className="retention-predeclaration-report overflow-hidden">
                        <div className="border-b border-slate-200 bg-white px-6 py-5">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex items-center gap-4">
                                    <img src={APP_BRAND_LOGO} alt={APP_BRAND_NAME} className="h-16 w-16 rounded-2xl border border-slate-200 object-contain p-2" />
                                    <div>
                                        <div className="text-[10px] font-black uppercase tracking-[0.34em] text-[#e30613]">{APP_BRAND_NAME}</div>
                                        <h2 className="mt-1 text-xl font-black text-slate-950">Reporte Pre Declaracion de Retenciones</h2>
                                        <p className="text-xs font-bold text-slate-500">Periodo: {declarationMonth} - Sucursal: {branchFilter === CONSOLIDATED_BRANCH_ID ? 'Todas' : getBranchById(branchFilter).shortName}</p>
                                    </div>
                                </div>
                                <div className="text-right text-xs font-bold text-slate-500">
                                    Generado: {new Date().toLocaleDateString('es-NI')}
                                </div>
                            </div>
                        </div>
                        <div className="p-6">
                            <div className="mb-5 grid gap-3 sm:grid-cols-2">
                                <StatCard label="IR 2%" value={fmt(selectedTotals.retentionIr2)} tone="green" />
                                <StatCard label="Total IR a declarar" value={fmt(selectedTotals.retentionTotal)} tone="slate" />
                            </div>
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b border-slate-300 text-left font-black uppercase tracking-[0.16em] text-slate-500">
                                        <th className="py-2">Fecha</th>
                                        <th className="py-2">Documento</th>
                                        <th className="py-2">Cliente</th>
                                        <th className="py-2">Sucursal</th>
                                        <th className="py-2 text-right">IR 2%</th>
                                        <th className="py-2 text-right">Total IR</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {selectedRows.map((row) => (
                                        <tr key={`report-${row.sourceKey}`} className="border-b border-slate-100">
                                            <td className="py-2 font-semibold">{row.date}</td>
                                            <td className="py-2 font-black">{row.document}</td>
                                            <td className="py-2 font-semibold">{row.client}</td>
                                            <td className="py-2 font-semibold">{row.branchName}</td>
                                            <td className="py-2 text-right font-mono font-bold">{fmt(row.retentionIr2)}</td>
                                            <td className="py-2 text-right font-mono font-black">{fmt(row.retentionTotal)}</td>
                                        </tr>
                                    ))}
                                    {!selectedRows.length && (
                                        <tr>
                                            <td colSpan={6} className="py-8 text-center font-bold text-slate-400">
                                                Selecciona retenciones para generar este reporte.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                            <div className="mt-8 grid gap-8 text-xs font-bold text-slate-600 sm:grid-cols-2">
                                <div className="border-t border-slate-400 pt-2">Preparado por</div>
                                <div className="border-t border-slate-400 pt-2">Revisado por</div>
                            </div>
                        </div>
                    </Card>
                </div>
            )}

            {moduleTab === DECLARATION_MODULES.IVA && activeTab === 'pendientes' && (
                <div className="space-y-5">
                    <div className="grid gap-3 md:grid-cols-4">
                        <StatCard label="Documentos IVA visibles" value={displayedEligibleVatRows.length} tone="blue" help={originMonthFilter === 'all' ? `${MAX_DECLARATION_AGE_MONTHS} meses maximo` : `Origen ${originMonthFilter}`} />
                        <StatCard label="IVA vendido" value={fmt(pendingVatTotals.soldVat)} tone="green" />
                        <StatCard label="IVA comprado" value={fmt(pendingVatTotals.purchasedVat)} tone="amber" />
                        <StatCard
                            label={pendingVatTotals.netVat >= 0 ? 'IVA a pagar' : 'Saldo a favor'}
                            value={fmt(Math.abs(pendingVatTotals.netVat))}
                            tone={pendingVatTotals.netVat >= 0 ? 'red' : 'green'}
                        />
                    </div>

                    {displayedExpiredVatRows.length > 0 && (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">
                            <div className="flex items-center gap-2">
                                <Icon path={Icons.alert} />
                                Hay {displayedExpiredVatRows.length} documento(s) con IVA fuera del plazo de 6 meses por {fmt(expiredVatTotals.netVat)} neto. Revisalos antes de cerrar declaraciones.
                            </div>
                        </div>
                    )}

                    <Card className="overflow-hidden">
                        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.28em] text-sky-600">Bandeja IVA</div>
                                <h2 className="mt-1 text-lg font-black text-slate-950">IVA comprado y vendido por declarar</h2>
                                <p className="mt-1 text-xs font-semibold text-slate-500">
                                    El IVA vendido sale de facturas membretadas. El IVA comprado sale de compras y gastos registrados.
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={toggleAllVat} disabled={!displayedEligibleVatRows.length} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-slate-700 transition hover:bg-slate-100 disabled:opacity-50">
                                    {displayedSelectedVatCount === displayedEligibleVatRows.length && displayedEligibleVatRows.length ? 'Limpiar seleccion visible' : 'Seleccionar visible'}
                                </button>
                                <button type="button" onClick={handlePrintPreDeclaration} disabled={!selectedVatRows.length} className="inline-flex items-center gap-2 rounded-xl border border-sky-600 bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-sky-700 transition hover:bg-sky-50 disabled:opacity-50">
                                    <Icon path={Icons.printer} />
                                    Reporte pre declaracion
                                </button>
                                <button type="button" onClick={handleDeclareVat} disabled={declaringVat || !selectedVatRows.length} className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-xs font-black uppercase tracking-wider text-white shadow-sm shadow-sky-900/20 transition hover:bg-sky-700 disabled:opacity-50">
                                    <Icon path={Icons.check} />
                                    {declaringVat ? 'Declarando...' : 'Declarar IVA'}
                                </button>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-slate-100 text-sm">
                                <thead className="bg-white">
                                    <tr className="text-left text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                                        <th className="px-5 py-3">Sel.</th>
                                        <th className="px-5 py-3">Documento</th>
                                        <th className="px-5 py-3">Tipo</th>
                                        <th className="px-5 py-3">Cliente / proveedor</th>
                                        <th className="px-5 py-3">Mes origen</th>
                                        <th className="px-5 py-3 text-right">Subtotal</th>
                                        <th className="px-5 py-3 text-right">IVA</th>
                                        <th className="px-5 py-3 text-right">Total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 bg-white">
                                    {displayedEligibleVatRows.map((row) => (
                                        <tr key={row.sourceKey} className="transition hover:bg-slate-50">
                                            <td className="px-5 py-3">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedVatKeys.has(row.sourceKey)}
                                                    onChange={() => toggleVatRow(row)}
                                                    className="h-4 w-4 accent-sky-600"
                                                />
                                            </td>
                                            <td className="px-5 py-3">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <div className="font-black text-slate-950">{row.document || '-'}</div>
                                                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-slate-500">{row.branchName}</span>
                                                </div>
                                                <div className="mt-1 text-xs font-bold text-slate-400">{row.date || '-'}</div>
                                            </td>
                                            <td className="px-5 py-3">
                                                <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${row.vatType === 'sold' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                                    {row.vatType === 'sold' ? 'Vendido' : 'Comprado'}
                                                </span>
                                                <div className="mt-1 text-xs font-bold text-slate-400">{row.sourceType}</div>
                                            </td>
                                            <td className="px-5 py-3 font-bold text-slate-700">{row.party}</td>
                                            <td className="px-5 py-3">
                                                <div className="font-mono font-black text-slate-900">{row.month}</div>
                                                <div className="text-xs font-semibold text-slate-400">
                                                    {Math.max(MAX_DECLARATION_AGE_MONTHS - row.ageMonths, 0)} mes(es) de plazo
                                                </div>
                                            </td>
                                            <td className="px-5 py-3 text-right font-mono font-bold text-slate-700">{fmt(row.subtotal)}</td>
                                            <td className="px-5 py-3 text-right font-mono font-black text-sky-700">{fmt(row.iva)}</td>
                                            <td className="px-5 py-3 text-right font-mono font-black text-slate-950">{fmt(row.total)}</td>
                                        </tr>
                                    ))}
                                    {displayedEligibleVatRows.length === 0 && (
                                        <tr>
                                            <td colSpan={8} className="px-5 py-10 text-center text-sm font-bold text-slate-400">
                                                No hay IVA pendiente para declarar en este mes y sucursal.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </Card>

                    <Card className="retention-predeclaration-report overflow-hidden">
                        <div className="border-b border-slate-200 bg-white px-6 py-5">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex items-center gap-4">
                                    <img src={APP_BRAND_LOGO} alt={APP_BRAND_NAME} className="h-16 w-16 rounded-2xl border border-slate-200 object-contain p-2" />
                                    <div>
                                        <div className="text-[10px] font-black uppercase tracking-[0.34em] text-sky-600">{APP_BRAND_NAME}</div>
                                        <h2 className="mt-1 text-xl font-black text-slate-950">Reporte Pre Declaracion IVA</h2>
                                        <p className="text-xs font-bold text-slate-500">Periodo: {declarationMonth} - Sucursal: {branchFilter === CONSOLIDATED_BRANCH_ID ? 'Todas' : getBranchById(branchFilter).shortName}</p>
                                    </div>
                                </div>
                                <div className="text-right text-xs font-bold text-slate-500">
                                    Generado: {new Date().toLocaleDateString('es-NI')}
                                </div>
                            </div>
                        </div>
                        <div className="p-6">
                            <div className="mb-5 grid gap-3 sm:grid-cols-4">
                                <StatCard label="IVA vendido" value={fmt(selectedVatTotals.soldVat)} tone="green" />
                                <StatCard label="IVA comprado" value={fmt(selectedVatTotals.purchasedVat)} tone="amber" />
                                <StatCard
                                    label={selectedVatTotals.netVat >= 0 ? 'IVA a pagar' : 'Saldo a favor'}
                                    value={fmt(Math.abs(selectedVatTotals.netVat))}
                                    tone={selectedVatTotals.netVat >= 0 ? 'red' : 'green'}
                                />
                                <StatCard label="Documentos" value={selectedVatRows.length} tone="blue" />
                            </div>
                            <div className="space-y-4">
                                <VatReportTable
                                    title="IVA vendido"
                                    rows={selectedSoldVatRows}
                                    emptyMessage="No hay facturas membretadas vendidas seleccionadas."
                                    tone="green"
                                    rowKeyPrefix="iva-sold-report"
                                />
                                <VatReportTable
                                    title="IVA comprado"
                                    rows={selectedPurchasedVatRows}
                                    emptyMessage="No hay compras o gastos seleccionados."
                                    tone="amber"
                                    rowKeyPrefix="iva-purchased-report"
                                />
                            </div>
                            <div className="mt-8 grid gap-8 text-xs font-bold text-slate-600 sm:grid-cols-2">
                                <div className="border-t border-slate-400 pt-2">Preparado por</div>
                                <div className="border-t border-slate-400 pt-2">Revisado por</div>
                            </div>
                        </div>
                    </Card>
                </div>
            )}

            {moduleTab === DECLARATION_MODULES.STAMPED_INVOICES && activeTab === 'pendientes' && (
                <div className="space-y-5">
                    <div className="grid gap-3 md:grid-cols-5">
                        <StatCard label="Facturas visibles" value={displayedEligibleStampedInvoiceRows.length} tone="blue" help={originMonthFilter === 'all' ? `${MAX_DECLARATION_AGE_MONTHS} meses maximo` : `Origen ${originMonthFilter}`} />
                        <StatCard label="Subtotal" value={fmt(pendingStampedInvoiceTotals.subtotal)} tone="slate" />
                        <StatCard label="IVA" value={fmt(pendingStampedInvoiceTotals.iva)} tone="green" />
                        <StatCard label="Total" value={fmt(pendingStampedInvoiceTotals.total)} tone="amber" />
                        <StatCard label="Retenciones" value={fmt(pendingStampedInvoiceTotals.retentionTotal)} tone="red" />
                    </div>

                    {displayedExpiredStampedInvoiceRows.length > 0 && (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">
                            <div className="flex items-center gap-2">
                                <Icon path={Icons.alert} />
                                Hay {displayedExpiredStampedInvoiceRows.length} factura(s) membretada(s) fuera del plazo de 6 meses por {fmt(expiredStampedInvoiceTotals.total)}. Revisalas antes de cerrar declaraciones.
                            </div>
                        </div>
                    )}

                    <Card className="overflow-hidden">
                        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-600">Bandeja fiscal</div>
                                <h2 className="mt-1 text-lg font-black text-slate-950">Facturas membretadas por declarar</h2>
                                <p className="mt-1 text-xs font-semibold text-slate-500">
                                    Selecciona las facturas membretadas que ya quedaran declaradas en {declarationMonth}. El reporte conserva subtotal, IVA, total, retenciones y neto.
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={toggleAllStampedInvoices} disabled={!displayedEligibleStampedInvoiceRows.length} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-slate-700 transition hover:bg-slate-100 disabled:opacity-50">
                                    {displayedSelectedStampedInvoiceCount === displayedEligibleStampedInvoiceRows.length && displayedEligibleStampedInvoiceRows.length ? 'Limpiar seleccion visible' : 'Seleccionar visible'}
                                </button>
                                <button type="button" onClick={handlePrintPreDeclaration} disabled={!selectedStampedInvoiceRows.length} className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-slate-800 transition hover:bg-slate-50 disabled:opacity-50">
                                    <Icon path={Icons.printer} />
                                    Reporte pre declaracion
                                </button>
                                <button type="button" onClick={handleDeclareStampedInvoices} disabled={declaringStampedInvoices || !selectedStampedInvoiceRows.length} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-xs font-black uppercase tracking-wider text-white shadow-sm shadow-slate-900/20 transition hover:bg-slate-800 disabled:opacity-50">
                                    <Icon path={Icons.check} />
                                    {declaringStampedInvoices ? 'Declarando...' : 'Declarar facturas'}
                                </button>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-slate-100 text-sm">
                                <thead className="bg-white">
                                    <tr className="text-left text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                                        <th className="px-5 py-3">Sel.</th>
                                        <th className="px-5 py-3">Factura</th>
                                        <th className="px-5 py-3">Cliente</th>
                                        <th className="px-5 py-3">Mes origen</th>
                                        <th className="px-5 py-3">Metodo</th>
                                        <th className="px-5 py-3 text-right">Subtotal</th>
                                        <th className="px-5 py-3 text-right">IVA</th>
                                        <th className="px-5 py-3 text-right">Total</th>
                                        <th className="px-5 py-3 text-right">Ret.</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 bg-white">
                                    {displayedEligibleStampedInvoiceRows.map((row) => (
                                        <tr key={row.sourceKey} className="transition hover:bg-slate-50">
                                            <td className="px-5 py-3">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedStampedInvoiceKeys.has(row.sourceKey)}
                                                    onChange={() => toggleStampedInvoiceRow(row)}
                                                    className="h-4 w-4 accent-slate-950"
                                                />
                                            </td>
                                            <td className="px-5 py-3">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <div className="font-black text-slate-950">{row.document || '-'}</div>
                                                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-slate-500">{row.branchName}</span>
                                                </div>
                                                <div className="mt-1 text-xs font-bold text-slate-400">{row.date || '-'}</div>
                                            </td>
                                            <td className="px-5 py-3 font-bold text-slate-700">{row.client}</td>
                                            <td className="px-5 py-3">
                                                <div className="font-mono font-black text-slate-900">{row.month}</div>
                                                <div className="text-xs font-semibold text-slate-400">
                                                    {Math.max(MAX_DECLARATION_AGE_MONTHS - row.ageMonths, 0)} mes(es) de plazo
                                                </div>
                                            </td>
                                            <td className="px-5 py-3 font-bold text-slate-600">{row.paymentMethod || '-'}</td>
                                            <td className="px-5 py-3 text-right font-mono font-bold text-slate-700">{fmt(row.subtotal)}</td>
                                            <td className="px-5 py-3 text-right font-mono font-black text-emerald-700">{fmt(row.iva)}</td>
                                            <td className="px-5 py-3 text-right font-mono font-black text-slate-950">{fmt(row.total)}</td>
                                            <td className="px-5 py-3 text-right font-mono font-bold text-rose-700">{fmt(row.retentionTotal)}</td>
                                        </tr>
                                    ))}
                                    {displayedEligibleStampedInvoiceRows.length === 0 && (
                                        <tr>
                                            <td colSpan={9} className="px-5 py-10 text-center text-sm font-bold text-slate-400">
                                                No hay facturas membretadas pendientes para declarar en este mes y sucursal.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </Card>

                    <Card className="retention-predeclaration-report overflow-hidden">
                        <div className="border-b border-slate-200 bg-white px-6 py-5">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex items-center gap-4">
                                    <img src={APP_BRAND_LOGO} alt={APP_BRAND_NAME} className="h-16 w-16 rounded-2xl border border-slate-200 object-contain p-2" />
                                    <div>
                                        <div className="text-[10px] font-black uppercase tracking-[0.34em] text-slate-600">{APP_BRAND_NAME}</div>
                                        <h2 className="mt-1 text-xl font-black text-slate-950">Reporte Pre Declaracion de Facturas Membretadas</h2>
                                        <p className="text-xs font-bold text-slate-500">Periodo: {declarationMonth} - Sucursal: {branchFilter === CONSOLIDATED_BRANCH_ID ? 'Todas' : getBranchById(branchFilter).shortName}</p>
                                    </div>
                                </div>
                                <div className="text-right text-xs font-bold text-slate-500">
                                    Generado: {new Date().toLocaleDateString('es-NI')}
                                </div>
                            </div>
                        </div>
                        <div className="p-6">
                            <div className="mb-5 grid gap-3 sm:grid-cols-4">
                                <StatCard label="Subtotal" value={fmt(selectedStampedInvoiceTotals.subtotal)} tone="slate" />
                                <StatCard label="IVA" value={fmt(selectedStampedInvoiceTotals.iva)} tone="green" />
                                <StatCard label="Total" value={fmt(selectedStampedInvoiceTotals.total)} tone="amber" />
                                <StatCard label="Retenciones" value={fmt(selectedStampedInvoiceTotals.retentionTotal)} tone="red" />
                            </div>
                            <StampedInvoiceReportTable
                                rows={selectedStampedInvoiceRows}
                                emptyMessage="Selecciona facturas membretadas para generar este reporte."
                                rowKeyPrefix="stamped-pre-report"
                            />
                            <div className="mt-8 grid gap-8 text-xs font-bold text-slate-600 sm:grid-cols-2">
                                <div className="border-t border-slate-400 pt-2">Preparado por</div>
                                <div className="border-t border-slate-400 pt-2">Revisado por</div>
                            </div>
                        </div>
                    </Card>
                </div>
            )}

            {moduleTab === DECLARATION_MODULES.RETENTION_IR && activeTab === 'historial' && (
                <div className="space-y-5">
                    <div className="grid gap-3 md:grid-cols-4">
                        <StatCard label="Declaraciones" value={declarations.length} tone="blue" />
                        <StatCard label="Documentos declarados" value={historyTotals.itemCount} tone="slate" />
                        <StatCard label="IR declarado" value={fmt(historyTotals.retentionIr2)} tone="green" />
                        <StatCard label="Total IR declarado" value={fmt(historyTotals.retentionTotal)} tone="amber" />
                    </div>
                    <Card className="overflow-hidden">
                        <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#e30613]">Archivo fiscal</div>
                            <h2 className="mt-1 text-lg font-black text-slate-950">Declaraciones registradas</h2>
                        </div>
                        <div className="divide-y divide-slate-100">
                            {declarations.map((declaration) => (
                                <details key={declaration.id} className="group bg-white px-5 py-4 open:bg-slate-50">
                                    <summary className="flex cursor-pointer flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                        <div>
                                            <div className="font-black text-slate-950">Declaracion {declaration.declarationMonth}</div>
                                            <div className="mt-1 text-xs font-bold text-slate-400">{declaration.itemCount || 0} documento(s)</div>
                                        </div>
                                        <div className="font-mono text-lg font-black text-[#9f111a]">{fmt(declaration.totals?.retentionTotal)}</div>
                                    </summary>
                                    <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                                        <table className="min-w-full divide-y divide-slate-100 text-xs">
                                            <thead className="bg-slate-50 text-left font-black uppercase tracking-[0.16em] text-slate-400">
                                                <tr>
                                                    <th className="px-4 py-2">Fecha</th>
                                                    <th className="px-4 py-2">Documento</th>
                                                    <th className="px-4 py-2">Cliente</th>
                                                    <th className="px-4 py-2 text-right">IR</th>
                                                    <th className="px-4 py-2 text-right">Total IR</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {(declaration.items || []).map((item) => (
                                                    <tr key={`${declaration.id}-${item.sourceKey}`}>
                                                        <td className="px-4 py-2 font-semibold">{item.date}</td>
                                                        <td className="px-4 py-2 font-black">{formatDeclarationDocument(item.sourceCollection, item.document)}</td>
                                                        <td className="px-4 py-2 font-semibold">{item.client}</td>
                                                        <td className="px-4 py-2 text-right font-mono font-bold">{fmt(item.retentionIr2)}</td>
                                                        <td className="px-4 py-2 text-right font-mono font-black">{fmt(item.retentionIr2 || item.retentionTotal)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </details>
                            ))}
                            {!declarations.length && (
                                <div className="px-5 py-10 text-center text-sm font-bold text-slate-400">
                                    Todavia no hay declaraciones registradas.
                                </div>
                            )}
                        </div>
                    </Card>
                </div>
            )}

            {moduleTab === DECLARATION_MODULES.IVA && activeTab === 'historial' && (
                <div className="space-y-5">
                    <div className="grid gap-3 md:grid-cols-4">
                        <StatCard label="Declaraciones IVA" value={vatDeclarations.length} tone="blue" />
                        <StatCard label="Documentos declarados" value={vatHistoryTotals.itemCount} tone="slate" />
                        <StatCard label="IVA vendido" value={fmt(vatHistoryTotals.soldVat)} tone="green" />
                        <StatCard label="IVA comprado" value={fmt(vatHistoryTotals.purchasedVat)} tone="amber" />
                    </div>
                    <Card className="overflow-hidden">
                        <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-sky-600">Archivo IVA</div>
                            <h2 className="mt-1 text-lg font-black text-slate-950">Declaraciones IVA registradas</h2>
                        </div>
                        <div className="divide-y divide-slate-100">
                            {vatDeclarations.map((declaration) => {
                                const netVat = peso(declaration.totals?.netVat);
                                const declarationItems = declaration.items || [];
                                const declarationSoldItems = declarationItems.filter((item) => item.vatType === 'sold');
                                const declarationPurchasedItems = declarationItems.filter((item) => item.vatType === 'purchased');
                                return (
                                    <details key={declaration.id} className="group bg-white px-5 py-4 open:bg-slate-50">
                                        <summary className="flex cursor-pointer flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                            <div>
                                                <div className="font-black text-slate-950">Declaracion IVA {declaration.declarationMonth}</div>
                                                <div className="mt-1 text-xs font-bold text-slate-400">{declaration.itemCount || 0} documento(s)</div>
                                            </div>
                                            <div className="text-right">
                                                <div className="font-mono text-lg font-black text-slate-950">{fmt(Math.abs(netVat))}</div>
                                                <div className={`text-[10px] font-black uppercase tracking-[0.18em] ${netVat >= 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                                    {netVat >= 0 ? 'IVA a pagar' : 'Saldo a favor'}
                                                </div>
                                            </div>
                                        </summary>
                                        <div className="mt-4 space-y-4">
                                            <VatReportTable
                                                title="IVA vendido"
                                                rows={declarationSoldItems}
                                                emptyMessage="Esta declaracion no incluye IVA vendido."
                                                tone="green"
                                                rowKeyPrefix={`iva-sold-history-${declaration.id}`}
                                            />
                                            <VatReportTable
                                                title="IVA comprado"
                                                rows={declarationPurchasedItems}
                                                emptyMessage="Esta declaracion no incluye IVA comprado."
                                                tone="amber"
                                                rowKeyPrefix={`iva-purchased-history-${declaration.id}`}
                                            />
                                        </div>
                                    </details>
                                );
                            })}
                            {!vatDeclarations.length && (
                                <div className="px-5 py-10 text-center text-sm font-bold text-slate-400">
                                    Todavia no hay declaraciones IVA registradas.
                                </div>
                            )}
                        </div>
                    </Card>
                </div>
            )}

            {moduleTab === DECLARATION_MODULES.STAMPED_INVOICES && activeTab === 'historial' && (
                <div className="space-y-5">
                    <div className="grid gap-3 md:grid-cols-5">
                        <StatCard label="Declaraciones" value={stampedInvoiceDeclarations.length} tone="blue" />
                        <StatCard label="Facturas declaradas" value={stampedInvoiceHistoryTotals.itemCount} tone="slate" />
                        <StatCard label="Total declarado" value={fmt(stampedInvoiceHistoryTotals.total)} tone="amber" />
                        <StatCard label="Retenciones" value={fmt(stampedInvoiceHistoryTotals.retentionTotal)} tone="red" />
                        <StatCard label="Neto" value={fmt(stampedInvoiceHistoryTotals.netTotal)} tone="green" />
                    </div>
                    <Card className="overflow-hidden">
                        <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-600">Archivo facturas</div>
                            <h2 className="mt-1 text-lg font-black text-slate-950">Declaraciones de facturas membretadas</h2>
                        </div>
                        <div className="divide-y divide-slate-100">
                            {stampedInvoiceDeclarations.map((declaration) => (
                                <details key={declaration.id} className="group bg-white px-5 py-4 open:bg-slate-50">
                                    <summary className="flex cursor-pointer flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                        <div>
                                            <div className="font-black text-slate-950">Declaracion facturas {declaration.declarationMonth}</div>
                                            <div className="mt-1 text-xs font-bold text-slate-400">{declaration.itemCount || 0} factura(s)</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="font-mono text-lg font-black text-slate-950">{fmt(declaration.totals?.total)}</div>
                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                                                Neto {fmt(declaration.totals?.netTotal)}
                                            </div>
                                        </div>
                                    </summary>
                                    <div className="mt-4">
                                        <StampedInvoiceReportTable
                                            rows={declaration.items || []}
                                            emptyMessage="Esta declaracion no tiene facturas."
                                            rowKeyPrefix={`stamped-history-${declaration.id}`}
                                        />
                                    </div>
                                </details>
                            ))}
                            {!stampedInvoiceDeclarations.length && (
                                <div className="px-5 py-10 text-center text-sm font-bold text-slate-400">
                                    Todavia no hay declaraciones de facturas membretadas registradas.
                                </div>
                            )}
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
}
