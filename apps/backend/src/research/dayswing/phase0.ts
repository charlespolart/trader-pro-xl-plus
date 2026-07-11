/**
 * Campagne day-swing — PHASE 0 : cartographie du terrain, BTCUSDT spot 1h.
 *
 * Sections : (0) sanité données ; (1) saisonnalité horaire UTC + NY par ère,
 * drill-down année-par-année ; (2) jour de semaine + weekend ; (3) cycle
 * funding (h mod 8) ; (4) structure de vol par heure ; (5) continuation
 * E[fwd | mouvement passé × flux × régime] avec bootstrap par blocs ;
 * (6) sessions (Asie/EU/cash US/after US) en bps/jour.
 *
 * Conventions : ret[i] = log close(i-1)→close(i), attribué à l'HEURE D'OUVERTURE
 * de la bougie i (« h=22 » = rendement gagné pendant 22:00→23:00). Tout en bps.
 * Régime = close journalier de la VEILLE vs EMA200 (aucun lookahead).
 *
 *   bun apps/backend/src/research/dayswing/phase0.ts [--from=2019-01-01] [--to=2025-01-01] [--symbol=BTCUSDT]
 *
 * ⚠ Défaut = IS 2019-01→2025-01. Ne pas lancer sur l'OOS/holdout avant une
 * promotion de famille (LOG.md §3).
 */
import { createDb } from '@tpx/db'
import { CandleStore } from '@tpx/data'
import type { Candle } from '@tpx/shared'
import { nyDow, nyHour } from './time'

// ---------- args ----------
const arg = (name: string, dflt: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt
const FROM = Date.parse(arg('from', '2019-01-01') + 'T00:00:00Z')
const TO = Date.parse(arg('to', '2025-01-01') + 'T00:00:00Z')
const SYMBOL = arg('symbol', 'BTCUSDT')

const HOUR = 3_600_000
const DAY = 86_400_000

// ---------- helpers stats ----------
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN)
const sd = (v: number[]) => {
  if (v.length < 2) return NaN
  const m = mean(v)
  return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / (v.length - 1))
}
const tstat = (v: number[]) => (v.length < 2 ? NaN : mean(v) / (sd(v) / Math.sqrt(v.length)))

/** PRNG déterministe (reproductibilité du bootstrap) */
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

/** IC 95 % de la moyenne par moving-block bootstrap (fenêtres forward chevauchantes) */
function blockCI(vals: number[], blockLen: number, iters = 1000): [number, number] {
  const n = vals.length
  if (n < 20) return [NaN, NaN]
  const L = Math.max(1, Math.min(blockLen, Math.floor(n / 4)))
  const rand = mulberry32(0xd45 ^ n)
  const nBlocks = Math.ceil(n / L)
  const means: number[] = []
  for (let it = 0; it < iters; it++) {
    let sum = 0
    let cnt = 0
    for (let b = 0; b < nBlocks && cnt < n; b++) {
      const s = Math.floor(rand() * (n - L + 1))
      for (let j = 0; j < L && cnt < n; j++, cnt++) sum += vals[s + j]
    }
    means.push(sum / cnt)
  }
  means.sort((a, b) => a - b)
  return [means[Math.floor(iters * 0.025)], means[Math.floor(iters * 0.975)]]
}

// ---------- helpers formatage ----------
const fb = (x: number, w = 7) =>
  (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(1) : '—').padStart(w)
const ft = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '—').padStart(5)
const flag = (t: number) => (Math.abs(t) >= 3 ? '**' : Math.abs(t) >= 2 ? '* ' : '  ')
const pad = (s: string, w: number) => s.padEnd(w)
const line = (ch = '─', w = 100) => console.log(ch.repeat(w))
const H = (title: string) => {
  console.log()
  line('═')
  console.log(`== ${title}`)
  line('═')
}

// ---------- chargement ----------
const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const store = new CandleStore(db)

