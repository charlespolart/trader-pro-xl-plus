#!/usr/bin/env python3
# accum3 famille A : ROTATION CROSS-SECTION alt/BTC — généralisation de X2.
# Détenir BTC par défaut ; n'acheter un alt (payé en BTC) que si son momentum
# vs BTC est positif et parmi les meilleurs de l'univers POINT-IN-TIME.
# L'univers = TOUTES les paires */BTC ayant jamais existé sur Binance (délistées
# comprises) filtrées par une règle de liquidité observable au temps t —
# zéro biais du survivant. En bear, aucun alt n'a de momentum > 0 vs BTC
# → 100% BTC structurellement.
# Séparation des effets : (1) benchmark basket eqw top-vol (beta alt pur),
# (2) null sélection aléatoire parmi les éligibles (le ranking apporte-t-il
# quelque chose ?), (3) null parmi momentum>0 (le gate ou le rank ?).
#   python3 rotation.py            # grille IS
#   python3 rotation.py breadth    # exporte les séries de breadth (famille C)
#   python3 rotation.py oos        # OOS 2024→2026 (config figée, une passe)
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import DB, IS_END, IS_START, OOS_END, SCRATCH

DAY = 86400000
FEE = 0.0015
DELIST_PEN = 0.005  # sortie forcée sur délisting : 0,5% de pénalité


def load_matrix():
    """closes/vol BTC de toutes les paires *BTC sur une grille quotidienne."""
    cache = os.path.join(SCRATCH, 'rotation_matrix.npz')
    if os.path.exists(cache):
        z = np.load(cache, allow_pickle=True)
        return list(z['pairs']), z['days'], z['P'], z['V']
    sql = ("COPY (SELECT symbol, open_time/86400000, close, GREATEST(quote_volume, volume*close) "
           "FROM candles WHERE market='spot' AND interval='1d' AND symbol LIKE '%BTC' "
           "ORDER BY symbol, open_time) TO STDOUT WITH (FORMAT csv)")
    p = subprocess.run(['psql', DB, '-q', '-c', sql], capture_output=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode()[:300])
    lines = p.stdout.decode().splitlines()
    pairs: list[str] = []
    idx: dict[str, int] = {}
    rows = []
    for ln in lines:
        s, d, c, v = ln.split(',')
        if s not in idx:
            idx[s] = len(pairs)
            pairs.append(s)
        rows.append((idx[s], int(d), float(c), float(v)))
    a = np.array(rows, dtype=float)
    d0, d1 = int(a[:, 1].min()), int(a[:, 1].max())
    days = np.arange(d0, d1 + 1)
    P = np.full((len(pairs), len(days)), np.nan)
    V = np.full((len(pairs), len(days)), np.nan)
    pi = a[:, 0].astype(int)
    di = a[:, 1].astype(int) - d0
    P[pi, di] = a[:, 2]
    V[pi, di] = a[:, 3]
    np.savez_compressed(cache, pairs=np.array(pairs), days=days, P=P, V=V)
    return pairs, days, P, V


def eligibility(P, V, volfloor: float, min_hist: int = 90):
    """Éligible à t : coté à t, ≥min_hist jours d'historique, volume BTC médian
    30j ≥ volfloor. Tout est observable à t (point-in-time)."""
    n_p, n_d = P.shape
    listed = np.isfinite(P)
    hist = np.zeros_like(P, dtype=bool)
    first = np.full(n_p, -1)
    for i in range(n_p):
        w = np.where(listed[i])[0]
        if len(w):
            first[i] = w[0]
            hist[i, min(w[0] + min_hist, n_d - 1):] = True
    # volume médian 30j (fenêtre finissant à t)
    Vf = np.where(np.isfinite(V), V, 0.0)
    med30 = np.full_like(P, 0.0)
    from numpy.lib.stride_tricks import sliding_window_view as swv
    if n_d >= 30:
        m = np.median(swv(Vf, 30, axis=1), axis=2)
        med30[:, 29:] = m
    return listed & hist & (med30 >= volfloor)


def momentum(P, k: int, skip: int = 0):
    M = np.full_like(P, np.nan)
    if skip:
        M[:, k + skip:] = P[:, skip:-k] / P[:, : -k - skip] - 1
        # mom = c[t-skip]/c[t-skip-k] - 1
        M2 = np.full_like(P, np.nan)
        M2[:, k + skip:] = P[:, k: -skip if skip else None] / P[:, :-k - skip] - 1
        M = M2
    else:
        M[:, k:] = P[:, k:] / P[:, :-k] - 1
    return M


