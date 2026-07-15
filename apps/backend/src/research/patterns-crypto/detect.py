#!/usr/bin/env python3
"""patterns-crypto — détecteurs GÉOMÉTRIQUES fidèles (12 familles).
Causal : tout pivot n'est utilisable qu'à sa barre de confirmation (i+k) ; un
signal n'existe qu'à la barre de cassure/toucher. Chaque événement porte ses
SOUS-SCORES de qualité ∈[0,1] (poids ÉGAUX — figés au protocole) :
  q_trend (tendance préalable), q_sym (symétrie), q_touch (netteté),
  q_vol (volume décroissant dans la formation + pic à la cassure),
  q_geom (rondeur R²/profondeur/durée canoniques selon la famille).
score = moyenne des sous-scores présents. Port fidèle de patterns2/detect2.py
(actions) + familles nouvelles (rounding, wedges multi-k, flags/pennants,
triangles, divergences, triples)."""
import numpy as np

from lib import atr as atr_series
from lib import dedup, dedup_episodes, trend_amp, trend_ok


# ------------------------------------------------------------- sous-scores
def q_trend_score(c, i, direction, T=40):
    """ampleur de la tendance PRÉALABLE dans le bon sens (cap 15 % → 1)."""
    amp = trend_amp(c, i, T)
    good = amp if direction < 0 else -amp  # figure de retournement : tendance à retourner = −direction
    return float(np.clip(good / 0.15, 0, 1))


def q_cont_trend_score(c, i, direction, T=40):
    """continuation : tendance préalable DANS le sens de la figure."""
    amp = trend_amp(c, i, T)
    good = amp if direction > 0 else -amp
    return float(np.clip(good / 0.15, 0, 1))


def q_sym_score(rel_diff, tol):
    return float(np.clip(1 - rel_diff / max(tol, 1e-9), 0, 1))


def q_vol_score(v, a, b, sig):
    """pente du volume dans la formation [a,b] (décroissante = bien) +
    pic à la cassure sig vs moyenne de formation."""
    if b <= a + 2 or sig >= len(v):
        return 0.5
    seg = v[a:b + 1]
    x = np.arange(len(seg), dtype=float)
    vm = seg.mean()
    if vm <= 0:
        return 0.5
    slope = float(np.polyfit(x, seg / vm, 1)[0])          # pente normalisée / barre
    s_decl = float(np.clip(-slope * len(seg) / 0.5, 0, 1))  # −50 % sur la formation → 1
    burst = float(np.clip((v[sig] / vm - 1) / 1.0, 0, 1))   # ×2 à la cassure → 1
    return 0.5 * s_decl + 0.5 * burst


def q_range_score(x, lo, hi):
    """1 au centre de [lo,hi], 0,25 aux bornes (bornes canoniques)."""
    if hi <= lo:
        return 0.5
    z = (x - lo) / (hi - lo)
    return float(np.clip(1 - 1.5 * abs(z - 0.5), 0.25, 1))


def r2_quad(y):
    """R² d'un fit quadratique (rondeur), + signe de la courbure."""
    n = len(y)
    if n < 5:
        return 0.0, 0.0
    x = np.arange(n, dtype=float)
    coef = np.polyfit(x, y, 2)
    fit = np.polyval(coef, x)
    ss = float(((y - y.mean()) ** 2).sum())
    r2 = 1 - float(((y - fit) ** 2).sum()) / ss if ss > 0 else 0.0
    return max(0.0, r2), float(coef[0])


def mk(sig, direction, anchors, q, stop=None, target=None):
    e = dict(sig=int(sig), dir=int(direction), anchors=anchors, q=q)
    qs = [v for v in q.values() if v is not None]
    e['score'] = float(np.mean(qs)) if qs else 0.5
    if stop is not None:
        e['stop'] = float(stop)
        e['target'] = float(target)
    return e