console.log(`PHASE 0 — ${SYMBOL} spot 1h, ${arg('from', '2019-01-01')} → ${arg('to', '2025-01-01')} (IS)`)
console.log('Seuils coûts roundtrip : taker+taker 30 bps · maker+taker 23 bps · maker+maker 16 bps (slip incl. taker 5 bps/côté)')

// 1h pour l'intraday + 1d pour le régime (warmup EMA200 : 320 jours avant FROM)
const h1 = await store.getCandles('spot', SYMBOL, '1h', FROM - 25 * HOUR, TO)
const d1 = await store.getCandles('spot', SYMBOL, '1d', FROM - 320 * DAY, TO)
if (h1.length < 1000) {
  console.error(`Trop peu de bougies 1h (${h1.length}) — backfill manquant ?`)
  process.exit(1)
}

// régime : close de la veille vs EMA200 de la veille
const emaByDay = new Map<number, { close: number; ema: number }>()
{
  const k = 2 / 201
  let ema = NaN
  let seed: number[] = []
  for (const c of d1) {
    if (Number.isNaN(ema)) {
      seed.push(c.close)
      if (seed.length === 200) ema = mean(seed)
    } else ema = c.close * k + ema * (1 - k)
    if (!Number.isNaN(ema)) emaByDay.set(Math.floor(c.openTime / DAY), { close: c.close, ema })
  }
}
const regimeAt = (t: number): 'bull' | 'bear' | null => {
  const prev = emaByDay.get(Math.floor(t / DAY) - 1)
  if (!prev) return null
  return prev.close > prev.ema ? 'bull' : 'bear'
}

// séries par barre (index aligné sur bars[]) — bars[0] sert de base du 1er ret
type Bar = {
  t: number
  ret: number // log-ret close→close, bps
  absRet: number
  rangeBps: number
  flow: number // takerBuyBase/volume de LA barre
  flow10: number // moyenne mobile 10 barres
  regime: 'bull' | 'bear' | null
  year: number
  hUtc: number
  hNy: number
  dowUtc: number
  dowNy: number
}
const bars: Bar[] = []
{
  const flowWin: number[] = []
  for (let i = 1; i < h1.length; i++) {
    const c = h1[i]
    if (c.openTime < FROM || c.openTime >= TO) {
      // hors fenêtre : alimente quand même le rolling flow pour éviter un trou au bord
      flowWin.push(c.volume > 0 ? c.takerBuyBase / c.volume : 0.5)
      if (flowWin.length > 10) flowWin.shift()
      continue
    }
    const prev = h1[i - 1]
    if (prev.closeTime + 1 !== c.openTime && c.openTime - prev.openTime !== HOUR) {
      // trou de données : pas de ret calculable proprement
      continue
    }
    const f = c.volume > 0 ? c.takerBuyBase / c.volume : 0.5
    flowWin.push(f)
    if (flowWin.length > 10) flowWin.shift()
    const d = new Date(c.openTime)
    bars.push({
      t: c.openTime,
      ret: Math.log(c.close / prev.close) * 1e4,
      absRet: Math.abs(Math.log(c.close / prev.close)) * 1e4,
      rangeBps: ((c.high - c.low) / c.open) * 1e4,
      flow: f,
      flow10: mean(flowWin),
      regime: regimeAt(c.openTime),
      year: d.getUTCFullYear(),
      hUtc: d.getUTCHours(),
      hNy: nyHour(c.openTime),
      dowUtc: d.getUTCDay(),
      dowNy: nyDow(c.openTime),
    })
  }
}

const YEARS = [...new Set(bars.map((b) => b.year))].sort()
const ERA_DEFS: Array<[string, number, number]> = [
  ['2019-20', 2019, 2020],
  ['2021-23', 2021, 2023],
  ['2024', 2024, 2024],
]
const ERAS = ERA_DEFS.filter(([, a, b]) => YEARS.some((y) => y >= a && y <= b))
ERAS.push(['IS-all', YEARS[0], YEARS[YEARS.length - 1]])
const inEra = (b: Bar, e: [string, number, number]) => b.year >= e[1] && b.year <= e[2]

