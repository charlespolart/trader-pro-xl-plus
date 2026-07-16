#!/usr/bin/env python3
"""xsection1 — étage UNIVERS COMPLET (survivorship-safe), machinerie
VECTORISÉE (606 colonnes × 1000 permutations : les boucles du pilote seraient
~50× trop lentes). Mêmes conventions et mêmes barres que le pilote
(protocole LOG.md) : signal au close t → poids sur r(t+1), 30 bps/côté sur le
notionnel tourné, null par RÉÉTIQUETAGE de colonnes, BH-FDR par famille.
  python3 xsection_u.py placebo | control | is [FAM] | quintiles
Parité exigée avant usage : mode `parity` = mêmes chiffres que le pilote
(xsection.py) sur les 20 colonnes du pilote, à 1e-9 près."""
import subprocess
import sys

import numpy as np

DB = 'postgres://tpx:tpx@localhost:5438/tpx'
IS_START = np.datetime64('2019-07-01').astype('datetime64[ms]').astype(np.int64)
IS_END = np.datetime64('2024-01-01').astype('datetime64[ms]').astype(np.int64)
OOS_END = np.datetime64('2026-07-01').astype('datetime64[ms]').astype(np.int64)
COST = 0.0030
WARMUP = 91
TOPQ = 0.30
MIN_ALIVE = 30          # univers : au moins 30 noms vivants pour trader le jour


def universe_symbols():
    q = ("COPY (SELECT symbol, count(*) FROM candles WHERE market='spot' AND interval='1d' "
         "AND symbol LIKE '%USDT' GROUP BY 1 HAVING count(*) >= 180 ORDER BY 1) TO STDOUT (FORMAT csv)")
    out = subprocess.run(['psql', DB, '-c', q], capture_output=True, text=True, check=True).stdout
    return [line.split(',')[0] for line in out.strip().split('\n')
            if line and line.split(',')[0] not in ('BTCUSDT', 'ETHUSDT')]


def load_panel(symbols):
    q = ("COPY (SELECT symbol, open_time, close FROM candles WHERE market='spot' AND "
         "interval='1d' AND symbol = ANY('{" + ','.join(symbols) + "}') "
         "ORDER BY symbol, open_time) TO STDOUT (FORMAT csv)")
    out = subprocess.run(['psql', DB, '-c', q], capture_output=True, text=True, check=True).stdout
    sidx = {s: i for i, s in enumerate(symbols)}
    rows = [line.split(',') for line in out.strip().split('\n') if line]
    ts_all = np.array(sorted(set(int(float(r[1])) for r in rows)), dtype=np.int64)
    tidx = {int(t): i for i, t in enumerate(ts_all)}
    P = np.full((len(ts_all), len(symbols)), np.nan)
    for s, t, c in rows:
        P[tidx[int(float(t))], sidx[s]] = float(c)
    return ts_all, P


def signal_matrix(P, fam, prm):
    lp = np.log(P)
    n = len(P)
    S = np.full_like(P, np.nan)
    if fam == 'MOM':
        J, skip = prm['J'], prm['S']
        if n > J + skip:
            # S[t] = lp[t−skip] − lp[t−skip−J]
            S[J + skip:] = lp[J:n - skip] - lp[:n - J - skip]
    elif fam == 'REV':
        J = prm['J']
        S[J:] = -(lp[J:] - lp[:n - J])
    elif fam == 'LOWVOL':
        r = np.diff(lp, axis=0)
        for t in range(30, n):
            S[t] = -np.nanstd(r[t - 30:t], axis=0, ddof=1)
    return S


