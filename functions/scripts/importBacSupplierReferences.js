const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const admin = require('firebase-admin');

const PROJECT_ID = 'sistema-contable-csm-granada';
const PLAN_CODE = 'AR19';
const ORIGIN_ACCOUNT_CODE = '1102101';
const ORIGIN_ACCOUNT_NUMBER = '362843534';
const DEFAULT_SOURCE = 'C:\\Users\\Microsoft Windows 11\\Downloads\\Consulta de Referencias\\Consulta de Referencias.csv';
const DEFAULT_KEY = 'C:\\SICAR\\keys\\firebase-adminsdk.json';
const DEFAULT_BACKUP_DIR = 'C:\\SICAR\\backups\\bac-supplier-references';
const EXPECTED_ROWS = 58;
const EXPECTED_IDENTITIES = 55;

const TARGET_ALIASES = {
  'ACEITERA EL REAL S.A.': ['ACEITERA EL REAL S.A'],
  'INDUSTRIAL COMERCIAL SAN MARTIN,S.A': [
    'INDUSTRIAL COMERCIAL SAN MARTIN',
    'INDUSTRIAL COMERCIAL SAN MARTIN S.A',
    'INDUSTRIAL COMERCIAL SAN MARTIN, S.A',
    'INDUSTRIAL COMERCIAL SAN MARTIN SA',
  ],
  'BIMBO DE NICARAGUA SOCIEDAD ANONIMA': ['BIMBO', 'BIMBO DE NICARAGUA', 'BIMBO DE NICARAGUA S.A'],
  'DISTRIBUIDORA NACIONAL S.A.': ['DISTRIBUIDORA NACIONAL S.A'],
  'MELIDA MARIA AVILEZ SOSA': [
    'DISTRIBUIDORA MEDINA AVILEZ SOZA',
    'DISTRIUBIDORA MELIDA AVILEZ SOSA',
    'DISTRIBUIDORA MELIDA AVILEZ SOSA',
    'MELIDA AVILEZ SOSA',
  ],
  'ADELA VICENTINA GARCIA CAMPOS': ['ADELA GARCIA', 'ADELA VICENTINA GARCIA'],
  'URIEL ARGENAL CASTILLO': ['INDUSTRIAS ARGENAL', 'ARGENAL'],
  'AG SOFTWARE, S.A.': ['AG SOFTWARE', 'AG PLANILLA', 'AG SOFTWARE S.A'],
  'AMELA DABDUB IMPORTACIONES & COMPANIA LIMITAD': ['ADIM', 'AMELA DABDUB IMPORTACIONES'],
  'EMBALAJES Y PRODUCTOS AGROPECUARIOS DE NICARA': ['EMPROANIC', 'EMBALAJES Y PRODUCTOS AGROPECUARIOS'],
  'ETIQUETAS Y ROLLOS DE NICARAGUA SOCIEDAD ANON': ['ETIROLL', 'ETIQUETAS Y ROLLOS'],
  'PROCESADORA Y COMERCIALIZADORAIND. DE ALIMENT': [
    'PROCINSA',
    'PROCESADORA Y COMERCIALIZADORA IND. DE ALIMENTOS',
    'PROCESADORA Y COMERCIALIZADORAIND. DE ALIMENTOS',
  ],
  'JAVIER URIEL JAEN SOLORZANO': ['IMPRENTA JAEN', 'JAVIER JAEN'],
};

const normalize = (value = '') => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toUpperCase();

const providerDocId = (value = '') => normalize(value)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 140) || 'proveedor_sin_nombre';

