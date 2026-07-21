import { ALL_BRANCH_IDS, DEFAULT_BRANCH_ID, resolveBranchId } from '../constants';

export const MASTER_USER_EMAIL = 'luis.s.97@hotmail.com';
export const USER_PROFILES_COLLECTION = 'usuarios_sistema';

export const ACCESS_MODULES = [
    { id: 'dashboard', label: 'Inicio', description: 'Dashboard ejecutivo y resumen general.', path: '/' },
    { id: 'ingresar', label: 'Registro operativo', description: 'Ingresos, gastos, compras y registros manuales.', path: '/ingresar' },
    { id: 'caja_chica', label: 'Caja Chica', description: 'Gastos diarios, efectivo, tarjetas y vouchers.', path: '/gastos-diarios' },
    { id: 'cuentas_pagar', label: 'Cuentas por Pagar', description: 'Proveedores, facturas a credito y abonos.', path: '/cuentas-pagar' },
    { id: 'cuentas_cobrar', label: 'Cuentas por Cobrar', description: 'Clientes, saldos de credito y estados de cuenta.', path: '/cuentas-cobrar' },
    { id: 'traspasos_costos', label: 'Traspaso Costos Sucursal', description: 'Movimientos de costo entre sucursales para estado de resultados.', path: '/traspasos-costos' },
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

const normalizeAccessText = (value = '') => (
    String(value || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
);

export const isMasterEmail = (email = '') => normalizeUserEmail(email) === MASTER_USER_EMAIL;

export const isNicolUser = (email = '', profile = {}) => {
    const haystack = normalizeAccessText([
        email,
        profile?.email,
        profile?.displayName,
        profile?.name,
    ].filter(Boolean).join(' '));

    return haystack.includes('nicol') || haystack.includes('barbosa');
};

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

export const normalizeBranchAccess = (branchAccess = null, fallback = [DEFAULT_BRANCH_ID]) => {
    if (branchAccess === 'all') return [...ALL_BRANCH_IDS];

    const rawBranches = Array.isArray(branchAccess)
        ? branchAccess
        : branchAccess && typeof branchAccess === 'object'
            ? Object.entries(branchAccess)
                .filter(([, enabled]) => enabled === true)
                .map(([branchId]) => branchId)
            : fallback;

    const normalized = [...new Set(
        (rawBranches || [])
            .map((branchId) => resolveBranchId(branchId))
            .filter((branchId) => ALL_BRANCH_IDS.includes(branchId))
    )];

    return normalized.length ? normalized : [DEFAULT_BRANCH_ID];
};

export const getEffectiveBranchAccess = (email, profile) => {
    if (isMasterEmail(email) || isNicolUser(email, profile)) return [...ALL_BRANCH_IDS];
    if (profile && profile.active === false) return [];
    return normalizeBranchAccess(profile?.branchAccess || profile?.branches || profile?.allowedBranches, [DEFAULT_BRANCH_ID]);
};

export const getEffectiveDefaultBranchId = (email, profile) => {
    const allowedBranches = getEffectiveBranchAccess(email, profile);
    if (!allowedBranches.length) return DEFAULT_BRANCH_ID;
    const preferred = resolveBranchId(profile?.defaultBranchId || profile?.defaultBranch || allowedBranches[0]);
    return allowedBranches.includes(preferred) ? preferred : allowedBranches[0];
};

export const canUseBranch = (allowedBranches = [], branchId = DEFAULT_BRANCH_ID) => (
    allowedBranches.includes(resolveBranchId(branchId))
);

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
