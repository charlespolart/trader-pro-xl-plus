#!/usr/bin/env python3
# accum4 : horizons « partout » — cross-market et sentiment.
#   (a) SPX / DXY / OR (stooq, quotidien) laggés → BTC forward 1/3/5 j.
#       Alignement CAUSAL : close US ~21-22h UTC du jour d → bougies BTC à
#       partir de 00:00 UTC d+1 (dernier close daté ≤ d).
#   (b) Part de volume alt : Σ qv(*BTC)/qv(BTCUSDT), z-90j → BTC forward.
# IS uniquement, IC + null décalage circulaire + moitiés.
import io
import urllib.parse
import os
import sys
import urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'accum3'))
from lib import (DB, IS_END, IS_START, SCRATCH, fwd_logret, load, roll_mean,
                 roll_std, shift_null_p, spearman)

HALF = np.datetime64('2021-02-17').astype('datetime64[ms]').astype(np.int64)
DAY = 86400000


def fetch_yahoo(symbol: str):
    import json
    safe = symbol.replace('^', '_').replace('=', '_').replace('.', '_').replace('-', '_')
    cache = os.path.join(SCRATCH, f'yahoo_{safe}.json')
    if not os.path.exists(cache):
        url = (f'https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}'
               f'?range=10y&interval=1d')
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read().decode()
            json.loads(data)['chart']['result'][0]
        except Exception as e:
            print(f'  {symbol}: fetch KO ({e})')
            return None
        open(cache, 'w').write(data)
    j = json.loads(open(cache).read())['chart']['result'][0]
    ts = np.array(j['timestamp'], dtype=np.int64)
    cl = np.array([x if x is not None else np.nan for x in j['indicators']['quote'][0]['close']])
    ok = np.isfinite(cl)
    # jour de bourse d (close connu ~21-22h UTC de d) — timestamps Yahoo = open du jour
    return (ts[ok] // 86400), cl[ok]


def eval_sig(name, sig_days, sig_vals, btc_t, btc_c, m_is):
    """sig connu au jour d (close US) → aligné sur la bougie BTC ouvrant à d+1."""
    for k in (1, 5):
        ret = np.full(len(sig_vals), np.nan)
        ret[k:] = np.log(sig_vals[k:] / sig_vals[:-k])
        btc_day = btc_t // DAY
        idx = np.searchsorted(sig_days, btc_day - 1, side='right') - 1
        ok_map = idx >= 0
        al = np.where(ok_map, ret[np.maximum(idx, 0)], np.nan)
        # fraîcheur : signal daté d'au plus 3 jours (week-ends)
        age = btc_day - np.where(ok_map, sig_days[np.maximum(idx, 0)], -10)
        al[age > 3] = np.nan
        for h in (1, 3, 5):
            f = fwd_logret(btc_c, h)
            ok = m_is & np.isfinite(al) & np.isfinite(f)
            if ok.sum() < 500:
                continue
            sub = np.where(ok)[0]
            ic, p = shift_null_p(al[sub], f[sub], min_shift=max(90, 3 * h))
            ic1 = spearman(np.where(ok & (btc_t < HALF), al, np.nan), np.where(ok & (btc_t < HALF), f, np.nan))
            ic2 = spearman(np.where(ok & (btc_t >= HALF), al, np.nan), np.where(ok & (btc_t >= HALF), f, np.nan))
            flag = ' ←' if (np.isfinite(p) and p < 0.01 and np.sign(ic1) == np.sign(ic2)) else ''
            print(f'  {name}_ret{k} → fwd{h}j : IC {ic:+.3f} p {p:.4f} moitiés {ic1:+.2f}/{ic2:+.2f}{flag}')


def main():
    X = load('BTCUSDT', '1d')
    btc_t, btc_c = X['t'], X['c']
    m_is = (btc_t >= IS_START) & (btc_t < IS_END)

    print('=== (a) cross-market laggé → BTC fwd (IS) ===')
    for name, sym in (('spx', '^GSPC'), ('dxy', 'DX-Y.NYB'), ('gold', 'GC=F')):
        r = fetch_yahoo(sym)
        if r is None:
            continue
        days, closes = r
        print(f'  [{name}] {len(closes)} points, {np.datetime64(int(days[0]*DAY), "ms")} → {np.datetime64(int(days[-1]*DAY), "ms")}')
        eval_sig(name, days, closes, btc_t, btc_c, m_is)

    print('\n=== (b) part de volume alt (Σ qv *BTC / qv BTCUSDT), z-90j → BTC fwd (IS) ===')
    import subprocess
    sql = ("COPY (SELECT open_time/86400000, SUM(GREATEST(quote_volume, volume*close)) "
           "FROM candles WHERE market='spot' AND interval='1d' AND symbol LIKE '%BTC' "
           "GROUP BY 1 ORDER BY 1) TO STDOUT WITH (FORMAT csv)")
    p = subprocess.run(['psql', DB, '-q', '-c', sql], capture_output=True)
    rows = [ln.split(',') for ln in p.stdout.decode().splitlines()]
    ad = {int(a): float(b) for a, b in rows}
    btc_day = btc_t // DAY
    altv = np.array([ad.get(int(d), np.nan) for d in btc_day])
    share = altv / (X['qv'] + 1)
    z = (share - roll_mean(share, 90)) / (roll_std(share, 90) + 1e-12)
    for h in (3, 5, 10, 20):
        f = fwd_logret(btc_c, h)
        ok = m_is & np.isfinite(z) & np.isfinite(f)
        sub = np.where(ok)[0]
        ic, p_ = shift_null_p(z[sub], f[sub], min_shift=max(90, 3 * h))
        ic1 = spearman(np.where(ok & (btc_t < HALF), z, np.nan), np.where(ok & (btc_t < HALF), f, np.nan))
        ic2 = spearman(np.where(ok & (btc_t >= HALF), z, np.nan), np.where(ok & (btc_t >= HALF), f, np.nan))
        print(f'  altshare_z90 → fwd{h}j : IC {ic:+.3f} p {p_:.4f} moitiés {ic1:+.2f}/{ic2:+.2f}')


if __name__ == '__main__':
    main()
