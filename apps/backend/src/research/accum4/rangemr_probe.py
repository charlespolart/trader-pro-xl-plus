#!/usr/bin/env python3
# accum4 : STEELMAN avant enterrement du range trading.
# (a) Sensibilité géométrique du succès de borne : fenêtre W (60/120), zone
#     d'entrée (0,8/0,9), cible (mid / retrace 0,25W) — si AUCUNE cellule
#     n'approche ~50-55%, la famille bornes est morte, pas juste mal réglée.
# (b) MR d'oscillateur COURTE (RSI2/RSI14/bb_pos extrêmes), gated range,
#     forward 6/12/24 barres — la seule variante compatible maker 0,04% AR.
#     Séparation d'abord : IC + null décalage + magnitude en unités de coûts.
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'accum3'))
from lib import (IS_END, IS_START, atr, fwd_logret, load, roll_max, roll_mean,
                 roll_min, roll_rank, roll_std, rsi, shift, shift_null_p)
from rangedetect import build

EPS = 1e-12


def zone_success_geo(X, det, W, zone, target_kind, H=42):
    c, h, l = X['c'], X['h'], X['l']
    t = X['t']
    a = atr(h, l, c, 14)
    hh, ll = roll_max(h, W), roll_min(l, W)
    width = hh - ll
    m = (t >= IS_START) & (t < IS_END) & det & np.isfinite(width) & np.isfinite(a)
    n = len(c)
    out = {}
    for top in (True, False):
        zin = (c > ll + zone * width) if top else (c < ll + (1 - zone) * width)
        enter = zin & ~np.where(np.isfinite(shift(zin.astype(float), 1)), shift(zin.astype(float), 1), 0).astype(bool) & m
        wins, tot = 0, 0
        for i in np.where(enter)[0]:
            if i + H >= n:
                continue
            if target_kind == 'mid':
                tgt = ll[i] + 0.5 * width[i]
            else:  # retrace 0.25W depuis la borne
                tgt = (hh[i] - 0.25 * width[i]) if top else (ll[i] + 0.25 * width[i])
            brk = hh[i] + 0.5 * a[i] if top else ll[i] - 0.5 * a[i]
            ok = False
            for j in range(i + 1, i + H + 1):
                if top and h[j] >= brk:
                    break
                if not top and l[j] <= brk:
                    break
                if (top and l[j] <= tgt) or (not top and h[j] >= tgt):
                    ok = True
                    break
            wins += int(ok)
            tot += 1
        out['top' if top else 'bot'] = (wins / tot * 100 if tot else np.nan, tot)
    return out


def main():
    X, dets, *_ = build('BTCUSDT')
    c = X['c']
    t = X['t']
    m_is = (t >= IS_START) & (t < IS_END)

    print('=== (a) sensibilité géométrique — BTC, meilleurs détecteurs ===')
    print(f"{'détecteur':14} {'W':>4} {'zone':>5} {'cible':>8} {'P(top)':>7} {'n':>5} {'P(bot)':>7} {'n':>5}")
    for dname in ('donw_pct<.3', 'ema200_plate', 'bbw_pct<.3'):
        det = dets[dname]
        for W in (60, 120):
            for zone in (0.8, 0.9):
                for tk in ('mid', 'retrace'):
                    r = zone_success_geo(X, det, W, zone, tk)
                    (pt, nt), (pb, nb) = r['top'], r['bot']
                    print(f'{dname:14} {W:>4} {zone:>5} {tk:>8} {pt:7.1f} {nt:5d} {pb:7.1f} {nb:5d}')
        print()

    print('=== (b) MR oscillateur courte, gated — BTC, IS ===')
    r2 = rsi(c, 2)
    r14 = rsi(c, 14)
    bbp = (c - roll_mean(c, 20)) / (2 * roll_std(c, 20) + EPS)
    feats = {'rsi2': r2, 'rsi14': r14, 'bb_pos': bbp}
    print(f"{'feature':8} {'gate':14} {'h':>3} {'IC':>7} {'p':>7} | extrêmes: fwd après bas5% vs haut5% (en % et en coûts maker AR 0,04%)")
    for h_ in (6, 12, 24):
        f = fwd_logret(c, h_)
        for fname, v in feats.items():
            for gname in ('toujours', 'donw_pct<.3', 'ema200_plate'):
                g = dets[gname]
                ok = m_is & g & np.isfinite(v) & np.isfinite(f)
                if ok.sum() < 600:
                    continue
                sub = np.where(ok)[0]
                ic, p = shift_null_p(v[sub], f[sub], min_shift=max(120, 3 * h_))
                qlo, qhi = np.nanquantile(v[ok], [0.05, 0.95])
                lo = f[ok & (v <= qlo)].mean() * 100
                hi = f[ok & (v >= qhi)].mean() * 100
                print(f'{fname:8} {gname:14} {h_:>3} {ic:+7.3f} {p:7.4f} | bas {lo:+.2f}%  haut {hi:+.2f}%  spread {lo - hi:+.2f}% (= {(lo - hi) / 0.04:.1f}× maker AR)')
        print()


if __name__ == '__main__':
    main()
