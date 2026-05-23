import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { APP_BRAND_LOGO, APP_BRAND_NAME, fmt } from '../constants';
import { getSupportUrl, isPdfSupportRecord, uploadInvoicePhoto } from '../services/fiscalUtils';

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

const Icon = ({ path, className = 'h-5 w-5' }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
);

const quickPrompts = [
    'Analiza esta factura y crea un borrador fiscal.',
    'Que cuentas por pagar estan vencidas?',
    'Cuanto vendimos este mes sin IVA?',
    'Cuanto IVA comprado y vendido llevamos?',
    'Resume los gastos mas fuertes del mes.',
];

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

const targetLabels = {
    none: 'Sin borrador',
    gasto_credito: 'Gasto a credito',
    gasto_contado: 'Gasto contado',
    compra_credito: 'Compra a credito',
    compra_contado: 'Compra contado',
    abono_cxp: 'Abono CxP',
    factura_membretada_venta: 'Factura membretada',
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
    const url = getSupportUrl(item || {});
    if (!url) return null;

    return (
        <div className="mt-3 overflow-hidden rounded-3xl border border-[#ead5c5] bg-[#fffaf5] p-2">
            {isPdfSupportRecord(item) ? (
                <iframe title="Soporte IA fiscal" src={url} className="h-72 w-full rounded-2xl bg-white" />
            ) : (
                <img src={url} alt="Soporte fiscal" className="max-h-80 w-full rounded-2xl object-contain" />
            )}
        </div>
    );
};

