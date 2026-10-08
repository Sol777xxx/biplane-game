import { createInput } from "./input.js";
import { createLoop } from "./loop.js";
import { createShip, integrate } from "./physics.js";
import { DEFAULT_PILOT, PILOTS } from "./render/pilots/index.js";
import { createRenderer } from "./render/renderer.js";
import { createPilotPicker } from "./ui/pilotPicker.js";

const STORAGE_KEY = "biplane-pilot";
const PROBE_SECONDS = 5;

// режим експерименту з адреси: ?exp=block | interval | variable
const exp = new URLSearchParams(location.search).get("exp");

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

// синхронне блокування потоку
function busyWait(ms) {
	const end = performance.now() + ms;
	while (performance.now() < end) {
		// навмисне блокування
	}
}

const canvas = document.querySelector("#game");
const hud = document.querySelector("#hud");

const pilotId = loadPilot();
const input = createInput();
const renderer = createRenderer(canvas, { pilotId });
let ship = createShip();
let probe = null;
let frameCount = 0;

createPilotPicker(document.querySelector("#pilots"), {
	current: pilotId,
	onSelect(id) {
		renderer.setPilot(id);
		savePilot(id);
	},
});

const loop = createLoop({
	mode: exp === "variable" ? "variable" : "fixed",
	driver: exp === "interval" ? "interval" : "raf",
	update(dt) {
		if (input.justPressed("hud")) hud.hidden = !hud.hidden;

		// вимірювання: 5 с симуляційного часу з постійним «вправо»
		if (input.justPressed("probe")) {
			ship = createShip();
			probe = { time: 0, steps: 0 };
		}
		let state = input.snapshot();
		if (probe) state = { ...state, right: true };

		ship = integrate(ship, state, dt);

		if (probe) {
			probe.time += dt;
			probe.steps++;
			if (probe.time >= PROBE_SECONDS) {
				console.log(
					`probe [${exp ?? "fixed"}]: x=${ship.x.toFixed(2)} y=${ship.y.toFixed(2)} steps=${probe.steps}`,
				);
				probe = null;
			}
		}
		input.endStep();
	},
	render(alpha) {
		frameCount++;
		// експеримент 1: блокування 100 мс кожен 60-й кадр
		if (exp === "block" && frameCount % 60 === 0) busyWait(100);
		renderer.draw(ship, alpha, performance.now());
	},
	onStats({ stepsPerSec, framesPerSec, frameMs, minMs, maxMs, jitterMs }) {
		let text =
			`steps/s:  ${stepsPerSec.toFixed(1)}\n` +
			`frames/s: ${framesPerSec.toFixed(1)}\n` +
			`frame:    ${frameMs.toFixed(1)} ms`;

		// додаткові метрики лише в режимах експериментів
		if (exp) {
			text =
				`mode:     ${exp}\n${text}\n` +
				`min/max:  ${minMs.toFixed(1)} / ${maxMs.toFixed(1)} ms\n` +
				`jitter:   ${jitterMs.toFixed(2)} ms`;
		}
		hud.textContent = text;
	},
});

loop.start();
