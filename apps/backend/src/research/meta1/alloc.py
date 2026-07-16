#!/usr/bin/env python3
"""meta1 — méta-portefeuille (protocole LOG.md committé AVANT).
3 règles figées (EQ, REAL buy&hold, IVOL WF mensuel 63 j) × sleeve regime1
{0,5,10,20,30 %} à vol égalisée. Fenêtre commune 2020-10→2026-07 (démarrage
IVOL : 63 j d'historique requis — consigné) + OOS 2024→26.
  python3 alloc.py"""
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'regime1'))
import duel as D  # noqa: E402  (loaders + conventions de regime1)

DAY = 86_400_000
SLEEVES = (0.0, 0.05, 0.10, 0.20, 0.30)
COMMON = ('2020-10-01', '2026-07-01')
OOS = ('2024-01-01', '2026-07-01')
REAL_QTY = dict(accum=0.198, vrx=0.198, eth=3.9966)   # tailles réelles des bots


def load_close(symbol, ts):
    q = (f"COPY (SELECT open_time, close FROM candles WHERE market='spot' AND symbol='{symbol}' "
         "AND interval='1d' ORDER BY open_time) TO STDOUT (FORMAT csv)")
    out = subprocess.run(['psql', D.DB, '-c', q], capture_output=True, text=True, check=True).stdout
    d = {int(float(a)): float(b) for a, b in (line.split(',') for line in out.strip().split('\n') if line)}
    px = np.array([d.get(int(t), np.nan) for t in ts])
    if not np.isfinite(px).all():
        raise RuntimeError(f'close {symbol} manquant')
    return px


