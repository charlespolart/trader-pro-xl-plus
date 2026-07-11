#!/usr/bin/env python3
# accum3 : DEEP-DIVE de la famille survivante du screening — micro-structure du
# chemin en 4h (vr_5_60 bas / hurst_spread haut → retours 5j positifs).
# Question d'accumulation : le quintile DÉFAVORABLE (vr haut) est-il assez
# NÉGATIF (pas juste « moins positif ») pour payer 0,30% aller-retour ?
# Étapes : quintiles → persistance des états → mini-sim exit-BTC avec hystérésis
# → null timing-aléatoire à même structure. IS uniquement.
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import IS_END, IS_START, align_to, fwd_logret, load, regime_1d, roll_std, shift

FEE = 0.0015


def vr_5_60(c):
    r = np.full(len(c), np.nan)
    r[1:] = np.log(c[1:] / c[:-1])
    r5 = np.full(len(c), np.nan)
    r5[5:] = np.log(c[5:] / c[:-5])
    v5 = roll_std(r5, 60) ** 2
    v1 = roll_std(r, 60) ** 2
    return v5 / (5 * v1 + 1e-12)


def main():
    X = load('BTCUSDT', '4h')
    Xe = load('ETHUSDT', '4h')
    d1 = load('BTCUSDT', '1d')
    ct1, code1 = regime_1d(d1)
    reg = align_to(X['t'], ct1, code1)
    t = X['t']
    m_is = (t >= IS_START) & (t < IS_END)

    for sym, XX in (('BTC', X), ('ETH', Xe)):
        c = XX['c']
        tt = XX['t']
        mm = (tt >= IS_START) & (tt < IS_END)
        vr = vr_5_60(c)
        f30 = fwd_logret(c, 30)
        ok = mm & np.isfinite(vr) & np.isfinite(f30)
        qs = np.nanquantile(vr[ok], [0.2, 0.4, 0.6, 0.8])
        print(f'— {sym} 4h : quintiles vr_5_60 → fwd 30 barres (5j), IS')
        for i in range(5):
            lo = -np.inf if i == 0 else qs[i - 1]
            hi = np.inf if i == 4 else qs[i]
            sel = ok & (vr > lo) & (vr <= hi)
            mu = f30[sel].mean() * 100
            neg = (f30[sel] < 0).mean() * 100
            print(f'  Q{i+1}: n={sel.sum():5d}  fwd5j {mu:+.2f}%  P(<0) {neg:.0f}%')
        print()

    # persistance de l'état défavorable (vr > q80) : tradable ?
    c = X['c']
    vr = vr_5_60(c)
    ok = m_is & np.isfinite(vr)
    q80 = np.nanquantile(vr[ok], 0.8)
    q60 = np.nanquantile(vr[ok], 0.6)
    hot = vr > q80
    runs = []
    n = 0
    for i in np.where(m_is)[0]:
        if hot[i]:
            n += 1
        elif n:
            runs.append(n)
            n = 0
    runs = np.array(runs)
    print(f'état vr>q80 : {len(runs)} épisodes IS, durée méd {np.median(runs):.0f} barres, moy {runs.mean():.1f}, p90 {np.quantile(runs, 0.9):.0f}')

    # mini-sim : détenir BTC, SORTIR quand vr>seuil_in, revenir quand vr<seuil_out
    # (hystérésis) ; variantes gated par régime. Exécution à l'open suivant.
    o = X['o']

    def sim(th_in, th_out, gate=None, fee=FEE):
        btc = 1.0
        usdt = 0.0
        state = 1  # 1 = en BTC
        pend = None
        eq = []
        trades = 0
        idx = np.where(m_is)[0]
        for i in idx:
            if pend is not None:
                px = o[i]
                if pend == 0:
                    usdt = btc * px * (1 - fee)
                    btc = 0.0
                else:
                    btc = usdt / px * (1 - fee)
                    usdt = 0.0
                state = pend
                pend = None
                trades += 1
            v = btc + usdt / c[i]
            eq.append(v)
            if not np.isfinite(vr[i]):
                continue
            g = True if gate is None else bool(gate[i])
            if state == 1 and vr[i] > th_in and g:
                pend = 0
            elif state == 0 and (vr[i] < th_out or (gate is not None and not g)):
                pend = 1
        eq = np.array(eq)
        peak = np.maximum.accumulate(eq)
        return (eq[-1] - 1) * 100, ((eq - peak) / peak).min() * 100, trades, eq

    print('\n— mini-sim exit-BTC sur vr (hystérésis in/out), IS, frais 0,15%/côté')
    half_t = np.datetime64('2021-02-17').astype('datetime64[ms]').astype(np.int64)
    for gate_name, gate in (('tous régimes', None), ('hors-bull', reg != 1), ('bear seul', reg == 2)):
        for thi, tho, lbl in ((q80, q60, 'q80/q60'), (np.nanquantile(vr[ok], 0.9), q80, 'q90/q80')):
            net, dd, tr, eq = sim(thi, tho, gate)
            # moitiés
            idx = np.where(m_is)[0]
            hmask = t[idx] < half_t
            e1 = eq[hmask]
            e2 = eq[~hmask]
            n1 = (e1[-1] / e1[0] - 1) * 100 if len(e1) > 1 else 0
            n2 = (e2[-1] / e2[0] - 1) * 100 if len(e2) > 1 else 0
            print(f'  {gate_name:12} {lbl:8} net {net:+7.2f}%  DD {dd:+6.2f}%  {tr:4d}tr  moitiés {n1:+.1f}/{n2:+.1f}')

    # null : mêmes nombre+durées d'excursions hors-BTC, placées au hasard (IS)
    print('\n— null timing-aléatoire (300 tirages) pour hors-bull q80/q60 :')
    net_real, dd_real, tr_real, eq_real = sim(q80, q60, reg != 1)
    # reconstituer les épisodes réels
    idx = np.where(m_is)[0]
    state = 1
    pend = None
    episodes = []
    start = None
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
        g = bool((reg != 1)[i])
        if state == 1 and vr[i] > q80 and g:
            pend = 0
        elif state == 0 and (vr[i] < q60 or not g):
            pend = 1
    rng = np.random.default_rng(0)
    nets = []
    co = X['c'][idx]
    oo = X['o'][idx]
    for _ in range(300):
        pos = np.ones(len(idx))
        occupied = np.zeros(len(idx), dtype=bool)
        for dur in episodes:
            for _try in range(200):
                s = rng.integers(0, len(idx) - dur - 1)
                if not occupied[s: s + dur + 1].any():
                    occupied[s: s + dur + 1] = True
                    pos[s: s + dur] = 0
                    break
        v = 1.0
        state = 1
        for j in range(1, len(idx)):
            if pos[j] != state:
                v *= (1 - FEE)
                state = int(pos[j])
            if state == 0:
                v *= co[j - 1] / co[j]
        nets.append((v - 1) * 100)
    nets = np.array(nets)
    print(f'  réel {net_real:+.2f}%  null méd {np.median(nets):+.2f}%  p95 {np.quantile(nets, 0.95):+.2f}%  percentile du réel {100 * (nets < net_real).mean():.1f}')


if __name__ == '__main__':
    main()
