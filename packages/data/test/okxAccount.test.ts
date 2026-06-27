import { describe, expect, it } from 'bun:test'
import { OkxAccount } from '../src/okx/account'
import { OkxRest } from '../src/okx/rest'

function restReturning(data: unknown[]) {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ code: '0', msg: '', data }), { status: 200 })) as unknown as typeof fetch
  return new OkxRest({ fetchImpl, credentials: { apiKey: 'k', secret: 's', passphrase: 'p' } })
}

describe('OkxAccount reads', () => {
  it('parses an instrument (tickSz/lotSz/minSz/ctVal/lever)', async () => {
    const acc = new OkxAccount(restReturning([
      { instId: 'BTC-USDT-SWAP', instType: 'SWAP', tickSz: '0.1', lotSz: '1', minSz: '1', ctVal: '0.01', ctValCcy: 'BTC', ctMult: '1', lever: '125', state: 'live', baseCcy: '', quoteCcy: '' },
    ]))
    const inst = await acc.instrument('BTC-USDT-SWAP')
    expect(inst).toMatchObject({ tickSize: 0.1, stepSize: 1, minQty: 1, contractSize: 0.01, maxLeverage: 125 })
  })

  it('converts SWAP positions from contracts to signed base qty', async () => {
    const acc = new OkxAccount(restReturning([
      { instId: 'BTC-USDT-SWAP', pos: '-5', avgPx: '50000', lever: '10', liqPx: '60000', upl: '-12.5' },
    ]))
    const pos = await acc.positions('BTC-USDT-SWAP', 0.01)
    expect(pos[0]).toMatchObject({ qty: -0.05, entryPrice: 50000, leverage: 10, unrealizedPnl: -12.5 })
  })

  it('parses trade-fee and flips sign to positive rates', async () => {
    const acc = new OkxAccount(restReturning([{ maker: '-0.0008', taker: '-0.001', makerU: '-0.0002', takerU: '-0.0005', level: 'Lv1' }]))
    const fee = await acc.tradeFee('SWAP', 'BTC-USDT-SWAP')
    expect(fee).toEqual({ maker: 0.0002, taker: 0.0005, level: 'Lv1' })
  })
})
