#!/usr/bin/env python3
"""listing3 — drift post-listing OKX (protocole LOG.md committé AVANT).
Événements = listTime OKX 2024-01→2026-06 ; prix = candles 1d OKX (curl,
WAF bloque urllib) ; excès vs panier EW alts Binance ; null apparié.
  python3 listing3.py"""
import json
import os
import subprocess
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'xsection1'))
from xsection_u import WARMUP, load_panel, universe_symbols  # noqa: E402

DAY = 86_400_000
A = np.datetime64('2024-01-01').astype('datetime64[ms]').astype(np.int64)
B = np.datetime64('2026-06-01').astype('datetime64[ms]').astype(np.int64)
CACHE = os.path.join(HERE, 'okx_listings_px.csv')


def get(url):
    out = subprocess.run(['curl', '-s', url], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def fetch():
    d = get('https://www.okx.com/api/v5/public/instruments?instType=SWAP')['data']
    ev = [(x['instId'], int(x['listTime'])) for x in d
          if x['instId'].endswith('-USDT-SWAP') and x.get('listTime')
          and A <= int(x['listTime']) < B]
    print(f'listings SWAP OKX 2024-01→2026-06 : {len(ev)}')
    with open(CACHE, 'w') as f:
        f.write('base,listTime,t,close\n')
        for i, (inst, lt) in enumerate(sorted(ev, key=lambda x: x[1])):
            base = inst.split('-')[0]
            rows = []
            after = ''
            for _ in range(3):
                url = (f'https://www.okx.com/api/v5/market/history-candles?instId={inst}'
                       f'&bar=1Dutc&limit=100' + (f'&after={after}' if after else ''))
                dd = get(url).get('data', [])
                if not dd:
                    break
                rows += [(int(r[0]), float(r[4])) for r in dd]
                after = dd[-1][0]
                if int(dd[-1][0]) <= lt:
                    break
                time.sleep(0.12)
            keep = [r for r in rows if lt - DAY <= r[0] <= lt + 40 * DAY]
            for t, c in sorted(keep):
                f.write(f'{base},{lt},{t},{c}\n')
            if (i + 1) % 30 == 0:
                print(f'  {i + 1}/{len(ev)}')
            time.sleep(0.12)
    print('fetch prix OKX terminé')


def main():
    if not os.path.exists(CACHE):
        fetch()
    rng = np.random.default_rng(7)
    syms = universe_symbols()
    ts, P = load_panel(syms)
    n, na = P.shape
    r = np.vstack([np.zeros((1, na)), np.diff(np.log(P), axis=0)])
    r = np.where(np.isfinite(r), r, 0.0)
    hist = np.isfinite(P).cumsum(axis=0)
    alive = np.isfinite(P) & (hist >= WARMUP)
    r_ew = np.array([r[t, alive[t]].mean() if alive[t].sum() >= 30 else 0.0 for t in range(n)])
    ex_bin = r - r_ew[:, None]
    cum_ew = np.cumsum(r_ew)
    spot_bases = {s[:-4] for s in syms}

    series = {}
    with open(CACHE) as f:
        next(f)
        for line in f:
            base, lt, t, c = line.strip().split(',')
            series.setdefault((base, int(lt)), []).append((int(t), float(c)))
    groups = {'OKX-only': [], 'communs': []}
    for (base, lt), rows in series.items():
        rows.sort()
        px = {t // DAY: c for t, c in rows}
        days = sorted(px)
        if len(days) < 31:
            continue
        j0 = days[0]
        j30 = [d for d in days if d <= j0 + 30]
        if len(j30) < 25 or j30[-1] < j0 + 27:
            continue
        raw = np.log(px[j30[-1]] / px[j0])
        i0 = int(np.searchsorted(ts, j0 * DAY))
        i1 = int(np.searchsorted(ts, j30[-1] * DAY))
        if i1 >= n or i0 >= n:
            continue
        mkt = cum_ew[min(i1, n - 1)] - cum_ew[min(i0, n - 1)]
        exc = raw - mkt
        groups['communs' if base in spot_bases else 'OKX-only'].append((exc, i0, i1))

    def trim10(x):
        x = np.sort(x)
        k = int(len(x) * 0.10)
        return x[k:len(x) - k].mean()

    for gname, items in groups.items():
        if len(items) < 20:
            print(f'{gname} : n={len(items)} — insuffisant')
            continue
        vals = np.array([v for v, _, _ in items])
        mo, md, tr = vals.mean(), np.median(vals), trim10(vals)
        nulls = np.zeros((1000, 3))
        for it in range(1000):
            fake = []
            for _, i0, i1 in items:
                cand = np.flatnonzero(alive[min(i0, n - 1)])
                b_ = int(rng.choice(cand))
                fake.append(float(ex_bin[i0 + 1:i1 + 1, b_].sum()))
            fk = np.array(fake)
            nulls[it] = (fk.mean(), np.median(fk), trim10(fk))
        pct = [float((nulls[:, k] <= v).mean() * 100) for k, v in enumerate((mo, md, tr))]
        sig = all(p <= 5 for p in pct) or all(p >= 95 for p in pct)
        print(f'{gname:9s} (n={len(vals):3d}) : excès J+1→30 {mo * 100:+7.2f} / {md * 100:+7.2f} / '
              f'{tr * 100:+7.2f} % | percentiles {pct[0]:4.1f}/{pct[1]:4.1f}/{pct[2]:4.1f} '
              f"{'← SIGNAL' if sig else ''}")


if __name__ == '__main__':
    main()
