#!/usr/bin/env python3
"""regime1 — short de junk régime-gated (protocole LOG.md committé avant).
Porte = médiane du funding quotidien des perps éligibles ≥ G (3 seuils figés).
Constructions : C1 L/S funding · C2 short nu · C3 short + long BTC.
Signal intra-porte : FLEVEL L3 (hérité carry3). K=7 figé.
  python3 regime.py control | placebo | is | oos"""
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'carry3'))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'xsection1'))
import carry as C  # noqa: E402

IS_START = C.IS_START
IS_END = C.IS_END
OOS_END = C.OOS_END
GATES_BPS = (2.5, 5.0, 10.0)
K = 7
DB = 'postgres://tpx:tpx@localhost:5438/tpx'


def load_btc(ts):
    q = ("COPY (SELECT open_time, close FROM candles WHERE market='spot' AND symbol='BTCUSDT' "
         "AND interval='1d' ORDER BY open_time) TO STDOUT (FORMAT csv)")
    out = subprocess.run(['psql', DB, '-c', q], capture_output=True, text=True, check=True).stdout
    d = {int(float(a)): float(b) for a, b in (line.split(',') for line in out.strip().split('\n') if line)}
    px = np.array([d.get(int(t), np.nan) for t in ts])
    r = np.concatenate([[0.0], np.diff(np.log(px))])
    return np.where(np.isfinite(r), r, 0.0)


def gate_series(P, F, cnt, lastev, hist):
    """médiane du funding quotidien sur les perps éligibles (observable)."""
    n = len(F)
    g = np.full(n, np.nan)
    for t in range(n):
        elig = np.isfinite(P[t]) & (cnt[t] >= 21) & (lastev[t] <= 2) & (hist[t] >= C.WARMUP)
        if elig.sum() >= C.MIN_ALIVE:
            g[t] = float(np.median(F[t][elig]))
    return g


def portfolio_gated(P, F, cnt, lastev, S, gate_on, seg, cons, btc_r=None,
                    perm=None, cost_mult=1.0):
    lp = np.log(P)
    n, na = P.shape
    r = np.vstack([np.zeros((1, na)), np.diff(lp, axis=0)])
    r = np.where(np.isfinite(r), r, 0.0)
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
                for a in order[:ntop]:
                    neww[a] -= 1.0 / ntop                 # short funding max
                if cons == 'C1':
                    for a in order[-ntop:]:
                        neww[a] += 1.0 / ntop             # long funding min
                elif cons == 'C3':
                    new_btc = 1.0                          # long BTC 1:1
        i0 = t - lo
        out[i0] -= C.COST * cost_mult * (np.abs(neww - w).sum() + abs(new_btc - w_btc))
        w = neww
        w_btc = new_btc
        j1, j2 = t + 1, min(t + K, hi, n - 1) + 1
        if j1 < j2:
            blk = r[j1:j2] @ w
            blk += -(F[j1:j2] @ w)
            if btc_r is not None and w_btc != 0.0:
                blk = blk + btc_r[j1:j2] * w_btc
            out[i0:i0 + (j2 - j1)] += blk
    return out


def episodes_of(gate_on, seg, ts):
    lo, hi = seg
    eps = []
    start = None
    for t in range(lo, hi):
        if gate_on[t] and start is None:
            start = t
        elif not gate_on[t] and start is not None:
            eps.append((start, t))
            start = None
    if start is not None:
        eps.append((start, hi))
    merged = []
    for a, b in eps:
        if merged and (a - merged[-1][1]) < 14:
            merged[-1] = (merged[-1][0], b)
        else:
            merged.append((a, b))
    return merged


