#!/usr/bin/env python3
"""venue2 — réplication G2,5/C3 avec signal sur funding BYBIT (protocole
LOG.md committé AVANT). Source Coinalyze venue .6 (API Bybit géo-bloquée),
POURCENTS ÷100 (leçon venue1). Exécution inchangée : prix perps Binance +
funding Binance. Une variante jugée, IS + OOS.
  python3 venue2.py fetch | run"""
import json
import os
import subprocess
import sys
import time
import urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'regime1'))
import regime as R  # noqa: E402

C = R.C
DAY = 86_400_000
CACHE = os.path.join(HERE, 'funding_bybit.csv')
A_FETCH = 1593561600      # 2020-07-01 (secondes)
B_FETCH = 1783987200      # ~2026-07-14


def coinalyze_key():
    for line in open(os.path.join(HERE, '..', '..', '..', '.env')):
        if line.startswith('COINALYZE_API_KEY='):
            return line.split('=', 1)[1].strip()
    sys.exit('clé introuvable')


def fetch():
    key = coinalyze_key()
    syms_spot = set(C.universe_symbols()) | {'BTCUSDT', 'ETHUSDT'}
    req = urllib.request.Request('https://api.coinalyze.net/v1/future-markets',
                                 headers={'api_key': key})
    with urllib.request.urlopen(req, timeout=60) as r:
        mkts = json.loads(r.read())
    targets = sorted({x['symbol'] for x in mkts
                      if x['symbol'].endswith('.6') and x.get('is_perpetual')
                      and x['symbol'][:-2] in syms_spot})
    print(f'perps Bybit ∩ univers spot : {len(targets)}')
    done = set()
    if os.path.exists(CACHE):
        with open(CACHE) as f:
            next(f)
            done = {line.split(',')[0] for line in f}
    with open(CACHE, 'a') as out:
        if not done:
            out.write('symbol,t,rate\n')
        for i, sym in enumerate(targets):
            s_clean = sym[:-2]
            if s_clean in done:
                continue
            url = (f'https://api.coinalyze.net/v1/funding-rate-history?symbols={sym}'
                   f'&interval=daily&from={A_FETCH}&to={B_FETCH}')
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
                if h.get('c') is None:
                    continue
                out.write(f"{s_clean},{int(h['t']) * 1000},{float(h['c'])}\n")
            out.flush()
            if (i + 1) % 25 == 0:
                print(f'fetch {i + 1}/{len(targets)}')
            time.sleep(1.6)
    print('fetch terminé')


def load_bybit_funding(symbols, ts):
    """panel funding Bybit aligné (taux quotidien ÷100 ×3 ≈ somme jour)."""
    sidx = {s: i for i, s in enumerate(symbols)}
    tidx = {int(t): i for i, t in enumerate(ts)}
    F = np.zeros((len(ts), len(symbols)))
    seen = np.zeros((len(ts), len(symbols)))
    with open(CACHE) as f:
        next(f)
        for line in f:
            s, t, r_ = line.strip().split(',')
            a = sidx.get(s)
            i = tidx.get(int(t))
            if a is not None and i is not None:
                F[i, a] = float(r_) / 100.0 * 3.0     # % close → somme quotid. approx
                seen[i, a] = 3.0
    cnt = seen.cumsum(axis=0)
    lastev = np.full_like(F, np.inf)
    last_seen = np.full(len(symbols), -np.inf)
    for i in range(len(ts)):
        has = seen[i] > 0
        last_seen[has] = i
        lastev[i] = i - last_seen
    return F, cnt, lastev


def main():
    if sys.argv[1:2] == ['fetch']:
        fetch()
        return
    syms = C.universe_symbols()
    ts, P = C.load_panel(syms)
    hist = np.isfinite(P).cumsum(axis=0)
    F_bin, cnt_bin, le_bin = C.load_funding_panel(syms, ts)
    F_by, cnt_by, le_by = load_bybit_funding(syms, ts)
    ncov = int((cnt_by[-1] > 0).sum())
    print(f'couverture funding Bybit : {ncov}/{len(syms)} colonnes')
    g_by = R.gate_series(P, F_by, cnt_by, le_by, hist)
    S_by = C.signal_funding(F_by, 'FLEVEL', dict(L=3))
    on = np.where(np.isfinite(g_by), g_by >= 2.5 / 1e4, False)
    btc_r_perp = R.load_btc(ts, market='futures')
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
    print('=== venue2 — G2,5/C3, signal FUNDING BYBIT, exécution Binance (perp intégral) ===')
    for lab, a, b in (('IS ', R.IS_START, R.IS_END), ('OOS', R.IS_END, R.OOS_END)):
        sg = (int(np.searchsorted(ts, a)), int(np.searchsorted(ts, b)))
        # éligibilité/sélection sur données BYBIT ; funding ENCAISSÉ Binance
        m, _ = R.eval_cell(P, F_bin, cnt_by, le_by, S_by, on, sg, 'C3',
                           btc_r_perp, ts, r_exec=r_exec, btc_f=F_btc)
        calmar = m['cagr'] / m['dd'] if m['dd'] > 0 else np.nan
        print(f"{lab} | Sharpe {m['sharpe']:+5.2f} CAGR {m['cagr']:+7.1f}% DD {m['dd']:5.1f}% "
              f"Calmar {calmar:5.2f} p={m['p']:.4f} ON {m['on_share'] * 100:4.1f}% "
              f"ép {m['eps_pos']}/{m['neps']}")
    print('barre : OOS même signe, Sharpe ≥ 0,8, épisodes majoritaires')


if __name__ == '__main__':
    main()
