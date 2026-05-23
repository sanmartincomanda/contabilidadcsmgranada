import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { APP_BRAND_LOGO, APP_BRAND_NAME, fmt } from '../constants';
import {
    getSupportFiles,
    getSupportUrl,
    isPdfSupportRecord,
    SUPPORT_FILE_TYPES,
    uploadFiscalSupportFiles,
    uploadSupportFile,
} from '../services/fiscalUtils';

const Icons = {
    send: 'M5 12h14M12 5l7 7-7 7',
    bot: 'M9.75 17L9 20l-1.5-3M14.25 17l.75 3 1.5-3M7 8h10M7 12h10m-5-9v2m-6 8a6 6 0 1112 0v3a2 2 0 01-2 2H8a2 2 0 01-2-2v-3z',
    upload: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12',
    file: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0118 9.414V19a2 2 0 01-2 2z',
    spark: 'M13 10V3L4 14h7v7l9-11h-7z',
    x: 'M6 18L18 6M6 6l12 12',
    check: 'M5 13l4 4L19 7',
    alert: 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
};

const AGENT_NAME = 'MARTIN IA';
const MAX_BATCH_INVOICES = 10;

const Icon = ({ path, className = 'h-5 w-5' }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
);

const quickPrompts = [
    'Analiza esta factura y dime que falta para registrarla.',
    'Activa modo digitador para esta factura.',
    'Soy trabajador, guiame paso a paso para subir un gasto.',
    'Que cuentas por pagar estan vencidas?',
    'Cuanto vendimos este mes sin IVA?',
    'Dame un resumen facil para gerencia.',
];

const assistantModeOptions = [
    {
        id: 'chat',
        label: 'Modo Chat',
        description: 'Consulta, explica y ayuda paso a paso.',
    },
    {
        id: 'digitizer',
        label: 'Modo Digitador',
        description: 'Lee facturas, aprende patrones y prepara registros.',
    },
];

const workerRoleOptions = [
    {
        id: 'administracion',
        label: 'Administracion',
        tone: 'resumen ejecutivo, acciones claras y control fiscal',
    },
    {
        id: 'contabilidad',
        label: 'Contabilidad',
        tone: 'detalle fiscal, validaciones y soporte documental',
    },
    {
        id: 'caja',
        label: 'Caja',
        tone: 'instrucciones cortas, paso a paso y sin tecnicismos',
    },
    {
        id: 'bodega',
        label: 'Bodega',
        tone: 'enfocado en compras, proveedores, facturas y recepcion',
    },
];

const getWorkerRole = (roleId) => (
    workerRoleOptions.find((role) => role.id === roleId) || workerRoleOptions[0]
);

const buildWelcomeMessage = () => ({
    id: 'welcome',
    role: 'assistant',
    text: `Soy ${AGENT_NAME}. Puedo conversar contigo como asistente contable o trabajar en Modo Digitador para leer facturas, aprender proveedores y preparar registros cada vez con menos preguntas.`,
    quickReplies: [
        'Quiero subir una factura',
        'Activar modo digitador',
        'Soy de caja, ayudame',
    ],
});

const emptyDraft = {
    targetType: 'none',
    date: '',
    supplier: '',
    invoiceNumber: '',
    category: '',
    description: '',
    paymentMethod: '',
    paymentReference: '',
    subtotal: 0,
    iva: 0,
    total: 0,
    retentionIr2: 0,
    retentionMunicipal1: 0,
    payableProvider: '',
    payableInvoiceNumber: '',
    amountPaid: 0,
};

const createEmptySupportFilesState = () => SUPPORT_FILE_TYPES.reduce((acc, item) => {
    acc[item.key] = null;
    return acc;
}, {});

const targetLabels = {
    none: 'Sin borrador',
    gasto_credito: 'Gasto a credito',
    gasto_contado: 'Gasto contado',
    compra_credito: 'Compra a credito',
    compra_contado: 'Compra contado',
    abono_cxp: 'Abono CxP',
    factura_membretada_venta: 'Factura membretada',
};

const classificationOptions = [
    {
        id: 'auto',
        label: 'MARTIN IA decide',
        description: 'Usa el historial y si duda te pregunta.',
    },
    {
        id: 'gasto',
        label: 'Es gasto',
        description: 'Servicios, viaticos, mantenimiento, oficina, etc.',
    },
    {
        id: 'compra',
        label: 'Es compra',
        description: 'Inventario, mercaderia o costo de venta.',
    },
];

const deriveQuickReplies = (message = {}) => {
    if (Array.isArray(message.quickReplies) && message.quickReplies.length) {
        return message.quickReplies.slice(0, 4);
    }

    const questionText = [...(message.followUpQuestions || []), message.text || '']
        .join(' ')
        .toLowerCase();

    if (questionText.includes('gasto') && questionText.includes('compra')) {
        return ['Es gasto', 'Es compra', 'No estoy seguro'];
    }

    if (questionText.includes('credito') || questionText.includes('crédito') || questionText.includes('contado')) {
        return ['Es credito', 'Es contado', 'Fue transferencia'];
    }

    if (questionText.includes('retencion') || questionText.includes('retención')) {
        return ['No tiene retenciones', 'Solo IR 2%', 'Solo municipal 1%', 'Ambas retenciones'];
    }

    if (questionText.includes('factura') || questionText.includes('numero')) {
        return ['No trae numero', 'Lo escribo manual', 'Esta en la foto'];
    }

    if (questionText.includes('digitador')) {
        return ['Activar modo digitador', 'Auto-registro seguro', 'Solo preparar borrador'];
    }

    return [];
};

