import { roundFp, type BacktestMetrics, type ParamSchema, type ParamValue, type ParamValues } from '@tpx/shared'

export interface OptimizeRange {
  from: number
  to: number
  step: number
}

/** per-param sweep: a numeric range or an explicit list of values */
export type OptimizeSpace = Record<string, OptimizeRange | ParamValue[]>

const MAX_COMBINATIONS = 200_000

function expandKey(def: OptimizeRange | ParamValue[]): ParamValue[] {
  if (Array.isArray(def)) return def
  if (def.step <= 0) throw new Error(`Invalid optimize step ${def.step}`)
  const out: ParamValue[] = []
  for (let v = def.from; v <= def.to + def.step * 1e-9; v += def.step) {
    out.push(roundFp(v))
    if (out.length > MAX_COMBINATIONS) break
  }
  return out
}

/**
 * Cartesian product of the sweep space, merged over base params.
 * Throws above MAX_COMBINATIONS — sweep fewer params or coarser steps.
 */
export function expandGrid(schema: ParamSchema, base: ParamValues, space: OptimizeSpace): ParamValues[] {
  const keys = Object.keys(space)
  for (const k of keys) {
    if (!(k in schema)) throw new Error(`Cannot optimize unknown param '${k}'`)
  }
  let combos: ParamValues[] = [{ ...base }]
  for (const key of keys) {
    const values = expandKey(space[key]!)
    if (values.length === 0) throw new Error(`Optimize space for '${key}' is empty`)
    const next: ParamValues[] = []
    for (const combo of combos) {
      for (const v of values) {
        next.push({ ...combo, [key]: v })
        if (next.length > MAX_COMBINATIONS) {
          throw new Error(`Grid exceeds ${MAX_COMBINATIONS} combinations — narrow the sweep`)
        }
      }
    }
    combos = next
  }
  return combos
}

export type Objective = 'netProfit' | 'sharpe' | 'sortino' | 'calmar' | 'profitFactor' | 'expectancy' | 'winRate'

/** Higher is better; null metrics (e.g. too few trades) score -Infinity. */
export function scoreMetrics(m: BacktestMetrics, objective: Objective): number {
  switch (objective) {
    case 'netProfit':
      return m.netProfitPct
    case 'sharpe':
      return m.sharpe ?? Number.NEGATIVE_INFINITY
    case 'sortino':
      return m.sortino ?? Number.NEGATIVE_INFINITY
    case 'calmar':
      return m.calmar ?? Number.NEGATIVE_INFINITY
    case 'profitFactor':
      return m.profitFactor ?? Number.NEGATIVE_INFINITY
    case 'expectancy':
      return m.expectancy
    case 'winRate':
      return m.winRate
  }
}
