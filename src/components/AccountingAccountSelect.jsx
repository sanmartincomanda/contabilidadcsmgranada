import React, { useEffect, useMemo, useState } from 'react';
import {
    filterAccountingAccounts,
    getDefaultAccountingAccountId,
    groupAccountingAccountsByType,
    loadChartOfAccounts,
} from '../services/chartOfAccounts';

const selectClass = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-800 outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15';

export default function AccountingAccountSelect({
    label = 'Cuenta contable',
    value,
    onChange,
    transactionType = '',
    required = false,
    help = 'Categoria fiscal queda informativa; esta cuenta alimenta la contabilidad real.',
    className = '',
}) {
    const [accounts, setAccounts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let mounted = true;
        setLoading(true);
        loadChartOfAccounts()
            .then((loadedAccounts) => {
                if (!mounted) return;
                setAccounts(loadedAccounts);
                setError('');
            })
            .catch((loadError) => {
                if (!mounted) return;
                setError(loadError.message || 'No se pudo cargar el plan de cuentas.');
            })
            .finally(() => {
                if (mounted) setLoading(false);
            });
        return () => {
            mounted = false;
        };
    }, []);

    const options = useMemo(() => filterAccountingAccounts(accounts, transactionType), [accounts, transactionType]);
    const grouped = useMemo(() => groupAccountingAccountsByType(options), [options]);

    useEffect(() => {
        if (!onChange || value || loading || !options.length) return;
        const defaultAccountId = getDefaultAccountingAccountId(transactionType);
        const defaultExists = options.some((account) => account.id === defaultAccountId || account.number === defaultAccountId);
        onChange(defaultExists ? defaultAccountId : options[0].id);
    }, [loading, onChange, options, transactionType, value]);

    return (
        <label className={`block space-y-1 ${className}`}>
            {label && <span className="text-xs font-bold uppercase tracking-wider text-stone-500">{label}</span>}
            <select
                className={selectClass}
                value={value || ''}
                onChange={(event) => onChange?.(event.target.value)}
                required={required}
                disabled={loading || !options.length}
            >
                <option value="">{loading ? 'Cargando plan de cuentas...' : 'Seleccionar cuenta contable...'}</option>
                {Object.entries(grouped).map(([type, typeAccounts]) => (
                    <optgroup key={type} label={type}>
                        {typeAccounts.map((account) => (
                            <option key={account.id} value={account.id}>
                                {account.number ? `${account.number} - ${account.name}` : account.name}
                            </option>
                        ))}
                    </optgroup>
                ))}
            </select>
            {error ? (
                <span className="block text-xs font-semibold text-rose-500">{error}</span>
            ) : help ? (
                <span className="block text-xs font-semibold text-slate-400">{help}</span>
            ) : null}
        </label>
    );
}
