#!/usr/bin/env python3
"""audit1/A2 — comptable INDÉPENDANT : rejoue les deux sondes (slow/churny)
depuis les bougies exportées et compare à l'équité du moteur.

Conventions répliquées depuis les RÈGLES (documentées), pas depuis le code :
- décision au close de la bougie i → ordre market servi à l'OPEN de i+1,
  slippage signé (BUY ×(1+s), SELL ×(1−s)) ;
- frais taker 0,10 % rognés sur l'ACTIF REÇU (BUY : base ×(1−r) ; SELL :
  quote ×(1−r)) ; totalFees en valeur quote ;
- quantités floorToStep(1e-5) avec epsilon (v+step·1e-9) puis 12 chiffres
  significatifs ; prix roundToStep(0.01) ;
- stop SELL : posé par onFill APRÈS la clôture de la bougie de fill → actif à
  partir de la bougie i+2 ; déclenché sur le chemin intrabar heuristique
  (vert : O→L→H→C ; rouge : O→H→L→C) au prix min(stop, curseur), servi
  ×(1−s) ; jamais pendant la bougie de son propre fill d'entrée ;
- équité = quote + base×close, échantillonnée aux closes ≥ start.
Écart toléré (pré-déclaré) : < 0,05 pt de CAGR ; sinon BUG à chercher.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STEP, TICK = 1e-5, 0.01
FEE, SLIP = 0.001, 0.0005


def round_fp(v):
    return float(f'{v:.12g}')


def floor_step(v, step=STEP):
    return round_fp(math.floor((v + step * 1e-9) / step) * step)


def round_tick(v, tick=TICK):
    return round_fp(round(v / tick) * tick)


def ema_series(xs, p):
    out = [None] * len(xs)
    v, cnt, acc = None, 0, 0.0
    a = 2 / (p + 1)
    for i, x in enumerate(xs):
        if v is None:
            acc += x
            cnt += 1
            if cnt == p:
                v = acc / p
                out[i] = v
            continue
        v = a * x + (1 - a) * v
        out[i] = v
    return out


def rma_series(xs, p):
    out = [None] * len(xs)
    v, cnt, acc = None, 0, 0.0
    a = 1 / p
    for i, x in enumerate(xs):
        if v is None:
            acc += x
            cnt += 1
            if cnt == p:
                v = acc / p
                out[i] = v
            continue
        v = a * x + (1 - a) * v
        out[i] = v
    return out


class Account:
    """comptabilité spot quote/base + journal des fills"""

    def __init__(self, quote):
        self.quote = quote
        self.base = 0.0
        self.fees = 0.0
        self.fills = []
        self.round_trips = 0

    def buy_quote(self, quote_qty, px, t):
        qty = floor_step(quote_qty / px)
        if qty <= 0:
            return
        notional = qty * px
        if notional > self.quote + 1e-9:
            return
        self.quote -= notional
        self.base += qty * (1 - FEE)
        self.fees += notional * FEE
        self.fills.append(('BUY', t, px, qty))

    def sell(self, qty, px, t):
        qty = min(qty, self.base)
        if qty <= 0:
            return
        notional = qty * px
        self.base -= qty
        self.quote += notional * (1 - FEE)
        self.fees += notional * FEE
        self.fills.append(('SELL', t, px, qty))
        self.round_trips += 1


def run_slow(candles, start, initial):
    O = [c[1] for c in candles]
    C = [c[4] for c in candles]
    CT = [c[6] for c in candles]
    f = ema_series(C, 50)
    s = ema_series(C, 200)
    acc = Account(initial)
    pending = None  # ('BUY', quoteQty) | ('SELL', qty)
    for i, _ in enumerate(candles):
        # 1) fill du market en attente à l'open de cette bougie
        if pending is not None:
            side, amt = pending
            if side == 'BUY':
                acc.buy_quote(amt, O[i] * (1 + SLIP), CT[i])
            else:
                acc.sell(amt, O[i] * (1 - SLIP), CT[i])
            pending = None
        # 2) décision au close (hooks supprimés avant start)
        if CT[i] < start or f[i] is None or s[i] is None:
            continue
        holding = acc.base > STEP  # minQty en guise de dust
        long = f[i] > s[i]
        if long and not holding:
            if acc.quote > 10:
                pending = ('BUY', acc.quote * 0.999)
        elif not long and holding:
            pending = ('SELL', floor_step(acc.base))
    final = acc.quote + acc.base * C[-1]
    return acc, final


def run_churny(candles, start, initial):
    O = [c[1] for c in candles]
    H = [c[2] for c in candles]
    L = [c[3] for c in candles]
    C = [c[4] for c in candles]
    CT = [c[6] for c in candles]
    n = len(candles)
    tr = [H[0] - L[0]] + [max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1])) for i in range(1, n)]
    atr = rma_series(tr, 14)
    # donchian 20 (barre courante incluse) — on consomme .at(1) côté signal
    dU = [None] * n
    dL = [None] * n
    for i in range(19, n):
        dU[i] = max(H[i - 19:i + 1])
        dL[i] = min(L[i - 19:i + 1])
    acc = Account(initial)
    pending = None            # ('BUY', quoteQty, stopPrice) | ('SELL', qty)
    stop = None               # (stopPrice, qty) actif
    arm_stop = None           # stop à armer à la FIN de la bougie de fill
    for i in range(n):
        # 1) markets en attente servis à l'open
        if pending is not None:
            if pending[0] == 'BUY':
                _, qq, sp = pending
                before = acc.base
                acc.buy_quote(qq, O[i] * (1 + SLIP), CT[i])
                if acc.base > before:
                    # onFill placera le stop pour la position totale, mais
                    # seulement une fois la bougie i terminée
                    arm_stop = (sp, floor_step(acc.base))
            else:
                acc.sell(pending[1], O[i] * (1 - SLIP), CT[i])
            pending = None
        # 2) chemin intrabar : déclenchement du stop actif
        if stop is not None:
            sp, sq = stop
            up = C[i] >= O[i]
            segs = [(O[i], L[i]), (L[i], H[i]), (H[i], C[i])] if up else [(O[i], H[i]), (H[i], L[i]), (L[i], C[i])]
            for frm, to in segs:
                if to < frm:  # segment descendant
                    if sp >= to:                       # dans [to, frm] ou gap
                        ev = min(sp, frm)
                        acc.sell(sq, ev * (1 - SLIP), CT[i])
                        stop = None
                        break
        # 3) armement du stop posé par onFill (après le walk de sa bougie)
        if arm_stop is not None:
            stop = arm_stop
            arm_stop = None
        # 4) décision au close
        if CT[i] < start or atr[i] is None or i < 20 or dU[i - 1] is None:
            continue
        holding = acc.base > STEP
        if holding:
            if C[i] < dL[i - 1]:
                stop = None  # cancelAll
                pending = ('SELL', floor_step(acc.base))
            continue
        if C[i] > dU[i - 1] and atr[i] > 0:
            if acc.quote > 10:
                pending = ('BUY', acc.quote * 0.999, round_tick(C[i] - 2 * atr[i]))
    final = acc.quote + acc.base * C[-1]
    return acc, final


def report(key, runner):
    d = json.load(open(os.path.join(HERE, 'out', f'engine_{key}.json')))
    cs = d['candles']
    start = d['config']['start']
    acc, final = runner(cs, start, d['config']['initialBalance'])
    eng = d['finalEquity']
    span_years = (d['config']['end'] - start) / (365.25 * 86_400_000)
    cagr_eng = (eng / 10_000) ** (1 / span_years) - 1
    cagr_py = (final / 10_000) ** (1 / span_years) - 1
    dcagr = abs(cagr_eng - cagr_py) * 100
    ok = dcagr < 0.05 and len(acc.fills) == len(d['fills'])
    print(f"--- {key} ---")
    print(f"équité   moteur {eng:12.2f} | python {final:12.2f} | Δ {abs(eng - final):10.4f} ({abs(eng / final - 1) * 100:.5f} %)")
    print(f"CAGR     moteur {cagr_eng * 100:8.3f}% | python {cagr_py * 100:8.3f}% | Δ {dcagr:.4f} pt → {'OK (<0,05)' if dcagr < 0.05 else 'FAIL'}")
    print(f"fills    moteur {len(d['fills'])} | python {len(acc.fills)} | frais {d['totalFees']:.2f} vs {acc.fees:.2f}")
    # diff fill à fill (le filet qui a servi côté actions)
    for k, (ef, pf) in enumerate(zip(d['fills'], acc.fills)):
        es = (ef['side'], ef['price'], ef['qty'])
        ps = (pf[0], pf[2], pf[3])
        if es[0] != ps[0] or abs(es[1] - ps[1]) / es[1] > 1e-9 or abs(es[2] - ps[2]) > 1e-9:
            print(f"  1er écart au fill #{k}: moteur {es} vs python {ps} (t={ef['time']})")
            break
    return ok


ok1 = report('slow', run_slow)
ok2 = report('churny', run_churny)
sys.exit(0 if ok1 and ok2 else 1)
