import {
  floorToStep,
  isTriggerOrder,
  type Balance,
  type Fill,
  type MarketType,
  type Order,
  type OrderRequest,
  type OrderStatus,
  type Position,
  type SymbolInfo,
} from '@tpx/shared'
import type { ExecutionAdapter } from '@tpx/core'
import {
  BinanceAccount,
  BinanceMarketData,
  BinanceRest,
  BinanceUserStream,
  type BinanceCredentials,
  type PlaceOrderParams,
  type RawExchangeOrder,
} from '@tpx/data'

export interface LiveAdapterEvents {
  onFill(fill: Fill, order: Order): void
  onOrderUpdate(order: Order): void
}

export interface LiveAdapterOptions {
  market: MarketType
  testnet: boolean
  symbol: string
  symbolInfo: SymbolInfo
  botId: string
  allocation: number
  leverage: number
  account: BinanceAccount
  events: LiveAdapterEvents
  /** account-level balances snapshot (shared service, throttled) */
  getBalances: () => readonly Balance[]
}

export function clientPrefix(botId: string): string {
  return `tpx_${botId.replace(/-/g, '').slice(0, 10)}_`
}

/** ordre au repos connu du bot (depuis la DB), passé à reconcile() pour
 *  rattraper un éventuel fill survenu pendant l'arrêt (spot). */
export interface RestingOrderRef {
  clientId: string
  side: 'BUY' | 'SELL'
  /** quantité déjà exécutée connue du bot (dernier état persisté) */
  executedQty: number
  /** quote cumulé déjà connu du bot */
  cumQuote: number
}

/**
 * Real-money / testnet execution adapter. The bot owns a virtual slice of the
 * account: position, realized pnl and fees are tracked from the user-data
 * stream events attributed via the clientOrderId prefix. OCO groups are
 * emulated (first leg to fill cancels its siblings).
 *
 * Note: live futures funding is settled in the wallet by Binance but not
 * attributed per-bot here; bot equity slightly understates/overstates by the
 * funding amount until the position closes (visible account-wide in the
 * Account page).
 */
export class BinanceLiveAdapter implements ExecutionAdapter {
  readonly market: MarketType
  readonly symbol: string

  private readonly o: LiveAdapterOptions
  private readonly prefix: string
  private readonly orders = new Map<string, Order>() // by clientId
  private seq = 0
  private lastPriceV = 0
  private posQty = 0
  private posEntry = 0
  private realizedNet = 0
  private bnbPrice = 0
  private bnbPriceAt = 0
  private readonly mkt: BinanceMarketData

  constructor(opts: LiveAdapterOptions) {
    this.o = opts
    this.market = opts.market
    this.symbol = opts.symbol
    this.prefix = clientPrefix(opts.botId)
    this.mkt = new BinanceMarketData(new BinanceRest({ market: opts.market, testnet: opts.testnet }))
  }

  // ----------------------------------------------------------- lifecycle

  get clientIdPrefix(): string {
    return this.prefix
  }

  setLastPrice(p: number): void {
    this.lastPriceV = p
  }

  snapshot(): { posQty: number; posEntry: number; realizedNet: number; seq: number } {
    return { posQty: this.posQty, posEntry: this.posEntry, realizedNet: this.realizedNet, seq: this.seq }
  }

  restore(s: { posQty?: number; posEntry?: number; realizedNet?: number; seq?: number }): void {
    this.posQty = s.posQty ?? 0
    this.posEntry = s.posEntry ?? 0
    this.realizedNet = s.realizedNet ?? 0
    this.seq = Math.max(this.seq, s.seq ?? 0)
  }

