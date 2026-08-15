const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const {
  AGENT_STATUSES,
  ALLOWED_MEDIA_TYPES,
  CATEGORY_TREE,
  MAX_MEDIA_BYTES,
  PAYMENT_METHODS,
  findCategory,
  getFixedPurchaseRule,
  normalizeDraft,
  normalizePaymentMethod,
  normalizePhone,
  parseConversationIntent,
  validateDraft,
  verifyMetaSignature,
} = require('../accountingAgent');

const support = { type: 'invoice', role: 'invoice', url: 'https://example.test/invoice.jpg' };
const validDraft = (overrides = {}) => ({
  accion: 'registrar',
  tipoRegistro: 'gasto',
  branchId: 'granada',
  fecha: '2026-08-14',
  vencimiento: null,
  providerId: 'puma',
  providerCode: 'PRV-00001',
  proveedor: 'PUMA ENERGY',
  rucProveedor: 'J0310000000001',
  numeroFactura: '001234',
  descripcion: 'COMBUSTIBLE DE REPARTO',
  categoria: 'Gastos de venta - Operaciones',
  subcategoria: 'Combustible de reparto',
  accountingAccountId: '5',
  accountingAccountCode: '5',
  metodoPago: 'EFECTIVO',
  referenciaPago: '',
  subtotal: 100,
  iva: 15,
  total: 115,
  retencionIr2: 0,
  retencionMunicipal1: 0,
  totalRetenciones: 0,
  pagoNeto: 115,
  soportes: [support],
  confianza: 0.95,
  alertas: [],
  datosFaltantes: [],
  pregunta: '',
  ...overrides,
});

test('firma Meta valida', () => {
  const body = Buffer.from('{"ok":true}');
  const secret = 'secret';
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  assert.equal(verifyMetaSignature(body, signature, secret), true);
});

test('firma Meta invalida', () => assert.equal(verifyMetaSignature(Buffer.from('{}'), 'sha256=bad', 'secret'), false));
test('firma Meta requiere App Secret', () => assert.equal(verifyMetaSignature(Buffer.from('{}'), 'sha256=bad', ''), false));
test('normaliza telefono', () => assert.equal(normalizePhone('+505 8888-9999'), '50588889999'));
test('limite de archivo es 10 MB', () => assert.equal(MAX_MEDIA_BYTES, 10 * 1024 * 1024));
test('solo acepta JPG PNG y PDF', () => assert.deepEqual(ALLOWED_MEDIA_TYPES, ['image/jpeg', 'image/png', 'application/pdf']));
test('metodos de pago oficiales son nueve', () => assert.equal(PAYMENT_METHODS.length, 9));
test('metodo exacto se conserva', () => assert.equal(normalizePaymentMethod('EFECTIVO'), 'EFECTIVO'));
test('metodo con minusculas se normaliza', () => assert.equal(normalizePaymentMethod('transferencia'), 'TRANSFERENCIA'));
test('metodo inventado se rechaza', () => assert.equal(normalizePaymentMethod('CHEQUE'), ''));

for (const [supplier, expected] of [
  ['Industrial Comercial San Martin S.A.', 'Compra de carne res'],
  ['CARGILL DE NICARAGUA', 'Compra de pollo'],
  ['MATADERO CACIQUE', 'Compra de cerdo'],
  ['DELMOR', 'Compra de embutidos'],
  ['LOS ARTESANOS', 'Compra de embutidos'],
  ['SIGMA ALIMENTOS S.A.', 'Compra de embutidos'],
]) {
  test(`regla fija ${supplier}`, () => {
    const rule = getFixedPurchaseRule(supplier);
    assert.equal(rule.type, 'compra');
    assert.equal(rule.subcategory, expected);
  });
}

test('proveedor sin regla fija no se fuerza', () => assert.equal(getFixedPurchaseRule('PUMA ENERGY'), null));
test('categoria exacta existe', () => assert.equal(findCategory('Gastos de Nomina', 'Sueldos y salarios').subcategory, 'Sueldos y salarios'));
test('categoria inventada no existe', () => assert.equal(findCategory('Gastos varios', 'Todo'), null));
test('catalogo contiene nueve categorias', () => assert.equal(CATEGORY_TREE.length, 9));
test('mariscos es costo de venta', () => assert.equal(findCategory('Costos de venta / compras', 'Compra de mariscos').category, 'Costos de venta / compras'));
test('rollos termicos usan bolsas y empaques cuando el modelo los clasifica', () => assert.ok(findCategory('Gastos de venta - Operaciones', 'Bolsas y empaques')));
test('empaque directo existe separado', () => assert.ok(findCategory('Costos de venta / compras', 'Material de empaque directo')));

