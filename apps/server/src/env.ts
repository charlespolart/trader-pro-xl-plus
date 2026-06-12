import { resolve } from 'node:path'

function repoRoot(): string {
  // apps/server/src → repo root
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
