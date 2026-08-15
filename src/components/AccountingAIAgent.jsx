import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '../firebase';
import { BRANCHES } from '../constants';
import { EXPENSE_CATEGORY_OPTIONS } from '../services/expenseCategories';
import { PAYMENT_METHODS } from '../services/fiscalUtils';
import { loadChartOfAccounts } from '../services/chartOfAccounts';
import { isMasterEmail } from '../services/userAccess';

const STATUS_META = {
    RECEIVED: ['Nuevo', 'bg-sky-50 text-sky-700 border-sky-200'],
    PROCESSING: ['Procesando', 'bg-indigo-50 text-indigo-700 border-indigo-200'],
    NEEDS_INFORMATION: ['Falta informacion', 'bg-amber-50 text-amber-800 border-amber-200'],
    READY_FOR_CONFIRMATION: ['Listo para confirmar', 'bg-emerald-50 text-emerald-700 border-emerald-200'],
    POSSIBLE_DUPLICATE: ['Posible duplicado', 'bg-orange-50 text-orange-800 border-orange-200'],
    CONFIRMED: ['Confirmado', 'bg-cyan-50 text-cyan-700 border-cyan-200'],
    REGISTERED: ['Registrado', 'bg-green-50 text-green-700 border-green-200'],
    REJECTED: ['Rechazado', 'bg-slate-100 text-slate-600 border-slate-200'],
    ERROR: ['Error', 'bg-rose-50 text-rose-700 border-rose-200'],
};

const FILTERS = [
    ['ALL', 'Todos'],
    ['RECEIVED', 'Nuevos'],
    ['PROCESSING', 'Procesando'],
    ['NEEDS_INFORMATION', 'Falta informacion'],
    ['READY_FOR_CONFIRMATION', 'Por confirmar'],
    ['POSSIBLE_DUPLICATE', 'Duplicados'],
    ['REGISTERED', 'Registrados'],
    ['REJECTED', 'Rechazados'],
    ['ERROR', 'Errores'],
];

const emptyUser = { name: '', phone: '', active: true, permissions: { submitDocuments: true, confirmOwnDrafts: true, registerWithoutSupport: false } };
const emptyRule = { provider: '', type: 'gasto', category: '', subcategory: '', branchId: '', priority: 100, active: true };

const formatMoney = (value) => new Intl.NumberFormat('es-NI', { style: 'currency', currency: 'NIO' }).format(Number(value) || 0);
const formatDateTime = (value) => {
    const date = value?.toDate?.() || (value ? new Date(value) : null);
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleString('es-NI') : 'Sin fecha';
};
const normalize = (value = '') => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const AgentIcon = ({ type = 'spark', className = 'h-5 w-5' }) => {
    const paths = {
        spark: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8L12 3zm6 11l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9L18 14z',
        inbox: 'M4 4h16v12H4V4zm0 8h4l2 2h4l2-2h4v8H4v-8z',
        users: 'M16 20v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2m7-10a4 4 0 100-8 4 4 0 000 8zm13 10v-2a4 4 0 00-3-3.87m-2-11.96a4 4 0 010 7.75',
        rules: 'M12 3v18m9-9H3m14.5-6.5l-11 11m0-11l11 11',
        settings: 'M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm7.4-3.5a7.7 7.7 0 00-.1-1l2-1.6-2-3.4-2.5 1a8 8 0 00-1.7-1L14.7 3h-4l-.4 2.9a8 8 0 00-1.7 1L6 6 4 9.4 6 11a7.7 7.7 0 000 2l-2 1.6L6 18l2.6-1a8 8 0 001.7 1l.4 3h4l.4-3a8 8 0 001.7-1l2.5 1 2-3.4-2-1.6a7.7 7.7 0 00.1-1z',
        close: 'M6 6l12 12M18 6L6 18',
    };
    return <svg className={className} fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={paths[type] || paths.spark} /></svg>;
};

