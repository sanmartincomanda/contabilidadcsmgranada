const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const mysql = require('mysql2/promise');
const admin = require('firebase-admin');
const {
  getMysqlConfig,
  initFirebase,
  loadEnvFile,
} = require('./syncSicarBilling');

const execFileAsync = promisify(execFile);

const DEFAULT_STATE_PATH = 'C:\\SICAR\\state\\sicar-branch-transfer-watch.json';
const DEFAULT_INTERVAL_MS = 30000;
const DEFAULT_STALE_MINUTES = 20;
const DEFAULT_STARTUP_LIMIT = 120;
const DEFAULT_RECENT_LIMIT = 40;
const DEFAULT_PILOT_DIR = 'C:\\sicar-pilot';
const DEFAULT_COLLECTION = 'traspasos_costos_sucursal';
const DEFAULT_CONFIG_PATH = path.join(DEFAULT_PILOT_DIR, 'config', 'pilot.settings.json');
const DEFAULT_BUILD_SCRIPT_PATH = path.join(DEFAULT_PILOT_DIR, 'Build-SicarTraspasoSql.ps1');
const DEFAULT_INVOKE_SCRIPT_PATH = path.join(DEFAULT_PILOT_DIR, 'Invoke-SicarTraspasoDb.ps1');
const DEFAULT_QUEUE_DIR = path.join(DEFAULT_PILOT_DIR, 'queue', 'branch-transfers');
const DEFAULT_LOG_DIR = path.join(DEFAULT_PILOT_DIR, 'logs');
const DEFAULT_LOCAL_BRANCH_ID = 'granada';

const BRANCH_SYNONYMS = {
  granada: [
    'granada',
    'granada gold',
    'carnes san martin granada',
    'carnes san martin granada serie a',
    'sucursal granada',
    'sucursal granada serie a',
  ],
  nindiri: [
    'nindiri',
    'carnes san martin nindiri',
    'carnes san martin nindiri serie b',
    'sucursal nindiri',
    'sucursal nindiri serie b',
  ],
};

function normalizeText(value = '') {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function money(value) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function quantity(value) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 10000) / 10000;
}

