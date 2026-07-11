import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MarketType } from '@tpx/shared'
import { DEFAULT_FEES, FEE_TIER_PRESETS } from '@tpx/shared'
import { OctagonAlert } from 'lucide-react'
import { api } from '../lib/api'
import { Badge, Card, Field, PageHeader } from '../components/ui'
import { alertDialog, confirmDialog } from '../components/dialog'

export function Settings() {
  const qc = useQueryClient()
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const { data: risk } = useQuery({ queryKey: ['risk'], queryFn: api.risk })
  const { data: account } = useQuery({ queryKey: ['account', 'live'], queryFn: () => api.account('live') })

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['settings'] })
    void qc.invalidateQueries({ queryKey: ['risk'] })
    void qc.invalidateQueries({ queryKey: ['account'] })
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Réglages" subtitle="Clés API, risque global, frais de paper trading et état du système" />

      <div className="grid grid-cols-2 gap-4">
        <CredentialsCard name="live" title="Clés API OKX — LIVE" configured={settings?.credentials.live ?? false} onDone={invalidate} />
        <CredentialsCard name="testnet" title="Clés API OKX — Démo" configured={settings?.credentials.testnet ?? false} onDone={invalidate} />
      </div>

      {/* ne monter ces cartes qu'une fois les données chargées : leur état local
          est initialisé depuis les props (useState) — monté trop tôt, le
          formulaire reste sur les valeurs vides/défauts et « Enregistrer »
          ÉCRASE silencieusement la config serveur (limites de risque, frais). */}
      {risk !== undefined && (
        <RiskCard
          maxTotalExposureQuote={risk.maxTotalExposureQuote}
          maxDailyLossQuote={risk.maxDailyLossQuote}
          killSwitchActive={account?.killSwitchActive ?? false}
          onDone={invalidate}
        />
      )}

      {settings !== undefined && (
        <div className="grid grid-cols-2 gap-4">
          <PaperFeesCard market="spot" fees={settings.paperFees.spot} onDone={invalidate} />
          <PaperFeesCard market="futures" fees={settings.paperFees.futures} onDone={invalidate} />
        </div>
      )}

      <Card title="Système">
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-400">Auth UI</span>
            <Badge value={settings?.authEnabled ? 'running' : 'stopped'} label={settings?.authEnabled ? 'activée' : 'désactivée (ADMIN_PASSWORD vide)'} />
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Telegram</span>
            <Badge
              value={settings?.telegramConfigured ? 'running' : 'stopped'}
              label={settings?.telegramConfigured ? 'configuré' : 'non configuré (.env)'}
            />
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Workers de backtest</span>
            <span>{settings?.backtestWorkers}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Dossier données</span>
            <span className="font-mono text-xs">{settings?.dataDir}</span>
          </div>
        </div>
      </Card>
    </div>
  )
}

function CredentialsCard({ name, title, configured, onDone }: { name: 'live' | 'testnet'; title: string; configured: boolean; onDone: () => void }) {
  const [apiKey, setApiKey] = useState('')
  const [secret, setSecret] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const save = useMutation({
    mutationFn: () => api.setCredentials(name, apiKey, secret, passphrase),
    onSuccess: () => {
      setApiKey('')
      setSecret('')
      setPassphrase('')
      onDone()
    },
    onError: (e) => void alertDialog({ title: 'Erreur', message: e instanceof Error ? e.message : String(e), tone: 'danger' }),
  })
  const remove = useMutation({ mutationFn: () => api.deleteCredentials(name), onSuccess: onDone })

  return (
    <Card
      title={title}
      actions={<Badge value={configured ? 'running' : 'stopped'} label={configured ? 'configurées' : 'absentes'} />}
      className="flex flex-col"
      bodyClassName="flex flex-1 flex-col gap-3 p-4"
    >
      <Field label="API Key">
        <input className="input" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={configured ? '••••••••' : ''} />
      </Field>
      <Field label="Secret">
        <input className="input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={configured ? '••••••••' : ''} />
      </Field>
      <Field label="Passphrase">
        <input className="input" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder={configured ? '••••••••' : ''} />
      </Field>
      {name === 'live' && (
        <div className="text-[11px] text-zinc-500">
          Conseil : créez une clé restreinte (trading uniquement, pas de retrait) avec whitelist IP de votre VPS.
        </div>
      )}
      <div className="mt-auto flex justify-end gap-2 pt-1">
        {configured && (
          <button
            className="btn-danger"
            onClick={async () => {
              if (await confirmDialog({ title: 'Supprimer les clés', message: 'Supprimer ces clés API ?', confirmLabel: 'Supprimer', tone: 'danger' })) remove.mutate()
            }}
          >
            Supprimer
          </button>
        )}
        <button className="btn-primary" onClick={() => save.mutate()} disabled={apiKey === '' || secret === '' || passphrase === '' || save.isPending}>
          Enregistrer (chiffré)
        </button>
      </div>
    </Card>
  )
}

