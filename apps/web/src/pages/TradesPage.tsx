import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { TradeRecord } from '@tpx/shared'
import { api } from '../lib/api'
import { useBots } from '../lib/ws'
import { Card } from '../components/ui'
import { TradesTable } from '../components/TradesTable'

export function TradesPage() {
  const bots = Object.values(useBots((s) => s.infos))
  const [botId, setBotId] = useState('')
  const { data: trades } = useQuery({
    queryKey: ['trades', botId],
    queryFn: () => api.trades(botId || undefined),
    refetchInterval: 15_000,
  })

  const records: TradeRecord[] = (trades ?? []).map((t) => ({
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
        <h1 className="text-lg font-bold">Trades (réels & paper)</h1>
        <select className="input w-64" value={botId} onChange={(e) => setBotId(e.target.value)}>
          <option value="">Tous les bots</option>
          {bots.map((b) => (
            <option key={b.config.id} value={b.config.id}>
              {b.config.name}
            </option>
          ))}
        </select>
      </div>
      <Card>
        <TradesTable trades={records} />
      </Card>
    </div>
  )
}
