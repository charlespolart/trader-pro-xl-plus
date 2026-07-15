#!/usr/bin/env python3
"""patterns-crypto volet 2 — CONFLUENCE par synergie de permutation.
Pré-enregistré avant exécution (leçon confluence1 actions : la confluence
CONCENTRE un edge vivant, elle n'en crée pas — le juge de paix est p_syn) :

- Entrées : E_donch = cassure Donchian55×vol1,5 en bull 1d (l'edge maison,
  réfractaire 30) ; E_base = cassures de base CUP+ROUND-bottom v2 (configs
  canoniques k5∪k8, dédup) — les 2 flux « vivants » du chantier.
- Facteurs (usage canonique, calculés à la barre de signal, causaux) :
  rsi_mom (50<RSI14<70), adx25 (ADX14>25), macd_pos (hist>0),
  vol_burst (v>1,5×SMA20), bb_up (close>SMA20), atr_calm (ATRpct100<70).
- Combos : tous les sous-ensembles de 1-2 facteurs (21) × 2 entrées = 42.
- Mesure : fwd 30 barres directionnel poolé BTC+ETH ; p_rot (rotation
  combinée) pour l'effet absolu ; **p_syn** = P(un sous-ensemble ALÉATOIRE de
  même taille de l'entrée fasse ≥ le sous-ensemble sélectionné) sur 2000
  tirages (par segment, tailles appariées).
- Barre : n≥20 ; amélioration >0 vs entrée seule ; p_syn<0,05 ; survivant
  BH-FDR 10 % sur les p_rot des 42.
"""
import itertools

import numpy as np

from detect import detect_cup, detect_rounding, rsi14
from lib import IS_END, IS_START, NMIN, fwd_logret, load, seg_of, swings

H = 30


def ema_arr(x, p):
    out = np.full(len(x), np.nan)
    v, cnt, acc = None, 0, 0.0
    a = 2 / (p + 1)
    for i, xi in enumerate(x):
        if v is None:
            acc += xi
            cnt += 1
            if cnt == p:
                v = acc / p
                out[i] = v
            continue
        v = a * xi + (1 - a) * v
        out[i] = v
    return out


def rma_arr(x, p):
    out = np.full(len(x), np.nan)
    v, cnt, acc = None, 0, 0.0
    for i, xi in enumerate(x):
        if v is None:
            acc += xi
            cnt += 1
            if cnt == p:
                v = acc / p
                out[i] = v
            continue
        v = (xi + (p - 1) * v) / p
        out[i] = v
    return out


def factors(px):
    o, h, l, c, v = px['o'], px['h'], px['l'], px['c'], px['v']
    n = len(c)
    r = rsi14(c)
    macd = ema_arr(c, 12) - ema_arr(c, 26)
    mfin = np.isfinite(macd)
    sig = np.full(n, np.nan)
    sig[mfin] = ema_arr(macd[mfin], 9)
    hist = macd - sig
    tr = np.empty(n)
    tr[0] = h[0] - l[0]
    tr[1:] = np.maximum.reduce([h[1:] - l[1:], np.abs(h[1:] - c[:-1]), np.abs(l[1:] - c[:-1])])
    upm = np.concatenate([[0.0], h[1:] - h[:-1]])
    dnm = np.concatenate([[0.0], l[:-1] - l[1:]])
    pdm = np.where((upm > dnm) & (upm > 0), upm, 0.0)
    mdm = np.where((dnm > upm) & (dnm > 0), dnm, 0.0)
    str_ = rma_arr(tr[1:], 14)
    pdi = 100 * rma_arr(pdm[1:], 14) / str_
    mdi = 100 * rma_arr(mdm[1:], 14) / str_
    with np.errstate(invalid='ignore'):
        dx = np.where(pdi + mdi == 0, 0.0, 100 * np.abs(pdi - mdi) / (pdi + mdi))
    dxf = np.isfinite(dx)
    adxd = np.full(n - 1, np.nan)
    adxd[dxf] = rma_arr(dx[dxf], 14)
    adx = np.concatenate([[np.nan], adxd])
    cs = np.cumsum(v)
    vs = np.full(n, np.nan)
    vs[20:] = (cs[20:] - cs[:-20]) / 20
    css = np.cumsum(c)
    sma20 = np.full(n, np.nan)
    sma20[20:] = (css[20:] - css[:-20]) / 20
    atr14 = rma_arr(tr, 14)
    rel = atr14 / c
    apc = np.full(n, np.nan)
    hist_a = []
    for i in range(n):
        if not np.isfinite(rel[i]):
            continue
        hist_a.append(rel[i])
        if len(hist_a) > 100:
            hist_a.pop(0)
        if len(hist_a) == 100:
            apc[i] = 100 * sum(1 for x in hist_a if x <= rel[i]) / 100
    return {
        'rsi_mom': (r > 50) & (r < 70),
        'adx25': adx > 25,
        'macd_pos': hist > 0,
        'vol_burst': v > 1.5 * vs,
        'bb_up': c > sma20,
        'atr_calm': apc < 70,
    }


def entries_donch(px, d1):
    e = ema_arr(d1['c'], 200)
    bull = d1['c'] > e
    ct1 = d1['ct']
    n = len(px['c'])
    h, v, c = px['h'], px['v'], px['c']
    don = np.full(n, np.nan)
    for i in range(56, n):
        don[i] = h[i - 55:i].max()
    cs = np.cumsum(v)
    vs = np.full(n, np.nan)
    vs[20:] = (cs[20:] - cs[:-20]) / 20
    ev = []
    last = -10**9
    for i in range(56, n):
        if i < last + 30 or not np.isfinite(don[i]) or not np.isfinite(vs[i]):
            continue
        j = np.searchsorted(ct1, px['ct'][i], side='left') - 1
        if j < 0 or not np.isfinite(e[j]) or not bull[j]:
            continue
        if c[i] > don[i] and v[i] > 1.5 * vs[i]:
            ev.append(i)
            last = i
    return np.array(ev, dtype=int)


