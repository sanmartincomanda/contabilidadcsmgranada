// src/components/BalanceSheet.jsx
import React, { useMemo } from 'react';
import { fmt, peso } from '../constants';
import { sumIncomeForMonth } from '../services/incomeAggregation';

const StatCard = ({ title, total, children, accentColor }) => (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden transition-all hover:shadow-md">
        <div className={`h-1.5 w-full ${accentColor}`}></div>
        <div className="p-6">
            <div className="flex justify-between items-start mb-4">
                <h3 className="text-slate-500 uppercase tracking-wider text-xs font-bold">{title}</h3>
                <span className="text-2xl font-light text-slate-800">{fmt(total)}</span>
            </div>
            <div className="space-y-3 border-t border-slate-50 pt-4">
                {children}
            </div>
        </div>
    </div>
);

const Row = ({ label, value, isBold }) => (
    <div className={`flex justify-between text-sm ${isBold ? 'font-bold text-slate-800' : 'text-slate-600'}`}>
        <span>{label}</span>
        <span>{fmt(value)}</span>
    </div>
);

export default function BalanceSheet({ data }) {
    const totales = useMemo(() => {
        // 1. Definir Mes Pasado (Sincronizado con Estado de Resultados)
        const ahora = new Date();
        const mesPasado = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
        const mesPasadoStr = mesPasado.toISOString().substring(0, 7); 

        // 2. Extraer Colecciones
        const facturasPagar = data?.cuentas_por_pagar || [];
        const facturasCobrar = data?.cuentasPorCobrar || [];
        const aportesPatrimonio = data?.patrimonio || [];
        const inventarios = data?.inventarios || [];
        const ingresos = data?.ingresos || [];
        const compras = data?.compras || [];
        const gastos = data?.gastos || [];
        const mirroredFacturaIds = new Set(
            compras
                .map((compra) => compra.sourceFacturaId || compra.linkedPayableId || (compra.id?.startsWith('credito_') ? compra.id.replace('credito_', '') : ''))
                .filter(Boolean)
        );

        // --- LÓGICA DEL ESTADO DE RESULTADOS (Idéntica a tu reporte) ---
        
        // A. Ingresos Totales del mes pasado
        const ingresosMes = sumIncomeForMonth(ingresos, mesPasadoStr);

        // B. Cálculo del Costo de Venta Real (Inventario Inicial + Compras - Inv Final)
        const invDelMes = inventarios.filter(i => i.month === mesPasadoStr);
        const invInicial = invDelMes
            .filter(i => i.type === 'inicial')
            .reduce((acc, i) => acc + (peso(i.amount) || 0), 0);
        const invFinal = invDelMes
            .filter(i => i.type === 'final')
            .reduce((acc, i) => acc + (peso(i.amount) || 0), 0);
        
        const comprasMes = compras
            .filter(c => c.month === mesPasadoStr || (c.date && c.date.startsWith(mesPasadoStr)))
            .reduce((acc, c) => acc + (peso(c.amount) || 0), 0);

        const comprasCreditoMes = facturasPagar
            .filter(f => !f.id || !mirroredFacturaIds.has(f.id))
            .filter(f => (f.month && f.month === mesPasadoStr) || (f.fecha && f.fecha.startsWith(mesPasadoStr)))
            .reduce((acc, f) => acc + (peso(f.monto) || 0), 0);

        const costoDeVenta = peso(invInicial) + comprasMes + comprasCreditoMes - peso(invFinal);

        // C. Gastos Operacionales
        const gastosMes = gastos
            .filter(g => g.date && g.date.startsWith(mesPasadoStr))
            .reduce((acc, g) => acc + (peso(g.amount) || 0), 0);

        // D. Utilidad Neta (El dato que cuadra el balance)
        const utilidadBruta = ingresosMes - costoDeVenta;
        const utilidadNeta = utilidadBruta - gastosMes;

        // --- CÁLCULOS DEL BALANCE (Lado Activo y Pasivo) ---
        
        // Pasivos: Saldo total por pagar de facturas
        const totalPasivos = facturasPagar.reduce((acc, f) => acc + (parseFloat(f.saldo) || 0), 0);
        
        // Activos: Cuentas por Cobrar + Inventario Final (del mes actual o último registrado)
        const totalCobrar = facturasCobrar.reduce((acc, c) => acc + (peso(c.amount) || 0), 0);
        const ultimoInvFinalRegistrado = inventarios
            .filter(i => i.type === 'final')
            .sort((a, b) => b.month.localeCompare(a.month))[0]?.amount || 0;
        
        const totalActivos = peso(ultimoInvFinalRegistrado) + totalCobrar;

        // Patrimonio: Capital + Utilidad Neta
        const capitalBase = aportesPatrimonio.reduce((acc, e) => acc + (peso(e.amount) || 0), 0);
        const totalPatrimonio = capitalBase + utilidadNeta;

        return {
            totalActivos,
            totalPasivos,
            totalPatrimonio,
            invFinal: peso(ultimoInvFinalRegistrado),
            totalCobrar,
            capitalBase,
            utilidadNeta,
            nombreMes: mesPasado.toLocaleDateString('es-ES', { month: 'long' }).toUpperCase(),
            descuadre: totalActivos - (totalPasivos + totalPatrimonio)
        };
    }, [data]);

    return (
        <div className="max-w-7xl mx-auto p-6 bg-slate-50 min-h-screen">
            {/* Encabezado Corporativo */}
            <div className="mb-8 border-b border-slate-200 pb-6 flex justify-between items-end">
                <div>
                    <h1 className="text-3xl font-serif text-slate-900 italic">Balance General</h1>
                    <p className="text-slate-500 text-sm mt-1">Estado de Situación Financiera Consolidado</p>
                </div>
                <div className="text-right">
                    <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Utilidad Basada en Resultado Operacional</p>
                    <p className="text-slate-700 font-bold">{totales.nombreMes}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-10">
                {/* ACTIVOS */}
                <StatCard title="Activos" total={totales.totalActivos} accentColor="bg-blue-600">
                    <Row label="Inventario de Mercancía" value={totales.invFinal} />
                    <Row label="Cuentas por Cobrar" value={totales.totalCobrar} />
                    <div className="pt-2 mt-2 border-t border-slate-100 italic">
                        <Row label="Total Activos" value={totales.totalActivos} isBold />
                    </div>
                </StatCard>

                {/* PASIVOS */}
                <StatCard title="Pasivos" total={totales.totalPasivos} accentColor="bg-slate-800">
                    <Row label="Cuentas por Pagar Proveedores" value={totales.totalPasivos} />
                    <div className="pt-2 mt-2 border-t border-slate-100 italic">
                        <Row label="Total Pasivos" value={totales.totalPasivos} isBold />
                    </div>
                </StatCard>

                {/* PATRIMONIO */}
                <StatCard title="Patrimonio" total={totales.totalPatrimonio} accentColor="bg-emerald-600">
                    <Row label="Capital Social" value={totales.capitalBase} />
                    <Row label={`Utilidad Neta (${totales.nombreMes})`} value={totales.utilidadNeta} />
                    <div className="pt-2 mt-2 border-t border-slate-100 italic">
                        <Row label="Total Patrimonio" value={totales.totalPatrimonio} isBold />
                    </div>
                </StatCard>
            </div>

            {/* Certificación de Cuadre */}
            <div className={`rounded-xl p-6 flex items-center justify-between border ${
                Math.abs(totales.descuadre) < 1 
                ? 'bg-white border-emerald-200 text-emerald-800 shadow-sm' 
                : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}>
                <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl ${
                        Math.abs(totales.descuadre) < 1 ? 'bg-emerald-100' : 'bg-amber-100'
                    }`}>
                        {Math.abs(totales.descuadre) < 1 ? '🏛️' : '⚖️'}
                    </div>
                    <div>
                        <p className="text-xs uppercase font-black tracking-widest opacity-70">Certificación Contable</p>
                        <p className="text-lg font-bold">
                            {Math.abs(totales.descuadre) < 1 
                                ? 'Activos totalmente respaldados por Pasivos y Patrimonio' 
                                : `Diferencia detectada en balance: ${fmt(totales.descuadre)}`}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
