import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { desc, eq, inArray } from 'drizzle-orm'
import { backtests as backtestsTable, type Db } from '@tpx/db'
import {
  downsample,
  type BacktestConfig,
  type BacktestMetrics,
  type BacktestResultDetail,
  type BacktestRun,
  type BacktestStatus,
} from '@tpx/shared'
import { env } from '../env'
import { hub } from '../wsHub'
import { registry } from '../strategies'
import type { WorkerOutMsg, WorkerRunMsg } from '../workers/backtestWorker'

interface ParsedArtifact {
  trades: BacktestResultDetail['trades']
  equity: BacktestResultDetail['equity']
  annotations: BacktestResultDetail['annotations']
  logs: BacktestResultDetail['logs']
  indicators: BacktestResultDetail['indicators']
}

export class BacktestRunner {
  private queue: string[] = []
  private active = new Map<string, Worker>()
  private artifactCache: { id: string; data: ParsedArtifact } | null = null

  constructor(private readonly db: Db) {}

  /** mark runs orphaned by a previous server crash */
  async init(): Promise<void> {
    await this.db
      .update(backtestsTable)
      .set({ status: 'error', error: 'Serveur redémarré pendant le run' })
      .where(inArray(backtestsTable.status, ['pending', 'fetching_data', 'running']))
  }

  async submit(config: BacktestConfig, label?: string): Promise<string> {
    registry.get(config.strategyId) // throws if unknown/broken
    const id = randomUUID()
    await this.db.insert(backtestsTable).values({
      id,
      label: label ?? config.label,
      strategyId: config.strategyId,
      market: config.market,
      symbol: config.symbol,
      config,
      status: 'pending',
      createdAt: Date.now(),
    })
    this.queue.push(id)
    this.publish(id, 'pending', 0)
    this.pump()
    return id
  }

  async cancel(id: string): Promise<void> {
    const qIdx = this.queue.indexOf(id)
    if (qIdx >= 0) {
      this.queue.splice(qIdx, 1)
      await this.setStatus(id, 'canceled', { finishedAt: Date.now() })
      return
    }
    const worker = this.active.get(id)
    if (worker) {
      worker.terminate()
      this.active.delete(id)
      await this.setStatus(id, 'canceled', { finishedAt: Date.now() })
      this.pump()
    }
  }

  async remove(id: string): Promise<void> {
    await this.cancel(id).catch(() => {})
    const rows = await this.db.select().from(backtestsTable).where(eq(backtestsTable.id, id))
    if (rows[0]?.artifactPath) await unlink(rows[0].artifactPath).catch(() => {})
    await this.db.delete(backtestsTable).where(eq(backtestsTable.id, id))
    if (this.artifactCache?.id === id) this.artifactCache = null
  }

  async list(limit = 100): Promise<BacktestRun[]> {
    const rows = await this.db.select().from(backtestsTable).orderBy(desc(backtestsTable.createdAt)).limit(limit)
    return rows.map((r) => this.rowToRun(r))
  }

  async get(id: string): Promise<BacktestRun | null> {
    const rows = await this.db.select().from(backtestsTable).where(eq(backtestsTable.id, id))
    return rows.length > 0 ? this.rowToRun(rows[0]!) : null
  }

