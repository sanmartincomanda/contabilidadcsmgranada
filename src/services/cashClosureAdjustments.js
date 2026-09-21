const money = (value = 0) => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
};

export const CASH_CLOSURE_RC_TOLERANCE = 10;

export const isCashClosureRcWithinTolerance = (
    value = 0,
    tolerance = CASH_CLOSURE_RC_TOLERANCE
) => Math.abs(money(value)) <= Math.abs(money(tolerance));

export const calculateCashClosureInternalRatio = ({
    cardTotal = 0,
    transferTotal = 0,
    houseDiscountTotal = 0,
    payrollMealTotal = 0,
    cashTotal = 0,
    cashIncomeNetTotal = 0,
    reconciliationTargetTotal,
    retentionAdjustment = 0,
} = {}) => {
    const nonCashTotal = money(money(cardTotal)
        + money(transferTotal)
        + money(houseDiscountTotal)
        + money(payrollMealTotal));
    const enteredCashTotal = money(cashTotal);
    const incomeTotal = money(cashIncomeNetTotal);
    const targetTotal = reconciliationTargetTotal === undefined || reconciliationTargetTotal === null
        ? incomeTotal
        : money(reconciliationTargetTotal);
    const retentionTotal = money(retentionAdjustment);
    const reconciledPaymentTotal = money(nonCashTotal + enteredCashTotal + retentionTotal);

    return {
        nonCashTotal,
        enteredCashTotal,
        retentionTotal,
        reconciliationTargetTotal: targetTotal,
        reconciledPaymentTotal,
        rc: money(reconciledPaymentTotal - targetTotal),
        cashResidual: money(targetTotal - nonCashTotal - retentionTotal),
    };
};
