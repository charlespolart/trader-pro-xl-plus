/**
 * Test-gate AVANT de coder une v3 : aux points de VENTE de la v2, une feature
 * aggTrades sépare-t-elle les trades gagnants des whipsaws (perdants), AU-DELÀ
 * du flux net par bougie qu'on a déjà (le contrôle) ?
 *
 * Télécharge les aggTrades seulement autour des jours de trade (coût borné).
 *   bun apps/backend/src/research/aggflow/gate.ts [start] [end]
 */
import { resolve } from 'node:path'
import { runBacktest } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import { DEFAULT_FEES, type BacktestConfig, type ParamValues } from '@tpx/shared'
import accumV2 from '../../../../../strategies/btc-accumulator'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../../data') })

const START = Date.parse(`${process.argv[2] ?? '2019-01-01'}T00:00:00Z`)
const END = Date.parse(`${process.argv[3] ?? '2026-06-13'}T00:00:00Z`)
const LOOKBACK = 8 * 3_600_000 // fenêtre de flux avant la vente (2 bougies 4h)
const SMALL = 10_000
const BIG = 100_000

function cfg(params: ParamValues): BacktestConfig {
  return {
    strategyId: 'btc-accumulator-v2', params, market: 'spot', symbol: 'BTCUSDT', start: START, end: END,
    initialBalance: 1, denomination: 'base', leverage: 1,
    fees: { ...DEFAULT_FEES.spot }, slippagePct: 0.0005,
    fillMode: 'candle', intrabarPath: 'heuristic', limitFillRatio: 0.25,
    fundingEnabled: false, maintenanceMarginRate: 0.005, warmupBars: 300,
  }
}

interface Feat {
  win: boolean
  netImb: number // ≈ takerFlow candle (CONTROLE)
  whaleImb: number
  retailImb: number
  wmr: number // baleine − retail
  whaleShare: number // part du volume venant des baleines
}

async function featuresAt(entryTime: number): Promise<Omit<Feat, 'win'> | null> {
  let vol = 0, delta = 0, dW = 0, dR = 0, vW = 0
  // petite résilience au hoquet TLS transitoire de Bun sur Vision
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      vol = 0; delta = 0; dW = 0; dR = 0; vW = 0
      for await (const batch of provider.getAggTrades('spot', 'BTCUSDT', entryTime - LOOKBACK, entryTime)) {
        for (const t of batch) {
          const signed = t.isBuyerMaker ? -t.qty : t.qty
          vol += t.qty
          delta += signed
          const notional = t.price * t.qty
          if (notional >= BIG) { dW += signed; vW += t.qty }
          else if (notional < SMALL) dR += signed
        }
      }
      break
    } catch (err) {
      if (attempt === 2) {
        console.error(`  aggTrades KO @${new Date(entryTime).toISOString().slice(0, 10)}: ${err instanceof Error ? err.message : err}`)
        return null
      }
    }
  }
  if (vol <= 0) return null
  return { netImb: delta / vol, whaleImb: dW / vol, retailImb: dR / vol, wmr: (dW - dR) / vol, whaleShare: vW / vol }
}

// Welch t-test (gagnants vs perdants)
function welch(a: number[], b: number[]): { t: number; ma: number; mb: number } {
  const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length
  const varc = (x: number[], m: number) => x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1)
  const ma = mean(a), mb = mean(b)
  const t = (ma - mb) / Math.sqrt(varc(a, ma) / a.length + varc(b, mb) / b.length)
  return { t, ma, mb }
}
const f = (v: number, d = 3): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')

console.log('Backtest v2 (défauts) pour récupérer les trades…')
const res = await runBacktest({ config: cfg({}), def: accumV2, provider })
const trades = res.trades.filter((t) => t.exitTime !== null)
console.log(`${trades.length} trades clôturés. Téléchargement aggTrades autour de chaque vente (fenêtre ${LOOKBACK / 3600000}h)…\n`)

const feats: Feat[] = []
let i = 0
for (const t of trades) {
  i++
  process.stderr.write(`\r  ${i}/${trades.length}   `)
  const ft = await featuresAt(t.entryTime)
  if (ft) feats.push({ win: t.realizedPnl > 0, ...ft })
}
process.stderr.write('\n')

const W = feats.filter((x) => x.win)
const L = feats.filter((x) => !x.win)
console.log(`\n=== Test-gate : features aggTrades au point de VENTE — gagnants (${W.length}) vs perdants (${L.length}) ===`)
console.log('(fenêtre de flux : 8h avant la vente. |t| > 2 ≈ séparation significative)\n')
console.log('feature'.padEnd(28) + ['moy. gagnants', 'moy. perdants', 't-stat'].map((s) => s.padStart(15)).join(''))

const cols: [string, (x: Feat) => number, boolean][] = [
  ['flux NET (= takerFlow) [ctrl]', (x) => x.netImb, false],
  ['flux BALEINE', (x) => x.whaleImb, true],
  ['flux RETAIL', (x) => x.retailImb, true],
  ['baleine − retail', (x) => x.wmr, true],
  ['part volume baleine', (x) => x.whaleShare, true],
]
for (const [label, sel, aggOnly] of cols) {
  const { t, ma, mb } = welch(W.map(sel), L.map(sel))
  const flag = Math.abs(t) > 2 ? (aggOnly ? '  ⟵ sépare (aggTrades-only)' : '  (déjà dans la bougie)') : ''
  console.log(label.padEnd(28) + [f(ma), f(mb), f(t, 2)].map((s) => s.padStart(15)).join('') + flag)
}
console.log('\nLecture : si une feature aggTrades-only (baleine, baleine−retail, part baleine) sépare')
console.log('(|t|>2) alors que le flux NET ne sépare pas → un filtre v3 vaut le coup. Sinon → no-go.')
process.exit(0)
