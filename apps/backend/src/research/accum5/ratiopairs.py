#!/usr/bin/env python3
# accum5 Track A : donchian 15/5 PAR PAIRE sur les paires BTC exécutables OKX
# (ETHBTC, SOLBTC). Params IMPORTÉS d'accum2/X2, jamais re-fittés ici.
# Dénomination quote (BTC) : flat = 0%, long alt quand cassure du plus-haut 15j,
# retour BTC sur cassure du plus-bas 5j. Frais 0,15%/côté (stress 0,20/0,30).
# Gate structurel PRÉ-ENREGISTRÉ (testé IS only) : VETO si BTC en bear confirmé
# (EMA200 1d < prix ET en déclin 30j — le confirm de la v2).
#   python3 ratiopairs.py         # IS + gate + panier + stress
#   python3 ratiopairs.py oos     # look n°2 DÉCLARÉ (critères pré-enregistrés)
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'accum3'))
from lib import IS_END, IS_START, OOS_END, align_to, ema, load, shift

FEE = 0.0015
N_ENTRY, M_EXIT = 15, 5  # X2, gelés
HALF = np.datetime64('2021-02-17').astype('datetime64[ms]').astype(np.int64)


def btc_bear_veto():
    d1 = load('BTCUSDT', '1d')
    e200 = ema(d1['c'], 200)
    bear = (d1['c'] < e200) & (shift(e200, 30) > e200)
    return d1['ct'], bear.astype(float)


def sim(sym: str, t0, t1, fee=FEE, veto=None):
    X = load(sym, '1d')
    if not X:
        return None
    t, o, c, h, l = X['t'], X['o'], X['c'], X['h'], X['l']
    hh = np.full(len(c), np.nan)
    ll = np.full(len(c), np.nan)
    from lib import roll_max, roll_min
    hh[1:] = roll_max(h, N_ENTRY)[:-1]  # plus-haut des 15 jours PRÉCÉDENTS
    ll[1:] = roll_min(l, M_EXIT)[:-1]
    v = None
    if veto is not None:
        vt, vv = veto
        v = align_to(t, vt, vv) == 1.0
    idx = np.where((t >= t0) & (t < t1))[0]
    btc, alt, state, pend = 1.0, 0.0, 0, None
    eq = np.ones(len(idx))
    trades, excs = 0, []
    entry_px = 0.0
    for j, i in enumerate(idx):
        if pend is not None:
            px = o[i]
            if pend == 1:
                alt, btc = btc / px * (1 - fee), 0.0
                entry_px = px
            else:
                btc, alt = alt * px * (1 - fee), 0.0
                excs.append(px / entry_px * (1 - fee) ** 2 - 1)
            state, pend = pend, None
            trades += 1
        eq[j] = btc + alt * c[i]
        blocked = bool(v[i]) if v is not None else False
        if state == 0 and not blocked and np.isfinite(hh[i]) and c[i] > hh[i]:
            pend = 1
        elif state == 1 and ((np.isfinite(ll[i]) and c[i] < ll[i]) or blocked):
            pend = 0
    peak = np.maximum.accumulate(eq)
    tm = t[idx]
    h1 = tm < HALF
    n1 = (eq[h1][-1] / eq[h1][0] - 1) * 100 if h1.sum() > 1 else np.nan
    n2 = (eq[~h1][-1] / eq[~h1][0] - 1) * 100 if (~h1).sum() > 1 else np.nan
    ex = np.array(excs)
    return {'net': (eq[-1] - 1) * 100, 'dd': ((eq - peak) / peak).min() * 100,
            'tr': trades, 'n1': n1, 'n2': n2, 'eq': eq, 't': tm,
            'wr': (ex > 0).mean() * 100 if len(ex) else np.nan,
            'nexc': len(ex), 'best': ex.max() * 100 if len(ex) else np.nan,
            'worst': ex.min() * 100 if len(ex) else np.nan}


