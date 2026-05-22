import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

const callable = httpsCallable(functions, 'syncSicarIngresosCarnesAmparito');

export async function syncSicarDailyIncome({ date, preview = false }) {
    const normalizedDate = (date || new Date().toISOString().substring(0, 10)).substring(0, 10);
    const response = await callable({
        startDate: normalizedDate,
        endDate: normalizedDate,
        preview,
    });

    return response.data;
}
