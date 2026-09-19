const cleanInvoiceNumber = (value = '') => String(value || '').trim();

const normalizeInvoiceNumber = (value = '') => cleanInvoiceNumber(value).toLowerCase();

export const getCanonicalInvoiceNumberDrafts = (drafts = []) => (
    (Array.isArray(drafts) ? drafts : []).filter((draft) => (
        Boolean(cleanInvoiceNumber(draft?.invoiceNumber || draft?.numeroFactura))
    ))
);

export const canRecoverOwnedInvoiceNumberReservation = ({
    reservationOwnerId = '',
    targetOwnerId = '',
    targetExists = false,
    wasExistingDoc = false,
} = {}) => (
    !wasExistingDoc
    && !targetExists
    && Boolean(cleanInvoiceNumber(reservationOwnerId))
    && normalizeInvoiceNumber(reservationOwnerId) === normalizeInvoiceNumber(targetOwnerId)
);

export const getInvoiceNumberTransitions = (drafts = []) => {
    const transitions = new Map();

    getCanonicalInvoiceNumberDrafts(drafts).forEach((draft) => {
        const ownerDocumentId = cleanInvoiceNumber(draft.id || draft.docId);
        const previousInvoiceNumber = cleanInvoiceNumber(draft.previousInvoiceNumber);
        const invoiceNumber = cleanInvoiceNumber(draft.invoiceNumber || draft.numeroFactura);

        if (
            !ownerDocumentId
            || !previousInvoiceNumber
            || normalizeInvoiceNumber(previousInvoiceNumber) === normalizeInvoiceNumber(invoiceNumber)
        ) {
            return;
        }

        transitions.set(`${ownerDocumentId.toLowerCase()}|${previousInvoiceNumber.toLowerCase()}`, {
            draft,
            ownerDocumentId,
            previousInvoiceNumber,
            invoiceNumber,
        });
    });

    return [...transitions.values()];
};
