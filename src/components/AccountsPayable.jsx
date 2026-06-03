// src/components/AccountsPayable.jsx
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { db } from '../firebase';
import {
    collection, doc, Timestamp, runTransaction, writeBatch,
    query, orderBy, limit, getDocs, deleteDoc
} from 'firebase/firestore';
import { APP_BRAND_NAME, DEFAULT_BRANCH_ID, DEFAULT_BRANCH_NAME, DEFAULT_CASHBOX_NAME, fmt } from '../constants';
import { deletePayableTransaction } from '../services/linkedTransactions';
import {
    buildFiscalPayload,
    getSupportFiles,
    getSupportPath,
    getSupportUrl,
    hasSupport,
    isPdfSupportRecord,
    SUPPORT_FILE_TYPES,
    uploadFiscalSupportFiles,
    uploadInvoicePhoto,
} from '../services/fiscalUtils';
import { getProviderCode, getProviderDisplayName, upsertProviderByName } from '../services/providers';

// --- ICONOS SVG INLINE ---
const Icon = ({ path, className = "w-5 h-5" }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
);

const Icons = {
    plus: "M12 4v16m8-8H4",
    trash: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
    creditCard: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
    building: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
    calendar: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
    fileText: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
    alertCircle: "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    checkCircle: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
    x: "M6 18L18 6M6 6l12 12",
    chevronRight: "M9 5l7 7-7 7",
    trendingDown: "M13 17h8m0 0V9m0 8l-8-8-4 4-6-6",
    users: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z",
    receipt: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01",
    arrowRightCircle: "M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z",
    calculator: "M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z",
    square: "M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z",
    eye: "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z",
    upload: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0l-4 4m4-4v12",
    paperClip: "M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.586-6.586a4 4 0 00-5.657-5.657L5.757 10.757a6 6 0 108.486 8.486L20.829 12.657"
};

// --- ANIMACIONES ---
const FadeIn = ({ children, delay = 0, className = "" }) => (
    <div
        className={`animate-fade-in ${className}`}
        style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
        {children}
    </div>
);

const SlideIn = ({ children, className = "" }) => (
    <div className={`animate-slide-in ${className}`}>{children}</div>
);

// --- COMPONENTES UI ---
const Card = ({ title, children, className = "", right, icon }) => (
    <div className={`rounded-xl border border-stone-200 bg-white shadow-sm overflow-hidden ${className}`}>
        <div className="flex justify-between items-center px-6 py-4 border-b border-stone-100 bg-stone-50">
            <div className="flex items-center gap-3">
                {icon && (
                    <div className="p-2 bg-[#fff1f2] rounded-lg">
                        <Icon path={Icons[icon]} className="w-4 h-4 text-[#e30613]" />
                    </div>
                )}
                <h3 className="text-sm font-bold text-slate-800 tracking-tight">{title}</h3>
            </div>
            {right}
        </div>
        <div className="p-6">{children}</div>
    </div>
);

const Button = ({ children, variant = 'primary', className = '', disabled, ...props }) => {
    const variants = {
        primary:   'bg-[#e30613] hover:bg-[#9f111a] text-white shadow-sm shadow-red-900/20',
        danger:    'bg-red-600 hover:bg-red-700 text-white shadow-sm shadow-red-500/20',
        success:   'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-500/20',
        ghost:     'bg-transparent hover:bg-stone-100 text-slate-600 border border-stone-300',
        outline:   'bg-white border-2 border-stone-200 hover:border-[#e30613] text-slate-700 hover:text-[#e30613]',
        secondary: 'bg-stone-100 hover:bg-stone-200 text-slate-700'
    };
    return (
        <button
            disabled={disabled}
            className={`px-4 py-2.5 rounded-lg font-semibold text-sm transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] ${variants[variant]} ${className}`}
            {...props}
        >
            {children}
        </button>
    );
};

