const expenseAccount = (code, name, parentCode, parentName) => ({
    id: code,
    code,
    name,
    parentCode,
    parentName,
    type: 'Gastos',
    detailType: 'Movimiento',
});

const group = (code, name, accounts) => ({
    code,
    name,
    accounts: accounts.map(([accountCode, accountName]) => (
        expenseAccount(accountCode, accountName, code, name)
    )),
});

export const EXPENSE_ACCOUNT_GROUPS = [
    group('5200', 'Gastos de Administrativo', [
        ['5201', 'Gastos de Administrativo:Insumos de oficina'],
        ['5202', 'Gastos de Administrativo:Servicios contables'],
        ['5203', 'Gastos de Administrativo:Servicios legales'],
        ['5204', 'Gastos de Administrativo:Software y sistemas'],
        ['5205', 'Gastos de Administrativo:Suscripciones'],
        ['5206', 'Gastos de Administrativo:Gastos de oficina'],
        ['5207', 'Gastos de Administrativo:Diferencias de caja'],
    ]),
    group('5300', 'Gastos operativos', [
        ['5301', 'Gastos operativos:Salarios'],
        ['5302', 'Gastos operativos:Horas extras'],
        ['5304', 'Gastos operativos:Energia Electrica'],
        ['5305', 'Gastos operativos:Agua Potable'],
        ['5306', 'Gastos operativos:Internet y telefonia'],
        ['5307', 'Gastos operativos:Seguridad'],
        ['5308', 'Gastos operativos:Limpieza'],
        ['5309', 'Gastos operativos:Recoleccion de basura'],
        ['5310', 'Gastos operativos:Balanzas y calibracion'],
    ]),
    group('5400', 'Gastos Financieros', [
        ['5401', 'Gastos Financieros:Comision Bancaria'],
        ['5402', 'Gastos Financieros:Cargos POS'],
        ['5403', 'Gastos Financieros:Intereses'],
        ['5404', 'Gastos Financieros:Otros gastos financieros'],
    ]),
    group('5500', 'Gastos entidades gubernamentales', [
        ['5501', 'Gastos entidades gubernamentales'],
        ['5502', 'Gastos entidades gubernamentales:Matricula Municipal'],
        ['5503', 'Gastos entidades gubernamentales:Permisos Alcaldia'],
        ['5504', 'Gastos entidades gubernamentales:Timbres fiscales'],
        ['5505', 'Gastos entidades gubernamentales:Multa y recargos'],
        ['5506', 'Gastos entidades gubernamentales:Otros impuestos y tasas'],
    ]),
    group('5600', 'Otros Gastos', [
        ['5601', 'Otros Gastos:Donaciones'],
        ['5602', 'Otros Gastos:Gastos no deducibles'],
        ['5603', 'Otros Gastos:Perdidas por robo'],
        ['5604', 'Otros Gastos:Descarte de productos'],
        ['5605', 'Otros Gastos:Perdidas, faltantes y robos de inventario'],
    ]),
    group('5700', 'Gastos de ventas', [
        ['5701', 'Gastos de ventas:Bolsas y empaque'],
        ['5702', 'Gastos de ventas:Rollos de etiquetas'],
        ['5703', 'Gastos de ventas:Publicidad'],
        ['5704', 'Gastos de ventas:Comisiones de venta'],
        ['5705', 'Gastos de ventas:Delivery'],
        ['5706', 'Gastos de ventas:Combustible'],
        ['5707', 'Gastos de ventas:Mtto Vehiculos'],
        ['5708', 'Gastos de ventas:Parqueos/peajes'],
        ['5709', 'Gastos de ventas:Otros gastos de venta'],
    ]),
    group('5900', 'Gastos conservados', [
        ['590001', 'GASTOS GENERALES A & B'],
        ['590002', 'GASTOS GENERALES A & B:Salarios - A & B'],
        ['590003', 'GASTOS GENERALES A & B:Incentivos - A & B'],
        ['590004', 'GASTOS GENERALES A & B:Comisiones - A & B'],
        ['590005', 'GASTOS GENERALES A & B:Horas Extras - A & B'],
        ['590006', 'GASTOS GENERALES A & B:Dias Feriado - A & B'],
        ['590012', 'GASTOS GENERALES A & B:Alimentacion - A & B'],
        ['590013', 'GASTOS GENERALES A & B:Viaticos de Tranporte - A & B'],
        ['590014', 'GASTOS GENERALES A & B:Almuerzo Personal - A & B'],
        ['590015', 'GASTOS DE PERSONAL:Incentivos'],
        ['590016', 'GASTOS DE PERSONAL:Comisiones'],
        ['590017', 'GASTOS DE PERSONAL:Dias Feriado'],
        ['590018', 'GASTOS DE PERSONAL:Seguro Social Patronal'],
        ['590019', 'GASTOS DE PERSONAL:Inatec'],
        ['590020', 'GASTOS DE PERSONAL:Vacaciones'],
        ['590021', 'GASTOS DE PERSONAL:Aguinaldo'],
        ['590022', 'GASTOS DE PERSONAL:Indemanizacion Laboral'],
        ['590023', 'GASTOS DE PERSONAL:Viaticos de Alimentacion'],
        ['590024', 'GASTOS DE PERSONAL:Viaticos de Transporte'],
        ['590025', 'OTROS GASTOS:Vajilla, cuberteria'],
        ['590026', 'OTROS GASTOS:Manteleria'],
        ['590027', 'OTROS GASTOS:Papel y plasticos'],
        ['590028', 'OTROS GASTOS:Utencili de cocina y Bar'],
        ['590029', 'OTROS GASTOS:Menues Lista de bebidas'],
        ['590030', 'OTROS GASTOS:Lavanderia y tintoreria'],
        ['590031', 'OTROS GASTOS:Decoraciones'],
        ['590032', 'OTROS GASTOS:Musica y entretenimiento'],
        ['590033', 'OTROS GASTOS:Gastos por banquetes'],
        ['590034', 'OTROS GASTOS:Hielo'],
        ['590035', 'OTROS GASTOS:Uniformes de Personal'],
        ['590036', 'OTROS GASTOS:Capacitacion'],
        ['590037', 'OTROS GASTOS:Gas Butano'],
        ['590038', 'OTROS GASTOS:Sumnistros de Operacion'],
        ['590039', 'OTROS GASTOS:Equip Acces de seguridad'],
        ['590040', 'OTROS GASTOS:Aseo e Higiene'],
        ['590041', 'OTROS GASTOS:Gastos Miscelaneos'],
        ['590042', 'OTROS GASTOS:Alquiler de Mob y Equi'],
        ['590043', 'OTROS GASTOS:Otros Alquileres'],
        ['590044', 'OTROS GASTOS:Gastos de Encomienda'],
        ['590045', 'OTROS GASTOS:Servicios profesionales'],
        ['590046', 'OTROS GASTOS:Mobiliario y Equipo'],
        ['590047', 'OTROS GASTOS:Suministros de cafeteria'],
        ['590048', 'OTROS GASTOS:Transporte'],
        ['590049', 'OTROS GASTOS:Seguros'],
        ['590050', 'OTROS GASTOS:Celebrac. y fiesta Emplea'],
        ['590051', 'OTROS GASTOS:Alquiler de local'],
        ['590052', 'OTROS GASTOS:Monitoreo Vehiculos'],
        ['590053', 'OTROS GASTOS:Impresiones y fotocopias'],
        ['590054', 'OTROS GASTOS:Accesorios de Equipos Res'],
        ['590055', 'OTROS GASTOS:Cortesias'],
        ['590056', 'SERVICIOS BASICOS:Servicio de cable TV'],
        ['590057', 'GASTOS FINANCIEROS:Diferencial Cambiario'],
        ['590058', 'GASTOS FINANCIEROS:Promociones en ventas'],
        ['590059', 'GASTOS FINANCIEROS:Comision sobre Prestamos'],
        ['590060', 'VENTAS Y MERCADEO:Regalias, Articulos y Ser'],
        ['590061', 'VENTAS Y MERCADEO:Cuotas y Suscripciones - V/M'],
        ['590062', 'VENTAS Y MERCADEO:Rentas de Equipos V/M'],
        ['590063', 'VENTAS Y MERCADEO:Impuesto Municipal 1%'],
        ['590064', 'VENTAS Y MERCADEO:Promociones y Eventos'],
        ['590065', 'VENTAS Y MERCADEO:Relaciones Publica y Publ'],
        ['590066', 'VENTAS Y MERCADEO:Investigacion de Mercado'],
        ['590067', 'VENTAS Y MERCADEO:Comision Agencias'],
        ['590068', 'VENTAS Y MERCADEO:Material Publicitario'],
        ['590069', 'VENTAS Y MERCADEO:Rotulos y Graficos Intern'],
        ['590070', 'VENTAS Y MERCADEO:IBI'],
        ['590071', 'VENTAS Y MERCADEO:Licencias y Permisos'],
        ['590072', 'MANTENIMIENTO:Mtto de Edificio'],
        ['590073', 'MANTENIMIENTO:Mtto y Rep Equip de Carniceria'],
        ['590074', 'MANTENIMIENTO:Mtto. Mob y Equipo de Ofi'],
        ['590075', 'MANTENIMIENTO:Mtto de sistemas de Red'],
        ['590076', 'MANTENIMIENTO:Mtto de Softwares'],
        ['590077', 'MANTENIMIENTO:Hosting Web'],
        ['590078', 'MANTENIMIENTO:Mtto Equipo de computo'],
        ['590079', 'MANTENIMIENTO:Tramites y Legaliz Veh.'],
        ['590080', 'MANTENIMIENTO:Accesorios de vehiculos'],
        ['590081', 'MANTENIMIENTO:Paisajes y Mtto de Jardin'],
        ['590082', 'MANTENIMIENTO:Gastos por Mantto varios'],
        ['590083', 'Otros Gastos Mayor:Perdida o Ganancia Camb'],
        ['590084', 'Otros Gastos Mayor:Ayudas economicas'],
        ['590085', 'Otros Gastos Mayor:Gastos por Depreciacion'],
        ['590086', 'Otros Gastos Mayor:Otras Amortizaciones'],
        ['590087', 'GASTOS NO DEDUCIBLES:Imptos y Gtos de Terceros'],
        ['590088', 'GASTOS NO DEDUCIBLES:ISC'],
        ['590089', 'GASTOS NO DEDUCIBLES:IR Anual'],
    ]),
];

