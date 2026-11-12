import { randomBytes } from "node:crypto";
import { Game } from "biplane-shared/sim/game.js";
import { eventToWire, takeSnapshot } from "biplane-shared/sim/snapshot.js";
import { TICK_DT, TICK_RATE } from "biplane-shared/sim/time.js";
import { RollingStats } from "./stats.js";

const INTERVAL_MS = 1000 / TICK_RATE;
const MAX_BACKLOG = 4; // input у черзі одного гравця; зайві найстаріші відкидаються
const MAX_CATCHUP = 5; // тіків за одне пробудження таймера
const MAX_EVENTS = 64; // подій у одному знімку
const BUS_EVENTS = [
	"fired",
	"hit",
	"exploded",
	"scored",
	"pickup",
	"crash",
	"respawned",
];

const NO_KEYS = Object.freeze({
	up: false,
	down: false,
	left: false,
	right: false,
	fire: false,
});

// Авторитетна гра однієї кімнати. Кімната нічого не знає про Match, а Match про сокети:
// input приходить подією "input", знімок іде подією "snapshot" ({ snapshot, acks }).
//
// Політика input (одне рішення на всіх):
//  - за тік береться один input гравця, по порядку seq;
//  - черга порожня: повторюється останній стан клавіш, ack не росте;
//  - у черзі більше MAX_BACKLOG: найстаріші відкидаються, їхній seq вважається підтвердженим;
//  - seq, не більший за вже отриманий, ігнорується (дублікат або підробка).
export class Match {
	#room;
	#log;
	#now;
	#setTimer;
	#clearTimer;
	#seed;
	#game = null;
	#queues = new Map(); // id гравця -> { items, keys, ack, received }
	#events = [];
	#timer = null;
	#running = false;
	#nextTick = 0;
	#prevStart = null;
	#tickStats = new RollingStats();
	#intervalStats = new RollingStats();
	#lateStats = new RollingStats();
	ticks = 0;
	skipped = 0;
	overruns = 0;

	#onInput = (message) => this.#queueInput(message);
	#onRoster = () => this.#sync();

	constructor({
		room,
		log,
		now = () => performance.now(),
		setTimer = setTimeout,
		clearTimer = clearTimeout,
		seed = () => randomBytes(4).readUInt32LE(0),
	}) {
		this.#room = room;
		this.#log = log;
		this.#now = now;
		this.#setTimer = setTimer;
		this.#clearTimer = clearTimer;
		this.#seed = seed;
		room.on("input", this.#onInput);
		room.on("join", this.#onRoster);
		room.on("leave", this.#onRoster);
		this.#sync();
	}

	get running() {
		return this.#running;
	}

	// ---------- гравці ----------
	#sync() {
		const roster = this.#room.roster();
		if (roster.length === 0) return this.#stopGame();
		if (!this.#game) this.#startGame();

		const ids = new Set(roster.map((p) => p.id));
		for (const id of ids) {
			if (this.#queues.has(id)) continue;
			this.#game.addPlayer(id);
			this.#queues.set(id, { items: [], keys: NO_KEYS, ack: 0, received: 0 });
		}
		for (const id of [...this.#queues.keys()]) {
			if (ids.has(id)) continue;
			this.#game.removePlayer(id);
			this.#queues.delete(id);
		}
	}

	#queueInput({ playerId, seq, keys }) {
		const q = this.#queues.get(playerId);
		if (!q || seq <= q.received) return;
		q.received = seq;
		q.items.push({ seq, keys });
		while (q.items.length > MAX_BACKLOG) q.ack = q.items.shift().seq;
	}

	// ---------- життя гри ----------
	#startGame() {
		const seed = this.#seed();
		this.#game = new Game(this.#room.summary().arena, { seed });
		this.#events.length = 0;
		for (const type of BUS_EVENTS) {
			this.#game.world.bus.addEventListener(type, (e) => {
				if (this.#events.length >= MAX_EVENTS) return;
				const wire = eventToWire(type, e.detail);
				if (wire) this.#events.push(wire);
			});
		}
		this.#log.info(`[${this.#room.id}] матч стартував (seed ${seed})`);
		this.#running = true;
		this.#prevStart = null;
		this.#nextTick = this.#now() + INTERVAL_MS;
		this.#schedule();
	}

	#stopGame() {
		const wasRunning = this.#running;
		this.#running = false;
		if (this.#timer !== null) this.#clearTimer(this.#timer);
		this.#timer = null;
		this.#game = null;
		this.#queues.clear();
		this.#events.length = 0;
		if (wasRunning) this.#log.info(`[${this.#room.id}] матч зупинено`);
	}

	// ---------- цикл: абсолютна цільова мітка, а не ланцюжок setInterval ----------
	#schedule() {
		const delay = Math.max(0, Math.ceil(this.#nextTick - this.#now()));
		this.#timer = this.#setTimer(this.#run, delay);
	}

	#run = () => {
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
		} catch (error) {
			this.#log.error(`[${this.#room.id}] помилка тіку, матч зупинено:`, error);
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

	#step() {
		const inputs = new Map();
		for (const [id, q] of this.#queues) {
			const next = q.items.shift();
			if (next) {
				q.keys = next.keys;
				q.ack = next.seq;
			}
			inputs.set(id, q.keys);
		}
		this.#game.step(TICK_DT, inputs);

		const snapshot = takeSnapshot(this.#game);
		snapshot.events = this.#events.splice(0);
		const acks = new Map();
		for (const [id, q] of this.#queues) acks.set(id, q.ack);
		this.#room.emit("snapshot", { snapshot, acks });
	}

	// ---------- облік ----------
	stats() {
		return {
			id: this.#room.id,
			running: this.#running,
			players: this.#queues.size,
			tick: this.#game?.tick ?? 0,
			tickRate: TICK_RATE,
			ticks: this.ticks,
			skipped: this.skipped,
			overruns: this.overruns,
			tickMs: this.#tickStats.summary(),
			intervalMs: this.#intervalStats.summary(),
			lateMs: this.#lateStats.summary(),
		};
	}

	dispose() {
		this.#room.off("input", this.#onInput);
		this.#room.off("join", this.#onRoster);
		this.#room.off("leave", this.#onRoster);
		this.#stopGame();
	}
}
