import React, { useMemo, useRef, useState } from 'react';
import { getProviderCode, getProviderDisplayName, normalizeProviderName } from '../services/providers';

const searchText = (value = '') => normalizeProviderName(value);

const prepareProviders = (providers = []) => (
    providers
        .map((provider) => {
            const nombre = getProviderDisplayName(provider);
            const code = provider.code || provider.codigo || getProviderCode(nombre);
            return { ...provider, nombre, code };
        })
        .filter((provider) => provider.nombre)
        .sort((left, right) => left.nombre.localeCompare(right.nombre, 'es'))
);

export default function ProviderAutocomplete({
    label = 'Proveedor',
    value = '',
    onChange,
    providers = [],
    placeholder = 'Buscar proveedor...',
    required = false,
    allowCreate = true,
    disabled = false,
    className = '',
}) {
    const [isOpen, setIsOpen] = useState(false);
    const inputRef = useRef(null);
    const normalizedValue = searchText(value);

    const providerOptions = useMemo(() => prepareProviders(providers), [providers]);
    const filteredProviders = useMemo(() => {
        const query = searchText(value);
        if (!query) return providerOptions.slice(0, 10);

        return providerOptions
            .filter((provider) => (
                searchText(provider.nombre).includes(query)
                || searchText(provider.code).includes(query)
            ))
            .slice(0, 10);
    }, [providerOptions, value]);

    const exactMatch = providerOptions.some((provider) => searchText(provider.nombre) === normalizedValue);
    const cleanNewName = normalizeProviderName(value);
    const canCreate = allowCreate && cleanNewName && !exactMatch;

    const selectProvider = (providerName) => {
        onChange?.(providerName);
        setIsOpen(false);
        inputRef.current?.blur();
    };

    return (
        <div className={`relative space-y-1.5 ${className}`}>
            {label && (
                <label className="text-xs font-bold uppercase tracking-wider text-stone-500">
                    {label}
                    {required && <span className="ml-1 text-[#e30613]">*</span>}
                </label>
            )}
            <div className="relative">
                <input
                    ref={inputRef}
                    value={value}
                    onChange={(event) => {
                        onChange?.(event.target.value);
                        setIsOpen(true);
                    }}
                    onFocus={() => setIsOpen(true)}
                    onBlur={() => window.setTimeout(() => setIsOpen(false), 130)}
                    placeholder={placeholder}
                    required={required}
                    disabled={disabled}
                    autoComplete="off"
                    className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-semibold text-stone-700 outline-none transition-all focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black uppercase tracking-[0.16em] text-stone-400">
                    Buscar
                </span>
            </div>

            {isOpen && !disabled && (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-xl border border-stone-200 bg-white p-1 shadow-xl shadow-slate-900/12">
                    {filteredProviders.length > 0 ? (
                        filteredProviders.map((provider) => (
                            <button
                                type="button"
                                key={provider.id || provider.nombre}
                                onMouseDown={(event) => {
                                    event.preventDefault();
                                    selectProvider(provider.nombre);
                                }}
                                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-[#fff1f2]"
                            >
                                <span className="min-w-0">
                                    <span className="block truncate text-sm font-black text-slate-800">{provider.nombre}</span>
                                    <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-stone-400">{provider.code}</span>
                                </span>
                                <span className="rounded-full bg-stone-100 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-stone-500">Elegir</span>
                            </button>
                        ))
                    ) : (
                        <div className="px-3 py-3 text-sm font-semibold text-stone-500">No hay coincidencias.</div>
                    )}

                    {canCreate && (
                        <button
                            type="button"
                            onMouseDown={(event) => {
                                event.preventDefault();
                                selectProvider(cleanNewName);
                            }}
                            className="mt-1 flex w-full items-center justify-between gap-3 rounded-lg border border-dashed border-[#e30613]/30 bg-[#fff8f8] px-3 py-2 text-left transition hover:bg-[#fff1f2]"
                        >
                            <span>
                                <span className="block text-sm font-black text-[#9f111a]">Crear proveedor</span>
                                <span className="block text-xs font-semibold text-stone-600">{cleanNewName}</span>
                            </span>
                            <span className="rounded-full bg-[#e30613] px-2 py-1 text-[10px] font-black uppercase tracking-wide text-white">Nuevo</span>
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
