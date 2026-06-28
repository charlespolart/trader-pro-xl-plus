import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import {
  bots as botsTable,
  botState as botStateTable,
  fills as fillsTable,
  orders as ordersTable,
  trades as tradesTable,
  type Db,
} from '@tpx/db'
import {
  DEFAULT_FEES,
  INTERVAL_MS,
  utcDayKey,
  validateParams,
  type Balance,
  type BotConfig,
  type BotRuntimeInfo,
  type BotStatus,
  type Candle,
  type ChartAnnotation,
  type Fill,
  type GlobalRiskConfig,
  type LogEntry,
  type MarketType,
  type Order,
  type OrderRequest,
  type SymbolInfo,
  type TradeRecord,
} from '@tpx/shared'
import { SimExchange, StrategyRuntime, TradeBuilder, type ExecutionAdapter } from '@tpx/core'
import {
  BinanceMarketData,
  BinanceRest,
  CandleStore,
  OkxAccount,
  OkxPrivateStream,
  OkxRest,
  toInstId,
  type OkxCredentials,
} from '@tpx/data'
import { hub } from '../wsHub'
import { registry } from '../strategies'
import { liveFeeds } from './liveFeeds'
import { OKXLiveAdapter, OkxUserStreamRouter, type RestingOrderRef } from './okxLiveAdapter'
import { sendTelegram } from './telegram'
import type { CredentialsService } from './credentials'
import type { SettingsService } from './settings'

const ADAPTER_STATE_KEY = '__adapter'
const RING = 500

/** blocks position-increasing orders when a risk rule is violated */
class RiskGuardedAdapter implements ExecutionAdapter {
  constructor(
    private readonly inner: ExecutionAdapter,
    private readonly check: (req: OrderRequest) => string | null,
  ) {}

  get market() {
    return this.inner.market
  }
  get symbol() {
    return this.inner.symbol
  }
  now() {
    return this.inner.now()
  }
  lastPrice() {
    return this.inner.lastPrice()
  }
  submit(req: OrderRequest): Promise<Order> {
    const block = this.check(req)
    if (block !== null && req.reduceOnly !== true) {
      return Promise.reject(new Error(`Ordre bloqué (risk management): ${block}`))
    }
    return this.inner.submit(req)
  }
  cancel(orderId: string) {
    return this.inner.cancel(orderId)
  }
  openOrders() {
    return this.inner.openOrders()
  }
  position() {
    return this.inner.position()
  }
  balances() {
    return this.inner.balances()
  }
  equity() {
    return this.inner.equity()
  }
  symbolInfo() {
    return this.inner.symbolInfo()
  }
}

interface RunnerDeps {
  db: Db
  manager: BotManager
  config: BotConfig
}

class BotRunner {
  status: BotStatus = 'starting'
  statusReason?: string
  startedAt: number | null = null
  lastEventAt: number | null = null
  readonly recentLogs: LogEntry[] = []
  readonly recentAnnotations: ChartAnnotation[] = []

  private runtime!: StrategyRuntime
  private rawExec!: SimExchange | OKXLiveAdapter
  private tradeBuilder!: TradeBuilder
  private symbolInfoV!: SymbolInfo
  private unsubs: (() => void)[] = []
  private chain: Promise<void> = Promise.resolve()
  private timers: ReturnType<typeof setInterval>[] = []
  private lastSeenOpen = new Map<string, number>()
  private lastFundingBoundary = 0
  private counters = {
    pnlDay: utcDayKey(Date.now()),
    realizedPnlToday: 0,
    realizedPnlTotal: 0,
    tradesToday: 0,
    equityPeak: 0,
    equityDayStart: 0,
    consecutiveLosses: 0,
    cooldownUntil: 0,
  }

  constructor(private readonly deps: RunnerDeps) {}

  get config(): BotConfig {
    return this.deps.config
  }

  // ----------------------------------------------------------------- start

