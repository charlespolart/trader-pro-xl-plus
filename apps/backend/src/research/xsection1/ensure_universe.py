#!/usr/bin/env python3
"""xsection1 — univers COMPLET spot USDT (délistées incluses) : liste tous les
symboles présents dans l'archive Vision, filtre les paires parasites (tokens
à levier, stables/fiat), puis télécharge le 1d 2019-01→now via le candleStore
(bun ensure_one.ts). Survivorship-safe par construction : Vision garde les
archives des délistées.
  python3 ensure_universe.py [--list-only]"""
import re
import subprocess
import sys
import urllib.request

BASE = ('https://s3-ap-northeast-1.amazonaws.com/data.binance.vision'
        '?delimiter=/&prefix=data/spot/monthly/klines/')
LEV = re.compile(r'(UP|DOWN|BULL|BEAR)USDT$')
STABLE = {'BUSDUSDT', 'USDCUSDT', 'TUSDUSDT', 'FDUSDUSDT', 'USDPUSDT', 'DAIUSDT',
          'EURUSDT', 'GBPUSDT', 'AUDUSDT', 'BRLUSDT', 'TRYUSDT', 'RUBUSDT',
          'UAHUSDT', 'NGNUSDT', 'ZARUSDT', 'IDRTUSDT', 'BIDRUSDT', 'PLNUSDT',
          'RONUSDT', 'ARSUSDT', 'JPYUSDT', 'MXNUSDT', 'CZKUSDT', 'COPUSDT',
          'SUSDUSDT', 'PAXUSDT', 'USDSUSDT', 'USDSBUSDT', 'AEURUSDT', 'XUSDUSDT',
          'USD1USDT', 'EURIUSDT', 'USTCUSDT', 'USTUSDT', 'WBTCUSDT', 'WBETHUSDT',
          'WETHUSDT', 'BTCSTUSDT'}


def list_symbols():
    syms, marker = [], ''
    while True:
        url = BASE + (f'&marker={marker}' if marker else '')
        xml = None
        for attempt in range(4):
            try:
                xml = urllib.request.urlopen(url, timeout=45).read().decode()
                break
            except Exception:
                if attempt == 3:
                    raise
        assert xml is not None
        prefixes = re.findall(r'<Prefix>data/spot/monthly/klines/([^/<]+)/</Prefix>', xml)
        syms += prefixes
        if '<IsTruncated>true</IsTruncated>' in xml and prefixes:
            marker = f'data/spot/monthly/klines/{prefixes[-1]}/'
        else:
            break
    usdt = [s for s in sorted(set(syms))
            if s.endswith('USDT') and not LEV.search(s) and s not in STABLE]
    return usdt


def main():
    syms = list_symbols()
    print(f'{len(syms)} paires USDT dans l archive Vision (délistées incluses)')
    if '--list-only' in sys.argv:
        for s in syms:
            print(s)
        return
    with open('/tmp/universe_usdt.txt', 'w') as f:
        f.write('\n'.join(syms))
    # téléchargement 1d par lots via le loader bun générique
    subprocess.run(['bun', 'apps/backend/src/research/xsection1/ensure_list.ts'],
                   cwd='/Users/charlespolart/Documents/Coding/trader-pro-xl-plus',
                   env={'DATABASE_URL': 'postgres://tpx:tpx@localhost:5438/tpx',
                        'PATH': '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin',
                        'HOME': '/Users/charlespolart',
                        'SYMBOLS_FILE': '/tmp/universe_usdt.txt'},
                   check=False)


if __name__ == '__main__':
    main()
