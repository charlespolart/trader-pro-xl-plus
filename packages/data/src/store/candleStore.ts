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

  /** Symboles dont le REST Binance répond -1121 (« Invalid symbol » = délisté) :
   *  leurs appels REST sont sautés SILENCIEUSEMENT (les archives Vision, elles,
   *  restent tentées — c'est la source des historiques délistés). Peuplable au
   *  démarrage pour persister la connaissance entre process (cf. onRestDead). */
  readonly restDead = new Set<string>()
  /** Notifié UNE fois par symbole à la première détection -1121 (persistance externe). */
  onRestDead?: (key: string) => void

  /** true si l'erreur est un -1121 (symbole délisté) — loggé une seule fois. */
  private markRestDead(market: MarketType, symbol: string, err: unknown): boolean {
    if (!/-1121|Invalid symbol/i.test(String(err))) return false
    const key = `${market}:${symbol}`
    if (!this.restDead.has(key)) {
      this.restDead.add(key)
      this.onRestDead?.(key)
      console.warn(`symbole délisté (REST -1121) : ${key} — appels REST ignorés désormais`)
    }
    return true
  }

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
      if (interval === '3d' || interval === '1w') {
        // Vision monthly files OMIT the multi-day bar that straddles a month
        // boundary (and sometimes whole months) → never download these
        // intervals; build them from 1d, which is complete.
        await this.buildGapFromDaily(market, symbol, interval, gap.start, gap.end, (ms) => {
          opts.onProgress?.(doneMs + ms, totalMs)
        }, opts.signal)
      } else {
        await this.downloadGap(market, symbol, interval, gap.start, gap.end, (ms) => {
          opts.onProgress?.(doneMs + ms, totalMs)
        }, opts.signal)
      }
      doneMs += gap.end - gap.start
      opts.onProgress?.(doneMs, totalMs)
    }
  }

  /**
   * Fill a coverage gap of a multi-day interval (3d/1w) by aggregating 1d
   * candles. The 1d range is widened by one bucket on each side so that a
   * bucket cut by a mis-aligned legacy coverage edge still completes
   * (re-inserting an existing bar is a no-op thanks to onConflictDoNothing).
   */
  private async buildGapFromDaily(
    market: MarketType,
    symbol: string,
    interval: '3d' | '1w',
    gapStart: number,
    gapEnd: number,
    progress: (msIntoGap: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const itv = INTERVAL_MS[interval]
    const fetchStart = alignOpenTime(gapStart, interval)
    const fetchEnd = alignOpenTime(gapEnd - 1, interval) + itv
    await this.ensureRange(market, symbol, '1d', fetchStart, fetchEnd, {
      onProgress: (d) => progress(Math.min(d, gapEnd - gapStart)),
      signal,
    })
    const days = await this.getCandles(market, symbol, '1d', fetchStart, fetchEnd)
    const rows = aggregateDailyCandles(days, interval)
    await this.commitChunk(market, symbol, interval, rows, gapStart, gapEnd)
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
        } else if (this.restDead.has(`${market}:${symbol}`)) {
          // délisté connu : jour ignoré en silence, pas d'appel REST
        } else {
          try {
            const rows = await this.mkt[market].klinesRange(symbol, interval, cursor, dayEnd)
            await this.commitChunk(market, symbol, interval, rows, cursor, dayEnd)
          } catch (err) {
            // jour absent de Vision + REST géo-bloqué (souvent: avant le
            // début des archives) — on continue sans marquer la couverture
            if (!this.markRestDead(market, symbol, err)) {
              console.warn(
                `REST fallback ${market}:${symbol}:${interval} ${stamp} indisponible (${err instanceof Error ? err.message.slice(0, 80) : err}) — jour ignoré`,
              )
            }
          }
        }
        cursor = dayEnd
      } else {
        // REST tail (or sub-day head of the gap)
        const sliceEnd = Math.min(
          gapEnd,
          cursor === dayStart ? gapEnd : dayEnd, // re-enter the zip path at the next day boundary
        )
        if (this.restDead.has(`${market}:${symbol}`)) {
          // délisté connu : tail sautée en silence, pas d'appel REST
          cursor = sliceEnd
          progress(cursor - gapStart)
          continue
        }
        try {
          const rows = await this.mkt[market].klinesRange(symbol, interval, cursor, sliceEnd)
          const itv = INTERVAL_MS[interval]
          const lastClosed = rows.filter((c) => c.closeTime <= Date.now() - 500)
          const covEnd =
            lastClosed.length > 0
              ? Math.max(cursor, lastClosed[lastClosed.length - 1]!.openTime + itv)
              : sliceEnd
          await this.commitChunk(market, symbol, interval, lastClosed, cursor, Math.min(covEnd, sliceEnd))
        } catch (err) {
          // geo-blocked REST (futures tail without mirror): leave the gap
          // uncovered — it will fill on a later attempt from an allowed IP
          if (!this.markRestDead(market, symbol, err)) {
            console.warn(
              `REST klines ${market}:${symbol}:${interval} unavailable (${err instanceof Error ? err.message : err}) — tail [${new Date(cursor).toISOString()}, ${new Date(sliceEnd).toISOString()}) skipped`,
            )
          }
        }
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

/**
 * Aggregate 1d candles into Binance-aligned 3d/1w bars (3d: global grid
 * anchored at 1970-01-02; 1w: Mondays — both via alignOpenTime). Only buckets
 * with a full complement of days are emitted (a partial bucket would have a
 * wrong OHLC); the in-progress tail bucket is therefore naturally excluded.
 */
export function aggregateDailyCandles(days: Candle[], interval: '3d' | '1w'): Candle[] {
  const itv = INTERVAL_MS[interval]
  const perBucket = itv / INTERVAL_MS['1d']
  const buckets = new Map<number, Candle[]>()
  for (const c of days) {
    const open = alignOpenTime(c.openTime, interval)
    let list = buckets.get(open)
    if (!list) {
      list = []
      buckets.set(open, list)
    }
    list.push(c)
  }
  const rows: Candle[] = []
  for (const [open, list] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    if (list.length !== perBucket) continue
    list.sort((a, b) => a.openTime - b.openTime)
    rows.push({
      openTime: open,
      open: list[0]!.open,
      high: Math.max(...list.map((c) => c.high)),
      low: Math.min(...list.map((c) => c.low)),
      close: list[list.length - 1]!.close,
      volume: list.reduce((s, c) => s + c.volume, 0),
      quoteVolume: list.reduce((s, c) => s + c.quoteVolume, 0),
      trades: list.reduce((s, c) => s + c.trades, 0),
      takerBuyBase: list.reduce((s, c) => s + c.takerBuyBase, 0),
      takerBuyQuote: list.reduce((s, c) => s + c.takerBuyQuote, 0),
      closeTime: open + itv - 1,
    })
  }
  return rows
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
