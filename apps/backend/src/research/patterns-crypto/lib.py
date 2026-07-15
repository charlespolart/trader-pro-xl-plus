#!/usr/bin/env python3
"""patterns-crypto — socle : données (base canonique 5438), pivots (convention
IDENTIQUE au moteur TS fractalPivots — vérifiée bit à bit en audit1/A1 :
gauche stricte, droite non stricte, confirmé à i+k), ATR, éval par rotation
circulaire, trades canoniques (stop PRIORITAIRE), BH-FDR."""
import subprocess

import numpy as np

DB = 'postgres://tpx:tpx@localhost:5438/tpx'
IS_START = np.datetime64('2017-08-01').astype('datetime64[ms]').astype(np.int64)
IS_END = np.datetime64('2024-01-01').astype('datetime64[ms]').astype(np.int64)
OOS_END = np.datetime64('2026-07-01').astype('datetime64[ms]').astype(np.int64)
COST_AR_BPS = 30.0          # taker 0,10 % + slip 0,05 % par côté = 30 bps AR
H_PRIM = 30                 # horizon primaire (barres) — pré-enregistré
NMIN = 20


def load(symbol: str, interval: str) -> dict:
    q = (f"COPY (SELECT open_time, open, high, low, close, volume, close_time "
         f"FROM candles WHERE market='spot' AND symbol='{symbol}' AND interval='{interval}' "
         f"ORDER BY open_time) TO STDOUT (FORMAT csv)")
    out = subprocess.run(['psql', DB, '-c', q], capture_output=True, text=True, check=True).stdout
    rows = [line.split(',') for line in out.strip().split('\n') if line]
    a = np.array(rows, dtype=float)
    return {'t': a[:, 0].astype(np.int64), 'o': a[:, 1], 'h': a[:, 2], 'l': a[:, 3],
            'c': a[:, 4], 'v': a[:, 5], 'ct': a[:, 6].astype(np.int64)}


def atr(px: dict, period: int = 20) -> np.ndarray:
    h, l, c = px['h'], px['l'], px['c']
    n = len(c)
    tr = np.empty(n)
    tr[0] = h[0] - l[0]
    tr[1:] = np.maximum.reduce([h[1:] - l[1:], np.abs(h[1:] - c[:-1]), np.abs(l[1:] - c[:-1])])
    out = np.full(n, np.nan)
    v = np.nan
    acc = 0.0
    for i in range(n):
        if not np.isfinite(v):
            acc += tr[i]
            if i == period - 1:
                v = acc / period
                out[i] = v
            continue
        v = (tr[i] + (period - 1) * v) / period
        out[i] = v
    return out


def swings(px: dict, k: int) -> list:
    """Pivots confirmés, alternés (collapse au plus extrême). [(i,'H'|'L',prix,conf)]
    conf = i + k = première barre où le pivot est CONNU. Convention vérifiée
    identique à fractalPivots TS (gauche stricte, droite non stricte)."""
    h, l = px['h'], px['l']
    n = len(h)
    piv = []
    for i in range(k, n - k):
        wl_h, wr_h = h[i - k:i], h[i + 1:i + k + 1]
        wl_l, wr_l = l[i - k:i], l[i + 1:i + k + 1]
        if (wl_h < h[i]).all() and (wr_h <= h[i]).all():
            piv.append([i, 'H', h[i], i + k])
        if (wl_l > l[i]).all() and (wr_l >= l[i]).all():
            piv.append([i, 'L', l[i], i + k])
    piv.sort(key=lambda t: (t[0], t[1]))
    alt = []
    for p in piv:
        if alt and alt[-1][1] == p[1]:
            if (p[1] == 'H' and p[2] >= alt[-1][2]) or (p[1] == 'L' and p[2] <= alt[-1][2]):
                alt[-1] = p
        else:
            alt.append(p)
    return alt


def trend_ok(c: np.ndarray, i: int, direction: int, T: int = 40, g: float = 0.03) -> bool:
    """direction +1 : exige log-ret ≥ +g sur les T barres finissant à i."""
    if i - T < 0 or c[i - T] <= 0:
        return False
    r = float(np.log(c[i] / c[i - T]))
    return r >= g if direction > 0 else r <= -g


