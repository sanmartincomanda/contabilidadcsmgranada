const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const DEFAULT_PROJECT_ID = 'sistema-contable-csm-granada';
const CONFIG_COLLECTION = 'configuracion';
const CONFIG_DOC_ID = 'plan_cuentas_quickbooks';

const parseCsvLine = (line) => {
    const output = [];
    let current = '';
    let quoted = false;

    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"') {
            if (quoted && line[index + 1] === '"') {
                current += '"';
                index += 1;
            } else {
                quoted = !quoted;
            }
        } else if (char === ',' && !quoted) {
            output.push(current);
            current = '';
        } else {
            current += char;
        }
    }

    output.push(current);
    return output;
};

const parseCsv = (content) => {
    const cleanContent = content.replace(/^\uFEFF/, '');
    const lines = cleanContent.split(/\r?\n/).filter((line) => line.trim());
    lines.shift();

    return lines.map((line) => {
        const [number, name, type, detailType, locked] = parseCsvLine(line);
        return {
            id: String(number || name || '').trim(),
            number: String(number || '').trim(),
            name: String(name || '').trim(),
            type: String(type || '').trim(),
            detailType: String(detailType || '').trim(),
            locked: String(locked || '').trim().toLowerCase() === 'yes',
        };
    }).filter((account) => account.name);
};

const initFirebase = () => {
    if (admin.apps.length) return admin.firestore();

    const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'C:\\SICAR\\keys\\firebase-adminsdk.json';
    if (credentialPath && fs.existsSync(credentialPath)) {
        const serviceAccount = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: serviceAccount.project_id || DEFAULT_PROJECT_ID,
        });
    } else {
        admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || DEFAULT_PROJECT_ID });
    }

    return admin.firestore();
};

const getArg = (name) => {
    const prefix = `--${name}=`;
    const arg = process.argv.find((item) => item.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : '';
};

const main = async () => {
    const fileArg = getArg('file');
    if (!fileArg) {
        throw new Error('Uso: node functions/scripts/importQuickbooksChartOfAccounts.js --file="C:\\ruta\\Carnes_San Martin Granada.csv"');
    }

    const filePath = path.resolve(fileArg);
    if (!fs.existsSync(filePath)) {
        throw new Error(`No existe el archivo: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const accounts = parseCsv(content);
    const db = initFirebase();
    const now = admin.firestore.FieldValue.serverTimestamp();

    await db.collection(CONFIG_COLLECTION).doc(CONFIG_DOC_ID).set({
        source: 'quickbooks_csv',
        sourceFileName: path.basename(filePath),
        importedAt: now,
        accountCount: accounts.length,
        accounts,
    }, { merge: true });

    console.log(`Plan de cuentas importado: ${accounts.length} cuentas en ${CONFIG_COLLECTION}/${CONFIG_DOC_ID}`);
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
