/**
 * PortfolioRunner — adaptateur OKX multi-instrument (Phase A, lot A3).
 *
 * SÉCURITÉ : par défaut l'adaptateur est en DRY-RUN — il construit et
 * journalise le plan d'ordres sans RIEN envoyer. L'envoi réel exige
 * l'armement explicite (arm('LIVE')) qui ne sera branché qu'en Phase B/C
 * avec le GO. Marge ISOLÉE par position (décision d'architecture, cf.
 * research/moteur-multi/ETUDE.md et le stress listing2 : borne à −100 %).
 */

export interface OkxInstrument {
  instId: string
  ctVal: number               // taille d'un contrat en base
  lotSz: number               // pas de sz (en contrats)
  minSz: number               // sz minimal (en contrats)
  last: number                // dernier prix (pour le sizing)
}

export interface PlannedOrder {
  instId: string
  side: 'buy' | 'sell'
  contracts: number
  notionalUsd: number
  reason: string
}

export interface RebalancePlan {
  orders: PlannedOrder[]
  skipped: Array<{ instId: string; why: string }>
  grossTargetUsd: number
}

/** symbole Binance (XYZUSDT) → instId OKX linéaire */
export function toOkxInstId(binanceSymbol: string): string {
  return `${binanceSymbol.slice(0, -4)}-USDT-SWAP`
}

/** instruments SWAP publics (sans auth) — instId → specs */
export async function fetchSwapInstruments(): Promise<Map<string, OkxInstrument>> {
  const res = await fetch('https://www.okx.com/api/v5/public/instruments?instType=SWAP')
  const data = (await res.json()) as { data: Array<Record<string, string>> }
  const tickers = await fetch('https://www.okx.com/api/v5/market/tickers?instType=SWAP')
    .then((r) => r.json() as Promise<{ data: Array<Record<string, string>> }>)
  const lastById = new Map(tickers.data.map((t) => [t.instId, Number(t.last)]))
  const out = new Map<string, OkxInstrument>()
  for (const it of data.data) {
    if (!it.instId.endsWith('-USDT-SWAP')) continue
    out.set(it.instId, {
      instId: it.instId,
      ctVal: Number(it.ctVal),
      lotSz: Number(it.lotSz),
      minSz: Number(it.minSz),
      last: lastById.get(it.instId) ?? NaN,
    })
  }
  return out
}

/**
 * Plan de rebalancement PUR : cibles (poids × sleeve) vs positions
 * actuelles (notional USD signé par instId) → ordres en contrats.
 * Un symbole sans instrument OKX est SAUTÉ (compté) — même convention que
 * la validation (couverture 26-55 % selon la stratégie).
 */
export function planRebalance(
  weights: Map<string, number>,           // par symbole Binance, ±fraction de sleeve
  btcWeight: number,
  sleeveUsd: number,
  positionsUsd: Map<string, number>,      // instId → notional signé actuel
  instruments: Map<string, OkxInstrument>,
  minTradeUsd = 15,
): RebalancePlan {
  const orders: PlannedOrder[] = []
  const skipped: Array<{ instId: string; why: string }> = []
  const targetsUsd = new Map<string, number>()
  for (const [sym, w] of weights) targetsUsd.set(toOkxInstId(sym), w * sleeveUsd)
  if (btcWeight !== 0) targetsUsd.set('BTC-USDT-SWAP', (targetsUsd.get('BTC-USDT-SWAP') ?? 0) + btcWeight * sleeveUsd)
  let gross = 0
  for (const v of targetsUsd.values()) gross += Math.abs(v)

  const allIds = new Set([...targetsUsd.keys(), ...positionsUsd.keys()])
  for (const instId of allIds) {
    const target = targetsUsd.get(instId) ?? 0
    const current = positionsUsd.get(instId) ?? 0
    const inst = instruments.get(instId)
    if (!inst || !Number.isFinite(inst.last) || inst.last <= 0) {
      if (target !== 0) skipped.push({ instId, why: 'instrument OKX indisponible' })
      continue
    }
    const deltaUsd = target - current
    if (Math.abs(deltaUsd) < minTradeUsd) continue
    const qtyBase = Math.abs(deltaUsd) / inst.last
    const rawContracts = qtyBase / inst.ctVal
    const contracts = Math.floor(rawContracts / inst.lotSz) * inst.lotSz
    if (contracts < inst.minSz) {
      skipped.push({ instId, why: `sous minSz (${rawContracts.toFixed(4)} < ${inst.minSz})` })
      continue
    }
    orders.push({
      instId,
      side: deltaUsd > 0 ? 'buy' : 'sell',
      contracts: Number(contracts.toFixed(8)),
      notionalUsd: Math.round(contracts * inst.ctVal * inst.last * 100) / 100,
      reason: current === 0 ? 'ouverture' : target === 0 ? 'clôture' : 'ajustement',
    })
  }
  orders.sort((a, b) => b.notionalUsd - a.notionalUsd)
  return { orders, skipped, grossTargetUsd: gross }
}

export class OkxPortfolioAdapter {
  private armed: 'DRY' | 'LIVE' = 'DRY'

  /** l'armement LIVE ne sera appelé qu'en Phase B/C, jamais par défaut */
  arm(mode: 'DRY' | 'LIVE'): void {
    this.armed = mode
  }

  /** exécute (ou journalise) un plan ; en DRY, aucun réseau privé n'est touché */
  async execute(plan: RebalancePlan, log: (msg: string) => void): Promise<void> {
    log(`plan : ${plan.orders.length} ordres, ${plan.skipped.length} sautés, brut cible ${plan.grossTargetUsd.toFixed(0)} USDT [${this.armed}]`)
    for (const o of plan.orders) {
      log(`  ${o.side.toUpperCase().padEnd(4)} ${o.instId.padEnd(20)} ${String(o.contracts).padStart(12)} ct ≈ ${o.notionalUsd.toFixed(2).padStart(10)} USDT (${o.reason})`)
    }
    for (const s of plan.skipped.slice(0, 8)) log(`  SKIP ${s.instId} — ${s.why}`)
    if (this.armed === 'LIVE') {
      throw new Error('LIVE non implémenté en Phase A (volontaire) — l\'envoi réel arrive en Phase B avec le GO')
    }
  }
}
