import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { inputFromMessage } from "biplane-shared/protocol/index.js";
import { WebSocketServer } from "ws";
import { TokenBucket } from "./limits.js";
import { CLOSE, MAX_MESSAGE_BYTES, make, validate } from "./protocol.js";
import { RoomError } from "./rooms.js";

export const WS_DEFAULTS = Object.freeze({
	joinTimeoutMs: 5000, // join має прийти за 5 с
	pingIntervalMs: 15_000, // ping раз на 15 с
	maxMissedPongs: 2, // два пропущені pong: розрив
	maxPayload: MAX_MESSAGE_BYTES,
	// три відра: сирий кадр (груба стеля до розбору), керування (join/chat/leave) і input
	frameCapacity: 90,
	frameRefillPerSec: 60,
	rateCapacity: 10, // керування: сплеск до 10 повідомлень
	rateRefillPerSec: 5, // і в середньому 5 за секунду
	inputCapacity: 60, // input йде ~30/с: сплеск на 2 с і запас на нерівномірну мережу
	inputRefillPerSec: 40,
	softBufferBytes: 16 * 1024, // вище: chat цьому клієнтові не шлемо
	hardBufferBytes: 256 * 1024, // вище: розриваємо з'єднання
});

const ROOM_ERROR_CODES = {
	full: CLOSE.ROOM_FULL,
	name_taken: CLOSE.NAME_TAKEN,
	already_joined: CLOSE.ALREADY_JOINED,
};

