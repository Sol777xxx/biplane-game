import { ARENA } from "../sim/arena.js";
import { drawBiplane } from "./biplane.js";
import { CLOUDS, drawCloud } from "./clouds.js";
import { drawObstacle } from "./obstacles.js";

// порядок шарів: що пізніше, те зверху
const LAYERS = ["obstacle", "biplane"];

export function createRenderer(canvas, { pilotId = "empty" } = {}) {
	const ctx = canvas.getContext("2d");
	const debug = new URLSearchParams(location.search).has("debug");
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

	function drawPlane(plane, x, y, alpha, time) {
		const pitch = plane.prevPitch + (plane.pitch - plane.prevPitch) * alpha;
		ctx.save();
		ctx.translate(x, y);
		ctx.scale(plane.facing * 1.6, 1.6); // дзеркалення при русі вліво
		ctx.rotate(pitch);
		drawBiplane(ctx, time, currentPilot);
		ctx.restore();
	}

	// коло зіткнення: лише для налагодження (?debug)
	function drawHitbox(e, x, y) {
		ctx.strokeStyle = "rgba(255, 0, 100, 0.8)";
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(x, y, e.radius, 0, Math.PI * 2);
		ctx.stroke();
	}

	function draw(game, alpha, time) {
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

		for (const kind of LAYERS) {
			for (const e of game.world.ofKind(kind)) {
				const x = lerp(e.prevPos.x, e.pos.x, alpha, ARENA.width);
				const y = lerp(e.prevPos.y, e.pos.y, alpha, ARENA.height);
				if (kind === "obstacle") drawObstacle(ctx, e, x, y, time);
				else if (kind === "biplane") drawPlane(e, x, y, alpha, time);
				if (debug) drawHitbox(e, x, y);
			}
		}

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