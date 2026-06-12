import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core'

const ts = (name: string) => bigint(name, { mode: 'number' })

// ------------------------------------------------------------- market data

export const candles = pgTable(
  'candles',
  {
    market: text('market').notNull(),
    symbol: text('symbol').notNull(),
    interval: text('interval').notNull(),
    openTime: ts('open_time').notNull(),
    open: doublePrecision('open').notNull(),
    high: doublePrecision('high').notNull(),
    low: doublePrecision('low').notNull(),
    close: doublePrecision('close').notNull(),
    volume: doublePrecision('volume').notNull(),
    quoteVolume: doublePrecision('quote_volume').notNull(),
    trades: integer('trades').notNull(),
    takerBuyBase: doublePrecision('taker_buy_base').notNull(),
    takerBuyQuote: doublePrecision('taker_buy_quote').notNull(),
    closeTime: ts('close_time').notNull(),
  },
  (t) => [primaryKey({ columns: [t.market, t.symbol, t.interval, t.openTime] })],
)

/** merged, contiguous downloaded ranges per (market, symbol, interval) */
export const candleCoverage = pgTable(
  'candle_coverage',
  {
    id: text('id').primaryKey(),
    market: text('market').notNull(),
    symbol: text('symbol').notNull(),
    interval: text('interval').notNull(),
    start: ts('start').notNull(),
    /** exclusive */
    end: ts('end').notNull(),
  },
  (t) => [index('coverage_key_idx').on(t.market, t.symbol, t.interval)],
)

/** manifest of binary aggTrades day-files on disk */
export const aggTradeFiles = pgTable(
  'aggtrade_files',
  {
    market: text('market').notNull(),
    symbol: text('symbol').notNull(),
    /** YYYY-MM-DD (UTC) */
    day: text('day').notNull(),
    count: integer('count').notNull(),
    path: text('path').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.market, t.symbol, t.day] })],
)

export const fundingRates = pgTable(
  'funding_rates',
  {
    symbol: text('symbol').notNull(),
    time: ts('time').notNull(),
    rate: doublePrecision('rate').notNull(),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.time] })],
)

// --------------------------------------------------------------------- bots

export const bots = pgTable('bots', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  strategyId: text('strategy_id').notNull(),
  market: text('market').notNull(),
  symbol: text('symbol').notNull(),
  mode: text('mode').notNull(),
  params: jsonb('params').notNull(),
  allocation: doublePrecision('allocation').notNull(),
  leverage: integer('leverage').notNull().default(1),
  risk: jsonb('risk').notNull(),
  /** restart the bot automatically when the server boots */
  desiredRunning: boolean('desired_running').notNull().default(false),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
})

/** persisted strategy ctx.state + runtime counters, for crash recovery */
export const botState = pgTable('bot_state', {
  botId: text('bot_id').primaryKey(),
  state: jsonb('state').notNull(),
  realizedPnlTotal: doublePrecision('realized_pnl_total').notNull().default(0),
  realizedPnlToday: doublePrecision('realized_pnl_today').notNull().default(0),
  pnlDay: text('pnl_day').notNull().default(''),
  equityPeak: doublePrecision('equity_peak').notNull().default(0),
  consecutiveLosses: integer('consecutive_losses').notNull().default(0),
  cooldownUntil: ts('cooldown_until').notNull().default(0),
  updatedAt: ts('updated_at').notNull(),
})

export const orders = pgTable(
  'orders',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    exchangeOrderId: text('exchange_order_id'),
    botId: text('bot_id'),
    market: text('market').notNull(),
    symbol: text('symbol').notNull(),
    side: text('side').notNull(),
    type: text('type').notNull(),
    status: text('status').notNull(),
    qty: doublePrecision('qty').notNull(),
    executedQty: doublePrecision('executed_qty').notNull().default(0),
    cumQuote: doublePrecision('cum_quote').notNull().default(0),
    price: doublePrecision('price'),
    stopPrice: doublePrecision('stop_price'),
    timeInForce: text('time_in_force').notNull().default('GTC'),
    reduceOnly: boolean('reduce_only').notNull().default(false),
    ocoGroup: text('oco_group'),
    reason: text('reason'),
    tag: text('tag'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [index('orders_bot_idx').on(t.botId, t.createdAt)],
)

export const fills = pgTable(
  'fills',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id').notNull(),
    botId: text('bot_id'),
    market: text('market').notNull(),
    symbol: text('symbol').notNull(),
    side: text('side').notNull(),
    price: doublePrecision('price').notNull(),
    qty: doublePrecision('qty').notNull(),
    quoteQty: doublePrecision('quote_qty').notNull(),
    fee: doublePrecision('fee').notNull(),
    feeAsset: text('fee_asset').notNull(),
    maker: boolean('maker').notNull(),
    time: ts('time').notNull(),
    tag: text('tag'),
    reason: text('reason'),
  },
  (t) => [index('fills_bot_idx').on(t.botId, t.time)],
)

