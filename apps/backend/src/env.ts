import { resolve } from 'node:path'

function repoRoot(): string {
  // apps/backend/src → repo root
  return resolve(import.meta.dir, '../../..')
}

export const env = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5432/tpx',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  // getter : lu à CHAQUE usage, pas capturé au chargement du module — sous
  // `bun test`, un autre fichier de test peut charger env.ts avant que
  // credentials.test.ts ait posé process.env.MASTER_KEY (flaky vécu)
  get masterKey(): string {
    return process.env.MASTER_KEY ?? ''
  },
  dataDir: resolve(process.env.DATA_DIR ?? resolve(repoRoot(), 'data')),
  artifactsDir: resolve(process.env.ARTIFACTS_DIR ?? resolve(repoRoot(), 'artifacts')),
  strategiesDir: resolve(process.env.STRATEGIES_DIR ?? resolve(repoRoot(), 'strategies')),
  webDistDir: resolve(repoRoot(), 'apps/web/dist'),
  backtestWorkers: Number(process.env.BACKTEST_WORKERS ?? Math.max(1, (navigator.hardwareConcurrency ?? 4) - 2)),
  // getters (même raison que masterKey) : lisibles après le chargement du
  // module — indispensable aux tests, inchangé au runtime
  get telegramToken(): string {
    return process.env.TELEGRAM_BOT_TOKEN ?? ''
  },
  get telegramChatId(): string {
    return process.env.TELEGRAM_CHAT_ID ?? ''
  },
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
