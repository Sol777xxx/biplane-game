// Обгортка WebSocket: dispatch за type, черга send, перепідключення з backoff.
// Події життєвого циклу (EventTarget): "open", "close" { code, reason, willRetry },
// "reconnecting" { attempt, delay }. Повідомлення сервера: on(type, handler).
// Текстові кадри це JSON, який перевіряє схема протоколу; бінарні це знімки
// (shared/codec/binary.ts), їх теж віддаємо як on("snapshot").
import {
	CodecError,
	decodeSnapshot,
	FRAME,
	frameType,
} from "biplane-shared/codec/binary.ts";
import type { Frame } from "biplane-shared/codec/codec.ts";
import {
	type ClientMessage,
	parseServerMessage,
	type ServerMessage,
	type ServerOf,
	type ServerType,
} from "biplane-shared/protocol/index.ts";
import { assertNever } from "biplane-shared/sim/never.ts";
import { TypedTarget } from "./typedTarget.ts";

// Перепідключаємось лише після тимчасових обривів. 4xxx (порушення протоколу,
// кімната заповнена) і 1000 повтором не лікуються.
const RETRYABLE: ReadonlySet<number> = new Set([1001, 1006, 1011, 1012, 1013]);
export const isRetryableClose = (code: number): boolean => RETRYABLE.has(code);

export interface BackoffOptions {
	readonly baseMs?: number;
	readonly maxMs?: number;
	readonly random?: () => number;
}

// exponential backoff з "equal jitter": половина детермінована, половина випадкова,
// тож клієнти не прокидаються всі разом, але й миттєвих повторів немає
export function backoffDelay(
	attempt: number,
	{ baseMs = 500, maxMs = 10_000, random = Math.random }: BackoffOptions = {},
): number {
	const cap = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
	return cap / 2 + (random() * cap) / 2;
}

// розмір кадру в байтах: рядок рахуємо в UTF-8, бінарний кадр має свою довжину
const encoder = new TextEncoder();
const sizeOf = (data: unknown): number => {
	if (typeof data === "string") return encoder.encode(data).length;
	if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
		return data.byteLength;
	}
	return 0;
};

export interface ConnectionOptions extends BackoffOptions {
	readonly WebSocketImpl?: new (url: string) => WebSocket;
	readonly maxQueue?: number;
	readonly maxAttempts?: number;
	readonly shouldRetry?: (code: number) => boolean;
}

export type ConnectionState =
	| "idle"
	| "connecting"
	| "open"
	| "waiting"
	| "closed";

export interface CloseInfo {
	readonly code: number;
	readonly reason: string;
	readonly willRetry: boolean;
}

export interface ReconnectInfo {
	readonly attempt: number;
	readonly delay: number;
}

export interface ConnectionEvents {
	open: null;
	close: CloseInfo;
	reconnecting: ReconnectInfo;
}

export interface Traffic {
	bytesIn: number;
	bytesOut: number;
	msgsIn: number;
	msgsOut: number;
}

export type SendResult = "sent" | "queued" | "dropped";

export type ServerHandler<T extends ServerType> = (msg: ServerOf<T>) => void;

// Обробники по одному набору на кожен тип повідомлення сервера. Тип { [T in …] } змушує
// мати набір для КОЖНОГО типу, а в дужках T зв'язує тип із його обробником.
type HandlerTable = { readonly [T in ServerType]: Set<ServerHandler<T>> };

const newHandlers = (): HandlerTable => ({
	joined: new Set(),
	roster: new Set(),
	chat: new Set(),
	error: new Set(),
	pong: new Set(),
	netsim: new Set(),
	snapshot: new Set(),
});

type Settings = Required<Omit<ConnectionOptions, "WebSocketImpl">> &
	Pick<Required<ConnectionOptions>, "WebSocketImpl">;

export class Connection extends TypedTarget<ConnectionEvents> {
	#url: string;
	#opts: Settings;
	#ws: WebSocket | null = null;
	#queue: ClientMessage[] = [];
	#handlers = newHandlers();
	#state: ConnectionState = "idle";
	#attempt = 0;
	#timer = 0;
	// лише корисне навантаження кадрів, без заголовків WebSocket і TCP
	#traffic: Traffic = { bytesIn: 0, bytesOut: 0, msgsIn: 0, msgsOut: 0 };

