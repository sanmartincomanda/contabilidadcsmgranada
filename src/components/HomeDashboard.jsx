import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import ExecutiveFlowDiagram from './ExecutiveFlowDiagram';
import { APP_BRAND_LOGO, APP_BRAND_NAME, fmt } from '../constants';

const Icons = {
    chart: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    plus: 'M12 4v16m8-8H4',
    wallet: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
    alert: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
    check: 'M5 13l4 4L19 7',
    bell: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
    clock: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    arrow: 'M13 7l5 5m0 0l-5 5m5-5H6',
    trendingUp: 'M13 7h8m0 0v8m0-8l-8-8-4 4-6-6',
    trendingDown: 'M13 17h8m0 0V9m0 8l-8-8-4 4-6-6',
    cart: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z',
    gear: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
};

const Icon = ({ path, className = 'h-5 w-5' }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
);

const Panel = ({ title, eyebrow, children, right, className = '' }) => (
    <section className={`overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-xl shadow-slate-900/5 ${className}`}>
        {(title || eyebrow || right) && (
            <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    {eyebrow && <div className="text-[10px] font-black uppercase tracking-[0.35em] text-slate-400">{eyebrow}</div>}
                    {title && <h3 className="mt-1 text-lg font-black text-slate-900">{title}</h3>}
                </div>
                {right}
            </div>
        )}
        {children}
    </section>
);

const MetricTile = ({ label, value, subtitle, icon, tone = 'slate', progress = 0 }) => {
    const tones = {
        emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        rose: 'bg-rose-50 text-rose-700 border-rose-200',
        amber: 'bg-amber-50 text-amber-700 border-amber-200',
        sky: 'bg-sky-50 text-sky-700 border-sky-200',
        slate: 'bg-slate-50 text-slate-700 border-slate-200',
    };

    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${tones[tone]}`}>
                    <Icon path={icon} className="h-5 w-5" />
                </div>
                <div className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-slate-500">
                    {Math.max(0, Math.min(100, progress)).toFixed(0)}%
                </div>
            </div>
            <div className="mt-4 font-mono text-2xl font-black tracking-tight text-slate-900">{value}</div>
            <div className="mt-1 text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{label}</div>
            {subtitle && <div className="mt-1 text-xs font-semibold text-slate-500">{subtitle}</div>}
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full rounded-full ${tone === 'emerald' ? 'bg-emerald-500' : tone === 'rose' ? 'bg-rose-500' : tone === 'amber' ? 'bg-amber-500' : tone === 'sky' ? 'bg-sky-500' : 'bg-slate-500'}`} style={{ width: `${Math.max(4, Math.min(100, progress))}%` }} />
            </div>
        </div>
    );
};

