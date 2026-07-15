#!/usr/bin/env python3
"""patterns-crypto — captures d'écran PAR FAMILLE pour auto-audit visuel.
Génère shots/<FAM>.html (6 cartes, thème clair forcé, sous-scores affichés)
puis shots/<FAM>.png via Chrome headless. Je lis ensuite chaque PNG."""
import os
import subprocess

from gallery import CHIP, FAMS, HEAD, svg_event
from lib import IS_END, IS_START, load, seg_of, swings
from pass2 import detect_one

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, 'shots')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

CSS = HEAD.split('<style>')[1].split('</style>')[0].replace(
    ':root{', ':root{color-scheme:light;')


def main():
    os.makedirs(SHOTS, exist_ok=True)
    px = load('BTCUSDT', '4h')
    spines = {k: swings(px, k) for k in (3, 5, 8)}
    seg = seg_of(px, IS_START, IS_END)
    for fam, kind, cfg, title, verdict, txt in FAMS:
        ev = [e for e in detect_one(px, spines, fam, kind, cfg)
              if seg[0] <= e['sig'] < seg[1]]
        ev.sort(key=lambda e: -e['score'])
        picks = [('HAUT', e) for e in ev[:3]] + [('BAS', e) for e in ev[-3:] if e not in ev[:3]]
        cards = []
        for tag, e in picks:
            try:
                svg, cap = svg_event(px, fam, e)
            except Exception as ex:
                cards.append(f'<figure class="card"><figcaption>ERREUR rendu: {ex}</figcaption></figure>')
                continue
            qs = ' '.join(f'{k.replace("q_", "")}={v:.2f}' for k, v in e.get('q', {}).items() if v is not None)
            cards.append(f'<figure class="card"><div class="tag">{tag} score</div>{svg}'
                         f'<figcaption>{cap}<br>{qs}</figcaption></figure>')
        page = (f'<html><head><meta charset="utf-8"><style>{CSS}'
                f'.grid{{grid-template-columns:repeat(2,1fr);}}</style></head>'
                f'<body data-theme="light"><main>'
                f'<h2>{title} — {fam}/{kind} {cfg} (n IS BTC={len(ev)})</h2>'
                f'<div class="grid">{"".join(cards)}</div></main></body></html>')
        hpath = os.path.join(SHOTS, f'{fam}_{kind}.html')
        with open(hpath, 'w') as f:
            f.write(page)
        rows = (len(cards) + 1) // 2
        height = 120 + rows * 400
        png = os.path.join(SHOTS, f'{fam}_{kind}.png')
        subprocess.run([CHROME, '--headless=new', f'--screenshot={png}',
                        f'--window-size=1400,{height}', '--hide-scrollbars',
                        '--force-device-scale-factor=1.5', f'file://{hpath}'],
                       capture_output=True, timeout=60)
        print(f'{fam}_{kind}.png ({len(cards)} cartes)')


if __name__ == '__main__':
    main()
