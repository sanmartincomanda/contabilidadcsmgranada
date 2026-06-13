import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { APP_BRAND_LOGO, APP_BRAND_NAME, fmt } from '../constants';

const Icons = {
    chart: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    plus: 'M12 4v16m8-8H4',
    wallet: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
    alert: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
    check: 'M5 13l4 4L19 7',
    arrow: 'M13 7l5 5m0 0l-5 5m5-5H6',
    trendingUp: 'M13 7h8m0 0v8m0-8l-8-8-4 4-6-6',
    trendingDown: 'M13 17h8m0 0V9m0 8l-8-8-4 4-6-6',
    cart: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z',
    gear: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
    receipt: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
    moon: 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z',
    sun: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z',
};

const Icon = ({ path, className = 'h-5 w-5' }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
);

const toneStyles = {
    green: {
        card: 'border-emerald-200/70 bg-emerald-50/70 text-emerald-800',
        icon: 'bg-emerald-500 text-white shadow-emerald-500/20',
        bar: 'bg-emerald-500',
    },
    red: {
        card: 'border-rose-200/70 bg-rose-50/70 text-rose-800',
        icon: 'bg-rose-500 text-white shadow-rose-500/20',
        bar: 'bg-rose-500',
    },
    blue: {
        card: 'border-sky-200/70 bg-sky-50/70 text-sky-800',
        icon: 'bg-sky-500 text-white shadow-sky-500/20',
        bar: 'bg-sky-500',
    },
    amber: {
        card: 'border-amber-200/70 bg-amber-50/70 text-amber-800',
        icon: 'bg-amber-500 text-white shadow-amber-500/20',
        bar: 'bg-amber-500',
    },
    slate: {
        card: 'border-slate-200 bg-white text-slate-800',
        icon: 'bg-slate-950 text-white shadow-slate-950/20',
        bar: 'bg-slate-700',
    },
};

const KpiCard = ({ label, value, detail, icon, tone = 'slate', progress = 0 }) => {
    const styles = toneStyles[tone] || toneStyles.slate;
    const safeProgress = Math.max(6, Math.min(100, Number(progress) || 0));

    return (
        <section className={`motion-card rounded-[1.6rem] border p-4 transition hover:-translate-y-0.5 ${styles.card}`}>
            <div className="flex items-start justify-between gap-3">
                <div className={`grid h-11 w-11 place-items-center rounded-2xl shadow-lg ${styles.icon}`}>
                    <Icon path={icon} className="h-5 w-5" />
                </div>
                <span className="rounded-full border border-current/10 bg-white/55 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] opacity-75">
                    Mes
                </span>
            </div>
            <div className="mt-4 font-mono text-2xl font-black tracking-tight text-current">{value}</div>
            <div className="mt-1 text-[11px] font-black uppercase tracking-[0.22em] opacity-70">{label}</div>
            <div className="mt-1 min-h-[1.25rem] text-xs font-semibold text-current opacity-70">{detail}</div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/70">
                <div className={`h-full rounded-full ${styles.bar}`} style={{ width: `${safeProgress}%` }} />
            </div>
        </section>
    );
};

const QuickAction = ({ to, label, detail, icon, tone = 'slate' }) => {
    const styles = toneStyles[tone] || toneStyles.slate;
    return (
        <Link
            to={to}
            className="motion-card group flex items-center gap-3 rounded-[1.35rem] border border-slate-200 bg-white p-3.5 transition hover:-translate-y-0.5 hover:border-slate-300"
        >
            <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl shadow-lg ${styles.icon}`}>
                <Icon path={icon} className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-black text-slate-950">{label}</span>
                <span className="block truncate text-xs font-semibold text-slate-500">{detail}</span>
            </span>
            <Icon path={Icons.arrow} className="h-4 w-4 text-slate-300 transition group-hover:translate-x-1 group-hover:text-[#e30613]" />
        </Link>
    );
};

const ExecutivePanel = ({ title, eyebrow, children, right }) => (
    <section className="overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
                <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#e30613]">{eyebrow}</div>
                <h2 className="mt-1 text-lg font-black text-slate-950">{title}</h2>
            </div>
            {right}
        </div>
        <div className="p-5">{children}</div>
    </section>
);

const AlertRow = ({ tone = 'amber', title, detail, icon = Icons.alert, action }) => {
    const classes = {
        amber: 'border-amber-200 bg-amber-50 text-amber-800',
        red: 'border-rose-200 bg-rose-50 text-rose-800',
        green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        blue: 'border-sky-200 bg-sky-50 text-sky-800',
    };

    return (
        <div className={`flex items-start gap-3 rounded-2xl border p-4 ${classes[tone] || classes.amber}`}>
            <Icon path={icon} className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="min-w-0 flex-1">
                <div className="text-sm font-black">{title}</div>
                <div className="mt-1 text-xs font-semibold opacity-75">{detail}</div>
            </div>
            {action}
        </div>
    );
};

const MonthSummaryBar = ({ label, value, max, tone = 'slate' }) => {
    const styles = toneStyles[tone] || toneStyles.slate;
    const width = Math.max(4, Math.min(100, max > 0 ? (Math.abs(value) / max) * 100 : 0));

    return (
        <div>
            <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{label}</span>
                <span className="font-mono text-sm font-black text-slate-950">{fmt(value)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full rounded-full ${styles.bar}`} style={{ width: `${width}%` }} />
            </div>
        </div>
    );
};

