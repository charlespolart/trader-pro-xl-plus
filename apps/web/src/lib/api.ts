import type {
  BacktestConfig,
  BacktestResultDetail,
  BacktestRun,
  BotConfig,
  BotRuntimeInfo,
  Candle,
  ChartAnnotation,
  CoverageRange,
  GlobalRiskConfig,
  IndicatorSeriesDTO,
  Interval,
  LogEntry,
  MarketType,
  ParamSchema,
  ParamValues,
  SymbolInfo,
} from '@tpx/shared'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  if (res.status === 401) {
    if (!location.pathname.startsWith('/login')) location.href = '/login'
    throw new ApiError(401, 'Non authentifié')
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText)
  return data as T
}

const get = <T>(path: string) => req<T>(path)
const post = <T>(path: string, body?: unknown) =>
  req<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : '{}' })
const put = <T>(path: string, body: unknown) => req<T>(path, { method: 'PUT', body: JSON.stringify(body) })
const del = <T>(path: string) => req<T>(path, { method: 'DELETE' })

export interface StrategyDTO {
  id: string
  name?: string
  description?: string
  markets?: MarketType[]
  schema?: ParamSchema
  defaults?: ParamValues
  error?: string
}

export interface BotChartData {
  candles: Candle[]
  indicators: IndicatorSeriesDTO[]
  annotations: ChartAnnotation[]
  interval: Interval | null
}

export interface RefitConfigDTO {
  enabled: boolean
  mode: 'auto' | 'propose'
  everyDays: number
  windowDays: number
  space: Record<string, unknown>
  objective: string
  minTrades: number
  minImprovement: number
}

export interface RefitStateDTO {
  config: RefitConfigDTO
  lastRunAt: number | null
  lastReport: string | null
  proposal: { params: ParamValues; report: string; at: number } | null
  defaultSpace: Record<string, unknown> | null
}

export interface PatternDetection {
  time: number
  name: string
  dir: number
}

export interface PatternScanResult {
  candles: Candle[]
  detections: PatternDetection[]
  counts: Record<string, number>
  available: string[]
}

export interface AccountData {
  configured: boolean
  mode: 'live' | 'testnet'
  spot?: { asset: string; free: number; locked: number }[]
  futures?: { asset: string; free: number; locked: number }[]
  positions?: { symbol: string; positionAmt: number; entryPrice: number; leverage: number; liquidationPrice: number; unRealizedProfit: number }[]
  bnbBalance?: number
  totalExposureQuote?: number
  killSwitchActive: boolean
  globalRisk?: GlobalRiskConfig
}

export interface SettingsData {
  authEnabled: boolean
  telegramConfigured: boolean
  credentials: { live: boolean; testnet: boolean }
  paperFees: Record<MarketType, { makerRate: number; takerRate: number; bnbDiscount: boolean }>
  backtestWorkers: number
  dataDir: string
}

export interface OptimizationRow {
  id: string
  label: string | null
  strategyId: string
  market: string
  symbol: string
  config: unknown
  status: string
  done: number
  total: number
  error: string | null
  topResults: unknown
  createdAt: number
  finishedAt: number | null
}

export interface DownloadJobRow {
  id: string
  kind: string
  label: string
  status: string
  done: number
  total: number
  error: string | null
  createdAt: number
}

export interface LiveTradeRow {
  id: string
  botId: string
  market: string
  symbol: string
  direction: string
  entryTime: number
  exitTime: number | null
  avgEntryPrice: number
  avgExitPrice: number | null
  qty: number
  realizedPnl: number
  realizedPnlPct: number
  fees: number
  funding: number
  entryReason: string | null
  exitReason: string | null
  mae: number
  mfe: number
}

