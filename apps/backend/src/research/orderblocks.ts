/**
 * Order blocks (SMC) formalisés en règles mécaniques testables.
 *
 * Définition : la dernière bougie contraire avant une impulsion forte
 * (≥ impulseAtrMult × ATR en impulseBars bougies, efficacité ≥ minEfficiency,
 * avec cassure de structure optionnelle). La zone [low, high] de cette bougie
 * reste active jusqu'à invalidation (clôture au-delà), expiration, ou
 * consommation (premier retest).
 *
 * Implémenté en indicateur (et non dans onCandle) pour que les zones se
 * construisent aussi pendant le warmup. La valeur est la liste MUTABLE des
 * zones actives — la stratégie marque `consumed` elle-même.
 */
import { defineIndicator, type IndicatorSpec } from '@tpx/core'
import { atr as atrIndicator } from '@tpx/core'
import type { Candle } from '@tpx/shared'

export interface ObZone {
  /** 1 = bullish (demande), -1 = bearish (offre) */
  side: 1 | -1
  high: number
  low: number
  createdTime: number
  createdIdx: number
  consumed: boolean
}

export interface ObOptions {
  /** longueur de l'impulsion (bougies) */
  impulseBars: number
  /** amplitude minimale de l'impulsion en multiples d'ATR */
  impulseAtrMult: number
  /** efficacité minimale du mouvement (|net| / Σ|Δ|) — élimine le bruit */
  minEfficiency: number
  /** la clôture doit casser le plus haut/bas des N bougies pré-impulsion (0 = off) */
  bosLookback: number
  /** distance max (bougies) entre la bougie OB et le départ de l'impulsion */
  obSearchBars: number
  /** durée de vie d'une zone (bougies) */
  expiryBars: number
  maxZones: number
  /** zone = corps de la bougie plutôt que son range complet */
  bodyOnly: boolean
  atrPeriod: number
}

export const DEFAULT_OB: ObOptions = {
  impulseBars: 3,
  impulseAtrMult: 3,
  minEfficiency: 0.65,
  bosLookback: 20,
  obSearchBars: 3,
  expiryBars: 120,
  maxZones: 6,
  bodyOnly: false,
  atrPeriod: 14,
}

export function orderBlocks(opts: Partial<ObOptions> = {}): IndicatorSpec<ObZone[]> {
  const o: ObOptions = { ...DEFAULT_OB, ...opts }
  const keep = o.impulseBars + o.obSearchBars + o.bosLookback + 2

  return defineIndicator<ObZone[]>({
    id: `ob(${o.impulseBars},${o.impulseAtrMult},${o.bodyOnly ? 'body' : 'range'})`,
    warmup: Math.max(keep, o.atrPeriod + 1),
    defaultPlot: 'overlay', // jamais tracé (objets) — utiliser { plot: 'none' }
    create: () => {
      const atrInst = atrIndicator(o.atrPeriod).create()
      const buf: Candle[] = []
      const zones: ObZone[] = []
      let idx = -1

      const overlaps = (side: 1 | -1, low: number, high: number): boolean =>
        zones.some((z) => z.side === side && low <= z.high && high >= z.low)

      const detect = (side: 1 | -1, a: number, c: Candle): void => {
        const n = buf.length
        const startIdx = n - 1 - o.impulseBars
        if (startIdx < o.bosLookback + o.obSearchBars) return
        const move = (c.close - buf[startIdx]!.close) * side
        if (move < o.impulseAtrMult * a) return
        // efficacité du mouvement
        let sum = 0
        for (let i = startIdx + 1; i < n; i++) sum += Math.abs(buf[i]!.close - buf[i - 1]!.close)
        if (sum <= 0 || move / sum < o.minEfficiency) return
        // cassure de structure : clôture au-delà de l'extrême pré-impulsion
        if (o.bosLookback > 0) {
          let extreme = side === 1 ? -Infinity : Infinity
          for (let i = startIdx - o.bosLookback; i < startIdx; i++) {
            extreme = side === 1 ? Math.max(extreme, buf[i]!.high) : Math.min(extreme, buf[i]!.low)
          }
          if (side === 1 ? c.close <= extreme : c.close >= extreme) return
        }
        // la dernière bougie CONTRAIRE avant l'impulsion = l'order block
        for (let i = startIdx; i > startIdx - o.obSearchBars; i--) {
          const ob = buf[i]!
          const contrary = side === 1 ? ob.close < ob.open : ob.close > ob.open
          if (!contrary) continue
          const low = o.bodyOnly ? Math.min(ob.open, ob.close) : ob.low
          const high = o.bodyOnly ? Math.max(ob.open, ob.close) : ob.high
          if (high <= low || overlaps(side, low, high)) return
          zones.push({ side, low, high, createdTime: c.openTime, createdIdx: idx, consumed: false })
          if (zones.length > o.maxZones) zones.shift()
          return
        }
      }

      return (c) => {
        idx++
        const a = atrInst.update(c)
        buf.push(c)
        if (buf.length > keep + 8) buf.splice(0, buf.length - keep)

        // invalidation / expiration
        for (let i = zones.length - 1; i >= 0; i--) {
          const z = zones[i]!
          const invalid = z.side === 1 ? c.close < z.low : c.close > z.high
          if (invalid || z.consumed || idx - z.createdIdx > o.expiryBars) zones.splice(i, 1)
        }

        if (a !== null && buf.length >= keep) {
          detect(1, a, c)
          detect(-1, a, c)
        }
        return zones
      }
    },
  })
}
