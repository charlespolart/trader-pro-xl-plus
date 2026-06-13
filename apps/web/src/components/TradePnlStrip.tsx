import { useMemo, useState } from 'react'
import type { TradeRecord } from '@tpx/shared'

interface Props {
  trades: TradeRecord[]
  /** unité du P&L : 'base' = BTC, 'quote' = USDT */
  denomination?: 'quote' | 'base'
  height?: number
}

const UP = '#26a69a'
const DOWN = '#ef5350'

/**
 * Bandeau « code-barres » des trades : une barre verticale par trade clôturé,
 * en ordre chronologique (gauche = premier, droite = dernier), verte vers le
 * haut pour un gain, rouge vers le bas pour une perte, hauteur ∝ au montant.
 * Les barres se partagent toute la largeur (flex) : peu de trades = barres
 * larges, beaucoup de trades = barres fines. Survol d'une colonne → infobulle.
 */
export function TradePnlStrip({ trades, denomination = 'quote', height = 190 }: Props) {
  const closed = useMemo(
    () => trades.filter((t) => t.exitTime !== null).sort((a, b) => a.exitTime! - b.exitTime!),
    [trades],
  )
  const maxAbs = useMemo(() => Math.max(1e-12, ...closed.map((t) => Math.abs(t.realizedPnl))), [closed])
  const [hover, setHover] = useState<{ idx: number; x: number; w: number } | null>(null)

  if (closed.length === 0) {
    return <div className="text-sm text-zinc-500">Aucun trade clôturé à représenter.</div>
  }

  const n = closed.length
  const wins = closed.filter((t) => t.realizedPnl > 0).length
  const isBase = denomination === 'base'
  const unit = isBase ? 'BTC' : 'USDT'
  const fmtAmt = (v: number): string => (isBase ? v.toFixed(5) : v.toFixed(2))
  const fmtDate = (t: number): string => new Date(t).toISOString().slice(0, 10)

  const onMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const rel = (e.clientX - rect.left) / rect.width
    const idx = Math.min(n - 1, Math.max(0, Math.floor(rel * n)))
    setHover({ idx, x: e.clientX - rect.left, w: rect.width })
  }

  const ht = hover ? closed[hover.idx]! : null
  const tipLeft = hover ? Math.min(Math.max(hover.x, 96), hover.w - 96) : 0
  // espacement entre barres : fin, et réduit encore quand il y a beaucoup de trades
  const gap = n > 120 ? 1 : 2

  return (
    <div>
      <div
        style={{ position: 'relative', height }}
        className="w-full"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* barres : flex → chaque colonne prend une part égale de la largeur */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'stretch', gap }}>
          {closed.map((t, i) => {
            const win = t.realizedPnl > 0
            const h = Math.max(4, (Math.abs(t.realizedPnl) / maxAbs) * 44)
            const isHover = hover?.idx === i
            return (
              <div
                key={t.id ?? i}
                style={{
                  flex: '1 1 0',
                  minWidth: 0,
                  position: 'relative',
                  background: isHover ? 'rgba(255,255,255,0.05)' : 'transparent',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    height: `${h}%`,
                    background: win ? UP : DOWN,
                    opacity: hover && !isHover ? 0.45 : 1,
                    ...(win ? { bottom: '50%' } : { top: '50%' }),
                  }}
                />
              </div>
            )
          })}
        </div>
        {/* ligne de zéro (au-dessus des barres) */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 1, background: '#39425a' }} />

        {ht && hover && (
          <div
            style={{
              position: 'absolute',
              left: tipLeft,
              top: 6,
              transform: 'translateX(-50%)',
              pointerEvents: 'none',
              zIndex: 10,
              whiteSpace: 'nowrap',
              background: 'rgba(10,13,19,0.96)',
              border: '1px solid #2a3247',
              borderRadius: 8,
              padding: '6px 10px',
              fontSize: 12,
              lineHeight: 1.5,
              color: '#e4e7ee',
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ color: '#9aa3b5' }}>
              Trade #{hover.idx + 1}/{n} · {fmtDate(ht.exitTime!)}
            </div>
            <div style={{ color: ht.realizedPnl > 0 ? UP : DOWN, fontWeight: 600 }}>
              {ht.realizedPnl >= 0 ? '+' : ''}
              {fmtAmt(ht.realizedPnl)} {unit} ({ht.realizedPnlPct >= 0 ? '+' : ''}
              {ht.realizedPnlPct.toFixed(1)}%)
            </div>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
        <span>{fmtDate(closed[0]!.exitTime!)}</span>
        <span>
          <span style={{ color: UP }}>▲ {wins} gagnants</span>
          {'  ·  '}
          <span style={{ color: DOWN }}>▼ {n - wins} perdants</span>
          {'  ·  '}
          {n} trades · ordre chronologique · hauteur ∝ {unit}
        </span>
        <span>{fmtDate(closed[n - 1]!.exitTime!)}</span>
      </div>
    </div>
  )
}
