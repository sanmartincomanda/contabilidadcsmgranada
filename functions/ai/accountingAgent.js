const { createHash, randomUUID } = require('node:crypto');
const { OpenAI } = require('openai');
const { registerAccountingDraft } = require('./accountingRegistration');

const AGENT_COLLECTIONS = Object.freeze({
  inbox: 'whatsapp_inbox',
  drafts: 'agente_ia_borradores',
  users: 'agente_ia_usuarios',
  rules: 'agente_ia_reglas',
  audit: 'agente_ia_auditoria',
  hashes: 'agente_ia_hashes',
  sessions: 'agente_ia_sesiones',
});

const AGENT_STATUSES = Object.freeze({
  RECEIVED: 'RECEIVED',
  PROCESSING: 'PROCESSING',
  NEEDS_INFORMATION: 'NEEDS_INFORMATION',
  READY_FOR_CONFIRMATION: 'READY_FOR_CONFIRMATION',
  POSSIBLE_DUPLICATE: 'POSSIBLE_DUPLICATE',
  CONFIRMED: 'CONFIRMED',
  REGISTERED: 'REGISTERED',
  REJECTED: 'REJECTED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  ERROR: 'ERROR',
});

const MAX_MEDIA_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const PAYMENT_METHODS = [
  'EFECTIVO',
  'TRANSFERENCIA',
  'TARJETA BLACK MASTERCARD ***4660',
  'TARJETA AMEX BLACK',
  'TARJETA AMEX PRICESMART',
  'TARJETA LA COLONIA BAC',
  'TARJETA UNO BANPRO',
  'TARJETA BLACK BANPRO',
  'CREDITO',
];

const EXPENSE_CATEGORY_TREE = [
  {
    category: 'Costos de venta / compras',
    subcategories: [
      'Compra de carne res',
      'Compra de cerdo',
      'Compra de pollo',
      'Compra de embutidos',
      'Compra de mariscos',
      'Compra de productos procesados',
      'Fletes sobre compras',
      'Merma / ajuste de inventario',
      'Material de empaque directo',
      'Hielo / conservacion directa',
      'Otros costos de producto',
      'Descuentos sobre compras',
    ],
  },
  {
    category: 'Gastos de Nomina',
    subcategories: [
      'Sueldos y salarios', 'Horas extras', 'Bonificaciones', 'Aguinaldo', 'Vacaciones',
      'Indemnizacion', 'INSS patronal', 'INATEC', 'Alimentacion de personal', 'Uniformes',
      'Capacitacion',
    ],
  },
  {
    category: 'Gastos del Local',
    subcategories: [
      'Alquiler', 'Energia electrica', 'Agua potable', 'Internet y telefonia',
      'Servicios publicos varios', 'Mantenimiento del local', 'Reparaciones menores',
      'Seguridad', 'Fumigacion', 'Limpieza', 'Recoleccion de basura',
    ],
  },
  {
    category: 'Equipos y Operacion de Carniceria',
    subcategories: [
      'Mantenimiento general de equipos', 'Mantenimiento de cuartos frios',
      'Mantenimiento de vitrinas refrigeradas', 'Mantenimiento de sierras y molinos',
      'Repuestos de equipos', 'Gas refrigerante', 'Herramientas de corte',
      'Cuchillos y afilado', 'Balanzas y calibracion', 'Equipos menores',
    ],
  },
  {
    category: 'Gastos de venta - Operaciones',
    subcategories: [
      'Bolsas y empaques', 'Etiquetas', 'Publicidad', 'Promociones', 'Comisiones de venta',
      'Delivery / reparto', 'Combustible de reparto', 'Mantenimiento de vehiculo',
      'Parqueo / peajes', 'Atencion al cliente', 'Otros gastos de venta',
    ],
  },
  {
    category: 'Gastos administrativos',
    subcategories: [
      'Papeleria y utiles', 'Servicios contables', 'Servicios legales', 'Software y sistemas',
      'Suscripciones', 'Mensajeria', 'Gastos de oficina', 'Caja chica', 'Diferencias de caja',
    ],
  },
  {
    category: 'Impuestos, permisos y tasas',
    subcategories: [
      'Matricula municipal', 'Impuesto municipal sobre ingresos', 'Permisos MINSA',
      'Permisos alcaldia', 'Licencias y registros', 'Timbres fiscales', 'Multas y recargos',
      'Otros impuestos y tasas',
    ],
  },
  {
    category: 'Gastos financieros',
    subcategories: [
      'Comisiones bancarias', 'Cargos POS', 'Intereses bancarios',
      'Comisiones por transferencias', 'Diferencial cambiario', 'Otros gastos financieros',
    ],
  },
  {
    category: 'Otros Gastos',
    subcategories: [
      'Donaciones', 'Gastos no deducibles', 'Perdidas por robo', 'Perdidas por deterioro',
      'Ajustes varios', 'Gastos extraordinarios', 'Otros gastos',
    ],
  },
];

const CATEGORY_OPTIONS = EXPENSE_CATEGORY_TREE.flatMap((group) => (
  group.subcategories.map((subcategory) => ({ category: group.category, subcategory }))
));

const SUPPLIER_RULES = [
  { includes: 'INDUSTRIAL COMERCIAL SAN MARTIN', type: 'compra', category: 'Costos de venta / compras', subcategory: 'Compra de carne res' },
  { includes: 'CARGILL', type: 'compra', category: 'Costos de venta / compras', subcategory: 'Compra de pollo' },
  { includes: 'MATADERO CACIQUE', type: 'compra', category: 'Costos de venta / compras', subcategory: 'Compra de cerdo' },
  { includes: 'DELMOR', type: 'compra', category: 'Costos de venta / compras', subcategory: 'Compra de embutidos' },
  { includes: 'LOS ARTESANOS', type: 'compra', category: 'Costos de venta / compras', subcategory: 'Compra de embutidos' },
  { includes: 'SIGMA ALIMENTOS', type: 'compra', category: 'Costos de venta / compras', subcategory: 'Compra de embutidos' },
];

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'accion', 'tipoRegistro', 'branchId', 'fecha', 'vencimiento', 'providerId', 'providerCode',
    'proveedor', 'rucProveedor', 'numeroFactura', 'descripcion', 'categoria', 'subcategoria',
    'accountingAccountId', 'accountingAccountCode', 'metodoPago', 'referenciaPago', 'subtotal',
    'iva', 'total', 'retencionIr2', 'retencionMunicipal1', 'totalRetenciones', 'pagoNeto',
    'moneda', 'tasaCambio', 'soportes', 'confianza', 'alertas', 'datosFaltantes', 'pregunta',
  ],
  properties: {
    accion: { type: 'string', enum: ['registrar', 'preguntar', 'duplicado'] },
    tipoRegistro: { anyOf: [{ type: 'string', enum: ['gasto', 'compra'] }, { type: 'null' }] },
    branchId: { anyOf: [{ type: 'string', enum: ['granada', 'nindiri'] }, { type: 'null' }] },
    fecha: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    vencimiento: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    providerId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    providerCode: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    proveedor: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    rucProveedor: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    numeroFactura: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    descripcion: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    categoria: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    subcategoria: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    accountingAccountId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    accountingAccountCode: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    metodoPago: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    referenciaPago: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    subtotal: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    iva: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    total: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    retencionIr2: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    retencionMunicipal1: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    totalRetenciones: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    pagoNeto: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    moneda: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    tasaCambio: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    soportes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'invoiceNumber', 'provider', 'ruc', 'amount'],
        properties: {
          type: { type: 'string', enum: ['invoice', 'retentionIr2', 'retentionMunicipal1', 'other'] },
          invoiceNumber: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          provider: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          ruc: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          amount: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        },
      },
    },
    confianza: { type: 'number', minimum: 0, maximum: 1 },
    alertas: { type: 'array', items: { type: 'string' } },
    datosFaltantes: { type: 'array', items: { type: 'string' } },
    pregunta: { type: 'string' },
  },
};

