#!/usr/bin/env python3
# accum3 : SCREENING MASSIF features × horizons × régimes × {BTC, ETH} × {4h, 1d}.
# Discipline :
#   0. causalité vérifiée MÉCANIQUEMENT (recalcul sur préfixe) pour chaque feature ;
#   1. IS SEULEMENT (2018-04→2024-01) — l'OOS n'est jamais touché ici ;
#   2. p-value par null de décalage circulaire (préserve l'autocorrélation) ;
#   3. t non-chevauchant (sous-échantillonné par horizon, médiane des phases) ;
#   4. stabilité de signe sur les deux moitiés de l'IS ;
#   5. BH-FDR 10% sur TOUTE la matrice + réplication ETH même signe exigée.
#   python3 screen.py            # tout (long)
#   python3 screen.py causality  # seulement le check de causalité
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from features import FEATURES
from lib import (IS_END, IS_START, SCRATCH, align_to, bh_fdr, ema, fwd_logret,
                 load, logret, regime_1d, roll_max, roll_mean, roll_min,
                 roll_std, roll_sum, shift, shift_null_p, spearman, t_nonoverlap)

EPS = 1e-12
HALF = np.datetime64('2021-02-17').astype('datetime64[ms]').astype(np.int64)
HORIZONS = {'4h': [1, 3, 6, 12, 30, 60], '1d': [1, 3, 5, 10, 20, 40]}


def build_X(symbol: str, itv: str) -> dict:
    X = dict(load(symbol, itv))
    if not X:
        raise RuntimeError(f'pas de données {symbol} {itv}')
    t = X['t']
    # contextes alignés (causal : dernière bougie source CLOSE avant l'open cible)
    other = 'ETHUSDT' if symbol == 'BTCUSDT' else 'BTCUSDT'
    o1 = load(other, itv)
    if o1:
        X['eth_c'] = align_to(t, o1['ct'], o1['c'])
    eb = load('ETHBTC', itv)
    if eb:
        X['ethbtc_c'] = align_to(t, eb['ct'], eb['c'])
    fr = load_funding(symbol)
    if fr is not None:
        X['fund'] = align_to(t, fr[0], fr[1])
    if itv != '1d':
        d1 = load(symbol, '1d')
        e200 = ema(d1['c'], 200)
        r1 = logret(d1['c'])
        ctx = {
            'd1_emadist200': d1['c'] / e200 - 1,
            'd1_emaslope200': e200 / shift(e200, 30) - 1,
            'd1_rv20': roll_std(r1, 20),
            'd1_donch55': (d1['c'] - roll_min(d1['l'], 55)) / (roll_max(d1['h'], 55) - roll_min(d1['l'], 55) + EPS),
            'd1_flow30': roll_sum(d1['tb'], 30) / (roll_sum(d1['v'], 30) + EPS),
            'd1_dd120': d1['c'] / roll_max(d1['c'], 120) - 1,
        }
        for k, v in ctx.items():
            X[k] = align_to(t, d1['ct'], v)
    return X


def load_funding(symbol: str):
    import subprocess

    from lib import DB
    sql = f"COPY (SELECT time, rate FROM funding_rates WHERE symbol='{symbol}' ORDER BY time) TO STDOUT WITH (FORMAT csv)"
    p = subprocess.run(['psql', DB, '-q', '-c', sql], capture_output=True)
    raw = p.stdout.decode()
    if p.returncode != 0 or not raw.strip():
        return None
    a = np.loadtxt(raw.splitlines(), delimiter=',', ndmin=2)
    return a[:, 0].astype(np.int64), a[:, 1]


def truncate_X(X: dict, i0: int) -> dict:
    out = {}
    n = len(X['c'])
    for k, v in X.items():
        if k == '_':
            continue
        out[k] = v[: i0 + 1] if isinstance(v, np.ndarray) and len(v) == n else v
    return out


def causality_check(X: dict) -> None:
    n = len(X['c'])
    fails = []
    for i0 in (int(n * 0.6), n - 500):
        Xp = truncate_X(X, i0)
        for name, _fam, fn in FEATURES:
            full = fn(X)
            pref = fn(Xp)
            a, b = full[i0], pref[-1]
            same = (np.isnan(a) and np.isnan(b)) or (np.isfinite(a) and np.isfinite(b) and abs(a - b) <= 1e-7 * max(1.0, abs(a)))
            if not same:
                fails.append((name, i0, a, b))
    if fails:
        for f in fails:
            print(f'  ✗ LOOKAHEAD {f[0]} @ {f[1]}: full={f[2]!r} prefix={f[3]!r}')
        raise SystemExit('CAUSALITY CHECK FAILED')
    print(f'  causalité OK ({len(FEATURES)} features × 2 points)')


