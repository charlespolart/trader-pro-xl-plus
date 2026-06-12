import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { INTERVALS, type Interval, type MarketType } from '@tpx/shared'
import { api } from '../lib/api'
import { useProgress } from '../lib/ws'
import { dateToInputValue, fmtDate, fmtNum, inputValueToMs } from '../lib/format'
import { Badge, Card, Empty, Field, ProgressBar } from '../components/ui'

export function DataManager() {
  const qc = useQueryClient()
  const [market, setMarket] = useState<MarketType>('spot')
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [interval, setInterval_] = useState<Interval>('1m')
  const [from, setFrom] = useState(dateToInputValue(Date.now() - 365 * 86_400_000))
  const [to, setTo] = useState(dateToInputValue(Date.now()))
  const [kind, setKind] = useState<'candles' | 'aggtrades'>('candles')
  const progress = useProgress((s) => s.downloads)

  const { data: coverage } = useQuery({
    queryKey: ['coverage', market, symbol, interval],
    queryFn: () => api.coverage(market, symbol, interval),
    refetchInterval: 10_000,
  })
  const { data: aggDays } = useQuery({
    queryKey: ['aggdays', market, symbol],
    queryFn: () => api.aggDays(market, symbol),
    refetchInterval: 15_000,
  })
  const { data: jobs } = useQuery({ queryKey: ['download-jobs'], queryFn: api.downloadJobs, refetchInterval: 5_000 })

  const submit = useMutation({
    mutationFn: () =>
      api.submitDownload(
        kind === 'candles'
          ? { kind, market, symbol, intervals: [interval], start: inputValueToMs(from), end: inputValueToMs(to) + 86_400_000 }
          : { kind, market, symbol, start: inputValueToMs(from), end: inputValueToMs(to) + 86_400_000 },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['download-jobs'] }),
    onError: (e) => alert(e instanceof Error ? e.message : String(e)),
  })

  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelDownload(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['download-jobs'] }),
  })

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold">Gestionnaire de données</h1>
      <div className="text-sm text-zinc-500">
        Les backtests téléchargent automatiquement ce qui leur manque. Cette page sert à pré-charger en masse (ZIP Binance Vision) et à
        visualiser la couverture locale.
      </div>

      <Card title="Télécharger">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Type">
            <select className="input w-40" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="candles">Bougies</option>
              <option value="aggtrades">aggTrades (lourds)</option>
            </select>
          </Field>
          <Field label="Marché">
            <select className="input w-32" value={market} onChange={(e) => setMarket(e.target.value as MarketType)}>
              <option value="spot">spot</option>
              <option value="futures">futures</option>
            </select>
          </Field>
          <Field label="Paire">
            <input className="input w-36" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
          </Field>
          {kind === 'candles' && (
            <Field label="Intervalle">
              <select className="input w-28" value={interval} onChange={(e) => setInterval_(e.target.value as Interval)}>
                {INTERVALS.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Du">
            <input className="input w-40" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Au">
            <input className="input w-40" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <button className="btn-primary" onClick={() => submit.mutate()} disabled={submit.isPending}>
            ⇩ Télécharger
          </button>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card title={`Couverture bougies — ${symbol} ${interval} (${market})`}>
          {!coverage || coverage.length === 0 ? (
            <Empty>Aucune donnée locale</Empty>
          ) : (
            <div className="space-y-1.5">
              {coverage.map((r, i) => (
                <div key={i} className="flex items-center justify-between rounded bg-panel2 px-3 py-1.5 text-sm">
                  <span>
                    {fmtDate(r.start)} → {fmtDate(r.end)}
                  </span>
                  <span className="text-xs text-zinc-500">{Math.round((r.end - r.start) / 86_400_000)} jours</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title={`aggTrades — ${symbol} (${market})`}>
          {!aggDays || aggDays.totals === undefined || aggDays.totals.days === 0 ? (
            <Empty>Aucun fichier aggTrades local</Empty>
          ) : (
            <div className="space-y-2 text-sm">
              <div>
                <b>{aggDays.totals.days}</b> jours · <b>{fmtNum(aggDays.totals.trades / 1e6, 1)} M</b> trades ·{' '}
                <b>{fmtNum(aggDays.totals.bytes / 1e9, 2)} Go</b> sur disque
              </div>
              <div className="text-xs text-zinc-500">
                {aggDays.days[0]?.day} → {aggDays.days[aggDays.days.length - 1]?.day}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card title="Téléchargements">
        {!jobs || jobs.length === 0 ? (
          <Empty>Aucun téléchargement</Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th>Label</th>
                <th>Type</th>
                <th>Statut</th>
                <th>Progression</th>
                <th>Créé</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const p = progress[j.id]
                const status = p?.status ?? j.status
                const done = p?.done ?? j.done
                const total = p?.total ?? j.total
                return (
                  <tr key={j.id}>
                    <td>{j.label}</td>
                    <td className="text-zinc-400">{j.kind}</td>
                    <td>
                      <Badge value={status} />
                      {(p?.error ?? j.error) != null && <div className="text-[11px] text-down">{p?.error ?? j.error}</div>}
                    </td>
                    <td className="min-w-40">{status === 'running' ? <ProgressBar ratio={total > 0 ? done / total : 0} /> : `${done}/${total}`}</td>
                    <td className="text-zinc-400">{fmtDate(j.createdAt)}</td>
                    <td>
                      <div className="flex justify-end">
                        {status === 'running' && (
                          <button className="btn-ghost" onClick={() => cancel.mutate(j.id)}>
                            Annuler
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
