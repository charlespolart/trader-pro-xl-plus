import {
  isTriggerOrder,
  type Balance,
  type Fill,
  type MarketType,
  type Order,
  type OrderRequest,
  type Position,
  type SymbolInfo,
} from '@tpx/shared'
import type { ExecutionAdapter } from '@tpx/core'
import {
  buildAlgoBody,
  buildOrderBody,
  clOrdPrefix,
  contractsToBase,
  makeClOrdId,
  mapOkxState,
  mapOrdType,
  parseFill,
  toInstId,
  type OkxAccount,
  type OkxOrderEvent,
} from '@tpx/data'

export interface LiveAdapterEvents {
  onFill(fill: Fill, order: Order): void
  onOrderUpdate(order: Order): void
}

export interface LiveAdapterOptions {
  market: MarketType
  demo: boolean
  symbol: string
  symbolInfo: SymbolInfo
  botId: string
  allocation: number
  leverage: number
  account: OkxAccount
  events: LiveAdapterEvents
  /** account-level balances snapshot (shared service, throttled) */
  getBalances: () => readonly Balance[]
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
 * Real-money / demo execution adapter for OKX. The bot owns a virtual slice of
 * the account: position, realized pnl and fees are tracked from the private
 * `orders` channel events attributed via the clOrdId prefix. OCO groups are
 * emulated (first leg to fill cancels its siblings).
 *
 * Note: live futures funding is settled in the wallet by OKX but not attributed
 * per-bot here; bot equity slightly understates/overstates by the funding
 * amount until the position closes (visible account-wide in the Account page).
 */
export class OKXLiveAdapter implements ExecutionAdapter {
  readonly market: MarketType
  readonly symbol: string

  private readonly o: LiveAdapterOptions
  private readonly prefix: string
  private readonly instId: string
  private readonly ctVal: number
  private readonly lotSz: number
  private readonly orders = new Map<string, Order>() // by clOrdId
  private seq = 0
  private lastPriceV = 0
  private posQty = 0
  private posEntry = 0
  private realizedNet = 0