def trend_amp(c: np.ndarray, i: int, T: int = 40) -> float:
    """log-ret signé sur les T barres finissant à i (pour le score)."""
    if i - T < 0 or c[i - T] <= 0:
        return 0.0
    return float(np.log(c[i] / c[i - T]))


def dedup(ev: list) -> list:
    seen, out = set(), []
    for e in sorted(ev, key=lambda e: e['sig']):
        if e['sig'] in seen:
            continue
        seen.add(e['sig'])
        out.append(e)
    return out


def fwd_logret(c: np.ndarray, h: int) -> np.ndarray:
    out = np.full(len(c), np.nan)
    out[:-h] = np.log(c[h:] / c[:-h])
    return out


def eval_events(px: dict, events: list, seg: tuple, h: int = H_PRIM,
                nrot: int = 1000, seed: int = 7) -> dict:
    """Moyenne du fwd directionnel + null par ROTATION CIRCULAIRE des
    événements (préserve clustering et dérive). p unilatéral."""
    fwd = fwd_logret(px['c'], h)
    lo, hi = seg
    idx = np.array([e['sig'] for e in events], dtype=int)
    dirs = np.array([e['dir'] for e in events], dtype=float)
    m = (idx >= lo) & (idx < hi)
    idx, dirs = idx[m], dirs[m]
    if len(idx) < NMIN:
        return dict(n=int(len(idx)), obs=np.nan, p=np.nan)
    obs = float(np.nanmean(dirs * fwd[idx]))
    span = hi - lo
    rel = idx - lo
    rng = np.random.default_rng(seed)
    nulls = np.empty(nrot)
    for r in range(nrot):
        dd = int(rng.integers(h + 5, span - h - 5))
        nulls[r] = np.nanmean(dirs * fwd[lo + (rel + dd) % span])
    p = (1 + float((nulls >= obs).sum())) / (1 + nrot)
    return dict(n=int(len(idx)), obs=obs * 1e4, p=p)


def eval_trades(px: dict, events: list, seg: tuple, cost: float = COST_AR_BPS,
                max_hold: int = 60) -> dict:
    """Trade canonique : entrée à l'OPEN de sig+1, stop/objectif de la figure,
    gaps servis à l'open, STOP PRIORITAIRE si stop+objectif même barre
    (convention conservatrice pré-enregistrée), timeout max_hold barres."""
    o, h, l, c = px['o'], px['h'], px['l'], px['c']
    n = len(c)
    lo, hi = seg
    res = []
    for e in events:
        b = e['sig']
        if not (lo <= b < hi) or b + 1 >= n or 'stop' not in e:
            continue
        en, st, tg, dr = o[b + 1], e['stop'], e['target'], e['dir']
        if dr > 0 and not (st < en < tg):
            continue
        if dr < 0 and not (tg < en < st):
            continue
        ex = None
        for j in range(b + 1, min(n, b + 1 + max_hold)):
            if j > b + 1:  # gap à l'open
                if (dr < 0 and o[j] >= st) or (dr > 0 and o[j] <= st):
                    ex = (o[j], 'stop')
                    break
                if (dr < 0 and o[j] <= tg) or (dr > 0 and o[j] >= tg):
                    ex = (o[j], 'target')
                    break
            if dr < 0:
                if h[j] >= st:
                    ex = (st, 'stop')
                    break
                if l[j] <= tg:
                    ex = (tg, 'target')
                    break
            else:
                if l[j] <= st:
                    ex = (st, 'stop')
                    break
                if h[j] >= tg:
                    ex = (tg, 'target')
                    break
        if ex is None:
            ex = (c[min(n - 1, b + max_hold)], 'time')
        res.append((dr * (ex[0] - en) / en * 1e4 - cost, ex[1]))
    if len(res) < NMIN:
        return dict(n=int(len(res)), exp=np.nan, win=np.nan, t=np.nan)
    v = np.array([r[0] for r in res])
    win = float(np.mean([r[1] == 'target' for r in res]))
    t = float(v.mean() / (v.std(ddof=1) / np.sqrt(len(v)) + 1e-12))
    return dict(n=int(len(v)), exp=float(v.mean()), win=win, t=t)


