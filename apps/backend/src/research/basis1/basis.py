#!/usr/bin/env python3
"""basis1 — cash-and-carry quarterly BTC/ETH (protocole LOG.md committé
AVANT). Entrée au close si basis annualisée ≥ S (figés {5,10,15} %/an,
14-190 j restants), tenue à échéance, coûts 4×30 bps/cycle, net EFFECTIF
(jours flat compris). MTM quotidien : long spot + short daté.
  python3 basis.py"""
import datetime
import subprocess

import numpy as np

DB = 'postgres://tpx:tpx@localhost:5438/tpx'
DAY = 86_400_000
SEUILS = (0.05, 0.10, 0.15)
COST_CYCLE = 0.0120
REF = dict(BTCUSDT=9.9, ETHUSDT=11.8)     # carry perp hold (carry1), %/an net eff.


def q(sql):
    return subprocess.run(['psql', DB, '-c', sql], capture_output=True, text=True, check=True).stdout


def load_close(symbol, market):
    out = q(f"COPY (SELECT open_time, close FROM candles WHERE market='{market}' "
            f"AND symbol='{symbol}' AND interval='1d' ORDER BY open_time) TO STDOUT (FORMAT csv)")
    return {int(float(a)): float(b) for a, b in
            (line.split(',') for line in out.strip().split('\n') if line)}


def dated_symbols(base):
    out = q("COPY (SELECT DISTINCT symbol FROM candles WHERE market='futures' AND interval='1d' "
            f"AND symbol LIKE '{base}\\_2%' ORDER BY 1) TO STDOUT (FORMAT csv)")
    return [s for s in out.strip().split('\n') if s]


def expiry_ms(symbol):
    ymd = symbol.split('_')[1]
    d = datetime.datetime(2000 + int(ymd[:2]), int(ymd[2:4]), int(ymd[4:6]),
                          tzinfo=datetime.UTC)
    return int(d.timestamp() * 1000)


def main():
    for base in ('BTCUSDT', 'ETHUSDT'):
        spot = load_close(base, 'spot')
        days = np.array(sorted(spot.keys()), dtype=np.int64)
        contracts = []
        for s in dated_symbols(base):
            px = load_close(s, 'futures')
            if len(px) > 30:
                contracts.append((s, expiry_ms(s), px))
        a = np.datetime64('2021-01-01').astype('datetime64[ms]').astype(np.int64)
        b = np.datetime64('2026-07-01').astype('datetime64[ms]').astype(np.int64)
        eval_days = days[(days >= a) & (days < b)]
        years = len(eval_days) / 365.0
        print(f'\n=== {base} : {len(contracts)} contrats datés, fenêtre 2021-01→2026-07 '
              f'({years:.1f} ans) — réf perp hold {REF[base]:+.1f} %/an ===')
        for S in SEUILS:
            pnl = 0.0
            in_pos = None
            ncyc = 0
            captured = []
            invested = 0
            worst_mtm = 0.0
            mtm_path = 0.0
            for t in eval_days:
                t = int(t)
                if in_pos:
                    sym, exp, px, e_spot, e_fut = in_pos
                    if t in px:
                        cur = (spot[t] / e_spot - 1.0) - (px[t] / e_fut - 1.0)
                        worst_mtm = min(worst_mtm, cur)
                        mtm_path = cur
                        invested += 1
                    if t + DAY > exp or (t in px and (exp - t) < DAY):
                        pnl += mtm_path - COST_CYCLE
                        captured.append(mtm_path - COST_CYCLE)
                        in_pos = None
                    continue
                best = None
                for sym, exp, px in contracts:
                    rest = (exp - t) / DAY
                    if t in px and 14 <= rest <= 190 and spot.get(t):
                        bas = (px[t] / spot[t] - 1.0) * 365.0 / rest
                        if bas >= S and (best is None or bas > best[3]):
                            best = (sym, exp, px, bas)
                if best:
                    sym, exp, px, bas = best
                    in_pos = (sym, exp, px, spot[t], px[t])
                    ncyc += 1
            if in_pos:                       # position ouverte en fin de fenêtre
                pnl += mtm_path - COST_CYCLE
                captured.append(mtm_path - COST_CYCLE)
            ann = pnl / years * 100
            med = np.median(captured) * 100 if captured else float('nan')
            share = invested / len(eval_days) * 100
            verdict = 'BAT la réf ✓' if ann > REF[base] else 'sous la réf ✗'
            print(f'S≥{S * 100:4.0f}%/an : {ncyc:2d} cycles, méd/cycle {med:+5.2f}%, '
                  f'investi {share:4.1f}% du temps, pire MTM {worst_mtm * 100:+5.1f}%, '
                  f'net effectif {ann:+5.2f}%/an → {verdict}')


if __name__ == '__main__':
    main()
