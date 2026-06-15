export const EXPENSE_CATEGORY_TREE = [
    {
        category: 'Costos de venta / compras',
        subcategories: [
            'Compra de carne res',
            'Compra de cerdo',
            'Compra de pollo',
            'Compra de embutidos',
            'Compra de mariscos',
            'Compra de productos procesados',
            'Fletes sobre compras',
            'Merma / ajuste de inventario',
            'Material de empaque directo',
            'Hielo / conservacion directa',
            'Otros costos de producto',
        ],
    },
    {
        category: 'Gastos de Nomina',
        subcategories: [
            'Sueldos y salarios',
            'Horas extras',
            'Bonificaciones',
            'Aguinaldo',
            'Vacaciones',
            'Indemnizacion',
            'INSS patronal',
            'INATEC',
            'Alimentacion de personal',
            'Uniformes',
            'Capacitacion',
        ],
    },
    {
        category: 'Gastos del Local',
        subcategories: [
            'Alquiler',
            'Energia electrica',
            'Agua potable',
            'Internet y telefonia',
            'Servicios publicos varios',
            'Mantenimiento del local',
            'Reparaciones menores',
            'Seguridad',
            'Fumigacion',
            'Limpieza',
            'Recoleccion de basura',
        ],
    },
    {
        category: 'Equipos y Operacion de Carniceria',
        subcategories: [
            'Mantenimiento general de equipos',
            'Mantenimiento de cuartos frios',
            'Mantenimiento de vitrinas refrigeradas',
            'Mantenimiento de sierras y molinos',
            'Repuestos de equipos',
            'Gas refrigerante',
            'Herramientas de corte',
            'Cuchillos y afilado',
            'Balanzas y calibracion',
            'Equipos menores',
        ],
    },
    {
        category: 'Gastos de venta - Operaciones',
        subcategories: [
            'Bolsas y empaques',
            'Etiquetas',
            'Publicidad',
            'Promociones',
            'Comisiones de venta',
            'Delivery / reparto',
            'Combustible de reparto',
            'Mantenimiento de vehiculo',
            'Parqueo / peajes',
            'Atencion al cliente',
            'Otros gastos de venta',
        ],
    },
    {
        category: 'Gastos administrativos',
        subcategories: [
            'Papeleria y utiles',
            'Servicios contables',
            'Servicios legales',
            'Software y sistemas',
            'Suscripciones',
            'Mensajeria',
            'Gastos de oficina',
            'Caja chica',
            'Diferencias de caja',
        ],
    },
    {
        category: 'Impuestos, permisos y tasas',
        subcategories: [
            'Matricula municipal',
            'Impuesto municipal sobre ingresos',
            'Permisos MINSA',
            'Permisos alcaldia',
            'Licencias y registros',
            'Timbres fiscales',
            'Multas y recargos',
            'Otros impuestos y tasas',
        ],
    },
    {
        category: 'Gastos financieros',
        subcategories: [
            'Comisiones bancarias',
            'Cargos POS',
            'Intereses bancarios',
            'Comisiones por transferencias',
            'Diferencial cambiario',
            'Otros gastos financieros',
        ],
    },
    {
        category: 'Otros Gastos',
        subcategories: [
            'Donaciones',
            'Gastos no deducibles',
            'Perdidas por robo',
            'Perdidas por deterioro',
            'Ajustes varios',
            'Gastos extraordinarios',
            'Otros gastos',
        ],
    },
];

const slugify = (value = '') => String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' y ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const normalizeKey = (value = '') => String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

export const EXPENSE_CATEGORY_OPTIONS = EXPENSE_CATEGORY_TREE.flatMap(({ category, subcategories }) => (
    subcategories.map((subcategory) => ({
        id: `${slugify(category)}__${slugify(subcategory)}`,
        category,
        subcategory,
        label: `${category} / ${subcategory}`,
    }))
));

export const DEFAULT_EXPENSE_CATEGORY_ID = 'otros-gastos__otros-gastos';
export const DEFAULT_PURCHASE_CATEGORY_ID = 'costos-de-venta-compras__otros-costos-de-producto';

const OPTION_BY_ID = new Map(EXPENSE_CATEGORY_OPTIONS.map((option) => [option.id, option]));
const OPTION_BY_PAIR = new Map(EXPENSE_CATEGORY_OPTIONS.map((option) => [
    `${normalizeKey(option.category)}|${normalizeKey(option.subcategory)}`,
    option,
]));
const OPTION_BY_LABEL = new Map(EXPENSE_CATEGORY_OPTIONS.map((option) => [normalizeKey(option.label), option]));
const OPTION_BY_SUBCATEGORY = EXPENSE_CATEGORY_OPTIONS.reduce((map, option) => {
    const key = normalizeKey(option.subcategory);
    if (!map.has(key)) map.set(key, option);
    else map.set(key, null);
    return map;
}, new Map());

const findByPair = (category, subcategory) => OPTION_BY_PAIR.get(`${normalizeKey(category)}|${normalizeKey(subcategory)}`);
const isDefaultOption = (option) => option?.id === DEFAULT_EXPENSE_CATEGORY_ID || option?.id === DEFAULT_PURCHASE_CATEGORY_ID;

