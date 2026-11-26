import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');

/** All runtime data stays inside the project folder (no system services). */
export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL,
  dataDir: process.env.GAM3EY_DATA_DIR ?? path.join(SERVER_ROOT, 'data', 'pgdata'),
  uploadDir: process.env.GAM3EY_UPLOAD_DIR ?? path.join(SERVER_ROOT, 'data', 'uploads'),
  jwtSecret: process.env.JWT_SECRET ?? 'gam3ey-local-development-secret-change-me',
  tokenTtl: '8h',
  resetTtlMinutes: 30,
  maxUploadBytes: 20 * 1024 * 1024,
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',
  clientDist: path.resolve(SERVER_ROOT, '..', 'client', 'dist'),
};
