#!/usr/bin/env python3
# carry1 : funding EXACT par événement (8 h) depuis l'ARCHIVE data.binance.vision
# (ZIPs mensuels fundingRate, 2020-01→ ; l'API live fapi est géobloquée en
# France, l'archive CDN ne l'est pas) → PG perp_funding(venue, symbol, t, rate).
# Idempotent : reprend au mois du max(t).
#   python3 fetch_funding.py
import csv
import io
import os
import subprocess
import urllib.request
import zipfile
from datetime import datetime, timezone

DB = os.environ.get('DATABASE_URL', 'postgres://tpx:tpx@localhost:5436/tpx')
S3 = 'https://s3-ap-northeast-1.amazonaws.com/data.binance.vision'
CDN = 'https://data.binance.vision'
SYMBOLS = ['BTCUSDT', 'ETHUSDT']


def psql(sql: str) -> str:
    p = subprocess.run(['psql', DB, '-q', '-t', '-A', '-c', sql],
                       capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[:400])
    return p.stdout.strip()


def list_keys(symbol: str) -> list:
    url = f'{S3}?prefix=data/futures/um/monthly/fundingRate/{symbol}/&max-keys=1000'
    with urllib.request.urlopen(url, timeout=60) as r:
        xml = r.read().decode()
    keys = [k.split('<Key>')[1] for k in xml.split('</Key>')[:-1] if '<Key>' in k]
    return sorted(k for k in keys if k.endswith('.zip'))


def parse_zip(key: str) -> list:
    with urllib.request.urlopen(f'{CDN}/{key}', timeout=120) as r:
        zf = zipfile.ZipFile(io.BytesIO(r.read()))
    rows = []
    with zf.open(zf.namelist()[0]) as f:
        rd = csv.reader(io.TextIOWrapper(f, 'utf-8'))
        header = next(rd)
        ti = next(i for i, h in enumerate(header) if 'time' in h.lower())
        ri = next(i for i, h in enumerate(header) if 'rate' in h.lower())
        for row in rd:
            if row and row[ti] and row[ri]:
                rows.append((int(row[ti]), float(row[ri])))
    ded = {t: r for t, r in rows}
    return sorted(ded.items())


def main():
    psql('CREATE TABLE IF NOT EXISTS perp_funding ('
         ' venue text NOT NULL, symbol text NOT NULL, t bigint NOT NULL,'
         ' rate double precision NOT NULL, PRIMARY KEY (venue, symbol, t))')
    for sym in SYMBOLS:
        keys = list_keys(sym)
        last = psql(f"SELECT max(t) FROM perp_funding WHERE venue='binance' AND symbol='{sym}'")
        if last:
            month = datetime.fromtimestamp(int(last) / 1000, tz=timezone.utc).strftime('%Y-%m')
            keys = [k for k in keys if k.split('-fundingRate-')[1][:7] >= month]
        total = 0
        for key in keys:
            rows = parse_zip(key)
            if not rows:
                continue
            vals = ','.join(f"('binance','{sym}',{t},{r})" for t, r in rows)
            psql(f'INSERT INTO perp_funding (venue,symbol,t,rate) VALUES {vals} '
                 'ON CONFLICT (venue,symbol,t) DO UPDATE SET rate=EXCLUDED.rate')
            total += len(rows)
        cnt, t0, t1 = psql(f"SELECT count(*), to_timestamp(min(t)/1000)::date, to_timestamp(max(t)/1000)::date "
                           f"FROM perp_funding WHERE venue='binance' AND symbol='{sym}'").split('|')
        print(f'{sym}: +{total} upserts, store {cnt} événements ({t0} → {t1})')


if __name__ == '__main__':
    main()
