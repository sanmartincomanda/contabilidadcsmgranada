import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';

const MAX_INVOICE_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const INVOICE_UPLOAD_TIMEOUT_MS = 60000;

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

const getStorageErrorMessage = (error) => {
    const code = error?.code || '';
    if (code === 'storage/unauthorized') {
        return 'Firebase Storage rechazo la subida. Revisa que Storage este activo y que las reglas permitan subir archivos a usuarios autenticados.';
    }
    if (code === 'storage/canceled') {
        return 'La subida de la foto fue cancelada porque tardo demasiado. Intenta con una imagen mas liviana o vuelve a intentarlo.';
    }
    if (code === 'storage/retry-limit-exceeded') {
        return 'La conexion con Firebase Storage esta lenta o inestable. Intenta nuevamente.';
    }
    return error?.message || 'No se pudo subir la foto a Firebase Storage.';
};

const sanitizeFileName = (fileName = 'soporte') => (
    String(fileName)
        .replace(/\.[^/.]+$/, '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || 'soporte'
);

export async function uploadInvoicePhoto(file, folder, docId) {
    if (!file) {
        return {
            fotoFacturaUrl: '',
            fotoFacturaPath: '',
        };
    }

    if (file.size > MAX_INVOICE_FILE_SIZE_BYTES) {
        throw new Error('La foto o PDF supera 10 MB. Comprimilo o envia una imagen mas liviana.');
    }

    const extension = file.name?.includes('.') ? file.name.split('.').pop() : 'jpg';
    const safeDocId = String(docId || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeName = sanitizeFileName(file.name);
    const storagePath = `${folder}/${safeDocId}/${Date.now()}_${safeName}.${extension}`;
    const storageRef = ref(storage, storagePath);

    try {
        const snapshot = await new Promise((resolve, reject) => {
            let settled = false;
            const uploadTask = uploadBytesResumable(storageRef, file, {
                contentType: file.type || 'application/octet-stream',
            });
            const timer = window.setTimeout(() => {
                if (settled) return;
                settled = true;
                uploadTask.cancel();
                reject(new Error('La subida de la foto tardo mas de 60 segundos.'));
            }, INVOICE_UPLOAD_TIMEOUT_MS);

            uploadTask.on(
                'state_changed',
                null,
                (error) => {
                    if (settled) return;
                    settled = true;
                    window.clearTimeout(timer);
                    reject(error);
                },
                () => {
                    if (settled) return;
                    settled = true;
                    window.clearTimeout(timer);
                    resolve(uploadTask.snapshot);
                }
            );
        });

        return {
            fotoFacturaUrl: await getDownloadURL(snapshot.ref),
            fotoFacturaPath: storagePath,
        };
    } catch (error) {
        throw new Error(getStorageErrorMessage(error));
    }
}
