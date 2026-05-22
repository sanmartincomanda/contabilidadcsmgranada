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
        <div className="relative min-h-screen overflow-hidden bg-[#fff8f2]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(242,182,53,0.18),transparent_28rem),radial-gradient(circle_at_bottom_right,rgba(168,29,36,0.15),transparent_24rem)]" />
            <div className="relative mx-auto flex min-h-screen max-w-6xl items-center px-4 py-12 sm:px-6 lg:px-8">
                <div className="grid w-full gap-8 lg:grid-cols-[1.1fr_0.9fr]">
                    <div className="flex flex-col justify-center">
                        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[#f2b635]/45 bg-[#fff1d5] px-4 py-2 text-xs font-bold uppercase tracking-[0.35em] text-[#8a141b]">
                            Historia y calidad
                        </div>
                        <h1 className="mt-6 text-5xl font-black leading-tight text-[#7f1218] lg:text-6xl">
                            Centro Contable {APP_BRAND_NAME}
                        </h1>
                        <p className="mt-5 max-w-xl text-base font-medium leading-8 text-[#5f4540] lg:text-lg">
                            Una experiencia visual alineada con la marca para gestionar ingresos, costos, cuentas por pagar y reportes desde un solo lugar.
                        </p>
                        <div className="mt-8 flex flex-wrap gap-4">
                            <div className="rounded-2xl border border-[#ead6ca] bg-white/85 px-5 py-4 shadow-lg shadow-[#7f1218]/5">
                                <div className="text-xs font-bold uppercase tracking-[0.25em] text-[#b98b2d]">Marca</div>
                                <div className="mt-2 text-lg font-black text-[#7f1218]">{APP_BRAND_NAME}</div>
                            </div>
                            <div className="rounded-2xl border border-[#ead6ca] bg-white/85 px-5 py-4 shadow-lg shadow-[#7f1218]/5">
                                <div className="text-xs font-bold uppercase tracking-[0.25em] text-[#b98b2d]">Enfoque</div>
                                <div className="mt-2 text-lg font-black text-[#7f1218]">Control financiero</div>
                            </div>
                        </div>
                    </div>

                    <div className="relative">
                        <div className="absolute inset-6 rounded-[2.5rem] bg-[#a81d24]/10 blur-3xl" />
                        <div className="relative overflow-hidden rounded-[2rem] border border-[#ebd4c8] bg-white/92 p-6 shadow-[0_30px_80px_rgba(127,18,24,0.16)] sm:p-8">
                            <div className="mb-6 flex items-center gap-4">
                                <div className="rounded-[1.5rem] border border-[#f0ddd2] bg-[#fff8f3] p-2 shadow-lg shadow-[#7f1218]/5">
                                    <img
                                        src={BRAND_LOGO}
                                        alt={APP_BRAND_NAME}
                                        className="h-20 w-20 rounded-[1.1rem] object-cover"
                                    />
                                </div>
                                <div>
                                    <p className="text-xs font-bold uppercase tracking-[0.35em] text-[#b98b2d]">Acceso seguro</p>
                                    <h2 className="mt-2 text-2xl font-black text-[#7f1218]">Iniciar sesion</h2>
                                </div>
                            </div>

                            {error && (
                                <div className="mb-5 rounded-2xl border border-[#f0c9c3] bg-[#fff1ef] p-4 text-sm font-semibold text-[#8a141b]">
                                    {error}
                                </div>
                            )}

                            <form className="space-y-5" onSubmit={handleSubmit}>
                                <div>
                                    <label htmlFor="email" className="mb-2 block text-sm font-bold uppercase tracking-[0.22em] text-[#7f1218]">
                                        Correo electronico
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
                                        className="block w-full rounded-2xl border border-[#e7d5ca] bg-[#fffdfa] px-4 py-3 text-sm font-semibold text-[#392829] shadow-sm outline-none transition focus:border-[#a81d24] focus:ring-4 focus:ring-[#a81d24]/10"
                                    />
                                </div>

                                <div>
                                    <label htmlFor="password" className="mb-2 block text-sm font-bold uppercase tracking-[0.22em] text-[#7f1218]">
                                        Contrasena
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
                                        className="block w-full rounded-2xl border border-[#e7d5ca] bg-[#fffdfa] px-4 py-3 text-sm font-semibold text-[#392829] shadow-sm outline-none transition focus:border-[#a81d24] focus:ring-4 focus:ring-[#a81d24]/10"
                                    />
                                </div>

                                <button
                                    type="submit"
                                    disabled={isLoggingIn}
                                    className="w-full rounded-2xl bg-gradient-to-r from-[#a81d24] to-[#7f1218] px-4 py-3 text-sm font-black uppercase tracking-[0.28em] text-white shadow-lg shadow-[#a81d24]/25 transition hover:scale-[1.01] hover:from-[#b31f27] hover:to-[#8a141b] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {isLoggingIn ? 'Ingresando...' : 'Entrar'}
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
