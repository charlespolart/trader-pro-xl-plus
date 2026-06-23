import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { defaultParams, type BotConfig, type BotRiskConfig, type MarketType, type ParamValues } from '@tpx/shared'
import { api, type StrategyDTO } from '../lib/api'
import { useBots } from '../lib/ws'
import { Pencil, Play, Plus, Square, Trash2 } from 'lucide-react'
import { fmtNum, pnlClass } from '../lib/format'
import { Badge, Card, Empty, Field, Modal, PageHeader } from '../components/ui'
import { alertDialog, confirmDialog } from '../components/dialog'
import { ParamsForm } from '../components/ParamsForm'

interface BotDraft {
  id?: string
  name: string
  strategyId: string
  market: MarketType
  symbol: string
  mode: BotConfig['mode']
  allocation: number
  leverage: number
  params: ParamValues
  risk: BotRiskConfig
}

export function Bots() {
  const infos = Object.values(useBots((s) => s.infos))
  const qc = useQueryClient()
  const { data: strategies } = useQuery({ queryKey: ['strategies'], queryFn: api.strategies })
  const [draft, setDraft] = useState<BotDraft | null>(null)
  const [error, setError] = useState('')

  const save = useMutation({
    mutationFn: async (d: BotDraft) => {
      if (d.id) return api.updateBot(d.id, d)
      return api.createBot(d)
    },
    onSuccess: async () => {
      setDraft(null)
      setError('')
      const list = await api.bots()
      useBots.getState().setAll(list)
      void qc.invalidateQueries({ queryKey: ['bots'] })
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  })

  const action = useMutation({
    mutationFn: async ({ id, act }: { id: string; act: 'start' | 'stop' | 'stop-close' | 'resume' | 'delete' }) => {
      if (act === 'start') await api.startBot(id)
      else if (act === 'stop') await api.stopBot(id, false)
      else if (act === 'stop-close') await api.stopBot(id, true)
      else if (act === 'resume') await api.resumeBot(id)
      else await api.deleteBot(id)
    },
    onSuccess: async () => {
      const list = await api.bots()
      useBots.getState().setAll(list)
    },
    onError: (e) => void alertDialog({ title: 'Erreur', message: e instanceof Error ? e.message : String(e), tone: 'danger' }),
  })

  const newDraft = (): void => {
    const s = strategies?.find((x) => !x.error)
    if (!s) {
      void alertDialog({ message: 'Aucune stratégie valide disponible.' })
      return
    }
    setDraft({
      name: '',
      strategyId: s.id,
      market: (s.markets?.[0] ?? 'spot') as MarketType,
      symbol: 'BTCUSDT',
      mode: 'paper',
      allocation: 1000,
      leverage: 1,
      params: s.defaults ?? {},
      risk: {},
    })
  }

  const editDraft = (cfg: BotConfig): void => {
    setDraft({
      id: cfg.id,
      name: cfg.name,
      strategyId: cfg.strategyId,
      market: cfg.market,
      symbol: cfg.symbol,
      mode: cfg.mode,
      allocation: cfg.allocation,
      leverage: cfg.leverage,
      params: cfg.params,
      risk: cfg.risk,
    })
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bots"
        subtitle="Configurez et pilotez vos bots de trading (paper, testnet, live)"
        actions={
          <button className="btn-primary" onClick={newDraft}>
            <Plus size={16} /> Nouveau bot
          </button>
        }
      />

      <Card bodyClassName={infos.length === 0 ? 'p-4' : 'p-0'}>
        {infos.length === 0 ? (
          <Empty>Aucun bot configuré</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Stratégie</th>
                <th>Marché / Paire</th>
                <th>Mode</th>
                <th>Statut</th>
                <th className="text-right">Équité</th>
                <th className="text-right">PnL total</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {infos.map((b) => {
                const stopped = b.status === 'stopped' || b.status === 'killed'
                return (
                  <tr key={b.config.id}>
                    <td>
                      <Link to={`/bots/${b.config.id}`} className="text-accent hover:underline">
                        {b.config.name}
                      </Link>
                    </td>
                    <td className="text-zinc-400">{b.config.strategyId}</td>
                    <td>
                      <Badge value={b.config.market} /> {b.config.symbol}
                      {b.config.market === 'futures' && <span className="ml-1 text-xs text-zinc-500">×{b.config.leverage}</span>}
                    </td>
                    <td><Badge value={b.config.mode} /></td>
                    <td>
                      <Badge value={b.status} />
                      {b.statusReason !== undefined && <div className="text-[11px] text-zinc-500">{b.statusReason}</div>}
                    </td>
                    <td className="text-right tabular-nums">{fmtNum(b.equity)}</td>
                    <td className={`text-right tabular-nums ${pnlClass(b.realizedPnlTotal)}`}>{fmtNum(b.realizedPnlTotal)}</td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        {stopped && (
                          <>
                            <button className="btn-success btn-sm btn-icon" title="Démarrer" onClick={() => action.mutate({ id: b.config.id, act: 'start' })}>
                              <Play size={15} />
                            </button>
                            <button className="btn btn-sm btn-icon" title="Modifier" onClick={() => editDraft(b.config)}>
                              <Pencil size={15} />
                            </button>
                            <button
                              className="btn-danger btn-sm btn-icon"
                              title="Supprimer"
                              onClick={async () => {
                                if (await confirmDialog({ title: 'Supprimer le bot', message: `Supprimer définitivement « ${b.config.name} » ?`, confirmLabel: 'Supprimer', tone: 'danger' }))
                                  action.mutate({ id: b.config.id, act: 'delete' })
                              }}
                            >
                              <Trash2 size={15} />
                            </button>
                          </>
                        )}
                        {b.status === 'paused_risk' && (
                          <button className="btn-ghost btn-sm" onClick={() => action.mutate({ id: b.config.id, act: 'resume' })}>
                            Reprendre
                          </button>
                        )}
                        {!stopped && (
                          <>
                            <button className="btn-ghost btn-sm" onClick={() => action.mutate({ id: b.config.id, act: 'stop' })}>
                              <Square size={14} /> Stop
                            </button>
                            <button
                              className="btn-danger btn-sm"
                              onClick={async () => {
                                if (await confirmDialog({ title: 'Fermer la position', message: 'Arrêter le bot ET fermer sa position au marché ?', confirmLabel: 'Arrêter & fermer', tone: 'danger' }))
                                  action.mutate({ id: b.config.id, act: 'stop-close' })
                              }}
                            >
                              <Square size={14} /> Fermer
                            </button>
                          </>
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

      <Modal open={draft !== null} onClose={() => setDraft(null)} title={draft?.id ? 'Modifier le bot' : 'Nouveau bot'} wide>
        {draft && strategies && (
          <BotForm
            draft={draft}
            strategies={strategies.filter((s) => !s.error)}
            error={error}
            busy={save.isPending}
            onChange={setDraft}
            onSubmit={() => save.mutate(draft)}
          />
        )}
      </Modal>
    </div>
  )
}

function BotForm({
  draft,
  strategies,
  error,
  busy,
  onChange,
  onSubmit,
}: {
  draft: BotDraft
  strategies: StrategyDTO[]
  error: string
  busy: boolean
  onChange: (d: BotDraft) => void
  onSubmit: () => void
}) {
  const strategy = useMemo(() => strategies.find((s) => s.id === draft.strategyId), [strategies, draft.strategyId])
  const markets = strategy?.markets ?? ['spot', 'futures']

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

  const setRisk = (key: keyof BotRiskConfig, v: string): void => {
    const risk = { ...draft.risk }
    if (v === '') delete risk[key]
    else risk[key] = Number(v)
    onChange({ ...draft, risk })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Field label="Nom">
          <input className="input" value={draft.name} placeholder="auto" onChange={(e) => onChange({ ...draft, name: e.target.value })} />
        </Field>
        <Field label="Stratégie">
          <select className="input" value={draft.strategyId} onChange={(e) => setStrategy(e.target.value)}>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name ?? s.id}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Mode">
          <select className="input" value={draft.mode} onChange={(e) => onChange({ ...draft, mode: e.target.value as BotDraft['mode'] })}>
            <option value="paper">Paper (simulation live)</option>
            <option value="testnet">Testnet Binance</option>
            <option value="live">LIVE (argent réel)</option>
          </select>
        </Field>
        <Field label="Marché">
          <select className="input" value={draft.market} onChange={(e) => onChange({ ...draft, market: e.target.value as MarketType })}>
            {markets.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Paire">
          <input className="input" value={draft.symbol} onChange={(e) => onChange({ ...draft, symbol: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Allocation (quote)">
          <input className="input" type="number" value={draft.allocation} onChange={(e) => onChange({ ...draft, allocation: Number(e.target.value) })} />
        </Field>
        {draft.market === 'futures' && (
          <Field label="Levier">
            <input
              className="input"
              type="number"
              min={1}
              max={125}
              value={draft.leverage}
              onChange={(e) => onChange({ ...draft, leverage: Number(e.target.value) })}
            />
          </Field>
        )}
      </div>

      {strategy?.schema && (
        <div className="card bg-panel2/50 p-4">
          <ParamsForm schema={strategy.schema} values={draft.params} onChange={(params) => onChange({ ...draft, params })} />
        </div>
      )}

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Gestion du risque (vide = désactivé)</div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Position max (quote)">
            <input className="input" type="number" value={draft.risk.maxPositionQuote ?? ''} onChange={(e) => setRisk('maxPositionQuote', e.target.value)} />
          </Field>
          <Field label="Perte max / jour (quote)">
            <input className="input" type="number" value={draft.risk.maxDailyLossQuote ?? ''} onChange={(e) => setRisk('maxDailyLossQuote', e.target.value)} />
          </Field>
          <Field label="Drawdown max (%)">
            <input className="input" type="number" value={draft.risk.maxDrawdownPct ?? ''} onChange={(e) => setRisk('maxDrawdownPct', e.target.value)} />
          </Field>
          <Field label="Pertes consécutives max">
            <input className="input" type="number" value={draft.risk.maxConsecutiveLosses ?? ''} onChange={(e) => setRisk('maxConsecutiveLosses', e.target.value)} />
          </Field>
          <Field label="Cooldown après perte (min)">
            <input
              className="input"
              type="number"
              value={draft.risk.cooldownAfterLossMs !== undefined ? draft.risk.cooldownAfterLossMs / 60000 : ''}
              onChange={(e) => setRisk('cooldownAfterLossMs', e.target.value === '' ? '' : String(Number(e.target.value) * 60000))}
            />
          </Field>
          <Field label="Ordres ouverts max">
            <input className="input" type="number" value={draft.risk.maxOpenOrders ?? ''} onChange={(e) => setRisk('maxOpenOrders', e.target.value)} />
          </Field>
        </div>
      </div>

      {draft.mode === 'live' && (
        <div className="rounded-md border border-down/40 bg-down/10 px-3 py-2 text-sm text-down">
          ⚠️ Mode LIVE : ce bot tradera avec de l'argent réel via vos clés API.
        </div>
      )}
      {error !== '' && <div className="text-sm text-down">{error}</div>}
      <div className="flex justify-end">
        <button className="btn-primary" onClick={onSubmit} disabled={busy}>
          {draft.id ? 'Enregistrer' : 'Créer le bot'}
        </button>
      </div>
    </div>
  )
}
