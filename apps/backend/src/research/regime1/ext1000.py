#!/usr/bin/env python3
"""regime1 — extension 1000× (protocole LOG.md committé AVANT, une passe).
Alias 1000(000)XUSDT → XUSDT appliqué au funding ET aux klines perp,
UNIQUEMENT si le spot strippé existe dans l'univers (garde anti-faux-match).
Cellule/params/fenêtres STRICTEMENT inchangés. Rendements log invariants au
facteur 1000. Compare G2,5/C3 perp intégral avec/sans extension, IS + OOS.
  python3 ext1000.py"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import regime as R  # noqa: E402

C = R.C


def strip1000(s):
    for pref in ('1000000', '1000'):
        if s.startswith(pref):
            return s[len(pref):]
    return s


def load_funding_ext(symbols, ts):
    """comme carry.load_funding_panel + injection des perps 1000× aliasés."""
    sidx = {s: i for i, s in enumerate(symbols)}
    tidx = {int(t): i for i, t in enumerate(ts)}
    F = np.zeros((len(ts), len(symbols)))
    seen = np.zeros((len(ts), len(symbols)))
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        '..', 'xsection1', 'funding_daily_all.csv')
    mapped = set()
    with open(path) as f:
        for line in f:
            s, d, r = line.strip().split(',')
            tgt = s
            if s.startswith('1000'):
                st = strip1000(s)
                if st in sidx:
                    tgt = st
                    mapped.add(s)
                else:
                    continue
            a = sidx.get(tgt)
            if a is None:
                continue
            i = tidx.get(int(float(d)))
            if i is not None:
                F[i, a] = float(r)
                seen[i, a] = 3.0
    cnt = seen.cumsum(axis=0)
    lastev = np.full_like(F, np.inf)
    last_seen = np.full(len(symbols), -np.inf)
    for i in range(len(ts)):
        has = seen[i] > 0
        last_seen[has] = i
        lastev[i] = i - last_seen
    return F, cnt, lastev, sorted(mapped)


def load_perp_ext(symbols, ts):
    """panel perp : symboles directs + 1000× aliasés vers la colonne spot."""
    P = R.load_perp_panel(symbols, ts)
    import subprocess
    sidx = {s: i for i, s in enumerate(symbols)}
    tidx = {int(t): i for i, t in enumerate(ts)}
    q = ("COPY (SELECT symbol, open_time, close FROM candles WHERE market='futures' AND "
         "interval='1d' AND symbol LIKE '1000%' ORDER BY symbol, open_time) TO STDOUT (FORMAT csv)")
    out = subprocess.run(['psql', R.DB, '-c', q], capture_output=True, text=True, check=True).stdout
    for line in out.strip().split('\n'):
        if not line:
            continue
        s, t, c = line.split(',')
        st = strip1000(s)
        a = sidx.get(st)
        i = tidx.get(int(float(t)))
        if a is not None and i is not None:
            P[i, a] = float(c)          # pas de collision (vérifié) — écrase NaN
    return P


def run(P, F, cnt, lastev, ts, g, btc_r_perp, F_btc, r_exec, label):
    S = C.signal_funding(F, 'FLEVEL', dict(L=3))
    on = np.where(np.isfinite(g), g >= 2.5 / 1e4, False)
    for lab, a, b in (('IS ', R.IS_START, R.IS_END), ('OOS', R.IS_END, R.OOS_END)):
        sg = (int(np.searchsorted(ts, a)), int(np.searchsorted(ts, b)))
        m, _ = R.eval_cell(P, F, cnt, lastev, S, on, sg, 'C3', btc_r_perp, ts,
                           r_exec=r_exec, btc_f=F_btc)
        calmar = m['cagr'] / m['dd'] if m['dd'] > 0 else np.nan
        print(f"{label:14s} {lab} | Sharpe {m['sharpe']:+5.2f} CAGR {m['cagr']:+7.1f}% "
              f"DD {m['dd']:5.1f}% Calmar {calmar:5.2f} p={m['p']:.4f} ép {m['eps_pos']}/{m['neps']}")


def main():
    syms = C.universe_symbols()
    ts, P = C.load_panel(syms)
    hist = np.isfinite(P).cumsum(axis=0)
    btc_r_perp = R.load_btc(ts, market='futures')
    F_btc = R.load_btc_funding(ts)
    na = P.shape[1]

    def build_exec(P_perp):
        with np.errstate(all='ignore'):
            r_p = np.vstack([np.zeros((1, na)), np.diff(np.log(P_perp), axis=0)])
            r_s = np.vstack([np.zeros((1, na)), np.diff(np.log(P), axis=0)])
        has = np.isfinite(r_p)
        has[0] = False
        r_s2 = np.where(np.isfinite(r_s), r_s, 0.0)
        return np.where(has, r_p, r_s2)

    print('=== extension 1000× — G2,5/C3 perp intégral, cellule/params inchangés ===')
    # référence (matching actuel)
    F0, cnt0, le0 = C.load_funding_panel(syms, ts)
    g0 = R.gate_series(P, F0, cnt0, le0, hist)
    run(P, F0, cnt0, le0, ts, g0, btc_r_perp, F_btc, build_exec(R.load_perp_panel(syms, ts)),
        'référence')
    # étendu
    F1, cnt1, le1, mapped = load_funding_ext(syms, ts)
    print(f'\nperps 1000× mappés vers un spot existant : {len(mapped)} → {mapped}')
    g1 = R.gate_series(P, F1, cnt1, le1, hist)
    run(P, F1, cnt1, le1, ts, g1, btc_r_perp, F_btc, build_exec(load_perp_ext(syms, ts)),
        'ÉTENDU 1000×')


if __name__ == '__main__':
    main()
