import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { aggTradeFiles, type Db } from '@tpx/db'
import type { AggTrade, MarketType } from '@tpx/shared'
import { BinanceRest } from '../binance/rest'
import { BinanceMarketData } from '../binance/market'
import { decodeAggTrades, encodeAggTrades } from './binaryCodec'
import { fetchVisionCsv, parseVisionAggTradesCsv, visionAggTradesUrl } from './vision'

const DAY = 86_400_000
const CHUNK = 250_000

export interface AggEnsureOptions {
  onProgress?: (doneDays: number, totalDays: number) => void
  signal?: AbortSignal
}

/**
 * AggTrades live as one gzipped columnar file per (market, symbol, UTC day)
 * under DATA_DIR, with a manifest row in Postgres. Whole days come from
 * Binance Vision; missing recent days fall back to REST pagination. The
 * current (incomplete) day is never persisted.
 */
export class AggTradeStore {
  private readonly mkt: Record<MarketType, BinanceMarketData>

  constructor(
    private readonly db: Db,
    private readonly dataDir: string,
  ) {
    this.mkt = {
      spot: new BinanceMarketData(new BinanceRest({ market: 'spot' })),
      futures: new BinanceMarketData(new BinanceRest({ market: 'futures' })),
    }
  }

  filePath(market: MarketType, symbol: string, day: string): string {
    return join(this.dataDir, 'aggtrades', market, symbol, `${day}.bin.gz`)
  }

  async hasDay(market: MarketType, symbol: string, day: string): Promise<boolean> {
    const rows = await this.db
      .select({ day: aggTradeFiles.day })
      .from(aggTradeFiles)
      .where(and(eq(aggTradeFiles.market, market), eq(aggTradeFiles.symbol, symbol), eq(aggTradeFiles.day, day)))
    return rows.length > 0
  }

  async ensureRange(
    market: MarketType,
    symbol: string,
    start: number,
    end: number,
    opts: AggEnsureOptions = {},
  ): Promise<void> {
    const firstDay = Math.floor(start / DAY) * DAY
    const days: number[] = []
    for (let d = firstDay; d < end; d += DAY) days.push(d)
    let done = 0
    for (const dayStart of days) {
      if (opts.signal?.aborted) throw new Error('Download canceled')
      await this.ensureDay(market, symbol, dayStart)
      done++
      opts.onProgress?.(done, days.length)
    }
  }

  async ensureDay(market: MarketType, symbol: string, dayStart: number): Promise<void> {
    const dayEnd = dayStart + DAY
    if (dayEnd > Date.now()) return // current/future day: never persisted
    const day = new Date(dayStart).toISOString().slice(0, 10)
    if (await this.hasDay(market, symbol, day)) return

    let trades: AggTrade[] | null = null
    const csv = await fetchVisionCsv(visionAggTradesUrl(market, symbol, 'daily', day))
    if (csv !== null) {
      trades = parseVisionAggTradesCsv(csv)
    } else {
      trades = await this.restDay(market, symbol, dayStart, dayEnd)
    }

    const encoded = encodeAggTrades(trades)
    const path = this.filePath(market, symbol, day)
    await mkdir(dirname(path), { recursive: true })
    await Bun.write(path, encoded)
    await this.db
      .insert(aggTradeFiles)
      .values({
        market,
        symbol,
        day,
        count: trades.length,
        path,
        sizeBytes: encoded.byteLength,
        createdAt: Date.now(),
      })
      .onConflictDoNothing()
  }

  /** REST fallback for one day (recent days missing from Vision, pre-listing days return empty fast). */
  private async restDay(market: MarketType, symbol: string, dayStart: number, dayEnd: number): Promise<AggTrade[]> {
    const api = this.mkt[market]
    let seed: AggTrade[] = []
    for (let h = 0; h < 24 && seed.length === 0; h++) {
      seed = await api.aggTrades(symbol, {
        startTime: dayStart + h * 3_600_000,
        endTime: Math.min(dayStart + (h + 1) * 3_600_000, dayEnd) - 1,
        limit: 1000,
      })
    }
    if (seed.length === 0) return []

    const out: AggTrade[] = seed.filter((t) => t.time >= dayStart && t.time < dayEnd)
    let fromId = seed[seed.length - 1]!.id + 1
    for (;;) {
      const page = await api.aggTrades(symbol, { fromId, limit: 1000 })
      if (page.length === 0) break
      let crossed = false
      for (const t of page) {
        if (t.time >= dayEnd) {
          crossed = true
          break
        }
        if (t.time >= dayStart) out.push(t)
      }
      if (crossed || page.length < 1000) break
      fromId = page[page.length - 1]!.id + 1
    }
    return out
  }

  /** Stream [start, end) in chunks. With ensure=true, missing days download lazily as iteration advances. */
  async *iterate(
    market: MarketType,
    symbol: string,
    start: number,
    end: number,
    opts: { ensure?: boolean; signal?: AbortSignal } = {},
  ): AsyncGenerator<AggTrade[]> {
    const firstDay = Math.floor(start / DAY) * DAY
    for (let dayStart = firstDay; dayStart < end; dayStart += DAY) {
      if (opts.signal?.aborted) throw new Error('aggTrades iteration canceled')
      if (opts.ensure ?? true) await this.ensureDay(market, symbol, dayStart)
      const day = new Date(dayStart).toISOString().slice(0, 10)
      const path = this.filePath(market, symbol, day)
      const file = Bun.file(path)
      if (!(await file.exists())) continue
      const trades = decodeAggTrades(new Uint8Array(await file.arrayBuffer()))
      let slice = trades
      if (dayStart < start || dayStart + DAY > end) {
        slice = trades.filter((t) => t.time >= start && t.time < end)
      }
      for (let i = 0; i < slice.length; i += CHUNK) {
        yield slice.slice(i, i + CHUNK)
      }
    }
  }
}