def load_eth_equity(ts):
    days = {}
    with open(os.path.join(HERE, 'incumbent_eth.csv')) as f:
        next(f)
        for line in f:
            t, e = line.strip().split(',')
            days[int(t) // DAY] = float(e)
    eq = np.full(len(ts), np.nan)
    last = np.nan
    for i, t in enumerate(ts):
        v = days.get(int(t) // DAY)
        if v is not None:
            last = v
        eq[i] = last
    return eq


def month_key(t):
    d = np.datetime64(int(t), 'ms').astype('datetime64[M]')
    return str(d)


def ivol_weights(rlist, ts, lo, hi, look=63):
    """poids ∝ 1/vol(63 j passés), recalcul au 1er jour de chaque mois, zéro lookahead."""
    n = len(ts)
    W = np.zeros((n, len(rlist)))
    cur = None
    prev_m = None
    for t in range(lo, hi):
        mk = month_key(ts[t])
        if mk != prev_m:
            prev_m = mk
            if t >= look:
                vols = np.array([r[t - look:t].std(ddof=1) for r in rlist])
                inv = np.where(vols > 0, 1.0 / vols, 0.0)
                cur = inv / inv.sum() if inv.sum() > 0 else None
        if cur is not None:
            W[t] = cur
    return W


def fmt(nm, x):
    return (f"{nm:24s} | Sharpe {x['sharpe']:+5.2f} CAGR {x['cagr']:+7.1f}% "
            f"DD {x['dd']:5.1f}% Calmar {x['calmar']:5.2f}")


def main():
    ts, r_sleeve, _on = D.load_regime()
    btc = D.load_btc_close(ts)
    eth_px = load_close('ETHUSDT', ts)
    eq_sw = D.load_equity_daily('swing', ts)
    eq_ac = D.load_equity_daily('accum', ts) * btc
    eq_vx = D.load_equity_daily('vrx', ts) * btc
    eq_et = load_eth_equity(ts) * eth_px
    r_sw, r_ac, r_vx, r_et = (D.rets(e) for e in (eq_sw, eq_ac, eq_vx, eq_et))
    motors = [('accum', r_ac), ('vrx', r_vx), ('eth', r_et), ('swing', r_sw)]

    names = [n for n, _ in motors] + ['regime1']
    series = [r for _, r in motors] + [r_sleeve]
    wf = (ts >= D.dms(COMMON[0])) & (ts < D.dms(COMMON[1]))
    print('=== meta1 — corrélations quotidiennes (fenêtre commune 2020-10→2026-07) ===')
    print('        ' + ''.join(f'{n:>8s}' for n in names))
    for i, ni in enumerate(names):
        row = ''.join(f'{np.corrcoef(series[i][wf], series[j][wf])[0, 1]:+8.2f}' for j in range(len(names)))
        print(f'{ni:8s}{row}')

    # règles de base (rendements quotidiens sur tout ts ; éval par fenêtre)
    lo_c, hi_c = int(np.searchsorted(ts, D.dms(COMMON[0]))), int(np.searchsorted(ts, D.dms(COMMON[1])))
    rlist = [r for _, r in motors]
    r_eq = sum(rlist) / 4.0
    # R-REAL : buy&hold sans rebal, poids USD de départ au 1er jour de la fenêtre commune
    w0 = np.array([REAL_QTY['accum'] * btc[lo_c], REAL_QTY['vrx'] * btc[lo_c],
                   REAL_QTY['eth'] * eth_px[lo_c]])
    w0 = w0 / w0.sum()
    grow = [np.cumprod(1.0 + r[lo_c:hi_c]) for r in (r_ac, r_vx, r_et)]
    eq_real = w0[0] * grow[0] + w0[1] * grow[1] + w0[2] * grow[2]
    r_real = np.zeros(len(ts))
    r_real[lo_c + 1:hi_c] = eq_real[1:] / eq_real[:-1] - 1.0
    W_iv = ivol_weights(rlist, ts, lo_c, hi_c)
    r_iv = np.zeros(len(ts))
    for t in range(lo_c, hi_c):
        r_iv[t] = float(sum(W_iv[t, k] * rlist[k][t] for k in range(4)))

    for wlab, a, b in (('FENÊTRE COMMUNE 2020-10→2026-07', *COMMON),
                       ('OOS 2024-01→2026-07', *OOS)):
        w = (ts >= D.dms(a)) & (ts < D.dms(b))
        print(f'\n=== {wlab} — règles × sleeve regime1 (vol égalisée vs w=0) ===')
        for rlab, r_rule in (('R-EQ (¼ chacun)', r_eq), ('R-REAL (b&h réel, sans swing)', r_real),
                             ('R-IVOL (1/vol63 WF mensuel)', r_iv)):
            base_m = D.m(r_rule[w])
            line = [f'{rlab:30s}']
            for sl in SLEEVES:
                rc = (1 - sl) * r_rule + sl * r_sleeve
                scale = r_rule[w].std(ddof=1) / rc[w].std(ddof=1) if rc[w].std(ddof=1) > 0 else 1.0
                mm = D.m(scale * rc[w]) if sl > 0 else base_m
                line.append(f'w{int(sl * 100):02d}: {mm["cagr"]:+6.1f}%/{mm["dd"]:4.1f}%/C{mm["calmar"]:4.2f}')
            print('  ' + ' | '.join(line))

    # zooms stress (R-EQ, w=0 vs w=20)
    print('\n=== zooms stress (R-EQ : w=0 vs w=20 %, vol égalisée) ===')
    for zlab, a, b in (('bear 2022', '2022-01-01', '2023-01-01'), ('2026-H1', '2026-01-01', '2026-07-01')):
        w = (ts >= D.dms(a)) & (ts < D.dms(b))
        r20 = 0.8 * r_eq + 0.2 * r_sleeve
        scale = r_eq[w].std(ddof=1) / r20[w].std(ddof=1)
        m0, m20 = D.m(r_eq[w]), D.m(scale * r20[w])
        print(f'  {zlab:10s} : w=0 {m0["cagr"]:+6.1f}%/DD {m0["dd"]:4.1f}%  →  w=20 {m20["cagr"]:+6.1f}%/DD {m20["dd"]:4.1f}%')


if __name__ == '__main__':
    main()
