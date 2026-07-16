#!/usr/bin/env python3
"""oi1 — OI cross-section (protocole LOG.md committé AVANT). OI Binance
quotidien via Coinalyze (coin-denominated → ×prix pour OI-REL). Signaux :
OI-MOM Δlog7j · OI-REL z-exp90 de log(OI$/ADV30). K7, LO/LS, signe libre.
  python3 oi1.py fetch | control | placebo | is [inv] | oos [inv]"""
import json
import os
import sys
import time
import urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'xsection1'))
sys.path.insert(0, os.path.join(HERE, '..', 'zvol1'))
from xsection_u import (IS_END, OOS_END, bh_flags, eval_config,  # noqa: E402
                        load_panel, universe_symbols)
from zvol import load_vol_panel  # noqa: E402

IS_START = np.datetime64('2020-07-01').astype('datetime64[ms]').astype(np.int64)
DAY = 86_400_000
CACHE = os.path.join(HERE, 'oi_binance.csv')


def coinalyze_key():
    for line in open(os.path.join(HERE, '..', '..', '..', '.env')):
        if line.startswith('COINALYZE_API_KEY='):
            return line.split('=', 1)[1].strip()
    sys.exit('clé introuvable')


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
            out.write('symbol,t,oi\n')
        todo = [s for s in syms if s not in done]
        print(f'à fetcher : {len(todo)}/{len(syms)}')
        for i, s in enumerate(todo):
            url = (f'https://api.coinalyze.net/v1/open-interest-history?symbols={s}_PERP.A'
                   f'&interval=daily&from=1593561600&to=1783987200')
            rq = urllib.request.Request(url, headers={'api_key': key})
            hist = []
            for attempt in range(5):
                try:
                    with urllib.request.urlopen(rq, timeout=60) as r:
                        data = json.loads(r.read())
                    hist = data[0]['history'] if data else []
                    break
                except urllib.error.HTTPError as e:
                    if e.code == 429:
                        time.sleep(10 * (attempt + 1))
                        continue
                    break
                except Exception:
                    break
            for h in hist:
                if h.get('c') is not None:
                    out.write(f"{s},{int(h['t']) * 1000},{float(h['c'])}\n")
            out.flush()
            if (i + 1) % 25 == 0:
                print(f'fetch {i + 1}/{len(todo)}')
            time.sleep(1.6)
    print('fetch OI terminé')


def load_oi(symbols, ts):
    sidx = {s: i for i, s in enumerate(symbols)}
    tidx = {int(t): i for i, t in enumerate(ts)}
    O = np.full((len(ts), len(symbols)), np.nan)
    with open(CACHE) as f:
        next(f)
        for line in f:
            s, t, v = line.strip().split(',')
            a = sidx.get(s)
            i = tidx.get(int(t))
            if a is not None and i is not None:
                O[i, a] = float(v)
    return O


def zexp(x, look=90):
    n, na = x.shape
    xf = np.where(np.isfinite(x), x, 0.0)
    m = np.isfinite(x).astype(float)
    cs = np.vstack([np.zeros((1, na)), np.cumsum(xf, axis=0)])
    cs2 = np.vstack([np.zeros((1, na)), np.cumsum(xf * xf, axis=0)])
    cm = np.vstack([np.zeros((1, na)), np.cumsum(m, axis=0)])
    S = np.full((n, na), np.nan)
    for t in range(look, n):
        cnt = cm[t] - cm[t - look]
        ok = cnt >= look * 0.9
        mu = (cs[t] - cs[t - look]) / np.maximum(cnt, 1)
        var = (cs2[t] - cs2[t - look]) / np.maximum(cnt, 1) - mu * mu
        sd = np.sqrt(np.maximum(var, 0))
        z = (x[t] - mu) / np.where(sd > 0, sd, np.nan)
        S[t] = np.where(ok & np.isfinite(z), z, np.nan)
    return S


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'is'
    if mode == 'fetch':
        fetch()
        return
    inv = 'inv' in sys.argv[2:]
    rng = np.random.default_rng(42)
    syms = universe_symbols()
    ts, P = load_panel(syms)
    O = load_oi(syms, ts)
    # amendement 2 : univers RESTREINT aux colonnes à OI (le null permute
    # dans le même univers — sinon effet perp-vs-pas-perp, 7e attrape)
    keep = np.isfinite(O).any(axis=0)
    P = P[:, keep]
    O = O[:, keep]
    syms = [s_ for s_, k in zip(syms, keep) if k]
    if mode == 'placebo':
        for c in range(O.shape[1]):
            fin = np.where(np.isfinite(O[:, c]))[0]
            if len(fin) > 10:
                O[fin, c] = rng.permutation(O[fin, c])
    ncov = int(np.isfinite(O).any(axis=0).sum())
    a, b = (IS_START, IS_END) if mode != 'oos' else (IS_END, OOS_END)
    seg = (int(np.searchsorted(ts, a)), int(np.searchsorted(ts, b)))

    if mode == 'control':
        lp = np.log(P)
        n, na = P.shape
        r = np.vstack([np.zeros((1, na)), np.diff(lp, axis=0)])
        cheat = np.full_like(P, np.nan)
        cheat[:-1] = r[1:]
        m, _ = eval_config(P, cheat, 7, seg, 'LS', nperm=200)
        print(f"CONTRÔLE PLANTÉ : Sharpe {m['sharpe']:+.2f} p={m['p']:.4f} → "
              f"{'EXPLOSE ✓' if m['sharpe'] > 3 else 'STOP'}")
        return

    with np.errstate(all='ignore'):
        lO = np.log(O)
        n, na = O.shape
        s_mom = np.full((n, na), np.nan)
        s_mom[7:] = lO[7:] - lO[:-7]
        # amendement placebo : OI-LEVEL PUR (aucun prix/volume mélangé)
        s_rel = zexp(lO)
    label = {'placebo': 'PLACEBO OI iid', 'is': 'IS 2020-07→2024-01',
             'oos': 'OOS 2024-01→2026-07 — UNE PASSE'}[mode]
    print(f'=== oi1 {label}{" — MIROIR" if inv else ""} (couverture {ncov}/{na}, net 30 bps) ===')
    rows = []
    for nm, S in (('OI-MOM', s_mom), ('OI-LEVEL', s_rel)):
        Su = -S if inv else S
        for kind in ('LO', 'LS'):
            m, _ = eval_config(P, Su, 7, seg, kind, nperm=1000 if mode != 'placebo' else 200)
            rows.append(dict(nm=nm, kind=kind, **m))
            calmar = m['cagr'] / m['dd'] if m['dd'] > 0 else np.nan
            print(f"{nm} K7 {kind:2s} | Sharpe {m['sharpe']:+5.2f} CAGR {m['cagr']:+7.1f}% "
                  f"DD {m['dd']:5.1f}% Calmar {calmar:5.2f} p={m['p']:.4f}")
    flags = bh_flags([r_['p'] for r_ in rows])
    surv = [f"{r_['nm']}/{r_['kind']}" for r_, f in zip(rows, flags) if f]
    print(f"BH-FDR : {surv if surv else 'aucun'}")
    if mode == 'placebo':
        hits = sum(1 for r_ in rows if r_['p'] < 0.01)
        print(f'PLACEBO : {hits}/4 à p<0,01 → {"OK" if hits == 0 else "ALERTE — STOP"}')


if __name__ == '__main__':
    main()
