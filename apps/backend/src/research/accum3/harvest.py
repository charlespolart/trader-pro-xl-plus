#!/usr/bin/env python3
# accum3 famille B : VOL-HARVESTING régime-gated (Shannon / constant-mix à bandes).
# Thèse : en régime non-bull, un mix BTC/USDT rebalancé par bandes ACCUMULE du BTC
# grâce au rebalancing bonus w(1-w)σ²/2 par unité de temps, si μ < w·σ²/2 et si
# les frais ne mangent pas tout. C'est le complément du trou v2 (2024-26 chop).
# Décomposition OBLIGATOIRE : net = effet d'allocation (mix statique par segment,
# ~régime, déjà réfuté seul) + ALPHA DE REBALANCEMENT (la seule chose défendable).
# Null : mêmes segments actifs, rebalances à instants ALÉATOIRES (même nombre).
#   python3 harvest.py            # sweep IS
#   python3 harvest.py oos        # OOS 2024→2026 (à ne toucher qu'au verdict)
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import IS_END, IS_START, OOS_END, align_to, ema, load, regime_1d, shift

FEE = 0.0015  # 0,10% taker OKX + 0,05% slippage


def build(itv: str = '4h'):
    X = load('BTCUSDT', itv)
    d1 = load('BTCUSDT', '1d')
    ct1, code1 = regime_1d(d1)
    reg = align_to(X['t'], ct1, code1)
    return X, reg


def sim(X, active, w_target: float, band: float, fee: float = FEE,
        rebal_times: np.ndarray | None = None):
    """Décision au close i, exécution à l'open i+1. Renvoie (V en BTC à chaque
    close, nb trades, turnover cumulé en fraction de V, frais cumulés en BTC)."""
    o, c = X['o'], X['c']
    n = len(c)
    btc, usdt = 1.0, 0.0
    V = np.ones(n)
    trades, turnover, fees = 0, 0.0, 0.0
    pending = None  # poids cible à exécuter à l'open suivant
    for i in range(n):
        if pending is not None:
            px = o[i]
            v_now = btc + usdt / px
            tgt_btc = pending * v_now
            delta = tgt_btc - btc  # en BTC
            cost = abs(delta) * fee
            btc = tgt_btc - (cost if delta > 0 else 0)
            usdt = usdt - delta * px - (cost * px if delta <= 0 else 0)
            trades += 1
            turnover += abs(delta) / v_now
            fees += cost
            pending = None
        v = btc + usdt / c[i]
        V[i] = v
        w = btc / v
        if rebal_times is not None:
            if rebal_times[i]:
                pending = w_target if active[i] else 1.0
                if abs((w_target if active[i] else 1.0) - w) < 1e-9:
                    pending = None
            continue
        tw = w_target if active[i] else 1.0
        if abs(w - tw) > band:
            pending = tw
    return V, trades, turnover, fees


def static_mix(X, active, w_target: float, fee: float = FEE):
    """Contrefactuel ALLOCATION : même exposition par segment mais SANS
    rebalance interne — on passe à w_target à l'entrée du segment actif,
    retour à 100% BTC à la sortie, rien entre les deux."""
    o, c = X['o'], X['c']
    n = len(c)
    btc, usdt = 1.0, 0.0
    V = np.ones(n)
    pending = None
    prev_active = False
    for i in range(n):
        if pending is not None:
            px = o[i]
            v_now = btc + usdt / px
            tgt_btc = pending * v_now
            delta = tgt_btc - btc
            cost = abs(delta) * fee
            btc = tgt_btc - (cost if delta > 0 else 0)
            usdt = usdt - delta * px - (cost * px if delta <= 0 else 0)
            pending = None
        v = btc + usdt / c[i]
        V[i] = v
        a = bool(active[i])
        if a != prev_active:
            pending = w_target if a else 1.0
            prev_active = a
    return V


def maxdd(V: np.ndarray) -> float:
    peak = np.maximum.accumulate(V)
    return float(((V - peak) / peak).min())


