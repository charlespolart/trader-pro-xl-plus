#!/usr/bin/env python3
"""xsection1 — LOWVOL L/S variante IMPLÉMENTABLE (pré-déclarée au LOG avant
exécution) : jambe longue = spot (inchangée) ; jambe SHORT restreinte aux
noms avec PERP Binance ACTIF à la date (fenêtre = [1er, dernier] jour de
funding du perp, marge 7 j après naissance) ; FUNDING facturé au taux réel
(le short REÇOIT quand rate>0, PAIE quand rate<0). Coûts 30 bps/côté
inchangés. Même barre : Sharpe ≥ 0,8 ET Calmar > 1 ; coûts ×2 → > 0,5.
  python3 impl_u.py"""
import os

import numpy as np

import xsection_u
from xsection_u import (IS_END, IS_START, WARMUP, load_panel, metrics,
                        signal_matrix, universe_symbols)

HERE = os.path.dirname(os.path.abspath(__file__))
TOPQ = 0.30
K = 30


def load_funding(symbols, ts):
    sidx = {s: i for i, s in enumerate(symbols)}
    tidx = {int(t): i for i, t in enumerate(ts)}
    F = np.zeros((len(ts), len(symbols)))
    first = np.full(len(symbols), np.inf)
    last = np.full(len(symbols), -np.inf)
    with open(os.path.join(HERE, 'funding_daily_all.csv')) as f:
        for line in f:
            s, d, r = line.strip().split(',')
            a = sidx.get(s)
            if a is None:
                continue
            d = int(float(d))
            first[a] = min(first[a], d)
            last[a] = max(last[a], d)
            i = tidx.get(d)
            if i is not None:
                F[i, a] = float(r)
    return F, first, last


def portfolio_impl(P, S, ts, F, first, last, seg, cost_mult=1.0):
    lp = np.log(P)
    n, na = P.shape
    r = np.vstack([np.zeros((1, na)), np.diff(lp, axis=0)])
    r = np.where(np.isfinite(r), r, 0.0)
    lo, hi = seg
    hist = np.isfinite(P).cumsum(axis=0)
    out = np.zeros(hi - lo)
    w = np.zeros(na)
    nshort_log = []
    for t in range(lo, hi, K):
        alive = np.isfinite(S[t]) & np.isfinite(P[t]) & (hist[t] >= WARMUP)
        idx = np.flatnonzero(alive)
        neww = np.zeros(na)
        if len(idx) >= 30:
            ntop = max(1, int(round(len(idx) * TOPQ)))
            order = idx[np.argsort(S[t][idx])]
            neww[order[-ntop:]] += 1.0 / ntop            # longs spot inchangés
            day = int(ts[t])
            shortable = [a for a in order[:ntop]
                         if first[a] + 7 * 86_400_000 <= day <= last[a] - 86_400_000]
            nshort_log.append(len(shortable))
            if shortable:
                for a in shortable:
                    neww[a] -= 1.0 / len(shortable)      # jambe re-normalisée à −1
        i0 = t - lo
        out[i0] -= 0.0030 * cost_mult * np.abs(neww - w).sum()
        w = neww
        j1, j2 = t + 1, min(t + K, hi, n - 1) + 1
        if j1 < j2:
            out[i0:i0 + (j2 - j1)] += r[j1:j2] @ w
            # funding des shorts : pnl += |w|×rate = −(F @ ws) (reçu si rate>0)
            ws = np.where(w < 0, w, 0.0)
            out[i0:i0 + (j2 - j1)] += -(F[j1:j2] @ ws)
    return out, (float(np.mean(nshort_log)) if nshort_log else 0.0)


def main():
    syms = universe_symbols()
    ts, P = load_panel(syms)
    seg = (int(np.searchsorted(ts, IS_START)), int(np.searchsorted(ts, IS_END)))
    S = signal_matrix(P, 'LOWVOL', dict())
    F, first, last = load_funding(syms, ts)
    covered = int(np.isfinite(np.where(first < np.inf, first, np.nan)).sum())
    print(f'perps couverts : {covered}/{len(syms)} symboles')

    print('\n=== LOWVOL L/S IMPLÉMENTABLE (shorts = perps actifs, funding réel) ===')
    for cm, lab in ((1.0, 'coûts ×1'), (2.0, 'coûts ×2')):
        d, avg_short = portfolio_impl(P, S, ts, F, first, last, seg, cost_mult=cm)
        m = metrics(d)
        print(f"  {lab}: Sharpe {m['sharpe']:+5.2f} CAGR {m['cagr']:+7.1f}% DD {m['dd']:5.1f}% "
              f"(shorts moyens/rebal : {avg_short:.1f})")

    # décomposition du funding : combien la jambe short paie/reçoit net ?
    d1, _ = portfolio_impl(P, S, ts, F, first, last, seg)
    F0 = np.zeros_like(F)
    d0, _ = portfolio_impl(P, S, ts, F0, first, last, seg)
    diff = (np.exp(d1.sum()) / np.exp(d0.sum()) - 1) * 100
    print(f'\n  effet FUNDING net sur la période : {diff:+.1f}% cumulé '
          f"({'les shorts reçoivent' if diff > 0 else 'les shorts paient'})")


if __name__ == '__main__':
    main()
