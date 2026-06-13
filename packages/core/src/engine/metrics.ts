import { mean, stddev, type BacktestMetrics, type EquityPoint, type TradeRecord } from '@tpx/shared'

const MS_PER_YEAR = 365.25 * 86_400_000

export interface MetricsInput {
  start: number
  end: number
  initialBalance: number
  equity: EquityPoint[]
  trades: TradeRecord[]
  /** ms between equity samples (matching feed interval) */
  sampleIntervalMs: number
  totalFees: number
  totalFunding: number
  /** candles with an open position / total candles */
  exposureRatio: number
  /** symbol close at start / end of the tested window */
  firstPrice: number
  lastPrice: number
  /** base-denom : le benchmark buy & hold = garder son BTC = 0 % */
  baseDenominated?: boolean
}

export function computeMetrics(input: MetricsInput): BacktestMetrics {
  const { equity, trades } = input
  const finalEquity = equity.length > 0 ? equity[equity.length - 1]!.equity : input.initialBalance
  const netProfit = finalEquity - input.initialBalance
  const durationMs = Math.max(1, input.end - input.start)
  const durationDays = durationMs / 86_400_000

  // drawdown
  let peak = -Infinity
  let peakTime = input.start
  let maxDd = 0
  let maxDdPct = 0
  let maxDdDuration = 0
  for (const pt of equity) {
    if (pt.equity > peak) {
      peak = pt.equity
      peakTime = pt.time
    } else {
      const dd = peak - pt.equity
      const ddPct = peak > 0 ? (dd / peak) * 100 : 0
      if (dd > maxDd) maxDd = dd
      if (ddPct > maxDdPct) maxDdPct = ddPct
      maxDdDuration = Math.max(maxDdDuration, pt.time - peakTime)
    }
  }

  // per-sample returns for risk ratios
  const returns: number[] = []
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1]!.equity
    if (prev > 0) returns.push(equity[i]!.equity / prev - 1)
  }
  const periodsPerYear = MS_PER_YEAR / Math.max(1, input.sampleIntervalMs)
  const annFactor = Math.sqrt(periodsPerYear)
  const mu = mean(returns)
  const sigma = stddev(returns)
  const downside = stddev(returns.filter((r) => r < 0))
  const sharpe = returns.length > 30 && sigma > 0 ? (mu / sigma) * annFactor : null
  const sortino = returns.length > 30 && downside > 0 ? (mu / downside) * annFactor : null

  const annualizedReturn =
    input.initialBalance > 0 && finalEquity > 0
      ? (Math.pow(finalEquity / input.initialBalance, MS_PER_YEAR / durationMs) - 1) * 100
      : -100
  const annualizedVol = sigma > 0 ? sigma * annFactor * 100 : null
  const calmar = maxDdPct > 0 ? annualizedReturn / maxDdPct : null

  // trade stats (closed trades only)
  const closed = trades.filter((t) => t.exitTime !== null)
  const wins = closed.filter((t) => t.realizedPnl > 0)
  const losses = closed.filter((t) => t.realizedPnl <= 0)
  const grossProfit = wins.reduce((s, t) => s + t.realizedPnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.realizedPnl, 0))
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0

  let maxWinStreak = 0
  let maxLossStreak = 0
  let curWin = 0
  let curLoss = 0
  for (const t of closed) {
    if (t.realizedPnl > 0) {
      curWin++
      curLoss = 0
    } else {
      curLoss++
      curWin = 0
    }
    maxWinStreak = Math.max(maxWinStreak, curWin)
    maxLossStreak = Math.max(maxLossStreak, curLoss)
  }

  const durations = closed.map((t) => (t.exitTime ?? t.entryTime) - t.entryTime)

  return {
    start: input.start,
    end: input.end,
    durationDays,
    initialBalance: input.initialBalance,
    finalEquity,
    netProfit,
    netProfitPct: input.initialBalance > 0 ? (netProfit / input.initialBalance) * 100 : 0,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    totalTrades: closed.length,
    openTradesAtEnd: trades.length - closed.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
    avgWin,
    avgLoss,
    expectancy: closed.length > 0 ? closed.reduce((s, t) => s + t.realizedPnl, 0) / closed.length : 0,
    payoffRatio: avgLoss > 0 ? avgWin / avgLoss : null,
    maxDrawdown: maxDd,
    maxDrawdownPct: maxDdPct,
    maxDrawdownDurationMs: maxDdDuration,
    sharpe,
    sortino,
    calmar,
    annualizedReturnPct: annualizedReturn,
    annualizedVolatilityPct: annualizedVol,
    totalFees: input.totalFees,
    totalFunding: input.totalFunding,
    exposurePct: input.exposureRatio * 100,
    avgTradeDurationMs: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
    maxConsecutiveWins: maxWinStreak,
    maxConsecutiveLosses: maxLossStreak,
    // base-denom : garder son BTC = 0 % (le benchmark, c'est ne rien faire).
    // quote : rendement d'un buy & hold du symbole.
    buyHoldReturnPct: input.baseDenominated
      ? 0
      : input.firstPrice > 0
        ? ((input.lastPrice - input.firstPrice) / input.firstPrice) * 100
        : 0,
  }
}
