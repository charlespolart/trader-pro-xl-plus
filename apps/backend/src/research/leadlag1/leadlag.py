#!/usr/bin/env python3
"""leadlag1 — H5 grain 1d (protocole LOG.md committé AVANT).
L1 : BTC(L∈{1,3,7}) → panier EW alts (long-only / L/S).
L2 : gros (top-20 $vol 30 j, recalc mensuel sans lookahead) → petits.
Null : rotation du vecteur SIGNAL ; placebo : panel iid ; contrôle : fuite t+1.
Approximation consignée : coût = 30 bps × |Δpos| sur le notionnel panier
(le turnover interne de l'EW quotidien ~négligeable devant les flips).
  python3 leadlag.py control | placebo | is"""
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'xsection1'))
from xsection_u import (DB, IS_END, IS_START, WARMUP, bh_flags, load_panel,  # noqa: E402
                        metrics, universe_symbols)

COST = 0.0030
LOOKS = (1, 3, 7)
DAY = 86_400_000


def load_btc_r(ts):
    q = ("COPY (SELECT open_time, close FROM candles WHERE market='spot' AND symbol='BTCUSDT' "
         "AND interval='1d' ORDER BY open_time) TO STDOUT (FORMAT csv)")
    out = subprocess.run(['psql', DB, '-c', q], capture_output=True, text=True, check=True).stdout
    d = {int(float(a)): float(b) for a, b in (line.split(',') for line in out.strip().split('\n') if line)}
    px = np.array([d.get(int(t), np.nan) for t in ts])
    r = np.concatenate([[0.0], np.diff(np.log(px))])
    return np.where(np.isfinite(r), r, 0.0)


def load_vol_panel(symbols, ts):
    q = ("COPY (SELECT symbol, open_time, quote_volume FROM candles WHERE market='spot' AND "
         "interval='1d' AND symbol = ANY('{" + ','.join(symbols) + "}') "
         "ORDER BY symbol, open_time) TO STDOUT (FORMAT csv)")
    out = subprocess.run(['psql', DB, '-c', q], capture_output=True, text=True, check=True).stdout
    sidx = {s: i for i, s in enumerate(symbols)}
    tidx = {int(t): i for i, t in enumerate(ts)}
    V = np.full((len(ts), len(symbols)), np.nan)
    for line in out.strip().split('\n'):
        if not line:
            continue
        s, t, v = line.split(',')
        i = tidx.get(int(float(t)))
        if i is not None:
            V[i, sidx[s]] = float(v)
    return V


def month_starts(ts, lo, hi):
    out = []
    prev = None
    for t in range(lo, hi):
        mk = str(np.datetime64(int(ts[t]), 'ms').astype('datetime64[M]'))
        if mk != prev:
            out.append(t)
            prev = mk
    return out


def big_sets(V, ts, lo, hi, alive, nbig=20, look=30):
    """au 1er de chaque mois : top-20 par $vol moyen 30 j passés (sans lookahead)."""
    sets_ = {}
    for t in month_starts(ts, lo, hi):
        if t < look:
            continue
        mv = np.nanmean(V[t - look:t], axis=0)
        mv = np.where(alive[t] & np.isfinite(mv), mv, -1.0)
        sets_[t] = set(np.argsort(mv)[-nbig:][mv[np.argsort(mv)[-nbig:]] > 0])
    return sets_


def run_cell(sig, r_target, seg, mode, cost_mult=1.0):
    """pos(t+1) depuis sig(t) ; pnl et coûts sur [lo, hi)."""
    lo, hi = seg
    pnl = np.zeros(hi - lo)
    pos = 0.0
    turn = 0.0
    for t in range(lo, hi - 1):
        want = 1.0 if sig[t] > 0 else (-1.0 if mode == 'LS' else 0.0)
        turn += abs(want - pos)
        pnl[t - lo] -= COST * cost_mult * abs(want - pos)
        pos = want
        pnl[t + 1 - lo] += pos * r_target[t + 1]
    return pnl, turn


def eval_cell(sig, r_target, seg, mode, rng, nperm=1000):
    real, turn = run_cell(sig, r_target, seg, mode)
    m = metrics(real)
    n = len(sig)
    hit = 0
    drawn = 0
    while drawn < nperm:
        k = int(rng.integers(10, n - 10))
        null, _ = run_cell(np.roll(sig, k), r_target, seg, mode)
        sd = null.std(ddof=1)
        if (null.mean() / sd * np.sqrt(365) if sd > 0 else -9) >= m['sharpe']:
            hit += 1
        drawn += 1
    m['p'] = (1 + hit) / (1 + nperm)
    years = (seg[1] - seg[0]) / 365.0
    m['turn'] = turn / years
    x2, _ = run_cell(sig, r_target, seg, mode, cost_mult=2.0)
    m['sh_x2'] = metrics(x2)['sharpe']
    return m


