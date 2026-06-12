export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return v.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function fmtQty(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return v.toLocaleString('fr-FR', { maximumFractionDigits: 8 })
}

export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)} %`
}

export function fmtPrice(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const digits = v >= 1000 ? 2 : v >= 1 ? 4 : 8
  return v.toLocaleString('fr-FR', { maximumFractionDigits: digits })
}

export function fmtDate(ms: number | null | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })
}

export function fmtDateShort(ms: number | null | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString('fr-FR')
}

export function fmtDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}j ${h % 24}h`
}

export function pnlClass(v: number | null | undefined): string {
  if (v === null || v === undefined || v === 0) return 'text-zinc-400'
  return v > 0 ? 'text-up' : 'text-down'
}

export function dateToInputValue(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function inputValueToMs(v: string): number {
  return Date.parse(`${v}T00:00:00Z`)
}