  /** Re-adopt resting orders after a restart; cross-check futures position. */
  /**
   * Re-adopt resting orders after a restart and rattraper les fills manqués
   * pendant l'arrêt.
   * - Ordres encore ouverts : ré-adoptés (le bot reprend son stop en attente).
   * - Futures : la position réelle de l'exchange fait foi (corrige tout écart,
   *   y compris un fill manqué — positionAmt est la vérité-terrain isolée).
   * - Spot : pas de « position » côté exchange (la balance inclut du BTC hors-bot,
   *   on ne peut PAS l'adopter). On règle plutôt les fills manqués sur les ordres
   *   au REPOS connus du bot (`resting`, depuis la DB) qui ne sont PLUS ouverts :
   *   on interroge leur état final et on applique le delta exécuté à la position.
   *   Bookkeeping pur (pas d'émission de fill → aucun effet de bord/ordre re-soumis) ;
   *   l'état de la stratégie se ré-aligne ensuite via les balances réelles.
   * Tout est gardé : une erreur d'API est loggée et n'empêche jamais le démarrage.
   */
  async reconcile(resting: RestingOrderRef[] = []): Promise<string[]> {
    const notes: string[] = []
    const stillOpen = new Set<string>()
    const raw = await this.o.account.openOrders(this.symbol)
    for (const r of raw) {
      const cid = r.clientOrderId ?? r.origClientOrderId ?? ''
      if (!cid.startsWith(this.prefix)) continue
      const order = this.mapRawOrder(r, cid)
      this.orders.set(cid, order)
      stillOpen.add(cid)
      notes.push(`re-adopted open order ${cid} (${order.type} ${order.side} ${order.qty})`)
    }
    if (this.market === 'futures') {
      const positions = await this.o.account.futuresPositions(this.symbol)
      const p = positions.find((x) => x.symbol === this.symbol)
      const exchangeQty = p?.positionAmt ?? 0
      if (Math.abs(exchangeQty - this.posQty) > this.o.symbolInfo.stepSize / 2) {
        notes.push(
          `position mismatch: exchange ${exchangeQty}, bot state ${this.posQty} — adopting exchange value`,
        )
        this.posQty = exchangeQty
        this.posEntry = p?.entryPrice ?? this.posEntry
      }
      return notes
    }
    // ---- SPOT : régler les ordres au repos qui ne sont plus ouverts
    for (const ro of resting) {
      if (stillOpen.has(ro.clientId)) continue // toujours ouvert → ré-adopté, rien à faire
      try {
        const ex = await this.o.account.getOrder(this.symbol, { clientOrderId: ro.clientId })
        const exExec = Number(ex.executedQty ?? 0)
        const delta = exExec - ro.executedQty // ce qui s'est exécuté EN PLUS pendant l'arrêt
        if (delta > this.o.symbolInfo.stepSize / 2) {
          const exCum = Number(ex.cummulativeQuoteQty ?? ex.cumQuote ?? 0)
          const missedQuote = exCum - ro.cumQuote
          const price = missedQuote > 0 ? missedQuote / delta : Number(ex.price) || this.lastPriceV
          if (price > 0) {
            this.settleSpotFill(ro.side, delta, price)
            notes.push(
              `fill manqué pendant l'arrêt rattrapé : ${ro.side} ${delta} @ ${price.toFixed(2)} ` +
                `(ordre ${ro.clientId}, ${String(ex.status)}) → position re-synchronisée à ${this.posQty}`,
            )
          }
        }
      } catch (e) {
        notes.push(`réconciliation ordre ${ro.clientId} impossible (${e instanceof Error ? e.message : String(e)}) — ignoré`)
      }
    }
    return notes
  }

  /** applique un fill manqué à la position spot — bookkeeping seul, sans émettre
   *  d'événement (pas d'effet de bord). Les frais sont ignorés (en BNB ils ne
   *  rognent pas la base ; sinon l'écart est de l'ordre du basis point). */
  private settleSpotFill(side: 'BUY' | 'SELL', qty: number, price: number): void {
    if (side === 'BUY') {
      const newQty = this.posQty + qty
      this.posEntry = newQty > 0 ? (this.posEntry * this.posQty + price * qty) / newQty : 0
      this.posQty = newQty
    } else {
      this.realizedNet += (price - this.posEntry) * qty
      this.posQty = Math.max(0, this.posQty - qty)
      if (this.posQty === 0) this.posEntry = 0
    }
  }

