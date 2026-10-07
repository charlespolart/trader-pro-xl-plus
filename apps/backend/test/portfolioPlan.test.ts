import { describe, expect, it } from 'bun:test'
import { planRebalance, type OkxInstrument } from '../src/portfolio/okxPortfolioAdapter'

/** Règles issues de la marche à blanc regime1 (PASSATION n°12 / n°14). */
const inst = (instId: string, last: number, lotSz = 1, minSz = 1, ctVal = 1): [string, OkxInstrument] => [instId, { instId, ctVal, lotSz, minSz, last }]
const SLEEVE = 6000

describe('planRebalance — hedge BTC au prorata des jambes tenues', () => {
  it('1:1 quand toutes les jambes sont exécutables', () => {
    const w = new Map([['AAAUSDT', -0.5], ['BBBUSDT', -0.5]])
    const ins = new Map([inst('AAA-USDT-SWAP', 10), inst('BBB-USDT-SWAP', 2), inst('BTC-USDT-SWAP', 60000, 0.01, 0.01, 0.01)])
    const p = planRebalance(w, 1, SLEEVE, new Map(), ins)
    const btc = p.orders.find((o) => o.instId === 'BTC-USDT-SWAP')!
    expect(btc.side).toBe('buy')
    expect(btc.notionalUsd).toBeGreaterThan(5900)
    expect(p.skipped).toHaveLength(0)
  })

  it('la moitié des jambes saute (pas de perp OKX) → le hedge BTC est divisé par deux', () => {
    const w = new Map([['AAAUSDT', -0.5], ['BBBUSDT', -0.5]])
    const ins = new Map([inst('AAA-USDT-SWAP', 10), inst('BTC-USDT-SWAP', 60000, 0.01, 0.01, 0.01)]) // BBB absent
    const p = planRebalance(w, 1, SLEEVE, new Map(), ins)
    const btc = p.orders.find((o) => o.instId === 'BTC-USDT-SWAP')!
    expect(p.skipped.map((s) => s.instId)).toEqual(['BBB-USDT-SWAP'])
    expect(btc.notionalUsd).toBeLessThan(3100)
    expect(btc.notionalUsd).toBeGreaterThan(2900)
    expect(Math.abs(p.grossTargetUsd - 6000)).toBeLessThan(100) // 3000 short + 3000 long
  })

  it('aucune jambe exécutable → aucun hedge (plus jamais « long BTC seul »)', () => {
    const w = new Map([['AAAUSDT', -1]])
    const ins = new Map([inst('BTC-USDT-SWAP', 60000, 0.01, 0.01, 0.01)])
    const p = planRebalance(w, 1, SLEEVE, new Map(), ins)
    expect(p.orders).toHaveLength(0)
    expect(p.grossTargetUsd).toBe(0)
  })

  it('jambes déjà tenues : le hedge compte les positions existantes', () => {
    const w = new Map([['AAAUSDT', -1]])
    const held = new Map([['AAA-USDT-SWAP', -6000], ['BTC-USDT-SWAP', 6000]])
    const ins = new Map([inst('AAA-USDT-SWAP', 10), inst('BTC-USDT-SWAP', 60000, 0.01, 0.01, 0.01)])
    const p = planRebalance(w, 1, SLEEVE, held, ins)
    expect(p.orders).toHaveLength(0) // rien à faire, tout est tenu
    expect(p.grossTargetUsd).toBe(12000)
  })
})

describe('planRebalance — clôture TOTALE sans miette', () => {
  it('cible 0 → ordre de clôture au notional exact, closeAll, quel que soit le lot', () => {
    const held = new Map([['AAA-USDT-SWAP', -68.95], ['BTC-USDT-SWAP', 68.95]])
    const ins = new Map([inst('AAA-USDT-SWAP', 7.3, 1, 1), inst('BTC-USDT-SWAP', 60000, 0.01, 0.01, 0.01)])
    const p = planRebalance(new Map(), 0, SLEEVE, held, ins)
    const aaa = p.orders.find((o) => o.instId === 'AAA-USDT-SWAP')!
    expect(aaa.side).toBe('buy')
    expect(aaa.closeAll).toBe(true)
    expect(aaa.notionalUsd).toBe(68.95) // l'ancien delta arrondi au lot aurait laissé ~4 $
    const btc = p.orders.find((o) => o.instId === 'BTC-USDT-SWAP')!
    expect(btc.closeAll).toBe(true)
    expect(btc.notionalUsd).toBe(68.95)
    expect(p.grossTargetUsd).toBe(0)
  })

  it('une position tenue sans instrument OKX est signalée, pas oubliée', () => {
    const held = new Map([['ZZZ-USDT-SWAP', -50]])
    const p = planRebalance(new Map(), 0, SLEEVE, held, new Map())
    expect(p.skipped[0]!.why).toContain('indisponible')
  })
})
