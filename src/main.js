import { createInput } from "./input.js";
import { createLoop } from "./loop.js";
import { createShip, integrate } from "./physics.js";
import { DEFAULT_PILOT, PILOTS } from "./render/pilots/index.js";
import { createRenderer } from "./render/renderer.js";
import { createPilotPicker } from "./ui/pilotPicker.js";

const STORAGE_KEY = "biplane-pilot";

// читання збереженого героя
function loadPilot() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved && PILOTS[saved] ? saved : DEFAULT_PILOT;
  } catch {
    return DEFAULT_PILOT;
  }
}

function savePilot(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // сховище недоступне
  }
}

const canvas = document.querySelector("#game");
const hud = document.querySelector("#hud");

const pilotId = loadPilot();
const input = createInput();
const renderer = createRenderer(canvas, { pilotId });
let ship = createShip();

createPilotPicker(document.querySelector("#pilots"), {
  current: pilotId,
  onSelect(id) {
    renderer.setPilot(id);
    savePilot(id);
  },
});

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