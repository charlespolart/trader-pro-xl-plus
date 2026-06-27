import type { ExchangeInstrument } from '../exchange/types'
import type { OkxRest } from './rest'
import type { OkxInstType, OkxInstrumentRaw } from './types'

function parseInstrument(r: OkxInstrumentRaw): ExchangeInstrument {
  const ctVal = Number(r.ctVal)
  return {
    instId: r.instId,
    tickSize: Number(r.tickSz),
    stepSize: Number(r.lotSz),
    minQty: Number(r.minSz),
    contractSize: r.instType === 'SWAP' && ctVal > 0 ? ctVal : 1,
    maxLeverage: Number(r.lever) || 1,
  }
}

export class OkxInstruments {
  private cache = new Map<string, ExchangeInstrument>()
  constructor(private readonly rest: OkxRest) {}

  async get(instId: string, instType: OkxInstType): Promise<ExchangeInstrument> {
    const hit = this.cache.get(instId)
    if (hit) return hit
    const rows = await this.rest.public<OkxInstrumentRaw>('/api/v5/public/instruments', { instType, instId })
    const row = rows.find((x) => x.instId === instId) ?? rows[0]
    if (!row) throw new Error(`OKX instrument not found: ${instId}`)
    const inst = parseInstrument(row)
    this.cache.set(instId, inst)
    return inst
  }
}