const normalizeText = (value = '') => String(value || '').trim();
const normalizeKey = (value = '') => normalizeText(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');
const normalizePhone = (value = '') => String(value || '').replace(/\D+/g, '');
const money = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
};
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const isCredit = (value) => normalizeKey(value) === 'CREDITO';
const isTransfer = (value) => normalizeKey(value).includes('TRANSFERENCIA');

function canonicalPaymentMethod(value = '') {
  const key = normalizeKey(value);
  if (!key) return '';
  const exact = PAYMENT_METHODS.find((method) => normalizeKey(method) === key);
  if (exact) return exact;
  if (key.includes('BLACK MASTERCARD') && key.includes('4660')) return 'TARJETA BLACK MASTERCARD ***4660';
  if (key.includes('AMEX') && key.includes('PRICESMART')) return 'TARJETA AMEX PRICESMART';
  if (key.includes('AMEX') && key.includes('BLACK')) return 'TARJETA AMEX BLACK';
  if (key.includes('LA COLONIA') && key.includes('BAC')) return 'TARJETA LA COLONIA BAC';
  if (key.includes('UNO') && key.includes('BANPRO')) return 'TARJETA UNO BANPRO';
  if (key.includes('BLACK') && key.includes('BANPRO')) return 'TARJETA BLACK BANPRO';
  if (key.includes('TRANSFERENCIA')) return 'TRANSFERENCIA';
  if (key === 'EFECTIVO' || key.includes('PAGADO EN EFECTIVO')) return 'EFECTIVO';
  if (key === 'CREDITO' || key.includes('PAGADO A CREDITO')) return 'CREDITO';
  return '';
}

function canonicalCurrency(value = '') {
  const key = normalizeKey(value);
  if (!key) return '';
  if (['NIO', 'CORDOBA', 'CORDOBAS', 'CORDOBA NICARAGUENSE', 'CORDOBAS NICARAGUENSES', 'C'].includes(key)) return 'NIO';
  if (['USD', 'DOLAR', 'DOLARES', 'DOLAR AMERICANO', 'DOLARES AMERICANOS'].includes(key)) return 'USD';
  return key;
}

function extractDeterministicConversationUpdates(text = '', draft = {}) {
  const raw = normalizeText(text);
  const key = normalizeKey(raw);
  const updates = {};
  if (/\bGRANADA\b/.test(key)) updates.branchId = 'granada';
  if (/\bNINDIRI\b/.test(key)) updates.branchId = 'nindiri';

  const providerMatch = raw.match(/(?:PROVEEDOR|SUPLIDOR)(?:\s+ES|\s*:)?\s+([^\r\n]+)/i);
  if (providerMatch?.[1]) updates.proveedor = providerMatch[1].trim();

  const paymentMethod = canonicalPaymentMethod(raw);
  if (paymentMethod) updates.metodoPago = paymentMethod;
  if (key === 'CONTADO' && canonicalPaymentMethod(draft.metodoPago)) delete updates.metodoPago;

  const referenceExplicitlyBlank = /\bSIN REFERENCIA\b/.test(key)
    || (/\bREFERENCIA\b/.test(key) && /\b(?:EN BLANCO|VACIA|VACIO|NO TIENE|SIN DATO)\b/.test(key));
  if (referenceExplicitlyBlank) {
    updates.referenciaPago = '';
    updates.referenciaConfirmadaSinDato = true;
  }

  if (/\b(?:NIO|CORDOBA|CORDOBAS)\b/.test(key) || raw.includes('C$')) {
    updates.moneda = 'NIO';
    updates.tasaCambio = 1;
  } else if (/\b(?:USD|DOLAR|DOLARES)\b/.test(key)) {
    updates.moneda = 'USD';
    const rateMatch = raw.match(/(?:TASA(?:\s+DE\s+CAMBIO)?|TC)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
    if (rateMatch?.[1]) updates.tasaCambio = Number(rateMatch[1].replace(',', '.'));
  }
  return updates;
}

function sanitizeStorageSegment(value, fallback = 'sin_identificar') {
  return normalizeText(value || fallback)
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96) || fallback;
}

function extensionFromMime(mimeType = '', fileName = '') {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized === 'application/pdf') return 'pdf';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/jpeg') return 'jpg';
  const extension = String(fileName || '').split('.').pop();
  return extension && extension !== fileName ? extension.toLowerCase() : 'bin';
}

function storageDownloadUrl(bucketName, storagePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
}

async function fetchWhatsappJson(url, accessToken) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`WhatsApp API respondio ${response.status}: ${await response.text()}`);
  return response.json();
}

