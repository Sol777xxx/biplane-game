import {
	type RoomSummary,
	roomListSchema,
} from "biplane-shared/protocol/index.ts";
import { fetchJson } from "./assets/loader.ts";
import { TypedTarget } from "./net/typedTarget.ts";

export interface JoinChoice {
	readonly name: string;
	readonly room: RoomSummary;
}

// Події лобі: назва → що лежить у detail.
export interface LobbyEvents {
	rooms: readonly RoomSummary[];
	error: unknown;
	join: JoinChoice;
}

export interface LobbyOptions {
	readonly url?: string;
	readonly intervalMs?: number;
	readonly timeoutMs?: number;
}

// Лобі без DOM: опитує список кімнат, кидає події "rooms", "error", "join".
// Кожен запит має таймаут (fetchJson → AbortSignal.timeout) і власний AbortController,
// тож stop() обриває запит, який ще летить. Відповідь сервера перевіряє схема Zod.
export class Lobby extends TypedTarget<LobbyEvents> {
	#url: string;
	#intervalMs: number;
	#timeoutMs: number;
	#rooms: readonly RoomSummary[] = [];
	#running = false;
	#timer = 0;
	#gen = 0; // покоління циклу: старий цикл після stop()/start() сам завершується
	#ctl: AbortController | null = null;

	constructor({
		url = "/api/rooms",
		intervalMs = 3000,
		timeoutMs = 2000,
	}: LobbyOptions = {}) {
		super();
		this.#url = url;
		this.#intervalMs = intervalMs;
		this.#timeoutMs = timeoutMs;
	}

	get rooms(): readonly RoomSummary[] {
		return this.#rooms;
	}

	// один запит; новий refresh скасовує попередній, що ще не завершився
	async refresh(): Promise<void> {
		this.#ctl?.abort();
		const ctl = new AbortController();
		this.#ctl = ctl;
		try {
			const data = await fetchJson(this.#url, {
				signal: ctl.signal,
				timeoutMs: this.#timeoutMs,
			});
			if (ctl.signal.aborted) return;
			const parsed = roomListSchema.safeParse(data);
			if (!parsed.success) throw new Error("Некоректна відповідь сервера");
			this.#rooms = parsed.data.rooms;
			this.emit("rooms", this.#rooms);
		} catch (error) {
			if (ctl.signal.aborted) return; // гравець пішов: помилка нікому не потрібна
			this.emit("error", error);
		} finally {
			if (this.#ctl === ctl) this.#ctl = null;
		}
	}

	// наступний запит планується після завершення попереднього, тож вони не накладаються
	start(): void {
		if (this.#running) return;
		this.#running = true;
		const gen = ++this.#gen;
		const tick = async (): Promise<void> => {
			await this.refresh();
			if (this.#running && gen === this.#gen) {
				this.#timer = setTimeout(tick, this.#intervalMs);
			}
		};
		void tick();
	}

	stop(): void {
		this.#running = false;
		this.#gen++;
		clearTimeout(this.#timer);
		this.#ctl?.abort();
		this.#ctl = null;
	}

	join(name: string, roomId: string | null): JoinChoice {
		const clean = name.trim();
		if (!clean) throw new Error("Введіть ім'я");
		if (clean.length > 16) throw new Error("Ім'я задовге (до 16 символів)");
		const room = this.#rooms.find((r) => r.id === roomId);
		if (!room) throw new Error("Оберіть кімнату");
		if (room.players >= room.max) throw new Error("Кімната заповнена");

		this.stop(); // гравець пішов: запити більше не потрібні
		const choice: JoinChoice = { name: clean, room };
		this.emit("join", choice);
		return choice;
	}
}
