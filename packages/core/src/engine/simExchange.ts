import {
  effectiveFeeRate,
  flatPosition,
  floorToStep,
  isTriggerOrder,
  type Balance,
  type Candle,
  type FeeConfig,
  type Fill,
  type IntrabarPath,
  type MarketType,
  type Order,
  type OrderRequest,
  type Position,
  type SymbolInfo,
} from '@tpx/shared'
import type { ExecutionAdapter } from '../strategy/types'
import type { SimEvents } from './types'

export interface SimExchangeOptions {
  market: MarketType
  symbol: string
  symbolInfo: SymbolInfo | null
  initialBalance: number
  /** futures only */
  leverage: number
  fees: FeeConfig
  /** e.g. 0.0005 — applied against us on taker (market / triggered-market) fills */
  slippagePct: number
  intrabarPath: IntrabarPath
  /** aggtrades mode: max share of a printed trade's volume our limit absorbs */
  limitFillRatio: number
  /** futures: maintenance margin rate for the isolated liquidation approximation */
  maintenanceMarginRate: number
  events?: SimEvents
}

interface SimOrder extends Order {
  /** spot: funds locked when the order was placed */
  lockedQuote: number
  lockedBase: number
}

/**
 * In-memory exchange simulator implementing ExecutionAdapter for spot and
 * USDT-M futures.
 *
 * Matching model (candle mode): the engine calls processCandle() with each
 * closed candle of the traded symbol BEFORE the strategy sees it, so orders
 * are only ever matched against price action that happened after they were
 * placed. Market orders queue and fill on the next candle's open (or next
 * aggTrade), never on the candle that triggered the decision — no lookahead
 * by construction.
 *
 * Accounting:
 * - spot: quote + base balances, exchange-style fund locking on resting
 *   orders. Without BNB discount, fees shave the received asset (Binance
 *   behavior); with it, fees are deducted from the quote balance as a BNB
 *   proxy and tallied in bnbFeesQuote.
 * - futures: isolated margin, signed position, avg-entry tracking, funding
 *   transfers, liquidation when the intrabar path crosses the approximate
 *   liquidation price (margin is lost, position closed at that price).
 */
export class SimExchange implements ExecutionAdapter {
  readonly market: MarketType
  readonly symbol: string

  private readonly o: SimExchangeOptions
  private readonly events: SimEvents

  private time = 0
  private lastPriceV = 0

  // spot balances
  private quoteFree = 0
  private quoteLocked = 0
  private baseFree = 0
  private baseLocked = 0
  // futures wallet
  private wallet = 0
  private usedMargin = 0

  // position (futures signed; spot >= 0 with cost basis)
  private posQty = 0
  private posEntry = 0

  private orders = new Map<string, SimOrder>()
  private pendingMarketIds: string[] = []
  private orderSeq = 0
  private fillSeq = 0

  // accumulators
  totalFees = 0
  bnbFeesQuote = 0
  totalFunding = 0
  liquidated = false

  constructor(opts: SimExchangeOptions) {
    this.o = opts
    this.market = opts.market
    this.symbol = opts.symbol
    this.events = opts.events ?? {}
    if (opts.market === 'spot') {
      this.quoteFree = opts.initialBalance
    } else {
      this.wallet = opts.initialBalance
    }
  }

  // ------------------------------------------------------------ engine API

  setTime(t: number): void {
    this.time = t
  }

  setLastPrice(p: number): void {
    this.lastPriceV = p
  }

  /** Candle-mode matching. Call BEFORE the strategy sees the candle. */
  processCandle(c: Candle): void {
    this.lastPriceV = c.open
    this.fillPendingMarkets(c.open)

    const up = c.close >= c.open
    // heuristic path: down first on green candles, up first on red ones
    const segments: [number, number][] = up
      ? [
          [c.open, c.low],
          [c.low, c.high],
          [c.high, c.close],
        ]
      : [
          [c.open, c.high],
          [c.high, c.low],
          [c.low, c.close],
        ]
    for (const [from, to] of segments) {
      this.walkSegment(from, to)
      if (this.liquidated) break
    }
    this.lastPriceV = c.close
  }

  /** aggTrades-mode matching. Call BEFORE the strategy sees the trade. */
  processAggTrade(price: number, qty: number): void {
    this.fillPendingMarkets(price)
    this.matchAtPrice(price, qty)
    this.lastPriceV = price
    this.checkLiquidationAt(price)
  }