const providerCode = (value = '') => {
  const normalized = normalize(value);
  let hashValue = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hashValue = ((hashValue * 31) + normalized.charCodeAt(index)) % 100000;
  }
  return `PRV-${String(hashValue || 1).padStart(5, '0')}`;
};

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function parseBacCsv(buffer) {
  const utf8 = new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, '');
  const windows1252 = new TextDecoder('windows-1252').decode(buffer).replace(/^\uFEFF/, '');
  const text = normalize(utf8).includes('IDENTIFICACION') ? utf8 : windows1252;
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const headerIndex = lines.findIndex((line) => normalize(line).startsWith('"REFERENCIA"'));
  if (headerIndex < 0) throw new Error('No se encontro la cabecera Referencia del CSV BAC.');
  const headers = parseCsvLine(lines[headerIndex]).map(normalize);
  const fieldIndex = (label) => headers.indexOf(normalize(label));
  const indexes = {
    reference: fieldIndex('Referencia'),
    bankAccount: fieldIndex('Cta. Bancaria'),
    legalName: fieldIndex('A nombre'),
    enrolledAt: fieldIndex('Fecha de Ingreso'),
    identification: fieldIndex('Identificacion'),
  };
  if (Object.values(indexes).some((index) => index < 0)) throw new Error('El CSV BAC no contiene todas las columnas requeridas.');

  return lines.slice(headerIndex + 1).map((line, rowIndex) => {
    const values = parseCsvLine(line);
    const reference = String(values[indexes.reference] || '').trim();
    const bankAccount = String(values[indexes.bankAccount] || '').trim();
    const legalName = String(values[indexes.legalName] || '').trim();
    const identification = String(values[indexes.identification] || '').trim();
    if (!reference || !/^[\x21-\x7e]{1,20}$/.test(reference)) throw new Error(`Referencia invalida en fila ${rowIndex + 1}.`);
    if (!/^\d{1,9}$/.test(bankAccount)) throw new Error(`Cuenta bancaria invalida en fila ${rowIndex + 1}.`);
    if (!legalName) throw new Error(`Nombre legal vacio en fila ${rowIndex + 1}.`);
    return {
      reference,
      bankAccount,
      legalName,
      enrolledAt: String(values[indexes.enrolledAt] || '').trim(),
      identification,
    };
  });
}

function validateCatalog(rows) {
  const identities = new Set(rows.map((row) => normalize(row.legalName)));
  const pairs = new Set(rows.map((row) => `${row.reference}|${row.bankAccount}`));
  if (rows.length !== EXPECTED_ROWS || identities.size !== EXPECTED_IDENTITIES) {
    throw new Error(`El CSV contiene ${rows.length} pares y ${identities.size} identidades; se esperaban ${EXPECTED_ROWS} y ${EXPECTED_IDENTITIES}.`);
  }
  if (pairs.size !== rows.length) throw new Error('El CSV contiene pares referencia/cuenta duplicados.');
  if (rows.some((row) => row.identification)) {
    throw new Error('La columna Identificacion ya no esta vacia. Revise el cambio antes de aplicar para no reemplazar RUC por error.');
  }
  return { rows: rows.length, identities: identities.size, pairs: pairs.size };
}

function providerNames(provider = {}) {
  return [
    provider.legalName,
    provider.nombre,
    provider.name,
    provider.supplier,
    provider.proveedor,
    ...(Array.isArray(provider.aliases) ? provider.aliases : []),
  ].map(normalize).filter(Boolean);
}

function providerTaxIds(provider = {}) {
  return [provider.ruc, provider.taxId, provider.tax_id, provider.identification, provider.identificacion]
    .map(normalize)
    .filter(Boolean);
}

function existingReferences(provider = {}) {
  const plan = provider.bacPaymentPlans?.[PLAN_CODE] || provider.bacPlans?.[PLAN_CODE] || {};
  return [
    ...(Array.isArray(plan.references) ? plan.references : []),
    ...(Array.isArray(provider.bacReferences) ? provider.bacReferences.filter((item) => !item.planCode || item.planCode === PLAN_CODE) : []),
  ].map((item) => ({
    reference: String(item.reference || item.beneficiaryReference || '').trim(),
    bankAccount: String(item.bankAccount || item.account || '').trim(),
    beneficiaryName: String(item.beneficiaryName || item.name || provider.legalName || provider.nombre || '').trim(),
    enrolledAt: String(item.enrolledAt || item.sourceEnrolledAt || '').trim(),
  })).filter((item) => item.reference && item.bankAccount);
}

function groupCatalog(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = normalize(row.legalName);
    if (!groups.has(key)) groups.set(key, { legalName: row.legalName, rows: [] });
    groups.get(key).rows.push(row);
  });
  return [...groups.values()].sort((left, right) => left.legalName.localeCompare(right.legalName, 'es'));
}

