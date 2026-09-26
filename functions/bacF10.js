class BacF10Error extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'BacF10Error';
    this.statusCode = statusCode;
  }
}

const BAC_PLAN = Object.freeze({
  code: 'AR19',
  name: 'Plan AR19',
  accountCode: '1102101',
  accountNumber: '362843534',
  currency: 'NIO',
});

const fail = (message) => {
  throw new BacF10Error(message);
};

function bacDate(value) {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString().slice(0, 10) !== value
  ) {
    fail('Fecha BAC no valida.');
  }
  return value;
}

function bacCents(value) {
  const normalized = typeof value === 'number' ? value.toFixed(2) : String(value ?? '').trim();
  const match = normalized.match(/^(\d{1,11})(?:\.(\d{1,2}))?$/);
  if (!match) fail('Monto BAC no valido. Use hasta dos decimales.');
  const cents = (BigInt(match[1]) * 100n) + BigInt((match[2] || '').padEnd(2, '0'));
  if (cents <= 0n || cents > 9999999999999n) fail('Monto BAC fuera de rango.');
  return cents;
}

const bacMoney = (cents) => `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;

function bacReference(value) {
  const reference = String(value ?? '').trim();
  if (!reference || reference.length > 20 || !/^[\x21-\x7e]+$/.test(reference)) {
    fail('La referencia BAC debe coincidir con la registrada en el banco: de 1 a 20 caracteres ASCII, sin espacios.');
  }
  return reference;
}

function ascii(value, width, label, { truncate = false } = {}) {
  const text = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!text.trim() || /[^\x20-\x7e]/.test(text)) fail(`${label}: contiene caracteres no admitidos en ASCII.`);
  if (!truncate && text.length > width) fail(`${label}: excede ${width} caracteres.`);
  return text.slice(0, width).padEnd(width, ' ');
}

function optionalNumeric(value) {
  if (!value) return ' '.repeat(9);
  const text = String(value).trim();
  if (!/^\d{1,9}$/.test(text)) fail('Referencia contable o cuenta BAC invalida.');
  return text.padStart(9, ' ');
}

function buildBacF10({ planCode = BAC_PLAN.code, shipmentNumber, applicationDate, rows }) {
  if (!/^[A-Z0-9]{4}$/.test(planCode)) fail('El codigo de plan debe tener cuatro caracteres.');
  if (!/^\d{1,5}$/.test(String(shipmentNumber)) || Number(shipmentNumber) < 1) {
    fail('Numero de envio: de 1 a 99999.');
  }

  const shipment = String(Number(shipmentNumber)).padStart(5, '0');
  const date = bacDate(applicationDate).replaceAll('-', '');
  if (!Array.isArray(rows) || !rows.length || rows.length > 99999) {
    fail('Seleccione entre 1 y 99999 lineas.');
  }

  const seen = new Set();
  let total = 0n;
  const transactions = rows.map((row, index) => {
    if (!row.key || seen.has(row.key)) fail('Un pago esta repetido en la seleccion.');
    seen.add(row.key);

    const cents = bacCents(row.netAmount);
    total += cents;
    const reference = bacReference(row.beneficiaryReference).padEnd(20, ' ');
    const name = ascii(row.supplierName, 60, 'Nombre de proveedor', { truncate: true });
    const concept = ascii(row.concept || `Pago CSM ${row.supplierName}`, 30, 'Concepto', { truncate: true });
    const invoice = ascii(row.invoiceNumber, 20, 'Numero de factura');

    return `T${planCode}${shipment}${reference}${String(index + 1).padStart(5, '0')}${date}${String(cents).padStart(13, '0')}     ${concept} ${name}${invoice} ${optionalNumeric(row.accountingReference)}${optionalNumeric(row.bankAccount)}`;
  });

  if (total > 9999999999999n) fail('El total excede la capacidad del formato F10.');
  const header = `B${planCode}${shipment}${' '.repeat(25)}${date}${String(total).padStart(13, '0')}${String(rows.length).padStart(5, '0')}`;
  const content = [header, ...transactions].join('\r\n') + '\r\n';

  return {
    content,
    totalAmount: bacMoney(total),
    lineCount: rows.length,
    filename: `BAC_${planCode}_${shipment}_${date}.prn`,
    shipmentNumber: Number(shipment),
    applicationDate,
  };
}

module.exports = {
  BAC_PLAN,
  BacF10Error,
  bacCents,
  bacDate,
  bacMoney,
  bacReference,
  buildBacF10,
};
