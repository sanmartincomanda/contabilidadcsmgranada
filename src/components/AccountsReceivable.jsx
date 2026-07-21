import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import {
    APP_BRAND_LOGO,
    APP_BRAND_NAME,
    BRANCHES,
    CONSOLIDATED_BRANCH_ID,
    DEFAULT_BRANCH_ID,
    fmt,
    getBranchById,
    getBranchPayload,
    getRecordBranchId,
} from '../constants';
import { PAYMENT_METHODS } from '../services/fiscalUtils';

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
        .slice(0, 32) || 'SIN-NOMBRE'
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

const getCreditReceiptIds = (invoice = {}) => [...new Set(
    (Array.isArray(invoice.creditReceiptIds) ? invoice.creditReceiptIds : Array.isArray(invoice.linkedReceiptIds) ? invoice.linkedReceiptIds : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
)];

const getStoredCreditStatus = (invoice = {}) => normalizeText(
    invoice.creditStatus || invoice.creditStatusLabel || invoice.estadoCredito || ''
);

const isSettledCreditStatus = (invoice = {}) => {
    const status = getStoredCreditStatus(invoice);
    return status.includes('CANCEL')
        || status.includes('PAGAD')
        || status.includes('PAID')
        || status.includes('CERRAD');
};

const isCreditPaymentMethod = (invoice = {}) => normalizeText(
    invoice.paymentMethod || invoice.metodoPago || ''
).includes('CREDITO');

const getCreditBalance = (invoice = {}) => {
    const stored = invoice.creditBalance ?? invoice.saldoCredito;
    if (isSettledCreditStatus(invoice)) return 0;
    if (stored !== undefined && stored !== null && stored !== '') {
        const storedBalance = safeNumber(Math.max(safeNumber(stored), 0));
        if (storedBalance > 0.01) return storedBalance;
    }
    return safeNumber(Math.max(getCreditOriginalAmount(invoice) - getCreditPaidAmount(invoice), 0));
};

const getCreditStatus = (invoice = {}) => {
    const normalized = getStoredCreditStatus(invoice);
    if (isSettledCreditStatus(invoice) || getCreditBalance(invoice) <= 0.01) return 'Pagado';
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
    && isCreditPaymentMethod(invoice)
    && !isSettledCreditStatus(invoice)
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
const labelClass = 'text-[10px] font-black uppercase tracking-[0.22em] text-slate-500';
const receiptPaymentMethods = PAYMENT_METHODS.filter((method) => normalizeText(method) !== 'CREDITO');

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

const createReceiptForm = (invoice = {}) => ({
    date: todayString(),
    receiptNumber: '',
    amount: String(safeNumber(invoice.balance) || ''),
    retentionIr2: '',
    retentionMunicipal1: '',
    paymentMethod: '',
    reference: '',
    concept: invoice.invoiceNumber ? `Pago factura ${invoice.invoiceNumber}` : 'Pago a factura de credito',
});

const buildReceiptDocumentFields = (receipt = {}, branchPayload = {}) => ({
    receiptSeries: branchPayload.receiptSeries || branchPayload.documentSeries || 'A',
    documentSeries: branchPayload.receiptSeries || branchPayload.documentSeries || 'A',
    fiscalDocument: {
        type: 'receipt',
        series: branchPayload.receiptSeries || branchPayload.documentSeries || 'A',
        number: receipt.receiptNumber || '',
    },
});

const buildReceiptId = (form = {}, branchPayload = {}) => (
    `recibo_${branchPayload.branchId || DEFAULT_BRANCH_ID}_${branchPayload.receiptSeries || branchPayload.documentSeries || 'A'}_${slugify(form.receiptNumber)}_${String(form.date || todayString()).replace(/-/g, '')}`
);

const buildCreditSnapshot = (invoice = {}, nextPaidAmount = 0, receiptIds = []) => {
    const creditOriginalAmount = getCreditOriginalAmount(invoice);
    const creditPaidAmount = safeNumber(nextPaidAmount);
    const creditBalance = safeNumber(Math.max(creditOriginalAmount - creditPaidAmount, 0));
    const creditStatus = creditBalance <= 0.01 && creditOriginalAmount > 0
        ? 'cancelled'
        : creditPaidAmount > 0
            ? 'partial'
            : 'pending';

    return {
        isCreditSale: true,
        creditOriginalAmount,
        creditPaidAmount,
        creditBalance,
        creditReceiptIds: receiptIds,
        creditStatus,
        creditStatusLabel: creditStatus === 'cancelled'
            ? 'Credito - Cancelada'
            : creditStatus === 'partial'
                ? 'Credito - Pagada Parcial'
                : 'Credito - Pendiente',
    };
};

const findReceiptNumberDuplicate = async ({ receiptNumber = '', branchPayload = {} }) => {
    const safeNumberText = String(receiptNumber || '').trim();
    if (!safeNumberText) return null;

    const snapshot = await getDocs(query(
        collection(db, 'recibos_caja_membretados'),
        where('receiptNumber', '==', safeNumberText)
    ));

    return snapshot.docs
        .map((receiptDoc) => ({ id: receiptDoc.id, ...receiptDoc.data() }))
        .find((receipt) => {
            const status = normalizeText(receipt.status);
            const receiptBranchId = getRecordBranchId(receipt);
            const receiptSeries = String(receipt.receiptSeries || receipt.documentSeries || '').trim().toUpperCase();
            const targetSeries = String(branchPayload.receiptSeries || branchPayload.documentSeries || '').trim().toUpperCase();
            return !['ANULADO', 'ANULADA', 'CANCELADO', 'CANCELADA', 'DELETED'].includes(status)
                && receiptBranchId === branchPayload.branchId
                && receiptSeries === targetSeries;
        }) || null;
};

export default function AccountsReceivable({ data = {}, branchContext }) {
    const selectedBranchId = branchContext?.selectedBranchId || DEFAULT_BRANCH_ID;
    const allowedBranchIds = branchContext?.allowedBranchIds?.length ? branchContext.allowedBranchIds : [selectedBranchId];
    const [branchFilter, setBranchFilter] = useState(selectedBranchId);
    const [search, setSearch] = useState('');
    const [selectedCustomerKey, setSelectedCustomerKey] = useState('');
    const [receiptInvoice, setReceiptInvoice] = useState(null);
    const [receiptForm, setReceiptForm] = useState(createReceiptForm());
    const [savingReceipt, setSavingReceipt] = useState(false);
    const [message, setMessage] = useState('');

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

    const openReceiptModal = (invoice = {}) => {
        setReceiptInvoice(invoice);
        setReceiptForm(createReceiptForm(invoice));
        setMessage('');
    };

    const closeReceiptModal = () => {
        if (savingReceipt) return;
        setReceiptInvoice(null);
        setReceiptForm(createReceiptForm());
    };

    const updateReceiptForm = (key, value) => {
        setReceiptForm((prev) => ({ ...prev, [key]: value }));
    };

    const saveReceipt = async (event) => {
        event.preventDefault();
        if (!receiptInvoice) return;
        setSavingReceipt(true);
        setMessage('');

        try {
            const receiptNumber = String(receiptForm.receiptNumber || '').trim();
            const amount = safeNumber(receiptForm.amount);
            const retentionIr2 = safeNumber(receiptForm.retentionIr2);
            const retentionMunicipal1 = safeNumber(receiptForm.retentionMunicipal1);
            const retentionTotal = safeNumber(retentionIr2 + retentionMunicipal1);
            const paymentMethod = String(receiptForm.paymentMethod || '').trim();
            const branchPayload = getBranchPayload(receiptInvoice.branchId || getRecordBranchId(receiptInvoice), 'receipt');

            if (!receiptNumber) throw new Error('Ingresa el numero de recibo / folio.');
            if (!paymentMethod) throw new Error('Selecciona metodo de pago.');
            if (amount <= 0) throw new Error('Ingresa el monto del abono.');
            if (amount > safeNumber(receiptInvoice.balance) + 0.01) {
                throw new Error(`El abono no puede superar el saldo pendiente ${fmt(receiptInvoice.balance)}.`);
            }
            if (retentionTotal > amount + 0.01) {
                throw new Error('Las retenciones no pueden ser mayores que el monto del recibo.');
            }

            const duplicate = await findReceiptNumberDuplicate({ receiptNumber, branchPayload });
            if (duplicate) {
                throw new Error(`Ya existe un recibo con el folio ${receiptNumber} en ${branchPayload.branchName}.`);
            }

            const receiptId = buildReceiptId(receiptForm, branchPayload);
            const invoiceId = receiptInvoice.id || receiptInvoice.docId;
            if (!invoiceId) throw new Error('No pude identificar la factura vinculada.');

            const currentPaid = getCreditPaidAmount(receiptInvoice);
            const nextPaid = safeNumber(currentPaid + amount);
            const receiptIds = [...new Set([...getCreditReceiptIds(receiptInvoice), receiptId])];
            const invoiceApplication = {
                invoiceId,
                invoiceNumber: receiptInvoice.invoiceNumber || receiptInvoice.numeroFactura || '',
                customerName: receiptInvoice.customerName || '',
                appliedAmount: amount,
                balanceBeforeApplication: receiptInvoice.balance,
                remainingBalance: safeNumber(Math.max(receiptInvoice.balance - amount, 0)),
            };
            const concept = String(receiptForm.concept || '').trim() || `Pago factura ${receiptInvoice.invoiceNumber || ''}`.trim();
            const date = receiptForm.date || todayString();
            const receiptPayload = {
                date,
                receiptDate: date,
                month: getMonth(date),
                receiptNumber,
                numeroRecibo: receiptNumber,
                ...branchPayload,
                ...buildReceiptDocumentFields({ receiptNumber }, branchPayload),
                customerName: receiptInvoice.customerName || '',
                recibiDe: receiptInvoice.customerName || '',
                customerRfc: receiptInvoice.customerRfc || '',
                customerAddress: receiptInvoice.customerAddress || '',
                amount,
                cantidad: amount,
                retentionIr2,
                retencionIr2: retentionIr2,
                retentionMunicipal1,
                retencionMunicipal1: retentionMunicipal1,
                retentionTotal,
                retencionTotal: retentionTotal,
                netAmount: safeNumber(amount - retentionTotal),
                montoNeto: safeNumber(amount - retentionTotal),
                concept,
                concepto: concept,
                paymentMethod,
                metodoPago: paymentMethod,
                reference: String(receiptForm.reference || '').trim(),
                invoiceApplications: [invoiceApplication],
                linkedInvoices: [invoiceApplication],
                linkedInvoiceIds: [invoiceId],
                receiptMode: 'linked_invoices',
                isOtherReceipt: false,
                source: 'cuentas_por_cobrar',
                sourceType: 'cash_receipt',
                status: 'active',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            };

            const batch = writeBatch(db);
            batch.set(doc(db, 'recibos_caja_membretados', receiptId), receiptPayload, { merge: true });
            batch.set(doc(db, 'facturas_membretadas_ventas', invoiceId), {
                ...buildCreditSnapshot(receiptInvoice, nextPaid, receiptIds),
                updatedAt: serverTimestamp(),
            }, { merge: true });
            await batch.commit();

            const customerCode = `CLI-${slugify(receiptPayload.customerName)}`;
            await setDoc(doc(db, 'clientes_facturacion', customerCode), {
                code: customerCode,
                name: receiptPayload.customerName,
                normalizedName: normalizeText(receiptPayload.customerName),
                rfc: receiptPayload.customerRfc || '',
                address: receiptPayload.customerAddress || '',
                source: 'cuentas_por_cobrar',
                updatedAt: serverTimestamp(),
            }, { merge: true });

            setMessage(`Recibo ${receiptNumber} registrado y vinculado a factura ${receiptInvoice.invoiceNumber || invoiceId}.`);
            setReceiptInvoice(null);
            setReceiptForm(createReceiptForm());
        } catch (error) {
            console.error('Error al registrar recibo desde cuentas por cobrar', error);
            setMessage(error.message || 'No se pudo registrar el recibo.');
        } finally {
            setSavingReceipt(false);
        }
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

            {message && (
                <div className={`rounded-3xl border px-4 py-3 text-sm font-black ${message.includes('registrado') ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
                    {message}
                </div>
            )}

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
                                            <th className="px-4 py-3 text-right">Accion</th>
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
                                                <td className="px-4 py-3 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => openReceiptModal(invoice)}
                                                        className="rounded-xl bg-[#e30613] px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-white shadow-sm transition hover:bg-[#9f111a]"
                                                    >
                                                        Recibo caja
                                                    </button>
                                                </td>
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

            {receiptInvoice && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
                    <form onSubmit={saveReceipt} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[2rem] border border-slate-200 bg-white shadow-2xl">
                        <div className="border-b border-slate-200 bg-slate-950 px-5 py-4 text-white">
                            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#f5b51b]">Recibo de caja vinculado</div>
                            <div className="mt-1 text-2xl font-black">Factura {receiptInvoice.invoiceNumber || '-'}</div>
                            <div className="mt-1 text-sm font-semibold text-white/70">
                                {receiptInvoice.customerName || '-'} - Saldo {fmt(receiptInvoice.balance)}
                            </div>
                        </div>

                        <div className="grid gap-4 p-5 md:grid-cols-2">
                            <label className="space-y-2">
                                <span className={labelClass}>Fecha</span>
                                <input type="date" className={inputClass} value={receiptForm.date} onChange={(event) => updateReceiptForm('date', event.target.value)} required />
                            </label>
                            <label className="space-y-2">
                                <span className={labelClass}>Numero de recibo / folio</span>
                                <input className={inputClass} value={receiptForm.receiptNumber} onChange={(event) => updateReceiptForm('receiptNumber', event.target.value)} placeholder="Ej. 0010" required />
                            </label>
                            <label className="space-y-2">
                                <span className={labelClass}>Cliente</span>
                                <input className={inputClass} value={receiptInvoice.customerName || ''} readOnly />
                            </label>
                            <label className="space-y-2">
                                <span className={labelClass}>Metodo de pago</span>
                                <select className={inputClass} value={receiptForm.paymentMethod} onChange={(event) => updateReceiptForm('paymentMethod', event.target.value)} required>
                                    <option value="">Seleccionar metodo...</option>
                                    {receiptPaymentMethods.map((method) => <option key={method} value={method}>{method}</option>)}
                                </select>
                            </label>
                            <label className="space-y-2">
                                <span className={labelClass}>Cantidad aplicada</span>
                                <input type="number" step="0.01" min="0" max={receiptInvoice.balance} className={inputClass} value={receiptForm.amount} onChange={(event) => updateReceiptForm('amount', event.target.value)} required />
                            </label>
                            <label className="space-y-2">
                                <span className={labelClass}>Referencia</span>
                                <input className={inputClass} value={receiptForm.reference} onChange={(event) => updateReceiptForm('reference', event.target.value)} placeholder="Transferencia, POS, cheque..." />
                            </label>
                            <label className="space-y-2">
                                <span className={labelClass}>Retencion anticipo IR 2%</span>
                                <input type="number" step="0.01" min="0" className={inputClass} value={receiptForm.retentionIr2} onChange={(event) => updateReceiptForm('retentionIr2', event.target.value)} placeholder="0.00" />
                            </label>
                            <label className="space-y-2">
                                <span className={labelClass}>Retencion municipal 1%</span>
                                <input type="number" step="0.01" min="0" className={inputClass} value={receiptForm.retentionMunicipal1} onChange={(event) => updateReceiptForm('retentionMunicipal1', event.target.value)} placeholder="0.00" />
                            </label>
                            <label className="space-y-2 md:col-span-2">
                                <span className={labelClass}>En concepto de</span>
                                <textarea className={`${inputClass} min-h-24 resize-y`} value={receiptForm.concept} onChange={(event) => updateReceiptForm('concept', event.target.value)} />
                            </label>
                        </div>

                        <div className="mx-5 mb-5 grid gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-4">
                            <SummaryCard label="Factura" value={receiptInvoice.invoiceNumber || '-'} />
                            <SummaryCard label="Saldo actual" value={fmt(receiptInvoice.balance)} tone="amber" />
                            <SummaryCard label="Retenciones" value={fmt(safeNumber(receiptForm.retentionIr2) + safeNumber(receiptForm.retentionMunicipal1))} tone="blue" />
                            <SummaryCard label="Neto caja" value={fmt(Math.max(safeNumber(receiptForm.amount) - safeNumber(receiptForm.retentionIr2) - safeNumber(receiptForm.retentionMunicipal1), 0))} tone="green" />
                        </div>

                        <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:justify-end">
                            <button type="button" onClick={closeReceiptModal} disabled={savingReceipt} className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-600 transition hover:border-slate-400">
                                Cancelar
                            </button>
                            <button type="submit" disabled={savingReceipt} className="rounded-2xl bg-[#e30613] px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white shadow-lg shadow-red-950/20 transition hover:bg-[#9f111a] disabled:cursor-not-allowed disabled:opacity-60">
                                {savingReceipt ? 'Guardando...' : 'Guardar recibo y aplicar'}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}
