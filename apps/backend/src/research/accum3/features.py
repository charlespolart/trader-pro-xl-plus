#!/usr/bin/env python3
# accum3 : USINE À INDICATEURS — ~135 features causales (classiques + inventées).
# Chaque feature: fn(X) -> np.array alignée aux barres (NaN avant d'être prête),
# n'utilisant QUE l'information ≤ barre courante (close comprise). La causalité
# est vérifiée mécaniquement par screen.py (recalcul sur préfixe).
# X contient o,h,l,c,v,qv,tb (+ contextes alignés optionnels: eth_c, ethbtc_c,
# fund, d1_* — voir screen.py). X['_'] = cache mémoïsé des intermédiaires.
import numpy as np

from lib import (atr, ema, fwd_logret, logret, roll_max, roll_mean, roll_median,
                 roll_min, roll_rank, roll_std, roll_sum, rsi, shift, _win, _pad)

EPS = 1e-12
FEATURES: list[tuple[str, str, object]] = []


def feat(name: str, family: str):
    def deco(fn):
        FEATURES.append((name, family, fn))
        return fn
    return deco


def cached(X: dict, key: str, builder):
    c = X.setdefault('_', {})
    if key not in c:
        c[key] = builder()
    return c[key]


def E(X, n):
    return cached(X, f'ema{n}', lambda: ema(X['c'], n))


def R(X):
    return cached(X, 'r', lambda: logret(X['c']))


def ATR(X, n=14):
    return cached(X, f'atr{n}', lambda: atr(X['h'], X['l'], X['c'], n))


def RV(X, w):
    return cached(X, f'rv{w}', lambda: roll_std(R(X), w))


def rolling_corr(x, y, w):
    ok = np.isfinite(x) & np.isfinite(y)
    xx = np.where(ok, x, np.nan)
    yy = np.where(ok, y, np.nan)
    mx, my = roll_mean(xx, w), roll_mean(yy, w)
    sx, sy = roll_std(xx, w), roll_std(yy, w)
    mxy = roll_mean(xx * yy, w)
    with np.errstate(invalid='ignore', divide='ignore'):
        return (mxy - mx * my) / (sx * sy)


def age_since(flag: np.ndarray) -> np.ndarray:
    """Barres écoulées depuis le dernier True (NaN avant le premier)."""
    n = len(flag)
    idx = np.where(flag, np.arange(n, dtype=float), np.nan)
    last = np.fmax.accumulate(np.where(np.isnan(idx), -np.inf, idx))
    out = np.arange(n) - last
    out[~np.isfinite(last)] = np.nan
    return out


# ============================================================ momentum / tendance
for k in (1, 3, 6, 12, 30, 60, 120):
    @feat(f'roc_{k}', 'momentum')
    def _(X, k=k):
        return X['c'] / shift(X['c'], k) - 1

for k in (20, 50, 100, 200):
    @feat(f'emadist_{k}', 'momentum')
    def _(X, k=k):
        return X['c'] / E(X, k) - 1

for k in (50, 200):
    @feat(f'emaslope_{k}', 'momentum')
    def _(X, k=k):
        return E(X, k) / shift(E(X, k), 10) - 1


@feat('macd_hist', 'momentum')
def _(X):
    macd = E(X, 12) - E(X, 26)
    sig = ema(np.where(np.isfinite(macd), macd, 0.0), 9)
    return (macd - sig) / X['c']


@feat('trend_age_50', 'momentum')
def _(X):
    above = X['c'] > E(X, 50)
    flip = np.zeros(len(above), dtype=bool)
    flip[1:] = above[1:] != above[:-1]
    a = age_since(flip)
    return np.where(above, a, -a)


@feat('adx_14', 'momentum')
def _(X):
    h, l, c = X['h'], X['l'], X['c']
    up = h - shift(h, 1)
    dn = shift(l, 1) - l
    pdm = np.where((up > dn) & (up > 0), up, 0.0)
    ndm = np.where((dn > up) & (dn > 0), dn, 0.0)
    a = ATR(X)
    pdi = 100 * roll_mean(pdm, 14) / (a + EPS)
    ndi = 100 * roll_mean(ndm, 14) / (a + EPS)
    dx = 100 * np.abs(pdi - ndi) / (pdi + ndi + EPS)
    return roll_mean(dx, 14)


