export const config = {
  port: Number(process.env.PORT || 3000),
  adminToken: process.env.ADMIN_TOKEN || 'dev-admin-token',
  mexicoTimeZone: process.env.MEXICO_TZ || 'America/Mexico_City',
  dataDir: process.env.DATA_DIR || 'data',
  sessionsDir: process.env.SESSIONS_DIR || 'sessions',
  tmpDir: process.env.TMP_DIR || 'tmp'
};
