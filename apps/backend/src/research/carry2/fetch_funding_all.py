#!/usr/bin/env python3
# carry2 : funding par événement de TOUS les perps *USDT (délistés inclus)
# depuis l'archive data.binance.vision (ZIPs mensuels) → PG perp_funding.
# Traite symbole par symbole : téléchargements parallèles, un upsert groupé.
# Idempotent : reprend au mois du max(t) par symbole.
#   python3 fetch_funding_all.py
import csv
import io
import os
import subprocess
import time
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

DB = os.environ.get('DATABASE_URL', 'postgres://tpx:tpx@localhost:5436/tpx')
S3 = 'https://s3-ap-northeast-1.amazonaws.com/data.binance.vision'
CDN = 'https://data.binance.vision'
PREFIX = 'data/futures/um/monthly/fundingRate/'


def psql(sql: str) -> str:
    p = subprocess.run(['psql', DB, '-q', '-t', '-A', '-c', sql],
                       capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[:400])
    return p.stdout.strip()


def s3_list(prefix: str, delim: str = '') -> list:
    out, marker = [], ''
    while True:
        url = f'{S3}?prefix={prefix}&max-keys=1000' + (f'&delimiter={delim}' if delim else '') \
              + (f'&marker={marker}' if marker else '')
        xml = None
        for attempt in range(5):
            try:
                with urllib.request.urlopen(url, timeout=60) as r:
                    xml = r.read().decode()
                break
            except Exception:
                if attempt == 4:
                    raise
                time.sleep(2 * (attempt + 1))
        tag = 'Prefix' if delim else 'Key'
        page = [k.split(f'<{tag}>')[1] for k in xml.split(f'</{tag}>')[:-1] if f'<{tag}>' in k]
        if delim:
            page = [p for p in page if p != prefix]
        out += page
        if '<IsTruncated>true</IsTruncated>' not in xml or not page:
            break
        marker = page[-1] if not delim else out[-1]
    return out


def fetch_zip(key: str):
    for attempt in range(4):
        try:
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
            return rows
        except Exception:
            if attempt == 3:
                return None
    return None


def main():
    deadline = time.time() + 7 * 60   # l'environnement tue les tâches longues → sortie propre + relance
    psql('CREATE TABLE IF NOT EXISTS perp_funding ('
         ' venue text NOT NULL, symbol text NOT NULL, t bigint NOT NULL,'
         ' rate double precision NOT NULL, PRIMARY KEY (venue, symbol, t))')
    keys = [k for k in s3_list(PREFIX) if k.endswith('.zip')]
    bysym = {}
    for k in keys:
        sym = k[len(PREFIX):].split('/')[0]
        if sym.endswith('USDT'):
            bysym.setdefault(sym, []).append(k)
    have = dict(r.split('|') for r in psql(
        "SELECT symbol, max(t) FROM perp_funding WHERE venue='binance' GROUP BY symbol").splitlines() if r)
    todo = []
    for sym, ks in sorted(bysym.items()):
        if sym in have:
            month = datetime.fromtimestamp(int(have[sym]) / 1000, tz=timezone.utc).strftime('%Y-%m')
            ks = [k for k in ks if k.split('-fundingRate-')[1][:7] >= month]
        todo += [(sym, k) for k in ks]
    print(f'univers : {len(bysym)} perps USDT, fichiers à charger : {len(todo)}', flush=True)
    import shutil
    import tempfile
    done, errors, expired = 0, 0, False
    CHUNK = 4000
    for ci in range(0, len(todo), CHUNK):
        if time.time() > deadline:
            expired = True
            print('  budget temps atteint — arrêt propre, relancer pour reprendre', flush=True)
            break
        chunk = todo[ci:ci + CHUNK]
        tmp = tempfile.mkdtemp(prefix='fund_')
        cfg = os.path.join(tmp, 'urls.cfg')
        with open(cfg, 'w') as f:
            for i, (sym, k) in enumerate(chunk):
                f.write(f'url = "{CDN}/{k}"\noutput = "{tmp}/{i}__{sym}.zip"\n')
        subprocess.run(['curl', '-sS', '--fail-early', '--retry', '3', '--parallel',
                        '--parallel-max', '20', '--config', cfg],
                       capture_output=True, timeout=360)
        rows_by_sym = {}
        for i, (sym, k) in enumerate(chunk):
            path = f'{tmp}/{i}__{sym}.zip'
            if not os.path.exists(path) or os.path.getsize(path) == 0:
                errors += 1
                continue
            try:
                zf = zipfile.ZipFile(path)
                with zf.open(zf.namelist()[0]) as f:
                    rd = csv.reader(io.TextIOWrapper(f, 'utf-8'))
                    header = next(rd)
                    ti = next(j for j, h in enumerate(header) if 'time' in h.lower())
                    ri = next(j for j, h in enumerate(header) if 'rate' in h.lower())
                    d = rows_by_sym.setdefault(sym, {})
                    for row in rd:
                        if row and row[ti] and row[ri]:
                            d[int(row[ti])] = float(row[ri])
                done += 1
            except Exception:
                errors += 1
        shutil.rmtree(tmp, ignore_errors=True)
        csv_lines = []
        for sym, d in rows_by_sym.items():
            csv_lines += [f'binance,{sym},{t},{r}' for t, r in sorted(d.items())]
        if csv_lines:
            payload = '\n'.join(csv_lines) + '\n'
            psql('CREATE UNLOGGED TABLE IF NOT EXISTS perp_funding_stage '
                 '(venue text, symbol text, t bigint, rate double precision); '
                 'TRUNCATE perp_funding_stage')
            p = subprocess.run(['psql', DB, '-q', '-c',
                                'COPY perp_funding_stage FROM STDIN (FORMAT csv)'],
                               input=payload, capture_output=True, text=True)
            if p.returncode != 0:
                raise RuntimeError(p.stderr[:400])
            psql('INSERT INTO perp_funding SELECT venue, symbol, t, rate FROM perp_funding_stage '
                 'ON CONFLICT (venue,symbol,t) DO UPDATE SET rate=EXCLUDED.rate')
        print(f'  {min(ci + CHUNK, len(todo))}/{len(todo)} fichiers…', flush=True)
    cnt, ns = psql("SELECT count(*), count(DISTINCT symbol) FROM perp_funding WHERE venue='binance'").split('|')
    print(f'{"PARTIEL" if expired else "TERMINÉ"} : {done} fichiers ok ({errors} erreurs) '
          f'→ store {cnt} événements, {ns} symboles', flush=True)


if __name__ == '__main__':
    main()
