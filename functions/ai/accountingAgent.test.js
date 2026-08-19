const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AGENT_STATUSES,
  PAYMENT_METHODS,
  applyDeterministicRules,
  normalizePhone,
  validateAnalysis,
} = require('./accountingAgent');

const catalog = {
  providers: [
    { id: 'cargill', nombre: 'CARGILL DE NICARAGUA', ruc: 'J0310000000001', code: 'PRV-001' },
    { id: 'matadero', nombre: 'MATADERO CACIQUE', ruc: 'J0310000000002', code: 'PRV-002' },
    { id: 'sigma', nombre: 'SIGMA ALIMENTOS S.A.', ruc: 'J0310000000003', code: 'PRV-003' },
    { id: 'energia-uno', nombre: 'ENERGIA CENTRAL', ruc: 'J0310000000004', code: 'PRV-004' },
    { id: 'energia-dos', nombre: 'ENERGIA CENTRAL NICARAGUA', ruc: 'J0310000000005', code: 'PRV-005' },
  ],
  accounts: [
    { id: '11060', number: '11060', name: 'INVENTARIO:Alimentos', type: 'Activos corrientes' },
    { id: '5', number: '5', name: 'COSTOS Y GASTOS', type: 'Gastos' },
  ],
  rules: [],
};

const validBase = (overrides = {}) => ({
  accion: 'registrar',
  tipoRegistro: 'gasto',
  branchId: 'granada',
  fecha: '2026-08-19',
  vencimiento: null,
  providerId: 'cargill',
  providerCode: 'PRV-001',
  proveedor: 'CARGILL DE NICARAGUA',
  rucProveedor: 'J0310000000001',
  numeroFactura: 'F-100',
  descripcion: 'SERVICIO OPERATIVO',
  categoria: 'Gastos administrativos',
  subcategoria: 'Gastos de oficina',
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
  soportes: [],
  confianza: 0.97,
  alertas: [],
  datosFaltantes: [],
  pregunta: '',
  ...overrides,
});

const validate = (analysis, duplicateCandidates = []) => validateAnalysis(analysis, {
  allowedBranches: ['granada', 'nindiri'],
  hasPrimarySupport: true,
  duplicateCandidates,
});

test('normaliza números de WhatsApp sin símbolos', () => {
  assert.equal(normalizePhone('+505 8888-7777'), '50588887777');
});

test('Cargill se clasifica como compra de pollo', () => {
  const result = applyDeterministicRules(validBase({ proveedor: 'Cargill', tipoRegistro: 'gasto' }), catalog);
  assert.equal(result.tipoRegistro, 'compra');
  assert.equal(result.subcategoria, 'Compra de pollo');
  assert.equal(result.accountingAccountCode, '11060');
});

test('Matadero Cacique se clasifica como compra de cerdo', () => {
  const result = applyDeterministicRules(validBase({ proveedor: 'Matadero Cacique' }), catalog);
  assert.equal(result.subcategoria, 'Compra de cerdo');
});

test('Sigma se clasifica como compra de embutidos', () => {
  const result = applyDeterministicRules(validBase({ proveedor: 'Sigma Alimentos S.A.' }), catalog);
  assert.equal(result.subcategoria, 'Compra de embutidos');
});

test('prioriza proveedor por RUC', () => {
  const result = applyDeterministicRules(validBase({ proveedor: 'Nombre OCR incorrecto', rucProveedor: 'J0310000000002' }), catalog);
  assert.equal(result.providerId, 'matadero');
});

test('una coincidencia ambigua de proveedor no se selecciona', () => {
  const result = applyDeterministicRules(validBase({ proveedor: 'ENERGIA CENTRAL', rucProveedor: '' }), {
    ...catalog,
    providers: catalog.providers.filter((provider) => provider.id.startsWith('energia')),
  });
  assert.equal(result.providerId, 'energia-uno');
  const fuzzy = applyDeterministicRules(validBase({ proveedor: 'ENERGIA', rucProveedor: '' }), catalog);
  assert.equal(fuzzy.providerId, '');
});

test('rechaza categoría inexistente', () => {
  const result = applyDeterministicRules(validBase({
    proveedor: 'ENERGIA CENTRAL',
    rucProveedor: 'J0310000000004',
    categoria: 'Categoría inventada',
    subcategoria: 'Otra',
  }), catalog);
  assert.equal(result.categoria, '');
  assert.ok(validate(result).datosFaltantes.includes('categoria'));
});

test('marca listo un documento completo con confianza alta', () => {
  const result = validate(validBase());
  assert.equal(result.status, AGENT_STATUSES.READY_FOR_CONFIRMATION);
});

test('confianza menor a 90 por ciento requiere información', () => {
  const result = validate(validBase({ confianza: 0.89 }));
  assert.equal(result.status, AGENT_STATUSES.NEEDS_INFORMATION);
});

test('diferencia fiscal mayor a dos centavos bloquea el borrador', () => {
  const result = validate(validBase({ total: 114.9 }));
  assert.equal(result.status, AGENT_STATUSES.NEEDS_INFORMATION);
  assert.ok(result.datosFaltantes.includes('total'));
});

test('crédito sin vencimiento queda incompleto', () => {
  const result = validate(validBase({ metodoPago: 'CREDITO', vencimiento: null }));
  assert.ok(result.datosFaltantes.includes('vencimiento'));
});

test('transferencia sin referencia queda incompleta', () => {
  const result = validate(validBase({ metodoPago: 'TRANSFERENCIA', referenciaPago: '' }));
  assert.ok(result.datosFaltantes.includes('referenciaPago'));
});

test('todos los métodos de pago oficiales son aceptados', () => {
  PAYMENT_METHODS.forEach((method) => {
    const result = validate(validBase({
      metodoPago: method,
      referenciaPago: method === 'TRANSFERENCIA' ? 'REF-1' : '',
      vencimiento: method === 'CREDITO' ? '2026-09-19' : null,
    }));
    assert.ok(!result.datosFaltantes.includes('metodoPago'), method);
  });
});

test('retención sin soporte queda pendiente', () => {
  const result = validate(validBase({ retencionIr2: 2, totalRetenciones: 2, pagoNeto: 113 }));
  assert.ok(result.datosFaltantes.includes('soporteRetencion'));
});

test('un candidato duplicado nunca queda listo para confirmar', () => {
  const result = validate(validBase(), [{ collection: 'gastos', id: 'gasto-1' }]);
  assert.equal(result.status, AGENT_STATUSES.POSSIBLE_DUPLICATE);
});
