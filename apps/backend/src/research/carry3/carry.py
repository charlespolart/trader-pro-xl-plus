#!/usr/bin/env python3
"""carry3 — machinerie facteur funding en coupe (protocole LOG.md committé
avant). Prix = panel spot xsection1 (proxy) ; funding réel 791 perps ;
éligibilité OBSERVABLE (≥21 événements vus, dernier < 48 h) ; pnl funding =
−(F @ w) pour tout w ; null = réétiquetage de colonnes (funding ET prix du
même actif restent appariés — on permute l'ATTRIBUTION du signal).
  python3 carry.py placebo | control | is | oos"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'xsection1'))
from xsection_u import (WARMUP, bh_flags, load_panel, metrics,  # noqa: E402
                        universe_symbols)

HERE = os.path.dirname(os.path.abspath(__file__))
IS_START = np.datetime64('2020-07-01').astype('datetime64[ms]').astype(np.int64)
IS_END = np.datetime64('2024-01-01').astype('datetime64[ms]').astype(np.int64)
OOS_END = np.datetime64('2026-07-01').astype('datetime64[ms]').astype(np.int64)
COST = 0.0030
TOPQ = 0.30
MIN_ALIVE = 30
DAY = 86_400_000


def load_funding_panel(symbols, ts):
    """F[t,a] = funding du jour ; cnt[t,a] = nb cumulés d'événements vus ;
    lastev[t,a] = jours depuis le dernier événement (∞ avant le premier)."""
    sidx = {s: i for i, s in enumerate(symbols)}
    tidx = {int(t): i for i, t in enumerate(ts)}
    F = np.zeros((len(ts), len(symbols)))
    seen = np.zeros((len(ts), len(symbols)))
    path = os.path.join(HERE, '..', 'xsection1', 'funding_daily_all.csv')
    with open(path) as f:
        for line in f:
            s, d, r = line.strip().split(',')
            a = sidx.get(s)
            if a is None:
                continue
            i = tidx.get(int(float(d)))
            if i is not None:
                F[i, a] = float(r)
                seen[i, a] = 3.0          # ~3 événements 8 h par jour agrégé
    cnt = seen.cumsum(axis=0)
    # jours depuis le dernier événement
    lastev = np.full_like(F, np.inf)
    last_seen = np.full(len(symbols), -np.inf)
    for i in range(len(ts)):
        has = seen[i] > 0
        last_seen[has] = i
        lastev[i] = i - last_seen
    return F, cnt, lastev


def signal_funding(F, fam, prm):
    n, na = F.shape
    S = np.full((n, na), np.nan)
    cs = np.vstack([np.zeros((1, na)), np.cumsum(F, axis=0)])
    if fam == 'FLEVEL':
        L = prm['L']
        S[L:] = -(cs[L + 1:] - cs[1:n - L + 1])
    else:  # FMOM : −(moy 3 j − moy L jours)
        L = prm['L']
        m3 = (cs[4:] - cs[1:n - 2]) / 3.0
        mL = (cs[L + 1:] - cs[1:n - L + 1]) / float(L)
        S[L:] = -(m3[L - 3:] - mL)
    return S


def portfolio(P, F, cnt, lastev, S, K, seg, kind='LS', perm=None, cost_mult=1.0,
              funding_only=False, price_only=False):
    lp = np.log(P)
    n, na = P.shape
    r = np.vstack([np.zeros((1, na)), np.diff(lp, axis=0)])
    r = np.where(np.isfinite(r), r, 0.0)
    lo, hi = seg
    hist = np.isfinite(P).cumsum(axis=0)
    Su = S if perm is None else S[:, perm]
    out = np.zeros(hi - lo)
    w = np.zeros(na)
    for t in range(lo, hi, K):
        elig = (np.isfinite(Su[t]) & np.isfinite(P[t]) & (hist[t] >= WARMUP)
                & (cnt[t] >= 21) & (lastev[t] <= 2))
        idx = np.flatnonzero(elig)
        neww = np.zeros(na)
        if len(idx) >= MIN_ALIVE:
            ntop = max(1, int(round(len(idx) * TOPQ)))
            order = idx[np.argsort(Su[t][idx])]
            neww[order[-ntop:]] += 1.0 / ntop           # signal haut = funding bas → LONG
            if kind == 'LS':
                neww[order[:ntop]] -= 1.0 / ntop        # funding haut → SHORT
        i0 = t - lo
        out[i0] -= COST * cost_mult * np.abs(neww - w).sum()
        w = neww
        j1, j2 = t + 1, min(t + K, hi, n - 1) + 1
        if j1 < j2:
            blk = np.zeros(j2 - j1)
            if not funding_only:
                blk += r[j1:j2] @ w
            if not price_only:
                blk += -(F[j1:j2] @ w)                  # long paie F>0, short le reçoit
            out[i0:i0 + (j2 - j1)] += blk
    return out


def eval_config(P, F, cnt, lastev, S, K, seg, kind, nperm=1000, seed=7, **kw):
    real = portfolio(P, F, cnt, lastev, S, K, seg, kind, **kw)
    m = metrics(real)
    rng = np.random.default_rng(seed)
    hit = 0
    for _ in range(nperm):
        null = portfolio(P, F, cnt, lastev, S, K, seg, kind,
                         perm=rng.permutation(P.shape[1]), **kw)
        sd = null.std(ddof=1)
        if (null.mean() / sd * np.sqrt(365) if sd > 0 else -9) >= m['sharpe']:
            hit += 1
    m['p'] = np.nan if not np.isfinite(m['sharpe']) else (1 + hit) / (1 + nperm)
    return m


GRID = ([('FLEVEL', dict(L=L), K) for L in (3, 7, 14, 30) for K in (2, 7)]
        + [('FMOM', dict(L=L), K) for L in (14, 30) for K in (2, 7)])


def sweep(P, F, cnt, lastev, seg, nperm, label, **kw):
    rows = []
    for fam, prm, K in GRID:
        S = signal_funding(F, fam, prm)
        for kind in ('LS', 'LO'):
            m = eval_config(P, F, cnt, lastev, S, K, seg, kind, nperm=nperm, **kw)
            rows.append(dict(fam=fam, prm=prm, K=K, kind=kind, **m))
    print(f'\n=== {label} ===')
    for fam in sorted(set(r['fam'] for r in rows)):
        sub = [r for r in rows if r['fam'] == fam]
        flags = bh_flags([r['p'] for r in sub])
        for r_, f in zip(sub, flags):
            r_['bh'] = bool(f)
            tag = ' ← BH' if f and r_['sharpe'] > 0 else ''
            calmar = r_['cagr'] / r_['dd'] if r_['dd'] > 0 else np.nan
            print(f"{fam:7s} L{r_['prm']['L']:2d} K{r_['K']} {r_['kind']:2s} | "
                  f"Sharpe {r_['sharpe']:+5.2f} CAGR {r_['cagr']:+7.1f}% DD {r_['dd']:5.1f}% "
                  f"Calmar {calmar:4.2f} p={r_['p']:.4f}{tag}")
    return rows


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'is'
    syms = universe_symbols()
    ts, P = load_panel(syms)
    F, cnt, lastev = load_funding_panel(syms, ts)
    a, b = (IS_START, IS_END) if mode != 'oos' else (IS_END, OOS_END)
    seg = (int(np.searchsorted(ts, a)), int(np.searchsorted(ts, b)))
    elig_med = int(np.median([(np.isfinite(P[t]) & (cnt[t] >= 21) & (lastev[t] <= 2)).sum()
                              for t in range(seg[0], seg[1], 30)]))
    print(f'perps éligibles médians sur la fenêtre : {elig_med}')

    if mode == 'placebo':
        rng = np.random.default_rng(42)
        P2 = np.full_like(P, np.nan)
        for c in range(P.shape[1]):
            fin = np.where(np.isfinite(P[:, c]))[0]
            if len(fin) < 150:
                continue
            lpa = np.log(P[fin, c])
            sh = rng.permutation(np.diff(lpa))
            P2[fin, c] = np.exp(np.concatenate([[lpa[0]], lpa[0] + np.cumsum(sh)]))
        rows = sweep(P2, F, cnt, lastev, seg, 200, 'PLACEBO (prix iid, funding réel, PRIX SEULS comptés)',
                     price_only=True)
        ps = [r['p'] for r in rows if np.isfinite(r['p'])]
        hit = sum(1 for p in ps if p < 0.01)
        print(f'\nPLACEBO : {hit}/{len(ps)} à p<0,01 = {hit / max(len(ps), 1) * 100:.1f}% (toléré ≤3 %) → '
              f"{'OK' if hit <= 0.03 * len(ps) else 'ALERTE — STOP'}")
        return

    if mode == 'control':
        S = signal_funding(F, 'FLEVEL', dict(L=7))
        m = eval_config(P, F, cnt, lastev, S, 7, seg, 'LS', nperm=500, funding_only=True)
        ok = m['p'] < 0.01 and m['sharpe'] > 0
        print(f"CONTRÔLE (composante FUNDING seule, FLEVEL L7 K7 L/S) : "
              f"Sharpe {m['sharpe']:+5.2f} CAGR {m['cagr']:+6.1f}% p={m['p']:.4f} → "
              f"{'RETROUVÉ ✓' if ok else 'NON RETROUVÉ — STOP'}")
        return

    label = ('IS 2020-07→2024-01' if mode == 'is' else 'OOS 2024-01→2026-07 — UNE PASSE') + ' (net 30 bps/côté)'
    sweep(P, F, cnt, lastev, seg, 1000, label)


if __name__ == '__main__':
    main()
