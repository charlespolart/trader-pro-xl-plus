import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import vrx from '/Users/charlespolart/Documents/Coding/trader-pro-xl-plus/strategies/btc-vrx'

const db = createDb('postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve('/Users/charlespolart/Documents/Coding/trader-pro-xl-plus/data') })
const config: BacktestConfig = {
  strategyId: 'btc-vrx', params: {} as ParamValues, market: 'spot', symbol: 'BTCUSDT',
  start: Date.parse('2018-04-05T00:00:00Z'), end: Date.parse('2026-07-01T00:00:00Z'),
  initialBalance: 1, denomination: 'base', leverage: 1,
  fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
  fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
  fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
}
const res = await runBacktest({ config, def: vrx, provider })
const tr = res.trades
console.log('champs:', Object.keys(tr[0] ?? {}).join(','))
const rows = tr.map((t: any) => ({
  in: new Date(t.entryTime ?? t.openTime ?? 0).toISOString().slice(0, 10),
  out: new Date(t.exitTime ?? t.closeTime ?? 0).toISOString().slice(0, 10),
  pe: t.entryPrice ?? t.avgEntryPrice, px: t.exitPrice ?? t.avgExitPrice,
  pnl: t.realizedPnlPct, dir: t.direction,
}))
rows.sort((a, b) => (b.pnl ?? 0) - (a.pnl ?? 0))
console.log('TOP 5:'); for (const r of rows.slice(0, 5)) console.log(JSON.stringify(r))
console.log('PIRES 5:'); for (const r of rows.slice(-5)) console.log(JSON.stringify(r))
console.log('total:', rows.length)
process.exit(0)
