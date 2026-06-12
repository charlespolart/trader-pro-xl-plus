import { unzipSync } from 'fflate'
import type { AggTrade, Candle, Interval, MarketType } from '@tpx/shared'
import { VISION_BASE, visionPrefix } from '../binance/endpoints'

/**
 * data.binance.vision bulk archives: monthly/daily ZIPs of klines and
 * aggTrades. Orders of magnitude faster than paging the REST API for
 * historical ranges. Files appear with a delay (~1-2 days), so recent data
 * always comes from REST.
 */

export function visionKlinesUrl(
  market: MarketType,
  symbol: string,
  interval: Interval,
  granularity: 'monthly' | 'daily',
  dateStr: string,
): string {
  return `${VISION_BASE}/${visionPrefix(market)}/${granularity}/klines/${symbol}/${interval}/${symbol}-${interval}-${dateStr}.zip`
}

export function visionAggTradesUrl(
  market: MarketType,
  symbol: string,
  granularity: 'monthly' | 'daily',
  dateStr: string,
): string {
  return `${VISION_BASE}/${visionPrefix(market)}/${granularity}/aggTrades/${symbol}/${symbol}-aggTrades-${dateStr}.zip`
}

/** Download + unzip a Vision archive. Returns the CSV text, or null on 404. */
export async function fetchVisionCsv(url: string): Promise<string | null> {
  const res = await fetch(url)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Vision download failed (${res.status}) for ${url}`)
  const zipped = new Uint8Array(await res.arrayBuffer())
  const files = unzipSync(zipped)
  const name = Object.keys(files)[0]
  if (!name) throw new Error(`Empty Vision archive: ${url}`)
  return new TextDecoder().decode(files[name]!)
}

/** Spot Vision files switched to MICROsecond timestamps on 2025-01-01. */
function normalizeTs(t: number): number {
  return t > 1e14 ? Math.floor(t / 1000) : t
}

export function parseVisionKlinesCsv(csv: string): Candle[] {
  const out: Candle[] = []
  for (const line of csv.split('\n')) {
    if (line.length === 0) continue
    const c = line.split(',')
    const openTime = Number(c[0])
    if (!Number.isFinite(openTime)) continue // header row
    out.push({
      openTime: normalizeTs(openTime),
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[5]),
      closeTime: normalizeTs(Number(c[6])),
      quoteVolume: Number(c[7]),
      trades: Number(c[8]),
      takerBuyBase: Number(c[9]),
      takerBuyQuote: Number(c[10]),
    })
  }
  return out
}

export function parseVisionAggTradesCsv(csv: string): AggTrade[] {
  const out: AggTrade[] = []
  for (const line of csv.split('\n')) {
    if (line.length === 0) continue
    const c = line.split(',')
    const id = Number(c[0])
    if (!Number.isFinite(id)) continue // header row
    const makerRaw = (c[6] ?? '').trim().toLowerCase()
    out.push({
      id,
      price: Number(c[1]),
      qty: Number(c[2]),
      time: normalizeTs(Number(c[5])),
      isBuyerMaker: makerRaw.startsWith('t'),
    })
  }
  return out
}
