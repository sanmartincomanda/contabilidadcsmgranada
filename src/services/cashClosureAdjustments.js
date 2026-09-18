const money = (value = 0) => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
};

export const calculateCashClosureInternalRatio = ({
    cardTotal = 0,
    transferTotal = 0,
    houseDiscountTotal = 0,
    payrollMealTotal = 0,
    cashIncomeNetTotal = 0,
} = {}) => {
    const nonCashTotal = money(money(cardTotal)
        + money(transferTotal)
        + money(houseDiscountTotal)
        + money(payrollMealTotal));
    const incomeTotal = money(cashIncomeNetTotal);

    return {
        nonCashTotal,
        rc: money(nonCashTotal - incomeTotal),
        cashResidual: money(incomeTotal - nonCashTotal),
    };
};
