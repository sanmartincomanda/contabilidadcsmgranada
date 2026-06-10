const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const admin = require('firebase-admin');

const PROJECT_ID = 'sistema-contable-csm-granada';
const DEFAULT_BUCKET = 'sistema-contable-csm-granada.firebasestorage.app';
const DEFAULT_KEY_PATH = 'C:\\SICAR\\keys\\firebase-adminsdk.json';
const DEFAULT_WATCH_DIR = 'C:\\CSM\\soportes-escaneados';
const INBOX_COLLECTION = 'soportes_escaneados_pendientes';
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf']);

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
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
    if (arg === '--once') acc.once = true;
    else if (arg === '--dry-run') acc.dryRun = true;
    else if (arg.startsWith('--watchDir=')) acc.watchDir = arg.slice('--watchDir='.length);
    else if (arg.startsWith('--archiveDir=')) acc.archiveDir = arg.slice('--archiveDir='.length);
    else if (arg.startsWith('--errorDir=')) acc.errorDir = arg.slice('--errorDir='.length);
    else if (arg.startsWith('--intervalMs=')) acc.intervalMs = Number(arg.slice('--intervalMs='.length));
    else if (arg.startsWith('--stableMs=')) acc.stableMs = Number(arg.slice('--stableMs='.length));
    return acc;
  }, {
    once: false,
    dryRun: false,
    watchDir: process.env.SCANNER_SUPPORT_WATCH_DIR || DEFAULT_WATCH_DIR,
    archiveDir: process.env.SCANNER_SUPPORT_ARCHIVE_DIR || '',
    errorDir: process.env.SCANNER_SUPPORT_ERROR_DIR || '',
    intervalMs: Number(process.env.SCANNER_SUPPORT_INTERVAL_MS || 5000),
    stableMs: Number(process.env.SCANNER_SUPPORT_STABLE_MS || 3500),
  });
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeDir(value) {
  return path.resolve(String(value || '').trim());
}

function sanitizeStorageSegment(value, fallback = 'soporte') {
  return String(value || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96) || fallback;
}

