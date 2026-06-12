/**
 * Indicateurs maison partagés entre stratégies.
 * Les fichiers préfixés par _ ne sont pas chargés comme stratégies.
 */
import { defineIndicator, emaStream } from '@tpx/core'

/**
 * EMA Cross : deux EMA + un signal de croisement.
 * Sorties :
 *   - fast / slow : les deux EMA (tracées en overlay)
 *   - cross : +1 croisement haussier sur cette bougie, -1 baissier, 0 sinon
 *             (sortie masquée sur la chart — c'est un signal, pas une courbe)
 */
export const emaCross = (fast: number, slow: number) =>
  defineIndicator<{ fast: number; slow: number; cross: number }>({
    id: `emacross(${fast},${slow})`,
    outputs: ['fast', 'slow', 'cross'],
    hiddenOutputs: ['cross'],
    warmup: slow + 2,
    defaultPlot: 'overlay',
    defaultColors: { fast: '#2962ff', slow: '#ff6d00' },
    create: () => {
      const f = emaStream(fast)
      const s = emaStream(slow)
      let prevDiff: number | null = null
      return (candle) => {
        const fv = f(candle.close)
        const sv = s(candle.close)
        if (fv === null || sv === null) return null
        const diff = fv - sv
        let cross = 0
        if (prevDiff !== null) {
          if (prevDiff <= 0 && diff > 0) cross = 1
          else if (prevDiff >= 0 && diff < 0) cross = -1
        }
        prevDiff = diff
        return { fast: fv, slow: sv, cross }
      }
    },
  })
