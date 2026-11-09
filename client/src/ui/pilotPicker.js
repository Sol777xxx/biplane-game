import { drawBiplane } from "../render/biplane.js";
import { PILOTS } from "../render/pilots/index.js";

const W = 40;
const H = 32;

function drawIcon(canvas, pilot) {
	const dpr = window.devicePixelRatio || 1;
	canvas.width = W * dpr;
	canvas.height = H * dpr;
	canvas.style.width = `${W}px`;
	canvas.style.height = `${H}px`;

	const ctx = canvas.getContext("2d");
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

	if (pilot.id === "empty") {
		// повний літак
		ctx.translate(W / 2 - 2, H / 2 + 1);
		ctx.scale(0.25, 0.25);
		drawBiplane(ctx, 0, "empty");
	} else {
		// герой великим планом
		ctx.translate(W / 2, 24);
		ctx.scale(1, 1);
		pilot.draw(ctx, 0);
	}
}

export function createPilotPicker(container, { current, onSelect }) {
	const buttons = new Map();

	function setActive(id) {
		for (const [pilotId, btn] of buttons) {
			btn.classList.toggle("active", pilotId === id);
			btn.setAttribute("aria-pressed", String(pilotId === id));
		}
	}

	// кнопки будуються зі списку PILOTS, тож новий герой з'явиться сам
	for (const pilot of Object.values(PILOTS)) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "pilot-btn";
		btn.title = pilot.name;
		btn.setAttribute("aria-label", pilot.name);

		const canvas = document.createElement("canvas");
		drawIcon(canvas, pilot);
		btn.append(canvas);

		btn.addEventListener("click", () => {
			setActive(pilot.id);
			onSelect(pilot.id);
			btn.blur(); // щоб клавіші керування не «натискали» кнопку
		});

		buttons.set(pilot.id, btn);
		container.append(btn);
	}

	setActive(current);
}
