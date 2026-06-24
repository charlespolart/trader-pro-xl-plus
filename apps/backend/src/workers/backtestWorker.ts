/**
 * Bun worker: executes one backtest in isolation (own DB connection, own
 * strategy import). Posts progress, writes the artifact itself, and returns
 * only metrics to the main thread.
 */
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { runBacktest, type StrategyDefinition } from '@tpx/core'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'
import type { BacktestConfig } from '@tpx/shared'

export interface WorkerRunMsg {
  kind: 'run'
  config: BacktestConfig
  strategyPath: string
  dataDir: string
  databaseUrl: string
  /** write the full artifact here; omit for metrics-only runs (optimizer) */
  artifactPath?: string
}

export type WorkerOutMsg =
  | { kind: 'data'; label: string; done: number; total: number }
  | { kind: 'progress'; ratio: number }
  | { kind: 'done'; metrics: unknown; haltedReason: string | null; tradeCount: number }
  | { kind: 'error'; message: string }

declare const self: Worker

self.onmessage = (ev: MessageEvent) => {
  void run(ev.data as WorkerRunMsg)
}

async function run(msg: WorkerRunMsg): Promise<void> {
  if (msg.kind !== 'run') return
  try {
    const db = createDb(msg.databaseUrl)
    const provider = new PgDataProvider(db, {
      dataDir: msg.dataDir,
      onProgress: (label, done, total) => {
        postMessage({ kind: 'data', label, done, total } satisfies WorkerOutMsg)
      },
    })
    const mod = (await import(msg.strategyPath)) as { default?: StrategyDefinition }
    const def = mod.default
    if (!def) throw new Error(`${msg.strategyPath}: no default strategy export`)

    let lastSent = 0
    const result = await runBacktest({
      config: msg.config,
      def,
      provider,
      onProgress: (p) => {
        const now = Date.now()
        if (now - lastSent > 300) {
          lastSent = now
          postMessage({ kind: 'progress', ratio: p.ratio } satisfies WorkerOutMsg)
        }
      },
    })

    if (msg.artifactPath) {
      const artifact = {
        trades: result.trades,
        equity: result.equity,
        annotations: result.annotations,
        logs: result.logs,
        indicators: result.indicators,
        finalState: result.finalState,
      }
      await mkdir(dirname(msg.artifactPath), { recursive: true })
      await Bun.write(msg.artifactPath, Bun.gzipSync(new TextEncoder().encode(JSON.stringify(artifact))))
    }

    postMessage({
      kind: 'done',
      metrics: result.metrics,
      haltedReason: result.haltedReason,
      tradeCount: result.trades.length,
    } satisfies WorkerOutMsg)
  } catch (err) {
    postMessage({ kind: 'error', message: err instanceof Error ? err.message : String(err) } satisfies WorkerOutMsg)
  }
}
