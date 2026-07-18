import React, { useMemo, useState } from 'react';
import { addDoc, collection, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import {
    APP_BRAND_NAME,
    BRANCHES,
    DEFAULT_BRANCH_ID,
    fmt,
    getBranchById,
    getBranchPayload,
    getRecordBranchId,
} from '../constants';
import { useAuth } from '../context/AuthContext';
import { DEFAULT_PURCHASE_CATEGORY_ID, EXPENSE_CATEGORY_OPTIONS } from '../services/expenseCategories';

const TRANSFER_COLLECTION = 'traspasos_costos_sucursal';
const COST_CATEGORY = 'Costos de venta / compras';

const Icons = {
    arrow: 'M17 8l4 4m0 0l-4 4m4-4H3',
    swap: 'M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4',
    eye: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
    plus: 'M12 4v16m8-8H4',
    search: 'M21 21l-4.35-4.35m1.35-5.65a7 7 0 11-14 0 7 7 0 0114 0z',
    x: 'M6 18L18 6M6 6l12 12',
};

const Icon = ({ path, className = 'h-4 w-4' }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
);

const todayString = () => new Date().toISOString().substring(0, 10);

const safeNumber = (value) => {
    const normalized = String(value ?? '').replace(/,/g, '').trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
};

const costOptions = EXPENSE_CATEGORY_OPTIONS.filter((option) => option.category === COST_CATEGORY);
const defaultCostOption = costOptions.find((option) => option.id === DEFAULT_PURCHASE_CATEGORY_ID) || costOptions[0];

const branchOptionLabel = (branchId) => {
    const branch = getBranchById(branchId);
    return `${branch.shortName} - Serie ${branch.invoiceSeries}`;
};

const transferBranchLabel = (transfer, direction) => {
    const branchId = direction === 'from'
        ? (transfer.fromBranchId || transfer.branchFrom || getRecordBranchId(transfer))
        : (transfer.toBranchId || transfer.branchTo || transfer.targetBranchId);
    return branchOptionLabel(branchId || DEFAULT_BRANCH_ID);
};

const branchIdsFromContext = (branchContext = {}) => {
    const allowed = Array.isArray(branchContext?.allowedBranchIds) && branchContext.allowedBranchIds.length
        ? branchContext.allowedBranchIds
        : [branchContext?.selectedBranchId || DEFAULT_BRANCH_ID];
    return [...new Set(allowed)];
};

const DetailRow = ({ label, value, strong = false }) => (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 last:border-b-0">
        <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</span>
        <span className={`text-right text-sm ${strong ? 'font-black text-slate-950' : 'font-bold text-slate-700'}`}>{value || '-'}</span>
    </div>
);

const TransferDetailModal = ({ transfer, onClose }) => {
    if (!transfer) return null;

    return (
        <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
            <button type="button" aria-label="Cerrar detalle" className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-2xl overflow-hidden rounded-[2rem] bg-white shadow-2xl">
                <div className="bg-slate-950 px-6 py-5 text-white">
                    <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#f5b51b]">Detalle de traspaso</div>
                    <h3 className="mt-1 text-xl font-black">{transfer.reference || transfer.id}</h3>
                    <p className="mt-1 text-sm font-semibold text-white/65">{transferBranchLabel(transfer, 'from')} hacia {transferBranchLabel(transfer, 'to')}</p>
                    <button
                        type="button"
                        onClick={onClose}
                        className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-2xl bg-white/10 text-white transition hover:bg-white/20"
                    >
                        <Icon path={Icons.x} />
                    </button>
                </div>
                <div className="grid gap-4 p-6 md:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <DetailRow label="Fecha" value={transfer.date} />
                        <DetailRow label="Mes" value={transfer.month} />
                        <DetailRow label="Origen" value={transferBranchLabel(transfer, 'from')} />
                        <DetailRow label="Destino" value={transferBranchLabel(transfer, 'to')} />
                        <DetailRow label="Monto" value={fmt(transfer.amount)} strong />
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <DetailRow label="Categoria" value={transfer.category || transfer.categoria || COST_CATEGORY} />
                        <DetailRow label="Subcategoria" value={transfer.subcategory || transfer.subcategoria} />
                        <DetailRow label="Origen" value={transfer.source || 'manual'} />
                        <DetailRow label="Estado" value={transfer.status || 'activo'} />
                        <DetailRow label="Creado por" value={transfer.createdByEmail || transfer.createdBy || '-'} />
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 md:col-span-2">
                        <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Descripcion / motivo</div>
                        <p className="mt-2 whitespace-pre-wrap text-sm font-semibold text-slate-700">{transfer.description || transfer.notes || 'Sin descripcion registrada.'}</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default function BranchCostTransfers({ data = {}, branchContext = {}, canEdit = true }) {
    const { user } = useAuth();
    const allowedBranchIds = useMemo(() => branchIdsFromContext(branchContext), [branchContext]);
    const selectedBranchId = branchContext?.selectedBranchId || allowedBranchIds[0] || DEFAULT_BRANCH_ID;
    const defaultDestination = BRANCHES.find((branch) => branch.id !== selectedBranchId)?.id || selectedBranchId;
    const [form, setForm] = useState({
        date: todayString(),
        fromBranchId: selectedBranchId,
        toBranchId: defaultDestination,
        amount: '',
        categoryOptionId: defaultCostOption?.id || '',
        description: '',
        reference: '',
    });
    const [activeTab, setActiveTab] = useState('nuevo');
    const [filterMonth, setFilterMonth] = useState(todayString().substring(0, 7));
    const [filterText, setFilterText] = useState('');
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [detail, setDetail] = useState(null);

    const branchOptions = useMemo(() => (
        BRANCHES.filter((branch) => allowedBranchIds.includes(branch.id))
    ), [allowedBranchIds]);

    const transfers = useMemo(() => {
        const allowed = new Set(allowedBranchIds);
        return (data[TRANSFER_COLLECTION] || [])
            .filter((transfer) => allowed.has(transfer.fromBranchId) || allowed.has(transfer.toBranchId))
            .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt?.seconds || 0).localeCompare(String(a.createdAt?.seconds || 0)));
    }, [allowedBranchIds, data]);

    const filteredTransfers = useMemo(() => {
        const query = filterText.trim().toLowerCase();
        return transfers.filter((transfer) => {
            const monthOk = !filterMonth || String(transfer.month || transfer.date || '').startsWith(filterMonth);
            const text = [
                transfer.reference,
                transfer.description,
                transfer.category,
                transfer.subcategory,
                transfer.fromBranchName,
                transfer.toBranchName,
                transfer.createdByEmail,
            ].filter(Boolean).join(' ').toLowerCase();
            return monthOk && (!query || text.includes(query));
        });
    }, [filterMonth, filterText, transfers]);

    const totals = useMemo(() => {
        const totalMoved = filteredTransfers.reduce((sum, transfer) => sum + safeNumber(transfer.amount), 0);
        const byDestination = filteredTransfers.reduce((acc, transfer) => {
            const key = transfer.toBranchId || DEFAULT_BRANCH_ID;
            acc[key] = (acc[key] || 0) + safeNumber(transfer.amount);
            return acc;
        }, {});
        return { totalMoved, byDestination };
    }, [filteredTransfers]);

    const updateForm = (field, value) => setForm((current) => ({ ...current, [field]: value }));

    const handleSave = async (event) => {
        event.preventDefault();
        if (!canEdit) {
            setMessage('Tu usuario solo tiene permiso de visualizacion en este modulo.');
            return;
        }

        const amount = safeNumber(form.amount);
        const fromBranchId = form.fromBranchId;
        const toBranchId = form.toBranchId;
        const categoryOption = costOptions.find((option) => option.id === form.categoryOptionId) || defaultCostOption;

        if (!form.date) {
            setMessage('Indica la fecha del traspaso.');
            return;
        }
        if (!amount || amount <= 0) {
            setMessage('El monto debe ser mayor que cero.');
            return;
        }
        if (!fromBranchId || !toBranchId || fromBranchId === toBranchId) {
            setMessage('Selecciona sucursal origen y destino diferentes.');
            return;
        }

        const fromPayload = getBranchPayload(fromBranchId);
        const toPayload = getBranchPayload(toBranchId);
        const reference = form.reference.trim() || `TRASP-${form.date.replace(/-/g, '')}-${Date.now().toString().slice(-5)}`;

        setSaving(true);
        setMessage('');
        try {
            await addDoc(collection(db, TRANSFER_COLLECTION), {
                date: form.date,
                month: form.date.substring(0, 7),
                amount,
                reference,
                description: form.description.trim(),
                category: categoryOption.category,
                categoria: categoryOption.category,
                subcategory: categoryOption.subcategory,
                subcategoria: categoryOption.subcategory,
                expenseCategoryId: categoryOption.id,
                expenseCategory: categoryOption.category,
                expenseSubcategory: categoryOption.subcategory,
                fromBranchId,
                fromBranchCode: fromPayload.branchCode,
                fromBranchName: fromPayload.branchName,
                fromDocumentSeries: fromPayload.documentSeries,
                toBranchId,
                toBranchCode: toPayload.branchCode,
                toBranchName: toPayload.branchName,
                toDocumentSeries: toPayload.documentSeries,
                source: 'manual',
                sourceType: 'branch_cost_transfer',
                status: 'activo',
                createdBy: user?.uid || '',
                createdByEmail: user?.email || '',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
            });

            setMessage('Traspaso guardado. El reporte por sucursal ya movera este costo entre series.');
            setForm((current) => ({
                ...current,
                amount: '',
                description: '',
                reference: '',
            }));
            setActiveTab('historial');
        } catch (error) {
            console.error('Error guardando traspaso de costo', error);
            setMessage(`No se pudo guardar el traspaso: ${error.message}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="mx-auto max-w-[1500px] space-y-5">
            <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
                <div className="grid gap-4 bg-slate-950 px-6 py-6 text-white md:grid-cols-[1fr_auto] md:items-center">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.32em] text-[#f5b51b]">{APP_BRAND_NAME}</div>
                        <h1 className="mt-1 text-2xl font-black tracking-tight">Traspaso costos sucursal</h1>
                        <p className="mt-2 max-w-2xl text-sm font-semibold text-white/65">
                            Mueve costos de producto entre Serie A y Serie B sin alterar compras originales. Esta fase queda lista para conectarse despues con App Pedidos Internos.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/[0.06] p-2">
                        <button
                            type="button"
                            onClick={() => setActiveTab('nuevo')}
                            className={`rounded-xl px-4 py-2 text-xs font-black uppercase tracking-[0.16em] transition ${activeTab === 'nuevo' ? 'bg-[#f5b51b] text-slate-950' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
                        >
                            Nuevo
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('historial')}
                            className={`rounded-xl px-4 py-2 text-xs font-black uppercase tracking-[0.16em] transition ${activeTab === 'historial' ? 'bg-[#f5b51b] text-slate-950' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
                        >
                            Historial
                        </button>
                    </div>
                </div>
            </section>

            {message && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
                    {message}
                </div>
            )}

            {activeTab === 'nuevo' && (
                <section className="grid gap-5 xl:grid-cols-[1fr_420px]">
                    <form onSubmit={handleSave} className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="mb-5 flex items-center gap-3">
                            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#fff1f2] text-[#e30613]">
                                <Icon path={Icons.swap} className="h-6 w-6" />
                            </div>
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.26em] text-slate-400">Movimiento manual</div>
                                <h2 className="text-lg font-black text-slate-950">Registrar traspaso de costo</h2>
                            </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <label className="space-y-1">
                                <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Fecha</span>
                                <input className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15" type="date" value={form.date} onChange={(event) => updateForm('date', event.target.value)} />
                            </label>
                            <label className="space-y-1">
                                <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Referencia</span>
                                <input className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15" value={form.reference} onChange={(event) => updateForm('reference', event.target.value)} placeholder="Opcional, el sistema asigna una" />
                            </label>
                            <label className="space-y-1">
                                <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Sale de</span>
                                <select className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15" value={form.fromBranchId} onChange={(event) => updateForm('fromBranchId', event.target.value)}>
                                    {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.shortName} - Serie {branch.invoiceSeries}</option>)}
                                </select>
                            </label>
                            <label className="space-y-1">
                                <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Pasa a</span>
                                <select className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15" value={form.toBranchId} onChange={(event) => updateForm('toBranchId', event.target.value)}>
                                    {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.shortName} - Serie {branch.invoiceSeries}</option>)}
                                </select>
                            </label>
                            <label className="space-y-1">
                                <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Subcategoria fiscal</span>
                                <select className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15" value={form.categoryOptionId} onChange={(event) => updateForm('categoryOptionId', event.target.value)}>
                                    {costOptions.map((option) => <option key={option.id} value={option.id}>{option.subcategory}</option>)}
                                </select>
                            </label>
                            <label className="space-y-1">
                                <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Monto costo</span>
                                <input className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15" inputMode="decimal" value={form.amount} onChange={(event) => updateForm('amount', event.target.value)} placeholder="0.00" />
                            </label>
                            <label className="space-y-1 md:col-span-2">
                                <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Descripcion / motivo</span>
                                <textarea className="min-h-[120px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15" value={form.description} onChange={(event) => updateForm('description', event.target.value)} placeholder="Ejemplo: Traspaso de producto enviado desde Granada a Nindiri por pedido interno." />
                            </label>
                        </div>

                        <button
                            type="submit"
                            disabled={saving || !canEdit || branchOptions.length < 2}
                            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#e30613] px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-white shadow-lg shadow-red-900/15 transition hover:bg-[#9f111a] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Icon path={Icons.plus} />
                            {saving ? 'Guardando...' : 'Guardar traspaso'}
                        </button>
                        {branchOptions.length < 2 && (
                            <p className="mt-3 text-xs font-bold text-rose-600">Este usuario necesita acceso a ambas sucursales para registrar traspasos.</p>
                        )}
                    </form>

                    <aside className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#e30613]">Impacto esperado</div>
                        <h3 className="mt-1 text-lg font-black text-slate-950">Como afecta reportes</h3>
                        <div className="mt-5 space-y-3">
                            <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4">
                                <div className="text-xs font-black uppercase tracking-[0.16em] text-rose-500">Serie origen</div>
                                <div className="mt-1 text-sm font-black text-slate-950">{branchOptionLabel(form.fromBranchId)}</div>
                                <div className="mt-2 font-mono text-2xl font-black text-rose-700">-{fmt(safeNumber(form.amount))}</div>
                            </div>
                            <div className="flex justify-center text-slate-400">
                                <Icon path={Icons.arrow} className="h-6 w-6 rotate-90 md:rotate-0" />
                            </div>
                            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                                <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-600">Serie destino</div>
                                <div className="mt-1 text-sm font-black text-slate-950">{branchOptionLabel(form.toBranchId)}</div>
                                <div className="mt-2 font-mono text-2xl font-black text-emerald-700">+{fmt(safeNumber(form.amount))}</div>
                            </div>
                        </div>
                    </aside>
                </section>
            )}

            {activeTab === 'historial' && (
                <section className="rounded-[2rem] border border-slate-200 bg-white shadow-sm">
                    <div className="grid gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 lg:grid-cols-[1fr_180px_260px] lg:items-center">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Historial</div>
                            <h2 className="mt-1 text-lg font-black text-slate-950">Traspasos registrados</h2>
                        </div>
                        <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15" type="month" value={filterMonth} onChange={(event) => setFilterMonth(event.target.value)} />
                        <label className="relative">
                            <Icon path={Icons.search} className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm font-bold outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15" value={filterText} onChange={(event) => setFilterText(event.target.value)} placeholder="Buscar referencia, motivo..." />
                        </label>
                    </div>
                    <div className="grid gap-3 border-b border-slate-100 p-5 md:grid-cols-3">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Registros</div>
                            <div className="mt-1 font-mono text-2xl font-black text-slate-950">{filteredTransfers.length}</div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Total movido</div>
                            <div className="mt-1 font-mono text-2xl font-black text-[#e30613]">{fmt(totals.totalMoved)}</div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Destinos</div>
                            <div className="mt-1 text-xs font-bold text-slate-600">
                                {Object.entries(totals.byDestination).map(([branchId, total]) => `${getBranchById(branchId).shortName}: ${fmt(total)}`).join(' / ') || 'Sin movimientos'}
                            </div>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-100">
                            <thead className="bg-slate-950 text-white">
                                <tr>
                                    {['Fecha', 'Referencia', 'Origen', 'Destino', 'Subcategoria', 'Monto', ''].map((header) => (
                                        <th key={header} className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-white/70">{header}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredTransfers.map((transfer) => (
                                    <tr key={transfer.id} className="transition hover:bg-slate-50">
                                        <td className="px-4 py-3 text-sm font-bold text-slate-700">{transfer.date}</td>
                                        <td className="px-4 py-3 text-sm font-black text-slate-950">{transfer.reference || transfer.id}</td>
                                        <td className="px-4 py-3 text-sm font-semibold text-rose-700">{transferBranchLabel(transfer, 'from')}</td>
                                        <td className="px-4 py-3 text-sm font-semibold text-emerald-700">{transferBranchLabel(transfer, 'to')}</td>
                                        <td className="px-4 py-3 text-sm font-semibold text-slate-600">{transfer.subcategory || transfer.subcategoria}</td>
                                        <td className="px-4 py-3 text-right font-mono text-sm font-black text-[#e30613]">{fmt(transfer.amount)}</td>
                                        <td className="px-4 py-3 text-right">
                                            <button type="button" onClick={() => setDetail(transfer)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-950 hover:text-white">
                                                <Icon path={Icons.eye} />
                                                Ver
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {!filteredTransfers.length && (
                            <div className="p-10 text-center text-sm font-bold text-slate-400">No hay traspasos para los filtros seleccionados.</div>
                        )}
                    </div>
                </section>
            )}

            <TransferDetailModal transfer={detail} onClose={() => setDetail(null)} />
        </div>
    );
}