async function fetchWhatsappMediaBuffer({ media, accessToken, graphVersion }) {
  const metadata = await fetchWhatsappJson(`https://graph.facebook.com/${graphVersion}/${media.id}`, accessToken);
  const response = await fetch(metadata.url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`No se pudo descargar media WhatsApp ${response.status}: ${await response.text()}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const mimeType = metadata.mime_type || media.mimeType || 'application/octet-stream';
  if (!ALLOWED_MEDIA_TYPES.has(mimeType)) throw new Error(`Tipo de archivo no permitido: ${mimeType}`);
  if (buffer.length > MAX_MEDIA_SIZE_BYTES) throw new Error('El archivo supera el limite de 10 MB.');
  return { buffer, mimeType, sha256: createHash('sha256').update(buffer).digest('hex') };
}

async function storeOriginalMedia({ bucket, messageId, senderPhone, media, buffer, mimeType, sha256 }) {
  const extension = extensionFromMime(mimeType, media.fileName);
  const safePhone = sanitizeStorageSegment(senderPhone);
  const safeMessageId = sanitizeStorageSegment(messageId);
  const safeName = sanitizeStorageSegment(media.fileName || `${media.type}_${media.id}`, media.type || 'soporte');
  const storagePath = `whatsapp/inbox/${safePhone}/${safeMessageId}/original_${safeName}.${extension}`;
  const downloadToken = randomUUID();
  await bucket.file(storagePath).save(buffer, {
    resumable: false,
    metadata: {
      contentType: mimeType,
      cacheControl: 'private, max-age=3600',
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
        whatsappMediaId: media.id || '',
        whatsappMessageId: messageId,
        whatsappSenderPhone: senderPhone,
        sha256,
        immutableOriginal: 'true',
      },
    },
  });
  return {
    type: 'invoice',
    source: 'whatsapp',
    sourceCollection: AGENT_COLLECTIONS.inbox,
    sourceDocId: messageId,
    url: storageDownloadUrl(bucket.name, storagePath, downloadToken),
    path: storagePath,
    mimeType,
    contentType: mimeType,
    fileName: media.fileName || `soporte.${extension}`,
    size: buffer.length,
    mediaId: media.id || '',
    sha256,
  };
}

async function loadCatalogContext(firestore) {
  const [providersSnap, chartSnap, rulesSnap] = await Promise.all([
    firestore.collection('proveedores').get(),
    firestore.collection('configuracion').doc('plan_cuentas_quickbooks').get(),
    firestore.collection(AGENT_COLLECTIONS.rules).where('active', '==', true).limit(100).get(),
  ]);
  const providers = providersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const accounts = (chartSnap.exists ? chartSnap.data().accounts || [] : [])
    .filter((account) => account && account.locked !== true && (account.number || account.code) && (account.name || account.nombre));
  const rules = rulesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  return { providers, accounts, rules, categories: CATEGORY_OPTIONS };
}

function findProvider(providers, analysis) {
  const requestedRuc = normalizeKey(analysis.rucProveedor);
  const requestedName = normalizeKey(analysis.proveedor);
  if (requestedRuc) {
    const byRuc = providers.find((provider) => normalizeKey(provider.ruc || provider.rfc || provider.taxId) === requestedRuc);
    if (byRuc) return byRuc;
  }
  if (!requestedName) return null;
  const exact = providers.find((provider) => normalizeKey(provider.nombre || provider.name || provider.supplier) === requestedName);
  if (exact) return exact;
  const fuzzyMatches = providers.filter((provider) => {
      const candidate = normalizeKey(provider.nombre || provider.name || provider.supplier);
      return candidate.length >= 5 && (candidate.includes(requestedName) || requestedName.includes(candidate));
    });
  return fuzzyMatches.length === 1 ? fuzzyMatches[0] : null;
}

function findAccount(accounts, analysis) {
  const requested = normalizeKey(analysis.accountingAccountId || analysis.accountingAccountCode);
  const type = analysis.tipoRegistro;
  const compatible = accounts.filter((account) => {
    const accountType = normalizeKey(account.type || account.tipo);
    if (type === 'compra') return ['ACTIVOS CORRIENTES', 'COSTO DE LAS VENTAS', 'GASTOS'].includes(accountType);
    return ['GASTOS', 'OTROS GASTOS', 'COSTO DE LAS VENTAS'].includes(accountType);
  });
  if (type === 'compra') {
    return compatible.find((account) => normalizeKey(account.number || account.code) === '11060') || null;
  }
  if (!requested) {
    return compatible.find((account) => normalizeKey(account.number || account.code) === '5') || null;
  }
  return compatible.find((account) => [account.id, account.number, account.code, account.name]
    .some((value) => normalizeKey(value) === requested)) || null;
}

function applyDeterministicRules(analysis, catalog) {
  const next = { ...analysis };
  const supplierKey = normalizeKey(next.proveedor);
  const configuredRules = [...SUPPLIER_RULES, ...(catalog.rules || []).map((rule) => ({
    includes: rule.providerMatch || rule.supplierIncludes || rule.proveedor || '',
    type: rule.recordType || rule.tipoRegistro,
    category: rule.category || rule.categoria,
    subcategory: rule.subcategory || rule.subcategoria,
  }))];
  const supplierRule = configuredRules.find((rule) => normalizeKey(rule.includes) && supplierKey.includes(normalizeKey(rule.includes)));
  if (supplierRule) {
    next.tipoRegistro = supplierRule.type || next.tipoRegistro;
    next.categoria = supplierRule.category || next.categoria;
    next.subcategoria = supplierRule.subcategory || next.subcategoria;
  }
  const provider = findProvider(catalog.providers, next);
  if (provider) {
    next.providerId = provider.id;
    next.providerCode = provider.code || provider.codigo || '';
    next.proveedor = provider.nombre || provider.name || next.proveedor;
    next.rucProveedor = provider.ruc || provider.rfc || next.rucProveedor || '';
  } else {
    next.providerId = '';
    next.providerCode = '';
  }
  const category = CATEGORY_OPTIONS.find((option) => (
    normalizeKey(option.category) === normalizeKey(next.categoria)
    && normalizeKey(option.subcategory) === normalizeKey(next.subcategoria)
  ));
  if (category) {
    next.categoria = category.category;
    next.subcategoria = category.subcategory;
  } else {
    next.categoria = '';
    next.subcategoria = '';
  }
  const account = findAccount(catalog.accounts, next);
  if (account) {
    next.accountingAccountId = account.id || account.number || account.code;
    next.accountingAccountCode = account.number || account.code || '';
    next.accountingAccountName = account.name || account.nombre || '';
  } else {
    next.accountingAccountId = '';
    next.accountingAccountCode = '';
    next.accountingAccountName = '';
  }
  next.numeroFactura = normalizeText(next.numeroFactura);
  next.metodoPago = canonicalPaymentMethod(next.metodoPago);
  next.moneda = canonicalCurrency(next.moneda) || 'NIO';
  if (next.moneda === 'NIO') next.tasaCambio = 1;
  next.subtotal = money(next.subtotal);
  next.iva = money(next.iva);
  next.total = money(next.total);
  if (next.iva === null && next.subtotal !== null && next.total !== null
    && Math.abs(next.subtotal - next.total) <= 0.02) {
    next.iva = 0;
  }
  next.retencionIr2 = money(next.retencionIr2) ?? 0;
  next.retencionMunicipal1 = money(next.retencionMunicipal1) ?? 0;
  next.totalRetenciones = money(next.retencionIr2 + next.retencionMunicipal1);
  next.pagoNeto = next.total === null ? null : money(next.total - next.totalRetenciones);
  return next;
}

async function findDuplicateCandidates(firestore, analysis, supportHash, messageId) {
  const candidates = [];
  if (supportHash) {
    const hashSnap = await firestore.collection(AGENT_COLLECTIONS.hashes).doc(supportHash).get();
    if (hashSnap.exists && hashSnap.data().messageId !== messageId) {
      candidates.push({ type: 'support_hash', id: hashSnap.data().messageId, collection: AGENT_COLLECTIONS.inbox });
    }
  }
  if (!analysis.numeroFactura) return candidates;
  const collections = ['gastos', 'compras'];
  for (const collectionName of collections) {
    const snapshots = await Promise.all([
      firestore.collection(collectionName).where('invoiceNumber', '==', analysis.numeroFactura).limit(10).get(),
      firestore.collection(collectionName).where('numeroFactura', '==', analysis.numeroFactura).limit(10).get(),
    ]);
    snapshots.forEach((snapshot) => snapshot.docs.forEach((doc) => {
      const value = doc.data();
      const sameBranch = normalizeKey(value.branchId || value.branch || value.sucursal) === normalizeKey(analysis.branchId);
      const sameProvider = normalizeKey(value.supplier || value.proveedor) === normalizeKey(analysis.proveedor);
      const sameDate = String(value.date || value.fecha || '') === String(analysis.fecha || '');
      const sameTotal = Math.abs(Number(value.total || value.amount || 0) - Number(analysis.total || 0)) <= 0.02;
      if (sameBranch && sameProvider && sameDate && sameTotal) {
        candidates.push({ type: 'accounting_record', id: doc.id, collection: collectionName });
      }
    }));
  }
  return [...new Map(candidates.map((candidate) => [`${candidate.collection}/${candidate.id}`, candidate])).values()];
}

function buildQuestion(missing) {
  const questions = {
    tipoRegistro: '¿Este documento corresponde a una compra de mercadería o a un gasto operativo?',
    branchId: '¿La transacción corresponde a Granada o Nindirí?',
    fecha: 'No pude confirmar la fecha impresa. ¿Cuál es la fecha de la factura?',
    providerId: 'No encontré este proveedor en el catálogo. ¿Deseas relacionarlo con uno existente o crear uno nuevo?',
    descripcion: '¿Cuál es el concepto o descripción contable de esta transacción?',
    categoria: 'No pude asignar una categoría fiscal válida. ¿Cuál corresponde?',
    accountingAccountId: 'No encontré una cuenta contable compatible. Selecciona una cuenta existente.',
    metodoPago: '¿Cómo se pagó? Responde “Efectivo”, “Transferencia”, “Crédito” o el nombre exacto de la tarjeta.',
    referenciaPago: '¿Cuál es la referencia de la transferencia?',
    subtotal: 'No pude confirmar el subtotal. ¿Cuál es el monto correcto?',
    iva: 'No pude confirmar el IVA. Indica el monto, aunque sea C$0.00.',
    total: 'No pude confirmar el total de la factura. ¿Cuál es el monto correcto?',
    vencimiento: 'La factura es de crédito. ¿Cuál es la fecha de vencimiento?',
    soporteRetencion: 'La factura indica retenciones. Adjunta las constancias correspondientes.',
    moneda: '¿En qué moneda está expresado el documento y cuál tasa de cambio debe utilizarse?',
  };
  return questions[missing[0]] || 'Necesito confirmar un dato antes de preparar el registro. Revisa el borrador en la aplicación.';
}

function validateAnalysis(analysis, {
  allowedBranches,
  hasPrimarySupport,
  hasRetentionSupport = false,
  duplicateCandidates,
}) {
  const missing = [];
  const alerts = [...new Set(Array.isArray(analysis.alertas) ? analysis.alertas.filter(Boolean) : [])];
  if (!['gasto', 'compra'].includes(analysis.tipoRegistro)) missing.push('tipoRegistro');
  if (!analysis.branchId || !allowedBranches.includes(analysis.branchId)) missing.push('branchId');
  if (!isDate(analysis.fecha)) missing.push('fecha');
  if (!analysis.providerId) missing.push('providerId');
  if (!analysis.descripcion) missing.push('descripcion');
  if (!analysis.categoria || !analysis.subcategoria) missing.push('categoria');
  if (!analysis.accountingAccountId) missing.push('accountingAccountId');
  if (!PAYMENT_METHODS.includes(analysis.metodoPago)) missing.push('metodoPago');
  if (isTransfer(analysis.metodoPago) && !analysis.referenciaPago && analysis.referenciaConfirmadaSinDato !== true) {
    missing.push('referenciaPago');
  }
  if (analysis.subtotal === null) missing.push('subtotal');
  if (analysis.iva === null) missing.push('iva');
  if (analysis.total === null) missing.push('total');
  if (isCredit(analysis.metodoPago) && !isDate(analysis.vencimiento)) missing.push('vencimiento');
  if (!hasPrimarySupport) missing.push('soportePrincipal');
  if ((analysis.retencionIr2 > 0 || analysis.retencionMunicipal1 > 0) && !hasRetentionSupport) {
    missing.push('soporteRetencion');
  }
  if (analysis.moneda && normalizeKey(analysis.moneda) !== 'NIO' && !analysis.tasaCambio) missing.push('moneda');
  if (analysis.subtotal !== null && analysis.iva !== null && analysis.total !== null) {
    const difference = Math.abs(money(analysis.subtotal + analysis.iva) - analysis.total);
    if (difference > 0.02) {
      alerts.push(`Los montos no cuadran: subtotal + IVA difiere del total por C$${difference.toFixed(2)}.`);
      missing.push('total');
    }
  }
  if (Number(analysis.confianza || 0) < 0.9) alerts.push('La confianza general es menor a 90%.');
  const uniqueMissing = [...new Set(missing)];
  let status = AGENT_STATUSES.READY_FOR_CONFIRMATION;
  let action = 'registrar';
  if (duplicateCandidates.length) {
    status = AGENT_STATUSES.POSSIBLE_DUPLICATE;
    action = 'duplicado';
    alerts.push('Se encontraron posibles registros duplicados.');
  } else if (uniqueMissing.length || Number(analysis.confianza || 0) < 0.9) {
    status = AGENT_STATUSES.NEEDS_INFORMATION;
    action = 'preguntar';
  }
  return {
    ...analysis,
    accion: action,
    alertas: alerts,
    datosFaltantes: uniqueMissing,
    pregunta: status === AGENT_STATUSES.NEEDS_INFORMATION ? buildQuestion(uniqueMissing) : '',
    status,
    duplicateCandidates,
  };
}

function buildAnalyzerPrompt({ text, catalog, allowedBranches, source }) {
  const categoryText = CATEGORY_OPTIONS.map((option) => `${option.category} / ${option.subcategory}`).join('\n');
  const accountText = catalog.accounts
    .filter((account) => account.locked !== true)
    .filter((account) => ['GASTOS', 'OTROS GASTOS', 'COSTO DE LAS VENTAS', 'ACTIVOS CORRIENTES'].includes(normalizeKey(account.type)))
    .slice(0, 180)
    .map((account) => `${account.number || account.code} | ${account.name || account.nombre} | ${account.type}`)
    .join('\n');
  return `Eres un lector fiscal para Carnes San Martín. Extrae solamente datos visibles o explícitos. No inventes información.

El resultado es un BORRADOR, nunca una autorización para contabilizar. Usa null para datos desconocidos y cadena vacía únicamente para factura realmente inexistente.

Reglas:
- COMPRA: mercancía revendible o costo directo de producto.
- GASTO: operación, nómina, local, administración, venta, impuestos o finanzas.
- La lista soportes describe únicamente el archivo adjunto actual. Una factura es type invoice aunque mencione retenciones.
- Una constancia independiente de retención usa tipoRegistro null y un único soporte retentionIr2 o retentionMunicipal1.
- Subtotal + IVA debe coincidir con total con tolerancia C$0.02.
- Retención IR usual: 2% del subtotal. Municipal usual: 1% del subtotal. No confirmes una retención solo por cálculo.
- Si falta método de pago, referencia, vencimiento o sucursal, usa accion preguntar.
- Si el documento usa C$ o córdobas, devuelve moneda NIO y tasaCambio 1.
- CONTADO describe la condición de venta y no significa EFECTIVO. No cambies una tarjeta por efectivo salvo que el usuario diga explícitamente efectivo.
- La tarjeta terminada en 4660 debe devolverse exactamente como TARJETA BLACK MASTERCARD ***4660.
- Sucursales permitidas para el remitente: ${allowedBranches.join(', ')}.
- Métodos exactos permitidos: ${PAYMENT_METHODS.join(' | ')}.
- Texto recibido: ${text || '(sin comentario)'}.
- Canal: ${source || 'whatsapp'}.

Categorías válidas:
${categoryText}

Cuentas contables candidatas existentes:
${accountText || '(sin catálogo disponible)'}

Devuelve exclusivamente el objeto estructurado solicitado.`;
}

async function analyzeWithOpenAI({ apiKey, model, buffer, mimeType, text, catalog, allowedBranches, source }) {
  if (!apiKey) throw new Error('OPENAI_API_KEY no está configurado.');
  const client = new OpenAI({ apiKey });
  const content = [{ type: 'input_text', text: buildAnalyzerPrompt({ text, catalog, allowedBranches, source }) }];
  if (buffer && mimeType === 'application/pdf') {
    content.push({
      type: 'input_file',
      filename: 'documento_fiscal.pdf',
      file_data: `data:${mimeType};base64,${buffer.toString('base64')}`,
    });
  } else if (buffer && mimeType?.startsWith('image/')) {
    content.push({ type: 'input_image', image_url: `data:${mimeType};base64,${buffer.toString('base64')}`, detail: 'high' });
  }
  const response = await client.responses.create({
    model,
    input: [{ role: 'user', content }],
    text: {
      format: {
        type: 'json_schema',
        name: 'accounting_document_analysis',
        strict: true,
        schema: ANALYSIS_SCHEMA,
      },
    },
  });
  if (!response.output_text) throw new Error('OpenAI no devolvió análisis estructurado.');
  return { analysis: JSON.parse(response.output_text), responseId: response.id, usage: response.usage || null };
}

async function writeAudit(firestore, FieldValue, payload) {
  await firestore.collection(AGENT_COLLECTIONS.audit).add({
    ...payload,
    createdAt: FieldValue.serverTimestamp(),
  });
}

const CONVERSATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'updates', 'question'],
  properties: {
    intent: { type: 'string', enum: ['correction', 'unknown'] },
    updates: {
      type: 'object',
      additionalProperties: false,
      required: [
        'tipoRegistro', 'branchId', 'fecha', 'vencimiento', 'proveedor', 'rucProveedor',
        'numeroFactura', 'descripcion', 'categoria', 'subcategoria', 'accountingAccountCode',
        'metodoPago', 'referenciaPago', 'subtotal', 'iva', 'total', 'retencionIr2',
        'retencionMunicipal1', 'moneda', 'tasaCambio',
      ],
      properties: {
        tipoRegistro: { anyOf: [{ type: 'string', enum: ['gasto', 'compra'] }, { type: 'null' }] },
        branchId: { anyOf: [{ type: 'string', enum: ['granada', 'nindiri'] }, { type: 'null' }] },
        fecha: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        vencimiento: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        proveedor: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        rucProveedor: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        numeroFactura: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        descripcion: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        categoria: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        subcategoria: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        accountingAccountCode: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        metodoPago: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        referenciaPago: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        subtotal: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        iva: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        total: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        retencionIr2: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        retencionMunicipal1: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        moneda: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        tasaCambio: { anyOf: [{ type: 'number' }, { type: 'null' }] },
      },
    },
    question: { type: 'string' },
  },
};

async function sendWhatsappText({ accessToken, graphVersion, phoneNumberId, to, text, logger }) {
  if (!accessToken || !phoneNumberId || !to || !text) return { skipped: true };
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: String(text).slice(0, 3900) },
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    logger?.error?.('No se pudo responder por WhatsApp', { status: response.status, body: body.slice(0, 500) });
    return { error: `WhatsApp no pudo enviar la respuesta (${response.status}).` };
  }
  return response.json();
}

function formatAccountingSummary(draft) {
  const format = (value) => Number(value || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const title = draft.status === AGENT_STATUSES.READY_FOR_CONFIRMATION
    ? 'Factura lista para registrar.'
    : 'Revisé el documento, pero todavía necesito información.';
  return [
    title,
    '',
    `Tipo: ${String(draft.tipoRegistro || 'pendiente').toUpperCase()}`,
    `Proveedor: ${draft.proveedor || 'Pendiente'}`,
    `Sucursal: ${draft.branchId || 'Pendiente'}`,
    `Fecha: ${draft.fecha || 'Pendiente'}`,
    `Factura: ${draft.numeroFactura || '(sin número)'}`,
    `Categoría: ${draft.categoria && draft.subcategoria ? `${draft.categoria} / ${draft.subcategoria}` : 'Pendiente'}`,
    `Subtotal: C$${format(draft.subtotal)}`,
    `IVA: C$${format(draft.iva)}`,
    `Total: C$${format(draft.total)}`,
    `Método: ${draft.metodoPago || 'Pendiente'}`,
    `Retenciones: C$${format(draft.totalRetenciones)}`,
    '',
    draft.status === AGENT_STATUSES.READY_FOR_CONFIRMATION
      ? 'Responde CONFIRMAR para registrarla o indica el dato que deseas corregir.'
      : (draft.pregunta || 'Abre Agente IA en la aplicación para completar los datos.'),
  ].join('\n');
}

async function analyzeConversationUpdate({ apiKey, model, text, draft, catalog }) {
  const client = new OpenAI({ apiKey });
  const categoryText = CATEGORY_OPTIONS.map((option) => `${option.category} / ${option.subcategory}`).join('\n');
  const accountText = catalog.accounts.slice(0, 180).map((account) => `${account.number || account.code} | ${account.name || account.nombre}`).join('\n');
  const response = await client.responses.create({
    model,
    input: [{
      role: 'user',
      content: [{
        type: 'input_text',
        text: `Interpreta la respuesta del usuario como una corrección a un borrador contable existente. No inventes datos. Usa null en todo campo que el usuario no haya corregido.\n\nBorrador actual:\n${JSON.stringify({
          tipoRegistro: draft.tipoRegistro, branchId: draft.branchId, fecha: draft.fecha, vencimiento: draft.vencimiento,
          proveedor: draft.proveedor, rucProveedor: draft.rucProveedor, numeroFactura: draft.numeroFactura,
          descripcion: draft.descripcion, categoria: draft.categoria, subcategoria: draft.subcategoria,
          accountingAccountCode: draft.accountingAccountCode, metodoPago: draft.metodoPago,
          referenciaPago: draft.referenciaPago, subtotal: draft.subtotal, iva: draft.iva, total: draft.total,
          retencionIr2: draft.retencionIr2, retencionMunicipal1: draft.retencionMunicipal1,
          moneda: draft.moneda, tasaCambio: draft.tasaCambio,
        })}\n\nRespuesta: ${text}\n\nMétodos permitidos: ${PAYMENT_METHODS.join(' | ')}\nCategorías exactas:\n${categoryText}\nCuentas existentes:\n${accountText}`,
      }],
    }],
    text: {
      format: {
        type: 'json_schema',
        name: 'accounting_conversation_update',
        strict: true,
        schema: CONVERSATION_SCHEMA,
      },
    },
  });
  if (!response.output_text) throw new Error('OpenAI no pudo interpretar la corrección.');
  return JSON.parse(response.output_text);
}

async function getConversationDraft({ firestore, phone, text }) {
  const sessionRef = firestore.collection(AGENT_COLLECTIONS.sessions).doc(phone);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) return { sessionRef, session: null, draft: null };
  const session = sessionSnap.data();
  const pendingIds = [...new Set((session.pendingDraftIds || []).filter(Boolean))].slice(-10);
  if (!pendingIds.length && session.activeDraftId) pendingIds.push(session.activeDraftId);
  const draftSnaps = pendingIds.length
    ? await firestore.getAll(...pendingIds.map((id) => firestore.collection(AGENT_COLLECTIONS.drafts).doc(id)))
    : [];
  const activeDrafts = draftSnaps
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
    .filter((draft) => ![AGENT_STATUSES.REGISTERED, AGENT_STATUSES.REJECTED].includes(draft.status));
  if (!activeDrafts.length) return { sessionRef, session, draft: null };
  if (activeDrafts.length === 1) return { sessionRef, session, draft: activeDrafts[0] };
  const replyKey = normalizeKey(text);
  const byInvoice = activeDrafts.filter((draft) => draft.numeroFactura && replyKey.includes(normalizeKey(draft.numeroFactura)));
  return { sessionRef, session, draft: byInvoice.length === 1 ? byInvoice[0] : null, ambiguousDrafts: byInvoice.length === 1 ? [] : activeDrafts };
}

async function handleConversationMessage({
  firestore, FieldValue, Timestamp, claimed, phone, authorizedUser, accessToken, graphVersion,
  openaiApiKey, openaiModel, logger,
}) {
  const conversation = await getConversationDraft({ firestore, phone, text: claimed.text });
  if (!conversation.session) return { handled: false };
  if (conversation.ambiguousDrafts?.length) {
    const options = conversation.ambiguousDrafts.map((draft) => `Factura ${draft.numeroFactura || '(sin número)'} - ${draft.proveedor || 'sin proveedor'}`).join('\n');
    await sendWhatsappText({
      accessToken, graphVersion, phoneNumberId: claimed.phoneNumberId, to: phone,
      text: `Tienes varios documentos pendientes. Indica el número de factura en tu respuesta:\n${options}`,
      logger,
    });
    return { handled: true, status: AGENT_STATUSES.NEEDS_INFORMATION };
  }
  const draft = conversation.draft;
  if (!draft) return { handled: false };
  const reply = normalizeKey(claimed.text);
  const confirmWords = new Set(['SI', 'CONFIRMAR', 'REGISTRAR', 'CORRECTO', 'DALE']);
  const rejectWords = new Set(['NO', 'CANCELAR', 'DESCARTAR', 'RECHAZAR']);
  const draftRef = firestore.collection(AGENT_COLLECTIONS.drafts).doc(draft.id);
  const originalInboxRef = firestore.collection(AGENT_COLLECTIONS.inbox).doc(draft.messageId || draft.id);
  if (confirmWords.has(reply)) {
    if ((draft.datosFaltantes || []).length || Number(draft.confianza || 0) < 0.9 || draft.status === AGENT_STATUSES.POSSIBLE_DUPLICATE) {
      await sendWhatsappText({
        accessToken, graphVersion, phoneNumberId: claimed.phoneNumberId, to: phone,
        text: `Todavía no puedo registrarla. ${draft.pregunta || `Falta corregir: ${(draft.datosFaltantes || []).join(', ')}`}`,
        logger,
      });
      return { handled: true, status: AGENT_STATUSES.NEEDS_INFORMATION, draftId: draft.id };
    }
    const result = await registerAccountingDraft({
      firestore, FieldValue, Timestamp, draft, actorEmail: authorizedUser.email || `whatsapp:${phone}`,
    });
    await Promise.all([
      draftRef.set({ status: AGENT_STATUSES.REGISTERED, accion: 'registrado', targetDocIds: result, registeredAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
      originalInboxRef.set({ status: AGENT_STATUSES.REGISTERED, targetDocIds: result, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
      conversation.sessionRef.set({ activeDraftId: '', pendingDraftIds: FieldValue.arrayRemove(draft.id), updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
    ]);
    await sendWhatsappText({
      accessToken, graphVersion, phoneNumberId: claimed.phoneNumberId, to: phone,
      text: `Registro completado correctamente.\nFactura: ${draft.numeroFactura || '(sin número)'}\nProveedor: ${draft.proveedor}\nTotal: C$${Number(draft.total || 0).toFixed(2)}\nID interno: ${result[draft.tipoRegistro === 'compra' ? 'compras' : 'gastos']}`,
      logger,
    });
    return { handled: true, status: AGENT_STATUSES.REGISTERED, draftId: draft.id, targetDocIds: result };
  }
  if (rejectWords.has(reply)) {
    await Promise.all([
      draftRef.set({ status: AGENT_STATUSES.REJECTED, accion: 'rechazado', rejectedBy: `whatsapp:${phone}`, rejectedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
      originalInboxRef.set({ status: AGENT_STATUSES.REJECTED, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
      conversation.sessionRef.set({ activeDraftId: '', pendingDraftIds: FieldValue.arrayRemove(draft.id), updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
    ]);
    await sendWhatsappText({ accessToken, graphVersion, phoneNumberId: claimed.phoneNumberId, to: phone, text: 'Borrador rechazado. No se registró ninguna transacción.', logger });
    return { handled: true, status: AGENT_STATUSES.REJECTED, draftId: draft.id };
  }
  if (reply.includes('ESTA MAL')) {
    await sendWhatsappText({ accessToken, graphVersion, phoneNumberId: claimed.phoneNumberId, to: phone, text: 'Indica el dato correcto. Ejemplo: “Es Granada”, “Fue crédito” o “El total es C$4,800”.', logger });
    return { handled: true, status: draft.status, draftId: draft.id };
  }
  const catalog = await loadCatalogContext(firestore);
  const parsed = await analyzeConversationUpdate({ apiKey: openaiApiKey, model: openaiModel, text: claimed.text, draft, catalog });
  const modelUpdates = Object.fromEntries(Object.entries(parsed.updates || {}).filter(([, value]) => value !== null));
  if (reply === 'CONTADO' && canonicalPaymentMethod(draft.metodoPago)) delete modelUpdates.metodoPago;
  const updates = {
    ...modelUpdates,
    ...extractDeterministicConversationUpdates(claimed.text, draft),
  };
  if (parsed.intent !== 'correction' || !Object.keys(updates).length) {
    await sendWhatsappText({ accessToken, graphVersion, phoneNumberId: claimed.phoneNumberId, to: phone, text: parsed.question || 'No pude identificar qué dato deseas cambiar. Escríbelo de forma directa.', logger });
    return { handled: true, status: draft.status, draftId: draft.id };
  }
  updates.confianza = Math.max(0.9, Number(draft.confianza || 0));
  const allowedBranches = Array.isArray(authorizedUser.branchAccess) && authorizedUser.branchAccess.length ? authorizedUser.branchAccess : ['granada'];
  const validated = validateManualDraftUpdate(draft, updates, catalog, allowedBranches);
  await Promise.all([
    draftRef.set({ ...validated, lastCorrection: { text: claimed.text, source: 'whatsapp', correctedAt: FieldValue.serverTimestamp() }, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
    originalInboxRef.set({ status: validated.status, analysisSummary: { proveedor: validated.proveedor || '', numeroFactura: validated.numeroFactura || '', branchId: validated.branchId || '', fecha: validated.fecha || '', total: validated.total, categoria: validated.categoria || '', subcategoria: validated.subcategoria || '', confianza: validated.confianza, pregunta: validated.pregunta || '' }, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
  ]);
  await sendWhatsappText({ accessToken, graphVersion, phoneNumberId: claimed.phoneNumberId, to: phone, text: formatAccountingSummary(validated), logger });
  return { handled: true, status: validated.status, draftId: draft.id };
}

async function attachRetentionSupport({
  firestore,
  FieldValue,
  phone,
  messageId,
  mediaRecord,
  detectedSupport,
  catalog,
  authorizedUser,
  accessToken,
  graphVersion,
  phoneNumberId,
  logger,
}) {
  if (!['retentionIr2', 'retentionMunicipal1'].includes(detectedSupport?.type)) return null;
  const sessionRef = firestore.collection(AGENT_COLLECTIONS.sessions).doc(phone);
  const sessionSnap = await sessionRef.get();
  const pendingIds = [...new Set((sessionSnap.data()?.pendingDraftIds || []).filter(Boolean))].slice(-10);
  if (!pendingIds.length) return null;
  const snapshots = await firestore.getAll(...pendingIds.map((id) => firestore.collection(AGENT_COLLECTIONS.drafts).doc(id)));
  const candidates = snapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
    .filter((draft) => ![AGENT_STATUSES.REGISTERED, AGENT_STATUSES.REJECTED].includes(draft.status));
  const invoiceKey = normalizeKey(detectedSupport.invoiceNumber);
  const rucKey = normalizeKey(detectedSupport.ruc);
  const providerKey = normalizeKey(detectedSupport.provider);
  const scored = candidates.map((draft) => {
    let score = 0;
    if (invoiceKey && normalizeKey(draft.numeroFactura) === invoiceKey) score += 6;
    if (rucKey && normalizeKey(draft.rucProveedor) === rucKey) score += 4;
    const draftProvider = normalizeKey(draft.proveedor);
    if (providerKey && draftProvider && (providerKey === draftProvider || providerKey.includes(draftProvider) || draftProvider.includes(providerKey))) score += 2;
    return { draft, score };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];
  const tied = best && scored.filter((candidate) => candidate.score === best.score);
  const target = candidates.length === 1
    ? candidates[0]
    : (best?.score >= 4 && tied.length === 1 ? best.draft : null);
  if (!target) {
    await firestore.collection(AGENT_COLLECTIONS.inbox).doc(messageId).set({
      status: AGENT_STATUSES.NEEDS_INFORMATION,
      targetType: 'retention_support',
      storedMedia: { ...mediaRecord, type: detectedSupport.type },
      error: 'No se pudo vincular la retención con una única factura pendiente.',
      updatedAt: FieldValue.serverTimestamp(),
      completedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await sendWhatsappText({
      accessToken,
      graphVersion,
      phoneNumberId,
      to: phone,
      text: `Detecté una constancia de retención, pero no puedo vincularla con seguridad. Responde indicando el número de factura. Pendientes: ${candidates.map((draft) => draft.numeroFactura || '(sin número)').join(', ')}`,
      logger,
    });
    return { linked: false, ambiguous: true, candidates: candidates.map((draft) => draft.id) };
  }
  const support = { ...mediaRecord, type: detectedSupport.type, linkedInvoiceNumber: target.numeroFactura || '' };
  const supportDescriptor = {
    type: detectedSupport.type,
    invoiceNumber: detectedSupport.invoiceNumber || target.numeroFactura || null,
    provider: detectedSupport.provider || target.proveedor || null,
    ruc: detectedSupport.ruc || target.rucProveedor || null,
    amount: money(detectedSupport.amount),
  };
  const existingDescriptors = Array.isArray(target.soportes) ? target.soportes : [];
  const updates = {
    soportes: [...existingDescriptors.filter((item) => item.type !== detectedSupport.type), supportDescriptor],
    confianza: Math.max(0.9, Number(target.confianza || 0)),
  };
  if (detectedSupport.type === 'retentionIr2' && money(detectedSupport.amount) !== null) updates.retencionIr2 = money(detectedSupport.amount);
  if (detectedSupport.type === 'retentionMunicipal1' && money(detectedSupport.amount) !== null) updates.retencionMunicipal1 = money(detectedSupport.amount);
  const allowedBranches = Array.isArray(authorizedUser.branchAccess) && authorizedUser.branchAccess.length
    ? authorizedUser.branchAccess
    : ['granada'];
  const validated = validateManualDraftUpdate(target, updates, catalog, allowedBranches, {
    hasRetentionSupport: true,
  });
  const targetRef = firestore.collection(AGENT_COLLECTIONS.drafts).doc(target.id);
  const targetInboxRef = firestore.collection(AGENT_COLLECTIONS.inbox).doc(target.messageId || target.id);
  await Promise.all([
    targetRef.set({
      ...validated,
      supportFiles: FieldValue.arrayUnion(support),
      updatedAt: FieldValue.serverTimestamp(),
      lastSupportLinkedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
    targetInboxRef.set({
      status: validated.status,
      analysisSummary: {
        proveedor: validated.proveedor || '', numeroFactura: validated.numeroFactura || '', branchId: validated.branchId || '',
        fecha: validated.fecha || '', total: validated.total, categoria: validated.categoria || '',
        subcategoria: validated.subcategoria || '', confianza: validated.confianza, pregunta: validated.pregunta || '',
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
    firestore.collection(AGENT_COLLECTIONS.inbox).doc(messageId).set({
      status: AGENT_STATUSES.REGISTERED,
      targetType: 'retention_support',
      linkedDraftId: target.id,
      linkedInvoiceNumber: target.numeroFactura || '',
      storedMedia: support,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ]);
  await writeAudit(firestore, FieldValue, {
    event: 'RETENTION_SUPPORT_LINKED',
    messageId,
    draftId: target.id,
    supportType: detectedSupport.type,
    amount: detectedSupport.amount,
  });
  await sendWhatsappText({
    accessToken,
    graphVersion,
    phoneNumberId,
    to: phone,
    text: `Constancia ${detectedSupport.type === 'retentionIr2' ? 'IR 2%' : 'municipal 1%'} vinculada a la factura ${target.numeroFactura || '(sin número)'}.\n\n${formatAccountingSummary(validated)}`,
    logger,
  });
  return { linked: true, draftId: target.id, status: validated.status };
}

async function claimMessage({ firestore, FieldValue, messageId }) {
  const ref = firestore.collection(AGENT_COLLECTIONS.inbox).doc(messageId);
  return firestore.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) return null;
    const value = snap.data();
    const status = String(value.status || '').toUpperCase();
    if (status !== AGENT_STATUSES.RECEIVED) return null;
    const attempts = Number(value.processing?.attempts || 0);
    transaction.set(ref, {
      status: AGENT_STATUSES.PROCESSING,
      processing: {
        attempts: attempts + 1,
        startedAt: FieldValue.serverTimestamp(),
        workerId: randomUUID(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { id: snap.id, ...value, attempts: attempts + 1 };
  });
}

async function processAccountingAgentInbox({
  firestore,
  FieldValue,
  bucket,
  messageId,
  Timestamp,
  accessToken,
  graphVersion,
  openaiApiKey,
  openaiModel,
  logger,
}) {
  const claimed = await claimMessage({ firestore, FieldValue, messageId });
  if (!claimed) return { skipped: true };
  const inboxRef = firestore.collection(AGENT_COLLECTIONS.inbox).doc(messageId);
  const phone = normalizePhone(claimed.senderPhone);
  try {
    const userSnap = await firestore.collection(AGENT_COLLECTIONS.users).doc(phone).get();
    if (!userSnap.exists || userSnap.data().active === false) {
      await inboxRef.set({
        status: AGENT_STATUSES.UNAUTHORIZED,
        error: 'Número de WhatsApp no autorizado.',
        updatedAt: FieldValue.serverTimestamp(),
        completedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      let replyResult = { skipped: true };
      try {
        replyResult = await sendWhatsappText({
          accessToken,
          graphVersion,
          phoneNumberId: claimed.phoneNumberId,
          to: phone,
          text: 'Este número todavía no está autorizado para usar MARTIN IA. Solicita al administrador que lo agregue en Ingresar Datos > Agente IA.',
          logger,
        });
      } catch (replyError) {
        logger?.warn?.('No se pudo informar por WhatsApp que el número no está autorizado', {
          messageId,
          error: replyError.message,
        });
      }
      await writeAudit(firestore, FieldValue, {
        event: 'UNAUTHORIZED_MESSAGE',
        messageId,
        senderPhone: phone,
        replySent: !replyResult?.skipped && !replyResult?.error,
      });
      return { status: AGENT_STATUSES.UNAUTHORIZED };
    }

    const authorizedUser = userSnap.data();
    const allowedBranches = Array.isArray(authorizedUser.branchAccess) && authorizedUser.branchAccess.length
      ? authorizedUser.branchAccess
      : ['granada'];
    if (!claimed.media?.id && normalizeText(claimed.text)) {
      const conversationResult = await handleConversationMessage({
        firestore,
        FieldValue,
        Timestamp,
        claimed,
        phone,
        authorizedUser,
        accessToken,
        graphVersion,
        openaiApiKey,
        openaiModel,
        logger,
      });
      if (conversationResult.handled) {
        await inboxRef.set({
          status: conversationResult.status,
          conversationDraftId: conversationResult.draftId || '',
          targetDocIds: conversationResult.targetDocIds || {},
          completedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return conversationResult;
      }
    }
    let mediaRecord = claimed.storedMedia || null;
    let mediaBuffer = null;
    let mimeType = mediaRecord?.mimeType || '';
    let supportHash = mediaRecord?.sha256 || '';
    if (claimed.media?.id && !mediaRecord?.path) {
      const downloaded = await fetchWhatsappMediaBuffer({
        media: claimed.media,
        accessToken,
        graphVersion,
      });
      mediaBuffer = downloaded.buffer;
      mimeType = downloaded.mimeType;
      supportHash = downloaded.sha256;
      mediaRecord = await storeOriginalMedia({
        bucket,
        messageId,
        senderPhone: phone,
        media: claimed.media,
        ...downloaded,
      });
      await inboxRef.set({ storedMedia: mediaRecord, supportHash, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    } else if (mediaRecord?.path) {
      [mediaBuffer] = await bucket.file(mediaRecord.path).download();
    }

    if (!mediaBuffer && !normalizeText(claimed.text)) {
      throw new Error('El mensaje no contiene texto, imagen o PDF compatible.');
    }

    const catalog = await loadCatalogContext(firestore);
    const openaiResult = await analyzeWithOpenAI({
      apiKey: openaiApiKey,
      model: openaiModel,
      buffer: mediaBuffer,
      mimeType,
      text: claimed.text,
      catalog,
      allowedBranches,
      source: claimed.source,
    });
    const detectedSupports = openaiResult.analysis.soportes || [];
    const detectedRetention = !openaiResult.analysis.tipoRegistro && detectedSupports.length === 1
      ? detectedSupports.find((support) => ['retentionIr2', 'retentionMunicipal1'].includes(support.type))
      : null;
    if (detectedRetention && mediaRecord) {
      const retentionResult = await attachRetentionSupport({
        firestore,
        FieldValue,
        phone,
        messageId,
        mediaRecord,
        detectedSupport: detectedRetention,
        catalog,
        authorizedUser,
        accessToken,
        graphVersion,
        phoneNumberId: claimed.phoneNumberId,
        logger,
      });
      if (retentionResult?.linked || retentionResult?.ambiguous) return retentionResult;
    }
    const deterministic = applyDeterministicRules(openaiResult.analysis, catalog);
    const duplicateCandidates = await findDuplicateCandidates(firestore, deterministic, supportHash, messageId);
    const validated = validateAnalysis(deterministic, {
      allowedBranches,
      hasPrimarySupport: Boolean(mediaRecord?.path) || claimed.allowWithoutSupport === true,
      hasRetentionSupport: false,
      duplicateCandidates,
    });
    const draftRef = firestore.collection(AGENT_COLLECTIONS.drafts).doc(messageId);
    const supportFiles = mediaRecord ? [{ ...mediaRecord, type: 'invoice' }] : [];
    const draftPayload = {
      ...validated,
      id: messageId,
      messageId,
      source: claimed.source || 'whatsapp',
      senderPhone: phone,
      senderName: claimed.senderName || authorizedUser.name || '',
      authorizedUserId: userSnap.id,
      supportHash,
      supportFiles,
      fotoFacturaUrl: mediaRecord?.url || '',
      fotoFacturaPath: mediaRecord?.path || '',
      originalText: claimed.text || '',
      openaiResponseId: openaiResult.responseId,
      openaiModel,
      openaiUsage: openaiResult.usage,
      analysisVersion: 1,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    };
    await draftRef.set(draftPayload, { merge: true });
    if (supportHash) {
      await firestore.collection(AGENT_COLLECTIONS.hashes).doc(supportHash).set({
        messageId,
        draftId: draftRef.id,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await inboxRef.set({
      status: validated.status,
      draftId: draftRef.id,
      targetType: validated.tipoRegistro || 'unknown',
      analysisSummary: {
        proveedor: validated.proveedor || '',
        numeroFactura: validated.numeroFactura || '',
        branchId: validated.branchId || '',
        fecha: validated.fecha || '',
        total: validated.total,
        categoria: validated.categoria || '',
        subcategoria: validated.subcategoria || '',
        confianza: validated.confianza,
        pregunta: validated.pregunta || '',
      },
      error: '',
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await firestore.collection(AGENT_COLLECTIONS.sessions).doc(phone).set({
      phone,
      activeDraftId: draftRef.id,
      pendingDraftIds: FieldValue.arrayUnion(draftRef.id),
      lastMessageId: messageId,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await writeAudit(firestore, FieldValue, {
      event: 'ANALYSIS_COMPLETED',
      messageId,
      draftId: draftRef.id,
      status: validated.status,
      senderPhone: phone,
      openaiResponseId: openaiResult.responseId,
    });
    await sendWhatsappText({
      accessToken,
      graphVersion,
      phoneNumberId: claimed.phoneNumberId,
      to: phone,
      text: formatAccountingSummary(validated),
      logger,
    });
    return { status: validated.status, draftId: draftRef.id };
  } catch (error) {
    logger?.error?.('Error procesando mensaje para Agente Contable IA', { messageId, error: error.message });
    await inboxRef.set({
      status: AGENT_STATUSES.ERROR,
      error: error.message || 'Error procesando documento.',
      updatedAt: FieldValue.serverTimestamp(),
      completedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await writeAudit(firestore, FieldValue, { event: 'PROCESSING_ERROR', messageId, error: error.message || 'Error desconocido' });
    try {
      await sendWhatsappText({
        accessToken,
        graphVersion,
        phoneNumberId: claimed.phoneNumberId,
        to: phone,
        text: 'Recibí el documento, pero ocurrió un problema al analizarlo. El administrador ya puede ver el error en MARTIN IA y podrá reintentarlo sin que envíes nuevamente la foto.',
        logger,
      });
    } catch (replyError) {
      logger?.warn?.('No se pudo informar por WhatsApp el error de procesamiento', {
        messageId,
        error: replyError.message,
      });
    }
    throw error;
  }
}

function validateManualDraftUpdate(current, updates, catalog, allowedBranches, options = {}) {
  const allowedFields = [
    'tipoRegistro', 'branchId', 'fecha', 'vencimiento', 'providerId', 'providerCode', 'proveedor',
    'rucProveedor', 'numeroFactura', 'descripcion', 'categoria', 'subcategoria',
    'accountingAccountId', 'accountingAccountCode', 'metodoPago', 'referenciaPago',
    'referenciaConfirmadaSinDato', 'subtotal', 'iva',
    'total', 'retencionIr2', 'retencionMunicipal1', 'moneda', 'tasaCambio', 'soportes', 'confianza',
  ];
  const sanitized = {};
  allowedFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(updates || {}, field)) sanitized[field] = updates[field];
  });
  const deterministic = applyDeterministicRules({ ...current, ...sanitized, confianza: Number(sanitized.confianza ?? current.confianza ?? 0) }, catalog);
  return validateAnalysis(deterministic, {
    allowedBranches,
    hasPrimarySupport: Boolean(current.fotoFacturaPath || current.supportFiles?.length || current.allowWithoutSupport),
    hasRetentionSupport: options.hasRetentionSupport === true || (current.supportFiles || [])
      .some((support) => ['retentionIr2', 'retentionMunicipal1'].includes(support.type)),
    duplicateCandidates: current.duplicateCandidates || [],
  });
}

module.exports = {
  AGENT_COLLECTIONS,
  AGENT_STATUSES,
  ANALYSIS_SCHEMA,
  CATEGORY_OPTIONS,
  PAYMENT_METHODS,
  applyDeterministicRules,
  canonicalCurrency,
  canonicalPaymentMethod,
  extractDeterministicConversationUpdates,
  loadCatalogContext,
  normalizePhone,
  processAccountingAgentInbox,
  validateAnalysis,
  validateManualDraftUpdate,
};
