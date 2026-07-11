#!/usr/bin/env python3
# Usine de données accum3 : ingestion de TOUTES les paires */BTC de Binance Vision
# (délistées incluses — anti-biais du survivant AU NIVEAU DE LA LISTE), directement
# dans la table candles (dédup ON CONFLICT DO NOTHING).
#
#   python3 visionfetch.py list   # énumère les paires *BTC (S3 paginé) → btc_pairs.txt
#   python3 visionfetch.py 1d     # ingère le 1d de toutes les paires de la liste
#   python3 visionfetch.py 4h     # ingère le 4h des paires « ever top-40 volume BTC 90j »
#   python3 visionfetch.py tail   # complète la queue (mois courant) via REST, paires listées
#
# ⚠ ne JAMAIS télécharger les 3d/1w mensuels Vision (bougies de fin de mois manquantes,
#   bug réparé dans accum2) — les TF lents s'agrègent depuis le 1d.
# Fichiers 2025+ : timestamps en MICROsecondes → convertis en ms ici.
# Reprise sûre : done-file (scratchpad) + dédup DB. Stdlib uniquement.
import concurrent.futures as cf
import io
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.environ.get('DATABASE_URL', 'postgres://tpx:tpx@localhost:5436/tpx')
S3 = 'https://s3-ap-northeast-1.amazonaws.com/data.binance.vision'
DL = 'https://data.binance.vision/'
NS = {'s3': 'http://s3.amazonaws.com/doc/2006-03-01/'}
PAIRS_FILE = os.path.join(HERE, 'btc_pairs.txt')
STATE = os.environ.get('ACCUM3_STATE', '/private/tmp/claude-501/-Users-charlespolart-Documents-Coding-trader-pro-xl-plus/54291f66-b329-40d9-943e-8410c7d8a340/scratchpad')
os.makedirs(STATE, exist_ok=True)
DONE_FILE = os.path.join(STATE, 'visionfetch_done.txt')

COLS = 'market,symbol,interval,open_time,open,high,low,close,volume,quote_volume,trades,taker_buy_base,taker_buy_quote,close_time'


def fetch(url: str, tries: int = 6) -> bytes:
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=90) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise
            if i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))
    raise RuntimeError('unreachable')


def s3_list(prefix: str, delimiter: str = ''):
    token = None
    prefixes: list[str] = []
    keys: list[str] = []
    while True:
        url = f'{S3}?list-type=2&prefix={urllib.parse.quote(prefix)}'
        if delimiter:
            url += f'&delimiter={delimiter}'
        if token:
            url += f'&continuation-token={urllib.parse.quote(token)}'
        root = ET.fromstring(fetch(url))
        for cp in root.findall('s3:CommonPrefixes/s3:Prefix', NS):
            prefixes.append(cp.text or '')
        for k in root.findall('s3:Contents/s3:Key', NS):
            keys.append(k.text or '')
        if root.findtext('s3:IsTruncated', 'false', NS) != 'true':
            break
        token = root.findtext('s3:NextContinuationToken', None, NS)
        if not token:
            break
    return prefixes, keys


def psql(sql: str, input_bytes: bytes | None = None) -> str:
    p = subprocess.run(['psql', DB, '-q', '-t', '-A', '-c', sql], input=input_bytes, capture_output=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode()[:500])
    return p.stdout.decode()


def load_done() -> set[str]:
    if not os.path.exists(DONE_FILE):
        return set()
    with open(DONE_FILE) as f:
        return {line.strip() for line in f if line.strip()}


def mark_done(key: str) -> None:
    with open(DONE_FILE, 'a') as f:
        f.write(key + '\n')


def parse_zip(data: bytes):
    rows = []
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for name in z.namelist():
            for line in z.read(name).decode('utf-8', 'replace').splitlines():
                f = line.split(',')
                if len(f) < 11 or not f[0] or not f[0][0].isdigit():
                    continue  # en-tête (fichiers 2025+) ou ligne vide
                t, ct = int(f[0]), int(f[6])
                if t > 10**14:  # microsecondes (fichiers 2025+) → ms
                    t //= 1000
                if ct > 10**14:
                    ct //= 1000
                n = str(int(float(f[8])))
                rows.append((t, f[1], f[2], f[3], f[4], f[5], f[7], n, f[9], f[10], ct))
    return rows


def insert_rows(sym: str, itv: str, rows) -> None:
    if not rows:
        return
    rows.sort()
    csv = '\n'.join(
        f'spot,{sym},{itv},{t},{o},{h},{l},{c},{v},{qv},{n},{tb},{tq},{ct}'
        for (t, o, h, l, c, v, qv, n, tb, tq, ct) in rows
    )
    sql = (
        f'BEGIN; CREATE TEMP TABLE stage (LIKE candles); '
        f'COPY stage({COLS}) FROM STDIN WITH (FORMAT csv); '
        f'INSERT INTO candles ({COLS}) SELECT {COLS} FROM stage ON CONFLICT DO NOTHING; COMMIT;'
    )
    psql(sql, csv.encode())


def ingest_symbol(sym: str, itv: str) -> int:
    _, keys = s3_list(f'data/spot/monthly/klines/{sym}/{itv}/')
    zips = [k for k in keys if k.endswith('.zip')]
    rows = []
    for k in zips:
        try:
            rows.extend(parse_zip(fetch(DL + k)))
        except urllib.error.HTTPError:
            continue
    insert_rows(sym, itv, rows)
    return len(rows)