  async start(): Promise<void> {
    const { config, db, manager } = this.deps
    const entry = registry.get(config.strategyId)
    const def = entry.def
    if (!def.markets.includes(config.market)) {
      throw new Error(`La stratégie '${def.name}' ne supporte pas le marché ${config.market}`)
    }
    const validation = validateParams(def.schema, config.params)
    if (!validation.ok) throw new Error(`Paramètres invalides: ${validation.errors.join('; ')}`)

    const testnet = config.mode === 'testnet'
    const envMkt = new BinanceMarketData(new BinanceRest({ market: config.market, testnet }))
    const symbolInfo = await envMkt.symbolInfo(config.symbol)
    if (!symbolInfo) throw new Error(`Symbole inconnu sur ${config.market}${testnet ? ' (testnet)' : ''}: ${config.symbol}`)
    this.symbolInfoV = symbolInfo
    const lastPrice = await envMkt.price(config.symbol)

    // ---- execution adapter
    if (config.mode === 'paper') {
      const sim = new SimExchange({
        market: config.market,
        symbol: config.symbol,
        symbolInfo,
        initialBalance: config.allocation,
        leverage: config.leverage,
        fees: await manager.paperFees(config.market),
        slippagePct: 0.0005,
        intrabarPath: 'heuristic',
        limitFillRatio: 1,
        maintenanceMarginRate: 0.005,
        events: {
          onFill: (fill, orderId) => {
            const order = sim.getOrder(orderId)
            this.enqueue(() => this.onFillEvent({ ...fill, botId: config.id }, order))
          },
          onOrderUpdate: (orderId) => {
            const order = sim.getOrder(orderId)
            if (order) this.enqueue(() => this.onOrderEvent({ ...order, botId: config.id }))
          },
          onLiquidation: (price) => {
            this.enqueue(async () => {
              this.pushLog({ time: Date.now(), level: 'error', message: `LIQUIDATION simulée à ${price}` })
              sendTelegram(`🚨 <b>${config.name}</b> (paper) liquidé à ${price}`)
            })
          },
        },
      })
      sim.setTime(Date.now())
      sim.setLastPrice(lastPrice)
      this.rawExec = sim
    } else {
      const creds = await manager.credentials.get(config.mode === 'live' ? 'live' : 'testnet')
      if (!creds) throw new Error(`Aucune clé API configurée pour le mode ${config.mode}`)
      const instId = toInstId(symbolInfo.baseAsset, symbolInfo.quoteAsset, config.market)
      const rest = new OkxRest({ demo: testnet, credentials: creds })
      const account = new OkxAccount(rest)
      let instrument
      try {
        instrument = await account.instrument(instId)
      } catch {
        throw new Error(`Symbole non listé sur OKX : ${config.symbol} (${instId})`)
      }
      // Overlay the OKX execution rules onto the Binance-sourced symbolInfo: the
      // base/quote/precision come from the DATA side, but tick/step/min/contract/
      // leverage must match the venue we actually trade on (execution + strategy
      // rounding go through this value).
      this.symbolInfoV = {
        ...symbolInfo,
        tickSize: instrument.tickSize,
        stepSize: instrument.stepSize,
        minQty: instrument.minQty,
        contractSize: instrument.contractSize,
        maxLeverage: instrument.maxLeverage,
      }
      if (config.market === 'futures') {
        await account.setLeverage(instId, config.leverage, 'isolated').catch((e) =>
          this.pushLog({
            time: Date.now(),
            level: 'warn',
            message: `setLeverage failed for ${instId}: ${e instanceof Error ? e.message : e}`,
          }),
        )
      }
      manager.ensureBalancePolling(config.mode, config.market, account)
      const adapter = new OKXLiveAdapter({
        market: config.market,
        demo: testnet,
        symbol: config.symbol,
        symbolInfo: this.symbolInfoV,
        botId: config.id,
        allocation: config.allocation,
        leverage: config.leverage,
        account,
        getBalances: () => manager.cachedBalances(config.mode, config.market),
        events: {
          onFill: (fill, order) => this.enqueue(() => this.onFillEvent(fill, order)),
          onOrderUpdate: (order) => this.enqueue(() => this.onOrderEvent(order)),
        },
      })
      adapter.setLastPrice(lastPrice)
      this.rawExec = adapter
      const router = await manager.getRouter(config.mode, creds)
      router.register(adapter)
    }

    const guarded = new RiskGuardedAdapter(this.rawExec, (req) => this.riskCheck(req))

    this.tradeBuilder = new TradeBuilder(config.market, config.symbol, config.leverage, { botId: config.id })

    this.runtime = new StrategyRuntime({
      def,
      params: validation.values,
      mode: config.mode,
      exec: guarded,
      historyCap: 3000,
      keepArtifacts: false,
      sinks: {
        onLog: (entry) => this.pushLog(entry),
        onAnnotation: (a) => {
          this.recentAnnotations.push(a)
          if (this.recentAnnotations.length > RING) this.recentAnnotations.splice(0, RING / 2)
          hub.publish(`bot:${config.id}`, { t: 'bot:annotation', botId: config.id, annotation: a })
        },
        onHalt: (reason) => {
          this.enqueue(() => this.deps.manager.stop(config.id, { reason: `halt(): ${reason}` }))
        },
      },
    })
    await this.runtime.init()

    // ---- restore persisted state
    const stateRows = await db.select().from(botStateTable).where(eq(botStateTable.botId, config.id))
    if (stateRows.length > 0) {
      const row = stateRows[0]!
      const state = (row.state ?? {}) as Record<string, unknown>
      const adapterState = state[ADAPTER_STATE_KEY] as Record<string, number> | undefined
      if (adapterState) {
        if (this.rawExec instanceof SimExchange) this.rawExec.restoreSnapshot(adapterState)
        else this.rawExec.restore(adapterState)
      }
      const cleanState = { ...state }
      delete cleanState[ADAPTER_STATE_KEY]
      this.runtime.loadState(cleanState)
      this.counters.realizedPnlTotal = row.realizedPnlTotal
      this.counters.consecutiveLosses = row.consecutiveLosses
      this.counters.cooldownUntil = row.cooldownUntil
      this.counters.equityPeak = row.equityPeak
      if (row.pnlDay === utcDayKey(Date.now())) {
        this.counters.pnlDay = row.pnlDay
        this.counters.realizedPnlToday = row.realizedPnlToday
      }
    }

    if (this.rawExec instanceof OKXLiveAdapter) {
      // ordres au REPOS connus du bot (DB) → reconcile pourra rattraper un fill
      // survenu pendant l'arrêt (ex. le stop de rachat déclenché alors que le
      // bot était down). Spot uniquement utile, mais inoffensif sinon.
      const restingRows = await db
        .select()
        .from(ordersTable)
        .where(
          and(
            eq(ordersTable.botId, config.id),
            inArray(ordersTable.status, ['NEW', 'TRIGGER_PENDING', 'PARTIALLY_FILLED']),
          ),
        )
      const resting: RestingOrderRef[] = restingRows
        .filter((o) => o.side === 'BUY' || o.side === 'SELL')
        .map((o) => ({
          clientId: o.clientId,
          side: o.side as 'BUY' | 'SELL',
          executedQty: o.executedQty,
          cumQuote: o.cumQuote,
        }))
      const notes = await this.rawExec.reconcile(resting)
      for (const n of notes) this.pushLog({ time: Date.now(), level: 'warn', message: `Réconciliation: ${n}` })
    }

    // ---- warmup + live subscription (buffer the overlap)
    const feeds = this.runtime.feedList
    const preBuffer = new Map<string, Candle[]>()
    let liveDispatch = false

    for (const feed of feeds) {
      if (feed.interval) {
        preBuffer.set(feed.id, [])
        const unsub = liveFeeds.subCandles(config.market, false, feed.symbol, feed.interval, (candle, closed) => {
          if (!closed) return
          if (!liveDispatch) {
            preBuffer.get(feed.id)!.push(candle)
            return
          }
          this.dispatchCandle(feed.id, candle)
        })
        this.unsubs.push(unsub)
      }
      const needTrades = feed.trades || (config.mode === 'paper' && feed.symbol === config.symbol)
      if (needTrades) {
        const unsub = liveFeeds.subTrades(config.market, false, feed.symbol, (trade) => {
          if (this.rawExec instanceof SimExchange && feed.symbol === config.symbol) {
            this.enqueue(async () => {
              const sim = this.rawExec as SimExchange
              sim.setTime(Date.now())
              sim.processAggTrade(trade.price, trade.qty)
            })
          } else if (this.rawExec instanceof OKXLiveAdapter && feed.symbol === config.symbol) {
            this.rawExec.setLastPrice(trade.price)
          }
          if (feed.trades && liveDispatch) {
            this.enqueue(() => this.runtime.handleTrade(feed.id, trade, false).catch((e: unknown) => this.onStrategyError('onTrade', e)))
          }
        })
        this.unsubs.push(unsub)
      }
    }

    // warmup history (always from production data — testnet history is unusable)
    const candleStore = new CandleStore(db)
    const warmupBars = Math.max(300, this.runtime.maxWarmup() + 10)
    const now = Date.now()
    for (const feed of feeds) {
      if (!feed.interval) continue
      const span = warmupBars * INTERVAL_MS[feed.interval]
      try {
        await candleStore.ensureRange(config.market, feed.symbol, feed.interval, now - span, now)
      } catch (err) {
        this.pushLog({
          time: Date.now(),
          level: 'warn',
          message: `Téléchargement du warmup ${feed.symbol} ${feed.interval} incomplet: ${err instanceof Error ? err.message : err}`,
        })
      }
      const candles = await candleStore.getCandles(config.market, feed.symbol, feed.interval, now - span, now)
      for (const c of candles) {
        await this.runtime.handleCandle(feed.id, c, true)
        this.lastSeenOpen.set(feed.id, c.openTime)
      }
    }

    // replay buffered candles that closed during warmup, then go live
    for (const feed of feeds) {
      for (const c of preBuffer.get(feed.id) ?? []) this.dispatchCandle(feed.id, c)
    }
    liveDispatch = true

    // paper futures funding: settle at each 8h boundary with the real rate
    if (config.mode === 'paper' && config.market === 'futures') {
      this.lastFundingBoundary = Math.floor(now / (8 * 3_600_000)) * 8 * 3_600_000
      this.timers.push(
        setInterval(() => this.checkPaperFunding(envMkt), 60_000),
      )
    }

    this.timers.push(setInterval(() => void this.saveState(), 15_000))

    const equityNow = this.rawExec.equity()
    this.counters.equityDayStart = this.counters.equityDayStart || equityNow
    this.counters.equityPeak = Math.max(this.counters.equityPeak, equityNow)
    this.startedAt = Date.now()
    this.status = 'running'
    this.publishInfo()
    this.pushLog({ time: Date.now(), level: 'info', message: `Bot démarré (${config.mode}) sur ${config.symbol}` })
  }

