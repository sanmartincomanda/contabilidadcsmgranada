const DEFAULT_SYNC_LOG_RETENTION_DAYS = 30;

function getSyncLogRetentionDays() {
  const value = Number(process.env.SICAR_SYNC_LOG_RETENTION_DAYS || DEFAULT_SYNC_LOG_RETENTION_DAYS);
  if (!Number.isFinite(value)) return DEFAULT_SYNC_LOG_RETENTION_DAYS;
  return Math.max(7, Math.min(Math.round(value), 180));
}

function buildSyncLogPayload(admin, payload = {}) {
  const retentionDays = getSyncLogRetentionDays();
  return {
    ...payload,
    retentionDays,
    expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000)),
  };
}

module.exports = {
  buildSyncLogPayload,
  getSyncLogRetentionDays,
};
