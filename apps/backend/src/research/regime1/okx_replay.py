#!/usr/bin/env python3
"""regime1 étape 8c — re-mesure « univers OKX » PRÉ-DÉCLARÉE (LOG.md).
OOS 2024-01→2026-07 UNIQUEMENT (anti-survivorship : la liste OKX vivante
n'approxime la liste d'époque que là). Jambe short restreinte à
éligibles ∩ OKX-listables ∩ volume>0 ; porte/params/coûts INCHANGÉS ;
exécution perp intégrale. Barre : Sharpe OOS ≥ 0,9. UNE passe.
  python3 okx_replay.py"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import regime as R  # noqa: E402
from stress import load_volume_panel, okx_bases  # noqa: E402

C = R.C


def main():
    syms = C.universe_symbols()
    ts, P = C.load_panel(syms)
    F, cnt, lastev = C.load_funding_panel(syms, ts)
    hist = np.isfinite(P).cumsum(axis=0)
    g = R.gate_series(P, F, cnt, lastev, hist)
    S = C.signal_funding(F, 'FLEVEL', dict(L=3))
    on = np.where(np.isfinite(g), g >= 2.5 / 1e4, False)
    btc_r_perp = R.load_btc(ts, market='futures')
    F_btc = R.load_btc_funding(ts)
    P_perp = R.load_perp_panel(syms, ts)
    na = P.shape[1]
    with np.errstate(all='ignore'):
        r_p = np.vstack([np.zeros((1, na)), np.diff(np.log(P_perp), axis=0)])
        r_s = np.vstack([np.zeros((1, na)), np.diff(np.log(P), axis=0)])
    has = np.isfinite(r_p)
    has[0] = False
    r_s = np.where(np.isfinite(r_s), r_s, 0.0)
    r_exec = np.where(has, r_p, r_s)

    okx = okx_bases()
    has_okx = np.array([s[:-4] in okx for s in syms])
    V = load_volume_panel(syms, ts)
    shortable = has_okx[None, :] & (np.nan_to_num(V, nan=0.0) > 0.0)

    sg = (int(np.searchsorted(ts, R.IS_END)), int(np.searchsorted(ts, R.OOS_END)))
    # diagnostic de taille du sous-univers aux rebals ON
    sizes = []
    for t in range(sg[0], sg[1], R.K):
        if not on[t]:
            continue
        elig = (np.isfinite(S[t]) & np.isfinite(P[t]) & (hist[t] >= C.WARMUP)
                & (cnt[t] >= 21) & (lastev[t] <= 2))
        sizes.append((int(elig.sum()), int((elig & shortable[t]).sum())))
    med_all = int(np.median([a for a, _ in sizes]))
    med_okx = int(np.median([b for _, b in sizes]))
    print('=== ÉTAPE 8c — re-mesure UNIVERS OKX, OOS 2024-01→2026-07, G2,5/C3 perp intégral ===')
    print(f'sous-univers shortable aux rebals ON : {med_okx} noms (méd) vs {med_all} complet '
          f'→ quintile ~{max(1, int(round(med_okx * C.TOPQ)))} vs ~{int(round(med_all * C.TOPQ))} noms')

    m_ref, _ = R.eval_cell(P, F, cnt, lastev, S, on, sg, 'C3', btc_r_perp, ts,
                           r_exec=r_exec, btc_f=F_btc)
    m_okx, _ = R.eval_cell(P, F, cnt, lastev, S, on, sg, 'C3', btc_r_perp, ts,
                           r_exec=r_exec, btc_f=F_btc, shortable=shortable)
    for nm, m in (('univers complet (réf ét.6)', m_ref), ('UNIVERS OKX ∩ vol>0', m_okx)):
        calmar = m['cagr'] / m['dd'] if m['dd'] > 0 else np.nan
        print(f"{nm:26s} | Sharpe {m['sharpe']:+5.2f} CAGR {m['cagr']:+7.1f}% "
              f"DD {m['dd']:5.1f}% Calmar {calmar:5.2f} p={m['p']:.4f} ép {m['eps_pos']}/{m['neps']}")
    ok = m_okx['sharpe'] >= 0.9
    print(f"\nBARRE (Sharpe OOS ≥ 0,9) : {m_okx['sharpe']:+.2f} → "
          f"{'DÉPLOYABLE OKX (univers réduit) ✓' if ok else 'OKX INSUFFISANT EN L ÉTAT ✗'}")


if __name__ == '__main__':
    main()
