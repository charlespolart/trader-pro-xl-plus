import { eq } from 'drizzle-orm'
import { apiCredentials, type Db } from '@tpx/db'
import type { OkxCredentials } from '@tpx/data'
import { decryptSecret, encryptSecret } from '../crypto'

/** nom LIBRE d'un compte (principal ou sous-compte) — 'live' et 'testnet'
 *  restent les comptes par défaut des bots historiques (credentialName NULL) */
export type CredentialsName = string

export interface CredentialInfo {
  name: CredentialsName
  demo: boolean
  updatedAt: number
}

export interface CredentialRecord extends CredentialInfo {
  creds: OkxCredentials
}

export class CredentialsService {
  constructor(private readonly db: Db) {}

  async set(name: CredentialsName, apiKey: string, secret: string, passphrase: string, demo: boolean): Promise<void> {
    const row = {
      name,
      apiKeyEnc: encryptSecret(apiKey),
      secretEnc: encryptSecret(secret),
      passphraseEnc: encryptSecret(passphrase),
      demo,
      updatedAt: Date.now(),
    }
    await this.db
      .insert(apiCredentials)
      .values(row)
      .onConflictDoUpdate({ target: apiCredentials.name, set: row })
  }

  async get(name: CredentialsName): Promise<OkxCredentials | null> {
    const rec = await this.getRecord(name)
    return rec?.creds ?? null
  }

  /** credentials + flag demo — le demo est porté par le COMPTE (hosts OKX) */
  async getRecord(name: CredentialsName): Promise<CredentialRecord | null> {
    const rows = await this.db.select().from(apiCredentials).where(eq(apiCredentials.name, name))
    const r = rows[0]
    if (!r) return null
    return {
      name: r.name,
      demo: r.demo,
      updatedAt: r.updatedAt,
      creds: {
        apiKey: decryptSecret(r.apiKeyEnc),
        secret: decryptSecret(r.secretEnc),
        passphrase: r.passphraseEnc ? decryptSecret(r.passphraseEnc) : '',
      },
    }
  }

  async delete(name: CredentialsName): Promise<void> {
    await this.db.delete(apiCredentials).where(eq(apiCredentials.name, name))
  }

  /** tous les comptes configurés (jamais les secrets) */
  async list(): Promise<CredentialInfo[]> {
    const rows = await this.db
      .select({ name: apiCredentials.name, demo: apiCredentials.demo, updatedAt: apiCredentials.updatedAt })
      .from(apiCredentials)
    return rows.sort((a, b) => a.name.localeCompare(b.name))
  }
}