def screen_asset(symbol: str, itv: str, rows: list) -> None:
    print(f'— screening {symbol} {itv}')
    X = build_X(symbol, itv)
    causality_check(X)
    t = X['t']
    n = len(t)
    is_mask = (t >= IS_START) & (t < IS_END)
    h1_mask = is_mask & (t < HALF)
    h2_mask = is_mask & (t >= HALF)
    # régime (contexte v2) depuis le 1d, aligné
    d1 = load(symbol, '1d')
    ct1, code1 = regime_1d(d1)
    reg = align_to(t, ct1, code1)
    slices = {
        'all': is_mask,
        'bull': is_mask & (reg == 1),
        'bear': is_mask & (reg == 2),
        'neutral': is_mask & (reg == 0),
    }
    fwd = {h: fwd_logret(X['c'], h) for h in HORIZONS[itv]}
    vals = {}
    for name, fam, fn in FEATURES:
        v = np.asarray(fn(X), dtype=float)
        v[~np.isfinite(v)] = np.nan
        vals[name] = (fam, v)
    for name, (fam, v) in vals.items():
        for h in HORIZONS[itv]:
            r = fwd[h]
            for sl, m in slices.items():
                f_m = np.where(m, v, np.nan)
                r_m = np.where(m, r, np.nan)
                ok = np.isfinite(f_m) & np.isfinite(r_m)
                nn = int(ok.sum())
                # null CALIBRÉ pour les tranches : rotation À L'INTÉRIEUR de la
                # sous-série compactée (sinon le chevauchement partiel des masques
                # rétrécit le null → faux positifs massifs, vu sur ctrl_noise)
                ms = max(120, 3 * h)
                if nn < 4 * ms:
                    continue
                sub = np.where(ok)[0]
                ic, p = shift_null_p(v[sub], r[sub], min_shift=ms)
                tno = t_nonoverlap(f_m, r_m, h)
                ic1 = spearman(np.where(h1_mask & m, v, np.nan), np.where(h1_mask & m, r, np.nan))
                ic2 = spearman(np.where(h2_mask & m, v, np.nan), np.where(h2_mask & m, r, np.nan))
                rows.append({
                    'asset': symbol, 'itv': itv, 'feature': name, 'family': fam,
                    'h': h, 'slice': sl, 'n': nn, 'ic': ic, 'p': p, 't': tno,
                    'ic_h1': ic1, 'ic_h2': ic2,
                })
    print(f'  {len(rows)} lignes cumulées')


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == 'causality':
        for sym, itv in (('BTCUSDT', '4h'), ('BTCUSDT', '1d')):
            print(f'— causalité {sym} {itv}')
            causality_check(build_X(sym, itv))
        return
    rows: list[dict] = []
    for sym in ('BTCUSDT', 'ETHUSDT'):
        for itv in ('4h', '1d'):
            screen_asset(sym, itv, rows)
    # matrice complète → BH-FDR global
    ps = np.array([r['p'] if np.isfinite(r['p']) else np.nan for r in rows])
    disc = bh_fdr(ps, 0.10)
    for r, d in zip(rows, disc):
        r['fdr'] = bool(d)
    out = os.path.join(SCRATCH, 'screen_results.csv')
    cols = ['asset', 'itv', 'feature', 'family', 'h', 'slice', 'n', 'ic', 'p', 't', 'ic_h1', 'ic_h2', 'fdr']
    with open(out, 'w') as f:
        f.write(','.join(cols) + '\n')
        for r in rows:
            f.write(','.join(str(r.get(c, '')) for c in cols) + '\n')
    print(f'→ {out} ({len(rows)} lignes)')

    # SURVIVANTS : FDR ✓ + |t|≥2 + moitiés cohérentes + réplication ETH même signe p≤0.1
    key = lambda r: (r['itv'], r['feature'], r['h'], r['slice'])
    eth = {key(r): r for r in rows if r['asset'] == 'ETHUSDT'}
    surv = []
    for r in rows:
        if r['asset'] != 'BTCUSDT' or not r['fdr']:
            continue
        if not (np.isfinite(r['t']) and abs(r['t']) >= 2):
            continue
        if not (np.isfinite(r['ic_h1']) and np.isfinite(r['ic_h2']) and np.sign(r['ic_h1']) == np.sign(r['ic_h2'])):
            continue
        e = eth.get(key(r))
        if e is None or not np.isfinite(e['ic']) or np.sign(e['ic']) != np.sign(r['ic']) or not (np.isfinite(e['p']) and e['p'] <= 0.1):
            continue
        surv.append((r, e))
    surv.sort(key=lambda re: -abs(re[0]['ic']))
    print(f'\n=== SURVIVANTS (FDR10 + |t|≥2 + moitiés + réplication ETH) : {len(surv)} ===')
    print(f"{'feature':24} {'itv':3} {'h':>3} {'slice':7} {'IC':>7} {'p':>8} {'t':>6} {'IC_ETH':>7}")
    for r, e in surv[:60]:
        print(f"{r['feature']:24} {r['itv']:3} {r['h']:>3} {r['slice']:7} {r['ic']:+.3f} {r['p']:8.5f} {r['t']:+6.2f} {e['ic']:+.3f}")
    ctrl = [r for r in rows if r['family'] == 'control' and r.get('fdr')]
    print(f'\ncontrôles négatifs passés au FDR (attendu ~0) : {len(ctrl)}')
    for r in ctrl[:10]:
        print(f"  ⚠ {r['asset']} {r['itv']} {r['feature']} h{r['h']} {r['slice']} ic={r['ic']:+.3f} p={r['p']:.5f}")


if __name__ == '__main__':
    main()