function parseArgs(argv) {
  return argv.reduce((acc, arg) => {
    if (arg === '--once') acc.once = true;
    else if (arg === '--preview') acc.preview = true;
    else if (arg === '--skipStartupBackfill') acc.skipStartupBackfill = true;
    else if (arg.startsWith('--intervalMs=')) acc.intervalMs = Number(arg.slice('--intervalMs='.length));
    else if (arg.startsWith('--recentLimit=')) acc.recentLimit = Number(arg.slice('--recentLimit='.length));
    else if (arg.startsWith('--startupLimit=')) acc.startupLimit = Number(arg.slice('--startupLimit='.length));
    else if (arg.startsWith('--staleMinutes=')) acc.staleMinutes = Number(arg.slice('--staleMinutes='.length));
    else if (arg.startsWith('--statePath=')) acc.statePath = arg.slice('--statePath='.length);
    else if (arg.startsWith('--collection=')) acc.collection = arg.slice('--collection='.length);
    return acc;
  }, {
    collection: process.env.BRANCH_TRANSFER_COLLECTION || DEFAULT_COLLECTION,
    intervalMs: Number(process.env.BRANCH_TRANSFER_WATCH_INTERVAL_MS || DEFAULT_INTERVAL_MS),
    once: false,
    preview: false,
    recentLimit: Number(process.env.BRANCH_TRANSFER_WATCH_RECENT_LIMIT || DEFAULT_RECENT_LIMIT),
    skipStartupBackfill: String(process.env.BRANCH_TRANSFER_WATCH_SKIP_STARTUP_BACKFILL || '').toLowerCase() === 'true',
    staleMinutes: Number(process.env.BRANCH_TRANSFER_WATCH_STALE_MINUTES || DEFAULT_STALE_MINUTES),
    startupLimit: Number(process.env.BRANCH_TRANSFER_WATCH_STARTUP_LIMIT || DEFAULT_STARTUP_LIMIT),
    statePath: process.env.BRANCH_TRANSFER_WATCH_STATE_PATH || DEFAULT_STATE_PATH,
  });
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readState(statePath) {
  return readJson(statePath, {
    lastLoopAt: null,
    lastOriginSuccessAt: null,
    lastDestinationSuccessAt: null,
    processed: {},
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTimestampValue(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === 'object' && Number.isFinite(value._seconds)) return value._seconds * 1000;
  return 0;
}

function isStale(value, staleMinutes) {
  const timestamp = getTimestampValue(value);
  if (!timestamp) return true;
  return Date.now() - timestamp >= staleMinutes * 60 * 1000;
}

function nowIso() {
  return new Date().toISOString();
}

function toIdSafeSegment(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'sin_ref';
}

function getTransferItems(transfer = {}) {
  if (Array.isArray(transfer.items)) return transfer.items;
  if (Array.isArray(transfer.articulos)) return transfer.articulos;
  return [];
}

function getAppliedQuantity(item = {}) {
  const resolved = quantity(item.quantityApplied ?? item.cantidadAplicada ?? item.resolvedQuantity);
  if (resolved > 0) return resolved;
  const pesoReal = quantity(item.pesoReal);
  if (pesoReal > 0) return pesoReal;
  return quantity(item.cantidad);
}

function resolveBranchId(value) {
  const normalized = normalizeText(value);
  if (!normalized) return DEFAULT_LOCAL_BRANCH_ID;

  for (const [branchId, aliases] of Object.entries(BRANCH_SYNONYMS)) {
    if (aliases.some((alias) => normalizeText(alias) === normalized)) {
      return branchId;
    }
  }

  return normalized;
}

function getTransferBranchId(transfer, direction) {
  if (direction === 'from') {
    return resolveBranchId(
      transfer.fromBranchId
      || transfer.branchFrom
      || transfer.originBranchId
      || transfer.fromBranchName
      || transfer.branchName
    );
  }

  return resolveBranchId(
    transfer.toBranchId
    || transfer.branchTo
    || transfer.targetBranchId
    || transfer.toBranchName
    || transfer.destinationBranchName
  );
}

function readPilotSettings() {
  return readJson(DEFAULT_CONFIG_PATH, {});
}

function resolveKnownMapping(settings, value) {
  const mappings = settings?.Sucursal?.KnownMappings || {};
  const normalizedValue = normalizeText(value);
  const entry = Object.entries(mappings).find(([key]) => normalizeText(key) === normalizedValue);
  return entry?.[1] || '';
}

function resolveSicarBranchName(settings, value, branchId = '') {
  const directMapping = resolveKnownMapping(settings, value);
  if (directMapping) return directMapping;

  const resolvedBranchId = resolveBranchId(branchId || value);
  if (resolvedBranchId === 'granada') return 'Carnes San Martin Granada';
  if (resolvedBranchId === 'nindiri') return 'Carnes San Martin Nindiri';
  return String(value || '').trim();
}

function transferReference(transfer) {
  return String(transfer.reference || transfer.numeroOrden || transfer.id || '').trim();
}

function getOperationalStatus(transfer = {}) {
  return String(transfer.operationalStatus || transfer.integrationStatus || transfer.status || '').trim().toLowerCase();
}

function getAccountingStatus(transfer = {}) {
  return String(transfer.accountingStatus || '').trim().toLowerCase();
}

function mergeResolvedItems(items = [], resolvedItems = []) {
  return items.map((item, index) => {
    const resolved = resolvedItems.find((entry) => Number(entry.order) === index)
      || resolvedItems[index]
      || {};
    const quantityApplied = quantity(resolved.cantidad ?? item.quantityPreview ?? item.pesoReal ?? item.cantidad);
    const unitCost = money(resolved.precio ?? item.costoUnitarioSicar ?? item.precioSin);
    const lineTotal = money(resolved.importe ?? item.totalCostoSicar ?? quantityApplied * unitCost);

    return {
      ...item,
      lineNumber: Number(resolved.lineNumber || index + 1),
      resolvedClave: resolved.clave || item.resolvedClave || item.clave || '',
      claveResolution: resolved.claveResolution || item.claveResolution || '',
      resolvedDescription: resolved.descripcion || item.resolvedDescription || item.descripcion || '',
      unidadSicar: resolved.unidad || item.unidadSicar || item.unidad || '',
      quantityApplied,
      quantitySource: resolved.quantitySource || item.quantitySource || (quantity(item.pesoReal) > 0 ? 'pesoReal' : 'cantidad'),
      costoUnitarioSicar: unitCost,
      totalCostoSicar: lineTotal,
      artId: Number(resolved.artId || item.artId || 0) || null,
    };
  });
}

function sumResolvedWeight(items = []) {
  return quantity(items.reduce((sum, item) => sum + getAppliedQuantity(item), 0));
}

function buildQueueJob(transfer, settings) {
  const fromBranchId = getTransferBranchId(transfer, 'from');
  const toBranchId = getTransferBranchId(transfer, 'to');
  const items = getTransferItems(transfer).map((item) => ({
    clave: String(item.clave || '').trim(),
    descripcion: String(item.descripcion || item.description || '').trim(),
    cantidad: String(item.cantidad ?? ''),
    unidad: String(item.unidad || '').trim().toUpperCase(),
    pesoReal: String(item.pesoReal ?? ''),
    pesoCorregido: false,
    fechaCorreccion: '',
    nota: String(item.nota || '').trim(),
  }));

  return {
    queueId: `${Date.now()}-${toIdSafeSegment(transferReference(transfer) || transfer.id)}`,
    createdAt: nowIso(),
    source: 'branch-transfer-sicar',
    pedidoFirebaseId: transfer.id,
    numeroOrden: transferReference(transfer) || transfer.id,
    pedidoEstado: transfer.operationalStatus || transfer.status || 'pendiente_sicar',
    firebase: {
      sucursalSolicitante: transfer.toBranchName || toBranchId,
      sucursalAtendio: transfer.fromBranchName || fromBranchId,
    },
    sicar: {
      traspasoOrigenReal: resolveSicarBranchName(settings, transfer.fromBranchName || fromBranchId, fromBranchId),
      traspasoDestinoReal: resolveSicarBranchName(settings, transfer.toBranchName || toBranchId, toBranchId),
    },
    items,
    status: 'pendiente',
    dbDraft: {
      mode: 'mysql',
      saveAllowed: false,
      comment: `App traspaso ${transferReference(transfer) || transfer.id} | doc ${transfer.id}`,
    },
  };
}

async function runPowerShellJson(scriptPath, scriptArgs = []) {
  const powerShellPath = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...scriptArgs];
  const { stdout, stderr } = await execFileAsync(powerShellPath, args, {
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });

  const output = String(stdout || '').trim();
  if (stderr && String(stderr).trim()) {
    throw new Error(String(stderr).trim());
  }
  if (!output) {
    throw new Error(`Sin salida JSON desde ${path.basename(scriptPath)}.`);
  }

  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`No pude interpretar la salida de ${path.basename(scriptPath)}: ${output}`);
  }
}

