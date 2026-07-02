# Chasse aux NOUVEAUX edges d'accumulation (vendre -> racheter plus bas),
# frequences journaliere/hebdo. Protocole : refutation rapide sur 1d,
# IS 2018-04 -> 2024-01 SEULEMENT (holdout 2024+ intouche), stabilite par moities.
# Couts : 0.15% par cote (0.10% frais + 0.05% slippage).
import subprocess, math

DAY = 86400000
COST = 0.0015
IS_START = 1522886400000   # 2018-04-05
IS_END   = 1704067200000   # 2024-01-01
HALF     = 1613520000000   # 2021-02-17 (~moitie)

def q(sql):
    out = subprocess.run(['psql', 'postgres://tpx:tpx@localhost:5436/tpx', '-t', '-A', '-F', ',', '-c', sql],
                         capture_output=True, text=True).stdout.strip()
    return [line.split(',') for line in out.splitlines() if line]

rows = q("SELECT open_time, open, high, low, close, volume, taker_buy_base FROM candles WHERE market='spot' AND symbol='BTCUSDT' AND interval='1d' ORDER BY open_time")
D = [dict(t=int(a), o=float(b), h=float(c), l=float(d), c=float(e), v=float(f), tb=float(g))
     for a, b, c, d, e, f, g in rows]
c3 = [(int(a), float(b)) for a, b in q("SELECT open_time, close FROM candles WHERE market='spot' AND symbol='BTCUSDT' AND interval='3d' ORDER BY open_time")]

def ema(vals, n):
    out = []; seed = 0.0; cnt = 0; v = None; a = 2/(n+1)
    for x in vals:
        if v is None:
            seed += x; cnt += 1
            if cnt >= n: v = seed/n
            out.append(v)
        else:
            v = a*x + (1-a)*v; out.append(v)
    return out

closes = [d['c'] for d in D]
e200 = ema(closes, 200)
e60_3d = ema([c for _, c in c3], 60)

# regimes evalues au close du jour i (bougies closes uniquement)
# bear_v2 ~ (close<ema200 & declin30) ET (3d: close<ema60 & declin8) — approx quotidienne
bear3d_by_close = {}
for k, (t, c) in enumerate(c3):
    ok = e60_3d[k] is not None and c < e60_3d[k] and k >= 8 and e60_3d[k-8] is not None and e60_3d[k-8] > e60_3d[k]
    bear3d_by_close[t + 3*DAY - 1] = ok
k3 = sorted(bear3d_by_close)

bear_simple = [False]*len(D)   # close < EMA200
bear_v2 = [False]*len(D)
j3 = 0; last3 = None
for i, d in enumerate(D):
    ct = d['t'] + DAY - 1
    while j3 < len(k3) and k3[j3] <= ct:
        last3 = k3[j3]; j3 += 1
    b1 = e200[i] is not None and d['c'] < e200[i] and i >= 30 and e200[i-30] is not None and e200[i-30] > e200[i]
    bear_simple[i] = e200[i] is not None and d['c'] < e200[i]
    bear_v2[i] = b1 and (last3 is not None and bear3d_by_close[last3])

def in_is(i): return IS_START <= D[i]['t'] < IS_END
def half_of(i): return 1 if D[i]['t'] < HALF else 2

print(f"{len(D)} jours 1d ; IS = {sum(1 for i in range(len(D)) if in_is(i))} jours ; bear_v2 sur IS = {sum(1 for i in range(len(D)) if in_is(i) and bear_v2[i])}")

# ============ A) FADE DE REBOND EN BEAR (mean reversion SHORT) ============
print("\n=== A) vendre le rip en bear : bounce 2j >= X% -> forward (jours suivants) ===")
print("(events non chevauchants ; baseline = tous les jours du meme regime)")
for regime_name, regime in [('bear_v2', bear_v2), ('bear_simple(<ema200)', bear_simple), ('tous', [True]*len(D))]:
    for th in [0.03, 0.05, 0.08]:
        events = []
        lastev = -10
        for i in range(2, len(D) - 5):
            if not in_is(i) or not regime[i]: continue
            r2 = D[i]['c']/D[i-2]['c'] - 1
            if r2 >= th and i - lastev >= 3:
                events.append(i); lastev = i
        if len(events) < 8:
            print(f"  {regime_name:22s} th={th*100:.0f}% : n={len(events)} (trop peu)"); continue
        base = [i for i in range(2, len(D)-5) if in_is(i) and regime[i]]
        for k in [2, 3, 5]:
            fw = [D[i+k]['c']/D[i]['c'] - 1 for i in events]
            bs = [D[i+k]['c']/D[i]['c'] - 1 for i in base]
            m = sum(fw)/len(fw); mb = sum(bs)/len(bs)
            neg = sum(1 for x in fw if x < 0)/len(fw)
            h1 = [D[i+k]['c']/D[i]['c'] - 1 for i in events if half_of(i) == 1]
            h2 = [D[i+k]['c']/D[i]['c'] - 1 for i in events if half_of(i) == 2]
            s1 = sum(h1)/len(h1) if h1 else float('nan')
            s2 = sum(h2)/len(h2) if h2 else float('nan')
            print(f"  {regime_name:22s} th={th*100:.0f}% fwd{k}j : n={len(events):3d} moy={m*100:+.2f}% (base {mb*100:+.2f}%) %neg={neg*100:.0f} | moities {s1*100:+.2f}/{s2*100:+.2f}")

