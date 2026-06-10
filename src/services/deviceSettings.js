const DEVICE_SETTINGS_KEY = 'csm-device-settings';

export const DEVICE_SETTINGS_EVENT = 'csm-device-settings-updated';

export const DEFAULT_DEVICE_SETTINGS = {
    printer: {
        name: '',
        paperWidthMm: 80,
        ticketHeightMm: 180,
        voucherAutoPrint: true,
        showBrowserDialog: true,
    },
    scanner: {
        name: '',
        folder: '',
    },
};

const mergeSettings = (stored = {}) => ({
    ...DEFAULT_DEVICE_SETTINGS,
    ...stored,
    printer: {
        ...DEFAULT_DEVICE_SETTINGS.printer,
        ...(stored.printer || {}),
    },
    scanner: {
        ...DEFAULT_DEVICE_SETTINGS.scanner,
        ...(stored.scanner || {}),
    },
});

export const getDeviceSettings = () => {
    if (typeof window === 'undefined') return DEFAULT_DEVICE_SETTINGS;

    try {
        const raw = window.localStorage.getItem(DEVICE_SETTINGS_KEY);
        return mergeSettings(raw ? JSON.parse(raw) : {});
    } catch (error) {
        console.warn('No se pudo leer configuracion de dispositivos', error);
        return DEFAULT_DEVICE_SETTINGS;
    }
};

export const saveDeviceSettings = (settings) => {
    if (typeof window === 'undefined') return DEFAULT_DEVICE_SETTINGS;
    const merged = mergeSettings(settings);
    window.localStorage.setItem(DEVICE_SETTINGS_KEY, JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent(DEVICE_SETTINGS_EVENT, { detail: merged }));
    return merged;
};
