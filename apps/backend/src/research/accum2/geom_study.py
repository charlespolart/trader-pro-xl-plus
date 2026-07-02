# FIGURES GEOMETRIQUES en direction accumulation (vendre le break, racheter plus bas).
# Pivots fractals confirmes a +L barres (AUCUN lookahead : l'event n'utilise que
# l'info disponible a sa date). IS 2018-04 -> 2024-01, 1d et 4h, moities.
# Pour chaque detecteur : (a) forward returns vs baseline ; (b) simulation
# d'excursion realiste : vente au close du break, stop +5% (intrabar), cible =
# measured move (intrabar), timeout 30j -> rachat au close. Couts 0.15%/cote.
#   python3 apps/backend/src/research/accum2/geom_study.py
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

def load(tf):
    rows = q(f"SELECT open_time, open, high, low, close FROM candles WHERE market='spot' AND symbol='BTCUSDT' AND interval='{tf}' ORDER BY open_time")
    return [dict(t=int(a), o=float(b), h=float(c), l=float(d), c=float(e)) for a, b, c, d, e in rows]

D1 = load('1d')
# bear regime simple (close<EMA200 1d), connu au jour j pour j+1
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
bear_by_day = {}
for i, d in enumerate(D1):
    bear_by_day[d['t']//DAY] = e200[i] is not None and d['c'] < e200[i]
def is_bear(t):
    return bear_by_day.get(t//DAY - 1, False)

# ---------- pivots fractals confirmes ----------
def pivots(D, L):
    """liste chronologique de pivots {kind:'H'/'L', i, px, confirmed_at=i+L},
    alternance forcee (deux H consecutifs -> garder le plus haut)."""
    raw = []
    for j in range(L, len(D)-L):
        win = D[j-L:j+L+1]
        if D[j]['h'] == max(w['h'] for w in win):
            raw.append(dict(kind='H', i=j, px=D[j]['h'], conf=j+L))
        if D[j]['l'] == min(w['l'] for w in win):
            raw.append(dict(kind='L', i=j, px=D[j]['l'], conf=j+L))
    raw.sort(key=lambda p: p['i'])
    out = []
    for p in raw:
        if out and out[-1]['kind'] == p['kind']:
            keep = (p['px'] > out[-1]['px']) if p['kind'] == 'H' else (p['px'] < out[-1]['px'])
            if keep: out[-1] = p
        else:
            out.append(p)
    return out

# ---------- detecteurs -> events {i (bar du signal), side, mm (measured move frac), name} ----------
def detect_hs(D, piv, head_min=0.02, sh_tol=0.05, inverse=False):
    """H&S top : pivots [H1,L1,H2,L2,H3], head H2 > epaules ; signal = close
    casse la neckline (droite L1-L2 extrapolee). inverse=True -> H&S bottom."""
    events = []
    K = 'L' if inverse else 'H'
    A = 'H' if inverse else 'L'
    for a in range(len(piv)-4):
        p = piv[a:a+5]
        if [x['kind'] for x in p] != [K, A, K, A, K]: continue
        h1, l1, h2, l2, h3 = p
        sgn = -1 if inverse else 1
        if sgn*h2['px'] <= sgn*h1['px']*(1+sgn*head_min) or sgn*h2['px'] <= sgn*h3['px']*(1+sgn*head_min): continue
        if abs(h1['px']-h3['px']) > sh_tol*(h1['px']+h3['px'])/2: continue
        ready = h3['conf']
        if l2['i'] == l1['i']: continue
        slope = (l2['px']-l1['px'])/(l2['i']-l1['i'])
        height = abs(h2['px'] - (l1['px']+slope*(h2['i']-l1['i'])))
        for i in range(max(ready, l2['i']+1), min(len(D), h3['i']+90)):
            neck = l1['px'] + slope*(i-l1['i'])
            if neck <= 0: break
            broke = D[i]['c'] < neck if not inverse else D[i]['c'] > neck
            if broke:
                events.append(dict(i=i, mm=height/D[i]['c'], name='H&S bottom' if inverse else 'H&S top'))
                break
    return events

def detect_double(D, piv, tol=0.025, inverse=False):
    """double top : [H1,L1,H2] sommets egaux (tol) ; signal = close < L1."""
    events = []
    K = 'L' if inverse else 'H'
    A = 'H' if inverse else 'L'
    for a in range(len(piv)-2):
        p = piv[a:a+3]
        if [x['kind'] for x in p] != [K, A, K]: continue
        h1, l1, h2 = p
        if abs(h1['px']-h2['px']) > tol*(h1['px']+h2['px'])/2: continue
        depth = abs((h1['px']+h2['px'])/2 - l1['px'])
        for i in range(h2['conf'], min(len(D), h2['i']+90)):
            broke = D[i]['c'] < l1['px'] if not inverse else D[i]['c'] > l1['px']
            if broke:
                events.append(dict(i=i, mm=depth/D[i]['c'], name='double bottom' if inverse else 'double top'))
                break
    return events

def detect_wedge(D, piv, rising=True):
    """wedge : 3 highs + 3 lows monotones, pentes convergentes ;
    rising (bearish) : signal = close < droite des lows."""
    events = []
    for a in range(len(piv)-5):
        p = piv[a:a+6]
        hs = [x for x in p if x['kind']=='H']
        ls = [x for x in p if x['kind']=='L']
        if len(hs)!=3 or len(ls)!=3: continue
        mono_h = hs[0]['px']<hs[1]['px']<hs[2]['px'] if rising else hs[0]['px']>hs[1]['px']>hs[2]['px']
        mono_l = ls[0]['px']<ls[1]['px']<ls[2]['px'] if rising else ls[0]['px']>ls[1]['px']>ls[2]['px']
        if not (mono_h and mono_l): continue
        sh = (hs[2]['px']-hs[0]['px'])/max(1, hs[2]['i']-hs[0]['i'])
        sl = (ls[2]['px']-ls[0]['px'])/max(1, ls[2]['i']-ls[0]['i'])
        conv = sl > sh > 0 if rising else sl < sh < 0
        if not conv: continue
        ready = max(x['conf'] for x in p)
        height = abs(hs[-1]['px']-ls[-1]['px'])
        for i in range(ready, min(len(D), ready+60)):
            line = ls[0]['px'] + sl*(i-ls[0]['i']) if rising else hs[0]['px'] + sh*(i-hs[0]['i'])
            broke = D[i]['c'] < line if rising else D[i]['c'] > line
            if broke:
                events.append(dict(i=i, mm=height/D[i]['c'], name='rising wedge' if rising else 'falling wedge'))
                break
    return events

def detect_fib(D, piv, drop_min, lo_band=0.5, hi_band=0.618):
    """jambe H->Lo (drop >= drop_min) ; event = 1er close dans la bande de
    retracement 50-61.8% (vendre le rip au niveau fib)."""
    events = []
    for a in range(len(piv)-1):
        if piv[a]['kind']!='H' or piv[a+1]['kind']!='L': continue
        H, Lo = piv[a], piv[a+1]
        drop = (H['px']-Lo['px'])/H['px']
        if drop < drop_min: continue
        b_lo = Lo['px'] + lo_band*(H['px']-Lo['px'])
        b_hi = Lo['px'] + hi_band*(H['px']-Lo['px'])
        for i in range(Lo['conf'], min(len(D), Lo['i']+120)):
            if D[i]['c'] > H['px']: break  # jambe invalidee
            if b_lo <= D[i]['c'] <= b_hi:
                events.append(dict(i=i, mm=(D[i]['c']-Lo['px'])/D[i]['c'], name='fib 50-61.8'))
                break
    return events

def detect_ob(D, impulse, look=3):
    """order block baissier : derniere bougie verte avant une impulsion de
    -impulse sur `look` barres ; event = 1er retouch du zone (close dans
    [min(o,c), high]) dans les 90 barres, invalide si close > high."""
    events = []
    j = look
    while j < len(D):
        ret = D[j]['c']/D[j-look]['c'] - 1
        if ret <= -impulse:
            k = None
            for b in range(j-look, max(0, j-look-6), -1):
                if D[b]['c'] > D[b]['o']:
                    k = b
                    break
            if k is not None:
                zlo, zhi = min(D[k]['o'], D[k]['c']), D[k]['h']
                for i in range(j+1, min(len(D), j+90)):
                    if D[i]['c'] > zhi: break
                    if zlo <= D[i]['c'] <= zhi:
                        events.append(dict(i=i, mm=(D[i]['c']-D[j]['c'])/D[i]['c'], name='OB retouch'))
                        break
            j += look
        j += 1
    return events

# ---------- evaluation ----------
def evaluate(D, events, tf, horizons, sim_side=-1):
    """forward vs baseline + sim d'excursion (side=-1 : vendre au close event)."""
    evs = [e for e in events if IS_START <= D[e['i']]['t'] < IS_END and e['i']+max(horizons) < len(D)]
    ded = []
    last = -100
    for e in sorted(evs, key=lambda x: x['i']):
        if e['i'] - last >= 5:
            ded.append(e); last = e['i']
    if len(ded) < 8:
        return f"n={len(ded)} (trop peu)"
    base_idx = [i for i in range(len(D)-max(horizons)) if IS_START <= D[i]['t'] < IS_END]
    parts = []
    for k in horizons:
        f = [D[e['i']+k]['c']/D[e['i']]['c']-1 for e in ded]
        b = [D[i+k]['c']/D[i]['c']-1 for i in base_idx]
        m = sum(f)/len(f); mb = sum(b)/len(b)
        parts.append(f"fwd{k}: {m*100:+.2f}% ({(m-mb)*100:+.2f})")
    kh = horizons[1] if len(horizons) > 1 else horizons[0]
    h1 = [D[e['i']+kh]['c']/D[e['i']]['c']-1 for e in ded if D[e['i']]['t'] < HALF]
    h2 = [D[e['i']+kh]['c']/D[e['i']]['c']-1 for e in ded if D[e['i']]['t'] >= HALF]
    m1 = sum(h1)/len(h1)*100 if h1 else float('nan')
    m2 = sum(h2)/len(h2)*100 if h2 else float('nan')
    nbear = sum(1 for e in ded if is_bear(D[e['i']]['t']))
    # ---- simulation d'excursion (vente) : stop +5% intrabar, cible mm, timeout
    TIMEOUT = 30 if tf == '1d' else 180
    pnl = []
    for e in ded:
        entry = D[e['i']]['c']*(1-COST)
        stop = D[e['i']]['c']*1.05
        target = D[e['i']]['c']*(1 - min(max(e['mm'], 0.03), 0.30))
        out = None
        for i in range(e['i']+1, min(len(D), e['i']+TIMEOUT)):
            if D[i]['h'] >= stop: out = entry/(stop*(1+COST)) - 1; break
            if D[i]['l'] <= target: out = entry/(target*(1+COST)) - 1; break
        if out is None:
            i2 = min(len(D)-1, e['i']+TIMEOUT)
            out = entry/(D[i2]['c']*(1+COST)) - 1
        pnl.append(out)
    wr = sum(1 for x in pnl if x > 0)/len(pnl)
    avg = sum(pnl)/len(pnl)
    tot = 1.0
    for x in pnl: tot *= 1+x
    sim = f"SIM: n={len(pnl)} WR={wr*100:.0f}% moy={avg*100:+.2f}% cumul={(tot-1)*100:+.1f}%"
    return f"n={len(ded)} ({nbear} en bear) | {' | '.join(parts)} | moitiés {m1:+.2f}/{m2:+.2f} | {sim}"

for tf, D, L, horizons, drop_min, impulse in [('1d', D1, 5, [2, 5, 10], 0.15, 0.10),
                                              ('4h', load('4h'), 8, [6, 18, 42], 0.08, 0.05)]:
    piv = pivots(D, L)
    print(f"\n================ {tf} (pivots L={L} : {len(piv)}) ================")
    print("--- structures BAISSIÈRES (signal de VENTE ; sim = vendre le break) ---")
    for name, evs in [
        ('H&S top', detect_hs(D, piv)),
        ('double top', detect_double(D, piv)),
        ('rising wedge', detect_wedge(D, piv, rising=True)),
        ('fib 50-61.8 (rip en jambe)', detect_fib(D, piv, drop_min)),
        ('OB baissier retouch', detect_ob(D, impulse)),
    ]:
        print(f"  {name:28s} {evaluate(D, evs, tf, horizons)}")
    print("--- structures HAUSSIÈRES (timing de RACHAT ; fwd>0 = utile) ---")
    for name, evs in [
        ('H&S bottom (inverse)', detect_hs(D, piv, inverse=True)),
        ('double bottom', detect_double(D, piv, inverse=True)),
        ('falling wedge', detect_wedge(D, piv, rising=False)),
    ]:
        print(f"  {name:28s} {evaluate(D, evs, tf, horizons)}")
