import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { db } from './firebase';
import { collection, query, onSnapshot, getDocs, doc, setDoc, updateDoc, where } from 'firebase/firestore';

import { AuthProvider, useAuth } from './context/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import Login from './components/Login';
import Header from './components/Header';
import HomeDashboard from './components/HomeDashboard';
import GastosDiarios from './components/GastosDiarios';
import { DataEntry } from './components/DataEntry';
import Billing from './components/Billing';
import Reports from './components/Reports';
import CategoryManager from './components/CategoryManager';
import Settings from './components/Settings';
import { AccountsPayable } from './components/AccountsPayable';
import ExecutiveFlowDiagram from './components/ExecutiveFlowDiagram';
import { APP_BRAND_LOGO, APP_BRAND_NAME, fmt } from './constants';
import {
    resolvePurchaseDiscountEntries,
    resolveSalesIncomeEntries,
} from './services/incomeAggregation';
import {
    USER_PROFILES_COLLECTION,
    canUseModule,
    getDefaultAllowedPath,
    getEffectiveModuleAccess,
    isMasterEmail,
    userProfileDocId,
} from './services/userAccess';

const BRAND_LOGO = APP_BRAND_LOGO;

const CATEGORY_COLLECTIONS = ['categorias', 'proveedores'];
const DATA_ENTRY_HISTORY_MONTHS = 6;
const REPORT_HISTORY_MONTHS = 24;
const ACCOUNT_HISTORY_MONTHS = 12;
const BILLING_HISTORY_MONTHS = 2;
const MAX_ROUTE_BLOCKING_MS = 900;
const INACTIVITY_TIMEOUT_MS = 3 * 60 * 60 * 1000;

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

const pageMotion = {
    initial: { opacity: 0, y: 18, scale: 0.992, filter: 'blur(6px)' },
    animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' },
    exit: { opacity: 0, y: -12, scale: 0.996, filter: 'blur(4px)' },
    transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] },
};

const getMonthOffset = (monthsBack = 0) => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() - monthsBack);
    return date.toISOString().substring(0, 7);
};

const getNextMonthStart = (month) => {
    const [year, monthIndex] = month.split('-').map(Number);
    const date = new Date(year, monthIndex, 1);
    return date.toISOString().substring(0, 10);
};

const collectionConfig = (name, constraints = []) => ({ name, constraints });

const normalizeCollectionConfig = (config) => (
    typeof config === 'string'
        ? { name: config, constraints: [] }
        : { name: config.name, constraints: config.constraints || [] }
);

