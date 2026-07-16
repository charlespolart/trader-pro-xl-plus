#!/usr/bin/env python3
"""xsection1 — instruction du candidat LOWVOL L/S (univers complet).
Critères 3-5 du protocole + trop-beau : quintiles, DÉCOMPOSITION PAR JAMBE
(la jambe short de junk volatil est-elle le moteur ? — empruntabilité douteuse),
sous-périodes, plateau (fenêtre vol × K), coûts ×2, et mécanique de fin de
série (délistations : que gagne le short sur les 30 derniers jours de vie ?).
  python3 pass2u.py"""
import numpy as np

from xsection_u import (IS_END, IS_START, WARMUP, bh_flags, eval_config,
                        load_panel, metrics, portfolio_fast, signal_matrix,
                        universe_symbols)

TOPQ = 0.30


def leg_series(P, S, K, seg, leg):
    """rendement net d'UNE jambe (long top ou short bottom), même mécanique."""
    lp = np.log(P)
    n, na = P.shape
    r = np.vstack([np.zeros((1, na)), np.diff(lp, axis=0)])
    r = np.where(np.isfinite(r), r, 0.0)
    lo, hi = seg
    hist = np.isfinite(P).cumsum(axis=0)
    out = np.zeros(hi - lo)
    w = np.zeros(na)
    for t in range(lo, hi, K):
        alive = np.isfinite(S[t]) & np.isfinite(P[t]) & (hist[t] >= WARMUP)
        idx = np.flatnonzero(alive)
        neww = np.zeros(na)
        if len(idx) >= 30:
            ntop = max(1, int(round(len(idx) * TOPQ)))
            order = idx[np.argsort(S[t][idx])]
            if leg == 'long':
                neww[order[-ntop:]] = 1.0 / ntop
            else:
                neww[order[:ntop]] = -1.0 / ntop
        i0 = t - lo
        out[i0] -= 0.0030 * np.abs(neww - w).sum()
        w = neww
        j1, j2 = t + 1, min(t + K, hi, n - 1) + 1
        if j1 < j2:
            out[i0:i0 + (j2 - j1)] += r[j1:j2] @ w
    return out


def main():
    syms = universe_symbols()
    ts, P = load_panel(syms)
    seg = (int(np.searchsorted(ts, IS_START)), int(np.searchsorted(ts, IS_END)))
    S = signal_matrix(P, 'LOWVOL', dict())
    K = 30

    print('=== 1. QUINTILES (critère 3 — monotonie, LOWVOL, K30, L/S par rang) ===')
    lp = np.log(P)
    n, na = P.shape
    r = np.where(np.isfinite(np.vstack([np.zeros((1, na)), np.diff(lp, axis=0)])),
                 np.vstack([np.zeros((1, na)), np.diff(lp, axis=0)]), 0.0)
    hist = np.isfinite(P).cumsum(axis=0)
    qrets = [[] for _ in range(5)]
    for t in range(seg[0], seg[1], K):
        idx = np.flatnonzero(np.isfinite(S[t]) & np.isfinite(P[t]) & (hist[t] >= WARMUP))
        if len(idx) < 30:
            continue
        order = idx[np.argsort(S[t][idx])]          # croissant = HAUTE vol d'abord (signal = −σ)
        cuts = np.array_split(order, 5)
        j2 = min(t + K, seg[1], n - 1) + 1
        for qi, cut in enumerate(cuts):
            if len(cut) and t + 1 < j2:
                qrets[qi].append(float(r[t + 1:j2, cut].mean(axis=1).sum()))
    for qi, v in enumerate(qrets):
        lab = 'Q1 (vol MAX)' if qi == 0 else ('Q5 (vol MIN)' if qi == 4 else f'Q{qi + 1}')
        print(f'  {lab:14s}: {np.mean(v) * 1e4:+8.1f} bps / période de 30 j (n={len(v)})')

    print('\n=== 2. DÉCOMPOSITION PAR JAMBE (trop-beau : qui porte ?) ===')
    for leg in ('long', 'short'):
        d = leg_series(P, S, K, seg, leg)
        m = metrics(d)
        print(f"  jambe {leg:5s}: Sharpe {m['sharpe']:+5.2f} CAGR {m['cagr']:+7.1f}% DD {m['dd']:5.1f}%")

    print('\n=== 3. SOUS-PÉRIODES (L/S K30) ===')
    for a, b, lab in ((IS_START, np.datetime64('2022-01-01').astype('datetime64[ms]').astype(np.int64), '2019-07→2022-01'),
                      (np.datetime64('2022-01-01').astype('datetime64[ms]').astype(np.int64), IS_END, '2022-01→2024-01')):
        sg = (int(np.searchsorted(ts, a)), int(np.searchsorted(ts, b)))
        d = portfolio_fast(P, S, K, sg, 'LS')
        m = metrics(d)
        print(f"  {lab}: Sharpe {m['sharpe']:+5.2f} CAGR {m['cagr']:+7.1f}% DD {m['dd']:5.1f}%")

    print('\n=== 4. PLATEAU (fenêtre σ × K — voisins ≥50% du Sharpe, critère 4) ===')
    for win in (20, 30, 45, 60):
        rr = np.diff(lp, axis=0)
        Sw = np.full_like(P, np.nan)
        for t in range(win, n):
            Sw[t] = -np.nanstd(rr[t - win:t], axis=0, ddof=1)
        row = []
        for Kv in (7, 14, 30):
            d = portfolio_fast(P, Sw, Kv, seg, 'LS')
            m = metrics(d)
            row.append(f'K{Kv}:{m["sharpe"]:+5.2f}')
        print(f'  σ{win:2d}j  ' + '  '.join(row))

    print('\n=== 5. COÛTS ×2 (60 bps/côté, critère 5 : Sharpe > 0,5) ===')
    import xsection_u
    old = xsection_u.COST
    for mult, lab in ((2, '×2'), (3, '×3')):
        xsection_u.COST = old * mult
        d = portfolio_fast(P, S, K, seg, 'LS')
        m = metrics(d)
        print(f"  coûts {lab}: Sharpe {m['sharpe']:+5.2f} CAGR {m['cagr']:+7.1f}%")
    xsection_u.COST = old

    print('\n=== 6. FINS DE SÉRIE (mécanique de délistation dans la jambe short) ===')
    ends = 0
    tail_ret = []
    for a in range(na):
        fin = np.where(np.isfinite(P[:, a]))[0]
        if len(fin) < 120 or fin[-1] >= n - 5:      # encore vivante aujourd'hui
            continue
        ends += 1
        e = fin[-1]
        s30 = fin[max(0, len(fin) - 31)]
        tail_ret.append(float(np.log(P[e, a] / P[s30, a])))
    if tail_ret:
        print(f'  {ends} séries terminées (délistées) ; log-ret MOYEN des 30 derniers jours : '
              f'{np.mean(tail_ret) * 100:+.1f}% (méd {np.median(tail_ret) * 100:+.1f}%)')
        print('  → ce que le short « gagne » en fin de vie DANS le backtest ; en réel le borrow')
        print('    y est rare/cher et la sortie forcée — à décompter du candidat.')


if __name__ == '__main__':
    main()
