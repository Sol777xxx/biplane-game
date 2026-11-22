import { randomBytes } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import {
	CodecError,
	decodeInput,
	FORMAT_VERSION,
} from "biplane-shared/codec/binary.ts";
import { type Codec, getCodec } from "biplane-shared/codec/index.ts";
import {
	type ClientMessage,
	inputFromMessage,
	type JoinMessage,
	parseClientMessage,
	type ServerMessage,
	type SnapshotMessage,
} from "biplane-shared/protocol/index.ts";
import { NO_SEQ } from "biplane-shared/sim/ids.ts";
import { assertNever } from "biplane-shared/sim/never.ts";
import type WebSocket from "ws";
import { WebSocketServer } from "ws";
import { TokenBucket } from "./limits.ts";
import { childLogger, type Logger } from "./logger.ts";
import type { Metrics } from "./metrics.ts";
import { NetSim, parseNetsimUrl } from "./netsim.ts";
import { clientIp, isOriginAllowed } from "./origin.ts";
import { CLOSE, MAX_MESSAGE_BYTES, makeServer } from "./protocol.ts";
import {
	type ChatMessage,
	type Room,
	RoomError,
	type RoomErrorCode,
	type RoomManager,
	type RoomPlayer,
	type RoomSnapshot,
} from "./rooms.ts";

export interface WsOptions {
	readonly joinTimeoutMs: number;
	readonly pingIntervalMs: number;
	readonly maxMissedPongs: number;
	readonly maxPayload: number;
	readonly frameCapacity: number;
	readonly frameRefillPerSec: number;
	readonly rateCapacity: number;
	readonly rateRefillPerSec: number;
	readonly inputCapacity: number;
	readonly inputRefillPerSec: number;
	readonly softBufferBytes: number;
	readonly hardBufferBytes: number;
	readonly netsim: boolean;
	// Origin рукостискання: порожній список означає «лише той самий хост» (див. origin.ts)
	readonly allowedOrigins: readonly string[];
	readonly maxConnPerIp: number; // одночасних з'єднань з однієї IP
	readonly maxPlayers: number; // гравців у всіх кімнатах разом
	readonly trustProxy: boolean; // брати IP з X-Forwarded-For (за проксі хостингу)
}

export const WS_DEFAULTS: Readonly<WsOptions> = Object.freeze({
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
	softBufferBytes: 16 * 1024, // вище: chat і snapshot цьому клієнтові не шлемо
	hardBufferBytes: 256 * 1024, // вище: розриваємо з'єднання
	netsim: false, // штучна затримка/втрати (ENABLE_NETSIM=1), лише для розробки
	allowedOrigins: Object.freeze<string[]>([]),
	maxConnPerIp: Number.POSITIVE_INFINITY,
	maxPlayers: Number.POSITIVE_INFINITY,
	trustProxy: false,
});

// Не всі помилки кімнати стають кодом закриття: решта це збій сервера й летить далі.
const ROOM_ERROR_CODES: Readonly<Partial<Record<RoomErrorCode, number>>> = {
	full: CLOSE.ROOM_FULL,
	name_taken: CLOSE.NAME_TAKEN,
	already_joined: CLOSE.ALREADY_JOINED,
};

// Стан одного з'єднання. Живе в WeakMap, а не полем на сокеті: тип сокета не змінюємо.
interface Session {
	readonly id: string;
	player: RoomPlayer | null;
	room: Room | null;
	missedPongs: number;
	joinTimer: NodeJS.Timeout | null;
	unsubscribe: (() => void) | null;
	readonly frameBucket: TokenBucket;
	readonly bucket: TokenBucket;
	readonly inputBucket: TokenBucket;
	readonly codec: Codec;
	readonly sim: NetSim;
	dropping: boolean;
	dropped: number;
	slow: boolean;
	// логер сеансу: після join несе id кімнати й гравця
	log: Logger;
}

type NetsimRequest = Extract<ClientMessage, { type: "netsim" }>;

export interface AttachOptions extends Partial<WsOptions> {
	readonly server: Server;
	readonly rooms: RoomManager;
	readonly log: Logger;
	readonly metrics?: Metrics;
}

export interface WebSocketHub {
	readonly wss: WebSocketServer;
	sessionOf(ws: WebSocket): Session | undefined;
	shutdown(): Promise<void>;
}

// кадр ws може прийти шматками; для розбору потрібен один буфер
function toBuffer(data: WebSocket.RawData): Buffer {
	if (Buffer.isBuffer(data)) return data;
	if (Array.isArray(data)) return Buffer.concat(data);
	return Buffer.from(data);
}

