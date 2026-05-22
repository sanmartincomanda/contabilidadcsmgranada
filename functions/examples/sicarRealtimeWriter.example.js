const admin = require('firebase-admin');
const { createHash } = require('node:crypto');

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();
const root = db.collection('integraciones_privadas').doc('sicar');

function normalizeDate(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().substring(0, 10);
  return String(value).substring(0, 10);
}

function buildRawId(type, sourceRecordId) {
  const safeId = String(sourceRecordId || '').trim();
  if (safeId) {
    return `rt_${type}_${safeId}`;
  }

  return `rt_${type}_${createHash('sha1').update(`${type}:${Date.now()}`).digest('hex').slice(0, 20)}`;
}

async function upsertCompraRaw({
  sourceRecordId,
  date,
  amount,
  supplier,
  invoiceNumber = '',
  paymentMethod = 'Otro',
  description = '',
  rawPayload = {},
  isCancelled = false,
  cancelReason = '',
}) {
  const normalizedDate = normalizeDate(date);
  const rawId = buildRawId('compra', sourceRecordId);

  await root.collection('compras_raw').doc(rawId).set({
    sourceSystem: 'SICAR',
    sourceType: 'compra',
    sourceMode: 'push',
    sourceRecordId: String(sourceRecordId),
    status: 'pending',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    rawPayload,
    normalized: {
      sourceRecordId: String(sourceRecordId),
      date: normalizedDate,
      month: normalizedDate.substring(0, 7),
      amount: Number(amount) || 0,
      supplier: String(supplier || '').trim().toUpperCase(),
      invoiceNumber: String(invoiceNumber || '').trim().toUpperCase(),
      paymentMethod,
      description: String(description || '').trim().toUpperCase(),
      isCancelled,
      cancelReason: String(cancelReason || '').trim().toUpperCase(),
    },
  }, { merge: true });
}

async function upsertVentaRaw({
  sourceRecordId,
  date,
  amount,
  description = 'VENTA SICAR',
  reference = '',
  rawPayload = {},
  isCancelled = false,
  cancelReason = '',
}) {
  const normalizedDate = normalizeDate(date);
  const rawId = buildRawId('venta', sourceRecordId);

  await root.collection('ventas_raw').doc(rawId).set({
    sourceSystem: 'SICAR',
    sourceType: 'venta',
    sourceMode: 'push',
    sourceRecordId: String(sourceRecordId),
    status: 'pending',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    rawPayload,
    normalized: {
      sourceRecordId: String(sourceRecordId),
      date: normalizedDate,
      month: normalizedDate.substring(0, 7),
      amount: Number(amount) || 0,
      description: String(description || 'VENTA SICAR').trim().toUpperCase(),
      reference: String(reference || '').trim().toUpperCase(),
      isCancelled,
      cancelReason: String(cancelReason || '').trim().toUpperCase(),
    },
  }, { merge: true });
}

async function demo() {
  await upsertCompraRaw({
    sourceRecordId: 2791,
    date: '2026-05-14',
    amount: 12345.67,
    supplier: 'PROVEEDOR DEMO',
    invoiceNumber: 'FAC-001',
    paymentMethod: 'Efectivo',
    description: 'COMPRA DE PRUEBA',
    rawPayload: {
      com_id: 2791,
      fecha: '2026-05-14 13:00:00',
      total: '12345.67',
      proveedor: 'Proveedor Demo',
      paymentMethods: 'Efectivo',
    },
  });

  await upsertVentaRaw({
    sourceRecordId: 9901,
    date: '2026-05-14',
    amount: 4500,
    description: 'VENTA DE PRUEBA',
    reference: 'TICKET-9901',
    rawPayload: {
      ven_id: 9901,
      fecha: '2026-05-14 13:05:00',
      total: '4500.00',
      ticket: 'TICKET-9901',
    },
  });
}

demo().catch((error) => {
  console.error(error);
  process.exit(1);
});
