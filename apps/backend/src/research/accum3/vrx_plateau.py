#!/usr/bin/env python3
# accum3 : famille VRX — plateau (th_in × th_out × gate), réplication ETH,
# stress coûts, et RECOUVREMENT avec la v2 (mêmes excursions ou complément ?).
# IS uniquement. Le réglage retenu devra être un plateau (médiane du voisinage),
# jamais un pic.
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from deepdive_vr import vr_5_60
from lib import IS_END, IS_START, align_to, ema, load, regime_1d, shift

FEE = 0.0015
HALF = np.datetime64('2021-02-17').astype('datetime64[ms]').astype(np.int64)


def build(sym: str):
    X = load(sym, '4h')
    d1 = load(sym, '1d')
    ct1, code1 = regime_1d(d1)
    reg = align_to(X['t'], ct1, code1)
    vr = vr_5_60(X['c'])
    return X, reg, vr


def sim(X, vr, active_gate, th_in, th_out, fee=FEE, t0=IS_START, t1=IS_END):
    t, o, c = X['t'], X['o'], X['c']
    m = (t >= t0) & (t < t1)
    idx = np.where(m)[0]
    btc, usdt, state, pend = 1.0, 0.0, 1, None
    eq = np.ones(len(idx))
    trades = 0
    pos = np.ones(len(idx), dtype=np.int8)
    for j, i in enumerate(idx):
        if pend is not None:
            px = o[i]
            if pend == 0:
                usdt, btc = btc * px * (1 - fee), 0.0
            else:
                btc, usdt = usdt / px * (1 - fee), 0.0
            state = pend
            pend = None
            trades += 1
        eq[j] = btc + usdt / c[i]
        pos[j] = state
        if not np.isfinite(vr[i]):
            continue
        g = bool(active_gate[i])
        if state == 1 and g and vr[i] > th_in:
            pend = 0
        elif state == 0 and (vr[i] < th_out or not g):
            pend = 1
    peak = np.maximum.accumulate(eq)
    dd = ((eq - peak) / peak).min() * 100
    tm = t[idx]
    n1 = (eq[tm < HALF][-1] / eq[tm < HALF][0] - 1) * 100 if (tm < HALF).sum() > 1 else 0.0
    n2 = (eq[tm >= HALF][-1] / eq[tm >= HALF][0] - 1) * 100 if (tm >= HALF).sum() > 1 else 0.0
    return {'net': (eq[-1] - 1) * 100, 'dd': dd, 'tr': trades, 'n1': n1, 'n2': n2, 'pos': pos, 'idx': idx, 'eq': eq}


def v2_positions(sym: str, X):
    """Positions v2-like (vendu=0) rejouées en mécanique simplifiée sur 4h :
    régime = 3d EMA60 déclin 8 + 1d EMA200 déclin 30 (approx quotidienne),
    timing = ER/flow/EMA50 comme la prod, stop 2,5×ATR cap 5%, rebuy recross."""
    from lib import atr as atr_f
    from lib import roll_mean, roll_sum
    d1 = load(sym, '1d')
    d3 = load(sym, '3d')
    e60 = ema(d3['c'], 60)
    e200 = ema(d1['c'], 200)
    bear3 = (d3['c'] < e60) & (shift(e60, 8) > e60)
    bear1 = (d1['c'] < e200) & (shift(e200, 30) > e200)
    b3 = align_to(X['t'], d3['ct'], bear3.astype(float))
    b1 = align_to(X['t'], d1['ct'], bear1.astype(float))
    c, h, l = X['c'], X['h'], X['l']
    # ER(20)
    dc = np.abs(np.diff(c, prepend=np.nan))
    er = np.abs(c - shift(c, 20)) / (roll_sum(dc, 20) + 1e-12)
    e50 = ema(c, 50)
    flow = roll_sum(X['tb'], 10) / (roll_sum(X['v'], 10) + 1e-12)
    a = atr_f(h, l, c, 14)
    n = len(c)
    pos = np.ones(n, dtype=np.int8)
    state, stop, sold = 1, 0.0, 0.0
    for i in range(1, n):
        pos[i] = state
        if state == 1:
            if (b3[i] == 1 and b1[i] == 1 and np.isfinite(er[i]) and er[i] >= 0.35
                    and np.isfinite(flow[i]) and flow[i] < 0.5 and np.isfinite(e50[i]) and c[i] < e50[i] and np.isfinite(a[i]) and a[i] > 0):
                state = 0
                sold = c[i]
                stop = min(c[i] + 2.5 * a[i], sold * 1.05)
        else:
            if c[i] > e50[i] or c[i] >= stop:
                state = 1
    return pos


