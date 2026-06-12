import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useBots } from '../lib/ws'
import { fmtNum, fmtPct, fmtPrice, pnlClass } from '../lib/format'
import { Badge, Card, Empty } from '../components/ui'

export function Dashboard() {
  const bots = Object.values(useBots((s) => s.infos))
  const qc = useQueryClient()
  const { data: account } = useQuery({ queryKey: ['account', 'live'], queryFn: () => api.account('live'), refetchInterval: 15_000 })
  const { data: backtests } = useQuery({ queryKey: ['backtests'], queryFn: api.backtests, refetchInterval: 10_000 })

  const kill = useMutation({
    mutationFn: (close: boolean) => api.killSwitch(true, close),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['account'] }),
  })

  const running = bots.filter((b) => b.status === 'running' || b.status === 'paused_risk')

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Dashboard</h1>
        <div className="flex gap-2">
          <button className="btn-danger" onClick={() => confirm('Activer le kill switch ? (les positions restent ouvertes)') && kill.mutate(false)}>
            🛑 Kill switch
          </button>
          <button
            className="btn-danger"
            onClick={() => confirm('Kill switch + FERMETURE de toutes les positions au marché ?') && kill.mutate(true)}
          >
            🛑 Tout fermer
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <div className="text-[11px] text-zinc-500">Bots actifs</div>
          <div className="text-xl font-bold">{running.length}</div>
        </Card>
        <Card>
          <div className="text-[11px] text-zinc-500">PnL réalisé aujourd'hui (tous bots)</div>
          <div className={`text-xl font-bold ${pnlClass(bots.reduce((s, b) => s + b.realizedPnlToday, 0))}`}>
            {fmtNum(bots.reduce((s, b) => s + b.realizedPnlToday, 0))}
          </div>
        </Card>
        <Card>
          <div className="text-[11px] text-zinc-500">Exposition live</div>
          <div className="text-xl font-bold">{fmtNum(account?.totalExposureQuote ?? 0, 0)} USDT</div>
        </Card>
        <Card>
          <div className="text-[11px] text-zinc-500">Solde BNB (frais)</div>
          <div className="text-xl font-bold">{account?.configured ? fmtNum(account.bnbBalance ?? 0, 4) : '—'}</div>
        </Card>
      </div>

      <Card title="Bots" actions={<Link className="btn-primary" to="/bots">Gérer</Link>}>
        {bots.length === 0 ? (
          <Empty>
            Aucun bot. <Link to="/bots" className="text-accent">Créez votre premier bot</Link>.
          </Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Marché</th>
                <th>Paire</th>
                <th>Mode</th>
                <th>Statut</th>
                <th>Position</th>
                <th>Équité</th>
                <th>PnL jour</th>
                <th>PnL total</th>
              </tr>
            </thead>
            <tbody>
              {bots.map((b) => (
                <tr key={b.config.id}>
                  <td>
                    <Link to={`/bots/${b.config.id}`} className="text-accent hover:underline">
                      {b.config.name}
                    </Link>
                  </td>
                  <td><Badge value={b.config.market} /></td>
                  <td>{b.config.symbol}</td>
                  <td><Badge value={b.config.mode} /></td>
                  <td>
                    <Badge value={b.status} />
                    {b.statusReason !== undefined && <span className="ml-1 text-xs text-zinc-500">{b.statusReason}</span>}
                  </td>
                  <td>
                    {b.position && b.position.qty !== 0 ? (
                      <span className={b.position.qty > 0 ? 'text-up' : 'text-down'}>
                        {b.position.qty > 0 ? 'LONG' : 'SHORT'} {Math.abs(b.position.qty)} @ {fmtPrice(b.position.entryPrice)}
                      </span>
                    ) : (
                      <span className="text-zinc-500">flat</span>
                    )}
                  </td>
                  <td>{fmtNum(b.equity)}</td>
                  <td className={pnlClass(b.realizedPnlToday)}>{fmtNum(b.realizedPnlToday)}</td>
                  <td className={pnlClass(b.realizedPnlTotal)}>{fmtNum(b.realizedPnlTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Derniers backtests" actions={<Link className="btn-ghost" to="/backtests">Tout voir</Link>}>
        {!backtests || backtests.length === 0 ? (
          <Empty>Aucun backtest</Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th>Stratégie</th>
                <th>Paire</th>
                <th>Statut</th>
                <th>Profit net</th>
                <th>Trades</th>
                <th>Max DD</th>
              </tr>
            </thead>
            <tbody>
              {backtests.slice(0, 8).map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/backtests/${r.id}`} className="text-accent hover:underline">
                      {r.config.strategyId}
                    </Link>
                  </td>
                  <td>
                    {r.config.symbol} <Badge value={r.config.market} />
                  </td>
                  <td><Badge value={r.status} /></td>
                  <td className={pnlClass(r.metrics?.netProfitPct)}>{r.metrics ? fmtPct(r.metrics.netProfitPct) : '—'}</td>
                  <td>{r.metrics?.totalTrades ?? '—'}</td>
                  <td className="text-down">{r.metrics ? fmtPct(-r.metrics.maxDrawdownPct) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
