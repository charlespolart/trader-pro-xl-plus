import { env } from '../env'

/** fire-and-forget Telegram alert; silently no-ops when not configured */
export function sendTelegram(text: string): void {
  if (!env.telegramToken || !env.telegramChatId) return
  fetch(`https://api.telegram.org/bot${env.telegramToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.telegramChatId, text, parse_mode: 'HTML' }),
  }).catch(() => {
    /* alerts must never break trading */
  })
}
