import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const TMP_MAX_AGE_MS = Number(process.env.TMP_MAX_AGE_HOURS || 6) * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MINUTES || 60) * 60 * 1000;

export async function cleanupRuntimeFiles() {
  await fs.mkdir(config.tmpDir, { recursive: true });
  await removeOldFiles(config.tmpDir, TMP_MAX_AGE_MS);
}

export function scheduleRuntimeCleanup() {
  setInterval(() => {
    cleanupRuntimeFiles().catch((error) => {
      console.warn('No se pudieron limpiar temporales:', error.message);
    });
  }, CLEANUP_INTERVAL_MS).unref();
}

async function removeOldFiles(dir, maxAgeMs) {
  const now = Date.now();
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);

  await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await removeOldFiles(fullPath, maxAgeMs);
      await removeEmptyDir(fullPath);
      return;
    }

    const stat = await fs.stat(fullPath).catch(() => null);
    if (stat && now - stat.mtimeMs > maxAgeMs) {
      await fs.rm(fullPath, { force: true });
    }
  }));
}

async function removeEmptyDir(dir) {
  const entries = await fs.readdir(dir).catch(() => null);
  if (entries?.length === 0) {
    await fs.rmdir(dir).catch(() => {});
  }
}