export const EXPENSE_ACCOUNTS = EXPENSE_ACCOUNT_GROUPS.flatMap((accountGroup) => accountGroup.accounts);

const normalize = (value = '') => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();

export const findExpenseAccount = (value) => {
    if (!value) return null;
    const candidate = typeof value === 'object'
        ? value.accountingAccountId || value.accountingAccountCode || value.expenseAccountCode || value.id || value.code || value.name
        : value;
    const normalized = normalize(candidate);
    return EXPENSE_ACCOUNTS.find((account) => (
        normalize(account.id) === normalized
        || normalize(account.code) === normalized
        || normalize(account.name) === normalized
    )) || null;
};

export const buildExpenseAccountPayload = (value) => {
    const account = findExpenseAccount(value);
    if (!account) return {};
    return {
        expenseAccountCode: account.code,
        expenseAccountName: account.name,
        expenseAccountParentCode: account.parentCode,
        expenseAccountParentName: account.parentName,
        accountingAccountId: account.code,
        accountingAccountCode: account.code,
        accountingAccountName: account.name,
        accountingAccountFullName: account.name,
        accountingAccountType: account.type,
        accountingAccountDetailType: account.detailType,
        accountingAccountSource: 'expense-account-catalog',
    };
};

const paymentOption = ({ id, label, paymentType, accountCode = '', accountName = '', accountType = '', currency = 'NIO' }) => ({
    id,
    label,
    paymentType,
    accountCode,
    accountName,
    accountType,
    currency,
});