const Input = ({ label, icon, className = '', ...props }) => (
    <div className="space-y-1.5">
        {label && <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</label>}
        <div className="relative group">
            {icon && <Icon path={Icons[icon]} className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-[#e30613] transition-colors" />}
            <input
                className={`w-full bg-stone-50 border border-stone-300 rounded-lg px-3.5 py-2.5 text-sm font-medium text-slate-700 outline-none transition-all focus:border-[#e30613] focus:bg-white focus:shadow-sm ${icon ? 'pl-10' : ''} ${className}`}
                {...props}
            />
        </div>
    </div>
);

const Select = ({ label, options, ...props }) => (
    <div className="space-y-1.5">
        {label && <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</label>}
        <div className="relative">
            <select
                className="w-full bg-stone-50 border border-stone-300 rounded-lg px-3.5 py-2.5 text-sm font-medium text-slate-700 outline-none transition-all focus:border-[#e30613] focus:bg-white appearance-none cursor-pointer"
                {...props}
            >
                {options}
            </select>
            <Icon path={Icons.chevronRight} className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 rotate-90 pointer-events-none" />
        </div>
    </div>
);

const Badge = ({ children, variant = 'default' }) => {
    const variants = {
        default: 'bg-stone-100 text-slate-600',
        danger:  'bg-red-50 text-red-700 border border-red-200',
        warning: 'bg-amber-50 text-amber-700 border border-amber-200',
        success: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
        info:    'bg-sky-50 text-sky-700 border border-sky-200'
    };
    return (
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${variants[variant]}`}>
            {children}
        </span>
    );
};

const Spinner = () => (
    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
);

const createEmptySupportFilesState = () => SUPPORT_FILE_TYPES.reduce((acc, item) => {
    acc[item.key] = null;
    return acc;
}, {});

const SupportFilesInput = ({ files, onChange, disabled = false, single = false }) => {
    const types = single ? SUPPORT_FILE_TYPES.slice(0, 1) : SUPPORT_FILE_TYPES;
    return (
        <div className={`grid grid-cols-1 gap-3 ${single ? '' : 'md:grid-cols-3'}`}>
            {types.map((type) => (
                <div key={type.key} className="rounded-xl border border-stone-200 bg-white p-3">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        {single ? 'Foto o PDF' : type.label}
                    </label>
                    <input
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(event) => onChange(type.key, event.target.files?.[0] || null)}
                        className="mt-2 block w-full text-xs text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-[#fff1f2] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[#e30613]"
                        disabled={disabled}
                    />
                    {files?.[type.key] && <p className="mt-2 truncate text-xs font-bold text-emerald-700">{files[type.key].name}</p>}
                </div>
            ))}
        </div>
    );
};

const DetailRow = ({ label, value, accent = false }) => (
    <div className={`rounded-xl border px-4 py-3 ${accent ? 'border-[#d8dee6] bg-[#f8fafc]' : 'border-stone-200 bg-white'}`}>
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{label}</div>
        <div className={`mt-1 break-words text-sm font-bold ${accent ? 'text-[#9f111a]' : 'text-slate-800'}`}>{value || '---'}</div>
    </div>
);

const getPaymentLabel = (method) => {
    if (method === 'efectivo') return 'Efectivo';
    if (method === 'transferencia') return 'Transferencia';
    return method || 'Sin metodo';
};

const SupportPreviewModal = ({ record, type, onClose, onAttach }) => {
    if (!record) return null;

    const isAbono = type === 'abono';
    const supportFiles = getSupportFiles(record);
    const supportUrl = supportFiles[0]?.url || getSupportUrl(record);
    const supportPath = supportFiles.map((support) => `${support.label}: ${support.path}`).join(' | ') || getSupportPath(record);
    const title = isAbono
        ? `Abono #${record.secuencia || record.id}`
        : `Factura ${record.numero || record.factura || record.id}`;
    const subtitle = isAbono
        ? `${record.proveedor || 'Proveedor'} - ${fmt(record.montoTotal || 0)}`
        : `${record.proveedor || 'Proveedor'} - Saldo ${fmt(record.saldo || 0)}`;
    const affected = record.detalleAfectado || [];

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <button className="absolute inset-0 bg-[#111827]/60 backdrop-blur-sm" onClick={onClose} aria-label="Cerrar" />
            <div className="relative grid max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-3xl border border-[#d8dee6] bg-white shadow-2xl lg:grid-cols-[1.05fr_0.95fr]">
                <div className="flex max-h-[92vh] flex-col overflow-hidden">
                    <div className="bg-gradient-to-br from-[#9f111a] to-[#111827] px-6 py-5 text-white">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-[#f5b51b]">Expediente documental</p>
                                <h2 className="mt-2 text-2xl font-black">{title}</h2>
                                <p className="mt-1 text-sm font-semibold text-white/75">{subtitle}</p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <Badge variant={hasSupport(record) ? 'success' : 'warning'}>
                                        {hasSupport(record) ? 'Con soporte' : 'Sin soporte'}
                                    </Badge>
                                    <Badge variant={isAbono ? 'info' : 'default'}>{isAbono ? 'Abono' : 'Cuenta por pagar'}</Badge>
                                </div>
                            </div>
                            <button onClick={onClose} className="rounded-xl bg-white/10 p-2 transition hover:bg-white/20">
                                <Icon path={Icons.x} className="h-5 w-5 text-white" />
                            </button>
                        </div>
                    </div>

                    <div className="overflow-y-auto p-6">
                        {isAbono ? (
                            <>
                                <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                                    <DetailRow label="Fecha" value={record.fecha} />
                                    <DetailRow label="Metodo" value={getPaymentLabel(record.paymentMethod)} />
                                    <DetailRow label="Monto abonado" value={fmt(record.montoTotal || 0)} accent />
                                </div>
                                <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                                    <div className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-slate-500">Facturas afectadas</div>
                                    {affected.length === 0 ? (
                                        <p className="text-sm font-semibold text-slate-400">Sin detalle de facturas.</p>
                                    ) : (
                                        <div className="space-y-2">
                                            {affected.map((item, index) => (
                                                <div key={`${item.id}-${index}`} className="flex items-center justify-between rounded-xl border border-stone-200 bg-white px-4 py-3">
                                                    <div>
                                                        <div className="text-xs font-black text-slate-800">Factura vinculada</div>
                                                        <div className="text-[11px] font-mono text-slate-400">{item.id}</div>
                                                    </div>
                                                    <div className="text-sm font-black text-emerald-700">{fmt(item.montoAbonado || 0)}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                                    <DetailRow label="Subtotal" value={fmt(record.subtotal ?? record.amount ?? 0)} />
                                    <DetailRow label="IVA" value={fmt(record.iva || 0)} />
                                    <DetailRow label="Total factura" value={fmt(record.total ?? record.monto ?? 0)} accent />
                                </div>
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                    <DetailRow label="Proveedor" value={record.proveedor} />
                                    <DetailRow label="Fecha emision" value={record.fecha} />
                                    <DetailRow label="Vencimiento" value={record.vencimiento || 'Sin vencimiento'} />
                                    <DetailRow label="Estado" value={record.estado} />
                                    <DetailRow label="Saldo" value={fmt(record.saldo || 0)} accent />
                                    <DetailRow label="Retenciones" value={`IR ${fmt(record.retentionIr2 || 0)} / Municipal ${fmt(record.retentionMunicipal1 || 0)}`} />
                                    <DetailRow label="Referencia pago" value={record.paymentReference} />
                                    <DetailRow label="Ruta soporte" value={supportPath} />
                                </div>
                            </>
                        )}
                    </div>

                    <div className="flex flex-wrap justify-end gap-2 border-t border-stone-200 bg-stone-50 px-6 py-4">
                        <Button variant="ghost" onClick={onClose}>Cerrar</Button>
                        <Button variant="outline" onClick={() => onAttach(record, type)} className="flex items-center gap-2">
                            <Icon path={Icons.upload} className="h-4 w-4" />
                            {supportUrl ? 'Reemplazar soporte' : 'Adjuntar soporte'}
                        </Button>
                    </div>
                </div>

                <div className="max-h-[92vh] overflow-y-auto border-l border-[#d8dee6] bg-[#fbf6f1] p-5">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                            <div className="text-xs font-black uppercase tracking-[0.25em] text-[#9f111a]">Soportes</div>
                            <p className="text-xs font-semibold text-stone-500">Factura principal y comprobantes de retenciones</p>
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
                                    {isPdfSupportRecord(support) ? (
                                        <iframe title={support.label} src={support.url} className="h-[52vh] w-full rounded-xl border border-stone-200 bg-white" />
                                    ) : (
                                        <img src={support.url} alt={support.label} className="max-h-[56vh] w-full rounded-xl object-contain" />
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-stone-300 bg-white text-center">
                            <Icon path={Icons.paperClip} className="mb-3 h-12 w-12 text-stone-300" />
                            <div className="text-sm font-black text-stone-500">Sin soporte adjunto</div>
                            <p className="mt-1 max-w-xs text-xs font-semibold text-stone-400">Adjunta una foto/PDF de soporte fiscal para esta transaccion.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const AttachSupportModal = ({ target, loading, onClose, onSave }) => {
    const [files, setFiles] = useState(createEmptySupportFilesState());
    if (!target) return null;

    const hasSelectedFile = Object.values(files).some(Boolean);
    const isAbono = target.type === 'abono';

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <button className="absolute inset-0 bg-[#111827]/55 backdrop-blur-sm" onClick={onClose} aria-label="Cerrar" />
            <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-[#d8dee6] bg-white shadow-2xl">
                <div className="bg-[#9f111a] px-6 py-5 text-white">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#f5b51b]">Soporte unico</p>
                            <h3 className="mt-2 text-xl font-black">{target.type === 'abono' ? 'Adjuntar soporte al abono' : 'Adjuntar soporte a factura'}</h3>
                            <p className="mt-1 text-xs font-semibold text-white/70">
                                {isAbono ? 'Adjunta el comprobante del abono.' : 'Adjunta factura principal y, si aplica, las dos retenciones.'}
                            </p>
                        </div>
                        <button onClick={onClose} disabled={loading} className="rounded-xl bg-white/10 p-2 transition hover:bg-white/20 disabled:opacity-50">
                            <Icon path={Icons.x} className="h-5 w-5 text-white" />
                        </button>
                    </div>
                </div>
                <div className="p-6">
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
                        Para facturas con retenciones puedes guardar hasta 3 archivos: factura, retencion IR y retencion municipal.
                    </div>
                    <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                        <SupportFilesInput
                            files={files}
                            onChange={(type, file) => setFiles((prev) => ({ ...prev, [type]: file }))}
                            disabled={loading}
                            single={isAbono}
                        />
                    </div>
                    <div className="mt-6 flex justify-end gap-2">
                        <Button variant="ghost" onClick={onClose} disabled={loading}>Cancelar</Button>
                        <Button
                            variant="success"
                            disabled={loading || !hasSelectedFile}
                            onClick={() => onSave(target, files)}
                            className="flex items-center gap-2"
                        >
                            {loading ? <><Spinner /> Guardando...</> : <><Icon path={Icons.upload} className="h-4 w-4" /> Guardar soporte</>}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- COMPONENTE PRINCIPAL ---
export function AccountsPayable({ data }) {
    const [activeTab, setActiveTab] = useState('Estado de Cuenta');
    const [expandedProviders, setExpandedProviders] = useState({});
    const [loading, setLoading] = useState(false);
    const [nuevoProveedor, setNuevoProveedor] = useState('');

    // Ref para bloquear doble-submit en cualquier operaci?n cr?tica
    const isProcessingRef = useRef(false);

    const facturas = useMemo(() => {
        return (data.cuentas_por_pagar || []).map((factura) => ({
            ...factura,
            branch: DEFAULT_BRANCH_ID,
            branchName: DEFAULT_BRANCH_NAME,
            paymentType: factura.paymentType || 'credito',
        }));
    }, [data.cuentas_por_pagar]);

    const abonos = data.abonos_pagar || [];
    const listaProveedores = useMemo(() => (
        [...(data.proveedores || [])]
            .map((provider) => ({
                ...provider,
                nombre: getProviderDisplayName(provider),
                code: provider.code || provider.codigo || getProviderCode(getProviderDisplayName(provider)),
            }))
            .filter((provider) => provider.nombre)
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    ), [data.proveedores]);

    const [facturaForm, setFacturaForm] = useState({
        fecha: new Date().toISOString().substring(0, 10),
        proveedor: '',
        numero: '',
        vencimiento: '',
        descripcion: '',
        subtotal: '',
        iva: '',
        total: '',
        retentionIr2: '',
        retentionMunicipal1: '',
        paymentReference: ''
    });
    const [facturaSupportFiles, setFacturaSupportFiles] = useState(createEmptySupportFilesState());

    // --- CALCULOS MEMOIZADOS ---
    const { facturasPorProveedor, saldoTotalGeneral, stats } = useMemo(() => {
        const groups = {};
        let totalGeneral = 0;
        let vencidas = 0;
        let porVencer = 0;
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);

        const facturasOrdenadas = [...facturas]
            .filter(f => f.estado !== 'pagado')
            .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

        facturasOrdenadas.forEach(f => {
            if (!groups[f.proveedor]) groups[f.proveedor] = { saldoTotal: 0, items: [] };
            const yaAbonado = Number((f.monto - (f.saldo || 0)).toFixed(2));
            groups[f.proveedor].items.push({ ...f, yaAbonado });
            groups[f.proveedor].saldoTotal += (f.saldo || 0);
            totalGeneral += (f.saldo || 0);

            if (f.vencimiento) {
                const venc = new Date(f.vencimiento);
                const diff = Math.ceil((venc - hoy) / (1000 * 60 * 60 * 24));
                if (diff < 0) vencidas += f.saldo || 0;
                else if (diff <= 3) porVencer += f.saldo || 0;
            }
        });

        return {
            facturasPorProveedor: groups,
            saldoTotalGeneral: totalGeneral,
            stats: { vencidas, porVencer, count: facturasOrdenadas.length }
        };
    }, [facturas]);

    // --- HANDLERS ---
    const handleSaveFactura = useCallback(async (e) => {
        e.preventDefault();
        const fiscal = buildFiscalPayload({
            subtotal: facturaForm.subtotal,
            iva: facturaForm.iva,
            total: facturaForm.total,
            retentionIr2: facturaForm.retentionIr2,
            retentionMunicipal1: facturaForm.retentionMunicipal1,
        });
        if (!facturaForm.proveedor || fiscal.total <= 0) {
            return alert("Por favor complete proveedor y montos fiscales.");
        }

        setLoading(true);
        try {
            const provider = await upsertProviderByName(facturaForm.proveedor, { source: 'cuentas_por_pagar' });
            const facturaRef = doc(collection(db, 'cuentas_por_pagar'));
            const compraRef = doc(collection(db, 'compras'), `credito_${facturaRef.id}`);
            const batch = writeBatch(db);
            const photoPayload = await uploadFiscalSupportFiles(facturaSupportFiles, 'facturas/cuentas_por_pagar', facturaRef.id);

            batch.set(facturaRef, {
                fecha: facturaForm.fecha,
                month: facturaForm.fecha.substring(0, 7),
                proveedor: provider.nombre,
                proveedorId: provider.id,
                providerCode: provider.code,
                codigoProveedor: provider.code,
                sucursal: DEFAULT_BRANCH_NAME,
                branch: DEFAULT_BRANCH_ID,
                branchName: DEFAULT_BRANCH_NAME,
                numero: facturaForm.numero?.trim() || "",
                factura: facturaForm.numero?.trim() || "",
                vencimiento: facturaForm.vencimiento || "",
                descripcion: facturaForm.descripcion?.trim().toUpperCase() || "",
                monto: fiscal.total,
                saldo: fiscal.total,
                amount: fiscal.subtotal,
                estado: 'pendiente',
                paymentType: 'credito',
                paymentReference: facturaForm.paymentReference?.trim().toUpperCase() || "",
                isInventoryCost: true,
                mirroredToCompras: true,
                mirroredPurchaseId: compraRef.id,
                ...fiscal,
                ...photoPayload,
                timestamp: Timestamp.now()
            });

            batch.set(compraRef, {
                date: facturaForm.fecha,
                month: facturaForm.fecha.substring(0, 7),
                supplier: provider.nombre,
                proveedor: provider.nombre,
                providerId: provider.id,
                proveedorId: provider.id,
                providerCode: provider.code,
                codigoProveedor: provider.code,
                invoiceNumber: facturaForm.numero?.trim() || "",
                description: facturaForm.descripcion?.trim().toUpperCase() || "",
                amount: fiscal.subtotal,
                branch: DEFAULT_BRANCH_ID,
                branchName: DEFAULT_BRANCH_NAME,
                paymentType: 'credito',
                paymentReference: facturaForm.paymentReference?.trim().toUpperCase() || "",
                isInventoryCost: true,
                sourceCollection: 'cuentas_por_pagar',
                sourceFacturaId: facturaRef.id,
                linkedPayableId: facturaRef.id,
                ...fiscal,
                ...photoPayload,
                timestamp: Timestamp.now()
            });

            await batch.commit();
            setFacturaForm(prev => ({
                ...prev,
                numero: '',
                vencimiento: '',
                descripcion: '',
                subtotal: '',
                iva: '',
                total: '',
                retentionIr2: '',
                retentionMunicipal1: '',
                paymentReference: ''
            }));
            setFacturaSupportFiles(createEmptySupportFilesState());
        } catch (error) {
            console.error(error);
            alert("Error al guardar: " + error.message);
        } finally {
            setLoading(false);
        }
    }, [facturaForm, facturaSupportFiles]);

    // --- MODAL ABONOS ---
    const [showModalAbono, setShowModalAbono] = useState(false);
    const [selectedFacturas, setSelectedFacturas] = useState([]);
    const [montoAbono, setMontoAbono] = useState('');
    const [proveedorSeleccionado, setProveedorSeleccionado] = useState('');
    const [montoPrevisualizado, setMontoPrevisualizado] = useState(0);
    const [paymentMethod, setPaymentMethod] = useState('transferencia');
    const [abonoPhoto, setAbonoPhoto] = useState(null);
    const [detailTarget, setDetailTarget] = useState(null);
    const [supportTarget, setSupportTarget] = useState(null);
    const [supportSaving, setSupportSaving] = useState(false);

    const closeModalAbono = useCallback(() => {
        setShowModalAbono(false);
        setSelectedFacturas([]);
        setMontoAbono('');
        setMontoPrevisualizado(0);
        setPaymentMethod('transferencia');
        setAbonoPhoto(null);
    }, []);

    useEffect(() => {
        const items = facturasPorProveedor[proveedorSeleccionado]?.items || [];
        const total = items
            .filter(f => selectedFacturas.includes(f.id))
            .reduce((sum, f) => sum + (f.saldo || 0), 0);
        setMontoPrevisualizado(total);
    }, [selectedFacturas, proveedorSeleccionado, facturasPorProveedor]);

    const handleSeleccionarTodas = () => {
        const items = facturasPorProveedor[proveedorSeleccionado]?.items || [];
        const allIds = items.map(f => f.id);
        setSelectedFacturas(selectedFacturas.length === allIds.length ? [] : allIds);
    };

    const handleAbonarMontoSeleccionado = () => {
        setMontoAbono(montoPrevisualizado.toFixed(2));
    };

    // Guard ref: previene doble-submit antes de que React deshabilite el bot?n via estado
    const handleRealizarAbono = useCallback(async () => {
        if (isProcessingRef.current) return;

        const montoTotalAbono = parseFloat(montoAbono);
        if (isNaN(montoTotalAbono) || montoTotalAbono <= 0 || selectedFacturas.length === 0) return;

        isProcessingRef.current = true;
        setLoading(true);
        try {
            const fechaAbono = new Date().toISOString().substring(0, 10);
            const q = query(collection(db, 'abonos_pagar'), orderBy('secuencia', 'desc'), limit(1));
            const snap = await getDocs(q);
            const nuevaSecuencia = snap.empty ? 1 : (snap.docs[0].data().secuencia + 1);
            const abonoRef = doc(collection(db, 'abonos_pagar'));
            const gastoDiarioRef = paymentMethod === 'efectivo' ? doc(collection(db, 'gastosDiarios')) : null;
            const supportPayload = abonoPhoto
                ? await uploadInvoicePhoto(abonoPhoto, 'facturas/abonos_pagar', abonoRef.id)
                : {};

            await runTransaction(db, async (transaction) => {
                let restante = montoTotalAbono;
                const facturasAfectadas = [];
                const refsYDocs = [];

                for (const fId of selectedFacturas) {
                    const ref = doc(db, 'cuentas_por_pagar', fId);
                    const snapshot = await transaction.get(ref);
                    if (!snapshot.exists()) throw new Error('Una factura no existe');
                    refsYDocs.push({ ref, snapshot, data: snapshot.data() });
                }

                refsYDocs.sort((a, b) => new Date(a.data.fecha) - new Date(b.data.fecha));

                for (const item of refsYDocs) {
                    if (restante <= 0) break;
                    const pagoParaEstaFactura = Math.min(item.data.saldo, restante);
                    const nuevoSaldo = Number((item.data.saldo - pagoParaEstaFactura).toFixed(2));
                    transaction.update(item.ref, {
                        saldo: nuevoSaldo,
                        estado: nuevoSaldo <= 0 ? 'pagado' : 'parcial'
                    });
                    facturasAfectadas.push({ id: item.snapshot.id, montoAbonado: pagoParaEstaFactura });
                    restante = Number((restante - pagoParaEstaFactura).toFixed(2));
                }

                transaction.set(abonoRef, {
                    fecha: fechaAbono,
                    montoTotal: montoTotalAbono,
                    proveedor: proveedorSeleccionado,
                    secuencia: nuevaSecuencia,
                    paymentMethod,
                    linkedGastoDiarioId: gastoDiarioRef?.id || null,
                    detalleAfectado: facturasAfectadas,
                    ...supportPayload,
                    timestamp: Timestamp.now()
                });

                if (gastoDiarioRef) {
                    transaction.set(gastoDiarioRef, {
                        fecha: fechaAbono,
                        caja: DEFAULT_CASHBOX_NAME,
                        descripcion: `ABONO A PROVEEDOR ${proveedorSeleccionado}`,
                        monto: montoTotalAbono,
                        tipo: 'ABONO',
                        categoria: 'ABONO',
                        sucursal: DEFAULT_BRANCH_ID,
                        branch: DEFAULT_BRANCH_ID,
                        branchName: DEFAULT_BRANCH_NAME,
                        origen: 'abonos_pagar',
                        linkedAbonoId: abonoRef.id,
                        paymentMethod,
                        ...supportPayload,
                        timestamp: Timestamp.now()
                    });
                }
            });

            closeModalAbono();
        } catch (e) {
            alert("Error: " + e.message);
        } finally {
            isProcessingRef.current = false;
            setLoading(false);
        }
    }, [abonoPhoto, closeModalAbono, montoAbono, paymentMethod, selectedFacturas, proveedorSeleccionado]);

    const handleDeleteAbono = useCallback(async (abonoDoc) => {
        if (isProcessingRef.current) return;
        if (!window.confirm(`?Anular abono #${abonoDoc.secuencia}?`)) return;

        isProcessingRef.current = true;
        setLoading(true);
        try {
            await runTransaction(db, async (transaction) => {
                const facturasParaActualizar = [];
                for (const item of abonoDoc.detalleAfectado || []) {
                    const fRef = doc(db, 'cuentas_por_pagar', item.id);
                    const fDoc = await transaction.get(fRef);
                    if (fDoc.exists()) {
                        facturasParaActualizar.push({ ref: fRef, snapshot: fDoc, abonado: item.montoAbonado });
                    }
                }
                for (const fObj of facturasParaActualizar) {
                    const dataF = fObj.snapshot.data();
                    const nuevoSaldo = Number((dataF.saldo + fObj.abonado).toFixed(2));
                    transaction.update(fObj.ref, {
                        saldo: nuevoSaldo,
                        estado: nuevoSaldo >= dataF.monto ? 'pendiente' : 'parcial'
                    });
                }
                if (abonoDoc.paymentMethod === 'efectivo' && abonoDoc.linkedGastoDiarioId) {
                    transaction.delete(doc(db, 'gastosDiarios', abonoDoc.linkedGastoDiarioId));
                }
                transaction.delete(doc(db, 'abonos_pagar', abonoDoc.id));
            });
        } catch (e) {
            alert("Error: " + e.message);
        } finally {
            isProcessingRef.current = false;
            setLoading(false);
        }
    }, []);

    const handleDeleteFactura = useCallback(async (factura) => {
        if (isProcessingRef.current) return;
        if (!window.confirm('?Eliminar esta factura y su compra vinculada?')) return;

        isProcessingRef.current = true;
        setLoading(true);
        try {
            const result = await deletePayableTransaction(factura.id);
            if (result?.blocked) {
                const abonosLabel = (result.blockingAbonos || [])
                    .map(a => `#${a.secuencia || a.id}`)
                    .join(', ');
                alert(`No se puede eliminar: tiene abono(s) ${abonosLabel}. Anulalos primero desde Historial Abonos.`);
            }
        } catch (e) {
            alert('Error: ' + e.message);
        } finally {
            isProcessingRef.current = false;
            setLoading(false);
        }
    }, []);

    const openAttachSupport = useCallback((record, type) => {
        setSupportTarget({ record, type });
    }, []);

    const handleSaveSupport = useCallback(async (target, files) => {
        if (!target?.record?.id || !Object.values(files || {}).some(Boolean) || supportSaving) return;

        setSupportSaving(true);
        try {
            const isAbono = target.type === 'abono';
            const collectionName = isAbono ? 'abonos_pagar' : 'cuentas_por_pagar';
            const folder = isAbono ? 'facturas/abonos_pagar' : 'facturas/cuentas_por_pagar';
            const supportPayload = isAbono
                ? await uploadInvoicePhoto(files.invoice, folder, target.record.id)
                : await uploadFiscalSupportFiles(files, folder, target.record.id, target.record);
            const sharedPayload = {
                ...supportPayload,
                supportSourceCollection: collectionName,
                supportSourceDocId: target.record.id,
                supportUpdatedAt: Timestamp.now(),
            };
            const batch = writeBatch(db);

            batch.set(doc(db, collectionName, target.record.id), sharedPayload, { merge: true });

            if (!isAbono && target.record.mirroredPurchaseId) {
                batch.set(doc(db, 'compras', target.record.mirroredPurchaseId), sharedPayload, { merge: true });
            }

            if (!isAbono && (target.record.mirroredExpenseId || target.record.linkedExpenseId)) {
                batch.set(doc(db, 'gastos', target.record.mirroredExpenseId || target.record.linkedExpenseId), sharedPayload, { merge: true });
            }

            if (isAbono && target.record.linkedGastoDiarioId) {
                batch.set(doc(db, 'gastosDiarios', target.record.linkedGastoDiarioId), sharedPayload, { merge: true });
            }

            await batch.commit();
            setDetailTarget(prev => (
                prev?.record?.id === target.record.id && prev?.type === target.type
                    ? { ...prev, record: { ...prev.record, ...sharedPayload } }
                    : prev
            ));
            setSupportTarget(null);
        } catch (error) {
            console.error(error);
            alert('No se pudo guardar el soporte: ' + error.message);
        } finally {
            setSupportSaving(false);
        }
    }, [supportSaving]);

    const handleAddProveedor = useCallback(async (e) => {
        e.preventDefault();
        if (!nuevoProveedor.trim()) return;
        setLoading(true);
        try {
            await upsertProviderByName(nuevoProveedor, { source: 'cuentas_por_pagar' });
            setNuevoProveedor('');
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [nuevoProveedor]);

    // --- HELPERS ---
    const getVencimientoInfo = (fechaVenc) => {
        if (!fechaVenc) return { text: 'Sin vencimiento', variant: 'default' };
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        const venc = new Date(fechaVenc);
        const diffDays = Math.ceil((venc - hoy) / (1000 * 60 * 60 * 24));
        if (diffDays < 0) return { text: `${Math.abs(diffDays)}d vencida`, variant: 'danger' };
        if (diffDays === 0) return { text: 'Vence hoy', variant: 'warning' };
        if (diffDays <= 3) return { text: `${diffDays}d por vencer`, variant: 'warning' };
        return { text: `${diffDays} d?as`, variant: 'success' };
    };

    const tabs = [
        { id: 'Ingresar Factura',    icon: 'plus',         label: 'Nueva Factura' },
        { id: 'Estado de Cuenta',    icon: 'trendingDown',  label: 'Estado de Cuenta' },
        { id: 'Historial Abonos',    icon: 'receipt',       label: 'Historial Abonos' },
        { id: 'Base de Proveedores', icon: 'users',         label: 'Proveedores' }
    ];

    return (
        <div className="min-h-screen p-4 md:p-8">
            <style>{`
                @keyframes fade-in {
                    from { opacity: 0; transform: translateY(14px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                @keyframes slide-in {
                    from { opacity: 0; transform: translateX(14px); }
                    to   { opacity: 1; transform: translateX(0); }
                }
                .animate-fade-in { animation: fade-in 0.35s ease-out; }
                .animate-slide-in { animation: slide-in 0.3s ease-out; }
                .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: #f5f5f5; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 2px; }
            `}</style>

            <div className="max-w-7xl mx-auto">

                {/* -- ENCABEZADO CORPORATIVO -- */}
                <FadeIn className="mb-7">
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-[0.34em] text-[#e30613]">{APP_BRAND_NAME}</p>
                                <h1 className="mt-1 text-xl font-black tracking-tight text-slate-950">Cuentas por pagar</h1>
                            </div>
                            <div className="hidden md:flex items-center gap-3">
                                <div className="text-right">
                                    <div className="text-[10px] text-slate-400 uppercase tracking-widest font-black">Total pendiente</div>
                                    <div className="font-mono text-2xl font-black text-[#e30613]">{fmt(saldoTotalGeneral)}</div>
                                </div>
                                <div className="w-11 h-11 bg-red-50 rounded-xl flex items-center justify-center">
                                    <Icon path={Icons.trendingDown} className="w-5 h-5 text-[#e30613]" />
                                </div>
                            </div>
                        </div>
                    </div>
                </FadeIn>

                {/* -- TARJETAS DE RESUMEN -- */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <FadeIn delay={60} className="bg-[#e30613] rounded-xl p-5 text-white shadow-md shadow-red-900/20">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-red-200 text-[10px] font-bold uppercase tracking-widest">Saldo Total</span>
                            <div className="w-8 h-8 bg-white/15 rounded-lg flex items-center justify-center">
                                <Icon path={Icons.trendingDown} className="w-4 h-4 text-white" />
                            </div>
                        </div>
                        <div className="text-2xl font-bold">{fmt(saldoTotalGeneral)}</div>
                        <div className="text-red-200 text-xs mt-1.5">
                            {stats.count} {stats.count === 1 ? 'factura pendiente' : 'facturas pendientes'}
                        </div>
                    </FadeIn>

                    <FadeIn delay={120} className="bg-white rounded-xl p-5 border border-stone-200 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-red-600 text-[10px] font-bold uppercase tracking-widest">Vencidas</span>
                            <div className="w-8 h-8 bg-red-50 rounded-lg flex items-center justify-center">
                                <Icon path={Icons.alertCircle} className="w-4 h-4 text-red-500" />
                            </div>
                        </div>
                        <div className="text-2xl font-bold text-red-600">{fmt(stats.vencidas)}</div>
                        <div className="text-slate-400 text-xs mt-1.5">Requieren atenci?n inmediata</div>
                    </FadeIn>

                    <FadeIn delay={180} className="bg-white rounded-xl p-5 border border-stone-200 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-amber-600 text-[10px] font-bold uppercase tracking-widest">Por Vencer (3d)</span>
                            <div className="w-8 h-8 bg-amber-50 rounded-lg flex items-center justify-center">
                                <Icon path={Icons.calendar} className="w-4 h-4 text-amber-500" />
                            </div>
                        </div>
                        <div className="text-2xl font-bold text-amber-600">{fmt(stats.porVencer)}</div>
                        <div className="text-slate-400 text-xs mt-1.5">Pr?ximas a vencer</div>
                    </FadeIn>
                </div>

                {/* -- NAVEGACION TABS -- */}
                <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-1.5 mb-6">
                    <div className="flex flex-wrap gap-1.5">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-xs transition-all duration-200 ${
                                    activeTab === tab.id
                                        ? 'bg-[#e30613] text-white shadow-sm shadow-red-900/20'
                                        : 'text-slate-500 hover:bg-stone-50 hover:text-slate-700'
                                }`}
                            >
                                <Icon path={Icons[tab.icon]} className="w-3.5 h-3.5" />
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* -- CONTENIDO TABS -- */}
                <div>

                    {/* TAB: Nueva Factura */}
                    {activeTab === 'Ingresar Factura' && (
                        <SlideIn className="max-w-2xl mx-auto">
                            <Card title="Registrar Nueva Factura" icon="fileText">
                                <form onSubmit={handleSaveFactura} className="space-y-5">
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800">
                                        Las facturas registradas aqu? se contabilizan como costo a cr?dito en {DEFAULT_BRANCH_NAME}.
                                    </div>

                                    <Select
                                        label="Proveedor"
                                        value={facturaForm.proveedor}
                                        onChange={e => setFacturaForm({ ...facturaForm, proveedor: e.target.value })}
                                        required
                                        options={
                                            <>
                                                <option value="">Seleccionar proveedor...</option>
                                                {listaProveedores
                                                    .map(p => <option key={p.id} value={p.nombre}>{p.code} - {p.nombre}</option>)
                                                }
                                            </>
                                        }
                                    />

                                    <div className="grid grid-cols-2 gap-4">
                                        <Input
                                            label="Fecha Emisi?n"
                                            type="date"
                                            icon="calendar"
                                            value={facturaForm.fecha}
                                            onChange={e => setFacturaForm({ ...facturaForm, fecha: e.target.value })}
                                            required
                                        />
                                        <Input
                                            label="Fecha Vencimiento"
                                            type="date"
                                            icon="calendar"
                                            value={facturaForm.vencimiento}
                                            onChange={e => setFacturaForm({ ...facturaForm, vencimiento: e.target.value })}
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <Input
                                            label="N? Factura"
                                            icon="fileText"
                                            placeholder="Ej: 001-001-000000001"
                                            value={facturaForm.numero}
                                            onChange={e => setFacturaForm({ ...facturaForm, numero: e.target.value })}
                                        />
                                        <Input
                                            label="Subtotal (C$)"
                                            type="number"
                                            step="0.01"
                                            icon="creditCard"
                                            placeholder="0.00"
                                            value={facturaForm.subtotal}
                                            onChange={e => setFacturaForm({ ...facturaForm, subtotal: e.target.value })}
                                            required
                                        />
                                    </div>

                                    <Input
                                        label="Descripcion"
                                        icon="fileText"
                                        placeholder="Detalle de la compra"
                                        value={facturaForm.descripcion}
                                        onChange={e => setFacturaForm({ ...facturaForm, descripcion: e.target.value })}
                                    />

                                    <div className="grid grid-cols-2 gap-4">
                                        <Input
                                            label="IVA (C$)"
                                            type="number"
                                            step="0.01"
                                            icon="calculator"
                                            placeholder="0.00"
                                            value={facturaForm.iva}
                                            onChange={e => setFacturaForm({ ...facturaForm, iva: e.target.value })}
                                        />
                                        <Input
                                            label="Total (C$)"
                                            type="number"
                                            step="0.01"
                                            icon="creditCard"
                                            placeholder="0.00"
                                            value={facturaForm.total}
                                            onChange={e => setFacturaForm({ ...facturaForm, total: e.target.value })}
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <Input
                                            label="Retencion IR 2%"
                                            type="number"
                                            step="0.01"
                                            icon="calculator"
                                            placeholder="0.00"
                                            value={facturaForm.retentionIr2}
                                            onChange={e => setFacturaForm({ ...facturaForm, retentionIr2: e.target.value })}
                                        />
                                        <Input
                                            label="Retencion Municipal 1%"
                                            type="number"
                                            step="0.01"
                                            icon="calculator"
                                            placeholder="0.00"
                                            value={facturaForm.retentionMunicipal1}
                                            onChange={e => setFacturaForm({ ...facturaForm, retentionMunicipal1: e.target.value })}
                                        />
                                    </div>

                                    <Input
                                        label="Referencia de pago"
                                        icon="receipt"
                                        placeholder="Transferencia, nota, orden..."
                                        value={facturaForm.paymentReference}
                                        onChange={e => setFacturaForm({ ...facturaForm, paymentReference: e.target.value })}
                                    />

                                    <div className="space-y-2 rounded-xl border border-[#d8dee6] bg-[#f8fafc] p-3">
                                        <div>
                                            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Soportes fiscales</label>
                                            <p className="mt-1 text-xs font-semibold text-slate-400">Factura principal + retencion IR + retencion municipal.</p>
                                        </div>
                                        <SupportFilesInput
                                            files={facturaSupportFiles}
                                            onChange={(type, file) => setFacturaSupportFiles((prev) => ({ ...prev, [type]: file }))}
                                            disabled={loading}
                                        />
                                    </div>

                                    <Button type="submit" disabled={loading} className="w-full py-3">
                                        {loading ? <span className="flex items-center justify-center gap-2"><Spinner /> Guardando...</span> : 'Guardar Factura'}
                                    </Button>
                                </form>
                            </Card>
                        </SlideIn>
                    )}

                    {/* TAB: Estado de Cuenta */}
                    {activeTab === 'Estado de Cuenta' && (
                        <div className="space-y-5">
                            {Object.entries(facturasPorProveedor).map(([prov, provData], idx) => {
                                const isExpanded = Boolean(expandedProviders[prov]);
                                const providerCode = provData.items[0]?.codigoProveedor || provData.items[0]?.providerCode || getProviderCode(prov);
                                const vencidasProveedor = provData.items.filter((f) => getVencimientoInfo(f.vencimiento).variant === 'danger').length;

                                return (
                                    <FadeIn key={prov} delay={idx * 45}>
                                        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                                            <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                                                <button
                                                    type="button"
                                                    onClick={() => setExpandedProviders((prev) => ({ ...prev, [prov]: !prev[prov] }))}
                                                    className="group flex min-w-0 flex-1 items-center gap-4 rounded-xl px-2 py-1 text-left transition hover:bg-slate-50"
                                                >
                                                    <div className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-xl bg-slate-950 text-white shadow-sm">
                                                        <Icon path={Icons.building} className="h-5 w-5" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <h3 className="truncate text-base font-black uppercase tracking-tight text-slate-950">{prov}</h3>
                                                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] font-black uppercase tracking-wider text-slate-500">{providerCode}</span>
                                                            {vencidasProveedor > 0 && (
                                                                <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-red-700">
                                                                    {vencidasProveedor} vencida{vencidasProveedor === 1 ? '' : 's'}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="mt-1 text-xs font-semibold text-slate-500">
                                                            {provData.items.length} {provData.items.length === 1 ? 'factura pendiente' : 'facturas pendientes'} · saldo abierto {fmt(provData.saldoTotal)}
                                                        </div>
                                                    </div>
                                                    <Icon path={Icons.chevronRight} className={`ml-auto h-5 w-5 flex-shrink-0 text-slate-400 transition ${isExpanded ? 'rotate-90 text-[#e30613]' : ''}`} />
                                                </button>

                                                <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 lg:min-w-[290px]">
                                                    <div>
                                                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Saldo proveedor</div>
                                                        <div className="font-mono text-xl font-black text-[#e30613]">{fmt(provData.saldoTotal)}</div>
                                                    </div>
                                                    <Button
                                                        variant="success"
                                                        disabled={loading}
                                                        onClick={() => {
                                                            setProveedorSeleccionado(prov);
                                                            setSelectedFacturas([]);
                                                            setMontoAbono('');
                                                            setMontoPrevisualizado(0);
                                                            setPaymentMethod('transferencia');
                                                            setShowModalAbono(true);
                                                        }}
                                                        className="flex items-center gap-1.5 whitespace-nowrap"
                                                    >
                                                        <Icon path={Icons.creditCard} className="w-3.5 h-3.5" />
                                                        Abonar
                                                    </Button>
                                                </div>
                                            </div>

                                            {isExpanded && (
                                                <div className="border-t border-slate-200 bg-slate-50/70 p-3">
                                                    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                                                        <table className="w-full text-sm">
                                                            <thead className="bg-slate-950">
                                                                <tr>
                                                                    {['N° Factura', 'Emisión', 'Vencimiento', 'Monto', 'Abonado', 'Saldo', 'Estado', ''].map(h => (
                                                                        <th key={h} className={`px-4 py-3 text-[10px] font-black uppercase tracking-wider text-white/70 ${h === '' || h === 'Monto' || h === 'Abonado' || h === 'Saldo' ? 'text-right' : h === 'Estado' ? 'text-center' : 'text-left'}`}>
                                                                            {h}
                                                                        </th>
                                                                    ))}
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-slate-100">
                                                                {provData.items.map(f => {
                                                                    const vencInfo = getVencimientoInfo(f.vencimiento);
                                                                    return (
                                                                        <tr key={f.id} className="group transition-colors">
                                                                            <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700">{f.numero}</td>
                                                                            <td className="px-4 py-3 text-xs text-slate-500">{f.fecha}</td>
                                                                            <td className="px-4 py-3">
                                                                                <Badge variant={vencInfo.variant}>{vencInfo.text}</Badge>
                                                                            </td>
                                                                            <td className="px-4 py-3 text-right text-xs font-medium text-slate-500">{fmt(f.monto)}</td>
                                                                            <td className="px-4 py-3 text-right text-xs font-semibold text-emerald-600">
                                                                                {f.yaAbonado > 0 ? fmt(f.yaAbonado) : <span className="text-slate-300">---</span>}
                                                                            </td>
                                                                            <td className="px-4 py-3 text-right font-mono font-black text-[#e30613]">{fmt(f.saldo)}</td>
                                                                            <td className="px-4 py-3 text-center">
                                                                                <Badge variant={f.estado === 'parcial' ? 'warning' : 'danger'}>
                                                                                    {f.estado === 'parcial' ? 'Parcial' : 'Pendiente'}
                                                                                </Badge>
                                                                            </td>
                                                                            <td className="px-4 py-3 text-center">
                                                                                <div className="flex items-center justify-end gap-1.5">
                                                                                    <button
                                                                                        onClick={() => setDetailTarget({ record: f, type: 'factura' })}
                                                                                        disabled={loading}
                                                                                        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold uppercase transition disabled:opacity-20 ${
                                                                                            hasSupport(f)
                                                                                                ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                                                                                : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                                                                                        }`}
                                                                                        title={hasSupport(f) ? 'Ver soporte' : 'Adjuntar soporte'}
                                                                                    >
                                                                                        <Icon path={Icons.eye} className="w-3.5 h-3.5" />
                                                                                        {hasSupport(f) ? 'Ver' : 'Soporte'}
                                                                                    </button>
                                                                                    <button
                                                                                        onClick={() => openAttachSupport(f, 'factura')}
                                                                                        disabled={loading}
                                                                                        className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all disabled:opacity-20"
                                                                                        title="Adjuntar soporte"
                                                                                    >
                                                                                        <Icon path={Icons.upload} className="w-3.5 h-3.5" />
                                                                                    </button>
                                                                                    <button
                                                                                        onClick={() => handleDeleteFactura(f)}
                                                                                        disabled={loading}
                                                                                        className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100 disabled:opacity-20"
                                                                                    >
                                                                                        <Icon path={Icons.trash} className="w-3.5 h-3.5" />
                                                                                    </button>
                                                                                </div>
                                                                            </td>
                                                                        </tr>
                                                                    );
                                                                })}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            )}
                                        </section>
                                    </FadeIn>
                                );
                            })}

                            {Object.keys(facturasPorProveedor).length === 0 && (
                                <div className="text-center py-16 bg-white rounded-xl border border-dashed border-stone-300">
                                    <div className="w-14 h-14 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-3">
                                        <Icon path={Icons.checkCircle} className="w-7 h-7 text-emerald-500" />
                                    </div>
                                    <h3 className="text-base font-bold text-slate-700">Todo al d?a</h3>
                                    <p className="text-sm text-slate-400 mt-1">No hay facturas pendientes por pagar</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* TAB: Historial Abonos */}
                    {activeTab === 'Historial Abonos' && (
                        <SlideIn>
                            <Card title="Historial de Abonos" icon="receipt">
                                {abonos.length === 0 ? (
                                    <div className="text-center py-12">
                                        <Icon path={Icons.receipt} className="w-10 h-10 mx-auto mb-3 text-stone-300" />
                                        <p className="text-sm font-medium text-slate-400">No hay abonos registrados</p>
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto rounded-lg border border-stone-200">
                                        <table className="w-full text-sm">
                                            <thead className="bg-stone-50 border-b border-stone-200">
                                                <tr>
                                                    {['Recibo #', 'Fecha', 'Proveedor', 'M?todo', 'Monto', 'Acci?n'].map(h => (
                                                        <th key={h} className={`px-4 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider ${h === 'Monto' ? 'text-right' : h === 'Acci?n' ? 'text-center' : 'text-left'}`}>
                                                            {h}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-stone-100">
                                                {abonos.sort((a, b) => b.secuencia - a.secuencia).map(a => (
                                                    <tr key={a.id} className="hover:bg-stone-50 transition-colors">
                                                        <td className="px-4 py-3 font-mono font-bold text-[#e30613]">#{a.secuencia}</td>
                                                        <td className="px-4 py-3 text-xs text-slate-500">{a.fecha}</td>
                                                        <td className="px-4 py-3 font-semibold text-slate-800 text-xs">{a.proveedor}</td>
                                                        <td className="px-4 py-3">
                                                            <Badge variant={a.paymentMethod === 'efectivo' ? 'warning' : 'info'}>
                                                                {a.paymentMethod === 'efectivo' ? 'Efectivo' : 'Transferencia'}
                                                            </Badge>
                                                        </td>
                                                        <td className="px-4 py-3 text-right font-bold text-emerald-600">{fmt(a.montoTotal)}</td>
                                                        <td className="px-4 py-3 text-center">
                                                            <div className="flex items-center justify-center gap-1.5">
                                                                <button
                                                                    onClick={() => setDetailTarget({ record: a, type: 'abono' })}
                                                                    disabled={loading}
                                                                    className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold uppercase transition disabled:opacity-20 ${
                                                                        hasSupport(a)
                                                                            ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                                                            : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                                                                    }`}
                                                                    title={hasSupport(a) ? 'Ver soporte' : 'Adjuntar soporte'}
                                                                >
                                                                    <Icon path={Icons.eye} className="w-3.5 h-3.5" />
                                                                    {hasSupport(a) ? 'Ver' : 'Soporte'}
                                                                </button>
                                                                <button
                                                                    onClick={() => openAttachSupport(a, 'abono')}
                                                                    disabled={loading}
                                                                    className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all disabled:opacity-20"
                                                                    title="Adjuntar soporte"
                                                                >
                                                                    <Icon path={Icons.upload} className="w-3.5 h-3.5" />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDeleteAbono(a)}
                                                                    disabled={loading}
                                                                    className="text-red-500 hover:text-red-700 font-semibold text-xs uppercase px-3 py-1 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                                                >
                                                                    Anular
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </Card>
                        </SlideIn>
                    )}

                    {/* TAB: Base de Proveedores */}
                    {activeTab === 'Base de Proveedores' && (
                        <SlideIn className="max-w-2xl mx-auto">
                            <Card title="Directorio de Proveedores" icon="users">
                                <form onSubmit={handleAddProveedor} className="flex gap-2 mb-5">
                                    <input
                                        type="text"
                                        placeholder="Nombre del nuevo proveedor..."
                                        className="flex-1 bg-stone-50 border border-stone-300 rounded-lg px-3.5 py-2.5 text-sm font-medium uppercase outline-none focus:border-[#e30613] focus:bg-white transition-all"
                                        value={nuevoProveedor}
                                        onChange={e => setNuevoProveedor(e.target.value)}
                                    />
                                    <Button type="submit" disabled={loading || !nuevoProveedor.trim()} className="flex items-center gap-1.5">
                                        <Icon path={Icons.plus} className="w-4 h-4" />
                                        Agregar
                                    </Button>
                                </form>

                                <div className="space-y-2">
                                    {listaProveedores
                                        .map((p, idx) => (
                                            <FadeIn key={p.id} delay={idx * 25}>
                                                <div className="flex items-center justify-between px-4 py-3 bg-stone-50 rounded-lg border border-stone-200 hover:border-[#e30613]/30 hover:shadow-sm transition-all group">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 bg-[#e30613] rounded-lg flex items-center justify-center text-white font-bold text-xs">
                                                            {p.nombre.charAt(0)}
                                                        </div>
                                                        <div>
                                                            <span className="font-semibold text-slate-700 text-sm">{p.nombre}</span>
                                                            <div className="font-mono text-[10px] font-black uppercase tracking-wider text-slate-400">{p.code}</div>
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => deleteDoc(doc(db, 'proveedores', p.id))}
                                                        className="p-1.5 text-stone-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                                    >
                                                        <Icon path={Icons.trash} className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </FadeIn>
                                        ))
                                    }
                                </div>
                            </Card>
                        </SlideIn>
                    )}
                </div>

                {/* -- MODAL ABONO -- */}
                {showModalAbono && (
                    <div
                        className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
                        onClick={closeModalAbono}
                    >
                        <div
                            className="bg-white rounded-xl max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto custom-scrollbar animate-slide-in"
                            onClick={e => e.stopPropagation()}
                        >
                            {/* Modal header con franja de color */}
                            <div className="h-1 bg-gradient-to-r from-[#e30613] via-[#f5b51b] to-[#e30613]" />
                            <div className="px-6 py-5">
                                <div className="flex items-start justify-between mb-5">
                                    <div>
                                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#e30613] mb-0.5">Registrar Pago</p>
                                        <h3 className="text-lg font-bold text-slate-900">Realizar Abono</h3>
                                        <p className="text-sm text-slate-500">{proveedorSeleccionado}</p>
                                    </div>
                                    <button
                                        onClick={closeModalAbono}
                                        disabled={loading}
                                        className="p-1.5 hover:bg-stone-100 rounded-lg transition-colors disabled:opacity-40"
                                    >
                                        <Icon path={Icons.x} className="w-5 h-5 text-slate-400" />
                                    </button>
                                </div>

                                {/* Resumen de selecci?n */}
                                <div className="bg-stone-50 rounded-lg border border-stone-200 p-4 mb-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Facturas a incluir</span>
                                        <button
                                            onClick={handleSeleccionarTodas}
                                            className="text-xs font-semibold text-[#e30613] hover:text-[#9f111a] transition-colors"
                                        >
                                            {selectedFacturas.length === (facturasPorProveedor[proveedorSeleccionado]?.items || []).length
                                                ? 'Desmarcar todas'
                                                : 'Seleccionar todas'}
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="bg-white rounded-lg border border-stone-200 p-3">
                                            <div className="text-[10px] text-slate-400 font-bold uppercase mb-1">Seleccionadas</div>
                                            <div className="text-xl font-bold text-slate-800">
                                                {selectedFacturas.length}
                                                <span className="text-sm font-normal text-slate-400"> / {facturasPorProveedor[proveedorSeleccionado]?.items.length || 0}</span>
                                            </div>
                                        </div>
                                        <div className="bg-white rounded-lg border border-stone-200 p-3">
                                            <div className="text-[10px] text-slate-400 font-bold uppercase mb-1">Total seleccionado</div>
                                            <div className="text-xl font-bold text-[#e30613]">{fmt(montoPrevisualizado)}</div>
                                        </div>
                                    </div>
                                </div>

                                {/* Lista de facturas */}
                                <div className="space-y-1.5 mb-4 max-h-48 overflow-y-auto custom-scrollbar">
                                    {facturasPorProveedor[proveedorSeleccionado]?.items.map(f => (
                                        <label
                                            key={f.id}
                                            className={`flex items-center p-3 rounded-lg border cursor-pointer transition-all ${
                                                selectedFacturas.includes(f.id)
                                                    ? 'border-[#e30613] bg-[#fff5f5] shadow-sm'
                                                    : 'border-stone-200 bg-white hover:border-stone-300'
                                            }`}
                                        >
                                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center mr-3 flex-shrink-0 transition-colors ${
                                                selectedFacturas.includes(f.id)
                                                    ? 'bg-[#e30613] border-[#e30613]'
                                                    : 'border-stone-300'
                                            }`}>
                                                {selectedFacturas.includes(f.id) && (
                                                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3.5">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                    </svg>
                                                )}
                                            </div>
                                            <input
                                                type="checkbox"
                                                className="hidden"
                                                checked={selectedFacturas.includes(f.id)}
                                                onChange={e => {
                                                    if (e.target.checked) {
                                                        setSelectedFacturas([...selectedFacturas, f.id]);
                                                    } else {
                                                        setSelectedFacturas(selectedFacturas.filter(id => id !== f.id));
                                                    }
                                                }}
                                            />
                                            <div className="flex-1 min-w-0">
                                                <div className="font-semibold text-slate-800 text-xs">Factura #{f.numero}</div>
                                                <div className="text-[10px] text-slate-400">Emisi?n: {f.fecha}</div>
                                            </div>
                                            <div className="text-right ml-3">
                                                <div className="font-bold text-[#e30613] text-sm">{fmt(f.saldo)}</div>
                                                <div className="text-[10px] text-slate-400">saldo</div>
                                            </div>
                                        </label>
                                    ))}
                                </div>

                                {/* Monto a abonar */}
                                <div className="mb-4 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Monto a Abonar</label>
                                        {selectedFacturas.length > 0 && (
                                            <button
                                                onClick={handleAbonarMontoSeleccionado}
                                                className="text-xs font-semibold text-emerald-600 hover:text-emerald-800 px-2 py-1 hover:bg-emerald-50 rounded-lg transition-colors flex items-center gap-1"
                                            >
                                                <Icon path={Icons.calculator} className="w-3 h-3" />
                                                Usar total ({fmt(montoPrevisualizado)})
                                            </button>
                                        )}
                                    </div>
                                    <div className="relative">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-bold text-slate-400">C$</span>
                                        <input
                                            type="number"
                                            step="0.01"
                                            className="w-full bg-stone-50 border-2 border-stone-200 rounded-lg pl-11 pr-4 py-3 text-xl font-bold text-[#e30613] text-center outline-none focus:border-[#e30613] focus:bg-white transition-all"
                                            value={montoAbono}
                                            onChange={e => setMontoAbono(e.target.value)}
                                            placeholder="0.00"
                                        />
                                    </div>
                                    {parseFloat(montoAbono) > montoPrevisualizado && montoPrevisualizado > 0 && (
                                        <div className="text-xs text-amber-600 font-medium flex items-center gap-1.5">
                                            <Icon path={Icons.alertCircle} className="w-3.5 h-3.5" />
                                            El monto supera el total seleccionado.
                                        </div>
                                    )}
                                </div>

                                {/* M?todo de pago */}
                                <div className="mb-5">
                                    <Select
                                        label="M?todo de Pago"
                                        value={paymentMethod}
                                        onChange={e => setPaymentMethod(e.target.value)}
                                        options={
                                            <>
                                                <option value="transferencia">Transferencia</option>
                                                <option value="efectivo">Efectivo</option>
                                            </>
                                        }
                                    />
                                    <p className="text-xs text-slate-400 mt-1.5">
                                        {paymentMethod === 'efectivo'
                                            ? 'Se registrara tambien en Gastos Diarios como salida de caja.'
                                            : 'Solo actualiza el saldo de la cuenta por pagar.'}
                                    </p>
                                </div>

                                {/* Botones de acci?n */}
                                <div className="mb-5 rounded-xl border border-stone-200 bg-stone-50 p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Soporte del abono</label>
                                            <p className="mt-1 text-xs font-semibold text-slate-500">Comprobante de transferencia, recibo, foto o PDF.</p>
                                        </div>
                                        <Icon path={Icons.paperClip} className="h-5 w-5 text-slate-300" />
                                    </div>
                                    <input
                                        type="file"
                                        accept="image/*,.pdf"
                                        onChange={e => setAbonoPhoto(e.target.files?.[0] || null)}
                                        className="mt-3 block w-full text-xs text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-[#fff1f2] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[#e30613]"
                                    />
                                    {abonoPhoto && <p className="mt-2 text-xs font-bold text-emerald-700">Archivo seleccionado: {abonoPhoto.name}</p>}
                                </div>

                                <div className="flex gap-2 pt-4 border-t border-stone-100">
                                    <Button variant="ghost" onClick={closeModalAbono} disabled={loading} className="flex-1">
                                        Cancelar
                                    </Button>
                                    <Button
                                        variant="success"
                                        onClick={handleRealizarAbono}
                                        disabled={loading || !montoAbono || parseFloat(montoAbono) <= 0 || selectedFacturas.length === 0}
                                        className="flex-[2] flex items-center justify-center gap-2"
                                    >
                                        {loading ? (
                                            <><Spinner /> Procesando...</>
                                        ) : (
                                            <><Icon path={Icons.arrowRightCircle} className="w-4 h-4" />
                                            Confirmar {montoAbono ? fmt(parseFloat(montoAbono)) : ''}</>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {detailTarget && (
                    <SupportPreviewModal
                        record={detailTarget.record}
                        type={detailTarget.type}
                        onClose={() => setDetailTarget(null)}
                        onAttach={openAttachSupport}
                    />
                )}

                {supportTarget && (
                    <AttachSupportModal
                        target={supportTarget}
                        loading={supportSaving}
                        onClose={() => setSupportTarget(null)}
                        onSave={handleSaveSupport}
                    />
                )}
            </div>
        </div>
    );
}
