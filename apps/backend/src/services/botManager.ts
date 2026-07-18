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
  effectiveCredentialName,
  floorToStep,
  sleep,
  utcDayKey,
  validateParams,
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
  execQuoteAsset,
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

/** Format FR pour Telegram : 12 345,67 (espace fine, virgule décimale). */
function nf(x: number, d = 2): string {
  const neg = x < 0
  const [i, f] = Math.abs(x).toFixed(d).split('.')
  const g = i!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return (neg ? '−' : '') + g + (f ? ',' + f : '')
}

/** Quantité base : 8 décimales, zéros de fin retirés. */
function nq(x: number): string {
  return nf(x, 8).replace(/0+$/, '').replace(/,$/, '')
}

/** blocks position-increasing orders when a risk rule is violated */
/** Un blocage d'ordre. `hard` = JAMAIS contournable (statut du bot, kill switch)
 *  — même un ordre protecteur reduceOnly est refusé. `hard:false` = plafond de
 *  risque, qu'un ordre reduceOnly (stop-loss/TP) peut franchir pour protéger. */
export interface OrderBlock {
  reason: string
  hard: boolean
}

export class RiskGuardedAdapter implements ExecutionAdapter {
  constructor(
    private readonly inner: ExecutionAdapter,
    private readonly check: (req: OrderRequest) => OrderBlock | null,
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
    // un reduceOnly peut franchir un PLAFOND (placer un stop protecteur), jamais
    // un blocage dur (bot non-running / kill switch) : arrêter un bot ne doit
    // JAMAIS déclencher une transaction, y compris via un ordre reduceOnly.
    if (block !== null && (block.hard || req.reduceOnly !== true)) {
      return Promise.reject(new Error(`Ordre bloqué (${block.hard ? 'état du bot' : 'risk management'}): ${block.reason}`))
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
  /** SÉRIALISATION start/stop : un Stop cliqué pendant le boot attendait la fin
   *  du start() qui reposait status='running' → bot zombie (abonnements vivants,
   *  ordres possibles après « arrêt »). Les opérations de cycle de vie passent
   *  par cette file ; stopRequested fait avorter un boot en cours à son prochain
   *  checkpoint, PUIS le stop s'exécute — jamais les deux entrelacés. */
  private lifecycle: Promise<unknown> = Promise.resolve()
  private stopRequested = false
  /** compte OKX résolu au démarrage (live/testnet) — clé du routeur WS privé */
  private credName: string | null = null
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

  /** enchaîne une opération de cycle de vie APRÈS celles déjà en file (les
   *  erreurs de la précédente n'annulent pas la suivante) */
  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lifecycle.then(fn, fn)
    this.lifecycle = run.catch(() => {})
    return run
  }

  /** point d'abandon du boot : si un arrêt a été demandé pendant le démarrage,
   *  on jette ICI (entre deux phases) — le stop en file fera le nettoyage */
  private abortIfStopRequested(): void {
    if (this.stopRequested) throw new Error('démarrage interrompu : arrêt demandé pendant le boot')
  }

  start(): Promise<void> {
    return this.runExclusive(() => this.startInner())
  }

  private async startInner(): Promise<void> {
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
    let liveAccount: OkxAccount | null = null
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
      const credName = effectiveCredentialName(config.mode, config.credentialName)!
      const cred = await manager.credentials.getRecord(credName)
      if (!cred) throw new Error(`Aucune clé API configurée pour le compte « ${credName} »`)
      // GARDE de cohérence compte↔mode : un bot LIVE sur une clé démo ne
      // tradera jamais ; un bot démo sur une clé réelle engagerait de l'argent
      // réel « pour un test » — les deux sens sont des erreurs de config.
      if (config.mode === 'live' && cred.demo) {
        throw new Error(`Le compte « ${credName} » est une clé DÉMO — impossible pour un bot LIVE`)
      }
      if (config.mode === 'testnet' && !cred.demo) {
        throw new Error(`Le compte « ${credName} » est une clé RÉELLE — impossible pour un bot démo (testnet)`)
      }
      this.credName = credName
      const creds = cred.creds
      // EU (EEA) accounts can't trade USDT — execute on the USDC pair instead while
      // the DATA symbol (config.symbol / candles) stays on Binance USDT. No-op
      // elsewhere, et EXEMPTÉ en démo (les paires USDC du bac à sable sont mortes).
      const execQuote = execQuoteAsset(symbolInfo.quoteAsset, testnet)
      const instId = toInstId(symbolInfo.baseAsset, execQuote, config.market)
      const rest = new OkxRest({ demo: testnet, credentials: creds })
      const account = new OkxAccount(rest)
      liveAccount = account
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
      // SWAP : lotSz/minSz OKX sont exprimés en CONTRATS — tous les consommateurs
      // de SymbolInfo (roundQty du runtime, seuils dust, reconcile) attendent des
      // unités BASE → convertir via contractSize. Spot : contractSize = 1.
      const unit = config.market === 'futures' ? (instrument.contractSize ?? 1) : 1
      this.symbolInfoV = {
        ...symbolInfo,
        quoteAsset: execQuote,
        tickSize: instrument.tickSize,
        stepSize: instrument.stepSize * unit,
        minQty: instrument.minQty * unit,
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
      const adapter = new OKXLiveAdapter({
        market: config.market,
        demo: testnet,
        symbol: config.symbol,
        symbolInfo: this.symbolInfoV,
        botId: config.id,
        allocation: config.allocation,
        leverage: config.leverage,
        account,
        events: {
          onFill: (fill, order) => this.enqueue(() => this.onFillEvent(fill, order)),
          onOrderUpdate: (order) => this.enqueue(() => this.onOrderEvent(order)),
        },
        // somme des tranches revendiquées par les AUTRES bots spot de la même
        // paire sur le MÊME COMPTE (états persistés) — nourrit la garde
        // anti-sur-revendication. Scopé par compte effectif : des bots sur des
        // sous-comptes séparés ne partagent PAS leurs soldes.
        siblingBaseClaims: async () => {
          const rows = await db
            .select({
              id: botsTable.id,
              mode: botsTable.mode,
              credentialName: botsTable.credentialName,
              state: botStateTable.state,
            })
            .from(botsTable)
            .innerJoin(botStateTable, eq(botStateTable.botId, botsTable.id))
            .where(
              and(
                eq(botsTable.market, 'spot'),
                eq(botsTable.symbol, config.symbol),
                eq(botsTable.desiredRunning, true),
              ),
            )
          let sum = 0
          for (const r of rows) {
            if (r.id === config.id) continue
            if (effectiveCredentialName(r.mode as BotConfig['mode'], r.credentialName) !== credName) continue
            const st = (r.state ?? {}) as Record<string, unknown>
            const ad = st[ADAPTER_STATE_KEY] as { posQty?: number } | undefined
            sum += Math.max(0, ad?.posQty ?? 0)
          }
          return sum
        },
      })
      adapter.setLastPrice(lastPrice)
      this.rawExec = adapter
      const router = await manager.getRouter(credName, creds, testnet)
      router.register(adapter)
    }

    const guarded = new RiskGuardedAdapter(this.rawExec, (req) => this.riskCheck(req))

    this.tradeBuilder = new TradeBuilder(
      config.market,
      config.symbol,
      config.leverage,
      { botId: config.id },
      def.backtest?.denomination === 'base',
    )

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
    const hadAdapterState =
      stateRows.length > 0 &&
      ((stateRows[0]!.state ?? {}) as Record<string, unknown>)[ADAPTER_STATE_KEY] !== undefined
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

    // ---- position initiale (« je détiens déjà X BTC ») : adoptée au TOUT
    // premier démarrage uniquement — le bot démarre EN POSITION, comme le
    // backtest base-denom, et sa première action sera une VENTE au signal.
    const wantAll = config.adoptAllBase === true
    const askedQty = config.initialBaseQty ?? 0
    if (!hadAdapterState && (wantAll || askedQty > 0)) {
      if (config.market !== 'spot') throw new Error('Position initiale : uniquement pour les bots spot')
      let seeded = askedQty
      if (this.rawExec instanceof OKXLiveAdapter) {
        const bals = await liveAccount!.balances('spot')
        const baseFree = bals.find((b) => b.asset === this.symbolInfoV.baseAsset)?.free ?? 0
        if (wantAll) {
          // tout le solde libre, floored au pas de l'instrument
          seeded = floorToStep(baseFree, this.symbolInfoV.stepSize)
          if (seeded <= 0) {
            throw new Error(
              `Adoption impossible : le compte ${config.mode === 'testnet' ? 'démo' : 'live'} ne détient ` +
                `aucun ${this.symbolInfoV.baseAsset} libre`,
            )
          }
        } else if (baseFree + 1e-9 < seeded) {
          throw new Error(
            `Position initiale impossible : le compte ${config.mode === 'testnet' ? 'démo' : 'live'} ne détient ` +
              `que ${baseFree} ${this.symbolInfoV.baseAsset} libres (${seeded} demandés)`,
          )
        }
        this.rawExec.restore({ posQty: seeded, posEntry: lastPrice, realizedNet: 0, seq: 0, quoteLedger: 0 })
      } else {
        if (wantAll) throw new Error("« Adopter tout » nécessite un compte réel (démo/live) — en paper, saisissez une quantité")
        this.rawExec.restoreSnapshot({ quoteFree: 0, baseFree: seeded, posQty: seeded, posEntry: lastPrice })
      }
      this.pushLog({
        time: Date.now(),
        level: 'info',
        message: `Position initiale adoptée${wantAll ? ' (tout le solde libre)' : ''} : ${seeded} ${this.symbolInfoV.baseAsset} (réf. ${lastPrice}) — première action attendue : vente au signal de régime`,
      })
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
          type: o.type as Order['type'],
          executedQty: o.executedQty,
          cumQuote: o.cumQuote,
        }))
      const notes = await this.rawExec.reconcile(resting)
      for (const n of notes) this.pushLog({ time: Date.now(), level: 'warn', message: `Réconciliation: ${n}` })
    }
    this.abortIfStopRequested()

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
      this.abortIfStopRequested()
    }

    // replay buffered candles that closed during warmup, then go live —
    // dernier point d'abandon AVANT que la stratégie ne puisse émettre des ordres
    this.abortIfStopRequested()
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
    // sonde anti-dérive : un fill perdu gonfle le livre → gel AVANT que la
    // stratégie ne trade sur des soldes imaginaires (incident 2026-07-14 : 3 h
    // entre le fill perdu et le rachat en double — une sonde horaire gèle avant)
    if (this.rawExec instanceof OKXLiveAdapter) {
      this.timers.push(setInterval(() => void this.checkLedgerDrift(), 3_600_000))
    }

    this.abortIfStopRequested()
    const equityNow = this.rawExec.equity()
    this.counters.equityDayStart = this.counters.equityDayStart || equityNow
    this.counters.equityPeak = Math.max(this.counters.equityPeak, equityNow)
    this.startedAt = Date.now()
    this.status = 'running'
    this.publishInfo()
    this.pushLog({ time: Date.now(), level: 'info', message: `Bot démarré (${config.mode}) sur ${config.symbol}` })
    sendTelegram(
      `▶️ DÉMARRÉ — <b>${config.name || config.strategyId}</b>\nÉquité ${nf(equityNow)}\n<code>${config.mode} · ${config.symbol}</code>`,
    )
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
      // les bots live sans feed de trades n'ont AUCUNE autre source de prix :
      // sans ceci, equity()/unrealizedPnl/riskCheck/minNotional travaillent sur
      // le prix du démarrage (toute la couche risque devient morte).
      if (feedId === 'main' && this.rawExec instanceof OKXLiveAdapter) {
        this.rawExec.setLastPrice(candle.close)
      }
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
    // transition d'état détectée sur la ligne précédente en DB (fiable après
    // restart, contrairement à un Set en mémoire) → Telegram par transaction
    const prev = await db
      .select({ status: ordersTable.status })
      .from(ordersTable)
      .where(eq(ordersTable.id, order.id))
    const prevStatus = prev[0]?.status
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
    if (order.status === 'FILLED' && prevStatus !== 'FILLED') void this.notifyTransaction(order)
    if (order.status === 'REJECTED' && prevStatus !== 'REJECTED') {
      sendTelegram(
        `⚠️ ORDRE REJETÉ — <b>${config.name || config.strategyId}</b>\n` +
          `${order.side} ${order.type}${order.reason ? `\n<i>${order.reason}</i>` : ''}\n` +
          `<code>${config.mode} · ${config.symbol}</code>`,
      )
    }
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

  private riskCheck(req: OrderRequest): OrderBlock | null {
    const { config, manager } = this.deps
    // ---- BLOCAGES DURS (jamais contournables, même par un reduceOnly protecteur)
    // Arrêter un bot ne doit JAMAIS déclencher de transaction : les états d'arrêt
    // et le kill switch coupent tout ordre. Un ordre ne part QUE pendant la
    // marche normale — 'running', ou 'starting' (bascule warmup→live, où la
    // stratégie peut légitimement trader sur la 1re bougie). Les corrections
    // manuelles se font sur la plateforme (règle produit, incident 2026-07-11).
    if (manager.killSwitchActive) return { reason: 'kill switch global actif', hard: true }
    if (this.status === 'stopping' || this.status === 'stopped' || this.status === 'killed' || this.status === 'error') {
      return { reason: `bot ${this.status} — aucune transaction à l'arrêt`, hard: true }
    }
    if (this.status !== 'running' && this.status !== 'starting') {
      // paused_risk : pas de nouvelle entrée, mais un stop protecteur reste permis
      return { reason: `bot ${this.status}`, hard: false }
    }
    // ---- PLAFONDS (un ordre protecteur reduceOnly peut les franchir)
    if (this.counters.cooldownUntil > Date.now()) {
      return { reason: `cooldown après perte jusqu'à ${new Date(this.counters.cooldownUntil).toISOString()}`, hard: false }
    }
    const risk = config.risk
    const open = this.rawExec.openOrders().length
    if (risk.maxOpenOrders !== undefined && open >= risk.maxOpenOrders) {
      return { reason: `nombre max d'ordres ouverts atteint (${risk.maxOpenOrders})`, hard: false }
    }
    const price = req.price ?? req.stopPrice ?? this.rawExec.lastPrice()
    const reqNotional = req.quoteQty ?? (req.qty ?? 0) * price
    const pos = this.rawExec.position()
    const posNotional = Math.abs(pos.qty) * this.rawExec.lastPrice()
    if (risk.maxPositionQuote !== undefined && posNotional + reqNotional > risk.maxPositionQuote * 1.001) {
      return { reason: `position max dépassée (${(posNotional + reqNotional).toFixed(0)} > ${risk.maxPositionQuote})`, hard: false }
    }
    const globalCap = manager.globalRisk.maxTotalExposureQuote
    if (globalCap !== undefined && config.mode === 'live') {
      const total = manager.totalExposureQuote(['live'])
      if (total + reqNotional > globalCap * 1.001) {
        return { reason: `exposition globale max dépassée (${(total + reqNotional).toFixed(0)} > ${globalCap})`, hard: false }
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
    sendTelegram(
      `⏸️ EN PAUSE (risque) — <b>${this.deps.config.name || this.deps.config.strategyId}</b>\n<i>${reason}</i>\n<code>${this.deps.config.mode} · ${this.deps.config.symbol}</code>`,
    )
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
    sendTelegram(
      `▶️ RELANCÉ — <b>${this.deps.config.name || this.deps.config.strategyId}</b> (pause risque levée)\n<code>${this.deps.config.mode} · ${this.deps.config.symbol}</code>`,
    )
    this.publishInfo()
  }

  /** Sonde horaire : le livre quote du bot ne doit jamais excéder le solde réel
   *  (fill perdu, retrait, bot jumeau). Dérive critique → gel — le verrou
   *  riskCheck coupe toute transaction en statut 'error'. */
  private async checkLedgerDrift(): Promise<void> {
    if (this.status !== 'running' && this.status !== 'paused_risk') return
    if (!(this.rawExec instanceof OKXLiveAdapter)) return
    try {
      const d = await this.rawExec.quoteDrift()
      if (!d?.critical) return
      const msg = `dérive de solde : livre ${d.ledger.toFixed(2)} vs réel ${d.real.toFixed(2)}`
      this.status = 'error'
      this.statusReason = msg
      this.pushLog({ time: Date.now(), level: 'error', message: `Dérive de solde détectée — bot gelé: ${msg}` })
      sendTelegram(
        `🛑 GELÉ — <b>${this.deps.config.name || this.deps.config.strategyId}</b>\nDérive de solde : livre ${nf(d.ledger)} vs réel ${nf(d.real)} (fill perdu probable)\n<code>${this.deps.config.mode} · ${this.deps.config.symbol}</code>`,
      )
      this.publishInfo()
    } catch {
      // sonde best-effort : nouvelle tentative dans une heure
    }
  }

  /** Exigence produit (post-incident 2026-07-14) : CHAQUE transaction exécutée
   *  (achat comme vente) part sur Telegram — quantités et frais RÉELS, agrégés
   *  depuis les fills persistés (prix moyen = quote/qty). Best-effort. */
  private async notifyTransaction(order: Order): Promise<void> {
    try {
      const { db, config } = this.deps
      const fs = await db.select().from(fillsTable).where(eq(fillsTable.orderId, order.id))
      const qty = fs.reduce((s, f) => s + f.qty, 0) || order.executedQty
      const quote = fs.reduce((s, f) => s + f.quoteQty, 0)
      const fee = fs.reduce((s, f) => s + f.fee, 0)
      const avg = qty > 0 && quote > 0 ? quote / qty : (order.price ?? 0)
      const si = this.symbolInfoV
      const head = order.side === 'BUY' ? '🟩 ACHAT' : '🟥 VENTE'
      sendTelegram(
        `${head} — <b>${config.name || config.strategyId}</b>\n` +
          `<b>${nq(qty)} ${si.baseAsset}</b> @ ${nf(avg, 1)}\n` +
          `Total ${nf(quote)} ${si.quoteAsset}${fee ? ` · Frais ${nf(fee, 4)}` : ''}\n` +
          (order.reason ? `<i>${order.reason}</i>\n` : '') +
          `<code>${config.mode} · ${config.symbol}</code>`,
      )
    } catch {
      // notification best-effort : ne bloque jamais le flux d'événements
    }
  }

  private onStrategyError(hook: string, err: unknown): void {
    const msg = `${hook}: ${err instanceof Error ? err.message : String(err)}`
    this.status = 'error'
    this.statusReason = msg
    this.pushLog({ time: Date.now(), level: 'error', message: `Erreur de stratégie — bot en pause: ${msg}` })
    sendTelegram(
      `🛑 GELÉ — <b>${this.deps.config.name || this.deps.config.strategyId}</b>\nErreur de stratégie : <i>${msg}</i>\n<code>${this.deps.config.mode} · ${this.deps.config.symbol}</code>`,
    )
    this.publishInfo()
  }

  // ------------------------------------------------------------------ stop

  stop(
    opts: {
      cancelOrders?: boolean
      runOnStopHook?: boolean
      reason?: string
      killed?: boolean
    } = {},
  ): Promise<void> {
    // 1) le drapeau fait avorter un start() en cours à son prochain checkpoint ;
    // 2) le stop réel s'exécute APRÈS lui dans la file — jamais entrelacés.
    this.stopRequested = true
    return this.runExclusive(() => this.stopInner(opts))
  }

  private async stopInner(opts: {
    cancelOrders?: boolean
    runOnStopHook?: boolean
    reason?: string
    killed?: boolean
  }): Promise<void> {
    if (this.status === 'stopped') return
    // un start avorté a pu ne jamais construire rawExec (créé en premier) ni
    // runtime (créé après) : le démontage complet exige les deux
    const booted = (this.rawExec as unknown) !== undefined && (this.runtime as unknown) !== undefined
    this.status = 'stopping'
    this.publishInfo()
    for (const u of this.unsubs) u()
    this.unsubs = []
    for (const t of this.timers) clearInterval(t)
    this.timers = []
    if (!booted) {
      this.status = opts.killed ? 'killed' : 'stopped'
      this.statusReason = opts.reason
      if (!opts.killed) {
        sendTelegram(
          `⏹️ ARRÊTÉ — <b>${this.deps.config.name || this.deps.config.strategyId}</b>${opts.reason ? `\n<i>${opts.reason}</i>` : ''}\n<code>${this.deps.config.mode} · ${this.deps.config.symbol}</code>`,
        )
      }
      this.publishInfo()
      this.pushLog({ time: Date.now(), level: 'info', message: `Bot arrêté avant la fin du démarrage${opts.reason ? ` (${opts.reason})` : ''}` })
      return
    }

    await this.chain.catch(() => {})
    try {
      // Arrêter un bot ne déclenche JAMAIS d'achat/vente (règle produit,
      // incident 2026-07-11 : « Fermer » avait vendu puis racheté le stack).
      // On annule seulement les ordres AU REPOS (stop/limit résidents) — ce
      // n'est pas une transaction, et ça empêche un fill non désiré APRÈS
      // l'arrêt. Aucune fermeture de position, aucun « retour en BTC ».
      if (opts.cancelOrders ?? true) {
        for (const o of [...this.rawExec.openOrders()]) await this.rawExec.cancel(o.id).catch(() => {})
      }
      if (opts.runOnStopHook ?? true) {
        // onStop peut encore annuler des ordres résidents, mais TOUTE
        // soumission d'ordre y est refusée (statut 'stopping' ≠ 'running',
        // blocage dur du riskCheck) — filet systémique même si une stratégie
        // tente une transaction dans son onStop.
        try {
          await this.runtime.stop()
        } catch (err) {
          this.pushLog({
            time: Date.now(),
            level: 'warn',
            message: `onStop en erreur (ignoré): ${err instanceof Error ? err.message : String(err)}`,
          })
        }
      }
      // laisse retomber d'éventuels fills d'ordres de la stratégie encore en vol
      // au moment de l'arrêt — sort immédiatement s'il n'y a rien
      await this.waitLiveFillsSettled(3_000)
    } finally {
      await this.saveState().catch(() => {})
      if (this.rawExec instanceof OKXLiveAdapter && this.credName !== null) {
        this.deps.manager.releaseAdapter(this.credName, this.rawExec)
      }
      this.status = opts.killed ? 'killed' : 'stopped'
      this.statusReason = opts.reason
      if (!opts.killed) {
        sendTelegram(
          `⏹️ ARRÊTÉ — <b>${this.deps.config.name || this.deps.config.strategyId}</b>${opts.reason ? `\n<i>${opts.reason}</i>` : ''}\n<code>${this.deps.config.mode} · ${this.deps.config.symbol}</code>`,
        )
      }
      this.publishInfo()
      this.pushLog({ time: Date.now(), level: 'info', message: `Bot arrêté${opts.reason ? ` (${opts.reason})` : ''}` })
    }
  }

  /** Nettoyage après un start() qui a échoué à mi-chemin : libère l'adapter du
   *  routeur (sinon zombie qui continue de recevoir les événements) et coupe
   *  les subscriptions/timers déjà ouverts. */
  releaseExec(): void {
    for (const u of this.unsubs) u()
    this.unsubs = []
    for (const t of this.timers) clearInterval(t)
    this.timers = []
    if (this.rawExec instanceof OKXLiveAdapter && this.credName !== null) {
      this.deps.manager.releaseAdapter(this.credName, this.rawExec)
    }
  }

  /** Après les ordres market du stop (close/onStop), laisse une courte fenêtre
   *  aux fills WS pour arriver AVANT saveState/releaseAdapter — sinon le fill
   *  est perdu jusqu'au backfill du prochain reconcile. Les stops résidents
   *  (TRIGGER_PENDING) sont exclus : ils ne se rempliront pas maintenant. */
  private async waitLiveFillsSettled(maxMs: number): Promise<void> {
    if (this.rawExec instanceof SimExchange) {
      // paper : les feeds sont déjà coupés, un market émis par onStop ne verra
      // plus jamais de tick — on en pompe un au dernier prix connu pour le fill
      const sim = this.rawExec
      if (sim.lastPrice() > 0 && sim.openOrders().some((o) => o.type === 'MARKET')) {
        sim.setTime(Date.now())
        sim.processAggTrade(sim.lastPrice(), 0)
      }
      await this.chain.catch(() => {})
      return
    }
    const deadline = Date.now() + maxMs
    while (Date.now() < deadline) {
      const pendingMarket = this.rawExec.openOrders().some((o) => o.type === 'MARKET')
      if (!pendingMarket) break
      await new Promise((r) => setTimeout(r, 200))
    }
    await this.chain.catch(() => {})
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
      // état de la stratégie (soldPrice/stop/bracket…) pour les rails de
      // cycle du Dashboard — petit dict, jamais de données sensibles
      strategyState: this.runtime ? this.runtime.getState() : undefined,
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
  private streamRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()

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
        void this.startWithRetries(row.id, 3)
      }
    }
  }

  /** Auto-start au boot : un 5xx OKX ou un réseau lent ne doit pas laisser un
   *  bot down en silence — 3 tentatives espacées de 30 s, puis alerte Telegram
   *  (desiredRunning reste vrai : un prochain boot ou une reprise le relancera). */
  private async startWithRetries(id: string, attempts: number): Promise<void> {
    for (let n = 1; n <= attempts; n++) {
      if (this.runners.has(id)) return // démarré entre-temps (manuellement)
      try {
        await this.start(id)
        return
      } catch (err) {
        console.error(`Auto-start bot ${id} échoué (${n}/${attempts}):`, err instanceof Error ? err.message : err)
        if (n < attempts) await sleep(30_000)
      }
    }
    sendTelegram(`🛑 Auto-start du bot <code>${id}</code> abandonné après ${attempts} tentatives — il reste arrêté`)
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
      credentialName: row.credentialName ?? undefined,
      params: row.params as BotConfig['params'],
      allocation: row.allocation,
      initialBaseQty: row.initialBaseQty ?? undefined,
      adoptAllBase: row.adoptAllBase ?? undefined,
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

  /** compte cohérent avec le mode : existe, et demo↔mode alignés. paper → aucun. */
  private async checkCredential(mode: BotConfig['mode'], credentialName: string | undefined): Promise<string | undefined> {
    if (mode === 'paper' || credentialName === undefined) return undefined
    const rec = await this.credentials.getRecord(credentialName)
    if (!rec) throw new Error(`Compte inconnu : « ${credentialName} » — créez d'abord ses clés API dans Réglages`)
    if (mode === 'live' && rec.demo) throw new Error(`Le compte « ${credentialName} » est une clé DÉMO — impossible pour un bot LIVE`)
    if (mode === 'testnet' && !rec.demo) throw new Error(`Le compte « ${credentialName} » est une clé RÉELLE — impossible pour un bot démo (testnet)`)
    return credentialName
  }

  async create(input: Omit<BotConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<BotConfig> {
    const entry = registry.get(input.strategyId)
    // la stratégie impose sa paire et ses marchés quand elle les déclare
    if (entry.def.symbol !== undefined) input = { ...input, symbol: entry.def.symbol }
    if (!entry.def.markets.includes(input.market)) {
      throw new Error(`La stratégie '${entry.def.name}' ne supporte pas le marché ${input.market}`)
    }
    input = { ...input, credentialName: await this.checkCredential(input.mode, input.credentialName) }
    const validation = validateParams(entry.def.schema, input.params)
    if (!validation.ok) throw new Error(`Paramètres invalides: ${validation.errors.join('; ')}`)
    if (((input.initialBaseQty ?? 0) > 0 || input.adoptAllBase === true) && input.market !== 'spot') {
      throw new Error('Position initiale : uniquement pour les bots spot')
    }
    if (input.adoptAllBase === true && input.mode === 'paper') {
      throw new Error("« Adopter tout » lit le solde réel via l'API — en paper, saisissez une quantité chiffrée")
    }
    if (input.allocation <= 0 && (input.initialBaseQty ?? 0) <= 0 && input.adoptAllBase !== true) {
      throw new Error('Départ vide : donnez une allocation (quote) OU une position initiale (coins) — sinon le bot n\'a rien à gérer')
    }
    if (input.market === 'futures' && input.mode !== 'paper') {
      // doublon par COMPTE effectif : deux bots futures sur la même paire ne
      // se mélangent que s'ils partagent le même compte OKX
      const cred = effectiveCredentialName(input.mode, input.credentialName)
      const others = (await this.listConfigs()).filter(
        (b) =>
          b.market === 'futures' &&
          b.symbol === input.symbol &&
          effectiveCredentialName(b.mode, b.credentialName) === cred,
      )
      if (others.length > 0) {
        throw new Error(
          `Un bot futures existe déjà sur ${input.symbol} pour le compte « ${cred} » — les positions seraient mélangées sur l'exchange`,
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
      credentialName: config.credentialName ?? null,
      params: config.params,
      allocation: config.allocation,
      initialBaseQty: config.initialBaseQty ?? null,
      adoptAllBase: config.adoptAllBase ?? null,
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
    // Départ en base : le front envoie le formulaire COMPLET et JSON.stringify
    // supprime les clés undefined → « décoché » / « vidé » arrive comme ABSENCE
    // de clé. Dès que le patch touche l'un des deux champs, l'absence de
    // l'autre signifie « effacé » — sinon un adoptAllBase=true sauvegardé une
    // fois se recolle à chaque édition (impossible à décocher).
    if ('adoptAllBase' in patch || 'initialBaseQty' in patch) {
      merged.adoptAllBase = patch.adoptAllBase === true ? true : undefined
      merged.initialBaseQty =
        typeof patch.initialBaseQty === 'number' && patch.initialBaseQty > 0 ? patch.initialBaseQty : undefined
    }
    // même convention d'ABSENCE que ci-dessus : dès que le patch touche le mode
    // ou le compte, l'absence de credentialName signifie « compte par défaut »
    if ('mode' in patch || 'credentialName' in patch) {
      merged.credentialName =
        typeof patch.credentialName === 'string' && patch.credentialName !== '' ? patch.credentialName : undefined
    }
    merged.credentialName = await this.checkCredential(merged.mode, merged.credentialName)
    const entry = registry.get(merged.strategyId)
    if (entry.def.symbol !== undefined) merged.symbol = entry.def.symbol
    if (!entry.def.markets.includes(merged.market)) {
      throw new Error(`La stratégie '${entry.def.name}' ne supporte pas le marché ${merged.market}`)
    }
    const validation = validateParams(entry.def.schema, merged.params)
    if (!validation.ok) throw new Error(`Paramètres invalides: ${validation.errors.join('; ')}`)
    merged.params = validation.values
    if (((merged.initialBaseQty ?? 0) > 0 || merged.adoptAllBase === true) && merged.market !== 'spot') {
      throw new Error('Position initiale : uniquement pour les bots spot')
    }
    if (merged.adoptAllBase === true && merged.mode === 'paper') {
      throw new Error("« Adopter tout » lit le solde réel via l'API — en paper, saisissez une quantité chiffrée")
    }
    if (merged.allocation <= 0 && (merged.initialBaseQty ?? 0) <= 0 && merged.adoptAllBase !== true) {
      throw new Error('Départ vide : donnez une allocation (quote) OU une position initiale (coins) — sinon le bot n\'a rien à gérer')
    }
    await this.db
      .update(botsTable)
      .set({
        name: merged.name,
        strategyId: merged.strategyId,
        market: merged.market,
        symbol: merged.symbol,
        mode: merged.mode,
        credentialName: merged.credentialName ?? null,
        params: merged.params,
        allocation: merged.allocation,
        initialBaseQty: merged.initialBaseQty ?? null,
        adoptAllBase: merged.adoptAllBase ?? null,
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
      // un start à mi-chemin peut avoir enregistré l'adapter sur le routeur et
      // ouvert des subscriptions : les libérer, sinon adapter zombie
      runner.releaseExec()
      this.runners.delete(id)
      hub.publish('bots', { t: 'bot:removed', botId: id })
      throw err
    }
  }

  async stop(
    id: string,
    opts: {
      cancelOrders?: boolean
      runOnStopHook?: boolean
      reason?: string
      killed?: boolean
      keepDesired?: boolean
    } = {},
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

  async setKillSwitch(active: boolean): Promise<void> {
    this.killSwitchActive = active
    this.globalRisk = { ...this.globalRisk, killSwitchActive: active }
    await this.settings.setGlobalRisk(this.globalRisk)
    if (!active) sendTelegram('✅ <b>Kill switch désactivé</b> — démarrages de bots autorisés')
    if (active) {
      sendTelegram('🚨 <b>KILL SWITCH ACTIVÉ</b> — gel de tous les bots (aucune transaction)')
      for (const id of [...this.runners.keys()]) {
        // kill = gel immédiat : aucune transaction (pas de hook onStop, pas de
        // fermeture). Les positions restent telles quelles, corrections à la main.
        await this.stop(id, {
          runOnStopHook: false,
          reason: 'kill switch',
          killed: true,
        }).catch(() => {})
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

  async getRouter(credName: string, creds: OkxCredentials, demo: boolean): Promise<OkxUserStreamRouter> {
    // One router per ACCOUNT (credential) : chaque compte/sous-compte OKX a son
    // propre flux privé — les fills d'un sous-compte n'arrivent QUE sur le
    // socket loggé avec sa clé. Un seul socket fan-out pour tous les bots du
    // même compte.
    let router = this.routers.get(credName)
    if (!router) {
      const onError = (err: Error) => console.error(`User stream ${credName} error:`, err.message)
      const stream = new OkxPrivateStream(creds, demo, onError, () => {
        void this.onStreamLoginDeath(credName)
      })
      router = new OkxUserStreamRouter(stream, onError)
      this.routers.set(credName, router)
      try {
        // start() ne résout qu'au login réussi : un flux privé mort fait échouer
        // le démarrage du bot (retries) au lieu de le laisser trader en aveugle
        await router.start()
      } catch (err) {
        this.routers.delete(credName)
        router.stop()
        throw err
      }
    }
    return router
  }

  /**
   * Le login du flux privé a été refusé EN PLEINE VIE (rotation de clés, IP
   * retirée de la whitelist, horloge) : les fills n'arrivent plus et ça ne
   * reviendra pas tout seul. Trader en aveugle est interdit → suspendre les
   * bots du COMPTE (ordres CONSERVÉS sur l'exchange, desiredRunning conservé),
   * alerter, retenter toutes les 5 min — le reconcile de la reprise rattrapera
   * les fills manqués pendant la coupure.
   */
  private async onStreamLoginDeath(credName: string): Promise<void> {
    const router = this.routers.get(credName)
    router?.stop()
    this.routers.delete(credName)
    const ids = [...this.runners.entries()]
      .filter(([, r]) => effectiveCredentialName(r.config.mode, r.config.credentialName) === credName)
      .map(([id]) => id)
    if (ids.length > 0) {
      sendTelegram(
        `🚨 <b>Flux privé OKX (compte ${credName}) mort</b> : login refusé (clés/IP/horloge ?) — ` +
          `${ids.length} bot(s) suspendu(s), ordres conservés. Nouvelle tentative toutes les 5 min.`,
      )
    }
    for (const id of ids) {
      await this.stop(id, {
        keepDesired: true,
        cancelOrders: false,
        runOnStopHook: false,
        reason: 'flux privé OKX mort (login refusé) — bot suspendu',
      }).catch(() => {})
    }
    this.scheduleStreamRetry(credName)
  }

  private scheduleStreamRetry(credName: string): void {
    if (this.streamRetryTimers.has(credName)) return
    const t = setTimeout(() => {
      this.streamRetryTimers.delete(credName)
      void this.resumeSuspended(credName)
    }, 300_000)
    this.streamRetryTimers.set(credName, t)
  }

  /** Reprise des bots suspendus par une mort du flux privé : start() recrée le
   *  routeur (login attendu) — s'il échoue encore, on re-planifie dans 5 min. */
  private async resumeSuspended(credName: string): Promise<void> {
    if (this.killSwitchActive) return
    const rows = await this.db.select().from(botsTable)
    const candidates = rows.filter(
      (r) =>
        r.desiredRunning &&
        effectiveCredentialName(r.mode as BotConfig['mode'], r.credentialName) === credName &&
        !this.runners.has(r.id),
    )
    if (candidates.length === 0) return
    let failed = 0
    for (const row of candidates) {
      try {
        await this.start(row.id)
      } catch (err) {
        failed++
        console.error(`Reprise du bot ${row.id} (compte ${credName}) échouée:`, err instanceof Error ? err.message : err)
      }
    }
    if (failed > 0) this.scheduleStreamRetry(credName)
    else sendTelegram(`✅ Flux privé OKX (compte ${credName}) rétabli — ${candidates.length} bot(s) relancé(s)`)
  }

  releaseAdapter(credName: string, adapter: OKXLiveAdapter): void {
    const router = this.routers.get(credName)
    if (!router) return
    router.unregister(adapter)
    if (router.size === 0) {
      router.stop()
      this.routers.delete(credName)
    }
  }

  async stopAll(): Promise<void> {
    for (const t of this.streamRetryTimers.values()) clearTimeout(t)
    this.streamRetryTimers.clear()
    // Arrêt du serveur (redeploy) : NE PAS annuler les ordres (le stop de
    // protection résident doit survivre — reconcile le ré-adopte au redémarrage)
    // et NE PAS exécuter onStop (même son cancelAll est indésirable ici :
    // le bot reprend exactement où il en était, ordres résidents compris).
    for (const id of [...this.runners.keys()]) {
      await this.stop(id, {
        reason: 'arrêt du serveur',
        keepDesired: true,
        cancelOrders: false,
        runOnStopHook: false,
      }).catch(() => {})
    }
  }
}
