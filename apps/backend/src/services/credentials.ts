import { eq } from 'drizzle-orm'
import { apiCredentials, type Db } from '@tpx/db'
import type { BinanceCredentials } from '@tpx/data'
import { decryptSecret, encryptSecret } from '../crypto'

export type CredentialsName = 'live' | 'testnet'

export class CredentialsService {
  constructor(private readonly db: Db) {}

  async set(name: CredentialsName, apiKey: string, secret: string): Promise<void> {
    await this.db
      .insert(apiCredentials)
      .values({
        name,
        apiKeyEnc: encryptSecret(apiKey),
        secretEnc: encryptSecret(secret),
        updatedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: apiCredentials.name,
        set: { apiKeyEnc: encryptSecret(apiKey), secretEnc: encryptSecret(secret), updatedAt: Date.now() },
      })
  }

  async get(name: CredentialsName): Promise<BinanceCredentials | null> {
    const rows = await this.db.select().from(apiCredentials).where(eq(apiCredentials.name, name))
    if (rows.length === 0) return null
    return { apiKey: decryptSecret(rows[0]!.apiKeyEnc), secret: decryptSecret(rows[0]!.secretEnc) }
  }

  async delete(name: CredentialsName): Promise<void> {
    await this.db.delete(apiCredentials).where(eq(apiCredentials.name, name))
  }

  async status(): Promise<Record<CredentialsName, boolean>> {
    const rows = await this.db.select({ name: apiCredentials.name }).from(apiCredentials)
    const names = new Set(rows.map((r) => r.name))
    return { live: names.has('live'), testnet: names.has('testnet') }
  }
}