  // ------------------------------------------------------------ event flow

  private enqueue(fn: () => Promise<void>): void {
    this.chain = this.chain.then(fn).catch((err: unknown) => {
      this.pushLog({
        time: Date.now(),
        level: 'error',
        message: `Erreur interne: ${err instanceof Error ? err.message : String(err)}`,
      })
    })
  }

  private dispatchCandle(feedId: string, candle: Candle): void {
    const seen = this.lastSeenOpen.get(feedId) ?? 0
    if (candle.openTime <= seen) return
    this.lastSeenOpen.set(feedId, candle.openTime)
    this.enqueue(async () => {
      this.lastEventAt = Date.now()
      try {
        await this.runtime.handleCandle(feedId, candle, false)
      } catch (err) {
        this.onStrategyError('onCandle', err)
        return
      }
      this.afterEventRiskChecks()
      this.publishInfo()
    })
  }

  private async onFillEvent(fill: Fill, order: Order | null): Promise<void> {
    this.lastEventAt = Date.now()
    const { db, config } = this.deps
    await db
      .insert(fillsTable)
      .values({
        id: fill.id,
        orderId: fill.orderId,
        botId: config.id,
        market: fill.market,
        symbol: fill.symbol,
        side: fill.side,
        price: fill.price,
        qty: fill.qty,
        quoteQty: fill.quoteQty,
        fee: fill.fee,
        feeAsset: fill.feeAsset,
        maker: fill.maker,
        time: fill.time,
        tag: fill.tag,
        reason: fill.reason,
      })
      .onConflictDoNothing()

    this.tradeBuilder.onFill(fill)
    for (const t of this.tradeBuilder.drainClosed()) {
      await this.persistTrade(t)
      this.counters.realizedPnlToday += t.realizedPnl
      this.counters.realizedPnlTotal += t.realizedPnl
      this.counters.tradesToday++
      if (t.realizedPnl <= 0) {
        this.counters.consecutiveLosses++
        if (config.risk.cooldownAfterLossMs) {
          this.counters.cooldownUntil = Date.now() + config.risk.cooldownAfterLossMs
        }
      } else {
        this.counters.consecutiveLosses = 0
      }
      sendTelegram(
        `${t.realizedPnl >= 0 ? '✅' : '🔻'} <b>${config.name}</b> ${t.direction} ${config.symbol} fermé: ${t.realizedPnl.toFixed(2)} USDT (${t.realizedPnlPct.toFixed(2)}%)`,
      )
    }

    hub.publish(`bot:${config.id}`, { t: 'bot:fill', botId: config.id, fill })
    if (order) {
      try {
        await this.runtime.handleFill(fill, order)
      } catch (err) {
        this.onStrategyError('onFill', err)
        return
      }
    }
    this.afterEventRiskChecks()
    this.publishInfo()
  }

