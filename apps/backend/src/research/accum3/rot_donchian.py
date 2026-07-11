#!/usr/bin/env python3
# accum3 famille A, test de clôture : donchian 15/5 TIME-SERIES (params IMPORTÉS
# de X2/accum2, zéro fit ici) sur univers point-in-time restreint aux MAJORS
# (top-10 par volume BTC 90j). Long alt sur cassure de plus-haut 15j du ratio,
# sortie sur cassure de plus-bas 5j ; slots = breakouts actifs (cap 3, tiers).
# Le rank cross-section est mort (-100%) ; ceci est l'expression X2 généralisée.
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import IS_END, IS_START, OOS_END
from rotation import DAY, FEE, load_matrix

DELIST_PEN = 0.005


def top_rank(V, P, n_hist=90, topk=10):
    """rang par volume moyen 90j — éligible si rang ≤ topk et ≥90j d'histoire."""
    n_p, n_d = P.shape
    Vf = np.where(np.isfinite(V), V, 0.0)
    from numpy.lib.stride_tricks import sliding_window_view as swv
    v90 = np.zeros_like(P)
    v90[:, n_hist - 1:] = swv(Vf, n_hist, axis=1).mean(axis=2)
    listed = np.isfinite(P)
    age = listed.cumsum(axis=1)
    ok = listed & (age >= n_hist)
    v90 = np.where(ok, v90, 0.0)
    rk = (-v90).argsort(axis=0).argsort(axis=0)  # 0 = plus gros volume
    return ok & (rk < topk)


def run(P, V, elig, t0d, t1d, N=15, M=5, maxslots=3, fee=FEE):
    n_p, n_d = P.shape
    # précalcul cassures : HH15 (excl. jour courant) et LL5
    hh = np.full_like(P, np.nan)
    ll = np.full_like(P, np.nan)
    from numpy.lib.stride_tricks import sliding_window_view as swv
    Pf = np.where(np.isfinite(P), P, np.nan)
    with np.errstate(all='ignore'):
        h15 = np.full_like(P, np.nan)
        h15[:, N - 1:] = np.nanmax(swv(Pf, N, axis=1), axis=2)
        l5 = np.full_like(P, np.nan)
        l5[:, M - 1:] = np.nanmin(swv(Pf, M, axis=1), axis=2)
    hh[:, 1:] = h15[:, :-1]  # plus-haut des N jours PRÉCÉDENTS
    ll[:, 1:] = l5[:, :-1]
    cash, units = 1.0, {}
    eq, trades, delist = [], 0, 0
    grid = [t for t in range(int(t0d), int(t1d))]
    # map jour → index colonne : days grid = days[0]..days[-1] contiguë
    for t in grid:
        col = t - int(P_days0)
        if col < 0 or col >= n_d:
            continue
        v = cash
        dead = []
        for p_, u in units.items():
            px = P[p_, col]
            if np.isfinite(px):
                v += u * px
            else:
                past = P[p_, :col][np.isfinite(P[p_, :col])]
                px = past[-1] if len(past) else 0.0
                v += u * px * (1 - DELIST_PEN)
                dead.append((p_, px))
        for p_, px in dead:
            cash += units.pop(p_) * px * (1 - DELIST_PEN) * (1 - fee)
            delist += 1
        eq.append(v)
        # sorties : cassure du plus-bas 5j
        for p_ in list(units):
            px = P[p_, col]
            if not np.isfinite(px):
                continue
            if np.isfinite(ll[p_, col]) and px < ll[p_, col]:
                cash += units.pop(p_) * px * (1 - fee)
                trades += 1
        # entrées : cassure du plus-haut 15j, majors éligibles, slots libres
        if len(units) < maxslots:
            cands = [p_ for p_ in np.where(elig[:, col])[0]
                     if p_ not in units and np.isfinite(P[p_, col]) and np.isfinite(hh[p_, col]) and P[p_, col] > hh[p_, col]]
            # priorité aux plus liquides (V du jour)
            cands.sort(key=lambda p_: -(V[p_, col] if np.isfinite(V[p_, col]) else 0))
            for p_ in cands[: maxslots - len(units)]:
                slot_val = (cash + sum(u * P[q, col] for q, u in units.items() if np.isfinite(P[q, col]))) / maxslots
                spend = min(slot_val, cash)
                if spend <= 1e-9:
                    break
                units[p_] = spend * (1 - fee) / P[p_, col]
                cash -= spend
                trades += 1
    eq = np.array(eq)
    peak = np.maximum.accumulate(eq)
    years = ((np.array(grid[: len(eq)]) * DAY).astype('datetime64[ms]').astype('datetime64[Y]')).astype(int) + 1970
    ylines = []
    for y in np.unique(years):
        m = years == y
        seg = eq[m]
        if len(seg) > 1:
            ylines.append(f'{y}:{(seg[-1]/seg[0]-1)*100:+.0f}%')
    return {'net': (eq[-1] - 1) * 100, 'dd': ((eq - peak) / peak).min() * 100, 'tr': trades,
            'yr': ' '.join(ylines)}


if __name__ == '__main__':
    pairs, days, P, V = load_matrix()
    global P_days0
    P_days0 = int(days[0])
    elig = top_rank(V, P, topk=10)
    print(f'univers top-10 par vol90 : méd {np.median(elig.sum(axis=0)[elig.sum(axis=0)>0]):.0f} éligibles/j')
    t0, t1 = IS_START // DAY, IS_END // DAY
    r = run(P, V, elig, t0, t1)
    print(f"IS  donch15/5 top10 slots3 : net {r['net']:+8.1f}%  DD {r['dd']:+.1f}%  {r['tr']}tr  | {r['yr']}")
    for topk in (5, 20):
        e2 = top_rank(V, P, topk=topk)
        r2 = run(P, V, e2, t0, t1)
        print(f"IS  donch15/5 top{topk:2d} slots3 : net {r2['net']:+8.1f}%  DD {r2['dd']:+.1f}%  {r2['tr']}tr  | {r2['yr']}")
