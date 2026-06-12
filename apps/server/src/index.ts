import { join } from 'node:path'
import { Hono } from 'hono'
import { createBunWebSocket } from 'hono/bun'
import { getCookie } from 'hono/cookie'
import { createDb } from '@tpx/db'
import { isInterval, type ClientCommand, type MarketType } from '@tpx/shared'
import { authEnabled, env } from './env'
import { verifyToken } from './crypto'
import { hub } from './wsHub'
import { registry } from './strategies'
import { buildApi, type Services } from './api'
import { SettingsService } from './services/settings'
import { CredentialsService } from './services/credentials'
import { BotManager } from './services/botManager'
import { BacktestRunner } from './services/backtestRunner'
import { OptimizerService } from './services/optimizer'
import { DownloadService } from './services/downloads'
import { liveFeeds } from './services/liveFeeds'

async function main(): Promise<void> {
  const db = createDb(env.databaseUrl)
  await registry.reload()

  const settings = new SettingsService(db)
  const credentials = new CredentialsService(db)
  const bots = new BotManager(db, settings, credentials)
  const backtests = new BacktestRunner(db)
  const optimizer = new OptimizerService(db)
  const downloads = new DownloadService(db)

  await backtests.init()
  await optimizer.init()
  await downloads.init()
  await bots.init()

  const services: Services = { db, settings, credentials, bots, backtests, optimizer, downloads }
  const app = new Hono()
  const { upgradeWebSocket, websocket } = createBunWebSocket()

  // ---- auth gate on /api/* (login/logout/me excluded)
  app.use('/api/*', async (c, next) => {
    if (!authEnabled || c.req.path.startsWith('/api/auth/')) return next()
    const token = getCookie(c, 'tpx_session') ?? c.req.header('authorization')?.replace(/^Bearer /, '')
    if (!verifyToken(token)) return c.json({ error: 'Non authentifié' }, 401)
    return next()
  })

  app.route('/api', buildApi(services))

  // ---- websocket: topic pub/sub + on-demand chart streams
  const chartStreams = new Map<string, { unsub: () => void; count: number }>()

  const acquireChartStream = (topic: string): void => {
    const m = /^candles:(spot|futures):([A-Z0-9]+):([0-9]+[smhdw])$/.exec(topic)
    if (!m || !isInterval(m[3]!)) return
    const existing = chartStreams.get(topic)
    if (existing) {
      existing.count++
      return
    }
    const market = m[1] as MarketType
    const symbol = m[2]!
    const interval = m[3]!
    const unsub = liveFeeds.subCandles(market, false, symbol, interval, (candle, closed) => {
      hub.publish(topic, { t: 'candle', market, symbol, interval, candle, closed })
    })
    chartStreams.set(topic, { unsub, count: 1 })
  }

  const releaseChartStream = (topic: string): void => {
    const entry = chartStreams.get(topic)
    if (!entry) return
    entry.count--
    if (entry.count <= 0) {
      entry.unsub()
      chartStreams.delete(topic)
    }
  }

  app.get(
    '/ws',
    upgradeWebSocket((c) => {
      const authorized = !authEnabled || verifyToken(getCookie(c, 'tpx_session'))
      return {
        onOpen: (_evt, ws) => {
          if (!authorized) {
            ws.close(4401, 'unauthorized')
            return
          }
          hub.add(ws, (data) => ws.send(data))
          ws.send(JSON.stringify({ topic: 'sys', event: { t: 'hello', serverTime: Date.now() } }))
        },
        onMessage: (evt, ws) => {
          if (!authorized) return
          let cmd: ClientCommand
          try {
            cmd = JSON.parse(String(evt.data)) as ClientCommand
          } catch {
            return
          }
          if (cmd.t === 'ping') {
            ws.send(JSON.stringify({ topic: 'sys', event: { t: 'pong' } }))
          } else if (cmd.t === 'subscribe') {
            hub.subscribe(ws, cmd.topic)
            acquireChartStream(cmd.topic)
          } else if (cmd.t === 'unsubscribe') {
            hub.unsubscribe(ws, cmd.topic)
            releaseChartStream(cmd.topic)
          }
        },
        onClose: (_evt, ws) => {
          for (const topic of hub.topicsOf(ws)) releaseChartStream(topic)
          hub.remove(ws)
        },
      }
    }),
  )

  // ---- static web UI (production build)
  app.get('*', async (c) => {
    const path = new URL(c.req.url).pathname
    if (path.startsWith('/api') || path === '/ws' || path.includes('..')) return c.notFound()
    let file = Bun.file(join(env.webDistDir, path === '/' ? '/index.html' : path))
    if (!(await file.exists())) file = Bun.file(join(env.webDistDir, 'index.html'))
    if (!(await file.exists())) {
      return c.text("UI non compilée. Dev: `bun run dev:web` (port 5173). Prod: `bun run build`.", 404)
    }
    return new Response(file)
  })

  const server = Bun.serve({
    port: env.port,
    fetch: app.fetch,
    websocket,
    idleTimeout: 120,
  })

  console.log(`tpx server prêt sur http://localhost:${server.port}  (auth: ${authEnabled ? 'ON' : 'OFF'})`)
  console.log(`stratégies chargées: ${registry.list().map((i) => i.id).join(', ') || 'aucune'}`)

  const shutdown = async (): Promise<void> => {
    console.log('Arrêt en cours — arrêt des bots…')
    await bots.stopAll()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

void main()
