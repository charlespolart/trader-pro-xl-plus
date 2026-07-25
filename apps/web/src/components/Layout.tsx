import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { OctagonAlert } from 'lucide-react'
import { api } from '../lib/api'
import { useBots, useConnection, wsClient } from '../lib/ws'
import { fmtNum } from '../lib/format'
import { CommandPalette, type PaletteAction } from './CommandPalette'
import { confirmDialog } from './dialog'

/** Les pages = FENÊTRES numérotées de la statusline (navigation tmux). */
export const WINDOWS: { to: string; label: string; key: string }[] = [
  { to: '/', label: 'dashboard', key: '1' },
  { to: '/bots', label: 'bots', key: '2' },
  { to: '/strategies', label: 'stratégies', key: '3' },
  { to: '/backtests', label: 'backtests', key: '4' },
  { to: '/optimizer', label: 'optimiseur', key: '5' },
  { to: '/patterns', label: 'patterns', key: '6' },
  { to: '/trades', label: 'trades', key: '7' },
  { to: '/data', label: 'données', key: '8' },
  { to: '/settings', label: 'réglages', key: '9' },
]

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1_000)
    return () => clearInterval(t)
  }, [])
  return <span className="num text-accent">{now.toLocaleTimeString('fr-FR')}</span>
}

/** true quand la frappe appartient à un champ de saisie — les raccourcis se taisent */
function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

export function Layout() {
  const connected = useConnection((s) => s.connected)
  const botInfos = useBots((s) => s.infos)
  const setAll = useBots((s) => s.setAll)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    const unsub = wsClient.subscribe('bots', () => {})
    api.bots().then(setAll).catch(() => {})
    return unsub
  }, [setAll])

  // patrimoine consolidé : prix ₿ de la statusline + état du kill switch —
  // indépendant du compte 'live' (désormais quasi vide, fonds sur sous-comptes)
  const { data: patrimoine } = useQuery({
    queryKey: ['patrimoine'],
    queryFn: api.patrimoine,
    refetchInterval: 15_000,
  })

  const kill = useMutation({
    mutationFn: (active: boolean) => api.killSwitch(active),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['patrimoine'] })
      void qc.invalidateQueries({ queryKey: ['account'] })
    },
  })

  const askKill = async (): Promise<void> => {
    if (
      await confirmDialog({
        title: 'Kill switch',
        message:
          'Arrêter tous les bots ? Aucun achat/vente ne sera passé — les positions restent telles quelles. Les ordres résidents (stop-loss, limites) sont annulés : gel complet, plus rien ne peut s\'exécuter.',
        confirmLabel: 'Activer',
        tone: 'danger',
      })
    )
      kill.mutate(true)
  }

  // ---- raccourcis globaux : 1-9 fenêtres, n bot, b backtest, ⌘K palette, F9 kill
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'F9') {
        e.preventDefault()
        void askKill()
        return
      }
      const win = WINDOWS.find((w) => w.key === e.key)
      if (win) {
        navigate(win.to)
        return
      }
      if (e.key === 'n') navigate('/bots')
      if (e.key === 'b') navigate('/backtests')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate])

  const running = Object.values(botInfos).filter((b) => b.status === 'running').length
  const btcPrice = patrimoine?.prices['BTC']

  const paletteActions: PaletteAction[] = [
    ...WINDOWS.map((w) => ({ label: `Aller à ${w.label}`, hint: w.key, run: () => navigate(w.to) })),
    { label: 'Nouveau bot', hint: 'n', run: () => navigate('/bots') },
    { label: 'Lancer un backtest', hint: 'b', run: () => navigate('/backtests') },
    { label: 'Kill switch — arrêter tous les bots', hint: 'F9', run: () => void askKill() },
  ]

  return (
    <div className="flex h-full flex-col">
      {/* ================= STATUSLINE : session · fenêtres · état ================= */}
      <header className="statusline">
        <NavLink to="/" className="sl-app">
          TPX
        </NavLink>
        <nav className="sl-windows" aria-label="Fenêtres">
          {WINDOWS.map((w) => (
            <NavLink key={w.to} to={w.to} end={w.to === '/'} className={({ isActive }) => `sl-win ${isActive ? 'active' : ''}`}>
              <i>{w.key}:</i>
              {w.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-stretch">
          <span className="sl-cell" title={connected ? 'Flux temps réel connecté' : 'Flux temps réel coupé'}>
            <span className={`h-[7px] w-[7px] rounded-full ${connected ? 'bg-up shadow-[0_0_6px_rgba(95,224,168,.7)]' : 'bg-down'}`} />
            <span className="hidden sm:inline">ws</span>
          </span>
          <span className="sl-cell hidden md:flex">
            {running} bot{running > 1 ? 's' : ''}
          </span>
          {btcPrice !== undefined && btcPrice !== null && (
            <span className="sl-cell hidden lg:flex">
              ₿ <b className="num">{fmtNum(btcPrice, 0)}</b>
            </span>
          )}
          <span className="sl-cell hidden sm:flex">
            <Clock />
          </span>
        </div>
      </header>

      {patrimoine?.killSwitchActive && (
        <div className="flex items-center justify-between gap-4 border-b border-down/30 bg-down/10 px-4 py-2 text-[13px] text-down">
          <span className="flex items-center gap-2 font-semibold">
            <OctagonAlert size={15} /> Kill switch actif — tous les bots sont arrêtés
          </span>
          <button className="btn-ghost btn-sm" onClick={() => kill.mutate(false)} disabled={kill.isPending}>
            Désactiver
          </button>
        </div>
      )}

      {/* overflow-x-hidden = filet : la PAGE ne scrolle jamais horizontalement,
          le contenu large scrolle dans sa card (overflow-x-auto du Card) */}
      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-16 pt-5 md:px-6">
        <div className="mx-auto max-w-[1340px]">
          <Outlet />
        </div>
      </main>

      {/* ================= BARRE D'ACTIONS (desktop) ================= */}
      <nav className="actionbar hidden md:flex">
        <button className="act" onClick={() => setPaletteOpen(true)}>
          <span className="kbd">⌘K</span> palette
        </button>
        <button className="act" onClick={() => navigate('/bots')}>
          <span className="kbd">n</span> nouveau bot
        </button>
        <button className="act" onClick={() => navigate('/backtests')}>
          <span className="kbd">b</span> lancer un backtest
        </button>
        <span className="act cursor-default text-zinc-600 hover:bg-transparent hover:text-zinc-600">
          <span className="kbd">1–9</span> fenêtres
        </span>
        <span className="flex-1" />
        <button className="act act-danger" onClick={() => void askKill()}>
          <span className="kbd">F9</span> kill switch
        </button>
      </nav>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={paletteActions} key={location.pathname} />
    </div>
  )
}
