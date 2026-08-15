const { createHmac, timingSafeEqual } = require('node:crypto');

const AGENT_STATUSES = Object.freeze({
  RECEIVED: 'RECEIVED',
  PROCESSING: 'PROCESSING',
  NEEDS_INFORMATION: 'NEEDS_INFORMATION',
  READY_FOR_CONFIRMATION: 'READY_FOR_CONFIRMATION',
  POSSIBLE_DUPLICATE: 'POSSIBLE_DUPLICATE',
  CONFIRMED: 'CONFIRMED',
  REGISTERED: 'REGISTERED',
  REJECTED: 'REJECTED',
  ERROR: 'ERROR',
});

const PAYMENT_METHODS = Object.freeze([
  'EFECTIVO',
  'TRANSFERENCIA',
  'TARJETA BLACK MASTERCARD ***4660',
  'TARJETA AMEX BLACK',
  'TARJETA AMEX PRICESMART',
  'TARJETA LA COLONIA BAC',
  'TARJETA UNO BANPRO',
  'TARJETA BLACK BANPRO',
  'CREDITO',
]);

const CATEGORY_TREE = Object.freeze([
  ['Costos de venta / compras', ['Compra de carne res', 'Compra de cerdo', 'Compra de pollo', 'Compra de embutidos', 'Compra de mariscos', 'Compra de productos procesados', 'Fletes sobre compras', 'Merma / ajuste de inventario', 'Material de empaque directo', 'Hielo / conservacion directa', 'Otros costos de producto', 'Descuentos sobre compras']],
  ['Gastos de Nomina', ['Sueldos y salarios', 'Horas extras', 'Bonificaciones', 'Aguinaldo', 'Vacaciones', 'Indemnizacion', 'INSS patronal', 'INATEC', 'Alimentacion de personal', 'Uniformes', 'Capacitacion']],
  ['Gastos del Local', ['Alquiler', 'Energia electrica', 'Agua potable', 'Internet y telefonia', 'Servicios publicos varios', 'Mantenimiento del local', 'Reparaciones menores', 'Seguridad', 'Fumigacion', 'Limpieza', 'Recoleccion de basura']],
  ['Equipos y Operacion de Carniceria', ['Mantenimiento general de equipos', 'Mantenimiento de cuartos frios', 'Mantenimiento de vitrinas refrigeradas', 'Mantenimiento de sierras y molinos', 'Repuestos de equipos', 'Gas refrigerante', 'Herramientas de corte', 'Cuchillos y afilado', 'Balanzas y calibracion', 'Equipos menores']],
  ['Gastos de venta - Operaciones', ['Bolsas y empaques', 'Etiquetas', 'Publicidad', 'Promociones', 'Comisiones de venta', 'Delivery / reparto', 'Combustible de reparto', 'Mantenimiento de vehiculo', 'Parqueo / peajes', 'Atencion al cliente', 'Otros gastos de venta']],
  ['Gastos administrativos', ['Papeleria y utiles', 'Servicios contables', 'Servicios legales', 'Software y sistemas', 'Suscripciones', 'Mensajeria', 'Gastos de oficina', 'Caja chica', 'Diferencias de caja']],
  ['Impuestos, permisos y tasas', ['Matricula municipal', 'Impuesto municipal sobre ingresos', 'Permisos MINSA', 'Permisos alcaldia', 'Licencias y registros', 'Timbres fiscales', 'Multas y recargos', 'Otros impuestos y tasas']],
  ['Gastos financieros', ['Comisiones bancarias', 'Cargos POS', 'Intereses bancarios', 'Comisiones por transferencias', 'Diferencial cambiario', 'Otros gastos financieros']],
  ['Otros Gastos', ['Donaciones', 'Gastos no deducibles', 'Perdidas por robo', 'Perdidas por deterioro', 'Ajustes varios', 'Gastos extraordinarios', 'Otros gastos']],
]);

const FIXED_PURCHASE_RULES = Object.freeze([
  ['industrial comercial san martin', 'Compra de carne res'],
  ['cargill', 'Compra de pollo'],
  ['matadero cacique', 'Compra de cerdo'],
  ['delmor', 'Compra de embutidos'],
  ['los artesanos', 'Compra de embutidos'],
  ['sigma alimentos', 'Compra de embutidos'],
]);

const ALLOWED_MEDIA_TYPES = Object.freeze(['image/jpeg', 'image/png', 'application/pdf']);
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const normalizeText = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, ' ')
  .trim()
  .toLowerCase();

const normalizePhone = (value = '') => String(value || '').replace(/\D/g, '');
const money = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
};

