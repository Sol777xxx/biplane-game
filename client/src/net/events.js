// Подія з мережі (eventToWire на сервері) назад у форму, яку чекають підписники шини
// (audio, hud, fx). Невідоме або зламане дає null: навіть косметиці з мережі не довіряємо наосліп.
const MAX_PARTICLES = 80; // сервер шле до 50; стеля захищає від зламаного знімка

const num = (v) => typeof v === "number" && Number.isFinite(v);
const str = (v) => typeof v === "string";
const point = (w) => (num(w.x) && num(w.y) ? { x: w.x, y: w.y } : null);
const who = (w) => (str(w.player) ? w.player : null);

export function eventFromWire(w) {
	if (typeof w !== "object" || w === null) return null;
	const at = point(w);
	switch (w.type) {
		case "fired":
			return at && { type: "fired", detail: { by: { playerId: who(w) }, at } };
		case "hit":
			return at && str(w.kind)
				? { type: "hit", detail: { at, target: { kind: w.kind } } }
				: null;
		case "exploded": {
			if (!(at && str(w.kind) && num(w.size) && str(w.color))) return null;
			const count = num(w.count)
				? Math.min(MAX_PARTICLES, Math.max(0, Math.round(w.count)))
				: 0;
			return {
				type: "exploded",
				detail: { kind: w.kind, pos: at, size: w.size, color: w.color, count },
			};
		}
		case "scored":
			return at && num(w.delta)
				? { type: "scored", detail: { player: who(w), delta: w.delta, at } }
				: null;
		case "pickup":
			return str(w.pickup)
				? { type: "pickup", detail: { type: w.pickup, player: who(w) } }
				: null;
		case "crash":
			return at && { type: "crash", detail: { player: who(w), at } };
		case "respawned":
			return at && { type: "respawned", detail: { player: who(w), at } };
		default:
			return null;
	}
}
