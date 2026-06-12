import type { Balance } from '@tpx/shared'
import type { BinanceRest } from './rest'

export interface RawExchangeOrder {
  symbol: string
  orderId: number
  clientOrderId?: string
  origClientOrderId?: string
  price: string
  origQty: string
  executedQty: string
  cummulativeQuoteQty?: string
  cumQuote?: string
  status: string
  timeInForce: string
  type: string
  side: string
  stopPrice?: string
  reduceOnly?: boolean
  updateTime?: number
  time?: number
}

export interface PlaceOrderParams {
  symbol: string
  side: 'BUY' | 'SELL'
  type: string
  quantity?: number
  quoteOrderQty?: number
  price?: number
  stopPrice?: number
  timeInForce?: string
  reduceOnly?: boolean
  newClientOrderId?: string
  /** futures post-only */
  goodTillCancel?: never
}

/**
 * Signed account/trading endpoints for one market (spot or USDT-M futures).
 */
export class BinanceAccount {
  constructor(private readonly rest: BinanceRest) {}

  // ---------------------------------------------------------------- assets

  async spotBalances(): Promise<Balance[]> {
    const acc = await this.rest.signed<{ balances: { asset: string; free: string; locked: string }[] }>(
      'GET',
      '/api/v3/account',
      { omitZeroBalances: true },
    )
    return acc.balances.map((b) => ({ asset: b.asset, free: Number(b.free), locked: Number(b.locked) }))
  }

  async futuresBalances(): Promise<Balance[]> {
    const assets = await this.rest.signed<{ asset: string; availableBalance: string; balance: string }[]>(
      'GET',
      '/fapi/v2/balance',
    )
    return assets
      .filter((a) => Number(a.balance) !== 0)
      .map((a) => ({
        asset: a.asset,
        free: Number(a.availableBalance),
        locked: Number(a.balance) - Number(a.availableBalance),
      }))
  }

  async futuresPositions(symbol?: string): Promise<
    { symbol: string; positionAmt: number; entryPrice: number; leverage: number; liquidationPrice: number; unRealizedProfit: number }[]
  > {
    const raw = await this.rest.signed<
      {
        symbol: string
        positionAmt: string
        entryPrice: string
        leverage: string
        liquidationPrice: string
        unRealizedProfit: string
      }[]
    >('GET', '/fapi/v2/positionRisk', { symbol })
    return raw.map((p) => ({
      symbol: p.symbol,
      positionAmt: Number(p.positionAmt),
      entryPrice: Number(p.entryPrice),
      leverage: Number(p.leverage),
      liquidationPrice: Number(p.liquidationPrice),
      unRealizedProfit: Number(p.unRealizedProfit),
    }))
  }

  /** live commission rates; falls back to null when unavailable (testnet) */
  async commissionRates(symbol: string): Promise<{ maker: number; taker: number } | null> {
    try {
      if (this.rest.market === 'futures') {
        const r = await this.rest.signed<{ makerCommissionRate: string; takerCommissionRate: string }>(
          'GET',
          '/fapi/v1/commissionRate',
          { symbol },
        )
        return { maker: Number(r.makerCommissionRate), taker: Number(r.takerCommissionRate) }
      }
      const r = await this.rest.signed<{ standardCommission: { maker: string; taker: string } }>(
        'GET',
        '/api/v3/account/commission',
        { symbol },
      )
      return { maker: Number(r.standardCommission.maker), taker: Number(r.standardCommission.taker) }
    } catch {
      return null
    }
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    await this.rest.signed('POST', '/fapi/v1/leverage', { symbol, leverage })
  }

  async setIsolatedMargin(symbol: string): Promise<void> {
    try {
      await this.rest.signed('POST', '/fapi/v1/marginType', { symbol, marginType: 'ISOLATED' })
    } catch (err) {
      // -4046: already isolated
      if (!(err instanceof Error) || !err.message.includes('-4046')) throw err
    }
  }

  // ---------------------------------------------------------------- orders

  private get orderPath(): string {
    return this.rest.market === 'spot' ? '/api/v3/order' : '/fapi/v1/order'
  }

  async placeOrder(params: PlaceOrderParams): Promise<RawExchangeOrder> {
    const p: Record<string, string | number | boolean | undefined> = {
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      quantity: params.quantity,
      quoteOrderQty: params.quoteOrderQty,
      price: params.price,
      stopPrice: params.stopPrice,
      timeInForce: params.timeInForce,
      newClientOrderId: params.newClientOrderId,
    }
    if (this.rest.market === 'futures' && params.reduceOnly !== undefined) {
      p['reduceOnly'] = params.reduceOnly
    }
    return this.rest.signed<RawExchangeOrder>('POST', this.orderPath, p)
  }

  async cancelOrder(symbol: string, opts: { orderId?: number; clientOrderId?: string }): Promise<RawExchangeOrder> {
    return this.rest.signed<RawExchangeOrder>('DELETE', this.orderPath, {
      symbol,
      orderId: opts.orderId,
      origClientOrderId: opts.clientOrderId,
    })
  }

  async cancelAllOrders(symbol: string): Promise<void> {
    if (this.rest.market === 'spot') {
      try {
        await this.rest.signed('DELETE', '/api/v3/openOrders', { symbol })
      } catch (err) {
        // -2011 "Unknown order sent" => nothing to cancel
        if (!(err instanceof Error) || !err.message.includes('-2011')) throw err
      }
    } else {
      await this.rest.signed('DELETE', '/fapi/v1/allOpenOrders', { symbol })
    }
  }

  async openOrders(symbol?: string): Promise<RawExchangeOrder[]> {
    const path = this.rest.market === 'spot' ? '/api/v3/openOrders' : '/fapi/v1/openOrders'
    return this.rest.signed<RawExchangeOrder[]>('GET', path, { symbol })
  }

  async getOrder(symbol: string, opts: { orderId?: number; clientOrderId?: string }): Promise<RawExchangeOrder> {
    return this.rest.signed<RawExchangeOrder>('GET', this.orderPath, {
      symbol,
      orderId: opts.orderId,
      origClientOrderId: opts.clientOrderId,
    })
  }

  // ------------------------------------------------------ user data stream

  async createListenKey(): Promise<string> {
    const path = this.rest.market === 'spot' ? '/api/v3/userDataStream' : '/fapi/v1/listenKey'
    const r = await this.rest.keyed<{ listenKey: string }>('POST', path)
    return r.listenKey
  }

  async keepAliveListenKey(listenKey: string): Promise<void> {
    if (this.rest.market === 'spot') {
      await this.rest.keyed('PUT', '/api/v3/userDataStream', { listenKey })
    } else {
      await this.rest.keyed('PUT', '/fapi/v1/listenKey')
    }
  }
}
