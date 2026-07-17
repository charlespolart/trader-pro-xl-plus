/** portfolio-bt — moteur commun : métriques (convention log de la
 *  recherche), helpers numériques répliquant numpy à l'identique. */

export interface Metrics {
  sharpe: number
  cagr: number
  dd: number
  calmar: number
}

/** identique à xsection_u.metrics : daily = log-ish returns, 365 j/an */
export function metrics(daily: Float64Array): Metrics {
  const n = daily.length
  let mu = 0
  for (let i = 0; i < n; i++) mu += daily[i]
  mu /= n
  let v = 0
  for (let i = 0; i < n; i++) v += (daily[i] - mu) ** 2
  const sd = Math.sqrt(v / (n - 1))
  const sharpe = sd > 0 ? (mu / sd) * Math.sqrt(365) : NaN
  let cum = 0
  let peak = 1
  let dd = 0
  let eq = 1
  for (let i = 0; i < n; i++) {
    cum += daily[i]
    eq = Math.exp(cum)
    if (eq > peak) peak = eq
    const d = (peak - eq) / peak
    if (d > dd) dd = d
  }
  const cagr = (eq ** (365 / n) - 1) * 100
  const ddPct = dd * 100
  return { sharpe, cagr, dd: ddPct, calmar: ddPct > 0 ? cagr / ddPct : NaN }
}

/** np.searchsorted(ts, v) côté gauche */
export function searchsorted(ts: Float64Array, v: number): number {
  let lo = 0
  let hi = ts.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (ts[mid] < v) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** médiane numpy (moyenne des 2 du milieu si n pair) */
export function median(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y)
  const n = a.length
  if (n === 0) return NaN
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2
}

/** argsort croissant stable (ties par index — assez proche de numpy pour
 *  des floats de funding ; la parité chiffrée est la barre de vérité) */
export function argsortAsc(values: Float64Array, idx: number[]): number[] {
  return [...idx].sort((a, b) => (values[a] - values[b]) || (a - b))
}

export function dateMs(s: string): number {
  return Date.parse(`${s}T00:00:00Z`)
}

export const IS_START = dateMs('2020-07-01')
export const IS_END = dateMs('2024-01-01')
export const OOS_END = dateMs('2026-07-01')
