import { serverTimestamp } from 'firebase/firestore';

export const CLIENTS_COLLECTION = 'clientes_facturacion';

export const normalizeClientText = (value = '') => (
    String(value || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
);

export const slugifyClient = (value = '') => (
    normalizeClientText(value)
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'SIN-NOMBRE'
);

export const createEmptyClientForm = (overrides = {}) => ({
    id: '',
    code: '',
    name: '',
    ruc: '',
    address: '',
    phone: '',
    email: '',
    notes: '',
    active: true,
    ...overrides,
});

export const buildClientCode = (client = {}) => {
    const ruc = String(client.ruc || client.customerRfc || client.rfc || '').trim();
    if (ruc) return `CLI-RUC-${slugifyClient(ruc)}`;
    return `CLI-${slugifyClient(client.name || client.nombre || client.customerName || '')}`;
};

export const normalizeClientRecord = (client = {}) => {
    const name = String(client.name || client.nombre || client.customerName || '').trim();
    const ruc = String(client.ruc || client.customerRfc || client.rfc || '').trim();
    const address = String(client.address || client.direccion || client.customerAddress || '').trim();
    const code = String(client.code || client.id || buildClientCode({ name, ruc })).trim();

    return {
        ...client,
        id: client.id || client.docId || code,
        code,
        name,
        ruc,
        address,
        phone: String(client.phone || client.telefono || '').trim(),
        email: String(client.email || client.correo || '').trim(),
        notes: String(client.notes || client.notas || '').trim(),
        active: client.active !== false,
        normalizedName: normalizeClientText(name),
        normalizedRuc: normalizeClientText(ruc),
    };
};

export const buildClientPayload = (form = {}, source = 'manual') => {
    const normalized = normalizeClientRecord(form);
    return {
        code: normalized.code || buildClientCode(normalized),
        name: normalized.name,
        normalizedName: normalizeClientText(normalized.name),
        ruc: normalized.ruc,
        normalizedRuc: normalizeClientText(normalized.ruc),
        address: normalized.address,
        phone: normalized.phone,
        email: normalized.email,
        notes: normalized.notes,
        active: normalized.active !== false,
        source,
        updatedAt: serverTimestamp(),
        createdAt: form.createdAt || serverTimestamp(),
    };
};
