import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions as firebaseFunctions } from '../firebase';
import { BRANCHES } from '../constants';
import { EXPENSE_CATEGORY_TREE } from '../services/expenseCategories';
import { PURCHASE_PAYMENT_METHODS } from '../services/fiscalUtils';
import { MASTER_USER_EMAIL } from '../services/userAccess';

const INBOX_COLLECTION = 'whatsapp_inbox';
const DRAFTS_COLLECTION = 'agente_ia_borradores';
const AUTHORIZED_USERS_COLLECTION = 'agente_ia_usuarios';

const STATUS_META = {
    RECEIVED: ['Recibido', 'bg-sky-50 text-sky-700 border-sky-200'],
    PROCESSING: ['Analizando', 'bg-blue-50 text-blue-700 border-blue-200'],
    NEEDS_INFORMATION: ['Requiere datos', 'bg-amber-50 text-amber-800 border-amber-200'],
    READY_FOR_CONFIRMATION: ['Listo para revisar', 'bg-emerald-50 text-emerald-700 border-emerald-200'],
    POSSIBLE_DUPLICATE: ['Posible duplicado', 'bg-orange-50 text-orange-800 border-orange-200'],
    CONFIRMED: ['Confirmado', 'bg-teal-50 text-teal-700 border-teal-200'],
    REGISTERED: ['Registrado', 'bg-green-50 text-green-700 border-green-200'],
    REJECTED: ['Rechazado', 'bg-slate-100 text-slate-600 border-slate-200'],
    UNAUTHORIZED: ['No autorizado', 'bg-rose-50 text-rose-700 border-rose-200'],
    ERROR: ['Error', 'bg-red-50 text-red-700 border-red-200'],
};

const CATEGORY_OPTIONS = EXPENSE_CATEGORY_TREE.flatMap(({ category, subcategories }) => (
    subcategories.map((subcategory) => ({
        value: `${category}|||${subcategory}`,
        category,
        subcategory,
        label: `${category} / ${subcategory}`,
    }))
));

const EMPTY_FORM = {
    tipoRegistro: '', branchId: '', fecha: '', vencimiento: '', proveedor: '', rucProveedor: '',
    numeroFactura: '', descripcion: '', categoria: '', subcategoria: '', accountingAccountId: '',
    accountingAccountCode: '', metodoPago: '', referenciaPago: '', subtotal: '', iva: '', total: '',
    retencionIr2: '', retencionMunicipal1: '', moneda: 'NIO', tasaCambio: '',
};

