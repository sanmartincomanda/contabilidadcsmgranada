const admin = require('firebase-admin');
const {
  getBranchConfig,
  getExcludedClientId,
  money,
  stableStringify,
} = require('./syncSicarTicketSales');

function placeholders(values = []) {
  return values.map(() => '?').join(',');
}

function toLocalDate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value).substring(0, 10);
}

function compactAddress(row = {}) {
  return [row.domicilio, row.noExt, row.noInt, row.colonia, row.localidad, row.ciudad]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(', ');
}

function getCreditReceiptGroupKey(row = {}) {
  return row.acp_id ? `p_${row.acp_id}` : `a_${row.acl_id}`;
}

async function fetchCreditReceiptsWithFilter(connection, filterSql, params = []) {
  const excludedClientId = getExcludedClientId();
  const [rows] = await connection.execute(`
    SELECT
      a.acl_id,
      a.fecha,
      a.total,
      a.comentario,
      a.status,
      a.ccl_id,
      a.tpa_id,
      a.acp_id,
      p.total AS parentTotal,
      p.comentario AS parentComment,
      cc.total AS creditTotal,
      cc.status AS creditStatus,
      cc.cli_id,
      cc.ven_id,
      v.tic_id,
      v.caj_id AS saleCashboxId,
      COALESCE(mv.caj_id, v.caj_id) AS cashboxId,
      caja.nombre AS cashboxName,
      COALESCE(tp.nombre, CONCAT('TIPO ', a.tpa_id)) AS paymentMethod,
      cli.nombre AS customerName,
      cli.rfc AS customerRfc,
      cli.domicilio,
      cli.noExt,
      cli.noInt,
      cli.colonia,
      cli.localidad,
      cli.ciudad,
      fi.fac_id AS invoiceFacId,
      fi.invoiceNumbers
    FROM abonocliente a
    LEFT JOIN aboclipadre p ON p.acp_id = a.acp_id
    INNER JOIN creditocliente cc ON cc.ccl_id = a.ccl_id
    LEFT JOIN venta v ON v.ven_id = cc.ven_id
    LEFT JOIN (
      SELECT acl_id, MIN(caj_id) AS caj_id
      FROM movimiento
      WHERE acl_id IS NOT NULL
      GROUP BY acl_id
    ) mv ON mv.acl_id = a.acl_id
    LEFT JOIN caja ON caja.caj_id = COALESCE(mv.caj_id, v.caj_id)
    LEFT JOIN tipopago tp ON tp.tpa_id = a.tpa_id
    LEFT JOIN cliente cli ON cli.cli_id = cc.cli_id
    LEFT JOIN (
      SELECT
        fv.ven_id,
        MIN(f.fac_id) AS fac_id,
        GROUP_CONCAT(DISTINCT CONCAT(COALESCE(f.letraFolio, ''), COALESCE(f.folio, '')) ORDER BY f.fac_id SEPARATOR ',') AS invoiceNumbers
      FROM facturaven fv
      INNER JOIN factura f ON f.fac_id = fv.fac_id
      GROUP BY fv.ven_id
    ) fi ON fi.ven_id = cc.ven_id
    WHERE ${filterSql}
      AND cc.cli_id <> ?
    ORDER BY a.fecha, COALESCE(a.acp_id, a.acl_id), a.acl_id
  `, [...params, excludedClientId]);

  const { branchId, branchName } = getBranchConfig();
  const groups = new Map();

  rows.forEach((row) => {
    const groupKey = getCreditReceiptGroupKey(row);
    const date = toLocalDate(row.fecha);
    const isApplicationCancelled = Number(row.status || 0) <= 0;
    const invoiceNumbers = String(row.invoiceNumbers || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const sourceDocumentType = invoiceNumbers.length ? 'factura' : row.tic_id ? 'ticket' : 'venta_credito';
    const sourceDocumentNumber = invoiceNumbers[0] || (row.tic_id ? String(row.tic_id) : String(row.ven_id || ''));
    const group = groups.get(groupKey) || {
      id: `sicar_cobro_${branchId}_${groupKey}`,
      sourceSystem: 'SICAR',
      sourceType: 'customer_credit_payment',
      sourceMode: 'local-worker-watch',
      branch: branchId,
      branchId,
      branchName,
      date,
      month: date.substring(0, 7),
      paymentGroupType: row.acp_id ? 'aboclipadre' : 'abonocliente',
      sicarPaymentGroupId: row.acp_id || null,
      acpId: row.acp_id || null,
      customerId: row.cli_id || null,
      customerName: String(row.customerName || '').trim(),
      customerRfc: String(row.customerRfc || '').trim(),
      customerAddress: compactAddress(row),
      cashboxId: row.cashboxId || null,
      cashboxName: String(row.cashboxName || '').trim(),
      paymentMethod: String(row.paymentMethod || '').trim(),
      comment: String(row.parentComment || row.comentario || '').trim(),
      parentTotal: money(row.parentTotal),
      amount: 0,
      originalAmount: 0,
      paymentBreakdown: [],
      applications: [],
      sicarPaymentIds: [],
    };

    group.originalAmount = money(group.originalAmount + money(row.total));
    if (!isApplicationCancelled) group.amount = money(group.amount + money(row.total));
    group.sicarPaymentIds.push(Number(row.acl_id));
    group.applications.push({
      sicarPaymentId: Number(row.acl_id),
      aclId: Number(row.acl_id),
      sicarCreditId: Number(row.ccl_id),
      cclId: Number(row.ccl_id),
      sicarSaleId: Number(row.ven_id || 0) || null,
      venId: Number(row.ven_id || 0) || null,
      sicarTicketId: row.tic_id || null,
      ticketId: row.tic_id || null,
      sourceDocumentType,
      sourceDocumentNumber,
      linkedInvoiceNumbers: invoiceNumbers,
      creditOriginalAmount: money(row.creditTotal),
      appliedAmount: money(row.total),
      creditStatus: Number(row.creditStatus || 0),
      status: isApplicationCancelled ? 'cancelled' : 'active',
      isCancelled: isApplicationCancelled,
    });
    const methodKey = `${row.tpa_id || ''}|${String(row.paymentMethod || '').trim()}`;
    const method = group.paymentBreakdown.find((item) => item.key === methodKey);
    if (method) {
      method.amount = money(method.amount + (isApplicationCancelled ? 0 : money(row.total)));
    } else {
      group.paymentBreakdown.push({
        key: methodKey,
        paymentTypeId: row.tpa_id || null,
        method: String(row.paymentMethod || '').trim(),
        amount: isApplicationCancelled ? 0 : money(row.total),
      });
    }
    groups.set(groupKey, group);
  });

  return [...groups.values()].map((group) => {
    const cancelledApplicationCount = group.applications.filter((item) => item.isCancelled).length;
    const activeApplicationCount = group.applications.length - cancelledApplicationCount;
    const isCancelled = activeApplicationCount === 0;
    return {
      ...group,
      amount: money(group.amount),
      originalAmount: money(group.originalAmount),
      applicationCount: group.applications.length,
      activeApplicationCount,
      cancelledApplicationCount,
      hasCancelledApplications: cancelledApplicationCount > 0,
      isCancelled,
      status: isCancelled ? 'cancelled' : cancelledApplicationCount > 0 ? 'partially_cancelled' : 'active',
      sicarReceiptCode: group.sicarPaymentGroupId
        ? `RC-${group.sicarPaymentGroupId}`
        : `RC-${group.sicarPaymentIds[0] || ''}`,
    };
  });
}

async function fetchSicarCreditReceipts(connection, startDate, endExclusive) {
  return fetchCreditReceiptsWithFilter(connection, 'a.fecha >= ? AND a.fecha < ?', [startDate, endExclusive]);
}

async function fetchSicarCreditReceiptsByPaymentIds(connection, paymentIds = []) {
  const ids = [...new Set(paymentIds.map(Number).filter(Number.isFinite))];
  if (!ids.length) return [];
  const [groupRows] = await connection.execute(`
    SELECT acl_id, acp_id
    FROM abonocliente
    WHERE acl_id IN (${placeholders(ids)})
  `, ids);
  const parentIds = [...new Set(groupRows.map((row) => Number(row.acp_id)).filter(Number.isFinite))];
  const standaloneIds = groupRows.filter((row) => !row.acp_id).map((row) => Number(row.acl_id));
  const filters = [];
  const params = [];
  if (parentIds.length) {
    filters.push(`a.acp_id IN (${placeholders(parentIds)})`);
    params.push(...parentIds);
  }
  if (standaloneIds.length) {
    filters.push(`a.acl_id IN (${placeholders(standaloneIds)})`);
    params.push(...standaloneIds);
  }
  if (!filters.length) return [];
  return fetchCreditReceiptsWithFilter(connection, `(${filters.join(' OR ')})`, params);
}

function buildSicarCreditReceiptFingerprint(receipt = {}) {
  return stableStringify({
    amount: receipt.amount,
    applications: receipt.applications,
    cashboxId: receipt.cashboxId,
    customerId: receipt.customerId,
    date: receipt.date,
    paymentBreakdown: receipt.paymentBreakdown,
    status: receipt.status,
  });
}

async function writeSicarCreditReceipt(db, receipt, fingerprint = buildSicarCreditReceiptFingerprint(receipt)) {
  const FieldValue = admin.firestore.FieldValue;
  await db.collection('sicar_recibos_caja').doc(receipt.id).set({
    ...receipt,
    sicarFingerprint: fingerprint,
    syncedBy: 'local-worker-watch',
    syncedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

module.exports = {
  buildSicarCreditReceiptFingerprint,
  fetchSicarCreditReceipts,
  fetchSicarCreditReceiptsByPaymentIds,
  getCreditReceiptGroupKey,
  writeSicarCreditReceipt,
};
