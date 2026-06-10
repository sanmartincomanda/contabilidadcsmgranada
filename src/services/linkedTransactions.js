import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    serverTimestamp,
    where,
    writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { DEFAULT_PURCHASE_CATEGORY_ID, buildExpenseCategoryPayload, getExpenseCategoryFromRecord } from './expenseCategories';

const uniqueRefs = (refs) => {
    const refMap = new Map();
    refs.filter(Boolean).forEach((ref) => refMap.set(ref.path, ref));
    return Array.from(refMap.values());
};

const addExistingRef = async (refs, collectionName, id) => {
    if (!id) return;
    const recordRef = doc(db, collectionName, id);
    const recordSnap = await getDoc(recordRef);
    if (recordSnap.exists()) {
        refs.push(recordRef);
    }
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

const normalizeAmount = (value) => {
    const parsed = Number(value ?? 0);
    if (!Number.isFinite(parsed)) return 0;
    return Math.round(parsed * 100) / 100;
};

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const buildPayableMirrorPayload = (purchaseData, updateData, payableData = {}) => {
    const merged = { ...purchaseData, ...updateData };
    const categoryPayload = buildExpenseCategoryPayload(getExpenseCategoryFromRecord(merged, DEFAULT_PURCHASE_CATEGORY_ID), DEFAULT_PURCHASE_CATEGORY_ID);
    const newTotal = normalizeAmount(firstDefined(merged.total, merged.monto, merged.amount));
    const previousTotal = normalizeAmount(firstDefined(payableData.total, payableData.monto, purchaseData.total, purchaseData.amount));
    const previousSaldo = normalizeAmount(firstDefined(payableData.saldo, newTotal));
    const saldo = normalizeAmount(Math.max(previousSaldo + (newTotal - previousTotal), 0));

    return cleanForFirestore({
        fecha: firstDefined(merged.date, merged.fecha),
        month: merged.month || String(firstDefined(merged.date, merged.fecha) || '').substring(0, 7),
        proveedor: firstDefined(merged.supplier, merged.proveedor),
        numero: firstDefined(merged.invoiceNumber, merged.numero, merged.factura),
        factura: firstDefined(merged.invoiceNumber, merged.numero, merged.factura),
        purchaseFolio: merged.purchaseFolio || '',
        purchaseSeries: merged.purchaseSeries || '',
        descripcion: firstDefined(merged.description, merged.descripcion),
        ...categoryPayload,
        monto: newTotal,
        saldo,
        amount: normalizeAmount(firstDefined(merged.amount, merged.subtotal, newTotal)),
        subtotal: normalizeAmount(firstDefined(merged.subtotal, merged.amount, newTotal)),
        subtotalExento: normalizeAmount(merged.subtotalExento),
        subtotalGravado: normalizeAmount(merged.subtotalGravado),
        iva: normalizeAmount(merged.iva),
        total: newTotal,
        retentionIr2: normalizeAmount(merged.retentionIr2),
        retentionMunicipal1: normalizeAmount(merged.retentionMunicipal1),
        retencionIr2: normalizeAmount(merged.retencionIr2 ?? merged.retentionIr2),
        retencionMunicipal1: normalizeAmount(merged.retencionMunicipal1 ?? merged.retentionMunicipal1),
        estado: saldo <= 0 ? 'pagado' : saldo < newTotal ? 'parcial' : 'pendiente',
        isInventoryCost: merged.isInventoryCost ?? true,
        mirroredToCompras: true,
    });
};

const buildExpensePayableMirrorPayload = (expenseData, updateData, payableData = {}) => {
    const merged = { ...expenseData, ...updateData };
    const categoryPayload = buildExpenseCategoryPayload(getExpenseCategoryFromRecord(merged));
    const newTotal = normalizeAmount(firstDefined(merged.total, merged.monto, merged.amount));
    const previousTotal = normalizeAmount(firstDefined(payableData.total, payableData.monto, expenseData.total, expenseData.amount));
    const previousSaldo = normalizeAmount(firstDefined(payableData.saldo, newTotal));
    const saldo = normalizeAmount(Math.max(previousSaldo + (newTotal - previousTotal), 0));
    const date = firstDefined(merged.date, merged.fecha);

    return cleanForFirestore({
        fecha: date,
        month: merged.month || String(date || '').substring(0, 7),
        proveedor: firstDefined(merged.supplier, merged.proveedor),
        proveedorId: merged.providerId || merged.proveedorId || '',
        providerCode: merged.providerCode || merged.codigoProveedor || '',
        codigoProveedor: merged.codigoProveedor || merged.providerCode || '',
        numero: firstDefined(merged.invoiceNumber, merged.numero, merged.factura),
        factura: firstDefined(merged.invoiceNumber, merged.numero, merged.factura),
        descripcion: firstDefined(merged.description, merged.descripcion),
        ...categoryPayload,
        monto: newTotal,
        saldo,
        amount: normalizeAmount(firstDefined(merged.amount, merged.subtotal, newTotal)),
        subtotal: normalizeAmount(firstDefined(merged.subtotal, merged.amount, newTotal)),
        iva: normalizeAmount(merged.iva),
        total: newTotal,
        retentionIr2: normalizeAmount(merged.retentionIr2),
        retentionMunicipal1: normalizeAmount(merged.retentionMunicipal1),
        retencionIr2: normalizeAmount(merged.retencionIr2 ?? merged.retentionIr2),
        retencionMunicipal1: normalizeAmount(merged.retencionMunicipal1 ?? merged.retentionMunicipal1),
        estado: saldo <= 0 ? 'pagado' : saldo < newTotal ? 'parcial' : 'pendiente',
        isInventoryCost: false,
        isOperatingExpense: true,
        mirroredToGastos: true,
    });
};

const buildGastoMirrorPayload = (purchaseData, updateData) => {
    const merged = { ...purchaseData, ...updateData };
    const categoryPayload = buildExpenseCategoryPayload(getExpenseCategoryFromRecord(merged, DEFAULT_PURCHASE_CATEGORY_ID), DEFAULT_PURCHASE_CATEGORY_ID);
    const total = normalizeAmount(firstDefined(merged.total, merged.monto, merged.amount));
    const date = firstDefined(merged.date, merged.fecha);

    return cleanForFirestore({
        fecha: date,
        month: merged.month || String(date || '').substring(0, 7),
        proveedor: firstDefined(merged.supplier, merged.proveedor),
        factura: firstDefined(merged.invoiceNumber, merged.numero, merged.factura),
        descripcion: firstDefined(merged.description, merged.descripcion),
        monto: total,
        amount: normalizeAmount(firstDefined(merged.amount, merged.subtotal, total)),
        subtotal: normalizeAmount(firstDefined(merged.subtotal, merged.amount, total)),
        subtotalExento: normalizeAmount(merged.subtotalExento),
        subtotalGravado: normalizeAmount(merged.subtotalGravado),
        iva: normalizeAmount(merged.iva),
        total,
        retentionIr2: normalizeAmount(merged.retentionIr2),
        retentionMunicipal1: normalizeAmount(merged.retentionMunicipal1),
        retencionIr2: normalizeAmount(merged.retencionIr2 ?? merged.retentionIr2),
        retencionMunicipal1: normalizeAmount(merged.retencionMunicipal1 ?? merged.retentionMunicipal1),
        ...categoryPayload,
        tipo: 'Compra',
    });
};

const getBlockingAbonos = async (facturaIds) => {
    if (!facturaIds.length) return [];

    const facturaIdSet = new Set(facturaIds);
    const abonosSnap = await getDocs(collection(db, 'abonos_pagar'));

    return abonosSnap.docs
        .map((abonoDoc) => ({ id: abonoDoc.id, ...abonoDoc.data() }))
        .filter((abono) =>
            (abono.detalleAfectado || []).some((detalle) => facturaIdSet.has(detalle?.id))
        );
};

const findPurchaseRefsForPayable = async (payableId, mirroredPurchaseId) => {
    const purchaseRefs = [];

    await addExistingRef(purchaseRefs, 'compras', mirroredPurchaseId);

    const linkedQueries = [
        query(collection(db, 'compras'), where('linkedPayableId', '==', payableId)),
        query(collection(db, 'compras'), where('sourceFacturaId', '==', payableId)),
    ];

    for (const linkedQuery of linkedQueries) {
        const purchaseSnap = await getDocs(linkedQuery);
        purchaseSnap.docs.forEach((purchaseDoc) => purchaseRefs.push(purchaseDoc.ref));
    }

    return uniqueRefs(purchaseRefs);
};

const findPayableRefsForPurchase = async (purchaseId, purchaseData) => {
    const payableRefs = [];

    await addExistingRef(payableRefs, 'cuentas_por_pagar', purchaseData?.linkedPayableId);
    await addExistingRef(payableRefs, 'cuentas_por_pagar', purchaseData?.sourceFacturaId);

    const linkedQueries = [
        query(collection(db, 'cuentas_por_pagar'), where('mirroredPurchaseId', '==', purchaseId)),
    ];

    for (const linkedQuery of linkedQueries) {
        const payableSnap = await getDocs(linkedQuery);
        payableSnap.docs.forEach((payableDoc) => payableRefs.push(payableDoc.ref));
    }

    return uniqueRefs(payableRefs);
};

const findExpenseRefsForPayable = async (payableId, mirroredExpenseId) => {
    const expenseRefs = [];

    await addExistingRef(expenseRefs, 'gastos', mirroredExpenseId);

    const linkedQueries = [
        query(collection(db, 'gastos'), where('linkedPayableId', '==', payableId)),
        query(collection(db, 'gastos'), where('sourceFacturaId', '==', payableId)),
    ];

    for (const linkedQuery of linkedQueries) {
        const expenseSnap = await getDocs(linkedQuery);
        expenseSnap.docs.forEach((expenseDoc) => expenseRefs.push(expenseDoc.ref));
    }

    return uniqueRefs(expenseRefs);
};

const findPayableRefsForExpense = async (expenseId, expenseData) => {
    const payableRefs = [];

    await addExistingRef(payableRefs, 'cuentas_por_pagar', expenseData?.linkedPayableId);
    await addExistingRef(payableRefs, 'cuentas_por_pagar', expenseData?.sourceFacturaId);

    const linkedQueries = [
        query(collection(db, 'cuentas_por_pagar'), where('linkedExpenseId', '==', expenseId)),
        query(collection(db, 'cuentas_por_pagar'), where('mirroredExpenseId', '==', expenseId)),
    ];

    for (const linkedQuery of linkedQueries) {
        const payableSnap = await getDocs(linkedQuery);
        payableSnap.docs.forEach((payableDoc) => payableRefs.push(payableDoc.ref));
    }

    return uniqueRefs(payableRefs);
};

const findGastoRefsForPurchase = async (purchaseId, purchaseData) => {
    const gastoRefs = [];

    await addExistingRef(gastoRefs, 'gastosDiarios', purchaseData?.sourceGastoDiarioId);

    const gastosSnap = await getDocs(
        query(collection(db, 'gastosDiarios'), where('linkedPurchaseId', '==', purchaseId))
    );
    gastosSnap.docs.forEach((gastoDoc) => gastoRefs.push(gastoDoc.ref));

    return uniqueRefs(gastoRefs);
};

export async function updatePurchaseTransaction(purchaseId, updateData, options = {}) {
    const purchaseRef = doc(db, 'compras', purchaseId);
    const purchaseSnap = await getDoc(purchaseRef);

    if (!purchaseSnap.exists()) {
        return { updated: false, missing: true };
    }

    const purchaseData = purchaseSnap.data();
    const cleanUpdate = cleanForFirestore(updateData);
    const payableRefs = await findPayableRefsForPurchase(purchaseId, purchaseData);
    const gastoRefs = await findGastoRefsForPurchase(purchaseId, purchaseData);

    const batch = writeBatch(db);

    if (options?.previousData) {
        batch.set(doc(collection(db, 'historial_ediciones')), {
            action: 'update',
            collectionName: 'compras',
            recordId: purchaseId,
            previousData: cleanForFirestore(options.previousData),
            newData: cleanForFirestore({ ...options.previousData, ...cleanUpdate }),
            changedFields: Object.keys(cleanUpdate),
            changedAt: serverTimestamp(),
        });
    }

    batch.update(purchaseRef, {
        ...cleanUpdate,
        updatedAt: serverTimestamp(),
    });

    for (const payableRef of payableRefs) {
        const payableSnap = await getDoc(payableRef);
        const payableData = payableSnap.exists() ? payableSnap.data() : {};
        batch.update(payableRef, {
            ...buildPayableMirrorPayload(purchaseData, cleanUpdate, payableData),
            updatedAt: serverTimestamp(),
        });
    }

    for (const gastoRef of gastoRefs) {
        batch.update(gastoRef, {
            ...buildGastoMirrorPayload(purchaseData, cleanUpdate),
            updatedAt: serverTimestamp(),
        });
    }

    await batch.commit();

    return {
        updated: true,
        linkedPayableIds: payableRefs.map((payableRef) => payableRef.id),
        linkedGastoDiarioIds: gastoRefs.map((gastoRef) => gastoRef.id),
    };
}

export async function updateExpenseTransaction(expenseId, updateData, options = {}) {
    const expenseRef = doc(db, 'gastos', expenseId);
    const expenseSnap = await getDoc(expenseRef);

    if (!expenseSnap.exists()) {
        return { updated: false, missing: true };
    }

    const expenseData = expenseSnap.data();
    const cleanUpdate = cleanForFirestore(updateData);
    const payableRefs = await findPayableRefsForExpense(expenseId, expenseData);
    const batch = writeBatch(db);

    if (options?.previousData) {
        batch.set(doc(collection(db, 'historial_ediciones')), {
            action: 'update',
            collectionName: 'gastos',
            recordId: expenseId,
            previousData: cleanForFirestore(options.previousData),
            newData: cleanForFirestore({ ...options.previousData, ...cleanUpdate }),
            changedFields: Object.keys(cleanUpdate),
            changedAt: serverTimestamp(),
        });
    }

    batch.update(expenseRef, {
        ...cleanUpdate,
        updatedAt: serverTimestamp(),
    });

    for (const payableRef of payableRefs) {
        const payableSnap = await getDoc(payableRef);
        const payableData = payableSnap.exists() ? payableSnap.data() : {};
        batch.update(payableRef, {
            ...buildExpensePayableMirrorPayload(expenseData, cleanUpdate, payableData),
            updatedAt: serverTimestamp(),
        });
    }

    await batch.commit();

    return {
        updated: true,
        linkedPayableIds: payableRefs.map((payableRef) => payableRef.id),
    };
}

export async function deletePayableTransaction(payableId) {
    const payableRef = doc(db, 'cuentas_por_pagar', payableId);
    const payableSnap = await getDoc(payableRef);

    if (!payableSnap.exists()) {
        return { deleted: false, missing: true };
    }

    const payableData = payableSnap.data();
    const blockingAbonos = await getBlockingAbonos([payableId]);

    if (blockingAbonos.length) {
        return {
            deleted: false,
            blocked: true,
            blockingAbonos,
        };
    }

    const purchaseRefs = await findPurchaseRefsForPayable(
        payableId,
        payableData?.mirroredPurchaseId
    );
    const expenseRefs = await findExpenseRefsForPayable(
        payableId,
        payableData?.mirroredExpenseId || payableData?.linkedExpenseId
    );

    const batch = writeBatch(db);
    batch.delete(payableRef);
    purchaseRefs.forEach((purchaseRef) => batch.delete(purchaseRef));
    expenseRefs.forEach((expenseRef) => batch.delete(expenseRef));
    await batch.commit();

    return {
        deleted: true,
        linkedPurchaseIds: purchaseRefs.map((purchaseRef) => purchaseRef.id),
        linkedExpenseIds: expenseRefs.map((expenseRef) => expenseRef.id),
    };
}

export async function deleteExpenseTransaction(expenseId) {
    const expenseRef = doc(db, 'gastos', expenseId);
    const expenseSnap = await getDoc(expenseRef);

    if (!expenseSnap.exists()) {
        return { deleted: false, missing: true };
    }

    const expenseData = expenseSnap.data();
    const payableRefs = await findPayableRefsForExpense(expenseId, expenseData);
    const blockingAbonos = await getBlockingAbonos(payableRefs.map((payableRef) => payableRef.id));

    if (blockingAbonos.length) {
        return {
            deleted: false,
            blocked: true,
            blockingAbonos,
        };
    }

    const batch = writeBatch(db);
    batch.delete(expenseRef);
    payableRefs.forEach((payableRef) => batch.delete(payableRef));
    await batch.commit();

    return {
        deleted: true,
        linkedPayableIds: payableRefs.map((payableRef) => payableRef.id),
    };
}

export async function deletePurchaseTransaction(purchaseId) {
    const purchaseRef = doc(db, 'compras', purchaseId);
    const purchaseSnap = await getDoc(purchaseRef);

    if (!purchaseSnap.exists()) {
        return { deleted: false, missing: true };
    }

    const purchaseData = purchaseSnap.data();
    const payableRefs = await findPayableRefsForPurchase(purchaseId, purchaseData);
    const blockingAbonos = await getBlockingAbonos(payableRefs.map((payableRef) => payableRef.id));

    if (blockingAbonos.length) {
        return {
            deleted: false,
            blocked: true,
            blockingAbonos,
        };
    }

    const gastoRefs = await findGastoRefsForPurchase(purchaseId, purchaseData);

    const batch = writeBatch(db);
    batch.delete(purchaseRef);
    payableRefs.forEach((payableRef) => batch.delete(payableRef));
    gastoRefs.forEach((gastoRef) => batch.delete(gastoRef));
    await batch.commit();

    return {
        deleted: true,
        linkedPayableIds: payableRefs.map((payableRef) => payableRef.id),
        linkedGastoDiarioIds: gastoRefs.map((gastoRef) => gastoRef.id),
    };
}
