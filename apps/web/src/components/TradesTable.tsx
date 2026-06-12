import type { TradeRecord } from '@tpx/shared'
import { fmtDate, fmtDuration, fmtNum, fmtPct, fmtPrice, fmtQty, pnlClass } from '../lib/format'
import { Badge, Empty } from './ui'

interface Props {
  trades: TradeRecord[]
  onSelect?: (t: TradeRecord) => void
}

export function TradesTable({ trades, onSelect }: Props) {
  if (trades.length === 0) return <Empty>Aucun trade</Empty>
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr>
            <th>#</th>
            <th>Sens</th>
            <th>Entrée</th>
            <th>Sortie</th>
            <th>Durée</th>
            <th>Prix entrée</th>
            <th>Prix sortie</th>
            <th>Qté</th>
            <th>PnL</th>
            <th>PnL %</th>
            <th>Frais</th>
            <th>MAE / MFE</th>
            <th>Raison entrée</th>
            <th>Raison sortie</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => (
            <tr
              key={t.id}
              className={onSelect ? 'cursor-pointer hover:bg-panel2' : ''}
              onClick={() => onSelect?.(t)}
            >
              <td className="text-zinc-500">{i + 1}</td>
              <td>
                <Badge value={t.direction} />
              </td>
              <td>{fmtDate(t.entryTime)}</td>
              <td>{t.exitTime !== null ? fmtDate(t.exitTime) : <Badge value="running" label="ouvert" />}</td>
              <td>{t.exitTime !== null ? fmtDuration(t.exitTime - t.entryTime) : '—'}</td>
              <td>{fmtPrice(t.avgEntryPrice)}</td>
              <td>{fmtPrice(t.avgExitPrice)}</td>
              <td>{fmtQty(t.qty)}</td>
              <td className={pnlClass(t.realizedPnl)}>{fmtNum(t.realizedPnl)}</td>
              <td className={pnlClass(t.realizedPnlPct)}>{fmtPct(t.realizedPnlPct)}</td>
              <td className="text-zinc-400">{fmtNum(t.fees)}</td>
              <td className="text-zinc-400">
                {fmtNum(t.mae)} / {fmtNum(t.mfe)}
              </td>
              <td className="max-w-72 truncate text-zinc-400" title={t.entryReason}>
                {t.entryReason ?? '—'}
              </td>
              <td className="max-w-72 truncate text-zinc-400" title={t.exitReason}>
                {t.exitReason ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
