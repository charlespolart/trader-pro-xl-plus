#!/usr/bin/env python3
"""xsection1 — machinerie coupe alts USDT (protocole LOG.md, committé avant).
  python3 xsection.py placebo | control | is | oos
Conventions : signal au close t → poids effectifs sur r(t+1) (lag 1 jour,
open+1 conservateur) ; coûts 30 bps/côté sur |Δw| ; jambes équipondérées."""
import subprocess
import sys

import numpy as np

DB = 'postgres://tpx:tpx@localhost:5438/tpx'
ALTS = ['BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT',
        'DOTUSDT', 'LTCUSDT', 'MATICUSDT', 'ATOMUSDT', 'UNIUSDT', 'NEARUSDT', 'FILUSDT',
        'ETCUSDT', 'XLMUSDT', 'ALGOUSDT', 'VETUSDT', 'TRXUSDT', 'EOSUSDT']
IS_START = np.datetime64('2019-07-01').astype('datetime64[ms]').astype(np.int64)
IS_END = np.datetime64('2024-01-01').astype('datetime64[ms]').astype(np.int64)
OOS_END = np.datetime64('2026-07-01').astype('datetime64[ms]').astype(np.int64)
COST = 0.0030          # 30 bps par côté sur le notionnel tourné
WARMUP = 91
TOPQ = 0.30


def load_panel():
    """matrice closes [jours, actifs] sur grille 1d commune."""
    cols = {}
    for s in ALTS:
        q = (f"COPY (SELECT open_time, close FROM candles WHERE market='spot' AND "
             f"symbol='{s}' AND interval='1d' ORDER BY open_time) TO STDOUT (FORMAT csv)")
        out = subprocess.run(['psql', DB, '-c', q], capture_output=True, text=True, check=True).stdout
        rows = [line.split(',') for line in out.strip().split('\n') if line]
        cols[s] = {int(float(r[0])): float(r[1]) for r in rows}
    t0 = min(min(c) for c in cols.values() if c)
    t1 = max(max(c) for c in cols.values() if c)
    ts = np.arange(t0, t1 + 1, 86_400_000, dtype=np.int64)
    P = np.full((len(ts), len(ALTS)), np.nan)
    for a, s in enumerate(ALTS):
        for i, t in enumerate(ts):
            if t in cols[s]:
                P[i, a] = cols[s][t]
    return ts, P


def signals(P, fam, prm):
    """matrice signal [jours, actifs] (NaN = pas de signal)."""
    lp = np.log(P)
    n = len(P)
    S = np.full_like(P, np.nan)
    if fam == 'MOM':
        J, skip = prm['J'], prm['S']
        for t in range(J + skip, n):
            S[t] = lp[t - skip] - lp[t - skip - J]
    elif fam == 'REV':
        J = prm['J']
        for t in range(J, n):
            S[t] = -(lp[t] - lp[t - J])
    elif fam == 'LOWVOL':
        r = np.diff(lp, axis=0)
        for t in range(30, n):
            S[t] = -np.nanstd(r[t - 30:t], axis=0, ddof=1)
    elif fam == 'CARRY':
        S = prm['carry']
    return S


