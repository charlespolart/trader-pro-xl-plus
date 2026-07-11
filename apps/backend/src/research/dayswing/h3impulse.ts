/**
 * Phase 1 — H3 : continuation d'impulsion confirmée flux, événements
 * DÉ-CHEVAUCHÉS (séquentiels façon trades : après un event à i avec horizon H,
 * le prochain est ≥ i+H). C'est l'étude décisive avant tout prototype.
 *
 * Sections : (1) sweep seuils p85/p90/p95 × horizons 8/24/48 × strates, par ère
 * + par année ; (2) forme du chemin de dérive (cumul moyen h+1..h+48, MAE/MFE)
 * → matière de l'ingénierie d'exit ; (3) interaction heure NY (valeur marginale
 * façon gate.ts) ; (4) mini-null apparié : 200 tirages de starts aléatoires
 * NON chevauchants dans les mêmes barres bull → percentile du réel ;
 * (5) transfert ETH (sensibilité : même signe attendu, effet partiel toléré).
 *
 *   bun apps/backend/src/research/dayswing/h3impulse.ts [--from=2019-01-01] [--to=2025-01-01] [--symbol=BTCUSDT]
 */
import { createDb } from '@tpx/db'
import { CandleStore } from '@tpx/data'
import type { Candle } from '@tpx/shared'
import { nyHour } from './time'

const arg = (name: string, dflt: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt
const FROM = Date.parse(arg('from', '2019-01-01') + 'T00:00:00Z')
const TO = Date.parse(arg('to', '2025-01-01') + 'T00:00:00Z')
const SYMBOL = arg('symbol', 'BTCUSDT')
const DAY = 86_400_000

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN)
const sd = (v: number[]) => {
  if (v.length < 2) return NaN
  const m = mean(v)
  return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / (v.length - 1))
}
const tstat = (v: number[]) => (v.length < 2 ? NaN : mean(v) / (sd(v) / Math.sqrt(v.length)))
const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
const fb = (x: number, w = 7) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(1) : '—').padStart(w)
const ft = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '—').padStart(5)
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const store = new CandleStore(db)

async function loadSeries(symbol: string) {
  const h1 = await store.getCandles('spot', symbol, '1h', FROM - 30 * DAY, TO)
  const d1 = await store.getCandles('spot', symbol, '1d', FROM - 320 * DAY, TO)
  const emaByDay = new Map<number, boolean>()
  const k = 2 / 201
  let ema = NaN
  const seed: number[] = []
  for (const c of d1) {
    if (Number.isNaN(ema)) {
      seed.push(c.close)
      if (seed.length === 200) ema = mean(seed)
    } else ema = c.close * k + ema * (1 - k)
    if (!Number.isNaN(ema)) emaByDay.set(Math.floor(c.openTime / DAY), c.close > ema)
  }
  const isBull = (t: number) => emaByDay.get(Math.floor(t / DAY) - 1) ?? null
  // séries dérivées
  const n = h1.length
  const ret = new Array<number>(n).fill(NaN)
  const imp4 = new Array<number>(n).fill(NaN) // ret cumulé 4 barres, bps
  const flow10 = new Array<number>(n).fill(NaN)
  const bull = new Array<boolean | null>(n).fill(null)
  const fwin: number[] = []
  for (let i = 1; i < n; i++) {
    ret[i] = Math.log(h1[i].close / h1[i - 1].close) * 1e4
    if (i >= 4) imp4[i] = (Math.log(h1[i].close / h1[i - 4].close)) * 1e4
    const f = h1[i].volume > 0 ? h1[i].takerBuyBase / h1[i].volume : 0.5
    fwin.push(f)
    if (fwin.length > 10) fwin.shift()
    flow10[i] = mean(fwin)
    bull[i] = isBull(h1[i].openTime)
  }
  const startIdx = h1.findIndex((c) => c.openTime >= FROM)
  return { h1, ret, imp4, flow10, bull, startIdx }
}

type Series = Awaited<ReturnType<typeof loadSeries>>

