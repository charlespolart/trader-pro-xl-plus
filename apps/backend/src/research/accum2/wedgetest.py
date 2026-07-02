# DEEP-DIVE WEDGE 4h : le seul candidat des figures geometriques.
# Question : l'effet (rising wedge -> baisse, falling wedge -> hausse) survit-il
# aux perturbations de DEFINITION (L des pivots, ligne de cassure, exigence de
# convergence), au split bear/bull, et au voisinage parametrique ?
# + stress du candidat fib 1d (bandes / drop_min) qui contredisait le 4h.
#   python3 apps/backend/src/research/accum2/wedgetest.py
import subprocess

DAY = 86400000
COST = 0.0015
IS_START = 1522886400000
IS_END   = 1704067200000
HALF     = 1613520000000

def q(sql):
    out = subprocess.run(['psql', 'postgres://tpx:tpx@localhost:5436/tpx', '-t', '-A', '-F', ',', '-c', sql],
                         capture_output=True, text=True).stdout.strip()
    return [line.split(',') for line in out.splitlines() if line]

def load(tf, sym='BTCUSDT'):
    rows = q(f"SELECT open_time, open, high, low, close FROM candles WHERE market='spot' AND symbol='{sym}' AND interval='{tf}' ORDER BY open_time")
    return [dict(t=int(a), o=float(b), h=float(c), l=float(d), c=float(e)) for a, b, c, d, e in rows]

D1 = load('1d')
def ema(vals, n):
    out=[]; s=0.0; cnt=0; v=None; a=2/(n+1)
    for x in vals:
        if v is None:
            s+=x; cnt+=1
            if cnt>=n: v=s/n
            out.append(v)
        else:
            v=a*x+(1-a)*v; out.append(v)
    return out
