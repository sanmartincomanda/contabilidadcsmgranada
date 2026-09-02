import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { fmt, getRecordBranchId } from '../constants';

const normalizeText = (value = '') => String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

const formatTime = (value = '') => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).substring(11, 16) || '-';
    return date.toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' });
};

const sum = (items = [], selector = () => 0) => items.reduce((total, item) => total + Number(selector(item) || 0), 0);

const DetailRow = ({ label, value, tone = 'text-slate-900' }) => (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</div>
        <div className={`mt-1 font-mono text-sm font-black ${tone}`}>{value}</div>
    </div>
);

export default function SicarTicketSalesPanel({ date, branchId }) {
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [selectedTicket, setSelectedTicket] = useState(null);

    useEffect(() => {
        if (!date) return undefined;
        setLoading(true);
        setError('');

        const ticketQuery = query(
            collection(db, 'sicar_ventas_tickets'),
            where('date', '==', date)
        );
        const unsubscribe = onSnapshot(ticketQuery, (snapshot) => {
            const rows = snapshot.docs
                .map((ticketDoc) => ({ id: ticketDoc.id, ...ticketDoc.data() }))
                .filter((ticket) => !branchId || getRecordBranchId(ticket) === branchId)
                .sort((a, b) => Number(b.saleId || 0) - Number(a.saleId || 0));
            setTickets(rows);
            setLoading(false);
        }, (snapshotError) => {
            console.error('No se pudieron cargar los tickets SICAR', snapshotError);
            setError(snapshotError.message || 'No se pudieron cargar los tickets SICAR.');
            setLoading(false);
        });

        return unsubscribe;
    }, [branchId, date]);

    const visibleTickets = useMemo(() => {
        const normalizedSearch = normalizeText(search);
        if (!normalizedSearch) return tickets;
        return tickets.filter((ticket) => normalizeText([
            ticket.ticketCode,
            ticket.ticketNumber,
            ticket.saleId,
            ticket.customerName,
            ticket.cashboxName,
            ...(ticket.items || []).map((item) => `${item.code} ${item.description}`),
        ].join(' ')).includes(normalizedSearch));
    }, [search, tickets]);

    const activeTickets = useMemo(() => tickets.filter((ticket) => !ticket.isCancelled && ticket.status !== 'cancelled'), [tickets]);
    const totals = useMemo(() => ({
        subtotal: sum(activeTickets, (ticket) => ticket.subtotal),
        iva: sum(activeTickets, (ticket) => ticket.iva),
        total: sum(activeTickets, (ticket) => ticket.total),
        items: sum(activeTickets, (ticket) => ticket.itemCount || ticket.items?.length),
    }), [activeTickets]);

    return (
        <section className="overflow-hidden rounded-3xl border border-sky-200 bg-white shadow-sm">
            <div className="border-b border-sky-100 bg-gradient-to-r from-sky-50 via-white to-emerald-50 px-4 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <div className="text-[9px] font-black uppercase tracking-[0.28em] text-sky-700">Integracion automatica SICAR</div>
                        <h4 className="mt-1 text-base font-black text-slate-950">Ventas por ticket</h4>
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                            El agente local revisa cada 10 segundos. Carnes Amparito queda excluido.
                        </p>
                    </div>
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">
                        {loading ? 'Actualizando...' : `${activeTickets.length} tickets activos`}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2 p-4 lg:grid-cols-4">
                <DetailRow label="Subtotal" value={fmt(totals.subtotal)} tone="text-slate-950" />
                <DetailRow label="IVA" value={fmt(totals.iva)} tone="text-sky-700" />
                <DetailRow label="Total" value={fmt(totals.total)} tone="text-emerald-700" />
                <DetailRow label="Articulos" value={totals.items.toLocaleString('es-NI')} tone="text-amber-700" />
            </div>

            <div className="px-4 pb-3">
                <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                    placeholder="Buscar ticket, cliente, caja o articulo..."
                />
            </div>

            {error ? (
                <div className="mx-4 mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div>
            ) : loading ? (
                <div className="p-8 text-center text-sm font-bold text-slate-400">Cargando ventas del {date}...</div>
            ) : visibleTickets.length === 0 ? (
                <div className="p-8 text-center">
                    <div className="text-sm font-black text-slate-700">Todavia no hay tickets para esta fecha.</div>
                    <div className="mt-1 text-xs font-semibold text-slate-400">Cuando SICAR registre una venta, aparecera automaticamente.</div>
                </div>
            ) : (
                <div className="max-h-[34rem] divide-y divide-slate-100 overflow-y-auto">
                    {visibleTickets.map((ticket) => {
                        const cancelled = ticket.isCancelled || ticket.status === 'cancelled';
                        return (
                            <button
                                key={ticket.id}
                                type="button"
                                onClick={() => setSelectedTicket(ticket)}
                                className="grid w-full gap-2 px-4 py-3 text-left transition hover:bg-sky-50/60 sm:grid-cols-[120px_1fr_120px_140px] sm:items-center"
                            >
                                <div>
                                    <div className="font-mono text-sm font-black text-slate-950">{ticket.ticketCode || `V-${ticket.saleId}`}</div>
                                    <div className="mt-0.5 text-[10px] font-black uppercase tracking-wider text-slate-400">{formatTime(ticket.saleDateTime)}</div>
                                </div>
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-black text-slate-800">{ticket.customerName || 'PUBLICO EN GENERAL'}</div>
                                    <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                        {ticket.cashboxName || 'SIN CAJA'} · {ticket.itemCount || ticket.items?.length || 0} articulo(s)
                                    </div>
                                </div>
                                <div className={`w-fit rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${cancelled ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                    {cancelled ? 'Anulado' : ticket.saleType || 'Ticket'}
                                </div>
                                <div className={`font-mono text-base font-black sm:text-right ${cancelled ? 'text-rose-600 line-through' : 'text-emerald-700'}`}>{fmt(ticket.total)}</div>
                            </button>
                        );
                    })}
                </div>
            )}

            {selectedTicket && (
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm" onMouseDown={() => setSelectedTicket(null)}>
                    <div className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-[2rem] border border-slate-200 bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
                        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-950 px-5 py-4 text-white">
                            <div>
                                <div className="text-[9px] font-black uppercase tracking-[0.28em] text-sky-300">Detalle de venta SICAR</div>
                                <h3 className="mt-1 text-2xl font-black">{selectedTicket.ticketCode || `V-${selectedTicket.saleId}`}</h3>
                                <div className="mt-1 text-xs font-semibold text-white/65">{selectedTicket.date} · {formatTime(selectedTicket.saleDateTime)} · {selectedTicket.cashboxName || 'Sin caja'}</div>
                            </div>
                            <button type="button" onClick={() => setSelectedTicket(null)} className="grid h-10 w-10 place-items-center rounded-2xl border border-white/15 bg-white/10 text-xl font-black transition hover:bg-white/20" aria-label="Cerrar detalle">×</button>
                        </div>

                        <div className="space-y-4 p-5">
                            <div>
                                <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-950">{selectedTicket.customerName || 'PUBLICO EN GENERAL'}</div>
                                <div className="mt-1 text-xs font-semibold text-slate-500">RUC: {selectedTicket.customerRfc || '-'} · Tipo: {selectedTicket.saleType || 'ticket'}</div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                                <DetailRow label="Subtotal" value={fmt(selectedTicket.subtotal)} />
                                <DetailRow label="Exento" value={fmt(selectedTicket.subtotalExento)} />
                                <DetailRow label="IVA" value={fmt(selectedTicket.iva)} tone="text-sky-700" />
                                <DetailRow label="Total" value={fmt(selectedTicket.total)} tone="text-emerald-700" />
                            </div>

                            <div className="rounded-3xl border border-slate-200">
                                <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Metodos de pago</div>
                                <div className="divide-y divide-slate-100">
                                    {(selectedTicket.paymentBreakdown || []).map((payment, index) => (
                                        <div key={`${payment.method}-${index}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                                            <span className="font-black text-slate-700">{payment.method}</span>
                                            <span className="font-mono font-black text-slate-950">{fmt(payment.amount)}</span>
                                        </div>
                                    ))}
                                    {!(selectedTicket.paymentBreakdown || []).length && <div className="px-4 py-4 text-sm font-semibold text-slate-400">Sin metodo registrado.</div>}
                                </div>
                            </div>

                            <div className="overflow-x-auto rounded-3xl border border-slate-200">
                                <table className="min-w-[760px] w-full text-left text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-200 bg-slate-50 text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">
                                            <th className="px-4 py-3">Codigo</th>
                                            <th className="px-4 py-3">Articulo</th>
                                            <th className="px-4 py-3 text-right">Cantidad</th>
                                            <th className="px-4 py-3 text-right">Precio</th>
                                            <th className="px-4 py-3 text-right">Total</th>
                                            <th className="px-4 py-3 text-right">Costo</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(selectedTicket.items || []).map((item, index) => (
                                            <tr key={`${item.articleId || item.code}-${item.order}-${index}`} className="border-b border-slate-100 last:border-b-0">
                                                <td className="px-4 py-3 font-mono text-xs font-bold text-slate-500">{item.code || '-'}</td>
                                                <td className="px-4 py-3 font-black text-slate-800">{item.description || '-'}</td>
                                                <td className="px-4 py-3 text-right font-mono font-bold">{Number(item.quantity || 0).toLocaleString('es-NI', { maximumFractionDigits: 3 })}</td>
                                                <td className="px-4 py-3 text-right font-mono font-bold">{fmt(item.unitPriceWithTax)}</td>
                                                <td className="px-4 py-3 text-right font-mono font-black text-emerald-700">{fmt(item.totalWithTax)}</td>
                                                <td className="px-4 py-3 text-right font-mono font-bold text-amber-700">{fmt(item.purchaseTotal)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {!(selectedTicket.items || []).length && <div className="p-6 text-center text-sm font-semibold text-slate-400">Este registro no tiene articulos en SICAR.</div>}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
