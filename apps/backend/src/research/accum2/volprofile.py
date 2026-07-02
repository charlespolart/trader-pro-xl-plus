# VOLUME PROFILE / POC — la seule famille S/R jamais testee (prior sceptique
# herite de juin : les niveaux pivots cassent 73% du temps en bear).
# Profil glissant W jours construit depuis les bougies 4h (volume distribue
# uniformement sur [low,high], buckets log 0.5%), STRICTEMENT sans lookahead
# (le profil au bar t n'utilise que les bars < t).
# Definitions : POC = bucket max ; VA70 = zone contigue autour du POC a 70% ;
# HVN/LVN = maxima/minima locaux du profil lisse.
# Events (direction accumulation) :
#   E1 vente au POC/VAH : rip depuis le bas (>=2% sous POC il y a 5 bars) qui
#      touche le POC -> le "mur de volume" rejette-t-il ? (fwd negatif attendu)
#   E2 entree en LVN par le haut : chute dans un trou de volume -> aspiration
#      vers le bas ? (fwd negatif attendu)
#   E3 rachat au HVN inferieur : chute dans un gros noeud de volume sous le
#      prix -> support ? (fwd positif attendu, timing de rachat)
# Sensibilite : W in {60,120,240}j ; condition bear/tous ; moities.
#   python3 apps/backend/src/research/accum2/volprofile.py
import subprocess, math

DAY = 86400000
H4 = 4*3600*1000
IS_START = 1522886400000
IS_END   = 1704067200000
HALF     = 1613520000000
BUCKET = 0.005  # log 0.5%

def q(sql):
    out = subprocess.run(['psql', 'postgres://tpx:tpx@localhost:5436/tpx', '-t', '-A', '-F', ',', '-c', sql],
                         capture_output=True, text=True).stdout.strip()
    return [line.split(',') for line in out.splitlines() if line]

rows = q("SELECT open_time, open, high, low, close, volume FROM candles WHERE market='spot' AND symbol='BTCUSDT' AND interval='4h' ORDER BY open_time")
D = [dict(t=int(a), o=float(b), h=float(c), l=float(d), c=float(e), v=float(f)) for a, b, c, d, e, f in rows]
d1 = q("SELECT open_time, close FROM candles WHERE market='spot' AND symbol='BTCUSDT' AND interval='1d' ORDER BY open_time")
D1 = [(int(a), float(b)) for a, b in d1]
def ema(vals, n):
    out=[]; s=0.0; cnt=0; v=None; a=2/(n+1)
    for x in vals:
        if v is None:
            s+=x; cnt+=1
            if cnt>=n: v=s/n
            out.append(v)
        else: v=a*x+(1-a)*v; out.append(v)
    return out
