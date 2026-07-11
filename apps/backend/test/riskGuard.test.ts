import { describe, expect, it } from 'bun:test'
import type { Balance, Order, OrderRequest, Position, SymbolInfo } from '@tpx/shared'
import { RiskGuardedAdapter, type OrderBlock } from '../src/services/botManager'

// Adaptateur factice : enregistre ce qui atteint réellement l'exchange.
function fakeInner() {
  const submitted: OrderRequest[] = []
  const adapter = {
    market: 'spot' as const,
    symbol: 'BTCUSDT',
    now: () => 0,
    lastPrice: () => 100,
    submit: async (req: OrderRequest): Promise<Order> => {
      submitted.push(req)
      return { id: 'x' } as Order
    },
    cancel: async (): Promise<Order | null> => null,
    openOrders: (): readonly Order[] => [],
    position: (): Position => ({ qty: 0, entryPrice: 0 }) as Position,
    balances: (): readonly Balance[] => [],
    equity: () => 0,
    symbolInfo: (): SymbolInfo | null => null,
  }
  return { adapter, submitted }
}

const REQ: OrderRequest = { side: 'BUY', type: 'MARKET', qty: 1 }
const REQ_RO: OrderRequest = { side: 'SELL', type: 'MARKET', qty: 1, reduceOnly: true }

describe('RiskGuardedAdapter — arrêter un bot ne transige jamais', () => {
  it('laisse passer un ordre quand rien ne bloque', async () => {
    const { adapter, submitted } = fakeInner()
    const g = new RiskGuardedAdapter(adapter, () => null)
    await g.submit(REQ)
    expect(submitted).toHaveLength(1)
  })

  it('BLOCAGE DUR : refuse même un reduceOnly (statut arrêt / kill switch)', async () => {
    const { adapter, submitted } = fakeInner()
    const block: OrderBlock = { reason: 'bot stopping', hard: true }
    const g = new RiskGuardedAdapter(adapter, () => block)
    // un ordre normal ET un ordre protecteur reduceOnly sont TOUS DEUX rejetés
    await expect(g.submit(REQ)).rejects.toThrow(/état du bot/)
    await expect(g.submit(REQ_RO)).rejects.toThrow(/état du bot/)
    expect(submitted).toHaveLength(0)
  })

  it('PLAFOND SOUPLE : un reduceOnly protecteur peut franchir, un ordre normal non', async () => {
    const { adapter, submitted } = fakeInner()
    const block: OrderBlock = { reason: 'position max dépassée', hard: false }
    const g = new RiskGuardedAdapter(adapter, () => block)
    await expect(g.submit(REQ)).rejects.toThrow(/risk management/) // entrée bloquée
    await g.submit(REQ_RO) // stop protecteur autorisé
    expect(submitted).toHaveLength(1)
    expect(submitted[0]!.reduceOnly).toBe(true)
  })
})