const normalizePhone = (value = '') => String(value || '').replace(/\D+/g, '');
const money = (value) => Number(value || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const displayDateTime = (value) => {
    const date = value?.toDate?.() || (value ? new Date(value) : null);
    return date && !Number.isNaN(date.getTime())
        ? date.toLocaleString('es-NI', { dateStyle: 'short', timeStyle: 'short' })
        : 'Sin fecha';
};
const getProviderName = (provider = {}) => provider.nombre || provider.name || provider.supplier || '';
const getAccountCode = (account = {}) => account.number || account.code || account.id || '';
const getAccountName = (account = {}) => account.name || account.nombre || '';

function StatusBadge({ status }) {
    const [label, classes] = STATUS_META[status] || [status || 'Sin estado', 'bg-slate-100 text-slate-600 border-slate-200'];
    return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${classes}`}>{label}</span>;
}

function Field({ label, children, className = '' }) {
    return (
        <label className={`space-y-1.5 ${className}`}>
            <span className="block text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</span>
            {children}
        </label>
    );
}

const controlClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-100';

export default function AgentAccountingAI({ providers = [], branchContext }) {
    const [items, setItems] = useState([]);
    const [accounts, setAccounts] = useState([]);
    const [authorizedUsers, setAuthorizedUsers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState(null);
    const [draft, setDraft] = useState(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [phoneForm, setPhoneForm] = useState({ phone: '', name: '', branches: ['granada'] });
    const currentEmail = String(auth.currentUser?.email || '').toLowerCase();
    const isMaster = currentEmail === MASTER_USER_EMAIL;

    const loadData = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const requests = [
                getDocs(query(collection(db, INBOX_COLLECTION), orderBy('receivedAt', 'desc'), limit(100))),
                getDoc(doc(db, 'configuracion', 'plan_cuentas_quickbooks')),
            ];
            if (isMaster) requests.push(getDocs(collection(db, AUTHORIZED_USERS_COLLECTION)));
            const [inboxSnap, chartSnap, authorizedSnap] = await Promise.all(requests);
            setItems(inboxSnap.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })));
            setAccounts((chartSnap.exists() ? chartSnap.data().accounts || [] : [])
                .filter((account) => account && account.locked !== true && getAccountCode(account) && getAccountName(account)));
            if (authorizedSnap) {
                setAuthorizedUsers(authorizedSnap.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
                    .sort((a, b) => String(a.name || a.phone).localeCompare(String(b.name || b.phone), 'es')));
            }
        } catch (loadError) {
            console.error(loadError);
            setError(loadError.message || 'No se pudo cargar la bandeja del agente.');
        } finally {
            setLoading(false);
        }
    }, [isMaster]);

    useEffect(() => { loadData(); }, [loadData]);

    const filteredItems = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return items.filter((item) => {
            if (statusFilter && item.status !== statusFilter) return false;
            if (!needle) return true;
            const summary = item.analysisSummary || {};
            return [item.senderName, item.senderPhone, item.text, summary.proveedor, summary.numeroFactura, summary.categoria]
                .some((value) => String(value || '').toLowerCase().includes(needle));
        });
    }, [items, search, statusFilter]);

    const openItem = async (item) => {
        setSelected(item);
        setDraft(null);
        setError('');
        if (!item.draftId) return;
        try {
            const snapshot = await getDoc(doc(db, DRAFTS_COLLECTION, item.draftId));
            if (!snapshot.exists()) throw new Error('El borrador no existe.');
            const value = { id: snapshot.id, ...snapshot.data() };
            setDraft(value);
            setForm(Object.keys(EMPTY_FORM).reduce((acc, key) => ({
                ...acc,
                [key]: value[key] ?? EMPTY_FORM[key],
            }), {}));
        } catch (openError) {
            setError(openError.message || 'No se pudo abrir el borrador.');
        }
    };

    const saveDraft = async () => {
        if (!draft?.id) return;
        setSaving(true);
        setError('');
        try {
            const numberFields = ['subtotal', 'iva', 'total', 'retencionIr2', 'retencionMunicipal1', 'tasaCambio'];
            const updates = { ...form };
            numberFields.forEach((field) => {
                updates[field] = form[field] === '' ? null : Number(form[field]);
            });
            const updateDraft = httpsCallable(firebaseFunctions, 'agentUpdateDraft');
            const response = await updateDraft({ draftId: draft.id, updates });
            setDraft(response.data.draft);
            setSelected((current) => current ? { ...current, status: response.data.draft.status } : current);
            await loadData();
        } catch (saveError) {
            setError(saveError.message || 'No se pudo guardar la corrección.');
        } finally {
            setSaving(false);
        }
    };

    const changeStatus = async (action) => {
        const draftId = draft?.id || selected?.draftId || selected?.id;
        if (!draftId) return;
        setSaving(true);
        setError('');
        try {
            const functionName = action === 'register' ? 'agentRegisterDraft' : 'agentSetDraftStatus';
            const setStatus = httpsCallable(firebaseFunctions, functionName);
            await setStatus(action === 'register' ? { draftId } : { draftId, action });
            setSelected(null);
            setDraft(null);
            await loadData();
        } catch (statusError) {
            setError(statusError.message || 'No se pudo cambiar el estado.');
        } finally {
            setSaving(false);
        }
    };

    const saveAuthorizedPhone = async (event) => {
        event.preventDefault();
        const phone = normalizePhone(phoneForm.phone);
        if (phone.length < 8 || !phoneForm.name.trim()) {
            setError('Indica nombre y número completo con código de país.');
            return;
        }
        await setDoc(doc(db, AUTHORIZED_USERS_COLLECTION, phone), {
            phone,
            name: phoneForm.name.trim(),
            active: true,
            branchAccess: phoneForm.branches.length ? phoneForm.branches : ['granada'],
            updatedAt: serverTimestamp(),
            updatedBy: currentEmail,
        }, { merge: true });
        setPhoneForm({ phone: '', name: '', branches: ['granada'] });
        await loadData();
    };

    const removeAuthorizedPhone = async (phoneId) => {
        if (!window.confirm('¿Quitar autorización a este número de WhatsApp?')) return;
        await deleteDoc(doc(db, AUTHORIZED_USERS_COLLECTION, phoneId));
        await loadData();
    };

    const selectedSupport = draft?.supportFiles?.[0] || selected?.storedMedia || null;
    const selectedMime = selectedSupport?.mimeType || selectedSupport?.contentType || '';
    const allowedBranches = branchContext?.allowedBranchIds?.length
        ? BRANCHES.filter((branch) => branchContext.allowedBranchIds.includes(branch.id))
        : BRANCHES;

    return (
        <div className="space-y-5">
            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 bg-[linear-gradient(120deg,#071628,#111827_55%,#3a1118)] px-5 py-5 text-white md:px-7">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-amber-300">Agente contable IA</p>
                            <h2 className="mt-1 text-xl font-black">Bandeja fiscal de WhatsApp</h2>
                            <p className="mt-1 max-w-2xl text-sm text-slate-300">OpenAI prepara borradores; una persona revisa y confirma antes de afectar la contabilidad.</p>
                        </div>
                        <button type="button" onClick={loadData} disabled={loading} className="rounded-xl bg-white px-4 py-2.5 text-xs font-black uppercase tracking-[0.16em] text-slate-900 transition hover:-translate-y-0.5 disabled:opacity-50">
                            {loading ? 'Actualizando...' : 'Actualizar bandeja'}
                        </button>
                    </div>
                </div>
                <div className="grid gap-3 p-4 md:grid-cols-[1fr_220px] md:p-5">
                    <input className={controlClass} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar proveedor, factura, remitente..." />
                    <select className={controlClass} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                        <option value="">Todos los estados</option>
                        {Object.entries(STATUS_META).map(([value, [label]]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                </div>
            </section>

            {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>}

            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Últimos 100 mensajes</p>
                        <h3 className="text-base font-black text-slate-900">Documentos recibidos</h3>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{filteredItems.length}</span>
                </div>
                <div className="divide-y divide-slate-100">
                    {!loading && !filteredItems.length && <div className="px-5 py-12 text-center text-sm font-semibold text-slate-400">Todavía no hay documentos con estos filtros.</div>}
                    {filteredItems.map((item) => {
                        const summary = item.analysisSummary || {};
                        return (
                            <button key={item.id} type="button" onClick={() => openItem(item)} className="grid w-full gap-3 px-5 py-4 text-left transition hover:bg-slate-50 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <StatusBadge status={item.status} />
                                        <span className="text-xs font-bold text-slate-500">{item.senderName || item.senderPhone || 'WhatsApp'}</span>
                                    </div>
                                    <p className="mt-2 truncate text-sm font-black text-slate-900">{summary.proveedor || item.text || 'Documento pendiente de analizar'}</p>
                                    <p className="mt-1 text-xs font-semibold text-slate-500">{summary.numeroFactura ? `Factura ${summary.numeroFactura} · ` : ''}{summary.fecha || displayDateTime(item.receivedAt)}</p>
                                    {item.error && <p className="mt-1 text-xs font-bold text-red-600">{item.error}</p>}
                                </div>
                                <div className="text-left md:text-right">
                                    <p className="font-mono text-base font-black text-slate-900">C$ {money(summary.total)}</p>
                                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{summary.branchId || 'Sin sucursal'}</p>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </section>

            {isMaster && (
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-600">Seguridad</p>
                        <h3 className="text-base font-black text-slate-900">Números autorizados</h3>
                    </div>
                    <form onSubmit={saveAuthorizedPhone} className="grid gap-3 lg:grid-cols-[1fr_1fr_auto_auto] lg:items-end">
                        <Field label="Nombre"><input className={controlClass} value={phoneForm.name} onChange={(event) => setPhoneForm((current) => ({ ...current, name: event.target.value }))} placeholder="Responsable" /></Field>
                        <Field label="WhatsApp con código de país"><input className={controlClass} value={phoneForm.phone} onChange={(event) => setPhoneForm((current) => ({ ...current, phone: event.target.value }))} placeholder="50588888888" /></Field>
                        <div className="flex gap-2 pb-1">
                            {BRANCHES.map((branch) => <label key={branch.id} className="flex items-center gap-1.5 text-xs font-bold text-slate-600"><input type="checkbox" checked={phoneForm.branches.includes(branch.id)} onChange={(event) => setPhoneForm((current) => ({ ...current, branches: event.target.checked ? [...new Set([...current.branches, branch.id])] : current.branches.filter((id) => id !== branch.id) }))} />{branch.shortName}</label>)}
                        </div>
                        <button className="rounded-xl bg-slate-950 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-white">Autorizar</button>
                    </form>
                    <div className="mt-4 grid gap-2 md:grid-cols-2">
                        {authorizedUsers.map((user) => <div key={user.id} className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3"><div><p className="text-sm font-black text-slate-900">{user.name || 'Sin nombre'}</p><p className="text-xs font-semibold text-slate-500">+{user.phone || user.id} · {(user.branchAccess || ['granada']).join(', ')}</p></div><button type="button" onClick={() => removeAuthorizedPhone(user.id)} className="text-xs font-black text-red-600">Quitar</button></div>)}
                    </div>
                </section>
            )}

            {selected && (
                <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-slate-950/65 p-0 backdrop-blur-sm md:items-center md:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
                    <div className="max-h-[94vh] w-full max-w-6xl overflow-y-auto rounded-t-3xl bg-slate-50 shadow-2xl md:rounded-3xl">
                        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur md:px-7">
                            <div><StatusBadge status={draft?.status || selected.status} /><h3 className="mt-1 text-lg font-black text-slate-950">Revisión del documento</h3></div>
                            <button type="button" onClick={() => setSelected(null)} className="h-10 w-10 rounded-full border border-slate-200 text-xl font-bold text-slate-500">×</button>
                        </div>
                        <div className="grid gap-5 p-5 lg:grid-cols-[380px_minmax(0,1fr)] md:p-7">
                            <aside className="space-y-4">
                                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                                    <div className="border-b border-slate-200 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-slate-600">Soporte original</div>
                                    {selectedSupport?.url ? (
                                        selectedMime === 'application/pdf'
                                            ? <iframe title="Soporte PDF" src={selectedSupport.url} className="h-[520px] w-full" />
                                            : <a href={selectedSupport.url} target="_blank" rel="noreferrer"><img src={selectedSupport.url} alt="Soporte fiscal" className="max-h-[620px] w-full object-contain" /></a>
                                    ) : <div className="px-4 py-12 text-center text-sm font-semibold text-slate-400">El soporte aún no está disponible.</div>}
                                </div>
                                {draft?.pregunta && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">{draft.pregunta}</div>}
                                {!!draft?.alertas?.length && <div className="rounded-2xl border border-red-200 bg-red-50 p-4"><p className="text-xs font-black uppercase tracking-[0.15em] text-red-700">Alertas</p>{draft.alertas.map((alert) => <p key={alert} className="mt-2 text-sm font-semibold text-red-700">• {alert}</p>)}</div>}
                            </aside>
                            <main className="rounded-2xl border border-slate-200 bg-white p-5">
                                {!draft ? (
                                    <div className="py-16 text-center"><p className="text-sm font-bold text-slate-500">{selected.status === 'ERROR' ? selected.error : 'El análisis todavía no ha generado un borrador.'}</p>{selected.status === 'ERROR' && <button type="button" onClick={() => changeStatus('retry')} className="mt-4 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black uppercase tracking-[0.14em] text-white">Reprocesar</button>}</div>
                                ) : (
                                    <div className="space-y-5">
                                        <div className="grid gap-4 sm:grid-cols-2">
                                            <Field label="Tipo"><select className={controlClass} value={form.tipoRegistro} onChange={(event) => setForm((current) => ({ ...current, tipoRegistro: event.target.value }))}><option value="">Seleccionar</option><option value="gasto">Gasto operativo</option><option value="compra">Compra / costo</option></select></Field>
                                            <Field label="Sucursal"><select className={controlClass} value={form.branchId} onChange={(event) => setForm((current) => ({ ...current, branchId: event.target.value }))}><option value="">Seleccionar</option>{allowedBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></Field>
                                            <Field label="Fecha"><input type="date" className={controlClass} value={form.fecha} onChange={(event) => setForm((current) => ({ ...current, fecha: event.target.value }))} /></Field>
                                            <Field label="Factura"><input className={controlClass} value={form.numeroFactura} onChange={(event) => setForm((current) => ({ ...current, numeroFactura: event.target.value }))} /></Field>
                                            <Field label="Proveedor"><select className={controlClass} value={form.proveedor} onChange={(event) => { const provider = providers.find((item) => getProviderName(item) === event.target.value); setForm((current) => ({ ...current, proveedor: event.target.value, providerId: provider?.id || '', providerCode: provider?.code || provider?.codigo || '', rucProveedor: provider?.ruc || provider?.rfc || current.rucProveedor })); }}><option value="">Seleccionar proveedor existente</option>{providers.map((provider) => <option key={provider.id || getProviderName(provider)} value={getProviderName(provider)}>{getProviderName(provider)}</option>)}</select></Field>
                                            <Field label="RUC"><input className={controlClass} value={form.rucProveedor} onChange={(event) => setForm((current) => ({ ...current, rucProveedor: event.target.value }))} /></Field>
                                            <Field label="Descripción" className="sm:col-span-2"><input className={controlClass} value={form.descripcion} onChange={(event) => setForm((current) => ({ ...current, descripcion: event.target.value }))} /></Field>
                                            <Field label="Categoría / subcategoría" className="sm:col-span-2"><select className={controlClass} value={`${form.categoria}|||${form.subcategoria}`} onChange={(event) => { const option = CATEGORY_OPTIONS.find((item) => item.value === event.target.value); if (option) setForm((current) => ({ ...current, categoria: option.category, subcategoria: option.subcategory })); }}><option value="|||">Seleccionar</option>{CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
                                            <Field label="Cuenta contable" className="sm:col-span-2"><select className={controlClass} value={form.accountingAccountCode || form.accountingAccountId} onChange={(event) => { const account = accounts.find((item) => getAccountCode(item) === event.target.value); setForm((current) => ({ ...current, accountingAccountId: account?.id || event.target.value, accountingAccountCode: event.target.value })); }}><option value="">Seleccionar cuenta existente</option>{accounts.map((account) => <option key={account.id || getAccountCode(account)} value={getAccountCode(account)}>{getAccountCode(account)} · {getAccountName(account)}</option>)}</select></Field>
                                            <Field label="Método de pago"><select className={controlClass} value={form.metodoPago} onChange={(event) => setForm((current) => ({ ...current, metodoPago: event.target.value }))}><option value="">Seleccionar</option>{PURCHASE_PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}</select></Field>
                                            <Field label="Referencia"><input className={controlClass} value={form.referenciaPago} onChange={(event) => setForm((current) => ({ ...current, referenciaPago: event.target.value }))} /></Field>
                                            {form.metodoPago === 'CREDITO' && <Field label="Vencimiento"><input type="date" className={controlClass} value={form.vencimiento} onChange={(event) => setForm((current) => ({ ...current, vencimiento: event.target.value }))} /></Field>}
                                        </div>
                                        <div className="grid gap-4 sm:grid-cols-3">
                                            {['subtotal', 'iva', 'total', 'retencionIr2', 'retencionMunicipal1'].map((field) => <Field key={field} label={{ subtotal: 'Subtotal', iva: 'IVA', total: 'Total', retencionIr2: 'Ret. IR 2%', retencionMunicipal1: 'Ret. Municipal 1%' }[field]}><input type="number" step="0.01" className={controlClass} value={form[field]} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))} /></Field>)}
                                        </div>
                                        {!!draft.datosFaltantes?.length && <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">Pendiente: {draft.datosFaltantes.join(', ')}</p>}
                                        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
                                            <button type="button" onClick={() => changeStatus('reject')} disabled={saving} className="rounded-xl border border-red-200 px-4 py-2.5 text-xs font-black uppercase tracking-[0.12em] text-red-600">Rechazar</button>
                                            <button type="button" onClick={saveDraft} disabled={saving} className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-black uppercase tracking-[0.12em] text-white">Guardar corrección</button>
                                            <button type="button" onClick={() => changeStatus('register')} disabled={saving || !!draft.datosFaltantes?.length || Number(draft.confianza || 0) < 0.9 || draft.status === 'POSSIBLE_DUPLICATE'} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black uppercase tracking-[0.12em] text-white disabled:opacity-40">Confirmar y registrar</button>
                                        </div>
                                    </div>
                                )}
                            </main>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
