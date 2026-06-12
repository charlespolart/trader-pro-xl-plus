import type { BacktestMetrics } from '@tpx/shared'
import { fmtDuration, fmtNum, fmtPct, pnlClass } from '../lib/format'

export function MetricsGrid({ m }: { m: BacktestMetrics }) {
  const items: { label: string; value: string; cls?: string }[] = [
    { label: 'Profit net', value: `${fmtNum(m.netProfit)} (${fmtPct(m.netProfitPct)})`, cls: pnlClass(m.netProfit) },
    { label: 'Buy & Hold', value: fmtPct(m.buyHoldReturnPct), cls: pnlClass(m.buyHoldReturnPct) },
    { label: 'Rendement annualisé', value: fmtPct(m.annualizedReturnPct), cls: pnlClass(m.annualizedReturnPct) },
    { label: 'Max drawdown', value: `${fmtPct(-m.maxDrawdownPct)} (${fmtDuration(m.maxDrawdownDurationMs)})`, cls: 'text-down' },
    { label: 'Sharpe', value: fmtNum(m.sharpe) },
    { label: 'Sortino', value: fmtNum(m.sortino) },
    { label: 'Calmar', value: fmtNum(m.calmar) },
    { label: 'Profit factor', value: fmtNum(m.profitFactor) },
    { label: 'Trades', value: `${m.totalTrades}${m.openTradesAtEnd > 0 ? ` (+${m.openTradesAtEnd} ouvert)` : ''}` },
    { label: 'Win rate', value: fmtPct(m.winRate, 1).replace('+', '') },
    { label: 'Gain moyen / perte moyenne', value: `${fmtNum(m.avgWin)} / ${fmtNum(m.avgLoss)}` },
    { label: 'Espérance par trade', value: fmtNum(m.expectancy), cls: pnlClass(m.expectancy) },
    { label: 'Frais totaux', value: fmtNum(m.totalFees) },
    { label: 'Funding total', value: fmtNum(m.totalFunding), cls: pnlClass(m.totalFunding) },
    { label: 'Exposition', value: fmtPct(m.exposurePct, 1).replace('+', '') },
    { label: 'Durée moyenne de trade', value: fmtDuration(m.avgTradeDurationMs) },
    { label: 'Pertes consécutives max', value: String(m.maxConsecutiveLosses) },
    { label: 'Équité finale', value: fmtNum(m.finalEquity), cls: pnlClass(m.netProfit) },
  ]
  return (
    <div className="grid grid-cols-3 gap-x-6 gap-y-3 lg:grid-cols-6">
      {items.map((it) => (
        <div key={it.label}>
          <div className="text-[11px] text-zinc-500">{it.label}</div>
          <div className={`text-sm font-semibold ${it.cls ?? 'text-zinc-200'}`}>{it.value}</div>
        </div>
      ))}
    </div>
  )
}
