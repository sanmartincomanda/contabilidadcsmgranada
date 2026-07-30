import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { httpsCallable } from 'firebase/functions';
import { collection, deleteDoc, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { db, functions as firebaseFunctions } from '../firebase';
import { APP_BRAND_LOGO, APP_BRAND_NAME, BRANCHES, DEFAULT_BRANCH_ID, DEFAULT_BRANCH_NAME, branchName, fmt } from '../constants';
import CategoryManager from './CategoryManager';
import { getDeviceSettings, saveDeviceSettings } from '../services/deviceSettings';
import {
    buildClientPayload,
    CLIENTS_COLLECTION,
    createEmptyClientForm,
    normalizeClientRecord,
    normalizeClientText,
} from '../services/clientCatalog';
import {
    ACCESS_MODULES,
    MASTER_USER_EMAIL,
    MODULE_ACCESS_EDIT,
    MODULE_ACCESS_NONE,
    MODULE_ACCESS_VIEW,
    USER_PROFILES_COLLECTION,
    emptyModuleAccess,
    emptyModuleModes,
    getModuleModeLabel,
    isMasterEmail,
    normalizeBranchAccess,
    normalizeModuleAccess,
    normalizeModuleModes,
    normalizeUserEmail,
} from '../services/userAccess';
import { loadChartOfAccounts } from '../services/chartOfAccounts';
import { ACCOUNTING_ENTRIES_COLLECTION } from '../services/accountingLedger';

const Icons = {
    user: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
    users: 'M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m9-4.13a4 4 0 11-8 0 4 4 0 018 0zm6 4a4 4 0 10-3-3.87M7 10a4 4 0 11-3 3.87',
    tag: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z',
    printer: 'M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z',
    scanner: 'M3 7a2 2 0 012-2h14a2 2 0 012 2v10H3V7zm2 10h14m-9 4h4',
    save: 'M5 13l4 4L19 7',
    receipt: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
    clients: 'M17 20h5v-2a3 3 0 00-3-3h-2m-4 5H3v-2a3 3 0 013-3h4m0-4a4 4 0 100-8 4 4 0 000 8zm9-1a3 3 0 100-6 3 3 0 000 6z',
    ledger: 'M4 5a2 2 0 012-2h10a2 2 0 012 2v14l-3-2-3 2-3-2-3 2V5zm4 3h8M8 12h8M8 16h5',
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

const getCurrentMonth = () => new Date().toISOString().substring(0, 7);

const LEDGER_QUICK_FILTERS = [
    { id: 'all', label: 'Todo' },
    { id: 'retentions', label: 'Retenciones' },
    { id: 'credit_cards', label: 'Tarjetas credito' },
    { id: 'bac', label: 'Cuentas BAC' },
    { id: 'payable', label: 'Cuentas por pagar' },
];

const getAccountingLineKey = (entry, line, index) => `${entry.id || entry.sourceDocId}-${line.lineId || index}`;

const isRetentionLine = (line = {}) => (
    ['21041', '21043'].includes(String(line.accountCode || ''))
    || String(line.lineRole || '').toLowerCase().includes('retention')
    || normalizeClientText(`${line.accountName || ''}`).includes('RETENCION')
);

const isCreditCardLine = (line = {}) => (
    String(line.accountCode || '').startsWith('21029')
    || normalizeClientText(`${line.accountName || ''} ${line.accountType || ''}`).includes('TARJETA')
);

const isBacLine = (line = {}) => normalizeClientText(`${line.accountName || ''} ${line.description || ''}`).includes('BAC');

const isPayableLine = (line = {}) => (
    String(line.accountCode || '').startsWith('2101')
    || normalizeClientText(`${line.accountName || ''} ${line.accountType || ''}`).includes('CUENTAS POR PAGAR')
);

const getEntryDisplayDate = (entry = {}) => {
    if (typeof entry.date === 'string') return entry.date.substring(0, 10);
    if (entry.date?.toDate) return entry.date.toDate().toISOString().substring(0, 10);
    return '';
};

const createEmptyUserForm = () => ({
    email: '',
    displayName: '',
    password: '',
    active: true,
    modules: emptyModuleAccess(),
    moduleModes: emptyModuleModes(),
    branchAccess: [DEFAULT_BRANCH_ID],
    defaultBranchId: DEFAULT_BRANCH_ID,
});

const sortListedUsers = (users = []) => [...users].sort((a, b) => {
    const aEmail = normalizeUserEmail(a.email);
    const bEmail = normalizeUserEmail(b.email);
    if (aEmail === MASTER_USER_EMAIL) return -1;
    if (bEmail === MASTER_USER_EMAIL) return 1;
    return (a.displayName || aEmail).localeCompare(b.displayName || bEmail, 'es');
});

const normalizeListedUser = (raw = {}) => {
    const email = normalizeUserEmail(raw.email || raw.id || '');
    const isProtectedMaster = email === MASTER_USER_EMAIL;

    return {
        uid: raw.uid || '',
        email,
        displayName: raw.displayName || raw.name || (isProtectedMaster ? 'Luis Saenz' : email),
        active: isProtectedMaster ? true : raw.active !== false && raw.disabled !== true,
        disabled: isProtectedMaster ? false : raw.disabled === true || raw.active === false,
        modules: isProtectedMaster ? {} : normalizeModuleAccess(raw.modules || {}),
        moduleModes: isProtectedMaster ? {} : normalizeModuleModes(raw.modules || {}, raw.moduleModes || {}),
        branchAccess: isProtectedMaster ? BRANCHES.map((branch) => branch.id) : normalizeBranchAccess(raw.branchAccess || raw.branches || raw.allowedBranches, [DEFAULT_BRANCH_ID]),
        defaultBranchId: raw.defaultBranchId || raw.defaultBranch || DEFAULT_BRANCH_ID,
        role: isProtectedMaster ? 'master' : raw.role || 'limited',
        source: raw.source || 'auth',
    };
};

const mergeListedUsers = (...groups) => {
    const byEmail = new Map();

    groups.flat().forEach((rawUser) => {
        const user = normalizeListedUser(rawUser);
        if (!user.email) return;
        byEmail.set(user.email, {
            ...(byEmail.get(user.email) || {}),
            ...user,
        });
    });

    return sortListedUsers([...byEmail.values()]);
};

const loadStoredUserProfiles = async () => {
    const snapshot = await getDocs(collection(db, USER_PROFILES_COLLECTION));
    const users = snapshot.docs.map((docSnap) => normalizeListedUser({
        id: docSnap.id,
        ...(docSnap.data() || {}),
        source: 'firestore',
    }));

    if (!users.some((listedUser) => normalizeUserEmail(listedUser.email) === MASTER_USER_EMAIL)) {
        users.unshift(normalizeListedUser({
            email: MASTER_USER_EMAIL,
            displayName: 'Luis Saenz',
            active: true,
            role: 'master',
            source: 'local-master',
        }));
    }

    return sortListedUsers(users.filter((listedUser) => listedUser.email));
};

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
    const [usersListNotice, setUsersListNotice] = useState('');
    const [usersMessage, setUsersMessage] = useState('');
    const [userForm, setUserForm] = useState(() => createEmptyUserForm());
    const [savingUser, setSavingUser] = useState(false);
    const [usersReloadKey, setUsersReloadKey] = useState(0);
    const [clients, setClients] = useState([]);
    const [clientsLoading, setClientsLoading] = useState(false);
    const [clientsError, setClientsError] = useState('');
    const [clientsMessage, setClientsMessage] = useState('');
    const [clientSearch, setClientSearch] = useState('');
    const [clientForm, setClientForm] = useState(() => createEmptyClientForm());
    const [savingClient, setSavingClient] = useState(false);
    const [clientReloadKey, setClientReloadKey] = useState(0);
    const [chartAccounts, setChartAccounts] = useState([]);
    const [chartLoading, setChartLoading] = useState(false);
    const [chartError, setChartError] = useState('');
    const [chartSearch, setChartSearch] = useState('');
    const [chartTypeFilter, setChartTypeFilter] = useState('');
    const [chartView, setChartView] = useState('catalog');
    const [ledgerMonth, setLedgerMonth] = useState(getCurrentMonth());
    const [ledgerBranchFilter, setLedgerBranchFilter] = useState('all');
    const [ledgerQuickFilter, setLedgerQuickFilter] = useState('all');
    const [ledgerAccountFilter, setLedgerAccountFilter] = useState('');
    const [ledgerSearch, setLedgerSearch] = useState('');
    const [ledgerEntries, setLedgerEntries] = useState([]);
    const [ledgerLoading, setLedgerLoading] = useState(false);
    const [ledgerError, setLedgerError] = useState('');
    const [ledgerReloadKey, setLedgerReloadKey] = useState(0);
    const [expandedLedgerEntryId, setExpandedLedgerEntryId] = useState('');
    const userRole = isMaster ? 'Usuario master' : 'Usuario operativo';

    const tabs = useMemo(() => [
        ...(isMaster ? [{ id: 'Usuarios', icon: 'users' }] : []),
        { id: 'Usuario', icon: 'user' },
        ...(isMaster ? [{ id: 'Clientes', icon: 'clients' }] : []),
        ...(isMaster ? [{ id: 'Plan de cuentas', icon: 'ledger' }] : []),
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
            setUsersListNotice('');
            try {
                const listUsers = httpsCallable(firebaseFunctions, 'adminListAppUsers');
                const result = await listUsers();
                if (!mounted) return;
                const callableUsers = mergeListedUsers(result.data?.users || []);

                if (callableUsers.length > 0) {
                    setSystemUsers(callableUsers);
                    return;
                }

                const storedUsers = await loadStoredUserProfiles();
                if (!mounted) return;
                setSystemUsers(storedUsers);
                setUsersListNotice('Mostrando usuarios guardados en perfiles del sistema.');
            } catch (error) {
                try {
                    const storedUsers = await loadStoredUserProfiles();
                    if (!mounted) return;
                    setSystemUsers(storedUsers);
                    setUsersListNotice(`Mostrando perfiles guardados. Firebase Auth no respondio: ${error.message || 'error desconocido'}`);
                } catch (fallbackError) {
                    if (!mounted) return;
                    setSystemUsers([]);
                    setUsersError(fallbackError.message || error.message || 'No se pudieron cargar los usuarios.');
                }
            } finally {
                if (mounted) setUsersLoading(false);
            }
        };

        loadUsers();
        return () => {
            mounted = false;
        };
    }, [activeTab, isMaster, usersReloadKey]);

    useEffect(() => {
        if (!isMaster || activeTab !== 'Clientes') return undefined;

        let mounted = true;
        const loadClients = async () => {
            setClientsLoading(true);
            setClientsError('');
            try {
                const snapshot = await getDocs(collection(db, CLIENTS_COLLECTION));
                if (!mounted) return;
                setClients(snapshot.docs
                    .map((docSnap) => normalizeClientRecord({ id: docSnap.id, ...(docSnap.data() || {}) }))
                    .sort((a, b) => a.name.localeCompare(b.name, 'es')));
            } catch (error) {
                if (mounted) setClientsError(error.message || 'No se pudo cargar la base de clientes.');
            } finally {
                if (mounted) setClientsLoading(false);
            }
        };

        loadClients();
        return () => {
            mounted = false;
        };
    }, [activeTab, clientReloadKey, isMaster]);

    useEffect(() => {
        if (!isMaster || activeTab !== 'Plan de cuentas') return undefined;

        let mounted = true;
        const loadAccounts = async () => {
            setChartLoading(true);
            setChartError('');
            try {
                const accounts = await loadChartOfAccounts();
                if (!mounted) return;
                setChartAccounts(accounts);
            } catch (error) {
                if (mounted) setChartError(error.message || 'No se pudo cargar el plan de cuentas.');
            } finally {
                if (mounted) setChartLoading(false);
            }
        };

        loadAccounts();
        return () => {
            mounted = false;
        };
    }, [activeTab, isMaster]);

    useEffect(() => {
        if (!isMaster || activeTab !== 'Plan de cuentas' || chartView !== 'ledger' || !ledgerMonth) return undefined;

        let mounted = true;
        const loadLedger = async () => {
            setLedgerLoading(true);
            setLedgerError('');
            try {
                const snapshot = await getDocs(query(
                    collection(db, ACCOUNTING_ENTRIES_COLLECTION),
                    where('month', '==', ledgerMonth)
                ));
                if (!mounted) return;
                setLedgerEntries(snapshot.docs
                    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
                    .sort((a, b) => String(getEntryDisplayDate(b)).localeCompare(String(getEntryDisplayDate(a)))));
            } catch (error) {
                if (mounted) {
                    setLedgerEntries([]);
                    setLedgerError(error.message || 'No se pudieron cargar los movimientos contables.');
                }
            } finally {
                if (mounted) setLedgerLoading(false);
            }
        };

        loadLedger();
        return () => {
            mounted = false;
        };
    }, [activeTab, chartView, isMaster, ledgerMonth, ledgerReloadKey]);

    const filteredClients = useMemo(() => {
        const searchKey = normalizeClientText(clientSearch);
        if (!searchKey) return clients;
        return clients.filter((client) => normalizeClientText([
            client.name,
            client.ruc,
            client.address,
            client.phone,
            client.email,
            client.code,
        ].join(' ')).includes(searchKey));
    }, [clientSearch, clients]);

    const chartTypes = useMemo(() => (
        [...new Set(chartAccounts.map((account) => account.type).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, 'es'))
    ), [chartAccounts]);

    const filteredChartAccounts = useMemo(() => {
        const searchKey = normalizeClientText(chartSearch);
        return chartAccounts
            .filter((account) => !chartTypeFilter || account.type === chartTypeFilter)
            .filter((account) => {
                if (!searchKey) return true;
                return normalizeClientText([
                    account.number,
                    account.name,
                    account.type,
                    account.detailType,
                ].join(' ')).includes(searchKey);
            })
            .sort((a, b) => String(a.number || '').localeCompare(String(b.number || ''), 'es', { numeric: true }));
    }, [chartAccounts, chartSearch, chartTypeFilter]);

    const chartStats = useMemo(() => {
        const posting = chartAccounts.filter((account) => account.isPosting).length;
        const bankAndCards = chartAccounts.filter((account) => [
            'Efectivo y equivalentes de efectivo',
            'Tarjeta de credito',
            'Tarjeta de crédito',
        ].includes(account.type)).length;
        const inventory = chartAccounts.filter((account) => account.number === '11060' || account.name?.toLowerCase().includes('inventario')).length;
        return { posting, bankAndCards, inventory };
    }, [chartAccounts]);

    const ledgerLines = useMemo(() => ledgerEntries.flatMap((entry) => (
        Array.isArray(entry.lines) ? entry.lines : []
    ).map((line, index) => ({
        ...line,
        rowKey: getAccountingLineKey(entry, line, index),
        entryId: entry.id,
        entryStatus: entry.status || '',
        sourceCollection: entry.sourceCollection || '',
        sourceDocId: entry.sourceDocId || '',
        sourceType: entry.sourceType || '',
        date: getEntryDisplayDate(entry),
        month: entry.month || '',
        branchId: entry.branchId || entry.branch || DEFAULT_BRANCH_ID,
        branchName: entry.branchName || branchName(entry.branchId || entry.branch || DEFAULT_BRANCH_ID),
        documentNumber: entry.documentNumber || '',
        partyName: entry.partyName || '',
        entryDescription: entry.description || '',
        totalDebit: Number(entry.totalDebit || 0),
        totalCredit: Number(entry.totalCredit || 0),
        difference: Number(entry.difference || 0),
    }))), [ledgerEntries]);

    const ledgerAccountOptions = useMemo(() => {
        const byCode = new Map();
        ledgerLines.forEach((line) => {
            const code = String(line.accountCode || '').trim();
            if (!code) return;
            if (!byCode.has(code)) {
                byCode.set(code, {
                    code,
                    name: line.accountName || code,
                });
            }
        });
        return [...byCode.values()].sort((a, b) => String(a.code).localeCompare(String(b.code), 'es', { numeric: true }));
    }, [ledgerLines]);

    const filteredLedgerLines = useMemo(() => {
        const searchKey = normalizeClientText(ledgerSearch);
        return ledgerLines
            .filter((line) => ledgerBranchFilter === 'all' || line.branchId === ledgerBranchFilter)
            .filter((line) => !ledgerAccountFilter || String(line.accountCode || '') === ledgerAccountFilter)
            .filter((line) => {
                if (ledgerQuickFilter === 'retentions') return isRetentionLine(line);
                if (ledgerQuickFilter === 'credit_cards') return isCreditCardLine(line);
                if (ledgerQuickFilter === 'bac') return isBacLine(line);
                if (ledgerQuickFilter === 'payable') return isPayableLine(line);
                return true;
            })
            .filter((line) => {
                if (!searchKey) return true;
                return normalizeClientText([
                    line.accountCode,
                    line.accountName,
                    line.description,
                    line.entryDescription,
                    line.partyName,
                    line.documentNumber,
                    line.sourceCollection,
                ].join(' ')).includes(searchKey);
            });
    }, [ledgerAccountFilter, ledgerBranchFilter, ledgerLines, ledgerQuickFilter, ledgerSearch]);

    const filteredLedgerEntryIds = useMemo(() => (
        new Set(filteredLedgerLines.map((line) => line.entryId).filter(Boolean))
    ), [filteredLedgerLines]);

    const filteredLedgerEntries = useMemo(() => ledgerEntries.filter((entry) => filteredLedgerEntryIds.has(entry.id)), [filteredLedgerEntryIds, ledgerEntries]);

    const ledgerTotals = useMemo(() => {
        const debit = filteredLedgerLines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
        const credit = filteredLedgerLines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
        const retentionIr = filteredLedgerLines
            .filter((line) => String(line.accountCode || '') === '21041')
            .reduce((sum, line) => sum + Number(line.credit || 0) - Number(line.debit || 0), 0);
        const retentionMunicipal = filteredLedgerLines
            .filter((line) => String(line.accountCode || '') === '21043')
            .reduce((sum, line) => sum + Number(line.credit || 0) - Number(line.debit || 0), 0);
        return {
            debit,
            credit,
            net: debit - credit,
            entries: filteredLedgerEntries.length,
            lines: filteredLedgerLines.length,
            retentionIr,
            retentionMunicipal,
        };
    }, [filteredLedgerEntries.length, filteredLedgerLines]);

    const resetUserForm = () => {
        setUserForm(createEmptyUserForm());
        setUsersMessage('');
        setUsersError('');
        setUsersListNotice('');
    };

    const toggleUserModule = (moduleId) => {
        setUserForm((current) => ({
            ...current,
            modules: {
                ...current.modules,
                [moduleId]: !current.modules?.[moduleId],
            },
            moduleModes: {
                ...current.moduleModes,
                [moduleId]: !current.modules?.[moduleId]
                    ? (current.moduleModes?.[moduleId] === MODULE_ACCESS_VIEW ? MODULE_ACCESS_VIEW : MODULE_ACCESS_EDIT)
                    : MODULE_ACCESS_NONE,
            },
        }));
    };

    const updateUserModuleMode = (moduleId, mode) => {
        setUserForm((current) => ({
            ...current,
            modules: {
                ...current.modules,
                [moduleId]: true,
            },
            moduleModes: {
                ...current.moduleModes,
                [moduleId]: mode,
            },
        }));
    };

    const toggleUserBranch = (branchId) => {
        setUserForm((current) => {
            const currentBranches = normalizeBranchAccess(current.branchAccess || [], [DEFAULT_BRANCH_ID]);
            const nextBranches = currentBranches.includes(branchId)
                ? currentBranches.filter((id) => id !== branchId)
                : [...currentBranches, branchId];
            const normalizedBranches = nextBranches.length ? nextBranches : [DEFAULT_BRANCH_ID];
            return {
                ...current,
                branchAccess: normalizedBranches,
                defaultBranchId: normalizedBranches.includes(current.defaultBranchId) ? current.defaultBranchId : normalizedBranches[0],
            };
        });
    };

    const editUser = (systemUser) => {
        setUserForm({
            email: normalizeUserEmail(systemUser.email),
            displayName: systemUser.displayName || '',
            password: '',
            active: systemUser.active !== false && systemUser.disabled !== true,
            modules: normalizeModuleAccess(systemUser.modules || {}),
            moduleModes: normalizeModuleModes(systemUser.modules || {}, systemUser.moduleModes || {}),
            branchAccess: normalizeBranchAccess(systemUser.branchAccess || systemUser.branches || systemUser.allowedBranches, [DEFAULT_BRANCH_ID]),
            defaultBranchId: systemUser.defaultBranchId || DEFAULT_BRANCH_ID,
        });
        setUsersMessage('');
        setUsersError('');
        setUsersListNotice('');
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
        setUsersListNotice('');

        try {
            const saveUser = httpsCallable(firebaseFunctions, 'adminCreateAppUser');
            const payload = {
                email,
                displayName: userForm.displayName.trim(),
                password: userForm.password.trim(),
                active: userForm.active,
                modules: normalizeModuleAccess(userForm.modules || {}),
                moduleModes: normalizeModuleModes(userForm.modules || {}, userForm.moduleModes || {}),
                branchAccess: normalizeBranchAccess(userForm.branchAccess || [], [DEFAULT_BRANCH_ID]),
                defaultBranchId: userForm.defaultBranchId || DEFAULT_BRANCH_ID,
            };
            const result = await saveUser(payload);
            const savedUser = normalizeListedUser(result.data?.user || {
                email,
                displayName: payload.displayName,
                active: payload.active,
                modules: payload.modules,
                moduleModes: payload.moduleModes,
                branchAccess: payload.branchAccess,
                defaultBranchId: payload.defaultBranchId,
                source: 'optimistic-save',
            });
            setSystemUsers((currentUsers) => mergeListedUsers(currentUsers, [savedUser]));
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

    const resetClientForm = () => {
        setClientForm(createEmptyClientForm());
        setClientsError('');
        setClientsMessage('');
    };

    const editClient = (client) => {
        setClientForm(createEmptyClientForm(normalizeClientRecord(client)));
        setClientsError('');
        setClientsMessage('');
    };

    const saveClient = async (event) => {
        event.preventDefault();
        if (!isMaster) return;

        const payload = buildClientPayload(clientForm, clientForm.source || 'configuraciones');
        if (!payload.name) {
            setClientsError('Ingresa el nombre o razon social del cliente.');
            return;
        }
        if (!payload.ruc) {
            setClientsError('Ingresa el RUC/RFC del cliente.');
            return;
        }
        if (!payload.address) {
            setClientsError('Ingresa la direccion fiscal del cliente.');
            return;
        }

        const existingByRuc = clients.find((client) => (
            client.code !== payload.code
            && payload.normalizedRuc
            && client.normalizedRuc === payload.normalizedRuc
        ));
        if (existingByRuc) {
            setClientsError(`Ya existe un cliente con ese RUC/RFC: ${existingByRuc.name}.`);
            return;
        }

        const existingByName = clients.find((client) => (
            client.code !== payload.code
            && normalizeClientText(client.name) === payload.normalizedName
        ));
        if (existingByName && !window.confirm(`Ya existe un cliente con nombre similar: ${existingByName.name}. Deseas guardar este registro de todos modos?`)) {
            return;
        }

        setSavingClient(true);
        setClientsError('');
        setClientsMessage('');
        try {
            await setDoc(doc(db, CLIENTS_COLLECTION, payload.code), payload, { merge: true });
            setClientsMessage(`Cliente ${payload.name} guardado correctamente.`);
            setClientForm(createEmptyClientForm());
            setClientReloadKey((key) => key + 1);
        } catch (error) {
            setClientsError(error.message || 'No se pudo guardar el cliente.');
        } finally {
            setSavingClient(false);
        }
    };

    const deleteClient = async (client) => {
        if (!isMaster || !client?.code) return;
        if (!window.confirm(`Eliminar "${client.name}" de la base de clientes? No borra facturas ni recibos historicos.`)) return;
        setClientsError('');
        setClientsMessage('');
        try {
            await deleteDoc(doc(db, CLIENTS_COLLECTION, client.code));
            setClients((current) => current.filter((item) => item.code !== client.code));
            setClientsMessage(`Cliente ${client.name} eliminado del catalogo.`);
            if (clientForm.code === client.code) setClientForm(createEmptyClientForm());
        } catch (error) {
            setClientsError(error.message || 'No se pudo eliminar el cliente.');
        }
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

                            <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <div>
                                    <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Sucursales permitidas</div>
                                    <p className="mt-1 text-xs font-semibold text-slate-400">Los usuarios con una sola sucursal trabajaran siempre en esa sucursal. Administracion puede elegir ambas.</p>
                                </div>
                                <div className="grid gap-2 sm:grid-cols-2">
                                    {BRANCHES.map((branch) => {
                                        const checked = normalizeBranchAccess(userForm.branchAccess || [], [DEFAULT_BRANCH_ID]).includes(branch.id);
                                        return (
                                            <label
                                                key={branch.id}
                                                className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2 transition ${
                                                    checked ? 'border-[#e30613]/30 bg-white text-slate-950' : 'border-slate-200 bg-slate-100 text-slate-500'
                                                }`}
                                            >
                                                <span>
                                                    <span className="block text-sm font-black">{branch.shortName}</span>
                                                    <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Serie {branch.invoiceSeries}</span>
                                                </span>
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={() => toggleUserBranch(branch.id)}
                                                    className="h-4 w-4 accent-[#e30613]"
                                                />
                                            </label>
                                        );
                                    })}
                                </div>
                                <Field label="Sucursal por defecto">
                                    <select
                                        className={inputClass}
                                        value={userForm.defaultBranchId || DEFAULT_BRANCH_ID}
                                        onChange={(event) => setUserForm((current) => ({ ...current, defaultBranchId: event.target.value }))}
                                    >
                                        {normalizeBranchAccess(userForm.branchAccess || [], [DEFAULT_BRANCH_ID]).map((branchId) => (
                                            <option key={branchId} value={branchId}>{branchName(branchId)}</option>
                                        ))}
                                    </select>
                                </Field>
                            </div>

                            <div className="space-y-2">
                                <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Modulos permitidos y permisos</div>
                                <div className="grid gap-2">
                                    {ACCESS_MODULES.map((module) => {
                                        const enabled = userForm.modules?.[module.id] === true;
                                        const mode = userForm.moduleModes?.[module.id] === MODULE_ACCESS_VIEW ? MODULE_ACCESS_VIEW : MODULE_ACCESS_EDIT;

                                        return (
                                            <label
                                                key={module.id}
                                                className={`flex cursor-pointer flex-col gap-3 rounded-2xl border px-4 py-3 transition sm:flex-row sm:items-center sm:justify-between ${
                                                    enabled
                                                        ? 'border-[#e30613]/30 bg-[#fff1f2]'
                                                        : 'border-slate-200 bg-white hover:bg-slate-50'
                                                }`}
                                            >
                                                <span className="flex items-start gap-3">
                                                    <input
                                                        type="checkbox"
                                                        checked={enabled}
                                                        onChange={() => toggleUserModule(module.id)}
                                                        className="mt-1 h-4 w-4 accent-[#e30613]"
                                                    />
                                                    <span>
                                                        <span className="block text-sm font-black text-slate-900">{module.label}</span>
                                                        <span className="block text-xs font-semibold text-slate-500">{module.description}</span>
                                                    </span>
                                                </span>
                                                <select
                                                    value={mode}
                                                    disabled={!enabled}
                                                    onClick={(event) => event.stopPropagation()}
                                                    onChange={(event) => updateUserModuleMode(module.id, event.target.value)}
                                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-slate-700 outline-none transition focus:border-[#e30613] focus:ring-2 focus:ring-[#e30613]/15 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 sm:w-36"
                                                >
                                                    <option value={MODULE_ACCESS_EDIT}>Editar</option>
                                                    <option value={MODULE_ACCESS_VIEW}>Solo ver</option>
                                                </select>
                                            </label>
                                        );
                                    })}
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
                            {usersListNotice && !usersLoading && (
                                <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
                                    {usersListNotice}
                                </div>
                            )}

                            {usersError && !usersLoading && systemUsers.length === 0 && (
                                <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                                    {usersError}
                                </div>
                            )}

                            {usersLoading && (
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm font-bold text-slate-500">
                                    Cargando usuarios...
                                </div>
                            )}

                            {!usersLoading && systemUsers.length === 0 && (
                                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">
                                    No hay usuarios listados todavia. Crea el primer usuario operativo o usa Actualizar lista.
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
                                                                {module.label} / {getModuleModeLabel(systemUser.moduleModes?.[module.id])}
                                                            </span>
                                                        )) : (
                                                            <span className="text-xs font-bold text-rose-500">Sin modulos</span>
                                                        )}
                                                        {(systemUser.branchAccess || []).map((branchId) => (
                                                            <span key={`${email}-${branchId}`} className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-amber-700">
                                                                {branchName(branchId)}
                                                            </span>
                                                        ))}
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

            {activeTab === 'Clientes' && isMaster && (
                <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
                    <Card className="overflow-hidden">
                        <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#e30613]">Base formal</div>
                            <h2 className="mt-1 text-lg font-black text-slate-950">{clientForm.code ? 'Editar cliente' : 'Nuevo cliente'}</h2>
                            <p className="mt-1 text-xs font-semibold text-slate-500">Este catalogo alimenta cierres, recibos y facturas membretadas.</p>
                        </div>
                        <form className="space-y-4 p-5" onSubmit={saveClient}>
                            <Field label="RUC / RFC">
                                <input
                                    className={inputClass}
                                    value={clientForm.ruc}
                                    onChange={(event) => setClientForm((current) => ({ ...current, ruc: event.target.value }))}
                                    placeholder="Ej. J0310000000000"
                                    required
                                />
                            </Field>
                            <Field label="Nombre / razon social">
                                <input
                                    className={inputClass}
                                    value={clientForm.name}
                                    onChange={(event) => setClientForm((current) => ({ ...current, name: event.target.value }))}
                                    placeholder="Nombre legal del cliente"
                                    required
                                />
                            </Field>
                            <Field label="Direccion fiscal">
                                <textarea
                                    className={`${inputClass} min-h-24 resize-y`}
                                    value={clientForm.address}
                                    onChange={(event) => setClientForm((current) => ({ ...current, address: event.target.value }))}
                                    placeholder="Direccion completa"
                                    required
                                />
                            </Field>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="Telefono">
                                    <input className={inputClass} value={clientForm.phone} onChange={(event) => setClientForm((current) => ({ ...current, phone: event.target.value }))} />
                                </Field>
                                <Field label="Correo">
                                    <input className={inputClass} type="email" value={clientForm.email} onChange={(event) => setClientForm((current) => ({ ...current, email: event.target.value }))} />
                                </Field>
                            </div>
                            <Field label="Notas internas">
                                <textarea className={`${inputClass} min-h-20 resize-y`} value={clientForm.notes} onChange={(event) => setClientForm((current) => ({ ...current, notes: event.target.value }))} />
                            </Field>
                            <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                <div>
                                    <div className="text-sm font-black text-slate-900">Cliente activo</div>
                                    <div className="text-xs font-semibold text-slate-400">Si se desactiva, queda en historial pero no deberia usarse para nuevos registros.</div>
                                </div>
                                <input
                                    type="checkbox"
                                    checked={clientForm.active !== false}
                                    onChange={(event) => setClientForm((current) => ({ ...current, active: event.target.checked }))}
                                    className="h-5 w-5 accent-[#e30613]"
                                />
                            </label>

                            {clientsError && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{clientsError}</div>}
                            {clientsMessage && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{clientsMessage}</div>}

                            <div className="flex flex-col gap-2 sm:flex-row">
                                <button type="submit" disabled={savingClient} className="inline-flex flex-1 items-center justify-center rounded-xl bg-[#e30613] px-4 py-3 text-sm font-black text-white shadow-lg shadow-red-900/15 transition hover:bg-[#9f111a] disabled:cursor-not-allowed disabled:opacity-60">
                                    {savingClient ? 'Guardando...' : 'Guardar cliente'}
                                </button>
                                <button type="button" onClick={resetClientForm} className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50">
                                    Nuevo
                                </button>
                            </div>
                        </form>
                    </Card>

                    <Card className="overflow-hidden">
                        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 md:flex-row md:items-center md:justify-between">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Catalogo</div>
                                <h2 className="mt-1 text-lg font-black text-slate-950">Clientes guardados</h2>
                            </div>
                            <button type="button" onClick={() => setClientReloadKey((key) => key + 1)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-slate-700 transition hover:bg-slate-100">
                                Actualizar
                            </button>
                        </div>
                        <div className="space-y-4 p-5">
                            <input
                                className={inputClass}
                                value={clientSearch}
                                onChange={(event) => setClientSearch(event.target.value)}
                                placeholder="Buscar por nombre, RUC, direccion o codigo..."
                            />
                            {clientsLoading && <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm font-bold text-slate-500">Cargando clientes...</div>}
                            {!clientsLoading && filteredClients.length === 0 && (
                                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">
                                    No hay clientes para mostrar.
                                </div>
                            )}
                            {!clientsLoading && filteredClients.length > 0 && (
                                <div className="overflow-hidden rounded-2xl border border-slate-200">
                                    <div className="hidden grid-cols-[1fr_0.7fr_1fr_120px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 md:grid">
                                        <span>Cliente</span>
                                        <span>RUC</span>
                                        <span>Direccion</span>
                                        <span className="text-right">Accion</span>
                                    </div>
                                    <div className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto">
                                        {filteredClients.map((client) => (
                                            <div key={client.code || client.id} className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_0.7fr_1fr_120px] md:items-center">
                                                <div>
                                                    <div className="text-sm font-black text-slate-950">{client.name || '-'}</div>
                                                    <div className="mt-0.5 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{client.code}</div>
                                                </div>
                                                <div className="text-sm font-bold text-slate-600">{client.ruc || '-'}</div>
                                                <div className="text-sm font-bold text-slate-500">{client.address || '-'}</div>
                                                <div className="flex gap-2 md:justify-end">
                                                    <button type="button" onClick={() => editClient(client)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-700 transition hover:bg-slate-50">Editar</button>
                                                    <button type="button" onClick={() => deleteClient(client)} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-rose-700 transition hover:bg-rose-100">Eliminar</button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </Card>
                </div>
            )}

            {activeTab === 'Plan de cuentas' && isMaster && (
                <div className="space-y-5">
                    <Card className="p-2">
                        <div className="grid gap-2 md:grid-cols-2">
                            {[
                                { id: 'catalog', label: 'Catalogo de cuentas', help: 'Cuentas importadas desde QuickBooks' },
                                { id: 'ledger', label: 'Movimientos contables', help: 'Asientos, retenciones, BAC y tarjetas' },
                            ].map((view) => (
                                <button
                                    key={view.id}
                                    type="button"
                                    onClick={() => setChartView(view.id)}
                                    className={`rounded-2xl px-4 py-3 text-left transition ${
                                        chartView === view.id
                                            ? 'bg-slate-950 text-white shadow-lg shadow-slate-950/10'
                                            : 'bg-white text-slate-700 hover:bg-slate-50'
                                    }`}
                                >
                                    <span className="block text-xs font-black uppercase tracking-[0.18em]">{view.label}</span>
                                    <span className={`mt-1 block text-xs font-semibold ${chartView === view.id ? 'text-white/65' : 'text-slate-400'}`}>{view.help}</span>
                                </button>
                            ))}
                        </div>
                    </Card>

                    {chartView === 'catalog' && (
                        <>
                    <Card className="overflow-hidden">
                        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 md:flex-row md:items-center md:justify-between">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#e30613]">Contabilidad real</div>
                                <h2 className="mt-1 text-lg font-black text-slate-950">Plan de cuentas</h2>
                                <p className="mt-1 text-xs font-semibold text-slate-500">
                                    Base importada desde QuickBooks. Las categorias y subcategorias quedan como informacion fiscal interna; esta cuenta contable es la base ERP.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={async () => {
                                    setChartLoading(true);
                                    setChartError('');
                                    try {
                                        const accounts = await loadChartOfAccounts({ force: true });
                                        setChartAccounts(accounts);
                                    } catch (error) {
                                        setChartError(error.message || 'No se pudo actualizar el plan de cuentas.');
                                    } finally {
                                        setChartLoading(false);
                                    }
                                }}
                                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-slate-700 transition hover:bg-slate-100"
                            >
                                Actualizar
                            </button>
                        </div>
                        <div className="grid gap-3 p-5 md:grid-cols-4">
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Cuentas</div>
                                <div className="mt-1 font-mono text-2xl font-black text-slate-950">{chartAccounts.length}</div>
                            </div>
                            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-600">Posteables</div>
                                <div className="mt-1 font-mono text-2xl font-black text-emerald-700">{chartStats.posting}</div>
                            </div>
                            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
                                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-sky-600">Bancos / tarjetas</div>
                                <div className="mt-1 font-mono text-2xl font-black text-sky-700">{chartStats.bankAndCards}</div>
                            </div>
                            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-600">Inventario</div>
                                <div className="mt-1 font-mono text-2xl font-black text-amber-700">{chartStats.inventory}</div>
                            </div>
                        </div>
                    </Card>

                    <Card className="overflow-hidden">
                        <div className="grid gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 md:grid-cols-[1fr_260px]">
                            <input
                                className={inputClass}
                                value={chartSearch}
                                onChange={(event) => setChartSearch(event.target.value)}
                                placeholder="Buscar por codigo, cuenta, tipo o detalle..."
                            />
                            <select
                                className={inputClass}
                                value={chartTypeFilter}
                                onChange={(event) => setChartTypeFilter(event.target.value)}
                            >
                                <option value="">Todos los tipos</option>
                                {chartTypes.map((type) => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </select>
                        </div>
                        {chartError && <div className="m-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{chartError}</div>}
                        {chartLoading ? (
                            <div className="p-8 text-center text-sm font-bold text-slate-500">Cargando plan de cuentas...</div>
                        ) : filteredChartAccounts.length === 0 ? (
                            <div className="p-8 text-center text-sm font-bold text-slate-500">No hay cuentas para mostrar.</div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-slate-100 text-sm">
                                    <thead className="bg-white">
                                        <tr className="text-left text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                                            <th className="px-5 py-3">Codigo</th>
                                            <th className="px-5 py-3">Cuenta</th>
                                            <th className="px-5 py-3">Tipo</th>
                                            <th className="px-5 py-3">Detalle</th>
                                            <th className="px-5 py-3 text-right">Estado</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 bg-white">
                                        {filteredChartAccounts.slice(0, 240).map((account) => (
                                            <tr key={account.id} className="transition hover:bg-slate-50">
                                                <td className="px-5 py-3 font-mono font-black text-slate-950">{account.number || '-'}</td>
                                                <td className="px-5 py-3 font-bold text-slate-800">{account.name}</td>
                                                <td className="px-5 py-3 font-semibold text-slate-500">{account.type || '-'}</td>
                                                <td className="px-5 py-3 font-semibold text-slate-500">{account.detailType || '-'}</td>
                                                <td className="px-5 py-3 text-right">
                                                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
                                                        account.isPosting ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                                                    }`}>
                                                        {account.isPosting ? 'Activa' : 'Bloqueada'}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {filteredChartAccounts.length > 240 && (
                                    <div className="border-t border-slate-100 px-5 py-3 text-xs font-bold text-slate-400">
                                        Mostrando 240 de {filteredChartAccounts.length}. Usa el buscador para afinar.
                                    </div>
                                )}
                            </div>
                        )}
                    </Card>
                        </>
                    )}

                    {chartView === 'ledger' && (
                        <div className="space-y-5">
                            <Card className="overflow-hidden">
                                <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 md:flex-row md:items-center md:justify-between">
                                    <div>
                                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#e30613]">Libro auxiliar</div>
                                        <h2 className="mt-1 text-lg font-black text-slate-950">Movimientos del plan de cuentas</h2>
                                        <p className="mt-1 text-xs font-semibold text-slate-500">
                                            Consulta los asientos generados por compras, gastos, abonos y retenciones sin entrar documento por documento.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setLedgerReloadKey((current) => current + 1)}
                                        className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-slate-700 transition hover:bg-slate-100"
                                    >
                                        Actualizar
                                    </button>
                                </div>

                                <div className="grid gap-3 p-5 lg:grid-cols-[170px_180px_1fr_240px]">
                                    <Field label="Mes">
                                        <input
                                            type="month"
                                            className={inputClass}
                                            value={ledgerMonth}
                                            onChange={(event) => setLedgerMonth(event.target.value)}
                                        />
                                    </Field>
                                    <Field label="Sucursal">
                                        <select
                                            className={inputClass}
                                            value={ledgerBranchFilter}
                                            onChange={(event) => setLedgerBranchFilter(event.target.value)}
                                        >
                                            <option value="all">Todas</option>
                                            {BRANCHES.map((branch) => (
                                                <option key={branch.id} value={branch.id}>{branch.name}</option>
                                            ))}
                                        </select>
                                    </Field>
                                    <Field label="Buscar">
                                        <input
                                            className={inputClass}
                                            value={ledgerSearch}
                                            onChange={(event) => setLedgerSearch(event.target.value)}
                                            placeholder="Proveedor, documento, cuenta, descripcion..."
                                        />
                                    </Field>
                                    <Field label="Cuenta">
                                        <select
                                            className={inputClass}
                                            value={ledgerAccountFilter}
                                            onChange={(event) => setLedgerAccountFilter(event.target.value)}
                                        >
                                            <option value="">Todas las cuentas</option>
                                            {ledgerAccountOptions.map((account) => (
                                                <option key={account.code} value={account.code}>
                                                    {account.code} - {account.name}
                                                </option>
                                            ))}
                                        </select>
                                    </Field>
                                </div>

                                <div className="flex flex-wrap gap-2 px-5 pb-5">
                                    {LEDGER_QUICK_FILTERS.map((filter) => (
                                        <button
                                            key={filter.id}
                                            type="button"
                                            onClick={() => setLedgerQuickFilter(filter.id)}
                                            className={`rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-[0.14em] transition ${
                                                ledgerQuickFilter === filter.id
                                                    ? 'bg-slate-950 text-white shadow-lg shadow-slate-950/10'
                                                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                                            }`}
                                        >
                                            {filter.label}
                                        </button>
                                    ))}
                                </div>
                            </Card>

                            <div className="grid gap-3 md:grid-cols-4">
                                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Asientos</div>
                                    <div className="mt-1 font-mono text-2xl font-black text-slate-950">{ledgerTotals.entries}</div>
                                    <div className="mt-1 text-xs font-bold text-slate-400">{ledgerTotals.lines} linea(s)</div>
                                </div>
                                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-600">Debe</div>
                                    <div className="mt-1 font-mono text-2xl font-black text-emerald-700">{fmt(ledgerTotals.debit)}</div>
                                </div>
                                <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
                                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-sky-600">Haber</div>
                                    <div className="mt-1 font-mono text-2xl font-black text-sky-700">{fmt(ledgerTotals.credit)}</div>
                                </div>
                                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-600">Retenciones</div>
                                    <div className="mt-1 font-mono text-lg font-black text-amber-700">IR {fmt(Math.abs(ledgerTotals.retentionIr))}</div>
                                    <div className="text-xs font-black text-amber-700">Municipal {fmt(Math.abs(ledgerTotals.retentionMunicipal))}</div>
                                </div>
                            </div>

                            <Card className="overflow-hidden">
                                <div className="flex flex-col gap-2 border-b border-slate-200 bg-white px-5 py-4 md:flex-row md:items-center md:justify-between">
                                    <div>
                                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Detalle auditado</div>
                                        <h3 className="mt-1 text-base font-black text-slate-950">Transacciones por cuenta contable</h3>
                                    </div>
                                    <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-slate-500">
                                        {filteredLedgerLines.length} movimiento(s)
                                    </span>
                                </div>

                                {ledgerError && (
                                    <div className="m-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{ledgerError}</div>
                                )}

                                {ledgerLoading ? (
                                    <div className="p-8 text-center text-sm font-bold text-slate-500">Cargando movimientos contables...</div>
                                ) : filteredLedgerLines.length === 0 ? (
                                    <div className="p-8 text-center text-sm font-bold text-slate-500">
                                        No hay movimientos para estos filtros. Los nuevos registros se iran viendo aqui conforme generen asiento contable.
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full divide-y divide-slate-100 text-sm">
                                            <thead className="bg-slate-50">
                                                <tr className="text-left text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                                                    <th className="px-5 py-3">Fecha</th>
                                                    <th className="px-5 py-3">Cuenta</th>
                                                    <th className="px-5 py-3">Movimiento</th>
                                                    <th className="px-5 py-3 text-right">Debe</th>
                                                    <th className="px-5 py-3 text-right">Haber</th>
                                                    <th className="px-5 py-3 text-right">Detalle</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 bg-white">
                                                {filteredLedgerLines.slice(0, 500).map((line) => {
                                                    const entry = ledgerEntries.find((item) => item.id === line.entryId) || {};
                                                    const isExpanded = expandedLedgerEntryId === line.entryId;
                                                    return (
                                                        <React.Fragment key={line.rowKey}>
                                                            <tr className="transition hover:bg-slate-50">
                                                                <td className="px-5 py-3 font-mono font-black text-slate-800">{line.date || '-'}</td>
                                                                <td className="px-5 py-3">
                                                                    <div className="font-mono text-sm font-black text-slate-950">{line.accountCode || '-'}</div>
                                                                    <div className="mt-0.5 text-xs font-bold text-slate-500">{line.accountName || '-'}</div>
                                                                </td>
                                                                <td className="px-5 py-3">
                                                                    <div className="font-black text-slate-900">{line.description || line.entryDescription || '-'}</div>
                                                                    <div className="mt-0.5 text-xs font-semibold text-slate-400">
                                                                        {line.partyName || 'Sin tercero'} {line.documentNumber ? `- Doc ${line.documentNumber}` : ''}
                                                                    </div>
                                                                    <div className="mt-1 flex flex-wrap gap-1">
                                                                        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-sky-700">{line.branchName}</span>
                                                                        {line.sourceCollection && (
                                                                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-slate-500">{line.sourceCollection}</span>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                                <td className="px-5 py-3 text-right font-mono font-black text-emerald-700">{Number(line.debit || 0) ? fmt(line.debit) : '-'}</td>
                                                                <td className="px-5 py-3 text-right font-mono font-black text-sky-700">{Number(line.credit || 0) ? fmt(line.credit) : '-'}</td>
                                                                <td className="px-5 py-3 text-right">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setExpandedLedgerEntryId(isExpanded ? '' : line.entryId)}
                                                                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-700 transition hover:bg-slate-50"
                                                                    >
                                                                        {isExpanded ? 'Ocultar' : 'Ver asiento'}
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                            {isExpanded && (
                                                                <tr className="bg-slate-50">
                                                                    <td colSpan={6} className="px-5 py-4">
                                                                        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-4">
                                                                            <div>
                                                                                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Asiento</div>
                                                                                <div className="mt-1 break-all font-mono text-xs font-black text-slate-800">{line.entryId}</div>
                                                                            </div>
                                                                            <div>
                                                                                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Origen</div>
                                                                                <div className="mt-1 text-xs font-black text-slate-800">{entry.sourceCollection || '-'} / {entry.sourceDocId || '-'}</div>
                                                                            </div>
                                                                            <div>
                                                                                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Totales asiento</div>
                                                                                <div className="mt-1 text-xs font-black text-slate-800">Debe {fmt(entry.totalDebit || 0)} - Haber {fmt(entry.totalCredit || 0)}</div>
                                                                            </div>
                                                                            <div>
                                                                                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Estado</div>
                                                                                <div className="mt-1 text-xs font-black text-slate-800">{entry.status || 'posted'}</div>
                                                                            </div>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            )}
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                        {filteredLedgerLines.length > 500 && (
                                            <div className="border-t border-slate-100 px-5 py-3 text-xs font-bold text-slate-400">
                                                Mostrando 500 de {filteredLedgerLines.length}. Usa filtros para revisar con mas precision.
                                            </div>
                                        )}
                                    </div>
                                )}
                            </Card>
                        </div>
                    )}
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
