import type { Interval, MarketType } from './market'
import type { Order } from './order'
import type { ParamValues } from './params'
import type { Position } from './position'

export type BotMode = 'paper' | 'testnet' | 'live'

export type BotStatus =
  | 'stopped'
  | 'starting'
  | 'running'
  /** paused by a risk guard (daily loss, consecutive losses…); auto or manual resume */
  | 'paused_risk'
  | 'stopping'
  | 'error'
  /** stopped by the global kill switch */
  | 'killed'

export interface BotRiskConfig {
  /** hard cap on position notional, in quote currency */
  maxPositionQuote?: number
  /** realized+unrealized loss over a UTC day that pauses the bot */
  maxDailyLossQuote?: number
  /** drawdown from the bot's equity peak (percent, e.g. 20) that stops the bot */
  maxDrawdownPct?: number
  maxConsecutiveLosses?: number
  /** pause duration after a losing trade */
  cooldownAfterLossMs?: number
  maxOpenOrders?: number
}

export interface BotConfig {
  id: string
  name: string
  /** strategy file id, e.g. 'rsi-mean-reversion' (strategies/<id>.ts) */
  strategyId: string
  market: MarketType
  symbol: string
  mode: BotMode
  /** compte OKX (api_credentials.name) sur lequel ce bot exécute — absent =
   *  compat historique : 'live' ou 'testnet' selon le mode (cf.
   *  effectiveCredentialName). Sans objet en paper. */
  credentialName?: string
  params: ParamValues
  /** virtual budget allocated to this bot, in quote currency */
  allocation: number
  /** position initiale en BASE (« je détiens déjà X BTC ») — adoptée au tout
   *  premier démarrage : le bot démarre EN POSITION, comme le backtest
   *  base-denom, et sa première action est une vente au signal. Spot only. */
  initialBaseQty?: number
  /** adopter TOUT le solde base libre du compte au 1er démarrage (lu via
   *  l'API OKX, floored au stepSize). Prioritaire sur initialBaseQty.
   *  Spot + compte réel (démo/live) uniquement — pas de sens en paper. */
  adoptAllBase?: boolean
  /** futures only */
  leverage: number
  risk: BotRiskConfig
  createdAt: number
  updatedAt: number
}

/** Compte effectif d'un bot : son credentialName, sinon le compte historique
 *  du mode ('live'/'testnet'). null = paper (aucun compte réel). C'est LA
 *  clé de scoping du routeur WS privé et des gardes multi-bots. */
export function effectiveCredentialName(mode: BotMode, credentialName?: string | null): string | null {
  if (mode === 'paper') return null
  return credentialName ?? (mode === 'live' ? 'live' : 'testnet')
}

export interface BotRuntimeInfo {
  config: BotConfig
  status: BotStatus
  /** present when status is 'error' or 'paused_risk' */
  statusReason?: string
  position: Position | null
  openOrders: Order[]
  /** allocation + realized pnl + unrealized pnl */
  equity: number
  realizedPnlToday: number
  realizedPnlTotal: number
  tradesToday: number
  startedAt: number | null
  lastEventAt: number | null
  /** état de la stratégie (ctx.state) — ex. accumulateurs : soldPrice, stop,
   *  bracket. Alimente les rails de cycle du Dashboard. */
  strategyState?: Record<string, unknown>
}

export interface GlobalRiskConfig {
  /** cap on the sum of all bots' position notionals, in quote */
  maxTotalExposureQuote?: number
  /** total realized loss over a UTC day that triggers the kill switch */
  maxDailyLossQuote?: number
  killSwitchActive: boolean
}