// ---------- 0. sanité ----------
H('0. SANITÉ DONNÉES')
console.log(pad('année', 8) + 'barres'.padStart(8) + 'attendu'.padStart(9) + 'trous%'.padStart(8) + 'flow=0/1%'.padStart(11))
for (const y of YEARS) {
  const n = bars.filter((b) => b.year === y).length
  const start = Math.max(FROM, Date.UTC(y, 0, 1))
  const end = Math.min(TO, Date.UTC(y + 1, 0, 1))
  const expected = Math.round((end - start) / HOUR)
  const degenerate = bars.filter((b) => b.year === y && (b.flow === 0 || b.flow === 1)).length
  console.log(
    pad(String(y), 8) +
      String(n).padStart(8) +
      String(expected).padStart(9) +
      (((expected - n) / expected) * 100).toFixed(2).padStart(7) +
      '%' +
      ((degenerate / n) * 100).toFixed(2).padStart(10) +
      '%',
  )
}

// ---------- 1. saisonnalité horaire ----------
function hourTable(hourOf: (b: Bar) => number, label: string) {
  H(`1. SAISONNALITÉ HORAIRE (${label}) — bps/heure moyen [t]`)
  console.log(pad('h', 4) + ERAS.map(([n]) => (n + ' (bps [t])').padStart(20)).join(''))
  for (let h = 0; h < 24; h++) {
    let row = pad(String(h), 4)
    for (const era of ERAS) {
      const v = bars.filter((b) => inEra(b, era) && hourOf(b) === h).map((b) => b.ret)
      const t = tstat(v)
      row += `${fb(mean(v))} [${ft(t)}]${flag(t)}`.padStart(20)
    }
    console.log(row)
  }
}
hourTable((b) => b.hUtc, 'UTC')
hourTable((b) => b.hNy, 'New York')

// drill-down année par année : top heures par |t| sur IS-all (UTC)
H('1c. DRILL-DOWN ANNUEL — heures UTC les plus significatives (IS-all), bps/h par année')
const hourScores = Array.from({ length: 24 }, (_, h) => {
  const v = bars.filter((b) => b.hUtc === h).map((b) => b.ret)
  return { h, t: tstat(v) }
}).sort((a, b) => Math.abs(b.t) - Math.abs(a.t))
const topHours = hourScores.slice(0, 6).map((x) => x.h)
console.log(pad('h', 4) + YEARS.map((y) => String(y).padStart(10)).join('') + '   t(IS)')
for (const h of topHours) {
  let row = pad(String(h), 4)
  for (const y of YEARS) {
    const v = bars.filter((b) => b.year === y && b.hUtc === h).map((b) => b.ret)
    row += fb(mean(v), 10)
  }
  console.log(row + ft(hourScores.find((x) => x.h === h)!.t).padStart(8))
}

// ---------- 2. jour de semaine ----------
H('2. JOUR DE SEMAINE (UTC) — bps/jour moyen [t] (rendements journaliers agrégés des 24 barres)')
const DOW = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam']
// rendement par jour calendaire = somme des rets horaires du jour
const dayRet = new Map<number, { ret: number; dow: number; year: number }>()
for (const b of bars) {
  const dk = Math.floor(b.t / DAY)
  const cur = dayRet.get(dk) ?? { ret: 0, dow: b.dowUtc, year: b.year }
  cur.ret += b.ret
  dayRet.set(dk, cur)
}
const days = [...dayRet.values()]
console.log(pad('jour', 6) + ERAS.map(([n]) => (n + ' (bps [t])').padStart(20)).join(''))
for (let d = 0; d < 7; d++) {
  let row = pad(DOW[d], 6)
  for (const era of ERAS) {
    const v = days.filter((x) => x.dow === d && x.year >= era[1] && x.year <= era[2]).map((x) => x.ret)
    const t = tstat(v)
    row += `${fb(mean(v))} [${ft(t)}]${flag(t)}`.padStart(20)
  }
  console.log(row)
}

