const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBacF10, bacCents, bacReference } = require('./bacF10');

test('genera F10 AR19 con anchos, CRLF y centavos exactos', () => {
  const result = buildBacF10({
    shipmentNumber: 146,
    applicationDate: '2026-09-25',
    rows: [
      {
        key: 'abonos_pagar:uno',
        beneficiaryReference: 'J0310000005680',
        bankAccount: '001234567',
        supplierName: 'INDUSTRIAL COMERCIAL SAN MARTIN,S.A',
        invoiceNumber: 'FAC-100',
        concept: 'Pago proveedor FAC-100',
        netAmount: '1234.56',
      },
      {
        key: 'compras:dos',
        beneficiaryReference: '000113230',
        bankAccount: '000113230',
        supplierName: 'DISTRIBUIDORA INTERNACIONAL SA',
        invoiceNumber: '200',
        netAmount: '10.01',
      },
    ],
  });

  const lines = result.content.split('\r\n').filter(Boolean);
  assert.equal(lines.length, 3);
  assert.equal(lines[0].length, 61);
  assert.equal(lines[1].length, 191);
  assert.equal(lines[2].length, 191);
  assert.equal(result.totalAmount, '1244.57');
  assert.equal(result.lineCount, 2);
  assert.equal(result.filename, 'BAC_AR19_00146_20260925.prn');
  assert.ok(result.content.endsWith('\r\n'));
  assert.equal(result.content.includes('\n') && !result.content.includes('\r\n'), false);
});

test('normaliza acentos a ASCII sin alterar el ancho', () => {
  const result = buildBacF10({
    shipmentNumber: 1,
    applicationDate: '2026-09-25',
    rows: [{
      key: 'gastos:uno',
      beneficiaryReference: 'REF-1',
      supplierName: 'PROVEEDOR ÁÉÍÓÚ Ñ',
      invoiceNumber: 'F-1',
      netAmount: '1.00',
    }],
  });
  const line = result.content.split('\r\n')[1];
  assert.equal(line.length, 191);
  assert.match(line, /PROVEEDOR AEIOU N/);
});

test('rechaza referencias, montos y duplicados invalidos', () => {
  assert.throws(() => bacReference('REFERENCIA CON ESPACIO'), /sin espacios/);
  assert.throws(() => bacCents('0.00'), /fuera de rango/);
  assert.throws(() => buildBacF10({
    shipmentNumber: 1,
    applicationDate: '2026-09-25',
    rows: [
      { key: 'x', beneficiaryReference: 'A', supplierName: 'UNO', invoiceNumber: '1', netAmount: '1' },
      { key: 'x', beneficiaryReference: 'B', supplierName: 'DOS', invoiceNumber: '2', netAmount: '1' },
    ],
  }), /repetido/);
});