def main():
    X, reg, vr = build('BTCUSDT')
    ok = (X['t'] >= IS_START) & (X['t'] < IS_END) & np.isfinite(vr)
    qs = {p: np.nanquantile(vr[ok], p / 100) for p in (50, 60, 70, 75, 80, 85, 90, 95)}
    gates = {'horsbull': reg != 1, 'tous': np.ones(len(vr), dtype=bool), 'bear': reg == 2}

    print('=== PLATEAU IS (net% / moitiés) — BTC 4h ===')
    for gname, g in gates.items():
        print(f'-- gate {gname}')
        for pin in (75, 80, 85, 90):
            row = []
            for pout in (50, 60, 70, 80):
                if pout >= pin:
                    row.append('    —    ')
                    continue
                r = sim(X, vr, g, qs[pin], qs[pout])
                row.append(f'{r["net"]:+6.1f}({r["n1"]:+.0f}/{r["n2"]:+.0f})')
            print(f'  in q{pin}: ' + '  '.join(row))
    print()

    print('=== réplication ETH (seuils des quantiles ETH propres) ===')
    Xe, rege, vre = build('ETHUSDT')
    oke = (Xe['t'] >= IS_START) & (Xe['t'] < IS_END) & np.isfinite(vre)
    qse = {p: np.nanquantile(vre[oke], p / 100) for p in (60, 80)}
    re = sim(Xe, vre, rege != 1, qse[80], qse[60])
    print(f'  ETH horsbull q80/q60 : net {re["net"]:+.1f}%  DD {re["dd"]:+.1f}%  {re["tr"]}tr  moitiés {re["n1"]:+.1f}/{re["n2"]:+.1f}')

    print('\n=== stress coûts (BTC horsbull q80/q60) ===')
    for mult in (1, 2, 3):
        r = sim(X, vr, reg != 1, qs[80], qs[60], fee=FEE * mult)
        print(f'  frais ×{mult} : net {r["net"]:+.1f}%  DD {r["dd"]:+.1f}%  {r["tr"]}tr')

    print('\n=== recouvrement avec la v2 (IS) ===')
    r = sim(X, vr, reg != 1, qs[80], qs[60])
    posv2 = v2_positions('BTCUSDT', X)[r['idx']]
    posvr = r['pos']
    out_vr = posvr == 0
    out_v2 = posv2 == 0
    both = (out_vr & out_v2).sum()
    print(f'  barres hors-BTC : vrx {out_vr.mean()*100:.1f}%  v2lite {out_v2.mean()*100:.1f}%  jointes {both / max(out_vr.sum(), 1) * 100:.0f}% des sorties vrx')
    # équités combinées : moitié capital sur chaque politique (indépendantes)
    c_ = X['c'][r['idx']]
    o_ = X['o'][r['idx']]

    def equity(pos):
        v, st = 1.0, 1
        eq = np.ones(len(pos))
        for j in range(1, len(pos)):
            if pos[j] != st:
                v *= (1 - FEE)
                st = pos[j]
            if st == 0:
                v *= c_[j - 1] / c_[j]
            eq[j] = v
        return eq

    e_vr, e_v2 = equity(posvr), equity(posv2)
    e_mix = 0.5 * e_vr + 0.5 * e_v2
    for nm, e in (('vrx', e_vr), ('v2lite', e_v2), ('mix50', e_mix)):
        peak = np.maximum.accumulate(e)
        print(f'  {nm:7} net {(e[-1]-1)*100:+7.1f}%  DD {((e-peak)/peak).min()*100:+.1f}%')
    rv = np.diff(np.log(e_vr))
    r2 = np.diff(np.log(e_v2))
    m = (rv != 0) | (r2 != 0)
    if m.sum() > 100:
        cc = np.corrcoef(rv[m], r2[m])[0, 1]
        print(f'  corrélation des retours (barres actives) : {cc:+.2f}')


if __name__ == '__main__':
    main()
