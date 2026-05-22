import { collection, doc, Timestamp, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { DEFAULT_BRANCH_ID, DEFAULT_BRANCH_NAME, DEFAULT_CASHBOX_NAME, peso } from '../constants';

const MAX_BATCH_OPS = 400;
const DEFAULT_CASHBOX = DEFAULT_CASHBOX_NAME;

const getDateString = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (value?.toDate) return value.toDate().toISOString().substring(0, 10);
    return '';
};

const getMonthString = (item) => {
    const dateString = getDateString(item.date || item.fecha);
    if (dateString) return dateString.substring(0, 7);
    return item.month || item.mes || '';
};

const buildDiff = (current, patch) => {
    const diff = {};

    Object.entries(patch).forEach(([key, value]) => {
        if (value === undefined) return;

        const currentValue = current?.[key];

        if (value instanceof Timestamp) {
            if (!currentValue) diff[key] = value;
            return;
        }

        if (currentValue !== value) {
            diff[key] = value;
        }
    });

    return diff;
};

const chunk = (items, size) => {
    const result = [];
    for (let index = 0; index < items.length; index += size) {
        result.push(items.slice(index, index + size));
    }
    return result;
};

const commitOperations = async (operations) => {
    for (const group of chunk(operations, MAX_BATCH_OPS)) {
        const batch = writeBatch(db);

        group.forEach((operation) => {
            if (operation.mode === 'set') {
                batch.set(operation.ref, operation.data, operation.options || {});
                return;
            }

            batch.update(operation.ref, operation.data);
        });

        await batch.commit();
    }
};

export async function runOneBranchMigration(data) {
    const compras = data?.compras || [];
    const facturasPagar = data?.cuentas_por_pagar || [];
    const ingresos = data?.ingresos || [];
    const gastos = data?.gastos || [];
    const inventarios = data?.inventarios || [];
    const gastosDiarios = data?.gastosDiarios || [];

    const operations = [];
    let mirroredPurchasesCreated = 0;
    let updatedDocuments = 0;

    const comprasByFacturaId = new Map();

    compras.forEach((compra) => {
        const sourceFacturaId = compra.sourceFacturaId
            || compra.linkedPayableId
            || (typeof compra.id === 'string' && compra.id.startsWith('credito_') ? compra.id.replace('credito_', '') : '');

        if (sourceFacturaId) {
            comprasByFacturaId.set(sourceFacturaId, compra);
        }

        const compraPatch = buildDiff(compra, {
            branch: DEFAULT_BRANCH_ID,
            branchName: DEFAULT_BRANCH_NAME,
            month: compra.month || getMonthString(compra),
            paymentType: compra.paymentType || (sourceFacturaId ? 'credito' : (getDateString(compra.date || compra.fecha) ? 'contado' : 'legacy')),
        });

        if (Object.keys(compraPatch).length > 0) {
            operations.push({
                mode: 'update',
                ref: doc(db, 'compras', compra.id),
                data: compraPatch,
            });
            updatedDocuments += 1;
        }
    });

    facturasPagar.forEach((factura) => {
        const mirroredPurchaseId = `credito_${factura.id}`;
        const compraExistente = comprasByFacturaId.get(factura.id);
        const fecha = getDateString(factura.fecha || factura.date);
        const month = factura.month || (fecha ? fecha.substring(0, 7) : '');

        if (!compraExistente) {
            operations.push({
                mode: 'set',
                ref: doc(collection(db, 'compras'), mirroredPurchaseId),
                data: {
                    date: fecha || '',
                    month,
                    supplier: factura.proveedor || 'SIN PROVEEDOR',
                    invoiceNumber: factura.numero || 'S/N',
                    amount: peso(factura.monto),
                    branch: DEFAULT_BRANCH_ID,
                    branchName: DEFAULT_BRANCH_NAME,
                    paymentType: 'credito',
                    isInventoryCost: true,
                    sourceCollection: 'cuentas_por_pagar',
                    sourceFacturaId: factura.id,
                    linkedPayableId: factura.id,
                    timestamp: factura.timestamp || Timestamp.now(),
                },
                options: { merge: true },
            });
            mirroredPurchasesCreated += 1;
        } else {
            const compraPatch = buildDiff(compraExistente, {
                date: compraExistente.date || fecha || '',
                month: compraExistente.month || month,
                supplier: compraExistente.supplier || factura.proveedor || 'SIN PROVEEDOR',
                invoiceNumber: compraExistente.invoiceNumber || factura.numero || 'S/N',
                amount: peso(compraExistente.amount || factura.monto),
                branch: DEFAULT_BRANCH_ID,
                branchName: DEFAULT_BRANCH_NAME,
                paymentType: 'credito',
                isInventoryCost: true,
                sourceCollection: 'cuentas_por_pagar',
                sourceFacturaId: factura.id,
                linkedPayableId: factura.id,
            });

            if (Object.keys(compraPatch).length > 0) {
                operations.push({
                    mode: 'update',
                    ref: doc(db, 'compras', compraExistente.id),
                    data: compraPatch,
                });
                updatedDocuments += 1;
            }
        }

        const facturaPatch = buildDiff(factura, {
            month,
            branch: DEFAULT_BRANCH_ID,
            branchName: DEFAULT_BRANCH_NAME,
            sucursal: DEFAULT_BRANCH_NAME,
            paymentType: 'credito',
            isInventoryCost: true,
            mirroredToCompras: true,
            mirroredPurchaseId: compraExistente?.id || mirroredPurchaseId,
        });

        if (Object.keys(facturaPatch).length > 0) {
            operations.push({
                mode: 'update',
                ref: doc(db, 'cuentas_por_pagar', factura.id),
                data: facturaPatch,
            });
            updatedDocuments += 1;
        }
    });

    const branchCollections = [
        ['ingresos', ingresos],
        ['gastos', gastos],
        ['inventarios', inventarios],
    ];

    branchCollections.forEach(([collectionName, docs]) => {
        docs.forEach((item) => {
            const patch = buildDiff(item, {
                branch: DEFAULT_BRANCH_ID,
                branchName: DEFAULT_BRANCH_NAME,
            });

            if (Object.keys(patch).length > 0) {
                operations.push({
                    mode: 'update',
                    ref: doc(db, collectionName, item.id),
                    data: patch,
                });
                updatedDocuments += 1;
            }
        });
    });

    gastosDiarios.forEach((item) => {
        const patch = buildDiff(item, {
            sucursal: DEFAULT_BRANCH_ID,
            branchName: DEFAULT_BRANCH_NAME,
            caja: DEFAULT_CASHBOX,
        });

        if (Object.keys(patch).length > 0) {
            operations.push({
                mode: 'update',
                ref: doc(db, 'gastosDiarios', item.id),
                data: patch,
            });
            updatedDocuments += 1;
        }
    });

    if (operations.length === 0) {
        return {
            mirroredPurchasesCreated: 0,
            updatedDocuments: 0,
            operations: 0,
        };
    }

    await commitOperations(operations);

    return {
        mirroredPurchasesCreated,
        updatedDocuments,
        operations: operations.length,
    };
}
