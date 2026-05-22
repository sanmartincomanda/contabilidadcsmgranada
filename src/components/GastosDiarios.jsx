// src/components/GastosDiarios.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../firebase';
import {
    collection, Timestamp, getDocs, doc, deleteDoc, writeBatch, query, where
} from 'firebase/firestore';
import { APP_BRAND_NAME, DEFAULT_BRANCH_ID, DEFAULT_BRANCH_NAME, DEFAULT_CASHBOX_NAME, fmt } from '../constants';
import { buildFiscalPayload, PURCHASE_PAYMENT_METHODS, uploadInvoicePhoto } from '../services/fiscalUtils';

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
    <div className={`rounded-xl shadow-md border border-[#e6c9b8]/60 bg-white overflow-hidden ${className}`}>
        <div className={`flex justify-between items-center px-5 py-3 border-b ${gradient ? 'bg-[#7f1218] border-[#5e1318]' : 'bg-stone-50 border-[#ead5c5]'}`}>
            <div className="flex items-center gap-3">
                {icon && (
                    <div className={`p-2 rounded-lg ${gradient ? 'bg-white/10' : 'bg-[#fff0f0]'}`}>
                        <Icon path={Icons[icon]} className={`w-4 h-4 ${gradient ? 'text-white' : 'text-[#a81d24]'}`} />
                    </div>
                )}
                <h3 className={`text-sm font-bold uppercase tracking-wider ${gradient ? 'text-white' : 'text-[#5f1a1f]'}`}>{title}</h3>
            </div>
            {right}
        </div>
        <div className="p-5">{children}</div>
    </div>
);

