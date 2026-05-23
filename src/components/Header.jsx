import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import React, { useState, useEffect, useRef } from 'react';
import { APP_BRAND_LOGO, APP_BRAND_NAME, APP_BRAND_WORDMARK_BOTTOM, APP_BRAND_WORDMARK_TOP } from '../constants';

const BRAND_LOGO = APP_BRAND_LOGO;

const Icons = {
    home: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
    plus: "M12 4v16m8-8H4",
    wallet: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
    creditCard: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
    chart: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
    tag: "M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z",
    check: "M5 13l4 4L19 7",
    menu: "M4 6h16M4 12h16M4 18h16",
    x: "M6 18L18 6M6 6l12 12",
    logout: "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1",
    user: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
    chevronDown: "M19 9l-7 7-7-7",
    cash: "M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z",
    receipt: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01",
    trendingUp: "M13 7h8m0 0v8m0-8l-8-8-4 4-6-6",
    trendingDown: "M13 17h8m0 0V9m0 8l-8-8-4 4-6-6",
    bot: "M9.75 17L9 20l-1.5-3M14.25 17l.75 3 1.5-3M7 8h10M7 12h10m-5-9v2m-6 8a6 6 0 1112 0v3a2 2 0 01-2 2H8a2 2 0 01-2-2v-3z"
};

const Icon = ({ path, className = 'w-5 h-5' }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
);

const dropdownBase =
    'rounded-2xl border border-[#efd8c8] bg-white/95 shadow-2xl shadow-[#7f1218]/10 ring-1 ring-[#7f1218]/5 backdrop-blur';

