// src/context/AuthContext.jsx

import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '../firebase';

const AuthContext = createContext();
const LOCAL_DEV_AUTH_KEY = 'csm-granada-local-dev-auth';
const isDevMode = Boolean(import.meta.env.DEV);
const LOCAL_DEV_AUTH_ENABLED = import.meta.env.VITE_LOCAL_DEV_AUTH_ENABLED === 'true';
const LOCAL_DEV_EMAIL = import.meta.env.VITE_LOCAL_DEV_AUTH_EMAIL || '';
const LOCAL_DEV_PASSWORD = import.meta.env.VITE_LOCAL_DEV_AUTH_PASSWORD || '';
const canUseLocalDevAuth = isDevMode && LOCAL_DEV_AUTH_ENABLED && LOCAL_DEV_EMAIL && LOCAL_DEV_PASSWORD;

const buildLocalDevUser = (email = LOCAL_DEV_EMAIL) => ({
    uid: 'local-dev-admin',
    email,
    providerId: 'local-dev',
    isLocalDevUser: true,
});

const readLocalDevUser = () => {
    if (!canUseLocalDevAuth || typeof window === 'undefined') return null;

    try {
        const raw = window.localStorage.getItem(LOCAL_DEV_AUTH_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.error('No se pudo leer la sesion local de desarrollo:', error);
        return null;
    }
};

const writeLocalDevUser = (user) => {
    if (!canUseLocalDevAuth || typeof window === 'undefined') return;

    try {
        window.localStorage.setItem(LOCAL_DEV_AUTH_KEY, JSON.stringify(user));
    } catch (error) {
        console.error('No se pudo guardar la sesion local de desarrollo:', error);
    }
};

const clearLocalDevUser = () => {
    if (!isDevMode || typeof window === 'undefined') return;

    try {
        window.localStorage.removeItem(LOCAL_DEV_AUTH_KEY);
    } catch (error) {
        console.error('No se pudo limpiar la sesion local de desarrollo:', error);
    }
};

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const localDevUser = readLocalDevUser();
        if (localDevUser) {
            setUser(localDevUser);
            setLoading(false);
            return () => {};
        }

        const unsubscribe = onAuthStateChanged(
            auth,
            (currentUser) => {
                setUser(currentUser);
                setLoading(false);
            },
            (error) => {
                console.error('Error al resolver el estado de autenticacion:', error);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, []);

    const login = (email, password) => {
        if (canUseLocalDevAuth && email === LOCAL_DEV_EMAIL && password === LOCAL_DEV_PASSWORD) {
            const localDevUser = buildLocalDevUser(email);
            writeLocalDevUser(localDevUser);
            setUser(localDevUser);
            return Promise.resolve(localDevUser);
        }

        return signInWithEmailAndPassword(auth, email, password);
    };

    const logout = () => {
        clearLocalDevUser();
        setUser(null);

        if (auth.currentUser) {
            return signOut(auth);
        }

        return Promise.resolve();
    };

    const value = {
        user,
        loading,
        login,
        logout,
    };

    return (
        <AuthContext.Provider value={value}>
            {!loading && children}
        </AuthContext.Provider>
    );
};
