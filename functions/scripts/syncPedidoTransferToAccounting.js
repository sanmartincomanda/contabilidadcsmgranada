const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const FUNCTIONS_DIR = path.resolve(__dirname, '..');
const TRANSFER_COLLECTION = 'traspasos_costos_sucursal';
const DEFAULT_SOURCE_PROJECT_ID = 'pedidosinterno-3c65d';
const DEFAULT_DATABASE_URL = 'https://pedidosinterno-3c65d-default-rtdb.firebaseio.com';
const DEFAULT_CATEGORY = 'Costos de venta / compras';
const DEFAULT_SUBCATEGORY = 'Traspasos entre sucursales';

const BRANCH_DEFINITIONS = [
  {
    branchId: 'granada',
    branchCode: 'GRANADA',
    branchName: 'CARNES SAN MARTIN GRANADA',
    documentSeries: 'A',
    aliases: [
      'granada',
      'granada gold',
      'carnes san martin granada',
      'carnes san martin granada serie a',
      'sucursal granada',
      'sucursal granada serie a',
      'serie a',
    ],
  },
  {
    branchId: 'nindiri',
    branchCode: 'NINDIRI',
    branchName: 'CARNES SAN MARTIN NINDIRI',
    documentSeries: 'B',
    aliases: [
      'nindiri',
      'carnes san martin nindiri',
      'carnes san martin nindiri serie b',
      'sucursal nindiri',
      'sucursal nindiri serie b',
      'serie b',
    ],
  },
];

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function applyLocalEnv() {
  readEnvFile(path.join(ROOT_DIR, '.env.local'));
  readEnvFile(path.join(ROOT_DIR, '.env'));
  readEnvFile(path.join(FUNCTIONS_DIR, '.env.local'));
  readEnvFile(path.join(FUNCTIONS_DIR, '.env'));
}

function parseArgs(argv) {
  return argv.reduce((acc, arg) => {
    if (!arg.startsWith('--')) return acc;

    const separatorIndex = arg.indexOf('=');
    if (separatorIndex === -1) {
      acc[arg.slice(2)] = true;
      return acc;
    }

    const key = arg.slice(2, separatorIndex);
    const value = arg.slice(separatorIndex + 1);
    acc[key] = value;
    return acc;
  }, {});
}

function normalizeText(value = '') {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase();
}

