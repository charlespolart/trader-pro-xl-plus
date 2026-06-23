import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MarketType } from '@tpx/shared'
import { OctagonAlert, Power } from 'lucide-react'
import { api } from '../lib/api'
import { fmtNum } from '../lib/format'
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
        <CredentialsCard name="live" title="Clés API Binance — LIVE" configured={settings?.credentials.live ?? false} onDone={invalidate} />
        <CredentialsCard name="testnet" title="Clés API Binance — Testnet" configured={settings?.credentials.testnet ?? false} onDone={invalidate} />
      </div>

      <RiskCard
        maxTotalExposureQuote={risk?.maxTotalExposureQuote}
        maxDailyLossQuote={risk?.maxDailyLossQuote}
        killSwitchActive={account?.killSwitchActive ?? false}
        onDone={invalidate}
      />

      <div className="grid grid-cols-2 gap-4">
        <PaperFeesCard market="spot" fees={settings?.paperFees.spot} onDone={invalidate} />
        <PaperFeesCard market="futures" fees={settings?.paperFees.futures} onDone={invalidate} />
      </div>

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
          {account?.configured && (
            <div className="flex justify-between">
              <span className="text-zinc-400">Solde BNB (réduction de frais)</span>
              <span>{fmtNum(account.bnbBalance ?? 0, 4)} BNB</span>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

function CredentialsCard({ name, title, configured, onDone }: { name: 'live' | 'testnet'; title: string; configured: boolean; onDone: () => void }) {
  const [apiKey, setApiKey] = useState('')
  const [secret, setSecret] = useState('')
  const save = useMutation({
    mutationFn: () => api.setCredentials(name, apiKey, secret),
    onSuccess: () => {
      setApiKey('')
      setSecret('')
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
        <button className="btn-primary" onClick={() => save.mutate()} disabled={apiKey === '' || secret === '' || save.isPending}>
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
    mutationFn: ({ active, close }: { active: boolean; close: boolean }) => api.killSwitch(active, close),
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
          <span className="mr-auto text-xs text-zinc-500">Arrêt d'urgence — coupe tous les bots live</span>
          {killSwitchActive ? (
            <button className="btn-success" onClick={() => kill.mutate({ active: false, close: false })}>
              Désactiver le kill switch
            </button>
          ) : (
            <>
              <button
                className="btn-danger"
                onClick={async () => {
                  if (await confirmDialog({ title: 'Kill switch', message: 'Arrêter tous les bots ? Les positions ouvertes sont conservées.', confirmLabel: 'Activer', tone: 'danger' }))
                    kill.mutate({ active: true, close: false })
                }}
              >
                <OctagonAlert size={16} /> Kill switch
              </button>
              <button
                className="btn-kill"
                onClick={async () => {
                  if (await confirmDialog({ title: 'Tout fermer', message: 'Arrêter tous les bots ET fermer toutes les positions au marché ? Action immédiate et irréversible.', confirmLabel: 'Tout fermer', tone: 'danger' }))
                    kill.mutate({ active: true, close: true })
                }}
              >
                <Power size={16} /> Tout fermer
              </button>
            </>
          )}
        </div>
      </div>
    </Card>
  )
}

function PaperFeesCard({ market, fees, onDone }: { market: MarketType; fees?: { makerRate: number; takerRate: number; bnbDiscount: boolean }; onDone: () => void }) {
  const [maker, setMaker] = useState(fees ? String(fees.makerRate) : '0.001')
  const [taker, setTaker] = useState(fees ? String(fees.takerRate) : '0.001')
  const [bnb, setBnb] = useState(fees?.bnbDiscount ?? true)

  const save = useMutation({
    mutationFn: () => api.setPaperFees(market, { makerRate: Number(maker), takerRate: Number(taker), bnbDiscount: bnb }),
    onSuccess: onDone,
  })

  return (
    <Card title={`Frais paper trading — ${market}`}>
      <div className="flex items-end gap-3">
        <Field label="Maker">
          <input className="input w-28" type="number" step="0.0001" value={maker} onChange={(e) => setMaker(e.target.value)} />
        </Field>
        <Field label="Taker">
          <input className="input w-28" type="number" step="0.0001" value={taker} onChange={(e) => setTaker(e.target.value)} />
        </Field>
        <label className="flex cursor-pointer items-center gap-2 py-2 text-sm">
          <input type="checkbox" checked={bnb} onChange={(e) => setBnb(e.target.checked)} className="accent-blue-500" />
          BNB
        </label>
        <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
          OK
        </button>
      </div>
    </Card>
  )
}
