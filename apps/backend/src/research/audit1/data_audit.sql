-- audit1/A4 — intégrité des données (base de recherche 5438)
-- psql "postgres://tpx:tpx@localhost:5438/tpx" -f data_audit.sql
\pset pager off
\echo '=== 1. inventaire ==='
SELECT market, symbol, interval, count(*) AS n,
       to_char(to_timestamp(min(open_time)/1000), 'YYYY-MM-DD') AS debut,
       to_char(to_timestamp(max(open_time)/1000), 'YYYY-MM-DD') AS fin
FROM candles GROUP BY 1,2,3 ORDER BY 2,3;

\echo '=== 2. doublons (attendu 0 partout) ==='
SELECT market, symbol, interval, count(*) AS doublons FROM (
  SELECT market, symbol, interval, open_time, count(*) c
  FROM candles GROUP BY 1,2,3,4 HAVING count(*) > 1
) d GROUP BY 1,2,3;

\echo '=== 3. alignement de grille (attendu 0 désalignés) ==='
WITH itv AS (
  SELECT * FROM (VALUES
    ('1h', 3600000::bigint, 0::bigint), ('4h', 14400000, 0), ('1d', 86400000, 0),
    ('3d', 259200000, 86400000), ('1w', 604800000, 345600000)
  ) AS t(interval, ms, anchor)
)
SELECT c.symbol, c.interval, count(*) FILTER (WHERE (c.open_time - i.anchor) % i.ms <> 0) AS desalignes
FROM candles c JOIN itv i ON i.interval = c.interval
GROUP BY 1,2 ORDER BY 1,2;

\echo '=== 4. closeTime = open+itv-1 (attendu 0 violations) ==='
WITH itv AS (
  SELECT * FROM (VALUES
    ('1h', 3600000::bigint), ('4h', 14400000), ('1d', 86400000),
    ('3d', 259200000), ('1w', 604800000)
  ) AS t(interval, ms)
)
SELECT c.symbol, c.interval, count(*) FILTER (WHERE c.close_time <> c.open_time + i.ms - 1) AS violations
FROM candles c JOIN itv i ON i.interval = c.interval
GROUP BY 1,2 ORDER BY 1,2;

\echo '=== 5. cohérence OHLC (attendu 0) ==='
SELECT symbol, interval,
       count(*) FILTER (WHERE high < GREATEST(open, close) OR low > LEAST(open, close) OR high < low) AS ohlc_invalides,
       count(*) FILTER (WHERE open <= 0 OR high <= 0 OR low <= 0 OR close <= 0) AS prix_non_positifs,
       count(*) FILTER (WHERE volume < 0 OR taker_buy_base > volume * (1 + 1e-9)) AS volumes_incoherents,
       count(*) FILTER (WHERE volume = 0) AS volume_zero
FROM candles GROUP BY 1,2 ORDER BY 1,2;

\echo '=== 6. trous sur la grille (n attendu vs présent) ==='
WITH itv AS (
  SELECT * FROM (VALUES
    ('1h', 3600000::bigint), ('4h', 14400000), ('1d', 86400000),
    ('3d', 259200000), ('1w', 604800000)
  ) AS t(interval, ms)
)
SELECT c.symbol, c.interval,
       (max(c.open_time) - min(c.open_time)) / max(i.ms) + 1 AS attendu,
       count(*) AS present,
       (max(c.open_time) - min(c.open_time)) / max(i.ms) + 1 - count(*) AS manquants
FROM candles c JOIN itv i ON i.interval = c.interval
GROUP BY 1,2 ORDER BY 1,2;

\echo '=== 6b. liste des trous 1h/4h/1d (bornes UTC) ==='
WITH itv AS (
  SELECT * FROM (VALUES ('1h', 3600000::bigint), ('4h', 14400000), ('1d', 86400000)) AS t(interval, ms)
), gaps AS (
  SELECT c.symbol, c.interval, c.open_time,
         lead(c.open_time) OVER (PARTITION BY c.symbol, c.interval ORDER BY c.open_time) AS next_open, i.ms
  FROM candles c JOIN itv i ON i.interval = c.interval
)
SELECT symbol, interval,
       to_char(to_timestamp((open_time + ms)/1000), 'YYYY-MM-DD HH24:MI') AS trou_debut,
       to_char(to_timestamp(next_open/1000), 'YYYY-MM-DD HH24:MI') AS trou_fin,
       (next_open - open_time) / ms - 1 AS bougies_manquantes
