import { randomUUID } from 'node:crypto'
import { mkdir, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { desc, eq } from 'drizzle-orm'
import { optimizations as optTable, type Db } from '@tpx/db'
import {
  INTERVAL_MS,
  validateParams,
  type BacktestConfig,
  type BacktestMetrics,
  type ParamValues,
} from '@tpx/shared'
import { expandGrid, scoreMetrics, walkForwardWindows, type Objective, type OptimizeSpace } from '@tpx/core'
import { CandleStore } from '@tpx/data'
import { env } from '../env'
import { hub } from '../wsHub'
import { registry } from '../strategies'
import type { WorkerOutMsg, WorkerRunMsg } from '../workers/backtestWorker'

export interface OptimizationRequest {
  label?: string
  baseConfig: BacktestConfig
  space: OptimizeSpace
  objective: Objective
  walkForward?: { windows: number; isRatio: number; anchored?: boolean }
}

export interface ComboResult {
  params: ParamValues
  metrics: BacktestMetrics | null
  score: number
  error?: string
}

interface WfWindowResult {
  index: number
  isStart: number
  isEnd: number
  oosStart: number
  oosEnd: number
  bestParams: ParamValues
  isScore: number
  oosMetrics: BacktestMetrics | null
}

export class OptimizerService {
  private aborts = new Map<string, AbortController>()

  constructor(private readonly db: Db) {}

  async init(): Promise<void> {
    await this.db
      .update(optTable)
      .set({ status: 'error', error: 'Serveur redémarré pendant le run' })
      .where(eq(optTable.status, 'running'))
  }

  async list(limit = 50) {
    return this.db.select().from(optTable).orderBy(desc(optTable.createdAt)).limit(limit)
  }

  async get(id: string) {
    const rows = await this.db.select().from(optTable).where(eq(optTable.id, id))
    return rows[0] ?? null
  }

  async readArtifact(id: string): Promise<unknown | null> {
    const row = await this.get(id)
    if (!row?.artifactPath) return null
    const gz = new Uint8Array(await Bun.file(row.artifactPath).arrayBuffer())
    return JSON.parse(new TextDecoder().decode(Bun.gunzipSync(gz)))
  }

  async cancel(id: string): Promise<void> {
    this.aborts.get(id)?.abort()
  }

  async remove(id: string): Promise<void> {
    this.aborts.get(id)?.abort()
    const row = await this.get(id)
    if (row?.artifactPath) await unlink(row.artifactPath).catch(() => {})
    await this.db.delete(optTable).where(eq(optTable.id, id))
  }

  async submit(req: OptimizationRequest): Promise<string> {
    const entry = registry.get(req.baseConfig.strategyId)
    const baseValidation = validateParams(entry.def.schema, req.baseConfig.params)
    if (!baseValidation.ok) throw new Error(`Paramètres de base invalides: ${baseValidation.errors.join('; ')}`)
    const combos = expandGrid(entry.def.schema, baseValidation.values, req.space)

    const wf = req.walkForward
    const total = wf ? wf.windows * (combos.length + 1) : combos.length

    const id = randomUUID()
    await this.db.insert(optTable).values({
      id,
      label: req.label,
      strategyId: req.baseConfig.strategyId,
      market: req.baseConfig.market,
      symbol: req.baseConfig.symbol,
      config: { baseConfig: req.baseConfig, space: req.space, objective: req.objective, walkForward: wf },
      status: 'running',
      done: 0,
      total,
      createdAt: Date.now(),
    })

    const abort = new AbortController()
    this.aborts.set(id, abort)
    void this.run(id, req, combos, abort.signal)
      .catch(async (err: unknown) => {
        await this.db
          .update(optTable)
          .set({ status: abort.signal.aborted ? 'canceled' : 'error', error: String(err), finishedAt: Date.now() })
          .where(eq(optTable.id, id))
      })
      .finally(() => this.aborts.delete(id))
    return id
  }

  // -------------------------------------------------------------- internals

  private async run(id: string, req: OptimizationRequest, combos: ParamValues[], signal: AbortSignal): Promise<void> {
    const entry = registry.get(req.baseConfig.strategyId)
    let done = 0
    const bump = async (): Promise<void> => {
      done++
      hub.publish('backtests', { t: 'optimization:progress', id, done, total: 0, status: 'running' })
      if (done % 5 === 0) await this.db.update(optTable).set({ done }).where(eq(optTable.id, id))
    }

    // pre-download every (symbol, interval) the sweep can touch, once,
    // so parallel workers don't race on the same gaps
    await this.preEnsure(req.baseConfig, combos, entry.def.data)

    const runMetrics = async (config: BacktestConfig): Promise<ComboResult> => {
      if (signal.aborted) throw new Error('canceled')
      try {
        const metrics = await this.runInWorker(config, signal)
        return { params: config.params, metrics, score: scoreMetrics(metrics, req.objective) }
      } catch (err) {
        if (signal.aborted) throw err
        return { params: config.params, metrics: null, score: Number.NEGATIVE_INFINITY, error: String(err) }
      }
    }

    const pool = async (configs: BacktestConfig[]): Promise<ComboResult[]> => {
      const results: ComboResult[] = new Array(configs.length)
      let next = 0
      const workers = Array.from({ length: Math.max(1, env.backtestWorkers) }, async () => {
        while (next < configs.length) {
          const i = next++
          results[i] = await runMetrics(configs[i]!)
          await bump()
        }
      })
      await Promise.all(workers)
      return results
    }

    const artifactPath = join(env.artifactsDir, 'optimizations', `${id}.json.gz`)

    if (!req.walkForward) {
      const results = await pool(combos.map((params) => ({ ...req.baseConfig, params })))
      results.sort((a, b) => b.score - a.score)
      await this.writeArtifact(artifactPath, { kind: 'grid', objective: req.objective, results })
      await this.db
        .update(optTable)
        .set({
          status: 'done',
          done,
          topResults: results.slice(0, 50),
          artifactPath,
          finishedAt: Date.now(),
        })
        .where(eq(optTable.id, id))
      hub.publish('backtests', { t: 'optimization:progress', id, done, total: done, status: 'done' })
      return
    }

    // walk-forward: optimize in-sample, validate out-of-sample, window by window
    const windows = walkForwardWindows(req.baseConfig.start, req.baseConfig.end, req.walkForward)
    const windowResults: WfWindowResult[] = []
    for (const w of windows) {
      if (signal.aborted) throw new Error('canceled')
      const isResults = await pool(
        combos.map((params) => ({ ...req.baseConfig, params, start: w.isStart, end: w.isEnd })),
      )
      isResults.sort((a, b) => b.score - a.score)
      const best = isResults[0]!
      const oos = await runMetrics({ ...req.baseConfig, params: best.params, start: w.oosStart, end: w.oosEnd })
      await bump()
      windowResults.push({
        index: w.index,
        isStart: w.isStart,
        isEnd: w.isEnd,
        oosStart: w.oosStart,
        oosEnd: w.oosEnd,
        bestParams: best.params,
        isScore: best.score,
        oosMetrics: oos.metrics,
      })
    }

    const oosValid = windowResults.filter((w) => w.oosMetrics !== null)
    const summary = {
      windows: windowResults.length,
      positiveOos: oosValid.filter((w) => (w.oosMetrics?.netProfitPct ?? 0) > 0).length,
      avgOosNetProfitPct:
        oosValid.length > 0
          ? oosValid.reduce((s, w) => s + (w.oosMetrics?.netProfitPct ?? 0), 0) / oosValid.length
          : 0,
      compoundedOosReturnPct:
        (oosValid.reduce((acc, w) => acc * (1 + (w.oosMetrics?.netProfitPct ?? 0) / 100), 1) - 1) * 100,
    }
    await this.writeArtifact(artifactPath, { kind: 'walkforward', objective: req.objective, summary, windows: windowResults })
    await this.db
      .update(optTable)
      .set({ status: 'done', done, topResults: { summary, windows: windowResults }, artifactPath, finishedAt: Date.now() })
      .where(eq(optTable.id, id))
    hub.publish('backtests', { t: 'optimization:progress', id, done, total: done, status: 'done' })
  }

  private async preEnsure(
    base: BacktestConfig,
    combos: ParamValues[],
    dataFn: (params: ParamValues) => Record<string, { symbol?: string; interval?: string }>,
  ): Promise<void> {
    const store = new CandleStore(this.db)
    const needs = new Map<string, { symbol: string; interval: string }>()
    for (const params of combos) {
      try {
        for (const feed of Object.values(dataFn(params))) {
          if (!feed.interval) continue
          const symbol = feed.symbol ?? base.symbol
          needs.set(`${symbol}:${feed.interval}`, { symbol, interval: feed.interval })
        }
      } catch {
        /* a combo whose data() throws will fail in its own run */
      }
    }
    for (const { symbol, interval } of needs.values()) {
      const itv = INTERVAL_MS[interval as keyof typeof INTERVAL_MS] ?? 60_000
      const start = base.start - base.warmupBars * itv
      await store.ensureRange(base.market, symbol, interval as never, start, base.end)
    }
  }

  private runInWorker(config: BacktestConfig, signal: AbortSignal): Promise<BacktestMetrics> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('../workers/backtestWorker.ts', import.meta.url))
      const onAbort = (): void => {
        worker.terminate()
        reject(new Error('canceled'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      worker.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as WorkerOutMsg
        if (msg.kind === 'done') {
          signal.removeEventListener('abort', onAbort)
          worker.terminate()
          resolve(msg.metrics as BacktestMetrics)
        } else if (msg.kind === 'error') {
          signal.removeEventListener('abort', onAbort)
          worker.terminate()
          reject(new Error(msg.message))
        }
      }
      worker.onerror = (ev) => {
        signal.removeEventListener('abort', onAbort)
        worker.terminate()
        reject(new Error(ev.message ?? 'worker crash'))
      }
      const msg: WorkerRunMsg = {
        kind: 'run',
        config,
        strategyPath: registry.get(config.strategyId).path,
        dataDir: env.dataDir,
        databaseUrl: env.databaseUrl,
      }
      worker.postMessage(msg)
    })
  }

  private async writeArtifact(path: string, data: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await Bun.write(path, Bun.gzipSync(new TextEncoder().encode(JSON.stringify(data))))
  }
}