function buildImportPlan(rows, providers) {
  const groups = groupCatalog(rows);
  const claimedProviders = new Map();
  const conflicts = [];
  const actions = groups.map((group) => {
    const legalKey = normalize(group.legalName);
    const confirmedAliases = TARGET_ALIASES[group.legalName] || [];
    const acceptedNames = new Set([group.legalName, ...confirmedAliases].map(normalize));
    const deterministicId = providerDocId(group.legalName);
    const matches = providers.filter((provider) => (
      provider.id === deterministicId
      || providerNames(provider).some((name) => acceptedNames.has(name))
    ));

    matches.forEach((provider) => {
      const previous = claimedProviders.get(provider.id);
      if (previous && previous !== legalKey) conflicts.push(`Proveedor ${provider.id} coincide con ${previous} y ${legalKey}.`);
      claimedProviders.set(provider.id, legalKey);
    });

    const taxIds = [...new Set(matches.flatMap(providerTaxIds))];
    if (taxIds.length > 1) conflicts.push(`${group.legalName}: RUC/identificaciones contradictorios (${taxIds.join(', ')}).`);
    if (group.legalName === 'INDUSTRIAL COMERCIAL SAN MARTIN,S.A' && taxIds.some((taxId) => taxId !== 'J0310000005680')) {
      conflicts.push(`${group.legalName}: el RUC existente contradice el confirmado J0310000005680.`);
    }

    const exactMatches = matches.filter((provider) => providerNames(provider).includes(legalKey) && provider.active !== false);
    const expectedTaxMatch = group.legalName === 'INDUSTRIAL COMERCIAL SAN MARTIN,S.A'
      ? matches.find((provider) => providerTaxIds(provider).includes('J0310000005680'))
      : null;
    const canonical = exactMatches[0] || expectedTaxMatch || matches.find((provider) => provider.active !== false && !provider.mergedInto) || matches[0] || null;
    if (canonical?.mergedInto && !matches.some((provider) => provider.id === canonical.mergedInto)) {
      conflicts.push(`${group.legalName}: ${canonical.id} ya redirige a un proveedor fuera de esta equivalencia.`);
    }
    const canonicalId = canonical?.id || deterministicId;
    const duplicates = matches.filter((provider) => provider.id !== canonicalId);
    const aliases = [...new Set([
      group.legalName,
      ...confirmedAliases,
      ...matches.flatMap((provider) => [provider.legalName, provider.nombre, provider.name, ...(provider.aliases || [])]),
    ].map((value) => String(value || '').trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'es'));
    const references = new Map();
    [...matches.flatMap(existingReferences), ...group.rows.map((row) => ({
      reference: row.reference,
      bankAccount: row.bankAccount,
      beneficiaryName: group.legalName,
      enrolledAt: row.enrolledAt,
    }))].forEach((item) => references.set(`${item.reference}|${item.bankAccount}`, {
      reference: item.reference,
      bankAccount: item.bankAccount,
      beneficiaryName: group.legalName,
      enrolledAt: item.enrolledAt || '',
    }));

    return {
      legalName: group.legalName,
      canonicalId,
      canonical,
      matches,
      duplicates,
      aliases,
      references: [...references.values()].sort((left, right) => left.reference.localeCompare(right.reference)),
      action: canonical ? (duplicates.length ? 'merge' : 'update') : 'create',
      taxId: group.legalName === 'INDUSTRIAL COMERCIAL SAN MARTIN,S.A'
        ? 'J0310000005680'
        : taxIds[0] || '',
    };
  });

  return {
    actions,
    conflicts: [...new Set(conflicts)],
    summary: {
      identities: actions.length,
      creates: actions.filter((action) => action.action === 'create').length,
      updates: actions.filter((action) => action.action === 'update').length,
      merges: actions.filter((action) => action.action === 'merge').length,
      duplicateDocuments: actions.reduce((sum, action) => sum + action.duplicates.length, 0),
      references: actions.reduce((sum, action) => sum + action.references.length, 0),
      multipleReferences: actions.filter((action) => action.references.length > 1).length,
    },
  };
}

function stableValue(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return { __type: 'date', value: value.toISOString() };
  if (value?.toDate && typeof value.toDate === 'function') return { __type: 'timestamp', value: value.toDate().toISOString() };
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}

const stableJson = (value) => JSON.stringify(stableValue(value));

function getArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const argument = process.argv.find((item) => item.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

function initFirebase() {
  if (admin.apps.length) return admin.firestore();
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || DEFAULT_KEY;
  if (!fs.existsSync(keyPath)) throw new Error(`No existe la credencial Firebase: ${keyPath}`);
  const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  if (serviceAccount.project_id !== PROJECT_ID) throw new Error(`La credencial pertenece a ${serviceAccount.project_id}, no a ${PROJECT_ID}.`);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: PROJECT_ID });
  return admin.firestore();
}