const legacyMap = new Map(Object.entries({
    alquiler: ['Gastos del Local', 'Alquiler'],
    servicios: ['Gastos del Local', 'Servicios publicos varios'],
    sueldos: ['Gastos de Nomina', 'Sueldos y salarios'],
    nomina: ['Gastos de Nomina', 'Sueldos y salarios'],
    'gastos de personal': ['Gastos de Nomina', 'Sueldos y salarios'],
    'compra inventario': ['Costos de venta / compras', 'Otros costos de producto'],
    compra: ['Costos de venta / compras', 'Otros costos de producto'],
    'compra de mercancia': ['Costos de venta / compras', 'Otros costos de producto'],
    mantenimiento: ['Equipos y Operacion de Carniceria', 'Mantenimiento general de equipos'],
    marketing: ['Gastos de venta - Operaciones', 'Publicidad'],
    'marketing y publicidad': ['Gastos de venta - Operaciones', 'Publicidad'],
    'gastos de venta': ['Gastos de venta - Operaciones', 'Otros gastos de venta'],
    otros: ['Otros Gastos', 'Otros gastos'],
    'otros gastos': ['Otros Gastos', 'Otros gastos'],
    'otros gastos no categorizado': ['Otros Gastos', 'Otros gastos'],
    'gastos de mantenimiento local': ['Gastos del Local', 'Mantenimiento del local'],
    'gastos servicios basicos': ['Gastos del Local', 'Servicios publicos varios'],
    'gastos por materiales y equipos de operaciones': ['Equipos y Operacion de Carniceria', 'Equipos menores'],
    donaciones: ['Otros Gastos', 'Donaciones'],
    'cuota fija': ['Impuestos, permisos y tasas', 'Otros impuestos y tasas'],
    'gastos por suscripciones de pago': ['Gastos administrativos', 'Suscripciones'],
    'gastos de insumos de higiene e inocuidad': ['Gastos del Local', 'Limpieza'],
    'gastos de mantenimiento de vehiculos': ['Gastos de venta - Operaciones', 'Mantenimiento de vehiculo'],
    'cargos bancarios': ['Gastos financieros', 'Comisiones bancarias'],
    'gastos por pago de seguros de vida': ['Otros Gastos', 'Gastos no deducibles'],
    'gastos por insumos de limpieza': ['Gastos del Local', 'Limpieza'],
    'gastos por combustible': ['Gastos de venta - Operaciones', 'Combustible de reparto'],
    viaticos: ['Gastos administrativos', 'Caja chica'],
    'gasto por mantenimiento de equipos frios': ['Equipos y Operacion de Carniceria', 'Mantenimiento de cuartos frios'],
    'gastos por insumos de oficina': ['Gastos administrativos', 'Papeleria y utiles'],
    'gastos por retencion ir': ['Impuestos, permisos y tasas', 'Otros impuestos y tasas'],
    'gastos por retencion alcaldia': ['Impuestos, permisos y tasas', 'Otros impuestos y tasas'],
    'gastos por insumos operativos bolsas aditivos': ['Gastos de venta - Operaciones', 'Bolsas y empaques'],
    'gastos por insumos operativos': ['Gastos de venta - Operaciones', 'Bolsas y empaques'],
}));

const heuristicRules = [
    [/horas?\s+extra/, ['Gastos de Nomina', 'Horas extras']],
    [/planilla|nomina|sueldo|salario/, ['Gastos de Nomina', 'Sueldos y salarios']],
    [/camaron|langosta|marisco|pescado|filete/, ['Costos de venta / compras', 'Compra de mariscos']],
    [/\bres\b|carne|costilla|lomo|posta|cecina/, ['Costos de venta / compras', 'Compra de carne res']],
    [/cerdo|chancho|chuleta/, ['Costos de venta / compras', 'Compra de cerdo']],
    [/pollo|gallina/, ['Costos de venta / compras', 'Compra de pollo']],
    [/embutido|chorizo|jamon|salchicha/, ['Costos de venta / compras', 'Compra de embutidos']],
    [/flete|transporte de compra/, ['Costos de venta / compras', 'Fletes sobre compras']],
    [/hielo|conservacion/, ['Costos de venta / compras', 'Hielo / conservacion directa']],
    [/bolsa|empaque|aditivo|rollo termico|rollos termicos/, ['Gastos de venta - Operaciones', 'Bolsas y empaques']],
    [/etiqueta/, ['Gastos de venta - Operaciones', 'Etiquetas']],
    [/publicidad|marketing|anuncio/, ['Gastos de venta - Operaciones', 'Publicidad']],
    [/delivery|reparto|envio/, ['Gastos de venta - Operaciones', 'Delivery / reparto']],
    [/combustible|gasolina|diesel/, ['Gastos de venta - Operaciones', 'Combustible de reparto']],
    [/banco|comision bancaria/, ['Gastos financieros', 'Comisiones bancarias']],
    [/pos|tarjeta/, ['Gastos financieros', 'Cargos POS']],
    [/energia|luz/, ['Gastos del Local', 'Energia electrica']],
    [/\bagua\b|agua potable|enacal/, ['Gastos del Local', 'Agua potable']],
    [/internet|telefono|telefonia/, ['Gastos del Local', 'Internet y telefonia']],
    [/limpieza|higiene|inocuidad/, ['Gastos del Local', 'Limpieza']],
    [/alquiler|renta/, ['Gastos del Local', 'Alquiler']],
    [/software|sistema|suscripcion/, ['Gastos administrativos', 'Software y sistemas']],
    [/papeleria|utiles|oficina/, ['Gastos administrativos', 'Papeleria y utiles']],
];

