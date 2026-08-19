const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');
const { getSyncLogRetentionDays } = require('./sicarSyncLogRetention');

const DEFAULT_KEY_PATH = 'C:\\SICAR\\keys\\firebase-adminsdk.json';
const PROJECT_ID = 'sistema-contable-csm-granada';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  fs.readFileSync(filePath, 'utf8').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const separator = trimmed.indexOf('=');
    if (separator === -1) return;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}

function parseArgs(argv) {
  return argv.reduce((acc, arg) => {
    if (arg === '--preview') acc.preview = true;
    else if (arg.startsWith('--limit=')) acc.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--retentionDays=')) acc.retentionDays = Number(arg.slice('--retentionDays='.length));
    return acc;
  }, {
    limit: Number(process.env.SICAR_SYNC_LOG_PRUNE_LIMIT || 500),
    preview: false,
    retentionDays: getSyncLogRetentionDays(),
  });
}

function initFirebase() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = DEFAULT_KEY_PATH;
  }
  if (!process.env.GOOGLE_CLOUD_PROJECT) {
    process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
  }
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  return admin.firestore();
}

async function deleteSnapshot(db, snapshot, preview) {
  if (snapshot.empty) return 0;
  if (preview) return snapshot.size;

  let deleted = 0;
  for (let index = 0; index < snapshot.docs.length; index += 450) {
    const batch = db.batch();
    snapshot.docs.slice(index, index + 450).forEach((recordDoc) => batch.delete(recordDoc.ref));
    // eslint-disable-next-line no-await-in-loop
    await batch.commit();
    deleted += Math.min(450, snapshot.docs.length - index);
  }
  return deleted;
}

async function main() {
  const rootDir = path.resolve(__dirname, '..', '..');
  const functionsDir = path.resolve(__dirname, '..');
  loadEnvFile(path.join(rootDir, '.env.local'));
  loadEnvFile(path.join(functionsDir, '.env.local'));

  const args = parseArgs(process.argv.slice(2));
  const limit = Math.max(50, Math.min(Number(args.limit || 500), 2000));
  const retentionDays = Math.max(7, Math.min(Number(args.retentionDays || getSyncLogRetentionDays()), 180));
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const cutoffTimestamp = admin.firestore.Timestamp.fromDate(cutoff);
  const db = initFirebase();

  const expiredSnapshot = await db.collection('sicar_sync_logs')
    .where('expiresAt', '<=', admin.firestore.Timestamp.now())
    .limit(limit)
    .get();
  const deletedExpired = await deleteSnapshot(db, expiredSnapshot, args.preview);
  const remainingLimit = Math.max(0, limit - deletedExpired);
  let deletedLegacy = 0;

  if (remainingLimit > 0) {
    const legacySnapshot = await db.collection('sicar_sync_logs')
      .where('createdAt', '<=', cutoffTimestamp)
      .limit(remainingLimit)
      .get();
    deletedLegacy = await deleteSnapshot(db, legacySnapshot, args.preview);
  }

  console.log(JSON.stringify({
    ok: true,
    preview: args.preview,
    retentionDays,
    cutoff: cutoff.toISOString(),
    deletedExpired,
    deletedLegacy,
    totalDeleted: deletedExpired + deletedLegacy,
    limit,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
