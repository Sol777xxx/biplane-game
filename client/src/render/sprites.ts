import type { PickupType } from "biplane-shared/sim/objects.ts";
import { z } from "zod";
import { drawBiplane as drawBiplaneProc } from "./biplane.ts";
import { type BulletLook, drawBullet as drawBulletProc } from "./bullets.ts";
import { type Ctx, context2d } from "./canvas.ts";
import { drawPickup as drawPickupProc, type PickupLook } from "./effects.ts";
import { HALF, paintBody, setBodySprites, VISUAL_SCALE } from "./obstacles.ts";
import { PILOT_IDS, type PilotId } from "./pilots/index.ts";

// Спрайтшит: файл із маніфесту або запечений у пам'яті з процедурних функцій.
// Усі draw* мають ті самі сигнатури, що й оригінали, тож renderer міняє лише імпорти.

const FORMAT = 1;
const SHEET_W = 2048;
const PAD = 2;
const FRAMES = 4;
// пропелер: |sin(time·0.03)| має період π/0.03, ділимо його на 4 кадри
const FRAME_MS = Math.PI / (4 * 0.03);

const PICKUP_KINDS: readonly PickupType[] = ["shield", "rapid", "homing"];
const CLOUD_RADII = [45, 70]; // як у game.ts

// де в аркуші лежить спрайт і де його якір (ox, oy), q це роздільність запікання
const spriteSchema = z.object({
	x: z.number(),
	y: z.number(),
	w: z.number(),
	h: z.number(),
	ox: z.number(),
	oy: z.number(),
	q: z.number().positive(),
});
type Sprite = z.infer<typeof spriteSchema>;

// sprites.json: форма перевіряється, бо файл прийшов з мережі
export const atlasSchema = z.object({
	version: z.number(),
	image: z.string(),
	sprites: z.record(z.string(), spriteSchema),
});

interface Sheet {
	readonly image: CanvasImageSource;
	readonly sprites: Readonly<Record<string, Sprite>>;
}

let sheet: Sheet | null = null;

// ---------- опис того, що пакуємо ----------
// draw(g, q): g уже обрізаний по комірці й зсунутий в точку-якір, у пікселях
interface Item {
	readonly name: string;
	readonly w: number;
	readonly h: number;
	readonly ox: number;
	readonly oy: number;
	readonly q: number;
	draw(g: Ctx, q: number): void;
}

// Item, якому призначено місце в аркуші (піксельні розміри pw, ph)
interface Placed extends Item {
	readonly x: number;
	readonly y: number;
	readonly pw: number;
	readonly ph: number;
}

function definitions(): Item[] {
	const list: Item[] = [];

	for (const id of PILOT_IDS) {
		for (let k = 0; k < FRAMES; k++) {
			list.push({
				name: `biplane:${id}:${k}`,
				w: 148,
				h: 88,
				ox: 84,
				oy: 52,
				q: 3,
				draw(g, q) {
					g.scale(q, q);
					drawBiplaneProc(g, k * FRAME_MS, id);
				},
			});
		}
	}

	list.push({
		name: "bullet",
		w: 48,
		h: 48,
		ox: 24,
		oy: 24,
		q: 3,
		draw(g, q) {
			g.scale(q, q);
			// ttl 0 і нульова швидкість: чисте тіло серця без пульсації й хвоста
			drawBulletProc(g, { ttl: 0, vel: { x: 0, y: 0 } }, 0, 0);
		},
	});

	for (const type of PICKUP_KINDS) {
		list.push({
			name: `pickup:${type}`,
			w: 76,
			h: 76,
			ox: 38,
			oy: 38,
			q: 2,
			draw(g, q) {
				g.scale(q, q);
				drawPickupProc(g, { life: 1, radius: 28, type }, 0, 0, 0);
			},
		});
	}

	for (const radius of CLOUD_RADII) {
		const r = radius * VISUAL_SCALE;
		list.push({
			name: `cloud:${radius}`,
			w: 2 * HALF * r,
			h: 2 * HALF * r,
			ox: HALF * r,
			oy: HALF * r,
			q: 2,
			draw(g, q) {
				paintBody(g, r * q); // без scale: тіні хмарки малюються в потрібній роздільності
			},
		});
	}

	return list;
}

// «поличкове» пакування: рядки за спаданням висоти; повертає розміщені елементи й висоту аркуша
function layout(items: readonly Item[]): { placed: Placed[]; height: number } {
	let x = 0;
	let y = 0;
	let rowH = 0;
	const placed: Placed[] = [];
	const sorted = [...items].sort((a, b) => b.h * b.q - a.h * a.q);
	for (const it of sorted) {
		const pw = Math.ceil(it.w * it.q);
		const ph = Math.ceil(it.h * it.q);
		if (x + pw + PAD > SHEET_W) {
			x = 0;
			y += rowH + PAD;
			rowH = 0;
		}
		placed.push({ ...it, x, y, pw, ph });
		x += pw + PAD;
		rowH = Math.max(rowH, ph);
	}
	return { placed, height: y + rowH + PAD };
}

