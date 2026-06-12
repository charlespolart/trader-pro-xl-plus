/**
 * Indicateurs non standard — régime de marché et flux d'ordres.
 * Spécifiques à nos données : les bougies Binance portent takerBuyBase
 * (volume acheté en taker), un proxy d'order-flow que les bibliothèques
 * d'indicateurs classiques ignorent.
 */
import { defineIndicator } from './types'
import { smaStream } from './streams'
import { atr } from './volatility'

/**
 * Flux taker : part du volume exécutée par des acheteurs agressifs, lissée.
 * ∈ [0, 1] — > 0.5 : les acheteurs traversent le spread (pression d'achat
 * réelle), < 0.5 : les vendeurs dominent. Divergence prix/flux = absorption.
 */
export const takerFlow = (period = 20) =>
  defineIndicator({
    id: `takerflow(${period})`,
    warmup: period,
    defaultPlot: 'pane',
    defaultColors: { value: '#29b6f6' },
    create: () => {
      const s = smaStream(period)
      return (c) => s(c.volume > 0 ? c.takerBuyBase / c.volume : 0.5)
    },
  })

/**
 * Efficiency Ratio de Kaufman : |variation nette| / somme des |variations|.
 * ∈ [0, 1] — proche de 1 : marché directionnel efficace ; proche de 0 : bruit.
 * Filtre de régime : suivre la tendance quand ER est haut, mean-reverter
 * quand il est bas.
 */
export const efficiencyRatio = (period = 10) =>
  defineIndicator({
    id: `er(${period})`,
    warmup: period + 1,
    defaultPlot: 'pane',
    create: () => {
      const closes: number[] = []
      return (c) => {
        closes.push(c.close)
        if (closes.length > period + 1) closes.shift()
        if (closes.length < period + 1) return null
        const net = Math.abs(closes[closes.length - 1]! - closes[0]!)
        let sum = 0
        for (let i = 1; i < closes.length; i++) sum += Math.abs(closes[i]! - closes[i - 1]!)
        return sum === 0 ? 0 : net / sum
      }
    },
  })

/**
 * Percentile de volatilité : rang percentile de l'ATR relatif (ATR/close)
 * sur `lookback` bougies. ∈ [0, 100] — régime calme (< 30) vs explosif (> 70).
 */
export const atrPercentile = (atrPeriod = 14, lookback = 100) =>
  defineIndicator({
    id: `atrpct(${atrPeriod},${lookback})`,
    warmup: atrPeriod + lookback + 1,
    defaultPlot: 'pane',
    create: () => {
      const atrInst = atr(atrPeriod).create()
      const hist: number[] = []
      return (c) => {
        const a = atrInst.update(c)
        if (a === null || c.close <= 0) return null
        const rel = a / c.close
        hist.push(rel)
        if (hist.length > lookback) hist.shift()
        if (hist.length < lookback) return null
        let below = 0
        for (const v of hist) if (v <= rel) below++
        return (below / hist.length) * 100
      }
    },
  })

/**
 * Ratio de compression : largeur Bollinger / largeur Keltner.
 * < 1 : squeeze (la volatilité se comprime — une expansion suit souvent) ;
 * la sortie du squeeze donne le timing, la direction vient d'ailleurs.
 */
export const squeezeRatio = (period = 20, bbMult = 2, kcMult = 1.5, atrPeriod = 10) =>
  defineIndicator({
    id: `squeeze(${period},${bbMult},${kcMult})`,
    warmup: Math.max(period, atrPeriod) + 1,
    defaultPlot: 'pane',
    create: () => {
      const sma = smaStream(period)
      const atrInst = atr(atrPeriod).create()
      const buf: number[] = []
      return (c) => {
        const m = sma(c.close)
        const a = atrInst.update(c)
        buf.push(c.close)
        if (buf.length > period) buf.shift()
        if (m === null || a === null || buf.length < period) return null
        let v = 0
        for (const x of buf) v += (x - m) ** 2
        const sd = Math.sqrt(v / period)
        const kcWidth = 2 * kcMult * a
        return kcWidth === 0 ? null : (2 * bbMult * sd) / kcWidth
      }
    },
  })