export default function HomeDashboard({
    configLoading,
    currentMonth,
    dayOfMonth,
    greeting,
    mesLabel,
    insight,
    totalIngresos,
    totalGastos,
    totalCompras,
    utilidad,
    facturasPendientes,
    totalPendiente,
    vencidas,
    allReminders,
    pendingReminders,
    doneCount,
    markAsDone,
    justCompleted,
    setShowSettings,
    profitMargin,
    operatingRatio,
    recentMovements,
    themeMode = 'dark',
    onThemeToggle,
}) {
    const totalEgresos = totalGastos + totalCompras;
    const maxMetric = Math.max(Math.abs(utilidad), totalIngresos, totalEgresos, totalPendiente, 1);
    const reminderProgress = allReminders.length > 0 ? (doneCount / allReminders.length) * 100 : 100;
    const monthProgress = Math.min(100, (dayOfMonth / 31) * 100);
    const statusTone = utilidad >= 0 ? 'green' : 'red';
    const statusText = utilidad >= 0 ? 'Resultado positivo' : 'Resultado en revision';
    const payablePressure = totalEgresos > 0 ? Math.min(100, (totalPendiente / totalEgresos) * 100) : (totalPendiente > 0 ? 100 : 0);

    const latestMovements = useMemo(() => recentMovements.slice(0, 5), [recentMovements]);

    const alerts = useMemo(() => {
        const rows = [];
        if (vencidas.length > 0) {
            rows.push({
                tone: 'red',
                title: `${vencidas.length} cuenta(s) por pagar vencida(s)`,
                detail: 'Requieren revision para evitar presion operativa.',
                icon: Icons.alert,
            });
        }
        if (pendingReminders.length > 0) {
            rows.push({
                tone: 'amber',
                title: `${pendingReminders.length} recordatorio(s) pendiente(s)`,
                detail: 'Hay tareas de cierre o control pendientes para este mes.',
                icon: Icons.alert,
            });
        }
        if (utilidad < 0 && totalIngresos > 0) {
            rows.push({
                tone: 'red',
                title: 'Utilidad negativa este mes',
                detail: 'Los egresos superan las ventas contables del periodo.',
                icon: Icons.trendingDown,
            });
        }
        if (rows.length === 0) {
            rows.push({
                tone: 'green',
                title: 'Operacion sin alertas criticas',
                detail: 'No hay vencimientos ni recordatorios urgentes detectados.',
                icon: Icons.check,
            });
        }
        return rows.slice(0, 3);
    }, [pendingReminders.length, totalIngresos, utilidad, vencidas.length]);

    return (
        <div className="space-y-5">
            <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950 text-white shadow-2xl shadow-slate-950/20">
                <div className="absolute inset-0 opacity-50" style={{ backgroundImage: 'radial-gradient(circle at 12% 10%, rgba(14,165,233,.34), transparent 23rem), radial-gradient(circle at 88% 2%, rgba(227,6,19,.26), transparent 21rem), linear-gradient(135deg, #020617 0%, #0f172a 54%, #260b12 100%)' }} />
                <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '30px 30px' }} />
                <div className="relative flex flex-col gap-5 p-5 md:p-6 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                        <div className="flex items-center gap-3">
                            <img src={APP_BRAND_LOGO} alt={APP_BRAND_NAME} className="h-12 w-12 rounded-2xl border border-white/12 bg-white object-contain p-1.5" />
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.38em] text-[#f5b51b]">{APP_BRAND_NAME}</div>
                                <h1 className="mt-0.5 text-2xl font-black tracking-tight md:text-4xl">Dashboard financiero</h1>
                            </div>
                        </div>
                        <p className="mt-4 max-w-3xl text-sm font-semibold leading-6 text-white/65">
                            {greeting}. {insight}
                        </p>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row lg:items-center">
                        <div className="rounded-[1.4rem] border border-white/10 bg-white/[0.07] px-4 py-3 backdrop-blur">
                            <div className="text-[10px] font-black uppercase tracking-[0.26em] text-white/40">Mes activo</div>
                            <div className="mt-1 text-sm font-black capitalize text-white">{mesLabel}</div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                                <div className="h-full rounded-full bg-[#f5b51b]" style={{ width: `${monthProgress}%` }} />
                            </div>
                        </div>
                        {onThemeToggle && (
                            <div className="inline-flex rounded-[1.2rem] border border-white/10 bg-white/[0.07] p-1 backdrop-blur">
                                <button
                                    type="button"
                                    onClick={themeMode === 'dark' ? undefined : onThemeToggle}
                                    className={`rounded-2xl px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] transition ${themeMode === 'dark' ? 'bg-white text-slate-950' : 'text-white/50 hover:text-white'}`}
                                >
                                    <Icon path={Icons.moon} className="inline h-3.5 w-3.5" /> Oscuro
                                </button>
                                <button
                                    type="button"
                                    onClick={themeMode === 'light' ? undefined : onThemeToggle}
                                    className={`rounded-2xl px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] transition ${themeMode === 'light' ? 'bg-white text-slate-950' : 'text-white/50 hover:text-white'}`}
                                >
                                    <Icon path={Icons.sun} className="inline h-3.5 w-3.5" /> Claro
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard
                    label="Utilidad neta del mes"
                    value={fmt(utilidad)}
                    detail={`${profitMargin.toFixed(1)}% margen sobre ventas`}
                    icon={utilidad >= 0 ? Icons.trendingUp : Icons.trendingDown}
                    tone={statusTone}
                    progress={(Math.abs(utilidad) / maxMetric) * 100}
                />
                <KpiCard
                    label="Ventas mensuales"
                    value={fmt(totalIngresos)}
                    detail="Base contable del periodo"
                    icon={Icons.receipt}
                    tone="green"
                    progress={(totalIngresos / maxMetric) * 100}
                />
                <KpiCard
                    label="Gastos totales"
                    value={fmt(totalEgresos)}
                    detail={`Compras ${fmt(totalCompras)} / gastos ${fmt(totalGastos)}`}
                    icon={Icons.trendingDown}
                    tone="red"
                    progress={(totalEgresos / maxMetric) * 100}
                />
                <KpiCard
                    label="Presion de pago"
                    value={fmt(totalPendiente)}
                    detail={`${facturasPendientes.length} facturas abiertas`}
                    icon={Icons.wallet}
                    tone={vencidas.length > 0 ? 'amber' : 'blue'}
                    progress={(totalPendiente / maxMetric) * 100}
                />
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.15fr_0.85fr]">
                <ExecutivePanel
                    title="Resumen del mes"
                    eyebrow="lectura ejecutiva"
                    right={<span className={`rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] ${utilidad >= 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>{statusText}</span>}
                >
                    <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
                        <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50/70 p-5">
                            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Resultado</div>
                            <div className="mt-2 font-mono text-4xl font-black tracking-tight text-slate-950">{fmt(utilidad)}</div>
                            <p className="mt-3 text-sm font-semibold leading-6 text-slate-500">
                                Ventas menos compras y gastos del mes. Este tablero usa los mismos datos actuales de la app.
                            </p>
                            <div className="mt-4 grid grid-cols-2 gap-3">
                                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Margen</div>
                                    <div className="mt-1 font-mono text-lg font-black text-slate-950">{profitMargin.toFixed(1)}%</div>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Egresos / ventas</div>
                                    <div className="mt-1 font-mono text-lg font-black text-slate-950">{operatingRatio.toFixed(1)}%</div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <MonthSummaryBar label="Ventas mensuales" value={totalIngresos} max={maxMetric} tone="green" />
                            <MonthSummaryBar label="Compras / costo" value={totalCompras} max={maxMetric} tone="amber" />
                            <MonthSummaryBar label="Gastos operativos" value={totalGastos} max={maxMetric} tone="red" />
                            <MonthSummaryBar label="Cuentas por pagar" value={totalPendiente} max={maxMetric} tone="blue" />
                        </div>
                    </div>
                </ExecutivePanel>

                <ExecutivePanel
                    title="Alertas importantes"
                    eyebrow="control"
                    right={<span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{currentMonth}</span>}
                >
                    <div className="space-y-3">
                        {alerts.map((alert) => (
                            <AlertRow key={`${alert.title}-${alert.tone}`} {...alert} />
                        ))}
                    </div>
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Recordatorios</div>
                                <div className="mt-1 text-sm font-black text-slate-950">{doneCount} / {allReminders.length} completados</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowSettings(true)}
                                className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:border-[#e30613] hover:text-[#e30613]"
                            >
                                <Icon path={Icons.gear} className="inline h-4 w-4" /> Ajustar
                            </button>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                            <div className="h-full rounded-full bg-[#f5b51b]" style={{ width: `${Math.max(5, Math.min(100, reminderProgress))}%` }} />
                        </div>
                        <div className="mt-3 space-y-2">
                            {configLoading ? (
                                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-400">Cargando recordatorios...</div>
                            ) : pendingReminders.length === 0 ? (
                                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">Sin tareas pendientes.</div>
                            ) : pendingReminders.slice(0, 3).map((item) => (
                                <div key={item.id} className={`flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 transition ${justCompleted === item.id ? 'opacity-45' : ''}`}>
                                    <button
                                        type="button"
                                        onClick={() => markAsDone(item.id)}
                                        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-300 transition hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-600"
                                        title="Marcar como completado"
                                    >
                                        <Icon path={Icons.check} className="h-3.5 w-3.5" />
                                    </button>
                                    <div className="min-w-0 flex-1 truncate text-xs font-black text-slate-700">{item.texto}</div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Dia {item.diaDelMes}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </ExecutivePanel>
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[0.85fr_1.15fr]">
                <ExecutivePanel title="Acciones rápidas" eyebrow="atajos">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <QuickAction to="/ingresar?tab=Ingresos" label="Registrar ingreso" detail="Venta o entrada manual" icon={Icons.trendingUp} tone="green" />
                        <QuickAction to="/ingresar?tab=Gastos" label="Registrar gasto" detail="Soporte fiscal" icon={Icons.trendingDown} tone="red" />
                        <QuickAction to="/ingresar?tab=Compras" label="Nueva compra" detail="Contado o credito" icon={Icons.cart} tone="amber" />
                        <QuickAction to="/reportes" label="Ver reportes" detail="Resultados y tributarios" icon={Icons.chart} tone="blue" />
                    </div>
                </ExecutivePanel>

                <ExecutivePanel
                    title="Actividad reciente"
                    eyebrow="ultimos movimientos"
                    right={<span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${payablePressure > 45 ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'}`}>Presion {payablePressure.toFixed(0)}%</span>}
                >
                    <div className="space-y-2">
                        {latestMovements.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-400">
                                Aun no hay movimientos recientes este mes.
                            </div>
                        ) : latestMovements.map((movement) => {
                            const tone = movement.accent === 'emerald' ? 'green' : movement.accent === 'amber' ? 'amber' : 'red';
                            const styles = toneStyles[tone] || toneStyles.slate;
                            return (
                                <div key={movement.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
                                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${styles.icon}`}>
                                        <Icon path={movement.accent === 'emerald' ? Icons.trendingUp : movement.accent === 'amber' ? Icons.cart : Icons.trendingDown} className="h-4 w-4" />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-black text-slate-950">{movement.title}</div>
                                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{movement.type} · {movement.date || 'sin fecha'}</div>
                                    </div>
                                    <div className="font-mono text-sm font-black text-slate-950">{fmt(movement.amount)}</div>
                                </div>
                            );
                        })}
                    </div>
                </ExecutivePanel>
            </div>
        </div>
    );
}
