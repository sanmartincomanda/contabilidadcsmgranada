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

export const MODULE_ACCESS_NONE = 'none';
export const MODULE_ACCESS_VIEW = 'view';
export const MODULE_ACCESS_EDIT = 'edit';

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

export const emptyModuleModes = () => ACCESS_MODULES.reduce((acc, module) => {
    acc[module.id] = MODULE_ACCESS_NONE;
    return acc;
}, {});

export const fullModuleModes = () => ACCESS_MODULES.reduce((acc, module) => {
    acc[module.id] = MODULE_ACCESS_EDIT;
    return acc;
}, {});

export const normalizeModuleAccess = (modules = {}, fallback = {}) => {
    const normalized = emptyModuleAccess();

    ACCESS_MODULES.forEach((module) => {
        const moduleValue = modules?.[module.id];
        const fallbackValue = fallback?.[module.id];
        normalized[module.id] = moduleValue === true
            || moduleValue === MODULE_ACCESS_VIEW
            || moduleValue === MODULE_ACCESS_EDIT
            || moduleValue?.enabled === true
            || fallbackValue === true
            || fallbackValue === MODULE_ACCESS_VIEW
            || fallbackValue === MODULE_ACCESS_EDIT
            || fallbackValue?.enabled === true;
    });

    return normalized;
};

export const normalizeModuleMode = (mode, fallback = MODULE_ACCESS_EDIT) => (
    mode === MODULE_ACCESS_VIEW || mode === MODULE_ACCESS_EDIT
        ? mode
        : fallback
);

export const normalizeModuleModes = (modules = {}, moduleModes = {}, fallback = {}) => {
    const normalized = emptyModuleModes();
    const normalizedAccess = normalizeModuleAccess(modules, fallback);

    ACCESS_MODULES.forEach((module) => {
        if (!normalizedAccess[module.id]) return;

        const moduleValue = modules?.[module.id];
        const fallbackValue = fallback?.[module.id];
        const explicitMode = moduleModes?.[module.id]
            || (typeof moduleValue === 'string' ? moduleValue : moduleValue?.mode)
            || (typeof fallbackValue === 'string' ? fallbackValue : fallbackValue?.mode);

        normalized[module.id] = normalizeModuleMode(explicitMode, MODULE_ACCESS_EDIT);
    });

    return normalized;
};

export const getEffectiveModuleAccess = (email, profile) => {
    if (isMasterEmail(email)) return fullModuleAccess();
    if (profile && profile.active === false) return emptyModuleAccess();

    const fallback = profile ? {} : LEGACY_LIMITED_ACCESS;
    return normalizeModuleAccess(profile?.modules || {}, fallback);
};

export const getEffectiveModuleModes = (email, profile) => {
    if (isMasterEmail(email)) return fullModuleModes();
    if (profile && profile.active === false) return emptyModuleModes();

    const fallback = profile ? {} : LEGACY_LIMITED_ACCESS;
    return normalizeModuleModes(profile?.modules || {}, profile?.moduleModes || {}, fallback);
};

export const canUseModule = (moduleAccess, moduleId) => moduleAccess?.[moduleId] === true;

export const canEditModule = (moduleModes, moduleId) => moduleModes?.[moduleId] === MODULE_ACCESS_EDIT;

export const getModuleModeLabel = (mode) => {
    if (mode === MODULE_ACCESS_VIEW) return 'Solo ver';
    if (mode === MODULE_ACCESS_EDIT) return 'Editar';
    return 'Sin acceso';
};

export const getDefaultAllowedPath = (moduleAccess) => {
    const firstModule = ACCESS_MODULES.find((module) => moduleAccess?.[module.id] === true);
    return firstModule?.path || '/sin-permisos';
};