  constructor(opts: LiveAdapterOptions) {
    this.o = opts
    this.market = opts.market
    this.symbol = opts.symbol
    this.prefix = clOrdPrefix(opts.botId)
    this.instId = toInstId(opts.symbolInfo.baseAsset, opts.symbolInfo.quoteAsset, opts.market)
    this.ctVal = opts.symbolInfo.contractSize ?? 1
    this.lotSz = opts.symbolInfo.stepSize
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

  /**
   * Re-adopt resting orders after a restart and rattraper les fills manqués
   * pendant l'arrêt.
   * - Ordres encore ouverts : ré-adoptés (le bot reprend son stop en attente).
   * - Futures : la position réelle de l'exchange fait foi (corrige tout écart,
   *   y compris un fill manqué — la position isolée est la vérité-terrain).
   * - Spot : pas de « position » côté exchange (la balance inclut du BTC hors-bot,
   *   on ne peut PAS l'adopter). Le rattrapage des fills manqués sur les ordres
   *   au REPOS connus du bot exigerait un getOrder par-ordre, pas encore
   *   implémenté côté OkxAccount → on logge et on saute (spec §14, follow-up).
   * Tout est gardé : une erreur d'API est loggée et n'empêche jamais le démarrage.
   */
  async reconcile(resting: RestingOrderRef[] = []): Promise<string[]> {
    const notes: string[] = []
    const stillOpen = new Set<string>()
    // `openOrders` ne renvoie que les ordres réguliers (non-algo) → type LIMIT.
    const raw = await this.o.account.openOrders(this.instId)
    for (const r of raw) {
      const cid = r.clOrdId ?? ''
      if (!cid.startsWith(this.prefix)) continue
      const order = this.mapRawOrder(r, cid)
      this.orders.set(cid, order)
      stillOpen.add(cid)
      notes.push(`re-adopted open order ${cid} (${order.type} ${order.side})`)
    }
    if (this.market === 'futures') {
      const positions = await this.o.account.positions(this.instId, this.ctVal)
      const p = positions.find((x) => x.instId === this.instId)
      const exchangeQty = p?.qty ?? 0
      if (Math.abs(exchangeQty - this.posQty) > this.o.symbolInfo.stepSize / 2) {
        notes.push(
          `position mismatch: exchange ${exchangeQty}, bot state ${this.posQty} — adopting exchange value`,
        )
        this.posQty = exchangeQty
        this.posEntry = p?.entryPrice ?? this.posEntry
      }
      return notes
    }
    // ---- SPOT : rattrapage des fills manqués sur les ordres au repos clôturés.
    // OkxAccount n'expose pas encore de getOrder(instId, { clOrdId }) → on ne peut
    // pas lire l'état final d'un ordre qui n'est plus ouvert. Reporté (spec §14).
    for (const ro of resting) {
      if (stillOpen.has(ro.clientId)) continue
      notes.push(
        `réconciliation ordre ${ro.clientId} ignorée : getOrder OKX non implémenté ` +
          `(rattrapage du fill manqué reporté — spec §14)`,
      )
    }
    return notes
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
    const clOrdId = makeClOrdId(this.prefix, ++this.seq)
    const { algo } = mapOrdType(req.type, this.market)
    const args = {
      instId: this.instId,
      market: this.market,
      req,
      clOrdId,
      ctVal: this.ctVal,
      lotSz: this.lotSz,
      refPrice: this.lastPriceV,
    }
    const body = algo ? buildAlgoBody(args) : buildOrderBody(args)
    const ack = algo ? await this.o.account.placeAlgoOrder(body) : await this.o.account.placeOrder(body)

    const order: Order = {
      id: clOrdId,
      clientId: clOrdId,
      botId: this.o.botId,
      market: this.market,
      symbol: this.symbol,
      side: req.side,
      type: req.type,
      status: isTriggerOrder(req.type) ? 'TRIGGER_PENDING' : 'NEW',
      qty: this.baseQty(req),
      executedQty: 0,
      cumQuote: 0,
      price: req.price,
      stopPrice: req.stopPrice,
      timeInForce: req.timeInForce ?? 'GTC',
      reduceOnly: req.reduceOnly ?? false,
      ocoGroup: req.ocoGroup,
      reason: req.reason,
      tag: req.tag,
      exchangeOrderId: ack.ordId || ack.algoId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.orders.set(clOrdId, order)
    this.o.events.onOrderUpdate(order)
    return order
  }

  async cancel(orderId: string): Promise<Order | null> {
    const order = this.orders.get(orderId)
    if (!order) return null
    if (isTriggerOrder(order.type)) {
      await this.o.account.cancelAlgoOrder(this.instId, { algoClOrdId: order.clientId })
    } else {
      await this.o.account.cancelOrder(this.instId, { clOrdId: order.clientId })
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

  // -------------------------------------------------- private channel routing

  /** private `orders` channel push (one per fill or state change) */
  handleOrderEvent(ev: OkxOrderEvent): void {
    const order = this.orders.get(ev.clOrdId)
    if (!order) return
    order.status = mapOkxState(ev.state, order.type, order.executedQty)
    order.executedQty = Number(ev.accFillSz ?? order.executedQty)
    order.updatedAt = Date.now()

    const d = parseFill(ev, this.market, this.ctVal)
    if (d) {
      if (this.market === 'spot') {
        this.applySpotFill(order, d.lastQty, d.price, d.fee, d.feeCcy, d.time, d.maker)
      } else {
        this.applyFuturesFill(order, d.lastQty, d.price, d.fee, d.feeCcy, d.pnl, d.time, d.maker)
      }
    }
    this.o.events.onOrderUpdate(order)
    if (d) void this.cancelOcoSiblings(order)
  }

  // ------------------------------------------------------------ internals

  /** base asset quantity implied by the request (display/bookkeeping). */
  private baseQty(req: OrderRequest): number {
    if (req.qty !== undefined) return req.qty
    if (req.quoteQty !== undefined && this.lastPriceV > 0) return req.quoteQty / this.lastPriceV
    return 0
  }

  /** Re-adopt a still-open (non-algo) order from `orders-pending`. The push
   *  shape only carries identity/state/accumulated fills, so type defaults to
   *  LIMIT (algo/trigger orders come from a separate endpoint). */
  private mapRawOrder(ev: OkxOrderEvent, clOrdId: string): Order {
    const executedQty =
      this.market === 'futures'
        ? contractsToBase(Number(ev.accFillSz ?? 0), this.ctVal)
        : Number(ev.accFillSz ?? 0)
    const order: Order = {
      id: clOrdId,
      clientId: clOrdId,
      botId: this.o.botId,
      market: this.market,
      symbol: this.symbol,
      side: ev.side === 'sell' ? 'SELL' : 'BUY',
      type: 'LIMIT',
      status: mapOkxState(ev.state, 'LIMIT', executedQty),
      qty: executedQty,
      executedQty,
      cumQuote: 0,
      price: ev.avgPx !== undefined && Number(ev.avgPx) > 0 ? Number(ev.avgPx) : undefined,
      timeInForce: 'GTC',
      reduceOnly: false,
      exchangeOrderId: ev.ordId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    return order
  }

  /** Normalize a fee charged in `ccy` to quote currency (BNB no longer exists
   *  on OKX, so this is synchronous). */
  private feeToQuote(amount: number, ccy: string, price: number): number {
    if (amount === 0) return 0
    if (ccy === this.o.symbolInfo.quoteAsset || ccy === 'USDT') return amount
    if (ccy === this.o.symbolInfo.baseAsset) return amount * price
    return 0
  }

  private applySpotFill(
    order: Order,
    qty: number,
    price: number,
    feeAmt: number,
    feeCcy: string,
    time: number,
    maker: boolean,
  ): void {
    const feeQuote = this.feeToQuote(feeAmt, feeCcy, price)
    if (order.side === 'BUY') {
      const received = feeCcy === this.o.symbolInfo.baseAsset ? qty - feeAmt : qty
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
    this.emitFill(order, qty, price, feeQuote, feeCcy, time, maker)
  }

  private applyFuturesFill(
    order: Order,
    qty: number,
    price: number,
    feeAmt: number,
    feeCcy: string,
    realized: number,
    time: number,
    maker: boolean,
  ): void {
    const feeQuote = this.feeToQuote(feeAmt, feeCcy, price)
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
    this.emitFill(order, qty, price, feeQuote, feeCcy, time, maker)
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
