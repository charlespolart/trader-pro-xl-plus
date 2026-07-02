# ACCUMULER DU BTC VIA ETHBTC : long trend-following sur le ratio, denomine BTC.
# Detenir BTC par defaut (=0%) ; acheter ETH quand ETHBTC trend haut ; revendre
# en BTC quand le trend casse. Mecanique miroir de l'accumulateur (acheter le
# ratio bas / revendre haut), complementaire a la v2 (les phases de surperf ETH
# sont historiquement des bulls, quand la v2 dort).
# IS 2018-04 -> 2024-01, holdout 2024+ INTOUCHE. Couts 0.15%/cote. Moities.
#   python3 apps/backend/src/research/accum2/ethbtc.py
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

rows = q("SELECT open_time, open, high, low, close, volume FROM candles WHERE market='spot' AND symbol='ETHBTC' AND interval='1d' ORDER BY open_time")
D = [dict(t=int(a), o=float(b), h=float(c), l=float(d), c=float(e), v=float(f)) for a, b, c, d, e, f in rows]
closes = [d['c'] for d in D]
print(f"ETHBTC 1d : {len(D)} jours, {D[0]['t']//DAY*0+2017} → …")

is_idx = [i for i in range(len(D)) if IS_START <= D[i]['t'] < IS_END]
bh = D[is_idx[-1]]['c']/D[is_idx[0]]['c'] - 1
print(f"IS 2018-04→2024-01 : B&H ETHBTC {bh*100:+.1f}% (de {D[is_idx[0]]['c']:.4f} à {D[is_idx[-1]]['c']:.4f})")

# ---- diagnostics de tendance
def autocorr(rets, lag):
    n = len(rets) - lag
    if n < 30: return float('nan')
    m = sum(rets)/len(rets)
    num = sum((rets[i]-m)*(rets[i+lag]-m) for i in range(n))
    den = sum((r-m)**2 for r in rets)
    return num/den if den > 0 else float('nan')
r30 = [closes[i+30]/closes[i]-1 for i in is_idx if i+30 < len(D) and D[i+30]['t'] < IS_END][::30]
print(f"autocorrélation des rendements 30j (non chevauchants) lag1 : {autocorr(r30, 1):+.2f} (n={len(r30)})")

def sma_series(vals, n):
    out=[]; s=0.0
    for i, x in enumerate(vals):
        s += x
        if i >= n: s -= vals[i-n]
        out.append(s/n if i >= n-1 else None)
    return out
def ema_series(vals, n):
    out=[]; s=0.0; cnt=0; v=None; a=2/(n+1)
    for x in vals:
        if v is None:
            s+=x; cnt+=1
            if cnt>=n: v=s/n
            out.append(v)
        else: v=a*x+(1-a)*v; out.append(v)
    return out

def run_long(buy_sig, sell_sig, start=IS_START, end=IS_END):
    """flat en BTC par defaut ; long ETH entre buy et sell. Equity en BTC."""
    eq = 1.0; entry = None; flips = 0
    peak = 0.0; mdd = 0.0
    h1_eq = None
    for i in range(len(D)):
        t = D[i]['t']
        if not (start <= t < end): continue
        px = D[i]['c']
        if entry is None and buy_sig[i]:
            entry = px*(1+COST); flips += 1
        elif entry is not None and sell_sig[i]:
            eq *= px*(1-COST)/entry; entry = None
        cur = eq if entry is None else eq*px/entry
        if t < HALF: h1_eq = cur
        peak = max(peak, cur); mdd = max(mdd, (peak-cur)/peak if peak > 0 else 0)
    last = D[-1]
    if entry is not None:
        i2 = max(i for i in range(len(D)) if start <= D[i]['t'] < end)
        eq *= D[i2]['c']*(1-COST)/entry
    yrs = (end-start)/(365.25*DAY)
    return eq-1, flips/yrs, mdd, (h1_eq or 1)-1

print("\n=== grilles long-only ETHBTC (IS ; net en BTC ; h1 = équité à mi-parcours) ===")
print(f"{'règle':30s} {'net':>8s} {'DD':>6s} {'fl/an':>6s} {'h1':>8s}")
for N in [20, 50, 100, 150, 200]:
    sm = sma_series(closes, N)
    for b in [0.0, 0.02]:
        buy = [sm[i] is not None and closes[i] > sm[i]*(1+b) for i in range(len(D))]
        sell = [sm[i] is not None and closes[i] < sm[i]*(1-b) for i in range(len(D))]
        net, fpy, dd, h1 = run_long(buy, sell)
        print(f"SMA{N:3d} hyst={int(b*100)}%{'':17s} {net*100:+7.1f}% {dd*100:5.1f}% {fpy:5.1f} {h1*100:+7.1f}%")
for fast, slow in [(20, 50), (20, 100), (50, 100), (50, 200)]:
    ef, es = ema_series(closes, fast), ema_series(closes, slow)
    buy = [ef[i] is not None and es[i] is not None and ef[i] > es[i] for i in range(len(D))]
    sell = [ef[i] is not None and es[i] is not None and ef[i] < es[i] for i in range(len(D))]
    net, fpy, dd, h1 = run_long(buy, sell)
    print(f"EMA{fast}/{slow} cross{'':15s} {net*100:+7.1f}% {dd*100:5.1f}% {fpy:5.1f} {h1*100:+7.1f}%")
for N, M in [(20, 10), (55, 20), (30, 15)]:
    buy = [False]*len(D); sell = [False]*len(D)
    for i in range(len(D)):
        if i >= N: buy[i] = closes[i] > max(d['h'] for d in D[i-N:i])
        if i >= M: sell[i] = closes[i] < min(d['l'] for d in D[i-M:i])
    net, fpy, dd, h1 = run_long(buy, sell)
    print(f"donchian {N}/{M}{'':18s} {net*100:+7.1f}% {dd*100:5.1f}% {fpy:5.1f} {h1*100:+7.1f}%")

# variante avec plafond de perte (l'ingredient v2) sur la meilleure famille MA
print("\n=== + plafond de perte 5% (intrabar, low) sur les crosses EMA ===")
for fast, slow in [(20, 100), (50, 100), (50, 200)]:
    ef, es = ema_series(closes, fast), ema_series(closes, slow)
    eq = 1.0; entry = None; flips = 0; peak = 0.0; mdd = 0.0; stops = 0
    for i in range(len(D)):
        t = D[i]['t']
        if not (IS_START <= t < IS_END): continue
        px = D[i]['c']
        if entry is not None and D[i]['l'] <= entry/(1+COST)*0.95:
            eq *= 0.95*(1-COST)/(1+COST)  # sortie au niveau du cap (couts des 2 cotes)
            entry = None; stops += 1
        if entry is None and ef[i] is not None and es[i] is not None and ef[i] > es[i]:
            entry = px*(1+COST); flips += 1
        elif entry is not None and ef[i] is not None and ef[i] < es[i]:
            eq *= px*(1-COST)/entry; entry = None
        cur = eq if entry is None else eq*px/entry
        peak = max(peak, cur); mdd = max(mdd, (peak-cur)/peak if peak > 0 else 0)
    print(f"EMA{fast}/{slow} + cap5% : net {(eq-1)*100:+.1f}%  DD {mdd*100:.1f}%  flips/an {flips/5.74:.1f}  stops {stops}")