test('borrador completo queda listo para confirmar', () => assert.equal(validateDraft(validDraft()).status, AGENT_STATUSES.READY_FOR_CONFIRMATION));
test('registrar significa confirmar, no contabilizar', () => assert.equal(validateDraft(validDraft()).accion, 'registrar'));
test('factura sin numero es valida', () => assert.equal(validateDraft(validDraft({ numeroFactura: '' })).status, AGENT_STATUSES.READY_FOR_CONFIRMATION));
test('no genera S/N', () => assert.equal(normalizeDraft(validDraft({ numeroFactura: '' })).numeroFactura, ''));
test('fecha invalida requiere pregunta', () => assert.ok(validateDraft(validDraft({ fecha: '14/08/2026' })).datosFaltantes.includes('fecha')));
test('sucursal desconocida requiere pregunta', () => assert.ok(validateDraft(validDraft({ branchId: 'masaya' })).datosFaltantes.includes('branchId')));
test('Nindiri es sucursal valida', () => assert.equal(validateDraft(validDraft({ branchId: 'nindiri' })).status, AGENT_STATUSES.READY_FOR_CONFIRMATION));
test('proveedor existente es obligatorio', () => assert.ok(validateDraft(validDraft({ providerId: '' })).datosFaltantes.includes('providerId')));
test('descripcion es obligatoria', () => assert.ok(validateDraft(validDraft({ descripcion: '' })).datosFaltantes.includes('descripcion')));
test('cuenta contable es obligatoria', () => assert.ok(validateDraft(validDraft({ accountingAccountId: '', accountingAccountCode: '' })).datosFaltantes.includes('cuentaContable')));
test('subtotal es obligatorio', () => assert.ok(validateDraft(validDraft({ subtotal: null })).datosFaltantes.includes('subtotal')));
test('IVA cero es valido', () => assert.equal(validateDraft(validDraft({ subtotal: 115, iva: 0, total: 115 })).status, AGENT_STATUSES.READY_FOR_CONFIRMATION));
test('monto descuadrado por mas de dos centavos pregunta', () => assert.ok(validateDraft(validDraft({ total: 115.03 })).datosFaltantes.includes('montosCuadrados')));
test('tolerancia de dos centavos es valida', () => assert.equal(validateDraft(validDraft({ total: 115.02 })).status, AGENT_STATUSES.READY_FOR_CONFIRMATION));
test('confianza menor de 90 por ciento pregunta', () => assert.ok(validateDraft(validDraft({ confianza: 0.89 })).datosFaltantes.includes('confianza')));
test('confianza de 90 por ciento es valida', () => assert.equal(validateDraft(validDraft({ confianza: 0.9 })).status, AGENT_STATUSES.READY_FOR_CONFIRMATION));
test('credito requiere vencimiento', () => assert.ok(validateDraft(validDraft({ metodoPago: 'CREDITO' })).datosFaltantes.includes('vencimiento')));
test('credito con vencimiento es valido', () => assert.equal(validateDraft(validDraft({ metodoPago: 'CREDITO', vencimiento: '2026-09-14' })).status, AGENT_STATUSES.READY_FOR_CONFIRMATION));
test('transferencia requiere referencia', () => assert.ok(validateDraft(validDraft({ metodoPago: 'TRANSFERENCIA' })).datosFaltantes.includes('referenciaPago')));
test('transferencia con referencia es valida', () => assert.equal(validateDraft(validDraft({ metodoPago: 'TRANSFERENCIA', referenciaPago: 'ABC123' })).status, AGENT_STATUSES.READY_FOR_CONFIRMATION));

for (const card of PAYMENT_METHODS.filter((method) => method.startsWith('TARJETA'))) {
  test(`${card} requiere referencia`, () => assert.ok(validateDraft(validDraft({ metodoPago: card })).datosFaltantes.includes('referenciaPago')));
}

test('retencion IR sin soporte ni confirmacion pregunta', () => assert.ok(validateDraft(validDraft({ retencionIr2: 2, totalRetenciones: 2 })).datosFaltantes.includes('confirmacionRetencionIr')));
test('retencion IR con soporte es valida', () => assert.equal(validateDraft(validDraft({ retencionIr2: 2, totalRetenciones: 2, soportes: [support, { type: 'retentionIr2' }] })).status, AGENT_STATUSES.READY_FOR_CONFIRMATION));
test('retencion municipal sin soporte pregunta', () => assert.ok(validateDraft(validDraft({ retencionMunicipal1: 1, totalRetenciones: 1 })).datosFaltantes.includes('confirmacionRetencionMunicipal')));
test('retencion municipal confirmada es valida', () => assert.equal(validateDraft(validDraft({ retencionMunicipal1: 1, totalRetenciones: 1 }), { retentionMunicipalConfirmed: true }).status, AGENT_STATUSES.READY_FOR_CONFIRMATION));
test('pago neto resta retenciones', () => assert.equal(normalizeDraft(validDraft({ retencionIr2: 2, retencionMunicipal1: 1, totalRetenciones: 3 })).pagoNeto, 112));
test('sin soporte requiere autorizacion expresa', () => assert.ok(validateDraft(validDraft({ soportes: [] })).datosFaltantes.includes('soportePrincipal')));
test('sin soporte autorizado puede continuar', () => assert.equal(validateDraft(validDraft({ soportes: [] }), { allowWithoutSupport: true }).status, AGENT_STATUSES.READY_FOR_CONFIRMATION));
test('moneda extranjera requiere tasa', () => assert.ok(validateDraft(validDraft({ moneda: 'USD', tasaCambio: null })).datosFaltantes.includes('tasaCambio')));
test('posible duplicado bloquea registro', () => assert.equal(validateDraft(validDraft(), { duplicateCandidates: [{ id: 'x' }] }).status, AGENT_STATUSES.POSSIBLE_DUPLICATE));

for (const word of ['Si', 'Registrar', 'Confirmar', 'Correcto', 'Dale']) test(`confirma con ${word}`, () => assert.equal(parseConversationIntent(word).type, 'confirm'));
for (const word of ['No', 'Cancelar', 'Descartar', 'Rechazar']) test(`rechaza con ${word}`, () => assert.equal(parseConversationIntent(word).type, 'reject'));
test('corrige sucursal Granada', () => assert.deepEqual(parseConversationIntent('Es Granada').patch, { branchId: 'granada' }));
test('corrige sucursal Nindiri', () => assert.deepEqual(parseConversationIntent('Es Nindiri').patch, { branchId: 'nindiri' }));
test('solicita correccion cuando esta mal', () => assert.equal(parseConversationIntent('Esta mal').type, 'correction_request'));
