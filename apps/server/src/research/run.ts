/**
 * Runner de recherche : exécute les familles candidates sur des périodes
 * nommées et imprime un tableau comparatif.
 *
 *   bun apps/server/src/research/run.ts all --period=is
 *   bun apps/server/src/research/run.ts rsipull flow --period=is,bear22
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import { FAMILIES } from './families'

export const PERIODS: Record<string, [string, string]> = {
  // les archives Vision futures commencent au 2020-01-01 : un départ IS au
  // 2020-08-01 laisse ~210 jours de warmup pour l'EMA200 1d
  is: ['2020-08-01', '2024-06-01'],
  oos: ['2024-06-01', '2026-06-09'],
  bull21: ['2020-10-01', '2021-12-01'],
  bear22: ['2021-11-01', '2023-01-01'],
  chop23: ['2023-01-01', '2024-01-01'],
  bull24: ['2023-10-01', '2024-06-01'],
}

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })

export function mkConfig(params: ParamValues, start: number, end: number): BacktestConfig {
  return {
    strategyId: 'research',
    params,
    market: 'futures',
    symbol: 'BTCUSDT',
    start,
    end,
    initialBalance: 10_000,
    leverage: 2,
    fees: DEFAULT_FEES.futures,
    slippagePct: 0.0005,
    fillMode: 'candle',
    intrabarPath: 'heuristic',
    limitFillRatio: 0.25,
    fundingEnabled: true,
    maintenanceMarginRate: 0.005,
    warmupBars: 300,
  }
}

const fmt = (v: number | null | undefined, d = 1): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d)

function row(cols: string[], widths: number[]): string {
  return cols.map((c, i) => c.padStart(widths[i] ?? 8)).join(' ')
}

const WIDTHS = [26, 8, 7, 6, 6, 5, 8, 7, 7, 7, 8, 8]

export function header(): string {
  return row(
    ['stratégie', 'période', 'trades', 't/sem', 'WR%', 'PF', 'net%', 'dd%', 'sharpe', 'frais', 'fund', 'B&H%'],
    WIDTHS,
  )
}

export async function runOne(defKey: string, label: string, params: ParamValues, periodKey: string): Promise<string> {
  const fam = FAMILIES.find((f) => f.key === defKey)
  if (!fam) throw new Error(`famille inconnue: ${defKey}`)
  const [s, e] = PERIODS[periodKey]!
  const start = Date.parse(`${s}T00:00:00Z`)
  const end = Date.parse(`${e}T00:00:00Z`)
  const res = await runBacktest({ config: mkConfig(params, start, end), def: fam.def, provider })
  const m = res.metrics
  const weeks = (end - start) / (7 * 86_400_000)
  const halted = res.haltedReason !== null ? ` ⚠ ${res.haltedReason}` : ''
  return (
    row(
      [
        label,
        periodKey,
        String(m.totalTrades),
        fmt(m.totalTrades / weeks, 2),
        fmt(m.winRate, 0),
        fmt(m.profitFactor, 2),
        fmt(m.netProfitPct, 1),
        fmt(-m.maxDrawdownPct, 1),
        fmt(m.sharpe, 2),
        fmt(m.totalFees, 0),
        fmt(m.totalFunding, 0),
        fmt(m.buyHoldReturnPct, 0),
      ],
      WIDTHS,
    ) + halted
  )
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const periodArg = args.find((a) => a.startsWith('--period='))?.slice(9) ?? 'is'
  const famKeys = args.filter((a) => !a.startsWith('--'))
  const selected = famKeys.length === 0 || famKeys.includes('all') ? FAMILIES : FAMILIES.filter((f) => famKeys.includes(f.key))
  const periods = periodArg.split(',')

  console.log(header())
  for (const fam of selected) {
    for (const variant of fam.variants) {
      for (const period of periods) {
        try {
          console.log(await runOne(fam.key, `${fam.key}:${variant.label}`, variant.params, period))
        } catch (err) {
          console.log(`${fam.key}:${variant.label} [${period}] ERREUR: ${err instanceof Error ? err.message : err}`)
        }
      }
    }
  }
  process.exit(0)
}
