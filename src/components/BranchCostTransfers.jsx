import React, { useMemo, useState } from 'react';
import { addDoc, collection, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import {
    APP_BRAND_NAME,
    BRANCHES,
    DEFAULT_BRANCH_ID,
    fmt,
    getBranchById,
    getBranchPayload,
    getRecordBranchId,
} from '../constants';
import { useAuth } from '../context/AuthContext';
import { DEFAULT_PURCHASE_CATEGORY_ID, EXPENSE_CATEGORY_OPTIONS } from '../services/expenseCategories';

const TRANSFER_COLLECTION = 'traspasos_costos_sucursal';
const COST_CATEGORY = 'Costos de venta / compras';

const Icons = {
    arrow: 'M17 8l4 4m0 0l-4 4m4-4H3',
    swap: 'M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4',
    eye: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
    plus: 'M12 4v16m8-8H4',
    search: 'M21 21l-4.35-4.35m1.35-5.65a7 7 0 11-14 0 7 7 0 0114 0z',
    printer: 'M6 9V4h12v5M6 18h12v-5H6v5zm0-5H4a2 2 0 01-2-2v-1a4 4 0 014-4h12a4 4 0 014 4v1a2 2 0 01-2 2h-2',
    clipboard: 'M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
    cube: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10',
    x: 'M6 18L18 6M6 6l12 12',
    check: 'M5 13l4 4L19 7',
    warning: 'M12 9v3m0 4h.01m-8.938 4h17.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L1.34 17c-.77 1.333.192 3 1.732 3z',
    clock: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    trash: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
};

const Icon = ({ path, className = 'h-4 w-4' }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
);

const DetailRow = ({ label, value, strong = false }) => (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 last:border-b-0">
        <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</span>
        <span className={`text-right text-sm ${strong ? 'font-black text-slate-950' : 'font-bold text-slate-700'}`}>{value || '-'}</span>
    </div>
);

const todayString = () => new Date().toISOString().substring(0, 10);

const safeNumber = (value) => {
    const normalized = String(value ?? '').replace(/,/g, '').trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
};

const roundTo = (value, decimals = 2) => {
    const factor = 10 ** decimals;
    return Math.round((safeNumber(value) + Number.EPSILON) * factor) / factor;
};

const toMoney = (value) => roundTo(value, 2);
const toWeight = (value) => roundTo(value, 4);

const normalizeText = (value = '') => (
    String(value || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
);

const escapeHtml = (value = '') => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatWeight = (value) => safeNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
});

const nextLineId = () => `line_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

const newLineItem = (overrides = {}) => ({
    lineId: nextLineId(),
    clave: '',
    descripcion: '',
    cantidad: '',
    pesoReal: '',
    unidad: '',
    nota: '',
    ...overrides,
});

const costOptions = EXPENSE_CATEGORY_OPTIONS.filter((option) => option.category === COST_CATEGORY);
const defaultCostOption = costOptions.find((option) => option.id === DEFAULT_PURCHASE_CATEGORY_ID) || costOptions[0];

const branchOptionLabel = (branchId) => {
    const branch = getBranchById(branchId);
    return `${branch.shortName} - Serie ${branch.invoiceSeries}`;
};

const branchIdsFromContext = (branchContext = {}) => {
    const allowed = Array.isArray(branchContext?.allowedBranchIds) && branchContext.allowedBranchIds.length
        ? branchContext.allowedBranchIds
        : [branchContext?.selectedBranchId || DEFAULT_BRANCH_ID];
    return [...new Set(allowed)];
};

const getTransferTimestamp = (transfer = {}) => {
    if (transfer.updatedAt?.toDate) return transfer.updatedAt.toDate().getTime();
    if (Number.isFinite(transfer.updatedAt?.seconds)) return transfer.updatedAt.seconds * 1000;
    if (transfer.createdAt?.toDate) return transfer.createdAt.toDate().getTime();
    if (Number.isFinite(transfer.createdAt?.seconds)) return transfer.createdAt.seconds * 1000;
    return 0;
};

const getLineAppliedQuantity = (item = {}) => {
    const resolvedQuantity = safeNumber(item.quantityApplied ?? item.cantidadAplicada ?? item.resolvedQuantity);
    if (resolvedQuantity > 0) return resolvedQuantity;

    const pesoReal = safeNumber(item.pesoReal);
    if (pesoReal > 0) return pesoReal;

    return safeNumber(item.cantidad);
};

const getLineCost = (item = {}) => {
    const candidates = [
        item.totalCostoSicar,
        item.importeCostoSicar,
        item.importeCosto,
        item.lineTotal,
        item.total,
    ];
    const found = candidates.find((value) => safeNumber(value) > 0);
    return toMoney(found);
};

const getLineUnitCost = (item = {}) => {
    const candidates = [
        item.costoUnitarioSicar,
        item.precioSicar,
        item.precioSin,
        item.costoUnitario,
    ];
    const found = candidates.find((value) => safeNumber(value) > 0);
    return toMoney(found);
};

const getTransferItems = (transfer = {}) => (
    Array.isArray(transfer.items)
        ? transfer.items
        : Array.isArray(transfer.articulos)
            ? transfer.articulos
            : []
);

const buildProductCatalog = (transfers = []) => {
    const catalogMap = new Map();

    transfers.forEach((transfer) => {
        getTransferItems(transfer).forEach((item) => {
            const clave = String(item.clave || item.code || item.resolvedClave || '').trim();
            const descripcion = String(item.descripcion || item.description || item.producto || '').trim();
            const unidad = String(item.unidad || item.unit || item.unidadSicar || '').trim();
            if (!clave && !descripcion) return;

            const key = normalizeText(`${clave}|${descripcion}`);
            if (catalogMap.has(key)) return;

            catalogMap.set(key, {
                clave,
                descripcion,
                unidad,
                searchKey: normalizeText(`${clave} ${descripcion}`),
            });
        });
    });

    return [...catalogMap.values()].sort((left, right) => (
        String(left.descripcion || left.clave).localeCompare(String(right.descripcion || right.clave), 'es')
    ));
};

const sanitizeItems = (items = []) => (
    items
        .map((item) => {
            const clave = String(item.clave || '').trim();
            const descripcion = String(item.descripcion || '').trim();
            const cantidad = toWeight(item.cantidad);
            const pesoReal = toWeight(item.pesoReal);
            const unidad = String(item.unidad || '').trim().toUpperCase();
            const nota = String(item.nota || '').trim();
            const quantityPreview = pesoReal > 0 ? pesoReal : cantidad;

            if (!clave && !descripcion && !cantidad && !pesoReal) return null;

            return {
                lineId: item.lineId || nextLineId(),
                clave,
                descripcion,
                cantidad: cantidad > 0 ? cantidad : 0,
                pesoReal: pesoReal > 0 ? pesoReal : 0,
                unidad,
                nota,
                quantityPreview,
            };
        })
        .filter(Boolean)
);

const summarizeTransfer = (transfer = {}) => {
    const items = getTransferItems(transfer);
    const totalWeightRequested = toWeight(
        items.reduce((sum, item) => sum + (safeNumber(item.pesoReal) > 0 ? safeNumber(item.pesoReal) : safeNumber(item.cantidad)), 0)
    );
    const totalWeightResolved = toWeight(
        items.reduce((sum, item) => sum + getLineAppliedQuantity(item), 0)
    );
    const totalAmount = toMoney(transfer.amount ?? transfer.totalCostoSicar ?? transfer.total);
    return {
        itemsCount: items.length,
        totalWeightRequested,
        totalWeightResolved,
        totalAmount,
    };
};

const getOperationalStatus = (transfer = {}) => String(
    transfer.operationalStatus
    || transfer.integrationStatus
    || transfer.status
    || 'pendiente'
).trim().toLowerCase();

const getAccountingStatus = (transfer = {}) => String(
    transfer.accountingStatus
    || transfer.contabilidadStatus
    || 'pendiente'
).trim().toLowerCase();

const statusToneMap = {
    completado: 'emerald',
    completed: 'emerald',
    listo: 'emerald',
    ready: 'emerald',
    activo: 'slate',
    pending: 'amber',
    pendiente: 'amber',
    processing: 'sky',
    procesando: 'sky',
    salida_aplicada: 'sky',
    entrada_aplicada: 'sky',
    waiting_replication: 'amber',
    error: 'rose',
    anulado: 'slate',
};

const statusLabelMap = {
    completed: 'Completado',
    completado: 'Completado',
    pending: 'Pendiente',
    pendiente: 'Pendiente',
    processing: 'Procesando',
    procesando: 'Procesando',
    salida_aplicada: 'Salida en SICAR',
    entrada_aplicada: 'Entrada en SICAR',
    waiting_replication: 'Esperando replica',
    ready: 'Listo contabilidad',
    activo: 'Activo',
    error: 'Con error',
    anulado: 'Anulado',
};

const toneClassMap = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    sky: 'border-sky-200 bg-sky-50 text-sky-700',
    rose: 'border-rose-200 bg-rose-50 text-rose-700',
    slate: 'border-slate-200 bg-slate-100 text-slate-700',
};

const StatusPill = ({ value, fallbackLabel = 'Pendiente' }) => {
    const normalized = String(value || '').trim().toLowerCase();
    const tone = statusToneMap[normalized] || 'slate';
    const label = statusLabelMap[normalized] || value || fallbackLabel;

    return (
        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${toneClassMap[tone]}`}>
            {label}
        </span>
    );
};

