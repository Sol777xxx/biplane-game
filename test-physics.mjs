import { createShip, integrate } from "./src/physics.js";

let ship = createShip();
for (let i = 0; i < 60; i++) {
  ship = integrate(ship, { up: true, left: false, right: false }, 1 / 60);
}
console.log(ship);