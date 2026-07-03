import { useEffect, useMemo, useRef, useState } from 'react'

export interface PaletteAction {
  label: string
  hint?: string
  run: () => void
}

/** Palette de commandes (⌘K) : filtre + flèches + Entrée. Volontairement
 *  minimale — navigation et actions globales, rien d'autre. */
export function CommandPalette({ open, onClose, actions }: { open: boolean; onClose: () => void; actions: PaletteAction[] }) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return actions
    return actions.filter((a) => a.label.toLowerCase().includes(needle))
  }, [q, actions])

  useEffect(() => {
    if (open) {
      setQ('')
      setIdx(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  useEffect(() => {
    setIdx(0)
  }, [q])

  if (!open) return null

  const runAt = (i: number): void => {
    const a = filtered[i]
    if (!a) return
    onClose()
    a.run()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 pt-[18vh]" onClick={onClose}>
      <div className="card mt-2.5 w-[520px] max-w-[92vw]" onClick={(e) => e.stopPropagation()}>
        <div className="pane-title">Palette</div>
        <input
          ref={inputRef}
          className="w-full border-b border-edge bg-transparent px-4 py-3 font-mono text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
          placeholder="tape pour filtrer…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIdx((i) => Math.min(filtered.length - 1, i + 1))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIdx((i) => Math.max(0, i - 1))
            }
            if (e.key === 'Enter') runAt(idx)
          }}
        />
        <ul className="max-h-[300px] overflow-y-auto py-1">
          {filtered.length === 0 && <li className="px-4 py-3 text-[13px] text-zinc-600">aucune commande</li>}
          {filtered.map((a, i) => (
            <li key={a.label}>
              <button
                className={`flex w-full cursor-pointer items-center justify-between px-4 py-2 text-left text-[13px] ${
                  i === idx ? 'bg-panel2 text-accent' : 'text-zinc-300 hover:bg-panel2/60'
                }`}
                onMouseEnter={() => setIdx(i)}
                onClick={() => runAt(i)}
              >
                {a.label}
                {a.hint !== undefined && <span className="kbd">{a.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
