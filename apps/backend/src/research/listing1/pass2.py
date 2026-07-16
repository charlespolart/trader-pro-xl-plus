#!/usr/bin/env python3
"""listing1 passe 2 (IS seulement — trop-beau) : stabilité PAR ANNÉE du
drift post-listing + TRADABILITÉ (part des listings avec perp actif tôt,
funding payé par un short les 30 premiers jours).  python3 pass2.py"""
import datetime
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'xsection1'))
from xsection_u import WARMUP, load_panel, universe_symbols  # noqa: E402

IS_A = np.datetime64('2019-02-01').astype('datetime64[ms]').astype(np.int64)
IS_B = np.datetime64('2024-01-01').astype('datetime64[ms]').astype(np.int64)
DAY = 86_400_000


def main():
    syms = universe_symbols()
    ts, P = load_panel(syms)
    n, na = P.shape
    lp = np.log(P)
    r = np.vstack([np.zeros((1, na)), np.diff(lp, axis=0)])
    r = np.where(np.isfinite(r), r, 0.0)
    hist = np.isfinite(P).cumsum(axis=0)
    alive = np.isfinite(P) & (hist >= WARMUP)
    r_ew = np.array([r[t, alive[t]].mean() if alive[t].sum() >= 30 else 0.0 for t in range(n)])
    ex = r - r_ew[:, None]
    fin = np.isfinite(P)
    first = np.argmax(fin, axis=0)
    last = n - 1 - np.argmax(fin[::-1], axis=0)
    events = [a for a in range(na)
              if IS_A <= ts[first[a]] < IS_B and fin[:, a].any()
              and alive[first[a]].sum() >= 30 and first[a] + 31 <= n and last[a] >= first[a] + 30]

    print('=== stabilité PAR ANNÉE du drift J+1→J+30 (excès, moy/méd, n) ===')
    for y in range(2019, 2024):
        sub = [a for a in events
               if datetime.datetime.fromtimestamp(ts[first[a]] / 1000, datetime.UTC).year == y]
        if not sub:
            continue
        v = np.array([float(ex[first[a] + 1:first[a] + 31, a].sum()) for a in sub])
        print(f'  {y} : {v.mean() * 100:+7.2f} % / {np.median(v) * 100:+7.2f} %  (n={len(sub):3d}, '
              f'négatifs {int((v < 0).sum())}/{len(v)})')

    # tradabilité : funding des 30 premiers jours (perp du même symbole)
    fpath = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'xsection1', 'funding_daily_all.csv')
    fund = {}
    with open(fpath) as f:
        for line in f:
            s, d, rate = line.strip().split(',')
            fund.setdefault(s, []).append((int(float(d)), float(rate)))
    with_perp = 0
    fund_paid = []
    for a in events:
        s = syms[a]
        ev = fund.get(s)
        if not ev:
            continue
        t0 = int(ts[first[a]])
        t1 = t0 + 30 * DAY
        rates = [rate for d, rate in ev if t0 <= d < t1]
        if len(rates) >= 10:                    # perp actif dans le premier mois
            with_perp += 1
            fund_paid.append(-float(np.sum(rates)))   # un SHORT paie le funding négatif
    fp = np.array(fund_paid)
    print(f'\n=== tradabilité (jambe short via perp Binance) ===')
    print(f'listings avec perp actif ≥10 j de funding dans le 1er mois : {with_perp}/{len(events)} '
          f'({with_perp / len(events) * 100:.0f} %)')
    print(f'funding PAYÉ par un short sur ces 30 j : moy {fp.mean() * 100:+.2f} % / '
          f'méd {np.median(fp) * 100:+.2f} % / p90 {np.percentile(fp, 90) * 100:+.2f} %')
    print(f'→ drift médian −22 % vs funding médian payé {np.median(fp) * 100:+.2f} % '
          f'+ coûts 0,6 % aller-retour : marge nette médiane ≈ '
          f'{(0.22 - max(np.median(fp), 0) - 0.006) * 100:.1f} pts (grossier, avant slippage listing)')


if __name__ == '__main__':
    main()
