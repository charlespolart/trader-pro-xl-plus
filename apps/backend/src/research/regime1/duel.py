#!/usr/bin/env python3
"""regime1 étape 7 — duel USD vs btc-swing, contribution portefeuille,
stabilité par période (protocole LOG.md §ÉTAPE 7 committé AVANT exécution).
Conventions (consignées) : rendements SIMPLES quotidiens uniformes pour tous
(regime1 = expm1 de sa série log ; incumbents = équité moteur réduite au
dernier point de chaque jour UTC) ; sleeves base converties en USD par le
close spot BTCUSDT ; composite rebalancé quotidiennement ; vol égalisée par
levier scalaire sans coût de financement (levier attendu ≈ 1).
  python3 duel.py"""
import os
import subprocess

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DB = 'postgres://tpx:tpx@localhost:5438/tpx'
DAY = 86_400_000
SLEEVE = 0.20                     # figé au protocole
WINDOWS = (('info 2020-07→2026-07', '2020-07-01', '2026-07-01'),
           ('JUGE OOS 2024-01→2026-07', '2024-01-01', '2026-07-01'))
PERIODS = ('2020-07-01', '2021-01-01', '2022-01-01', '2023-01-01',
           '2024-01-01', '2025-01-01', '2026-01-01', '2026-07-01')


def dms(s):
    return int(np.datetime64(s).astype('datetime64[ms]').astype(np.int64))


def load_regime():
    ts, ret, on = [], [], []
    with open(os.path.join(HERE, 'regime1_perp_daily.csv')) as f:
        next(f)
        for line in f:
            a, b, c = line.strip().split(',')
            ts.append(int(a))
            ret.append(float(b))
            on.append(int(c))
    return (np.array(ts, dtype=np.int64), np.expm1(np.array(ret)),
            np.array(on, dtype=bool))