const Button = ({ children, variant = 'primary', className = '', disabled, size = 'md', ...props }) => {
    const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-6 py-3 text-sm' };
    const variants = {
        primary: 'bg-[#a81d24] hover:bg-[#7f1218] text-white shadow-sm shadow-red-900/20',
        success: 'bg-emerald-600 hover:bg-emerald-700 text-white',
        danger: 'bg-rose-600 hover:bg-rose-700 text-white',
        warning: 'bg-amber-500 hover:bg-amber-600 text-white',
        ghost: 'bg-transparent hover:bg-stone-100 text-stone-600 border border-stone-200',
        dark: 'bg-[#2b1113] hover:bg-[#1a0a0b] text-white'
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
            {icon && <Icon path={Icons[icon]} className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 group-focus-within:text-[#a81d24] transition-colors" />}
            <input
                type={type}
                className={`w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm font-semibold text-stone-700 outline-none transition-all focus:border-[#a81d24] focus:ring-2 focus:ring-[#a81d24]/15 ${icon ? 'pl-10' : ''} ${className}`}
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
                className={`w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm font-semibold text-stone-700 outline-none transition-all focus:border-[#a81d24] focus:ring-2 focus:ring-[#a81d24]/15 appearance-none cursor-pointer ${icon ? 'pl-10' : ''}`}
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
        danger: 'bg-[#fff0f0] text-[#a81d24]',
        warning: 'bg-amber-100 text-amber-700',
        purple: 'bg-purple-100 text-purple-700'
    };
    return <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${variants[variant]}`}>{children}</span>;
};

// --- COMPONENTE PRINCIPAL ---

const CAJA = DEFAULT_CASHBOX_NAME;

export default function GastosDiarios({ categories = [] }) {
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
    const [paymentType, setPaymentType] = useState('Efectivo');
    const [paymentReference, setPaymentReference] = useState('');
    const [subtotal, setSubtotal] = useState('');
    const [iva, setIva] = useState('');
    const [total, setTotal] = useState('');
    const [retentionIr2, setRetentionIr2] = useState('');
    const [retentionMunicipal1, setRetentionMunicipal1] = useState('');
    const [invoicePhoto, setInvoicePhoto] = useState(null);

    // Historial
    const [filtroFecha, setFiltroFecha] = useState(new Date().toISOString().substring(0, 10));
    const [registros, setRegistros] = useState([]);

    const cargarRegistros = useCallback(async () => {
        setLoading(true);
        try {
            const registrosQuery = filtroFecha
                ? query(collection(db, 'gastosDiarios'), where('fecha', '==', filtroFecha))
                : collection(db, 'gastosDiarios');
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
    }, [filtroFecha]);

    useEffect(() => {
        if (activeTab === 'historial') {
            cargarRegistros();
        }
    }, [activeTab, cargarRegistros, refreshKey]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const numMonto = Number(monto);
        if (isNaN(numMonto) || numMonto <= 0) return alert('Monto inválido.');
        if (!descripcion) return alert('Ingrese una descripción.');
        if (tipo === 'Gasto' && !categoriaId) return alert('Categoría requerida para gastos.');

        setLoading(true);
        try {
            const timestamp = Timestamp.now();
            const categoriaNombre = tipo === 'Gasto'
                ? categories.find(c => c.id === categoriaId)?.name
                : 'Compra';
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
                categoria: categoriaNombre || null,
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
                    category: categoriaNombre,
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

            await batch.commit();

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
            const categoriaNombre = tipo === 'Gasto'
                ? categories.find(c => c.id === categoriaId)?.name
                : 'Compra';
            const gastoDiarioRef = doc(collection(db, 'gastosDiarios'));
            const gastoRef = tipo === 'Gasto' ? doc(collection(db, 'gastos')) : null;
            const compraRef = tipo === 'Compra' ? doc(collection(db, 'compras')) : null;
            const photoPayload = await uploadInvoicePhoto(invoicePhoto, 'facturas/gastos_diarios', gastoDiarioRef.id);
            const commonFiscal = {
                proveedor: proveedor.trim().toUpperCase(),
                supplier: proveedor.trim().toUpperCase(),
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
                categoria: categoriaNombre || null,
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
                    category: categoriaNombre,
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

            await batch.commit();

            setDescripcion('');
            setMonto('');
            setCategoriaId('');
            setProveedor('');
            setNumeroFactura('');
            setPaymentType('Efectivo');
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
        if (!window.confirm('¿Eliminar este registro?')) return;

        setLoading(true);
        try {
            await deleteDoc(doc(db, 'gastosDiarios', registro.id));

            if (registro.tipo === 'Gasto') {
                if (registro.linkedExpenseId) {
                    await deleteDoc(doc(db, 'gastos', registro.linkedExpenseId));
                } else {
                    const gastosSnapshot = await getDocs(collection(db, 'gastos'));
                    const gastosRelacionados = gastosSnapshot.docs.filter(
                        d => d.data().gastoDiarioId === registro.id
                    );
                    for (const gastoDoc of gastosRelacionados) {
                        await deleteDoc(doc(db, 'gastos', gastoDoc.id));
                    }
                }
            }

            if (registro.tipo === 'Compra') {
                if (registro.linkedPurchaseId) {
                    await deleteDoc(doc(db, 'compras', registro.linkedPurchaseId));
                } else {
                    const comprasSnapshot = await getDocs(collection(db, 'compras'));
                    const comprasRelacionadas = comprasSnapshot.docs.filter(
                        item => item.data().sourceGastoDiarioId === registro.id
                    );
                    for (const compraDoc of comprasRelacionadas) {
                        await deleteDoc(doc(db, 'compras', compraDoc.id));
                    }
                }
            }

            cargarRegistros();
        } catch (error) {
            console.error('Error al eliminar:', error);
            alert('Error al eliminar');
        } finally {
            setLoading(false);
        }
    };

    const totalGastos = registros.filter(r => r.tipo === 'Gasto').reduce((sum, r) => sum + (r.monto || 0), 0);
    const totalCompras = registros.filter(r => r.tipo === 'Compra').reduce((sum, r) => sum + (r.monto || 0), 0);
    const totalAbonos = registros.filter(r => r.tipo === 'ABONO').reduce((sum, r) => sum + (r.monto || 0), 0);
    const totalGeneral = totalGastos + totalCompras + totalAbonos;

    return (
        <div className="space-y-5">
            <style>{`
                @keyframes fade-in { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
                .animate-fade-in { animation: fade-in 0.4s ease-out; }
                @media print { .no-print { display: none !important; } }
            `}</style>

            {/* Page header */}
            <div className="overflow-hidden rounded-xl border border-[#e6c9b8] bg-white shadow-sm no-print">
                <div className="h-1 bg-gradient-to-r from-[#a81d24] via-[#f2b635] to-[#a81d24]" />
                <div className="px-6 py-4">
                    <div className="inline-flex items-center gap-2 rounded-full border border-[#f2b635]/40 bg-[#fdf1d6] px-3 py-1 text-xs font-bold uppercase tracking-[0.3em] text-[#8a141b] mb-2">
                        {APP_BRAND_NAME}
                    </div>
                    <h1 className="text-xl font-black text-[#7f1218]">Gastos <span className="text-[#a81d24]">Diarios</span></h1>
                    <p className="text-xs font-medium text-[#8b6a5f] mt-0.5">Registro de caja diaria y compras — {CAJA}</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="overflow-hidden rounded-xl border border-[#e6c9b8] bg-white shadow-sm p-2 no-print">
                <div className="flex gap-2">
                    <button
                        onClick={() => setActiveTab('registro')}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wide transition-all ${
                            activeTab === 'registro'
                                ? 'bg-[#a81d24] text-white shadow-sm shadow-red-900/20'
                                : 'text-stone-600 hover:bg-stone-100'
                        }`}
                    >
                        <Icon path={Icons.receipt} className="w-3.5 h-3.5" />
                        Nuevo Registro
                    </button>
                    <button
                        onClick={() => setActiveTab('historial')}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wide transition-all ${
                            activeTab === 'historial'
                                ? 'bg-[#2b1113] text-white'
                                : 'text-stone-600 hover:bg-stone-100'
                        }`}
                    >
                        <Icon path={Icons.calendar} className="w-3.5 h-3.5" />
                        Reporte / Historial
                    </button>
                </div>
            </div>

            {activeTab === 'registro' ? (
                <div className="animate-fade-in max-w-lg">
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
                                label="Descripción"
                                icon="fileText"
                                placeholder={tipo === 'Compra' ? 'Ej: Proveedor / mercancía...' : 'Ej: Pago de servicio, suministros...'}
                                value={descripcion}
                                onChange={e => setDescripcion(e.target.value)}
                                required
                            />

                            <div className="grid grid-cols-2 gap-3">
                                <Input
                                    label="Proveedor"
                                    icon="receipt"
                                    placeholder="Proveedor"
                                    value={proveedor}
                                    onChange={e => setProveedor(e.target.value)}
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
                                            {PURCHASE_PAYMENT_METHODS.filter(method => method !== 'Credito').map(method => (
                                                <option key={method} value={method}>{method}</option>
                                            ))}
                                        </>
                                    }
                                />
                                <Input
                                    label="Referencia"
                                    icon="fileText"
                                    placeholder="Transferencia, POS..."
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
                                <input type="file" accept="image/*,.pdf" onChange={e => setInvoicePhoto(e.target.files?.[0] || null)} className="block w-full text-xs text-stone-500 file:mr-2 file:rounded-full file:border-0 file:bg-[#fff0f0] file:px-3 file:py-1 file:text-xs file:font-semibold file:text-[#a81d24]" />
                            </div>

                            {tipo === 'Gasto' && (
                                <Select
                                    label="Categoría"
                                    icon="tag"
                                    value={categoriaId}
                                    onChange={e => setCategoriaId(e.target.value)}
                                    required
                                    options={
                                        <>
                                            <option value="">Seleccionar categoría...</option>
                                            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </>
                                    }
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
                </div>
            ) : (
                <div className="animate-fade-in">
                    <Card
                        title="Reporte de Cierre de Caja"
                        icon="printer"
                        right={
                            <button
                                onClick={() => window.print()}
                                className="flex items-center gap-2 rounded-lg bg-[#2b1113] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#1a0a0b] no-print"
                            >
                                <Icon path={Icons.printer} className="w-3.5 h-3.5" /> Imprimir
                            </button>
                        }
                    >
                        <div className="space-y-5">
                            {/* Filtros */}
                            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4">
                                <Input
                                    label="Fecha"
                                    type="date"
                                    icon="calendar"
                                    value={filtroFecha}
                                    onChange={e => setFiltroFecha(e.target.value)}
                                />
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
                                <div className="rounded-xl border border-[#fecaca] bg-[#fff0f0] p-4 text-center">
                                    <div className="text-xs font-bold uppercase tracking-wider text-[#a81d24]">Gastos</div>
                                    <div className="text-xl font-black text-[#7f1218] mt-1">{fmt(totalGastos)}</div>
                                </div>
                                <div className="rounded-xl border border-purple-200 bg-purple-50 p-4 text-center">
                                    <div className="text-xs font-bold uppercase tracking-wider text-purple-600">Compras</div>
                                    <div className="text-xl font-black text-purple-700 mt-1">{fmt(totalCompras)}</div>
                                </div>
                                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
                                    <div className="text-xs font-bold uppercase tracking-wider text-amber-600">Abonos</div>
                                    <div className="text-xl font-black text-amber-700 mt-1">{fmt(totalAbonos)}</div>
                                </div>
                                <div className="rounded-xl border border-[#5e1318] bg-[#7f1218] p-4 text-center">
                                    <div className="text-xs font-bold uppercase tracking-wider text-[#f2b635]">Total del Día</div>
                                    <div className="text-xl font-black text-white mt-1">{fmt(totalGeneral)}</div>
                                </div>
                            </div>

                            {/* Tabla */}
                            <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
                                <table className="w-full text-sm">
                                    <thead className="bg-stone-100 border-b border-stone-200">
                                        <tr>
                                            <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-stone-600">Hora</th>
                                            <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-stone-600">Descripción</th>
                                            <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-stone-600">Tipo</th>
                                            <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-stone-600">Categoría</th>
                                            <th className="px-4 py-2.5 text-right text-xs font-bold uppercase tracking-wider text-stone-600">Monto</th>
                                            <th className="px-4 py-2.5 text-center text-xs font-bold uppercase tracking-wider text-stone-600 no-print">Acción</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-stone-100">
                                        {registros.length === 0 ? (
                                            <tr>
                                                <td colSpan="6" className="px-4 py-10 text-center text-stone-400">
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
                                                    <td className="px-4 py-3 text-sm text-stone-500">{reg.categoria || '—'}</td>
                                                    <td className="px-4 py-3 text-right font-bold text-stone-800">{fmt(reg.monto)}</td>
                                                    <td className="px-4 py-3 text-center no-print">
                                                        <button
                                                            onClick={() => handleEliminar(reg)}
                                                            className="p-1.5 text-stone-400 hover:text-[#a81d24] hover:bg-[#fff0f0] rounded-lg transition-colors"
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
                                            <td colSpan="4" className="px-4 py-3 font-bold text-stone-800 uppercase text-xs tracking-wider">Total del Día</td>
                                            <td className="px-4 py-3 text-right font-black text-lg text-[#7f1218]">{fmt(totalGeneral)}</td>
                                            <td className="no-print"></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
}
