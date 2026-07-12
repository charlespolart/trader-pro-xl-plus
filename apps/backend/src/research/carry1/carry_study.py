#!/usr/bin/env python3
# carry1 : comptabilité du cash-and-carry (long spot + short perp, funding
# encaissé) selon les hypothèses PRÉ-ENREGISTRÉES du LOG — aucune variante
# au-delà de : politiques (a) hold / (b) règle 7 j, capital prudent ×0,50 /
# efficace ×0,83, grille de coûts 0,2/0,4/0,6 %.
#   python3 carry_study.py
import json
import os
import subprocess
import urllib.request

import numpy as np

DB = os.environ.get('DATABASE_URL', 'postgres://tpx:tpx@localhost:5436/tpx')
DAY = 86400000
FACTORS = {'prudent': 0.50, 'efficace': 0.83}
COST = 0.004          # round-trip pré-enregistré (grille : 0.002 / 0.004 / 0.006)


def psql_rows(sql: str) -> list:
    p = subprocess.run(['psql', DB, '-q', '-t', '-A', '-c', sql],
                       capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[:400])
    return [r.split('|') for r in p.stdout.strip().splitlines() if r]


def daily_funding(symbol: str):
    """Somme des taux par jour UTC + grille de jours continue."""
    rows = psql_rows(f"SELECT t, rate FROM perp_funding WHERE venue='binance' "
                     f"AND symbol='{symbol}' ORDER BY t")
    t = np.array([int(r[0]) for r in rows], dtype=np.int64)
    rate = np.array([float(r[1]) for r in rows])
    d0, d1 = t[0] // DAY, t[-1] // DAY
    days = np.arange(d0, d1 + 1)
    f = np.zeros(len(days))
    np.add.at(f, (t // DAY - d0).astype(int), rate)
    return days, f


def years_of(days):
    return (days * DAY).astype('datetime64[ms]').astype('datetime64[Y]').astype(int) + 1970


def policy_hold(f):
    return np.ones(len(f), dtype=bool), 0


def policy_rule7(f):
    """Investi le jour d ssi la somme du funding des 7 j finissant à d-1 > 0."""
    c = np.concatenate([[0.0], np.cumsum(f)])
    s7 = np.full(len(f), np.nan)
    s7[7:] = c[7:-1] - c[:-8]
    pos = s7 > 0
    pos[:8] = False
    switches = int(np.abs(np.diff(pos.astype(int))).sum())
    return pos, switches


def basis_context(symbol: str):
    rows = psql_rows(
        "SELECT s.open_time, f.close, s.close FROM candles s JOIN candles f "
        "ON f.market='futures' AND f.symbol=s.symbol AND f.interval='1h' AND f.open_time=s.open_time "
        f"WHERE s.market='spot' AND s.symbol='{symbol}' AND s.interval='1h' ORDER BY s.open_time")
    t = np.array([int(r[0]) for r in rows], dtype=np.int64)
    b = np.array([float(r[1]) / float(r[2]) - 1 for r in rows])
    return t, b


def okx_level_check():
    key = os.environ.get('COINALYZE_API_KEY', '')
    if not key:
        env = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '.env')
        if os.path.exists(env):
            for line in open(env):
                if line.startswith('COINALYZE_API_KEY='):
                    key = line.split('=', 1)[1].strip()
    if not key:
        print('  (clé Coinalyze absente — cross-check OKX sauté)')
        return
    url = ('https://api.coinalyze.net/v1/funding-rate-history?symbols=BTCUSDT_PERP.3'
           '&interval=daily&from=1577836800&to=1790000000')
    req = urllib.request.Request(url, headers={'api_key': key})
    with urllib.request.urlopen(req, timeout=60) as r:
        h = json.loads(r.read())[0]['history']
    t = np.array([x['t'] for x in h], dtype=np.int64)
    c = np.array([float(x['c']) for x in h])
    yr = (t * 1000).astype('datetime64[ms]').astype('datetime64[Y]').astype(int) + 1970
    print('  OKX (approx : moyenne des clôtures daily ×3×365 ; champ Coinalyze déjà en %) vs Binance (exact) :')
    for y in range(2020, 2027):
        m = yr == y
        if m.sum() > 30:
            print(f'    {y}: OKX ≈ {c[m].mean() * 3 * 365:+6.2f}%/an  (n={m.sum()} j)')


def study(symbol: str):
    days, f = daily_funding(symbol)
    yr = years_of(days)
    print(f'=== {symbol} — funding Binance exact, {len(days)} jours '
          f'({np.datetime64(int(days[0]) * DAY, "ms").astype("datetime64[D]")} → '
          f'{np.datetime64(int(days[-1]) * DAY, "ms").astype("datetime64[D]")}) ===')
    pol = {'(a) hold': policy_hold(f), '(b) règle 7j': policy_rule7(f)}
    print(f'  {"année":6} {"brut":>8} {"net prud.":>9} {"net effic.":>10} '
          f'{"%j<0":>6} | {"(b) net effic.":>13} {"pire mois (a,eff)":>17}')
    for y in sorted(set(yr)):
        m = yr == y
        brut = f[m].sum()
        neg = (f[m] < 0).mean()
        pa, _ = pol['(a) hold']
        pb, _ = pol['(b) règle 7j']
        net_a = {k: brut * v for k, v in FACTORS.items()}
        nb = (f * pb)[m].sum() * FACTORS['efficace']
        swy = int(np.abs(np.diff((pb[m]).astype(int))).sum())
        nb -= swy * COST * FACTORS['efficace']
        mo = (days[m] * DAY).astype('datetime64[ms]').astype('datetime64[M]')
        worst_mo = min(f[m][mo == u].sum() for u in np.unique(mo)) * FACTORS['efficace']
        print(f'  {y:6d} {brut * 100:+7.2f}% {net_a["prudent"] * 100:+8.2f}% {net_a["efficace"] * 100:+9.2f}% '
              f'{neg * 100:5.1f}% | {nb * 100:+12.2f}% {worst_mo * 100:+16.2f}%')
    n_years = len(f) / 365.25
    for name, (pos, sw) in pol.items():
        for cost in (0.002, 0.004, 0.006):
            tot = (f * pos).sum() - sw * cost - cost / 2
            eff = tot * FACTORS['efficace'] / n_years
            pru = tot * FACTORS['prudent'] / n_years
            tag = ' ←' if cost == COST else ''
            print(f'  {name:12} coûts {cost * 100:.1f}%/cycle : net effic. {eff * 100:+.2f}%/an, '
                  f'prudent {pru * 100:+.2f}%/an (cycles={sw}){tag}')
    # courbe & drawdown (a, efficace, coûts pré-enregistrés)
    curve = np.cumsum(f * FACTORS['efficace'])
    dd = curve - np.maximum.accumulate(curve)
    i = int(np.argmin(dd))
    print(f'  courbe (a) efficace : max drawdown de rendement {dd[i] * 100:+.2f}% '
          f'(creux le {np.datetime64(int(days[i]) * DAY, "ms").astype("datetime64[D]")})')
    t, b = basis_context(symbol)
    yb = (t.astype('datetime64[ms]')).astype('datetime64[Y]').astype(int) + 1970
    print('  contexte basis perp-spot 1h (moyenne [p5..p95]) :')
    for y in range(2020, 2027):
        m = yb == y
        if m.sum() > 1000:
            print(f'    {y}: {b[m].mean() * 100:+.3f}%  [{np.percentile(b[m], 5) * 100:+.3f}% .. '
                  f'{np.percentile(b[m], 95) * 100:+.3f}%]')


def main():
    study('BTCUSDT')
    print()
    study('ETHUSDT')
    print()
    okx_level_check()


if __name__ == '__main__':
    main()
