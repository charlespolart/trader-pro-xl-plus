#!/usr/bin/env python3
"""regime1 — short de junk régime-gated (protocole LOG.md committé avant).
Porte = médiane du funding quotidien des perps éligibles ≥ G (3 seuils figés).
Constructions : C1 L/S funding · C2 short nu · C3 short + long BTC.
Signal intra-porte : FLEVEL L3 (hérité carry3). K=7 figé.
  python3 regime.py control | placebo | is | oos | perp
Mode perp (étape 6, réplication) : sélection/porte INCHANGÉES (spot) ;
rendements exécutés = perps réels (fallback spot compté) ; long BTC en perp
qui PAIE son funding. Rejoue G2,5/C3 uniquement."""
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'carry3'))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'xsection1'))
import carry as C  # noqa: E402

IS_START = C.IS_START
IS_END = C.IS_END
OOS_END = C.OOS_END
GATES_BPS = (2.5, 5.0, 10.0)
K = 7
DB = 'postgres://tpx:tpx@localhost:5438/tpx'


def load_btc(ts, market='spot'):
    q = (f"COPY (SELECT open_time, close FROM candles WHERE market='{market}' AND symbol='BTCUSDT' "
         "AND interval='1d' ORDER BY open_time) TO STDOUT (FORMAT csv)")
    out = subprocess.run(['psql', DB, '-c', q], capture_output=True, text=True, check=True).stdout
    d = {int(float(a)): float(b) for a, b in (line.split(',') for line in out.strip().split('\n') if line)}
    px = np.array([d.get(int(t), np.nan) for t in ts])
    r = np.concatenate([[0.0], np.diff(np.log(px))])
    return np.where(np.isfinite(r), r, 0.0)


def load_perp_panel(symbols, ts):
    """closes 1d um-futures alignés sur (ts, symbols) ; NaN si pas de perp."""
    q = ("COPY (SELECT symbol, open_time, close FROM candles WHERE market='futures' AND "
         "interval='1d' AND symbol = ANY('{" + ','.join(symbols) + "}') "
         "ORDER BY symbol, open_time) TO STDOUT (FORMAT csv)")
    out = subprocess.run(['psql', DB, '-c', q], capture_output=True, text=True, check=True).stdout
    sidx = {s: i for i, s in enumerate(symbols)}
    tidx = {int(t): i for i, t in enumerate(ts)}
    P = np.full((len(ts), len(symbols)), np.nan)
    for line in out.strip().split('\n'):
        if not line:
            continue
        s, t, c = line.split(',')
        i = tidx.get(int(float(t)))
        if i is not None:
            P[i, sidx[s]] = float(c)
    return P