const QuickAction = ({ to, label, subtitle, icon, tone = 'slate' }) => {
    const tones = {
        emerald: 'from-emerald-500 to-emerald-700',
        rose: 'from-rose-500 to-rose-700',
        amber: 'from-amber-400 to-orange-600',
        sky: 'from-sky-500 to-blue-700',
        slate: 'from-slate-800 to-slate-950',
    };

    return (
        <Link to={to} className="motion-button group rounded-2xl border border-white/10 bg-white/8 p-4 text-white transition hover:bg-white/14">
            <div className="flex items-center justify-between gap-3">
                <div className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br ${tones[tone]} shadow-lg`}>
                    <Icon path={icon} className="h-5 w-5" />
                </div>
                <Icon path={Icons.arrow} className="h-4 w-4 text-white/45 transition group-hover:translate-x-1 group-hover:text-white" />
            </div>
            <div className="mt-4 text-sm font-black">{label}</div>
            <div className="mt-1 text-xs font-semibold text-white/52">{subtitle}</div>
        </Link>
    );
};

const DailyActivityChart = ({ dailyActivity, maxDailyActivity, dayOfMonth }) => (
    <div className="p-5">
        <div className="flex h-64 items-end gap-1 rounded-3xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white px-3 py-4">
            {dailyActivity.map((day) => {
                const inflowHeight = Math.max(3, (day.income / maxDailyActivity) * 100);
                const outflowHeight = Math.max(3, ((day.expense + day.purchase) / maxDailyActivity) * 100);
                const isToday = day.day === dayOfMonth;
                return (
                    <div key={day.day} className="group flex flex-1 flex-col items-center justify-end gap-1">
                        <div className="relative flex h-52 w-full items-end justify-center gap-0.5">
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
);

const ExpenseStructure = ({ rows }) => {
    const max = Math.max(1, ...rows.map((row) => row.amount));

    return (
        <div className="space-y-3 p-5">
            {rows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-400">Sin estructura de egresos este mes.</div>
            ) : rows.map((row) => (
                <div key={row.label} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="truncate text-sm font-black text-slate-800">{row.label}</div>
                        <div className="font-mono text-sm font-black text-[#9f111a]">{fmt(row.amount)}</div>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div className={`h-full rounded-full ${row.tone === 'purchase' ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${Math.max(6, (row.amount / max) * 100)}%` }} />
                    </div>
                </div>
            ))}
        </div>
    );
};

const RiskGauge = ({ value, label, subtitle, danger = false }) => {
    const safeValue = Math.max(0, Math.min(100, value));
    return (
        <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-4">
                <div
                    className="grid h-24 w-24 place-items-center rounded-full"
                    style={{ background: `conic-gradient(${danger ? '#e11d48' : '#16a34a'} ${safeValue * 3.6}deg, #e2e8f0 0deg)` }}
                >
                    <div className="grid h-16 w-16 place-items-center rounded-full bg-white">
                        <span className={`font-mono text-xl font-black ${danger ? 'text-rose-700' : 'text-emerald-700'}`}>{safeValue.toFixed(0)}%</span>
                    </div>
                </div>
                <div>
                    <div className="text-sm font-black text-slate-900">{label}</div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">{subtitle}</div>
                </div>
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
    dailyActivity,
    maxDailyActivity,
    profitMargin,
    operatingRatio,
    recentMovements,
    mesGastos = [],
    mesCompras = [],
    themeMode = 'dark',
    onThemeToggle,
}) {
    const totalOutflow = totalGastos + totalCompras;
    const utilidadBruta = totalIngresos - totalCompras;
    const utilidadOperativa = utilidadBruta - totalGastos;
    const impuestoMunicipalEstimado = totalIngresos > 0 ? totalIngresos * 0.01 : 0;
    const baseIrEstimada = utilidadOperativa - impuestoMunicipalEstimado;
    const impuestoIrEstimado = baseIrEstimada > 0 ? baseIrEstimada * 0.30 : 0;
    const impuestosEstimados = impuestoMunicipalEstimado + impuestoIrEstimado;
    const utilidadNetaEstimada = utilidadOperativa - impuestosEstimados;
    const maxMetric = Math.max(totalIngresos, totalGastos, totalCompras, totalPendiente, Math.abs(utilidad), 1);
    const reminderProgress = allReminders.length > 0 ? (doneCount / allReminders.length) * 100 : 100;
    const payableRisk = totalOutflow > 0 ? Math.min(100, (totalPendiente / totalOutflow) * 100) : (totalPendiente > 0 ? 100 : 0);
    const monthProgress = Math.min(100, (dayOfMonth / 31) * 100);

    const expenseRows = useMemo(() => {
        const groups = new Map();
        mesGastos.forEach((item) => {
            const key = item.category || item.description || 'Gastos operativos';
            groups.set(key, { label: key, amount: (groups.get(key)?.amount || 0) + (Number(item.subtotal ?? item.amount ?? item.total) || 0), tone: 'expense' });
        });
        const purchaseTotal = mesCompras.reduce((sum, item) => sum + (Number(item.subtotal ?? item.amount ?? item.total) || 0), 0);
        if (purchaseTotal > 0) groups.set('Compras / costo de venta', { label: 'Compras / costo de venta', amount: purchaseTotal, tone: 'purchase' });
        return [...groups.values()].sort((a, b) => b.amount - a.amount).slice(0, 5);
    }, [mesCompras, mesGastos]);

    const statusTone = utilidad >= 0 ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-rose-100 text-rose-700 border-rose-200';

    return (
        <div className="space-y-6">
            <section className="relative overflow-hidden rounded-[2rem] bg-slate-950 text-white shadow-2xl shadow-slate-950/20">
                <div className="absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(circle at 15% 20%, rgba(14,165,233,.55), transparent 22rem), radial-gradient(circle at 82% 16%, rgba(242,182,53,.25), transparent 18rem), linear-gradient(135deg, #020617 0%, #1e293b 58%, #3b1114 100%)' }} />
                <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '34px 34px' }} />
                <div className="relative grid gap-6 p-5 md:p-7 xl:grid-cols-[1.15fr_0.85fr]">
                    <div>
                        <div className="flex flex-wrap items-center gap-3">
                            <img src={APP_BRAND_LOGO} alt={APP_BRAND_NAME} className="h-14 w-14 rounded-2xl border border-white/12 bg-white object-contain p-1.5" />
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.38em] text-[#f5b51b]">{APP_BRAND_NAME}</div>
                                <h1 className="mt-1 text-3xl font-black tracking-tight md:text-5xl">Command Center</h1>
                            </div>
                        </div>
                        <p className="mt-5 max-w-3xl text-sm font-semibold leading-6 text-white/65 md:text-base">{greeting}. {insight}</p>
                        <div className="mt-5 flex flex-wrap gap-2">
                            <span className={`rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-wider ${statusTone}`}>{utilidad >= 0 ? 'Operacion rentable' : 'Margen bajo presion'}</span>
                            <span className="rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-white/70">{mesLabel}</span>
                            <span className="rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-white/70">Cierre {monthProgress.toFixed(0)}%</span>
                        </div>
                        {onThemeToggle && (
                            <div className="mt-5 inline-flex rounded-full border border-white/12 bg-white/8 p-1 shadow-lg shadow-black/10 backdrop-blur">
                                <button
                                    type="button"
                                    onClick={themeMode === 'dark' ? undefined : onThemeToggle}
                                    className={`rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-[0.22em] transition ${
                                        themeMode === 'dark'
                                            ? 'bg-white text-slate-950 shadow-sm'
                                            : 'text-white/60 hover:text-white'
                                    }`}
                                    aria-pressed={themeMode === 'dark'}
                                >
                                    Oscuro
                                </button>
                                <button
                                    type="button"
                                    onClick={themeMode === 'light' ? undefined : onThemeToggle}
                                    className={`rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-[0.22em] transition ${
                                        themeMode === 'light'
                                            ? 'bg-white text-slate-950 shadow-sm'
                                            : 'text-white/60 hover:text-white'
                                    }`}
                                    aria-pressed={themeMode === 'light'}
                                >
                                    Claro
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <QuickAction to="/ingresar?tab=Ingresos" label="Registrar venta" subtitle="Ingreso manual o SICAR" icon={Icons.trendingUp} tone="emerald" />
                        <QuickAction to="/ingresar?tab=Gastos" label="Registrar gasto" subtitle="Soporte fiscal" icon={Icons.trendingDown} tone="rose" />
                        <QuickAction to="/ingresar?tab=Compras" label="Nueva compra" subtitle="Contado o credito" icon={Icons.cart} tone="amber" />
                        <QuickAction to="/reportes" label="Reportes" subtitle="Estado y tributarios" icon={Icons.chart} tone="sky" />
                    </div>
                </div>
            </section>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricTile label="Ventas subtotal" value={fmt(totalIngresos)} subtitle={`${profitMargin.toFixed(1)}% margen neto`} icon={Icons.trendingUp} tone="emerald" progress={(totalIngresos / maxMetric) * 100} />
                <MetricTile label="Compras costo" value={fmt(totalCompras)} subtitle={`${operatingRatio.toFixed(1)}% egreso vs ventas`} icon={Icons.cart} tone="amber" progress={(totalCompras / maxMetric) * 100} />
                <MetricTile label="Gastos operativos" value={fmt(totalGastos)} subtitle="Operacion del mes" icon={Icons.trendingDown} tone="rose" progress={(totalGastos / maxMetric) * 100} />
                <MetricTile label="Cuentas por pagar" value={fmt(totalPendiente)} subtitle={`${facturasPendientes.length} facturas abiertas`} icon={Icons.wallet} tone="sky" progress={(totalPendiente / maxMetric) * 100} />
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.65fr_0.75fr]">
                <ExecutiveFlowDiagram
                    eyebrow="Enterprise income flow"
                    title="Estado de resultado ejecutivo"
                    subtitle="Ingresos brutos, costos, gastos operativos, impuestos y utilidad neta"
                    period={currentMonth}
                    source={{ label: 'Ingresos bruto', value: totalIngresos, subtitle: 'Ventas base sin IVA' }}
                    stages={[
                        {
                            id: 'gross-profit',
                            up: { label: 'Costos', value: totalCompras, subtitle: 'Compras / costo fiscal', tone: 'cost' },
                            down: { label: 'Utilidad bruta', value: utilidadBruta, subtitle: 'ingresos - costos', tone: utilidadBruta >= 0 ? 'gross' : 'danger' },
                        },
                        {
                            id: 'operating-profit',
                            up: { label: 'Gastos operativos', value: totalGastos, subtitle: 'operacion del mes', tone: 'expense' },
                            down: { label: 'Utilidades operativas', value: utilidadOperativa, subtitle: 'utilidad bruta - gastos', tone: utilidadOperativa >= 0 ? 'operating' : 'danger' },
                        },
                        {
                            id: 'net-profit',
                            up: {
                                label: 'Impuestos',
                                value: impuestosEstimados,
                                subtitle: 'IMI 1% + IR 30%',
                                tone: 'tax',
                                lines: [
                                    { label: 'IMI', value: impuestoMunicipalEstimado },
                                    { label: 'IR', value: impuestoIrEstimado },
                                ],
                            },
                            down: { label: 'Utilidad neta', value: utilidadNetaEstimada, subtitle: 'resultado final estimado', tone: utilidadNetaEstimada >= 0 ? 'profit' : 'danger' },
                        },
                    ]}
                />

                <div className="space-y-5">
                    <RiskGauge value={Math.abs(profitMargin)} label="Margen de utilidad" subtitle={`${profitMargin.toFixed(1)}% sobre ventas subtotal`} danger={profitMargin < 0} />
                    <RiskGauge value={payableRisk} label="Presion de pago" subtitle={`${vencidas.length} vencidas / ${facturasPendientes.length} pendientes`} danger={vencidas.length > 0 || payableRisk > 45} />
                    <button onClick={() => setShowSettings(true)} className="motion-button flex w-full items-center justify-between rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-xl shadow-slate-900/5">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Gobierno operativo</div>
                            <div className="mt-1 text-sm font-black text-slate-900">Configurar recordatorios</div>
                        </div>
                        <Icon path={Icons.gear} className="h-5 w-5 text-[#e30613]" />
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_0.8fr]">
                <Panel title="Actividad diaria" eyebrow="Operational telemetry" right={<span className="rounded-full bg-[#fff4df] px-3 py-1 text-[11px] font-black uppercase tracking-wider text-[#8a5a11]">{currentMonth}</span>}>
                    <DailyActivityChart dailyActivity={dailyActivity} maxDailyActivity={maxDailyActivity} dayOfMonth={dayOfMonth} />
                </Panel>
                <Panel title="Estructura de egresos" eyebrow="Cost intelligence">
                    <ExpenseStructure rows={expenseRows} />
                </Panel>
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
                <Panel
                    title="Recordatorios"
                    eyebrow="Compliance"
                    right={<span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-slate-500">{reminderProgress.toFixed(0)}%</span>}
                >
                    <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
                        {configLoading ? (
                            <div className="py-8 text-center text-xs font-semibold text-slate-400">Cargando...</div>
                        ) : allReminders.length === 0 ? (
                            <div className="py-8 text-center text-xs font-semibold text-slate-400">No hay recordatorios activos.</div>
                        ) : pendingReminders.length === 0 ? (
                            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
                                <Icon path={Icons.check} className="mx-auto h-8 w-8 text-emerald-600" />
                                <div className="mt-2 text-sm font-black text-emerald-700">Todo completado</div>
                            </div>
                        ) : pendingReminders.map((item) => (
                            <div key={item.id} className={`flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-3 py-3 ${justCompleted === item.id ? 'opacity-50' : ''}`}>
                                <button onClick={() => markAsDone(item.id)} className="grid h-8 w-8 place-items-center rounded-xl border-2 border-slate-200 text-slate-300 hover:border-[#e30613] hover:text-[#e30613]">
                                    <Icon path={Icons.check} className="h-4 w-4" />
                                </button>
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-black text-slate-800">{item.texto}</div>
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Dia {item.diaDelMes}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </Panel>

                <Panel title="Cuentas por pagar" eyebrow="AP risk monitor" right={<span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wider ${vencidas.length ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>{vencidas.length ? 'Riesgo' : 'Controlado'}</span>}>
                    <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
                        {facturasPendientes.length === 0 ? (
                            <div className="py-8 text-center text-xs font-semibold text-slate-400">Sin cuentas pendientes.</div>
                        ) : facturasPendientes.slice(0, 7).map((item) => {
                            const isExpired = item.vencimiento && item.vencimiento < new Date().toISOString().substring(0, 10);
                            return (
                                <div key={item.id} className={`rounded-2xl border px-3 py-3 ${isExpired ? 'border-rose-200 bg-rose-50' : 'border-slate-100 bg-white'}`}>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-black text-slate-800">{item.proveedor || item.supplier || 'Sin proveedor'}</div>
                                            <div className={`text-[10px] font-bold uppercase tracking-wider ${isExpired ? 'text-rose-600' : 'text-slate-400'}`}>{item.vencimiento ? `Vence ${item.vencimiento}` : 'Sin vencimiento'}</div>
                                        </div>
                                        <div className="font-mono text-xs font-black text-[#9f111a]">{fmt(Number(item.saldo) || 0)}</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </Panel>

                <Panel title="Bitacora ejecutiva" eyebrow="Recent activity">
                    <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
                        {recentMovements.length === 0 ? (
                            <div className="py-8 text-center text-xs font-semibold text-slate-400">Aun no hay movimientos recientes.</div>
                        ) : recentMovements.map((movement) => {
                            const accent = movement.accent === 'emerald'
                                ? 'bg-emerald-100 text-emerald-700'
                                : movement.accent === 'amber'
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-rose-100 text-rose-700';
                            return (
                                <div key={movement.id} className="rounded-2xl border border-slate-100 bg-white px-3.5 py-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${accent}`}>{movement.type}</span>
                                            <div className="mt-1 truncate text-sm font-black text-slate-800">{movement.title}</div>
                                            <div className="text-[10px] font-semibold text-slate-400">{movement.date || 'Sin fecha'}</div>
                                        </div>
                                        <div className="font-mono text-xs font-black text-[#9f111a]">{fmt(movement.amount)}</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </Panel>
            </div>
        </div>
    );
}
