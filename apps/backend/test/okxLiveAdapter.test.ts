import { describe, expect, it } from 'bun:test'
import type { Balance, Order, SymbolInfo } from '@tpx/shared'
import { OkxApiError } from '@tpx/data'
import { OKXLiveAdapter, type RestingOrderRef } from '../src/services/okxLiveAdapter'

const SWAP_SI: SymbolInfo = {
  market: 'futures', symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT',
  pricePrecision: 1, qtyPrecision: 3, tickSize: 0.1, stepSize: 0.001, minQty: 0.001,
  minNotional: 5, status: 'TRADING', contractSize: 0.01,
}
const SPOT_SI: SymbolInfo = {
  market: 'spot', symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT',
  pricePrecision: 1, qtyPrecision: 8, tickSize: 0.1, stepSize: 0.0001, minQty: 0.0001,
  minNotional: 5, status: 'TRADING',
}

interface FakeAccountHooks {
  captured?: Record<string, unknown>[]
  algoOrders?: Record<string, unknown>[]
  openOrders?: Record<string, unknown>[]
  balances?: Balance[]
  placeOrder?: (body: Record<string, unknown>) => Promise<Record<string, unknown>>
  getOrder?: () => Promise<Record<string, unknown> | null>
  getAlgoOrder?: () => Promise<Record<string, unknown> | null>
}

function fakeAccount(h: FakeAccountHooks = {}) {
  return {
    placeOrder:
      h.placeOrder ??
      (async (body: Record<string, unknown>) => {
        h.captured?.push(body)
        return { ordId: 'o1', clOrdId: String(body.clOrdId), sCode: '0', sMsg: '' }
      }),
    placeAlgoOrder: async (body: Record<string, unknown>) => {
      h.captured?.push(body)
      return { ordId: '', algoId: 'a1', clOrdId: '', algoClOrdId: String(body.algoClOrdId), sCode: '0', sMsg: '' }
    },
    cancelOrder: async () => {},
    cancelAlgoOrder: async () => {},
    openOrders: async () => h.openOrders ?? [],
    openAlgoOrders: async () => h.algoOrders ?? [],
    positions: async () => [],
    balances: async () => h.balances ?? [],
    getOrder: h.getOrder ?? (async () => null),
    getAlgoOrder: h.getAlgoOrder ?? (async () => null),
    instrument: async () => ({ instId: 'BTC-USDT-SWAP', tickSize: 0.1, stepSize: 1, minQty: 1, contractSize: 0.01, maxLeverage: 125 }),
  } as unknown as import('@tpx/data').OkxAccount
}

function mkAdapter(h: FakeAccountHooks = {}, si: SymbolInfo = SWAP_SI, allocation = 1000) {
  const fills: import('@tpx/shared').Fill[] = []
  const updates: Order[] = []
  const balancesAtFill: Balance[][] = []
  const adapter = new OKXLiveAdapter({
    market: si.market, demo: true, symbol: si.symbol, symbolInfo: si, botId: 'bot-123',
    allocation, leverage: 10, account: fakeAccount(h), probeDelayMs: 0,
    events: {
      onFill: (f) => {
        fills.push(f)
        balancesAtFill.push([...adapter.balances()])
      },
      onOrderUpdate: (o) => updates.push({ ...o }),
    },
  })
  adapter.setLastPrice(50000)
  return { adapter, fills, updates, balancesAtFill }
}

function fillEvent(clOrdId: string, over: Partial<import('@tpx/data').OkxOrderEvent> = {}): import('@tpx/data').OkxOrderEvent {
  return {
    instId: 'BTC-USDT', clOrdId, ordId: 'o1', state: 'filled', side: 'buy',
    fillSz: '0.2', fillPx: '40000', fillFee: '-8', fillFeeCcy: 'USDT', fillPnl: '0',
    fillTime: '1782637737000', accFillSz: '0.2', tradeId: 'tr1',
    ...over,
  }
}