function bake(): { image: HTMLCanvasElement; sprites: Record<string, Sprite> } {
	const { placed, height } = layout(definitions());

	const canvas = document.createElement("canvas");
	canvas.width = SHEET_W;
	canvas.height = height;
	const g = context2d(canvas);

	const sprites: Record<string, Sprite> = {};
	for (const it of placed) {
		g.save();
		g.beginPath();
		g.rect(it.x, it.y, it.pw, it.ph);
		g.clip();
		g.translate(it.x + it.ox * it.q, it.y + it.oy * it.q);
		it.draw(g, it.q);
		g.restore();
		sprites[it.name] = {
			x: it.x,
			y: it.y,
			w: it.pw,
			h: it.ph,
			ox: it.ox,
			oy: it.oy,
			q: it.q,
		};
	}
	return { image: canvas, sprites };
}

// ---------- ініціалізація ----------
// assets: результат loadAll; spritesheet (ImageBitmap) і atlas (JSON) можуть бути відсутні
export function initSprites(assets: Readonly<Record<string, unknown>>): {
	source: string;
	count: number;
} {
	let source = "файл";
	const atlas = atlasSchema.safeParse(assets.atlas);
	if (assets.spritesheet instanceof ImageBitmap && atlas.success) {
		sheet = { image: assets.spritesheet, sprites: atlas.data.sprites };
	} else {
		sheet = bake();
		source = "запечений у пам'яті (файлів немає)";
	}
	setBodySprites(drawCloudBody);
	return { source, count: Object.keys(sheet.sprites).length };
}

// ?bake: завантажує sprites.png і sprites.json, їх кладемо в public/assets/
export function downloadSheet(): void {
	const b = bake();
	b.image.toBlob((blob) => {
		if (blob) save(blob, "sprites.png");
	});
	setTimeout(() => {
		const json = JSON.stringify(
			{ version: FORMAT, image: "sprites.png", sprites: b.sprites },
			null,
			"\t",
		);
		save(new Blob([json], { type: "application/json" }), "sprites.json");
	}, 300);
}

function save(blob: Blob, name: string): void {
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- малювання ----------
function get(name: string): Sprite | undefined {
	return sheet?.sprites[name];
}

// малює у (0, 0) поточної системи координат
function blit(ctx: Ctx, s: Sprite): void {
	if (!sheet) return;
	ctx.drawImage(
		sheet.image,
		s.x,
		s.y,
		s.w,
		s.h,
		-s.ox,
		-s.oy,
		s.w / s.q,
		s.h / s.q,
	);
}

function drawCloudBody(ctx: Ctx, radius: number): boolean {
	const s = get(`cloud:${radius}`);
	if (!s) return false; // невідомий розмір: obstacles.ts малює сам
	blit(ctx, s);
	return true;
}

export function drawBiplane(ctx: Ctx, time: number, pilotId: PilotId): void {
	const k = Math.floor(time / FRAME_MS) % FRAMES;
	const s = get(`biplane:${pilotId}:${k}`);
	if (!s) {
		drawBiplaneProc(ctx, time, pilotId);
		return;
	}
	blit(ctx, s);
}

export function drawBullet(
	ctx: Ctx,
	b: BulletLook,
	x: number,
	y: number,
): void {
	const s = get("bullet");
	if (!s) {
		drawBulletProc(ctx, b, x, y);
		return;
	}

	const beat = 1 + 0.08 * Math.sin(b.ttl * 24);
	const tilt = Math.sin(b.ttl * 12) * 0.18;

	// хвіст: той самий спрайт, менший і напівпрозорий
	for (let i = 3; i >= 1; i--) {
		const k = i * 0.028;
		const f = (0.62 - i * 0.12) * beat;
		ctx.save();
		ctx.translate(x - b.vel.x * k, y - b.vel.y * k);
		ctx.globalAlpha = 0.5 - i * 0.12;
		ctx.scale(f, f);
		blit(ctx, s);
		ctx.restore();
	}

	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(tilt);
	ctx.scale(beat, beat);
	blit(ctx, s);
	ctx.restore();
}

export function drawPickup(
	ctx: Ctx,
	e: PickupLook,
	x: number,
	y: number,
	time: number,
): void {
	const s = get(`pickup:${e.type}`);
	if (!s) {
		drawPickupProc(ctx, e, x, y, time);
		return;
	}
	if (e.life < 0.25 && Math.floor(time / 120) % 2 === 0) return;

	ctx.save();
	ctx.translate(x, y + Math.sin(time * 0.004) * 4);
	ctx.rotate(Math.sin(time * 0.003) * 0.12);
	blit(ctx, s);
	ctx.restore();
}
