import { afterEach, describe, expect, it } from 'bun:test'

/**
 * File d'envoi Telegram sérialisée. Reproduit les défauts vus en prod
 * (2026-07-19/20) : envois fire-and-forget concurrents → ordre mélangé +
 * message perdu sur 429, et process.exit qui tue les envois en vol.
 */
describe('telegram — file d’envoi sérialisée', () => {
  const realFetch = globalThis.fetch
  afterEach(async () => {
    // drainer la file avant de rendre la main (état module partagé entre tests)
    const { flushTelegram } = await import('../src/services/telegram')
    await flushTelegram(2_000)
    globalThis.fetch = realFetch
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.TELEGRAM_CHAT_ID
  })

  it('no-op quand non configuré (flush rend la main aussitôt)', async () => {
    const { sendTelegram, flushTelegram } = await import('../src/services/telegram')
    sendTelegram('ignoré') // pas de token → rien n'est empilé
    const t0 = Date.now()
    await flushTelegram()
    expect(Date.now() - t0).toBeLessThan(50)
  })

  it('livre DANS L’ORDRE d’émission malgré des latences variables', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok'
    process.env.TELEGRAM_CHAT_ID = 'chat'
    const { sendTelegram, flushTelegram } = await import('../src/services/telegram')
    const sent: string[] = []
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { text: string }
      // latence artificielle : des envois concurrents arriveraient mélangés —
      // la file, elle, doit préserver l'ordre d'émission
      await new Promise((r) => setTimeout(r, 20))
      sent.push(body.text)
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    sendTelegram('1-header')
    sendTelegram('2-r1')
    sendTelegram('3-l2')
    await flushTelegram(5_000)
    expect(sent).toEqual(['1-header', '2-r1', '3-l2'])
  })

  it('réessaie sur 429 puis livre (message plus jamais perdu)', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok'
    process.env.TELEGRAM_CHAT_ID = 'chat'
    const { sendTelegram, flushTelegram } = await import('../src/services/telegram')
    let calls = 0
    const delivered: string[] = []
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      calls++
      if (calls === 1) {
        // throttling avec retry_after=0 → retry immédiat (test rapide)
        return new Response(JSON.stringify({ ok: false, parameters: { retry_after: 0 } }), { status: 429 })
      }
      const body = JSON.parse(init.body as string) as { text: string }
      delivered.push(body.text)
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    sendTelegram('à-livrer')
    await flushTelegram(5_000)
    expect(calls).toBeGreaterThanOrEqual(2)
    expect(delivered).toEqual(['à-livrer'])
  })

  it('flush BORNÉ ne bloque pas l’arrêt si Telegram est lent', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok'
    process.env.TELEGRAM_CHAT_ID = 'chat'
    const { sendTelegram, flushTelegram } = await import('../src/services/telegram')
    globalThis.fetch = (async () => {
      await new Promise((r) => setTimeout(r, 500)) // lent
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    sendTelegram('lent')
    const t0 = Date.now()
    await flushTelegram(100) // cap court : on ne veut pas figer l'exit
    const dt = Date.now() - t0
    expect(dt).toBeGreaterThanOrEqual(80)
    expect(dt).toBeLessThan(400)
  })
})