  /** futures: apply a funding event to the open position. Returns the signed transfer. */
  applyFunding(rate: number): number {
    if (this.market !== 'futures' || this.posQty === 0) return 0
    const amount = -rate * this.posQty * this.lastPriceV
    this.wallet += amount
    this.totalFunding += amount
    return amount
  }

  // ------------------------------------------------------ ExecutionAdapter

  now(): number {
    return this.time
  }

  lastPrice(): number {
    return this.lastPriceV
  }

  symbolInfo(): SymbolInfo | null {
    return this.o.symbolInfo
  }

  async submit(req: OrderRequest): Promise<Order> {
    const order: SimOrder = {
      id: `sim-${++this.orderSeq}`,
      clientId: req.clientId ?? `sim-${this.orderSeq}`,
      market: this.market,
      symbol: this.symbol,
      side: req.side,
      type: req.type,
      status: isTriggerOrder(req.type) ? 'TRIGGER_PENDING' : 'NEW',
      qty: req.qty ?? 0,
      executedQty: 0,
      cumQuote: 0,
      price: req.price,
      stopPrice: req.stopPrice,
      timeInForce: req.timeInForce ?? 'GTC',
      reduceOnly: this.market === 'futures' ? (req.reduceOnly ?? false) : false,
      ocoGroup: req.ocoGroup,
      reason: req.reason,
      tag: req.tag,
      createdAt: this.time,
      updatedAt: this.time,
      lockedQuote: 0,
      lockedBase: 0,
    }

    if (req.type === 'MARKET') {
      if (req.qty === undefined && req.quoteQty === undefined) {
        throw new Error('MARKET order needs qty or quoteQty')
      }
      if (req.quoteQty !== undefined) {
        // converted at fill price; stash in cumQuote temporarily? no — keep on price field unused.
        ;(order as SimOrder & { quoteQty?: number }).qty = 0
        ;(order as SimOrder & { __quoteQty?: number }).__quoteQty = req.quoteQty
      }
      this.orders.set(order.id, order)
      this.pendingMarketIds.push(order.id)
      this.events.onOrderUpdate?.(order.id)
      return order
    }

    if (order.qty <= 0) throw new Error(`${order.type} order needs a positive qty`)

    // post-only: reject if it would cross immediately
    if (order.type === 'LIMIT_MAKER' && this.lastPriceV > 0) {
      const crosses = order.side === 'BUY' ? order.price! >= this.lastPriceV : order.price! <= this.lastPriceV
      if (crosses) {
        order.status = 'REJECTED'
        this.events.onOrderUpdate?.(order.id)
        throw new Error(`LIMIT_MAKER would cross the market (price ${order.price}, last ${this.lastPriceV})`)
      }
    }

    this.lockFundsFor(order)
    this.orders.set(order.id, order)
    this.events.onOrderUpdate?.(order.id)
    return order
  }

  async cancel(orderId: string): Promise<Order | null> {
    const o = this.orders.get(orderId)
    if (!o) return null
    if (o.status !== 'NEW' && o.status !== 'TRIGGER_PENDING' && o.status !== 'PARTIALLY_FILLED') return o
    this.releaseLocks(o)
    o.status = 'CANCELED'
    o.updatedAt = this.time
    this.pendingMarketIds = this.pendingMarketIds.filter((id) => id !== orderId)
    this.events.onOrderUpdate?.(o.id)
    return o
  }

  openOrders(): readonly Order[] {
    const out: Order[] = []
    for (const o of this.orders.values()) {
      if (o.status === 'NEW' || o.status === 'TRIGGER_PENDING' || o.status === 'PARTIALLY_FILLED') out.push(o)
    }
    return out
  }

  getOrder(id: string): Order | null {
    return this.orders.get(id) ?? null
  }

  position(): Position {
    const p = flatPosition(this.market, this.symbol, this.o.leverage)
    p.qty = this.posQty
    p.entryPrice = this.posEntry
    p.updatedAt = this.time
    if (this.market === 'futures' && this.posQty !== 0) {
      p.unrealizedPnl = (this.lastPriceV - this.posEntry) * this.posQty
      p.liquidationPrice = this.liquidationPrice()
    } else if (this.market === 'spot' && this.posQty > 0) {
      p.unrealizedPnl = (this.lastPriceV - this.posEntry) * this.posQty
    }
    return p
  }

