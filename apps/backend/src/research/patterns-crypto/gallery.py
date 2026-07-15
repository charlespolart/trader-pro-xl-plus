#!/usr/bin/env python3
"""patterns-crypto — galerie SVG d'audit visuel (BTC 4h, configs canoniques).
Chaque vignette = EXACTEMENT ce que le détecteur a utilisé : pivots confirmés,
lignes de construction, barre de signal, stop/objectif canoniques. Par famille :
jusqu'à 3 échantillons HAUT score et 3 BAS score (juger le score fait partie
de l'audit). Sortie : galerie.html (SVG pur, double thème)."""
import datetime
import html
import os

import numpy as np

from lib import IS_END, IS_START, load, seg_of, swings
from pass2 import detect_one

HERE = os.path.dirname(os.path.abspath(__file__))
W, H_ = 560, 300
PL, PR, PT, PB = 10, 58, 30, 30

FAMS = [
    ('TRI', 'sym', 'k3,g1', 'Triangle symétrique (gate tendance)',
     'oos-echec', 'Seule famille à franchir les critères 1-4 (BH 4h p=0,013 ; robuste ; DOSE-RÉPONSE ✓ p=0,023 — unique ; trades +148,6 bps/tr t=2,1 ; répliquée BH sur 1d +1 373 bps p=0,006) — puis ÉCHEC OOS : flip de signe (−25,5 bps vs +199,3 IS). La signature du bruit, tranchée par la passe unique.'),
    ('CUP', 'bull', 'k5,d0.06,g0', 'Cup & handle',
     'critere3', 'Médianes IS robustes (+347 à +473 bps, p_méd 0,004-0,038 — pas un artefact de crash) et trades ETH spectaculaires (+622 bps/tr, t=3,7) MAIS pas de dose-réponse (p=0,053, les deux terciles positifs) : l\'effet ne vient pas de la qualité chartiste. Mort au critère 3 ; OOS non consommé.'),
    ('ROUND', 'bottom', 'k5,r0.5,g0', 'Rounding bottom (soucoupe)',
     'critere3', 'Médianes IS +296/+362 (robuste), trades ETH +558 bps/tr — mais dose-réponse PLATE (T1 +234 / T3 +209) : la « qualité » n\'ajoute rien. Mort au critère 3.'),
    ('ROUND', 'top', 'k5,r0.7,g0', 'Rounding top',
     'fragile', 'Retenu aux robustes par la moyenne tronquée (p=0,020) mais médiane +52 seulement : porté par les queues grasses des bears (le COVID pèse ~165 bps de la moyenne à lui seul). Fragile, mort au critère 3.'),
    ('HS', 'bear', 'k5,tol0.03,prom0.005,g1', 'Tête-épaules (neckline inclinée, gate)',
     'refute', 'Best p=0,007 mais sous le seuil BH de sa grille (24 cfg) ; famille non retenue. Avec tendance exigée la figure reste rare (n=40 poolé).'),
    ('DT', 'bear', 'k5,tol0.015,d0.02,g1', 'Double sommet',
     'refute', '0 BH sur 24 configs (méd −12 bps). Vendre un double sommet ne paie pas non plus en crypto.'),
    ('TT', 'bear', 'k5,tol0.03,g0', 'Triple sommet',
     'critere4', 'BH ✓ et robuste (trim +125, p=0,008) mais trade canonique NÉGATIF sur BTC (−11 bps/tr) : mort au critère 4.'),
    ('WEDGE', 'rise', 'k5,g1', 'Wedge montant (multi-résolution)',
     'refute', '0 BH sur 12 configs, méd −47 bps ; dose-réponse plate. La leçon G4 (artefact de résolution) ne se reproduit pas : ici le wedge est mort à toutes les résolutions.'),
    ('FIB', 'bull', 'k5,lvl0.618', 'Fibonacci ANCRÉ 61,8 % (jambe pivot→pivot)',
     'refute', 'Correction de la construction glissante de families.ts (audit1/A6). Résultat : 0 BH ; le meilleur niveau de la grille est le PLACEBO 25 % (+87 bps, p=0,074) — aucune magie des ratios, comme côté actions.'),
    ('SR', 'sup_break', 'k5,t3', 'Cassure de support multi-touches',
     'fragile', 'BH ✓ (p=0,005), robuste par trim (+202, p=0,003) — la continuation baissière après cassure de support est la trace S/R la plus nette. Pas de plan de trade canonique (famille event-only) ; médiane +89. Non poursuivie au-delà du critère 3 (pas de dose-réponse famille).'),
    ('TL', 'up_bounce', 'k5,g1', 'Rebond de ligne de tendance haussière',
     'refute', 'Méd famille −10 bps, 0 BH ; ANTI-dose-réponse sur 4h (T3 −34 vs T1 +22). Le folklore inversé.'),
    ('OB', 'bull', 'm10', 'Order block (BOS strict)',
     'refute', 'n=1 772 poolé, +6 bps, p=0,08 : rien, même en définition SMC fidèle — confirme le verdict des campagnes précédentes.'),
    ('DIV', 'reg_bull', 'k5,reg', 'Divergence RSI régulière haussière',
     'refute', 'Méd famille −3 bps, 0 BH, pas de dose-réponse. Les divergences formalisées causalement ne prédisent rien ici.'),
]

