import { Link } from 'react-router-dom'
import type { BotRuntimeInfo } from '@tpx/shared'
import { fmtNum, fmtPrice, fmtQty } from '../lib/format'

/** Unité base des stratégies d'accumulation (récolte affichée en ₿/Ξ). */
export function baseUnitOf(info: BotRuntimeInfo): string | null {
  if (!info.config.strategyId.includes('accumulator')) return null
  const s = info.config.symbol
  if (s.startsWith('BTC')) return '₿'
  if (s.startsWith('ETH')) return 'Ξ'
  return s.replace(/(USDT|USDC|FDUSD|BUSD|EUR|USD)$/, '')
}

interface CycleState {
  kind: 'holding' | 'sold_armed' | 'sold_waiting' | 'idle' | 'stopped'
  label: string
  cls: string
}

function deriveState(info: BotRuntimeInfo, dust: number): CycleState {
  if (info.status !== 'running' && info.status !== 'paused_risk') {
    return { kind: 'stopped', label: `● ${info.status.toUpperCase()}`, cls: 'text-zinc-500 border-zinc-600/40 bg-zinc-800/30' }
  }
  const qty = info.position?.qty ?? 0
  const hasStop = info.openOrders.some((o) => o.type === 'STOP_MARKET' || o.type === 'STOP_LIMIT')
  if (qty > dust) return { kind: 'holding', label: '● CONSERVE', cls: 'text-info border-info/30 bg-info/10' }
  if (hasStop) return { kind: 'sold_armed', label: '● VENDU · STOP ARMÉ', cls: 'text-accent border-accent/35 bg-accent/10' }
  if (info.strategyState?.['bracket'] === true || info.strategyState?.['soldPrice'] !== undefined) {
    return { kind: 'sold_waiting', label: '● VENDU · ATTEND', cls: 'text-accent border-accent/35 bg-accent/10' }
  }
  return { kind: 'idle', label: '● EN ATTENTE', cls: 'text-zinc-400 border-zinc-600/40 bg-zinc-800/30' }
}

/** Rail de niveaux : positionne stop / vente / rachat / prix proportionnellement,
 *  avec un écart minimal pour rester lisible. */
function railLevels(rows: { key: string; lab: string; px: number | null; cls: 'stop' | 'sell' | 'ema' | 'price' }[]) {
  const priced = rows.filter((r) => r.px !== null && Number.isFinite(r.px)) as { key: string; lab: string; px: number; cls: string }[]
  if (priced.length === 0) return []
  const sorted = [...priced].sort((a, b) => b.px - a.px)
  const max = sorted[0]!.px
  const min = sorted[sorted.length - 1]!.px
  const span = Math.max(max - min, max * 0.001)
  const raw = sorted.map((r) => ({ ...r, top: 12 + ((max - r.px) / span) * 74 }))
  // écart minimal de 16 % entre étiquettes (passe descendante)…
  const GAP = 16
  for (let i = 1; i < raw.length; i++) {
    if (raw[i]!.top - raw[i - 1]!.top < GAP) raw[i]!.top = raw[i - 1]!.top + GAP
  }
  // …qui peut pousser la dernière étiquette HORS du bloc (deux niveaux serrés
  // en bas : vente ~86 % → prix poussé à 102 %, vécu). Borne basse + cascade
  // REMONTANTE en gardant l'écart — 3 étiquettes tiennent toujours (86−2×16 ≥ 12).
  const MAX_TOP = 86
  if (raw[raw.length - 1]!.top > MAX_TOP) {
    raw[raw.length - 1]!.top = MAX_TOP
    for (let i = raw.length - 2; i >= 0; i--) {
      if (raw[i + 1]!.top - raw[i]!.top < GAP) raw[i]!.top = raw[i + 1]!.top - GAP
    }
  }
  return raw
}

/** graduations (traits pleine largeur) — le prix est un CURSEUR fléché rendu à
 *  part, dans le même gabarit w-3 pour que tous les libellés s'alignent */
const TICK_BG: Record<string, string> = { stop: 'bg-down', sell: 'bg-zinc-600', ema: 'bg-accent' }
const LAB: Record<string, string> = { stop: 'text-down', sell: 'text-zinc-500', ema: 'text-accent', price: 'text-info' }

