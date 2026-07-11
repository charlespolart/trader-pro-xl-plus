import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { defaultParams, type BotConfig, type BotRiskConfig, type MarketType, type Order, type ParamValues } from '@tpx/shared'
import { api, type StrategyDTO } from '../lib/api'
import { useBots } from '../lib/ws'
import { Pencil, Play, Plus, Square, Trash2 } from 'lucide-react'
import { fmtNum, pnlClass } from '../lib/format'
import { Badge, Card, Empty, Field, Modal, PageHeader } from '../components/ui'
import { alertDialog, confirmDialog } from '../components/dialog'
import { ParamsForm } from '../components/ParamsForm'

/** un stop-loss / take-profit = ordre conditionnel déposé sur l'exchange (pas
 *  une position spot classique) — l'annuler à l'arrêt laisse la position à nu */
const isProtective = (o: Order): boolean =>
  o.type === 'STOP_MARKET' || o.type === 'STOP_LIMIT' || o.type === 'TAKE_PROFIT_MARKET' || o.type === 'TAKE_PROFIT_LIMIT' || o.tag === 'sl' || o.tag === 'tp'

function orderLabel(o: Order): string {
  const kind =
    o.type === 'STOP_MARKET' || o.type === 'STOP_LIMIT' || o.tag === 'sl'
      ? 'Stop-loss'
      : o.type === 'TAKE_PROFIT_MARKET' || o.type === 'TAKE_PROFIT_LIMIT' || o.tag === 'tp'
        ? 'Take-profit'
        : o.type === 'LIMIT' || o.type === 'LIMIT_MAKER'
          ? 'Ordre limite'
          : o.type
  const trigger = o.stopPrice ?? o.price
  return `${kind} · ${o.side} ${o.qty}${trigger !== undefined ? ` @ ${trigger}` : ''}`
}

