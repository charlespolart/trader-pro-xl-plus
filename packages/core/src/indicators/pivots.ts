/**
 * Moteur de pivots / structure de swings — no-lookahead par construction.
 *
 * Un pivot haut fractal à la barre i n'est CONNU qu'à la barre i+right : le
 * détecteur ne le publie qu'à ce moment-là (`confirmedAtIndex = barIndex +
 * right`). Toute logique bâtie dessus hérite donc d'un retard de confirmation
 * explicite de `right` barres — c'est le prix de l'absence de lookahead, et il
 * est visible dans les types plutôt que caché.
 *
 * Convention d'égalité : côté gauche STRICT (`>` / `<`), côté droit non strict
 * (`>=` / `<=`) — en cas de plateau d'extrêmes égaux, la PREMIÈRE barre du
 * plateau est le pivot ; un plateau ne produit jamais deux pivots.
 *
 * ⚠ La valeur produite est un objet d'état MUTÉ en place (comme une liste de
 * zones) : l'historique `handle.at(n)` n'a pas de sens pour cet indicateur —
 * ne lire que l'état courant.
 *
 * `zigzag` empile au-dessus des pivots confirmés une structure alternée
 * haut/bas filtrée par amplitude minimale (en multiples d'ATR) : les
 * micro-swings sont absorbés. Le DERNIER point zigzag peut être remplacé par
 * un extrême plus fort de même sens (comportement standard) — mais uniquement
 * sur la base de pivots déjà confirmés, jamais rétroactivement au-delà.
 */
import { defineIndicator } from './types'
import { rmaStream } from './streams'

export interface Pivot {
  /** index de la barre pivot (0 = première barre vue par l'instance) */
  barIndex: number
  openTime: number
  /** high de la barre pour un pivot haut, low pour un pivot bas */
  price: number
  kind: 'high' | 'low'
  /** barre à laquelle le pivot est devenu connu (= barIndex + right) */
  confirmedAtIndex: number
  confirmedAtTime: number
}

export interface PivotState {
  /** pivots confirmés, ordre chronologique de confirmation */
  pivots: Pivot[]
  lastHigh: Pivot | null
  lastLow: Pivot | null
  /** index de la barre courante (nombre d'updates - 1) */
  barIndex: number
}

/**
 * Pivots fractals left/right. Warmup = left+right+1 (première confirmation
 * possible). Publie l'état complet ; les nouveaux pivots apparaissent dans
 * `pivots` exactement à leur barre de confirmation.
 */
export const fractalPivots = (left = 5, right = 5) =>
  defineIndicator<PivotState>({
    id: `pivots(${left},${right})`,
    warmup: left + right + 1,
    defaultPlot: 'markers',
    hiddenOutputs: ['value'],
    create: () => {
      // fenêtre glissante des left+right+1 dernières barres
      const win: Array<{ high: number; low: number; openTime: number }> = []
      const state: PivotState = { pivots: [], lastHigh: null, lastLow: null, barIndex: -1 }
      return (c) => {
        state.barIndex++
        win.push({ high: c.high, low: c.low, openTime: c.openTime })
        if (win.length > left + right + 1) win.shift()
        if (win.length < left + right + 1) return null
        // candidat = barre au centre de la fenêtre, i.e. il y a `right` barres
        const p = win[left]
        const candIndex = state.barIndex - right
        let isHigh = true
        let isLow = true
        for (let k = 0; k < win.length; k++) {
          if (k === left) continue
          const strict = k < left // gauche strict, droite non stricte
          if (strict ? win[k].high >= p.high : win[k].high > p.high) isHigh = false
          if (strict ? win[k].low <= p.low : win[k].low < p.low) isLow = false
          if (!isHigh && !isLow) break
        }
        if (isHigh) {
          const piv: Pivot = {
            barIndex: candIndex,
            openTime: p.openTime,
            price: p.high,
            kind: 'high',
            confirmedAtIndex: state.barIndex,
            confirmedAtTime: c.openTime,
          }
          state.pivots.push(piv)
          state.lastHigh = piv
        }
        if (isLow) {
          const piv: Pivot = {
            barIndex: candIndex,
            openTime: p.openTime,
            price: p.low,
            kind: 'low',
            confirmedAtIndex: state.barIndex,
            confirmedAtTime: c.openTime,
          }
          state.pivots.push(piv)
          state.lastLow = piv
        }
        return state
      }
    },
  })

export interface ZigzagPoint extends Pivot {
  /** amplitude de la jambe qui ABOUTIT à ce point, en multiples d'ATR à la confirmation */
  legAtrMult: number
}

export interface ZigzagState {
  /** points alternés haut/bas confirmés ; le DERNIER peut encore être remplacé */
  points: ZigzagPoint[]
  /** direction de la jambe en cours (vers le prochain point probable) */
  direction: 'up' | 'down' | null
  barIndex: number
}

/**
 * Zigzag à seuil ATR au-dessus des pivots fractals : un renversement n'est
 * accepté que si la jambe fait ≥ minAtrMult × ATR(atrPeriod) ; un pivot de
 * même sens plus extrême REMPLACE le dernier point (extension de jambe).
 * Structure HH/HL/LH/LL lisible en comparant les 2 derniers points de même
 * sens.
 */
export const zigzag = (left = 5, right = 5, minAtrMult = 1.5, atrPeriod = 14) =>
  defineIndicator<ZigzagState>({
    id: `zigzag(${left},${right},${minAtrMult},${atrPeriod})`,
    warmup: Math.max(left + right + 1, atrPeriod + 1),
    defaultPlot: 'markers',
    hiddenOutputs: ['value'],
    create: () => {
      const pivotsUpdate = fractalPivots(left, right).create()
      const atrS = rmaStream(atrPeriod)
      let prevClose: number | null = null
      let seenPivots = 0
      const state: ZigzagState = { points: [], direction: null, barIndex: -1 }
      return (c) => {
        state.barIndex++
        const tr =
          prevClose === null
            ? c.high - c.low
            : Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose))
        prevClose = c.close
        const atrV = atrS(tr)
        const ps = pivotsUpdate.update(c)
        if (!ps || atrV === null) return null
        // ne traiter que les pivots confirmés depuis le dernier update
        for (; seenPivots < ps.pivots.length; seenPivots++) {
          const piv = ps.pivots[seenPivots]
          const pts = state.points
          const last = pts[pts.length - 1]
          if (!last) {
            pts.push({ ...piv, legAtrMult: 0 })
            state.direction = piv.kind === 'low' ? 'up' : 'down'
            continue
          }
          if (piv.kind === last.kind) {
            // même sens : extension de jambe si plus extrême
            const better = piv.kind === 'high' ? piv.price > last.price : piv.price < last.price
            if (better) {
              const from = pts[pts.length - 2]
              const amp = from ? Math.abs(piv.price - from.price) / atrV : 0
              pts[pts.length - 1] = { ...piv, legAtrMult: amp }
              state.direction = piv.kind === 'high' ? 'down' : 'up'
            }
            continue
          }
          // sens opposé : renversement seulement si la jambe est assez grande
          const amp = Math.abs(piv.price - last.price) / atrV
          if (amp >= minAtrMult) {
            pts.push({ ...piv, legAtrMult: amp })
            state.direction = piv.kind === 'high' ? 'down' : 'up'
          }
        }
        return state
      }
    },
  })