def stage_list() -> None:
    prefixes, _ = s3_list('data/spot/monthly/klines/', '/')
    syms = sorted(p.rsplit('/', 2)[-2] for p in prefixes if p)
    btc = [s for s in syms if s.endswith('BTC')]
    with open(PAIRS_FILE, 'w') as f:
        f.write('\n'.join(btc) + '\n')
    print(f'{len(syms)} symboles au total, {len(btc)} paires *BTC → {PAIRS_FILE}')


def run_pool(pairs: list[str], itv: str) -> None:
    done = load_done()
    todo = [s for s in pairs if f'{s} {itv}' not in done]
    print(f'{itv}: {len(todo)} paires à ingérer ({len(pairs) - len(todo)} déjà faites)')
    ok = 0
    t0 = time.time()

    def work(sym: str):
        n = ingest_symbol(sym, itv)
        mark_done(f'{sym} {itv}')
        return sym, n

    with cf.ThreadPoolExecutor(max_workers=12) as ex:
        futs = [ex.submit(work, s) for s in todo]
        for fut in cf.as_completed(futs):
            try:
                sym, n = fut.result()
                ok += 1
                if ok % 20 == 0 or n > 5000:
                    print(f'  [{ok}/{len(todo)}] {sym}: {n} bougies ({time.time() - t0:.0f}s)', flush=True)
            except Exception as e:
                print(f'  ✗ {e}', flush=True)
    print(f'{itv} terminé : {ok}/{len(todo)} paires en {time.time() - t0:.0f}s')


def qualifying_4h() -> list[str]:
    sql = """
    WITH d AS (
      SELECT symbol, open_time/86400000 AS day, GREATEST(quote_volume, volume*close) AS qv
      FROM candles WHERE market='spot' AND interval='1d' AND symbol LIKE '%BTC'
    ), r AS (
      SELECT symbol, day,
             AVG(qv)  OVER (PARTITION BY symbol ORDER BY day ROWS BETWEEN 89 PRECEDING AND CURRENT ROW) AS v90,
             COUNT(*) OVER (PARTITION BY symbol ORDER BY day ROWS BETWEEN 89 PRECEDING AND CURRENT ROW) AS n90
      FROM d
    ), k AS (
      SELECT symbol, day, RANK() OVER (PARTITION BY day ORDER BY v90 DESC) AS rk
      FROM r WHERE n90 >= 60
    )
    SELECT DISTINCT symbol FROM k WHERE rk <= 40 ORDER BY symbol;
    """
    return [s for s in psql(sql).split() if s]


def stage_tail() -> None:
    info = json.loads(fetch('https://api.binance.com/api/v3/exchangeInfo'))
    listed = {s['symbol'] for s in info['symbols'] if s['status'] == 'TRADING' and s['quoteAsset'] == 'BTC'}
    q4 = set(qualifying_4h())
    with open(PAIRS_FILE) as f:
        pairs = [line.strip() for line in f if line.strip()]
    jobs = [(s, '1d') for s in pairs if s in listed] + [(s, '4h') for s in pairs if s in listed and s in q4]
    print(f'tail REST : {len(jobs)} (paire, tf)')
    ms = {'1d': 86400000, '4h': 14400000}

    def work(sym: str, itv: str):
        out = psql(f"SELECT COALESCE(MAX(open_time),0) FROM candles WHERE market='spot' AND symbol='{sym}' AND interval='{itv}'")
        start = int(out.strip() or 0) + ms[itv]
        total = 0
        while True:
            url = f'https://api.binance.com/api/v3/klines?symbol={sym}&interval={itv}&startTime={start}&limit=1000'
            kl = json.loads(fetch(url))
            if not kl:
                break
            rows = []
            for f in kl[:-1]:  # dernière bougie potentiellement non close → exclue
                t, ct = int(f[0]), int(f[6])
                rows.append((t, f[1], f[2], f[3], f[4], f[5], f[7], str(int(float(f[8]))), f[9], f[10], ct))
            insert_rows(sym, itv, rows)
            total += len(rows)
            if len(kl) < 1000:
                break
            start = int(kl[-1][0]) + ms[itv]
            time.sleep(0.1)
        return total

    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(work, s, i): (s, i) for s, i in jobs}
        for fut in cf.as_completed(futs):
            s, i = futs[fut]
            try:
                n = fut.result()
                if n:
                    print(f'  {s} {i}: +{n}', flush=True)
            except Exception as e:
                print(f'  ✗ {s} {i}: {e}', flush=True)
    print('tail terminé')


if __name__ == '__main__':
    stage = sys.argv[1] if len(sys.argv) > 1 else 'list'
    if stage == 'list':
        stage_list()
    elif stage in ('1d', '4h'):
        if not os.path.exists(PAIRS_FILE):
            stage_list()
        with open(PAIRS_FILE) as f:
            pairs = [line.strip() for line in f if line.strip()]
        if stage == '4h':
            pairs = qualifying_4h()
            print(f'{len(pairs)} paires qualifiées top-40 vol 90j')
        run_pool(pairs, stage)
    elif stage == 'tail':
        stage_tail()
    else:
        print(f'stage inconnu: {stage}')
        sys.exit(1)
