import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DEFAULT_FEES, defaultParams, type MarketType, type ParamDef, type ParamValues } from '@tpx/shared'
import { api, type StrategyDTO } from '../lib/api'
import { Plus, Trash2 } from 'lucide-react'
import { dateToInputValue, fmtDate, inputValueToMs } from '../lib/format'
import { Badge, Card, Empty, Field, Modal, PageHeader, ProgressBar } from '../components/ui'
import { confirmDialog } from '../components/dialog'

interface SweepRow {
  enabled: boolean
  from: number
  to: number
  step: number
}

interface OptDraft {
  strategyId: string
  market: MarketType
  symbol: string
  from: string
  to: string
  initialBalance: number
  leverage: number
  objective: string
  useWalkForward: boolean
  wfWindows: number
  wfIsRatio: number
  label: string
  sweeps: Record<string, SweepRow>
  sweepOptions: Record<string, boolean>
  params: ParamValues
}

const OBJECTIVES = [
  ['netProfit', 'Profit net %'],
  ['sharpe', 'Sharpe'],
  ['sortino', 'Sortino'],
  ['calmar', 'Calmar'],
  ['profitFactor', 'Profit factor'],
  ['expectancy', 'Espérance / trade'],
] as const

export function Optimizer() {
  const qc = useQueryClient()
  const { data: rows } = useQuery({ queryKey: ['optimizations'], queryFn: api.optimizations, refetchInterval: 4_000 })
  const { data: strategies } = useQuery({ queryKey: ['strategies'], queryFn: api.strategies })
  const [draft, setDraft] = useState<OptDraft | null>(null)
  const [error, setError] = useState('')

  const submit = useMutation({
    mutationFn: (d: OptDraft) => {
      const space: Record<string, unknown> = {}
      for (const [key, sweep] of Object.entries(d.sweeps)) {
        if (sweep.enabled) space[key] = { from: sweep.from, to: sweep.to, step: sweep.step }
      }
      const strategy = strategies?.find((s) => s.id === d.strategyId)
      for (const [key, on] of Object.entries(d.sweepOptions)) {
        if (!on) continue
        const def = strategy?.schema?.[key] as ParamDef | undefined
        if (def?.kind === 'bool') space[key] = [true, false]
        else if (def?.kind === 'select') space[key] = [...def.options]
        else if (def?.kind === 'interval' && def.options) space[key] = [...def.options]
      }
      if (Object.keys(space).length === 0) throw new Error('Sélectionnez au moins un paramètre à balayer')
      return api.submitOptimization({
        label: d.label || undefined,
        objective: d.objective,
        walkForward: d.useWalkForward ? { windows: d.wfWindows, isRatio: d.wfIsRatio } : undefined,
        space,
        baseConfig: {
          strategyId: d.strategyId,
          market: d.market,
          symbol: d.symbol,
          start: inputValueToMs(d.from),
          end: inputValueToMs(d.to) + 86_400_000,
          initialBalance: d.initialBalance,
          leverage: d.leverage,
          fees: DEFAULT_FEES[d.market],
          params: d.params,
        },
      })
    },
    onSuccess: () => {
      setDraft(null)
      setError('')
      void qc.invalidateQueries({ queryKey: ['optimizations'] })
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  })

  const act = useMutation({
    mutationFn: async ({ id, del }: { id: string; del: boolean }) => {
      if (del) await api.deleteOptimization(id)
      else await api.cancelOptimization(id)
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['optimizations'] }),
  })

  const newDraft = (): void => {
    const s = strategies?.find((x) => !x.error)
    if (!s) return
    const now = Date.now()
    const sweeps: Record<string, SweepRow> = {}
    const sweepOptions: Record<string, boolean> = {}
    for (const [key, def] of Object.entries(s.schema ?? {})) {
      const d = def as ParamDef
      if (d.kind === 'int' || d.kind === 'number') {
        const from = d.min ?? d.default
        const to = d.max ?? (typeof d.default === 'number' ? d.default * 2 : 100)
        const step = d.step ?? (d.kind === 'int' ? Math.max(1, Math.round((Number(to) - Number(from)) / 10)) : (Number(to) - Number(from)) / 10)
        sweeps[key] = { enabled: false, from: Number(from), to: Number(to), step: Number(step) }
      } else {
        sweepOptions[key] = false
      }
    }
    setDraft({
      strategyId: s.id,
      market: (s.markets?.[0] ?? 'spot') as MarketType,
      symbol: 'BTCUSDT',
      from: dateToInputValue(now - 365 * 86_400_000),
      to: dateToInputValue(now - 86_400_000),
      initialBalance: 10_000,
      leverage: 1,
      objective: 'netProfit',
      useWalkForward: true,
      wfWindows: 4,
      wfIsRatio: 0.75,
      label: '',
      sweeps,
      sweepOptions,
      params: s.defaults ?? {},
    })
  }

  const comboCount = useMemo(() => {
    if (!draft) return 0
    let n = 1
    for (const s of Object.values(draft.sweeps)) {
      if (s.enabled && s.step > 0) n *= Math.floor((s.to - s.from) / s.step) + 1
    }
    const strategy = strategies?.find((x) => x.id === draft.strategyId)
    for (const [key, on] of Object.entries(draft.sweepOptions)) {
      if (!on) continue
      const def = strategy?.schema?.[key] as ParamDef | undefined
      if (def?.kind === 'bool') n *= 2
      else if (def?.kind === 'select') n *= def.options.length
      else if (def?.kind === 'interval' && def.options) n *= def.options.length
    }
    return n
  }, [draft, strategies])

  return (
    <div className="space-y-5">
      <PageHeader
        title="Optimiseur"
        subtitle="Balayage de paramètres avec walk-forward anti-overfitting"
        actions={
          <button className="btn-primary" onClick={newDraft}>
            <Plus size={16} /> Nouvelle optimisation
          </button>
        }
      />

      <Card bodyClassName={!rows || rows.length === 0 ? 'p-4' : 'p-0'}>
        {!rows || rows.length === 0 ? (
          <Empty>Aucune optimisation</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Stratégie</th>
                <th>Paire</th>
                <th>Statut</th>
                <th>Progression</th>
                <th>Créée</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/optimizer/${r.id}`} className="text-accent hover:underline">
                      {r.label ?? r.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="text-zinc-400">{r.strategyId}</td>
                  <td>
                    {r.symbol} <Badge value={r.market} />
                  </td>
                  <td>
                    <Badge value={r.status} />
                    {r.error !== null && <div className="text-[11px] text-down">{r.error}</div>}
                  </td>
                  <td className="min-w-32">
                    {r.status === 'running' ? <ProgressBar ratio={r.total > 0 ? r.done / r.total : 0} /> : `${r.done}/${r.total}`}
                  </td>
                  <td className="text-zinc-400">{fmtDate(r.createdAt)}</td>
                  <td>
                    <div className="flex justify-end gap-1.5">
                      {r.status === 'running' ? (
                        <button className="btn-ghost btn-sm" onClick={() => act.mutate({ id: r.id, del: false })}>
                          Annuler
                        </button>
                      ) : (
                        <button
                          className="btn-danger btn-sm btn-icon"
                          title="Supprimer"
                          onClick={async () => {
                            if (await confirmDialog({ title: "Supprimer l'optimisation", message: 'Supprimer cette optimisation et ses résultats ?', confirmLabel: 'Supprimer', tone: 'danger' }))
                              act.mutate({ id: r.id, del: true })
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={draft !== null} onClose={() => setDraft(null)} title="Nouvelle optimisation" wide>
        {draft && strategies && (
          <OptForm
            draft={draft}
            strategies={strategies.filter((s) => !s.error)}
            comboCount={comboCount}
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

function OptForm({
  draft,
  strategies,
  comboCount,
  error,
  busy,
  onChange,
  onSubmit,
}: {
  draft: OptDraft
  strategies: StrategyDTO[]
  comboCount: number
  error: string
  busy: boolean
  onChange: (d: OptDraft) => void
  onSubmit: () => void
}) {
  const strategy = strategies.find((s) => s.id === draft.strategyId)

  const setStrategy = (id: string): void => {
    const s = strategies.find((x) => x.id === id)
    if (!s) return
    const sweeps: Record<string, SweepRow> = {}
    const sweepOptions: Record<string, boolean> = {}
    for (const [key, def] of Object.entries(s.schema ?? {})) {
      const d = def as ParamDef
      if (d.kind === 'int' || d.kind === 'number') {
        sweeps[key] = {
          enabled: false,
          from: Number(d.min ?? d.default),
          to: Number(d.max ?? Number(d.default) * 2),
          step: Number(d.step ?? 1),
        }
      } else {
        sweepOptions[key] = false
      }
    }
    onChange({
      ...draft,
      strategyId: id,
      market: (s.markets?.includes(draft.market) ? draft.market : (s.markets?.[0] ?? 'spot')) as MarketType,
      sweeps,
      sweepOptions,
      params: s.schema ? defaultParams(s.schema) : {},
    })
  }

  const setSweep = (key: string, patch: Partial<SweepRow>): void => {
    onChange({ ...draft, sweeps: { ...draft.sweeps, [key]: { ...draft.sweeps[key]!, ...patch } } })
  }

  const totalRuns = draft.useWalkForward ? comboCount * draft.wfWindows + draft.wfWindows : comboCount

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
          <select className="input" value={draft.market} onChange={(e) => onChange({ ...draft, market: e.target.value as MarketType })}>
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
          <input className="input" value={draft.label} onChange={(e) => onChange({ ...draft, label: e.target.value })} />
        </Field>
        <Field label="Du">
          <input className="input" type="date" value={draft.from} onChange={(e) => onChange({ ...draft, from: e.target.value })} />
        </Field>
        <Field label="Au">
          <input className="input" type="date" value={draft.to} onChange={(e) => onChange({ ...draft, to: e.target.value })} />
        </Field>
        <Field label="Objectif">
          <select className="input" value={draft.objective} onChange={(e) => onChange({ ...draft, objective: e.target.value })}>
            {OBJECTIVES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Capital initial">
          <input className="input" type="number" value={draft.initialBalance} onChange={(e) => onChange({ ...draft, initialBalance: Number(e.target.value) })} />
        </Field>
      </div>

      <div className="flex items-center gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.useWalkForward}
            onChange={(e) => onChange({ ...draft, useWalkForward: e.target.checked })}
            className="accent-accent"
          />
          Walk-forward (anti-overfitting)
        </label>
        {draft.useWalkForward && (
          <>
            <Field label="Fenêtres">
              <input className="input w-20" type="number" min={2} max={20} value={draft.wfWindows} onChange={(e) => onChange({ ...draft, wfWindows: Number(e.target.value) })} />
            </Field>
            <Field label="Ratio in-sample">
              <input className="input w-24" type="number" min={0.5} max={0.95} step={0.05} value={draft.wfIsRatio} onChange={(e) => onChange({ ...draft, wfIsRatio: Number(e.target.value) })} />
            </Field>
          </>
        )}
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Espace de recherche</div>
        <table className="w-full">
          <thead>
            <tr>
              <th></th>
              <th>Paramètre</th>
              <th>De</th>
              <th>À</th>
              <th>Pas</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(draft.sweeps).map(([key, sweep]) => {
              const def = strategy?.schema?.[key] as ParamDef | undefined
              return (
                <tr key={key}>
                  <td>
                    <input type="checkbox" checked={sweep.enabled} onChange={(e) => setSweep(key, { enabled: e.target.checked })} className="accent-accent" />
                  </td>
                  <td>{def?.label ?? key}</td>
                  <td>
                    <input className="input w-24" type="number" value={sweep.from} disabled={!sweep.enabled} onChange={(e) => setSweep(key, { from: Number(e.target.value) })} />
                  </td>
                  <td>
                    <input className="input w-24" type="number" value={sweep.to} disabled={!sweep.enabled} onChange={(e) => setSweep(key, { to: Number(e.target.value) })} />
                  </td>
                  <td>
                    <input className="input w-24" type="number" value={sweep.step} disabled={!sweep.enabled} onChange={(e) => setSweep(key, { step: Number(e.target.value) })} />
                  </td>
                </tr>
              )
            })}
            {Object.entries(draft.sweepOptions).map(([key, on]) => {
              const def = strategy?.schema?.[key] as ParamDef | undefined
              return (
                <tr key={key}>
                  <td>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => onChange({ ...draft, sweepOptions: { ...draft.sweepOptions, [key]: e.target.checked } })}
                      className="accent-accent"
                    />
                  </td>
                  <td>{def?.label ?? key}</td>
                  <td colSpan={3} className="text-zinc-500">
                    toutes les valeurs ({def?.kind === 'bool' ? 'oui/non' : def && 'options' in def ? (def.options ?? []).join(', ') : '—'})
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="text-sm text-zinc-400">
        {comboCount.toLocaleString('fr-FR')} combinaisons → <b>{totalRuns.toLocaleString('fr-FR')} backtests</b>
        {totalRuns > 5000 && <span className="ml-2 text-amber-400">⚠️ ça va chauffer — réduisez l'espace si besoin</span>}
      </div>
      {error !== '' && <div className="text-sm text-down">{error}</div>}
      <div className="flex justify-end">
        <button className="btn-primary" onClick={onSubmit} disabled={busy || comboCount === 0}>
          Lancer l'optimisation
        </button>
      </div>
    </div>
  )
}
