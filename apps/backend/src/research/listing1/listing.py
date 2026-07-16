#!/usr/bin/env python3
"""listing1 — H9 event study listings/délistings (protocole LOG.md committé
AVANT). Excès vs panier EW contemporain ; null timing-aveugle apparié
(actif aléatoire vivant à la même date) ; placebo dates décalées.
  python3 listing.py [placebo]"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'xsection1'))
from xsection_u import WARMUP, load_panel, universe_symbols  # noqa: E402

IS_A = np.datetime64('2019-02-01').astype('datetime64[ms]').astype(np.int64)
IS_B = np.datetime64('2024-01-01').astype('datetime64[ms]').astype(np.int64)
WINDOWS = ((1, 8, 'J+1→J+7'), (1, 31, 'J+1→J+30'), (8, 61, 'J+8→J+60'))


def trim10(x):
    x = np.sort(x)
    k = int(len(x) * 0.10)
    return x[k:len(x) - k].mean() if len(x) > 2 * k else np.nan


def stats3(x):
    return np.mean(x), np.median(x), trim10(x)


def main():
    placebo = len(sys.argv) > 1 and sys.argv[1] == 'placebo'
    rng = np.random.default_rng(7)
    syms = universe_symbols()
    ts, P = load_panel(syms)
    n, na = P.shape
    lp = np.log(P)
    r = np.vstack([np.zeros((1, na)), np.diff(lp, axis=0)])
    r = np.where(np.isfinite(r), r, 0.0)
    hist = np.isfinite(P).cumsum(axis=0)
    alive = np.isfinite(P) & (hist >= WARMUP)
    r_ew = np.array([r[t, alive[t]].mean() if alive[t].sum() >= 30 else 0.0 for t in range(n)])
    ex = r - r_ew[:, None]

    fin = np.isfinite(P)
    first = np.argmax(fin, axis=0)
    last = n - 1 - np.argmax(fin[::-1], axis=0)

    # panier de référence requis au jour de l'événement (les listings de
    # début 2019 tombent avant 30×91 j d'historique — exclus, consigné)
    events = [a for a in range(na)
              if ts[first[a]] >= IS_A and ts[first[a]] < IS_B and fin[:, a].any()
              and alive[first[a]].sum() >= 30]
    if placebo:
        ev2 = []
        for a in events:
            off = int(rng.integers(90, 400))
            j = first[a] + off
            if j + 61 <= min(last[a] + 1, n):
                ev2.append((a, j))
        events_j = ev2
        print(f'PLACEBO dates décalées : {len(events_j)} pseudo-événements')
    else:
        events_j = [(a, first[a]) for a in events]
        print(f'listings IS 2019-02→2024-01 : {len(events_j)} événements')

    print('\n=== E1 drift post-listing, EXCÈS vs panier EW (moy / méd / trim10, en %) ===')
    above = 0
    for w0, w1, lab in WINDOWS:
        vals, js = [], []
        for a, j in events_j:
            if j + w1 <= n and last[a] >= j + w1 - 1:
                vals.append(float(ex[j + w0:j + w1, a].sum()))
                js.append(j)
        vals = np.array(vals)
        mo, md, tr = stats3(vals)
        nulls = np.zeros((1000, 3))
        for it in range(1000):
            fake = []
            for j in js:
                cand = np.flatnonzero(alive[j])
                b = int(rng.choice(cand))
                if j + w1 <= n:
                    fake.append(float(ex[j + w0:j + w1, b].sum()))
            nulls[it] = stats3(np.array(fake))
        pct = [float((nulls[:, k] <= v).mean() * 100) for k, v in enumerate((mo, md, tr))]
        sig = all(p <= 5 for p in pct) or all(p >= 95 for p in pct)
        above += sig
        print(f'{lab:10s} (n={len(vals):3d}) : {mo * 100:+7.2f} / {md * 100:+7.2f} / {tr * 100:+7.2f} '
              f'| percentiles vs null apparié : {pct[0]:4.1f} / {pct[1]:4.1f} / {pct[2]:4.1f} '
              f"{'← SIGNAL' if sig else ''}")
    if placebo:
        print(f'\nPLACEBO : {above}/3 fenêtres « signal » (attendu 0)')
        return

    print('\n=== E2 fenêtre pré-délisting [fin−7 → fin] (DOCUMENTAIRE) ===')
    dead = [a for a in range(na)
            if last[a] < n - 3 and ts[last[a]] < IS_B and last[a] - 8 > first[a] + WARMUP]
    vals = np.array([float(ex[last[a] - 7:last[a] + 1, a].sum()) for a in dead])
    mo, md, tr = stats3(vals)
    print(f'délistings IS (n={len(vals)}) : excès 7 derniers jours cotés '
          f'{mo * 100:+.2f} / {md * 100:+.2f} / {tr * 100:+.2f} %')


if __name__ == '__main__':
    main()
