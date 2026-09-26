import test from 'node:test';
import assert from 'node:assert/strict';
import {
    EXPENSE_ACCOUNTS,
    EXPENSE_PAYMENT_OPTIONS,
    buildExpenseAccountPayload,
    buildExpensePaymentPayload,
    findExpenseAccount,
    findExpensePaymentOption,
} from './expenseAccounting.js';

test('solo expone cuentas hijas de gastos y no cuentas madre', () => {
    const codes = new Set(EXPENSE_ACCOUNTS.map((account) => account.code));
    assert.equal(codes.size, 124);
    ['5', '5200', '5300', '5400', '5500', '5600', '5700', '5900'].forEach((code) => {
        assert.equal(codes.has(code), false, code);
    });
    ['5201', '5310', '5709', '590089'].forEach((code) => {
        assert.equal(codes.has(code), true, code);
    });
});

test('genera la cuenta contable real desde la cuenta hija', () => {
    const payload = buildExpenseAccountPayload('5706');
    assert.equal(payload.accountingAccountCode, '5706');
    assert.equal(payload.accountingAccountName, 'Gastos de ventas:Combustible');
    assert.equal(payload.expenseAccountParentCode, '5700');
    assert.equal(findExpenseAccount(payload)?.code, '5706');
});

test('cada forma de pago apunta a una cuenta financiera unica', () => {
    assert.equal(EXPENSE_PAYMENT_OPTIONS.length, 14);
    const bac2 = buildExpensePaymentPayload('1102106');
    assert.equal(bac2.paymentType, 'TRANSFERENCIA');
    assert.equal(bac2.paymentAccountCode, '1102106');
    const card = buildExpensePaymentPayload('2102901');
    assert.equal(card.paymentType, 'TARJETA');
    assert.equal(card.paymentAccountCode, '2102901');
    assert.equal(findExpensePaymentOption(card)?.id, '2102901');
});

test('credito y caja chica conservan su comportamiento operativo', () => {
    assert.equal(buildExpensePaymentPayload('credit').paymentType, 'CREDITO');
    const pettyCash = buildExpensePaymentPayload('petty_cash');
    assert.equal(pettyCash.paymentType, 'EFECTIVO');
    assert.equal(pettyCash.paymentAccountCode, '11013');
});

test('liga las transferencias antiguas a la cuenta BAC principal', () => {
    assert.equal(findExpensePaymentOption({ paymentType: 'TRANSFERENCIA' })?.id, '1102101');
    assert.equal(findExpensePaymentOption({ paymentAccountCode: '1102104' })?.id, '1102104');
});
