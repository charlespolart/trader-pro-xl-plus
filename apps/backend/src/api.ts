import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Hono } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import { and, desc, eq } from 'drizzle-orm'
import { fills as fillsTable, orders as ordersTable, trades as tradesTable, type Db } from '@tpx/db'
import {
  DEFAULT_BACKTEST_VALUES,
  DEFAULT_FEES,
  defaultParams,
  isInterval,
  type BacktestConfig,
  type BotConfig,
  type Interval,
  type MarketType,
  type SymbolInfo,
} from '@tpx/shared'
import { ALL_PATTERNS, candlePatterns, type PatternName } from '@tpx/core'
import { BinanceMarketData, BinanceRest, CandleStore, OkxAccount, OkxRest, execQuoteAsset, instType, toInstId } from '@tpx/data'
import { authEnabled, env } from './env'
import { issueToken } from './crypto'
import { registry } from './strategies'
import type { SettingsService } from './services/settings'
import type { CredentialsService } from './services/credentials'
import type { BotManager } from './services/botManager'
import type { RefitService, RefitConfig } from './services/refit'
import { DEFAULT_SPACES } from './services/refit'
import type { BacktestRunner } from './services/backtestRunner'
import type { OptimizerService, OptimizationRequest } from './services/optimizer'
import type { DownloadService, DownloadRequest } from './services/downloads'

export interface Services {
  db: Db
  settings: SettingsService
  credentials: CredentialsService
  bots: BotManager
  refit: RefitService
  backtests: BacktestRunner
  optimizer: OptimizerService
  downloads: DownloadService
}

const COOKIE = 'tpx_session'

function asMarket(v: string | undefined): MarketType {
  if (v !== 'spot' && v !== 'futures') throw new Error(`market invalide: ${v}`)
  return v
}

function asInterval(v: string | undefined): Interval {
  if (!v || !isInterval(v)) throw new Error(`interval invalide: ${v}`)
  return v
}

const symbolsCache = new Map<string, { at: number; symbols: SymbolInfo[] }>()
const accountCache = new Map<string, { at: number; data: unknown }>()