def entries_base(px, spines):
    ev = []
    for k in (5, 8):
        for e in detect_cup(px, spines[k], k, 0.06, 0):
            ev.append(e['sig'])
        for e in detect_rounding(px, spines[k], k, 0.5, 0):
            ev.append(e['sig'])
    return np.array(sorted(set(ev)), dtype=int)


def eval_pooled(parts, idx_by, nrot=1000, seed=7):
    rng = np.random.default_rng(seed)
    num = den = 0.0
    for (fwd, span), idx in zip(parts, idx_by):
        num += float(np.nansum(fwd[idx]))
        den += len(idx)
    if den < NMIN:
        return dict(n=int(den), obs=np.nan, p=np.nan)
    obs = num / den
    nulls = np.empty(nrot)
    for r in range(nrot):
        s = 0.0
        for (fwd, span), idx in zip(parts, idx_by):
            dd = int(rng.integers(H + 5, span - H - 5))
            s += float(np.nansum(fwd[(idx + dd) % span]))
        nulls[r] = s / den
    return dict(n=int(den), obs=obs * 1e4,
                p=(1 + float((nulls >= obs).sum())) / (1 + nrot))


def p_syn(parts, base_by, sel_by, base_obs_sel, ndraw=2000, seed=11):
    """P(sous-ensemble aléatoire de même taille ≥ sélection), tailles par segment."""
    rng = np.random.default_rng(seed)
    cnt = 0
    for _ in range(ndraw):
        num = den = 0.0
        for (fwd, span), base, sel in zip(parts, base_by, sel_by):
            if len(sel) == 0 or len(base) == 0:
                continue
            take = rng.choice(len(base), size=min(len(sel), len(base)), replace=False)
            vals = fwd[base[take]]
            num += float(np.nansum(vals))
            den += len(take)
        if den > 0 and num / den >= base_obs_sel:
            cnt += 1
    return (1 + cnt) / (1 + ndraw)


def bh_flags(ps, q=0.10):
    ps = np.asarray(ps, dtype=float)
    ok = np.isfinite(ps)
    flags = np.zeros(len(ps), bool)
    if ok.sum() == 0:
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
    data = []
    for sym in ('BTCUSDT', 'ETHUSDT'):
        px = load(sym, '4h')
        d1 = load(sym, '1d')
        lo, hi = seg_of(px, IS_START, IS_END)
        lo = max(lo, 60)
        fwd = fwd_logret(px['c'], H)[lo:hi]
        spines = {k: swings(px, k) for k in (5, 8)}
        F = factors(px)
        E = {'donch': entries_donch(px, d1), 'base': entries_base(px, spines)}
        data.append(dict(px=px, seg=(lo, hi), fwd=fwd, F=F, E=E))

    parts = [(d['fwd'], d['seg'][1] - d['seg'][0]) for d in data]
    fnames = list(data[0]['F'].keys())
    rows = []
    for ename in ('donch', 'base'):
        base_by = []
        for d in data:
            lo, hi = d['seg']
            idx = d['E'][ename]
            base_by.append(idx[(idx >= lo) & (idx < hi)] - lo)
        r0 = eval_pooled(parts, base_by)
        print(f"\nENTRÉE {ename}: n={r0['n']} obs {r0['obs']:+.1f} bps p_rot={r0['p']:.4f}")
        for size in (1, 2):
            for combo in itertools.combinations(fnames, size):
                sel_by = []
                for d, base in zip(data, base_by):
                    lo, hi = d['seg']
                    mask = np.ones(len(base), dtype=bool)
                    for f in combo:
                        arr = d['F'][f]
                        mask &= np.array([bool(arr[i + lo]) if np.isfinite(float(arr[i + lo]))
                                          else False for i in base])
                    sel_by.append(base[mask])
                r = eval_pooled(parts, sel_by)
                if not np.isfinite(r['obs']):
                    rows.append(dict(e=ename, c='+'.join(combo), n=r['n'], obs=np.nan,
                                     p=np.nan, syn=np.nan, d=np.nan))
                    continue
                syn = p_syn(parts, base_by, sel_by, r['obs'] / 1e4)
                rows.append(dict(e=ename, c='+'.join(combo), n=r['n'], obs=r['obs'],
                                 p=r['p'], syn=syn, d=r['obs'] - r0['obs']))

    flags = bh_flags([r['p'] for r in rows])
    print(f"\n{'entrée':6s} {'confirmation':22s} {'n':>5s} {'obs':>8s} {'Δvs seule':>9s} {'p_rot':>7s} {'p_syn':>7s}")
    surv = 0
    for r, f in zip(rows, flags):
        if not np.isfinite(r['obs']):
            continue
        keep = f and r['d'] > 0 and r['syn'] < 0.05 and r['n'] >= 20
        tag = ' ← SURVIVANT' if keep else ''
        surv += keep
        if keep or r['syn'] < 0.10 or abs(r['d']) > 80:
            print(f"{r['e']:6s} {r['c']:22s} {r['n']:5d} {r['obs']:+8.1f} {r['d']:+9.1f} "
                  f"{r['p']:7.4f} {r['syn']:7.4f}{tag}")
    print(f"\n{surv} survivant(s) à la barre jointe (BH(p_rot) ∧ p_syn<0,05 ∧ Δ>0) sur {len(rows)} combos")


if __name__ == '__main__':
    main()
