const crypto = require('node:crypto');
const path = require('node:path');
const mysql = require('mysql2/promise');
const admin = require('firebase-admin');
const {
  fetchStampedInvoicesByIds,
  getMysqlConfig,
  initFirebase,
  loadEnvFile,
  toDateString,
  writeInvoice,
} = require('./syncSicarBilling');

const ACTIVE_EXCLUDED_STATUSES = new Set(['ANULADA', 'ANULADO', 'CANCELADA', 'CANCELADO', 'DELETED']);
const TEMP_FOLIO_BASE = -880000000000;

function normalizeText(value = '') {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function parseArgs(argv) {
  const today = toDateString(new Date());
  const currentMonth = today.substring(0, 7);
  return argv.reduce((acc, arg) => {
    if (arg === '--apply') acc.apply = true;
    else if (arg === '--preview') acc.apply = false;
    else if (arg.startsWith('--month=')) acc.month = arg.slice('--month='.length);
    else if (arg.startsWith('--startDate=')) acc.startDate = arg.slice('--startDate='.length);
    else if (arg.startsWith('--endDate=')) acc.endDate = arg.slice('--endDate='.length);
    else if (arg.startsWith('--date=')) {
      acc.startDate = arg.slice('--date='.length);
      acc.endDate = arg.slice('--date='.length);
    }
    return acc;
  }, {
    apply: false,
    month: currentMonth,
    startDate: '',
    endDate: today,
  });
}

function getDateRange(options) {
  const month = String(options.month || '').trim();
  const startDate = options.startDate || (month ? `${month}-01` : options.endDate);
  const endDate = options.endDate || startDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error('Usa fechas YYYY-MM-DD o --month=YYYY-MM.');
  }
  if (endDate < startDate) throw new Error('endDate no puede ser menor que startDate.');
  return { startDate, endDate };
}

function getSourceFacId(invoice = {}) {
  const candidates = [
    invoice.sourceSicarInvoiceId,
    invoice.accountingSourceSicarInvoiceId,
    invoice.sicarInvoiceId,
    invoice.sourceRecordId,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const match = String(candidate).match(/(\d+)$/);
    if (match) return Number(match[1]);
  }
  return 0;
}

function parseInvoiceNumber(invoiceNumber = '') {
  const value = String(invoiceNumber || '').trim();
  if (!value) return null;
  const match = value.match(/^([A-Za-z]{0,5})[-\s]*(-?\d+)$/);
  if (!match) return null;
  const letraFolio = (match[1] || '').toUpperCase();
  const folio = Number(match[2]);
  if (!Number.isSafeInteger(folio)) return null;
  return { folio, letraFolio, full: `${letraFolio}${folio}` };
}

function isActiveAccountingInvoice(invoice = {}) {
  return !ACTIVE_EXCLUDED_STATUSES.has(normalizeText(invoice.status));
}

function inRange(invoice = {}, startDate, endDate) {
  const date = String(invoice.saleDate || invoice.date || '').substring(0, 10);
  return date >= startDate && date <= endDate;
}

async function fetchAccountingInvoices(db, startDate, endDate) {
  const snapshot = await db.collection('facturas_membretadas_ventas').get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, docId: doc.id, ...doc.data() }))
    .filter((invoice) => isActiveAccountingInvoice(invoice))
    .filter((invoice) => inRange(invoice, startDate, endDate))
    .filter((invoice) => getSourceFacId(invoice));
}

function buildPlans(accountingInvoices) {
  const grouped = new Map();
  accountingInvoices.forEach((invoice) => {
    const facId = getSourceFacId(invoice);
    if (!facId) return;
    const current = grouped.get(facId) || [];
    current.push(invoice);
    grouped.set(facId, current);
  });

  const plans = [];
  const conflicts = [];

  grouped.forEach((invoices, facId) => {
    const activeNumbers = [...new Set(invoices.map((invoice) => String(invoice.invoiceNumber || invoice.numeroFactura || '').trim()).filter(Boolean))];
    if (activeNumbers.length !== 1) {
      conflicts.push({
        facId,
        reason: 'multiple_accounting_numbers_for_same_sicar_invoice',
        accountingInvoiceIds: invoices.map((invoice) => invoice.id),
        accountingInvoiceNumbers: activeNumbers,
      });
      return;
    }

    const parsed = parseInvoiceNumber(activeNumbers[0]);
    if (!parsed) {
      conflicts.push({
        facId,
        reason: 'invalid_accounting_invoice_number_for_sicar_folio',
        accountingInvoiceIds: invoices.map((invoice) => invoice.id),
        accountingInvoiceNumber: activeNumbers[0],
      });
      return;
    }

    plans.push({
      facId,
      desiredFolio: parsed.folio,
      desiredLetraFolio: parsed.letraFolio,
      desiredInvoiceNumber: activeNumbers[0],
      accountingInvoiceIds: invoices.map((invoice) => invoice.id),
    });
  });

  const desiredFolioGroups = new Map();
  plans.forEach((plan) => {
    const current = desiredFolioGroups.get(plan.desiredFolio) || [];
    current.push(plan);
    desiredFolioGroups.set(plan.desiredFolio, current);
  });

  const duplicateDesiredFolios = new Set();
  desiredFolioGroups.forEach((items, folio) => {
    if (items.length > 1) {
      duplicateDesiredFolios.add(folio);
      conflicts.push({
        folio,
        reason: 'same_target_folio_requested_by_multiple_sicar_invoices',
        facIds: items.map((item) => item.facId),
        accountingInvoiceIds: items.flatMap((item) => item.accountingInvoiceIds),
      });
    }
  });

  return {
    plans: plans.filter((plan) => !duplicateDesiredFolios.has(plan.desiredFolio)),
    conflicts,
  };
}

