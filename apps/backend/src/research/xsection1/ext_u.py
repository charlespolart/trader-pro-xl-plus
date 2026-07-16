#!/usr/bin/env python3
"""xsection1 — extension CONSTRUCTION du LOWVOL implémentable (pré-enregistrée
au LOG avant exécution ; barre inchangée : Sharpe ≥ 0,8 ET Calmar > 1, puis
coûts ×2 > 0,5). Variantes sur la cellule K30 :
  base : impl_u (référence 0,84 / 0,85)
  (a) vol-targeting CAUSAL : levier L(t) = clip(20 % / vol_30j(stratégie), 0,25..2),
      vol estimée sur les rendements de la stratégie JUSQU'À t−1 ;
  (b) short élargi : jambe courte = bottom 30 % du sous-univers SHORTABLE
      entier (perp actif), pas l'intersection avec le bottom global ;
  (a+b) combinées ;
  (c) beta-hedge BTC : couverture −β(60j, causal) × BTC sur le L/S de base.
p par permutation de colonnes (500), BH sur les 4 variantes.
  python3 ext_u.py"""
import subprocess

import numpy as np

from impl_u import load_funding
from xsection_u import (IS_END, IS_START, WARMUP, bh_flags, load_panel,
                        metrics, signal_matrix, universe_symbols)

TOPQ = 0.30
K = 30
DB = 'postgres://tpx:tpx@localhost:5438/tpx'


def load_btc(ts):
    q = ("COPY (SELECT open_time, close FROM candles WHERE market='spot' AND symbol='BTCUSDT' "
         "AND interval='1d' ORDER BY open_time) TO STDOUT (FORMAT csv)")
    out = subprocess.run(['psql', DB, '-c', q], capture_output=True, text=True, check=True).stdout
    d = {int(float(a)): float(b) for a, b in (line.split(',') for line in out.strip().split('\n') if line)}
    px = np.array([d.get(int(t), np.nan) for t in ts])
    lp = np.log(px)
    r = np.concatenate([[0.0], np.diff(lp)])
    return np.where(np.isfinite(r), r, 0.0)


def run_variant(P, S, ts, F, first, last, seg, wide_short=False, vt=False,
                beta_hedge=False, btc_r=None, perm=None, cost_mult=1.0):
    lp = np.log(P)
    n, na = P.shape
    r = np.vstack([np.zeros((1, na)), np.diff(lp, axis=0)])
    r = np.where(np.isfinite(r), r, 0.0)
    lo, hi = seg
    hist = np.isfinite(P).cumsum(axis=0)
    Su = S if perm is None else S[:, perm]
    out = np.zeros(hi - lo)
    w = np.zeros(na)
    hedge_w = 0.0
    lev = 1.0
    pnl_hist = []
    for t in range(lo, hi, K):
        alive = np.isfinite(Su[t]) & np.isfinite(P[t]) & (hist[t] >= WARMUP)
        idx = np.flatnonzero(alive)
        day = int(ts[t])
        neww = np.zeros(na)
        if len(idx) >= 30:
            ntop = max(1, int(round(len(idx) * TOPQ)))
            order = idx[np.argsort(Su[t][idx])]
            neww[order[-ntop:]] += 1.0 / ntop
            shortable_mask = np.array([first[a] + 7 * 86_400_000 <= day <= last[a] - 86_400_000
                                       for a in idx])
            sh_idx = idx[shortable_mask]
            if wide_short:
                if len(sh_idx) >= 10:
                    nbot = max(1, int(round(len(sh_idx) * TOPQ)))
                    sh_order = sh_idx[np.argsort(Su[t][sh_idx])]
                    for a in sh_order[:nbot]:
                        neww[a] -= 1.0 / nbot
            else:
                shortable = [a for a in order[:ntop] if a in set(sh_idx)]
                if shortable:
                    for a in shortable:
                        neww[a] -= 1.0 / len(shortable)
        # vol-targeting causal : levier depuis la vol RÉALISÉE de la stratégie
        if vt:
            if len(pnl_hist) >= 30:
                vol = np.std(pnl_hist[-30:], ddof=1) * np.sqrt(365)
                lev = float(np.clip(0.20 / max(vol, 1e-6), 0.25, 2.0))
            else:
                lev = 1.0
            neww = neww * lev
        # beta-hedge : β des 60 derniers pnl vs BTC (causal), position −β en BTC
        new_hedge = 0.0
        if beta_hedge and len(pnl_hist) >= 60:
            y = np.array(pnl_hist[-60:])
            x = btc_r[t - 60:t]
            vx = np.var(x, ddof=1)
            beta = float(np.cov(y, x, ddof=1)[0, 1] / vx) if vx > 0 else 0.0
            new_hedge = -np.clip(beta, -1.5, 1.5)
        i0 = t - lo
        out[i0] -= 0.0030 * cost_mult * (np.abs(neww - w).sum() + abs(new_hedge - hedge_w))
        w = neww
        hedge_w = new_hedge
        j1, j2 = t + 1, min(t + K, hi, n - 1) + 1
        if j1 < j2:
            blk = r[j1:j2] @ w
            ws = np.where(w < 0, w, 0.0)
            blk += -(F[j1:j2] @ ws)
            if beta_hedge and btc_r is not None:
                blk += btc_r[j1:j2] * hedge_w
            out[i0:i0 + (j2 - j1)] += blk
            pnl_hist.extend(blk.tolist())
    return out


