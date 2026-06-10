const path = require('node:path');
const { pathToFileURL } = require('node:url');
const admin = require('firebase-admin');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'sistema-contable-csm-granada';
const APPLY = process.argv.includes('--apply');
const LIMIT_ARG = process.argv.find((arg) => arg.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : 0;

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: PROJECT_ID,
  });
}

const db = admin.firestore();

const normalizeValue = (value) => String(value || '').trim();

const categoryFieldsChanged = (data, payload) => (
  normalizeValue(data.category || data.categoria) !== payload.category
  || normalizeValue(data.subcategory || data.subcategoria) !== payload.subcategory
  || normalizeValue(data.categoryLabel) !== payload.categoryLabel
);

const shouldSkip = (collectionName, data) => {
  if (collectionName === 'gastosDiarios' && normalizeValue(data.tipo).toUpperCase() === 'ABONO') return true;
  return false;
};

const resolveFallback = (collectionName, data, defaults) => {
  if (collectionName === 'compras') return defaults.DEFAULT_PURCHASE_CATEGORY_ID;
  if (collectionName === 'gastos') return defaults.DEFAULT_EXPENSE_CATEGORY_ID;
  if (collectionName === 'presupuestos') return defaults.DEFAULT_EXPENSE_CATEGORY_ID;
  if (collectionName === 'gastosDiarios') {
    return normalizeValue(data.tipo).toLowerCase() === 'compra'
      ? defaults.DEFAULT_PURCHASE_CATEGORY_ID
      : defaults.DEFAULT_EXPENSE_CATEGORY_ID;
  }
  if (collectionName === 'cuentas_por_pagar') {
    return data.isOperatingExpense || data.mirroredToGastos || data.payableType === 'gasto'
      ? defaults.DEFAULT_EXPENSE_CATEGORY_ID
      : defaults.DEFAULT_PURCHASE_CATEGORY_ID;
  }
  return defaults.DEFAULT_EXPENSE_CATEGORY_ID;
};

async function loadCategoryModule() {
  const modulePath = path.resolve(__dirname, '../../src/services/expenseCategories.js');
  return import(pathToFileURL(modulePath).href);
}

async function migrateCollection(collectionName, categoryModule) {
  const snapshot = await db.collection(collectionName).get();
  const updates = [];

  for (const doc of snapshot.docs) {
    if (LIMIT && updates.length >= LIMIT) break;
    const data = doc.data() || {};
    if (shouldSkip(collectionName, data)) continue;

    const fallback = resolveFallback(collectionName, data, categoryModule);
    const categoryInfo = categoryModule.getExpenseCategoryFromRecord(data, fallback);
    const payload = categoryModule.buildExpenseCategoryPayload(categoryInfo, fallback);

    if (!categoryFieldsChanged(data, payload)) continue;

    updates.push({
      ref: doc.ref,
      id: doc.id,
      before: {
        category: data.category || data.categoria || '',
        subcategory: data.subcategory || data.subcategoria || '',
      },
      after: {
        category: payload.category,
        subcategory: payload.subcategory,
      },
      payload,
    });
  }

  if (APPLY && updates.length) {
    for (let index = 0; index < updates.length; index += 400) {
      const batch = db.batch();
      updates.slice(index, index + 400).forEach((update) => {
        batch.set(update.ref, {
          ...update.payload,
          categoryMigratedAt: admin.firestore.FieldValue.serverTimestamp(),
          categoryMigrationVersion: '2026-06-expense-taxonomy-v1',
        }, { merge: true });
      });
      await batch.commit();
    }
  }

  return {
    collectionName,
    count: updates.length,
    samples: updates.slice(0, 8).map(({ id, before, after }) => ({ id, before, after })),
  };
}

async function main() {
  const categoryModule = await loadCategoryModule();
  const collections = ['gastos', 'compras', 'cuentas_por_pagar', 'gastosDiarios', 'presupuestos'];
  const results = [];

  for (const collectionName of collections) {
    results.push(await migrateCollection(collectionName, categoryModule));
  }

  console.log(JSON.stringify({
    mode: APPLY ? 'apply' : 'preview',
    projectId: PROJECT_ID,
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