export function attachWebSocket({ server, rooms, log, ...options }) {
	const opts = { ...WS_DEFAULTS, ...options };
	// noServer: upgrade обробляємо самі, щоб приймати лише шлях /ws
	const wss = new WebSocketServer({
		noServer: true,
		maxPayload: opts.maxPayload,
	});
	wss.on("error", (error) => log.error("wss:", error));

	server.on("upgrade", (req, socket, head) => {
		const { pathname } = new URL(req.url, "http://x");
		if (pathname !== "/ws") {
			socket.on("error", () => {}); // сирий сокет теж EventEmitter з "error"
			socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
			return;
		}
		wss.handleUpgrade(req, socket, head, (ws) =>
			wss.emit("connection", ws, req),
		);
	});

	// ---------- надсилання й закриття ----------

	// Клієнт, який не читає, змушує сервер тримати все в буфері сокета; при розсилці
	// на N клієнтів це N копій. bufferedAmount це байти, які ws прийняв, але ще не віддав у мережу.
	// droppable: повідомлення, яке не шкода втратити (chat). Стан (roster, joined, error) не відкидається.
	function send(ws, message, { droppable = false } = {}) {
		if (ws.readyState !== ws.OPEN) return;
		const s = ws.session;
		const buffered = ws.bufferedAmount;

		if (buffered > opts.hardBufferBytes) return closeSlow(ws, buffered);
		if (droppable && buffered > opts.softBufferBytes) {
			if (!s.dropping) {
				s.dropping = true;
				log.warn(
					`[${s.id}] повільний клієнт (${buffered} Б у буфері): відкидаємо chat`,
				);
			}
			s.dropped++;
			return;
		}
		s.dropping = false;

		ws.send(JSON.stringify(message), (error) => {
			if (error) log.warn(`[${s.id}] send: ${error.message}`);
		});
	}

	function closeSlow(ws, buffered) {
		const s = ws.session;
		if (s.slow) return;
		s.slow = true;
		log.warn(
			`[${s.id}] повільний клієнт: ${buffered} Б у буфері (відкинуто chat: ${s.dropped}), розрив`,
		);
		ws.close(CLOSE.SLOW_CLIENT, "slow client");
		// close-кадр стоїть у черзі за буфером, а клієнт його не читає: через 1 с рубаємо
		const timer = setTimeout(() => ws.terminate(), 1000);
		timer.unref();
		ws.once("close", () => clearTimeout(timer));
	}

	// порушення протоколу: пояснюємо повідомленням і закриваємо з кодом
	function reject(ws, code, reason) {
		log.warn(`[${ws.session.id}] закрито ${code}: ${reason}`);
		send(ws, make("error", { code, message: reason }));
		ws.close(code, reason); // reason у close-кадрі максимум 123 байти
	}

	// ---------- підписка сокета на події кімнати ----------
	// Кімната нічого не знає про сокети: кожен сокет підписується сам.
	function subscribe(ws, room) {
		const onChat = (message) =>
			send(ws, make("chat", message), { droppable: true });
		const onRoster = () => send(ws, make("roster", { players: room.roster() }));
		room.on("chat", onChat);
		room.on("join", onRoster);
		room.on("leave", onRoster);
		return () => {
			room.off("chat", onChat);
			room.off("join", onRoster);
			room.off("leave", onRoster);
		};
	}

	function detach(ws) {
		const s = ws.session;
		clearTimeout(s.joinTimer);
		s.unsubscribe?.();
		s.unsubscribe = null;
		if (s.room && s.player) s.room.leave(s.player.id); // інші отримають roster
		s.room = null;
		s.player = null;
	}

	// ---------- повідомлення ----------
	function handleJoin(ws, msg) {
		const s = ws.session;
		const room = rooms.get(msg.room);
		if (!room) return reject(ws, CLOSE.ROOM_NOT_FOUND, "room not found");

		let player;
		try {
			player = room.join({ id: s.id, name: msg.name });
		} catch (error) {
			const code =
				error instanceof RoomError ? ROOM_ERROR_CODES[error.code] : undefined;
			if (!code) throw error;
			return reject(ws, code, error.code.replaceAll("_", " "));
		}

		clearTimeout(s.joinTimer);
		s.player = player;
		s.room = room;
		send(
			ws,
			make("joined", {
				you: { id: player.id, name: player.name },
				room: room.summary(),
				players: room.roster(),
			}),
		);
		s.unsubscribe = subscribe(ws, room);
		log.info(`[${s.id}] ${player.name} зайшов у ${room.id}`);
	}

	function onMessage(ws, data, isBinary) {
		// після закриття з нашого боку решту повідомлень у черзі ігноруємо
		if (ws.readyState !== ws.OPEN) return;
		const s = ws.session;
		// ліміт кадрів стоїть ПЕРШИМ: порахувати повідомлення дешевше, ніж розібрати його
		if (!s.frameBucket.take()) {
			return reject(ws, CLOSE.RATE_LIMIT, "rate limit");
		}

		if (isBinary)
			return reject(ws, CLOSE.UNSUPPORTED, "binary frames not supported");

		let raw;
		try {
			raw = JSON.parse(data.toString("utf8"));
		} catch {
			return reject(ws, CLOSE.BAD_FORMAT, "invalid json");
		}
		const result = validate(raw);
		if (!result.ok) return reject(ws, result.code, result.reason);

		const { msg } = result;
		// окреме відро на тип: часті input не з'їдають ліміт чату, а спам чату не душить input.
		// ping окремого відра не має: його обмежує стеля кадрів.
		const bucket =
			msg.type === "input"
				? s.inputBucket
				: msg.type === "ping"
					? null
					: s.bucket;
		if (bucket && !bucket.take()) {
			return reject(ws, CLOSE.RATE_LIMIT, "rate limit");
		}

		if (!s.player) {
			if (msg.type !== "join")
				return reject(ws, CLOSE.NOT_JOINED, "join first");
			return handleJoin(ws, msg);
		}
		switch (msg.type) {
			case "join":
				return reject(ws, CLOSE.ALREADY_JOINED, "already joined");
			case "chat":
				s.room.chat(s.player.id, msg.text); // подію отримають усі в кімнаті
				return;
			case "input":
				// Сервер лише передає input кімнаті; Match підписується на цю подію
				s.room.emit("input", {
					playerId: s.player.id,
					seq: msg.seq,
					keys: inputFromMessage(msg),
				});
				return;
			case "ping":
				send(ws, make("pong", { t: msg.t }));
				return;
			case "leave":
				detach(ws);
				ws.close(CLOSE.NORMAL, "bye");
				return;
		}
	}

	wss.on("connection", (ws) => {
		const s = {
			id: randomBytes(4).toString("hex"),
			player: null,
			room: null,
			missedPongs: 0,
			joinTimer: null,
			unsubscribe: null,
			frameBucket: new TokenBucket({
				capacity: opts.frameCapacity,
				refillPerSec: opts.frameRefillPerSec,
			}),
			bucket: new TokenBucket({
				capacity: opts.rateCapacity,
				refillPerSec: opts.rateRefillPerSec,
			}),
			inputBucket: new TokenBucket({
				capacity: opts.inputCapacity,
				refillPerSec: opts.inputRefillPerSec,
			}),
			dropping: false,
			dropped: 0,
			slow: false,
		};
		ws.session = s; // { player, room } на кожному сокеті

		// "error" першим рядком: без нього помилка сокета (наприклад, завеликий кадр)
		// стала б необробленою подією і завалила б увесь процес
		ws.on("error", (error) =>
			log.warn(`[${s.id}] помилка сокета: ${error.message}`),
		);

		s.joinTimer = setTimeout(
			() => reject(ws, CLOSE.JOIN_TIMEOUT, "join timeout"),
			opts.joinTimeoutMs,
		);

		ws.on("pong", () => {
			s.missedPongs = 0;
		});

		ws.on("message", (data, isBinary) => {
			// виняток в обробнику події не має куди підніматись: він би завалив процес
			try {
				onMessage(ws, data, isBinary);
			} catch (error) {
				log.error(`[${s.id}] помилка обробника:`, error);
				ws.close(CLOSE.INTERNAL, "internal error");
			}
		});

		ws.on("close", () => detach(ws));
	});

	// ---------- heartbeat ----------
	const heartbeat = setInterval(() => {
		for (const ws of wss.clients) {
			const s = ws.session;
			if (s.missedPongs >= opts.maxMissedPongs) {
				log.warn(`[${s.id}] немає pong, розрив`);
				ws.terminate();
				continue;
			}
			s.missedPongs++;
			ws.ping();
		}
	}, opts.pingIntervalMs);
	heartbeat.unref();

	// ---------- завершення ----------
	async function shutdown() {
		clearInterval(heartbeat);
		const closing = [...wss.clients].map(
			(ws) =>
				new Promise((resolve) => {
					ws.once("close", resolve);
					ws.close(CLOSE.GOING_AWAY, "server shutting down");
				}),
		);
		await Promise.race([Promise.all(closing), sleep(2000)]);
		for (const ws of wss.clients) ws.terminate(); // хто не встиг, того рубаємо
		await Promise.race([
			new Promise((resolve) => wss.close(resolve)),
			sleep(1000),
		]);
	}

	return { wss, shutdown };
}
