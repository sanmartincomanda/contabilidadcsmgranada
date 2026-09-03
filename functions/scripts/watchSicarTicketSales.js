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
const {
  buildSicarCreditReceiptFingerprint,
  fetchSicarCreditReceipts,
  fetchSicarCreditReceiptsByPaymentIds,
  writeSicarCreditReceipt,
} = require('./syncSicarCreditReceipts');

const DEFAULT_STATE_PATH = 'C:\\SICAR\\state\\sicar-ticket-sales-watch.json';
const DEFAULT_INTERVAL_MS = 10000;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_STARTUP_BACKFILL_DAYS = 2;
const DEFAULT_RECENT_BACKFILL_INTERVAL_MS = 60000;
const TICKET_INCOME_START_DATE = '2026-09-03';

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
    cancellationMarkers: { ...(state.cancellationMarkers || {}) },
    creditPaymentMarkers: { ...(state.creditPaymentMarkers || {}) },
    creditReceiptFingerprints: { ...(state.creditReceiptFingerprints || {}) },
    ticketFingerprints: { ...(state.ticketFingerprints || {}) },
    rollupFingerprints: { ...(state.rollupFingerprints || {}) },
  };
}

async function getCurrentMaxCreditPaymentId(connection) {
  const [rows] = await connection.execute('SELECT COALESCE(MAX(acl_id), 0) AS maxPaymentId FROM abonocliente');
  return Number(rows?.[0]?.maxPaymentId || 0);
}

async function fetchNewCreditPaymentIds(connection, lastPaymentId, batchSize) {
  const safeBatchSize = Math.max(1, Math.min(Number(batchSize || DEFAULT_BATCH_SIZE), 500));
  const [rows] = await connection.execute(`
    SELECT acl_id
    FROM abonocliente
    WHERE acl_id > ?
    ORDER BY acl_id
    LIMIT ${safeBatchSize}
  `, [Number(lastPaymentId || 0)]);
  return rows.map((row) => Number(row.acl_id)).filter(Number.isFinite);
}

function buildCreditPaymentMarker(row = {}) {
  return {
    paymentId: Number(row.acl_id || 0),
    signature: [row.status, row.total, row.tpa_id, row.acp_id].map((value) => value ?? '').join('|'),
  };
}

async function fetchCreditPaymentMarkers(connection, trackingStartPaymentId) {
  const startPaymentId = Number(trackingStartPaymentId || 0);
  if (startPaymentId <= 0) return [];
  const [rows] = await connection.execute(`
    SELECT acl_id, status, total, tpa_id, acp_id
    FROM abonocliente
    WHERE acl_id >= ?
    ORDER BY acl_id
  `, [startPaymentId]);
  return rows.map(buildCreditPaymentMarker).filter((marker) => marker.paymentId > 0);
}

async function writeChangedCreditReceipts({ db, receipts, options, state }) {
  let writtenCount = 0;
  for (const receipt of receipts) {
    const fingerprint = buildSicarCreditReceiptFingerprint(receipt);
    if (state.creditReceiptFingerprints[receipt.id] === fingerprint) continue;
    if (options.preview) {
      console.log(JSON.stringify({
        preview: true,
        sicarReceiptCode: receipt.sicarReceiptCode,
        customerName: receipt.customerName,
        amount: receipt.amount,
        status: receipt.status,
      }));
    } else {
      // eslint-disable-next-line no-await-in-loop
      await writeSicarCreditReceipt(db, receipt, fingerprint);
    }
    state.creditReceiptFingerprints[receipt.id] = fingerprint;
    writtenCount += 1;
  }
  return writtenCount;
}

async function processCreditReceiptBackfill({ connection, db, options, state }) {
  const range = getBackfillRange(options.startupBackfillDays);
  const receipts = await fetchSicarCreditReceipts(connection, range.startDate, range.endExclusive);
  const paymentIds = receipts.flatMap((receipt) => receipt.sicarPaymentIds || []).map(Number).filter(Number.isFinite);
  const writtenCount = await writeChangedCreditReceipts({ db, receipts, options, state });
  if (writtenCount) {
    console.log(`[${new Date().toISOString()}] ${writtenCount} cobro/s SICAR actualizado/s entre ${range.startDate} y ${range.endDate}.`);
  }
  return {
    maxPaymentId: paymentIds.length ? Math.max(...paymentIds) : 0,
    minPaymentId: paymentIds.length ? Math.min(...paymentIds) : 0,
    writtenCount,
  };
}

