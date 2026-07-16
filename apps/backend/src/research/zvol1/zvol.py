#!/usr/bin/env python3
"""zvol1 — facteur volume anormal cross-section (protocole LOG.md committé
AVANT). ZVOL = z-score expansif 90 j de log(quote_volume) ; machinerie
xsection_u réutilisée (4 cellules : LO/LS × K{2,7}).
  python3 zvol.py control | placebo | is | oos"""
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'xsection1'))
from xsection_u import (DB, IS_END, IS_START, OOS_END, bh_flags, eval_config,  # noqa: E402
                        load_panel, universe_symbols)

LOOK = 90


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


def zvol_signal(V, look=LOOK):
    """z-score glissant de log(V) vs les `look` jours passés (nan-safe, O(n))."""
    with np.errstate(all='ignore'):
        lv = np.log(V)
    lv = np.where(np.isfinite(lv), lv, np.nan)
    n, na = lv.shape
    x = np.where(np.isfinite(lv), lv, 0.0)
    m = np.isfinite(lv).astype(float)
    cs = np.vstack([np.zeros((1, na)), np.cumsum(x, axis=0)])
    cs2 = np.vstack([np.zeros((1, na)), np.cumsum(x * x, axis=0)])
    cm = np.vstack([np.zeros((1, na)), np.cumsum(m, axis=0)])
    S = np.full((n, na), np.nan)
    for t in range(look, n):
        cnt = cm[t] - cm[t - look]
        ok = cnt >= look * 0.9
        mu = (cs[t] - cs[t - look]) / np.maximum(cnt, 1)
        var = (cs2[t] - cs2[t - look]) / np.maximum(cnt, 1) - mu * mu
        sd = np.sqrt(np.maximum(var, 0))
        z = (lv[t] - mu) / np.where(sd > 0, sd, np.nan)
        S[t] = np.where(ok & np.isfinite(z), z, np.nan)
    return S


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'is'
    rng = np.random.default_rng(42)
    syms = universe_symbols()
    ts, P = load_panel(syms)
    V = load_vol_panel(syms, ts)
    if mode == 'placebo':
        for c in range(V.shape[1]):
            fin = np.where(np.isfinite(V[:, c]))[0]
            if len(fin) > 10:
                V[fin, c] = rng.permutation(V[fin, c])
    a, b = (IS_START, IS_END) if mode != 'oos' else (IS_END, OOS_END)
    seg = (int(np.searchsorted(ts, a)), int(np.searchsorted(ts, b)))

    if mode == 'control':
        lp = np.log(P)
        n, na = P.shape
        r = np.vstack([np.zeros((1, na)), np.diff(lp, axis=0)])
        cheat = np.full_like(P, np.nan)
        cheat[:-1] = r[1:]                       # fuite délibérée t+1
        m, _ = eval_config(P, cheat, 2, seg, 'LS', nperm=200)
        ok = m['sharpe'] > 3 and m['p'] <= 0.005
        print(f"CONTRÔLE PLANTÉ (fuite t+1) : Sharpe {m['sharpe']:+.2f} p={m['p']:.4f} → "
              f"{'EXPLOSE ✓' if ok else 'N EXPLOSE PAS — STOP'}")
        return

    S = zvol_signal(V)
    label = {'placebo': 'PLACEBO volumes iid', 'is': 'IS 2019-07→2024-01',
             'oos': 'OOS 2024-01→2026-07 — UNE PASSE'}[mode]
    print(f'=== zvol1 {label} (net 30 bps/côté) ===')
    rows = []
    for K in (2, 7):
        for kind in ('LO', 'LS'):
            m, _ = eval_config(P, S, K, seg, kind, nperm=1000 if mode != 'placebo' else 200)
            rows.append(dict(K=K, kind=kind, **m))
            calmar = m['cagr'] / m['dd'] if m['dd'] > 0 else np.nan
            print(f"ZVOL K{K} {kind:2s} | Sharpe {m['sharpe']:+5.2f} CAGR {m['cagr']:+7.1f}% "
                  f"DD {m['dd']:5.1f}% Calmar {calmar:5.2f} p={m['p']:.4f}")
    flags = bh_flags([r_['p'] for r_ in rows])
    surv = [f"K{r_['K']}/{r_['kind']}" for r_, f in zip(rows, flags) if f]
    print(f"BH-FDR : {surv if surv else 'aucun'}")
    if mode == 'placebo':
        hits = sum(1 for r_ in rows if r_['p'] < 0.01)
        print(f'PLACEBO : {hits}/4 à p<0,01 → {"OK" if hits == 0 else "ALERTE — STOP"}')


if __name__ == '__main__':
    main()