def load_btc_funding(ts):
    """funding quotidien BTCUSDT (payé par le long BTC perp en mode perp)."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        '..', 'xsection1', 'funding_daily_all.csv')
    d = {}
    with open(path) as f:
        for line in f:
            s, day, r = line.strip().split(',')
            if s == 'BTCUSDT':
                d[int(float(day))] = float(r)
    if not d:
        raise RuntimeError('BTCUSDT absent de funding_daily_all.csv')
    return np.array([d.get(int(t), 0.0) for t in ts])


def gate_series(P, F, cnt, lastev, hist):
    """médiane du funding quotidien sur les perps éligibles (observable)."""
    n = len(F)
    g = np.full(n, np.nan)
    for t in range(n):
        elig = np.isfinite(P[t]) & (cnt[t] >= 21) & (lastev[t] <= 2) & (hist[t] >= C.WARMUP)
        if elig.sum() >= C.MIN_ALIVE:
            g[t] = float(np.median(F[t][elig]))
    return g


def portfolio_gated(P, F, cnt, lastev, S, gate_on, seg, cons, btc_r=None,
                    perm=None, cost_mult=1.0, r_exec=None, btc_f=None, cover=None,
                    shortable=None):
    lp = np.log(P)
    n, na = P.shape
    r = np.vstack([np.zeros((1, na)), np.diff(lp, axis=0)])
    r = np.where(np.isfinite(r), r, 0.0)
    if r_exec is not None:
        r = r_exec                     # rendements exécutés (perps), sélection intacte
    lo, hi = seg
    hist = np.isfinite(P).cumsum(axis=0)
    Su = S if perm is None else S[:, perm]
    out = np.zeros(hi - lo)
    w = np.zeros(na)
    w_btc = 0.0
    for t in range(lo, hi, K):
        neww = np.zeros(na)
        new_btc = 0.0
        if gate_on[t]:
            elig = (np.isfinite(Su[t]) & np.isfinite(P[t]) & (hist[t] >= C.WARMUP)
                    & (cnt[t] >= 21) & (lastev[t] <= 2))
            if shortable is not None:
                elig = elig & shortable[t]      # re-mesure univers restreint (étape 8c)
            idx = np.flatnonzero(elig)
            if len(idx) >= C.MIN_ALIVE:
                ntop = max(1, int(round(len(idx) * C.TOPQ)))
                order = idx[np.argsort(Su[t][idx])]
                for a in order[:ntop]:
                    neww[a] -= 1.0 / ntop                 # short funding max
                if cons == 'C1':
                    for a in order[-ntop:]:
                        neww[a] += 1.0 / ntop             # long funding min
                elif cons == 'C3':
                    new_btc = 1.0                          # long BTC 1:1
        i0 = t - lo
        out[i0] -= C.COST * cost_mult * (np.abs(neww - w).sum() + abs(new_btc - w_btc))
        w = neww
        w_btc = new_btc
        j1, j2 = t + 1, min(t + K, hi, n - 1) + 1
        if j1 < j2:
            blk = r[j1:j2] @ w
            blk += -(F[j1:j2] @ w)
            if btc_r is not None and w_btc != 0.0:
                blk = blk + btc_r[j1:j2] * w_btc
                if btc_f is not None:
                    blk = blk - btc_f[j1:j2] * w_btc   # long BTC perp paie son funding
            out[i0:i0 + (j2 - j1)] += blk
            if cover is not None:
                aw = np.abs(w)
                cover['num'] += float((cover['has'][j1:j2] * aw).sum())
                cover['den'] += float(aw.sum() * (j2 - j1))
    return out


def episodes_of(gate_on, seg, ts):
    lo, hi = seg
    eps = []
    start = None
    for t in range(lo, hi):
        if gate_on[t] and start is None:
            start = t
        elif not gate_on[t] and start is not None:
            eps.append((start, t))
            start = None
    if start is not None:
        eps.append((start, hi))
    merged = []
    for a, b in eps:
        if merged and (a - merged[-1][1]) < 14:
            merged[-1] = (merged[-1][0], b)
        else:
            merged.append((a, b))
    return merged


def eval_cell(P, F, cnt, lastev, S, gate_on, seg, cons, btc_r, ts, nperm=1000,
              r_exec=None, btc_f=None, cover=None, shortable=None):
    real = portfolio_gated(P, F, cnt, lastev, S, gate_on, seg, cons, btc_r,
                           r_exec=r_exec, btc_f=btc_f, cover=cover, shortable=shortable)
    m = C.metrics(real)
    rng = np.random.default_rng(7)
    hit = 0
    for _ in range(nperm):
        null = portfolio_gated(P, F, cnt, lastev, S, gate_on, seg, cons, btc_r,
                               perm=rng.permutation(P.shape[1]),
                               r_exec=r_exec, btc_f=btc_f, shortable=shortable)
        sd = null.std(ddof=1)
        if (null.mean() / sd * np.sqrt(365) if sd > 0 else -9) >= m['sharpe']:
            hit += 1
    m['p'] = (1 + hit) / (1 + nperm)
    eps = episodes_of(gate_on, seg, ts)
    lo = seg[0]
    ep_pnl = [float(real[a - lo:b - lo].sum()) for a, b in eps]
    m['neps'] = len(eps)
    m['eps_pos'] = sum(1 for x in ep_pnl if x > 0)
    m['on_share'] = float(np.mean([gate_on[t] for t in range(seg[0], seg[1])]))
    m['ep_pnl'] = ep_pnl
    return m, real


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'is'
    syms = C.universe_symbols()
    ts, P = C.load_panel(syms)
    F, cnt, lastev = C.load_funding_panel(syms, ts)
    hist = np.isfinite(P).cumsum(axis=0)
    g = gate_series(P, F, cnt, lastev, hist)
    btc_r = load_btc(ts)
    S = C.signal_funding(F, 'FLEVEL', dict(L=3))
    a, b = (IS_START, IS_END) if mode != 'oos' else (IS_END, OOS_END)
    seg = (int(np.searchsorted(ts, a)), int(np.searchsorted(ts, b)))

    if mode == 'perp':
        P_perp = load_perp_panel(syms, ts)
        btc_r_perp = load_btc(ts, market='futures')
        F_btc = load_btc_funding(ts)
        na = P.shape[1]
        with np.errstate(all='ignore'):
            r_p = np.vstack([np.zeros((1, na)), np.diff(np.log(P_perp), axis=0)])
            r_s = np.vstack([np.zeros((1, na)), np.diff(np.log(P), axis=0)])
        has = np.isfinite(r_p)
        has[0] = False
        r_s = np.where(np.isfinite(r_s), r_s, 0.0)
        r_exec = np.where(has, r_p, r_s)     # perp si dispo, sinon spot (compté)
        on = np.where(np.isfinite(g), g >= 2.5 / 1e4, False)
        ncol = int(np.isfinite(P_perp).any(axis=0).sum())
        print('=== ÉTAPE 6 — réplication VRAIS prix perps, G2,5/C3 (sélection spot INTACTE) ===')
        print(f'panel perps : {ncol}/{na} colonnes avec données futures')
        verdict_oos = None
        for lab, aa, bb in (('IS ', IS_START, IS_END), ('OOS', IS_END, OOS_END)):
            sg = (int(np.searchsorted(ts, aa)), int(np.searchsorted(ts, bb)))
            cov = dict(num=0.0, den=0.0, has=has)
            m_ref, _ = eval_cell(P, F, cnt, lastev, S, on, sg, 'C3', btc_r, ts)
            m_perp, _ = eval_cell(P, F, cnt, lastev, S, on, sg, 'C3', btc_r_perp, ts,
                                  r_exec=r_exec, btc_f=F_btc, cover=cov)
            m_diag, _ = eval_cell(P, F, cnt, lastev, S, on, sg, 'C3', btc_r, ts,
                                  r_exec=r_exec)
            x2 = C.metrics(portfolio_gated(P, F, cnt, lastev, S, on, sg, 'C3',
                                           btc_r_perp, r_exec=r_exec, btc_f=F_btc,
                                           cost_mult=2.0))
            for nm, m in (('spot (réf. publiée)', m_ref), ('PERP INTÉGRAL', m_perp),
                          ('diag short-perp/BTC-spot', m_diag)):
                calmar = m['cagr'] / m['dd'] if m['dd'] > 0 else np.nan
                print(f"{lab} {nm:25s} | Sharpe {m['sharpe']:+5.2f} CAGR {m['cagr']:+7.1f}% "
                      f"DD {m['dd']:5.1f}% Calmar {calmar:5.2f} p={m['p']:.4f} "
                      f"ép {m['eps_pos']}/{m['neps']}")
            covp = cov['num'] / cov['den'] * 100 if cov['den'] else float('nan')
            print(f"{lab} couverture perp jambe short : {covp:.1f}% des jours-poids | "
                  f"coûts ×2 → Sharpe {x2['sharpe']:+5.2f}")
            if lab == 'OOS':
                verdict_oos = m_perp['sharpe']
        ok = verdict_oos is not None and verdict_oos >= 0.9
        print(f"\nBARRE ÉTAPE 6 (Sharpe OOS perp ≥ 0,9 ≈ 50% de 1,77) : "
              f"{verdict_oos:+.2f} → {'SURVIT ✓' if ok else 'MORT ✗'}")
        return

    if mode == 'series':
        # étape 7 : dump de la série quotidienne du PERP INTÉGRAL (variante
        # jugée étape 6), fenêtre CONTINUE IS+OOS, rebal K7 continu. Aucune
        # évaluation nouvelle — juste la série pour duel/contribution.
        P_perp = load_perp_panel(syms, ts)
        btc_r_perp = load_btc(ts, market='futures')
        F_btc = load_btc_funding(ts)
        na = P.shape[1]
        with np.errstate(all='ignore'):
            r_p = np.vstack([np.zeros((1, na)), np.diff(np.log(P_perp), axis=0)])
            r_s = np.vstack([np.zeros((1, na)), np.diff(np.log(P), axis=0)])
        has = np.isfinite(r_p)
        has[0] = False
        r_s = np.where(np.isfinite(r_s), r_s, 0.0)
        r_exec = np.where(has, r_p, r_s)
        on = np.where(np.isfinite(g), g >= 2.5 / 1e4, False)
        sg = (int(np.searchsorted(ts, IS_START)), int(np.searchsorted(ts, OOS_END)))
        real = portfolio_gated(P, F, cnt, lastev, S, on, sg, 'C3', btc_r_perp,
                               r_exec=r_exec, btc_f=F_btc)
        out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'regime1_perp_daily.csv')
        with open(out, 'w') as f:
            f.write('ts,ret,gate_on\n')
            for i in range(sg[0], sg[1]):
                f.write(f'{int(ts[i])},{real[i - sg[0]]:.10f},{int(bool(on[i]))}\n')
        print(f'{out} : {sg[1] - sg[0]} jours, cumul log {real.sum():+.3f}')
        return

    if mode == 'control':
        import datetime
        def dstr(i):
            return datetime.datetime.fromtimestamp(ts[i] / 1000, datetime.UTC).strftime('%Y-%m')
        for G in GATES_BPS:
            on = g >= G / 1e4
            on = np.where(np.isfinite(g), on, False)
            eps = episodes_of(on, seg, ts)
            share = np.mean([on[t] for t in range(seg[0], seg[1])])
            labels = ', '.join(f'{dstr(x)}→{dstr(y - 1)}' for x, y in eps)
            print(f'G={G:4.1f} bps/j : ON {share * 100:4.1f}% de l IS, {len(eps)} épisodes [{labels}]')
        # vérité terrain : G=5 doit couvrir 2020-Q4→2021-Q2 et épargner 2022-23
        on5 = np.where(np.isfinite(g), g >= 5.0 / 1e4, False)
        q4 = (int(np.searchsorted(ts, np.datetime64('2020-11-01').astype('datetime64[ms]').astype(np.int64))),
              int(np.searchsorted(ts, np.datetime64('2021-05-01').astype('datetime64[ms]').astype(np.int64))))
        dead = (int(np.searchsorted(ts, np.datetime64('2022-06-01').astype('datetime64[ms]').astype(np.int64))),
                int(np.searchsorted(ts, np.datetime64('2023-06-01').astype('datetime64[ms]').astype(np.int64))))
        c1 = np.mean([on5[t] for t in range(*q4)])
        c2 = np.mean([on5[t] for t in range(*dead)])
        ok = c1 > 0.6 and c2 < 0.2
        print(f'\nCONTRÔLE G=5 : ON {c1 * 100:.0f}% de nov20→avr21 (attendu >60%), '
              f'{c2 * 100:.0f}% de juin22→juin23 (attendu <20%) → {"✓" if ok else "✗ STOP"}')
        return

    if mode == 'placebo':
        rng = np.random.default_rng(42)
        P2 = np.full_like(P, np.nan)
        for c_ in range(P.shape[1]):
            fin = np.where(np.isfinite(P[:, c_]))[0]
            if len(fin) < 150:
                continue
            lpa = np.log(P[fin, c_])
            sh = rng.permutation(np.diff(lpa))
            P2[fin, c_] = np.exp(np.concatenate([[lpa[0]], lpa[0] + np.cumsum(sh)]))
        hits = tot = 0
        for G in GATES_BPS:
            on = np.where(np.isfinite(g), g >= G / 1e4, False)
            for cons in ('C1', 'C2', 'C3'):
                m, _ = eval_cell(P2, F, cnt, lastev, S, on, seg, cons, btc_r, ts, nperm=200)
                tot += 1
                hits += m['p'] < 0.01
        print(f'PLACEBO : {hits}/{tot} à p<0,01 → {"OK" if hits <= max(1, 0.03 * tot) else "ALERTE — STOP"}')
        return

    label = 'IS 2020-07→2024-01' if mode == 'is' else 'OOS 2024-01→2026-07 — UNE PASSE'
    print(f'=== {label} (net 30 bps/côté, K7, signal FLEVEL L3 hérité) ===')
    rows = []
    for G in GATES_BPS:
        on = np.where(np.isfinite(g), g >= G / 1e4, False)
        for cons in ('C1', 'C2', 'C3'):
            m, _ = eval_cell(P, F, cnt, lastev, S, on, seg, cons, btc_r, ts)
            calmar = m['cagr'] / m['dd'] if m['dd'] > 0 else np.nan
            rows.append(dict(G=G, cons=cons, p=m['p'], sharpe=m['sharpe']))
            eps = ' '.join(f'{x * 100:+.0f}%' for x in m['ep_pnl'])
            print(f"G{G:4.1f} {cons} | Sharpe {m['sharpe']:+5.2f} CAGR {m['cagr']:+7.1f}% "
                  f"DD {m['dd']:5.1f}% Calmar {calmar:5.2f} p={m['p']:.4f} | "
                  f"ON {m['on_share'] * 100:4.1f}% ép {m['eps_pos']}/{m['neps']} [{eps}]")
    flags = C.bh_flags([r['p'] for r in rows])
    surv = [f"G{r['G']}/{r['cons']}" for r, f in zip(rows, flags) if f and r['sharpe'] > 0]
    print(f"\nBH-FDR : {surv if surv else 'aucun'}")


if __name__ == '__main__':
    main()
