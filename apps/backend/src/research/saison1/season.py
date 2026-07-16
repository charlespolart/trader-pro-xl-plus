#!/usr/bin/env python3
"""saison1 — F1 heure-du-jour & F2 jour-de-semaine, IS 2018-01→2024-01
(protocole + amendement null committés AVANT). Null : décalage circulaire
global (1000 tirages) ; BH-FDR 10 % par famille ; barre d'exploitation :
net de 30 bps/côté par cycle.  python3 season.py [placebo]"""
import subprocess
import sys

import numpy as np

DB = 'postgres://tpx:tpx@localhost:5438/tpx'
IS_A = np.datetime64('2018-01-01').astype('datetime64[ms]').astype(np.int64)
IS_B = np.datetime64('2024-01-01').astype('datetime64[ms]').astype(np.int64)
HOUR = 3_600_000
COST_CYCLE = 0.0060          # 30 bps/côté, un cycle = entrée + sortie


def load_1h(symbol):
    q = (f"COPY (SELECT open_time, close FROM candles WHERE market='spot' AND symbol='{symbol}' "
         f"AND interval='1h' AND open_time >= {IS_A - HOUR} AND open_time < {IS_B} "
         "ORDER BY open_time) TO STDOUT (FORMAT csv)")
    out = subprocess.run(['psql', DB, '-c', q], capture_output=True, text=True, check=True).stdout
    rows = [line.split(',') for line in out.strip().split('\n') if line]
    ts = np.array([int(float(a)) for a, _ in rows], dtype=np.int64)
    px = np.array([float(b) for _, b in rows])
    r = np.diff(np.log(px))
    return ts[1:], r          # r[i] = rendement de l'heure finissant à ts[i]+1h


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
        if rank <= thresh:
            flags[i] = True
    return flags


def family(ts, r, labels_of, ncell, period_h, rng, nperm=1000):
    """moyennes par cellule + p par rotation circulaire du VECTEUR de
    rendements (amendement 2 : ~n décalages distincts, étiquettes fixes)."""
    lab = labels_of(ts)
    cells = [lab == c for c in range(ncell)]
    real = np.array([r[m].mean() for m in cells])
    hits = np.zeros(ncell)
    n = len(r)
    drawn = 0
    while drawn < nperm:
        k = int(rng.integers(24, n - 24))
        if k % period_h == 0:
            continue
        null_r = np.roll(r, k)
        null = np.array([null_r[m].mean() for m in cells])
        hits += np.abs(null) >= np.abs(real)
        drawn += 1
    ps = (1 + hits) / (1 + nperm)
    return real, ps


def hour_of(ts):
    return ((ts // HOUR) % 24).astype(int)


def dow_of(ts):
    return (((ts // (24 * HOUR)) + 3) % 7).astype(int)   # 1970-01-01 = jeudi → lundi=0


DOW = ('lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim')


def main():
    placebo = len(sys.argv) > 1 and sys.argv[1] == 'placebo'
    rng = np.random.default_rng(7)
    tot_flags, tot_cells = 0, 0
    for sym in ('BTCUSDT', 'ETHUSDT'):
        ts, r = load_1h(sym)
        if placebo:
            r = rng.permutation(r)
        print(f'\n=== {sym} 1h, IS 2018→2024 ({len(r)} heures){" — PLACEBO iid" if placebo else ""} ===')
        for fam, labels_of, ncell, period in (('F1 heure', hour_of, 24, 24),
                                              ('F2 jour', dow_of, 7, 168)):
            real, ps = family(ts, r, labels_of, ncell, period, rng)
            flags = bh_flags(ps)
            tot_flags += int(flags.sum())
            tot_cells += ncell
            per_h = 24 / ncell if fam.startswith('F2') else 1   # F2 : cellule = 24 h
            keep = [(c, real[c], ps[c]) for c in range(ncell) if flags[c]]
            print(f'{fam} : {int(flags.sum())}/{ncell} cellules BH', end='')
            if not keep:
                print(' — rien')
                continue
            print()
            for c, mu, p in sorted(keep, key=lambda x: -abs(x[1])):
                name = DOW[c] if ncell == 7 else f'{c:02d}h'
                cyc = mu * per_h * 24 / per_h    # rendement par occurrence de cellule
                net = abs(mu) * (24 if ncell == 7 else 1) - COST_CYCLE
                print(f'   {name} : {mu * 1e4:+6.2f} bps/h (p={p:.4f}) — net/cycle '
                      f'{net * 1e4:+7.1f} bps → {"EXPLOITABLE ?" if net > 0 else "mort en taker"}')
    if placebo:
        print(f'\nPLACEBO : {tot_flags}/{tot_cells} cellules BH (attendu ~0)')


if __name__ == '__main__':
    main()