async function loadLocalSicarMeta(connection) {
  const [rows] = await connection.execute('SELECT sucId, alias FROM nubecfg LIMIT 1');
  if (!rows.length) {
    throw new Error('No pude resolver la sucursal local desde nubecfg.');
  }

  return {
    sucId: Number(rows[0].sucId),
    alias: String(rows[0].alias || '').trim(),
  };
}

function buildExpectedEntrySignature(items = []) {
  return items
    .map((item) => `${normalizeText(item.resolvedClave || item.clave || '')}|${quantity(getAppliedQuantity(item)).toFixed(4)}`)
    .sort();
}

async function findIncomingCandidate(connection, transfer, localMeta, settings) {
  const expectedOriginAlias = normalizeText(
    resolveSicarBranchName(settings, transfer.fromBranchName || getTransferBranchId(transfer, 'from'), getTransferBranchId(transfer, 'from'))
  );
  const expectedDestinationAlias = normalizeText(localMeta.alias);
  const expectedSignatures = buildExpectedEntrySignature(getTransferItems(transfer));
  const expectedDate = String(transfer.date || '').trim();

  const [headers] = await connection.execute(`
    SELECT
      tra_id AS traId,
      folio,
      sucOri,
      sucDes,
      aliasOri,
      aliasDes,
      DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha,
      total,
      status,
      IFNULL(DATE_FORMAT(fechaApl, '%Y-%m-%d %H:%i:%s'), '') AS fechaApl
    FROM traspaso
    WHERE sucDes = ?
      AND status = 1
    ORDER BY tra_id DESC
    LIMIT 120
  `, [localMeta.sucId]);

  let bestMatch = null;

  for (const header of headers) {
    if (normalizeText(header.aliasOri) !== expectedOriginAlias) continue;
    if (normalizeText(header.aliasDes) !== expectedDestinationAlias) continue;

    const [details] = await connection.execute(`
      SELECT
        tra_id AS traId,
        art_id AS artId,
        clave,
        descripcion,
        cantidad,
        unidad,
        precioSin,
        importeSin,
        orden
      FROM detallet
      WHERE tra_id = ?
      ORDER BY orden, art_id
    `, [header.traId]);

    if (details.length !== expectedSignatures.length) continue;

    const detailSignatures = details
      .map((detail) => `${normalizeText(detail.clave)}|${quantity(detail.cantidad).toFixed(4)}`)
      .sort();

    if (detailSignatures.join('||') !== expectedSignatures.join('||')) continue;

    let score = 100;
    if (String(header.fecha || '') === expectedDate) score += 10;

    const candidate = { header, details, score };
    if (!bestMatch || candidate.score > bestMatch.score || Number(candidate.header.traId) > Number(bestMatch.header.traId)) {
      bestMatch = candidate;
    }
  }

  return bestMatch;
}