/** live round-trip trades (backtest trades live in the run artifact) */
export const trades = pgTable(
  'trades',
  {
    id: text('id').primaryKey(),
    botId: text('bot_id').notNull(),
    market: text('market').notNull(),
    symbol: text('symbol').notNull(),
    direction: text('direction').notNull(),
    entryTime: ts('entry_time').notNull(),
    exitTime: ts('exit_time'),
    avgEntryPrice: doublePrecision('avg_entry_price').notNull(),
    avgExitPrice: doublePrecision('avg_exit_price'),
    qty: doublePrecision('qty').notNull(),
    realizedPnl: doublePrecision('realized_pnl').notNull(),
    realizedPnlPct: doublePrecision('realized_pnl_pct').notNull(),
    fees: doublePrecision('fees').notNull(),
    funding: doublePrecision('funding').notNull().default(0),
    entryReason: text('entry_reason'),
    exitReason: text('exit_reason'),
    mae: doublePrecision('mae').notNull().default(0),
    mfe: doublePrecision('mfe').notNull().default(0),
  },
  (t) => [index('trades_bot_idx').on(t.botId, t.entryTime)],
)

// ---------------------------------------------------------------- backtests

export const backtests = pgTable(
  'backtests',
  {
    id: text('id').primaryKey(),
    label: text('label'),
    strategyId: text('strategy_id').notNull(),
    market: text('market').notNull(),
    symbol: text('symbol').notNull(),
    config: jsonb('config').notNull(),
    status: text('status').notNull(),
    progress: doublePrecision('progress').notNull().default(0),
    error: text('error'),
    metrics: jsonb('metrics'),
    haltedReason: text('halted_reason'),
    /** JSON artifact with trades/equity/indicators/annotations/logs */
    artifactPath: text('artifact_path'),
    createdAt: ts('created_at').notNull(),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
  },
  (t) => [index('backtests_created_idx').on(t.createdAt)],
)

export const optimizations = pgTable('optimizations', {
  id: text('id').primaryKey(),
  label: text('label'),
  strategyId: text('strategy_id').notNull(),
  market: text('market').notNull(),
  symbol: text('symbol').notNull(),
  /** base BacktestConfig + sweep space + objective + walk-forward options */
  config: jsonb('config').notNull(),
  status: text('status').notNull(),
  done: integer('done').notNull().default(0),
  total: integer('total').notNull().default(0),
  error: text('error'),
  /** top results (params + metrics), full table in the artifact */
  topResults: jsonb('top_results'),
  artifactPath: text('artifact_path'),
  createdAt: ts('created_at').notNull(),
  finishedAt: ts('finished_at'),
})

// ----------------------------------------------------------------- platform

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull(),
})

/** AES-256-GCM encrypted Binance credentials (never stored in clear) */
export const apiCredentials = pgTable('api_credentials', {
  /** 'live' | 'testnet' */
  name: text('name').primaryKey(),
  apiKeyEnc: text('api_key_enc').notNull(),
  secretEnc: text('secret_enc').notNull(),
  updatedAt: ts('updated_at').notNull(),
})

export const downloadJobs = pgTable(
  'download_jobs',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    label: text('label').notNull(),
    params: jsonb('params').notNull(),
    status: text('status').notNull(),
    done: integer('done').notNull().default(0),
    total: integer('total').notNull().default(0),
    error: text('error'),
    createdAt: ts('created_at').notNull(),
    finishedAt: ts('finished_at'),
  },
  (t) => [index('download_jobs_created_idx').on(t.createdAt)],
)