def portfolio_fast(P, S, K, seg, kind='LS', perm=None, min_alive=MIN_ALIVE):
    """version vectorisée : poids constants entre rebalancements."""
    lp = np.log(P)
    n, na = P.shape
    r = np.vstack([np.zeros((1, na)), np.diff(lp, axis=0)])
    r = np.where(np.isfinite(r), r, 0.0)
    lo, hi = seg
    hist = np.isfinite(P).cumsum(axis=0)
    Su = S if perm is None else S[:, perm]
    out = np.zeros(hi - lo)
    w = np.zeros(na)
    rebals = range(lo, hi, K)
    for t in rebals:
        alive = np.isfinite(Su[t]) & np.isfinite(P[t]) & (hist[t] >= WARMUP)
        idx = np.flatnonzero(alive)
        neww = np.zeros(na)
        if len(idx) >= min_alive:
            ntop = max(1, int(round(len(idx) * TOPQ)))
            order = idx[np.argsort(Su[t][idx])]
            neww[order[-ntop:]] += 1.0 / ntop
            if kind == 'LS':
                neww[order[:ntop]] -= 1.0 / ntop
        i0 = t - lo
        out[i0] -= COST * np.abs(neww - w).sum()
        w = neww
        # rendements du bloc : jours t..min(t+K−1, hi−1), chacun payé par
        # r[jour+1] — le jour-frontière r[hi] compte (parité pilote exacte)
        j1 = t + 1
        j2 = min(t + K, hi, n - 1) + 1
        if j1 < j2:
            out[i0:i0 + (j2 - j1)] += r[j1:j2] @ w
    return out


def metrics(daily):
    mu, sd = daily.mean(), daily.std(ddof=1)
    sharpe = mu / sd * np.sqrt(365) if sd > 0 else np.nan
    eq = np.exp(np.cumsum(daily))
    peak = np.maximum.accumulate(eq)
    dd = float(((peak - eq) / peak).max()) * 100
    cagr = (eq[-1] ** (365 / len(daily)) - 1) * 100
    return dict(sharpe=float(sharpe), cagr=float(cagr), dd=dd)


def eval_config(P, S, K, seg, kind, nperm=1000, seed=7):
    real = portfolio_fast(P, S, K, seg, kind)
    m = metrics(real)
    rng = np.random.default_rng(seed)
    cnt = 0
    for _ in range(nperm):
        null = portfolio_fast(P, S, K, seg, kind, perm=rng.permutation(P.shape[1]))
        sd = null.std(ddof=1)
        s_null = null.mean() / sd * np.sqrt(365) if sd > 0 else -9
        if s_null >= m['sharpe']:
            cnt += 1
    m['p'] = np.nan if not np.isfinite(m['sharpe']) else (1 + cnt) / (1 + nperm)
    return m, real


GRID = ([('MOM', dict(J=J, S=s), K) for J in (7, 14, 30, 90) for s in (0, 2) for K in (2, 7)]
        + [('REV', dict(J=J), K) for J in (1, 3) for K in (1, 2)]
        + [('LOWVOL', dict(), K) for K in (7, 30)])