// ---------- 3. cycle funding ----------
H('3. CYCLE FUNDING — bps/h moyen par position dans le cycle 8h (funding perp à 00/08/16 UTC)')
console.log('offset 0 = l’heure qui SUIT le timestamp de funding (00-01h, 08-09h, 16-17h UTC)')
console.log(pad('off', 5) + ERAS.map(([n]) => (n + ' (bps [t])').padStart(20)).join(''))
for (let off = 0; off < 8; off++) {
  let row = pad(String(off), 5)
  for (const era of ERAS) {
    const v = bars.filter((b) => inEra(b, era) && b.hUtc % 8 === off).map((b) => b.ret)
    const t = tstat(v)
    row += `${fb(mean(v))} [${ft(t)}]${flag(t)}`.padStart(20)
  }
  console.log(row)
}

// ---------- 4. vol par heure + weekend ----------
H('4. STRUCTURE DE VOL — |ret| moyen et range moyen par heure UTC (bps), IS-all')
console.log(pad('h', 4) + '|ret|'.padStart(8) + 'range'.padStart(8) + '   ' + pad('h', 4) + '|ret|'.padStart(8) + 'range'.padStart(8))
for (let h = 0; h < 12; h++) {
  const a = bars.filter((b) => b.hUtc === h)
  const b2 = bars.filter((b) => b.hUtc === h + 12)
  console.log(
    pad(String(h), 4) + ft(mean(a.map((x) => x.absRet))).padStart(8) + ft(mean(a.map((x) => x.rangeBps))).padStart(8) +
      '   ' + pad(String(h + 12), 4) + ft(mean(b2.map((x) => x.absRet))).padStart(8) + ft(mean(b2.map((x) => x.rangeBps))).padStart(8),
  )
}
console.log('\nweekend vs semaine (|ret| bps/h par année) :')
console.log(pad('année', 8) + 'semaine'.padStart(9) + 'weekend'.padStart(9) + 'ratio'.padStart(7))
for (const y of YEARS) {
  const wd = bars.filter((b) => b.year === y && b.dowUtc >= 1 && b.dowUtc <= 5).map((b) => b.absRet)
  const we = bars.filter((b) => b.year === y && (b.dowUtc === 0 || b.dowUtc === 6)).map((b) => b.absRet)
  console.log(pad(String(y), 8) + ft(mean(wd)).padStart(9) + ft(mean(we)).padStart(9) + (mean(we) / mean(wd)).toFixed(2).padStart(7))
}

