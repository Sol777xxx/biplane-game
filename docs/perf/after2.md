### after2

| Показник | Значення |
|---|---|
| Кадр (робота update+render), p50 / p95 / p99 | 4.9 / 8.7 / 17.1 мс |
| Кадрів довших за 16,7 мс | 5 з 497 |
| simulate, p50 / p99 | 0.3 / 1.5 мс (n=935) |
| render, p50 / p99 | 4.2 / 14.7 мс (n=497) |
| decode, p50 / p99 | 0.2 / 0.8 мс (n=969) |
| reconcile, p50 / p99 | 0 / 0.4 мс (n=938) |
| Паузи minor GC | 9 шт., разом 19.9 мс, макс 4.9 мс |
| Паузи major GC | 2 шт., разом 16.5 мс, макс 10 мс |
| Час у GC за профілем CPU | 64.8 мс з 30094.4 мс активного |


Major GC докладно (час від початку, тривалість, причина, купа до → після):

- 21.9 с, 10.4 мс, «finalize incremental marking via stack guard», 15.6 → 4.5 МБ
- 30.9 с, 6.9 мс, «finalize incremental marking via stack guard», 8.9 → 4.5 МБ

Топ-3 за власним часом:

1. drawImage: 292.1 мс (1%)
1. curve index-DVSpvM2K.js:10481: 260.2 мс (0.9%)
1. strokeText: 214 мс (0.7%)

Топ-3 за виділеною пам'яттю:

1. drawObstacle index-DVSpvM2K.js:10349: 4078 КБ (7.8%)
1. draw index-DVSpvM2K.js:11430: 3267 КБ (6.2%)
1. update index-DVSpvM2K.js:168: 2426 КБ (4.6%)

Сервер: тік p50 / p99 = 0.318 / 0.523 мс