  private async onOrderEvent(order: Order): Promise<void> {
    const { db, config } = this.deps
    await db
      .insert(ordersTable)
      .values({
        id: order.id,
        clientId: order.clientId,
        exchangeOrderId: order.exchangeOrderId,
        botId: config.id,
        market: order.market,
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        status: order.status,
        qty: order.qty,
        executedQty: order.executedQty,
        cumQuote: order.cumQuote,
        price: order.price,
        stopPrice: order.stopPrice,
        timeInForce: order.timeInForce,
        reduceOnly: order.reduceOnly,
        ocoGroup: order.ocoGroup,
        reason: order.reason,
        tag: order.tag,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      })
      .onConflictDoUpdate({
        target: ordersTable.id,
        set: { status: order.status, executedQty: order.executedQty, cumQuote: order.cumQuote, updatedAt: order.updatedAt },
      })
    hub.publish(`bot:${config.id}`, { t: 'bot:order', botId: config.id, order })
    try {
      await this.runtime.handleOrderUpdate(order)
    } catch (err) {
      this.onStrategyError('onOrderUpdate', err)
    }
  }

  private async persistTrade(t: TradeRecord): Promise<void> {
    await this.deps.db
      .insert(tradesTable)
      .values({
        id: `${this.deps.config.id}-${randomUUID()}`,
        botId: this.deps.config.id,
        market: t.market,
        symbol: t.symbol,
        direction: t.direction,
        entryTime: t.entryTime,
        exitTime: t.exitTime,
        avgEntryPrice: t.avgEntryPrice,
        avgExitPrice: t.avgExitPrice,
        qty: t.qty,
        realizedPnl: t.realizedPnl,
        realizedPnlPct: t.realizedPnlPct,
        fees: t.fees,
        funding: t.funding,
        entryReason: t.entryReason,
        exitReason: t.exitReason,
        mae: t.mae,
        mfe: t.mfe,
      })
      .onConflictDoNothing()
  }

