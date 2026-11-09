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

// Сеанс у кімнаті. Події: "roster" (players), "chat" (повідомлення),
// "status" ({ state: "online" | "reconnecting" | "closed", ... }).
export class RoomSession extends EventTarget {
	#conn;
	#joined = false;
	you = null;
	room = null;
	players = [];

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

		// join іде першим при кожному (пере)підключенні, ще до черги повідомлень
		conn.addEventListener("open", () =>
			conn.send({ v: 1, type: "join", room, name }),
		);

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

	connect() {
		this.#conn.connect();
	}

	chat(text) {
		return this.#conn.send({ v: 1, type: "chat", text });
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
