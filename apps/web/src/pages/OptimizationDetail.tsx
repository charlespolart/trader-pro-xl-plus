import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { BacktestMetrics, ParamValues } from '@tpx/shared'
import { api } from '../lib/api'
import { fmtDate, fmtNum, fmtPct, pnlClass } from '../lib/format'
import { Badge, Card, Empty, Spinner } from '../components/ui'

interface ComboResult {
  params: ParamValues
  metrics: BacktestMetrics | null
  score: number
  error?: string
}

interface WfWindow {
  index: number
  isStart: number
  isEnd: number
  oosStart: number
  oosEnd: number
  bestParams: ParamValues
  isScore: number
  oosMetrics: BacktestMetrics | null
}

interface Artifact {
  kind: 'grid' | 'walkforward'
  objective: string
  results?: ComboResult[]
  summary?: { windows: number; positiveOos: number; avgOosNetProfitPct: number; compoundedOosReturnPct: number }
  windows?: WfWindow[]
}

export function OptimizationDetail() {
  const { id = '' } = useParams()
  const { data: row } = useQuery({ queryKey: ['optimization', id], queryFn: () => api.optimization(id), refetchInterval: 5_000 })
  const { data: artifact } = useQuery({
    queryKey: ['optimization-artifact', id],
    queryFn: () => api.optimizationArtifact(id) as Promise<Artifact>,
    enabled: row?.status === 'done',
  })
  const [sortKey, setSortKey] = useState<'score' | 'netProfitPct' | 'maxDrawdownPct' | 'totalTrades'>('score')

  const sorted = useMemo(() => {
    const results = artifact?.results ?? []
    return [...results].sort((a, b) => {
      if (sortKey === 'score') return b.score - a.score
      const av = a.metrics?.[sortKey] ?? -Infinity
      const bv = b.metrics?.[sortKey] ?? -Infinity
      return sortKey === 'maxDrawdownPct' ? Number(av) - Number(bv) : Number(bv) - Number(av)
    })
  }, [artifact, sortKey])

  if (!row) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    )
  }

  const paramKeys = sorted.length > 0 ? Object.keys(sorted[0]!.params) : []

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold">{row.label ?? `Optimisation ${row.id.slice(0, 8)}`}</h1>
          <Badge value={row.status} />
          <span className="text-sm text-zinc-400">
            {row.strategyId} · {row.symbol} · {row.done}/{row.total} runs · {fmtDate(row.createdAt)}
          </span>
        </div>
        <Link to="/optimizer" className="btn-ghost">
          ← Optimiseur
        </Link>
      </div>

      {row.error !== null && <div className="rounded-md border border-down/40 bg-down/10 px-3 py-2 text-sm text-down">{row.error}</div>}

      {artifact?.kind === 'walkforward' && artifact.summary && (
        <>
          <div className="grid grid-cols-4 gap-4">
            <Card>
              <div className="text-[11px] text-zinc-500">Fenêtres OOS positives</div>
              <div className="text-xl font-bold">
                {artifact.summary.positiveOos}/{artifact.summary.windows}
              </div>
            </Card>
            <Card>
              <div className="text-[11px] text-zinc-500">Profit OOS moyen / fenêtre</div>
              <div className={`text-xl font-bold ${pnlClass(artifact.summary.avgOosNetProfitPct)}`}>{fmtPct(artifact.summary.avgOosNetProfitPct)}</div>
            </Card>
            <Card>
              <div className="text-[11px] text-zinc-500">Rendement OOS composé</div>
              <div className={`text-xl font-bold ${pnlClass(artifact.summary.compoundedOosReturnPct)}`}>{fmtPct(artifact.summary.compoundedOosReturnPct)}</div>
            </Card>
            <Card>
              <div className="text-[11px] text-zinc-500">Verdict</div>
              <div className="text-sm font-semibold">
                {artifact.summary.positiveOos / artifact.summary.windows >= 0.6 && artifact.summary.compoundedOosReturnPct > 0
                  ? '✅ Robuste hors-échantillon'
                  : '⚠️ Probable overfitting — méfiance'}
              </div>
            </Card>
          </div>

          <Card title="Fenêtres walk-forward">
            <table className="w-full">
              <thead>
                <tr>
                  <th>#</th>
                  <th>In-sample</th>
                  <th>Out-of-sample</th>
                  <th>Meilleurs paramètres (IS)</th>
                  <th>Score IS</th>
                  <th>Profit OOS</th>
                  <th>Trades OOS</th>
                  <th>DD OOS</th>
                </tr>
              </thead>
              <tbody>
                {(artifact.windows ?? []).map((w) => (
                  <tr key={w.index}>
                    <td>{w.index + 1}</td>
                    <td className="text-zinc-400">
                      {fmtDate(w.isStart).split(' ')[0]} → {fmtDate(w.isEnd).split(' ')[0]}
                    </td>
                    <td className="text-zinc-400">
                      {fmtDate(w.oosStart).split(' ')[0]} → {fmtDate(w.oosEnd).split(' ')[0]}
                    </td>
                    <td className="max-w-80 truncate font-mono text-xs" title={JSON.stringify(w.bestParams)}>
                      {JSON.stringify(w.bestParams)}
                    </td>
                    <td>{fmtNum(w.isScore)}</td>
                    <td className={pnlClass(w.oosMetrics?.netProfitPct)}>{w.oosMetrics ? fmtPct(w.oosMetrics.netProfitPct) : '—'}</td>
                    <td>{w.oosMetrics?.totalTrades ?? '—'}</td>
                    <td className="text-down">{w.oosMetrics ? fmtPct(-w.oosMetrics.maxDrawdownPct) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {artifact?.kind === 'grid' && (
        <Card
          title={`Résultats (objectif : ${artifact.objective})`}
          actions={
            <select className="input w-44" value={sortKey} onChange={(e) => setSortKey(e.target.value as typeof sortKey)}>
              <option value="score">Tri : score</option>
              <option value="netProfitPct">Tri : profit %</option>
              <option value="maxDrawdownPct">Tri : drawdown</option>
              <option value="totalTrades">Tri : trades</option>
            </select>
          }
        >
          {sorted.length === 0 ? (
            <Empty>Pas de résultats</Empty>
          ) : (
            <div className="max-h-[600px] overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-panel">
                  <tr>
                    <th>#</th>
                    {paramKeys.map((k) => (
                      <th key={k}>{k}</th>
                    ))}
                    <th>Score</th>
                    <th>Profit %</th>
                    <th>Trades</th>
                    <th>Win rate</th>
                    <th>Max DD</th>
                    <th>Sharpe</th>
                    <th>PF</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.slice(0, 300).map((r, i) => (
                    <tr key={i} className={i === 0 ? 'bg-up/5' : ''}>
                      <td className="text-zinc-500">{i + 1}</td>
                      {paramKeys.map((k) => (
                        <td key={k} className="font-mono text-xs">
                          {String(r.params[k])}
                        </td>
                      ))}
                      <td className="font-semibold">{Number.isFinite(r.score) ? fmtNum(r.score) : '—'}</td>
                      <td className={pnlClass(r.metrics?.netProfitPct)}>{r.metrics ? fmtPct(r.metrics.netProfitPct) : (r.error ?? '—')}</td>
                      <td>{r.metrics?.totalTrades ?? '—'}</td>
                      <td>{r.metrics ? `${r.metrics.winRate.toFixed(0)} %` : '—'}</td>
                      <td className="text-down">{r.metrics ? fmtPct(-r.metrics.maxDrawdownPct) : '—'}</td>
                      <td>{fmtNum(r.metrics?.sharpe ?? null)}</td>
                      <td>{fmtNum(r.metrics?.profitFactor ?? null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sorted.length > 300 && <div className="py-2 text-center text-xs text-zinc-500">300 premiers résultats affichés sur {sorted.length}</div>}
            </div>
          )}
        </Card>
      )}

      {row.status === 'running' && (
        <Card>
          <Empty>
            Optimisation en cours… {row.done}/{row.total}
          </Empty>
        </Card>
      )}
    </div>
  )
}
