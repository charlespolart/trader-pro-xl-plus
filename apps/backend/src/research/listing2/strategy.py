#!/usr/bin/env python3
"""listing2 — backtest EN CHEMIN du short-new-listings (protocole LOG.md
committé AVANT tout regard sur les chemins). 12 cellules figées :
{S1 nu, S2 +BTC} × K{7,14,30} × {sans stop, stop +50 % au close}.
Portefeuille : 10 slots fixes, événement sauté si tout est occupé (figé).
Prix d'exécution : perp si dispo, sinon spot (compté). Funding réel.
Null/placebo : pseudo-événements (actifs aléatoires vivants même date).
  python3 strategy.py [placebo]"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'regime1'))
sys.path.insert(0, os.path.join(HERE, '..', 'xsection1'))
import regime as R  # noqa: E402

C = R.C
DAY = 86_400_000
COST = 0.0030
M = 10
ERAS = (('2019-02→2024-01 (mécanique)', '2019-02-01', '2024-01-01'),
        ('2024-01→2026-07 (ère tradable)', '2024-01-01', '2026-07-01'))
CELLS = [(cons, K, stop) for cons in ('S1', 'S2') for K in (7, 14, 30) for stop in (False, True)]


def dms(s):
    return int(np.datetime64(s).astype('datetime64[ms]').astype(np.int64))


def build_events(ts, P, alive, F, cnt, first, last, syms):
    """entrée = close du 1er jour de funding observé (≤ J+7 du listing)."""
    n, na = P.shape
    ev = []
    for a in range(na):
        j0 = first[a]
        if not (dms('2019-02-01') <= ts[j0] < dms('2026-06-01')):
            continue
        if alive[j0].sum() < 30:
            continue
        f_days = np.flatnonzero(F[:, a] != 0.0)
        f_days = f_days[(f_days >= j0) & (f_days <= j0 + 7)]
        if len(f_days) == 0:
            continue
        te = int(f_days[0])
        if te + 8 > n or last[a] < te + 7:
            continue
        ev.append((a, te))
    return ev


def run_portfolio(events, r_exec, F, btc_r, F_btc, cons, K, stop, n):
    """pnl quotidien portefeuille (capital = M slots fixes) + stats/trade."""
    pnl = np.zeros(n)
    open_until = np.zeros(0, dtype=int)
    trades = []
    skipped = 0
    for a, te in sorted(events, key=lambda x: x[1]):
        open_until = open_until[open_until > te]
        if len(open_until) >= M:
            skipped += 1
            continue
        t_end = min(te + K, n - 1)
        # chemin du short : cumul depuis l'entrée, stop évalué au close
        path = np.cumsum(r_exec[te + 1:t_end + 1, a])
        if stop and len(path):
            hit = np.flatnonzero(path >= np.log(1.5))
            if len(hit):
                t_end = te + 1 + int(hit[0])
                path = path[:int(hit[0]) + 1]
        days = slice(te + 1, t_end + 1)
        tr = -r_exec[days, a] + F[days, a]          # short : −prix, reçoit F
        if cons == 'S2':
            tr = tr + btc_r[days] - F_btc[days]     # long BTC perp paie F
        tr = tr.copy()
        tr[0] -= COST
        tr[-1] -= COST
        pnl[days] += tr / M
        trades.append(float(tr.sum()))
        open_until = np.append(open_until, t_end)
    return pnl, np.array(trades), skipped


def metrics_seg(pnl, ts, a, b):
    w = (ts >= dms(a)) & (ts < dms(b))
    x = pnl[w]
    sd = x.std(ddof=1)
    sharpe = x.mean() / sd * np.sqrt(365) if sd > 0 else np.nan
    eq = np.exp(np.cumsum(x))
    peak = np.maximum.accumulate(eq)
    dd = float(((peak - eq) / peak).max()) * 100
    cagr = (float(eq[-1]) ** (365.0 / max(len(x), 1)) - 1.0) * 100
    return dict(sharpe=sharpe, cagr=cagr, dd=dd,
                calmar=cagr / dd if dd > 0 else np.nan)


def main():
    placebo = len(sys.argv) > 1 and sys.argv[1] == 'placebo'
    rng = np.random.default_rng(11 if placebo else 7)
    syms = C.universe_symbols()
    ts, P = C.load_panel(syms)
    F, cnt, lastev = C.load_funding_panel(syms, ts)
    n, na = P.shape
    hist = np.isfinite(P).cumsum(axis=0)
    alive = np.isfinite(P) & (hist >= C.WARMUP)
    fin = np.isfinite(P)
    first = np.argmax(fin, axis=0)
    last = n - 1 - np.argmax(fin[::-1], axis=0)
    P_perp = R.load_perp_panel(syms, ts)
    with np.errstate(all='ignore'):
        r_p = np.vstack([np.zeros((1, na)), np.diff(np.log(P_perp), axis=0)])
        r_s = np.vstack([np.zeros((1, na)), np.diff(np.log(P), axis=0)])
    has = np.isfinite(r_p)
    has[0] = False
    r_s = np.where(np.isfinite(r_s), r_s, 0.0)
    r_exec = np.where(has, r_p, r_s)
    btc_r = R.load_btc(ts, market='futures')
    F_btc = R.load_btc_funding(ts)

    events = build_events(ts, P, alive, F, cnt, first, last, syms)
    if placebo:
        events = [(int(rng.choice(np.flatnonzero(alive[te]))), te) for _, te in events]
    cover = float(np.mean([has[te + 1:min(te + 31, n), a].mean() for a, te in events]))
    print(f'{"PLACEBO pseudo-évts" if placebo else "événements"} : {len(events)} | '
          f'couverture prix perp {cover * 100:.0f}%')

    print('\ncellule            | ère                          | Sharpe  CAGR      DD    Calmar | méd/trade  win%  pire | p(null200) | skip')
    for cons, K, stop in CELLS:
        pnl, trades, skipped = run_portfolio(events, r_exec, F, btc_r, F_btc, cons, K, stop, n)
        # null : 200 portefeuilles de pseudo-événements appariés
        null_sh = {era[0]: [] for era in ERAS}
        for _ in range(200):
            fake = [(int(rng.choice(np.flatnonzero(alive[te]))), te) for _, te in events]
            pn, _, _ = run_portfolio(fake, r_exec, F, btc_r, F_btc, cons, K, stop, n)
            for lab, a, b in ERAS:
                null_sh[lab].append(metrics_seg(pn, ts, a, b)['sharpe'])
        for lab, a, b in ERAS:
            m = metrics_seg(pnl, ts, a, b)
            era_tr = trades  # stats/trade globales rapportées sur la ligne de la 2e ère seulement
            ns = np.array(null_sh[lab])
            p = float((1 + (ns >= m['sharpe']).sum()) / (1 + len(ns)))
            med = float(np.median(trades)) * 100
            win = float((trades < 0).sum() < len(trades) and (trades > 0).mean() * 100)
            worst = float(trades.min()) * 100
            print(f"{cons} K{K:2d} {'stop' if stop else '    '}      | {lab:28s} | "
                  f"{m['sharpe']:+5.2f} {m['cagr']:+8.1f}% {m['dd']:5.1f}% {m['calmar']:6.2f} | "
                  f"{med:+6.1f}% {win:4.0f}% {worst:+6.0f}% | p={p:.3f} | {skipped}")

    # stress proxy-liquidation : pire excursion adverse au close (S1 K30 sans stop)
    pnl, trades, _ = run_portfolio(events, r_exec, F, btc_r, F_btc, 'S1', 30, False, n)
    adverse = []
    for a, te in events:
        t_end = min(te + 30, n - 1)
        path = np.cumsum(r_exec[te + 1:t_end + 1, a])
        adverse.append(float(np.exp(path.max()) - 1.0) if len(path) else 0.0)
    adv = np.array(adverse)
    print(f'\nstress chemin (S1 K30) : max adverse close méd {np.median(adv) * 100:+.0f}%, '
          f'p90 {np.percentile(adv, 90) * 100:+.0f}%, >+50% : {(adv > 0.5).mean() * 100:.0f}%, '
          f'>+100% : {(adv > 1.0).mean() * 100:.0f}% des événements')


if __name__ == '__main__':
    main()
