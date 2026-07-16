#!/usr/bin/env python3
"""pairs1 — stat-arb pairs WF strict (protocole LOG.md committé AVANT).
Sélection mensuelle sans lookahead ; trading 1d z-score 2/0,5/4, timeout
30 j ; une paire retirée de la sélection ferme sa position au 1er du mois
(figé ici, avant exécution). Coûts 2×30 bps par jambe-action (1,2 %/cycle)
+ funding réel des 2 jambes.
  python3 pairs.py control | placebo | is [nperm]"""
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'xsection1'))
sys.path.insert(0, os.path.join(HERE, '..', 'carry3'))
from xsection_u import DB, load_panel, metrics, universe_symbols  # noqa: E402
from carry import load_funding_panel  # noqa: E402

IS_A = np.datetime64('2021-01-01').astype('datetime64[ms]').astype(np.int64)
IS_B = np.datetime64('2024-01-01').astype('datetime64[ms]').astype(np.int64)
COST_LEG = 0.0030          # par jambe et par action (entrée OU sortie)
NPAIRS = 20
CORR_MIN = 0.80
HL_LO, HL_HI = 3.0, 30.0
Z_IN, Z_OUT, Z_STOP = 2.0, 0.5, 4.0
TIMEOUT = 30
LOOK_SEL = 180
LOOK_Z = 60


def load_vol_panel(symbols, ts):
    q = ("COPY (SELECT symbol, open_time, quote_volume FROM candles WHERE market='spot' AND "
         "interval='1d' AND symbol = ANY('{" + ','.join(symbols) + "}') "
         "ORDER BY symbol, open_time) TO STDOUT (FORMAT csv)")
    out = subprocess.run(['psql', DB, '-c', q], capture_output=True, text=True, check=True).stdout
    sidx = {s: i for i, s in enumerate(symbols)}
    tidx = {int(t): i for i, t in enumerate(ts)}
    V = np.full((len(ts), len(symbols)), np.nan)
    for line in out.strip().split('\n'):
        if not line:
            continue
        s, t, v = line.split(',')
        i = tidx.get(int(float(t)))
        if i is not None:
            V[i, sidx[s]] = float(v)
    return V


def month_firsts(ts, lo, hi):
    out, prev = [], None
    for t in range(lo, hi):
        mk = str(np.datetime64(int(ts[t]), 'ms').astype('datetime64[M]'))
        if mk != prev:
            out.append(t)
            prev = mk
    return out


def half_life_tstat(s):
    """AR(1) du spread : Δs = β·(s−moy) + ε ; renvoie (half-life, |t| de β)
    — la t-stat est le critère canonique (amendement contrôle-planté)."""
    x = s[:-1] - s[:-1].mean()
    y = np.diff(s)
    vx = (x * x).sum()
    if vx <= 0:
        return np.nan, 0.0
    beta = (x * y).sum() / vx
    if not (-1.0 < beta < 0.0):
        return np.nan, 0.0
    resid = y - beta * x
    se = np.sqrt(resid.var(ddof=1) / vx)
    t = abs(beta / se) if se > 0 else 0.0
    return -np.log(2.0) / np.log(1.0 + beta), t


def eligible_universe(t0, V, lp, elig_perp, hist):
    mv = np.nanmean(V[max(0, t0 - 30):t0], axis=0)
    ok = elig_perp[t0] & (hist[t0] >= LOOK_SEL) & np.isfinite(mv) & np.isfinite(lp[t0])
    idx = np.flatnonzero(ok)
    if len(idx) == 0:
        return idx
    return idx[np.argsort(mv[idx])[-100:]]


