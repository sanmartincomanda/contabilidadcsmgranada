import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { db } from './firebase';
import { collection, query, onSnapshot, getDocs, doc, setDoc, updateDoc } from 'firebase/firestore';

import { AuthProvider, useAuth } from './context/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import Login from './components/Login';
import Header from './components/Header';
import GastosDiarios from './components/GastosDiarios';
import { DataEntry } from './components/DataEntry';
import { BankReconciliation } from './components/BankReconciliation';
import Reports from './components/Reports';
import CategoryManager from './components/CategoryManager';
import { AccountsPayable } from './components/AccountsPayable';
import { APP_BRAND_LOGO, APP_BRAND_NAME, fmt } from './constants';
import { resolveReportIncomeEntries } from './services/incomeAggregation';

const BRAND_LOGO = APP_BRAND_LOGO;

const DATA_ENTRY_COLLECTIONS = ['ingresos', 'gastos', 'categorias', 'inventarios', 'compras', 'presupuestos', 'cuentasPorCobrar', 'patrimonio'];
const ACCOUNTS_PAYABLE_COLLECTIONS = ['cuentas_por_pagar', 'abonos_pagar', 'proveedores'];
const CATEGORY_COLLECTIONS = ['categorias'];
const REPORT_COLLECTIONS = ['ingresos', 'gastos', 'inventarios', 'compras', 'presupuestos', 'cuentas_por_pagar'];
const DASHBOARD_COLLECTIONS = ['ingresos', 'gastos', 'compras', 'cuentas_por_pagar'];

const DEFAULT_REMINDERS = [
    { id: 'r1', texto: 'DGI CUOTA FIJA', diaDelMes: 7, activo: true },
    { id: 'r2', texto: 'ALCALDIA', diaDelMes: 7, activo: true },
    { id: 'r3', texto: 'INSS', diaDelMes: 7, activo: true },
    { id: 'r4', texto: 'INATEC', diaDelMes: 7, activo: true },
    { id: 'r5', texto: 'LUZ ELECTRICA 1', diaDelMes: 7, activo: true },
    { id: 'r6', texto: 'LUZ ELECTRICA 2', diaDelMes: 7, activo: true },
    { id: 'r7', texto: 'AGUA', diaDelMes: 7, activo: true },
    { id: 'r8', texto: 'CLARO INTERNET', diaDelMes: 7, activo: true },
    { id: 'r9', texto: 'GASTOS MITRA HIGIENE Y SEGURIDAD', diaDelMes: 7, activo: true },
];

const CONFIG_DOC_PATH = 'configuracion/dashboard';

const DASHBOARD_STYLES = `
@keyframes dash-slide-up{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:translateY(0)}}
@keyframes dash-fade{from{opacity:0}to{opacity:1}}
@keyframes dash-check{0%{transform:scale(0) rotate(-45deg)}60%{transform:scale(1.25) rotate(0)}100%{transform:scale(1) rotate(0)}}
@keyframes dash-pulse{0%,100%{opacity:1}50%{opacity:.55}}
@keyframes dash-gradient{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
@keyframes dash-slide-right{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
.dash-up{animation:dash-slide-up .55s cubic-bezier(.22,1,.36,1) both}
.dash-up-1{animation-delay:60ms}.dash-up-2{animation-delay:120ms}.dash-up-3{animation-delay:180ms}.dash-up-4{animation-delay:240ms}
.dash-up-5{animation-delay:300ms}.dash-up-6{animation-delay:360ms}
.dash-fade{animation:dash-fade .4s ease both}
.dash-check{animation:dash-check .35s cubic-bezier(.22,1,.36,1) both}
.dash-pulse{animation:dash-pulse 2s ease-in-out infinite}
.dash-mesh{background:linear-gradient(135deg,#1a0a0b 0%,#3b1114 25%,#5e1318 50%,#7f1218 75%,#2b1113 100%);background-size:300% 300%;animation:dash-gradient 12s ease infinite}
.dash-panel{animation:dash-slide-right .35s cubic-bezier(.22,1,.36,1) both}
.dash-dots{background-image:radial-gradient(circle,rgba(242,182,53,.07) 1px,transparent 1px);background-size:20px 20px}
.dash-glass{background:rgba(255,255,255,.82);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
.dash-kpi:hover{transform:translateY(-4px);box-shadow:0 20px 40px -12px rgba(127,18,24,.18)}
.dash-kpi{transition:all .3s cubic-bezier(.22,1,.36,1)}
@media print{.no-print{display:none!important}}
`;

