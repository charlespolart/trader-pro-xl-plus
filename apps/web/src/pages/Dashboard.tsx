import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { OctagonAlert, Power } from 'lucide-react'
import { api } from '../lib/api'
import { useBots } from '../lib/ws'
import { fmtNum, fmtPct, fmtPrice, pnlClass } from '../lib/format'
import { Badge, Card, Empty, PageHeader, Stat } from '../components/ui'

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
  const pnlToday = bots.reduce((s, b) => s + b.realizedPnlToday, 0)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        subtitle="Vue d'ensemble des bots et des derniers backtests"
        actions={
          <>
            <button className="btn-danger" onClick={() => confirm('Activer le kill switch ? (les positions restent ouvertes)') && kill.mutate(false)}>
              <OctagonAlert size={16} /> Kill switch
            </button>
            <button className="btn-kill" onClick={() => confirm('Kill switch + FERMETURE de toutes les positions au marché ?') && kill.mutate(true)}>
              <Power size={16} /> Tout fermer
            </button>
          </>
        }
      />

      <div className="grid grid-cols-4 gap-4">
        <Stat label="Bots actifs" value={running.length} />
        <Stat label="PnL réalisé aujourd'hui" value={fmtNum(pnlToday)} tone={pnlToday === 0 ? 'default' : pnlToday > 0 ? 'up' : 'down'} sub="Tous bots confondus" />
        <Stat label="Exposition live" value={`${fmtNum(account?.totalExposureQuote ?? 0, 0)} USDT`} />
        <Stat label="Solde BNB" value={account?.configured ? fmtNum(account.bnbBalance ?? 0, 4) : '—'} sub="Réserve de frais" />
      </div>

      <Card title="Bots" actions={<Link className="btn-primary btn-sm" to="/bots">Gérer</Link>} bodyClassName={bots.length === 0 ? 'p-4' : 'p-0'}>
        {bots.length === 0 ? (
          <Empty>
            Aucun bot. <Link to="/bots" className="text-accent hover:underline">Créez votre premier bot</Link>.
          </Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Marché</th>
                <th>Paire</th>
                <th>Mode</th>
                <th>Statut</th>
                <th>Position</th>
                <th className="text-right">Équité</th>
                <th className="text-right">PnL jour</th>
                <th className="text-right">PnL total</th>
              </tr>
            </thead>
            <tbody>
              {bots.map((b) => (
                <tr key={b.config.id}>
                  <td>
                    <Link to={`/bots/${b.config.id}`} className="font-medium text-accent hover:underline">
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
                  <td className="text-right tabular-nums">{fmtNum(b.equity)}</td>
                  <td className={`text-right tabular-nums ${pnlClass(b.realizedPnlToday)}`}>{fmtNum(b.realizedPnlToday)}</td>
                  <td className={`text-right tabular-nums ${pnlClass(b.realizedPnlTotal)}`}>{fmtNum(b.realizedPnlTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Derniers backtests" actions={<Link className="btn-ghost btn-sm" to="/backtests">Tout voir</Link>} bodyClassName={!backtests || backtests.length === 0 ? 'p-4' : 'p-0'}>
        {!backtests || backtests.length === 0 ? (
          <Empty>Aucun backtest</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Stratégie</th>
                <th>Paire</th>
                <th>Statut</th>
                <th className="text-right">Profit net</th>
                <th className="text-right">Trades</th>
                <th className="text-right">Max DD</th>
              </tr>
            </thead>
            <tbody>
              {backtests.slice(0, 8).map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/backtests/${r.id}`} className="font-medium text-accent hover:underline">
                      {r.config.strategyId}
                    </Link>
                  </td>
                  <td>
                    {r.config.symbol} <Badge value={r.config.market} />
                  </td>
                  <td><Badge value={r.status} /></td>
                  <td className={`text-right tabular-nums ${pnlClass(r.metrics?.netProfitPct)}`}>{r.metrics ? fmtPct(r.metrics.netProfitPct) : '—'}</td>
                  <td className="text-right tabular-nums">{r.metrics?.totalTrades ?? '—'}</td>
                  <td className="text-right tabular-nums text-down">{r.metrics ? fmtPct(-r.metrics.maxDrawdownPct) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
