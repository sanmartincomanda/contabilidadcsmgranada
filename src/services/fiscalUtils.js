import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';

export const PAYMENT_METHODS = [
    'BAC POS',
    'Banpro POS',
    'LAFISE POS',
    'Transferencia BAC',
    'Transferencia Banpro',
    'Transferencia Lafise',
    'Efectivo',
];

export const PURCHASE_PAYMENT_METHODS = [
    'Credito',
    'Transferencia',
    'Efectivo',
    'BAC POS',
    'Banpro POS',
    'LAFISE POS',
    'Cheque',
    'Otro',
];

export const money = (value) => {
    const parsed = Number(value ?? 0);
    if (!Number.isFinite(parsed)) return 0;
    return Math.round(parsed * 100) / 100;
};

export const computeFiscalAmounts = ({ subtotal = 0, iva = 0, total = 0 }) => {
    const normalizedTotal = money(total);
    const normalizedSubtotal = money(subtotal || (normalizedTotal ? normalizedTotal - money(iva) : 0));
    const normalizedIva = money(iva || Math.max(normalizedTotal - normalizedSubtotal, 0));

    return {
        subtotal: normalizedSubtotal,
        iva: normalizedIva,
        total: normalizedTotal || money(normalizedSubtotal + normalizedIva),
    };
};

export const computeRetentions = ({ subtotal = 0, retentionIr2 = 0, retentionMunicipal1 = 0 }) => {
    const base = money(subtotal);
    const ir = retentionIr2 === '' || retentionIr2 === null || retentionIr2 === undefined
        ? 0
        : money(retentionIr2);
    const municipal = retentionMunicipal1 === '' || retentionMunicipal1 === null || retentionMunicipal1 === undefined
        ? 0
        : money(retentionMunicipal1);

    return {
        retentionIr2: ir,
        retentionMunicipal1: municipal,
        retentionTotal: money(ir + municipal),
        retentionSuggestedIr2: money(base * 0.02),
        retentionSuggestedMunicipal1: money(base * 0.01),
    };
};

export const buildFiscalPayload = (values = {}) => {
    const fiscal = computeFiscalAmounts(values);
    const retentions = computeRetentions({
        subtotal: fiscal.subtotal,
        retentionIr2: values.retentionIr2,
        retentionMunicipal1: values.retentionMunicipal1,
    });

    return {
        amount: fiscal.subtotal,
        subtotal: fiscal.subtotal,
        iva: fiscal.iva,
        total: fiscal.total,
        retentionIr2: retentions.retentionIr2,
        retentionMunicipal1: retentions.retentionMunicipal1,
        retentionTotal: retentions.retentionTotal,
    };
};

export async function uploadInvoicePhoto(file, folder, docId) {
    if (!file) {
        return {
            fotoFacturaUrl: '',
            fotoFacturaPath: '',
        };
    }

    const extension = file.name?.includes('.') ? file.name.split('.').pop() : 'jpg';
    const safeDocId = String(docId || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '_');
    const storagePath = `${folder}/${safeDocId}.${extension}`;
    const storageRef = ref(storage, storagePath);

    await uploadBytes(storageRef, file, {
        contentType: file.type || 'application/octet-stream',
    });

    return {
        fotoFacturaUrl: await getDownloadURL(storageRef),
        fotoFacturaPath: storagePath,
    };
}
