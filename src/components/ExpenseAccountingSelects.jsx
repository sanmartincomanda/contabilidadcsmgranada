import React from 'react';
import {
    EXPENSE_ACCOUNT_GROUPS,
    EXPENSE_PAYMENT_OPTIONS,
} from '../services/expenseAccounting';

const selectClass = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-800 outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15';

const FieldShell = ({ label, help, className = '', children }) => (
    <label className={`block space-y-1 ${className}`}>
        {label && <span className="text-xs font-bold uppercase tracking-wider text-stone-500">{label}</span>}
        {children}
        {help && <span className="block text-xs font-semibold text-slate-400">{help}</span>}
    </label>
);

export function ExpenseAccountSelect({
    label = 'Cuenta de gasto',
    value,
    onChange,
    required = false,
    disabled = false,
    help = 'Selecciona unicamente la cuenta hija donde se registrara el gasto.',
    className = '',
}) {
    return (
        <FieldShell label={label} help={help} className={className}>
            <select
                className={selectClass}
                value={value || ''}
                onChange={(event) => onChange?.(event.target.value)}
                required={required}
                disabled={disabled}
            >
                <option value="">Seleccionar cuenta hija...</option>
                {EXPENSE_ACCOUNT_GROUPS.map((accountGroup) => (
                    <optgroup key={accountGroup.code} label={`${accountGroup.code} - ${accountGroup.name}`}>
                        {accountGroup.accounts.map((account) => (
                            <option key={account.code} value={account.code}>
                                {account.code} - {account.name}
                            </option>
                        ))}
                    </optgroup>
                ))}
            </select>
        </FieldShell>
    );
}

const PAYMENT_GROUPS = [
    {
        label: 'Condicion y caja',
        options: EXPENSE_PAYMENT_OPTIONS.filter((option) => ['credit', 'petty_cash'].includes(option.id)),
    },
    {
        label: 'Cuentas bancarias',
        options: EXPENSE_PAYMENT_OPTIONS.filter((option) => option.accountCode.startsWith('1102')),
    },
    {
        label: 'Tarjetas de credito',
        options: EXPENSE_PAYMENT_OPTIONS.filter((option) => option.accountCode.startsWith('21029')),
    },
];

export function ExpensePaymentSelect({
    label = 'Pagado con',
    value,
    onChange,
    required = false,
    disabled = false,
    excludedIds = [],
    help = 'La cuenta seleccionada sera la contrapartida del gasto en el libro contable.',
    className = '',
}) {
    return (
        <FieldShell label={label} help={help} className={className}>
            <select
                className={selectClass}
                value={value || ''}
                onChange={(event) => onChange?.(event.target.value)}
                required={required}
                disabled={disabled}
            >
                <option value="">Seleccionar forma y cuenta de pago...</option>
                {PAYMENT_GROUPS.map((paymentGroup) => ({
                    ...paymentGroup,
                    options: paymentGroup.options.filter((option) => !excludedIds.includes(option.id)),
                })).filter((paymentGroup) => paymentGroup.options.length > 0).map((paymentGroup) => (
                    <optgroup key={paymentGroup.label} label={paymentGroup.label}>
                        {paymentGroup.options.map((option) => (
                            <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                    </optgroup>
                ))}
            </select>
        </FieldShell>
    );
}
