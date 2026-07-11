/**
 * Heure de New York sans dépendance externe : règle DST US post-2007
 * (2ᵉ dimanche de mars 02:00 EST → 1ᵉʳ dimanche de novembre 02:00 EDT).
 * Les effets « heures US » se mesurent en heure locale NY, sinon le passage
 * heure d'été/hiver étale chaque effet sur deux bins UTC.
 * Testé : time.test.ts (frontières 2019/2022/2024/2025/2026).
 */
const HOUR = 3_600_000
const DAY = 86_400_000

/** ms UTC à minuit du n-ième dimanche (1-indexé) du mois (0-indexé) */
function nthSundayUtc(year: number, month: number, nth: number): number {
  const first = Date.UTC(year, month, 1)
  const dow = new Date(first).getUTCDay() // 0 = dimanche
  return first + (((7 - dow) % 7) + (nth - 1) * 7) * DAY
}

/** vrai si l'instant est en heure d'été US (EDT, UTC-4) */
export function isEdt(utcMs: number): boolean {
  const y = new Date(utcMs).getUTCFullYear()
  const dstStart = nthSundayUtc(y, 2, 2) + 7 * HOUR // 02:00 EST = 07:00 UTC
  const dstEnd = nthSundayUtc(y, 10, 1) + 6 * HOUR // 02:00 EDT = 06:00 UTC
  return utcMs >= dstStart && utcMs < dstEnd
}

export function nyOffsetHours(utcMs: number): number {
  return isEdt(utcMs) ? -4 : -5
}

/** heure locale New York 0-23 */
export function nyHour(utcMs: number): number {
  return new Date(utcMs + nyOffsetHours(utcMs) * HOUR).getUTCHours()
}

/** jour de semaine à New York, 0=dimanche … 6=samedi */
export function nyDow(utcMs: number): number {
  return new Date(utcMs + nyOffsetHours(utcMs) * HOUR).getUTCDay()
}
