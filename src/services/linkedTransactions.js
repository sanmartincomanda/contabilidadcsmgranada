import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    where,
    writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';

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

const findGastoRefsForPurchase = async (purchaseId, purchaseData) => {
    const gastoRefs = [];

    await addExistingRef(gastoRefs, 'gastosDiarios', purchaseData?.sourceGastoDiarioId);

    const gastosSnap = await getDocs(
        query(collection(db, 'gastosDiarios'), where('linkedPurchaseId', '==', purchaseId))
    );
    gastosSnap.docs.forEach((gastoDoc) => gastoRefs.push(gastoDoc.ref));

    return uniqueRefs(gastoRefs);
};

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

    const batch = writeBatch(db);
    batch.delete(payableRef);
    purchaseRefs.forEach((purchaseRef) => batch.delete(purchaseRef));
    await batch.commit();

    return {
        deleted: true,
        linkedPurchaseIds: purchaseRefs.map((purchaseRef) => purchaseRef.id),
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