const buildPrintHtml = (transfer) => {
    const items = getTransferItems(transfer);
    const summary = summarizeTransfer(transfer);
    const rows = items.length > 0 ? items : [{
        clave: '',
        descripcion: transfer.description || 'Sin detalle de lineas',
        unidad: '',
        cantidad: 0,
        pesoReal: 0,
    }];

    const rowsHtml = rows.map((item, index) => {
        const quantityApplied = getLineAppliedQuantity(item);
        const unitCost = getLineUnitCost(item);
        const lineCost = getLineCost(item);
        return `
            <tr>
                <td>${index + 1}</td>
                <td>${escapeHtml(item.clave || item.resolvedClave || '')}</td>
                <td>${escapeHtml(item.descripcion || item.description || item.producto || '')}</td>
                <td>${escapeHtml(item.unidad || item.unidadSicar || '')}</td>
                <td style="text-align:right">${formatWeight(safeNumber(item.cantidad))}</td>
                <td style="text-align:right">${formatWeight(safeNumber(item.pesoReal))}</td>
                <td style="text-align:right">${formatWeight(quantityApplied)}</td>
                <td style="text-align:right">${fmt(unitCost)}</td>
                <td style="text-align:right">${fmt(lineCost)}</td>
            </tr>
        `;
    }).join('');

    return `
<!doctype html>
<html lang="es">
<head>
    <meta charset="utf-8" />
    <title>Soporte traspaso ${escapeHtml(transfer.reference || transfer.id || '')}</title>
    <style>
        @page { size: Letter; margin: 0.45in; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; color: #0f172a; }
        .sheet { width: 100%; }
        .brand { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #111827; padding-bottom: 14px; margin-bottom: 16px; }
        .eyebrow { font-size: 11px; font-weight: 800; letter-spacing: 0.22em; text-transform: uppercase; color: #b45309; }
        h1 { margin: 4px 0 0; font-size: 28px; line-height: 1.1; }
        .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; margin-bottom: 16px; }
        .meta-card { border: 1px solid #d1d5db; border-radius: 14px; padding: 12px 14px; background: #f8fafc; }
        .meta-label { font-size: 10px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: #64748b; }
        .meta-value { margin-top: 4px; font-size: 14px; font-weight: 700; color: #0f172a; }
        .description { margin-bottom: 14px; border: 1px solid #e2e8f0; border-radius: 14px; padding: 12px 14px; }
        .description p { margin: 8px 0 0; font-size: 13px; line-height: 1.5; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th { background: #111827; color: white; font-size: 10px; text-transform: uppercase; letter-spacing: 0.14em; padding: 9px 8px; text-align: left; }
        td { border-bottom: 1px solid #e5e7eb; padding: 8px; font-size: 12px; vertical-align: top; }
        .summary { margin-top: 14px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
        .summary-card { border: 1px solid #d1d5db; border-radius: 14px; padding: 12px 14px; background: #fff; }
        .summary-card .meta-value { font-size: 18px; font-weight: 800; }
        .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 56px; }
        .signature-box { padding-top: 16px; }
        .signature-line { border-top: 1px solid #0f172a; padding-top: 8px; text-align: center; font-size: 12px; font-weight: 700; }
        .signature-role { display: block; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.16em; color: #64748b; }
        .footer-note { margin-top: 18px; font-size: 11px; color: #475569; }
    </style>
</head>
<body>
    <main class="sheet">
        <section class="brand">
            <div>
                <div class="eyebrow">${escapeHtml(APP_BRAND_NAME)}</div>
                <h1>Soporte de traspaso</h1>
            </div>
            <div style="text-align:right">
                <div class="meta-label">Referencia</div>
                <div class="meta-value">${escapeHtml(transfer.reference || transfer.id || '')}</div>
                <div class="meta-label" style="margin-top:8px">Estado</div>
                <div class="meta-value">${escapeHtml(statusLabelMap[getOperationalStatus(transfer)] || transfer.operationalStatus || transfer.status || 'Pendiente')}</div>
            </div>
        </section>

        <section class="meta-grid">
            <div class="meta-card">
                <div class="meta-label">Fecha</div>
                <div class="meta-value">${escapeHtml(transfer.date || '-')}</div>
            </div>
            <div class="meta-card">
                <div class="meta-label">Contabilidad</div>
                <div class="meta-value">${escapeHtml(statusLabelMap[getAccountingStatus(transfer)] || transfer.accountingStatus || 'Pendiente')}</div>
            </div>
            <div class="meta-card">
                <div class="meta-label">Origen</div>
                <div class="meta-value">${escapeHtml(branchOptionLabel(transfer.fromBranchId || transfer.branchFrom || getRecordBranchId(transfer)))}</div>
            </div>
            <div class="meta-card">
                <div class="meta-label">Destino</div>
                <div class="meta-value">${escapeHtml(branchOptionLabel(transfer.toBranchId || transfer.branchTo || transfer.targetBranchId || DEFAULT_BRANCH_ID))}</div>
            </div>
            <div class="meta-card">
                <div class="meta-label">Entrega</div>
                <div class="meta-value">${escapeHtml(transfer.deliveryName || transfer.entregaNombre || '') || '&nbsp;'}</div>
            </div>
            <div class="meta-card">
                <div class="meta-label">Recibi conforme</div>
                <div class="meta-value">${escapeHtml(transfer.receivedName || transfer.recibeNombre || '') || '&nbsp;'}</div>
            </div>
        </section>

        <section class="description">
            <div class="meta-label">Observaciones</div>
            <p>${escapeHtml(transfer.description || 'Sin observaciones registradas.')}</p>
        </section>

        <section>
            <table>
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Clave</th>
                        <th>Producto</th>
                        <th>Unidad</th>
                        <th style="text-align:right">Cant.</th>
                        <th style="text-align:right">Peso</th>
                        <th style="text-align:right">Aplicado</th>
                        <th style="text-align:right">Costo</th>
                        <th style="text-align:right">Total</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>
        </section>

        <section class="summary">
            <div class="summary-card">
                <div class="meta-label">Lineas</div>
                <div class="meta-value">${summary.itemsCount}</div>
            </div>
            <div class="summary-card">
                <div class="meta-label">Peso traspasado</div>
                <div class="meta-value">${formatWeight(summary.totalWeightResolved || summary.totalWeightRequested)}</div>
            </div>
            <div class="summary-card">
                <div class="meta-label">Costo total</div>
                <div class="meta-value">${fmt(summary.totalAmount)}</div>
            </div>
        </section>

        <section class="signatures">
            <div class="signature-box">
                <div class="signature-line">
                    ${escapeHtml(transfer.deliveryName || transfer.entregaNombre || '')}
                    <span class="signature-role">Entrega</span>
                </div>
            </div>
            <div class="signature-box">
                <div class="signature-line">
                    ${escapeHtml(transfer.receivedName || transfer.recibeNombre || '')}
                    <span class="signature-role">Recibi conforme</span>
                </div>
            </div>
        </section>

        <div class="footer-note">
            Documento de soporte contable. El costo unitario y el total deben corresponder al costo resuelto en SICAR.
        </div>
    </main>
</body>
</html>
    `;
};