@feat('aroon_osc_25', 'momentum')
def _(X):
    w = 25
    hi = _pad(_win(X['h'], w).argmax(axis=1) / (w - 1), len(X['h']), w)
    lo = _pad(_win(X['l'], w).argmin(axis=1) / (w - 1), len(X['l']), w)
    return hi - lo


# ============================================================ structure de MAs
@feat('ribbon_stack', 'ma_structure')
def _(X):
    ms = [E(X, k) for k in (10, 20, 50, 100, 200)]
    score = np.zeros(len(X['c']))
    cnt = 0
    for i in range(len(ms)):
        for j in range(i + 1, len(ms)):
            score = score + (ms[i] > ms[j])
            cnt += 1
    out = score / cnt
    out[~np.isfinite(ms[-1])] = np.nan
    return out


@feat('ribbon_disp', 'ma_structure')
def _(X):
    ms = np.vstack([E(X, k) for k in (10, 20, 50, 100, 200)])
    return ms.std(axis=0) / X['c']


@feat('pct_above_e50_120', 'ma_structure')
def _(X):
    return roll_mean((X['c'] > E(X, 50)).astype(float), 120)


@feat('streak_vs_e50', 'ma_structure')
def _(X):
    above = X['c'] > E(X, 50)
    flip = np.zeros(len(above), dtype=bool)
    flip[1:] = above[1:] != above[:-1]
    a = age_since(flip)
    a[~np.isfinite(E(X, 50))] = np.nan
    return np.where(above, a, -a)


@feat('cross_age_50_200', 'ma_structure')
def _(X):
    fastabove = E(X, 50) > E(X, 200)
    flip = np.zeros(len(fastabove), dtype=bool)
    flip[1:] = fastabove[1:] != fastabove[:-1]
    a = age_since(flip)
    return np.where(fastabove, a, -a)


@feat('curv_e50', 'ma_structure')
def _(X):
    e = E(X, 50)
    return (e - 2 * shift(e, 10) + shift(e, 20)) / X['c']


# ============================================================ range / breakout
for k in (20, 55, 120):
    @feat(f'donch_pos_{k}', 'breakout')
    def _(X, k=k):
        hh, ll = roll_max(X['h'], k), roll_min(X['l'], k)
        return (X['c'] - ll) / (hh - ll + EPS)

    @feat(f'dist_hh_{k}', 'breakout')
    def _(X, k=k):
        return X['c'] / shift(roll_max(X['h'], k), 1) - 1

    @feat(f'dist_ll_{k}', 'breakout')
    def _(X, k=k):
        return X['c'] / shift(roll_min(X['l'], k), 1) - 1


@feat('bars_since_hh120', 'breakout')
def _(X):
    return age_since(X['h'] >= shift(roll_max(X['h'], 120), 1))


# ============================================================ volatilité
for k in (20, 60, 120):
    @feat(f'rv_{k}', 'vol')
    def _(X, k=k):
        return RV(X, k)


@feat('park_20', 'vol')
def _(X):
    hl2 = np.log(X['h'] / (X['l'] + EPS)) ** 2
    return np.sqrt(roll_mean(hl2, 20) / (4 * np.log(2)))


@feat('gk_20', 'vol')
def _(X):
    hl = np.log(X['h'] / (X['l'] + EPS)) ** 2
    co = np.log(X['c'] / X['o']) ** 2
    return np.sqrt(np.maximum(roll_mean(0.5 * hl - (2 * np.log(2) - 1) * co, 20), 0))


@feat('rs_20', 'vol')
def _(X):
    u = np.log(X['h'] / X['c']) * np.log(X['h'] / X['o'])
    d = np.log(X['l'] / X['c']) * np.log(X['l'] / X['o'])
    return np.sqrt(np.maximum(roll_mean(u + d, 20), 0))


@feat('vol_ratio_20_120', 'vol')
def _(X):
    return RV(X, 20) / (RV(X, 120) + EPS)


@feat('vov_60', 'vol')
def _(X):
    d = np.diff(RV(X, 20), prepend=np.nan)
    return roll_std(d, 60) / (roll_mean(RV(X, 20), 60) + EPS)


@feat('atr_pct', 'vol')
def _(X):
    return ATR(X) / X['c']


@feat('bb_pos_20', 'vol')
def _(X):
    m, s = roll_mean(X['c'], 20), roll_std(X['c'], 20)
    return (X['c'] - m) / (2 * s + EPS)


