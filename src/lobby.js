import { fetchJson } from "./assets/loader.js";

// Лобі без DOM: опитує список кімнат, кидає події "rooms", "error", "join".
// Кожен запит має таймаут (fetchJson → AbortSignal.timeout) і власний AbortController,
// тож stop() обриває запит, який ще летить.
export class Lobby extends EventTarget {
	#url;
	#intervalMs;
	#timeoutMs;
	#rooms = [];
	#running = false;
	#timer = 0;
	#gen = 0; // покоління циклу: старий цикл після stop()/start() сам завершується
	#ctl = null;

	constructor({
		url = "/api/rooms",
		intervalMs = 3000,
		timeoutMs = 2000,
	} = {}) {
		super();
		this.#url = url;
		this.#intervalMs = intervalMs;
		this.#timeoutMs = timeoutMs;
	}

	get rooms() {
		return this.#rooms;
	}

	// один запит; новий refresh скасовує попередній, що ще не завершився
	async refresh() {
		this.#ctl?.abort();
		const ctl = new AbortController();
		this.#ctl = ctl;
		try {
			const data = await fetchJson(this.#url, {
				signal: ctl.signal,
				timeoutMs: this.#timeoutMs,
			});
			if (ctl.signal.aborted) return;
			if (!Array.isArray(data?.rooms)) {
				throw new Error("Некоректна відповідь сервера");
			}
			this.#rooms = data.rooms;
			this.dispatchEvent(new CustomEvent("rooms", { detail: this.#rooms }));
		} catch (error) {
			if (ctl.signal.aborted) return; // гравець пішов: помилка нікому не потрібна
			this.dispatchEvent(new CustomEvent("error", { detail: error }));
		} finally {
			if (this.#ctl === ctl) this.#ctl = null;
		}
	}

	// наступний запит планується після завершення попереднього, тож вони не накладаються
	start() {
		if (this.#running) return;
		this.#running = true;
		const gen = ++this.#gen;
		const tick = async () => {
			await this.refresh();
			if (this.#running && gen === this.#gen) {
				this.#timer = setTimeout(tick, this.#intervalMs);
			}
		};
		tick();
	}

	stop() {
		this.#running = false;
		this.#gen++;
		clearTimeout(this.#timer);
		this.#ctl?.abort();
		this.#ctl = null;
	}

	join(name, roomId) {
		const clean = String(name ?? "").trim();
		if (!clean) throw new Error("Введіть ім'я");
		if (clean.length > 16) throw new Error("Ім'я задовге (до 16 символів)");
		const room = this.#rooms.find((r) => r.id === roomId);
		if (!room) throw new Error("Оберіть кімнату");
		if (room.players >= room.max) throw new Error("Кімната заповнена");

		this.stop(); // гравець пішов: запити більше не потрібні
		const detail = { name: clean, room };
		this.dispatchEvent(new CustomEvent("join", { detail }));
		return detail;
	}
}
