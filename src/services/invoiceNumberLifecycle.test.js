import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getCanonicalInvoiceNumberDrafts,
    getInvoiceNumberTransitions,
} from './invoiceNumberLifecycle.js';

test('reserves only the current canonical invoice number', () => {
    const draft = {
        id: 'invoice-1',
        invoiceNumber: '7509',
        originalInvoiceNumber: '7561',
        invoiceNumberHistory: ['7561', '7509'],
    };

    assert.deepEqual(getCanonicalInvoiceNumberDrafts([draft]), [draft]);
});

test('detects a corrected invoice number that must release its previous reservation', () => {
    const draft = {
        id: 'invoice-1',
        previousInvoiceNumber: '7561',
        invoiceNumber: '7509',
    };

    assert.deepEqual(getInvoiceNumberTransitions([draft]), [{
        draft,
        ownerDocumentId: 'invoice-1',
        previousInvoiceNumber: '7561',
        invoiceNumber: '7509',
    }]);
});

test('does not release a reservation when the number did not change', () => {
    assert.deepEqual(getInvoiceNumberTransitions([{
        id: 'invoice-1',
        previousInvoiceNumber: '7509',
        invoiceNumber: '7509',
    }]), []);
});

test('ignores new drafts because they have no previous persisted number', () => {
    assert.deepEqual(getInvoiceNumberTransitions([{
        id: 'invoice-new',
        invoiceNumber: '7561',
        wasExistingDoc: false,
    }]), []);
});