const inferClassificationFromReply = (text = '') => {
    const normalized = text.toLowerCase();
    if (normalized.includes('gasto')) return 'gasto';
    if (normalized.includes('compra')) return 'compra';
    return '';
};

const inferModeFromReply = (text = '') => {
    const normalized = text.toLowerCase();
    if (normalized.includes('digitador')) return 'digitizer';
    if (normalized.includes('chat')) return 'chat';
    return '';
};

const assistantCallable = httpsCallable(functions, 'fiscalAssistantChat');
const confirmDraftCallable = httpsCallable(functions, 'confirmFiscalAssistantDraft');
const rejectDraftCallable = httpsCallable(functions, 'rejectFiscalAssistantDraft');

const timestampToDate = (value) => {
    if (!value) return '';
    if (value instanceof Timestamp) return value.toDate().toLocaleString('es-NI');
    if (value?.toDate) return value.toDate().toLocaleString('es-NI');
    return String(value);
};

const buildAutoRegisterStatusText = (autoRegistration) => {
    if (!autoRegistration) return '';
    if (autoRegistration.confirmed) {
        return `\n\nAuto-registro seguro completado en ${autoRegistration.targetCollection || 'el sistema'}.`;
    }

    const blockers = autoRegistration.blockers || [];
    if (autoRegistration.attempted && blockers.length) {
        const blockerText = blockers.length > 3
            ? `${blockers.slice(0, 3).join('; ')} y ${blockers.length - 3} pendientes mas`
            : blockers.join('; ');
        return `\n\nAuto-registro seguro no se ejecuto todavia: ${blockerText}.`;
    }

    return '';
};

const DraftField = ({ label, value, money = false }) => (
    <div className="rounded-2xl border border-[#ead5c5] bg-white/85 px-4 py-3 shadow-sm">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-400">{label}</div>
        <div className="mt-1 break-words text-sm font-black text-[#4b1b1f]">
            {money ? fmt(Number(value || 0)) : value || '---'}
        </div>
    </div>
);

const FollowUpPanel = ({ warnings = [], questions = [] }) => {
    if (!warnings.length && !questions.length) return null;

    return (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
            {warnings.length > 0 && (
                <div className="mb-2">
                    <div className="text-[10px] font-black uppercase tracking-[0.22em]">Alertas</div>
                    <ul className="mt-1 space-y-1 text-xs font-bold">
                        {warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
                    </ul>
                </div>
            )}
            {questions.length > 0 && (
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.22em]">Preguntas para confirmar</div>
                    <ul className="mt-1 space-y-1 text-xs font-bold">
                        {questions.map((question, index) => <li key={`${question}-${index}`}>{question}</li>)}
                    </ul>
                </div>
            )}
        </div>
    );
};

const SupportPreview = ({ item }) => {
    const files = getSupportFiles(item || {});
    const normalizedFiles = files.length
        ? files
        : getSupportUrl(item || {})
            ? [{ ...(item || {}), label: item?.label || 'Soporte fiscal', url: getSupportUrl(item || {}) }]
            : [];
    if (!normalizedFiles.length) return null;

    return (
        <div className="mt-3 space-y-3">
            {normalizedFiles.map((support, index) => {
                const url = support.url || getSupportUrl(support);
                if (!url) return null;

                return (
                    <div key={`${support.type || index}-${support.path || url}`} className="overflow-hidden rounded-3xl border border-[#ead5c5] bg-[#fffaf5] p-2">
                        <div className="mb-2 flex items-center justify-between gap-3 px-2 pt-1">
                            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#7f1218]">{support.label || 'Soporte fiscal'}</div>
                            <a href={url} target="_blank" rel="noreferrer" className="text-[10px] font-black uppercase tracking-[0.16em] text-[#a16a0c]">
                                Abrir
                            </a>
                        </div>
                        {isPdfSupportRecord(support) ? (
                            <iframe title={support.label || 'Soporte IA fiscal'} src={url} className="h-72 w-full rounded-2xl bg-white" />
                        ) : (
                            <img src={url} alt={support.label || 'Soporte fiscal'} className="max-h-80 w-full rounded-2xl object-contain" />
                        )}
                    </div>
                );
            })}
        </div>
    );
};

const TypingIndicator = ({ compactText = 'MARTIN IA esta pensando' }) => (
    <div className="flex justify-start">
        <div className="flex items-center gap-3 rounded-3xl border border-[#ead5c5] bg-white px-5 py-4 text-sm font-black text-[#7f1218] shadow-sm">
            <span>{compactText}</span>
            <span className="flex gap-1">
                <span className="h-2 w-2 animate-bounce rounded-full bg-[#a81d24]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-[#c58a19]" style={{ animationDelay: '120ms' }} />
                <span className="h-2 w-2 animate-bounce rounded-full bg-[#a81d24]" style={{ animationDelay: '240ms' }} />
            </span>
        </div>
    </div>
);

