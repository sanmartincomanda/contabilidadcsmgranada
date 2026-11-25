import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server, billing, methods;
const method = 'TRANSFERENCIA NO RC';
before(async () => {
    // Exercise the actual history/print calculations without initializing a Firebase client.
    server = await createServer({
        configFile: false, appType: 'custom', logLevel: 'error',
        ssr: { noExternal: ['react-router-dom'] },
        server: { middlewareMode: true, hmr: false, watch: null },
        plugins: [{ name: 'offline-firebase', enforce: 'pre',
            load(id) {
                if (id.replaceAll('\\', '/').includes('/react-router-dom/dist/')) {
                    return 'export const useNavigate=()=>{}, useLocation=()=>({});';
                }
                if (id.replaceAll('\\', '/').endsWith('/src/firebase.js')) {
                    return 'export const auth={}, db={}, storage={}, functions={};';
                }
            },
        }],
    });
    billing = await server.ssrLoadModule('/src/components/Billing.jsx');
    methods = await server.ssrLoadModule('/src/services/fiscalUtils.js');
});
after(() => server?.close());

function closure(invoices, receipts, manual = 0) {
    const source = billing.buildClosureDocumentPaymentAutomation({ invoices, cashReceipts: receipts, closureId: 's1' });
    const transferDetails = source.transferDetails;
    if (manual) transferDetails.noRc.push({ amount: manual, reference: 'manual' });
    const transferTotals = Object.fromEntries(Object.entries(transferDetails).map(([k, rows]) =>
        [k, rows.reduce((sum, r) => sum + (r.amountCordobas ?? r.amount), 0)]));
    const accountingSummary = billing.buildClosureAccountingSummary({
        stampedInvoices: invoices, cashReceipts: receipts, transferTotals, posTotals: source.posExpectedTotals,
    });
    return { id: 'close1', code: '1', stampedInvoices: invoices, cashReceipts: receipts, transferDetails,
        transferTotals, posTotals: source.posExpectedTotals, accountingSummary };
}

test('billing and CxC only; no generic SICAR transfer guessed as NO RC', () => {
    assert.ok(methods.BILLING_PAYMENT_METHODS.includes(method));
    assert.ok(!methods.PURCHASE_PAYMENT_METHODS.includes(method));
    assert.ok(!methods.PAYMENT_METHODS.includes(method));
    assert.equal(billing.getSicarPaymentMethodForAccounting(method), method);
    assert.notEqual(billing.getSicarPaymentMethodForAccounting('Transferencia'), method);
});

test('invoice, mixed payments and receipts: net of retentions, stable on reload, ticket, deposit, XLS and daily reprint', () => {
    const c = closure([
        { id:'f1', invoiceNumber:'21', total:120, retentionIr2:2, paymentMethod:method },
        { id:'f2', invoiceNumber:'22', total:300, paymentMethod:'MIXTO', paymentBreakdown:[
            {id:'1',method,amount:50}, {id:'2',method:'EFECTIVO',amount:70},
            {id:'3',method:'TRANSFERENCIA BAC (2)',amount:40}, {id:'4',method:'CREDITO',amount:140},
        ] },
    ], [{ id:'r1',receiptNumber:'30',amount:100,retentionIr2:2,retentionMunicipal1:1,paymentMethod:method,reference:'123' }], 25);
    assert.equal(c.accountingSummary.stampedDocuments.documentNoRcTotal,265);
    assert.equal(c.accountingSummary.paymentBreakdown.transferTotal,40);
    assert.equal(c.accountingSummary.internalRatio.cashResidual,70);
    const ticket = billing.buildCashClosureTicketData(c);
    assert.equal(ticket.salesTotal,420);
    assert.equal(ticket.retentionTotal,5);
    assert.equal(ticket.rc,70);
    assert.equal(ticket.cashIncomeTotal,110);
    const detail=ticket.paymentMethods.find(m=>m.label.includes('NO RC'));
    assert.equal(detail.total,290);
    assert.deepEqual(detail.details.map(x=>x.amount),[118,50,97,25]);
    assert.match(detail.details[2].label,/R-30.*123/);
    assert.equal(billing.getClosureCashForBankDeposit(c).rcValue,70);
    assert.ok(billing.buildCashClosureRcReportSheets(c).some(s=>s.name==='Transferencia NO RC' && s.rows.length===4));
    const daily=billing.buildDailyCashClosureTicketData([c,{...c,code:'2'}]);
    assert.equal(daily.rc,140);
    assert.equal(daily.paymentMethods.find(m=>m.label.includes('NO RC')).total,580);
    assert.equal(daily.paymentMethods.find(m=>m.label.includes('NO RC')).details.length,8);
    const draft={...c,stampedInvoiceDrafts:c.stampedInvoices,stampedInvoices:[],cashReceiptDrafts:c.cashReceipts,cashReceipts:[]};
    assert.equal(billing.buildCashClosureTicketData(draft).rc,70);
});

test('manual-only NO RC is visible but cannot manufacture a document payment or a deposit', () => {
    const c=closure([],[],125.50);
    const t=billing.buildCashClosureTicketData(c);
    assert.equal(t.transferNoRc,125.50);
    assert.equal(t.cashIncomeTotal,0);
    assert.equal(t.rc,0);
    assert.equal(billing.getClosureCashForBankDeposit(c).rcValue,0);
    assert.equal(billing.calculateClosureEditTotals(c).manualTotal,125.50);
});

