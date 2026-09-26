import React, { useEffect, useMemo, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { fmt } from '../constants';

const BAC_ACCOUNT = '1102101 · BAC 362843534 C$';
const REFRESH_MS = 30000;

const todayInManagua = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Managua',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
}).format(new Date());

const branchLabel = (branchId) => branchId === 'nindiri' ? 'Nindiri · Serie B' : 'Granada · Serie A';
const referenceKey = (reference = {}) => `${reference.reference || ''}|${reference.bankAccount || ''}`;
const parseReferenceKey = (value = '') => {
    const separator = value.indexOf('|');
    return separator < 0
        ? { beneficiaryReference: '', bankAccount: '' }
        : { beneficiaryReference: value.slice(0, separator), bankAccount: value.slice(separator + 1) };
};
const errorMessage = (error) => (
    error?.message?.replace(/^Firebase:\s*/i, '').replace(/\s*\(functions\/[\w-]+\)\.?$/i, '')
    || 'No se pudo completar la operacion.'
);

const Icon = ({ children, tone = 'slate' }) => {
    const tones = {
        red: 'bg-red-50 text-[#e30613] border-red-100',
        amber: 'bg-amber-50 text-amber-700 border-amber-100',
        green: 'bg-emerald-50 text-emerald-700 border-emerald-100',
        slate: 'bg-slate-50 text-slate-700 border-slate-100',
    };
    return <span className={`grid h-10 w-10 place-items-center rounded-2xl border text-lg font-black ${tones[tone]}`}>{children}</span>;
};

const SummaryCard = ({ label, value, hint, tone = 'slate', mono = false }) => {
    const tones = {
        red: 'border-red-100 bg-gradient-to-br from-red-50 to-white text-[#9f111a]',
        amber: 'border-amber-100 bg-gradient-to-br from-amber-50 to-white text-amber-800',
        green: 'border-emerald-100 bg-gradient-to-br from-emerald-50 to-white text-emerald-800',
        slate: 'border-slate-200 bg-gradient-to-br from-slate-50 to-white text-slate-900',
    };
    return (
        <div className={`rounded-3xl border p-4 shadow-sm ${tones[tone]}`}>
            <div className="text-[10px] font-black uppercase tracking-[0.22em] opacity-65">{label}</div>
            <div className={`mt-2 text-2xl font-black tracking-tight ${mono ? 'font-mono' : ''}`}>{value}</div>
            <div className="mt-1 text-xs font-semibold opacity-60">{hint}</div>
        </div>
    );
};

const StatusBadge = ({ row }) => {
    if (row.exported) return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-slate-600">Exportado</span>;
    if (row.reconciled === false) return <span className="rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-red-800">No concilia</span>;
    if (!row.bacReferences?.length) return <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-amber-800">Sin referencia BAC</span>;
    if (row.bacReferences.length > 1) return <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-sky-800">Elegir cuenta</span>;
    return <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-800">Disponible</span>;
};

const BacReferenceSelect = ({ row, value, onChange, disabled }) => {
    const references = row.bacReferences || [];
    if (!references.length) return <span className="text-xs font-bold text-amber-700">Vincula el proveedor al Plan AR19</span>;
    if (references.length === 1) {
        const reference = references[0];
        return (
            <div>
                <div className="font-mono text-xs font-black text-slate-800">{reference.reference}</div>
                <div className="mt-0.5 font-mono text-[10px] font-bold text-slate-400">Cta. {reference.bankAccount}</div>
            </div>
        );
    }
    return (
        <select
            value={value || ''}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
            className="w-full min-w-48 rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs font-bold text-slate-700 outline-none focus:border-[#e30613]"
        >
            <option value="">Seleccionar referencia...</option>
            {references.map((reference) => (
                <option key={referenceKey(reference)} value={referenceKey(reference)}>
                    {reference.reference} · {reference.bankAccount}
                </option>
            ))}
        </select>
    );
};