CHIP = {
    'oos-echec': ('ÉCHEC OOS', 'chip-no'),
    'critere3': ('mort au critère 3', 'chip-mid'),
    'critere4': ('mort au critère 4', 'chip-mid'),
    'fragile': ('fragile (queues)', 'chip-mid'),
    'refute': ('réfuté', 'chip-no'),
}


def svg_event(px, fam, e):
    o, h, l, c = px['o'], px['h'], px['l'], px['c']
    t = px['t']
    n = len(c)
    an = e.get('anchors', {})
    idxs = []
    for v in an.values():
        if isinstance(v, tuple) and len(v) == 2 and isinstance(v[0], (int, np.integer)):
            idxs.append(int(v[0]))
        elif isinstance(v, list):
            for q in v:
                if isinstance(q, tuple) and len(q) == 2:
                    idxs.append(int(q[0]))
    sig = e['sig']
    lo = max(0, (min(idxs) if idxs else sig - 70) - 12)
    hi = min(n, sig + 25)
    xs = np.arange(lo, hi)
    ys = [float(np.nanmin(l[lo:hi])), float(np.nanmax(h[lo:hi]))]
    for key in ('stop', 'target'):
        if key in e:
            ys.append(e[key])
    if 'level' in an:
        ys.append(an['level'])
    if 'zone' in an:
        ys += list(an['zone'])
    y0, y1 = min(ys), max(ys)
    pad = (y1 - y0) * 0.07 + 1e-9
    y0, y1 = y0 - pad, y1 + pad

    def X(i):
        return PL + (i - lo) / max(hi - 1 - lo, 1) * (W - PL - PR)

    def Y(v):
        return PT + (y1 - v) / (y1 - y0) * (H_ - PT - PB)

    def dstr(i):
        return datetime.datetime.fromtimestamp(t[int(i)] / 1000, datetime.UTC).strftime('%Y-%m-%d')

    parts = [f'<svg viewBox="0 0 {W} {H_}" role="img" aria-label="{fam} BTC 4h, signal {dstr(sig)}">']
    band = ' '.join(f'{X(i):.1f},{Y(h[i]):.1f}' for i in xs) + ' ' + \
           ' '.join(f'{X(i):.1f},{Y(l[i]):.1f}' for i in xs[::-1])
    parts.append(f'<polygon points="{band}" fill="var(--ink)" opacity="0.07"/>')
    line = ' '.join(f'{X(i):.1f},{Y(c[i]):.1f}' for i in xs)
    parts.append(f'<polyline points="{line}" fill="none" stroke="var(--ink2)" stroke-width="1.6"/>')

    def hline(v, x_from, x_to, color, dash='', label=None):
        parts.append(f'<line x1="{X(x_from):.1f}" y1="{Y(v):.1f}" x2="{X(x_to):.1f}" y2="{Y(v):.1f}" '
                     f'stroke="{color}" stroke-width="2" {dash}/>')
        if label:
            parts.append(f'<text x="{X(x_to) + 4:.1f}" y="{Y(v) + 3:.1f}" class="lbl" fill="{color}">{label}</text>')

    def seg_(i1, v1, i2, v2, color, dash=''):
        parts.append(f'<line x1="{X(i1):.1f}" y1="{Y(v1):.1f}" x2="{X(i2):.1f}" y2="{Y(v2):.1f}" '
                     f'stroke="{color}" stroke-width="2" {dash}/>')

    def dot(i, v, color, title, r=4.5):
        parts.append(f'<circle cx="{X(i):.1f}" cy="{Y(v):.1f}" r="{r}" fill="{color}" '
                     f'stroke="var(--surface)" stroke-width="2"><title>{html.escape(title)} — {dstr(i)}</title></circle>')

    BLUE, ORANGE, RED, GREEN = 'var(--c-build)', 'var(--c-sig)', 'var(--c-stop)', 'var(--c-tgt)'

    def fit_line(pts, color):
        xsn = np.array([p[0] for p in pts], float)
        ysn = np.array([p[1] for p in pts], float)
        A = np.vstack([xsn, np.ones(len(xsn))]).T
        (m, b), *_ = np.linalg.lstsq(A, ysn, rcond=None)
        x2 = min(hi - 1, sig + 5)
        seg_(pts[0][0], m * pts[0][0] + b, x2, m * x2 + b, color)
        for p in pts:
            dot(p[0], p[1], BLUE, 'pivot')

    if fam in ('HS',):
        s1, n1, hd, n2, s2, bk = an['sh1'], an['n1'], an['head'], an['n2'], an['sh2'], an['brk']
        slope = (n2[1] - n1[1]) / (n2[0] - n1[0])
        seg_(n1[0], n1[1], bk[0], n1[1] + slope * (bk[0] - n1[0]), BLUE)
        for p, tt in ((s1, 'épaule G'), (hd, 'tête'), (s2, 'épaule D'), (n1, 'creux 1'), (n2, 'creux 2')):
            dot(p[0], p[1], BLUE, tt)
        dot(bk[0], bk[1], ORANGE, 'cassure neckline', 6)
    elif fam in ('DT', 'TT'):
        ks = ['p1', 'mid', 'p2'] if fam == 'DT' else ['e1', 'm1', 'e2', 'm2', 'e3']
        pts = [an[k] for k in ks]
        bk = an['brk']
        hline(bk[1], pts[0][0], bk[0], BLUE)
        for p in pts:
            dot(p[0], p[1], BLUE, 'pivot')
        dot(bk[0], bk[1], ORANGE, 'cassure', 6)
    elif fam in ('CUP', 'ROUND'):
        rA, rB = an['rimA'], an['rimB']
        ext = an.get('low', an.get('ext'))
        bk = an['brk']
        hline(max(rA[1], rB[1]) if e['dir'] > 0 else min(rA[1], rB[1]), rA[0], bk[0], BLUE, 'stroke-dasharray="2 3"')
        for p, tt in ((rA, 'rim gauche'), (rB, 'rim droit'), (ext, 'extrême de coupe')):
            dot(p[0], p[1], BLUE, tt)
        dot(bk[0], bk[1], ORANGE, 'cassure des rims', 6)
    elif fam in ('WEDGE', 'TRI'):
        fit_line(an['h'], BLUE)
        fit_line(an['l'], BLUE)
        bk = an['brk']
        if bk[1] is not None:
            dot(bk[0], bk[1], ORANGE, 'cassure', 6)
    elif fam == 'FIB':
        lo_, hi_, lvl = an['lo'], an['hi'], an['level']
        seg_(lo_[0], lo_[1], hi_[0], hi_[1], BLUE)
        dot(lo_[0], lo_[1], BLUE, 'pivot bas (ancre)')
        dot(hi_[0], hi_[1], BLUE, 'pivot haut (ancre)')
        hline(lvl, hi_[0], min(hi - 1, sig + 20), BLUE, 'stroke-dasharray="5 4"', 'niveau')
        dot(sig, lvl, ORANGE, 'entrée dans la zone', 6)
    elif fam == 'TL':
        a1, a2, bk = an['a1'], an['a2'], an['brk']
        slope = (a2[1] - a1[1]) / (a2[0] - a1[0])
        seg_(a1[0], a1[1], bk[0], a1[1] + slope * (bk[0] - a1[0]), BLUE)
        dot(a1[0], a1[1], BLUE, 'ancre 1')
        dot(a2[0], a2[1], BLUE, 'ancre 2')
        dot(bk[0], bk[1], ORANGE, 'toucher', 6)
    elif fam == 'SR':
        lvl = an['level']
        hline(lvl, lo, min(hi - 1, sig + 20), BLUE, '', 'niveau')
        dot(sig, lvl, ORANGE, 'cassure du support', 6)
    elif fam == 'OB':
        q, bos = int(an['q']), int(an['bos'])
        zb, zt = an['zone']
        parts.append(f'<rect x="{X(q):.1f}" y="{Y(zt):.1f}" width="{X(min(hi - 1, sig + 15)) - X(q):.1f}" '
                     f'height="{Y(zb) - Y(zt):.1f}" fill="var(--c-build)" opacity="0.16"/>')
        dot(q, (zb + zt) / 2, BLUE, 'bougie order block')
        dot(bos, c[bos], BLUE, 'BOS')
        dot(sig, zt, ORANGE, 'retour dans la zone', 6)
    elif fam == 'DIV':
        p1, p2 = an['p1'], an['p2']
        seg_(p1[0], p1[1], p2[0], p2[1], BLUE, 'stroke-dasharray="4 3"')
        dot(p1[0], p1[1], BLUE, f"pivot 1 (RSI {an['r1']:.0f})")
        dot(p2[0], p2[1], BLUE, f"pivot 2 (RSI {an['r2']:.0f})")
        dot(sig, c[sig], ORANGE, 'confirmation', 6)
    if 'stop' in e:
        x_end = min(hi - 1, sig + 20)
        hline(e['stop'], sig - 5, x_end, RED, 'stroke-dasharray="5 4"', 'stop')
        hline(e['target'], sig, x_end, GREEN, 'stroke-dasharray="5 4"', 'objectif')
    parts.append(f'<line x1="{X(sig):.1f}" y1="{PT}" x2="{X(sig):.1f}" y2="{H_ - PB}" '
                 f'stroke="var(--ink3)" stroke-width="1" stroke-dasharray="2 4"/>')
    for v in (y0 + pad, (y0 + y1) / 2, y1 - pad):
        parts.append(f'<text x="{W - PR + 6}" y="{Y(v) + 3:.1f}" class="ax">{v:,.0f}</text>')
    parts.append(f'<text x="{PL}" y="{H_ - 8}" class="ax">{dstr(lo)}</text>')
    parts.append(f'<text x="{W - PR}" y="{H_ - 8}" class="ax" text-anchor="end">{dstr(hi - 1)}</text>')
    parts.append('</svg>')
    cap = f"signal {dstr(sig)} · {'achat' if e['dir'] > 0 else 'vente'} · score {e['score']:.2f}"
    return ''.join(parts), cap


