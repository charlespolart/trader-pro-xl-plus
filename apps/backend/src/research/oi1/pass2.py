#!/usr/bin/env python3
"""oi1 passe 2 — critères 3 (stabilité annuelle) et 4 (coûts ×2) du
survivant IS « OI-LEVEL LS miroir », PUIS OOS une passe (null rotation
intra-vie) seulement si 3-4 tiennent.  python3 pass2.py"""
import datetime
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'xsection1'))
sys.path.insert(0, os.path.join(HERE, '..', 'zvol1'))
from xsection_u import IS_END, OOS_END, load_panel, metrics, portfolio_fast, universe_symbols  # noqa: E402
from pass2 import portfolio_cm  # noqa: E402  (zvol1 : portfolio à cost_mult, parité prouvée)
from oi1 import IS_START, load_oi, zexp  # noqa: E402

K = 7


def main():
    syms = universe_symbols()
    ts, P = load_panel(syms)
    O = load_oi(syms, ts)
    keep = np.isfinite(O).any(axis=0)
    P = P[:, keep]
    O = O[:, keep]
    with np.errstate(all='ignore'):
        S = -zexp(np.log(O))                      # OI-LEVEL miroir (le survivant)
    lo, hi = int(np.searchsorted(ts, IS_START)), int(np.searchsorted(ts, IS_END))

    ref = portfolio_fast(P, S, K, (lo, hi), 'LS')
    mine = portfolio_cm(P, S, K, (lo, hi), 'LS', cost_mult=1.0)
    par = float(np.abs(ref - mine).max())
    print(f'parité : {par:.2e} {"✓" if par < 1e-12 else "✗ STOP"}')
    if par >= 1e-12:
        return
    m1 = metrics(mine)
    x2 = metrics(portfolio_cm(P, S, K, (lo, hi), 'LS', cost_mult=2.0))
    print(f"IS Sharpe {m1['sharpe']:+.2f} | coûts ×2 → {x2['sharpe']:+.2f} "
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
    print(f"critère 3 : {pos}/{len(years)} positives, pire {worst:+.2f} → {'✓' if ok3 else '✗ MORT'}")

    if ok3 and x2['sharpe'] > 0.5:
        print('\n=== OOS 2024-01→2026-07 — UNE PASSE (OI-LEVEL LS miroir, null intra-vie) ===')
        lo2, hi2 = int(np.searchsorted(ts, IS_END)), int(np.searchsorted(ts, OOS_END))
        oos = portfolio_cm(P, S, K, (lo2, hi2), 'LS')
        mo = metrics(oos)
        rng = np.random.default_rng(7)
        fins = [np.flatnonzero(np.isfinite(S[:, c])) for c in range(S.shape[1])]
        hit = 0
        for _ in range(500):
            Sk = np.full_like(S, np.nan)
            for c, fin in enumerate(fins):
                if len(fin) > 60:
                    k = int(rng.integers(30, len(fin) - 29))
                    Sk[fin, c] = np.roll(S[fin, c], k)
            null = portfolio_fast(P, Sk, K, (lo2, hi2), 'LS')
            sd = null.std(ddof=1)
            if (null.mean() / sd * np.sqrt(365) if sd > 0 else -9) >= mo['sharpe']:
                hit += 1
        p = (1 + hit) / 501
        calmar = mo['cagr'] / mo['dd'] if mo['dd'] > 0 else np.nan
        ok5 = mo['sharpe'] >= 0.5 * m1['sharpe'] and mo['sharpe'] > 0
        print(f"OOS : Sharpe {mo['sharpe']:+.2f} CAGR {mo['cagr']:+.1f}% DD {mo['dd']:.1f}% "
              f"Calmar {calmar:.2f} p={p:.4f} → {'SURVIVANT 1-5 ✓' if ok5 else 'MORT ✗'} "
              f"(barre ≥ {0.5 * m1['sharpe']:.2f})")


if __name__ == '__main__':
    main()
