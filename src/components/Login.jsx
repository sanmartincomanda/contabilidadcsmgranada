import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { APP_BRAND_LOGO, APP_BRAND_NAME } from '../constants';

const BRAND_LOGO = APP_BRAND_LOGO;

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoggingIn(true);

        try {
            await login(email, password);
            navigate('/');
        } catch (e) {
            let errorMessage = 'Error al iniciar sesion. Verifica credenciales o conexion.';
            if (e.code === 'auth/user-not-found' || e.code === 'auth/wrong-password') {
                errorMessage = 'Credenciales invalidas.';
            } else if (e.code === 'auth/invalid-email') {
                errorMessage = 'Formato de correo invalido.';
            }
            setError(errorMessage);
            console.error('Error de Login:', e);
        } finally {
            setIsLoggingIn(false);
        }
    };

    return (
        <div className="relative min-h-screen overflow-hidden bg-slate-100">
            <div className="absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.05)_1px,transparent_1px)] bg-[size:28px_28px]" />
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#111827] via-[#e30613] to-[#111827]" />
            <div className="relative mx-auto grid min-h-screen max-w-7xl grid-cols-1 lg:grid-cols-[0.92fr_1.08fr]">
                <aside className="hidden border-r border-slate-200 bg-white/72 px-10 py-10 backdrop-blur-xl lg:flex lg:flex-col">
                    <div className="flex items-center gap-4">
                        <img src={BRAND_LOGO} alt={APP_BRAND_NAME} className="h-16 w-16 rounded-2xl border border-slate-200 bg-white object-contain p-2 shadow-sm" />
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.36em] text-[#e30613]">Centro contable</p>
                            <h1 className="mt-1 text-2xl font-black leading-tight text-slate-950">{APP_BRAND_NAME}</h1>
                        </div>
                    </div>
                    <div className="mt-auto grid gap-3">
                        {['Ingresos', 'Compras', 'Cuentas por pagar', 'Reportes fiscales'].map((item) => (
                            <div key={item} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                                <span className="text-sm font-bold text-slate-700">{item}</span>
                                <span className="h-2 w-2 rounded-full bg-[#e30613]" />
                            </div>
                        ))}
                    </div>
                </aside>

                <main className="flex items-center justify-center px-4 py-10 sm:px-8">
                    <div className="w-full max-w-md">
                        <div className="mb-6 flex items-center gap-3 lg:hidden">
                            <img src={BRAND_LOGO} alt={APP_BRAND_NAME} className="h-14 w-14 rounded-2xl border border-slate-200 bg-white object-contain p-2 shadow-sm" />
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-[0.32em] text-[#e30613]">Centro contable</p>
                                <h1 className="text-lg font-black text-slate-950">{APP_BRAND_NAME}</h1>
                            </div>
                        </div>

                        <section className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-2xl shadow-slate-950/10">
                            <div className="border-b border-slate-200 bg-slate-950 px-6 py-5 text-white">
                                <p className="text-[10px] font-black uppercase tracking-[0.34em] text-red-200">Acceso seguro</p>
                                <h2 className="mt-2 text-2xl font-black">Iniciar sesión</h2>
                                <p className="mt-1 text-sm font-medium text-white/55">Operación financiera y fiscal</p>
                            </div>

                            <div className="p-6 sm:p-7">
                                {error && (
                                    <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
                                        {error}
                                    </div>
                                )}

                                <form className="space-y-4" onSubmit={handleSubmit}>
                                    <div>
                                        <label htmlFor="email" className="mb-2 block text-xs font-black uppercase text-slate-500">
                                            Correo electrónico
                                        </label>
                                        <input
                                            id="email"
                                            name="email"
                                            type="email"
                                            autoComplete="email"
                                            required
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            disabled={isLoggingIn}
                                            className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none"
                                        />
                                    </div>

                                    <div>
                                        <label htmlFor="password" className="mb-2 block text-xs font-black uppercase text-slate-500">
                                            Contraseña
                                        </label>
                                        <input
                                            id="password"
                                            name="password"
                                            type="password"
                                            autoComplete="current-password"
                                            required
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            disabled={isLoggingIn}
                                            className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none"
                                        />
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={isLoggingIn}
                                        className="motion-button w-full rounded-xl bg-[#e30613] px-4 py-3 text-sm font-black uppercase tracking-[0.22em] text-white shadow-lg shadow-red-600/20 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {isLoggingIn ? 'Ingresando...' : 'Entrar al ERP'}
                                    </button>
                                </form>
                            </div>
                        </section>
                    </div>
                </main>
            </div>
        </div>
    );
}
