#!/usr/bin/env python3
"""patterns-crypto — orchestrateur.
  python3 run.py placebo         # garde-fou 1 : pipeline complet sur 2 GBM
  python3 run.py control         # garde-fou 2 : retrouver Donchian×volume (edge maison)
  python3 run.py is [tf]         # IS BTC (défaut 4h) : grilles + BH + dose-réponse
  python3 run.py is-all          # IS BTC 1h+4h+1d + réplication ETH des BH-survivants
Les grilles et barres sont celles du protocole (LOG.md, committé avant)."""
import json
import os
import sys

import numpy as np

from detect import (detect_cup, detect_div, detect_double, detect_fib, detect_flag,
                    detect_hs, detect_rounding, detect_triangle, detect_triple,
                    detect_wedge, ob_events, sr_events, tl_events)
from lib import (IS_END, IS_START, NMIN, bh_flags, eval_events, eval_trades, load,
                 make_placebo, seg_of, swings)

HERE = os.path.dirname(os.path.abspath(__file__))


def run_all(px, spines, seg, want_trades=True, seed=7, light=False):
    """Toutes les familles × grilles. rows = dicts (fam, kind, cfg, n, obs, p [,trade])."""
    rows = []

    def add(fam, kind, cfg, ev, trades):
        r = eval_events(px, ev, seg, seed=seed)
        r.update(fam=fam, kind=kind, cfg=cfg, ev=ev)
        if trades and want_trades:
            r['trade'] = eval_trades(px, ev, seg)
        rows.append(r)

    ks_all = (3, 5) if light else (3, 5, 8)
    for k in ks_all:
        for tol in (0.015, 0.03):
            for prom in (0.005, 0.015):
                for gate in (0, 1):
                    cfg = f'k{k},tol{tol:g},prom{prom:g},g{gate}'
                    add('HS', 'bear', cfg, detect_hs(px, spines[k], k, tol, prom, gate), True)
                    add('iHS', 'bull', cfg, detect_hs(px, spines[k], k, tol, prom, gate, True), True)
            for depth in (0.02, 0.04):
                for gate in (0, 1):
                    cfg = f'k{k},tol{tol:g},d{depth:g},g{gate}'
                    add('DT', 'bear', cfg, detect_double(px, spines[k], k, tol, depth, gate), True)
                    add('DB', 'bull', cfg, detect_double(px, spines[k], k, tol, depth, gate, True), True)
            for gate in (0, 1):
                cfg = f'k{k},tol{tol:g},g{gate}'
                add('TT', 'bear', cfg, detect_triple(px, spines[k], k, tol, gate), True)
                add('TB', 'bull', cfg, detect_triple(px, spines[k], k, tol, gate, True), True)
        for gate in (0, 1):
            add('WEDGE', 'rise', f'k{k},g{gate}', detect_wedge(px, spines[k], k, gate, True), True)
            add('WEDGE', 'fall', f'k{k},g{gate}', detect_wedge(px, spines[k], k, gate, False), True)
    for k in (5, 8) if not light else (5,):
        for dmin in (0.06, 0.10):
            for gate in (0, 1):
                add('CUP', 'bull', f'k{k},d{dmin:g},g{gate}', detect_cup(px, spines[k], k, dmin, gate), True)
                add('iCUP', 'bear', f'k{k},d{dmin:g},g{gate}',
                    detect_cup(px, spines[k], k, dmin, gate, inverse=True), True)
        for r2m in (0.5, 0.7):
            for gate in (0, 1):
                add('ROUND', 'bottom', f'k{k},r{r2m:g},g{gate}',
                    detect_rounding(px, spines[k], k, r2m, gate), True)
                add('ROUND', 'top', f'k{k},r{r2m:g},g{gate}',
                    detect_rounding(px, spines[k], k, r2m, gate, top=True), True)
        for lvl in (0.382, 0.5, 0.618, 0.25, 0.75):
            add('FIB', 'bull', f'k{k},lvl{lvl:g}', detect_fib(px, spines[k], k, lvl), False)
        for mt in (2, 3):
            sr = sr_events(px, spines[k], k, mt)
            for kind, ev in sr.items():
                add('SR', kind, f'k{k},t{mt}', ev, False)
        for gate in (0, 1):
            tl = tl_events(px, spines[k], k, gate)
            for kind, ev in tl.items():
                add('TL', kind, f'k{k},g{gate}', ev, False)
    for k in (3, 5):
        for ma in (6, 10):
            add('FLAG', 'bull', f'k{k},m{ma}', detect_flag(px, spines[k], k, ma, 0, True, False), True)
            add('FLAG', 'bear', f'k{k},m{ma}', detect_flag(px, spines[k], k, ma, 0, False, False), True)
            add('PENN', 'bull', f'k{k},m{ma}', detect_flag(px, spines[k], k, ma, 0, True, True), True)
            add('PENN', 'bear', f'k{k},m{ma}', detect_flag(px, spines[k], k, ma, 0, False, True), True)
        for gate in (0, 1):
            for kind in ('asc', 'desc', 'sym'):
                add('TRI', kind, f'k{k},g{gate}', detect_triangle(px, spines[k], k, gate, kind), True)
        for hidden in (False, True):
            tag = 'hid' if hidden else 'reg'
            add('DIV', f'{tag}_bull', f'k{k},{tag}', detect_div(px, spines[k], k, hidden, True), False)
            add('DIV', f'{tag}_bear', f'k{k},{tag}', detect_div(px, spines[k], k, hidden, False), False)
    for m in (5, 10):
        ob = ob_events(px, spines[5], 5, m)
        for kind, ev in ob.items():
            add('OB', kind, f'm{m}', ev, False)
    return rows


