import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';

const MAX_INVOICE_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const INVOICE_UPLOAD_TIMEOUT_MS = 60000;

export const SUPPORT_FILE_TYPES = [
    { key: 'invoice', label: 'Factura / soporte principal' },
    { key: 'retentionIr2', label: 'Retencion anticipo IR 2%' },
    { key: 'retentionMunicipal1', label: 'Retencion municipal 1%' },
];

const SUPPORT_FILE_LABELS = SUPPORT_FILE_TYPES.reduce((acc, item) => {
    acc[item.key] = item.label;
    return acc;
}, {});

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
    'EFECTIVO',
    'TRANSFERENCIA',
    'TARJETA BLACK MASTERCARD ***4660',
    'TARJETA AMEX BLACK',
    'TARJETA AMEX PRICESMART',
    'TARJETA LA COLONIA BAC',
    'TARJETA UNO BANPRO',
    'TARJETA BLACK BANPRO',
    'CREDITO',
];

export const normalizePaymentMethod = (value = '') => (
    String(value || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
);

export const isCreditPayment = (value = '') => normalizePaymentMethod(value) === 'CREDITO';

export const isCashPayment = (value = '') => normalizePaymentMethod(value) === 'EFECTIVO';

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

export const buildSupportPayload = ({
    url = '',
    path = '',
    source = 'manual',
    sourceCollection = '',
    sourceDocId = '',
    fileName = '',
    contentType = '',
    uploadedAt = null,
    type = 'invoice',
    label = '',
} = {}) => {
    const safeUrl = url || '';
    const safePath = path || '';
    const support = {
        type,
        label: label || SUPPORT_FILE_LABELS[type] || 'Soporte fiscal',
        url: safeUrl,
        path: safePath,
        source,
        sourceCollection,
        sourceDocId,
        fileName,
        contentType,
        uploadedAt: uploadedAt || new Date().toISOString(),
    };

    return {
        fotoFacturaUrl: safeUrl,
        fotoFacturaPath: safePath,
        support,
        supportFiles: safeUrl || safePath ? [support] : [],
    };
};

const normalizeSupportFile = (file = {}, fallbackType = 'invoice') => {
    const type = file.type || fallbackType;
    const url = file.url || file.fotoFacturaUrl || file.media?.url || '';
    const path = file.path || file.fotoFacturaPath || file.media?.path || '';

    return {
        type,
        label: file.label || SUPPORT_FILE_LABELS[type] || 'Soporte fiscal',
        url,
        path,
        source: file.source || 'manual',
        sourceCollection: file.sourceCollection || '',
        sourceDocId: file.sourceDocId || '',
        fileName: file.fileName || file.name || '',
        contentType: file.contentType || file.mimeType || file.media?.mimeType || '',
        uploadedAt: file.uploadedAt || null,
    };
};

export const getSupportFiles = (item = {}) => {
    const files = [];

    if (Array.isArray(item.supportFiles)) {
        item.supportFiles.forEach((file) => files.push(normalizeSupportFile(file)));
    }

    const legacy = normalizeSupportFile({
        ...(item.support || item.media || {}),
        url: item.fotoFacturaUrl || item.support?.url || item.media?.url,
        path: item.fotoFacturaPath || item.support?.path || item.media?.path,
    });

    if (legacy.url || legacy.path) {
        const alreadyExists = files.some((file) => (
            (legacy.path && file.path === legacy.path) || (legacy.url && file.url === legacy.url)
        ));
        if (!alreadyExists) files.unshift(legacy);
    }

    return files
        .filter((file) => file.url || file.path)
        .sort((left, right) => {
            const leftIndex = SUPPORT_FILE_TYPES.findIndex((itemType) => itemType.key === left.type);
            const rightIndex = SUPPORT_FILE_TYPES.findIndex((itemType) => itemType.key === right.type);
            return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
        });
};

const buildSupportFilesPayload = (supportFiles = []) => {
    const normalized = supportFiles.map((file) => normalizeSupportFile(file)).filter((file) => file.url || file.path);
    const primary = normalized.find((file) => file.type === 'invoice') || normalized[0] || {};

    return {
        fotoFacturaUrl: primary.url || '',
        fotoFacturaPath: primary.path || '',
        support: primary.url || primary.path ? primary : normalizeSupportFile(),
        supportFiles: normalized,
    };
};

export const getSupportUrl = (item = {}) => (
    getSupportFiles(item)[0]?.url || item.url || ''
);

export const getSupportPath = (item = {}) => (
    getSupportFiles(item)[0]?.path || item.path || ''
);

export const hasSupport = (item = {}) => getSupportFiles(item).length > 0;

export const isPdfSupportRecord = (item = {}) => {
    const first = getSupportFiles(item)[0] || normalizeSupportFile(item);
    const source = `${first.path || getSupportPath(item)} ${first.url || getSupportUrl(item)} ${first.contentType || item.support?.contentType || item.media?.mimeType || ''}`.toLowerCase();
    return source.includes('.pdf') || source.includes('application/pdf');
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
        return buildSupportPayload();
    }

    if (file.size > MAX_INVOICE_FILE_SIZE_BYTES) {
        throw new Error('La foto o PDF supera 10 MB. Comprimilo o envia una imagen mas liviana.');
    }

    const uploaded = await uploadSupportFile(file, folder, docId, 'invoice');
    return buildSupportFilesPayload([uploaded]);
}

export async function uploadSupportFile(file, folder, docId, type = 'invoice') {
    if (!file) return null;

    if (file.size > MAX_INVOICE_FILE_SIZE_BYTES) {
        throw new Error('La foto o PDF supera 10 MB. Comprimilo o envia una imagen mas liviana.');
    }

    const extension = file.name?.includes('.') ? file.name.split('.').pop() : 'jpg';
    const safeDocId = String(docId || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeName = sanitizeFileName(file.name);
    const safeType = String(type || 'invoice').replace(/[^a-zA-Z0-9_-]/g, '_');
    const storagePath = `${folder}/${safeDocId}/${safeType}/${Date.now()}_${safeName}.${extension}`;
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

        return normalizeSupportFile({
            url: await getDownloadURL(snapshot.ref),
            path: storagePath,
            source: 'manual',
            fileName: file.name || '',
            contentType: file.type || 'application/octet-stream',
            type,
        });
    } catch (error) {
        throw new Error(getStorageErrorMessage(error));
    }
}

export async function uploadFiscalSupportFiles(filesByType = {}, folder, docId, existingItem = {}) {
    const selectedEntries = SUPPORT_FILE_TYPES
        .map(({ key }) => [key, filesByType[key]])
        .filter(([, file]) => Boolean(file));

    if (selectedEntries.length === 0) return {};

    const uploaded = [];
    for (const [type, file] of selectedEntries) {
        uploaded.push(await uploadSupportFile(file, folder, docId, type));
    }

    const replacedTypes = new Set(uploaded.map((file) => file.type));
    const preserved = getSupportFiles(existingItem).filter((file) => !replacedTypes.has(file.type));

    return buildSupportFilesPayload([...preserved, ...uploaded]);
}