/** événements dé-chevauchés : condition vraie à i → event, prochain ≥ i+gap */
function events(S: Series, cond: (i: number) => boolean, gap: number): number[] {
  const out: number[] = []
  let nextOk = 0
  for (let i = Math.max(S.startIdx, 28); i < S.h1.length - 49; i++) {
    if (i < nextOk) continue
    if (cond(i)) {
      out.push(i)
      nextOk = i + gap
    }
  }
  return out
}
const fwd = (S: Series, i: number, h: number) => Math.log(S.h1[i + h].close / S.h1[i].close) * 1e4

console.log(`H3 impulsion — ${SYMBOL} 1h, ${arg('from', '2019-01-01')} → ${arg('to', '2025-01-01')}`)
const S = await loadSeries(SYMBOL)
const sortedImp = S.imp4.filter((x, i) => Number.isFinite(x) && i >= S.startIdx).sort((a, b) => a - b)
const TH = { p85: pct(sortedImp, 0.85), p90: pct(sortedImp, 0.9), p95: pct(sortedImp, 0.95) }
console.log(`seuils impulsion 4h (IS) : p85=${TH.p85.toFixed(0)} p90=${TH.p90.toFixed(0)} p95=${TH.p95.toFixed(0)} bps\n`)

// ---------- 1. sweep seuils × horizons, dé-chevauché ----------
console.log('══ 1. SWEEP (événements dé-chevauchés au pas de l’horizon, bull × flow10>0.5) ══')
console.log(
  'seuil'.padEnd(7) + 'h'.padStart(4) + 'n'.padStart(6) + '/an'.padStart(6) +
    'E[fwd] [t]'.padStart(17) + 'méd'.padStart(8) + 'WR%'.padStart(6) + '  par ère (19-20 | 21-23 | 24)',
)
const YEARS_SPAN = (TO - FROM) / (365.25 * DAY)
for (const [name, th] of Object.entries(TH)) {
  for (const h of [8, 24, 48]) {
    const evs = events(S, (i) => S.imp4[i] >= th && S.flow10[i] > 0.5 && S.bull[i] === true, h)
    const v = evs.map((i) => fwd(S, i, h))
    const sortedV = [...v].sort((a, b) => a - b)
    const wr = v.filter((x) => x > 0).length / v.length
    const eras: string[] = []
    for (const [a, b] of [[2019, 2020], [2021, 2023], [2024, 2024]]) {
      const ve = evs.filter((i) => {
        const y = new Date(S.h1[i].openTime).getUTCFullYear()
        return y >= a && y <= b
      }).map((i) => fwd(S, i, h))
      eras.push(`${fb(mean(ve), 6)}(${ve.length})`)
    }
    console.log(
      name.padEnd(7) + String(h).padStart(4) + String(evs.length).padStart(6) +
        (evs.length / YEARS_SPAN).toFixed(0).padStart(6) +
        `${fb(mean(v))} [${ft(tstat(v))}]`.padStart(17) + fb(pct(sortedV, 0.5), 8) +
        (wr * 100).toFixed(0).padStart(5) + '%' + '  ' + eras.join(' | '),
    )
  }
}

// ---------- 2. forme du chemin ----------
console.log('\n══ 2. CHEMIN DE DÉRIVE (p90 × flow>0.5 × bull, dé-chevauché 48h) ══')
{
  const evs = events(S, (i) => S.imp4[i] >= TH.p90 && S.flow10[i] > 0.5 && S.bull[i] === true, 48)
  console.log(`n=${evs.length} events. Cumul moyen / médian / q25 / q75 (bps) et MAE/MFE moyens :`)
  console.log('h'.padStart(4) + 'moy'.padStart(8) + 'méd'.padStart(8) + 'q25'.padStart(8) + 'q75'.padStart(8) + 'MAE'.padStart(8) + 'MFE'.padStart(8))
  for (const h of [1, 2, 4, 6, 8, 12, 16, 24, 32, 40, 48]) {
    const v = evs.map((i) => fwd(S, i, h))
    const sv = [...v].sort((a, b) => a - b)
    // MAE/MFE intrabar sur (i, i+h] par rapport au close d'entrée
    const maes: number[] = []
    const mfes: number[] = []
    for (const i of evs) {
      const c0 = S.h1[i].close
      let lo = 0
      let hi = 0
      for (let j = i + 1; j <= i + h; j++) {
        lo = Math.min(lo, Math.log(S.h1[j].low / c0) * 1e4)
        hi = Math.max(hi, Math.log(S.h1[j].high / c0) * 1e4)
      }
      maes.push(lo)
      mfes.push(hi)
    }
    console.log(
      String(h).padStart(4) + fb(mean(v), 8) + fb(pct(sv, 0.5), 8) + fb(pct(sv, 0.25), 8) + fb(pct(sv, 0.75), 8) +
        fb(mean(maes), 8) + fb(mean(mfes), 8),
    )
  }
}

