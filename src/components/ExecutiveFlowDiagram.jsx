import React from 'react';
import { fmt } from '../constants';

const toneStyles = {
    source: 'bg-sky-500 text-white border-sky-400 shadow-sky-500/25',
    center: 'bg-slate-800 text-white border-slate-700 shadow-slate-900/25',
    cost: 'bg-orange-50 text-orange-900 border-orange-200 shadow-orange-900/10',
    expense: 'bg-amber-50 text-amber-900 border-amber-200 shadow-amber-900/10',
    gross: 'bg-sky-50 text-sky-900 border-sky-200 shadow-sky-900/10',
    operating: 'bg-lime-50 text-lime-900 border-lime-200 shadow-lime-900/10',
    tax: 'bg-rose-50 text-rose-800 border-rose-200 shadow-rose-900/10',
    profit: 'bg-emerald-600 text-white border-emerald-500 shadow-emerald-700/25',
    danger: 'bg-rose-600 text-white border-rose-500 shadow-rose-700/25',
};

const subtleText = {
    source: 'text-white/80',
    center: 'text-white/70',
    cost: 'text-orange-700',
    expense: 'text-amber-700',
    gross: 'text-sky-700',
    operating: 'text-lime-700',
    tax: 'text-rose-600',
    profit: 'text-white/80',
    danger: 'text-white/80',
};

const getTone = (node, fallback) => node?.tone || fallback;

const getNodeWidth = (value, compact = false) => {
    if (compact) return 'min-w-[188px] max-w-[215px]';
    const length = fmt(Math.abs(Number(value) || 0)).length;
    if (length > 15) return 'min-w-[260px]';
    if (length > 12) return 'min-w-[235px]';
    return 'min-w-[215px]';
};

