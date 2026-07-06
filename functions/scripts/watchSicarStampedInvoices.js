const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const admin = require('firebase-admin');
const {
  addDays,
  buildInvoiceFingerprint,
  fetchStampedInvoices,
  fetchStampedInvoicesByIds,
  getMysqlConfig,
  initFirebase,
  loadEnvFile,
  toDateString,
  writeInvoice,
} = require('./syncSicarBilling');

const DEFAULT_STATE_PATH = 'C:\\SICAR\\state\\sicar-stamped-invoice-watch.json';
const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_STARTUP_BACKFILL_DAYS = 3;

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
    else if (arg.startsWith('--startupBackfillDays=')) acc.startupBackfillDays = Number(arg.slice('--startupBackfillDays='.length));
    else if (arg === '--skipStartupBackfill') acc.skipStartupBackfill = true;
    return acc;
  }, {
    batchSize: DEFAULT_BATCH_SIZE,
    intervalMs: Number(process.env.SICAR_STAMPED_INVOICE_WATCH_INTERVAL_MS || DEFAULT_INTERVAL_MS),
    once: false,
    preview: false,
    resetState: false,
    skipStartupBackfill: String(process.env.SICAR_STAMPED_INVOICE_SKIP_STARTUP_BACKFILL || '').toLowerCase() === 'true',
    stageOnly: false,
    statePath: process.env.SICAR_STAMPED_INVOICE_WATCH_STATE_PATH || DEFAULT_STATE_PATH,
    startupBackfillDays: Number(process.env.SICAR_STAMPED_INVOICE_WATCH_BACKFILL_DAYS || DEFAULT_STARTUP_BACKFILL_DAYS),
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

function ensureStateShape(state = {}) {
  return {
    ...state,
    invoiceFingerprints: { ...(state.invoiceFingerprints || {}) },
  };
}

function rememberInvoice(state, invoice, fingerprint) {
  if (!state.invoiceFingerprints) state.invoiceFingerprints = {};
  state.invoiceFingerprints[invoice.id] = {
    date: invoice.date,
    facId: invoice.facId,
    fingerprint,
    invoiceNumber: invoice.invoiceNumber,
    updatedAt: new Date().toISOString(),
  };
}

function invoiceMatchesLocalState(state, invoice, fingerprint) {
  return state?.invoiceFingerprints?.[invoice.id]?.fingerprint === fingerprint;
}

async function getCurrentMaxFacId(connection) {
  const [rows] = await connection.execute(`
    SELECT COALESCE(MAX(fac_id), 0) AS maxFacId
    FROM factura
  `);
  return Number(rows?.[0]?.maxFacId || 0);
}

function getBackfillRange(days) {
  const safeDays = Math.max(1, Math.min(Number(days || DEFAULT_STARTUP_BACKFILL_DAYS), 31));
  const today = toDateString(new Date());
  const startDate = addDays(today, -(safeDays - 1));
  return {
    endDate: today,
    startDate,
  };
}

async function processStartupBackfill({ connection, db, options, state }) {
  if (options.skipStartupBackfill) return { count: 0, maxFacId: 0 };

  const { startDate, endDate } = getBackfillRange(options.startupBackfillDays);
  const invoices = await fetchStampedInvoices(connection, startDate, addDays(endDate, 1));
  const maxFacId = invoices.reduce((max, invoice) => Math.max(max, Number(invoice.facId || 0)), 0);

  if (options.preview) {
    console.log(JSON.stringify({
      preview: true,
      startupBackfill: true,
      startDate,
      endDate,
      invoiceCount: invoices.length,
      maxFacId,
      invoices: invoices.map((invoice) => ({
        facId: invoice.facId,
        invoiceNumber: invoice.invoiceNumber,
        customerName: invoice.customerName,
        itemCount: invoice.items?.length || 0,
        total: invoice.total,
      })),
    }, null, 2));
    return { count: invoices.length, maxFacId, skippedCount: 0, writtenCount: 0 };
  }

  let writtenCount = 0;
  let skippedCount = 0;
  for (const invoice of invoices) {
    const fingerprint = buildInvoiceFingerprint(invoice);
    if (!options.stageOnly && invoiceMatchesLocalState(state, invoice, fingerprint)) {
      skippedCount += 1;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await writeInvoice(db, { ...invoice, sicarFingerprint: fingerprint }, { stageOnly: options.stageOnly });
    rememberInvoice(state, invoice, fingerprint);
    writtenCount += 1;
  }

  if (writtenCount > 0) {
    await db.collection('sicar_sync_logs').add({
      syncType: 'facturacion_watch_startup_backfill',
      sourceMode: 'local-worker-watch',
      startDate,
      endDate,
      invoiceCount: invoices.length,
      writtenCount,
      skippedCount,
      invoiceFacIds: invoices.map((invoice) => invoice.facId),
      invoiceTotal: invoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
      stageOnly: options.stageOnly,
      status: 'ok',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  console.log(`[${new Date().toISOString()}] Backfill inicial ${startDate} a ${endDate}: ${invoices.length} factura/s revisadas, ${writtenCount} escrita/s, ${skippedCount} sin cambios.`);
  return { count: invoices.length, maxFacId, skippedCount, writtenCount };
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

async function processNewInvoices({ connection, db, lastFacId, options, state }) {
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
    let writtenCount = 0;
    let skippedCount = 0;
    for (const invoice of invoices) {
      const fingerprint = buildInvoiceFingerprint(invoice);
      if (!options.stageOnly && invoiceMatchesLocalState(state, invoice, fingerprint)) {
        skippedCount += 1;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await writeInvoice(db, { ...invoice, sicarFingerprint: fingerprint }, { stageOnly: options.stageOnly });
      rememberInvoice(state, invoice, fingerprint);
      writtenCount += 1;
      console.log(`[${new Date().toISOString()}] Factura SICAR ${invoice.invoiceNumber || invoice.facId} sincronizada (${invoice.items?.length || 0} articulo/s).`);
    }

    if (writtenCount > 0) {
      await db.collection('sicar_sync_logs').add({
        syncType: 'facturacion_watch',
        sourceMode: 'local-worker-watch',
        invoiceCount: invoices.length,
        writtenCount,
        skippedCount,
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
    const state = ensureStateShape(readState(options.statePath));
    let lastFacId = Number(options.startFacId || state.lastFacId || 0);

    const backfill = await processStartupBackfill({ connection, db, options, state });

    if (!lastFacId) {
      lastFacId = await getCurrentMaxFacId(connection);
      state.lastFacId = lastFacId;
      state.bootstrappedAt = new Date().toISOString();
      state.startupBackfillDays = options.skipStartupBackfill ? 0 : Math.max(1, Math.min(Number(options.startupBackfillDays || DEFAULT_STARTUP_BACKFILL_DAYS), 31));
      state.note = 'Estado inicial creado con MAX(fac_id); los fingerprints locales evitan leer Firestore si MySQL no cambio.';
      writeState(options.statePath, {
        ...state,
      });
      console.log(`[${new Date().toISOString()}] Watcher iniciado desde fac_id ${lastFacId}. Backfill reciente aplicado antes de escuchar nuevas facturas.`);
    } else {
      if (backfill.maxFacId > lastFacId) {
        lastFacId = backfill.maxFacId;
        state.lastFacId = lastFacId;
        writeState(options.statePath, state);
      } else if (backfill.writtenCount > 0) {
        writeState(options.statePath, state);
      }
      console.log(`[${new Date().toISOString()}] Watcher iniciado. Ultimo fac_id conocido: ${lastFacId}.`);
    }

    do {
      try {
        const result = await processNewInvoices({ connection, db, lastFacId, options, state });
        if (result.lastFacId !== lastFacId) {
          lastFacId = result.lastFacId;
          state.lastFacId = lastFacId;
          writeState(options.statePath, state);
        } else if (result.count > 0) {
          writeState(options.statePath, state);
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
