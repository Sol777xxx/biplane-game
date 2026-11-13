import { MSG, make, makeInput } from "biplane-shared/protocol/index.js";
import { Connection, isRetryableClose } from "./connection.js";

const CLOSE_TEXT = {
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

export function describeClose(code) {
	return CLOSE_TEXT[code] ?? `З'єднання закрито (код ${code})`;
}

export class JoinError extends Error {
	constructor(code, reason) {
		super(describeClose(code));
		this.name = "JoinError";
		this.code = code;
		this.reason = reason;
	}
}

export function describeJoinError(error) {
	if (error instanceof JoinError) return error.message;
	if (error?.name === "TimeoutError") return "Сервер не відповів вчасно";
	if (error?.name === "AbortError") return "Підключення скасовано";
	return error?.message ?? String(error);
}

// Сеанс у кімнаті. Події: "roster" (players), "chat" (повідомлення), "snapshot" (знімок гри),
// "pong" ({ rtt, t }), "netsim" ({ enabled, lag, jitter, loss }),
// "status" ({ state: "online" | "reconnecting" | "closed", ... }).
export class RoomSession extends EventTarget {
	#conn;
	#joined = false;
	#seq = 0;
	you = null;
	room = null;
	players = [];
	snapshot = null; // останній знімок гри: повне повідомлення сервера
	netsim = null; // стан штучної мережі, відомий із відповіді сервера (null: сервер не казав)

	constructor(url, { room, name, connection = {} }) {
		super();
		const conn = new Connection(url, {
			...connection,
			// Після обриву сервер ще може вважати нас у кімнаті (він помітить це за heartbeat).
			// Тоді повторний join дає 4007 "ім'я зайняте": це теж тимчасово.
			shouldRetry: (code) =>
				isRetryableClose(code) || (this.#joined && code === 4007),
		});
		this.#conn = conn;

		// join іде першим при кожному (пере)підключенні, ще до черги повідомлень.
		// Сервер після join створює нового гравця з порожньою чергою input, тож і seq починаємо з 1.
		conn.addEventListener("open", () => {
			this.#seq = 0;
			conn.send({ v: 1, type: "join", room, name });
		});

		conn.on("joined", (m) => {
			this.#joined = true;
			this.you = m.you;
			this.room = m.room;
			this.players = m.players;
			this.#emit("roster", this.players);
			this.#emit("status", { state: "online" });
		});
		conn.on("roster", (m) => {
			this.players = m.players;
			this.#emit("roster", m.players);
		});
		conn.on("chat", (m) => this.#emit("chat", m));
		conn.on("snapshot", (m) => {
			this.snapshot = m;
			this.#emit("snapshot", m);
		});
		conn.on("pong", (m) => {
			if (typeof m.t !== "number") return;
			this.#emit("pong", { t: m.t, rtt: Math.max(0, performance.now() - m.t) });
		});
		conn.on("netsim", (m) => {
			this.netsim = {
				enabled: m.enabled === true,
				lag: Number(m.lag) || 0,
				jitter: Number(m.jitter) || 0,
				loss: Number(m.loss) || 0,
			};
			this.#emit("netsim", this.netsim);
		});

		conn.addEventListener("reconnecting", (e) =>
			this.#emit("status", { state: "reconnecting", ...e.detail }),
		);
		conn.addEventListener("close", (e) => {
			if (!e.detail.willRetry)
				this.#emit("status", { state: "closed", ...e.detail });
		});
	}

	#emit(type, detail) {
		this.dispatchEvent(new CustomEvent(type, { detail }));
	}

	get lastSeq() {
		return this.#seq;
	}

	// накопичені байти й повідомлення з'єднання (див. Connection.traffic)
	get traffic() {
		return this.#conn.traffic;
	}

	connect() {
		this.#conn.connect();
	}

	chat(text) {
		return this.#conn.send({ v: 1, type: "chat", text });
	}

	// Надсилає стан клавіш. Повертає seq надісланого input або 0, якщо не надіслано.
	// Input ніколи не стоїть у черзі: після відновлення зв'язку він був би застарілим.
	sendInput(keys) {
		if (!this.#joined || this.#conn.state !== "open") return 0;
		const seq = this.#seq + 1;
		if (this.#conn.send(makeInput(seq, keys)) !== "sent") return 0;
		this.#seq = seq;
		return seq;
	}

	// ping для виміру RTT; відповідь приходить подією "pong". Як і input, у чергу не стає.
	ping() {
		if (!this.#joined || this.#conn.state !== "open") return false;
		return this.#conn.send(make(MSG.PING, { t: performance.now() })) === "sent";
	}

	// Змінює штучну мережу сервера (відповідь: подія "netsim"). Сервер без ENABLE_NETSIM
	// відповідає enabled: false.
	setNetsim({ lag = 0, jitter = 0, loss = 0 } = {}) {
		return this.#conn.send(
			make(MSG.NETSIM, {
				lag: Math.round(lag),
				jitter: Math.round(jitter),
				loss,
			}),
		);
	}

	leave() {
		this.#conn.close(1000, "leave");
	}
}

// Входить у кімнату: resolve після першого "joined"; reject, якщо сервер закрив
// сокет із фатальним кодом (кімната заповнена тощо) або вичерпано час / скасовано signal.
export function joinRoom(
	url,
	{ room, name, connection, signal = AbortSignal.timeout(8000) } = {},
) {
	const session = new RoomSession(url, { room, name, connection });
	return new Promise((resolve, reject) => {
		const finish = (settle, value) => {
			signal.removeEventListener("abort", onAbort);
			session.removeEventListener("status", onStatus);
			settle(value);
		};
		const onAbort = () => {
			session.leave(); // без цього перепідключення тривали б у фоні
			finish(reject, signal.reason);
		};
		const onStatus = (e) => {
			const { state, code, reason } = e.detail;
			if (state === "online") finish(resolve, session);
			else if (state === "closed") finish(reject, new JoinError(code, reason));
		};

		session.addEventListener("status", onStatus);
		if (signal.aborted) return onAbort();
		signal.addEventListener("abort", onAbort, { once: true });
		session.connect();
	});
}
