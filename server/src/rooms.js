import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";

export class RoomError extends Error {
	constructor(code, message) {
		super(message);
		this.name = "RoomError";
		this.code = code;
	}
}

// Пресети арени: ті самі значення, що були в client/public/api/rooms.json.
export const PRESETS = {
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

const newId = () => randomBytes(4).toString("hex");

// Події керування: "join", "leave", "chat", "empty", "matchstart".
// Події для логу: "event" ({ t, type, ... }), їх читає модуль логу матчу.
// Подію "error" кімната не кидає: EventEmitter без слухача "error" валить процес.
export class Room extends EventEmitter {
	players = new Map(); // playerId -> { id, name, joinedAt }

	constructor({ id, name, max = 4, arena, permanent = false }) {
		super();
		this.id = id;
		this.name = name;
		this.max = max;
		this.arena = arena;
		this.permanent = permanent;
	}

	#record(type, data = {}) {
		this.emit("event", { t: Date.now(), type, ...data });
	}

	join({ id, name }) {
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
			this.#record("match_start", {
				room: this.id,
				name: this.name,
				arena: this.arena,
			});
		}

		const player = { id, name, joinedAt: Date.now() };
		this.players.set(id, player);
		this.#record("join", { player: id, name });
		this.emit("join", player);
		return player;
	}

	leave(id) {
		const player = this.players.get(id);
		if (!player) return false;
		this.players.delete(id);
		this.#record("leave", { player: id, name: player.name });
		this.emit("leave", player);
		if (this.players.size === 0) {
			this.#record("match_end");
			this.emit("empty");
		}
		return true;
	}

	chat(id, text) {
		const player = this.players.get(id);
		if (!player) throw new RoomError("not_in_room", "Ви не в цій кімнаті");
		const message = { t: Date.now(), from: id, name: player.name, text };
		this.#record("chat", { player: id, name: player.name, text });
		this.emit("chat", message);
		return message;
	}

	roster() {
		return [...this.players.values()].map(({ id, name }) => ({ id, name }));
	}

	// формат, який бачить лобі на клієнті
	summary() {
		return {
			id: this.id,
			name: this.name,
			players: this.players.size,
			max: this.max,
			arena: this.arena,
		};
	}
}

// Події менеджера: "created" (room).
export class RoomManager extends EventEmitter {
	#rooms = new Map();
	#timers = new Map();

	constructor({
		maxRooms = Number.POSITIVE_INFINITY,
		idleTtlMs = 60_000,
	} = {}) {
		super();
		this.maxRooms = maxRooms;
		this.idleTtlMs = idleTtlMs;
	}

	get size() {
		return this.#rooms.size;
	}

	create({ id = newId(), name, max, arena, permanent = false }) {
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

	get(id) {
		return this.#rooms.get(id);
	}

	all() {
		return [...this.#rooms.values()];
	}

	delete(id) {
		clearTimeout(this.#timers.get(id));
		this.#timers.delete(id);
		return this.#rooms.delete(id);
	}

	list() {
		return this.all().map((r) => r.summary());
	}

	dispose() {
		for (const timer of this.#timers.values()) clearTimeout(timer);
		this.#timers.clear();
	}
}

export function seedRooms(manager) {
	const defaults = [
		["calm", "Тиха гавань"],
		["classic", "Класика"],
		["storm", "Грозовий фронт"],
	];
	for (const [id, name] of defaults) {
		manager.create({ id, name, max: 4, arena: PRESETS[id], permanent: true });
	}
}
