/**
 * S/R psychologiques = nombres RONDS en $ (50k, 100k…), avec marge.
 * Thèse : à l'approche par le bas d'un palier rond, le prix résiste/rechute.
 * Test : approche d'un rond (high entre dans la bande sous le niveau) → rejet
 * vs cassure + rendement forward, comparé au baseline. Robuste (toutes barres).
 *   bun apps/backend/src/research/sr3.ts
 */
import { resolve } from 'node:path'
import { PgDataProvider } from '@tpx/data'
import { createDb } from '@tpx/db'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5436/tpx')
const provider = new PgDataProvider(db, { dataDir: resolve(import.meta.dir, '../../../../data') })
const candles = await provider.getCandles('spot', 'BTCUSDT', '4h', Date.parse('2019-01-01T00:00:00Z'), Date.parse('2026-06-13T00:00:00Z'))
const n = candles.length
const high = candles.map((c) => c.high)
const low = candles.map((c) => c.low)
const close = candles.map((c) => c.close)
const f = (v: number, d = 2): string => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—')

const BAND = 0.004 // 0,4 % sous le niveau = la « zone » du rond (≈ 59 760-60 000 pour 60k)

for (const G of [5000, 10000]) {
  for (const K of [10, 20, 40]) {
    // baseline : toutes les barres (avec assez de prix pour que la grille ait du sens)
    let baseN = 0, baseSum = 0, baseNeg = 0
    // approche par le bas d'un rond : high entre dans [L(1-band), L), fraîche
    let appN = 0, appSum = 0, appNeg = 0, broke = 0
    for (let i = 1; i < n - K; i++) {
      if (close[i]! < G) continue // grille trop grossière sous 1 palier
      const fwd = close[i + K]! / close[i]! - 1
      baseN++; baseSum += fwd; if (fwd < 0) baseNeg++
      const L = Math.floor(close[i]! / G) * G + G // prochain rond strictement au-dessus
      const inZone = high[i]! >= L * (1 - BAND) // le haut atteint la zone du rond
      const fresh = high[i - 1]! < L * (1 - BAND) // approche fraîche (pas déjà dedans)
      if (!inZone || !fresh) continue
      appN++; appSum += fwd; if (fwd < 0) appNeg++
      for (let j = i + 1; j <= i + K; j++) if (close[j]! > L * (1 + BAND)) { broke++; break }
    }
    console.log(`\n=== Rond tous les ${G / 1000}k$, approche par le bas (bande ${BAND * 100}%), forward ${K} bougies ===`)
    console.log(`  baseline (toutes barres)  : n=${baseN}  fwd moy ${f((baseSum / baseN) * 100, 2)}%  %down ${((baseNeg / baseN) * 100).toFixed(0)}%`)
    console.log(`  approche un rond          : n=${appN}  fwd moy ${f((appSum / Math.max(1, appN)) * 100, 2)}%  %down ${((appNeg / Math.max(1, appN)) * 100).toFixed(0)}%  | cassé sous ${K} bougies ${((broke / Math.max(1, appN)) * 100).toFixed(0)}%`)
    console.log(`  → rond = résistance SI fwd(approche) nettement < baseline ET %down nettement plus haut`)
  }
}

// Zoom : les GROS ronds (multiples de 50k : 50k, 100k) — psychologiquement les plus forts
console.log(`\n=== Zoom GROS ronds (multiples de 50k$), approche par le bas, fwd 20 bougies ===`)
const G = 50000, K = 20
let appN = 0, appSum = 0, appNeg = 0, broke = 0
const touches: { lvl: number }[] = []
for (let i = 1; i < n - K; i++) {
  if (close[i]! < G) continue
  const L = Math.floor(close[i]! / G) * G + G
  if (high[i]! >= L * (1 - BAND) && high[i - 1]! < L * (1 - BAND)) {
    const fwd = close[i + K]! / close[i]! - 1
    appN++; appSum += fwd; if (fwd < 0) appNeg++
    touches.push({ lvl: L })
    for (let j = i + 1; j <= i + K; j++) if (close[j]! > L * (1 + BAND)) { broke++; break }
  }
}
console.log(`  approche un multiple de 50k : n=${appN}  fwd moy ${f((appSum / Math.max(1, appN)) * 100, 2)}%  %down ${((appNeg / Math.max(1, appN)) * 100).toFixed(0)}%  | cassé ${((broke / Math.max(1, appN)) * 100).toFixed(0)}%`)
console.log(`  niveaux approchés : ${[...new Set(touches.map((t) => t.lvl / 1000 + 'k'))].join(', ')}`)
process.exit(0)
