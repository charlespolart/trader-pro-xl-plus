#!/usr/bin/env python3
"""regime1 étape 8 — stress d'exécution (protocole LOG.md §ÉTAPE 8 committé
AVANT). 8a capacité participation 1 % ; 8b turnover/coûts ; 8c couverture
OKX en jours-poids (liste instruments VIVANTS → borne BASSE, consigné).
  python3 stress.py"""
import json
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import regime as R  # noqa: E402

C = R.C
SLEEVE_USD = 6_000.0        # 20 % × ~30 k$ (référence du protocole)
BAR_CAPACITY = 60_000.0     # 10× la sleeve
BAR_OKX = 70.0              # % jours-poids


def load_volume_panel(symbols, ts):
    q = ("COPY (SELECT symbol, open_time, quote_volume FROM candles WHERE market='futures' AND "
         "interval='1d' AND symbol = ANY('{" + ','.join(symbols) + "}') "
         "ORDER BY symbol, open_time) TO STDOUT (FORMAT csv)")
    out = subprocess.run(['psql', R.DB, '-c', q], capture_output=True, text=True, check=True).stdout
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


def okx_bases():
    out = subprocess.run(
        ['curl', '-s', 'https://www.okx.com/api/v5/public/instruments?instType=SWAP'],
        capture_output=True, text=True, check=True).stdout
    data = json.loads(out)['data']
    return {x['instId'].split('-')[0] for x in data if x['instId'].endswith('-USDT-SWAP')}


def main():
    syms = C.universe_symbols()
    ts, P = C.load_panel(syms)
    F, cnt, lastev = C.load_funding_panel(syms, ts)
    hist = np.isfinite(P).cumsum(axis=0)
    g = R.gate_series(P, F, cnt, lastev, hist)
    S = C.signal_funding(F, 'FLEVEL', dict(L=3))
    on = np.where(np.isfinite(g), g >= 2.5 / 1e4, False)
    V = load_volume_panel(syms, ts)
    lo = int(np.searchsorted(ts, R.IS_START))
    hi = int(np.searchsorted(ts, R.OOS_END))

    # rejoue la SÉLECTION réelle (logique identique à portfolio_gated, C3)
    na = P.shape[1]
    w = np.zeros(na)
    w_btc = 0.0
    turnover = 0.0
    caps, advmins, advmeds, ntops = [], [], [], []
    cover_num = cover_den = 0.0
    okx = okx_bases()
    has_okx = np.array([s[:-4] in okx for s in syms])   # XYZUSDT → XYZ
    for t in range(lo, hi, R.K):
        neww = np.zeros(na)
        new_btc = 0.0
        if on[t]:
            elig = (np.isfinite(S[t]) & np.isfinite(P[t]) & (hist[t] >= C.WARMUP)
                    & (cnt[t] >= 21) & (lastev[t] <= 2))
            idx = np.flatnonzero(elig)
            if len(idx) >= C.MIN_ALIVE:
                ntop = max(1, int(round(len(idx) * C.TOPQ)))
                order = idx[np.argsort(S[t][idx])]
                shorts = order[:ntop]
                for a in shorts:
                    neww[a] -= 1.0 / ntop
                new_btc = 1.0
                vols = V[t, shorts]
                vols = np.where(np.isfinite(vols), vols, 0.0)
                advmins.append(float(vols.min()))
                advmeds.append(float(np.median(vols)))
                ntops.append(ntop)
                caps.append(0.01 * float(vols.min()) * ntop)
                nb_days = min(R.K, hi - t)
                cover_num += float(has_okx[shorts].sum()) / ntop * nb_days
                cover_den += nb_days
        turnover += float(np.abs(neww - w).sum() + abs(new_btc - w_btc))
        w, w_btc = neww, new_btc

    years = (hi - lo) / 365.0
    caps = np.array(caps)
    print('=== ÉTAPE 8 — stress d exécution (sélection réelle rejouée, '
          f'{len(caps)} rebals ON sur {(hi - lo) // R.K}) ===')
    print(f'8a CAPACITÉ (participation 1 %, panier équipondéré, ntop méd {int(np.median(ntops))}) :')
    print(f'   ADV du nom le plus fin du panier : méd {np.median(advmins) / 1e6:.1f} M$, '
          f'p10 {np.percentile(advmins, 10) / 1e6:.2f} M$')
    print(f'   ADV médian du panier            : méd {np.median(advmeds) / 1e6:.1f} M$')
    p10 = float(np.percentile(caps, 10))
    print(f'   S_max panier : méd {np.median(caps) / 1e3:.0f} k$, p10 {p10 / 1e3:.0f} k$, '
          f'min {caps.min() / 1e3:.0f} k$')
    ok_a = p10 >= BAR_CAPACITY
    print(f'   → barre p10 ≥ {BAR_CAPACITY / 1e3:.0f} k$ (10× sleeve {SLEEVE_USD / 1e3:.0f} k$) : '
          f"{'PASSE ✓' if ok_a else 'CASSE ✗'} (marge ×{p10 / SLEEVE_USD:.0f} vs sleeve)")

    ann_turn = turnover / years
    cost_ann = ann_turn * C.COST
    print(f'\n8b TURNOVER : notionnel tourné {ann_turn:.1f}×/an (jambes short+BTC) '
          f'→ coût {cost_ann * 100:.1f} %/an aux 30 bps/côté ; stress coûts ×2 déjà passé '
          f'(étape 6 : OOS Sharpe +1,31). Limite tick consignée (pas de symbolInfo).')

    covp = cover_num / cover_den * 100 if cover_den else float('nan')
    ok_c = covp >= BAR_OKX
    print(f'\n8c COUVERTURE OKX (instruments VIVANTS → borne basse) : '
          f'{covp:.1f} % des jours-poids shortés ont un perp OKX USDT '
          f"→ barre ≥ {BAR_OKX:.0f} % : {'PASSE ✓' if ok_c else 'CASSE ✗'}")

    print(f"\nBARRE GLOBALE ÉTAPE 8 : {'PASSE ✓✓' if ok_a and ok_c else 'CASSE ✗'}")


if __name__ == '__main__':
    main()