const printTicket = (preview) => {
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    const rows = preview.rows.map((row) => `
        <tr>
            <td>${row.supplierName}<small>${row.invoiceNumber} · ${row.branchName}</small></td>
            <td class="amount">C$ ${Number(row.netAmount).toLocaleString('es-NI', { minimumFractionDigits: 2 })}</td>
        </tr>
    `).join('');
    frame.onload = () => {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        window.setTimeout(() => frame.remove(), 1200);
    };
    document.body.appendChild(frame);
    frame.contentDocument.open();
    frame.contentDocument.write(`<!doctype html><html><head><meta charset="utf-8"><style>
        @page { size: 80mm auto; margin: 4mm; }
        * { box-sizing: border-box; }
        body { width: 72mm; margin: 0; color: #111; font: 11px Arial, sans-serif; }
        h1 { margin: 0 0 4px; text-align: center; font-size: 14px; }
        .meta { border-top: 1px dashed #333; border-bottom: 1px dashed #333; padding: 5px 0; line-height: 1.45; }
        table { width: 100%; border-collapse: collapse; margin-top: 5px; }
        td { padding: 4px 0; vertical-align: top; border-bottom: 1px dotted #aaa; }
        td.amount { width: 28mm; text-align: right; white-space: nowrap; }
        small { display: block; margin-top: 2px; color: #555; }
        .total { margin-top: 7px; padding-top: 5px; border-top: 1px dashed #333; text-align: right; font-size: 14px; font-weight: bold; }
        .warning { margin-top: 8px; text-align: center; font-size: 9px; }
    </style></head><body>
        <h1>VISTA PREVIA PLANILLA BAC</h1>
        <div class="meta">
            Plan: AR19 · NIO<br>
            Cuenta origen: 362843534<br>
            Fecha aplicacion: ${preview.applicationDate}<br>
            Envio simulado: ${String(preview.shipmentNumber).padStart(5, '0')}<br>
            Lineas: ${preview.lineCount}
        </div>
        <table>${rows}</table>
        <div class="total">TOTAL C$ ${Number(preview.totalAmount).toLocaleString('es-NI', { minimumFractionDigits: 2 })}</div>
        <div class="warning">PREVISUALIZACION · NO ES CONSTANCIA DE PAGO BAC</div>
    </body></html>`);
    frame.contentDocument.close();
};