const StatusBadge = ({ status }) => {
    const [label, className] = STATUS_META[status] || [status || 'Sin estado', 'bg-slate-50 text-slate-600 border-slate-200'];
    return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${className}`}>{label}</span>;
};

const Field = ({ label, children, span = '' }) => (
    <label className={`block ${span}`}>
        <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{label}</span>
        {children}
    </label>
);

const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-[#e30613] focus:ring-4 focus:ring-red-500/10 disabled:bg-slate-100 disabled:text-slate-500';

function DocumentPreview({ support }) {
    if (!support?.url) {
        return <div className="grid min-h-[320px] place-items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">No hay soporte principal disponible.</div>;
    }
    const pdf = String(support.mimeType || support.contentType || '').includes('pdf');
    return (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
            {pdf
                ? <iframe title="Soporte fiscal" src={support.url} className="h-[520px] w-full bg-white" />
                : <img src={support.url} alt="Soporte fiscal original" className="max-h-[620px] w-full object-contain" />}
            <a href={support.url} target="_blank" rel="noreferrer" className="block border-t border-slate-200 bg-white px-4 py-3 text-center text-xs font-black uppercase tracking-[0.16em] text-[#b4111b] hover:bg-red-50">Abrir original</a>
        </div>
    );
}

function DraftDetail({ draft, providers, accounts, audit, busy, onClose, onSave, onConfirm, onReject, onRetry }) {
    const [form, setForm] = useState(draft || {});
    const [reason, setReason] = useState('');
    const category = useMemo(() => EXPENSE_CATEGORY_OPTIONS.find((item) => item.category === form.categoria && item.subcategory === form.subcategoria), [form.categoria, form.subcategoria]);

    useEffect(() => setForm(draft || {}), [draft]);
    if (!draft) return null;
    const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
    const support = form.soportes?.find((item) => item.type === 'invoice' || item.role === 'invoice') || form.soportes?.[0];
    const editable = !['REGISTERED', 'REJECTED'].includes(form.status);
    const fiscalTotal = Number(form.subtotal || 0) + Number(form.iva || 0);

    return (
        <div className="fixed inset-0 z-[1000] overflow-y-auto bg-slate-950/60 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
            <div className="mx-auto max-w-7xl overflow-hidden rounded-[1.75rem] bg-white shadow-2xl">
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-950 px-5 py-5 text-white sm:px-7">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-amber-400">Revision fiscal asistida</div>
                        <h2 className="mt-1 text-xl font-black">{form.proveedor || 'Documento por identificar'}</h2>
                        <div className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge status={form.status} /><span className="text-xs font-semibold text-slate-300">{form.numeroFactura ? `Factura ${form.numeroFactura}` : 'Sin numero de factura'}</span></div>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-xl border border-white/15 p-2 text-white transition hover:bg-white/10"><AgentIcon type="close" /></button>
                </div>

                <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
                    <div className="space-y-4">
                        <DocumentPreview support={support} />
                        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="flex items-center justify-between"><h3 className="text-sm font-black text-slate-900">Trazabilidad</h3><span className="text-xs font-bold text-slate-500">{audit.length} evento(s)</span></div>
                            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
                                {audit.map((entry) => <div key={entry.id} className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] font-black uppercase tracking-[0.16em] text-[#b4111b]">{entry.eventType}</div><div className="mt-1 text-xs font-semibold text-slate-500">{formatDateTime(entry.createdAt)}</div></div>)}
                                {!audit.length && <p className="text-sm font-semibold text-slate-500">Todavia no hay eventos adicionales.</p>}
                            </div>
                        </section>
                    </div>

                    <div className="space-y-5">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="Tipo">
                                <select className={inputClass} value={form.tipoRegistro || ''} disabled={!editable} onChange={(event) => set('tipoRegistro', event.target.value)}><option value="">Seleccionar...</option><option value="gasto">Gasto</option><option value="compra">Compra</option></select>
                            </Field>
                            <Field label="Sucursal">
                                <select className={inputClass} value={form.branchId || ''} disabled={!editable} onChange={(event) => set('branchId', event.target.value)}><option value="">Seleccionar...</option>{BRANCHES.map((branch) => <option key={branch.id} value={branch.id}>{branch.shortName} - Serie {branch.invoiceSeries}</option>)}</select>
                            </Field>
                            <Field label="Proveedor" span="sm:col-span-2">
                                <select className={inputClass} value={form.providerId || ''} disabled={!editable} onChange={(event) => set('providerId', event.target.value)}><option value="">Proveedor existente...</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.nombre || provider.name}</option>)}</select>
                            </Field>
                            <Field label="RUC"><input className={inputClass} value={form.rucProveedor || ''} disabled={!editable} onChange={(event) => set('rucProveedor', event.target.value)} /></Field>
                            <Field label="Numero de factura"><input className={inputClass} value={form.numeroFactura || ''} disabled={!editable} onChange={(event) => set('numeroFactura', event.target.value)} placeholder="Vacio si no existe" /></Field>
                            <Field label="Fecha impresa"><input type="date" className={inputClass} value={form.fecha || ''} disabled={!editable} onChange={(event) => set('fecha', event.target.value)} /></Field>
                            <Field label="Vencimiento"><input type="date" className={inputClass} value={form.vencimiento || ''} disabled={!editable} onChange={(event) => set('vencimiento', event.target.value)} /></Field>
                            <Field label="Descripcion" span="sm:col-span-2"><textarea className={`${inputClass} min-h-20 resize-y`} value={form.descripcion || ''} disabled={!editable} onChange={(event) => set('descripcion', event.target.value)} /></Field>
                            <Field label="Categoria / Subcategoria" span="sm:col-span-2">
                                <select className={inputClass} value={category?.id || ''} disabled={!editable} onChange={(event) => { const option = EXPENSE_CATEGORY_OPTIONS.find((item) => item.id === event.target.value); if (option) setForm((current) => ({ ...current, categoria: option.category, subcategoria: option.subcategory })); }}><option value="">Seleccionar categoria exacta...</option>{EXPENSE_CATEGORY_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
                            </Field>
                            <Field label="Cuenta contable" span="sm:col-span-2">
                                <select className={inputClass} value={form.accountingAccountId || ''} disabled={!editable} onChange={(event) => set('accountingAccountId', event.target.value)}><option value="">Seleccionar cuenta existente...</option>{accounts.filter((account) => account.isPosting !== false && account.locked !== true).map((account) => <option key={account.id || account.number} value={account.id || account.number}>{account.number} - {account.name}</option>)}</select>
                            </Field>
                            <Field label="Metodo de pago"><select className={inputClass} value={form.metodoPago || ''} disabled={!editable} onChange={(event) => set('metodoPago', event.target.value)}><option value="">Seleccionar...</option>{PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}</select></Field>
                            <Field label="Referencia"><input className={inputClass} value={form.referenciaPago || ''} disabled={!editable} onChange={(event) => set('referenciaPago', event.target.value)} /></Field>
                            <Field label="Subtotal"><input type="number" step="0.01" className={inputClass} value={form.subtotal ?? ''} disabled={!editable} onChange={(event) => set('subtotal', event.target.value === '' ? null : Number(event.target.value))} /></Field>
                            <Field label="IVA"><input type="number" step="0.01" className={inputClass} value={form.iva ?? ''} disabled={!editable} onChange={(event) => set('iva', event.target.value === '' ? null : Number(event.target.value))} /></Field>
                            <Field label="Total"><input type="number" step="0.01" className={inputClass} value={form.total ?? ''} disabled={!editable} onChange={(event) => set('total', event.target.value === '' ? null : Number(event.target.value))} /></Field>
                            <Field label="Comprobacion"><div className={`rounded-xl border px-3.5 py-2.5 text-sm font-black ${Math.abs(fiscalTotal - Number(form.total || 0)) <= 0.02 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>{formatMoney(fiscalTotal)}</div></Field>
                            <Field label="Retencion IR 2%"><input type="number" step="0.01" className={inputClass} value={form.retencionIr2 ?? 0} disabled={!editable} onChange={(event) => set('retencionIr2', Number(event.target.value || 0))} /></Field>
                            <Field label="Retencion municipal 1%"><input type="number" step="0.01" className={inputClass} value={form.retencionMunicipal1 ?? 0} disabled={!editable} onChange={(event) => set('retencionMunicipal1', Number(event.target.value || 0))} /></Field>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Confianza</div><div className="mt-1 text-2xl font-black text-slate-950">{Math.round(Number(form.confianza || 0) * 100)}%</div></div>
                            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><div className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-700">Retenciones</div><div className="mt-1 text-xl font-black text-amber-900">{formatMoney(Number(form.retencionIr2 || 0) + Number(form.retencionMunicipal1 || 0))}</div></div>
                            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><div className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">Pago neto</div><div className="mt-1 text-xl font-black text-emerald-900">{formatMoney(Number(form.total || 0) - Number(form.retencionIr2 || 0) - Number(form.retencionMunicipal1 || 0))}</div></div>
                        </div>

                        {editable && <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
                            {!support?.url && <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm font-bold text-slate-700 sm:col-span-2"><input type="checkbox" className="mt-1" checked={form.withoutSupportConfirmed === true} onChange={(event) => setForm((current) => ({ ...current, sinSoporteFiscal: event.target.checked, withoutSupportConfirmed: event.target.checked }))} /><span>Autorizar expresamente este registro sin soporte fiscal. La autorizacion quedara auditada.</span></label>}
                            {Number(form.retencionIr2 || 0) > 0 && !form.soportes?.some((item) => item.type === 'retentionIr2') && <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900"><input type="checkbox" className="mt-1" checked={form.retentionIrConfirmed === true} onChange={(event) => set('retentionIrConfirmed', event.target.checked)} /><span>Confirmo retencion IR 2% sin constancia adjunta.</span></label>}
                            {Number(form.retencionMunicipal1 || 0) > 0 && !form.soportes?.some((item) => item.type === 'retentionMunicipal1') && <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900"><input type="checkbox" className="mt-1" checked={form.retentionMunicipalConfirmed === true} onChange={(event) => set('retentionMunicipalConfirmed', event.target.checked)} /><span>Confirmo retencion municipal 1% sin constancia adjunta.</span></label>}
                        </div>}

                        {(form.alertas?.length > 0 || form.datosFaltantes?.length > 0) && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><div className="text-xs font-black uppercase tracking-[0.18em] text-amber-800">Revision requerida</div>{form.alertas?.map((alert) => <p key={alert} className="mt-2 text-sm font-semibold text-amber-900">{alert}</p>)}{form.datosFaltantes?.length > 0 && <p className="mt-2 text-xs font-bold text-amber-700">Pendientes: {form.datosFaltantes.join(', ')}</p>}</div>}

                        {editable && <div className="flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:flex-wrap">
                            <button type="button" disabled={busy} onClick={() => onSave(form)} className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-xs font-black uppercase tracking-[0.16em] text-slate-800 transition hover:bg-slate-50 disabled:opacity-50">Guardar correcciones</button>
                            {form.status === 'POSSIBLE_DUPLICATE' && <button type="button" disabled={busy} onClick={() => onSave({ ...form, ignoreDuplicate: true })} className="rounded-xl border border-orange-300 bg-orange-50 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-orange-800 transition hover:bg-orange-100 disabled:opacity-50">Confirmar que no es duplicado</button>}
                            <button type="button" disabled={busy || form.status !== 'READY_FOR_CONFIRMATION'} onClick={() => onConfirm(form.id || form.draftId)} className="rounded-xl bg-emerald-600 px-5 py-3 text-xs font-black uppercase tracking-[0.16em] text-white shadow-lg shadow-emerald-900/15 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">Confirmar y registrar</button>
                            {form.status === 'ERROR' && <button type="button" disabled={busy} onClick={() => onRetry(form.inboxId)} className="rounded-xl bg-sky-600 px-5 py-3 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-sky-700 disabled:opacity-50">Reintentar</button>}
                            <div className="flex min-w-0 flex-1 gap-2 sm:justify-end"><input className={`${inputClass} min-w-0 sm:max-w-xs`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo de rechazo" /><button type="button" disabled={busy} onClick={() => onReject(form.id || form.draftId, reason)} className="rounded-xl bg-rose-600 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-white hover:bg-rose-700 disabled:opacity-50">Rechazar</button>{form.status === 'POSSIBLE_DUPLICATE' && <button type="button" disabled={busy} onClick={() => onReject(form.id || form.draftId, 'Marcado como duplicado por revision humana')} className="rounded-xl border border-orange-300 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-orange-800 hover:bg-orange-50">Marcar duplicado</button>}</div>
                        </div>}
                        {form.status === 'REGISTERED' && form.finalRecordId && <div className="border-t border-slate-200 pt-5"><a href={`/ingresar?tab=${form.finalCollection === 'compras' ? 'Compras' : 'Gastos'}`} className="inline-flex rounded-xl bg-slate-950 px-5 py-3 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-[#b4111b]">Abrir registro definitivo</a><p className="mt-2 text-xs font-semibold text-slate-500">{form.finalCollection} / {form.finalRecordId}</p></div>}
                    </div>
                </div>
            </div>
        </div>
    );
}

function AuthorizedUsers({ users, busy, onSave, onDelete }) {
    const [form, setForm] = useState(emptyUser);
    const submit = (event) => { event.preventDefault(); onSave(form).then(() => setForm(emptyUser)); };
    return <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[#e30613]">Acceso administrativo</div><h3 className="mt-1 text-lg font-black text-slate-950">Autorizar WhatsApp</h3>
            <div className="mt-5 space-y-3"><Field label="Nombre"><input className={inputClass} required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><Field label="Telefono con codigo de pais"><input className={inputClass} required value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="50588888888" /></Field>
                <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm font-bold text-slate-700"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />Activo</label>
                <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm font-bold text-slate-700"><input type="checkbox" checked={form.permissions.confirmOwnDrafts} onChange={(event) => setForm({ ...form, permissions: { ...form.permissions, confirmOwnDrafts: event.target.checked } })} />Confirmar sus borradores</label>
                <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm font-bold text-slate-700"><input type="checkbox" checked={form.permissions.registerWithoutSupport} onChange={(event) => setForm({ ...form, permissions: { ...form.permissions, registerWithoutSupport: event.target.checked } })} />Autorizar sin soporte</label>
                <button disabled={busy} className="w-full rounded-xl bg-slate-950 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-white hover:bg-[#b4111b] disabled:opacity-50">Guardar usuario</button>
            </div>
        </form>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 px-5 py-4"><h3 className="font-black text-slate-950">Numeros autorizados</h3><p className="text-xs font-semibold text-slate-500">Un numero no listado no crea borradores y queda auditado.</p></div><div className="divide-y divide-slate-100">{users.map((user) => <div key={user.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-black text-slate-900">{user.name || user.nombre || 'Sin nombre'}</div><div className="mt-1 text-xs font-bold text-slate-500">+{user.phone || user.id} · {user.active === false ? 'Inactivo' : 'Activo'}</div></div><div className="flex gap-2"><button type="button" onClick={() => setForm({ ...emptyUser, ...user, phone: user.phone || user.id })} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">Editar</button><button type="button" onClick={() => onDelete(user.phone || user.id)} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-black text-rose-700 hover:bg-rose-50">Eliminar</button></div></div>)}{!users.length && <div className="p-8 text-center text-sm font-semibold text-slate-500">No hay numeros autorizados.</div>}</div></div>
    </div>;
}

function AgentRules({ rules, busy, onSave, onDelete, onSeed }) {
    const [form, setForm] = useState(emptyRule);
    const category = EXPENSE_CATEGORY_OPTIONS.find((item) => item.category === form.category && item.subcategory === form.subcategory);
    return <div className="space-y-5"><div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-xs font-black uppercase tracking-[0.18em] text-amber-800">Reglas deterministas</div><p className="mt-1 text-sm font-semibold text-amber-900">Las reglas fijas prevalecen sobre cualquier inferencia del modelo.</p></div><button type="button" disabled={busy} onClick={onSeed} className="rounded-xl bg-amber-900 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-white disabled:opacity-50">Inicializar reglas base</button></div>
        <form onSubmit={(event) => { event.preventDefault(); onSave(form).then(() => setForm(emptyRule)); }} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-6"><Field label="Proveedor"><input className={inputClass} required value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })} /></Field><Field label="Tipo"><select className={inputClass} value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option value="gasto">Gasto</option><option value="compra">Compra</option></select></Field><Field label="Sucursal"><select className={inputClass} value={form.branchId || ''} onChange={(event) => setForm({ ...form, branchId: event.target.value })}><option value="">Ambas</option><option value="granada">Granada</option><option value="nindiri">Nindiri</option></select></Field><Field label="Prioridad"><input className={inputClass} type="number" min="1" value={form.priority} onChange={(event) => setForm({ ...form, priority: Number(event.target.value) || 100 })} /></Field><Field label="Categoria exacta" span="sm:col-span-2 lg:col-span-2"><select className={inputClass} required value={category?.id || ''} onChange={(event) => { const option = EXPENSE_CATEGORY_OPTIONS.find((item) => item.id === event.target.value); if (option) setForm({ ...form, category: option.category, subcategory: option.subcategory }); }}><option value="">Seleccionar...</option>{EXPENSE_CATEGORY_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></Field><label className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-700"><input type="checkbox" checked={form.active !== false} onChange={(event) => setForm({ ...form, active: event.target.checked })} />Regla activa</label><div className="flex gap-2 lg:col-span-5"><button disabled={busy} className="rounded-xl bg-slate-950 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-white hover:bg-[#b4111b] disabled:opacity-50">{form.id ? 'Actualizar regla' : 'Guardar regla'}</button>{form.id && <button type="button" onClick={() => setForm(emptyRule)} className="rounded-xl border border-slate-200 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-slate-700">Cancelar edicion</button>}</div></form>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm"><table className="min-w-full text-left"><thead className="bg-slate-50 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500"><tr><th className="px-4 py-3">Proveedor</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Clasificacion</th><th className="px-4 py-3">Sucursal</th><th className="px-4 py-3">Origen</th><th className="px-4 py-3">Prioridad</th><th className="px-4 py-3">Confirmaciones</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3 text-right">Acciones</th></tr></thead><tbody className="divide-y divide-slate-100">{rules.map((rule) => <tr key={rule.id} className="text-sm font-semibold text-slate-700"><td className="px-4 py-3 font-black text-slate-950">{rule.provider}</td><td className="px-4 py-3 uppercase">{rule.type}</td><td className="px-4 py-3">{rule.category} / {rule.subcategory}</td><td className="px-4 py-3">{rule.branchId === 'nindiri' ? 'Nindiri' : rule.branchId === 'granada' ? 'Granada' : 'Ambas'}</td><td className="px-4 py-3">{rule.origin}</td><td className="px-4 py-3">{rule.priority || 100}</td><td className="px-4 py-3">{rule.confirmations || 0}</td><td className="px-4 py-3">{rule.active === false ? 'Inactiva' : 'Activa'}</td><td className="px-4 py-3"><div className="flex justify-end gap-2"><button type="button" onClick={() => setForm({ ...emptyRule, ...rule })} className="rounded-lg border border-slate-200 px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] hover:bg-slate-50">Editar</button><button type="button" disabled={busy} onClick={() => onSave({ ...rule, active: rule.active === false })} className="rounded-lg border border-amber-200 px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-amber-800 hover:bg-amber-50 disabled:opacity-50">{rule.active === false ? 'Activar' : 'Desactivar'}</button>{rule.origin !== 'fixed' && <button type="button" disabled={busy} onClick={() => onDelete(rule)} className="rounded-lg border border-rose-200 px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-rose-700 hover:bg-rose-50 disabled:opacity-50">Eliminar</button>}</div></td></tr>)}{!rules.length && <tr><td colSpan="9" className="p-8 text-center text-sm font-semibold text-slate-500">No hay reglas guardadas.</td></tr>}</tbody></table></div>
    </div>;
}

function AgentConfiguration({ state, drafts, users }) {
    const errorCount = drafts.filter((draft) => draft.status === 'ERROR').length;
    const colorClass = { emerald: 'bg-emerald-500', sky: 'bg-sky-500', indigo: 'bg-indigo-500', amber: 'bg-amber-500', rose: 'bg-rose-500', slate: 'bg-slate-500' };
    const cards = [
        ['Webhook', state?.webhookHealthy === false ? 'Revisar' : 'Operativo', state?.webhookHealthy === false ? 'rose' : 'emerald'],
        ['IA OpenAI', state?.aiHealthy === false ? 'Revisar' : (state?.lastAiAt ? 'Operativa' : 'Sin prueba reciente'), state?.aiHealthy === false ? 'rose' : 'emerald'],
        ['Procesador', state?.processorHealthy === false ? 'Revisar' : 'Operativo', state?.processorHealthy === false ? 'rose' : 'sky'],
        ['Ultimo mensaje', formatDateTime(state?.lastReceivedAt), 'sky'],
        ['Ultima respuesta', formatDateTime(state?.lastSentAt), 'indigo'],
        ['Usuarios autorizados', String(users.filter((user) => user.active !== false).length), 'amber'],
        ['Errores recientes', String(errorCount), errorCount ? 'rose' : 'emerald'],
        ['Almacenamiento', 'Originales protegidos por SHA-256', 'slate'],
    ];
    return <div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([label, value, color]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className={`h-2 w-12 rounded-full ${colorClass[color]}`} /><div className="mt-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{label}</div><div className="mt-1 text-lg font-black text-slate-950">{value}</div></div>)}</div><div className="mt-5 rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white"><div className="text-xs font-black uppercase tracking-[0.2em] text-amber-400">Configuracion segura</div><p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-300">Los tokens de Meta, App Secret y OpenAI se administran en Firebase Secret Manager. Esta pantalla nunca muestra ni descarga secretos.</p></div></div>;
}

export default function AccountingAIAgent({ providers = [] }) {
    const [section, setSection] = useState('inbox');
    const [drafts, setDrafts] = useState([]);
    const [users, setUsers] = useState([]);
    const [rules, setRules] = useState([]);
    const [state, setState] = useState(null);
    const [accounts, setAccounts] = useState([]);
    const [selectedId, setSelectedId] = useState('');
    const [audit, setAudit] = useState([]);
    const [filter, setFilter] = useState('ALL');
    const [search, setSearch] = useState('');
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState(null);
    const master = isMasterEmail(auth.currentUser?.email);

    useEffect(() => {
        loadChartOfAccounts().then(setAccounts).catch((error) => setNotice({ type: 'error', text: error.message }));
        const unsubDrafts = onSnapshot(query(collection(db, 'agente_contable_borradores'), orderBy('updatedAt', 'desc'), limit(100)), (snapshot) => setDrafts(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))), (error) => setNotice({ type: 'error', text: `No se pudo cargar la bandeja: ${error.message}` }));
        const unsubUsers = master
            ? onSnapshot(collection(db, 'agente_contable_usuarios'), (snapshot) => setUsers(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))))
            : () => {};
        const unsubRules = onSnapshot(collection(db, 'agente_contable_reglas'), (snapshot) => setRules(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))));
        const unsubState = onSnapshot(doc(db, 'agente_contable_configuracion', 'estado'), (snapshot) => setState(snapshot.exists() ? snapshot.data() : null));
        return () => { unsubDrafts(); unsubUsers(); unsubRules(); unsubState(); };
    }, [master]);

    useEffect(() => {
        if (!selectedId) { setAudit([]); return undefined; }
        return onSnapshot(query(collection(db, 'agente_contable_auditoria'), where('draftId', '==', selectedId), limit(80)), (snapshot) => setAudit(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))));
    }, [selectedId]);

    const selected = drafts.find((draft) => draft.id === selectedId) || null;
    const visibleDrafts = useMemo(() => drafts.filter((draft) => {
        if (filter !== 'ALL' && draft.status !== filter) return false;
        const key = normalize([draft.proveedor, draft.numeroFactura, draft.descripcion, draft.senderName, draft.senderPhone, draft.categoria, draft.subcategoria].join(' '));
        return !search || key.includes(normalize(search));
    }), [drafts, filter, search]);
    const call = async (name, payload) => {
        setBusy(true); setNotice(null);
        try { const result = await httpsCallable(functions, name)(payload); return result.data; }
        catch (error) { setNotice({ type: 'error', text: error.message || 'No se pudo completar la operacion.' }); throw error; }
        finally { setBusy(false); }
    };
    const saveDraft = async (form) => {
        const ignored = new Set(['id', 'createdAt', 'updatedAt', 'originalAiAnalysis', 'duplicateCandidates']);
        const patch = Object.fromEntries(Object.entries(form).filter(([key]) => !ignored.has(key)));
        await call('updateAccountingAgentDraft', { draftId: form.id || form.draftId, patch });
        setNotice({ type: 'success', text: 'Correcciones guardadas y validadas.' });
    };
    const confirmDraft = async (draftId) => { await call('confirmAccountingAgentDraft', { draftId }); setNotice({ type: 'success', text: 'Registro contable creado correctamente.' }); setSelectedId(''); };
    const rejectDraft = async (draftId, reason) => { if (!window.confirm('¿Rechazar este borrador sin crear ninguna transaccion?')) return; await call('rejectAccountingAgentDraft', { draftId, reason }); setSelectedId(''); };
    const retry = async (eventId) => { await call('retryAccountingAgentItem', { eventId }); setNotice({ type: 'success', text: 'Mensaje enviado nuevamente a procesamiento.' }); };
    const saveUser = (form) => call('adminSaveAccountingAgentAuthorizedUser', form);
    const deleteUser = async (phone) => { if (window.confirm('¿Eliminar este numero autorizado?')) await call('adminDeleteAccountingAgentAuthorizedUser', { phone }); };
    const saveRule = (form) => call('adminSaveAccountingAgentRule', form);
    const deleteRule = async (rule) => { if (window.confirm(`¿Eliminar la regla de ${rule.provider}?`)) await call('adminDeleteAccountingAgentRule', { id: rule.id }); };
    const seedRules = async () => { await call('adminSeedAccountingAgentRules', {}); setNotice({ type: 'success', text: 'Reglas fijas inicializadas.' }); };

    const sections = [['inbox', 'Bandeja', 'inbox'], ...(master ? [['users', 'Usuarios autorizados', 'users'], ['rules', 'Reglas', 'rules'], ['settings', 'Configuracion', 'settings']] : [])];
    return (
        <div className="space-y-5">
            <section className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-slate-950 text-white shadow-xl shadow-slate-950/10">
                <div className="grid gap-5 p-5 sm:p-7 lg:grid-cols-[1fr_auto] lg:items-end">
                    <div><div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] text-amber-400"><AgentIcon className="h-4 w-4" /> Operacion asistida</div><h2 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">Agente Contable IA</h2><p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-300">WhatsApp recibe el soporte, la IA propone y el sistema valida. Nada se contabiliza sin confirmacion humana.</p></div>
                    <div className="grid grid-cols-3 gap-2 text-center"><div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3"><div className="text-xl font-black">{drafts.filter((item) => item.status === 'READY_FOR_CONFIRMATION').length}</div><div className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-400">Por confirmar</div></div><div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3"><div className="text-xl font-black">{drafts.filter((item) => item.status === 'NEEDS_INFORMATION').length}</div><div className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-400">Incompletos</div></div><div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3"><div className="text-xl font-black">{drafts.filter((item) => item.status === 'ERROR').length}</div><div className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-400">Errores</div></div></div>
                </div>
                <nav className="flex gap-1 overflow-x-auto border-t border-white/10 bg-white/[0.03] p-2">{sections.map(([id, label, icon]) => <button key={id} type="button" onClick={() => setSection(id)} className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-[0.14em] transition ${section === id ? 'bg-white text-slate-950' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}><AgentIcon type={icon} className="h-4 w-4" />{label}</button>)}</nav>
            </section>

            {notice && <div className={`rounded-xl border px-4 py-3 text-sm font-bold ${notice.type === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{notice.text}</div>}

            {section === 'inbox' && <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="flex gap-2 overflow-x-auto pb-1">{FILTERS.map(([id, label]) => <button key={id} type="button" onClick={() => setFilter(id)} className={`shrink-0 rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] transition ${filter === id ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{label}</button>)}</div><input value={search} onChange={(event) => setSearch(event.target.value)} className={`${inputClass} lg:max-w-xs`} placeholder="Buscar proveedor, factura, remitente..." /></div></div>
                <div className="divide-y divide-slate-100">{visibleDrafts.map((draft) => { const support = draft.soportes?.[0]; return <button key={draft.id} type="button" onClick={() => setSelectedId(draft.id)} className="grid w-full gap-3 px-4 py-4 text-left transition hover:bg-slate-50 sm:grid-cols-[56px_minmax(0,1.3fr)_minmax(0,.9fr)_auto] sm:items-center sm:px-5"><div className="h-14 w-14 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">{support?.url && !String(support.mimeType).includes('pdf') ? <img src={support.url} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-slate-400"><AgentIcon type="inbox" /></div>}</div><div className="min-w-0"><div className="truncate font-black text-slate-950">{draft.proveedor || 'Proveedor pendiente'}</div><div className="mt-1 truncate text-xs font-semibold text-slate-500">{draft.numeroFactura ? `Factura ${draft.numeroFactura}` : 'Sin numero'} · {draft.branchId || 'Sucursal pendiente'} · {draft.tipoRegistro || 'Por clasificar'}</div><div className="mt-1 truncate text-[11px] font-bold text-slate-400">{draft.categoria || 'Categoria pendiente'}{draft.subcategoria ? ` / ${draft.subcategoria}` : ''}</div></div><div><div className="text-lg font-black text-slate-950">{formatMoney(draft.total)}</div><div className="mt-1 text-xs font-semibold text-slate-500">{draft.fecha || 'Fecha pendiente'} · {draft.metodoPago || 'Metodo pendiente'}</div><div className="mt-1 text-[11px] font-bold text-slate-400">{draft.senderName || draft.senderPhone || 'WhatsApp'}</div></div><div className="flex sm:justify-end"><StatusBadge status={draft.status} /></div></button>; })}{!visibleDrafts.length && <div className="grid min-h-64 place-items-center p-8 text-center"><div><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400"><AgentIcon type="inbox" /></div><p className="mt-4 text-sm font-black text-slate-700">No hay documentos con este filtro.</p><p className="mt-1 text-xs font-semibold text-slate-500">Los mensajes autorizados apareceran aqui.</p></div></div>}</div>
            </section>}
            {section === 'users' && master && <AuthorizedUsers users={users} busy={busy} onSave={saveUser} onDelete={deleteUser} />}
            {section === 'rules' && master && <AgentRules rules={rules} busy={busy} onSave={saveRule} onDelete={deleteRule} onSeed={seedRules} />}
            {section === 'settings' && master && <AgentConfiguration state={state} drafts={drafts} users={users} />}

            <DraftDetail draft={selected} providers={providers} accounts={accounts} audit={audit} busy={busy} onClose={() => setSelectedId('')} onSave={saveDraft} onConfirm={confirmDraft} onReject={rejectDraft} onRetry={retry} />
        </div>
    );
}
