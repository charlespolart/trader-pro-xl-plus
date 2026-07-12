#!/usr/bin/env python3
# carry2 : études pré-enregistrées du LOG — cross-section funding alts.
# 1) distribution par année ; 2) persistance rang mois→mois ; 3) paniers IS
# (BTC/ETH hold, EW univers, rotation top-10 formation = mois précédent) ;
# 4) R4 : overlay sizing unique sur BTC (percentile funding 90 j / 1 an, hebdo).
# IS 2020-01→2024-01 SEULEMENT — l'OOS n'est ni chargé en mémoire d'étude ni
# affiché. Comptabilité carry1 : net efficace ×0,83, coûts 0,4 %/cycle/slot.
#   python3 xs_study.py
import os
import subprocess
from datetime import datetime, timezone

import numpy as np

DB = os.environ.get('DATABASE_URL', 'postgres://tpx:tpx@localhost:5436/tpx')
EFF = 0.83
COST = 0.004
TOPN = 10
IS_A = '2020-01-01'
IS_B = '2024-01-01'
HALF = '2022-01-01'


def psql_rows(sql: str) -> list:
    p = subprocess.run(['psql', DB, '-q', '-t', '-A', '-c', sql],
                       capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[:400])
    return [r.split('|') for r in p.stdout.strip().splitlines() if r]


def month_key(dt: str) -> int:
    y, m = int(dt[:4]), int(dt[5:7])
    return y * 12 + (m - 1)


def load_monthly():
    """Par (symbole, mois) : somme funding, nb événements, premier/dernier t."""
    rows = psql_rows(
        "SELECT symbol, to_char(date_trunc('month', to_timestamp(t/1000) AT TIME ZONE 'UTC'), 'YYYY-MM'),"
        " sum(rate), count(*), min(t), max(t)"
        " FROM perp_funding WHERE venue='binance' AND symbol LIKE '%USDT'"
        " GROUP BY 1, 2")
    data = {}
    first_t = {}
    for sym, mo, s, n, tmin, tmax in rows:
        mk = month_key(mo)
        data[(sym, mk)] = (float(s), int(n), int(tmin), int(tmax))
        if sym not in first_t or int(tmin) < first_t[sym]:
            first_t[sym] = int(tmin)
    return data, first_t


def month_bounds(mk: int):
    y, m = divmod(mk, 12)
    a = datetime(y, m + 1, 1, tzinfo=timezone.utc).timestamp() * 1000
    y2, m2 = divmod(mk + 1, 12)
    b = datetime(y2, m2 + 1, 1, tzinfo=timezone.utc).timestamp() * 1000
    return a, b


def eligible(data, first_t, sym, mk):
    """Éligible au mois de DÉTENTION mk : ≥90 j d'historique au 1er du mois ET
    formation (mk-1) couverte (≥75 événements, dernier à ≤2 j de la fin)."""
    a, _ = month_bounds(mk)
    if sym not in first_t or a - first_t[sym] < 90 * 86400000:
        return False
    f = data.get((sym, mk - 1))
    if not f:
        return False
    _, n, _, tmax = f
    _, fb = month_bounds(mk - 1)
    return n >= 75 and tmax >= fb - 2 * 86400000


def rankcorr(a, b):
    if len(a) < 20:
        return np.nan
    ra = np.argsort(np.argsort(a)).astype(float)
    rb = np.argsort(np.argsort(b)).astype(float)
    ra = (ra - ra.mean()) / ra.std()
    rb = (rb - rb.mean()) / rb.std()
    return float(np.mean(ra * rb))