def main():
    px = load('BTCUSDT', '4h')
    spines = {k: swings(px, k) for k in (3, 5, 8)}
    seg = seg_of(px, IS_START, IS_END)
    secs = []
    for fam, kind, cfg, title, verdict, txt in FAMS:
        ev = [e for e in detect_one(px, {**spines}, fam, kind, cfg)
              if seg[0] <= e['sig'] < seg[1]]
        ev.sort(key=lambda e: -e['score'])
        picks = [('HAUT score', e) for e in ev[:3]] + [('BAS score', e) for e in ev[-3:] if e not in ev[:3]]
        cards = []
        for tag, e in picks:
            try:
                svg, cap = svg_event(px, fam, e)
            except Exception:
                continue
            cards.append(f'<figure class="card"><div class="tag">{tag}</div>{svg}'
                         f'<figcaption>{cap}</figcaption></figure>')
        chip_label, chip_cls = CHIP[verdict]
        secs.append(
            f'<section><div class="shead"><h2>{title}</h2>'
            f'<span class="chip {chip_cls}">{chip_label}</span>'
            f'<span class="meta">{fam} · {cfg} · n(IS BTC)={len(ev)}</span></div>'
            f'<p class="stxt">{txt}</p><div class="grid">{"".join(cards)}</div></section>')

    page = HEAD + ''.join(secs) + FOOT
    out = os.path.join(HERE, 'galerie.html')
    with open(out, 'w') as f:
        f.write(page)
    print(f'{out} écrit ({len(page) // 1024} Ko)')


