import type {
	BulletSnapshot,
	ObstacleSnapshot,
	PickupSnapshot,
	PlayerSnapshot,
	ShipSnapshot,
	Snapshot,
	WireEvent,
} from "../protocol/index.ts";
import type { Game } from "./game.ts";
import type { BusEvents } from "./types.ts";

// Знімок стану для мережі: JSON-сумісний об'єкт. Порядок сутностей збігається з порядком
// створення. Координати округлені до 0.01: без цього JSON роздувся б 17-значними числами.
// Типи знімка виведені зі схем Zod у shared/protocol: вони одні для сервера, клієнта й кодеків.
export type {
	BulletSnapshot,
	ObstacleSnapshot,
	PickupSnapshot,
	PlayerSnapshot,
	ShipSnapshot,
	Snapshot,
	WireEvent,
};

// Сутності знімка в одному списку, кожна з полем kind (те саме, що в сутностей симуляції).
// Формат у мережі не змінюється: kind додаємо лише тут, під час обходу.
export type SnapshotEntity =
	| ({ readonly kind: "biplane" } & ShipSnapshot)
	| ({ readonly kind: "obstacle" } & ObstacleSnapshot)
	| ({ readonly kind: "bullet" } & BulletSnapshot)
	| ({ readonly kind: "pickup" } & PickupSnapshot);

export function* entitiesOf(snapshot: Snapshot): Generator<SnapshotEntity> {
	for (const e of snapshot.ships) yield { kind: "biplane", ...e };
	for (const e of snapshot.obstacles) yield { kind: "obstacle", ...e };
	for (const e of snapshot.bullets) yield { kind: "bullet", ...e };
	for (const e of snapshot.pickups) yield { kind: "pickup", ...e };
}

const round = (v: number, digits: number): number => {
	const k = 10 ** digits;
	return Math.round(v * k) / k;
};
const r2 = (v: number): number => round(v, 2);

export function takeSnapshot(game: Game): Snapshot {
	const players: PlayerSnapshot[] = [];
	const ships: ShipSnapshot[] = [];
	for (const p of game.players.values()) {
		players.push({
			id: p.id,
			score: p.score,
			destroyed: p.destroyed,
			crashes: p.crashes,
			deaths: p.deaths,
		});
		const e = p.plane;
		if (!e?.alive) continue; // загиблого корабля в знімку немає до відродження
		ships.push({
			id: e.id,
			player: p.id,
			x: r2(e.pos.x),
			y: r2(e.pos.y),
			vx: r2(e.vel.x),
			vy: r2(e.vel.y),
			pitch: round(e.pitch, 4),
			facing: e.facing,
			hp: e.hp,
			cooldown: round(e.cooldown, 3),
			shield: r2(e.effects.shield),
			rapid: r2(e.effects.rapid),
			homing: r2(e.effects.homing),
		});
	}

	const obstacles: ObstacleSnapshot[] = [];
	for (const e of game.world.ofKind("obstacle")) {
		if (!e.alive) continue;
		obstacles.push({
			id: e.id,
			x: r2(e.pos.x),
			y: r2(e.pos.y),
			vx: r2(e.vel.x),
			vy: r2(e.vel.y),
			r: e.radius,
		});
	}

	const bullets: BulletSnapshot[] = [];
	for (const e of game.world.ofKind("bullet")) {
		if (!e.alive) continue;
		bullets.push({
			id: e.id,
			owner: e.owner?.playerId ?? null,
			seq: e.seq, // seq input-пострілу (0: повтор клавіш)
			x: r2(e.pos.x),
			y: r2(e.pos.y),
			vx: r2(e.vel.x),
			vy: r2(e.vel.y),
			ttl: round(e.ttl, 3),
		});
	}

	const pickups: PickupSnapshot[] = [];
	for (const e of game.world.ofKind("pickup")) {
		if (!e.alive) continue;
		pickups.push({
			id: e.id,
			type: e.type,
			x: r2(e.pos.x),
			y: r2(e.pos.y),
			life: r2(e.life ?? 1), // life ставить lifetime при створенні; undefined лише в теорії
		});
	}

	return { tick: game.tick, players, ships, obstacles, bullets, pickups };
}

const px = (v: number): number => Math.round(v);

// Подія шини світу у вигляді для мережі (тип WireEvent виведений зі схеми в protocol).
// Події це лише косметика (звук, ефекти): стан гри з них не відновлюється.
// Таблиця замість switch: тип { [K in keyof BusEvents]: … } вимагає обробник для КОЖНОЇ
// події шини, тож нова подія без обробника це помилка tsc (так само, як never у default),
// а для обробника K зв'язує назву з типом detail.
const TO_WIRE: {
	readonly [K in keyof BusEvents]: (d: BusEvents[K]) => WireEvent;
} = {
	fired: (d) => ({
		type: "fired",
		player: d.by.playerId ?? null,
		x: px(d.at.x),
		y: px(d.at.y),
	}),
	hit: (d) => ({
		type: "hit",
		kind: d.target.kind,
		x: px(d.at.x),
		y: px(d.at.y),
	}),
	exploded: (d) => ({
		type: "exploded",
		kind: d.kind,
		x: px(d.pos.x),
		y: px(d.pos.y),
		size: d.size,
		color: d.color,
		count: d.count,
	}),
	scored: (d) => ({
		type: "scored",
		player: d.player,
		delta: d.delta,
		x: px(d.at.x),
		y: px(d.at.y),
	}),
	pickup: (d) => ({ type: "pickup", player: d.player, pickup: d.type }),
	crash: (d) => ({
		type: "crash",
		player: d.player,
		x: px(d.at.x),
		y: px(d.at.y),
	}),
	respawned: (d) => ({
		type: "respawned",
		player: d.player,
		x: px(d.at.x),
		y: px(d.at.y),
	}),
};

// Невідомий тип (з JS-коду або з мережі) дає null; для відомих типів null не буває.
export function eventToWire<K extends keyof BusEvents>(
	type: K,
	detail: BusEvents[K],
): WireEvent | null {
	if (!Object.hasOwn(TO_WIRE, type)) return null;
	return TO_WIRE[type](detail);
}