  private checkPaperFunding(mkt: BinanceMarketData): void {
    const boundary = Math.floor(Date.now() / (8 * 3_600_000)) * 8 * 3_600_000
    if (boundary <= this.lastFundingBoundary || Date.now() < boundary + 30_000) return
    this.lastFundingBoundary = boundary
    this.enqueue(async () => {
      try {
        const rates = await mkt.fundingRateHistory(this.deps.config.symbol, boundary - 3_600_000, boundary + 3_600_000)
        const rate = rates[rates.length - 1]?.rate
        if (rate === undefined) return
        const sim = this.rawExec as SimExchange
        sim.setTime(Date.now())
        const amount = sim.applyFunding(rate)
        if (amount !== 0) {
          this.tradeBuilder.onFunding(amount)
          await this.runtime.handleFunding(amount, rate)
        }
      } catch (err) {
        this.pushLog({ time: Date.now(), level: 'warn', message: `Funding paper indisponible: ${err instanceof Error ? err.message : err}` })
      }
    })
  }

  // ------------------------------------------------------------------ risk

  private riskCheck(req: OrderRequest): string | null {
    const { config, manager } = this.deps
    if (manager.killSwitchActive) return 'kill switch global actif'
    if (this.status !== 'running' && this.status !== 'starting') return `bot ${this.status}`
    if (this.counters.cooldownUntil > Date.now()) {
      return `cooldown après perte jusqu'à ${new Date(this.counters.cooldownUntil).toISOString()}`
    }
    const risk = config.risk
    const open = this.rawExec.openOrders().length
    if (risk.maxOpenOrders !== undefined && open >= risk.maxOpenOrders) {
      return `nombre max d'ordres ouverts atteint (${risk.maxOpenOrders})`
    }
    const price = req.price ?? req.stopPrice ?? this.rawExec.lastPrice()
    const reqNotional = req.quoteQty ?? (req.qty ?? 0) * price
    const pos = this.rawExec.position()
    const posNotional = Math.abs(pos.qty) * this.rawExec.lastPrice()
    if (risk.maxPositionQuote !== undefined && posNotional + reqNotional > risk.maxPositionQuote * 1.001) {
      return `position max dépassée (${(posNotional + reqNotional).toFixed(0)} > ${risk.maxPositionQuote})`
    }
    const globalCap = manager.globalRisk.maxTotalExposureQuote
    if (globalCap !== undefined && config.mode === 'live') {
      const total = manager.totalExposureQuote(['live'])
      if (total + reqNotional > globalCap * 1.001) {
        return `exposition globale max dépassée (${(total + reqNotional).toFixed(0)} > ${globalCap})`
      }
    }
    return null
  }

  private afterEventRiskChecks(): void {
    const { config } = this.deps
    const day = utcDayKey(Date.now())
    const eq = this.rawExec.equity()
    if (day !== this.counters.pnlDay) {
      this.counters.pnlDay = day
      this.counters.realizedPnlToday = 0
      this.counters.tradesToday = 0
      this.counters.equityDayStart = eq
    }
    this.counters.equityPeak = Math.max(this.counters.equityPeak, eq)

    const risk = config.risk
    if (risk.maxDrawdownPct !== undefined && this.counters.equityPeak > 0) {
      const dd = ((this.counters.equityPeak - eq) / this.counters.equityPeak) * 100
      if (dd >= risk.maxDrawdownPct) {
        this.pauseRisk(`drawdown ${dd.toFixed(1)}% ≥ ${risk.maxDrawdownPct}%`)
        return
      }
    }
    if (risk.maxDailyLossQuote !== undefined) {
      const dayPnl = eq - this.counters.equityDayStart
      if (dayPnl <= -risk.maxDailyLossQuote) {
        this.pauseRisk(`perte journalière ${dayPnl.toFixed(2)} ≤ -${risk.maxDailyLossQuote}`)
        return
      }
    }
    if (risk.maxConsecutiveLosses !== undefined && this.counters.consecutiveLosses >= risk.maxConsecutiveLosses) {
      this.pauseRisk(`${this.counters.consecutiveLosses} pertes consécutives`)
    }
  }

  private pauseRisk(reason: string): void {
    if (this.status !== 'running') return
    this.status = 'paused_risk'
    this.statusReason = reason
    this.pushLog({ time: Date.now(), level: 'warn', message: `Bot mis en pause (risk): ${reason}` })
    sendTelegram(`⏸️ <b>${this.deps.config.name}</b> en pause (risk): ${reason}`)
    this.enqueue(async () => {
      for (const o of [...this.rawExec.openOrders()]) await this.rawExec.cancel(o.id).catch(() => {})
      this.publishInfo()
    })
  }

  resume(): void {
    if (this.status !== 'paused_risk') return
    this.status = 'running'
    this.statusReason = undefined
    this.counters.cooldownUntil = 0
    this.pushLog({ time: Date.now(), level: 'info', message: 'Bot relancé manuellement' })
    this.publishInfo()
  }

