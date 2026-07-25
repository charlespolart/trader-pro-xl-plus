import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MarketType } from '@tpx/shared'
import { DEFAULT_FEES, FEE_TIER_PRESETS } from '@tpx/shared'
import { OctagonAlert, Pencil, Plus, Trash2 } from 'lucide-react'
import { api, type CredentialWithEquity } from '../lib/api'
import { fmtNum } from '../lib/format'
import { Badge, Card, Empty, Field, PageHeader } from '../components/ui'
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
    void qc.invalidateQueries({ queryKey: ['credentials'] })
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Réglages" subtitle="Comptes OKX (clés API), risque global, frais de paper trading et état du système" />

      <AccountsCard onDone={invalidate} />

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
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PaperFeesCard market="spot" fees={settings.paperFees.spot} onDone={invalidate} />
          <PaperFeesCard market="futures" fees={settings.paperFees.futures} onDone={invalidate} />
        </div>
      )}

      <Card title="Système">
        <div className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
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

/** Comptes OKX : autant de comptes/sous-comptes qu'on veut, chacun avec son
 *  label, ses clés (chiffrées) et son équité — les bots choisissent leur
 *  compte à la création. 'live' et 'testnet' = comptes par défaut historiques. */
function AccountsCard({ onDone }: { onDone: () => void }) {
  const { data: creds, isLoading } = useQuery({
    queryKey: ['credentials'],
    queryFn: api.credentials,
    refetchInterval: 30_000,
  })
  // formulaire d'ajout/mise à jour (editing = nom verrouillé, clés re-saisies)
  const [form, setForm] = useState<{ name: string; apiKey: string; secret: string; passphrase: string; demo: boolean; editing: boolean } | null>(null)

  const save = useMutation({
    mutationFn: (f: NonNullable<typeof form>) => api.setCredentials(f.name.trim(), f.apiKey, f.secret, f.passphrase, f.demo),
    onSuccess: () => {
      setForm(null)
      onDone()
    },
    onError: (e) => void alertDialog({ title: 'Erreur', message: e instanceof Error ? e.message : String(e), tone: 'danger' }),
  })
  const remove = useMutation({
    mutationFn: (name: string) => api.deleteCredentials(name),
    onSuccess: onDone,
    onError: (e) => void alertDialog({ title: 'Suppression impossible', message: e instanceof Error ? e.message : String(e), tone: 'danger' }),
  })

  const lockedDemo = form !== null && (form.name.trim() === 'live' || form.name.trim() === 'testnet')

  return (
    <Card
      title="Comptes OKX"
      actions={
        !form && (
          <button className="btn-primary btn-sm" onClick={() => setForm({ name: '', apiKey: '', secret: '', passphrase: '', demo: false, editing: false })}>
            <Plus size={15} /> Ajouter un compte
          </button>
        )
      }
      bodyClassName={creds?.length === 0 && !form ? 'p-4' : 'p-0'}
    >
      {isLoading ? (
        <div className="space-y-2 p-4">
          <div className="skeleton h-8 w-full" />
          <div className="skeleton h-8 w-full" />
        </div>
      ) : creds?.length === 0 && !form ? (
        <Empty>Aucun compte configuré — ajoutez les clés API de votre compte principal ou d'un sous-compte.</Empty>
      ) : (
        <div>
          {creds !== undefined && creds.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Compte</th>
                  <th>Type</th>
                  <th className="text-right">Équité estimée</th>
                  <th className="text-right">Clés mises à jour</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {creds.map((cr) => (
                  <AccountRow
                    key={cr.name}
                    cr={cr}
                    onEdit={() => setForm({ name: cr.name, apiKey: '', secret: '', passphrase: '', demo: cr.demo, editing: true })}
                    onDelete={async () => {
                      if (
                        await confirmDialog({
                          title: 'Supprimer le compte',
                          message: `Supprimer les clés API du compte « ${cr.name} » ? (refusé si un bot utilise ce compte)`,
                          confirmLabel: 'Supprimer',
                          tone: 'danger',
                        })
                      )
                        remove.mutate(cr.name)
                    }}
                  />
                ))}
              </tbody>
            </table>
          )}
          {form && (
            <div className="space-y-3 border-t border-edge p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Label du compte" hint="Libre — ex. « tpxportfolio », « sous-compte accum ». 'live' et 'testnet' = comptes par défaut des bots historiques.">
                  <input
                    className="input"
                    value={form.name}
                    disabled={form.editing}
                    placeholder="ex. tpxportfolio"
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </Field>
                <Field label="Type de clé">
                  <label className="flex h-9 cursor-pointer items-center gap-2 text-[13px] text-zinc-300">
                    <input
                      type="checkbox"
                      className="accent-accent"
                      checked={lockedDemo ? form.name.trim() === 'testnet' : form.demo}
                      disabled={lockedDemo}
                      onChange={(e) => setForm({ ...form, demo: e.target.checked })}
                    />
                    Clé du bac à sable OKX (démo)
                  </label>
                </Field>
                <Field label="API Key">
                  <input className="input" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
                </Field>
                <Field label="Secret">
                  <input className="input" type="password" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} />
                </Field>
                <Field label="Passphrase">
                  <input className="input" type="password" value={form.passphrase} onChange={(e) => setForm({ ...form, passphrase: e.target.value })} />
                </Field>
              </div>
              <div className="text-[11px] text-zinc-500">
                Sous-compte : créez sa clé API depuis le compte PRINCIPAL (menu « Compte » → sous-compte → clé API). Conseil : clé
                restreinte (lecture + trading, jamais de retrait) avec whitelist IP. Les clés sont chiffrées (AES-256-GCM) — jamais
                affichées en clair.
              </div>
              <div className="flex justify-end gap-2">
                <button className="btn-ghost" onClick={() => setForm(null)}>
                  Annuler
                </button>
                <button
                  className="btn-primary"
                  onClick={() => save.mutate(form)}
                  disabled={form.name.trim() === '' || form.apiKey === '' || form.secret === '' || form.passphrase === '' || save.isPending}
                >
                  {form.editing ? 'Remplacer les clés (chiffré)' : 'Enregistrer (chiffré)'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function AccountRow({ cr, onEdit, onDelete }: { cr: CredentialWithEquity; onEdit: () => void; onDelete: () => void }) {
  return (
    <tr>
      <td className="font-medium text-zinc-200">{cr.name}</td>
      <td>
        <Badge value={cr.demo ? 'testnet' : 'live'} label={cr.demo ? 'démo' : 'réel'} />
      </td>
      <td className="num text-right">
        {cr.equity !== null ? `${fmtNum(cr.equity, 2)} $` : <span className="text-down" title="Clés illisibles ou compte injoignable">indisponible</span>}
      </td>
      <td className="num text-right text-zinc-500">{new Date(cr.updatedAt).toLocaleDateString('fr-FR')}</td>
      <td>
        <div className="flex justify-end gap-1.5">
          <button className="btn btn-sm btn-icon" title="Remplacer les clés" onClick={onEdit}>
            <Pencil size={15} />
          </button>
          <button className="btn-danger btn-sm btn-icon" title="Supprimer le compte" onClick={onDelete}>
            <Trash2 size={15} />
          </button>
        </div>
      </td>
    </tr>
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
                if (await confirmDialog({ title: 'Kill switch', message: 'Arrêter tous les bots ? Aucun achat/vente ne sera passé — les positions restent telles quelles (corrections à la main sur la plateforme). Les ordres résidents (stop-loss, limites) sont annulés : gel complet, plus rien ne peut s\'exécuter.', confirmLabel: 'Activer', tone: 'danger' }))
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
