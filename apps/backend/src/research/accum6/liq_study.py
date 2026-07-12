#!/usr/bin/env python3
# accum6 : ÉTUDE DE SÉPARATION liquidations & open interest (daily Coinalyze).
# IS 2020-01→2024-01 SEULEMENT (OOS jamais regardé ici). Rupture échantillonnage
# 2021-04-27 → features RELATIVES uniquement : z-scores log1p par venue (180 j
# causaux), ratio borné, ΔOI %. Normalisation USD : linéaires (binance/okx/bybit)
# = coin ×prix ; bitmex (inverse) = déjà USD.
# Tests : IC Spearman + null décalage circulaire + t non-chevauchant + moitiés
# (2022-01) + slice post-rupture (2021-05→) ; quintiles ; event studies des jours
# extrêmes ; réplication ETH + cross-venues (signe ≥3/4) ; BH-FDR global.
#   ACCUM3_STATE=<scratchpad> python3 liq_study.py
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'accum3'))
from lib import (SCRATCH, bh_fdr, fwd_logret, load, logret, roll_max, roll_mean,
                 roll_std, shift_null_p, spearman, t_nonoverlap)  # noqa: E402

DAY_MS = 86400000
W = 180  # fenêtre z causale (absorbe la rupture 2021-04 en ~6 mois)
IS_A = np.datetime64('2020-01-01').astype('datetime64[ms]').astype(np.int64)
IS_B = np.datetime64('2024-01-01').astype('datetime64[ms]').astype(np.int64)
HALF = np.datetime64('2022-01-01').astype('datetime64[ms]').astype(np.int64)
BREAK = np.datetime64('2021-05-01').astype('datetime64[ms]').astype(np.int64)
VENUES = ['binance', 'okx', 'bybit', 'bitmex']
HS = (1, 3, 5, 10, 20)


def date(t_ms) -> str:
    return str(np.datetime64(int(t_ms), 'ms'))[:10]