// ---------- 3. valeur marginale de l'heure NY ----------
console.log('\n══ 3. HEURE NY DE L’ÉVÉNEMENT (p90 × flow>0.5 × bull, fwd24h, dé-chevauché 24h) ══')
{
  const evs = events(S, (i) => S.imp4[i] >= TH.p90 && S.flow10[i] > 0.5 && S.bull[i] === true, 24)
  const buckets: Array<[string, (h: number) => boolean]> = [
    ['NY 9-16 (cash)', (h) => h >= 9 && h < 16],
    ['NY 16-21 (after)', (h) => h >= 16 && h < 21],
    ['NY 21-9 (nuit)', (h) => h >= 21 || h < 9],
  ]
  const all = evs.map((i) => fwd(S, i, 24))
  console.log(`tous : n=${evs.length}  E=${fb(mean(all))} [${ft(tstat(all))}]`)
  for (const [label, test] of buckets) {
    const sel = evs.filter((i) => test(nyHour(S.h1[i].openTime)))
    const v = sel.map((i) => fwd(S, i, 24))
    console.log(`${label.padEnd(18)} n=${String(sel.length).padStart(4)}  E=${fb(mean(v))} [${ft(tstat(v))}]`)
  }
}

// ---------- 4. mini-null apparié ----------
console.log('\n══ 4. NULL TIMING-AVEUGLE (p90 × flow>0.5 × bull, fwd24h) ══')
{
  const evs = events(S, (i) => S.imp4[i] >= TH.p90 && S.flow10[i] > 0.5 && S.bull[i] === true, 24)
  const real = mean(evs.map((i) => fwd(S, i, 24)))
  const bullIdx: number[] = []
  for (let i = Math.max(S.startIdx, 28); i < S.h1.length - 49; i++) if (S.bull[i] === true) bullIdx.push(i)
  const rand = mulberry32(0x4a3)
  const nulls: number[] = []
  for (let d = 0; d < 200; d++) {
    // même nombre de starts, non chevauchants, tirés dans les MÊMES barres bull
    const picked: number[] = []
    let guard = 0
    while (picked.length < evs.length && guard++ < 100000) {
      const cand = bullIdx[Math.floor(rand() * bullIdx.length)]
      if (picked.every((p) => Math.abs(p - cand) >= 24)) picked.push(cand)
    }
    nulls.push(mean(picked.map((i) => fwd(S, i, 24))))
  }
  nulls.sort((a, b) => a - b)
  const below = nulls.filter((x) => x < real).length
  console.log(`réel ${fb(real)} bps · null médiane ${fb(pct(nulls, 0.5))} · p95 ${fb(pct(nulls, 0.95))} · percentile du réel = ${((below / nulls.length) * 100).toFixed(1)}`)
}

// ---------- 5. transfert ETH ----------
if (SYMBOL === 'BTCUSDT') {
  console.log('\n══ 5. TRANSFERT ETH (mêmes règles, seuils re-p90 sur ETH) ══')
  const E = await loadSeries('ETHUSDT')
  const sortedE = E.imp4.filter((x, i) => Number.isFinite(x) && i >= E.startIdx).sort((a, b) => a - b)
  const thE = pct(sortedE, 0.9)
  for (const h of [8, 24, 48]) {
    const evs = events(E, (i) => E.imp4[i] >= thE && E.flow10[i] > 0.5 && E.bull[i] === true, h)
    const v = evs.map((i) => fwd(E, i, h))
    console.log(`h=${String(h).padStart(2)}  n=${String(evs.length).padStart(4)}  E[fwd]=${fb(mean(v))} [${ft(tstat(v))}]  (seuil p90 ETH=${thE.toFixed(0)} bps)`)
  }
}
process.exit(0)
