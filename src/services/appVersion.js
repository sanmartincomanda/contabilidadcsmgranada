export const APP_BUILD_ID = typeof __APP_BUILD_ID__ !== 'undefined'
    ? String(__APP_BUILD_ID__)
    : 'development';

export const fetchPublishedBuildId = async (fetchImpl = fetch) => {
    const response = await fetchImpl(`/version.json?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
    });
    if (!response.ok) return '';
    const payload = await response.json();
    return String(payload?.buildId || '').trim();
};