def align_daily(t_ms: np.ndarray, hist: list, field: str) -> np.ndarray:
    """Valeur du bar Coinalyze du MÊME jour UTC que la bougie (connue au close)."""
    m = {int(x['t'] // 86400): float(x[field]) for x in hist}
    return np.array([m.get(int(tt // DAY_MS), np.nan) for tt in t_ms])


def zscore(x: np.ndarray, w: int = W) -> np.ndarray:
    mu, sd = roll_mean(x, w), roll_std(x, w)
    with np.errstate(invalid='ignore'):
        return np.where(sd > 0, (x - mu) / sd, np.nan)


def build(coin: str, sym: str, raw: dict) -> dict:
    X = load(sym, '1d')
    t, c = X['t'], X['c']
    d = {'t': t, 'c': c, 'ret1': logret(c)}
    usd_l = np.full((len(VENUES), len(t)), np.nan)
    usd_s = np.full((len(VENUES), len(t)), np.nan)
    for i, v in enumerate(VENUES):
        h = raw[f'{coin}_liq_{v}']
        li, si = align_daily(t, h, 'l'), align_daily(t, h, 's')
        mult = 1.0 if v == 'bitmex' else c  # linéaire = coin → ×prix ; inverse = USD
        usd_l[i], usd_s[i] = li * mult, si * mult
        d[f'z_long_{v}'] = zscore(np.log1p(usd_l[i]))
        d[f'z_short_{v}'] = zscore(np.log1p(usd_s[i]))
        d[f'z_total_{v}'] = zscore(np.log1p(usd_l[i] + usd_s[i]))
    nfin = np.isfinite(usd_l).sum(axis=0)
    with np.errstate(invalid='ignore'):
        for name, arr in (('z_long', 'z_long'), ('z_short', 'z_short'), ('z_total', 'z_total')):
            m = np.vstack([d[f'{arr}_{v}'] for v in VENUES])
            cnt = np.isfinite(m).sum(axis=0)
            d[name] = np.where(cnt >= 2, np.nanmean(m, axis=0), np.nan)
        sl, ss = np.nansum(usd_l, axis=0), np.nansum(usd_s, axis=0)
        tot = sl + ss
        d['ratio'] = np.where((nfin >= 2) & (tot > 0), (sl - ss) / tot, np.nan)
    d['ratio7'] = roll_mean(d['ratio'], 7)
    d['usd_l_venues'], d['usd_s_venues'] = usd_l, usd_s
    oi = align_daily(t, raw[f'{coin}_oi_binance'], 'c')  # OI en coin (sans effet prix)
    d['doi1'] = oi / np.where(oi > 0, np.roll(oi, 1), np.nan) - 1
    d['doi1'][0] = np.nan
    d['doi7'] = np.full(len(t), np.nan)
    d['doi7'][7:] = oi[7:] / oi[:-7] - 1
    d['oi_z'] = zscore(np.log(np.where(oi > 0, oi, np.nan)))
    d['funding_z'] = zscore(align_daily(t, raw[f'{coin}_funding_binance'], 'c'))
    r = d['ret1']
    d['roc7'] = np.full(len(t), np.nan)
    d['roc7'][7:] = c[7:] / c[:-7] - 1
    d['roc30'] = np.full(len(t), np.nan)
    d['roc30'][30:] = c[30:] / c[:-30] - 1
    d['dd120'] = c / roll_max(c, 120) - 1
    d['rv20'] = roll_std(r, 20)
    d['m_is'] = (t >= IS_A) & (t < IS_B)
    return d


def sanity(d: dict):
    print('=== SANITY (unités, alignement causal) ===')
    for i, v in enumerate(VENUES):
        ul = d['usd_l_venues'][i] + d['usd_s_venues'][i]
        ok = d['m_is'] & np.isfinite(ul)
        print(f'  {v:8}: médiane liq totale IS = {np.median(ul[ok])/1e6:7.2f} M$/j  (n={ok.sum()})')
    m = d['m_is']
    for a, b, lbl, exp in (('z_long', 'ret1', 'corr(z_long, ret même jour)', '< 0'),
                           ('z_short', 'ret1', 'corr(z_short, ret même jour)', '> 0'),
                           ('z_total', 'rv20', 'corr(z_total, rv20)', '> 0')):
        ok = m & np.isfinite(d[a]) & np.isfinite(d[b])
        print(f'  {lbl} = {np.corrcoef(d[a][ok], d[b][ok])[0, 1]:+.2f}  (attendu {exp})')
    f10 = fwd_logret(d['c'], 10)
    ok = m & np.isfinite(d['z_long'])
    top = np.argsort(np.where(ok, d['z_long'], -np.inf))[-8:][::-1]
    print('  top-8 z_long IS :')
    for i in top:
        print(f'    {date(d["t"][i])}  z_long {d["z_long"][i]:+.2f}  ret jour {d["ret1"][i]*100:+6.2f}%  fwd10 {f10[i]*100:+6.2f}%')


def ic_table(d: dict, feats: list, title: str, mask=None) -> list:
    """Table IC×horizon avec null, t non-chevauchant, moitiés, post-rupture."""
    t, c, m_is = d['t'], d['c'], d['m_is']
    if mask is not None:
        m_is = m_is & mask
    rows = []
    print(f'=== {title} ===')
    print(f'  {"feature":10} {"h":>3} {"IC":>7} {"p":>7} {"t":>6} {"moitiés":>12} {"post-rupt":>9}')
    for name in feats:
        v = d[name]
        for h in HS:
            f = fwd_logret(c, h)
            ok = m_is & np.isfinite(v) & np.isfinite(f)
            if ok.sum() < 400:
                continue
            sub = np.where(ok)[0]
            ic, p = shift_null_p(v[sub], f[sub], min_shift=max(90, 3 * h))
            tno = t_nonoverlap(np.where(ok, v, np.nan), np.where(ok, f, np.nan), h)
            ic1 = spearman(np.where(ok & (t < HALF), v, np.nan), np.where(ok & (t < HALF), f, np.nan))
            ic2 = spearman(np.where(ok & (t >= HALF), v, np.nan), np.where(ok & (t >= HALF), f, np.nan))
            icp = spearman(np.where(ok & (t >= BREAK), v, np.nan), np.where(ok & (t >= BREAK), f, np.nan))
            halves_ok = np.isfinite(ic1) and np.isfinite(ic2) and np.sign(ic1) == np.sign(ic2)
            flag = ' ←' if (np.isfinite(p) and p < 0.01 and halves_ok and np.isfinite(tno)
                            and abs(tno) >= 2 and np.isfinite(icp) and np.sign(icp) == np.sign(ic)) else ''
            print(f'  {name:10} {h:3d} {ic:+7.3f} {p:7.4f} {tno:+6.2f} {ic1:+5.2f}/{ic2:+5.2f} {icp:+9.2f}{flag}')
            rows.append({'feat': name, 'h': h, 'ic': ic, 'p': p, 't': tno,
                         'h1': ic1, 'h2': ic2, 'pb': icp})
    return rows


def quintiles(d: dict, name: str, h: int = 10):
    c, m = d['c'], d['m_is']
    v, f = d[name], fwd_logret(d['c'], h)
    ok = m & np.isfinite(v) & np.isfinite(f)
    if ok.sum() < 400:
        return
    qs = np.nanquantile(v[ok], [0.2, 0.4, 0.6, 0.8])
    out = []
    for i in range(5):
        lo = -np.inf if i == 0 else qs[i - 1]
        hi = np.inf if i == 4 else qs[i]
        sel = ok & (v > lo) & (v <= hi)
        out.append(f'Q{i+1} {f[sel].mean()*100:+.2f}%(n={sel.sum()})')
    print(f'  {name:10} fwd{h}: ' + '  '.join(out))


def events(d: dict, evs: list, title: str):
    """Event studies : n, fwd moyens vs base, p null (h=10), moitiés fwd10."""
    t, c, m = d['t'], d['c'], d['m_is']
    print(f'=== {title} ===')
    fwd = {h: fwd_logret(c, h) for h in HS}
    base_ok = m & np.isfinite(d['z_total'])
    base = {h: fwd[h][base_ok & np.isfinite(fwd[h])].mean() for h in HS}
    print(f'  base IS: ' + '  '.join(f'fwd{h} {base[h]*100:+.2f}%' for h in HS))
    for lbl, ev in evs:
        sel = m & ev & np.isfinite(fwd[10])
        n = sel.sum()
        if n < 8:
            print(f'  {lbl:34}: n={n:3d}  (trop rare)')
            continue
        means = '  '.join(f'{fwd[h][m & ev & np.isfinite(fwd[h])].mean()*100:+6.2f}%' for h in HS)
        ok10 = m & np.isfinite(fwd[10]) & np.isfinite(d['z_total'])
        sub = np.where(ok10)[0]
        _, p = shift_null_p(ev[sub].astype(float), fwd[10][sub], min_shift=90)
        n1 = (sel & (t < HALF)).sum()
        f1 = fwd[10][sel & (t < HALF)].mean() * 100 if n1 >= 4 else np.nan
        n2 = (sel & (t >= HALF)).sum()
        f2 = fwd[10][sel & (t >= HALF)].mean() * 100 if n2 >= 4 else np.nan
        print(f'  {lbl:34}: n={n:3d}  {means}  p10 {p:.3f}  moitiés fwd10 {f1:+.1f}%(n={n1})/{f2:+.1f}%(n={n2})')


def cross_venue(d: dict, h: int = 10):
    print(f'=== réplication cross-venues (IC fwd{h}, IS) — signe cohérent ≥3/4 requis ===')
    c, m = d['c'], d['m_is']
    f = fwd_logret(c, h)
    for base in ('z_long', 'z_short', 'z_total'):
        ics = []
        for v in VENUES:
            vv = d[f'{base}_{v}']
            ok = m & np.isfinite(vv) & np.isfinite(f)
            ics.append(spearman(np.where(ok, vv, np.nan), np.where(ok, f, np.nan)))
        agg = d[base]
        ok = m & np.isfinite(agg) & np.isfinite(f)
        ic_a = spearman(np.where(ok, agg, np.nan), np.where(ok, f, np.nan))
        signs = sum(1 for x in ics if np.isfinite(x) and np.isfinite(ic_a) and np.sign(x) == np.sign(ic_a))
        det = '  '.join(f'{v} {x:+.3f}' for v, x in zip(VENUES, ics))
        print(f'  {base:8} agg {ic_a:+.3f} | {det} | cohérents {signs}/4')


def redundancy(d: dict):
    print('=== redondance avec le prix (liq = |mouvement| repackagé ?) ===')
    m = d['m_is']
    for a in ('z_long', 'z_short', 'z_total', 'ratio', 'doi7'):
        cors = []
        for b in ('roc7', 'roc30', 'dd120', 'rv20'):
            ok = m & np.isfinite(d[a]) & np.isfinite(d[b])
            cors.append(f'{b} {np.corrcoef(d[a][ok], d[b][ok])[0, 1]:+.2f}')
        absr = np.abs(d['ret1'])
        ok = m & np.isfinite(d[a]) & np.isfinite(absr)
        print(f'  {a:8}: |ret1| {np.corrcoef(d[a][ok], absr[ok])[0, 1]:+.2f}  ' + '  '.join(cors))


def conditional(d: dict):
    """Info neuve : z_long sépare-t-il ENCORE parmi les jours déjà baissiers ?"""
    print('=== conditionnel (info au-delà du contexte prix, fwd10, IS) ===')
    down = d['roc30'] < 0
    up = d['roc30'] > 0
    for lbl, cond, feat in (('roc30<0 (marché bas)', down, 'z_long'),
                            ('roc30>0 (marché haut)', up, 'z_short')):
        m = d['m_is'] & cond & np.isfinite(d[feat])
        f10 = fwd_logret(d['c'], 10)
        ok = m & np.isfinite(f10)
        if ok.sum() < 200:
            continue
        qs = np.nanquantile(d[feat][ok], [1 / 3, 2 / 3])
        parts = []
        for i, (lo, hi) in enumerate(((-np.inf, qs[0]), (qs[0], qs[1]), (qs[1], np.inf))):
            sel = ok & (d[feat] > lo) & (d[feat] <= hi)
            parts.append(f'T{i+1} {f10[sel].mean()*100:+.2f}%(n={sel.sum()})')
        print(f'  {feat} | {lbl:22}: ' + '  '.join(parts))


def main():
    raw = json.load(open(os.path.join(SCRATCH, 'coinalyze_daily.json')))
    print(f'IS = {date(IS_A)} → {date(IS_B)} | moitiés {date(HALF)} | post-rupture {date(BREAK)} | z fenêtre {W} j\n')
    btc = build('BTC', 'BTCUSDT', raw)
    sanity(btc)
    print()
    feats = ['z_long', 'z_short', 'z_total', 'ratio', 'ratio7', 'doi1', 'doi7', 'oi_z', 'funding_z']
    rows = ic_table(btc, feats, 'BTC — IC × horizon (IS)')
    print('\n=== BTC — quintiles (IS) ===')
    for name in ('z_long', 'z_short', 'z_total', 'ratio', 'doi7', 'oi_z'):
        quintiles(btc, name)
    print()
    z_l, z_s, roc30 = btc['z_long'], btc['z_short'], btc['roc30']
    evs = [
        ('spike longs z≥2', z_l >= 2),
        ('spike longs z≥3', z_l >= 3),
        ('spike shorts z≥2', z_s >= 2),
        ('spike shorts z≥3', z_s >= 3),
        ('capitulation (z_long≥2 & roc30<0)', (z_l >= 2) & (roc30 < 0)),
        ('capitulation forte (z≥3 & roc30<0)', (z_l >= 3) & (roc30 < 0)),
        ('squeeze (z_short≥2 & roc30>0)', (z_s >= 2) & (roc30 > 0)),
        ('purge OI (doi7 ≤ q10 IS)', btc['doi7'] <= np.nanquantile(btc['doi7'][btc['m_is']], 0.10)),
        ('build-up OI (doi7 ≥ q90 IS)', btc['doi7'] >= np.nanquantile(btc['doi7'][btc['m_is']], 0.90)),
    ]
    events(btc, evs, 'BTC — event studies (IS)')
    print()
    cross_venue(btc, 10)
    cross_venue(btc, 5)
    print()
    redundancy(btc)
    print()
    conditional(btc)
    print()
    eth = build('ETH', 'ETHUSDT', raw)
    ic_table(eth, ['z_long', 'z_short', 'z_total', 'ratio', 'doi7'], 'ETH — réplication (IS)')
    print()
    ps = np.array([r['p'] for r in rows])
    disc = bh_fdr(ps, 0.10)
    print(f'=== BH-FDR 10% sur {len(rows)} tests BTC : {disc.sum()} découverte(s) ===')
    for r, ok in zip(rows, disc):
        if ok:
            print(f'  {r["feat"]} h{r["h"]}: IC {r["ic"]:+.3f} p {r["p"]:.4f} t {r["t"]:+.2f} moitiés {r["h1"]:+.2f}/{r["h2"]:+.2f} post-rupt {r["pb"]:+.2f}')


if __name__ == '__main__':
    main()