def select_pairs(t0, univ, lp):
    if len(univ) < 5:
        return []
    r = np.diff(lp[t0 - LOOK_SEL:t0, univ], axis=0)
    if not np.isfinite(r).all():
        keep = np.isfinite(r).all(axis=0)
        univ = univ[keep]
        r = r[:, keep]
    if len(univ) < 5:
        return []
    Rm = np.corrcoef(r.T)
    cands = []
    for i in range(len(univ)):
        for j in range(i + 1, len(univ)):
            if Rm[i, j] >= CORR_MIN:
                s = lp[t0 - LOOK_SEL:t0, univ[i]] - lp[t0 - LOOK_SEL:t0, univ[j]]
                hl, t = half_life_tstat(s)
                # t ≥ 3,4 (seuil Engle-Granger ~5 %) puis half-life la plus
                # COURTE d'abord (les spurious ont des hl longues)
                if np.isfinite(hl) and HL_LO <= hl <= HL_HI and t >= 3.4:
                    cands.append((hl, int(univ[i]), int(univ[j])))
    cands.sort()
    return [(a, b) for _, a, b in cands[:NPAIRS]]


def run(ts, lp, r, F, months, pair_fn, cost_mult=1.0):
    """pair_fn(t0) → liste de paires du mois. Retourne pnl quotidien (lo..hi) et stats."""
    lo, hi = months[0], months[-1]
    pnl = np.zeros(hi - lo)
    open_pos = {}                          # (a,b) → [dir, t_entry]
    cycles, gross = [], []
    for mi, t0 in enumerate(months[:-1]):
        t1 = months[mi + 1]
        pairs = pair_fn(t0)
        pset = set(pairs)
        for t in range(t0, min(t1, hi)):
            # amendement contrôle-planté : les positions OUVERTES restent
            # gérées par leurs règles même hors sélection ; l'ENTRÉE, elle,
            # exige la sélection du mois
            for (a, b) in list(dict.fromkeys(pairs + list(open_pos.keys()))):
                s_hist = lp[t - LOOK_Z:t, a] - lp[t - LOOK_Z:t, b]
                if not np.isfinite(s_hist).all():
                    continue
                mu, sd = s_hist.mean(), s_hist.std(ddof=1)
                if sd <= 0:
                    continue
                z = (lp[t, a] - lp[t, b] - mu) / sd
                key = (a, b)
                if key in open_pos:
                    d, te = open_pos[key]
                    if t > te:
                        day = 0.5 * d * (r[t, a] - r[t, b]) - 0.5 * d * (F[t, a] - F[t, b])
                        pnl[t - lo] += day / NPAIRS
                        gross.append(day)
                    if abs(z) <= Z_OUT or abs(z) >= Z_STOP or (t - te) >= TIMEOUT:
                        pnl[t - lo] -= 2 * COST_LEG * cost_mult / NPAIRS
                        cycles.append(t - te)
                        del open_pos[key]
                elif abs(z) >= Z_IN and np.isfinite(z) and key in pset:
                    open_pos[key] = (-1.0 if z > 0 else 1.0, t)
                    pnl[t - lo] -= 2 * COST_LEG * cost_mult / NPAIRS
    return pnl, len(cycles), (np.median(cycles) if cycles else np.nan)


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'is'
    nperm = int(sys.argv[2]) if len(sys.argv) > 2 and mode == 'is' else 300
    rng = np.random.default_rng(7)
    syms = universe_symbols()
    ts, P = load_panel(syms)
    if mode == 'placebo':
        rng2 = np.random.default_rng(42)
        P2 = np.full_like(P, np.nan)
        for c in range(P.shape[1]):
            fin = np.where(np.isfinite(P[:, c]))[0]
            if len(fin) < 150:
                continue
            lpa = np.log(P[fin, c])
            sh = rng2.permutation(np.diff(lpa))
            P2[fin, c] = np.exp(np.concatenate([[lpa[0]], lpa[0] + np.cumsum(sh)]))
        P = P2
    with np.errstate(all='ignore'):
        lp = np.log(P)
    n, na = P.shape
    r = np.vstack([np.zeros((1, na)), np.diff(lp, axis=0)])
    r = np.where(np.isfinite(r), r, 0.0)
    hist = np.isfinite(P).cumsum(axis=0)
    F, cnt, lastev = load_funding_panel(syms, ts)
    elig_perp = (cnt >= 21) & (lastev <= 2)
    V = load_vol_panel(syms, ts)
    lo, hi = int(np.searchsorted(ts, IS_A)), int(np.searchsorted(ts, IS_B))
    months = month_firsts(ts, lo, hi) + [hi]

    if mode == 'control':
        # paire synthétique co-intégrée plantée : colonne b' = a − spread AR(1) hl 10 j
        t0 = months[6]
        univ = eligible_universe(t0, V, lp, elig_perp, hist)
        a, b = int(univ[-1]), int(univ[-2])
        sig = float(sys.argv[2]) if len(sys.argv) > 2 else 0.02
        s = np.zeros(n)
        phi = np.exp(np.log(0.5) / 10.0) - 1.0     # AR(1) de half-life 10 j
        eps = rng.normal(0, sig, n)
        for t in range(1, n):
            s[t] = s[t - 1] * (1 + phi) + eps[t]
        lp2 = lp.copy()
        lp2[:, b] = lp[:, a] - s
        r2_ = np.vstack([np.zeros((1, na)), np.diff(lp2, axis=0)])
        r2_ = np.where(np.isfinite(r2_), r2_, 0.0)
        found = []
        for t0_ in months[:-1]:
            prs = select_pairs(t0_, eligible_universe(t0_, V, lp2, elig_perp, hist), lp2)
            found.append((a, b) in prs or (b, a) in prs)
        pnl, ncyc, medc = run(ts, lp2, r2_, np.zeros_like(F), months,
                              lambda t0_: [p for p in select_pairs(t0_, eligible_universe(t0_, V, lp2, elig_perp, hist), lp2)
                                           if p in ((a, b), (b, a))], cost_mult=0.0)
        m = metrics(pnl)
        ok = np.mean(found) > 0.5 and m['sharpe'] > 2
        print(f"CONTRÔLE PLANTÉ : paire trouvée {np.mean(found) * 100:.0f}% des mois, "
              f"Sharpe brut {m['sharpe']:+.2f} ({ncyc} cycles) → "
              f"{'MACHINERIE VOYANTE ✓' if ok else 'N EXPLOSE PAS — STOP'}")
        return

    def real_fn(t0):
        return select_pairs(t0, eligible_universe(t0, V, lp, elig_perp, hist), lp)

    sel_sizes = [len(real_fn(t0)) for t0 in months[:-1]]
    print(f"{'PLACEBO iid' if mode == 'placebo' else 'IS 2021→2024'} : "
          f"paires sélectionnées/mois méd {np.median(sel_sizes):.0f} (max {max(sel_sizes)})")
    pnl, ncyc, medc = run(ts, lp, r, F, months, real_fn)
    m = metrics(pnl)
    calmar = m['cagr'] / m['dd'] if m['dd'] > 0 else np.nan
    px2, _, _ = run(ts, lp, r, F, months, real_fn, cost_mult=2.0)
    pbrut, _, _ = run(ts, lp, r, F, months, real_fn, cost_mult=0.0)
    print(f"net    : Sharpe {m['sharpe']:+5.2f} CAGR {m['cagr']:+6.1f}% DD {m['dd']:4.1f}% "
          f"Calmar {calmar:4.2f} | {ncyc} cycles (méd {medc:.0f} j)")
    print(f"brut   : Sharpe {metrics(pbrut)['sharpe']:+5.2f} CAGR {metrics(pbrut)['cagr']:+6.1f}% "
          f"| coûts ×2 : Sharpe {metrics(px2)['sharpe']:+5.2f}")
    if mode == 'is':
        hits = 0
        for it in range(nperm):
            def fake_fn(t0, it=it):
                univ = eligible_universe(t0, V, lp, elig_perp, hist)
                k = len(real_fn(t0))
                if k == 0 or len(univ) < 4:
                    return []
                rng_l = np.random.default_rng(1000 * it + t0)
                out = []
                for _ in range(k):
                    a, b = rng_l.choice(univ, 2, replace=False)
                    out.append((int(a), int(b)))
                return out
            pn, _, _ = run(ts, lp, r, F, months, fake_fn)
            sd = pn.std(ddof=1)
            if (pn.mean() / sd * np.sqrt(365) if sd > 0 else -9) >= m['sharpe']:
                hits += 1
        print(f"percentile vs {nperm} nulls appariés : p={(1 + hits) / (1 + nperm):.4f}")


if __name__ == '__main__':
    main()
