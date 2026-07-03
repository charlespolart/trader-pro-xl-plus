import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, type WalletBalance } from '../lib/api'
import { fmtNum, fmtQty } from '../lib/format'
import { Badge, Card, Empty } from './ui'

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

const DUST_USD = 1

/**
 * Portefeuille OKX complet (tous les assets du compte, pas seulement les
 * tranches des bots) avec valorisation spot et barre d'allocation — l'élément
 * signature du Dashboard : la composition du patrimoine en un coup d'œil.
 */
export function WalletCard() {
  const [mode, setMode] = useState<'live' | 'testnet'>('live')
  const { data: account, isLoading } = useQuery({
    queryKey: ['account', mode],
    queryFn: () => api.account(mode),
    refetchInterval: 15_000,
  })

  const balances = account?.spot ?? []
  const total = account?.totalValueQuote ?? 0
  const valued = balances.filter((b) => (b.valueQuote ?? 0) >= DUST_USD)
  const dust = balances.filter((b) => (b.valueQuote ?? 0) < DUST_USD)
  const dustValue = dust.reduce((s, b) => s + (b.valueQuote ?? 0), 0)

  const modeToggle = (
    <div className="seg" role="group" aria-label="Compte affiché">
      <button aria-pressed={mode === 'live'} onClick={() => setMode('live')}>
        Live
      </button>
      <button aria-pressed={mode === 'testnet'} onClick={() => setMode('testnet')}>
        Démo
      </button>
    </div>
  )

  return (
    <Card title="Portefeuille OKX" actions={modeToggle} bodyClassName="p-0">
      {isLoading ? (
        <div className="space-y-3 p-4">
          <div className="skeleton h-8 w-48" />
          <div className="skeleton h-2.5 w-full" />
          <div className="skeleton h-24 w-full" />
        </div>
      ) : !account?.configured ? (
        <Empty>
          Aucune clé API {mode === 'live' ? 'live' : 'démo'} configurée.{' '}
          <Link to="/settings" className="text-accent hover:underline">
            Configurer dans Réglages
          </Link>
        </Empty>
      ) : balances.length === 0 ? (
        <Empty>Compte vide — aucun asset détenu.</Empty>
      ) : (
        <div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-4">
            <span className="num text-3xl font-medium text-zinc-100">{fmtNum(total, 2)}</span>
            <span className="text-xs uppercase tracking-wider text-zinc-500">≈ USD au prix spot</span>
            <span className="ml-auto">
              <Badge value={mode} label={mode === 'live' ? 'live' : 'démo'} />
            </span>
          </div>

          {/* Barre d'allocation : la composition du patrimoine, segmentée par asset */}
          {total > 0 && (
            <div className="px-4 pt-3">
              <div className="flex h-2.5 w-full gap-px overflow-hidden rounded-full" role="img" aria-label="Répartition du portefeuille">
                {valued.map((b) => (
                  <div
                    key={b.asset}
                    title={`${b.asset} — ${fmtNum(b.valueQuote ?? 0, 2)} USD (${(((b.valueQuote ?? 0) / total) * 100).toFixed(1)} %)`}
                    style={{ width: `${Math.max(0.6, ((b.valueQuote ?? 0) / total) * 100)}%`, background: assetColor(b.asset) }}
                  />
                ))}
                {dustValue > 0 && <div title={`Poussière — ${fmtNum(dustValue, 2)} USD`} style={{ width: '0.6%', background: '#3f4a63' }} />}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 pb-1 pt-2">
                {valued.map((b) => (
                  <span key={b.asset} className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
                    <span className="h-2 w-2 rounded-full" style={{ background: assetColor(b.asset) }} />
                    {b.asset}
                    <span className="num text-zinc-500">{(((b.valueQuote ?? 0) / total) * 100).toFixed(1)} %</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="overflow-x-auto"><table className="mt-2">
            <thead>
              <tr>
                <th>Asset</th>
                <th className="text-right">Quantité</th>
                <th className="text-right">Dont bloqué</th>
                <th className="text-right">Prix</th>
                <th className="text-right">Valeur (USD)</th>
                <th className="text-right">Part</th>
              </tr>
            </thead>
            <tbody>
              {valued.map((b) => (
                <WalletRow key={b.asset} b={b} total={total} />
              ))}
              {dust.length > 0 && (
                <tr>
                  <td className="text-zinc-500">Poussière ({dust.map((d) => d.asset).join(', ')})</td>
                  <td className="text-right text-zinc-500">—</td>
                  <td className="text-right text-zinc-500">—</td>
                  <td className="text-right text-zinc-500">—</td>
                  <td className="num text-right text-zinc-500">{fmtNum(dustValue, 2)}</td>
                  <td className="num text-right text-zinc-500">{total > 0 ? `${((dustValue / total) * 100).toFixed(1)} %` : '—'}</td>
                </tr>
              )}
            </tbody>
          </table></div>
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
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: assetColor(b.asset) }} />
          {b.asset}
        </span>
      </td>
      <td className="num text-right">{fmtQty(qty)}</td>
      <td className="num text-right text-zinc-500">{b.locked > 0 ? fmtQty(b.locked) : '—'}</td>
      <td className="num text-right">{b.price != null ? fmtNum(b.price, b.price >= 100 ? 0 : 2) : '—'}</td>
      <td className="num text-right">{b.valueQuote != null ? fmtNum(b.valueQuote, 2) : '—'}</td>
      <td className="num text-right text-zinc-400">{share !== null ? `${share.toFixed(1)} %` : '—'}</td>
    </tr>
  )
}