const findCategory = (category, subcategory) => {
  const categoryKey = normalizeText(category);
  const subcategoryKey = normalizeText(subcategory);
  for (const [officialCategory, subcategories] of CATEGORY_TREE) {
    if (normalizeText(officialCategory) !== categoryKey) continue;
    const officialSubcategory = subcategories.find((item) => normalizeText(item) === subcategoryKey);
    if (officialSubcategory) return { category: officialCategory, subcategory: officialSubcategory };
  }
  return null;
};

const normalizePaymentMethod = (value = '') => {
  const key = normalizeText(value);
  return PAYMENT_METHODS.find((method) => normalizeText(method) === key) || '';
};

const getFixedPurchaseRule = (supplier = '') => {
  const supplierKey = normalizeText(supplier);
  const rule = FIXED_PURCHASE_RULES.find(([needle]) => supplierKey.includes(needle));
  return rule ? {
    type: 'compra',
    category: 'Costos de venta / compras',
    subcategory: rule[1],
    origin: 'fixed_supplier_rule',
  } : null;
};

const verifyMetaSignature = (rawBody, signatureHeader, appSecret) => {
  if (!rawBody || !signatureHeader || !appSecret) return false;
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const provided = String(signatureHeader);
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
};

const jsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['accion', 'tipoRegistro', 'branchId', 'fecha', 'vencimiento', 'providerId', 'providerCode', 'proveedor', 'rucProveedor', 'numeroFactura', 'descripcion', 'categoria', 'subcategoria', 'accountingAccountId', 'accountingAccountCode', 'metodoPago', 'referenciaPago', 'subtotal', 'iva', 'total', 'retencionIr2', 'retencionMunicipal1', 'totalRetenciones', 'pagoNeto', 'moneda', 'tasaCambio', 'soportes', 'confianza', 'alertas', 'datosFaltantes', 'pregunta'],
  properties: {
    accion: { type: 'string', enum: ['registrar', 'preguntar', 'duplicado'] },
    tipoRegistro: { type: ['string', 'null'], enum: ['gasto', 'compra', null] },
    branchId: { type: ['string', 'null'], enum: ['granada', 'nindiri', null] },
    fecha: { type: ['string', 'null'] },
    vencimiento: { type: ['string', 'null'] },
    providerId: { type: 'string' },
    providerCode: { type: 'string' },
    proveedor: { type: 'string' },
    rucProveedor: { type: 'string' },
    numeroFactura: { type: 'string' },
    descripcion: { type: 'string' },
    categoria: { type: 'string' },
    subcategoria: { type: 'string' },
    accountingAccountId: { type: 'string' },
    accountingAccountCode: { type: 'string' },
    metodoPago: { type: 'string' },
    referenciaPago: { type: 'string' },
    subtotal: { type: ['number', 'null'] },
    iva: { type: ['number', 'null'] },
    total: { type: ['number', 'null'] },
    retencionIr2: { type: ['number', 'null'] },
    retencionMunicipal1: { type: ['number', 'null'] },
    totalRetenciones: { type: ['number', 'null'] },
    pagoNeto: { type: ['number', 'null'] },
    moneda: { type: ['string', 'null'] },
    tasaCambio: { type: ['number', 'null'] },
    soportes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'invoiceNumber', 'provider', 'date', 'amount'],
        properties: {
          type: { type: 'string', enum: ['invoice', 'retentionIr2', 'retentionMunicipal1'] },
          invoiceNumber: { type: 'string' },
          provider: { type: 'string' },
          date: { type: ['string', 'null'] },
          amount: { type: ['number', 'null'] },
        },
      },
    },
    confianza: { type: 'number', minimum: 0, maximum: 1 },
    alertas: { type: 'array', items: { type: 'string' } },
    datosFaltantes: { type: 'array', items: { type: 'string' } },
    pregunta: { type: 'string' },
  },
};

