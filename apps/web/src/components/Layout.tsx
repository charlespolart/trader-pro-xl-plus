import { useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeftRight,
  Bot,
  CandlestickChart,
  Database,
  FunctionSquare,
  History,
  LayoutDashboard,
  OctagonAlert,
  Settings,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react'
import { api } from '../lib/api'
import { useBots, useConnection, wsClient } from '../lib/ws'
import { fmtNum } from '../lib/format'

const nav: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/bots', label: 'Bots', icon: Bot },
  { to: '/strategies', label: 'Stratégies', icon: FunctionSquare },
  { to: '/backtests', label: 'Backtests', icon: History },
  { to: '/optimizer', label: 'Optimiseur', icon: SlidersHorizontal },
  { to: '/patterns', label: 'Patterns', icon: CandlestickChart },
  { to: '/trades', label: 'Trades', icon: ArrowLeftRight },
  { to: '/data', label: 'Données', icon: Database },
  { to: '/settings', label: 'Réglages', icon: Settings },
]

export function Layout() {
  const connected = useConnection((s) => s.connected)
  const botInfos = useBots((s) => s.infos)
  const setAll = useBots((s) => s.setAll)
  const qc = useQueryClient()

  useEffect(() => {
    const unsub = wsClient.subscribe('bots', () => {})
    api.bots().then(setAll).catch(() => {})
    return unsub
  }, [setAll])

  const { data: account } = useQuery({
    queryKey: ['account', 'live'],
    queryFn: () => api.account('live'),
    refetchInterval: 15_000,
  })

  const kill = useMutation({
    mutationFn: () => api.killSwitch(!(account?.killSwitchActive ?? false), false),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['account'] }),
  })

  const running = Object.values(botInfos).filter((b) => b.status === 'running').length
  const liveEquity = Object.values(botInfos)
    .filter((b) => b.config.mode === 'live')
    .reduce((s, b) => s + b.equity, 0)

  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-edge bg-panel">
        <div className="px-5 py-5 text-base font-bold tracking-tight">
          Trader <span className="text-accent">Pro XL+</span>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-accent/10 text-accent' : 'text-zinc-400 hover:bg-panel2/70 hover:text-zinc-100'
                }`
              }
            >
              <n.icon size={18} strokeWidth={2} className="shrink-0" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-2 border-t border-edge px-4 py-3 text-xs text-zinc-500">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${connected ? 'bg-up' : 'bg-down'}`} />
            {connected ? 'Connecté' : 'Déconnecté'}
          </div>
          <div>
            {running} bot{running > 1 ? 's' : ''} actif{running > 1 ? 's' : ''}
            {liveEquity > 0 && <span> · {fmtNum(liveEquity, 0)} USDT live</span>}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {account?.killSwitchActive && (
          <div className="flex items-center justify-between gap-4 border-b border-down/30 bg-down/15 px-5 py-2.5 text-sm text-down">
            <span className="flex items-center gap-2 font-semibold">
              <OctagonAlert size={16} /> Kill switch actif — tous les bots sont arrêtés
            </span>
            <button className="btn-ghost btn-sm" onClick={() => kill.mutate()} disabled={kill.isPending}>
              Désactiver
            </button>
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
