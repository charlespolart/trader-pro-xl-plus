#!/usr/bin/env python3
# accum3 : VALIDATION VRX pré-OOS (défauts FIGÉS : vr_5_60 4h, in 1.15, out 0.90,
# gate hors-bull = EMA200 1d + déclin 30j, sans cap, frais 0,15%/côté).
#   1. fenêtres annuelles glissantes IS (WF à params figés)
#   2. null timing-aléatoire au réglage retenu (300 tirages)
#   3. sensibilité du gate (EMA 150/200/250 × déclin 15/30/45)
#   4. sensibilité de la date de départ (12 départs mensuels)
#   python3 vrx_validate.py
#   python3 vrx_validate.py oos   # LA passe OOS unique 2024-01→2026-07
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from deepdive_vr import vr_5_60
from lib import IS_END, IS_START, OOS_END, align_to, ema, load, shift
from vrx2 import sim_abs

FEE = 0.0015
TH_IN, TH_OUT = 1.15, 0.90


def gate_horsbull(X, d1, malen=200, slope=30):
    e = ema(d1['c'], malen)
    bull = (d1['c'] > e) & (shift(e, slope) < e)
    g = align_to(X['t'], d1['ct'], (~bull).astype(float))
    out = g == 1.0
    out[~np.isfinite(g)] = False
    return out


def main():
    X = load('BTCUSDT', '4h')
    d1 = load('BTCUSDT', '1d')
    vr = vr_5_60(X['c'])
    gate = gate_horsbull(X, d1)
    oos = len(sys.argv) > 1 and sys.argv[1] == 'oos'
    if oos:
        print('=== OOS 2024-01→2026-07 — PASSE UNIQUE, tout figé ===')
        r = sim_abs(X, vr, gate, TH_IN, TH_OUT, t0=IS_END, t1=OOS_END)
        print(f'  net {r["net"]:+.1f}%  DD {r["dd"]:+.1f}%  {r["tr"]}tr  {r["nexc"]}exc  WR {r["wr"]:.0f}%  payoff {r["payoff"]:.1f}  pire {r["worst"]:+.1f}%')
        # et le null OOS pour l'honnêteté du contexte
        null_run(X, vr, gate, IS_END, OOS_END)
        return

    print('=== 1. fenêtres annuelles (params figés 1.15/0.90) ===')
    y0 = np.datetime64('2018-07')
    while True:
        t0 = y0.astype('datetime64[ms]').astype(np.int64)
        t1 = (y0 + np.timedelta64(12, 'M')).astype('datetime64[ms]').astype(np.int64)
        if t1 > IS_END:
            break
        r = sim_abs(X, vr, gate, TH_IN, TH_OUT, t0=t0, t1=t1)
        print(f'  {y0} → +12M : net {r["net"]:+7.1f}%  DD {r["dd"]:+6.1f}%  {r["tr"]:3d}tr')
        y0 += np.timedelta64(6, 'M')

    print('\n=== 2. null timing-aléatoire (300, IS, réglage retenu) ===')
    null_run(X, vr, gate, IS_START, IS_END)

    print('\n=== 3. sensibilité du gate (EMA × déclin) ===')
    for malen in (150, 200, 250):
        row = []
        for slope in (15, 30, 45):
            g = gate_horsbull(X, d1, malen, slope)
            r = sim_abs(X, vr, g, TH_IN, TH_OUT)
            row.append(f'{r["net"]:+6.1f}')
        print(f'  EMA{malen}: ' + '  '.join(row))

    print('\n=== 4. date de départ (12 départs mensuels 2018-04→2019-03, fin 2024-01) ===')
    nets = []
    for m in range(12):
        t0 = (np.datetime64('2018-04') + np.timedelta64(m, 'M')).astype('datetime64[ms]').astype(np.int64)
        r = sim_abs(X, vr, gate, TH_IN, TH_OUT, t0=t0, t1=IS_END)
        nets.append(r['net'])
    nets = np.array(nets)
    print(f'  min {nets.min():+.1f}%  méd {np.median(nets):+.1f}%  max {nets.max():+.1f}%  ({(nets > 0).sum()}/12 positifs)')


def null_run(X, vr, gate, t0, t1):
    r = sim_abs(X, vr, gate, TH_IN, TH_OUT, t0=t0, t1=t1)
    t = X['t']
    idx = np.where((t >= t0) & (t < t1))[0]
    # épisodes réels
    state, pend, episodes, start = 1, None, [], None
    for j, i in enumerate(idx):
        if pend is not None:
            state = pend
            pend = None
            if state == 0:
                start = j
            elif start is not None:
                episodes.append(j - start)
                start = None
        if not np.isfinite(vr[i]):
            continue
        if state == 1 and gate[i] and vr[i] > TH_IN:
            pend = 0
        elif state == 0 and (vr[i] < TH_OUT or not gate[i]):
            pend = 1
    rng = np.random.default_rng(0)
    co = X['c'][idx]
    g_idx = gate[idx]
    nets = []
    for _ in range(300):
        occupied = np.zeros(len(idx), dtype=bool)
        pos = np.ones(len(idx), dtype=np.int8)
        for dur in episodes:
            for _try in range(400):
                s = rng.integers(0, max(len(idx) - dur - 1, 1))
                # même contexte que la stratégie : excursion entière hors-bull
                if not occupied[s: s + dur + 1].any() and g_idx[s: s + dur].all():
                    occupied[s: s + dur + 1] = True
                    pos[s: s + dur] = 0
                    break
        v, st = 1.0, 1
        for j in range(1, len(idx)):
            if pos[j] != st:
                v *= (1 - FEE)
                st = pos[j]
            if st == 0:
                v *= co[j - 1] / co[j]
        nets.append((v - 1) * 100)
    nets = np.array(nets)
    print(f'  réel {r["net"]:+.1f}%  null méd {np.median(nets):+.1f}%  p95 {np.quantile(nets, 0.95):+.1f}%  percentile réel {100 * (nets < r["net"]).mean():.1f}')


if __name__ == '__main__':
    main()
