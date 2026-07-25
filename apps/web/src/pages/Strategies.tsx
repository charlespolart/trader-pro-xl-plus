import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCcw } from 'lucide-react'
import { api } from '../lib/api'
import { Badge, Card, Empty, PageHeader } from '../components/ui'

export function Strategies() {
  const qc = useQueryClient()
  const { data: strategies } = useQuery({ queryKey: ['strategies'], queryFn: api.strategies })
  const reload = useMutation({
    mutationFn: api.reloadStrategies,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['strategies'] }),
  })

  return (
    <div className="space-y-5">
      <PageHeader
        title="Stratégies"
        subtitle={
          <>
            Fichiers TypeScript dans <code className="rounded bg-panel2 px-1 text-zinc-300">strategies/</code> — même code en backtest et en live.
          </>
        }
        actions={
          <button className="btn-ghost" onClick={() => reload.mutate()} disabled={reload.isPending}>
            <RotateCcw size={15} /> Recharger
          </button>
        }
      />

      {!strategies || strategies.length === 0 ? (
        <Empty>Aucune stratégie trouvée</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {strategies.map((s) => (
            <Card key={s.id} className="transition-colors hover:border-zinc-600">
              {s.error !== undefined ? (
                <div>
                  <div className="font-semibold">{s.id}</div>
                  <div className="mt-1 text-sm text-down">Erreur de chargement : {s.error}</div>
                  <Link to={`/strategies/${s.id}`} className="btn-ghost mt-3">
                    Ouvrir l'éditeur
                  </Link>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between">
                    <Link to={`/strategies/${s.id}`} className="font-semibold text-accent hover:underline">
                      {s.name}
                    </Link>
                    <div className="flex gap-1">{s.markets?.map((m) => <Badge key={m} value={m} />)}</div>
                  </div>
                  <div className="mt-1 text-sm text-zinc-400">{s.description ?? '—'}</div>
                  <div className="mt-2 text-xs text-zinc-500">
                    {Object.keys(s.schema ?? {}).length} paramètres · fichier {s.id}.ts
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
