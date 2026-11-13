import { eventFromWire } from "./events.js";

// радіуси дублюють shared/sim (Biplane, Bullet, Pickup); збіг стереже тест
export const SHIP_RADIUS = 46;
export const BULLET_RADIUS = 8;
export const PICKUP_RADIUS = 28;

const pt = (x, y) => ({ x, y });

// сутності мають поля sim, які читає renderer; prevPos = pos (рух кадрами рахує інтерполятор)
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

// Що клієнт знає про гру. you(): id цього гравця; local(): передбачений корабель (або null),
// його рух підміняє рух свого корабля, решта полів зі знімка.
// Без interp: apply() одразу показує знімок і видає його події.
// З interp: apply() лише кладе знімок у буфер, а update(now) у кожному кадрі будує
// сутності для моменту «now − delay» і видає події знімків, до яких дійшов час відтворення.
// Свій корабель у цьому режимі береться з останнього знімка без затримки.
export function createSnapshotView({
	you = () => null,
	local = () => null,
	interp = null,
} = {}) {
	const bus = new EventTarget();
	let byKind = new Map();
	let players = new Map();
	let latest = null;
	let tick = 0;
	let ack = 0;

	const build = (ships, rows) => {
		byKind = new Map([
			["biplane", ships],
			["obstacle", (rows.obstacles ?? []).map(obstacle)],
			["bullet", (rows.bullets ?? []).map(bullet)],
			["pickup", (rows.pickups ?? []).map(pickup)],
		]);
	};

	const emit = (wires = []) => {
		for (const wire of wires) {
			const ev = eventFromWire(wire);
			if (ev)
				bus.dispatchEvent(new CustomEvent(ev.type, { detail: ev.detail }));
		}
	};

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

		// at: час приходу знімка (лише з interp)
		apply(msg, at) {
			players = new Map((msg.players ?? []).map((p) => [p.id, p]));
			tick = msg.tick;
			ack = msg.ack ?? 0;
			if (interp) {
				latest = msg;
				interp.push(msg, at);
				return;
			}
			const id = you();
			build(
				(msg.ships ?? []).map((s) => ship(s, s.player === id)),
				msg,
			);
			emit(msg.events);
		},

		// щокадру (лише з interp)
		update(now) {
			if (!interp || !latest) return;
			const s = interp.sample(now);
			if (s.t === null) return;
			const id = you();
			build(
				[
					...s.ships.filter((r) => r.player !== id).map((r) => ship(r, false)),
					...(latest.ships ?? [])
						.filter((r) => r.player === id)
						.map((r) => ship(r, true)),
				],
				s,
			);
			emit(interp.drain(s.t));
		},

		// після перепідключення: буфер недійсний
		reset() {
			interp?.reset();
			byKind = new Map();
			latest = null;
		},

		// свій корабель (null, поки загиблий) і свої лічильники
		me() {
			const id = you();
			const mine = (byKind.get("biplane") ?? []).find((s) => s.player === id);
			return { ship: mine ?? null, player: players.get(id) ?? null };
		},
	};
}
