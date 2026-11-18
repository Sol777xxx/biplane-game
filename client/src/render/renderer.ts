import { ARENA } from "biplane-shared/sim/arena.ts";
import { assertNever } from "biplane-shared/sim/never.ts";
import type { Bullet } from "biplane-shared/sim/objects.ts";
import type { Explosion, Particle } from "../fx.ts";
import type {
	ViewBullet,
	ViewObstacle,
	ViewPickup,
	ViewShip,
} from "../net/snapshotView.ts";
import { type Ctx, context2d } from "./canvas.ts";
import { CLOUDS, drawCloud } from "./clouds.ts";
import { drawExplosion, drawParticle } from "./effects.ts";
import { drawObstacle } from "./obstacles.ts";
import type { PilotId } from "./pilots/types.ts";
import { drawShield, SHIELD_RX, SHIELD_RY } from "./shield.ts";
import { drawBiplane, drawBullet, drawPickup } from "./sprites.ts";

// Усе, що renderer уміє малювати. kind це дискримінант: switch у draw() звужує тип сутності,
// а default: never вимагає гілки для кожного нового виду.
export type Renderable =
	| ViewShip
	| ViewObstacle
	| ViewBullet
	| Bullet
	| ViewPickup
	| Particle
	| Explosion;

// Гра для renderer: сутності за видом (підходить і snapshotView, і fx.view(...)).
export interface RenderGame {
	readonly world: { ofKind(kind: string): Iterable<Renderable> };
}

// Накладка поверх арени (HUD): малюється в координатах арени.
export interface Overlay {
	draw(ctx: Ctx, time: number): void;
}

export interface RendererOptions {
	readonly pilotId?: PilotId;
	readonly overlay?: Overlay | null;
}

const LAYERS: readonly Renderable["kind"][] = [
	"obstacle",
	"pickup",
	"bullet",
	"particle",
	"biplane",
	"explosion",
];

export function createRenderer(
	canvas: HTMLCanvasElement,
	{ pilotId = "empty", overlay = null }: RendererOptions = {},
) {
	const ctx = context2d(canvas);
	const debug = new URLSearchParams(location.search).has("debug");
	let currentPilot = pilotId;
	let scale = 1;
	let offsetX = 0;
	let offsetY = 0;

	function resize(): void {
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
	function lerp(
		prev: number,
		curr: number,
		alpha: number,
		max: number,
	): number {
		if (Math.abs(curr - prev) > max / 2) return curr;
		return prev + (curr - prev) * alpha;
	}

	function drawPlane(
		plane: ViewShip,
		x: number,
		y: number,
		alpha: number,
		time: number,
	): void {
		const pitch = plane.prevPitch + (plane.pitch - plane.prevPitch) * alpha;
		// свій корабель з обраним героєм, чужі без пілота (plane.mine є лише у сутностей зі знімка)
		const pilot = plane.mine === false ? "empty" : currentPilot;
		ctx.save();
		ctx.translate(x, y);
		ctx.scale(plane.facing * 1.6, 1.6); // дзеркалення при русі вліво
		ctx.rotate(pitch);
		drawBiplane(ctx, time, pilot);
		ctx.restore();
		if (plane.effects.shield > 0) {
			// центр спрайта зміщений до хвоста, при дзеркаленні зміщення теж
			drawShield(
				ctx,
				x - 4 * plane.facing,
				y - 8,
				SHIELD_RX,
				SHIELD_RY,
				time,
				plane.effects.shield,
			);
		}
	}

	// коло зіткнення: лише для налагодження (?debug)
	function drawHitbox(e: Renderable, x: number, y: number): void {
		ctx.strokeStyle = "rgba(255, 0, 100, 0.8)";
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(x, y, e.radius, 0, Math.PI * 2);
		ctx.stroke();
	}

	function draw(game: RenderGame, alpha: number, time: number): void {
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
				switch (e.kind) {
					case "obstacle":
						drawObstacle(ctx, e, x, y, time);
						break;
					case "pickup":
						drawPickup(ctx, e, x, y, time);
						break;
					case "bullet":
						drawBullet(ctx, e, x, y);
						break;
					case "particle":
						drawParticle(ctx, e, x, y);
						break;
					case "explosion":
						drawExplosion(ctx, e, x, y);
						break;
					case "biplane":
						drawPlane(e, x, y, alpha, time);
						break;
					default:
						assertNever(e, "вид сутності");
				}
				if (debug && e.radius > 0) drawHitbox(e, x, y);
			}
		}

		overlay?.draw(ctx, time);
		ctx.restore();
	}

	window.addEventListener("resize", resize);
	resize();

	return {
		draw,
		resize,
		setPilot(id: PilotId): void {
			currentPilot = id;
		},
	};
}
