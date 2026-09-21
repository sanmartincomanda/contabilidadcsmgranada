import assert from 'node:assert/strict';
import test from 'node:test';

import {
    calculateCashClosureInternalRatio,
    isCashClosureRcWithinTolerance,
} from './cashClosureAdjustments.js';

test('alimentacion planilla affects RC exactly like descuento de la casa', () => {
    const withHouseDiscount = calculateCashClosureInternalRatio({
        cardTotal: 100,
        transferTotal: 200,
        houseDiscountTotal: 50,
        cashTotal: 150,
        cashIncomeNetTotal: 500,
    });
    const withPayrollMeal = calculateCashClosureInternalRatio({
        cardTotal: 100,
        transferTotal: 200,
        payrollMealTotal: 50,
        cashTotal: 150,
        cashIncomeNetTotal: 500,
    });

    assert.deepEqual(withPayrollMeal, withHouseDiscount);
    assert.deepEqual(withPayrollMeal, {
        nonCashTotal: 350,
        enteredCashTotal: 150,
        retentionTotal: 0,
        reconciliationTargetTotal: 500,
        reconciledPaymentTotal: 500,
        rc: 0,
        cashResidual: 150,
    });
});

test('combines both non-cash adjustments without changing their signs', () => {
    assert.deepEqual(calculateCashClosureInternalRatio({
        cardTotal: 120,
        transferTotal: 80,
        houseDiscountTotal: 15,
        payrollMealTotal: 25,
        cashIncomeNetTotal: 240,
    }), {
        nonCashTotal: 240,
        enteredCashTotal: 0,
        retentionTotal: 0,
        reconciliationTargetTotal: 240,
        reconciledPaymentTotal: 240,
        rc: 0,
        cashResidual: 0,
    });
});

test('reconciles payroll meals against the SICAR expected total without stamped documents', () => {
    assert.deepEqual(calculateCashClosureInternalRatio({
        payrollMealTotal: 14732.47,
        cashIncomeNetTotal: 0,
        reconciliationTargetTotal: 14732.47,
    }), {
        nonCashTotal: 14732.47,
        enteredCashTotal: 0,
        retentionTotal: 0,
        reconciliationTargetTotal: 14732.47,
        reconciledPaymentTotal: 14732.47,
        rc: 0,
        cashResidual: 0,
    });
});

test('includes retentions when reconciling payment methods against SICAR', () => {
    assert.deepEqual(calculateCashClosureInternalRatio({
        cardTotal: 800,
        cashTotal: 170,
        retentionAdjustment: 30,
        reconciliationTargetTotal: 1000,
    }), {
        nonCashTotal: 800,
        enteredCashTotal: 170,
        retentionTotal: 30,
        reconciliationTargetTotal: 1000,
        reconciledPaymentTotal: 1000,
        rc: 0,
        cashResidual: 170,
    });
});

test('allows a final RC difference from minus ten through plus ten cordobas', () => {
    assert.equal(isCashClosureRcWithinTolerance(-10), true);
    assert.equal(isCashClosureRcWithinTolerance(0), true);
    assert.equal(isCashClosureRcWithinTolerance(10), true);
    assert.equal(isCashClosureRcWithinTolerance(-10.01), false);
    assert.equal(isCashClosureRcWithinTolerance(10.01), false);
});