# ============ B) MOMENTUM JOURNALIER AVEC HYSTERESIS ============
def run_flip(sell_sig, rebuy_sig, label):
    """simulate: hold BTC; sell at close when sell_sig[i]; rebuy at close when rebuy_sig[i]."""
    eq = 1.0; sold_px = None; flips = 0
    curve = []
    peak = 0; maxdd = 0
    for i in range(len(D)):
        if not in_is(i):
            continue
        px = D[i]['c']
        if sold_px is None and sell_sig[i]:
            sold_px = px * (1 - COST); flips += 1
        elif sold_px is not None and rebuy_sig[i]:
            eq *= sold_px / (px * (1 + COST)); sold_px = None
        cur = eq if sold_px is None else eq * sold_px / px
        curve.append(cur)
        peak = max(peak, cur)
        maxdd = max(maxdd, (peak - cur) / peak if peak > 0 else 0)
    if sold_px is not None:
        eq *= sold_px / (D[-1]['c'] * (1 + COST))
    yrs = (IS_END - IS_START) / (365.25 * DAY)
    return eq - 1, flips / yrs, maxdd

print("\n=== B) momentum 1d : sortir sous SMA_N*(1-b), revenir > SMA_N*(1+b) ===")
def sma_series(vals, n):
    out = []; s = 0.0
    for i, x in enumerate(vals):
        s += x
        if i >= n: s -= vals[i-n]
        out.append(s/n if i >= n-1 else None)
    return out
for N in [20, 50, 100, 150, 200]:
    sm = sma_series(closes, N)
    for b in [0.0, 0.01, 0.02]:
        sell = [sm[i] is not None and D[i]['c'] < sm[i]*(1-b) for i in range(len(D))]
        rebuy = [sm[i] is not None and D[i]['c'] > sm[i]*(1+b) for i in range(len(D))]
        net, fpy, dd = run_flip(sell, rebuy, f"sma{N}")
        print(f"  SMA{N:3d} hyst={b*100:.0f}% : net {net*100:+7.1f}%  DD {dd*100:5.1f}%  flips/an {fpy:4.1f}")

# ============ C) DONCHIAN : vendre cassure du bas N j, racheter cassure du haut M j ============
print("\n=== C) donchian 1d : vendre < plusBas(N), racheter > plusHaut(M) [en bear_simple ou tous] ===")
for gate_name, gate in [('tous', [True]*len(D)), ('bear_simple', bear_simple)]:
    for N in [10, 20, 30, 55]:
        for M in [5, 10, 20]:
            sell = [False]*len(D); rebuy = [False]*len(D)
            for i in range(len(D)):
                if i >= N:
                    lo = min(d['l'] for d in D[i-N:i])
                    sell[i] = gate[i] and D[i]['c'] < lo
                if i >= M:
                    hi = max(d['h'] for d in D[i-M:i])
                    rebuy[i] = D[i]['c'] > hi
            net, fpy, dd = run_flip(sell, rebuy, f"don{N}/{M}")
            print(f"  [{gate_name:11s}] N={N:2d} M={M:2d} : net {net*100:+7.1f}%  DD {dd*100:5.1f}%  flips/an {fpy:4.1f}")

# ============ F) CAPITULATION FLOW/VOLUME (bougie 1d) ============
print("\n=== F) capitulation : takerFlow bas / volume spike + grosse rouge -> forward ===")
flows = [d['tb']/d['v'] if d['v'] > 0 else 0.5 for d in D]
vol_z = []
for i, d in enumerate(D):
    win = [x['v'] for x in D[max(0, i-90):i]]
    if len(win) < 30: vol_z.append(0); continue
    mu = sum(win)/len(win)
    sd = (sum((x-mu)**2 for x in win)/len(win)) ** 0.5
    vol_z.append((d['v']-mu)/sd if sd > 0 else 0)
for cond_name, cond in [
    ('flow<0.42 (decile bas)', lambda i: flows[i] < 0.42),
    ('volZ>3 & ret<-5%', lambda i: vol_z[i] > 3 and D[i]['c']/D[i-1]['c']-1 < -0.05),
    ('volZ>3 & ret<-5% & bear', lambda i: vol_z[i] > 3 and D[i]['c']/D[i-1]['c']-1 < -0.05 and bear_simple[i]),
]:
    ev = [i for i in range(90, len(D)-5) if in_is(i) and cond(i)]
    # dedupe (non chevauchants a 3j)
    dd_ev = []
    last = -10
    for i in ev:
        if i - last >= 3: dd_ev.append(i); last = i
    if len(dd_ev) < 8:
        print(f"  {cond_name:28s}: n={len(dd_ev)} (trop peu)"); continue
    for k in [1, 3, 5]:
        fw = [D[i+k]['c']/D[i]['c']-1 for i in dd_ev]
        m = sum(fw)/len(fw)
        pos = sum(1 for x in fw if x > 0)/len(fw)
        print(f"  {cond_name:28s} fwd{k}j : n={len(dd_ev):3d} moy={m*100:+.2f}% %pos={pos*100:.0f}")

# ============ H) HYBRIDE : momentum 1d + plafond de perte v2 ============
# Resultat (IS) : le cap NE repare PAS le DD (43-65% vs 33% v2) — a grain 1d le
# stop churne (28-51 stops, cascades de -5% dans les V-recoveries) sans le
# recross 4h precis. Voir LOG.md section "chasse from-scratch".
