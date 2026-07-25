import type { ReactNode } from 'react'

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-bold tracking-tight text-zinc-100">{title}</h1>
        {subtitle !== undefined && <p className="mt-0.5 text-[12.5px] text-zinc-500">{subtitle}</p>}
      </div>
      {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

/** Pane terminal : titre flottant ┤ TITRE ├ sur la bordure, hint optionnel à
 *  droite, barre d'actions interne quand nécessaire (jamais en overlap). */
export function Card({
  title,
  hint,
  children,
  actions,
  className = '',
  bodyClassName = 'p-4',
}: {
  title?: ReactNode
  hint?: ReactNode
  children: ReactNode
  actions?: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    // min-w-0 : dans une grille/flex, une card au contenu large (table) force
    // sinon la colonne à s'élargir → scroll horizontal de toute la page.
    // overflow-x-auto sur le BODY : le contenu large scrolle DANS le bloc
    // (mobile) — systémique, plus de wrapper à poser table par table.
    <div className={`card min-w-0 ${title !== undefined ? 'mt-2.5' : ''} ${className}`}>
      {title !== undefined && <div className="pane-title">{title}</div>}
      {hint !== undefined && <div className="pane-hint">{hint}</div>}
      {actions !== undefined && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-b border-edge/60 px-3 py-2">{actions}</div>
      )}
      <div className={`overflow-x-auto ${bodyClassName}`}>{children}</div>
    </div>
  )
}

/** Losange Ethereum en SVG — le « Ξ » textuel rend comme 3 barres illisibles
 *  en police mono. fill-current + taille en em : hérite couleur et corps du
 *  texte environnant (récolte verte, héros accent…). */
export function EthGlyph() {
  return (
    <svg viewBox="0 0 256 417" className="inline-block h-[0.9em] w-auto -translate-y-[0.05em] fill-current" aria-label="ETH">
      <path d="M127.9 0 125 9.8v272.6l2.9 2.9 127.9-75.6L127.9 0z" opacity=".65" />
      <path d="M127.9 0 0 209.7l127.9 75.6V0z" />
      <path d="m127.9 312.2-1.6 2v97.1l1.6 4.7 128-180.3-128 76.5z" opacity=".65" />
      <path d="M127.9 416V312.2L0 235.7 127.9 416z" />
    </svg>
  )
}

/** Unité de coin en contexte texte : Ξ → losange SVG, le reste tel quel. */
export function CoinUnit({ unit }: { unit: string }) {
  return unit === 'Ξ' ? <EthGlyph /> : <>{unit}</>
}

/** $ cerclé façon logo USDC — hérite couleur/corps du texte comme EthGlyph. */
export function UsdcGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="inline-block h-[0.85em] w-auto -translate-y-[0.05em]" aria-label="USDC">
      <circle cx="12" cy="12" r="10.4" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <text x="12" y="16.8" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor">
        $
      </text>
    </svg>
  )
}

export function Stat({ label, value, sub, tone = 'default' }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: 'up' | 'down' | 'default' }) {
  const toneCls = tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-zinc-100'
  return (
    <div className="card p-4">
      <div className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-zinc-500">{label}</div>
      <div className={`num mt-1.5 text-2xl font-medium ${toneCls}`}>{value}</div>
      {sub !== undefined && <div className="mt-1 text-xs text-zinc-500">{sub}</div>}
    </div>
  )
}

export function Modal({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 py-10" onClick={onClose}>
      <div className={`card mt-2.5 ${wide ? 'w-[900px]' : 'w-[560px]'} max-w-[95vw]`} onClick={(e) => e.stopPropagation()}>
        <div className="pane-title">{title}</div>
        <div className="flex justify-end px-2 pt-2">
          <button
            aria-label="Fermer"
            className="cursor-pointer p-1 font-mono text-zinc-500 transition-colors hover:text-zinc-200"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="p-4 pt-1">{children}</div>
      </div>
    </div>
  )
}

const badgeColors: Record<string, string> = {
  running: 'bg-up/10 text-up border-up/30',
  done: 'bg-up/10 text-up border-up/30',
  stopped: 'bg-zinc-800/40 text-zinc-400 border-zinc-600/40',
  starting: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  stopping: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  pending: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  fetching_data: 'bg-info/10 text-info border-info/30',
  paused_risk: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  error: 'bg-down/10 text-down border-down/30',
  killed: 'bg-down/10 text-down border-down/30',
  canceled: 'bg-zinc-800/40 text-zinc-400 border-zinc-600/40',
  live: 'bg-down/10 text-down border-down/30',
  testnet: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  paper: 'bg-info/10 text-info border-info/30',
  long: 'bg-up/10 text-up border-up/30',
  short: 'bg-down/10 text-down border-down/30',
  spot: 'bg-info/10 text-info border-info/30',
  futures: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
}

export function Badge({ value, label }: { value: string; label?: string }) {
  return (
    <span
      className={`inline-block border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.08em] ${badgeColors[value] ?? 'bg-zinc-800/40 text-zinc-300 border-zinc-600/40'}`}
    >
      {label ?? value}
    </span>
  )
}

export function Spinner() {
  return <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-accent" />
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-12 text-center text-[13px] text-zinc-500">{children}</div>
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint !== undefined && <div className="mt-1 text-[11px] text-zinc-500">{hint}</div>}
    </div>
  )
}

export function ProgressBar({ ratio }: { ratio: number }) {
  return (
    <div className="h-1.5 w-full bg-panel2">
      <div className="h-1.5 bg-accent transition-all" style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }} />
    </div>
  )
}