const normalizeDraft = (input = {}) => {
  const fixedRule = getFixedPurchaseRule(input.proveedor);
  const category = fixedRule || findCategory(input.categoria, input.subcategoria);
  const subtotal = money(input.subtotal);
  const iva = money(input.iva);
  const total = money(input.total);
  const retentionIr2 = money(input.retencionIr2) ?? 0;
  const retentionMunicipal1 = money(input.retencionMunicipal1) ?? 0;
  const retentionTotal = money(retentionIr2 + retentionMunicipal1) ?? 0;

  return {
    ...input,
    tipoRegistro: fixedRule?.type || (['gasto', 'compra'].includes(input.tipoRegistro) ? input.tipoRegistro : null),
    branchId: ['granada', 'nindiri'].includes(input.branchId) ? input.branchId : null,
    fecha: DATE_RE.test(input.fecha || '') ? input.fecha : null,
    vencimiento: DATE_RE.test(input.vencimiento || '') ? input.vencimiento : null,
    providerId: String(input.providerId || ''),
    providerCode: String(input.providerCode || ''),
    proveedor: String(input.proveedor || '').trim().toUpperCase(),
    rucProveedor: String(input.rucProveedor || '').trim().toUpperCase(),
    numeroFactura: String(input.numeroFactura || '').trim(),
    descripcion: String(input.descripcion || '').trim().toUpperCase(),
    categoria: category?.category || '',
    subcategoria: category?.subcategory || '',
    accountingAccountId: String(input.accountingAccountId || ''),
    accountingAccountCode: String(input.accountingAccountCode || ''),
    metodoPago: normalizePaymentMethod(input.metodoPago),
    referenciaPago: String(input.referenciaPago || '').trim().toUpperCase(),
    subtotal,
    iva,
    total,
    retencionIr2: retentionIr2,
    retencionMunicipal1: retentionMunicipal1,
    totalRetenciones: retentionTotal,
    pagoNeto: total === null ? null : money(total - retentionTotal),
    soportes: Array.isArray(input.soportes) ? input.soportes : [],
    confianza: Math.max(0, Math.min(1, Number(input.confianza) || 0)),
    alertas: Array.isArray(input.alertas) ? input.alertas.map(String) : [],
    datosFaltantes: Array.isArray(input.datosFaltantes) ? input.datosFaltantes.map(String) : [],
    pregunta: String(input.pregunta || ''),
    fixedRuleApplied: fixedRule || null,
  };
};

const validateDraft = (input = {}, context = {}) => {
  const draft = normalizeDraft(input);
  const missing = new Set();
  const alerts = new Set(draft.alertas);
  const hasMainSupport = draft.soportes.some((support) => support?.type === 'invoice' || support?.role === 'invoice') || context.allowWithoutSupport === true;
  const methodNeedsReference = draft.metodoPago === 'TRANSFERENCIA' || draft.metodoPago.startsWith('TARJETA');

  if (!draft.tipoRegistro) missing.add('tipoRegistro');
  if (!draft.branchId) missing.add('branchId');
  if (!draft.fecha) missing.add('fecha');
  if (!draft.providerId) missing.add('providerId');
  if (!draft.proveedor) missing.add('proveedor');
  if (!draft.descripcion) missing.add('descripcion');
  if (!draft.categoria || !draft.subcategoria) missing.add('categoria');
  if (!draft.accountingAccountId || !draft.accountingAccountCode) missing.add('cuentaContable');
  if (!draft.metodoPago) missing.add('metodoPago');
  if (draft.subtotal === null || draft.subtotal < 0) missing.add('subtotal');
  if (draft.iva === null || draft.iva < 0) missing.add('iva');
  if (draft.total === null || draft.total <= 0) missing.add('total');
  if (!hasMainSupport) missing.add('soportePrincipal');
  if (draft.metodoPago === 'CREDITO' && !draft.vencimiento) missing.add('vencimiento');
  if (methodNeedsReference && !draft.referenciaPago) missing.add('referenciaPago');
  if (draft.moneda && normalizeText(draft.moneda) !== 'nio' && !money(draft.tasaCambio)) missing.add('tasaCambio');

  if (draft.subtotal !== null && draft.iva !== null && draft.total !== null && Math.abs((draft.subtotal + draft.iva) - draft.total) > 0.02) {
    alerts.add('El subtotal y el IVA no coinciden con el total.');
    missing.add('montosCuadrados');
  }
  if (draft.retencionIr2 > 0 && !context.retentionIrConfirmed && !draft.soportes.some((support) => support?.type === 'retentionIr2')) {
    alerts.add('La retencion IR requiere soporte o confirmacion explicita.');
    missing.add('confirmacionRetencionIr');
  }
  if (draft.retencionMunicipal1 > 0 && !context.retentionMunicipalConfirmed && !draft.soportes.some((support) => support?.type === 'retentionMunicipal1')) {
    alerts.add('La retencion municipal requiere soporte o confirmacion explicita.');
    missing.add('confirmacionRetencionMunicipal');
  }
  if (draft.confianza < 0.9) {
    alerts.add('La confianza general es menor a 90%.');
    missing.add('confianza');
  }

  const duplicateCandidates = Array.isArray(context.duplicateCandidates) ? context.duplicateCandidates : [];
  let status = AGENT_STATUSES.NEEDS_INFORMATION;
  let action = 'preguntar';
  if (duplicateCandidates.length) {
    status = AGENT_STATUSES.POSSIBLE_DUPLICATE;
    action = 'duplicado';
    alerts.add(`Se encontraron ${duplicateCandidates.length} posible(s) duplicado(s).`);
  } else if (!missing.size) {
    status = AGENT_STATUSES.READY_FOR_CONFIRMATION;
    action = 'registrar';
  }

  return {
    ...draft,
    accion: action,
    status,
    alertas: [...alerts],
    datosFaltantes: [...missing],
    duplicateCandidates,
    pregunta: action === 'preguntar'
      ? draft.pregunta || questionForMissing([...missing])
      : '',
  };
};

