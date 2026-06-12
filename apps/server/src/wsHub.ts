import type { ServerEvent } from '@tpx/shared'

interface Client {
  send(data: string): void
  topics: Set<string>
}

/**
 * Topic-based pub/sub for UI websockets. Single-user app: a plain map is all
 * we need. Events are enveloped as { topic, event }.
 */
export class WsHub {
  private clients = new Map<unknown, Client>()

  add(key: unknown, send: (data: string) => void): void {
    this.clients.set(key, { send, topics: new Set() })
  }

  remove(key: unknown): void {
    this.clients.delete(key)
  }

  subscribe(key: unknown, topic: string): void {
    this.clients.get(key)?.topics.add(topic)
  }

  unsubscribe(key: unknown, topic: string): void {
    this.clients.get(key)?.topics.delete(topic)
  }

  publish(topic: string, event: ServerEvent): void {
    const payload = JSON.stringify({ topic, event })
    for (const c of this.clients.values()) {
      if (c.topics.has(topic)) {
        try {
          c.send(payload)
        } catch {
          /* dead socket; cleanup happens on close */
        }
      }
    }
  }

  /** how many clients listen to a topic (used to skip useless work) */
  listeners(topic: string): number {
    let n = 0
    for (const c of this.clients.values()) if (c.topics.has(topic)) n++
    return n
  }

  topicsOf(key: unknown): string[] {
    return [...(this.clients.get(key)?.topics ?? [])]
  }
}

export const hub = new WsHub()