  /**
   * Full result for the UI. Equity is downsampled; indicator/annotation
   * points can be windowed with from/to to keep payloads sane.
   */
  async result(
    id: string,
    opts: { from?: number; to?: number; maxEquityPoints?: number } = {},
  ): Promise<BacktestResultDetail | null> {
    const run = await this.get(id)
    if (!run) return null
    const rows = await this.db.select().from(backtestsTable).where(eq(backtestsTable.id, id))
    const artifactPath = rows[0]?.artifactPath
    if (!artifactPath) return { run, trades: [], equity: [], annotations: [], logs: [], indicators: [] }

    let artifact = this.artifactCache?.id === id ? this.artifactCache.data : null
    if (!artifact) {
      const gz = new Uint8Array(await Bun.file(artifactPath).arrayBuffer())
      artifact = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(gz))) as ParsedArtifact
      this.artifactCache = { id, data: artifact }
    }

    const from = opts.from ?? Number.NEGATIVE_INFINITY
    const to = opts.to ?? Number.POSITIVE_INFINITY
    const windowed = from !== Number.NEGATIVE_INFINITY || to !== Number.POSITIVE_INFINITY

    return {
      run,
      trades: artifact.trades,
      equity: downsample(artifact.equity, opts.maxEquityPoints ?? 5000),
      annotations: artifact.annotations.filter((a) => !windowed || !('time' in a) || (a.time >= from && a.time <= to)),
      logs: artifact.logs,
      indicators: artifact.indicators.map((s) => ({
        ...s,
        points: windowed ? s.points.filter(([t]) => t >= from && t <= to) : s.points,
      })),
    }
  }

  // -------------------------------------------------------------- internals

  private pump(): void {
    while (this.active.size < Math.max(1, env.backtestWorkers) && this.queue.length > 0) {
      const id = this.queue.shift()!
      void this.launch(id)
    }
  }

  private async launch(id: string): Promise<void> {
    const rows = await this.db.select().from(backtestsTable).where(eq(backtestsTable.id, id))
    if (rows.length === 0) return
    const config = rows[0]!.config as BacktestConfig

    let strategyPath: string
    try {
      strategyPath = registry.get(config.strategyId).path
    } catch (err) {
      await this.setStatus(id, 'error', { error: String(err), finishedAt: Date.now() })
      this.pump()
      return
    }

    const artifactPath = join(env.artifactsDir, 'backtests', `${id}.json.gz`)
    await this.setStatus(id, 'running', { startedAt: Date.now() })

    const worker = new Worker(new URL('../workers/backtestWorker.ts', import.meta.url))
    this.active.set(id, worker)
    let lastDbUpdate = 0

    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as WorkerOutMsg
      void (async () => {
        switch (msg.kind) {
          case 'data':
            this.publish(id, 'fetching_data', msg.total > 0 ? msg.done / msg.total : 0)
            break
          case 'progress': {
            this.publish(id, 'running', msg.ratio)
            const now = Date.now()
            if (now - lastDbUpdate > 2000) {
              lastDbUpdate = now
              await this.db.update(backtestsTable).set({ progress: msg.ratio }).where(eq(backtestsTable.id, id))
            }
            break
          }
          case 'done':
            await this.db
              .update(backtestsTable)
              .set({
                status: 'done',
                progress: 1,
                metrics: msg.metrics,
                haltedReason: msg.haltedReason,
                artifactPath,
                finishedAt: Date.now(),
              })
              .where(eq(backtestsTable.id, id))
            this.publish(id, 'done', 1)
            this.finish(id, worker)
            break
          case 'error':
            await this.setStatus(id, 'error', { error: msg.message, finishedAt: Date.now() })
            this.finish(id, worker)
            break
        }
      })()
    }
    worker.onerror = (ev) => {
      void this.setStatus(id, 'error', { error: ev.message ?? 'worker crash', finishedAt: Date.now() }).then(() =>
        this.finish(id, worker),
      )
    }

    const msg: WorkerRunMsg = {
      kind: 'run',
      config,
      strategyPath,
      dataDir: env.dataDir,
      databaseUrl: env.databaseUrl,
      artifactPath,
    }
    worker.postMessage(msg)
  }

  private finish(id: string, worker: Worker): void {
    worker.terminate()
    this.active.delete(id)
    this.pump()
  }

  private async setStatus(
    id: string,
    status: BacktestStatus,
    extra: Partial<{ error: string; startedAt: number; finishedAt: number }> = {},
  ): Promise<void> {
    await this.db.update(backtestsTable).set({ status, ...extra }).where(eq(backtestsTable.id, id))
    this.publish(id, status, status === 'done' ? 1 : 0, extra.error)
  }

  private publish(id: string, status: BacktestStatus, progress: number, error?: string): void {
    hub.publish('backtests', { t: 'backtest:progress', id, status, progress, error })
  }

  private rowToRun(r: typeof backtestsTable.$inferSelect): BacktestRun {
    return {
      id: r.id,
      config: r.config as BacktestConfig,
      status: r.status as BacktestStatus,
      progress: r.progress,
      error: r.error ?? undefined,
      createdAt: r.createdAt,
      startedAt: r.startedAt ?? undefined,
      finishedAt: r.finishedAt ?? undefined,
      metrics: (r.metrics as BacktestMetrics | null) ?? undefined,
    }
  }
}
