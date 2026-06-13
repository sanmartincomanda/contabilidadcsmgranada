import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { httpsCallable } from 'firebase/functions';
import { functions as firebaseFunctions } from '../firebase';
import { APP_BRAND_LOGO, APP_BRAND_NAME, DEFAULT_BRANCH_NAME, fmt } from '../constants';
import CategoryManager from './CategoryManager';
import { getDeviceSettings, saveDeviceSettings } from '../services/deviceSettings';
import {
    ACCESS_MODULES,
    MASTER_USER_EMAIL,
    emptyModuleAccess,
    isMasterEmail,
    normalizeModuleAccess,
    normalizeUserEmail,
} from '../services/userAccess';

const Icons = {
    user: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
    users: 'M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m9-4.13a4 4 0 11-8 0 4 4 0 018 0zm6 4a4 4 0 10-3-3.87M7 10a4 4 0 11-3 3.87',
    tag: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z',
    printer: 'M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z',
    scanner: 'M3 7a2 2 0 012-2h14a2 2 0 012 2v10H3V7zm2 10h14m-9 4h4',
    save: 'M5 13l4 4L19 7',
    receipt: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
};

const Icon = ({ path, className = 'h-5 w-5' }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
);

const Card = ({ children, className = '' }) => (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>
);

const Field = ({ label, children, help }) => (
    <label className="block space-y-1">
        <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{label}</span>
        {children}
        {help && <span className="block text-xs font-semibold text-slate-400">{help}</span>}
    </label>
);

const inputClass = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-800 outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15';

const createEmptyUserForm = () => ({
    email: '',
    displayName: '',
    password: '',
    active: true,
    modules: emptyModuleAccess(),
});

const TestTicket = ({ settings }) => (
    <div className="settings-test-ticket">
        <div className="ticket-logo">
            <img src={APP_BRAND_LOGO} alt={APP_BRAND_NAME} />
        </div>
        <h1>{APP_BRAND_NAME}</h1>
        <h2>PRUEBA IMPRESORA 80MM</h2>
        <div className="line" />
        <p>Impresora configurada:</p>
        <strong>{settings.printer.name || 'Seleccionar en dialogo de impresion'}</strong>
        <div className="row"><span>Ancho</span><span>{settings.printer.paperWidthMm}mm</span></div>
        <div className="row"><span>Fecha</span><span>{new Date().toLocaleString('es-NI')}</span></div>
        <div className="line" />
        <p className="center">Si este ticket sale bien, la Caja Chica esta lista.</p>
    </div>
);