e200 = ema([c for _, c in D1], 200)
bear_by_day = {t//DAY: (e200[i] is not None and c < e200[i]) for i, (t, c) in enumerate(D1)}
def is_bear(t): return bear_by_day.get(t//DAY - 1, False)

bidx = lambda px: int(math.log(px)/BUCKET)

def add_bar(hist, bar, sign):
    lo, hi = bidx(bar['l']), bidx(bar['h'])
    n = hi - lo + 1
    w = bar['v']/n * sign
    for b in range(lo, hi+1):
        hist[b] = hist.get(b, 0.0) + w

def profile_features(hist):
    """POC, VAH/VAL (70%), HVN/LVN locaux du profil lisse (fenetre 5)."""
    if not hist: return None
    ks = sorted(hist)
    vs = [max(0.0, hist[k]) for k in ks]
    # lissage triangulaire 5
    sm = []
    for i in range(len(vs)):
        acc = wsum = 0.0
        for d_ in (-2, -1, 0, 1, 2):
            j = i + d_
            if 0 <= j < len(vs):
                w = 3 - abs(d_)
                acc += vs[j]*w; wsum += w
        sm.append(acc/wsum)
    tot = sum(vs)
    if tot <= 0: return None
    ip = max(range(len(sm)), key=lambda i: sm[i])
    # VA 70% : extension gloutonne autour du POC
    va = {ip}; acc = vs[ip]
    loi, hii = ip, ip
    while acc < 0.70*tot and (loi > 0 or hii < len(vs)-1):
        cl = vs[loi-1] if loi > 0 else -1
        ch = vs[hii+1] if hii < len(vs)-1 else -1
        if ch >= cl and hii < len(vs)-1: hii += 1; acc += vs[hii]; va.add(hii)
        elif loi > 0: loi -= 1; acc += vs[loi]; va.add(loi)
        else: break
    # HVN / LVN : extrema locaux du lisse (ordre 3)
    hvn, lvn = [], []
    med = sorted(sm)[len(sm)//2]
    for i in range(3, len(sm)-3):
        seg = sm[i-3:i+4]
        if sm[i] == max(seg) and sm[i] > 1.5*med: hvn.append(ks[i])
        if sm[i] == min(seg) and sm[i] < 0.5*med: lvn.append(ks[i])
    return dict(poc=ks[ip], val=ks[loi], vah=ks[hii], hvn=set(hvn), lvn=set(lvn))

def study(W_days):
    Wb = W_days*6  # bars 4h
    hist = {}
    events = {k: [] for k in ('E1_poc_rip', 'E2_lvn_down', 'E3_hvn_land')}
    feat = None
    for i, bar in enumerate(D):
        # profil = bars [i-Wb, i) — calcule AVANT de traiter le bar i
        if i >= 1: add_bar(hist, D[i-1], +1)
        if i-1-Wb >= 0: add_bar(hist, D[i-1-Wb], -1)
        if i % 6 == 0: feat = profile_features(hist) if i >= Wb else None  # refresh 1x/jour
        if feat is None: continue
        if not (IS_START <= bar['t'] < IS_END): continue
        b_now = bidx(bar['c'])
        b_prev5 = bidx(D[i-5]['c'])
        # E1 : rip depuis >=2% sous le POC qui atteint la zone POC (±1 bucket)
        if b_prev5 <= feat['poc'] - 4 and abs(b_now - feat['poc']) <= 1 and D[i-1]['c'] < bar['c']:
            events['E1_poc_rip'].append(i)
        # E2 : le close entre dans un LVN par le haut (bucket LVN, venu d'au-dessus)
        if b_now in feat['lvn'] and bidx(D[i-1]['c']) > b_now:
            events['E2_lvn_down'].append(i)
        # E3 : le close entre dans un HVN par le haut (chute qui atterrit sur un noeud)
        if b_now in feat['hvn'] and bidx(D[i-1]['c']) > b_now:
            events['E3_hvn_land'].append(i)
    return events

def report(name, idxs, k, cond):
    ded = []; last = -100
    for i in sorted(set(idxs)):
        if i+k >= len(D): continue
        if cond == 'bear' and not is_bear(D[i]['t']): continue
        if i - last >= 6:
            ded.append(i); last = i
    if len(ded) < 10:
        print(f"    {name:14s} [{cond}] n={len(ded)} (trop peu)"); return
    base = [j for j in range(len(D)-k) if IS_START <= D[j]['t'] < IS_END and (cond != 'bear' or is_bear(D[j]['t']))]
    f = [D[i+k]['c']/D[i]['c']-1 for i in ded]
    b = [D[j+k]['c']/D[j]['c']-1 for j in base]
    m = sum(f)/len(f); mb = sum(b)/len(b)
    var = sum((x-m)**2 for x in f)/max(1, len(f)-1)
    t = (m-mb)/((var/len(f))**0.5) if var > 0 else 0
    h1 = [D[i+k]['c']/D[i]['c']-1 for i in ded if D[i]['t'] < HALF]
    h2 = [D[i+k]['c']/D[i]['c']-1 for i in ded if D[i]['t'] >= HALF]
    m1 = sum(h1)/len(h1)*100 if h1 else float('nan')
    m2 = sum(h2)/len(h2)*100 if h2 else float('nan')
    print(f"    {name:14s} [{cond}] n={len(ded):4d} fwd{k}b {m*100:+.2f}% (vs base {(m-mb)*100:+.2f}, t={t:+.1f}) | moitiés {m1:+.2f}/{m2:+.2f}")

for W in [60, 120, 240]:
    print(f"\n=== fenêtre de profil {W} jours ===")
    ev = study(W)
    for name in ('E1_poc_rip', 'E2_lvn_down', 'E3_hvn_land'):
        for cond in ('tous', 'bear'):
            report(name, ev[name], 18, cond)
