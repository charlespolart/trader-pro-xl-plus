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
import { Plus, Trash2 } from 'lucide-react'
import { dateToInputValue, fmtDate, fmtPct, inputValueToMs, pnlClass } from '../lib/format'
import { Badge, Card, Empty, Field, Modal, PageHeader, ProgressBar } from '../components/ui'
import { confirmDialog } from '../components/dialog'
import { ParamsForm } from '../components/ParamsForm'

interface BtDraft {
  strategyId: string
  market: MarketType
  symbol: string
  from: string
  to: string
  initialBalance: number
  denomination: 'quote' | 'base'
  leverage: number
  makerRate: number
  takerRate: number
  slippagePct: number
  fillMode: 'candle' | 'aggtrades'
  intrabarPath: 'heuristic' | 'pessimistic'
  fundingEnabled: boolean
  label: string
  params: ParamValues
}

/** actif de base pour les libellés (ETHUSDT → ETH) ; approximation UI, le moteur utilise symbolInfo */
function baseAssetOf(symbol: string): string {
  const m = symbol.toUpperCase().match(/^(.+?)(USDT|USDC|FDUSD|BUSD|BTC|ETH|EUR|USD)$/)
  return m ? m[1]! : symbol
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
        denomination: d.denomination,
        leverage: d.leverage,
        fees: { makerRate: d.makerRate, takerRate: d.takerRate },
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
    const bt = s.backtest
    const market = (bt?.market ?? s.markets?.[0] ?? 'spot') as MarketType
    const denomination = (bt?.denomination ?? 'quote') as 'quote' | 'base'
    setDraft({
      strategyId: s.id,
      market,
      symbol: 'BTCUSDT',
      from: dateToInputValue(now - 180 * 86_400_000),
      to: dateToInputValue(now - 86_400_000),
      initialBalance: bt?.initialBalance ?? 10_000,
      denomination,
      leverage: 1,
      makerRate: DEFAULT_FEES.spot.makerRate,
      takerRate: DEFAULT_FEES.spot.takerRate,
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
      <PageHeader
        title="Backtests"
        subtitle="Historique des simulations et leurs performances"
        actions={
          <button className="btn-primary" onClick={newDraft}>
            <Plus size={16} /> Nouveau backtest
          </button>
        }
      />

      <Card bodyClassName={!runs || runs.length === 0 ? 'p-4' : 'p-0'}>
        {!runs || runs.length === 0 ? (
          <Empty>Aucun backtest</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Stratégie</th>
                <th>Paire</th>
                <th>Période</th>
                <th>Statut</th>
                <th className="text-right">Profit</th>
                <th className="text-right">Trades</th>
                <th className="text-right">Max DD</th>
                <th className="text-right">PF</th>
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
                    <td className={`text-right tabular-nums ${pnlClass(r.metrics?.netProfitPct)}`}>{r.metrics ? fmtPct(r.metrics.netProfitPct) : '—'}</td>
                    <td className="text-right tabular-nums">{r.metrics?.totalTrades ?? '—'}</td>
                    <td className="text-right tabular-nums text-down">{r.metrics ? fmtPct(-r.metrics.maxDrawdownPct) : '—'}</td>
                    <td className="text-right tabular-nums">{r.metrics?.profitFactor?.toFixed(2) ?? '—'}</td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        {active ? (
                          <button className="btn-ghost btn-sm" onClick={() => act.mutate({ id: r.id, del: false })}>
                            Annuler
                          </button>
                        ) : (
                          <button
                            className="btn-danger btn-sm btn-icon"
                            title="Supprimer"
                            onClick={async () => {
                              if (await confirmDialog({ title: 'Supprimer le backtest', message: 'Supprimer ce backtest et ses résultats ?', confirmLabel: 'Supprimer', tone: 'danger' }))
                                act.mutate({ id: r.id, del: true })
                            }}
                          >
                            <Trash2 size={15} />
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
    const bt = s.backtest
    // la stratégie sélectionnée peut recommander un marché / une dénomination /
    // un capital de départ (ex : BTC Accumulator → spot, base, 1 BTC)
    const market = (bt?.market ?? (s.markets?.includes(draft.market) ? draft.market : s.markets?.[0]) ?? 'spot') as MarketType
    onChange({
      ...draft,
      strategyId: id,
      market,
      denomination: market === 'spot' ? (bt?.denomination ?? draft.denomination) : 'quote',
      initialBalance: bt?.initialBalance ?? draft.initialBalance,
      params: s.schema ? defaultParams(s.schema) : {},
    })
  }

  const setMarket = (market: MarketType): void => {
    onChange({
      ...draft,
      market,
      makerRate: DEFAULT_FEES[market].makerRate,
      takerRate: DEFAULT_FEES[market].takerRate,
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
        {draft.market === 'spot' && (
          <Field
            label="Dénomination"
            hint={
              draft.denomination === 'base'
                ? `performance mesurée en ${baseAssetOf(draft.symbol)} (accumulation)`
                : 'performance mesurée en USDT'
            }
          >
            <select
              className="input"
              value={draft.denomination}
              onChange={(e) => {
                const denomination = e.target.value as 'quote' | 'base'
                // ajuste le capital à l'échelle de l'unité (1 BTC vs 10000 USDT)
                const initialBalance =
                  denomination === 'base' && draft.initialBalance >= 100
                    ? 1
                    : denomination === 'quote' && draft.initialBalance < 100
                      ? 10_000
                      : draft.initialBalance
                onChange({ ...draft, denomination, initialBalance })
              }}
            >
              <option value="quote">USDT (standard)</option>
              <option value="base">{`Actif de base (${baseAssetOf(draft.symbol)}) — accumulation`}</option>
            </select>
          </Field>
        )}
        <Field label={draft.denomination === 'base' ? `Capital initial (en ${baseAssetOf(draft.symbol)})` : 'Capital initial (USDT)'}>
          <input
            className="input"
            type="number"
            step={draft.denomination === 'base' ? 0.01 : 1}
            value={draft.initialBalance}
            onChange={(e) => onChange({ ...draft, initialBalance: Number(e.target.value) })}
          />
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
