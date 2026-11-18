import { type Codec, getCodec } from "biplane-shared/codec/index.ts";
import {
	make,
	makeInput,
	PROTOCOL_VERSION,
	type RoomSummary,
	type ServerOf,
	type SnapshotMessage,
} from "biplane-shared/protocol/index.ts";
import { toSeq } from "biplane-shared/sim/ids.ts";
import {
	type CloseInfo,
	Connection,
	type ConnectionOptions,
	isRetryableClose,
	type ReconnectInfo,
} from "./connection.ts";
import { TypedTarget } from "./typedTarget.ts";

const CLOSE_TEXT: Readonly<Record<number, string>> = {
	1001: "Сервер завершує роботу",
	1006: "Немає зв'язку з сервером",
	4000: "Некоректне повідомлення",
	4002: "Не надіслано join вчасно",
	4004: "Ви вже в кімнаті",
	4005: "Кімнату не знайдено (її могли закрити)",
	4006: "Кімната заповнена",
	4007: "Таке ім'я вже є в кімнаті",
	4008: "Забагато повідомлень",
	4009: "Зв'язок надто повільний",
};

export function describeClose(code: number): string {
	return CLOSE_TEXT[code] ?? `З'єднання закрито (код ${code})`;
}

export class JoinError extends Error {
	readonly code: number;
	readonly reason: string;

	constructor(code: number, reason: string) {
		super(describeClose(code));
		this.name = "JoinError";
		this.code = code;
		this.reason = reason;
	}
}

// у catch і reject лежить unknown: поле читаємо лише після перевірки, що це об'єкт
const field = (value: unknown, key: "name" | "message"): unknown =>
	typeof value === "object" && value !== null
		? Reflect.get(value, key)
		: undefined;

export function describeJoinError(error: unknown): string {
	if (error instanceof JoinError) return error.message;
	const name = field(error, "name");
	if (name === "TimeoutError") return "Сервер не відповів вчасно";
	if (name === "AbortError") return "Підключення скасовано";
	const message = field(error, "message");
	return typeof message === "string" ? message : String(error);
}

// адреса сокета з ?codec=binary (інші параметри зберігаються)
function withBinary(url: string): string {
	const u = new URL(url);
	u.searchParams.set("codec", "binary");
	return u.toString();
}

export type RosterEntry = ServerOf<"roster">["players"][number];
export type { RoomSummary };
export type ChatMessage = ServerOf<"chat">;

export interface Pong {
	readonly t: number;
	readonly rtt: number;
}

export interface NetsimState {
	readonly enabled: boolean;
	readonly lag: number;
	readonly jitter: number;
	readonly loss: number;
}

export type SessionStatus =
	| { readonly state: "online" }
	| ({ readonly state: "reconnecting" } & ReconnectInfo)
	| ({ readonly state: "closed" } & CloseInfo);

// Події сеансу: назва → що лежить у detail.
export interface RoomSessionEvents {
	roster: readonly RosterEntry[];
	chat: ChatMessage;
	snapshot: SnapshotMessage;
	pong: Pong;
	netsim: NetsimState;
	status: SessionStatus;
}

export interface RoomSessionOptions {
	readonly room: string;
	readonly name: string;
	readonly connection?: ConnectionOptions;
	readonly codec?: "json" | "binary";
}

// Сеанс у кімнаті. Події: "roster" (players), "chat" (повідомлення), "snapshot" (знімок гри),
// "pong" ({ rtt, t }), "netsim" ({ enabled, lag, jitter, loss }),
// "status" ({ state: "online" | "reconnecting" | "closed", ... }).
// codec: "json" (за замовчуванням) або "binary": у якому форматі шлемо input і просимо знімки.
export class RoomSession extends TypedTarget<RoomSessionEvents> {
	#conn: Connection;
	#codec: Codec;
	#joined = false;
	#seq = 0;
	you: RosterEntry | null = null;
	room: RoomSummary | null = null;
	players: readonly RosterEntry[] = [];
	snapshot: SnapshotMessage | null = null; // останній знімок гри: повне повідомлення сервера
	netsim: NetsimState | null = null; // стан штучної мережі, відомий із відповіді сервера

