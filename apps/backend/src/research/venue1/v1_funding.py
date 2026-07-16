#!/usr/bin/env python3
"""venue1 V1 — risque de base funding OKX vs Binance (protocole LOG.md).
Échantillon FIGÉ : top-40 des noms les plus fréquents du quintile shorté
regime1 en OOS 2024-26 ∩ listés OKX (+ BTC/ETH témoins). Funding OKX via
Coinalyze (daily, venue .3). CONVENTION (consignée) : taux moyen quotidien —
Binance = somme des ~3 événements / 3 (funding_daily_all), OKX = close du
daily Coinalyze ; suffisant pour corrélation/écart/ratio (diagnostic).
  python3 v1_funding.py"""
import json
import os
import sys
import time
import urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'regime1'))
sys.path.insert(0, os.path.join(HERE, '..', 'xsection1'))
import regime as R  # noqa: E402
from stress import okx_bases  # noqa: E402

C = R.C
DAY = 86_400_000
A = np.datetime64('2024-01-01').astype('datetime64[ms]').astype(np.int64)
B = np.datetime64('2026-07-01').astype('datetime64[ms]').astype(np.int64)
CACHE = os.path.join(HERE, 'funding_okx.csv')


def coinalyze_key():
    k = os.environ.get('COINALYZE_API_KEY', '')
    if not k:
        env = os.path.join(HERE, '..', '..', '..', '.env')
        for line in open(env):
            if line.startswith('COINALYZE_API_KEY='):
                k = line.split('=', 1)[1].strip()
    if not k:
        sys.exit('COINALYZE_API_KEY introuvable')
    return k


def fetch_okx(symbols):
    key = coinalyze_key()
    rows = []
    for i, s in enumerate(symbols):
        sym = f'{s}_PERP.3'
        url = (f'https://api.coinalyze.net/v1/funding-rate-history?symbols={sym}'
               f'&interval=daily&from={A // 1000}&to={B // 1000}')
        req = urllib.request.Request(url, headers={'api_key': key})
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = json.loads(r.read())
                break
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    time.sleep(10 * (attempt + 1))
                    continue
                data = []
                break
        hist = data[0]['history'] if data else []
        for h in hist:
            rows.append((s, int(h['t']) * 1000, float(h['c'])))
        if (i + 1) % 10 == 0:
            print(f'  fetch {i + 1}/{len(symbols)} ({s}: {len(hist)} j)')
        time.sleep(1.6)
    with open(CACHE, 'w') as f:
        f.write('symbol,t,rate\n')
        for s, t, r_ in rows:
            f.write(f'{s},{t},{r_}\n')
    return rows


def main():
    syms = C.universe_symbols()
    ts, P = C.load_panel(syms)
    F, cnt, lastev = C.load_funding_panel(syms, ts)
    hist = np.isfinite(P).cumsum(axis=0)
    g = R.gate_series(P, F, cnt, lastev, hist)
    S = C.signal_funding(F, 'FLEVEL', dict(L=3))
    on = np.where(np.isfinite(g), g >= 2.5 / 1e4, False)
    lo, hi = int(np.searchsorted(ts, A)), int(np.searchsorted(ts, B))
    freq = {}
    for t in range(lo, hi, R.K):
        if not on[t]:
            continue
        elig = (np.isfinite(S[t]) & np.isfinite(P[t]) & (hist[t] >= C.WARMUP)
                & (cnt[t] >= 21) & (lastev[t] <= 2))
        idx = np.flatnonzero(elig)
        if len(idx) < C.MIN_ALIVE:
            continue
        ntop = max(1, int(round(len(idx) * C.TOPQ)))
        for a in idx[np.argsort(S[t][idx])][:ntop]:
            freq[a] = freq.get(a, 0) + 1
    okx = okx_bases()
    cand = sorted(freq.items(), key=lambda x: -x[1])
    sample = [syms[a] for a, _ in cand if syms[a][:-4] in okx][:40]
    sample += ['BTCUSDT', 'ETHUSDT']
    print(f'échantillon figé : {len(sample)} symboles (top quintile OOS ∩ OKX + témoins)')

    if not os.path.exists(CACHE):
        fetch_okx(sample)
    okx_rows = {}
    with open(CACHE) as f:
        next(f)
        for line in f:
            s, t, r_ = line.strip().split(',')
            # Coinalyze renvoie des POURCENTS (0.01 = 1 bps) ; Binance est en
            # fraction — vérifié sur WLD vs API OKX directe (bug d'unités attrapé)
            okx_rows.setdefault(s, {})[int(t) // DAY] = float(r_) / 100.0

    sidx = {s: i for i, s in enumerate(syms)}
    tidx_days = [int(t) // DAY for t in ts[lo:hi]]
    corrs, spreads, npts = [], [], []
    on_bin, on_okx = [], []
    for s in sample:
        a = sidx.get(s)
        d_okx = okx_rows.get(s, {})
        if a is None or len(d_okx) < 100:
            continue
        xb, xo, xon = [], [], []
        for k, t in enumerate(range(lo, hi)):
            day = tidx_days[k]
            if day in d_okx:
                rb = F[t, a] / 3.0                     # taux moyen Binance
                ro = d_okx[day]
                xb.append(rb)
                xo.append(ro)
                if on[t]:
                    xon.append((rb, ro))
        if len(xb) < 100:
            continue
        xb, xo = np.array(xb), np.array(xo)
        corrs.append(float(np.corrcoef(xb, xo)[0, 1]))
        spreads.append(float((xb - xo).mean()) * 3 * 1e4)     # bps/JOUR (×3 événements)
        npts.append(len(xb))
        if xon:
            on_bin.append(float(np.mean([x[0] for x in xon])))
            on_okx.append(float(np.mean([x[1] for x in xon])))
    corrs, spreads = np.array(corrs), np.array(spreads)
    print(f'\n=== V1 — {len(corrs)} symboles mesurés (méd {int(np.median(npts))} j communs) ===')
    print(f'corrélation quotidienne OKX↔Binance : méd {np.median(corrs):+.2f}, p10 {np.percentile(corrs, 10):+.2f}')
    print(f'écart (Binance − OKX) : méd {np.median(spreads):+.2f} bps/j, moy {spreads.mean():+.2f} bps/j')
    rb, ro = np.mean(on_bin), np.mean(on_okx)
    ratio = ro / rb if rb > 0 else np.nan
    print(f'jours porte-ON : taux moyen Binance {rb * 3 * 1e4:+.2f} bps/j vs OKX {ro * 3 * 1e4:+.2f} bps/j '
          f'→ ratio {ratio:.2f}')
    okd = np.median(corrs) >= 0.6 and ratio >= 0.6
    print(f"barre diagnostic (corr méd ≥ 0,6 ET ratio ON ≥ 0,6) : {'GÉRABLE ✓' if okd else 'RED FLAG ✗'}")


if __name__ == '__main__':
    main()
