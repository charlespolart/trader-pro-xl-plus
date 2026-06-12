/** Précharge l'historique BTCUSDT futures pour la recherche de stratégies. */
import { createDb } from '@tpx/db'
import { CandleStore, FundingStore } from '@tpx/data'
import type { Interval } from '@tpx/shared'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const store = new CandleStore(db)
const funding = new FundingStore(db)

const START = Date.parse('2020-01-01T00:00:00Z')
const END = Date.now()

for (const itv of ['1d', '4h', '1h', '15m'] as Interval[]) {
  let last = 0
  process.stdout.write(`candles ${itv} `)
  await store.ensureRange('futures', 'BTCUSDT', itv, START, END, {
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
process.stdout.write('funding ')
await funding.ensureRange('BTCUSDT', START, END)
console.log('ok')
process.exit(0)
