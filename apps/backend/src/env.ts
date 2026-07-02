import { resolve } from 'node:path'

function repoRoot(): string {
  // apps/backend/src → repo root
  return resolve(import.meta.dir, '../../..')
}

export const env = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5432/tpx',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  masterKey: process.env.MASTER_KEY ?? '',
  dataDir: resolve(process.env.DATA_DIR ?? resolve(repoRoot(), 'data')),
  artifactsDir: resolve(process.env.ARTIFACTS_DIR ?? resolve(repoRoot(), 'artifacts')),
  strategiesDir: resolve(process.env.STRATEGIES_DIR ?? resolve(repoRoot(), 'strategies')),
  webDistDir: resolve(repoRoot(), 'apps/web/dist'),
  backtestWorkers: Number(process.env.BACKTEST_WORKERS ?? Math.max(1, (navigator.hardwareConcurrency ?? 4) - 2)),
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '',
}

export const authEnabled = env.adminPassword.length > 0

// Défense en profondeur : en prod l'auth ne doit jamais tomber en silence
// (une faute de frappe sur ADMIN_PASSWORD dans .env laisserait le contrôle
// total du trading à tout porteur du cert mTLS). On refuse de démarrer.
if (process.env.NODE_ENV === 'production' && !authEnabled) {
  throw new Error(
    'ADMIN_PASSWORD manquant ou vide : démarrage refusé en production (NODE_ENV=production exige l’authentification).',
  )
}
