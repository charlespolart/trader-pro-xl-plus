#!/usr/bin/env python3
# accum3 : VRX v2 — passage aux SEUILS ABSOLUS (déployables tels quels, le
# quantile IS serait un fit caché), cap de perte optionnel (leçon v2), stats
# par excursion. IS uniquement.
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from deepdive_vr import vr_5_60
from lib import IS_END, IS_START, align_to, load, regime_1d

FEE = 0.0015
HALF = np.datetime64('2021-02-17').astype('datetime64[ms]').astype(np.int64)


def sim_abs(X, vr, gate, th_in, th_out, cap=0.0, fee=FEE, t0=IS_START, t1=IS_END):
    t, o, c = X['t'], X['o'], X['c']
    idx = np.where((t >= t0) & (t < t1))[0]
    btc, usdt, state, pend = 1.0, 0.0, 1, None
    sold = 0.0
    eq = np.ones(len(idx))
    trades, exc = 0, []
    for j, i in enumerate(idx):
        if pend is not None:
            px = o[i]
            if pend == 0:
                usdt, btc = btc * px * (1 - fee), 0.0
                sold = px
            else:
                new_btc = usdt / px * (1 - fee)
                exc.append((sold / px) * (1 - fee) ** 2 - 1)  # gain BTC de l'excursion
                btc, usdt = new_btc, 0.0
            state = pend
            pend = None
            trades += 1
        eq[j] = btc + usdt / c[i]
        if not np.isfinite(vr[i]):
            continue
        g = bool(gate[i])
        if state == 1 and g and vr[i] > th_in:
            pend = 0
        elif state == 0:
            capped = cap > 0 and sold > 0 and c[i] > sold * (1 + cap)
            if vr[i] < th_out or not g or capped:
                pend = 1
    peak = np.maximum.accumulate(eq)
    tm = t[idx]
    h1 = tm < HALF
    n1 = (eq[h1][-1] / eq[h1][0] - 1) * 100 if h1.sum() > 1 else 0.0
    n2 = (eq[~h1][-1] / eq[~h1][0] - 1) * 100 if (~h1).sum() > 1 else 0.0
    exc = np.array(exc)
    wr = (exc > 0).mean() * 100 if len(exc) else 0.0
    pay = (exc[exc > 0].mean() / -exc[exc <= 0].mean()) if len(exc) and (exc <= 0).any() and (exc > 0).any() else np.nan
    return {'net': (eq[-1] - 1) * 100, 'dd': ((eq - peak) / peak).min() * 100,
            'tr': trades, 'n1': n1, 'n2': n2, 'wr': wr, 'payoff': pay,
            'worst': exc.min() * 100 if len(exc) else 0.0, 'best': exc.max() * 100 if len(exc) else 0.0,
            'nexc': len(exc)}


def main():
    X = load('BTCUSDT', '4h')
    d1 = load('BTCUSDT', '1d')
    ct1, code1 = regime_1d(d1)
    reg = align_to(X['t'], ct1, code1)
    vr = vr_5_60(X['c'])
    ok = (X['t'] >= IS_START) & (X['t'] < IS_END) & np.isfinite(vr)
    for p in (60, 75, 80, 85, 90):
        print(f'  q{p} vr = {np.nanquantile(vr[ok], p / 100):.3f}')
    gate = reg != 1

    print('\n=== seuils ABSOLUS (in × out), gate hors-bull, sans cap ===')
    for thi in (1.05, 1.10, 1.15, 1.20, 1.25):
        row = []
        for tho in (0.85, 0.90, 0.95, 1.00):
            r = sim_abs(X, vr, gate, thi, tho)
            row.append(f'{r["net"]:+6.1f}({r["n1"]:+.0f}/{r["n2"]:+.0f})')
        print(f'  in {thi:.2f}: ' + '  '.join(row))

    print('\n=== cap de perte (in=1.15, out=0.90) ===')
    for cap in (0.0, 0.03, 0.05, 0.08):
        r = sim_abs(X, vr, gate, 1.15, 0.90, cap=cap)
        print(f'  cap {cap*100:3.0f}% : net {r["net"]:+7.1f}%  DD {r["dd"]:+6.1f}%  {r["tr"]:3d}tr  '
              f'{r["nexc"]:3d}exc  WR {r["wr"]:.0f}%  payoff {r["payoff"]:.1f}  pire {r["worst"]:+.1f}%  meilleur {r["best"]:+.1f}%  moitiés {r["n1"]:+.1f}/{r["n2"]:+.1f}')

    print('\n=== grain : vr sur 1h/1d (mêmes seuils relatifs à leur distribution) ===')
    for itv in ('1h', '1d'):
        Xi = load('BTCUSDT', itv)
        if not Xi:
            continue
        ri = align_to(Xi['t'], ct1, code1)
        vri = vr_5_60(Xi['c'])
        oki = (Xi['t'] >= IS_START) & (Xi['t'] < IS_END) & np.isfinite(vri)
        thi = np.nanquantile(vri[oki], 0.85)
        tho = np.nanquantile(vri[oki], 0.60)
        r = sim_abs(Xi, vri, ri != 1, thi, tho)
        print(f'  {itv}: in {thi:.3f} out {tho:.3f} → net {r["net"]:+7.1f}%  DD {r["dd"]:+6.1f}%  {r["tr"]}tr  moitiés {r["n1"]:+.1f}/{r["n2"]:+.1f}')


if __name__ == '__main__':
    main()