export default function Header() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isScrolled, setIsScrolled] = useState(false);
    const dropdownRef = useRef(null);

    const isAdmin = user?.email !== 'adriandiazc95@gmail.com';
    const hasDailyExpensesAccess = user?.email === 'adriandiazc95@gmail.com' || isAdmin;

    useEffect(() => {
        const handleScroll = () => setIsScrolled(window.scrollY > 10);
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsMenuOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleLogout = async () => {
        try {
            await logout();
            navigate('/login');
        } catch (e) {
            console.error('Error al cerrar sesion', e);
        }
    };

    const isActive = (path) => location.pathname === path || location.pathname.startsWith(path);

    const handleDataEntryClick = (tab) => {
        navigate(`/ingresar?tab=${tab}`);
        setIsMenuOpen(false);
        setIsMobileMenuOpen(false);
    };

    const NavLink = ({ to, children, icon, active = false, onClick }) => (
        <Link
            to={to}
            onClick={onClick}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all duration-200 ${
                active
                    ? 'bg-[#a81d24] text-white shadow-lg shadow-[#a81d24]/30'
                    : 'text-[#f8ece2] hover:bg-white/10 hover:text-white'
            }`}
        >
            {icon && <Icon path={Icons[icon]} className="w-4 h-4" />}
            {children}
        </Link>
    );

    const DataEntryButton = () => {
        if (!isAdmin) return null;

        return (
            <div className="relative" ref={dropdownRef}>
                <button
                    onClick={() => setIsMenuOpen((prev) => !prev)}
                    className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all duration-200 ${
                        isMenuOpen || location.pathname === '/ingresar'
                            ? 'bg-[#f2b635] text-[#651317] shadow-lg shadow-[#f2b635]/25'
                            : 'text-[#f8ece2] hover:bg-white/10 hover:text-white'
                    }`}
                >
                    <Icon path={Icons.plus} className="w-4 h-4" />
                    Ingresar Datos
                    <Icon path={Icons.chevronDown} className={`w-3 h-3 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {isMenuOpen && (
                    <div className={`absolute left-0 top-full z-50 mt-3 w-64 overflow-hidden ${dropdownBase}`}>
                        <div className="border-b border-[#f1dfd1] bg-[#fff8f2] px-4 py-3">
                            <div className="text-xs font-bold uppercase tracking-[0.3em] text-[#b98b2d]">{APP_BRAND_NAME}</div>
                            <div className="mt-1 text-sm font-black text-[#7f1218]">Registro operativo</div>
                        </div>
                        <div className="p-2">
                            <button
                                onClick={() => handleDataEntryClick('Ingresos')}
                                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-[#5d413d] transition hover:bg-[#edf8f0] hover:text-[#166534]"
                            >
                                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e3f7e8] text-[#1e7a44]">
                                    <Icon path={Icons.trendingUp} className="w-4 h-4" />
                                </div>
                                <div>
                                    <div className="font-black">Ingresos</div>
                                    <div className="text-xs text-[#92736f]">Ventas y movimientos del dia</div>
                                </div>
                            </button>
                            <button
                                onClick={() => handleDataEntryClick('Gastos')}
                                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-[#5d413d] transition hover:bg-[#fff0ef] hover:text-[#8a141b]"
                            >
                                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#fde2de] text-[#a81d24]">
                                    <Icon path={Icons.trendingDown} className="w-4 h-4" />
                                </div>
                                <div>
                                    <div className="font-black">Gastos</div>
                                    <div className="text-xs text-[#92736f]">Egresos y pagos operativos</div>
                                </div>
                            </button>
                            <button
                                onClick={() => handleDataEntryClick('Inventario')}
                                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-[#5d413d] transition hover:bg-[#fff7e7] hover:text-[#8a5a11]"
                            >
                                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#fff0c8] text-[#b67812]">
                                    <Icon path={Icons.wallet} className="w-4 h-4" />
                                </div>
                                <div>
                                    <div className="font-black">Inventario</div>
                                    <div className="text-xs text-[#92736f]">Control y valorizacion</div>
                                </div>
                            </button>
                            <button
                                onClick={() => handleDataEntryClick('Presupuesto')}
                                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-[#5d413d] transition hover:bg-[#fff5ee] hover:text-[#9a4a0e]"
                            >
                                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#ffe8d5] text-[#bb5d1f]">
                                    <Icon path={Icons.chart} className="w-4 h-4" />
                                </div>
                                <div>
                                    <div className="font-black">Presupuesto</div>
                                    <div className="text-xs text-[#92736f]">Planificacion mensual</div>
                                </div>
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <>
            <style>{`
                @keyframes fade-in {
                    from { opacity: 0; transform: translateY(-10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .animate-fade-in { animation: fade-in 0.2s ease-out; }
            `}</style>

            <nav
                className={`fixed left-0 right-0 top-0 z-50 transition-all duration-300 ${
                    isScrolled
                        ? 'bg-gradient-to-r from-[#2b1113]/95 via-[#5e1318]/95 to-[#8a141b]/95 shadow-2xl shadow-[#2b1113]/30 backdrop-blur-xl'
                        : 'bg-gradient-to-r from-[#2b1113] via-[#5e1318] to-[#8a141b]'
                }`}
            >
                <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                    <div className="flex h-20 items-center justify-between">
                        <Link to="/" className="group flex items-center gap-4">
                            <div className="rounded-[1.4rem] border border-white/20 bg-[#fff7ef] p-1.5 shadow-lg shadow-black/10 transition group-hover:scale-[1.02]">
                                <img
                                    src={BRAND_LOGO}
                                    alt={APP_BRAND_NAME}
                                    className="h-12 w-12 rounded-[1rem] object-cover"
                                />
                            </div>
                            <div className="hidden sm:block">
                                <div className="text-lg font-black uppercase tracking-[0.12em] text-[#f2b635]">{APP_BRAND_WORDMARK_TOP}</div>
                                <div className="-mt-1 text-2xl font-black text-white">{APP_BRAND_WORDMARK_BOTTOM}</div>
                                <div className="text-[11px] font-bold uppercase tracking-[0.28em] text-[#f8d8c8]">
                                    Centro contable
                                </div>
                            </div>
                        </Link>

                        {user && (
                            <div className="hidden items-center gap-1 md:flex">
                                <NavLink to="/" icon="home" active={location.pathname === '/'}>
                                    Inicio
                                </NavLink>

                                <DataEntryButton />

                                {hasDailyExpensesAccess && (
                                    <NavLink to="/gastos-diarios" icon="cash" active={isActive('/gastos-diarios')}>
                                        Gastos Diarios
                                    </NavLink>
                                )}

                                <NavLink to="/cuentas-pagar" icon="creditCard" active={isActive('/cuentas-pagar')}>
                                    Cuentas por Pagar
                                </NavLink>

                                {isAdmin && (
                                    <>
                                        <NavLink to="/conciliacion" icon="check" active={isActive('/conciliacion')}>
                                            Conciliacion
                                        </NavLink>
                                        <NavLink to="/agente-ia" icon="bot" active={isActive('/agente-ia')}>
                                            MARTIN IA
                                        </NavLink>
                                        <NavLink to="/reportes" icon="chart" active={isActive('/reportes')}>
                                            Reportes
                                        </NavLink>
                                        <NavLink to="/maestros/categorias" icon="tag" active={isActive('/maestros')}>
                                            Categorias
                                        </NavLink>
                                    </>
                                )}

                                <div className="ml-4 flex items-center gap-3 border-l border-white/15 pl-4">
                                    <div className="hidden lg:flex flex-col items-end">
                                        <span className="text-sm font-black text-white">{user.email.split('@')[0]}</span>
                                        <span className="text-xs font-medium text-[#f3d3c2]">{user.email}</span>
                                    </div>
                                    <button
                                        onClick={handleLogout}
                                        className="flex items-center gap-2 rounded-xl border border-[#f2b635]/35 bg-[#f2b635]/12 px-4 py-2.5 text-sm font-bold text-[#ffe9b3] transition hover:bg-[#f2b635] hover:text-[#651317] hover:shadow-lg hover:shadow-[#f2b635]/20"
                                    >
                                        <Icon path={Icons.logout} className="w-4 h-4" />
                                        <span className="hidden sm:inline">Salir</span>
                                    </button>
                                </div>
                            </div>
                        )}

                        {user && (
                            <div className="md:hidden">
                                <button
                                    onClick={() => setIsMobileMenuOpen((prev) => !prev)}
                                    className="rounded-xl border border-white/15 bg-white/5 p-2 text-[#f8ece2] transition hover:bg-white/10 hover:text-white"
                                >
                                    <Icon path={isMobileMenuOpen ? Icons.x : Icons.menu} className="w-6 h-6" />
                                </button>
                            </div>
                        )}

                        {!user && (
                            <Link
                                to="/login"
                                className="flex items-center gap-2 rounded-xl bg-[#f2b635] px-5 py-2.5 text-sm font-black uppercase tracking-[0.2em] text-[#651317] shadow-lg shadow-[#f2b635]/25 transition hover:bg-[#f6c24a]"
                            >
                                <Icon path={Icons.user} className="w-4 h-4" />
                                Entrar
                            </Link>
                        )}
                    </div>
                </div>

                {isMobileMenuOpen && user && (
                    <div className="animate-fade-in border-t border-white/10 bg-gradient-to-b from-[#531418]/95 to-[#2b1113]/95 backdrop-blur-xl md:hidden">
                        <div className="space-y-1 px-4 pb-4 pt-3">
                            <div className="mb-2 rounded-2xl border border-white/10 bg-white/5 p-4">
                                <div className="flex items-center gap-3">
                                    <img
                                        src={BRAND_LOGO}
                                        alt={APP_BRAND_NAME}
                                        className="h-12 w-12 rounded-[1rem] border border-white/15 object-cover"
                                    />
                                    <div>
                                        <div className="text-sm font-black text-white">{user.email}</div>
                                        <div className="text-[11px] font-bold uppercase tracking-[0.28em] text-[#f2b635]">
                                            {APP_BRAND_NAME}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <NavLink to="/" icon="home" active={location.pathname === '/'} onClick={() => setIsMobileMenuOpen(false)}>
                                Inicio
                            </NavLink>

                            {isAdmin && (
                                <>
                                    <div className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-[0.32em] text-[#f2b635]">
                                        Ingresar datos
                                    </div>
                                    <button
                                        onClick={() => handleDataEntryClick('Ingresos')}
                                        className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-bold text-[#f8ece2] transition hover:bg-white/10 hover:text-white"
                                    >
                                        <Icon path={Icons.trendingUp} className="w-5 h-5 text-[#6bd18f]" />
                                        Ingresos
                                    </button>
                                    <button
                                        onClick={() => handleDataEntryClick('Gastos')}
                                        className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-bold text-[#f8ece2] transition hover:bg-white/10 hover:text-white"
                                    >
                                        <Icon path={Icons.trendingDown} className="w-5 h-5 text-[#f2968f]" />
                                        Gastos
                                    </button>
                                    <button
                                        onClick={() => handleDataEntryClick('Inventario')}
                                        className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-bold text-[#f8ece2] transition hover:bg-white/10 hover:text-white"
                                    >
                                        <Icon path={Icons.wallet} className="w-5 h-5 text-[#f2b635]" />
                                        Inventario
                                    </button>
                                    <button
                                        onClick={() => handleDataEntryClick('Presupuesto')}
                                        className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-bold text-[#f8ece2] transition hover:bg-white/10 hover:text-white"
                                    >
                                        <Icon path={Icons.chart} className="w-5 h-5 text-[#ffdba2]" />
                                        Presupuesto
                                    </button>
                                </>
                            )}

                            {hasDailyExpensesAccess && (
                                <NavLink
                                    to="/gastos-diarios"
                                    icon="cash"
                                    active={isActive('/gastos-diarios')}
                                    onClick={() => setIsMobileMenuOpen(false)}
                                >
                                    Gastos Diarios
                                </NavLink>
                            )}

                            <NavLink
                                to="/cuentas-pagar"
                                icon="creditCard"
                                active={isActive('/cuentas-pagar')}
                                onClick={() => setIsMobileMenuOpen(false)}
                            >
                                Cuentas por Pagar
                            </NavLink>

                            {isAdmin && (
                                <>
                                    <NavLink
                                        to="/conciliacion"
                                        icon="check"
                                        active={isActive('/conciliacion')}
                                        onClick={() => setIsMobileMenuOpen(false)}
                                    >
                                        Conciliacion
                                    </NavLink>
                                    <NavLink
                                        to="/agente-ia"
                                        icon="bot"
                                        active={isActive('/agente-ia')}
                                        onClick={() => setIsMobileMenuOpen(false)}
                                    >
                                        MARTIN IA
                                    </NavLink>
                                    <NavLink
                                        to="/reportes"
                                        icon="chart"
                                        active={isActive('/reportes')}
                                        onClick={() => setIsMobileMenuOpen(false)}
                                    >
                                        Reportes
                                    </NavLink>
                                    <NavLink
                                        to="/maestros/categorias"
                                        icon="tag"
                                        active={isActive('/maestros')}
                                        onClick={() => setIsMobileMenuOpen(false)}
                                    >
                                        Categorias
                                    </NavLink>
                                </>
                            )}

                            <button
                                onClick={handleLogout}
                                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[#f2b635]/35 bg-[#f2b635]/12 px-4 py-3 text-sm font-black uppercase tracking-[0.18em] text-[#ffe9b3] transition hover:bg-[#f2b635] hover:text-[#651317]"
                            >
                                <Icon path={Icons.logout} className="w-4 h-4" />
                                Cerrar sesion
                            </button>
                        </div>
                    </div>
                )}
            </nav>

            <div className="h-20" />
        </>
    );
}
