import { randomBytes } from "node:crypto";
import type { InputKeys, WireEvent } from "biplane-shared/protocol/index.ts";
import { Game } from "biplane-shared/sim/game.ts";
import { NO_SEQ, type Seq } from "biplane-shared/sim/ids.ts";
import { eventToWire, takeSnapshot } from "biplane-shared/sim/snapshot.ts";
import { TICK_DT, TICK_RATE } from "biplane-shared/sim/time.ts";
import type { BusEvents } from "biplane-shared/sim/types.ts";
import { childLogger, type Logger } from "./logger.ts";
import type { Room, RoomInput } from "./rooms.ts";
import { RollingStats, type StatsSummary } from "./stats.ts";

const INTERVAL_MS = 1000 / TICK_RATE;
const MAX_BACKLOG = 4; // input у черзі одного гравця; зайві найстаріші відкидаються
const MAX_CATCHUP = 5; // тіків за одне пробудження таймера
const MAX_EVENTS = 64; // подій у одному знімку
const BUS_EVENTS: readonly (keyof BusEvents & string)[] = [
	"fired",
	"hit",
	"exploded",
	"scored",
	"pickup",
	"crash",
	"respawned",
];

const NO_KEYS: InputKeys = Object.freeze({
	up: false,
	down: false,
	left: false,
	right: false,
	fire: false,
});

type Timer = ReturnType<typeof setTimeout>;

// черга input одного гравця
interface PlayerQueue {
	readonly items: { readonly seq: Seq; readonly keys: InputKeys }[];
	keys: InputKeys; // останній застосований стан клавіш
	ack: Seq; // останній оброблений seq
	received: number; // найбільший отриманий seq
}

export interface MatchOptions {
	readonly room: Room;
	readonly log: Logger;
	readonly now?: () => number;
	readonly setTimer?: (fn: () => void, ms: number) => Timer;
	readonly clearTimer?: (timer: Timer) => void;
	readonly seed?: () => number;
}

export interface MatchStats {
	readonly id: string;
	readonly running: boolean;
	readonly players: number;
	readonly tick: number;
	readonly tickRate: number;
	readonly ticks: number;
	readonly skipped: number;
	readonly overruns: number;
	readonly inputs: { readonly repeated: number; readonly dropped: number };
	readonly tickMs: StatsSummary;
	readonly intervalMs: StatsSummary;
	readonly lateMs: StatsSummary;
}

// Авторитетна гра однієї кімнати. Input приходить подією "input", знімок іде подією
// "snapshot" ({ snapshot, acks }); про сокети Match нічого не знає.
//
// Політика input:
//  - за тік береться один input гравця, по порядку seq;
//  - черга порожня: повторюється останній стан клавіш (без seq), ack не росте;
//  - у черзі більше MAX_BACKLOG: найстаріші відкидаються, їхній seq вважається підтвердженим;
//  - seq, не більший за вже отриманий, ігнорується (дублікат або підробка).
export class Match {
	readonly #room: Room;
	readonly #log: Logger;
	readonly #now: () => number;
	readonly #setTimer: (fn: () => void, ms: number) => Timer;
	readonly #clearTimer: (timer: Timer) => void;
	readonly #seed: () => number;
	#game: Game | null = null;
	readonly #queues = new Map<string, PlayerQueue>(); // id гравця -> черга
	readonly #events: WireEvent[] = [];
	#timer: Timer | null = null;
	#running = false;
	#nextTick = 0;
	#prevStart: number | null = null;
	readonly #tickStats = new RollingStats();
	readonly #intervalStats = new RollingStats();
	readonly #lateStats = new RollingStats();
	ticks = 0;
	skipped = 0;
	overruns = 0;
	repeated = 0; // тіки з порожньою чергою (повтор клавіш) після першого input гравця
	dropped = 0; // input, відкинуті через переповнення черги

	readonly #onInput = (message: RoomInput): void => this.#queueInput(message);
	readonly #onRoster = (): void => this.#sync();

