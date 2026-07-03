import {
  isTriggerOrder,
  type Balance,
  type Fill,
  type MarketType,
  type Order,
  type OrderRequest,
  type OrderType,
  type Position,
  type SymbolInfo,
} from '@tpx/shared'
import type { ExecutionAdapter } from '@tpx/core'
import {
  OkxApiError,
  buildAlgoBody,
  buildOrderBody,
  clOrdPrefix,
  contractsToBase,
  makeClOrdId,
  mapOkxState,
  mapOrdType,
  parseFill,
  toInstId,
  type FillDelta,
  type OkxAccount,
  type OkxOrderEvent,
  type OkxPrivateEvent,
  type OkxPrivateStream,
  type OkxRestOrder,
} from '@tpx/data'

export interface LiveAdapterEvents {
  onFill(fill: Fill, order: Order): void
  onOrderUpdate(order: Order): void
}

export interface LiveAdapterOptions {
  market: MarketType
  demo: boolean
  symbol: string
  symbolInfo: SymbolInfo
  botId: string
  allocation: number
  leverage: number
  account: OkxAccount
  events: LiveAdapterEvents
  /** délai avant la sonde getOrder quand l'issue d'un place est inconnue (tests: 0) */
  probeDelayMs?: number
}

/** A resting order known to the bot (from the DB), passed to reconcile() to
 *  catch up on any fill that happened while the bot was down. */
export interface RestingOrderRef {
  clientId: string
  side: 'BUY' | 'SELL'
  /** order type as persisted — tells reconcile whether to look it up as an algo */
  type: OrderType
  /** executed quantity last persisted by the bot (base units) */
  executedQty: number
  /** cumulative quote last known to the bot */
  cumQuote: number
}

/**
 * Real-money / demo execution adapter for OKX. The bot owns a virtual slice of
 * the account: position, realized pnl, fees and quote ledger are tracked from
 * the private `orders` channel events attributed via the clOrdId prefix, with a
 * REST catch-up (getOrder) at reconcile for anything missed while down. OCO
 * groups are emulated (first leg to fill cancels its siblings).
 *
 * Note: live futures funding is settled in the wallet by OKX but not attributed
 * per-bot here; bot equity slightly understates/overstates by the funding
 * amount until the position closes (visible account-wide in the Account page).
 */
export class OKXLiveAdapter implements ExecutionAdapter {
  readonly market: MarketType
  readonly symbol: string

  private readonly o: LiveAdapterOptions
  private readonly prefix: string
  private readonly instId: string
  private readonly ctVal: number
  private readonly lotSz: number
  private readonly orders = new Map<string, Order>() // by clOrdId
  /** composant temporel des clOrdId : unique par process, survit à un seq perdu */
  private readonly bootMs = Date.now()
  /** tradeIds OKX déjà appliqués — garde contre une double livraison WS */
  private readonly seenTradeIds = new Set<string>()
  private seq = 0
  private lastPriceV = 0
  private posQty = 0
  private posEntry = 0
  private realizedNet = 0
  /** tranche de quote du bot (spot) : débitée aux achats, créditée aux ventes.
   *  C'est la source de balances() — dérivée de l'état du bot comme SimExchange,
   *  donc synchrone avec les fills et bornée par l'allocation (jamais le compte
   *  entier, jamais un cache pollé en retard d'un fill). */
  private quoteLedger: number

  constructor(opts: LiveAdapterOptions) {
    this.o = opts
    this.market = opts.market
    this.symbol = opts.symbol
    this.prefix = clOrdPrefix(opts.botId)
    this.instId = toInstId(opts.symbolInfo.baseAsset, opts.symbolInfo.quoteAsset, opts.market)
    this.ctVal = opts.symbolInfo.contractSize ?? 1
    // symbolInfo.stepSize est en unités BASE (le botManager convertit lotSz×ctVal
    // pour les SWAP) ; les builders d'ordres OKX veulent le pas en CONTRATS.
    this.lotSz = opts.symbolInfo.stepSize / this.ctVal
    this.quoteLedger = opts.allocation
  }

