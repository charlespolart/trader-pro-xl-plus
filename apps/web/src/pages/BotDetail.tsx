import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { effectiveCredentialName, type LogEntry, type TradeRecord } from '@tpx/shared'
import { api, type RefitConfigDTO } from '../lib/api'
import { useBots, wsClient } from '../lib/ws'
import { Check, ChevronLeft, Play } from 'lucide-react'
import { fmtDate, fmtNum, fmtPrice, fmtQty, pnlClass } from '../lib/format'
import { Badge, Card, Empty, Field, PageHeader, Stat } from '../components/ui'
import { alertDialog } from '../components/dialog'
import { TradingChart } from '../components/TradingChart'
import { TradesTable } from '../components/TradesTable'

export function BotDetail() {
  const { id = '' } = useParams()
  const info = useBots((s) => s.infos[id])
  const qc = useQueryClient()
  const [liveLogs, setLiveLogs] = useState<LogEntry[]>([])

  const running = info !== undefined && info.status !== 'stopped' && info.status !== 'killed'

  const { data: chart } = useQuery({
    queryKey: ['bot-chart', id],
    queryFn: () => api.botChart(id),
    enabled: running,
    refetchInterval: 30_000,
  })
  const { data: logs } = useQuery({ queryKey: ['bot-logs', id], queryFn: () => api.botLogs(id), enabled: running })
  const { data: trades } = useQuery({ queryKey: ['bot-trades', id], queryFn: () => api.trades(id), refetchInterval: 15_000 })

  useEffect(() => {
    setLiveLogs([])
    return wsClient.subscribe(`bot:${id}`, (event) => {
      if (event.t === 'bot:log') {
        setLiveLogs((prev) => [...prev.slice(-300), event.entry])
      } else if (event.t === 'bot:fill' || event.t === 'bot:annotation') {
        void qc.invalidateQueries({ queryKey: ['bot-chart', id] })
        void qc.invalidateQueries({ queryKey: ['bot-trades', id] })
      }
    })
  }, [id, qc])

  if (!info) {
    return (
      <Empty>
        Bot introuvable — <Link to="/bots" className="text-accent">retour aux bots</Link>
      </Empty>
    )
  }

  const cfg = info.config
  const allLogs = [...(logs ?? []), ...liveLogs].slice(-400)
  const tradeRecords: TradeRecord[] = (trades ?? []).map((t) => ({
    ...t,
    direction: t.direction as TradeRecord['direction'],
    market: t.market as TradeRecord['market'],
    entryReason: t.entryReason ?? undefined,
    exitReason: t.exitReason ?? undefined,
    backtestId: undefined,
    fills: [],
  }))

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2.5">
            {cfg.name || cfg.strategyId}
            <Badge value={cfg.market} />
            <Badge value={cfg.mode} />
            <Badge value={info.status} />
          </span>
        }
        subtitle={
          info.statusReason !== undefined
            ? info.statusReason
            : `${cfg.strategyId} · ${cfg.symbol}${effectiveCredentialName(cfg.mode, cfg.credentialName) !== null ? ` · compte ${effectiveCredentialName(cfg.mode, cfg.credentialName)}` : ''}`
        }
        actions={
          <Link to="/bots" className="btn-ghost">
            <ChevronLeft size={15} /> Bots
          </Link>
        }
      />

      {/* responsive : 5 colonnes écrasées sur mobile = illisible → 2/3/5.
          hasPosition filtre la POUSSIÈRE flottante : après une vente, la qty
          résiduelle vaut ~2.8e-17 (arith. flottante) — ce n'est PAS une
          position, l'afficher (« LONG 2.775…e-17 ») cassait aussi le layout. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="Équité" value={fmtNum(info.equity)} />
        <Stat
          label="Position"
          value={
            info.position && Math.abs(info.position.qty) > 1e-6 ? (
              <span className={info.position.qty > 0 ? 'text-up' : 'text-down'}>
                {info.position.qty > 0 ? 'LONG' : 'SHORT'} {fmtQty(Math.abs(info.position.qty))}
              </span>
            ) : (
              <span className="text-zinc-500">flat</span>
            )
          }
          sub={
            info.position && Math.abs(info.position.qty) > 1e-6 ? (
              <>
                @ {fmtPrice(info.position.entryPrice)} · uPnL <span className={pnlClass(info.position.unrealizedPnl)}>{fmtNum(info.position.unrealizedPnl)}</span>
              </>
            ) : undefined
          }
        />
        <Stat label="PnL aujourd'hui" value={fmtNum(info.realizedPnlToday)} tone={info.realizedPnlToday === 0 ? 'default' : info.realizedPnlToday > 0 ? 'up' : 'down'} />
        <Stat label="PnL total" value={fmtNum(info.realizedPnlTotal)} tone={info.realizedPnlTotal === 0 ? 'default' : info.realizedPnlTotal > 0 ? 'up' : 'down'} />
        <Stat label="Ordres ouverts" value={info.openOrders.length} />
      </div>

      {running && chart ? (
        <Card title={`${cfg.symbol} · ${chart.interval ?? ''}`}>
          <TradingChart
            candles={chart.candles}
            indicators={chart.indicators}
            annotations={chart.annotations}
            markers={[]}
            liveTopic={chart.interval ? `candles:${cfg.market}:${cfg.symbol}:${chart.interval}` : undefined}
            height={460}
          />
        </Card>
      ) : (
        <Card>
          <Empty>Démarrez le bot pour voir la chart live et ses indicateurs</Empty>
        </Card>
      )}

      {info.openOrders.length > 0 && (
        <Card title="Ordres ouverts" bodyClassName="p-0">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Sens</th>
                <th>Qté</th>
                <th>Prix</th>
                <th>Stop</th>
                <th>Statut</th>
                <th>Tag</th>
                <th>Raison</th>
              </tr>
            </thead>
            <tbody>
              {info.openOrders.map((o) => (
                <tr key={o.id}>
                  <td>{o.type}</td>
                  <td className={o.side === 'BUY' ? 'text-up' : 'text-down'}>{o.side}</td>
                  <td>{o.qty}</td>
                  <td>{fmtPrice(o.price)}</td>
                  <td>{fmtPrice(o.stopPrice)}</td>
                  <td><Badge value={o.status.toLowerCase()} label={o.status} /></td>
                  <td className="text-zinc-400">{o.tag ?? '—'}</td>
                  <td className="max-w-64 truncate text-zinc-400">{o.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card title="Trades" bodyClassName="p-0">
        <TradesTable trades={tradeRecords} />
      </Card>

      {/* key : réinitialise le draft local quand on navigue vers un autre bot
          (sinon la config de refit du bot A serait affichée/enregistrée sur B) */}
      <RefitCard key={id} botId={id} />

      <Card title="Journal">
        {allLogs.length === 0 ? (
          <Empty>Aucun log</Empty>
        ) : (
          <div className="max-h-80 space-y-0.5 overflow-y-auto font-mono text-xs">
            {[...allLogs].reverse().map((l, i) => (
              <div key={i} className="flex gap-2">
                <span className="shrink-0 text-zinc-600">{fmtDate(l.time)}</span>
                <span
                  className={
                    l.level === 'error' ? 'text-down' : l.level === 'warn' ? 'text-amber-400' : l.level === 'debug' ? 'text-zinc-500' : 'text-zinc-300'
                  }
                >
                  {l.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function RefitCard({ botId }: { botId: string }) {
  const qc = useQueryClient()
  const { data: state } = useQuery({
    queryKey: ['refit', botId],
    queryFn: () => api.refitState(botId),
    refetchInterval: 10_000,
  })
  const [draft, setDraft] = useState<RefitConfigDTO | null>(null)
  const [spaceText, setSpaceText] = useState('')

  useEffect(() => {
    if (state && draft === null) {
      setDraft(state.config)
      setSpaceText(JSON.stringify(Object.keys(state.config.space).length > 0 ? state.config.space : (state.defaultSpace ?? {}), null, 0))
    }
  }, [state, draft])

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['refit', botId] })

  const save = useMutation({
    mutationFn: () => {
      const space = JSON.parse(spaceText || '{}') as Record<string, unknown>
      return api.setRefitConfig(botId, { ...draft!, space })
    },
    onSuccess: invalidate,
    onError: (e) => void alertDialog({ title: 'Erreur', message: e instanceof Error ? e.message : String(e), tone: 'danger' }),
  })
  const runNow = useMutation({ mutationFn: () => api.runRefit(botId), onSuccess: invalidate })
  const apply = useMutation({
    mutationFn: () => api.applyRefit(botId),
    onSuccess: (r) => {
      if (!r.applied) void alertDialog({ title: 'Refit non appliqué', message: 'Le bot a une position ouverte — réessayez quand il est à plat.' })
      invalidate()
    },
  })
  const discard = useMutation({ mutationFn: () => api.discardRefit(botId), onSuccess: invalidate })

  if (!state || !draft) return null

  return (
    <Card
      title="Refit périodique des paramètres"
      actions={
        <button className="btn-ghost btn-sm" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
          <Play size={15} /> Lancer maintenant
        </button>
      }
    >
      <div className="space-y-3">
        <div className="text-xs text-zinc-500">
          Ré-estime les paramètres dans une grille bornée (le plateau validé) avec un score mécanique — la logique de la stratégie ne
          change jamais. Dernier run : {state.lastRunAt ? fmtDate(state.lastRunAt) : 'jamais'}.
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex cursor-pointer items-center gap-2 py-2 text-sm">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              className="accent-accent"
            />
            Activé
          </label>
          <Field label="Mode">
            <select className="input w-44" value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value as 'auto' | 'propose' })}>
              <option value="propose">Proposition (je valide)</option>
              <option value="auto">Auto (appliqué si flat)</option>
            </select>
          </Field>
          <Field label="Cadence (jours)">
            <input className="input w-24" type="number" value={draft.everyDays} onChange={(e) => setDraft({ ...draft, everyDays: Number(e.target.value) })} />
          </Field>
          <Field label="Fenêtre IS (jours)">
            <input className="input w-24" type="number" value={draft.windowDays} onChange={(e) => setDraft({ ...draft, windowDays: Number(e.target.value) })} />
          </Field>
          <Field label="Trades min">
            <input className="input w-20" type="number" value={draft.minTrades} onChange={(e) => setDraft({ ...draft, minTrades: Number(e.target.value) })} />
          </Field>
          <Field label="Amélioration min (×)">
            <input className="input w-24" type="number" step="0.01" value={draft.minImprovement} onChange={(e) => setDraft({ ...draft, minImprovement: Number(e.target.value) })} />
          </Field>
        </div>
        <Field label="Grille (JSON — restez dans le plateau validé)">
          <input className="input font-mono text-xs" value={spaceText} onChange={(e) => setSpaceText(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
            Enregistrer
          </button>
        </div>

        {state.lastReport !== null && (
          <pre className="overflow-x-auto rounded bg-panel2 p-3 text-xs text-zinc-300">{state.lastReport}</pre>
        )}
        {state.proposal !== null && (
          <div className="border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <div className="mb-2 font-semibold text-amber-400">Proposition en attente ({fmtDate(state.proposal.at)})</div>
            <pre className="mb-2 overflow-x-auto text-xs text-zinc-300">{state.proposal.report}</pre>
            <div className="flex gap-2">
              <button className="btn-success btn-sm" onClick={() => apply.mutate()} disabled={apply.isPending}>
                <Check size={15} /> Appliquer (si flat)
              </button>
              <button className="btn-ghost" onClick={() => discard.mutate()}>
                Rejeter
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
