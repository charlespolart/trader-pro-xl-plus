import type { ReactNode } from 'react'

export function Card({ title, children, actions, className = '' }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={`card ${className}`}>
      {(title !== undefined || actions !== undefined) && (
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-edge">
          <div className="text-sm font-semibold text-zinc-300">{title}</div>
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  )
}

export function Modal({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 overflow-y-auto py-10" onClick={onClose}>
      <div className={`card ${wide ? 'w-[900px]' : 'w-[560px]'} max-w-[95vw]`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
          <div className="text-sm font-semibold">{title}</div>
          <button className="text-zinc-500 hover:text-zinc-200" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

const badgeColors: Record<string, string> = {
  running: 'bg-up/15 text-up',
  done: 'bg-up/15 text-up',
  stopped: 'bg-zinc-700/40 text-zinc-400',
  starting: 'bg-amber-500/15 text-amber-400',
  stopping: 'bg-amber-500/15 text-amber-400',
  pending: 'bg-amber-500/15 text-amber-400',
  fetching_data: 'bg-blue-500/15 text-blue-400',
  paused_risk: 'bg-amber-500/15 text-amber-400',
  error: 'bg-down/15 text-down',
  killed: 'bg-down/15 text-down',
  canceled: 'bg-zinc-700/40 text-zinc-400',
  live: 'bg-down/15 text-down',
  testnet: 'bg-amber-500/15 text-amber-400',
  paper: 'bg-blue-500/15 text-blue-400',
  long: 'bg-up/15 text-up',
  short: 'bg-down/15 text-down',
  spot: 'bg-blue-500/15 text-blue-400',
  futures: 'bg-purple-500/15 text-purple-400',
}

export function Badge({ value, label }: { value: string; label?: string }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${badgeColors[value] ?? 'bg-zinc-700/40 text-zinc-300'}`}>
      {label ?? value}
    </span>
  )
}

export function Spinner() {
  return <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-200" />
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-10 text-center text-sm text-zinc-500">{children}</div>
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint !== undefined && <div className="mt-0.5 text-[11px] text-zinc-500">{hint}</div>}
    </div>
  )
}

export function ProgressBar({ ratio }: { ratio: number }) {
  return (
    <div className="h-1.5 w-full rounded bg-panel2">
      <div className="h-1.5 rounded bg-accent transition-all" style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }} />
    </div>
  )
}