@feat('bb_width_20', 'vol')
def _(X):
    return 4 * roll_std(X['c'], 20) / (roll_mean(X['c'], 20) + EPS)


@feat('keltner_pos_20', 'vol')
def _(X):
    return (X['c'] - E(X, 20)) / (2 * ATR(X, 20) + EPS)


@feat('squeeze_20', 'vol')
def _(X):
    return roll_std(X['c'], 20) / (ATR(X, 20) + EPS)


# ============================================================ distribution / stats
@feat('skew_60', 'stats')
def _(X):
    r = R(X)
    w = _win(np.where(np.isfinite(r), r, 0), 60)
    m = w.mean(axis=1, keepdims=True)
    s = w.std(axis=1, keepdims=True) + EPS
    return _pad((((w - m) / s) ** 3).mean(axis=1), len(r), 60)


@feat('kurt_60', 'stats')
def _(X):
    r = R(X)
    w = _win(np.where(np.isfinite(r), r, 0), 60)
    m = w.mean(axis=1, keepdims=True)
    s = w.std(axis=1, keepdims=True) + EPS
    return _pad((((w - m) / s) ** 4).mean(axis=1), len(r), 60)


@feat('semivar_ratio_60', 'stats')
def _(X):
    r = R(X)
    dn = roll_sum(np.square(np.minimum(r, 0)), 60)
    up = roll_sum(np.square(np.maximum(r, 0)), 60)
    return dn / (up + EPS)


@feat('ac1_60', 'stats')
def _(X):
    return rolling_corr(R(X), shift(R(X), 1), 60)


@feat('ac5_60', 'stats')
def _(X):
    return rolling_corr(R(X), shift(R(X), 5), 60)


@feat('vr_5_60', 'stats')
def _(X):
    r5 = np.log(X['c'] / shift(X['c'], 5))
    v5 = roll_std(r5, 60) ** 2
    v1 = roll_std(R(X), 60) ** 2
    return v5 / (5 * v1 + EPS)


@feat('hurst_rs_120', 'stats')
def _(X):
    r = np.where(np.isfinite(R(X)), R(X), 0)
    w = _win(r, 120)
    dev = w - w.mean(axis=1, keepdims=True)
    z = dev.cumsum(axis=1)
    rng = z.max(axis=1) - z.min(axis=1)
    s = w.std(axis=1) + EPS
    return _pad(np.log(rng / s + EPS) / np.log(120), len(r), 120)


@feat('hurst_spread', 'stats')
def _(X):
    r5 = np.log(X['c'] / shift(X['c'], 5))
    vr = (roll_std(r5, 60) ** 2) / (5 * roll_std(R(X), 60) ** 2 + EPS)
    h_vr = 0.5 + np.log(vr + EPS) / (2 * np.log(5))
    r = np.where(np.isfinite(R(X)), R(X), 0)
    w = _win(r, 120)
    dev = w - w.mean(axis=1, keepdims=True)
    z = dev.cumsum(axis=1)
    rng = z.max(axis=1) - z.min(axis=1)
    h_rs = _pad(np.log(rng / (w.std(axis=1) + EPS) + EPS) / np.log(120), len(r), 120)
    return h_rs - h_vr


@feat('perm_entropy_120', 'stats')
def _(X):
    r = R(X)
    a, b, c = shift(r, 2), shift(r, 1), r
    pat = ((a < b).astype(int) * 1 + (b < c).astype(int) * 2 + (a < c).astype(int) * 4)
    onehot = np.zeros((len(r), 8))
    ok = np.isfinite(a) & np.isfinite(b) & np.isfinite(c)
    onehot[np.arange(len(r))[ok], pat[ok]] = 1.0
    ent = np.zeros(len(r))
    tot = np.zeros(len(r))
    for k in range(8):
        cnt = roll_sum(onehot[:, k], 120)
        tot = tot + cnt
        with np.errstate(invalid='ignore', divide='ignore'):
            p = cnt / 120
            ent = ent - np.where(p > 0, p * np.log(p), 0)
    ent[tot < 100] = np.nan
    return ent


