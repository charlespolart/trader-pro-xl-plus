#!/usr/bin/env python3
# accum6 intraday : téléchargement de l'archive `metrics` de data.binance.vision
# (snapshots 5 min : open interest coin/USD, toptrader L/S, global L/S, taker
# ratio) → table PG binance_metrics. BTC dès 2020-09-01, ETH dès 2021-12-01.
# Resumable (re-upsert du dernier jour + jours suivants), idempotent.
#   python3 fetch_metrics.py
import csv
import io
import os
import subprocess
import sys
import time
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

DB = os.environ.get('DATABASE_URL', 'postgres://tpx:tpx@localhost:5436/tpx')
S3 = 'https://s3-ap-northeast-1.amazonaws.com/data.binance.vision'
CDN = 'https://data.binance.vision'
SYMBOLS = ['BTCUSDT', 'ETHUSDT']
COLS = ['oi', 'oi_usd', 'tt_count', 'tt_sum', 'ls_count', 'taker']
HDR = {'sum_open_interest': 'oi', 'sum_open_interest_value': 'oi_usd',
       'count_toptrader_long_short_ratio': 'tt_count',
       'sum_toptrader_long_short_ratio': 'tt_sum',
       'count_long_short_ratio': 'ls_count',
       'sum_taker_long_short_vol_ratio': 'taker'}


def psql(sql: str) -> str:
    p = subprocess.run(['psql', DB, '-q', '-t', '-A', '-c', sql],
                       capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[:400])
    return p.stdout.strip()


def list_keys(symbol: str) -> list:
    keys, marker = [], ''
    prefix = f'data/futures/um/daily/metrics/{symbol}/'
    while True:
        url = f'{S3}?prefix={prefix}&max-keys=1000' + (f'&marker={marker}' if marker else '')
        with urllib.request.urlopen(url, timeout=60) as r:
            xml = r.read().decode()
        page = [k.split('<Key>')[1] for k in xml.split('</Key>')[:-1] if '<Key>' in k]
        keys += [k for k in page if k.endswith('.zip')]
        if '<IsTruncated>true</IsTruncated>' not in xml or not page:
            break
        marker = page[-1]
    return sorted(keys)


def fetch_one(key: str):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(f'{CDN}/{key}', timeout=120) as r:
                buf = r.read()
            zf = zipfile.ZipFile(io.BytesIO(buf))
            rows = []
            with zf.open(zf.namelist()[0]) as f:
                rd = csv.reader(io.TextIOWrapper(f, 'utf-8'))
                header = next(rd)
                idx = {HDR[h]: i for i, h in enumerate(header) if h in HDR}
                ti = header.index('create_time')
                for row in rd:
                    if not row or not row[ti]:
                        continue
                    ts = row[ti].strip()
                    dt = datetime.strptime(ts[:19], '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)
                    t = int(dt.timestamp() * 1000)
                    vals = []
                    for c in COLS:
                        i = idx.get(c)
                        v = row[i].strip() if i is not None and i < len(row) else ''
                        vals.append(v if v else 'NULL')
                    rows.append((t, vals))
            ded = {}          # certains fichiers dupliquent des snapshots
            for t, vals in rows:
                ded[t] = vals
            return key, sorted(ded.items())
        except Exception as e:
            if attempt == 3:
                return key, f'ERREUR {type(e).__name__}: {e}'
            time.sleep(2 * (attempt + 1))


def upsert(symbol: str, rows: list):
    for i in range(0, len(rows), 2000):
        chunk = rows[i:i + 2000]
        vals = ','.join(f"('{symbol}',{t},{','.join(v)})" for t, v in chunk)
        psql(f'INSERT INTO binance_metrics (symbol,t,{",".join(COLS)}) VALUES {vals} '
             f'ON CONFLICT (symbol,t) DO UPDATE SET '
             + ','.join(f'{c}=EXCLUDED.{c}' for c in COLS))


def main():
    psql('CREATE TABLE IF NOT EXISTS binance_metrics ('
         ' symbol text NOT NULL, t bigint NOT NULL,'
         + ','.join(f' {c} double precision' for c in COLS)
         + ', PRIMARY KEY (symbol, t))')
    for symbol in SYMBOLS:
        keys = list_keys(symbol)
        last = psql(f"SELECT max(t) FROM binance_metrics WHERE symbol='{symbol}'")
        if last:
            day = datetime.fromtimestamp(int(last) / 1000, tz=timezone.utc).strftime('%Y-%m-%d')
            keys = [k for k in keys if k.split('-metrics-')[1][:10] >= day]
        print(f'{symbol}: {len(keys)} fichiers à charger', flush=True)
        done, errs = 0, []
        with ThreadPoolExecutor(max_workers=12) as ex:
            for key, rows in ex.map(fetch_one, keys):
                if isinstance(rows, str):
                    errs.append(f'{key}: {rows}')
                else:
                    upsert(symbol, rows)
                done += 1
                if done % 200 == 0:
                    print(f'  {symbol}: {done}/{len(keys)}', flush=True)
        for e in errs[:10]:
            print(f'  ⚠ {e}', flush=True)
        cnt, tmin, tmax, days = psql(
            f"SELECT count(*), min(t), max(t), count(DISTINCT t/86400000) "
            f"FROM binance_metrics WHERE symbol='{symbol}'").split('|')
        span = (int(tmax) - int(tmin)) // 86400000 + 1
        d0 = datetime.fromtimestamp(int(tmin) / 1000, tz=timezone.utc).strftime('%Y-%m-%d')
        d1 = datetime.fromtimestamp(int(tmax) / 1000, tz=timezone.utc).strftime('%Y-%m-%d')
        print(f'{symbol}: {cnt} snapshots, {days} jours ({d0}→{d1}), '
              f'jours manquants={span - int(days)}, erreurs={len(errs)}', flush=True)


if __name__ == '__main__':
    main()
