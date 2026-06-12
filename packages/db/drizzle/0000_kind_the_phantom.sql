CREATE TABLE "aggtrade_files" (
	"market" text NOT NULL,
	"symbol" text NOT NULL,
	"day" text NOT NULL,
	"count" integer NOT NULL,
	"path" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "aggtrade_files_market_symbol_day_pk" PRIMARY KEY("market","symbol","day")
);
--> statement-breakpoint
CREATE TABLE "api_credentials" (
	"name" text PRIMARY KEY NOT NULL,
	"api_key_enc" text NOT NULL,
	"secret_enc" text NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backtests" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text,
	"strategy_id" text NOT NULL,
	"market" text NOT NULL,
	"symbol" text NOT NULL,
	"config" jsonb NOT NULL,
	"status" text NOT NULL,
	"progress" double precision DEFAULT 0 NOT NULL,
	"error" text,
	"metrics" jsonb,
	"halted_reason" text,
	"artifact_path" text,
	"created_at" bigint NOT NULL,
	"started_at" bigint,
	"finished_at" bigint
);
--> statement-breakpoint
CREATE TABLE "bot_state" (
	"bot_id" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"realized_pnl_total" double precision DEFAULT 0 NOT NULL,
	"realized_pnl_today" double precision DEFAULT 0 NOT NULL,
	"pnl_day" text DEFAULT '' NOT NULL,
	"equity_peak" double precision DEFAULT 0 NOT NULL,
	"consecutive_losses" integer DEFAULT 0 NOT NULL,
	"cooldown_until" bigint DEFAULT 0 NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bots" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"strategy_id" text NOT NULL,
	"market" text NOT NULL,
	"symbol" text NOT NULL,
	"mode" text NOT NULL,
	"params" jsonb NOT NULL,
	"allocation" double precision NOT NULL,
	"leverage" integer DEFAULT 1 NOT NULL,
	"risk" jsonb NOT NULL,
	"desired_running" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candle_coverage" (
	"id" text PRIMARY KEY NOT NULL,
	"market" text NOT NULL,
	"symbol" text NOT NULL,
	"interval" text NOT NULL,
	"start" bigint NOT NULL,
	"end" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candles" (
	"market" text NOT NULL,
	"symbol" text NOT NULL,
	"interval" text NOT NULL,
	"open_time" bigint NOT NULL,
	"open" double precision NOT NULL,
	"high" double precision NOT NULL,
	"low" double precision NOT NULL,
	"close" double precision NOT NULL,
	"volume" double precision NOT NULL,
	"quote_volume" double precision NOT NULL,
	"trades" integer NOT NULL,
	"taker_buy_base" double precision NOT NULL,
	"taker_buy_quote" double precision NOT NULL,
	"close_time" bigint NOT NULL,
	CONSTRAINT "candles_market_symbol_interval_open_time_pk" PRIMARY KEY("market","symbol","interval","open_time")
);
--> statement-breakpoint
CREATE TABLE "download_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"params" jsonb NOT NULL,
	"status" text NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" bigint NOT NULL,
	"finished_at" bigint
);
--> statement-breakpoint
CREATE TABLE "fills" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"bot_id" text,
	"market" text NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"price" double precision NOT NULL,
	"qty" double precision NOT NULL,
	"quote_qty" double precision NOT NULL,
	"fee" double precision NOT NULL,
	"fee_asset" text NOT NULL,
	"maker" boolean NOT NULL,
	"time" bigint NOT NULL,
	"tag" text,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "funding_rates" (
	"symbol" text NOT NULL,
	"time" bigint NOT NULL,
	"rate" double precision NOT NULL,
	CONSTRAINT "funding_rates_symbol_time_pk" PRIMARY KEY("symbol","time")
);
--> statement-breakpoint
CREATE TABLE "optimizations" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text,
	"strategy_id" text NOT NULL,
	"market" text NOT NULL,
	"symbol" text NOT NULL,
	"config" jsonb NOT NULL,
	"status" text NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"error" text,
	"top_results" jsonb,
	"artifact_path" text,
	"created_at" bigint NOT NULL,
	"finished_at" bigint
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"exchange_order_id" text,
	"bot_id" text,
	"market" text NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"qty" double precision NOT NULL,
	"executed_qty" double precision DEFAULT 0 NOT NULL,
	"cum_quote" double precision DEFAULT 0 NOT NULL,
	"price" double precision,
	"stop_price" double precision,
	"time_in_force" text DEFAULT 'GTC' NOT NULL,
	"reduce_only" boolean DEFAULT false NOT NULL,
	"oco_group" text,
	"reason" text,
	"tag" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" text PRIMARY KEY NOT NULL,
	"bot_id" text NOT NULL,
	"market" text NOT NULL,
	"symbol" text NOT NULL,
	"direction" text NOT NULL,
	"entry_time" bigint NOT NULL,
	"exit_time" bigint,
	"avg_entry_price" double precision NOT NULL,
	"avg_exit_price" double precision,
	"qty" double precision NOT NULL,
	"realized_pnl" double precision NOT NULL,
	"realized_pnl_pct" double precision NOT NULL,
	"fees" double precision NOT NULL,
	"funding" double precision DEFAULT 0 NOT NULL,
	"entry_reason" text,
	"exit_reason" text,
	"mae" double precision DEFAULT 0 NOT NULL,
	"mfe" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "backtests_created_idx" ON "backtests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "coverage_key_idx" ON "candle_coverage" USING btree ("market","symbol","interval");--> statement-breakpoint
CREATE INDEX "download_jobs_created_idx" ON "download_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "fills_bot_idx" ON "fills" USING btree ("bot_id","time");--> statement-breakpoint
CREATE INDEX "orders_bot_idx" ON "orders" USING btree ("bot_id","created_at");--> statement-breakpoint
CREATE INDEX "trades_bot_idx" ON "trades" USING btree ("bot_id","entry_time");