  balances(): readonly Balance[] {
    if (this.market === 'spot') {
      const si = this.o.symbolInfo
      return [
        { asset: si?.quoteAsset ?? 'QUOTE', free: this.quoteFree, locked: this.quoteLocked },
        { asset: si?.baseAsset ?? 'BASE', free: this.baseFree, locked: this.baseLocked },
      ]
    }
    return [{ asset: 'USDT', free: this.wallet - this.usedMargin, locked: this.usedMargin }]
  }

  equity(): number {
    if (this.market === 'spot') {
      return this.quoteFree + this.quoteLocked + (this.baseFree + this.baseLocked) * this.lastPriceV
    }
    return this.wallet + (this.posQty === 0 ? 0 : (this.lastPriceV - this.posEntry) * this.posQty)
  }

  // ------------------------------------------------------------- internals

  private liquidationPrice(): number | null {
    if (this.market !== 'futures' || this.posQty === 0) return null
    const mmr = this.o.maintenanceMarginRate
    const lev = this.o.leverage
    if (this.posQty > 0) return (this.posEntry * (1 - 1 / lev)) / (1 - mmr)
    return (this.posEntry * (1 + 1 / lev)) / (1 + mmr)
  }

  private checkLiquidationAt(price: number): void {
    if (this.market !== 'futures' || this.posQty === 0 || this.liquidated) return
    const liq = this.liquidationPrice()
    if (liq === null || liq <= 0) return
    const hit = this.posQty > 0 ? price <= liq : price >= liq
    if (hit) this.liquidate(liq)
  }

  private liquidate(price: number): void {
    const qty = -this.posQty
    this.executeFill(null, qty > 0 ? 'BUY' : 'SELL', Math.abs(qty), price, false, 'liquidation')
    this.liquidated = true
    // cancel everything left
    for (const o of [...this.orders.values()]) {
      if (o.status === 'NEW' || o.status === 'TRIGGER_PENDING' || o.status === 'PARTIALLY_FILLED') {
        this.releaseLocks(o)
        o.status = 'CANCELED'
        o.updatedAt = this.time
        this.events.onOrderUpdate?.(o.id)
      }
    }
    this.pendingMarketIds = []
    this.events.onLiquidation?.(price, this.time)
  }

  private lockFundsFor(o: SimOrder): void {
    if (this.market !== 'spot') {
      // futures: margin check at placement for non-reduceOnly orders
      if (!o.reduceOnly) {
        const ref = o.price ?? o.stopPrice ?? this.lastPriceV
        const margin = (o.qty * ref) / this.o.leverage
        const free = this.wallet - this.usedMargin
        if (margin > free * 1.0001) {
          o.status = 'REJECTED'
          throw new Error(`Insufficient margin: need ${margin.toFixed(2)}, free ${free.toFixed(2)}`)
        }
      }
      return
    }
    const ref = o.price ?? o.stopPrice ?? this.lastPriceV
    if (o.side === 'BUY') {
      const need = o.qty * ref
      if (need > this.quoteFree * 1.0000001) {
        o.status = 'REJECTED'
        throw new Error(`Insufficient quote balance: need ${need.toFixed(2)}, free ${this.quoteFree.toFixed(2)}`)
      }
      this.quoteFree -= need
      this.quoteLocked += need
      o.lockedQuote = need
    } else {
      if (o.qty > this.baseFree * 1.0000001) {
        o.status = 'REJECTED'
        throw new Error(`Insufficient base balance: need ${o.qty}, free ${this.baseFree}`)
      }
      this.baseFree -= o.qty
      this.baseLocked += o.qty
      o.lockedBase = o.qty
    }
  }

  private releaseLocks(o: SimOrder): void {
    if (o.lockedQuote > 0) {
      this.quoteLocked -= o.lockedQuote
      this.quoteFree += o.lockedQuote
      o.lockedQuote = 0
    }
    if (o.lockedBase > 0) {
      this.baseLocked -= o.lockedBase
      this.baseFree += o.lockedBase
      o.lockedBase = 0
    }
  }