	constructor({
		room,
		log,
		now = () => performance.now(),
		setTimer = setTimeout,
		clearTimer = clearTimeout,
		seed = () => randomBytes(4).readUInt32LE(0),
	}: MatchOptions) {
		this.#room = room;
		this.#log = childLogger(log, { room: room.id });
		this.#now = now;
		this.#setTimer = setTimer;
		this.#clearTimer = clearTimer;
		this.#seed = seed;
		room.on("input", this.#onInput);
		room.on("join", this.#onRoster);
		room.on("leave", this.#onRoster);
		this.#sync();
	}

	get running(): boolean {
		return this.#running;
	}

	// ---------- гравці ----------
	#sync(): void {
		const roster = this.#room.roster();
		if (roster.length === 0) {
			this.#stopGame();
			return;
		}
		const game = this.#game ?? this.#startGame();

		const ids = new Set(roster.map((p) => p.id));
		for (const id of ids) {
			if (this.#queues.has(id)) continue;
			game.addPlayer(id);
			this.#queues.set(id, {
				items: [],
				keys: NO_KEYS,
				ack: NO_SEQ,
				received: 0,
			});
		}
		for (const id of [...this.#queues.keys()]) {
			if (ids.has(id)) continue;
			game.removePlayer(id);
			this.#queues.delete(id);
		}
	}

	#queueInput({ playerId, seq, keys }: RoomInput): void {
		const q = this.#queues.get(playerId);
		if (!q || seq <= q.received) return;
		q.received = seq;
		q.items.push({ seq, keys });
		while (q.items.length > MAX_BACKLOG) {
			const oldest = q.items.shift();
			if (oldest) q.ack = oldest.seq;
			this.dropped++;
		}
	}

	// ---------- життя гри ----------
	// Подія шини гри йде в чергу подій знімка. Узагальнення за K потрібне, щоб назва
	// події й тип її detail лишались пов'язаними (BusEvents[K]) для кожного виклику.
	#forward<K extends keyof BusEvents & string>(game: Game, type: K): void {
		game.world.bus.on(type, (detail) => {
			if (this.#events.length >= MAX_EVENTS) return;
			const wire = eventToWire(type, detail);
			if (wire) this.#events.push(wire);
		});
	}

	#startGame(): Game {
		const seed = this.#seed();
		const game = new Game(this.#room.summary().arena, { seed });
		this.#game = game;
		this.#events.length = 0;
		for (const type of BUS_EVENTS) this.#forward(game, type);
		this.#log.info(`матч стартував (seed ${seed})`);
		this.#running = true;
		this.#prevStart = null;
		this.#nextTick = this.#now() + INTERVAL_MS;
		this.#schedule();
		return game;
	}

	#stopGame(): void {
		const wasRunning = this.#running;
		this.#running = false;
		if (this.#timer !== null) this.#clearTimer(this.#timer);
		this.#timer = null;
		this.#game = null;
		this.#queues.clear();
		this.#events.length = 0;
		if (wasRunning) this.#log.info("матч зупинено");
	}

	// ---------- цикл: абсолютна цільова мітка, а не ланцюжок setInterval ----------
	#schedule(): void {
		const delay = Math.max(0, Math.ceil(this.#nextTick - this.#now()));
		this.#timer = this.#setTimer(this.#run, delay);
	}

	readonly #run = (): void => {
		this.#timer = null;
		if (!this.#running) return;
		let ran = 0;
		try {
			while (
				this.#running &&
				this.#nextTick <= this.#now() &&
				ran < MAX_CATCHUP
			) {
				const started = this.#now();
				this.#lateStats.add(started - this.#nextTick);
				if (this.#prevStart !== null) {
					this.#intervalStats.add(started - this.#prevStart);
				}
				this.#prevStart = started;

				this.#step();

				const took = this.#now() - started;
				this.#tickStats.add(took);
				if (took > INTERVAL_MS) this.overruns++;
				this.ticks++;
				ran++;
				this.#nextTick += INTERVAL_MS;
			}
		} catch (error: unknown) {
			this.#log.error("помилка тіку, матч зупинено:", error);
			this.#stopGame();
			return;
		}
		if (!this.#running) return;

		// не наздогнали за MAX_CATCHUP: пропущені цілі відкидаємо й починаємо наново
		const behind = this.#now() - this.#nextTick;
		if (behind >= 0) {
			this.skipped += Math.floor(behind / INTERVAL_MS) + 1;
			this.#nextTick = this.#now() + INTERVAL_MS;
		}
		this.#schedule();
	};

	#step(): void {
		const game = this.#game;
		if (!game) return; // гру зупинено між плануванням і викликом
		const inputs = new Map<string, InputKeys & { seq?: Seq }>();
		for (const [id, q] of this.#queues) {
			const next = q.items.shift();
			if (next) {
				q.keys = next.keys;
				q.ack = next.seq;
			} else if (q.received > 0) {
				this.repeated++;
			}
			// seq лише для реального input: куля з повтору клавіш матиме seq 0
			inputs.set(id, next ? { ...next.keys, seq: next.seq } : q.keys);
		}
		game.step(TICK_DT, inputs);

		// знімок readonly: події додаємо новим об'єктом, а не присвоєнням полю
		const snapshot = { ...takeSnapshot(game), events: this.#events.splice(0) };
		const acks = new Map<string, Seq>();
		for (const [id, q] of this.#queues) acks.set(id, q.ack);
		this.#room.emit("snapshot", { snapshot, acks });
	}

	// ---------- облік ----------
	stats(): MatchStats {
		return {
			id: this.#room.id,
			running: this.#running,
			players: this.#queues.size,
			tick: this.#game?.tick ?? 0,
			tickRate: TICK_RATE,
			ticks: this.ticks,
			skipped: this.skipped,
			overruns: this.overruns,
			inputs: { repeated: this.repeated, dropped: this.dropped },
			tickMs: this.#tickStats.summary(),
			intervalMs: this.#intervalStats.summary(),
			lateMs: this.#lateStats.summary(),
		};
	}

	dispose(): void {
		this.#room.off("input", this.#onInput);
		this.#room.off("join", this.#onRoster);
		this.#room.off("leave", this.#onRoster);
		this.#stopGame();
	}
}
