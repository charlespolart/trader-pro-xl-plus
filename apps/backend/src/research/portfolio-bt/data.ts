/** portfolio-bt — chargements de données alignées (recherche pure, lit la
 *  base 5438 + le CSV funding canonique). Conventions IDENTIQUES aux
 *  scripts python de validation (xsection_u/carry/regime) — la parité des
 *  backtests TS↔python est exigée avant tout usage. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postgres from 'postgres'

export const DB_URL = process.env.RESEARCH_DB ?? 'postgres://tpx:tpx@localhost:5438/tpx'
export const WARMUP = 91
export const MIN_ALIVE = 30
export const TOPQ = 0.30
export const COST = 0.003
export const DAY = 86_400_000

export interface Panel {
  ts: Float64Array            // open_time ms, croissant
  syms: string[]
  /** closes [t * na + a], NaN si absent */
  px: Float64Array
  n: number
  na: number
}

export async function universeSymbols(sql: postgres.Sql): Promise<string[]> {
  const rows = await sql.unsafe(
    `SELECT symbol FROM candles WHERE market='spot' AND interval='1d'
     AND symbol LIKE '%USDT' GROUP BY 1 HAVING count(*) >= 180 ORDER BY 1`,
  )
  return rows.map((r) => r.symbol as string).filter((s) => s !== 'BTCUSDT' && s !== 'ETHUSDT')
}

export async function loadPanel(sql: postgres.Sql, syms: string[], market: 'spot' | 'futures', tsRef?: Float64Array): Promise<Panel> {
  const rows = await sql.unsafe(
    `SELECT symbol, open_time, close FROM candles WHERE market='${market}' AND interval='1d'
     AND symbol = ANY($1) ORDER BY symbol, open_time`, [syms],
  )
  let ts: Float64Array
  if (tsRef) {
    ts = tsRef
  } else {
    const set = new Set<number>()
    for (const r of rows) set.add(Number(r.open_time))
    ts = Float64Array.from([...set].sort((a, b) => a - b))
  }
  const tidx = new Map<number, number>()
  ts.forEach((t, i) => tidx.set(t, i))
  const sidx = new Map(syms.map((s, i) => [s, i]))
  const n = ts.length
  const na = syms.length
  const px = new Float64Array(n * na).fill(NaN)
  for (const r of rows) {
    const i = tidx.get(Number(r.open_time))
    const a = sidx.get(r.symbol as string)
    if (i !== undefined && a !== undefined) px[i * na + a] = Number(r.close)
  }
  return { ts, syms, px, n, na }
}

/** log-returns d'une série BTC alignée (0 si non fini) — regime.load_btc */
export async function loadBtcReturns(sql: postgres.Sql, ts: Float64Array, market: 'spot' | 'futures'): Promise<Float64Array> {
  const rows = await sql.unsafe(
    `SELECT open_time, close FROM candles WHERE market='${market}' AND symbol='BTCUSDT'
     AND interval='1d' ORDER BY open_time`,
  )
  const d = new Map<number, number>()
  for (const r of rows) d.set(Number(r.open_time), Number(r.close))
  const n = ts.length
  const px = new Float64Array(n)
  for (let i = 0; i < n; i++) px[i] = d.get(ts[i]) ?? NaN
  const out = new Float64Array(n)
  for (let i = 1; i < n; i++) {
    const v = Math.log(px[i] / px[i - 1])
    out[i] = Number.isFinite(v) ? v : 0
  }
  return out
}

export interface FundingPanel {
  F: Float64Array             // somme quotidienne des taux [t*na+a]
  cnt: Float64Array           // événements cumulés vus (~3/jour agrégé)
  lastev: Float64Array        // jours depuis le dernier événement (∞ avant)
  btcDaily: Float64Array      // funding quotidien BTCUSDT
}

/** source canonique = funding_daily_all.csv (parité python) ; le runtime
 *  live lira PG/API à la place — même agrégation quotidienne. */
export function loadFunding(csvPath: string, syms: string[], ts: Float64Array): FundingPanel {
  const sidx = new Map(syms.map((s, i) => [s, i]))
  const tidx = new Map<number, number>()
  ts.forEach((t, i) => tidx.set(t, i))
  const n = ts.length
  const na = syms.length
  const F = new Float64Array(n * na)
  const seen = new Uint8Array(n * na)
  const btcDaily = new Float64Array(n)
  const raw = readFileSync(csvPath, 'utf8')
  let pos = 0
  while (pos < raw.length) {
    const nl = raw.indexOf('\n', pos)
    const line = raw.slice(pos, nl === -1 ? raw.length : nl)
    pos = nl === -1 ? raw.length : nl + 1
    if (!line) continue
    const c1 = line.indexOf(',')
    const c2 = line.indexOf(',', c1 + 1)
    const s = line.slice(0, c1)
    const t = Number(line.slice(c1 + 1, c2))
    const rate = Number(line.slice(c2 + 1))
    const i = tidx.get(t)
    if (i === undefined) continue
    if (s === 'BTCUSDT') btcDaily[i] = rate
    const a = sidx.get(s)
    if (a === undefined) continue
    F[i * na + a] = rate
    seen[i * na + a] = 1
  }
  const cnt = new Float64Array(n * na)
  const lastev = new Float64Array(n * na).fill(Infinity)
  for (let a = 0; a < na; a++) {
    let c = 0
    let last = -Infinity
    for (let i = 0; i < n; i++) {
      if (seen[i * na + a]) {
        c += 3
        last = i
      }
      cnt[i * na + a] = c
      lastev[i * na + a] = i - last
    }
  }
  return { F, cnt, lastev, btcDaily }
}

export function fundingCsvPath(): string {
  return resolve(import.meta.dir, '../xsection1/funding_daily_all.csv')
}

export function connect(): postgres.Sql {
  return postgres(DB_URL, { max: 4, prepare: false })
}
