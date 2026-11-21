### after-native

| Показник | Значення |
|---|---|
| Кадр (робота update+render), p50 / p95 / p99 | 1.3 / 2.5 / 3.6 мс |
| Кадрів довших за 16,7 мс | 0 з 1515 |
| simulate, p50 / p99 | 0.1 / 0.5 мс (n=935) |
| render, p50 / p99 | 1.2 / 3.2 мс (n=1515) |
| decode, p50 / p99 | 0.1 / 0.2 мс (n=968) |
| reconcile, p50 / p99 | 0 / 0.2 мс (n=936) |
| Паузи minor GC | 17 шт., разом 17.7 мс, макс 3.1 мс |
| Паузи major GC | 9 шт., разом 44.1 мс, макс 24.4 мс |
| Час у GC за профілем CPU | 60 мс з 29946.9 мс активного |


Major GC докладно (час від початку, тривалість, причина, купа до → після):

- 1.9 с, 24.5 мс, «finalize incremental marking via stack guard», 7.7 → 4.3 МБ
- 5 с, 4.1 мс, «finalize incremental marking via task», 7.3 → 4.2 МБ
- 8.6 с, 2.3 мс, «finalize incremental marking via stack guard», 7.2 → 4.4 МБ
- 10.9 с, 2 мс, «finalize incremental marking via task», 7 → 4.3 МБ
- 15.4 с, 2.4 мс, «finalize incremental marking via stack guard», 12.3 → 4.5 МБ
- 18.5 с, 2 мс, «finalize incremental marking via task», 9.2 → 4.5 МБ
- 20.1 с, 3.1 мс, «finalize incremental marking via stack guard», 10.4 → 4.5 МБ
- 25 с, 2.3 мс, «finalize incremental marking via stack guard», 12.2 → 4.6 МБ
- 28.1 с, 1.8 мс, «finalize incremental marking via task», 8.9 → 4.5 МБ

Топ-3 за власним часом:

1. drawImage: 250.8 мс (0.8%)
1. curve index-DVSpvM2K.js:10481: 246.3 мс (0.8%)
1. strokeText: 166.3 мс (0.6%)

Топ-3 за виділеною пам'яттю:

1. drawObstacle index-DVSpvM2K.js:10349: 10384 КБ (12.3%)
1. draw index-DVSpvM2K.js:11430: 5885 КБ (7%)
1. strikeGeometry index-DVSpvM2K.js:10192: 4743 КБ (5.6%)

Сервер: тік p50 / p99 = 0.446 / 1.292 мс
