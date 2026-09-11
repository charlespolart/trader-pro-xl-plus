import { describe, expect, it } from 'bun:test'
import { listing2Step, type DayContext, type Listing2State } from '../src/portfolio/targets'
import { histFinite } from '../src/research/portfolio-bt/regime1'
import type { FundingPanel, Panel } from '../src/research/portfolio-bt/data'

/**
 * Bêtisier n°12 : 57 nuits de marche à blanc, 0 événement listing2 — non pas
 * parce qu'il n'y avait pas de listings, mais parce que le panel runtime
 * (univers ≥ 180 j, figé) ne contenait JAMAIS un symbole jeune. Ce test fixe
 * les deux faces : le détecteur ouvre bien un slot dès qu'un listing est
 * dans le panel, et il est structurellement aveugle sans lui.
 */
const DAY = 86_400_000
function panel(syms: string[], n: number, firstDay: number[]): Panel {
  const na = syms.length
  const ts = Float64Array.from({ length: n }, (_, i) => Date.UTC(2026, 6, 1) + i * DAY)
  const px = new Float64Array(n * na).fill(NaN)
  for (let a = 0; a < na; a++) for (let i = firstDay[a]!; i < n; i++) px[i * na + a] = 100 + i
  return { ts, syms, px, n, na }
}
function funding(spot: Panel, nonZeroFor: Set<number>): FundingPanel {
  const { n, na } = spot
  const F = new Float64Array(n * na)
  for (const a of nonZeroFor) for (let i = 0; i < n; i++) F[i * na + a] = 0.0003
  return { F, cnt: new Float64Array(n * na), lastev: new Float64Array(n * na), btcDaily: new Float64Array(n) }
}
const ctxOf = (spot: Panel, fund: FundingPanel): DayContext => ({ t: spot.n - 1, spot, perp: spot, fund, hist: histFinite(spot) })
const fresh = (): Listing2State => ({ slots: [], seen: new Set() })

describe('listing2Step — détection des nouveaux listings', () => {
  it('ouvre un slot pour un symbole listé il y a 2 jours dont le perp a du funding', () => {
    const spot = panel(['OLDUSDT', 'NEWUSDT'], 20, [0, 17])
    const dec = listing2Step(ctxOf(spot, funding(spot, new Set([0, 1]))), fresh(), () => 0)
    expect(dec.open.map((s) => s.symbol)).toEqual(['NEWUSDT'])
  })

  it('n’ouvre rien pour un symbole ancien, même avec du funding', () => {
    const spot = panel(['OLDUSDT'], 20, [0])
    const dec = listing2Step(ctxOf(spot, funding(spot, new Set([0]))), fresh(), () => 0)
    expect(dec.open).toHaveLength(0)
  })

  it('aveugle par construction si le listing n’est pas dans le panel (le bug vécu)', () => {
    // même marché, mais le panel « univers ≥ 180 j » ne contient que l’ancien
    const spot = panel(['OLDUSDT'], 20, [0])
    const dec = listing2Step(ctxOf(spot, funding(spot, new Set([0]))), fresh(), () => 0)
    expect(dec.open).toHaveLength(0)
    expect(dec.note).toBe('0 tenus, 0 ouverts, 0 fermés')
  })

  it('un listing sans perp est marqué vu après J+7 et jamais ouvert', () => {
    const spot = panel(['OLDUSDT', 'NEWUSDT'], 20, [0, 10]) // listé il y a 9 jours, funding nul
    const st = fresh()
    const dec = listing2Step(ctxOf(spot, funding(spot, new Set([0]))), st, () => 0)
    expect(dec.open).toHaveLength(0)
    expect(st.seen.has(1)).toBe(true)
  })
})