export const findExpenseCategoryOption = (value) => {
    if (!value) return null;
    if (typeof value === 'object' && value.category && value.subcategory) {
        return findByPair(value.category, value.subcategory) || {
            id: `${slugify(value.category)}__${slugify(value.subcategory)}`,
            category: value.category,
            subcategory: value.subcategory,
            label: `${value.category} / ${value.subcategory}`,
        };
    }
    const normalized = normalizeKey(value);
    const subcategoryMatch = OPTION_BY_SUBCATEGORY.get(normalized);
    return OPTION_BY_ID.get(String(value)) || OPTION_BY_LABEL.get(normalized) || subcategoryMatch || null;
};

const inferCategoryFromContext = (context = {}) => {
    const heuristicText = normalizeKey([
        context.description,
        context.descripcion,
        context.supplier,
        context.proveedor,
        context.invoiceNumber,
        context.factura,
    ].filter(Boolean).join(' '));

    for (const [pattern, target] of heuristicRules) {
        if (pattern.test(heuristicText)) return findByPair(target[0], target[1]);
    }

    return null;
};

export const mapLegacyExpenseCategory = (value = '', context = {}) => {
    const raw = String(value || '').trim();
    const subcategory = context.subcategory || context.subcategoria || context.expenseSubcategory || '';
    if (raw && subcategory) {
        const direct = findByPair(raw, subcategory);
        if (direct) return direct;
    }

    if (raw.includes('/')) {
        const [categoryPart, ...subcategoryParts] = raw.split('/').map((part) => part.trim()).filter(Boolean);
        const direct = findByPair(categoryPart, subcategoryParts.join(' / '));
        if (direct) return direct;
    }

    const directCategory = EXPENSE_CATEGORY_TREE.find((group) => normalizeKey(group.category) === normalizeKey(raw));
    if (directCategory) {
        const fallbackSubcategory = directCategory.category === 'Costos de venta / compras'
            ? 'Otros costos de producto'
            : directCategory.subcategories[directCategory.subcategories.length - 1];
        return findByPair(directCategory.category, fallbackSubcategory);
    }

    const mapped = legacyMap.get(normalizeKey(raw));
    if (mapped) return findByPair(mapped[0], mapped[1]);

    const heuristicText = normalizeKey([
        raw,
        context.description,
        context.descripcion,
        context.supplier,
        context.proveedor,
    ].filter(Boolean).join(' '));

    const inferred = inferCategoryFromContext({
        ...context,
        description: heuristicText,
    });
    if (inferred) return inferred;

    if (context.isInventoryCost || normalizeKey(context.tipo) === 'compra') {
        return OPTION_BY_ID.get(DEFAULT_PURCHASE_CATEGORY_ID);
    }

    return OPTION_BY_ID.get(DEFAULT_EXPENSE_CATEGORY_ID);
};

export const getExpenseCategoryFromRecord = (record = {}, fallbackId = DEFAULT_EXPENSE_CATEGORY_ID) => {
    const rawCategory = record.category || record.categoria || record.expenseCategory || '';
    const rawSubcategory = record.subcategory || record.subcategoria || record.expenseSubcategory || '';
    const direct = rawCategory && rawSubcategory ? findByPair(rawCategory, rawSubcategory) : null;
    const inferred = direct && isDefaultOption(direct) ? inferCategoryFromContext(record) : null;
    const option = inferred || direct || mapLegacyExpenseCategory(rawCategory, record) || OPTION_BY_ID.get(fallbackId) || OPTION_BY_ID.get(DEFAULT_EXPENSE_CATEGORY_ID);

    return {
        id: option.id,
        category: option.category,
        subcategory: option.subcategory,
        label: option.label,
    };
};

export const buildExpenseCategoryPayload = (selection, fallbackId = DEFAULT_EXPENSE_CATEGORY_ID) => {
    const option = findExpenseCategoryOption(selection)
        || (typeof selection === 'string' ? mapLegacyExpenseCategory(selection) : null)
        || getExpenseCategoryFromRecord(typeof selection === 'object' ? selection : {}, fallbackId);

    return {
        categoryId: option.id,
        category: option.category,
        categoria: option.category,
        subcategory: option.subcategory,
        subcategoria: option.subcategory,
        expenseCategory: option.category,
        expenseSubcategory: option.subcategory,
        categoryLabel: option.label,
    };
};

export const getLegacyCategorySeed = () => EXPENSE_CATEGORY_TREE.map((group) => ({
    id: slugify(group.category),
    name: group.category,
    subcategories: group.subcategories,
}));
