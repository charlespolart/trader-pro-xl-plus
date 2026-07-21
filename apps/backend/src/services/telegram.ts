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

/** un POST sendMessage — html=false envoie en TEXTE BRUT (repli parse).
 *  Renvoie null sur réseau/timeout (les alertes ne bloquent jamais le trading). */
async function post(text: string, html: boolean): Promise<Response | null> {
  try {
    return await fetch(`https://api.telegram.org/bot${env.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.telegramChatId, text, ...(html ? { parse_mode: 'HTML' } : {}) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    return null
  }
}

/**
 * Envoie UN message : retry borné sur 429, et REPLI en texte brut sur 400.
 * Le 400 = parse HTML échoué — typiquement un `<` brut dans le texte (l'en-tête
 * regime1 « médiane 2.25 bps/j < 2.5 »). Sans repli, ce 400 est avalé et le
 * message disparaît en silence (vécu 2026-07-19→21 : seul l'en-tête, le seul
 * avec un `<`, manquait). Le renvoi sans parse_mode affiche le texte littéral —
 * correct pour ces messages sans balises. Ne jette jamais.
 */
async function deliver(text: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await post(text, true)
    if (!res) return // réseau/timeout
    if (res.ok) return
    if (res.status === 429) {
      // throttling : respecter retry_after (borné), puis réessayer
      const body = (await res.json().catch(() => null)) as { parameters?: { retry_after?: number } } | null
      const ra = body?.parameters?.retry_after ?? 1
      await sleep(Math.min(MAX_RETRY_WAIT_MS, Math.max(0, ra) * 1000))
      continue
    }
    if (res.status === 400) await post(text, false) // repli texte brut, une fois
    return // 400 replié, ou autre erreur non récupérable
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
