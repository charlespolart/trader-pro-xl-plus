import { randomUUID } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import { aggTradeFiles, downloadJobs, type Db } from '@tpx/db'
import type { Interval, MarketType } from '@tpx/shared'
import { AggTradeStore, CandleStore } from '@tpx/data'
import { env } from '../env'
import { hub } from '../wsHub'

export interface CandleDownloadRequest {
  kind: 'candles'
  market: MarketType
  symbol: string
  intervals: Interval[]
  start: number
  end: number
}

export interface AggTradesDownloadRequest {
  kind: 'aggtrades'
  market: MarketType
  symbol: string
  start: number
  end: number
}

export type DownloadRequest = CandleDownloadRequest | AggTradesDownloadRequest

export class DownloadService {
  private readonly candleStore: CandleStore
  private readonly aggStore: AggTradeStore
  private readonly aborts = new Map<string, AbortController>()

  constructor(private readonly db: Db) {
    this.candleStore = new CandleStore(db)
    this.aggStore = new AggTradeStore(db, env.dataDir)
  }

  async init(): Promise<void> {
    await this.db
      .update(downloadJobs)
      .set({ status: 'error', error: 'Serveur redémarré pendant le téléchargement' })
      .where(eq(downloadJobs.status, 'running'))
  }

  async list(limit = 50) {
    return this.db.select().from(downloadJobs).orderBy(desc(downloadJobs.createdAt)).limit(limit)
  }

  async coverage(market: MarketType, symbol: string, interval: Interval) {
    return this.candleStore.coverage(market, symbol, interval)
  }

  async aggDays(market: MarketType, symbol: string) {
    const rows = await this.db
      .select({
        day: aggTradeFiles.day,
        count: aggTradeFiles.count,
        sizeBytes: aggTradeFiles.sizeBytes,
      })
      .from(aggTradeFiles)
      .where(and(eq(aggTradeFiles.market, market), eq(aggTradeFiles.symbol, symbol)))
      .orderBy(aggTradeFiles.day)
    const totals = await this.db
      .select({
        days: sql<number>`count(*)::int`,
        trades: sql<number>`coalesce(sum(${aggTradeFiles.count}), 0)::bigint`,
        bytes: sql<number>`coalesce(sum(${aggTradeFiles.sizeBytes}), 0)::bigint`,
      })
      .from(aggTradeFiles)
      .where(and(eq(aggTradeFiles.market, market), eq(aggTradeFiles.symbol, symbol)))
    return { days: rows, totals: totals[0] }
  }

  async cancel(jobId: string): Promise<void> {
    this.aborts.get(jobId)?.abort()
  }

  async submit(req: DownloadRequest): Promise<string> {
    const id = randomUUID()
    const label =
      req.kind === 'candles'
        ? `${req.symbol} ${req.intervals.join('/')} (${req.market})`
        : `${req.symbol} aggTrades (${req.market})`
    await this.db.insert(downloadJobs).values({
      id,
      kind: req.kind,
      label,
      params: req,
      status: 'running',
      createdAt: Date.now(),
    })

    const abort = new AbortController()
    this.aborts.set(id, abort)
    void this.run(id, label, req, abort.signal)
      .then(async () => {
        await this.db
          .update(downloadJobs)
          .set({ status: 'done', finishedAt: Date.now() })
          .where(eq(downloadJobs.id, id))
        hub.publish('downloads', { t: 'download:progress', jobId: id, label, done: 1, total: 1, status: 'done' })
      })
      .catch(async (err: unknown) => {
        const status = abort.signal.aborted ? 'canceled' : 'error'
        await this.db
          .update(downloadJobs)
          .set({ status, error: String(err), finishedAt: Date.now() })
          .where(eq(downloadJobs.id, id))
        hub.publish('downloads', {
          t: 'download:progress',
          jobId: id,
          label,
          done: 0,
          total: 1,
          status: 'error',
          error: String(err),
        })
      })
      .finally(() => this.aborts.delete(id))
    return id
  }

  private async run(id: string, label: string, req: DownloadRequest, signal: AbortSignal): Promise<void> {
    let lastPub = 0
    const progress = async (done: number, total: number): Promise<void> => {
      const now = Date.now()
      if (now - lastPub < 400) return
      lastPub = now
      hub.publish('downloads', { t: 'download:progress', jobId: id, label, done, total, status: 'running' })
      await this.db.update(downloadJobs).set({ done: Math.round(done), total: Math.round(total) }).where(eq(downloadJobs.id, id))
    }

    if (req.kind === 'candles') {
      let i = 0
      for (const interval of req.intervals) {
        const base = i
        await this.candleStore.ensureRange(req.market, req.symbol, interval, req.start, req.end, {
          signal,
          onProgress: (done, total) => {
            void progress(base + (total > 0 ? done / total : 1), req.intervals.length)
          },
        })
        i++
      }
    } else {
      await this.aggStore.ensureRange(req.market, req.symbol, req.start, req.end, {
        signal,
        onProgress: (done, total) => {
          void progress(done, total)
        },
      })
    }
  }
}