export const EXPENSE_PAYMENT_OPTIONS = [
    paymentOption({ id: 'credit', label: 'Credito', paymentType: 'CREDITO' }),
    paymentOption({ id: 'petty_cash', label: 'Caja Chica (Efectivo)', paymentType: 'EFECTIVO', accountCode: '11013', accountName: 'Activos Circulantes Caja:Caja Chica', accountType: 'Efectivo y equivalentes de efectivo' }),
    paymentOption({ id: '1102101', label: '1102101 - BANCOS:MONEDA NACIONAL:BAC NO. 362843534 C$', paymentType: 'TRANSFERENCIA', accountCode: '1102101', accountName: 'BANCOS:MONEDA NACIONAL:BAC NO. 362843534 C$', accountType: 'Efectivo y equivalentes de efectivo' }),
    paymentOption({ id: '1102102', label: '1102102 - BANCOS:MONEDA NACIONAL:BANPRO NO 10013500002893', paymentType: 'TRANSFERENCIA', accountCode: '1102102', accountName: 'BANCOS:MONEDA NACIONAL:BANPRO NO 10013500002893', accountType: 'Efectivo y equivalentes de efectivo' }),
    paymentOption({ id: '1102103', label: '1102103 - BANCOS:MONEDA NACIONAL:LA FISE NO.106014315 C$', paymentType: 'TRANSFERENCIA', accountCode: '1102103', accountName: 'BANCOS:MONEDA NACIONAL:LA FISE NO.106014315 C$', accountType: 'Efectivo y equivalentes de efectivo' }),
    paymentOption({ id: '1102104', label: '1102104 - BANCOS:MONEDA NACIONAL:LA FISE NO 109047494 C$', paymentType: 'TRANSFERENCIA', accountCode: '1102104', accountName: 'BANCOS:MONEDA NACIONAL:LA FISE NO 109047494 C$', accountType: 'Efectivo y equivalentes de efectivo' }),
    paymentOption({ id: '1102105', label: '1102105 - BANCOS:MONEDA NACIONAL:BANPRO NO 10021500126514', paymentType: 'TRANSFERENCIA', accountCode: '1102105', accountName: 'BANCOS:MONEDA NACIONAL:BANPRO NO 10021500126514', accountType: 'Efectivo y equivalentes de efectivo' }),
    paymentOption({ id: '1102106', label: '1102106 - BANCOS:MONEDA NACIONAL:BAC(2) N. 362705105', paymentType: 'TRANSFERENCIA', accountCode: '1102106', accountName: 'BANCOS:MONEDA NACIONAL:BAC(2) N. 362705105', accountType: 'Efectivo y equivalentes de efectivo' }),
    paymentOption({ id: '1102201', label: '1102201 - BANCOS:MONEDA DOLARES:BAC NO.362785164', paymentType: 'TRANSFERENCIA', accountCode: '1102201', accountName: 'BANCOS:MONEDA DOLARES:BAC NO.362785164', accountType: 'Efectivo y equivalentes de efectivo', currency: 'USD' }),
    paymentOption({ id: '2102901', label: '2102901 - Tarjeta de Credito - Mayor:BAC BLACK MASTERCARD', paymentType: 'TARJETA', accountCode: '2102901', accountName: 'Tarjeta de Credito - Mayor:BAC BLACK MASTERCARD', accountType: 'Tarjeta de credito' }),
    paymentOption({ id: '2102902', label: '2102902 - Tarjeta de Credito - Mayor:BAC Amex Pricesmart', paymentType: 'TARJETA', accountCode: '2102902', accountName: 'Tarjeta de Credito - Mayor:BAC Amex Pricesmart', accountType: 'Tarjeta de credito' }),
    paymentOption({ id: '2102903', label: '2102903 - Tarjeta de credito:VISA GASOLINERA UNO', paymentType: 'TARJETA', accountCode: '2102903', accountName: 'Tarjeta de credito:VISA GASOLINERA UNO', accountType: 'Tarjeta de credito' }),
    paymentOption({ id: '21029-1', label: '21029-1 - Tarjeta de Credito - Mayor:Amex Black', paymentType: 'TARJETA', accountCode: '21029-1', accountName: 'Tarjeta de Credito - Mayor:Amex Black', accountType: 'Tarjeta de credito' }),
    paymentOption({ id: '21029-2', label: '21029-2 - Tarjeta de Credito - Mayor:Banpro Black', paymentType: 'TARJETA', accountCode: '21029-2', accountName: 'Tarjeta de Credito - Mayor:Banpro Black', accountType: 'Tarjeta de credito' }),
];

