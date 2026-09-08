const path = require('node:path');
const admin = require('firebase-admin');
const mysql = require('mysql2/promise');
const {
  getMysqlConfig,
  initFirebase,
  loadEnvFile,
} = require('./syncSicarBilling');
const {
  getBranchConfig,
  stableStringify,
} = require('./syncSicarTicketSales');

async function fetchSicarProductCatalog(connection) {
  const [rows] = await connection.execute(`
    SELECT
      a.art_id,
      a.clave,
      a.descripcion,
      a.cat_id,
      c.nombre AS categoryName,
      c.dep_id,
      d.nombre AS departmentName
    FROM articulo a
    LEFT JOIN categoria c ON c.cat_id = a.cat_id
    LEFT JOIN departamento d ON d.dep_id = c.dep_id
    ORDER BY a.art_id
  `);
  return rows;
}

function buildSicarProductCatalog(rows = [], branchConfig = getBranchConfig()) {
  const articles = {};
  const categories = new Map();
  const { branchId, branchName } = branchConfig;

  rows.forEach((row) => {
    const articleId = Number(row.art_id || 0);
    if (!articleId) return;
    const categoryId = Number(row.cat_id || 0) || null;
    const departmentId = Number(row.dep_id || 0) || null;
    const categoryKey = categoryId ? `${branchId}:${categoryId}` : `${branchId}:uncategorized`;
    const categoryName = String(row.categoryName || 'SIN CATEGORIA').trim() || 'SIN CATEGORIA';
    const departmentName = String(row.departmentName || 'SIN DEPARTAMENTO').trim() || 'SIN DEPARTAMENTO';

    articles[String(articleId)] = {
      articleId,
      branchId,
      categoryId,
      categoryKey,
      categoryName,
      code: String(row.clave || '').trim(),
      departmentId,
      departmentName,
      description: String(row.descripcion || '').trim(),
    };
    if (!categories.has(categoryKey)) {
      categories.set(categoryKey, {
        branchId,
        categoryId,
        categoryKey,
        categoryName,
        departmentId,
        departmentName,
      });
    }
  });

  return {
    articleCount: Object.keys(articles).length,
    articles,
    branchId,
    branchName,
    categories: [...categories.values()].sort((a, b) => (
      a.departmentName.localeCompare(b.departmentName, 'es')
      || a.categoryName.localeCompare(b.categoryName, 'es')
    )),
    categoryCount: categories.size,
    sourceSystem: 'SICAR',
  };
}

function buildSicarProductCatalogFingerprint(catalog = {}) {
  return stableStringify({ articles: catalog.articles, categories: catalog.categories });
}

async function writeSicarProductCatalog(db, catalog, fingerprint = buildSicarProductCatalogFingerprint(catalog)) {
  await db.collection('sicar_catalogos_articulos').doc(catalog.branchId).set({
    ...catalog,
    fingerprint,
    syncedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function syncSicarProductCatalog({ connection, db, previousFingerprint = '', preview = false }) {
  const rows = await fetchSicarProductCatalog(connection);
  const catalog = buildSicarProductCatalog(rows);
  const fingerprint = buildSicarProductCatalogFingerprint(catalog);
  const changed = fingerprint !== previousFingerprint;

  if (changed && !preview) await writeSicarProductCatalog(db, catalog, fingerprint);
  return { catalog, changed, fingerprint };
}

async function main() {
  const rootDir = path.resolve(__dirname, '..', '..');
  const functionsDir = path.resolve(__dirname, '..');
  loadEnvFile(path.join(rootDir, '.env.local'));
  loadEnvFile(path.join(functionsDir, '.env.local'));
  const preview = process.argv.includes('--preview');
  const connection = await mysql.createConnection(getMysqlConfig());
  const db = preview ? null : initFirebase();
  try {
    const result = await syncSicarProductCatalog({ connection, db, preview });
    console.log(`${preview ? '[PREVIEW] ' : ''}Catalogo ${result.catalog.branchId}: ${result.catalog.articleCount} articulos y ${result.catalog.categoryCount} categorias.`);
  } finally {
    await connection.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildSicarProductCatalog,
  buildSicarProductCatalogFingerprint,
  fetchSicarProductCatalog,
  syncSicarProductCatalog,
  writeSicarProductCatalog,
};