	constructor(
		url: string,
		{
			WebSocketImpl = globalThis.WebSocket,
			baseMs = 500,
			maxMs = 10_000,
			maxQueue = 50,
			maxAttempts = Number.POSITIVE_INFINITY,
			random = Math.random,
			shouldRetry = isRetryableClose,
		}: ConnectionOptions = {},
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

	get state(): ConnectionState {
		return this.#state;
	}

	get queued(): number {
		return this.#queue.length;
	}

	// накопичені лічильники (копія): різниця між двома викликами дає швидкість
	get traffic(): Traffic {
		return { ...this.#traffic };
	}

	connect(): void {
		if (this.#state !== "idle") return;
		this.#open();
	}

	#open(): void {
		this.#state = "connecting";
		const ws = new this.#opts.WebSocketImpl(this.#url);
		ws.binaryType = "arraybuffer";
		this.#ws = ws;

		ws.addEventListener("open", () => {
			if (this.#ws !== ws) return;
			this.#state = "open";
			this.#attempt = 0;
			// слухачі "open" надсилають першими (наприклад, join), і лише потім іде черга
			this.emit("open", null);
			this.#flush();
		});
		ws.addEventListener("message", (event) => this.#onMessage(event.data));
		ws.addEventListener("error", () => {}); // подробиць тут немає, усе прийде в "close"
		ws.addEventListener("close", (event) => {
			if (this.#ws === ws) this.#onClose(event.code, event.reason);
		});
	}

	// бінарний кадр у повідомлення; зламаний або чужий кадр ігноруємо
	#decodeBinary(data: unknown): ServerMessage | null {
		try {
			if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
				const frame: Frame = data;
				if (frameType(frame)?.type === FRAME.SNAPSHOT) {
					return decodeSnapshot(frame);
				}
			}
		} catch (error) {
			if (!(error instanceof CodecError)) throw error;
		}
		console.warn("сервер надіслав некоректний бінарний кадр");
		return null;
	}

	// текстовий кадр у повідомлення: спершу JSON, потім схема протоколу
	#decodeText(data: string): ServerMessage | null {
		let raw: unknown;
		try {
			raw = JSON.parse(data);
		} catch {
			console.warn("сервер надіслав не JSON");
			return null;
		}
		const parsed = parseServerMessage(raw);
		if (!parsed.ok) {
			console.warn(`сервер надіслав некоректне повідомлення: ${parsed.reason}`);
			return null;
		}
		return parsed.msg;
	}

	#onMessage(data: unknown): void {
		this.#traffic.bytesIn += sizeOf(data);
		this.#traffic.msgsIn++;
		const msg =
			typeof data === "string"
				? this.#decodeText(data)
				: this.#decodeBinary(data);
		if (msg) this.#dispatch(msg);
	}

	// Один case на тип: у кожному msg уже звужений до свого варіанта, а default це never,
	// тож новий тип повідомлення сервера без гілки тут це помилка tsc.
	#dispatch(msg: ServerMessage): void {
		switch (msg.type) {
			case "joined":
				this.#deliver("joined", msg);
				return;
			case "roster":
				this.#deliver("roster", msg);
				return;
			case "chat":
				this.#deliver("chat", msg);
				return;
			case "error":
				this.#deliver("error", msg);
				return;
			case "pong":
				this.#deliver("pong", msg);
				return;
			case "netsim":
				this.#deliver("netsim", msg);
				return;
			case "snapshot":
				this.#deliver("snapshot", msg);
				return;
			default:
				assertNever(msg, "повідомлення сервера");
		}
	}

	#deliver<T extends ServerType>(type: T, msg: ServerOf<T>): void {
		for (const handler of this.#handlers[type]) {
			try {
				handler(msg);
			} catch (error) {
				console.error(`обробник "${type}":`, error);
			}
		}
	}

	#onClose(code: number, reason: string): void {
		this.#ws = null;
		const willRetry =
			this.#attempt < this.#opts.maxAttempts && this.#opts.shouldRetry(code);
		this.emit("close", { code, reason, willRetry });
		if (!willRetry) {
			this.#state = "closed";
			return;
		}
		this.#state = "waiting";
		this.#attempt++;
		const delay = backoffDelay(this.#attempt, this.#opts);
		this.emit("reconnecting", { attempt: this.#attempt, delay });
		this.#timer = setTimeout(() => this.#open(), delay);
	}

	// єдине місце, де текстовий кадр іде в сокет: тут же рахуємо байти
	#transmit(message: ClientMessage): void {
		const data = JSON.stringify(message);
		this.#ws?.send(data);
		this.#traffic.bytesOut += sizeOf(data);
		this.#traffic.msgsOut++;
	}

	#flush(): void {
		for (
			let next = this.#queue.shift();
			next && this.#state === "open";
			next = this.#queue.shift()
		) {
			this.#transmit(next);
		}
	}

	send(message: ClientMessage): SendResult {
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
	sendBinary(bytes: Uint8Array<ArrayBuffer>): "sent" | "dropped" {
		if (this.#state !== "open" || !this.#ws) return "dropped";
		this.#ws.send(bytes);
		this.#traffic.bytesOut += bytes.byteLength;
		this.#traffic.msgsOut++;
		return "sent";
	}

	// повертає функцію відписки
	on<T extends ServerType>(type: T, handler: ServerHandler<T>): () => void {
		const handlers = this.#handlers[type];
		handlers.add(handler);
		return () => {
			handlers.delete(handler);
		};
	}

	// свідоме закриття: без перепідключень і без події "close"
	close(code = 1000, reason = ""): void {
		clearTimeout(this.#timer);
		this.#queue.length = 0;
		const ws = this.#ws;
		this.#ws = null;
		this.#state = "closed";
		ws?.close(code, reason);
	}
}
