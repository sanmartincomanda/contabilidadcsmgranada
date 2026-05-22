import React, { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import { db } from '../firebase';
import { 
    collection, query, where, getDocs, doc, 
    updateDoc, writeBatch, addDoc, runTransaction, 
} from 'firebase/firestore';
// Asegúrate de que fmt esté definido en tu constants.js
import { fmt } from '../constants'; 

// Define las columnas que la app NECESITA para hacer el match
const REQUIRED_FIELDS = [
    { key: 'date', label: 'Fecha de Transacción (YYYY-MM-DD)' },
    { key: 'amount', label: 'Monto (Débito/Crédito)' },
    { key: 'concept', label: 'Concepto/Referencia' },
];

export function BankReconciliation() {
    const [file, setFile] = useState(null);
    const [headers, setHeaders] = useState([]);
    const [mapping, setMapping] = useState({});
    const [previewData, setPreviewData] = useState([]);
    const [isMapped, setIsMapped] = useState(false);
    
    const [statementData, setStatementData] = useState(null); 
    const [pendingBankTxs, setPendingBankTxs] = useState([]);
    const [pendingAppTxs, setPendingAppTxs] = useState([]);
    const [loading, setLoading] = useState(true); 

    // Estado para la conciliación Muchos a Uno (M:1)
    const [selectedBankTxIds, setSelectedBankTxIds] = useState([]); 

    // ESTADOS PARA FILTRADO
    const [bankFilter, setBankFilter] = useState('ALL'); 
    const [appFilter, setAppFilter] = useState('ALL');


    // ----------------------------------------------------------------------
    // I. LÓGICA DE ID CONSECUTIVO Y CARGA INICIAL
    // ----------------------------------------------------------------------

    const getNextReconciliationId = async () => {
        const counterRef = doc(db, "counters", "reconciliationId");
        
        try {
            const resultId = await runTransaction(db, async (transaction) => {
                const counterDoc = await transaction.get(counterRef);
    
                let nextCount;
                if (!counterDoc.exists()) {
                    nextCount = 1;
                    transaction.set(counterRef, { current: nextCount });
                } else {
                    const currentCount = counterDoc.data().current;
                    nextCount = currentCount + 1;
                    transaction.update(counterRef, { current: nextCount });
                }
                return `C-${String(nextCount).padStart(3, '0')}`;
            });
            return resultId;
        } catch (error) {
            console.warn("No se pudo obtener el ID consecutivo. Usando ID temporal.", error);
            return `C-TEMP-${Date.now()}`;
        }
    };

    const fetchPendingTransactions = async (statement) => {
        // 1. Transacciones del banco aún no conciliadas
        const bankTxs = statement.transactions.filter(tx => !tx.is_conciled);
        setPendingBankTxs(bankTxs);
        
        // 2. Transacciones de la App aún no conciliadas 
        const qIngresos = query(collection(db, 'ingresos'), where('is_conciled', '==', false));
        const qGastos = query(collection(db, 'gastos'), where('is_conciled', '==', false));

        const [snapshotIngresos, snapshotGastos] = await Promise.all([getDocs(qIngresos), getDocs(qGastos)]);
        
        const appTransactions = [
            ...snapshotIngresos.docs.map(doc => ({ id: doc.id, collection: 'ingresos', ...doc.data(), 
                // Asegura formato de fecha (YYYY-MM-DD)
                dateStr: doc.data().date?.toDate ? doc.data().date.toDate().toISOString().substring(0, 10) : doc.data().date,
            })),
            ...snapshotGastos.docs.map(doc => ({ id: doc.id, collection: 'gastos', ...doc.data(), 
                dateStr: doc.data().date?.toDate ? doc.data().date.toDate().toISOString().substring(0, 10) : doc.data().date,
            })),
        ];
        // Doble filtro de seguridad (solo por si acaso)
        setPendingAppTxs(appTransactions.filter(tx => !tx.is_conciled));
    };


    useEffect(() => {
        let isMounted = true;
        const loadPending = async () => {
            if (isMounted) setLoading(true);

            try {
                // Intenta cargar el estado de conciliación no finalizado
                const q = query(collection(db, 'bank_statements'), where('is_finalized', '==', false));
                const snapshot = await getDocs(q);

                if (!isMounted) return;

                if (!snapshot.empty) {
                    const statement = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
                    
                    setStatementData(statement);
                    setMapping(statement.mapping);
                    setIsMapped(true);
                    
                    await fetchPendingTransactions(statement);

                }
            } catch (error) {
                console.error("Error crítico al cargar estado pendiente. Verifique las Reglas de Firebase:", error);
            } finally {
                if (isMounted) setLoading(false); 
            }
        };

        loadPending();
        return () => { isMounted = false; };
    }, []);


    // ----------------------------------------------------------------------
    // II. GESTIÓN DEL ARCHIVO Y AUTO-CONCILIACIÓN
    // ----------------------------------------------------------------------

    const handleFileChange = (e) => {
        if (statementData) {
            alert("Ya existe una conciliación pendiente. Finalízala primero.");
            e.target.value = null; 
            return;
        }

        const selectedFile = e.target.files[0];
        if (!selectedFile) return;

        setFile(selectedFile);
        setIsMapped(false);
        setStatementData(null); 

        Papa.parse(selectedFile, {
            header: true,
            preview: 10, 
            complete: (results) => {
                const fileHeaders = results.meta.fields || [];
                setHeaders(fileHeaders);
                setPreviewData(results.data);

                const initialMapping = {};
                REQUIRED_FIELDS.forEach(field => {
                    initialMapping[field.key] = fileHeaders.includes(field.key) ? field.key : '';
                });
                setMapping(initialMapping);
            },
            error: (error) => {
                alert("Error al leer el archivo: " + error.message);
                setFile(null);
            }
        });
    };
    
    const saveAndAutoReconcile = async () => {
        setLoading(true);
        
        try {
            // 1. Leer archivo completo y mapear
            const fullResults = await new Promise((resolve, reject) => {
                Papa.parse(file, { header: true, skipEmptyLines: true, complete: resolve, error: reject });
            });
            
            let currentBankData = fullResults.data
                .map((bankTx, index) => {
                    // Limpieza y estandarización de datos bancarios
                    const txDate = bankTx[mapping.date]?.trim();
                    const txAmountRaw = parseFloat(bankTx[mapping.amount]?.replace(/[^0-9.-]+/g,"").replace(',', '.') || 0);
                    const txConcept = bankTx[mapping.concept]?.trim();
                    
                    return {
                        id: `bank-${index}-${Date.now() + index}`, 
                        date: txDate,
                        amount: txAmountRaw,
                        concept: txConcept,
                        is_conciled: false, 
                        source_data: bankTx, 
                    };
                })
                .filter(tx => tx.amount !== 0); 

            // 2. Obtener pendientes de la App y preparar batch
            await fetchPendingTransactions({transactions: []}); 
            let appTransactions = [...pendingAppTxs]; // Copia mutable

            let matchedCount = 0;
            const batchApp = writeBatch(db);

            // 3. Conciliación automática (Match Exacto)
            currentBankData.forEach(bankTx => {
                if (bankTx.is_conciled) return;

                const txType = bankTx.amount > 0 ? 'ingresos' : 'gastos';
                const txAmountAbs = Math.abs(bankTx.amount);

                const matchedAppTx = appTransactions.find(appTx => {
                    return (
                        appTx.collection === txType &&
                        appTx.amount === txAmountAbs &&
                        appTx.dateStr === bankTx.date &&
                        !appTx.is_conciled
                    );
                });

                if (matchedAppTx) {
                    bankTx.is_conciled = true;
                    bankTx.app_id = matchedAppTx.id;

                    const docRef = doc(db, matchedAppTx.collection, matchedAppTx.id);
                    batchApp.update(docRef, { is_conciled: true, conciled_date: new Date(), bank_concept: bankTx.concept });
                    matchedCount++;
                    
                    appTransactions = appTransactions.filter(t => t.id !== matchedAppTx.id);
                }
            });
            
            // 4. Guardar Estado de Conciliación
            const newReconciliationId = await getNextReconciliationId();
            
            const newStatement = {
                reconciliationId: newReconciliationId,
                fileName: file.name,
                uploadDate: new Date(),
                mapping: mapping,
                transactions: currentBankData,
                is_finalized: false,
            };
            const docRef = await addDoc(collection(db, 'bank_statements'), newStatement);
            await batchApp.commit(); 
            
            // 5. Actualizar estados
            setStatementData({ id: docRef.id, ...newStatement });
            setPendingBankTxs(currentBankData.filter(tx => !tx.is_conciled));
            setPendingAppTxs(appTransactions); 
            setFile(null); 
            setIsMapped(true);
            
            alert(`Conciliación ${newReconciliationId} iniciada. ${matchedCount} transacciones conciliadas automáticamente.`);

        } catch (error) {
            console.error("Error al guardar y conciliar automáticamente:", error);
            alert("❌ Error en la conciliación automática. Verifique la consola (F12) y las Reglas de Firebase.");
        } finally {
            setLoading(false);
        }
    };


    // ----------------------------------------------------------------------
    // III. LÓGICA DE FILTRADO (USEMEMO)
    // ----------------------------------------------------------------------

    const filteredBankTxs = useMemo(() => {
        return pendingBankTxs.filter(tx => {
            if (bankFilter === 'INGRESOS') return tx.amount > 0;
            if (bankFilter === 'GASTOS') return tx.amount < 0;
            return true; // ALL
        });
    }, [pendingBankTxs, bankFilter]);

    const filteredAppTxs = useMemo(() => {
        return pendingAppTxs.filter(tx => {
            if (appFilter === 'INGRESOS') return tx.collection === 'ingresos';
            if (appFilter === 'GASTOS') return tx.collection === 'gastos';
            return true; // ALL
        });
    }, [pendingAppTxs, appFilter]);


    // ----------------------------------------------------------------------
    // IV. ACCIONES MANUALES (1:1, M:1, EXCLUIR, FINALIZAR)
    // ----------------------------------------------------------------------

    const handleBankTxSelection = (id) => {
        setSelectedBankTxIds(prev => 
            prev.includes(id) 
                ? prev.filter(txId => txId !== id) 
                : [...prev, id]
        );
    };

    const handleMultiMatch = async (appTxId, collectionName) => {
        const bankTxIds = selectedBankTxIds;
        if (bankTxIds.length === 0) {
            alert("Selecciona al menos una transacción bancaria para conciliar.");
            return;
        }
        if (!window.confirm(`¿Confirmas la conciliación de ${bankTxIds.length} transacciones bancarias con este documento de la App?`)) return;
        setLoading(true);

        try {
            const batch = writeBatch(db);
            
            // 1. Marcar la transacción de la App como conciliada
            const appDocRef = doc(db, collectionName, appTxId);
            batch.update(appDocRef, { 
                is_conciled: true, 
                conciled_date: new Date(),
                bank_concept: `Multi-Match (${bankTxIds.length} Txs)`,
            });
            
            // 2. Marcar las transacciones del Banco como conciliadas y vincularlas
            const statementDocRef = doc(db, 'bank_statements', statementData.id);
            const updatedBankTxs = statementData.transactions.map(tx => {
                if (bankTxIds.includes(tx.id)) {
                    return { ...tx, is_conciled: true, app_id: appTxId, multi_match: true };
                }
                return tx;
            });
            batch.update(statementDocRef, { transactions: updatedBankTxs });
            await batch.commit();

            // 3. Actualizar la UI
            setStatementData(prev => ({ ...prev, transactions: updatedBankTxs }));
            setPendingBankTxs(prev => prev.filter(tx => !bankTxIds.includes(tx.id)));
            setPendingAppTxs(prev => prev.filter(tx => tx.id !== appTxId));
            setSelectedBankTxIds([]); // Limpiar la selección
            
            alert(`Conciliación M:1 exitosa.`);
        } catch (error) {
            console.error("Error multi-match:", error);
            alert("Error al conciliar múltiples transacciones.");
        } finally {
            setLoading(false);
        }
    };

    const handleManualMatch = async (bankTxId, appTxId, collectionName) => {
        if (!window.confirm("¿Confirmas la conciliación manual de este par (1:1)?")) return;
        setLoading(true);

        try {
            const batch = writeBatch(db);
            const bankTx = pendingBankTxs.find(tx => tx.id === bankTxId);

            // 1. Marcar en la App
            const appDocRef = doc(db, collectionName, appTxId);
            batch.update(appDocRef, { 
                is_conciled: true, 
                conciled_date: new Date(),
                bank_concept: bankTx?.concept || "Conciliación Manual",
            });
            
            // 2. Marcar en el Estado de Cuenta Bancario
            const statementDocRef = doc(db, 'bank_statements', statementData.id);
            const updatedBankTxs = statementData.transactions.map(tx => 
                tx.id === bankTxId ? { ...tx, is_conciled: true, app_id: appTxId } : tx
            );
            batch.update(statementDocRef, { transactions: updatedBankTxs });
            await batch.commit();

            // 3. Actualizar la UI
            setStatementData(prev => ({ ...prev, transactions: updatedBankTxs }));
            setPendingBankTxs(prev => prev.filter(tx => tx.id !== bankTxId));
            setPendingAppTxs(prev => prev.filter(tx => tx.id !== appTxId));
            
            alert("Conciliación manual (1:1) exitosa.");
        } catch (error) {
            console.error("Error manual match 1:1:", error);
            alert("Error al conciliar manualmente.");
        } finally {
            setLoading(false);
        }
    };

    const handleExcludeBankTransaction = async (bankTxId) => {
        if (!window.confirm("¿Excluir y marcar como conciliada (sin match en la app) esta transacción bancaria?")) return;
        setLoading(true);

        try {
            const updatedBankTxs = statementData.transactions.map(tx => 
                tx.id === bankTxId ? { ...tx, is_conciled: true, notes: "Excluded by user" } : tx
            );

            const docRef = doc(db, 'bank_statements', statementData.id);
            await updateDoc(docRef, { transactions: updatedBankTxs });

            // Actualizar la UI
            setStatementData(prev => ({ ...prev, transactions: updatedBankTxs }));
            setPendingBankTxs(prev => prev.filter(tx => tx.id !== bankTxId));
            alert("Transacción excluida.");
        } catch (error) {
            console.error("Error al excluir transacción:", error);
            alert("Error al excluir transacción.");
        } finally {
            setLoading(false);
        }
    };

    const handleFinalizeStatement = async () => {
        if (!window.confirm("¡ATENCIÓN! ¿Estás seguro de finalizar la conciliación? Los pendientes restantes en el banco se mantendrán como no conciliados.")) return;
        setLoading(true);
        
        try {
            // 1. Marcar el extracto como finalizado en Firebase
            const docRef = doc(db, 'bank_statements', statementData.id);
            await updateDoc(docRef, { is_finalized: true, finalized_date: new Date() });
            
            // 2. Limpiar estados para empezar de nuevo
            alert(`Conciliación ${statementData.reconciliationId} finalizada.`);
            setStatementData(null);
            setPendingBankTxs([]);
            setPendingAppTxs([]);
            setSelectedBankTxIds([]);
            setIsMapped(false);

        } catch (error) {
            console.error("Error al finalizar conciliación:", error);
            alert("Error al finalizar conciliación.");
        } finally {
            setLoading(false);
        }
    };


    // ----------------------------------------------------------------------
    // V. RENDERIZADO
    // ----------------------------------------------------------------------

    const renderPreviewStep = () => (
        <div className="p-4 border rounded-lg bg-gray-50 mb-6">
            <h3 className="text-xl font-bold mb-3 text-gray-700">Paso 1: Previsualización de Datos</h3>
            <div className="overflow-x-auto border rounded-lg max-h-64">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-200 sticky top-0">
                        <tr>
                            {headers.map(header => (
                                <th key={header} className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase tracking-wider whitespace-nowrap">
                                    {header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {previewData.map((row, index) => (
                            <tr key={index}>
                                {headers.map(header => (
                                    <td key={header} className="px-3 py-2 whitespace-nowrap text-xs">
                                        {row[header]}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const isConciliationReady = REQUIRED_FIELDS.every(field => mapping[field.key]);

    const renderMappingStep = () => (
        <div className="p-4 border rounded-lg bg-white">
            <h3 className="text-xl font-bold mb-4 text-gray-700">Paso 2: Mapeo de Columnas</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {REQUIRED_FIELDS.map(field => (
                    <div key={field.key} className="flex flex-col">
                        <label className="text-sm font-medium mb-1 text-gray-700">{field.label}:</label>
                        <select
                            className="p-2 border rounded-md bg-gray-50"
                            value={mapping[field.key]}
                            onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value })}
                        >
                            <option value="">-- Seleccionar Columna --</option>
                            {headers.map(header => (
                                <option key={header} value={header}>{header}</option>
                            ))}
                        </select>
                    </div>
                ))}
            </div>

            <button
                onClick={() => {
                    if (isConciliationReady) saveAndAutoReconcile(); 
                    else alert("Por favor, mapea todas las columnas.");
                }}
                disabled={!isConciliationReady || loading}
                className="mt-6 px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition"
            >
                {'Confirmar Mapeo e Iniciar Auto-Conciliación'}
            </button>
        </div>
    );

    const renderPendingList = () => (
        <div className="mt-6 border-t pt-4">
            <h3 className="text-2xl font-bold mb-4 text-gray-800">
                Conciliación Manual Pendiente: {statementData.reconciliationId || 'ID Temporal'}
            </h3>
            <p className="mb-4 text-sm text-gray-600">Extracto: <span className='font-semibold'>{statementData.fileName}</span></p>

            <div className='flex justify-between mb-4'>
                <p className='text-md font-semibold text-neutral-700'>
                    Pendientes de Banco: <span className='text-red-600'>{pendingBankTxs.length}</span> | 
                    Pendientes de App: <span className='text-blue-600'>{pendingAppTxs.length}</span>
                </p>
                <button 
                    onClick={handleFinalizeStatement} 
                    className='bg-red-600 text-white px-3 py-2 rounded text-sm font-semibold hover:bg-red-700 disabled:opacity-50'
                    disabled={loading}
                >
                    Terminar Conciliación Bancaria
                </button>
            </div>


            {/* LISTA DE TRANSACCIONES PENDIENTES DEL BANCO */}
            <h4 className="text-xl font-semibold mb-3 text-gray-700">
                Transacciones Pendientes del Banco 
                <span className='ml-2 text-sm text-gray-500'>({filteredBankTxs.length} visibles)</span>
                {selectedBankTxIds.length > 0 && 
                    <span className='ml-3 text-blue-600 font-normal text-base'>
                        ({selectedBankTxIds.length} seleccionadas para M:1)
                    </span>
                }
            </h4>

            {/* CONTROL DE FILTRO DE BANCO */}
            <div className="flex items-center space-x-2 mb-4">
                <label className="text-sm font-medium text-gray-700">Filtrar por tipo:</label>
                <select
                    value={bankFilter}
                    onChange={(e) => setBankFilter(e.target.value)}
                    className="p-1 border rounded text-sm bg-white"
                    disabled={loading}
                >
                    <option value="ALL">Todas</option>
                    <option value="INGRESOS">Solo Ingresos (Créditos &gt; 0)</option>
                    <option value="GASTOS">Solo Gastos (Débitos &lt; 0)</option>
                </select>
            </div>


            <div className="overflow-x-auto border rounded-lg max-h-96 mb-8">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 sticky top-0">
                        <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Sel.</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Monto</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Concepto</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Match 1:1 / Excluir</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {/* ITERAR SOBRE LA LISTA FILTRADA */}
                        {filteredBankTxs.map((tx) => (
                            <tr key={tx.id} className="bg-yellow-50">
                                {/* Checkbox de Selección M:1 */}
                                <td className="px-3 py-2 whitespace-nowrap text-xs">
                                    <input 
                                        type="checkbox" 
                                        checked={selectedBankTxIds.includes(tx.id)}
                                        onChange={() => handleBankTxSelection(tx.id)}
                                        disabled={loading}
                                        className='h-4 w-4 text-blue-600 border-gray-300 rounded'
                                    />
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-xs">{tx.date}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-xs font-mono">{fmt(tx.amount, 'C$')}</td>
                                <td className="px-3 py-2 whitespace-normal text-xs">{tx.concept}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-xs flex items-center space-x-2">
                                    {/* Select para Match Manual (1:1) */}
                                    <select
                                        onChange={(e) => {
                                            const [id, collection] = e.target.value.split('|');
                                            if (id) handleManualMatch(tx.id, id, collection);
                                        }}
                                        className='p-1 border rounded text-xs bg-white'
                                        disabled={loading}
                                    >
                                        <option value="">Conciliar con App (1:1)...</option>
                                        {pendingAppTxs
                                            // Aplicar el filtro de la App al desplegable 1:1 para sugerir solo el mismo tipo
                                            .filter(appTx => {
                                                const bankTxIsIncome = tx.amount > 0;
                                                const appTxIsIncome = appTx.collection === 'ingresos';
                                                
                                                if (bankTxIsIncome && appTxIsIncome) return true;
                                                if (!bankTxIsIncome && !appTxIsIncome) return true;
                                                return false;
                                            })
                                            .map(appTx => (
                                                <option key={appTx.id} value={`${appTx.id}|${appTx.collection}`}>
                                                    {appTx.collection === 'ingresos' ? 'Ingreso' : 'Gasto'} - {fmt(appTx.amount, 'C$')} ({appTx.dateStr})
                                                </option>
                                            ))
                                        }
                                    </select>
                                    {/* Botón para Excluir */}
                                    <button 
                                        onClick={() => handleExcludeBankTransaction(tx.id)}
                                        className='text-red-600 hover:underline text-xs bg-red-100 px-2 py-1 rounded disabled:opacity-50'
                                        disabled={loading}
                                    >
                                        Excluir
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* LISTA DE TRANSACCIONES PENDIENTES DE LA APP */}
            <h4 className="text-xl font-semibold mb-3 text-gray-700">
                Transacciones Pendientes en la App
                <span className='ml-2 text-sm text-gray-500'>({filteredAppTxs.length} visibles)</span>
            </h4>
            
            {/* CONTROL DE FILTRO DE APP */}
            <div className="flex items-center space-x-2 mb-4">
                <label className="text-sm font-medium text-gray-700">Filtrar por tipo:</label>
                <select
                    value={appFilter}
                    onChange={(e) => setAppFilter(e.target.value)}
                    className="p-1 border rounded text-sm bg-white"
                    disabled={loading}
                >
                    <option value="ALL">Todas</option>
                    <option value="INGRESOS">Solo Ingresos</option>
                    <option value="GASTOS">Solo Gastos</option>
                </select>
            </div>

            <div className="overflow-x-auto border rounded-lg max-h-96">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 sticky top-0">
                        <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Monto</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Descripción</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Acción M:1</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {/* ITERAR SOBRE LA LISTA FILTRADA */}
                        {filteredAppTxs.map(tx => (
                            <tr key={tx.id} className="bg-blue-50">
                                <td className="px-3 py-2 whitespace-nowrap text-xs">{tx.dateStr}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-xs font-mono">{fmt(tx.amount, 'C$')}</td>
                                <td className="px-3 py-2 whitespace-normal text-xs">{tx.description}</td>
                                <td className={`px-3 py-2 whitespace-nowrap text-xs font-medium ${tx.collection === 'ingresos' ? 'text-green-600' : 'text-red-600'}`}>
                                    {tx.collection === 'ingresos' ? 'Ingreso' : 'Gasto'}
                                </td>
                                {/* Botón M:1 */}
                                <td className="px-3 py-2 whitespace-nowrap text-xs">
                                    <button
                                        onClick={() => handleMultiMatch(tx.id, tx.collection)}
                                        disabled={loading || selectedBankTxIds.length === 0}
                                        className='bg-blue-600 text-white px-2 py-1 rounded text-xs hover:bg-blue-700 disabled:opacity-50'
                                    >
                                        Conciliar M:1 ({selectedBankTxIds.length})
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );

    return (
        <div className="p-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-2">Conciliación Bancaria</h2>
            
            {/* Mensaje de Carga (Con botón de escape) */}
            {loading && (
                <div className="p-4 border rounded-lg bg-blue-50 text-blue-800 font-semibold mb-6 flex justify-between items-center">
                    Cargando información pendiente... por favor espere.
                    <button 
                        onClick={() => setLoading(false)} 
                        className='ml-4 px-3 py-1 bg-blue-700 text-white rounded text-xs hover:bg-blue-800'
                    >
                        Forzar Inicio
                    </button>
                </div>
            )}
            
            {/* 1. Gestión manual si hay datos del banco guardados */}
            {statementData && !loading && renderPendingList()}

            {/* 2. Carga de archivo si NO hay datos pendientes */}
            {!statementData && !loading && (
                <>
                    <div className="mb-6 p-4 border rounded-lg bg-white">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Cargar Nuevo Extracto Bancario (.csv):
                        </label>
                        <input 
                            type="file" 
                            accept=".csv" 
                            onChange={handleFileChange} 
                            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                            disabled={loading}
                        />
                    </div>

                    {headers.length > 0 && renderPreviewStep()}
                    {headers.length > 0 && !isMapped && renderMappingStep()}
                </>
            )}
            
        </div>
    );
}