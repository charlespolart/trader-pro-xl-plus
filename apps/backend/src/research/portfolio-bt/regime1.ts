/** portfolio-bt — stratégie REGIME1 (candidat n°1) : sleeve short-junk
 *  régimée. Réplique EXACTE de regime.py mode perp (variante jugée « perp
 *  intégral ») — la parité IS +0,89 / OOS +1,62 est la barre de vérité.
 *  Porte : médiane du funding quotidien des perps éligibles ≥ 2,5 bps/j.
 *  ON → short équipondéré du quintile funding-max (signal FLEVEL L3) +
 *  long BTC perp 1:1 (qui paie son funding). K = 7 j. Coûts 30 bps/côté. */
import { COST, MIN_ALIVE, TOPQ, WARMUP, type FundingPanel, type Panel } from './data'
import { argsortAsc, median, metrics, type Metrics } from './engine'

export const GATE_BPS = 2.5
export const K = 7
export const FLEVEL_L = 3

export interface Regime1Inputs {
  spot: Panel                  // panel univers (sélection/éligibilité)
  rExec: Float64Array          // rendements exécutés (perp si dispo, sinon spot)
  fund: FundingPanel
  btcR: Float64Array           // log-returns BTCUSDT perp
}

/** rendements exécutés : perp prioritaire, fallback spot (0 si rien) */
export function buildExecReturns(spot: Panel, perp: Panel): Float64Array {
  const { n, na } = spot
  const out = new Float64Array(n * na)
  for (let a = 0; a < na; a++) {
    for (let i = 1; i < n; i++) {
      const rp = Math.log(perp.px[i * na + a] / perp.px[(i - 1) * na + a])
      if (Number.isFinite(rp)) {
        out[i * na + a] = rp
        continue
      }
      const rs = Math.log(spot.px[i * na + a] / spot.px[(i - 1) * na + a])
      out[i * na + a] = Number.isFinite(rs) ? rs : 0
    }
  }
  return out
}

/** signal FLEVEL L3 hérité : S[t] = −Σ F[t−L+1..t] (NaN avant L) */
export function signalFlevel(fund: FundingPanel, n: number, na: number): Float64Array {
  const S = new Float64Array(n * na).fill(NaN)
  for (let a = 0; a < na; a++) {
    let acc = 0
    for (let i = 0; i < n; i++) {
      acc += fund.F[i * na + a]
      if (i >= FLEVEL_L) {
        acc -= fund.F[(i - FLEVEL_L) * na + a]
        S[i * na + a] = -acc
      } else if (i === FLEVEL_L - 1) {
        // t = L-1 : pas encore L jours pleins côté python (S défini à partir de t=L)
      }
    }
  }
  return S
}

/** état d'éligibilité au jour t (mêmes clauses que le python) */
function eligible(inp: Regime1Inputs, hist: Float64Array, t: number, a: number, needSignal: boolean, S?: Float64Array): boolean {
  const { na } = inp.spot
  const k = t * na + a
  if (needSignal && !(S && Number.isFinite(S[k]))) return false
  return Number.isFinite(inp.spot.px[k]) && hist[k] >= WARMUP
    && inp.fund.cnt[k] >= 21 && inp.fund.lastev[k] <= 2
}

/** série de porte : médiane du funding quotidien des éligibles (observable) */
export function gateSeries(inp: Regime1Inputs, hist: Float64Array): Float64Array {
  const { n, na } = inp.spot
  const g = new Float64Array(n).fill(NaN)
  for (let t = 0; t < n; t++) {
    const vals: number[] = []
    for (let a = 0; a < na; a++) {
      if (eligible(inp, hist, t, a, false)) vals.push(inp.fund.F[t * na + a])
    }
    if (vals.length >= MIN_ALIVE) g[t] = median(vals)
  }
  return g
}

export function histFinite(p: Panel): Float64Array {
  const { n, na, px } = p
  const h = new Float64Array(n * na)
  for (let a = 0; a < na; a++) {
    let c = 0
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(px[i * na + a])) c++
      h[i * na + a] = c
    }
  }
  return h
}

export interface Regime1Result extends Metrics {
  onShare: number
  daily: Float64Array
}

/** C3 perp intégral sur [lo, hi) — réplique portfolio_gated(r_exec, btc_f) */
export function runRegime1(inp: Regime1Inputs, lo: number, hi: number, costMult = 1): Regime1Result {
  const { n, na } = inp.spot
  const hist = histFinite(inp.spot)
  const g = gateSeries(inp, hist)
  const S = signalFlevel(inp.fund, n, na)
  const gateOn = new Uint8Array(n)
  for (let t = 0; t < n; t++) gateOn[t] = Number.isFinite(g[t]) && g[t] >= GATE_BPS / 1e4 ? 1 : 0
  const out = new Float64Array(hi - lo)
  const w = new Float64Array(na)
  let wBtc = 0
  let onDays = 0
  for (let t = lo; t < hi; t += K) {
    const neww = new Float64Array(na)
    let newBtc = 0
    if (gateOn[t]) {
      const idx: number[] = []
      for (let a = 0; a < na; a++) if (eligible(inp, hist, t, a, true, S)) idx.push(a)
      if (idx.length >= MIN_ALIVE) {
        const ntop = Math.max(1, Math.round(idx.length * TOPQ))
        const rowS = new Float64Array(na)
        for (const a of idx) rowS[a] = S[t * na + a]
        const order = argsortAsc(rowS, idx)
        for (let j = 0; j < ntop; j++) neww[order[j]] -= 1 / ntop   // short funding max
        newBtc = 1                                                   // long BTC 1:1
      }
    }
    let turn = Math.abs(newBtc - wBtc)
    for (let a = 0; a < na; a++) turn += Math.abs(neww[a] - w[a])
    out[t - lo] -= COST * costMult * turn
    w.set(neww)
    wBtc = newBtc
    const j1 = t + 1
    const j2 = Math.min(t + K, hi, n - 1) + 1
    for (let j = j1; j < j2; j++) {
      let pnl = 0
      for (let a = 0; a < na; a++) {
        const wa = w[a]
        if (wa !== 0) pnl += inp.rExec[j * na + a] * wa - inp.fund.F[j * na + a] * wa
      }
      if (wBtc !== 0) pnl += inp.btcR[j] * wBtc - inp.fund.btcDaily[j] * wBtc
      out[j - lo] += pnl
    }
  }
  for (let t = lo; t < hi; t++) if (gateOn[t]) onDays++
  const m = metrics(out)
  return { ...m, onShare: onDays / (hi - lo), daily: out }
}
