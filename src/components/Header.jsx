import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { APP_BRAND_LOGO, APP_BRAND_NAME, APP_BRAND_WORDMARK_BOTTOM, APP_BRAND_WORDMARK_TOP } from '../constants';

const Icons = {
    home: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
    plus: 'M12 4v16m8-8H4',
    cash: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
    creditCard: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
    receipt: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
    chart: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    gear: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
    menu: 'M4 6h16M4 12h16M4 18h16',
    x: 'M6 18L18 6M6 6l12 12',
    logout: 'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
    user: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
    chevronDown: 'M19 9l-7 7-7-7',
    trendingUp: 'M13 7h8m0 0v8m0-8l-8-8-4 4-6-6',
    trendingDown: 'M13 17h8m0 0V9m0 8l-8-8-4 4-6-6',
    box: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
    cart: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z',
    target: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    hand: 'M7 11V7a3 3 0 016 0v4m-6 0H5a2 2 0 00-2 2v4a4 4 0 004 4h7a4 4 0 004-4v-4a2 2 0 00-2-2h-2',
    scale: 'M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3',
};

const Icon = ({ path, className = 'h-4 w-4' }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
);

const entryTabs = [
    { tab: 'Ingresos', label: 'Ingresos', hint: 'Ventas y entradas', icon: 'trendingUp', tone: 'text-emerald-500 bg-emerald-500/10' },
    { tab: 'Gastos', label: 'Gastos', hint: 'Egresos fiscales', icon: 'trendingDown', tone: 'text-rose-500 bg-rose-500/10' },
    { tab: 'Inventario', label: 'Inventario', hint: 'Control operativo', icon: 'box', tone: 'text-sky-500 bg-sky-500/10' },
    { tab: 'Compras', label: 'Compras', hint: 'Costo de venta', icon: 'cart', tone: 'text-amber-500 bg-amber-500/10' },
    { tab: 'Presupuesto', label: 'Presupuesto', hint: 'Plan mensual', icon: 'target', tone: 'text-indigo-500 bg-indigo-500/10' },
    { tab: 'Cuentas por Cobrar', label: 'C. Cobrar', hint: 'Clientes y saldos', icon: 'hand', tone: 'text-teal-500 bg-teal-500/10' },
    { tab: 'Patrimonio', label: 'Patrimonio', hint: 'Capital y ajustes', icon: 'scale', tone: 'text-slate-500 bg-slate-500/10' },
];

const billingHints = [
    'Cierre de caja',
    'Facturas membretadas',
    'Diferencias de caja',
    'Depositos bancarios',
];

const reportHints = [
    'Estado de resultados',
    'Reportes tributarios',
    'Facturas membretadas',
    'Balance',
];

