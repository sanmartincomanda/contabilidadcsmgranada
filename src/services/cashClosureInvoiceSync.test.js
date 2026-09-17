import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeClosureInvoiceDraftWithPersisted } from './cashClosureInvoiceSync.js';

test('replaces a stale transfer draft with the persisted cash payment', () => {
    const draft = {
        id: 'invoice-7706',
        docId: 'invoice-7706',
        localId: 'draft-7706',
        invoiceNumber: '7706',
        paymentMethod: 'TRANSFERENCIA BAC',
        paymentBreakdown: [{ method: 'TRANSFERENCIA BAC', amount: 5468.89 }],
        paymentNetTotal: 5468.89,
        manualClosureSelection: true,
        supportFiles: { invoicePhoto: { name: 'pending.jpg' } },
    };
    const persisted = {
        id: 'invoice-7706',
        invoiceNumber: '7706',
        paymentMethod: 'EFECTIVO',
        paymentBreakdown: [],
        paymentNetTotal: 0,
        total: 5468.89,
    };

    const merged = mergeClosureInvoiceDraftWithPersisted(draft, persisted);

    assert.equal(merged.paymentMethod, 'EFECTIVO');
    assert.deepEqual(merged.paymentBreakdown, []);
    assert.equal(merged.paymentNetTotal, 0);
    assert.equal(merged.localId, 'draft-7706');
    assert.equal(merged.manualClosureSelection, true);
    assert.equal(merged.supportFiles.invoicePhoto.name, 'pending.jpg');
});

test('uses the current persisted folio as the baseline for a waiting closure', () => {
    const merged = mergeClosureInvoiceDraftWithPersisted(
        { invoiceNumber: '7561', previousInvoiceNumber: '7561' },
        { id: 'invoice-1', invoiceNumber: '7461', paymentMethod: 'EFECTIVO' }
    );

    assert.equal(merged.invoiceNumber, '7461');
    assert.equal(merged.previousInvoiceNumber, '7461');
    assert.equal(merged.docId, 'invoice-1');
});

test('keeps the stored draft when the persisted invoice is unavailable', () => {
    const draft = { invoiceNumber: '7706', paymentMethod: 'TRANSFERENCIA BAC' };
    assert.equal(mergeClosureInvoiceDraftWithPersisted(draft, null), draft);
});

