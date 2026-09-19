import test from 'node:test';
import assert from 'node:assert/strict';
import {
    canRecoverOwnedInvoiceNumberReservation,
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

test('recovers an orphan reservation created by the same deterministic invoice', () => {
    assert.equal(canRecoverOwnedInvoiceNumberReservation({
        reservationOwnerId: 'membretada_nindiri_B_1959_20260919_sicar-ticket-nindiri-1959',
        targetOwnerId: 'MEMBRETADA_NINDIRI_B_1959_20260919_SICAR-TICKET-NINDIRI-1959',
        targetExists: false,
        wasExistingDoc: false,
    }), true);
});

test('never recovers another ticket reservation or an existing invoice', () => {
    assert.equal(canRecoverOwnedInvoiceNumberReservation({
        reservationOwnerId: 'ticket-1958',
        targetOwnerId: 'ticket-1959',
        targetExists: false,
        wasExistingDoc: false,
    }), false);
    assert.equal(canRecoverOwnedInvoiceNumberReservation({
        reservationOwnerId: 'ticket-1959',
        targetOwnerId: 'ticket-1959',
        targetExists: true,
        wasExistingDoc: false,
    }), false);
});