def bh_flags(ps, q=0.10):
    ps = np.asarray(ps, dtype=float)
    ok = np.isfinite(ps)
    flags = np.zeros(len(ps), bool)
    if not ok.sum():
        return flags
    sub = ps[ok]
    order = np.argsort(sub)
    kmax, m = 0, len(sub)
    for r_, oi in enumerate(order, 1):
        if sub[oi] <= q * r_ / m:
            kmax = r_
    if kmax:
        flags[ok] = ps[ok] <= sub[order[kmax - 1]]
    return flags


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'is'

    if mode == 'parity':
        # mêmes 20 colonnes que le pilote : chiffres identiques exigés
        from xsection import ALTS, load_panel as lp20, signals as sig20, run_portfolio as rp20
        ts, P = lp20()
        seg = (int(np.searchsorted(ts, IS_START)), int(np.searchsorted(ts, IS_END)))
        worst = 0.0
        for fam, prm, K in [('MOM', dict(J=30, S=0), 2), ('REV', dict(J=1), 1), ('LOWVOL', dict(), 7)]:
            S = sig20(P, fam, prm)
            for kind in ('LS', 'LO'):
                a = rp20(P, S, K, seg, kind)
                b = portfolio_fast(P, S, K, seg, kind, min_alive=10)
                worst = max(worst, float(np.abs(a - b).max()))
        print(f'parité pilote↔vectorisé : écart max {worst:.2e} → '
              f"{'OK' if worst < 1e-9 else 'ÉCHEC — ne pas utiliser'}")
        return

    syms = universe_symbols()
    ts, P = load_panel(syms)
    seg = (int(np.searchsorted(ts, IS_START)), int(np.searchsorted(ts, IS_END)))
    alive = (np.isfinite(P[seg[0]:seg[1]]).sum(axis=1))
    print(f'univers : {len(syms)} symboles ≥180 j ; vivants méd. IS = {int(np.median(alive))}')

    if mode == 'placebo':
        rng = np.random.default_rng(42)
        P2 = np.full_like(P, np.nan)
        for a in range(P.shape[1]):
            fin = np.where(np.isfinite(P[:, a]))[0]
            if len(fin) < 150:
                continue
            lpa = np.log(P[fin, a])
            sh = rng.permutation(np.diff(lpa))
            P2[fin, a] = np.exp(np.concatenate([[lpa[0]], lpa[0] + np.cumsum(sh)]))
        rows = []
        for fam, prm, K in GRID:
            S = signal_matrix(P2, fam, prm)
            for kind in ('LS', 'LO'):
                m, _ = eval_config(P2, S, K, seg, kind, nperm=200)
                rows.append(m['p'])
        ps = [p for p in rows if np.isfinite(p)]
        hit = sum(1 for p in ps if p < 0.01)
        print(f'PLACEBO UNIVERS : {hit}/{len(ps)} à p<0,01 = {hit / len(ps) * 100:.1f}% (toléré ≤3%) → '
              f"{'OK' if hit <= 0.03 * len(ps) else 'ALERTE — STOP'}")
        return

    if mode == 'is':
        rows = []
        for fam, prm, K in GRID:
            S = signal_matrix(P, fam, prm)
            for kind in ('LS', 'LO'):
                m, _ = eval_config(P, S, K, seg, kind)
                rows.append(dict(fam=fam, prm=prm, K=K, kind=kind, **m))
        print('\n=== IS UNIVERS COMPLET (net 30 bps/côté, null réétiquetage) ===')
        for fam in sorted(set(r['fam'] for r in rows)):
            sub = [r for r in rows if r['fam'] == fam]
            flags = bh_flags([r['p'] for r in sub])
            for r_, f in zip(sub, flags):
                tag = ' ← BH' if f and r_['sharpe'] > 0 else ''
                pl = ','.join(f'{k}{v}' for k, v in r_['prm'].items())
                print(f"{fam:6s} {pl:8s} K{r_['K']} {r_['kind']:2s} | Sharpe {r_['sharpe']:+5.2f} "
                      f"CAGR {r_['cagr']:+7.1f}% DD {r_['dd']:5.1f}% p={r_['p']:.4f}{tag}")
        return

    if mode == 'quintiles':
        # monotonie du MOM 30 (critère 3) : 5 paniers par rang
        S = signal_matrix(P, 'MOM', dict(J=30, S=0))
        lp = np.log(P)
        n, na = P.shape
        r = np.where(np.isfinite(np.vstack([np.zeros((1, na)), np.diff(lp, axis=0)])),
                     np.vstack([np.zeros((1, na)), np.diff(lp, axis=0)]), 0.0)
        hist = np.isfinite(P).cumsum(axis=0)
        qrets = [[] for _ in range(5)]
        for t in range(seg[0], seg[1], 2):
            idx = np.flatnonzero(np.isfinite(S[t]) & np.isfinite(P[t]) & (hist[t] >= WARMUP))
            if len(idx) < MIN_ALIVE:
                continue
            order = idx[np.argsort(S[t][idx])]
            cuts = np.array_split(order, 5)
            j2 = min(t + 2, seg[1] - 1) + 1
            for qi, cut in enumerate(cuts):
                if len(cut) and t + 1 < j2:
                    qrets[qi].append(float(r[t + 1:j2, cut].mean() * (j2 - t - 1)))
        print('quintiles MOM30 (bas→haut), moyenne par période de 2 j en bps :')
        for qi, v in enumerate(qrets):
            print(f'  Q{qi + 1}: {np.mean(v) * 1e4:+7.1f} bps (n={len(v)})')
        return


if __name__ == '__main__':
    main()