export const findExpensePaymentOption = (value) => {
    if (!value) return null;
    const candidates = typeof value === 'object'
        ? [
            value.expensePaymentOptionId,
            value.paymentAccountCode,
            value.paymentMethodLabel,
            value.paymentType,
            value.paymentMethod,
        ]
        : [value];

    for (const candidate of candidates.filter(Boolean)) {
        const normalized = normalize(candidate);
        const exact = EXPENSE_PAYMENT_OPTIONS.find((option) => (
            normalize(option.id) === normalized
            || normalize(option.accountCode) === normalized
            || normalize(option.label) === normalized
        ));
        if (exact) return exact;
    }

    const legacy = normalize(candidates.find(Boolean));
    if (legacy.includes('CREDITO')) return EXPENSE_PAYMENT_OPTIONS[0];
    if (legacy.includes('EFECTIVO') || legacy === 'CONTADO') return EXPENSE_PAYMENT_OPTIONS[1];
    if (legacy.includes('PRICESMART')) return EXPENSE_PAYMENT_OPTIONS.find((option) => option.id === '2102902');
    if (legacy.includes('AMEX BLACK')) return EXPENSE_PAYMENT_OPTIONS.find((option) => option.id === '21029-1');
    if (legacy.includes('VISA GASOLINERA') || legacy.includes('GASOLINERA UNO')) return EXPENSE_PAYMENT_OPTIONS.find((option) => option.id === '2102903');
    if (legacy.includes('BAC BLACK MASTERCARD') || legacy.includes('BLACK MASTERCARD')) return EXPENSE_PAYMENT_OPTIONS.find((option) => option.id === '2102901');
    if (legacy.includes('BANPRO BLACK')) return EXPENSE_PAYMENT_OPTIONS.find((option) => option.id === '21029-2');
    if (legacy.includes('TRANSFER')) return EXPENSE_PAYMENT_OPTIONS.find((option) => option.id === '1102101');
    return null;
};

export const buildExpensePaymentPayload = (value) => {
    const option = findExpensePaymentOption(value);
    if (!option) return {};
    return {
        expensePaymentOptionId: option.id,
        paymentType: option.paymentType,
        paymentMethod: option.paymentType,
        paymentMethodLabel: option.label,
        paymentAccountCode: option.accountCode,
        paymentAccountName: option.accountName,
        paymentAccountType: option.accountType,
        paymentAccountCurrency: option.currency,
    };
};

export const getExpensePaymentLabel = (recordOrValue) => (
    findExpensePaymentOption(recordOrValue)?.label
    || (typeof recordOrValue === 'object' ? recordOrValue?.paymentMethodLabel || recordOrValue?.paymentType || '' : String(recordOrValue || ''))
);
