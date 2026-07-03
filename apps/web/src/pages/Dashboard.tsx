import { Link } from 'react-router-dom'
import { useQueries, useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useBots } from '../lib/ws'
import { fmtNum, fmtPct, fmtQty, pnlClass } from '../lib/format'
import { Badge, Card, Empty } from '../components/ui'
import { WalletCard } from '../components/WalletCard'
import { CyclePane, baseUnitOf } from '../components/CyclePane'

export function Dashboard() {
  const bots = Object.values(useBots((s) => s.infos))
  const { data: account } = useQuery({ queryKey: ['account', 'live'], queryFn: () => api.account('live'), refetchInterval: 15_000 })
  const { data: backtests } = useQuery({ queryKey: ['backtests'], queryFn: api.backtests, refetchInterval: 10_000 })

  const active = bots.filter((b) => b.status !== 'stopped')
  const priceOf = (info: (typeof bots)[number]): number | null => {
    const base = info.config.symbol.replace(/(USDT|USDC|FDUSD|BUSD|EUR|USD)$/, '')
    return account?.spot?.find((s) => s.asset === base)?.price ?? null
  }

  // récolte par unité de base (accumulateurs) + PnL du jour toutes stratégies
  const harvest = new Map<string, number>()
  for (const b of bots) {
    const u = baseUnitOf(b)
    if (u !== null && b.realizedPnlTotal !== 0) harvest.set(u, (harvest.get(u) ?? 0) + b.realizedPnlTotal)
  }
  const pnlToday = bots.reduce((s, b) => s + b.realizedPnlToday, 0)

  // journal fusionné des bots actifs (8 dernières lignes)
  const logQueries = useQueries({
    queries: active.slice(0, 4).map((b) => ({
      queryKey: ['botlogs', b.config.id],
      queryFn: () => api.botLogs(b.config.id),
      refetchInterval: 20_000,
    })),
  })
  const journal = logQueries
    .flatMap((q, i) => (q.data ?? []).map((e) => ({ ...e, bot: active[i]?.config.name ?? '' })))
    .sort((a, b) => b.time - a.time)
    .slice(0, 8)

  return (
    <div className="space-y-6">
      <WalletCard />

      {harvest.size > 0 && (
        <Card title="Récolte" hint="base denom — le but : plus de coins" bodyClassName="p-5">
          <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
            {[...harvest.entries()].map(([unit, v]) => (
              <div key={unit}>
                <div className={`num text-[26px] font-medium leading-tight ${v >= 0 ? 'text-up' : 'text-down'}`}>
                  {v >= 0 ? '+' : ''}
                  {fmtQty(v)} {unit}
                </div>
                <div className="mt-1 text-xs text-zinc-500">accumulés en plus du simple hold</div>
              </div>
            ))}
            <div className="ml-auto flex gap-8 text-right">
              <div>
                <div className="text-[10.5px] uppercase tracking-[0.12em] text-zinc-600">PnL du jour</div>
                <div className={`num mt-1 text-[16px] ${pnlClass(pnlToday)}`}>{fmtNum(pnlToday)}</div>
              </div>
              <div>
                <div className="text-[10.5px] uppercase tracking-[0.12em] text-zinc-600">Exposition live</div>
                <div className="num mt-1 text-[16px] text-zinc-200">{fmtNum(account?.totalExposureQuote ?? 0, 0)}</div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ---- cycles : la machine d'accumulation, bot par bot ---- */}
      {active.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {active.map((b) => (
            <CyclePane key={b.config.id} info={b} price={priceOf(b)} />
          ))}
        </div>
      ) : (
        <Card title="Cycles" bodyClassName="p-4">
          <Empty>
            Aucun bot actif.{' '}
            <Link to="/bots" className="text-accent hover:underline">
              Créez votre premier bot
            </Link>{' '}
            — ou touche <span className="kbd">n</span>.
          </Empty>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <Card title="Journal" hint="fills · signaux · incidents" className="xl:col-span-7" bodyClassName="px-5 py-3">
          {journal.length === 0 ? (
            <Empty>Rien à signaler.</Empty>
          ) : (
            <div>
              {journal.map((e, i) => (
                <div key={`${e.time}-${i}`} className="flex gap-3 border-t border-[#14171e] py-2 first:border-t-0">
                  <time className="num w-[92px] shrink-0 pt-px text-[11.5px] text-zinc-600">
                    {new Date(e.time).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </time>
                  <span
                    className={`w-[42px] shrink-0 pt-[2px] font-mono text-[10.5px] font-bold tracking-[0.06em] ${
                      e.level === 'error' ? 'text-down' : e.level === 'warn' ? 'text-accent' : 'text-zinc-600'
                    }`}
                  >
                    {e.level === 'error' ? 'ERR' : e.level === 'warn' ? 'WARN' : 'INFO'}
                  </span>
                  <span className="min-w-0 text-[13px] text-zinc-400">
                    <span className="text-zinc-600">{e.bot} — </span>
                    {e.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Derniers backtests" hint={<Link to="/backtests" className="cursor-pointer hover:text-accent">tout voir →</Link>} className="xl:col-span-5" bodyClassName={!backtests || backtests.length === 0 ? 'p-4' : 'p-0 overflow-x-auto'}>
          {!backtests || backtests.length === 0 ? (
            <Empty>Aucun backtest</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Stratégie</th>
                  <th>Paire</th>
                  <th className="text-right">Profit</th>
                  <th className="text-right">DD</th>
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
                    <td className="num text-[12px]">{r.config.symbol}</td>
                    <td className={`num text-right ${pnlClass(r.metrics?.netProfitPct)}`}>{r.metrics ? fmtPct(r.metrics.netProfitPct) : <Badge value={r.status} />}</td>
                    <td className="num text-right text-down">{r.metrics ? fmtPct(-r.metrics.maxDrawdownPct) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* table complète des bots (au-delà des cycles) */}
      {bots.length > 0 && (
        <Card title="Bots" hint={<Link to="/bots" className="cursor-pointer hover:text-accent">gérer →</Link>} bodyClassName="p-0 overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Paire</th>
                <th>Mode</th>
                <th>Statut</th>
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
                  <td className="num text-[12px]">{b.config.symbol}</td>
                  <td>
                    <Badge value={b.config.mode} label={b.config.mode === 'testnet' ? 'démo' : undefined} />
                  </td>
                  <td>
                    <Badge value={b.status} />
                    {b.statusReason !== undefined && <span className="ml-1.5 text-xs text-zinc-600">{b.statusReason}</span>}
                  </td>
                  <td className="num text-right">{fmtNum(b.equity)}</td>
                  <td className={`num text-right ${pnlClass(b.realizedPnlToday)}`}>{fmtNum(b.realizedPnlToday)}</td>
                  <td className={`num text-right ${pnlClass(b.realizedPnlTotal)}`}>{fmtNum(b.realizedPnlTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