function safeNumber(value) {
  const normalized = String(value ?? '').replace(/,/g, '').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundTo(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((safeNumber(value) + Number.EPSILON) * factor) / factor;
}

function pickFirstNumber(candidates = []) {
  for (const candidate of candidates) {
    const parsed = safeNumber(candidate);
    if (parsed > 0) {
      return parsed;
    }
  }

  return 0;
}

function getPedidoItems(pedido = {}) {
  if (Array.isArray(pedido.items)) {
    return pedido.items.filter((item) => item && typeof item === 'object');
  }

  if (pedido.items && typeof pedido.items === 'object') {
    const keys = Object.keys(pedido.items);
    if (!keys.length) return [];

    if (keys.every((key) => /^\d+$/u.test(key))) {
      return keys
        .sort((left, right) => Number(left) - Number(right))
        .map((key) => pedido.items[key])
        .filter((item) => item && typeof item === 'object');
    }

    return [pedido.items];
  }

  return [];
}

function getRequestedQuantity(item = {}) {
  return roundTo(item.cantidad, 4);
}

function getRealQuantity(item = {}) {
  const realQuantity = roundTo(item.pesoReal, 4);
  if (realQuantity > 0) {
    return realQuantity;
  }

  return getRequestedQuantity(item);
}

function getItemUnitCost(item = {}, pedido = {}) {
  return pickFirstNumber([
    item.precioSin,
    item.precioSicar,
    item.costoUnitario,
    item.costoUnitarioSicar,
    item.costoHistorico,
    item.costoPromedio,
    item.costo,
    item.costos?.precioSin,
    item.costos?.costoUnitario,
    item.sicar?.precioSin,
    item.sicar?.costoUnitario,
    item.traspaso?.precioSin,
    item.traspaso?.costoUnitario,
    pedido.costos?.[item.clave || '']?.precioSin,
    pedido.costos?.[item.clave || '']?.costoUnitario,
  ]);
}

function getItemLineCost(item = {}, pedido = {}) {
  const explicitLineCost = pickFirstNumber([
    item.importeSin,
    item.importeCostoSicar,
    item.importeCosto,
    item.subtotalCosto,
    item.costoTotal,
    item.totalCostoSicar,
    item.importe,
    item.costos?.importeSin,
    item.costos?.importeCosto,
    item.sicar?.importeSin,
    item.traspaso?.importeSin,
    pedido.costos?.[item.clave || '']?.importeSin,
    pedido.costos?.[item.clave || '']?.importeCosto,
  ]);

  if (explicitLineCost > 0) {
    return roundTo(explicitLineCost, 2);
  }

  const unitCost = getItemUnitCost(item, pedido);
  const quantityPreview = getRealQuantity(item);
  if (unitCost <= 0 || quantityPreview <= 0) {
    return 0;
  }

  return roundTo(unitCost * quantityPreview, 2);
}

function resolveBranchPayload(...candidates) {
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeText(candidate);
    if (!normalizedCandidate) continue;

    const branch = BRANCH_DEFINITIONS.find((item) => (
      item.aliases.some((alias) => normalizeText(alias) === normalizedCandidate)
      || normalizeText(item.branchId) === normalizedCandidate
      || normalizeText(item.branchName) === normalizedCandidate
      || normalizeText(item.branchCode) === normalizedCandidate
    ));

    if (branch) {
      return {
        branchId: branch.branchId,
        branchCode: branch.branchCode,
        branchName: branch.branchName,
        documentSeries: branch.documentSeries,
      };
    }
  }

  return null;
}

function buildMirrorId(pedidoFirebaseId = '', reference = '') {
  const firebaseId = String(pedidoFirebaseId || '').trim();
  if (firebaseId) {
    return `pedidosinternos_${firebaseId}`;
  }

  const fallbackReference = String(reference || '').trim().replace(/[^A-Za-z0-9_-]+/gu, '_');
  return fallbackReference ? `pedidosinternos_${fallbackReference}` : '';
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`No pude leer ${url}. HTTP ${response.status}.`);
  }

  return response.json();
}

async function fetchPedido(databaseUrl, pedidoFirebaseId) {
  const url = `${String(databaseUrl || DEFAULT_DATABASE_URL).replace(/\/+$/u, '')}/pedidos_internos/${pedidoFirebaseId}.json`;
  return fetchJson(url);
}

function buildAccountingItems(pedido) {
  return getPedidoItems(pedido)
    .map((item) => {
      const requestedQuantity = getRequestedQuantity(item);
      const realQuantity = getRealQuantity(item);
      const quantityPreview = realQuantity > 0 ? realQuantity : requestedQuantity;
      const unitCost = getItemUnitCost(item, pedido);
      const lineCost = getItemLineCost(item, pedido);

      if (!item?.clave && !item?.producto && !item?.descripcion && quantityPreview <= 0) {
        return null;
      }

      return {
        clave: String(item.clave || '').trim(),
        descripcion: String(item.producto || item.descripcion || item.sicar?.descripcion || '').trim(),
        producto: String(item.producto || item.descripcion || item.sicar?.descripcion || '').trim(),
        cantidad: requestedQuantity,
        pesoReal: realQuantity,
        quantityPreview,
        quantityApplied: quantityPreview,
        unidad: String(item.unidad || item.sicar?.unidad || 'LB').trim().toUpperCase(),
        unidadSicar: String(item.sicar?.unidad || item.unidad || 'LB').trim().toUpperCase(),
        nota: String(item.nota || '').trim(),
        resolvedClave: String(item.sicar?.clave || item.clave || '').trim(),
        resolvedDescription: String(item.sicar?.descripcion || item.producto || item.descripcion || '').trim(),
        costoUnitarioSicar: unitCost > 0 ? roundTo(unitCost, 2) : 0,
        totalCostoSicar: lineCost > 0 ? roundTo(lineCost, 2) : 0,
        precioSin: unitCost > 0 ? roundTo(unitCost, 2) : 0,
        importeSin: lineCost > 0 ? roundTo(lineCost, 2) : 0,
      };
    })
    .filter(Boolean);
}