def load_equity_daily(name, ts):
    """équité moteur (pas 4h) → équité fin-de-jour alignée sur ts (ffill)."""
    days = {}
    with open(os.path.join(HERE, f'incumbent_{name}.csv')) as f:
        next(f)
        for line in f:
            t, e = line.strip().split(',')
            days[int(t) // DAY] = float(e)      # le dernier point du jour gagne
    eq = np.full(len(ts), np.nan)
    last = np.nan
    for i, t in enumerate(ts):
        v = days.get(int(t) // DAY)
        if v is not None:
            last = v
        eq[i] = last
    if not np.isfinite(eq).all():
        raise RuntimeError(f'{name}: équité manquante en tête de fenêtre')
    return eq


def load_btc_close(ts):
    q = ("COPY (SELECT open_time, close FROM candles WHERE market='spot' AND symbol='BTCUSDT' "
         "AND interval='1d' ORDER BY open_time) TO STDOUT (FORMAT csv)")
    out = subprocess.run(['psql', DB, '-c', q], capture_output=True, text=True, check=True).stdout
    d = {int(float(a)): float(b) for a, b in (line.split(',') for line in out.strip().split('\n') if line)}
    px = np.array([d.get(int(t), np.nan) for t in ts])
    if not np.isfinite(px).all():
        raise RuntimeError('close BTC manquant')
    return px


def load_in_trade(name, ts):
    """bool par jour : un trade moteur couvre ce jour (swing: long en position ;
    accum/vrx: short = en EXCURSION hors BTC)."""
    spans = []
    with open(os.path.join(HERE, f'incumbent_{name}_trades.csv')) as f:
        next(f)
        for line in f:
            a, b, _ = line.strip().split(',')
            spans.append((int(a), int(b) if b else np.inf))
    out = np.zeros(len(ts), dtype=bool)
    for i, t in enumerate(ts):
        d0, d1 = int(t), int(t) + DAY - 1
        out[i] = any(e <= d1 and x >= d0 for e, x in spans)
    return out


def rets(eq):
    r = np.zeros(len(eq))
    r[1:] = eq[1:] / eq[:-1] - 1.0
    return r


def m(r):
    eq = np.cumprod(1.0 + r)
    peak = np.maximum.accumulate(eq)
    dd = float(((peak - eq) / peak).max()) * 100
    n = len(r)
    cagr = (float(eq[-1]) ** (365.0 / n) - 1.0) * 100
    sd = r.std(ddof=1)
    sharpe = r.mean() / sd * np.sqrt(365) if sd > 0 else np.nan
    calmar = cagr / dd if dd > 0 else np.nan
    return dict(sharpe=sharpe, cagr=cagr, dd=dd, calmar=calmar)


def fmt(nm, x):
    return (f"{nm:22s} | Sharpe {x['sharpe']:+5.2f} CAGR {x['cagr']:+7.1f}% "
            f"DD {x['dd']:5.1f}% Calmar {x['calmar']:5.2f}")


def main():
    ts, r_reg, on = load_regime()
    btc = load_btc_close(ts)
    eq_sw = load_equity_daily('swing', ts)
    eq_ac = load_equity_daily('accum', ts) * btc
    eq_vx = load_equity_daily('vrx', ts) * btc
    r_sw, r_ac, r_vx = rets(eq_sw), rets(eq_ac), rets(eq_vx)
    r_ref = (r_sw + r_ac + r_vx) / 3.0
    r_cand = (1 - SLEEVE) * r_ref + SLEEVE * r_reg

    print('=== ÉTAPE 7b — DUEL USD : regime1 (perp intégral) vs btc-swing ===')
    for lab, a, b in WINDOWS:
        w = (ts >= dms(a)) & (ts < dms(b))
        mr, ms = m(r_reg[w]), m(r_sw[w])
        casA = mr['cagr'] > ms['cagr'] and mr['dd'] <= ms['dd']
        casB = mr['cagr'] >= ms['cagr'] - 2.0 and mr['dd'] <= ms['dd'] - 10.0
        print(f'-- {lab}')
        print(fmt('  regime1', mr))
        print(fmt('  btc-swing', ms))
        print(f"  → duel : {'GAGNÉ ✓' if casA or casB else 'PERDU ✗'}"
              f" (A rendement&DD: {'✓' if casA else '✗'}, B DD-10pts: {'✓' if casB else '✗'})")

    print('\n=== ÉTAPE 7c — CONTRIBUTION portefeuille (sleeve 20 % figée, vol égalisée) ===')
    for lab, a, b in WINDOWS:
        w = (ts >= dms(a)) & (ts < dms(b))
        scale = r_ref[w].std(ddof=1) / r_cand[w].std(ddof=1)
        mref, mcs = m(r_ref[w]), m(scale * r_cand[w])
        ok = mcs['cagr'] > mref['cagr'] and mcs['dd'] <= mref['dd'] + 3.0
        print(f'-- {lab} (levier égalisation ×{scale:.3f})')
        print(fmt('  composite référence', mref))
        print(fmt('  + sleeve regime1 20%', mcs))
        print(f"  → contribution : {'AMÉLIORE ✓' if ok else 'N AMÉLIORE PAS ✗'}")

    wf = (ts >= dms(WINDOWS[0][1])) & (ts < dms(WINDOWS[0][2]))
    names = (('swing', r_sw), ('accum(USD)', r_ac), ('vrx(USD)', r_vx), ('composite', r_ref))
    cor_all = [np.corrcoef(r_reg[wf], x[wf])[0, 1] for _, x in names]
    won = wf & on
    cor_on = [np.corrcoef(r_reg[won], x[won])[0, 1] for _, x in names]
    print('\ncorrélations quotidiennes regime1 vs ' + ', '.join(n for n, _ in names))
    print('  fenêtre complète : ' + ', '.join(f'{c:+.2f}' for c in cor_all))
    print('  jours ON seuls   : ' + ', '.join(f'{c:+.2f}' for c in cor_on))
    for nm in ('swing', 'accum', 'vrx'):
        it = load_in_trade(nm, ts)
        share = float(it[won].mean()) * 100
        kind = 'en position' if nm == 'swing' else 'en excursion'
        print(f'  co-activité : {nm} {kind} pendant {share:4.1f}% des jours ON de regime1')

    print('\n=== ÉTAPE 7d — STABILITÉ par période calendaire (comptée si ≥15 j ON) ===')
    counted, pos, worst = 0, 0, np.inf
    for i in range(len(PERIODS) - 1):
        w = (ts >= dms(PERIODS[i])) & (ts < dms(PERIODS[i + 1]))
        ndon = int(on[w].sum())
        x = m(r_reg[w]) if w.sum() > 30 else None
        tag = ''
        if x is not None and ndon >= 15:
            counted += 1
            pos += x['sharpe'] > 0
            worst = min(worst, x['sharpe'])
            tag = ' [comptée]'
        sh = f"{x['sharpe']:+5.2f}" if x else '  n/a'
        print(f"  {PERIODS[i]}→{PERIODS[i + 1]} : Sharpe {sh}, {ndon:3d} j ON{tag}")
    ok7d = counted > 0 and pos * 2 > counted and worst > -1.0
    print(f'  → {pos}/{counted} périodes comptées positives, pire Sharpe {worst:+.2f} '
          f"→ {'STABLE ✓' if ok7d else 'INSTABLE ✗'}")


if __name__ == '__main__':
    main()