def run(pairs, days, P, V, elig, M, t0d, t1d, K=2, rebal=7, fee=FEE,
        selector='rank', seed=0, gate_pos=True):
    """selector: 'rank' (top-K momentum), 'random_elig', 'random_pos', 'basket'
    (top-K par volume, sans gate momentum). Renvoie métriques en BTC."""
    rng = np.random.default_rng(seed)
    d_idx = np.where((days >= t0d) & (days < t1d))[0]
    cash = 1.0  # BTC
    units: dict[int, float] = {}
    eq = []
    trades = 0
    turnover = 0.0
    delist_hits = 0
    for j, t in enumerate(d_idx):
        # valorisation (dernier close connu pour les délistés)
        v = cash
        dead = []
        for pidx, u in units.items():
            if np.isfinite(P[pidx, t]):
                v += u * P[pidx, t]
            else:
                px = P[pidx, : t][np.isfinite(P[pidx, : t])]
                px = px[-1] if len(px) else 0.0
                v += u * px * (1 - DELIST_PEN)
                dead.append((pidx, px))
        for pidx, px in dead:  # délisting : sortie forcée immédiate
            cash += units.pop(pidx) * px * (1 - DELIST_PEN) * (1 - fee)
            trades += 1
            delist_hits += 1
        eq.append(v)
        if j % rebal != 0:
            continue
        el = np.where(elig[:, t])[0]
        if selector == 'basket':
            cand = el[np.argsort(-V[el, t])][:K]
        else:
            m = M[el, t]
            ok = np.isfinite(m) & ((m > 0) if gate_pos else np.ones_like(m, dtype=bool))
            pool = el[ok]
            if selector == 'rank':
                cand = pool[np.argsort(-M[pool, t])][:K]
            elif selector == 'random_pos':
                cand = rng.choice(pool, size=min(K, len(pool)), replace=False) if len(pool) else np.array([], dtype=int)
            elif selector == 'random_elig':
                cand = rng.choice(el, size=min(K, len(el)), replace=False) if len(el) else np.array([], dtype=int)
            else:
                raise ValueError(selector)
        tgt = set(int(x) for x in cand)
        # vendre ce qui sort
        for pidx in [p_ for p_ in units if p_ not in tgt]:
            px = P[pidx, t]
            if not np.isfinite(px):
                continue
            got = units.pop(pidx) * px
            cash += got * (1 - fee)
            turnover += got
            trades += 1
        # valeur cible par slot = V/K ; acheter/ajuster ce qui entre
        v_now = cash + sum(u * P[p_, t] for p_, u in units.items() if np.isfinite(P[p_, t]))
        per_slot = v_now / K if K else 0.0
        for pidx in tgt:
            px = P[pidx, t]
            if not np.isfinite(px):
                continue
            cur = units.get(pidx, 0.0) * px
            delta = per_slot - cur
            if abs(delta) < 0.02 * per_slot:
                continue
            if delta > 0:
                spend = min(delta, cash)
                if spend <= 0:
                    continue
                units[pidx] = units.get(pidx, 0.0) + spend * (1 - fee) / px
                cash -= spend
            else:
                sell_btc = -delta
                units[pidx] -= sell_btc / px
                cash += sell_btc * (1 - fee)
            turnover += abs(delta)
            trades += 1
    eq = np.array(eq)
    peak = np.maximum.accumulate(eq)
    dd = float(((eq - peak) / peak).min()) if len(eq) else 0.0
    inbtc = 1.0 - np.mean([min(1.0, sum(u * P[p_, min(t, P.shape[1]-1)] for p_, u in units.items() if np.isfinite(P[p_, t])) / e) for t, e in zip(d_idx, eq)]) if len(eq) else 1.0
    return {
        'net': (eq[-1] - 1) * 100 if len(eq) else 0.0, 'dd': dd * 100,
        'trades': trades, 'turnover': turnover, 'delist': delist_hits,
        'eq': eq, 'days': days[d_idx],
    }


