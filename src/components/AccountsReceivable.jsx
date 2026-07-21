import React, { useEffect, useMemo, useState } from 'react';
import {
    APP_BRAND_LOGO,
    APP_BRAND_NAME,
    BRANCHES,
    CONSOLIDATED_BRANCH_ID,
    DEFAULT_BRANCH_ID,
    fmt,
    getBranchById,
    getRecordBranchId,
} from '../constants';

const normalizeText = (value = '') => (
    String(value || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
);

const escapeHtml = (value = '') => (
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
);

const safeNumber = (value = 0) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const normalized = String(value ?? '')
        .replace(/C\$/gi, '')
        .replace(/,/g, '')
        .trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
};

const todayString = () => new Date().toISOString().substring(0, 10);

const getMonth = (date = '') => String(date || todayString()).substring(0, 7);

const getInvoicePaymentTargetAmount = (invoice = {}) => {
    const total = safeNumber(invoice.total || safeNumber(invoice.subtotal) + safeNumber(invoice.iva));
    const retentions = safeNumber(invoice.retentionTotal ?? (safeNumber(invoice.retentionIr2) + safeNumber(invoice.retentionMunicipal1)));
    const net = safeNumber(total - retentions);
    return net > 0 ? net : total;
};

const getCreditOriginalAmount = (invoice = {}) => {
    const stored = invoice.creditOriginalAmount ?? invoice.originalCreditAmount ?? invoice.montoCredito ?? invoice.creditAmount;
    return stored !== undefined && stored !== null && stored !== ''
        ? safeNumber(stored)
        : getInvoicePaymentTargetAmount(invoice);
};

const getCreditPaidAmount = (invoice = {}) => safeNumber(
    invoice.creditPaidAmount
    ?? invoice.montoCobradoCredito
    ?? invoice.creditCollectedAmount
);

const getCreditBalance = (invoice = {}) => {
    const stored = invoice.creditBalance ?? invoice.saldoCredito;
    if (stored !== undefined && stored !== null && stored !== '') return safeNumber(Math.max(safeNumber(stored), 0));
    return safeNumber(Math.max(getCreditOriginalAmount(invoice) - getCreditPaidAmount(invoice), 0));
};

const getCreditStatus = (invoice = {}) => {
    const normalized = normalizeText(invoice.creditStatus || invoice.creditStatusLabel || invoice.estadoCredito);
    if (normalized.includes('PARCIAL')) return 'Parcial';
    if (normalized.includes('PENDIENT')) return 'Pendiente';
    if (getCreditPaidAmount(invoice) > 0.01) return 'Parcial';
    return 'Pendiente';
};

const getCustomerName = (invoice = {}) => (
    invoice.customerName || invoice.cliente || invoice.recibiDe || 'Cliente sin nombre'
);

const getInvoiceDate = (invoice = {}) => (
    invoice.saleDate || invoice.date || invoice.fecha || ''
);

const getInvoiceDueDate = (invoice = {}) => (
    invoice.dueDate || invoice.vencimiento || invoice.fechaVencimiento || ''
);

const getInvoiceNumber = (invoice = {}) => (
    invoice.invoiceNumber || invoice.numeroFactura || invoice.document || invoice.folio || invoice.id || ''
);

const normalizeReceivableInvoice = (invoice = {}) => {
    const branch = getBranchById(getRecordBranchId(invoice));
    const originalAmount = getCreditOriginalAmount(invoice);
    const paidAmount = getCreditPaidAmount(invoice);
    const balance = getCreditBalance(invoice);
    return {
        ...invoice,
        branchId: branch.id,
        branchName: branch.name,
        branchShortName: branch.shortName,
        date: getInvoiceDate(invoice),
        dueDate: getInvoiceDueDate(invoice),
        month: getMonth(getInvoiceDate(invoice)),
        invoiceNumber: getInvoiceNumber(invoice),
        customerName: getCustomerName(invoice),
        customerRfc: invoice.customerRfc || invoice.rfc || '',
        customerAddress: invoice.customerAddress || invoice.address || '',
        originalAmount,
        paidAmount,
        balance,
        creditStatusLabel: getCreditStatus(invoice),
    };
};

const isActiveReceivableInvoice = (invoice = {}) => (
    !['ANULADA', 'ANULADO', 'CANCELADA', 'CANCELADO', 'DELETED'].includes(normalizeText(invoice.status))
    && getCreditBalance(invoice) > 0.01
);

