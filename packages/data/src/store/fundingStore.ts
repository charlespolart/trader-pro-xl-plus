import { and, asc, eq, gte, lt } from 'drizzle-orm'
import { fundingRates, type Db } from '@tpx/db'
import { chunk, type FundingEvent } from '@tpx/shared'
import { BinanceRest } from '../binance/rest'
import { BinanceMarketData } from '../binance/market'
import { fetchVisionCsv, parseVisionFundingCsv, visionFundingUrl } from './vision'

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

    let events: FundingEvent[]
    try {
      events = await this.api.fundingRateHistory(symbol, start, cappedEnd)
    } catch (err) {
      // geo-blocked fapi: fall back to the Vision monthly archives (the
      // current month is not archived yet — its tail will be missing)
      console.warn(`fundingRateHistory(${symbol}) failed (${err instanceof Error ? err.message : err}); using Vision archives`)
      events = await this.fetchVisionFunding(symbol, start, cappedEnd)
    }
    for (const batch of chunk(events, 2000)) {
      await this.db
        .insert(fundingRates)
        .values(batch.map((e) => ({ symbol: e.symbol, time: e.time, rate: e.rate })))
        .onConflictDoNothing()
    }
  }

  private async fetchVisionFunding(symbol: string, start: number, end: number): Promise<FundingEvent[]> {
    const out: FundingEvent[] = []
    const d = new Date(start)
    let cursor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
    while (cursor < end) {
      const m = new Date(cursor)
      const stamp = `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}`
      const csv = await fetchVisionCsv(visionFundingUrl(symbol, stamp)).catch(() => null)
      if (csv) {
        for (const e of parseVisionFundingCsv(csv)) {
          if (e.time >= start && e.time < end) out.push({ symbol, time: e.time, rate: e.rate })
        }
      }
      cursor = Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1)
    }
    return out
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
