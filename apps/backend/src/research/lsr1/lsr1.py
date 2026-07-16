#!/usr/bin/env python3
"""lsr1 — L/S ratio cross-section (protocole LOG.md committé AVANT).
Machinerie oi1-v4 : signal PUR, univers restreint, null rotation intra-vie,
K7, signe libre.  python3 lsr1.py fetch | placebo | is [inv] | oos [inv]"""
import json
import os
import sys
import time
import urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'xsection1'))
sys.path.insert(0, os.path.join(HERE, '..', 'oi1'))
from xsection_u import IS_END, OOS_END, bh_flags, load_panel, metrics, portfolio_fast, universe_symbols  # noqa: E402
from oi1 import IS_START, zexp, coinalyze_key  # noqa: E402

CACHE = os.path.join(HERE, 'lsr_binance.csv')


def fetch():
    key = coinalyze_key()
    syms = universe_symbols()
    done = set()
    if os.path.exists(CACHE):
        with open(CACHE) as f:
            next(f)
            done = {line.split(',')[0] for line in f}
    with open(CACHE, 'a') as out:
        if not done:
            out.write('symbol,t,r\n')
        todo = [s for s in syms if s not in done]
        print(f'à fetcher : {len(todo)}/{len(syms)}')
        for i, s in enumerate(todo):
            url = (f'https://api.coinalyze.net/v1/long-short-ratio-history?symbols={s}_PERP.A'
                   f'&interval=daily&from=1593561600&to=1783987200')
            rq = urllib.request.Request(url, headers={'api_key': key})
            hist = []
            for attempt in range(5):
                try:
                    with urllib.request.urlopen(rq, timeout=45) as r:
                        data = json.loads(r.read())
                    hist = data[0]['history'] if data else []
                    break
                except urllib.error.HTTPError as e:
                    if e.code == 429:
                        time.sleep(10 * (attempt + 1))
                        continue
                    break
                except Exception:
                    time.sleep(3)
            for h in hist:
                if h.get('r') is not None and float(h['r']) > 0:
                    out.write(f"{s},{int(h['t']) * 1000},{float(h['r'])}\n")
            out.flush()
            if (i + 1) % 25 == 0:
                print(f'fetch {i + 1}/{len(todo)}')
            time.sleep(1.6)
    print('fetch LSR terminé')


def load_lsr(symbols, ts):
    sidx = {s: i for i, s in enumerate(symbols)}
    tidx = {int(t): i for i, t in enumerate(ts)}
    X = np.full((len(ts), len(symbols)), np.nan)
    with open(CACHE) as f:
        next(f)
        for line in f:
            s, t, v = line.strip().split(',')
            a = sidx.get(s)
            i = tidx.get(int(t))
            if a is not None and i is not None:
                X[i, a] = float(v)
    return X


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'is'
    if mode == 'fetch':
        fetch()
        return
    inv = 'inv' in sys.argv[2:]
    rng = np.random.default_rng(42)
    syms = universe_symbols()
    ts, P = load_panel(syms)
    X = load_lsr(syms, ts)
    keep = np.isfinite(X).any(axis=0)
    P = P[:, keep]
    X = X[:, keep]
    if mode == 'placebo':
        for c in range(X.shape[1]):
            fin = np.where(np.isfinite(X[:, c]))[0]
            if len(fin) > 10:
                X[fin, c] = rng.permutation(X[fin, c])
    a, b = (IS_START, IS_END) if mode != 'oos' else (IS_END, OOS_END)
    seg = (int(np.searchsorted(ts, a)), int(np.searchsorted(ts, b)))
    with np.errstate(all='ignore'):
        S = zexp(np.log(X))
    if inv:
        S = -S

    def eval_rotcol(S_, kind, nperm):
        real = portfolio_fast(P, S_, 7, seg, kind)
        m = metrics(real)
        rng2 = np.random.default_rng(7)
        fins = [np.flatnonzero(np.isfinite(S_[:, c])) for c in range(S_.shape[1])]
        hit = 0
        for _ in range(nperm):
            Sk = np.full_like(S_, np.nan)
            for c, fin in enumerate(fins):
                if len(fin) > 60:
                    k = int(rng2.integers(30, len(fin) - 29))
                    Sk[fin, c] = np.roll(S_[fin, c], k)
            null = portfolio_fast(P, Sk, 7, seg, kind)
            sd = null.std(ddof=1)
            if (null.mean() / sd * np.sqrt(365) if sd > 0 else -9) >= m['sharpe']:
                hit += 1
        m['p'] = (1 + hit) / (1 + nperm)
        return m

    ncov = P.shape[1]
    label = {'placebo': 'PLACEBO LSR iid', 'is': 'IS 2020-07→2024-01',
             'oos': 'OOS — UNE PASSE'}[mode]
    print(f'=== lsr1 {label}{" — MIROIR" if inv else ""} (couverture {ncov}, net 30 bps) ===')
    rows = []
    for kind in ('LO', 'LS'):
        m = eval_rotcol(S, kind, 500 if mode != 'placebo' else 200)
        rows.append(dict(kind=kind, **m))
        calmar = m['cagr'] / m['dd'] if m['dd'] > 0 else np.nan
        print(f"LSR-Z K7 {kind:2s} | Sharpe {m['sharpe']:+5.2f} CAGR {m['cagr']:+7.1f}% "
              f"DD {m['dd']:5.1f}% Calmar {calmar:5.2f} p={m['p']:.4f}")
    flags = bh_flags([r_['p'] for r_ in rows])
    surv = [r_['kind'] for r_, f in zip(rows, flags) if f]
    print(f"BH-FDR : {surv if surv else 'aucun'}")
    if mode == 'placebo':
        hits = sum(1 for r_ in rows if r_['p'] < 0.01)
        print(f'PLACEBO : {hits}/2 à p<0,01 → {"OK" if hits == 0 else "ALERTE — STOP"}')


if __name__ == '__main__':
    main()
