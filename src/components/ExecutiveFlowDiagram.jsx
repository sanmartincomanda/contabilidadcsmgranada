import React from 'react';
import { fmt } from '../constants';

const toneStyles = {
    source: 'bg-sky-500 text-white border-sky-400 shadow-sky-500/25',
    center: 'bg-slate-800 text-white border-slate-700 shadow-slate-900/25',
    cost: 'bg-orange-50 text-orange-900 border-orange-200 shadow-orange-900/10',
    tax: 'bg-rose-50 text-rose-800 border-rose-200 shadow-rose-900/10',
    profit: 'bg-emerald-600 text-white border-emerald-500 shadow-emerald-700/25',
    danger: 'bg-rose-600 text-white border-rose-500 shadow-rose-700/25',
};

const subtleText = {
    source: 'text-white/80',
    center: 'text-white/70',
    cost: 'text-orange-700',
    tax: 'text-rose-600',
    profit: 'text-white/80',
    danger: 'text-white/80',
};

const getTone = (node, fallback) => node?.tone || fallback;

const getNodeWidth = (value) => {
    const length = fmt(Math.abs(Number(value) || 0)).length;
    if (length > 15) return 'min-w-[260px]';
    if (length > 12) return 'min-w-[235px]';
    return 'min-w-[215px]';
};

const FlowNode = ({ node, tone, className = '' }) => {
    if (!node) return null;
    const resolvedTone = getTone(node, tone);
    const value = Number(node.value) || 0;

    return (
        <div className={`rounded-2xl border p-5 shadow-xl ${toneStyles[resolvedTone]} ${getNodeWidth(value)} ${className}`}>
            <div className={`text-[11px] font-black uppercase tracking-[0.22em] ${subtleText[resolvedTone]}`}>{node.label}</div>
            <div className="mt-2 whitespace-nowrap font-mono text-2xl font-black tracking-tight">{fmt(value)}</div>
            {node.subtitle && <div className={`mt-2 text-xs font-bold ${subtleText[resolvedTone]}`}>{node.subtitle}</div>}
            {node.lines?.length > 0 && (
                <div className="mt-3 space-y-1">
                    {node.lines.map((line) => (
                        <div key={line.label} className="flex items-center justify-between gap-3 text-sm font-black">
                            <span>{line.label}</span>
                            <span className="font-mono">{fmt(Number(line.value) || 0)}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const MobileStep = ({ node, tone, connector = true }) => (
    <div className="relative">
        <FlowNode node={node} tone={tone} className="w-full min-w-0" />
        {connector && (
            <div className="mx-auto h-8 w-1 rounded-full bg-gradient-to-b from-sky-300 via-slate-200 to-emerald-300" />
        )}
    </div>
);

export default function ExecutiveFlowDiagram({
    eyebrow = 'Financial flow',
    title = 'Estado financiero',
    subtitle,
    period,
    source,
    center,
    top,
    middle,
    bottom,
    embedded = false,
}) {
    const values = [source, center, top, middle, bottom].map((node) => Math.abs(Number(node?.value) || 0));
    const maxValue = Math.max(...values, 1);
    const ribbon = (value, min = 12, max = 70) => Math.max(min, Math.min(max, (Math.abs(Number(value) || 0) / maxValue) * max));
    const bottomTone = Number(bottom?.value || 0) >= 0 ? getTone(bottom, 'profit') : 'danger';

    const content = (
        <>
            {!embedded && (
                <div className="border-b border-slate-200 bg-white px-5 py-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.35em] text-slate-400">{eyebrow}</div>
                            <h3 className="mt-1 text-2xl font-black text-slate-900">{title}</h3>
                            {subtitle && <p className="text-xs font-semibold text-slate-500">{subtitle}</p>}
                        </div>
                        {period && (
                            <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-black uppercase tracking-wider text-slate-600">
                                {period}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div className="hidden overflow-x-auto md:block">
                <div className="relative min-h-[430px] min-w-[1040px] overflow-hidden bg-gradient-to-br from-white via-[#f8fbff] to-[#fff5ec] p-6">
                    <div className="absolute inset-0 opacity-75" style={{ backgroundImage: 'linear-gradient(#e8eef5 1px, transparent 1px), linear-gradient(90deg, #e8eef5 1px, transparent 1px)', backgroundSize: '30px 30px' }} />
                    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1100 430" preserveAspectRatio="none" aria-hidden="true">
                        <defs>
                            <filter id="executive-flow-shadow" x="-20%" y="-20%" width="140%" height="140%">
                                <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#0f172a" floodOpacity="0.16" />
                            </filter>
                            <linearGradient id="executive-sales" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.88" />
                                <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.52" />
                            </linearGradient>
                            <linearGradient id="executive-cost" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#fdba74" stopOpacity="0.88" />
                                <stop offset="100%" stopColor="#fb923c" stopOpacity="0.64" />
                            </linearGradient>
                            <linearGradient id="executive-tax" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#fb7185" stopOpacity="0.74" />
                                <stop offset="100%" stopColor="#e11d48" stopOpacity="0.55" />
                            </linearGradient>
                            <linearGradient id="executive-profit" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#86efac" stopOpacity="0.82" />
                                <stop offset="100%" stopColor="#16a34a" stopOpacity="0.66" />
                            </linearGradient>
                        </defs>
                        <path d="M160 188 C280 138, 340 152, 462 196" fill="none" stroke="url(#executive-sales)" strokeWidth={ribbon(source?.value, 42, 84)} strokeLinecap="round" filter="url(#executive-flow-shadow)" />
                        {top && <path d="M540 190 C640 92, 750 64, 905 66" fill="none" stroke="url(#executive-cost)" strokeWidth={ribbon(top.value, 18, 62)} strokeLinecap="round" />}
                        {middle && <path d="M540 210 C650 214, 760 218, 912 220" fill="none" stroke="url(#executive-tax)" strokeWidth={ribbon(middle.value, 10, 38)} strokeLinecap="round" />}
                        {bottom && <path d="M540 238 C650 314, 760 334, 930 338" fill="none" stroke="url(#executive-profit)" strokeWidth={ribbon(bottom.value, 18, 66)} strokeLinecap="round" filter="url(#executive-flow-shadow)" />}
                    </svg>

                    <div className="absolute left-[4%] top-[32%]"><FlowNode node={source} tone="source" /></div>
                    <div className="absolute left-[35%] top-[33%]"><FlowNode node={center} tone="center" /></div>
                    {top && <div className="absolute right-[8%] top-[5%]"><FlowNode node={top} tone="cost" /></div>}
                    {middle && <div className="absolute right-[6%] top-[35%]"><FlowNode node={middle} tone="tax" /></div>}
                    {bottom && <div className="absolute right-[8%] bottom-[7%]"><FlowNode node={{ ...bottom, tone: bottomTone }} tone={bottomTone} /></div>}
                </div>
            </div>

            <div className="space-y-1 p-4 md:hidden">
                <MobileStep node={source} tone="source" />
                <MobileStep node={center} tone="center" />
                {top && <MobileStep node={top} tone="cost" />}
                {middle && <MobileStep node={middle} tone="tax" />}
                {bottom && <MobileStep node={{ ...bottom, tone: bottomTone }} tone={bottomTone} connector={false} />}
            </div>
        </>
    );

    if (embedded) {
        return <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-[#f7f9fb]">{content}</div>;
    }

    return (
        <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-[#f7f9fb] shadow-xl shadow-slate-900/5">
            {content}
        </div>
    );
}