  // ----------------------------------------------------- ExecutionAdapter

  now(): number {
    return Date.now()
  }

  lastPrice(): number {
    return this.lastPriceV
  }

  symbolInfo(): SymbolInfo | null {
    return this.o.symbolInfo
  }

  async submit(req: OrderRequest): Promise<Order> {
    const clientId = `${this.prefix}${Date.now().toString(36)}${(++this.seq).toString(36)}`
    const params: PlaceOrderParams = {
      symbol: this.symbol,
      side: req.side,
      type: this.mapType(req.type),
      newClientOrderId: clientId,
      price: req.price,
      stopPrice: req.stopPrice,
      reduceOnly: this.market === 'futures' ? req.reduceOnly : undefined,
    }

    if (req.type === 'MARKET' && req.quoteQty !== undefined && req.qty === undefined) {
      if (this.market === 'spot') {
        params.quoteOrderQty = req.quoteQty
      } else {
        if (this.lastPriceV <= 0) throw new Error('No price yet to convert quoteQty')
        params.quantity = floorToStep(req.quoteQty / this.lastPriceV, this.o.symbolInfo.stepSize)
      }
    } else {
      params.quantity = req.qty
    }

    if (req.type === 'LIMIT') params.timeInForce = req.timeInForce ?? 'GTC'
    if (req.type === 'STOP_LIMIT' || req.type === 'TAKE_PROFIT_LIMIT') params.timeInForce = 'GTC'
    if (req.type === 'LIMIT_MAKER' && this.market === 'futures') params.timeInForce = 'GTX'

    const raw = await this.o.account.placeOrder(params)
    const order: Order = {
      id: clientId,
      clientId,
      botId: this.o.botId,
      market: this.market,
      symbol: this.symbol,
      side: req.side,
      type: req.type,
      status: isTriggerOrder(req.type) ? 'TRIGGER_PENDING' : 'NEW',
      qty: Number(raw.origQty) || params.quantity || 0,
      executedQty: 0,
      cumQuote: 0,
      price: req.price,
      stopPrice: req.stopPrice,
      timeInForce: req.timeInForce ?? 'GTC',
      reduceOnly: req.reduceOnly ?? false,
      ocoGroup: req.ocoGroup,
      reason: req.reason,
      tag: req.tag,
      exchangeOrderId: String(raw.orderId),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.orders.set(clientId, order)
    this.o.events.onOrderUpdate(order)
    return order
  }

  async cancel(orderId: string): Promise<Order | null> {
    const order = this.orders.get(orderId)
    if (!order) return null
    try {
      await this.o.account.cancelOrder(this.symbol, { clientOrderId: order.clientId })
    } catch (err) {
      // -2011: unknown order — already filled/canceled; the stream will tell us
      if (!(err instanceof Error) || !err.message.includes('-2011')) throw err
    }
    return order
  }

  openOrders(): readonly Order[] {
    return [...this.orders.values()].filter(
      (o) => o.status === 'NEW' || o.status === 'TRIGGER_PENDING' || o.status === 'PARTIALLY_FILLED',
    )
  }

  position(): Position {
    return {
      market: this.market,
      symbol: this.symbol,
      qty: this.posQty,
      entryPrice: this.posEntry,
      leverage: this.o.leverage,
      liquidationPrice: null,
      unrealizedPnl: this.posQty === 0 ? 0 : (this.lastPriceV - this.posEntry) * this.posQty,
      updatedAt: Date.now(),
    }
  }

  balances(): readonly Balance[] {
    return this.o.getBalances()
  }

  equity(): number {
    const uPnl = this.posQty === 0 ? 0 : (this.lastPriceV - this.posEntry) * this.posQty
    return this.o.allocation + this.realizedNet + uPnl
  }

  // -------------------------------------------------- user stream routing

  /** spot executionReport */
  handleSpotExecutionReport(ev: Record<string, unknown>): void {
    const clientId = String(ev['c'] ?? '')
    const order = this.orders.get(clientId) ?? this.orders.get(String(ev['C'] ?? ''))
    if (!order) return
    const status = this.mapStatus(String(ev['X'] ?? 'NEW'), order)
    order.status = status
    order.executedQty = Number(ev['z'] ?? order.executedQty)
    order.cumQuote = Number(ev['Z'] ?? order.cumQuote)
    order.updatedAt = Number(ev['T'] ?? Date.now())

    const lastQty = Number(ev['l'] ?? 0)
    if (lastQty > 0) {
      const price = Number(ev['L'])
      const feeAmt = Number(ev['n'] ?? 0)
      const feeAsset = String(ev['N'] ?? '')
      this.applySpotFill(order, lastQty, price, feeAmt, feeAsset, Number(ev['T'] ?? Date.now()), Boolean(ev['m']))
    }
    this.o.events.onOrderUpdate(order)
    if (lastQty > 0) void this.cancelOcoSiblings(order)
  }

  /** futures ORDER_TRADE_UPDATE (the `o` payload) */
  handleFuturesOrderUpdate(ev: Record<string, unknown>): void {
    const clientId = String(ev['c'] ?? '')
    const order = this.orders.get(clientId)
    if (!order) return
    order.status = this.mapStatus(String(ev['X'] ?? 'NEW'), order)
    order.executedQty = Number(ev['z'] ?? order.executedQty)
    order.updatedAt = Number(ev['T'] ?? Date.now())

    const lastQty = Number(ev['l'] ?? 0)
    if (lastQty > 0) {
      const price = Number(ev['L'])
      const feeAmt = Number(ev['n'] ?? 0)
      const feeAsset = String(ev['N'] ?? '')
      const realized = Number(ev['rp'] ?? 0)
      this.applyFuturesFill(
        order,
        lastQty,
        price,
        feeAmt,
        feeAsset,
        realized,
        Number(ev['T'] ?? Date.now()),
        Boolean(ev['m']),
      )
    }
    this.o.events.onOrderUpdate(order)
    if (lastQty > 0) void this.cancelOcoSiblings(order)
  }

  // ------------------------------------------------------------ internals

  private mapType(t: Order['type']): string {
    if (this.market === 'spot') {
      switch (t) {
        case 'STOP_MARKET':
          return 'STOP_LOSS'
        case 'STOP_LIMIT':
          return 'STOP_LOSS_LIMIT'
        case 'TAKE_PROFIT_MARKET':
          return 'TAKE_PROFIT'
        case 'TAKE_PROFIT_LIMIT':
          return 'TAKE_PROFIT_LIMIT'
        default:
          return t
      }
    }
    switch (t) {
      case 'LIMIT_MAKER':
        return 'LIMIT'
      case 'STOP_LIMIT':
        return 'STOP'
      case 'TAKE_PROFIT_LIMIT':
        return 'TAKE_PROFIT'
      default:
        return t
    }
  }

  private mapStatus(raw: string, order: Order): OrderStatus {
    switch (raw) {
      case 'NEW':
        return isTriggerOrder(order.type) && order.executedQty === 0 ? 'TRIGGER_PENDING' : 'NEW'
      case 'PARTIALLY_FILLED':
        return 'PARTIALLY_FILLED'
      case 'FILLED':
        return 'FILLED'
      case 'CANCELED':
      case 'PENDING_CANCEL':
        return 'CANCELED'
      case 'REJECTED':
        return 'REJECTED'
      case 'EXPIRED':
      case 'EXPIRED_IN_MATCH':
        return 'EXPIRED'
      default:
        return 'NEW'
    }
  }

  private mapRawOrder(r: RawExchangeOrder, clientId: string): Order {
    const typeBack: Record<string, Order['type']> = {
      STOP_LOSS: 'STOP_MARKET',
      STOP_LOSS_LIMIT: 'STOP_LIMIT',
      STOP: 'STOP_LIMIT',
      TAKE_PROFIT: this.market === 'spot' ? 'TAKE_PROFIT_MARKET' : 'TAKE_PROFIT_LIMIT',
      TAKE_PROFIT_LIMIT: 'TAKE_PROFIT_LIMIT',
      TAKE_PROFIT_MARKET: 'TAKE_PROFIT_MARKET',
      STOP_MARKET: 'STOP_MARKET',
      LIMIT_MAKER: 'LIMIT_MAKER',
      LIMIT: 'LIMIT',
      MARKET: 'MARKET',
    }
    const type = typeBack[r.type] ?? 'LIMIT'
    const order: Order = {
      id: clientId,
      clientId,
      botId: this.o.botId,
      market: this.market,
      symbol: this.symbol,
      side: r.side as Order['side'],
      type,
      status: 'NEW',
      qty: Number(r.origQty),
      executedQty: Number(r.executedQty),
      cumQuote: Number(r.cummulativeQuoteQty ?? r.cumQuote ?? 0),
      price: Number(r.price) > 0 ? Number(r.price) : undefined,
      stopPrice: r.stopPrice !== undefined && Number(r.stopPrice) > 0 ? Number(r.stopPrice) : undefined,
      timeInForce: (r.timeInForce as Order['timeInForce']) ?? 'GTC',
      reduceOnly: r.reduceOnly ?? false,
      exchangeOrderId: String(r.orderId),
      createdAt: r.time ?? Date.now(),
      updatedAt: r.updateTime ?? Date.now(),
    }
    order.status = this.mapStatus(r.status, order)
    return order
  }

  private async feeToQuote(amount: number, asset: string, price: number): Promise<number> {
    if (amount === 0) return 0
    if (asset === this.o.symbolInfo.quoteAsset || asset === 'USDT') return amount
    if (asset === this.o.symbolInfo.baseAsset) return amount * price
    if (asset === 'BNB') {
      if (Date.now() - this.bnbPriceAt > 60_000) {
        try {
          this.bnbPrice = await this.mkt.price(`BNB${this.o.symbolInfo.quoteAsset}`)
          this.bnbPriceAt = Date.now()
        } catch {
          /* keep stale price */
        }
      }
      return amount * (this.bnbPrice || 0)
    }
    return 0
  }

  private applySpotFill(
    order: Order,
    qty: number,
    price: number,
    feeAmt: number,
    feeAsset: string,
    time: number,
    maker: boolean,
  ): void {
    void this.feeToQuote(feeAmt, feeAsset, price).then((feeQuote) => {
      if (order.side === 'BUY') {
        const received = feeAsset === this.o.symbolInfo.baseAsset ? qty - feeAmt : qty
        const newQty = this.posQty + received
        this.posEntry = newQty > 0 ? (this.posEntry * this.posQty + price * qty) / newQty : 0
        this.posQty = newQty
        this.realizedNet -= feeQuote
      } else {
        const gross = (price - this.posEntry) * qty
        this.realizedNet += gross - feeQuote
        this.posQty = Math.max(0, this.posQty - qty)
        if (this.posQty === 0) this.posEntry = 0
      }
      this.lastPriceV = price
      this.emitFill(order, qty, price, feeQuote, feeAsset, time, maker)
    })
  }

  private applyFuturesFill(
    order: Order,
    qty: number,
    price: number,
    feeAmt: number,
    feeAsset: string,
    realized: number,
    time: number,
    maker: boolean,
  ): void {
    void this.feeToQuote(feeAmt, feeAsset, price).then((feeQuote) => {
      const signed = order.side === 'BUY' ? qty : -qty
      const sameDir = this.posQty === 0 || Math.sign(signed) === Math.sign(this.posQty)
      if (sameDir) {
        const newQty = this.posQty + signed
        this.posEntry =
          newQty !== 0 ? (this.posEntry * Math.abs(this.posQty) + price * qty) / Math.abs(newQty) : 0
        this.posQty = newQty
      } else {
        const prevSign = Math.sign(this.posQty)
        this.posQty += signed
        if (Math.abs(this.posQty) < this.o.symbolInfo.stepSize / 10) {
          this.posQty = 0
          this.posEntry = 0
        } else if (Math.sign(this.posQty) !== prevSign) {
          this.posEntry = price
        }
      }
      this.realizedNet += realized - feeQuote
      this.lastPriceV = price
      this.emitFill(order, qty, price, feeQuote, feeAsset, time, maker)
    })
  }

  private emitFill(
    order: Order,
    qty: number,
    price: number,
    feeQuote: number,
    feeAsset: string,
    time: number,
    maker: boolean,
  ): void {
    const fill: Fill = {
      id: `${order.clientId}-${time}-${qty}`,
      orderId: order.id,
      botId: this.o.botId,
      market: this.market,
      symbol: this.symbol,
      side: order.side,
      price,
      qty,
      quoteQty: qty * price,
      fee: feeQuote,
      feeAsset,
      maker,
      time,
      tag: order.tag,
      reason: order.reason,
    }
    this.o.events.onFill(fill, order)
  }

  private async cancelOcoSiblings(order: Order): Promise<void> {
    if (!order.ocoGroup) return
    for (const sib of this.orders.values()) {
      if (sib.id === order.id || sib.ocoGroup !== order.ocoGroup) continue
      if (sib.status === 'NEW' || sib.status === 'TRIGGER_PENDING' || sib.status === 'PARTIALLY_FILLED') {
        await this.cancel(sib.id).catch(() => {})
      }
    }
  }
}

/**
 * One user-data stream per (credentials, market); events are routed to the
 * registered adapters by their clientOrderId prefix.
 */
export class UserStreamRouter {
  private adapters = new Map<string, BinanceLiveAdapter>()
  private stream: BinanceUserStream | null = null