# --------------------------------------------------------------- 1. H&S
def detect_hs(px, alt, k, tol, prom, gate, inverse=False):
    c, v = px['c'], px['v']
    n = len(c)
    tp = ('L', 'H', 'L', 'H', 'L') if inverse else ('H', 'L', 'H', 'L', 'H')
    ev = []
    for j in range(len(alt) - 4):
        w5 = alt[j:j + 5]
        if tuple(p[1] for p in w5) != tp:
            continue
        (i1, _, s1, _), (i2, _, n1, _), (i3, _, hd, _), (i4, _, n2, _), (i5, _, s2, cf5) = w5
        if not inverse:
            if not (hd > s1 * (1 + prom) and hd > s2 * (1 + prom)):
                continue
            direction = -1
        else:
            if not (hd < s1 * (1 - prom) and hd < s2 * (1 - prom)):
                continue
            direction = +1
        rel = abs(s1 - s2) / ((s1 + s2) / 2)
        if rel > tol:
            continue
        if not (10 <= i5 - i1 <= 130):
            continue
        if gate and not trend_ok(c, i1, -direction):
            continue
        slope = (n2 - n1) / (i4 - i2)      # neckline INCLINÉE par les 2 creux
        head_amp = abs(hd - (n1 + slope * (i3 - i2)))
        # v2 (audit visuel 2026-07-15) : une neckline plus pentue que la moitié
        # de la hauteur de tête sur la largeur n'est pas une neckline (cartes
        # 2023-11/2023-06 : aucun chartiste ne trace un H&S là) ; et des
        # épaules à >3× d'écart temporel de la tête ne sont pas des épaules.
        if abs(slope) * (i5 - i1) > 0.5 * head_amp:
            continue
        dl, dr = i3 - i1, i5 - i3
        if max(dl, dr) > 3 * max(min(dl, dr), 1):
            continue
        for b in range(cf5, min(n, cf5 + 40)):
            neck_b = n1 + slope * (b - i2)
            if (direction < 0 and c[b] < neck_b) or (direction > 0 and c[b] > neck_b):
                q = dict(q_trend=q_trend_score(c, i1, direction),
                         q_sym=q_sym_score(rel, tol),
                         q_vol=q_vol_score(v, i1, i5, b),
                         q_geom=q_range_score(i5 - i1, 10, 130))
                ev.append(mk(b, direction, dict(sh1=(i1, s1), n1=(i2, n1), head=(i3, hd),
                                                n2=(i4, n2), sh2=(i5, s2), brk=(b, neck_b)),
                             q, stop=s2, target=neck_b + direction * head_amp))
                break
    return dedup(ev)


# ------------------------------------------------- 2. doubles & triples
def detect_double(px, alt, k, tol, depth, gate, bottom=False):
    c, v = px['c'], px['v']
    n = len(c)
    tp = ('L', 'H', 'L') if bottom else ('H', 'L', 'H')
    ev = []
    for j in range(len(alt) - 2):
        w3 = alt[j:j + 3]
        if tuple(p[1] for p in w3) != tp:
            continue
        (ia, _, pa, _), (ib, _, pb, _), (ic_, _, pc_, cf3) = w3
        rel = abs(pa - pc_) / ((pa + pc_) / 2)
        if rel > tol:
            continue
        if not (6 <= ic_ - ia <= 120):
            continue
        if not bottom:
            if (min(pa, pc_) - pb) / min(pa, pc_) < depth:
                continue
            direction, level, stop, height = -1, pb, max(pa, pc_), min(pa, pc_) - pb
        else:
            if (pb - max(pa, pc_)) / pb < depth:
                continue
            direction, level, stop, height = +1, pb, min(pa, pc_), pb - max(pa, pc_)
        if gate and not trend_ok(c, ia, -direction):
            continue
        for b in range(cf3, min(n, cf3 + 40)):
            if (direction < 0 and c[b] < level) or (direction > 0 and c[b] > level):
                q = dict(q_trend=q_trend_score(c, ia, direction),
                         q_sym=q_sym_score(rel, tol),
                         q_vol=q_vol_score(v, ia, ic_, b),
                         q_geom=q_range_score(ic_ - ia, 6, 120))
                ev.append(mk(b, direction, dict(p1=(ia, pa), mid=(ib, pb), p2=(ic_, pc_),
                                                brk=(b, level)),
                             q, stop=stop, target=level + direction * height))
                break
    return dedup(ev)


def detect_triple(px, alt, k, tol, gate, bottom=False):
    """triple sommet/creux : 5 pivots H-L-H-L-H (resp. miroir), 3 extrêmes
    égaux ≤ tol, cassure de l'extrême des 2 pivots intermédiaires."""
    c, v = px['c'], px['v']
    n = len(c)
    tp = ('L', 'H', 'L', 'H', 'L') if bottom else ('H', 'L', 'H', 'L', 'H')
    ev = []
    for j in range(len(alt) - 4):
        w5 = alt[j:j + 5]
        if tuple(p[1] for p in w5) != tp:
            continue
        (i1, _, e1, _), (i2, _, m1, _), (i3, _, e2, _), (i4, _, m2, _), (i5, _, e3, cf5) = w5
        tops = [e1, e2, e3]
        rel = (max(tops) - min(tops)) / np.mean(tops)
        if rel > tol:
            continue
        if not (10 <= i5 - i1 <= 150):
            continue
        if not bottom:
            direction, level, stop = -1, min(m1, m2), max(tops)
            height = min(tops) - level
        else:
            direction, level, stop = +1, max(m1, m2), min(tops)
            height = level - max(tops)
            height = abs(height)
        if gate and not trend_ok(c, i1, -direction):
            continue
        for b in range(cf5, min(n, cf5 + 40)):
            if (direction < 0 and c[b] < level) or (direction > 0 and c[b] > level):
                q = dict(q_trend=q_trend_score(c, i1, direction),
                         q_sym=q_sym_score(rel, tol),
                         q_vol=q_vol_score(v, i1, i5, b),
                         q_geom=q_range_score(i5 - i1, 10, 150))
                ev.append(mk(b, direction, dict(e1=(i1, e1), m1=(i2, m1), e2=(i3, e2),
                                                m2=(i4, m2), e3=(i5, e3), brk=(b, level)),
                             q, stop=stop, target=level + direction * abs(height)))
                break
    return dedup(ev)