function contentTypeFromExtension(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

function firebaseStorageUrl(bucketName, storagePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
}

function formatDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isSupportedFile(filePath) {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha1');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function waitForStableFile(filePath, stableMs) {
  const first = fs.statSync(filePath);
  await new Promise((resolve) => setTimeout(resolve, stableMs));
  const second = fs.statSync(filePath);
  return first.size === second.size && first.mtimeMs === second.mtimeMs;
}

function uniqueMovePath(targetDir, fileName) {
  const parsed = path.parse(fileName);
  let candidate = path.join(targetDir, fileName);
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(targetDir, `${parsed.name}_${Date.now()}_${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

function moveFile(filePath, targetDir) {
  ensureDir(targetDir);
  const targetPath = uniqueMovePath(targetDir, path.basename(filePath));
  fs.renameSync(filePath, targetPath);
  return targetPath;
}

function initFirebase() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(DEFAULT_KEY_PATH)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = DEFAULT_KEY_PATH;
  }

  if (admin.apps.length > 0) {
    return {
      db: admin.firestore(),
      bucket: admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET || DEFAULT_BUCKET),
    };
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID || PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || DEFAULT_BUCKET,
  });

  return {
    db: admin.firestore(),
    bucket: admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET || DEFAULT_BUCKET),
  };
}

async function processFile({ filePath, archiveDir, errorDir, stableMs, dryRun, db, bucket }) {
  const fileName = path.basename(filePath);
  const stat = fs.statSync(filePath);

  if (!isSupportedFile(filePath)) return { skipped: true, reason: 'unsupported', fileName };
  if (stat.size <= 0) return { skipped: true, reason: 'empty', fileName };
  if (stat.size > MAX_FILE_SIZE_BYTES) {
    const errorPath = moveFile(filePath, errorDir);
    return { skipped: true, reason: 'too_large', fileName, errorPath };
  }

  const stable = await waitForStableFile(filePath, stableMs);
  if (!stable) return { skipped: true, reason: 'not_stable_yet', fileName };

  const sha1 = await hashFile(filePath);
  const docId = `scan_${sha1.slice(0, 24)}`;
  const docRef = db.collection(INBOX_COLLECTION).doc(docId);
  const existing = await docRef.get();

  if (existing.exists) {
    const archivedPath = dryRun ? '' : moveFile(filePath, archiveDir);
    console.log(JSON.stringify({ ok: true, duplicate: true, docId, fileName, archivedPath }));
    return { duplicate: true, docId, fileName, archivedPath };
  }

  const ext = path.extname(fileName).toLowerCase().replace('.', '') || 'bin';
  const safeName = sanitizeStorageSegment(fileName);
  const storagePath = `scanner/inbox/${formatDate()}/${docId}/${Date.now()}_${safeName}.${ext}`;
  const contentType = contentTypeFromExtension(filePath);
  const downloadToken = randomUUID();

  if (!dryRun) {
    await bucket.upload(filePath, {
      destination: storagePath,
      resumable: false,
      metadata: {
        contentType,
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          scannerSupportHash: sha1,
          scannerOriginalFileName: fileName,
        },
      },
    });
  }

  const url = firebaseStorageUrl(bucket.name, storagePath, downloadToken);
  const uploadedAt = new Date().toISOString();
  const support = {
    type: 'invoice',
    label: 'Factura / soporte principal',
    url,
    path: storagePath,
    source: 'scanner-agent',
    sourceCollection: INBOX_COLLECTION,
    sourceDocId: docId,
    fileName,
    contentType,
    uploadedAt,
  };

  let archivedPath = '';
  if (!dryRun) {
    await docRef.set({
      status: 'pending',
      source: 'scanner-agent',
      sourceType: 'local-scanner',
      uploadedAt,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      originalFileName: fileName,
      originalPath: filePath,
      fileName,
      contentType,
      size: stat.size,
      sha1,
      url,
      path: storagePath,
      fotoFacturaUrl: url,
      fotoFacturaPath: storagePath,
      support,
      supportFiles: [support],
      assignedCollection: '',
      assignedDocId: '',
      assignedAt: null,
      notes: 'Soporte recibido desde escaner local. Pendiente de vincular a gasto, compra, cuenta por pagar o abono.',
    }, { merge: true });

    archivedPath = moveFile(filePath, archiveDir);
    await docRef.set({
      archivedPath,
      archivedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  console.log(JSON.stringify({ ok: true, uploaded: true, docId, fileName, storagePath, archivedPath }));
  return { uploaded: true, docId, fileName, storagePath, archivedPath };
}

async function scanOnce(options, firebase) {
  ensureDir(options.watchDir);
  ensureDir(options.archiveDir);
  ensureDir(options.errorDir);

  const files = fs.readdirSync(options.watchDir)
    .map((name) => path.join(options.watchDir, name))
    .filter((filePath) => {
      try {
        return fs.statSync(filePath).isFile();
      } catch {
        return false;
      }
    });

  const results = [];
  for (const filePath of files) {
    try {
      results.push(await processFile({ ...options, ...firebase, filePath }));
    } catch (error) {
      const fileName = path.basename(filePath);
      let errorPath = '';
      try {
        if (fs.existsSync(filePath)) errorPath = moveFile(filePath, options.errorDir);
      } catch (moveError) {
        console.error(JSON.stringify({ ok: false, fileName, error: error.message, moveError: moveError.message }));
        continue;
      }
      console.error(JSON.stringify({ ok: false, fileName, error: error.message, errorPath }));
      results.push({ error: true, fileName, error: error.message, errorPath });
    }
  }

  return results;
}

async function main() {
  const rootDir = path.resolve(__dirname, '..', '..');
  const functionsDir = path.resolve(__dirname, '..');
  loadEnvFile(path.join(rootDir, '.env.local'));
  loadEnvFile(path.join(functionsDir, '.env.local'));

  const args = parseArgs(process.argv.slice(2));
  const options = {
    ...args,
    watchDir: normalizeDir(args.watchDir),
    archiveDir: normalizeDir(args.archiveDir || path.join(args.watchDir, 'procesados')),
    errorDir: normalizeDir(args.errorDir || path.join(args.watchDir, 'errores')),
    intervalMs: Number.isFinite(args.intervalMs) && args.intervalMs >= 2000 ? args.intervalMs : 5000,
    stableMs: Number.isFinite(args.stableMs) && args.stableMs >= 1000 ? args.stableMs : 3500,
  };

  const firebase = initFirebase();
  console.log(JSON.stringify({
    ok: true,
    started: true,
    mode: options.once ? 'once' : 'watch',
    dryRun: options.dryRun,
    watchDir: options.watchDir,
    archiveDir: options.archiveDir,
    errorDir: options.errorDir,
    collection: INBOX_COLLECTION,
    bucket: firebase.bucket.name,
  }));

  if (options.once) {
    await scanOnce(options, firebase);
    return;
  }

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await scanOnce(options, firebase);
    } finally {
      running = false;
    }
  };

  await run();
  const timer = setInterval(run, options.intervalMs);

  const shutdown = () => {
    clearInterval(timer);
    console.log(JSON.stringify({ ok: true, stopped: true }));
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
