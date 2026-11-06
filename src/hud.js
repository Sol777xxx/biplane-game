// Спливаючі «+N» над місцем, де збили хмарку. Підписаний на world.bus, sim про HUD нічого не знає.
const LIFE_MS = 900;
const RISE = 70; // на скільки пікселів арени підіймається напис
const MAX_POPUPS = 30;

// Тема з CSS-змінних. Без document (тести в Node) беремо значення за замовчуванням.
const DEFAULT_THEME = {
	fill: "#3d8ee8",
	stroke: "rgba(255, 255, 255, 0.9)",
	font: "ui-monospace, Consolas, monospace",
};

function readTheme() {
	if (typeof document === "undefined") return DEFAULT_THEME;
	const css = getComputedStyle(document.documentElement);
	const get = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
	return {
		fill: get("--popup-fill", DEFAULT_THEME.fill),
		stroke: get("--popup-stroke", DEFAULT_THEME.stroke),
		font: get("--popup-font", DEFAULT_THEME.font),
	};
}

export function createHud(bus) {
	const theme = readTheme();
	let popups = [];

	function onScored(e) {
		const { delta, at } = e.detail;
		popups.push({
			text: `+${delta}`,
			x: at.x,
			y: at.y,
			born: performance.now(),
			big: delta >= 70, // велика хмарка: більший напис
		});
		if (popups.length > MAX_POPUPS) popups.shift();
	}
	bus.addEventListener("scored", onScored);

	return {
		get count() {
			return popups.length;
		},
		// викликається renderer-ом усередині системи координат арени
		draw(ctx, time) {
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
		dispose() {
			bus.removeEventListener("scored", onScored);
			popups = [];
		},
	};
}