async function loadCollection(db, collectionName) {
  const snapshot = await db.collection(collectionName).get();
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function writeInBatches(db, operations) {
  for (let index = 0; index < operations.length; index += 400) {
    const batch = db.batch();
    operations.slice(index, index + 400).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

async function createBackup(db, plan, sourceInfo, backupDir) {
  const runId = `ar19_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}_${sourceInfo.hash.slice(0, 8)}`;
  const providerIds = new Set(plan.actions.flatMap((action) => [action.canonicalId, ...action.duplicates.map((item) => item.id)]));
  const aliases = new Set(plan.actions.flatMap((action) => action.aliases.map(providerDocId)));
  const documents = [];

  for (const [collectionName, ids] of [['proveedores', providerIds], ['proveedores_aliases', aliases]]) {
    for (const id of ids) {
      const snapshot = await db.collection(collectionName).doc(id).get();
      const data = snapshot.exists ? snapshot.data() : null;
      documents.push({ collectionName, docId: id, existed: snapshot.exists, data, dataHash: sha256(stableJson(data)) });
    }
  }

  const manifest = {
    runId,
    projectId: PROJECT_ID,
    createdAt: new Date().toISOString(),
    source: sourceInfo,
    summary: plan.summary,
    relatedCollectionsNotMutated: ['compras', 'gastos', 'cuentas_por_pagar', 'abonos_pagar'],
    documentCount: documents.length,
    documents: documents.map((item) => ({ ...item, data: stableValue(item.data) })),
  };
  const manifestJson = JSON.stringify(manifest, null, 2);
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `${runId}.json`);
  fs.writeFileSync(backupPath, manifestJson, 'utf8');
  const diskHash = sha256(fs.readFileSync(backupPath));
  if (diskHash !== sha256(manifestJson)) throw new Error('La validacion del respaldo local fallo.');

  const backupRef = db.collection('bac_supplier_reference_backups').doc(runId);
  await backupRef.set({
    projectId: PROJECT_ID,
    planCode: PLAN_CODE,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    sourceHash: sourceInfo.hash,
    localPath: backupPath,
    localHash: diskHash,
    documentCount: documents.length,
    status: 'prepared',
  });
  await writeInBatches(db, documents.map((item, index) => (batch) => {
    batch.set(backupRef.collection('documents').doc(String(index + 1).padStart(4, '0')), item);
  }));

  const verifySnapshot = await backupRef.collection('documents').get();
  if (verifySnapshot.size !== documents.length) throw new Error('El respaldo Firestore no contiene todos los documentos esperados.');
  verifySnapshot.docs.forEach((snapshot) => {
    const item = snapshot.data();
    if (sha256(stableJson(item.data)) !== item.dataHash) throw new Error(`El respaldo Firestore fallo para ${item.collectionName}/${item.docId}.`);
  });
  await backupRef.set({ status: 'validated', validatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return { runId, backupPath, diskHash, backupRef };
}

async function applyPlan(db, plan, backup, sourceInfo) {
  if (plan.conflicts.length) throw new Error(`No se puede aplicar: ${plan.conflicts.join(' | ')}`);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const deleteField = admin.firestore.FieldValue.delete();
  const operations = [];

  plan.actions.forEach((action) => {
    const current = action.canonical || {};
    const code = current.code || current.codigo || providerCode(action.legalName);
    operations.push((batch) => batch.set(db.collection('proveedores').doc(action.canonicalId), {
      nombre: action.legalName,
      name: action.legalName,
      normalizedName: normalize(action.legalName),
      legalName: action.legalName,
      aliases: action.aliases,
      code,
      codigo: code,
      active: true,
      mergedInto: deleteField,
      source: current.source || 'bac-ar19-import',
      lastSource: 'bac-ar19-import',
      ...(action.taxId ? { ruc: current.ruc || action.taxId, taxId: current.taxId || action.taxId } : {}),
      bacPaymentPlans: {
        ...(current.bacPaymentPlans || {}),
        [PLAN_CODE]: {
          planCode: PLAN_CODE,
          originAccountCode: ORIGIN_ACCOUNT_CODE,
          originAccountNumber: ORIGIN_ACCOUNT_NUMBER,
          currency: 'NIO',
          references: action.references,
          sourceHash: sourceInfo.hash,
          updatedAt: new Date().toISOString(),
        },
      },
      hasBacReferenceAR19: action.references.length > 0,
      createdAt: current.createdAt || now,
      updatedAt: now,
    }, { merge: true }));

    action.duplicates.forEach((duplicate) => {
      operations.push((batch) => batch.set(db.collection('proveedores').doc(duplicate.id), {
        active: false,
        mergedInto: action.canonicalId,
        mergedLegalName: action.legalName,
        mergeReason: 'Equivalencia BAC AR19 confirmada',
        mergedAt: now,
        updatedAt: now,
      }, { merge: true }));
    });

    action.aliases.forEach((alias) => {
      operations.push((batch) => batch.set(db.collection('proveedores_aliases').doc(providerDocId(alias)), {
        alias,
        normalizedAlias: normalize(alias),
        canonicalProviderId: action.canonicalId,
        legalName: action.legalName,
        planCode: PLAN_CODE,
        sourceHash: sourceInfo.hash,
        updatedAt: now,
      }, { merge: true }));
    });
  });

  await writeInBatches(db, operations);
  const auditRef = db.collection('bac_supplier_reference_imports').doc(backup.runId);
  await auditRef.set({
    projectId: PROJECT_ID,
    planCode: PLAN_CODE,
    sourceHash: sourceInfo.hash,
    sourcePath: sourceInfo.path,
    backupRunId: backup.runId,
    backupHash: backup.diskHash,
    summary: plan.summary,
    conflicts: [],
    status: 'applied',
    appliedAt: now,
    affectedProviderIds: plan.actions.map((action) => action.canonicalId),
  });
  await backup.backupRef.set({ status: 'applied', appliedAt: now }, { merge: true });
  return auditRef.id;
}

async function rollbackRun(db, runId) {
  const backupRef = db.collection('bac_supplier_reference_backups').doc(runId);
  const header = await backupRef.get();
  if (!header.exists) throw new Error(`No existe el respaldo ${runId}.`);
  const snapshot = await backupRef.collection('documents').get();
  if (snapshot.size !== header.data().documentCount) throw new Error('El respaldo esta incompleto; no se ejecutara rollback.');
  const operations = snapshot.docs.map((item) => {
    const backup = item.data();
    return (batch) => {
      const ref = db.collection(backup.collectionName).doc(backup.docId);
      if (backup.existed) batch.set(ref, backup.data, { merge: false });
      else batch.delete(ref);
    };
  });
  await writeInBatches(db, operations);
  await backupRef.set({ status: 'rolled_back', rolledBackAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  await db.collection('bac_supplier_reference_imports').doc(runId).set({ status: 'rolled_back', rolledBackAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return snapshot.size;
}

async function main() {
  const db = initFirebase();
  const rollbackId = getArg('rollback-run');
  if (rollbackId) {
    const restored = await rollbackRun(db, rollbackId);
    console.log(JSON.stringify({ ok: true, mode: 'rollback', runId: rollbackId, restored }, null, 2));
    return;
  }

  const sourcePath = getArg('source', DEFAULT_SOURCE);
  if (!fs.existsSync(sourcePath)) throw new Error(`No existe el CSV BAC: ${sourcePath}`);
  const sourceBuffer = fs.readFileSync(sourcePath);
  const rows = parseBacCsv(sourceBuffer);
  const catalog = validateCatalog(rows);
  const providers = await loadCollection(db, 'proveedores');
  const plan = buildImportPlan(rows, providers);
  const sourceInfo = { path: sourcePath, hash: sha256(sourceBuffer), ...catalog };
  const preview = {
    projectId: PROJECT_ID,
    planCode: PLAN_CODE,
    source: sourceInfo,
    existingProviders: providers.length,
    summary: plan.summary,
    conflicts: plan.conflicts,
    actions: plan.actions.map((action) => ({
      action: action.action,
      legalName: action.legalName,
      canonicalId: action.canonicalId,
      matchedIds: action.matches.map((item) => item.id),
      mergedIds: action.duplicates.map((item) => item.id),
      aliases: action.aliases,
      references: action.references,
      taxIdPreserved: action.taxId || '',
    })),
  };

  const backupDir = getArg('backup-dir', DEFAULT_BACKUP_DIR);
  fs.mkdirSync(backupDir, { recursive: true });
  const previewPath = path.join(backupDir, `preview_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}_${sourceInfo.hash.slice(0, 8)}.json`);
  fs.writeFileSync(previewPath, JSON.stringify(preview, null, 2), 'utf8');
  console.log(JSON.stringify({ ...preview, actions: undefined, previewPath }, null, 2));

  if (!process.argv.includes('--apply')) return;
  if (getArg('confirm-project') !== PROJECT_ID) throw new Error(`Para aplicar agrega --confirm-project=${PROJECT_ID}.`);
  if (plan.conflicts.length) throw new Error('Hay conflictos. Revise la previsualizacion antes de aplicar.');
  const backup = await createBackup(db, plan, sourceInfo, backupDir);
  const auditId = await applyPlan(db, plan, backup, sourceInfo);
  console.log(JSON.stringify({ ok: true, mode: 'apply', auditId, backup: { runId: backup.runId, path: backup.backupPath, hash: backup.diskHash }, summary: plan.summary }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  TARGET_ALIASES,
  buildImportPlan,
  normalize,
  parseBacCsv,
  providerDocId,
  validateCatalog,
};