const Icon = ({ d, className = 'w-5 h-5', strokeWidth = 2 }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={strokeWidth}>
        <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
);

const ICON = {
    trending_up: 'M13 7h8m0 0v8m0-8l-8-8-4 4-6-6',
    trending_down: 'M13 17h8m0 0V9m0 8l-8-8-4 4-6-6',
    cart: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z',
    wallet: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
    alert: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
    check: 'M5 13l4 4L19 7',
    x: 'M6 18L18 6M6 6l12 12',
    gear: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
    gear_inner: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    bell: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
    plus: 'M12 4v16m8-8H4',
    trash: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
    clock: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    sun: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z',
    moon: 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z',
    dollar: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
};

// --- SETTINGS PANEL ---

const SettingsPanel = ({ config, onClose, onSave }) => {
    const [reminders, setReminders] = useState(config?.recordatorios || []);
    const [newText, setNewText] = useState('');
    const [newDay, setNewDay] = useState(7);
    const [saving, setSaving] = useState(false);

    const addReminder = () => {
        if (!newText.trim()) return;
        setReminders(prev => [...prev, {
            id: 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            texto: newText.trim().toUpperCase(),
            diaDelMes: Number(newDay) || 7,
            activo: true,
        }]);
        setNewText('');
        setNewDay(7);
    };

    const removeReminder = (id) => {
        setReminders(prev => prev.filter(r => r.id !== id));
    };

    const toggleReminder = (id) => {
        setReminders(prev => prev.map(r => r.id === id ? { ...r, activo: !r.activo } : r));
    };

    const updateDay = (id, day) => {
        setReminders(prev => prev.map(r => r.id === id ? { ...r, diaDelMes: Number(day) || 1 } : r));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await onSave(reminders);
            onClose();
        } catch (e) {
            alert('Error al guardar: ' + e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
            <div className="absolute inset-0 bg-[#1a0a0b]/50 backdrop-blur-sm" />
            <div
                className="dash-panel relative w-full max-w-md bg-white shadow-2xl shadow-[#7f1218]/20 overflow-hidden flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="dash-mesh px-6 py-5 flex items-center justify-between flex-shrink-0">
                    <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#f2b635] mb-1">{APP_BRAND_NAME}</div>
                        <h2 className="text-lg font-black text-white">Configuración de Inicio</h2>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-xl bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition">
                        <Icon d={ICON.x} className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    <div className="text-xs font-bold uppercase tracking-[0.2em] text-stone-400 mb-2">Recordatorios Mensuales</div>

                    {reminders.length === 0 && (
                        <div className="text-center py-8 text-stone-400 text-sm">No hay recordatorios configurados</div>
                    )}

                    {reminders.map(r => (
                        <div key={r.id} className={`rounded-xl border p-3 transition-all ${r.activo ? 'border-[#e6c9b8] bg-white' : 'border-stone-200 bg-stone-50 opacity-60'}`}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-bold text-stone-800 truncate">{r.texto}</div>
                                    <div className="flex items-center gap-3 mt-2">
                                        <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Día:</label>
                                        <input
                                            type="number"
                                            min="1"
                                            max="28"
                                            value={r.diaDelMes}
                                            onChange={e => updateDay(r.id, e.target.value)}
                                            className="w-14 rounded-lg border border-stone-200 px-2 py-1 text-xs font-bold text-stone-700 text-center focus:border-[#a81d24] focus:ring-1 focus:ring-[#a81d24]/20 outline-none"
                                        />
                                        <button
                                            onClick={() => toggleReminder(r.id)}
                                            className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${r.activo ? 'bg-[#a81d24]' : 'bg-stone-300'}`}
                                        >
                                            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${r.activo ? 'left-[18px]' : 'left-0.5'}`} />
                                        </button>
                                    </div>
                                </div>
                                <button
                                    onClick={() => removeReminder(r.id)}
                                    className="p-1.5 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50 transition flex-shrink-0"
                                >
                                    <Icon d={ICON.trash} className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))}

                    {/* Add new */}
                    <div className="rounded-xl border-2 border-dashed border-stone-200 p-4 space-y-3">
                        <div className="text-xs font-bold uppercase tracking-wider text-stone-400">Agregar recordatorio</div>
                        <input
                            type="text"
                            placeholder="Ej: PAGO DE AGUA, ALQUILER..."
                            value={newText}
                            onChange={e => setNewText(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && addReminder()}
                            className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-semibold text-stone-700 placeholder:text-stone-300 focus:border-[#a81d24] focus:ring-2 focus:ring-[#a81d24]/15 outline-none"
                        />
                        <div className="flex items-center gap-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Día del mes:</label>
                            <input
                                type="number"
                                min="1"
                                max="28"
                                value={newDay}
                                onChange={e => setNewDay(e.target.value)}
                                className="w-16 rounded-lg border border-stone-200 px-2 py-1.5 text-sm font-bold text-stone-700 text-center focus:border-[#a81d24] focus:ring-1 focus:ring-[#a81d24]/20 outline-none"
                            />
                            <button
                                onClick={addReminder}
                                disabled={!newText.trim()}
                                className="ml-auto flex items-center gap-2 rounded-xl bg-[#a81d24] px-4 py-2 text-xs font-bold text-white disabled:opacity-40 hover:bg-[#7f1218] transition"
                            >
                                <Icon d={ICON.plus} className="w-3.5 h-3.5" /> Agregar
                            </button>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="border-t border-[#ead5c5] bg-stone-50 px-5 py-4 flex items-center justify-between flex-shrink-0">
                    <button onClick={onClose} className="rounded-xl border border-stone-200 px-5 py-2.5 text-xs font-bold text-stone-600 hover:bg-stone-100 transition">
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="rounded-xl bg-[#a81d24] px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-[#a81d24]/25 hover:bg-[#7f1218] disabled:opacity-50 transition"
                    >
                        {saving ? 'Guardando...' : 'Guardar Cambios'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- DASHBOARD ---

const Dashboard = ({ data = {} }) => {
    const [config, setConfig] = useState(null);
    const [configLoading, setConfigLoading] = useState(true);
    const [showSettings, setShowSettings] = useState(false);
    const [justCompleted, setJustCompleted] = useState(null);
    const processingRef = useRef(false);

    useEffect(() => {
        const docRef = doc(db, CONFIG_DOC_PATH);
        const unsub = onSnapshot(docRef, async (snap) => {
            if (snap.exists()) {
                setConfig(snap.data());
            } else {
                const defaults = { recordatorios: DEFAULT_REMINDERS, completados: {} };
                await setDoc(docRef, defaults);
            }
            setConfigLoading(false);
        }, () => {
            setConfigLoading(false);
        });
        return unsub;
    }, []);

    // --- KPI calculations ---
    const now = new Date();
    const currentMonth = now.toISOString().substring(0, 7);
    const today = now.toISOString().substring(0, 10);
    const dayOfMonth = now.getDate();
    const hour = now.getHours();

    const greeting = hour < 12 ? 'Buenos días' : hour < 18 ? 'Buenas tardes' : 'Buenas noches';
    const greetingIcon = hour < 12 ? ICON.sun : hour < 18 ? ICON.sun : ICON.moon;
    const mesLabel = now.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

    const ingresos = resolveReportIncomeEntries(data.ingresos || []);
    const gastos = data.gastos || [];
    const compras = data.compras || [];
    const facturas = data.cuentas_por_pagar || [];

    const mesIngresos = ingresos.filter(i => (i.month || (i.date || '').substring(0, 7)) === currentMonth);
    const mesGastos = gastos.filter(g => (g.date || '').substring(0, 7) === currentMonth);
    const mesCompras = compras.filter(c => (c.month || (c.date || '').substring(0, 7)) === currentMonth);

    const totalIngresos = mesIngresos.reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const totalGastos = mesGastos.reduce((s, g) => s + (Number(g.amount) || 0), 0);
    const totalCompras = mesCompras.reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const utilidad = totalIngresos - totalGastos - totalCompras;

    const facturasPendientes = facturas.filter(f => (Number(f.saldo) || 0) > 0.01);
    const totalPendiente = facturasPendientes.reduce((s, f) => s + (Number(f.saldo) || 0), 0);
    const vencidas = facturasPendientes.filter(f => f.vencimiento && f.vencimiento < today);

    // --- Reminders logic ---
    const monthKey = currentMonth;
    const completedIds = config?.completados?.[monthKey] || [];
    const allReminders = (config?.recordatorios || []).filter(r => r.activo && dayOfMonth >= r.diaDelMes);
    const pendingReminders = allReminders.filter(r => !completedIds.includes(r.id));
    const doneCount = allReminders.length - pendingReminders.length;

    const markAsDone = useCallback(async (reminderId) => {
        if (processingRef.current) return;
        processingRef.current = true;
        setJustCompleted(reminderId);

        try {
            const docRef = doc(db, CONFIG_DOC_PATH);
            const updatedCompleted = { ...config.completados, [monthKey]: [...completedIds, reminderId] };
            await updateDoc(docRef, { completados: updatedCompleted });
        } catch (e) {
            console.error('Error marking reminder:', e);
        } finally {
            processingRef.current = false;
            setTimeout(() => setJustCompleted(null), 500);
        }
    }, [config, completedIds, monthKey]);

    const saveSettings = useCallback(async (newReminders) => {
        const docRef = doc(db, CONFIG_DOC_PATH);
        await updateDoc(docRef, { recordatorios: newReminders });
    }, []);

    // Dynamic insight
    const insight = vencidas.length > 0
        ? `${vencidas.length} factura(s) vencida(s) — requieren atención`
        : utilidad > 0
            ? `Utilidad positiva de ${fmt(utilidad)} este mes`
            : totalIngresos === 0 && totalGastos === 0
                ? 'Aún sin movimientos registrados este mes'
                : 'Gastos superan ingresos este periodo';

    const kpis = [
        { label: 'Ingresos', value: totalIngresos, count: mesIngresos.length, icon: ICON.trending_up, color: 'emerald', bg: 'from-emerald-500/10 to-emerald-500/5', accent: 'text-emerald-700', ring: 'ring-emerald-500/20' },
        { label: 'Gastos', value: totalGastos, count: mesGastos.length, icon: ICON.trending_down, color: 'rose', bg: 'from-rose-500/10 to-rose-500/5', accent: 'text-rose-700', ring: 'ring-rose-500/20' },
        { label: 'Compras', value: totalCompras, count: mesCompras.length, icon: ICON.cart, color: 'violet', bg: 'from-violet-500/10 to-violet-500/5', accent: 'text-violet-700', ring: 'ring-violet-500/20' },
        { label: 'Por Pagar', value: totalPendiente, count: facturasPendientes.length, icon: ICON.wallet, color: 'amber', bg: 'from-amber-500/10 to-amber-500/5', accent: 'text-amber-700', ring: 'ring-amber-500/20', alert: vencidas.length > 0 },
    ];

    return (
        <div className="space-y-5 dash-dots min-h-[70vh]">
            <style>{DASHBOARD_STYLES}</style>

            {showSettings && <SettingsPanel config={config} onClose={() => setShowSettings(false)} onSave={saveSettings} />}

            {/* ========= HERO HEADER ========= */}
            <div className="dash-up overflow-hidden rounded-2xl shadow-xl shadow-[#7f1218]/12">
                <div className="dash-mesh relative px-6 py-7 md:px-8 md:py-8 overflow-hidden">
                    {/* Decorative dots overlay */}
                    <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'radial-gradient(circle, #f2b635 1px, transparent 1px)', backgroundSize: '16px 16px' }} />

                    <div className="relative flex items-start justify-between gap-4">
                        <div className="space-y-3 flex-1">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-xl bg-white/10">
                                    <Icon d={greetingIcon} className="w-5 h-5 text-[#f2b635]" />
                                </div>
                                <div>
                                    <div className="text-sm font-black text-white tracking-wide">{greeting}</div>
                                    <div className="text-xs text-white/40 font-medium capitalize">{mesLabel}</div>
                                </div>
                            </div>

                            <div className="border-l-2 border-[#f2b635]/30 pl-4">
                                <p className="text-xs text-white/60 font-medium">{insight}</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                            <img src={BRAND_LOGO} alt="Logo" className="hidden sm:block h-12 w-12 rounded-2xl border border-white/10 object-cover" />
                            <button
                                onClick={() => setShowSettings(true)}
                                className="p-2.5 rounded-xl bg-white/8 border border-white/10 text-white/60 hover:bg-white/15 hover:text-[#f2b635] transition-all group"
                                title="Configuración"
                            >
                                <svg className="w-5 h-5 transition-transform group-hover:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d={ICON.gear} />
                                    <path strokeLinecap="round" strokeLinejoin="round" d={ICON.gear_inner} />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* ========= KPI GRID ========= */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                {kpis.map((kpi, i) => (
                    <div key={kpi.label} className={`dash-up dash-up-${i + 1} dash-kpi relative rounded-2xl border border-stone-200/80 bg-gradient-to-br ${kpi.bg} p-4 md:p-5 overflow-hidden`}>
                        {kpi.alert && (
                            <div className="absolute top-3 right-3">
                                <span className="relative flex h-2.5 w-2.5">
                                    <span className="dash-pulse absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
                                </span>
                            </div>
                        )}
                        <div className={`p-2 rounded-xl bg-white shadow-sm ring-1 ${kpi.ring} w-fit mb-3`}>
                            <Icon d={kpi.icon} className={`w-4 h-4 ${kpi.accent}`} />
                        </div>
                        <div className={`text-xl md:text-2xl font-black ${kpi.accent} font-mono tracking-tight`}>
                            {fmt(kpi.value)}
                        </div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-stone-400 mt-1">{kpi.label}</div>
                        <div className="text-[10px] text-stone-400 mt-0.5">{kpi.count} registro{kpi.count !== 1 ? 's' : ''}</div>
                    </div>
                ))}
            </div>

            {/* ========= UTILIDAD ========= */}
            <div className={`dash-up dash-up-5 rounded-2xl border p-5 md:p-6 overflow-hidden relative ${
                utilidad >= 0
                    ? 'border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-emerald-50'
                    : 'border-rose-200 bg-gradient-to-r from-rose-50 via-white to-rose-50'
            }`}>
                <div className="flex items-center justify-between flex-wrap gap-4">
                    <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#b98b2d] mb-1">Resultado del Mes</div>
                        <div className="text-xs text-stone-400 mb-2">Ingresos − Gastos − Compras</div>
                        <div className={`text-3xl md:text-4xl font-black font-mono tracking-tighter ${utilidad >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {fmt(utilidad)}
                        </div>
                    </div>
                    <div className={`px-5 py-2 rounded-full text-xs font-black uppercase tracking-wider ${
                        utilidad >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                    }`}>
                        {utilidad >= 0 ? 'Positivo' : 'Negativo'}
                    </div>
                </div>
                {/* Subtle decorative line */}
                <div className={`absolute bottom-0 left-0 right-0 h-1 ${utilidad >= 0 ? 'bg-gradient-to-r from-transparent via-emerald-400 to-transparent' : 'bg-gradient-to-r from-transparent via-rose-400 to-transparent'}`} style={{ opacity: 0.3 }} />
            </div>

            {/* ========= BOTTOM GRID: Reminders + Alerts ========= */}
            <div className="dash-up dash-up-6 grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5">
                {/* --- REMINDERS --- */}
                <div className="rounded-2xl border border-[#e6c9b8] bg-white overflow-hidden shadow-sm">
                    <div className="flex items-center justify-between px-5 py-3 border-b border-[#ead5c5] bg-gradient-to-r from-stone-50 to-white">
                        <div className="flex items-center gap-2.5">
                            <div className="p-1.5 rounded-lg bg-[#fff0f0]">
                                <Icon d={ICON.bell} className="w-4 h-4 text-[#a81d24]" />
                            </div>
                            <div>
                                <div className="text-xs font-bold uppercase tracking-wider text-[#5f1a1f]">Recordatorios</div>
                                {allReminders.length > 0 && (
                                    <div className="text-[10px] text-stone-400 font-medium">{doneCount} de {allReminders.length} completados</div>
                                )}
                            </div>
                        </div>
                        <button
                            onClick={() => setShowSettings(true)}
                            className="p-1.5 rounded-lg text-stone-400 hover:text-[#a81d24] hover:bg-[#fff0f0] transition"
                            title="Configurar"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d={ICON.gear} />
                                <path strokeLinecap="round" strokeLinejoin="round" d={ICON.gear_inner} />
                            </svg>
                        </button>
                    </div>

                    <div className="p-4 space-y-1.5 max-h-72 overflow-y-auto">
                        {configLoading ? (
                            <div className="text-center py-6 text-stone-300 text-xs">Cargando...</div>
                        ) : allReminders.length === 0 ? (
                            <div className="text-center py-8">
                                <Icon d={ICON.bell} className="w-8 h-8 text-stone-200 mx-auto mb-2" />
                                <p className="text-xs text-stone-400">
                                    {dayOfMonth < 7 ? 'Los recordatorios aparecen a partir del día 7' : 'No hay recordatorios configurados'}
                                </p>
                            </div>
                        ) : pendingReminders.length === 0 ? (
                            <div className="text-center py-8">
                                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
                                    <Icon d={ICON.check} className="w-5 h-5 text-emerald-600" />
                                </div>
                                <p className="text-sm font-bold text-emerald-700">Todos completados</p>
                                <p className="text-xs text-stone-400 mt-0.5">No quedan recordatorios pendientes este mes</p>
                            </div>
                        ) : (
                            <>
                                {allReminders.length > 0 && (
                                    <div className="mb-3">
                                        <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden">
                                            <div
                                                className="h-full rounded-full bg-gradient-to-r from-[#a81d24] to-[#f2b635] transition-all duration-700"
                                                style={{ width: `${allReminders.length > 0 ? (doneCount / allReminders.length) * 100 : 0}%` }}
                                            />
                                        </div>
                                    </div>
                                )}
                                {pendingReminders.map(r => (
                                    <div
                                        key={r.id}
                                        className={`group flex items-center gap-3 rounded-xl border border-stone-100 px-3.5 py-2.5 transition-all hover:border-[#e6c9b8] hover:bg-[#fffaf7] ${justCompleted === r.id ? 'opacity-40 scale-95' : ''}`}
                                    >
                                        <button
                                            onClick={() => markAsDone(r.id)}
                                            className="w-5 h-5 rounded-md border-2 border-stone-300 flex items-center justify-center flex-shrink-0 group-hover:border-[#a81d24] transition-colors"
                                        >
                                            {justCompleted === r.id && (
                                                <Icon d={ICON.check} className="w-3 h-3 text-[#a81d24] dash-check" />
                                            )}
                                        </button>
                                        <span className="text-sm font-semibold text-stone-700 flex-1">{r.texto}</span>
                                        <button
                                            onClick={() => markAsDone(r.id)}
                                            className="text-[10px] font-bold text-stone-400 uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
                                        >
                                            Hecho
                                        </button>
                                    </div>
                                ))}
                            </>
                        )}
                    </div>
                </div>

                {/* --- FACTURAS VENCIDAS / PENDIENTES --- */}
                <div className="rounded-2xl border border-[#e6c9b8] bg-white overflow-hidden shadow-sm">
                    <div className="flex items-center gap-2.5 px-5 py-3 border-b border-[#ead5c5] bg-gradient-to-r from-stone-50 to-white">
                        <div className={`p-1.5 rounded-lg ${vencidas.length > 0 ? 'bg-amber-100' : 'bg-stone-100'}`}>
                            <Icon d={ICON.alert} className={`w-4 h-4 ${vencidas.length > 0 ? 'text-amber-600' : 'text-stone-400'}`} />
                        </div>
                        <div>
                            <div className="text-xs font-bold uppercase tracking-wider text-[#5f1a1f]">Cuentas por Pagar</div>
                            <div className="text-[10px] text-stone-400 font-medium">
                                {facturasPendientes.length} pendientes{vencidas.length > 0 ? ` · ${vencidas.length} vencida(s)` : ''}
                            </div>
                        </div>
                    </div>

                    <div className="p-4 space-y-2 max-h-72 overflow-y-auto">
                        {vencidas.length > 0 && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 mb-3">
                                <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-1.5 flex items-center gap-1.5">
                                    <span className="relative flex h-2 w-2"><span className="dash-pulse absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" /></span>
                                    Facturas vencidas
                                </div>
                                {vencidas.slice(0, 5).map(f => (
                                    <div key={f.id} className="flex items-center justify-between py-1.5 border-t border-amber-200/50 first:border-0">
                                        <div className="min-w-0 flex-1">
                                            <div className="text-xs font-bold text-stone-800 truncate">{f.proveedor || f.supplier || 'Sin proveedor'}</div>
                                            <div className="text-[10px] text-amber-600">{f.numero || ''}{f.vencimiento ? ` · Venció ${f.vencimiento}` : ''}</div>
                                        </div>
                                        <div className="text-xs font-black text-amber-800 flex-shrink-0 ml-3 font-mono">{fmt(f.saldo)}</div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {facturasPendientes.length === 0 ? (
                            <div className="text-center py-8">
                                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
                                    <Icon d={ICON.check} className="w-5 h-5 text-emerald-600" />
                                </div>
                                <p className="text-sm font-bold text-emerald-700">Sin pendientes</p>
                                <p className="text-xs text-stone-400 mt-0.5">Todas las cuentas están al día</p>
                            </div>
                        ) : (
                            facturasPendientes.filter(f => !vencidas.includes(f)).slice(0, 6).map(f => (
                                <div key={f.id} className="flex items-center justify-between rounded-xl border border-stone-100 px-3.5 py-2.5">
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-bold text-stone-700 truncate">{f.proveedor || f.supplier || 'Sin proveedor'}</div>
                                        <div className="text-[10px] text-stone-400">{f.numero || ''}{f.vencimiento ? ` · Vence ${f.vencimiento}` : ''}</div>
                                    </div>
                                    <div className="text-xs font-black text-stone-800 flex-shrink-0 ml-3 font-mono">{fmt(f.saldo)}</div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- LOADING / ERROR ---

const AppLoadingState = () => (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-[#fff8f3] px-6 text-center text-[#7f1218]">
        <img src={APP_BRAND_LOGO} alt={APP_BRAND_NAME} className="h-28 w-28 rounded-[1.75rem] border border-[#edd5c5] bg-white p-2 shadow-xl shadow-[#7f1218]/10" />
        <div>
            <p className="text-xs font-bold uppercase tracking-[0.45em] text-[#b98b2d]">{APP_BRAND_NAME}</p>
            <p className="mt-3 text-2xl font-black">Cargando informacion contable...</p>
        </div>
    </div>
);

const AppErrorState = () => (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#fff4f1] p-6 text-center">
        <img src={APP_BRAND_LOGO} alt={APP_BRAND_NAME} className="mb-6 h-32 w-32 rounded-[2rem] border border-[#f0d3c8] bg-white p-2 shadow-xl shadow-[#7f1218]/10" />
        <h1 className="text-3xl font-black text-[#8a141b]">Error de conexion</h1>
        <p className="mt-3 max-w-md text-sm font-medium text-[#6f4d48]">No logramos cargar la informacion de {APP_BRAND_NAME}. Revisa la conexion e intenta nuevamente.</p>
        <button onClick={() => window.location.reload()} className="mt-6 rounded-full bg-[#a81d24] px-6 py-3 text-sm font-bold text-white shadow-lg shadow-[#a81d24]/25 transition hover:bg-[#8c171d]">Reintentar</button>
    </div>
);

// --- FIRESTORE HOOK ---

const hasCollectionData = (currentData, collections = []) => (
    collections.every((c) => Array.isArray(currentData?.[c]))
);

const useFirestoreCollections = (collections = [], enabled = true, live = true) => {
    const [data, setData] = useState({});
    const [loading, setLoading] = useState(enabled);
    const [error, setError] = useState(null);
    const dataRef = useRef(data);

    useEffect(() => { dataRef.current = data; }, [data]);

    useEffect(() => {
        if (!enabled || !db || collections.length === 0) {
            setLoading(false);
            setError(null);
            return;
        }

        const hasCachedData = hasCollectionData(dataRef.current, collections);
        setLoading(!hasCachedData);
        setError(null);

        const unsubscribes = [];
        let mounted = true;
        const loadedCollections = new Set();

        const markLoaded = (name) => {
            if (loadedCollections.has(name)) return;
            loadedCollections.add(name);
            if (mounted && loadedCollections.size === collections.length) setLoading(false);
        };

        const loadOnce = async (name) => {
            try {
                const snapshot = await getDocs(query(collection(db, name)));
                if (!mounted) return;
                setData(prev => ({ ...prev, [name]: snapshot.docs.map(d => ({ id: d.id, ...d.data() })) }));
            } catch (e) {
                if (mounted) { console.error(`Error en ${name}:`, e); setError(e); }
            } finally {
                markLoaded(name);
            }
        };

        if (!live && hasCachedData) { setLoading(false); return; }

        collections.forEach((name) => {
            if (!live) { loadOnce(name); return; }

            const q = query(collection(db, name));
            unsubscribes.push(
                onSnapshot(q,
                    (snap) => {
                        if (!mounted) return;
                        setData(prev => ({ ...prev, [name]: snap.docs.map(d => ({ id: d.id, ...d.data() })) }));
                        markLoaded(name);
                    },
                    (e) => { console.error(`Error en ${name}:`, e); if (mounted) setError(e); markLoaded(name); }
                )
            );
        });

        return () => { mounted = false; unsubscribes.forEach(u => u()); };
    }, [collections, enabled, live]);

    return { data, loading, error };
};

// --- APP CONTENT ---

function AppContent() {
    const { user } = useAuth();
    const location = useLocation();

    const isLimitedUser = user?.email === 'adriandiazc95@gmail.com';
    const isAdmin = !isLimitedUser;
    const currentPath = location.pathname;
    const needsCategories = currentPath === '/ingresar' || currentPath === '/gastos-diarios' || currentPath.startsWith('/maestros/categorias');

    const { data: categoriesData } = useFirestoreCollections(CATEGORY_COLLECTIONS, !!user && needsCategories, true);
    const { data: dataEntryData, loading: dataEntryLoading, error: dataEntryError } = useFirestoreCollections(DATA_ENTRY_COLLECTIONS, !!user && isAdmin && currentPath === '/ingresar', true);
    const { data: accountsPayableData, loading: accountsPayableLoading, error: accountsPayableError } = useFirestoreCollections(ACCOUNTS_PAYABLE_COLLECTIONS, !!user && currentPath === '/cuentas-pagar', true);
    const { data: reportsData, loading: reportsLoading, error: reportsError } = useFirestoreCollections(REPORT_COLLECTIONS, !!user && isAdmin && currentPath === '/reportes', false);
    const { data: dashboardData, loading: dashboardLoading } = useFirestoreCollections(DASHBOARD_COLLECTIONS, !!user && isAdmin && currentPath === '/', false);

    const categoriesList = categoriesData.categorias || [];

    if (!user) {
        return <main><Routes><Route path="/login" element={<Login />} /><Route path="*" element={<Navigate to="/login" replace />} /></Routes></main>;
    }

    return (
        <>
            <Header />
            <main className="p-4 md:p-6">
                <Routes>
                    <Route path="/login" element={<Navigate to="/" replace />} />
                    <Route path="/" element={<PrivateRoute element={isAdmin ? (dashboardLoading ? <AppLoadingState /> : <Dashboard data={dashboardData} />) : <Navigate to="/cuentas-pagar" />} />} />
                    <Route path="/ingresar" element={<PrivateRoute element={isAdmin ? (dataEntryLoading ? <AppLoadingState /> : dataEntryError ? <AppErrorState /> : <DataEntry data={dataEntryData} categories={categoriesList} />) : <Navigate to="/cuentas-pagar" />} />} />
                    <Route path="/gastos-diarios" element={<PrivateRoute element={<GastosDiarios categories={categoriesList} />} />} />
                    <Route path="/conciliacion" element={<PrivateRoute element={isAdmin ? <BankReconciliation /> : <Navigate to="/cuentas-pagar" />} />} />
                    <Route path="/cuentas-pagar" element={<PrivateRoute element={accountsPayableLoading ? <AppLoadingState /> : accountsPayableError ? <AppErrorState /> : <AccountsPayable data={accountsPayableData} />} />} />
                    <Route path="/reportes" element={<PrivateRoute element={isAdmin ? (reportsLoading ? <AppLoadingState /> : reportsError ? <AppErrorState /> : <Reports data={reportsData} />) : <Navigate to="/cuentas-pagar" />} />} />
                    <Route path="/maestros/categorias" element={<PrivateRoute element={isAdmin ? <CategoryManager categories={categoriesList} /> : <Navigate to="/cuentas-pagar" />} />} />
                    <Route path="*" element={<Navigate to="/" />} />
                </Routes>
            </main>
        </>
    );
}

function App() {
    return (
        <Router>
            <AuthProvider>
                <AppContent />
            </AuthProvider>
        </Router>
    );
}

export default App;