def run_window(X, reg, t0: int, t1: int, mode: str, w: float, band: float,
               fee: float = FEE, nulls: int = 0, seed: int = 0):
    m = (X['t'] >= t0) & (X['t'] < t1)
    idx = np.where(m)[0]
    Xw = {k: (v[idx] if isinstance(v, np.ndarray) else v) for k, v in X.items()}
    r = reg[idx]
    if mode == 'nonbull':
        active = r != 1
    elif mode == 'neutral':
        active = r == 0
    elif mode == 'always':
        active = np.ones(len(idx), dtype=bool)
    else:
        raise ValueError(mode)
    active = active & np.isfinite(r) if mode != 'always' else active
    V, tr, to, fees = sim(Xw, active, w, band, fee)
    Vs = static_mix(Xw, active, w, fee)
    net, net_static = V[-1] - 1, Vs[-1] - 1
    out = {
        'net': net * 100, 'alpha_rebal': (net - net_static) * 100,
        'net_static': net_static * 100, 'dd': maxdd(V) * 100,
        'trades': tr, 'turnover': to, 'fees_btc': fees * 100,
        'active_pct': float(active.mean()) * 100,
    }
    if nulls > 0:
        rng = np.random.default_rng(seed)
        # instants de rebalance réels (bandes) → même NOMBRE d'instants aléatoires
        # dans les segments actifs (+ transitions de régime conservées)
        V0, tr0, _, _ = sim(Xw, active, w, band, fee)
        n_rebal = tr0
        act_idx = np.where(active)[0]
        nets = []
        for _ in range(nulls):
            times = np.zeros(len(idx), dtype=bool)
            if len(act_idx) and n_rebal:
                pick = rng.choice(act_idx, size=min(n_rebal, len(act_idx)), replace=False)
                times[pick] = True
            trans = np.zeros(len(idx), dtype=bool)
            trans[1:] = active[1:] != active[:-1]
            Vn, *_ = sim(Xw, active, w, band, fee, rebal_times=times | trans)
            nets.append(Vn[-1] - 1)
        nets = np.array(nets) * 100
        out['null_med'] = float(np.median(nets))
        out['null_p95'] = float(np.quantile(nets, 0.95))
    return out


def fmt(r):
    base = (f"net {r['net']:+7.2f}%  (alloc {r['net_static']:+6.2f}% + REBAL {r['alpha_rebal']:+6.2f}%)  "
            f"DD {r['dd']:+6.2f}%  {r['trades']:4d}tr  frais {r['fees_btc']:5.2f}%  actif {r['active_pct']:4.1f}%")
    if 'null_med' in r:
        base += f"  null(méd {r['null_med']:+.2f} / p95 {r['null_p95']:+.2f})"
    return base


def main():
    oos = len(sys.argv) > 1 and sys.argv[1] == 'oos'
    X, reg = build('4h')
    if oos:
        t0, t1 = IS_END, OOS_END
        print('=== OOS 2024-01→2026-07 (une seule passe, config figée) ===')
        # config figée au verdict IS — à éditer UNE fois
        for mode, w, band in [('nonbull', 0.5, 0.05)]:
            r = run_window(X, reg, t0, t1, mode, w, band, nulls=300)
            print(f'{mode:8} w={w} band={band}  {fmt(r)}')
        return
    t0, t1 = IS_START, IS_END
    half = np.datetime64('2021-02-17').astype('datetime64[ms]').astype(np.int64)
    print('=== IS 2018-04→2024-01, grille (mode × w × bande) ===')
    for mode in ('nonbull', 'neutral', 'always'):
        for w in (0.4, 0.5, 0.6, 0.75):
            for band in (0.02, 0.05, 0.10):
                r = run_window(X, reg, t0, t1, mode, w, band)
                r1 = run_window(X, reg, t0, half, mode, w, band)
                r2 = run_window(X, reg, half, t1, mode, w, band)
                print(f'{mode:8} w={w:.2f} band={band:.2f}  {fmt(r)}  | moitiés {r1["net"]:+.1f}/{r2["net"]:+.1f} (rebal {r1["alpha_rebal"]:+.1f}/{r2["alpha_rebal"]:+.1f})')
        print()
    print('— null (300 tirages) sur la meilleure case a priori (nonbull 0.5/0.05) :')
    r = run_window(X, reg, t0, t1, 'nonbull', 0.5, 0.05, nulls=300)
    print(f'  {fmt(r)}')
    print('— stress frais ×2 :')
    r = run_window(X, reg, t0, t1, 'nonbull', 0.5, 0.05, fee=FEE * 2)
    print(f'  {fmt(r)}')


if __name__ == '__main__':
    main()