// ---------- 5. continuation ----------
H('5. CONTINUATION — E[fwd | quintile du mouvement passé] (bps, close→close)')
const HORIZONS = [4, 8, 24, 48]
function contTable(pastW: number, filter: (b: Bar, i: number) => boolean, label: string, withCI = false) {
  // pastRet[i] = somme des rets (i-pastW, i] ; fwd_h[i] = somme (i, i+h]
  const past: number[] = new Array(bars.length).fill(NaN)
  let run = 0
  for (let i = 0; i < bars.length; i++) {
    run += bars[i].ret
    if (i >= pastW) run -= bars[i - pastW].ret
    if (i >= pastW - 1) past[i] = run
  }
  const idx: number[] = []
  for (let i = pastW - 1; i < bars.length - 48; i++) if (filter(bars[i], i)) idx.push(i)
  if (idx.length < 100) {
    console.log(`\n--- passé ${pastW}h · ${label} : n=${idx.length} — trop peu d'événements, sauté`)
    return
  }
  const sortedPast = idx.map((i) => past[i]).sort((a, b) => a - b)
  const q = (p: number) => sortedPast[Math.min(sortedPast.length - 1, Math.floor(p * sortedPast.length))]
  const cuts = [q(0.2), q(0.4), q(0.6), q(0.8)]
  const quint = (x: number) => (x < cuts[0] ? 0 : x < cuts[1] ? 1 : x < cuts[2] ? 2 : x < cuts[3] ? 3 : 4)

  console.log(`\n--- passé ${pastW}h · ${label} (n=${idx.length}) — quintiles du ret passé, bornes [${cuts.map((c) => c.toFixed(0)).join(', ')}] bps`)
  console.log(pad('Q', 4) + 'n'.padStart(7) + HORIZONS.map((h) => `fwd${h}h [t]`.padStart(19)).join(''))
  for (let Q = 0; Q < 5; Q++) {
    const qi = idx.filter((i) => quint(past[i]) === Q)
    let row = pad('Q' + (Q + 1), 4) + String(qi.length).padStart(7)
    for (const h of HORIZONS) {
      const v = qi.map((i) => {
        let s = 0
        for (let j = i + 1; j <= i + h; j++) s += bars[j].ret
        return s
      })
      const t = tstat(v)
      row += `${fb(mean(v))} [${ft(t)}]${flag(t)}`.padStart(19)
    }
    console.log(row)
    if (withCI && (Q === 0 || Q === 4)) {
      // IC bootstrap par blocs (chevauchement des fwd) pour les quintiles extrêmes
      let row2 = pad('  CI', 11)
      for (const h of HORIZONS) {
        const v = qi.map((i) => {
          let s = 0
          for (let j = i + 1; j <= i + h; j++) s += bars[j].ret
          return s
        })
        const [lo, hi] = blockCI(v, Math.ceil((2 * h * qi.length) / (bars.length - 0)) || 1)
        row2 += `[${fb(lo, 6)},${fb(hi, 6)}]`.padStart(19)
      }
      console.log(row2)
    }
  }
}
contTable(4, () => true, 'toutes barres', true)
contTable(24, () => true, 'toutes barres', true)
contTable(24, (b) => b.regime === 'bull', 'régime BULL (veille>EMA200 1d)')
contTable(24, (b) => b.regime === 'bear', 'régime BEAR')

// conjonctions pré-enregistrées (LOG.md §7 H3)
H('5b. CONJONCTIONS PRÉ-ENREGISTRÉES (bps fwd, avec IC bootstrap)')
function conj(label: string, filter: (b: Bar, i: number) => boolean) {
  const idx: number[] = []
  for (let i = 24; i < bars.length - 48; i++) if (filter(bars[i], i)) idx.push(i)
  let row = pad(label, 52) + String(idx.length).padStart(6)
  for (const h of HORIZONS) {
    const v = idx.map((i) => {
      let s = 0
      for (let j = i + 1; j <= i + h; j++) s += bars[j].ret
      return s
    })
    const t = tstat(v)
    row += `${fb(mean(v))}[${ft(t)}]${flag(t)}`.padStart(18)
  }
  console.log(row)
}
console.log(pad('condition', 52) + 'n'.padStart(6) + HORIZONS.map((h) => `fwd${h}h`.padStart(18)).join(''))
// impulsion = ret 4h dans le top-décile de l'IS
{
  const past4: number[] = new Array(bars.length).fill(NaN)
  let run = 0
  for (let i = 0; i < bars.length; i++) {
    run += bars[i].ret
    if (i >= 4) run -= bars[i - 4].ret
    if (i >= 3) past4[i] = run
  }
  const sorted = past4.filter(Number.isFinite).sort((a, b) => a - b)
  const p90 = sorted[Math.floor(0.9 * sorted.length)]
  const p10 = sorted[Math.floor(0.1 * sorted.length)]
  conj(`impulsion4h≥p90 (${p90.toFixed(0)}bps)`, (b, i) => past4[i] >= p90)
  conj('  … × flow10>0.5', (b, i) => past4[i] >= p90 && b.flow10 > 0.5)
  conj('  … × flow10>0.5 × bull', (b, i) => past4[i] >= p90 && b.flow10 > 0.5 && b.regime === 'bull')
  conj('  … × flow10<0.5 (divergence)', (b, i) => past4[i] >= p90 && b.flow10 < 0.5)
  conj(`miroir : impulsion4h≤p10 (${p10.toFixed(0)}bps)`, (b, i) => past4[i] <= p10)
  conj('  … × flow10<0.5 × bear', (b, i) => past4[i] <= p10 && b.flow10 < 0.5 && b.regime === 'bear')
}

