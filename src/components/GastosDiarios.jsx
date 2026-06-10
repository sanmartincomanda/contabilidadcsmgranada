// src/components/GastosDiarios.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../firebase';
import {
    collection, Timestamp, getDocs, doc, writeBatch, query, where
} from 'firebase/firestore';
import { APP_BRAND_NAME, DEFAULT_BRANCH_ID, DEFAULT_BRANCH_NAME, DEFAULT_CASHBOX_NAME, fmt } from '../constants';
import { buildFiscalPayload, isCashPayment, isCreditPayment, PURCHASE_PAYMENT_METHODS, uploadInvoicePhoto } from '../services/fiscalUtils';
import {
    PETTY_CASH_ALERT_THRESHOLD,
    PETTY_CASH_COLLECTION,
    PETTY_CASH_PIN,
    buildPettyCashMovementPayload,
    createPettyCashRef,
    pettyCashMovementRef,
} from '../services/pettyCash';
import { getDeviceSettings } from '../services/deviceSettings';
import {
    DEFAULT_EXPENSE_CATEGORY_ID,
    DEFAULT_PURCHASE_CATEGORY_ID,
    EXPENSE_CATEGORY_TREE,
    buildExpenseCategoryPayload,
    getExpenseCategoryFromRecord,
} from '../services/expenseCategories';
import { normalizeProviderName, upsertProviderByName } from '../services/providers';
import ProviderAutocomplete from './ProviderAutocomplete';