/** Pane de cycle : où en est la machine d'accumulation de ce bot. */
export function CyclePane({ info, price }: { info: BotRuntimeInfo; price: number | null }) {
  const dust = 1e-6
  const st = deriveState(info, dust)
  const unit = baseUnitOf(info)
  const qty = info.position?.qty ?? 0
  const soldPrice = typeof info.strategyState?.['soldPrice'] === 'number' ? (info.strategyState['soldPrice'] as number) : null
  const stopOrder = info.openOrders.find((o) => o.type === 'STOP_MARKET' || o.type === 'STOP_LIMIT')
  const stopPx = stopOrder?.stopPrice ?? (typeof info.strategyState?.['stop'] === 'number' ? (info.strategyState['stop'] as number) : null)

  const latentPct = st.kind.startsWith('sold') && soldPrice !== null && price !== null ? ((soldPrice - price) / soldPrice) * 100 : null

  const levels = railLevels([
    { key: 'stop', lab: 'stop', px: st.kind.startsWith('sold') ? stopPx : null, cls: 'stop' },
    { key: 'sell', lab: 'vente', px: st.kind.startsWith('sold') ? soldPrice : null, cls: 'sell' },
    { key: 'price', lab: 'prix', px: price, cls: 'price' },
  ])

  const phrase = (() => {
    if (st.kind === 'holding')
      return (
        <>
          Position pleine <b>{fmtQty(qty)}</b>. Vend au prochain régime baissier efficient, puis rachète plus bas.
        </>
      )
    if (st.kind === 'sold_armed')
      return (
        <>
          Vendu{soldPrice !== null ? <> à <b>{fmtPrice(soldPrice)}</b></> : null}. Rachète au recroisement de l'EMA50
          {stopPx !== null ? <>, coupe à <b>{fmtPrice(stopPx)}</b></> : null}.
        </>
      )
    if (st.kind === 'sold_waiting') return <>Vendu{soldPrice !== null ? <> à <b>{fmtPrice(soldPrice)}</b></> : null} — attend le recroisement de l'EMA50 pour racheter.</>
    if (st.kind === 'idle') return <>En quote, aucune position — premier rachat au recroisement de l'EMA50 (4 h).</>
    return <>{info.statusReason ?? 'Bot arrêté.'}</>
  })()

  return (
    <div className="card mt-2.5 grid grid-cols-1 sm:grid-cols-[1fr_168px]">
      <div className="pane-title">cycle · {(info.config.name || info.config.strategyId).toLowerCase()}</div>
      <div className="pane-hint">{info.config.mode === 'live' ? 'live' : info.config.mode === 'testnet' ? 'démo' : 'paper'} · 4 h</div>
      <div className="flex flex-col p-5 pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link to={`/bots/${info.config.id}`} className="text-[15px] font-bold tracking-tight text-zinc-100 hover:text-accent">
            {info.config.symbol}
          </Link>
          <span className={`border px-2 py-1 font-mono text-[10.5px] font-bold tracking-[0.1em] ${st.cls}`}>{st.label}</span>
        </div>
        <p className="mt-2.5 max-w-[46ch] text-[13.5px] text-zinc-400 [&_b]:num [&_b]:text-[12.5px] [&_b]:font-medium [&_b]:text-zinc-100">{phrase}</p>
        <div className="mt-auto flex flex-wrap gap-x-7 gap-y-2 pt-4">
          {latentPct !== null && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.1em] text-zinc-600">Gain latent</div>
              <div className={`num mt-0.5 text-[16px] font-medium ${latentPct >= 0 ? 'text-up' : 'text-down'}`}>{fmtNum(latentPct, 2)} %</div>
            </div>
          )}
          <div>
            <div className="text-[10px] uppercase tracking-[0.1em] text-zinc-600">Équité</div>
            <div className="num mt-0.5 text-[16px] font-medium text-zinc-200">{fmtNum(info.equity, 0)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.1em] text-zinc-600">Récolte totale</div>
            <div className={`num mt-0.5 text-[16px] font-medium ${info.realizedPnlTotal >= 0 ? 'text-up' : 'text-down'}`}>
              {unit !== null ? `${info.realizedPnlTotal >= 0 ? '+' : ''}${fmtQty(info.realizedPnlTotal)} ${unit}` : fmtNum(info.realizedPnlTotal)}
            </div>
          </div>
        </div>
      </div>
      {/* rail de niveaux */}
      <div className="relative hidden border-l border-dashed border-edge sm:block">
        <div className="absolute bottom-2 top-2 left-6 w-[2px] bg-[#1a1f2a]" />
        {levels.map((l) => (
          <div key={l.key} className="absolute left-0 right-3 flex -translate-y-1/2 items-center gap-2" style={{ top: `${l.top}%` }}>
            {/* gabarit commun w-3 (libellés alignés). Traits = graduations qui
                TRAVERSENT l'axe symétriquement ; prix = curseur dont la POINTE
                touche le bord gauche de l'axe sans jamais le recouvrir
                (axe : left-6 = 24px ; gabarit 19→31 ; corps 16→24). */}
            <span className="relative ml-[19px] flex w-3 shrink-0 items-center">
              {l.cls === 'price' ? (
                <span className="absolute -left-[3px] top-1/2 h-0 w-0 -translate-y-1/2 border-y-[5px] border-l-[8px] border-y-transparent border-l-info" />
              ) : (
                <span className={`h-[3px] w-full ${TICK_BG[l.cls]}`} />
              )}
            </span>
            <span className={`text-[9.5px] uppercase tracking-[0.09em] ${LAB[l.cls]}`}>{l.lab}</span>
            <span className={`num ml-auto text-[12px] ${l.cls === 'price' ? 'font-semibold text-info' : 'text-zinc-200'}`}>{fmtPrice(l.px)}</span>
          </div>
        ))}
        {levels.length === 0 && <div className="absolute inset-0 flex items-center justify-center text-[11px] text-zinc-600">—</div>}
      </div>
    </div>
  )
}
