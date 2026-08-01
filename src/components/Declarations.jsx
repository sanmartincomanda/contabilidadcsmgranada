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
const INVOICE_COLLECTION = 'facturas_membretadas_ventas';
const RECEIPT_COLLECTION = 'recibos_caja_membretados';
const MAX_DECLARATION_AGE_MONTHS = 6;

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

const getRetentionSupportStatus = (item = {}) => {
    const support = item.supportFiles || {};
    return {
        invoice: Boolean(support.invoice || support.main || item.invoiceFileUrl || item.supportUrl),
        ir: Boolean(support.retentionIr2 || item.retentionIrSupportUrl),
        municipal: Boolean(support.retentionMunicipal1 || item.retentionMunicipalSupportUrl),
    };
};

const normalizeDeclarationItem = (sourceCollection, item = {}) => {
    const retentionIr2 = peso(item.retentionIr2 ?? item.retencionIr2);
    const retentionMunicipal1 = peso(item.retentionMunicipal1 ?? item.retencionMunicipal1);
    const retentionTotal = peso(item.retentionTotal ?? item.retencionTotal ?? (retentionIr2 + retentionMunicipal1));
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
        document: getDocumentNumber(item, sourceId),
        client: getClientName(item),
        subtotal: peso(item.subtotal),
        total: peso(item.total ?? item.amount ?? item.monto),
        retentionIr2,
        retentionMunicipal1,
        retentionTotal,
        supportStatus: getRetentionSupportStatus(item),
        retentionDeclared: item.retentionDeclared === true || item.retentionDeclarationStatus === 'declarada',
        retentionDeclaredMonth: item.retentionDeclaredMonth || item.declarationMonth || '',
    };
};

const buildRetentionRows = (data = {}) => ([
    ...(data[INVOICE_COLLECTION] || []).filter(isActiveFiscalDocument).map((item) => normalizeDeclarationItem(INVOICE_COLLECTION, item)),
    ...(data[RECEIPT_COLLECTION] || []).filter(isActiveFiscalDocument).map((item) => normalizeDeclarationItem(RECEIPT_COLLECTION, item)),
]).filter((row) => row.sourceId && row.month && row.retentionTotal > 0);

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
    retentionMunicipal1: acc.retentionMunicipal1 + peso(row.retentionMunicipal1),
    retentionTotal: acc.retentionTotal + peso(row.retentionTotal),
    subtotal: acc.subtotal + peso(row.subtotal),
    total: acc.total + peso(row.total),
}), { retentionIr2: 0, retentionMunicipal1: 0, retentionTotal: 0, subtotal: 0, total: 0 });

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

