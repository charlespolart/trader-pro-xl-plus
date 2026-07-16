#!/usr/bin/env python3
"""zvol1 passe 2 — critères 3 (stabilité annuelle) et 4 (coûts ×2) du
survivant IS « K7 LS miroir » (short pumps / long calmes), PUIS OOS une
passe SEULEMENT si 3-4 tiennent. portfolio_fast dupliqué avec cost_mult,
parité exigée à ×1 vs xsection_u.  python3 pass2.py"""
import datetime
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'xsection1'))
from xsection_u import (COST, IS_END, IS_START, MIN_ALIVE, OOS_END, TOPQ,  # noqa: E402
                        WARMUP, load_panel, metrics, portfolio_fast,
                        universe_symbols)
from zvol import load_vol_panel, zvol_signal  # noqa: E402

K = 7


def portfolio_cm(P, S, K_, seg, kind='LS', cost_mult=1.0):
    """copie de portfolio_fast avec cost_mult — parité exigée à ×1."""
    lp = np.log(P)
    n, na = P.shape
    r = np.vstack([np.zeros((1, na)), np.diff(lp, axis=0)])
    r = np.where(np.isfinite(r), r, 0.0)
    lo, hi = seg
    hist = np.isfinite(P).cumsum(axis=0)
    out = np.zeros(hi - lo)
    w = np.zeros(na)
    for t in range(lo, hi, K_):
        alive = np.isfinite(S[t]) & np.isfinite(P[t]) & (hist[t] >= WARMUP)
        idx = np.flatnonzero(alive)
        neww = np.zeros(na)
        if len(idx) >= MIN_ALIVE:
            ntop = max(1, int(round(len(idx) * TOPQ)))
            order = idx[np.argsort(S[t][idx])]
            neww[order[-ntop:]] += 1.0 / ntop
            if kind == 'LS':
                neww[order[:ntop]] -= 1.0 / ntop
        i0 = t - lo
        out[i0] -= COST * cost_mult * np.abs(neww - w).sum()
        w = neww
        j1, j2 = t + 1, min(t + K_, hi, n - 1) + 1
        if j1 < j2:
            out[i0:i0 + (j2 - j1)] += r[j1:j2] @ w
    return out


def main():
    syms = universe_symbols()
    ts, P = load_panel(syms)
    V = load_vol_panel(syms, ts)
    S = -zvol_signal(V)                       # direction miroir (le survivant)
    lo, hi = int(np.searchsorted(ts, IS_START)), int(np.searchsorted(ts, IS_END))

    ref = portfolio_fast(P, S, K, (lo, hi), 'LS')
    mine = portfolio_cm(P, S, K, (lo, hi), 'LS', cost_mult=1.0)
    par = float(np.abs(ref - mine).max())
    print(f'parité portfolio_cm vs portfolio_fast : {par:.2e} {"✓" if par < 1e-12 else "✗ STOP"}')
    if par >= 1e-12:
        return

    m1 = metrics(mine)
    x2 = metrics(portfolio_cm(P, S, K, (lo, hi), 'LS', cost_mult=2.0))
    print(f"IS : Sharpe {m1['sharpe']:+.2f} | coûts ×2 → Sharpe {x2['sharpe']:+.2f} "
          f"→ {'critère 4 ✓' if x2['sharpe'] > 0.5 else 'critère 4 ✗ MORT'}")

    years = {}
    for i in range(lo, hi):
        y = datetime.datetime.fromtimestamp(ts[i] / 1000, datetime.UTC).year
        years.setdefault(y, []).append(i - lo)
    pos = 0
    worst = np.inf
    for y, idxs in sorted(years.items()):
        seg_r = mine[idxs[0]:idxs[-1] + 1]
        sd = seg_r.std(ddof=1)
        sh = seg_r.mean() / sd * np.sqrt(365) if sd > 0 else np.nan
        pos += sh > 0
        worst = min(worst, sh)
        print(f'  {y} : Sharpe {sh:+5.2f}')
    ok3 = pos * 2 > len(years) and worst > -1.0
    print(f'critère 3 : {pos}/{len(years)} années positives, pire {worst:+.2f} '
          f"→ {'✓' if ok3 else '✗ MORT'}")

    if ok3 and x2['sharpe'] > 0.5:
        print('\n=== OOS 2024-01→2026-07 — UNE PASSE (K7 LS miroir uniquement) ===')
        lo2, hi2 = int(np.searchsorted(ts, IS_END)), int(np.searchsorted(ts, OOS_END))
        oos = portfolio_cm(P, S, K, (lo2, hi2), 'LS')
        mo = metrics(oos)
        rng = np.random.default_rng(7)
        hit = 0
        for _ in range(1000):
            null = portfolio_fast(P, S, K, (lo2, hi2), 'LS', perm=rng.permutation(P.shape[1]))
            sd = null.std(ddof=1)
            if (null.mean() / sd * np.sqrt(365) if sd > 0 else -9) >= mo['sharpe']:
                hit += 1
        p = (1 + hit) / 1001
        calmar = mo['cagr'] / mo['dd'] if mo['dd'] > 0 else np.nan
        ok5 = mo['sharpe'] >= 0.5 * m1['sharpe'] and mo['sharpe'] > 0
        print(f"OOS : Sharpe {mo['sharpe']:+.2f} CAGR {mo['cagr']:+.1f}% DD {mo['dd']:.1f}% "
              f"Calmar {calmar:.2f} p={p:.4f} → "
              f"{'SURVIVANT CHAÎNE 1-5 ✓' if ok5 else 'MORT en OOS ✗'} "
              f"(barre ≥ {0.5 * m1['sharpe']:.2f})")


if __name__ == '__main__':
    main()
