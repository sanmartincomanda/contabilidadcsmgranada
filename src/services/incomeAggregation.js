const normalizeDate = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value.substring(0, 10);
    if (value?.toDate) return value.toDate().toISOString().substring(0, 10);
    if (value instanceof Date) return value.toISOString().substring(0, 10);
    return '';
};

const normalizeSource = (value) => value === 'sicar' ? 'sicar' : 'manual';
const normalizeAmount = (value) => Number(value ?? 0) || 0;

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
        source,
        sourceLabel: source === 'sicar' ? 'SICAR' : 'MANUAL',
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
        return sicarItems.length > 0 ? sicarItems : items;
    });
};

export const sumIncomeForMonth = (ingresos = [], month) => {
    if (!month) return 0;

    return resolveReportIncomeEntries(ingresos)
        .filter((income) => income.date?.startsWith(month))
        .reduce((total, income) => total + income.amount, 0);
};
