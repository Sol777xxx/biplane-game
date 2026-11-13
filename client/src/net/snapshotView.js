import { eventFromWire } from "./events.js";

// Радіуси дублюють shared/sim (Biplane, Bullet, Pickup); збіг стереже тест.
export const SHIP_RADIUS = 46;
export const BULLET_RADIUS = 8;
export const PICKUP_RADIUS = 28;

const pt = (x, y) => ({ x, y });

// Сутності мають ті самі поля, що й у sim, які читає renderer (pos, prevPos, radius, pitch…).
// Інтерполяції ще немає: prevPos дорівнює pos, малюємо рівно те, що прислав сервер.
function ship(s, mine) {
	return {
		id: s.id,
		kind: "biplane",
		mine,
		player: s.player,
		pos: pt(s.x, s.y),
		prevPos: pt(s.x, s.y),
		vel: pt(s.vx, s.vy),
		radius: SHIP_RADIUS,
		pitch: s.pitch,
		prevPitch: s.pitch,
		facing: s.facing,
		hp: s.hp,
		effects: { shield: s.shield, rapid: s.rapid, homing: s.homing },
	};
}

function obstacle(o) {
	return {
		id: o.id,
		kind: "obstacle",
		pos: pt(o.x, o.y),
		prevPos: pt(o.x, o.y),
		vel: pt(o.vx, o.vy),
		radius: o.r,
	};
}

function bullet(b) {
	return {
		id: b.id,
		kind: "bullet",
		owner: b.owner,
		pos: pt(b.x, b.y),
		prevPos: pt(b.x, b.y),
		vel: pt(b.vx, b.vy),
		radius: BULLET_RADIUS,
		ttl: b.ttl,
	};
}

function pickup(p) {
	return {
		id: p.id,
		kind: "pickup",
		type: p.type,
		pos: pt(p.x, p.y),
		prevPos: pt(p.x, p.y),
		radius: PICKUP_RADIUS,
		life: p.life,
	};
}

// Те, що клієнт знає про гру: останній знімок сервера. Світу з правилами тут немає.
// you() повертає id гравця цього клієнта (він змінюється після перепідключення).
export function createSnapshotView({ you = () => null } = {}) {
	const bus = new EventTarget();
	let byKind = new Map();
	let players = new Map();
	let tick = 0;
	let ack = 0;

	return {
		bus,
		// renderer читає world.ofKind(kind), як і в ігровому світі
		world: {
			*ofKind(kind) {
				yield* byKind.get(kind) ?? [];
			},
		},
		get tick() {
			return tick;
		},
		get ack() {
			return ack;
		},
		get players() {
			return players;
		},

		apply(msg) {
			const youId = you();
			players = new Map((msg.players ?? []).map((p) => [p.id, p]));
			byKind = new Map([
				["biplane", (msg.ships ?? []).map((s) => ship(s, s.player === youId))],
				["obstacle", (msg.obstacles ?? []).map(obstacle)],
				["bullet", (msg.bullets ?? []).map(bullet)],
				["pickup", (msg.pickups ?? []).map(pickup)],
			]);
			tick = msg.tick;
			ack = msg.ack ?? 0;
			for (const wire of msg.events ?? []) {
				const ev = eventFromWire(wire);
				if (ev) {
					bus.dispatchEvent(new CustomEvent(ev.type, { detail: ev.detail }));
				}
			}
		},

		// свій корабель (null, поки гравець загиблий) і свої лічильники
		me() {
			const id = you();
			const mine = (byKind.get("biplane") ?? []).find((s) => s.player === id);
			return { ship: mine ?? null, player: players.get(id) ?? null };
		},
	};
}
