// Обгортка WebSocket: dispatch за type, черга send, перепідключення з backoff.
// Події життєвого циклу (EventTarget): "open", "close" { code, reason, willRetry },
// "reconnecting" { attempt, delay }. Повідомлення сервера: on(type, handler).
// Текстові кадри це JSON; бінарні це знімки (shared/codec/binary.js), їх теж віддаємо як
// on("snapshot").
import {
	CodecError,
	decodeSnapshot,
	FRAME,
	frameType,
} from "biplane-shared/codec/binary.js";

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

// розмір кадру в байтах: рядок рахуємо в UTF-8, бінарний кадр має свою довжину
const encoder = new TextEncoder();
const sizeOf = (data) =>
	typeof data === "string"
		? encoder.encode(data).length
		: (data?.byteLength ?? 0);

export class Connection extends EventTarget {
	#url;
	#opts;
	#ws = null;
	#queue = [];
	#handlers = new Map();
	#state = "idle"; // idle | connecting | open | waiting | closed
	#attempt = 0;
	#timer = 0;
	// лише корисне навантаження кадрів, без заголовків WebSocket і TCP
	#traffic = { bytesIn: 0, bytesOut: 0, msgsIn: 0, msgsOut: 0 };

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

	// накопичені лічильники (копія): різниця між двома викликами дає швидкість
	get traffic() {
		return { ...this.#traffic };
	}

	connect() {
		if (this.#state !== "idle") return;
		this.#open();
	}

	#open() {
		this.#state = "connecting";
		const ws = new this.#opts.WebSocketImpl(this.#url);
		ws.binaryType = "arraybuffer";
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

	// бінарний кадр у повідомлення; зламаний або чужий кадр ігноруємо
	#decodeBinary(data) {
		try {
			if (frameType(data)?.type === FRAME.SNAPSHOT) return decodeSnapshot(data);
		} catch (error) {
			if (!(error instanceof CodecError)) throw error;
		}
		console.warn("сервер надіслав некоректний бінарний кадр");
		return null;
	}

	#onMessage(event) {
		const { data } = event;
		this.#traffic.bytesIn += sizeOf(data);
		this.#traffic.msgsIn++;
		let msg = null;
		if (typeof data === "string") {
			try {
				msg = JSON.parse(data);
			} catch {
				console.warn("сервер надіслав не JSON");
				return;
			}
		} else {
			msg = this.#decodeBinary(data);
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

	// єдине місце, де текстовий кадр іде в сокет: тут же рахуємо байти
	#transmit(message) {
		const data = JSON.stringify(message);
		this.#ws.send(data);
		this.#traffic.bytesOut += sizeOf(data);
		this.#traffic.msgsOut++;
	}

	#flush() {
		while (this.#state === "open" && this.#queue.length) {
			this.#transmit(this.#queue.shift());
		}
	}

	// "sent" | "queued" | "dropped"
	send(message) {
		if (this.#state === "open") {
			this.#transmit(message);
			return "sent";
		}
		if (this.#state === "closed") return "dropped";
		this.#queue.push(message);
		if (this.#queue.length > this.#opts.maxQueue) this.#queue.shift(); // старі не важливі
		return "queued";
	}

	// Бінарний кадр (input). У чергу не стає: після відновлення зв'язку він був би застарілим.
	// "sent" | "dropped"
	sendBinary(bytes) {
		if (this.#state !== "open") return "dropped";
		this.#ws.send(bytes);
		this.#traffic.bytesOut += bytes.byteLength;
		this.#traffic.msgsOut++;
		return "sent";
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