def run_portfolio(P, S, K, seg, kind='LS', rng_null=None):
    """rendement quotidien net ; poids décidés au close t, effectifs sur
    r(t+1) ; rebalancement tous les K jours. (rng_null : ancien null par
    rangs — CONDAMNÉ par le placebo : turnover maximal → anti-conservateur ;
    conservé pour trace, le null officiel est le réétiquetage de colonnes.)"""
    lp = np.log(P)
    r = np.vstack([np.zeros((1, P.shape[1])), np.diff(lp, axis=0)])  # r[t] = close t-1→t
    lo, hi = seg
    w = np.zeros(P.shape[1])
    out = np.zeros(hi - lo)
    hist = np.isfinite(P).cumsum(axis=0)
    for i, t in enumerate(range(lo, hi)):
        if (t - lo) % K == 0:
            alive = np.where(np.isfinite(S[t]) & np.isfinite(P[t]) & (hist[t] >= WARMUP))[0]
            neww = np.zeros_like(w)
            if len(alive) >= 10:
                ntop = max(1, int(round(len(alive) * TOPQ)))
                if rng_null is not None:
                    order = rng_null.permutation(alive)
                else:
                    order = alive[np.argsort(S[t][alive])]  # croissant
                bot, top = order[:ntop], order[-ntop:]
                neww[top] += 1.0 / ntop
                if kind == 'LS':
                    neww[bot] -= 1.0 / ntop
            cost = COST * np.abs(neww - w).sum()
            w = neww
            out[i] -= cost
        nxt = t + 1
        if nxt < len(r):
            ret = np.where(np.isfinite(r[nxt]), r[nxt], 0.0)
            out[i] += float(w @ ret)
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
    """null par RÉÉTIQUETAGE : une permutation de colonnes du SIGNAL par
    tirage — chaque actif reçoit la trajectoire de signal d'un autre. La
    persistance (donc le turnover et les coûts) est préservée, l'alignement
    coupe↔rendements est détruit. (Amendement 2026-07-15 après que le placebo
    a condamné le null par rangs re-tirés — consigné au LOG.)"""
    real = run_portfolio(P, S, K, seg, kind)
    m = metrics(real)
    rng = np.random.default_rng(seed)
    cnt = 0
    for _ in range(nperm):
        perm = rng.permutation(S.shape[1])
        null = run_portfolio(P, S[:, perm], K, seg, kind)
        sd = null.std(ddof=1)
        s_null = null.mean() / sd * np.sqrt(365) if sd > 0 else -9
        if s_null >= m['sharpe']:
            cnt += 1
    m['p'] = np.nan if not np.isfinite(m['sharpe']) else (1 + cnt) / (1 + nperm)
    m['daily'] = real
    return m


GRID = ([('MOM', dict(J=J, S=s), K) for J in (7, 14, 30, 90) for s in (0, 2) for K in (2, 7)]
        + [('REV', dict(J=J), K) for J in (1, 3) for K in (1, 2)]
        + [('LOWVOL', dict(), K) for K in (7, 30)]
        + [('CARRY', dict(), K) for K in (2, 7)])


def carry_signal(ts):
    """signal CARRY contrarien : −funding cumulé 7 j (funding haut = longs
    surpeuplés). Événements 8 h, causal : t_evt ≤ close du jour."""
    import os
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'funding20.csv')
    if not os.path.exists(path):
        return None
    by = {s: ([], []) for s in ALTS}
    with open(path) as f:
        for line in f:
            s, t, r = line.strip().split(',')
            if s in by:
                by[s][0].append(int(t))
                by[s][1].append(float(r))
    S = np.full((len(ts), len(ALTS)), np.nan)
    day_close = ts + 86_400_000 - 1
    for a, s in enumerate(ALTS):
        tt = np.array(by[s][0], dtype=np.int64)
        rr = np.array(by[s][1])
        if len(tt) < 30:
            continue
        cum = np.concatenate([[0.0], np.cumsum(rr)])
        hi = np.searchsorted(tt, day_close, side='right')
        lo = np.searchsorted(tt, day_close - 7 * 86_400_000, side='right')
        vals = cum[hi] - cum[lo]
        vals[hi <= lo] = np.nan
        vals[hi < 21] = np.nan          # ≥ 21 événements vus (7 j pleins)
        S[:, a] = -vals
    return S


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


def seg_of(ts, a, b):
    return (int(np.searchsorted(ts, a)), int(np.searchsorted(ts, b)))


