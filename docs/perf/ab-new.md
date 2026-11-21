### ab-new

| Показник | Значення |
|---|---|
| Кадр (робота update+render), p50 / p95 / p99 | 5.3 / 8.2 / 11.4 мс |
| Кадрів довших за 16,7 мс | 1 з 491 |
| simulate, p50 / p99 | 0.4 / 1.3 мс (n=931) |
| render, p50 / p99 | 4.4 / 9.6 мс (n=491) |
| decode, p50 / p99 | 0.2 / 0.7 мс (n=967) |
| reconcile, p50 / p99 | 0 / 0.4 мс (n=936) |
| Паузи minor GC | 12 шт., разом 22.2 мс, макс 4.9 мс |
| Паузи major GC | 2 шт., разом 15.9 мс, макс 8 мс |
| Час у GC за профілем CPU | 64.9 мс з 30583.9 мс активного |


Major GC докладно (час від початку, тривалість, причина, купа до → після):

- 21.5 с, 8.3 мс, «finalize incremental marking via stack guard», 9.9 → 4.5 МБ
- 33.8 с, 8.3 мс, «finalize incremental marking via stack guard», 11.8 → 4.5 МБ

Топ-3 за власним часом:

1. curve index-EnKbSGBT.js:10566: 279 мс (0.9%)
1. drawImage: 263.6 мс (0.9%)
1. strokeText: 188.8 мс (0.6%)

Топ-3 за виділеною пам'яттю:

1. update index-EnKbSGBT.js:6985: 5868 КБ (10.6%)
1. drawObstacle index-EnKbSGBT.js:10434: 4454 КБ (8.1%)
1. draw index-EnKbSGBT.js:11515: 3596 КБ (6.5%)

Сервер: тік p50 / p99 = 0.327 / 1.983 мс
