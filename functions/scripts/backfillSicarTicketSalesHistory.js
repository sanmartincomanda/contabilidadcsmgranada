const path = require('node:path');
const admin = require('firebase-admin');
const mysql = require('mysql2/promise');
const {
  addDays,
  getMysqlConfig,
  initFirebase,
  loadEnvFile,
  toDateString,
} = require('./syncSicarBilling');
const {
  buildTicketFingerprint,
  fetchTicketSales,
} = require('./syncSicarTicketSales');

const ACCOUNTING_LINK_START_DATE = '2026-09-03';
const DEFAULT_HISTORY_START_DATE = '2026-01-01';
const WRITE_BATCH_SIZE = 400;
const MYSQL_CHUNK_DAYS = 7;

function parseArgs(argv = []) {
  return argv.reduce((options, argument) => {
    if (argument === '--preview') options.preview = true;
    else if (argument.startsWith('--startDate=')) options.startDate = argument.slice('--startDate='.length);
    else if (argument.startsWith('--endDate=')) options.endDate = argument.slice('--endDate='.length);
    return options;
  }, {
    endDate: addDays(ACCOUNTING_LINK_START_DATE, -1),
    preview: false,
    startDate: DEFAULT_HISTORY_START_DATE,
  });
}

function assertHistoricalRange(startDate, endDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(endDate || '')) {
    throw new Error('Las fechas deben tener formato YYYY-MM-DD.');
  }
  if (startDate > endDate) throw new Error('La fecha inicial no puede ser posterior a la final.');
  if (endDate >= ACCOUNTING_LINK_START_DATE) {
    throw new Error(`La carga historica debe terminar antes de ${ACCOUNTING_LINK_START_DATE}.`);
  }
}

function buildHistoricalTicketPayload(entry = {}, timestamp = null) {
  return {
    ...entry,
    accountingEligible: false,
    analyticsOnly: true,
    historyBackfill: true,
    historicalSyncedAt: timestamp,
    sicarFingerprint: buildTicketFingerprint(entry),
    sourceMode: 'history-backfill',
    syncedBy: 'history-backfill',
    updatedAt: timestamp,
  };
}

function chunk(items = [], size = WRITE_BATCH_SIZE) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

async function writeHistoricalTickets(db, entries = []) {
  const writeGroup = async (group) => {
    const refs = group.map((entry) => db.collection('sicar_ventas_tickets').doc(entry.id));
    const snapshots = await db.getAll(...refs);
    const batch = db.batch();
    let batchWrites = 0;
    let groupSkipped = 0;

    group.forEach((entry, index) => {
      const existing = snapshots[index]?.data() || {};
      const fingerprint = buildTicketFingerprint(entry);
      if (
        existing.sicarFingerprint === fingerprint
        && existing.analyticsOnly === true
        && existing.accountingEligible === false
      ) {
        groupSkipped += 1;
        return;
      }

      const timestamp = admin.firestore.FieldValue.serverTimestamp();
      batch.set(refs[index], buildHistoricalTicketPayload(entry, timestamp), { merge: true });
      batchWrites += 1;
    });

    if (batchWrites) await batch.commit();
    return { skipped: groupSkipped, written: batchWrites };
  };

  // A weekly MySQL block produces only a few Firestore batches, so bounded
  // parallel writes reduce migration time without creating an unbounded queue.
  const results = await Promise.all(chunk(entries).map(writeGroup));

  return results.reduce((total, result) => ({
    skipped: total.skipped + result.skipped,
    written: total.written + result.written,
  }), { skipped: 0, written: 0 });
}

async function run(options) {
  assertHistoricalRange(options.startDate, options.endDate);
  const connection = await mysql.createConnection(getMysqlConfig());
  const db = options.preview ? null : initFirebase();
  let cursor = options.startDate;
  let found = 0;
  let skipped = 0;
  let written = 0;

  try {
    while (cursor <= options.endDate) {
      const chunkEndExclusive = [addDays(cursor, MYSQL_CHUNK_DAYS), addDays(options.endDate, 1)].sort().at(0);
      // fetchTicketSales already excludes Carnes Amparito by client id and normalized name.
      // eslint-disable-next-line no-await-in-loop
      const entries = await fetchTicketSales(connection, cursor, chunkEndExclusive);
      found += entries.length;

      if (options.preview) {
        console.log(`[PREVIEW] ${cursor} a ${addDays(chunkEndExclusive, -1)}: ${entries.length} ticket/s.`);
      } else {
        // eslint-disable-next-line no-await-in-loop
        const result = await writeHistoricalTickets(db, entries);
        skipped += result.skipped;
        written += result.written;
        console.log(`${cursor} a ${addDays(chunkEndExclusive, -1)}: ${result.written} escrito/s, ${result.skipped} sin cambios.`);
      }

      cursor = chunkEndExclusive;
    }
  } finally {
    await connection.end().catch(() => {});
  }

  return { found, skipped, written };
}

async function main() {
  const rootDir = path.resolve(__dirname, '..', '..');
  const functionsDir = path.resolve(__dirname, '..');
  loadEnvFile(path.join(rootDir, '.env.local'));
  loadEnvFile(path.join(functionsDir, '.env.local'));
  const options = parseArgs(process.argv.slice(2));
  const result = await run(options);
  console.log(`Carga historica finalizada: ${result.found} encontrado/s, ${result.written} escrito/s, ${result.skipped} sin cambios.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  ACCOUNTING_LINK_START_DATE,
  DEFAULT_HISTORY_START_DATE,
  assertHistoricalRange,
  buildHistoricalTicketPayload,
  parseArgs,
  run,
  writeHistoricalTickets,
};