const MessageBubble = ({ message, onQuickReply }) => {
    const isUser = message.role === 'user';
    const quickReplies = !isUser ? deriveQuickReplies(message) : [];

    return (
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] rounded-3xl px-5 py-4 shadow-sm ${
                isUser
                    ? 'bg-[#7f1218] text-white'
                    : 'border border-[#ead5c5] bg-white text-[#3d1b1e]'
            }`}>
                <div className="whitespace-pre-wrap text-sm font-semibold leading-relaxed">{message.text}</div>
                <FollowUpPanel warnings={message.warnings || []} questions={message.followUpQuestions || []} />
                {(message.support || message.supportFiles?.length > 0) && (
                    <SupportPreview item={{ support: message.support, supportFiles: message.supportFiles || [] }} />
                )}
                {quickReplies.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                        {quickReplies.map((reply) => (
                            <button
                                key={reply}
                                type="button"
                                onClick={() => onQuickReply?.(reply)}
                                className="rounded-full border border-[#ead5c5] bg-[#fff8f2] px-3 py-1.5 text-xs font-black text-[#7f1218] transition hover:border-[#f2b635] hover:bg-[#fff0c8]"
                            >
                                {reply}
                            </button>
                        ))}
                    </div>
                )}
                {message.draft?.targetType && message.draft.targetType !== 'none' && (
                    <div className="mt-4 rounded-2xl border border-[#f2b635]/50 bg-[#fff8e6] p-4 text-[#4b1b1f]">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <div className="text-xs font-black uppercase tracking-[0.24em] text-[#a16a0c]">Borrador sugerido</div>
                            <span className="rounded-full bg-[#f2b635] px-3 py-1 text-[10px] font-black uppercase text-[#651317]">
                                {targetLabels[message.draft.targetType] || message.draft.targetType}
                            </span>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <DraftField label="Fecha" value={message.draft.date} />
                            <DraftField label="Proveedor" value={message.draft.supplier || message.draft.payableProvider} />
                            <DraftField label="Factura" value={message.draft.invoiceNumber || message.draft.payableInvoiceNumber} />
                            <DraftField label="Categoria" value={message.draft.category} />
                            <DraftField label="Subtotal" value={message.draft.subtotal} money />
                            <DraftField label="IVA" value={message.draft.iva} money />
                            <DraftField label="Total" value={message.draft.total || message.draft.amountPaid} money />
                            <DraftField label="Retenciones" value={`IR ${fmt(message.draft.retentionIr2 || 0)} / Municipal ${fmt(message.draft.retentionMunicipal1 || 0)}`} />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default function AIAssistant({ floating = false }) {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState(() => {
        try {
            const saved = JSON.parse(localStorage.getItem('martinIA.chat') || '[]');
            return Array.isArray(saved) && saved.length ? saved.slice(-30) : [buildWelcomeMessage()];
        } catch (error) {
            return [buildWelcomeMessage()];
        }
    });
    const [input, setInput] = useState('');
    const [supportFiles, setSupportFiles] = useState(createEmptySupportFilesState);
    const [batchInvoiceFiles, setBatchInvoiceFiles] = useState([]);
    const [classificationHint, setClassificationHint] = useState('auto');
    const [assistantMode, setAssistantMode] = useState(() => localStorage.getItem('martinIA.assistantMode') || 'chat');
    const [autoRegisterDigitizer, setAutoRegisterDigitizer] = useState(() => localStorage.getItem('martinIA.autoRegisterDigitizer') !== 'false');
    const [workerRole, setWorkerRole] = useState(() => localStorage.getItem('martinIA.workerRole') || 'administracion');
    const [workerName, setWorkerName] = useState(() => localStorage.getItem('martinIA.workerName') || '');
    const [loading, setLoading] = useState(false);
    const [drafts, setDrafts] = useState([]);
    const [error, setError] = useState('');
    const [actionMessage, setActionMessage] = useState('');
    const [processingDraftId, setProcessingDraftId] = useState('');
    const endRef = useRef(null);

    useEffect(() => {
        if (floating && !isOpen) return undefined;

        const q = query(collection(db, 'ai_fiscal_inbox'), orderBy('createdAt', 'desc'), limit(12));
        return onSnapshot(q, (snapshot) => {
            setDrafts(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
        }, (err) => {
            console.error(err);
            setError('No pude cargar la bandeja IA. Revisa permisos de Firestore.');
        });
    }, [floating, isOpen]);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, loading]);

    useEffect(() => {
        localStorage.setItem('martinIA.chat', JSON.stringify(messages.slice(-30)));
    }, [messages]);

    useEffect(() => {
        localStorage.setItem('martinIA.workerRole', workerRole);
    }, [workerRole]);

    useEffect(() => {
        localStorage.setItem('martinIA.workerName', workerName);
    }, [workerName]);

    useEffect(() => {
        localStorage.setItem('martinIA.assistantMode', assistantMode);
    }, [assistantMode]);

    useEffect(() => {
        localStorage.setItem('martinIA.autoRegisterDigitizer', String(autoRegisterDigitizer));
    }, [autoRegisterDigitizer]);

    const selectedSupportEntries = useMemo(() => (
        SUPPORT_FILE_TYPES
            .map((type) => ({ ...type, file: supportFiles[type.key] }))
            .filter((entry) => Boolean(entry.file))
    ), [supportFiles]);

    const hasSelectedSupport = selectedSupportEntries.length > 0;
    const hasBatchInvoices = batchInvoiceFiles.length > 0;

    const handleSend = async (overrideText = '', options = {}) => {
        if (loading) return;
        const text = (overrideText || input).trim();
        if (!text && !hasSelectedSupport && !hasBatchInvoices) return;

        if (hasBatchInvoices) {
            await handleBatchSend(text, options);
            return;
        }

        setLoading(true);
        setError('');

        let support = null;
        let uploadedSupportFiles = [];
        const userMessageId = `u_${Date.now()}`;
        const hintForRequest = options.classificationHintOverride || classificationHint;
        const currentWorkerRole = getWorkerRole(workerRole);
        const recentConversation = messages.slice(-10).map((entry) => ({
            role: entry.role,
            text: entry.text,
            followUpQuestions: entry.followUpQuestions || [],
            quickReplies: entry.quickReplies || [],
            hasSupport: Boolean(entry.support || entry.supportFiles?.length),
            supportUrl: entry.support?.url || '',
            supportFiles: entry.supportFiles || [],
            draftTargetType: entry.draft?.targetType || '',
        }));
        const reusableSupportMessage = [...messages].reverse().find((entry) => entry.support || entry.supportFiles?.length) || null;
        const reusableSupport = reusableSupportMessage?.support || null;
        const reusableSupportFiles = reusableSupportMessage?.supportFiles || (reusableSupport ? [reusableSupport] : []);
        const reusableSupportItem = {
            support: reusableSupport,
            supportFiles: reusableSupportFiles,
        };
        try {
            if (hasSelectedSupport) {
                const shouldPreserveExistingSupport = Boolean(
                    reusableSupportFiles.length
                    && !supportFiles.invoice
                    && (options.reuseLastSupport || supportFiles.retentionIr2 || supportFiles.retentionMunicipal1)
                );
                const uploaded = await uploadFiscalSupportFiles(
                    supportFiles,
                    'ai/fiscal_supports',
                    userMessageId,
                    shouldPreserveExistingSupport ? reusableSupportItem : {}
                );
                support = uploaded.support
                    ? {
                        ...(uploaded.support || {}),
                        url: uploaded.fotoFacturaUrl || uploaded.support.url,
                        path: uploaded.fotoFacturaPath || uploaded.support.path,
                        source: 'app_ai_chat',
                        uploadedAt: new Date().toISOString(),
                    }
                    : null;
                uploadedSupportFiles = (uploaded.supportFiles || []).map((item) => ({
                    ...item,
                    source: 'app_ai_chat',
                    uploadedAt: item.uploadedAt || new Date().toISOString(),
                }));
            }

            const supportFilesForRequest = uploadedSupportFiles.length
                ? uploadedSupportFiles
                : (options.reuseLastSupport ? reusableSupportFiles : []);
            const supportForRequest = support || (supportFilesForRequest[0] || null);
            const selectedClassification = classificationOptions.find((option) => option.id === hintForRequest);
            const currentAssistantMode = options.assistantModeOverride || (hasSelectedSupport || options.reuseLastSupport ? 'digitizer' : assistantMode);
            const digitizerActive = currentAssistantMode === 'digitizer';
            const messageForAi = [
                text || (digitizerActive
                    ? 'MODO DIGITADOR: lee esta factura, extrae los campos y prepara el registro contable.'
                    : 'Analiza este soporte fiscal. Antes de crear el borrador, confirma si la factura lleva retenciones.'),
                digitizerActive
                    ? 'MODO DIGITADOR ACTIVO: actua como digitador experto. Prioriza OCR fiscal, aprende proveedor, clasifica gasto/compra, completa campos y pregunta solo lo indispensable.'
                    : '',
                digitizerActive && autoRegisterDigitizer
                    ? 'Auto-registro seguro solicitado: solo registrar automaticamente si todos los campos estan completos, la confianza es muy alta y no hay preguntas pendientes.'
                    : '',
                (hasSelectedSupport || options.reuseLastSupport) && selectedClassification
                    ? `Clasificacion indicada por el usuario: ${selectedClassification.label}. Si esta clasificacion no coincide con la factura, pregunta antes de crear un borrador definitivo.`
                    : '',
                hasSelectedSupport
                    ? 'Lee todos los soportes adjuntos: factura principal y comprobantes de retencion si existen. Usa esos soportes como respaldo del registro.'
                    : '',
                options.reuseLastSupport && reusableSupportFiles.length
                    ? 'Esta respuesta corresponde al ultimo soporte/factura enviado en la conversacion.'
                    : '',
            ].filter(Boolean).join('\n');

            setMessages((prev) => [
                ...prev,
                {
                    id: userMessageId,
                    role: 'user',
                    text: [
                        text || 'Analiza este soporte fiscal.',
                        digitizerActive ? 'Modo: Digitador' : '',
                        digitizerActive && autoRegisterDigitizer ? 'Auto-registro seguro: activo' : '',
                        (hasSelectedSupport || options.reuseLastSupport) && selectedClassification ? `Tipo: ${selectedClassification.label}` : '',
                        uploadedSupportFiles.length ? `Soportes adjuntos: ${uploadedSupportFiles.map((item) => item.label).join(', ')}` : '',
                    ].filter(Boolean).join('\n'),
                    support: support || (supportFilesForRequest[0] || null),
                    supportFiles: supportFilesForRequest,
                },
            ]);
            setInput('');
            setSupportFiles(createEmptySupportFilesState());
            setClassificationHint('auto');

            const response = await assistantCallable({
                message: messageForAi,
                classificationHint: hintForRequest,
                support: supportForRequest,
                supportFiles: supportFilesForRequest,
                digitizerOptions: {
                    mode: currentAssistantMode,
                    autoRegister: digitizerActive && autoRegisterDigitizer,
                },
                conversationHistory: recentConversation,
                workerProfile: {
                    name: workerName.trim(),
                    role: currentWorkerRole.id,
                    roleLabel: currentWorkerRole.label,
                    tone: currentWorkerRole.tone,
                },
            });
            const result = response.data?.result || {};
            const autoRegistration = response.data?.autoRegistration || null;
            const autoRegisterText = buildAutoRegisterStatusText(autoRegistration);
            setMessages((prev) => [
                ...prev,
                {
                    id: `a_${Date.now()}`,
                    role: 'assistant',
                    text: `${result.reply || 'Listo, procese tu solicitud.'}${autoRegisterText}`,
                    draft: result.suggestedDraft || emptyDraft,
                    warnings: result.warnings || [],
                    followUpQuestions: result.followUpQuestions || [],
                    quickReplies: result.quickReplies || [],
                },
            ]);
        } catch (err) {
            console.error(err);
            const friendly = err?.message?.includes('not-found')
                ? 'La Function fiscalAssistantChat todavia no esta desplegada. El chat visual ya esta listo; falta deploy y OPENAI_API_KEY.'
                : err?.message || 'No pude procesar la solicitud.';
            setError(friendly);
            setMessages((prev) => [
                ...prev,
                {
                    id: `e_${Date.now()}`,
                    role: 'assistant',
                    text: `No pude completar la consulta: ${friendly}`,
                },
            ]);
        } finally {
            setLoading(false);
        }
    };

    const handleBatchSend = async (overrideText = '', options = {}) => {
        if (loading || !batchInvoiceFiles.length) return;

        const files = batchInvoiceFiles.slice(0, MAX_BATCH_INVOICES);
        const text = (overrideText || input).trim();
        const batchId = `batch_${Date.now()}`;
        const hintForRequest = options.classificationHintOverride || classificationHint;
        const currentWorkerRole = getWorkerRole(workerRole);
        const recentConversation = messages.slice(-8).map((entry) => ({
            role: entry.role,
            text: entry.text,
            followUpQuestions: entry.followUpQuestions || [],
            quickReplies: entry.quickReplies || [],
            hasSupport: Boolean(entry.support || entry.supportFiles?.length),
            supportUrl: entry.support?.url || '',
            supportFiles: entry.supportFiles || [],
            draftTargetType: entry.draft?.targetType || '',
        }));

        setLoading(true);
        setError('');
        setActionMessage('');
        setAssistantMode('digitizer');
        setMessages((prev) => [
            ...prev,
            {
                id: `${batchId}_user`,
                role: 'user',
                text: [
                    text || `Procesa lote de ${files.length} facturas.`,
                    'Modo: Digitador por lote',
                    autoRegisterDigitizer ? 'Auto-registro seguro: activo' : 'Auto-registro seguro: apagado',
                    `Facturas seleccionadas: ${files.map((file, index) => `${index + 1}. ${file.name}`).join(' | ')}`,
                ].filter(Boolean).join('\n'),
            },
        ]);
        setInput('');
        setBatchInvoiceFiles([]);
        setSupportFiles(createEmptySupportFilesState());
        setClassificationHint('auto');

        const totals = {
            processed: 0,
            registered: 0,
            pending: 0,
            failed: 0,
        };

        try {
            for (const [index, file] of files.entries()) {
                const invoiceNumber = index + 1;
                try {
                    const uploaded = await uploadSupportFile(file, 'ai/fiscal_supports', `${batchId}_${invoiceNumber}`, 'invoice');
                    const supportFile = {
                        ...uploaded,
                        source: 'app_ai_batch',
                        uploadedAt: uploaded.uploadedAt || new Date().toISOString(),
                    };

                    const response = await assistantCallable({
                        message: [
                            text || 'MODO DIGITADOR LOTE: lee esta factura y prepara el registro contable.',
                            `Factura ${invoiceNumber} de ${files.length}. Procesala como factura independiente.`,
                            'Si esta clara, intenta auto-registro seguro. Si falta algo, pregunta solo lo indispensable para esta factura.',
                        ].join('\n'),
                        classificationHint: hintForRequest,
                        support: supportFile,
                        supportFiles: [supportFile],
                        digitizerOptions: {
                            mode: 'digitizer',
                            autoRegister: autoRegisterDigitizer,
                        },
                        conversationHistory: recentConversation,
                        workerProfile: {
                            name: workerName.trim(),
                            role: currentWorkerRole.id,
                            roleLabel: currentWorkerRole.label,
                            tone: currentWorkerRole.tone,
                        },
                    });

                    const result = response.data?.result || {};
                    const autoRegistration = response.data?.autoRegistration || null;
                    totals.processed += 1;
                    if (autoRegistration?.confirmed) totals.registered += 1;
                    else totals.pending += 1;

                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `${batchId}_assistant_${invoiceNumber}`,
                            role: 'assistant',
                            text: `Factura ${invoiceNumber}/${files.length}\n${result.reply || 'Factura procesada.'}${buildAutoRegisterStatusText(autoRegistration)}`,
                            draft: result.suggestedDraft || emptyDraft,
                            warnings: result.warnings || [],
                            followUpQuestions: result.followUpQuestions || [],
                            quickReplies: result.quickReplies || [],
                            support: supportFile,
                            supportFiles: [supportFile],
                        },
                    ]);
                } catch (err) {
                    console.error(err);
                    totals.failed += 1;
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `${batchId}_error_${invoiceNumber}`,
                            role: 'assistant',
                            text: `Factura ${invoiceNumber}/${files.length}\nNo pude procesar esta factura: ${err?.message || 'error desconocido'}. La seguimos manual si hace falta.`,
                        },
                    ]);
                }
            }

            setMessages((prev) => [
                ...prev,
                {
                    id: `${batchId}_summary`,
                    role: 'assistant',
                    text: `Resumen del lote: ${totals.processed} procesadas, ${totals.registered} registradas automaticamente, ${totals.pending} pendientes de confirmar y ${totals.failed} con error.`,
                    quickReplies: totals.pending ? ['Revisar pendientes', 'No tiene retenciones', 'Es contado'] : ['Subir otro lote', 'Revisar CxP'],
                },
            ]);
        } finally {
            setLoading(false);
        }
    };

    const handleConfirmDraft = async (draft) => {
        if (!draft?.id || processingDraftId) return;
        const suggested = draft.suggestedDraft || draft.aiResult?.suggestedDraft || emptyDraft;
        if (!window.confirm(`Confirmar este borrador como "${targetLabels[suggested.targetType] || suggested.targetType}"?`)) return;

        setProcessingDraftId(draft.id);
        setActionMessage('');
        setError('');
        try {
            const response = await confirmDraftCallable({ draftId: draft.id });
            const targetCollection = response.data?.targetCollection || 'registro';
            setActionMessage(`Borrador confirmado y registrado en ${targetCollection}.`);
        } catch (err) {
            console.error(err);
            setError(err?.message || 'No se pudo confirmar el borrador.');
        } finally {
            setProcessingDraftId('');
        }
    };

    const handleQuickReply = (reply) => {
        const classification = inferClassificationFromReply(reply);
        const mode = inferModeFromReply(reply);
        if (mode) setAssistantMode(mode);
        if (reply.toLowerCase().includes('auto-registro')) setAutoRegisterDigitizer(true);
        handleSend(reply, {
            reuseLastSupport: true,
            classificationHintOverride: classification || classificationHint,
            assistantModeOverride: mode || assistantMode,
        });
    };

    const handleRejectDraft = async (draft) => {
        if (!draft?.id || processingDraftId) return;
        if (!window.confirm('Rechazar este borrador IA?')) return;

        setProcessingDraftId(draft.id);
        setActionMessage('');
        setError('');
        try {
            await rejectDraftCallable({ draftId: draft.id });
            setActionMessage('Borrador rechazado.');
        } catch (err) {
            console.error(err);
            setError(err?.message || 'No se pudo rechazar el borrador.');
        } finally {
            setProcessingDraftId('');
        }
    };

    const renderChatComposer = (compact = false) => {
        const supportLabels = selectedSupportEntries.map((entry) => `${entry.label}: ${entry.file.name}`);
        const batchLabels = batchInvoiceFiles.map((file, index) => `Factura ${index + 1}: ${file.name}`);
        const attachmentLabels = [...supportLabels, ...batchLabels];

        return (
            <div className="border-t border-[#ead5c5] bg-white p-3">
                {(error || actionMessage) && (
                    <div className={`mb-3 rounded-2xl px-4 py-3 text-xs font-bold ${
                        error
                            ? 'border border-amber-200 bg-amber-50 text-amber-800'
                            : 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                    }`}>
                        {error || actionMessage}
                    </div>
                )}

                {(hasSelectedSupport || hasBatchInvoices) && (
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                        {attachmentLabels.map((label) => (
                            <span key={label} className="max-w-full truncate rounded-full border border-[#ead5c5] bg-[#fff8f2] px-3 py-1 text-[11px] font-bold text-[#7f1218]">
                                {label}
                            </span>
                        ))}
                        <button
                            type="button"
                            onClick={() => {
                                setSupportFiles(createEmptySupportFilesState());
                                setBatchInvoiceFiles([]);
                            }}
                            className="rounded-full px-2 py-1 text-[11px] font-bold text-stone-400 transition hover:bg-stone-100 hover:text-rose-700"
                        >
                            quitar
                        </button>
                    </div>
                )}

                <div className="rounded-[1.4rem] border border-[#ead5c5] bg-[#fffaf6] p-2 shadow-inner">
                    <textarea
                        value={input}
                        onChange={(event) => setInput(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault();
                                handleSend();
                            }
                        }}
                        placeholder={hasBatchInvoices ? 'Opcional: instrucciones para este lote...' : 'Escribe o adjunta una factura...'}
                        className={`${compact ? 'min-h-[52px]' : 'min-h-[64px]'} w-full resize-none bg-transparent px-3 py-2 text-sm font-semibold text-[#3d1b1e] outline-none`}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#ead5c5]/70 pt-2">
                        <div className="flex flex-wrap gap-1.5">
                            <label className={`cursor-pointer rounded-full border px-3 py-1.5 text-[11px] font-black transition ${
                                hasBatchInvoices
                                    ? 'border-[#a81d24] bg-[#a81d24] text-white'
                                    : 'border-[#f2b635] bg-[#fff8e6] text-[#7f1218] hover:bg-[#fff0c8]'
                            }`}>
                                {hasBatchInvoices ? `Lote ${batchInvoiceFiles.length}/${MAX_BATCH_INVOICES}` : `Lote ${MAX_BATCH_INVOICES} facturas`}
                                <input
                                    type="file"
                                    accept="image/*,.pdf"
                                    multiple
                                    className="hidden"
                                    onChange={(event) => {
                                        const selected = Array.from(event.target.files || []).slice(0, MAX_BATCH_INVOICES);
                                        setBatchInvoiceFiles(selected);
                                        setSupportFiles(createEmptySupportFilesState());
                                        setAssistantMode('digitizer');
                                        event.target.value = '';
                                    }}
                                />
                            </label>
                            {SUPPORT_FILE_TYPES.map((type) => {
                                const selected = supportFiles[type.key];
                                const shortLabel = type.key === 'invoice' ? 'Factura' : type.key === 'retentionIr2' ? 'Ret. IR' : 'Ret. municipal';
                                return (
                                    <label key={type.key} className={`cursor-pointer rounded-full border px-3 py-1.5 text-[11px] font-black transition ${
                                        selected
                                            ? 'border-[#a81d24] bg-[#a81d24] text-white'
                                            : 'border-[#ead5c5] bg-white text-[#7f1218] hover:bg-[#fff0c8]'
                                    }`}>
                                        {selected ? `${shortLabel} lista` : shortLabel}
                                        <input
                                            type="file"
                                            accept="image/*,.pdf"
                                            className="hidden"
                                            onChange={(event) => {
                                                setBatchInvoiceFiles([]);
                                                setSupportFiles((prev) => ({ ...prev, [type.key]: event.target.files?.[0] || null }));
                                                event.target.value = '';
                                            }}
                                        />
                                    </label>
                                );
                            })}
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setMessages([buildWelcomeMessage()])}
                                className="rounded-full px-3 py-2 text-[11px] font-black text-stone-400 transition hover:bg-stone-100 hover:text-[#7f1218]"
                            >
                                Nuevo
                            </button>
                            <button
                                type="button"
                                onClick={() => handleSend()}
                                disabled={loading || (!input.trim() && !hasSelectedSupport && !hasBatchInvoices)}
                                className="rounded-full bg-[#a81d24] p-3 text-white shadow-lg shadow-[#a81d24]/20 transition hover:bg-[#7f1218] disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label="Enviar mensaje"
                            >
                                <Icon path={Icons.send} className="h-5 w-5" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    if (floating) {
        return (
            <div className="fixed bottom-5 right-5 z-[80] no-print">
                {isOpen && (
                    <section className="mb-4 flex h-[min(680px,calc(100vh-7rem))] w-[calc(100vw-2rem)] max-w-[440px] flex-col overflow-hidden rounded-[2rem] border border-[#ead5c5] bg-white shadow-2xl shadow-[#2b1113]/35">
                        <div className="relative overflow-hidden bg-gradient-to-br from-[#2b1113] via-[#7f1218] to-[#a81d24] px-5 py-4 text-white">
                            <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, #f2b635 0 2px, transparent 2px)', backgroundSize: '24px 24px' }} />
                            <div className="relative flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3">
                                    <div className="rounded-2xl bg-white p-1.5 shadow-xl">
                                        <img src={APP_BRAND_LOGO} alt={APP_BRAND_NAME} className="h-10 w-10 rounded-xl object-cover" />
                                    </div>
                                    <div>
                                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#f2b635]">{AGENT_NAME}</div>
                                        <div className="text-sm font-black">Chat contable</div>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsOpen(false)}
                                    className="rounded-2xl bg-white/10 p-2 text-white/80 transition hover:bg-white/20 hover:text-white"
                                    aria-label={`Cerrar ${AGENT_NAME}`}
                                >
                                    <Icon path={Icons.x} className="h-5 w-5" />
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 space-y-3 overflow-y-auto bg-[#fffaf6] p-4">
                            {messages.map((message) => <MessageBubble key={message.id} message={message} onQuickReply={handleQuickReply} />)}
                            {loading && (
                                <TypingIndicator compactText={`${AGENT_NAME} esta revisando`} />
                            )}
                            <div ref={endRef} />
                        </div>

                        {renderChatComposer(true)}
                    </section>
                )}

                <button
                    type="button"
                    onClick={() => setIsOpen((value) => !value)}
                    className="group flex items-center gap-3 rounded-full bg-[#a81d24] px-4 py-3 text-white shadow-2xl shadow-[#7f1218]/35 transition hover:-translate-y-0.5 hover:bg-[#7f1218]"
                    aria-label={`${isOpen ? 'Cerrar' : 'Abrir'} ${AGENT_NAME}`}
                >
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#7f1218] shadow-inner">
                        <Icon path={Icons.bot} className="h-6 w-6" />
                    </span>
                    <span className="hidden pr-2 text-left sm:block">
                        <span className="block text-[10px] font-black uppercase tracking-[0.25em] text-[#f2b635]">Abrir chat</span>
                        <span className="block text-sm font-black">{AGENT_NAME}</span>
                    </span>
                </button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#fbf4ed] p-4 md:p-8">
            <style>{`
                @keyframes ai-rise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
                .ai-rise { animation: ai-rise .42s cubic-bezier(.22,1,.36,1) both; }
            `}</style>

            <div className="mx-auto max-w-5xl">
                <section className="ai-rise overflow-hidden rounded-[2rem] border border-[#ead5c5] bg-white shadow-2xl shadow-[#7f1218]/10">
                    <div className="relative overflow-hidden bg-gradient-to-br from-[#2b1113] via-[#7f1218] to-[#a81d24] px-5 py-4 text-white">
                        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, #f2b635 0 2px, transparent 2px)', backgroundSize: '26px 26px' }} />
                        <div className="relative flex flex-wrap items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <div className="rounded-2xl bg-white p-1.5 shadow-xl">
                                    <img src={APP_BRAND_LOGO} alt={APP_BRAND_NAME} className="h-11 w-11 rounded-xl object-cover" />
                                </div>
                                <div>
                                    <div className="text-xs font-black uppercase tracking-[0.35em] text-[#f2b635]">{AGENT_NAME}</div>
                                    <h1 className="mt-1 text-xl font-black">Escribe o adjunta una factura</h1>
                                </div>
                            </div>
                            <div className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-black text-white/85 backdrop-blur">
                                MARTIN decide el modo
                            </div>
                        </div>
                    </div>

                    <div className="flex h-[calc(100vh-11rem)] min-h-[520px] flex-col">
                        <div className="flex-1 space-y-4 overflow-y-auto bg-[#fffaf6] p-5">
                            {messages.map((message) => <MessageBubble key={message.id} message={message} onQuickReply={handleQuickReply} />)}
                            {loading && (
                                <TypingIndicator compactText="Pensando y revisando datos" />
                            )}
                            <div ref={endRef} />
                        </div>

                        {renderChatComposer()}
                    </div>
                </section>

                <aside className="hidden" style={{ animationDelay: '120ms' }}>
                    <div className="rounded-[2rem] border border-[#ead5c5] bg-white p-5 shadow-xl shadow-[#7f1218]/8">
                        <div className="mb-4 flex items-center gap-3">
                            <div className="rounded-2xl bg-[#fff0c8] p-3 text-[#8a5a11]">
                                <Icon path={Icons.spark} className="h-5 w-5" />
                            </div>
                            <div>
                                <div className="text-xs font-black uppercase tracking-[0.25em] text-[#b98b2d]">Borradores IA</div>
                                <div className="text-lg font-black text-[#4b1b1f]">Pendientes de revision</div>
                            </div>
                        </div>

                        {drafts.length === 0 ? (
                            <div className="rounded-3xl border border-dashed border-[#d9b99f] bg-[#fffaf6] p-6 text-center">
                                <Icon path={Icons.file} className="mx-auto mb-3 h-10 w-10 text-stone-300" />
                                <p className="text-sm font-black text-stone-500">Todavia no hay borradores IA.</p>
                                <p className="mt-1 text-xs font-semibold text-stone-400">Sube una factura o pide un analisis fiscal.</p>
                            </div>
                        ) : (
                            <div className="max-h-[72vh] space-y-3 overflow-y-auto pr-1">
                                {drafts.map((draft) => {
                                    const suggested = draft.suggestedDraft || draft.aiResult?.suggestedDraft || emptyDraft;
                                    const supportUrl = getSupportUrl(draft);
                                    return (
                                        <div key={draft.id} className="rounded-3xl border border-[#ead5c5] bg-[#fffaf6] p-4">
                                            <div className="mb-2 flex items-start justify-between gap-3">
                                                <div>
                                                    <div className="text-sm font-black text-[#4b1b1f]">
                                                        {targetLabels[suggested.targetType] || suggested.targetType || 'Borrador'}
                                                    </div>
                                                    <div className="text-[11px] font-semibold text-stone-400">{timestampToDate(draft.createdAt)}</div>
                                                </div>
                                                <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-[#7f1218]">
                                                    {draft.status === 'confirmed' ? 'Confirmado' : draft.status === 'rejected' ? 'Rechazado' : `${Math.round((draft.confidence || 0) * 100)}%`}
                                                </span>
                                            </div>
                                            <div className="space-y-1 text-xs font-semibold text-stone-600">
                                                <div>Proveedor: <span className="font-black text-stone-800">{suggested.supplier || suggested.payableProvider || '---'}</span></div>
                                                <div>Factura: <span className="font-black text-stone-800">{suggested.invoiceNumber || suggested.payableInvoiceNumber || '---'}</span></div>
                                                <div>Total: <span className="font-black text-[#7f1218]">{fmt(suggested.total || suggested.amountPaid || 0)}</span></div>
                                            </div>
                                            {supportUrl && (
                                                <a href={supportUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#7f1218] px-3 py-2 text-xs font-black text-white">
                                                    <Icon path={Icons.file} className="h-4 w-4" />
                                                    Ver soporte
                                                </a>
                                            )}
                                            <FollowUpPanel warnings={draft.aiResult?.warnings || []} questions={draft.aiResult?.followUpQuestions || []} />
                                            {draft.status === 'draft' && suggested.targetType !== 'none' && (
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleConfirmDraft(draft)}
                                                        disabled={Boolean(processingDraftId)}
                                                        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white transition hover:bg-emerald-700 disabled:opacity-50"
                                                    >
                                                        <Icon path={Icons.check} className="h-4 w-4" />
                                                        {processingDraftId === draft.id ? 'Confirmando...' : 'Confirmar'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRejectDraft(draft)}
                                                        disabled={Boolean(processingDraftId)}
                                                        className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-black text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                                                    >
                                                        <Icon path={Icons.x} className="h-4 w-4" />
                                                        Rechazar
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className="rounded-[2rem] border border-[#ead5c5] bg-[#2b1113] p-5 text-white shadow-xl shadow-[#2b1113]/15">
                        <div className="mb-2 text-xs font-black uppercase tracking-[0.25em] text-[#f2b635]">Como usarlo</div>
                        <div className="space-y-3 text-sm font-semibold text-white/75">
                            <p>1. Activa Modo Digitador para facturas.</p>
                            <p>2. Sube factura y retenciones si existen.</p>
                            <p>3. MARTIN IA aprende proveedor, categoria, pago y retenciones.</p>
                            <p>4. Auto-registro seguro solo corre si todo viene claro.</p>
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    );
}