def yearly(res):
    eq, ds = res['eq'], res['days']
    out = []
    years = ((ds * DAY).astype('datetime64[ms]').astype('datetime64[Y]')).astype(int) + 1970
    for y in np.unique(years):
        m = years == y
        seg = eq[m]
        if len(seg) > 1:
            out.append(f'{y}:{(seg[-1]/seg[0]-1)*100:+.0f}%')
    return ' '.join(out)


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'grid'
    pairs, days, P, V = load_matrix()
    print(f'{len(pairs)} paires, {len(days)} jours ({days[0]} → {days[-1]})')
    if mode == 'breadth':
        elig = eligibility(P, V, volfloor=5.0)
        from numpy.lib.stride_tricks import sliding_window_view as swv
        Pf = np.where(np.isfinite(P), P, 0.0)
        ma50 = np.full_like(P, np.nan)
        ma50[:, 49:] = swv(Pf, 50, axis=1).mean(axis=2)
        above = (P > ma50) & elig
        nel = elig.sum(axis=0).astype(float)
        breadth = np.where(nel >= 10, above.sum(axis=0) / np.maximum(nel, 1), np.nan)
        mom30 = np.full_like(P, np.nan)
        mom30[:, 30:] = P[:, 30:] / P[:, :-30] - 1
        posmom = np.where(nel >= 10, ((mom30 > 0) & elig).sum(axis=0) / np.maximum(nel, 1), np.nan)
        out = os.path.join(SCRATCH, 'breadth.npz')
        np.savez_compressed(out, days=days, breadth=breadth, posmom=posmom, nelig=nel)
        print(f'→ {out} (breadth MA50 + %mom30>0, plancher 10 éligibles)')
        return
    t0d, t1d = IS_START // DAY, IS_END // DAY
    if mode == 'oos':
        t0d, t1d = IS_END // DAY, OOS_END // DAY
        print('=== OOS 2024-01→2026-07 (config figée, une passe) ===')
        elig = eligibility(P, V, volfloor=5.0)
        M = momentum(P, 60)
        for K in (2,):
            r = run(pairs, days, P, V, elig, M, t0d, t1d, K=K, rebal=7)
            print(f"rank K={K} mom60 reb7  net {r['net']:+8.1f}%  DD {r['dd']:+.1f}%  {r['trades']}tr  delist {r['delist']}  | {yearly(r)}")
        return
    half = (IS_START // DAY + IS_END // DAY) // 2
    print('=== IS 2018-04→2024-01 : grille momentum × K × rebal (volfloor 5 BTC/j) ===')
    elig = eligibility(P, V, volfloor=5.0)
    nel = elig.sum(axis=0)
    sel = (days >= t0d) & (days < t1d)
    print(f'éligibles: méd {np.median(nel[sel]):.0f} min {nel[sel].min()} max {nel[sel].max()}')
    for k in (15, 30, 60, 90):
        M = momentum(P, k)
        for K in (1, 2, 3):
            for rebal in (7,):
                r = run(pairs, days, P, V, elig, M, t0d, t1d, K=K, rebal=rebal)
                r1 = run(pairs, days, P, V, elig, M, t0d, half, K=K, rebal=rebal)
                r2 = run(pairs, days, P, V, elig, M, half, t1d, K=K, rebal=rebal)
                print(f"mom{k:3d} K={K} reb{rebal}  net {r['net']:+8.1f}%  DD {r['dd']:+6.1f}%  {r['trades']:4d}tr  "
                      f"delist {r['delist']:2d}  moitiés {r1['net']:+7.1f}/{r2['net']:+7.1f}  | {yearly(r)}")
        print()
    print('— benchmarks & nulls (mom60, K=2, reb7) :')
    M = momentum(P, 60)
    b = run(pairs, days, P, V, elig, M, t0d, t1d, K=2, rebal=7, selector='basket')
    print(f"  basket top-vol (beta alt pur)   net {b['net']:+8.1f}%  DD {b['dd']:+.1f}%  | {yearly(b)}")
    for sel_name in ('random_pos', 'random_elig'):
        nets = []
        for s in range(60):
            rr = run(pairs, days, P, V, elig, M, t0d, t1d, K=2, rebal=7, selector=sel_name, seed=s)
            nets.append(rr['net'])
        nets = np.array(nets)
        print(f'  null {sel_name:12}  méd {np.median(nets):+8.1f}%  p95 {np.quantile(nets, 0.95):+8.1f}%')
    print('— stress frais ×2 (mom60 K=2) :')
    r = run(pairs, days, P, V, elig, M, t0d, t1d, K=2, rebal=7, fee=FEE * 2)
    print(f"  net {r['net']:+8.1f}%  DD {r['dd']:+.1f}%")
    print('— volfloor 20 BTC/j (liquidité stricte, mom60 K=2) :')
    elig20 = eligibility(P, V, volfloor=20.0)
    r = run(pairs, days, P, V, elig20, M, t0d, t1d, K=2, rebal=7)
    print(f"  net {r['net']:+8.1f}%  DD {r['dd']:+.1f}%  | {yearly(r)}")


if __name__ == '__main__':
    main()
