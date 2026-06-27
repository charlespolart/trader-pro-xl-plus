import { eq } from 'drizzle-orm'
import { apiCredentials, type Db } from '@tpx/db'
import type { OkxCredentials } from '@tpx/data'
import { decryptSecret, encryptSecret } from '../crypto'

export type CredentialsName = 'live' | 'testnet'

export class CredentialsService {
  constructor(private readonly db: Db) {}

  async set(name: CredentialsName, apiKey: string, secret: string, passphrase: string): Promise<void> {
    const row = {
      name,
      apiKeyEnc: encryptSecret(apiKey),
      secretEnc: encryptSecret(secret),
      passphraseEnc: encryptSecret(passphrase),
      updatedAt: Date.now(),
    }
    await this.db
      .insert(apiCredentials)
      .values(row)
      .onConflictDoUpdate({ target: apiCredentials.name, set: row })
  }

  async get(name: CredentialsName): Promise<OkxCredentials | null> {
    const rows = await this.db.select().from(apiCredentials).where(eq(apiCredentials.name, name))
    const r = rows[0]
    if (!r) return null
    return {
      apiKey: decryptSecret(r.apiKeyEnc),
      secret: decryptSecret(r.secretEnc),
      passphrase: r.passphraseEnc ? decryptSecret(r.passphraseEnc) : '',
    }
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