const MessageBubble = ({ message }) => {
    const isUser = message.role === 'user';
    return (
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] rounded-3xl px-5 py-4 shadow-sm ${
                isUser
                    ? 'bg-[#7f1218] text-white'
                    : 'border border-[#ead5c5] bg-white text-[#3d1b1e]'
            }`}>
                <div className="whitespace-pre-wrap text-sm font-semibold leading-relaxed">{message.text}</div>
                <FollowUpPanel warnings={message.warnings || []} questions={message.followUpQuestions || []} />
                {message.support && <SupportPreview item={message.support} />}
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

export default function AIAssistant() {
    const [messages, setMessages] = useState([
        {
            id: 'welcome',
            role: 'assistant',
            text: 'Soy tu Agente IA Fiscal. Puedes preguntarme por ventas, IVA, cuentas por pagar o subir una factura/recibo para que prepare un borrador.',
        },
    ]);
    const [input, setInput] = useState('');
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [drafts, setDrafts] = useState([]);
    const [error, setError] = useState('');
    const [actionMessage, setActionMessage] = useState('');
    const [processingDraftId, setProcessingDraftId] = useState('');
    const endRef = useRef(null);

    useEffect(() => {
        const q = query(collection(db, 'ai_fiscal_inbox'), orderBy('createdAt', 'desc'), limit(12));
        return onSnapshot(q, (snapshot) => {
            setDrafts(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
        }, (err) => {
            console.error(err);
            setError('No pude cargar la bandeja IA. Revisa permisos de Firestore.');
        });
    }, []);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, loading]);

    const selectedFileLabel = useMemo(() => {
        if (!file) return '';
        return `${file.name} (${Math.round(file.size / 1024)} KB)`;
    }, [file]);

    const handleSend = async (overrideText = '') => {
        const text = (overrideText || input).trim();
        if (!text && !file) return;

        setLoading(true);
        setError('');

        let support = null;
        const userMessageId = `u_${Date.now()}`;
        try {
            if (file) {
                const uploaded = await uploadInvoicePhoto(file, 'ai/fiscal_supports', userMessageId);
                support = {
                    ...(uploaded.support || {}),
                    url: uploaded.fotoFacturaUrl,
                    path: uploaded.fotoFacturaPath,
                    source: 'app_ai_chat',
                    uploadedAt: new Date().toISOString(),
                };
            }

            setMessages((prev) => [
                ...prev,
                {
                    id: userMessageId,
                    role: 'user',
                    text: text || 'Analiza este soporte fiscal.',
                    support,
                },
            ]);
            setInput('');
            setFile(null);

            const response = await assistantCallable({
                message: text || 'Analiza este soporte fiscal y crea un borrador.',
                support,
            });
            const result = response.data?.result || {};
            setMessages((prev) => [
                ...prev,
                {
                    id: `a_${Date.now()}`,
                    role: 'assistant',
                    text: result.reply || 'Listo, procese tu solicitud.',
                    draft: result.suggestedDraft || emptyDraft,
                    warnings: result.warnings || [],
                    followUpQuestions: result.followUpQuestions || [],
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

    return (
        <div className="min-h-screen bg-[#fbf4ed] p-4 md:p-8">
            <style>{`
                @keyframes ai-rise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
                .ai-rise { animation: ai-rise .42s cubic-bezier(.22,1,.36,1) both; }
            `}</style>

            <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[1.35fr_0.65fr]">
                <section className="ai-rise overflow-hidden rounded-[2rem] border border-[#ead5c5] bg-white shadow-2xl shadow-[#7f1218]/10">
                    <div className="relative overflow-hidden bg-gradient-to-br from-[#2b1113] via-[#7f1218] to-[#a81d24] px-6 py-6 text-white">
                        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, #f2b635 0 2px, transparent 2px)', backgroundSize: '26px 26px' }} />
                        <div className="relative flex flex-wrap items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <div className="rounded-2xl bg-white p-2 shadow-xl">
                                    <img src={APP_BRAND_LOGO} alt={APP_BRAND_NAME} className="h-14 w-14 rounded-xl object-cover" />
                                </div>
                                <div>
                                    <div className="text-xs font-black uppercase tracking-[0.35em] text-[#f2b635]">Bandeja IA Fiscal</div>
                                    <h1 className="mt-1 text-2xl font-black">Agente contable conversacional</h1>
                                    <p className="mt-1 max-w-2xl text-sm font-semibold text-white/75">
                                        Pregunta por tus datos, sube soportes y genera borradores revisables sin tocar WhatsApp.
                                    </p>
                                </div>
                            </div>
                            <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-right backdrop-blur">
                                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-[#f8d8c8]">Modo seguro</div>
                                <div className="text-sm font-black">Siempre revisas antes de guardar</div>
                            </div>
                        </div>
                    </div>

                    <div className="flex h-[66vh] min-h-[560px] flex-col">
                        <div className="flex-1 space-y-4 overflow-y-auto bg-[#fffaf6] p-5">
                            {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
                            {loading && (
                                <div className="flex justify-start">
                                    <div className="rounded-3xl border border-[#ead5c5] bg-white px-5 py-4 text-sm font-black text-[#7f1218] shadow-sm">
                                        Pensando y revisando datos...
                                    </div>
                                </div>
                            )}
                            <div ref={endRef} />
                        </div>

                        <div className="border-t border-[#ead5c5] bg-white p-4">
                            {error && (
                                <div className="mb-3 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">
                                    <Icon path={Icons.alert} className="mt-0.5 h-4 w-4" />
                                    <span>{error}</span>
                                </div>
                            )}
                            {actionMessage && (
                                <div className="mb-3 flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">
                                    <Icon path={Icons.check} className="mt-0.5 h-4 w-4" />
                                    <span>{actionMessage}</span>
                                </div>
                            )}
                            <div className="mb-3 flex flex-wrap gap-2">
                                {quickPrompts.map((prompt) => (
                                    <button
                                        key={prompt}
                                        type="button"
                                        onClick={() => handleSend(prompt)}
                                        disabled={loading}
                                        className="rounded-full border border-[#ead5c5] bg-[#fff8f2] px-3 py-1.5 text-xs font-bold text-[#7f1218] transition hover:border-[#f2b635] hover:bg-[#fff0c8] disabled:opacity-50"
                                    >
                                        {prompt}
                                    </button>
                                ))}
                            </div>
                            <div className="flex flex-col gap-3 md:flex-row">
                                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-[#d9b99f] bg-[#fff8f2] px-4 py-3 text-sm font-black text-[#7f1218] transition hover:bg-[#fff0c8]">
                                    <Icon path={Icons.upload} className="h-5 w-5" />
                                    {selectedFileLabel || 'Adjuntar foto/PDF'}
                                    <input
                                        type="file"
                                        accept="image/*,.pdf"
                                        className="hidden"
                                        onChange={(event) => setFile(event.target.files?.[0] || null)}
                                    />
                                </label>
                                <div className="flex flex-1 rounded-2xl border border-[#ead5c5] bg-[#fffaf6] p-2 shadow-inner">
                                    <textarea
                                        value={input}
                                        onChange={(event) => setInput(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' && !event.shiftKey) {
                                                event.preventDefault();
                                                handleSend();
                                            }
                                        }}
                                        placeholder="Preguntale algo: 'cuanto IVA llevamos?', 'analiza esta factura', 'que CxP vencen?'"
                                        className="min-h-[54px] flex-1 resize-none bg-transparent px-3 py-2 text-sm font-semibold text-[#3d1b1e] outline-none"
                                    />
                                    {file && (
                                        <button
                                            type="button"
                                            onClick={() => setFile(null)}
                                            className="self-center rounded-xl p-2 text-stone-400 transition hover:bg-stone-100 hover:text-rose-600"
                                        >
                                            <Icon path={Icons.x} className="h-4 w-4" />
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => handleSend()}
                                        disabled={loading || (!input.trim() && !file)}
                                        className="self-end rounded-xl bg-[#a81d24] p-3 text-white shadow-lg shadow-[#a81d24]/20 transition hover:bg-[#7f1218] disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        <Icon path={Icons.send} className="h-5 w-5" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <aside className="ai-rise space-y-5" style={{ animationDelay: '120ms' }}>
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
                            <p>1. Sube foto/PDF de factura o recibo.</p>
                            <p>2. Pide que lo analice o pregunta por tus datos.</p>
                            <p>3. Revisa el borrador antes de registrarlo oficialmente.</p>
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    );
}
