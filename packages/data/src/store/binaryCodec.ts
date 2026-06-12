import type { AggTrade } from '@tpx/shared'

const MAGIC = 0x41585054 // 'TPXA'
const VERSION = 1
const HEADER_BYTES = 16

/**
 * Columnar binary day-file for aggTrades, gzipped:
 *   header [magic u32][version u32][count u32][reserved u32]
 *   columns: id f64[n] | time f64[n] | price f64[n] | qty f64[n] | maker u8[n]
 * All integers fit exactly in f64 (< 2^53). 8-byte alignment holds because
 * the header is 16 bytes and every column is n*8 except the final flags.
 */
export function encodeAggTrades(trades: AggTrade[]): Uint8Array {
  const n = trades.length
  const col = n * 8
  const buf = new ArrayBuffer(HEADER_BYTES + col * 4 + n)
  const dv = new DataView(buf)
  dv.setUint32(0, MAGIC, true)
  dv.setUint32(4, VERSION, true)
  dv.setUint32(8, n, true)

  const ids = new Float64Array(buf, HEADER_BYTES, n)
  const times = new Float64Array(buf, HEADER_BYTES + col, n)
  const prices = new Float64Array(buf, HEADER_BYTES + col * 2, n)
  const qtys = new Float64Array(buf, HEADER_BYTES + col * 3, n)
  const flags = new Uint8Array(buf, HEADER_BYTES + col * 4, n)

  for (let i = 0; i < n; i++) {
    const t = trades[i]!
    ids[i] = t.id
    times[i] = t.time
    prices[i] = t.price
    qtys[i] = t.qty
    flags[i] = t.isBuyerMaker ? 1 : 0
  }
  return Bun.gzipSync(new Uint8Array(buf))
}

export function decodeAggTrades(gzipped: Uint8Array<ArrayBuffer>): AggTrade[] {
  const raw = Bun.gunzipSync(gzipped)
  // copy into a fresh buffer to guarantee 8-byte alignment of the views
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
  const dv = new DataView(buf)
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('Bad aggTrades file (magic mismatch)')
  const version = dv.getUint32(4, true)
  if (version !== VERSION) throw new Error(`Unsupported aggTrades file version ${version}`)
  const n = dv.getUint32(8, true)
  const col = n * 8

  const ids = new Float64Array(buf, HEADER_BYTES, n)
  const times = new Float64Array(buf, HEADER_BYTES + col, n)
  const prices = new Float64Array(buf, HEADER_BYTES + col * 2, n)
  const qtys = new Float64Array(buf, HEADER_BYTES + col * 3, n)
  const flags = new Uint8Array(buf, HEADER_BYTES + col * 4, n)

  const out: AggTrade[] = new Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = {
      id: ids[i]!,
      time: times[i]!,
      price: prices[i]!,
      qty: qtys[i]!,
      isBuyerMaker: flags[i] === 1,
    }
  }
  return out
}
