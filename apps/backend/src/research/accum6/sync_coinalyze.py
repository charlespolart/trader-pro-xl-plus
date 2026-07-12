#!/usr/bin/env python3
# accum6 — OUTIL DE SYNCHRO Coinalyze → Postgres (remplace l'option A collecteur WS).
# Relançable à la demande : complète les données manquantes, idempotent.
#   - daily : backfill 2020-01→ (jamais purgé côté API) puis incrémental.
#   - 4hour / 1hour : la fenêtre API est GLISSANTE (~11 mois / ~2,5 mois) —
#     chaque run fusionne le snapshot courant dans le store ; relance ≥ mensuelle
#     = historique intraday continu SANS collecteur temps réel. (5min exclu :
#     fenêtre ~1 semaine, il faudrait une relance hebdo.)
# Séries : liq long/short (l,s) 4 venues + OI OHLC 4 venues + funding Binance,
# BTC & ETH. Valeurs stockées BRUTES (linéaires = coin, BitMEX inverse = USD) —
# normaliser à l'étude (×prix ou z par venue), cf. LOG rupture 2021-04-27.
# Store : table coinalyze(series, t, payload jsonb) sur le PG local (5436).
#   python3 sync_coinalyze.py            # clé lue dans apps/backend/.env si absente de l'env
# Lecture côté étude :
#   COPY (SELECT t, payload->>'l', payload->>'s' FROM coinalyze
#         WHERE series='BTC_liq_binance_daily' ORDER BY t) TO STDOUT (FORMAT csv)
import json
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.environ.get('DATABASE_URL', 'postgres://tpx:tpx@localhost:5436/tpx')
BASE = 'https://api.coinalyze.net/v1'
FROM_DEFAULT = 1577836800  # 2020-01-01
INTERVALS = [('daily', 86400), ('4hour', 14400), ('1hour', 3600)]
VENUES = {'binance': 'A', 'okx': '3', 'bybit': '6', 'bitmex': '0'}
SYMBOLS = {
    'BTC': {'binance': 'BTCUSDT_PERP.A', 'okx': 'BTCUSDT_PERP.3',
            'bybit': 'BTCUSDT.6', 'bitmex': 'BTCUSD_PERP.0'},
    'ETH': {'binance': 'ETHUSDT_PERP.A', 'okx': 'ETHUSDT_PERP.3',
            'bybit': 'ETHUSDT.6', 'bitmex': 'ETHUSD_PERP.0'},
}


def api_key() -> str:
    k = os.environ.get('COINALYZE_API_KEY', '')
    if not k:
        env = os.path.join(HERE, '..', '..', '..', '.env')
        if os.path.exists(env):
            for line in open(env):
                if line.startswith('COINALYZE_API_KEY='):
                    k = line.split('=', 1)[1].strip()
    if not k:
        sys.exit('COINALYZE_API_KEY introuvable (env ou apps/backend/.env)')
    return k


KEY = None


def get(ep: str, **params):
    q = '&'.join(f'{k}={v}' for k, v in params.items())
    req = urllib.request.Request(f'{BASE}/{ep}?{q}', headers={'api_key': KEY})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(10 * (attempt + 1))
                continue
            raise
    raise RuntimeError(f'rate-limited: {ep}')


def psql(sql: str, stdin: str | None = None) -> str:
    p = subprocess.run(['psql', DB, '-q', '-t', '-A', '-c', sql],
                       input=stdin, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[:400])
    return p.stdout.strip()


def ensure_table():
    psql('CREATE TABLE IF NOT EXISTS coinalyze ('
         ' series text NOT NULL, t bigint NOT NULL, payload jsonb NOT NULL,'
         ' PRIMARY KEY (series, t))')


def upsert(series: str, hist: list) -> int:
    if not hist:
        return 0
    n = 0
    for i in range(0, len(hist), 1000):
        chunk = hist[i:i + 1000]
        vals = ','.join(
            "('%s',%d,'%s')" % (series, int(x['t']),
                                json.dumps({k: v for k, v in x.items() if k != 't'}))
            for x in chunk)
        psql(f'INSERT INTO coinalyze (series,t,payload) VALUES {vals} '
             'ON CONFLICT (series,t) DO UPDATE SET payload=EXCLUDED.payload')
        n += len(chunk)
    return n


def sync_series(series: str, ep: str, sym: str, itv: str, step: int, now: int):
    last = psql(f"SELECT max(t) FROM coinalyze WHERE series='{series}'")
    frm = FROM_DEFAULT if not last else max(FROM_DEFAULT, int(last) - 2 * step)
    r = get(ep, symbols=sym, interval=itv, **{'from': frm, 'to': now})
    hist = r[0]['history'] if r and r[0].get('history') else []
    n = upsert(series, hist)
    time.sleep(1.6)  # 40 req/min
    cnt, tmin, tmax = psql(f"SELECT count(*), min(t), max(t) FROM coinalyze WHERE series='{series}'").split('|')
    if not tmin:
        print(f'  {series:28} aucune donnée renvoyée par l\'API')
        return
    tail = '' if not last else f' (+{sum(1 for x in hist if x["t"] > int(last))} nouveaux)'
    gap = ''
    if itv == 'daily' and cnt and tmin:
        expected = (int(tmax) - int(tmin)) // step + 1
        holes = expected - int(cnt)
        gap = f' trous={holes}' if holes else ''
    print(f'  {series:28} +{n:5d} upserts{tail:22} store: {cnt:>6} barres '
          f'{time.strftime("%Y-%m-%d", time.gmtime(int(tmin)))}→{time.strftime("%Y-%m-%d", time.gmtime(int(tmax)))}{gap}')


def main():
    global KEY
    KEY = api_key()
    ensure_table()
    now = int(time.time())
    for itv, step in INTERVALS:
        print(f'[{itv}]')
        for coin, venues in SYMBOLS.items():
            for venue, sym in venues.items():
                sync_series(f'{coin}_liq_{venue}_{itv}', 'liquidation-history', sym, itv, step, now)
                sync_series(f'{coin}_oi_{venue}_{itv}', 'open-interest-history', sym, itv, step, now)
            sync_series(f'{coin}_funding_binance_{itv}', 'funding-rate-history', venues['binance'], itv, step, now)
    total = psql('SELECT count(*) FROM coinalyze')
    print(f'→ table coinalyze : {total} lignes au total')


if __name__ == '__main__':
    main()
