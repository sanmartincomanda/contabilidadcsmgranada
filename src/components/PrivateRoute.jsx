// src/components/PrivateRoute.jsx

import React from 'react';
// Asegúrate de que estas rutas sean correctas:
import { useAuth } from '../context/AuthContext'; 
import { Navigate } from 'react-router-dom';

// El componente PrivateRoute DEBE usar 'export default'
export default function PrivateRoute({ element }) {
    const { user, loading } = useAuth();
    
    // 1. Mostrar estado de carga si la autenticación aún no se resuelve
    if (loading) {
        // Puedes usar un spinner si tienes uno, o simplemente este mensaje
        return (
            <div className="flex justify-center items-center min-h-[50vh] text-blue-600">
                Cargando estado de usuario...
            </div>
        );
    }

    // 2. Si hay un usuario, muestra el componente solicitado (element)
    if (user) {
        return element;
    }

    // 3. Si no hay usuario, redirige a la página de login
    return <Navigate to="/login" replace />;
}