def eval_variant(P, S, ts, F, first, last, seg, btc_r, nperm=500, **kw):
    real = run_variant(P, S, ts, F, first, last, seg, btc_r=btc_r, **kw)
    m = metrics(real)
    rng = np.random.default_rng(7)
    cnt = 0
    for _ in range(nperm):
        null = run_variant(P, S, ts, F, first, last, seg, btc_r=btc_r,
                           perm=rng.permutation(P.shape[1]), **kw)
        sd = null.std(ddof=1)
        if (null.mean() / sd * np.sqrt(365) if sd > 0 else -9) >= m['sharpe']:
            cnt += 1
    m['p'] = (1 + cnt) / (1 + nperm)
    return m, real


def main():
    syms = universe_symbols()
    ts, P = load_panel(syms)
    seg = (int(np.searchsorted(ts, IS_START)), int(np.searchsorted(ts, IS_END)))
    S = signal_matrix(P, 'LOWVOL', dict())
    F, first, last = load_funding(syms, ts)
    btc_r = load_btc(ts)

    variants = [
        ('base', dict()),
        ('(a) vol-target', dict(vt=True)),
        ('(b) short élargi', dict(wide_short=True)),
        ('(a+b)', dict(vt=True, wide_short=True)),
        ('(c) beta-hedge', dict(beta_hedge=True)),
    ]
    rows = []
    print('=== EXTENSION CONSTRUCTION (K30, implémentable, 500 perms) ===')
    for name, kw in variants:
        m, real = eval_variant(P, S, ts, F, first, last, seg, btc_r, **kw)
        calmar = m['cagr'] / m['dd'] if m['dd'] > 0 else np.nan
        m2 = metrics(run_variant(P, S, ts, F, first, last, seg, btc_r=btc_r, cost_mult=2.0, **kw))
        ok = m['sharpe'] >= 0.8 and calmar > 1 and m2['sharpe'] > 0.5
        rows.append(dict(name=name, p=m['p'], ok=ok))
        print(f"{name:18s}: Sharpe {m['sharpe']:+5.2f} CAGR {m['cagr']:+7.1f}% DD {m['dd']:5.1f}% "
              f"Calmar {calmar:4.2f} p={m['p']:.4f} | ×2: {m2['sharpe']:+5.2f} → "
              f"{'BARRE TENUE' if ok else 'sous la barre'}")
    flags = bh_flags([r['p'] for r in rows])
    surv = [r['name'] for r, f in zip(rows, flags) if f and r['ok']]
    print(f"\nsurvivants (BH ∧ barre complète) : {surv if surv else 'AUCUN'}")


if __name__ == '__main__':
    main()
