# Biplane Game

Лабораторна робота 3: «Асинхронний JavaScript: Promises, async/await і екран завантаження».

Браузерна гра: пастельний біплан, яким літаєш по арені на canvas.
- [lab-01](https://github.com/Sol777xxx/biplane-game/tree/lab-01): ігровий цикл, фіксований крок, експерименти з event loop.
- [lab-02](https://github.com/Sol777xxx/biplane-game/tree/lab-02): сутності, `World` на `Map`, колізії, кулі, композиція поведінок.

## Запуск

```
npm install
npm run dev
```

Потрібен Node.js 24 (див. `.nvmrc`). Гра: `http://localhost:5173/`.
Перевірка коду: `npx biome check .` · демонстрація `this`-бага: `node demo/this-bug.mjs`.

## Керування

| Клавіша | Дія |
|---|---|
| ← → ↑ ↓ або WASD | рух |
| Пробіл | стрільба |
| H | показати або сховати HUD |
| P | вимірювання (лаба 1): 5 с польоту вправо, результат у консолі |

Героя в кабіні обирають на панелі справа вгорі. Адреса з `?debug` відкриває `window.game` у консолі та показує хітбокси.

## Правила гри

- Хмарки дрейфують і відбиваються від країв; наліт на хмарку знімає 35 HP і знищує її.
- Кулі шкодять хмаркам (знищується за 2–3 влучання, очки = радіус) і кораблям. Біплан не виходить за арену, а куля за межею зникає.
- Знищений біплан вибухає й відроджується через 2 с у безпечній точці зі щитом на 2 с.
- Pickup'и (зірки): **S** щит, **R** швидкострільність, **H** самонавідні кулі. Частина хмарок наводиться на біплан (закоментоване пунктирне кільце для демонстрації).

## Архітектура

```
demo/
  this-bug.mjs   відтворення і фікс бага з this
src/
  loop.js      ігровий цикл (rAF + акумулятор)
  input.js     клавіатура як замикання
  main.js      збірка та HUD
  sim/         модель світу без DOM:
    vector.js    Vector2 (чисті методи)
    entity.js    базовий Entity, #id, behaviors, краї арени
    biplane.js   Biplane extends Entity, #hp, fire()
    objects.js   Bullet, Obstacle, Explosion, Pickup, createParticle
    behaviors.js homing, lifetime, drag, pickup (композиція)
    world.js     Map<id, Entity>, spawn/despawn/sweep, ofKind
    collision.js коло-коло, окрема система
    game.js      правила: рахунок, респаун, pickup'и
  render/      малювання на canvas
  ui/          панель вибору героя
```

Успадкування лише на один рівень: `Biplane`, `Bullet`, `Obstacle`, `Explosion`, `Pickup` розширюють `Entity`.
Частинки окремого класу не мають: це `Entity` з поведінками `lifetime` і `drag`.