	constructor(
		url: string,
		{ room, name, connection = {}, codec = "json" }: RoomSessionOptions,
	) {
		super();
		this.#codec = codec === "binary" ? getCodec("binary") : getCodec("json");
		const conn = new Connection(this.#codec.isBinary ? withBinary(url) : url, {
			...connection,
			// Після обриву сервер ще може вважати нас у кімнаті (він помітить це за heartbeat).
			// Тоді повторний join дає 4007 "ім'я зайняте": це теж тимчасово.
			shouldRetry: (code) =>
				isRetryableClose(code) || (this.#joined && code === 4007),
		});
		this.#conn = conn;

		// join іде першим при кожному (пере)підключенні, ще до черги повідомлень.
		// Сервер після join створює нового гравця з порожньою чергою input, тож і seq починаємо з 1.
		conn.listen("open", () => {
			this.#seq = 0;
			conn.send({ v: PROTOCOL_VERSION, type: "join", room, name });
		});

		conn.on("joined", (m) => {
			this.#joined = true;
			this.you = m.you;
			this.room = m.room;
			this.players = m.players;
			this.emit("roster", this.players);
			this.emit("status", { state: "online" });
		});
		conn.on("roster", (m) => {
			this.players = m.players;
			this.emit("roster", m.players);
		});
		conn.on("chat", (m) => this.emit("chat", m));
		conn.on("snapshot", (m) => {
			this.snapshot = m;
			this.emit("snapshot", m);
		});
		conn.on("pong", (m) => {
			this.emit("pong", { t: m.t, rtt: Math.max(0, performance.now() - m.t) });
		});
		conn.on("netsim", (m) => {
			this.netsim = {
				enabled: m.enabled,
				lag: m.lag,
				jitter: m.jitter,
				loss: m.loss,
			};
			this.emit("netsim", this.netsim);
		});

		conn.listen("reconnecting", (info) =>
			this.emit("status", { state: "reconnecting", ...info }),
		);
		conn.listen("close", (info) => {
			if (!info.willRetry) this.emit("status", { state: "closed", ...info });
		});
	}

	get codec(): string {
		return this.#codec.name;
	}

	get lastSeq(): number {
		return this.#seq;
	}

	// накопичені байти й повідомлення з'єднання (див. Connection.traffic)
	get traffic() {
		return this.#conn.traffic;
	}

	connect(): void {
		this.#conn.connect();
	}

	chat(text: string) {
		return this.#conn.send({ v: PROTOCOL_VERSION, type: "chat", text });
	}

	// Надсилає стан клавіш. Повертає seq надісланого input або 0, якщо не надіслано.
	// Input ніколи не стоїть у черзі: після відновлення зв'язку він був би застарілим.
	sendInput(
		keys: Readonly<Record<string, unknown>> | null | undefined,
	): number {
		if (!this.#joined || this.#conn.state !== "open") return 0;
		const seq = toSeq(this.#seq + 1);
		const sent = this.#codec.isBinary
			? this.#conn.sendBinary(this.#codec.encodeInput(seq, keys))
			: this.#conn.send(makeInput(seq, keys));
		if (sent !== "sent") return 0;
		this.#seq = seq;
		return seq;
	}

	// ping для виміру RTT; відповідь приходить подією "pong". Як і input, у чергу не стає.
	ping(): boolean {
		if (!this.#joined || this.#conn.state !== "open") return false;
		return this.#conn.send(make("ping", { t: performance.now() })) === "sent";
	}

	// Змінює штучну мережу сервера (відповідь: подія "netsim"). Сервер без ENABLE_NETSIM
	// відповідає enabled: false.
	setNetsim({
		lag = 0,
		jitter = 0,
		loss = 0,
	}: {
		lag?: number;
		jitter?: number;
		loss?: number;
	} = {}) {
		return this.#conn.send({
			v: PROTOCOL_VERSION,
			type: "netsim",
			lag: Math.round(lag),
			jitter: Math.round(jitter),
			loss,
		});
	}

	leave(): void {
		this.#conn.close(1000, "leave");
	}
}

export interface JoinOptions {
	readonly room: string;
	readonly name: string;
	readonly connection?: ConnectionOptions;
	readonly codec?: "json" | "binary";
	readonly signal?: AbortSignal;
}

// Входить у кімнату: resolve після першого "joined"; reject, якщо сервер закрив
// сокет із фатальним кодом (кімната заповнена тощо) або вичерпано час / скасовано signal.
export function joinRoom(
	url: string,
	{
		room,
		name,
		connection,
		codec,
		signal = AbortSignal.timeout(8000),
	}: JoinOptions,
): Promise<RoomSession> {
	const session = new RoomSession(url, { room, name, connection, codec });
	return new Promise((resolve, reject) => {
		let stopStatus = () => {};
		const done = (): void => {
			signal.removeEventListener("abort", onAbort);
			stopStatus();
		};
		const onAbort = (): void => {
			session.leave(); // без цього перепідключення тривали б у фоні
			done();
			reject(signal.reason);
		};

		stopStatus = session.listen("status", (status) => {
			if (status.state === "online") {
				done();
				resolve(session);
			} else if (status.state === "closed") {
				done();
				reject(new JoinError(status.code, status.reason));
			}
		});
		if (signal.aborted) return onAbort();
		signal.addEventListener("abort", onAbort, { once: true });
		session.connect();
	});
}