export default function Declarations({ data = {}, branchContext }) {
    const [activeTab, setActiveTab] = useState('pendientes');
    const [declarationMonth, setDeclarationMonth] = useState(currentMonth());
    const [branchFilter, setBranchFilter] = useState(() => (
        branchContext?.allowedBranchIds?.length > 1 ? CONSOLIDATED_BRANCH_ID : (branchContext?.selectedBranchId || DEFAULT_BRANCH_ID)
    ));
    const [selectedKeys, setSelectedKeys] = useState(() => new Set());
    const [declaring, setDeclaring] = useState(false);

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

    const declaredKeys = useMemo(() => buildDeclaredKeySet(declarations), [declarations]);

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

    const selectedRows = useMemo(() => eligibleRows.filter((row) => selectedKeys.has(row.sourceKey)), [eligibleRows, selectedKeys]);
    const selectedTotals = useMemo(() => sumRows(selectedRows), [selectedRows]);
    const pendingTotals = useMemo(() => sumRows(eligibleRows), [eligibleRows]);
    const expiredTotals = useMemo(() => sumRows(expiredRows), [expiredRows]);

    useEffect(() => {
        setSelectedKeys((current) => new Set([...current].filter((key) => eligibleRows.some((row) => row.sourceKey === key))));
    }, [eligibleRows]);

    const toggleRow = (row) => {
        setSelectedKeys((current) => {
            const next = new Set(current);
            if (next.has(row.sourceKey)) next.delete(row.sourceKey);
            else next.add(row.sourceKey);
            return next;
        });
    };

    const toggleAll = () => {
        setSelectedKeys((current) => (
            current.size === eligibleRows.length
                ? new Set()
                : new Set(eligibleRows.map((row) => row.sourceKey))
        ));
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
                retentionMunicipal1: peso(row.retentionMunicipal1),
                retentionTotal: peso(row.retentionTotal),
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

    const historyTotals = useMemo(() => declarations.reduce((acc, declaration) => ({
        retentionIr2: acc.retentionIr2 + peso(declaration.totals?.retentionIr2),
        retentionMunicipal1: acc.retentionMunicipal1 + peso(declaration.totals?.retentionMunicipal1),
        retentionTotal: acc.retentionTotal + peso(declaration.totals?.retentionTotal),
        itemCount: acc.itemCount + peso(declaration.itemCount),
    }), { retentionIr2: 0, retentionMunicipal1: 0, retentionTotal: 0, itemCount: 0 }), [declarations]);

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
                                Control de retenciones que nos hicieron sobre ventas. Lo no declarado se arrastra al siguiente mes hasta 6 meses.
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

                <div className="grid gap-3 border-t border-slate-200 p-4 lg:grid-cols-[190px_190px_1fr]">
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

            {activeTab === 'pendientes' && (
                <div className="space-y-5">
                    <div className="grid gap-3 md:grid-cols-4">
                        <StatCard label="Pendientes seleccionables" value={eligibleRows.length} tone="blue" help={`${MAX_DECLARATION_AGE_MONTHS} meses maximo`} />
                        <StatCard label="Retencion IR 2%" value={fmt(pendingTotals.retentionIr2)} tone="green" />
                        <StatCard label="Retencion Municipal 1%" value={fmt(pendingTotals.retentionMunicipal1)} tone="amber" />
                        <StatCard label="Total pendiente" value={fmt(pendingTotals.retentionTotal)} tone="slate" />
                    </div>

                    {expiredRows.length > 0 && (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">
                            <div className="flex items-center gap-2">
                                <Icon path={Icons.alert} />
                                Hay {expiredRows.length} retencion(es) fuera del plazo de 6 meses por {fmt(expiredTotals.retentionTotal)}. Revisalas antes de cerrar declaraciones.
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
                                <button type="button" onClick={toggleAll} disabled={!eligibleRows.length} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-slate-700 transition hover:bg-slate-100 disabled:opacity-50">
                                    {selectedKeys.size === eligibleRows.length && eligibleRows.length ? 'Limpiar seleccion' : 'Seleccionar todo'}
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
                                        <th className="px-5 py-3 text-right">Municipal 1%</th>
                                        <th className="px-5 py-3 text-right">Total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 bg-white">
                                    {eligibleRows.map((row) => (
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
                                                    {row.retentionMunicipal1 > 0 && <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${row.supportStatus.municipal ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>Municipal</span>}
                                                </div>
                                            </td>
                                            <td className="px-5 py-3 text-right font-mono font-black text-emerald-700">{fmt(row.retentionIr2)}</td>
                                            <td className="px-5 py-3 text-right font-mono font-black text-amber-700">{fmt(row.retentionMunicipal1)}</td>
                                            <td className="px-5 py-3 text-right font-mono font-black text-slate-950">{fmt(row.retentionTotal)}</td>
                                        </tr>
                                    ))}
                                    {eligibleRows.length === 0 && (
                                        <tr>
                                            <td colSpan={8} className="px-5 py-10 text-center text-sm font-bold text-slate-400">
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
                            <div className="mb-5 grid gap-3 sm:grid-cols-3">
                                <StatCard label="IR 2%" value={fmt(selectedTotals.retentionIr2)} tone="green" />
                                <StatCard label="Municipal 1%" value={fmt(selectedTotals.retentionMunicipal1)} tone="amber" />
                                <StatCard label="Total a declarar" value={fmt(selectedTotals.retentionTotal)} tone="slate" />
                            </div>
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b border-slate-300 text-left font-black uppercase tracking-[0.16em] text-slate-500">
                                        <th className="py-2">Fecha</th>
                                        <th className="py-2">Documento</th>
                                        <th className="py-2">Cliente</th>
                                        <th className="py-2">Sucursal</th>
                                        <th className="py-2 text-right">IR 2%</th>
                                        <th className="py-2 text-right">Municipal</th>
                                        <th className="py-2 text-right">Total</th>
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
                                            <td className="py-2 text-right font-mono font-bold">{fmt(row.retentionMunicipal1)}</td>
                                            <td className="py-2 text-right font-mono font-black">{fmt(row.retentionTotal)}</td>
                                        </tr>
                                    ))}
                                    {!selectedRows.length && (
                                        <tr>
                                            <td colSpan={7} className="py-8 text-center font-bold text-slate-400">
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

            {activeTab === 'historial' && (
                <div className="space-y-5">
                    <div className="grid gap-3 md:grid-cols-4">
                        <StatCard label="Declaraciones" value={declarations.length} tone="blue" />
                        <StatCard label="Documentos declarados" value={historyTotals.itemCount} tone="slate" />
                        <StatCard label="IR declarado" value={fmt(historyTotals.retentionIr2)} tone="green" />
                        <StatCard label="Total declarado" value={fmt(historyTotals.retentionTotal)} tone="amber" />
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
                                                    <th className="px-4 py-2 text-right">Municipal</th>
                                                    <th className="px-4 py-2 text-right">Total</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {(declaration.items || []).map((item) => (
                                                    <tr key={`${declaration.id}-${item.sourceKey}`}>
                                                        <td className="px-4 py-2 font-semibold">{item.date}</td>
                                                        <td className="px-4 py-2 font-black">{item.document}</td>
                                                        <td className="px-4 py-2 font-semibold">{item.client}</td>
                                                        <td className="px-4 py-2 text-right font-mono font-bold">{fmt(item.retentionIr2)}</td>
                                                        <td className="px-4 py-2 text-right font-mono font-bold">{fmt(item.retentionMunicipal1)}</td>
                                                        <td className="px-4 py-2 text-right font-mono font-black">{fmt(item.retentionTotal)}</td>
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
        </div>
    );
}