describe('OKXLiveAdapter (futures, parité historique)', () => {
  it('submits a futures market order sized in contracts with an alphanumeric clOrdId', async () => {
    const captured: Record<string, unknown>[] = []
    const { adapter } = mkAdapter({ captured })
    const order = await adapter.submit({ side: 'BUY', type: 'MARKET', qty: 0.05 })
    expect(captured[0]).toMatchObject({ instId: 'BTC-USDT-SWAP', ordType: 'market', sz: '5' })
    expect(order.clientId).toMatch(/^tpx[a-z0-9]+$/i)
    expect(order.status).toBe('NEW')
  })

  it('applies a fill from a private order event and emits a normalized fill', async () => {
    const { adapter, fills } = mkAdapter({ captured: [] })
    const order = await adapter.submit({ side: 'BUY', type: 'MARKET', qty: 0.05 })
    adapter.handleOrderEvent({
      instId: 'BTC-USDT-SWAP', clOrdId: order.clientId, ordId: 'o1', state: 'filled', side: 'buy',
      fillSz: '5', fillPx: '50000', fillFee: '-0.025', fillFeeCcy: 'USDT', fillPnl: '0', fillTime: '1782637737000', accFillSz: '5',
    })
    expect(fills.length).toBe(1)
    expect(adapter.position().qty).toBeCloseTo(0.05, 6)
  })

  it('re-adopts a resting algo (stop) order on reconcile so its later fill is attributed', async () => {
    const algoCid = 'tpxbot123s1' // must start with clOrdPrefix('bot-123') === 'tpxbot123'
    const { adapter, fills } = mkAdapter({
      captured: [],
      algoOrders: [
        { instId: 'BTC-USDT-SWAP', algoId: 'a9', algoClOrdId: algoCid, ordType: 'trigger', side: 'sell', sz: '5', triggerPx: '48000', state: 'live' },
      ],
    })
    const notes = await adapter.reconcile([])
    expect(notes.some((n) => n.includes(algoCid))).toBe(true)
    expect(adapter.openOrders().some((o) => o.clientId === algoCid && o.status === 'TRIGGER_PENDING')).toBe(true)
    adapter.handleOrderEvent({
      instId: 'BTC-USDT-SWAP', clOrdId: algoCid, ordId: 'o9', state: 'filled', side: 'sell',
      fillSz: '5', fillPx: '48000', fillFee: '-0.024', fillFeeCcy: 'USDT', fillPnl: '0', fillTime: '1782637737000', accFillSz: '5',
    })
    expect(fills.length).toBe(1)
    expect(adapter.position().qty).toBeCloseTo(-0.05, 6)
  })
})

describe('OKXLiveAdapter quoteLedger (P0-1)', () => {
  it('credits the quote ledger on a SELL fill — visible dans balances() AU MOMENT du onFill', async () => {
    const { adapter, balancesAtFill } = mkAdapter({ captured: [] }, SPOT_SI, 10_000)
    // bot en position : 0.5 BTC achetés à 38 000 → ledger dérivé = 0 (tout investi)
    adapter.restore({ posQty: 0.5, posEntry: 38_000, realizedNet: -19_000 + 19_000 })
    expect(adapter.balances().find((b) => b.asset === 'USDT')?.free).toBe(0)

    const order = await adapter.submit({ side: 'SELL', type: 'MARKET', qty: 0.5 })
    adapter.handleOrderEvent(fillEvent(order.clientId, { side: 'sell', fillSz: '0.5', fillPx: '40000', fillFee: '-10', accFillSz: '0.5' }))

    // LE test P0-1 : la stratégie (onFill) voit le produit de la vente immédiatement
    const quoteAtFill = balancesAtFill[0]!.find((b) => b.asset === 'USDT')
    expect(quoteAtFill?.free).toBeCloseTo(0.5 * 40_000 - 10, 6)
    expect(adapter.balances().find((b) => b.asset === 'BTC')?.free).toBeCloseTo(0, 9)
  })

  it('debits cost + quote fee on a BUY fill and stays bounded by the allocation', async () => {
    const { adapter } = mkAdapter({ captured: [] }, SPOT_SI, 10_000)
    const order = await adapter.submit({ side: 'BUY', type: 'MARKET', quoteQty: 8_000 })
    adapter.handleOrderEvent(fillEvent(order.clientId, { fillSz: '0.2', fillPx: '40000', fillFee: '-8' }))
    expect(adapter.balances().find((b) => b.asset === 'USDT')?.free).toBeCloseTo(10_000 - 8_000 - 8, 6)
    expect(adapter.balances().find((b) => b.asset === 'BTC')?.free).toBeCloseTo(0.2, 9)
  })

  it('does not double-debit when the fee is charged in base coin', async () => {
    const { adapter } = mkAdapter({ captured: [] }, SPOT_SI, 10_000)
    const order = await adapter.submit({ side: 'BUY', type: 'MARKET', quoteQty: 8_000 })
    adapter.handleOrderEvent(fillEvent(order.clientId, { fillSz: '0.2', fillPx: '40000', fillFee: '-0.0002', fillFeeCcy: 'BTC' }))
    expect(adapter.balances().find((b) => b.asset === 'USDT')?.free).toBeCloseTo(2_000, 6)
    expect(adapter.balances().find((b) => b.asset === 'BTC')?.free).toBeCloseTo(0.1998, 9)
  })

  it('round-trips quoteLedger through snapshot/restore and derives it for legacy snapshots', () => {
    const { adapter } = mkAdapter({}, SPOT_SI, 10_000)
    adapter.restore({ posQty: 0, posEntry: 0, realizedNet: 500, quoteLedger: 10_500 })
    expect(adapter.snapshot().quoteLedger).toBe(10_500)
    // snapshot d'avant la migration (pas de quoteLedger) : dérivation
    const { adapter: legacy } = mkAdapter({}, SPOT_SI, 10_000)
    legacy.restore({ posQty: 0.1, posEntry: 40_000, realizedNet: 200 })
    expect(legacy.snapshot().quoteLedger).toBeCloseTo(10_000 + 200 - 4_000, 6)
  })
})

