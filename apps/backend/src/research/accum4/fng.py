#!/usr/bin/env python3
# accum4 addendum (C3) : CRYPTO FEAR & GREED (alternative.me) → retours BTC/ETH.
# Prior contre : composite ~50% dérivé du prix (vol+momentum), famille sentiment
# 0/4 chez nous (funding, basis, breadth, alt-share). Priors pour : composante
# sociale/trends = information potentiellement neuve ; usage populaire contrarian.
# Causalité : valeur du jour d publiée 00:00 UTC → connue 24 h avant le close(d)
# → cible = forward log-return depuis close(d). IS 2018-04→2024-01 SEULEMENT.
#   python3 fng.py
import json
import os
import sys
import urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'accum3'))
from lib import (IS_END, IS_START, SCRATCH, fwd_logret, load, roll_max,
                 roll_std, shift_null_p, spearman, t_nonoverlap)

DAY = 86400000
HALF = np.datetime64('2021-02-17').astype('datetime64[ms]').astype(np.int64)


def fetch_fng():
    cache = os.path.join(SCRATCH, 'fng.json')
    if not os.path.exists(cache):
        req = urllib.request.Request('https://api.alternative.me/fng/?limit=0',
                                     headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as r:
            open(cache, 'w').write(r.read().decode())
    d = json.loads(open(cache).read())['data']
    days = np.array([int(x['timestamp']) // 86400 for x in d], dtype=np.int64)[::-1]
    vals = np.array([float(x['value']) for x in d])[::-1]
    return days, vals


def align(days, vals, t):
    """valeur FNG du jour de la bougie (publiée à son open 00:00 UTC)."""
    m = {int(d): v for d, v in zip(days, vals)}
    return np.array([m.get(int(tt // DAY), np.nan) for tt in t])


def study(sym: str, fdays, fvals):
    X = load(sym, '1d')
    t, c = X['t'], X['c']
    fng = align(fdays, fvals, t)
    d7 = np.full(len(fng), np.nan)
    d7[7:] = fng[7:] - fng[:-7]
    m_is = (t >= IS_START) & (t < IS_END)
    print(f'=== {sym} — niveau FNG et Δ7j → forward (IS) ===')
    for name, v in (('fng', fng), ('fng_d7', d7)):
        for h in (1, 3, 5, 10, 20):
            f = fwd_logret(c, h)
            ok = m_is & np.isfinite(v) & np.isfinite(f)
            if ok.sum() < 500:
                continue
            sub = np.where(ok)[0]
            ic, p = shift_null_p(v[sub], f[sub], min_shift=max(90, 3 * h))
            tno = t_nonoverlap(np.where(ok, v, np.nan), np.where(ok, f, np.nan), h)
            ic1 = spearman(np.where(ok & (t < HALF), v, np.nan), np.where(ok & (t < HALF), f, np.nan))
            ic2 = spearman(np.where(ok & (t >= HALF), v, np.nan), np.where(ok & (t >= HALF), f, np.nan))
            flag = ' ←' if (np.isfinite(p) and p < 0.01 and np.isfinite(ic1) and np.isfinite(ic2) and np.sign(ic1) == np.sign(ic2) and abs(tno) >= 2) else ''
            print(f'  {name:7} h{h:2d}: IC {ic:+.3f} p {p:.4f} t {tno:+.2f} moitiés {ic1:+.2f}/{ic2:+.2f}{flag}')
    return X, fng, m_is


def main():
    fdays, fvals = fetch_fng()
    print(f'FNG: {len(fvals)} jours, {np.datetime64(int(fdays[0])*86400, "s")} → {np.datetime64(int(fdays[-1])*86400, "s")}, dernier = {fvals[-1]:.0f}')

    X, fng, m_is = study('BTCUSDT', fdays, fvals)
    study('ETHUSDT', fdays, fvals)

    t, c = X['t'], X['c']
    print('=== BTC — quintiles du niveau (fwd 10 j, IS) ===')
    f10 = fwd_logret(c, 10)
    ok = m_is & np.isfinite(fng) & np.isfinite(f10)
    qs = np.nanquantile(fng[ok], [0.2, 0.4, 0.6, 0.8])
    for i in range(5):
        lo = -np.inf if i == 0 else qs[i - 1]
        hi = np.inf if i == 4 else qs[i]
        sel = ok & (fng > lo) & (fng <= hi)
        print(f'  Q{i+1} ({lo:5.0f}..{hi:5.0f}): n={sel.sum():4d}  fwd10j {f10[sel].mean()*100:+.2f}%')

    print('=== BTC — buckets extrêmes (l\'usage contrarian populaire), fwd 10/20 j ===')
    for lo, hi, lbl in ((0, 20, 'extreme fear ≤20'), (0, 25, 'fear ≤25'), (75, 101, 'greed ≥75'), (80, 101, 'extreme greed ≥80')):
        sel = ok & (fng >= lo) & (fng < hi)
        f20 = fwd_logret(c, 20)
        print(f'  {lbl:18}: n={sel.sum():4d}  fwd10j {f10[sel].mean()*100:+.2f}%  fwd20j {f20[sel].mean()*100:+.2f}%  (base fwd10j {f10[ok].mean()*100:+.2f}%)')

    print('=== redondance avec le prix (le FNG est-il un momentum repackagé ?) ===')
    r = np.full(len(c), np.nan)
    r[1:] = np.log(c[1:] / c[:-1])
    roc30 = np.full(len(c), np.nan)
    roc30[30:] = c[30:] / c[:-30] - 1
    dd120 = c / roll_max(c, 120) - 1
    rv20 = roll_std(r, 20)
    for name, v in (('roc_30', roc30), ('dd_120', dd120), ('rv_20', rv20)):
        ok2 = m_is & np.isfinite(fng) & np.isfinite(v)
        print(f'  corr(fng, {name}) = {np.corrcoef(fng[ok2], v[ok2])[0,1]:+.2f}')


if __name__ == '__main__':
    main()