def print_rows(rows, title):
    print(f'\n=== {title} ===')
    fams = sorted(set(r['fam'] for r in rows))
    for fam in fams:
        sub = [r for r in rows if r['fam'] == fam]
        flags = bh_flags([r['p'] for r in sub])
        for r, f in zip(sub, flags):
            r['bh'] = bool(f)
        nbh = sum(1 for r in sub if r['bh'])
        finite = [r for r in sub if np.isfinite(r.get('p', np.nan))]
        if not finite:
            print(f'{fam:6s} {len(sub):3d} cfg | n insuffisant partout')
            continue
        best = min(finite, key=lambda r: r['p'])
        obs_ok = [r['obs'] for r in finite]
        med = np.median(obs_ok)
        print(f"{fam:6s} {len(sub):3d} cfg | méd {med:+7.1f} bps | BH<10%: {nbh:2d} | "
              f"best {best['kind']}/{best['cfg']} n={best['n']:4d} obs {best['obs']:+7.1f} p={best['p']:.4f}")
    return rows


def dose_response(px, rows, seg, fam_defaults):
    """terciles de score sur les événements poolés de la config canonique."""
    print('\n=== DOSE-RÉPONSE (config canonique par famille, terciles de score) ===')
    for fam, (kind, cfg) in fam_defaults.items():
        r = next((x for x in rows if x['fam'] == fam and x['kind'] == kind and x['cfg'] == cfg), None)
        if r is None or len(r['ev']) < 3 * NMIN:
            print(f'{fam:6s} — n insuffisant pour terciles')
            continue
        ev = [e for e in r['ev'] if seg[0] <= e['sig'] < seg[1]]
        if len(ev) < 3 * NMIN:
            print(f'{fam:6s} — n insuffisant pour terciles ({len(ev)})')
            continue
        scores = np.array([e['score'] for e in ev])
        q1, q2 = np.quantile(scores, [1 / 3, 2 / 3])
        t1 = [e for e in ev if e['score'] <= q1]
        t3 = [e for e in ev if e['score'] > q2]
        r1 = eval_events(px, t1, seg, seed=11)
        r3 = eval_events(px, t3, seg, seed=12)
        rall = eval_events(px, ev, seg, seed=13)
        ok = (np.isfinite(r3['obs']) and np.isfinite(r1['obs'])
              and r3['obs'] > r1['obs'] and r3['obs'] > rall['obs'] and r3['p'] < 0.05)
        print(f"{fam:6s} T1 {r1['obs']:+7.1f} (n{r1['n']:3d}) | tous {rall['obs']:+7.1f} | "
              f"T3 {r3['obs']:+7.1f} (n{r3['n']:3d}, p{r3['p']:.3f}) → "
              f"{'DOSE-RÉPONSE ✓' if ok else 'pas de dose-réponse'}")


