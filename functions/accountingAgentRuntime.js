const { createHash, randomUUID } = require('node:crypto');
const {
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
  normalizePhone,
  normalizeText,
  parseConversationIntent,
  validateDraft,
} = require('./accountingAgent');

const COLLECTIONS = Object.freeze({
  events: 'whatsapp_eventos',
  inbox: 'whatsapp_inbox',
  drafts: 'agente_contable_borradores',
  authorizedUsers: 'agente_contable_usuarios',
  rules: 'agente_contable_reglas',
  audit: 'agente_contable_auditoria',
  settings: 'agente_contable_configuracion',
  files: 'agente_contable_archivos',
});

const ACTIVE_STATUSES = new Set([
  AGENT_STATUSES.RECEIVED,
  AGENT_STATUSES.PROCESSING,
  AGENT_STATUSES.NEEDS_INFORMATION,
  AGENT_STATUSES.READY_FOR_CONFIRMATION,
  AGENT_STATUSES.POSSIBLE_DUPLICATE,
  AGENT_STATUSES.CONFIRMED,
]);

let catalogCache = null;
let catalogCacheExpiresAt = 0;

const cleanForFirestore = (value) => {
  if (value === undefined) return null;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(cleanForFirestore);
  if (typeof value === 'object' && !Buffer.isBuffer(value)) {
    if (typeof value.toDate === 'function') return value;
    if (value.constructor?.name === 'FieldValue' || value._methodName) return value;
    return Object.entries(value).reduce((result, [key, entry]) => {
      if (entry !== undefined) result[key] = cleanForFirestore(entry);
      return result;
    }, {});
  }
  return value;
};

const normalizeProviderName = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\b(S A|SA|S R L|SRL|SOCIEDAD ANONIMA)\b/g, '')
  .replace(/[^a-zA-Z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ')
  .toUpperCase();

const normalizeRuc = (value = '') => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
const safeId = (value = '', fallback = 'sin_id') => String(value || fallback)
  .replace(/[^a-zA-Z0-9_-]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 140) || fallback;

const getMessageMedia = (message = {}) => {
  const type = ['image', 'document', 'audio', 'video'].find((candidate) => message[candidate]?.id);
  if (!type) return null;
  return {
    type,
    id: message[type].id,
    mimeType: message[type].mime_type || '',
    caption: message[type].caption || '',
    fileName: message[type].filename || '',
  };
};

const extensionFromMime = (mimeType = '') => {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'image/png') return 'png';
  return 'jpg';
};

const firebaseStorageUrl = (bucketName, path, token) => (
  `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`
);

const fetchWithRetry = async (url, options = {}, attempts = 3) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.ok || response.status < 500 || attempt === attempts) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** (attempt - 1))));
  }
  throw lastError || new Error('No se pudo completar la solicitud.');
};

const extractResponseText = (payload = {}) => {
  if (payload.output_text) return payload.output_text;
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) return content.text;
    }
  }
  return '';
};

const buildCategoryPayload = (category, subcategory) => ({
  categoryId: `${normalizeText(category).replace(/\s+/g, '-')}__${normalizeText(subcategory).replace(/\s+/g, '-')}`,
  category,
  categoria: category,
  subcategory,
  subcategoria: subcategory,
  expenseCategory: category,
  expenseSubcategory: subcategory,
  categoryLabel: `${category} / ${subcategory}`,
});

const buildBranchPayload = (branchId) => {
  const nindiri = branchId === 'nindiri';
  const branchName = nindiri ? 'CARNES SAN MARTIN NINDIRI' : 'CARNES SAN MARTIN GRANADA';
  const series = nindiri ? 'B' : 'A';
  return {
    branch: branchId,
    branchId,
    branchCode: nindiri ? 'CSM-NINDIRI' : 'CSM-GRANADA',
    branchName,
    sucursal: branchId,
    sucursalNombre: branchName,
    invoiceSeries: series,
    receiptSeries: series,
    documentSeries: series,
  };
};

const paymentAccount = (method = '') => {
  if (method === 'EFECTIVO') return { code: '11013', name: 'Activos Circulantes Caja:Caja Chica' };
  if (method.includes('BANPRO')) return { code: '1102102', name: 'BANCOS:MONEDA NACIONAL:BANPRO NO 10013500002893' };
  if (method.includes('LAFISE')) return { code: '1102103', name: 'BANCOS:MONEDA NACIONAL:LA FISE NO.106014315 C$' };
  if (method.includes('AMEX') || method.includes('PRICESMART')) return { code: '21029-1', name: 'Tarjeta de Credito - Mayor:Amex' };
  if (method.includes('TARJETA')) return { code: '21029-2', name: 'Tarjeta de Credito - Mayor:Banpro Black' };
  return { code: '1102101', name: 'BANCOS:MONEDA NACIONAL:BAC NO. 362843534 C$' };
};

const buildLedgerEntry = ({ draft, sourceCollection, sourceDocId, now }) => {
  const netPayment = money(draft.total - draft.totalRetenciones) || 0;
  const lines = [];
  const add = (accountCode, accountName, debit, credit, role) => {
    if (!debit && !credit) return;
    lines.push({
      lineId: `line_${String(lines.length + 1).padStart(2, '0')}`,
      accountCode,
      accountName,
      debit: money(debit) || 0,
      credit: money(credit) || 0,
      lineRole: role,
      description: draft.descripcion,
      reference: draft.numeroFactura,
    });
  };
  add(draft.accountingAccountCode, draft.accountingAccountName || draft.accountingAccountCode, draft.subtotal, 0, draft.tipoRegistro === 'compra' ? 'inventory_or_cost' : 'expense');
  add('110702', 'IMPUESTOS ACREDITABLES:IVA Acreditable', draft.iva, 0, 'iva_credit');
  const creditAccount = draft.metodoPago === 'CREDITO'
    ? { code: '2101', name: 'CUENTAS POR PAGAR - NIO' }
    : paymentAccount(draft.metodoPago);
  add(creditAccount.code, creditAccount.name, 0, netPayment, draft.metodoPago === 'CREDITO' ? 'accounts_payable' : 'payment');
  add('21041', 'IMPTOS CORRIENTES X PAGAR:Anticipo IR', 0, draft.retencionIr2, 'retention_ir_2');
  add('21043', 'IMPTOS CORRIENTES X PAGAR:Impuestos Municipales', 0, draft.retencionMunicipal1, 'retention_municipal_1');
  const totalDebit = money(lines.reduce((sum, line) => sum + line.debit, 0)) || 0;
  const totalCredit = money(lines.reduce((sum, line) => sum + line.credit, 0)) || 0;
  return {
    id: `${sourceCollection}_${sourceDocId}`,
    sourceCollection,
    sourceDocId,
    sourceType: draft.tipoRegistro,
    source: 'whatsapp_agent',
    status: Math.abs(totalDebit - totalCredit) <= 0.01 ? 'posted' : 'out_of_balance',
    requiresReview: Math.abs(totalDebit - totalCredit) > 0.01,
    accountingVersion: 1,
    date: draft.fecha,
    month: draft.fecha.substring(0, 7),
    ...buildBranchPayload(draft.branchId),
    documentNumber: draft.numeroFactura,
    partyName: draft.proveedor,
    description: draft.descripcion,
    totalDebit,
    totalCredit,
    difference: money(totalDebit - totalCredit) || 0,
    lines,
    createdAt: now,
    updatedAt: now,
  };
};

