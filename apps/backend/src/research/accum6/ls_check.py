#!/usr/bin/env python3
# accum6 intraday — SUPPLÉMENT consigné (look n°2 intraday, IS SEULEMENT) :
# ls_z (ratio global long/short des comptes) a franchi la barre à h1.
# Avant toute décision OOS : est-ce de l'information INDÉPENDANTE ou de
# l'anti-momentum repackagé (précédent FNG : corr +0,75 avec roc30 → réfuté) ?
# 1) redondance vs features prix ; 2) IC résiduel (contrôle ôté par rang) ;
# 3) double-tri ; 4) stabilité par année ; 5) persistance du signal.
#   python3 ls_check.py
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'accum3'))
from lib import fwd_logret, rank_std, roll_max, roll_std, shift_null_p, spearman  # noqa: E402
from oi_intraday_study import IS_BTC, IS_ETH, build, date, ms  # noqa: E402


def price_feats(d):
    c = d['c']
    r1 = np.full(len(c), np.nan)
    r1[1:] = np.log(c[1:] / c[:-1])
    out = {}
    for k, lbl in ((24, 'roc1d'), (168, 'roc7d'), (720, 'roc30d_')):
        v = np.full(len(c), np.nan)
        v[k:] = c[k:] / c[:-k] - 1
        out[lbl] = v
    out['dd120d'] = c / roll_max(c, 120 * 24) - 1
    out['rv7d'] = roll_std(r1, 168)
    return out


def residual_ic(v, ctrl, f, ok):
    """IC de v après neutralisation de ctrl (résidu de rangs, IS)."""
    a, b = rank_std(np.where(ok, v, np.nan)), rank_std(np.where(ok, ctrl, np.nan))
    a[~np.isfinite(a)] = 0.0
    b[~np.isfinite(b)] = 0.0
    beta = float(np.mean(a * b))
    resid = np.where(ok, a - beta * b, np.nan)
    return spearman(resid, np.where(ok, f, np.nan))


def main(sym='BTCUSDT', IS=IS_BTC):
    d = build(sym, IS[0], IS[1])
    pf = price_feats(d)
    m = d['m_is']
    v = d['ls_z']
    t = d['t']
    okv = m & np.isfinite(v)
    print(f'=== {sym} — ls_z : caractérisation (IS, n={okv.sum()} h, '
          f'{date(t[np.where(okv)[0][0]])} → {date(t[np.where(okv)[0][-1]])}) ===')
    ac24 = spearman(v[okv][:-24], v[okv][24:])
    print(f'  persistance : autocorr rang à 24 h = {ac24:+.3f}')
    print('  redondance prix :')
    worst, worst_c = None, 0.0
    for lbl, w in pf.items():
        ok = okv & np.isfinite(w)
        cc = np.corrcoef(rank_std(np.where(ok, v, np.nan))[ok], rank_std(np.where(ok, w, np.nan))[ok])[0, 1]
        print(f'    corr rangs (ls_z, {lbl:8}) = {cc:+.3f}')
        if abs(cc) > abs(worst_c):
            worst, worst_c = lbl, cc
    print(f'  → contrôle principal : {worst} ({worst_c:+.2f})')
    for h in (1, 4, 24):
        f = fwd_logret(d['c'], h)
        ok = okv & np.isfinite(f) & np.isfinite(pf[worst])
        sub = np.where(ok)[0]
        ic, p = shift_null_p(v[sub], f[sub], min_shift=max(720, 3 * h))
        ric = residual_ic(v, pf[worst], f, ok)
        ric2 = residual_ic(v, pf['roc30d_'], f, ok & np.isfinite(pf['roc30d_']))
        print(f'  h{h:3d}: IC brut {ic:+.3f} (p {p:.4f}) | résiduel({worst}) {ric:+.3f} | résiduel(roc30d) {ric2:+.3f}')
    # double-tri ls_z × contrôle principal (fwd24)
    f24 = fwd_logret(d['c'], 24)
    ok = okv & np.isfinite(f24) & np.isfinite(pf[worst])
    qv = np.nanquantile(v[ok], [1 / 3, 2 / 3])
    qw = np.nanquantile(pf[worst][ok], [1 / 3, 2 / 3])
    print(f'  double-tri fwd24 (lignes = {worst}, colonnes = ls_z T1/T2/T3) :')
    for j, (wl, wh) in enumerate(((-np.inf, qw[0]), (qw[0], qw[1]), (qw[1], np.inf))):
        row = []
        for vl, vh in ((-np.inf, qv[0]), (qv[0], qv[1]), (qv[1], np.inf)):
            sel = ok & (pf[worst] > wl) & (pf[worst] <= wh) & (v > vl) & (v <= vh)
            row.append(f'{f24[sel].mean() * 100:+6.2f}%(n={sel.sum():4d})' if sel.sum() >= 100 else f' n={sel.sum():4d}<100')
        print(f'    {worst} T{j + 1}: ' + '  '.join(row))
    # stabilité par année
    print('  IC par année (fwd1h / fwd24h) :')
    f1 = fwd_logret(d['c'], 1)
    for y in (2020, 2021, 2022, 2023):
        a, b = ms(np.datetime64(f'{y}-01-01')), ms(np.datetime64(f'{y + 1}-01-01'))
        my = okv & (t >= a) & (t < b)
        if my.sum() < 1500:
            continue
        i1 = spearman(np.where(my, v, np.nan), np.where(my, f1, np.nan))
        i24 = spearman(np.where(my, v, np.nan), np.where(my, f24, np.nan))
        print(f'    {y}: {i1:+.3f} / {i24:+.3f}  (n={my.sum()})')


if __name__ == '__main__':
    main()
    print()
    main('ETHUSDT', IS_ETH)
