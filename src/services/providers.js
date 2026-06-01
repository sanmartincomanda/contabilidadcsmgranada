import {
    collection,
    doc,
    getDoc,
    getDocs,
    serverTimestamp,
    setDoc,
    writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';

export const normalizeProviderName = (value = '') => (
    String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase()
);

const providerDocId = (providerName = '') => {
    const normalized = normalizeProviderName(providerName);
    return normalized
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 140) || 'proveedor_sin_nombre';
};

export const getProviderCode = (providerName = '') => {
    const normalized = normalizeProviderName(providerName);
    let hash = 0;
    for (let index = 0; index < normalized.length; index += 1) {
        hash = ((hash * 31) + normalized.charCodeAt(index)) % 100000;
    }
    return `PRV-${String(hash || 1).padStart(5, '0')}`;
};

export const getProviderDisplayName = (provider = {}) => normalizeProviderName(
    provider.nombre || provider.name || provider.supplier || provider.proveedor
);

const buildProviderPayload = (providerName, source = 'manual') => {
    const nombre = normalizeProviderName(providerName);
    return {
        nombre,
        name: nombre,
        normalizedName: nombre,
        code: getProviderCode(nombre),
        codigo: getProviderCode(nombre),
        source,
        updatedAt: serverTimestamp(),
    };
};

export async function upsertProviderByName(providerName, options = {}) {
    const nombre = normalizeProviderName(providerName);
    if (!nombre) throw new Error('Proveedor vacio.');

    const providerRef = doc(db, 'proveedores', providerDocId(nombre));
    const snapshot = await getDoc(providerRef);
    const payload = buildProviderPayload(nombre, options.source || 'manual');

    if (snapshot.exists()) {
        const existing = snapshot.data();
        await setDoc(providerRef, {
            ...payload,
            createdAt: existing.createdAt || serverTimestamp(),
        }, { merge: true });
    } else {
        await setDoc(providerRef, {
            ...payload,
            createdAt: serverTimestamp(),
        });
    }

    return {
        id: providerRef.id,
        ...payload,
    };
}

const providerNamesFromRecord = (record = {}) => [
    record.supplier,
    record.proveedor,
    record.provider,
    record.nombreProveedor,
].map(normalizeProviderName).filter(Boolean);

export async function migrateProvidersFromAccountingRecords() {
    const collectionNames = ['gastos', 'compras', 'cuentas_por_pagar'];
    const names = new Set();

    for (const collectionName of collectionNames) {
        const snapshot = await getDocs(collection(db, collectionName));
        snapshot.docs.forEach((recordDoc) => {
            providerNamesFromRecord(recordDoc.data()).forEach((name) => names.add(name));
        });
    }

    const existingProvidersSnapshot = await getDocs(collection(db, 'proveedores'));
    existingProvidersSnapshot.docs.forEach((providerDoc) => {
        providerNamesFromRecord(providerDoc.data()).forEach((name) => names.add(name));
    });

    const sortedNames = [...names].sort((left, right) => left.localeCompare(right, 'es'));
    let createdOrUpdated = 0;

    for (let index = 0; index < sortedNames.length; index += 450) {
        const batch = writeBatch(db);
        sortedNames.slice(index, index + 450).forEach((name) => {
            const providerRef = doc(db, 'proveedores', providerDocId(name));
            batch.set(providerRef, {
                ...buildProviderPayload(name, 'migration'),
                createdAt: serverTimestamp(),
            }, { merge: true });
            createdOrUpdated += 1;
        });
        await batch.commit();
    }

    return {
        total: sortedNames.length,
        createdOrUpdated,
    };
}
