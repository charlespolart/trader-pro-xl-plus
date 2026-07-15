#!/usr/bin/env python3
"""patterns-crypto passe 2 — (1) stats ROBUSTES sur les configs BH de l'IS 4h
(barre déclarée AVANT exécution : médiane > 0 ET moyenne tronquée 10 % > 0
ET p_rotation(tronquée) < 0,05 — un candidat porté par un seul crash meurt) ;
(2) DOSE-RÉPONSE poolée par famille : événements de TOUTES les configs de la
famille, dédupliqués par sig (score = moyenne des scores des configs qui le
détectent), terciles avec départage déterministe des ex æquo.
  python3 pass2.py robust   # (1)
  python3 pass2.py dose     # (2)
"""
import json
import os
import sys

import numpy as np

from detect import (detect_cup, detect_div, detect_double, detect_fib, detect_flag,
                    detect_hs, detect_rounding, detect_triangle, detect_triple,
                    detect_wedge, ob_events, sr_events, tl_events)
from lib import IS_END, IS_START, NMIN, fwd_logret, load, seg_of, swings
from run import run_all

HERE = os.path.dirname(os.path.abspath(__file__))
H = 30


def detect_one(px, spines, fam, kind, cfg):
    parts = dict()
    for tok in cfg.split(','):
        key = tok.rstrip('0123456789.').rstrip('-')
        parts[key] = tok[len(key):]
    k = int(parts.get('k', 5))
    if fam in ('HS', 'iHS'):
        return detect_hs(px, spines[k], k, float(parts['tol']), float(parts['prom']),
                         int(parts['g']), inverse=(fam == 'iHS'))
    if fam in ('DT', 'DB'):
        return detect_double(px, spines[k], k, float(parts['tol']), float(parts['d']),
                             int(parts['g']), bottom=(fam == 'DB'))
    if fam in ('TT', 'TB'):
        return detect_triple(px, spines[k], k, float(parts['tol']), int(parts['g']),
                             bottom=(fam == 'TB'))
    if fam in ('CUP', 'iCUP'):
        return detect_cup(px, spines[k], k, float(parts['d']), int(parts['g']),
                          inverse=(fam == 'iCUP'))
    if fam == 'ROUND':
        return detect_rounding(px, spines[k], k, float(parts['r']), int(parts['g']),
                               top=(kind == 'top'))
    if fam == 'WEDGE':
        return detect_wedge(px, spines[k], k, int(parts['g']), rising=(kind == 'rise'))
    if fam in ('FLAG', 'PENN'):
        return detect_flag(px, spines[k], k, int(parts['m']), 0,
                           bull=(kind == 'bull'), pennant=(fam == 'PENN'))
    if fam == 'TRI':
        return detect_triangle(px, spines[k], k, int(parts['g']), kind)
    if fam == 'FIB':
        return detect_fib(px, spines[k], k, float(parts['lvl']))
    if fam == 'SR':
        return sr_events(px, spines[k], k, int(parts['t']))[kind]
    if fam == 'TL':
        return tl_events(px, spines[k], k, int(parts['g']))[kind]
    if fam == 'OB':
        return ob_events(px, spines[5], 5, int(parts['m']))[kind]
    if fam == 'DIV':
        hidden = kind.startswith('hid')
        bull = kind.endswith('bull')
        return detect_div(px, spines[k], k, hidden, bull)
    raise KeyError(fam)


def pooled_stats(pxs, segs, evs_by_asset, nrot=1000, seed=7):
    """mean / median / trimmed10 poolés + p_rotation pour chacun."""
    rng = np.random.default_rng(seed)
    parts = []
    vals = []
    for px, seg, evs in zip(pxs, segs, evs_by_asset):
        lo, hi = seg
        fwd = fwd_logret(px['c'], H)[lo:hi]
        idx = np.array([e['sig'] for e in evs], dtype=int)
        dirs = np.array([e['dir'] for e in evs], dtype=float)
        m = (idx >= lo) & (idx < hi)
        if m.sum():
            parts.append((fwd, idx[m] - lo, hi - lo, dirs[m]))
            vals.append(dirs[m] * fwd[idx[m] - lo])
    if not parts:
        return None
    v = np.concatenate(vals)
    v = v[np.isfinite(v)]
    if len(v) < NMIN:
        return None

    def trim(x, prop=0.10):
        x = np.sort(x[np.isfinite(x)])
        k = int(len(x) * prop)
        return float(x[k:len(x) - k].mean()) if len(x) > 2 * k else float(x.mean())

    obs = dict(mean=float(v.mean()), med=float(np.median(v)), trim=trim(v), n=int(len(v)))
    nulls = {stat: np.empty(nrot) for stat in ('mean', 'med', 'trim')}
    for r in range(nrot):
        chunks = []
        for fwd, rel, span, dirs in parts:
            dd = int(rng.integers(H + 5, span - H - 5))
            chunks.append(dirs * fwd[(rel + dd) % span])
        w = np.concatenate(chunks)
        w = w[np.isfinite(w)]
        nulls['mean'][r] = w.mean()
        nulls['med'][r] = np.median(w)
        nulls['trim'][r] = trim(w)
    out = dict(n=obs['n'])
    for stat in ('mean', 'med', 'trim'):
        out[stat] = obs[stat] * 1e4
        out[f'p_{stat}'] = (1 + float((nulls[stat] >= obs[stat]).sum())) / (1 + nrot)
    return out