const FlowNode = ({ node, tone, className = '', compact = false }) => {
    if (!node) return null;
    const resolvedTone = getTone(node, tone);
    const value = Number(node.value) || 0;

    return (
        <div className={`rounded-2xl border shadow-xl ${compact ? 'p-4' : 'p-5'} ${toneStyles[resolvedTone]} ${getNodeWidth(value, compact)} ${className}`}>
            <div className={`text-[10px] font-black uppercase tracking-[0.22em] ${subtleText[resolvedTone]}`}>{node.label}</div>
            <div className={`mt-2 whitespace-nowrap font-mono font-black tracking-tight ${compact ? 'text-xl' : 'text-2xl'}`}>{fmt(value)}</div>
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

const flowLabelStyles = {
    cost: 'border-orange-200 bg-orange-50/90 text-orange-700',
    expense: 'border-amber-200 bg-amber-50/90 text-amber-700',
    gross: 'border-sky-200 bg-sky-50/90 text-sky-700',
    operating: 'border-lime-200 bg-lime-50/90 text-lime-700',
    tax: 'border-rose-200 bg-rose-50/90 text-rose-700',
    profit: 'border-emerald-200 bg-emerald-50/90 text-emerald-700',
    danger: 'border-rose-500/30 bg-rose-600/90 text-white',
};

const FlowPathLabel = ({ node, tone, className = '' }) => {
    if (!node?.label) return null;
    return (
        <div className={`pointer-events-none rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em] shadow-sm backdrop-blur ${flowLabelStyles[tone]} ${className}`}>
            {node.flowLabel || node.label}
        </div>
    );
};

const stageLayouts = [
    {
        upClass: 'absolute left-[25%] top-[6%]',
        downClass: 'absolute left-[26%] bottom-[7%]',
        upLabelClass: 'absolute left-[22%] top-[25%]',
        downLabelClass: 'absolute left-[24%] bottom-[34%]',
        upPath: 'M238 242 C318 160, 354 100, 470 100',
        downPath: 'M238 285 C318 334, 356 398, 470 404',
        upGradient: 'executive-stage-cost',
        downGradient: 'executive-stage-gross',
    },
    {
        upClass: 'absolute left-[49%] top-[6%]',
        downClass: 'absolute left-[50%] bottom-[7%]',
        upLabelClass: 'absolute left-[48%] top-[25%]',
        downLabelClass: 'absolute left-[50%] bottom-[34%]',
        upPath: 'M520 404 C586 318, 622 160, 740 104',
        downPath: 'M520 424 C620 444, 676 426, 756 406',
        upGradient: 'executive-stage-expense',
        downGradient: 'executive-stage-operating',
    },
    {
        upClass: 'absolute left-[72%] top-[7%]',
        downClass: 'absolute right-[4%] bottom-[7%]',
        upLabelClass: 'absolute left-[72%] top-[26%]',
        downLabelClass: 'absolute right-[11%] bottom-[34%]',
        upPath: 'M806 406 C866 320, 912 170, 1040 112',
        downPath: 'M806 426 C914 452, 1000 430, 1128 404',
        upGradient: 'executive-stage-tax',
        downGradient: 'executive-stage-net',
    },
];

const defaultStageTones = [
    { up: 'cost', down: 'gross' },
    { up: 'expense', down: 'operating' },
    { up: 'tax', down: 'profit' },
];

const StagedFlowDesktop = ({ source, stages, ribbon }) => (
    <div className="hidden overflow-x-auto md:block">
        <div className="relative min-h-[520px] min-w-[1180px] overflow-hidden bg-gradient-to-br from-white via-[#f8fbff] to-[#fff7e8] p-6">
            <div className="absolute inset-0 opacity-75" style={{ backgroundImage: 'linear-gradient(#e8eef5 1px, transparent 1px), linear-gradient(90deg, #e8eef5 1px, transparent 1px)', backgroundSize: '30px 30px' }} />
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1280 520" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                    <filter id="executive-stage-shadow" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="9" stdDeviation="8" floodColor="#0f172a" floodOpacity="0.14" />
                    </filter>
                    <linearGradient id="executive-stage-cost" x1="0%" y1="100%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#f97316" stopOpacity="0.20" />
                        <stop offset="42%" stopColor="#fb923c" stopOpacity="0.70" />
                        <stop offset="100%" stopColor="#fdba74" stopOpacity="0.96" />
                    </linearGradient>
                    <linearGradient id="executive-stage-gross" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.20" />
                        <stop offset="48%" stopColor="#38c6f4" stopOpacity="0.74" />
                        <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.92" />
                    </linearGradient>
                    <linearGradient id="executive-stage-expense" x1="0%" y1="100%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.18" />
                        <stop offset="45%" stopColor="#fbbf24" stopOpacity="0.76" />
                        <stop offset="100%" stopColor="#fde68a" stopOpacity="0.95" />
                    </linearGradient>
                    <linearGradient id="executive-stage-operating" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#bef264" stopOpacity="0.22" />
                        <stop offset="45%" stopColor="#a3e635" stopOpacity="0.72" />
                        <stop offset="100%" stopColor="#84cc16" stopOpacity="0.86" />
                    </linearGradient>
                    <linearGradient id="executive-stage-tax" x1="0%" y1="100%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#fb7185" stopOpacity="0.18" />
                        <stop offset="42%" stopColor="#fb7185" stopOpacity="0.76" />
                        <stop offset="100%" stopColor="#e11d48" stopOpacity="0.86" />
                    </linearGradient>
                    <linearGradient id="executive-stage-net" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#86efac" stopOpacity="0.20" />
                        <stop offset="42%" stopColor="#22c55e" stopOpacity="0.76" />
                        <stop offset="100%" stopColor="#059669" stopOpacity="0.96" />
                    </linearGradient>
                </defs>
                {stages.map((stage, index) => {
                    const layout = stageLayouts[index];
                    if (!layout) return null;
                    return (
                        <React.Fragment key={stage.id || index}>
                            {stage.up && <path d={layout.upPath} fill="none" stroke={`url(#${layout.upGradient})`} strokeWidth={ribbon(stage.up.value, 16, 58)} strokeLinecap="round" filter="url(#executive-stage-shadow)" />}
                            {stage.down && <path d={layout.downPath} fill="none" stroke={`url(#${layout.downGradient})`} strokeWidth={ribbon(stage.down.value, 18, 62)} strokeLinecap="round" filter="url(#executive-stage-shadow)" />}
                        </React.Fragment>
                    );
                })}
            </svg>

            <div className="absolute left-[4%] top-[37%]"><FlowNode node={source} tone="source" compact /></div>
            {stages.map((stage, index) => {
                const layout = stageLayouts[index];
                const tones = defaultStageTones[index] || defaultStageTones[2];
                if (!layout) return null;
                const upTone = getTone(stage.up, tones.up);
                const downTone = getTone(stage.down, tones.down);
                return (
                    <React.Fragment key={stage.id || index}>
                        {stage.up && <FlowPathLabel node={stage.up} tone={upTone} className={layout.upLabelClass} />}
                        {stage.down && <FlowPathLabel node={stage.down} tone={downTone} className={layout.downLabelClass} />}
                        {stage.up && <div className={layout.upClass}><FlowNode node={stage.up} tone={upTone} compact /></div>}
                        {stage.down && <div className={layout.downClass}><FlowNode node={stage.down} tone={downTone} compact /></div>}
                    </React.Fragment>
                );
            })}
        </div>
    </div>
);

const StagedFlowMobile = ({ source, stages }) => (
    <div className="space-y-3 p-4 md:hidden">
        <MobileStep node={source} tone="source" />
        {stages.map((stage, index) => {
            const tones = defaultStageTones[index] || defaultStageTones[2];
            return (
                <div key={stage.id || index} className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {stage.up && <FlowNode node={stage.up} tone={getTone(stage.up, tones.up)} className="w-full" compact />}
                        {stage.down && <FlowNode node={stage.down} tone={getTone(stage.down, tones.down)} className="w-full" compact />}
                    </div>
                </div>
            );
        })}
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
    stages,
    embedded = false,
}) {
    const hasStages = Array.isArray(stages) && stages.length > 0;
    const stagedValues = hasStages
        ? [source, ...stages.flatMap((stage) => [stage.up, stage.down])]
        : [];
    const values = (hasStages ? stagedValues : [source, center, top, middle, bottom]).map((node) => Math.abs(Number(node?.value) || 0));
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

            {hasStages ? (
                <>
                    <StagedFlowDesktop source={source} stages={stages} ribbon={ribbon} />
                    <StagedFlowMobile source={source} stages={stages} />
                </>
            ) : (
                <>
            <div className="hidden overflow-x-auto md:block">
                <div className="relative min-h-[430px] min-w-[1040px] overflow-hidden bg-gradient-to-br from-white via-[#f8fbff] to-[#fff5ec] p-6">
                    <div className="absolute inset-0 opacity-75" style={{ backgroundImage: 'linear-gradient(#e8eef5 1px, transparent 1px), linear-gradient(90deg, #e8eef5 1px, transparent 1px)', backgroundSize: '30px 30px' }} />
                    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1100 430" preserveAspectRatio="none" aria-hidden="true">
                        <defs>
                            <filter id="executive-flow-shadow" x="-20%" y="-20%" width="140%" height="140%">
                                <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#0f172a" floodOpacity="0.16" />
                            </filter>
                            <linearGradient id="executive-sales" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#16a9e6" stopOpacity="0.92" />
                                <stop offset="58%" stopColor="#38c6f4" stopOpacity="0.82" />
                                <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.48" />
                            </linearGradient>
                            <linearGradient id="executive-cost" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#f97316" stopOpacity="0.18" />
                                <stop offset="28%" stopColor="#fb923c" stopOpacity="0.7" />
                                <stop offset="100%" stopColor="#fdba74" stopOpacity="0.92" />
                            </linearGradient>
                            <linearGradient id="executive-tax" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#fb7185" stopOpacity="0.82" />
                                <stop offset="100%" stopColor="#e11d48" stopOpacity="0.64" />
                            </linearGradient>
                            <linearGradient id="executive-profit" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#22c55e" stopOpacity="0.22" />
                                <stop offset="36%" stopColor="#86efac" stopOpacity="0.72" />
                                <stop offset="100%" stopColor="#16a34a" stopOpacity="0.9" />
                            </linearGradient>
                        </defs>
                        {top && <path d="M250 170 C420 120, 610 54, 912 64" fill="none" stroke="url(#executive-cost)" strokeWidth={ribbon(top.value, 22, 66)} strokeLinecap="round" filter="url(#executive-flow-shadow)" />}
                        <path d="M165 190 C292 190, 386 190, 470 204" fill="none" stroke="url(#executive-sales)" strokeWidth={ribbon(center?.value || source?.value, 34, 72)} strokeLinecap="round" filter="url(#executive-flow-shadow)" />
                        {middle && <path d="M540 218 C660 218, 770 219, 916 219" fill="none" stroke="url(#executive-tax)" strokeWidth={ribbon(middle.value, 10, 34)} strokeLinecap="round" />}
                        {bottom && <path d="M540 252 C650 312, 790 334, 934 336" fill="none" stroke="url(#executive-profit)" strokeWidth={ribbon(bottom.value, 20, 66)} strokeLinecap="round" filter="url(#executive-flow-shadow)" />}
                    </svg>

                    {top && <FlowPathLabel node={{ ...top, flowLabel: top.flowLabel || 'Costo' }} tone="cost" className="absolute left-[27%] top-[22%]" />}
                    {middle && <FlowPathLabel node={middle} tone="tax" className="absolute left-[64%] top-[45%]" />}
                    {bottom && <FlowPathLabel node={bottom} tone="profit" className="absolute left-[66%] bottom-[24%]" />}
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
            )}
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