interface BotDraft {
  id?: string
  name: string
  strategyId: string
  market: MarketType
  symbol: string
  mode: BotConfig['mode']
  allocation: number
  initialBaseQty?: number
  adoptAllBase?: boolean
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
    mutationFn: async ({ id, act }: { id: string; act: 'start' | 'stop' | 'resume' | 'delete' }) => {
      if (act === 'start') await api.startBot(id)
      else if (act === 'stop') await api.stopBot(id)
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
    const base = s.backtest?.denomination === 'base'
    setDraft({
      name: '',
      strategyId: s.id,
      market: (s.markets?.[0] ?? 'spot') as MarketType,
      symbol: s.symbol ?? 'BTCUSDT',
      mode: 'paper',
      allocation: base ? 0 : 1000,
      initialBaseQty: base ? 1 : undefined,
      adoptAllBase: undefined,
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
      initialBaseQty: cfg.initialBaseQty,
      adoptAllBase: cfg.adoptAllBase,
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
                          <button
                            className="btn-ghost btn-sm"
                            title="Arrête le bot sans aucune transaction — la position reste telle quelle (corrections à la main sur la plateforme)"
                            onClick={async () => {
                              const open = b.openOrders ?? []
                              // warning UNIQUEMENT s'il y a vraiment un ordre résident
                              // (stop-loss/TP/limite) : l'annuler laisse la position à nu
                              if (open.length > 0) {
                                const protective = open.filter(isProtective)
                                const ok = await confirmDialog({
                                  title: protective.length > 0 ? '⚠ Stop-loss en cours' : 'Ordres en cours',
                                  message: (
                                    <div className="space-y-2">
                                      <p>
                                        Ce bot a {open.length} ordre{open.length > 1 ? 's' : ''} déposé{open.length > 1 ? 's' : ''} sur l'exchange
                                        {protective.length > 0 ? (
                                          <>
                                            , dont <strong className="text-down">{protective.length} ordre{protective.length > 1 ? 's' : ''} de protection</strong>
                                          </>
                                        ) : null}{' '}:
                                      </p>
                                      <ul className="rounded-md border border-edge bg-panel2/60 px-3 py-2 font-mono text-[12px] leading-relaxed">
                                        {open.map((o) => (
                                          <li key={o.id} className={isProtective(o) ? 'text-down' : 'text-zinc-300'}>
                                            {orderLabel(o)}
                                          </li>
                                        ))}
                                      </ul>
                                      <p>
                                        Arrêter le bot va les <strong>annuler</strong>
                                        {protective.length > 0 ? (
                                          <>
                                            {' '}— la position ne sera <strong className="text-down">plus protégée</strong>
                                          </>
                                        ) : null}
                                        . Aucun achat/vente n'est passé ; les corrections se font à la main sur la plateforme.
                                      </p>
                                    </div>
                                  ),
                                  confirmLabel: 'Annuler les ordres & arrêter',
                                  tone: 'danger',
                                })
                                if (!ok) return
                              }
                              action.mutate({ id: b.config.id, act: 'stop' })
                            }}
                          >
                            <Square size={14} /> Stop
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
  // texte de saisie de la position initiale (null = affiché depuis le draft) —
  // permet de taper « 0, » ou « 0,202221025 » sans que le parseur efface le champ
  const [qtyText, setQtyText] = useState<string | null>(null)
  // saisie en % du solde base réel (live/testnet) : le slider calcule une
  // quantité ABSOLUE stockée dans initialBaseQty — jamais un « % » persistant
  // (deux bots à 50 % résolus à des moments différents = sur-revendication).
  const [pctMode, setPctMode] = useState(false)
  const [pct, setPct] = useState(50)
  const baseAsset = draft.symbol.replace(/(USDT|USDC|FDUSD|BUSD|EUR|USD)$/, '') || 'base'
  // le DÉPART est imposé par la stratégie : base-denom (accumulateurs) = on
  // détient déjà les coins ; les autres = capital en quote. Pas de choix.
  const startsInBase = draft.market === 'spot' && strategy?.backtest?.denomination === 'base'
  // solde base réel (live/testnet) pour la saisie en % — cache serveur 10 s
  const { data: account } = useQuery({
    queryKey: ['account', draft.mode],
    queryFn: () => api.account(draft.mode as 'live' | 'testnet'),
    enabled: startsInBase && draft.mode !== 'paper',
    staleTime: 10_000,
  })
  const baseFree = account?.spot?.find((b) => b.asset === baseAsset)?.free
  const pctQty = (p: number): number | undefined =>
    baseFree !== undefined && baseFree > 0 ? Math.floor(((baseFree * p) / 100) * 1e8) / 1e8 : undefined

  const setStrategy = (id: string): void => {
    const s = strategies.find((x) => x.id === id)
    if (!s) return
    const base = s.backtest?.denomination === 'base'
    onChange({
      ...draft,
      strategyId: id,
      market: (s.markets?.includes(draft.market) ? draft.market : (s.markets?.[0] ?? 'spot')) as MarketType,
      symbol: s.symbol ?? draft.symbol,
      params: s.schema ? defaultParams(s.schema) : {},
      allocation: base ? 0 : draft.allocation > 0 ? draft.allocation : 1000,
      adoptAllBase: base && draft.mode !== 'paper' ? true : undefined,
      initialBaseQty: base && draft.mode === 'paper' ? (draft.initialBaseQty ?? 1) : undefined,
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
          <select
            className="input"
            value={draft.mode}
            onChange={(e) => {
              const mode = e.target.value as BotDraft['mode']
              if (startsInBase) {
                onChange({
                  ...draft,
                  mode,
                  adoptAllBase: mode === 'paper' ? undefined : true,
                  initialBaseQty: mode === 'paper' ? (draft.initialBaseQty ?? 1) : undefined,
                })
              } else {
                onChange({ ...draft, mode })
              }
            }}
          >
            <option value="paper">Paper (simulation live)</option>
            <option value="testnet">Testnet OKX (démo)</option>
            <option value="live">LIVE (argent réel)</option>
          </select>
        </Field>
        <Field label="Marché">
          <select
            className="input"
            value={draft.market}
            disabled={markets.length <= 1}
            onChange={(e) => onChange({ ...draft, market: e.target.value as MarketType })}
          >
            {markets.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Paire">
          <input
            className="input num"
            value={draft.symbol}
            disabled={strategy?.symbol !== undefined}
            onChange={(e) => onChange({ ...draft, symbol: e.target.value.toUpperCase() })}
          />
        </Field>
        {!startsInBase && (
          <Field
            label={draft.market === 'futures' ? 'Allocation de marge (quote)' : 'Allocation (USDC/USDT)'}
            hint="Capital de départ, lu au premier démarrage — ensuite le bot compose avec ses gains et pertes."
          >
            <input className="input" type="number" step="any" value={draft.allocation} onChange={(e) => onChange({ ...draft, allocation: Number(e.target.value) })} />
          </Field>
        )}
        {startsInBase && (
          <Field
            label={`Position initiale (${baseAsset})`}
            hint={`Le bot commence en détenant ces ${baseAsset}${draft.mode === 'paper' ? ' (simulé)' : ''}.`}
          >
            <div className="space-y-1.5">
              {draft.mode !== 'paper' && (
                <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-zinc-300">
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={draft.adoptAllBase ?? false}
                    onChange={(e) => {
                      setQtyText(null)
                      onChange({ ...draft, adoptAllBase: e.target.checked ? true : undefined, initialBaseQty: e.target.checked ? undefined : (draft.initialBaseQty ?? 1) })
                    }}
                  />
                  Adopter tout le solde disponible
                </label>
              )}
              {draft.adoptAllBase !== true && (
                <>
                  {draft.mode !== 'paper' && (
                    <div className="flex gap-1">
                      {([['Quantité', false], ['% du solde', true]] as const).map(([label, m]) => (
                        <button
                          key={label}
                          type="button"
                          className={`rounded-md px-2 py-0.5 text-[11.5px] ${pctMode === m ? 'bg-accent/20 text-accent' : 'text-zinc-500 hover:text-zinc-300'}`}
                          onClick={() => {
                            setPctMode(m)
                            setQtyText(null)
                            if (m) {
                              const q = pctQty(pct)
                              if (q !== undefined) onChange({ ...draft, initialBaseQty: q })
                            }
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  {pctMode && draft.mode !== 'paper' ? (
                    baseFree !== undefined && baseFree > 0 ? (
                      <div className="space-y-1">
                        <input
                          type="range"
                          min={1}
                          max={100}
                          step={1}
                          value={pct}
                          className="w-full accent-accent"
                          onChange={(e) => {
                            const p = Number(e.target.value)
                            setPct(p)
                            const q = pctQty(p)
                            if (q !== undefined) onChange({ ...draft, initialBaseQty: q })
                          }}
                        />
                        <div className="text-[12.5px] text-zinc-400">
                          {pct} % ≈ <span className="tabular-nums text-zinc-200">{draft.initialBaseQty ?? '—'}</span> {baseAsset}
                          <span className="ml-2 text-zinc-500">(solde libre : {baseFree} {baseAsset})</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-[12.5px] text-zinc-500">
                        Solde {baseAsset} indisponible ({account?.configured === false ? 'clés OKX non configurées pour ce mode' : 'aucun solde libre'}) — utilisez la saisie en quantité.
                      </div>
                    )
                  ) : (
                    <input
                      className="input"
                      type="text"
                      inputMode="decimal"
                      placeholder="ex. 0.5 ou 0,202221025"
                      value={qtyText ?? (draft.initialBaseQty !== undefined ? String(draft.initialBaseQty) : '')}
                      onChange={(e) => {
                        // saisie tolérante : virgule française OU point, précision libre
                        // (type="number" refuse la virgule selon la locale et vide le
                        // champ en silence — ici on garde le texte tel quel pendant la
                        // frappe et on ne committe que les nombres finis)
                        const raw = e.target.value
                        setQtyText(raw)
                        const n = Number(raw.replace(',', '.').trim())
                        onChange({ ...draft, initialBaseQty: raw.trim() === '' || !Number.isFinite(n) ? undefined : n })
                      }}
                      onBlur={() => setQtyText(null)}
                    />
                  )}
                </>
              )}
            </div>
          </Field>
        )}
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
            <input className="input" type="number" step="any" value={draft.risk.maxPositionQuote ?? ''} onChange={(e) => setRisk('maxPositionQuote', e.target.value)} />
          </Field>
          <Field label="Perte max / jour (quote)">
            <input className="input" type="number" step="any" value={draft.risk.maxDailyLossQuote ?? ''} onChange={(e) => setRisk('maxDailyLossQuote', e.target.value)} />
          </Field>
          <Field label="Drawdown max (%)">
            <input className="input" type="number" step="any" value={draft.risk.maxDrawdownPct ?? ''} onChange={(e) => setRisk('maxDrawdownPct', e.target.value)} />
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
        <div className="border border-down/40 bg-down/10 px-3 py-2 text-sm text-down">
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
