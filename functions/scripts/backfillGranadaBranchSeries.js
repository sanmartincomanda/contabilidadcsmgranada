const fs = require('node:fs');
const admin = require('firebase-admin');

const PROJECT_ID = 'sistema-contable-csm-granada';
const DEFAULT_KEY_PATH = 'C:\\SICAR\\keys\\firebase-adminsdk.json';

const GRANADA_BRANCH = {
  branch: 'granada',
  branchId: 'granada',
  branchCode: 'GRANADA',
  branchName: 'CARNES SAN MARTIN GRANADA',
  sucursal: 'granada',
  sucursalNombre: 'CARNES SAN MARTIN GRANADA',
};

const COLLECTIONS = [
  { name: 'ingresos' },
  { name: 'gastos' },
  { name: 'compras' },
  { name: 'cuentas_por_pagar' },
  { name: 'gastosDiarios' },
  { name: 'caja_chica_movimientos' },
  { name: 'abonos_pagar' },
  { name: 'cierres_caja' },
  { name: 'depositos_bancarios' },
  { name: 'diferencias_caja' },
  { name: 'sicar_cierres_caja' },
  { name: 'sicar_facturas_membretadas' },
  { name: 'facturas_membretadas_ventas', documentType: 'invoice' },
  { name: 'recibos_caja_membretados', documentType: 'receipt' },
];

function initFirebase() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(DEFAULT_KEY_PATH)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = DEFAULT_KEY_PATH;
  }

  if (admin.apps.length > 0) return admin.firestore();

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID || PROJECT_ID,
  });

  return admin.firestore();
}

function hasBranch(data = {}) {
  return Boolean(data.branch || data.branchId || data.sucursal || data.branchName);
}

function buildPatch(data = {}, documentType = '') {
  const patch = {};

  if (!hasBranch(data)) Object.assign(patch, GRANADA_BRANCH);
  else {
    if (!data.branchId) patch.branchId = data.branch || data.sucursal || GRANADA_BRANCH.branchId;
    if (!data.branch) patch.branch = data.branchId || data.sucursal || GRANADA_BRANCH.branch;
    if (!data.branchCode) patch.branchCode = GRANADA_BRANCH.branchCode;
    if (!data.branchName) patch.branchName = GRANADA_BRANCH.branchName;
  }

  if (documentType === 'invoice') {
    const number = String(data.invoiceNumber || data.numeroFactura || data.document || '').trim();
    if (!data.invoiceSeries) patch.invoiceSeries = 'A';
    if (!data.documentSeries) patch.documentSeries = 'A';
    if (!data.documentDisplayNumber && number) patch.documentDisplayNumber = `A-${number}`;
  }

  if (documentType === 'receipt') {
    const number = String(data.receiptNumber || data.numeroRecibo || data.document || '').trim();
    if (!data.receiptSeries) patch.receiptSeries = 'A';
    if (!data.documentSeries) patch.documentSeries = 'A';
    if (!data.documentDisplayNumber && number) patch.documentDisplayNumber = `A-${number}`;
  }

  if (!data.branchMigratedAt && Object.keys(patch).length) {
    patch.branchMigratedAt = admin.firestore.FieldValue.serverTimestamp();
    patch.branchMigrationVersion = 1;
  }

  return patch;
}

async function main() {
  const db = initFirebase();
  let totalUpdated = 0;

  for (const config of COLLECTIONS) {
    const snapshot = await db.collection(config.name).get();
    let batch = db.batch();
    let pending = 0;
    let updated = 0;

    for (const docSnap of snapshot.docs) {
      const patch = buildPatch(docSnap.data() || {}, config.documentType);
      if (!Object.keys(patch).length) continue;
      batch.set(docSnap.ref, patch, { merge: true });
      pending += 1;
      updated += 1;

      if (pending >= 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }

    if (pending > 0) await batch.commit();
    totalUpdated += updated;
    console.log(`${config.name}: ${updated} documento(s) actualizados.`);
  }

  console.log(`Backfill completado. Total actualizado: ${totalUpdated}.`);
}

main().catch((error) => {
  console.error('Error ejecutando backfill Granada Serie A:', error);
  process.exitCode = 1;
});