def eval_events_pooled(pxs: list, events_list: list, segs: list, h: int = H_PRIM,
                       nrot: int = 1000, seed: int = 7) -> dict:
    """Éval POOLÉE multi-segments (ex. BTC+ETH) : obs = moyenne des dir·fwd sur
    l'union ; null = rotation circulaire INDÉPENDANTE par segment, combinée par
    la même moyenne. Amendement pré-enregistré 2026-07-15 (phase garde-fous,
    AVANT tout IS) : la puissance vient de la réplication."""
    rng = np.random.default_rng(seed)
    parts = []
    for px, events, seg in zip(pxs, events_list, segs):
        lo, hi = seg
        fwd = fwd_logret(px['c'], h)[lo:hi]
        idx = np.array([e['sig'] for e in events], dtype=int)
        dirs = np.array([e['dir'] for e in events], dtype=float)
        m = (idx >= lo) & (idx < hi)
        if m.sum() == 0:
            continue
        parts.append((fwd, idx[m] - lo, hi - lo, dirs[m]))
    ntot = int(sum(len(p[1]) for p in parts))
    if ntot < NMIN:
        return dict(n=ntot, obs=np.nan, p=np.nan)
    num = sum(float(np.nansum(d * f[r])) for f, r, s, d in parts)
    obs = num / ntot
    nulls = np.empty(nrot)
    for k in range(nrot):
        acc = 0.0
        for f, r, s, d in parts:
            dd = int(rng.integers(h + 5, s - h - 5))
            acc += float(np.nansum(d * f[(r + dd) % s]))
        nulls[k] = acc / ntot
    p = (1 + float((nulls >= obs).sum())) / (1 + nrot)
    return dict(n=ntot, obs=obs * 1e4, p=p)


def bh_flags(ps, q: float = 0.10) -> np.ndarray:
    ps = np.asarray(ps, dtype=float)
    ok = np.isfinite(ps)
    flags = np.zeros(len(ps), bool)
    if ok.sum() == 0:
        return flags
    sub = ps[ok]
    order = np.argsort(sub)
    kmax, mtot = 0, len(sub)
    for r, oi in enumerate(order, 1):
        if sub[oi] <= q * r / mtot:
            kmax = r
    if kmax == 0:
        return flags
    thr = sub[order[kmax - 1]]
    flags[ok] = ps[ok] <= thr
    return flags


def seg_of(px: dict, a: int, b: int) -> tuple:
    return (int(np.searchsorted(px['t'], a)), int(np.searchsorted(px['t'], b)))


def make_placebo(n: int, seed: int, sigma: float = 0.011) -> dict:
    """Marche GBM avec OHLC synthétique, vol calée sur BTC 4h (~1,1 %/barre)."""
    rng = np.random.default_rng(seed)
    r = rng.standard_normal(n) * sigma
    c = 100 * np.exp(np.cumsum(r))
    o = np.empty(n)
    o[0] = 100.0
    o[1:] = c[:-1] * np.exp(rng.standard_normal(n - 1) * 0.0008)
    h = np.maximum(o, c) * np.exp(np.abs(rng.standard_normal(n)) * 0.004)
    l = np.minimum(o, c) * np.exp(-np.abs(rng.standard_normal(n)) * 0.004)
    v = np.exp(rng.standard_normal(n) * 0.8 + 5)
    t = (np.arange(n) * 14_400_000).astype(np.int64)
    return {'t': t, 'o': o, 'h': h, 'l': l, 'c': c, 'v': v, 'ct': t + 14_399_999}


if __name__ == '__main__':
    # auto-tests : pivots == convention TS (cas synthétique) + rotation calibrée
    px = make_placebo(3000, seed=3)
    sw = swings(px, 5)
    assert all(p[3] == p[0] + 5 for p in sw)
    assert all(a[1] != b[1] for a, b in zip(sw, sw[1:])), 'alternance violée'
    rng = np.random.default_rng(0)
    fake = [dict(sig=int(i), dir=1) for i in sorted(rng.choice(range(100, 2800), 60, replace=False))]
    r = eval_events(px, fake, (0, 3000))
    assert r['p'] > 0.02, f"rotation anti-conservatrice sur bruit: {r}"
    print(f"lib.py auto-tests OK ({len(sw)} pivots, p bruit {r['p']:.2f})")
