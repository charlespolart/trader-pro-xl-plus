#!/usr/bin/env python3
# accum4 : DÉTECTEURS DE RANGE et leurs propriétés (IS only, 4h).
# Un range « tradable » doit avoir : des bornes qui TIENNENT, des oscillations
# (le carburant MR), et un drift ≈ 0 (sinon vendre le haut = se battre contre
# la marée). Le chiffre décisif par détecteur :
#   P(zone haute → retour au milieu AVANT cassure)  [succès d'un short/vente]
#   P(zone basse → retour au milieu AVANT cassure)  [succès d'un long/rachat]
#   python3 rangedetect.py
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'accum3'))
from lib import (IS_END, IS_START, align_to, atr, ema, load, regime_1d,
                 roll_max, roll_mean, roll_min, roll_rank, roll_std, shift)

EPS = 1e-12
W_RANGE = 120   # bornes = donchian 120 barres 4h (~20 j)
H = 42          # horizon de propriétés (~7 j)


def build(sym: str):
    X = load(sym, '4h')
    c, h, l = X['c'], X['h'], X['l']
    r = np.full(len(c), np.nan)
    r[1:] = np.log(c[1:] / c[:-1])
    a = atr(h, l, c, 14)
    # ADX(14) — lissage SMA (screening)
    up = h - shift(h, 1)
    dn = shift(l, 1) - l
    pdm = np.where((up > dn) & (up > 0), up, 0.0)
    ndm = np.where((dn > up) & (dn > 0), dn, 0.0)
    pdi = 100 * roll_mean(pdm, 14) / (a + EPS)
    ndi = 100 * roll_mean(ndm, 14) / (a + EPS)
    dx = 100 * np.abs(pdi - ndi) / (pdi + ndi + EPS)
    adx = roll_mean(dx, 14)
    # BB width percentile
    bbw = 4 * roll_std(c, 20) / (roll_mean(c, 20) + EPS)
    bbw_pct = roll_rank(bbw, 240)
    # donchian width percentile
    hh, ll = roll_max(h, W_RANGE), roll_min(l, W_RANGE)
    dwidth = (hh - ll) / (c + EPS)
    dw_pct = roll_rank(dwidth, 240)
    # EMA200 plate
    e200 = ema(c, 200)
    flat = (np.abs(e200 / shift(e200, 30) - 1) < 0.01) & (np.abs(c / e200 - 1) < 0.05)
    # vr / ER
    r5 = np.full(len(c), np.nan)
    r5[5:] = np.log(c[5:] / c[:-5])
    vr = (roll_std(r5, 60) ** 2) / (5 * roll_std(r, 60) ** 2 + EPS)
    dc = np.abs(np.diff(c, prepend=np.nan))
    from lib import roll_sum
    er60 = np.abs(c - shift(c, 60)) / (roll_sum(np.where(np.isfinite(dc), dc, 0), 60) + EPS)
    # régime 1d
    d1 = load(sym, '1d')
    ct1, code1 = regime_1d(d1)
    reg = align_to(X['t'], ct1, code1)
    dets = {
        'toujours': np.ones(len(c), dtype=bool),
        'adx<20': adx < 20,
        'adx<25': adx < 25,
        'bbw_pct<.3': bbw_pct < 0.3,
        'donw_pct<.3': dw_pct < 0.3,
        'ema200_plate': flat,
        'vr<1': vr < 1.0,
        'er60<.15': er60 < 0.15,
        'neutre_1d': reg == 0,
        'neutre&adx25': (reg == 0) & (adx < 25),
        'plate&adx25': flat & (adx < 25),
        'bbw&adx25': (bbw_pct < 0.3) & (adx < 25),
    }
    for k in dets:
        v = dets[k] & np.isfinite(a) & np.isfinite(hh) & np.isfinite(ll)
        dets[k] = v
    return X, dets, hh, ll, a


def properties(X, det, hh, ll, a, t0, t1):
    t, c, h, l = X['t'], X['c'], X['h'], X['l']
    m = (t >= t0) & (t < t1) & det
    idx = np.where(m)[0]
    n = len(c)
    if len(idx) < 100:
        return None
    cover = m.sum() / ((t >= t0) & (t < t1)).sum() * 100
    # épisodes
    d = np.diff(idx)
    n_epis = 1 + (d > 1).sum()
    durs = np.diff(np.concatenate([[0], np.where(d > 1)[0] + 1, [len(idx)]]))
    # tenue des bornes sur H barres (échantillonné tous les 6 pour l'indépendance)
    hold = []
    drift = []
    sub = idx[:: 6]
    for i in sub:
        if i + H >= n:
            continue
        hi, lo = hh[i] + 0.5 * a[i], ll[i] - 0.5 * a[i]
        seg_h, seg_l = h[i + 1: i + H + 1], l[i + 1: i + H + 1]
        hold.append(float(seg_h.max() <= hi and seg_l.min() >= lo))
        drift.append(np.log(c[i + H] / c[i]))
    # succès des bornes : entrée en zone haute → mid AVANT cassure haute (vente/short)
    #                     entrée en zone basse → mid AVANT cassure basse (rachat/long)
    def zone_success(top: bool):
        wins, tot = 0, 0
        width = hh - ll
        zin = (c > ll + 0.8 * width) if top else (c < ll + 0.2 * width)
        enter = zin & ~shift(zin.astype(float), 1).astype(bool) & m
        for i in np.where(enter)[0]:
            if i + H >= n:
                continue
            mid = ll[i] + 0.5 * width[i]
            brk = hh[i] + 0.5 * a[i] if top else ll[i] - 0.5 * a[i]
            ok = None
            for j in range(i + 1, i + H + 1):
                if top and h[j] >= brk:
                    ok = False
                    break
                if not top and l[j] <= brk:
                    ok = False
                    break
                if (top and l[j] <= mid) or (not top and h[j] >= mid):
                    ok = True
                    break
            if ok is not None:
                wins += int(ok)
                tot += 1
            else:
                tot += 1  # ni mid ni cassure en H barres = échec (capital bloqué)
        return (wins / tot * 100 if tot else np.nan), tot
    p_top, n_top = zone_success(True)
    p_bot, n_bot = zone_success(False)
    return {
        'cover': cover, 'epis': n_epis, 'med_dur': float(np.median(durs)),
        'hold': float(np.mean(hold)) * 100 if hold else np.nan,
        'drift': float(np.mean(drift)) * 100 if drift else np.nan,
        'p_top': p_top, 'n_top': n_top, 'p_bot': p_bot, 'n_bot': n_bot,
    }


def main():
    for sym in ('BTCUSDT', 'ETHUSDT'):
        X, dets, hh, ll, a = build(sym)
        print(f'=== {sym} 4h, IS 2018-04→2024-01 — bornes donchian {W_RANGE}, horizon {H} barres ===')
        print(f"{'détecteur':14} {'couv%':>6} {'épis':>5} {'durM':>5} {'tient%':>7} {'drift7j':>8} {'P(haut→mid)':>12} {'n':>5} {'P(bas→mid)':>11} {'n':>5}")
        for name, det in dets.items():
            p = properties(X, det, hh, ll, a, IS_START, IS_END)
            if p is None:
                print(f'{name:14} (trop peu de barres)')
                continue
            print(f"{name:14} {p['cover']:6.1f} {p['epis']:5d} {p['med_dur']:5.0f} {p['hold']:7.1f} {p['drift']:+8.2f} "
                  f"{p['p_top']:12.1f} {p['n_top']:5d} {p['p_bot']:11.1f} {p['n_bot']:5d}")
        print()


if __name__ == '__main__':
    main()