function resolveTopLevelAmount(pedido, items, totalArg) {
  const explicitTotal = roundTo(totalArg, 2);
  if (explicitTotal > 0) {
    return explicitTotal;
  }

  const linesTotal = roundTo(
    items.reduce((sum, item) => sum + safeNumber(item.totalCostoSicar || item.importeSin), 0),
    2,
  );
  if (linesTotal > 0) {
    return linesTotal;
  }

  return roundTo(pickFirstNumber([
    pedido.totalCostoSicar,
    pedido.montoMonetarioSicar,
    pedido.totalCost,
    pedido.amount,
    pedido.monto,
  ]), 2);
}

function buildTransferPayload({ pedido, pedidoFirebaseId, reference, total, args }) {
  const items = buildAccountingItems(pedido);
  const amount = resolveTopLevelAmount(pedido, items, total);
  const date = String(
    pedido.fechaEntrega
    || pedido.fechaPedido
    || args.fecha
    || new Date().toISOString().slice(0, 10),
  ).slice(0, 10);
  const fromBranch = resolveBranchPayload(
    args.aliasOri,
    args.traspasoOrigenReal,
    pedido.sucursalDestino,
    pedido.sucursalCreadora,
  );
  const toBranch = resolveBranchPayload(
    args.aliasDes,
    args.traspasoDestinoReal,
    pedido.sucursalOrigen,
  );

  if (!fromBranch || !toBranch) {
    throw new Error('No pude resolver sucursal origen/destino para contabilidad.');
  }

  if (fromBranch.branchId === toBranch.branchId) {
    throw new Error('El traspaso contable no puede tener la misma sucursal origen y destino.');
  }

  const totalWeightRequested = roundTo(
    items.reduce((sum, item) => sum + safeNumber(item.cantidad), 0),
    4,
  );
  const totalWeightResolved = roundTo(
    items.reduce((sum, item) => sum + safeNumber(item.quantityApplied || item.pesoReal || item.quantityPreview), 0),
    4,
  );
  const mirrorId = buildMirrorId(pedidoFirebaseId, reference);
  const processedAtIso = new Date().toISOString();

  if (!mirrorId) {
    throw new Error('No pude construir el mirrorId del traspaso contable.');
  }

  return {
    mirrorId,
    date,
    month: date.slice(0, 7),
    reference,
    description: String(pedido.notaGeneral || '').trim() || `Pedido ${reference}`,
    deliveryName: String(pedido.enviadoCon || pedido.preparadoPor || '').trim(),
    receivedName: String(pedido.recibidoPor || '').trim(),
    amount,
    subtotal: amount,
    totalWeightRequested,
    totalWeightResolved,
    totalLineItems: items.length,
    items,
    category: DEFAULT_CATEGORY,
    categoria: DEFAULT_CATEGORY,
    subcategory: DEFAULT_SUBCATEGORY,
    subcategoria: DEFAULT_SUBCATEGORY,
    expenseCategory: DEFAULT_CATEGORY,
    expenseSubcategory: DEFAULT_SUBCATEGORY,
    fromBranchId: fromBranch.branchId,
    fromBranchCode: fromBranch.branchCode,
    fromBranchName: fromBranch.branchName,
    fromDocumentSeries: fromBranch.documentSeries,
    toBranchId: toBranch.branchId,
    toBranchCode: toBranch.branchCode,
    toBranchName: toBranch.branchName,
    toDocumentSeries: toBranch.documentSeries,
    source: 'pedidosinternos',
    sourceType: pedido?.tipoPedido === 'VACUNA' ? 'pedidos_internos_vacuna_sicar' : 'pedidos_internos_sicar',
    status: 'activo',
    operationalStatus: 'completed',
    integrationStatus: 'completed',
    accountingStatus: 'completed',
    sourceOrderId: reference,
    sourceFirebaseId: pedidoFirebaseId,
    sourceProjectId: args.sourceProjectId || DEFAULT_SOURCE_PROJECT_ID,
    pedidoSucursalOrigen: String(pedido.sucursalOrigen || '').trim(),
    pedidoSucursalDestino: String(pedido.sucursalDestino || '').trim(),
    pedidoTipo: String(pedido.tipoPedido || 'TRASPASO').trim(),
    pedidoEstado: String(args.pedidoEstado || pedido.estado || '').trim(),
    createdBy: 'integrador-sicar',
    createdByEmail: 'integrador-sicar@local',
    sicarOrigin: {
      status: 'completed',
      folio: safeNumber(args.folioSicar) || null,
      traId: safeNumber(args.traId) || null,
      total: amount,
      alias: String(args.aliasOri || '').trim(),
      processedAt: processedAtIso,
    },
    sicarDestination: {
      status: 'completed',
      alias: String(args.aliasDes || '').trim(),
      processedAt: processedAtIso,
      note: 'Costo contable aplicado desde integrador SICAR.',
    },
    sicar: {
      status: String(args.status || 'salida_ok').trim(),
      folioSicar: safeNumber(args.folioSicar) || null,
      traId: safeNumber(args.traId) || null,
      aliasOri: String(args.aliasOri || '').trim(),
      aliasDes: String(args.aliasDes || '').trim(),
      total: amount,
      fecha: String(args.fecha || date).trim(),
      numeroOrden: reference,
      pedidoEstado: String(args.pedidoEstado || pedido.estado || '').trim(),
      actualizadoEn: processedAtIso,
    },
  };
}