def main():
    data, first_t = load_monthly()
    syms = sorted({s for s, _ in data})
    mk_a, mk_b, mk_h = month_key(IS_A), month_key(IS_B), month_key(HALF)
    months_is = range(mk_a + 1, mk_b)   # mois de détention (formation dispo)
    print(f'univers chargé : {len(syms)} symboles USDT, IS {IS_A} → {IS_B}\n')

    # 1) distribution cross-section par année (net efficace annualisé par symbole)
    print('=== 1. distribution du carry net efficace par année (symboles éligibles ≥6 mois dans l\'année) ===')
    print(f'  {"année":6} {"n":>4} {"q25":>8} {"médiane":>8} {"q75":>8} {"BTC":>8} {"%>BTC":>7}')
    for y in range(2020, 2024):
        per_sym = []
        btc = 0.0
        for sym in syms:
            tot, nm = 0.0, 0
            for m in range(y * 12, y * 12 + 12):
                if eligible(data, first_t, sym, m) and (sym, m) in data:
                    tot += data[(sym, m)][0]
                    nm += 1
            if nm >= 6:
                ann = tot / nm * 12 * EFF
                per_sym.append((sym, ann))
                if sym == 'BTCUSDT':
                    btc = ann
        v = np.array([x for _, x in per_sym])
        if len(v) < 10:
            continue
        print(f'  {y:6d} {len(v):4d} {np.percentile(v, 25) * 100:+7.2f}% {np.median(v) * 100:+7.2f}% '
              f'{np.percentile(v, 75) * 100:+7.2f}% {btc * 100:+7.2f}% {(v > btc).mean() * 100:6.1f}%')

    # 2) persistance rang mois→mois
    print('\n=== 2. persistance cross-section (Spearman formation → détention) ===')
    ics = []
    for mk in months_is:
        f, r = [], []
        for sym in syms:
            if not eligible(data, first_t, sym, mk):
                continue
            hold = data.get((sym, mk))
            if not hold:
                continue
            f.append(data[(sym, mk - 1)][0])
            r.append(hold[0])
        ic = rankcorr(np.array(f), np.array(r))
        if np.isfinite(ic):
            ics.append((mk, ic))
    arr = np.array([ic for _, ic in ics])
    h1 = np.array([ic for mk, ic in ics if mk < mk_h])
    h2 = np.array([ic for mk, ic in ics if mk >= mk_h])
    print(f'  IC rang moyen {arr.mean():+.3f} (n={len(arr)} mois, {(arr > 0).mean() * 100:.0f}% positifs) '
          f'| moitiés {h1.mean():+.3f} / {h2.mean():+.3f}')
    # déciles de formation → funding réalisé (annualisé, net eff)
    dec_real = [[] for _ in range(10)]
    for mk in months_is:
        rows = [(data[(s, mk - 1)][0], data[(s, mk)][0]) for s in syms
                if eligible(data, first_t, s, mk) and (s, mk) in data]
        if len(rows) < 40:
            continue
        rows.sort(key=lambda x: x[0])
        for d in range(10):
            seg = rows[len(rows) * d // 10: len(rows) * (d + 1) // 10]
            if seg:
                dec_real[d].append(np.mean([x[1] for x in seg]) * 12 * EFF)
    print('  déciles formation → réalisé net eff. annualisé (D1 pauvre … D10 riche) :')
    print('    ' + '  '.join(f'D{d + 1} {np.mean(v) * 100:+.1f}%' for d, v in enumerate(dec_real)))

    # 3) paniers IS
    print('\n=== 3. paniers (IS, net efficace, coûts 0,4 %/cycle/slot) ===')

    def run_basket(select_fn, n_slots=None, cost=COST):
        prev = set()
        monthly = []
        for mk in months_is:
            elig = [s for s in syms if eligible(data, first_t, s, mk)]
            picks = select_fn(mk, elig)
            if not picks:
                monthly.append(0.0)
                prev = set()
                continue
            k = len(picks)
            gross = np.mean([data.get((s, mk), (0.0,))[0] for s in picks])
            swaps = len(set(picks) - prev) + len(prev - set(picks))
            net = (gross - swaps * cost / k) * EFF
            monthly.append(net)
            prev = set(picks)
        return np.array(monthly)

    def top_by_formation(mk, elig):
        elig = sorted(elig, key=lambda s: data[(s, mk - 1)][0], reverse=True)
        return elig[:TOPN]

    baskets = {
        'BTC hold': run_basket(lambda mk, e: ['BTCUSDT'] if 'BTCUSDT' in e else []),
        'ETH hold': run_basket(lambda mk, e: ['ETHUSDT'] if 'ETHUSDT' in e else []),
        'EW univers': run_basket(lambda mk, e: e),
        f'rotation top-{TOPN}': run_basket(top_by_formation),
        f'rotation top-{TOPN} (coûts 0,8%)': run_basket(top_by_formation, cost=0.008),
    }
    print(f'  {"panier":28} {"moy./an":>9} {"2020":>8} {"2021":>8} {"2022":>8} {"2023":>8} {"pire mois":>10}')
    mks = list(months_is)
    for name, m in baskets.items():
        per_year = []
        for y in range(2020, 2024):
            sel = [v for mk, v in zip(mks, m) if mk // 12 == y]
            per_year.append(sum(sel))
        print(f'  {name:28} {np.mean(per_year) * 100:+8.2f}% ' +
              ' '.join(f'{v * 100:+7.2f}%' for v in per_year) + f' {m.min() * 100:+9.2f}%')

    rot = baskets[f'rotation top-{TOPN}']
    btc_b = baskets['BTC hold']
    edge = (rot.sum() - btc_b.sum()) / len(mks) * 12
    print(f'\n  écart rotation − BTC hold : {edge * 100:+.2f} pts/an '
          f'(barre pré-enregistrée : ≥ +3 pts/an ET persistance >0 sur les 2 moitiés)')

    # 4) R4 — overlay sizing BTC, un seul look
    print('\n=== 4. R4 : overlay sizing BTC (hebdo, percentile funding 90 j / 1 an) ===')
    rows = psql_rows("SELECT t, rate FROM perp_funding WHERE venue='binance' AND symbol='BTCUSDT' "
                     f"AND t < extract(epoch FROM timestamp '{IS_B}') * 1000 ORDER BY t")
    t = np.array([int(r[0]) for r in rows], dtype=np.int64)
    rate = np.array([float(r[1]) for r in rows])
    d0, d1 = t[0] // 86400000, t[-1] // 86400000
    f = np.zeros(int(d1 - d0 + 1))
    np.add.at(f, ((t // 86400000) - d0).astype(int), rate)
    c = np.concatenate([[0.0], np.cumsum(f)])
    s90 = np.full(len(f), np.nan)
    s90[90:] = c[90:-1] - c[:-91]
    w = np.zeros(len(f))
    for i in range(455, len(f), 7):
        hist = s90[i - 358:i + 1:7]
        hist = hist[np.isfinite(hist)]
        if len(hist) >= 30 and np.isfinite(s90[i]):
            w[i:i + 7] = (hist < s90[i]).mean()
    turn = np.abs(np.diff(w, prepend=0.0))
    start = 455
    net_ov = (f[start:] * w[start:]).sum() - (turn[start:] * COST).sum()
    net_ho = f[start:].sum() - COST
    yrs = (len(f) - start) / 365.25
    print(f'  fenêtre comparée : {yrs:.1f} ans (après warmup 15 mois)')
    print(f'  hold    : {net_ho / yrs * EFF * 100:+.2f}%/an net eff.')
    print(f'  overlay : {net_ov / yrs * EFF * 100:+.2f}%/an net eff. (exposition moyenne {w[start:].mean() * 100:.0f}%)')
    print(f'  verdict R4 : {"BAT hold" if net_ov > net_ho else "ne bat PAS hold"} — un seul look, pas de retouche.')


if __name__ == '__main__':
    main()