# ----------------------------------------------------- 3. cup & handle
def detect_cup(px, alt, k, dmin, gate, tol=0.03, inverse=False):
    h, l, c, v = px['h'], px['l'], px['c'], px['v']
    n = len(c)
    kind = 'L' if inverse else 'H'
    rims = [p for p in alt if p[1] == kind]
    ev = []
    for a in range(len(rims) - 1):
        iA, _, rA, _ = rims[a]
        for b_ in range(a + 1, len(rims)):
            iB, _, rB, cfB = rims[b_]
            span = iB - iA
            if span < 30:
                continue
            if span > 300:
                break
            if abs(rA - rB) / max(rA, rB) > tol:
                continue
            if not inverse:
                seg = l[iA:iB + 1]
                im = iA + int(np.argmin(seg))
                ext = l[im]
                rim = min(rA, rB)
                depth = (rim - ext) / rim
                if np.nanmax(c[iA + 1:iB]) > max(rA, rB):
                    continue
                direction = +1
            else:
                seg = h[iA:iB + 1]
                im = iA + int(np.argmax(seg))
                ext = h[im]
                rim = max(rA, rB)
                depth = (ext - rim) / rim
                if np.nanmin(c[iA + 1:iB]) < min(rA, rB):
                    continue
                direction = -1
            if not (dmin <= depth <= 0.50):
                continue
            if not (0.25 <= (im - iA) / span <= 0.75):
                continue
            if gate and not trend_ok(c, iA, direction, T=60, g=0.05):
                continue
            r2, curv = r2_quad(seg)
            if (not inverse and curv <= 0) or (inverse and curv >= 0):
                continue
            hl = rB
            sig = None
            for t in range(cfB, min(n, cfB + 60)):
                if not inverse:
                    hl = min(hl, l[t])
                    if (rB - hl) / rB > min(depth / 3, 0.12):
                        break
                    if hl < ext + 0.5 * (rim - ext):
                        break
                    if c[t] > max(rA, rB) and t >= cfB + 3:
                        sig = t
                        break
                else:
                    hl = max(hl, h[t])
                    if (hl - rB) / rB > min(depth / 3, 0.12):
                        break
                    if hl > ext - 0.5 * (ext - rim):
                        break
                    if c[t] < min(rA, rB) and t >= cfB + 3:
                        sig = t
                        break
            if sig is None:
                continue
            q = dict(q_trend=q_cont_trend_score(c, iA, direction, T=60),
                     q_sym=q_sym_score(abs(rA - rB) / max(rA, rB), tol),
                     q_vol=q_vol_score(v, iA, iB, sig),
                     q_geom=0.5 * r2 + 0.5 * q_range_score(depth, dmin, 0.5))
            tgt = (max(rA, rB) + (rim - ext)) if not inverse else (min(rA, rB) - (ext - rim))
            ev.append(mk(sig, direction, dict(rimA=(iA, rA), rimB=(iB, rB), low=(im, ext),
                                              brk=(sig, max(rA, rB) if not inverse else min(rA, rB)),
                                              handle=hl),
                         q, stop=hl, target=tgt))
    return dedup_episodes(dedup(ev), 'rimA')


