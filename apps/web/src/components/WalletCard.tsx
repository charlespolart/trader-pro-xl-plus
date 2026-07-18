import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, type WalletBalance } from '../lib/api'
import { fmtNum, fmtQty } from '../lib/format'
import { Card, Empty } from './ui'

/** Couleurs d'identité des principaux assets (fallback : teinte dérivée du nom). */
const ASSET_COLORS: Record<string, string> = {
  BTC: '#f7931a',
  ETH: '#627eea',
  USDC: '#2775ca',
  USDT: '#26a17b',
  SOL: '#9945ff',
  BNB: '#f0b90b',
  XRP: '#00aae4',
  DOGE: '#c2a633',
  OKB: '#3075ee',
}
function assetColor(asset: string): string {
  const known = ASSET_COLORS[asset]
  if (known) return known
  let h = 0
  for (const c of asset) h = (h * 31 + c.charCodeAt(0)) % 360
  return `hsl(${h} 45% 55%)`
}
const UNIT: Record<string, string> = { BTC: '₿', ETH: 'Ξ' }
const DUST_USD = 1

/**
 * Pane Patrimoine : tout le portefeuille OKX — les avoirs majeurs en héros
 * (₿/Ξ d'abord, dollars en second), la barre d'allocation, puis le détail.
 */
export function WalletCard() {
  // cycle entre TOUS les comptes configurés (principal + sous-comptes)
  const { data: creds } = useQuery({ queryKey: ['credentials'], queryFn: api.credentials, staleTime: 30_000 })
  const [selected, setSelected] = useState<string | null>(null)
  const names = (creds ?? []).map((cr) => cr.name)
  const name = selected !== null && names.includes(selected) ? selected : (names.includes('live') ? 'live' : (names[0] ?? 'live'))
  const { data: account, isLoading } = useQuery({
    queryKey: ['account', name],
    queryFn: () => api.account(name),
    refetchInterval: 15_000,
  })

  const balances = account?.spot ?? []
  const total = account?.totalValueQuote ?? 0
  const valued = balances.filter((b) => (b.valueQuote ?? 0) >= DUST_USD)
  const dust = balances.filter((b) => (b.valueQuote ?? 0) < DUST_USD)
  const dustValue = dust.reduce((s, b) => s + (b.valueQuote ?? 0), 0)
  const heroes = valued.slice(0, 3)

  return (
    <Card
      title="Patrimoine OKX"
      hint={
        <button
          className="cursor-pointer text-zinc-600 transition-colors hover:text-accent"
          onClick={() => {
            if (names.length === 0) return
            const next = names[(names.indexOf(name) + 1) % names.length]!
            setSelected(next)
          }}
          title="Compte suivant"
        >
          {name}
          {account?.demo === true ? ' (démo)' : ''}
          {names.length > 1 ? ' ⇥' : ''}
        </button>
      }
      bodyClassName="p-0"
    >
      {isLoading ? (
        <div className="space-y-3 p-5">
          <div className="skeleton h-9 w-56" />
          <div className="skeleton h-2.5 w-full" />
          <div className="skeleton h-20 w-full" />
        </div>
      ) : !account?.configured ? (
        <Empty>
          Aucune clé API pour le compte « {name} ».{' '}
          <Link to="/settings" className="text-accent hover:underline">
            Configurer dans Réglages
          </Link>
        </Empty>
      ) : balances.length === 0 ? (
        <Empty>Compte vide — aucun asset détenu.</Empty>
      ) : (
        <div>
          {/* héros : les avoirs, en unités d'abord */}
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4 p-5 pb-0">
            {heroes.map((b) => (
              <div key={b.asset}>
                <div className="text-[11px] uppercase tracking-[0.12em] text-zinc-600">{b.asset}</div>
                <div className="num mt-1 text-[28px] font-medium leading-tight text-zinc-100">
                  {UNIT[b.asset] !== undefined && <span className="mr-1 text-[19px] text-accent">{UNIT[b.asset]}</span>}
                  {fmtQty(b.free + b.locked)}
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  <span className="num">{fmtNum(b.valueQuote ?? 0, 0)} $</span>
                  {total > 0 && <> · {(((b.valueQuote ?? 0) / total) * 100).toFixed(1)} %</>}
                </div>
              </div>
            ))}
            <div className="ml-auto text-right">
              <div className="text-[11px] uppercase tracking-[0.12em] text-zinc-600">Total estimé</div>
              <div className="num mt-1 text-[24px] font-medium leading-tight text-zinc-100">{fmtNum(total, 0)} $</div>
              <div className="mt-0.5 text-xs text-zinc-500">prix spot OKX</div>
            </div>
          </div>

          {/* barre d'allocation */}
          {total > 0 && (
            <div className="px-5 pt-4">
              <div className="flex h-2.5 w-full bg-panel2" role="img" aria-label="Répartition du portefeuille">
                {valued.map((b) => (
                  <div
                    key={b.asset}
                    className="border-r-2 border-surface last:border-r-0"
                    title={`${b.asset} — ${fmtNum(b.valueQuote ?? 0, 2)} $ (${(((b.valueQuote ?? 0) / total) * 100).toFixed(1)} %)`}
                    style={{ width: `${Math.max(0.8, ((b.valueQuote ?? 0) / total) * 100)}%`, background: assetColor(b.asset) }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 pt-2.5">
                {valued.map((b) => (
                  <span key={b.asset} className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
                    <span className="h-2 w-2" style={{ background: assetColor(b.asset) }} />
                    {b.asset}
                    <span className="num text-zinc-600">{(((b.valueQuote ?? 0) / total) * 100).toFixed(1)} %</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th className="text-right">Quantité</th>
                  <th className="text-right">Dont bloqué</th>
                  <th className="text-right">Cours</th>
                  <th className="text-right">Valeur $</th>
                  <th className="text-right">Part</th>
                </tr>
              </thead>
              <tbody>
                {valued.map((b) => (
                  <WalletRow key={b.asset} b={b} total={total} />
                ))}
                {dust.length > 0 && (
                  <tr>
                    <td className="text-zinc-600">Poussière ({dust.map((d) => d.asset).join(', ')})</td>
                    <td className="text-right text-zinc-600">—</td>
                    <td className="text-right text-zinc-600">—</td>
                    <td className="text-right text-zinc-600">—</td>
                    <td className="num text-right text-zinc-600">{fmtNum(dustValue, 2)}</td>
                    <td className="num text-right text-zinc-600">{total > 0 ? `${((dustValue / total) * 100).toFixed(1)} %` : '—'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  )
}

function WalletRow({ b, total }: { b: WalletBalance; total: number }) {
  const qty = b.free + b.locked
  const share = total > 0 && b.valueQuote != null ? (b.valueQuote / total) * 100 : null
  return (
    <tr>
      <td>
        <span className="inline-flex items-center gap-2 font-medium text-zinc-200">
          <span className="h-2.5 w-2.5" style={{ background: assetColor(b.asset) }} />
          {b.asset}
        </span>
      </td>
      <td className="num text-right">{fmtQty(qty)}</td>
      <td className="num text-right text-zinc-600">{b.locked > 0 ? fmtQty(b.locked) : '—'}</td>
      <td className="num text-right">{b.price != null ? fmtNum(b.price, b.price >= 100 ? 0 : 2) : '—'}</td>
      <td className="num text-right">{b.valueQuote != null ? fmtNum(b.valueQuote, 2) : '—'}</td>
      <td className="num text-right text-zinc-500">{share !== null ? `${share.toFixed(1)} %` : '—'}</td>
    </tr>
  )
}