// --- ICONOS SVG INLINE ---
const Icons = {
    trash: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
    calendar: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
    fileText: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
    alertCircle: "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    printer: "M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z",
    receipt: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01",
    tag: "M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z",
    refresh: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
    dollar: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    chevronRight: "M9 5l7 7-7 7",
    trendingDown: "M13 17h8m0 0V9m0 8l-8-8-4 4-6-6",
    shoppingCart: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
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

const expenseCategoryOptions = (placeholder = 'Seleccionar categoria / subcategoria...') => (
    <>
        <option value="">{placeholder}</option>
        {EXPENSE_CATEGORY_TREE.map((group) => (
            <optgroup key={group.category} label={group.category}>
                {group.subcategories.map((subcategory) => {
                    const payload = buildExpenseCategoryPayload({ category: group.category, subcategory });
                    return (
                        <option key={payload.categoryLabel} value={payload.id}>
                            {subcategory}
                        </option>
                    );
                })}
            </optgroup>
        ))}
    </>
);

const resolveCategoryPayload = (selection, fallbackId = DEFAULT_EXPENSE_CATEGORY_ID) => (
    buildExpenseCategoryPayload(selection, fallbackId)
);

const Badge = ({ children, variant = 'default' }) => {
    const variants = {
        default: 'bg-stone-100 text-stone-600',
        success: 'bg-emerald-100 text-emerald-700',
        danger: 'bg-[#fff1f2] text-[#e30613]',
        warning: 'bg-amber-100 text-amber-700',
        purple: 'bg-purple-100 text-purple-700'
    };
    return <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${variants[variant]}`}>{children}</span>;
};

const PettyCashVoucher = ({ voucher }) => {
    if (!voucher) return null;

    return (
        <div className="petty-cash-voucher-print">
            <div className="ticket-center">
                <div className="ticket-brand">{APP_BRAND_NAME}</div>
                <div className="ticket-title">VOUCHER CAJA CHICA</div>
                <div className="ticket-subtitle">Ticket 80mm</div>
            </div>
            <div className="ticket-line" />
            <div className="ticket-row"><span>Fecha</span><strong>{voucher.fecha}</strong></div>
            <div className="ticket-row"><span>Hora</span><strong>{voucher.hora}</strong></div>
            <div className="ticket-row"><span>Tipo</span><strong>{voucher.tipo}</strong></div>
            <div className="ticket-row"><span>Pago</span><strong>{voucher.paymentType}</strong></div>
            {voucher.paymentReference && <div className="ticket-row"><span>Referencia</span><strong>{voucher.paymentReference}</strong></div>}
            {voucher.proveedor && <div className="ticket-row"><span>Proveedor</span><strong>{voucher.proveedor}</strong></div>}
            {voucher.factura && <div className="ticket-row"><span>Factura</span><strong>{voucher.factura}</strong></div>}
            <div className="ticket-line" />
            <div className="ticket-label">Descripcion</div>
            <div className="ticket-description">{voucher.descripcion}</div>
            {voucher.categoryLabel && (
                <>
                    <div className="ticket-label">Categoria</div>
                    <div className="ticket-description">{voucher.categoryLabel}</div>
                </>
            )}
            <div className="ticket-line" />
            <div className="ticket-row"><span>Subtotal</span><strong>{fmt(voucher.subtotal)}</strong></div>
            <div className="ticket-row"><span>IVA</span><strong>{fmt(voucher.iva)}</strong></div>
            <div className="ticket-total"><span>Total</span><strong>{fmt(voucher.total)}</strong></div>
            <div className="ticket-line" />
            <div className="ticket-approved">
                <div>___________________</div>
                <strong>Aprobado por</strong>
                <div className="ticket-signature-space">___________________</div>
                <strong>Gestor de compra</strong>
            </div>
        </div>
    );
};

// --- COMPONENTE PRINCIPAL ---

const CAJA = DEFAULT_CASHBOX_NAME;
const getCurrentMonth = () => new Date().toISOString().substring(0, 7);
const getToday = () => new Date().toISOString().substring(0, 10);
const knownCashMethods = PURCHASE_PAYMENT_METHODS.filter((method) => !isCreditPayment(method));

const getRecordAmount = (record = {}) => Number(record.monto ?? record.total ?? record.amount ?? 0) || 0;
const getRecordPaymentMethod = (record = {}) => (
    record.paymentType || record.paymentMethod || (record.tipo === 'ABONO' ? 'EFECTIVO' : 'SIN METODO')
);

export default function GastosDiarios({ categories = [], providers = [] }) {
    const [activeTab, setActiveTab] = useState('registro');
    const [loading, setLoading] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);

    // Formulario
    const [fecha, setFecha] = useState(new Date().toISOString().substring(0, 10));
    const [descripcion, setDescripcion] = useState('');
    const [monto, setMonto] = useState('');
    const [tipo, setTipo] = useState('Gasto');
    const [categoriaId, setCategoriaId] = useState('');
    const [proveedor, setProveedor] = useState('');
    const [numeroFactura, setNumeroFactura] = useState('');
    const [paymentType, setPaymentType] = useState('EFECTIVO');
    const [paymentReference, setPaymentReference] = useState('');
    const [subtotal, setSubtotal] = useState('');
    const [iva, setIva] = useState('');
    const [total, setTotal] = useState('');
    const [retentionIr2, setRetentionIr2] = useState('');
    const [retentionMunicipal1, setRetentionMunicipal1] = useState('');
    const [invoicePhoto, setInvoicePhoto] = useState(null);

    // Historial
    const [filtroPeriodo, setFiltroPeriodo] = useState('mes');
    const [filtroFecha, setFiltroFecha] = useState(getToday());
    const [filtroMes, setFiltroMes] = useState(getCurrentMonth());
    const [registros, setRegistros] = useState([]);
    const [detalleMetodo, setDetalleMetodo] = useState(null);

    // Caja chica
    const [cashboxUnlocked, setCashboxUnlocked] = useState(false);
    const [pinInput, setPinInput] = useState('');
    const [depositAmount, setDepositAmount] = useState('10000');
    const [depositConfirmPin, setDepositConfirmPin] = useState('');
    const [cashMovements, setCashMovements] = useState([]);
    const [cashboxError, setCashboxError] = useState('');
    const [voucherToPrint, setVoucherToPrint] = useState(null);

    const cargarRegistros = useCallback(async () => {
        setLoading(true);
        try {
            const registrosQuery = filtroPeriodo === 'dia'
                ? query(collection(db, 'gastosDiarios'), where('fecha', '==', filtroFecha))
                : query(
                    collection(db, 'gastosDiarios'),
                    where('fecha', '>=', `${filtroMes}-01`),
                    where('fecha', '<=', `${filtroMes}-31`)
                );
            const snapshot = await getDocs(registrosQuery);

            let docs = snapshot.docs.map(d => ({
                id: d.id,
                ...d.data(),
                timestamp: d.data().timestamp || null
            }));

            docs.sort((a, b) => {
                const timeA = a.timestamp?.toMillis?.() || 0;
                const timeB = b.timestamp?.toMillis?.() || 0;
                return timeB - timeA;
            });

            setRegistros(docs);
        } catch (error) {
            console.error('Error cargando registros:', error);
            alert('Error al cargar los registros: ' + error.message);
        } finally {
            setLoading(false);
        }
    }, [filtroFecha, filtroMes, filtroPeriodo]);

    const cargarMovimientosCaja = useCallback(async () => {
        try {
            const snapshot = await getDocs(collection(db, PETTY_CASH_COLLECTION));
            const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            docs.sort((a, b) => {
                const dateA = a.timestamp?.toMillis?.() || new Date(a.fecha || 0).getTime() || 0;
                const dateB = b.timestamp?.toMillis?.() || new Date(b.fecha || 0).getTime() || 0;
                return dateB - dateA;
            });
            setCashMovements(docs);
            setCashboxError('');
        } catch (error) {
            console.error('Error cargando caja chica:', error);
            setCashboxError('No se pudo cargar el saldo de Caja Chica: ' + error.message);
        }
    }, []);

    useEffect(() => {
        if (activeTab === 'historial') {
            cargarRegistros();
        }
    }, [activeTab, cargarRegistros, refreshKey]);

    useEffect(() => {
        if (cashboxUnlocked) {
            cargarMovimientosCaja();
        }
    }, [cashboxUnlocked, cargarMovimientosCaja, refreshKey]);

    useEffect(() => {
        if (!voucherToPrint?.autoPrint) return undefined;

        const timer = window.setTimeout(() => {
            document.body.classList.add('print-petty-cash-voucher');
            const cleanup = () => document.body.classList.remove('print-petty-cash-voucher');
            window.addEventListener('afterprint', cleanup, { once: true });
            window.print();
            window.setTimeout(cleanup, 1200);
        }, 180);

        return () => window.clearTimeout(timer);
    }, [voucherToPrint]);

    const buildVoucher = useCallback((payload = {}) => {
        const now = new Date();
        const fiscalSubtotal = Number(payload.subtotal ?? payload.amount ?? payload.total ?? payload.monto ?? 0) || 0;
        const fiscalIva = Number(payload.iva ?? 0) || 0;
        const fiscalTotal = Number(payload.total ?? payload.monto ?? (fiscalSubtotal + fiscalIva)) || 0;
        return {
            fecha: payload.fecha || payload.date || now.toISOString().substring(0, 10),
            hora: now.toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' }),
            tipo: payload.tipo || 'Gasto',
            descripcion: payload.descripcion || payload.description || 'Movimiento de Caja Chica',
            paymentType: payload.paymentType || 'EFECTIVO',
            paymentReference: payload.paymentReference || '',
            proveedor: payload.proveedor || payload.supplier || '',
            factura: payload.factura || payload.invoiceNumber || '',
            categoryLabel: payload.categoryLabel || [payload.category, payload.subcategory].filter(Boolean).join(' / '),
            subtotal: fiscalSubtotal,
            iva: fiscalIva,
            total: fiscalTotal,
            autoPrint: getDeviceSettings().printer.voucherAutoPrint !== false,
        };
    }, []);

    const handleManualVoucherPrint = () => {
        if (!voucherToPrint) return;
        document.body.classList.add('print-petty-cash-voucher');
        const cleanup = () => document.body.classList.remove('print-petty-cash-voucher');
        window.addEventListener('afterprint', cleanup, { once: true });
        window.print();
        window.setTimeout(cleanup, 1200);
    };

    const handleUnlockCashbox = (e) => {
        e.preventDefault();
        if (pinInput !== PETTY_CASH_PIN) {
            setCashboxError('PIN incorrecto. Caja Chica sigue protegida.');
            return;
        }
        setCashboxUnlocked(true);
        setPinInput('');
        setCashboxError('');
    };

    const handleDeposit = async (e) => {
        e.preventDefault();
        const amount = Number(depositAmount);
        if (!cashboxUnlocked) return;
        if (depositConfirmPin !== PETTY_CASH_PIN) {
            setCashboxError('Confirma el deposito repitiendo el PIN correcto.');
            return;
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            setCashboxError('Ingrese un monto de deposito valido.');
            return;
        }

        setLoading(true);
        try {
            const depositRef = createPettyCashRef();
            const batch = writeBatch(db);
            batch.set(depositRef, buildPettyCashMovementPayload({
                direction: 'entrada',
                movementType: 'deposito',
                fecha: getToday(),
                amount,
                description: `DEPOSITO CAJA CHICA ${fmt(amount)}`,
                paymentType: 'EFECTIVO',
                sourceCollection: 'caja_chica_depositos',
                sourceDocId: depositRef.id,
            }));
            await batch.commit();
            setDepositAmount('10000');
            setDepositConfirmPin('');
            setCashboxError('');
            await cargarMovimientosCaja();
        } catch (error) {
            console.error('Error depositando caja chica:', error);
            setCashboxError('No se pudo registrar el deposito: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const numMonto = Number(monto);
        if (isNaN(numMonto) || numMonto <= 0) return alert('Monto inv?lido.');
        if (!descripcion) return alert('Ingrese una descripcion.');
        if (tipo === 'Gasto' && !categoriaId) return alert('Categoria requerida para gastos.');

        setLoading(true);
        try {
            const timestamp = Timestamp.now();
            const categoryPayload = tipo === 'Gasto'
                ? resolveCategoryPayload(categoriaId)
                : resolveCategoryPayload(DEFAULT_PURCHASE_CATEGORY_ID, DEFAULT_PURCHASE_CATEGORY_ID);
            const gastoDiarioRef = doc(collection(db, 'gastosDiarios'));
            const gastoRef = tipo === 'Gasto' ? doc(collection(db, 'gastos')) : null;
            const compraRef = tipo === 'Compra' ? doc(collection(db, 'compras')) : null;
            const batch = writeBatch(db);

            batch.set(gastoDiarioRef, {
                fecha,
                caja: CAJA,
                descripcion,
                monto: numMonto,
                tipo,
                ...categoryPayload,
                sucursal: DEFAULT_BRANCH_ID,
                branch: DEFAULT_BRANCH_ID,
                branchName: DEFAULT_BRANCH_NAME,
                linkedExpenseId: gastoRef?.id || null,
                linkedPurchaseId: compraRef?.id || null,
                timestamp
            });

            if (gastoRef) {
                batch.set(gastoRef, {
                    date: fecha,
                    description: descripcion,
                    amount: numMonto,
                    ...categoryPayload,
                    branch: DEFAULT_BRANCH_ID,
                    branchName: DEFAULT_BRANCH_NAME,
                    timestamp,
                    is_conciled: false,
                    origen: 'gastosDiarios',
                    gastoDiarioId: gastoDiarioRef.id
                });
            }

            if (compraRef) {
                batch.set(compraRef, {
                    date: fecha,
                    month: fecha.substring(0, 7),
                    supplier: descripcion.trim().toUpperCase(),
                    invoiceNumber: `GD-${gastoDiarioRef.id.slice(0, 8).toUpperCase()}`,
                    amount: numMonto,
                    ...categoryPayload,
                    branch: DEFAULT_BRANCH_ID,
                    branchName: DEFAULT_BRANCH_NAME,
                    paymentType: 'contado',
                    isInventoryCost: true,
                    description: descripcion,
                    sourceCollection: 'gastosDiarios',
                    sourceGastoDiarioId: gastoDiarioRef.id,
                    timestamp
                });
            }

            batch.set(
                pettyCashMovementRef('gastosDiarios', gastoDiarioRef.id),
                buildPettyCashMovementPayload({
                    direction: 'salida',
                    fecha,
                    amount: numMonto,
                    description: descripcion,
                    paymentType: 'EFECTIVO',
                    sourceCollection: 'gastosDiarios',
                    sourceDocId: gastoDiarioRef.id,
                    linkedGastoDiarioId: gastoDiarioRef.id,
                    linkedExpenseId: gastoRef?.id || '',
                    linkedPurchaseId: compraRef?.id || '',
                    supplier: descripcion.trim().toUpperCase(),
                    timestamp,
                    ...categoryPayload,
                })
            );

            await batch.commit();
            setVoucherToPrint(buildVoucher({
                fecha,
                tipo,
                descripcion,
                paymentType: 'EFECTIVO',
                subtotal: numMonto,
                iva: 0,
                total: numMonto,
                ...categoryPayload,
            }));

            setDescripcion('');
            setMonto('');
            setCategoriaId('');
            alert(`${tipo} registrado correctamente`);
            setRefreshKey(prev => prev + 1);

        } catch (error) {
            console.error('Error:', error);
            alert('Error al guardar: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmitFiscal = async (e) => {
        e.preventDefault();
        const fiscal = buildFiscalPayload({ subtotal, iva, total, retentionIr2, retentionMunicipal1 });
        if (fiscal.total <= 0) return alert('Monto invalido.');
        if (!descripcion) return alert('Ingrese una descripcion.');
        if (tipo === 'Gasto' && !categoriaId) return alert('Categoria requerida para gastos.');

        setLoading(true);
        try {
            const timestamp = Timestamp.now();
            const categoryPayload = tipo === 'Gasto'
                ? resolveCategoryPayload(categoriaId)
                : resolveCategoryPayload(DEFAULT_PURCHASE_CATEGORY_ID, DEFAULT_PURCHASE_CATEGORY_ID);
            const gastoDiarioRef = doc(collection(db, 'gastosDiarios'));
            const gastoRef = tipo === 'Gasto' ? doc(collection(db, 'gastos')) : null;
            const compraRef = tipo === 'Compra' ? doc(collection(db, 'compras')) : null;
            const cleanProviderName = normalizeProviderName(proveedor);
            const provider = cleanProviderName
                ? await upsertProviderByName(cleanProviderName, { source: 'caja_chica' })
                : null;
            const providerPayload = provider ? {
                proveedor: provider.nombre,
                supplier: provider.nombre,
                providerId: provider.id,
                proveedorId: provider.id,
                providerCode: provider.code,
                codigoProveedor: provider.code,
            } : {};
            const photoPayload = await uploadInvoicePhoto(invoicePhoto, 'facturas/gastos_diarios', gastoDiarioRef.id);
            const commonFiscal = {
                ...providerPayload,
                factura: numeroFactura.trim(),
                invoiceNumber: numeroFactura.trim(),
                paymentType,
                paymentReference: paymentReference.trim().toUpperCase(),
                ...fiscal,
                ...photoPayload,
            };
            const batch = writeBatch(db);

            batch.set(gastoDiarioRef, {
                fecha,
                caja: CAJA,
                descripcion,
                monto: fiscal.total,
                amount: fiscal.subtotal,
                tipo,
                ...categoryPayload,
                ...commonFiscal,
                sucursal: DEFAULT_BRANCH_ID,
                branch: DEFAULT_BRANCH_ID,
                branchName: DEFAULT_BRANCH_NAME,
                linkedExpenseId: gastoRef?.id || null,
                linkedPurchaseId: compraRef?.id || null,
                timestamp
            });

            if (gastoRef) {
                batch.set(gastoRef, {
                    date: fecha,
                    month: fecha.substring(0, 7),
                    description: descripcion,
                    amount: fiscal.subtotal,
                    ...categoryPayload,
                    ...commonFiscal,
                    branch: DEFAULT_BRANCH_ID,
                    branchName: DEFAULT_BRANCH_NAME,
                    timestamp,
                    is_conciled: false,
                    origen: 'gastosDiarios',
                    gastoDiarioId: gastoDiarioRef.id
                });
            }

            if (compraRef) {
                batch.set(compraRef, {
                    date: fecha,
                    month: fecha.substring(0, 7),
                    supplier: proveedor.trim().toUpperCase() || descripcion.trim().toUpperCase(),
                    invoiceNumber: numeroFactura.trim(),
                    amount: fiscal.subtotal,
                    ...categoryPayload,
                    branch: DEFAULT_BRANCH_ID,
                    branchName: DEFAULT_BRANCH_NAME,
                    isInventoryCost: true,
                    description: descripcion,
                    sourceCollection: 'gastosDiarios',
                    sourceGastoDiarioId: gastoDiarioRef.id,
                    ...commonFiscal,
                    timestamp
                });
            }

            if (isCashPayment(paymentType)) {
                batch.set(
                    pettyCashMovementRef('gastosDiarios', gastoDiarioRef.id),
                    buildPettyCashMovementPayload({
                        direction: 'salida',
                        fecha,
                        amount: fiscal.total,
                        description: descripcion,
                        paymentType,
                        paymentReference: paymentReference.trim().toUpperCase(),
                        sourceCollection: 'gastosDiarios',
                        sourceDocId: gastoDiarioRef.id,
                        linkedGastoDiarioId: gastoDiarioRef.id,
                        linkedExpenseId: gastoRef?.id || '',
                        linkedPurchaseId: compraRef?.id || '',
                        supplier: provider?.nombre || cleanProviderName,
                        invoiceNumber: numeroFactura.trim(),
                        timestamp,
                        ...categoryPayload,
                        ...photoPayload,
                    })
                );
            }

            await batch.commit();
            setVoucherToPrint(buildVoucher({
                fecha,
                tipo,
                descripcion,
                proveedor: provider?.nombre || cleanProviderName,
                factura: numeroFactura.trim(),
                paymentType,
                paymentReference: paymentReference.trim().toUpperCase(),
                subtotal: fiscal.subtotal,
                iva: fiscal.iva,
                total: fiscal.total,
                ...categoryPayload,
            }));

            setDescripcion('');
            setMonto('');
            setCategoriaId('');
            setProveedor('');
            setNumeroFactura('');
            setPaymentType('EFECTIVO');
            setPaymentReference('');
            setSubtotal('');
            setIva('');
            setTotal('');
            setRetentionIr2('');
            setRetentionMunicipal1('');
            setInvoicePhoto(null);
            alert(`${tipo} registrado correctamente`);
            setRefreshKey(prev => prev + 1);
        } catch (error) {
            console.error('Error:', error);
            alert('Error al guardar: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleEliminar = async (registro) => {
        if (registro.tipo === 'ABONO' && (registro.origen === 'abonos_pagar' || registro.linkedAbonoId)) {
            return alert('Los abonos en efectivo se anulan desde Cuentas por Pagar.');
        }
        if (!window.confirm('?Eliminar este registro?')) return;

        setLoading(true);
        try {
            const batch = writeBatch(db);
            batch.delete(doc(db, 'gastosDiarios', registro.id));
            batch.delete(pettyCashMovementRef('gastosDiarios', registro.id));

            if (registro.tipo === 'Gasto') {
                if (registro.linkedExpenseId) {
                    batch.delete(doc(db, 'gastos', registro.linkedExpenseId));
                } else {
                    const gastosSnapshot = await getDocs(collection(db, 'gastos'));
                    const gastosRelacionados = gastosSnapshot.docs.filter(
                        d => d.data().gastoDiarioId === registro.id
                    );
                    for (const gastoDoc of gastosRelacionados) {
                        batch.delete(doc(db, 'gastos', gastoDoc.id));
                    }
                }
            }

            if (registro.tipo === 'Compra') {
                if (registro.linkedPurchaseId) {
                    batch.delete(doc(db, 'compras', registro.linkedPurchaseId));
                } else {
                    const comprasSnapshot = await getDocs(collection(db, 'compras'));
                    const comprasRelacionadas = comprasSnapshot.docs.filter(
                        item => item.data().sourceGastoDiarioId === registro.id
                    );
                    for (const compraDoc of comprasRelacionadas) {
                        batch.delete(doc(db, 'compras', compraDoc.id));
                    }
                }
            }

            await batch.commit();
            cargarRegistros();
            if (cashboxUnlocked) cargarMovimientosCaja();
        } catch (error) {
            console.error('Error al eliminar:', error);
            alert('Error al eliminar');
        } finally {
            setLoading(false);
        }
    };

    const cashboxBalance = cashMovements.reduce((sum, movement) => sum + (Number(movement.signedAmount) || 0), 0);
    const isLowCashboxBalance = cashboxBalance < PETTY_CASH_ALERT_THRESHOLD;
    const totalGastos = registros.filter(r => r.tipo === 'Gasto').reduce((sum, r) => sum + getRecordAmount(r), 0);
    const totalCompras = registros.filter(r => r.tipo === 'Compra').reduce((sum, r) => sum + getRecordAmount(r), 0);
    const totalAbonos = registros.filter(r => r.tipo === 'ABONO').reduce((sum, r) => sum + getRecordAmount(r), 0);
    const totalGeneral = totalGastos + totalCompras + totalAbonos;
    const paymentSummary = [...knownCashMethods, 'SIN METODO']
        .map((method) => {
            const items = registros.filter((record) => getRecordPaymentMethod(record) === method);
            return {
                method,
                items,
                total: items.reduce((sum, item) => sum + getRecordAmount(item), 0),
            };
        })
        .filter((item) => item.total > 0 || knownCashMethods.includes(item.method));
    const periodLabel = filtroPeriodo === 'dia' ? filtroFecha : filtroMes;

    return (
        <div className="space-y-5">
            <style>{`
                @keyframes fade-in { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
                .animate-fade-in { animation: fade-in 0.4s ease-out; }
                .petty-cash-voucher-print { display: none; }
                @media print {
                    .no-print { display: none !important; }
                    body.print-petty-cash-voucher * { visibility: hidden !important; }
                    body.print-petty-cash-voucher .petty-cash-voucher-print,
                    body.print-petty-cash-voucher .petty-cash-voucher-print * { visibility: visible !important; }
                    body.print-petty-cash-voucher .petty-cash-voucher-print {
                        display: block !important;
                        position: fixed !important;
                        left: 0 !important;
                        top: 0 !important;
                        width: 72mm !important;
                        padding: 3mm 4mm !important;
                        background: white !important;
                        color: #111827 !important;
                        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
                        font-size: 11px !important;
                        line-height: 1.25 !important;
                    }
                    @page { size: 80mm 180mm; margin: 0; }
                    body.print-petty-cash-voucher .ticket-center { text-align: center; }
                    body.print-petty-cash-voucher .ticket-brand { font-size: 12px; font-weight: 900; text-transform: uppercase; }
                    body.print-petty-cash-voucher .ticket-title { margin-top: 3px; font-size: 14px; font-weight: 900; letter-spacing: .04em; }
                    body.print-petty-cash-voucher .ticket-subtitle { font-size: 10px; font-weight: 700; color: #374151; }
                    body.print-petty-cash-voucher .ticket-line { border-top: 1px dashed #111827; margin: 7px 0; }
                    body.print-petty-cash-voucher .ticket-row,
                    body.print-petty-cash-voucher .ticket-total { display: flex; justify-content: space-between; gap: 8px; margin: 3px 0; }
                    body.print-petty-cash-voucher .ticket-row span,
                    body.print-petty-cash-voucher .ticket-total span { flex: 0 0 auto; }
                    body.print-petty-cash-voucher .ticket-row strong,
                    body.print-petty-cash-voucher .ticket-total strong { text-align: right; word-break: break-word; }
                    body.print-petty-cash-voucher .ticket-label { margin-top: 6px; font-size: 10px; font-weight: 900; text-transform: uppercase; }
                    body.print-petty-cash-voucher .ticket-description { margin-top: 2px; word-break: break-word; }
                    body.print-petty-cash-voucher .ticket-total { margin-top: 7px; font-size: 14px; font-weight: 900; }
                    body.print-petty-cash-voucher .ticket-approved { margin-top: 18px; text-align: center; font-size: 11px; font-weight: 900; }
                    body.print-petty-cash-voucher .ticket-signature-space { margin-top: 18px; }
                }
            `}</style>

            {/* Page header */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm no-print">
                <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.34em] text-[#e30613]">{APP_BRAND_NAME}</div>
                        <h1 className="mt-1 text-xl font-black text-slate-950">Caja Chica</h1>
                    </div>
                    <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                        Saldo protegido con PIN
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-sm no-print">
                <div className="flex gap-2">
                    <button
                        onClick={() => setActiveTab('registro')}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wide transition-all ${
                            activeTab === 'registro'
                                ? 'bg-[#e30613] text-white shadow-sm shadow-red-900/20'
                                : 'text-stone-600 hover:bg-stone-100'
                        }`}
                    >
                        <Icon path={Icons.receipt} className="w-3.5 h-3.5" />
                        Ingresar movimiento
                    </button>
                    <button
                        onClick={() => setActiveTab('historial')}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wide transition-all ${
                            activeTab === 'historial'
                                ? 'bg-[#111827] text-white'
                                : 'text-stone-600 hover:bg-stone-100'
                        }`}
                    >
                        <Icon path={Icons.calendar} className="w-3.5 h-3.5" />
                        Reporte / Historial
                    </button>
                </div>
            </div>

            {activeTab === 'registro' ? (
                <div className="animate-fade-in grid gap-5 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
                    <Card title="Saldo Caja Chica" icon="cash" className="xl:sticky xl:top-24 xl:self-start">
                        {!cashboxUnlocked ? (
                            <form onSubmit={handleUnlockCashbox} className="space-y-4">
                                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
                                    El saldo y los depositos solo se muestran con PIN. Los usuarios pueden registrar gastos sin ver el saldo.
                                </div>
                                <Input
                                    label="PIN de Caja Chica"
                                    type="password"
                                    icon="cash"
                                    placeholder="Ingrese PIN"
                                    value={pinInput}
                                    onChange={e => setPinInput(e.target.value)}
                                />
                                {cashboxError && <div className="text-xs font-bold text-[#e30613]">{cashboxError}</div>}
                                <Button type="submit" variant="dark" className="w-full">Ver saldo / Depositar</Button>
                            </form>
                        ) : (
                            <div className="space-y-4">
                                <div className={`rounded-2xl border p-5 ${isLowCashboxBalance ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
                                    <div className="text-xs font-black uppercase tracking-[0.24em] text-slate-500">Saldo disponible</div>
                                    <div className={`mt-2 text-3xl font-black ${isLowCashboxBalance ? 'text-amber-700' : 'text-emerald-700'}`}>{fmt(cashboxBalance)}</div>
                                    <div className="mt-1 text-xs font-semibold text-slate-500">Caja {CAJA}</div>
                                    {isLowCashboxBalance && (
                                        <div className="mt-3 rounded-xl bg-white px-3 py-2 text-xs font-bold text-amber-700">
                                            Aviso: saldo menor a {fmt(PETTY_CASH_ALERT_THRESHOLD)}.
                                        </div>
                                    )}
                                </div>
                                {cashboxError && <div className="rounded-xl border border-[#fecaca] bg-[#fff1f2] px-3 py-2 text-xs font-bold text-[#9f111a]">{cashboxError}</div>}
                                <form onSubmit={handleDeposit} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                                    <div>
                                        <div className="text-xs font-black uppercase tracking-[0.22em] text-[#9f111a]">Depositar dinero</div>
                                        <div className="mt-1 text-xs font-semibold text-slate-500">Ejemplo recomendado: C$10,000. Confirma con PIN otra vez.</div>
                                    </div>
                                    <Input
                                        label="Monto"
                                        type="number"
                                        step="0.01"
                                        icon="dollar"
                                        value={depositAmount}
                                        onChange={e => setDepositAmount(e.target.value)}
                                    />
                                    <Input
                                        label="Confirmar PIN"
                                        type="password"
                                        icon="cash"
                                        value={depositConfirmPin}
                                        onChange={e => setDepositConfirmPin(e.target.value)}
                                    />
                                    <Button type="submit" variant="success" disabled={loading} className="w-full">
                                        {loading ? 'Depositando...' : 'Confirmar deposito'}
                                    </Button>
                                </form>
                                <Button type="button" variant="ghost" onClick={() => setCashboxUnlocked(false)} className="w-full">
                                    Ocultar saldo
                                </Button>
                            </div>
                        )}
                    </Card>

                    <div className="max-w-lg">
                    <Card title="Nuevo Registro de Caja" icon="receipt" gradient={true}>
                        <form onSubmit={handleSubmitFiscal} className="space-y-4">
                            {/* Fecha + Tipo en la misma fila */}
                            <div className="grid grid-cols-2 gap-3">
                                <Input
                                    label="Fecha"
                                    type="date"
                                    icon="calendar"
                                    value={fecha}
                                    onChange={e => setFecha(e.target.value)}
                                    required
                                />
                                <Select
                                    label="Tipo"
                                    icon="receipt"
                                    value={tipo}
                                    onChange={e => {
                                        setTipo(e.target.value);
                                        if (e.target.value !== 'Gasto') setCategoriaId('');
                                    }}
                                    options={
                                        <>
                                            <option value="Gasto">Gasto</option>
                                            <option value="Compra">Compra</option>
                                        </>
                                    }
                                />
                            </div>

                            <Input
                                label="Descripcion"
                                icon="fileText"
                                placeholder={tipo === 'Compra' ? 'Ej: Proveedor / mercancia...' : 'Ej: Pago de servicio, suministros...'}
                                value={descripcion}
                                onChange={e => setDescripcion(e.target.value)}
                                required
                            />

                            <div className="grid grid-cols-2 gap-3">
                                <ProviderAutocomplete
                                    label="Proveedor"
                                    value={proveedor}
                                    onChange={setProveedor}
                                    providers={providers}
                                    placeholder="Escribe para buscar proveedor..."
                                />
                                <Input
                                    label="Numero factura"
                                    icon="fileText"
                                    placeholder="Factura"
                                    value={numeroFactura}
                                    onChange={e => setNumeroFactura(e.target.value)}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <Select
                                    label="Tipo de pago"
                                    value={paymentType}
                                    onChange={e => setPaymentType(e.target.value)}
                                    options={
                                        <>
                                            {PURCHASE_PAYMENT_METHODS.filter(method => !isCreditPayment(method)).map(method => (
                                                <option key={method} value={method}>{method}</option>
                                            ))}
                                        </>
                                    }
                                />
                                <Input
                                    label="Referencia"
                                    icon="fileText"
                                    placeholder="Transferencia, tarjeta..."
                                    value={paymentReference}
                                    onChange={e => setPaymentReference(e.target.value)}
                                />
                            </div>

                            <Input
                                label="Subtotal"
                                type="number"
                                step="0.01"
                                icon="dollar"
                                placeholder="0.00"
                                className={`text-lg font-bold ${tipo === 'Gasto' ? 'text-rose-600' : 'text-purple-600'}`}
                                value={subtotal}
                                onChange={e => setSubtotal(e.target.value)}
                                required
                            />

                            <div className="grid grid-cols-2 gap-3">
                                <Input label="IVA" type="number" step="0.01" icon="dollar" placeholder="0.00" value={iva} onChange={e => setIva(e.target.value)} />
                                <Input label="Total" type="number" step="0.01" icon="dollar" placeholder="0.00" value={total} onChange={e => setTotal(e.target.value)} />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <Input label="Retencion IR 2%" type="number" step="0.01" icon="dollar" placeholder="0.00" value={retentionIr2} onChange={e => setRetentionIr2(e.target.value)} />
                                <Input label="Retencion Municipal 1%" type="number" step="0.01" icon="dollar" placeholder="0.00" value={retentionMunicipal1} onChange={e => setRetentionMunicipal1(e.target.value)} />
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-bold uppercase tracking-wider text-stone-500">Foto de factura</label>
                                <input type="file" accept="image/*,.pdf" onChange={e => setInvoicePhoto(e.target.files?.[0] || null)} className="block w-full text-xs text-stone-500 file:mr-2 file:rounded-full file:border-0 file:bg-[#fff1f2] file:px-3 file:py-1 file:text-xs file:font-semibold file:text-[#e30613]" />
                            </div>

                            {tipo === 'Gasto' && (
                                <Select
                                    label="Categoria / subcategoria"
                                    icon="tag"
                                    value={categoriaId}
                                    onChange={e => setCategoriaId(e.target.value)}
                                    required
                                    options={expenseCategoryOptions()}
                                />
                            )}

                            <Button
                                type="submit"
                                variant="primary"
                                disabled={loading}
                                className="w-full"
                            >
                                {loading ? 'Guardando...' : `Registrar ${tipo}`}
                            </Button>
                        </form>
                    </Card>
                    {voucherToPrint && (
                        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 no-print">
                            <div className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">Voucher listo</div>
                            <div className="mt-1 text-sm font-semibold text-emerald-800">
                                Ultimo ticket: {voucherToPrint.descripcion} - {fmt(voucherToPrint.total)}
                            </div>
                            <button
                                type="button"
                                onClick={handleManualVoucherPrint}
                                className="mt-3 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-black uppercase tracking-wider text-white transition hover:bg-emerald-800"
                            >
                                Reimprimir voucher 80mm
                            </button>
                        </div>
                    )}
                    </div>
                </div>
            ) : (
                <div className="animate-fade-in">
                    <Card
                        title="Reporte de Cierre de Caja"
                        icon="printer"
                        right={
                            <button
                                onClick={() => window.print()}
                                className="flex items-center gap-2 rounded-lg bg-[#111827] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#1a0a0b] no-print"
                            >
                                <Icon path={Icons.printer} className="w-3.5 h-3.5" /> Imprimir
                            </button>
                        }
                    >
                        <div className="space-y-5">
                            {/* Filtros */}
                            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4">
                                <Select
                                    label="Periodo"
                                    icon="calendar"
                                    value={filtroPeriodo}
                                    onChange={e => setFiltroPeriodo(e.target.value)}
                                    options={
                                        <>
                                            <option value="mes">Mes completo</option>
                                            <option value="dia">Dia especifico</option>
                                        </>
                                    }
                                />
                                {filtroPeriodo === 'dia' ? (
                                    <Input
                                        label="Fecha"
                                        type="date"
                                        icon="calendar"
                                        value={filtroFecha}
                                        onChange={e => setFiltroFecha(e.target.value)}
                                    />
                                ) : (
                                    <Input
                                        label="Mes"
                                        type="month"
                                        icon="calendar"
                                        value={filtroMes}
                                        onChange={e => setFiltroMes(e.target.value)}
                                    />
                                )}
                                <Button
                                    onClick={cargarRegistros}
                                    variant="ghost"
                                    disabled={loading}
                                    className="flex items-center gap-2"
                                >
                                    <Icon path={Icons.refresh} className="w-4 h-4" /> Actualizar
                                </Button>
                            </div>

                            {/* Totales */}
                            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                                <div className="rounded-xl border border-[#fecaca] bg-[#fff1f2] p-4 text-center">
                                    <div className="text-xs font-bold uppercase tracking-wider text-[#e30613]">Gastos</div>
                                    <div className="text-xl font-black text-[#9f111a] mt-1">{fmt(totalGastos)}</div>
                                </div>
                                <div className="rounded-xl border border-purple-200 bg-purple-50 p-4 text-center">
                                    <div className="text-xs font-bold uppercase tracking-wider text-purple-600">Compras</div>
                                    <div className="text-xl font-black text-purple-700 mt-1">{fmt(totalCompras)}</div>
                                </div>
                                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
                                    <div className="text-xs font-bold uppercase tracking-wider text-amber-600">Abonos</div>
                                    <div className="text-xl font-black text-amber-700 mt-1">{fmt(totalAbonos)}</div>
                                </div>
                                <div className="rounded-xl border border-[#5c0f14] bg-[#9f111a] p-4 text-center">
                                    <div className="text-xs font-bold uppercase tracking-wider text-[#f5b51b]">Total del Dia</div>
                                    <div className="text-xl font-black text-white mt-1">{fmt(totalGeneral)}</div>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-[#d8dee6] bg-white p-4">
                                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                                    <div>
                                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#e30613]">Gastos de Caja Chica</div>
                                        <div className="mt-1 text-sm font-bold text-slate-600">Resumen por metodo de pago - {periodLabel}</div>
                                    </div>
                                    <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Tocar metodo para detalle</div>
                                </div>
                                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                    {paymentSummary.map((summary) => (
                                        <button
                                            type="button"
                                            key={summary.method}
                                            onClick={() => setDetalleMetodo(summary)}
                                            className="group rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:-translate-y-0.5 hover:border-[#9f111a]/35 hover:bg-white hover:shadow-lg hover:shadow-slate-900/10"
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{summary.method}</div>
                                                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-400 ring-1 ring-slate-200">{summary.items.length}</span>
                                            </div>
                                            <div className="mt-2 text-lg font-black text-slate-950">{fmt(summary.total)}</div>
                                            <div className="mt-1 text-[11px] font-semibold text-slate-400 group-hover:text-[#9f111a]">Ver movimientos</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Tabla */}
                            <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
                                <table className="w-full text-sm">
                                    <thead className="bg-stone-100 border-b border-stone-200">
                                        <tr>
                                            <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-stone-600">Hora</th>
                                            <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-stone-600">Descripcion</th>
                                            <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-stone-600">Tipo</th>
                                            <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-stone-600">Pago</th>
                                            <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-stone-600">Categoria</th>
                                            <th className="px-4 py-2.5 text-right text-xs font-bold uppercase tracking-wider text-stone-600">Monto</th>
                                            <th className="px-4 py-2.5 text-center text-xs font-bold uppercase tracking-wider text-stone-600 no-print">Accion</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-stone-100">
                                        {registros.length === 0 ? (
                                            <tr>
                                                <td colSpan="7" className="px-4 py-10 text-center text-stone-400">
                                                    <Icon path={Icons.alertCircle} className="w-10 h-10 mx-auto mb-2 text-stone-300" />
                                                    <p className="text-sm">No hay registros para esta fecha</p>
                                                </td>
                                            </tr>
                                        ) : (
                                            registros.map(reg => (
                                                <tr key={reg.id} className="hover:bg-stone-50 transition-colors">
                                                    <td className="px-4 py-3 text-xs text-stone-500">
                                                        {reg.timestamp?.toDate?.().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) || '--:--'}
                                                    </td>
                                                    <td className="px-4 py-3 text-sm font-medium text-stone-800">{reg.descripcion}</td>
                                                    <td className="px-4 py-3">
                                                        <Badge variant={reg.tipo === 'Gasto' ? 'danger' : reg.tipo === 'ABONO' ? 'warning' : 'purple'}>
                                                            {reg.tipo}
                                                        </Badge>
                                                    </td>
                                                    <td className="px-4 py-3 text-xs font-bold uppercase text-slate-500">{getRecordPaymentMethod(reg)}</td>
                                                    <td className="px-4 py-3 text-sm text-stone-500">
                                                        {(() => {
                                                            const categoryInfo = getExpenseCategoryFromRecord(reg, reg.tipo === 'Compra' ? DEFAULT_PURCHASE_CATEGORY_ID : DEFAULT_EXPENSE_CATEGORY_ID);
                                                            return reg.tipo === 'ABONO' ? 'ABONO' : `${categoryInfo.category} / ${categoryInfo.subcategory}`;
                                                        })()}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-bold text-stone-800">{fmt(getRecordAmount(reg))}</td>
                                                    <td className="px-4 py-3 text-center no-print">
                                                        <button
                                                            onClick={() => handleEliminar(reg)}
                                                            className="p-1.5 text-stone-400 hover:text-[#e30613] hover:bg-[#fff1f2] rounded-lg transition-colors"
                                                            disabled={loading}
                                                        >
                                                            <Icon path={Icons.trash} className="w-4 h-4" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                    <tfoot className="border-t-2 border-stone-200 bg-stone-100">
                                        <tr>
                                            <td colSpan="5" className="px-4 py-3 font-bold text-stone-800 uppercase text-xs tracking-wider">Total del periodo</td>
                                            <td className="px-4 py-3 text-right font-black text-lg text-[#9f111a]">{fmt(totalGeneral)}</td>
                                            <td className="no-print"></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    </Card>
                </div>
            )}
            <PettyCashVoucher voucher={voucherToPrint} />
            {detalleMetodo && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm no-print" onClick={() => setDetalleMetodo(null)}>
                    <div className="max-h-[86vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-[#111827] px-5 py-4 text-white">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#f5b51b]">Detalle de Caja Chica</div>
                                <h3 className="mt-1 text-lg font-black">{detalleMetodo.method}</h3>
                                <p className="text-xs font-semibold text-white/65">{periodLabel} - {detalleMetodo.items.length} movimiento(s)</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setDetalleMetodo(null)}
                                className="rounded-xl bg-white/10 px-3 py-2 text-xs font-black uppercase tracking-wider text-white transition hover:bg-white/20"
                            >
                                Cerrar
                            </button>
                        </div>
                        <div className="p-5">
                            <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <div className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Total</div>
                                <div className="mt-1 text-2xl font-black text-[#9f111a]">{fmt(detalleMetodo.total)}</div>
                            </div>
                            <div className="max-h-[48vh] overflow-auto rounded-xl border border-slate-200">
                                <table className="w-full text-sm">
                                    <thead className="sticky top-0 bg-slate-100">
                                        <tr>
                                            <th className="px-4 py-2 text-left text-xs font-black uppercase tracking-wider text-slate-500">Fecha</th>
                                            <th className="px-4 py-2 text-left text-xs font-black uppercase tracking-wider text-slate-500">Tipo</th>
                                            <th className="px-4 py-2 text-left text-xs font-black uppercase tracking-wider text-slate-500">Detalle</th>
                                            <th className="px-4 py-2 text-right text-xs font-black uppercase tracking-wider text-slate-500">Monto</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {detalleMetodo.items.length === 0 ? (
                                            <tr>
                                                <td colSpan="4" className="px-4 py-10 text-center text-sm font-semibold text-slate-400">
                                                    No hay movimientos para este metodo en el periodo seleccionado.
                                                </td>
                                            </tr>
                                        ) : (
                                            detalleMetodo.items.map((item) => (
                                                <tr key={item.id} className="hover:bg-slate-50">
                                                    <td className="px-4 py-3 text-xs font-bold text-slate-500">{item.fecha || item.date || '--'}</td>
                                                    <td className="px-4 py-3">
                                                        <Badge variant={item.tipo === 'Gasto' ? 'danger' : item.tipo === 'ABONO' ? 'warning' : 'purple'}>{item.tipo || 'Movimiento'}</Badge>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="font-bold text-slate-800">{item.descripcion || item.description || 'Sin descripcion'}</div>
                                                        <div className="text-xs font-semibold text-slate-400">{item.proveedor || item.supplier || ''} {item.factura || item.invoiceNumber ? `- Factura ${item.factura || item.invoiceNumber}` : ''}</div>
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-black text-slate-900">{fmt(getRecordAmount(item))}</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