HEAD = '''<title>patterns-crypto — audit visuel des figures (BTC 4h)</title>
<style>
:root{
  --surface:#f7f6f2; --ink:#14130f; --ink2:#4e4c45; --ink3:#8b887c;
  --c-build:#2f6fd0; --c-sig:#e06a2c; --c-stop:#d24444; --c-tgt:#1f8a4c;
  --card:#efede7; --chip-no:#f4dcdc; --chip-no-t:#8f1f1f;
  --chip-mid:#eae7dd; --chip-mid-t:#5a574c;
}
@media (prefers-color-scheme: dark){ :root:where(:not([data-theme="light"])){
  --surface:#17181c; --ink:#f0eee7; --ink2:#b9b6aa; --ink3:#807d72;
  --c-build:#5b93e8; --c-sig:#e5814b; --c-stop:#e26a6a; --c-tgt:#4aa671;
  --card:#20222a; --chip-no:#3a2424; --chip-no-t:#e8a3a3;
  --chip-mid:#2a2c30; --chip-mid-t:#b9b6aa;
}}
:root[data-theme="dark"]{
  --surface:#17181c; --ink:#f0eee7; --ink2:#b9b6aa; --ink3:#807d72;
  --c-build:#5b93e8; --c-sig:#e5814b; --c-stop:#e26a6a; --c-tgt:#4aa671;
  --card:#20222a; --chip-no:#3a2424; --chip-no-t:#e8a3a3;
  --chip-mid:#2a2c30; --chip-mid-t:#b9b6aa;
}
:root[data-theme="light"]{
  --surface:#f7f6f2; --ink:#14130f; --ink2:#4e4c45; --ink3:#8b887c;
  --c-build:#2f6fd0; --c-sig:#e06a2c; --c-stop:#d24444; --c-tgt:#1f8a4c;
  --card:#efede7; --chip-no:#f4dcdc; --chip-no-t:#8f1f1f;
  --chip-mid:#eae7dd; --chip-mid-t:#5a574c;
}
body{background:var(--surface); color:var(--ink);
  font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  margin:0; padding:32px 20px 80px;}
main{max-width:1120px; margin:0 auto;}
h1{font-size:1.7rem; letter-spacing:-0.015em; margin:0 0 4px; text-wrap:balance;}
h2{font-size:1.12rem; letter-spacing:-0.01em; margin:0;}
.sub{color:var(--ink2); max-width:72ch; margin:0 0 10px;}
.note{background:var(--card); border-radius:8px; padding:14px 18px;
  max-width:80ch; margin:18px 0 6px; color:var(--ink2); font-size:0.92rem;}
.note b{color:var(--ink);}
section{margin-top:42px;}
.shead{display:flex; align-items:baseline; gap:12px; flex-wrap:wrap;}
.meta{font:12px ui-monospace,Menlo,monospace; color:var(--ink3);}
.chip{font-size:0.7rem; letter-spacing:0.06em; text-transform:uppercase;
  padding:3px 10px; border-radius:99px; font-weight:650;}
.chip-no{background:var(--chip-no); color:var(--chip-no-t);}
.chip-mid{background:var(--chip-mid); color:var(--chip-mid-t);}
.stxt{color:var(--ink2); max-width:80ch; margin:6px 0 14px; font-size:0.93rem;}
.grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(330px,1fr)); gap:14px;}
.card{position:relative; margin:0; background:var(--card); border-radius:10px; padding:10px 10px 6px;}
.card svg{width:100%; height:auto; display:block;}
.tag{position:absolute; top:14px; left:14px; font:10px ui-monospace,Menlo,monospace;
  letter-spacing:0.08em; color:var(--ink3); text-transform:uppercase;}
figcaption{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;
  color:var(--ink3); padding:4px 4px 4px; font-variant-numeric:tabular-nums;}
.lbl{font:10px ui-monospace,Menlo,monospace;}
.ax{font:9.5px ui-monospace,Menlo,monospace; fill:var(--ink3);}
.leg{display:flex; gap:18px; flex-wrap:wrap; margin:14px 0 0; padding:0;
  list-style:none; font-size:0.82rem; color:var(--ink2);}
.leg li::before{content:"—"; font-weight:700; margin-right:6px;}
.leg .l1::before{color:var(--c-build);} .leg .l2::before{color:var(--c-sig);}
.leg .l3::before{color:var(--c-stop);} .leg .l4::before{color:var(--c-tgt);}
</style>
<main>
<h1>Audit visuel des figures chartistes — BTC 4h (campagne patterns-crypto)</h1>
<p class="sub">Chaque vignette montre <b>exactement</b> ce que le détecteur a
utilisé : pivots confirmés (causaux, connus à i+k seulement), lignes de
construction, barre de signal, stop/objectif canoniques. Par famille : les 3
meilleurs et les 3 pires scores de qualité — juger le placement ET le score
fait partie de l'audit.</p>
<ul class="leg">
<li class="l1">construction (pivots, necklines, niveaux, zones)</li>
<li class="l2">signal (cassure / toucher)</li>
<li class="l3">stop canonique</li>
<li class="l4">objectif canonique (mouvement mesuré)</li>
</ul>
<div class="note"><b>Garde-fous :</b> placebo 0,3 % (1/349 stats sur bruit pur) ;
edge planté détecté p=0,002 ; contrôle positif = signal VRX maison retrouvé
sous l'instrument poolé BTC+ETH (p=0,044). <b>Verdict de campagne (2 passes) :</b>
17 configs BH → 12 robustes → 1 famille avec dose-réponse (triangles) → trades ✓
→ réplication 1d ✓ → <b>ÉCHEC OOS (flip de signe)</b>. 0 survivant complet à ce
stade ; reste au protocole : 1h, flags/pennants desserrés, volet indicateurs.</div>
'''

FOOT = '''
<div class="note">Lecture d'ensemble provisoire : en crypto multi-TF comme sur
indices actions, les figures fidèlement construites ne franchissent pas
l'arsenal complet. Ce qui a frémi le plus fort (cup & handle, rounding bottom
— médianes IS robustes, trades ETH forts) n'a PAS de dose-réponse : l'effet ne
vient pas de la qualité chartiste du tracé, et l'unique famille dont le score
avait du contenu (triangles) a inversé son signe en OOS. Les chiffres complets
et le ledger : <code>apps/backend/src/research/patterns-crypto/LOG.md</code>.</div>
</main>
'''

if __name__ == '__main__':
    main()
