#!/usr/bin/env python3
"""audit1/A1 — vérification INDÉPENDANTE des indicateurs TS.

Chaque indicateur est réimplémenté ici depuis sa définition SOURCE (Wilder
1978 pour RSI/ATR/ADX/PSAR, Kaufman pour ER, Lo-MacKinlay pour VR, conventions
TradingView/TA-Lib pour les seeds), PAS depuis le code TypeScript. Comparaison
sur BTCUSDT 4h réel (dump JSON de dump_indicators.ts).

Verdict par série : PASS si erreur relative max < 1e-6 ET même index de
première valeur (warmup). SuperTrend/PSAR : état initial dépendant du départ →
comparaison après transitoire (premier flip), consigné.
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.path.join(HERE, 'out', 'indicators_btc4h.json')))
cnd = np.array(D['candles'], dtype=float)  # openTime,o,h,l,c,v,takerBuyBase
T, O, H, L, C, V, TB = (cnd[:, i] for i in range(7))
n = len(C)
S = {k: np.array([np.nan if x is None else x for x in v], dtype=float)
     for k, v in D['series'].items() if not k.startswith('__') and k != 'pivots_5_5'}

results = []


def sma(x, p):
    out = np.full(len(x), np.nan)
    cs = np.concatenate([[0.0], np.cumsum(x)])
    out[p - 1:] = (cs[p:] - cs[:-p]) / p
    return out


def ema_like(x, p, alpha):
    """seed = SMA des p premières valeurs FINIES consécutives (série dense)."""
    out = np.full(len(x), np.nan)
    v = np.nan
    cnt, acc = 0, 0.0
    for i, xi in enumerate(x):
        if not np.isfinite(xi):
            continue
        if not np.isfinite(v):
            acc += xi
            cnt += 1
            if cnt == p:
                v = acc / p
                out[i] = v
            continue
        v = alpha * xi + (1 - alpha) * v
        out[i] = v
    return out


def ema(x, p):
    return ema_like(x, p, 2 / (p + 1))


def rma(x, p):
    return ema_like(x, p, 1 / p)


def wma(x, p):
    out = np.full(len(x), np.nan)
    w = np.arange(1, p + 1, dtype=float)
    for i in range(p - 1, len(x)):
        out[i] = np.dot(x[i - p + 1:i + 1], w) / w.sum()
    return out


def rolling_max(x, p):
    out = np.full(len(x), np.nan)
    for i in range(p - 1, len(x)):
        out[i] = x[i - p + 1:i + 1].max()
    return out


def rolling_min(x, p):
    out = np.full(len(x), np.nan)
    for i in range(p - 1, len(x)):
        out[i] = x[i - p + 1:i + 1].min()
    return out


def std_pop(x, p):
    out = np.full(len(x), np.nan)
    for i in range(p - 1, len(x)):
        out[i] = np.std(x[i - p + 1:i + 1])  # ddof=0 (population)
    return out


def true_range():
    tr = np.empty(n)
    tr[0] = H[0] - L[0]
    tr[1:] = np.maximum.reduce([H[1:] - L[1:], np.abs(H[1:] - C[:-1]), np.abs(L[1:] - C[:-1])])
    return tr


def check(name, ref, tol=1e-6, skip_first=0):
    if name not in S:
        results.append((name, 'ABSENT DU DUMP', np.nan))
        return
    a = S[name]
    fa = next((i for i in range(n) if np.isfinite(a[i])), None)
    fr = next((i for i in range(n) if np.isfinite(ref[i])), None)
    both = np.isfinite(a) & np.isfinite(ref)
    if skip_first and fa is not None:
        both[:fa + skip_first] = False
    if both.sum() == 0:
        results.append((name, 'AUCUN CHEVAUCHEMENT', np.nan))
        return
    scale = np.maximum(1.0, np.abs(ref[both]))
    err = float(np.max(np.abs(a[both] - ref[both]) / scale))
    warm_ok = (fa == fr) if skip_first == 0 else True
    only_one = np.isfinite(a) != np.isfinite(ref)
    if skip_first and fa is not None:
        only_one[:fa + skip_first] = False
    null_ok = not only_one.any()
    status = 'PASS' if err < tol and warm_ok and null_ok else 'FAIL'
    extra = '' if warm_ok else f' warmup {fa} vs {fr}'
    extra += '' if null_ok else f' nulls divergents ({int(only_one.sum())})'
    results.append((name, status + extra, err))


# ---- moyennes
check('sma20', sma(C, 20))
check('ema21', ema(C, 21))
check('wma14', wma(C, 14))
# HMA(16) = WMA(2·WMA(8) − WMA(16), 4)
h_ = 2 * wma(C, 8) - wma(C, 16)
dense = h_[np.isfinite(h_)]
hma_dense = wma(dense, 4)
hma_ref = np.full(n, np.nan)
hma_ref[np.where(np.isfinite(h_))[0]] = hma_dense
check('hma16', hma_ref)

# ---- VWAP jour UTC (prix typique)
tp = (H + L + C) / 3
day = (T // 86_400_000).astype(int)
vwap_ref = np.full(n, np.nan)
pv = vv = 0.0
cur = None
for i in range(n):
    if day[i] != cur:
        cur, pv, vv = day[i], 0.0, 0.0
    pv += tp[i] * V[i]
    vv += V[i]
    vwap_ref[i] = pv / vv if vv > 0 else np.nan
check('vwap_day', vwap_ref)

# rolling VWAP 20
rv = np.full(n, np.nan)
for i in range(19, n):
    vs = V[i - 19:i + 1].sum()
    rv[i] = np.dot(tp[i - 19:i + 1], V[i - 19:i + 1]) / vs if vs > 0 else np.nan
check('rvwap20', rv)

# ---- RSI 14 (Wilder)
d = np.diff(C)
up = rma(np.maximum(d, 0), 14)
dn = rma(np.maximum(-d, 0), 14)
rsi_ref = np.full(n, np.nan)
with np.errstate(divide='ignore', invalid='ignore'):
    core = 100 - 100 / (1 + up / dn)
core[np.isfinite(dn) & (dn == 0)] = 100.0
rsi_ref[1:] = core
check('rsi14', rsi_ref)

# ---- MACD 12/26/9
ef, es = ema(C, 12), ema(C, 26)
macd_line = ef - es
mfin = np.isfinite(macd_line)
sig_dense = ema(macd_line[mfin], 9)
sig = np.full(n, np.nan)
sig[np.where(mfin)[0]] = sig_dense
macd_out = np.where(np.isfinite(sig), macd_line, np.nan)
check('macd.macd', macd_out)
check('macd.signal', sig)
check('macd.hist', macd_out - sig)

# ---- Stoch(14,3,3) lent
hh, ll = rolling_max(H, 14), rolling_min(L, 14)
raw = np.where(hh == ll, 50.0, 100 * (C - ll) / (hh - ll))
raw[~np.isfinite(hh)] = np.nan
rfin = np.isfinite(raw)
k_dense = sma(raw[rfin], 3)
k = np.full(n, np.nan)
k[np.where(rfin)[0]] = k_dense
kfin = np.isfinite(k)
d_dense = sma(k[kfin], 3)
dd = np.full(n, np.nan)
dd[np.where(kfin)[0]] = d_dense
check('stoch.k', np.where(np.isfinite(dd), k, np.nan))
check('stoch.d', dd)

# ---- StochRSI(14,14,3,3)
r = rsi_ref
rf = np.isfinite(r)
rr = r[rf]
hh2, ll2 = rolling_max(rr, 14), rolling_min(rr, 14)
raw2 = np.where(hh2 == ll2, 50.0, 100 * (rr - ll2) / (hh2 - ll2))
raw2[~np.isfinite(hh2)] = np.nan
r2f = np.isfinite(raw2)
k2_dense = sma(raw2[r2f], 3)
k2 = np.full(len(rr), np.nan)
k2[np.where(r2f)[0]] = k2_dense
k2f = np.isfinite(k2)
d2_dense = sma(k2[k2f], 3)
d2 = np.full(len(rr), np.nan)
d2[np.where(k2f)[0]] = d2_dense
k_full = np.full(n, np.nan)
d_full = np.full(n, np.nan)
k_full[np.where(rf)[0]] = k2
d_full[np.where(rf)[0]] = d2
check('stochrsi.k', np.where(np.isfinite(d_full), k_full, np.nan))
check('stochrsi.d', d_full)

# ---- CCI 20
m20 = sma(tp, 20)
cci_ref = np.full(n, np.nan)
for i in range(19, n):
    dev = np.mean(np.abs(tp[i - 19:i + 1] - m20[i]))
    cci_ref[i] = 0.0 if dev == 0 else (tp[i] - m20[i]) / (0.015 * dev)
check('cci20', cci_ref)

# ---- MFI 14
mf = tp * V
pos = np.zeros(n)
neg = np.zeros(n)
pos[1:] = np.where(tp[1:] > tp[:-1], mf[1:], 0)
neg[1:] = np.where(tp[1:] < tp[:-1], mf[1:], 0)
mfi_ref = np.full(n, np.nan)
for i in range(14, n):
    ps, ns = pos[i - 13:i + 1].sum(), neg[i - 13:i + 1].sum()
    mfi_ref[i] = 100.0 if ns == 0 else 100 - 100 / (1 + ps / ns)
check('mfi14', mfi_ref)

# ---- OBV
obv_ref = np.full(n, np.nan)
acc = 0.0
for i in range(1, n):
    if C[i] > C[i - 1]:
        acc += V[i]
    elif C[i] < C[i - 1]:
        acc -= V[i]
    obv_ref[i] = acc
check('obv', obv_ref)

# ---- ROC 10 / Williams %R 14
roc_ref = np.full(n, np.nan)
roc_ref[10:] = 100 * (C[10:] - C[:-10]) / C[:-10]
check('roc10', roc_ref)
wr = np.where(hh == ll, -50.0, -100 * (hh - C) / (hh - ll))
wr[~np.isfinite(hh)] = np.nan
check('willr14', wr)

# ---- ATR 14
tr = true_range()
check('atr14', rma(tr, 14))

# ---- Bollinger / Keltner / Donchian
mid = sma(C, 20)
sd = std_pop(C, 20)
check('bb.upper', mid + 2 * sd)
check('bb.middle', mid)
check('bb.lower', mid - 2 * sd)
kmid = ema(C, 20)
katr = rma(tr, 10)
check('kc.upper', kmid + 2 * katr)
check('kc.middle', kmid)
check('kc.lower', kmid - 2 * katr)
du, dl = rolling_max(H, 20), rolling_min(L, 20)
check('donch20.upper', du)
check('donch20.middle', (du + dl) / 2)
check('donch20.lower', dl)

# ---- ADX 14 (Wilder)
upm = H[1:] - H[:-1]
dnm = L[:-1] - L[1:]
pdm = np.where((upm > dnm) & (upm > 0), upm, 0.0)
mdm = np.where((dnm > upm) & (dnm > 0), dnm, 0.0)
str_ = rma(tr[1:], 14)
spd = rma(pdm, 14)
smd = rma(mdm, 14)
with np.errstate(divide='ignore', invalid='ignore'):
    pdi = 100 * spd / str_
    mdi = 100 * smd / str_
    dx = np.where(pdi + mdi == 0, 0.0, 100 * np.abs(pdi - mdi) / (pdi + mdi))
dx[str_ == 0] = np.nan
dxfin = np.isfinite(dx)
adx_dense = rma(dx[dxfin], 14)
adx = np.full(n - 1, np.nan)
adx[np.where(dxfin)[0]] = adx_dense
adx_full = np.concatenate([[np.nan], adx])
pdi_full = np.concatenate([[np.nan], pdi])
mdi_full = np.concatenate([[np.nan], mdi])
mask = ~np.isfinite(adx_full)
pdi_full[mask] = np.nan
mdi_full[mask] = np.nan
check('adx14.adx', adx_full)
check('adx14.plusDi', pdi_full)
check('adx14.minusDi', mdi_full)

# ---- SuperTrend(10,3) — algorithme standard, comparaison post-transitoire
atr10 = rma(tr, 10)
st_val = np.full(n, np.nan)
st_dir = np.full(n, np.nan)
fu = fl = np.nan
dir_ = 1
started = False
prev_close = np.nan
for i in range(n):
    if not np.isfinite(atr10[i]):
        prev_close = C[i]
        continue
    mid_i = (H[i] + L[i]) / 2
    bu = mid_i + 3 * atr10[i]
    bl = mid_i - 3 * atr10[i]
    if not started:
        fu, fl = bu, bl
        dir_ = 1 if C[i] >= mid_i else -1
        started = True
    else:
        fu = bu if (bu < fu or prev_close > fu) else fu
        fl = bl if (bl > fl or prev_close < fl) else fl
        if dir_ == 1 and C[i] < fl:
            dir_ = -1
        elif dir_ == -1 and C[i] > fu:
            dir_ = 1
    st_val[i] = fl if dir_ == 1 else fu
    st_dir[i] = dir_
    prev_close = C[i]
check('supertrend.value', st_val, skip_first=100)
check('supertrend.direction', st_dir, skip_first=100)

# ---- PSAR (Wilder canonique, clamp 2 bougies)
ps = np.full(n, np.nan)
if n >= 2:
    up_t = C[1] >= C[0]
    sar = min(L[0], L[1]) if up_t else max(H[0], H[1])
    ep = max(H[0], H[1]) if up_t else min(L[0], L[1])
    af = 0.02
    ps[1] = sar
    for i in range(2, n):
        sar = sar + af * (ep - sar)
        if up_t:
            sar = min(sar, L[i - 1], L[i - 2])
            if H[i] > ep:
                ep = H[i]
                af = min(0.2, af + 0.02)
            if L[i] < sar:
                up_t = False
                sar = ep
                ep = L[i]
                af = 0.02
        else:
            sar = max(sar, H[i - 1], H[i - 2])
            if L[i] < ep:
                ep = L[i]
                af = min(0.2, af + 0.02)
            if H[i] > sar:
                up_t = True
                sar = ep
                ep = H[i]
                af = 0.02
        ps[i] = sar
check('psar', ps, skip_first=100)

# ---- maison : takerFlow / ER / atrPercentile / squeeze / VR
check('takerflow20', sma(np.where(V > 0, TB / V, 0.5), 20))

er_ref = np.full(n, np.nan)
for i in range(10, n):
    net = abs(C[i] - C[i - 10])
    s = np.abs(np.diff(C[i - 10:i + 1])).sum()
    er_ref[i] = 0.0 if s == 0 else net / s
check('er10', er_ref)

atr14 = rma(tr, 14)
rel = atr14 / C
apc = np.full(n, np.nan)
hist = []
for i in range(n):
    if not np.isfinite(rel[i]) or C[i] <= 0:
        continue
    hist.append(rel[i])
    if len(hist) > 100:
        hist.pop(0)
    if len(hist) == 100:
        apc[i] = 100.0 * sum(1 for v in hist if v <= rel[i]) / 100
check('atrpct', apc)

sq = np.full(n, np.nan)
sd20 = std_pop(C, 20)
katr10 = rma(tr, 10)
both_sq = np.isfinite(sd20) & np.isfinite(katr10)
kw = 2 * 1.5 * katr10
sq[both_sq] = (2 * 2 * sd20[both_sq]) / kw[both_sq]
sq[both_sq & (kw == 0)] = np.nan
check('squeeze', sq)

# VR(5,60) : r1 = log-ret 1 barre, rA = log-ret 5 barres (chevauchants),
# variances ddof=1 sur les 60 DERNIÈRES valeurs de chaque série
lr = np.concatenate([[np.nan], np.log(C[1:] / C[:-1])])
lr5 = np.full(n, np.nan)
lr5[5:] = np.log(C[5:] / C[:-5])
vr_ref = np.full(n, np.nan)
for i in range(n):
    if i < 5 + 60 - 1:  # 60 valeurs de rA (elles démarrent à i=5) → première VR à i=64
        continue
    a = lr5[i - 59:i + 1]
    b = lr[i - 59:i + 1]
    if np.isfinite(a).all() and np.isfinite(b).all():
        vr_ref[i] = np.var(a, ddof=1) / (5 * np.var(b, ddof=1) + 1e-12)
check('vr', vr_ref)

# ---- pivots fractals (5,5) — définition : gauche STRICTE, droite non stricte
piv_ts = D['series'].get('pivots_5_5', [])
piv_ref = []
for i in range(5, n - 5):
    wl_h, wr_h = H[i - 5:i], H[i + 1:i + 6]
    wl_l, wr_l = L[i - 5:i], L[i + 1:i + 6]
    if (wl_h < H[i]).all() and (wr_h <= H[i]).all():
        piv_ref.append([i, 1, H[i], i + 5])
    if (wl_l > L[i]).all() and (wr_l >= L[i]).all():
        piv_ref.append([i, 0, L[i], i + 5])
piv_ref.sort(key=lambda p: (p[3], p[0], -p[1]))
ts_sorted = sorted([list(map(float, p)) for p in piv_ts], key=lambda p: (p[3], p[0], -p[1]))
ref_sorted = [list(map(float, p)) for p in piv_ref]
piv_ok = ts_sorted == ref_sorted
results.append(('pivots(5,5)', 'PASS' if piv_ok else f'FAIL (ts {len(ts_sorted)} vs ref {len(ref_sorted)})', 0.0 if piv_ok else np.nan))

# ---- rapport
print(f"{'série':22s} {'verdict':28s} err rel max")
fails = 0
for name, status, err in results:
    if not status.startswith('PASS'):
        fails += 1
    print(f"{name:22s} {status:28s} {err:.2e}" if np.isfinite(err) else f"{name:22s} {status}")
print(f"\n{len(results)} séries vérifiées, {fails} FAIL")
sys.exit(1 if fails else 0)