const PreviewModal = ({ preview, onClose }) => {
    if (!preview) return null;
    return (
        <div className="fixed inset-0 z-[80] overflow-y-auto bg-slate-950/70 p-3 backdrop-blur-sm md:p-8">
            <div className="mx-auto max-w-5xl overflow-hidden rounded-[2rem] bg-white shadow-2xl">
                <div className="flex flex-col gap-4 bg-gradient-to-r from-slate-950 via-[#1d2736] to-[#5b0b12] p-6 text-white sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#f5b51b]">Validacion F10 · Solo vista previa</p>
                        <h2 className="mt-2 text-2xl font-black">{preview.filename}</h2>
                        <p className="mt-1 text-sm font-semibold text-white/65">El correlativo no fue reservado ni consumido.</p>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-black hover:bg-white/20">Cerrar</button>
                </div>
                <div className="space-y-5 p-5 md:p-7">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <SummaryCard label="Envio simulado" value={String(preview.shipmentNumber).padStart(5, '0')} hint={preview.applicationDate} />
                        <SummaryCard label="Lineas" value={preview.lineCount} hint="Pagos seleccionados" tone="green" />
                        <SummaryCard label="Total" value={fmt(Number(preview.totalAmount))} hint="Importe neto" tone="red" mono />
                        <SummaryCard label="Formato" value={`${preview.formatChecks.headerLength} / 191`} hint="Cabecera / detalle" tone="amber" />
                    </div>
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
                        {preview.realExport.reason}
                    </div>
                    <div className="overflow-hidden rounded-2xl border border-slate-200">
                        <div className="max-h-[48vh] overflow-auto">
                            <table className="w-full min-w-[760px] text-left text-xs">
                                <thead className="sticky top-0 bg-slate-950 text-white">
                                    <tr>
                                        <th className="px-4 py-3">#</th><th className="px-4 py-3">Proveedor / factura</th><th className="px-4 py-3">Sucursal</th><th className="px-4 py-3">Referencia BAC</th><th className="px-4 py-3 text-right">Neto</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {preview.rows.map((row) => (
                                        <tr key={row.key}>
                                            <td className="px-4 py-3 font-mono font-black text-slate-400">{row.lineNumber}</td>
                                            <td className="px-4 py-3"><div className="font-black text-slate-900">{row.supplierName}</div><div className="mt-1 font-mono text-slate-400">{row.invoiceNumber}</div></td>
                                            <td className="px-4 py-3 font-bold text-slate-600">{row.branchName}</td>
                                            <td className="px-4 py-3"><div className="font-mono font-black">{row.beneficiaryReference}</div><div className="font-mono text-slate-400">{row.bankAccount}</div></td>
                                            <td className="px-4 py-3 text-right font-mono font-black text-[#9f111a]">{fmt(row.netAmount)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="max-w-xl break-all font-mono text-[10px] font-bold text-slate-400">SHA-256: {preview.sha256}</div>
                        <button type="button" onClick={() => printTicket(preview)} className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white hover:bg-slate-800">Imprimir ticket 80 mm</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default function BacSupplierPayroll({ branchContext, canEdit = true }) {
    const today = useMemo(todayInManagua, []);
    const allowedBranches = branchContext?.allowedBranchIds?.length
        ? branchContext.allowedBranchIds
        : [branchContext?.selectedBranchId || 'granada'];
    const [dateMode, setDateMode] = useState('day');
    const [filters, setFilters] = useState({
        from: today,
        to: today,
        branchId: allowedBranches.length > 1 ? 'all' : allowedBranches[0],
    });
    const [rows, setRows] = useState([]);
    const [serverMeta, setServerMeta] = useState(null);
    const [selected, setSelected] = useState({});
    const [references, setReferences] = useState({});
    const [loading, setLoading] = useState(false);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [error, setError] = useState('');
    const [preview, setPreview] = useState(null);
    const [shipmentNumber, setShipmentNumber] = useState('1');
    const [applicationDate, setApplicationDate] = useState(today);
    const loadingRef = useRef(false);
    const queuedRefreshRef = useRef(false);
    const requestRef = useRef(0);
    const filtersRef = useRef(filters);
    const previewRef = useRef(false);
    const filterEffectMountedRef = useRef(false);

    useEffect(() => { filtersRef.current = filters; }, [filters]);
    useEffect(() => { previewRef.current = Boolean(preview) || previewLoading; }, [preview, previewLoading]);

    const loadRows = async ({ quiet = false } = {}) => {
        if (previewRef.current || document.visibilityState !== 'visible') return;
        if (loadingRef.current) {
            queuedRefreshRef.current = true;
            return;
        }
        loadingRef.current = true;
        const requestId = requestRef.current + 1;
        requestRef.current = requestId;
        const requestedFilters = { ...filtersRef.current };
        const requestedFilterKey = JSON.stringify(requestedFilters);
        if (!quiet) setLoading(true);
        setError('');
        try {
            const call = httpsCallable(functions, 'listBacSupplierPayments');
            const response = await call(requestedFilters);
            if (requestRef.current !== requestId || JSON.stringify(filtersRef.current) !== requestedFilterKey) return;
            const data = response.data || {};
            const nextRows = Array.isArray(data.candidates) ? data.candidates : [];
            setRows(nextRows);
            setServerMeta(data);
            setReferences((current) => {
                const next = {};
                nextRows.forEach((row) => {
                    const validKeys = new Set((row.bacReferences || []).map(referenceKey));
                    const existing = current[row.key];
                    if (existing && validKeys.has(existing)) next[row.key] = existing;
                    else if (validKeys.size === 1) next[row.key] = [...validKeys][0];
                });
                return next;
            });
            setSelected((current) => {
                const valid = new Map(nextRows.map((row) => [row.key, row]));
                return Object.fromEntries(Object.entries(current).filter(([key, version]) => {
                    const row = valid.get(key);
                    return row?.selectable && !row.exported && row.version === version;
                }));
            });
        } catch (loadError) {
            if (requestRef.current === requestId) setError(errorMessage(loadError));
        } finally {
            loadingRef.current = false;
            if (requestRef.current === requestId) setLoading(false);
            if (queuedRefreshRef.current && !previewRef.current) {
                queuedRefreshRef.current = false;
                window.setTimeout(() => loadRows({ quiet: true }), 0);
            }
        }
    };

    useEffect(() => {
        loadRows();
        const interval = window.setInterval(() => loadRows({ quiet: true }), REFRESH_MS);
        const onFocus = () => loadRows({ quiet: true });
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onFocus);
        return () => {
            window.clearInterval(interval);
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onFocus);
        };
    }, []);

    useEffect(() => {
        if (!filterEffectMountedRef.current) {
            filterEffectMountedRef.current = true;
            return;
        }
        loadRows();
    }, [filters.from, filters.to, filters.branchId]);

    const selectableRows = useMemo(() => rows.filter((row) => row.selectable && !row.exported), [rows]);
    const selectedRows = useMemo(() => rows.filter((row) => selected[row.key] === row.version), [rows, selected]);
    const selectedTotal = useMemo(() => selectedRows.reduce((sum, row) => sum + Number(row.netAmount || 0), 0), [selectedRows]);
    const allReadySelected = selectableRows.length > 0 && selectableRows.every((row) => selected[row.key] === row.version);
    const effectiveCanEdit = canEdit && serverMeta?.canEdit !== false;

    const setFilter = (key, value) => {
        setFilters((current) => {
            const next = { ...current, [key]: value };
            if (dateMode === 'day' && key === 'from') next.to = value;
            return next;
        });
    };

    const toggleRow = (row) => {
        if (!effectiveCanEdit || !row.selectable || row.exported || !references[row.key]) return;
        setSelected((current) => {
            const next = { ...current };
            if (next[row.key] === row.version) delete next[row.key];
            else next[row.key] = row.version;
            return next;
        });
    };

    const toggleAll = () => {
        if (!effectiveCanEdit) return;
        setSelected((current) => {
            const next = { ...current };
            if (allReadySelected) {
                selectableRows.forEach((row) => delete next[row.key]);
            } else {
                selectableRows.forEach((row) => {
                    if (references[row.key]) next[row.key] = row.version;
                });
            }
            return next;
        });
    };

    const handlePreview = async () => {
        if (!selectedRows.length || previewLoading) return;
        const missingReference = selectedRows.find((row) => !references[row.key]);
        if (missingReference) {
            setError(`Selecciona la referencia BAC de ${missingReference.supplierName}.`);
            return;
        }
        setPreviewLoading(true);
        setError('');
        try {
            const call = httpsCallable(functions, 'previewBacSupplierPaymentFile');
            const response = await call({
                ...filters,
                applicationDate,
                shipmentNumber,
                rows: selectedRows.map((row) => ({
                    key: row.key,
                    version: row.version,
                    ...parseReferenceKey(references[row.key]),
                })),
            });
            setPreview(response.data);
        } catch (previewError) {
            setError(errorMessage(previewError));
        } finally {
            setPreviewLoading(false);
        }
    };

    return (
        <div className="space-y-5">
            <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
                <div className="grid gap-6 bg-[radial-gradient(circle_at_top_right,_rgba(227,6,19,0.2),_transparent_32%),linear-gradient(135deg,#08111f,#172334_58%,#4d0d13)] p-6 text-white lg:grid-cols-[1.3fr_0.7fr] lg:p-8">
                    <div>
                        <div className="inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.28em] text-[#f5b51b]">Pagos a proveedores · Plan AR19</div>
                        <h2 className="mt-4 text-3xl font-black tracking-tight">Planilla de Pago Proveedor BAC</h2>
                        <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-white/65">Prepara pagos reales registrados desde la cuenta BAC principal, valida beneficiarios y reconcilia el total antes de generar el archivo bancario.</p>
                    </div>
                    <div className="rounded-3xl border border-white/10 bg-white/[0.07] p-5 backdrop-blur">
                        <div className="text-[10px] font-black uppercase tracking-[0.24em] text-white/50">Cuenta origen unica</div>
                        <div className="mt-2 font-mono text-lg font-black text-white">{BAC_ACCOUNT}</div>
                        <div className="mt-3 text-xs font-bold text-[#f5b51b]">Moneda NIO · BAC (2) y cuentas USD excluidas</div>
                    </div>
                </div>
                <form
                    className="grid gap-4 border-t border-slate-100 p-5 md:grid-cols-2 xl:grid-cols-[1fr_0.7fr_1fr_1fr_1fr_auto]"
                    onSubmit={(event) => { event.preventDefault(); loadRows(); }}
                >
                    <label className="space-y-1.5">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Plan de pago</span>
                        <select value="AR19" disabled className="w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2.5 text-sm font-black text-slate-700 outline-none disabled:cursor-not-allowed">
                            <option value="AR19">Plan AR19 · NIO</option>
                        </select>
                    </label>
                    <label className="space-y-1.5">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Periodo</span>
                        <select
                            value={dateMode}
                            onChange={(event) => {
                                const nextMode = event.target.value;
                                setDateMode(nextMode);
                                if (nextMode === 'day') {
                                    setFilters((current) => ({ ...current, to: current.from }));
                                }
                            }}
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-black outline-none focus:border-[#e30613]"
                        >
                            <option value="day">Un dia</option>
                            <option value="range">Intervalo</option>
                        </select>
                    </label>
                    <label className="space-y-1.5">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Desde</span>
                        <input type="date" value={filters.from} onChange={(event) => setFilter('from', event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-black outline-none focus:border-[#e30613]" required />
                    </label>
                    <label className={`space-y-1.5 ${dateMode === 'day' ? 'opacity-45' : ''}`}>
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Hasta</span>
                        <input type="date" value={filters.to} onChange={(event) => setFilter('to', event.target.value)} disabled={dateMode === 'day'} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-black outline-none focus:border-[#e30613] disabled:cursor-not-allowed" required />
                    </label>
                    <label className="space-y-1.5">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Sucursal</span>
                        <select value={filters.branchId} onChange={(event) => setFilter('branchId', event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-black outline-none focus:border-[#e30613]">
                            {allowedBranches.length > 1 && <option value="all">Consolidado</option>}
                            {allowedBranches.map((branchId) => <option key={branchId} value={branchId}>{branchLabel(branchId)}</option>)}
                        </select>
                    </label>
                    <button type="submit" disabled={loading} className="self-end rounded-xl bg-[#e30613] px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-red-900/15 transition hover:bg-[#9f111a] disabled:opacity-50">{loading ? 'Actualizando...' : 'Actualizar'}</button>
                </form>
            </div>

            {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">{error}</div>}
            {serverMeta?.realExport && !serverMeta.realExport.enabled && (
                <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
                    <Icon tone="amber">!</Icon>
                    <div><div className="font-black">Exportacion real protegida</div><div className="mt-1 text-xs font-semibold leading-5">{serverMeta.realExport.reason} La vista previa no reserva ni consume un numero de envio.</div></div>
                </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <SummaryCard label="Movimientos" value={rows.length} hint={`${filters.from} a ${filters.to}`} />
                <SummaryCard label="Listos" value={selectableRows.length} hint="Con referencia AR19" tone="green" />
                <SummaryCard label="Sin referencia" value={rows.filter((row) => !row.bacReferences?.length).length} hint="No seleccionables" tone="amber" />
                <SummaryCard label="No concilian" value={rows.filter((row) => row.reconciled === false).length} hint="Revisar asiento BAC" tone="red" />
                <SummaryCard label="Seleccionado" value={fmt(selectedTotal)} hint={`${selectedRows.length} pago(s)`} tone="red" mono />
            </div>

            <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h3 className="font-black text-slate-950">Pagos disponibles</h3>
                        <p className="mt-1 text-xs font-semibold text-slate-400">Se refresca cada 30 segundos mientras la pantalla esta visible.</p>
                    </div>
                    <button type="button" onClick={toggleAll} disabled={!effectiveCanEdit || !selectableRows.length} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-700 hover:border-[#e30613] hover:text-[#e30613] disabled:opacity-40">
                        {allReadySelected ? 'Quitar seleccion' : 'Seleccionar disponibles'}
                    </button>
                </div>

                <div className="hidden overflow-x-auto lg:block">
                    <table className="w-full min-w-[1120px] text-left text-xs">
                        <thead className="bg-slate-950 text-white">
                            <tr><th className="px-4 py-3">Sel.</th><th className="px-4 py-3">Fecha / sucursal</th><th className="px-4 py-3">Proveedor</th><th className="px-4 py-3">Factura / origen</th><th className="px-4 py-3">Referencia BAC</th><th className="px-4 py-3 text-right">Retenciones</th><th className="px-4 py-3 text-right">Importe neto</th><th className="px-4 py-3">Estado</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {rows.map((row) => (
                                <tr key={row.key} className={selected[row.key] === row.version ? 'bg-red-50/60' : 'hover:bg-slate-50'}>
                                    <td className="px-4 py-4"><input type="checkbox" checked={selected[row.key] === row.version} onChange={() => toggleRow(row)} disabled={!effectiveCanEdit || !row.selectable || !references[row.key]} className="h-4 w-4 accent-[#e30613]" /></td>
                                    <td className="px-4 py-4"><div className="font-mono font-black text-slate-900">{row.paymentDate}</div><div className="mt-1 font-bold text-slate-400">{row.branchName}</div></td>
                                    <td className="max-w-64 px-4 py-4"><div className="font-black text-slate-900">{row.supplierName}</div><div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">{row.bacReferences?.length ? 'Vinculado a Plan Pago - AR19' : 'Sin vinculacion AR19'}</div></td>
                                    <td className="px-4 py-4"><div className="font-mono font-black text-slate-800">{row.invoiceNumber}</div><div className="mt-1 font-bold text-slate-400">{row.sourceLabel}</div></td>
                                    <td className="px-4 py-4"><BacReferenceSelect row={row} value={references[row.key]} onChange={(value) => { setReferences((current) => ({ ...current, [row.key]: value })); setSelected((current) => { const next = { ...current }; delete next[row.key]; return next; }); }} disabled={!effectiveCanEdit} /></td>
                                    <td className="px-4 py-4 text-right font-mono font-bold text-slate-500">{fmt(row.retentionAmount)}</td>
                                    <td className="px-4 py-4 text-right font-mono text-sm font-black text-[#9f111a]">{fmt(row.netAmount)}</td>
                                    <td className="max-w-60 px-4 py-4"><StatusBadge row={row} />{row.reconciliationReason && <div className="mt-2 text-[10px] font-semibold leading-4 text-red-700">{row.reconciliationReason}</div>}</td>
                                </tr>
                            ))}
                            {!rows.length && !loading && <tr><td colSpan="8" className="px-6 py-16 text-center text-sm font-bold text-slate-400">No hay pagos BAC para el filtro seleccionado.</td></tr>}
                        </tbody>
                    </table>
                </div>

                <div className="grid gap-3 p-3 lg:hidden">
                    {rows.map((row) => (
                        <div key={row.key} className={`rounded-2xl border p-4 ${selected[row.key] === row.version ? 'border-red-200 bg-red-50/60' : 'border-slate-200 bg-white'}`}>
                            <div className="flex items-start gap-3">
                                <input type="checkbox" checked={selected[row.key] === row.version} onChange={() => toggleRow(row)} disabled={!effectiveCanEdit || !row.selectable || !references[row.key]} className="mt-1 h-5 w-5 accent-[#e30613]" />
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-xs font-black text-slate-500">{row.paymentDate}</span><StatusBadge row={row} /></div>
                                    <div className="mt-2 text-sm font-black text-slate-950">{row.supplierName}</div>
                                    <div className="mt-1 text-xs font-bold text-slate-400">{row.branchName} · {row.invoiceNumber}</div>
                                </div>
                            </div>
                            <div className="mt-4 rounded-xl bg-slate-50 p-3"><BacReferenceSelect row={row} value={references[row.key]} onChange={(value) => { setReferences((current) => ({ ...current, [row.key]: value })); setSelected((current) => { const next = { ...current }; delete next[row.key]; return next; }); }} disabled={!effectiveCanEdit} /></div>
                            {row.reconciliationReason && <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[11px] font-bold leading-4 text-red-700">{row.reconciliationReason}</div>}
                            <div className="mt-3 flex items-end justify-between"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ret. {fmt(row.retentionAmount)}</div><div className="font-mono text-lg font-black text-[#9f111a]">{fmt(row.netAmount)}</div></div>
                        </div>
                    ))}
                    {!rows.length && !loading && <div className="py-12 text-center text-sm font-bold text-slate-400">No hay pagos BAC para el filtro seleccionado.</div>}
                </div>
            </div>

            <div className="sticky bottom-20 z-20 rounded-[1.5rem] border border-slate-200 bg-white/95 p-4 shadow-2xl shadow-slate-950/10 backdrop-blur md:bottom-4">
                <div className="grid gap-3 md:grid-cols-[1fr_0.7fr_auto_auto] md:items-end">
                    <label className="space-y-1"><span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Fecha aplicacion</span><input type="date" value={applicationDate} onChange={(event) => setApplicationDate(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-black outline-none focus:border-[#e30613]" /></label>
                    <label className="space-y-1"><span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Envio simulado</span><input type="number" min="1" max="99999" value={shipmentNumber} onChange={(event) => setShipmentNumber(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm font-black outline-none focus:border-[#e30613]" /></label>
                    <button type="button" onClick={handlePreview} disabled={!effectiveCanEdit || !selectedRows.length || previewLoading} className="rounded-xl bg-[#e30613] px-5 py-3 text-sm font-black text-white shadow-lg shadow-red-900/15 hover:bg-[#9f111a] disabled:opacity-40">{previewLoading ? 'Validando...' : 'Vista previa F10'}</button>
                    <button type="button" disabled className="rounded-xl bg-slate-200 px-5 py-3 text-sm font-black text-slate-500">Crear archivo de pago · Bloqueado</button>
                </div>
            </div>

            <PreviewModal preview={preview} onClose={() => setPreview(null)} />
        </div>
    );
}