# ------------------------------------------------ 4. rounding top/bottom
def detect_rounding(px, alt, k, r2min, gate, tol=0.04, top=False):
    """soucoupe : 2 rims ≈ égaux, fond/faîte arrondi (R² quadratique ≥ r2min),
    SANS exigence d'anse ; cassure du rim opposé au sens de l'arrondi."""
    h, l, c, v = px['h'], px['l'], px['c'], px['v']
    n = len(c)
    kind = 'H' if top else 'L'
    # rims du CÔTÉ de la cassure : pour un bottom, rims = pivots hauts qui
    # bordent le creux ; pour un top, pivots bas.
    rims = [p for p in alt if p[1] == ('L' if top else 'H')]
    ev = []
    for a in range(len(rims) - 1):
        iA, _, rA, _ = rims[a]
        for b_ in range(a + 1, len(rims)):
            iB, _, rB, cfB = rims[b_]
            span = iB - iA
            if span < 40:
                continue
            if span > 300:
                break
            if abs(rA - rB) / max(rA, rB) > tol:
                continue
            if not top:
                seg = l[iA:iB + 1]
                im = iA + int(np.argmin(seg))
                ext = l[im]
                rim = min(rA, rB)
                depth = (rim - ext) / rim
                direction = +1
                if np.nanmax(c[iA + 1:iB]) > max(rA, rB):
                    continue
            else:
                seg = h[iA:iB + 1]
                im = iA + int(np.argmax(seg))
                ext = h[im]
                rim = max(rA, rB)
                depth = (ext - rim) / rim
                direction = -1
                if np.nanmin(c[iA + 1:iB]) < min(rA, rB):
                    continue
            if not (0.05 <= depth <= 0.60):
                continue
            if not (0.3 <= (im - iA) / span <= 0.7):
                continue
            r2, curv = r2_quad(seg)
            if r2 < r2min:
                continue
            if (not top and curv <= 0) or (top and curv >= 0):
                continue
            if gate and not trend_ok(c, iA, -direction, T=60, g=0.05):
                continue
            sig = None
            lvl = max(rA, rB) if not top else min(rA, rB)
            for t in range(cfB, min(n, cfB + 60)):
                if (not top and c[t] > lvl) or (top and c[t] < lvl):
                    sig = t
                    break
            if sig is None:
                continue
            q = dict(q_trend=q_trend_score(c, iA, direction, T=60),
                     q_sym=q_sym_score(abs(rA - rB) / max(rA, rB), tol),
                     q_vol=q_vol_score(v, iA, iB, sig),
                     q_geom=r2)
            ev.append(mk(sig, direction, dict(rimA=(iA, rA), rimB=(iB, rB), ext=(im, ext),
                                              brk=(sig, lvl)),
                         q, stop=ext, target=lvl + direction * (rim - ext if not top else ext - rim)))
    return dedup_episodes(dedup(ev), 'rimA')


# ---------------------------------------------------------- 5. wedges
def _ols_line(pts):
    xs = np.array([p[0] for p in pts], dtype=float)
    ys = np.array([p[1] for p in pts], dtype=float)
    A = np.vstack([xs, np.ones(len(xs))]).T
    (m, b), res, *_ = np.linalg.lstsq(A, ys, rcond=None)
    resid = float(np.sqrt(((ys - (m * xs + b)) ** 2).mean()))
    return float(m), float(b), resid


def detect_wedge(px, alt, k, gate, rising=True):
    """wedge : 3 derniers pivots H et 3 derniers L avant un point d'ancrage ;
    les DEUX droites de même signe de pente, convergentes ; cassure
    contre-pente. rising → cassure basse (dir −1) ; falling → haute (+1)."""
    c, v = px['c'], px['v']
    A = atr_series(px, 20)
    n = len(c)
    ev = []
    his = [p for p in alt if p[1] == 'H']
    los = [p for p in alt if p[1] == 'L']
    for hi3 in range(2, len(his)):
        H3 = his[hi3 - 2:hi3 + 1]
        iH_last, _, _, cfH = H3[-1]
        L3 = [p for p in los if p[0] < iH_last]
        if len(L3) < 3:
            continue
        L3 = L3[-3:]
        span = max(iH_last, L3[-1][0]) - min(H3[0][0], L3[0][0])
        if not (15 <= span <= 200):
            continue
        mh, bh, rh = _ols_line([(p[0], p[2]) for p in H3])
        ml, bl, rl = _ols_line([(p[0], p[2]) for p in L3])
        if rising:
            if not (mh > 0 and ml > 0 and ml > mh):   # converge par le bas plus raide
                continue
            direction = -1
        else:
            if not (mh < 0 and ml < 0 and mh < ml):   # converge par le haut plus raide
                continue
            direction = +1
        # intersection devant, pas trop loin (convergence réelle)
        denom = ml - mh
        x_apex = (bh - bl) / denom if abs(denom) > 1e-12 else np.inf
        last = max(iH_last, L3[-1][0])
        if not (last < x_apex < last + 3 * span):
            continue
        conf = max(cfH, L3[-1][3])
        if gate and not trend_ok(c, min(H3[0][0], L3[0][0]), -direction):
            continue
        # v2 (audit visuel) : la cassure doit arriver AVANT l'apex — au-delà,
        # les droites sont croisées et « casser la ligne » n'a plus de sens
        b_max = min(n, conf + 40, int(x_apex))
        for b in range(conf, b_max):
            if not np.isfinite(A[b]):
                continue
            line = (ml * b + bl) if rising else (mh * b + bh)
            eps = 0.3 * A[b]
            if (rising and c[b] < line - eps) or ((not rising) and c[b] > line + eps):
                atr_b = A[b] if np.isfinite(A[b]) else 1.0
                q = dict(q_trend=q_trend_score(c, min(H3[0][0], L3[0][0]), direction),
                         q_touch=float(np.clip(1 - (rh + rl) / (2 * 0.5 * atr_b), 0, 1)),
                         q_vol=q_vol_score(v, min(H3[0][0], L3[0][0]), last, b),
                         q_geom=q_range_score(span, 15, 200))
                height = abs((mh * H3[0][0] + bh) - (ml * H3[0][0] + bl))
                stop = (mh * b + bh) if rising else (ml * b + bl)
                ev.append(mk(b, direction, dict(h=[(p[0], p[2]) for p in H3],
                                                l=[(p[0], p[2]) for p in L3],
                                                brk=(b, line)),
                             q, stop=stop, target=line + direction * height))
                break
    return dedup(ev)


