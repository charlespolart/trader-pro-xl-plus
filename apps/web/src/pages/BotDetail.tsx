import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LogEntry, TradeRecord } from '@tpx/shared'
import { api } from '../lib/api'
import { useBots, wsClient } from '../lib/ws'
import { fmtDate, fmtNum, fmtPrice, pnlClass } from '../lib/format'
import { Badge, Card, Empty } from '../components/ui'
import { TradingChart } from '../components/TradingChart'
import { TradesTable } from '../components/TradesTable'

export function BotDetail() {
  const { id = '' } = useParams()
  const info = useBots((s) => s.infos[id])
  const qc = useQueryClient()
  const [liveLogs, setLiveLogs] = useState<LogEntry[]>([])

  const running = info !== undefined && info.status !== 'stopped' && info.status !== 'killed'

  const { data: chart } = useQuery({
    queryKey: ['bot-chart', id],
    queryFn: () => api.botChart(id),
    enabled: running,
    refetchInterval: 30_000,
  })
  const { data: logs } = useQuery({ queryKey: ['bot-logs', id], queryFn: () => api.botLogs(id), enabled: running })
  const { data: trades } = useQuery({ queryKey: ['bot-trades', id], queryFn: () => api.trades(id), refetchInterval: 15_000 })

  useEffect(() => {
    setLiveLogs([])
    return wsClient.subscribe(`bot:${id}`, (event) => {
      if (event.t === 'bot:log') {
        setLiveLogs((prev) => [...prev.slice(-300), event.entry])
      } else if (event.t === 'bot:fill' || event.t === 'bot:annotation') {
        void qc.invalidateQueries({ queryKey: ['bot-chart', id] })
        void qc.invalidateQueries({ queryKey: ['bot-trades', id] })
      }
    })
  }, [id, qc])

  if (!info) {
    return (
      <Empty>
        Bot introuvable — <Link to="/bots" className="text-accent">retour aux bots</Link>
      </Empty>
    )
  }

  const cfg = info.config
  const allLogs = [...(logs ?? []), ...liveLogs].slice(-400)
  const tradeRecords: TradeRecord[] = (trades ?? []).map((t) => ({
    ...t,
    direction: t.direction as TradeRecord['direction'],
    market: t.market as TradeRecord['market'],
    entryReason: t.entryReason ?? undefined,
    exitReason: t.exitReason ?? undefined,
    backtestId: undefined,
    fills: [],
  }))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold">{cfg.name}</h1>
          <Badge value={cfg.market} />
          <Badge value={cfg.mode} />
          <Badge value={info.status} />
          {info.statusReason !== undefined && <span className="text-xs text-zinc-500">{info.statusReason}</span>}
        </div>
        <Link to="/bots" className="btn-ghost">
          ← Bots
        </Link>
      </div>

      <div className="grid grid-cols-5 gap-4">
        <Card>
          <div className="text-[11px] text-zinc-500">Équité</div>
          <div className="text-lg font-bold">{fmtNum(info.equity)}</div>
        </Card>
        <Card>
          <div className="text-[11px] text-zinc-500">Position</div>
          <div className="text-lg font-bold">
            {info.position && info.position.qty !== 0 ? (
              <span className={info.position.qty > 0 ? 'text-up' : 'text-down'}>
                {info.position.qty > 0 ? 'LONG' : 'SHORT'} {Math.abs(info.position.qty)}
              </span>
            ) : (
              <span className="text-zinc-500">flat</span>
            )}
          </div>
          {info.position && info.position.qty !== 0 && (
            <div className="text-xs text-zinc-500">
              @ {fmtPrice(info.position.entryPrice)} · uPnL{' '}
              <span className={pnlClass(info.position.unrealizedPnl)}>{fmtNum(info.position.unrealizedPnl)}</span>
            </div>
          )}
        </Card>
        <Card>
          <div className="text-[11px] text-zinc-500">PnL aujourd'hui</div>
          <div className={`text-lg font-bold ${pnlClass(info.realizedPnlToday)}`}>{fmtNum(info.realizedPnlToday)}</div>
        </Card>
        <Card>
          <div className="text-[11px] text-zinc-500">PnL total</div>
          <div className={`text-lg font-bold ${pnlClass(info.realizedPnlTotal)}`}>{fmtNum(info.realizedPnlTotal)}</div>
        </Card>
        <Card>
          <div className="text-[11px] text-zinc-500">Ordres ouverts</div>
          <div className="text-lg font-bold">{info.openOrders.length}</div>
        </Card>
      </div>

      {running && chart ? (
        <Card title={`${cfg.symbol} · ${chart.interval ?? ''}`}>
          <TradingChart
            candles={chart.candles}
            indicators={chart.indicators}
            annotations={chart.annotations}
            markers={[]}
            liveTopic={chart.interval ? `candles:${cfg.market}:${cfg.symbol}:${chart.interval}` : undefined}
            height={460}
          />
        </Card>
      ) : (
        <Card>
          <Empty>Démarrez le bot pour voir la chart live et ses indicateurs</Empty>
        </Card>
      )}

      {info.openOrders.length > 0 && (
        <Card title="Ordres ouverts">
          <table className="w-full">
            <thead>
              <tr>
                <th>Type</th>
                <th>Sens</th>
                <th>Qté</th>
                <th>Prix</th>
                <th>Stop</th>
                <th>Statut</th>
                <th>Tag</th>
                <th>Raison</th>
              </tr>
            </thead>
            <tbody>
              {info.openOrders.map((o) => (
                <tr key={o.id}>
                  <td>{o.type}</td>
                  <td className={o.side === 'BUY' ? 'text-up' : 'text-down'}>{o.side}</td>
                  <td>{o.qty}</td>
                  <td>{fmtPrice(o.price)}</td>
                  <td>{fmtPrice(o.stopPrice)}</td>
                  <td><Badge value={o.status.toLowerCase()} label={o.status} /></td>
                  <td className="text-zinc-400">{o.tag ?? '—'}</td>
                  <td className="max-w-64 truncate text-zinc-400">{o.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card title="Trades">
        <TradesTable trades={tradeRecords} />
      </Card>

      <Card title="Journal">
        {allLogs.length === 0 ? (
          <Empty>Aucun log</Empty>
        ) : (
          <div className="max-h-80 space-y-0.5 overflow-y-auto font-mono text-xs">
            {[...allLogs].reverse().map((l, i) => (
              <div key={i} className="flex gap-2">
                <span className="shrink-0 text-zinc-600">{fmtDate(l.time)}</span>
                <span
                  className={
                    l.level === 'error' ? 'text-down' : l.level === 'warn' ? 'text-amber-400' : l.level === 'debug' ? 'text-zinc-500' : 'text-zinc-300'
                  }
                >
                  {l.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
