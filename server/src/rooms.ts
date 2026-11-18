import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import type {
	InputKeys,
	Snapshot,
	WireEvent,
} from "biplane-shared/protocol/index.ts";
import type { ArenaConfig } from "biplane-shared/sim/game.ts";
import type { Seq } from "biplane-shared/sim/ids.ts";

export type RoomErrorCode =
	| "already_joined"
	| "full"
	| "name_taken"
	| "not_in_room"
	| "too_many_rooms";

export class RoomError extends Error {
	readonly code: RoomErrorCode;

	constructor(code: RoomErrorCode, message: string) {
		super(message);
		this.name = "RoomError";
		this.code = code;
	}
}

export type PresetName = "calm" | "classic" | "storm";

// Пресети арени: ті самі значення, що були в client/public/api/rooms.json.
// Record вимагає запис для КОЖНОГО PresetName.
export const PRESETS: Readonly<Record<PresetName, ArenaConfig>> = {
	calm: {
		obstacles: 3,
		pickupEvery: 8,
		homingChance: 0,
		speed: 1,
		refillEvery: 3,
	},
	classic: {
		obstacles: 5,
		pickupEvery: 8,
		homingChance: 0.3,
		speed: 1,
		refillEvery: 2,
	},
	storm: {
		obstacles: 8,
		pickupEvery: 10,
		homingChance: 0.6,
		speed: 1.3,
		refillEvery: 0.6,
	},
};

// hasOwn, а не "in": інакше "toString" чи "__proto__" минули б перевірку
export const isPresetName = (name: string): name is PresetName =>
	Object.hasOwn(PRESETS, name);

const newId = (): string => randomBytes(4).toString("hex");

export interface RoomPlayer {
	readonly id: string;
	readonly name: string;
	readonly joinedAt: number;
}

export interface RosterEntry {
	readonly id: string;
	readonly name: string;
}

export interface ChatMessage {
	readonly t: number;
	readonly from: string;
	readonly name: string;
	readonly text: string;
}

export interface RoomSummary {
	readonly id: string;
	readonly name: string;
	readonly players: number;
	readonly max: number;
	readonly arena: ArenaConfig;
}

// Запис для логу матчу: дискримінантне об'єднання за type.
export type RoomLogEvent =
	| {
			readonly t: number;
			readonly type: "match_start";
			readonly room: string;
			readonly name: string;
			readonly arena: ArenaConfig;
	  }
	| {
			readonly t: number;
			readonly type: "join" | "leave";
			readonly player: string;
			readonly name: string;
	  }
	| {
			readonly t: number;
			readonly type: "chat";
			readonly player: string;
			readonly name: string;
			readonly text: string;
	  }
	| { readonly t: number; readonly type: "match_end" };

// input гравця, який сервер передає кімнаті; Match слухає цю подію
export interface RoomInput {
	readonly playerId: string;
	readonly seq: Seq;
	readonly keys: InputKeys;
}

// знімок кроку гри з подіями та підтвердженнями input для кожного гравця
export interface RoomSnapshot {
	readonly snapshot: Snapshot & { readonly events: readonly WireEvent[] };
	readonly acks: ReadonlyMap<string, Seq>;
}

// Усі події кімнати: назва → аргументи слухача. EventEmitter<RoomEvents> робить on, off
// і emit типізованими: аргумент не того типу чи поле, якого немає, tsc не пропустить.
// Події керування: "join", "leave", "chat", "empty", "matchstart".
// Події для логу: "event", їх читає модуль логу матчу.
// Подію "error" кімната не кидає: EventEmitter без слухача "error" валить процес.
export type RoomEvents = {
	event: [RoomLogEvent];
	matchstart: [];
	join: [RoomPlayer];
	leave: [RoomPlayer];
	chat: [ChatMessage];
	empty: [];
	input: [RoomInput];
	snapshot: [RoomSnapshot];
};

// запис без часу: t додає сама кімната (розподілено по об'єднанню)
type Unstamped<E> = E extends unknown ? Omit<E, "t"> : never;

export interface RoomOptions {
	readonly id: string;
	readonly name: string;
	readonly max?: number;
	readonly arena: ArenaConfig;
	readonly permanent?: boolean;
}

export class Room extends EventEmitter<RoomEvents> {
	readonly id: string;
	readonly name: string;
	readonly max: number;
	readonly arena: ArenaConfig;
	readonly permanent: boolean;
	readonly players = new Map<string, RoomPlayer>(); // playerId -> гравець

	constructor({ id, name, max = 4, arena, permanent = false }: RoomOptions) {
		super();
		this.id = id;
		this.name = name;
		this.max = max;
		this.arena = arena;
		this.permanent = permanent;
	}