# ---------------------------------------------- 6. flags & pennants
def detect_flag(px, alt, k, mast_atr, gate, bull=True, pennant=False):
    """mât = jambe pivot→pivot ≥ mast_atr×ATR20 en ≤15 barres ; consolidation
    3-15 barres retenue dans la moitié haute (resp. basse) du mât ; flag =
    canal contre-pente, pennant = contraction ; cassure de l'extrême du mât."""
    h, l, c, v = px['h'], px['l'], px['c'], px['v']
    A = atr_series(px, 20)
    n = len(c)
    ev = []
    for j in range(len(alt) - 1):
        p0, p1 = alt[j], alt[j + 1]
        if bull and not (p0[1] == 'L' and p1[1] == 'H'):
            continue
        if not bull and not (p0[1] == 'H' and p1[1] == 'L'):
            continue
        i0, _, v0, _ = p0
        i1, _, v1, cf1 = p1
        bars = i1 - i0
        if not (2 <= bars <= 15):
            continue
        if not np.isfinite(A[i1]) or A[i1] <= 0:
            continue
        amp = abs(v1 - v0)
        if amp < mast_atr * A[i1]:
            continue
        mid = v0 + (v1 - v0) * 0.5
        # consolidation : fenêtre après confirmation du sommet de mât
        for dur in range(3, 16):
            e = cf1 + dur
            if e >= n:
                break
            win_l = l[cf1:e + 1]
            win_h = h[cf1:e + 1]
            if bull:
                if win_l.min() < mid:                      # sort de la moitié haute
                    break
                if win_h.max() > v1 * 1.002:               # cassure déjà faite ? (attendre le close)
                    pass
                contracting = (win_h - win_l)[-3:].mean() < (win_h - win_l)[:3].mean() * 0.7
                slope = np.polyfit(np.arange(len(win_l)), (win_h + win_l) / 2, 1)[0]
                shape_ok = contracting if pennant else slope < 0
                if not shape_ok:
                    continue
                if c[e] > v1:                              # cassure au close
                    q = dict(q_trend=q_cont_trend_score(c, i0, +1, T=20),
                             q_sym=float(np.clip(amp / (mast_atr * 2 * A[i1]), 0, 1)),
                             q_vol=q_vol_score(v, cf1, e - 1, e),
                             q_geom=float(np.clip((win_l.min() - mid) / (v1 - mid + 1e-12), 0, 1)))
                    ev.append(mk(e, +1, dict(m0=(i0, v0), m1=(i1, v1), cons=(cf1, e),
                                             brk=(e, v1)),
                                 q, stop=float(win_l.min()), target=v1 + amp))
                    break
            else:
                if win_h.max() > mid:
                    break
                contracting = (win_h - win_l)[-3:].mean() < (win_h - win_l)[:3].mean() * 0.7
                slope = np.polyfit(np.arange(len(win_l)), (win_h + win_l) / 2, 1)[0]
                shape_ok = contracting if pennant else slope > 0
                if not shape_ok:
                    continue
                if c[e] < v1:
                    q = dict(q_trend=q_cont_trend_score(c, i0, -1, T=20),
                             q_sym=float(np.clip(amp / (mast_atr * 2 * A[i1]), 0, 1)),
                             q_vol=q_vol_score(v, cf1, e - 1, e),
                             q_geom=float(np.clip((mid - win_h.max()) / (mid - v1 + 1e-12), 0, 1)))
                    ev.append(mk(e, -1, dict(m0=(i0, v0), m1=(i1, v1), cons=(cf1, e),
                                             brk=(e, v1)),
                                 q, stop=float(win_h.max()), target=v1 - amp))
                    break
    return dedup(ev)


