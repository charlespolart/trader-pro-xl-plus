#!/usr/bin/env python3
# accum3 famille C : le BREADTH de l'univers alt (fraction au-dessus de MA50,
# fraction à momentum 30j positif) prédit-il les retours BTC ? Étude de
# séparation AVANT tout backtest (protocole). IS uniquement, null compacté.
#   python3 rotation.py breadth   # d'abord (exporte breadth.npz)
#   python3 breadth_study.py
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import IS_END, IS_START, SCRATCH, fwd_logret, load, shift_null_p, spearman

DAY = 86400000


def main():
    z = np.load(os.path.join(SCRATCH, 'breadth.npz'))
    days, breadth, posmom, nelig = z['days'], z['breadth'], z['posmom'], z['nelig']
    X = load('BTCUSDT', '1d')
    # aligner : la breadth du jour d est connue à la CLÔTURE du jour d → pour la
    # décision à la clôture de la bougie BTC du jour d, on peut l'utiliser telle
    # quelle (mêmes bougies 00:00 UTC). Mapping par open_time/DAY.
    bd = {int(d): i for i, d in enumerate(days)}
    idx = np.array([bd.get(int(tt // DAY), -1) for tt in X['t']])
    okmap = idx >= 0
    feats = {
        'breadth_ma50': np.where(okmap, breadth[np.maximum(idx, 0)], np.nan),
        'posmom30': np.where(okmap, posmom[np.maximum(idx, 0)], np.nan),
    }
    # dérivées : variation 30j de la breadth
    b = feats['breadth_ma50']
    d30 = np.full(len(b), np.nan)
    d30[30:] = b[30:] - b[:-30]
    feats['breadth_chg30'] = d30
    m_is = (X['t'] >= IS_START) & (X['t'] < IS_END)
    half = np.datetime64('2021-02-17').astype('datetime64[ms]').astype(np.int64)
    print(f"éligibles méd {np.median(nelig[nelig > 0]):.0f}")
    for h in (5, 10, 20):
        f = fwd_logret(X['c'], h)
        for name, v in feats.items():
            ok = m_is & np.isfinite(v) & np.isfinite(f)
            if ok.sum() < 500:
                print(f'  h{h} {name}: n insuffisant')
                continue
            sub = np.where(ok)[0]
            ic, p = shift_null_p(v[sub], f[sub], min_shift=90)
            ic1 = spearman(np.where(ok & (X['t'] < half), v, np.nan), np.where(ok & (X['t'] < half), f, np.nan))
            ic2 = spearman(np.where(ok & (X['t'] >= half), v, np.nan), np.where(ok & (X['t'] >= half), f, np.nan))
            qs = np.nanquantile(v[ok], [0.25, 0.75])
            lo = f[ok & (v <= qs[0])].mean() * 100
            hi = f[ok & (v >= qs[1])].mean() * 100
            print(f'  h{h:2d} {name:14} IC {ic:+.3f} p {p:.4f}  moitiés {ic1:+.2f}/{ic2:+.2f}  Q1 {lo:+.2f}% Q4 {hi:+.2f}%')


if __name__ == '__main__':
    main()
