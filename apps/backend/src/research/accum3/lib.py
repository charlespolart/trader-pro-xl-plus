#!/usr/bin/env python3
# accum3 : boîte à outils commune — loader PG→numpy, rolling CAUSAL, moteur stats.
# Tout rolling: out[i] = f(x[i-w+1..i]) (fenêtre finissant à i inclus), NaN avant.
# Null principal : décalage circulaire (cross-corr FFT sur rangs) — préserve
# l'autocorrélation des deux séries, calibre exactement le screening.
import os
import subprocess

import numpy as np

DB = os.environ.get('DATABASE_URL', 'postgres://tpx:tpx@localhost:5436/tpx')
SCRATCH = os.environ.get(
    'ACCUM3_STATE',
    '/private/tmp/claude-501/-Users-charlespolart-Documents-Coding-trader-pro-xl-plus/54291f66-b329-40d9-943e-8410c7d8a340/scratchpad',
)

IS_START = np.datetime64('2018-04-05').astype('datetime64[ms]').astype(np.int64)
IS_END = np.datetime64('2024-01-01').astype('datetime64[ms]').astype(np.int64)
OOS_END = np.datetime64('2026-07-01').astype('datetime64[ms]').astype(np.int64)


# ---------------------------------------------------------------- données
def load(symbol: str, itv: str, market: str = 'spot') -> dict:
    """OHLCV + taker en np.array. Colonnes: t,o,h,l,c,v,qv,n,tb,tq,ct."""
    sql = (
        "COPY (SELECT open_time,open,high,low,close,volume,quote_volume,trades,"
        "taker_buy_base,taker_buy_quote,close_time FROM candles "
        f"WHERE market='{market}' AND symbol='{symbol}' AND interval='{itv}' "
        "ORDER BY open_time) TO STDOUT WITH (FORMAT csv)"
    )
    p = subprocess.run(['psql', DB, '-q', '-c', sql], capture_output=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode()[:300])
    raw = p.stdout.decode()
    if not raw.strip():
        return {}
    a = np.loadtxt(raw.splitlines(), delimiter=',', dtype=np.float64, ndmin=2)
    return {
        't': a[:, 0].astype(np.int64), 'o': a[:, 1], 'h': a[:, 2], 'l': a[:, 3],
        'c': a[:, 4], 'v': a[:, 5], 'qv': a[:, 6], 'n': a[:, 7],
        'tb': a[:, 8], 'tq': a[:, 9], 'ct': a[:, 10].astype(np.int64),
    }


def align_to(target_t: np.ndarray, src_ct: np.ndarray, src_vals: np.ndarray) -> np.ndarray:
    """Pour chaque barre cible (open_time t), la valeur src de la DERNIÈRE bougie
    source CLOSE avant/à la clôture de la barre cible ne serait pas causal pour
    une décision prise À la clôture de la cible… on aligne sur : dernière source
    dont close_time <= open_time cible (info disponible au début de la barre) —
    strictement causal même si on décide à la clôture de la cible."""
    idx = np.searchsorted(src_ct, target_t, side='right') - 1
    out = np.full(len(target_t), np.nan)
    ok = idx >= 0
    out[ok] = src_vals[idx[ok]]
    return out


# ---------------------------------------------------------------- rolling causal
def _win(x: np.ndarray, w: int) -> np.ndarray:
    return np.lib.stride_tricks.sliding_window_view(x, w)


def _pad(vals: np.ndarray, n: int, w: int) -> np.ndarray:
    out = np.full(n, np.nan)
    out[w - 1:] = vals
    return out


def roll_mean(x, w):
    return _pad(_win(x, w).mean(axis=1), len(x), w)


def roll_sum(x, w):
    return _pad(_win(x, w).sum(axis=1), len(x), w)


def roll_std(x, w):
    return _pad(_win(x, w).std(axis=1, ddof=1), len(x), w)


def roll_max(x, w):
    return _pad(_win(x, w).max(axis=1), len(x), w)


