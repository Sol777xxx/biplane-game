import type {
	BulletSnapshot,
	ObstacleSnapshot,
	PickupSnapshot,
	PlayerSnapshot,
	ShipSnapshot,
} from "biplane-shared/protocol/index.ts";
import { TypedBus } from "biplane-shared/sim/bus.ts";
import type { EntityId } from "biplane-shared/sim/ids.ts";
import type { Bullet, PickupType } from "biplane-shared/sim/objects.ts";
import type { Vec2 } from "biplane-shared/sim/vector.ts";
import { eventFromWire, type NetBusEvents } from "./events.ts";
import type { InterpFrame, Interpolator } from "./interpolator.ts";

// радіуси дублюють shared/sim (Biplane, Bullet, Pickup); збіг стереже тест
export const SHIP_RADIUS = 46;
export const BULLET_RADIUS = 8;
export const PICKUP_RADIUS = 28;

const pt = (x: number, y: number): Vec2 => ({ x, y });

// Сутності для renderer: ті самі поля, що в сутностей sim. Положення можна підмінити
// (свій корабель бере позицію з передбачення), решта лише читається.
export interface ViewShip {
	readonly id: EntityId;
	readonly kind: "biplane";
	readonly mine: boolean;
	readonly player: string;
	pos: Vec2;
	prevPos: Vec2;
	vel: Vec2;
	readonly radius: number;
	pitch: number;
	prevPitch: number;
	facing: number;
	readonly hp: number;
	readonly effects: {
		readonly shield: number;
		readonly rapid: number;
		readonly homing: number;
	};
}

export interface ViewObstacle {
	readonly id: EntityId;
	readonly kind: "obstacle";
	readonly pos: Vec2;
	readonly prevPos: Vec2;
	readonly vel: Vec2;
	readonly radius: number;
}

export interface ViewBullet {
	readonly id: EntityId;
	readonly kind: "bullet";
	readonly owner: string | null;
	readonly pos: Vec2;
	readonly prevPos: Vec2;
	readonly vel: Vec2;
	readonly radius: number;
	readonly ttl: number;
}

export interface ViewPickup {
	readonly id: EntityId;
	readonly kind: "pickup";
	readonly type: PickupType;
	readonly pos: Vec2;
	readonly prevPos: Vec2;
	readonly radius: number;
	readonly life: number;
}

