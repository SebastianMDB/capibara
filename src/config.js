import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  port: Number(process.env.PORT || 3000),
  adminToken: process.env.ADMIN_TOKEN || 'dev-admin-token',
  mexicoTimeZone: process.env.MEXICO_TZ || 'America/Mexico_City',
  dataDir: resolveProjectPath(process.env.DATA_DIR || 'data'),
  sessionsDir: resolveProjectPath(process.env.SESSIONS_DIR || 'sessions'),
  tmpDir: resolveProjectPath(process.env.TMP_DIR || 'tmp')
};

function resolveProjectPath(value) {
  return path.isAbsolute(value) ? value : path.join(projectRoot, value);
}
