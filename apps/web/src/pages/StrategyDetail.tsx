import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Editor from '@monaco-editor/react'
import type { ParamDef } from '@tpx/shared'
import { ChevronLeft, Save } from 'lucide-react'
import { api } from '../lib/api'
import { Badge, Card, Empty, PageHeader, Spinner } from '../components/ui'

export function StrategyDetail() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const { data: strategies } = useQuery({ queryKey: ['strategies'], queryFn: api.strategies })
  const { data: sourceData } = useQuery({ queryKey: ['strategy-source', id], queryFn: () => api.strategySource(id) })
  const [source, setSource] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState('')

  useEffect(() => {
    if (sourceData) setSource(sourceData.source)
  }, [sourceData])

  const strategy = strategies?.find((s) => s.id === id)

  const save = useMutation({
    mutationFn: () => api.saveStrategySource(id, source ?? ''),
    onSuccess: (dto) => {
      setSaveMsg(dto.error !== undefined ? `⚠️ Sauvegardé mais erreur de chargement : ${dto.error}` : '✅ Sauvegardé et rechargé')
      void qc.invalidateQueries({ queryKey: ['strategies'] })
    },
    onError: (e) => setSaveMsg(`❌ ${e instanceof Error ? e.message : e}`),
  })

  if (!sourceData || source === null) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2.5">
            {strategy?.name ?? id}
            {strategy?.markets?.map((m) => <Badge key={m} value={m} />)}
          </span>
        }
        subtitle={
          strategy?.error !== undefined ? (
            <span className="text-down">{strategy.error}</span>
          ) : (
            'Éditeur de code — sauvegarde et recharge la stratégie à chaud'
          )
        }
        actions={
          <>
            {saveMsg !== '' && <span className="text-xs text-zinc-500">{saveMsg}</span>}
            <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending || source === sourceData.source}>
              <Save size={15} /> Sauvegarder
            </button>
            <Link to="/strategies" className="btn-ghost">
              <ChevronLeft size={15} /> Stratégies
            </Link>
          </>
        }
      />

      <Card className="overflow-hidden" bodyClassName="p-0">
        <Editor
          height="560px"
          language="typescript"
          theme="vs-dark"
          value={source}
          onChange={(v) => setSource(v ?? '')}
          options={{ fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: 'on' }}
        />
      </Card>

      {strategy?.schema && (
        <Card title="Paramètres exposés" bodyClassName={Object.keys(strategy.schema).length === 0 ? 'p-4' : 'p-0'}>
          {Object.keys(strategy.schema).length === 0 ? (
            <Empty>Aucun paramètre</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Clé</th>
                  <th>Label</th>
                  <th>Type</th>
                  <th>Défaut</th>
                  <th>Bornes</th>
                  <th>Groupe</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(strategy.schema).map(([key, def]) => {
                  const d = def as ParamDef
                  return (
                    <tr key={key}>
                      <td className="font-mono text-accent">{key}</td>
                      <td>{d.label ?? '—'}</td>
                      <td className="text-zinc-400">{d.kind}</td>
                      <td>{String(d.default)}</td>
                      <td className="text-zinc-400">
                        {'min' in d && d.min !== undefined ? `${d.min} → ${d.max ?? '∞'}` : 'options' in d && d.options ? d.options.join(', ') : '—'}
                      </td>
                      <td className="text-zinc-400">{d.group ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  )
}
