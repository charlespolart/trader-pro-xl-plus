import { useMemo } from 'react'
import type { TradeRecord } from '@tpx/shared'

interface Props {
  trades: TradeRecord[]
  /** bornes temporelles du backtest (ms) pour répartir les barres en X */
  start: number
  end: number
  /** unité du P&L : 'base' = BTC, 'quote' = USDT */
  denomination?: 'quote' | 'base'
  height?: number
}

const UP = '#26a69a'
const DOWN = '#ef5350'

/**
 * Bandeau « code-barres » des trades : une barre verticale par trade, placée
 * sur l'axe du temps (gauche → droite), verte vers le haut pour un gain, rouge
 * vers le bas pour une perte, hauteur proportionnelle au montant. Tout tient sur
 * la largeur (pas de scroll) → on voit la répartition gains/pertes d'un coup.
 */
export function TradePnlStrip({ trades, start, end, denomination = 'quote', height = 180 }: Props) {
  const closed = useMemo(() => trades.filter((t) => t.exitTime !== null), [trades])

  const maxAbs = useMemo(() => Math.max(1e-12, ...closed.map((t) => Math.abs(t.realizedPnl))), [closed])
  const wins = closed.filter((t) => t.realizedPnl > 0).length
  const losses = closed.length - wins
  const span = end - start

  if (closed.length === 0 || span <= 0) {
    return <div className="text-sm text-zinc-500">Aucun trade clôturé à représenter.</div>
  }

  const isBase = denomination === 'base'
  const unit = isBase ? 'BTC' : 'USDT'
  const fmtAmt = (v: number): string => (isBase ? v.toFixed(5) : v.toFixed(2))
  const fmtDate = (t: number): string => new Date(t).toISOString().slice(0, 10)

  return (
    <div>
      <div style={{ position: 'relative', height }} className="w-full">
        {/* ligne de zéro */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 1, background: '#39425a' }} />
        {closed.map((t, i) => {
          const x = Math.min(1, Math.max(0, (t.exitTime! - start) / span))
          const win = t.realizedPnl > 0
          // hauteur en % de la moitié haute/basse (max ~46% pour ne pas toucher les bords)
          const h = Math.max(1.5, (Math.abs(t.realizedPnl) / maxAbs) * 46)
          const style: React.CSSProperties = {
            position: 'absolute',
            left: `${x * 100}%`,
            width: 2,
            marginLeft: -1,
            height: `${h}%`,
            background: win ? UP : DOWN,
            borderRadius: 1,
            ...(win ? { bottom: '50%' } : { top: '50%' }),
          }
          const title = `${fmtDate(t.exitTime!)} · ${win ? '+' : ''}${fmtAmt(t.realizedPnl)} ${unit} (${t.realizedPnlPct >= 0 ? '+' : ''}${t.realizedPnlPct.toFixed(1)}%)`
          return <div key={t.id ?? i} title={title} style={style} />
        })}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
        <span>{fmtDate(start)}</span>
        <span>
          <span style={{ color: UP }}>▲ {wins} gagnants</span>
          {'  ·  '}
          <span style={{ color: DOWN }}>▼ {losses} perdants</span>
          {'  ·  '}
          {closed.length} trades · hauteur ∝ {unit} · survol = détail
        </span>
        <span>{fmtDate(end)}</span>
      </div>
    </div>
  )
}
