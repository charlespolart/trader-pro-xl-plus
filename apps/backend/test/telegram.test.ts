import { afterEach, describe, expect, it } from 'bun:test'

/** Reproduit la perte du résumé nocturne (2026-07-19) : sendTelegram est
 *  fire-and-forget, un process.exit immédiat tuait la requête en vol —
 *  flushTelegram() doit attendre la fin des envois avant de rendre la main. */
describe('flushTelegram', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.TELEGRAM_CHAT_ID
  })

  it('rend la main immédiatement quand rien n’est en vol', async () => {
    const { flushTelegram } = await import('../src/services/telegram')
    const t0 = Date.now()
    await flushTelegram()
    expect(Date.now() - t0).toBeLessThan(100)
  })

  it('attend la fin de l’envoi en vol avant de rendre la main', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'token-test'
    process.env.TELEGRAM_CHAT_ID = 'chat-test'
    const { sendTelegram, flushTelegram } = await import('../src/services/telegram')
    let settled = false
    let release: (r: Response) => void = () => {}
    globalThis.fetch = (() =>
      new Promise<Response>((resolve) => {
        release = resolve
      }).then((r) => {
        settled = true
        return r
      })) as typeof fetch
    sendTelegram('résumé nocturne')
    expect(settled).toBe(false)
    setTimeout(() => release(new Response('{}')), 20)
    await flushTelegram(10_000)
    expect(settled).toBe(true)
  })
})
