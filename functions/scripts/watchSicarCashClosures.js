const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const admin = require('firebase-admin');
const {
  addDays,
  fetchClosures,
  fetchClosuresByIds,
  getMysqlConfig,
  initFirebase,
  loadEnvFile,
  toDateString,
  writeClosureIfChanged,
} = require('./syncSicarBilling');

const DEFAULT_STATE_PATH = 'C:\\SICAR\\state\\sicar-cash-closure-watch.json';
const DEFAULT_INTERVAL_MS = 15000;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_STARTUP_BACKFILL_DAYS = 3;

function parseArgs(argv) {
  return argv.reduce((acc, arg) => {
    if (arg === '--once') acc.once = true;
    else if (arg === '--preview') acc.preview = true;
    else if (arg === '--stage-only') acc.stageOnly = true;
    else if (arg === '--reset-state') acc.resetState = true;
    else if (arg === '--skipStartupBackfill') acc.skipStartupBackfill = true;
    else if (arg.startsWith('--intervalMs=')) acc.intervalMs = Number(arg.slice('--intervalMs='.length));
    else if (arg.startsWith('--batchSize=')) acc.batchSize = Number(arg.slice('--batchSize='.length));
    else if (arg.startsWith('--statePath=')) acc.statePath = arg.slice('--statePath='.length);
    else if (arg.startsWith('--startCorId=')) acc.startCorId = Number(arg.slice('--startCorId='.length));
    else if (arg.startsWith('--startupBackfillDays=')) acc.startupBackfillDays = Number(arg.slice('--startupBackfillDays='.length));
    return acc;
  }, {
    batchSize: DEFAULT_BATCH_SIZE,
    intervalMs: Number(process.env.SICAR_CASH_CLOSURE_WATCH_INTERVAL_MS || DEFAULT_INTERVAL_MS),
    once: false,
    preview: false,
    resetState: false,
    skipStartupBackfill: String(process.env.SICAR_CASH_CLOSURE_SKIP_STARTUP_BACKFILL || '').toLowerCase() === 'true',
    stageOnly: false,
    statePath: process.env.SICAR_CASH_CLOSURE_WATCH_STATE_PATH || DEFAULT_STATE_PATH,
    startupBackfillDays: Number(process.env.SICAR_CASH_CLOSURE_WATCH_BACKFILL_DAYS || DEFAULT_STARTUP_BACKFILL_DAYS),
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

async function getCurrentMaxCorId(connection) {
  const [rows] = await connection.execute(`
    SELECT COALESCE(MAX(cor_id), 0) AS maxCorId
    FROM cortecaja
  `);
  return Number(rows?.[0]?.maxCorId || 0);
}

function getBackfillRange(days) {
  const safeDays = Math.max(1, Math.min(Number(days || DEFAULT_STARTUP_BACKFILL_DAYS), 31));
  const today = toDateString(new Date());
  return {
    endDate: today,
    startDate: addDays(today, -(safeDays - 1)),
  };
}

async function writeClosures(db, closures, options) {
  let writtenCount = 0;
  let skippedCount = 0;
  const results = [];

  for (const closure of closures) {
    const result = await writeClosureIfChanged(db, closure, { stageOnly: options.stageOnly });
    if (result.written) writtenCount += 1;
    else skippedCount += 1;
    results.push({ closure, result });
  }

  if (writtenCount > 0) {
    await db.collection('sicar_sync_logs').add({
      syncType: 'cash_closure_watch',
      sourceMode: 'local-worker-watch',
      closureCount: closures.length,
      writtenCount,
      skippedCount,
      closureCorIds: closures.map((closure) => closure.corId),
      closureTotal: closures.reduce((sum, closure) => sum + Number(closure.calculatedTotal || 0), 0),
      stageOnly: options.stageOnly,
      status: 'ok',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  return { writtenCount, skippedCount, results };
}

async function processStartupBackfill({ connection, db, options }) {
  if (options.skipStartupBackfill) return { count: 0, maxCorId: 0, writtenCount: 0, skippedCount: 0 };

  const { startDate, endDate } = getBackfillRange(options.startupBackfillDays);
  const closures = await fetchClosures(connection, startDate, addDays(endDate, 1));
  const maxCorId = closures.reduce((max, closure) => Math.max(max, Number(closure.corId || 0)), 0);

  if (options.preview) {
    console.log(JSON.stringify({
      preview: true,
      startupBackfill: true,
      startDate,
      endDate,
      closureCount: closures.length,
      maxCorId,
      closures: closures.map((closure) => ({
        corId: closure.corId,
        date: closure.date,
        cashboxName: closure.cashboxName,
        calculatedTotal: closure.calculatedTotal,
        sicarDifference: closure.sicarDifference,
      })),
    }, null, 2));
    return { count: closures.length, maxCorId, writtenCount: 0, skippedCount: 0 };
  }

  const result = await writeClosures(db, closures, options);
  console.log(`[${new Date().toISOString()}] Backfill cierres ${startDate} a ${endDate}: ${closures.length} revisado/s, ${result.writtenCount} escrito/s, ${result.skippedCount} sin cambios.`);
  return { count: closures.length, maxCorId, ...result };
}

async function fetchNewClosureIds(connection, lastCorId, batchSize) {
  const safeBatchSize = Math.max(1, Math.min(Number(batchSize || DEFAULT_BATCH_SIZE), 100));
  const [rows] = await connection.execute(`
    SELECT c.cor_id
    FROM cortecaja c
    WHERE c.cor_id > ?
    ORDER BY c.cor_id ASC
    LIMIT ${safeBatchSize}
  `, [Number(lastCorId || 0)]);
  return rows.map((row) => Number(row.cor_id)).filter(Number.isFinite);
}

async function processNewClosures({ connection, db, lastCorId, options }) {
  const ids = await fetchNewClosureIds(connection, lastCorId, options.batchSize);
  if (ids.length === 0) return { count: 0, lastCorId, writtenCount: 0, skippedCount: 0 };

  const closures = await fetchClosuresByIds(connection, ids);

  if (options.preview) {
    console.log(JSON.stringify({
      preview: true,
      ids,
      closures: closures.map((closure) => ({
        corId: closure.corId,
        date: closure.date,
        cashboxName: closure.cashboxName,
        calculatedTotal: closure.calculatedTotal,
        sicarDifference: closure.sicarDifference,
      })),
    }, null, 2));
  } else {
    const result = await writeClosures(db, closures, options);
    if (result.writtenCount > 0) {
      console.log(`[${new Date().toISOString()}] ${result.writtenCount} cierre/s SICAR sincronizado/s.`);
    }
  }

  return {
    count: closures.length,
    lastCorId: Math.max(lastCorId, ...ids),
  };
}

async function main() {
  const rootDir = path.resolve(__dirname, '..', '..');
  const functionsDir = path.resolve(__dirname, '..');
  loadEnvFile(path.join(rootDir, '.env.local'));
  loadEnvFile(path.join(functionsDir, '.env.local'));

  const options = parseArgs(process.argv.slice(2));
  options.intervalMs = Math.max(15000, Math.min(Number(options.intervalMs || DEFAULT_INTERVAL_MS), 300000));

  const connection = await mysql.createConnection(getMysqlConfig());
  const db = options.preview ? null : initFirebase();

  try {
    if (options.resetState && fs.existsSync(options.statePath)) fs.unlinkSync(options.statePath);
    const state = readState(options.statePath);
    let lastCorId = Number(options.startCorId || state.lastCorId || 0);

    const backfill = await processStartupBackfill({ connection, db, options });

    if (!lastCorId) {
      lastCorId = await getCurrentMaxCorId(connection);
      writeState(options.statePath, {
        lastCorId,
        bootstrappedAt: new Date().toISOString(),
        startupBackfillDays: options.skipStartupBackfill ? 0 : Math.max(1, Math.min(Number(options.startupBackfillDays || DEFAULT_STARTUP_BACKFILL_DAYS), 31)),
        note: 'Estado inicial creado con MAX(cor_id); antes de escuchar nuevos cierres se verifica un backfill reciente idempotente.',
      });
      console.log(`[${new Date().toISOString()}] Watcher de cierres iniciado desde cor_id ${lastCorId}.`);
    } else {
      if (backfill.maxCorId > lastCorId) {
        lastCorId = backfill.maxCorId;
        writeState(options.statePath, { ...state, lastCorId });
      }
      console.log(`[${new Date().toISOString()}] Watcher de cierres iniciado. Ultimo cor_id conocido: ${lastCorId}.`);
    }

    do {
      try {
        const result = await processNewClosures({ connection, db, lastCorId, options });
        if (result.lastCorId !== lastCorId) {
          lastCorId = result.lastCorId;
          writeState(options.statePath, { ...state, lastCorId });
        }
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Error sincronizando cierres SICAR:`, error.message || error);
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
