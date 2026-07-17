/**
 * PortfolioRunner — pipeline de DONNÉES quotidien (Phase A, lot A2).
 *
 * Rôle : chaque soir, (1) mettre à jour closes 1d (spot + perp) et funding
 * dans la base de L'APPLICATION (candleStore/fundingStore existants —
 * Vision en source, géo-résilient), (2) construire les panels alignés que
 * consomme la couche cibles (portfolio/targets.ts).
 *
 * Parité : en RECHERCHE le funding quotidien vient du CSV canonique ; au
 * RUNTIME il vient de la table funding_rates agrégée par jour UTC (somme
 * des événements) — compareFundingSources() vérifie l'égalité des deux sur
 * les jours communs (à exécuter en Phase B avant toute confiance).
 */
import postgres from 'postgres'
import { CandleStore, FundingStore } from '@tpx/data'
import type { Db } from '@tpx/db'
import { DAY, loadBtcReturns, loadPanel, loadFunding, type FundingPanel, type Panel } from '../research/portfolio-bt/data'
import { histFinite } from '../research/portfolio-bt/regime1'
import type { DayContext } from './targets'

export interface FeedConfig {
  /** connexion SQL brute (requêtes de masse) */
  sql: postgres.Sql
  /** connexion drizzle pour les stores existants */
  db: Db
  /** chemin du CSV canonique (parité recherche) — optionnel au runtime */
  fundingCsv?: string
}

export class PortfolioDataFeed {
  private readonly candles: CandleStore
  private readonly funding: FundingStore

  constructor(private readonly cfg: FeedConfig) {
    this.candles = new CandleStore(cfg.db)
    this.funding = new FundingStore(cfg.db)
  }

  /** univers de sélection : mêmes clauses que la recherche (spot USDT ≥ 180 j) */
  async universe(): Promise<string[]> {
    const rows = await this.cfg.sql.unsafe(
      `SELECT symbol FROM candles WHERE market='spot' AND interval='1d'
       AND symbol LIKE '%USDT' GROUP BY 1 HAVING count(*) >= 180 ORDER BY 1`,
    )
    return rows.map((r) => r.symbol as string).filter((s) => s !== 'BTCUSDT' && s !== 'ETHUSDT')
  }

  /**
   * Rafraîchit les derniers jours (idempotent, erreurs par symbole
   * tolérées). lookbackDays=3 couvre les trous d'un week-end de panne.
   */
  async ensureFresh(symbols: string[], lookbackDays = 3): Promise<{ ok: number; errors: string[] }> {
    const start = Date.now() - lookbackDays * DAY
    const end = Date.now()
    const errors: string[] = []
    let ok = 0
    for (const symbol of [...symbols, 'BTCUSDT']) {
      try {
        await this.candles.ensureRange('spot', symbol, '1d', start, end, {})
        await this.candles.ensureRange('futures', symbol, '1d', start, end, {}).catch(() => {})
        await this.funding.ensureRange(symbol, start, end).catch(() => {})
        ok++
      } catch (err) {
        errors.push(`${symbol}: ${err instanceof Error ? err.message.slice(0, 60) : err}`)
      }
    }
    return { ok, errors }
  }

  /** funding quotidien agrégé depuis la table runtime (Σ des événements du jour UTC) */
  async loadFundingFromTable(syms: string[], ts: Float64Array): Promise<FundingPanel> {
    const rows = await this.cfg.sql.unsafe(
      `SELECT symbol, (time / ${DAY})::bigint AS day, SUM(rate) AS rate
       FROM funding_rates WHERE symbol = ANY($1) GROUP BY 1, 2 ORDER BY 1, 2`, [syms],
    )
    const sidx = new Map(syms.map((s, i) => [s, i]))
    const tidx = new Map<number, number>()
    ts.forEach((t, i) => tidx.set(Math.floor(t / DAY), i))
    const n = ts.length
    const na = syms.length
    const F = new Float64Array(n * na)
    const seen = new Uint8Array(n * na)
    const btcDaily = new Float64Array(n)
    for (const r of rows) {
      const i = tidx.get(Number(r.day))
      if (i === undefined) continue
      if (r.symbol === 'BTCUSDT') btcDaily[i] = Number(r.rate)
      const a = sidx.get(r.symbol as string)
      if (a === undefined) continue
      F[i * na + a] = Number(r.rate)
      seen[i * na + a] = 1
    }
    const cnt = new Float64Array(n * na)
    const lastev = new Float64Array(n * na).fill(Infinity)
    for (let a = 0; a < na; a++) {
      let c = 0
      let last = -Infinity
      for (let i = 0; i < n; i++) {
        if (seen[i * na + a]) {
          c += 3
          last = i
        }
        cnt[i * na + a] = c
        lastev[i * na + a] = i - last
      }
    }
    return { F, cnt, lastev, btcDaily }
  }

  /** panels alignés + contexte du DERNIER jour disponible */
  async loadContext(source: 'csv' | 'table'): Promise<{ ctx: DayContext; syms: string[]; perp: Panel; btcR: Float64Array }> {
    const syms = await this.universe()
    const spot = await loadPanel(this.cfg.sql, syms, 'spot')
    const perp = await loadPanel(this.cfg.sql, syms, 'futures', spot.ts)
    const fund = source === 'csv' && this.cfg.fundingCsv
      ? loadFunding(this.cfg.fundingCsv, syms, spot.ts)
      : await this.loadFundingFromTable([...syms, 'BTCUSDT'], spot.ts)
    const hist = histFinite(spot)
    const btcR = await loadBtcReturns(this.cfg.sql, spot.ts, 'futures')
    return { ctx: { t: spot.n - 1, spot, perp, fund, hist }, syms, perp, btcR }
  }