  // ----------------------------------------------------------- lifecycle

  get clientIdPrefix(): string {
    return this.prefix
  }

  setLastPrice(p: number): void {
    this.lastPriceV = p
  }

  snapshot(): { posQty: number; posEntry: number; realizedNet: number; seq: number; quoteLedger: number } {
    return {
      posQty: this.posQty,
      posEntry: this.posEntry,
      realizedNet: this.realizedNet,
      seq: this.seq,
      quoteLedger: this.quoteLedger,
    }
  }

  restore(s: { posQty?: number; posEntry?: number; realizedNet?: number; seq?: number; quoteLedger?: number }): void {
    this.posQty = s.posQty ?? 0
    this.posEntry = s.posEntry ?? 0
    this.realizedNet = s.realizedNet ?? 0
    this.seq = Math.max(this.seq, s.seq ?? 0)
    // Migration des snapshots d'avant le ledger : équité = ledger + posQty×prix
    // et équité = allocation + realizedNet + uPnl ⇒ ledger = alloc + realized − posQty×entry.
    this.quoteLedger =
      s.quoteLedger ?? Math.max(0, this.o.allocation + this.realizedNet - this.posQty * this.posEntry)
  }

  /**
   * Re-adopt resting orders after a restart and catch up on fills missed while
   * the bot was down.
   * - Still-open orders (regular AND resting algo/stop — OKX keeps those in a
   *   separate pending list): re-adopted, and any partial fill that happened
   *   while down is replayed from the REST accFillSz delta.
   * - Known resting orders that are NO LONGER open: read their final state via
   *   getOrder/getAlgoOrder and replay the missed execution (spec §14) — this
   *   covers « le stop s'est déclenché pendant le down » (sinon double rachat).
   * - Futures: the exchange position remains the last-resort ground truth.
   * - Spot: the quote ledger is clamped to the real account balance (anti-drift).
   * Every step is guarded: an API error becomes a note and never blocks startup.
   */
  async reconcile(resting: RestingOrderRef[] = []): Promise<string[]> {
    const notes: string[] = []
    const stillOpen = new Set<string>()
    const refByCid = new Map(resting.map((r) => [r.clientId, r]))

    const guard = async (label: string, fn: () => Promise<void>): Promise<void> => {
      try {
        await fn()
      } catch (e) {
        notes.push(`${label} en erreur (ignorée): ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    const adoptOpen = (r: OkxRestOrder, cid: string): void => {
      const order = this.mapRawOrder(r, cid)
      const ref = refByCid.get(cid)
      if (ref) {
        // rejouer un éventuel fill partiel survenu pendant l'arrêt
        order.executedQty = ref.executedQty
        const n = this.syncFromRest(order, r)
        if (n) notes.push(n)
        this.o.events.onOrderUpdate(order)
      }
      this.orders.set(cid, order)
      stillOpen.add(cid)
      notes.push(`re-adopted open order ${cid} (${order.type} ${order.side})`)
    }

    // `openOrders` only returns regular (non-algo) orders.
    await guard('openOrders', async () => {
      for (const r of await this.o.account.openOrders(this.instId)) {
        const cid = r.clOrdId ?? ''
        if (cid.startsWith(this.prefix)) adoptOpen(r, cid)
      }
    })
    // Resting ALGO (stop/TP) orders live in a separate OKX pending list. Re-adopt
    // them so a stop firing after a restart is attributed instead of dropped.
    await guard('openAlgoOrders', async () => {
      for (const r of await this.o.account.openAlgoOrders(this.instId)) {
        const cid = r.algoClOrdId ?? r.clOrdId ?? ''
        if (cid.startsWith(this.prefix)) adoptOpen(r, cid)
      }
    })

    // ---- rattrapage des ordres au repos qui ne sont PLUS ouverts (spec §14) :
    // lire leur état final et rejouer l'exécution manquée en fill synthétique.
    for (const ro of resting) {
      if (stillOpen.has(ro.clientId)) continue
      await guard(`backfill ${ro.clientId}`, async () => {
        const raw = isTriggerOrder(ro.type)
          ? await this.o.account.getAlgoOrder({ algoClOrdId: ro.clientId })
          : await this.o.account.getOrder(this.instId, { clOrdId: ro.clientId })
        if (!raw) {
          // OKX ne le connaît pas : il n'a jamais été accepté (ou purgé) —
          // sortir l'ordre de l'état « au repos » pour ne pas re-tenter à chaque boot.
          notes.push(`ordre ${ro.clientId} introuvable sur OKX — marqué REJECTED`)
          this.o.events.onOrderUpdate(this.shellOrder(ro, 'REJECTED'))
          return
        }
        const order = this.mapRawOrder(raw, ro.clientId)
        order.executedQty = ro.executedQty
        this.orders.set(ro.clientId, order)
        const n = this.syncFromRest(order, raw)
        if (n) notes.push(n)
        // persiste le statut final : l'ordre sort du set « resting » en DB
        this.o.events.onOrderUpdate(order)
      })
    }

    if (this.market === 'futures') {
      await guard('positions', async () => {
        const positions = await this.o.account.positions(this.instId, this.ctVal)
        const p = positions.find((x) => x.instId === this.instId)
        const exchangeQty = p?.qty ?? 0
        if (Math.abs(exchangeQty - this.posQty) > this.o.symbolInfo.stepSize / 2) {
          notes.push(
            `position mismatch: exchange ${exchangeQty}, bot state ${this.posQty} — adopting exchange value`,
          )
          this.posQty = exchangeQty
          this.posEntry = p?.entryPrice ?? this.posEntry
        }
      })
      return notes
    }

    // ---- SPOT : clamp anti-dérive — la tranche du bot ne peut pas excéder le
    // solde libre réel du compte (retrait utilisateur, fills non attribués…).
    await guard('balances', async () => {
      const bals = await this.o.account.balances('spot')
      const real = bals.find((b) => b.asset === this.o.symbolInfo.quoteAsset)
      if (real && real.free < this.quoteLedger) {
        const drift = this.quoteLedger - real.free
        if (this.quoteLedger > 0 && drift / this.quoteLedger > 0.01) {
          notes.push(
            `quoteLedger ${this.quoteLedger.toFixed(2)} > solde réel ${real.free.toFixed(2)} ` +
              `(écart ${((100 * drift) / this.quoteLedger).toFixed(1)}%) — clampé sur le solde réel`,
          )
        }
        this.quoteLedger = Math.max(0, real.free)
      }
    })
    return notes
  }

  // ----------------------------------------------------- ExecutionAdapter

  now(): number {
    return Date.now()
  }

  lastPrice(): number {
    return this.lastPriceV
  }

  symbolInfo(): SymbolInfo | null {
    return this.o.symbolInfo
  }

  async submit(req: OrderRequest): Promise<Order> {
    const clOrdId = makeClOrdId(this.prefix, ++this.seq, this.bootMs)
    const { algo } = mapOrdType(req.type, this.market)
    const args = {
      instId: this.instId,
      market: this.market,
      req,
      clOrdId,
      ctVal: this.ctVal,
      lotSz: this.lotSz,
      refPrice: this.lastPriceV,
    }
    const body = algo ? buildAlgoBody(args) : buildOrderBody(args)

    const order: Order = {
      id: clOrdId,
      clientId: clOrdId,
      botId: this.o.botId,
      market: this.market,
      symbol: this.symbol,
      side: req.side,
      type: req.type,
      status: isTriggerOrder(req.type) ? 'TRIGGER_PENDING' : 'NEW',
      qty: this.baseQty(req),
      executedQty: 0,
      cumQuote: 0,
      price: req.price,
      stopPrice: req.stopPrice,
      timeInForce: req.timeInForce ?? 'GTC',
      reduceOnly: req.reduceOnly ?? false,
      ocoGroup: req.ocoGroup,
      reason: req.reason,
      tag: req.tag,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    // map AVANT le REST : un push WS `filled` plus rapide que l'ack doit trouver
    // l'ordre (sinon le fill est jeté). Les fills sont idempotents par tradeId.
    this.orders.set(clOrdId, order)
    try {
      const ack = algo ? await this.o.account.placeAlgoOrder(body) : await this.o.account.placeOrder(body)
      if (!order.exchangeOrderId) order.exchangeOrderId = ack.ordId || ack.algoId
      order.updatedAt = Date.now()
    } catch (err) {
      // OKX a RÉPONDU non (code métier) → rejet définitif. Tout le reste
      // (timeout, réseau, 502 non-JSON = code '-1') laisse l'issue inconnue.
      const definitiveReject = err instanceof OkxApiError && err.code !== '-1'
      if (!definitiveReject) {
        const probe = await this.probeUnknownOutcome(order, algo)
        if (probe === 'adopted' && order.status !== 'REJECTED') {
          // l'ordre existe bel et bien côté OKX : adopté, submit RÉUSSIT
          this.o.events.onOrderUpdate(order)
          return order
        }
        if (probe === 'unknown') {
          // toujours inconnu : l'ordre reste dans la map et part en DB (NEW) —
          // un push WS l'attribuera, sinon le backfill du prochain reconcile.
          this.o.events.onOrderUpdate(order)
          throw new Error(
            `place ${order.side} ${order.type} ${this.symbol}: issue inconnue ` +
              `(${err instanceof Error ? err.message : String(err)}) — ordre ${clOrdId} conservé pour rattrapage`,
          )
        }
        // probe === 'absent' : OKX ne le connaît pas → rejet avéré
      }
      if (order.status === 'NEW' || order.status === 'TRIGGER_PENDING') {
        order.status = 'REJECTED'
        order.updatedAt = Date.now()
      }
      this.o.events.onOrderUpdate(order)
      throw err
    }
    this.o.events.onOrderUpdate(order)
    return order
  }

  /** L'issue d'un place REST est inconnue : demander à OKX si l'ordre existe.
   *  'adopted' = trouvé (état + fills manqués rejoués), 'absent' = OKX répond
   *  qu'il n'existe pas (jamais accepté), 'unknown' = la sonde a aussi échoué. */
  private async probeUnknownOutcome(order: Order, algo: boolean): Promise<'adopted' | 'absent' | 'unknown'> {
    await new Promise((r) => setTimeout(r, this.o.probeDelayMs ?? 1_500))
    try {
      const raw = algo
        ? await this.o.account.getAlgoOrder({ algoClOrdId: order.clientId })
        : await this.o.account.getOrder(this.instId, { clOrdId: order.clientId })
      if (!raw) return 'absent'
      this.syncFromRest(order, raw)
      return 'adopted'
    } catch {
      return 'unknown'
    }
  }

  async cancel(orderId: string): Promise<Order | null> {
    const order = this.orders.get(orderId)
    if (!order) return null
    if (isTriggerOrder(order.type)) {
      await this.o.account.cancelAlgoOrder(this.instId, { algoClOrdId: order.clientId })
    } else {
      await this.o.account.cancelOrder(this.instId, { clOrdId: order.clientId })
    }
    // Le canal WS `orders-algo` n'est PAS souscrit (il vit sur /business) : un
    // algo annulé n'émettra AUCUN événement. Sans marquage local il resterait
    // TRIGGER_PENDING pour toujours → openOrders() le renvoie → le cancelAll du
    // cycle suivant retente d'annuler un ordre inexistant. On confirme donc
    // localement après un cancel REST réussi (les ordres normaux, eux, seront
    // aussi confirmés par leur push WS `canceled` — idempotent).
    if (order.status === 'NEW' || order.status === 'TRIGGER_PENDING' || order.status === 'PARTIALLY_FILLED') {
      order.status = 'CANCELED'
      order.updatedAt = Date.now()
      this.o.events.onOrderUpdate(order)
    }
    return order
  }

  openOrders(): readonly Order[] {
    return [...this.orders.values()].filter(
      (o) => o.status === 'NEW' || o.status === 'TRIGGER_PENDING' || o.status === 'PARTIALLY_FILLED',
    )
  }

  position(): Position {
    return {
      market: this.market,
      symbol: this.symbol,
      qty: this.posQty,
      entryPrice: this.posEntry,
      leverage: this.o.leverage,
      liquidationPrice: null,
      unrealizedPnl: this.posQty === 0 ? 0 : (this.lastPriceV - this.posEntry) * this.posQty,
      updatedAt: Date.now(),
    }
  }

  /** Balances BOT-SCOPÉES, dérivées de l'état du bot (parité SimExchange) :
   *  synchrones avec les fills (le onFill de la stratégie voit le quote d'une
   *  vente immédiatement) et bornées par l'allocation. Le solde réel du compte
   *  ne sert qu'au clamp anti-dérive du reconcile (et à la page Account). */
  balances(): readonly Balance[] {
    const si = this.o.symbolInfo
    if (this.market === 'spot') {
      return [
        { asset: si.quoteAsset, free: Math.max(0, this.quoteLedger), locked: 0 },
        { asset: si.baseAsset, free: this.posQty, locked: 0 },
      ]
    }
    // futures : marge disponible de la tranche (miroir de SimExchange wallet − usedMargin)
    const margin = this.posQty === 0 ? 0 : (Math.abs(this.posQty) * this.posEntry) / Math.max(1, this.o.leverage)
    return [{ asset: si.quoteAsset, free: Math.max(0, this.o.allocation + this.realizedNet - margin), locked: margin }]
  }

  equity(): number {
    const uPnl = this.posQty === 0 ? 0 : (this.lastPriceV - this.posEntry) * this.posQty
    return this.o.allocation + this.realizedNet + uPnl
  }

  // -------------------------------------------------- private channel routing

  /**
   * private `orders` channel push (one per fill or state change).
   *
   * RESIDUAL RISK (confirm in demo — spec §14): when an algo (stop/TP) order
   * TRIGGERS, OKX places a NEW regular order to do the actual fill. We rely on
   * that regular order carrying our `clOrdId` prefix on the `orders` channel so
   * the fill is attributed here. If OKX instead assigns a fresh clOrdId without
   * our prefix, a triggered-stop fill would early-return below and be dropped —
   * the reconcile backfill (getAlgoOrder → actualSz) is the safety net.
   */
  handleOrderEvent(ev: OkxOrderEvent): void {
    const order = this.orders.get(ev.clOrdId)
    if (!order) return
    const prevExecuted = order.executedQty
    order.status = mapOkxState(ev.state, order.type, prevExecuted)
    // accFillSz is in CONTRACTS on futures but order.qty is in BASE; convert to
    // keep both consistent. Spot accFillSz is already in base coin units.
    const evAccFill =
      this.market === 'futures'
        ? contractsToBase(Number(ev.accFillSz ?? 0), this.ctVal)
        : Number(ev.accFillSz ?? prevExecuted)
    order.executedQty = Math.max(prevExecuted, evAccFill)
    order.updatedAt = Date.now()

    let d = parseFill(ev, this.market, this.ctVal)
    // Idempotence : un fill déjà appliqué (tradeId vu, ou accFillSz qui ne
    // progresse pas vs l'état connu — cas du recouvrement avec un rattrapage
    // REST) n'est PAS rejoué dans la comptabilité.
    if (d && d.tradeId && this.seenTradeIds.has(d.tradeId)) d = null
    if (d && ev.accFillSz !== undefined && evAccFill <= prevExecuted + this.o.symbolInfo.stepSize / 10) d = null
    if (d) {
      if (d.tradeId) this.rememberTradeId(d.tradeId)
      if (this.market === 'spot') this.applySpotFill(order, d)
      else this.applyFuturesFill(order, d)
    }
    this.o.events.onOrderUpdate(order)
    if (d) void this.cancelOcoSiblings(order)
  }

  // ------------------------------------------------------------ internals

  private rememberTradeId(id: string): void {
    this.seenTradeIds.add(id)
    if (this.seenTradeIds.size > 2000) {
      const oldest = this.seenTradeIds.values().next().value
      if (oldest !== undefined) this.seenTradeIds.delete(oldest)
    }
  }

  /** base asset quantity implied by the request (display/bookkeeping). */
  private baseQty(req: OrderRequest): number {
    if (req.qty !== undefined) return req.qty
    if (req.quoteQty !== undefined && this.lastPriceV > 0) return req.quoteQty / this.lastPriceV
    return 0
  }

  /** Ordre minimal pour émettre un statut final sur un ordre que l'adapter ne
   *  connaît plus (backfill d'un clOrdId introuvable sur OKX). */
  private shellOrder(ro: RestingOrderRef, status: Order['status']): Order {
    return {
      id: ro.clientId,
      clientId: ro.clientId,
      botId: this.o.botId,
      market: this.market,
      symbol: this.symbol,
      side: ro.side,
      type: ro.type,
      status,
      qty: ro.executedQty,
      executedQty: ro.executedQty,
      cumQuote: ro.cumQuote,
      timeInForce: 'GTC',
      reduceOnly: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  }

  /** Re-adopt a resting order returned by `orders-pending` / `orders-algo-pending`.
   *  Builds a faithful `Order` from the REST shape. For algo (trigger) orders the
   *  stop-vs-TP subtype is best-effort — the point is that the order is PRESENT
   *  (status TRIGGER_PENDING) so its later fill is attributed. `ocoGroup` cannot
   *  be recovered from OKX (the Binance template couldn't either — that's parity). */
  private mapRawOrder(r: OkxRestOrder, clOrdId: string): Order {
    const type = mapRestOrdType(r)
    const toBase = (s: string | undefined) =>
      this.market === 'futures' ? contractsToBase(Number(s ?? 0), this.ctVal) : Number(s ?? 0)
    const executedQty = toBase(r.accFillSz)
    const order: Order = {
      id: clOrdId,
      clientId: clOrdId,
      botId: this.o.botId,
      market: this.market,
      symbol: this.symbol,
      side: r.side === 'sell' ? 'SELL' : 'BUY',
      type,
      status: mapOkxState(r.state, type, executedQty),
      qty: toBase(r.sz),
      executedQty,
      cumQuote: 0,
      price: r.px !== undefined && Number(r.px) > 0 ? Number(r.px) : undefined,
      stopPrice: r.triggerPx !== undefined && Number(r.triggerPx) > 0 ? Number(r.triggerPx) : undefined,
      timeInForce: 'GTC',
      reduceOnly: false,
      exchangeOrderId: r.ordId ?? r.algoId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    return order
  }

  /**
   * Aligne un ordre local sur sa lecture REST et REJOUE l'exécution manquée
   * (delta entre l'accFillSz/actualSz d'OKX et l'executedQty connu du bot) en
   * fill synthétique — prix = avgPx/actualPx, fee cumulé réparti pro rata.
   * Idempotent : si le WS a déjà tout livré, le delta est nul. Retourne une
   * note de log si un rattrapage a eu lieu.
   */
  private syncFromRest(order: Order, raw: OkxRestOrder): string | null {
    const isAlgo = isTriggerOrder(order.type)
    if (!order.exchangeOrderId) order.exchangeOrderId = raw.ordId ?? raw.algoId
    // algo déclenché : 'effective' = le stop a exécuté actualSz à actualPx
    const filledRaw = isAlgo ? Number(raw.actualSz ?? raw.accFillSz ?? 0) : Number(raw.accFillSz ?? 0)
    const filledBase = this.market === 'futures' ? contractsToBase(filledRaw, this.ctVal) : filledRaw
    const px = Number((isAlgo ? (raw.actualPx ?? raw.avgPx) : raw.avgPx) ?? 0)
    const missed = filledBase - order.executedQty
    let note: string | null = null
    if (missed > this.o.symbolInfo.stepSize / 10 && px > 0) {
      const prevExecuted = order.executedQty
      // fee/pnl cumulés répartis pro rata du delta (REST ne détaille pas par trade)
      const feeTotal = Math.abs(Number(raw.fee ?? 0))
      const pnlTotal = Number(raw.pnl ?? 0)
      const share = filledBase > 0 ? missed / filledBase : 0
      order.executedQty = filledBase
      const d: FillDelta = {
        lastQty: missed,
        price: px,
        fee: feeTotal * share,
        feeCcy: raw.feeCcy ?? '',
        pnl: pnlTotal * share,
        time: Date.now(),
        maker: false,
        tradeId: '',
      }
      // id déterministe (indépendant du boot) : un double reconcile ne crée pas
      // de doublon en DB (onConflictDoNothing)
      const syntheticId = `${order.clientId}-bf${prevExecuted}-${filledBase}`
      if (this.market === 'spot') this.applySpotFill(order, d, syntheticId)
      else this.applyFuturesFill(order, d, syntheticId)
      note = `rattrapage fill manqué: ${order.side} ${missed} @ ${px} (${order.clientId})`
    } else if (filledBase > order.executedQty) {
      order.executedQty = filledBase
    }
    order.status = mapOkxState(raw.state, order.type, order.executedQty)
    order.updatedAt = Date.now()
    return note
  }

  /** Normalize a fee charged in `ccy` to quote currency (BNB no longer exists
   *  on OKX, so this is synchronous). */
  private feeToQuote(amount: number, ccy: string, price: number): number {
    if (amount === 0) return 0
    if (ccy === this.o.symbolInfo.quoteAsset || ccy === 'USDT') return amount
    if (ccy === this.o.symbolInfo.baseAsset) return amount * price
    return 0
  }

  private applySpotFill(order: Order, d: FillDelta, syntheticId?: string): void {
    const { lastQty: qty, price, fee: feeAmt, feeCcy } = d
    const feeQuote = this.feeToQuote(feeAmt, feeCcy, price)
    if (order.side === 'BUY') {
      const feeInBase = feeCcy === this.o.symbolInfo.baseAsset
      const received = feeInBase ? qty - feeAmt : qty
      const newQty = this.posQty + received
      this.posEntry = newQty > 0 ? (this.posEntry * this.posQty + price * qty) / newQty : 0
      this.posQty = newQty
      // ne PAS re-soustraire le fee si déjà rogné sur la base reçue (sinon
      // double comptage dans equity() : une fois via received, une fois ici)
      if (!feeInBase) this.realizedNet -= feeQuote
      // achat : le quote paie le coût, plus le fee s'il est facturé en quote
      this.quoteLedger -= qty * price + (feeInBase ? 0 : feeQuote)
    } else {
      const gross = (price - this.posEntry) * qty
      this.realizedNet += gross - feeQuote
      this.posQty = Math.max(0, this.posQty - qty)
      if (this.posQty === 0) this.posEntry = 0
      // vente : le quote encaisse le produit net du fee
      this.quoteLedger += qty * price - feeQuote
    }
    this.lastPriceV = price
    this.emitFill(order, d, feeQuote, syntheticId)
  }

  private applyFuturesFill(order: Order, d: FillDelta, syntheticId?: string): void {
    const { lastQty: qty, price, fee: feeAmt, feeCcy, pnl: realized } = d
    const feeQuote = this.feeToQuote(feeAmt, feeCcy, price)
    const signed = order.side === 'BUY' ? qty : -qty
    const sameDir = this.posQty === 0 || Math.sign(signed) === Math.sign(this.posQty)
    if (sameDir) {
      const newQty = this.posQty + signed
      this.posEntry =
        newQty !== 0 ? (this.posEntry * Math.abs(this.posQty) + price * qty) / Math.abs(newQty) : 0
      this.posQty = newQty
    } else {
      const prevSign = Math.sign(this.posQty)
      this.posQty += signed
      if (Math.abs(this.posQty) < this.o.symbolInfo.stepSize / 10) {
        this.posQty = 0
        this.posEntry = 0
      } else if (Math.sign(this.posQty) !== prevSign) {
        this.posEntry = price
      }
    }
    this.realizedNet += realized - feeQuote
    this.lastPriceV = price
    this.emitFill(order, d, feeQuote, syntheticId)
  }

  private emitFill(order: Order, d: FillDelta, feeQuote: number, syntheticId?: string): void {
    const fill: Fill = {
      // tradeId OKX = clé de dédup sûre ; les fills synthétiques (backfill)
      // portent un id déterministe fourni par l'appelant
      id: d.tradeId
        ? `${order.clientId}-t${d.tradeId}`
        : (syntheticId ?? `${order.clientId}-${d.time}-${d.lastQty}`),
      orderId: order.id,
      botId: this.o.botId,
      market: this.market,
      symbol: this.symbol,
      side: order.side,
      price: d.price,
      qty: d.lastQty,
      quoteQty: d.lastQty * d.price,
      fee: feeQuote,
      // le montant est CONVERTI en quote par feeToQuote — l'asset doit suivre
      feeAsset: this.o.symbolInfo.quoteAsset,
      maker: d.maker,
      time: d.time,
      tag: order.tag,
      reason: order.reason,
    }
    this.o.events.onFill(fill, order)
  }

  private async cancelOcoSiblings(order: Order): Promise<void> {
    if (!order.ocoGroup) return
    for (const sib of this.orders.values()) {
      if (sib.id === order.id || sib.ocoGroup !== order.ocoGroup) continue
      if (sib.status === 'NEW' || sib.status === 'TRIGGER_PENDING' || sib.status === 'PARTIALLY_FILLED') {
        await this.cancel(sib.id).catch(() => {})
      }
    }
  }
}

/** Map an OKX REST `ordType` to a TPX OrderType. For `trigger`, a real `px`
 *  (limit price) means a stop/TP-limit; otherwise it is a stop/TP-market.
 *  The stop-vs-TP distinction cannot be recovered from OKX, so STOP_* is used. */
function mapRestOrdType(r: OkxRestOrder): OrderType {
  switch (r.ordType) {
    case 'market':
      return 'MARKET'
    case 'post_only':
      return 'LIMIT_MAKER'
    case 'trigger':
      return r.px !== undefined && Number(r.px) > 0 ? 'STOP_LIMIT' : 'STOP_MARKET'
    default:
      return 'LIMIT'
  }
}

/**
 * Fans out a single OKX private socket to the live adapters of one account.
 * One router per account (OKX unified account carries spot + swap), so every
 * bot on that account shares the socket. Only `orders` / `orders-algo` channels
 * are routed; each event is delivered to the adapter whose `clientIdPrefix` is a
 * prefix of the order's `clOrdId` (or `algoClOrdId` for algo orders).
 */
export class OkxUserStreamRouter {
  private adapters = new Map<string, OKXLiveAdapter>()

  constructor(
    private readonly stream: OkxPrivateStream | null,
    private readonly onError: (e: Error) => void,
  ) {
    this.stream?.onEvent((ev) => this.dispatch(ev))
  }

  async start(): Promise<void> {
    await this.stream?.start()
  }
  stop(): void {
    this.stream?.stop()
  }
  register(a: OKXLiveAdapter): void {
    this.adapters.set(a.clientIdPrefix, a)
  }
  unregister(a: OKXLiveAdapter): void {
    this.adapters.delete(a.clientIdPrefix)
  }
  get size(): number {
    return this.adapters.size
  }

  dispatch(ev: OkxPrivateEvent): void {
    if (ev.channel !== 'orders' && ev.channel !== 'orders-algo') return
    try {
      for (const o of ev.data) {
        const cid = o.clOrdId || (o as { algoClOrdId?: string }).algoClOrdId || ''
        const adapter = this.find(cid)
        adapter?.handleOrderEvent(o)
      }
    } catch (err) {
      this.onError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  private find(clientId: string): OKXLiveAdapter | undefined {
    for (const [prefix, a] of this.adapters) if (clientId.startsWith(prefix)) return a
    return undefined
  }
}
