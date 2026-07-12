#!/usr/bin/env python3
# accum6 intraday : ÉTUDE DE SÉPARATION OI/positionnement 5-min (Binance metrics)
# → fwd spot 1/4/24/72/168 h. Protocole PRÉ-ENREGISTRÉ au LOG (familles F1-F4,
# barre : p<0,01 + moitiés même signe + |t|≥2 + ETH même signe).
# IS BTC 2020-09→2024-01 (moitiés 2022-05) ; ETH 2021-12→2024-01 (moitiés
# 2023-01). OOS jamais regardé. Décision au close 1h ; features = dernier
# snapshot 5-min STRICTEMENT avant le close (garde anti-staleness 2 h).
#   python3 oi_intraday_study.py
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'accum3'))
from lib import (DB, bh_fdr, fwd_logret, load, roll_mean, roll_rank, roll_std,
                 shift_null_p, spearman, t_nonoverlap)  # noqa: E402

H_MS = 3600000
W = 180 * 24          # fenêtre z/rank causale : 180 j en barres 1h
HS = (1, 4, 24, 72, 168)
IS_BTC = (np.datetime64('2020-09-01'), np.datetime64('2024-01-01'), np.datetime64('2022-05-01'))
IS_ETH = (np.datetime64('2021-12-01'), np.datetime64('2024-01-01'), np.datetime64('2023-01-01'))


def ms(d) -> int:
    return int(d.astype('datetime64[ms]').astype(np.int64))


def date(t_ms) -> str:
    return str(np.datetime64(int(t_ms), 'ms'))[:16]


def load_metrics(symbol: str) -> dict:
    sql = ("COPY (SELECT t, oi, oi_usd, tt_count, tt_sum, ls_count, taker "
           f"FROM binance_metrics WHERE symbol='{symbol}' ORDER BY t) "
           "TO STDOUT WITH (FORMAT csv, NULL 'nan')")
    p = subprocess.run(['psql', DB, '-q', '-c', sql], capture_output=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode()[:300])
    a = np.loadtxt(p.stdout.decode().splitlines(), delimiter=',', ndmin=2)
    return {'t': a[:, 0].astype(np.int64), 'oi': a[:, 1], 'oi_usd': a[:, 2],
            'tt_sum': a[:, 4], 'ls_count': a[:, 5], 'taker': a[:, 6]}


def nanroll_mean_std(x, w, min_frac=0.9):
    """Rolling mean/std NAN-AWARE en O(n) (cumsums) — un trou d'archive ne doit
    pas contaminer 180 j de z. Fenêtre valide si ≥ min_frac de points finis."""
    fin = np.isfinite(x)
    xz = np.where(fin, x, 0.0)
    s1 = np.concatenate([[0.0], np.cumsum(xz)])
    s2 = np.concatenate([[0.0], np.cumsum(xz * xz)])
    cn = np.concatenate([[0], np.cumsum(fin)])
    n = len(x)
    mu = np.full(n, np.nan)
    sd = np.full(n, np.nan)
    i = np.arange(w - 1, n)
    c = (cn[i + 1] - cn[i + 1 - w]).astype(float)
    okc = c >= max(2, int(w * min_frac))
    with np.errstate(invalid='ignore', divide='ignore'):
        m = (s1[i + 1] - s1[i + 1 - w]) / c
        var = (s2[i + 1] - s2[i + 1 - w]) / c - m * m
    mu[i[okc]] = m[okc]
    sd[i[okc]] = np.sqrt(np.maximum(var[okc], 0))
    return mu, sd


def nanroll_mean(x, w, min_frac=0.75):
    mu, _ = nanroll_mean_std(x, w, min_frac)
    return mu


def zscore(x, w=W):
    mu, sd = nanroll_mean_std(x, w)
    with np.errstate(invalid='ignore'):
        return np.where(sd > 0, (x - mu) / sd, np.nan)


