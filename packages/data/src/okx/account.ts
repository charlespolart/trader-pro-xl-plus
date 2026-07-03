import type { Balance, MarketType } from '@tpx/shared'
import type { ExchangeInstrument, ExchangePosition } from '../exchange/types'
import { OkxInstruments } from './instruments'
import { OkxApiError, type OkxRest } from './rest'
import { contractsToBase } from './symbols'
import type { OkxInstType, OkxOrderAck, OkxRestOrder } from './types'

interface RawBalanceDetail {
  ccy: string
  availBal: string
  frozenBal: string
}
interface RawPosition {
  instId: string
  pos: string
  avgPx: string
  lever: string
  liqPx: string
  upl: string
}
interface RawTradeFee {
  maker: string
  taker: string
  makerU: string
  takerU: string
  level: string
}

/**
 * Annulation d'un ordre déjà exécuté/annulé/expiré : non-fatal (le strategy
 * runtime fait des cancelAll de routine). Codes 51400/51401/51402 + les
 * libellés « does not exist / already canceled » (couvre aussi les algos).
 */
function isAlreadyGone(e: unknown): boolean {
  return /5140[012]|does not exist|already (?:canceled|cancelled|completed)/i.test(String(e))
}

/** Lecture d'un ordre inconnu d'OKX : « n'existe pas » est une RÉPONSE (l'ordre
 *  n'a jamais été accepté), pas une erreur — à distinguer d'un échec transport
 *  (résultat inconnu) que l'appelant doit propager. 51603 = ordre, 51293 = algo. */
function isNotFound(e: unknown): boolean {
  return /51603|51293|does not exist/i.test(String(e))
}

export class OkxAccount {
  private readonly instruments: OkxInstruments
  constructor(private readonly rest: OkxRest) {
    this.instruments = new OkxInstruments(rest)
  }

  instrument(instId: string): Promise<ExchangeInstrument> {
    const t: OkxInstType = instId.endsWith('-SWAP') ? 'SWAP' : 'SPOT'
    return this.instruments.get(instId, t)
  }

  async balances(_market: MarketType): Promise<Balance[]> {
    const rows = await this.rest.signed<{ details: RawBalanceDetail[] }>('GET', '/api/v5/account/balance')
    const details = rows[0]?.details ?? []
    return details.map((d) => ({
      asset: d.ccy,
      free: Number(d.availBal),
      locked: Number(d.frozenBal),
    }))
  }

  /** All open SWAP positions (no instId filter) — used by the /account endpoint. */
  async allPositions(): Promise<ExchangePosition[]> {
    const rows = await this.rest.signed<RawPosition>('GET', '/api/v5/account/positions', { instType: 'SWAP' })
    const out: ExchangePosition[] = []
    for (const p of rows) {
      const inst = await this.instruments.get(p.instId, 'SWAP')
      out.push({
        instId: p.instId,
        qty: contractsToBase(Number(p.pos), inst.contractSize),
        entryPrice: Number(p.avgPx) || 0,
        leverage: Number(p.lever) || 1,
        liquidationPrice: Number(p.liqPx) || null,
        unrealizedPnl: Number(p.upl) || 0,
      })
    }
    return out
  }

  /** ctVal: the instrument's contractSize (caller passes its cached value). */
  async positions(instId: string, ctVal: number): Promise<ExchangePosition[]> {
    const rows = await this.rest.signed<RawPosition>('GET', '/api/v5/account/positions', {
      instType: 'SWAP',
      instId,
    })
    return rows.map((p) => ({
      instId: p.instId,
      qty: contractsToBase(Number(p.pos), ctVal),
      entryPrice: Number(p.avgPx) || 0,
      leverage: Number(p.lever) || 1,
      liquidationPrice: Number(p.liqPx) || null,
      unrealizedPnl: Number(p.upl) || 0,
    }))
  }

