import { collection, doc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { DEFAULT_BRANCH_ID, DEFAULT_BRANCH_NAME, DEFAULT_CASHBOX_NAME } from '../constants';

export const PETTY_CASH_COLLECTION = 'caja_chica_movimientos';
export const PETTY_CASH_PIN = '210397';
export const PETTY_CASH_ALERT_THRESHOLD = 3000;

export const normalizeCashAmount = (value) => {
    const parsed = Number(value ?? 0);
    if (!Number.isFinite(parsed)) return 0;
    return Math.round(parsed * 100) / 100;
};

const cleanForFirestore = (value) => {
    if (value === undefined) return null;
    if (value === null) return null;
    if (Array.isArray(value)) return value.map(cleanForFirestore);
    if (typeof value === 'object' && !(value instanceof Date)) {
        if (typeof value.toDate === 'function') return value;
        return Object.entries(value).reduce((acc, [key, entry]) => {
            if (entry !== undefined) acc[key] = cleanForFirestore(entry);
            return acc;
        }, {});
    }
    return value;
};

export const getPettyCashMovementDocId = (sourceCollection, sourceDocId, movementType = 'salida') => (
    `${movementType}_${sourceCollection || 'manual'}_${sourceDocId || Date.now()}`
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 140)
);

export const pettyCashMovementRef = (sourceCollection, sourceDocId, movementType = 'salida') => (
    doc(db, PETTY_CASH_COLLECTION, getPettyCashMovementDocId(sourceCollection, sourceDocId, movementType))
);

export const createPettyCashRef = () => doc(collection(db, PETTY_CASH_COLLECTION));

export const buildPettyCashMovementPayload = ({
    direction = 'salida',
    movementType,
    fecha,
    date,
    amount,
    description,
    descripcion,
    paymentType = 'EFECTIVO',
    paymentReference = '',
    sourceCollection = '',
    sourceDocId = '',
    linkedGastoDiarioId = '',
    linkedExpenseId = '',
    linkedPurchaseId = '',
    linkedPayableId = '',
    linkedAbonoId = '',
    supplier = '',
    proveedor = '',
    invoiceNumber = '',
    factura = '',
    category = '',
    subcategory = '',
    categoryLabel = '',
    supportFiles = [],
    fotoFacturaUrl = '',
    fotoFacturaPath = '',
    timestamp,
} = {}) => {
    const movementDate = fecha || date || new Date().toISOString().substring(0, 10);
    const normalizedAmount = normalizeCashAmount(amount);
    const isDeposit = direction === 'entrada';
    const safeDescription = description || descripcion || (isDeposit ? 'DEPOSITO CAJA CHICA' : 'SALIDA CAJA CHICA');
    const now = timestamp || Timestamp.now();

    return cleanForFirestore({
        cashboxName: DEFAULT_CASHBOX_NAME,
        caja: DEFAULT_CASHBOX_NAME,
        movementType: movementType || (isDeposit ? 'deposito' : 'salida'),
        direction,
        fecha: movementDate,
        date: movementDate,
        month: movementDate.substring(0, 7),
        amount: normalizedAmount,
        monto: normalizedAmount,
        signedAmount: isDeposit ? normalizedAmount : -normalizedAmount,
        paymentType,
        paymentReference,
        description: safeDescription,
        descripcion: safeDescription,
        sourceCollection,
        sourceDocId,
        linkedGastoDiarioId,
        linkedExpenseId,
        linkedPurchaseId,
        linkedPayableId,
        linkedAbonoId,
        supplier: supplier || proveedor,
        proveedor: proveedor || supplier,
        invoiceNumber: invoiceNumber || factura,
        factura: factura || invoiceNumber,
        category,
        subcategory,
        categoryLabel,
        supportFiles,
        fotoFacturaUrl,
        fotoFacturaPath,
        branch: DEFAULT_BRANCH_ID,
        branchName: DEFAULT_BRANCH_NAME,
        timestamp: now,
        createdAt: now,
        updatedAt: now,
    });
};
