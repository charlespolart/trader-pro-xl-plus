import {
  isTriggerOrder,
  type Balance,
  type Fill,
  type MarketType,
  type Order,
  type OrderRequest,
  type OrderType,
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
  type OkxPrivateEvent,
  type OkxPrivateStream,
  type OkxRestOrder,
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

/** A resting order known to the bot (from the DB), passed to reconcile() to
 *  catch up on any fill that happened while the bot was down (spot). */
export interface RestingOrderRef {
  clientId: string
  side: 'BUY' | 'SELL'
  /** executed quantity last persisted by the bot */
  executedQty: number
  /** cumulative quote last known to the bot */
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
    // symbolInfo.stepSize est en unités BASE (le botManager convertit lotSz×ctVal
    // pour les SWAP) ; les builders d'ordres OKX veulent le pas en CONTRATS.
    this.lotSz = opts.symbolInfo.stepSize / this.ctVal
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
   * Re-adopt resting orders after a restart and catch up on fills missed while
   * the bot was down.
   * - Still-open regular orders: re-adopted (the bot resumes tracking them).
   * - Resting ALGO (stop/TP) orders: OKX keeps these in a SEPARATE pending list
   *   (`openAlgoOrders`), so they are re-adopted too. Without this, a stop that
   *   fires after a restart would reach `handleOrderEvent` with an unknown
   *   clOrdId and be dropped, leaving a phantom futures position.
   * - Futures: the exchange's real position is the source of truth (it corrects
   *   any divergence, including a missed fill — the isolated position is ground
   *   truth).
   * - Spot: there is no exchange-side "position" (the balance includes off-bot
   *   coins, so it cannot be adopted). Catching up on missed fills for the bot's
   *   known RESTING orders would need a per-order getOrder, not yet implemented
   *   on OkxAccount -> we log and skip (spec §14, follow-up).
   * Everything is guarded: an API error is logged and never blocks startup.
   */
  async reconcile(resting: RestingOrderRef[] = []): Promise<string[]> {
    const notes: string[] = []
    const stillOpen = new Set<string>()
    // `openOrders` only returns regular (non-algo) orders.
    const raw = await this.o.account.openOrders(this.instId)
    for (const r of raw) {
      const cid = r.clOrdId ?? ''
      if (!cid.startsWith(this.prefix)) continue
      const order = this.mapRawOrder(r, cid)
      this.orders.set(cid, order)
      stillOpen.add(cid)
      notes.push(`re-adopted open order ${cid} (${order.type} ${order.side})`)
    }
    // Resting ALGO (stop/TP) orders live in a separate OKX pending list. Re-adopt
    // them so a stop firing after a restart is attributed instead of dropped.
    const algos = await this.o.account.openAlgoOrders(this.instId)
    for (const r of algos) {
      const cid = r.algoClOrdId ?? r.clOrdId ?? ''
      if (!cid.startsWith(this.prefix)) continue
      const order = this.mapRawOrder(r, cid)
      this.orders.set(cid, order)
      stillOpen.add(cid)
      notes.push(`re-adopted resting algo order ${cid} (${order.type} ${order.side})`)
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
    // ---- SPOT: catch up on missed fills for resting orders that are now closed.
    // OkxAccount does not expose a getOrder(instId, { clOrdId }) yet, so we cannot
    // read the final state of an order that is no longer open. Deferred (spec §14).
    for (const ro of resting) {
      if (stillOpen.has(ro.clientId)) continue
      notes.push(
        `reconciliation of order ${ro.clientId} skipped: OKX getOrder not implemented ` +
          `(missed-fill catch-up deferred — spec §14)`,
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
    // Le canal WS `orders-algo` n'est PAS souscrit (il vit sur /business) : un
    // algo annulé n'émettra AUCUN événement. Sans marquage local il resterait
    // TRIGGER_PENDING pour toujours → openOrders() le renvoie → le cancelAll du
    // cycle suivant retente d'annuler un ordre inexistant. On confirme donc
    // localement après un cancel REST réussi (les ordres normaux, eux, seront
    // aussi confirmés par leur push WS `canceled` — idempotent).
    if (order.status === 'NEW' || order.status === 'TRIGGER_PENDING' || order.status === 'PARTIALLY_FILLED') {
      order.status = 'CANCELED'
      order.updatedAt = Date.now()
      this.o.events.onOrderUpdate(order)
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

  /**
   * private `orders` channel push (one per fill or state change).
   *
   * RESIDUAL RISK (confirm in demo — spec §14): when an algo (stop/TP) order
   * TRIGGERS, OKX places a NEW regular order to do the actual fill. We rely on
   * that regular order carrying our `clOrdId` prefix on the `orders` channel so
   * the fill is attributed here. If OKX instead assigns a fresh clOrdId without
   * our prefix, a triggered-stop fill would early-return below and be dropped.
   * This is the honest residual risk and must be confirmed against the demo API.
   */
  handleOrderEvent(ev: OkxOrderEvent): void {
    const order = this.orders.get(ev.clOrdId)
    if (!order) return
    order.status = mapOkxState(ev.state, order.type, order.executedQty)
    // accFillSz is in CONTRACTS on futures but order.qty is in BASE; convert to
    // keep both consistent. Spot accFillSz is already in base coin units.
    order.executedQty =
      this.market === 'futures'
        ? contractsToBase(Number(ev.accFillSz ?? 0), this.ctVal)
        : Number(ev.accFillSz ?? order.executedQty)
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

  /** Re-adopt a resting order returned by `orders-pending` / `orders-algo-pending`.
   *  Builds a faithful `Order` from the REST shape. For algo (trigger) orders the
   *  stop-vs-TP subtype is best-effort — the point is that the order is PRESENT
   *  (status TRIGGER_PENDING) so its later fill is attributed. `ocoGroup` cannot
   *  be recovered from OKX (the Binance template couldn't either — that's parity). */
  private mapRawOrder(r: OkxRestOrder, clOrdId: string): Order {
    const type = mapRestOrdType(r)
    const toBase = (s: string | undefined) =>
      this.market === 'futures' ? contractsToBase(Number(s ?? 0), this.ctVal) : Number(s ?? 0)
    const executedQty = toBase(r.accFillSz)
    const order: Order = {
      id: clOrdId,
      clientId: clOrdId,
      botId: this.o.botId,
      market: this.market,
      symbol: this.symbol,
      side: r.side === 'sell' ? 'SELL' : 'BUY',
      type,
      status: mapOkxState(r.state, type, executedQty),
      qty: toBase(r.sz),
      executedQty,
      cumQuote: 0,
      price: r.px !== undefined && Number(r.px) > 0 ? Number(r.px) : undefined,
      stopPrice: r.triggerPx !== undefined && Number(r.triggerPx) > 0 ? Number(r.triggerPx) : undefined,
      timeInForce: 'GTC',
      reduceOnly: false,
      exchangeOrderId: r.ordId ?? r.algoId,
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
      const feeInBase = feeCcy === this.o.symbolInfo.baseAsset
      const received = feeInBase ? qty - feeAmt : qty
      const newQty = this.posQty + received
      this.posEntry = newQty > 0 ? (this.posEntry * this.posQty + price * qty) / newQty : 0
      this.posQty = newQty
      // ne PAS re-soustraire le fee si déjà rogné sur la base reçue (sinon
      // double comptage dans equity() : une fois via received, une fois ici)
      if (!feeInBase) this.realizedNet -= feeQuote
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

/** Map an OKX REST `ordType` to a TPX OrderType. For `trigger`, a real `px`
 *  (limit price) means a stop/TP-limit; otherwise it is a stop/TP-market.
 *  The stop-vs-TP distinction cannot be recovered from OKX, so STOP_* is used. */
function mapRestOrdType(r: OkxRestOrder): OrderType {
  switch (r.ordType) {
    case 'market':
      return 'MARKET'
    case 'post_only':
      return 'LIMIT_MAKER'
    case 'trigger':
      return r.px !== undefined && Number(r.px) > 0 ? 'STOP_LIMIT' : 'STOP_MARKET'
    default:
      return 'LIMIT'
  }
}

/**
 * Fans out a single OKX private socket to the live adapters of one account.
 * One router per account (OKX unified account carries spot + swap), so every
 * bot on that account shares the socket. Only `orders` / `orders-algo` channels
 * are routed; each event is delivered to the adapter whose `clientIdPrefix` is a
 * prefix of the order's `clOrdId` (or `algoClOrdId` for algo orders).
 */
export class OkxUserStreamRouter {
  private adapters = new Map<string, OKXLiveAdapter>()

  constructor(
    private readonly stream: OkxPrivateStream | null,
    private readonly onError: (e: Error) => void,
  ) {
    this.stream?.onEvent((ev) => this.dispatch(ev))
  }

  async start(): Promise<void> {
    await this.stream?.start()
  }
  stop(): void {
    this.stream?.stop()
  }
  register(a: OKXLiveAdapter): void {
    this.adapters.set(a.clientIdPrefix, a)
  }
  unregister(a: OKXLiveAdapter): void {
    this.adapters.delete(a.clientIdPrefix)
  }
  get size(): number {
    return this.adapters.size
  }

  dispatch(ev: OkxPrivateEvent): void {
    if (ev.channel !== 'orders' && ev.channel !== 'orders-algo') return
    try {
      for (const o of ev.data) {
        const cid = o.clOrdId || (o as { algoClOrdId?: string }).algoClOrdId || ''
        const adapter = this.find(cid)
        adapter?.handleOrderEvent(o)
      }
    } catch (err) {
      this.onError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  private find(clientId: string): OKXLiveAdapter | undefined {
    for (const [prefix, a] of this.adapters) if (clientId.startsWith(prefix)) return a
    return undefined
  }
}
