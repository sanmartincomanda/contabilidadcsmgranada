const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const {
  addDays,
  getMysqlConfig,
  initFirebase,
  loadEnvFile,
  toDateString,
} = require('./syncSicarBilling');
const {
  buildDailyRollup,
  buildDailyRollupFingerprint,
  buildTicketFingerprint,
  fetchTicketSales,
  fetchTicketSalesByIds,
  writeDailyRollup,
  writeTicketSale,
} = require('./syncSicarTicketSales');

const DEFAULT_STATE_PATH = 'C:\\SICAR\\state\\sicar-ticket-sales-watch.json';
const DEFAULT_INTERVAL_MS = 10000;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_STARTUP_BACKFILL_DAYS = 2;
const DEFAULT_RECENT_BACKFILL_INTERVAL_MS = 60000;

function parseArgs(argv) {
  return argv.reduce((options, argument) => {
    if (argument === '--once') options.once = true;
    else if (argument === '--preview') options.preview = true;
    else if (argument === '--reset-state') options.resetState = true;
    else if (argument.startsWith('--intervalMs=')) options.intervalMs = Number(argument.slice('--intervalMs='.length));
    else if (argument.startsWith('--batchSize=')) options.batchSize = Number(argument.slice('--batchSize='.length));
    else if (argument.startsWith('--statePath=')) options.statePath = argument.slice('--statePath='.length);
    else if (argument.startsWith('--startupBackfillDays=')) options.startupBackfillDays = Number(argument.slice('--startupBackfillDays='.length));
    else if (argument.startsWith('--recentBackfillIntervalMs=')) options.recentBackfillIntervalMs = Number(argument.slice('--recentBackfillIntervalMs='.length));
    return options;
  }, {
    batchSize: DEFAULT_BATCH_SIZE,
    intervalMs: Number(process.env.SICAR_TICKET_SALES_WATCH_INTERVAL_MS || DEFAULT_INTERVAL_MS),
    once: false,
    preview: false,
    recentBackfillIntervalMs: Number(process.env.SICAR_TICKET_SALES_RECENT_BACKFILL_INTERVAL_MS || DEFAULT_RECENT_BACKFILL_INTERVAL_MS),
    resetState: false,
    startupBackfillDays: Number(process.env.SICAR_TICKET_SALES_WATCH_BACKFILL_DAYS || DEFAULT_STARTUP_BACKFILL_DAYS),
    statePath: process.env.SICAR_TICKET_SALES_WATCH_STATE_PATH || DEFAULT_STATE_PATH,
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
}

function normalizeState(state = {}) {
  return {
    ...state,
    ticketFingerprints: { ...(state.ticketFingerprints || {}) },
    rollupFingerprints: { ...(state.rollupFingerprints || {}) },
  };
}

function getBackfillRange(days = DEFAULT_STARTUP_BACKFILL_DAYS) {
  const safeDays = Math.max(1, Math.min(Number(days || DEFAULT_STARTUP_BACKFILL_DAYS), 31));
  const endDate = toDateString(new Date());
  return {
    startDate: addDays(endDate, -(safeDays - 1)),
    endDate,
    endExclusive: addDays(endDate, 1),
  };
}

async function getCurrentMaxSaleId(connection) {
  const [rows] = await connection.execute('SELECT COALESCE(MAX(ven_id), 0) AS maxSaleId FROM venta');
  return Number(rows?.[0]?.maxSaleId || 0);
}

async function fetchNewSaleIds(connection, lastSaleId, batchSize) {
  const safeBatchSize = Math.max(1, Math.min(Number(batchSize || DEFAULT_BATCH_SIZE), 500));
  const [rows] = await connection.execute(`
    SELECT ven_id
    FROM venta
    WHERE ven_id > ?
    ORDER BY ven_id
    LIMIT ${safeBatchSize}
  `, [Number(lastSaleId || 0)]);
  return rows.map((row) => Number(row.ven_id)).filter(Number.isFinite);
}

async function writeChangedTickets({ db, entries, options, state }) {
  let writtenCount = 0;
  const affectedDates = new Set();

  for (const entry of entries) {
    const fingerprint = buildTicketFingerprint(entry);
    if (state.ticketFingerprints[entry.id]?.fingerprint === fingerprint) continue;

    if (options.preview) {
      console.log(JSON.stringify({
        preview: true,
        ticketCode: entry.ticketCode,
        saleId: entry.saleId,
        date: entry.date,
        customerName: entry.customerName,
        itemCount: entry.itemCount,
        total: entry.total,
        status: entry.status,
      }));
    } else {
      // eslint-disable-next-line no-await-in-loop
      await writeTicketSale(db, entry, fingerprint);
    }

    state.ticketFingerprints[entry.id] = {
      date: entry.date,
      fingerprint,
      saleId: entry.saleId,
    };
    affectedDates.add(entry.date);
    writtenCount += 1;
  }

  return { affectedDates, writtenCount };
}

async function refreshDailyRollups({ connection, db, dates, options, state }) {
  let writtenCount = 0;

  for (const date of [...dates].filter(Boolean).sort()) {
    // The rollup always comes from MySQL, never from Firestore, so it also repairs cancellations.
    // eslint-disable-next-line no-await-in-loop
    const entries = await fetchTicketSales(connection, date, addDays(date, 1));
    const rollup = buildDailyRollup(entries, date);
    const fingerprint = buildDailyRollupFingerprint(rollup);
    if (state.rollupFingerprints[rollup.id] === fingerprint) continue;

    if (options.preview) {
      console.log(JSON.stringify({
        preview: true,
        rollup: rollup.id,
        date,
        ticketCount: rollup.ticketCount,
        subtotal: rollup.subtotal,
        iva: rollup.iva,
        total: rollup.total,
      }));
    } else {
      // eslint-disable-next-line no-await-in-loop
      await writeDailyRollup(db, rollup, fingerprint);
    }
    state.rollupFingerprints[rollup.id] = fingerprint;
    writtenCount += 1;
  }

  return writtenCount;
}

function pruneState(state, oldestDate) {
  Object.entries(state.ticketFingerprints).forEach(([id, item]) => {
    if (String(item?.date || '') < oldestDate) delete state.ticketFingerprints[id];
  });
}

async function processBackfill({ connection, db, options, state }) {
  const range = getBackfillRange(options.startupBackfillDays);
  const entries = await fetchTicketSales(connection, range.startDate, range.endExclusive);
  const result = await writeChangedTickets({ db, entries, options, state });
  const allDates = new Set(entries.map((entry) => entry.date).filter(Boolean));
  const rollupWrittenCount = await refreshDailyRollups({ connection, db, dates: allDates, options, state });
  pruneState(state, addDays(range.startDate, -5));

  if (result.writtenCount || rollupWrittenCount) {
    console.log(`[${new Date().toISOString()}] Revision ${range.startDate} a ${range.endDate}: ${entries.length} venta/s, ${result.writtenCount} ticket/s y ${rollupWrittenCount} resumen/es actualizados.`);
  }

  return {
    maxSaleId: entries.reduce((maximum, entry) => Math.max(maximum, Number(entry.saleId || 0)), 0),
    writtenCount: result.writtenCount,
    rollupWrittenCount,
  };
}

async function processNewSales({ connection, db, lastSaleId, options, state }) {
  let cursor = lastSaleId;
  let totalWritten = 0;

  do {
    // Fetch ids without filtering so excluded Carnes Amparito sales still advance the cursor.
    // eslint-disable-next-line no-await-in-loop
    const newIds = await fetchNewSaleIds(connection, cursor, options.batchSize);
    if (!newIds.length) break;

    // eslint-disable-next-line no-await-in-loop
    const entries = await fetchTicketSalesByIds(connection, newIds);
    // eslint-disable-next-line no-await-in-loop
    const result = await writeChangedTickets({ db, entries, options, state });
    // eslint-disable-next-line no-await-in-loop
    await refreshDailyRollups({ connection, db, dates: result.affectedDates, options, state });
    totalWritten += result.writtenCount;
    cursor = Math.max(cursor, ...newIds);
    state.lastSaleId = cursor;
    writeState(options.statePath, state);

    if (newIds.length < options.batchSize) break;
  } while (true);

  if (totalWritten > 0) {
    console.log(`[${new Date().toISOString()}] ${totalWritten} venta/s SICAR nueva/s sincronizada/s hasta ven_id ${cursor}.`);
  }

  return cursor;
}

async function runWatcherSession(options) {
  const connection = await mysql.createConnection(getMysqlConfig());
  const db = options.preview ? null : initFirebase();

  try {
    if (options.resetState && fs.existsSync(options.statePath)) fs.unlinkSync(options.statePath);
    const state = normalizeState(readState(options.statePath));
    const backfill = await processBackfill({ connection, db, options, state });
    let lastSaleId = Number(state.lastSaleId || 0);

    if (!lastSaleId) {
      lastSaleId = Math.max(backfill.maxSaleId, await getCurrentMaxSaleId(connection));
      state.lastSaleId = lastSaleId;
      state.bootstrappedAt = new Date().toISOString();
    } else if (backfill.maxSaleId > lastSaleId) {
      lastSaleId = backfill.maxSaleId;
      state.lastSaleId = lastSaleId;
    }
    writeState(options.statePath, state);

    console.log(`[${new Date().toISOString()}] Watcher de ventas por ticket iniciado cada ${options.intervalMs / 1000}s desde ven_id ${lastSaleId}.`);
    let lastRecentBackfillAt = Date.now();

    do {
      lastSaleId = await processNewSales({ connection, db, lastSaleId, options, state });
      if (options.once) break;

      if (Date.now() - lastRecentBackfillAt >= options.recentBackfillIntervalMs) {
        await processBackfill({ connection, db, options, state });
        writeState(options.statePath, state);
        lastRecentBackfillAt = Date.now();
      }
      await sleep(options.intervalMs);
    } while (true);
  } finally {
    await connection.end().catch(() => {});
  }
}

async function main() {
  const rootDir = path.resolve(__dirname, '..', '..');
  const functionsDir = path.resolve(__dirname, '..');
  loadEnvFile(path.join(rootDir, '.env.local'));
  loadEnvFile(path.join(functionsDir, '.env.local'));

  const options = parseArgs(process.argv.slice(2));
  options.batchSize = Math.max(1, Math.min(Number(options.batchSize || DEFAULT_BATCH_SIZE), 500));
  options.intervalMs = Math.max(5000, Math.min(Number(options.intervalMs || DEFAULT_INTERVAL_MS), 300000));
  options.recentBackfillIntervalMs = Math.max(options.intervalMs, Math.min(Number(options.recentBackfillIntervalMs || DEFAULT_RECENT_BACKFILL_INTERVAL_MS), 600000));
  options.startupBackfillDays = Math.max(1, Math.min(Number(options.startupBackfillDays || DEFAULT_STARTUP_BACKFILL_DAYS), 31));
  const retryDelayMs = Math.max(options.intervalMs, 30000);
  let firstAttempt = true;

  do {
    try {
      await runWatcherSession({
        ...options,
        resetState: options.resetState && firstAttempt,
      });
      if (options.once) return;
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Conexion del watcher de tickets interrumpida:`, error.message || error);
      if (options.once) throw error;
    }

    firstAttempt = false;
    console.log(`[${new Date().toISOString()}] Reintentando watcher de tickets en ${Math.round(retryDelayMs / 1000)} segundos...`);
    await sleep(retryDelayMs);
  } while (true);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

module.exports = {
  fetchNewSaleIds,
  getBackfillRange,
  normalizeState,
  parseArgs,
  processBackfill,
  processNewSales,
  pruneState,
  refreshDailyRollups,
  writeChangedTickets,
};
