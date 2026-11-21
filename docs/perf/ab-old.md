### ab-old

| Показник | Значення |
|---|---|
| Кадр (робота update+render), p50 / p95 / p99 | 5.2 / 8.3 / 10 мс |
| Кадрів довших за 16,7 мс | 2 з 511 |
| simulate, p50 / p99 | 0.4 / 1.3 мс (n=942) |
| render, p50 / p99 | 4.4 / 8.4 мс (n=511) |
| decode, p50 / p99 | 0.2 / 0.8 мс (n=976) |
| reconcile, p50 / p99 | 0 / 0.4 мс (n=945) |
| Паузи minor GC | 11 шт., разом 22.1 мс, макс 4.6 мс |
| Паузи major GC | 2 шт., разом 29.3 мс, макс 20.8 мс |
| Час у GC за профілем CPU | 57.1 мс з 30723.3 мс активного |


Major GC докладно (час від початку, тривалість, причина, купа до → після):

- 23 с, 21 мс, «finalize incremental marking via stack guard», 11.5 → 4.5 МБ
- 31 с, 9.7 мс, «finalize incremental marking via stack guard», 11.8 → 4.5 МБ

Топ-3 за власним часом:

1. curve index-EnKbSGBT.js:10566: 288.6 мс (0.9%)
1. drawImage: 283.3 мс (0.9%)
1. strokeText: 188.2 мс (0.6%)

Топ-3 за виділеною пам'яттю:

1. drawObstacle index-EnKbSGBT.js:10434: 4912 КБ (9.3%)
1. step index-EnKbSGBT.js:675: 3851 КБ (7.3%)
1. update index-EnKbSGBT.js:6985: 3531 КБ (6.7%)

Сервер: тік p50 / p99 = 0.314 / 0.442 мс