const buildCustomerKey = (invoice = {}) => (
    normalizeText(invoice.customerName || invoice.customerRfc || 'CLIENTE-SIN-NOMBRE')
);

const groupReceivablesByCustomer = (invoices = []) => {
    const map = new Map();
    invoices.forEach((invoice) => {
        const key = buildCustomerKey(invoice);
        const current = map.get(key) || {
            key,
            customerName: invoice.customerName || 'Cliente sin nombre',
            customerRfc: invoice.customerRfc || '',
            customerAddress: invoice.customerAddress || '',
            branchShortNames: new Set(),
            invoiceCount: 0,
            originalAmount: 0,
            paidAmount: 0,
            balance: 0,
            oldestDate: invoice.date || '',
            invoices: [],
        };

        current.branchShortNames.add(invoice.branchShortName);
        current.invoiceCount += 1;
        current.originalAmount = safeNumber(current.originalAmount + invoice.originalAmount);
        current.paidAmount = safeNumber(current.paidAmount + invoice.paidAmount);
        current.balance = safeNumber(current.balance + invoice.balance);
        current.oldestDate = !current.oldestDate || (invoice.date && invoice.date < current.oldestDate) ? invoice.date : current.oldestDate;
        current.invoices.push(invoice);
        map.set(key, current);
    });

    return [...map.values()]
        .map((group) => ({
            ...group,
            branchShortNames: [...group.branchShortNames].filter(Boolean),
            invoices: group.invoices.sort((a, b) => String(a.date).localeCompare(String(b.date))),
        }))
        .sort((a, b) => b.balance - a.balance);
};

