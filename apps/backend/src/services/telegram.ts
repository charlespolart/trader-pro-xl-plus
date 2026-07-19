import { env } from '../env'

/** envois encore en vol — attendus par flushTelegram() avant un exit */
const inflight = new Set<Promise<unknown>>()

/** fire-and-forget Telegram alert; silently no-ops when not configured */
export function sendTelegram(text: string): void {
  if (!env.telegramToken || !env.telegramChatId) return
  const p = fetch(`https://api.telegram.org/bot${env.telegramToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.telegramChatId, text, parse_mode: 'HTML' }),
  }).catch(() => {
    /* alerts must never break trading */
  })
  inflight.add(p)
  void p.finally(() => inflight.delete(p))
}

/**
 * Attend (borné) les envois encore en vol — à appeler AVANT process.exit :
 * un fetch fire-and-forget meurt avec le process, message perdu en silence
 * (vécu 2026-07-19 : tick nocturne parfait, résumé Telegram jamais arrivé).
 * Borné pour ne jamais retarder un arrêt si Telegram est injoignable.
 */
export async function flushTelegram(maxMs = 5_000): Promise<void> {
  const pending = [...inflight]
  if (pending.length === 0) return
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    Promise.all(pending),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, maxMs)
    }),
  ])
  clearTimeout(timer)
}
