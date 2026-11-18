import type { Subscribable } from "biplane-shared/sim/bus.ts";
import type { Vec2 } from "biplane-shared/sim/vector.ts";

// Спливаючі «+N» над місцем, де збили хмарку. Підписаний на шину, sim про HUD нічого не знає.
const LIFE_MS = 900;
const RISE = 70; // на скільки пікселів арени підіймається напис
const MAX_POPUPS = 30;

// Усе, що HUD бере з шини: подія scored (решта її detail йому не потрібна).
export type HudEvents = {
	readonly scored: { readonly delta: number; readonly at: Vec2 };
};

interface Theme {
	readonly fill: string;
	readonly stroke: string;
	readonly font: string;
}

// Тема з CSS-змінних. Без document (тести в Node) беремо значення за замовчуванням.
const DEFAULT_THEME: Theme = {
	fill: "#3d8ee8",
	stroke: "rgba(255, 255, 255, 0.9)",
	font: "ui-monospace, Consolas, monospace",
};

function readTheme(): Theme {
	if (typeof document === "undefined") return DEFAULT_THEME;
	const css = getComputedStyle(document.documentElement);
	const get = (name: string, fallback: string): string =>
		css.getPropertyValue(name).trim() || fallback;
	return {
		fill: get("--popup-fill", DEFAULT_THEME.fill),
		stroke: get("--popup-stroke", DEFAULT_THEME.stroke),
		font: get("--popup-font", DEFAULT_THEME.font),
	};
}

interface Popup {
	readonly text: string;
	readonly x: number;
	readonly y: number;
	readonly born: number;
	readonly big: boolean;
}

export function createHud(bus: Subscribable<HudEvents>) {
	const theme = readTheme();
	let popups: Popup[] = [];

	const off = bus.on("scored", ({ delta, at }) => {
		popups.push({
			text: `+${delta}`,
			x: at.x,
			y: at.y,
			born: performance.now(),
			big: delta >= 70, // велика хмарка: більший напис
		});
		if (popups.length > MAX_POPUPS) popups.shift();
	});

	return {
		get count(): number {
			return popups.length;
		},
		// викликається renderer-ом усередині системи координат арени
		draw(ctx: CanvasRenderingContext2D, time: number): void {
			popups = popups.filter((p) => time - p.born < LIFE_MS);
			ctx.save();
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.lineJoin = "round";
			for (const p of popups) {
				const age = Math.max(0, (time - p.born) / LIFE_MS); // 0 → 1
				const ease = 1 - (1 - age) ** 3; // швидко злітає, потім сповільнюється
				const size = (p.big ? 38 : 30) * (1 + 0.25 * (1 - age));
				ctx.globalAlpha = 1 - age * age;
				ctx.font = `bold ${size}px ${theme.font}`;
				ctx.lineWidth = 6;
				ctx.strokeStyle = theme.stroke;
				ctx.strokeText(p.text, p.x, p.y - RISE * ease);
				ctx.fillStyle = theme.fill;
				ctx.fillText(p.text, p.x, p.y - RISE * ease);
			}
			ctx.restore();
		},
		dispose(): void {
			off();
			popups = [];
		},
	};
}

export type Hud = ReturnType<typeof createHud>;