def roll_min(x, w):
    return _pad(_win(x, w).min(axis=1), len(x), w)


def roll_median(x, w):
    return _pad(np.median(_win(x, w), axis=1), len(x), w)


def roll_rank(x, w):
    """Percentile (0..1) de x[i] dans sa fenêtre."""
    wv = _win(x, w)
    r = (wv < wv[:, -1:]).sum(axis=1) / (w - 1)
    return _pad(r, len(x), w)


def ema(x: np.ndarray, n: int) -> np.ndarray:
    """EMA seedée par SMA(n) (convention moteur/accum2) ; NaN avant n-1."""
    out = np.full(len(x), np.nan)
    if len(x) < n:
        return out
    a = 2.0 / (n + 1)
    v = x[:n].mean()
    out[n - 1] = v
    # boucle python : ok (séries ≤ 80k)
    for i in range(n, len(x)):
        v = a * x[i] + (1 - a) * v
        out[i] = v
    return out


def shift(x: np.ndarray, k: int) -> np.ndarray:
    out = np.full(len(x), np.nan)
    if k == 0:
        return x.copy()
    out[k:] = x[:-k]
    return out


def logret(c: np.ndarray) -> np.ndarray:
    r = np.full(len(c), np.nan)
    r[1:] = np.log(c[1:] / c[:-1])
    return r


def fwd_logret(c: np.ndarray, h: int) -> np.ndarray:
    out = np.full(len(c), np.nan)
    out[:-h] = np.log(c[h:] / c[:-h])
    return out


def atr(h, l, c, n=14):
    pc = shift(c, 1)
    tr = np.maximum(h - l, np.maximum(np.abs(h - pc), np.abs(l - pc)))
    tr[0] = h[0] - l[0]
    return roll_mean(tr, n)


def rsi(c, n=14):
    d = np.diff(c, prepend=c[0])
    up = roll_mean(np.maximum(d, 0), n)
    dn = roll_mean(np.maximum(-d, 0), n)
    with np.errstate(divide='ignore', invalid='ignore'):
        return 100 - 100 / (1 + up / dn)


# ---------------------------------------------------------------- stats
def rank_std(x: np.ndarray) -> np.ndarray:
    """Rangs standardisés (moyenne 0, std 1), NaN ignorés (rang moyen)."""
    n = len(x)
    r = np.full(n, np.nan)
    ok = np.isfinite(x)
    rr = np.empty(ok.sum())
    order = np.argsort(x[ok], kind='mergesort')
    rr[order] = np.arange(ok.sum())
    r[ok] = rr
    mu, sd = np.nanmean(r), np.nanstd(r)
    return (r - mu) / (sd if sd > 0 else 1)


def spearman(f: np.ndarray, r: np.ndarray) -> float:
    ok = np.isfinite(f) & np.isfinite(r)
    if ok.sum() < 100:
        return np.nan
    a, b = rank_std(f[ok]), rank_std(r[ok])
    return float(np.mean(a * b))


def shift_null_p(f: np.ndarray, r: np.ndarray, min_shift: int = 240) -> tuple[float, float]:
    """IC de Spearman observé + p-value par NULL DE DÉCALAGE CIRCULAIRE :
    cross-corrélation FFT des rangs → IC à TOUS les décalages ; la distribution
    des |IC| aux décalages ≥ min_shift = null préservant l'autocorrélation.
    Les NaN sont remplacés par 0 APRÈS standardisation des rangs (neutres)."""
    ok = np.isfinite(f) & np.isfinite(r)
    if ok.sum() < 500:
        return np.nan, np.nan
    a = rank_std(np.where(ok, f, np.nan))
    b = rank_std(np.where(ok, r, np.nan))
    a[~np.isfinite(a)] = 0.0
    b[~np.isfinite(b)] = 0.0
    n = len(a)
    m = ok.sum()
    fa, fb = np.fft.rfft(a), np.fft.rfft(b)
    cc = np.fft.irfft(fa * np.conj(fb), n) / m  # cc[k] = corr(a décalé de k, b)
    obs = cc[0]
    ks = np.arange(n)
    valid = (ks >= min_shift) & (ks <= n - min_shift)
    null = cc[valid]
    p = float((np.abs(null) >= abs(obs)).mean()) if null.size else np.nan
    return float(obs), p


