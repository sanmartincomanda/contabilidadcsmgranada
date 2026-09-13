const { initFirebase } = require('./syncSicarBilling');

const db = initFirebase();

const text = (value = '') => String(value ?? '').trim();
const normalize = (value = '') => text(value).toLowerCase();
const invoiceNumberOf = (invoice = {}) => text(invoice.invoiceNumber || invoice.numeroFactura);
const branchOf = (invoice = {}) => normalize(invoice.branchId || invoice.branch || invoice.sucursal || 'granada');
const seriesOf = (invoice = {}) => normalize(
  invoice.invoiceSeries
  || invoice.documentSeries
  || (branchOf(invoice) === 'nindiri' ? 'B' : 'A'),
);
const invoiceKeyOf = (invoice = {}) => (
  `invoice:${branchOf(invoice)}:${seriesOf(invoice)}:${normalize(invoiceNumberOf(invoice))}`
);

async function audit() {
  const [invoiceSnapshot, registrySnapshot, closureSnapshot] = await Promise.all([
    db.collection('facturas_membretadas_ventas').get(),
    db.collection('facturas_membretadas_numeros').get(),
    db.collection('cierres_caja').get(),
  ]);

  const invoices = invoiceSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
  const registries = registrySnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
  const closures = closureSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
  const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const registriesById = new Map(registries.map((registry) => [normalize(registry.id), registry]));
  const closuresById = new Map(closures.map((closure) => [closure.id, closure]));
  const invoiceGroups = new Map();

  invoices.filter((invoice) => invoiceNumberOf(invoice)).forEach((invoice) => {
    const key = invoiceKeyOf(invoice);
    const group = invoiceGroups.get(key) || [];
    group.push(invoice);
    invoiceGroups.set(key, group);
  });

  const duplicateNumbers = [...invoiceGroups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({
      key,
      records: group.map((invoice) => ({
        id: invoice.id,
        date: invoice.date || invoice.saleDate || '',
        status: invoice.status || '',
        customerName: invoice.customerName || '',
        total: Number(invoice.total || 0),
      })),
    }));

  const wrongRegistryOwners = invoices.filter((invoice) => {
    const registry = registriesById.get(invoiceKeyOf(invoice));
    return registry && text(registry.ownerDocumentId) !== invoice.id;
  }).map((invoice) => ({
    key: invoiceKeyOf(invoice),
    invoiceId: invoice.id,
    registryOwnerDocumentId: registriesById.get(invoiceKeyOf(invoice)).ownerDocumentId,
  }));

  const orphanRegistries = registries
    .filter((registry) => !invoicesById.has(text(registry.ownerDocumentId)))
    .map((registry) => ({
      id: registry.id,
      invoiceNumber: registry.invoiceNumber || '',
      ownerDocumentId: registry.ownerDocumentId || '',
    }));

  const staleRegistries = registries.filter((registry) => {
    const owner = invoicesById.get(text(registry.ownerDocumentId));
    return owner && normalize(registry.id) !== invoiceKeyOf(owner);
  }).map((registry) => {
    const owner = invoicesById.get(text(registry.ownerDocumentId));
    return {
      id: registry.id,
      ownerDocumentId: owner.id,
      reservedInvoiceNumber: registry.invoiceNumber || '',
      currentInvoiceNumber: invoiceNumberOf(owner),
    };
  });

  const closureMismatches = [];
  invoices.filter((invoice) => text(invoice.linkedCashClosureId)).forEach((invoice) => {
    const closure = closuresById.get(text(invoice.linkedCashClosureId));
    if (!closure) {
      closureMismatches.push({
        type: 'missing_closure',
        invoiceId: invoice.id,
        invoiceNumber: invoiceNumberOf(invoice),
        closureId: invoice.linkedCashClosureId,
      });
      return;
    }

    const invoiceIds = Array.isArray(closure.stampedInvoiceIds) ? closure.stampedInvoiceIds.map(text) : [];
    const snapshot = (Array.isArray(closure.stampedInvoices) ? closure.stampedInvoices : [])
      .find((item) => text(item.id || item.docId) === invoice.id);
    const numberMatches = snapshot && normalize(invoiceNumberOf(snapshot)) === normalize(invoiceNumberOf(invoice));
    const totalMatches = snapshot && Math.abs(Number(snapshot.total || 0) - Number(invoice.total || 0)) <= 0.01;

    if (!invoiceIds.includes(invoice.id) || !numberMatches || !totalMatches) {
      closureMismatches.push({
        type: 'closure_snapshot_mismatch',
        invoiceId: invoice.id,
        invoiceNumber: invoiceNumberOf(invoice),
        closureId: closure.id,
        closureStatus: closure.status || '',
        listed: invoiceIds.includes(invoice.id),
        snapshotInvoiceNumber: snapshot ? invoiceNumberOf(snapshot) : '',
        invoiceTotal: Number(invoice.total || 0),
        snapshotTotal: Number(snapshot?.total || 0),
      });
    }
  });

  const closureOrphans = [];
  closures.forEach((closure) => {
    (Array.isArray(closure.stampedInvoiceIds) ? closure.stampedInvoiceIds : [])
      .map(text)
      .filter(Boolean)
      .forEach((invoiceId) => {
        if (!invoicesById.has(invoiceId)) {
          closureOrphans.push({
            closureId: closure.id,
            date: closure.date || '',
            status: closure.status || '',
            invoiceId,
          });
        }
      });
  });

  return {
    generatedAt: new Date().toISOString(),
    mode: 'read-only',
    counts: {
      invoices: invoices.length,
      registries: registries.length,
      closures: closures.length,
    },
    findings: {
      duplicateNumbers,
      wrongRegistryOwners,
      orphanRegistries,
      staleRegistries,
      closureMismatches,
      closureOrphans,
    },
    findingCounts: {
      duplicateNumbers: duplicateNumbers.length,
      wrongRegistryOwners: wrongRegistryOwners.length,
      orphanRegistries: orphanRegistries.length,
      staleRegistries: staleRegistries.length,
      closureMismatches: closureMismatches.length,
      closureOrphans: closureOrphans.length,
    },
  };
}

audit()
  .then((report) => console.log(JSON.stringify(report, null, 2)))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

