-- Reconstruction des bougies 3d et 1w spot depuis le 1d (complet, faisant foi).
-- Motif : les fichiers mensuels Vision omettent la bougie multi-jour qui
-- chevauche la fin de mois (12+ bougies 3d manquantes, janvier 2025 entier).
-- Grilles natives Binance : 3d → jour ≡ 1 (mod 3) ; 1w → lundi ≡ 4 (mod 7).
--   psql $DB -f fix3d.sql

BEGIN;

-- contrôle AVANT : snapshot des bougies 3d natives pour vérifier la parité de
-- l'agrégation (les bougies existantes doivent être identiques après rebuild)
CREATE TEMP TABLE chk AS
SELECT symbol, open_time, open, high, low, close, volume, taker_buy_base, close_time
FROM candles WHERE market='spot' AND interval='3d' AND symbol IN ('BTCUSDT','ETHUSDT');

-- ---- 3d ----
DELETE FROM candles WHERE market='spot' AND interval='3d' AND symbol IN ('BTCUSDT','ETHUSDT');

INSERT INTO candles (market, symbol, interval, open_time, open, high, low, close,
                     volume, quote_volume, trades, taker_buy_base, taker_buy_quote, close_time)
SELECT 'spot', symbol, '3d',
       MIN(open_time),
       (ARRAY_AGG(open ORDER BY open_time))[1],
       MAX(high), MIN(low),
       (ARRAY_AGG(close ORDER BY open_time DESC))[1],
       SUM(volume), SUM(quote_volume), SUM(trades), SUM(taker_buy_base), SUM(taker_buy_quote),
       MAX(close_time)
FROM candles
WHERE market='spot' AND interval='1d' AND symbol IN ('BTCUSDT','ETHUSDT')
GROUP BY symbol, (open_time/86400000 - 1) / 3
HAVING COUNT(*) = 3;

DELETE FROM candle_coverage WHERE market='spot' AND interval='3d' AND symbol IN ('BTCUSDT','ETHUSDT');
INSERT INTO candle_coverage (id, market, symbol, "interval", start, "end")
SELECT gen_random_uuid()::text, 'spot', symbol, '3d', MIN(open_time), MAX(open_time) + 259200000
FROM candles WHERE market='spot' AND interval='3d' AND symbol IN ('BTCUSDT','ETHUSDT')
GROUP BY symbol;

-- ---- 1w ----
DELETE FROM candles WHERE market='spot' AND interval='1w' AND symbol IN ('BTCUSDT','ETHUSDT');

INSERT INTO candles (market, symbol, interval, open_time, open, high, low, close,
                     volume, quote_volume, trades, taker_buy_base, taker_buy_quote, close_time)
SELECT 'spot', symbol, '1w',
       MIN(open_time),
       (ARRAY_AGG(open ORDER BY open_time))[1],
       MAX(high), MIN(low),
       (ARRAY_AGG(close ORDER BY open_time DESC))[1],
       SUM(volume), SUM(quote_volume), SUM(trades), SUM(taker_buy_base), SUM(taker_buy_quote),
       MAX(close_time)
FROM candles
WHERE market='spot' AND interval='1d' AND symbol IN ('BTCUSDT','ETHUSDT')
GROUP BY symbol, (open_time/86400000 - 4) / 7
HAVING COUNT(*) = 7;

DELETE FROM candle_coverage WHERE market='spot' AND interval='1w' AND symbol IN ('BTCUSDT','ETHUSDT');
INSERT INTO candle_coverage (id, market, symbol, "interval", start, "end")
SELECT gen_random_uuid()::text, 'spot', symbol, '1w', MIN(open_time), MAX(open_time) + 604800000
FROM candles WHERE market='spot' AND interval='1w' AND symbol IN ('BTCUSDT','ETHUSDT')
GROUP BY symbol;

-- contrôle APRÈS : divergences entre bougies natives (snapshot) et reconstruites
SELECT c.symbol, to_timestamp(c.open_time/1000)::date AS bar,
       k.close AS native_close, c.close AS rebuilt_close,
       k.volume AS native_vol, c.volume AS rebuilt_vol
FROM candles c JOIN chk k ON k.symbol=c.symbol AND k.open_time=c.open_time
WHERE c.market='spot' AND c.interval='3d'
  AND (ABS(c.close-k.close) > 1e-9 OR ABS(c.volume-k.volume) > 0.01
       OR ABS(c.high-k.high) > 1e-9 OR ABS(c.low-k.low) > 1e-9)
LIMIT 20;

-- bilan : nombre de bougies et trous restants
SELECT symbol, interval, COUNT(*) AS n,
       to_timestamp(MIN(open_time)/1000)::date AS first,
       to_timestamp(MAX(open_time)/1000)::date AS last
FROM candles WHERE market='spot' AND interval IN ('3d','1w') AND symbol IN ('BTCUSDT','ETHUSDT')
GROUP BY symbol, interval ORDER BY symbol, interval;

SELECT symbol, interval, COUNT(*) AS gaps FROM (
  SELECT symbol, interval, open_time,
         LEAD(open_time) OVER (PARTITION BY symbol, interval ORDER BY open_time) AS nxt
  FROM candles WHERE market='spot' AND interval IN ('3d','1w') AND symbol IN ('BTCUSDT','ETHUSDT')
) g
WHERE nxt IS NOT NULL AND nxt != open_time + CASE interval WHEN '3d' THEN 259200000 ELSE 604800000 END
GROUP BY symbol, interval;

COMMIT;
