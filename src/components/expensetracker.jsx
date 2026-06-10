// src/components/ExpenseTracker.jsx

import React, { useState } from 'react';
import { db } from '../firebase'; // La ruta '../firebase' es correcta si estás en src/components/
import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { EXPENSE_CATEGORY_OPTIONS, buildExpenseCategoryPayload } from '../services/expenseCategories';

// --- Constantes de la aplicación ---
const CATEGORIES = EXPENSE_CATEGORY_OPTIONS.map((option) => option.label);
export const BRANCHES = [
    { id: 'granada', name: 'Distribuidora Granada San Martín' },
    { id: 'inmaculada', name: 'Distribuidora Granada Inmaculada (en proceso)' },
    { id: 'ruta1', name: 'Ruta 1' },
    { id: 'ruta2', name: 'Ruta 2' },
    { id: 'ruta3', name: 'Ruta 3' },
];

// --- Componentes Reutilizables ---
const Card = ({ title, children, className = '' }) => (
    <div className={`rounded-2xl shadow-sm border border-neutral-200 bg-white p-4 ${className}`}>
        <div className="text-lg font-semibold text-neutral-700 mb-3">{title}</div>
        {children}
    </div>
);
const NumberInput = ({ value, onChange, placeholder = '0.00', step = '0.01' }) => (
    <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        placeholder={placeholder}
    />
);
const TextInput = ({ value, onChange, placeholder = '' }) => (
    <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        placeholder={placeholder}
    />
);
const fmt = (n, currency = 'C$') =>
    `${currency} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const branchName = (id) => BRANCHES.find(b => b.id === id)?.name || id;

// --- Componente Principal (con corrección de prop) ---
export default function expensetracker({ currentExpenses = [], isLoading }) {
    //                                  ^^^^^^^^^^^^^^^^^ <-- CORRECCIÓN

    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [category, setCategory] = useState(CATEGORIES[0]);
    const [branch, setBranch] = useState(BRANCHES[0].id);
    const [loading, setLoading] = useState(false);

    // FUNCIÓN PARA REGISTRAR EL GASTO EN FIREBASE
    const handleSubmit = async (e) => {
        e.preventDefault();
        const numAmount = Number(amount);
        if (!description || isNaN(numAmount) || numAmount <= 0) {
            alert('Por favor, ingresa un monto válido y una descripción.');
            return;
        }

        setLoading(true);
        try {
            const categoryPayload = buildExpenseCategoryPayload(category);
            await addDoc(collection(db, 'gastos'), {
                description,
                amount: numAmount,
                ...categoryPayload,
                branch,
                date: Timestamp.now(), 
            });
            // Limpiar formulario al éxito
            setDescription('');
            setAmount('');
        } catch (error) {
            console.error('Error al añadir documento: ', error);
            alert('Hubo un error al registrar el gasto. Revisa la consola.');
        } finally {
            setLoading(false);
        }
    };

    const totalGastos = currentExpenses.reduce((acc, expense) => acc + expense.amount, 0);

    return (
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Panel de Registro */}
            <div className="lg:col-span-1">
                <Card title="Registrar Nuevo Gasto (en Firebase)">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-1">
                            <label className="text-sm font-medium block">Descripción</label>
                            <TextInput value={description} onChange={setDescription} placeholder="Ej: Pago de Luz Oficina Principal" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium block">Monto ({fmt(0, 'C$').split(' ')[0]})</label>
                            <NumberInput value={amount} onChange={setAmount} placeholder="150.00" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium block">Categoría</label>
                            <select
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            >
                                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium block">Sucursal</label>
                            <select
                                value={branch}
                                onChange={(e) => setBranch(e.target.value)}
                                className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            >
                                {BRANCHES.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                        </div>
                        <button
                            type="submit"
                            disabled={loading}
                            className={`w-full rounded-lg text-white px-3 py-2 font-medium transition ${loading ? 'bg-gray-400' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                        >
                            {loading ? 'Guardando...' : 'Guardar Gasto'}
                        </button>
                    </form>
                </Card>
            </div>

            {/* Panel de Lista de Gastos */}
            <div className="lg:col-span-2">
                <Card title={`Gastos Registrados Recientes (Total: ${isLoading ? 'Cargando...' : fmt(totalGastos, 'C$')})`} className="h-full">
                    <div className="overflow-x-auto max-h-96">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-neutral-500 sticky top-0 bg-white border-b">
                                    <th className="py-2 pr-3">Fecha</th>
                                    <th className="py-2 pr-3">Monto</th>
                                    <th className="py-2 pr-3">Sucursal</th>
                                    <th className="py-2 pr-3">Categoría</th>
                                    <th className="py-2">Descripción</th>
                                </tr>
                            </thead>
                            <tbody>
                                {isLoading ? (
                                    <tr><td colSpan="5" className="py-4 text-center text-neutral-500">Cargando gastos de Firebase...</td></tr>
                                ) : currentExpenses.length === 0 ? (
                                    <tr><td colSpan="5" className="py-4 text-center text-neutral-500">No hay gastos registrados en Firebase.</td></tr>
                                ) : (
                                    currentExpenses.map((expense) => (
                                        <tr key={expense.id} className="border-t border-neutral-100">
                                            <td className="py-2 pr-3">{expense.date}</td>
                                            <td className="py-2 pr-3 font-semibold">{fmt(expense.amount, 'C$')}</td>
                                            <td className="py-2 pr-3">{branchName(expense.branch)}</td>
                                            <td className="py-2 pr-3">{expense.category}</td>
                                            <td className="py-2 text-neutral-600">{expense.description}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>
            </div>
        </div>
    );
}
