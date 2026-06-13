export const MASTER_USER_EMAIL = 'luis.s.97@hotmail.com';
export const USER_PROFILES_COLLECTION = 'usuarios_sistema';

export const ACCESS_MODULES = [
    { id: 'dashboard', label: 'Inicio', description: 'Dashboard ejecutivo y resumen general.', path: '/' },
    { id: 'ingresar', label: 'Registro operativo', description: 'Ingresos, gastos, compras y registros manuales.', path: '/ingresar' },
    { id: 'caja_chica', label: 'Caja Chica', description: 'Gastos diarios, efectivo, tarjetas y vouchers.', path: '/gastos-diarios' },
    { id: 'cuentas_pagar', label: 'Cuentas por Pagar', description: 'Proveedores, facturas a credito y abonos.', path: '/cuentas-pagar' },
    { id: 'facturacion', label: 'Facturacion', description: 'Cierre de caja, membretadas y depositos.', path: '/facturacion' },
    { id: 'reportes', label: 'Reportes', description: 'Estados financieros, impuestos y exportaciones.', path: '/reportes' },
    { id: 'categorias', label: 'Categorias', description: 'Catalogo fiscal de categorias y subcategorias.', path: '/maestros/categorias' },
];

const LEGACY_LIMITED_ACCESS = {
    caja_chica: true,
    cuentas_pagar: true,
};

export const normalizeUserEmail = (email = '') => String(email || '').trim().toLowerCase();

export const isMasterEmail = (email = '') => normalizeUserEmail(email) === MASTER_USER_EMAIL;

export const userProfileDocId = (email = '') => normalizeUserEmail(email).replace(/\//g, '_');

export const emptyModuleAccess = () => ACCESS_MODULES.reduce((acc, module) => {
    acc[module.id] = false;
    return acc;
}, {});

export const fullModuleAccess = () => ACCESS_MODULES.reduce((acc, module) => {
    acc[module.id] = true;
    return acc;
}, {});

export const normalizeModuleAccess = (modules = {}, fallback = {}) => {
    const normalized = emptyModuleAccess();

    ACCESS_MODULES.forEach((module) => {
        normalized[module.id] = modules?.[module.id] === true || fallback?.[module.id] === true;
    });

    return normalized;
};

export const getEffectiveModuleAccess = (email, profile) => {
    if (isMasterEmail(email)) return fullModuleAccess();
    if (profile && profile.active === false) return emptyModuleAccess();

    const fallback = profile ? {} : LEGACY_LIMITED_ACCESS;
    return normalizeModuleAccess(profile?.modules || {}, fallback);
};

export const canUseModule = (moduleAccess, moduleId) => moduleAccess?.[moduleId] === true;

export const getDefaultAllowedPath = (moduleAccess) => {
    const firstModule = ACCESS_MODULES.find((module) => moduleAccess?.[module.id] === true);
    return firstModule?.path || '/sin-permisos';
};
