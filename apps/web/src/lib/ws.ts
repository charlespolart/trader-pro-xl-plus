import { create } from 'zustand'
import type { BotRuntimeInfo, ServerEvent } from '@tpx/shared'

type Listener = (event: ServerEvent) => void

interface Envelope {
  topic: string
  event: ServerEvent
}

/**
 * Single websocket to the server with topic refcounting and automatic
 * reconnect + resubscribe.
 */
class WsClient {
  private ws: WebSocket | null = null
  private listeners = new Map<string, Set<Listener>>()
  private backoff = 500
  private opened = false

  connect(): void {
    if (this.ws) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    this.ws = ws
    ws.onopen = () => {
      this.opened = true
      this.backoff = 500
      for (const topic of this.listeners.keys()) {
        ws.send(JSON.stringify({ t: 'subscribe', topic }))
      }
      useConnection.setState({ connected: true })
    }
    ws.onmessage = (ev) => {
      try {
        const { topic, event } = JSON.parse(String(ev.data)) as Envelope
        routeGlobal(event)
        const subs = this.listeners.get(topic)
        if (subs) for (const cb of subs) cb(event)
      } catch {
        /* ignore */
      }
    }
    ws.onclose = () => {
      this.ws = null
      this.opened = false
      useConnection.setState({ connected: false })
      setTimeout(() => this.connect(), this.backoff)
      this.backoff = Math.min(this.backoff * 2, 10_000)
    }
  }

  subscribe(topic: string, cb: Listener): () => void {
    let set = this.listeners.get(topic)
    if (!set) {
      set = new Set()
      this.listeners.set(topic, set)
      if (this.opened) this.ws?.send(JSON.stringify({ t: 'subscribe', topic }))
    }
    set.add(cb)
    this.connect()
    return () => {
      set.delete(cb)
      if (set.size === 0) {
        this.listeners.delete(topic)
        if (this.opened) this.ws?.send(JSON.stringify({ t: 'unsubscribe', topic }))
      }
    }
  }
}

export const wsClient = new WsClient()

// ---- global stores fed by WS events

export const useConnection = create<{ connected: boolean }>(() => ({ connected: false }))

interface BotsState {
  infos: Record<string, BotRuntimeInfo>
  setAll(list: BotRuntimeInfo[]): void
}

export const useBots = create<BotsState>((set) => ({
  infos: {},
  setAll: (list) =>
    set(() => ({ infos: Object.fromEntries(list.map((i) => [i.config.id, i])) })),
}))

interface ProgressState {
  backtests: Record<string, { status: string; progress: number; error?: string }>
  downloads: Record<string, { label: string; done: number; total: number; status: string; error?: string }>
}

export const useProgress = create<ProgressState>(() => ({ backtests: {}, downloads: {} }))

function routeGlobal(event: ServerEvent): void {
  switch (event.t) {
    case 'bot:update':
      useBots.setState((s) => ({ infos: { ...s.infos, [event.info.config.id]: event.info } }))
      break
    case 'bot:removed':
      useBots.setState((s) => {
        const next = { ...s.infos }
        delete next[event.botId]
        return { infos: next }
      })
      break
    case 'backtest:progress':
      useProgress.setState((s) => ({
        backtests: { ...s.backtests, [event.id]: { status: event.status, progress: event.progress, error: event.error } },
      }))
      break
    case 'download:progress':
      useProgress.setState((s) => ({
        downloads: {
          ...s.downloads,
          [event.jobId]: { label: event.label, done: event.done, total: event.total, status: event.status, error: event.error },
        },
      }))
      break
    default:
      break
  }
}