export function buildApi(s: Services): Hono {
  const api = new Hono()

  api.onError((err, c) => {
    const msg = err instanceof Error ? err.message : String(err)
    // erreur non gérée = problème SERVEUR (DB, OKX…) → 500, pas 400 : un
    // « Bad Request » sur une panne interne envoie le débogage sur la
    // mauvaise piste (vécu : migration locale manquante affichée en 400)
    return c.json({ error: msg }, 500)
  })

  // ------------------------------------------------------------------ auth

  api.post('/auth/login', async (c) => {
    const body = (await c.req.json()) as { password?: string }
    if (!authEnabled) return c.json({ ok: true, authEnabled: false })
    if (body.password !== env.adminPassword) return c.json({ error: 'Mot de passe incorrect' }, 401)
    const token = issueToken()
    setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 30 * 86400 })
    return c.json({ ok: true, token })
  })

  api.post('/auth/logout', (c) => {
    deleteCookie(c, COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  api.get('/auth/me', (c) => c.json({ ok: true, authEnabled }))

  // ------------------------------------------------------------ strategies

  api.get('/strategies', (c) => c.json(registry.list().map((i) => registry.toDTO(i))))

  api.post('/strategies/reload', async (c) => {
    await registry.reload()
    return c.json(registry.list().map((i) => registry.toDTO(i)))
  })

  api.get('/strategies/:id/source', async (c) => {
    const id = c.req.param('id')
    if (!/^[\w-]+$/.test(id)) return c.json({ error: 'id invalide' }, 400)
    const source = await readFile(join(env.strategiesDir, `${id}.ts`), 'utf8')
    return c.json({ id, source })
  })

  api.put('/strategies/:id/source', async (c) => {
    const id = c.req.param('id')
    if (!/^[\w-]+$/.test(id)) return c.json({ error: 'id invalide' }, 400)
    const body = (await c.req.json()) as { source?: string }
    if (typeof body.source !== 'string' || body.source.length === 0) {
      return c.json({ error: 'source manquante' }, 400)
    }
    await writeFile(join(env.strategiesDir, `${id}.ts`), body.source, 'utf8')
    await registry.reload()
    const item = registry.list().find((i) => i.id === id)
    return c.json(item ? registry.toDTO(item) : { id, error: 'introuvable après écriture' })
  })

  // ------------------------------------------------------------------ bots

  api.get('/bots', async (c) => c.json(await s.bots.infoList()))

  api.post('/bots', async (c) => {
    const body = (await c.req.json()) as Partial<BotConfig>
    if (!body.strategyId || !body.symbol || !body.market || !body.mode) {
      return c.json({ error: 'strategyId, market, symbol et mode sont requis' }, 400)
    }
    const entry = registry.get(body.strategyId)
    const config = await s.bots.create({
      name: body.name ?? `${entry.def.name} ${body.symbol}`,
      strategyId: body.strategyId,
      market: asMarket(body.market),
      symbol: body.symbol.toUpperCase(),
      mode: body.mode,
      params: body.params ?? defaultParams(entry.def.schema),
      allocation: body.allocation ?? 1000,
      initialBaseQty:
        typeof body.initialBaseQty === 'number' && body.initialBaseQty > 0 ? body.initialBaseQty : undefined,
      adoptAllBase: body.adoptAllBase === true ? true : undefined,
      leverage: body.leverage ?? 1,
      risk: body.risk ?? {},
    })
    return c.json(config)
  })

  api.put('/bots/:id', async (c) => {
    const patch = (await c.req.json()) as Partial<BotConfig>
    return c.json(await s.bots.update(c.req.param('id'), patch))
  })

  api.delete('/bots/:id', async (c) => {
    await s.bots.remove(c.req.param('id'))
    return c.json({ ok: true })
  })

  api.post('/bots/:id/start', async (c) => {
    await s.bots.start(c.req.param('id'))
    return c.json({ ok: true })
  })

  api.post('/bots/:id/stop', async (c) => {
    // arrêter un bot ne transige jamais — pas de fermeture de position
    await s.bots.stop(c.req.param('id'), { reason: 'arrêt manuel' })
    return c.json({ ok: true })
  })

  api.post('/bots/:id/resume', (c) => {
    s.bots.resume(c.req.param('id'))
    return c.json({ ok: true })
  })

  api.get('/bots/:id/chart', (c) => {
    const runner = s.bots.runner(c.req.param('id'))
    if (!runner) return c.json({ error: 'Bot non démarré' }, 404)
    return c.json(runner.chartData())
  })

  api.get('/bots/:id/logs', (c) => {
    const runner = s.bots.runner(c.req.param('id'))
    return c.json(runner ? runner.recentLogs : [])
  })

  // ---- refit périodique
  api.get('/bots/:id/refit', async (c) => {
    const botId = c.req.param('id')
    const bot = await s.bots.getConfig(botId)
    const state = await s.refit.getState(botId)
    return c.json({ ...state, defaultSpace: bot ? (DEFAULT_SPACES[bot.strategyId] ?? null) : null })
  })

  api.put('/bots/:id/refit', async (c) => {
    const config = (await c.req.json()) as RefitConfig
    return c.json(await s.refit.setConfig(c.req.param('id'), config))
  })

  api.post('/bots/:id/refit/run', (c) => {
    const botId = c.req.param('id')
    // long (grille en workers) → fire-and-forget, le rapport arrive dans
    // l'état du refit + journal du bot + Telegram
    void s.refit.run(botId).catch((err: unknown) => {
      console.error(`refit ${botId}:`, err)
    })
    return c.json({ started: true })
  })

  api.post('/bots/:id/refit/apply', async (c) => {
    const applied = await s.refit.tryApply(c.req.param('id'))
    return c.json({ applied })
  })

  api.post('/bots/:id/refit/discard', async (c) => {
    await s.refit.discardProposal(c.req.param('id'))
    return c.json({ ok: true })
  })

  api.get('/bots/:id/orders', async (c) => {
    const rows = await s.db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.botId, c.req.param('id')))
      .orderBy(desc(ordersTable.createdAt))
      .limit(200)
    return c.json(rows)
  })

  api.get('/bots/:id/fills', async (c) => {
    const rows = await s.db
      .select()
      .from(fillsTable)
      .where(eq(fillsTable.botId, c.req.param('id')))
      .orderBy(desc(fillsTable.time))
      .limit(500)
    return c.json(rows)
  })

  // ---------------------------------------------------------------- trades

  api.get('/trades', async (c) => {
    const botId = c.req.query('botId')
    const limit = Math.min(1000, Number(c.req.query('limit') ?? 200))
    const rows = botId
      ? await s.db
          .select()
          .from(tradesTable)
          .where(eq(tradesTable.botId, botId))
          .orderBy(desc(tradesTable.entryTime))
          .limit(limit)
      : await s.db.select().from(tradesTable).orderBy(desc(tradesTable.entryTime)).limit(limit)
    return c.json(rows)
  })

  // ------------------------------------------------------------- backtests

  api.get('/backtests', async (c) => c.json(await s.backtests.list()))

  api.post('/backtests', async (c) => {
    const body = (await c.req.json()) as { config?: Partial<BacktestConfig>; label?: string }
    const cfg = body.config
    if (!cfg?.strategyId || !cfg.market || !cfg.symbol || !cfg.start || !cfg.end) {
      return c.json({ error: 'strategyId, market, symbol, start, end sont requis' }, 400)
    }
    const market = asMarket(cfg.market)
    const entry = registry.get(cfg.strategyId)
    const config: BacktestConfig = {
      ...DEFAULT_BACKTEST_VALUES,
      ...cfg,
      fees: cfg.fees ?? DEFAULT_FEES[market],
      market,
      symbol: cfg.symbol.toUpperCase(),
      params: cfg.params ?? defaultParams(entry.def.schema),
    } as BacktestConfig
    const id = await s.backtests.submit(config, body.label)
    return c.json({ id })
  })

  api.get('/backtests/:id', async (c) => {
    const run = await s.backtests.get(c.req.param('id'))
    return run ? c.json(run) : c.json({ error: 'introuvable' }, 404)
  })

  api.get('/backtests/:id/result', async (c) => {
    const result = await s.backtests.result(c.req.param('id'), {
      from: c.req.query('from') ? Number(c.req.query('from')) : undefined,
      to: c.req.query('to') ? Number(c.req.query('to')) : undefined,
      maxEquityPoints: c.req.query('maxEquityPoints') ? Number(c.req.query('maxEquityPoints')) : undefined,
    })
    return result ? c.json(result) : c.json({ error: 'introuvable' }, 404)
  })

  api.post('/backtests/:id/cancel', async (c) => {
    await s.backtests.cancel(c.req.param('id'))
    return c.json({ ok: true })
  })

  api.delete('/backtests/:id', async (c) => {
    await s.backtests.remove(c.req.param('id'))
    return c.json({ ok: true })
  })

  // ---------------------------------------------------------- optimizations

  api.get('/optimizations', async (c) => c.json(await s.optimizer.list()))

  api.post('/optimizations', async (c) => {
    const body = (await c.req.json()) as Partial<OptimizationRequest>
    if (!body.baseConfig || !body.space || !body.objective) {
      return c.json({ error: 'baseConfig, space et objective sont requis' }, 400)
    }
    const market = asMarket(body.baseConfig.market)
    const entry = registry.get(body.baseConfig.strategyId)
    const baseConfig: BacktestConfig = {
      ...DEFAULT_BACKTEST_VALUES,
      ...body.baseConfig,
      fees: body.baseConfig.fees ?? DEFAULT_FEES[market],
      market,
      params: body.baseConfig.params ?? defaultParams(entry.def.schema),
    }
    const id = await s.optimizer.submit({
      label: body.label,
      baseConfig,
      space: body.space,
      objective: body.objective,
      walkForward: body.walkForward,
    })
    return c.json({ id })
  })

  api.get('/optimizations/:id', async (c) => {
    const row = await s.optimizer.get(c.req.param('id'))
    return row ? c.json(row) : c.json({ error: 'introuvable' }, 404)
  })

  api.get('/optimizations/:id/artifact', async (c) => {
    const data = await s.optimizer.readArtifact(c.req.param('id'))
    return data ? c.json(data) : c.json({ error: 'introuvable' }, 404)
  })

  api.post('/optimizations/:id/cancel', async (c) => {
    await s.optimizer.cancel(c.req.param('id'))
    return c.json({ ok: true })
  })

  api.delete('/optimizations/:id', async (c) => {
    await s.optimizer.remove(c.req.param('id'))
    return c.json({ ok: true })
  })

  // ---------------------------------------------------------------- market

  api.get('/market/klines', async (c) => {
    const market = asMarket(c.req.query('market'))
    const symbol = (c.req.query('symbol') ?? '').toUpperCase()
    const interval = asInterval(c.req.query('interval'))
    const end = Number(c.req.query('end') ?? Date.now())
    const start = Number(c.req.query('start') ?? end - 500 * 60_000)
    if (!symbol) return c.json({ error: 'symbol requis' }, 400)
    const store = new CandleStore(s.db)
    if (c.req.query('ensure') !== 'false') {
      await store.ensureRange(market, symbol, interval, start, end)
    }
    const candles = await store.getCandles(market, symbol, interval, start, end)
    return c.json(candles.slice(-20_000))
  })

  /** scan de patterns de bougies sur une plage — outil de vérification visuelle */
  api.get('/market/patterns', async (c) => {
    const market = asMarket(c.req.query('market'))
    const symbol = (c.req.query('symbol') ?? '').toUpperCase()
    const interval = asInterval(c.req.query('interval'))
    const end = Number(c.req.query('end') ?? Date.now())
    const start = Number(c.req.query('start') ?? end - 60 * 86_400_000)
    const namesRaw = c.req.query('names') ?? 'all'
    const requireTrend = c.req.query('requireTrend') !== 'false'
    const strictColor = c.req.query('strictColor') === 'true'
    const strictGaps = c.req.query('strictGaps') === 'true'
    const trendMinPct = Number(c.req.query('trendMinPct') ?? 0.8)
    if (!symbol) return c.json({ error: 'symbol requis' }, 400)
    const { INTERVAL_MS } = await import('@tpx/shared')
    if ((end - start) / INTERVAL_MS[interval] > 20_000) {
      return c.json({ error: 'Plage trop large (> 20 000 bougies) — réduisez la période ou montez l’intervalle' }, 400)
    }

    const names =
      namesRaw === 'all'
        ? undefined
        : namesRaw.split(',').filter((n): n is PatternName => (ALL_PATTERNS as string[]).includes(n))
    if (names !== undefined && names.length === 0) return c.json({ error: 'patterns inconnus' }, 400)

    const spec = candlePatterns(names as PatternName[] | undefined, { requireTrend, trendMinPct, strictColor, strictGaps })
    const warmupMs = (spec.warmup + 2) * INTERVAL_MS[interval]
    const store = new CandleStore(s.db)
    await store.ensureRange(market, symbol, interval, start - warmupMs, end)
    const all = await store.getCandles(market, symbol, interval, start - warmupMs, end)

    const inst = spec.create()
    const detections: { time: number; name: string; dir: number }[] = []
    const counts: Record<string, number> = {}
    const windowCandles: typeof all = []
    for (const candle of all) {
      const v = inst.update(candle) as Record<string, number> | null
      if (candle.openTime < start) continue
      windowCandles.push(candle)
      if (!v) continue
      for (const [name, dir] of Object.entries(v)) {
        if (dir !== 0) {
          detections.push({ time: candle.openTime, name, dir })
          counts[name] = (counts[name] ?? 0) + 1
        }
      }
    }
    return c.json({ candles: windowCandles, detections, counts, available: ALL_PATTERNS })
  })

  api.get('/market/symbols', async (c) => {
    const market = asMarket(c.req.query('market'))
    const cached = symbolsCache.get(market)
    if (cached && Date.now() - cached.at < 3_600_000) return c.json(cached.symbols)
    const mkt = new BinanceMarketData(new BinanceRest({ market }))
    const symbols = await mkt.allSymbols()
    symbolsCache.set(market, { at: Date.now(), symbols })
    return c.json(symbols)
  })

  // --------------------------------------------------------------- account

  api.get('/account', async (c) => {
    const mode = (c.req.query('mode') ?? 'live') as 'live' | 'testnet'
    const cacheKey = mode
    const cached = accountCache.get(cacheKey)
    if (cached && Date.now() - cached.at < 10_000) return c.json(cached.data)

    const creds = await s.credentials.get(mode)
    if (!creds) {
      return c.json({ configured: false, mode, killSwitchActive: s.bots.killSwitchActive })
    }
    const testnet = mode === 'testnet'
    const account = new OkxAccount(new OkxRest({ demo: testnet, credentials: creds }))
    const [balances, positions, tickers] = await Promise.all([
      account.balances('spot').catch(() => []),
      account.allPositions().catch(() => []),
      // valorisation : tous les tickers spot en 1 appel public (prix last)
      new OkxRest({ demo: testnet })
        .public<{ instId: string; last: string }>('/api/v5/market/tickers', { instType: 'SPOT' })
        .catch(() => []),
    ])
    const px = new Map<string, number>()
    for (const t of tickers) {
      const last = Number(t.last)
      if (last > 0) px.set(t.instId, last) // last vide/0 = paire sans prix → « inconnu », pas 0
    }
    const STABLES = new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD'])
    const spot = balances
      .filter((b) => b.free + b.locked > 0)
      .map((b) => {
        const qty = b.free + b.locked
        const price = STABLES.has(b.asset) ? 1 : (px.get(`${b.asset}-USDT`) ?? px.get(`${b.asset}-USDC`) ?? null)
        return { ...b, price, valueQuote: price !== null ? qty * price : null }
      })
      .sort((a, c) => (c.valueQuote ?? 0) - (a.valueQuote ?? 0))
    const totalValueQuote = spot.reduce((s2, b) => s2 + (b.valueQuote ?? 0), 0)
    const data = {
      configured: true,
      mode,
      spot,
      totalValueQuote,
      futures: [],
      positions: positions
        .filter((p) => p.qty !== 0)
        .map((p) => ({
          symbol: p.instId,
          positionAmt: p.qty,
          entryPrice: p.entryPrice,
          leverage: p.leverage,
          liquidationPrice: p.liquidationPrice ?? 0,
          unRealizedProfit: p.unrealizedPnl,
        })),
      totalExposureQuote: s.bots.totalExposureQuote([mode]),
      killSwitchActive: s.bots.killSwitchActive,
      globalRisk: s.bots.globalRisk,
    }
    accountCache.set(cacheKey, { at: Date.now(), data })
    return c.json(data)
  })

  // live OKX maker/taker/level for a symbol. null = PAS DE CLÉS ;
  // { error } = clés présentes mais lecture impossible (à afficher tel quel).
  api.get('/fees/:name/:market/:symbol', async (c) => {
    const name = c.req.param('name') as 'live' | 'testnet'
    const creds = await s.credentials.get(name)
    if (!creds) return c.json(null)
    const market = asMarket(c.req.param('market'))
    const symbol = c.req.param('symbol').toUpperCase()
    const si = await new BinanceMarketData(new BinanceRest({ market })).symbolInfo(symbol)
    if (!si) return c.json({ error: `symbole inconnu : ${symbol}` })
    const instId = toInstId(si.baseAsset, execQuoteAsset(si.quoteAsset, name === 'testnet'), market)
    const account = new OkxAccount(new OkxRest({ demo: name === 'testnet', credentials: creds }))
    const fee = await account.tradeFee(instType(market), instId)
    return c.json(fee ?? { error: 'lecture des frais impossible côté OKX' })
  })

  // ------------------------------------------------------------------ risk

  api.get('/risk', (c) => c.json(s.bots.globalRisk))

  api.put('/risk', async (c) => {
    const cfg = (await c.req.json()) as Parameters<BotManager['setGlobalRisk']>[0]
    await s.bots.setGlobalRisk(cfg)
    return c.json(s.bots.globalRisk)
  })

  api.post('/risk/killswitch', async (c) => {
    // le kill switch gèle les bots sans aucune transaction (pas de fermeture)
    const body = (await c.req.json()) as { active: boolean }
    await s.bots.setKillSwitch(body.active)
    return c.json({ killSwitchActive: s.bots.killSwitchActive })
  })

  // ------------------------------------------------------------------ data

  api.get('/data/coverage', async (c) => {
    const market = asMarket(c.req.query('market'))
    const symbol = (c.req.query('symbol') ?? '').toUpperCase()
    const interval = asInterval(c.req.query('interval'))
    return c.json(await s.downloads.coverage(market, symbol, interval))
  })

  api.get('/data/aggdays', async (c) => {
    const market = asMarket(c.req.query('market'))
    const symbol = (c.req.query('symbol') ?? '').toUpperCase()
    return c.json(await s.downloads.aggDays(market, symbol))
  })

  api.get('/data/jobs', async (c) => c.json(await s.downloads.list()))

  api.post('/data/download', async (c) => {
    const body = (await c.req.json()) as DownloadRequest
    const id = await s.downloads.submit(body)
    return c.json({ id })
  })

  api.post('/data/jobs/:id/cancel', async (c) => {
    await s.downloads.cancel(c.req.param('id'))
    return c.json({ ok: true })
  })

  // -------------------------------------------------------------- settings

  api.get('/settings', async (c) => {
    return c.json({
      authEnabled,
      telegramConfigured: env.telegramToken.length > 0 && env.telegramChatId.length > 0,
      credentials: await s.credentials.status(),
      paperFees: {
        spot: await s.bots.paperFees('spot'),
        futures: await s.bots.paperFees('futures'),
      },
      backtestWorkers: env.backtestWorkers,
      dataDir: env.dataDir,
    })
  })

  api.put('/settings/credentials', async (c) => {
    const body = (await c.req.json()) as {
      name?: 'live' | 'testnet'
      apiKey?: string
      secret?: string
      passphrase?: string
    }
    if (!body.name || !body.apiKey || !body.secret) return c.json({ error: 'name, apiKey, secret requis' }, 400)
    await s.credentials.set(body.name, body.apiKey, body.secret, body.passphrase ?? '')
    return c.json({ ok: true })
  })

  api.delete('/settings/credentials/:name', async (c) => {
    await s.credentials.delete(c.req.param('name') as 'live' | 'testnet')
    return c.json({ ok: true })
  })

  api.put('/settings/paper-fees', async (c) => {
    const body = (await c.req.json()) as { market?: MarketType; fees?: unknown }
    if (!body.market || !body.fees) return c.json({ error: 'market et fees requis' }, 400)
    await s.settings.set(`paperFees:${asMarket(body.market)}`, body.fees)
    return c.json({ ok: true })
  })

  return api
}