test('five NO RC transfers reconcile against SICAR once, without concealing a remaining difference', () => {
    const noRc = [6187.14,317.38,728.76,1894.80,3750.60].map(amount => ({amount}));
    const edit = billing.calculateClosureEditTotals({
        cashCount:{1000:18,50:1,20:1,5:1,1:3}, dollarCashCount:{100:2},
        transferDetails:{noRc,bac:[{amount:4923.30}]}, posDetails:{bac:[{amount:7060.52}]},
        retentionAdjustment:158.30, sicarExpected:50334.54,
    });
    assert.equal(edit.transferTotals.noRc,12878.68);
    assert.equal(edit.cashTotal,25378);
    assert.equal(edit.manualTotal,50240.50);
    assert.equal(edit.manualTotalWithRetentions,50398.80);
    assert.equal(edit.difference,64.26);

    const old = {...edit, cashClosureCalculationVersion:'rc-v7-no-rc-transfer', status:'en_espera', manualTotal:37361.82};
    const reopened = billing.normalizeCashClosureStoredTotals(old);
    assert.equal(reopened.difference,64.26);
    assert.equal(reopened.status,'en_espera');
    assert.equal(billing.normalizeCashClosureStoredTotals({...old,...reopened}).difference,64.26);
    assert.equal(billing.normalizeCashClosureStoredTotals({...old,status:'cerrado'}).difference,-12814.42);
    assert.equal(billing.normalizeCashClosureStoredTotals({...old,...edit,cashClosureCalculationVersion:'rc-v8-no-rc-in-sicar-reconciliation'}).difference,64.26);
});

test('ticket and deposit agree with NO RC plus a manual payroll meal unrelated to stamped documents', () => {
    const c = closure([{id:'f1',total:300,paymentMethod:method},{id:'f2',total:100,paymentMethod:'EFECTIVO'}], []);
    c.payrollMealDetails = [{amount:20, description:'manual'}];
    delete c.accountingSummary;
    const ticket = billing.buildCashClosureTicketData(c);
    assert.equal(ticket.payrollMealTotal, 20);
    assert.equal(ticket.rc, 100);
    assert.equal(billing.getClosureCashForBankDeposit(c).rcValue, ticket.rc);
});

test('partial CxC payment reduces credit by the gross amount and carries the net into the closure', () => {
    const invoice={id:'f1',invoiceNumber:'41',customerName:'Cliente',total:500,paymentMethod:'CREDITO',creditOriginalAmount:500};
    const validated = billing.buildValidatedReceiptInvoiceApplications({
        applications: [{invoiceId:'f1', appliedAmount:100}], invoiceIndex: new Map([['f1', invoice]]),
    });
    const receiptPayload = billing.buildCashReceiptPayload({
        form: {receiptNumber:'40', paymentMethod:method, retentionIr2:2},
        amount:validated.total, customerName:validated.customerName, invoiceApplications:validated.applications,
        branchPayload:{}, isNew:true,
    });
    assert.equal(receiptPayload.invoiceApplications[0].remainingBalance, 400);
    assert.equal(receiptPayload.netAmount,98);
    const t=billing.buildCashClosureTicketData(closure([],[receiptPayload]));
    assert.equal(t.transferNoRc,98);
    assert.equal(t.rc,0);
});

test('old closures retain BAC (2) in RC without an empty NO RC line', () => {
    const c={id:'old',stampedInvoices:[{invoiceNumber:'1',total:100,paymentMethod:'EFECTIVO'}],transferTotals:{bac2:20}};
    const t=billing.buildCashClosureTicketData(c);
    assert.equal(t.rc,80);
    assert.equal(t.transferBac2,20);
    assert.equal(t.paymentMethods.some(m=>m.label.includes('NO RC')),false);
    assert.equal(billing.getClosureCashForBankDeposit(c).rcValue,80);
});

test('NO RC detail survives a rows-only historical snapshot', () => {
    const c = closure([], [], 15);
    delete c.accountingSummary;
    delete c.transferTotals;
    assert.equal(billing.buildCashClosureTicketData(c).transferNoRc, 15);
    assert.equal(billing.getClosureCashForBankDeposit(c).rcValue, 0);
    assert.ok(billing.buildCashClosureRcReportSheets(c).some(s => s.rows.some(r => r.Concepto === 'Transferencia NO RC' && r.Total === 15)));
});

test('linked documents cannot be silently reclassified and an annulment leaves unrelated entries alone', () => {
    const before = { id: 'f1', total: 100, paymentMethod: method, linkedCashClosureId: 'close1' };
    assert.throws(() => billing.assertLinkedNoRcAmountUnchanged(before, {...before, paymentMethod: 'EFECTIVO'}, 'invoice'), /vinculado/);
    assert.doesNotThrow(() => billing.assertLinkedNoRcAmountUnchanged(before, {...before, reference: 'ok'}, 'invoice'));
    assert.doesNotThrow(() => billing.assertLinkedNoRcAmountUnchanged({...before, linkedCashClosureId: ''}, {...before, paymentMethod: 'EFECTIVO'}, 'invoice'));
    const c = closure([before], [{id: 'r1', amount: 15, paymentMethod: method}], 10);
    const patch = billing.getAnnulledInvoiceNoRcPatch(c, 'f1');
    assert.equal(patch.transferTotals.noRc, 25);
    assert.deepEqual(patch.transferDetails.noRc.map(row => row.amount), [15, 10]);
    assert.deepEqual(billing.getAnnulledInvoiceNoRcPatch(c, 'other'), {});
    const posted = {...c, manualTotal:155, cashClosureCalculationVersion:'rc-v8-no-rc-in-sicar-reconciliation'};
    assert.equal(billing.getAnnulledInvoiceNoRcPatch(posted, 'f1').manualTotal,55);
    assert.equal(patch.manualTotal,undefined);
});