@feat('runlen_mean_120', 'stats')
def _(X):
    # longueur moyenne des runs de signe COMPLÉTÉS : la fin d'un run n'est
    # connue qu'à la barre du flip → on y enregistre la longueur du run précédent
    r = R(X)
    sgn = np.sign(np.where(np.isfinite(r), r, 0))
    flip = np.zeros(len(r), dtype=bool)
    flip[1:] = sgn[1:] != sgn[:-1]
    runlen = age_since(flip) + 1
    lens_at_flip = np.where(flip, shift(runlen, 1), 0.0)
    n_end = roll_sum(flip.astype(float), 120)
    return roll_sum(np.where(np.isfinite(lens_at_flip), lens_at_flip, 0), 120) / (n_end + EPS)


@feat('zret_1', 'stats')
def _(X):
    return R(X) / (RV(X, 20) + EPS)


# ============================================================ efficacité / chemin
for k in (20, 60):
    @feat(f'er_{k}', 'path')
    def _(X, k=k):
        dc = np.abs(np.diff(X['c'], prepend=np.nan))
        return np.abs(X['c'] - shift(X['c'], k)) / (roll_sum(dc, k) + EPS)


@feat('signed_er_60', 'path')
def _(X):
    dc = np.abs(np.diff(X['c'], prepend=np.nan))
    return (X['c'] - shift(X['c'], 60)) / (roll_sum(dc, 60) + EPS)


@feat('path_asym_60', 'path')
def _(X):
    d = np.diff(X['c'], prepend=np.nan)
    return roll_sum(np.maximum(d, 0), 60) / (roll_sum(np.maximum(-d, 0), 60) + EPS)


@feat('chop_14', 'path')
def _(X):
    pc = shift(X['c'], 1)
    tr = np.maximum(X['h'] - X['l'], np.maximum(np.abs(X['h'] - pc), np.abs(X['l'] - pc)))
    num = roll_sum(tr, 14)
    den = roll_max(X['h'], 14) - roll_min(X['l'], 14) + EPS
    return 100 * np.log10(num / den + EPS) / np.log10(14)


@feat('katz_fd_60', 'path')
def _(X):
    c = X['c']
    w = _win(c, 60)
    L = np.abs(np.diff(w, axis=1)).sum(axis=1)
    d = np.abs(w - w[:, :1]).max(axis=1)
    n = 59
    fd = np.log10(n) / (np.log10(n) + np.log10(d / (L + EPS) + EPS))
    return _pad(fd, len(c), 60)


# ============================================================ flow / volume
for k in (10, 30, 120):
    @feat(f'flow_{k}', 'flow')
    def _(X, k=k):
        return roll_sum(X['tb'], k) / (roll_sum(X['v'], k) + EPS)


@feat('flow_slope_30', 'flow')
def _(X):
    f = roll_sum(X['tb'], 30) / (roll_sum(X['v'], 30) + EPS)
    return f - shift(f, 30)


@feat('flow_div_60', 'flow')
def _(X):
    share = X['tb'] / (X['v'] + EPS)
    return rolling_corr(share, R(X), 60)


@feat('cvd_slope_60', 'flow')
def _(X):
    net = 2 * X['tb'] - X['v']
    return roll_sum(net, 60) / (roll_sum(X['v'], 60) + EPS)


@feat('obv_slope_60', 'flow')
def _(X):
    r = R(X)
    return roll_sum(np.sign(np.where(np.isfinite(r), r, 0)) * X['v'], 60) / (roll_sum(X['v'], 60) + EPS)


@feat('vol_z_60', 'flow')
def _(X):
    return (X['v'] - roll_mean(X['v'], 60)) / (roll_std(X['v'], 60) + EPS)


@feat('volret_corr_60', 'flow')
def _(X):
    return rolling_corr(X['v'], np.abs(R(X)), 60)


@feat('updown_vol_60', 'flow')
def _(X):
    r = R(X)
    up = roll_sum(np.where(r > 0, X['v'], 0), 60)
    dn = roll_sum(np.where(r < 0, X['v'], 0), 60)
    return up / (dn + EPS)


@feat('amihud_rank_240', 'flow')
def _(X):
    illiq = roll_mean(np.abs(R(X)) / (X['qv'] + 1), 20)
    return roll_rank(illiq, 240)


@feat('kyle_60', 'flow')
def _(X):
    imb = np.abs(2 * X['tb'] - X['v']) * X['c'] + 1
    return roll_median(np.abs(R(X)) / imb, 60)