  /**
   * FUNDING FRAIS via Coinalyze (les ~15 derniers jours n'existent pas sur
   * Vision avant l'archivage mensuel, et fapi est géo-bloqué). Convention :
   * un PSEUDO-ÉVÉNEMENT par jour à 12:00 UTC portant la somme quotidienne
   * approchée (close daily Coinalyze en % ÷100 ×3 événements — la même
   * approximation que venue1/venue2, écart mesuré faible). Les pseudo-
   * événements sont PURGÉS dès que les vrais (00/08/16 h) arrivent via
   * fundingStore/Vision : reconcileFunding().
   */
  async ensureFreshFunding(symbols: string[], apiKey: string, lookbackDays = 20): Promise<{ ok: number; errors: number }> {
    const from = Math.floor((Date.now() - lookbackDays * DAY) / 1000)
    const to = Math.floor(Date.now() / 1000)
    let ok = 0
    let errors = 0
    // un symbole sans perp Binance fait rejeter TOUT son batch → on
    // intersecte d'abord avec les marchés .A réellement cotés
    const mkts = await fetch('https://api.coinalyze.net/v1/future-markets', { headers: { api_key: apiKey } })
      .then((r) => r.json() as Promise<Array<{ symbol: string; is_perpetual?: boolean }>>)
      .catch(() => [] as Array<{ symbol: string; is_perpetual?: boolean }>)
    const valid = new Set(mkts.filter((m) => m.is_perpetual && m.symbol.endsWith('_PERP.A'))
      .map((m) => m.symbol.replace('_PERP.A', '')))
    const all = [...symbols, 'BTCUSDT'].filter((s) => valid.has(s))
    for (let i = 0; i < all.length; i += 20) {
      const batch = all.slice(i, i + 20)
      const q = batch.map((s) => `${s}_PERP.A`).join(',')
      try {
        let res: Response | null = null
        for (let attempt = 0; attempt < 4; attempt++) {
          res = await fetch(
            `https://api.coinalyze.net/v1/funding-rate-history?symbols=${q}&interval=daily&from=${from}&to=${to}`,
            { headers: { api_key: apiKey } },
          )
          if (res.status !== 429) break
          await new Promise((r) => setTimeout(r, 25_000 * (attempt + 1)))   // l'API compte ~par symbole
        }
        if (!res || !res.ok) throw new Error(`HTTP ${res?.status}`)
        const data = (await res.json()) as Array<{ symbol: string; history: Array<{ t: number; c: number | null }> }>
        for (const entry of data ?? []) {
          const symbol = entry.symbol.replace('_PERP.A', '')
          for (const h of entry.history ?? []) {
            if (h.c === null) continue
            const dailySum = (h.c / 100) * 3
            const pseudoTime = h.t * 1000 + 12 * 3_600_000 + 1   // +1 ms : signature inambiguë (les perps 4h ont un VRAI événement à 12:00 pile — appris par le contrôle de parité)
            await this.cfg.sql.unsafe(
              `INSERT INTO funding_rates (symbol, time, rate) VALUES ($1, $2, $3)
               ON CONFLICT (symbol, time) DO UPDATE SET rate = EXCLUDED.rate`,
              [symbol, pseudoTime, dailySum],
            )
          }
          ok++
        }
      } catch {
        errors += batch.length
      }
      await new Promise((r) => setTimeout(r, 1700))
    }
    return { ok, errors }
  }

  /** purge les pseudo-événements (12:00 UTC) des jours désormais couverts
   *  par ≥ 2 vrais événements Vision/REST */
  async reconcileFunding(): Promise<number> {
    const res = await this.cfg.sql.unsafe(
      `DELETE FROM funding_rates p
       WHERE (p.time % ${DAY}) = ${12 * 3_600_000 + 1}
         AND (SELECT count(*) FROM funding_rates r
              WHERE r.symbol = p.symbol
                AND r.time / ${DAY} = p.time / ${DAY}
                AND (r.time % ${DAY}) <> ${12 * 3_600_000 + 1}) >= 2`,
    )
    return res.count ?? 0
  }

  /**
   * Parité des deux sources de funding sur leurs jours communs.
   * À exiger ≈ 0 divergence avant de faire confiance à la table (Phase B).
   */
  async compareFundingSources(csvPath: string): Promise<{ common: number; mismatches: number }> {
    const syms = await this.universe()
    const spot = await loadPanel(this.cfg.sql, syms, 'spot')
    const a = loadFunding(csvPath, syms, spot.ts)
    const b = await this.loadFundingFromTable([...syms, 'BTCUSDT'], spot.ts)
    let common = 0
    let mismatches = 0
    for (let k = 0; k < a.F.length; k++) {
      if (a.F[k] !== 0 && b.F[k] !== 0) {
        common++
        if (Math.abs(a.F[k] - b.F[k]) > 1e-9) mismatches++
      }
    }
    return { common, mismatches }
  }
}
