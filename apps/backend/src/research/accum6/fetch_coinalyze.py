#!/usr/bin/env python3
# accum6 : récupération + cache des séries Coinalyze (daily 2020→, jamais purgé).
# Liquidations long/short par venue, open interest, funding — BTC & ETH.
# Cache JSON dans le scratchpad (clé lue dans COINALYZE_API_KEY).
#   COINALYZE_API_KEY=... python3 fetch_coinalyze.py
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'accum3'))
from lib import SCRATCH  # noqa: E402

KEY = os.environ.get('COINALYZE_API_KEY', '')
BASE = 'https://api.coinalyze.net/v1'
FROM = 1577836800  # 2020-01-01
TO = 1783300000    # ~2026-07-12

# (étiquette, symbole Coinalyze) — .A Binance, .3 OKX, .6 Bybit, .0 BitMEX
VENUES_BTC = [('binance', 'BTCUSDT_PERP.A'), ('okx', 'BTCUSDT_PERP.3'),
              ('bybit', 'BTCUSDT.6'), ('bitmex', 'BTCUSD_PERP.0')]
VENUES_ETH = [('binance', 'ETHUSDT_PERP.A'), ('okx', 'ETHUSDT_PERP.3'),
              ('bybit', 'ETHUSDT.6'), ('bitmex', 'ETHUSD_PERP.0')]


def get(ep: str, **params):
    q = '&'.join(f'{k}={v}' for k, v in params.items())
    req = urllib.request.Request(f'{BASE}/{ep}?{q}', headers={'api_key': KEY})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(10 * (attempt + 1))
                continue
            raise
    raise RuntimeError('rate-limited')


def fetch_all():
    out = {}
    for coin, venues in (('BTC', VENUES_BTC), ('ETH', VENUES_ETH)):
        for name, sym in venues:
            r = get('liquidation-history', symbols=sym, interval='daily', **{'from': FROM, 'to': TO})
            h = r[0]['history'] if r and r[0].get('history') else []
            out[f'{coin}_liq_{name}'] = h
            print(f'{coin} liq {name:8}: {len(h)} jours')
            time.sleep(1.6)  # 40 req/min
        for ep, lbl in (('open-interest-history', 'oi'), ('funding-rate-history', 'funding')):
            sym = venues[0][1]  # Binance
            r = get(ep, symbols=sym, interval='daily', **{'from': FROM, 'to': TO})
            h = r[0]['history'] if r and r[0].get('history') else []
            out[f'{coin}_{lbl}_binance'] = h
            print(f'{coin} {lbl:8} binance: {len(h)} jours')
            time.sleep(1.6)
    # bonus : intraday 4h glissant (≈ 1 an) pour étude fine ultérieure
    for coin, venues in (('BTC', VENUES_BTC),):
        r = get('liquidation-history', symbols=venues[0][1], interval='4hour', **{'from': FROM, 'to': TO})
        h = r[0]['history'] if r and r[0].get('history') else []
        out[f'{coin}_liq4h_binance'] = h
        print(f'{coin} liq 4h binance: {len(h)} points ({h[0]["t"] if h else "-"} →)')
    path = os.path.join(SCRATCH, 'coinalyze_daily.json')
    json.dump(out, open(path, 'w'))
    print(f'→ {path} ({os.path.getsize(path) // 1024} KB)')


if __name__ == '__main__':
    if not KEY:
        sys.exit('COINALYZE_API_KEY manquant')
    fetch_all()