function createAccountingAgentRuntime({ admin, firestore, FieldValue, logger, config }) {
  const audit = async (eventType, payload = {}) => {
    await firestore.collection(COLLECTIONS.audit).add(cleanForFirestore({
      eventType,
      ...payload,
      createdAt: FieldValue.serverTimestamp(),
    }));
  };

  const sendWhatsappText = async ({ phoneNumberId, to, text, draftId = '' }) => {
    if (!phoneNumberId || !to || !text || !config.whatsappAccessToken()) return { skipped: true };
    const response = await fetchWithRetry(`https://graph.facebook.com/${config.graphVersion()}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.whatsappAccessToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Meta no pudo enviar la respuesta (${response.status}): ${body}`);
    await firestore.collection(COLLECTIONS.settings).doc('estado').set({
      lastSentAt: FieldValue.serverTimestamp(),
      lastSentPhone: to,
      lastSentDraftId: draftId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true };
  };

  const getAuthorizedUser = async (phone) => {
    const normalized = normalizePhone(phone);
    if (!normalized) return null;
    const snapshot = await firestore.collection(COLLECTIONS.authorizedUsers).doc(normalized).get();
    return snapshot.exists && snapshot.data()?.active !== false ? { id: snapshot.id, ...snapshot.data() } : null;
  };

  const storeMedia = async ({ message, media, phone, senderName }) => {
    if (!['image', 'document'].includes(media.type)) {
      throw new Error('Tipo de mensaje preparado para una fase posterior. Envia una imagen JPG/PNG o PDF.');
    }
    const token = config.whatsappAccessToken();
    const metadataResponse = await fetchWithRetry(`https://graph.facebook.com/${config.graphVersion()}/${media.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metadataResponse.ok) throw new Error(`No se pudo consultar media WhatsApp (${metadataResponse.status}).`);
    const metadata = await metadataResponse.json();
    const mimeType = String(metadata.mime_type || media.mimeType || '').toLowerCase();
    if (!ALLOWED_MEDIA_TYPES.includes(mimeType)) throw new Error(`Tipo de archivo no permitido: ${mimeType || 'desconocido'}.`);
    const downloadResponse = await fetchWithRetry(metadata.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!downloadResponse.ok) throw new Error(`No se pudo descargar media WhatsApp (${downloadResponse.status}).`);
    const buffer = Buffer.from(await downloadResponse.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_MEDIA_BYTES) throw new Error('El archivo esta vacio o supera el limite de 10 MB.');
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const messageId = safeId(message.id);
    const storagePath = `whatsapp/originales/${safeId(phone)}/${messageId}/${sha256}.${extensionFromMime(mimeType)}`;
    const bucket = admin.storage().bucket();
    const tokenId = randomUUID();
    const file = bucket.file(storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      await file.save(buffer, {
        resumable: false,
        metadata: {
          contentType: mimeType,
          metadata: {
            firebaseStorageDownloadTokens: tokenId,
            sha256,
            original: 'true',
            whatsappMediaId: media.id,
            whatsappMessageId: message.id,
            whatsappSenderPhone: phone,
            whatsappSenderName: senderName || '',
          },
        },
      });
    }
    return {
      type: 'invoice',
      role: 'invoice',
      source: 'whatsapp',
      url: firebaseStorageUrl(bucket.name, storagePath, tokenId),
      path: storagePath,
      mimeType,
      contentType: mimeType,
      fileName: media.fileName || `documento.${extensionFromMime(mimeType)}`,
      size: buffer.length,
      sha256,
      mediaId: media.id,
      buffer,
    };
  };

  const loadCatalogs = async () => {
    if (catalogCache && Date.now() < catalogCacheExpiresAt) return catalogCache;
    const [providersSnapshot, accountsSnapshot, rulesSnapshot] = await Promise.all([
      firestore.collection('proveedores').limit(1000).get(),
      firestore.collection('configuracion').doc('plan_cuentas_quickbooks').get(),
      firestore.collection(COLLECTIONS.rules).limit(500).get(),
    ]);
    catalogCache = {
      providers: providersSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      accounts: accountsSnapshot.exists ? (accountsSnapshot.data()?.accounts || []) : [],
      rules: rulesSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((rule) => rule.active !== false),
    };
    catalogCacheExpiresAt = Date.now() + 60_000;
    return catalogCache;
  };

  const matchProvider = (analysis, providers) => {
    const ruc = normalizeRuc(analysis.rucProveedor);
    const name = normalizeProviderName(analysis.proveedor);
    const byRuc = ruc ? providers.filter((provider) => normalizeRuc(provider.ruc || provider.taxId || provider.rfc) === ruc) : [];
    if (byRuc.length === 1) return { provider: byRuc[0], ambiguous: false };
    const byName = name ? providers.filter((provider) => {
      const names = [provider.nombre, provider.name, provider.supplier, ...(provider.aliases || [])].map(normalizeProviderName);
      return names.includes(name);
    }) : [];
    if (byName.length === 1) return { provider: byName[0], ambiguous: false };
    const contains = name ? providers.filter((provider) => {
      const candidate = normalizeProviderName(provider.nombre || provider.name);
      return candidate && (candidate.includes(name) || name.includes(candidate));
    }) : [];
    if (contains.length === 1) return { provider: contains[0], ambiguous: false };
    return { provider: null, ambiguous: byRuc.length > 1 || byName.length > 1 || contains.length > 1 };
  };

  const matchAccount = (analysis, accounts) => {
    const requested = normalizeText(analysis.accountingAccountId || analysis.accountingAccountCode);
    let account = accounts.find((candidate) => {
      const id = normalizeText(candidate.id || candidate.number || candidate.code);
      return requested && id === requested;
    });
    if (!account) {
      const fallbackCode = analysis.tipoRegistro === 'compra' ? '11060' : '5';
      account = accounts.find((candidate) => String(candidate.number || candidate.code || '') === fallbackCode);
    }
    if (!account || account.locked === true) return null;
    const accountType = normalizeText(account.type || account.accountType || '');
    const compatible = analysis.tipoRegistro === 'compra'
      ? ['activo', 'inventario', 'costo', 'gasto'].some((key) => accountType.includes(key))
      : ['gasto', 'costo'].some((key) => accountType.includes(key));
    return compatible ? account : null;
  };

  const applyApprovedRules = (analysis, rules) => {
    const providerKey = normalizeProviderName(analysis.proveedor);
    const matching = rules
      .filter((rule) => rule.active !== false)
      .filter((rule) => !rule.branchId || rule.branchId === analysis.branchId)
      .filter((rule) => (rule.providerId && rule.providerId === analysis.providerId)
        || (providerKey && normalizeProviderName(rule.provider || rule.normalizedProvider) === providerKey))
      .sort((left, right) => Number(left.priority || 100) - Number(right.priority || 100));
    const rule = matching[0];
    if (!rule) return analysis;
    const category = findCategory(rule.category, rule.subcategory);
    if (!category) return analysis;
    return {
      ...analysis,
      tipoRegistro: ['compra', 'gasto'].includes(rule.type) ? rule.type : analysis.tipoRegistro,
      categoria: category.category,
      subcategoria: category.subcategory,
      appliedRuleIds: [...new Set([...(analysis.appliedRuleIds || []), rule.id])],
    };
  };

  const findDuplicates = async (draft) => {
    const collectionName = draft.tipoRegistro === 'compra' ? 'compras' : 'gastos';
    let records = [];
    if (draft.numeroFactura) {
      const [invoiceSnapshot, legacySnapshot] = await Promise.all([
        firestore.collection(collectionName).where('invoiceNumber', '==', draft.numeroFactura).limit(25).get(),
        firestore.collection(collectionName).where('factura', '==', draft.numeroFactura).limit(25).get(),
      ]);
      records = [...invoiceSnapshot.docs, ...legacySnapshot.docs];
    } else {
      const [dateSnapshot, legacyDateSnapshot] = await Promise.all([
        firestore.collection(collectionName).where('date', '==', draft.fecha).limit(50).get(),
        firestore.collection(collectionName).where('fecha', '==', draft.fecha).limit(50).get(),
      ]);
      records = [...dateSnapshot.docs, ...legacyDateSnapshot.docs];
    }
    const unique = new Map(records.map((record) => [record.id, { id: record.id, ...record.data() }]));
    return [...unique.values()].filter((record) => {
      const sameBranch = (record.branchId || record.branch || 'granada') === draft.branchId;
      const sameProvider = draft.providerId
        ? (record.providerId || record.proveedorId) === draft.providerId
        : normalizeProviderName(record.supplier || record.proveedor) === normalizeProviderName(draft.proveedor);
      const sameDate = (record.date || record.fecha) === draft.fecha;
      const sameTotal = Math.abs(Number(record.total || record.monto || 0) - Number(draft.total || 0)) <= 0.02;
      return sameBranch && sameProvider && sameDate && sameTotal;
    }).map((record) => ({ id: record.id, collection: collectionName, invoiceNumber: record.invoiceNumber || record.factura || '', total: Number(record.total || record.monto || 0) }));
  };

  const callOpenAi = async ({ text, support, catalogs, currentDraft = null }) => {
    const apiKey = config.openAiKey();
    if (!apiKey) throw new Error('OPENAI_API_KEY no esta configurada.');
    const categories = CATEGORY_TREE.map(([category, subcategories]) => `${category}: ${subcategories.join(', ')}`).join('\n');
    const providerCatalog = catalogs.providers.slice(0, 800).map((provider) => ({
      id: provider.id,
      code: provider.code || provider.codigo || '',
      name: provider.nombre || provider.name || '',
      ruc: provider.ruc || provider.taxId || '',
      aliases: provider.aliases || [],
    }));
    const accountCatalog = catalogs.accounts.filter((account) => account.locked !== true).map((account) => ({
      id: account.id || account.number || account.code || '',
      code: account.number || account.code || '',
      name: account.name || '',
      type: account.type || '',
    }));
    const prompt = [
      'Eres el analizador fiscal del sistema contable Carnes San Martin.',
      'Devuelve exclusivamente el JSON del schema. No inventes ningun dato.',
      'Primero clasifica compra (mercancia vendible/inventario) o gasto (operacion/servicio).',
      'El numero de factura vacio se conserva vacio. La fecha es la impresa, no la recepcion.',
      'Granada=branchId granada, Serie A. Nindiri=branchId nindiri, Serie B.',
      'Solo usa proveedores y cuentas existentes. Si no hay coincidencia, deja sus IDs vacios y pregunta.',
      'Solo aplica retenciones si existe soporte o confirmacion explicita.',
      `Metodos permitidos: ${PAYMENT_METHODS.join(', ')}.`,
      `Categorias exactas:\n${categories}`,
      `Reglas fijas: ${FIXED_PURCHASE_RULES.map(([provider, subcategory]) => `${provider} -> compra / ${subcategory}`).join('; ')}.`,
      `Proveedores: ${JSON.stringify(providerCatalog)}`,
      `Plan de cuentas: ${JSON.stringify(accountCatalog)}`,
      `Reglas aprobadas: ${JSON.stringify(catalogs.rules.slice(0, 200))}`,
      currentDraft ? `Borrador actual a corregir: ${JSON.stringify(currentDraft)}` : '',
      `Mensaje del usuario: ${text || '(sin texto)'}`,
    ].filter(Boolean).join('\n\n');
    const content = [{ type: 'input_text', text: prompt }];
    if (support?.buffer && support.mimeType?.startsWith('image/')) {
      content.push({ type: 'input_image', image_url: `data:${support.mimeType};base64,${support.buffer.toString('base64')}` });
    } else if (support?.buffer && support.mimeType === 'application/pdf') {
      content.push({ type: 'input_file', filename: support.fileName || 'documento.pdf', file_data: `data:application/pdf;base64,${support.buffer.toString('base64')}` });
    }
    const response = await fetchWithRetry('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.openAiModel(),
        input: [{ role: 'user', content }],
        text: { format: { type: 'json_schema', name: 'accounting_document', strict: true, schema: jsonSchema } },
      }),
    }, 2);
    const body = await response.text();
    if (!response.ok) throw new Error(`OpenAI respondio ${response.status}: ${body.slice(0, 500)}`);
    const payload = JSON.parse(body);
    const outputText = extractResponseText(payload);
    if (!outputText) throw new Error('OpenAI no devolvio un resultado estructurado.');
    return { analysis: JSON.parse(outputText), responseId: payload.id || '', rawStatus: payload.status || '' };
  };

  const prepareDraft = async ({ draftId, inbox, text, support, currentDraft = null }) => {
    const catalogs = await loadCatalogs();
    const ai = await callOpenAi({ text, support, catalogs, currentDraft });
    const inferredSupportType = ['invoice', 'retentionIr2', 'retentionMunicipal1'].includes(ai.analysis?.soportes?.[0]?.type)
      ? ai.analysis.soportes[0].type
      : 'invoice';
    const normalizedSupport = support ? { ...support, type: inferredSupportType, role: inferredSupportType, buffer: undefined } : null;
    let proposed = normalizeDraft({ ...ai.analysis, soportes: normalizedSupport ? [normalizedSupport] : (currentDraft?.soportes || []) });
    const providerMatch = matchProvider(proposed, catalogs.providers);
    if (providerMatch.provider) {
      proposed = {
        ...proposed,
        providerId: providerMatch.provider.id,
        providerCode: providerMatch.provider.code || providerMatch.provider.codigo || '',
        proveedor: providerMatch.provider.nombre || providerMatch.provider.name || proposed.proveedor,
        rucProveedor: providerMatch.provider.ruc || providerMatch.provider.taxId || proposed.rucProveedor,
      };
    } else {
      proposed.providerId = '';
      proposed.providerCode = '';
      if (providerMatch.ambiguous) proposed.alertas.push('Hay varios proveedores posibles; requiere seleccion manual.');
      else if (proposed.proveedor) proposed.alertas.push('Proveedor no encontrado. Su creacion requiere confirmacion humana.');
    }

    if (!currentDraft && normalizedSupport && inferredSupportType !== 'invoice') {
      const pendingDrafts = await activeDraftsForPhone(inbox.senderPhone);
      const candidates = pendingDrafts.filter((candidate) => {
        const invoiceMatches = proposed.numeroFactura && candidate.numeroFactura
          && normalizeText(proposed.numeroFactura) === normalizeText(candidate.numeroFactura);
        const providerMatches = proposed.providerId && candidate.providerId && proposed.providerId === candidate.providerId;
        const contextualMatch = providerMatches && proposed.fecha && candidate.fecha === proposed.fecha;
        return invoiceMatches || contextualMatch;
      });
      if (candidates.length === 1) {
        const target = candidates[0];
        const mergedSupports = [...(target.soportes || []).filter((item) => item.sha256 !== normalizedSupport.sha256), normalizedSupport];
        const merged = {
          ...target,
          soportes: mergedSupports,
          retencionIr2: inferredSupportType === 'retentionIr2'
            ? (money(proposed.retencionIr2) ?? money(ai.analysis?.soportes?.[0]?.amount) ?? target.retencionIr2 ?? 0)
            : target.retencionIr2,
          retencionMunicipal1: inferredSupportType === 'retentionMunicipal1'
            ? (money(proposed.retencionMunicipal1) ?? money(ai.analysis?.soportes?.[0]?.amount) ?? target.retencionMunicipal1 ?? 0)
            : target.retencionMunicipal1,
          confianza: Math.max(Number(target.confianza) || 0, Number(proposed.confianza) || 0),
        };
        const duplicates = await findDuplicates(merged);
        const validated = validateDraft(merged, {
          duplicateCandidates: target.duplicateOverrideConfirmed === true ? [] : duplicates,
          allowWithoutSupport: target.sinSoporteFiscal === true && target.withoutSupportConfirmed === true,
          retentionIrConfirmed: target.retentionIrConfirmed === true,
          retentionMunicipalConfirmed: target.retentionMunicipalConfirmed === true,
        });
        await firestore.collection(COLLECTIONS.drafts).doc(target.id).set({
          ...cleanForFirestore(validated),
          updatedAt: FieldValue.serverTimestamp(),
          lastSupportInboxId: inbox.messageId,
        }, { merge: true });
        await firestore.collection(COLLECTIONS.inbox).doc(inbox.messageId).set({
          status: validated.status,
          draftId: target.id,
          linkedAsSupport: inferredSupportType,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        await audit('RETENTION_SUPPORT_LINKED', { draftId: target.id, inboxId: inbox.messageId, senderPhone: inbox.senderPhone, supportType: inferredSupportType, sha256: normalizedSupport.sha256 });
        const reply = validated.status === AGENT_STATUSES.READY_FOR_CONFIRMATION ? buildConfirmationSummary(validated) : validated.pregunta;
        await sendWhatsappText({ phoneNumberId: inbox.phoneNumberId, to: inbox.senderPhone, text: `Soporte ${inferredSupportType === 'retentionIr2' ? 'IR 2%' : 'municipal 1%'} vinculado a la factura ${target.numeroFactura || '(sin numero)'}.\n\n${reply}`, draftId: target.id });
        return { ...target, ...validated, draftId: target.id };
      }
      if (candidates.length > 1) proposed.alertas.push('La retencion coincide con varios borradores. Selecciona la factura desde la app.');
      else proposed.alertas.push('No encontre una factura pendiente unica para vincular esta retencion.');
    }
    proposed = applyApprovedRules(proposed, catalogs.rules);
    const account = matchAccount(proposed, catalogs.accounts);
    if (account) {
      proposed.accountingAccountId = account.id || account.number || account.code;
      proposed.accountingAccountCode = account.number || account.code || '';
      proposed.accountingAccountName = account.name || '';
      proposed.accountingAccountType = account.type || '';
    } else {
      proposed.accountingAccountId = '';
      proposed.accountingAccountCode = '';
    }
    const duplicates = await findDuplicates(proposed);
    if (inbox.duplicateSupport) duplicates.push(inbox.duplicateSupport);
    const validated = validateDraft(proposed, {
      duplicateCandidates: duplicates,
      allowWithoutSupport: currentDraft?.sinSoporteFiscal === true,
      retentionIrConfirmed: currentDraft?.retentionIrConfirmed === true,
      retentionMunicipalConfirmed: currentDraft?.retentionMunicipalConfirmed === true,
    });
    const now = FieldValue.serverTimestamp();
    const draftPayload = cleanForFirestore({
      ...currentDraft,
      ...validated,
      draftId,
      inboxId: inbox.messageId,
      senderPhone: inbox.senderPhone,
      senderName: inbox.senderName,
      authorizedUserId: inbox.authorizedUserId,
      phoneNumberId: inbox.phoneNumberId,
      source: 'whatsapp',
      aiResponseId: ai.responseId,
      originalAiAnalysis: ai.analysis,
      lastQuestion: validated.pregunta,
      updatedAt: now,
      createdAt: currentDraft?.createdAt || now,
    });
    await firestore.collection(COLLECTIONS.drafts).doc(draftId).set(draftPayload, { merge: true });
    await firestore.collection(COLLECTIONS.settings).doc('estado').set({
      aiHealthy: true,
      lastAiAt: FieldValue.serverTimestamp(),
      lastAiDraftId: draftId,
      processorHealthy: true,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await firestore.collection(COLLECTIONS.inbox).doc(inbox.messageId).set({
      status: validated.status,
      draftId,
      targetType: validated.tipoRegistro || 'unknown',
      provider: validated.proveedor,
      invoiceNumber: validated.numeroFactura,
      branchId: validated.branchId,
      total: validated.total,
      category: validated.categoria,
      subcategory: validated.subcategoria,
      updatedAt: now,
    }, { merge: true });
    await audit('AI_ANALYSIS_COMPLETED', { draftId, inboxId: inbox.messageId, senderPhone: inbox.senderPhone, status: validated.status, aiResponseId: ai.responseId, missing: validated.datosFaltantes, duplicateCandidates: duplicates });
    const reply = validated.status === AGENT_STATUSES.READY_FOR_CONFIRMATION
      ? buildConfirmationSummary(validated)
      : validated.status === AGENT_STATUSES.POSSIBLE_DUPLICATE
        ? `Encontre un posible duplicado de la factura ${validated.numeroFactura || '(sin numero)'}. Revisalo en Agente Contable IA antes de registrar.`
        : validated.pregunta;
    await sendWhatsappText({ phoneNumberId: inbox.phoneNumberId, to: inbox.senderPhone, text: reply, draftId });
    return draftPayload;
  };

  const activeDraftsForPhone = async (phone) => {
    const snapshot = await firestore.collection(COLLECTIONS.drafts).where('senderPhone', '==', phone).limit(20).get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((draft) => ACTIVE_STATUSES.has(draft.status));
  };

  const registerDraft = async ({ draftId, actor = {}, origin = 'app' }) => {
    const draftRef = firestore.collection(COLLECTIONS.drafts).doc(draftId);
    const targetId = `agente_${safeId(draftId)}`;
    const preflightSnapshot = await draftRef.get();
    if (!preflightSnapshot.exists) throw new Error('Borrador no encontrado.');
    const preflightDraft = preflightSnapshot.data();
    if (preflightDraft.status !== AGENT_STATUSES.REGISTERED) {
      const freshDuplicates = await findDuplicates(preflightDraft);
      if (freshDuplicates.length && preflightDraft.duplicateOverrideConfirmed !== true) {
        await draftRef.set({
          status: AGENT_STATUSES.POSSIBLE_DUPLICATE,
          accion: 'duplicado',
          duplicateCandidates: freshDuplicates,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        throw new Error('Se encontro un posible duplicado nuevo. Debes revisarlo antes de registrar.');
      }
    }
    const result = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(draftRef);
      if (!snapshot.exists) throw new Error('Borrador no encontrado.');
      const draft = snapshot.data();
      if (draft.status === AGENT_STATUSES.REGISTERED && draft.finalRecordId) {
        return { alreadyRegistered: true, recordId: draft.finalRecordId, collection: draft.finalCollection };
      }
      const validated = validateDraft(draft, {
        allowWithoutSupport: draft.sinSoporteFiscal === true && draft.withoutSupportConfirmed === true,
        retentionIrConfirmed: draft.retentionIrConfirmed === true,
        retentionMunicipalConfirmed: draft.retentionMunicipalConfirmed === true,
      });
      if (validated.status !== AGENT_STATUSES.READY_FOR_CONFIRMATION) {
        throw new Error(validated.pregunta || 'El borrador no cumple todas las validaciones.');
      }
      const providerRef = firestore.collection('proveedores').doc(draft.providerId);
      const providerSnapshot = await transaction.get(providerRef);
      if (!providerSnapshot.exists) throw new Error('El proveedor seleccionado ya no existe.');
      const targetCollection = draft.tipoRegistro === 'compra' ? 'compras' : 'gastos';
      const targetRef = firestore.collection(targetCollection).doc(targetId);
      const targetSnapshot = await transaction.get(targetRef);
      if (targetSnapshot.exists) {
        transaction.set(draftRef, { status: AGENT_STATUSES.REGISTERED, finalCollection: targetCollection, finalRecordId: targetId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return { alreadyRegistered: true, recordId: targetId, collection: targetCollection };
      }
      const now = FieldValue.serverTimestamp();
      const branch = buildBranchPayload(draft.branchId);
      const category = buildCategoryPayload(draft.categoria, draft.subcategoria);
      const support = draft.soportes?.find((item) => item.type === 'invoice' || item.role === 'invoice') || draft.soportes?.[0] || {};
      const fiscal = {
        subtotal: money(draft.subtotal) || 0,
        iva: money(draft.iva) || 0,
        total: money(draft.total) || 0,
        amount: money(draft.subtotal) || 0,
        retentionIr2: money(draft.retencionIr2) || 0,
        retencionIr2: money(draft.retencionIr2) || 0,
        retentionMunicipal1: money(draft.retencionMunicipal1) || 0,
        retencionMunicipal1: money(draft.retencionMunicipal1) || 0,
        retentionTotal: money(draft.totalRetenciones) || 0,
        netTotal: money(draft.pagoNeto) || 0,
      };
      const supportPayload = {
        supportFiles: draft.soportes || [],
        fotoFacturaUrl: support.url || '',
        fotoFacturaPath: support.path || '',
        support: support.url ? support : null,
      };
      const base = cleanForFirestore({
        date: draft.fecha,
        month: draft.fecha.substring(0, 7),
        supplier: draft.proveedor,
        proveedor: draft.proveedor,
        providerId: draft.providerId,
        proveedorId: draft.providerId,
        providerCode: draft.providerCode,
        codigoProveedor: draft.providerCode,
        invoiceNumber: draft.numeroFactura || '',
        description: draft.descripcion,
        ...category,
        accountingAccountId: draft.accountingAccountId,
        accountingAccountCode: draft.accountingAccountCode,
        accountingAccountName: draft.accountingAccountName || '',
        accountingAccountType: draft.accountingAccountType || '',
        accountingAccountSource: 'quickbooks_chart',
        paymentType: draft.metodoPago,
        paymentReference: draft.referenciaPago,
        ...fiscal,
        ...supportPayload,
        ...branch,
        source: 'whatsapp_agent',
        sourceDraftId: draftId,
        sourceInboxId: draft.inboxId,
        timestamp: now,
        createdAt: now,
        updatedAt: now,
        isInventoryCost: draft.tipoRegistro === 'compra',
        isOperatingExpense: draft.tipoRegistro === 'gasto',
        is_conciled: false,
      });
      let accountingRecord = base;
      if (draft.metodoPago === 'CREDITO') {
        const payableRef = firestore.collection('cuentas_por_pagar').doc(`agente_cxp_${safeId(draftId)}`);
        accountingRecord = { ...base, linkedPayableId: payableRef.id, sourceFacturaId: payableRef.id };
        transaction.set(payableRef, cleanForFirestore({
          fecha: draft.fecha,
          date: draft.fecha,
          month: draft.fecha.substring(0, 7),
          proveedor: draft.proveedor,
          supplier: draft.proveedor,
          proveedorId: draft.providerId,
          providerId: draft.providerId,
          providerCode: draft.providerCode,
          codigoProveedor: draft.providerCode,
          numero: draft.numeroFactura || '',
          factura: draft.numeroFactura || '',
          invoiceNumber: draft.numeroFactura || '',
          vencimiento: draft.vencimiento,
          descripcion: draft.descripcion,
          monto: fiscal.total,
          saldo: fiscal.total,
          estado: 'pendiente',
          paymentType: 'credito',
          paymentReference: draft.referenciaPago,
          ...category,
          ...fiscal,
          ...supportPayload,
          ...branch,
          linkedPurchaseId: draft.tipoRegistro === 'compra' ? targetId : '',
          linkedExpenseId: draft.tipoRegistro === 'gasto' ? targetId : '',
          sourceCollection: targetCollection,
          sourceFacturaId: targetId,
          sourceDraftId: draftId,
          createdAt: now,
          updatedAt: now,
          timestamp: now,
        }));
      } else if (draft.metodoPago === 'EFECTIVO') {
        const cashId = `agente_caja_${safeId(draftId)}`;
        const cashRef = firestore.collection('gastosDiarios').doc(cashId);
        accountingRecord = { ...base, linkedCashExpenseId: cashId, sourceGastoDiarioId: cashId };
        transaction.set(cashRef, cleanForFirestore({
          fecha: draft.fecha,
          date: draft.fecha,
          month: draft.fecha.substring(0, 7),
          tipo: draft.tipoRegistro === 'compra' ? 'Compra' : 'Gasto',
          descripcion: draft.descripcion,
          proveedor: draft.proveedor,
          supplier: draft.proveedor,
          providerId: draft.providerId,
          proveedorId: draft.providerId,
          factura: draft.numeroFactura || '',
          invoiceNumber: draft.numeroFactura || '',
          monto: fiscal.total,
          ...category,
          paymentType: draft.metodoPago,
          paymentReference: draft.referenciaPago,
          ...fiscal,
          ...supportPayload,
          ...branch,
          linkedPurchaseId: draft.tipoRegistro === 'compra' ? targetId : '',
          linkedExpenseId: draft.tipoRegistro === 'gasto' ? targetId : '',
          sourceCollection: targetCollection,
          sourceDraftId: draftId,
          timestamp: now,
          is_conciled: false,
        }));
        const cashPaid = money(fiscal.total - fiscal.retentionTotal) || 0;
        transaction.set(firestore.collection('caja_chica_movimientos').doc(`salida_gastosDiarios_${cashId}`), cleanForFirestore({
          ...branch,
          cashboxName: draft.branchId === 'nindiri' ? 'CAJA NINDIRI' : 'CAJA 2',
          caja: draft.branchId === 'nindiri' ? 'CAJA NINDIRI' : 'CAJA 2',
          movementType: 'salida',
          direction: 'salida',
          fecha: draft.fecha,
          date: draft.fecha,
          month: draft.fecha.substring(0, 7),
          amount: cashPaid,
          monto: cashPaid,
          signedAmount: -cashPaid,
          accountingTotal: fiscal.total,
          cashPaidAmount: cashPaid,
          retentionIr2: fiscal.retentionIr2,
          retentionMunicipal1: fiscal.retentionMunicipal1,
          retentionTotal: fiscal.retentionTotal,
          paymentType: 'EFECTIVO',
          description: draft.descripcion,
          descripcion: draft.descripcion,
          sourceCollection: 'gastosDiarios',
          sourceDocId: cashId,
          linkedGastoDiarioId: cashId,
          linkedPurchaseId: draft.tipoRegistro === 'compra' ? targetId : '',
          linkedExpenseId: draft.tipoRegistro === 'gasto' ? targetId : '',
          supplier: draft.proveedor,
          proveedor: draft.proveedor,
          invoiceNumber: draft.numeroFactura || '',
          factura: draft.numeroFactura || '',
          ...category,
          ...supportPayload,
          createdAt: now,
          updatedAt: now,
          timestamp: now,
        }));
      }
      transaction.set(targetRef, accountingRecord);
      transaction.set(firestore.collection('asientos_contables').doc(`${targetCollection}_${targetId}`), buildLedgerEntry({ draft: { ...draft, ...accountingRecord }, sourceCollection: targetCollection, sourceDocId: targetId, now }));
      transaction.set(firestore.collection('agente_contable_duplicados').doc(createHash('sha256').update([draft.branchId, draft.providerId, draft.numeroFactura, draft.fecha, draft.total].join('|')).digest('hex')), {
        draftId,
        sourceCollection: targetCollection,
        sourceDocId: targetId,
        createdAt: now,
      });
      transaction.set(draftRef, cleanForFirestore({
        status: AGENT_STATUSES.REGISTERED,
        finalCollection: targetCollection,
        finalRecordId: targetId,
        registeredBy: actor,
        registeredFrom: origin,
        registeredAt: now,
        updatedAt: now,
      }), { merge: true });
      if (draft.inboxId) transaction.set(firestore.collection(COLLECTIONS.inbox).doc(draft.inboxId), { status: AGENT_STATUSES.REGISTERED, finalCollection: targetCollection, finalRecordId: targetId, updatedAt: now }, { merge: true });
      return { recordId: targetId, collection: targetCollection, alreadyRegistered: false, phoneNumberId: draft.phoneNumberId, senderPhone: draft.senderPhone };
    });
    await audit('FINAL_RECORD_REGISTERED', { draftId, actor, origin, finalRecordId: result.recordId, finalCollection: result.collection, idempotentReplay: result.alreadyRegistered });
    if (!result.alreadyRegistered && result.senderPhone) {
      await sendWhatsappText({ phoneNumberId: result.phoneNumberId, to: result.senderPhone, text: `Registro completado. ${result.collection === 'compras' ? 'Compra' : 'Gasto'} ${result.recordId}.`, draftId });
    }
    return result;
  };

  const processTextConversation = async (inbox, authorizedUser) => {
    const drafts = await activeDraftsForPhone(inbox.senderPhone);
    const intent = parseConversationIntent(inbox.text);
    if (drafts.length > 1 && ['confirm', 'reject', 'patch'].includes(intent.type)) {
      await sendWhatsappText({ phoneNumberId: inbox.phoneNumberId, to: inbox.senderPhone, text: 'Tienes varios documentos pendientes. Indica el numero de factura o revisalos en la bandeja del sistema.' });
      return;
    }
    const draft = drafts[0];
    if (!draft) {
      await prepareDraft({ draftId: inbox.messageId, inbox, text: inbox.text, support: null });
      return;
    }
    if (intent.type === 'confirm') {
      if (authorizedUser?.permissions?.confirmOwnDrafts === false) {
        await sendWhatsappText({ phoneNumberId: inbox.phoneNumberId, to: inbox.senderPhone, text: 'Tu numero puede enviar documentos, pero la confirmacion debe hacerse desde la aplicacion.', draftId: draft.id });
        return;
      }
      if (draft.status !== AGENT_STATUSES.READY_FOR_CONFIRMATION) {
        await sendWhatsappText({ phoneNumberId: inbox.phoneNumberId, to: inbox.senderPhone, text: draft.lastQuestion || 'El borrador todavia tiene datos pendientes.', draftId: draft.id });
        return;
      }
      await firestore.collection(COLLECTIONS.drafts).doc(draft.id).set({ status: AGENT_STATUSES.CONFIRMED, confirmedAt: FieldValue.serverTimestamp(), confirmedFrom: 'whatsapp', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await registerDraft({ draftId: draft.id, actor: { phone: inbox.senderPhone, authorizedUserId: inbox.authorizedUserId }, origin: 'whatsapp' });
      return;
    }
    if (intent.type === 'reject') {
      await firestore.collection(COLLECTIONS.drafts).doc(draft.id).set({ status: AGENT_STATUSES.REJECTED, rejectedAt: FieldValue.serverTimestamp(), rejectedFrom: 'whatsapp', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await audit('DRAFT_REJECTED', { draftId: draft.id, senderPhone: inbox.senderPhone, origin: 'whatsapp' });
      await sendWhatsappText({ phoneNumberId: inbox.phoneNumberId, to: inbox.senderPhone, text: 'Borrador rechazado. No se registro ninguna transaccion.', draftId: draft.id });
      return;
    }
    if (intent.type === 'correction_request') {
      await sendWhatsappText({ phoneNumberId: inbox.phoneNumberId, to: inbox.senderPhone, text: 'Indica un cambio concreto, por ejemplo: “Es Granada”, “Fue transferencia” o “La factura es 12345”.', draftId: draft.id });
      return;
    }
    const previous = { ...draft };
    const patch = intent.type === 'patch' ? intent.patch : {};
    if (intent.type === 'patch') {
      const updated = validateDraft({ ...draft, ...patch, confianza: Math.max(Number(draft.confianza) || 0, 0.9) }, {
        allowWithoutSupport: draft.sinSoporteFiscal === true && draft.withoutSupportConfirmed === true,
        retentionIrConfirmed: draft.retentionIrConfirmed === true,
        retentionMunicipalConfirmed: draft.retentionMunicipalConfirmed === true,
      });
      await firestore.collection(COLLECTIONS.drafts).doc(draft.id).set({ ...cleanForFirestore(updated), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await audit('DRAFT_CORRECTED', { draftId: draft.id, senderPhone: inbox.senderPhone, origin: 'whatsapp', previous: Object.fromEntries(Object.keys(patch).map((key) => [key, previous[key]])), next: patch });
      await sendWhatsappText({ phoneNumberId: inbox.phoneNumberId, to: inbox.senderPhone, text: updated.status === AGENT_STATUSES.READY_FOR_CONFIRMATION ? buildConfirmationSummary(updated) : updated.pregunta, draftId: draft.id });
      return;
    }
    await prepareDraft({ draftId: draft.id, inbox, text: inbox.text, support: null, currentDraft: draft });
  };

  const processEvent = async (eventId) => {
    const eventRef = firestore.collection(COLLECTIONS.events).doc(eventId);
    const eventSnapshot = await eventRef.get();
    if (!eventSnapshot.exists) return { skipped: true };
    const event = eventSnapshot.data();
    if (event.status === 'PROCESSED') return { skipped: true, idempotent: true };
    const message = event.message || {};
    const value = event.value || {};
    const phone = normalizePhone(message.from);
    const senderName = event.senderName || '';
    const authorized = await getAuthorizedUser(phone);
    const inboxRef = firestore.collection(COLLECTIONS.inbox).doc(eventId);
    const inboxBase = {
      source: 'whatsapp',
      channel: 'whatsapp',
      messageId: eventId,
      senderPhone: phone,
      senderName,
      phoneNumberId: value.metadata?.phone_number_id || '',
      displayPhoneNumber: value.metadata?.display_phone_number || '',
      messageType: message.type || '',
      text: message.text?.body || message.image?.caption || message.document?.caption || '',
      receivedAt: event.receivedAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!authorized || authorized.permissions?.submitDocuments === false) {
      await inboxRef.set({ ...inboxBase, status: AGENT_STATUSES.REJECTED, securityEvent: true, error: 'Numero de WhatsApp no autorizado.' }, { merge: true });
      await eventRef.set({ status: 'PROCESSED', result: 'UNAUTHORIZED', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await audit('UNAUTHORIZED_WHATSAPP_MESSAGE', { inboxId: eventId, senderPhone: phone, messageType: message.type || '', reason: authorized ? 'permission_disabled' : 'phone_not_authorized' });
      return { rejected: true };
    }
    const media = getMessageMedia(message);
    let support = null;
    try {
      await inboxRef.set({ ...inboxBase, authorizedUserId: authorized.id, authorizedUserName: authorized.name || authorized.nombre || '', status: AGENT_STATUSES.PROCESSING, createdAt: FieldValue.serverTimestamp() }, { merge: true });
      if (media) support = await storeMedia({ message, media, phone, senderName });
      let duplicateSupport = null;
      if (support?.sha256) {
        const hashRef = firestore.collection(COLLECTIONS.files).doc(support.sha256);
        const hashSnapshot = await hashRef.get();
        if (hashSnapshot.exists && hashSnapshot.data()?.messageId !== eventId) {
          duplicateSupport = {
            id: hashSnapshot.data()?.messageId || support.sha256,
            collection: COLLECTIONS.inbox,
            reason: 'same_sha256',
            sha256: support.sha256,
          };
        } else if (!hashSnapshot.exists) {
          await hashRef.set({ messageId: eventId, senderPhone: phone, storagePath: support.path, createdAt: FieldValue.serverTimestamp() });
        }
      }
      const inbox = { ...inboxBase, authorizedUserId: authorized.id, messageId: eventId, duplicateSupport };
      await inboxRef.set(cleanForFirestore({
        ...inbox,
        status: AGENT_STATUSES.RECEIVED,
        media: support ? { ...support, buffer: undefined } : null,
        supportFiles: support ? [{ ...support, buffer: undefined }] : [],
        fotoFacturaUrl: support?.url || '',
        fotoFacturaPath: support?.path || '',
        sha256: support?.sha256 || '',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }), { merge: true });
      await audit('WHATSAPP_MESSAGE_RECEIVED', { inboxId: eventId, senderPhone: phone, authorizedUserId: authorized.id, messageType: message.type || '', sha256: support?.sha256 || '', supportPath: support?.path || '' });
      if (message.type === 'text' && !media) await processTextConversation(inbox, authorized);
      else await prepareDraft({ draftId: eventId, inbox, text: inbox.text, support });
      await eventRef.set({ status: 'PROCESSED', processedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await firestore.collection(COLLECTIONS.settings).doc('estado').set({ lastReceivedAt: FieldValue.serverTimestamp(), lastReceivedPhone: phone, webhookHealthy: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { ok: true };
    } catch (error) {
      logger.error('Error procesando evento del agente contable', { eventId, error: error.message });
      await inboxRef.set({ ...inboxBase, status: AGENT_STATUSES.ERROR, error: error.message, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await eventRef.set({ status: 'ERROR', error: error.message, attempts: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await firestore.collection(COLLECTIONS.settings).doc('estado').set({
        processorHealthy: false,
        lastErrorAt: FieldValue.serverTimestamp(),
        lastError: error.message,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      await audit('AGENT_PROCESSING_ERROR', { inboxId: eventId, senderPhone: phone, error: error.message });
      throw error;
    }
  };

  const updateDraft = async ({ draftId, patch, actor, origin = 'app' }) => {
    const draftRef = firestore.collection(COLLECTIONS.drafts).doc(draftId);
    const snapshot = await draftRef.get();
    if (!snapshot.exists) throw new Error('Borrador no encontrado.');
    const current = snapshot.data();
    if ([AGENT_STATUSES.REGISTERED, AGENT_STATUSES.REJECTED].includes(current.status)) throw new Error('Este borrador ya esta cerrado.');
    const allowedPatchFields = new Set([
      'tipoRegistro', 'branchId', 'fecha', 'vencimiento', 'providerId', 'numeroFactura',
      'descripcion', 'categoria', 'subcategoria', 'accountingAccountId', 'metodoPago',
      'referenciaPago', 'subtotal', 'iva', 'total', 'retencionIr2',
      'retencionMunicipal1', 'retentionIrConfirmed', 'retentionMunicipalConfirmed',
      'sinSoporteFiscal', 'withoutSupportConfirmed', 'ignoreDuplicate', 'confianza',
    ]);
    const safePatch = Object.fromEntries(Object.entries(patch || {}).filter(([key]) => allowedPatchFields.has(key)));
    const catalogs = await loadCatalogs();
    let next = normalizeDraft({
      ...current,
      ...safePatch,
      duplicateOverrideConfirmed: safePatch.ignoreDuplicate === true ? true : current.duplicateOverrideConfirmed === true,
      duplicateOverrideBy: safePatch.ignoreDuplicate === true ? actor : current.duplicateOverrideBy,
      confianza: safePatch.confianza ?? Math.max(Number(current.confianza) || 0, 0.9),
    });
    if (safePatch.providerId) {
      const provider = catalogs.providers.find((item) => item.id === safePatch.providerId);
      if (provider) next = { ...next, providerId: provider.id, providerCode: provider.code || provider.codigo || '', proveedor: provider.nombre || provider.name || '', rucProveedor: provider.ruc || provider.taxId || '' };
    }
    if (safePatch.accountingAccountId) {
      const account = catalogs.accounts.find((item) => String(item.id || item.number || item.code) === String(safePatch.accountingAccountId));
      if (account) next = { ...next, accountingAccountId: account.id || account.number || account.code, accountingAccountCode: account.number || account.code || '', accountingAccountName: account.name || '', accountingAccountType: account.type || '' };
    }
    const duplicates = await findDuplicates(next);
    next = validateDraft(next, {
      duplicateCandidates: safePatch.ignoreDuplicate === true || next.duplicateOverrideConfirmed === true ? [] : duplicates,
      allowWithoutSupport: next.sinSoporteFiscal === true && next.withoutSupportConfirmed === true,
      retentionIrConfirmed: next.retentionIrConfirmed === true,
      retentionMunicipalConfirmed: next.retentionMunicipalConfirmed === true,
    });
    const changed = Object.keys(safePatch).reduce((acc, key) => {
      if (JSON.stringify(current[key]) !== JSON.stringify(next[key])) acc[key] = { before: current[key] ?? null, after: next[key] ?? null };
      return acc;
    }, {});
    await draftRef.set({ ...cleanForFirestore(next), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await audit('DRAFT_CORRECTED', { draftId, actor, origin, changed });
    return next;
  };

  const rejectDraft = async ({ draftId, reason, actor, origin = 'app' }) => {
    const ref = firestore.collection(COLLECTIONS.drafts).doc(draftId);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error('Borrador no encontrado.');
    if (snapshot.data()?.status === AGENT_STATUSES.REGISTERED) throw new Error('No se puede rechazar un registro ya contabilizado.');
    await ref.set({ status: AGENT_STATUSES.REJECTED, rejectionReason: String(reason || '').trim(), rejectedBy: actor, rejectedFrom: origin, rejectedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await audit('DRAFT_REJECTED', { draftId, reason, actor, origin });
    return { ok: true };
  };

  return {
    audit,
    processEvent,
    registerDraft,
    rejectDraft,
    sendWhatsappText,
    updateDraft,
  };
}

module.exports = {
  COLLECTIONS,
  createAccountingAgentRuntime,
};
