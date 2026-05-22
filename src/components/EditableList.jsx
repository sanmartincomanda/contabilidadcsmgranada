// src/components/EditableList.jsx

import React, { useState } from 'react';
import { db } from '../firebase';
import { doc, updateDoc, deleteDoc, Timestamp } from 'firebase/firestore';
// Asume que 'fmt' está disponible en tus constantes para formatear moneda
import { fmt } from '../constants'; 

// --- Subcomponente: EditableRow (Mismos cambios que ya estaban) ---
const EditableRow = ({ item, collectionName, fields, currency, onUpdate, onDelete }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editData, setEditData] = useState(item);
    const [loading, setLoading] = useState(false);

    const handleSave = async () => {
        setLoading(true);
        try {
            const dataToSave = {};
            for (const key in editData) {
                if (key === 'id') continue; 
                if (fields[key]?.type === 'number' || fields[key]?.type === 'currency') {
                    dataToSave[key] = parseFloat(editData[key]);
                } else if (key === 'timestamp') {
                    continue; 
                } else {
                    dataToSave[key] = editData[key];
                }
            }
            
            const docRef = doc(db, collectionName, item.id);
            await updateDoc(docRef, dataToSave);
            
            setIsEditing(false);
            onUpdate(item.id, dataToSave);
        } catch (error) {
            console.error("Error al actualizar el documento:", error);
            alert("Error al guardar: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!window.confirm("¿Estás seguro de que quieres eliminar este registro?")) return;
        setLoading(true);
        try {
            const docRef = doc(db, collectionName, item.id);
            await deleteDoc(docRef);
            onDelete(item.id);
        } catch (error) {
            console.error("Error al eliminar el documento:", error);
            alert("Error al eliminar: " + error.message);
        } finally {
            setLoading(false);
        }
    };
    
    // Función para renderizar el valor
    const renderValue = (key, value) => {
        const field = fields[key];
        
        if (value === null || value === undefined) return 'N/A'; 

        if (typeof value === 'object' && value instanceof Timestamp && 'toDate' in value) {
            try {
                return value.toDate().toLocaleString(); 
            } catch (e) {
                return 'Invalid Date';
            }
        }
        
        if (field?.type === 'currency') return fmt(Number(value), currency);
        
        return String(value); 
    };

    // Función para renderizar el input
    const renderInput = (key, value) => {
        const field = fields[key];
        const type = field?.type === 'currency' ? 'number' : field?.type === 'date' ? 'date' : field?.type === 'month' ? 'month' : 'text';
        
        if (key === 'timestamp' || field?.type === 'date-time') {
            return <span className='text-neutral-500'>No Editable</span>;
        }

        const displayValue = value === null || value === undefined ? '' : String(value);

        return (
            <input
                type={type}
                step={type === 'number' ? '0.01' : undefined}
                value={type === 'month' ? displayValue.substring(0, 7) : displayValue}
                onChange={(e) => setEditData({ ...editData, [key]: e.target.value })}
                className="w-full rounded border border-blue-300 px-1 text-xs"
                disabled={loading}
            />
        );
    };

    return (
        <tr className="border-t border-neutral-100 text-xs">
            {Object.keys(fields).map(key => (
                <td key={key} className="py-2 pr-3">
                    {isEditing ? renderInput(key, editData[key]) : renderValue(key, item[key])}
                </td>
            ))}
            <td className="py-2 pr-3 whitespace-nowrap">
                {isEditing ? (
                    <div className='flex space-x-1'>
                        <button onClick={handleSave} disabled={loading || !item.id} className="bg-blue-500 text-white px-1 py-0.5 rounded text-xs hover:bg-blue-600 disabled:opacity-50">Guardar</button>
                        <button onClick={() => setIsEditing(false)} disabled={loading} className="bg-gray-500 text-white px-1 py-0.5 rounded text-xs hover:bg-gray-600 disabled:opacity-50">Cancelar</button>
                    </div>
                ) : (
                    <div className='flex space-x-1'>
                        <button onClick={() => setIsEditing(true)} disabled={!item.id} className="bg-yellow-500 text-white px-1 py-0.5 rounded text-xs hover:bg-yellow-600 disabled:opacity-50">Editar</button>
                        <button onClick={handleDelete} disabled={loading || !item.id} className="bg-red-500 text-white px-1 py-0.5 rounded text-xs hover:bg-red-600 disabled:opacity-50">Eliminar</button>
                    </div>
                )}
            </td>
        </tr>
    );
};


// --- Componente Principal: EditableList ---
export function EditableList({ 
    data, 
    collectionName, 
    fields, 
    currency = 'C$', 
    title, 
    onDataChange,
    // PROPS DE FILTRO
    showMonthFilter = false, 
    filterMonth,            
    onFilterChange          
}) {
    
    const handleUpdate = (id, newData) => {
        const updatedData = data.map(item => item.id === id ? { ...item, ...newData } : item);
        onDataChange(updatedData);
    };

    const handleDelete = (id) => {
        const filteredData = data.filter(item => item.id !== id);
        onDataChange(filteredData);
    };

    const hasData = data && data.length > 0;
    
    // Renderizado del filtro (se usa tanto si hay datos como si no)
    const filterComponent = showMonthFilter && (
        <div className="mb-4 flex items-center space-x-2">
            <label className="text-sm font-medium text-neutral-600">
                Filtrar por Mes:
            </label>
            <input
                type="month"
                value={filterMonth}
                onChange={(e) => onFilterChange(e.target.value)} 
                className="p-1 border border-neutral-300 rounded-md text-sm"
            />
        </div>
    );

    if (!hasData) {
        return (
            <div className="mt-6">
                <h3 className="text-md font-semibold mb-3">{title}</h3>
                {filterComponent} {/* Se muestra el filtro aunque no haya data */}
                <div className="p-4 border rounded-lg bg-neutral-50 text-neutral-500 text-center text-sm">
                    {showMonthFilter && filterMonth 
                        ? `No hay registros para el mes ${filterMonth}.` 
                        : "No hay registros recientes para mostrar. ¡Empieza a registrar datos!"}
                </div>
            </div>
        );
    }

    return (
        <div className="mt-6">
            <h3 className="text-md font-semibold mb-3">{title}</h3>
            {filterComponent} {/* Se muestra el filtro con la data */}
            <div className="overflow-x-auto max-h-96 border rounded-lg shadow-md">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left text-neutral-500 sticky top-0 bg-neutral-100 border-b">
                            {Object.values(fields).map(field => (
                                <th key={field.label} className="py-2 px-3 whitespace-nowrap">{field.label}</th>
                            ))}
                            <th className="py-2 px-3">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.map(item => (
                            <EditableRow 
                                key={item.id} 
                                item={item} 
                                collectionName={collectionName} 
                                fields={fields} 
                                currency={currency}
                                onUpdate={handleUpdate}
                                onDelete={handleDelete}
                            />
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}