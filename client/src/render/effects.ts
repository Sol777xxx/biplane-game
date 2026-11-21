import type { PickupType } from "biplane-shared/sim/objects.ts";
import type { ExplosionColor } from "biplane-shared/sim/types.ts";
import type { Ctx } from "./canvas.ts";

const TAU = Math.PI * 2;

const COLORS: Readonly<Record<ExplosionColor, { core: string; edge: string }>> =
	{
		pink: { core: "255, 179, 217", edge: "247, 168, 207" },
		storm: { core: "201, 194, 226", edge: "157, 149, 191" },
	};

const PICKUPS: Readonly<Record<PickupType, { color: string; label: string }>> =
	{
		shield: { color: "#82dcbe", label: "S" },
		rapid: { color: "#ffd27a", label: "R" },
		homing: { color: "#b79fe8", label: "H" },
	};

// частинка: life 1 → 0
export interface Fading {
	readonly color: ExplosionColor;
	readonly life?: number; // 1 → 0, ставить поведінка lifetime
}

// Колір без прозорості, готовий заздалегідь; прозорість іде через globalAlpha.
// Рядок `rgba(…, life)` на кожну частинку кожного кадру створював би тисячі рядків-сміття.
const SOLID: Readonly<Record<ExplosionColor, string>> = {
	pink: `rgb(${COLORS.pink.core})`,
	storm: `rgb(${COLORS.storm.core})`,
};

export function drawParticle(ctx: Ctx, p: Fading, x: number, y: number): void {
	const life = p.life ?? 1;
	ctx.fillStyle = SOLID[p.color];
	// globalAlpha мовчки ігнорує значення поза 0..1, тож обмежуємо самі (як це робив rgba)
	ctx.globalAlpha = Math.max(0, Math.min(1, life));
	ctx.beginPath();
	ctx.arc(x, y, 2 + 4 * life, 0, TAU);
	ctx.fill();
	ctx.globalAlpha = 1;
}

// вибух: спалах + кільце, що розширюється
export function drawExplosion(
	ctx: Ctx,
	e: Fading & { readonly size: number },
	x: number,
	y: number,
): void {
	const c = COLORS[e.color];
	const life = e.life ?? 1;
	const t = 1 - life;
	const r = e.size * (0.4 + 0.9 * t);

	const g = ctx.createRadialGradient(x, y, 0, x, y, r);
	g.addColorStop(0, `rgba(255, 255, 255, ${0.9 * life})`);
	g.addColorStop(0.5, `rgba(${c.core}, ${0.5 * life})`);
	g.addColorStop(1, `rgba(${c.edge}, 0)`);
	ctx.fillStyle = g;
	ctx.beginPath();
	ctx.arc(x, y, r, 0, TAU);
	ctx.fill();

	ctx.strokeStyle = `rgba(${c.edge}, ${life})`;
	ctx.lineWidth = 4 * life + 1;
	ctx.beginPath();
	ctx.arc(x, y, r * 0.9, 0, TAU);
	ctx.stroke();
}

// зірка з n променями; outer — радіус кінчиків, inner — радіус западин
function starPath(
	ctx: Ctx,
	x: number,
	y: number,
	outer: number,
	inner: number,
	n = 5,
	rot = -Math.PI / 2,
): void {
	ctx.beginPath();
	for (let i = 0; i < n * 2; i++) {
		const r = i % 2 === 0 ? outer : inner;
		const a = rot + (i * Math.PI) / n;
		const px = x + Math.cos(a) * r;
		const py = y + Math.sin(a) * r;
		if (i === 0) ctx.moveTo(px, py);
		else ctx.lineTo(px, py);
	}
	ctx.closePath();
}

// pickup: зірка з літерою, блимає перед зникненням
export interface PickupLook {
	readonly type: PickupType;
	readonly life: number;
	readonly radius: number;
}

export function drawPickup(
	ctx: Ctx,
	e: PickupLook,
	x: number,
	y: number,
	time: number,
): void {
	if (e.life < 0.25 && Math.floor(time / 120) % 2 === 0) return;
	const s = PICKUPS[e.type];
	const cy = y + Math.sin(time * 0.004) * 4;
	const spin = Math.sin(time * 0.003) * 0.12; // легке погойдування
	const R = e.radius; // кінчики впритик до хітбокса

	ctx.save();
	ctx.lineJoin = "round";

	// світіння
	starPath(ctx, x, cy, R, R * 0.5, 5, -Math.PI / 2 + spin);
	ctx.strokeStyle = s.color;
	ctx.globalAlpha = 0.35;
	ctx.lineWidth = 10;
	ctx.stroke();
	ctx.globalAlpha = 1;

	// тіло зірки
	ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
	ctx.strokeStyle = s.color;
	ctx.lineWidth = 4;
	starPath(ctx, x, cy, R, R * 0.5, 5, -Math.PI / 2 + spin);
	ctx.fill();
	ctx.stroke();

	// літера
	ctx.fillStyle = s.color;
	ctx.font = "bold 22px ui-monospace, Consolas, monospace";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(s.label, x, cy + 3);

	ctx.restore();
}
