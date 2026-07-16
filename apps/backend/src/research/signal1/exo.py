#!/usr/bin/env python3
"""signal1 (H13) + onchain1 (H10) — étude quantile commune (protocoles
committés AVANT). Quintiles EXPANSIFS (≥180 j de passé), forwards BTC
7/30 j, stat Δ(Q5−Q1), null = rotation du vecteur signal (1000×), placebo
iid (200×). Event study de SÉPARATION — pas un backtest.
  python3 exo.py"""
import json
import os
import subprocess
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'xsection1'))
from xsection_u import DB  # noqa: E402

DAY = 86_400_000
MIN_HIST = 180
HORIZONS = (7, 30)
IS_END = np.datetime64('2024-01-01').astype('datetime64[ms]').astype(np.int64)
BAR_BPS = 120.0


def curl_json(url):
    out = subprocess.run(['curl', '-s', url], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def load_btc(a='2017-06-01'):
    q = ("COPY (SELECT open_time, close FROM candles WHERE market='spot' AND symbol='BTCUSDT' "
         "AND interval='1d' ORDER BY open_time) TO STDOUT (FORMAT csv)")
    out = subprocess.run(['psql', DB, '-c', q], capture_output=True, text=True, check=True).stdout
    rows = [(int(float(x)), float(y)) for x, y in (line.split(',') for line in out.strip().split('\n') if line)]
    a_ms = np.datetime64(a).astype('datetime64[ms]').astype(np.int64)
    rows = [r for r in rows if r[0] >= a_ms]
    ts = np.array([r[0] for r in rows], dtype=np.int64)
    px = np.array([r[1] for r in rows])
    return ts, px


def fetch_dvol():
    cache = os.path.join(HERE, 'dvol_btc.csv')
    if os.path.exists(cache):
        pass
    else:
        rows = []
        t0 = 1609459200000                      # 2021-01 (borne large)
        now = 1784216000000
        t = t0
        while t < now:
            t2 = min(t + 90 * DAY, now)
            d = curl_json(f'https://www.deribit.com/api/v2/public/get_volatility_index_data'
                          f'?currency=BTC&start_timestamp={t}&end_timestamp={t2}&resolution=1D')
            for row in d.get('result', {}).get('data', []):
                rows.append((int(row[0]), float(row[4])))
            t = t2
            time.sleep(0.25)
        with open(cache, 'w') as f:
            f.write('t,close\n')
            for t_, v in sorted(set(rows)):
                f.write(f'{t_},{v}\n')
    d = {}
    with open(cache) as f:
        next(f)
        for line in f:
            t_, v = line.strip().split(',')
            d[int(t_) // DAY] = float(v)
    return d


def fetch_fng():
    cache = os.path.join(HERE, '..', 'onchain1', 'fng.csv')
    if not os.path.exists(cache):
        d = curl_json('https://api.alternative.me/fng/?limit=0&format=json')['data']
        with open(cache, 'w') as f:
            f.write('t,v\n')
            for x in sorted(d, key=lambda z: int(z['timestamp'])):
                f.write(f"{int(x['timestamp']) * 1000},{x['value']}\n")
    out = {}
    with open(cache) as f:
        next(f)
        for line in f:
            t_, v = line.strip().split(',')
            out[int(t_) // DAY] = float(v)
    return out


def fetch_cm(metric):
    cache = os.path.join(HERE, '..', 'onchain1', f'cm_{metric}.csv')
    if not os.path.exists(cache):
        rows = []
        url = (f'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics'
               f'?assets=btc&metrics={metric}&frequency=1d&page_size=10000&start_time=2017-06-01')
        while url:
            d = curl_json(url)
            for x in d.get('data', []):
                t_ = int(np.datetime64(x['time'][:10]).astype('datetime64[ms]').astype(np.int64))
                v = x.get(metric)
                if v is not None:
                    rows.append((t_, float(v)))
            url = d.get('next_page_url')
            time.sleep(0.4)
        with open(cache, 'w') as f:
            f.write('t,v\n')
            for t_, v in rows:
                f.write(f'{t_},{v}\n')
    out = {}
    with open(cache) as f:
        next(f)
        for line in f:
            t_, v = line.strip().split(',')
            out[int(t_) // DAY] = float(v)
    return out


def zscore_exp(x, look=365):
    out = np.full_like(x, np.nan)
    for i in range(look, len(x)):
        w = x[i - look:i]
        sd = w.std(ddof=1)
        if sd > 0:
            out[i] = (x[i] - w.mean()) / sd
    return out


def dq(signal, fwd, lo, hi):
    """Δ moyenne forward Q5 − Q1, quintiles EXPANSIFS sur [lo, hi)."""
    q5, q1 = [], []
    for i in range(lo, hi):
        s = signal[i]
        if not np.isfinite(s) or not np.isfinite(fwd[i]):
            continue
        past = signal[max(0, i - 5000):i]
        past = past[np.isfinite(past)]
        if len(past) < MIN_HIST:
            continue
        r = (past < s).mean()
        if r >= 0.8:
            q5.append(fwd[i])
        elif r <= 0.2:
            q1.append(fwd[i])
    if len(q5) < 30 or len(q1) < 30:
        return np.nan, 0, 0
    return float(np.mean(q5) - np.mean(q1)), len(q5), len(q1)


def study(name, sig, fwds, ts, lo, hi, rng, nperm=1000):
    for h, fwd in fwds.items():
        real, n5, n1 = dq(sig, fwd, lo, hi)
        if not np.isfinite(real):
            print(f'  {name} fwd{h:2d}j : n insuffisant')
            continue
        hits = 0
        n = len(sig)
        for _ in range(nperm):
            k = int(rng.integers(30, n - 30))
            null, _, _ = dq(np.roll(sig, k), fwd, lo, hi)
            if np.isfinite(null) and abs(null) >= abs(real):
                hits += 1
        p = (1 + hits) / (1 + nperm)
        bps = real * 1e4
        trad = 'tradable?' if abs(bps) >= BAR_BPS and p <= 0.05 else ('signal réel non tradable' if p <= 0.05 else 'néant')
        print(f'  {name} fwd{h:2d}j : ΔQ5−Q1 {bps:+7.1f} bps (n {n5}/{n1}) p={p:.4f} → {trad}')


def main():
    rng = np.random.default_rng(7)
    ts, px = load_btc()
    days = (ts // DAY).astype(int)
    lp = np.log(px)
    n = len(ts)
    fwds = {}
    for h in HORIZONS:
        f = np.full(n, np.nan)
        f[:-h] = lp[h:] - lp[:-h]
        fwds[h] = f
    rv = np.full(n, np.nan)
    r1 = np.diff(lp)
    for i in range(31, n):
        rv[i] = r1[i - 30:i].std(ddof=1) * np.sqrt(365) * 100
    hi_is = int(np.searchsorted(ts, IS_END))

    print('=== signal1 (H13) — IS →2024-01, event study de séparation ===')
    dvol_d = fetch_dvol()
    dvol = np.array([dvol_d.get(d, np.nan) for d in days])
    first = np.flatnonzero(np.isfinite(dvol))
    print(f'DVOL BTC : {int(np.isfinite(dvol).sum())} j '
          f'({str(np.datetime64(int(ts[first[0]]), "ms"))[:10] if len(first) else "?"} →)')
    study('S1 DVOL   ', dvol, fwds, ts, 0, hi_is, rng)
    study('S2 VRP    ', dvol - rv, fwds, ts, 0, hi_is, rng)

    print('\n=== onchain1 (H10) — IS →2024-01 ===')
    fng_d = fetch_fng()
    fng = np.array([fng_d.get(d, np.nan) for d in days])
    study('G1 F&G    ', fng, fwds, ts, 0, hi_is, rng)
    for gname, metric in (('G2 AdrAct ', 'AdrActCnt'), ('G3 TxVal  ', 'TxTfrValAdjUSD')):
        raw_d = fetch_cm(metric)
        raw = np.array([raw_d.get(d, np.nan) for d in days])
        with np.errstate(all='ignore'):
            z = zscore_exp(np.log(raw))
        study(gname, z, fwds, ts, 0, hi_is, rng)

    print('\n=== placebo (signaux iid-shufflés, 100 runs × fwd30) ===')
    hitp = 0
    base = fng[np.isfinite(fng)]
    for it in range(100):
        fake = np.full(n, np.nan)
        idx = np.flatnonzero(np.isfinite(fng))
        fake[idx] = rng.permutation(base)
        real, _, _ = dq(fake, fwds[30], 0, hi_is)
        if not np.isfinite(real):
            continue
        hits = 0
        for _ in range(100):
            k = int(rng.integers(30, n - 30))
            null, _, _ = dq(np.roll(fake, k), fwds[30], 0, hi_is)
            if np.isfinite(null) and abs(null) >= abs(real):
                hits += 1
        if (1 + hits) / 101 < 0.05:
            hitp += 1
    print(f'placebo : {hitp}/100 à p<0,05 (attendu ~5)')


if __name__ == '__main__':
    main()
