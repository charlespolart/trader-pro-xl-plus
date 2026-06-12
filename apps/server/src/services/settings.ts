import { eq } from 'drizzle-orm'
import { settings, type Db } from '@tpx/db'
import type { GlobalRiskConfig } from '@tpx/shared'

export class SettingsService {
  constructor(private readonly db: Db) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const rows = await this.db.select().from(settings).where(eq(settings.key, key))
    if (rows.length === 0) return fallback
    return rows[0]!.value as T
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.db
      .insert(settings)
      .values({ key, value, updatedAt: Date.now() })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } })
  }

  async globalRisk(): Promise<GlobalRiskConfig> {
    return this.get<GlobalRiskConfig>('globalRisk', { killSwitchActive: false })
  }

  async setGlobalRisk(cfg: GlobalRiskConfig): Promise<void> {
    await this.set('globalRisk', cfg)
  }
}
