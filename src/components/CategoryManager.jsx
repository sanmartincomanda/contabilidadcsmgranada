import React from 'react';
import { APP_BRAND_NAME } from '../constants';
import { EXPENSE_CATEGORY_TREE } from '../services/expenseCategories';

const Card = ({ children, className = '' }) => (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
        {children}
    </div>
);

export default function CategoryManager() {
    const totalSubcategories = EXPENSE_CATEGORY_TREE.reduce((sum, group) => sum + group.subcategories.length, 0);

    return (
        <div className="space-y-5">
            <Card className="overflow-hidden">
                <div className="px-5 py-5">
                    <div className="text-[10px] font-black uppercase tracking-[0.34em] text-[#e30613]">{APP_BRAND_NAME}</div>
                    <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Catalogo fiscal de gastos</h1>
                    <p className="mt-1 max-w-3xl text-sm font-semibold text-slate-500">
                        Esta es la taxonomia oficial usada por gastos, compras, cuentas por pagar, historiales y reportes.
                    </p>
                </div>
                <div className="grid grid-cols-1 border-t border-slate-200 bg-slate-50 sm:grid-cols-3">
                    <div className="border-b border-slate-200 px-5 py-4 sm:border-b-0 sm:border-r">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Categorias</div>
                        <div className="mt-1 text-2xl font-black text-slate-950">{EXPENSE_CATEGORY_TREE.length}</div>
                    </div>
                    <div className="border-b border-slate-200 px-5 py-4 sm:border-b-0 sm:border-r">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Subcategorias</div>
                        <div className="mt-1 text-2xl font-black text-slate-950">{totalSubcategories}</div>
                    </div>
                    <div className="px-5 py-4">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Estado</div>
                        <div className="mt-2 inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-black uppercase tracking-wider text-emerald-700">Activo en toda la app</div>
                    </div>
                </div>
            </Card>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {EXPENSE_CATEGORY_TREE.map((group) => (
                    <Card key={group.category} className="overflow-hidden">
                        <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                            <div className="text-sm font-black uppercase tracking-wide text-slate-900">{group.category}</div>
                            <div className="mt-1 text-xs font-semibold text-slate-400">{group.subcategories.length} subcategorias fiscales</div>
                        </div>
                        <div className="divide-y divide-slate-100">
                            {group.subcategories.map((subcategory) => (
                                <div key={subcategory} className="flex items-center justify-between px-5 py-3">
                                    <span className="text-sm font-bold text-slate-700">{subcategory}</span>
                                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-slate-400">Subcategoria</span>
                                </div>
                            ))}
                        </div>
                    </Card>
                ))}
            </div>
        </div>
    );
}