def sweep(ts, P, seg, nperm, label):
    rows = []
    carry = carry_signal(ts)
    for fam, prm, K in GRID:
        if fam == 'CARRY':
            if carry is None:
                continue
            prm = dict(carry=carry)
        S = signals(P, fam, prm)
        for kind in ('LS', 'LO'):
            m = eval_config(P, S, K, seg, kind, nperm=nperm)
            rows.append(dict(fam=fam, prm=prm, K=K, kind=kind, **{k: v for k, v in m.items() if k != 'daily'}))
    print(f'\n=== {label} ===')
    fams = sorted(set(r['fam'] for r in rows))
    for fam in fams:
        sub = [r for r in rows if r['fam'] == fam]
        flags = bh_flags([r['p'] for r in sub])
        for r_, f in zip(sub, flags):
            r_['bh'] = bool(f)
        for r_ in sub:
            tag = ' ← BH' if r_['bh'] and r_['sharpe'] > 0 else ''
            pl = ','.join(f'{k}{v}' for k, v in r_['prm'].items() if not hasattr(v, 'shape'))
            print(f"{fam:6s} {pl:8s} K{r_['K']} {r_['kind']:2s} | Sharpe {r_['sharpe']:+5.2f} "
                  f"CAGR {r_['cagr']:+7.1f}% DD {r_['dd']:5.1f}% p={r_['p']:.4f}{tag}")
    return rows


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'is'

    if mode in ('placebo', 'control'):
        ts, P = load_panel()
        lp = np.log(P)
        r = np.diff(lp, axis=0)
        rng = np.random.default_rng(42)
        # mélange JOUR PAR JOUR PAR ACTIF (placebo machinerie : détruit TOUTE
        # structure — les blocs 30 j laissaient fuir le momentum court intra-
        # bloc, attrapé par le placebo v2 à 10,4 %) ; reconstruit depuis la
        # PREMIÈRE cote de chaque actif (bug jour-0 attrapé par le placebo v1)
        P2 = np.full_like(P, np.nan)
        for a in range(P.shape[1]):
            fin = np.where(np.isfinite(P[:, a]))[0]
            if len(fin) < 150:
                continue
            lpa = np.log(P[fin, a])
            vals = np.diff(lpa)
            sh = rng.permutation(vals)
            P2[fin, a] = np.exp(np.concatenate([[lpa[0]], lpa[0] + np.cumsum(sh)]))
        if mode == 'control':
            # facteur PLANTÉ : +60 bps/j sur 4 actifs listés dès 2019 (courbe de puissance : 20→31% slots, 40→p 0,057)
            # (v1 : +20 bps/j sur SOL/AVAX/LTC/NEAR — 3 listent fin 2020 et
            # l'ampleur était sous le bruit de rang des alts mélangés → 31 %
            # des slots seulement ; contrôle redessiné, consigné au LOG)
            drift = np.zeros(P2.shape[1])
            drift[[0, 2, 8, 14]] = 0.0060
            P2 = P2 * np.exp(np.cumsum(np.tile(drift, (len(P2), 1)), axis=0))
        seg = seg_of(ts, IS_START, IS_END)
        rows = sweep(ts, P2, seg, nperm=300, label=f'{mode.upper()} (panel mélangé blocs 30 j)')
        ps = [x['p'] for x in rows if np.isfinite(x['p'])]
        if mode == 'placebo':
            hit = sum(1 for p in ps if p < 0.01)
            print(f"\nPLACEBO : {hit}/{len(ps)} à p<0,01 = {hit / len(ps) * 100:.1f}% "
                  f"(toléré ≤3 %) → {'OK' if hit <= 0.03 * len(ps) else 'ALERTE — STOP'}")
        else:
            mom = [x for x in rows if x['fam'] == 'MOM' and x['kind'] == 'LS' and x['prm']['J'] >= 30]
            best = max(mom, key=lambda x: x['sharpe'])
            ok = best['p'] < 0.01 and best['sharpe'] > 1
            print(f"\nCONTRÔLE PLANTÉ (+20 bps/j sur 4 actifs) : best MOM L/S "
                  f"Sharpe {best['sharpe']:+.2f} p={best['p']:.4f} → "
                  f"{'RETROUVÉ ✓' if ok else 'NON RETROUVÉ — STOP'}")
        return

    if mode == 'is':
        ts, P = load_panel()
        alive_counts = np.isfinite(P).sum(axis=1)
        seg = seg_of(ts, IS_START, IS_END)
        print(f'panel : {len(ts)} jours × {P.shape[1]} actifs ; vivants méd. IS = '
              f'{int(np.median(alive_counts[seg[0]:seg[1]]))}')
        sweep(ts, P, seg, nperm=1000, label='IS 2019-07→2024-01 (net 30 bps/côté)')
        return

    if mode == 'oos':
        ts, P = load_panel()
        seg = seg_of(ts, IS_END, OOS_END)
        sweep(ts, P, seg, nperm=1000, label='OOS 2024-01→2026-07 — UNE PASSE (survivants IS seulement)')
        return


if __name__ == '__main__':
    main()