def main():
    mode_arg = sys.argv[1] if len(sys.argv) > 1 else 'is'
    rng = np.random.default_rng(7)
    syms = universe_symbols()
    ts, P = load_panel(syms)
    if mode_arg == 'placebo':
        rng2 = np.random.default_rng(42)
        P2 = np.full_like(P, np.nan)
        for c in range(P.shape[1]):
            fin = np.where(np.isfinite(P[:, c]))[0]
            if len(fin) < 150:
                continue
            lpa = np.log(P[fin, c])
            sh = rng2.permutation(np.diff(lpa))
            P2[fin, c] = np.exp(np.concatenate([[lpa[0]], lpa[0] + np.cumsum(sh)]))
        P = P2
    lp = np.log(P)
    r = np.vstack([np.zeros((1, P.shape[1])), np.diff(lp, axis=0)])
    r = np.where(np.isfinite(r), r, 0.0)
    hist = np.isfinite(P).cumsum(axis=0)
    alive = np.isfinite(P) & (hist >= WARMUP)
    r_btc = load_btc_r(ts)
    lo, hi = int(np.searchsorted(ts, IS_START)), int(np.searchsorted(ts, IS_END))
    seg = (lo, hi)

    n = len(ts)
    r_ew = np.array([r[t, alive[t]].mean() if alive[t].sum() >= 30 else 0.0 for t in range(n)])

    V = load_vol_panel(syms, ts)
    bsets = big_sets(V, ts, lo, hi, alive)
    keys = sorted(bsets.keys())
    r_big = np.zeros(n)
    r_small = np.zeros(n)
    for i, t0 in enumerate(keys):
        t1 = keys[i + 1] if i + 1 < len(keys) else hi
        big = list(bsets[t0])
        for t in range(t0, min(t1, n)):
            sm = alive[t].copy()
            sm[big] = False
            r_big[t] = r[t, big].mean() if big else 0.0
            r_small[t] = r[t, sm].mean() if sm.sum() >= 30 else 0.0

    if mode_arg == 'control':
        cheat = np.concatenate([r_ew[1:], [0.0]])       # fuite délibérée t+1
        m = eval_cell(cheat, r_ew, seg, 'LO', rng, nperm=200)
        ok = m['sharpe'] > 3 and m['p'] <= 0.005
        print(f"CONTRÔLE PLANTÉ (fuite t+1) : Sharpe {m['sharpe']:+.2f} p={m['p']:.4f} → "
              f"{'EXPLOSE ✓ (machinerie voyante)' if ok else 'N EXPLOSE PAS — STOP'}")
        return

    label = 'PLACEBO (panel iid)' if mode_arg == 'placebo' else 'IS 2019-07→2024-01'
    print(f'=== leadlag1 {label} (net 30 bps/côté, exécution t+1) ===')
    rows = []
    for fam, sig_src, target in (('L1 BTC→alts', r_btc, r_ew), ('L2 gros→petits', r_big, r_small)):
        for L in LOOKS:
            cs = np.concatenate([np.zeros(1), np.cumsum(sig_src)])
            sig = np.zeros(n)
            sig[L:] = cs[L + 1:] - cs[1:n - L + 1]
            for mode in ('LO', 'LS'):
                m = eval_cell(sig, target, seg, mode, rng)
                rows.append(dict(fam=fam, L=L, mode=mode, **m))
    flags = bh_flags([r_['p'] for r_ in rows])
    for r_, f in zip(rows, flags):
        calmar = r_['cagr'] / r_['dd'] if r_['dd'] > 0 else np.nan
        tag = ' ← BH' if f and r_['sharpe'] > 0 else ''
        print(f"{r_['fam']:15s} L{r_['L']} {r_['mode']:2s} | Sharpe {r_['sharpe']:+5.2f} "
              f"CAGR {r_['cagr']:+7.1f}% DD {r_['dd']:5.1f}% Calmar {calmar:5.2f} "
              f"p={r_['p']:.4f} | turn {r_['turn']:5.1f}×/an ×2→{r_['sh_x2']:+5.2f}{tag}")
    if mode_arg == 'placebo':
        hits = sum(1 for r_ in rows if r_['p'] < 0.01)
        print(f'\nPLACEBO : {hits}/{len(rows)} à p<0,01 → {"OK" if hits <= 1 else "ALERTE — STOP"}')


if __name__ == '__main__':
    main()