  constructor(
    private readonly market: MarketType,
    private readonly testnet: boolean,
    creds: BinanceCredentials,
    private readonly onError: (err: Error) => void,
  ) {
    const rest = new BinanceRest({ market, testnet, credentials: creds })
    const account = new BinanceAccount(rest)
    this.stream = new BinanceUserStream(
      market,
      testnet,
      {
        createListenKey: () => account.createListenKey(),
        keepAliveListenKey: (k) => account.keepAliveListenKey(k),
      },
      (ev) => this.route(ev),
      onError,
    )
  }

  async start(): Promise<void> {
    await this.stream?.start()
  }

  stop(): void {
    this.stream?.stop()
  }

  register(adapter: BinanceLiveAdapter): void {
    this.adapters.set(adapter.clientIdPrefix, adapter)
  }

  unregister(adapter: BinanceLiveAdapter): void {
    this.adapters.delete(adapter.clientIdPrefix)
  }

  get size(): number {
    return this.adapters.size
  }

  private route(ev: Record<string, unknown>): void {
    try {
      if (this.market === 'spot' && ev['e'] === 'executionReport') {
        const cid = String(ev['c'] ?? ev['C'] ?? '')
        const adapter = this.find(cid)
        adapter?.handleSpotExecutionReport(ev)
      } else if (this.market === 'futures' && ev['e'] === 'ORDER_TRADE_UPDATE') {
        const o = ev['o'] as Record<string, unknown> | undefined
        if (!o) return
        const adapter = this.find(String(o['c'] ?? ''))
        adapter?.handleFuturesOrderUpdate(o)
      }
    } catch (err) {
      this.onError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  private find(clientId: string): BinanceLiveAdapter | undefined {
    for (const [prefix, adapter] of this.adapters) {
      if (clientId.startsWith(prefix)) return adapter
    }
    return undefined
  }
}