  private onStrategyError(hook: string, err: unknown): void {
    const msg = `${hook}: ${err instanceof Error ? err.message : String(err)}`
    this.status = 'error'
    this.statusReason = msg
    this.pushLog({ time: Date.now(), level: 'error', message: `Erreur de stratégie — bot en pause: ${msg}` })
    sendTelegram(`🛑 <b>${this.deps.config.name}</b> erreur de stratégie: ${msg}`)
    this.publishInfo()
  }

  // ------------------------------------------------------------------ stop

  async stop(opts: { cancelOrders?: boolean; closePosition?: boolean; reason?: string; killed?: boolean } = {}): Promise<void> {
    if (this.status === 'stopped') return
    this.status = 'stopping'
    this.publishInfo()
    for (const u of this.unsubs) u()
    this.unsubs = []
    for (const t of this.timers) clearInterval(t)
    this.timers = []

    await this.chain.catch(() => {})
    try {
      if (opts.cancelOrders ?? true) {
        for (const o of [...this.rawExec.openOrders()]) await this.rawExec.cancel(o.id).catch(() => {})
      }
      if (opts.closePosition) {
        const pos = this.rawExec.position()
        if (pos.qty !== 0) {
          await this.rawExec.submit({
            side: pos.qty > 0 ? 'SELL' : 'BUY',
            type: 'MARKET',
            qty: Math.abs(pos.qty),
            reduceOnly: true,
            reason: opts.reason ?? 'Fermeture (stop bot)',
            tag: 'close',
          })
        }
      }
      await this.runtime.stop().catch(() => {})
    } finally {
      await this.saveState().catch(() => {})
      if (this.rawExec instanceof OKXLiveAdapter) {
        this.deps.manager.releaseAdapter(this.deps.config.mode, this.rawExec)
      }
      this.status = opts.killed ? 'killed' : 'stopped'
      this.statusReason = opts.reason
      this.publishInfo()
      this.pushLog({ time: Date.now(), level: 'info', message: `Bot arrêté${opts.reason ? ` (${opts.reason})` : ''}` })
    }
  }

  private async saveState(): Promise<void> {
    const adapterState =
      this.rawExec instanceof SimExchange ? this.rawExec.snapshotState() : this.rawExec.snapshot()
    const state = { ...this.runtime.getState(), [ADAPTER_STATE_KEY]: adapterState }
    await this.deps.db
      .insert(botStateTable)
      .values({
        botId: this.deps.config.id,
        state,
        realizedPnlTotal: this.counters.realizedPnlTotal,
        realizedPnlToday: this.counters.realizedPnlToday,
        pnlDay: this.counters.pnlDay,
        equityPeak: this.counters.equityPeak,
        consecutiveLosses: this.counters.consecutiveLosses,
        cooldownUntil: this.counters.cooldownUntil,
        updatedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: botStateTable.botId,
        set: {
          state,
          realizedPnlTotal: this.counters.realizedPnlTotal,
          realizedPnlToday: this.counters.realizedPnlToday,
          pnlDay: this.counters.pnlDay,
          equityPeak: this.counters.equityPeak,
          consecutiveLosses: this.counters.consecutiveLosses,
          cooldownUntil: this.counters.cooldownUntil,
          updatedAt: Date.now(),
        },
      })
  }

  // ------------------------------------------------------------------ info

  private pushLog(entry: LogEntry): void {
    this.recentLogs.push(entry)
    if (this.recentLogs.length > RING) this.recentLogs.splice(0, RING / 2)
    hub.publish(`bot:${this.deps.config.id}`, { t: 'bot:log', botId: this.deps.config.id, entry })
  }

  info(): BotRuntimeInfo {
    const running = this.rawExec !== undefined
    return {
      config: this.deps.config,
      status: this.status,
      statusReason: this.statusReason,
      position: running ? this.rawExec.position() : null,
      openOrders: running ? [...this.rawExec.openOrders()] : [],
      equity: running ? this.rawExec.equity() : this.deps.config.allocation,
      realizedPnlToday: this.counters.realizedPnlToday,
      realizedPnlTotal: this.counters.realizedPnlTotal,
      tradesToday: this.counters.tradesToday,
      startedAt: this.startedAt,
      lastEventAt: this.lastEventAt,
    }
  }

  chartData(): {
    candles: readonly Candle[]
    indicators: ReturnType<StrategyRuntime['collectIndicatorSeries']>
    annotations: ChartAnnotation[]
    interval: string | null
  } {
    return {
      candles: this.runtime.ctx.candles.toArray(),
      indicators: this.runtime.collectIndicatorSeries(),
      annotations: this.recentAnnotations,
      interval: this.runtime.feedList.find((f) => f.id === 'main')?.interval ?? null,
    }
  }

