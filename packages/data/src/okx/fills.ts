import type { MarketType } from '@tpx/shared'
import { contractsToBase } from './symbols'
import type { OkxOrderEvent } from './types'

export interface FillDelta {
  /** base units */
  lastQty: number
  price: number
  /** positive cost in feeCcy */
  fee: number
  feeCcy: string
  pnl: number
  time: number
  maker: boolean
}

export function parseFill(ev: OkxOrderEvent, market: MarketType, ctVal: number): FillDelta | null {
  const fillSz = Number(ev.fillSz ?? 0)
  const price = Number(ev.fillPx ?? 0)
  if (!(fillSz > 0) || !(price > 0)) return null
  const lastQty = market === 'futures' ? contractsToBase(fillSz, ctVal) : fillSz
  return {
    lastQty,
    price,
    fee: Math.abs(Number(ev.fillFee ?? 0)),
    feeCcy: ev.fillFeeCcy ?? '',
    pnl: Number(ev.fillPnl ?? 0),
    time: Number(ev.fillTime ?? Date.now()),
    maker: false,
  }
}