function initFirebase() {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || undefined;
  return admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId,
  });
}

async function upsertTransfer(payload) {
  const firestore = admin.firestore();
  const docRef = firestore.collection(TRANSFER_COLLECTION).doc(payload.mirrorId);
  const snapshot = await docRef.get();
  const docPayload = {
    ...payload,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (!snapshot.exists) {
    docPayload.createdAt = admin.firestore.FieldValue.serverTimestamp();
  }

  await docRef.set(docPayload, { merge: true });
  return {
    created: !snapshot.exists,
    mirrorId: docRef.id,
  };
}

async function main() {
  applyLocalEnv();

  const args = parseArgs(process.argv.slice(2));
  const pedidoFirebaseId = String(args.pedidoFirebaseId || '').trim();
  const databaseUrl = String(args.databaseUrl || DEFAULT_DATABASE_URL).trim();
  const status = String(args.status || '').trim().toLowerCase();
  const reference = String(args.numeroOrden || '').trim();

  if (!pedidoFirebaseId) {
    throw new Error('Debes indicar --pedidoFirebaseId.');
  }

  if (!reference) {
    throw new Error('Debes indicar --numeroOrden.');
  }

  if (status && status !== 'salida_ok') {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      status: 'skipped',
      reason: `status_${status}`,
      mirrorId: buildMirrorId(pedidoFirebaseId, reference),
    })}\n`);
    return;
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS no esta configurado para sincronizar contabilidad.');
  }

  if (!fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    throw new Error(`No existe la credencial admin: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
  }

  initFirebase();

  const pedido = await fetchPedido(databaseUrl, pedidoFirebaseId);
  if (!pedido) {
    throw new Error(`No se encontro el pedido ${pedidoFirebaseId} en Firebase.`);
  }

  const payload = buildTransferPayload({
    pedido,
    pedidoFirebaseId,
    reference,
    total: args.total,
    args,
  });

  if (args.preview) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      status: 'preview',
      mirrorId: payload.mirrorId,
      amount: payload.amount,
      itemCount: payload.items.length,
      payload,
    })}\n`);
    return;
  }

  const result = await upsertTransfer(payload);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    status: 'synced',
    created: result.created,
    mirrorId: result.mirrorId,
    amount: payload.amount,
    itemCount: payload.items.length,
    fromBranchId: payload.fromBranchId,
    toBranchId: payload.toBranchId,
  })}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message || String(error)}\n`);
    process.exitCode = 1;
  });
}