@feat('mfi_14', 'flow')
def _(X):
    tp = (X['h'] + X['l'] + X['c']) / 3
    mf = tp * X['v']
    up = np.zeros(len(tp))
    dn = np.zeros(len(tp))
    dtp = np.diff(tp, prepend=np.nan)
    up = np.where(dtp > 0, mf, 0)
    dn = np.where(dtp < 0, mf, 0)
    return 100 - 100 / (1 + roll_sum(up, 14) / (roll_sum(dn, 14) + EPS))


@feat('force_13', 'flow')
def _(X):
    d = np.diff(X['c'], prepend=np.nan)
    f = np.where(np.isfinite(d), d, 0) * X['v']
    return ema(f, 13) / (roll_mean(X['v'], 60) * X['c'] * 0.01 + EPS)


@feat('eom_14', 'flow')
def _(X):
    mid = (X['h'] + X['l']) / 2
    dm = np.diff(mid, prepend=np.nan)
    box = X['v'] / (X['h'] - X['l'] + EPS)
    return roll_mean(np.where(np.isfinite(dm), dm, 0) / (box + EPS), 14) / (X['c'] * 1e-6 + EPS)


@feat('clv_20', 'flow')
def _(X):
    clv = ((X['c'] - X['l']) - (X['h'] - X['c'])) / (X['h'] - X['l'] + EPS)
    return roll_mean(clv, 20)


# ============================================================ mèches / barres
@feat('wick_press_20', 'bars')
def _(X):
    up = X['h'] - np.maximum(X['o'], X['c'])
    lo = np.minimum(X['o'], X['c']) - X['l']
    return roll_mean((up - lo) / (X['h'] - X['l'] + EPS), 20)


@feat('body_20', 'bars')
def _(X):
    return roll_mean(np.abs(X['c'] - X['o']) / (X['h'] - X['l'] + EPS), 20)


@feat('upwick_20', 'bars')
def _(X):
    return roll_mean((X['h'] - np.maximum(X['o'], X['c'])) / (X['h'] - X['l'] + EPS), 20)


@feat('lowick_20', 'bars')
def _(X):
    return roll_mean((np.minimum(X['o'], X['c']) - X['l']) / (X['h'] - X['l'] + EPS), 20)


@feat('nr_frac_20', 'bars')
def _(X):
    rng = X['h'] - X['l']
    med = roll_median(rng, 120)
    return roll_mean((rng < med).astype(float), 20)


@feat('inside_freq_60', 'bars')
def _(X):
    ins = (X['h'] < shift(X['h'], 1)) & (X['l'] > shift(X['l'], 1))
    return roll_mean(ins.astype(float), 60)


@feat('outside_freq_60', 'bars')
def _(X):
    out = (X['h'] > shift(X['h'], 1)) & (X['l'] < shift(X['l'], 1))
    return roll_mean(out.astype(float), 60)


@feat('failed_bd_rate_120', 'bars')
def _(X):
    ll = shift(roll_min(X['l'], 20), 1)
    ev = X['l'] < ll
    fail = ev & (X['c'] > ll)
    return roll_sum(fail.astype(float), 120) / (roll_sum(ev.astype(float), 120) + EPS)


@feat('failed_bo_rate_120', 'bars')
def _(X):
    hh = shift(roll_max(X['h'], 20), 1)
    ev = X['h'] > hh
    fail = ev & (X['c'] < hh)
    return roll_sum(fail.astype(float), 120) / (roll_sum(ev.astype(float), 120) + EPS)


# ============================================================ drawdown / excursion
@feat('dd_120', 'excursion')
def _(X):
    return X['c'] / roll_max(X['c'], 120) - 1


@feat('underwater_120', 'excursion')
def _(X):
    dd = X['c'] / roll_max(X['c'], 120) - 1
    return roll_mean((dd < -0.02).astype(float), 120)


@feat('ulcer_120', 'excursion')
def _(X):
    dd = X['c'] / roll_max(X['c'], 120) - 1
    return np.sqrt(roll_mean(dd ** 2, 120))


@feat('since_ath', 'excursion')
def _(X):
    c = X['c']
    rmax = np.maximum.accumulate(c)
    return age_since(c >= rmax) / 1000