// ---------- 6. sessions ----------
H('6. SESSIONS — bps/jour moyen [t] (somme des rets des barres de la fenêtre, une session = un jour)')
// une session = fenêtre [start, end) d'heures locales (tz 'utc' | 'ny') ; end > 24 = à cheval
// sur minuit. Clef de jour = date du début de session (décalage -start h) → une nuit 21→9
// compte comme UNE observation contiguë.
type Sess = { label: string; tz: 'utc' | 'ny'; start: number; end: number }
const SESSIONS: Sess[] = [
  { label: 'Asie 00-06 UTC', tz: 'utc', start: 0, end: 6 },
  { label: 'EU 07-13 UTC', tz: 'utc', start: 7, end: 13 },
  { label: 'US cash 9-16 NY', tz: 'ny', start: 9, end: 16 },
  { label: 'US after 16-21 NY', tz: 'ny', start: 16, end: 21 },
  { label: 'nuit US 21-9 NY', tz: 'ny', start: 21, end: 33 },
]
function sessionDays(s: Sess): Array<{ ret: number; year: number }> {
  const byDay = new Map<number, { ret: number; year: number }>()
  for (const b of bars) {
    const h = s.tz === 'utc' ? b.hUtc : b.hNy
    const hShift = h >= s.start ? h : h + 24
    if (hShift < s.start || hShift >= s.end) continue
    // date locale du DÉBUT de la session à laquelle la barre appartient
    const localMs = s.tz === 'utc' ? b.t : b.t + (b.hNy - b.hUtc <= 0 ? b.hNy - b.hUtc : b.hNy - b.hUtc - 24) * HOUR
    const dk = Math.floor((localMs - s.start * HOUR) / DAY)
    const cur = byDay.get(dk) ?? { ret: 0, year: b.year }
    cur.ret += b.ret
    byDay.set(dk, cur)
  }
  return [...byDay.values()]
}
console.log(pad('session', 20) + ERAS.map(([n]) => (n + ' (bps/j [t])').padStart(22)).join(''))
for (const s of SESSIONS) {
  const all = sessionDays(s)
  let row = pad(s.label, 20)
  for (const era of ERAS) {
    const v = all.filter((x) => x.year >= era[1] && x.year <= era[2]).map((x) => x.ret)
    const t = tstat(v)
    row += `${fb(mean(v))} [${ft(t)}]${flag(t)}`.padStart(22)
  }
  console.log(row)
}
console.log('\nsessions année par année (bps/jour) :')
console.log(pad('session', 20) + YEARS.map((y) => String(y).padStart(9)).join(''))
for (const s of SESSIONS) {
  const all = sessionDays(s)
  let row = pad(s.label, 20)
  for (const y of YEARS) row += fb(mean(all.filter((x) => x.year === y).map((x) => x.ret)), 9)
  console.log(row)
}

console.log('\nRappel coûts : un aller-retour taker = 30 bps ; maker+taker = 23 bps ; maker+maker = 16 bps.')
console.log('Une cellule n’est candidate que si la dérive conditionnelle dépasse ~45-60 bps par trade envisagé.')
process.exit(0)