const printTransferDocument = (transfer) => {
    const printWindow = window.open('', '_blank', 'width=1080,height=920');
    if (!printWindow) return false;

    printWindow.document.open();
    printWindow.document.write(buildPrintHtml(transfer));
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => {
        printWindow.print();
    }, 350);
    return true;
};

const TransferItemRow = ({
    item,
    index,
    catalog,
    onChange,
    onRemove,
    onSelectProduct,
    onAddBelow,
}) => {
    const [isOpen, setIsOpen] = useState(false);

    const matches = useMemo(() => {
        const query = normalizeText(`${item.clave} ${item.descripcion}`);
        if (!query) return catalog.slice(0, 8);
        return catalog
            .filter((entry) => entry.searchKey.includes(query))
            .slice(0, 8);
    }, [catalog, item.clave, item.descripcion]);

    const quantityApplied = getLineAppliedQuantity(item);
    const unitCost = getLineUnitCost(item);
    const lineCost = getLineCost(item);

    const handleEnter = (event) => {
        if (event.key !== 'Enter' || event.shiftKey) return;
        event.preventDefault();
        onAddBelow(index);
    };

    return (
        <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50/70 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.26em] text-slate-400">Producto {index + 1}</div>
                    <div className="text-sm font-black text-slate-950">{item.descripcion || item.clave || 'Linea sin completar'}</div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => onAddBelow(index)}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-700 transition hover:bg-slate-950 hover:text-white"
                    >
                        <Icon path={Icons.plus} className="h-3.5 w-3.5" />
                        Otro
                    </button>
                    <button
                        type="button"
                        onClick={() => onRemove(index)}
                        className="grid h-10 w-10 place-items-center rounded-xl border border-rose-200 bg-white text-rose-600 transition hover:bg-rose-50"
                    >
                        <Icon path={Icons.trash} />
                    </button>
                </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[160px_1.3fr_160px_160px_120px]">
                <label className="space-y-1">
                    <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Clave</span>
                    <input
                        id={`transfer-item-${index}-clave`}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-900 outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15"
                        value={item.clave}
                        onChange={(event) => onChange(index, 'clave', event.target.value)}
                        onFocus={() => setIsOpen(true)}
                        onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
                        onKeyDown={handleEnter}
                        placeholder="00036"
                    />
                </label>

                <label className="relative space-y-1">
                    <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Producto</span>
                    <input
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15"
                        value={item.descripcion}
                        onChange={(event) => {
                            onChange(index, 'descripcion', event.target.value);
                            setIsOpen(true);
                        }}
                        onFocus={() => setIsOpen(true)}
                        onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
                        onKeyDown={handleEnter}
                        placeholder="Buscar por clave o descripcion..."
                        autoComplete="off"
                    />

                    {isOpen && matches.length > 0 && (
                        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-xl shadow-slate-900/10">
                            {matches.map((entry) => (
                                <button
                                    type="button"
                                    key={`${entry.clave}-${entry.descripcion}`}
                                    onMouseDown={(event) => {
                                        event.preventDefault();
                                        onSelectProduct(index, entry);
                                        setIsOpen(false);
                                    }}
                                    className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-[#fff1f2]"
                                >
                                    <span className="min-w-0">
                                        <span className="block truncate text-sm font-black text-slate-900">{entry.descripcion || entry.clave}</span>
                                        <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{entry.clave || 'Sin clave'}{entry.unidad ? ` · ${entry.unidad}` : ''}</span>
                                    </span>
                                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-slate-500">Usar</span>
                                </button>
                            ))}
                        </div>
                    )}
                </label>

                <label className="space-y-1">
                    <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Cantidad base</span>
                    <input
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-900 outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15"
                        inputMode="decimal"
                        value={item.cantidad}
                        onChange={(event) => onChange(index, 'cantidad', event.target.value)}
                        onKeyDown={handleEnter}
                        placeholder="0.00"
                    />
                </label>

                <label className="space-y-1">
                    <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Peso real</span>
                    <input
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-900 outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15"
                        inputMode="decimal"
                        value={item.pesoReal}
                        onChange={(event) => onChange(index, 'pesoReal', event.target.value)}
                        onKeyDown={handleEnter}
                        placeholder="0.00"
                    />
                </label>

                <label className="space-y-1">
                    <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Unidad</span>
                    <input
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black uppercase text-slate-900 outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15"
                        value={item.unidad}
                        onChange={(event) => onChange(index, 'unidad', event.target.value.toUpperCase())}
                        onKeyDown={handleEnter}
                        placeholder="LB / PZA"
                    />
                </label>
            </div>

            <label className="mt-3 block space-y-1">
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Nota linea</span>
                <input
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15"
                    value={item.nota}
                    onChange={(event) => onChange(index, 'nota', event.target.value)}
                    onKeyDown={handleEnter}
                    placeholder="Observacion opcional de esta linea"
                />
            </label>

            <div className="mt-3 grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 md:grid-cols-4">
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Se aplicara</div>
                    <div className="mt-1 text-sm font-black text-slate-900">{formatWeight(quantityApplied)}</div>
                </div>
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Costo unitario</div>
                    <div className="mt-1 text-sm font-black text-slate-900">{unitCost > 0 ? fmt(unitCost) : 'Pendiente SICAR'}</div>
                </div>
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Total linea</div>
                    <div className="mt-1 text-sm font-black text-slate-900">{lineCost > 0 ? fmt(lineCost) : 'Pendiente SICAR'}</div>
                </div>
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Clave SICAR</div>
                    <div className="mt-1 text-sm font-black text-slate-900">{item.resolvedClave || item.clave || '-'}</div>
                </div>
            </div>
        </div>
    );
};

