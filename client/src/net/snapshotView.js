import { eventFromWire } from "./events.js";

// радіуси дублюють shared/sim (Biplane, Bullet, Pickup); збіг стереже тест
export const SHIP_RADIUS = 46;
export const BULLET_RADIUS = 8;
export const PICKUP_RADIUS = 28;

const pt = (x, y) => ({ x, y });

// Сутності мають поля sim, які читає renderer. Інтерполяції ще немає: prevPos = pos.
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

// Те, що клієнт знає про гру: останній знімок сервера.
// you() це id цього гравця; local() це передбачений корабель (або null): його рух
// підміняє рух свого корабля зі знімка, решта полів лишається зі знімка.
export function createSnapshotView({
	you = () => null,
	local = () => null,
} = {}) {
	const bus = new EventTarget();
	let byKind = new Map();
	let players = new Map();
	let tick = 0;
	let ack = 0;

	return {
		bus,
		world: {
			*ofKind(kind) {
				const list = byKind.get(kind) ?? [];
				if (kind !== "biplane") {
					yield* list;
					return;
				}
				const p = local();
				for (const e of list) {
					if (e.mine && p) {
						e.pos = pt(p.pos.x, p.pos.y);
						e.prevPos = pt(p.prevPos.x, p.prevPos.y);
						e.vel = pt(p.vel.x, p.vel.y);
						e.pitch = p.pitch;
						e.prevPitch = p.prevPitch;
						e.facing = p.facing;
					}
					yield e;
				}
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

		// свій корабель (null, поки загиблий) і свої лічильники
		me() {
			const id = you();
			const mine = (byKind.get("biplane") ?? []).find((s) => s.player === id);
			return { ship: mine ?? null, player: players.get(id) ?? null };
		},
	};
}