def yearly(r):
    ys = (r['t'].astype('datetime64[ms]').astype('datetime64[Y]')).astype(int) + 1970
    out = []
    for y in np.unique(ys):
        seg = r['eq'][ys == y]
        if len(seg) > 1:
            out.append(f'{y}:{(seg[-1] / seg[0] - 1) * 100:+.0f}%')
    return ' '.join(out)


def fmt(r):
    return (f"net {r['net']:+8.1f}%  DD {r['dd']:+6.1f}%  {r['tr']:3d}tr  {r['nexc']:3d}exc  "
            f"WR {r['wr']:3.0f}%  pire {r['worst']:+.1f}%  | {yearly(r)}")


def basket(rs):
    """panier équipondéré des équités alignées par temps (dates communes)."""
    ts = set(rs[0]['t'].tolist())
    for r in rs[1:]:
        ts &= set(r['t'].tolist())
    ts = np.array(sorted(ts))
    eqs = []
    for r in rs:
        m = np.isin(r['t'], ts)
        e = r['eq'][m]
        eqs.append(e / e[0])
    mix = np.mean(eqs, axis=0)
    peak = np.maximum.accumulate(mix)
    return {'net': (mix[-1] - 1) * 100, 'dd': ((mix - peak) / peak).min() * 100,
            'eq': mix, 't': ts, 'tr': sum(r['tr'] for r in rs), 'nexc': sum(r['nexc'] for r in rs),
            'wr': np.nan, 'worst': np.nan}


def main():
    oos = len(sys.argv) > 1 and sys.argv[1] == 'oos'
    veto = btc_bear_veto()
    if oos:
        print('=== OOS 2024-01→2026-07 — LOOK N°2 DÉCLARÉ (config figée : donchian 15/5,')
        print('    SANS veto (S2 : non répliqué), panier 50/50 ETHBTC+SOLBTC, frais 0,15%) ===')
        print('    Critères pré-enregistrés (LOG accum5) : panier net > 0 ET DD panier > -30%')
        print('    ET chaque paire > -10%. Sinon NO-GO définitif (2 looks épuisés).')
        rs = []
        for sym in ('ETHBTC', 'SOLBTC'):
            r = sim(sym, IS_END, OOS_END)
            print(f'  {sym}: {fmt(r)}')
            rs.append(r)
        b = basket(rs)
        print(f"  PANIER 50/50 : net {b['net']:+.1f}%  DD {b['dd']:+.1f}%")
        return
    t0, t1 = IS_START, IS_END
    print('=== Track A IS 2018-04→2024-01 (SOLBTC : depuis listing 2020-08) ===')
    print('-- sans gate')
    rs_ng = []
    for sym in ('ETHBTC', 'SOLBTC'):
        r = sim(sym, t0, t1)
        print(f'  {sym}: {fmt(r)}')
        rs_ng.append(r)
    print('-- avec VETO bear-BTC (pré-enregistré)')
    rs = []
    for sym in ('ETHBTC', 'SOLBTC'):
        r = sim(sym, t0, t1, veto=veto)
        print(f'  {sym}: {fmt(r)}')
        rs.append(r)
    print('-- paniers 50/50 (dates communes = depuis listing SOL)')
    for lbl, rr in (('sans gate', rs_ng), ('avec veto', rs)):
        b = basket(rr)
        print(f'  {lbl:10}: net {b["net"]:+8.1f}%  DD {b["dd"]:+6.1f}%')
    print('-- stress frais (avec veto)')
    for fee in (0.002, 0.003):
        for sym in ('ETHBTC', 'SOLBTC'):
            r = sim(sym, t0, t1, fee=fee, veto=veto)
            print(f'  {sym} fee {fee * 100:.2f}%: net {r["net"]:+8.1f}%  DD {r["dd"]:+6.1f}%')


if __name__ == '__main__':
    main()
