import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import { env } from './env'

function keyBytes(): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(env.masterKey)) {
    throw new Error('MASTER_KEY must be 64 hex chars — generate one: bun -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"')
  }
  return Buffer.from(env.masterKey, 'hex')
}

/** AES-256-GCM, output: base64(iv | tag | ciphertext) */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyBytes(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64')
}

export function decryptSecret(blob: string): string {
  const raw = Buffer.from(blob, 'base64')
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const data = raw.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

const sessionSecret = env.masterKey || randomBytes(32).toString('hex')

/** stateless session token: base64url(exp).hmac */
export function issueToken(ttlMs = 30 * 86_400_000): string {
  const exp = String(Date.now() + ttlMs)
  const payload = Buffer.from(exp).toString('base64url')
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return false
  const expected = createHmac('sha256', sessionSecret).update(payload).digest('base64url')
  if (sig !== expected) return false
  const exp = Number(Buffer.from(payload, 'base64url').toString())
  return Number.isFinite(exp) && Date.now() < exp
}
