import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DEFAULT_FEES,
  defaultParams,
  type BacktestConfig,
  type MarketType,
  type ParamValues,
} from '@tpx/shared'
import { api, type StrategyDTO } from '../lib/api'
import { useProgress } from '../lib/ws'
import { dateToInputValue, fmtDate, fmtPct, inputValueToMs, pnlClass } from '../lib/format'
import { Badge, Card, Empty, Field, Modal, ProgressBar } from '../components/ui'
import { ParamsForm } from '../components/ParamsForm'

interface BtDraft {
  strategyId: string
  market: MarketType
  symbol: string
  from: string
  to: string
  initialBalance: number
  leverage: number
  makerRate: number
  takerRate: number
  bnbDiscount: boolean
  slippagePct: number
  fillMode: 'candle' | 'aggtrades'
  intrabarPath: 'heuristic' | 'pessimistic'
  fundingEnabled: boolean
  label: string
  params: ParamValues
}

export function Backtests() {
  const qc = useQueryClient()
  const { data: runs } = useQuery({ queryKey: ['backtests'], queryFn: api.backtests, refetchInterval: 5_000 })
  const { data: strategies } = useQuery({ queryKey: ['strategies'], queryFn: api.strategies })
  const progress = useProgress((s) => s.backtests)
  const [draft, setDraft] = useState<BtDraft | null>(null)
  const [error, setError] = useState('')

  const submit = useMutation({
    mutationFn: (d: BtDraft) => {
      const config: Partial<BacktestConfig> = {
        strategyId: d.strategyId,
        market: d.market,
        symbol: d.symbol,
        start: inputValueToMs(d.from),
        end: inputValueToMs(d.to) + 86_400_000,
        initialBalance: d.initialBalance,
        leverage: d.leverage,
        fees: { makerRate: d.makerRate, takerRate: d.takerRate, bnbDiscount: d.bnbDiscount },
        slippagePct: d.slippagePct,
        fillMode: d.fillMode,
        intrabarPath: d.intrabarPath,
        fundingEnabled: d.fundingEnabled,
        params: d.params,
      }
      return api.submitBacktest(config, d.label || undefined)
    },
    onSuccess: () => {
      setDraft(null)
      setError('')
      void qc.invalidateQueries({ queryKey: ['backtests'] })
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  })

  const act = useMutation({
    mutationFn: async ({ id, del }: { id: string; del: boolean }) => {
      if (del) await api.deleteBacktest(id)
      else await api.cancelBacktest(id)
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['backtests'] }),
  })

  const newDraft = (): void => {
    const s = strategies?.find((x) => !x.error)
    if (!s) return
    const now = Date.now()
    setDraft({
      strategyId: s.id,
      market: (s.markets?.[0] ?? 'spot') as MarketType,
      symbol: 'BTCUSDT',
      from: dateToInputValue(now - 180 * 86_400_000),
      to: dateToInputValue(now - 86_400_000),
      initialBalance: 10_000,
      leverage: 1,
      makerRate: DEFAULT_FEES.spot.makerRate,
      takerRate: DEFAULT_FEES.spot.takerRate,
      bnbDiscount: true,
      slippagePct: 0.0005,
      fillMode: 'candle',
      intrabarPath: 'heuristic',
      fundingEnabled: true,
      label: '',
      params: s.defaults ?? {},
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Backtests</h1>
        <button className="btn-primary" onClick={newDraft}>
          + Nouveau backtest
        </button>
      </div>

      <Card>
        {!runs || runs.length === 0 ? (
          <Empty>Aucun backtest</Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th>Label</th>
                <th>Stratégie</th>
                <th>Paire</th>
                <th>Période</th>
                <th>Statut</th>
                <th>Profit</th>
                <th>Trades</th>
                <th>Max DD</th>
                <th>PF</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const p = progress[r.id]
                const status = p?.status ?? r.status
                const ratio = p?.progress ?? r.progress
                const active = status === 'running' || status === 'pending' || status === 'fetching_data'
                return (
                  <tr key={r.id}>
                    <td>
                      <Link to={`/backtests/${r.id}`} className="text-accent hover:underline">
                        {r.config.label ?? r.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="text-zinc-400">{r.config.strategyId}</td>
                    <td>
                      {r.config.symbol} <Badge value={r.config.market} />
                    </td>
                    <td className="text-zinc-400">
                      {fmtDate(r.config.start).split(' ')[0]} → {fmtDate(r.config.end).split(' ')[0]}
                    </td>
                    <td className="min-w-32">
                      {active ? <ProgressBar ratio={ratio} /> : <Badge value={status} />}
                      {(p?.error ?? r.error) !== undefined && <div className="text-[11px] text-down">{p?.error ?? r.error}</div>}
                    </td>
                    <td className={pnlClass(r.metrics?.netProfitPct)}>{r.metrics ? fmtPct(r.metrics.netProfitPct) : '—'}</td>
                    <td>{r.metrics?.totalTrades ?? '—'}</td>
                    <td className="text-down">{r.metrics ? fmtPct(-r.metrics.maxDrawdownPct) : '—'}</td>
                    <td>{r.metrics?.profitFactor?.toFixed(2) ?? '—'}</td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        {active ? (
                          <button className="btn-ghost" onClick={() => act.mutate({ id: r.id, del: false })}>
                            Annuler
                          </button>
                        ) : (
                          <button className="btn-danger" onClick={() => confirm('Supprimer ce backtest ?') && act.mutate({ id: r.id, del: true })}>
                            🗑
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

      <Modal open={draft !== null} onClose={() => setDraft(null)} title="Nouveau backtest" wide>
        {draft && strategies && (
          <BacktestForm
            draft={draft}
            strategies={strategies.filter((s) => !s.error)}
            error={error}
            busy={submit.isPending}
            onChange={setDraft}
            onSubmit={() => submit.mutate(draft)}
          />
        )}
      </Modal>
    </div>
  )
}

function BacktestForm({
  draft,
  strategies,
  error,
  busy,
  onChange,
  onSubmit,
}: {
  draft: BtDraft
  strategies: StrategyDTO[]
  error: string
  busy: boolean
  onChange: (d: BtDraft) => void
  onSubmit: () => void
}) {
  const strategy = useMemo(() => strategies.find((s) => s.id === draft.strategyId), [strategies, draft.strategyId])

  const setStrategy = (id: string): void => {
    const s = strategies.find((x) => x.id === id)
    if (!s) return
    onChange({
      ...draft,
      strategyId: id,
      market: (s.markets?.includes(draft.market) ? draft.market : (s.markets?.[0] ?? 'spot')) as MarketType,
      params: s.schema ? defaultParams(s.schema) : {},
    })
  }

  const setMarket = (market: MarketType): void => {
    onChange({
      ...draft,
      market,
      makerRate: DEFAULT_FEES[market].makerRate,
      takerRate: DEFAULT_FEES[market].takerRate,
      bnbDiscount: DEFAULT_FEES[market].bnbDiscount,
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <Field label="Stratégie">
          <select className="input" value={draft.strategyId} onChange={(e) => setStrategy(e.target.value)}>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name ?? s.id}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Marché">
          <select className="input" value={draft.market} onChange={(e) => setMarket(e.target.value as MarketType)}>
            {(strategy?.markets ?? ['spot', 'futures']).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Paire">
          <input className="input" value={draft.symbol} onChange={(e) => onChange({ ...draft, symbol: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Label">
          <input className="input" value={draft.label} placeholder="optionnel" onChange={(e) => onChange({ ...draft, label: e.target.value })} />
        </Field>
        <Field label="Du">
          <input className="input" type="date" value={draft.from} onChange={(e) => onChange({ ...draft, from: e.target.value })} />
        </Field>
        <Field label="Au (inclus)">
          <input className="input" type="date" value={draft.to} onChange={(e) => onChange({ ...draft, to: e.target.value })} />
        </Field>
        <Field label="Capital initial">
          <input className="input" type="number" value={draft.initialBalance} onChange={(e) => onChange({ ...draft, initialBalance: Number(e.target.value) })} />
        </Field>
        {draft.market === 'futures' && (
          <Field label="Levier">
            <input className="input" type="number" min={1} max={125} value={draft.leverage} onChange={(e) => onChange({ ...draft, leverage: Number(e.target.value) })} />
          </Field>
        )}
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Field label="Frais maker" hint="0.001 = 0.10 %">
          <input className="input" type="number" step="0.0001" value={draft.makerRate} onChange={(e) => onChange({ ...draft, makerRate: Number(e.target.value) })} />
        </Field>
        <Field label="Frais taker">
          <input className="input" type="number" step="0.0001" value={draft.takerRate} onChange={(e) => onChange({ ...draft, takerRate: Number(e.target.value) })} />
        </Field>
        <label className="flex cursor-pointer items-center gap-2 self-end py-2 text-sm">
          <input type="checkbox" checked={draft.bnbDiscount} onChange={(e) => onChange({ ...draft, bnbDiscount: e.target.checked })} className="accent-blue-500" />
          Réduction BNB ({draft.market === 'spot' ? '-25 %' : '-10 %'})
        </label>
        <Field label="Slippage" hint="0.0005 = 5 bps sur les fills taker">
          <input className="input" type="number" step="0.0001" value={draft.slippagePct} onChange={(e) => onChange({ ...draft, slippagePct: Number(e.target.value) })} />
        </Field>
        <Field label="Simulation des fills">
          <select className="input" value={draft.fillMode} onChange={(e) => onChange({ ...draft, fillMode: e.target.value as BtDraft['fillMode'] })}>
            <option value="candle">Bougies (rapide)</option>
            <option value="aggtrades">aggTrades (précis, télécharge les trades)</option>
          </select>
        </Field>
        <Field label="Chemin intra-bougie">
          <select className="input" value={draft.intrabarPath} onChange={(e) => onChange({ ...draft, intrabarPath: e.target.value as BtDraft['intrabarPath'] })}>
            <option value="heuristic">Heuristique O→L→H→C</option>
            <option value="pessimistic">Pessimiste (stops d'abord)</option>
          </select>
        </Field>
        {draft.market === 'futures' && (
          <label className="flex cursor-pointer items-center gap-2 self-end py-2 text-sm">
            <input type="checkbox" checked={draft.fundingEnabled} onChange={(e) => onChange({ ...draft, fundingEnabled: e.target.checked })} className="accent-blue-500" />
            Funding historique
          </label>
        )}
      </div>

      {strategy?.schema && (
        <div className="card bg-panel2/50 p-4">
          <ParamsForm schema={strategy.schema} values={draft.params} onChange={(params) => onChange({ ...draft, params })} />
        </div>
      )}

      {error !== '' && <div className="text-sm text-down">{error}</div>}
      <div className="flex justify-end">
        <button className="btn-primary" onClick={onSubmit} disabled={busy}>
          Lancer le backtest
        </button>
      </div>
    </div>
  )
}