async function applyIncomingCandidate(connection, candidate) {
  await connection.beginTransaction();

  try {
    const [updateResult] = await connection.execute(`
      UPDATE traspaso
      SET status = 2,
          fechaApl = NOW()
      WHERE tra_id = ?
        AND status = 1
        AND fechaApl IS NULL
    `, [candidate.header.traId]);

    if (Number(updateResult.affectedRows || 0) !== 1) {
      throw new Error(`El traspaso ${candidate.header.traId} ya no estaba pendiente al intentar aplicarlo.`);
    }

    for (const detail of candidate.details) {
      // eslint-disable-next-line no-await-in-loop
      await connection.execute(`
        UPDATE articulo
        SET existencia = ROUND(existencia + ?, 4)
        WHERE art_id = ?
      `, [quantity(detail.cantidad), detail.artId]);
    }

    await connection.execute(`
      INSERT INTO historial (movimiento, fecha, tabla, id, usu_id)
      VALUES (1, NOW(), 'Traspaso', ?, 1)
    `, [candidate.header.traId]);

    await connection.commit();

    return {
      traId: Number(candidate.header.traId),
      folio: Number(candidate.header.folio),
      total: money(candidate.header.total),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

async function writeQueueJobFile(queueDir, transfer, settings) {
  fs.mkdirSync(queueDir, { recursive: true });
  const job = buildQueueJob(transfer, settings);
  const outputPath = path.join(queueDir, `${toIdSafeSegment(transferReference(transfer) || transfer.id)}-${transfer.id}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(job, null, 2)}\n`, 'utf8');
  return { job, outputPath };
}

function toTransferSnapshot(doc) {
  return { id: doc.id, ...doc.data() };
}

async function claimRole(docRef, role, localServerName, staleMinutes) {
  const db = docRef.firestore;

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef);
    if (!snapshot.exists) return null;

    const transfer = toTransferSnapshot(snapshot);
    const roleData = transfer[role] || {};
    const status = String(roleData.status || 'pending').trim().toLowerCase();

    if (status === 'completed') {
      return null;
    }

    if (status === 'processing' && !isStale(roleData.startedAt || roleData.lastHeartbeatAt, staleMinutes)) {
      return null;
    }

    transaction.set(docRef, {
      [role]: {
        ...roleData,
        status: 'processing',
        serverName: localServerName,
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastHeartbeatAt: admin.firestore.FieldValue.serverTimestamp(),
        attempts: Number(roleData.attempts || 0) + 1,
        lastError: '',
      },
      integrationStatus: 'processing',
      operationalStatus: 'procesando',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return {
      ...transfer,
      [role]: {
        ...roleData,
        status: 'processing',
        attempts: Number(roleData.attempts || 0) + 1,
        serverName: localServerName,
      },
    };
  });
}

function currentItemCount(transfer) {
  return getTransferItems(transfer).length;
}

function getLogPath() {
  const fileName = `branch-transfer-watch-${new Date().toISOString().substring(0, 10).replace(/-/g, '')}.log`;
  return path.join(DEFAULT_LOG_DIR, fileName);
}

function log(level, message, data = {}) {
  fs.mkdirSync(DEFAULT_LOG_DIR, { recursive: true });
  const line = `[${new Date().toISOString()}] [${level}] ${message}${Object.keys(data).length ? ` | ${Object.entries(data).map(([key, value]) => `${key}=${value}`).join('; ')}` : ''}`;
  fs.appendFileSync(getLogPath(), `${line}\n`, 'utf8');
  console.log(line);
}

async function markWaitingReplication(docRef, transfer) {
  if (String(transfer?.sicarDestination?.status || '').trim().toLowerCase() === 'waiting_replication') {
    return;
  }

  await docRef.set({
    sicarDestination: {
      ...(transfer.sicarDestination || {}),
      status: 'waiting_replication',
      lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function processOriginTransfer({ docRef, transfer, settings, mysqlConfig, options, state, localServerName }) {
  const claimed = await claimRole(docRef, 'sicarOrigin', localServerName, options.staleMinutes);
  if (!claimed) return false;

  const { outputPath: jobPath } = await writeQueueJobFile(DEFAULT_QUEUE_DIR, claimed, settings);
  const buildArgs = ['-JobPath', jobPath, '-ConfigPath', DEFAULT_CONFIG_PATH, '-Password', mysqlConfig.password];
  const invokeArgs = ['-JobPath', jobPath, '-ConfigPath', DEFAULT_CONFIG_PATH, '-Password', mysqlConfig.password];

  if (options.preview) {
    const preview = await runPowerShellJson(DEFAULT_BUILD_SCRIPT_PATH, buildArgs);
    log('INFO', 'Preview de salida SICAR generado', {
      transferId: claimed.id,
      reference: transferReference(claimed),
      total: preview.total,
    });
    return true;
  }

  try {
    const build = await runPowerShellJson(DEFAULT_BUILD_SCRIPT_PATH, buildArgs);
    const mergedItems = mergeResolvedItems(getTransferItems(claimed), build.resolvedItems || []);
    const totalWeightResolved = sumResolvedWeight(mergedItems);
    const totalAmount = money(build.total);

    await docRef.set({
      items: mergedItems,
      amount: totalAmount,
      totalWeightResolved,
      totalLineItems: currentItemCount(claimed),
      accountingStatus: 'pending',
      sicarOrigin: {
        ...(claimed.sicarOrigin || {}),
        status: 'processing',
        estimatedFolio: Number(build.folioEstimado || 0) || null,
        sucursalOrigenAlias: build.sucursalOrigenAlias || '',
        sucursalDestinoAlias: build.sucursalDestinoAlias || '',
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    const result = await runPowerShellJson(DEFAULT_INVOKE_SCRIPT_PATH, [...invokeArgs, '-Commit']);
    const destinationCompleted = String(claimed?.sicarDestination?.status || '').trim().toLowerCase() === 'completed';

    await docRef.set({
      items: mergedItems,
      amount: totalAmount,
      totalWeightResolved,
      accountingStatus: destinationCompleted ? 'completed' : 'ready',
      integrationStatus: destinationCompleted ? 'completed' : 'processing',
      operationalStatus: destinationCompleted ? 'completado' : 'salida_aplicada',
      sicarOrigin: {
        ...(claimed.sicarOrigin || {}),
        status: 'completed',
        traId: Number(result.traId || 0) || null,
        folio: Number(result.folio || 0) || null,
        total: totalAmount,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        queueJobPath: jobPath,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    state.lastOriginSuccessAt = nowIso();
    state.processed[claimed.id] = {
      ...(state.processed[claimed.id] || {}),
      originProcessedAt: state.lastOriginSuccessAt,
      reference: transferReference(claimed),
    };

    log('INFO', 'Salida SICAR aplicada desde watcher', {
      transferId: claimed.id,
      reference: transferReference(claimed),
      traId: result.traId,
      folio: result.folio,
      total: totalAmount,
    });
    return true;
  } catch (error) {
    await docRef.set({
      integrationStatus: 'error',
      operationalStatus: 'error_origen',
      sicarOrigin: {
        ...(claimed.sicarOrigin || {}),
        status: 'error',
        lastError: error.message,
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    log('ERROR', 'Fallo procesando salida SICAR', {
      transferId: claimed.id,
      reference: transferReference(claimed),
      error: error.message,
    });
    return false;
  }
}

async function processDestinationTransfer({ docRef, transfer, settings, connection, localMeta, options, state, localServerName }) {
  const originStatus = String(transfer?.sicarOrigin?.status || '').trim().toLowerCase();
  const destinationStatus = String(transfer?.sicarDestination?.status || '').trim().toLowerCase();
  if (originStatus !== 'completed') return false;
  if (destinationStatus === 'completed') return false;

  const candidate = await findIncomingCandidate(connection, transfer, localMeta, settings);
  if (!candidate) {
    await markWaitingReplication(docRef, transfer);
    return false;
  }

  const claimed = await claimRole(docRef, 'sicarDestination', localServerName, options.staleMinutes);
  if (!claimed) return false;

  if (options.preview) {
    log('INFO', 'Preview de entrada SICAR detectado', {
      transferId: claimed.id,
      reference: transferReference(claimed),
      traId: candidate.header.traId,
      folio: candidate.header.folio,
    });
    return true;
  }

  try {
    const result = await applyIncomingCandidate(connection, candidate);

    await docRef.set({
      integrationStatus: 'completed',
      operationalStatus: 'completado',
      accountingStatus: 'completed',
      sicarDestination: {
        ...(claimed.sicarDestination || {}),
        status: 'completed',
        traId: result.traId,
        folio: result.folio,
        total: result.total,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    state.lastDestinationSuccessAt = nowIso();
    state.processed[claimed.id] = {
      ...(state.processed[claimed.id] || {}),
      destinationProcessedAt: state.lastDestinationSuccessAt,
      reference: transferReference(claimed),
    };

    log('INFO', 'Entrada SICAR aplicada desde watcher', {
      transferId: claimed.id,
      reference: transferReference(claimed),
      traId: result.traId,
      folio: result.folio,
      total: result.total,
    });
    return true;
  } catch (error) {
    await docRef.set({
      integrationStatus: 'error',
      operationalStatus: 'error_destino',
      sicarDestination: {
        ...(claimed.sicarDestination || {}),
        status: 'error',
        lastError: error.message,
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    log('ERROR', 'Fallo procesando entrada SICAR', {
      transferId: claimed.id,
      reference: transferReference(claimed),
      error: error.message,
    });
    return false;
  }
}

async function fetchStartupCandidates(db, collectionName, startupLimit) {
  const snapshot = await db.collection(collectionName)
    .where('sourceType', '==', 'branch_transfer_sicar')
    .limit(Math.max(10, Math.min(startupLimit, 300)))
    .get();

  return snapshot.docs.map((doc) => ({ ref: doc.ref, transfer: toTransferSnapshot(doc) }));
}

async function fetchRecentCandidates(db, collectionName, recentLimit) {
  const snapshot = await db.collection(collectionName)
    .orderBy('updatedAt', 'desc')
    .limit(Math.max(10, Math.min(recentLimit, 100)))
    .get();

  return snapshot.docs
    .map((doc) => ({ ref: doc.ref, transfer: toTransferSnapshot(doc) }))
    .filter(({ transfer }) => String(transfer.sourceType || '').trim() === 'branch_transfer_sicar');
}

async function processCandidates({ db, collectionName, connection, localMeta, localBranchId, mysqlConfig, settings, options, state, startup = false }) {
  const candidates = startup && !options.skipStartupBackfill
    ? await fetchStartupCandidates(db, collectionName, options.startupLimit)
    : await fetchRecentCandidates(db, collectionName, options.recentLimit);

  for (const { ref, transfer } of candidates) {
    if (String(transfer.status || 'activo').trim().toLowerCase() === 'anulado') {
      continue;
    }

    const fromBranchId = getTransferBranchId(transfer, 'from');
    const toBranchId = getTransferBranchId(transfer, 'to');
    const involvesLocalBranch = fromBranchId === localBranchId || toBranchId === localBranchId;
    if (!involvesLocalBranch) continue;

    if (fromBranchId === localBranchId) {
      // eslint-disable-next-line no-await-in-loop
      await processOriginTransfer({
        docRef: ref,
        transfer,
        settings,
        mysqlConfig,
        options,
        state,
        localServerName: os.hostname(),
      });
    }

    if (toBranchId === localBranchId) {
      // eslint-disable-next-line no-await-in-loop
      await processDestinationTransfer({
        docRef: ref,
        transfer,
        settings,
        connection,
        localMeta,
        options,
        state,
        localServerName: os.hostname(),
      });
    }
  }
}

async function main() {
  const rootDir = path.resolve(__dirname, '..', '..');
  const functionsDir = path.resolve(__dirname, '..');
  loadEnvFile(path.join(rootDir, '.env.local'));
  loadEnvFile(path.join(functionsDir, '.env.local'));

  const options = parseArgs(process.argv.slice(2));
  options.intervalMs = Math.max(15000, Math.min(Number(options.intervalMs || DEFAULT_INTERVAL_MS), 300000));
  options.recentLimit = Math.max(10, Math.min(Number(options.recentLimit || DEFAULT_RECENT_LIMIT), 100));
  options.startupLimit = Math.max(10, Math.min(Number(options.startupLimit || DEFAULT_STARTUP_LIMIT), 300));
  options.staleMinutes = Math.max(5, Math.min(Number(options.staleMinutes || DEFAULT_STALE_MINUTES), 240));

  const localBranchId = resolveBranchId(process.env.BRANCH_TRANSFER_LOCAL_BRANCH_ID || process.env.SICAR_BRANCH_ID || DEFAULT_LOCAL_BRANCH_ID);
  const settings = readPilotSettings();
  const mysqlConfig = getMysqlConfig();
  const db = initFirebase();
  const connection = await mysql.createConnection(mysqlConfig);
  const state = readState(options.statePath);
  const localMeta = await loadLocalSicarMeta(connection);

  try {
    log('INFO', 'Watcher de traspasos SICAR iniciado', {
      collection: options.collection,
      localBranchId,
      preview: options.preview,
      once: options.once,
      intervalMs: options.intervalMs,
      localAlias: localMeta.alias,
    });

    if (!options.skipStartupBackfill) {
      await processCandidates({
        db,
        collectionName: options.collection,
        connection,
        localMeta,
        localBranchId,
        mysqlConfig,
        settings,
        options,
        state,
        startup: true,
      });
    }

    do {
      try {
        state.lastLoopAt = nowIso();
        await processCandidates({
          db,
          collectionName: options.collection,
          connection,
          localMeta,
          localBranchId,
          mysqlConfig,
          settings,
          options,
          state,
          startup: false,
        });
      } catch (error) {
        log('ERROR', 'Error en loop del watcher de traspasos SICAR', {
          error: error.message,
        });
      }

      writeJson(options.statePath, state);
      if (options.once) break;
      // eslint-disable-next-line no-await-in-loop
      await sleep(options.intervalMs);
    } while (true);
  } finally {
    writeJson(options.statePath, state);
    await connection.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