def t_nonoverlap(f: np.ndarray, r: np.ndarray, h: int, q: float = 0.2) -> float:
    """t du spread top-q vs bottom-q, sous-échantillonné tous les h (médiane des
    phases) — pas de chevauchement des retours forward."""
    ok = np.isfinite(f) & np.isfinite(r)
    idx = np.where(ok)[0]
    if idx.size < 200:
        return np.nan
    lo_q, hi_q = np.nanquantile(f[idx], [q, 1 - q])
    ts = []
    for off in range(h):
        sub = idx[(idx % h) == off]
        if sub.size < 40:
            continue
        top, bot = r[sub[f[sub] >= hi_q]], r[sub[f[sub] <= lo_q]]
        if top.size < 8 or bot.size < 8:
            continue
        se = np.sqrt(top.var(ddof=1) / top.size + bot.var(ddof=1) / bot.size)
        if se > 0:
            ts.append((top.mean() - bot.mean()) / se)
    return float(np.median(ts)) if ts else np.nan


def bh_fdr(pvals: np.ndarray, alpha: float = 0.10) -> np.ndarray:
    """Benjamini-Hochberg : renvoie un masque booléen des découvertes."""
    p = np.asarray(pvals, dtype=float)
    ok = np.isfinite(p)
    m = ok.sum()
    out = np.zeros(len(p), dtype=bool)
    if m == 0:
        return out
    idx = np.where(ok)[0]
    order = np.argsort(p[idx])
    ranked = p[idx][order]
    thresh = alpha * (np.arange(1, m + 1) / m)
    passed = ranked <= thresh
    if passed.any():
        kmax = np.max(np.where(passed)[0])
        out[idx[order[: kmax + 1]]] = True
    return out


# ---------------------------------------------------------------- régimes (contexte v2)
def regime_1d(d1: dict) -> tuple[np.ndarray, np.ndarray]:
    """Régime lu sur le 1d : bear = close<EMA200 ET EMA200 en déclin 30j ;
    bull = close>EMA200 ET EMA200 montante 30j ; sinon neutre.
    Renvoie (close_times 1d, code 0=neutre 1=bull 2=bear)."""
    e200 = ema(d1['c'], 200)
    e200_30 = shift(e200, 30)
    bear = (d1['c'] < e200) & (e200_30 > e200)
    bull = (d1['c'] > e200) & (e200_30 < e200)
    code = np.zeros(len(d1['c']))
    code[bull] = 1
    code[bear] = 2
    code[~np.isfinite(e200) | ~np.isfinite(e200_30)] = np.nan
    return d1['ct'], code


if __name__ == '__main__':
    # auto-test rapide : rolling causal + null calibré sur du bruit
    rng = np.random.default_rng(7)
    x = rng.standard_normal(5000).cumsum() + 100
    m = roll_mean(x, 20)
    assert np.isnan(m[18]) and abs(m[19] - x[:20].mean()) < 1e-9
    assert abs(roll_max(x, 50)[210] - x[161:211].max()) < 1e-12
    r = rng.standard_normal(5000)
    f = rng.standard_normal(5000)
    ic, p = shift_null_p(f, r)
    assert abs(ic) < 0.05 and p > 0.05, (ic, p)
    # faux signal évident : f = r décalé → IC fort, p minuscule
    f2 = np.roll(r, -1)
    ic2, p2 = shift_null_p(f2, np.concatenate([r[1:], [np.nan]]))
    assert p2 < 0.01 and abs(ic2) > 0.5, (ic2, p2)
    print('lib.py auto-tests OK')
