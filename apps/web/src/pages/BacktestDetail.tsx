import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { INTERVALS, INTERVAL_MS, type Candle, type Interval } from '@tpx/shared'
import { api } from '../lib/api'
import { fmtDate } from '../lib/format'
import { Badge, Card, Empty, Spinner } from '../components/ui'
import { TradingChart, tradesToMarkers } from '../components/TradingChart'
import { MetricsGrid } from '../components/MetricsGrid'
import { EquityChart } from '../components/EquityChart'
import { TradesTable } from '../components/TradesTable'

/** infer the sampling interval from equity point spacing */
function inferInterval(times: number[]): Interval {
  if (times.length < 2) return '1h'
  const diffs = new Map<number, number>()
  for (let i = 1; i < Math.min(times.length, 50); i++) {
    const d = times[i]! - times[i - 1]!
    diffs.set(d, (diffs.get(d) ?? 0) + 1)
  }
  const mode = [...diffs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 3_600_000
  let best: Interval = '1h'
  let bestErr = Infinity
  for (const itv of INTERVALS) {
    const err = Math.abs(INTERVAL_MS[itv] - mode)
    if (err < bestErr) {
      bestErr = err
      best = itv
    }
  }
  return best
}

export function BacktestDetail() {
  const { id = '' } = useParams()
  const { data: result, isLoading } = useQuery({
    queryKey: ['backtest-result', id],
    queryFn: () => api.backtestResult(id),
    refetchInterval: (q) => (q.state.data?.run.status === 'done' || q.state.data?.run.status === 'error' ? false : 3000),
  })

  const run = result?.run
  const interval = useMemo(() => inferInterval(result?.equity.map((p) => p.time) ?? []), [result?.equity])

  const { data: candles } = useQuery({
    queryKey: ['backtest-candles', id, interval],
    queryFn: () =>
      api.klines(run!.config.market, run!.config.symbol, interval, run!.config.start - 100 * INTERVAL_MS[interval], run!.config.end),
    enabled: run !== undefined && run.status === 'done',
  })

  // ---- replay
  const [replay, setReplay] = useState<number | null>(null) // candle index limit, null = off
  const [playing, setPlaying] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!playing || !candles) return
    timerRef.current = setInterval(() => {
      setReplay((r) => {
        const next = (r ?? 0) + 1
        if (next >= candles.length) {
          setPlaying(false)
          return candles.length
        }
        return next
      })
    }, 120)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [playing, candles])

  const markers = useMemo(() => (result ? tradesToMarkers(result.trades) : []), [result])

  const view = useMemo(() => {
    if (!candles) return null
    if (replay === null) {
      return { candles, markers, annotations: result?.annotations ?? [], indicators: result?.indicators ?? [] }
    }
    const limitTime = (candles[Math.min(replay, candles.length - 1)] as Candle | undefined)?.closeTime ?? 0
    return {
      candles: candles.slice(0, replay + 1),
      markers: markers.filter((m) => m.time <= limitTime),
      annotations: (result?.annotations ?? []).filter((a) => a.type === 'hline' || a.time <= limitTime),
      indicators: (result?.indicators ?? []).map((s) => ({ ...s, points: s.points.filter(([t]) => t <= limitTime) })),
    }
  }, [candles, replay, markers, result])

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    )
  }
  if (!result || !run) return <Empty>Backtest introuvable</Empty>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold">{run.config.label ?? run.config.strategyId}</h1>
          <Badge value={run.config.market} />
          <span className="text-sm text-zinc-400">
            {run.config.symbol} · {fmtDate(run.config.start).split(' ')[0]} → {fmtDate(run.config.end).split(' ')[0]} ·{' '}
            {run.config.fillMode === 'aggtrades' ? 'fills aggTrades' : 'fills bougies'} ·{' '}
            {run.config.fees.bnbDiscount ? 'frais BNB' : 'frais standard'}
          </span>
          <Badge value={run.status} />
        </div>
        <Link to="/backtests" className="btn-ghost">
          ← Backtests
        </Link>
      </div>

      {run.error !== undefined && <div className="rounded-md border border-down/40 bg-down/10 px-3 py-2 text-sm text-down">{run.error}</div>}
      {result.run.status === 'done' && run.metrics && (
        <Card>
          <MetricsGrid m={run.metrics} />
        </Card>
      )}

      {view && (
        <Card
          title={`${run.config.symbol} · ${interval}`}
          actions={
            <div className="flex items-center gap-2">
              {replay !== null && candles && (
                <>
                  <input
                    type="range"
                    min={0}
                    max={candles.length}
                    value={replay}
                    onChange={(e) => setReplay(Number(e.target.value))}
                    className="w-64 accent-blue-500"
                  />
                  <button className="btn-ghost" onClick={() => setPlaying((p) => !p)}>
                    {playing ? '⏸' : '▶'}
                  </button>
                </>
              )}
              <button
                className="btn-ghost"
                onClick={() => {
                  if (replay === null) {
                    setReplay(0)
                  } else {
                    setReplay(null)
                    setPlaying(false)
                  }
                }}
              >
                {replay === null ? '🎬 Replay' : '✕ Quitter le replay'}
              </button>
            </div>
          }
        >
          <TradingChart
            candles={view.candles}
            indicators={view.indicators}
            markers={view.markers}
            annotations={view.annotations}
            height={520}
          />
        </Card>
      )}

      {result.equity.length > 0 && (
        <Card title="Équité & drawdown">
          <EquityChart points={result.equity} />
        </Card>
      )}

      <Card title={`Trades (${result.trades.length})`}>
        <TradesTable trades={result.trades} />
      </Card>

      {result.logs.length > 0 && (
        <Card title="Journal de la stratégie">
          <div className="max-h-80 space-y-0.5 overflow-y-auto font-mono text-xs">
            {result.logs.map((l, i) => (
              <div key={i} className="flex gap-2">
                <span className="shrink-0 text-zinc-600">{fmtDate(l.time)}</span>
                <span className={l.level === 'error' ? 'text-down' : l.level === 'warn' ? 'text-amber-400' : 'text-zinc-300'}>{l.message}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
