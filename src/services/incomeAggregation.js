const normalizeDate = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value.substring(0, 10);
    if (value?.toDate) return value.toDate().toISOString().substring(0, 10);
    if (value instanceof Date) return value.toISOString().substring(0, 10);
    return '';
};

const normalizeSource = (value) => value === 'sicar' ? 'sicar' : 'manual';
const normalizeAmount = (value) => Number(value ?? 0) || 0;
const normalizeText = (value = '') => (
    String(value || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
);

export const PURCHASE_DISCOUNT_ADJUSTMENT_TYPE = 'purchase_discount';

export const isPurchaseDiscountAdjustment = (income = {}) => {
    const entryType = String(income?.entryType || '').trim();
    const costAdjustmentType = String(income?.costAdjustmentType || '').trim();
    const accountingType = String(income?.accountingType || '').trim();
    if (entryType) return entryType === PURCHASE_DISCOUNT_ADJUSTMENT_TYPE;
    if (costAdjustmentType) return costAdjustmentType === PURCHASE_DISCOUNT_ADJUSTMENT_TYPE;
    if (accountingType) return accountingType === 'cost_adjustment';

    const searchable = normalizeText([
        income?.type,
        income?.category,
        income?.description,
        income?.detalle,
        income?.reference,
        income?.referencia,
    ].filter(Boolean).join(' '));

    return searchable.includes('DESCUENTO SOBRE COMPRAS');
};

export const getIncomeDate = (income) => normalizeDate(income?.date || income?.fecha || income?.timestamp);
export const getIncomeAmount = (income) => {
    if (income?.source === 'sicar' && income?.subtotal !== undefined) {
        return normalizeAmount(income.subtotal);
    }

    return normalizeAmount(income?.amount ?? income?.monto ?? income?.subtotal ?? income?.total);
};

const normalizeIncomeEntry = (income) => {
    const date = getIncomeDate(income);
    if (!date) return null;

    const source = normalizeSource(income?.source);
    const isPurchaseDiscount = isPurchaseDiscountAdjustment(income);

    return {
        ...income,
        date,
        month: income?.month || date.substring(0, 7),
        amount: getIncomeAmount(income),
        subtotal: normalizeAmount(income?.subtotal ?? income?.amount ?? income?.monto ?? 0),
        subtotalExento: normalizeAmount(income?.subtotalExento ?? income?.subtotal0 ?? 0),
        iva: normalizeAmount(income?.iva ?? 0),
        total: normalizeAmount(income?.total ?? income?.amount ?? income?.monto ?? 0),
        description: income?.description || income?.detalle || (source === 'sicar' ? 'Ingreso diario SICAR' : 'Ingreso manual'),
        reference: income?.reference || income?.referencia || '',
        entryType: income?.entryType || (isPurchaseDiscount ? PURCHASE_DISCOUNT_ADJUSTMENT_TYPE : 'income'),
        accountingType: income?.accountingType || (isPurchaseDiscount ? 'cost_adjustment' : 'income'),
        costAdjustmentType: income?.costAdjustmentType || (isPurchaseDiscount ? PURCHASE_DISCOUNT_ADJUSTMENT_TYPE : ''),
        source,
        sourceLabel: isPurchaseDiscount ? 'DESCUENTO SOBRE COMPRAS' : (source === 'sicar' ? 'SICAR' : 'MANUAL'),
    };
};

export const resolveIncomeEntries = (ingresos = []) => (
    ingresos
        .map(normalizeIncomeEntry)
        .filter(Boolean)
);

export const resolveReportIncomeEntries = (ingresos = []) => {
    const groupedByDate = new Map();

    resolveIncomeEntries(ingresos).forEach((income) => {
        if (!groupedByDate.has(income.date)) {
            groupedByDate.set(income.date, []);
        }

        groupedByDate.get(income.date).push(income);
    });

    return Array.from(groupedByDate.values()).flatMap((items) => {
        const sicarItems = items.filter((item) => item.source === 'sicar');
        const adjustmentItems = items.filter(isPurchaseDiscountAdjustment);
        return sicarItems.length > 0
            ? [...sicarItems, ...adjustmentItems]
            : items;
    });
};

export const resolveSalesIncomeEntries = (ingresos = []) => (
    resolveReportIncomeEntries(ingresos).filter((income) => !isPurchaseDiscountAdjustment(income))
);

export const resolvePurchaseDiscountEntries = (ingresos = []) => (
    resolveReportIncomeEntries(ingresos).filter(isPurchaseDiscountAdjustment)
);

export const sumPurchaseDiscountsForMonth = (ingresos = [], month) => {
    if (!month) return 0;

    return resolvePurchaseDiscountEntries(ingresos)
        .filter((income) => income.date?.startsWith(month))
        .reduce((total, income) => total + getIncomeAmount(income), 0);
};

export const sumIncomeForMonth = (ingresos = [], month) => {
    if (!month) return 0;

    return resolveSalesIncomeEntries(ingresos)
        .filter((income) => income.date?.startsWith(month))
        .reduce((total, income) => total + income.amount, 0);
};