def load_all(tf):
    pxs, segs, spines = [], [], []
    for sym in ('BTCUSDT', 'ETHUSDT'):
        px = load(sym, tf)
        seg = seg_of(px, IS_START, IS_END)
        pxs.append(px)
        segs.append((max(seg[0], 60), seg[1]))
        spines.append({k: swings(px, k) for k in (3, 5, 8)})
    return pxs, segs, spines


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'robust'
    pxs, segs, spines = load_all('4h')

    if mode == 'robust':
        cands = json.load(open(os.path.join(HERE, 'survivors_is.json')))['4h']
        print(f'{len(cands)} configs BH — barre robuste : méd>0 ET trim10>0 ET p_trim<0,05')
        kept = []
        for cd in cands:
            evs = [detect_one(px, sp, cd['fam'], cd['kind'], cd['cfg'])
                   for px, sp in zip(pxs, spines)]
            r = pooled_stats(pxs, segs, evs)
            if r is None:
                print(f"{cd['fam']:6s} {cd['kind']:9s} {cd['cfg']:24s} n insuffisant")
                continue
            ok = r['med'] > 0 and r['trim'] > 0 and r['p_trim'] < 0.05
            print(f"{cd['fam']:6s} {cd['kind']:9s} {cd['cfg']:24s} n={r['n']:4d} "
                  f"mean {r['mean']:+7.1f} | méd {r['med']:+7.1f} (p{r['p_med']:.3f}) | "
                  f"trim10 {r['trim']:+7.1f} (p{r['p_trim']:.3f}) → {'RETENU' if ok else 'rejeté'}")
            if ok:
                kept.append(cd)
        with open(os.path.join(HERE, 'survivors_robust.json'), 'w') as f:
            json.dump(kept, f, indent=1)
        print(f'\n{len(kept)}/{len(cands)} retenues → survivors_robust.json')
        return

    if mode == 'dose':
        # familles × TOUTES leurs configs de la grille IS, dédup par sig
        rows_by = [run_all(px, sp, seg, want_trades=False, seed=7)
                   for px, sp, seg in zip(pxs, spines, segs)]
        fams = sorted(set(r['fam'] for r in rows_by[0]))
        print('=== DOSE-RÉPONSE poolée PAR FAMILLE (toutes configs, dédup par sig) ===')
        print('barre : T3>T1, T3>tous, p(T3)<0,05 — départage déterministe des ex æquo')
        for fam in fams:
            evs_by_asset = []
            for rows in rows_by:
                seen = {}
                for r in rows:
                    if r['fam'] != fam:
                        continue
                    for e in r['ev']:
                        s = e['sig']
                        if s in seen:
                            seen[s]['_scores'].append(e['score'])
                        else:
                            seen[s] = dict(e)
                            seen[s]['_scores'] = [e['score']]
                evs = []
                for s, e in sorted(seen.items()):
                    e['score'] = float(np.mean(e['_scores']))
                    evs.append(e)
                evs_by_asset.append(evs)
            pool = [e for evs in evs_by_asset for e in evs]
            if len(pool) < 3 * NMIN:
                print(f'{fam:6s} — n insuffisant ({len(pool)})')
                continue
            # départage : jitter déterministe par sig (stable, minuscule)
            for evs in evs_by_asset:
                for e in evs:
                    e['_rk'] = e['score'] + (hash((fam, e['sig'])) % 1000) * 1e-9
            rks = np.array([e['_rk'] for evs in evs_by_asset for e in evs])
            q1, q2 = np.quantile(rks, [1 / 3, 2 / 3])
            t1 = [[e for e in evs if e['_rk'] <= q1] for evs in evs_by_asset]
            t3 = [[e for e in evs if e['_rk'] > q2] for evs in evs_by_asset]
            r1 = pooled_stats(pxs, segs, t1, seed=11)
            r3 = pooled_stats(pxs, segs, t3, seed=12)
            rall = pooled_stats(pxs, segs, evs_by_asset, seed=13)
            if r1 is None or r3 is None or rall is None:
                print(f'{fam:6s} — terciles insuffisants')
                continue
            ok = r3['mean'] > r1['mean'] and r3['mean'] > rall['mean'] and r3['p_mean'] < 0.05
            print(f"{fam:6s} T1 {r1['mean']:+7.1f} (n{r1['n']:4d}) | tous {rall['mean']:+7.1f} "
                  f"(n{rall['n']:4d}) | T3 {r3['mean']:+7.1f} (n{r3['n']:4d}, p{r3['p_mean']:.3f}) "
                  f"→ {'DOSE-RÉPONSE ✓' if ok else 'non'}")
        return


if __name__ == '__main__':
    main()