FAM_DEFAULTS = {
    'HS': ('bear', 'k5,tol0.03,prom0.005,g1'), 'iHS': ('bull', 'k5,tol0.03,prom0.005,g1'),
    'DT': ('bear', 'k5,tol0.015,d0.02,g1'), 'DB': ('bull', 'k5,tol0.015,d0.02,g1'),
    'TT': ('bear', 'k5,tol0.03,g1'), 'TB': ('bull', 'k5,tol0.03,g1'),
    'CUP': ('bull', 'k5,d0.06,g1'), 'iCUP': ('bear', 'k5,d0.06,g1'),
    'ROUND': ('bottom', 'k5,r0.5,g1'), 'WEDGE': ('rise', 'k5,g1'),
    'FLAG': ('bull', 'k3,m6'), 'PENN': ('bull', 'k3,m6'),
    'TRI': ('asc', 'k5,g1'), 'TL': ('up_bounce', 'k5,g1'), 'SR': ('sup_bounce', 'k5,t2'),
    'OB': ('bull', 'm10'), 'FIB': ('bull', 'k5,lvl0.618'), 'DIV': ('reg_bull', 'k5,reg'),
}


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'is'

    if mode == 'placebo':
        tot = hit = 0
        for seed in (101, 202):
            px = make_placebo(13000, seed=seed)   # ≈ 6 ans de 4h
            spines = {k: swings(px, k) for k in (3, 5, 8)}
            rows = run_all(px, spines, (60, len(px['c'])), want_trades=False, seed=seed)
            ps = [r['p'] for r in rows if np.isfinite(r['p'])]
            hit += sum(1 for p in ps if p < 0.01)
            tot += len(ps)
            print(f'seed {seed}: {sum(1 for p in ps if p < 0.01)}/{len(ps)} stats p<0.01')
        rate = hit / max(tot, 1) * 100
        print(f'\nPLACEBO TOTAL : {hit}/{tot} = {rate:.1f}% (attendu ~1 %, toléré ≤3 %) → '
              f"{'OK machinerie propre' if rate <= 3 else 'ALERTE BIAIS — STOP'}")
        return

    if mode == 'control':
        # contrôle positif : l'edge maison GO (Donchian55×vol1,5 en bull 1d)
        # doit ressortir de la MÊME machinerie d'éval (rotation).
        px = load('BTCUSDT', '4h')
        d1 = load('BTCUSDT', '1d')
        e = np.full(len(d1['c']), np.nan)
        acc, val = 0.0, None
        kq = 2 / 201
        for i, x in enumerate(d1['c']):
            if val is None:
                acc += x
                if i == 199:
                    val = acc / 200
                    e[i] = val
                continue
            val = x * kq + val * (1 - kq)
            e[i] = val
        bull_1d = d1['c'] > e
        ct1 = d1['ct']

        def bull_at(t):
            j = np.searchsorted(ct1, t, side='left') - 1
            return j >= 0 and bool(bull_1d[j]) and np.isfinite(e[j])

        n = len(px['c'])
        h, v, c = px['h'], px['v'], px['c']
        don = np.full(n, np.nan)
        for i in range(56, n):
            don[i] = h[i - 55:i].max()
        vs = np.full(n, np.nan)
        cs = np.cumsum(v)
        vs[20:] = (cs[20:] - cs[:-20]) / 20
        # réfractaire 30 barres = fidèle à la stratégie (pas de re-tir en
        # position ; sans lui les cassures consécutives d'un même run se
        # chevauchent et diluent l'obs). Décidé en phase garde-fous, AVANT
        # tout IS — la barre (obs>0, p<0,05) ne bouge pas.
        ev = []
        last = -10**9
        for i in range(56, n):
            if not np.isfinite(don[i]) or not np.isfinite(vs[i]):
                continue
            if i < last + 30:
                continue
            if c[i] > don[i] and v[i] > 1.5 * vs[i] and bull_at(px['ct'][i]):
                ev.append(dict(sig=i, dir=1))
                last = i
        seg = seg_of(px, IS_START, IS_END)
        r = eval_events(px, ev, seg)
        ok = np.isfinite(r['obs']) and r['obs'] > 0 and r['p'] < 0.05
        print(f"CONTRÔLE POSITIF (Donchian55×vol en bull, réfractaire 30b, BTC 4h IS, h=30) : "
              f"n={r['n']} obs {r['obs']:+.1f} bps p={r['p']:.4f} → "
              f"{'RETROUVÉ ✓' if ok else 'NON RETROUVÉ — machinerie suspecte, STOP'}")
        return

    if mode in ('is', 'is-all'):
        # POOLÉ BTC+ETH (amendement garde-fous 2026-07-15, avant tout IS) :
        # détection par actif, éval jointe par rotation combinée par segment.
        from lib import eval_events_pooled
        tfs = ['4h'] if mode == 'is' else ['1h', '4h', '1d']
        if len(sys.argv) > 2:
            tfs = [sys.argv[2]]
        all_out = {}
        for tf in tfs:
            pxs, segs, spines_by = [], [], []
            for sym in ('BTCUSDT', 'ETHUSDT'):
                px = load(sym, tf)
                seg = seg_of(px, IS_START, IS_END)
                pxs.append(px)
                segs.append((max(seg[0], 60), seg[1]))
                spines_by.append({k: swings(px, k) for k in (3, 5, 8)})
            light = tf == '1h'
            rows_by = [run_all(px, sp, seg, want_trades=(i == 0), seed=7, light=light)
                       for i, (px, sp, seg) in enumerate(zip(pxs, spines_by, segs))]
            # jointure par (fam,kind,cfg) → éval poolée
            keyed = {}
            for i, rows in enumerate(rows_by):
                for r in rows:
                    keyed.setdefault((r['fam'], r['kind'], r['cfg']), [None, None])[i] = r
            rows = []
            for (fam, kind, cfg), (rb, re_) in keyed.items():
                evs = [rb['ev'] if rb else [], re_['ev'] if re_ else []]
                pr = eval_events_pooled(pxs, evs, segs)
                pr.update(fam=fam, kind=kind, cfg=cfg, ev=evs[0], ev_eth=evs[1])
                if rb and 'trade' in rb:
                    pr['trade'] = rb['trade']
                rows.append(pr)
            rows = print_rows(rows, f'IS POOLÉ BTC+ETH {tf} (<2024-01), h=30, rotation combinée, BH par famille')
            # dose-réponse poolée (config canonique)
            print('\n=== DOSE-RÉPONSE poolée (config canonique, terciles de score) ===')
            for fam, (kind, cfg) in FAM_DEFAULTS.items():
                r = next((x for x in rows if x['fam'] == fam and x['kind'] == kind and x['cfg'] == cfg), None)
                if r is None:
                    continue
                ev_all = [[e for e in r['ev'] if segs[0][0] <= e['sig'] < segs[0][1]],
                          [e for e in r['ev_eth'] if segs[1][0] <= e['sig'] < segs[1][1]]]
                pool = ev_all[0] + ev_all[1]
                if len(pool) < 3 * NMIN:
                    print(f'{fam:6s} — n insuffisant ({len(pool)})')
                    continue
                sc = np.array([e['score'] for e in pool])
                q1, q2 = np.quantile(sc, [1 / 3, 2 / 3])
                t1 = [[e for e in evs if e['score'] <= q1] for evs in ev_all]
                t3 = [[e for e in evs if e['score'] > q2] for evs in ev_all]
                r1 = eval_events_pooled(pxs, t1, segs, seed=11)
                r3 = eval_events_pooled(pxs, t3, segs, seed=12)
                ok = (np.isfinite(r3['obs']) and np.isfinite(r1['obs'])
                      and r3['obs'] > r1['obs'] and r3['obs'] > r['obs'] and r3['p'] < 0.05)
                print(f"{fam:6s} T1 {r1['obs']:+7.1f} (n{r1['n']:3d}) | tous {r['obs']:+7.1f} | "
                      f"T3 {r3['obs']:+7.1f} (n{r3['n']:3d}, p{r3['p']:.3f}) → "
                      f"{'DOSE-RÉPONSE ✓' if ok else 'pas de dose-réponse'}")
            print(f'\n--- trades canoniques BTC (config canonique, IS {tf}) ---')
            for fam, (kind, cfg) in FAM_DEFAULTS.items():
                r = next((x for x in rows if x['fam'] == fam and x['kind'] == kind
                          and x['cfg'] == cfg and 'trade' in x), None)
                if r and np.isfinite(r['trade'].get('exp', np.nan)):
                    t = r['trade']
                    print(f"{fam:6s} n={t['n']:4d} exp {t['exp']:+7.1f} bps/tr win {t['win'] * 100:3.0f}% t={t['t']:+.1f}")
            cands = [dict(fam=r['fam'], kind=r['kind'], cfg=r['cfg'], obs=r['obs'], p=r['p'], n=r['n'])
                     for r in rows if r.get('bh') and np.isfinite(r['obs']) and r['obs'] > 0]
            all_out[tf] = cands
            print(f'\n{tf}: {len(cands)} candidat(s) BH (poolé, obs>0)')
        with open(os.path.join(HERE, 'survivors_is.json'), 'w') as f:
            json.dump(all_out, f, indent=1)
        return


if __name__ == '__main__':
    main()