  private fillPendingMarkets(price: number): void {
    if (this.pendingMarketIds.length === 0) return
    const ids = this.pendingMarketIds
    this.pendingMarketIds = []
    for (const id of ids) {
      const o = this.orders.get(id)
      if (!o || (o.status !== 'NEW' && o.status !== 'TRIGGER_PENDING')) continue
      const slip = this.o.slippagePct
      const px = o.side === 'BUY' ? price * (1 + slip) : price * (1 - slip)
      let qty = o.qty
      const quoteQty = (o as SimOrder & { __quoteQty?: number }).__quoteQty
      if (quoteQty !== undefined && qty === 0) {
        qty = quoteQty / px
        const si = this.o.symbolInfo
        if (si) qty = floorToStep(qty, si.stepSize)
        o.qty = qty
      }
      if (qty <= 0) {
        o.status = 'REJECTED'
        o.updatedAt = this.time
        this.events.onOrderUpdate?.(o.id)
        continue
      }
      this.fillOrder(o, px, false, qty)
    }
  }

  /** matching for one traversal from price `from` to `to` */
  private walkSegment(from: number, to: number): void {
    if (from === to) {
      this.matchAtPrice(from, Number.POSITIVE_INFINITY)
      return
    }
    const dirUp = to > from
    let cursor = from

    // liquidation can interleave with order fills along the path
    for (let guard = 0; guard < 10_000; guard++) {
      let bestPrice = Number.NaN
      let bestOrder: SimOrder | null = null
      let bestIsTrigger = false
      let bestIsLiq = false

      const consider = (price: number, order: SimOrder | null, isTrigger: boolean, isLiq: boolean) => {
        const within = dirUp ? price >= cursor && price <= to : price <= cursor && price >= to
        if (!within) return
        const better =
          Number.isNaN(bestPrice) ||
          (dirUp ? price < bestPrice : price > bestPrice) ||
          // co-located events: pessimistic gives priority to liquidation, then triggers
          (price === bestPrice && this.o.intrabarPath === 'pessimistic' && (isLiq || (isTrigger && !bestIsLiq)))
        if (better) {
          bestPrice = price
          bestOrder = order
          bestIsTrigger = isTrigger
          bestIsLiq = isLiq
        }
      }

      if (this.market === 'futures' && this.posQty !== 0 && !this.liquidated) {
        const liq = this.liquidationPrice()
        if (liq !== null) {
          const crossing = this.posQty > 0 ? !dirUp : dirUp
          if (crossing) consider(liq, null, false, true)
        }
      }

      for (const o of this.orders.values()) {
        if (o.status === 'NEW' || o.status === 'PARTIALLY_FILLED') {
          if (o.type === 'LIMIT' || o.type === 'LIMIT_MAKER' || o.type === 'STOP_LIMIT' || o.type === 'TAKE_PROFIT_LIMIT') {
            const limit = o.price!
            // BUY limits fill when price moves down to them, SELL limits when up
            if (o.side === 'BUY' && !dirUp) consider(Math.min(limit, cursor), o, false, false)
            if (o.side === 'SELL' && dirUp) consider(Math.max(limit, cursor), o, false, false)
          }
        } else if (o.status === 'TRIGGER_PENDING') {
          const stop = o.stopPrice!
          const triggersUp =
            (o.type === 'STOP_MARKET' || o.type === 'STOP_LIMIT') === (o.side === 'BUY')
          // STOP BUY / TP SELL trigger on the way up; STOP SELL / TP BUY on the way down
          if (triggersUp === dirUp) {
            const evPrice = dirUp ? Math.max(stop, cursor) : Math.min(stop, cursor)
            consider(evPrice, o, true, false)
          }
        }
      }

      if (Number.isNaN(bestPrice)) return

      cursor = bestPrice
      if (bestIsLiq) {
        this.liquidate(bestPrice)
        return
      }
      const o = bestOrder as SimOrder | null
      if (!o) return
      if (bestIsTrigger) {
        this.activateTrigger(o, bestPrice)
      } else {
        // resting limit: maker fill at its limit price (or better if gapped at cursor start)
        const px = o.side === 'BUY' ? Math.min(o.price!, cursor) : Math.max(o.price!, cursor)
        this.fillOrder(o, px, true, o.qty - o.executedQty)
      }
      if (this.liquidated) return
    }
  }