	#record(event: Unstamped<RoomLogEvent>): void {
		this.emit("event", { t: Date.now(), ...event });
	}

	join({ id, name }: { id: string; name: string }): RoomPlayer {
		if (this.players.has(id))
			throw new RoomError("already_joined", "Ви вже в кімнаті");
		if (this.players.size >= this.max)
			throw new RoomError("full", "Кімната заповнена");
		const lower = name.toLowerCase();
		for (const p of this.players.values()) {
			if (p.name.toLowerCase() === lower) {
				throw new RoomError("name_taken", "Таке ім'я вже є в кімнаті");
			}
		}

		if (this.players.size === 0) {
			// "matchstart" йде першим: слухач відкриває лог і підписується на "event"
			// до того, як буде записано match_start (інакше цей запис пропав би)
			this.emit("matchstart");
			this.#record({
				type: "match_start",
				room: this.id,
				name: this.name,
				arena: this.arena,
			});
		}

		const player: RoomPlayer = { id, name, joinedAt: Date.now() };
		this.players.set(id, player);
		this.#record({ type: "join", player: id, name });
		this.emit("join", player);
		return player;
	}

	leave(id: string): boolean {
		const player = this.players.get(id);
		if (!player) return false;
		this.players.delete(id);
		this.#record({ type: "leave", player: id, name: player.name });
		this.emit("leave", player);
		if (this.players.size === 0) {
			this.#record({ type: "match_end" });
			this.emit("empty");
		}
		return true;
	}

	chat(id: string, text: string): ChatMessage {
		const player = this.players.get(id);
		if (!player) throw new RoomError("not_in_room", "Ви не в цій кімнаті");
		const message: ChatMessage = {
			t: Date.now(),
			from: id,
			name: player.name,
			text,
		};
		this.#record({ type: "chat", player: id, name: player.name, text });
		this.emit("chat", message);
		return message;
	}

	roster(): RosterEntry[] {
		return [...this.players.values()].map(({ id, name }) => ({ id, name }));
	}

	// формат, який бачить лобі на клієнті
	summary(): RoomSummary {
		return {
			id: this.id,
			name: this.name,
			players: this.players.size,
			max: this.max,
			arena: this.arena,
		};
	}
}

export interface RoomManagerOptions {
	readonly maxRooms?: number;
	readonly idleTtlMs?: number;
}

export interface NewRoom {
	readonly id?: string;
	readonly name: string;
	readonly max?: number;
	readonly arena: ArenaConfig;
	readonly permanent?: boolean;
}

// Події менеджера: "created" (room).
export class RoomManager extends EventEmitter<{ created: [Room] }> {
	readonly #rooms = new Map<string, Room>();
	readonly #timers = new Map<string, NodeJS.Timeout>();
	readonly maxRooms: number;
	readonly idleTtlMs: number;

	constructor({
		maxRooms = Number.POSITIVE_INFINITY,
		idleTtlMs = 60_000,
	}: RoomManagerOptions = {}) {
		super();
		this.maxRooms = maxRooms;
		this.idleTtlMs = idleTtlMs;
	}

	get size(): number {
		return this.#rooms.size;
	}

	create({ id = newId(), name, max, arena, permanent = false }: NewRoom): Room {
		if (this.#rooms.size >= this.maxRooms) {
			throw new RoomError("too_many_rooms", "Забагато кімнат на сервері");
		}
		const room = new Room({ id, name, max, arena, permanent });
		// порожня кімната видаляється, крім постійних
		room.on("empty", () => {
			if (!room.permanent) this.delete(room.id);
		});
		this.#rooms.set(room.id, room);

		if (!permanent) {
			// ніхто не зайшов: без цього POST створював би кімнати назавжди
			const timer = setTimeout(() => {
				if (room.players.size === 0) this.delete(room.id);
			}, this.idleTtlMs);
			timer.unref();
			this.#timers.set(room.id, timer);
		}
		this.emit("created", room);
		return room;
	}

	get(id: string): Room | undefined {
		return this.#rooms.get(id);
	}

	all(): Room[] {
		return [...this.#rooms.values()];
	}

	delete(id: string): boolean {
		clearTimeout(this.#timers.get(id));
		this.#timers.delete(id);
		return this.#rooms.delete(id);
	}

	list(): RoomSummary[] {
		return this.all().map((r) => r.summary());
	}

	dispose(): void {
		for (const timer of this.#timers.values()) clearTimeout(timer);
		this.#timers.clear();
	}
}

export function seedRooms(manager: RoomManager): void {
	const defaults: ReadonlyArray<readonly [PresetName, string]> = [
		["calm", "Тиха гавань"],
		["classic", "Класика"],
		["storm", "Грозовий фронт"],
	];
	for (const [id, name] of defaults) {
		manager.create({ id, name, max: 4, arena: PRESETS[id], permanent: true });
	}
}
