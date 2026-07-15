#!/usr/bin/env python3
"""audit1 — diff forensic : bougies ancienne base (5439, réparée) vs archive
canonique fraîche (5438). Explique les ±0,2-3 pt de net constatés en A5.
Pour chaque (symbole, intervalle) : lignes absentes d'un côté, lignes
différentes (champ par champ), et leur localisation temporelle."""
import subprocess
from collections import Counter

PAIRS = [('BTCUSDT', i) for i in ('1h', '4h', '1d', '3d', '1w')] + \
        [('ETHUSDT', i) for i in ('1h', '4h', '1d', '3d', '1w')]
COLS = 'open_time,open,high,low,close,volume,taker_buy_base,close_time'


def fetch(port, symbol, interval):
    q = (f"COPY (SELECT {COLS} FROM candles WHERE market='spot' AND symbol='{symbol}' "
         f"AND interval='{interval}' ORDER BY open_time) TO STDOUT (FORMAT csv)")
    out = subprocess.run(
        ['psql', f'postgres://tpx:tpx@localhost:{port}/tpx', '-c', q],
        capture_output=True, text=True, check=True).stdout
    rows = {}
    for line in out.strip().split('\n'):
        if not line:
            continue
        f = line.split(',')
        rows[int(f[0])] = f
    return rows


def day(ms):
    import datetime
    return datetime.datetime.utcfromtimestamp(ms / 1000).strftime('%Y-%m-%d')


for symbol, interval in PAIRS:
    old = fetch(5439, symbol, interval)
    new = fetch(5438, symbol, interval)
    only_old = sorted(set(old) - set(new))
    only_new = sorted(set(new) - set(old))
    diffs = []
    for t in sorted(set(old) & set(new)):
        a, b = old[t], new[t]
        for k in range(1, len(a)):
            va, vb = a[k], b[k]
            try:
                if abs(float(va) - float(vb)) > max(1e-9, abs(float(vb)) * 1e-12):
                    diffs.append((t, COLS.split(',')[k], va, vb))
            except ValueError:
                if va != vb:
                    diffs.append((t, COLS.split(',')[k], va, vb))
    months = Counter(day(t)[:7] for t, *_ in diffs)
    print(f'{symbol} {interval}: ancien {len(old)} | neuf {len(new)} | '
          f'absents-du-neuf {len(only_old)} | absents-de-l-ancien {len(only_new)} | cellules diff {len(diffs)}')
    if only_old:
        print(f'   seulement dans l ancien : {day(only_old[0])} → {day(only_old[-1])} ({len(only_old)})')
    if only_new:
        print(f'   seulement dans le neuf  : {day(only_new[0])} → {day(only_new[-1])} ({len(only_new)})')
    if diffs:
        top = months.most_common(5)
        print(f'   diffs par mois (top) : {top}')
        for t, field, va, vb in diffs[:4]:
            print(f'     ex {day(t)} {field}: ancien {va} vs neuf {vb}')