  /** aggtrades-mode matching at one printed price with available volume */
  private matchAtPrice(price: number, printedQty: number): void {
    for (const o of [...this.orders.values()]) {
      if (o.status === 'TRIGGER_PENDING') {
        const stop = o.stopPrice!
        const isStop = o.type === 'STOP_MARKET' || o.type === 'STOP_LIMIT'
        const triggered =
          (isStop && o.side === 'BUY' && price >= stop) ||
          (isStop && o.side === 'SELL' && price <= stop) ||
          (!isStop && o.side === 'BUY' && price <= stop) ||
          (!isStop && o.side === 'SELL' && price >= stop)
        if (triggered) this.activateTrigger(o, price)
      }
    }
    for (const o of [...this.orders.values()]) {
      if (o.status !== 'NEW' && o.status !== 'PARTIALLY_FILLED') continue
      if (o.type === 'LIMIT' || o.type === 'LIMIT_MAKER') {
        const crossed = o.side === 'BUY' ? price <= o.price! : price >= o.price!
        if (!crossed) continue
        const remaining = o.qty - o.executedQty
        const fillQty = Number.isFinite(printedQty)
          ? Math.min(remaining, printedQty * this.o.limitFillRatio)
          : remaining
        if (fillQty > 0) this.fillOrder(o, o.price!, true, fillQty)
      }
    }
  }

  private activateTrigger(o: SimOrder, atPrice: number): void {
    this.cancelOcoSiblings(o)
    if (o.type === 'STOP_MARKET' || o.type === 'TAKE_PROFIT_MARKET') {
      const slip = this.o.slippagePct
      const px = o.side === 'BUY' ? atPrice * (1 + slip) : atPrice * (1 - slip)
      this.fillOrder(o, px, false, o.qty)
    } else {
      // becomes a resting limit
      o.status = 'NEW'
      o.updatedAt = this.time
      this.events.onOrderUpdate?.(o.id)
    }
  }

  private cancelOcoSiblings(o: SimOrder): void {
    if (!o.ocoGroup) return
    for (const sib of this.orders.values()) {
      if (sib.id === o.id || sib.ocoGroup !== o.ocoGroup) continue
      if (sib.status === 'NEW' || sib.status === 'TRIGGER_PENDING' || sib.status === 'PARTIALLY_FILLED') {
        this.releaseLocks(sib)
        sib.status = 'CANCELED'
        sib.updatedAt = this.time
        this.events.onOrderUpdate?.(sib.id)
      }
    }
  }

  private fillOrder(o: SimOrder, price: number, maker: boolean, qty: number): void {
    this.cancelOcoSiblings(o)
    let fillQty = Math.min(qty, o.qty - o.executedQty)
    if (this.market === 'futures' && o.reduceOnly) {
      const reducible =
        (o.side === 'SELL' && this.posQty > 0 && this.posQty) ||
        (o.side === 'BUY' && this.posQty < 0 && -this.posQty) ||
        0
      fillQty = Math.min(fillQty, reducible)
      if (fillQty <= 0) {
        o.status = 'CANCELED'
        o.updatedAt = this.time
        this.events.onOrderUpdate?.(o.id)
        return
      }
    }
    if (fillQty <= 0) return

    const executed = this.executeFill(o, o.side, fillQty, price, maker, o.reason)
    if (!executed) return

    o.executedQty += fillQty
    o.cumQuote += fillQty * price
    o.status = o.executedQty >= o.qty - 1e-12 ? 'FILLED' : 'PARTIALLY_FILLED'
    o.updatedAt = this.time
    if (o.status === 'FILLED') this.releaseLocks(o)
    this.events.onOrderUpdate?.(o.id)
  }