FROM gaps WHERE next_open - open_time > ms
ORDER BY symbol, interval, open_time;

\echo '=== 7. 3d == agrégat exact du 1d (attendu 0 écarts) ==='
WITH agg AS (
  SELECT symbol,
         ((open_time - 86400000) / 259200000) * 259200000 + 86400000 AS bucket,
         count(*) AS jours,
         (array_agg(open ORDER BY open_time))[1] AS o,
         max(high) AS h, min(low) AS l,
         (array_agg(close ORDER BY open_time DESC))[1] AS c,
         sum(volume) AS v
  FROM candles WHERE interval = '1d' AND market = 'spot'
  GROUP BY 1, 2
)
SELECT c3.symbol,
       count(*) AS n3d,
       count(*) FILTER (WHERE a.bucket IS NULL) AS bucket_absent,
       count(*) FILTER (WHERE a.jours = 3 AND (abs(a.o - c3.open) > 1e-9 OR abs(a.h - c3.high) > 1e-9
         OR abs(a.l - c3.low) > 1e-9 OR abs(a.c - c3.close) > 1e-9 OR abs(a.v - c3.volume) > 1e-6)) AS ecarts
FROM candles c3 LEFT JOIN agg a ON a.symbol = c3.symbol AND a.bucket = c3.open_time
WHERE c3.interval = '3d' AND c3.market = 'spot'
GROUP BY 1;

\echo '=== 8. 1w == agrégat exact du 1d (attendu 0 écarts) ==='
WITH agg AS (
  SELECT symbol,
         ((open_time - 345600000) / 604800000) * 604800000 + 345600000 AS bucket,
         count(*) AS jours,
         (array_agg(open ORDER BY open_time))[1] AS o,
         max(high) AS h, min(low) AS l,
         (array_agg(close ORDER BY open_time DESC))[1] AS c,
         sum(volume) AS v
  FROM candles WHERE interval = '1d' AND market = 'spot'
  GROUP BY 1, 2
)
SELECT cw.symbol,
       count(*) AS n1w,
       count(*) FILTER (WHERE a.bucket IS NULL) AS bucket_absent,
       count(*) FILTER (WHERE a.jours = 7 AND (abs(a.o - cw.open) > 1e-9 OR abs(a.h - cw.high) > 1e-9
         OR abs(a.l - cw.low) > 1e-9 OR abs(a.c - cw.close) > 1e-9 OR abs(a.v - cw.volume) > 1e-6)) AS ecarts
FROM candles cw LEFT JOIN agg a ON a.symbol = cw.symbol AND a.bucket = cw.open_time
WHERE cw.interval = '1w' AND cw.market = 'spot'
GROUP BY 1;

\echo '=== 9. 4h natif Binance == agrégat du 1h (cohérence inter-TF, écarts attendus ~0) ==='
WITH agg AS (
  SELECT symbol, (open_time / 14400000) * 14400000 AS bucket,
         count(*) AS heures,
         (array_agg(open ORDER BY open_time))[1] AS o,
         max(high) AS h, min(low) AS l,
         (array_agg(close ORDER BY open_time DESC))[1] AS c,
         sum(volume) AS v
  FROM candles WHERE interval = '1h' AND market = 'spot'
  GROUP BY 1, 2
)
SELECT c4.symbol,
       count(*) FILTER (WHERE a.heures = 4) AS comparables,
       count(*) FILTER (WHERE a.heures = 4 AND (abs(a.o - c4.open) > 1e-9 OR abs(a.h - c4.high) > 1e-9
         OR abs(a.l - c4.low) > 1e-9 OR abs(a.c - c4.close) > 1e-9)) AS ecarts_ohlc,
       count(*) FILTER (WHERE a.heures = 4 AND abs(a.v - c4.volume) > greatest(1e-6, c4.volume * 1e-9)) AS ecarts_volume
FROM candles c4 LEFT JOIN agg a ON a.symbol = c4.symbol AND a.bucket = c4.open_time
WHERE c4.interval = '4h' AND c4.market = 'spot'
GROUP BY 1;

\echo '=== 10. bougie partielle en tete (la derniere doit etre close) ==='
SELECT symbol, interval,
       to_char(to_timestamp(max(close_time)/1000), 'YYYY-MM-DD HH24:MI:SS') AS derniere_close,
       CASE WHEN max(close_time) > (extract(epoch FROM now()) * 1000)::bigint THEN 'PARTIELLE !' ELSE 'ok' END AS etat
FROM candles GROUP BY 1,2 ORDER BY 1,2;