@feat('vrec_120', 'excursion')
def _(X):
    ll = shift(roll_min(X['l'], 20), 1)
    ev = (X['l'] < ll).astype(float)
    # issue de l'événement : rallye ≥ 2×ATR dans les 12 barres SUIVANTES —
    # connue seulement 12 barres plus tard → tout est décalé de 12 (causal)
    fmax = np.full(len(ev), np.nan)
    hh12 = roll_max(X['h'], 12)
    fmax[:-12] = hh12[12:]
    out = (fmax >= X['c'] + 2 * ATR(X)).astype(float)
    ev12, out12 = shift(ev, 12), shift(ev * out, 12)
    return roll_sum(np.where(np.isfinite(out12), out12, 0), 120) / (roll_sum(np.where(np.isfinite(ev12), ev12, 0), 120) + EPS)


@feat('legpersist_120', 'excursion')
def _(X):
    below = X['c'] < E(X, 50)
    flip = np.zeros(len(below), dtype=bool)
    flip[1:] = below[1:] != below[:-1]
    runlen = age_since(flip) + 1
    end_below = np.zeros(len(below), dtype=bool)
    end_below[1:] = below[:-1] & ~below[1:]
    lens = np.where(end_below, shift(runlen, 1), 0)
    n = roll_sum(end_below.astype(float), 120)
    return roll_sum(np.where(np.isfinite(lens), lens, 0), 120) / (n + EPS)


@feat('excasym_120', 'excursion')
def _(X):
    r6 = np.full(len(X['c']), np.nan)
    r6[:-6] = np.log(X['c'][6:] / X['c'][:-6])
    bd = (X['l'] < shift(roll_min(X['l'], 20), 1)).astype(float)
    bo = (X['h'] > shift(roll_max(X['h'], 20), 1)).astype(float)
    bd6, bo6 = shift(bd, 6), shift(bo, 6)
    rbd6, rbo6 = shift(bd * r6, 6), shift(bo * r6, 6)
    mean_bd = roll_sum(np.where(np.isfinite(rbd6), rbd6, 0), 120) / (roll_sum(np.where(np.isfinite(bd6), bd6, 0), 120) + EPS)
    mean_bo = roll_sum(np.where(np.isfinite(rbo6), rbo6, 0), 120) / (roll_sum(np.where(np.isfinite(bo6), bo6, 0), 120) + EPS)
    return mean_bd - mean_bo


@feat('metapf_180', 'excursion')
def _(X):
    """Momentum de la MÉCANIQUE v2 : net BTC (frais 0,15%/côté) des excursions
    v2-lite (vente sous EMA50 si EMA200 en déclin 30 barres, rachat au recross
    ou stop +5%) COMPLÉTÉES dans les 180 dernières barres."""
    c, e50, e200 = X['c'], E(X, 50), E(X, 200)
    e200d = shift(e200, 30)
    n = len(c)
    gains = np.zeros(n)
    state = 0  # 0 = en BTC, 1 = vendu
    sold = 0.0
    fee = 0.0015
    for i in range(n):
        if not (np.isfinite(e50[i]) and np.isfinite(e200[i]) and np.isfinite(e200d[i])):
            continue
        if state == 0:
            if c[i] < e50[i] and c[i] < e200[i] and e200d[i] > e200[i]:
                state, sold = 1, c[i]
        else:
            if c[i] > e50[i] or c[i] > sold * 1.05:
                g = sold / c[i] * (1 - fee) ** 2 - 1
                gains[i] = g
                state = 0
    return roll_sum(gains, 180)


@feat('rallyviol_120', 'excursion')
def _(X):
    up6 = X['c'] / shift(X['c'], 6) - 1
    return roll_max(up6, 120) / (RV(X, 20) * np.sqrt(6) + EPS)


@feat('capit_20', 'excursion')
def _(X):
    volz = (X['v'] - roll_mean(X['v'], 60)) / (roll_std(X['v'], 60) + EPS)
    r = R(X)
    dnshare = roll_sum(np.square(np.minimum(r, 0)), 20) / (roll_sum(np.square(r), 20) + EPS)
    dd20 = X['c'] / roll_max(X['c'], 20) - 1
    return volz * dnshare * (-dd20)


# ============================================================ classiques divers
@feat('rsi_14', 'classic')
def _(X):
    return rsi(X['c'], 14)


@feat('rsi_2', 'classic')
def _(X):
    return rsi(X['c'], 2)


@feat('stoch_14', 'classic')
def _(X):
    ll, hh = roll_min(X['l'], 14), roll_max(X['h'], 14)
    return (X['c'] - ll) / (hh - ll + EPS)


