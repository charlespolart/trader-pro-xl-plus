import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { create } from 'zustand'

type Tone = 'default' | 'danger'

interface ConfirmOptions {
  title?: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: Tone
}

interface AlertOptions {
  title?: string
  message: ReactNode
  confirmLabel?: string
  tone?: Tone
}

interface DialogStore {
  open: boolean
  variant: 'confirm' | 'alert'
  title?: string
  message: ReactNode
  confirmLabel: string
  cancelLabel: string
  tone: Tone
  resolve: ((v: boolean) => void) | null
  settle: (v: boolean) => void
}

const useDialog = create<DialogStore>((set, get) => ({
  open: false,
  variant: 'confirm',
  title: undefined,
  message: '',
  confirmLabel: 'Confirmer',
  cancelLabel: 'Annuler',
  tone: 'default',
  resolve: null,
  settle: (v) => {
    const { resolve } = get()
    set({ open: false, resolve: null })
    resolve?.(v)
  },
}))

/** Styled replacement for window.confirm — resolves true if the user confirms. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useDialog.setState({
      open: true,
      variant: 'confirm',
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel ?? 'Confirmer',
      cancelLabel: opts.cancelLabel ?? 'Annuler',
      tone: opts.tone ?? 'default',
      resolve,
    })
  })
}

/** Styled replacement for window.alert — resolves once dismissed. */
export function alertDialog(opts: AlertOptions): Promise<void> {
  return new Promise((resolve) => {
    useDialog.setState({
      open: true,
      variant: 'alert',
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel ?? 'OK',
      cancelLabel: '',
      tone: opts.tone ?? 'default',
      resolve: () => resolve(),
    })
  })
}

/** Single host mounted once at the app root; renders the active dialog. */
export function DialogHost() {
  const open = useDialog((s) => s.open)
  const variant = useDialog((s) => s.variant)
  const title = useDialog((s) => s.title)
  const message = useDialog((s) => s.message)
  const confirmLabel = useDialog((s) => s.confirmLabel)
  const cancelLabel = useDialog((s) => s.cancelLabel)
  const tone = useDialog((s) => s.tone)
  const settle = useDialog((s) => s.settle)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') settle(false)
      else if (e.key === 'Enter') settle(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, settle])

  if (!open) return null
  const confirmCls = tone === 'danger' ? 'btn-kill' : 'btn-primary'
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={() => settle(false)}>
      <div className="card w-[420px] max-w-[95vw] shadow-2xl shadow-black/40" onClick={(e) => e.stopPropagation()}>
        <div className="p-5">
          {title !== undefined && <div className="text-base font-semibold text-zinc-100">{title}</div>}
          <div className={`text-sm leading-relaxed text-zinc-400 ${title !== undefined ? 'mt-1.5' : ''}`}>{message}</div>
        </div>
        <div className="flex justify-end gap-2 border-t border-edge px-5 py-3">
          {variant === 'confirm' && (
            <button className="btn-ghost" onClick={() => settle(false)}>
              {cancelLabel}
            </button>
          )}
          <button className={confirmCls} onClick={() => settle(true)} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
