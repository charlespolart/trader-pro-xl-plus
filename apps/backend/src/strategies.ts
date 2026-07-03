import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { StrategyDefinition } from '@tpx/core'
import { defaultParams, type ParamSchema } from '@tpx/shared'
import { env } from './env'

export interface StrategyEntry {
  id: string
  path: string
  def: StrategyDefinition
  error?: undefined
}

export interface StrategyError {
  id: string
  path: string
  def?: undefined
  error: string
}

export type StrategyItem = StrategyEntry | StrategyError

/**
 * Strategies are plain TS files in strategies/ with a default export from
 * defineStrategy(). Bun imports them natively; reload() re-imports with a
 * cache-busting query so edits are picked up without restarting the server.
 */
export class StrategyRegistry {
  private items = new Map<string, StrategyItem>()

  async reload(): Promise<void> {
    const files = (await readdir(env.strategiesDir)).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.startsWith('_'),
    )
    const next = new Map<string, StrategyItem>()
    for (const file of files) {
      const id = file.replace(/\.ts$/, '')
      const path = join(env.strategiesDir, file)
      try {
        const mod = (await import(`${path}?t=${Date.now()}`)) as { default?: unknown }
        const def = mod.default as StrategyDefinition | undefined
        if (!def || typeof def !== 'object' || typeof def.name !== 'string' || !def.schema || !def.hooks) {
          next.set(id, { id, path, error: 'No valid defineStrategy() default export' })
          continue
        }
        next.set(id, { id, path, def })
      } catch (err) {
        next.set(id, { id, path, error: err instanceof Error ? err.message : String(err) })
      }
    }
    this.items = next
  }

  list(): StrategyItem[] {
    return [...this.items.values()].sort((a, b) => a.id.localeCompare(b.id))
  }

  get(id: string): StrategyEntry {
    const item = this.items.get(id)
    if (!item) throw new Error(`Unknown strategy '${id}'`)
    if (item.error !== undefined) throw new Error(`Strategy '${id}' failed to load: ${item.error}`)
    return item
  }

  /** serializable DTO for the UI */
  toDTO(item: StrategyItem): Record<string, unknown> {
    if (item.error !== undefined) {
      return { id: item.id, error: item.error }
    }
    const schema: ParamSchema = item.def.schema
    return {
      id: item.id,
      name: item.def.name,
      description: item.def.description,
      markets: item.def.markets,
      symbol: item.def.symbol,
      schema,
      defaults: defaultParams(schema),
      backtest: item.def.backtest,
    }
  }
}

export const registry = new StrategyRegistry()
