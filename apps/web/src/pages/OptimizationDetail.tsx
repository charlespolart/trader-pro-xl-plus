import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { BacktestMetrics, ParamValues } from '@tpx/shared'
import { ChevronLeft } from 'lucide-react'
import { api } from '../lib/api'
import { fmtDate, fmtNum, fmtPct, pnlClass } from '../lib/format'
import { Badge, Card, Empty, PageHeader, Spinner, Stat } from '../components/ui'

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
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2.5">
            {row.label ?? `Optimisation ${row.id.slice(0, 8)}`}
            <Badge value={row.status} />
          </span>
        }
        subtitle={`${row.strategyId} · ${row.symbol} · ${row.done}/${row.total} runs · ${fmtDate(row.createdAt)}`}
        actions={
          <Link to="/optimizer" className="btn-ghost">
            <ChevronLeft size={15} /> Optimiseur
          </Link>
        }
      />

      {row.error !== null && <div className="rounded-md border border-down/40 bg-down/10 px-3 py-2 text-sm text-down">{row.error}</div>}

      {artifact?.kind === 'walkforward' && artifact.summary && (
        <>
          <div className="grid grid-cols-4 gap-4">
            <Stat label="Fenêtres OOS positives" value={`${artifact.summary.positiveOos}/${artifact.summary.windows}`} />
            <Stat
              label="Profit OOS moyen / fenêtre"
              value={fmtPct(artifact.summary.avgOosNetProfitPct)}
              tone={artifact.summary.avgOosNetProfitPct === 0 ? 'default' : artifact.summary.avgOosNetProfitPct > 0 ? 'up' : 'down'}
            />
            <Stat
              label="Rendement OOS composé"
              value={fmtPct(artifact.summary.compoundedOosReturnPct)}
              tone={artifact.summary.compoundedOosReturnPct === 0 ? 'default' : artifact.summary.compoundedOosReturnPct > 0 ? 'up' : 'down'}
            />
            <div className="card p-4">
              <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Verdict</div>
              {artifact.summary.positiveOos / artifact.summary.windows >= 0.6 && artifact.summary.compoundedOosReturnPct > 0 ? (
                <div className="mt-1.5 text-sm font-semibold text-up">Robuste hors-échantillon</div>
              ) : (
                <div className="mt-1.5 text-sm font-semibold text-amber-400">Probable overfitting — méfiance</div>
              )}
            </div>
          </div>

          <Card title="Fenêtres walk-forward" bodyClassName="p-0">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>In-sample</th>
                  <th>Out-of-sample</th>
                  <th>Meilleurs paramètres (IS)</th>
                  <th className="text-right">Score IS</th>
                  <th className="text-right">Profit OOS</th>
                  <th className="text-right">Trades OOS</th>
                  <th className="text-right">DD OOS</th>
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
                    <td className="text-right tabular-nums">{fmtNum(w.isScore)}</td>
                    <td className={`text-right tabular-nums ${pnlClass(w.oosMetrics?.netProfitPct)}`}>{w.oosMetrics ? fmtPct(w.oosMetrics.netProfitPct) : '—'}</td>
                    <td className="text-right tabular-nums">{w.oosMetrics?.totalTrades ?? '—'}</td>
                    <td className="text-right tabular-nums text-down">{w.oosMetrics ? fmtPct(-w.oosMetrics.maxDrawdownPct) : '—'}</td>
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
          bodyClassName={sorted.length === 0 ? 'p-4' : 'p-0'}
        >
          {sorted.length === 0 ? (
            <Empty>Pas de résultats</Empty>
          ) : (
            <div className="max-h-[600px] overflow-auto">
              <table>
                <thead className="sticky top-0 bg-panel">
                  <tr>
                    <th>#</th>
                    {paramKeys.map((k) => (
                      <th key={k}>{k}</th>
                    ))}
                    <th className="text-right">Score</th>
                    <th className="text-right">Profit %</th>
                    <th className="text-right">Trades</th>
                    <th className="text-right">Win rate</th>
                    <th className="text-right">Max DD</th>
                    <th className="text-right">Sharpe</th>
                    <th className="text-right">PF</th>
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
                      <td className="text-right font-semibold tabular-nums">{Number.isFinite(r.score) ? fmtNum(r.score) : '—'}</td>
                      <td className={`text-right tabular-nums ${pnlClass(r.metrics?.netProfitPct)}`}>{r.metrics ? fmtPct(r.metrics.netProfitPct) : (r.error ?? '—')}</td>
                      <td className="text-right tabular-nums">{r.metrics?.totalTrades ?? '—'}</td>
                      <td className="text-right tabular-nums">{r.metrics ? `${r.metrics.winRate.toFixed(0)} %` : '—'}</td>
                      <td className="text-right tabular-nums text-down">{r.metrics ? fmtPct(-r.metrics.maxDrawdownPct) : '—'}</td>
                      <td className="text-right tabular-nums">{fmtNum(r.metrics?.sharpe ?? null)}</td>
                      <td className="text-right tabular-nums">{fmtNum(r.metrics?.profitFactor ?? null)}</td>
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
