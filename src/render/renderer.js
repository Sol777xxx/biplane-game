import { ARENA } from "../sim/arena.js";
import { drawBiplane } from "./biplane.js";
import { CLOUDS, drawCloud } from "./clouds.js";

export function createRenderer(canvas, { pilotId = "empty" } = {}) {
	const ctx = canvas.getContext("2d");
	let currentPilot = pilotId;
	let scale = 1;
	let offsetX = 0;
	let offsetY = 0;

	function resize() {
		const dpr = window.devicePixelRatio || 1;
		const w = window.innerWidth;
		const h = window.innerHeight;

		// розмір буфера у фізичних пікселях
		canvas.width = Math.round(w * dpr);
		canvas.height = Math.round(h * dpr);

		// масштаб і центрування арени
		scale = Math.min(w / ARENA.width, h / ARENA.height);
		offsetX = (w - ARENA.width * scale) / 2;
		offsetY = (h - ARENA.height * scale) / 2;

		// подальше малювання в CSS-пікселях
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	}

	// інтерполяція без стрибка при загортанні країв
	function lerp(prev, curr, alpha, max) {
		if (Math.abs(curr - prev) > max / 2) return curr;
		return prev + (curr - prev) * alpha;
	}

	function draw(plane, alpha, time) {
		ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

		ctx.save();
		ctx.translate(offsetX, offsetY);
		ctx.scale(scale, scale);

		// рамка арени
		ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
		ctx.lineWidth = 6;
		ctx.beginPath();
		ctx.roundRect(0, 0, ARENA.width, ARENA.height, 24);
		ctx.stroke();

		for (const cloud of CLOUDS) drawCloud(ctx, cloud);

		const x = lerp(plane.prevPos.x, plane.pos.x, alpha, ARENA.width);
		const y = lerp(plane.prevPos.y, plane.pos.y, alpha, ARENA.height);
		const pitch = plane.prevPitch + (plane.pitch - plane.prevPitch) * alpha;

		ctx.translate(x, y);
		ctx.scale(plane.facing * 1.6, 1.6); // дзеркалення при русі вліво
		ctx.rotate(pitch);
		drawBiplane(ctx, time, currentPilot);

		ctx.restore();
	}

	window.addEventListener("resize", resize);
	resize();

	return {
		draw,
		resize,
		setPilot(id) {
			currentPilot = id;
		},
	};
}