export default function Settings() {
    const { user } = useAuth();
    const isMaster = isMasterEmail(user?.email);
    const [activeTab, setActiveTab] = useState('Usuarios');
    const [settings, setSettings] = useState(() => getDeviceSettings());
    const [saved, setSaved] = useState(false);
    const [systemUsers, setSystemUsers] = useState([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [usersError, setUsersError] = useState('');
    const [usersMessage, setUsersMessage] = useState('');
    const [userForm, setUserForm] = useState(() => createEmptyUserForm());
    const [savingUser, setSavingUser] = useState(false);
    const [usersReloadKey, setUsersReloadKey] = useState(0);
    const userRole = isMaster ? 'Usuario master' : 'Usuario operativo';

    const tabs = useMemo(() => [
        ...(isMaster ? [{ id: 'Usuarios', icon: 'users' }] : []),
        { id: 'Usuario', icon: 'user' },
        { id: 'Categorias', icon: 'tag' },
        { id: 'Dispositivos', icon: 'printer' },
    ], [isMaster]);

    useEffect(() => {
        if (!tabs.some((tab) => tab.id === activeTab)) {
            setActiveTab(tabs[0]?.id || 'Usuario');
        }
    }, [activeTab, tabs]);

    useEffect(() => {
        if (!isMaster || activeTab !== 'Usuarios') return undefined;

        let mounted = true;
        const loadUsers = async () => {
            setUsersLoading(true);
            setUsersError('');
            try {
                const listUsers = httpsCallable(firebaseFunctions, 'adminListAppUsers');
                const result = await listUsers();
                if (!mounted) return;
                setSystemUsers(result.data?.users || []);
            } catch (error) {
                if (!mounted) return;
                setUsersError(error.message || 'No se pudieron cargar los usuarios.');
            } finally {
                if (mounted) setUsersLoading(false);
            }
        };

        loadUsers();
        return () => {
            mounted = false;
        };
    }, [activeTab, isMaster, usersReloadKey]);

    const resetUserForm = () => {
        setUserForm(createEmptyUserForm());
        setUsersMessage('');
        setUsersError('');
    };

    const toggleUserModule = (moduleId) => {
        setUserForm((current) => ({
            ...current,
            modules: {
                ...current.modules,
                [moduleId]: !current.modules?.[moduleId],
            },
        }));
    };

    const editUser = (systemUser) => {
        setUserForm({
            email: normalizeUserEmail(systemUser.email),
            displayName: systemUser.displayName || '',
            password: '',
            active: systemUser.active !== false && systemUser.disabled !== true,
            modules: normalizeModuleAccess(systemUser.modules || {}),
        });
        setUsersMessage('');
        setUsersError('');
    };

    const saveSystemUser = async (event) => {
        event.preventDefault();

        if (!isMaster) return;

        const email = normalizeUserEmail(userForm.email);
        if (!email) {
            setUsersError('Indica el correo del usuario.');
            return;
        }

        if (email === MASTER_USER_EMAIL) {
            setUsersError('El usuario master no se edita desde este panel.');
            return;
        }

        const existingUser = systemUsers.find((item) => normalizeUserEmail(item.email) === email);
        if (!existingUser && userForm.password.trim().length < 6) {
            setUsersError('Para usuarios nuevos, la contrasena debe tener al menos 6 caracteres.');
            return;
        }

        setSavingUser(true);
        setUsersError('');
        setUsersMessage('');

        try {
            const saveUser = httpsCallable(firebaseFunctions, 'adminCreateAppUser');
            await saveUser({
                email,
                displayName: userForm.displayName.trim(),
                password: userForm.password.trim(),
                active: userForm.active,
                modules: normalizeModuleAccess(userForm.modules || {}),
            });
            setUsersMessage(existingUser ? 'Usuario actualizado correctamente.' : 'Usuario creado correctamente.');
            setUserForm(createEmptyUserForm());
            setUsersReloadKey((key) => key + 1);
        } catch (error) {
            setUsersError(error.message || 'No se pudo guardar el usuario.');
        } finally {
            setSavingUser(false);
        }
    };

    const updatePrinter = (field, value) => {
        setSettings((current) => ({
            ...current,
            printer: {
                ...current.printer,
                [field]: value,
            },
        }));
        setSaved(false);
    };

    const updateScanner = (field, value) => {
        setSettings((current) => ({
            ...current,
            scanner: {
                ...current.scanner,
                [field]: value,
            },
        }));
        setSaved(false);
    };

    const handleSave = () => {
        setSettings(saveDeviceSettings(settings));
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1800);
    };

    const handleTestPrint = () => {
        saveDeviceSettings(settings);
        document.body.classList.add('print-settings-test-ticket');
        const cleanup = () => document.body.classList.remove('print-settings-test-ticket');
        window.addEventListener('afterprint', cleanup, { once: true });
        window.print();
        window.setTimeout(cleanup, 1000);
    };

    return (
        <div className="space-y-5">
            <style>{`
                .settings-test-ticket { display: none; }
                @media print {
                    body.print-settings-test-ticket * { visibility: hidden !important; }
                    body.print-settings-test-ticket .settings-test-ticket,
                    body.print-settings-test-ticket .settings-test-ticket * { visibility: visible !important; }
                    body.print-settings-test-ticket .settings-test-ticket {
                        display: block !important;
                        position: fixed !important;
                        left: 0 !important;
                        top: 0 !important;
                        width: 72mm !important;
                        padding: 3mm !important;
                        color: #111827 !important;
                        background: white !important;
                        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
                        font-size: 11px !important;
                    }
                    @page { size: 80mm 180mm; margin: 0; }
                    body.print-settings-test-ticket .ticket-logo { text-align: center; margin-bottom: 4px; }
                    body.print-settings-test-ticket .ticket-logo img { width: 22mm; height: 22mm; object-fit: contain; }
                    body.print-settings-test-ticket h1 { margin: 0; text-align: center; font-size: 13px; font-weight: 900; }
                    body.print-settings-test-ticket h2 { margin: 2px 0 6px; text-align: center; font-size: 11px; font-weight: 900; }
                    body.print-settings-test-ticket .line { border-top: 1px dashed #111827; margin: 6px 0; }
                    body.print-settings-test-ticket .row { display: flex; justify-content: space-between; gap: 8px; margin: 3px 0; }
                    body.print-settings-test-ticket .center { text-align: center; }
                }
            `}</style>

            <Card className="overflow-hidden">
                <div className="flex flex-col gap-4 px-5 py-5 md:flex-row md:items-center md:justify-between">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.34em] text-[#e30613]">{APP_BRAND_NAME}</div>
                        <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Configuraciones</h1>
                        <p className="mt-1 text-sm font-semibold text-slate-500">Usuarios, catalogos fiscales y dispositivos locales.</p>
                    </div>
                    {activeTab === 'Dispositivos' && (
                        <button
                            type="button"
                            onClick={handleSave}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#e30613] px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-red-900/15 transition hover:bg-[#9f111a]"
                        >
                            <Icon path={Icons.save} className="h-4 w-4" />
                            {saved ? 'Guardado' : 'Guardar configuracion'}
                        </button>
                    )}
                </div>
            </Card>

            <Card className="p-2">
                <div className="flex flex-wrap gap-2">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-wider transition ${
                                activeTab === tab.id ? 'bg-[#111827] text-white' : 'text-slate-600 hover:bg-slate-100'
                            }`}
                        >
                            <Icon path={Icons[tab.icon]} className="h-4 w-4" />
                            {tab.id}
                        </button>
                    ))}
                </div>
            </Card>

            {activeTab === 'Usuarios' && isMaster && (
                <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
                    <Card className="overflow-hidden">
                        <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#e30613]">Control de acceso</div>
                            <h2 className="mt-1 text-lg font-black text-slate-950">Crear / editar usuario</h2>
                            <p className="mt-1 text-xs font-semibold text-slate-500">Solo el master puede administrar correos, contrasenas y modulos.</p>
                        </div>

                        <form className="space-y-4 p-5" onSubmit={saveSystemUser}>
                            <Field label="Correo">
                                <input
                                    className={inputClass}
                                    type="email"
                                    value={userForm.email}
                                    onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))}
                                    placeholder="usuario@empresa.com"
                                    autoComplete="off"
                                />
                            </Field>

                            <Field label="Nombre">
                                <input
                                    className={inputClass}
                                    value={userForm.displayName}
                                    onChange={(event) => setUserForm((current) => ({ ...current, displayName: event.target.value }))}
                                    placeholder="Nombre del colaborador"
                                    autoComplete="off"
                                />
                            </Field>

                            <Field label="Contrasena" help="Para actualizar un usuario existente puedes dejarla vacia. Para uno nuevo minimo 6 caracteres.">
                                <input
                                    className={inputClass}
                                    type="password"
                                    value={userForm.password}
                                    onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))}
                                    placeholder="Nueva contrasena"
                                    autoComplete="new-password"
                                />
                            </Field>

                            <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                <div>
                                    <div className="text-sm font-black text-slate-900">Usuario activo</div>
                                    <div className="text-xs font-semibold text-slate-400">Si lo apagas no podra iniciar sesion.</div>
                                </div>
                                <input
                                    type="checkbox"
                                    checked={userForm.active}
                                    onChange={(event) => setUserForm((current) => ({ ...current, active: event.target.checked }))}
                                    className="h-5 w-5 accent-[#e30613]"
                                />
                            </label>

                            <div className="space-y-2">
                                <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Modulos permitidos</div>
                                <div className="grid gap-2">
                                    {ACCESS_MODULES.map((module) => (
                                        <label
                                            key={module.id}
                                            className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition ${
                                                userForm.modules?.[module.id]
                                                    ? 'border-[#e30613]/30 bg-[#fff1f2]'
                                                    : 'border-slate-200 bg-white hover:bg-slate-50'
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={userForm.modules?.[module.id] === true}
                                                onChange={() => toggleUserModule(module.id)}
                                                className="mt-1 h-4 w-4 accent-[#e30613]"
                                            />
                                            <span>
                                                <span className="block text-sm font-black text-slate-900">{module.label}</span>
                                                <span className="block text-xs font-semibold text-slate-500">{module.description}</span>
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {usersError && (
                                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                                    {usersError}
                                </div>
                            )}
                            {usersMessage && (
                                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
                                    {usersMessage}
                                </div>
                            )}

                            <div className="flex flex-col gap-2 sm:flex-row">
                                <button
                                    type="submit"
                                    disabled={savingUser}
                                    className="inline-flex flex-1 items-center justify-center rounded-xl bg-[#e30613] px-4 py-3 text-sm font-black text-white shadow-lg shadow-red-900/15 transition hover:bg-[#9f111a] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {savingUser ? 'Guardando...' : 'Guardar usuario'}
                                </button>
                                <button
                                    type="button"
                                    onClick={resetUserForm}
                                    className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50"
                                >
                                    Nuevo
                                </button>
                            </div>
                        </form>
                    </Card>

                    <Card className="overflow-hidden">
                        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 md:flex-row md:items-center md:justify-between">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Usuarios creados</div>
                                <h2 className="mt-1 text-lg font-black text-slate-950">Accesos por modulo</h2>
                            </div>
                            <button
                                type="button"
                                onClick={() => setUsersReloadKey((key) => key + 1)}
                                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-slate-700 transition hover:bg-slate-100"
                            >
                                Actualizar lista
                            </button>
                        </div>

                        <div className="p-5">
                            {usersLoading && (
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm font-bold text-slate-500">
                                    Cargando usuarios...
                                </div>
                            )}

                            {!usersLoading && systemUsers.length === 0 && (
                                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">
                                    No hay usuarios listados todavia. Si acabas de crear las Functions, despliegalas para poder leer Firebase Auth.
                                </div>
                            )}

                            {!usersLoading && systemUsers.length > 0 && (
                                <div className="overflow-hidden rounded-2xl border border-slate-200">
                                    <div className="hidden grid-cols-[1.4fr_0.8fr_1.4fr_120px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 md:grid">
                                        <span>Usuario</span>
                                        <span>Estado</span>
                                        <span>Modulos</span>
                                        <span className="text-right">Accion</span>
                                    </div>
                                    <div className="divide-y divide-slate-100">
                                        {systemUsers.map((systemUser) => {
                                            const email = normalizeUserEmail(systemUser.email);
                                            const isProtectedMaster = email === MASTER_USER_EMAIL;
                                            const enabledModules = ACCESS_MODULES.filter((module) => systemUser.modules?.[module.id] === true);

                                            return (
                                                <div key={email || systemUser.uid} className="grid gap-3 px-4 py-4 md:grid-cols-[1.4fr_0.8fr_1.4fr_120px] md:items-center">
                                                    <div>
                                                        <div className="text-sm font-black text-slate-950">{systemUser.displayName || email}</div>
                                                        <div className="mt-0.5 text-xs font-semibold text-slate-500">{email}</div>
                                                    </div>
                                                    <div>
                                                        <span className={`inline-flex rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wider ${
                                                            isProtectedMaster
                                                                ? 'bg-amber-100 text-amber-700'
                                                                : systemUser.active
                                                                    ? 'bg-emerald-100 text-emerald-700'
                                                                    : 'bg-slate-200 text-slate-600'
                                                        }`}>
                                                            {isProtectedMaster ? 'Master' : systemUser.active ? 'Activo' : 'Inactivo'}
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {isProtectedMaster ? (
                                                            <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-white">Todos</span>
                                                        ) : enabledModules.length ? enabledModules.map((module) => (
                                                            <span key={module.id} className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-slate-600">
                                                                {module.label}
                                                            </span>
                                                        )) : (
                                                            <span className="text-xs font-bold text-rose-500">Sin modulos</span>
                                                        )}
                                                    </div>
                                                    <div className="text-left md:text-right">
                                                        <button
                                                            type="button"
                                                            disabled={isProtectedMaster}
                                                            onClick={() => editUser(systemUser)}
                                                            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
                                                        >
                                                            Editar
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </Card>
                </div>
            )}

            {activeTab === 'Usuario' && (
                <Card className="overflow-hidden">
                    <div className="grid gap-4 p-5 md:grid-cols-[auto_1fr] md:items-center">
                        <img src={APP_BRAND_LOGO} alt={APP_BRAND_NAME} className="h-20 w-20 rounded-2xl border border-slate-200 bg-white object-contain p-2" />
                        <div>
                            <div className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">Sesion activa</div>
                            <h2 className="mt-1 text-xl font-black text-slate-950">{user?.email || 'Usuario'}</h2>
                            <p className="mt-1 text-sm font-semibold text-slate-500">{userRole} - {DEFAULT_BRANCH_NAME}</p>
                        </div>
                    </div>
                </Card>
            )}

            {activeTab === 'Categorias' && (
                <div className="space-y-4">
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-800">
                        El catalogo activo alimenta gastos, compras, cuentas por pagar y reportes fiscales. Para cambios estructurales, se recomienda migracion controlada para no desordenar historicos.
                    </div>
                    <CategoryManager />
                </div>
            )}

            {activeTab === 'Dispositivos' && (
                <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
                    <Card className="overflow-hidden">
                        <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                            <div className="flex items-center gap-3">
                                <div className="rounded-xl bg-[#fff1f2] p-2 text-[#e30613]">
                                    <Icon path={Icons.printer} className="h-5 w-5" />
                                </div>
                                <div>
                                    <h2 className="text-sm font-black uppercase tracking-wider text-slate-900">Impresora ticket 80mm</h2>
                                    <p className="text-xs font-semibold text-slate-400">Usa la impresora instalada en Windows con su driver.</p>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-4 p-5">
                            <Field label="Nombre de impresora en Windows" help="El navegador no puede forzar impresora por seguridad; usa este nombre como referencia al elegirla en el dialogo.">
                                <input
                                    className={inputClass}
                                    value={settings.printer.name}
                                    onChange={(event) => updatePrinter('name', event.target.value)}
                                    placeholder="Ej: POS-80, XP-80C, EPSON TM-T20..."
                                />
                            </Field>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <Field label="Ancho papel">
                                    <select
                                        className={inputClass}
                                        value={settings.printer.paperWidthMm}
                                        onChange={(event) => updatePrinter('paperWidthMm', Number(event.target.value))}
                                    >
                                        <option value={80}>80mm</option>
                                        <option value={58}>58mm</option>
                                    </select>
                                </Field>
                                <Field label="Alto estimado ticket">
                                    <input
                                        className={inputClass}
                                        type="number"
                                        min="100"
                                        max="300"
                                        value={settings.printer.ticketHeightMm}
                                        onChange={(event) => updatePrinter('ticketHeightMm', Number(event.target.value))}
                                    />
                                </Field>
                            </div>
                            <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                <div>
                                    <div className="text-sm font-black text-slate-900">Imprimir voucher automatico en Caja Chica</div>
                                    <div className="text-xs font-semibold text-slate-400">Despues de guardar un gasto o compra en Caja Chica se abre la impresion del ticket.</div>
                                </div>
                                <input
                                    type="checkbox"
                                    checked={settings.printer.voucherAutoPrint}
                                    onChange={(event) => updatePrinter('voucherAutoPrint', event.target.checked)}
                                    className="h-5 w-5 accent-[#e30613]"
                                />
                            </label>
                            <button
                                type="button"
                                onClick={handleTestPrint}
                                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#e30613] bg-white px-4 py-3 text-sm font-black text-[#e30613] transition hover:bg-[#fff1f2]"
                            >
                                <Icon path={Icons.receipt} className="h-4 w-4" />
                                Imprimir ticket de prueba
                            </button>
                        </div>
                    </Card>

                    <Card className="overflow-hidden">
                        <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                            <div className="flex items-center gap-3">
                                <div className="rounded-xl bg-slate-900 p-2 text-white">
                                    <Icon path={Icons.scanner} className="h-5 w-5" />
                                </div>
                                <div>
                                    <h2 className="text-sm font-black uppercase tracking-wider text-slate-900">Escaner</h2>
                                    <p className="text-xs font-semibold text-slate-400">Preparado para flujo local de soportes.</p>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-4 p-5">
                            <Field label="Nombre / modelo">
                                <input className={inputClass} value={settings.scanner.name} onChange={(event) => updateScanner('name', event.target.value)} placeholder="Ej: Canon, Epson, Brother..." />
                            </Field>
                            <Field label="Carpeta de entrada" help="Para una integracion avanzada se puede usar una carpeta vigilada por un worker local.">
                                <input className={inputClass} value={settings.scanner.folder} onChange={(event) => updateScanner('folder', event.target.value)} placeholder="C:\\SICAR\\scans\\facturas" />
                            </Field>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500">
                                Nota tecnica: desde una web normal no se puede controlar un escaner USB directo sin aplicacion local. La impresora si funciona usando el dialogo de impresion del navegador y el driver instalado.
                            </div>
                        </div>
                    </Card>
                </div>
            )}

            <TestTicket settings={settings} />
        </div>
    );
}
