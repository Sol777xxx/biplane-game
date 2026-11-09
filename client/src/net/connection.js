// Обгортка WebSocket: dispatch за type, черга send, перепідключення з backoff.
// Події життєвого циклу (EventTarget): "open", "close" { code, reason, willRetry },
// "reconnecting" { attempt, delay }. Повідомлення сервера: on(type, handler).

// Перепідключаємось лише після тимчасових обривів. 4xxx (порушення протоколу,
// кімната заповнена) і 1000 повтором не лікуються.
const RETRYABLE = new Set([1001, 1006, 1011, 1012, 1013]);
export const isRetryableClose = (code) => RETRYABLE.has(code);

// exponential backoff з "equal jitter": половина детермінована, половина випадкова,
// тож клієнти не прокидаються всі разом, але й миттєвих повторів немає
export function backoffDelay(
	attempt,
	{ baseMs = 500, maxMs = 10_000, random = Math.random } = {},
) {
	const cap = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
	return cap / 2 + (random() * cap) / 2;
}

export class Connection extends EventTarget {
	#url;
	#opts;
	#ws = null;
	#queue = [];
	#handlers = new Map();
	#state = "idle"; // idle | connecting | open | waiting | closed
	#attempt = 0;
	#timer = 0;

	constructor(
		url,
		{
			WebSocketImpl = globalThis.WebSocket,
			baseMs = 500,
			maxMs = 10_000,
			maxQueue = 50,
			maxAttempts = Number.POSITIVE_INFINITY,
			random = Math.random,
			shouldRetry = isRetryableClose,
		} = {},
	) {
		super();
		this.#url = url;
		this.#opts = {
			WebSocketImpl,
			baseMs,
			maxMs,
			maxQueue,
			maxAttempts,
			random,
			shouldRetry,
		};
	}

	get state() {
		return this.#state;
	}

	get queued() {
		return this.#queue.length;
	}

	connect() {
		if (this.#state !== "idle") return;
		this.#open();
	}

	#open() {
		this.#state = "connecting";
		const ws = new this.#opts.WebSocketImpl(this.#url);
		this.#ws = ws;

		ws.addEventListener("open", () => {
			if (this.#ws !== ws) return;
			this.#state = "open";
			this.#attempt = 0;
			// слухачі "open" надсилають першими (наприклад, join), і лише потім іде черга
			this.dispatchEvent(new CustomEvent("open"));
			this.#flush();
		});
		ws.addEventListener("message", (event) => this.#onMessage(event));
		ws.addEventListener("error", () => {}); // подробиць тут немає, усе прийде в "close"
		ws.addEventListener("close", (event) => {
			if (this.#ws === ws) this.#onClose(event);
		});
	}

	#onMessage(event) {
		let msg;
		try {
			msg = JSON.parse(event.data);
		} catch {
			console.warn("сервер надіслав не JSON");
			return;
		}
		if (typeof msg?.type !== "string") return;
		for (const handler of this.#handlers.get(msg.type) ?? []) {
			try {
				handler(msg);
			} catch (error) {
				console.error(`обробник "${msg.type}":`, error);
			}
		}
	}

	#onClose(event) {
		this.#ws = null;
		const { code, reason } = event;
		const willRetry =
			this.#attempt < this.#opts.maxAttempts && this.#opts.shouldRetry(code);
		this.dispatchEvent(
			new CustomEvent("close", { detail: { code, reason, willRetry } }),
		);
		if (!willRetry) {
			this.#state = "closed";
			return;
		}
		this.#state = "waiting";
		this.#attempt++;
		const delay = backoffDelay(this.#attempt, this.#opts);
		this.dispatchEvent(
			new CustomEvent("reconnecting", {
				detail: { attempt: this.#attempt, delay },
			}),
		);
		this.#timer = setTimeout(() => this.#open(), delay);
	}

	#flush() {
		while (this.#state === "open" && this.#queue.length) {
			this.#ws.send(JSON.stringify(this.#queue.shift()));
		}
	}

	// "sent" | "queued" | "dropped"
	send(message) {
		if (this.#state === "open") {
			this.#ws.send(JSON.stringify(message));
			return "sent";
		}
		if (this.#state === "closed") return "dropped";
		this.#queue.push(message);
		if (this.#queue.length > this.#opts.maxQueue) this.#queue.shift(); // старі не важливі
		return "queued";
	}

	// повертає функцію відписки
	on(type, handler) {
		if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
		this.#handlers.get(type).add(handler);
		return () => this.#handlers.get(type)?.delete(handler);
	}

	// свідоме закриття: без перепідключень і без події "close"
	close(code = 1000, reason = "") {
		clearTimeout(this.#timer);
		this.#queue.length = 0;
		const ws = this.#ws;
		this.#ws = null;
		this.#state = "closed";
		ws?.close(code, reason);
	}
}