async function processNewCreditReceipts({ connection, db, lastPaymentId, options, state }) {
  let cursor = lastPaymentId;
  let totalWritten = 0;
  do {
    // eslint-disable-next-line no-await-in-loop
    const ids = await fetchNewCreditPaymentIds(connection, cursor, options.batchSize);
    if (!ids.length) break;
    const minimumId = Math.min(...ids);
    if (!state.trackingStartPaymentId || minimumId < state.trackingStartPaymentId) {
      state.trackingStartPaymentId = minimumId;
    }
    // eslint-disable-next-line no-await-in-loop
    const receipts = await fetchSicarCreditReceiptsByPaymentIds(connection, ids);
    // eslint-disable-next-line no-await-in-loop
    totalWritten += await writeChangedCreditReceipts({ db, receipts, options, state });
    cursor = Math.max(cursor, ...ids);
    state.lastCreditPaymentId = cursor;
    writeState(options.statePath, state);
    if (ids.length < options.batchSize) break;
  } while (true);
  if (totalWritten) {
    console.log(`[${new Date().toISOString()}] ${totalWritten} cobro/s SICAR nuevo/s sincronizado/s hasta acl_id ${cursor}.`);
  }
  return cursor;
}

async function processCreditReceiptChanges({ connection, db, options, state }) {
  const markers = await fetchCreditPaymentMarkers(connection, state.trackingStartPaymentId);
  const changed = markers.filter((marker) => state.creditPaymentMarkers[String(marker.paymentId)] !== marker.signature);
  if (!changed.length) return 0;
  const receipts = await fetchSicarCreditReceiptsByPaymentIds(connection, changed.map((marker) => marker.paymentId));
  const writtenCount = await writeChangedCreditReceipts({ db, receipts, options, state });
  changed.forEach((marker) => {
    state.creditPaymentMarkers[String(marker.paymentId)] = marker.signature;
  });
  writeState(options.statePath, state);
  return writtenCount;
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

function buildCancellationMarker(row = {}) {
  const saleId = Number(row.ven_id || row.saleId || 0);
  const status = Number(row.status || 0);
  const cancellationCashboxId = row.can_caj_id === null || row.can_caj_id === undefined
    ? null
    : Number(row.can_caj_id);
  const cancellationClosureId = row.can_rcc_id === null || row.can_rcc_id === undefined
    ? null
    : Number(row.can_rcc_id);

  return {
    saleId,
    signature: `${status}|${cancellationCashboxId ?? ''}|${cancellationClosureId ?? ''}`,
  };
}

function findChangedCancellationMarkers(markers = [], knownMarkers = {}) {
  return markers.filter((marker) => (
    marker.saleId > 0
    && knownMarkers[String(marker.saleId)] !== marker.signature
  ));
}

async function fetchCancellationMarkers(connection, trackingStartSaleId) {
  const startSaleId = Number(trackingStartSaleId || 0);
  if (startSaleId <= 0) return [];

  const [rows] = await connection.execute(`
    SELECT ven_id, status, can_caj_id, can_rcc_id
    FROM venta
    WHERE ven_id >= ?
      AND (status < 0 OR can_caj_id IS NOT NULL OR can_rcc_id IS NOT NULL)
    ORDER BY ven_id
  `, [startSaleId]);

  return rows.map(buildCancellationMarker).filter((marker) => marker.saleId > 0);
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

function startRemoteBranchRollups({ db, options }) {
  if (!db || options.preview) return () => {};

  const localBranch = String(process.env.SICAR_BRANCH_ID || process.env.BRANCH_ID || 'granada').trim().toLowerCase();
  const startDate = [getBackfillRange(options.startupBackfillDays).startDate, TICKET_INCOME_START_DATE].sort().at(-1);
  const fingerprints = new Map();
  let previousKeys = new Set();
  let processing = Promise.resolve();

  const processSnapshot = async (snapshot) => {
    const groups = new Map();

    snapshot.docs.forEach((ticketDoc) => {
      const ticket = { id: ticketDoc.id, ...ticketDoc.data() };
      const branchId = String(ticket.branchId || ticket.branch || '').trim().toLowerCase();
      const date = toDateString(ticket.date || ticket.saleDate);
      if (!branchId || branchId === localBranch || !date) return;

      const key = `${branchId}|${date}`;
      const group = groups.get(key) || {
        branchId,
        branchName: ticket.branchName || ticket.sourceBranch || branchId.toUpperCase(),
        date,
        entries: [],
      };
      group.entries.push(ticket);
      groups.set(key, group);
    });

    const currentKeys = new Set(groups.keys());
    const keysToRefresh = new Set([...previousKeys, ...currentKeys]);

    for (const key of [...keysToRefresh].sort()) {
      const [branchId, date] = key.split('|');
      const group = groups.get(key) || {
        branchId,
        branchName: branchId.toUpperCase(),
        date,
        entries: [],
      };
      const rollup = buildDailyRollup(group.entries, date, {
        branchId: group.branchId,
        branchName: group.branchName,
      });
      const fingerprint = buildDailyRollupFingerprint(rollup);
      if (fingerprints.get(rollup.id) === fingerprint) continue;

      // eslint-disable-next-line no-await-in-loop
      await writeDailyRollup(db, rollup, fingerprint);
      fingerprints.set(rollup.id, fingerprint);
      console.log(`[${new Date().toISOString()}] Resumen remoto ${group.branchId} ${date}: ${rollup.ticketCount} ticket/s, total ${rollup.total}.`);
    }

    previousKeys = currentKeys;
  };

  const unsubscribe = db.collection('sicar_ventas_tickets')
    .where('date', '>=', startDate)
    .onSnapshot((snapshot) => {
      processing = processing
        .then(() => processSnapshot(snapshot))
        .catch((error) => console.error(`[${new Date().toISOString()}] No se pudo actualizar el resumen remoto de tickets:`, error.message || error));
    }, (error) => {
      console.error(`[${new Date().toISOString()}] Listener remoto de tickets interrumpido:`, error.message || error);
    });

  return unsubscribe;
}

async function processBackfill({ connection, db, options, state }) {
  const range = getBackfillRange(options.startupBackfillDays);
  const entries = await fetchTicketSales(connection, range.startDate, range.endExclusive);
  const saleIds = entries.map((entry) => Number(entry.saleId || 0)).filter((saleId) => saleId > 0);
  const result = await writeChangedTickets({ db, entries, options, state });
  const allDates = new Set(entries.map((entry) => entry.date).filter(Boolean));
  const rollupWrittenCount = await refreshDailyRollups({ connection, db, dates: allDates, options, state });
  pruneState(state, addDays(range.startDate, -5));

  if (result.writtenCount || rollupWrittenCount) {
    console.log(`[${new Date().toISOString()}] Revision ${range.startDate} a ${range.endDate}: ${entries.length} venta/s, ${result.writtenCount} ticket/s y ${rollupWrittenCount} resumen/es actualizados.`);
  }

  return {
    maxSaleId: saleIds.length ? Math.max(...saleIds) : 0,
    minSaleId: saleIds.length ? Math.min(...saleIds) : 0,
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

    const minimumNewId = Math.min(...newIds);
    if (!state.trackingStartSaleId || minimumNewId < state.trackingStartSaleId) {
      state.trackingStartSaleId = minimumNewId;
    }

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

async function processCancellations({ connection, db, options, state }) {
  const markers = await fetchCancellationMarkers(connection, state.trackingStartSaleId);
  const changedMarkers = findChangedCancellationMarkers(markers, state.cancellationMarkers);
  if (!changedMarkers.length) return 0;

  const entries = await fetchTicketSalesByIds(connection, changedMarkers.map((marker) => marker.saleId));
  const result = await writeChangedTickets({ db, entries, options, state });
  const rollupWrittenCount = await refreshDailyRollups({
    connection,
    db,
    dates: result.affectedDates,
    options,
    state,
  });

  changedMarkers.forEach((marker) => {
    state.cancellationMarkers[String(marker.saleId)] = marker.signature;
  });
  writeState(options.statePath, state);

  if (result.writtenCount || rollupWrittenCount) {
    console.log(`[${new Date().toISOString()}] ${result.writtenCount} ticket/s anulado/s actualizado/s y ${rollupWrittenCount} resumen/es recalculados.`);
  }

  return result.writtenCount;
}

async function runWatcherSession(options) {
  const connection = await mysql.createConnection(getMysqlConfig());
  const db = options.preview ? null : initFirebase();
  const stopRemoteBranchRollups = startRemoteBranchRollups({ db, options });

  try {
    if (options.resetState && fs.existsSync(options.statePath)) fs.unlinkSync(options.statePath);
    const state = normalizeState(readState(options.statePath));
    const backfill = await processBackfill({ connection, db, options, state });
    const creditBackfill = await processCreditReceiptBackfill({ connection, db, options, state });
    let lastSaleId = Number(state.lastSaleId || 0);
    let lastCreditPaymentId = Number(state.lastCreditPaymentId || 0);

    if (!state.trackingStartSaleId && backfill.minSaleId > 0) {
      state.trackingStartSaleId = backfill.minSaleId;
    }

    if (!lastSaleId) {
      lastSaleId = Math.max(backfill.maxSaleId, await getCurrentMaxSaleId(connection));
      state.lastSaleId = lastSaleId;
      state.bootstrappedAt = new Date().toISOString();
    } else if (backfill.maxSaleId > lastSaleId) {
      lastSaleId = backfill.maxSaleId;
      state.lastSaleId = lastSaleId;
    }
    if (!state.trackingStartPaymentId && creditBackfill.minPaymentId > 0) {
      state.trackingStartPaymentId = creditBackfill.minPaymentId;
    }
    if (!lastCreditPaymentId) {
      lastCreditPaymentId = Math.max(creditBackfill.maxPaymentId, await getCurrentMaxCreditPaymentId(connection));
      state.lastCreditPaymentId = lastCreditPaymentId;
    } else if (creditBackfill.maxPaymentId > lastCreditPaymentId) {
      lastCreditPaymentId = creditBackfill.maxPaymentId;
      state.lastCreditPaymentId = lastCreditPaymentId;
    }
    writeState(options.statePath, state);

    console.log(`[${new Date().toISOString()}] Watcher SICAR iniciado cada ${options.intervalMs / 1000}s desde ven_id ${lastSaleId} y acl_id ${lastCreditPaymentId}.`);
    let lastRecentBackfillAt = Date.now();

    do {
      lastSaleId = await processNewSales({ connection, db, lastSaleId, options, state });
      await processCancellations({ connection, db, options, state });
      lastCreditPaymentId = await processNewCreditReceipts({ connection, db, lastPaymentId: lastCreditPaymentId, options, state });
      await processCreditReceiptChanges({ connection, db, options, state });
      if (options.once) break;

      if (Date.now() - lastRecentBackfillAt >= options.recentBackfillIntervalMs) {
        await processBackfill({ connection, db, options, state });
        await processCreditReceiptBackfill({ connection, db, options, state });
        writeState(options.statePath, state);
        lastRecentBackfillAt = Date.now();
      }
      await sleep(options.intervalMs);
    } while (true);
  } finally {
    stopRemoteBranchRollups();
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

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildCancellationMarker,
  buildCreditPaymentMarker,
  fetchCancellationMarkers,
  fetchNewSaleIds,
  fetchNewCreditPaymentIds,
  findChangedCancellationMarkers,
  getBackfillRange,
  normalizeState,
  parseArgs,
  processBackfill,
  processCancellations,
  processCreditReceiptBackfill,
  processCreditReceiptChanges,
  processNewCreditReceipts,
  processNewSales,
  pruneState,
  refreshDailyRollups,
  startRemoteBranchRollups,
  writeChangedTickets,
};
