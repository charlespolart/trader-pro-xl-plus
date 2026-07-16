#!/usr/bin/env python3
"""regime2 — long de capitulation régime-gated, miroir de regime1
(protocole + amendement committés AVANT). Porte : médiane funding ≤ −G ;
D1 long quintile funding-min nu · D2 + short BTC 1:1 · D3 L/S inversé.
Exécution PERP INTÉGRALE d'entrée. Signal FLEVEL L3 hérité, K7, coûts
30 bps/côté, null réétiquetage, barre regime1.
  python3 regime2.py control | placebo | is | oos"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'regime1'))
import regime as R  # noqa: E402

C = R.C
GATES_BPS = (2.5, 5.0, 10.0)
K = R.K


def portfolio_gated2(P, F, cnt, lastev, S, gate_on, seg, cons, btc_r,
                     r_exec, btc_f, perm=None, cost_mult=1.0):
    n, na = P.shape
    r = r_exec
    lo, hi = seg
    hist = np.isfinite(P).cumsum(axis=0)
    Su = S if perm is None else S[:, perm]
    out = np.zeros(hi - lo)
    w = np.zeros(na)
    w_btc = 0.0
    for t in range(lo, hi, K):
        neww = np.zeros(na)
        new_btc = 0.0
        if gate_on[t]:
            elig = (np.isfinite(Su[t]) & np.isfinite(P[t]) & (hist[t] >= C.WARMUP)
                    & (cnt[t] >= 21) & (lastev[t] <= 2))
            idx = np.flatnonzero(elig)
            if len(idx) >= C.MIN_ALIVE:
                ntop = max(1, int(round(len(idx) * C.TOPQ)))
                order = idx[np.argsort(Su[t][idx])]
                for a in order[-ntop:]:
                    neww[a] += 1.0 / ntop                 # LONG funding-min
                if cons == 'D2':
                    new_btc = -1.0                         # short BTC 1:1
                elif cons == 'D3':
                    for a in order[:ntop]:
                        neww[a] -= 1.0 / ntop             # short funding-max
        i0 = t - lo
        out[i0] -= C.COST * cost_mult * (np.abs(neww - w).sum() + abs(new_btc - w_btc))
        w = neww
        w_btc = new_btc
        j1, j2 = t + 1, min(t + K, hi, n - 1) + 1
        if j1 < j2:
            blk = r[j1:j2] @ w
            blk += -(F[j1:j2] @ w)
            if w_btc != 0.0:
                blk = blk + btc_r[j1:j2] * w_btc - btc_f[j1:j2] * w_btc
            out[i0:i0 + (j2 - j1)] += blk
    return out


def eval_cell2(P, F, cnt, lastev, S, gate_on, seg, cons, btc_r, ts,
               r_exec, btc_f, nperm=1000):
    real = portfolio_gated2(P, F, cnt, lastev, S, gate_on, seg, cons, btc_r, r_exec, btc_f)
    m = C.metrics(real)
    rng = np.random.default_rng(7)
    hit = 0
    for _ in range(nperm):
        null = portfolio_gated2(P, F, cnt, lastev, S, gate_on, seg, cons, btc_r,
                                r_exec, btc_f, perm=rng.permutation(P.shape[1]))
        sd = null.std(ddof=1)
        if (null.mean() / sd * np.sqrt(365) if sd > 0 else -9) >= m['sharpe']:
            hit += 1
    m['p'] = (1 + hit) / (1 + nperm)
    eps = R.episodes_of(gate_on, seg, ts)
    lo = seg[0]
    ep_pnl = [float(real[a - lo:b - lo].sum()) for a, b in eps]
    m['neps'] = len(eps)
    m['eps_pos'] = sum(1 for x in ep_pnl if x > 0)
    m['on_share'] = float(np.mean([gate_on[t] for t in range(seg[0], seg[1])]))
    m['ep_pnl'] = ep_pnl
    x2 = portfolio_gated2(P, F, cnt, lastev, S, gate_on, seg, cons, btc_r,
                          r_exec, btc_f, cost_mult=2.0)
    m['sh_x2'] = C.metrics(x2)['sharpe']
    return m


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'is'
    syms = C.universe_symbols()
    ts, P = C.load_panel(syms)
    F, cnt, lastev = C.load_funding_panel(syms, ts)
    hist = np.isfinite(P).cumsum(axis=0)
    g = R.gate_series(P, F, cnt, lastev, hist)
    btc_r = R.load_btc(ts, market='futures')
    F_btc = R.load_btc_funding(ts)
    P_perp = R.load_perp_panel(syms, ts)
    na = P.shape[1]
    with np.errstate(all='ignore'):
        r_p = np.vstack([np.zeros((1, na)), np.diff(np.log(P_perp), axis=0)])
        r_s = np.vstack([np.zeros((1, na)), np.diff(np.log(P), axis=0)])
    has = np.isfinite(r_p)
    has[0] = False
    r_s = np.where(np.isfinite(r_s), r_s, 0.0)
    r_exec = np.where(has, r_p, r_s)
    S = C.signal_funding(F, 'FLEVEL', dict(L=3))
    a, b = (R.IS_START, R.IS_END) if mode != 'oos' else (R.IS_END, R.OOS_END)
    seg = (int(np.searchsorted(ts, a)), int(np.searchsorted(ts, b)))

    if mode == 'control':
        import datetime
        def dstr(i):
            return datetime.datetime.fromtimestamp(ts[i] / 1000, datetime.UTC).strftime('%Y-%m')
        full = (int(np.searchsorted(ts, R.IS_START)), int(np.searchsorted(ts, R.OOS_END)))
        for G in GATES_BPS:
            on = np.where(np.isfinite(g), g <= -G / 1e4, False)
            eps = R.episodes_of(on, full, ts)
            share = np.mean([on[t] for t in range(full[0], full[1])])
            labels = ', '.join(f'{dstr(x)}→{dstr(y - 1)}' for x, y in eps)
            print(f'G=−{G:4.1f} bps/j : ON {share * 100:4.1f}% (IS+OOS), {len(eps)} épisodes [{labels}]')
        return

    if mode == 'placebo':
        rng = np.random.default_rng(42)
        P2 = np.full_like(P, np.nan)
        for c_ in range(P.shape[1]):
            fin = np.where(np.isfinite(P[:, c_]))[0]
            if len(fin) < 150:
                continue
            lpa = np.log(P[fin, c_])
            sh = rng.permutation(np.diff(lpa))
            P2[fin, c_] = np.exp(np.concatenate([[lpa[0]], lpa[0] + np.cumsum(sh)]))
        with np.errstate(all='ignore'):
            r2 = np.vstack([np.zeros((1, na)), np.diff(np.log(P2), axis=0)])
        r2 = np.where(np.isfinite(r2), r2, 0.0)
        hits = tot = 0
        for G in GATES_BPS:
            on = np.where(np.isfinite(g), g <= -G / 1e4, False)
            for cons in ('D1', 'D2', 'D3'):
                m = eval_cell2(P2, F, cnt, lastev, S, on, seg, cons, btc_r, ts,
                               r2, F_btc, nperm=200)
                tot += 1
                hits += m['p'] < 0.01
        print(f'PLACEBO : {hits}/{tot} à p<0,01 → {"OK" if hits <= 1 else "ALERTE — STOP"}')
        return

    label = 'IS 2020-07→2024-01' if mode == 'is' else 'OOS 2024-01→2026-07 — UNE PASSE'
    print(f'=== regime2 {label} (perp intégral, net 30 bps/côté, K7, FLEVEL L3 hérité) ===')
    rows = []
    for G in GATES_BPS:
        on = np.where(np.isfinite(g), g <= -G / 1e4, False)
        for cons in ('D1', 'D2', 'D3'):
            m = eval_cell2(P, F, cnt, lastev, S, on, seg, cons, btc_r, ts, r_exec, F_btc)
            calmar = m['cagr'] / m['dd'] if m['dd'] > 0 else np.nan
            rows.append(dict(G=G, cons=cons, p=m['p'], sharpe=m['sharpe']))
            eps = ' '.join(f'{x * 100:+.0f}%' for x in m['ep_pnl'])
            print(f"G−{G:4.1f} {cons} | Sharpe {m['sharpe']:+5.2f} CAGR {m['cagr']:+7.1f}% "
                  f"DD {m['dd']:5.1f}% Calmar {calmar:5.2f} p={m['p']:.4f} ×2→{m['sh_x2']:+5.2f} | "
                  f"ON {m['on_share'] * 100:4.1f}% ép {m['eps_pos']}/{m['neps']} [{eps}]")
    flags = C.bh_flags([r_['p'] for r_ in rows])
    surv = [f"G{r_['G']}/{r_['cons']}" for r_, f in zip(rows, flags) if f and r_['sharpe'] > 0]
    print(f"\nBH-FDR : {surv if surv else 'aucun'}")


if __name__ == '__main__':
    main()
