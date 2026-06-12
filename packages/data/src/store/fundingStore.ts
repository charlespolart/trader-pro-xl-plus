import { and, asc, eq, gte, lt } from 'drizzle-orm'
import { fundingRates, type Db } from '@tpx/db'
import { chunk, type FundingEvent } from '@tpx/shared'
import { BinanceRest } from '../binance/rest'
import { BinanceMarketData } from '../binance/market'

const FUNDING_MS = 8 * 3_600_000

/** Historical funding rates (USDT-M futures), cached in Postgres. */
export class FundingStore {
  private readonly api: BinanceMarketData

  constructor(private readonly db: Db) {
    this.api = new BinanceMarketData(new BinanceRest({ market: 'futures' }))
  }

  async ensureRange(symbol: string, start: number, end: number): Promise<void> {
    const cappedEnd = Math.min(end, Date.now())
    if (cappedEnd <= start) return
    const existing = await this.get(symbol, start, cappedEnd)
    const first = existing[0]
    const last = existing[existing.length - 1]
    const headOk = first !== undefined && first.time < start + 2 * FUNDING_MS
    const tailOk = last !== undefined && last.time > cappedEnd - 2 * FUNDING_MS
    if (headOk && tailOk && existing.length >= Math.floor((cappedEnd - start) / FUNDING_MS) - 2) return

    const events = await this.api.fundingRateHistory(symbol, start, cappedEnd)
    for (const batch of chunk(events, 2000)) {
      await this.db
        .insert(fundingRates)
        .values(batch.map((e) => ({ symbol: e.symbol, time: e.time, rate: e.rate })))
        .onConflictDoNothing()
    }
  }

  async get(symbol: string, start: number, end: number): Promise<FundingEvent[]> {
    const rows = await this.db
      .select()
      .from(fundingRates)
      .where(and(eq(fundingRates.symbol, symbol), gte(fundingRates.time, start), lt(fundingRates.time, end)))
      .orderBy(asc(fundingRates.time))
    return rows.map((r) => ({ symbol: r.symbol, time: r.time, rate: r.rate }))
  }
}