e200 = ema([d['c'] for d in D1], 200)
bear_by_day = {d['t']//DAY: (e200[i] is not None and d['c'] < e200[i]) for i, d in enumerate(D1)}
def is_bear(t): return bear_by_day.get(t//DAY - 1, False)

def pivots(D, L):
    raw = []
    for j in range(L, len(D)-L):
        win = D[j-L:j+L+1]
        if D[j]['h'] == max(w['h'] for w in win): raw.append(dict(kind='H', i=j, px=D[j]['h'], conf=j+L))
        if D[j]['l'] == min(w['l'] for w in win): raw.append(dict(kind='L', i=j, px=D[j]['l'], conf=j+L))
    raw.sort(key=lambda p: p['i'])
    out = []
    for p in raw:
        if out and out[-1]['kind'] == p['kind']:
            keep = (p['px'] > out[-1]['px']) if p['kind'] == 'H' else (p['px'] < out[-1]['px'])
            if keep: out[-1] = p
        else: out.append(p)
    return out

def detect_wedge(D, piv, rising, break_mode='line', conv_min=1.0, scan=60):
    events = []
    for a in range(len(piv)-5):
        p = piv[a:a+6]
        hs = [x for x in p if x['kind']=='H']; ls = [x for x in p if x['kind']=='L']
        if len(hs)!=3 or len(ls)!=3: continue
        mono_h = hs[0]['px']<hs[1]['px']<hs[2]['px'] if rising else hs[0]['px']>hs[1]['px']>hs[2]['px']
        mono_l = ls[0]['px']<ls[1]['px']<ls[2]['px'] if rising else ls[0]['px']>ls[1]['px']>ls[2]['px']
        if not (mono_h and mono_l): continue
        sh = (hs[2]['px']-hs[0]['px'])/max(1, hs[2]['i']-hs[0]['i'])
        sl = (ls[2]['px']-ls[0]['px'])/max(1, ls[2]['i']-ls[0]['i'])
        conv = (sl > conv_min*sh > 0) if rising else (sl < conv_min*sh < 0)
        if not conv: continue
        ready = max(x['conf'] for x in p)
        for i in range(ready, min(len(D), ready+scan)):
            if break_mode == 'line':
                line = ls[0]['px'] + sl*(i-ls[0]['i']) if rising else hs[0]['px'] + sh*(i-hs[0]['i'])
                broke = D[i]['c'] < line if rising else D[i]['c'] > line
            else:  # 'pivot' : cassure du dernier pivot bas (rising) / haut (falling)
                broke = D[i]['c'] < ls[-1]['px'] if rising else D[i]['c'] > hs[-1]['px']
            if broke:
                events.append(i); break
    return events

def report(D, idxs, k, label):
    evs = sorted(set(idxs))
    ded = []; last=-100
    for i in evs:
        if IS_START <= D[i]['t'] < IS_END and i+k < len(D) and i-last >= 5:
            ded.append(i); last = i
    if len(ded) < 8:
        print(f"  {label:44s} n={len(ded)} (trop peu)"); return
    base = [j for j in range(len(D)-k) if IS_START <= D[j]['t'] < IS_END]
    f = [D[i+k]['c']/D[i]['c']-1 for i in ded]
    b = [D[j+k]['c']/D[j]['c']-1 for j in base]
    m = sum(f)/len(f); mb = sum(b)/len(b)
    var = sum((x-m)**2 for x in f)/max(1, len(f)-1)
    t = (m-mb)/((var/len(f))**0.5) if var > 0 else 0
    h1 = [D[i+k]['c']/D[i]['c']-1 for i in ded if D[i]['t'] < HALF]
    h2 = [D[i+k]['c']/D[i]['c']-1 for i in ded if D[i]['t'] >= HALF]
    m1 = sum(h1)/len(h1)*100 if h1 else float('nan')
    m2 = sum(h2)/len(h2)*100 if h2 else float('nan')
    br = [D[i+k]['c']/D[i]['c']-1 for i in ded if is_bear(D[i]['t'])]
    bl = [D[i+k]['c']/D[i]['c']-1 for i in ded if not is_bear(D[i]['t'])]
    sb = f"bear {sum(br)/len(br)*100:+.2f}%(n={len(br)})" if len(br) >= 4 else f"bear n={len(br)}"
    sl_ = f"bull {sum(bl)/len(bl)*100:+.2f}%(n={len(bl)})" if len(bl) >= 4 else f"bull n={len(bl)}"
    print(f"  {label:44s} n={len(ded):3d} fwd{k}b {m*100:+.2f}% (vs base {(m-mb)*100:+.2f}, t={t:+.1f}) | moitiés {m1:+.2f}/{m2:+.2f} | {sb} {sl_}")

D4 = load('4h')
K = 18
print("=== RISING WEDGE 4h (baissier) — perturbations de définition, fwd 18 barres (3j) ===")
for L in [5, 8, 12]:
    piv = pivots(D4, L)
    report(D4, detect_wedge(D4, piv, True, 'line'), K, f"L={L} · cassure ligne des lows")
    report(D4, detect_wedge(D4, piv, True, 'pivot'), K, f"L={L} · cassure dernier pivot bas")
    report(D4, detect_wedge(D4, piv, True, 'line', conv_min=1.3), K, f"L={L} · convergence forte (sl>1.3·sh)")
print("\n=== FALLING WEDGE 4h (haussier, miroir) ===")
for L in [5, 8, 12]:
    piv = pivots(D4, L)
    report(D4, detect_wedge(D4, piv, False, 'line'), K, f"L={L} · cassure ligne des highs")
    report(D4, detect_wedge(D4, piv, False, 'pivot'), K, f"L={L} · cassure dernier pivot haut")

print("\n=== contrôle négatif : mêmes 6 pivots SANS convergence (canal parallèle ±10%) ===")
def detect_channel(D, piv, rising=True):
    events = []
    for a in range(len(piv)-5):
        p = piv[a:a+6]
        hs = [x for x in p if x['kind']=='H']; ls = [x for x in p if x['kind']=='L']
        if len(hs)!=3 or len(ls)!=3: continue
        mono_h = hs[0]['px']<hs[1]['px']<hs[2]['px'] if rising else hs[0]['px']>hs[1]['px']>hs[2]['px']
        mono_l = ls[0]['px']<ls[1]['px']<ls[2]['px'] if rising else ls[0]['px']>ls[1]['px']>ls[2]['px']
        if not (mono_h and mono_l): continue
        sh = (hs[2]['px']-hs[0]['px'])/max(1, hs[2]['i']-hs[0]['i'])
        sl = (ls[2]['px']-ls[0]['px'])/max(1, ls[2]['i']-ls[0]['i'])
        if sh <= 0 or sl <= 0 or abs(sl/sh - 1) > 0.10: continue  # paralleles
        ready = max(x['conf'] for x in p)
        for i in range(ready, min(len(D), ready+60)):
            line = ls[0]['px'] + sl*(i-ls[0]['i'])
            if D[i]['c'] < line: events.append(i); break
    return events
for L in [5, 8, 12]:
    report(D4, detect_channel(D4, pivots(D4, L), True), K, f"L={L} · canal montant parallèle, cassure bas")

print("\n=== ETH 4h : le wedge transfère-t-il ? ===")
E4 = load('4h', 'ETHUSDT')
for L in [8]:
    piv = pivots(E4, L)
    report(E4, detect_wedge(E4, piv, True, 'line'), K, f"ETH rising L={L} (fwd vs base BTC non comparable)")
    report(E4, detect_wedge(E4, piv, False, 'line'), K, f"ETH falling L={L}")

print("\n=== stress FIB 1d (le candidat contradictoire) : bandes × drop_min ===")
piv1 = pivots(D1, 5)
def detect_fib(D, piv, drop_min, lo_b, hi_b):
    events = []
    for a in range(len(piv)-1):
        if piv[a]['kind']!='H' or piv[a+1]['kind']!='L': continue
        H, Lo = piv[a], piv[a+1]
        if (H['px']-Lo['px'])/H['px'] < drop_min: continue
        b_lo = Lo['px'] + lo_b*(H['px']-Lo['px']); b_hi = Lo['px'] + hi_b*(H['px']-Lo['px'])
        for i in range(Lo['conf'], min(len(D), Lo['i']+120)):
            if D[i]['c'] > H['px']: break
            if b_lo <= D[i]['c'] <= b_hi: events.append(i); break
    return events
for drop in [0.12, 0.15, 0.20]:
    for lo_b, hi_b in [(0.382, 0.5), (0.5, 0.618), (0.618, 0.786)]:
        report(D1, detect_fib(D1, piv1, drop, lo_b, hi_b), 5, f"drop≥{int(drop*100)}% bande {lo_b}-{hi_b}")