const TransferDetailModal = ({ transfer, onClose, onPrint }) => {
    if (!transfer) return null;

    const items = getTransferItems(transfer);
    const summary = summarizeTransfer(transfer);
    const fromBranchId = transfer.fromBranchId || transfer.branchFrom || getRecordBranchId(transfer);
    const toBranchId = transfer.toBranchId || transfer.branchTo || transfer.targetBranchId || DEFAULT_BRANCH_ID;

    return (
        <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
            <button type="button" aria-label="Cerrar detalle" className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
                <div className="bg-slate-950 px-6 py-5 text-white">
                    <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#f5b51b]">Soporte de traspaso</div>
                    <h3 className="mt-1 text-xl font-black">{transfer.reference || transfer.id}</h3>
                    <p className="mt-1 text-sm font-semibold text-white/65">{branchOptionLabel(fromBranchId)} hacia {branchOptionLabel(toBranchId)}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                        <StatusPill value={transfer.operationalStatus || transfer.integrationStatus} />
                        <StatusPill value={transfer.accountingStatus} fallbackLabel="Contabilidad pendiente" />
                        <StatusPill value={transfer.sicarOrigin?.status} fallbackLabel="Salida pendiente" />
                        <StatusPill value={transfer.sicarDestination?.status} fallbackLabel="Entrada pendiente" />
                    </div>
                    <div className="absolute right-4 top-4 flex gap-2">
                        <button
                            type="button"
                            onClick={() => onPrint(transfer)}
                            className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-white/20"
                        >
                            <Icon path={Icons.printer} />
                            Imprimir
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="grid h-10 w-10 place-items-center rounded-2xl bg-white/10 text-white transition hover:bg-white/20"
                        >
                            <Icon path={Icons.x} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <DetailRow label="Fecha" value={transfer.date} />
                            <DetailRow label="Mes" value={transfer.month} />
                            <DetailRow label="Origen" value={branchOptionLabel(fromBranchId)} />
                            <DetailRow label="Destino" value={branchOptionLabel(toBranchId)} />
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <DetailRow label="Entrega" value={transfer.deliveryName || transfer.entregaNombre} />
                            <DetailRow label="Recibi conforme" value={transfer.receivedName || transfer.recibeNombre} />
                            <DetailRow label="Creado por" value={transfer.createdByEmail || transfer.createdBy} />
                            <DetailRow label="Fuente" value={transfer.sourceType || transfer.source || 'manual'} />
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <DetailRow label="Lineas" value={String(summary.itemsCount)} />
                            <DetailRow label="Peso solicitado" value={formatWeight(summary.totalWeightRequested)} />
                            <DetailRow label="Peso aplicado" value={formatWeight(summary.totalWeightResolved)} />
                            <DetailRow label="Costo total" value={fmt(summary.totalAmount)} strong />
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <DetailRow label="Folio salida SICAR" value={transfer.sicarOrigin?.folio || transfer.sicarOrigin?.traId} />
                            <DetailRow label="Folio entrada SICAR" value={transfer.sicarDestination?.folio || transfer.sicarDestination?.traId} />
                            <DetailRow label="Salida" value={statusLabelMap[String(transfer.sicarOrigin?.status || '').toLowerCase()] || transfer.sicarOrigin?.status || 'Pendiente'} />
                            <DetailRow label="Entrada" value={statusLabelMap[String(transfer.sicarDestination?.status || '').toLowerCase()] || transfer.sicarDestination?.status || 'Pendiente'} />
                        </div>
                    </div>

                    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Descripcion / motivo</div>
                        <p className="mt-2 whitespace-pre-wrap text-sm font-semibold text-slate-700">{transfer.description || 'Sin descripcion registrada.'}</p>
                    </div>

                    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                            <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Renglones del traspaso</div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-slate-100">
                                <thead className="bg-slate-950 text-white">
                                    <tr>
                                        {['Clave', 'Producto', 'Unidad', 'Cantidad', 'Peso', 'Aplicado', 'Costo', 'Total'].map((header) => (
                                            <th key={header} className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-white/70">{header}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 bg-white">
                                    {items.length > 0 ? items.map((item) => (
                                        <tr key={item.lineId || `${item.clave}-${item.descripcion}`}>
                                            <td className="px-4 py-3 text-sm font-black text-slate-900">{item.resolvedClave || item.clave || '-'}</td>
                                            <td className="px-4 py-3 text-sm font-semibold text-slate-700">{item.descripcion || item.description || item.producto || '-'}</td>
                                            <td className="px-4 py-3 text-sm font-semibold text-slate-600">{item.unidadSicar || item.unidad || '-'}</td>
                                            <td className="px-4 py-3 text-right font-mono text-sm font-black text-slate-800">{formatWeight(safeNumber(item.cantidad))}</td>
                                            <td className="px-4 py-3 text-right font-mono text-sm font-black text-slate-800">{formatWeight(safeNumber(item.pesoReal))}</td>
                                            <td className="px-4 py-3 text-right font-mono text-sm font-black text-slate-900">{formatWeight(getLineAppliedQuantity(item))}</td>
                                            <td className="px-4 py-3 text-right font-mono text-sm font-black text-slate-900">{getLineUnitCost(item) > 0 ? fmt(getLineUnitCost(item)) : 'Pendiente'}</td>
                                            <td className="px-4 py-3 text-right font-mono text-sm font-black text-[#e30613]">{getLineCost(item) > 0 ? fmt(getLineCost(item)) : 'Pendiente'}</td>
                                        </tr>
                                    )) : (
                                        <tr>
                                            <td colSpan="8" className="px-4 py-8 text-center text-sm font-bold text-slate-400">Este traspaso no tiene lineas detalladas.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default function BranchCostTransfers({ data = {}, branchContext = {}, canEdit = true }) {
    const { user } = useAuth();
    const allowedBranchIds = useMemo(() => branchIdsFromContext(branchContext), [branchContext]);
    const selectedBranchId = branchContext?.selectedBranchId || allowedBranchIds[0] || DEFAULT_BRANCH_ID;
    const defaultDestination = BRANCHES.find((branch) => branch.id !== selectedBranchId)?.id || selectedBranchId;
    const [form, setForm] = useState({
        date: todayString(),
        fromBranchId: selectedBranchId,
        toBranchId: defaultDestination,
        categoryOptionId: defaultCostOption?.id || '',
        description: '',
        reference: '',
        deliveryName: '',
        receivedName: '',
        items: [newLineItem()],
    });
    const [activeTab, setActiveTab] = useState('nuevo');
    const [filterMonth, setFilterMonth] = useState(todayString().substring(0, 7));
    const [filterText, setFilterText] = useState('');
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [detail, setDetail] = useState(null);

    const branchOptions = useMemo(() => BRANCHES, []);

    const transfers = useMemo(() => {
        const allowed = new Set(allowedBranchIds);
        return (data[TRANSFER_COLLECTION] || [])
            .filter((transfer) => {
                const fromBranchId = transfer.fromBranchId || transfer.branchFrom || getRecordBranchId(transfer);
                const toBranchId = transfer.toBranchId || transfer.branchTo || transfer.targetBranchId;
                return allowed.has(fromBranchId) || allowed.has(toBranchId);
            })
            .sort((left, right) => getTransferTimestamp(right) - getTransferTimestamp(left));
    }, [allowedBranchIds, data]);

    const productCatalog = useMemo(() => buildProductCatalog(transfers), [transfers]);

    const filteredTransfers = useMemo(() => {
        const query = filterText.trim().toLowerCase();

        return transfers.filter((transfer) => {
            const monthOk = !filterMonth || String(transfer.month || transfer.date || '').startsWith(filterMonth);
            const text = [
                transfer.reference,
                transfer.description,
                transfer.category,
                transfer.subcategory,
                transfer.fromBranchName,
                transfer.toBranchName,
                transfer.createdByEmail,
                transfer.deliveryName,
                transfer.receivedName,
                ...getTransferItems(transfer).flatMap((item) => [item.clave, item.descripcion, item.description]),
            ].filter(Boolean).join(' ').toLowerCase();
            return monthOk && (!query || text.includes(query));
        });
    }, [filterMonth, filterText, transfers]);

    const totals = useMemo(() => {
        const totalMoved = filteredTransfers.reduce((sum, transfer) => sum + summarizeTransfer(transfer).totalAmount, 0);
        const totalWeight = filteredTransfers.reduce((sum, transfer) => sum + summarizeTransfer(transfer).totalWeightResolved, 0);
        const pendingCount = filteredTransfers.filter((transfer) => !['ready', 'completed', 'completado'].includes(getAccountingStatus(transfer))).length;
        return { totalMoved, totalWeight, pendingCount };
    }, [filteredTransfers]);

    const currentItems = useMemo(() => sanitizeItems(form.items), [form.items]);
    const currentWeight = useMemo(() => toWeight(currentItems.reduce((sum, item) => sum + item.quantityPreview, 0)), [currentItems]);

    const updateForm = (field, value) => setForm((current) => ({ ...current, [field]: value }));

    const updateItem = (index, field, value) => {
        setForm((current) => ({
            ...current,
            items: current.items.map((item, itemIndex) => (
                itemIndex === index ? { ...item, [field]: value } : item
            )),
        }));
    };

    const selectCatalogItem = (index, product) => {
        setForm((current) => ({
            ...current,
            items: current.items.map((item, itemIndex) => (
                itemIndex === index
                    ? {
                        ...item,
                        clave: product.clave || item.clave,
                        descripcion: product.descripcion || item.descripcion,
                        unidad: product.unidad || item.unidad,
                    }
                    : item
            )),
        }));
    };

    const addItemBelow = (index) => {
        const nextIndex = index + 1;
        setForm((current) => {
            const items = [...current.items];
            items.splice(nextIndex, 0, newLineItem());
            return { ...current, items };
        });
        window.setTimeout(() => {
            document.getElementById(`transfer-item-${nextIndex}-clave`)?.focus();
        }, 50);
    };

    const removeItem = (index) => {
        setForm((current) => {
            if (current.items.length === 1) {
                return { ...current, items: [newLineItem()] };
            }
            return {
                ...current,
                items: current.items.filter((_, itemIndex) => itemIndex !== index),
            };
        });
    };

    const handlePrint = (transfer) => {
        const printed = printTransferDocument(transfer);
        if (!printed) {
            setMessage('El navegador bloqueo la ventana de impresion. Permite popups para este sitio y vuelve a intentarlo.');
        }
    };

    const handleSave = async (event) => {
        event.preventDefault();
        if (!canEdit) {
            setMessage('Tu usuario solo tiene permiso de visualizacion en este modulo.');
            return;
        }

        const preparedItems = sanitizeItems(form.items);
        const fromBranchId = form.fromBranchId;
        const toBranchId = form.toBranchId;
        const categoryOption = costOptions.find((option) => option.id === form.categoryOptionId) || defaultCostOption;

        if (!form.date) {
            setMessage('Indica la fecha del traspaso.');
            return;
        }
        if (!fromBranchId || !toBranchId || fromBranchId === toBranchId) {
            setMessage('Selecciona sucursal origen y destino diferentes.');
            return;
        }
        if (preparedItems.length < 1) {
            setMessage('Agrega al menos un producto al traspaso.');
            return;
        }
        if (preparedItems.some((item) => !item.clave || !item.descripcion || item.quantityPreview <= 0)) {
            setMessage('Cada linea debe tener clave, producto y una cantidad o peso mayor que cero.');
            return;
        }

        const fromPayload = getBranchPayload(fromBranchId);
        const toPayload = getBranchPayload(toBranchId);
        const reference = form.reference.trim() || `TRS-${form.date.replace(/-/g, '')}-${Date.now().toString().slice(-5)}`;
        const totalWeightRequested = toWeight(preparedItems.reduce((sum, item) => sum + item.quantityPreview, 0));

        setSaving(true);
        setMessage('');
        try {
            await addDoc(collection(db, TRANSFER_COLLECTION), {
                date: form.date,
                month: form.date.substring(0, 7),
                reference,
                description: form.description.trim(),
                deliveryName: form.deliveryName.trim(),
                receivedName: form.receivedName.trim(),
                amount: 0,
                totalWeightRequested,
                totalWeightResolved: 0,
                totalLineItems: preparedItems.length,
                items: preparedItems,
                category: categoryOption.category,
                categoria: categoryOption.category,
                subcategory: categoryOption.subcategory,
                subcategoria: categoryOption.subcategory,
                expenseCategoryId: categoryOption.id,
                expenseCategory: categoryOption.category,
                expenseSubcategory: categoryOption.subcategory,
                fromBranchId,
                fromBranchCode: fromPayload.branchCode,
                fromBranchName: fromPayload.branchName,
                fromDocumentSeries: fromPayload.documentSeries,
                toBranchId,
                toBranchCode: toPayload.branchCode,
                toBranchName: toPayload.branchName,
                toDocumentSeries: toPayload.documentSeries,
                source: 'manual',
                sourceType: 'branch_transfer_sicar',
                status: 'activo',
                operationalStatus: 'pendiente_sicar',
                integrationStatus: 'pending',
                accountingStatus: 'pending',
                sicarOrigin: {
                    status: 'pending',
                    attempts: 0,
                },
                sicarDestination: {
                    status: 'pending',
                    attempts: 0,
                },
                createdBy: user?.uid || '',
                createdByEmail: user?.email || '',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
            });

            setMessage('Traspaso guardado. El watcher local completara costo SICAR, total contable e impresion de soporte cuando procese la salida.');
            setForm((current) => ({
                ...current,
                description: '',
                reference: '',
                deliveryName: '',
                receivedName: '',
                items: [newLineItem()],
            }));
            setActiveTab('historial');
        } catch (error) {
            console.error('Error guardando traspaso de sucursal', error);
            setMessage(`No se pudo guardar el traspaso: ${error.message}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="mx-auto max-w-[1520px] space-y-5">
            <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
                <div className="grid gap-4 bg-slate-950 px-6 py-6 text-white md:grid-cols-[1fr_auto] md:items-center">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.32em] text-[#f5b51b]">{APP_BRAND_NAME}</div>
                        <h1 className="mt-1 text-2xl font-black tracking-tight">Traspasos con costo SICAR</h1>
                        <p className="mt-2 max-w-3xl text-sm font-semibold text-white/65">
                            Captura el traspaso por producto, peso y firmas. El servidor local resuelve el costo real desde SICAR, genera el soporte carta y deja el monto listo para contabilidad.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/[0.06] p-2">
                        <button
                            type="button"
                            onClick={() => setActiveTab('nuevo')}
                            className={`rounded-xl px-4 py-2 text-xs font-black uppercase tracking-[0.16em] transition ${activeTab === 'nuevo' ? 'bg-[#f5b51b] text-slate-950' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
                        >
                            Nuevo
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('historial')}
                            className={`rounded-xl px-4 py-2 text-xs font-black uppercase tracking-[0.16em] transition ${activeTab === 'historial' ? 'bg-[#f5b51b] text-slate-950' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
                        >
                            Historial
                        </button>
                    </div>
                </div>
            </section>

            {message && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
                    {message}
                </div>
            )}

            {activeTab === 'nuevo' && (
                <section className="grid gap-5 xl:grid-cols-[1fr_420px]">
                    <form onSubmit={handleSave} className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="mb-5 flex items-center gap-3">
                            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#fff1f2] text-[#e30613]">
                                <Icon path={Icons.swap} className="h-6 w-6" />
                            </div>
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.26em] text-slate-400">Operacion viva</div>
                                <h2 className="text-lg font-black text-slate-950">Capturar traspaso para SICAR</h2>
                            </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <label className="space-y-1">
                                <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Fecha</span>
                                <input className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15" type="date" value={form.date} onChange={(event) => updateForm('date', event.target.value)} />
                            </label>
                            <label className="space-y-1">
                                <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Referencia / pedido</span>
                                <input className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15" value={form.reference} onChange={(event) => updateForm('reference', event.target.value)} placeholder="Opcional, el sistema asigna una" />
                            </label>
                            <label className="space-y-1">
                                <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Sale de</span>
                                <select className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15" value={form.fromBranchId} onChange={(event) => updateForm('fromBranchId', event.target.value)}>
                                    {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.shortName} - Serie {branch.invoiceSeries}</option>)}
                                </select>
                            </label>
                            <label className="space-y-1">
                                <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Pasa a</span>
                                <select className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15" value={form.toBranchId} onChange={(event) => updateForm('toBranchId', event.target.value)}>
                                    {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.shortName} - Serie {branch.invoiceSeries}</option>)}
                                </select>
                            </label>
                            <label className="space-y-1">
                                <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Entrega</span>
                                <input className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15" value={form.deliveryName} onChange={(event) => updateForm('deliveryName', event.target.value)} placeholder="Nombre de quien entrega" />
                            </label>
                            <label className="space-y-1">
                                <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Recibi conforme</span>
                                <input className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15" value={form.receivedName} onChange={(event) => updateForm('receivedName', event.target.value)} placeholder="Nombre de quien recibe" />
                            </label>
                            <label className="space-y-1 md:col-span-2">
                                <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Subcategoria fiscal</span>
                                <select className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15" value={form.categoryOptionId} onChange={(event) => updateForm('categoryOptionId', event.target.value)}>
                                    {costOptions.map((option) => <option key={option.id} value={option.id}>{option.subcategory}</option>)}
                                </select>
                            </label>
                            <label className="space-y-1 md:col-span-2">
                                <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Descripcion / motivo</span>
                                <textarea className="min-h-[110px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15" value={form.description} onChange={(event) => updateForm('description', event.target.value)} placeholder="Ejemplo: Traspaso enviado desde Granada hacia Nindiri para reposicion de inventario." />
                            </label>
                        </div>

                        <div className="mt-6 rounded-[1.8rem] border border-slate-200 bg-white p-4">
                            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#e30613]">Detalle operativo</div>
                                    <h3 className="mt-1 text-base font-black text-slate-950">Productos, peso y soporte para costo SICAR</h3>
                                    <p className="mt-1 text-xs font-semibold text-slate-500">Busca por clave o descripcion. Al presionar Enter en una linea se agrega la siguiente.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => addItemBelow(form.items.length - 1)}
                                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-700 transition hover:bg-slate-950 hover:text-white"
                                >
                                    <Icon path={Icons.plus} />
                                    Agregar producto
                                </button>
                            </div>

                            <div className="space-y-4">
                                {form.items.map((item, index) => (
                                    <TransferItemRow
                                        key={item.lineId}
                                        item={item}
                                        index={index}
                                        catalog={productCatalog}
                                        onChange={updateItem}
                                        onRemove={removeItem}
                                        onSelectProduct={selectCatalogItem}
                                        onAddBelow={addItemBelow}
                                    />
                                ))}
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={saving || !canEdit}
                            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#e30613] px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-white shadow-lg shadow-red-900/15 transition hover:bg-[#9f111a] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Icon path={Icons.plus} />
                            {saving ? 'Guardando...' : 'Guardar traspaso'}
                        </button>
                    </form>

                    <aside className="space-y-5">
                        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#e30613]">Impacto esperado</div>
                            <h3 className="mt-1 text-lg font-black text-slate-950">Como se va a mover</h3>
                            <div className="mt-5 space-y-3">
                                <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4">
                                    <div className="text-xs font-black uppercase tracking-[0.16em] text-rose-500">Serie origen</div>
                                    <div className="mt-1 text-sm font-black text-slate-950">{branchOptionLabel(form.fromBranchId)}</div>
                                    <div className="mt-2 font-mono text-lg font-black text-rose-700">-{fmt(0)}</div>
                                    <div className="mt-1 text-xs font-bold text-rose-700">Se resuelve desde costo real SICAR.</div>
                                </div>
                                <div className="flex justify-center text-slate-400">
                                    <Icon path={Icons.arrow} className="h-6 w-6 rotate-90 md:rotate-0" />
                                </div>
                                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                                    <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-600">Serie destino</div>
                                    <div className="mt-1 text-sm font-black text-slate-950">{branchOptionLabel(form.toBranchId)}</div>
                                    <div className="mt-2 font-mono text-lg font-black text-emerald-700">+{fmt(0)}</div>
                                    <div className="mt-1 text-xs font-bold text-emerald-700">Contabilidad toma el monto cuando SICAR confirme el costo.</div>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="mb-4 flex items-center gap-3">
                                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950 text-white">
                                    <Icon path={Icons.clipboard} className="h-5 w-5" />
                                </div>
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Resumen rapido</div>
                                    <div className="text-sm font-black text-slate-950">Lo que ya queda listo</div>
                                </div>
                            </div>
                            <div className="grid gap-3">
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Lineas capturadas</div>
                                    <div className="mt-1 font-mono text-2xl font-black text-slate-950">{currentItems.length}</div>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Peso a mover</div>
                                    <div className="mt-1 font-mono text-2xl font-black text-slate-950">{formatWeight(currentWeight)}</div>
                                </div>
                                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                                    <div className="flex items-center gap-2 text-amber-700">
                                        <Icon path={Icons.warning} />
                                        <span className="text-[10px] font-black uppercase tracking-[0.16em]">Costo pendiente</span>
                                    </div>
                                    <p className="mt-2 text-sm font-bold text-amber-900">
                                        El costo unitario y el total se completan cuando el watcher local procesa el traspaso contra SICAR.
                                    </p>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Soporte imprimible</div>
                                    <p className="mt-2 text-sm font-bold text-slate-700">
                                        El historial ya mostrara el boton de impresion en carta con total, detalle y espacios de firma.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </aside>
                </section>
            )}

            {activeTab === 'historial' && (
                <section className="rounded-[2rem] border border-slate-200 bg-white shadow-sm">
                    <div className="grid gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 lg:grid-cols-[1fr_180px_260px] lg:items-center">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Historial</div>
                            <h2 className="mt-1 text-lg font-black text-slate-950">Traspasos registrados</h2>
                        </div>
                        <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15" type="month" value={filterMonth} onChange={(event) => setFilterMonth(event.target.value)} />
                        <label className="relative">
                            <Icon path={Icons.search} className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm font-bold outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15" value={filterText} onChange={(event) => setFilterText(event.target.value)} placeholder="Buscar referencia, producto, firma..." />
                        </label>
                    </div>

                    <div className="grid gap-3 border-b border-slate-100 p-5 md:grid-cols-3">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Registros</div>
                            <div className="mt-1 font-mono text-2xl font-black text-slate-950">{filteredTransfers.length}</div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Costo total listo</div>
                            <div className="mt-1 font-mono text-2xl font-black text-[#e30613]">{fmt(totals.totalMoved)}</div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Pendientes / peso</div>
                            <div className="mt-1 text-sm font-black text-slate-700">{totals.pendingCount} pendiente(s) · {formatWeight(totals.totalWeight)}</div>
                        </div>
                    </div>

                    <div className="grid gap-4 p-5">
                        {filteredTransfers.map((transfer) => {
                            const summary = summarizeTransfer(transfer);
                            const fromBranchId = transfer.fromBranchId || transfer.branchFrom || getRecordBranchId(transfer);
                            const toBranchId = transfer.toBranchId || transfer.branchTo || transfer.targetBranchId || DEFAULT_BRANCH_ID;

                            return (
                                <article key={transfer.id} className="rounded-[1.8rem] border border-slate-200 bg-white p-5 shadow-sm">
                                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                                        <div className="space-y-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="rounded-full bg-slate-950 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white">{transfer.reference || transfer.id}</span>
                                                <StatusPill value={transfer.operationalStatus || transfer.integrationStatus} />
                                                <StatusPill value={transfer.accountingStatus} fallbackLabel="Contabilidad pendiente" />
                                            </div>
                                            <div>
                                                <h3 className="text-lg font-black text-slate-950">{branchOptionLabel(fromBranchId)} hacia {branchOptionLabel(toBranchId)}</h3>
                                                <p className="mt-1 text-sm font-semibold text-slate-500">{transfer.date || '-'} · {summary.itemsCount} linea(s) · peso {formatWeight(summary.totalWeightResolved || summary.totalWeightRequested)}</p>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                <StatusPill value={transfer.sicarOrigin?.status} fallbackLabel="Salida pendiente" />
                                                <StatusPill value={transfer.sicarDestination?.status} fallbackLabel="Entrada pendiente" />
                                            </div>
                                        </div>

                                        <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[560px]">
                                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Costo total</div>
                                                <div className="mt-1 font-mono text-xl font-black text-[#e30613]">{fmt(summary.totalAmount)}</div>
                                            </div>
                                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Entrega / recibe</div>
                                                <div className="mt-1 text-xs font-bold text-slate-700">{transfer.deliveryName || '-'} / {transfer.receivedName || '-'}</div>
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                <button type="button" onClick={() => setDetail(transfer)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-slate-700 transition hover:bg-slate-950 hover:text-white">
                                                    <Icon path={Icons.eye} />
                                                    Ver detalle
                                                </button>
                                                <button type="button" onClick={() => handlePrint(transfer)} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#e30613] px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-[#9f111a]">
                                                    <Icon path={Icons.printer} />
                                                    Imprimir carta
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </article>
                            );
                        })}

                        {!filteredTransfers.length && (
                            <div className="rounded-[1.8rem] border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center text-sm font-bold text-slate-400">
                                No hay traspasos para los filtros seleccionados.
                            </div>
                        )}
                    </div>
                </section>
            )}

            <TransferDetailModal transfer={detail} onClose={() => setDetail(null)} onPrint={handlePrint} />
        </div>
    );
}