def eval_cell(P, F, cnt, lastev, S, gate_on, seg, cons, btc_r, ts, nperm=1000):
    real = portfolio_gated(P, F, cnt, lastev, S, gate_on, seg, cons, btc_r)
    m = C.metrics(real)
    rng = np.random.default_rng(7)
    hit = 0
    for _ in range(nperm):
        null = portfolio_gated(P, F, cnt, lastev, S, gate_on, seg, cons, btc_r,
                               perm=rng.permutation(P.shape[1]))
        sd = null.std(ddof=1)
        if (null.mean() / sd * np.sqrt(365) if sd > 0 else -9) >= m['sharpe']:
            hit += 1
    m['p'] = (1 + hit) / (1 + nperm)
    eps = episodes_of(gate_on, seg, ts)
    lo = seg[0]
    ep_pnl = [float(real[a - lo:b - lo].sum()) for a, b in eps]
    m['neps'] = len(eps)
    m['eps_pos'] = sum(1 for x in ep_pnl if x > 0)
    m['on_share'] = float(np.mean([gate_on[t] for t in range(seg[0], seg[1])]))
    m['ep_pnl'] = ep_pnl
    return m, real


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'is'
    syms = C.universe_symbols()
    ts, P = C.load_panel(syms)
    F, cnt, lastev = C.load_funding_panel(syms, ts)
    hist = np.isfinite(P).cumsum(axis=0)
    g = gate_series(P, F, cnt, lastev, hist)
    btc_r = load_btc(ts)
    S = C.signal_funding(F, 'FLEVEL', dict(L=3))
    a, b = (IS_START, IS_END) if mode != 'oos' else (IS_END, OOS_END)
    seg = (int(np.searchsorted(ts, a)), int(np.searchsorted(ts, b)))

    if mode == 'control':
        import datetime
        def dstr(i):
            return datetime.datetime.fromtimestamp(ts[i] / 1000, datetime.UTC).strftime('%Y-%m')
        for G in GATES_BPS:
            on = g >= G / 1e4
            on = np.where(np.isfinite(g), on, False)
            eps = episodes_of(on, seg, ts)
            share = np.mean([on[t] for t in range(seg[0], seg[1])])
            labels = ', '.join(f'{dstr(x)}→{dstr(y - 1)}' for x, y in eps)
            print(f'G={G:4.1f} bps/j : ON {share * 100:4.1f}% de l IS, {len(eps)} épisodes [{labels}]')
        # vérité terrain : G=5 doit couvrir 2020-Q4→2021-Q2 et épargner 2022-23
        on5 = np.where(np.isfinite(g), g >= 5.0 / 1e4, False)
        q4 = (int(np.searchsorted(ts, np.datetime64('2020-11-01').astype('datetime64[ms]').astype(np.int64))),
              int(np.searchsorted(ts, np.datetime64('2021-05-01').astype('datetime64[ms]').astype(np.int64))))
        dead = (int(np.searchsorted(ts, np.datetime64('2022-06-01').astype('datetime64[ms]').astype(np.int64))),
                int(np.searchsorted(ts, np.datetime64('2023-06-01').astype('datetime64[ms]').astype(np.int64))))
        c1 = np.mean([on5[t] for t in range(*q4)])
        c2 = np.mean([on5[t] for t in range(*dead)])
        ok = c1 > 0.6 and c2 < 0.2
        print(f'\nCONTRÔLE G=5 : ON {c1 * 100:.0f}% de nov20→avr21 (attendu >60%), '
              f'{c2 * 100:.0f}% de juin22→juin23 (attendu <20%) → {"✓" if ok else "✗ STOP"}')
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
        hits = tot = 0
        for G in GATES_BPS:
            on = np.where(np.isfinite(g), g >= G / 1e4, False)
            for cons in ('C1', 'C2', 'C3'):
                m, _ = eval_cell(P2, F, cnt, lastev, S, on, seg, cons, btc_r, ts, nperm=200)
                tot += 1
                hits += m['p'] < 0.01
        print(f'PLACEBO : {hits}/{tot} à p<0,01 → {"OK" if hits <= max(1, 0.03 * tot) else "ALERTE — STOP"}')
        return

    label = 'IS 2020-07→2024-01' if mode == 'is' else 'OOS 2024-01→2026-07 — UNE PASSE'
    print(f'=== {label} (net 30 bps/côté, K7, signal FLEVEL L3 hérité) ===')
    rows = []
    for G in GATES_BPS:
        on = np.where(np.isfinite(g), g >= G / 1e4, False)
        for cons in ('C1', 'C2', 'C3'):
            m, _ = eval_cell(P, F, cnt, lastev, S, on, seg, cons, btc_r, ts)
            calmar = m['cagr'] / m['dd'] if m['dd'] > 0 else np.nan
            rows.append(dict(G=G, cons=cons, p=m['p'], sharpe=m['sharpe']))
            eps = ' '.join(f'{x * 100:+.0f}%' for x in m['ep_pnl'])
            print(f"G{G:4.1f} {cons} | Sharpe {m['sharpe']:+5.2f} CAGR {m['cagr']:+7.1f}% "
                  f"DD {m['dd']:5.1f}% Calmar {calmar:5.2f} p={m['p']:.4f} | "
                  f"ON {m['on_share'] * 100:4.1f}% ép {m['eps_pos']}/{m['neps']} [{eps}]")
    flags = C.bh_flags([r['p'] for r in rows])
    surv = [f"G{r['G']}/{r['cons']}" for r, f in zip(rows, flags) if f and r['sharpe'] > 0]
    print(f"\nBH-FDR : {surv if surv else 'aucun'}")


if __name__ == '__main__':
    main()
