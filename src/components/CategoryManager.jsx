// src/components/CategoryManager.jsx

import React, { useState } from 'react'; // Eliminamos useEffect
import { db } from '../firebase';
// Solo necesitamos addDoc, updateDoc, deleteDoc, doc para manipular, 
// no necesitamos collection, onSnapshot, query, orderBy
import { addDoc, updateDoc, deleteDoc, doc, collection } from 'firebase/firestore'; 

const Card = ({ title, children, className = '' }) => (
    <div className={`rounded-2xl shadow-sm border border-neutral-200 bg-white p-4 ${className}`}>
        <div className="text-lg font-semibold text-neutral-700 mb-3">{title}</div>
        {children}
    </div>
);

// CORRECCIÓN: Quitamos setCategories y onDataChange de props. Categories ya viene cargada de App.jsx
export default function CategoryManager({ categories }) { 
    const [newCategoryName, setNewCategoryName] = useState('');
    const [loading, setLoading] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [editingName, setEditingName] = useState('');

    // ELIMINADO: Todo el bloque useEffect con onSnapshot
    // App.jsx ya está escuchando la colección 'categorias'

const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    setLoading(true);
    try {
        // *** ESTA LÍNEA ES CRÍTICA Y DEPENDE DE LOS PERMISOS DE ESCRITURA ***
        await addDoc(collection(db, 'categorias'), {
            name: newCategoryName.trim(),
        });
        setNewCategoryName('');
        // Al tener éxito, el listener en App.jsx DEBE actualizar la prop 'categories'.
    } catch (error) {
        console.error("Error al agregar categoría:", error);
    } finally {
        setLoading(false);
    }
};

    const handleUpdateCategory = async (id) => {
        if (!editingName.trim()) return;
        setLoading(true);
        try {
            const catRef = doc(db, 'categorias', id);
            await updateDoc(catRef, { name: editingName.trim() });
            setEditingId(null);
        } catch (error) {
            console.error("Error al actualizar categoría:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteCategory = async (id) => {
        if (!window.confirm('¿Estás seguro de que quieres eliminar esta categoría?')) return;
        setLoading(true);
        try {
            await deleteDoc(doc(db, 'categorias', id));
        } catch (error) {
            console.error("Error al eliminar categoría:", error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card title="Gestión de Categorías" className="max-w-xl mx-auto">
            
            {/* Formulario de Adición */}
            <div className="mb-6 p-4 border rounded-lg bg-neutral-50">
                <h3 className="text-md font-semibold mb-2">Agregar Nueva Categoría</h3>
                <div className="flex space-x-2">
                    <input
                        type="text"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        placeholder="Nombre de la categoría (ej. Sueldos, Alquiler)"
                        className="flex-grow rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
                        disabled={loading}
                    />
                    <button
                        onClick={handleAddCategory}
                        disabled={loading || !newCategoryName.trim()}
                        className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition"
                    >
                        {loading ? 'Agregando...' : 'Agregar'}
                    </button>
                </div>
            </div>

            {/* Lista de Categorías */}
            <h3 className="text-md font-semibold mt-6 mb-2">Lista de Categorías ({categories.length})</h3>
            <div className="border rounded-lg overflow-hidden divide-y divide-neutral-100">
                {categories.length === 0 ? (
                    <div className="p-4 text-center text-neutral-500 text-sm">No hay categorías. Agrega la primera.</div>
                ) : (
                    categories.map(cat => (
                        <div key={cat.id} className="p-3 flex justify-between items-center text-sm">
                            {editingId === cat.id ? (
                                <input
                                    type="text"
                                    value={editingName}
                                    onChange={(e) => setEditingName(e.target.value)}
                                    className="rounded border border-blue-300 px-1 text-sm w-full mr-2"
                                />
                            ) : (
                                <span className="text-neutral-700 font-medium">{cat.name}</span>
                            )}
                            <div className="flex space-x-2 flex-shrink-0">
                                {editingId === cat.id ? (
                                    <button onClick={() => handleUpdateCategory(cat.id)} disabled={loading} className="text-blue-500 hover:text-blue-700 disabled:opacity-50">Guardar</button>
                                ) : (
                                    <button onClick={() => { setEditingId(cat.id); setEditingName(cat.name); }} disabled={loading} className="text-yellow-600 hover:text-yellow-700 disabled:opacity-50">Editar</button>
                                )}
                                <button onClick={() => handleDeleteCategory(cat.id)} disabled={loading} className="text-red-600 hover:text-red-700 disabled:opacity-50">Eliminar</button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </Card>
    );
}