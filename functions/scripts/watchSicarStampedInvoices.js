const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const admin = require('firebase-admin');
const {
  fetchStampedInvoicesByIds,
  getMysqlConfig,
  initFirebase,
  loadEnvFile,
  writeInvoice,
} = require('./syncSicarBilling');

const DEFAULT_STATE_PATH = 'C:\\SICAR\\state\\sicar-stamped-invoice-watch.json';
const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_BATCH_SIZE = 20;

function parseArgs(argv) {
  return argv.reduce((acc, arg) => {
    if (arg === '--once') acc.once = true;
    else if (arg === '--preview') acc.preview = true;
    else if (arg === '--stage-only') acc.stageOnly = true;
    else if (arg === '--reset-state') acc.resetState = true;
    else if (arg.startsWith('--intervalMs=')) acc.intervalMs = Number(arg.slice('--intervalMs='.length));
    else if (arg.startsWith('--batchSize=')) acc.batchSize = Number(arg.slice('--batchSize='.length));
    else if (arg.startsWith('--statePath=')) acc.statePath = arg.slice('--statePath='.length);
    else if (arg.startsWith('--startFacId=')) acc.startFacId = Number(arg.slice('--startFacId='.length));
    return acc;
  }, {
    batchSize: DEFAULT_BATCH_SIZE,
    intervalMs: Number(process.env.SICAR_STAMPED_INVOICE_WATCH_INTERVAL_MS || DEFAULT_INTERVAL_MS),
    once: false,
    preview: false,
    resetState: false,
    stageOnly: false,
    statePath: process.env.SICAR_STAMPED_INVOICE_WATCH_STATE_PATH || DEFAULT_STATE_PATH,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readState(statePath) {
  if (!fs.existsSync(statePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(statePath, state) {
  ensureDir(statePath);
  fs.writeFileSync(statePath, `${JSON.stringify({
    ...state,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');
}

async function getCurrentMaxFacId(connection) {
  const [rows] = await connection.execute(`
    SELECT COALESCE(MAX(fac_id), 0) AS maxFacId
    FROM factura
  `);
  return Number(rows?.[0]?.maxFacId || 0);
}

async function fetchNewFacturaIds(connection, lastFacId, batchSize) {
  const safeBatchSize = Math.max(1, Math.min(Number(batchSize || DEFAULT_BATCH_SIZE), 100));
  const [rows] = await connection.execute(`
    SELECT f.fac_id
    FROM factura f
    WHERE f.fac_id > ?
      AND IFNULL(f.status, 0) >= 0
    ORDER BY f.fac_id ASC
    LIMIT ${safeBatchSize}
  `, [Number(lastFacId || 0)]);
  return rows.map((row) => Number(row.fac_id)).filter(Number.isFinite);
}

async function processNewInvoices({ connection, db, lastFacId, options }) {
  const ids = await fetchNewFacturaIds(connection, lastFacId, options.batchSize);
  if (ids.length === 0) return { count: 0, lastFacId };

  const invoices = await fetchStampedInvoicesByIds(connection, ids);
  if (options.preview) {
    console.log(JSON.stringify({
      preview: true,
      ids,
      invoices: invoices.map((invoice) => ({
        facId: invoice.facId,
        invoiceNumber: invoice.invoiceNumber,
        customerName: invoice.customerName,
        itemCount: invoice.items?.length || 0,
        total: invoice.total,
      })),
    }, null, 2));
  } else {
    for (const invoice of invoices) {
      await writeInvoice(db, invoice, { stageOnly: options.stageOnly });
      console.log(`[${new Date().toISOString()}] Factura SICAR ${invoice.invoiceNumber || invoice.facId} sincronizada (${invoice.items?.length || 0} articulo/s).`);
    }

    if (invoices.length > 0) {
      await db.collection('sicar_sync_logs').add({
        syncType: 'facturacion_watch',
        sourceMode: 'local-worker-watch',
        invoiceCount: invoices.length,
        invoiceFacIds: invoices.map((invoice) => invoice.facId),
        invoiceTotal: invoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
        stageOnly: options.stageOnly,
        status: 'ok',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  return {
    count: invoices.length,
    lastFacId: Math.max(lastFacId, ...ids),
  };
}

async function main() {
  const rootDir = path.resolve(__dirname, '..', '..');
  const functionsDir = path.resolve(__dirname, '..');
  loadEnvFile(path.join(rootDir, '.env.local'));
  loadEnvFile(path.join(functionsDir, '.env.local'));

  const options = parseArgs(process.argv.slice(2));
  options.intervalMs = Math.max(1000, Math.min(Number(options.intervalMs || DEFAULT_INTERVAL_MS), 60000));

  const connection = await mysql.createConnection(getMysqlConfig());
  const db = options.preview ? null : initFirebase();

  try {
    if (options.resetState && fs.existsSync(options.statePath)) fs.unlinkSync(options.statePath);
    const state = readState(options.statePath);
    let lastFacId = Number(options.startFacId || state.lastFacId || 0);

    if (!lastFacId) {
      lastFacId = await getCurrentMaxFacId(connection);
      writeState(options.statePath, {
        lastFacId,
        bootstrappedAt: new Date().toISOString(),
        note: 'Estado inicial creado con MAX(fac_id); desde ahora se sincronizan solo facturas nuevas.',
      });
      console.log(`[${new Date().toISOString()}] Watcher iniciado desde fac_id ${lastFacId}. No se subieron historicos.`);
    } else {
      console.log(`[${new Date().toISOString()}] Watcher iniciado. Ultimo fac_id conocido: ${lastFacId}.`);
    }

    do {
      try {
        const result = await processNewInvoices({ connection, db, lastFacId, options });
        if (result.lastFacId !== lastFacId) {
          lastFacId = result.lastFacId;
          writeState(options.statePath, { ...state, lastFacId });
        }
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Error sincronizando facturas membretadas:`, error.message || error);
      }

      if (options.once) break;
      await sleep(options.intervalMs);
    } while (true);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