export default function Header({ moduleAccess = {}, isMaster = false, defaultPath = '/' }) {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [openMenu, setOpenMenu] = useState(null);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [isScrolled, setIsScrolled] = useState(false);
    const navRef = useRef(null);

    const canAccess = (moduleId) => moduleAccess?.[moduleId] === true;
    const isActive = (path) => (path === '/' ? location.pathname === '/' : location.pathname.startsWith(path));

    useEffect(() => {
        const onScroll = () => setIsScrolled(window.scrollY > 8);
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    useEffect(() => {
        const closeOutside = (event) => {
            if (navRef.current && !navRef.current.contains(event.target)) setOpenMenu(null);
        };
        document.addEventListener('mousedown', closeOutside);
        return () => document.removeEventListener('mousedown', closeOutside);
    }, []);

    useEffect(() => {
        setOpenMenu(null);
        setMobileOpen(false);
    }, [location.pathname, location.search]);

    const primaryItems = useMemo(() => ([
        canAccess('dashboard') && { key: 'inicio', label: 'Inicio', icon: 'home', to: '/' },
        canAccess('caja_chica') && { key: 'caja', label: 'Caja Chica', icon: 'cash', to: '/gastos-diarios' },
        canAccess('cuentas_pagar') && { key: 'cuentas', label: 'Cuentas por Pagar', icon: 'creditCard', to: '/cuentas-pagar' },
        canAccess('facturacion') && { key: 'facturacion', label: 'Facturacion', icon: 'receipt', to: '/facturacion', hintList: billingHints },
        canAccess('reportes') && { key: 'reportes', label: 'Reportes', icon: 'chart', to: '/reportes', hintList: reportHints },
        isMaster && { key: 'config', label: 'Configuraciones', icon: 'gear', to: '/configuraciones' },
    ].filter(Boolean)), [isMaster, moduleAccess]);

    const goToEntry = (tab) => {
        navigate(`/ingresar?tab=${encodeURIComponent(tab)}`);
        setOpenMenu(null);
        setMobileOpen(false);
    };

    const handleLogout = async () => {
        try {
            await logout();
            navigate('/login');
        } catch (error) {
            console.error('Error al cerrar sesion', error);
        }
    };

    const DesktopLink = ({ item }) => (
        <Link
            to={item.to}
            className={`group flex items-center gap-2 rounded-2xl px-3 py-2 text-[13px] font-black transition duration-200 focus:outline-none focus:ring-2 focus:ring-[#f5b51b]/70 ${
                isActive(item.to)
                    ? 'bg-white text-slate-950 shadow-lg shadow-black/10'
                    : 'text-white/72 hover:bg-white/10 hover:text-white'
            }`}
            title={item.label}
        >
            <Icon path={Icons[item.icon]} className={`h-4 w-4 ${isActive(item.to) ? 'text-[#e30613]' : 'text-white/60 group-hover:text-[#f5b51b]'}`} />
            <span className="hidden xl:inline">{item.label}</span>
        </Link>
    );

    const DropdownButton = () => (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpenMenu(openMenu === 'ingresar' ? null : 'ingresar')}
                className={`group flex items-center gap-2 rounded-2xl px-3 py-2 text-[13px] font-black transition duration-200 focus:outline-none focus:ring-2 focus:ring-[#f5b51b]/70 ${
                    openMenu === 'ingresar' || isActive('/ingresar')
                        ? 'bg-[#f5b51b] text-slate-950 shadow-lg shadow-[#f5b51b]/20'
                        : 'text-white/72 hover:bg-white/10 hover:text-white'
                }`}
            >
                <Icon path={Icons.plus} className="h-4 w-4" />
                <span className="hidden xl:inline">Ingresar Datos</span>
                <Icon path={Icons.chevronDown} className={`h-3 w-3 transition ${openMenu === 'ingresar' ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
                {openMenu === 'ingresar' && (
                    <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.98 }}
                        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                        className="absolute left-0 top-full z-50 mt-3 w-[22rem] overflow-hidden rounded-[1.4rem] border border-white/12 bg-slate-950/96 p-2 shadow-2xl shadow-black/35 ring-1 ring-white/10 backdrop-blur-xl"
                    >
                        <div className="px-3 py-2">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-[#f5b51b]">Registro operativo</div>
                            <div className="mt-1 text-xs font-semibold text-white/50">Selecciona el formulario que necesitas abrir.</div>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 p-1">
                            {entryTabs.map((item) => (
                                <button
                                    key={item.tab}
                                    type="button"
                                    onClick={() => goToEntry(item.tab)}
                                    className="group rounded-2xl p-3 text-left transition hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-[#f5b51b]/60"
                                >
                                    <div className={`mb-2 grid h-9 w-9 place-items-center rounded-xl ${item.tone}`}>
                                        <Icon path={Icons[item.icon]} />
                                    </div>
                                    <div className="text-sm font-black text-white">{item.label}</div>
                                    <div className="mt-0.5 text-[11px] font-semibold text-white/46">{item.hint}</div>
                                </button>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );

    const HintDropdown = ({ item }) => (
        <div className="relative">
            <div
                onMouseEnter={() => setOpenMenu(item.key)}
                onFocus={() => setOpenMenu(item.key)}
                className="relative"
            >
                <DesktopLink item={item} />
                <AnimatePresence>
                    {openMenu === item.key && item.hintList && (
                        <motion.div
                            initial={{ opacity: 0, y: 8, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 8, scale: 0.98 }}
                            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                            onMouseLeave={() => setOpenMenu(null)}
                            className="absolute left-0 top-full z-40 mt-3 w-64 rounded-[1.25rem] border border-white/12 bg-slate-950/96 p-2 shadow-2xl shadow-black/30 ring-1 ring-white/10 backdrop-blur-xl"
                        >
                            <div className="px-3 py-2 text-[10px] font-black uppercase tracking-[0.28em] text-[#f5b51b]">{item.label}</div>
                            {item.hintList.map((hint) => (
                                <Link
                                    key={hint}
                                    to={item.to}
                                    className="block rounded-xl px-3 py-2 text-xs font-bold text-white/64 transition hover:bg-white/8 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#f5b51b]/60"
                                >
                                    {hint}
                                </Link>
                            ))}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );

    const MobileItem = ({ item }) => (
        <Link
            to={item.to}
            className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-black transition ${
                isActive(item.to) ? 'bg-white text-slate-950' : 'text-white/78 hover:bg-white/10 hover:text-white'
            }`}
        >
            <Icon path={Icons[item.icon]} className={`h-4 w-4 ${isActive(item.to) ? 'text-[#e30613]' : 'text-[#f5b51b]'}`} />
            {item.label}
        </Link>
    );

    return (
        <>
            <motion.header
                initial={{ y: -14, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                className={`command-header fixed left-0 right-0 top-0 z-50 border-b transition-all duration-200 ${
                    isScrolled ? 'border-white/14 bg-slate-950/92 shadow-2xl shadow-slate-950/25 backdrop-blur-xl' : 'border-white/10 bg-slate-950/88 backdrop-blur-lg'
                }`}
            >
                <nav ref={navRef} className="mx-auto flex h-16 max-w-[1480px] items-center gap-3 px-3 sm:px-5">
                    <Link to={defaultPath} className="group flex min-w-0 items-center gap-3 rounded-2xl py-1 pr-2 focus:outline-none focus:ring-2 focus:ring-[#f5b51b]/70">
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/14 bg-white shadow-lg shadow-black/15 transition group-hover:scale-[1.02]">
                            <img src={APP_BRAND_LOGO} alt={APP_BRAND_NAME} className="h-8 w-8 object-contain" />
                        </span>
                        <span className="hidden min-w-0 sm:block">
                            <span className="block truncate text-[10px] font-black uppercase tracking-[0.32em] text-[#f5b51b]">{APP_BRAND_WORDMARK_TOP}</span>
                            <span className="block truncate text-lg font-black leading-5 text-white">{APP_BRAND_WORDMARK_BOTTOM}</span>
                        </span>
                    </Link>

                    {user && (
                        <div className="hidden min-w-0 flex-1 items-center justify-center gap-1 lg:flex">
                            {canAccess('ingresar') && <DropdownButton />}
                            {primaryItems.map((item) => (
                                item.hintList ? <HintDropdown key={item.key} item={item} /> : <DesktopLink key={item.key} item={item} />
                            ))}
                        </div>
                    )}

                    <div className="ml-auto flex items-center gap-2">
                        {user ? (
                            <>
                                <div className="hidden min-w-0 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 xl:flex">
                                    <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/10 text-white">
                                        <Icon path={Icons.user} />
                                    </span>
                                    <span className="min-w-0">
                                        <span className="block max-w-[10rem] truncate text-xs font-black text-white">{user.email?.split('@')[0]}</span>
                                        <span className="block max-w-[10rem] truncate text-[10px] font-semibold text-white/45">{user.email}</span>
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleLogout}
                                    className="hidden items-center gap-2 rounded-2xl border border-red-300/20 bg-red-500/12 px-3 py-2 text-xs font-black text-red-100 transition hover:border-red-300/40 hover:bg-red-500/22 focus:outline-none focus:ring-2 focus:ring-red-300/60 lg:flex"
                                >
                                    <Icon path={Icons.logout} />
                                    Salir
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setMobileOpen((value) => !value)}
                                    className="grid h-11 w-11 place-items-center rounded-2xl border border-white/12 bg-white/[0.06] text-white transition hover:bg-white/12 focus:outline-none focus:ring-2 focus:ring-[#f5b51b]/70 lg:hidden"
                                >
                                    <Icon path={mobileOpen ? Icons.x : Icons.menu} className="h-5 w-5" />
                                </button>
                            </>
                        ) : (
                            <Link to="/login" className="rounded-2xl bg-[#f5b51b] px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-950 shadow-lg shadow-[#f5b51b]/20 transition hover:bg-[#ffd56b]">
                                Entrar
                            </Link>
                        )}
                    </div>
                </nav>

                <AnimatePresence>
                    {mobileOpen && user && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                            className="overflow-hidden border-t border-white/10 bg-slate-950/96 backdrop-blur-xl lg:hidden"
                        >
                            <div className="space-y-3 px-3 pb-4 pt-3">
                                <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-4">
                                    <div className="text-xs font-black text-white">{user.email}</div>
                                    <div className="mt-1 text-[10px] font-black uppercase tracking-[0.28em] text-[#f5b51b]">{APP_BRAND_NAME}</div>
                                </div>

                                {canAccess('ingresar') && (
                                    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-2">
                                        <div className="px-2 pb-2 text-[10px] font-black uppercase tracking-[0.28em] text-[#f5b51b]">Ingresar Datos</div>
                                        <div className="grid gap-1 sm:grid-cols-2">
                                            {entryTabs.map((item) => (
                                                <button key={item.tab} type="button" onClick={() => goToEntry(item.tab)} className="flex items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-black text-white/78 transition hover:bg-white/10 hover:text-white">
                                                    <span className={`grid h-9 w-9 place-items-center rounded-xl ${item.tone}`}>
                                                        <Icon path={Icons[item.icon]} />
                                                    </span>
                                                    <span>
                                                        <span className="block">{item.label}</span>
                                                        <span className="block text-[10px] font-semibold text-white/42">{item.hint}</span>
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="grid gap-1 sm:grid-cols-2">
                                    {primaryItems.map((item) => <MobileItem key={item.key} item={item} />)}
                                </div>

                                <button
                                    type="button"
                                    onClick={handleLogout}
                                    className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-300/20 bg-red-500/12 px-4 py-3 text-sm font-black uppercase tracking-[0.18em] text-red-100 transition hover:bg-red-500/22"
                                >
                                    <Icon path={Icons.logout} />
                                    Cerrar sesion
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.header>
            <div className="h-16" />
        </>
    );
}