export const api = {
  // auth
  login: (password: string) => post<{ ok: boolean }>('/auth/login', { password }),
  logout: () => post<{ ok: boolean }>('/auth/logout'),
  me: () => get<{ ok: boolean; authEnabled: boolean }>('/auth/me'),

  // strategies
  strategies: () => get<StrategyDTO[]>('/strategies'),
  reloadStrategies: () => post<StrategyDTO[]>('/strategies/reload'),
  strategySource: (id: string) => get<{ id: string; source: string }>(`/strategies/${id}/source`),
  saveStrategySource: (id: string, source: string) => put<StrategyDTO>(`/strategies/${id}/source`, { source }),

  // bots
  bots: () => get<BotRuntimeInfo[]>('/bots'),
  createBot: (cfg: Partial<BotConfig>) => post<BotConfig>('/bots', cfg),
  updateBot: (id: string, patch: Partial<BotConfig>) => put<BotConfig>(`/bots/${id}`, patch),
  deleteBot: (id: string) => del<{ ok: boolean }>(`/bots/${id}`),
  startBot: (id: string) => post<{ ok: boolean }>(`/bots/${id}/start`),
  stopBot: (id: string, closePosition: boolean) => post<{ ok: boolean }>(`/bots/${id}/stop`, { closePosition }),
  resumeBot: (id: string) => post<{ ok: boolean }>(`/bots/${id}/resume`),
  botChart: (id: string) => get<BotChartData>(`/bots/${id}/chart`),
  botLogs: (id: string) => get<LogEntry[]>(`/bots/${id}/logs`),

  // refit
  refitState: (id: string) => get<RefitStateDTO>(`/bots/${id}/refit`),
  setRefitConfig: (id: string, config: RefitConfigDTO) => put<RefitStateDTO>(`/bots/${id}/refit`, config),
  runRefit: (id: string) => post<{ started: boolean }>(`/bots/${id}/refit/run`),
  applyRefit: (id: string) => post<{ applied: boolean }>(`/bots/${id}/refit/apply`),
  discardRefit: (id: string) => post<{ ok: boolean }>(`/bots/${id}/refit/discard`),

  // trades
  trades: (botId?: string) => get<LiveTradeRow[]>(`/trades${botId ? `?botId=${botId}` : ''}`),

  // backtests
  backtests: () => get<BacktestRun[]>('/backtests'),
  backtest: (id: string) => get<BacktestRun>(`/backtests/${id}`),
  backtestResult: (id: string) => get<BacktestResultDetail>(`/backtests/${id}/result`),
  submitBacktest: (config: Partial<BacktestConfig>, label?: string) =>
    post<{ id: string }>('/backtests', { config, label }),
  cancelBacktest: (id: string) => post<{ ok: boolean }>(`/backtests/${id}/cancel`),
  deleteBacktest: (id: string) => del<{ ok: boolean }>(`/backtests/${id}`),

  // optimizations
  optimizations: () => get<OptimizationRow[]>('/optimizations'),
  optimization: (id: string) => get<OptimizationRow>(`/optimizations/${id}`),
  optimizationArtifact: (id: string) => get<unknown>(`/optimizations/${id}/artifact`),
  submitOptimization: (body: unknown) => post<{ id: string }>('/optimizations', body),
  cancelOptimization: (id: string) => post<{ ok: boolean }>(`/optimizations/${id}/cancel`),
  deleteOptimization: (id: string) => del<{ ok: boolean }>(`/optimizations/${id}`),

  // market
  klines: (market: MarketType, symbol: string, interval: Interval, start: number, end: number) =>
    get<Candle[]>(`/market/klines?market=${market}&symbol=${symbol}&interval=${interval}&start=${start}&end=${end}`),
  symbols: (market: MarketType) => get<SymbolInfo[]>(`/market/symbols?market=${market}`),
  patternScan: (q: {
    market: MarketType
    symbol: string
    interval: Interval
    start: number
    end: number
    names: string
    requireTrend: boolean
    strictColor: boolean
    strictGaps: boolean
    trendMinPct: number
  }) =>
    get<PatternScanResult>(
      `/market/patterns?market=${q.market}&symbol=${q.symbol}&interval=${q.interval}&start=${q.start}&end=${q.end}` +
        `&names=${encodeURIComponent(q.names)}&requireTrend=${q.requireTrend}&strictColor=${q.strictColor}&strictGaps=${q.strictGaps}&trendMinPct=${q.trendMinPct}`,
    ),

  // account / risk
  account: (mode: 'live' | 'testnet') => get<AccountData>(`/account?mode=${mode}`),
  risk: () => get<GlobalRiskConfig>('/risk'),
  setRisk: (cfg: GlobalRiskConfig) => put<GlobalRiskConfig>('/risk', cfg),
  killSwitch: (active: boolean, closePositions: boolean) =>
    post<{ killSwitchActive: boolean }>('/risk/killswitch', { active, closePositions }),

  // data
  coverage: (market: MarketType, symbol: string, interval: Interval) =>
    get<CoverageRange[]>(`/data/coverage?market=${market}&symbol=${symbol}&interval=${interval}`),
  aggDays: (market: MarketType, symbol: string) =>
    get<{ days: { day: string; count: number; sizeBytes: number }[]; totals: { days: number; trades: number; bytes: number } }>(
      `/data/aggdays?market=${market}&symbol=${symbol}`,
    ),
  downloadJobs: () => get<DownloadJobRow[]>('/data/jobs'),
  submitDownload: (body: unknown) => post<{ id: string }>('/data/download', body),
  cancelDownload: (id: string) => post<{ ok: boolean }>(`/data/jobs/${id}/cancel`),

  // settings
  settings: () => get<SettingsData>('/settings'),
  setCredentials: (name: 'live' | 'testnet', apiKey: string, secret: string) =>
    put<{ ok: boolean }>('/settings/credentials', { name, apiKey, secret }),
  deleteCredentials: (name: 'live' | 'testnet') => del<{ ok: boolean }>(`/settings/credentials/${name}`),
  setPaperFees: (market: MarketType, fees: unknown) => put<{ ok: boolean }>('/settings/paper-fees', { market, fees }),
}
