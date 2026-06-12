export * from './types'
export * from './streams'
export * from './bound'
export * from './ma'
export * from './oscillators'
export * from './volatility'
export * from './patterns'

import { ema, hma, rollingVwap, sma, vwap, wma } from './ma'
import { cci, macd, mfi, obv, roc, rsi, stoch, stochRsi, willr } from './oscillators'
import { adx, atr, bbands, donchian, keltner, psar, supertrend } from './volatility'

/** Convenience namespace: ctx.indicator('main', ind.rsi(14)) */
export const ind = {
  sma,
  ema,
  wma,
  hma,
  vwap,
  rollingVwap,
  rsi,
  macd,
  stoch,
  stochRsi,
  cci,
  mfi,
  obv,
  roc,
  willr,
  atr,
  bbands,
  keltner,
  donchian,
  adx,
  supertrend,
  psar,
}
