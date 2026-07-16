#!/usr/bin/env python3
"""saison1 — F3 fenêtres de funding (perp, conditionné au signe) + F4
sessions + CONTRÔLE POSITIF (corr funding ↔ basis 8 h précédentes, effet
mécanique par définition du funding). Null : rotation du vecteur (amend. 2).
  python3 f3f4.py"""
import subprocess

import numpy as np

DB = 'postgres://tpx:tpx@localhost:5438/tpx'
HOUR = 3_600_000
A = np.datetime64('2019-09-01').astype('datetime64[ms]').astype(np.int64)
B = np.datetime64('2024-01-01').astype('datetime64[ms]').astype(np.int64)
COST_CYCLE_BPS = 60.0


def load_1h(symbol, market):
    q = (f"COPY (SELECT open_time, close FROM candles WHERE market='{market}' AND symbol='{symbol}' "
         f"AND interval='1h' AND open_time >= {A} AND open_time < {B} "
         "ORDER BY open_time) TO STDOUT (FORMAT csv)")
    out = subprocess.run(['psql', DB, '-c', q], capture_output=True, text=True, check=True).stdout
    rows = [line.split(',') for line in out.strip().split('\n') if line]
    ts = np.array([int(float(a)) for a, _ in rows], dtype=np.int64)
    px = np.array([float(b) for _, b in rows])
    return ts, px


def load_funding(symbol):
    ev = []
    with open('funding_events.csv') as f:
        for line in f:
            s, t, r = line.strip().split(',')
            if s == symbol:
                ev.append((int(float(t)), float(r)))
    return [(t, r) for t, r in ev if A <= t < B]


def pvals_rotation(r_vec, masks, real, rng, nperm=1000, forbid_mod=8):
    hits = np.zeros(len(masks))
    n = len(r_vec)
    drawn = 0
    while drawn < nperm:
        k = int(rng.integers(24, n - 24))
        if k % forbid_mod == 0:
            continue
        null_r = np.roll(r_vec, k)
        null = np.array([null_r[m].mean() if m.any() else 0.0 for m in masks])
        hits += np.abs(null) >= np.abs(real)
        drawn += 1
    return (1 + hits) / (1 + nperm)


def bh_flags(ps, q=0.10):
    ps = np.asarray(ps)
    order = np.argsort(ps)
    m = len(ps)
    flags = np.zeros(m, bool)
    thresh = 0
    for rank, i in enumerate(order, 1):
        if ps[i] <= q * rank / m:
            thresh = rank
    for rank, i in enumerate(order, 1):
        flags[i] = rank <= thresh
    return flags


def main():
    rng = np.random.default_rng(7)
    print('=== saison1 F3/F4 — IS 2019-09→2024-01 (couverture perp 1h) ===')
    all_ps, all_lbl, all_mu = [], [], []
    for sym in ('BTCUSDT', 'ETHUSDT'):
        ts_s, px_s = load_1h(sym, 'spot')
        ts_p, px_p = load_1h(sym, 'futures')
        common = np.intersect1d(ts_s, ts_p)
        i_s = np.searchsorted(ts_s, common)
        i_p = np.searchsorted(ts_p, common)
        ps_, pp_ = px_s[i_s], px_p[i_p]
        basis = np.log(pp_ / ps_)
        r_perp = np.concatenate([[0.0], np.diff(np.log(pp_))])
        ev = load_funding(sym)
        tidx = {int(t): i for i, t in enumerate(common)}

        # CONTRÔLE POSITIF : funding_t ↔ basis moyenne des 8 h précédentes
        f_r, b_m = [], []
        for t, rate in ev:
            i = tidx.get(int(t))
            if i is None or i < 8:
                continue
            f_r.append(rate)
            b_m.append(basis[i - 8:i].mean())
        cc = np.corrcoef(f_r, b_m)[0, 1]
        print(f'\n{sym} : contrôle positif corr(funding, basis 8 h préc.) = {cc:+.2f} '
              f"({len(f_r)} évts) → {'RETROUVÉ ✓' if cc > 0.3 else 'NON RETROUVÉ — STOP'}")
        if cc <= 0.3:
            continue

        # F3 : heure pré [T-1h,T] et post [T,T+1h] sur le PERP, par signe
        masks = {('pré', '+'): np.zeros(len(common), bool), ('pré', '−'): np.zeros(len(common), bool),
                 ('post', '+'): np.zeros(len(common), bool), ('post', '−'): np.zeros(len(common), bool)}
        for t, rate in ev:
            i = tidx.get(int(t))
            if i is None or i < 1 or i + 1 >= len(common):
                continue
            sgn = '+' if rate > 0 else '−'
            masks[('pré', sgn)][i] = True          # r_perp[i] = heure finissant à t
            masks[('post', sgn)][i + 1] = True
        mlist = list(masks.values())
        real = np.array([r_perp[m].mean() for m in mlist])
        pv = pvals_rotation(r_perp, mlist, real, rng)
        for (lab, sgn), mu, p in zip(masks.keys(), real, pv):
            all_ps.append(p)
            all_lbl.append(f'F3 {sym[:3]} {lab} funding{sgn}')
            all_mu.append(mu)

        # F4 sessions (sur le spot, comme F1/F2 — grille protocole)
        hr = ((common // HOUR) % 24).astype(int)
        r_spot = np.concatenate([[0.0], np.diff(np.log(ps_))])
        sess = {'Asie 00-08': (hr >= 0) & (hr < 8), 'EU 07-16': (hr >= 7) & (hr < 16),
                'US 13-22': (hr >= 13) & (hr < 22)}
        mlist4 = list(sess.values())
        real4 = np.array([r_spot[m].mean() for m in mlist4])
        pv4 = pvals_rotation(r_spot, mlist4, real4, rng, forbid_mod=24)
        for nm, mu, p in zip(sess.keys(), real4, pv4):
            all_ps.append(p)
            all_lbl.append(f'F4 {sym[:3]} {nm}')
            all_mu.append(mu)

    flags = bh_flags(all_ps)
    print(f'\n=== BH-FDR 10 % sur {len(all_ps)} cellules F3+F4 : {int(flags.sum())} retenue(s) ===')
    for lbl, mu, p, f in zip(all_lbl, all_mu, all_ps, flags):
        occ_h = 1
        net = abs(mu) * 1e4 * occ_h - COST_CYCLE_BPS
        tag = ' ← BH' if f else ''
        print(f'  {lbl:26s} {mu * 1e4:+7.2f} bps/h  p={p:.4f}  net/cycle {net:+6.1f} bps{tag}')


if __name__ == '__main__':
    main()