// undefined у параметрах (наприклад, поле конфігурації, якого немає) не затирає значення за замовчуванням
function definedOnly<T extends object>(source: T): Partial<T> {
	return Object.fromEntries(
		Object.entries(source).filter(([, value]) => value !== undefined),
	) as Partial<T>;
}

const rawBytes = (data: WebSocket.RawData): number =>
	Array.isArray(data)
		? data.reduce((sum, part) => sum + part.length, 0)
		: data.byteLength;

export function attachWebSocket({
	server,
	rooms,
	log,
	metrics,
	...options
}: AttachOptions): WebSocketHub {
	const opts: WsOptions = { ...WS_DEFAULTS, ...definedOnly(options) };
	let draining = false; // shutdown розпочато: нових з'єднань не беремо
	const connectionsByIp = new Map<string, number>();
	const totalPlayers = (): number =>
		rooms.all().reduce((sum, room) => sum + room.players.size, 0);
	const sessions = new WeakMap<WebSocket, Session>();
	// noServer: upgrade обробляємо самі, щоб приймати лише шлях /ws
	const wss = new WebSocketServer({
		noServer: true,
		maxPayload: opts.maxPayload,
	});
	wss.on("error", (error) => log.error("wss:", error));

	type Refusal = readonly [status: number, text: string, reason: string];
	function refusalFor(req: IncomingMessage, ip: string): Refusal | null {
		if (draining) return [503, "Service Unavailable", "draining"];
		if (
			!isOriginAllowed(
				req.headers.origin,
				req.headers.host,
				opts.allowedOrigins,
			)
		) {
			return [403, "Forbidden", "origin"];
		}
		if ((connectionsByIp.get(ip) ?? 0) >= opts.maxConnPerIp) {
			return [429, "Too Many Requests", "ip_limit"];
		}
		return null;
	}

	server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
		const { pathname } = new URL(req.url ?? "/", "http://x");
		if (pathname !== "/ws") {
			socket.on("error", () => {}); // сирий сокет теж EventEmitter з "error"
			socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
			return;
		}

		// Три відмови ще до рукостискання: сервер зупиняється (503), чужий Origin (403),
		// забагато з'єднань з однієї IP (429). Нічого з цього не доходить до розбору протоколу.
		const ip = clientIp(req, opts.trustProxy);
		const origin = req.headers.origin;
		const refusal = refusalFor(req, ip);
		if (refusal) {
			const [status, text, reason] = refusal;
			metrics?.upgradeRefused(reason);
			log.warn({ ip, origin, reason }, "рукостискання WebSocket відхилено");
			socket.on("error", () => {});
			socket.end(
				`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
			);
			return;
		}

		wss.handleUpgrade(req, socket, head, (ws) => {
			connectionsByIp.set(ip, (connectionsByIp.get(ip) ?? 0) + 1);
			ws.once("close", () => {
				const left = (connectionsByIp.get(ip) ?? 1) - 1;
				if (left <= 0) connectionsByIp.delete(ip);
				else connectionsByIp.set(ip, left);
			});
			wss.emit("connection", ws, req);
		});
	});

	// ---------- надсилання й закриття ----------

	// Клієнт, який не читає, змушує сервер тримати все в буфері сокета. bufferedAmount це байти,
	// які ws прийняв, але ще не віддав у мережу. droppable: повідомлення, яке не шкода
	// втратити (chat, snapshot: наступний знімок застарить цей). Стан (roster, joined, error)
	// не відкидається. Знімок кодується кодеком клієнта (json або binary), решта це JSON.
	// Штучна мережа стоїть після перевірки буфера: на сам буфер вона не впливає.
	// Кадр бінарного знімка кодується раз на тік: shared це об'єкт знімка кімнати (новий на кожен
	// тік, тому застарілого в кеші не буде), а кожному сокету віддається копія з його ack.
	const sharedFrames = new WeakMap<object, Uint8Array<ArrayBuffer>>();
	function encodeSnapshotFor(
		codec: Codec,
		message: SnapshotMessage,
		shared: object | undefined,
	): string | Uint8Array<ArrayBuffer> {
		if (!codec.isBinary || shared === undefined) {
			return codec.encodeSnapshot(message);
		}
		let frame = sharedFrames.get(shared);
		if (frame === undefined) {
			frame = codec.encodeSnapshot({ ...message, ack: NO_SEQ });
			sharedFrames.set(shared, frame);
		}
		return codec.withAck(frame, message.ack);
	}

	function send(
		ws: WebSocket,
		s: Session,
		message: ServerMessage,
		{
			droppable = false,
			shared,
		}: { droppable?: boolean; shared?: object } = {},
	): void {
		if (ws.readyState !== ws.OPEN) return;
		const buffered = ws.bufferedAmount;

		if (buffered > opts.hardBufferBytes) {
			closeSlow(ws, s, buffered);
			return;
		}
		if (droppable && buffered > opts.softBufferBytes) {
			if (!s.dropping) {
				s.dropping = true;
				s.log.warn(
					`повільний клієнт (${buffered} Б у буфері): відкидаємо chat і snapshot`,
				);
			}
			s.dropped++;
			return;
		}
		s.dropping = false;

		const data =
			message.type === "snapshot"
				? encodeSnapshotFor(s.codec, message, shared)
				: JSON.stringify(message);
		s.sim.outbound(
			() => {
				if (ws.readyState !== ws.OPEN) return; // за час затримки сокет міг закритись
				metrics?.sent(
					typeof data === "string" ? Buffer.byteLength(data) : data.byteLength,
				);
				ws.send(data, (error) => {
					if (error) s.log.warn(`send: ${error.message}`);
				});
			},
			{ lossy: message.type === "snapshot" },
		);
	}

	function closeSlow(ws: WebSocket, s: Session, buffered: number): void {
		if (s.slow) return;
		s.slow = true;
		s.log.warn(
			`повільний клієнт: ${buffered} Б у буфері (відкинуто: ${s.dropped}), розрив`,
		);
		ws.close(CLOSE.SLOW_CLIENT, "slow client");
		// close-кадр стоїть у черзі за буфером, а клієнт його не читає: через 1 с рубаємо
		const timer = setTimeout(() => ws.terminate(), 1000);
		timer.unref();
		ws.once("close", () => clearTimeout(timer));
	}

	// порушення протоколу: пояснюємо повідомленням і закриваємо з кодом
	function reject(
		ws: WebSocket,
		s: Session,
		code: number,
		reason: string,
	): void {
		metrics?.violation(code);
		s.log.warn({ code }, `закрито ${code}: ${reason}`);
		send(ws, s, makeServer("error", { code, message: reason }));
		ws.close(code, reason); // reason у close-кадрі максимум 123 байти
	}

	// ---------- підписка сокета на події кімнати ----------
	// Кімната нічого не знає про сокети: кожен сокет підписується сам.
	function subscribe(ws: WebSocket, s: Session, room: Room): () => void {
		const onChat = (message: ChatMessage): void =>
			send(ws, s, makeServer("chat", message), { droppable: true });
		const onRoster = (): void =>
			send(ws, s, makeServer("roster", { players: room.roster() }));
		// знімок спільний, але ack (останній оброблений seq) у кожного свій
		const onSnapshot = ({ snapshot, acks }: RoomSnapshot): void => {
			const id = s.player?.id;
			const ack = (id === undefined ? undefined : acks.get(id)) ?? NO_SEQ;
			send(ws, s, makeServer("snapshot", { ...snapshot, ack }), {
				droppable: true,
				shared: snapshot,
			});
		};
		room.on("chat", onChat);
		room.on("join", onRoster);
		room.on("leave", onRoster);
		room.on("snapshot", onSnapshot);
		return () => {
			room.off("chat", onChat);
			room.off("join", onRoster);
			room.off("leave", onRoster);
			room.off("snapshot", onSnapshot);
		};
	}

	function detach(s: Session): void {
		if (s.joinTimer !== null) clearTimeout(s.joinTimer);
		s.unsubscribe?.();
		s.unsubscribe = null;
		if (s.room && s.player) {
			s.log.info("вийшов із кімнати");
			s.room.leave(s.player.id); // інші отримають roster
		}
		s.room = null;
		s.player = null;
	}

	// ---------- повідомлення ----------
	function handleJoin(ws: WebSocket, s: Session, msg: JoinMessage): void {
		const room = rooms.get(msg.room);
		if (!room) {
			reject(ws, s, CLOSE.ROOM_NOT_FOUND, "room not found");
			return;
		}
		// ліміт гравців на весь процес (MAX_PLAYERS): той самий код, що й «кімната заповнена»
		if (totalPlayers() >= opts.maxPlayers) {
			reject(ws, s, CLOSE.ROOM_FULL, "server full");
			return;
		}

		let player: RoomPlayer;
		try {
			player = room.join({ id: s.id, name: msg.name });
		} catch (error: unknown) {
			const code =
				error instanceof RoomError ? ROOM_ERROR_CODES[error.code] : undefined;
			if (code === undefined || !(error instanceof RoomError)) throw error;
			reject(ws, s, code, error.code.replaceAll("_", " "));
			return;
		}

		if (s.joinTimer !== null) clearTimeout(s.joinTimer);
		s.player = player;
		s.room = room;
		send(
			ws,
			s,
			makeServer("joined", {
				you: { id: player.id, name: player.name },
				room: room.summary(),
				players: room.roster(),
			}),
		);
		// клієнт дізнається про штучну мережу лише коли вона дозволена на сервері
		if (opts.netsim) {
			send(ws, s, makeServer("netsim", { enabled: true, ...s.sim.settings }));
		}
		s.unsubscribe = subscribe(ws, s, room);
		// відтепер кожен запис цього сеансу несе id кімнати й гравця
		s.log = childLogger(log, { room: room.id, player: player.id });
		s.log.info(`${player.name} зайшов у кімнату`);
	}

	// Зміна штучної мережі наживо. Вимкнено на сервері: відповідаємо enabled: false
	// і нічого не закриваємо.
	function handleNetsim(ws: WebSocket, s: Session, msg: NetsimRequest): void {
		if (opts.netsim) s.sim.set(msg);
		send(
			ws,
			s,
			makeServer("netsim", { enabled: opts.netsim, ...s.sim.settings }),
		);
	}

	// Кадр у повідомлення. Бінарним може бути лише input версії 1: чужа версія це 1003,
	// зламана розкладка це 4000. Текстовий кадр це JSON за parseClientMessage. Відхилений кадр дає
	// undefined (з'єднання вже закривається).
	function parse(
		ws: WebSocket,
		s: Session,
		data: WebSocket.RawData,
		isBinary: boolean,
	): ClientMessage | undefined {
		const buffer = toBuffer(data);
		if (isBinary) {
			if (buffer[0] !== FORMAT_VERSION) {
				reject(ws, s, CLOSE.UNSUPPORTED, "binary frames not supported");
				return undefined;
			}
			try {
				return decodeInput(buffer);
			} catch (error: unknown) {
				if (!(error instanceof CodecError)) throw error;
				reject(ws, s, CLOSE.BAD_FORMAT, "bad binary frame");
				return undefined;
			}
		}
		let raw: unknown;
		try {
			raw = JSON.parse(buffer.toString("utf8"));
		} catch {
			reject(ws, s, CLOSE.BAD_FORMAT, "invalid json");
			return undefined;
		}
		const result = parseClientMessage(raw);
		if (result.ok) return result.msg;
		reject(ws, s, result.code, result.reason);
		return undefined;
	}

	// Перевірки на вході (ліміти, розбір, валідація) йдуть без затримки: вони рахують
	// те, що прийшло з мережі. Затримується лише обробка (dispatch).
	function onMessage(
		ws: WebSocket,
		s: Session,
		data: WebSocket.RawData,
		isBinary: boolean,
	): void {
		// після закриття з нашого боку решту повідомлень у черзі ігноруємо
		if (ws.readyState !== ws.OPEN) return;
		metrics?.received(rawBytes(data));
		// ліміт кадрів стоїть ПЕРШИМ: порахувати повідомлення дешевше, ніж розібрати його
		if (!s.frameBucket.take()) {
			reject(ws, s, CLOSE.RATE_LIMIT, "rate limit");
			return;
		}

		const msg = parse(ws, s, data, isBinary);
		if (!msg) return;
		// окреме відро на тип: часті input не з'їдають ліміт чату, а спам чату не душить input.
		// ping окремого відра не має: його обмежує стеля кадрів.
		const bucket =
			msg.type === "input"
				? s.inputBucket
				: msg.type === "ping"
					? null
					: s.bucket;
		if (bucket && !bucket.take()) {
			reject(ws, s, CLOSE.RATE_LIMIT, "rate limit");
			return;
		}

		s.sim.inbound(() => guarded(ws, s, () => dispatch(ws, s, msg)), {
			lossy: msg.type === "input",
		});
	}

	// виняток у відкладеному обробнику не має куди підніматись: він би завалив процес
	function guarded(ws: WebSocket, s: Session, fn: () => void): void {
		try {
			fn();
		} catch (error: unknown) {
			s.log.error("помилка обробника:", error);
			ws.close(CLOSE.INTERNAL, "internal error");
		}
	}

	function dispatch(ws: WebSocket, s: Session, msg: ClientMessage): void {
		// за час затримки сокет міг закритись
		if (ws.readyState !== ws.OPEN) return;
		const { player, room } = s;
		if (!player || !room) {
			if (msg.type !== "join") {
				reject(ws, s, CLOSE.NOT_JOINED, "join first");
				return;
			}
			handleJoin(ws, s, msg);
			return;
		}
		// Кожен тип повідомлення має гілку; default це never: новий тип у протоколі
		// без обробника тут це помилка tsc.
		switch (msg.type) {
			case "join":
				reject(ws, s, CLOSE.ALREADY_JOINED, "already joined");
				return;
			case "chat":
				room.chat(player.id, msg.text); // подію отримають усі в кімнаті
				return;
			case "input":
				// Сервер лише передає input кімнаті; Match підписаний на цю подію
				room.emit("input", {
					playerId: player.id,
					seq: msg.seq,
					keys: inputFromMessage(msg),
				});
				return;
			case "ping":
				send(ws, s, makeServer("pong", { t: msg.t }));
				return;
			case "netsim":
				handleNetsim(ws, s, msg);
				return;
			case "leave":
				detach(s);
				ws.close(CLOSE.NORMAL, "bye");
				return;
			default:
				assertNever(msg, "повідомлення клієнта");
		}
	}

	wss.on("connection", (ws, req) => {
		const id = randomBytes(4).toString("hex");
		const clog = childLogger(log, { player: id });
		const s: Session = {
			id,
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
			// ?codec=binary: знімки бінарні; без параметра (або невідоме значення) це JSON
			codec: getCodec(
				new URL(req.url ?? "/", "http://x").searchParams.get("codec"),
			),
			// штучна мережа: початкові значення з адреси, лише якщо дозволено на сервері
			sim: new NetSim({
				...(opts.netsim ? parseNetsimUrl(req.url) : {}),
				onError: (error) => clog.error("netsim:", error),
			}),
			dropping: false,
			dropped: 0,
			slow: false,
			log: clog,
		};
		sessions.set(ws, s);

		// "error" першим рядком: без нього помилка сокета (наприклад, завеликий кадр)
		// стала б необробленою подією і завалила б увесь процес
		ws.on("error", (error) => clog.warn(`помилка сокета: ${error.message}`));

		s.joinTimer = setTimeout(
			() => reject(ws, s, CLOSE.JOIN_TIMEOUT, "join timeout"),
			opts.joinTimeoutMs,
		);

		ws.on("pong", () => {
			s.missedPongs = 0;
		});

		ws.on("message", (data, isBinary) => {
			// виняток в обробнику події не має куди підніматись: він би завалив процес
			try {
				onMessage(ws, s, data, isBinary);
			} catch (error: unknown) {
				clog.error("помилка обробника:", error);
				ws.close(CLOSE.INTERNAL, "internal error");
			}
		});

		ws.on("close", () => {
			detach(s);
			s.sim.dispose(); // відкладені повідомлення вже нікому не потрібні
		});
	});

	// ---------- heartbeat ----------
	const heartbeat = setInterval(() => {
		for (const ws of wss.clients) {
			const s = sessions.get(ws);
			if (!s) continue;
			if (s.missedPongs >= opts.maxMissedPongs) {
				s.log.warn("немає pong, розрив");
				ws.terminate();
				continue;
			}
			s.missedPongs++;
			ws.ping();
		}
	}, opts.pingIntervalMs);
	heartbeat.unref();

	// ---------- завершення ----------
	// Спершу кажемо клієнтам, що сервер іде (вони повернуться в лобі, а не чекатимуть
	// перепідключення), потім закриваємо сокети кодом 1001.
	async function shutdown(): Promise<void> {
		draining = true;
		clearInterval(heartbeat);
		log.info({ clients: wss.clients.size }, "закриваю сокети");
		const closing = [...wss.clients].map(
			(ws) =>
				new Promise<void>((resolve) => {
					ws.once("close", () => resolve());
					const s = sessions.get(ws);
					if (s) {
						send(
							ws,
							s,
							makeServer("shutdown", { reason: "server shutting down" }),
						);
					}
					ws.close(CLOSE.GOING_AWAY, "server shutting down");
				}),
		);
		await Promise.race([Promise.all(closing), sleep(2000)]);
		for (const ws of wss.clients) ws.terminate(); // хто не встиг, того рубаємо
		await Promise.race([
			new Promise<void>((resolve) => wss.close(() => resolve())),
			sleep(1000),
		]);
	}

	return { wss, sessionOf: (ws) => sessions.get(ws), shutdown };
}