const questionForMissing = (missing = []) => {
  const field = missing[0];
  const questions = {
    tipoRegistro: '¿Este documento corresponde a una compra de mercancia o a un gasto operativo?',
    branchId: '¿Este documento corresponde a Granada o Nindiri?',
    fecha: '¿Cual es la fecha impresa en el documento?',
    providerId: 'No encontre un proveedor unico en el catalogo. ¿Cual proveedor corresponde?',
    proveedor: '¿Cual es el proveedor del documento?',
    descripcion: '¿Que concepto o descripcion debemos registrar?',
    categoria: '¿Que categoria y subcategoria exactas corresponden?',
    cuentaContable: 'Selecciona una cuenta existente del Plan de Cuentas.',
    metodoPago: '¿Cual fue el metodo de pago?',
    subtotal: '¿Cual es el subtotal correcto?',
    iva: '¿Cual es el IVA? Indica 0 si es exento.',
    total: '¿Cual es el total correcto?',
    soportePrincipal: 'No encontre el soporte principal. ¿Deseas adjuntarlo o autorizar el registro sin factura?',
    vencimiento: '¿Cual es la fecha de vencimiento del credito?',
    referenciaPago: '¿Cual es la referencia del pago?',
    tasaCambio: '¿Cual tasa de cambio debemos utilizar?',
    montosCuadrados: 'El subtotal y el IVA no coinciden con el total. ¿Cual monto es correcto?',
    confirmacionRetencionIr: '¿Confirmas la retencion de anticipo IR 2% o puedes adjuntar su soporte?',
    confirmacionRetencionMunicipal: '¿Confirmas la retencion municipal 1% o puedes adjuntar su soporte?',
    confianza: 'No tengo suficiente confianza para completar el borrador. ¿Puedes confirmar o corregir los datos?',
  };
  return questions[field] || 'Necesito confirmar un dato antes de preparar el registro. ¿Puedes revisarlo?';
};

const parseConversationIntent = (text = '') => {
  const key = normalizeText(text);
  if (/^(si|registrar|confirmar|correcto|dale|proceder|ok)$/.test(key)) return { type: 'confirm' };
  if (/^(no|cancelar|descartar|rechazar)$/.test(key)) return { type: 'reject' };
  if (/esta mal|incorrect/.test(key)) return { type: 'correction_request' };
  if (/granada/.test(key)) return { type: 'patch', patch: { branchId: 'granada' } };
  if (/nindiri/.test(key)) return { type: 'patch', patch: { branchId: 'nindiri' } };
  const method = PAYMENT_METHODS.find((item) => key.includes(normalizeText(item)));
  if (method) return { type: 'patch', patch: { metodoPago: method } };
  return { type: 'free_text' };
};

const buildConfirmationSummary = (draft = {}) => [
  'Factura lista para confirmar.',
  '',
  `Tipo: ${(draft.tipoRegistro || '').toUpperCase()}`,
  `Proveedor: ${draft.proveedor || 'Pendiente'}`,
  `Sucursal: ${draft.branchId === 'nindiri' ? 'Nindiri' : 'Granada'}`,
  `Fecha: ${draft.fecha || 'Pendiente'}`,
  `Factura: ${draft.numeroFactura || '(sin numero)'}`,
  `Categoria: ${draft.categoria || 'Pendiente'} / ${draft.subcategoria || 'Pendiente'}`,
  `Subtotal: C$${Number(draft.subtotal || 0).toFixed(2)}`,
  `IVA: C$${Number(draft.iva || 0).toFixed(2)}`,
  `Total: C$${Number(draft.total || 0).toFixed(2)}`,
  `Metodo: ${draft.metodoPago || 'Pendiente'}`,
  `Referencia: ${draft.referenciaPago || '(no aplica)'}`,
  `Retenciones: C$${Number(draft.totalRetenciones || 0).toFixed(2)}`,
  '',
  '¿Deseas registrarla?',
].join('\n');

module.exports = {
  AGENT_STATUSES,
  ALLOWED_MEDIA_TYPES,
  CATEGORY_TREE,
  FIXED_PURCHASE_RULES,
  MAX_MEDIA_BYTES,
  PAYMENT_METHODS,
  buildConfirmationSummary,
  findCategory,
  getFixedPurchaseRule,
  jsonSchema,
  money,
  normalizeDraft,
  normalizePaymentMethod,
  normalizePhone,
  normalizeText,
  parseConversationIntent,
  questionForMissing,
  validateDraft,
  verifyMetaSignature,
};