function RiskCard({
  maxTotalExposureQuote,
  maxDailyLossQuote,
  killSwitchActive,
  onDone,
}: {
  maxTotalExposureQuote?: number
  maxDailyLossQuote?: number
  killSwitchActive: boolean
  onDone: () => void
}) {
  const [exposure, setExposure] = useState(maxTotalExposureQuote !== undefined ? String(maxTotalExposureQuote) : '')
  const [dailyLoss, setDailyLoss] = useState(maxDailyLossQuote !== undefined ? String(maxDailyLossQuote) : '')

  const save = useMutation({
    mutationFn: () =>
      api.setRisk({
        killSwitchActive,
        maxTotalExposureQuote: exposure === '' ? undefined : Number(exposure),
        maxDailyLossQuote: dailyLoss === '' ? undefined : Number(dailyLoss),
      }),
    onSuccess: onDone,
  })
  const kill = useMutation({
    mutationFn: (active: boolean) => api.killSwitch(active),
    onSuccess: onDone,
  })

  return (
    <Card title="Risque global (tous bots live confondus)">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Exposition totale max (quote)">
            <input className="input w-48" type="number" placeholder="vide = illimité" value={exposure} onChange={(e) => setExposure(e.target.value)} />
          </Field>
          <Field label="Perte journalière max (quote)">
            <input className="input w-48" type="number" placeholder="vide = illimité" value={dailyLoss} onChange={(e) => setDailyLoss(e.target.value)} />
          </Field>
          <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
            Enregistrer
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-edge pt-4">
          <span className="mr-auto text-xs text-zinc-500">Arrêt d'urgence — coupe tous les bots live (aucune transaction, positions conservées)</span>
          {killSwitchActive ? (
            <button className="btn-success" onClick={() => kill.mutate(false)}>
              Désactiver le kill switch
            </button>
          ) : (
            <button
              className="btn-danger"
              onClick={async () => {
                if (await confirmDialog({ title: 'Kill switch', message: 'Arrêter tous les bots ? Aucune transaction ne sera passée — les positions ouvertes restent telles quelles (corrections à la main sur la plateforme).', confirmLabel: 'Activer', tone: 'danger' }))
                  kill.mutate(true)
              }}
            >
              <OctagonAlert size={16} /> Kill switch
            </button>
          )}
        </div>
      </div>
    </Card>
  )
}

function PaperFeesCard({ market, fees, onDone }: { market: MarketType; fees?: { makerRate: number; takerRate: number }; onDone: () => void }) {
  const [maker, setMaker] = useState(fees ? String(fees.makerRate) : String(DEFAULT_FEES[market].makerRate))
  const [taker, setTaker] = useState(fees ? String(fees.takerRate) : String(DEFAULT_FEES[market].takerRate))
  const [tier, setTier] = useState('')
  // OKX level imported from the live trade-fee endpoint; null until imported.
  const [level, setLevel] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => api.setPaperFees(market, { makerRate: Number(maker), takerRate: Number(taker) }),
    onSuccess: onDone,
  })

  // Applying a tier preset or a manual edit clears the imported-level badge.
  const applyTier = (id: string): void => {
    setTier(id)
    setLevel(null)
    setImportError(null)
    const preset = FEE_TIER_PRESETS[market].find((p) => p.id === id)
    if (preset) {
      setMaker(String(preset.makerRate))
      setTaker(String(preset.takerRate))
    }
  }

  const importFees = useMutation({
    mutationFn: () => api.getFees('live', market, 'BTCUSDT'),
    onSuccess: (data) => {
      if (data !== null && 'maker' in data) {
        setMaker(String(data.maker))
        setTaker(String(data.taker))
        setLevel(data.level)
        setImportError(null)
        setTier('')
      } else {
        setLevel(null)
        setImportError(data === null ? 'Clés API non configurées' : data.error)
      }
    },
  })

  return (
    <Card title={`Frais paper trading — ${market}`}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Palier OKX">
            <select className="input w-32" value={tier} onChange={(e) => applyTier(e.target.value)}>
              <option value="">Personnalisé</option>
              {FEE_TIER_PRESETS[market].map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Maker">
            <input className="input w-28" type="number" step="0.0001" value={maker} onChange={(e) => setMaker(e.target.value)} />
          </Field>
          <Field label="Taker">
            <input className="input w-28" type="number" step="0.0001" value={taker} onChange={(e) => setTaker(e.target.value)} />
          </Field>
          <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
            OK
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost" onClick={() => importFees.mutate()} disabled={importFees.isPending}>
            Importer mes vrais taux
          </button>
          {level !== null && <Badge value="running" label={`Palier OKX : ${level}`} />}
          {importError !== null && <span className="text-[11px] text-down">{importError}</span>}
        </div>
      </div>
    </Card>
  )
}
