import type { Candle, Fill, MarketType, TradeDirection, TradeRecord } from '@tpx/shared'

interface OpenTrade {
  id: string
  direction: TradeDirection
  entryTime: number
  entryQty: number
  entryNotional: number
  exitQty: number
  exitNotional: number
  maxQty: number
  fees: number
  funding: number
  mae: number
  mfe: number
  entryReason?: string
  exitReason?: string
  fills: Fill[]
}

/**
 * Rebuilds round-trip trades from the fill stream. Handles partial entries,
 * partial exits, and position flips (the flipping fill is split between the
 * closing trade and the newly opened one, fees pro-rated).
 */
export class TradeBuilder {
  private trades: TradeRecord[] = []
  private current: OpenTrade | null = null
  private posQty = 0
  private seq = 0

  constructor(
    private readonly market: MarketType,
    private readonly symbol: string,
    private readonly leverage: number,
    private readonly ids: { backtestId?: string; botId?: string } = {},
  ) {}

  onFill(fill: Fill): void {
    const signed = fill.side === 'BUY' ? fill.qty : -fill.qty
    const posBefore = this.posQty
    const posAfter = posBefore + signed
    this.posQty = posAfter

    if (this.current === null) {
      if (Math.abs(posAfter) < 1e-12) return
      this.openTrade(fill, Math.abs(signed))
      return
    }

    const dirSign = this.current.direction === 'long' ? 1 : -1
    if (Math.sign(signed) === dirSign) {
      // adding to the position
      this.current.entryQty += fill.qty
      this.current.entryNotional += fill.qty * fill.price
      this.current.maxQty = Math.max(this.current.maxQty, Math.abs(posAfter))
      this.current.fees += fill.fee
      this.current.fills.push(fill)
      return
    }

    // reducing / closing / flipping
    const closing = Math.min(fill.qty, Math.abs(posBefore))
    const remainder = fill.qty - closing
    const closeShare = fill.qty > 0 ? closing / fill.qty : 0

    this.current.exitQty += closing
    this.current.exitNotional += closing * fill.price
    this.current.fees += fill.fee * closeShare
    if (fill.reason) this.current.exitReason = fill.reason
    this.current.fills.push(fill)

    const flat = Math.abs(posAfter) < 1e-12
    const flipped = !flat && Math.sign(posAfter) !== dirSign

    if (flat || flipped) {
      this.closeTrade(fill.time)
      if (flipped && remainder > 1e-12) {
        this.openTrade(fill, remainder, fill.fee * (1 - closeShare))
      }
    }
  }

  /** futures funding transfer (signed; negative = we paid) while a trade is open */
  onFunding(amount: number): void {
    if (this.current) this.current.funding += amount
  }

  /** MAE/MFE tracking from the matching feed's candles */
  onCandle(c: Candle): void {
    if (!this.current || Math.abs(this.posQty) < 1e-12) return
    const avgEntry = this.current.entryNotional / this.current.entryQty
    const qty = Math.abs(this.posQty)
    const dir = this.current.direction === 'long' ? 1 : -1
    const worst = dir === 1 ? (c.low - avgEntry) * qty : (avgEntry - c.high) * qty
    const best = dir === 1 ? (c.high - avgEntry) * qty : (avgEntry - c.low) * qty
    this.current.mae = Math.min(this.current.mae, worst)
    this.current.mfe = Math.max(this.current.mfe, best)
  }

  /** Completed trades + the still-open one (exitTime null), if any. */
  finalize(): TradeRecord[] {
    const out = [...this.trades]
    if (this.current) out.push(this.toRecord(this.current, null))
    return out
  }

  get openTradeCount(): number {
    return this.current ? 1 : 0
  }

  private openTrade(fill: Fill, qty: number, feeOverride?: number): void {
    this.current = {
      id: `trade-${++this.seq}`,
      direction: fill.side === 'BUY' ? 'long' : 'short',
      entryTime: fill.time,
      entryQty: qty,
      entryNotional: qty * fill.price,
      exitQty: 0,
      exitNotional: 0,
      maxQty: qty,
      fees: feeOverride ?? fill.fee,
      funding: 0,
      mae: 0,
      mfe: 0,
      entryReason: fill.reason,
      fills: [fill],
    }
  }

  private closeTrade(time: number): void {
    if (!this.current) return
    this.trades.push(this.toRecord(this.current, time))
    this.current = null
  }

  private toRecord(t: OpenTrade, exitTime: number | null): TradeRecord {
    const avgEntry = t.entryQty > 0 ? t.entryNotional / t.entryQty : 0
    const avgExit = t.exitQty > 0 ? t.exitNotional / t.exitQty : null
    const dir = t.direction === 'long' ? 1 : -1
    const grossPnl = avgExit === null ? 0 : (avgExit - avgEntry) * t.exitQty * dir
    const realizedPnl = grossPnl - t.fees + t.funding
    const marginBase =
      this.market === 'futures' ? t.entryNotional / Math.max(1, this.leverage) : t.entryNotional
    return {
      id: t.id,
      botId: this.ids.botId,
      backtestId: this.ids.backtestId,
      market: this.market,
      symbol: this.symbol,
      direction: t.direction,
      entryTime: t.entryTime,
      exitTime,
      avgEntryPrice: avgEntry,
      avgExitPrice: avgExit,
      qty: t.maxQty,
      realizedPnl,
      realizedPnlPct: marginBase > 0 ? (realizedPnl / marginBase) * 100 : 0,
      fees: t.fees,
      funding: t.funding,
      entryReason: t.entryReason,
      exitReason: t.exitReason,
      mae: t.mae,
      mfe: t.mfe,
      fills: t.fills,
    }
  }
}