describe('OKXLiveAdapter submit (P0-2a/2b)', () => {
  it('a WS fill arriving BEFORE the REST ack is attributed (map before REST)', async () => {
    let adapterRef: OKXLiveAdapter | undefined
    const h: FakeAccountHooks = {
      placeOrder: async (body) => {
        // le push WS double l'ack REST : l'ordre DOIT déjà être dans la map
        adapterRef!.handleOrderEvent(fillEvent(String(body.clOrdId)))
        return { ordId: 'o1', clOrdId: String(body.clOrdId), sCode: '0', sMsg: '' }
      },
    }
    const { adapter, fills } = mkAdapter(h, SPOT_SI, 10_000)
    adapterRef = adapter
    const order = await adapter.submit({ side: 'BUY', type: 'MARKET', quoteQty: 8_000 })
    expect(fills.length).toBe(1)
    expect(order.status).toBe('FILLED')
    expect(order.exchangeOrderId).toBe('o1')
    expect(adapter.position().qty).toBeCloseTo(0.2, 9)
  })

  it('a definitive OKX reject marks the order REJECTED and rethrows', async () => {
    const { adapter, updates } = mkAdapter({
      placeOrder: async () => {
        throw new OkxApiError('51008', 200, 'insufficient balance')
      },
    }, SPOT_SI)
    await expect(adapter.submit({ side: 'BUY', type: 'MARKET', quoteQty: 100 })).rejects.toThrow(/51008/)
    expect(adapter.openOrders().length).toBe(0)
    expect(updates.at(-1)?.status).toBe('REJECTED')
  })

  it('unknown outcome (network error) + getOrder finds it → order is adopted, submit succeeds', async () => {
    const { adapter } = mkAdapter({
      placeOrder: async () => {
        throw new Error('fetch failed: connection reset')
      },
      getOrder: async () => ({ instId: 'BTC-USDT', ordId: 'o77', ordType: 'market', side: 'buy', sz: '0.2', state: 'live', accFillSz: '0' }),
    }, SPOT_SI)
    const order = await adapter.submit({ side: 'BUY', type: 'MARKET', quoteQty: 8_000 })
    expect(order.exchangeOrderId).toBe('o77')
    expect(order.status).toBe('NEW')
  })

  it('unknown outcome + getOrder says FILLED → adopted AND the missed fill is replayed', async () => {
    const { adapter, fills } = mkAdapter({
      placeOrder: async () => {
        throw new Error('timeout')
      },
      getOrder: async () => ({
        instId: 'BTC-USDT', ordId: 'o78', ordType: 'market', side: 'buy', sz: '0.2',
        state: 'filled', accFillSz: '0.2', avgPx: '40000', fee: '-8', feeCcy: 'USDT',
      }),
    }, SPOT_SI, 10_000)
    const order = await adapter.submit({ side: 'BUY', type: 'MARKET', quoteQty: 8_000 })
    expect(order.status).toBe('FILLED')
    expect(fills.length).toBe(1)
    expect(adapter.position().qty).toBeCloseTo(0.2, 9)
    expect(adapter.balances().find((b) => b.asset === 'USDT')?.free).toBeCloseTo(10_000 - 8_000 - 8, 6)
  })

  it('unknown outcome + OKX does not know the order → REJECTED + rethrow', async () => {
    const { adapter, updates } = mkAdapter({
      placeOrder: async () => {
        throw new Error('timeout')
      },
      getOrder: async () => null,
    }, SPOT_SI)
    await expect(adapter.submit({ side: 'BUY', type: 'MARKET', quoteQty: 100 })).rejects.toThrow(/timeout/)
    expect(updates.at(-1)?.status).toBe('REJECTED')
  })

  it('unknown outcome + probe also fails → order kept NEW for later catch-up, error rethrown', async () => {
    const { adapter, updates } = mkAdapter({
      placeOrder: async () => {
        throw new Error('timeout')
      },
      getOrder: async () => {
        throw new Error('still down')
      },
    }, SPOT_SI)
    await expect(adapter.submit({ side: 'BUY', type: 'MARKET', quoteQty: 100 })).rejects.toThrow(/issue inconnue/)
    // l'ordre reste vivant : un push WS tardif ou le backfill du reconcile l'attribuera
    expect(adapter.openOrders().length).toBe(1)
    expect(updates.at(-1)?.status).toBe('NEW')
  })
})

