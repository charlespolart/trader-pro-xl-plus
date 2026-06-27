import { describe, expect, it } from 'bun:test'

// `crypto.ts` reads the key via `env.masterKey`, which `env.ts` captures from
// `process.env.MASTER_KEY` at module-load time. `bun test` runs from the repo
// root and does not load `apps/backend/.env`, so we must set the key BEFORE
// `env.ts`/`crypto.ts` load — hence the dynamic import after the assignment.
describe('credentials crypto', () => {
  it('round-trips a passphrase and never leaks the plaintext', async () => {
    process.env.MASTER_KEY = '0'.repeat(64)
    const { encryptSecret, decryptSecret } = await import('../src/crypto')
    const enc = encryptSecret('my-okx-passphrase')
    expect(decryptSecret(enc)).toBe('my-okx-passphrase')
    expect(enc).not.toContain('my-okx-passphrase')
  })
})