const getCollectionName = (config) => normalizeCollectionConfig(config).name;

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
.dash-mesh{background:linear-gradient(135deg,#1a0a0b 0%,#3b1114 25%,#5c0f14 50%,#9f111a 75%,#111827 100%);background-size:300% 300%;animation:dash-gradient 12s ease infinite}
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
                className="dash-panel relative w-full max-w-md bg-white shadow-2xl shadow-[#9f111a]/20 overflow-hidden flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="dash-mesh px-6 py-5 flex items-center justify-between flex-shrink-0">
                    <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#f5b51b] mb-1">{APP_BRAND_NAME}</div>
                        <h2 className="text-lg font-black text-white">Configuracion de Inicio</h2>
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
                        <div key={r.id} className={`rounded-xl border p-3 transition-all ${r.activo ? 'border-[#d9e1e8] bg-white' : 'border-stone-200 bg-stone-50 opacity-60'}`}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-bold text-stone-800 truncate">{r.texto}</div>
                                    <div className="flex items-center gap-3 mt-2">
                                        <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Dia:</label>
                                        <input
                                            type="number"
                                            min="1"
                                            max="28"
                                            value={r.diaDelMes}
                                            onChange={e => updateDay(r.id, e.target.value)}
                                            className="w-14 rounded-lg border border-stone-200 px-2 py-1 text-xs font-bold text-stone-700 text-center focus:border-[#e30613] focus:ring-1 focus:ring-[#e30613]/20 outline-none"
                                        />
                                        <button
                                            onClick={() => toggleReminder(r.id)}
                                            className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${r.activo ? 'bg-[#e30613]' : 'bg-stone-300'}`}
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
                            className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-semibold text-stone-700 placeholder:text-stone-300 focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15 outline-none"
                        />
                        <div className="flex items-center gap-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Dia del mes:</label>
                            <input
                                type="number"
                                min="1"
                                max="28"
                                value={newDay}
                                onChange={e => setNewDay(e.target.value)}
                                className="w-16 rounded-lg border border-stone-200 px-2 py-1.5 text-sm font-bold text-stone-700 text-center focus:border-[#e30613] focus:ring-1 focus:ring-[#e30613]/20 outline-none"
                            />
                            <button
                                onClick={addReminder}
                                disabled={!newText.trim()}
                                className="ml-auto flex items-center gap-2 rounded-xl bg-[#e30613] px-4 py-2 text-xs font-bold text-white disabled:opacity-40 hover:bg-[#9f111a] transition"
                            >
                                <Icon d={ICON.plus} className="w-3.5 h-3.5" /> Agregar
                            </button>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="border-t border-[#d8dee6] bg-stone-50 px-5 py-4 flex items-center justify-between flex-shrink-0">
                    <button onClick={onClose} className="rounded-xl border border-stone-200 px-5 py-2.5 text-xs font-bold text-stone-600 hover:bg-stone-100 transition">
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="rounded-xl bg-[#e30613] px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-[#e30613]/25 hover:bg-[#9f111a] disabled:opacity-50 transition"
                    >
                        {saving ? 'Guardando...' : 'Guardar Cambios'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- DASHBOARD ---

const Dashboard = ({ data = {}, themeMode = 'dark', onThemeToggle }) => {
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

    const greeting = hour < 12 ? 'Buenos dias' : hour < 18 ? 'Buenas tardes' : 'Buenas noches';
    const greetingIcon = hour < 12 ? ICON.sun : hour < 18 ? ICON.sun : ICON.moon;
    const mesLabel = now.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

    const ingresos = resolveSalesIncomeEntries(data.ingresos || []);
    const descuentosCompras = resolvePurchaseDiscountEntries(data.ingresos || []);
    const gastos = data.gastos || [];
    const compras = data.compras || [];
    const facturas = data.cuentas_por_pagar || [];

    const mesIngresos = ingresos.filter(i => (i.month || (i.date || '').substring(0, 7)) === currentMonth);
    const mesDescuentosCompras = descuentosCompras.filter(i => (i.month || (i.date || '').substring(0, 7)) === currentMonth);
    const mesGastos = gastos.filter(g => (g.date || '').substring(0, 7) === currentMonth);
    const mesCompras = compras.filter(c => (c.month || (c.date || '').substring(0, 7)) === currentMonth);

    const totalIngresos = mesIngresos.reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const totalGastos = mesGastos.reduce((s, g) => s + (Number(g.amount) || 0), 0);
    const totalComprasBrutas = mesCompras.reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const totalDescuentosCompras = mesDescuentosCompras.reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const totalCompras = totalComprasBrutas - totalDescuentosCompras;
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
        ? `${vencidas.length} factura(s) vencida(s) - requieren atencion`
        : utilidad > 0
            ? `Utilidad positiva de ${fmt(utilidad)} este mes`
            : totalIngresos === 0 && totalGastos === 0
                ? 'Aun sin movimientos registrados este mes'
                : 'Gastos superan ingresos este periodo';

    const kpis = [
        { label: 'Ingresos', value: totalIngresos, count: mesIngresos.length, icon: ICON.trending_up, color: 'emerald', bg: 'from-emerald-500/10 to-emerald-500/5', accent: 'text-emerald-700', ring: 'ring-emerald-500/20' },
        { label: 'Gastos', value: totalGastos, count: mesGastos.length, icon: ICON.trending_down, color: 'rose', bg: 'from-rose-500/10 to-rose-500/5', accent: 'text-rose-700', ring: 'ring-rose-500/20' },
        { label: 'Compras', value: totalCompras, count: mesCompras.length, icon: ICON.cart, color: 'violet', bg: 'from-violet-500/10 to-violet-500/5', accent: 'text-violet-700', ring: 'ring-violet-500/20' },
        { label: 'Por Pagar', value: totalPendiente, count: facturasPendientes.length, icon: ICON.wallet, color: 'amber', bg: 'from-amber-500/10 to-amber-500/5', accent: 'text-amber-700', ring: 'ring-amber-500/20', alert: vencidas.length > 0 },
    ];

    const dailyActivity = useMemo(() => {
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const buckets = Array.from({ length: daysInMonth }, (_, index) => ({
            day: index + 1,
            income: 0,
            expense: 0,
            purchase: 0,
        }));

        const addToBucket = (item, key, multiplier = 1) => {
            const date = item.date || item.fecha || item.saleDate || '';
            const day = Number(String(date).substring(8, 10));
            if (!day || !buckets[day - 1]) return;
            buckets[day - 1][key] += (Number(item.subtotal ?? item.amount ?? item.monto ?? item.total) || 0) * multiplier;
        };

        mesIngresos.forEach((item) => addToBucket(item, 'income'));
        mesGastos.forEach((item) => addToBucket(item, 'expense'));
        mesCompras.forEach((item) => addToBucket(item, 'purchase'));
        mesDescuentosCompras.forEach((item) => addToBucket(item, 'purchase', -1));

        return buckets;
    }, [mesCompras, mesDescuentosCompras, mesGastos, mesIngresos, now]);

    const maxDailyActivity = Math.max(1, ...dailyActivity.map((day) => Math.max(day.income, day.expense + day.purchase)));
    const flowBase = Math.max(totalIngresos, totalGastos + totalCompras, Math.abs(utilidad), 1);
    const profitMargin = totalIngresos > 0 ? (utilidad / totalIngresos) * 100 : 0;
    const operatingRatio = totalIngresos > 0 ? ((totalGastos + totalCompras) / totalIngresos) * 100 : 0;
    const recentMovements = useMemo(() => ([
        ...mesIngresos.map((item) => ({
            id: `ingreso-${item.id || item.reference || item.date}`,
            type: 'Ingreso',
            title: item.description || item.detalle || item.reference || 'Venta diaria',
            amount: Number(item.subtotal ?? item.amount ?? item.total ?? 0) || 0,
            date: item.date || item.fecha || '',
            accent: 'emerald',
        })),
        ...mesCompras.map((item) => ({
            id: `compra-${item.id || item.invoiceNumber || item.date}`,
            type: 'Compra',
            title: item.supplier || item.proveedor || item.invoiceNumber || 'Compra registrada',
            amount: Number(item.subtotal ?? item.amount ?? item.total ?? 0) || 0,
            date: item.date || item.fecha || '',
            accent: 'amber',
        })),
        ...mesDescuentosCompras.map((item) => ({
            id: `descuento-compra-${item.id || item.reference || item.date}`,
            type: 'Desc. compras',
            title: item.description || item.detalle || item.reference || 'Descuento sobre compras',
            amount: -(Number(item.subtotal ?? item.amount ?? item.total ?? 0) || 0),
            date: item.date || item.fecha || '',
            accent: 'emerald',
        })),
        ...mesGastos.map((item) => ({
            id: `gasto-${item.id || item.invoiceNumber || item.date}`,
            type: 'Gasto',
            title: item.category || item.description || item.supplier || 'Gasto operativo',
            amount: Number(item.subtotal ?? item.amount ?? item.total ?? 0) || 0,
            date: item.date || item.fecha || '',
            accent: 'rose',
        })),
    ].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 7)), [mesCompras, mesDescuentosCompras, mesGastos, mesIngresos]);

    return (
        <>
            <style>{DASHBOARD_STYLES}</style>
            {showSettings && <SettingsPanel config={config} onClose={() => setShowSettings(false)} onSave={saveSettings} />}
            <HomeDashboard
                configLoading={configLoading}
                currentMonth={currentMonth}
                dayOfMonth={dayOfMonth}
                greeting={greeting}
                mesLabel={mesLabel}
                insight={insight}
                totalIngresos={totalIngresos}
                totalGastos={totalGastos}
                totalCompras={totalCompras}
                utilidad={utilidad}
                facturasPendientes={facturasPendientes}
                totalPendiente={totalPendiente}
                vencidas={vencidas}
                allReminders={allReminders}
                pendingReminders={pendingReminders}
                doneCount={doneCount}
                markAsDone={markAsDone}
                justCompleted={justCompleted}
                setShowSettings={setShowSettings}
                dailyActivity={dailyActivity}
                maxDailyActivity={maxDailyActivity}
                profitMargin={profitMargin}
                operatingRatio={operatingRatio}
                recentMovements={recentMovements}
                mesGastos={mesGastos}
                mesCompras={mesCompras}
                themeMode={themeMode}
                onThemeToggle={onThemeToggle}
            />
        </>
    );

    return (
        <div className="space-y-5 dash-dots min-h-[70vh]">
            <style>{DASHBOARD_STYLES}</style>

            {showSettings && <SettingsPanel config={config} onClose={() => setShowSettings(false)} onSave={saveSettings} />}

            {/* ========= HERO HEADER ========= */}
            <div className="dash-up overflow-hidden rounded-2xl shadow-xl shadow-[#9f111a]/12">
                <div className="dash-mesh relative px-6 py-7 md:px-8 md:py-8 overflow-hidden">
                    {/* Decorative dots overlay */}
                    <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'radial-gradient(circle, #f5b51b 1px, transparent 1px)', backgroundSize: '16px 16px' }} />

                    <div className="relative flex items-start justify-between gap-4">
                        <div className="space-y-3 flex-1">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-xl bg-white/10">
                                    <Icon d={greetingIcon} className="w-5 h-5 text-[#f5b51b]" />
                                </div>
                                <div>
                                    <div className="text-sm font-black text-white tracking-wide">{greeting}</div>
                                    <div className="text-xs text-white/40 font-medium capitalize">{mesLabel}</div>
                                </div>
                            </div>

                            <div className="border-l-2 border-[#f5b51b]/30 pl-4">
                                <p className="text-xs text-white/60 font-medium">{insight}</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                            <img src={BRAND_LOGO} alt="Logo" className="hidden sm:block h-12 w-12 rounded-2xl border border-white/10 object-cover" />
                            <button
                                onClick={() => setShowSettings(true)}
                                className="p-2.5 rounded-xl bg-white/8 border border-white/10 text-white/60 hover:bg-white/15 hover:text-[#f5b51b] transition-all group"
                                title="Configuracion"
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

            {/* ========= ERP COCKPIT ========= */}
            <div className="dash-up dash-up-1 grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_0.9fr]">
                <div className="relative overflow-hidden rounded-3xl border border-[#d9c5b6] bg-[#f9fbfc] shadow-xl shadow-[#111827]/5">
                    <div className="border-b border-slate-200 bg-white/90 px-5 py-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.35em] text-slate-400">Financial cockpit</div>
                                <h2 className="mt-1 text-xl font-black text-slate-900">Estado operativo del mes</h2>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-emerald-700">
                                    Margen {profitMargin.toFixed(1)}%
                                </span>
                                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-amber-700">
                                    Costo/Gasto {operatingRatio.toFixed(1)}%
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-5 p-5">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                            {[
                                ['Ventas contables', totalIngresos, 'bg-sky-500', ICON.trending_up],
                                ['Compras / costo', totalCompras, 'bg-amber-500', ICON.cart],
                                ['Gastos operativos', totalGastos, 'bg-rose-500', ICON.trending_down],
                                ['Resultado neto', utilidad, utilidad >= 0 ? 'bg-emerald-600' : 'bg-rose-700', ICON.wallet],
                            ].map(([label, value, color, icon]) => {
                                const width = Math.max(6, Math.min(100, (Math.abs(value) / flowBase) * 100));
                                return (
                                    <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                                        <div className="mb-3 flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-2">
                                                <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${color} text-white`}>
                                                    <Icon d={icon} className="h-4 w-4" />
                                                </span>
                                                <div className="text-xs font-black uppercase tracking-wider text-slate-500">{label}</div>
                                            </div>
                                            <div className={`font-mono text-sm font-black ${value < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{fmt(value)}</div>
                                        </div>
                                        <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                                            <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${width}%` }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <ExecutiveFlowDiagram
                            embedded
                            source={{ label: 'Ventas subtotal', value: totalIngresos, subtitle: 'Ingreso contable del mes' }}
                            center={{ label: 'Utilidad', value: utilidad, subtitle: 'despues de costo y gasto' }}
                            top={{ label: 'Compras / costo', value: totalCompras, subtitle: 'Costo registrado' }}
                            middle={{ label: 'Gastos', value: totalGastos, subtitle: 'Operacion mensual' }}
                            bottom={{ label: 'Resultado neto', value: utilidad, subtitle: utilidad >= 0 ? 'Rentable' : 'Requiere ajuste' }}
                        />
                    </div>
                </div>

                <div className="rounded-3xl border border-[#d9c5b6] bg-white p-5 shadow-xl shadow-[#111827]/5">
                    <div className="mb-4 flex items-center justify-between">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.32em] text-slate-400">Actividad diaria</div>
                            <div className="mt-1 text-lg font-black text-slate-900">Movimiento del mes</div>
                        </div>
                        <span className="rounded-full bg-[#fff4df] px-3 py-1 text-[11px] font-black uppercase tracking-wider text-[#8a5a11]">{currentMonth}</span>
                    </div>

                    <div className="flex h-56 items-end gap-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-4">
                        {dailyActivity.map((day) => {
                            const inflowHeight = Math.max(3, (day.income / maxDailyActivity) * 100);
                            const outflowHeight = Math.max(3, ((day.expense + day.purchase) / maxDailyActivity) * 100);
                            const isToday = day.day === dayOfMonth;
                            return (
                                <div key={day.day} className="group flex flex-1 flex-col items-center justify-end gap-1">
                                    <div className="relative flex h-44 w-full items-end justify-center gap-0.5">
                                        <div className="w-1.5 rounded-t-full bg-emerald-500 transition-all group-hover:bg-emerald-600" style={{ height: `${inflowHeight}%` }} />
                                        <div className="w-1.5 rounded-t-full bg-rose-400 transition-all group-hover:bg-rose-500" style={{ height: `${outflowHeight}%` }} />
                                    </div>
                                    <div className={`text-[9px] font-black ${isToday ? 'text-[#e30613]' : 'text-slate-400'}`}>{day.day}</div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-bold text-slate-500">
                        <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Entradas</div>
                        <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-rose-400" /> Salidas</div>
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
                        <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#b7791f] mb-1">Resultado del Mes</div>
                        <div className="text-xs text-stone-400 mb-2">Ingresos - Gastos - Compras</div>
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
            <div className="dash-up dash-up-6 grid grid-cols-1 gap-4 md:gap-5 xl:grid-cols-3">
                {/* --- REMINDERS --- */}
                <div className="rounded-2xl border border-[#d9e1e8] bg-white overflow-hidden shadow-sm">
                    <div className="flex items-center justify-between px-5 py-3 border-b border-[#d8dee6] bg-gradient-to-r from-stone-50 to-white">
                        <div className="flex items-center gap-2.5">
                            <div className="p-1.5 rounded-lg bg-[#fff1f2]">
                                <Icon d={ICON.bell} className="w-4 h-4 text-[#e30613]" />
                            </div>
                            <div>
                                <div className="text-xs font-bold uppercase tracking-wider text-[#1f2937]">Recordatorios</div>
                                {allReminders.length > 0 && (
                                    <div className="text-[10px] text-stone-400 font-medium">{doneCount} de {allReminders.length} completados</div>
                                )}
                            </div>
                        </div>
                        <button
                            onClick={() => setShowSettings(true)}
                            className="p-1.5 rounded-lg text-stone-400 hover:text-[#e30613] hover:bg-[#fff1f2] transition"
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
                                    {dayOfMonth < 7 ? 'Los recordatorios aparecen a partir del dia 7' : 'No hay recordatorios configurados'}
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
                                                className="h-full rounded-full bg-gradient-to-r from-[#e30613] to-[#f5b51b] transition-all duration-700"
                                                style={{ width: `${allReminders.length > 0 ? (doneCount / allReminders.length) * 100 : 0}%` }}
                                            />
                                        </div>
                                    </div>
                                )}
                                {pendingReminders.map(r => (
                                    <div
                                        key={r.id}
                                        className={`group flex items-center gap-3 rounded-xl border border-stone-100 px-3.5 py-2.5 transition-all hover:border-[#d9e1e8] hover:bg-[#fffaf7] ${justCompleted === r.id ? 'opacity-40 scale-95' : ''}`}
                                    >
                                        <button
                                            onClick={() => markAsDone(r.id)}
                                            className="w-5 h-5 rounded-md border-2 border-stone-300 flex items-center justify-center flex-shrink-0 group-hover:border-[#e30613] transition-colors"
                                        >
                                            {justCompleted === r.id && (
                                                <Icon d={ICON.check} className="w-3 h-3 text-[#e30613] dash-check" />
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
                <div className="rounded-2xl border border-[#d9e1e8] bg-white overflow-hidden shadow-sm">
                    <div className="flex items-center gap-2.5 px-5 py-3 border-b border-[#d8dee6] bg-gradient-to-r from-stone-50 to-white">
                        <div className={`p-1.5 rounded-lg ${vencidas.length > 0 ? 'bg-amber-100' : 'bg-stone-100'}`}>
                            <Icon d={ICON.alert} className={`w-4 h-4 ${vencidas.length > 0 ? 'text-amber-600' : 'text-stone-400'}`} />
                        </div>
                        <div>
                            <div className="text-xs font-bold uppercase tracking-wider text-[#1f2937]">Cuentas por Pagar</div>
                            <div className="text-[10px] text-stone-400 font-medium">
                                {facturasPendientes.length} pendientes{vencidas.length > 0 ? ` ? ${vencidas.length} vencida(s)` : ''}
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
                                            <div className="text-[10px] text-amber-600">{f.numero || ''}{f.vencimiento ? ` ? Venci? ${f.vencimiento}` : ''}</div>
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
                                <p className="text-xs text-stone-400 mt-0.5">Todas las cuentas estan al dia</p>
                            </div>
                        ) : (
                            facturasPendientes.filter(f => !vencidas.includes(f)).slice(0, 6).map(f => (
                                <div key={f.id} className="flex items-center justify-between rounded-xl border border-stone-100 px-3.5 py-2.5">
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-bold text-stone-700 truncate">{f.proveedor || f.supplier || 'Sin proveedor'}</div>
                                        <div className="text-[10px] text-stone-400">{f.numero || ''}{f.vencimiento ? ` ? Vence ${f.vencimiento}` : ''}</div>
                                    </div>
                                    <div className="text-xs font-black text-stone-800 flex-shrink-0 ml-3 font-mono">{fmt(f.saldo)}</div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* --- ACTIVIDAD RECIENTE --- */}
                <div className="rounded-2xl border border-[#d9e1e8] bg-white overflow-hidden shadow-sm">
                    <div className="flex items-center gap-2.5 px-5 py-3 border-b border-[#d8dee6] bg-gradient-to-r from-stone-50 to-white">
                        <div className="p-1.5 rounded-lg bg-sky-100">
                            <Icon d={ICON.clock} className="w-4 h-4 text-sky-700" />
                        </div>
                        <div>
                            <div className="text-xs font-bold uppercase tracking-wider text-[#1f2937]">Bitacora ejecutiva</div>
                            <div className="text-[10px] text-stone-400 font-medium">Ultimos movimientos del mes</div>
                        </div>
                    </div>

                    <div className="p-4 space-y-2 max-h-72 overflow-y-auto">
                        {recentMovements.length === 0 ? (
                            <div className="py-8 text-center text-xs font-semibold text-stone-400">Aun no hay movimientos recientes.</div>
                        ) : recentMovements.map((movement) => {
                            const accentClass = movement.accent === 'emerald'
                                ? 'bg-emerald-100 text-emerald-700'
                                : movement.accent === 'amber'
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-rose-100 text-rose-700';
                            return (
                                <div key={movement.id} className="group rounded-xl border border-stone-100 bg-white px-3.5 py-3 transition hover:border-[#d9e1e8] hover:bg-[#fffaf7]">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${accentClass}`}>{movement.type}</span>
                                            <div className="mt-1 truncate text-sm font-black text-stone-800">{movement.title}</div>
                                            <div className="text-[10px] font-semibold text-stone-400">{movement.date || 'Sin fecha'}</div>
                                        </div>
                                        <div className="font-mono text-xs font-black text-[#9f111a]">{fmt(movement.amount)}</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- LOADING / ERROR ---

const AppLoadingState = () => (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-[#fff8f3] px-6 text-center text-[#9f111a]">
        <img src={APP_BRAND_LOGO} alt={APP_BRAND_NAME} className="h-28 w-28 rounded-[1.75rem] border border-[#edd5c5] bg-white p-2 shadow-xl shadow-[#9f111a]/10" />
        <div>
            <p className="text-xs font-bold uppercase tracking-[0.45em] text-[#b7791f]">{APP_BRAND_NAME}</p>
            <p className="mt-3 text-2xl font-black">Cargando informacion contable...</p>
        </div>
    </div>
);

const getFirestoreErrorMessage = (error) => {
    const code = error?.code || '';

    if (code.includes('permission-denied')) {
        return 'Firebase rechazo la lectura. Revisa que hayas iniciado sesion y que las reglas de Firestore esten desplegadas.';
    }

    if (code.includes('unavailable') || code.includes('failed-precondition')) {
        return 'Firestore no esta disponible o todavia no esta listo en este proyecto. Revisa que Firestore Database este creado y activo.';
    }

    return error?.message || `No logramos cargar la informacion de ${APP_BRAND_NAME}. Revisa la conexion e intenta nuevamente.`;
};

const AppErrorState = ({ error }) => (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#fff4f1] p-6 text-center">
        <img src={APP_BRAND_LOGO} alt={APP_BRAND_NAME} className="mb-6 h-32 w-32 rounded-[2rem] border border-[#f0d3c8] bg-white p-2 shadow-xl shadow-[#9f111a]/10" />
        <h1 className="text-3xl font-black text-[#9f111a]">Error de conexion</h1>
        <p className="mt-3 max-w-md text-sm font-medium text-[#6f4d48]">{getFirestoreErrorMessage(error)}</p>
        {error?.code && <p className="mt-2 font-mono text-xs font-bold text-[#e30613]">{error.code}</p>}
        <button onClick={() => window.location.reload()} className="mt-6 rounded-full bg-[#e30613] px-6 py-3 text-sm font-bold text-white shadow-lg shadow-[#e30613]/25 transition hover:bg-[#8c171d]">Reintentar</button>
    </div>
);

// --- FIRESTORE HOOK ---

const hasCollectionData = (currentData, collections = []) => (
    collections.every((config) => Array.isArray(currentData?.[getCollectionName(config)]))
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

        const configs = collections.map(normalizeCollectionConfig);
        const hasCachedData = hasCollectionData(dataRef.current, configs);
        setLoading(!hasCachedData);
        setError(null);

        const unsubscribes = [];
        let mounted = true;
        const loadedCollections = new Set();
        const unblockTimer = window.setTimeout(() => {
            if (mounted) setLoading(false);
        }, MAX_ROUTE_BLOCKING_MS);

        const markLoaded = (name) => {
            if (loadedCollections.has(name)) return;
            loadedCollections.add(name);
            if (mounted && loadedCollections.size === collections.length) {
                window.clearTimeout(unblockTimer);
                setLoading(false);
            }
        };

        const loadOnce = async (name) => {
            try {
                const config = configs.find((item) => item.name === name) || { constraints: [] };
                const snapshot = await getDocs(query(collection(db, name), ...config.constraints));
                if (!mounted) return;
                setData(prev => ({ ...prev, [name]: snapshot.docs.map(d => ({ id: d.id, ...d.data() })) }));
            } catch (e) {
                if (mounted) { console.error(`Error en ${name}:`, e); setError(e); }
            } finally {
                markLoaded(name);
            }
        };

        configs.forEach((config) => {
            const { name, constraints } = config;
            if (!live) { loadOnce(name); return; }

            const q = query(collection(db, name), ...constraints);
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

        return () => {
            mounted = false;
            window.clearTimeout(unblockTimer);
            unsubscribes.forEach(u => u());
        };
    }, [collections, enabled, live]);

    return { data, loading, error };
};

const useUserModuleAccess = (user) => {
    const [state, setState] = useState({
        loading: false,
        profile: null,
        moduleAccess: {},
        isMaster: false,
    });

    useEffect(() => {
        if (!user?.email) {
            setState({ loading: false, profile: null, moduleAccess: {}, isMaster: false });
            return undefined;
        }

        if (isMasterEmail(user.email)) {
            setState({
                loading: false,
                profile: { email: user.email, role: 'master', active: true },
                moduleAccess: getEffectiveModuleAccess(user.email, null),
                isMaster: true,
            });
            return undefined;
        }

        setState((current) => ({
            ...current,
            loading: true,
            isMaster: false,
        }));

        const profileRef = doc(db, USER_PROFILES_COLLECTION, userProfileDocId(user.email));
        const unsubscribe = onSnapshot(
            profileRef,
            (snapshot) => {
                const profile = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
                setState({
                    loading: false,
                    profile,
                    moduleAccess: getEffectiveModuleAccess(user.email, profile),
                    isMaster: false,
                });
            },
            (error) => {
                console.error('Error cargando permisos del usuario:', error);
                setState({
                    loading: false,
                    profile: null,
                    moduleAccess: getEffectiveModuleAccess(user.email, null),
                    isMaster: false,
                });
            }
        );

        return () => unsubscribe();
    }, [user?.email]);

    return state;
};

const useInactivityLogout = (user, logout) => {
    useEffect(() => {
        if (!user) return undefined;

        let timeoutId = null;

        const logoutForInactivity = async () => {
            try {
                window.localStorage.setItem('csm-last-auto-logout', new Date().toISOString());
                await logout();
            } catch (error) {
                console.error('No se pudo cerrar sesion por inactividad:', error);
            }
        };

        const resetTimer = () => {
            window.clearTimeout(timeoutId);
            window.localStorage.setItem('csm-last-activity', String(Date.now()));
            timeoutId = window.setTimeout(logoutForInactivity, INACTIVITY_TIMEOUT_MS);
        };

        const events = ['click', 'keydown', 'mousemove', 'scroll', 'touchstart', 'pointerdown'];
        events.forEach((eventName) => window.addEventListener(eventName, resetTimer, { passive: true }));
        resetTimer();

        return () => {
            window.clearTimeout(timeoutId);
            events.forEach((eventName) => window.removeEventListener(eventName, resetTimer));
        };
    }, [user, logout]);
};

// --- APP CONTENT ---

function AppContent() {
    const { user, logout } = useAuth();
    const location = useLocation();
    const { loading: accessLoading, moduleAccess, isMaster } = useUserModuleAccess(user);
    const effectiveIsMaster = isMaster || isMasterEmail(user?.email);
    useInactivityLogout(user, logout);
    const [themeMode, setThemeMode] = useState(() => {
        if (typeof window === 'undefined') return 'dark';
        return window.localStorage.getItem('csm-theme-mode') || 'dark';
    });
    const effectiveThemeMode = user && !accessLoading && !effectiveIsMaster ? 'light' : themeMode;

    useEffect(() => {
        document.documentElement.dataset.theme = effectiveThemeMode;
        window.localStorage.setItem('csm-theme-mode', effectiveThemeMode);
    }, [effectiveThemeMode]);

    useEffect(() => {
        if (user && !accessLoading && !effectiveIsMaster && themeMode !== 'light') {
            setThemeMode('light');
        }
    }, [accessLoading, effectiveIsMaster, themeMode, user]);

    const toggleTheme = useCallback(() => {
        if (!effectiveIsMaster) {
            setThemeMode('light');
            return;
        }
        setThemeMode((current) => (current === 'dark' ? 'light' : 'dark'));
    }, [effectiveIsMaster]);

    const canAccess = useCallback((moduleId) => effectiveIsMaster || canUseModule(moduleAccess, moduleId), [effectiveIsMaster, moduleAccess]);
    const defaultAllowedPath = useMemo(() => (effectiveIsMaster ? '/' : getDefaultAllowedPath(moduleAccess)), [effectiveIsMaster, moduleAccess]);
    const currentPath = location.pathname;
    const needsCategories = (
        (currentPath === '/ingresar' && canAccess('ingresar'))
        || (currentPath === '/gastos-diarios' && canAccess('caja_chica'))
        || (currentPath.startsWith('/maestros/categorias') && canAccess('categorias'))
        || (currentPath.startsWith('/configuraciones') && effectiveIsMaster)
    );
    const currentMonth = useMemo(() => getMonthOffset(0), []);
    const dataEntryStartMonth = useMemo(() => getMonthOffset(DATA_ENTRY_HISTORY_MONTHS), []);
    const reportStartMonth = useMemo(() => getMonthOffset(REPORT_HISTORY_MONTHS), []);
    const accountStartMonth = useMemo(() => getMonthOffset(ACCOUNT_HISTORY_MONTHS), []);
    const billingStartMonth = useMemo(() => getMonthOffset(BILLING_HISTORY_MONTHS), []);
    const currentMonthStart = `${currentMonth}-01`;
    const nextMonthStart = getNextMonthStart(currentMonth);

    const dashboardCollections = useMemo(() => [
        collectionConfig('ingresos', [where('month', '==', currentMonth)]),
        collectionConfig('gastos', [where('date', '>=', currentMonthStart), where('date', '<', nextMonthStart)]),
        collectionConfig('compras', [where('month', '==', currentMonth)]),
        collectionConfig('cuentas_por_pagar', [where('estado', 'in', ['pendiente', 'parcial'])]),
    ], [currentMonth, currentMonthStart, nextMonthStart]);

    const dataEntryCollections = useMemo(() => [
        collectionConfig('ingresos', [where('month', '>=', dataEntryStartMonth)]),
        collectionConfig('gastos', [where('date', '>=', `${dataEntryStartMonth}-01`)]),
        collectionConfig('inventarios', [where('month', '>=', dataEntryStartMonth)]),
        collectionConfig('compras', [where('month', '>=', dataEntryStartMonth)]),
        collectionConfig('presupuestos', [where('month', '>=', dataEntryStartMonth)]),
        collectionConfig('cuentasPorCobrar', [where('date', '>=', `${dataEntryStartMonth}-01`)]),
        collectionConfig('patrimonio', [where('date', '>=', `${dataEntryStartMonth}-01`)]),
        collectionConfig('bank_statements', [where('is_finalized', '==', false)]),
        'proveedores',
    ], [dataEntryStartMonth]);

    const reportCollections = useMemo(() => [
        collectionConfig('ingresos', [where('month', '>=', reportStartMonth)]),
        collectionConfig('facturas_membretadas_ventas', [where('saleDate', '>=', `${reportStartMonth}-01`)]),
        collectionConfig('recibos_caja_membretados', [where('date', '>=', `${reportStartMonth}-01`)]),
        collectionConfig('gastos', [where('date', '>=', `${reportStartMonth}-01`)]),
        collectionConfig('inventarios', [where('month', '>=', reportStartMonth)]),
        collectionConfig('compras', [where('month', '>=', reportStartMonth)]),
        collectionConfig('presupuestos', [where('month', '>=', reportStartMonth)]),
        collectionConfig('cuentas_por_pagar', [where('month', '>=', reportStartMonth)]),
    ], [reportStartMonth]);

    const accountsPayableCollections = useMemo(() => [
        collectionConfig('cuentas_por_pagar', [where('estado', 'in', ['pendiente', 'parcial'])]),
        collectionConfig('abonos_pagar', [where('fecha', '>=', `${accountStartMonth}-01`)]),
        'proveedores',
    ], [accountStartMonth]);

    const billingCollections = useMemo(() => [
        collectionConfig('sicar_cierres_caja', [where('date', '>=', `${billingStartMonth}-01`)]),
        collectionConfig('sicar_facturas_membretadas', [where('date', '>=', `${billingStartMonth}-01`)]),
        collectionConfig('cierres_caja', [where('date', '>=', `${billingStartMonth}-01`)]),
        collectionConfig('depositos_bancarios', [where('date', '>=', `${billingStartMonth}-01`)]),
        collectionConfig('diferencias_caja', [where('date', '>=', `${billingStartMonth}-01`)]),
        collectionConfig('facturas_membretadas_ventas', [where('saleDate', '>=', `${billingStartMonth}-01`)]),
        collectionConfig('recibos_caja_membretados', [where('date', '>=', `${billingStartMonth}-01`)]),
        'clientes_facturacion',
        'cajeros',
    ], [billingStartMonth]);

    const { data: categoriesData } = useFirestoreCollections(CATEGORY_COLLECTIONS, !!user && !accessLoading && needsCategories, false);
    const { data: dataEntryData, loading: dataEntryLoading, error: dataEntryError } = useFirestoreCollections(dataEntryCollections, !!user && !accessLoading && canAccess('ingresar') && currentPath === '/ingresar', true);
    const { data: accountsPayableData, loading: accountsPayableLoading, error: accountsPayableError } = useFirestoreCollections(accountsPayableCollections, !!user && !accessLoading && canAccess('cuentas_pagar') && currentPath === '/cuentas-pagar', true);
    const { data: reportsData, loading: reportsLoading, error: reportsError } = useFirestoreCollections(reportCollections, !!user && !accessLoading && canAccess('reportes') && currentPath === '/reportes', false);
    const { data: dashboardData, loading: dashboardLoading, error: dashboardError } = useFirestoreCollections(dashboardCollections, !!user && !accessLoading && canAccess('dashboard') && currentPath === '/', false);
    const { data: billingData, loading: billingLoading, error: billingError } = useFirestoreCollections(billingCollections, !!user && !accessLoading && canAccess('facturacion') && currentPath === '/facturacion', true);

    const categoriesList = useMemo(() => (
        [...(categoriesData.categorias || [])].sort((a, b) => {
            const orderA = Number.isFinite(Number(a.order)) ? Number(a.order) : 9999;
            const orderB = Number.isFinite(Number(b.order)) ? Number(b.order) : 9999;
            if (orderA !== orderB) return orderA - orderB;
            return String(a.name || '').localeCompare(String(b.name || ''), 'es');
        })
    ), [categoriesData.categorias]);

    if (!user) {
        return <main><Routes><Route path="/login" element={<Login />} /><Route path="*" element={<Navigate to="/login" replace />} /></Routes></main>;
    }

    if (accessLoading) {
        return (
            <>
                <Header moduleAccess={{}} isMaster={false} defaultPath="/" />
                <main className="app-route-shell p-4 md:p-6">
                    <AppLoadingState />
                </main>
            </>
        );
    }

    return (
        <>
            <Header moduleAccess={moduleAccess} isMaster={effectiveIsMaster} defaultPath={defaultAllowedPath} />
            <AnimatePresence mode="wait" initial={false}>
                <motion.main
                    key={location.pathname}
                    className="app-route-shell p-4 md:p-6"
                    initial={pageMotion.initial}
                    animate={pageMotion.animate}
                    exit={pageMotion.exit}
                    transition={pageMotion.transition}
                >
                    <Routes location={location}>
                        <Route path="/login" element={<Navigate to={defaultAllowedPath} replace />} />
                        <Route path="/" element={<PrivateRoute element={canAccess('dashboard') ? (dashboardLoading ? <AppLoadingState /> : dashboardError ? <AppErrorState error={dashboardError} /> : <Dashboard data={dashboardData} themeMode={effectiveThemeMode} onThemeToggle={effectiveIsMaster ? toggleTheme : undefined} />) : <Navigate to={defaultAllowedPath} replace />} />} />
                        <Route path="/ingresar" element={<PrivateRoute element={canAccess('ingresar') ? (dataEntryLoading ? <AppLoadingState /> : dataEntryError ? <AppErrorState error={dataEntryError} /> : <DataEntry data={dataEntryData} categories={categoriesList} />) : <Navigate to={defaultAllowedPath} replace />} />} />
                        <Route path="/gastos-diarios" element={<PrivateRoute element={canAccess('caja_chica') ? <GastosDiarios categories={categoriesList} providers={categoriesData.proveedores || []} /> : <Navigate to={defaultAllowedPath} replace />} />} />
                        <Route path="/conciliacion" element={<PrivateRoute element={<Navigate to={defaultAllowedPath} replace />} />} />
                        <Route path="/facturacion" element={<PrivateRoute element={canAccess('facturacion') ? (billingLoading ? <AppLoadingState /> : billingError ? <AppErrorState error={billingError} /> : <Billing data={billingData} />) : <Navigate to={defaultAllowedPath} replace />} />} />
                        <Route path="/cuentas-pagar" element={<PrivateRoute element={canAccess('cuentas_pagar') ? (accountsPayableLoading ? <AppLoadingState /> : accountsPayableError ? <AppErrorState error={accountsPayableError} /> : <AccountsPayable data={accountsPayableData} />) : <Navigate to={defaultAllowedPath} replace />} />} />
                        <Route path="/reportes" element={<PrivateRoute element={canAccess('reportes') ? (reportsLoading ? <AppLoadingState /> : reportsError ? <AppErrorState error={reportsError} /> : <Reports data={reportsData} />) : <Navigate to={defaultAllowedPath} replace />} />} />
                        <Route path="/configuraciones" element={<PrivateRoute element={effectiveIsMaster ? <Settings /> : <Navigate to={defaultAllowedPath} replace />} />} />
                        <Route path="/maestros/categorias" element={<PrivateRoute element={canAccess('categorias') ? <CategoryManager categories={categoriesList} /> : <Navigate to={defaultAllowedPath} replace />} />} />
                        <Route path="/sin-permisos" element={<PrivateRoute element={effectiveIsMaster ? <Navigate to="/" replace /> : <AppErrorState error={{ message: 'Este usuario no tiene modulos asignados. Pide al usuario master que active sus permisos en Configuraciones > Usuarios.' }} />} />} />
                        <Route path="*" element={<Navigate to={defaultAllowedPath} replace />} />
                    </Routes>
                </motion.main>
            </AnimatePresence>
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
