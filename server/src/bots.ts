import type { InputKeys, Snapshot } from "biplane-shared/protocol/index.ts";
import { toSeq } from "biplane-shared/sim/ids.ts";
import type { Room, RoomSnapshot } from "./rooms.ts";

// Боти це гравці без сокета: слухають знімки кімнати й відповідають input-ом так само,
// як клієнт (подія "input", зростаючий seq). Потрібні, щоб навантажити сервер і клієнт
// без десятка живих вкладок (лаб 7: профілювання й навантажувальний тест).

const CHASE_RANGE = 1400; // далі цього бот не цілиться
const FIRE_RANGE = 700;
const FIRE_CONE = 0.35; // допустима похибка прицілу, радіани
const DANGER = 170; // ближче цієї відстані перешкода чи куля це загроза
const IDLE: InputKeys = {
	up: false,
	down: false,
	left: false,
	right: false,
	fire: false,
};

type Ship = Snapshot["ships"][number];

export interface BotOptions {
	// стріляти завжди, а не лише коли ціль у конусі (максимальне навантаження)
	readonly spray?: boolean;
}

interface Threat {
	readonly dx: number;
	readonly dy: number;
	readonly d: number;
}

// найближча небезпека: перешкода або чужа куля ближче за DANGER
function nearestThreat(
	snapshot: Snapshot,
	me: Ship,
	botId: string,
): Threat | null {
	let best: Threat | null = null;
	const consider = (x: number, y: number, reach: number): void => {
		const dx = x - me.x;
		const dy = y - me.y;
		const d = Math.hypot(dx, dy) - reach;
		if (d < DANGER && (best === null || d < best.d)) best = { dx, dy, d };
	};
	for (const o of snapshot.obstacles) consider(o.x, o.y, o.r);
	for (const b of snapshot.bullets) {
		if (b.owner !== botId) consider(b.x, b.y, 8);
	}
	return best;
}

// Чиста функція рішення: знімок і id бота дають клавіші. Окремо від таймерів, щоб тестувати.
export function decide(
	snapshot: Snapshot,
	botId: string,
	{ spray = false }: BotOptions = {},
): InputKeys {
	const me = snapshot.ships.find((s) => s.player === botId);
	if (!me) return IDLE;

	const threat = nearestThreat(snapshot, me, botId);

	// найближча чужа ціль
	let target: Ship | null = null;
	let best = CHASE_RANGE;
	for (const s of snapshot.ships) {
		if (s.player === botId) continue;
		const d = Math.hypot(s.x - me.x, s.y - me.y);
		if (d < best) {
			best = d;
			target = s;
		}
	}

	let tx = 0;
	let ty = 0;
	let fire = spray;
	if (threat) {
		// від загрози
		tx = -threat.dx;
		ty = -threat.dy;
	} else if (target) {
		tx = target.x - me.x;
		ty = target.y - me.y;
		const aim = Math.atan2(ty, tx * me.facing);
		if (best < FIRE_RANGE && Math.abs(aim - me.pitch) < FIRE_CONE) fire = true;
	} else {
		// нікого поруч: до центру арени
		tx = 800 - me.x;
		ty = 450 - me.y;
	}

	const dead = 30; // зона нечутливості, щоб не тремтіти біля цілі
	return {
		left: tx < -dead,
		right: tx > dead,
		up: ty < -dead,
		down: ty > dead,
		fire,
	};
}

export interface BotManager {
	// додає count ботів у кімнату; повертає id доданих
	add(room: Room, count: number, options?: BotOptions): string[];
	// прибирає всіх ботів кімнати; повертає, скільки було
	clear(room: Room): number;
	count(room: Room): number;
	dispose(): void;
}

export function createBots(): BotManager {
	const byRoom = new Map<string, Map<string, () => void>>(); // room -> bot id -> off
	let serial = 0;

	function bots(room: Room): Map<string, () => void> {
		let m = byRoom.get(room.id);
		if (!m) {
			m = new Map();
			byRoom.set(room.id, m);
		}
		return m;
	}

	return {
		add(room, count, options = {}) {
			const mine = bots(room);
			const ids: string[] = [];
			for (let i = 0; i < count; i++) {
				const n = ++serial;
				const id = `bot-${n}`;
				room.join({ id, name: `Bot-${n}` }); // кине RoomError("full"), якщо місць нема
				let seq = 0;
				const onSnapshot = ({ snapshot }: RoomSnapshot): void => {
					room.emit("input", {
						playerId: id,
						seq: toSeq(++seq),
						keys: decide(snapshot, id, options),
					});
				};
				room.on("snapshot", onSnapshot);
				mine.set(id, () => room.off("snapshot", onSnapshot));
				ids.push(id);
			}
			return ids;
		},

		clear(room) {
			const mine = byRoom.get(room.id);
			if (!mine) return 0;
			const n = mine.size;
			for (const [id, off] of mine) {
				off();
				room.leave(id);
			}
			byRoom.delete(room.id);
			return n;
		},

		count(room) {
			return byRoom.get(room.id)?.size ?? 0;
		},

		dispose() {
			for (const [, mine] of byRoom) for (const off of mine.values()) off();
			byRoom.clear();
		},
	};
}