@feat('cci_20', 'classic')
def _(X):
    tp = (X['h'] + X['l'] + X['c']) / 3
    m = roll_mean(tp, 20)
    md = roll_mean(np.abs(tp - m), 20)
    return (tp - m) / (0.015 * md + EPS)


@feat('trix_15', 'classic')
def _(X):
    e1 = ema(X['c'], 15)
    e2 = ema(np.where(np.isfinite(e1), e1, X['c']), 15)
    e3 = ema(np.where(np.isfinite(e2), e2, X['c']), 15)
    return (e3 / shift(e3, 1) - 1) * 1e4


@feat('dpo_20', 'classic')
def _(X):
    return (X['c'] - shift(roll_mean(X['c'], 20), 11)) / X['c']


@feat('vortex_14', 'classic')
def _(X):
    vp = np.abs(X['h'] - shift(X['l'], 1))
    vm = np.abs(X['l'] - shift(X['h'], 1))
    pc = shift(X['c'], 1)
    tr = np.maximum(X['h'] - X['l'], np.maximum(np.abs(X['h'] - pc), np.abs(X['l'] - pc)))
    return (roll_sum(np.where(np.isfinite(vp), vp, 0), 14) - roll_sum(np.where(np.isfinite(vm), vm, 0), 14)) / (roll_sum(tr, 14) + EPS)


@feat('mass_25', 'classic')
def _(X):
    rng = X['h'] - X['l']
    e1 = ema(rng, 9)
    e2 = ema(np.where(np.isfinite(e1), e1, rng), 9)
    return roll_sum(e1 / (e2 + EPS), 25)


# ============================================================ cross-asset / contexte
def ctx_feat(key):
    def guard(fn):
        def wrapped(X):
            if key not in X:
                return np.full(len(X['c']), np.nan)
            return fn(X)
        return wrapped
    return guard


for k in (30, 90):
    @feat(f'ethbtc_roc_{k}', 'cross')
    @ctx_feat('ethbtc_c')
    def _(X, k=k):
        return X['ethbtc_c'] / shift(X['ethbtc_c'], k) - 1


@feat('ethbtc_dist_e120', 'cross')
@ctx_feat('ethbtc_c')
def _(X):
    e = cached(X, 'ethbtc_e120', lambda: ema(X['ethbtc_c'], 120))
    return X['ethbtc_c'] / e - 1


@feat('corr_btc_eth_60', 'cross')
@ctx_feat('eth_c')
def _(X):
    re = logret(X['eth_c'])
    return rolling_corr(R(X), re, 60)


@feat('eth_lead_6', 'cross')
@ctx_feat('eth_c')
def _(X):
    eth6 = X['eth_c'] / shift(X['eth_c'], 6) - 1
    btc6 = X['c'] / shift(X['c'], 6) - 1
    return eth6 - btc6


@feat('fund_z_360', 'cross')
@ctx_feat('fund')
def _(X):
    f = X['fund']
    return (f - roll_mean(f, 360)) / (roll_std(f, 360) + EPS)


@feat('fund_slope_90', 'cross')
@ctx_feat('fund')
def _(X):
    return roll_mean(X['fund'], 30) - shift(roll_mean(X['fund'], 30), 90)


# contexte 1d aligné (préfixe d1_) — injecté par screen.py pour les TF < 1d
for key, nm in (('d1_emadist200', 'd1_emadist200'), ('d1_emaslope200', 'd1_emaslope200'),
                ('d1_rv20', 'd1_rv20'), ('d1_donch55', 'd1_donch55'),
                ('d1_flow30', 'd1_flow30'), ('d1_dd120', 'd1_dd120')):
    @feat(nm, 'context_1d')
    @ctx_feat(key)
    def _(X, key=key):
        return X[key]


# ============================================================ contrôles négatifs
@feat('ctrl_noise', 'control')
def _(X):
    return np.random.default_rng(1234).standard_normal(len(X['c']))


@feat('ctrl_index', 'control')
def _(X):
    return np.arange(len(X['c']), dtype=float)


@feat('ctrl_price', 'control')
def _(X):
    return X['c'].copy()


if __name__ == '__main__':
    print(f'{len(FEATURES)} features enregistrées')
    fams = {}
    for _, fam, _fn in FEATURES:
        fams[fam] = fams.get(fam, 0) + 1
    for fam, n in sorted(fams.items()):
        print(f'  {fam}: {n}')
