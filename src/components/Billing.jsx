import React, { useMemo, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { APP_BRAND_NAME, fmt } from '../constants';
import { buildFiscalPayload, uploadInvoicePhoto } from '../services/fiscalUtils';

const PAYMENT_BANKS = [
    { key: 'bac', label: 'BAC' },
    { key: 'banpro', label: 'Banpro' },
    { key: 'lafise', label: 'Lafise' },
];

const CASH_DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 1];

const safeNumber = (value) => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
};

const todayString = () => new Date().toISOString().substring(0, 10);

const normalizeText = (value = '') => (
    String(value || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
);

const slugify = (value = '') => (
    normalizeText(value)
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 20) || 'SIN-NOMBRE'
);

const getMonth = (date = '') => String(date || todayString()).substring(0, 7);

const getRecordDate = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value.substring(0, 10);
    if (value?.toDate) return value.toDate().toISOString().substring(0, 10);
    if (value instanceof Date) return value.toISOString().substring(0, 10);
    return String(value).substring(0, 10);
};

const emptyTransfer = () => ({ clientName: '', amount: '', reference: '' });
const emptyPos = () => ({ amount: '', reference: '' });

const Badge = ({ children, tone = 'slate' }) => {
    const tones = {
        slate: 'border-slate-200 bg-slate-50 text-slate-600',
        red: 'border-red-200 bg-red-50 text-red-700',
        green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        amber: 'border-amber-200 bg-amber-50 text-amber-700',
        blue: 'border-sky-200 bg-sky-50 text-sky-700',
    };

    return (
        <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] ${tones[tone] || tones.slate}`}>
            {children}
        </span>
    );
};

const Field = ({ label, children, span = '' }) => (
    <label className={`block ${span}`}>
        <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{label}</span>
        {children}
    </label>
);

const inputClass = 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none transition focus:border-[#e30613] focus:ring-4 focus:ring-red-100';

const Section = ({ title, eyebrow, action, children }) => (
    <section className="overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
                {eyebrow && <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#e30613]">{eyebrow}</div>}
                <h2 className="text-lg font-black text-slate-950">{title}</h2>
            </div>
            {action}
        </div>
        <div className="p-5">{children}</div>
    </section>
);

const SummaryCard = ({ label, value, tone = 'slate' }) => {
    const styles = {
        slate: 'border-slate-200 bg-white text-slate-950',
        red: 'border-red-200 bg-red-50 text-red-800',
        green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        amber: 'border-amber-200 bg-amber-50 text-amber-800',
        blue: 'border-sky-200 bg-sky-50 text-sky-800',
    };

    return (
        <div className={`rounded-2xl border p-4 shadow-sm ${styles[tone] || styles.slate}`}>
            <div className="text-[10px] font-black uppercase tracking-[0.24em] opacity-60">{label}</div>
            <div className="mt-1 font-mono text-xl font-black">{value}</div>
        </div>
    );
};

const DetailRows = ({ title, rows, onChange, onAdd, onRemove, type, clients = [] }) => (
    <div className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
            <div>
                <div className="text-sm font-black text-slate-950">{title}</div>
                <div className="text-xs font-semibold text-slate-500">
                    {type === 'transfer' ? 'Detalle por cliente y referencia bancaria.' : 'Detalle por cierre POS y referencia.'}
                </div>
            </div>
            <button type="button" onClick={onAdd} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white transition hover:bg-[#e30613]">
                Agregar
            </button>
        </div>

        <div className="space-y-2">
            {rows.map((row, index) => (
                <div key={`${title}-${index}`} className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 md:grid-cols-[1.4fr_1fr_1fr_auto]">
                    {type === 'transfer' ? (
                        <input
                            className={inputClass}
                            list="billing-clients"
                            placeholder="Cliente"
                            value={row.clientName}
                            onChange={(event) => onChange(index, 'clientName', event.target.value)}
                        />
                    ) : (
                        <input
                            className={inputClass}
                            placeholder="Cierre POS / lote"
                            value={row.reference}
                            onChange={(event) => onChange(index, 'reference', event.target.value)}
                        />
                    )}
                    <input
                        className={inputClass}
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="Monto"
                        value={row.amount}
                        onChange={(event) => onChange(index, 'amount', event.target.value)}
                    />
                    {type === 'transfer' ? (
                        <input
                            className={inputClass}
                            placeholder="Referencia"
                            value={row.reference}
                            onChange={(event) => onChange(index, 'reference', event.target.value)}
                        />
                    ) : (
                        <div className="flex items-center rounded-2xl border border-slate-200 bg-slate-50 px-4 text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                            POS
                        </div>
                    )}
                    <button type="button" onClick={() => onRemove(index)} className="rounded-xl border border-red-200 px-3 py-2 text-xs font-black text-red-700 transition hover:bg-red-50">
                        Quitar
                    </button>
                </div>
            ))}
            {rows.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-center text-sm font-bold text-slate-400">
                    Sin detalle todavia.
                </div>
            )}
        </div>
        <datalist id="billing-clients">
            {clients.map((client) => (
                <option key={client.id || client.code || client.name} value={client.name || client.nombre || ''} />
            ))}
        </datalist>
    </div>
);

function CashClosure({ data }) {
    const sicarClosures = useMemo(() => (
        [...(data.sicar_cierres_caja || [])]
            .map((item) => ({ ...item, date: item.date || getRecordDate(item.closureDateTime || item.fecha) }))
            .sort((a, b) => String(b.closureDateTime || b.fecha || b.date).localeCompare(String(a.closureDateTime || a.fecha || a.date)))
    ), [data.sicar_cierres_caja]);

    const stampedInvoices = useMemo(() => (
        [...(data.facturas_membretadas_ventas || [])]
            .map((item) => ({
                ...item,
                date: item.saleDate || item.date || '',
                invoiceNumber: item.numeroFactura || item.invoiceNumber || '',
                retentionTotal: safeNumber(item.retentionTotal ?? (safeNumber(item.retentionIr2) + safeNumber(item.retentionMunicipal1))),
            }))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    ), [data.facturas_membretadas_ventas]);

    const clients = useMemo(() => (
        [...(data.clientes_facturacion || [])]
            .map((item) => ({ ...item, name: item.name || item.nombre || '' }))
            .filter((item) => item.name)
            .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    ), [data.clientes_facturacion]);

    const cashiers = useMemo(() => (
        [...(data.cajeros || [])]
            .map((item) => ({ ...item, name: item.name || item.nombre || '' }))
            .filter((item) => item.name)
            .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    ), [data.cajeros]);

    const [selectedClosureId, setSelectedClosureId] = useState('');
    const [closureDate, setClosureDate] = useState(todayString());
    const [cashierName, setCashierName] = useState('');
    const [cashCount, setCashCount] = useState({});
    const [transfers, setTransfers] = useState({ bac: [], banpro: [], lafise: [] });
    const [posDetails, setPosDetails] = useState({ bac: [], banpro: [], lafise: [] });
    const [selectedInvoiceIds, setSelectedInvoiceIds] = useState([]);
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');

    const selectedClosure = useMemo(() => (
        sicarClosures.find((closure) => closure.id === selectedClosureId) || null
    ), [selectedClosureId, sicarClosures]);

    const selectedInvoices = useMemo(() => (
        stampedInvoices.filter((invoice) => selectedInvoiceIds.includes(invoice.id))
    ), [selectedInvoiceIds, stampedInvoices]);

    const cashTotal = useMemo(() => (
        CASH_DENOMINATIONS.reduce((sum, denomination) => sum + denomination * safeNumber(cashCount[denomination]), 0)
    ), [cashCount]);

    const transferTotals = useMemo(() => Object.fromEntries(PAYMENT_BANKS.map(({ key }) => [
        key,
        safeNumber((transfers[key] || []).reduce((sum, item) => sum + safeNumber(item.amount), 0)),
    ])), [transfers]);

    const posTotals = useMemo(() => Object.fromEntries(PAYMENT_BANKS.map(({ key }) => [
        key,
        safeNumber((posDetails[key] || []).reduce((sum, item) => sum + safeNumber(item.amount), 0)),
    ])), [posDetails]);

    const manualTotal = safeNumber(
        cashTotal
        + Object.values(transferTotals).reduce((sum, value) => sum + value, 0)
        + Object.values(posTotals).reduce((sum, value) => sum + value, 0)
    );
    const retentionTotal = safeNumber(selectedInvoices.reduce((sum, invoice) => sum + safeNumber(invoice.retentionTotal), 0));
    const sicarExpected = safeNumber(selectedClosure?.calculatedTotal ?? selectedClosure?.calculado ?? selectedClosure?.totalDineroIngresado);
    const expectedAfterRetentions = safeNumber(sicarExpected - retentionTotal);
    const difference = safeNumber(manualTotal - expectedAfterRetentions);

    const loadClosure = (closure) => {
        setSelectedClosureId(closure.id);
        setClosureDate(closure.date || getRecordDate(closure.closureDateTime || closure.fecha) || todayString());
        setMessage(`Cargado ${closure.cashboxName || closure.cajaName || 'cierre SICAR'} ${closure.corId || closure.cor_id || ''}.`);
    };

    const updateTransfer = (bank, index, field, value) => {
        setTransfers((prev) => ({
            ...prev,
            [bank]: (prev[bank] || []).map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)),
        }));
    };

    const updatePos = (bank, index, field, value) => {
        setPosDetails((prev) => ({
            ...prev,
            [bank]: (prev[bank] || []).map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)),
        }));
    };

    const ensurePeopleRecords = async () => {
        const touchedClients = new Set();
        Object.values(transfers).flat().forEach((row) => {
            const name = String(row.clientName || '').trim();
            if (name) touchedClients.add(name);
        });

        await Promise.all([...touchedClients].map((name) => {
            const code = `CLI-${slugify(name)}`;
            return setDoc(doc(db, 'clientes_facturacion', code), {
                code,
                name,
                normalizedName: normalizeText(name),
                source: 'cierre_caja',
                updatedAt: serverTimestamp(),
                createdAt: serverTimestamp(),
            }, { merge: true });
        }));

        const safeCashierName = String(cashierName || '').trim();
        if (safeCashierName) {
            const cashierCode = `CAJ-${slugify(safeCashierName)}`;
            await setDoc(doc(db, 'cajeros', cashierCode), {
                code: cashierCode,
                name: safeCashierName,
                normalizedName: normalizeText(safeCashierName),
                updatedAt: serverTimestamp(),
                createdAt: serverTimestamp(),
            }, { merge: true });
        }
    };

    const saveClosure = async () => {
        setSaving(true);
        setMessage('');
        try {
            await ensurePeopleRecords();
            const cashierCode = cashierName ? `CAJ-${slugify(cashierName)}` : '';
            const docId = selectedClosure?.corId
                ? `cierre_${closureDate}_${selectedClosure.corId}`
                : `cierre_${closureDate}_${Date.now()}`;

            const payload = {
                date: closureDate,
                month: getMonth(closureDate),
                status: Math.abs(difference) > 0.01 ? 'con_diferencia' : 'cuadrado',
                cashierName: cashierName || '',
                cashierCode,
                linkedSicarClosureId: selectedClosure?.id || '',
                linkedSicarCorId: selectedClosure?.corId || selectedClosure?.cor_id || null,
                linkedSicarRccId: selectedClosure?.rccId || selectedClosure?.rcc_id || null,
                sicar: selectedClosure || null,
                sicarExpected,
                retentionAdjustment: retentionTotal,
                expectedAfterRetentions,
                cashCount,
                cashTotal: safeNumber(cashTotal),
                transferDetails: transfers,
                transferTotals,
                posDetails,
                posTotals,
                manualTotal,
                difference,
                stampedInvoiceIds: selectedInvoiceIds,
                stampedInvoices: selectedInvoices.map((invoice) => ({
                    id: invoice.id,
                    invoiceNumber: invoice.invoiceNumber,
                    total: safeNumber(invoice.total),
                    retentionTotal: safeNumber(invoice.retentionTotal),
                })),
                notes,
                source: 'manual_app',
                sourceType: 'cash_closure',
                updatedAt: serverTimestamp(),
                createdAt: serverTimestamp(),
            };

            await setDoc(doc(db, 'cierres_caja', docId), payload, { merge: true });

            if (cashierCode && Math.abs(difference) > 0.01) {
                await setDoc(doc(db, 'diferencias_caja', `${docId}_${cashierCode}`), {
                    closureId: docId,
                    date: closureDate,
                    month: getMonth(closureDate),
                    cashierName,
                    cashierCode,
                    amount: difference,
                    status: 'pendiente',
                    source: 'cierre_caja',
                    updatedAt: serverTimestamp(),
                    createdAt: serverTimestamp(),
                }, { merge: true });
            }

            setMessage('Cierre guardado con detalle completo.');
        } catch (error) {
            console.error(error);
            setMessage(error?.message || 'No se pudo guardar el cierre.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="grid gap-5 xl:grid-cols-[0.9fr_1.3fr]">
            <Section
                title="Cierres SICAR disponibles"
                eyebrow="Integracion"
                action={<Badge tone="blue">{sicarClosures.length} cierres</Badge>}
            >
                <div className="max-h-[34rem] space-y-3 overflow-y-auto pr-1">
                    {sicarClosures.length === 0 ? (
                        <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-center text-sm font-bold text-slate-400">
                            Aun no hay cierres sincronizados. Ejecuta el worker de facturacion para cargar SICAR.
                        </div>
                    ) : sicarClosures.map((closure) => (
                        <button
                            key={closure.id}
                            type="button"
                            onClick={() => loadClosure(closure)}
                            onDoubleClick={() => loadClosure(closure)}
                            className={`w-full rounded-3xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lg ${
                                selectedClosureId === closure.id
                                    ? 'border-[#e30613] bg-red-50 shadow-red-950/10'
                                    : 'border-slate-200 bg-white hover:border-slate-300'
                            }`}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="text-sm font-black text-slate-950">{closure.cashboxName || closure.cajaName || `Caja ${closure.cashboxId || ''}`}</div>
                                    <div className="text-xs font-bold text-slate-500">{closure.date} · Corte {closure.corId || closure.cor_id}</div>
                                </div>
                                <div className="font-mono text-sm font-black text-[#e30613]">{fmt(closure.calculatedTotal ?? closure.calculado ?? 0)}</div>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-500">
                                <span>Ventas contado: {fmt(closure.cashSalesTotal ?? closure.ventasContado ?? 0)}</span>
                                <span>Recup. credito: {fmt(closure.creditRecoveryTotal ?? closure.recuperacionCredito ?? 0)}</span>
                                <span>Diferencia SICAR: {fmt(closure.sicarDifference ?? closure.diferencia ?? 0)}</span>
                                <span>RCC: {closure.rccId || closure.rcc_id || '-'}</span>
                            </div>
                        </button>
                    ))}
                </div>
            </Section>

            <div className="space-y-5">
                <Section title="Cierre de caja" eyebrow="Formulario operativo" action={<Badge tone={Math.abs(difference) > 0.01 ? 'red' : 'green'}>{Math.abs(difference) > 0.01 ? 'Con diferencia' : 'Cuadrado'}</Badge>}>
                    <div className="grid gap-4 md:grid-cols-3">
                        <Field label="Fecha de cierre">
                            <input className={inputClass} type="date" value={closureDate} onChange={(event) => setClosureDate(event.target.value)} />
                        </Field>
                        <Field label="Cajero">
                            <input className={inputClass} list="billing-cashiers" placeholder="Nombre del cajero" value={cashierName} onChange={(event) => setCashierName(event.target.value)} />
                            <datalist id="billing-cashiers">
                                {cashiers.map((cashier) => <option key={cashier.id || cashier.code || cashier.name} value={cashier.name} />)}
                            </datalist>
                        </Field>
                        <Field label="Cierre SICAR">
                            <select className={inputClass} value={selectedClosureId} onChange={(event) => setSelectedClosureId(event.target.value)}>
                                <option value="">Sin cargar</option>
                                {sicarClosures.map((closure) => (
                                    <option key={closure.id} value={closure.id}>
                                        {closure.date} · {closure.cashboxName || closure.cajaName} · {closure.corId || closure.cor_id}
                                    </option>
                                ))}
                            </select>
                        </Field>
                    </div>

                    <div className="mt-5 grid gap-3 md:grid-cols-4">
                        <SummaryCard label="SICAR esperado" value={fmt(sicarExpected)} tone="blue" />
                        <SummaryCard label="Retenciones membretadas" value={fmt(retentionTotal)} tone="amber" />
                        <SummaryCard label="Total contado app" value={fmt(manualTotal)} tone="slate" />
                        <SummaryCard label="Diferencia" value={fmt(difference)} tone={Math.abs(difference) > 0.01 ? 'red' : 'green'} />
                    </div>

                    <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                        <div className="mb-3 flex items-center justify-between">
                            <div>
                                <div className="text-sm font-black text-slate-950">Contador de dinero contado</div>
                                <div className="text-xs font-semibold text-slate-500">Ingresa cantidad de billetes/monedas; el total se calcula solo.</div>
                            </div>
                            <div className="font-mono text-xl font-black text-slate-950">{fmt(cashTotal)}</div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
                            {CASH_DENOMINATIONS.map((denomination) => (
                                <label key={denomination} className="rounded-2xl border border-slate-200 bg-white p-3">
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">C$ {denomination}</span>
                                    <input
                                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-black outline-none focus:border-[#e30613]"
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={cashCount[denomination] || ''}
                                        onChange={(event) => setCashCount((prev) => ({ ...prev, [denomination]: event.target.value }))}
                                    />
                                </label>
                            ))}
                        </div>
                    </div>
                </Section>

                <Section title="Transferencias por cliente" eyebrow="Detalle bancario">
                    <div className="grid gap-4">
                        {PAYMENT_BANKS.map((bank) => (
                            <DetailRows
                                key={bank.key}
                                title={`Transferencia ${bank.label} · ${fmt(transferTotals[bank.key])}`}
                                rows={transfers[bank.key] || []}
                                type="transfer"
                                clients={clients}
                                onAdd={() => setTransfers((prev) => ({ ...prev, [bank.key]: [...(prev[bank.key] || []), emptyTransfer()] }))}
                                onRemove={(index) => setTransfers((prev) => ({ ...prev, [bank.key]: (prev[bank.key] || []).filter((_, rowIndex) => rowIndex !== index) }))}
                                onChange={(index, field, value) => updateTransfer(bank.key, index, field, value)}
                            />
                        ))}
                    </div>
                </Section>

                <Section title="Cierres POS" eyebrow="Baucher / lote POS">
                    <div className="grid gap-4">
                        {PAYMENT_BANKS.map((bank) => (
                            <DetailRows
                                key={bank.key}
                                title={`POS ${bank.label} · ${fmt(posTotals[bank.key])}`}
                                rows={posDetails[bank.key] || []}
                                type="pos"
                                onAdd={() => setPosDetails((prev) => ({ ...prev, [bank.key]: [...(prev[bank.key] || []), emptyPos()] }))}
                                onRemove={(index) => setPosDetails((prev) => ({ ...prev, [bank.key]: (prev[bank.key] || []).filter((_, rowIndex) => rowIndex !== index) }))}
                                onChange={(index, field, value) => updatePos(bank.key, index, field, value)}
                            />
                        ))}
                    </div>
                </Section>

                <Section title="Facturas membretadas del cierre" eyebrow="Retenciones que reducen caja">
                    <div className="grid gap-3 md:grid-cols-2">
                        {stampedInvoices.length === 0 ? (
                            <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-center text-sm font-bold text-slate-400 md:col-span-2">
                                No hay facturas membretadas guardadas todavia.
                            </div>
                        ) : stampedInvoices.slice(0, 24).map((invoice) => (
                            <label key={invoice.id} className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 transition hover:border-[#e30613]">
                                <input
                                    type="checkbox"
                                    checked={selectedInvoiceIds.includes(invoice.id)}
                                    onChange={(event) => {
                                        setSelectedInvoiceIds((prev) => event.target.checked
                                            ? [...prev, invoice.id]
                                            : prev.filter((id) => id !== invoice.id));
                                    }}
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-black text-slate-950">Factura {invoice.invoiceNumber || '-'}</div>
                                    <div className="text-xs font-bold text-slate-500">{invoice.date} · Ret. {fmt(invoice.retentionTotal)}</div>
                                </div>
                                <div className="font-mono text-sm font-black text-slate-900">{fmt(invoice.total)}</div>
                            </label>
                        ))}
                    </div>

                    <textarea
                        className={`${inputClass} mt-4 min-h-24`}
                        placeholder="Notas internas del cierre..."
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                    />

                    {message && <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-700">{message}</div>}

                    <button type="button" onClick={saveClosure} disabled={saving} className="mt-4 w-full rounded-2xl bg-[#e30613] px-5 py-4 text-sm font-black uppercase tracking-[0.2em] text-white shadow-lg shadow-red-950/20 transition hover:bg-[#9f111a] disabled:cursor-not-allowed disabled:opacity-60">
                        {saving ? 'Guardando cierre...' : 'Guardar cierre de caja'}
                    </button>
                </Section>
            </div>
        </div>
    );
}

function StampedInvoices({ data }) {
    const sicarInvoices = useMemo(() => (
        [...(data.sicar_facturas_membretadas || [])]
            .map((item) => ({
                ...item,
                date: item.date || getRecordDate(item.fecha || item.invoiceDate),
                invoiceNumber: item.numeroFactura || item.invoiceNumber || item.folio || '',
            }))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    ), [data.sicar_facturas_membretadas]);

    const savedInvoices = useMemo(() => (
        [...(data.facturas_membretadas_ventas || [])]
            .map((item) => ({ ...item, date: item.saleDate || item.date || '', invoiceNumber: item.numeroFactura || item.invoiceNumber || '' }))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    ), [data.facturas_membretadas_ventas]);

    const [form, setForm] = useState({
        date: todayString(),
        invoiceNumber: '',
        customerName: '',
        subtotal: '',
        iva: '',
        total: '',
        retentionIr2: '',
        retentionMunicipal1: '',
        paymentMethod: '',
        sourceSicarInvoiceId: '',
    });
    const [supportFile, setSupportFile] = useState(null);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');

    const fiscal = buildFiscalPayload({
        subtotal: safeNumber(form.subtotal),
        iva: safeNumber(form.iva),
        total: safeNumber(form.total) || safeNumber(form.subtotal) + safeNumber(form.iva),
        retentionIr2: safeNumber(form.retentionIr2),
        retentionMunicipal1: safeNumber(form.retentionMunicipal1),
    });

    const update = (key, value) => {
        setForm((prev) => {
            const next = { ...prev, [key]: value };
            if (key === 'subtotal' || key === 'iva') {
                next.total = String(safeNumber(next.subtotal) + safeNumber(next.iva));
            }
            return next;
        });
    };

    const loadSicarInvoice = (invoice) => {
        setForm({
            date: invoice.date || todayString(),
            invoiceNumber: invoice.invoiceNumber || '',
            customerName: invoice.customerName || invoice.cliente || '',
            subtotal: String(safeNumber(invoice.subtotal)),
            iva: String(safeNumber(invoice.iva)),
            total: String(safeNumber(invoice.total)),
            retentionIr2: '',
            retentionMunicipal1: '',
            paymentMethod: invoice.paymentMethod || '',
            sourceSicarInvoiceId: invoice.id || '',
        });
        setMessage(`Factura SICAR ${invoice.invoiceNumber || invoice.id} cargada para completar retenciones.`);
    };

    const saveInvoice = async (event) => {
        event.preventDefault();
        setSaving(true);
        setMessage('');
        try {
            if (!form.invoiceNumber.trim()) throw new Error('Ingresa el numero de factura.');
            if (!safeNumber(form.subtotal) && !safeNumber(form.total)) throw new Error('Ingresa subtotal o total.');

            const docId = `membretada_${slugify(form.invoiceNumber)}_${form.date.replace(/-/g, '')}`;
            const supportPayload = supportFile
                ? await uploadInvoicePhoto(supportFile, 'facturacion/facturas_membretadas', docId)
                : {};

            await setDoc(doc(db, 'facturas_membretadas_ventas', docId), {
                date: form.date,
                saleDate: form.date,
                month: getMonth(form.date),
                numeroFactura: form.invoiceNumber.trim(),
                invoiceNumber: form.invoiceNumber.trim(),
                customerName: form.customerName.trim(),
                paymentMethod: form.paymentMethod.trim(),
                ...fiscal,
                source: form.sourceSicarInvoiceId ? 'sicar_factura' : 'manual',
                sourceType: 'stamped_sale_invoice',
                sourceSicarInvoiceId: form.sourceSicarInvoiceId || '',
                status: 'active',
                ...supportPayload,
                updatedAt: serverTimestamp(),
                createdAt: serverTimestamp(),
            }, { merge: true });

            setMessage('Factura membretada guardada e integrada al reporte tributario.');
            setSupportFile(null);
            setForm({
                date: todayString(),
                invoiceNumber: '',
                customerName: '',
                subtotal: '',
                iva: '',
                total: '',
                retentionIr2: '',
                retentionMunicipal1: '',
                paymentMethod: '',
                sourceSicarInvoiceId: '',
            });
        } catch (error) {
            console.error(error);
            setMessage(error?.message || 'No se pudo guardar la factura membretada.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
            <Section
                title="Nueva factura membretada"
                eyebrow="Retenciones fiscales"
                action={<Badge tone="green">Reporte tributario</Badge>}
            >
                <form onSubmit={saveInvoice} className="space-y-5">
                    <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Fecha">
                            <input className={inputClass} type="date" value={form.date} onChange={(event) => update('date', event.target.value)} required />
                        </Field>
                        <Field label="Numero de factura">
                            <input className={inputClass} value={form.invoiceNumber} onChange={(event) => update('invoiceNumber', event.target.value)} required />
                        </Field>
                        <Field label="Cliente">
                            <input className={inputClass} value={form.customerName} onChange={(event) => update('customerName', event.target.value)} placeholder="Cliente / razon social" />
                        </Field>
                        <Field label="Metodo de pago">
                            <input className={inputClass} value={form.paymentMethod} onChange={(event) => update('paymentMethod', event.target.value)} placeholder="Transferencia, POS, efectivo..." />
                        </Field>
                        <Field label="Subtotal">
                            <input className={inputClass} type="number" step="0.01" min="0" value={form.subtotal} onChange={(event) => update('subtotal', event.target.value)} required />
                        </Field>
                        <Field label="IVA">
                            <input className={inputClass} type="number" step="0.01" min="0" value={form.iva} onChange={(event) => update('iva', event.target.value)} />
                        </Field>
                        <Field label="Total">
                            <input className={inputClass} type="number" step="0.01" min="0" value={form.total} onChange={(event) => update('total', event.target.value)} required />
                        </Field>
                        <Field label="Retencion anticipo IR 2%">
                            <input className={inputClass} type="number" step="0.01" min="0" value={form.retentionIr2} onChange={(event) => update('retentionIr2', event.target.value)} />
                        </Field>
                        <Field label="Retencion municipal 1%">
                            <input className={inputClass} type="number" step="0.01" min="0" value={form.retentionMunicipal1} onChange={(event) => update('retentionMunicipal1', event.target.value)} />
                        </Field>
                        <Field label="Soporte foto / PDF">
                            <input className={inputClass} type="file" accept="image/*,application/pdf" onChange={(event) => setSupportFile(event.target.files?.[0] || null)} />
                        </Field>
                    </div>

                    <div className="grid gap-3 md:grid-cols-4">
                        <SummaryCard label="Subtotal" value={fmt(fiscal.subtotal)} />
                        <SummaryCard label="IVA" value={fmt(fiscal.iva)} tone="blue" />
                        <SummaryCard label="Total" value={fmt(fiscal.total)} tone="green" />
                        <SummaryCard label="Retenciones" value={fmt(fiscal.retentionTotal)} tone="amber" />
                    </div>

                    {message && <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-700">{message}</div>}

                    <button type="submit" disabled={saving} className="w-full rounded-2xl bg-[#e30613] px-5 py-4 text-sm font-black uppercase tracking-[0.2em] text-white shadow-lg shadow-red-950/20 transition hover:bg-[#9f111a] disabled:cursor-not-allowed disabled:opacity-60">
                        {saving ? 'Guardando...' : 'Guardar factura membretada'}
                    </button>
                </form>
            </Section>

            <div className="space-y-5">
                <Section title="Facturas SICAR para cargar" eyebrow="Lectura MySQL" action={<Badge tone="blue">{sicarInvoices.length} registros</Badge>}>
                    <div className="max-h-80 space-y-2 overflow-y-auto">
                        {sicarInvoices.length === 0 ? (
                            <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-center text-sm font-bold text-slate-400">
                                No hay facturas SICAR sincronizadas en este rango.
                            </div>
                        ) : sicarInvoices.slice(0, 30).map((invoice) => (
                            <button key={invoice.id} type="button" onClick={() => loadSicarInvoice(invoice)} className="w-full rounded-2xl border border-slate-200 bg-white p-3 text-left transition hover:border-[#e30613] hover:bg-red-50">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-black text-slate-950">Factura {invoice.invoiceNumber || '-'}</div>
                                        <div className="text-xs font-bold text-slate-500">{invoice.date} · {invoice.customerName || invoice.cliente || 'Sin cliente'}</div>
                                    </div>
                                    <div className="font-mono text-sm font-black text-slate-900">{fmt(invoice.total)}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                </Section>

                <Section title="Guardadas" eyebrow="Facturas membretadas" action={<Badge tone="green">{savedInvoices.length} registros</Badge>}>
                    <div className="max-h-80 space-y-2 overflow-y-auto">
                        {savedInvoices.length === 0 ? (
                            <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-center text-sm font-bold text-slate-400">
                                Todavia no hay facturas membretadas guardadas.
                            </div>
                        ) : savedInvoices.slice(0, 30).map((invoice) => (
                            <div key={invoice.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-black text-slate-950">Factura {invoice.invoiceNumber || '-'}</div>
                                        <div className="text-xs font-bold text-slate-500">{invoice.date} · Ret. {fmt(invoice.retentionTotal || 0)}</div>
                                    </div>
                                    <div className="font-mono text-sm font-black text-slate-900">{fmt(invoice.total)}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </Section>
            </div>
        </div>
    );
}

function CashDifferences({ data }) {
    const differences = useMemo(() => (
        [...(data.diferencias_caja || [])]
            .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    ), [data.diferencias_caja]);

    const byCashier = useMemo(() => {
        const map = new Map();
        differences.forEach((item) => {
            const key = item.cashierCode || item.cashierName || 'SIN-CAJERO';
            const current = map.get(key) || { cashierName: item.cashierName || 'Sin cajero', amount: 0, count: 0 };
            current.amount = safeNumber(current.amount + safeNumber(item.amount));
            current.count += 1;
            map.set(key, current);
        });
        return [...map.values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    }, [differences]);

    return (
        <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
            <Section title="Saldo por cajero" eyebrow="Diferencias de caja" action={<Badge tone="red">{byCashier.length} cajeros</Badge>}>
                <div className="space-y-3">
                    {byCashier.length === 0 ? (
                        <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-center text-sm font-bold text-slate-400">
                            No hay diferencias pendientes.
                        </div>
                    ) : byCashier.map((item) => (
                        <div key={item.cashierName} className="rounded-2xl border border-slate-200 bg-white p-4">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-sm font-black text-slate-950">{item.cashierName}</div>
                                    <div className="text-xs font-bold text-slate-500">{item.count} cierre(s)</div>
                                </div>
                                <div className="font-mono text-lg font-black text-red-700">{fmt(item.amount)}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </Section>

            <Section title="Movimientos" eyebrow="Auditoria">
                <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                        <thead>
                            <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                                <th className="py-3 pr-4">Fecha</th>
                                <th className="py-3 pr-4">Cajero</th>
                                <th className="py-3 pr-4">Estado</th>
                                <th className="py-3 text-right">Monto</th>
                            </tr>
                        </thead>
                        <tbody>
                            {differences.map((item) => (
                                <tr key={item.id} className="border-b border-slate-100">
                                    <td className="py-3 pr-4 font-bold text-slate-700">{item.date || '-'}</td>
                                    <td className="py-3 pr-4 font-black text-slate-950">{item.cashierName || 'Sin cajero'}</td>
                                    <td className="py-3 pr-4"><Badge tone={item.status === 'pendiente' ? 'red' : 'green'}>{item.status || 'pendiente'}</Badge></td>
                                    <td className="py-3 text-right font-mono font-black text-red-700">{fmt(item.amount)}</td>
                                </tr>
                            ))}
                            {differences.length === 0 && (
                                <tr>
                                    <td className="py-10 text-center text-sm font-bold text-slate-400" colSpan="4">Sin movimientos.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Section>
        </div>
    );
}

function ComingSoon() {
    return (
        <Section title="Depositos bancarios" eyebrow="Proximamente" action={<Badge tone="amber">En diseno</Badge>}>
            <div className="rounded-[2rem] border border-dashed border-amber-300 bg-amber-50 p-10 text-center">
                <div className="text-4xl font-black text-amber-600">PROXIMAMENTE</div>
                <p className="mx-auto mt-3 max-w-xl text-sm font-semibold text-amber-800">
                    Este espacio quedo reservado para formalizar depositos bancarios y conciliarlos con cierres de caja.
                </p>
            </div>
        </Section>
    );
}

export default function Billing({ data = {} }) {
    const [activeTab, setActiveTab] = useState('cierre');

    const tabs = [
        { key: 'cierre', label: 'Cierre de caja' },
        { key: 'membretadas', label: 'Facturas membretadas' },
        { key: 'diferencias', label: 'Diferencias de caja' },
        { key: 'depositos', label: 'Depositos bancarios' },
    ];

    return (
        <div className="space-y-5">
            <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
                <div className="command-register-header px-5 py-5 sm:px-6">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.38em] text-[#e30613]">{APP_BRAND_NAME}</div>
                            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Facturacion</h1>
                            <p className="mt-1 max-w-2xl text-sm font-semibold text-slate-500">
                                Cierres de caja, facturas membretadas, retenciones y respaldo fiscal.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Badge tone="green">SICAR</Badge>
                            <Badge tone="blue">Caja</Badge>
                            <Badge tone="amber">Retenciones</Badge>
                        </div>
                    </div>
                </div>

                <div className="border-t border-slate-200 p-3">
                    <div className="flex flex-wrap gap-1.5">
                        {tabs.map((tab) => (
                            <button
                                key={tab.key}
                                type="button"
                                onClick={() => setActiveTab(tab.key)}
                                className={`rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-wide transition-all ${
                                    activeTab === tab.key
                                        ? 'bg-[#e30613] text-white shadow-sm shadow-red-900/20'
                                        : 'text-stone-600 hover:bg-stone-100'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>
            </section>

            {activeTab === 'cierre' && <CashClosure data={data} />}
            {activeTab === 'membretadas' && <StampedInvoices data={data} />}
            {activeTab === 'diferencias' && <CashDifferences data={data} />}
            {activeTab === 'depositos' && <ComingSoon />}
        </div>
    );
}
