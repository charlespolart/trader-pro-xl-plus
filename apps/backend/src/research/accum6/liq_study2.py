#!/usr/bin/env python3
# accum6 — SECONDE PASSE (même IS, consignée au ledger comme look n°2 daily) :
# 1) extrêmes en RANG roulant (le z log1p compresse la queue : z≥2 → n=6 en 4 ans,
#    ce n'est pas l'intention « jour extrême ») → events à rank ≥0.98 / ≥0.995 ;
# 2) double-tri z_short × roc30 : la séparation z_short en marché haussier
#    est-elle du momentum repackagé ?
# 3) oi_z (meilleur quintile monotone de la passe 1) : stabilité par année.
# IS 2020-01→2024-01 SEULEMENT.
#   ACCUM3_STATE=<scratchpad> python3 liq_study2.py
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'accum3'))
from lib import SCRATCH, fwd_logret, roll_rank, spearman  # noqa: E402
from liq_study import HS, VENUES, W, build, date, events  # noqa: E402


def add_ranks(d: dict):
    """Percentile roulant 180 j (par venue puis moyenne) des liq USD long/short."""
    for side, arr in (('long', d['usd_l_venues']), ('short', d['usd_s_venues'])):
        rk = np.full_like(arr, np.nan)
        for i in range(len(VENUES)):
            x = arr[i]
            ok = np.isfinite(x)
            if ok.sum() > W:
                # roll_rank exige une série pleine : on rank sur la partie finie
                sub = roll_rank(x[ok], W)
                tmp = np.full(len(x), np.nan)
                tmp[np.where(ok)[0]] = sub
                rk[i] = tmp
        cnt = np.isfinite(rk).sum(axis=0)
        with np.errstate(invalid='ignore'):
            d[f'rank_{side}'] = np.where(cnt >= 2, np.nanmean(rk, axis=0), np.nan)


def double_sort(d: dict, h: int = 10):
    """z_short × roc30 en marché haussier : terciles croisés (fwd10)."""
    print(f'=== double-tri z_short × roc30 | roc30>0 (fwd{h}, IS) ===')
    f = fwd_logret(d['c'], h)
    m = d['m_is'] & (d['roc30'] > 0) & np.isfinite(d['z_short']) & np.isfinite(f) & np.isfinite(d['roc30'])
    qz = np.nanquantile(d['z_short'][m], [1 / 3, 2 / 3])
    qm = np.nanquantile(d['roc30'][m], [1 / 3, 2 / 3])
    print(f'  {"":14} {"z_short T1":>12} {"T2":>12} {"T3":>12}')
    for j, (mlo, mhi) in enumerate(((-np.inf, qm[0]), (qm[0], qm[1]), (qm[1], np.inf))):
        row = []
        for zlo, zhi in ((-np.inf, qz[0]), (qz[0], qz[1]), (qz[1], np.inf)):
            sel = m & (d['roc30'] > mlo) & (d['roc30'] <= mhi) & (d['z_short'] > zlo) & (d['z_short'] <= zhi)
            row.append(f'{f[sel].mean()*100:+6.2f}%(n={sel.sum():3d})' if sel.sum() >= 15 else f'   n={sel.sum():3d} <15')
        print(f'  roc30 T{j+1:1d}     ' + ' '.join(f'{x:>12}' for x in row))
    # IC de z_short APRÈS neutralisation de roc30 (résidu de rang, grossier)
    ok = m
    zr = d['z_short'][ok]
    mr = d['roc30'][ok]
    fr = f[ok]
    # régression de rang simple : résidu de z_short sur roc30
    from lib import rank_std
    a, b = rank_std(zr), rank_std(mr)
    resid = a - np.corrcoef(a, b)[0, 1] * b
    print(f'  IC(z_short, fwd{h}) brut {spearman(zr, fr):+.3f} | résiduel (roc30 ôté) {spearman(resid, fr):+.3f}')


def oi_by_year(d: dict, h: int = 20):
    print(f'=== oi_z par année (IC fwd{h}, IS) ===')
    f = fwd_logret(d['c'], h)
    for y in (2020, 2021, 2022, 2023):
        a = np.datetime64(f'{y}-01-01').astype('datetime64[ms]').astype(np.int64)
        b = np.datetime64(f'{y + 1}-01-01').astype('datetime64[ms]').astype(np.int64)
        m = d['m_is'] & (d['t'] >= a) & (d['t'] < b)
        ic = spearman(np.where(m, d['oi_z'], np.nan), np.where(m, f, np.nan))
        n = (m & np.isfinite(d['oi_z']) & np.isfinite(f)).sum()
        print(f'  {y}: IC {ic:+.3f} (n={n})')


def main():
    raw = json.load(open(os.path.join(SCRATCH, 'coinalyze_daily.json')))
    btc = build('BTC', 'BTCUSDT', raw)
    add_ranks(btc)
    m = btc['m_is']
    for s in ('long', 'short'):
        r = btc[f'rank_{s}']
        print(f'rank_{s}: n IS fini = {(m & np.isfinite(r)).sum()}, ≥0.98 : {(m & (r >= 0.98)).sum()} j, ≥0.995 : {(m & (r >= 0.995)).sum()} j')
    print()
    rk_l, rk_s, roc30 = btc['rank_long'], btc['rank_short'], btc['roc30']
    evs = [
        ('extrême longs rank≥0.98', rk_l >= 0.98),
        ('extrême longs rank≥0.995', rk_l >= 0.995),
        ('extrême shorts rank≥0.98', rk_s >= 0.98),
        ('extrême shorts rank≥0.995', rk_s >= 0.995),
        ('capitulation (rkL≥0.98 & roc30<0)', (rk_l >= 0.98) & (roc30 < 0)),
        ('capitulation (rkL≥0.995 & roc30<0)', (rk_l >= 0.995) & (roc30 < 0)),
        ('squeeze (rkS≥0.98 & roc30>0)', (rk_s >= 0.98) & (roc30 > 0)),
        ('les deux extrêmes (rkL&rkS ≥0.98)', (rk_l >= 0.98) & (rk_s >= 0.98)),
    ]
    events(btc, evs, 'BTC — event studies, extrêmes en RANG (IS)')
    print()
    # dates des capitulations rank≥0.995 (lecture humaine)
    f10 = fwd_logret(btc['c'], 10)
    sel = np.where(m & (rk_l >= 0.995) & (roc30 < 0))[0]
    if len(sel):
        print('  capitulations rk≥0.995 & roc30<0 :')
        for i in sel:
            print(f'    {date(btc["t"][i])}  ret jour {btc["ret1"][i]*100:+6.2f}%  fwd10 {f10[i]*100:+6.2f}%')
    print()
    double_sort(btc, 10)
    print()
    oi_by_year(btc, 20)


if __name__ == '__main__':
    main()