async function fetchFacturaRows(connection, facIds, desiredFolios) {
  const ids = [...new Set(facIds.map(Number).filter(Number.isFinite))];
  const folios = [...new Set(desiredFolios.map(Number).filter(Number.isFinite))];
  const rowsByFacId = new Map();
  const rowsByFolio = new Map();

  if (ids.length) {
    const [rows] = await connection.execute(
      `SELECT fac_id, folio, letraFolio, fecha, total, status FROM factura WHERE fac_id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    rows.forEach((row) => rowsByFacId.set(Number(row.fac_id), row));
  }

  if (folios.length) {
    const [rows] = await connection.execute(
      `SELECT fac_id, folio, letraFolio, fecha, total, status FROM factura WHERE folio IN (${folios.map(() => '?').join(',')})`,
      folios
    );
    rows.forEach((row) => rowsByFolio.set(Number(row.folio), row));
  }

  return { rowsByFacId, rowsByFolio };
}

function classifyPlans(plans, rowsByFacId, rowsByFolio) {
    const mappedFacIds = new Set(plans.map((plan) => plan.facId));
    const safe = [];
    const skipped = [];

  plans.forEach((plan) => {
    const current = rowsByFacId.get(plan.facId);
    if (!current) {
      skipped.push({ ...plan, reason: 'sicar_factura_not_found' });
      return;
    }

    const occupant = rowsByFolio.get(plan.desiredFolio);
    if (occupant && Number(occupant.fac_id) !== plan.facId && !mappedFacIds.has(Number(occupant.fac_id))) {
      skipped.push({
        ...plan,
        reason: 'target_folio_used_by_unmapped_sicar_invoice',
        occupiedByFacId: Number(occupant.fac_id),
        occupiedByDate: toDateString(occupant.fecha),
        occupiedByTotal: Number(occupant.total || 0),
      });
      return;
    }

    safe.push({
      ...plan,
      currentFolio: Number(current.folio),
      currentLetraFolio: String(current.letraFolio || ''),
      currentDate: toDateString(current.fecha),
      currentTotal: Number(current.total || 0),
      needsUpdate: Number(current.folio) !== plan.desiredFolio || String(current.letraFolio || '').toUpperCase() !== plan.desiredLetraFolio,
    });
  });

    let changed = true;
    while (changed) {
      changed = false;
      const safeFacIds = new Set(safe.map((plan) => plan.facId));
      for (let index = safe.length - 1; index >= 0; index -= 1) {
        const plan = safe[index];
        const occupant = rowsByFolio.get(plan.desiredFolio);
        const occupantFacId = Number(occupant?.fac_id || 0);
        if (occupantFacId && occupantFacId !== plan.facId && mappedFacIds.has(occupantFacId) && !safeFacIds.has(occupantFacId)) {
          skipped.push({
            ...plan,
            reason: 'target_folio_blocked_by_skipped_sicar_invoice',
            occupiedByFacId: occupantFacId,
            occupiedByDate: toDateString(occupant.fecha),
            occupiedByTotal: Number(occupant.total || 0),
          });
          safe.splice(index, 1);
          changed = true;
        }
      }
    }

    return { safe, skipped };
}

async function ensureAuditTable(connection) {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS contabilidad_folio_sync_audit (
      audit_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      run_id VARCHAR(64) NOT NULL,
      fac_id BIGINT NOT NULL,
      old_folio BIGINT NULL,
      old_letra_folio VARCHAR(5) NULL,
      new_folio BIGINT NULL,
      new_letra_folio VARCHAR(5) NULL,
      accounting_invoice_ids TEXT NULL,
      status VARCHAR(32) NOT NULL,
      message TEXT NULL,
      created_at DATETIME NOT NULL
    )
  `);
}

async function applyPlans({ connection, db, safePlans, skipped, conflicts, runId }) {
  const FieldValue = admin.firestore.FieldValue;
  const updates = safePlans.filter((plan) => plan.needsUpdate);
  await ensureAuditTable(connection);
  await connection.beginTransaction();

  try {
    for (const plan of [...safePlans, ...skipped, ...conflicts]) {
      await connection.execute(`
        INSERT INTO contabilidad_folio_sync_audit
          (run_id, fac_id, old_folio, old_letra_folio, new_folio, new_letra_folio, accounting_invoice_ids, status, message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `, [
        runId,
        Number(plan.facId || 0),
        plan.currentFolio ?? null,
        plan.currentLetraFolio ?? null,
        plan.desiredFolio ?? null,
        plan.desiredLetraFolio ?? null,
        JSON.stringify(plan.accountingInvoiceIds || []),
        plan.needsUpdate ? 'pending_update' : (plan.reason ? 'skipped' : 'unchanged'),
        plan.reason || '',
      ]);
    }

    // Move the whole safe set first. Some unchanged rows can be occupying
    // a folio that another mapped SICAR invoice needs during a chain swap.
    for (const plan of safePlans) {
      const tempFolio = TEMP_FOLIO_BASE + Number(plan.facId);
      await connection.execute(
        'UPDATE factura SET folio = ?, letraFolio = ? WHERE fac_id = ?',
        [tempFolio, 'TMP', plan.facId]
      );
    }

    for (const plan of safePlans) {
      await connection.execute(
        'UPDATE factura SET folio = ?, letraFolio = ? WHERE fac_id = ?',
        [plan.desiredFolio, plan.desiredLetraFolio, plan.facId]
      );
    }

    for (const plan of updates) {
      await connection.execute(`
        INSERT INTO contabilidad_folio_sync_audit
          (run_id, fac_id, old_folio, old_letra_folio, new_folio, new_letra_folio, accounting_invoice_ids, status, message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `, [
        runId,
        plan.facId,
        plan.currentFolio,
        plan.currentLetraFolio,
        plan.desiredFolio,
        plan.desiredLetraFolio,
        JSON.stringify(plan.accountingInvoiceIds || []),
        'updated',
        '',
      ]);
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }

  if (updates.length) {
    const refreshed = await fetchStampedInvoicesByIds(connection, updates.map((plan) => plan.facId));
    for (const invoice of refreshed) {
      await writeInvoice(db, invoice, { stageOnly: false });
    }

    const batch = db.batch();
    updates.forEach((plan) => {
      plan.accountingInvoiceIds.forEach((invoiceId) => {
        batch.set(db.collection('facturas_membretadas_ventas').doc(invoiceId), {
          sourceSicarInvoiceNumber: plan.desiredInvoiceNumber,
          sicarFolioSyncedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });
    });
    await batch.commit();
  }

  return updates;
}

async function main() {
  const rootDir = path.resolve(__dirname, '..', '..');
  const functionsDir = path.resolve(__dirname, '..');
  loadEnvFile(path.join(rootDir, '.env.local'));
  loadEnvFile(path.join(functionsDir, '.env.local'));

  const options = parseArgs(process.argv.slice(2));
  const { startDate, endDate } = getDateRange(options);
  const runId = `folio-sync-${new Date().toISOString()}-${crypto.randomBytes(4).toString('hex')}`;
  const db = initFirebase();
  const connection = await mysql.createConnection(getMysqlConfig());

  try {
    const accountingInvoices = await fetchAccountingInvoices(db, startDate, endDate);
    const { plans, conflicts } = buildPlans(accountingInvoices);
    const { rowsByFacId, rowsByFolio } = await fetchFacturaRows(
      connection,
      plans.map((plan) => plan.facId),
      plans.map((plan) => plan.desiredFolio)
    );
    const { safe, skipped } = classifyPlans(plans, rowsByFacId, rowsByFolio);
    const updates = safe.filter((plan) => plan.needsUpdate);

    let applied = [];
    if (options.apply) {
      applied = await applyPlans({ connection, db, safePlans: safe, skipped, conflicts, runId });
    }

    console.log(JSON.stringify({
      ok: true,
      apply: options.apply,
      runId,
      startDate,
      endDate,
      accountingInvoiceCount: accountingInvoices.length,
      mappedSicarInvoiceCount: plans.length,
      safeCount: safe.length,
      unchangedCount: safe.filter((plan) => !plan.needsUpdate).length,
      updateCount: updates.length,
      appliedCount: applied.length,
      skippedCount: skipped.length,
      conflictCount: conflicts.length,
      updates: updates.map((plan) => ({
        facId: plan.facId,
        old: `${plan.currentLetraFolio || ''}${plan.currentFolio}`,
        next: plan.desiredInvoiceNumber,
        date: plan.currentDate,
        total: plan.currentTotal,
        accountingInvoiceIds: plan.accountingInvoiceIds,
      })),
      skipped,
      conflicts,
    }, null, 2));
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
