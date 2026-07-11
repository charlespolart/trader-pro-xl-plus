#!/usr/bin/env python3
# accum4 Track 2 : EV RÉELLE du range trading « traditionnel » en FUTURES.
# Fade des bornes : short à l'entrée en zone haute (0,8W), TP = retrace 0,25W
# (maker), SL = borne + 0,5×ATR (taker+slip), timeout 42 barres → sortie market.
# Miroir long en zone basse. Funding historique appliqué (8 h, signé).
# Coûts : maker 0,02 %, taker 0,05 % + slippage 0,05 % (futures OKX Regular).
# Verdict par cellule : n, WR, EV/trade nette, net total, moitiés, et
# co-occurrence avec le signal VRX (redondance éventuelle).
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'accum3'))
from lib import IS_END, IS_START, atr, load, roll_max, roll_min, roll_std, shift
from screen import load_funding
from rangedetect import build

MAKER, TAKER, SLIP = 0.0002, 0.0005, 0.0005
H = 42
HALF = np.datetime64('2021-02-17').astype('datetime64[ms]').astype(np.int64)


def vr_5_60(c):
    r = np.full(len(c), np.nan)
    r[1:] = np.log(c[1:] / c[:-1])
    r5 = np.full(len(c), np.nan)
    r5[5:] = np.log(c[5:] / c[:-5])
    return (roll_std(r5, 60) ** 2) / (5 * roll_std(r, 60) ** 2 + 1e-12)


def sim(X, det, W, fund_t, fund_r, t0=IS_START, t1=IS_END):
    t, c, h, l, o = X['t'], X['c'], X['h'], X['l'], X['o']
    a = atr(h, l, c, 14)
    hh, ll = roll_max(h, W), roll_min(l, W)
    width = hh - ll
    vr = vr_5_60(c)
    n = len(c)
    m = (t >= t0) & (t < t1) & det & np.isfinite(width) & np.isfinite(a)
    trades = []
    i = 0
    zin_top = c > ll + 0.8 * width
    zin_bot = c < ll + 0.2 * width
    prev_top = np.where(np.isfinite(shift(zin_top.astype(float), 1)), shift(zin_top.astype(float), 1), 0).astype(bool)
    prev_bot = np.where(np.isfinite(shift(zin_bot.astype(float), 1)), shift(zin_bot.astype(float), 1), 0).astype(bool)
    enter_top = zin_top & ~prev_top & m
    enter_bot = zin_bot & ~prev_bot & m
    fi = 0
    while i < n - 1:
        side = 0
        if enter_top[i]:
            side = -1  # short le haut
        elif enter_bot[i]:
            side = 1   # long le bas
        if side == 0:
            i += 1
            continue
        e = o[i + 1] * (1 + side * SLIP * 0)  # exécution à l'open suivant, maker supposé (limite au prix)
        entry_cost = MAKER
        if side == -1:
            tp = hh[i] - 0.25 * width[i]
            sl = hh[i] + 0.5 * a[i]
        else:
            tp = ll[i] + 0.25 * width[i]
            sl = ll[i] - 0.5 * a[i]
        pnl = None
        j_end = min(i + 1 + H, n - 1)
        fund = 0.0
        for j in range(i + 1, j_end + 1):
            # funding pendant la détention (rate signé : + = les longs paient)
            while fi < len(fund_t) and fund_t[fi] <= t[j]:
                if fund_t[fi] > t[i + 1]:
                    fund += -side * fund_r[fi]
                fi += 1
            hit_sl = (h[j] >= sl) if side == -1 else (l[j] <= sl)
            hit_tp = (l[j] <= tp) if side == -1 else (h[j] >= tp)
            if hit_sl and hit_tp:
                hit_tp = False  # pessimiste : le stop d'abord
            if hit_sl:
                px = sl * (1 + (-side) * 0)  # stop market
                pnl = side * (px / e - 1) - entry_cost - TAKER - SLIP
                break
            if hit_tp:
                pnl = side * (tp / e - 1) - entry_cost - MAKER
                break
        if pnl is None:
            px = c[j_end]
            pnl = side * (px / e - 1) - entry_cost - TAKER - SLIP
            j = j_end
        trades.append({'i': i, 'j': j, 'side': side, 'pnl': pnl + fund, 'fund': fund,
                       'vrx': bool(vr[i] > 1.15), 't': t[i]})
        # fi peut avoir dépassé pour le prochain trade → on le laisse (fund_t trié, trades chronologiques)
        i = j + 1
    return trades


def report(trades, label):
    if not trades:
        print(f'{label}: aucun trade')
        return
    pnl = np.array([tr['pnl'] for tr in trades])
    eq = np.cumprod(1 + pnl)
    wr = (pnl > 0).mean() * 100
    h1 = np.array([tr['t'] < HALF for tr in trades])
    net1 = (np.prod(1 + pnl[h1]) - 1) * 100 if h1.any() else 0
    net2 = (np.prod(1 + pnl[~h1]) - 1) * 100 if (~h1).any() else 0
    shorts = np.array([tr['side'] == -1 for tr in trades])
    fund = np.array([tr['fund'] for tr in trades])
    co_vrx = np.mean([tr['vrx'] for tr in trades if tr['side'] == -1]) * 100 if shorts.any() else np.nan
    print(f'{label}: n={len(pnl)}  WR {wr:.0f}%  EV/trade {pnl.mean() * 100:+.3f}%  net {(eq[-1] - 1) * 100:+.1f}%  '
          f'moitiés {net1:+.1f}/{net2:+.1f}  | shorts {shorts.mean() * 100:.0f}% (net {(np.prod(1 + pnl[shorts]) - 1) * 100:+.1f}%, co-VRX {co_vrx:.0f}%)  '
          f'longs net {(np.prod(1 + pnl[~shorts]) - 1) * 100:+.1f}%  funding cum {fund.sum() * 100:+.2f}%')


def main():
    X, dets, *_ = build('BTCUSDT')
    fr = load_funding('BTCUSDT')
    fund_t, fund_r = (fr if fr is not None else (np.array([], dtype=np.int64), np.array([])))
    print('=== fade de bornes FUTURES, IS 2018-04→2024-01, coûts réels + funding ===')
    for dname in ('donw_pct<.3', 'ema200_plate', 'bbw_pct<.3', 'toujours'):
        for W in (60, 120):
            tr = sim(X, dets[dname], W, fund_t, fund_r)
            report(tr, f'{dname:14} W{W:3d}')
        print()


if __name__ == '__main__':
    main()