  /**
   * Apply one execution to balances/position and emit the Fill.
   * `order` is null for liquidations.
   */
  private executeFill(
    o: SimOrder | null,
    side: 'BUY' | 'SELL',
    qty: number,
    price: number,
    maker: boolean,
    reason?: string,
  ): boolean {
    const notional = qty * price
    const rate = effectiveFeeRate(this.o.fees, this.market, maker)
    const feeQuote = notional * rate
    let feeAsset = 'QUOTE'

    if (this.market === 'spot') {
      const si = this.o.symbolInfo
      if (side === 'BUY') {
        const fromLocked = Math.min(o?.lockedQuote ?? 0, notional)
        if (o && fromLocked > 0) {
          o.lockedQuote -= fromLocked
          this.quoteLocked -= fromLocked
        }
        const fromFree = notional - fromLocked
        if (fromFree > this.quoteFree + 1e-9) {
          if (o) {
            o.status = 'REJECTED'
            o.updatedAt = this.time
            this.events.onOrderUpdate?.(o.id)
          }
          return false
        }
        this.quoteFree -= fromFree
        if (this.o.fees.bnbDiscount) {
          this.baseFree += qty
          this.quoteFree -= feeQuote
          this.bnbFeesQuote += feeQuote
          feeAsset = 'BNB'
        } else {
          this.baseFree += qty * (1 - rate)
          feeAsset = si?.baseAsset ?? 'BASE'
        }
        // cost basis
        const newQty = this.posQty + qty
        this.posEntry = newQty > 0 ? (this.posEntry * this.posQty + price * qty) / newQty : 0
        this.posQty = newQty
      } else {
        const fromLocked = Math.min(o?.lockedBase ?? 0, qty)
        if (o && fromLocked > 0) {
          o.lockedBase -= fromLocked
          this.baseLocked -= fromLocked
        }
        const fromFree = qty - fromLocked
        if (fromFree > this.baseFree + 1e-12) {
          if (o) {
            o.status = 'REJECTED'
            o.updatedAt = this.time
            this.events.onOrderUpdate?.(o.id)
          }
          return false
        }
        this.baseFree -= fromFree
        if (this.o.fees.bnbDiscount) {
          this.quoteFree += notional
          this.quoteFree -= feeQuote
          this.bnbFeesQuote += feeQuote
          feeAsset = 'BNB'
        } else {
          this.quoteFree += notional * (1 - rate)
          feeAsset = this.o.symbolInfo?.quoteAsset ?? 'QUOTE'
        }
        this.posQty = Math.max(0, this.posQty - qty)
        if (this.posQty === 0) this.posEntry = 0
      }
    } else {
      // futures, isolated margin
      const signed = side === 'BUY' ? qty : -qty
      const sameDir = this.posQty === 0 || Math.sign(signed) === Math.sign(this.posQty)
      if (sameDir) {
        const addMargin = notional / this.o.leverage
        const free = this.wallet - this.usedMargin
        if (o && !o.reduceOnly && addMargin > free + 1e-9) {
          o.status = 'REJECTED'
          o.updatedAt = this.time
          this.events.onOrderUpdate?.(o.id)
          return false
        }
        const newQty = this.posQty + signed
        this.posEntry =
          newQty !== 0 ? (this.posEntry * Math.abs(this.posQty) + price * qty) / Math.abs(newQty) : 0
        this.posQty = newQty
        this.usedMargin += addMargin
      } else {
        const closing = Math.min(qty, Math.abs(this.posQty))
        const realized = (price - this.posEntry) * closing * Math.sign(this.posQty)
        this.wallet += realized
        const releasedMargin = (this.posEntry * closing) / this.o.leverage
        this.usedMargin = Math.max(0, this.usedMargin - releasedMargin)
        const remainder = qty - closing
        const prevSign = Math.sign(this.posQty)
        this.posQty = this.posQty + signed
        if (Math.abs(this.posQty) < 1e-12) {
          this.posQty = 0
          this.posEntry = 0
        } else if (Math.sign(this.posQty) !== prevSign) {
          // flipped: remainder opens a fresh position at this price
          this.posEntry = price
          this.usedMargin += (remainder * price) / this.o.leverage
        }
      }
      this.wallet -= feeQuote
      feeAsset = this.o.fees.bnbDiscount ? 'BNB' : 'USDT'
      if (this.o.fees.bnbDiscount) this.bnbFeesQuote += feeQuote
    }

    this.totalFees += feeQuote
    this.lastPriceV = price

    const fill: Fill = {
      id: `fill-${++this.fillSeq}`,
      orderId: o?.id ?? 'liquidation',
      market: this.market,
      symbol: this.symbol,
      side,
      price,
      qty,
      quoteQty: notional,
      fee: feeQuote,
      feeAsset,
      maker,
      time: this.time,
      tag: o?.tag,
      reason: reason ?? o?.reason,
    }
    this.events.onFill?.(fill, o?.id ?? 'liquidation')
    return true
  }
}