  exposureQuote(): number {
    if (!this.rawExec) return 0
    const pos = this.rawExec.position()
    return Math.abs(pos.qty) * this.rawExec.lastPrice()
  }

  publishInfo(): void {
    hub.publish('bots', { t: 'bot:update', info: this.info() })
  }
}

// =========================================================================

export class BotManager {
  killSwitchActive = false
  globalRisk: GlobalRiskConfig = { killSwitchActive: false }

  private runners = new Map<string, BotRunner>()
  private routers = new Map<string, OkxUserStreamRouter>()
  private balanceCache = new Map<string, { at: number; balances: Balance[] }>()
  private balancePollers = new Map<string, ReturnType<typeof setInterval>>()

  constructor(
    private readonly db: Db,
    readonly settings: SettingsService,
    readonly credentials: CredentialsService,
  ) {}

  async init(): Promise<void> {
    this.globalRisk = await this.settings.globalRisk()
    this.killSwitchActive = this.globalRisk.killSwitchActive
    const rows = await this.db.select().from(botsTable)
    for (const row of rows) {
      if (row.desiredRunning && !this.killSwitchActive) {
        this.start(row.id).catch((err: unknown) => {
          console.error(`Auto-start bot ${row.id} failed:`, err)
        })
      }
    }
  }

  // ------------------------------------------------------------------ CRUD

