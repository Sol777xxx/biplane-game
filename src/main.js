import { createInput } from "./input.js";
import { createLoop } from "./loop.js";
import { createShip, integrate } from "./physics.js";
import { createRenderer } from "./render/renderer.js";

const canvas = document.querySelector("#game");
const hud = document.querySelector("#hud");

const input = createInput();
const renderer = createRenderer(canvas, { pilotId: "empty" });
let ship = createShip();

const loop = createLoop({
  update(dt) {
    ship = integrate(ship, input.snapshot(), dt);
  },
  render(alpha) {
    renderer.draw(ship, alpha, performance.now());
  },
  onStats({ stepsPerSec, framesPerSec, frameMs }) {
    hud.textContent =
      `steps/s:  ${stepsPerSec.toFixed(1)}\n` +
      `frames/s: ${framesPerSec.toFixed(1)}\n` +
      `frame:    ${frameMs.toFixed(1)} ms`;
  },
});

loop.start();