// prevPos = pos (рух кадрами рахує інтерполятор)
function ship(s: ShipSnapshot, mine: boolean): ViewShip {
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

function obstacle(o: ObstacleSnapshot): ViewObstacle {
	return {
		id: o.id,
		kind: "obstacle",
		pos: pt(o.x, o.y),
		prevPos: pt(o.x, o.y),
		vel: pt(o.vx, o.vy),
		radius: o.r,
	};
}

function bullet(b: BulletSnapshot): ViewBullet {
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

function pickup(p: PickupSnapshot): ViewPickup {
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

// Положення свого корабля з передбачення (підходить і Biplane, і predictor.pose).
export interface LocalPose {
	readonly pos: Vec2;
	readonly prevPos: Vec2;
	readonly vel: Vec2;
	readonly pitch: number;
	readonly prevPitch: number;
	readonly facing: number;
}

// Знімок, який приймає apply(): повне повідомлення сервера теж підходить.
export interface ViewFrame extends InterpFrame {
	readonly players?: readonly PlayerSnapshot[];
	readonly ack?: number;
}

export interface SnapshotViewOptions {
	readonly you?: () => string | null;
	readonly local?: () => LocalPose | null;
	readonly interp?: Interpolator | null;
	readonly shots?: (() => readonly Bullet[]) | null;
}

interface Views {
	biplane: ViewShip[];
	obstacle: ViewObstacle[];
	bullet: ViewBullet[];
	pickup: ViewPickup[];
}

const emptyViews = (): Views => ({
	biplane: [],
	obstacle: [],
	bullet: [],
	pickup: [],
});

type AnyView = ViewShip | ViewObstacle | ViewBullet | Bullet | ViewPickup;

// Що клієнт знає про гру.
//  you(): id цього гравця;
//  local(): передбачений корабель (або null), його рух підміняє рух свого корабля;
//  shots(): свої передбачені кулі, або null, якщо передбачення вимкнене. Коли не null,
//    свої кулі зі знімка не малюються (їх замінюють передбачені), а серверна подія
//    "fired" власного гравця ігнорується (звук уже пролунав);
//  interp: без нього apply() одразу показує знімок, з ним apply() кладе знімок у буфер,
//    а update(now) будує сутності на момент «now − delay» і видає події, до яких дійшов час.
export function createSnapshotView({
	you = () => null,
	local = () => null,
	interp = null,
	shots = null,
}: SnapshotViewOptions = {}) {
	const bus = new TypedBus<NetBusEvents>();
	let views = emptyViews();
	let players: ReadonlyMap<string, PlayerSnapshot> = new Map();
	let latest: ViewFrame | null = null;
	let tick = 0;
	let ack = 0;

	const build = (
		ships: ViewShip[],
		rows: {
			readonly obstacles?: readonly ObstacleSnapshot[];
			readonly bullets?: readonly BulletSnapshot[];
			readonly pickups?: readonly PickupSnapshot[];
		},
	): void => {
		const id = you();
		const own = shots ? shots() : null;
		views = {
			biplane: ships,
			obstacle: (rows.obstacles ?? []).map(obstacle),
			bullet: (rows.bullets ?? [])
				.filter((b) => own === null || b.owner !== id)
				.map(bullet),
			pickup: (rows.pickups ?? []).map(pickup),
		};
	};

	const emit = (wires: readonly unknown[] = []): void => {
		const own = shots ? shots() : null;
		const id = you();
		for (const wire of wires) {
			const ev = eventFromWire(wire);
			if (!ev) continue;
			if (own !== null && ev.type === "fired" && ev.detail.by.playerId === id) {
				continue;
			}
			bus.dispatchEvent(new CustomEvent(ev.type, { detail: ev.detail }));
		}
	};

	// Перевантаження дають renderer точний тип за видом сутності.
	function ofKind(kind: "biplane"): Generator<ViewShip>;
	function ofKind(kind: "obstacle"): Generator<ViewObstacle>;
	function ofKind(kind: "bullet"): Generator<ViewBullet | Bullet>;
	function ofKind(kind: "pickup"): Generator<ViewPickup>;
	function ofKind(kind: string): Generator<AnyView>;
	function* ofKind(kind: string): Generator<AnyView> {
		if (kind === "bullet") {
			yield* views.bullet;
			yield* shots?.() ?? [];
		} else if (kind === "obstacle") {
			yield* views.obstacle;
		} else if (kind === "pickup") {
			yield* views.pickup;
		} else if (kind === "biplane") {
			const p = local();
			for (const e of views.biplane) {
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
		}
	}

	return {
		bus,
		world: { ofKind },
		get tick(): number {
			return tick;
		},
		get ack(): number {
			return ack;
		},
		get players(): ReadonlyMap<string, PlayerSnapshot> {
			return players;
		},

		// at: час приходу знімка (лише з interp)
		apply(msg: ViewFrame, at?: number): void {
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

		// щокадру (лише з interp); свій корабель береться з останнього знімка без затримки
		update(now: number): void {
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
		reset(): void {
			interp?.reset();
			views = emptyViews();
			latest = null;
		},

		// свій корабель (null, поки загиблий) і свої лічильники
		me(): { ship: ViewShip | null; player: PlayerSnapshot | null } {
			const id = you();
			const mine = views.biplane.find((s) => s.player === id);
			return {
				ship: mine ?? null,
				player: id === null ? null : (players.get(id) ?? null),
			};
		},
	};
}

export type SnapshotView = ReturnType<typeof createSnapshotView>;