  private rowToConfig(row: typeof botsTable.$inferSelect): BotConfig {
    return {
      id: row.id,
      name: row.name,
      strategyId: row.strategyId,
      market: row.market as MarketType,
      symbol: row.symbol,
      mode: row.mode as BotConfig['mode'],
      params: row.params as BotConfig['params'],
      allocation: row.allocation,
      leverage: row.leverage,
      risk: row.risk as BotConfig['risk'],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  async listConfigs(): Promise<BotConfig[]> {
    const rows = await this.db.select().from(botsTable)
    return rows.map((r) => this.rowToConfig(r))
  }

  async getConfig(id: string): Promise<BotConfig | null> {
    const rows = await this.db.select().from(botsTable).where(eq(botsTable.id, id))
    return rows.length > 0 ? this.rowToConfig(rows[0]!) : null
  }

  async create(input: Omit<BotConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<BotConfig> {
    const entry = registry.get(input.strategyId)
    const validation = validateParams(entry.def.schema, input.params)
    if (!validation.ok) throw new Error(`Paramètres invalides: ${validation.errors.join('; ')}`)
    if (input.market === 'futures' && input.mode !== 'paper') {
      const others = (await this.listConfigs()).filter(
        (b) => b.market === 'futures' && b.symbol === input.symbol && b.mode === input.mode,
      )
      if (others.length > 0) {
        throw new Error(
          `Un bot futures ${input.mode} existe déjà sur ${input.symbol} — les positions seraient mélangées sur l'exchange`,
        )
      }
    }
    const config: BotConfig = {
      ...input,
      params: validation.values,
      id: randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await this.db.insert(botsTable).values({
      id: config.id,
      name: config.name,
      strategyId: config.strategyId,
      market: config.market,
      symbol: config.symbol,
      mode: config.mode,
      params: config.params,
      allocation: config.allocation,
      leverage: config.leverage,
      risk: config.risk,
      desiredRunning: false,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    })
    return config
  }

  async update(id: string, patch: Partial<Omit<BotConfig, 'id' | 'createdAt' | 'updatedAt'>>): Promise<BotConfig> {
    if (this.runners.has(id)) throw new Error('Arrêtez le bot avant de le modifier')
    const existing = await this.getConfig(id)
    if (!existing) throw new Error('Bot introuvable')
    const merged = { ...existing, ...patch, updatedAt: Date.now() }
    const entry = registry.get(merged.strategyId)
    const validation = validateParams(entry.def.schema, merged.params)
    if (!validation.ok) throw new Error(`Paramètres invalides: ${validation.errors.join('; ')}`)
    merged.params = validation.values
    await this.db
      .update(botsTable)
      .set({
        name: merged.name,
        strategyId: merged.strategyId,
        market: merged.market,
        symbol: merged.symbol,
        mode: merged.mode,
        params: merged.params,
        allocation: merged.allocation,
        leverage: merged.leverage,
        risk: merged.risk,
        updatedAt: merged.updatedAt,
      })
      .where(eq(botsTable.id, id))
    return merged
  }

  async remove(id: string): Promise<void> {
    if (this.runners.has(id)) throw new Error('Arrêtez le bot avant de le supprimer')
    await this.db.delete(botsTable).where(eq(botsTable.id, id))
    await this.db.delete(botStateTable).where(eq(botStateTable.botId, id))
    hub.publish('bots', { t: 'bot:removed', botId: id })
  }

  // ------------------------------------------------------------- lifecycle

  async start(id: string): Promise<void> {
    if (this.killSwitchActive) throw new Error('Kill switch actif — désactivez-le avant de démarrer un bot')
    if (this.runners.has(id)) throw new Error('Bot déjà démarré')
    const config = await this.getConfig(id)
    if (!config) throw new Error('Bot introuvable')
    const runner = new BotRunner({ db: this.db, manager: this, config })
    this.runners.set(id, runner)
    try {
      await runner.start()
      await this.db.update(botsTable).set({ desiredRunning: true }).where(eq(botsTable.id, id))
    } catch (err) {
      this.runners.delete(id)
      hub.publish('bots', { t: 'bot:removed', botId: id })
      throw err
    }
  }

  async stop(
    id: string,
    opts: { closePosition?: boolean; reason?: string; killed?: boolean; keepDesired?: boolean } = {},
  ): Promise<void> {
    const runner = this.runners.get(id)
    if (!runner) return
    await runner.stop(opts)
    this.runners.delete(id)
    // keepDesired = server shutdown: don't clear the persisted intent, so the bot
    // auto-resumes (and reconciles) when the server restarts. A user-initiated stop
    // clears it (the bot stays down until explicitly restarted).
    if (!opts.keepDesired) {
      await this.db.update(botsTable).set({ desiredRunning: false }).where(eq(botsTable.id, id))
    }
    runner.publishInfo()
  }

  resume(id: string): void {
    this.runners.get(id)?.resume()
  }

  runner(id: string): BotRunner | undefined {
    return this.runners.get(id)
  }

  async infoList(): Promise<BotRuntimeInfo[]> {
    const configs = await this.listConfigs()
    return configs.map((config) => {
      const runner = this.runners.get(config.id)
      if (runner) return runner.info()
      return {
        config,
        status: 'stopped' as BotStatus,
        position: null,
        openOrders: [],
        equity: config.allocation,
        realizedPnlToday: 0,
        realizedPnlTotal: 0,
        tradesToday: 0,
        startedAt: null,
        lastEventAt: null,
      }
    })
  }

  async setKillSwitch(active: boolean, closePositions: boolean): Promise<void> {
    this.killSwitchActive = active
    this.globalRisk = { ...this.globalRisk, killSwitchActive: active }
    await this.settings.setGlobalRisk(this.globalRisk)
    if (active) {
      sendTelegram('🛑 <b>KILL SWITCH</b> activé — arrêt de tous les bots')
      for (const id of [...this.runners.keys()]) {
        await this.stop(id, { closePosition: closePositions, reason: 'kill switch', killed: true }).catch(() => {})
      }
    }
  }

  async setGlobalRisk(cfg: GlobalRiskConfig): Promise<void> {
    this.globalRisk = { ...cfg, killSwitchActive: this.killSwitchActive }
    await this.settings.setGlobalRisk(this.globalRisk)
  }

  totalExposureQuote(modes: BotConfig['mode'][] = ['live']): number {
    let sum = 0
    for (const r of this.runners.values()) {
      if (modes.includes(r.config.mode)) sum += r.exposureQuote()
    }
    return sum
  }

  async paperFees(market: MarketType) {
    return this.settings.get(`paperFees:${market}`, DEFAULT_FEES[market])
  }

  // --------------------------------------------------- shared live plumbing

  async getRouter(mode: BotConfig['mode'], creds: OkxCredentials): Promise<OkxUserStreamRouter> {
    // One router per account: the OKX unified account carries spot + swap, so a
    // single private socket fans out to every bot in that mode.
    let router = this.routers.get(mode)
    if (!router) {
      const onError = (err: Error) => console.error(`User stream ${mode} error:`, err.message)
      router = new OkxUserStreamRouter(new OkxPrivateStream(creds, mode === 'testnet', onError), onError)
      this.routers.set(mode, router)
      await router.start()
    }
    return router
  }

  releaseAdapter(mode: BotConfig['mode'], adapter: OKXLiveAdapter): void {
    const router = this.routers.get(mode)
    if (!router) return
    router.unregister(adapter)
    if (router.size === 0) {
      router.stop()
      this.routers.delete(mode)
    }
  }

  ensureBalancePolling(mode: BotConfig['mode'], market: MarketType, account: OkxAccount): void {
    const key = `${mode}:${market}`
    if (this.balancePollers.has(key)) return
    const poll = async (): Promise<void> => {
      try {
        const balances = await account.balances(market)
        this.balanceCache.set(key, { at: Date.now(), balances })
      } catch {
        /* keep stale */
      }
    }
    void poll()
    this.balancePollers.set(key, setInterval(() => void poll(), 20_000))
  }

  cachedBalances(mode: BotConfig['mode'], market: MarketType): Balance[] {
    return this.balanceCache.get(`${mode}:${market}`)?.balances ?? []
  }

  async stopAll(): Promise<void> {
    for (const id of [...this.runners.keys()]) {
      await this.stop(id, { reason: 'arrêt du serveur', keepDesired: true }).catch(() => {})
    }
    for (const t of this.balancePollers.values()) clearInterval(t)
  }
}
