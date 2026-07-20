import { env } from '../env'

/**
 * Envoi Telegram sérialisé. `sendTelegram` est NON bloquant (le chemin de
 * trading ne doit jamais attendre une notification) : il empile le message
 * et rend la main. Un worker UNIQUE draine la file dans l'ordre d'émission,
 * espacé, avec retry sur 429.
 *
 * Pourquoi une file (incident 2026-07-19/20) : des envois fire-and-forget
 * concurrents vers le même chat (résumé nocturne = 5 messages, transactions
 * groupées d'un bot) se doublent en route → ordre mélangé, et une rafale
 * déclenche un 429 que le `.catch` avalait en silence → message perdu (le
 * plus utile, l'en-tête regime1, avait sauté). La file garantit l'ordre et
 * absorbe le throttling.
 */

/** espacement entre deux envois consécutifs (Telegram limite le débit/chat) */
const SPACING_MS = 350
/** délai dur par requête — une requête qui pend ne fige jamais la file */
const REQUEST_TIMEOUT_MS = 8_000
/** back-off maximal honoré sur un 429 (retry_after Telegram peut être grand) */
const MAX_RETRY_WAIT_MS = 5_000
/** tentatives par message avant abandon silencieux */
const MAX_ATTEMPTS = 3

const queue: string[] = []
/** promesse du worker en cours (null = au repos) — attendue par flushTelegram */
let draining: Promise<void> | null = null

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** envoie UN message, avec retry borné sur 429. Ne jette jamais. */
async function deliver(text: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${env.telegramToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: env.telegramChatId, text, parse_mode: 'HTML' }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (res.status !== 429) return // livré (ou erreur non récupérable : on n'insiste pas)
      // throttling : respecter retry_after (borné), puis réessayer
      const body = (await res.json().catch(() => null)) as { parameters?: { retry_after?: number } } | null
      const ra = body?.parameters?.retry_after ?? 1
      await sleep(Math.min(MAX_RETRY_WAIT_MS, Math.max(0, ra) * 1000))
    } catch {
      return // réseau/timeout : les alertes ne doivent jamais bloquer le trading
    }
  }
}

async function drain(): Promise<void> {
  while (queue.length > 0) {
    await deliver(queue.shift()!)
    if (queue.length > 0) await sleep(SPACING_MS)
  }
  draining = null
}

/** Alerte Telegram — non bloquante : empile puis rend la main aussitôt. */
export function sendTelegram(text: string): void {
  if (!env.telegramToken || !env.telegramChatId) return
  queue.push(text)
  if (!draining) draining = drain()
}

/**
 * Attend (borné) que la file soit entièrement envoyée — à appeler AVANT
 * process.exit (un envoi non terminé meurt avec le process, message perdu).
 * Borné pour ne jamais retarder un arrêt si Telegram est injoignable.
 */
export async function flushTelegram(maxMs = 10_000): Promise<void> {
  if (!draining) return
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    draining,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, maxMs)
    }),
  ])
  clearTimeout(timer)
}
