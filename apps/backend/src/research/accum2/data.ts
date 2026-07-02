/**
 * Campagne accumulateur 2026-07 : données spot complètes depuis le début de
 * Binance (2017-08) — ouvre le bear 2018 comme pseudo-OOS jamais utilisé.
 *   bun apps/backend/src/research/accum2/data.ts
 */
import { createDb } from '@tpx/db'
import { CandleStore, FundingStore } from '@tpx/data'
import type { Interval } from '@tpx/shared'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const store = new CandleStore(db)
const funding = new FundingStore(db)

const START = Date.parse('2017-08-01T00:00:00Z')
const END = Date.now()

for (const symbol of ['BTCUSDT']) {
  for (const itv of ['1d', '3d', '1w', '12h', '8h', '4h', '2h', '1h'] as Interval[]) {
    let last = 0
    process.stdout.write(`spot ${symbol} ${itv} `)
    await store.ensureRange('spot', symbol, itv, START, END, {
      onProgress: (d, t) => {
        const pct = Math.floor((d / t) * 10)
        if (pct > last) {
          last = pct
          process.stdout.write('▮')
        }
      },
    })
    console.log(' ok')
  }
}

// funding perp BTC (démarre 2019-09 chez Binance) — pour l'étude « funding comme filtre »
process.stdout.write('funding BTCUSDT ')
await funding.ensureRange('BTCUSDT', Date.parse('2019-09-01T00:00:00Z'), END)
console.log('ok')
process.exit(0)
