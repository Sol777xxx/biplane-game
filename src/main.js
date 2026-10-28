import { createInput } from "./input.js";
import { createLoop } from "./loop.js";
import { DEFAULT_PILOT, PILOTS } from "./render/pilots/index.js";
import { createRenderer } from "./render/renderer.js";
import { Biplane } from "./sim/biplane.js";
import { Game } from "./sim/game.js";
import { createPilotPicker } from "./ui/pilotPicker.js";

const STORAGE_KEY = "biplane-pilot";
const PROBE_SECONDS = 5;

const params = new URLSearchParams(location.search);
// режим експерименту з адреси: ?exp=block | interval | variable
const exp = params.get("exp");

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
const status = document.querySelector("#status");
const fireBtn = document.querySelector("#fire-btn");

const pilotId = loadPilot();
const input = createInput();
const renderer = createRenderer(canvas, { pilotId });
const game = new Game();
let probe = null; // вимірювання: окремий біплан поза світом
let frameCount = 0;
let lastStatus = "";

// доступ із консолі для експериментів: ?debug
if (params.has("debug")) window.game = game;

createPilotPicker(document.querySelector("#pilots"), {
	current: pilotId,
	onSelect(id) {
		renderer.setPilot(id);
		savePilot(id);
	},
});

// БАГ this: fireBtn.addEventListener("click", game.plane.fire);
// слухач викликає функцію без об'єкта, тому this стає кнопкою і постріл не відбувається.
// Фікс: стрілка, що бере поточний біплан у момент кліку
fireBtn.addEventListener("click", () => {
	game.plane.fire();
	fireBtn.blur(); // щоб пробіл не «натискав» кнопку
});

const loop = createLoop({
	mode: exp === "variable" ? "variable" : "fixed",
	driver: exp === "interval" ? "interval" : "raf",
	update(dt) {
		if (input.justPressed("hud")) hud.hidden = !hud.hidden;

		// вимірювання: 5 с симуляційного часу з постійним «вправо»
		if (input.justPressed("probe")) {
			probe = { plane: new Biplane(), time: 0, steps: 0 };
		}
		if (probe) {
			probe.plane.update(dt, { right: true });
			probe.time += dt;
			probe.steps++;
			if (probe.time >= PROBE_SECONDS) {
				console.log(
					`probe [${exp ?? "fixed"}]: x=${probe.plane.pos.x.toFixed(2)} y=${probe.plane.pos.y.toFixed(2)} steps=${probe.steps}`,
				);
				probe = null;
			}
		}

		game.step(dt, input.snapshot());
		input.endStep();
	},
	render(alpha) {
		frameCount++;
		// експеримент 1: блокування 100 мс кожен 60-й кадр
		if (exp === "block" && frameCount % 60 === 0) busyWait(100);
		renderer.draw(game, alpha, performance.now());

		const p = game.plane;
		const fx = Object.entries(p.effects)
			.filter(([, t]) => t > 0)
			.map(([name, t]) => `${name} ${Math.ceil(t)}`)
			.join(" ");
		const text =
			`HP: ${p.alive ? p.hp : "—"}   рахунок: ${game.score}   ` +
			`збито: ${game.destroyed}   зіткнень: ${game.crashes}` +
			(fx ? `   [${fx}]` : "");
		if (text !== lastStatus) {
			status.textContent = text;
			lastStatus = text;
		}
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
