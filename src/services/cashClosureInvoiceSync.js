const getInvoiceNumber = (invoice = {}) => String(
    invoice.invoiceNumber || invoice.numeroFactura || ''
).trim();

export const mergeClosureInvoiceDraftWithPersisted = (draft = {}, persistedInvoice = null) => {
    if (!persistedInvoice) return draft;

    const currentInvoiceNumber = getInvoiceNumber(persistedInvoice);
    return {
        ...draft,
        ...persistedInvoice,
        id: persistedInvoice.id || persistedInvoice.docId || draft.id || draft.docId || '',
        docId: persistedInvoice.docId || persistedInvoice.id || draft.docId || draft.id || '',
        localId: draft.localId || persistedInvoice.localId || '',
        previousInvoiceNumber: currentInvoiceNumber,
        manualClosureSelection: Boolean(draft.manualClosureSelection),
        supportFiles: draft.supportFiles || {},
        wasExistingDoc: true,
    };
};

