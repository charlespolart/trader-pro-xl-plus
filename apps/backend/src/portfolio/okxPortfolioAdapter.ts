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
  /** clôture TOTALE de la position détenue : en LIVE, envoyer la taille
   *  réellement détenue (reduce-only), jamais un delta arrondi au lot
   *  (bêtisier PASSATION n°14 : les arrondis laissaient des miettes) */
  closeAll?: boolean
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
 *
 * Deux règles issues de la marche à blanc (PASSATION n°12 / n°14) :
 *  1. HEDGE AU PRORATA — le long BTC (btcWeight) est dimensionné sur les
 *     jambes RÉELLEMENT tenues après exécutabilité (instrument OKX présent,
 *     ≥ minSz), pas sur la cible : c'est la construction validée du backtest
 *     (« BTC = Σ shorts », toutes jambes exécutées). Sans ça, 50 % de jambes
 *     sautées = panier net long de moitié.
 *  2. CLÔTURE TOTALE — une position dont la cible est 0 est fermée EN ENTIER
 *     (notional exact, closeAll), jamais via un delta arrondi au lot qui
 *     laisse 1-9 $ de miette par jambe (en live = micro-positions ouvertes).
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
  const BTC = 'BTC-USDT-SWAP'
  const orders: PlannedOrder[] = []
  const skipped: Array<{ instId: string; why: string }> = []
  const targetsUsd = new Map<string, number>()
  for (const [sym, w] of weights) targetsUsd.set(toOkxInstId(sym), w * sleeveUsd)

  /** planifie UNE jambe ; renvoie le notional signé qui sera TENU après exécution */
  const planLeg = (instId: string, target: number, current: number): number => {
    const inst = instruments.get(instId)
    if (!inst || !Number.isFinite(inst.last) || inst.last <= 0) {
      if (target !== 0 || current !== 0) skipped.push({ instId, why: 'instrument OKX indisponible' })
      return current
    }
    if (target === 0 && current !== 0) {
      // clôture totale : notional EXACT de la position, taille réelle en live
      orders.push({
        instId, side: current > 0 ? 'sell' : 'buy',
        contracts: Number((Math.abs(current) / inst.last / inst.ctVal).toFixed(8)),
        notionalUsd: Math.round(Math.abs(current) * 100) / 100,
        reason: 'clôture', closeAll: true,
      })
      return 0
    }
    const deltaUsd = target - current
    if (Math.abs(deltaUsd) < minTradeUsd) {
      if (current === 0 && target !== 0) skipped.push({ instId, why: `sous minTradeUsd (${Math.abs(target).toFixed(2)} USDT)` })
      return current
    }
    const qtyBase = Math.abs(deltaUsd) / inst.last
    const rawContracts = qtyBase / inst.ctVal
    const contracts = Math.floor(rawContracts / inst.lotSz) * inst.lotSz
    if (contracts < inst.minSz) {
      skipped.push({ instId, why: `sous minSz (${rawContracts.toFixed(4)} < ${inst.minSz})` })
      return current
    }
    const notionalUsd = Math.round(contracts * inst.ctVal * inst.last * 100) / 100
    orders.push({
      instId, side: deltaUsd > 0 ? 'buy' : 'sell',
      contracts: Number(contracts.toFixed(8)), notionalUsd,
      reason: current === 0 ? 'ouverture' : 'ajustement',
    })
    return current + Math.sign(deltaUsd) * notionalUsd
  }

  // ---- 1) jambes hors BTC : l'exécutabilité se décide AVANT le hedge
  let plannedLegsUsd = 0
  let heldLegsUsd = 0
  const legIds = new Set([...targetsUsd.keys(), ...positionsUsd.keys()].filter((id) => id !== BTC))
  for (const instId of legIds) {
    const target = targetsUsd.get(instId) ?? 0
    plannedLegsUsd += Math.abs(target)
    heldLegsUsd += Math.abs(planLeg(instId, target, positionsUsd.get(instId) ?? 0))
  }
  // ---- 2) hedge BTC au prorata des jambes réellement tenues
  const scale = plannedLegsUsd > 0 ? heldLegsUsd / plannedLegsUsd : 0
  const btcTarget = ((targetsUsd.get(BTC) ?? 0) + btcWeight * sleeveUsd) * scale
  const heldBtc = planLeg(BTC, Math.abs(btcTarget) < minTradeUsd ? 0 : btcTarget, positionsUsd.get(BTC) ?? 0)

  orders.sort((a, b) => b.notionalUsd - a.notionalUsd)
  return { orders, skipped, grossTargetUsd: heldLegsUsd + Math.abs(heldBtc) }
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
