import { randomUUID } from 'node:crypto'
import { and, asc, eq, gte, lt, lte } from 'drizzle-orm'
import { candleCoverage, candles as candlesTable, type Db } from '@tpx/db'
import {
  INTERVAL_MS,
  alignOpenTime,
  chunk,
  type Candle,
  type CoverageRange,
  type Interval,
  type MarketType,
} from '@tpx/shared'
import { BinanceRest } from '../binance/rest'
import { BinanceMarketData } from '../binance/market'
import { fetchVisionCsv, parseVisionKlinesCsv, visionKlinesUrl } from './vision'

const DAY = 86_400_000
/** Vision archives appear with a delay; anything younger comes from REST */
const MONTHLY_SAFE_AGE = 4 * DAY
const DAILY_SAFE_AGE = 36 * 3_600_000

export interface EnsureProgress {
  onProgress?: (doneMs: number, totalMs: number) => void
  signal?: AbortSignal
}

/**
 * Local-first candle access. ensureRange() computes the gaps between what is
 * already in Postgres (coverage table) and the requested window, then fills
 * them: monthly Vision ZIPs for whole months, daily ZIPs for whole days, REST
 * for the recent tail. Everything downloaded is permanent — the next backtest
 * on the same range hits only Postgres.
 */
export class CandleStore {
  private readonly mkt: Record<MarketType, BinanceMarketData>

  constructor(private readonly db: Db) {
    this.mkt = {
      spot: new BinanceMarketData(new BinanceRest({ market: 'spot' })),
      futures: new BinanceMarketData(new BinanceRest({ market: 'futures' })),
    }
  }

  async coverage(market: MarketType, symbol: string, interval: Interval): Promise<CoverageRange[]> {
    const rows = await this.db
      .select()
      .from(candleCoverage)
      .where(
        and(
          eq(candleCoverage.market, market),
          eq(candleCoverage.symbol, symbol),
          eq(candleCoverage.interval, interval),
        ),
      )
      .orderBy(asc(candleCoverage.start))
    return rows.map((r) => ({ start: r.start, end: r.end }))
  }

  async ensureRange(
    market: MarketType,
    symbol: string,
    interval: Interval,
    start: number,
    end: number,
    opts: EnsureProgress = {},
  ): Promise<void> {
    const itv = INTERVAL_MS[interval]
    const alignedStart = alignOpenTime(start, interval)
    const lastClosed = alignOpenTime(Date.now() - itv, interval) + itv // end of the last closed candle
    const alignedEnd = Math.min(alignOpenTime(end - 1, interval) + itv, lastClosed)
    if (alignedEnd <= alignedStart) return

    const covered = await this.coverage(market, symbol, interval)
    const gaps = subtractRanges(alignedStart, alignedEnd, covered)
    if (gaps.length === 0) return

    const totalMs = gaps.reduce((s, g) => s + (g.end - g.start), 0)
    let doneMs = 0
    for (const gap of gaps) {
      await this.downloadGap(market, symbol, interval, gap.start, gap.end, (ms) => {
        opts.onProgress?.(doneMs + ms, totalMs)
      }, opts.signal)
      doneMs += gap.end - gap.start
      opts.onProgress?.(doneMs, totalMs)
    }
  }

  async getCandles(
    market: MarketType,
    symbol: string,
    interval: Interval,
    start: number,
    end: number,
  ): Promise<Candle[]> {
    const rows = await this.db
      .select()
      .from(candlesTable)
      .where(
        and(
          eq(candlesTable.market, market),
          eq(candlesTable.symbol, symbol),
          eq(candlesTable.interval, interval),
          gte(candlesTable.openTime, start),
          lt(candlesTable.openTime, end),
        ),
      )
      .orderBy(asc(candlesTable.openTime))
    return rows.map((r) => ({
      openTime: r.openTime,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
      quoteVolume: r.quoteVolume,
      trades: r.trades,
      takerBuyBase: r.takerBuyBase,
      takerBuyQuote: r.takerBuyQuote,
      closeTime: r.closeTime,
    }))
  }

  // ------------------------------------------------------------- downloads