  async tradeFee(
    t: OkxInstType,
    instId: string,
  ): Promise<{ maker: number; taker: number; level: string } | null> {
    try {
      const rows = await this.rest.signed<RawTradeFee>('GET', '/api/v5/account/trade-fee', { instType: t, instId })
      const r = rows[0]
      if (!r) return null
      // OKX rates are negative when charged; backtester wants positive cost.
      const maker = Math.abs(Number(t === 'SWAP' ? r.makerU : r.maker))
      const taker = Math.abs(Number(t === 'SWAP' ? r.takerU : r.taker))
      return { maker, taker, level: r.level }
    } catch {
      return null
    }
  }

  async setLeverage(instId: string, leverage: number, mgnMode: 'isolated' | 'cross'): Promise<void> {
    await this.rest.signed(
      'POST',
      '/api/v5/account/set-leverage',
      {},
      {
        instId,
        lever: String(leverage),
        mgnMode,
      },
    )
  }

  async placeOrder(body: Record<string, unknown>): Promise<OkxOrderAck> {
    const rows = await this.rest.signed<OkxOrderAck>('POST', '/api/v5/trade/order', {}, body)
    return this.checkAck(rows[0])
  }

  async placeAlgoOrder(body: Record<string, unknown>): Promise<OkxOrderAck> {
    const rows = await this.rest.signed<OkxOrderAck>('POST', '/api/v5/trade/order-algo', {}, body)
    return this.checkAck(rows[0])
  }

  async cancelOrder(instId: string, ids: { clOrdId?: string; ordId?: string }): Promise<void> {
    await this.rest.signed('POST', '/api/v5/trade/cancel-order', {}, { instId, ...ids }).catch((e) => {
      if (!isAlreadyGone(e)) throw e
    })
  }

  async cancelAlgoOrder(instId: string, ids: { algoClOrdId?: string; algoId?: string }): Promise<void> {
    await this.rest.signed('POST', '/api/v5/trade/cancel-algos', {}, [{ instId, ...ids }]).catch((e) => {
      if (!isAlreadyGone(e)) throw e
    })
  }

  async openOrders(instId: string): Promise<OkxRestOrder[]> {
    return this.rest.signed<OkxRestOrder>('GET', '/api/v5/trade/orders-pending', { instId })
  }

  async openAlgoOrders(instId: string): Promise<OkxRestOrder[]> {
    return this.rest.signed<OkxRestOrder>('GET', '/api/v5/trade/orders-algo-pending', { instId, ordType: 'trigger' })
  }

  /** État final ou courant d'un ordre par clOrdId — la source REST de vérité
   *  qui manquait au chemin live (adoption après timeout, backfill de fills).
   *  `null` = OKX répond « n'existe pas » (jamais accepté) ; un échec transport
   *  est propagé (résultat inconnu ≠ ordre inexistant). */
  async getOrder(instId: string, ids: { clOrdId?: string; ordId?: string }): Promise<OkxRestOrder | null> {
    try {
      const rows = await this.rest.signed<OkxRestOrder>('GET', '/api/v5/trade/order', { instId, ...ids })
      return rows[0] ?? null
    } catch (e) {
      if (isNotFound(e)) return null
      throw e
    }
  }

  /** Idem pour un ordre algo (trigger). Un algo déclenché a state 'effective'
   *  et porte actualSz/actualPx (l'exécution du stop). */
  async getAlgoOrder(ids: { algoClOrdId?: string; algoId?: string }): Promise<OkxRestOrder | null> {
    try {
      const rows = await this.rest.signed<OkxRestOrder>('GET', '/api/v5/trade/order-algo', { ...ids })
      return rows[0] ?? null
    } catch (e) {
      if (isNotFound(e)) return null
      throw e
    }
  }

  private checkAck(ack: OkxOrderAck | undefined): OkxOrderAck {
    if (!ack) throw new Error('OKX: empty order response')
    // OkxApiError (pas Error nue) : l'appelant doit pouvoir distinguer un REJET
    // métier définitif (OKX a répondu) d'un échec transport (résultat inconnu).
    if (ack.sCode !== '0') throw new OkxApiError(ack.sCode, 200, ack.sMsg || 'order rejected')
    return ack
  }
}
