import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { INTERVALS, type Interval, type MarketType } from '@tpx/shared'
import { api, type PatternScanResult } from '../lib/api'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { dateToInputValue, fmtDate, inputValueToMs } from '../lib/format'
import { Card, Empty, Field, PageHeader, Spinner } from '../components/ui'
import { TradingChart, type ChartMarker } from '../components/TradingChart'

/**
 * Laboratoire de patterns : scanne une plage de bougies avec les détecteurs du
 * core et permet de vérifier chaque détection une par une sur la chart.
 */
export function PatternLab() {
  const [market, setMarket] = useState<MarketType>('spot')
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [interval, setInterval_] = useState<Interval>('1h')
  const [from, setFrom] = useState(dateToInputValue(Date.now() - 90 * 86_400_000))
  const [to, setTo] = useState(dateToInputValue(Date.now()))
  const [requireTrend, setRequireTrend] = useState(true)
  const [strictColor, setStrictColor] = useState(false)
  const [strictGaps, setStrictGaps] = useState(false)
  const [trendMinPct, setTrendMinPct] = useState('0.8')

  const [result, setResult] = useState<PatternScanResult | null>(null)
  const [activeName, setActiveName] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [focusTime, setFocusTime] = useState<number | undefined>(undefined)

  const scan = useMutation({
    mutationFn: () =>
      api.patternScan({
        market,
        symbol,
        interval,
        start: inputValueToMs(from),
        end: inputValueToMs(to) + 86_400_000,
        names: 'all',
        requireTrend,
        strictColor,
        strictGaps,
        trendMinPct: Number(trendMinPct),
      }),
    onSuccess: (r) => {
      setResult(r)
      setActiveName(null)
      setCursor(0)
      setFocusTime(undefined)
    },
    onError: (e) => alert(e instanceof Error ? e.message : String(e)),
  })

  const filtered = useMemo(() => {
    if (!result) return []
    const list = activeName === null ? result.detections : result.detections.filter((d) => d.name === activeName)
    return [...list].sort((a, b) => a.time - b.time)
  }, [result, activeName])

  const markers = useMemo<ChartMarker[]>(
    () =>
      filtered.map((d) => ({
        time: d.time,
        position: d.dir > 0 ? 'belowBar' : 'aboveBar',
        shape: d.dir > 0 ? 'arrowUp' : 'arrowDown',
        color: d.dir > 0 ? 'rgba(38,166,154,0.85)' : 'rgba(239,83,80,0.85)',
        text: d.name,
      })),
    [filtered],
  )

  const goTo = (idx: number): void => {
    if (filtered.length === 0) return
    const i = Math.max(0, Math.min(filtered.length - 1, idx))
    setCursor(i)
    setFocusTime(filtered[i]!.time)
  }

  const sortedCounts = useMemo(
    () => (result ? Object.entries(result.counts).sort((a, b) => b[1] - a[1]) : []),
    [result],
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title="Laboratoire de patterns"
        subtitle="Scanne les détecteurs de chandeliers sur une plage et vérifie chaque détection une par une — mêmes détecteurs, mêmes seuils que dans les stratégies."
      />

      <Card>
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
          <Field label="Marché">
            <select className="input w-28" value={market} onChange={(e) => setMarket(e.target.value as MarketType)}>
              <option value="spot">spot</option>
              <option value="futures">futures</option>
            </select>
          </Field>
          <Field label="Paire">
            <input className="input w-32" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
          </Field>
          <Field label="Intervalle">
            <select className="input w-24" value={interval} onChange={(e) => setInterval_(e.target.value as Interval)}>
              {INTERVALS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Du">
            <input className="input w-36" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Au">
            <input className="input w-36" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <label className="flex cursor-pointer items-center gap-2 py-2 text-sm">
            <input type="checkbox" checked={requireTrend} onChange={(e) => setRequireTrend(e.target.checked)} className="accent-blue-500" />
            Contexte de tendance
          </label>
          <label
            className="flex cursor-pointer items-center gap-2 py-2 text-sm"
            title="Hammer/inverted hammer verts, hanging man/shooting star rouges. Les références (Nison, StockCharts) ne font pas de la couleur un critère — option pour suivre les fiches simplifiées."
          >
            <input type="checkbox" checked={strictColor} onChange={(e) => setStrictColor(e.target.checked)} className="accent-blue-500" />
            Couleur stricte
          </label>
          <label
            className="flex cursor-pointer items-center gap-2 py-2 text-sm"
            title="Exiger les gaps des définitions canoniques (piercing sous le plus bas, dark cloud au-dessus du plus haut, gaps des étoiles…). Quasi muet en crypto 24/7."
          >
            <input type="checkbox" checked={strictGaps} onChange={(e) => setStrictGaps(e.target.checked)} className="accent-blue-500" />
            Gaps stricts
          </label>
          <Field label="Tendance min (%)">
            <input className="input w-20" type="number" step="0.1" value={trendMinPct} onChange={(e) => setTrendMinPct(e.target.value)} />
          </Field>
          </div>
          <div className="flex justify-end">
            <button className="btn-primary" onClick={() => scan.mutate()} disabled={scan.isPending}>
              {scan.isPending ? <Spinner /> : <Search size={16} />} Scanner
            </button>
          </div>
        </div>
      </Card>

      {result && (
        <>
          <Card title={`Détections par pattern (${result.detections.length} au total)`}>
            <div className="flex flex-wrap gap-1.5">
              <button
                className={`rounded px-2 py-1 text-xs ${activeName === null ? 'bg-accent text-white' : 'bg-panel2 text-zinc-300 hover:bg-edge'}`}
                onClick={() => {
                  setActiveName(null)
                  setCursor(0)
                }}
              >
                tous ({result.detections.length})
              </button>
              {sortedCounts.map(([name, n]) => (
                <button
                  key={name}
                  className={`rounded px-2 py-1 text-xs ${activeName === name ? 'bg-accent text-white' : 'bg-panel2 text-zinc-300 hover:bg-edge'}`}
                  onClick={() => {
                    setActiveName(name)
                    setCursor(0)
                  }}
                >
                  {name} ({n})
                </button>
              ))}
              {result.available
                .filter((name) => !(name in result.counts))
                .map((name) => (
                  <span key={name} className="rounded px-2 py-1 text-xs text-zinc-600" title="aucune détection sur la plage">
                    {name} (0)
                  </span>
                ))}
            </div>
          </Card>

          <div className="grid grid-cols-[1fr_280px] gap-4">
            <Card
              title={`${symbol} · ${interval}${activeName !== null ? ` · ${activeName}` : ''}`}
              actions={
                filtered.length > 0 ? (
                  <div className="flex items-center gap-2 text-sm">
                    <button className="btn-ghost btn-sm btn-icon" onClick={() => goTo(cursor - 1)}>
                      <ChevronLeft size={15} />
                    </button>
                    <span className="text-zinc-400">
                      {focusTime !== undefined ? cursor + 1 : '—'} / {filtered.length}
                    </span>
                    <button className="btn-ghost btn-sm btn-icon" onClick={() => goTo(focusTime === undefined ? 0 : cursor + 1)}>
                      <ChevronRight size={15} />
                    </button>
                  </div>
                ) : undefined
              }
            >
              <TradingChart candles={result.candles} markers={markers} focusTime={focusTime} height={520} />
            </Card>

            <Card title="Détections" className="max-h-[600px] overflow-hidden">
              {filtered.length === 0 ? (
                <Empty>Aucune détection</Empty>
              ) : (
                <div className="max-h-[520px] space-y-0.5 overflow-y-auto">
                  {filtered.map((d, i) => (
                    <button
                      key={`${d.time}-${d.name}`}
                      className={`block w-full rounded px-2 py-1 text-left text-xs ${
                        i === cursor && focusTime !== undefined ? 'bg-accent/20 text-accent' : 'text-zinc-300 hover:bg-panel2'
                      }`}
                      onClick={() => goTo(i)}
                    >
                      <span className={d.dir > 0 ? 'text-up' : 'text-down'}>{d.dir > 0 ? '▲' : '▼'}</span>{' '}
                      <span className="text-zinc-500">{fmtDate(d.time)}</span> {d.name}
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