  private async downloadGap(
    market: MarketType,
    symbol: string,
    interval: Interval,
    gapStart: number,
    gapEnd: number,
    progress: (msIntoGap: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const now = Date.now()
    let cursor = gapStart

    while (cursor < gapEnd) {
      if (signal?.aborted) throw new Error('Download canceled')

      const d = new Date(cursor)
      const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
      const monthEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
      const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
      const dayEnd = dayStart + DAY

      if (cursor === monthStart && monthEnd <= gapEnd && monthEnd <= now - MONTHLY_SAFE_AGE) {
        const stamp = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
        const csv = await fetchVisionCsv(visionKlinesUrl(market, symbol, interval, 'monthly', stamp))
        const rows = csv ? parseVisionKlinesCsv(csv) : []
        await this.commitChunk(market, symbol, interval, rows, cursor, monthEnd)
        cursor = monthEnd
      } else if (cursor === dayStart && dayEnd <= gapEnd && dayEnd <= now - DAILY_SAFE_AGE) {
        const stamp = new Date(dayStart).toISOString().slice(0, 10)
        const csv = await fetchVisionCsv(visionKlinesUrl(market, symbol, interval, 'daily', stamp))
        if (csv) {
          await this.commitChunk(market, symbol, interval, parseVisionKlinesCsv(csv), cursor, dayEnd)
        } else {
          const rows = await this.mkt[market].klinesRange(symbol, interval, cursor, dayEnd)
          await this.commitChunk(market, symbol, interval, rows, cursor, dayEnd)
        }
        cursor = dayEnd
      } else {
        // REST tail (or sub-day head of the gap)
        const sliceEnd = Math.min(
          gapEnd,
          cursor === dayStart ? gapEnd : dayEnd, // re-enter the zip path at the next day boundary
        )
        const rows = await this.mkt[market].klinesRange(symbol, interval, cursor, sliceEnd)
        const itv = INTERVAL_MS[interval]
        const lastClosed = rows.filter((c) => c.closeTime <= Date.now() - 500)
        const covEnd =
          lastClosed.length > 0
            ? Math.max(cursor, lastClosed[lastClosed.length - 1]!.openTime + itv)
            : sliceEnd
        await this.commitChunk(market, symbol, interval, lastClosed, cursor, Math.min(covEnd, sliceEnd))
        cursor = sliceEnd
      }
      progress(cursor - gapStart)
    }
  }

  private async commitChunk(
    market: MarketType,
    symbol: string,
    interval: Interval,
    rows: Candle[],
    covStart: number,
    covEnd: number,
  ): Promise<void> {
    if (covEnd <= covStart) return
    for (const batch of chunk(rows, 1000)) {
      await this.db
        .insert(candlesTable)
        .values(
          batch.map((c) => ({
            market,
            symbol,
            interval,
            openTime: c.openTime,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
            quoteVolume: c.quoteVolume,
            trades: c.trades,
            takerBuyBase: c.takerBuyBase,
            takerBuyQuote: c.takerBuyQuote,
            closeTime: c.closeTime,
          })),
        )
        .onConflictDoNothing()
    }
    await this.addCoverage(market, symbol, interval, covStart, covEnd)
  }

  private async addCoverage(
    market: MarketType,
    symbol: string,
    interval: Interval,
    start: number,
    end: number,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const overlapping = await tx
        .select()
        .from(candleCoverage)
        .where(
          and(
            eq(candleCoverage.market, market),
            eq(candleCoverage.symbol, symbol),
            eq(candleCoverage.interval, interval),
            lte(candleCoverage.start, end),
            gte(candleCoverage.end, start),
          ),
        )
      let s = start
      let e = end
      for (const r of overlapping) {
        s = Math.min(s, r.start)
        e = Math.max(e, r.end)
        await tx.delete(candleCoverage).where(eq(candleCoverage.id, r.id))
      }
      await tx.insert(candleCoverage).values({ id: randomUUID(), market, symbol, interval, start: s, end: e })
    })
  }
}

/** [start, end) minus the union of covered ranges. */
export function subtractRanges(start: number, end: number, covered: CoverageRange[]): CoverageRange[] {
  const sorted = [...covered].sort((a, b) => a.start - b.start)
  const gaps: CoverageRange[] = []
  let cursor = start
  for (const r of sorted) {
    if (r.end <= cursor) continue
    if (r.start >= end) break
    if (r.start > cursor) gaps.push({ start: cursor, end: Math.min(r.start, end) })
    cursor = Math.max(cursor, r.end)
    if (cursor >= end) break
  }
  if (cursor < end) gaps.push({ start: cursor, end })
  return gaps
}
