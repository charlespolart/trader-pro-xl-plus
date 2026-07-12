#!/usr/bin/env python3
# carry1 addendum (R3) : niveaux de funding par venue (BTC/ETH), Coinalyze daily.
# Champ Coinalyze en % par 8 h → annualisé ≈ moyenne(clôtures) ×3×365.
# Question : la venue du short change-t-elle le rendement, et de combien ?
#   python3 venues_check.py
import json
import os
import time
import urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
VENUES = {'binance': 'A', 'okx': '3', 'bybit': '6', 'bitmex': '0'}


def key():
    k = os.environ.get('COINALYZE_API_KEY', '')
    if not k:
        for line in open(os.path.join(HERE, '..', '..', '..', '.env')):
            if line.startswith('COINALYZE_API_KEY='):
                k = line.split('=', 1)[1].strip()
    return k


API_KEY = key()


def fetch(sym):
    url = (f'https://api.coinalyze.net/v1/funding-rate-history?symbols={sym}'
           f'&interval=daily&from=1577836800&to=1790000000')
    req = urllib.request.Request(url, headers={'api_key': API_KEY})
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read())
    time.sleep(1.6)
    return d[0]['history'] if d and d[0].get('history') else []


def main():
    for coin, syms in (('BTC', {'binance': 'BTCUSDT_PERP.A', 'okx': 'BTCUSDT_PERP.3',
                                'bybit': 'BTCUSDT.6', 'bitmex': 'BTCUSD_PERP.0'}),
                       ('ETH', {'binance': 'ETHUSDT_PERP.A', 'okx': 'ETHUSDT_PERP.3',
                                'bybit': 'ETHUSDT.6', 'bitmex': 'ETHUSD_PERP.0'})):
        print(f'=== {coin} — funding annualisé par venue (%/an, approx daily) ===')
        series = {}
        for v, s in syms.items():
            h = [x for x in fetch(s) if x.get('c') is not None]
            t = np.array([x['t'] for x in h], dtype=np.int64)
            c = np.array([float(x['c']) for x in h])
            series[v] = (t, c)
        years = range(2020, 2027)
        print('  ' + 'année '.ljust(8) + ' '.join(f'{v:>9}' for v in syms))
        best = {v: 0 for v in syms}
        for y in years:
            row = []
            vals = {}
            for v in syms:
                t, c = series[v]
                yr = (t * 1000).astype('datetime64[ms]').astype('datetime64[Y]').astype(int) + 1970
                m = yr == y
                vals[v] = c[m].mean() * 3 * 365 if m.sum() > 60 else np.nan
                row.append(f'{vals[v]:+9.2f}' if np.isfinite(vals[v]) else '        —')
            fin = {v: x for v, x in vals.items() if np.isfinite(x)}
            if fin:
                best[max(fin, key=fin.get)] += 1
            print(f'  {y:<7} ' + ' '.join(row))
        print('  meilleure venue (nb années) : ' + ', '.join(f'{v}={n}' for v, n in best.items() if n))


if __name__ == '__main__':
    main()