def build(symbol: str, is_a, is_b) -> dict:
    X = load(symbol, '1h')          # spot
    t, c = X['t'], X['c']
    m5 = load_metrics(symbol)
    m5['oi'][m5['oi'] <= 0] = np.nan   # snapshots OI=0 = artefacts d'archive (502 BTC / 208 ETH)
    t5 = m5['t']
    close = t + H_MS
    idx = np.searchsorted(t5, close, side='left') - 1
    ok = (idx >= 0)
    stale = np.full(len(t), True)
    stale[ok] = (close[ok] - t5[idx[ok]]) > 2 * H_MS   # garde anti-trou
    d = {'t': t, 'c': c}
    for name in ('oi', 'tt_sum', 'ls_count', 'taker'):
        v = np.full(len(t), np.nan)
        v[ok] = m5[name][idx[ok]]
        v[stale] = np.nan
        d[name] = v
    # F3 : pire ΔOI 5-min de l'heure (deltas invalides si trou > 10 min)
    d5 = np.full(len(t5), np.nan)
    with np.errstate(invalid='ignore', divide='ignore'):
        d5[1:] = m5['oi'][1:] / m5['oi'][:-1] - 1
    d5[1:][np.diff(t5) > 600000] = np.nan
    hour5 = t5 // H_MS
    hmap = {}
    for j in range(len(t5)):
        if np.isfinite(d5[j]):
            h = hour5[j]
            if h not in hmap or d5[j] < hmap[h]:
                hmap[h] = d5[j]
    d['mind5'] = np.array([hmap.get(int(tt // H_MS), np.nan) for tt in t])
    # F1 : ΔOI multi-échelles (%, coin)
    oi = d['oi']
    for k, lbl in ((1, 'doi1'), (4, 'doi4'), (24, 'doi24'), (72, 'doi72')):
        v = np.full(len(t), np.nan)
        with np.errstate(invalid='ignore', divide='ignore'):
            v[k:] = oi[k:] / oi[:-k] - 1
        d[lbl] = v
    # F3/F4 : z 180 j
    d['mind5_z'] = zscore(d['mind5'])
    d['tt_z'] = zscore(d['tt_sum'])
    d['ls_z'] = zscore(d['ls_count'])
    d['tk_z'] = zscore(nanroll_mean(d['taker'], 24))
    d['roc30d'] = np.full(len(t), np.nan)
    d['roc30d'][720:] = c[720:] / c[:-720] - 1
    d['m_is'] = (t >= ms(is_a)) & (t < ms(is_b))
    return d


def sanity(d: dict):
    print('=== SANITY ===')
    out = subprocess.run(['psql', DB, '-q', '-t', '-A', '-c',
                          "SELECT t, payload->>'c' FROM coinalyze WHERE series='BTC_oi_binance_daily' ORDER BY t"],
                         capture_output=True, text=True).stdout.strip().splitlines()
    cd = {int(r.split('|')[0]) // 86400: float(r.split('|')[1]) for r in out if r}
    day = d['t'] // 86400000
    last_of_day = np.where(np.diff(day, append=day[-1] + 1) != 0)[0]
    a = d['oi'][last_of_day]
    b = np.array([cd.get(int(x), np.nan) for x in day[last_of_day]])
    ok = np.isfinite(a) & np.isfinite(b)
    print(f'  corr(OI metrics fin-de-jour, OI Coinalyze daily) = {np.corrcoef(a[ok], b[ok])[0, 1]:+.4f} (n={ok.sum()})')
    m = d['m_is']
    print(f'  couverture IS : {np.isfinite(d["oi"][m]).sum()}/{m.sum()} h valides ({np.isfinite(d["oi"][m]).mean():.1%})')
    f24 = fwd_logret(d['c'], 24)
    okm = m & np.isfinite(d['mind5'])
    top = np.argsort(np.where(okm, d['mind5'], np.inf))[:8]
    print('  top-8 pires ΔOI 5-min de l\'heure (IS) :')
    for i in top:
        print(f'    {date(d["t"][i])}  min5 {d["mind5"][i] * 100:+.2f}%  ret 1h {np.log(d["c"][i] / d["c"][i - 1]) * 100:+6.2f}%  fwd24 {f24[i] * 100:+6.2f}%')


def ic_table(d: dict, feats, title, half) -> list:
    t, c, m_is = d['t'], d['c'], d['m_is']
    hms = ms(half)
    rows = []
    print(f'=== {title} ===')
    print(f'  {"feature":8} {"h":>4} {"IC":>7} {"p":>7} {"t":>6} {"moitiés":>12}')
    for name in feats:
        v = d[name]
        for h in HS:
            f = fwd_logret(c, h)
            ok = m_is & np.isfinite(v) & np.isfinite(f)
            if ok.sum() < 3000:
                continue
            sub = np.where(ok)[0]
            ic, p = shift_null_p(v[sub], f[sub], min_shift=max(720, 3 * h))
            tno = t_nonoverlap(np.where(ok, v, np.nan), np.where(ok, f, np.nan), h)
            ic1 = spearman(np.where(ok & (t < hms), v, np.nan), np.where(ok & (t < hms), f, np.nan))
            ic2 = spearman(np.where(ok & (t >= hms), v, np.nan), np.where(ok & (t >= hms), f, np.nan))
            halves_ok = np.isfinite(ic1) and np.isfinite(ic2) and np.sign(ic1) == np.sign(ic2)
            flag = ' ←' if (np.isfinite(p) and p < 0.01 and halves_ok and np.isfinite(tno) and abs(tno) >= 2) else ''
            print(f'  {name:8} {h:4d} {ic:+7.3f} {p:7.4f} {tno:+6.2f} {ic1:+5.2f}/{ic2:+5.2f}{flag}')
            rows.append({'feat': name, 'h': h, 'ic': ic, 'p': p, 't': tno, 'h1': ic1, 'h2': ic2})
    return rows


def quintiles(d: dict, name: str, h: int = 24):
    v, f, m = d[name], fwd_logret(d['c'], h), d['m_is']
    ok = m & np.isfinite(v) & np.isfinite(f)
    if ok.sum() < 3000:
        return
    qs = np.nanquantile(v[ok], [0.2, 0.4, 0.6, 0.8])
    parts = []
    for i in range(5):
        lo = -np.inf if i == 0 else qs[i - 1]
        hi = np.inf if i == 4 else qs[i]
        sel = ok & (v > lo) & (v <= hi)
        parts.append(f'Q{i + 1} {f[sel].mean() * 100:+.2f}%(n={sel.sum()})')
    print(f'  {name:8} fwd{h}h: ' + '  '.join(parts))


def events(d: dict, evs, title, half):
    t, c, m = d['t'], d['c'], d['m_is']
    hms = ms(half)
    print(f'=== {title} ===')
    fwd = {h: fwd_logret(c, h) for h in HS}
    okb = m & np.isfinite(d['doi24'])
    print('  base IS: ' + '  '.join(f'fwd{h}h {fwd[h][okb & np.isfinite(fwd[h])].mean() * 100:+.2f}%' for h in HS))
    for lbl, ev in evs:
        sel = m & ev & np.isfinite(fwd[24])
        n = sel.sum()
        if n < 30:
            print(f'  {lbl:40}: n={n:4d}  (trop rare)')
            continue
        means = '  '.join(f'{fwd[h][m & ev & np.isfinite(fwd[h])].mean() * 100:+6.2f}%' for h in HS)
        sub = np.where(okb & np.isfinite(fwd[24]))[0]
        _, p = shift_null_p(ev[sub].astype(float), fwd[24][sub], min_shift=720)
        n1, n2 = (sel & (t < hms)).sum(), (sel & (t >= hms)).sum()
        f1 = fwd[24][sel & (t < hms)].mean() * 100 if n1 >= 15 else np.nan
        f2 = fwd[24][sel & (t >= hms)].mean() * 100 if n2 >= 15 else np.nan
        print(f'  {lbl:40}: n={n:4d}  {means}  p24 {p:.3f}  moitiés {f1:+.1f}%(n={n1})/{f2:+.1f}%(n={n2})')


def main():
    print(f'z/rank fenêtre {W} barres (180 j) | décision close 1h | cibles spot\n')
    btc = build('BTCUSDT', IS_BTC[0], IS_BTC[1])
    sanity(btc)
    print()
    feats = ['doi1', 'doi4', 'doi24', 'doi72', 'mind5_z', 'tt_z', 'ls_z', 'tk_z']
    rows = ic_table(btc, feats, f'BTC — IC × horizon (IS {IS_BTC[0]}→{IS_BTC[1]})', IS_BTC[2])
    print('\n=== BTC — quintiles (fwd 24 h, IS) ===')
    for name in feats:
        quintiles(btc, name)
    print()
    rk24 = np.where(np.isfinite(btc['doi24']), roll_rank(btc['doi24'], W), np.nan)
    roc = btc['roc30d']
    evs = [
        ('purge OI (rank doi24 ≤ 0.05)', rk24 <= 0.05),
        ('build-up OI (rank doi24 ≥ 0.95)', rk24 >= 0.95),
        ('purge capitulative (purge & roc30d<0)', (rk24 <= 0.05) & (roc < 0)),
        ('purge en tendance (purge & roc30d>0)', (rk24 <= 0.05) & (roc > 0)),
        ('build-up euphorique (build & roc30d>0)', (rk24 >= 0.95) & (roc > 0)),
        ('cascade 5-min (mind5_z ≤ -3)', btc['mind5_z'] <= -3),
        ('cascade en baisse (mind5_z≤-3 & roc<0)', (btc['mind5_z'] <= -3) & (roc < 0)),
    ]
    events(btc, evs, 'BTC — event studies (IS)', IS_BTC[2])
    print()
    eth = build('ETHUSDT', IS_ETH[0], IS_ETH[1])
    ic_table(eth, feats, f'ETH — réplication (IS {IS_ETH[0]}→{IS_ETH[1]})', IS_ETH[2])
    print()
    ps = np.array([r['p'] for r in rows])
    disc = bh_fdr(ps, 0.10)
    print(f'=== BH-FDR 10% sur {len(rows)} tests BTC : {disc.sum()} découverte(s) ===')
    for r, okd in zip(rows, disc):
        if okd:
            print(f'  {r["feat"]} h{r["h"]}: IC {r["ic"]:+.3f} p {r["p"]:.4f} t {r["t"]:+.2f} moitiés {r["h1"]:+.2f}/{r["h2"]:+.2f}')


if __name__ == '__main__':
    main()