describe('OKXLiveAdapter idempotence des fills', () => {
  it('the same WS fill delivered twice (same tradeId) is applied once', async () => {
    const { adapter, fills } = mkAdapter({ captured: [] }, SPOT_SI, 10_000)
    const order = await adapter.submit({ side: 'BUY', type: 'MARKET', quoteQty: 8_000 })
    const ev = fillEvent(order.clientId)
    adapter.handleOrderEvent(ev)
    adapter.handleOrderEvent(ev)
    expect(fills.length).toBe(1)
    expect(adapter.position().qty).toBeCloseTo(0.2, 9)
  })

  it('fill ids use the OKX tradeId when present', async () => {
    const { adapter, fills } = mkAdapter({ captured: [] }, SPOT_SI, 10_000)
    const order = await adapter.submit({ side: 'BUY', type: 'MARKET', quoteQty: 8_000 })
    adapter.handleOrderEvent(fillEvent(order.clientId, { tradeId: '998877' }))
    expect(fills[0]!.id).toBe(`${order.clientId}-t998877`)
    expect(fills[0]!.feeAsset).toBe('USDT')
  })
})

describe('OKXLiveAdapter reconcile (P0-2c backfill, spec §14)', () => {
  const cid = 'tpxbot123zz1'

  it('replays a stop that TRIGGERED while the bot was down (algo effective → ordre engendré)', async () => {
    // le trigger BUY spot a un sz/actualSz en QUOTE (convention OKX) — le
    // backfill lit l'ordre régulier ENGENDRÉ (ordId) : unités base sûres
    const { adapter, fills, updates } = mkAdapter({
      getAlgoOrder: async () => ({
        instId: 'BTC-USDT', algoId: 'a5', ordId: 'o55', algoClOrdId: cid, ordType: 'trigger', side: 'buy',
        sz: '20525', triggerPx: '41000', state: 'effective', actualSz: '20525', actualPx: '41050',
      }),
      getOrder: async () => ({
        instId: 'BTC-USDT', ordId: 'o55', ordType: 'market', side: 'buy', sz: '20525',
        state: 'filled', accFillSz: '0.5', avgPx: '41050', fee: '-20', feeCcy: 'USDT',
      }),
    }, SPOT_SI, 25_000)
    adapter.restore({ posQty: 0, posEntry: 0, realizedNet: 0, quoteLedger: 21_000 })
    const resting: RestingOrderRef[] = [{ clientId: cid, side: 'BUY', type: 'STOP_MARKET', executedQty: 0, cumQuote: 0 }]
    const notes = await adapter.reconcile(resting)
    expect(notes.some((n) => n.includes('rattrapage'))).toBe(true)
    expect(fills.length).toBe(1)
    expect(fills[0]!.id).toBe(`${cid}-bf0-0.5`)
    expect(adapter.position().qty).toBeCloseTo(0.5, 9)
    expect(adapter.balances().find((b) => b.asset === 'USDT')?.free).toBeCloseTo(21_000 - 0.5 * 41_050 - 20, 6)
    // le statut final part en DB : l'ordre sort du set « resting »
    expect(updates.at(-1)?.status).toBe('FILLED')
  })

  it('fallback sans ordre engendré lisible : actualSz (quote) reconverti en base', async () => {
    const { adapter, fills } = mkAdapter({
      getAlgoOrder: async () => ({
        instId: 'BTC-USDT', algoId: 'a5', algoClOrdId: cid, ordType: 'trigger', side: 'buy',
        sz: '20525', triggerPx: '41000', state: 'effective', actualSz: '20525', actualPx: '41050',
      }),
      getOrder: async () => null, // l'ordre engendré n'est pas lisible
    }, SPOT_SI, 25_000)
    adapter.restore({ posQty: 0, posEntry: 0, realizedNet: 0, quoteLedger: 21_000 })
    await adapter.reconcile([{ clientId: cid, side: 'BUY', type: 'STOP_MARKET', executedQty: 0, cumQuote: 0 }])
    expect(fills.length).toBe(1)
    expect(fills[0]!.qty).toBeCloseTo(20_525 / 41_050, 9) // = 0.5 base
    expect(adapter.position().qty).toBeCloseTo(0.5, 9)
  })

  it('replays the missed part of a regular order filled while down', async () => {
    const { adapter, fills } = mkAdapter({
      getOrder: async () => ({
        instId: 'BTC-USDT', ordId: 'o9', clOrdId: cid, ordType: 'market', side: 'sell',
        sz: '0.5', state: 'filled', accFillSz: '0.5', avgPx: '40000', fee: '-10', feeCcy: 'USDT',
      }),
    }, SPOT_SI, 10_000)
    adapter.restore({ posQty: 0.5, posEntry: 38_000, realizedNet: 0, quoteLedger: 0 })
    const resting: RestingOrderRef[] = [{ clientId: cid, side: 'SELL', type: 'MARKET', executedQty: 0, cumQuote: 0 }]
    await adapter.reconcile(resting)
    expect(fills.length).toBe(1)
    expect(adapter.position().qty).toBeCloseTo(0, 9)
    expect(adapter.balances().find((b) => b.asset === 'USDT')?.free).toBeCloseTo(0.5 * 40_000 - 10, 6)
  })

  it('marks an order UNKNOWN TO OKX as REJECTED so it stops being resting', async () => {
    const { adapter, updates } = mkAdapter({ getOrder: async () => null }, SPOT_SI)
    const resting: RestingOrderRef[] = [{ clientId: cid, side: 'BUY', type: 'MARKET', executedQty: 0, cumQuote: 0 }]
    const notes = await adapter.reconcile(resting)
    expect(notes.some((n) => n.includes('introuvable'))).toBe(true)
    expect(updates.at(-1)?.status).toBe('REJECTED')
  })

  it('catches up a partial fill on a STILL-OPEN re-adopted order', async () => {
    const { adapter, fills } = mkAdapter({
      openOrders: [{
        instId: 'BTC-USDT', ordId: 'o3', clOrdId: cid, ordType: 'limit', side: 'sell',
        sz: '1', px: '40000', state: 'partially_filled', accFillSz: '0.4', avgPx: '40000', fee: '-4', feeCcy: 'USDT',
      }],
    }, SPOT_SI, 10_000)
    adapter.restore({ posQty: 1, posEntry: 38_000, realizedNet: 0, quoteLedger: 0 })
    const resting: RestingOrderRef[] = [{ clientId: cid, side: 'SELL', type: 'LIMIT', executedQty: 0, cumQuote: 0 }]
    await adapter.reconcile(resting)
    expect(fills.length).toBe(1)
    expect(fills[0]!.qty).toBeCloseTo(0.4, 9)
    expect(adapter.position().qty).toBeCloseTo(0.6, 9)
    // l'ordre reste ouvert et suivi
    expect(adapter.openOrders().some((o) => o.clientId === cid && o.status === 'PARTIALLY_FILLED')).toBe(true)
  })

  it('clamps the quote ledger to the real account balance (anti-drift)', async () => {
    const { adapter } = mkAdapter({ balances: [{ asset: 'USDT', free: 500, locked: 0 }] }, SPOT_SI, 10_000)
    const notes = await adapter.reconcile([])
    expect(notes.some((n) => n.includes('clampé'))).toBe(true)
    expect(adapter.balances().find((b) => b.asset === 'USDT')?.free).toBe(500)
  })

  it('an API error in one reconcile step becomes a note and does not block the rest', async () => {
    const { adapter } = mkAdapter({
      getOrder: async () => {
        throw new Error('OKX 500')
      },
      balances: [{ asset: 'USDT', free: 500, locked: 0 }],
    }, SPOT_SI, 10_000)
    const resting: RestingOrderRef[] = [{ clientId: cid, side: 'BUY', type: 'MARKET', executedQty: 0, cumQuote: 0 }]
    const notes = await adapter.reconcile(resting)
    expect(notes.some((n) => n.includes('en erreur'))).toBe(true)
    // le clamp balance a quand même tourné
    expect(adapter.balances().find((b) => b.asset === 'USDT')?.free).toBe(500)
  })
})
