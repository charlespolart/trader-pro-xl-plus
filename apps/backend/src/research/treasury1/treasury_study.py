#!/usr/bin/env python3
# treasury1 : politiques de capital A/B/C selon le LOG (pré-enregistré).
# A = statu quo ; B = poche carry dédiée x% (coût d'opportunité en coin !) ;
# C = poche recyclée par tranche (parcage du produit de vente pendant la
# fenêtre d'attente, délai 0/7/30 j, péage 0,4 %/cycle, funding ×0,83,
# conversion du yield en coin à la FIN seulement).
#   ACCUM3_STATE ignoré — lit le JSON de extract_cash.ts + PG.
#   python3 treasury_study.py <treasury_trades.json>
import json
import os
import subprocess
import sys

import numpy as np

DB = os.environ.get('DATABASE_URL', 'postgres://tpx:tpx@localhost:5436/tpx')
DAY = 86400000
EFF = 0.83
TOLL = 0.004
DELAYS = (0, 7, 30)
DEDICATED = (0.10, 0.20, 0.30)


def psql_rows(sql):
    p = subprocess.run(['psql', DB, '-q', '-t', '-A', '-c', sql], capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[:300])
    return [r.split('|') for r in p.stdout.strip().splitlines() if r]


def daily_funding(symbol):
    rows = psql_rows(f"SELECT t, rate FROM perp_funding WHERE venue='binance' AND symbol='{symbol}' ORDER BY t")
    t = np.array([int(r[0]) for r in rows], dtype=np.int64)
    rate = np.array([float(r[1]) for r in rows])
    d0, d1 = t[0] // DAY, t[-1] // DAY
    f = np.zeros(int(d1 - d0 + 1))
    np.add.at(f, ((t // DAY) - d0).astype(int), rate)
    return int(d0), f


def daily_close(symbol):
    rows = psql_rows("SELECT open_time, close FROM candles WHERE market='spot' AND symbol="
                     f"'{symbol}' AND interval='1d' ORDER BY open_time")
    t = np.array([int(r[0]) for r in rows], dtype=np.int64) // DAY
    c = np.array([float(r[1]) for r in rows])
    return dict(zip(t.tolist(), c.tolist()))


def study(label, bot, d0f, fund, closes, start_ms, end_ms):
    coin = bot['coin']
    final_coin = bot['finalCoin']
    day_a, day_b = start_ms // DAY, end_ms // DAY
    px_start, px_end = closes[day_a], closes[day_b]
    years = (day_b - day_a) / 365.25
    # richesse quotidienne en coin (coin détenu + cash/px) pour la moyenne
    ndays = int(day_b - day_a + 1)
    cash = np.zeros(ndays)
    held = np.full(ndays, 1.0)
    for tr in bot['trades']:
        a = max(int(tr['entryTime'] // DAY - day_a), 0)
        b = int((tr['exitTime'] // DAY if tr['exitTime'] else day_b) - day_a)
        amt = tr['qty'] * tr['entryPrice']
        cash[a:b] += amt
        held[a:b] -= tr['qty']
    px = np.array([closes.get(int(day_a + i), np.nan) for i in range(ndays)])
    wealth = held + cash / px
    avg_wealth = np.nanmean(wealth)
    idle_frac = np.nanmean((cash / px) / wealth)
    print(f'=== {label} ({coin}) — coin final A = {final_coin:.4f}, richesse moyenne {avg_wealth:.4f} coin, '
          f'cash dormant moyen {idle_frac * 100:.1f}% ===')
    print(f'  {"politique":26} {"coin final":>11} {"uplift":>8} {"équiv./an":>10} {"détail":>34}')
    print(f'  {"A statu quo":26} {final_coin:11.4f} {"—":>8} {"—":>10}')
    # C : recyclée par tranche
    for dly in DELAYS:
        tot_yield, tot_toll, cycles, losers, park_days = 0.0, 0.0, 0, 0, []
        for tr in bot['trades']:
            e = int(tr['entryTime'] // DAY)
            x = int(tr['exitTime'] // DAY) if tr['exitTime'] else int(day_b)
            a = e + dly
            if x - a < 1:
                continue
            amt = tr['qty'] * tr['entryPrice']
            idx0, idx1 = a - d0f, x - d0f
            fsum = fund[max(idx0, 0):max(idx1, 0)].sum()
            y = amt * (fsum * EFF - TOLL)
            tot_yield += amt * fsum * EFF
            tot_toll += amt * TOLL
            cycles += 1
            losers += y < 0
            park_days.append(x - a)
        net_usdt = tot_yield - tot_toll
        up_coin = net_usdt / px_end
        equiv = up_coin / avg_wealth / years * 100
        med = int(np.median(park_days)) if park_days else 0
        print(f'  {"C recyclée d+" + str(dly):26} {final_coin + up_coin:11.4f} {up_coin:+8.4f} {equiv:+9.2f}% '
              f'{cycles:3d} cycles (méd {med:3d} j, {losers} perdants), yield {tot_yield:.0f}$ − péages {tot_toll:.0f}$')
    # B : poche dédiée
    fs = fund[day_a - d0f:day_b - d0f]
    growth = float(np.prod(1 + fs * EFF)) * (1 - TOLL / 2)
    for x in DEDICATED:
        pocket_end = x * px_start * growth
        total = final_coin * (1 - x) + pocket_end / px_end
        up = total - final_coin
        equiv = up / avg_wealth / years * 100
        print(f'  {"B dédiée " + str(int(x * 100)) + "%":26} {total:11.4f} {up:+8.4f} {equiv:+9.2f}% '
              f'poche ×{growth:.3f} en USDT mais coin ×{px_end / px_start:.2f}')
    return final_coin, avg_wealth, years


def main():
    data = json.load(open(sys.argv[1]))
    start_ms, end_ms = data['start'], data['end']
    for label in ('btc-accumulator', 'btc-vrx', 'eth-accumulator'):
        bot = data[label]
        d0f, fund = daily_funding(bot['symbol'])
        closes = daily_close(bot['symbol'])
        study(label, bot, d0f, fund, closes, start_ms, end_ms)
        print()


if __name__ == '__main__':
    main()