const inputClass = 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none transition focus:border-[#e30613] focus:ring-4 focus:ring-red-100';

const Badge = ({ children, tone = 'slate' }) => {
    const tones = {
        slate: 'border-slate-200 bg-slate-50 text-slate-600',
        green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        amber: 'border-amber-200 bg-amber-50 text-amber-700',
        blue: 'border-sky-200 bg-sky-50 text-sky-700',
        red: 'border-red-200 bg-red-50 text-red-700',
    };

    return (
        <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${tones[tone] || tones.slate}`}>
            {children}
        </span>
    );
};

const SummaryCard = ({ label, value, tone = 'slate' }) => {
    const tones = {
        slate: 'border-slate-200 bg-white text-slate-950',
        green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        amber: 'border-amber-200 bg-amber-50 text-amber-800',
        blue: 'border-sky-200 bg-sky-50 text-sky-800',
        red: 'border-red-200 bg-red-50 text-red-800',
    };
    return (
        <div className={`rounded-3xl border p-4 shadow-sm ${tones[tone] || tones.slate}`}>
            <div className="text-[10px] font-black uppercase tracking-[0.22em] opacity-60">{label}</div>
            <div className="mt-2 font-mono text-2xl font-black">{value}</div>
        </div>
    );
};

const buildStatementHtml = (customer = {}, branchLabel = '') => {
    const invoiceRows = (customer.invoices || []).map((invoice) => `
        <tr>
            <td>${escapeHtml(invoice.date || '-')}</td>
            <td>${escapeHtml(invoice.dueDate || '-')}</td>
            <td>${escapeHtml(invoice.invoiceNumber || '-')}</td>
            <td>${escapeHtml(invoice.branchShortName || '-')}</td>
            <td class="right">${fmt(invoice.originalAmount)}</td>
            <td class="right">${fmt(invoice.paidAmount)}</td>
            <td class="right strong">${fmt(invoice.balance)}</td>
            <td>${escapeHtml(invoice.creditStatusLabel || '-')}</td>
        </tr>
    `).join('');

    return `<!doctype html>
<html>
<head>
    <meta charset="utf-8" />
    <title>Estado de cuenta - ${escapeHtml(customer.customerName || 'Cliente')}</title>
    <style>
        @page { size: letter; margin: 1.25cm; }
        * { box-sizing: border-box; }
        body { font-family: Arial, sans-serif; color: #111827; margin: 0; font-size: 12px; }
        header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111827; padding-bottom: 14px; margin-bottom: 18px; }
        .brand { display: flex; gap: 12px; align-items: center; }
        .brand img { width: 46px; height: 46px; object-fit: contain; }
        .eyebrow { font-size: 9px; letter-spacing: 0.24em; text-transform: uppercase; color: #b91c1c; font-weight: 700; }
        h1 { margin: 3px 0 0; font-size: 20px; }
        .meta { text-align: right; color: #475569; font-weight: 700; line-height: 1.55; }
        .client { border: 1px solid #cbd5e1; border-radius: 14px; padding: 14px; margin-bottom: 16px; }
        .client h2 { margin: 0 0 6px; font-size: 18px; }
        .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
        .box { border: 1px solid #cbd5e1; border-radius: 12px; padding: 10px; }
        .box span { display: block; color: #64748b; font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 700; }
        .box strong { display: block; margin-top: 4px; font-size: 16px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #f1f5f9; color: #475569; text-align: left; font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; padding: 8px; border-bottom: 1px solid #cbd5e1; }
        td { padding: 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
        .right { text-align: right; }
        .strong { font-weight: 800; }
        footer { margin-top: 22px; color: #64748b; font-size: 10px; border-top: 1px solid #cbd5e1; padding-top: 10px; }
    </style>
</head>
<body>
    <header>
        <div class="brand">
            <img src="${APP_BRAND_LOGO}" alt="${APP_BRAND_NAME}" />
            <div>
                <div class="eyebrow">${escapeHtml(APP_BRAND_NAME)}</div>
                <h1>Estado de cuenta</h1>
            </div>
        </div>
        <div class="meta">
            Fecha de emision: ${todayString()}<br />
            Sucursal: ${escapeHtml(branchLabel || 'Todas')}<br />
            Moneda: Cordobas
        </div>
    </header>
    <section class="client">
        <h2>${escapeHtml(customer.customerName || 'Cliente sin nombre')}</h2>
        <div>RUC/RFC: ${escapeHtml(customer.customerRfc || '-')}</div>
        <div>Direccion: ${escapeHtml(customer.customerAddress || '-')}</div>
    </section>
    <section class="summary">
        <div class="box"><span>Facturas pendientes</span><strong>${customer.invoiceCount || 0}</strong></div>
        <div class="box"><span>Total credito</span><strong>${fmt(customer.originalAmount)}</strong></div>
        <div class="box"><span>Saldo pendiente</span><strong>${fmt(customer.balance)}</strong></div>
    </section>
    <table>
        <thead>
            <tr>
                <th>Fecha</th>
                <th>Vence</th>
                <th>Factura</th>
                <th>Sucursal</th>
                <th class="right">Credito</th>
                <th class="right">Abonado</th>
                <th class="right">Saldo</th>
                <th>Estado</th>
            </tr>
        </thead>
        <tbody>${invoiceRows}</tbody>
    </table>
    <footer>
        Este estado de cuenta muestra facturas membretadas con metodo de pago credito y saldo pendiente al momento de emision.
    </footer>
    <script>window.onload = () => { window.focus(); window.print(); };</script>
</body>
</html>`;
};

export default function AccountsReceivable({ data = {}, branchContext }) {
    const selectedBranchId = branchContext?.selectedBranchId || DEFAULT_BRANCH_ID;
    const allowedBranchIds = branchContext?.allowedBranchIds?.length ? branchContext.allowedBranchIds : [selectedBranchId];
    const [branchFilter, setBranchFilter] = useState(selectedBranchId);
    const [search, setSearch] = useState('');
    const [selectedCustomerKey, setSelectedCustomerKey] = useState('');

    const branchFilterOptions = useMemo(() => {
        const allowed = new Set(allowedBranchIds);
        const branches = BRANCHES.filter((branch) => allowed.has(branch.id));
        return branches.length > 1
            ? [{ id: CONSOLIDATED_BRANCH_ID, shortName: 'Todas', name: 'Todas las sucursales' }, ...branches]
            : branches;
    }, [allowedBranchIds]);

    useEffect(() => {
        if (branchFilter !== CONSOLIDATED_BRANCH_ID && !allowedBranchIds.includes(branchFilter)) {
            setBranchFilter(selectedBranchId || allowedBranchIds[0] || DEFAULT_BRANCH_ID);
        }
    }, [allowedBranchIds, branchFilter, selectedBranchId]);

    const receivableInvoices = useMemo(() => (
        [...(data.facturas_membretadas_ventas || [])]
            .map(normalizeReceivableInvoice)
            .filter(isActiveReceivableInvoice)
            .filter((invoice) => (
                branchFilter === CONSOLIDATED_BRANCH_ID
                    ? allowedBranchIds.includes(invoice.branchId)
                    : invoice.branchId === branchFilter
            ))
            .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    ), [allowedBranchIds, branchFilter, data.facturas_membretadas_ventas]);

    const customerGroups = useMemo(() => {
        const groups = groupReceivablesByCustomer(receivableInvoices);
        const normalizedSearch = normalizeText(search);
        if (!normalizedSearch) return groups;
        return groups.filter((group) => normalizeText([
            group.customerName,
            group.customerRfc,
            group.branchShortNames.join(' '),
            group.invoices.map((invoice) => invoice.invoiceNumber).join(' '),
        ].join(' ')).includes(normalizedSearch));
    }, [receivableInvoices, search]);

    useEffect(() => {
        if (customerGroups.length === 0) {
            setSelectedCustomerKey('');
            return;
        }
        if (!selectedCustomerKey || !customerGroups.some((group) => group.key === selectedCustomerKey)) {
            setSelectedCustomerKey(customerGroups[0].key);
        }
    }, [customerGroups, selectedCustomerKey]);

    const selectedCustomer = useMemo(() => (
        customerGroups.find((group) => group.key === selectedCustomerKey) || customerGroups[0] || null
    ), [customerGroups, selectedCustomerKey]);

    const stats = useMemo(() => (
        customerGroups.reduce((acc, group) => {
            acc.customers += 1;
            acc.invoices += group.invoiceCount;
            acc.originalAmount = safeNumber(acc.originalAmount + group.originalAmount);
            acc.paidAmount = safeNumber(acc.paidAmount + group.paidAmount);
            acc.balance = safeNumber(acc.balance + group.balance);
            return acc;
        }, { customers: 0, invoices: 0, originalAmount: 0, paidAmount: 0, balance: 0 })
    ), [customerGroups]);

    const branchLabel = branchFilter === CONSOLIDATED_BRANCH_ID
        ? 'Todas las sucursales'
        : getBranchById(branchFilter).shortName;

    const printStatement = () => {
        if (!selectedCustomer) return;
        const popup = window.open('', '_blank', 'width=960,height=720');
        if (!popup) {
            window.alert('El navegador bloqueo la ventana de impresion. Permite popups para imprimir el estado de cuenta.');
            return;
        }
        popup.document.open();
        popup.document.write(buildStatementHtml(selectedCustomer, branchLabel));
        popup.document.close();
    };

    return (
        <div className="space-y-5">
            <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
                <div className="command-register-header px-5 py-5 sm:px-6">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.38em] text-[#e30613]">{APP_BRAND_NAME}</div>
                            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Cuentas por Cobrar</h1>
                            <p className="mt-1 max-w-2xl text-sm font-semibold text-slate-500">
                                Estados de cuenta de clientes con facturas membretadas a credito pendientes.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Badge tone="blue">{branchLabel}</Badge>
                            <Badge tone="amber">Credito</Badge>
                            <Badge tone="green">Impresion</Badge>
                        </div>
                    </div>
                </div>
            </section>

            <section className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid gap-3 lg:grid-cols-[1fr_0.35fr_auto]">
                    <input
                        className={inputClass}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Buscar cliente, RUC o numero de factura..."
                    />
                    <select className={inputClass} value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
                        {branchFilterOptions.map((branch) => (
                            <option key={branch.id} value={branch.id}>
                                {branch.shortName || branch.name}
                            </option>
                        ))}
                    </select>
                    <button
                        type="button"
                        onClick={() => {
                            setSearch('');
                            setBranchFilter(selectedBranchId);
                        }}
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-slate-600 transition hover:border-[#e30613] hover:text-[#e30613]"
                    >
                        Limpiar
                    </button>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-4">
                    <SummaryCard label="Clientes" value={stats.customers} />
                    <SummaryCard label="Facturas" value={stats.invoices} tone="blue" />
                    <SummaryCard label="Credito total" value={fmt(stats.originalAmount)} tone="amber" />
                    <SummaryCard label="Saldo pendiente" value={fmt(stats.balance)} tone="green" />
                </div>
            </section>

            <div className="grid gap-5 xl:grid-cols-[0.85fr_1.35fr]">
                <section className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[#e30613]">Clientes</div>
                            <h2 className="text-lg font-black text-slate-950">Saldos abiertos</h2>
                        </div>
                        <Badge tone="blue">{customerGroups.length}</Badge>
                    </div>
                    <div className="max-h-[38rem] space-y-2 overflow-y-auto pr-1">
                        {customerGroups.map((group) => {
                            const selected = group.key === selectedCustomer?.key;
                            return (
                                <button
                                    key={group.key}
                                    type="button"
                                    onClick={() => setSelectedCustomerKey(group.key)}
                                    className={`w-full rounded-3xl border p-4 text-left transition ${selected ? 'border-[#e30613] bg-red-50 shadow-lg shadow-red-950/10' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-black text-slate-950">{group.customerName}</div>
                                            <div className="mt-1 text-xs font-bold text-slate-500">{group.invoiceCount} factura(s) - {group.branchShortNames.join(' + ') || '-'}</div>
                                        </div>
                                        <Badge tone={selected ? 'red' : 'slate'}>{group.oldestDate || '-'}</Badge>
                                    </div>
                                    <div className="mt-3 font-mono text-xl font-black text-emerald-700">{fmt(group.balance)}</div>
                                </button>
                            );
                        })}
                        {customerGroups.length === 0 && (
                            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm font-bold text-slate-400">
                                No hay facturas a credito pendientes para este filtro.
                            </div>
                        )}
                    </div>
                </section>

                <section className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm">
                    {selectedCustomer ? (
                        <>
                            <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-start lg:justify-between">
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[#e30613]">Estado de cuenta</div>
                                    <h2 className="mt-1 text-2xl font-black text-slate-950">{selectedCustomer.customerName}</h2>
                                    <div className="mt-1 text-sm font-bold text-slate-500">RUC/RFC: {selectedCustomer.customerRfc || '-'} - Sucursal: {selectedCustomer.branchShortNames.join(' + ') || '-'}</div>
                                </div>
                                <button
                                    type="button"
                                    onClick={printStatement}
                                    className="rounded-2xl bg-[#e30613] px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white shadow-lg shadow-red-950/20 transition hover:bg-[#9f111a]"
                                >
                                    Imprimir estado de cuenta
                                </button>
                            </div>

                            <div className="mt-4 grid gap-3 md:grid-cols-3">
                                <SummaryCard label="Total credito" value={fmt(selectedCustomer.originalAmount)} tone="amber" />
                                <SummaryCard label="Abonado" value={fmt(selectedCustomer.paidAmount)} tone="blue" />
                                <SummaryCard label="Saldo" value={fmt(selectedCustomer.balance)} tone="green" />
                            </div>

                            <div className="mt-5 overflow-x-auto rounded-3xl border border-slate-200">
                                <table className="min-w-full text-left text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                                            <th className="px-4 py-3">Fecha</th>
                                            <th className="px-4 py-3">Vence</th>
                                            <th className="px-4 py-3">Factura</th>
                                            <th className="px-4 py-3">Sucursal</th>
                                            <th className="px-4 py-3 text-right">Credito</th>
                                            <th className="px-4 py-3 text-right">Abonado</th>
                                            <th className="px-4 py-3 text-right">Saldo</th>
                                            <th className="px-4 py-3">Estado</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {selectedCustomer.invoices.map((invoice) => (
                                            <tr key={invoice.id || `${invoice.invoiceNumber}-${invoice.date}`} className="border-b border-slate-100 last:border-b-0">
                                                <td className="px-4 py-3 font-bold text-slate-700">{invoice.date || '-'}</td>
                                                <td className="px-4 py-3 font-bold text-slate-500">{invoice.dueDate || '-'}</td>
                                                <td className="px-4 py-3 font-black text-slate-950">{invoice.invoiceNumber || '-'}</td>
                                                <td className="px-4 py-3 font-bold text-slate-500">{invoice.branchShortName || '-'}</td>
                                                <td className="px-4 py-3 text-right font-mono font-black text-amber-700">{fmt(invoice.originalAmount)}</td>
                                                <td className="px-4 py-3 text-right font-mono font-black text-sky-700">{fmt(invoice.paidAmount)}</td>
                                                <td className="px-4 py-3 text-right font-mono font-black text-emerald-700">{fmt(invoice.balance)}</td>
                                                <td className="px-4 py-3"><Badge tone={invoice.paidAmount > 0 ? 'blue' : 'amber'}>{invoice.creditStatusLabel}</Badge></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    ) : (
                        <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center text-sm font-bold text-slate-400">
                            Selecciona un cliente para ver su estado de cuenta.
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