# --------------------------------------------------------- 7. triangles
def detect_triangle(px, alt, k, gate, kind='asc'):
    """asc : ≥3 pivots H égaux (résistance plate) + lows croissants (≥2) →
    cassure haussière du plat. desc : miroir. sym : highs décroissants + lows
    croissants (≥2+2, ≥3 touches d'un côté), cassure dans le sens de la
    tendance préalable si gate, sinon du côté effectivement cassé."""
    c, v = px['c'], px['v']
    A = atr_series(px, 20)
    n = len(c)
    ev = []
    his = [p for p in alt if p[1] == 'H']
    los = [p for p in alt if p[1] == 'L']
    tol_flat = 0.01
    for e_i in range(2, len(his)):
        H3 = his[e_i - 2:e_i + 1]
        iH, _, _, cfH = H3[-1]
        L_in = [p for p in los if H3[0][0] < p[0] < iH + 20]
        if len(L_in) < 2:
            continue
        L2 = L_in[-2:] if len(L_in) >= 2 else L_in
        span = iH - H3[0][0]
        if not (15 <= span <= 200):
            continue
        hv = [p[2] for p in H3]
        rel_flat = (max(hv) - min(hv)) / np.mean(hv)
        Lpts = L_in[-3:] if len(L_in) >= 3 else L2   # v2 : mêmes points pour la DÉCISION et les ANCRES
        ml, bl, rl = _ols_line([(p[0], p[2]) for p in Lpts])
        mh, bh, rh = _ols_line([(p[0], p[2]) for p in H3])
        conf = max(cfH, L2[-1][3])
        # v2 (audit visuel) : apex devant, et cassure AVANT l'apex uniquement
        denom_a = ml - mh
        x_apex = (bh - bl) / denom_a if abs(denom_a) > 1e-12 else np.inf
        if kind == 'asc':
            if rel_flat > tol_flat or ml <= 0:
                continue
            direction, level = +1, float(np.mean(hv))
            stop = L2[-1][2]
        elif kind == 'desc':
            lv = [p[2] for p in L_in[-3:]] if len(L_in) >= 3 else [p[2] for p in L2]
            rel_flat_l = (max(lv) - min(lv)) / np.mean(lv)
            if rel_flat_l > tol_flat or mh >= 0:
                continue
            direction, level = -1, float(np.mean(lv))
            stop = H3[-1][2]
        else:  # sym
            if not (mh < 0 and ml > 0):
                continue
            direction = 0  # déterminé à la cassure
            level = None
            stop = None
        if gate and kind != 'sym' and not trend_ok(c, H3[0][0], direction):
            continue
        base = abs((mh * H3[0][0] + bh) - (ml * H3[0][0] + bl)) if kind == 'sym' else \
            abs(level - (stop if stop is not None else level))
        b_max = min(n, conf + 40, int(x_apex) if np.isfinite(x_apex) else n)
        if b_max <= conf:
            continue
        for b in range(conf, b_max):
            if kind == 'sym':
                up_line = mh * b + bh
                dn_line = ml * b + bl
                if c[b] > up_line + 0.3 * (A[b] if np.isfinite(A[b]) else 0):
                    direction, level, stop = +1, up_line, dn_line
                elif c[b] < dn_line - 0.3 * (A[b] if np.isfinite(A[b]) else 0):
                    direction, level, stop = -1, dn_line, up_line
                else:
                    continue
                if gate and not trend_ok(c, H3[0][0], direction):
                    break
            else:
                if not ((direction > 0 and c[b] > level) or (direction < 0 and c[b] < level)):
                    continue
            atr_b = A[b] if np.isfinite(A[b]) and A[b] > 0 else 1.0
            q = dict(q_trend=q_cont_trend_score(c, H3[0][0], direction),
                     q_touch=float(np.clip(1 - (rh + rl) / (2 * 0.5 * atr_b), 0, 1)),
                     q_vol=q_vol_score(v, H3[0][0], iH, b),
                     q_geom=q_range_score(span, 15, 200))
            ev.append(mk(b, direction, dict(h=[(p[0], p[2]) for p in H3],
                                            l=[(p[0], p[2]) for p in Lpts],
                                            brk=(b, level)),
                         q, stop=stop, target=level + direction * base))
            break
    return dedup(ev)


# ------------------------------------------------- 8. lignes de tendance
def tl_events(px, alt, k, gate):
    h, l, c = px['h'], px['l'], px['c']
    A = atr_series(px, 20)
    n = len(c)
    out = {'up_bounce': [], 'up_break': [], 'dn_bounce': [], 'dn_break': []}
    for side in ('up', 'dn'):
        anchors = [p for p in alt if p[1] == ('L' if side == 'up' else 'H')]
        for j in range(len(anchors) - 1):
            i1, _, p1, _ = anchors[j]
            i2, _, p2, cf2 = anchors[j + 1]
            if side == 'up' and p2 <= p1:
                continue
            if side == 'dn' and p2 >= p1:
                continue
            if gate and not trend_ok(c, i2, +1 if side == 'up' else -1, g=0.0):
                continue
            slope = (p2 - p1) / (i2 - i1)
            lastev = -9
            for b in range(cf2, min(n, cf2 + 150)):
                if not np.isfinite(A[b]):
                    continue
                line = p1 + slope * (b - i1)
                eps = 0.3 * A[b]
                q = dict(q_trend=None, q_touch=None)  # rempli au fil
                if side == 'up':
                    if c[b] < line - eps:
                        out['up_break'].append(mk(b, -1, dict(a1=(i1, p1), a2=(i2, p2), brk=(b, line)),
                                                  dict(q_trend=q_cont_trend_score(c, b, +1))))
                        break
                    if l[b] <= line + eps and c[b] > line and b >= lastev + 5:
                        out['up_bounce'].append(mk(b, +1, dict(a1=(i1, p1), a2=(i2, p2), brk=(b, line)),
                                                   dict(q_trend=q_cont_trend_score(c, b, +1),
                                                        q_touch=float(np.clip(1 - abs(l[b] - line) / eps, 0, 1)))))
                        lastev = b
                else:
                    if c[b] > line + eps:
                        out['dn_break'].append(mk(b, +1, dict(a1=(i1, p1), a2=(i2, p2), brk=(b, line)),
                                                  dict(q_trend=q_cont_trend_score(c, b, -1))))
                        break
                    if h[b] >= line - eps and c[b] < line and b >= lastev + 5:
                        out['dn_bounce'].append(mk(b, -1, dict(a1=(i1, p1), a2=(i2, p2), brk=(b, line)),
                                                   dict(q_trend=q_cont_trend_score(c, b, -1),
                                                        q_touch=float(np.clip(1 - abs(h[b] - line) / eps, 0, 1)))))
                        lastev = b
    return {kk: dedup(vv) for kk, vv in out.items()}


# ------------------------------------------------------- 9. S/R niveaux
def sr_events(px, alt, k, min_touch):
    h, l, c, v = px['h'], px['l'], px['c'], px['v']
    A = atr_series(px, 20)
    n = len(c)
    byconf = {}
    for i, tp, pr, cf in alt:
        byconf.setdefault(cf, []).append(pr)
    levels = []
    out = {'sup_bounce': [], 'res_bounce': [], 'sup_break': [], 'res_break': []}
    for b in range(1, n):
        for pr in byconf.get(b, []):
            tolm = 0.5 * A[b] if np.isfinite(A[b]) else pr * 0.005
            for L in levels:
                if abs(pr - L['px']) <= tolm:
                    L['px'] = (L['px'] * L['t'] + pr) / (L['t'] + 1)
                    L['t'] += 1
                    L['last'] = b
                    break
            else:
                levels.append(dict(px=pr, t=1, last=b, ref=-9))
        if b % 25 == 0:
            levels = [L for L in levels if b - L['last'] <= 260]
        if not np.isfinite(A[b]):
            continue
        eps, brk = 0.3 * A[b], 0.5 * A[b]
        pc = c[b - 1]
        for L in levels:
            if L['t'] < min_touch or b - L['last'] > 250 or b <= L['ref'] + 5:
                continue
            lv = L['px']
            qt = float(np.clip((L['t'] - min_touch) / 3, 0, 1))
            if pc > lv and c[b] < lv - brk:
                out['sup_break'].append(mk(b, -1, dict(level=lv), dict(q_touch=qt,
                                          q_vol=q_vol_score(v, max(0, b - 20), b - 1, b))))
                L['last'] = -9999
            elif pc < lv and c[b] > lv + brk:
                out['res_break'].append(mk(b, +1, dict(level=lv), dict(q_touch=qt,
                                          q_vol=q_vol_score(v, max(0, b - 20), b - 1, b))))
                L['last'] = -9999
            elif pc > lv and l[b] <= lv + eps and c[b] > lv:
                out['sup_bounce'].append(mk(b, +1, dict(level=lv), dict(q_touch=qt)))
                L['t'] += 1
                L['last'] = b
                L['ref'] = b
            elif pc < lv and h[b] >= lv - eps and c[b] < lv:
                out['res_bounce'].append(mk(b, -1, dict(level=lv), dict(q_touch=qt)))
                L['t'] += 1
                L['last'] = b
                L['ref'] = b
    return {kk: dedup(vv) for kk, vv in out.items()}


# ----------------------------------------------------- 10. order blocks
def ob_events(px, alt, k, m):
    o, h, l, c = px['o'], px['h'], px['l'], px['c']
    n = len(c)
    lastH = np.full(n, np.nan)
    lastL = np.full(n, np.nan)
    hv = lv_ = np.nan
    conf = sorted([(cf, tp, pr) for i, tp, pr, cf in alt])
    ci = 0
    for b in range(n):
        while ci < len(conf) and conf[ci][0] <= b:
            if conf[ci][1] == 'H':
                hv = conf[ci][2]
            else:
                lv_ = conf[ci][2]
            ci += 1
        lastH[b] = hv
        lastL[b] = lv_
    out = {'bull': [], 'bear': []}
    bos_map = {}
    for q in range(1, n - 1):
        if c[q] < o[q] and np.isfinite(lastH[q]):
            for j in range(q + 1, min(n, q + 1 + m)):
                if c[j] > lastH[q]:
                    bos_map[('bull', j)] = max(q, bos_map.get(('bull', j), -1))
                    break
        if c[q] > o[q] and np.isfinite(lastL[q]):
            for j in range(q + 1, min(n, q + 1 + m)):
                if c[j] < lastL[q]:
                    bos_map[('bear', j)] = max(q, bos_map.get(('bear', j), -1))
                    break
    for (side, j), q in bos_map.items():
        zt, zb = h[q], l[q]
        for i in range(j + 1, min(n, j + 81)):
            if side == 'bull' and l[i] <= zt and c[i] >= zb:
                out['bull'].append(mk(i, +1, dict(q=q, bos=j, zone=(zb, zt)),
                                      dict(q_trend=q_cont_trend_score(c, j, +1))))
                break
            if side == 'bear' and h[i] >= zb and c[i] <= zt:
                out['bear'].append(mk(i, -1, dict(q=q, bos=j, zone=(zb, zt)),
                                      dict(q_trend=q_cont_trend_score(c, j, -1))))
                break
    return {kk: dedup(vv) for kk, vv in out.items()}


# ------------------------------------------------------ 11. fib ancré
def detect_fib(px, alt, k, lvl):
    c = px['c']
    n = len(c)
    ev = []
    for j in range(len(alt) - 1):
        if alt[j][1] != 'L' or alt[j + 1][1] != 'H':
            continue
        iL, _, L, _ = alt[j]
        iH, _, H, cfH = alt[j + 1]
        if (H - L) / L < 0.05:
            continue
        leg = H - L
        level = H - lvl * leg
        for b in range(cfH, min(n, cfH + 120)):
            if c[b] > H * 1.002 or c[b] < L:
                break
            if abs(c[b] - level) <= 0.08 * leg:
                ev.append(mk(b, +1, dict(lo=(iL, L), hi=(iH, H), level=level, brk=(b, level)),
                             dict(q_trend=q_cont_trend_score(c, iH, +1, T=20),
                                  q_geom=float(np.clip((H - L) / L / 0.15, 0, 1)))))
                break
    return dedup(ev)


# --------------------------------------------------- 12. divergences RSI
def rsi14(c):
    d = np.diff(c)
    up = np.maximum(d, 0)
    dn = np.maximum(-d, 0)
    out = np.full(len(c), np.nan)
    au = ad = None
    for i in range(len(d)):
        if au is None:
            if i == 13:
                au, ad = up[:14].mean(), dn[:14].mean()
                out[i + 1] = 100 - 100 / (1 + au / ad) if ad > 0 else 100.0
            continue
        au = (au * 13 + up[i]) / 14
        ad = (ad * 13 + dn[i]) / 14
        out[i + 1] = 100 - 100 / (1 + au / ad) if ad > 0 else 100.0
    return out


def detect_div(px, alt, k, hidden=False, bull=True):
    """divergence régulière bull : 2 pivots BAS successifs, prix LL mais RSI HL
    (à la confirmation du 2ᵉ) ; bear miroir sur les hauts. cachée : prix HL
    mais RSI LL (continuation)."""
    c = px['c']
    r = rsi14(c)
    ev = []
    kind = 'L' if bull else 'H'
    ps = [p for p in alt if p[1] == kind]
    for j in range(1, len(ps)):
        i1, _, p1, _ = ps[j - 1]
        i2, _, p2, cf2 = ps[j]
        if i2 - i1 < 5 or i2 - i1 > 120:
            continue
        if not (np.isfinite(r[i1]) and np.isfinite(r[i2])):
            continue
        if bull:
            price_ll = p2 < p1 * 0.998
            price_hl = p2 > p1 * 1.002
            rsi_hl = r[i2] > r[i1] + 2
            rsi_ll = r[i2] < r[i1] - 2
            ok = (price_ll and rsi_hl) if not hidden else (price_hl and rsi_ll)
            direction = +1
        else:
            price_hh = p2 > p1 * 1.002
            price_lh = p2 < p1 * 0.998
            rsi_lh = r[i2] < r[i1] - 2
            rsi_hh = r[i2] > r[i1] + 2
            ok = (price_hh and rsi_lh) if not hidden else (price_lh and rsi_hh)
            direction = -1
        if not ok:
            continue
        depth = abs(r[i2] - r[i1]) / 20
        ev.append(mk(cf2, direction, dict(p1=(i1, p1), p2=(i2, p2), r1=r[i1], r2=r[i2]),
                     dict(q_trend=q_trend_score(c, i1, direction) if not hidden
                          else q_cont_trend_score(c, i1, direction),
                          q_geom=float(np.clip(depth, 0, 1)),
                          q_touch=float(np.clip((30 - min(r[i1], r[i2])) / 30, 0, 1)) if bull
                          else float(np.clip((max(r[i1], r[i2]) - 70) / 30, 0, 1)))))
    return dedup(ev)
